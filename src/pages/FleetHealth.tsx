import React, { useEffect, useState } from 'react';

interface ExecEntry { generated: string; dashboard_url: string; summary_url: string; fleet_regression?: any[]; network_concentrated?: any[]; improving?: any[]; }

export default function FleetHealth() {
  const [summaries, setSummaries] = useState<Record<string, ExecEntry[]>>({});
  const [jiras, setJiras] = useState<any[]>([]);
  const [jiraStatus, setJiraStatus] = useState('loading');

  useEffect(() => {
    fetch('/eero-fleet/data/exec_summary.json').then(r=>r.json()).then(setSummaries).catch(()=>{});
    fetch('/eero-fleet/data/jira_mesh.json').then(r=>r.json()).then(d=>{
      setJiras(d.tickets||[]);
      setJiraStatus('done');
    }).catch(()=>setJiraStatus('error'));
  }, []);

  return (
    <div style={{maxWidth:'98%',margin:'0 auto',padding:'20px'}}>
      <h1 style={{color:'#58a6ff',fontSize:'20px'}}>🏥 Fleet Health Check</h1>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'16px',marginTop:'20px'}}>
        <Column title="🧪 Stage" data={summaries.stage} jiras={jiras} />
        <Column title="👥 Beta" data={summaries.beta} jiras={jiras} />
        <Column title="🌍 Prod" data={summaries.prod} jiras={jiras} />
      </div>
      {jiraStatus === 'done' && <div style={{marginTop:'12px',color:'#3fb950',fontSize:'13px'}}>✅ {jiras.length} Jira tickets synced</div>}
      {jiraStatus === 'loading' && <div style={{marginTop:'12px',color:'#58a6ff',fontSize:'13px'}}>⏳ Loading Jira tickets...</div>}
    </div>
  );
}

function Column({title,data,jiras}:{title:string,data?:ExecEntry[],jiras:any[]}) {
  if(!data||!data.length) return (
    <div><h3 style={{color:'#8b949e'}}>{title}</h3><p style={{color:'#6e7681',fontSize:'13px'}}>No data yet</p></div>
  );
  const latest = data[0];
  return (
    <div>
      <h3 style={{color:'#c9d1d9',fontSize:'14px'}}>{title}</h3>
      <div style={{background:'#161b22',border:'2px solid #58a6ff',borderRadius:'8px',padding:'12px',marginTop:'8px'}}>
        <div style={{fontSize:'11px',color:'#8b949e',marginBottom:'8px'}}>{latest.generated} <b style={{color:'#58a6ff'}}>(latest)</b></div>
        <a href={latest.dashboard_url} target="_blank" style={{color:'#58a6ff',fontSize:'12px',marginRight:'12px'}}>📊 Dashboard</a>
        <a href={latest.summary_url} target="_blank" style={{color:'#58a6ff',fontSize:'12px'}}>📋 Summary</a>
        {latest.fleet_regression && latest.fleet_regression.length > 0 && (
          <div style={{marginTop:'8px',color:'#ff6b6b',fontSize:'11px'}}>🔴 {latest.fleet_regression.length} regression(s)</div>
        )}
        {(!latest.fleet_regression || latest.fleet_regression.length === 0) && (
          <div style={{marginTop:'8px',color:'#3fb950',fontSize:'11px'}}>✅ Fleet healthy</div>
        )}
      </div>
    </div>
  );
}
