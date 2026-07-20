// --- Harmony CSP workaround: style="" and onclick="" in innerHTML are blocked ---
// style.cssText and addEventListener work. This observer auto-converts both.
if (location.hostname.includes('harmony')) {
  var EVENT_ATTRS = ['onclick','onchange','onkeydown','onmouseover','onmouseout','oninput'];
  
  function fixElement(el) {
    try {
      // Fix inline styles
      var s = el.getAttribute('style');
      if (s) { el.removeAttribute('style'); el.style.cssText = s; }
    } catch(e) {}
    // Fix inline event handlers
    EVENT_ATTRS.forEach(function(attr) {
      try {
        var code = el.getAttribute(attr);
        if (code) {
          el.removeAttribute(attr);
          var evt = attr.substring(2);
          el.addEventListener(evt, new Function('event', code));
        }
      } catch(e) {}
    });
  }

  function fixTree(root) {
    if (!root || !root.querySelectorAll) return;
    if (root.getAttribute) fixElement(root);
    root.querySelectorAll('[style],[onclick],[onchange],[onkeydown],[onmouseover],[onmouseout],[oninput]').forEach(fixElement);
  }

  var _fixing = false;
  var observer = new MutationObserver(function(mutations) {
    if (_fixing) return;
    _fixing = true;
    mutations.forEach(function(m) {
      m.addedNodes.forEach(function(n) {
        if (n.nodeType === 1) fixTree(n);
      });
    });
    _fixing = false;
  });
  observer.observe(document.documentElement, { childList: true, subtree: true }

);

  document.addEventListener('DOMContentLoaded', function() { fixTree(document.body); });
  // Delegated event listener for dynamically created elements (CSP blocks onchange/onclick in innerHTML)
  document.addEventListener('change', function(e) {
    if (e.target && e.target.id === 'jira-cutoff-date') { applyJiraCutoff(); }
  });
  document.addEventListener('click', function(e) {
    var el = e.target.closest('[data-action]');
    if (el) {
      try { new Function('event', el.dataset.action)(e); } catch(ex) {}
    }
  });
}

// --- Harmony static site: rewrite API calls to static JSON files ---
const IS_HARMONY = location.hostname.includes('harmony');

// Rewrite URL for Harmony static hosting
function harmonyUrl(url) {
  if (!IS_HARMONY) return url;
  if (url.startsWith('/api/results')) return '/data/results.json';
  if (url.startsWith('/api/exec-summary')) return '/data/ap_client_exec_summary.json';
  if (url.startsWith('/api/ap-client-exec-summary')) return '/data/ap_client_exec_summary.json';
  if (url.startsWith('/api/mesh-jiras')) return '/data/jira_ap_client.json';
  if (url.startsWith('/api/ap-client-jiras')) return '/data/jira_ap_client.json';
  if (url.startsWith('/api/oncall-reports')) return '/data/oncall_index.json';
  if (url.startsWith('/ap-client-metric/')) return '/data/ap_client_health/' + url.substring('/ap-client-metric/'.length);
  return url;
}

// Return mock for write/unavailable APIs on Harmony
function harmonyMock(url) {
  if (!IS_HARMONY) return null;
  if (url.startsWith('/api/frozen-summary')) return {ok:true, json:()=>Promise.resolve([])};
  if (url.startsWith('/api/fleet-progress')) return {ok:true, json:()=>Promise.resolve({runs:[]})};
  if (url.startsWith('/api/run') || url.startsWith('/api/freeze') || url.startsWith('/api/delete') || url.startsWith('/api/kill') || url.startsWith('/api/jira-create') || url.startsWith('/api/kiro-analyze') || url.startsWith('/api/input') || url.startsWith('/api/output') || url.startsWith('/api/run-log') || url.startsWith('/api/processes')) {
    return {ok:true, json:()=>Promise.resolve({error:"read-only on Harmony"})};
  }
  return null;
}

const CATEGORIES = {
  stage: {env:'stage', gids:'0,2', label:'Stage'},
  beta:  {env:'prod',  gids:'2,3', label:'Beta'},
  prod:  {env:'prod',  gids:'0',   label:'Prod'}
};

// Map folder prefix patterns to category
function classifyRun(name){
  // stage_0_2_* → stage, prod_2_3_* → beta, prod_0_* → prod
  if(/^stage_0[_,]2/.test(name)) return 'stage';
  if(/^prod_2[_,]3/.test(name)) return 'beta';
  if(/^prod_0_/.test(name)) return 'prod';
  return null;
}

// Parse date+time from run folder name like "stage_0_2_2026-04-09_182045"
function parseRunDateTime(name){
  const m=name.match(/(\d{4}-\d{2}-\d{2})_(\d{2})(\d{2})(\d{2})/);
  if(!m) return {date:name, time:''};
  return {date:m[1], time:m[2]+':'+m[3]+':'+m[4]};
}

function extractTimestamp(name){
  const m=name.match(/(\d{4}-\d{2}-\d{2}_\d{6})/);
  return m?m[1]:'';
}

function buildDashboardLink(r){
  const name = r.fleet_metric_ts || r.run || r.name;
  if(!name) return null;
  if(IS_HARMONY) return '/data/ap_client_health/'+name+'/dashboard.html';
  return '/ap-client-metric/'+name+'/dashboard.html';
}

function renderColumn(el, runs){
  if(!runs.length){el.innerHTML='<div class="empty-state">No results</div>';return}
  let html='', lastDate='';
  runs.forEach(r=>{
    const dt=parseRunDateTime(r.run);
    if(dt.date!==lastDate){
      if(lastDate) html+='</div>'; // close previous date group
      lastDate=dt.date;
      html+=`<div class="fh-date-group"><div class="fh-date-label">📅 ${dt.date}</div>`;
    }
    let links='';
    const dashUrl=buildDashboardLink(r);
    if(dashUrl) links+=`<a href="${dashUrl}" target="_blank">📊 Dashboard</a>`;
    // Executive summary link
    if(r.html_files && r.html_files.includes('exec_summary.html')){
      links+=`<a href="/api/result-file?path=${encodeURIComponent(r.path+'/exec_summary.html')}" target="_blank">📋 Summary</a>`;
    }
    if(r.has_log) links+=`<a href="/api/result-file?path=${encodeURIComponent(r.path+'/session.log')}" target="_blank">📄 Log</a>`;
    html+=`<div class="fh-time-entry"><span class="time">🕐 ${dt.time||'—'}</span><span class="links">${links}</span></div>`;
  });
  if(lastDate) html+='</div>'; // close last date group
  el.innerHTML=html;
}

// Render latest (most recent dashboard per category)
async function api(m,u,b){
  const mock = harmonyMock(u);
  if(mock) return mock.json();
  const resolved = harmonyUrl(u);
  const o={method:m};
  if(b){o.headers={'Content-Type':'application/json'};o.body=JSON.stringify(b)}
  try{ return(await fetch(resolved,o)).json(); }catch(e){ return {}; }
}

let _apJiras=[];
// Restore cached Jira data from localStorage for instant render
try {
  const cached = JSON.parse(localStorage.getItem('apClientJirasCache')||'null');
  if(cached && cached.tickets) { _apJiras = cached.tickets; }
} catch(e){}
let _lastCutoff='';
function renderExecSummary(el, dataList, cat){
  if(!dataList||!dataList.length){el.innerHTML='<div class="empty-state">No analysis yet — run fleet health first</div>';return}
  let allHtml='';
  dataList.forEach((data,idx)=>{
    allHtml+=renderOneExecSummary(data, idx===0, cat);
  });
  el.innerHTML=allHtml;
}

