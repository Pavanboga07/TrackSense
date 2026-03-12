'use strict';

/* ──────────────────────── Constants & State ──────────────────────── */
const API   = 'http://localhost:5000';
let _jwt    = null;
let _user   = null;
let _charts = {};
let _refreshTimer = null;
let _customerProjects = [];
let _analyticsProjectId = null;
let _seoSitemapUrls = [];

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
function initials(email) {
  if (!email) return '?';
  return email.split('@')[0].slice(0, 2).toUpperCase();
}

/* ──────────────────────── Sync topnav project picker ─────────────── */
function syncTopnavProject() {
  const sel = document.getElementById('cust-topnav-project');
  if (!sel) return;
  sel.innerHTML = _customerProjects.map(p =>
    `<option value="${esc(p.id)}" ${p.id === _analyticsProjectId ? 'selected' : ''}>${esc(p.name)}</option>`
  ).join('');
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
  const av = initials(_user.email);

  if(_user.role === 'admin') {
    document.getElementById('v-admin').style.display='block';
    const ael  = document.getElementById('admin-email-label');
    const ael2 = document.getElementById('admin-email-label-2');
    if(ael)  ael.textContent  = _user.email||'';
    if(ael2) ael2.textContent = _user.email||'';
    await adminNav('overview');
  } else {
    document.getElementById('v-customer').style.display='block';
    const cel  = document.getElementById('cust-email-label');
    const cel2 = document.getElementById('cust-email-label-2');
    const cav  = document.getElementById('cust-avatar');
    const cav2 = document.getElementById('cust-avatar-2');
    if(cel)  cel.textContent  = _user.email||'';
    if(cel2) cel2.textContent = _user.email||'';
    if(cav)  cav.textContent  = av;
    if(cav2) cav2.textContent = av;
    await custNav('analytics');
  }
}

/* ──────────────────────── Customer Navigation ────────────────────── */
function custNav(page) {
  const pages = ['analytics','goals','funnels','sessions','retention','projects','friction','users','ai','heatmap','seo'];
  pages.forEach(p=>{
    document.getElementById('sb-'+p)?.classList.toggle('active', p===page);
  });
  clearInterval(_refreshTimer);
  destroyCharts();

  // Show/hide topnav project picker and refresh indicator
  const picker = document.getElementById('cust-project-picker');
  const ri     = document.getElementById('cust-refresh-indicator');
  if(picker) picker.style.display = page==='projects' ? 'none' : '';
  if(ri)     ri.style.display     = page==='analytics' ? '' : 'none';

  if(page==='analytics') loadAnalytics();
  else if(page==='goals')     loadGoals();
  else if(page==='funnels')   loadFunnels();
  else if(page==='heatmap')   loadHeatmap();
  else if(page==='sessions')  loadSessions();
  else if(page==='retention') loadRetention();
  else if(page==='ab')        loadAb();
  else if(page==='friction')  loadFriction();
  else if(page==='seo')       loadSEO();
  else if(page==='users')     loadUsers();
  else if(page==='ai')        loadAI();
  else loadProjects();
}

/* ──────────────────────── Customer: Projects ─────────────────────── */
async function loadProjects() {
  setMain('cust', loader());
  try {
    const data = await api('/projects');
    _customerProjects = data.projects || [];
    syncTopnavProject();
    renderProjectsPage(_customerProjects);
  } catch(err) { handleFetchError('cust', err); }
}

function renderProjectsPage(projects) {
  const html = `
    <div class="page-content">
      <div class="page-hdr">
        <div class="page-hdr-left">
          <h1 class="page-title">Projects &amp; API keys</h1>
          <p class="page-subtitle">Each project gets a unique API key for your tracker script.</p>
        </div>
        <div class="page-hdr-actions">
          <button class="btn btn-solid btn-sm" onclick="showNewProjectModal()">+ New project</button>
        </div>
      </div>
      ${projects.length === 0 ? `
        <div class="empty-box">
          <div class="empty-box-icon">⚡</div>
          <h3>Create your first project</h3>
          <p>Get a tracking API key and embed it on your website. All user interactions will be captured automatically.</p>
          <button class="btn btn-solid" onclick="showNewProjectModal()" style="width:auto;padding:.6rem 1.5rem">Create project</button>
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
  const masked  = p.api_key ? p.api_key.slice(0,14)+'••••••••••••••••••••' : '—';
  const initial = (p.name||'?')[0].toUpperCase();
  return `
    <div class="proj-card" id="pc-${p.id}">
      <div class="proj-card-header">
        <div class="proj-card-icon">${initial}</div>
        <div style="flex:1;min-width:0">
          <div class="proj-name">${esc(p.name)}</div>
          <div class="proj-domain">${esc(p.domain||'No domain set')}</div>
          <div class="proj-date">Created ${fmtDate(p.created_at)}</div>
        </div>
      </div>
      <div>
        <div class="proj-key-label">API Key</div>
        <div class="proj-key-row">
          <div class="proj-key" id="key-${p.id}">${esc(masked)}</div>
          <button class="btn btn-ghost btn-xs btn-icon" onclick="toggleKey('${p.id}','${esc(p.api_key)}')" title="Show/Hide">👁</button>
          <button class="btn btn-ghost btn-xs btn-icon" onclick="copyText('${esc(p.api_key)}','API key copied!')" title="Copy key">📋</button>
        </div>
      </div>
      <div class="proj-actions">
        <button class="btn btn-ghost btn-sm" onclick="showEmbedModal('${esc(p.api_key)}','${esc(p.name)}')">&lt;/&gt; Install snippet</button>
        <button class="btn btn-ghost btn-sm" onclick="doRotateKey('${p.id}')">↺ Rotate key</button>
        <button class="btn btn-danger btn-sm" onclick="doDeleteProject('${p.id}','${esc(p.name)}')">Delete</button>
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
  openModal('New project', `
    <div id="np-msg"></div>
    <div class="field">
      <label>Project name</label>
      <input type="text" id="np-name" placeholder="My App" maxlength="80" />
    </div>
    <div class="field">
      <label>Domain <span style="font-weight:400;color:var(--muted);font-size:.73rem">(optional)</span></label>
      <input type="text" id="np-domain" placeholder="https://myapp.com" maxlength="200" />
    </div>
    <button class="btn btn-solid" onclick="createProject()">Create project</button>
  `);
  setTimeout(()=>document.getElementById('np-name')?.focus(),50);
}

async function createProject() {
  const name   = (document.getElementById('np-name')?.value||'').trim();
  const domain = (document.getElementById('np-domain')?.value||'').trim();
  if(!name){ document.getElementById('np-msg').innerHTML='<div class="error-msg">Project name is required.</div>'; return; }
  try {
    const data = await api('/projects',{method:'POST',body:{name,domain}});
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
  const backendUrl = window.location.origin.includes('localhost') || window.location.origin.includes('127.0.0.1')
    ? 'http://localhost:5000'
    : window.location.origin.replace(/:\d+$/, '');
  const snippet =
`<!-- TrackSense — ${projectName} -->
<script>
  window.SI_PROJECT_KEY = '${apiKey}';
  window.SI_ENDPOINT   = '${backendUrl}/track';
<\/script>
<script src="${backendUrl}/tracker.js"><\/script>`;

  openModal('Install tracking snippet', `
    <p style="font-size:.84rem;color:var(--muted);margin-bottom:1rem;line-height:1.6">
      Paste these two tags right before the <code style="background:var(--surface2);border:1px solid var(--border);padding:.1rem .3rem;border-radius:4px;font-size:.78rem">&lt;/body&gt;</code> of your site. TrackSense will automatically capture all user interactions.
    </p>
    <div class="code-block" id="embed-code">${esc(snippet)}</div>
    <button class="btn btn-solid" onclick="copyText(document.getElementById('embed-code').textContent,'Snippet copied!')">📋 Copy snippet</button>
    <div style="margin-top:1rem;padding:.875rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;font-size:.78rem;color:var(--muted);line-height:1.7">
      <strong style="color:var(--text)">Auto-captured events:</strong><br>
      Page views, clicks (with position), scroll depth, form interactions, rage clicks, outbound links, JS errors, and more — zero configuration needed.
    </div>
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
    syncTopnavProject();

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
  const clicks     = (breakdown.find(e=>e.event==='click')||{count:0}).count;
  const errors     = (breakdown.find(e=>e.event==='js_error')||{count:0}).count;
  const avgEPS     = stats.totalSessions>0 ? (stats.totalEvents/stats.totalSessions).toFixed(1) : '0';
  const timeline   = buildTimeline(events);
  const recents    = events.slice(0,40);

  const html = `
    <div class="page-content">
      <div class="page-hdr">
        <div class="page-hdr-left">
          <h1 class="page-title">Overview</h1>
          <p class="page-subtitle">All captured events and sessions for this project</p>
        </div>
        <div class="page-hdr-actions">
          <button class="btn btn-ghost btn-sm" onclick="fetchAndRenderAnalytics(true)">↺ Refresh</button>
        </div>
      </div>

      <!-- KPI Cards -->
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-icon" style="--ic:#eff6ff">📊</div>
          <div class="kpi-label">Total Events</div>
          <div class="kpi-val">${fmt(stats.totalEvents)}</div>
          <div class="kpi-sub">all time</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="--ic:#f4f3ff">👤</div>
          <div class="kpi-label">Sessions</div>
          <div class="kpi-val">${fmt(stats.totalSessions)}</div>
          <div class="kpi-sub">unique browser sessions</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="--ic:#f0fdf4">📄</div>
          <div class="kpi-label">Page Views</div>
          <div class="kpi-val">${fmt(pageViews)}</div>
          <div class="kpi-sub">page_view events</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="--ic:#fff7ed">🖱</div>
          <div class="kpi-label">Clicks</div>
          <div class="kpi-val">${fmt(clicks)}</div>
          <div class="kpi-sub">tracked click events</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="--ic:#ecfdf5">⚡</div>
          <div class="kpi-label">Events / Session</div>
          <div class="kpi-val">${avgEPS}</div>
          <div class="kpi-sub">engagement depth</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="--ic:#fef3f2">⚠</div>
          <div class="kpi-label">JS Errors</div>
          <div class="kpi-val" style="color:${errors>0?'var(--red)':'var(--text)'}">${fmt(errors)}</div>
          <div class="kpi-sub">captured error events</div>
        </div>
      </div>

      <!-- Timeline -->
      <div class="chart-card full" style="margin-bottom:1.25rem">
        <div class="chart-header">
          <span class="chart-title">Events over time — last 14 days</span>
          <div class="chart-legend">
            <div class="chart-legend-item"><div class="chart-legend-dot" style="background:#6336ff"></div><span>Events</span></div>
          </div>
        </div>
        <div class="chart-wrap tall"><canvas id="ch-timeline"></canvas></div>
      </div>

      <!-- Breakdown + Pages -->
      <div class="chart-grid">
        <div class="chart-card">
          <div class="chart-header"><span class="chart-title">Event type breakdown</span></div>
          <div class="chart-wrap"><canvas id="ch-breakdown"></canvas></div>
        </div>
        <div class="chart-card">
          <div class="chart-header">
            <span class="chart-title">Top pages</span>
            <span style="font-size:.72rem;color:var(--muted)">by page views</span>
          </div>
          <div class="chart-wrap" id="ch-pages-wrap"><canvas id="ch-pages"></canvas></div>
        </div>
      </div>

      <!-- Recent Sessions -->
      <div class="table-card">
        <div class="table-toolbar">
          <span class="table-toolbar-title">Recent sessions</span>
          <span class="table-toolbar-meta">${sessions.length} shown</span>
        </div>
        <div class="tbl-scroll">
          <table>
            <thead><tr><th>Session ID</th><th>Started</th><th>Events</th><th>Date</th></tr></thead>
            <tbody>
              ${sessions.length===0
                ? '<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:2rem">No sessions yet.</td></tr>'
                : sessions.map(s=>`
                  <tr>
                    <td style="font-family:monospace;font-size:.75rem;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.session_id)}</td>
                    <td>${timeAgo(s.started_at)}</td>
                    <td><span class="badge badge-green">${s.event_count}</span></td>
                    <td style="color:var(--muted)">${fmtDate(s.started_at)}</td>
                  </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Live Event Feed -->
      <div class="table-card">
        <div class="table-toolbar">
          <span class="table-toolbar-title">Live event stream</span>
          <span class="table-toolbar-meta">Latest ${recents.length} events</span>
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
  setMain('cust', `
    <div class="page-content">
      <div class="empty-box" style="margin-top:4rem">
        <div class="empty-box-icon">⚡</div>
        <h3>Create your first project</h3>
        <p>Get a tracking key and embed it on your website. Analytics will appear here automatically — no manual event configuration required.</p>
        <button class="btn btn-solid" onclick="custNav('projects')" style="width:auto;padding:.6rem 1.75rem">+ Create project</button>
      </div>
    </div>`);
}

