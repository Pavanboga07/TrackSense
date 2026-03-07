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
  // ts is an ISO string (e.g. "2026-03-07T07:00:00.000Z") or a ms number
  const ms = Date.now() - new Date(ts).getTime();
  if (isNaN(ms) || ms < 0) return '—';
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
  const known=['page_view','click','scroll_depth','form_submit','session_start',
    'page_exit','js_error','rage_click','outbound_click','form_start','form_abandon',
    'element_viewed','video_play','video_pause','video_complete','text_copy',
    'tab_hidden','tab_visible','page_performance','goal_triggered'];
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
  const pages = ['analytics','goals','funnels','heatmap','sessions','retention','ab','projects'];
  pages.forEach(p=>{
    document.getElementById('sb-'+p)?.classList.toggle('active', p===page);
  });
  clearInterval(_refreshTimer);
  if(page==='analytics') loadAnalytics();
  else if(page==='goals')     loadGoals();
  else if(page==='funnels')   loadFunnels();
  else if(page==='heatmap')   loadHeatmap();
  else if(page==='sessions')  loadSessions();
  else if(page==='retention') loadRetention();
  else if(page==='ab')        loadAb();
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
    // timestamp is stored as an ISO string; new Date() handles both ISO and ms
    const d = new Date(ev.timestamp);
    if(isNaN(d.getTime())) return;
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

/* ══════════════════════════════════════════════════════════════════
   GOALS
   ════════════════════════════════════════════════════════════════ */
async function loadGoals() {
  if(!_analyticsProjectId) { await _ensureProject(); if(!_analyticsProjectId) return; }
  setMain('cust', loader());
  try {
    const data = await api(`/goals?projectId=${_analyticsProjectId}`);
    renderGoalsPage(data.goals||[]);
  } catch(err) { handleFetchError('cust', err); }
}

function renderGoalsPage(goals) {
  const rows = goals.map(g=>`
    <div class="proj-card" style="gap:.5rem">
      <div>
        <div class="proj-name">${esc(g.name)}</div>
        <div class="proj-date">Event: <code>${esc(g.event_name)}</code>
          ${g.conditions && Object.keys(g.conditions).length
            ? ' · filter: ' + esc(JSON.stringify(g.conditions))
            : ''}</div>
      </div>
      <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="loadGoalStats('${g.id}','${esc(g.name)}')">📈 Stats</button>
        <button class="btn btn-danger btn-sm" onclick="deleteGoal('${g.id}')">🗑 Delete</button>
      </div>
    </div>`).join('');

  setMain('cust', `
    <div class="page-content">
      <div class="page-hdr">
        <h1 class="page-title">Goals</h1>
        <button class="btn btn-solid btn-sm" onclick="showNewGoalModal()">+ New Goal</button>
      </div>
      <p style="font-size:.83rem;color:var(--muted);margin-bottom:1rem">
        Goals track conversion events. Tag any element with <code>data-si-goal="name"</code> in your tracker.
      </p>
      ${goals.length===0
        ? `<div class="empty-box"><div style="font-size:2rem;margin-bottom:.5rem">🎯</div><h3>No goals yet</h3><p>Create a goal to track conversions.</p></div>`
        : `<div class="proj-grid">${rows}</div>`}
    </div>`);
}

function showNewGoalModal() {
  openModal('New Goal', `
    <div id="ng-msg"></div>
    <div class="field"><label>Goal Name</label>
      <input type="text" id="ng-name" placeholder="e.g. Upgrade Clicked" maxlength="80" /></div>
    <div class="field"><label>Event Name</label>
      <input type="text" id="ng-event" value="goal_triggered" maxlength="80" /></div>
    <div class="field"><label>Filter: goal_name (optional)</label>
      <input type="text" id="ng-goalname" placeholder="e.g. upgrade_clicked" maxlength="80" /></div>
    <button class="btn btn-solid" onclick="createGoal()">Create Goal</button>
  `);
  setTimeout(()=>document.getElementById('ng-name')?.focus(),50);
}