function renderOneExecSummary(data, isLatest, cat){
  const shapeColor={TRENDING_UP:'#ff6b6b',TRENDING_DOWN:'#66bb6a',SPIKEY:'#ffb74d',FLAT_NOISY:'#888',FLAT:'#888',ZERO:'#555'};
  const sevIcon={critical:'🔴',high:'🟠',medium:'🔵'};
  const border=isLatest?'border:2px solid var(--accent);':'border:1px solid var(--border-subtle);opacity:0.8;';
  let h='<div style="'+border+'border-radius:8px;padding:10px;margin-bottom:12px;background:var(--bg-elevated)">';
  h+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">';
  h+='<span style="font-size:10px;color:var(--fg-dim)">'+data.generated+(isLatest?' <b style="color:var(--accent)">(latest)</b>':'')+'</span>';
  h+='<span style="font-size:10px"><a href="'+data.summary_url+'" target="_blank" style="color:var(--accent)">📋 Report</a> · <a href="'+data.dashboard_url+'" target="_blank" style="color:var(--accent)">📊 Dashboard</a>';
  if(isLatest && data.run) h+=' · <a href="#" onclick="refreshRun(\''+data.run+'\');return false" style="color:#ff9800" title="Regenerate exec summary + dashboard">🔄 Refresh</a>';
  h+='</span>';
  h+='</div>';

  const chartBase=data.dashboard_url?data.dashboard_url.replace('dashboard.html','charts/'):'';
  const rr=data.release_regressions||{};
  const kn=data.key_networks||{};
  const improving=(data.improving||[]);

  // Fleet-wide regressions
  const allFleet=data.fleet_regression||[];
  const allNetConc=data.network_concentrated||[];
  const allVerSpec=data.version_specific||[];
  const allAttention=data.attention||[];

  // Match metrics to existing Jira tickets
  const jiraMap={};
  _apJiras.forEach(t=>{
    if(!t.metric) return;
    const existing = jiraMap[t.metric];
    if(!existing) { jiraMap[t.metric]=t; return; }
    // Prefer open tickets over closed
    const closedStatuses = new Set(["Won't Do","Done","Closed","Resolved","Duplicate"]);
    const existingClosed = closedStatuses.has(existing.status);
    const newClosed = closedStatuses.has(t.status);
    if(existingClosed && !newClosed) jiraMap[t.metric]=t;
  });
  function hasJira(m){return !!jiraMap[m.name]}
  function jiraTag(m){
    const t=jiraMap[m.name]; if(!t) return '';
    const c=t.status==='Closed'||t.status==="Won't Do"||t.status==='Done'?'#888':t.status==='Triage'||t.status==='To Do'?'#4fc3f7':'#66bb6a';
    return ' <a href="https://eeroinc.atlassian.net/browse/'+t.key+'" target="_blank" style="color:'+c+';font-size:9px;text-decoration:none" title="'+t.status+'">'+t.key+' ('+t.status+')</a>';
  }

  // Keep all metrics in summary — jiraBtn() shows ticket link if exists, Create button if not
  const fleet=allFleet;
  const netConc=allNetConc;
  const attention=allAttention;

  // Filter version-specific: remove metrics where kiro says FLAT/stable/no action
  const verSpec=allVerSpec.filter(m=>{
    const k=(m.kiro||'').toLowerCase();
    if(k.match(/\bflat\b|stable|no action|no regression|declining/)) return false;
    return true;
  });

  function metricLink(m, color){
    return '<a href="#" onclick="showEvidence(&quot;'+chartBase+'&quot;,&quot;'+m.name+'&quot;);return false" style="color:'+color+';text-decoration:underline;cursor:pointer">'+m.name+'</a>';
  }
  function jiraBtn(m){
    const t=jiraMap[m.name];
    let html='';
    if(t) html+=' <a href="https://eeroinc.atlassian.net/browse/'+t.key+'" target="_blank" style="background:#4fc3f7;color:#1a1a2e;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:bold;text-decoration:none" title="'+t.status+'">'+t.key+'</a>';
    // Show old matches
    const oldMatches=_apJiras.filter(j=>j.metric===m.name && j.key!==(t&&t.key) && (j.status==='Done'||j.status==='Closed'||j.status==="Won't Do"));
    oldMatches.slice(0,2).forEach(j=>{
      html+=' <a href="https://eeroinc.atlassian.net/browse/'+j.key+'" target="_blank" style="color:#888;font-size:8px;text-decoration:none" title="'+j.status+'">'+j.key+'[old]</a>';
    });
    if(!t && !html){
      if(!data.run) return '';
      return ' <button onclick="createJira(\''+m.name+'\',\''+data.run+'\',this);event.stopPropagation()" style="background:#ff9800;color:#1a1a2e;border:none;padding:1px 5px;border-radius:3px;font-size:9px;font-weight:bold;cursor:pointer" title="Create CONN ticket with charts + CSV attached, opens for review">🎫</button>';
    }
    return html;
  }
  function metricRow(m, color){
    return '<div style="font-size:11px;margin:2px 0;padding-left:8px">• '+metricLink(m,color)+' <span class="shape '+m.shape+'" style="font-size:9px;padding:1px 4px">'+m.shape+'</span> '+m.baseline.toFixed(0)+'% mean='+fmtPPM(m.mean)+jiraBtn(m)+'</div>';
  }

  if(!fleet.length && !attention.length){
    h+='<div style="color:#66bb6a;font-weight:bold;font-size:12px;margin-bottom:4px">✅ Fleet is healthy — no active fleet-wide regressions</div>';
  } else {
    if(fleet.length){
      h+='<div style="color:#ff6b6b;font-weight:bold;font-size:12px;margin-bottom:4px">🔴 '+fleet.length+' fleet-wide regression(s)</div>';
      fleet.forEach(m=>{ h+=metricRow(m,'#ff6b6b'); });
    }
    if(attention.length){
      h+='<div style="color:#ffb74d;font-weight:bold;font-size:12px;margin-top:4px">⚠️ '+attention.length+' needs attention</div>';
      attention.forEach(m=>{ h+=metricRow(m,'#ffb74d'); });
    }
  }

  if(netConc.length){
    h+='<div style="font-weight:bold;font-size:12px;color:#ffb74d;margin-top:6px">🟡 Network-concentrated ('+netConc.length+')</div>';
    netConc.forEach(m=>{
      const status=m.still_active?'<span style="color:#ff6b6b">🔴 '+(m.status_label||'active')+'</span>':'<span style="color:#888">'+(m.status_label||'no recent spikes')+'</span>';
      h+='<div style="font-size:11px;margin:2px 0;padding-left:8px">• '+metricLink(m,'#ffb74d')+' '+m.net_tag+' '+(m.version||'')+' '+status+jiraBtn(m)+'</div>';
    });
  }
  // Version-specific section hidden for now — needs better evidence
  // if(verSpec.length){ ... }

  // Old issues (continuing) — Jiras created before this analysis, filtered by category
  const catLabel = {stage:'[Stage]', beta:'[Beta]', prod:'[Prod]'}[cat] || '';
  // Resolved tickets (was tracked, now stable)
  const resolved=(data.resolved_tickets||[]).filter(t=>!catLabel||t.summary.includes(catLabel));
  const resolvedKeys=new Set(resolved.map(t=>t.key));
  const oldJiras=_apJiras.filter(t=>{
    const open=t.status!=='Closed'&&t.status!=='Done'&&t.status!=="Won't Do";
    if(!open || !t.metric) return false;
    if(resolvedKeys.has(t.key)) return false;
    // Match ticket to this column's category via summary
    const s = t.summary||'';
    return s.includes(catLabel);
  });
  if(oldJiras.length){
    h+='<div style="margin-top:6px;border-top:1px solid var(--border-subtle);padding-top:4px;font-size:11px;color:var(--fg-dim)"><b>📂 Old Issues (continuing)</b></div>';
    const seen=new Set();
    oldJiras.forEach(t=>{
      if(seen.has(t.metric)) return; seen.add(t.metric);
      h+='<div style="font-size:11px;margin:2px 0;padding-left:8px">• <a href="https://eeroinc.atlassian.net/browse/'+t.key+'" target="_blank" style="color:#4fc3f7">'+t.key+'</a> '+t.metric+' <span style="color:#888">('+t.status+')</span></div>';
    });
  }
  if(resolved.length){
    h+='<div style="margin-top:6px;border-top:1px solid var(--border-subtle);padding-top:4px;font-size:11px;color:#66bb6a"><b>✅ Previously Reported — Now Stable</b></div>';
    resolved.forEach(t=>{
      h+='<div style="font-size:11px;margin:2px 0;padding-left:8px;color:#888">• <a href="https://eeroinc.atlassian.net/browse/'+t.key+'" target="_blank" style="color:#66bb6a">'+t.key+'</a> '+t.metric+' <span style="color:#555">(now '+t.shape+')</span></div>';
    });
  }

  // Release impact — hidden (not providing actionable info)
  // if(Object.keys(rr).length){ ... }
  // if(Object.keys(kn).length){ ... }
  if(improving.length){
    h+='<div style="font-size:11px;color:#66bb6a;margin-top:4px"><b>Improving:</b> '+improving.map(m=>m.name).join(', ')+'</div>';
  }

  h+='</div>';
  return h;
}

function fmtPPM(v){
  if(v>=1e9) return (v/1e9).toFixed(1)+'B';
  if(v>=1e6) return (v/1e6).toFixed(1)+'M';
  if(v>=1e3) return (v/1e3).toFixed(0)+'K';
  return Math.round(v)+'';
}

async function loadAll(){
  // Fire fast calls first, Jira in background (slow — hits external API)
  const [list, es] = await Promise.all([
    api('GET','/api/results?user=_shared').catch(e=>{console.error('results',e);return []}),
    api('GET','/api/exec-summary').catch(e=>{console.error('exec-summary',e);return {}})
  ]);
  // Start Jira fetch in background — will update when ready
  const jiraPromise = api('GET','/api/ap-client-jiras').catch(function(e){console.error('jira',e);return {ok:false}});
  let jr = {ok: false, _loading: true};
  // Render immediately with what we have
  _renderAll(list, jr, es);
  // When Jira arrives, re-render
  jiraPromise.then(j => { jr = j; _renderAll(list, jr, es); });
}

