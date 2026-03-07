'use strict';

/* ──────────────────────── Constants & State ──────────────────────── */
const API   = 'http://localhost:5000';
let _jwt    = null;
let _user   = null;
let _charts = {};
let _refreshTimer = null;
let _customerProjects = [];
let _analyticsProjectId = null;

/* ──────────────────────── API Helper ─────────────────────────────── */
async function api(path, opts = {}) {
  const res = await fetch(API + path, {
    method:  opts.method || 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(_jwt ? { Authorization: `Bearer ${_jwt}` } : {}),
    },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  const data = await res.json().catch(() => ({ error: res.statusText }));
  if (!res.ok) {
    const err = new Error(data.error || 'API error');
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ──────────────────────── Utilities ──────────────────────────────── */
function fmt(n) {
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(n ?? 0);
}
function timeAgo(ts) {
  const ms = Date.now() - Number(ts);
  if (ms < 60000)    return 'just now';
  if (ms < 3600000)  return Math.floor(ms / 60000)    + 'm ago';
  if (ms < 86400000) return Math.floor(ms / 3600000)  + 'h ago';
  return Math.floor(ms / 86400000) + 'd ago';
}
function fmtDate(ts) {
  const d = ts ? new Date(Number(ts) || ts) : null;
  if (!d || isNaN(d)) return '—';
  return d.toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'});
}
function esc(s) {
  const d = document.createElement('div');
  d.textContent = String(s ?? '');
  return d.innerHTML;
}
function badgeCls(ev) {
  const known=['page_view','click','scroll_depth','form_submit','session_start'];
  return 'badge ' + (known.includes(ev) ? 'badge-'+ev : 'badge-default');
}
function planBadge(plan) {
  return `<span class="badge badge-plan-${plan||'free'}">${plan||'free'}</span>`;
}
function showToast(msg, ms=2400) {
  const t=document.getElementById('toast');
  t.textContent=msg; t.classList.add('show');
  clearTimeout(t._tid);
  t._tid=setTimeout(()=>t.classList.remove('show'),ms);
}
async function copyText(text, label='Copied!') {
  try { await navigator.clipboard.writeText(text); showToast(label); }
  catch { showToast('Copy failed — please copy manually.'); }
}
function setLoading(btnId, isLoading, label) {
  const b=document.getElementById(btnId);
  if(!b) return;
  b.disabled=isLoading;
  if(label) b.textContent=isLoading?'…':label;
}

/* ──────────────────────── Auth ───────────────────────────────────── */
function authTab(tab) {
  document.querySelectorAll('.auth-tab').forEach((t,i)=>{
    const tabs=['login','register','admin-reg'];
    t.classList.toggle('active', tabs[i]===tab);
  });
  document.getElementById('f-login').style.display      = tab==='login'     ?'':'none';
  document.getElementById('f-register').style.display   = tab==='register'  ?'':'none';
  document.getElementById('f-admin-reg').style.display  = tab==='admin-reg' ?'':'none';
  clearAuthMsg();
}

function showAuthMsg(msg, isError=true) {
  const el=document.getElementById('auth-msg');
  el.innerHTML         = `<div class="${isError?'error-msg':'success-msg'}">${esc(msg)}</div>`;
}
function clearAuthMsg() {
  document.getElementById('auth-msg').innerHTML='';
}

async function doLogin(e) {
  e.preventDefault();
  clearAuthMsg();
  setLoading('l-btn',true,'Sign In');
  try {
    const data = await api('/auth/login',{method:'POST',body:{
      email:    document.getElementById('l-email').value.trim(),
      password: document.getElementById('l-pass').value,
    }});
    _jwt=''; // set temporarily so api() works
    _jwt  = data.token;
    _user = data.user;
    localStorage.setItem('ts_jwt',  _jwt);
    localStorage.setItem('ts_role', _user.role || 'customer');
    localStorage.setItem('ts_email',_user.email || '');
    await boot();
  } catch(err) {
    showAuthMsg(err.message);
  } finally { setLoading('l-btn',false,'Sign In'); }
}

async function doRegister(e) {
  e.preventDefault();
  clearAuthMsg();
  setLoading('r-btn',true,'Create Account');
  try {
    const email    = document.getElementById('r-email').value.trim();
    const password = document.getElementById('r-pass').value;
    await api('/auth/register',{method:'POST',body:{email,password}});
    // auto-login after register
    const data = await api('/auth/login',{method:'POST',body:{email,password}});
    _jwt  = data.token;
    _user = data.user;
    localStorage.setItem('ts_jwt',  _jwt);
    localStorage.setItem('ts_role', _user.role||'customer');
    localStorage.setItem('ts_email',_user.email||'');
    await boot();
  } catch(err) {
    showAuthMsg(err.message);
  } finally { setLoading('r-btn',false,'Create Account'); }
}

async function doAdminRegister(e) {
  e.preventDefault();
  clearAuthMsg();
  setLoading('ar-btn',true,'Create Admin Account');
  try {
    const email    = document.getElementById('ar-email').value.trim();
    const password = document.getElementById('ar-pass').value;
    const adminKey = document.getElementById('ar-key').value;
    await api('/auth/register',{method:'POST',body:{email,password,adminKey}});
    // auto-login
    const data = await api('/auth/login',{method:'POST',body:{email,password}});
    _jwt  = data.token;
    _user = data.user;
    if(_user.role !== 'admin') {
      showAuthMsg('Admin key was incorrect — account created as customer.');
      return;
    }
    localStorage.setItem('ts_jwt',  _jwt);
    localStorage.setItem('ts_role', _user.role);
    localStorage.setItem('ts_email',_user.email||'');
    await boot();
  } catch(err) {
    showAuthMsg(err.message);
  } finally { setLoading('ar-btn',false,'Create Admin Account'); }
}

function logout() {
  clearInterval(_refreshTimer);
  destroyCharts();
  _jwt=null; _user=null; _customerProjects=[]; _analyticsProjectId=null;
  ['ts_jwt','ts_role','ts_email','ts_project'].forEach(k=>localStorage.removeItem(k));
  document.getElementById('v-customer').style.display='none';
  document.getElementById('v-admin').style.display='none';
  document.getElementById('v-auth').style.display='flex';
}

/* ──────────────────────── Boot ───────────────────────────────────── */
async function boot() {
  if(!_user) {
    document.getElementById('v-auth').style.display='flex';
    return;
  }
  document.getElementById('v-auth').style.display='none';

  if(_user.role === 'admin') {
    document.getElementById('v-admin').style.display='block';
    document.getElementById('admin-email-label').textContent = _user.email||'';
    await adminNav('overview');
  } else {
    document.getElementById('v-customer').style.display='block';
    document.getElementById('cust-email-label').textContent = _user.email||'';
    await custNav('analytics');
  }
}

/* ──────────────────────── Customer Navigation ────────────────────── */
function custNav(page) {
  ['analytics','projects'].forEach(p=>{
    document.getElementById('sb-'+p)?.classList.toggle('active', p===page);
  });
  if(page==='analytics') loadAnalytics();
  else loadProjects();
}

/* ──────────────────────── Customer: Projects ─────────────────────── */
async function loadProjects() {
  setMain('cust', loader());
  try {
    const data = await api('/projects');
    _customerProjects = data.projects || [];
    renderProjectsPage(_customerProjects);
  } catch(err) { handleFetchError('cust', err); }
}

function renderProjectsPage(projects) {
  const html = `
    <div class="page-content">
      <div class="page-hdr">
        <h1 class="page-title">My Projects</h1>
        <button class="btn btn-solid btn-sm" onclick="showNewProjectModal()">+ New Project</button>
      </div>
      ${projects.length === 0 ? `
        <div class="empty-box">
          <div style="font-size:2.5rem;margin-bottom:.75rem">🗂️</div>
          <h3>No projects yet</h3>
          <p>Create a project to get your tracking script and start collecting analytics.</p>
          <button class="btn btn-solid" onclick="showNewProjectModal()" style="width:auto;padding:.6rem 1.5rem">Create First Project</button>
        </div>
      ` : `
        <div class="proj-grid">
          ${projects.map(p=>projectCard(p)).join('')}
        </div>
      `}
    </div>`;
  setMain('cust', html);
}

function projectCard(p) {
  const masked = p.api_key ? p.api_key.slice(0,14)+'••••••••••••••••••••••' : '—';
  return `
    <div class="proj-card" id="pc-${p.id}">
      <div>
        <div class="proj-name">${esc(p.name)}</div>
        <div class="proj-date">Created ${fmtDate(p.created_at)}</div>
      </div>
      <div>
        <div style="font-size:.68rem;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:.4rem">API Key</div>
        <div class="proj-key-row">
          <div class="proj-key" id="key-${p.id}">${esc(masked)}</div>
          <button class="btn btn-ghost btn-xs" onclick="toggleKey('${p.id}','${esc(p.api_key)}')" title="Reveal/Hide">👁</button>
          <button class="btn btn-ghost btn-xs" onclick="copyText('${esc(p.api_key)}','API key copied!')" title="Copy key">📋</button>
        </div>
      </div>
      <div class="proj-actions">
        <button class="btn btn-ghost btn-sm" onclick="showEmbedModal('${esc(p.api_key)}','${esc(p.name)}')">📦 Embed Script</button>
        <button class="btn btn-ghost btn-sm" onclick="doRotateKey('${p.id}')">↺ Rotate Key</button>
        <button class="btn btn-danger btn-sm" onclick="doDeleteProject('${p.id}','${esc(p.name)}')">🗑 Delete</button>
      </div>
    </div>`;
}

function toggleKey(id, fullKey) {
  const el = document.getElementById('key-'+id);
  if(!el) return;
  const masked = fullKey.slice(0,14)+'••••••••••••••••••••••';
  el.textContent = el.textContent.includes('•') ? fullKey : masked;
}

function showNewProjectModal() {
  openModal('New Project', `
    <div id="np-msg"></div>
    <div class="field"><label>Project Name</label>
      <input type="text" id="np-name" placeholder="My Website" maxlength="80" /></div>
    <button class="btn btn-solid" onclick="createProject()">Create Project</button>
  `);
  setTimeout(()=>document.getElementById('np-name')?.focus(),50);
}

async function createProject() {
  const name=(document.getElementById('np-name')?.value||'').trim();
  if(!name){ document.getElementById('np-msg').innerHTML='<div class="error-msg">Project name is required.</div>'; return; }
  try {
    const data = await api('/projects',{method:'POST',body:{name}});
    localStorage.setItem('ts_project', data.project?.id||'');
    closeModal();
    await loadProjects();
    showToast('Project created!');
  } catch(err) {
    document.getElementById('np-msg').innerHTML=`<div class="error-msg">${esc(err.message)}</div>`;
  }
}

async function doRotateKey(id) {
  if(!confirm('Rotate the API key? Your current tracking script will stop working.')) return;
  try {
    const data = await api(`/projects/${id}/rotate-key`,{method:'POST'});
    const newKey = data.project?.api_key || data.api_key;
    await loadProjects();
    showToast('Key rotated successfully!');
    if(newKey) showEmbedModal(newKey, data.project?.name || '');
  } catch(err) { showToast('Error: '+err.message); }
}

async function doDeleteProject(id, name) {
  if(!confirm(`Delete project "${name}"? All analytics data will be permanently erased.`)) return;
  try {
    await api(`/projects/${id}`,{method:'DELETE'});
    await loadProjects();
    showToast('Project deleted.');
  } catch(err) { showToast('Error: '+err.message); }
}

function showEmbedModal(apiKey, projectName) {
  const snippet =
`<!-- TrackSense – ${projectName} -->
<script>
  window.SI_PROJECT_KEY = '${apiKey}';
<\/script>
<script src="http://localhost:5000/tracker.js"><\/script>`;

  openModal('Embed Script', `
    <p style="font-size:.82rem;color:var(--muted);margin-bottom:.75rem">
      Paste these two tags before the <code>&lt;/body&gt;</code> of your website.
    </p>
    <div class="code-block" id="embed-code">${esc(snippet)}</div>
    <button class="btn btn-solid" onclick="copyText(document.getElementById('embed-code').textContent,'Script copied!')">📋 Copy Script</button>
  `);
}

/* ──────────────────────── Customer: Analytics ────────────────────── */
async function loadAnalytics() {
  setMain('cust', loader());
  try {
    const data = await api('/projects');
    _customerProjects = data.projects || [];

    if(_customerProjects.length === 0) {
      renderNoProjects();
      return;
    }

    const saved = localStorage.getItem('ts_project');
    const pick  = _customerProjects.find(p=>p.id===saved) || _customerProjects[0];
    _analyticsProjectId = pick.id;

    await fetchAndRenderAnalytics();

  } catch(err) { handleFetchError('cust', err); }
}

async function fetchAndRenderAnalytics(silent = false) {
  const dot = document.getElementById('rdot-cust');
  if(dot) dot.className='rdot spin';
  try {
    const [statsRes, eventsRes] = await Promise.all([
      api(`/events/stats?projectId=${_analyticsProjectId}`),
      api(`/events?projectId=${_analyticsProjectId}&limit=500`),
    ]);
    renderAnalyticsPage(statsRes.stats, eventsRes.events||[]);
    const ts=document.getElementById('rdot-time');
    if(ts) ts.textContent=new Date().toLocaleTimeString();
  } catch(err) {
    if(silent) {
      showToast('Refresh failed: '+err.message);
    } else {
      throw err;
    }
  } finally {
    const dot=document.getElementById('rdot-cust');
    if(dot) dot.className='rdot';
  }
}

function renderAnalyticsPage(stats, events) {
  destroyCharts();
  const breakdown  = stats.eventBreakdown  || [];
  const sessions   = stats.recentSessions  || [];
  const topPages   = stats.topPages        || [];
  const pageViews  = (breakdown.find(e=>e.event==='page_view')||{count:0}).count;
  const avgEPS     = stats.totalSessions>0 ? (stats.totalEvents/stats.totalSessions).toFixed(1) : '0';
  const timeline   = buildTimeline(events);
  const recents    = events.slice(0,35);

  const projOptions = _customerProjects.map(p=>
    `<option value="${esc(p.id)}" ${p.id===_analyticsProjectId?'selected':''}>${esc(p.name)}</option>`
  ).join('');

  const html = `
    <div class="page-content">
      <div class="page-hdr">
        <h1 class="page-title">Analytics</h1>
        <div style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap">
          <select style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:.35rem .75rem;font-size:.83rem;outline:none;cursor:pointer"
            onchange="_analyticsProjectId=this.value;localStorage.setItem('ts_project',this.value);destroyCharts();fetchAndRenderAnalytics()">
            ${projOptions}
          </select>
          <div style="display:flex;align-items:center;gap:.4rem;font-size:.75rem;color:var(--muted)">
            <span class="rdot" id="rdot-cust"></span>
            <span id="rdot-time">—</span>
          </div>
          <button class="btn btn-ghost btn-sm" onclick="fetchAndRenderAnalytics(true)">↺ Refresh</button>
        </div>
      </div>

      <!-- KPIs -->
      <div class="kpi-grid">
        <div class="kpi-card" style="--c:#6366f1">
          <div class="kpi-label">Total Events</div>
          <div class="kpi-val">${fmt(stats.totalEvents)}</div>
          <div class="kpi-sub">all time</div>
        </div>
        <div class="kpi-card" style="--c:#22d3ee">
          <div class="kpi-label">Sessions</div>
          <div class="kpi-val">${fmt(stats.totalSessions)}</div>
          <div class="kpi-sub">unique browser sessions</div>
        </div>
        <div class="kpi-card" style="--c:#22c55e">
          <div class="kpi-label">Page Views</div>
          <div class="kpi-val">${fmt(pageViews)}</div>
          <div class="kpi-sub">page_view events</div>
        </div>
        <div class="kpi-card" style="--c:#f59e0b">
          <div class="kpi-label">Avg Events / Session</div>
          <div class="kpi-val">${avgEPS}</div>
          <div class="kpi-sub">engagement depth</div>
        </div>
      </div>

      <!-- Timeline -->
      <div class="chart-grid" style="grid-template-columns:1fr;margin-bottom:1.1rem">
        <div class="chart-card">
          <div class="chart-title">Events — Last 14 Days</div>
          <div class="chart-wrap tall"><canvas id="ch-timeline"></canvas></div>
        </div>
      </div>

      <!-- Breakdown + Pages -->
      <div class="chart-grid">
        <div class="chart-card">
          <div class="chart-title">Event Type Breakdown</div>
          <div class="chart-wrap"><canvas id="ch-breakdown"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-title">Top Pages by Views</div>
          <div class="chart-wrap" id="ch-pages-wrap"><canvas id="ch-pages"></canvas></div>
        </div>
      </div>

      <!-- Recent Sessions -->
      <div class="table-card">
        <div class="table-hdr">
          <div class="table-title">Recent Sessions</div>
          <span class="table-meta">${sessions.length} shown</span>
        </div>
        <div class="tbl-scroll">
          <table>
            <thead><tr><th>Session ID</th><th>Started</th><th>Events</th><th>Date</th></tr></thead>
            <tbody>
              ${sessions.length===0
                ? '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:1.5rem">No sessions yet.</td></tr>'
                : sessions.map(s=>`
                  <tr>
                    <td style="font-family:monospace;max-width:200px;overflow:hidden;text-overflow:ellipsis">${esc(s.session_id)}</td>
                    <td>${timeAgo(s.started_at)}</td>
                    <td>${s.event_count}</td>
                    <td>${fmtDate(s.started_at)}</td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Event Feed -->
      <div class="table-card">
        <div class="table-hdr">
          <div class="table-title">Live Event Feed</div>
          <span class="table-meta">Latest ${recents.length}</span>
        </div>
        <div class="evt-feed">
          ${recents.length===0
            ? '<div style="padding:2rem;text-align:center;color:var(--muted);font-size:.82rem">No events yet — open your tracked website to start collecting data.</div>'
            : recents.map(ev=>`
              <div class="evt-row">
                <span class="${badgeCls(ev.event)}">${esc(ev.event)}</span>
                <span class="evt-page">${esc(ev.page||ev.url||'—')}</span>
                <span class="evt-time">${timeAgo(ev.timestamp)}</span>
              </div>`).join('')}
        </div>
      </div>
    </div>`;

  setMain('cust', html);

  // Render charts after DOM update
  requestAnimationFrame(()=>{
    renderTimelineChart(timeline);
    renderBreakdownChart(breakdown);
    renderPagesChart(topPages);
  });

  // Auto-refresh every 30s
  clearInterval(_refreshTimer);
  _refreshTimer = setInterval(()=>fetchAndRenderAnalytics(true), 30000);
}

function renderNoProjects() {
  const html = `
    <div class="page-content">
      <div class="empty-box">
        <div style="font-size:2.5rem;margin-bottom:.75rem">📊</div>
        <h3>Create your first project</h3>
        <p>Get a tracking key and embed it on your website. Analytics will appear here automatically.</p>
        <button class="btn btn-solid" onclick="showNewProjectModal();custNav('projects')" style="width:auto;padding:.6rem 1.5rem">+ New Project</button>
      </div>
    </div>`;
  setMain('cust', html);
}

/* ──────────────────────── Charts ─────────────────────────────────── */
const PALETTE = ['#6366f1','#22d3ee','#22c55e','#f59e0b','#a855f7','#ef4444','#f97316','#ec4899'];
const TT = { backgroundColor:'#1a1d2e',borderColor:'#2a2d3e',borderWidth:1,padding:10,titleColor:'#e2e8f0',bodyColor:'#94a3b8' };
Chart.defaults.color='#64748b'; Chart.defaults.borderColor='#2a2d3e';

function destroyCharts() {
  Object.values(_charts).forEach(c=>{ try{c.destroy()}catch{} });
  _charts={};
}

function buildTimeline(events) {
  const buckets={};
  for(let i=13;i>=0;i--) {
    const d=new Date(Date.now()-i*86400000);
    buckets[d.toISOString().slice(0,10)]=0;
  }
  events.forEach(ev=>{
    const ms = Number(ev.timestamp);
    if(!ms || isNaN(ms)) return;
    const d = new Date(ms);
    if(isNaN(d)) return;
    const k = d.toISOString().slice(0,10);
    if(k in buckets) buckets[k]++;
  });
  return {
    labels: Object.keys(buckets).map(d=>{ const[,m,day]=d.split('-'); return `${m}/${day}`; }),
    data:   Object.values(buckets),
  };
}

function renderTimelineChart({labels,data}) {
  const ctx=document.getElementById('ch-timeline');
  if(!ctx) return;
  _charts.timeline=new Chart(ctx,{
    type:'line',
    data:{ labels, datasets:[{
      label:'Events', data,
      borderColor:'#6366f1', backgroundColor:'rgba(99,102,241,.1)',
      fill:true, tension:.4, pointRadius:4, pointHoverRadius:6,
      pointBackgroundColor:'#6366f1', pointBorderColor:'#0f1117', pointBorderWidth:2,
    }]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:TT },
      scales:{
        x:{ grid:{color:'#1e2130'} },
        y:{ grid:{color:'#1e2130'}, beginAtZero:true, ticks:{precision:0} },
      },
    },
  });
}

function renderBreakdownChart(breakdown) {
  const ctx=document.getElementById('ch-breakdown');
  if(!ctx||!breakdown.length) return;
  _charts.breakdown=new Chart(ctx,{
    type:'doughnut',
    data:{ labels:breakdown.map(e=>e.event), datasets:[{
      data:breakdown.map(e=>e.count),
      backgroundColor:PALETTE.slice(0,breakdown.length),
      borderColor:'#1a1d2e', borderWidth:3, hoverOffset:10,
    }]},
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'60%',
      plugins:{ legend:{position:'right',labels:{padding:12,boxWidth:11,font:{size:11}}}, tooltip:TT },
    },
  });
}

function renderPagesChart(topPages) {
  const wrap=document.getElementById('ch-pages-wrap');
  const ctx =document.getElementById('ch-pages');
  if(!ctx) return;
  if(!topPages||!topPages.length) {
    wrap.innerHTML='<div style="height:200px;display:flex;align-items:center;justify-content:center;color:var(--muted);font-size:.82rem">No page view data yet</div>';
    return;
  }
  _charts.pages=new Chart(ctx,{
    type:'bar',
    data:{ labels:topPages.map(p=>p.page), datasets:[{
      label:'Views', data:topPages.map(p=>p.count),
      backgroundColor:'rgba(34,211,238,.65)', borderRadius:5, borderSkipped:false,
    }]},
    options:{
      responsive:true, maintainAspectRatio:false, indexAxis:'y',
      plugins:{ legend:{display:false}, tooltip:TT },
      scales:{
        x:{ grid:{color:'#1e2130'}, beginAtZero:true, ticks:{precision:0} },
        y:{ grid:{display:false} },
      },
    },
  });
}

/* ──────────────────────── Admin Navigation ───────────────────────── */
function adminNav(page) {
  ['overview','customers'].forEach(p=>{
    document.getElementById('sb-admin-'+p)?.classList.toggle('active', p===page);
  });
  if(page==='overview') loadAdminOverview();
  else loadAdminCustomers();
}

/* ──────────────────────── Admin: Overview ────────────────────────── */
async function loadAdminOverview() {
  setMain('admin', loader());
  try {
    const data = await api('/admin/stats');
    renderAdminOverview(data.stats);
  } catch(err) { handleFetchError('admin', err); }
}

function renderAdminOverview(s) {
  const html = `
    <div class="page-content">
      <div class="page-hdr">
        <h1 class="page-title">Platform Overview</h1>
        <button class="btn btn-ghost btn-sm" onclick="loadAdminOverview()">↺ Refresh</button>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card" style="--c:#6366f1">
          <div class="kpi-label">Total Customers</div>
          <div class="kpi-val">${fmt(s.totalUsers)}</div>
          <div class="kpi-sub">registered accounts</div>
        </div>
        <div class="kpi-card" style="--c:#22d3ee">
          <div class="kpi-label">Total Projects</div>
          <div class="kpi-val">${fmt(s.totalProjects)}</div>
          <div class="kpi-sub">across all customers</div>
        </div>
        <div class="kpi-card" style="--c:#22c55e">
          <div class="kpi-label">Events Today</div>
          <div class="kpi-val">${fmt(s.todayEvents)}</div>
          <div class="kpi-sub">since midnight</div>
        </div>
        <div class="kpi-card" style="--c:#f59e0b">
          <div class="kpi-label">Total Events</div>
          <div class="kpi-val">${fmt(s.totalEvents)}</div>
          <div class="kpi-sub">all time</div>
        </div>
      </div>

      <div class="table-card">
        <div class="table-hdr">
          <div class="table-title">Recent Signups</div>
          <span class="table-meta">Last 10 customers</span>
        </div>
        <div class="tbl-scroll">
          <table>
            <thead><tr><th>Email</th><th>Name</th><th>Plan</th><th>Joined</th></tr></thead>
            <tbody>
              ${s.recentUsers.length===0
                ? '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:1.5rem">No customers yet.</td></tr>'
                : s.recentUsers.map(u=>`
                  <tr>
                    <td>${esc(u.email)}</td>
                    <td>${esc(u.name||'—')}</td>
                    <td>${planBadge(u.plan)}</td>
                    <td>${fmtDate(u.created_at)}</td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;
  setMain('admin', html);
}

/* ──────────────────────── Admin: Customers ───────────────────────── */
async function loadAdminCustomers() {
  setMain('admin', loader());
  try {
    const data = await api('/admin/customers');
    renderAdminCustomers(data.customers||[]);
  } catch(err) { handleFetchError('admin', err); }
}

function renderAdminCustomers(customers) {
  const rows = customers.map(c=>`
    <tr id="cust-row-${c.id}">
      <td>${esc(c.email)}</td>
      <td>${esc(c.name||'—')}</td>
      <td>${planBadge(c.plan)}</td>
      <td><span style="color:var(--cyan);font-weight:600">${c.project_count}</span></td>
      <td><span style="color:var(--green);font-weight:600">${fmt(c.event_count)}</span></td>
      <td>${fmtDate(c.created_at)}</td>
      <td><button class="btn btn-ghost btn-xs" onclick="toggleCustomerDetail('${c.id}')">Details ▾</button></td>
    </tr>
    <tr id="cust-detail-${c.id}" style="display:none">
      <td colspan="7" style="padding:0">
        <div class="expand-panel" id="cust-detail-content-${c.id}">
          <div style="color:var(--muted);font-size:.82rem">Loading…</div>
        </div>
      </td>
    </tr>`).join('');

  const html = `
    <div class="page-content">
      <div class="page-hdr">
        <h1 class="page-title">Customers</h1>
        <div style="display:flex;align-items:center;gap:.75rem">
          <input class="search-input" type="text" placeholder="Filter by email…" oninput="filterCustomers(this.value)" id="cust-search"
            style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:.35rem .75rem;font-size:.83rem;outline:none;max-width:240px" />
          <button class="btn btn-ghost btn-sm" onclick="loadAdminCustomers()">↺ Refresh</button>
        </div>
      </div>

      <div class="table-card">
        <div class="table-hdr">
          <div class="table-title">All Customers</div>
          <span class="table-meta" id="cust-count">${customers.length} total</span>
        </div>
        <div class="tbl-scroll">
          <table id="cust-table">
            <thead><tr>
              <th>Email</th><th>Name</th><th>Plan</th><th>Projects</th>
              <th>Events</th><th>Joined</th><th></th>
            </tr></thead>
            <tbody id="cust-tbody">${rows}</tbody>
          </table>
        </div>
      </div>
    </div>`;
  setMain('admin', html);

  // Store data for filter
  window._adminCustomers = customers;
}

function filterCustomers(q) {
  const term = q.toLowerCase();
  const all  = window._adminCustomers || [];
  const filtered = term ? all.filter(c=> c.email.toLowerCase().includes(term) || (c.name||'').toLowerCase().includes(term)) : all;

  const tbody = document.getElementById('cust-tbody');
  if(!tbody) return;
  tbody.innerHTML = filtered.map(c=>`
    <tr id="cust-row-${c.id}">
      <td>${esc(c.email)}</td>
      <td>${esc(c.name||'—')}</td>
      <td>${planBadge(c.plan)}</td>
      <td><span style="color:var(--cyan);font-weight:600">${c.project_count}</span></td>
      <td><span style="color:var(--green);font-weight:600">${fmt(c.event_count)}</span></td>
      <td>${fmtDate(c.created_at)}</td>
      <td><button class="btn btn-ghost btn-xs" onclick="toggleCustomerDetail('${c.id}')">Details ▾</button></td>
    </tr>
    <tr id="cust-detail-${c.id}" style="display:none">
      <td colspan="7" style="padding:0">
        <div class="expand-panel" id="cust-detail-content-${c.id}">
          <div style="color:var(--muted);font-size:.82rem">Loading…</div>
        </div>
      </td>
    </tr>`).join('');

  const countEl = document.getElementById('cust-count');
  if(countEl) countEl.textContent = filtered.length+' shown';
}

async function toggleCustomerDetail(id) {
  const row = document.getElementById('cust-detail-'+id);
  if(!row) return;
  const isOpen = row.style.display !== 'none';
  row.style.display = isOpen ? 'none' : '';
  if(isOpen) return;

  const content = document.getElementById('cust-detail-content-'+id);
  try {
    const data = await api('/admin/customers/'+id);
    const c = data.customer;
    const projs = data.projects||[];
    content.innerHTML = `
      <div style="margin-bottom:.75rem;font-size:.82rem">
        <strong>${esc(c.email)}</strong> &nbsp;·&nbsp; Joined ${fmtDate(c.created_at)} &nbsp;·&nbsp; Plan: ${planBadge(c.plan)}
      </div>
      ${projs.length===0 ? '<div style="color:var(--muted);font-size:.82rem">No projects yet.</div>' : `
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="text-align:left;padding:.3rem .5rem;font-size:.65rem;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border)">Project</th>
            <th style="text-align:left;padding:.3rem .5rem;font-size:.65rem;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border)">API Key</th>
            <th style="text-align:left;padding:.3rem .5rem;font-size:.65rem;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border)">Events</th>
            <th style="text-align:left;padding:.3rem .5rem;font-size:.65rem;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--border)">Created</th>
          </tr></thead>
          <tbody>
            ${projs.map(p=>`
              <tr>
                <td style="padding:.4rem .5rem;font-size:.8rem;border-bottom:1px solid rgba(42,45,62,.3)">${esc(p.name)}</td>
                <td style="padding:.4rem .5rem;font-size:.75rem;font-family:monospace;color:var(--cyan);border-bottom:1px solid rgba(42,45,62,.3)">${esc((p.api_key||'').slice(0,20)+'…')}</td>
                <td style="padding:.4rem .5rem;font-size:.8rem;color:var(--green);border-bottom:1px solid rgba(42,45,62,.3)">${fmt(p.event_count)}</td>
                <td style="padding:.4rem .5rem;font-size:.8rem;color:var(--muted);border-bottom:1px solid rgba(42,45,62,.3)">${fmtDate(p.created_at)}</td>
              </tr>`).join('')}
          </tbody>
        </table>`}`;
  } catch(err) {
    content.innerHTML=`<div style="color:var(--red);font-size:.82rem">${esc(err.message)}</div>`;
  }
}

/* ──────────────────────── Modal ──────────────────────────────────── */
function openModal(title, bodyHtml) {
  document.getElementById('modal-title').textContent=title;
  document.getElementById('modal-body').innerHTML=bodyHtml;
  document.getElementById('modal').style.display='flex';
}
function closeModal(e) {
  if(e && e.target!==document.getElementById('modal')) return;
  document.getElementById('modal').style.display='none';
}

/* ──────────────────────── Helpers ───────────────────────────────── */
function setMain(who, html) {
  const el=document.getElementById(who+'-main');
  if(el) el.innerHTML=html;
}
function loader() {
  return '<div class="center-state"><div class="spinner"></div><span>Loading…</span></div>';
}
function handleFetchError(who, err) {
  if(err.status===401) { logout(); return; }
  setMain(who, `<div class="center-state"><div style="color:var(--red)">${esc(err.message)}</div><button class="btn btn-ghost btn-sm" onclick="location.reload()" style="margin-top:.5rem">Retry</button></div>`);
}

/* ──────────────────────── Init ───────────────────────────────────── */
(async function init() {
  // Show admin tab if URL contains ?admin
  if(location.search.includes('admin')) {
    const tabs=document.getElementById('auth-tabs');
    const btn=document.createElement('button');
    btn.className='auth-tab';
    btn.textContent='Admin Setup';
    btn.onclick=()=>authTab('admin-reg');
    tabs.appendChild(btn);
  }

  const storedJwt = localStorage.getItem('ts_jwt');
  if(!storedJwt) return;

  _jwt = storedJwt;
  try {
    const data = await api('/auth/me');
    _user = data.user;
    localStorage.setItem('ts_email', _user.email||'');
    localStorage.setItem('ts_role',  _user.role||'customer');
    await boot();
  } catch {
    localStorage.removeItem('ts_jwt');
    _jwt = null;
  }
})();
