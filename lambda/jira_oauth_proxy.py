"""Jira OAuth 2.0 proxy Lambda for Harmony.

Endpoints:
  GET  /auth/login     → Redirects to Atlassian OAuth consent
  GET  /auth/callback  → Exchanges code for token, redirects back with token
  GET  /jira/search    → Proxies Jira search (JQL)
  POST /jira/create    → Creates Jira ticket
  GET  /jira/me        → Returns current user info

All endpoints expect Authorization: Bearer <atlassian_token> header
(except /auth/login and /auth/callback which handle the OAuth flow).
"""
import json
import os
import urllib.request
import urllib.parse

CLIENT_ID = os.environ.get('ATLASSIAN_CLIENT_ID', 'YdsUguKW7jKY9mU2NkepirxzX0HOEDrS')
CLIENT_SECRET = os.environ.get('ATLASSIAN_CLIENT_SECRET', '')
REDIRECT_URI = os.environ.get('REDIRECT_URI', 'https://eero-fleet.beta.harmony.a2z.com/auth/callback')
HARMONY_ORIGIN = os.environ.get('HARMONY_ORIGIN', 'https://eero-fleet.beta.harmony.a2z.com')
SCOPES = 'read:jira-work read:jira-user write:jira-work'

def cors_headers():
    return {
        'Access-Control-Allow-Origin': HARMONY_ORIGIN,
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    }

def respond(status, body, headers=None):
    h = cors_headers()
    if headers:
        h.update(headers)
    return {
        'statusCode': status,
        'headers': h,
        'body': json.dumps(body) if isinstance(body, dict) else body,
    }

def redirect(url):
    return {
        'statusCode': 302,
        'headers': {'Location': url},
        'body': '',
    }

def jira_api(path, token, method='GET', data=None):
    """Call Atlassian Cloud API with user's OAuth token."""
    url = f'https://api.atlassian.com{path}'
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
    body = json.dumps(data).encode() if data else None
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return {'error': e.reason, 'status': e.code, 'detail': e.read().decode()[:500]}

def get_accessible_resources(token):
    """Get the Jira Cloud site ID for the user."""
    return jira_api('/oauth/token/accessible-resources', token)

def handler(event, context):
    path = event.get('path', '')
    method = event.get('httpMethod', 'GET')
    headers = event.get('headers', {}) or {}
    qs = event.get('queryStringParameters', {}) or {}
    
    # CORS preflight
    if method == 'OPTIONS':
        return respond(200, '')
    
    # --- AUTH FLOW ---
    if path == '/auth/login':
        auth_url = (
            f'https://auth.atlassian.com/authorize'
            f'?audience=api.atlassian.com'
            f'&client_id={CLIENT_ID}'
            f'&scope={urllib.parse.quote(SCOPES)}'
            f'&redirect_uri={urllib.parse.quote(REDIRECT_URI)}'
            f'&state=harmony'
            f'&response_type=code'
            f'&prompt=consent'
        )
        return redirect(auth_url)
    
    if path == '/auth/callback':
        code = qs.get('code')
        if not code:
            return respond(400, {'error': 'No authorization code'})
        
        # Exchange code for token
        token_data = urllib.parse.urlencode({
            'grant_type': 'authorization_code',
            'client_id': CLIENT_ID,
            'client_secret': CLIENT_SECRET,
            'code': code,
            'redirect_uri': REDIRECT_URI,
        }).encode()
        
        req = urllib.request.Request(
            'https://auth.atlassian.com/oauth/token',
            data=token_data,
            headers={'Content-Type': 'application/x-www-form-urlencoded'},
        )
        try:
            resp = urllib.request.urlopen(req, timeout=30)
            token_resp = json.loads(resp.read())
            access_token = token_resp.get('access_token', '')
            
            # Redirect back to Harmony with token in fragment (never in URL params for security)
            return redirect(f'{HARMONY_ORIGIN}/fleet-health.html#jira_token={access_token}')
        except urllib.error.HTTPError as e:
            return respond(400, {'error': 'Token exchange failed', 'detail': e.read().decode()[:200]})
    
    # --- AUTHENTICATED ENDPOINTS ---
    auth_header = headers.get('Authorization', headers.get('authorization', ''))
    if not auth_header.startswith('Bearer '):
        return respond(401, {'error': 'Missing Bearer token'})
    token = auth_header[7:]
    
    if path == '/jira/me':
        # Get user info + site ID
        resources = get_accessible_resources(token)
        return respond(200, resources)
    
    if path == '/jira/search':
        # Get cloud ID first
        resources = get_accessible_resources(token)
        if not resources or isinstance(resources, dict) and resources.get('error'):
            return respond(401, {'error': 'Cannot access Jira', 'detail': resources})
        cloud_id = resources[0]['id']
        
        jql = qs.get('jql', 'project=CONN ORDER BY created DESC')
        max_results = qs.get('maxResults', '50')
        
        result = jira_api(
            f'/ex/jira/{cloud_id}/rest/api/3/search?jql={urllib.parse.quote(jql)}&maxResults={max_results}',
            token
        )
        return respond(200, result)
    
    if path == '/jira/create' and method == 'POST':
        body = json.loads(event.get('body', '{}'))
        resources = get_accessible_resources(token)
        if not resources or isinstance(resources, dict) and resources.get('error'):
            return respond(401, {'error': 'Cannot access Jira'})
        cloud_id = resources[0]['id']
        
        result = jira_api(
            f'/ex/jira/{cloud_id}/rest/api/3/issue',
            token, method='POST', data=body
        )
        return respond(200 if 'key' in result else 400, result)
    
    return respond(404, {'error': 'Not found'})