function _renderAll(list, jr, es){

  // Normalize Harmony results.json format → cloud desktop format
  if (IS_HARMONY && list.length && list[0].pipeline && !list[0].run) {
    list = list.map(r => ({
      category: r.pipeline || 'ap_client_health',
      run: r.name,
      path: r.path,
      html_files: ['dashboard.html', 'exec_summary.html'],
      fleet_metric_ts: r.timestamp ? r.name : null,
      has_log: false,
    }));
  }

  // Results → buttons + past columns
  const fh=list.filter(r=>r.category==='ap_client_health');
  fh.sort((a,b)=>extractTimestamp(b.run).localeCompare(extractTimestamp(a.run)));
  const buckets={stage:[],beta:[],prod:[]};
  fh.forEach(r=>{const cat=classifyRun(r.run);if(buckets[cat]) buckets[cat].push(r)});
  ['stage','beta','prod'].forEach(k=>{
    const el=document.getElementById('lb-'+k);
    const r=buckets[k].find(r=>r.html_files.includes('dashboard.html'));
    if(r){const u=buildDashboardLink(r);if(u){el.href=u;el.target='_blank';return}}
    el.classList.add('disabled');
  });
  renderColumn(document.getElementById('past-stage'), buckets.stage);
  renderColumn(document.getElementById('past-beta'), buckets.beta);
  renderColumn(document.getElementById('past-prod'), buckets.prod);

  // Jiras
  if(jr.tickets){
    _apJiras=jr.tickets||[];
    localStorage.setItem('apClientJirasCache', JSON.stringify({tickets:_apJiras, ts:new Date().toISOString()}));
  }
  // Show sync status with cache time
  const jiraStatus = document.getElementById('jira-sync-status');
  if(jiraStatus){
    const cachedTs = (JSON.parse(localStorage.getItem('apClientJirasCache')||'{}').ts||'').substring(0,16).replace('T',' ');
    if(jr._loading) jiraStatus.innerHTML='<div style="font-size:18px;color:var(--accent)">⏳ Syncing Jira tickets...'+(cachedTs?' <span style="font-size:11px;color:var(--fg-dim)">(showing cached from '+cachedTs+')</span>':'')+'<div style="margin-top:6px;height:4px;width:200px;background:#333;border-radius:4px;overflow:hidden"><div style="height:100%;width:60%;background:linear-gradient(90deg,var(--accent),#0099cc,var(--accent));background-size:200%;border-radius:4px;animation:jiraSync 1.2s ease-in-out infinite"></div></div></div>';
    else if(jr.tickets){ jiraStatus.innerHTML='<span style="color:#66bb6a;font-size:18px">✅ '+_apJiras.length+' Jira tickets synced</span>'; setTimeout(()=>{jiraStatus.style.transition='opacity 1s';jiraStatus.style.opacity='0.4'},3000); }
    else jiraStatus.innerHTML="<span style=\"color:#ff6b6b;font-size:12px\">❌ No tickets in response: "+JSON.stringify(jr).substring(0,200)+"</span>";
  }

  // Exec summary — align by DATE across all 3 columns
  const esCols = {stage: es.stage||[], beta: es.beta||[], prod: es.prod||[]};
  // Collect all unique dates (YYYY-MM-DD) across all columns, sorted newest first
  const allDates = new Set();
  for(const k of ['stage','beta','prod']){
    esCols[k].forEach(d => {
      const dt = (d.generated||'').substring(0, 10);
      if(dt) allDates.add(dt);
    });
  }
  const sortedDates = [...allDates].sort().reverse();

  // Split into current (after freeze) and frozen (before/on freeze)
  const esFrozen = localStorage.getItem('esFrozenDate') || '';
  const frozenDateStr = esFrozen.substring(0, 10);
  const currentDates = frozenDateStr ? sortedDates.filter(dt => dt > frozenDateStr) : sortedDates;
  const frozenDates = frozenDateStr ? sortedDates.filter(dt => dt <= frozenDateStr) : [];

  // Show/hide labels
  document.getElementById('current-exec-label').style.display = frozenDateStr ? 'block' : 'none';
  showFrozenSummary();
  document.getElementById('frozen-exec-label').style.display = frozenDates.length ? 'block' : 'none';
  document.getElementById('frozenExecSummary').style.display = frozenDates.length ? 'grid' : 'none';

  const visibleDates = currentDates.length ? currentDates : sortedDates;

  // Build a lookup: {cat: {date: [data, data, ...]}}
  const byDate = {};
  for(const k of ['stage','beta','prod']){
    byDate[k] = {};
    esCols[k].forEach(d => {
      const dt = (d.generated||'').substring(0, 10);
      if(dt){ if(!byDate[k][dt]) byDate[k][dt]=[]; byDate[k][dt].push(d); }
    });
  }

  // Build rows: for each date, max entries across columns
  const rowDefs = []; // [{date, idx}]
  visibleDates.forEach(dt => {
    const maxEntries = Math.max(
      (byDate.stage[dt]||[]).length,
      (byDate.beta[dt]||[]).length,
      (byDate.prod[dt]||[]).length
    );
    for(let i=0; i<maxEntries; i++) rowDefs.push({date:dt, idx:i});
  });

  for(const k of ['stage','beta','prod']){
    const el = document.getElementById('es-'+k);
    if(!esCols[k].length){ el.innerHTML='<div class="empty-state">No analysis yet</div>'; continue; }
    let html = '';
    let prevDate = '';
    rowDefs.forEach((rd, ri) => {
      const entries = byDate[k][rd.date]||[];
      const data = entries[rd.idx];
      // Date header when date changes
      const frozenTs = localStorage.getItem('esFrozenDate') || '';
      const frozenDate = frozenTs.substring(0, 10);
      if(rd.idx===0 && rd.date!==prevDate){
        const isFirst = !prevDate;
        const isFrozen = frozenDate && rd.date < frozenDate;
        const isSameDay = frozenDate && rd.date === frozenDate;
        const isNew = frozenDate && rd.date > frozenDate;
        // For same-day: check if the entry's generated time is after freeze time
        const label = isFrozen ? '🔒 '+rd.date+' (frozen baseline)' : (isNew || isSameDay) ? '📌 '+rd.date+' (new run)' : '📅 '+rd.date;
        const color = isFrozen ? '#888' : (isNew || isSameDay) ? '#66bb6a' : 'var(--accent)';
        const border = isFirst ? '' : 'margin-top:12px;border-top:2px solid '+(isFrozen?'#444':(isNew||isSameDay)?'#66bb6a':'var(--accent)')+';padding-top:8px;';
        const freezeBtn = (!frozenDate && isFirst) ? ' <button onclick="freezeExecSummary(\''+rd.date+'\')" style="font-size:9px;padding:2px 8px;background:#333;color:#4fc3f7;border:1px solid #4fc3f7;border-radius:3px;cursor:pointer;margin-left:8px">🔒 Freeze</button>' : '';
        const unfreezeBtn = (isFrozen && rd.date === frozenDate) ? ' <button onclick="unfreezeExecSummary()" style="font-size:9px;padding:2px 8px;background:#333;color:#ff9800;border:1px solid #ff9800;border-radius:3px;cursor:pointer;margin-left:8px">🔓 Unfreeze</button>' : '';
        html += '<div class="es-row-hdr-'+ri+'" style="'+border+'font-size:15px;font-weight:bold;color:'+color+';margin-bottom:6px">'+label+freezeBtn+unfreezeBtn+'</div>';
      }
      prevDate = rd.date;
      if(data){
        html += '<div class="es-row-'+ri+'">'+renderOneExecSummary(data, ri===0, k)+'</div>';
      } else if(rd.idx === 0){
        html += '<div class="es-row-'+ri+'" style="min-height:40px;border:1px dashed var(--border-subtle);border-radius:8px;margin-bottom:12px;padding:10px;opacity:0.3;font-size:10px;color:var(--fg-dim)">No run on '+rd.date+'</div>';
      } else {
        html += '<div class="es-row-'+ri+'"></div>';
      }
    });
    el.innerHTML = html;
  }
  // Equalize row heights across columns (data rows + date headers)
  for(let i=0; i<rowDefs.length; i++){
    for(const cls of ['.es-row-hdr-'+i, '.es-row-'+i]){
      const rows = document.querySelectorAll(cls);
      if(!rows.length) continue;
      let maxH = 0;
      rows.forEach(r => { r.style.height='auto'; maxH = Math.max(maxH, r.offsetHeight); });
      rows.forEach(r => { r.style.height = maxH+'px'; });
    }
  }

  // Render frozen exec summary columns (dates <= freeze date)
  if(frozenDates.length){
    for(const k of ['stage','beta','prod']){
      const el = document.getElementById('fes-'+k);
      if(!el) continue;
      let html = '';
      frozenDates.forEach((dt, i) => {
        const entries = byDate[k][dt]||[];
        if(entries.length){
          html += '<div style="font-size:11px;color:#888;margin-bottom:4px">'+dt+'</div>';
          entries.forEach(data => { html += renderOneExecSummary(data, i===0, k); });
        }
      });
      el.innerHTML = html || '<div class="empty-state" style="color:#666;font-size:11px">No runs in this period</div>';
    }
  }

  let latestDate='';
  ['stage','beta','prod'].forEach(k=>{if(es[k]&&es[k][0]&&es[k][0].generated>latestDate) latestDate=es[k][0].generated});
  const savedCutoff = localStorage.getItem('jiraCutoffDate') || '';
  const cutoff = savedCutoff || (latestDate ? latestDate.split(' ')[0] : '');
  _lastCutoff=cutoff;
  renderJiraTracker(cutoff);
  renderIssueSummary(cutoff);
}

