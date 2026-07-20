#!/usr/bin/env python3
"""Jira OAuth 2.0 proxy server for eero-fleet Harmony.

Runs on cloud desktop port 8422. Handles:
  GET  /auth/login     → Redirects to Atlassian OAuth consent
  GET  /auth/callback  → Exchanges code for token, redirects back to Harmony
  GET  /jira/search    → Proxies Jira search (JQL) using user's token
  POST /jira/create    → Creates Jira ticket using user's token
  GET  /jira/me        → Returns user info + accessible resources

Each user authenticates with THEIR OWN Atlassian account via OAuth.
The app secret is for the registered OAuth app, not any personal account.

Usage: python3 jira_proxy.py
"""
import json
import ssl
import os
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlencode, quote, parse_qs, urlparse
from urllib.request import Request, urlopen
from urllib.error import HTTPError

# OAuth App credentials (registered at developer.atlassian.com)
CLIENT_ID = 'YdsUguKW7jKY9mU2NkepirxzX0HOEDrS'
CLIENT_SECRET = os.environ.get('ATLASSIAN_CLIENT_SECRET') or open(os.path.join(os.path.dirname(__file__), '.jira_secret')).read().strip() if os.path.exists(os.path.join(os.path.dirname(__file__), '.jira_secret')) else ''
REDIRECT_URI = 'https://dev-dsk-bharatmk-2b-5ad04490.us-west-2.amazon.com:8422/auth/callback'
HARMONY_ORIGIN = 'https://eero-fleet.beta.harmony.a2z.com'
SCOPES = 'read:jira-work read:jira-user write:jira-work'
PORT = 8422

# SSL context (reuse existing certs from server.py)
CERT_DIR = os.path.expanduser('~/.myeero-AI/certs')
CERT_FILE = os.path.join(CERT_DIR, 'server.crt')
KEY_FILE = os.path.join(CERT_DIR, 'server.key')


def jira_api_call(url, token, method='GET', data=None):
    """Call Atlassian Cloud API with user's OAuth token."""
    headers = {
        'Authorization': f'Bearer {token}',
        'Accept': 'application/json',
        'Content-Type': 'application/json',
    }
    body = json.dumps(data).encode() if data else None
    req = Request(url, data=body, headers=headers, method=method)
    try:
        ctx = ssl.create_default_context()
        resp = urlopen(req, timeout=30, context=ctx)
        return json.loads(resp.read())
    except HTTPError as e:
        return {'error': e.reason, 'status': e.code, 'detail': e.read().decode()[:500]}