/* ──────────────────────── Charts ─────────────────────────────────── */
const PALETTE = ['#6336ff','#0ea5e9','#12b76a','#f79009','#a78bfa','#f04438','#f97316','#ec4899'];
const TT = { backgroundColor:'#ffffff', borderColor:'#e5e3ef', borderWidth:1, padding:10, titleColor:'#1a1035', bodyColor:'#7b72a0', titleFont:{family:'Inter,sans-serif',weight:'600'}, bodyFont:{family:'Inter,sans-serif'} };
Chart.defaults.color='#7b72a0'; Chart.defaults.borderColor='#e5e3ef';
Chart.defaults.font.family='Inter,sans-serif';

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
      borderColor:'#6336ff', backgroundColor:'rgba(99,54,255,.08)',
      fill:true, tension:.45, pointRadius:4, pointHoverRadius:6,
      pointBackgroundColor:'#6336ff', pointBorderColor:'#ffffff', pointBorderWidth:2,
    }]},
    options:{
      responsive:true, maintainAspectRatio:false,
      plugins:{ legend:{display:false}, tooltip:TT },
      scales:{
        x:{ grid:{color:'#f3f2f8'}, ticks:{color:'#7b72a0'} },
        y:{ grid:{color:'#f3f2f8'}, beginAtZero:true, ticks:{precision:0, color:'#7b72a0'} },
      },
    },
  });
}