function jiraRow(t){
  const open=t.status!=='Closed'&&t.status!=='Done'&&t.status!=="Won't Do";
  const sc=open?'#4fc3f7':'#888';
  const isAI=(t.labels||[]).includes('eero-ai-ap-client-metric');
  const rowBg=isAI?'':'background:rgba(79,195,247,0.08);border-left:3px solid #4fc3f7;';
  const res=t.resolution?' <span style="color:#888;font-size:10px">('+t.resolution+')</span>':'';
  const prLink=t.pr_url?' <a href="'+t.pr_url+'" target="_blank" style="color:#66bb6a;font-size:10px">🔗 PR</a>':'';
  const dupLink=t.dup_of?' <a href="https://eeroinc.atlassian.net/browse/'+t.dup_of+'" target="_blank" style="color:#888;font-size:10px">→ '+t.dup_of+'</a>':'';
  const lbls=(t.labels||[]).map(l=>'<span style="background:'+(l==='eero-ai-ap-client-metric'?'#4fc3f733':'#333')+';color:'+(l==='eero-ai-ap-client-metric'?'#ffeb3b':'inherit')+';'+(l==='eero-ai-ap-client-metric'?'font-weight:bold;text-shadow:0 0 6px #ffeb3b,0 0 12px #ffeb3b88;':'')+'padding:1px 4px;border-radius:2px;font-size:9px">'+l+'</span>').join(' ');
  return '<tr style="border-bottom:1px solid var(--border-subtle);'+rowBg+'">'
    +'<td style="padding:6px;white-space:nowrap"><a href="https://eeroinc.atlassian.net/browse/'+t.key+'" target="_blank" style="color:'+sc+';font-weight:bold">'+t.key+'</a></td>'
    +'<td style="padding:6px">'+t.metric+'</td>'
    +'<td style="padding:6px;min-width:300px">'+t.summary.replace(/\[(Prod|Beta|Stage)\]\s*/,'')+'</td>'
    +'<td style="padding:6px;color:'+sc+'">'+t.status+res+prLink+dupLink+'</td>'
    +'<td style="padding:6px">'+(t.assignee||'<span style="color:#888">unassigned</span>')+'</td>'
    +'<td style="padding:6px;font-size:10px">'+t.created+'</td>'
    +'<td style="padding:6px">'+lbls+'</td></tr>';
}
function jiraTable(tickets){
  if(!tickets.length) return '<div style="color:var(--fg-dim);font-size:12px;padding:8px">None</div>';
  // Sort: To Do/Triage → In Progress → Done → Won't Do → Duplicate
  const statusOrder={'To Do':0,'Triage':0,'Open':0,'In Progress':1,'Done':2,"Won't Do":3,'Duplicate':4,'Closed':5};
  tickets.sort((a,b)=>(statusOrder[a.status]??9)-(statusOrder[b.status]??9));
  let h='<table style="width:100%;border-collapse:collapse;font-size:12px"><tr style="border-bottom:2px solid var(--border-subtle)">';
  ['Jira','Metric','Summary','Status','Assignee','Created','Labels'].forEach(c=>{h+='<th style="text-align:left;padding:6px;color:var(--accent)">'+c+'</th>'});
  h+='</tr>';
  tickets.forEach(t=>{h+=jiraRow(t)});
  return h+'</table>';
}
function renderIssueSummary(cutoff){
  const el = document.getElementById('issue-summary');
  if(!el || !_apJiras.length) { if(el) el.innerHTML=''; return; }

  const dp = document.getElementById('jira-cutoff-date');
  const cutoffDate = cutoff || '';

  // Categorize all tickets
  const newOpen={prod:[],beta:[],stage:[],other:[]};
  const oldTickets={prod:[],beta:[],stage:[],other:[]};
  let winsCount=0, winTickets=[], closedTickets=[];

  _apJiras.forEach(t=>{
    const s=t.status||'', r=(t.resolution||'').toLowerCase(), sum=t.summary||'';
    const cat=sum.includes('[Prod]')?'prod':sum.includes('[Beta]')?'beta':sum.includes('[Stage]')?'stage':'other';
    const isClosed=s==='Done'||s==='Closed'||s==='Resolved'||s==="Won't Do"||s==='Duplicate';
    const resolvedDate = t.resolved || t.created || '';

    if((r==='code changed'||r==='duplicate')&&t.has_pr){ if(!cutoffDate||resolvedDate>=cutoffDate){winsCount++;winTickets.push(t)} return; }
    if(isClosed){ if(!cutoffDate||resolvedDate>=cutoffDate) closedTickets.push(t); return; }

    // Open ticket
    if(cutoffDate && t.created>=cutoffDate){
      newOpen[cat].push(t);
    } else {
      oldTickets[cat].push(t);
    }
  });

  const frozenDate = localStorage.getItem('esFrozenDate') || '';
  let h='<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">';
  h+='<b style="font-size:15px">'+(frozenDate?'📌 Current Run Summary':'📋 AP-Client metrics weekly summary')+'</b>';
  h+='<label style="font-size:12px;color:var(--fg-dim)">Since: </label>';
  h+='<input type="date" id="jira-cutoff-date" value="'+(cutoffDate||'')+'" style="background:var(--bg-elevated);color:var(--fg);border:1px solid var(--border-subtle);border-radius:4px;padding:3px 6px;font-size:12px" onchange="applyJiraCutoff()">';
  if(frozenDate){
    h+='<span style="font-size:11px;color:#888;margin-left:8px">🔒 Frozen:</span>';
    h+=' <input type="datetime-local" value="'+(frozenDate.replace('Z','').substring(0,16))+'" onchange="updateFreezeTime(this.value)" style="background:var(--bg-elevated);color:var(--fg);border:1px solid var(--border-subtle);border-radius:4px;padding:2px 6px;font-size:11px">';
    h+=' <button onclick="unfreezeExecSummary()" style="font-size:10px;padding:2px 8px;background:#333;color:#ff9800;border:1px solid #ff9800;border-radius:3px;cursor:pointer">🔓 Unfreeze</button>';
  } else {
    h+=' <button onclick="freezeExecSummary(new Date().toISOString().substring(0,10))" style="font-size:10px;padding:2px 8px;background:#333;color:#4fc3f7;border:1px solid #4fc3f7;border-radius:3px;cursor:pointer">🔒 Freeze current</button>';
  }
  h+='</div>';

  // New issues
  const hasNew=newOpen.prod.length||newOpen.beta.length||newOpen.stage.length||newOpen.other.length;
  if(hasNew){
    h+='<div style="margin-bottom:10px"><b style="color:#66bb6a">🆕 New issues since '+cutoffDate+'</b></div>';
    [['🌍 Prod','prod'],['👥 Beta','beta'],['🧪 Stage','stage']].forEach(([label,k])=>{
      if(newOpen[k].length){
        h+='<div style="margin-left:8px;margin-bottom:6px"><b style="color:#aaa;font-size:12px">'+label+':</b></div>';
        newOpen[k].forEach(t=>{
          const sum=t.summary.replace(/\[(Prod|Beta|Stage)\]\s*/,'').replace(/^(Stage|Beta|Prod):\s*/,'');
          h+='<div style="margin-left:16px;font-size:12px;margin-bottom:2px">• '+sum+' <a href="https://eeroinc.atlassian.net/browse/'+t.key+'" target="_blank" style="color:var(--accent)">['+t.key+']</a></div>';
        });
      } else {
        h+='<div style="margin-left:8px;font-size:12px;color:#888;margin-bottom:4px"><b style="color:#aaa;font-size:12px">'+label+':</b> no new issues</div>';
      }
    });
  } else if(cutoffDate){
    h+='<div style="margin-bottom:10px;color:#66bb6a"><b>🆕 No new issues since '+cutoffDate+'</b></div>';
  }

  // Old issues summary
  const jiraBase='https://eeroinc.atlassian.net/issues/?jql=';
  const jiraLabels='project%3DCONN%20AND%20labels%20in%20(ap-client-metrics-review%2Ceero-ai-ap-client-metric)';
  function jiraLink(status, catTag){
    const s=encodeURIComponent('"'+status+'"');
    const c=catTag?'%20AND%20summary%20~%20%22%5B'+catTag+'%5D%22':'';
    return jiraBase+jiraLabels+'%20AND%20status%3D'+s+c+'%20ORDER%20BY%20created%20DESC';
  }
  function jiraLinkMulti(statuses, catTag){
    const s=statuses.map(st=>encodeURIComponent('"'+st+'"')).join('%2C');
    const c=catTag?'%20AND%20summary%20~%20%22%5B'+catTag+'%5D%22':'';
    return jiraBase+jiraLabels+'%20AND%20status%20in%20('+s+')'+c+'%20ORDER%20BY%20created%20DESC';
  }
  h+='<div style="margin-top:8px"><b style="color:#ff9800">📋 Current Status</b></div>';
  [['🌍 Prod','prod','Prod'],['👥 Beta','beta','Beta'],['🧪 Stage','stage','Stage'],['📦 Other','other','']].forEach(([label,k,tag])=>{
    const allOpen=[...newOpen[k],...oldTickets[k]];
    if(!allOpen.length) return;
    const todo=allOpen.filter(t=>t.status==='To Do'||t.status==='Open').length;
    const triage=allOpen.filter(t=>t.status==='Triage').length;
    const ip=allOpen.filter(t=>t.status==='In Progress').length;
    const inPR=allOpen.filter(t=>t.status==='In Pull Request'||t.status==='In Review').length;
    const unassigned=allOpen.filter(t=>!t.assignee).length;
    const p0=allOpen.filter(t=>(t.priority||'').startsWith('P0')).length;
    const parts=[];
    if(todo) parts.push('<a href="'+jiraLinkMulti(['To Do','Open'],tag)+'" target="_blank" style="color:#4fc3f7">To Do ['+todo+']</a>');
    if(triage) parts.push('<a href="'+jiraLink('Triage',tag)+'" target="_blank" style="color:#ffb74d">Triage ['+triage+']</a>');
    if(ip) parts.push('<a href="'+jiraLink('In Progress',tag)+'" target="_blank" style="color:#4fc3f7">In Progress ['+ip+']</a>');
    if(inPR) parts.push('<a href="'+jiraLinkMulti(['In Pull Request','In Review'],tag)+'" target="_blank" style="color:#66bb6a">In PR ['+inPR+']</a>');
    if(unassigned) parts.push('<span style="color:#ff6b6b">Unassigned ['+unassigned+']</span>');
    if(p0) parts.push('<span style="color:#ff6b6b;font-weight:bold">P0 ['+p0+']</span>');
    h+='<div style="margin-left:8px;font-size:12px;margin-bottom:2px">'+label+': '+parts.join(', ')+'</div>';
    // P0 ticket details
    const p0Tickets=allOpen.filter(t=>(t.priority||'').startsWith('P0'));
    if(p0Tickets.length){
      p0Tickets.forEach(t=>{
        const sum=t.summary.replace(/\[(Prod|Beta|Stage)\]\s*/,'').replace(/^(Stage|Beta|Prod):\s*/,'');
        h+='<div style="margin-left:20px;font-size:11px;margin-bottom:2px;border-left:2px solid #ff6b6b;padding-left:6px">🚨 <a href="https://eeroinc.atlassian.net/browse/'+t.key+'" target="_blank" style="color:#ff6b6b;font-weight:bold">'+t.key+'</a> — '+sum+' <span style="color:#888">['+t.status+(t.assignee?' · '+t.assignee:' · <span style=color:#ff6b6b>unassigned</span>')+']</span></div>';
      });
    }
  });

  // Wins + Closed
  if(winsCount){
    const winsUrl=jiraBase+jiraLabels+'%20AND%20resolution%3D%22Code%20Changed%22%20ORDER%20BY%20created%20DESC';
    h+='<div style="margin-top:8px;font-size:12px;color:#66bb6a"><b>🏆 <a href="'+winsUrl+'" target="_blank" style="color:#66bb6a">Wins since '+cutoffDate+' ['+winsCount+']</a></b>';
    h+=winTickets.map(t=>{
      let s=' <a href="https://eeroinc.atlassian.net/browse/'+t.key+'" target="_blank" style="color:#66bb6a;font-weight:normal;font-size:11px">'+t.key+'</a>';
      if(t.dup_of) s+='<span style="color:#888;font-size:10px"> (dup of <a href="https://eeroinc.atlassian.net/browse/'+t.dup_of+'" target="_blank" style="color:#4fc3f7;font-size:10px">'+t.dup_of+'</a>)</span>';
      return s;
    }).join('');
    h+='</div>';
  }
  if(closedTickets.length){
    const closedUrl=jiraBase+jiraLabels+'%20AND%20status%20in%20(%22Done%22%2C%22Won%27t%20Do%22%2C%22Duplicate%22)%20AND%20resolutiondate%20%3E%3D%20%22'+cutoffDate+'%22%20ORDER%20BY%20resolutiondate%20DESC';
    h+='<div style="font-size:12px;color:#888;margin-top:4px">✅ <a href="'+closedUrl+'" target="_blank" style="color:#888">Closed since '+cutoffDate+' ['+closedTickets.length+']</a></div>';
    closedTickets.forEach(t=>{
      const sum=t.summary.replace(/\[(Prod|Beta|Stage)\]\s*/,'').replace(/^(Stage|Beta|Prod):\s*/,'');
      const res=t.resolution?' ('+t.resolution+')':'';
      h+='<div style="margin-left:16px;font-size:11px;color:#888;margin-bottom:1px">• '+sum+res+' <a href="https://eeroinc.atlassian.net/browse/'+t.key+'" target="_blank" style="color:#888">['+t.key+']</a></div>';
    });
  }

  h+='<div style="margin-top:10px"><button onclick="copySummary()" style="background:#333;color:#4fc3f7;border:1px solid #4fc3f7;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:11px">📋 Copy to clipboard</button></div>';

  el.innerHTML=h;

}

