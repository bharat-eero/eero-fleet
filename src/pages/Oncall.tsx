import React, { useEffect, useState } from 'react';

interface OncallReport {
  filename: string;
  date: string;
  url: string;
  ticket_count?: number;
}

export default function Oncall() {
  const [reports, setReports] = useState<OncallReport[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/eero-fleet/data/oncall_index.json')
      .then(r => r.json())
      .then(data => {
        setReports(Array.isArray(data) ? data : data.reports || []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div style={{maxWidth:'900px',margin:'0 auto',padding:'20px'}}>
      <h1 style={{color:'#58a6ff',fontSize:'20px'}}>📋 On-Call Triage Reports</h1>
      <p style={{color:'#8b949e',fontSize:'13px',marginBottom:'20px'}}>
        Daily triage reports from the on-call dashboard. Read-only suggestions — never modifies tickets.
      </p>

      {loading && <div style={{color:'#58a6ff',fontSize:'13px'}}>⏳ Loading reports...</div>}

      {!loading && reports.length === 0 && (
        <div style={{background:'#161b22',border:'1px solid #30363d',borderRadius:'8px',padding:'24px',textAlign:'center'}}>
          <div style={{fontSize:'24px',marginBottom:'8px'}}>📭</div>
          <div style={{color:'#8b949e',fontSize:'13px'}}>No on-call reports available yet.</div>
          <div style={{color:'#6e7681',fontSize:'11px',marginTop:'4px'}}>Reports are generated during on-call triage sessions.</div>
        </div>
      )}

      {!loading && reports.length > 0 && (
        <div style={{display:'flex',flexDirection:'column',gap:'8px'}}>
          {reports.map((report, i) => (
            <a
              key={i}
              href={report.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display:'flex',
                alignItems:'center',
                gap:'12px',
                background:'#161b22',
                border:'1px solid #30363d',
                borderRadius:'8px',
                padding:'12px 16px',
                textDecoration:'none',
                transition:'border-color 0.2s',
              }}
            >
              <span style={{fontSize:'18px'}}>📄</span>
              <div style={{flex:1}}>
                <div style={{color:'#c9d1d9',fontSize:'13px',fontWeight:'bold'}}>{report.date || report.filename}</div>
                {report.ticket_count !== undefined && (
                  <div style={{color:'#8b949e',fontSize:'11px',marginTop:'2px'}}>{report.ticket_count} ticket(s) triaged</div>
                )}
              </div>
              <span style={{color:'#58a6ff',fontSize:'12px'}}>Open →</span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