async function createGoal() {
  const name      = (document.getElementById('ng-name')?.value||'').trim();
  const eventName = (document.getElementById('ng-event')?.value||'goal_triggered').trim();
  const goalName  = (document.getElementById('ng-goalname')?.value||'').trim();
  if(!name) { document.getElementById('ng-msg').innerHTML='<div class="error-msg">Goal name is required.</div>'; return; }
  try {
    const conditions = goalName ? { goal_name: goalName } : {};
    await api('/goals',{method:'POST',body:{ projectId:_analyticsProjectId, name, eventName, conditions }});
    closeModal();
    loadGoals();
    showToast('Goal created!');
  } catch(err) {
    document.getElementById('ng-msg').innerHTML=`<div class="error-msg">${esc(err.message)}</div>`;
  }
}

async function deleteGoal(id) {
  if(!confirm('Delete this goal?')) return;
  try { await api('/goals/'+id,{method:'DELETE'}); loadGoals(); showToast('Deleted.'); }
  catch(err) { showToast('Error: '+err.message); }
}

async function loadGoalStats(id, name) {
  openModal('Goal Stats: '+name, `<div id="gs-wrap" style="min-height:120px">${loader()}</div>`);
  try {
    const d = await api(`/goals/${id}/stats?days=30`);
    const dailyEntries = Object.entries(d.daily||{}).sort(([a],[b])=>a>b?1:-1);
    const rateColor = d.conversionRate>5 ? 'var(--green)' : d.conversionRate>1 ? 'var(--amber)' : 'var(--red)';
    document.getElementById('gs-wrap').innerHTML = `
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:.75rem">
        <div class="kpi-card" style="--c:#6366f1;padding:.75rem"><div class="kpi-label" style="font-size:.65rem">Conversions</div><div class="kpi-val" style="font-size:1.4rem">${fmt(d.total)}</div></div>
        <div class="kpi-card" style="--c:#22c55e;padding:.75rem"><div class="kpi-label" style="font-size:.65rem">Unique Sessions</div><div class="kpi-val" style="font-size:1.4rem">${fmt(d.uniqueSessions)}</div></div>
        <div class="kpi-card" style="--c:${rateColor};padding:.75rem"><div class="kpi-label" style="font-size:.65rem">Conv. Rate</div><div class="kpi-val" style="font-size:1.4rem" style="color:${rateColor}">${d.conversionRate}%</div></div>
      </div>
      <div style="font-size:.75rem;color:var(--muted);margin-bottom:.5rem">Daily conversions (last 30 days)</div>
      <div style="display:flex;align-items:flex-end;gap:3px;height:60px;overflow-x:auto">
        ${dailyEntries.map(([day,count])=>{
          const maxC = Math.max(...Object.values(d.daily),1);
          const h = Math.round((count/maxC)*54)+6;
          return `<div title="${day}: ${count}" style="flex:1;min-width:8px;height:${h}px;background:#6366f1;border-radius:2px 2px 0 0;opacity:.85"></div>`;
        }).join('')}
      </div>`;
  } catch(err) {
    document.getElementById('gs-wrap').innerHTML=`<div style="color:var(--red)">${esc(err.message)}</div>`;
  }
}

/* ══════════════════════════════════════════════════════════════════
   FUNNELS
   ════════════════════════════════════════════════════════════════ */
async function loadFunnels() {
  if(!_analyticsProjectId) { await _ensureProject(); if(!_analyticsProjectId) return; }
  setMain('cust', loader());
  try {
    const data = await api(`/funnels?projectId=${_analyticsProjectId}`);
    renderFunnelsPage(data.funnels||[]);
  } catch(err) { handleFetchError('cust', err); }
}