function freezeExecSummary(date){
  const el = document.getElementById("issue-summary");
  if(!el) return;
  const payload = {
    frozen: true,
    frozenDate: new Date().toISOString(),
    sinceDate: localStorage.getItem("jiraCutoffDate") || date,
    html: el.innerHTML
  };
  fetch("/api/freeze-summary", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload)});
  localStorage.setItem("jiraCutoffDate", date);
  localStorage.setItem("esFrozenDate", new Date().toISOString());
  loadAll();
}
function unfreezeExecSummary(){
  localStorage.removeItem("esFrozenDate");
  fetch("/api/freeze-summary", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({remove_index:0})}).then(()=>loadAll());
}
function updateFreezeTime(val){
  if(val) localStorage.setItem("esFrozenDate", val+":00.000Z");
  loadAll();
}
function showFrozenSummary(){
  const frozenDiv = document.getElementById("frozen-summary");
  if(!frozenDiv) return;
  fetch(harmonyUrl("/api/frozen-summary")).then(r=>r.json()).then(history=>{
    if(!Array.isArray(history) || !history.length){ frozenDiv.style.display="none"; return; }
    frozenDiv.style.display="block";
    let html = '';
    history.forEach((data, idx) => {
      if(!data.frozen || !data.html) return;
      html += '<div style="margin-bottom:16px;padding:12px;background:#0a0a1a;border:1px solid #555;border-radius:8px">';
      html += '<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">';
      html += '<b style="font-size:13px;color:#ff9800">🔒 Frozen — since '+(data.sinceDate||'?')+' to '+(data.frozenDate||'?')+'</b>';
      html += '<button onclick="removeFrozen('+idx+')" style="font-size:9px;padding:2px 6px;background:#333;color:#888;border:1px solid #555;border-radius:3px;cursor:pointer">✕ Remove</button>';
      html += '</div>';
      html += '<div style="opacity:0.85;font-size:12px">'+data.html+'</div>';
      html += '</div>';
    });
    frozenDiv.innerHTML = html;
    // Set esFrozenDate from latest frozen entry for column splitting
    if(!localStorage.getItem('esFrozenDate') && history[0].frozenDate){
      localStorage.setItem('esFrozenDate', history[0].frozenDate+'T23:59:59.000Z');
    }
  }).catch(()=>{ frozenDiv.style.display="none"; });
}
function removeFrozen(idx){
  if(!confirm('Remove this frozen summary?')) return;
  fetch('/api/freeze-summary',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({remove_index:idx})}).then(()=>loadAll());
}

function copySummary(){
  const el=document.getElementById('issue-summary');
  if(!el) return;
  const tmp=document.createElement('div');
  tmp.innerHTML=el.innerHTML;
  tmp.style.cssText='position:fixed;left:-9999px;background:#fff;color:#222;font-family:Arial,sans-serif;font-size:13px;padding:12px;line-height:1.6';
  // Remove button and input
  tmp.querySelectorAll('button,input').forEach(b=>b.remove());
  // Fix all colors for email
  tmp.querySelectorAll('*').forEach(n=>{
    n.style.color='#222';
    n.style.background='transparent';
    n.style.textShadow='none';
    if(n.tagName==='A') n.style.color='#0055cc';
  });
  // Indent bullet items for email
  tmp.querySelectorAll('div').forEach(d=>{
    const t=d.textContent.trim();
    if(t.startsWith('•') || t.charCodeAt(0)===8226){
      d.style.marginLeft='32px';
      d.style.color='#222';
    }
  });
  // Also handle any remaining • that are direct text nodes
  tmp.innerHTML=tmp.innerHTML.replace(/>•\s/g,'>&nbsp;&nbsp;&nbsp;&nbsp;• ');
  document.body.appendChild(tmp);
  const range=document.createRange();
  range.selectNodeContents(tmp);
  const sel=window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  document.execCommand('copy');
  sel.removeAllRanges();
  document.body.removeChild(tmp);
  const btn=el.querySelector('button');
  if(btn){btn.textContent='✅ Copied!';btn.style.background='#228B22';btn.style.color='#fff';btn.style.borderColor='#228B22';
    setTimeout(()=>{btn.textContent='📋 Copy to clipboard';btn.style.background='#333';btn.style.color='#4fc3f7';btn.style.borderColor='#4fc3f7'},2000)}
}

