/* Theme management — include in every page */
function initTheme(){
  const t=localStorage.getItem('theme')||'aurora';
  document.documentElement.setAttribute('data-theme',t);
  document.querySelectorAll('.theme-btn').forEach(b=>{
    b.classList.toggle('active',b.dataset.t===t);
    b.onclick=()=>setTheme(b.dataset.t);
  });
}
function setTheme(t){
  document.documentElement.setAttribute('data-theme',t);
  localStorage.setItem('theme',t);
  document.querySelectorAll('.theme-btn').forEach(b=>b.classList.toggle('active',b.dataset.t===t));
}
function themeHTML(){
  return '<div class="theme-selector">'
    +'<button class="theme-btn" data-t="dark" title="Dark"></button>'
    +'<button class="theme-btn" data-t="light" title="Light"></button>'
    +'<button class="theme-btn" data-t="cyberpunk" title="Cyberpunk"></button>'
    +'<button class="theme-btn" data-t="solarized" title="Solarized"></button>'
    +'<button class="theme-btn" data-t="aurora" title="Aurora"></button>'
    +'</div>';
}
document.addEventListener('DOMContentLoaded',()=>{
  initTheme();
  const u=localStorage.getItem('user')||'anonymous';
  fetch('/api/visit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({user:u,page:location.pathname})}).catch(()=>{});
});