function renderFunnelsPage(funnels) {
  const rows = funnels.map(f=>`
    <div class="proj-card" style="gap:.5rem">
      <div>
        <div class="proj-name">${esc(f.name)}</div>
        <div class="proj-date">${f.steps.length} steps: ${f.steps.map(s=>esc(s)).join(' → ')}</div>
      </div>
      <div style="display:flex;gap:.5rem;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" onclick="showFunnelResults('${f.id}','${esc(f.name)}')">📊 Results</button>
        <button class="btn btn-danger btn-sm" onclick="deleteFunnel('${f.id}')">🗑 Delete</button>
      </div>
    </div>`).join('');

  setMain('cust', `
    <div class="page-content">
      <div class="page-hdr">
        <h1 class="page-title">Funnels</h1>
        <button class="btn btn-solid btn-sm" onclick="showNewFunnelModal()">+ New Funnel</button>
      </div>
      <p style="font-size:.83rem;color:var(--muted);margin-bottom:1rem">
        Funnels show where users drop off in a sequence of pages. Steps = page pathnames (e.g. <code>/pricing</code>).
      </p>
      ${funnels.length===0
        ? `<div class="empty-box"><div style="font-size:2rem;margin-bottom:.5rem">🌊</div><h3>No funnels yet</h3><p>Create a funnel to measure drop-off.</p></div>`
        : `<div class="proj-grid">${rows}</div>`}
    </div>`);
}

function showNewFunnelModal() {
  openModal('New Funnel', `
    <div id="nf-msg"></div>
    <div class="field"><label>Funnel Name</label>
      <input type="text" id="nf-name" placeholder="e.g. Signup Flow" maxlength="80" /></div>
    <div class="field"><label>Steps (one page path per line)</label>
      <textarea id="nf-steps" rows="5" placeholder="/\n/pricing\n/signup\n/thank-you"
        style="width:100%;background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:.5rem;font-family:monospace;font-size:.82rem;resize:vertical"></textarea></div>
    <button class="btn btn-solid" onclick="createFunnel()">Create Funnel</button>
  `);
  setTimeout(()=>document.getElementById('nf-name')?.focus(),50);
}

async function createFunnel() {
  const name  = (document.getElementById('nf-name')?.value||'').trim();
  const raw   = (document.getElementById('nf-steps')?.value||'');
  const steps = raw.split('\n').map(s=>s.trim()).filter(Boolean);
  const msg = document.getElementById('nf-msg');
  if(!name) { msg.innerHTML='<div class="error-msg">Name is required.</div>'; return; }
  if(steps.length<2) { msg.innerHTML='<div class="error-msg">At least 2 steps are required.</div>'; return; }
  try {
    await api('/funnels',{method:'POST',body:{ projectId:_analyticsProjectId, name, steps }});
    closeModal();
    loadFunnels();
    showToast('Funnel created!');
  } catch(err) {
    msg.innerHTML=`<div class="error-msg">${esc(err.message)}</div>`;
  }
}

async function deleteFunnel(id) {
  if(!confirm('Delete this funnel?')) return;
  try { await api('/funnels/'+id,{method:'DELETE'}); loadFunnels(); showToast('Deleted.'); }
  catch(err) { showToast('Error: '+err.message); }
}

async function showFunnelResults(id, name) {
  openModal('Funnel: '+name, `<div id="fr-wrap" style="min-height:140px">${loader()}</div>`);
  try {
    const d = await api(`/funnels/${id}/results?days=30`);
    const steps = d.steps||[];
    const maxSessions = steps.length ? steps[0].sessions : 1;
    document.getElementById('fr-wrap').innerHTML = `
      <div style="font-size:.75rem;color:var(--muted);margin-bottom:.75rem">
        ${d.totalSessionsInPeriod} total sessions in period · Last 30 days
      </div>
      ${steps.map((s,i)=>{
        const w = maxSessions>0 ? Math.round((s.sessions/maxSessions)*100) : 0;
        const col = i===0 ? '#6366f1' : s.dropOffRate>50 ? '#ef4444' : s.dropOffRate>25 ? '#f59e0b' : '#22c55e';
        return `
          <div style="margin-bottom:.75rem">
            <div style="display:flex;justify-content:space-between;font-size:.78rem;margin-bottom:.25rem">
              <span style="color:var(--text)">${i+1}. ${esc(s.step)}</span>
              <span style="color:var(--muted)">${s.sessions} sessions
                ${i>0 ? '<span style="color:'+col+'"> (−'+s.dropOffRate+'%)</span>' : ''}
              </span>
            </div>
            <div style="height:10px;background:var(--surface);border-radius:5px;overflow:hidden">
              <div style="height:100%;width:${w}%;background:${col};border-radius:5px;transition:width .5s"></div>
            </div>
          </div>`;
      }).join('')}`;
  } catch(err) {
    document.getElementById('fr-wrap').innerHTML=`<div style="color:var(--red)">${esc(err.message)}</div>`;
  }
}