function renderJiraTracker(cutoff){
  const cutoffDate = cutoff || localStorage.getItem('jiraCutoffDate') || '';
  // Restore date picker
  const dp = document.getElementById('jira-cutoff-date');
  if(dp && cutoffDate && !dp.value) dp.value = cutoffDate;

  const wins=[], open=[], closed=[], newIssues=[];
  _apJiras.forEach(t=>{
    const s = t.status||'';
    const r = (t.resolution||'').toLowerCase();
    const isClosed = s==='Done' || s==='Closed' || s==='Resolved' || s==="Won't Do" || s==='Duplicate';

    // Wins: Code Changed or Duplicate with merged PR (only since cutoff)
    if((r === 'code changed' || r === 'duplicate') && t.has_pr){
      if(!cutoffDate || t.created >= cutoffDate) wins.push(t);
      else closed.push(t);
    } else if(isClosed){
      if(!cutoffDate || t.created >= cutoffDate) closed.push(t);
    } else {
      // Open ticket — check if new since cutoff
      if(cutoffDate && t.created >= cutoffDate){
        newIssues.push(t);
      } else {
        open.push(t);
      }
    }
  });
  const statusOrder={'To Do':0,'Triage':0,'Open':0,'In Progress':1};
  open.sort((a,b)=>(statusOrder[a.status]??9)-(statusOrder[b.status]??9));
  newIssues.sort((a,b)=>(b.created||'').localeCompare(a.created||''));
  const resOrder={'Operational Change':0,'Passively Resolved':1,'Not a Bug':2,'Duplicate':3};
  closed.sort((a,b)=>(resOrder[a.resolution]??5)-(resOrder[b.resolution]??5));

  let h='<table style="width:100%;border-collapse:collapse;font-size:12px">';
  h+='<tr style="border-bottom:2px solid var(--border-subtle)">';
  ['Jira','Metric','Summary','Status','Assignee','Created','Labels'].forEach(c=>{h+='<th style="text-align:left;padding:6px;color:var(--accent)">'+c+'</th>'});
  h+='</tr>';

  function sectionHeader(icon, title, count, color){
    return '<tr><td colspan="7" style="padding:12px 6px 6px;font-size:14px;font-weight:bold;color:'+color+';border-top:1px solid var(--border-subtle)">'+icon+' '+title+' ('+count+')</td></tr>';
  }

  if(newIssues.length){
    h+=sectionHeader('🆕','New Since Last Review — '+cutoffDate, newIssues.length, '#66bb6a');
    const newBycat={stage:[],beta:[],prod:[],other:[]};
    newIssues.forEach(t=>{
      const s=t.summary||'';
      if(s.includes('[Stage]')) newBycat.stage.push(t);
      else if(s.includes('[Beta]')) newBycat.beta.push(t);
      else if(s.includes('[Prod]')) newBycat.prod.push(t);
      else newBycat.other.push(t);
    });
    [['🌍 Prod','prod'],['👥 Beta','beta'],['🧪 Stage','stage'],['Other','other']].forEach(([label,k])=>{
      if(newBycat[k].length){
        h+='<tr><td colspan="7" style="padding:6px;font-size:12px;font-weight:bold;color:#aaa;background:var(--bg-elevated)">'+label+' ('+newBycat[k].length+')</td></tr>';
        newBycat[k].forEach(t=>{h+=jiraRow(t)});
      }
    });
  }

  if(wins.length){
    h+=sectionHeader('🏆','Wins — Code Changed + Merged PR', wins.length, '#66bb6a');
    wins.forEach(t=>{h+=jiraRow(t)});
  }

  h+=sectionHeader('📋','Open Tickets', open.length, '#ff9800');
  const openBycat={stage:[],beta:[],prod:[],other:[]};
  open.forEach(t=>{
    const s=t.summary||'';
    if(s.includes('[Stage]')) openBycat.stage.push(t);
    else if(s.includes('[Beta]')) openBycat.beta.push(t);
    else if(s.includes('[Prod]')) openBycat.prod.push(t);
    else openBycat.other.push(t);
  });
  [['🌍 Prod','prod'],['👥 Beta','beta'],['🧪 Stage','stage'],['Other','other']].forEach(([label,k])=>{
    if(openBycat[k].length){
      h+='<tr><td colspan="7" style="padding:6px;font-size:12px;font-weight:bold;color:#aaa;background:var(--bg-elevated)">'+label+' ('+openBycat[k].length+')</td></tr>';
      openBycat[k].forEach(t=>{h+=jiraRow(t)});
    }
  });

  h+=sectionHeader('✅','Closed', closed.length, '#888');
  closed.forEach(t=>{h+=jiraRow(t)});

  h+='</table>';

  document.getElementById('jira-new-body').innerHTML=h;
  document.getElementById('jira-old-section').style.display='none';
}

function applyJiraCutoff(){
  const d = document.getElementById('jira-cutoff-date').value;
  if(d) localStorage.setItem('jiraCutoffDate', d);
  renderJiraTracker(d);
  renderIssueSummary(d);
}

async function refreshRun(runName){
  const runDir = '/home/bharatmk/myeeroai_results/_shared/ap_client_health/' + runName;
  const v1 = '/home/bharatmk/bharat_sandbox/myeeroai_web_v1';
  const cmd = 'python3 '+v1+'/ap_client_health/07_refresh.py '+runDir;
  const r = await fetch('/api/run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:cmd})});
  alert('Refreshing dashboard + exec summary...\nReload page in ~30s');
}

async function refreshJiras(){
  const btn=document.getElementById('jira-refresh-btn');
  btn.disabled=true; btn.textContent='⏳ Refreshing...';
  try{
    const jr=await api('GET','/api/ap-client-jiras?refresh=1');
    if(jr.tickets) _apJiras=jr.tickets||[];
    renderJiraTracker(_lastCutoff||'');
    btn.textContent='✅ Updated';
    setTimeout(()=>{btn.textContent='🔄 Refresh from Jira'},2000);
  }catch(e){
    console.error('refresh jiras',e);
    btn.textContent='❌ Failed';
    setTimeout(()=>{btn.textContent='🔄 Refresh from Jira'},2000);
  }finally{btn.disabled=false}
}

// --- Tab switching ---
function switchMain(name, el){
  el.parentElement.querySelectorAll('.fh-tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.page-content > .fh-panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+name).classList.add('active');
}

// --- Run with progress ---
const runState={stage:{sid:null,running:false},beta:{sid:null,running:false},prod:{sid:null,running:false}};
const PHASES=['fetch','ppm','analyze','charts','drill','dashboard'];
const PHASE_PATTERNS=[
  {p:'fetch',  re:/01_fetch|Fetching|fetch.*data/i},
  {p:'ppm',    re:/02_ppm|Computing PPM|ppm/i},
  {p:'analyze',re:/03_analyze|Analyzing|regression/i},
  {p:'charts', re:/04_charts|Generating charts|chart/i},
  {p:'drill',  re:/06_network|drill.*down|network drill/i},
  {p:'dashboard',re:/05_dashboard|report_gen|dashboard.*generat/i}
];

let _logEnv='', _logTab='runlog';
async function showLog(env){
  _logEnv=env;
  document.getElementById('log-panel').style.display='block';
  document.getElementById('log-title').textContent='📄 '+env.charAt(0).toUpperCase()+env.slice(1)+' — Last Run';
  switchLogTab('runlog');
}
async function switchLogTab(tab){
  _logTab=tab;
  document.getElementById('tab-runlog').style.background=tab==='runlog'?'#4fc3f7':'#333';
  document.getElementById('tab-runlog').style.color=tab==='runlog'?'#1a1a2e':'#ccc';
  document.getElementById('tab-summary').style.background=tab==='summary'?'#4fc3f7':'#333';
  document.getElementById('tab-summary').style.color=tab==='summary'?'#1a1a2e':'#ccc';
  const el=document.getElementById('log-content');
  el.textContent='Loading...';
  // Find latest run for this env
  const prefix=_logEnv==='prod'?'prod_0':_logEnv==='beta'?'prod_2_3':'stage_0_2';
  try{
    const runsResp=await fetch('/api/fleet-progress');
    const runs=await runsResp.json();
    // Find latest run for this env (sorted by name descending = latest first)
    const matching=runs.filter(r=>r.name.startsWith(prefix)).sort((a,b)=>b.name.localeCompare(a.name));
    const run=matching[0];
    if(!run){el.textContent='No run found for '+_logEnv;return}
    if(tab==='runlog'){
      const resp=await fetch('/api/run-log?run='+run.name+'&tail=10000');
      el.textContent=await resp.text();
    } else {
      const resp=await fetch('/ap-client-metric/'+run.name+'/analysis/fetch_summary.json');
      if(!resp.ok){el.textContent='No fetch_summary.json yet (will be created on next run)';return}
      const data=await resp.json();
      let txt='METRIC                    TYPE        STATUS  ROWS     TIME\n'+'-'.repeat(70)+'\n';
      data.forEach(r=>{txt+=`${(r.metric||'').padEnd(25)} ${(r.type||'').padEnd(11)} ${r.status}  ${String(r.rows||r.detail||'').padEnd(8)} ${r.elapsed||0}s\n`});
      el.textContent=txt;
    }
  }catch(e){el.textContent='Error: '+e.message}
}

async function runSelected(){
  const cats=[];
  if(document.getElementById('runStage').checked) cats.push('stage');
  if(document.getElementById('runBeta').checked) cats.push('beta');
  if(document.getElementById('runProd').checked) cats.push('prod');
  if(!cats.length) return;
  // Run sequentially to avoid overloading the Databricks cluster
  for(const cat of cats){
    const c=CATEGORIES[cat];
    resetProgress(cat);
    updateCardStatus(cat,'running','Running...');
    const inv=document.getElementById('runInvestigate').checked;
    const days=parseInt(document.getElementById('optDays').value)||14;
    const metric=document.getElementById('optMetric').value.trim()||null;
    const noCache=document.getElementById('optNoCache').checked;
    const pyspark=document.getElementById('optPyspark').checked;
    const res=await api('POST','/api/run',{task:'ap_client_health',params:{env:c.env,group_ids:c.gids,investigate:inv,days:days,metric:metric,no_cache:noCache,pyspark:pyspark},user:localStorage.getItem('user')||'anonymous'});
    if(res.preflight_failed){
      let msg='⚠️ Pre-flight check failed:\n\n';
      (res.checks||[]).forEach(c=>{
        msg+=`❌ ${c.name}: ${c.status}\n   Fix: ${c.fix}\n\n`;
      });
      alert(msg);
      updateCardStatus(cat,'error','Auth expired');
      break;
    }
    if(res.sid){
      runState[cat].sid=res.sid;
      runState[cat].running=true;
      runState[cat].offset=0;
      pollProgress(cat);
      // Wait for this run to complete before starting next
      await new Promise(resolve=>{
        const check=setInterval(()=>{
          if(!runState[cat].running){clearInterval(check);resolve()}
        },3000);
      });
    } else {
      updateCardStatus(cat,'error','Failed to start');
    }
  }
}

function resetProgress(cat){
  const card=document.getElementById('rc-'+cat);
  card.querySelectorAll('.phase').forEach(p=>{p.className='phase'});
}

function updateCardStatus(cat, cls, text){
  const label=document.querySelector('#rc-'+cat+' .status-label');
  label.className='status-label status-'+cls;
  label.textContent=text;
}

function setPhase(cat, phaseName, state){
  const card=document.getElementById('rc-'+cat);
  const el=card.querySelector(`.phase[data-p="${phaseName}"]`);
  if(el) el.className='phase '+state;
}

async function pollProgress(cat){
  if(!runState[cat].running) return;
  try{
    const sid=runState[cat].sid;
    const res=await api('GET','/api/output?sid='+sid+'&since='+runState[cat].offset);
  if(res.lines&&res.lines.length){
    runState[cat].offset=res.next;
    const text=res.lines.join('');
    // Detect phases from output
    let lastHit=null;
    PHASE_PATTERNS.forEach(pp=>{
      if(pp.re.test(text)){
        // Mark all previous phases as done
        const idx=PHASES.indexOf(pp.p);
        for(let i=0;i<idx;i++) setPhase(cat,PHASES[i],'done');
        setPhase(cat,pp.p,'active');
        lastHit=pp.p;
      }
    });
  }
  if(!res.running){
    runState[cat].running=false;
    // Check if completed or errored
    const text=(res.lines||[]).join('');
    if(/error|failed|❌/i.test(text)){
      updateCardStatus(cat,'error','Error');
    } else {
      PHASES.forEach(p=>setPhase(cat,p,'done'));
      updateCardStatus(cat,'done','✅ Complete');
    }
    loadAll(); // refresh results
    return;
  }
  setTimeout(()=>pollProgress(cat), 1500);
  }catch(e){ setTimeout(()=>pollProgress(cat), 5000); }
}

// Evidence popup
async function createJira(metric, runName, btn){
  if(!confirm('Create CONN Jira ticket for '+metric+'?\n\nThis will create a ticket with charts + CSV attached, then open it for review.')) return;
  btn.disabled=true; btn.textContent='⏳';
  try{
    const resp=await fetch('/api/jira-create',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run:runName,metric:metric})});
    const data=await resp.json();
    if(data.ok&&data.url){
      btn.textContent='✅'; btn.style.background='#66bb6a';
      btn.onclick=()=>window.open(data.url,'_blank');
      window.open(data.url,'_blank');
    } else {
      btn.textContent='❌'; btn.style.background='#ff6b6b';
      alert('Failed: '+(data.error||'Unknown error'));
    }
  }catch(e){
    btn.textContent='❌'; btn.style.background='#ff6b6b';
    alert('Error: '+e.message);
  }
  btn.disabled=false;
}

