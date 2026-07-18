import React from 'react';
import { Link } from 'react-router-dom';

export default function Home() {
  return (
    <div style={{maxWidth:'1100px',margin:'60px auto',padding:'0 20px',textAlign:'center'}}>
      <h1 style={{fontSize:'34px',color:'#58a6ff',marginBottom:'8px'}}>📊 eero Fleet Health</h1>
      <p style={{color:'#8b949e',marginBottom:'40px'}}>Read-only dashboards · Powered by Kiro</p>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'18px'}}>
        <Card icon="🏥" title="Fleet Health" desc="Monitor fleet-wide regression metrics — PPM trends, version analysis, network drill-down." link="/fleet-health" />
        <Card icon="📡" title="AP-Client Health" desc="Monitor AP-Client metrics — associations, deauth, disassoc, 4-way handshake failures." link="/ap-client" />
        <Card icon="📋" title="On-Call Triage" desc="Process dogfood triage queue, analyze Jira tickets with node/phone logs." link="/oncall" />
      </div>
    </div>
  );
}

function Card({icon,title,desc,link}:{icon:string,title:string,desc:string,link:string}) {
  return (
    <Link to={link} style={{textDecoration:'none'}}>
      <div style={{background:'#161b22',border:'1px solid #30363d',borderRadius:'12px',padding:'24px',textAlign:'left',transition:'border-color 0.2s',cursor:'pointer'}}>
        <div style={{fontSize:'24px',marginBottom:'8px'}}>{icon}</div>
        <div style={{fontSize:'16px',fontWeight:'bold',color:'#c9d1d9',marginBottom:'8px'}}>{title}</div>
        <div style={{fontSize:'13px',color:'#8b949e'}}>{desc}</div>
      </div>
    </Link>
  );
}