/* ══════════════════════════════════════════════════════════════════
   HEATMAP
   ════════════════════════════════════════════════════════════════ */
let _heatmapPage = null;

async function loadHeatmap() {
  if(!_analyticsProjectId) { await _ensureProject(); if(!_analyticsProjectId) return; }
  setMain('cust', loader());
  try {
    const data = await api(`/heatmap/pages?projectId=${_analyticsProjectId}&days=30`);
    renderHeatmapPage(data.pages||[]);
  } catch(err) { handleFetchError('cust', err); }
}

function renderHeatmapPage(pages) {
  const pageOpts = pages.map(p=>`<option value="${esc(p.page)}">${esc(p.page)} (${p.clicks})</option>`).join('');
  setMain('cust', `
    <div class="page-content">
      <div class="page-hdr">
        <h1 class="page-title">Heatmap</h1>
      </div>
      <p style="font-size:.83rem;color:var(--muted);margin-bottom:1rem">
        Click heatmap normalised to 1280×800. Darker = more clicks.
      </p>
      ${pages.length===0
        ? `<div class="empty-box"><div style="font-size:2rem;margin-bottom:.5rem">🔥</div><h3>No click data yet</h3><p>Clicks will appear here once tracked.</p></div>`
        : `
        <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem;flex-wrap:wrap">
          <select id="hm-page-sel" style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:.35rem .75rem;font-size:.83rem;outline:none"
            onchange="showHeatmapCanvas(this.value)">${pageOpts}</select>
          <button class="btn btn-ghost btn-sm" onclick="showHeatmapCanvas(document.getElementById('hm-page-sel').value)">↺ Reload</button>
        </div>
        <canvas id="hm-canvas" width="1280" height="800"
          style="width:100%;max-width:960px;border:1px solid var(--border);border-radius:8px;background:#0a0c14"></canvas>`}
    </div>`);

  if(pages.length>0) {
    showHeatmapCanvas(pages[0].page);
  }
}