function renderBreakdownChart(breakdown) {
  const ctx=document.getElementById('ch-breakdown');
  if(!ctx||!breakdown.length) return;
  const top = breakdown.slice(0,8);
  _charts.breakdown=new Chart(ctx,{
    type:'doughnut',
    data:{ labels:top.map(e=>e.event), datasets:[{
      data:top.map(e=>e.count),
      backgroundColor:PALETTE.slice(0,top.length),
      borderColor:'#ffffff', borderWidth:3, hoverOffset:8,
    }]},
    options:{
      responsive:true, maintainAspectRatio:false, cutout:'62%',
      plugins:{ legend:{position:'right',labels:{padding:14,boxWidth:10,font:{size:11},color:'#7b72a0'}}, tooltip:TT },
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
      backgroundColor:'rgba(99,54,255,.7)', borderRadius:5, borderSkipped:false,
    }]},
    options:{
      responsive:true, maintainAspectRatio:false, indexAxis:'y',
      plugins:{ legend:{display:false}, tooltip:TT },
      scales:{
        x:{ grid:{color:'#f3f2f8'}, beginAtZero:true, ticks:{precision:0} },
        y:{ grid:{display:false}, ticks:{color:'#7b72a0'} },
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
    const [goalsData, suggestData] = await Promise.all([
      api(`/goals?projectId=${_analyticsProjectId}`),
      api(`/goals/suggestions?projectId=${_analyticsProjectId}`).catch(()=>({suggestions:[]})),
    ]);
    renderGoalsPage(goalsData.goals||[], suggestData.suggestions||[]);
  } catch(err) { handleFetchError('cust', err); }
}

function renderGoalsPage(goals, suggestions=[]) {
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

  // ── Suggestions section ─────────────────────────────────────────────────
  const pending = suggestions.filter(s=>!s.alreadySaved);
  const suggestHtml = pending.length === 0 ? '' : `
    <div style="margin-top:2rem">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.875rem">
        <span style="font-size:1.1rem">✨</span>
        <h2 style="font-size:1rem;font-weight:700;color:var(--text);margin:0">Smart Suggestions</h2>
        <span style="font-size:.73rem;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:.15rem .6rem">Detected from your event data</span>
      </div>
      <div class="proj-grid">
        ${pending.map(s=>`
          <div class="proj-card" style="gap:.5rem;border-left:3px solid var(--accent)">
            <div style="flex:1">
              <div class="proj-name" style="display:flex;align-items:center;gap:.4rem">
                <span>${esc(s.goalName)}</span>
                <span style="font-size:.68rem;background:var(--accent);color:#fff;border-radius:20px;padding:.1rem .5rem">✨ suggested</span>
              </div>
              <div class="proj-date">
                Event: <code>${esc(s.eventName)}</code>
                · seen <strong>${s.count}</strong> times
                ${s.samplePages&&s.samplePages.length ? ' · on '+s.samplePages.map(p=>`<code>${esc(p)}</code>`).join(', ') : ''}
              </div>
            </div>
            <button class="btn btn-solid btn-sm"
              onclick='createGoalFromSuggestion(${JSON.stringify(s)})'>+ Create Goal</button>
          </div>`).join('')}
      </div>
    </div>`;

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
      ${suggestHtml}
    </div>`);
}

async function createGoalFromSuggestion(s) {
  try {
    await api('/goals',{method:'POST',body:{
      projectId: _analyticsProjectId,
      name:      s.goalName,
      eventName: s.eventName,
      conditions: s.conditions || (s.eventName==='goal_triggered' ? {goal_name:s.goalName} : {}),
    }});
    loadGoals();
    showToast('Goal "'+s.goalName+'" created!');
  } catch(err) { showToast('Error: '+err.message); }
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
  openModal('Goal: '+name, `<div id="gs-wrap" style="min-height:140px">${loader()}</div>`);
  try {
    const d = await api(`/goals/${id}/stats?days=30`);
    const dailyEntries = Object.entries(d.daily||{}).sort(([a],[b])=>a>b?1:-1);
    const maxC = Math.max(...Object.values(d.daily||{x:0}),1);
    const rateColor = d.conversionRate>5 ? 'var(--green)' : d.conversionRate>1 ? 'var(--yellow)' : 'var(--red)';
    document.getElementById('gs-wrap').innerHTML = `
      <div class="kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:1.25rem">
        <div class="kpi-card" style="padding:.875rem 1rem">
          <div class="kpi-label">Conversions</div>
          <div class="kpi-val" style="font-size:1.625rem">${fmt(d.total)}</div>
          <div class="kpi-sub">last 30 days</div>
        </div>
        <div class="kpi-card" style="padding:.875rem 1rem">
          <div class="kpi-label">Unique sessions</div>
          <div class="kpi-val" style="font-size:1.625rem">${fmt(d.uniqueSessions)}</div>
          <div class="kpi-sub">converted</div>
        </div>
        <div class="kpi-card" style="padding:.875rem 1rem">
          <div class="kpi-label">Conv. rate</div>
          <div class="kpi-val" style="font-size:1.625rem;color:${rateColor}">${d.conversionRate}%</div>
          <div class="kpi-sub">of all sessions</div>
        </div>
      </div>
      <div style="font-size:.78rem;font-weight:600;color:var(--muted);margin-bottom:.6rem">Daily conversions (last 30 days)</div>
      <div style="display:flex;align-items:flex-end;gap:3px;height:72px">
        ${dailyEntries.map(([day,count])=>{
          const h = Math.round((count/maxC)*64)+8;
          return `<div title="${day}: ${count}" style="flex:1;min-width:6px;height:${h}px;background:#6336ff;border-radius:3px 3px 0 0;opacity:.8;cursor:default"></div>`;
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
    const [funnelsData, suggestData] = await Promise.all([
      api(`/funnels?projectId=${_analyticsProjectId}`),
      api(`/funnels/suggestions?projectId=${_analyticsProjectId}`).catch(()=>({suggestions:[]})),
    ]);
    renderFunnelsPage(funnelsData.funnels||[], suggestData.suggestions||[]);
  } catch(err) { handleFetchError('cust', err); }
}

function renderFunnelsPage(funnels, suggestions=[]) {
  const rows = funnels.map(f=>`
    <tr>
      <td>
        <div style="font-weight:600;color:var(--text)">${esc(f.name)}</div>
        <div style="font-size:.72rem;color:var(--muted);margin-top:.15rem">${f.steps.length} steps</div>
      </td>
      <td>
        <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap">
          ${f.steps.map((s,i)=>`
            ${i>0?'<span style="color:var(--muted2);font-size:.75rem">&rarr;</span>':''}
            <code style="background:var(--surface2);border:1px solid var(--border);padding:.15rem .4rem;border-radius:5px;font-size:.72rem">${esc(s)}</code>
          `).join('')}
        </div>
      </td>
      <td style="color:var(--muted);font-size:.75rem">${fmtDate(f.created_at)}</td>
      <td>
        <div style="display:flex;gap:.375rem">
          <button class="btn btn-solid btn-sm" onclick="showFunnelResults('${f.id}','${esc(f.name)}')">View results</button>
          <button class="btn btn-danger btn-sm" onclick="deleteFunnel('${f.id}')">Delete</button>
        </div>
      </td>
    </tr>`).join('');

  // ── Suggestions section ─────────────────────────────────────────────────
  const pending = suggestions.filter(s=>!s.alreadySaved);
  const suggestHtml = pending.length === 0 ? '' : `
    <div style="margin-top:2rem">
      <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.875rem">
        <span style="font-size:1.1rem">✨</span>
        <h2 style="font-size:1rem;font-weight:700;color:var(--text);margin:0">Smart Funnel Suggestions</h2>
        <span style="font-size:.73rem;color:var(--muted);background:var(--surface2);border:1px solid var(--border);border-radius:20px;padding:.15rem .6rem">Detected from real user journeys</span>
      </div>
      <div class="table-card">
        <div class="tbl-scroll">
          <table>
            <thead><tr><th>Suggested Path</th><th>Sessions</th><th></th></tr></thead>
            <tbody>
              ${pending.map(s=>`
                <tr>
                  <td>
                    <div style="display:flex;align-items:center;gap:.3rem;flex-wrap:wrap">
                      ${s.steps.map((step,i)=>`
                        ${i>0?'<span style="color:var(--muted2);font-size:.75rem">&rarr;</span>':''}
                        <code style="background:var(--surface2);border:1px solid var(--border);padding:.15rem .4rem;border-radius:5px;font-size:.72rem">${esc(step)}</code>
                      `).join('')}
                    </div>
                  </td>
                  <td style="color:var(--muted)">${s.frequency} sessions followed this path</td>
                  <td>
                    <button class="btn btn-solid btn-sm"
                      onclick='createFunnelFromSuggestion(${JSON.stringify(s)})'>+ Create Funnel</button>
                  </td>
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
      </div>
    </div>`;

  setMain('cust', `
    <div class="page-content">
      <div class="page-hdr">
        <div class="page-hdr-left">
          <h1 class="page-title">Funnels</h1>
          <p class="page-subtitle">Visualize where users drop off in multi-step flows</p>
        </div>
        <div class="page-hdr-actions">
          <button class="btn btn-solid btn-sm" onclick="showNewFunnelModal()">+ New funnel</button>
        </div>
      </div>
      ${funnels.length===0
        ? `<div class="empty-box"><div class="empty-box-icon">&#8681;</div><h3>No funnels yet</h3><p>Build a funnel using page paths to measure conversion drop-off through your key user flows.</p></div>`
        : `<div class="table-card"><div class="tbl-scroll"><table><thead><tr><th>Funnel</th><th>Steps</th><th>Created</th><th></th></tr></thead><tbody>${rows}</tbody></table></div></div>`}
      ${suggestHtml}
    </div>`);
}

async function createFunnelFromSuggestion(s) {
  const name = s.steps.join(' → ');
  try {
    await api('/funnels',{method:'POST',body:{ projectId:_analyticsProjectId, name, steps:s.steps }});
    loadFunnels();
    showToast('Funnel created!');
  } catch(err) { showToast('Error: '+err.message); }
}

function showNewFunnelModal() {
  openModal('New funnel', `
    <div id="nf-msg"></div>
    <div class="field">
      <label>Funnel name</label>
      <input type="text" id="nf-name" placeholder="e.g. Signup Flow" maxlength="80" />
    </div>
    <div class="field">
      <label>Steps <span style="font-weight:400;color:var(--muted);font-size:.73rem">(one page path per line, min 2)</span></label>
      <textarea id="nf-steps" rows="5" placeholder="/&#10;/pricing&#10;/signup&#10;/thank-you"
        style="width:100%;background:var(--surface2);border:1.5px solid var(--border);color:var(--text);border-radius:8px;padding:.625rem .75rem;font-family:monospace;font-size:.82rem;resize:vertical;outline:none"
        onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'"></textarea>
    </div>
    <button class="btn btn-solid" onclick="createFunnel()">Create funnel</button>
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
  openModal('Funnel: '+name, `<div id="fr-wrap" style="min-height:160px">${loader()}</div>`);
  try {
    const d = await api(`/funnels/${id}/results?days=30`);
    const steps = d.steps||[];
    const maxS  = steps.length ? steps[0].sessions : 1;
    document.getElementById('fr-wrap').innerHTML = `
      <div style="font-size:.78rem;color:var(--muted);margin-bottom:1.25rem">
        <strong style="color:var(--text)">${d.totalSessionsInPeriod}</strong> total sessions · Last 30 days
      </div>
      ${steps.map((s,i)=>{
        const pct = maxS>0 ? Math.round((s.sessions/maxS)*100) : 0;
        const col = i===0 ? '#6336ff' : s.dropOffRate>50 ? '#f04438' : s.dropOffRate>25 ? '#f79009' : '#12b76a';
        return `
          <div class="funnel-step">
            <div class="funnel-step-label">
              <span style="color:var(--muted2);font-size:.72rem;margin-right:.4rem">${i+1}</span>
              <code style="font-size:.78rem;background:var(--surface2);border:1px solid var(--border);padding:.15rem .4rem;border-radius:4px">${esc(s.step)}</code>
            </div>
            <div class="funnel-bar-wrap">
              <div class="funnel-bar" style="width:${pct}%;background:${col}">
                <span class="funnel-bar-text">${pct}%</span>
              </div>
            </div>
            <div class="funnel-step-meta">
              <strong style="color:var(--text)">${s.sessions}</strong> sessions
              ${i>0?`<div class="funnel-drop" style="color:${col}">↓ ${s.dropOffRate}% drop</div>`:''}
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
  const pageOpts = pages.map(p=>`<option value="${esc(p.page)}">${esc(p.page)} (${p.clicks} clicks)</option>`).join('');
  setMain('cust', `
    <div class="page-content">
      <div class="page-hdr">
        <div class="page-hdr-left">
          <h1 class="page-title">Heatmaps</h1>
          <p class="page-subtitle">Click density map. Normalized to 1280×800 reference viewport.</p>
        </div>
      </div>
      ${pages.length===0
        ? `<div class="empty-box"><div class="empty-box-icon">▦</div><h3>No click data yet</h3><p>Clicks will appear here once your tracker captures interactions. Make sure your project is set up and visit your website.</p></div>`
        : `
        <div class="heatmap-container">
          <div class="heatmap-toolbar">
            <label style="font-size:.8rem;font-weight:600;color:var(--muted)">Page</label>
            <select id="hm-page-sel" style="width:auto;border:1.5px solid var(--border);border-radius:8px;padding:.3rem .75rem;font-size:.83rem"
              onchange="showHeatmapCanvas(this.value)">${pageOpts}</select>
            <button class="btn btn-ghost btn-sm" onclick="showHeatmapCanvas(document.getElementById('hm-page-sel').value)">↺ Reload</button>
          </div>
          <canvas id="hm-canvas" width="1280" height="800"
            style="width:100%;display:block;background:#f8f8fc;border-top:1px solid var(--border)"></canvas>
        </div>`}
    </div>`);

  if(pages.length>0) showHeatmapCanvas(pages[0].page);
}

async function showHeatmapCanvas(page) {
  const canvas = document.getElementById('hm-canvas');
  if(!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle='#f8f8fc';
  ctx.fillRect(0,0,1280,800);
  ctx.fillStyle='rgba(99,54,255,.5)';
  ctx.font='14px Inter,sans-serif';
  ctx.fillText('Loading…',590,400);

  try {
    const d = await api(`/heatmap?projectId=${_analyticsProjectId}&page=${encodeURIComponent(page)}&days=30`);
    ctx.fillStyle='#f8f8fc';
    ctx.fillRect(0,0,1280,800);

    // Faint grid
    ctx.strokeStyle='rgba(99,54,255,.05)';
    for(let x=0;x<1280;x+=128){ ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,800);ctx.stroke(); }
    for(let y=0;y<800;y+=80){  ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(1280,y);ctx.stroke(); }

    const pts = d.points||[];
    if(!pts.length) {
      ctx.fillStyle='rgba(99,54,255,.4)';
      ctx.font='15px Inter,sans-serif';
      ctx.fillText('No click data for this page.',470,400);
      return;
    }
    const maxCount = Math.max(...pts.map(p=>p.count));
    for(const {nx,ny,count} of pts) {
      const intensity = count/maxCount;
      const r = Math.round(6+intensity*28);
      const red   = Math.round(59  + intensity*193);
      const green = Math.round(130 * (1-intensity));
      const blue  = Math.round(245 * (1-intensity) + 10);
      const grad = ctx.createRadialGradient(nx,ny,0,nx,ny,r);
      grad.addColorStop(0, `rgba(${red},${green},${blue},${(0.35+0.55*intensity).toFixed(2)})`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle=grad;
      ctx.beginPath();
      ctx.arc(nx,ny,r,0,Math.PI*2);
      ctx.fill();
    }
    ctx.fillStyle='rgba(99,54,255,.6)';
    ctx.font='11px Inter,sans-serif';
    ctx.fillText(`${d.total} clicks · ${page}`,10,790);
  } catch(err) {
    ctx.fillStyle='rgba(240,68,56,.7)';
    ctx.font='14px Inter,sans-serif';
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
    setMain('cust',`<div class="page-content"><div class="empty-box"><div class="empty-box-icon">&#9654;</div><h3>No sessions yet</h3><p>Sessions appear here once your tracker starts capturing events.</p></div></div>`);
    return;
  }
  const rows = sessions.map(s=>{
    const dur = s.events.length>1
      ? Math.round((new Date(s.events[s.events.length-1].timestamp)-new Date(s.events[0].timestamp))/1000)
      : 0;
    const durStr = dur>=60 ? `${Math.floor(dur/60)}m ${dur%60}s` : `${dur}s`;
    const types = [...new Set(s.events.map(e=>e.event))];
    return `
    <tr style="cursor:pointer" onclick="showSessionModal('${esc(s.session_id)}')"> 
      <td style="font-family:monospace;font-size:.72rem;white-space:nowrap">
        <span title="${esc(s.session_id)}">${esc(s.session_id.slice(0,20)+'\u2026')}</span>
        <button onclick="event.stopPropagation();navigator.clipboard.writeText('${esc(s.session_id)}').then(()=>{this.textContent='✓';setTimeout(()=>this.textContent='⎘',1200)})" title="Copy full session ID" style="margin-left:.35rem;background:none;border:none;cursor:pointer;color:var(--muted);font-size:.8rem;padding:0;line-height:1">⎘</button>
      </td>
      <td><span class="badge badge-blue" style="font-size:.7rem">${s.events.length}</span></td>
      <td style="font-size:.75rem">${durStr}</td>
      <td>${timeAgo(s.started_at)}</td>
      <td style="color:var(--muted);font-size:.73rem;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${types.slice(0,5).map(t=>`<span class="${badgeCls(t)}" style="font-size:.68rem;margin-right:.2rem">${esc(t)}</span>`).join('')}
      </td>
    </tr>`;
  }).join('');

  setMain('cust',`
    <div class="page-content">
      <div class="page-hdr">
        <div class="page-hdr-left">
          <h1 class="page-title">Sessions</h1>
          <p class="page-subtitle">Click any session to view its full event timeline</p>
        </div>
        <div class="page-hdr-actions">
          <button class="btn btn-ghost btn-sm" onclick="loadSessions()">&#8635; Refresh</button>
        </div>
      </div>
      <div class="table-card">
        <div class="tbl-scroll"><table>
          <thead><tr><th>Session ID</th><th>Events</th><th>Duration</th><th>Started</th><th>Event types</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>
    </div>`);
}

async function showSessionModal(sessionId) {
  openModal('Session', `
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.75rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;padding:.45rem .7rem">
      <span style="font-family:monospace;font-size:.75rem;color:var(--text);word-break:break-all;flex:1">${esc(sessionId)}</span>
      <button onclick="navigator.clipboard.writeText('${esc(sessionId)}').then(()=>{this.textContent='Copied ✓';setTimeout(()=>this.textContent='Copy',1500)})" style="flex-shrink:0;padding:.25rem .6rem;font-size:.72rem;background:var(--surface3,#333);border:1px solid var(--border);border-radius:4px;color:var(--text);cursor:pointer">Copy</button>
    </div>
    <div id="sr-wrap" style="max-height:400px;overflow-y:auto">${loader()}</div>`);
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
    setMain('cust',`<div class="page-content"><div class="empty-box"><div class="empty-box-icon">&#128197;</div><h3>No retention data yet</h3><p>Retention data appears after users return across multiple weeks. Keep tracking visitors!</p></div></div>`);
    return;
  }
  const maxWeeks = Math.max(...cohorts.map(c=>c.retention.length));

  const hdrCols = Array.from({length:maxWeeks},(_,i)=>{
    let label;
    if(i===0) label = 'Same week';
    else if(i===1) label = '1 week later';
    else label = `${i} weeks later`;
    return `<th style="min-width:80px;text-align:center"><small>${label}</small></th>`;
  }).join('');

  const rows = cohorts.map(c=>{
    const cells = Array.from({length:maxWeeks},(_,i)=>{
      if(i>=c.retention.length) return '<td></td>';
      const pct = c.retention[i];
      const opacity = i===0 ? 1 : Math.max(0.12, pct/100);
      return `<td><div class="retention-cell" style="opacity:${opacity.toFixed(2)};background:${i===0?'#6336ff':'rgba(99,54,255,1)'}">${pct}%</div></td>`;
    }).join('');
    return `<tr>
      <td style="white-space:nowrap;font-size:.78rem;font-weight:500">${esc(c.week)}</td>
      <td style="text-align:center;font-weight:600;color:var(--accent)">${c.newSessions}</td>
      ${cells}
    </tr>`;
  }).join('');

  setMain('cust',`
    <div class="page-content">
      <div class="page-hdr">
        <div class="page-hdr-left">
          <h1 class="page-title">User Retention</h1>
          <p class="page-subtitle">See how many of your users come back after their first visit</p>
        </div>
        <div class="page-hdr-actions">
          <button class="btn btn-ghost btn-sm" onclick="loadRetention()">&#8635; Refresh</button>
        </div>
      </div>

      <div style="background:#f8f6ff;border:1px solid #e8e4ff;border-radius:6px;padding:16px;margin-bottom:20px;font-size:.9rem;line-height:1.6">
        <strong>📖 How to read this:</strong>
        <ul style="margin:10px 0 0 20px">
          <li><strong>Left column (Signup week):</strong> The week when new people first visited your site</li>
          <li><strong>Second column (New visitors):</strong> How many new people signed up that week</li>
          <li><strong>Color cells:</strong> The percentage (%) of those visitors who came back later. Darker color = more people returned!</li>
          <li><strong>Example:</strong> If "Same week" shows 100%, all new visitors visited again the same week. If "1 week later" shows 45%, only 45% came back after 1 week.</li>
        </ul>
      </div>

      <div class="table-card">
        <div class="tbl-scroll" style="overflow-x:auto"><table>
          <thead><tr>
            <th>Signup week</th><th style="min-width:80px;text-align:center">New visitors</th>${hdrCols}
          </tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
      </div>

      <div style="background:#fff9e6;border:1px solid #ffe699;border-radius:6px;padding:12px;margin-top:16px;font-size:.85rem">
        <strong>💡 Tip:</strong> Higher percentages mean users love coming back! If numbers drop fast, try improving what keeps users engaged.
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
      <div class="page-hdr">
        <div class="page-hdr-left">
          <h1 class="page-title">A/B Tests</h1>
          <p class="page-subtitle">Compare conversion rates across experiment variants</p>
        </div>
      </div>
      <div class="filter-bar">
        <div style="display:flex;align-items:center;gap:.5rem">
          <span class="filter-label">Property</span>
          <input id="ab-prop" type="text" value="variant" placeholder="metadata property"
            style="border:1.5px solid var(--border);border-radius:8px;padding:.3rem .7rem;font-size:.82rem;outline:none;width:130px;background:var(--surface);color:var(--text)"
            onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'" />
        </div>
        <div style="display:flex;align-items:center;gap:.5rem">
          <span class="filter-label">Goal filter</span>
          <input id="ab-goal" type="text" placeholder="goal_name (optional)"
            style="border:1.5px solid var(--border);border-radius:8px;padding:.3rem .7rem;font-size:.82rem;outline:none;width:180px;background:var(--surface);color:var(--text)"
            onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'" />
        </div>
        <div style="display:flex;align-items:center;gap:.5rem">
          <span class="filter-label">Period</span>
          <select id="ab-days" style="border:1.5px solid var(--border);border-radius:8px;padding:.3rem .7rem;font-size:.82rem;outline:none;background:var(--surface);color:var(--text)">
            <option value="7">Last 7 days</option>
            <option value="14">Last 14 days</option>
            <option value="30" selected>Last 30 days</option>
            <option value="90">Last 90 days</option>
          </select>
        </div>
        <button class="btn btn-solid btn-sm" onclick="runAbQuery()">Run query</button>
      </div>
      <div id="ab-results">${renderAbTable(d.variants||[])}</div>
    </div>`);
}

function renderAbTable(variants) {
  if(!variants.length) return `<div class="empty-box" style="margin-top:0"><div class="empty-box-icon">&#128203;</div><h3>No variant data</h3><p>Use <code>SI.setVariant('variant','control')</code> in your tracker, then interact with goals.</p></div>`;
  const maxRate = Math.max(...variants.map(v=>v.rate),0.01);
  const best    = Math.max(...variants.map(x=>x.rate));
  const rows = variants.map(v=>{
    const w   = Math.round((v.rate/maxRate)*100);
    const isWinner = v.rate===best;
    return `
      <tr>
        <td>
          <strong style="color:var(--text)">${esc(v.variant)}</strong>
          ${isWinner&&variants.length>1?'<span class="badge badge-green" style="margin-left:.5rem;font-size:.68rem">winner</span>':''}
        </td>
        <td style="text-align:center;font-weight:500">${fmt(v.sessions)}</td>
        <td style="text-align:center;font-weight:500">${fmt(v.conversions)}</td>
        <td style="min-width:220px">
          <div class="ab-bar-wrap">
            <div class="ab-bar">
              <div class="ab-bar-fill" style="width:${w}%;background:${isWinner?'#6336ff':'#a78bfa'}"></div>
            </div>
            <span class="ab-rate" style="color:${isWinner?'var(--accent)':'var(--muted)'}">${v.rate}%</span>
          </div>
        </td>
      </tr>`;
  }).join('');
  return `
    <div class="table-card">
      <div class="tbl-scroll"><table>
        <thead><tr><th>Variant</th><th style="text-align:center">Sessions</th><th style="text-align:center">Conversions</th><th>Conv. rate</th></tr></thead>
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
      setMain('cust',`<div class="page-content"><div class="empty-box"><h3>No projects yet</h3><p><button class="btn btn-solid btn-sm" onclick="custNav('projects')">Create a project</button></p></div></div>`);
      return;
    }
    const saved = localStorage.getItem('ts_project');
    const pick  = _customerProjects.find(p=>p.id===saved)||_customerProjects[0];
    _analyticsProjectId = pick.id;
    syncTopnavProject();
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
        <div class="kpi-card">
          <div class="kpi-icon" style="background:rgba(99,54,255,.1);color:#6336ff">&#128101;</div>
          <div class="kpi-label">Total customers</div>
          <div class="kpi-val">${fmt(s.totalUsers)}</div>
          <div class="kpi-sub">registered accounts</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background:rgba(14,165,233,.1);color:#0ea5e9">&#128193;</div>
          <div class="kpi-label">Total projects</div>
          <div class="kpi-val">${fmt(s.totalProjects)}</div>
          <div class="kpi-sub">across all customers</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background:rgba(18,183,106,.1);color:#12b76a">&#9889;</div>
          <div class="kpi-label">Events today</div>
          <div class="kpi-val">${fmt(s.todayEvents)}</div>
          <div class="kpi-sub">since midnight</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-icon" style="background:rgba(247,144,9,.1);color:#f79009">&#128202;</div>
          <div class="kpi-label">Total events</div>
          <div class="kpi-val">${fmt(s.totalEvents)}</div>
          <div class="kpi-sub">all time</div>
        </div>
      </div>

      <div class="table-card">
        <div class="table-toolbar">
          <div class="table-toolbar-title">Recent signups</div>
          <span class="table-toolbar-meta">Last 10 customers</span>
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
                    <td>${esc(u.name||'\u2014')}</td>
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
        <div class="table-toolbar">
          <div class="table-toolbar-title">All customers</div>
          <span class="table-toolbar-meta" id="cust-count">${customers.length} total</span>
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

/* ══════════════════════════════════════════════════════════════════
   FRICTION MAP
   ════════════════════════════════════════════════════════════════ */
async function loadFriction() {
  if(!_analyticsProjectId) { await _ensureProject(); if(!_analyticsProjectId) return; }
  setMain('cust', loader());
  try {
    const data = await api(`/friction?projectId=${_analyticsProjectId}&days=30`);
    renderFrictionPage(data.pages||[], data.days||30);
  } catch(err) { handleFetchError('cust', err); }
}

function renderFrictionPage(pages, days) {
  const frictionColor = score => {
    if (score >= 60) return '#f04438';   // red — high friction
    if (score >= 30) return '#f79009';   // amber — medium
    if (score >= 10) return '#eab308';   // yellow — low
    return '#12b76a';                    // green — minimal
  };
  const frictionLabel = score => {
    if (score >= 60) return 'High';
    if (score >= 30) return 'Medium';
    if (score >= 10) return 'Low';
    return 'Minimal';
  };

  const rows = pages.map(p=>{
    const col = frictionColor(p.frictionScore);
    const lbl = frictionLabel(p.frictionScore);
    const scrollCell = p.avgScrollDepth !== null
      ? `<div style="display:flex;align-items:center;gap:.4rem">
           <div style="flex:1;height:6px;background:var(--surface2);border-radius:3px;overflow:hidden">
             <div style="width:${p.avgScrollDepth}%;height:100%;background:var(--accent);border-radius:3px"></div>
           </div>
           <span style="font-size:.72rem;color:var(--muted)">${p.avgScrollDepth}%</span>
         </div>`
      : '<span style="color:var(--muted2);font-size:.75rem">—</span>';

    return `
      <tr>
        <td>
          <code style="font-size:.78rem;color:var(--cyan)">${esc(p.page)}</code>
        </td>
        <td style="text-align:center">
          <div style="display:inline-flex;align-items:center;gap:.4rem">
            <div style="width:48px;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden">
              <div style="width:${p.frictionScore}%;height:100%;background:${col};border-radius:4px"></div>
            </div>
            <span style="font-size:.8rem;font-weight:700;color:${col}">${p.frictionScore}</span>
            <span style="font-size:.68rem;color:${col};background:${col}22;padding:.1rem .45rem;border-radius:20px">${lbl}</span>
          </div>
        </td>
        <td style="text-align:center;color:${p.rageClicks>0?'#f04438':'var(--muted)'}">
          ${p.rageClicks > 0 ? '😡 ' : ''}${p.rageClicks}
        </td>
        <td style="text-align:center;color:${p.jsErrors>0?'#f79009':'var(--muted)'}">
          ${p.jsErrors > 0 ? '⚠️ ' : ''}${p.jsErrors}
        </td>
        <td style="text-align:center;color:${p.formAbandons>0?'#eab308':'var(--muted)'}">
          ${p.formAbandons > 0 ? '📝 ' : ''}${p.formAbandons}
        </td>
        <td style="min-width:120px">${scrollCell}</td>
        <td style="text-align:center;color:var(--muted);font-size:.78rem">${p.bounceRate}%</td>
        <td style="text-align:center;color:var(--muted);font-size:.78rem">${fmt(p.pageViews)}</td>
      </tr>`;
  }).join('');

  setMain('cust', `
    <div class="page-content">
      <div class="page-hdr">
        <div class="page-hdr-left">
          <h1 class="page-title">🔥 Friction Map</h1>
          <p class="page-subtitle">Pages with the highest user struggle signals · last ${days} days</p>
        </div>
      </div>
      ${pages.length === 0 ? `
        <div class="empty-box">
          <div class="empty-box-icon">🔥</div>
          <h3>No friction data yet</h3>
          <p>Friction signals (rage clicks, JS errors, form abandons) will appear once your tracker captures enough events.</p>
        </div>
      ` : `
        <div class="table-card">
          <div class="tbl-scroll">
            <table>
              <thead>
                <tr>
                  <th>Page</th>
                  <th style="text-align:center">Friction Score</th>
                  <th style="text-align:center" title="Rage clicks — user clicked same area repeatedly">😡 Rage Clicks</th>
                  <th style="text-align:center" title="JavaScript errors">⚠️ JS Errors</th>
                  <th style="text-align:center" title="Form abandons — started but never submitted">📝 Form Abandons</th>
                  <th title="Average % of page scrolled">Avg Scroll</th>
                  <th style="text-align:center" title="Sessions spending under 5 seconds on page">Bounce Rate</th>
                  <th style="text-align:center">Page Views</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
        <div style="margin-top:.75rem;font-size:.73rem;color:var(--muted)">
          Friction Score = weighted composite: rage clicks (35%) + JS errors (30%) + form abandons (20%) + low scroll depth (8%) + bounce rate (7%).
          Higher = more friction. Rows sorted high → low.
        </div>
      `}
    </div>`);
}

/* ══════════════════════════════════════════════════════════════════
   SEO HEALTH
   ════════════════════════════════════════════════════════════════ */
async function loadSEO() {
  if(!_analyticsProjectId) { await _ensureProject(); if(!_analyticsProjectId) return; }
  _seoSitemapUrls = [];
  setMain('cust', loader());
  try {
    const data = await api(`/seo/summary?projectId=${_analyticsProjectId}&days=30`);
    renderSEOPage(data);
  } catch(err) { handleFetchError('cust', err); }
}

function downloadSitemap() {
  if(!_seoSitemapUrls.length) {
    showToast('No sitemap URLs available yet.');
    return;
  }
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
  ];
  _seoSitemapUrls.forEach(entry => {
    const loc = /^https?:\/\//i.test(entry.url || '')
      ? entry.url
      : new URL(entry.page || '/', window.location.origin).href;
    lines.push('  <url>');
    lines.push(`    <loc>${loc.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</loc>`);
    if (entry.lastSeen) lines.push(`    <lastmod>${String(entry.lastSeen).slice(0,10)}</lastmod>`);
    lines.push('  </url>');
  });
  lines.push('</urlset>');

  const blob = new Blob([lines.join('\n')], { type: 'application/xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'sitemap.xml';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast('Sitemap downloaded.');
}

function renderSEOPage(data) {
  const pageScores = data.pageScores || [];
  const trafficSources = data.trafficSources || { organic:0, direct:0, social:0, paid:0, referral:0, total:0 };
  const pageSpeed = data.pageSpeed || [];
  const intentMismatch = data.intentMismatch || [];
  const sitemapUrls = data.sitemapUrls || [];
  const days = data.days || 30;
  _seoSitemapUrls = sitemapUrls;

  const fmtMs = ms => {
    if (ms === null || ms === undefined || !isFinite(ms)) return '—';
    if (ms >= 60000) return (ms / 60000).toFixed(1) + 'm';
    if (ms >= 1000) return (ms / 1000).toFixed(1) + 's';
    return Math.round(ms) + 'ms';
  };
  const scoreColor = score => {
    if (score >= 80) return '#12b76a';
    if (score >= 60) return '#0ea5e9';
    if (score >= 40) return '#f79009';
    return '#f04438';
  };
  const scoreBadge = score => {
    if (score >= 80) return 'badge badge-green';
    if (score >= 60) return 'badge badge-purple';
    if (score >= 40) return 'badge badge-default';
    return 'badge badge-js_error';
  };
  const loadColor = ms => {
    if (ms === null || ms === undefined) return 'var(--muted)';
    if (ms > 3000) return '#f04438';
    if (ms > 1500) return '#f79009';
    return '#12b76a';
  };

  const scoreRows = pageScores.map(p => {
    const color = scoreColor(p.seoScore);
    return `
      <tr>
        <td><code style="font-size:.78rem;color:var(--cyan)">${esc(p.page)}</code></td>
        <td style="min-width:160px">
          <div style="display:flex;align-items:center;gap:.55rem">
            <div style="flex:1;height:8px;background:var(--surface2);border-radius:999px;overflow:hidden">
              <div style="width:${p.seoScore}%;height:100%;background:${color};border-radius:999px"></div>
            </div>
            <span style="font-size:.82rem;font-weight:700;color:${color}">${p.seoScore}</span>
            <span class="${scoreBadge(p.seoScore)}">${esc(p.scoreLabel)}</span>
          </div>
        </td>
        <td style="text-align:center">${fmtMs(p.avgDwellMs)}</td>
        <td style="text-align:center;color:${p.bounceRate > 60 ? '#f04438' : 'var(--muted)'}">${p.bounceRate}%</td>
        <td style="text-align:center">${p.avgScrollDepth !== null ? p.avgScrollDepth + '%' : '—'}</td>
        <td style="text-align:center;color:${loadColor(p.avgLoadMs)}">${fmtMs(p.avgLoadMs)}</td>
        <td style="text-align:center;color:${p.jsErrors > 0 ? '#f79009' : 'var(--muted)'}">${p.jsErrors}</td>
        <td style="text-align:center;color:var(--muted)">${fmt(p.views)}</td>
      </tr>`;
  }).join('');

  const speedRows = pageSpeed.map(p => `
    <tr>
      <td><code style="font-size:.78rem;color:var(--cyan)">${esc(p.page)}</code></td>
      <td style="text-align:center;color:${loadColor(p.avgTtfbMs)}">${fmtMs(p.avgTtfbMs)}</td>
      <td style="text-align:center;color:${loadColor(p.avgDomMs)}">${fmtMs(p.avgDomMs)}</td>
      <td style="text-align:center;color:${loadColor(p.avgLoadMs)}">${fmtMs(p.avgLoadMs)}</td>
      <td style="text-align:center;color:var(--muted)">${p.avgTransferKb !== null && p.avgTransferKb !== undefined ? fmt(p.avgTransferKb) + ' KB' : '—'}</td>
      <td style="text-align:center;color:var(--muted)">${fmt(p.samples || 0)}</td>
    </tr>`).join('');

  const mismatchRows = intentMismatch.map(p => `
    <tr>
      <td><code style="font-size:.76rem;color:var(--cyan)">${esc(p.page)}</code></td>
      <td style="text-align:center">${fmt(p.organicLandings)}</td>
      <td style="text-align:center;color:${p.quickBounceRate >= 60 ? '#f04438' : '#f79009'}">${p.quickBounceRate}%</td>
      <td style="text-align:center">${fmtMs(p.avgDwellMs)}</td>
    </tr>`).join('');

  const totalTrackedPages = pageScores.length;
  const weakPages = pageScores.filter(p => p.seoScore < 60).length;

  setMain('cust', `
    <div class="page-content">
      <div class="page-hdr">
        <div class="page-hdr-left">
          <h1 class="page-title">🔍 SEO Health</h1>
          <p class="page-subtitle">Discoverability, performance, and engagement signals across your pages · last ${days} days</p>
        </div>
        <div class="page-hdr-actions">
          <button class="btn btn-ghost btn-sm" onclick="downloadSitemap()">⬇ Download Sitemap</button>
        </div>
      </div>

      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">Tracked Pages</div>
          <div class="kpi-val">${fmt(totalTrackedPages)}</div>
          <div class="kpi-sub">Pages with SEO metrics</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Organic Sessions</div>
          <div class="kpi-val">${fmt(trafficSources.organic || 0)}</div>
          <div class="kpi-sub">Detected search traffic</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Pages Needing Attention</div>
          <div class="kpi-val">${fmt(weakPages)}</div>
          <div class="kpi-sub">SEO score below 60</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">Sitemap URLs</div>
          <div class="kpi-val">${fmt(sitemapUrls.length)}</div>
          <div class="kpi-sub">Ready to export</div>
        </div>
      </div>

      <div class="chart-grid">
        <div class="chart-card">
          <div class="chart-header">
            <div class="chart-title">Traffic Sources</div>
          </div>
          ${trafficSources.total ? `
            <div class="chart-wrap tall"><canvas id="ch-seo-sources"></canvas></div>
          ` : `
            <div class="empty-box" style="max-width:none;margin:0;padding:2rem 1.5rem">
              <div class="empty-box-icon">🔎</div>
              <h3>No source data yet</h3>
              <p>Traffic sources will appear once session_start events include referrer or UTM data.</p>
            </div>
          `}
        </div>

        <div class="chart-card">
          <div class="chart-header">
            <div class="chart-title">Search Intent Mismatch</div>
          </div>
          ${intentMismatch.length ? `
            <div class="tbl-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Page</th>
                    <th style="text-align:center">Organic Landings</th>
                    <th style="text-align:center">Quick Bounce</th>
                    <th style="text-align:center">Avg Dwell</th>
                  </tr>
                </thead>
                <tbody>${mismatchRows}</tbody>
              </table>
            </div>
          ` : `
            <div class="empty-box" style="max-width:none;margin:0;padding:2rem 1.5rem">
              <div class="empty-box-icon">✅</div>
              <h3>No obvious intent mismatch</h3>
              <p>Organic landing pages are not showing rapid drop-off right now.</p>
            </div>
          `}
        </div>
      </div>

      ${pageSpeed.length ? `
        <div class="table-card">
          <div class="tbl-scroll">
            <table>
              <thead>
                <tr>
                  <th>Page</th>
                  <th style="text-align:center">TTFB</th>
                  <th style="text-align:center">DOM Ready</th>
                  <th style="text-align:center">Full Load</th>
                  <th style="text-align:center">Transfer</th>
                  <th style="text-align:center">Samples</th>
                </tr>
              </thead>
              <tbody>${speedRows}</tbody>
            </table>
          </div>
        </div>
      ` : ''}

      ${pageScores.length ? `
        <div class="table-card">
          <div class="tbl-scroll">
            <table>
              <thead>
                <tr>
                  <th>Page</th>
                  <th>SEO Score</th>
                  <th style="text-align:center">Avg Dwell</th>
                  <th style="text-align:center">Bounce Rate</th>
                  <th style="text-align:center">Avg Scroll</th>
                  <th style="text-align:center">Load</th>
                  <th style="text-align:center">JS Errors</th>
                  <th style="text-align:center">Views</th>
                </tr>
              </thead>
              <tbody>${scoreRows}</tbody>
            </table>
          </div>
        </div>
      ` : `
        <div class="empty-box">
          <div class="empty-box-icon">🔍</div>
          <h3>No SEO data yet</h3>
          <p>SEO scoring appears once page views, exits, and performance signals are captured for your project.</p>
        </div>
      `}
    </div>`);

  if (trafficSources.total) {
    const ctx = document.getElementById('ch-seo-sources');
    if (ctx) {
      _charts.seoSources = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: ['Organic', 'Direct', 'Social', 'Paid', 'Referral'],
          datasets: [{
            data: [trafficSources.organic, trafficSources.direct, trafficSources.social, trafficSources.paid, trafficSources.referral],
            backgroundColor: ['#12b76a', '#6336ff', '#0ea5e9', '#f79009', '#a78bfa'],
            borderWidth: 0,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '64%',
          plugins: {
            legend: { position: 'bottom' },
            tooltip: TT,
          },
        },
      });
    }
  }
}

/* ══════════════════════════════════════════════════════════════════
   USERS
   ════════════════════════════════════════════════════════════════ */
let _usersSearch = '';
let _usersOffset = 0;
const _usersLimit = 50;

async function loadUsers(offset=0) {
  if(!_analyticsProjectId) { await _ensureProject(); if(!_analyticsProjectId) return; }
  _usersOffset = offset;
  if(offset===0) setMain('cust', loader());
  try {
    const q = _usersSearch ? '&q='+encodeURIComponent(_usersSearch) : '';
    const data = await api(`/users?projectId=${_analyticsProjectId}&limit=${_usersLimit}&offset=${offset}${q}`);
    renderUsersPage(data.users||[], data.total||0, offset);
  } catch(err) { handleFetchError('cust', err); }
}

function renderUsersPage(users, total, offset) {
  const rows = users.map(u=>`
    <tr style="cursor:pointer" onclick="showUserProfile('${esc(u.user_id)}')">
      <td>
        <div style="display:flex;align-items:center;gap:.6rem">
          <div style="width:28px;height:28px;border-radius:50%;background:var(--accent);display:flex;align-items:center;justify-content:center;font-size:.72rem;font-weight:700;color:#fff;flex-shrink:0">
            ${esc((u.user_id||'?')[0].toUpperCase())}
          </div>
          <code style="font-size:.78rem;color:var(--cyan)">${esc(u.user_id)}</code>
        </div>
      </td>
      <td style="text-align:center;color:var(--text)">${u.sessions}</td>
      <td style="text-align:center;color:var(--text)">${fmt(u.totalEvents)}</td>
      <td style="color:var(--muted);font-size:.75rem">${fmtDate(u.firstSeen)}</td>
      <td style="color:var(--muted);font-size:.75rem">${fmtDate(u.lastSeen)}</td>
      <td style="text-align:right">
        <button class="btn btn-ghost btn-sm" onclick="event.stopPropagation();showUserProfile('${esc(u.user_id)}')">View →</button>
      </td>
    </tr>`).join('');

  const hasPrev = offset > 0;
  const hasNext = offset + _usersLimit < total;

  setMain('cust', `
    <div class="page-content">
      <div class="page-hdr">
        <div class="page-hdr-left">
          <h1 class="page-title">👥 Users</h1>
          <p class="page-subtitle">Identified users who called <code>SI.identify()</code></p>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:.75rem;margin-bottom:1rem">
        <input type="text" id="users-search" placeholder="Search user ID…"
          value="${esc(_usersSearch)}"
          style="width:100%;max-width:280px;background:var(--surface2);border:1.5px solid var(--border);color:var(--text);border-radius:8px;padding:.45rem .75rem;font-size:.83rem;outline:none"
          onfocus="this.style.borderColor='var(--accent)'" onblur="this.style.borderColor='var(--border)'"
          oninput="_usersSearch=this.value;clearTimeout(_usersSearchTimer);_usersSearchTimer=setTimeout(()=>loadUsers(0),400)"
        />
        <span style="font-size:.78rem;color:var(--muted)">${fmt(total)} user${total!==1?'s':''}</span>
      </div>
      ${users.length === 0 ? `
        <div class="empty-box">
          <div class="empty-box-icon">👥</div>
          <h3>No identified users yet</h3>
          <p>Call <code>SI.identify('user-id')</code> in your tracker script to start profiling individual users.</p>
        </div>
      ` : `
        <div class="table-card">
          <div class="tbl-scroll">
            <table>
              <thead>
                <tr>
                  <th>User ID</th>
                  <th style="text-align:center">Sessions</th>
                  <th style="text-align:center">Events</th>
                  <th>First Seen</th>
                  <th>Last Seen</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </div>
        <div style="display:flex;gap:.5rem;align-items:center;justify-content:flex-end;margin-top:.75rem">
          <span style="font-size:.75rem;color:var(--muted)">
            ${offset+1}–${Math.min(offset+_usersLimit,total)} of ${fmt(total)}
          </span>
          <button class="btn btn-ghost btn-sm" ${hasPrev?'':'disabled'} onclick="loadUsers(${offset-_usersLimit})">← Prev</button>
          <button class="btn btn-ghost btn-sm" ${hasNext?'':'disabled'} onclick="loadUsers(${offset+_usersLimit})">Next →</button>
        </div>
      `}
    </div>`);
}

let _usersSearchTimer = null;

async function showUserProfile(userId) {
  openModal('User: '+userId, `<div id="up-wrap" style="min-height:200px">${loader()}</div>`);
  try {
    const d = await api(`/users/${encodeURIComponent(userId)}?projectId=${_analyticsProjectId}`);
    const u = d.user || {};
    const sessions = d.sessions || [];

    const sessionHtml = sessions.map((sess,idx)=>{
      const eventRows = sess.events.slice(0,30).map(ev=>`
        <tr>
          <td style="color:var(--muted);font-size:.7rem;white-space:nowrap">${fmtTs(ev.timestamp)}</td>
          <td><span style="font-size:.72rem;background:var(--surface2);border:1px solid var(--border);padding:.1rem .4rem;border-radius:4px;color:var(--cyan)">${esc(ev.event)}</span></td>
          <td style="font-size:.75rem;color:var(--text)">${esc(ev.page||'—')}</td>
          <td style="font-size:.72rem;color:var(--muted)">${esc(ev.element||'')}</td>
        </tr>`).join('');
      const moreCount = sess.events.length - 30;
      return `
        <div style="margin-bottom:.875rem">
          <div style="display:flex;align-items:center;gap:.5rem;cursor:pointer;padding:.4rem 0;border-bottom:1px solid var(--border)"
            onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'">
            <span style="font-size:.68rem;background:var(--accent);color:#fff;border-radius:3px;padding:.1rem .4rem">${idx+1}</span>
            <span style="font-size:.78rem;font-weight:600;color:var(--text)">Session ${esc(sess.sessionId.slice(-8))}</span>
            <span style="font-size:.72rem;color:var(--muted)">
              ${fmtDate(sess.firstTs)} · ${sess.events.length} events
            </span>
            <span style="margin-left:auto;font-size:.75rem;color:var(--muted2)">▾</span>
          </div>
          <div style="display:${idx===0?'block':'none'};overflow:auto;margin-top:.4rem">
            <table style="width:100%;border-collapse:collapse">
              <thead><tr>
                <th style="font-size:.7rem;padding:.25rem .4rem;color:var(--muted);font-weight:600;text-align:left">Time</th>
                <th style="font-size:.7rem;padding:.25rem .4rem;color:var(--muted);font-weight:600;text-align:left">Event</th>
                <th style="font-size:.7rem;padding:.25rem .4rem;color:var(--muted);font-weight:600;text-align:left">Page</th>
                <th style="font-size:.7rem;padding:.25rem .4rem;color:var(--muted);font-weight:600;text-align:left">Element</th>
              </tr></thead>
              <tbody>${eventRows}</tbody>
            </table>
            ${moreCount>0?`<div style="font-size:.72rem;color:var(--muted);padding:.4rem">${moreCount} more events not shown</div>`:''}
          </div>
        </div>`;
    }).join('');

    document.getElementById('up-wrap').innerHTML = `
      <div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:1.25rem">
        <div class="kpi-card" style="padding:.7rem .875rem">
          <div class="kpi-label">Sessions</div>
          <div class="kpi-val" style="font-size:1.5rem">${u.sessions||0}</div>
        </div>
        <div class="kpi-card" style="padding:.7rem .875rem">
          <div class="kpi-label">Total Events</div>
          <div class="kpi-val" style="font-size:1.5rem">${fmt(u.totalEvents||0)}</div>
        </div>
        <div class="kpi-card" style="padding:.7rem .875rem">
          <div class="kpi-label">First Seen</div>
          <div class="kpi-val" style="font-size:.9rem">${fmtDate(u.firstSeen)}</div>
        </div>
        <div class="kpi-card" style="padding:.7rem .875rem">
          <div class="kpi-label">Last Seen</div>
          <div class="kpi-val" style="font-size:.9rem">${fmtDate(u.lastSeen)}</div>
        </div>
      </div>
      <div style="font-size:.82rem;font-weight:700;color:var(--text);margin-bottom:.6rem">Session History (newest first)</div>
      <div style="max-height:400px;overflow-y:auto">
        ${sessions.length===0
          ? '<div style="color:var(--muted);font-size:.82rem">No sessions found.</div>'
          : sessionHtml}
      </div>`;
  } catch(err) {
    document.getElementById('up-wrap').innerHTML=`<div style="color:var(--red)">${esc(err.message)}</div>`;
  }
}

function fmtTs(ts) {
  if(!ts) return '—';
  try {
    const d = new Date(Number(ts) || ts);
    if(isNaN(d.getTime())) return String(ts).slice(11,19) || '—';
    return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});
  } catch { return '—'; }
}

/* ──────────────────────── AI Insights ───────────────────────────── */
let _aiChatHistory = [];

// SSE streaming fetch — onToken(str) per token, onDone() when complete
function streamResponse(path, body, onToken, onDone, onError) {
  fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(_jwt ? { Authorization: `Bearer ${_jwt}` } : {}) },
    body: JSON.stringify(body),
  }).then(res => {
    if (!res.ok) return res.json().then(d => onError(new Error(d?.error || `Server error ${res.status}`))).catch(() => onError(new Error(`Server error ${res.status}`)));
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buf = '';
    function pump() {
      reader.read().then(({ value, done }) => {
        if (done) { onDone(); return; }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') { onDone(); return; }
          try {
            const json = JSON.parse(data);
            if (json.error) { onError(new Error(json.error)); return; }
            if (json.token) onToken(json.token);
          } catch (_) {}
        }
        pump();
      }).catch(onError);
    }
    pump();
  }).catch(onError);
}

function _aiStartStream(resultId, btnId) {
  const r = document.getElementById(resultId), b = document.getElementById(btnId);
  if (r) { r.style.display = 'block'; r.innerHTML = `<div class="ai-stream-box" id="${resultId}-text"></div>`; }
  if (b) b.disabled = true;
  return document.getElementById(resultId + '-text');
}

function _aiEndStream(resultId, btnId, fullText) {
  const el = document.getElementById(resultId + '-text'), b = document.getElementById(btnId);
  if (el) el.innerHTML = _aiFormatText(fullText);
  if (b)  b.disabled = false;
}

function _aiFormatText(text) {
  return text.split('\n').map(line => {
    line = esc(line);
    if (/^(INSIGHTS:|RECOMMENDATIONS:|PAGE:|DIAGNOSIS:|FIX:|SUMMARY:)/i.test(line.trim()))
      return `<div class="ai-lbl">${line.trim()}</div>`;
    if (/^[•\-]/.test(line.trim()))
      return `<div class="ai-bullet"><span class="ai-dot">•</span><span>${line.replace(/^[•\-]\s*/,'')}</span></div>`;
    if (!line.trim()) return `<div class="ai-gap"></div>`;
    return `<div class="ai-line">${line}</div>`;
  }).join('');
}

async function loadAI() {
  if (!_analyticsProjectId) { await _ensureProject(); if (!_analyticsProjectId) return; }
  _aiChatHistory = [];

  // Fetch recent sessions for dropdown
  let sessionOptions = `<option value="">Pick a session…</option>`;
  try {
    const sd = await api(`/ai/sessions?projectId=${_analyticsProjectId}`);
    (sd.sessions || []).forEach(s => {
      sessionOptions += `<option value="${esc(s.session_id)}">${esc(s.session_id.slice(0,28)+'…')}  ·  ${timeAgo(s.started_at)}  ·  ${s.event_count} events</option>`;
    });
  } catch (_) {}

  setMain('cust', `
    <style>
      .ai-stream-box{background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:.875rem 1rem;min-height:36px}
      .ai-lbl{font-weight:700;font-size:.78rem;color:var(--cyan);margin-top:.7rem;margin-bottom:.15rem;text-transform:uppercase;letter-spacing:.05em}
      .ai-bullet{display:flex;gap:.45rem;font-size:.84rem;color:var(--text);margin:.2rem 0;line-height:1.55}
      .ai-dot{color:var(--accent);flex-shrink:0;margin-top:.05rem}
      .ai-line{font-size:.84rem;color:var(--text);line-height:1.6;margin:.1rem 0}
      .ai-gap{height:.3rem}
      .ai-cursor{display:inline-block;width:2px;height:.9em;background:var(--accent);margin-left:2px;vertical-align:text-bottom;animation:aiCursorBlink .6s step-end infinite}
      @keyframes aiCursorBlink{50%{opacity:0}}
      .ai-card{background:var(--surface);border:1.5px solid var(--border);border-radius:12px;padding:1.25rem;margin-bottom:1rem}
      .ai-card-l-cyan{border-left:4px solid var(--cyan)}
      .ai-card-l-orange{border-left:4px solid #f97316}
      .ai-card-l-purple{border-left:4px solid #a855f7}
      .ai-card-l-accent{border-left:4px solid var(--accent)}
      .ai-chip{display:inline-block;padding:.28rem .72rem;background:var(--surface2);border:1px solid var(--border);border-radius:20px;font-size:.75rem;color:var(--text);cursor:pointer;transition:background .15s,color .15s}
      .ai-chip:hover{background:var(--accent);color:#fff;border-color:var(--accent)}
      #ai-chat-messages{max-height:340px;overflow-y:auto;display:flex;flex-direction:column;gap:.4rem;padding:.25rem 0}
      .chat-row{display:flex}.chat-row.user{justify-content:flex-end}.chat-row.ai{justify-content:flex-start}
      .chat-bbl{max-width:82%;padding:.55rem .9rem;border-radius:14px;font-size:.84rem;line-height:1.6;word-break:break-word;white-space:pre-wrap}
      .chat-bbl.user{background:var(--accent);color:#fff;border-bottom-right-radius:4px}
      .chat-bbl.ai{background:var(--surface2);color:var(--text);border-bottom-left-radius:4px;border:1px solid var(--border)}
    </style>
    <div class="page-content">
      <div class="page-header" style="margin-bottom:1.5rem">
        <h2 style="font-size:1.25rem;font-weight:700;margin:0">✦ AI Insights</h2>
        <p style="color:var(--muted);font-size:.82rem;margin:.25rem 0 0">Powered by Ollama · llama3.2 · Analysis based on your real data</p>
      </div>

      <!-- Analytics Insights -->
      <div class="ai-card ai-card-l-cyan">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
          <div>
            <div style="font-weight:700;font-size:.95rem">📊 Analytics Insights</div>
            <div style="color:var(--muted);font-size:.78rem;margin-top:.15rem">Plain-English summary of the last 30 days</div>
          </div>
          <div style="display:flex;gap:.4rem;align-items:center">
            <button class="btn btn-ghost btn-sm" id="btn-ai-ins-regen" onclick="aiRunInsights()" title="Regenerate" style="display:none">↺</button>
            <button class="btn btn-solid btn-sm" id="btn-ai-insights" onclick="aiRunInsights()">Generate</button>
          </div>
        </div>
        <div id="ai-insights-result" style="display:none"></div>
      </div>

      <!-- Friction Diagnoses -->
      <div class="ai-card ai-card-l-orange">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:.75rem">
          <div>
            <div style="font-weight:700;font-size:.95rem">🔥 Friction Diagnoses</div>
            <div style="color:var(--muted);font-size:.78rem;margin-top:.15rem">Root cause + fix for each high-friction page</div>
          </div>
          <div style="display:flex;gap:.4rem;align-items:center">
            <button class="btn btn-ghost btn-sm" id="btn-ai-fri-regen" onclick="aiRunFriction()" title="Regenerate" style="display:none">↺</button>
            <button class="btn btn-solid btn-sm" id="btn-ai-friction" onclick="aiRunFriction()">Diagnose</button>
          </div>
        </div>
        <div id="ai-friction-result" style="display:none"></div>
      </div>

      <!-- Session Summarizer -->
      <div class="ai-card ai-card-l-purple">
        <div style="font-weight:700;font-size:.95rem;margin-bottom:.2rem">🎬 Session Summarizer</div>
        <div style="color:var(--muted);font-size:.78rem;margin-bottom:.7rem">What did this user do?</div>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          <select id="ai-session-select" style="flex:1;min-width:180px;padding:.42rem .6rem;background:var(--surface2);border:1px solid var(--border);border-radius:6px;color:var(--text);font-size:.8rem">${sessionOptions}</select>
          <div style="display:flex;gap:.4rem">
            <button class="btn btn-ghost btn-sm" id="btn-ai-sess-regen" onclick="aiRunSession()" title="Regenerate" style="display:none">↺</button>
            <button class="btn btn-solid btn-sm" id="btn-ai-session" onclick="aiRunSession()">Summarize</button>
          </div>
        </div>
        <div id="ai-session-result" style="display:none;margin-top:.75rem"></div>
      </div>

      <!-- Chatbot -->
      <div class="ai-card ai-card-l-accent">
        <div style="font-weight:700;font-size:.95rem;margin-bottom:.2rem">💬 Ask TrackSense AI</div>
        <div style="color:var(--muted);font-size:.78rem;margin-bottom:.7rem">Context-aware conversation · remembers your questions</div>
        <div id="ai-chat-messages"></div>
        <div style="display:flex;flex-wrap:wrap;gap:.35rem;margin:.65rem 0 .55rem">
          <span class="ai-chip" onclick="aiChatChip(this)">What's my bounce rate?</span>
          <span class="ai-chip" onclick="aiChatChip(this)">Which page loses most users?</span>
          <span class="ai-chip" onclick="aiChatChip(this)">What should I fix first?</span>
          <span class="ai-chip" onclick="aiChatChip(this)">How are my goals performing?</span>
          <span class="ai-chip" onclick="aiChatChip(this)">Summarize my last 30 days</span>
        </div>
        <div style="display:flex;gap:.5rem">
          <input id="ai-chat-input" type="text" placeholder="Ask anything about your analytics…"
            style="flex:1;padding:.5rem .75rem;background:var(--surface2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-size:.84rem"
            onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();aiChatSend()}">
          <button class="btn btn-solid" id="btn-ai-chat" onclick="aiChatSend()" style="padding:.48rem 1.1rem;font-size:.84rem">Send</button>
        </div>
      </div>
    </div>
  `);
  aiChatInit();
}

// ── Streaming runs ─────────────────────────────────────────────────────────────
async function aiRunInsights() {
  if (!_analyticsProjectId) return;
  const el = _aiStartStream('ai-insights-result', 'btn-ai-insights');
  document.getElementById('btn-ai-ins-regen').style.display = 'none';
  let full = '';
  streamResponse('/ai/insights/stream', { projectId: _analyticsProjectId },
    tok => { full += tok; if (el) el.innerHTML = _aiFormatText(full) + '<span class="ai-cursor"></span>'; },
    ()  => { _aiEndStream('ai-insights-result', 'btn-ai-insights', full); document.getElementById('btn-ai-ins-regen').style.display = ''; },
    err => { const r = document.getElementById('ai-insights-result'); if (r) r.innerHTML = `<div style="color:var(--red);font-size:.84rem">⚠ ${esc(err.message)}</div>`; document.getElementById('btn-ai-insights').disabled = false; }
  );
}

async function aiRunFriction() {
  if (!_analyticsProjectId) return;
  const el = _aiStartStream('ai-friction-result', 'btn-ai-friction');
  document.getElementById('btn-ai-fri-regen').style.display = 'none';
  let full = '';
  streamResponse('/ai/friction/stream', { projectId: _analyticsProjectId },
    tok => { full += tok; if (el) el.innerHTML = _aiFormatText(full) + '<span class="ai-cursor"></span>'; },
    ()  => { _aiEndStream('ai-friction-result', 'btn-ai-friction', full); document.getElementById('btn-ai-fri-regen').style.display = ''; },
    err => { const r = document.getElementById('ai-friction-result'); if (r) r.innerHTML = `<div style="color:var(--red);font-size:.84rem">⚠ ${esc(err.message)}</div>`; document.getElementById('btn-ai-friction').disabled = false; }
  );
}

async function aiRunSession() {
  if (!_analyticsProjectId) return;
  const sel = document.getElementById('ai-session-select');
  const sessionId = sel ? sel.value.trim() : '';
  if (!sessionId) { if (sel) sel.focus(); return; }
  const r = document.getElementById('ai-session-result'), b = document.getElementById('btn-ai-session');
  if (r) { r.style.display = 'block'; r.innerHTML = `<div class="ai-stream-box" id="ai-session-text" style="font-size:.85rem;line-height:1.7"></div>`; }
  if (b) b.disabled = true;
  document.getElementById('btn-ai-sess-regen').style.display = 'none';
  const el = document.getElementById('ai-session-text');
  let full = '';
  streamResponse('/ai/session-summary/stream', { projectId: _analyticsProjectId, sessionId },
    tok => { full += tok; if (el) el.textContent = full; },
    ()  => { if (el) el.textContent = full; if (b) b.disabled = false; document.getElementById('btn-ai-sess-regen').style.display = ''; },
    err => { if (r) r.innerHTML = `<div style="color:var(--red);font-size:.84rem">⚠ ${esc(err.message)}</div>`; if (b) b.disabled = false; }
  );
}

// ── Chatbot ────────────────────────────────────────────────────────────────────
function aiChatInit() {
  _aiChatHistory = [];
  const el = document.getElementById('ai-chat-messages');
  if (el) el.innerHTML = `
    <div class="chat-row ai">
      <div class="chat-bbl ai">👋 Hi! I'm TrackSense AI. I have full access to your project's analytics — sessions, friction signals, top pages, event data, and more. Ask me anything!</div>
    </div>`;
}

function _aiChatScroll() {
  const el = document.getElementById('ai-chat-messages');
  if (el) el.scrollTop = el.scrollHeight;
}

function aiChatChip(el) {
  const input = document.getElementById('ai-chat-input');
  if (input) { input.value = el.textContent; input.focus(); }
}

async function aiChatSend() {
  if (!_analyticsProjectId) return;
  const input   = document.getElementById('ai-chat-input');
  const sendBtn = document.getElementById('btn-ai-chat');
  const question = (input?.value || '').trim();
  if (!question) { input?.focus(); return; }

  _aiChatHistory.push({ role: 'user', content: question });
  if (input) input.value = '';
  if (sendBtn) sendBtn.disabled = true;

  const msgEl = document.getElementById('ai-chat-messages');
  if (msgEl) {
    const userRow = document.createElement('div');
    userRow.className = 'chat-row user';
    userRow.innerHTML = `<div class="chat-bbl user">${esc(question)}</div>`;
    msgEl.appendChild(userRow);
    _aiChatScroll();
  }

  const tempId = 'ai-bbl-' + Date.now();
  if (msgEl) {
    const aiRow = document.createElement('div');
    aiRow.className = 'chat-row ai';
    aiRow.innerHTML = `<div class="chat-bbl ai" id="${tempId}"><span class="ai-cursor"></span></div>`;
    msgEl.appendChild(aiRow);
    _aiChatScroll();
  }

  const bubble   = document.getElementById(tempId);
  const messages = _aiChatHistory.filter(m => m.role === 'user' || m.role === 'assistant');
  let aiText = '';

  fetch(API + '/ai/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(_jwt ? { Authorization: `Bearer ${_jwt}` } : {}) },
    body: JSON.stringify({ projectId: _analyticsProjectId, messages }),
  }).then(res => {
    if (!res.ok) return res.json().then(d => { throw new Error(d?.error || `Error ${res.status}`); });
    const reader = res.body.getReader(), decoder = new TextDecoder();
    let buf = '';
    function pump() {
      reader.read().then(({ value, done }) => {
        if (done) { _aiChatHistory.push({ role: 'assistant', content: aiText }); if (bubble) bubble.textContent = aiText; if (sendBtn) sendBtn.disabled = false; _aiChatScroll(); return; }
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n'); buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') { _aiChatHistory.push({ role: 'assistant', content: aiText }); if (bubble) bubble.textContent = aiText; if (sendBtn) sendBtn.disabled = false; _aiChatScroll(); return; }
          try {
            const json = JSON.parse(data);
            if (json.error) throw new Error(json.error);
            if (json.token) { aiText += json.token; if (bubble) { bubble.textContent = aiText; bubble.insertAdjacentHTML('beforeend', '<span class="ai-cursor"></span>'); _aiChatScroll(); } }
          } catch (e) { if (e.message && !e.message.startsWith('JSON')) throw e; }
        }
        pump();
      }).catch(err => { if (bubble) bubble.innerHTML = `<span style="color:var(--red)">⚠ ${esc(err.message)}</span>`; if (sendBtn) sendBtn.disabled = false; });
    }
    pump();
  }).catch(err => { if (bubble) bubble.innerHTML = `<span style="color:var(--red)">⚠ ${esc(err.message)}</span>`; if (sendBtn) sendBtn.disabled = false; });
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