function showEvidence(chartBase, metric, relVer){
  let existing=document.getElementById('evidence-modal');
  if(existing) existing.remove();
  const m=document.createElement('div');
  m.id='evidence-modal';
  m.style.cssText='position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.85);z-index:9999;display:flex;align-items:center;justify-content:center';
  m.onclick=e=>{if(e.target===m)m.remove()};
  const dashUrl=chartBase.replace('charts/','dashboard.html?single=1#'+metric);
  let inner='<div style="background:#1a1a2e;border:1px solid #333;border-radius:8px;width:95%;height:90vh;display:flex;flex-direction:column;overflow:hidden">';
  inner+='<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 16px;border-bottom:1px solid #333">';
  inner+='<span style="font-size:14px;font-weight:bold;color:#00d4ff">'+metric+'</span>';
  const verCmpUrl=chartBase+metric+'_ver_compare.html';
  inner+='<a href="'+verCmpUrl+'" target="_blank" style="color:#66bb6a;font-size:12px;text-decoration:underline;margin-left:12px">📊 Version PPM Compare</a>';
  if(relVer){
    const relUrl=chartBase+'release_'+relVer+'_'+metric+'.html';
    inner+='<a href="'+relUrl+'" target="_blank" style="color:#ff9800;font-size:12px;text-decoration:underline;margin-left:12px">🔥 Release '+relVer.replace(/_/g,'.')+' chart</a>';
  }
  inner+='<button onclick="this.closest(\'#evidence-modal\').remove()" style="background:none;border:none;color:#888;font-size:20px;cursor:pointer">✕</button></div>';
  inner+='<iframe src="'+dashUrl+'" style="flex:1;border:none;width:100%"></iframe>';
  inner+='</div>';
  m.innerHTML=inner;
  document.body.appendChild(m);
}

async function pollLiveProgress(){
  try{
    const r = await fetch('/api/fleet-progress');
    const runs = await r.json();
    const el = document.getElementById('live-progress');
    if(!runs.length){el.innerHTML='';return}
    // Only show running or completed (with dashboard) runs
    const visible = runs.filter(r => r.running || r.dashboard);
    function fmtSz(b){if(b>1e9)return (b/1e9).toFixed(1)+'GB';if(b>1e6)return (b/1e6).toFixed(1)+'MB';if(b>1e3)return (b/1e3).toFixed(0)+'KB';return b+'B'}
    let html='<div style="background:var(--bg-elevated,#1a1a2e);border:1px solid #333;border-radius:6px;padding:10px">';
    html+='<div style="color:var(--accent,#4fc3f7);font-weight:bold;margin-bottom:6px">📡 Live Run Status <span style="font-size:10px;color:#666">(auto-refresh 10s)</span></div>';
    for(const run of visible){
      const staleHtml = run.stale ? '<br><span style="color:#ff6b6b;font-size:10px">'+run.stale+'</span>' : '';
      const status = run.running ? '🟢 '+run.step+(run.progress?' <span style="color:#aaa;font-size:10px">'+run.progress+'</span>':'')+staleHtml : (run.dashboard ? '✅ Done' : '⚪ Stopped');
      const color = run.running ? '#1a3a1a' : (run.dashboard ? '#0a1a0a' : '#1a1a1a');
      const kiroBtn = (run.dashboard && !run.running) ? ' <button onclick="runKiroAnalysis(\''+run.name+'\')" style="background:#1a5a1a;color:#fff;border:none;padding:1px 6px;border-radius:3px;cursor:pointer;font-size:10px">🤖 Kiro</button>' : '';
      const logBtn = run.sid ? ' <button onclick="toggleLog(\''+run.sid+'\',this)" style="background:#333;color:#4fc3f7;border:1px solid #4fc3f7;padding:1px 6px;border-radius:3px;cursor:pointer;font-size:10px">📜 Logs</button>' : '';
      const totalSz = run.files.reduce((s,f)=>s+f.size,0);
      html+='<details'+(run.running?' open':'')+'><summary style="cursor:pointer;padding:6px;background:'+color+';border-radius:4px;margin:4px 0;font-size:12px">';
      const deleteBtn = (!run.running) ? ' <button onclick="deleteRun(\''+run.name+'\')" style="background:#333;color:#ff6b6b;border:1px solid #ff6b6b;padding:1px 6px;border-radius:3px;cursor:pointer;font-size:9px">🗑️</button>' : '';
      html+=status+' <b>'+run.name+'</b> | '+run.env+' g'+JSON.stringify(run.groups)+' | '+run.days+'d | '+run.main_done+' metrics, '+run.raw_total+' files ('+fmtSz(totalSz)+')'+kiroBtn+logBtn+deleteBtn+'</summary>';
      html+='<table style="width:100%;font-size:11px;border-collapse:collapse;margin:4px 0 8px 16px">';
      html+='<tr style="color:#666"><td style="padding:2px 6px">File</td><td>Size</td><td>Description</td></tr>';
      for(const f of run.files){
        const isNet=f.name.includes('_by_net');
        const clr=isNet?'#664400':f.name.includes('_by_org')?'#444400':'';
        const bg=f.name===run.latest&&run.running?'background:#1a3a1a':'';
        html+='<tr style="border-bottom:1px solid #1a1a1a;'+(clr?'color:'+clr+';':'')+bg+'">';
        html+='<td style="padding:2px 6px;font-family:monospace">'+(f.name===run.latest&&run.running?'▶ ':'')+f.name+'</td>';
        html+='<td style="text-align:right;padding:2px 6px">'+fmtSz(f.size)+'</td>';
        html+='<td style="padding:2px 6px;color:#888">'+f.desc+'</td></tr>';
      }
      html+='</table>';
      if(run.sid){
        html+='<div id="logwrap-'+run.sid+'" style="display:none;margin:4px 16px 8px">';
        html+='<div style="margin-bottom:4px">';
        html+='<button onclick="sendAccept(\''+run.sid+'\')" style="background:#ff9800;color:#000;border:none;padding:3px 10px;border-radius:3px;cursor:pointer;font-size:11px;font-weight:bold">✅ Accept Trust Prompt</button> ';
        html+='<input id="input-'+run.sid+'" placeholder="Send text to session..." style="background:#1a1a1a;color:#ccc;border:1px solid #444;padding:3px 6px;border-radius:3px;font-size:11px;width:200px" onkeydown="if(event.key===\'Enter\')sendText(\''+run.sid+'\')">';
        html+='</div>';
        html+='<div id="log-'+run.sid+'" style="background:#0a0a0a;border:1px solid #333;border-radius:4px;max-height:300px;overflow-y:auto;font-family:monospace;font-size:11px;padding:8px;white-space:pre-wrap;color:#ccc"></div>';
        html+='</div>';
      }
      html+='</details>';
    }
    html+='</div>';
    el.innerHTML=html;
  }catch(e){}
}
pollLiveProgress();
setInterval(pollLiveProgress, 10000);