async function showHeatmapCanvas(page) {
  const canvas = document.getElementById('hm-canvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle='#0a0c14';
  ctx.fillRect(0,0,1280,800);
  ctx.fillStyle='rgba(255,255,255,.3)';
  ctx.font='14px monospace';
  ctx.fillText('Loading…',590,400);

  try {
    const d = await api(`/heatmap?projectId=${_analyticsProjectId}&page=${encodeURIComponent(page)}&days=30`);
    ctx.fillStyle='#0a0c14';
    ctx.fillRect(0,0,1280,800);

    // Draw a faint grid
    ctx.strokeStyle='rgba(255,255,255,.04)';
    for(let x=0;x<1280;x+=128){ ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,800);ctx.stroke(); }
    for(let y=0;y<800;y+=80){  ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1280,y);ctx.stroke(); }

    const pts = d.points||[];
    if(!pts.length) {
      ctx.fillStyle='rgba(255,255,255,.4)';
      ctx.font='16px monospace';
      ctx.fillText('No click data for this page.',480,400);
      return;
    }
    const maxCount = Math.max(...pts.map(p=>p.count));

    for(const {nx,ny,count} of pts) {
      const intensity = count/maxCount;
      const r = Math.round(4+intensity*24);
      // Color: cool→warm
      const red   = Math.round(60 + 195*intensity);
      const green = Math.round(60 * (1-intensity));
      const blue  = Math.round(200 * (1-intensity));
      const grad = ctx.createRadialGradient(nx,ny,0,nx,ny,r);
      grad.addColorStop(0, `rgba(${red},${green},${blue},${0.4+0.5*intensity})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle=grad;
      ctx.beginPath();
      ctx.arc(nx,ny,r,0,Math.PI*2);
      ctx.fill();
    }

    // Legend
    ctx.fillStyle='rgba(255,255,255,.5)';
    ctx.font='11px sans-serif';
    ctx.fillText(`${d.total} clicks on ${esc(page)}`,10,790);
  } catch(err) {
    ctx.fillStyle='rgba(255,80,80,.8)';
    ctx.font='14px monospace';
    ctx.fillText(err.message,40,400);
  }
}

/* ══════════════════════════════════════════════════════════════════
   SESSION RECORDINGS (timeline)
   ════════════════════════════════════════════════════════════════ */
async function loadSessions() {
  if(!_analyticsProjectId) { await _ensureProject(); if(!_analyticsProjectId) return; }
  setMain('cust', loader());
  try {
    const data = await api(`/events?projectId=${_analyticsProjectId}&limit=500`);
    const allEvents = data.events||[];
    // Group by session, pick most recent 30
    const sessMap = {};
    for(const ev of allEvents) {
      if(!sessMap[ev.session_id]) sessMap[ev.session_id]={ session_id:ev.session_id, events:[], started_at:ev.timestamp };
      sessMap[ev.session_id].events.push(ev);
      if(ev.timestamp < sessMap[ev.session_id].started_at) sessMap[ev.session_id].started_at=ev.timestamp;
    }
    const sessions = Object.values(sessMap)
      .sort((a,b)=>(b.started_at>a.started_at?1:-1))
      .slice(0,30);
    renderSessionsPage(sessions);
  } catch(err) { handleFetchError('cust', err); }
}

function renderSessionsPage(sessions) {
  if(!sessions.length) {
    setMain('cust',`<div class="page-content"><div class="empty-box"><div style="font-size:2rem;margin-bottom:.5rem">🎬</div><h3>No sessions yet</h3></div></div>`);
    return;
  }
  const rows = sessions.map(s=>`
    <tr style="cursor:pointer" onclick="showSessionModal('${esc(s.session_id)}')">
      <td style="font-family:monospace;font-size:.72rem;max-width:180px;overflow:hidden;text-overflow:ellipsis">${esc(s.session_id)}</td>
      <td>${s.events.length}</td>
      <td>${timeAgo(s.started_at)}</td>
      <td style="color:var(--muted);font-size:.75rem">
        ${[...new Set(s.events.map(e=>e.event))].slice(0,4).join(', ')}
      </td>
    </tr>`).join('');

  setMain('cust',`
    <div class="page-content">
      <div class="page-hdr"><h1 class="page-title">Session Recordings</h1>
        <button class="btn btn-ghost btn-sm" onclick="loadSessions()">↺ Refresh</button>
      </div>
      <p style="font-size:.83rem;color:var(--muted);margin-bottom:1rem">Click any session to view its full event timeline.</p>
      <div class="table-card">
        <div class="tbl-scroll"><table>
          <thead><tr><th>Session ID</th><th>Events</th><th>Started</th><th>Event Types</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
    </div>`);
}

async function showSessionModal(sessionId) {
  openModal('Session: '+sessionId.slice(0,16)+'…', `<div id="sr-wrap" style="max-height:400px;overflow-y:auto">${loader()}</div>`);
  try {
    const d = await api(`/events/session/${encodeURIComponent(sessionId)}?projectId=${_analyticsProjectId}`);
    const evs = d.events||[];
    const startMs = evs.length ? new Date(evs[0].timestamp).getTime() : 0;
    const items = evs.map(ev=>{
      const relSec = startMs ? (new Date(ev.timestamp).getTime() - startMs)/1000 : 0;
      const meta = typeof ev.metadata==='object' ? ev.metadata : {};
      const detail = ev.event==='click'
        ? (meta.text?`"${esc(meta.text.slice(0,40))}" `:'')+(meta.css_path?`<span style="color:var(--muted);font-size:.7rem">${esc(meta.css_path.slice(0,60))}</span>`:'')
        : ev.event==='page_view' ? `<strong>${esc(meta.page||ev.page||'')}</strong>`
        : ev.event==='goal_triggered' ? `<span style="color:#d8b4fe;font-weight:600">${esc(meta.goal_name||'')}</span>`
        : esc(ev.page||'');
      return `
        <div style="display:flex;gap:.6rem;align-items:baseline;padding:.3rem 0;border-bottom:1px solid var(--border)">
          <span style="color:var(--muted);font-size:.7rem;min-width:50px">+${relSec.toFixed(1)}s</span>
          <span class="${badgeCls(ev.event)}">${esc(ev.event)}</span>
          <span style="font-size:.78rem">${detail}</span>
        </div>`;
    }).join('');
    document.getElementById('sr-wrap').innerHTML = items||'<div style="color:var(--muted)">No events.</div>';
  } catch(err) {
    document.getElementById('sr-wrap').innerHTML=`<div style="color:var(--red)">${esc(err.message)}</div>`;
  }
}

/* ══════════════════════════════════════════════════════════════════
   RETENTION
   ════════════════════════════════════════════════════════════════ */
async function loadRetention() {
  if(!_analyticsProjectId) { await _ensureProject(); if(!_analyticsProjectId) return; }
  setMain('cust', loader());
  try {
    const d = await api(`/events/retention?projectId=${_analyticsProjectId}&cohorts=8`);
    renderRetentionPage(d.cohorts||[]);
  } catch(err) { handleFetchError('cust', err); }
}

function renderRetentionPage(cohorts) {
  if(!cohorts.length) {
    setMain('cust',`<div class="page-content"><div class="empty-box"><div style="font-size:2rem;margin-bottom:.5rem">📅</div><h3>No data yet</h3></div></div>`);
    return;
  }
  const maxWeeks = Math.max(...cohorts.map(c=>c.retention.length));

  // Header: Week +0, +1, +2, ...
  const hdrCols = Array.from({length:maxWeeks},(_,i)=>`<th style="min-width:52px">Wk +${i}</th>`).join('');

  const rows = cohorts.map(c=>{
    const cells = Array.from({length:maxWeeks},(_,i)=>{
      if(i>=c.retention.length) return '<td></td>';
      const pct = c.retention[i];
      const bg  = i===0 ? '#3730a3'
        : pct>=60 ? '#166534'
        : pct>=30 ? '#92400e'
        : '#7f1d1d';
      return `<td style="background:${bg};color:#fff;text-align:center;border-radius:4px;font-size:.78rem">${pct}%</td>`;
    }).join('');
    return `<tr>
      <td style="white-space:nowrap;font-size:.78rem">${esc(c.week)}</td>
      <td style="text-align:center;color:var(--cyan)">${c.newSessions}</td>
      ${cells}
    </tr>`;
  }).join('');

  setMain('cust',`
    <div class="page-content">
      <div class="page-hdr"><h1 class="page-title">Retention</h1>
        <button class="btn btn-ghost btn-sm" onclick="loadRetention()">↺ Refresh</button>
      </div>
      <p style="font-size:.83rem;color:var(--muted);margin-bottom:1rem">
        Weekly cohort retention. Each row = sessions first seen in that week. Columns = % still active in subsequent weeks.
      </p>
      <div class="table-card">
        <div class="tbl-scroll" style="overflow-x:auto"><table>
          <thead><tr>
            <th>Cohort Week</th><th style="min-width:60px">New Sessions</th>${hdrCols}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
    </div>`);
}

/* ══════════════════════════════════════════════════════════════════
   A/B TESTS
   ════════════════════════════════════════════════════════════════ */
async function loadAb() {
  if(!_analyticsProjectId) { await _ensureProject(); if(!_analyticsProjectId) return; }
  setMain('cust', loader());
  try {
    const d = await api(`/events/ab?projectId=${_analyticsProjectId}&property=variant&days=30`);
    renderAbPage(d);
  } catch(err) { handleFetchError('cust', err); }
}

async function runAbQuery() {
  const prop   = (document.getElementById('ab-prop')?.value||'variant').trim();
  const goal   = (document.getElementById('ab-goal')?.value||'').trim();
  const days   = (document.getElementById('ab-days')?.value||'30').trim();
  const wrap   = document.getElementById('ab-results');
  if(wrap) wrap.innerHTML = loader();
  try {
    const params = `projectId=${_analyticsProjectId}&property=${encodeURIComponent(prop)}&days=${days}`
      + (goal ? `&goalName=${encodeURIComponent(goal)}` : '');
    const d = await api(`/events/ab?${params}`);
    if(wrap) wrap.innerHTML = renderAbTable(d.variants||[]);
  } catch(err) {
    if(wrap) wrap.innerHTML=`<div style="color:var(--red);padding:1rem">${esc(err.message)}</div>`;
  }
}

function renderAbPage(d) {
  setMain('cust',`
    <div class="page-content">
      <div class="page-hdr"><h1 class="page-title">A/B Tests</h1></div>
      <p style="font-size:.83rem;color:var(--muted);margin-bottom:1rem">
        Set a variant using <code>SI.setVariant('variant','control')</code> in your tracker.
        Conversions are counted from <code>goal_triggered</code> events (or any event you choose).
      </p>
      <div style="display:flex;gap:.75rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem">
        <input id="ab-prop"  type="text" value="variant" placeholder="metadata property"
          style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:.35rem .6rem;font-size:.82rem;outline:none;width:140px" />
        <input id="ab-goal"  type="text" placeholder="goal_name filter (opt.)"
          style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:.35rem .6rem;font-size:.82rem;outline:none;width:200px" />
        <select id="ab-days" style="background:var(--surface);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:.35rem .6rem;font-size:.82rem;outline:none">
          <option value="7">Last 7 days</option>
          <option value="14">Last 14 days</option>
          <option value="30" selected>Last 30 days</option>
          <option value="90">Last 90 days</option>
        </select>
        <button class="btn btn-solid btn-sm" onclick="runAbQuery()">Run</button>
      </div>
      <div id="ab-results">${renderAbTable(d.variants||[])}</div>
    </div>`);
}

function renderAbTable(variants) {
  if(!variants.length) return `<div class="empty-box" style="margin-top:0"><div style="font-size:2rem;margin-bottom:.5rem">🧪</div><h3>No variant data</h3><p>Use <code>SI.setVariant('variant','control')</code> in your tracker, then interact with goals.</p></div>`;
  const maxRate = Math.max(...variants.map(v=>v.rate),0.01);
  const rows = variants.map(v=>{
    const w   = Math.round((v.rate/maxRate)*100);
    const col = v.rate===Math.max(...variants.map(x=>x.rate)) ? '#22c55e' : '#6366f1';
    return `
      <tr>
        <td><strong>${esc(v.variant)}</strong></td>
        <td style="text-align:center">${fmt(v.sessions)}</td>
        <td style="text-align:center">${fmt(v.conversions)}</td>
        <td style="min-width:200px">
          <div style="display:flex;align-items:center;gap:.5rem">
            <div style="flex:1;height:8px;background:var(--surface);border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${w}%;background:${col};border-radius:4px"></div>
            </div>
            <span style="font-size:.82rem;color:${col};min-width:44px">${v.rate}%</span>
          </div>
        </td>
      </tr>`;
  }).join('');
  return `
    <div class="table-card">
      <div class="tbl-scroll"><table>
        <thead><tr><th>Variant</th><th style="text-align:center">Sessions</th><th style="text-align:center">Conversions</th><th>Conv. Rate</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════
   Shared helper: ensure a project is selected
   ════════════════════════════════════════════════════════════════ */
async function _ensureProject() {
  try {
    const data = await api('/projects');
    _customerProjects = data.projects||[];
    if(!_customerProjects.length) {
      setMain('cust',`<div class="page-content"><div class="empty-box"><h3>No projects yet</h3><p><button class="btn btn-solid btn-sm" onclick="custNav('projects')">Create a Project</button></p></div></div>`);
      return;
    }
    const saved = localStorage.getItem('ts_project');
    const pick  = _customerProjects.find(p=>p.id===saved)||_customerProjects[0];
    _analyticsProjectId = pick.id;
  } catch(err) { handleFetchError('cust', err); }
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