class JiraProxyHandler(BaseHTTPRequestHandler):
    def _cors_headers(self):
        return {
            'Access-Control-Allow-Origin': HARMONY_ORIGIN,
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
            'Access-Control-Allow-Credentials': 'true',
        }

    def _respond(self, code, body, content_type='application/json'):
        self.send_response(code)
        for k, v in self._cors_headers().items():
            self.send_header(k, v)
        self.send_header('Content-Type', content_type)
        self.end_headers()
        if isinstance(body, dict):
            self.wfile.write(json.dumps(body).encode())
        else:
            self.wfile.write(body.encode() if isinstance(body, str) else body)

    def _redirect(self, url):
        self.send_response(302)
        self.send_header('Location', url)
        self.end_headers()

    def _get_token(self):
        auth = self.headers.get('Authorization', '')
        if auth.startswith('Bearer '):
            return auth[7:]
        return None

    def _get_cloud_id(self, token):
        resources = jira_api_call('https://api.atlassian.com/oauth/token/accessible-resources', token)
        if isinstance(resources, list) and resources:
            return resources[0]['id']
        return None

    def do_OPTIONS(self):
        self.send_response(200)
        for k, v in self._cors_headers().items():
            self.send_header(k, v)
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        qs = parse_qs(parsed.query)

        # --- AUTH FLOW ---
        if path == '/auth/login':
            auth_url = (
                f'https://auth.atlassian.com/authorize'
                f'?audience=api.atlassian.com'
                f'&client_id={CLIENT_ID}'
                f'&scope={quote(SCOPES)}'
                f'&redirect_uri={quote(REDIRECT_URI)}'
                f'&state=harmony'
                f'&response_type=code'
                f'&prompt=consent'
            )
            self._redirect(auth_url)
            return

        if path == '/auth/callback':
            code = qs.get('code', [''])[0]
            if not code:
                self._respond(400, {'error': 'No authorization code'})
                return

            # Exchange code for token
            token_data = urlencode({
                'grant_type': 'authorization_code',
                'client_id': CLIENT_ID,
                'client_secret': CLIENT_SECRET,
                'code': code,
                'redirect_uri': REDIRECT_URI,
            }).encode()

            req = Request(
                'https://auth.atlassian.com/oauth/token',
                data=token_data,
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
            )
            try:
                ctx = ssl.create_default_context()
                resp = urlopen(req, timeout=30, context=ctx)
                token_resp = json.loads(resp.read())
                access_token = token_resp.get('access_token', '')
                # Redirect back to Harmony with token in fragment
                self._redirect(f'{HARMONY_ORIGIN}/fleet-health.html#jira_token={access_token}')
            except HTTPError as e:
                self._respond(400, {'error': 'Token exchange failed', 'detail': e.read().decode()[:200]})
            return

        # --- AUTHENTICATED ENDPOINTS ---
        token = self._get_token()
        if not token:
            self._respond(401, {'error': 'Missing Bearer token. Call /auth/login first.'})
            return

        if path == '/jira/me':
            resources = jira_api_call('https://api.atlassian.com/oauth/token/accessible-resources', token)
            self._respond(200, resources if isinstance(resources, list) else {'error': resources})
            return

        if path == '/jira/search':
            cloud_id = self._get_cloud_id(token)
            if not cloud_id:
                self._respond(401, {'error': 'Cannot access Jira. Token may be expired.'})
                return
            jql = qs.get('jql', ['project=CONN ORDER BY created DESC'])[0]
            max_results = qs.get('maxResults', ['50'])[0]
            result = jira_api_call(
                f'https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/search?jql={quote(jql)}&maxResults={max_results}',
                token
            )
            self._respond(200, result)
            return

        self._respond(404, {'error': 'Not found'})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        token = self._get_token()
        if not token:
            self._respond(401, {'error': 'Missing Bearer token'})
            return

        content_length = int(self.headers.get('Content-Length', 0))
        body = json.loads(self.rfile.read(content_length)) if content_length > 0 else {}

        if path == '/jira/create':
            cloud_id = self._get_cloud_id(token)
            if not cloud_id:
                self._respond(401, {'error': 'Cannot access Jira'})
                return
            result = jira_api_call(
                f'https://api.atlassian.com/ex/jira/{cloud_id}/rest/api/3/issue',
                token, method='POST', data=body
            )
            self._respond(200 if 'key' in result else 400, result)
            return

        self._respond(404, {'error': 'Not found'})

    def log_message(self, format, *args):
        print(f"[JIRA-PROXY] {self.address_string()} - {format % args}")


def main():
    server = HTTPServer(('0.0.0.0', PORT), JiraProxyHandler)

    # Enable HTTPS
    if os.path.exists(CERT_FILE) and os.path.exists(KEY_FILE):
        ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        ctx.load_cert_chain(CERT_FILE, KEY_FILE)
        server.socket = ctx.wrap_socket(server.socket, server_side=True)
        print(f"🔐 Jira OAuth Proxy running on https://0.0.0.0:{PORT}")
    else:
        print(f"⚠️  No SSL certs found, running HTTP on port {PORT}")
        print(f"   Generate certs: openssl req -x509 -nodes -days 365 -newkey rsa:2048 -keyout {KEY_FILE} -out {CERT_FILE}")

    print(f"   Login URL: https://dev-dsk-bharatmk-2b-5ad04490.us-west-2.amazon.com:{PORT}/auth/login")
    print(f"   Callback:  {REDIRECT_URI}")
    print(f"   Harmony:   {HARMONY_ORIGIN}")
    print()

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == '__main__':
    main()
