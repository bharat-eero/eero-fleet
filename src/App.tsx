import React from 'react';
import { BrowserRouter, Routes, Route, Link } from 'react-router-dom';
import Home from './pages/Home';
import FleetHealth from './pages/FleetHealth';
import ApClientHealth from './pages/ApClientHealth';
import Oncall from './pages/Oncall';

export default function App() {
  return (
    <BrowserRouter basename="/eero-fleet">
      <nav style={{background:'#161b22',padding:'12px 24px',borderBottom:'1px solid #30363d',display:'flex',gap:'20px',alignItems:'center'}}>
        <span style={{fontSize:'18px',fontWeight:'bold',color:'#58a6ff'}}>📊 eero Fleet Health</span>
        <Link to="/" style={{color:'#c9d1d9',textDecoration:'none',fontSize:'14px'}}>Home</Link>
        <Link to="/fleet-health" style={{color:'#c9d1d9',textDecoration:'none',fontSize:'14px'}}>Fleet Health</Link>
        <Link to="/ap-client" style={{color:'#c9d1d9',textDecoration:'none',fontSize:'14px'}}>AP-Client</Link>
        <Link to="/oncall" style={{color:'#c9d1d9',textDecoration:'none',fontSize:'14px'}}>On-Call</Link>
      </nav>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/fleet-health" element={<FleetHealth />} />
        <Route path="/ap-client" element={<ApClientHealth />} />
        <Route path="/oncall" element={<Oncall />} />
      </Routes>
    </BrowserRouter>
  );
}