// Reconnect run cards to active sessions after page refresh
(async function reconnectActiveRuns(){
  try {
    const r = await fetch('/api/fleet-progress');
    const runs = await r.json();
    for(const run of runs){
      if(!run.running || !run.sid) continue;
      // Match run to category by name prefix
      let cat = null;
      if(run.name.startsWith('stage_')) cat = 'stage';
      else if(run.name.startsWith('prod_2_3_') || run.name.startsWith('prod_2,3_')) cat = 'beta';
      else if(run.name.startsWith('prod_0_')) cat = 'prod';
      if(cat && !runState[cat].running){
        runState[cat].sid = run.sid;
        runState[cat].running = true;
        runState[cat].offset = 0;
        updateCardStatus(cat, 'running', '🟢 ' + (run.step || 'Running...'));
        // Set active phase from step name
        if(run.step){
          PHASE_PATTERNS.forEach(pp => {
            if(pp.re.test(run.step)){
              const idx = PHASES.indexOf(pp.p);
              for(let i=0;i<idx;i++) setPhase(cat, PHASES[i], 'done');
              setPhase(cat, pp.p, 'active');
            }
          });
        }
        pollProgress(cat);
      }
    }
  } catch(e){}
})();

loadAll();

async function deleteRun(name){
  if(!confirm('Delete run "'+name+'"? This removes all data for this run.')) return;
  const r = await fetch('/api/delete-run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name})});
  const d = await r.json();
  if(d.ok) pollLiveProgress();
  else alert('Failed: '+(d.error||'unknown'));
}

async function killFleet(){
  if(!confirm('Kill ALL fleet health processes and cancel Databricks queries?')) return;
  const r = await fetch('/api/kill-fleet',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const d = await r.json();
  alert('Killed: ' + (d.killed||[]).join(', ') + (d.dbx_destroyed ? '\nDatabricks context destroyed' : ''));
  location.reload();
}
async function showProcesses(){
  const r = await fetch('/api/processes',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
  const d = await r.json();
  let msg = d.processes.map(p => 'PID=' + p.pid + ' ' + p.kind + ' ' + p.mem_mb + 'MB ' + Math.round(p.elapsed_s/60) + 'min').join('\n');
  if(!msg) msg = 'No kiro-cli or ap_client_health processes running.';
  if(d.count > 0 && confirm(msg + '\n\nKill orphaned kiro-cli processes?')){
    const k = await fetch('/api/kill-orphans',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    const kd = await k.json();
    alert('Killed ' + kd.killed + ' orphan(s)');
  } else if(d.count === 0) { alert(msg); }
}
async function runKiroAnalysis(runName){
  if(!confirm('Run Kiro AI analysis on ' + runName + '?')) return;
  const r = await fetch('/api/kiro-analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({run:runName})});
  const d = await r.json();
  alert(d.ok ? 'Kiro analysis started. Refresh in a few minutes.' : 'Error: ' + (d.error||'unknown'));
}

// Log viewer
const logPollers = {};
function toggleLog(sid, btn) {
  const el = document.getElementById('logwrap-' + sid);
  if (!el) return;
  const visible = el.style.display !== 'none';
  el.style.display = visible ? 'none' : 'block';
  btn.textContent = visible ? '📜 Logs' : '📜 Hide Logs';
  if (!visible && !logPollers[sid]) {
    logPollers[sid] = { since: 0 };
    pollLog(sid);
  }
  if (visible && logPollers[sid]) {
    delete logPollers[sid];
  }
}

function sendAccept(sid) {
  // Send down-arrow + Enter to select "Yes, I accept"
  fetch('/api/input', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({sid: sid, raw: '1b5b420d'})});  // ESC [ B \r
}

function sendText(sid) {
  const input = document.getElementById('input-' + sid);
  if (!input || !input.value) return;
  fetch('/api/input', {method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({sid: sid, text: input.value})});
  input.value = '';
}

async function pollLog(sid) {
  if (!logPollers[sid]) return;
  try {
    const r = await fetch('/api/output?sid=' + sid + '&since=' + logPollers[sid].since);
    const d = await r.json();
    const el = document.getElementById('log-' + sid);
    if (el && d.lines && d.lines.length) {
      // Strip ANSI escape codes for readability
      const clean = d.lines.join('').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
      el.textContent += clean;
      el.scrollTop = el.scrollHeight;
      logPollers[sid].since = d.next;
    }
    if (d.running !== false) {
      setTimeout(() => pollLog(sid), 3000);
    } else {
      el.textContent += '\n--- Session ended ---\n';
    }
  } catch(e) {
    setTimeout(() => pollLog(sid), 5000);
  }
}

const SCHED_PIPELINE='ap_client_health';
const DAYS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
async function showSchedule(){
  document.getElementById('schedule-modal').style.display='flex';
  const r=await fetch('/api/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'get'})});
  const d=await r.json();
  const list=document.getElementById('schedule-list');
  const scheds=(d.schedules||[]).filter(s=>s.pipeline===SCHED_PIPELINE);
  if(!scheds.length){list.innerHTML='<div style="color:#888;font-size:12px">No schedules configured.</div>';return}
  let h='';
  scheds.forEach((s,i)=>{
    const env=s.env==='prod'&&s.group_ids==='0'?'🌍 Prod':s.env==='prod'?'👥 Beta':'🧪 Stage';
    h+=`<div style="display:flex;align-items:center;gap:8px;margin:4px 0;font-size:12px;padding:6px;background:#222;border-radius:4px">
      <span style="color:${s.enabled?'#66bb6a':'#888'}">${s.enabled?'✅':'⏸️'}</span>
      <span>${env}</span><span style="color:#4fc3f7">${DAYS[s.day]} ${String(s.hour).padStart(2,'0')}:${String(s.minute).padStart(2,'0')}</span>
      <button onclick="toggleSchedule(${i})" style="margin-left:auto;font-size:10px;background:#333;color:#fff;border:1px solid #555;padding:2px 6px;border-radius:3px;cursor:pointer">${s.enabled?'Pause':'Enable'}</button>
      <button onclick="deleteSchedule(${i})" style="font-size:10px;background:#333;color:#ff6b6b;border:1px solid #ff6b6b;padding:2px 6px;border-radius:3px;cursor:pointer">✕</button>
    </div>`;
  });
  list.innerHTML=h;
}
async function addSchedule(){
  const[env,gids]=document.getElementById('sched-env').value.split(':');
  const day=parseInt(document.getElementById('sched-day').value);
  const[hour,minute]=document.getElementById('sched-time').value.split(':').map(Number);
  const r=await fetch('/api/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'get'})});
  const d=await r.json();
  const scheds=d.schedules||[];
  scheds.push({pipeline:SCHED_PIPELINE,env,group_ids:gids,day,hour,minute,enabled:true});
  await fetch('/api/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',schedules:scheds})});
  showSchedule();
}
async function toggleSchedule(idx){
  const r=await fetch('/api/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'get'})});
  const d=await r.json();const scheds=d.schedules||[];
  if(scheds[idx])scheds[idx].enabled=!scheds[idx].enabled;
  await fetch('/api/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',schedules:scheds})});
  showSchedule();
}
async function deleteSchedule(idx){
  if(!confirm('Delete this schedule?'))return;
  const r=await fetch('/api/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'get'})});
  const d=await r.json();const scheds=d.schedules||[];
  scheds.splice(idx,1);
  await fetch('/api/schedule',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'save',schedules:scheds})});
  showSchedule();
}

