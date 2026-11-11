/* Goat Crew DM screen — frontend (vanilla JS). Original campaign-app UI plus Map, DM Chat, Settings. */
'use strict';

// ---------- tiny helpers ----------
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function toast(msg, ms = 2200) {
  const host = $('#toasts'); if (!host) return;
  const t = document.createElement('div'); t.className = 'toast'; t.setAttribute('role', 'status'); t.textContent = msg;
  host.appendChild(t);
  while (host.children.length > 4) host.firstChild.remove();
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 260); }, ms);
}
/* api() + connectSSE() come from gh.js (GitHub data layer), loaded before this file. */

// ---------- minimal markdown renderer ----------
function md(src) {
  if (!src) return '';
  const lines = String(src).split('\n');
  let out = [], para = [], inList = null, inQuote = false, inTable = false;
  const inline = s => esc(s)
    .replace(/\*\*\*(.+?)\*\*\*/g, '<b><i>$1</i></b>')
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/(^|[\s(])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/&lt;span\b.*?&gt;/g, '').replace(/&lt;\/span&gt;/g, '');
  const flushPara = () => { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } };
  const closeAll = () => {
    flushPara();
    if (inList) { out.push(inList === 'ul' ? '</ul>' : '</ol>'); inList = null; }
    if (inQuote) { out.push('</blockquote>'); inQuote = false; }
    if (inTable) { out.push('</table>'); inTable = false; }
  };
  for (let raw of lines) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) { closeAll(); continue; }
    let m;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) { closeAll(); const l = Math.min(m[1].length + 1, 6); out.push(`<h${l}>${inline(m[2].replace(/\*\*/g, ''))}</h${l}>`); continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { closeAll(); out.push('<hr>'); continue; }
    if (line.includes('|') && /^\s*\|.*\|\s*$/.test(line)) {
      if (/^\s*\|[\s:|-]+\|\s*$/.test(line)) continue; // separator row
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map(c => inline(c.trim()));
      if (!inTable) { closeAll(); out.push('<table>'); inTable = true; out.push('<tr>' + cells.map(c => `<th>${c}</th>`).join('') + '</tr>'); }
      else out.push('<tr>' + cells.map(c => `<td>${c}</td>`).join('') + '</tr>');
      continue;
    }
    if (inTable) { out.push('</table>'); inTable = false; }
    if ((m = line.match(/^\s*>\s?(.*)$/))) {
      flushPara(); if (inList) { out.push(inList === 'ul' ? '</ul>' : '</ol>'); inList = null; }
      if (!inQuote) { out.push('<blockquote>'); inQuote = true; }
      if (m[1].trim()) out.push('<p>' + inline(m[1].replace(/^[-*]\s+/, '')) + '</p>');
      continue;
    }
    if (inQuote) { out.push('</blockquote>'); inQuote = false; }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/))) {
      flushPara(); if (inList !== 'ul') { if (inList) out.push('</ol>'); out.push('<ul>'); inList = 'ul'; }
      out.push('<li>' + inline(m[1]) + '</li>'); continue;
    }
    if ((m = line.match(/^\s*\d+[.)]\s+(.*)$/))) {
      flushPara(); if (inList !== 'ol') { if (inList) out.push('</ul>'); out.push('<ol>'); inList = 'ol'; }
      out.push('<li>' + inline(m[1]) + '</li>'); continue;
    }
    if (inList && /^\s{2,}/.test(raw)) { out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, '<br>' + inline(line.trim()) + '</li>'); continue; }
    if (inList) { out.push(inList === 'ul' ? '</ul>' : '</ol>'); inList = null; }
    para.push(line);
  }
  closeAll();
  return `<div class="md">${out.join('\n')}</div>`;
}

// ---------- state ----------
const S = { me: null, tab: 'party', view: null, cache: {}, search: {}, pin: localStorage.getItem('gc_pin') || '' };

async function load(entity) {
  S.cache[entity] = await api('/api/' + entity);
  return S.cache[entity];
}

// ---------- login (GitHub token + which DM you are) ----------
async function boot() {
  try { S.me = await api('/api/me'); showMain(); }
  catch (_) { showLogin(); }
}
async function showLogin() {
  $('#main').classList.add('hidden');
  $('#login').classList.remove('hidden');
  $('#login-err').textContent = '';
  const setup = await api('/api/setup');
  $('#login-owner').value = setup.owner; $('#login-repo').value = setup.repo; $('#login-branch').value = setup.branch;
  $('#login-token').value = '';
  $('#login-token').placeholder = setup.hasToken ? 'Token saved on this device — leave blank to keep it' : 'github_pat_…';
  await loadLoginUsers();
}
async function loadLoginUsers() {
  const sel = $('#login-user');
  const typed = $('#login-token').value.trim();
  if (!typed && !(await api('/api/setup')).hasToken) { sel.innerHTML = '<option value="">— paste your token first —</option>'; return; }
  sel.innerHTML = '<option value="">checking token…</option>';
  try {
    await api('/api/repo', { method: 'POST', body: { owner: $('#login-owner').value, repo: $('#login-repo').value, branch: $('#login-branch').value } });
    if (typed) await api('/api/token', { method: 'POST', body: { token: typed } });
    const users = (await api('/api/users/list')).filter(u => u.role === 'dm');
    sel.innerHTML = users.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('');
    const saved = localStorage.getItem('gc_user');
    if (saved && users.some(u => u.id === saved)) sel.value = saved;
    $('#login-err').textContent = '';
  } catch (e) { sel.innerHTML = '<option value="">— token rejected —</option>'; $('#login-err').textContent = e.message || 'Token rejected'; }
}
$('#login-btn').onclick = doLogin;
$('#login-token').addEventListener('change', loadLoginUsers);
$('#login-token').addEventListener('keydown', e => { if (e.key === 'Enter') loadLoginUsers(); });
async function doLogin() {
  $('#login-err').textContent = '';
  try {
    if (!$('#login-user').value) await loadLoginUsers();
    if (!$('#login-user').value) return;
    await api('/api/login', { method: 'POST', body: { userId: $('#login-user').value, token: $('#login-token').value } });
    localStorage.setItem('gc_user', $('#login-user').value);
    S.me = await api('/api/me');
    showMain();
  } catch (e) { $('#login-err').textContent = e.message || 'Could not log in'; }
}
$('#logout').onclick = async () => { await api('/api/logout', { method: 'POST' }); location.reload(); };

// ---------- main shell ----------
function showMain() {
  $('#login').classList.add('hidden');
  $('#main').classList.remove('hidden');
  $('#whoami').textContent = S.me.name;
  if (S.me.role === 'dm') $$('.tab.dm-only').forEach(t => t.classList.remove('hidden'));
  S.tab = localStorage.getItem('gc_tab') || 'map';
  if (['dm', 'arc'].includes(S.tab) && S.me.role !== 'dm') S.tab = 'party';
  connectSSE();
  render();
}
$$('#tabs .tab').forEach(b => b.onclick = () => {
  S.tab = b.dataset.tab; S.view = null; S.formOpen = false;
  localStorage.setItem('gc_tab', S.tab);
  render();
});
$('#pin-pick').onchange = e => setPin(e.target.value);
const TAB_ICONS = { map: 'map', chat: 'chat', party: 'users', battle: 'swords', dice: 'dice', journal: 'book', codex: 'scroll', quests: 'flag', board: 'pin', arc: 'route', notes: 'notebook', dm: 'crown', settings: 'settings' };
$$('#tabs .tab').forEach(b => { const n = TAB_ICONS[b.dataset.tab]; if (n) b.innerHTML = ic(n) + `<span>${esc(b.textContent.trim())}</span>`; });
// Keyboard: N = next turn when the Battle panel is showing, / = jump to the DM chat box, Esc = close the map side panel / leave a field
document.addEventListener('keydown', e => {
  const tag = (e.target && e.target.tagName || '').toUpperCase();
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || (e.target && e.target.isContentEditable);
  if (e.key === 'Escape') { const side = $('#map-side'); if (side && !side.classList.contains('hidden') && typeof closeSide === 'function') closeSide(); if (typing) e.target.blur(); return; }
  if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'n' || e.key === 'N') { const b = $('#b-next'); if (b) { e.preventDefault(); b.click(); } }
  else if (e.key === '/') { e.preventDefault(); const t = $('#chat-text'); if (t) t.focus(); else { S.tab = 'chat'; localStorage.setItem('gc_tab', 'chat'); render().then(() => { const x = $('#chat-text'); if (x) x.focus(); }); } }
});

// ---------- render dispatch ----------
/* Renders run one at a time and only the latest request is honoured, so switching tabs while a
   slow render (e.g. the map image) is still in flight can never let the stale render clobber the new tab. */
let renderChain = Promise.resolve(), renderSeq = 0;
/* Re-render the panel that holds container c: the right rail if c is inside it, else the main tab. */
const refresh = c => (c && c.closest && c.closest('#rail')) ? renderRail() : render();
function render() {
  const seq = ++renderSeq;
  renderChain = renderChain.then(async () => { if (seq === renderSeq) await renderOnce(); }).catch(e => console.error('render', e));
  return renderChain;
}
async function renderInto(c, tab) {
  c.innerHTML = '<p class="muted">Loading…</p>';
  try {
    if (tab === 'party') await renderParty(c);
    else if (tab === 'battle') await renderBattle(c);
    else if (tab === 'dice') await renderDice(c);
    else if (tab === 'journal') await renderJournal(c);
    else if (tab === 'codex') await renderCodex(c);
    else if (tab === 'quests') await renderQuests(c);
    else if (tab === 'board') await renderBoard(c);
    else if (tab === 'notes') await renderNotes(c);
    else if (tab === 'arc') await renderArc(c);
    else if (tab === 'dm') await renderDM(c);
    else if (tab === 'map') await renderMap(c);
    else if (tab === 'chat') await renderChat(c);
    else if (tab === 'settings') await renderSettings(c);
  } catch (e) { c.innerHTML = `<p class="err">Failed to load: ${esc(e.message)}</p>`; }
}
async function renderOnce() {
  $$('#tabs .tab').forEach(b => b.classList.toggle('active', b.dataset.tab === S.tab));
  document.body.classList.toggle('tab-map', S.tab === 'map');
  await syncRail(); // if the main tab is the pinned one, empty the rail first so element ids stay unique
  await renderInto($('#content'), S.tab);
  await syncRail();
}

/* ---------- right rail: one pinned panel that stays open beside whatever tab is active ----------
   Only panels whose element ids don't clash with the other tabs are offered. */
const RAIL_TABS = { chat: 'DM Chat', notes: 'My Notes', battle: 'Battle', dice: 'Dice', party: 'Party', map: 'Map' };
async function syncRail(force) {
  const rail = $('#rail');
  const show = !!(S.pin && RAIL_TABS[S.pin] && S.pin !== S.tab);
  document.body.classList.toggle('has-rail', show);
  rail.classList.toggle('hidden', !show);
  const pick = $('#pin-pick');
  if (pick && pick.value !== (S.pin || '')) pick.value = S.pin || '';
  if (!show) { if (rail.dataset.tab) { rail.innerHTML = ''; delete rail.dataset.tab; } return; }
  if (rail.dataset.tab === S.pin && !force) return; // keep the rail's state (chat draft, scroll) across main-tab switches
  rail.dataset.tab = S.pin;
  rail.innerHTML = `<div class="rail-head"><b>${ic(TAB_ICONS[S.pin])} ${RAIL_TABS[S.pin]}</b><button class="btn small ghost" id="rail-unpin" title="Unpin this panel">${ic('x')} unpin</button></div><div class="rail-body"></div>`;
  $('#rail-unpin').onclick = () => setPin('');
  await renderInto(rail.querySelector('.rail-body'), S.pin);
}
function setPin(tab) { S.pin = RAIL_TABS[tab] ? tab : ''; localStorage.setItem('gc_pin', S.pin); syncRail(true); }
function renderRail() { return syncRail(true); }

// ---------- PARTY ----------
async function renderParty(c) {
  const chars = await load('characters');
  if (S.view && S.view.startsWith('char:')) return renderCharDetail(c, chars.find(x => x.id === S.view.slice(5)));
  c.innerHTML = `<div class="grid">` + chars.map(ch => {
    const hp = ch.hpMax ? Math.max(0, Math.min(100, 100 * (ch.hpCurrent ?? 0) / ch.hpMax)) : null;
    return `<div class="card char-card" data-id="${ch.id}">
      ${ch.portrait ? `<img class="portrait" src="${esc(ch.portrait)}" alt="">` : `<div class="portrait-ph">${esc((ch.name || '?')[0])}</div>`}
      <div style="flex:1">
        <h3>${esc(ch.name)} ${ch.editable ? ic('pencil', 'ic-muted') : ''}</h3>
        <div class="statline"><span>${esc(ch.race)} ${esc(ch.klass)}</span><span>Lv <b>${ch.level ?? '?'}</b></span>
          ${ch.ac != null ? `<span>AC <b>${ch.ac}</b></span>` : ''}
          ${ch.hpMax ? `<span>HP <b>${ch.hpCurrent ?? '?'}</b>/${ch.hpMax}</span>` : ''}</div>
        ${hp !== null ? `<div class="hp-bar"><div class="${hp < 30 ? 'low' : ''}" style="width:${hp}%"></div></div>` : ''}
      </div></div>`;
  }).join('') + `</div>`;
  $$('.char-card').forEach(el => el.onclick = () => { S.view = 'char:' + el.dataset.id; refresh(c); });
}

function statBox(ch, field, label, ed) {
  const v = ch[field] ?? '';
  return `<div class="stat-box"><label>${label}</label>
    <input data-f="${field}" value="${v}" inputmode="numeric" ${ed ? '' : 'disabled'}>
    ${ed ? `<div class="steppers"><button class="btn step" data-step="-1" data-f="${field}">−</button><button class="btn step" data-step="1" data-f="${field}">+</button></div>` : ''}</div>`;
}
async function renderCharDetail(c, ch) {
  if (!ch) { S.view = null; return renderParty(c); }
  const ed = ch.editable;
  const hist = await api(`/api/characters/${ch.id}/history`);
  c.innerHTML = `
    <div class="toolbar"><button class="btn small ghost" id="back">← Party</button></div>
    <div class="card">
      <div class="row">
        ${ch.portrait ? `<img class="portrait" src="${esc(ch.portrait)}" style="width:72px;height:72px;border-radius:50%">` : ''}
        <div><h2 style="margin:0">${esc(ch.name)}</h2>
        <div class="muted">${esc(ch.race)} ${esc(ch.klass)}${ch.player ? ` · played by ${esc(ch.player)}` : ''}</div></div>
      </div>
      <div class="stat-editor">
        ${statBox(ch, 'level', 'Level', ed)}${statBox(ch, 'ac', 'AC', ed)}
        ${statBox(ch, 'hpCurrent', 'HP now', ed)}${statBox(ch, 'hpMax', 'HP max', ed)}${statBox(ch, 'gold', 'Gold', ed)}
      </div>
      <div class="row"><label class="muted">Conditions:</label>
        <input id="conditions" style="flex:1" value="${esc(ch.conditions || '')}" placeholder="poisoned, inspired…" ${ed ? '' : 'disabled'}></div>
      ${ed ? '<p class="muted" style="font-size:13px">Changes save automatically and appear on everyone\'s screen.</p>' : ''}
    </div>
    ${S.me.role === 'dm' ? `<div class="card dm"><h3>DM notes <span class="badge dm">DM only</span></h3>
      <textarea id="dmNotes" placeholder="Secrets about ${esc(ch.name)}…">${esc(ch.dmNotes || '')}</textarea>
      <button class="btn small dm" id="save-dmnotes">Save DM notes</button></div>` : ''}
    <details class="collapse" open><summary>Character sheet & backstory ${ed ? '<button class="btn small" id="edit-content">Edit</button>' : ''}</summary>
      <div class="card" id="content-view">${md(ch.content)}</div></details>
    ${hist.length ? `<details class="collapse"><summary>Edit history (${hist.length})</summary><div class="card">` +
      hist.map(h => `<div class="hist">${new Date(h.ts).toLocaleString()} — <b>${esc(h.user)}</b> changed <b>${esc(h.field)}</b>: ${esc(JSON.stringify(h.old))} → ${esc(JSON.stringify(h.new))}</div>`).join('') + '</div></details>' : ''}
  `;
  $('#back').onclick = () => { S.view = null; refresh(c); };
  const patch = async body => {
    const updated = await api(`/api/characters/${ch.id}`, { method: 'PATCH', body });
    Object.assign(ch, updated);
  };
  if (ed) {
    $$('.stat-box input').forEach(inp => inp.onchange = () => {
      const v = inp.value.trim() === '' ? null : Number(inp.value);
      patch({ [inp.dataset.f]: isNaN(v) ? null : v });
    });
    $$('.btn.step').forEach(b => b.onclick = () => {
      const f = b.dataset.f;
      const cur = Number(ch[f] ?? 0) + Number(b.dataset.step);
      patch({ [f]: cur }).then(() => { $(`.stat-box input[data-f=${f}]`).value = cur; });
    });
    $('#conditions').onchange = e => patch({ conditions: e.target.value });
    $('#edit-content').onclick = e => {
      e.preventDefault(); e.stopPropagation();
      const view = $('#content-view');
      view.innerHTML = `<textarea id="content-ta" style="min-height:320px">${esc(ch.content)}</textarea>
        <div class="row"><button class="btn primary" id="save-content">Save</button><button class="btn" id="cancel-content">Cancel</button></div>`;
      $('#save-content').onclick = async () => { await patch({ content: $('#content-ta').value }); refresh(c); };
      $('#cancel-content').onclick = () => refresh(c);
    };
  }
  if (S.me.role === 'dm') $('#save-dmnotes').onclick = async () => { await patch({ dmNotes: $('#dmNotes').value }); toast('DM notes saved'); };
}

// ---------- generic entry editor form ----------
function entryForm(fields, values = {}) {
  return fields.map(f => {
    const v = values[f.key] ?? f.def ?? '';
    if (f.type === 'textarea') return `<label class="muted">${f.label}</label><textarea data-k="${f.key}" ${f.ph ? `placeholder="${f.ph}"` : ''}>${esc(v)}</textarea>`;
    // options: plain strings, or { value, label } when the stored value isn't what people should read
    if (f.type === 'select') return `<label class="muted">${f.label}</label> <select data-k="${f.key}">${f.options.map(o => {
      const val = o.value ?? o, lab = o.label ?? o;
      return `<option value="${esc(val)}" ${val === v ? 'selected' : ''}>${esc(lab)}</option>`;
    }).join('')}</select>`;
    if (f.type === 'check') return `<label class="row" style="gap:6px"><input type="checkbox" data-k="${f.key}" ${v ? 'checked' : ''}> ${f.label}</label>`;
    return `<label class="muted">${f.label}</label><input data-k="${f.key}" value="${esc(v)}" ${f.ph ? `placeholder="${f.ph}"` : ''}>`;
  }).join('');
}
function formValues(container) {
  const out = {};
  container.querySelectorAll('[data-k]').forEach(el => {
    out[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value;
  });
  return out;
}

// ---------- JOURNAL ----------
async function renderJournal(c) {
  const entries = await load('journal');
  const q = (S.search.journal || '').toLowerCase();
  const isDM = S.me.role === 'dm';
  const shown = entries.filter(e => !q || (e.title + ' ' + e.content + ' ' + (e.tags || []).join(' ')).toLowerCase().includes(q));
  const fields = [
    { key: 'session', label: 'Session #', ph: '15' },
    { key: 'title', label: 'Title', ph: 'Session 15 — …' },
    { key: 'content', label: 'What happened (markdown ok)', type: 'textarea' },
    { key: 'tags', label: 'Tags (comma-separated)', ph: 'Saltwick, Adrias' },
    ...(isDM ? [{ key: 'dmOnly', label: 'DM only', type: 'check' }] : [])
  ];
  c.innerHTML = `
    <div class="toolbar">
      <input type="search" id="jq" placeholder="Search the journal…" value="${esc(S.search.journal || '')}">
      <button class="btn" id="add">+ New entry</button>
    </div>
    <div id="form-slot"></div>
    ${shown.map(e => `
      <details class="collapse card ${e.dmOnly ? 'dm' : ''}">
        <summary>${e.session ? `<span class="badge">S${e.session}</span> ` : ''}${esc(e.title)}
          ${e.dmOnly ? ' <span class="badge dm">DM only</span>' : ''}
          ${(e.tags || []).map(t => ` <span class="badge cat">${esc(t)}</span>`).join('')}</summary>
        ${md(e.content)}
        <div class="row">
          ${(isDM || !e.dmOnly) ? `<button class="btn small" data-edit="${e.id}">Edit</button>` : ''}
          ${isDM ? `<button class="btn small danger" data-del="${e.id}">Delete</button>` : ''}
        </div>
      </details>`).join('') || '<p class="muted">Nothing found.</p>'}
  `;
  $('#jq').oninput = e => { S.search.journal = e.target.value; render(); };
  $('#jq').onfocus = e => e.target.setSelectionRange(e.target.value.length, e.target.value.length);
  const openForm = (values = {}, id = null) => {
    $('#form-slot').innerHTML = `<div class="card">${entryForm(fields, { ...values, tags: (values.tags || []).join(', ') })}
      <div class="row" style="margin-top:8px"><button class="btn primary" id="save">Save</button><button class="btn" id="cancel">Cancel</button></div></div>`;
    $('#save').onclick = async () => {
      const v = formValues($('#form-slot'));
      v.session = v.session ? Number(v.session) : null;
      v.tags = v.tags ? v.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
      if (id) await api(`/api/journal/${id}`, { method: 'PATCH', body: v });
      else await api('/api/journal', { method: 'POST', body: v });
      render();
    };
    $('#cancel').onclick = render;
    $('#form-slot').scrollIntoView({ behavior: 'smooth' });
  };
  $('#add').onclick = () => openForm({ session: (Math.max(0, ...entries.map(e => e.session || 0)) + 1) || '' });
  $$('[data-edit]').forEach(b => b.onclick = () => openForm(entries.find(e => e.id === b.dataset.edit), b.dataset.edit));
  $$('[data-del]').forEach(b => b.onclick = async () => { if (confirm('Delete this entry?')) { await api(`/api/journal/${b.dataset.del}`, { method: 'DELETE' }); render(); } });
}

// ---------- CODEX ----------
const CATS = ['npc', 'location', 'faction', 'item'];
async function renderCodex(c) {
  const entries = await load('codex');
  const isDM = S.me.role === 'dm';
  const q = (S.search.codex || '').toLowerCase();
  const cat = S.search.codexCat || 'all';
  const shown = entries.filter(e =>
    (cat === 'all' || e.category === cat) &&
    (!q || (e.name + ' ' + (e.playerContent || '') + ' ' + (e.dmContent || '')).toLowerCase().includes(q)));
  const fields = [
    { key: 'name', label: 'Name' },
    { key: 'category', label: 'Category', type: 'select', options: CATS },
    { key: 'playerContent', label: 'Player-visible info (markdown ok)', type: 'textarea' },
    { key: 'dmContent', label: 'DM-only info', type: 'textarea' },
    { key: 'image', label: 'Image path (e.g. /maps/… )', ph: '' },
    { key: 'revealed', label: 'Visible to players', type: 'check' }
  ];
  c.innerHTML = `
    <div class="toolbar">
      <input type="search" id="cq" placeholder="Search the codex…" value="${esc(S.search.codex || '')}">
      <select id="ccat">${['all', ...CATS].map(x => `<option ${x === cat ? 'selected' : ''}>${x}</option>`).join('')}</select>
      ${isDM ? '<button class="btn dm" id="add">+ New entry</button>' : ''}
    </div>
    <div id="form-slot"></div>
    ${shown.map(e => `
      <details class="collapse card ${isDM && !e.revealed ? 'dm' : ''}">
        <summary><span class="badge cat">${esc(e.category)}</span> ${esc(e.name)}
          ${isDM ? (e.revealed ? ' <span class="badge active">visible</span>' : ' <span class="badge hidden-e">hidden</span>') : ''}</summary>
        ${e.image ? `<img src="${esc(e.image)}" loading="lazy">` : ''}
        ${md(e.playerContent)}
        ${isDM && e.dmContent ? `<div class="card dm"><b style="color:var(--dm)">DM only:</b>${md(e.dmContent)}</div>` : ''}
        ${isDM ? `<div class="row">
          <button class="btn small dm" data-reveal="${e.id}">${e.revealed ? ic('eyeoff') + ' Hide from players' : ic('eye') + ' Reveal to players'}</button>
          <button class="btn small" data-edit="${e.id}">Edit</button>
          <button class="btn small danger" data-del="${e.id}">Delete</button></div>` : ''}
      </details>`).join('') || '<p class="muted">Nothing here (yet). The DM may be hiding things…</p>'}
  `;
  $('#cq').oninput = e => { S.search.codex = e.target.value; render(); };
  $('#ccat').onchange = e => { S.search.codexCat = e.target.value; render(); };
  if (!isDM) return;
  const openForm = (values = {}, id = null) => {
    $('#form-slot').innerHTML = `<div class="card dm">${entryForm(fields, values)}
      <div class="row" style="margin-top:8px"><button class="btn primary" id="save">Save</button><button class="btn" id="cancel">Cancel</button></div></div>`;
    $('#save').onclick = async () => {
      const v = formValues($('#form-slot'));
      if (id) await api(`/api/codex/${id}`, { method: 'PATCH', body: v });
      else await api('/api/codex', { method: 'POST', body: v });
      render();
    };
    $('#cancel').onclick = render;
  };
  $('#add').onclick = () => openForm({ category: 'npc' });
  $$('[data-edit]').forEach(b => b.onclick = () => openForm(entries.find(e => e.id === b.dataset.edit), b.dataset.edit));
  $$('[data-del]').forEach(b => b.onclick = async () => { if (confirm('Delete this codex entry?')) { await api(`/api/codex/${b.dataset.del}`, { method: 'DELETE' }); render(); } });
  $$('[data-reveal]').forEach(b => b.onclick = async () => { await api(`/api/codex/${b.dataset.reveal}/reveal`, { method: 'POST' }); render(); });
}

// ---------- QUESTS ----------
async function renderQuests(c) {
  const quests = await load('quests');
  const isDM = S.me.role === 'dm';
  const order = { active: 0, rumoured: 1, completed: 2 };
  quests.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
  const fields = [
    { key: 'title', label: 'Quest' },
    { key: 'status', label: 'Status', type: 'select', options: ['active', 'rumoured', 'completed'] },
    { key: 'notes', label: 'Notes (visible to all)', type: 'textarea' },
    ...(isDM ? [{ key: 'dmNotes', label: 'DM notes', type: 'textarea' }, { key: 'dmOnly', label: 'Entire quest DM-only', type: 'check' }] : [])
  ];
  c.innerHTML = `
    <div class="toolbar"><button class="btn" id="add">+ New quest</button></div>
    <div id="form-slot"></div>
    ${quests.map(qu => `
      <div class="card ${qu.dmOnly ? 'dm' : ''}">
        <div class="row spread"><h3>${esc(qu.title)}</h3>
          <span class="badge ${esc(qu.status)}">${esc(qu.status)}</span></div>
        ${md(qu.notes)}
        ${isDM && qu.dmNotes ? `<div class="card dm"><b style="color:var(--dm)">DM:</b> ${md(qu.dmNotes)}</div>` : ''}
        ${qu.dmOnly ? '<span class="badge dm">DM only</span> ' : ''}
        <div class="row" style="margin-top:6px">
          ${(isDM || !qu.dmOnly) ? `<button class="btn small" data-edit="${qu.id}">Edit</button>` : ''}
          ${isDM ? `<button class="btn small danger" data-del="${qu.id}">Delete</button>` : ''}
        </div>
      </div>`).join('') || '<p class="muted">No quests yet.</p>'}
  `;
  const openForm = (values = {}, id = null) => {
    $('#form-slot').innerHTML = `<div class="card">${entryForm(fields, values)}
      <div class="row" style="margin-top:8px"><button class="btn primary" id="save">Save</button><button class="btn" id="cancel">Cancel</button></div></div>`;
    $('#save').onclick = async () => {
      const v = formValues($('#form-slot'));
      if (id) await api(`/api/quests/${id}`, { method: 'PATCH', body: v });
      else await api('/api/quests', { method: 'POST', body: v });
      render();
    };
    $('#cancel').onclick = render;
  };
  $('#add').onclick = () => openForm({ status: 'active' });
  $$('[data-edit]').forEach(b => b.onclick = () => openForm(quests.find(x => x.id === b.dataset.edit), b.dataset.edit));
  $$('[data-del]').forEach(b => b.onclick = async () => { if (confirm('Delete quest?')) { await api(`/api/quests/${b.dataset.del}`, { method: 'DELETE' }); render(); } });
}

// short display name: "Cass (player)" -> "Cass"
const shortName = u => String(u || '').replace(/\s*\((player|dm|co-dm)\)\s*$/i, '');

// ---------- BATTLE ----------
async function renderBattle(c) {
  const enc = await load('encounter');
  const isDM = S.me.role === 'dm';
  const combatants = enc.combatants || [];
  if (!combatants.length) {
    c.innerHTML = `<div class="card"><h3>${ic('swords')} Battle</h3>
      <p class="muted">No encounter running.${isDM ? ' Build one on the DM tab (+ Monster, + Add whole party), then run it from here.' : ' The moment the DM rolls initiative, the turn order shows up here — live.'}</p>
      ${isDM ? '<button class="btn dm" id="to-dm">Open the encounter tracker</button>' : ''}</div>`;
    if (isDM) $('#to-dm').onclick = () => { S.tab = 'dm'; localStorage.setItem('gc_tab', 'dm'); render(); };
    return;
  }
  const chars = await load('characters');
  const myId = S.me.characterId;
  const myChar = chars.find(x => x.id === myId);
  const myName = myChar ? myChar.name : '';
  const turn = enc.turn || 0;
  const active = combatants[turn] || null;
  const mineRow = x => (myId && x.characterId === myId);
  const activeIsMine = !isDM && active && (mineRow(active) || (myName && active.name && myName.toLowerCase().startsWith(String(active.name).toLowerCase())));
  const mon = x => (isDM && x.monster && typeof BESTIARY !== 'undefined') ? BESTIARY.find(b => b.id === x.monster) : null;
  c.innerHTML = `
    <div class="card">
      <div class="row spread"><h3 style="margin:0">${ic('swords')} Round ${enc.round || 1} <span class="muted" style="font-weight:400;font-size:14px">· ${esc(active ? active.name : '')}'s turn</span></h3>
        ${isDM ? `<span class="row"><button class="btn small" id="b-prev" title="Previous turn" aria-label="Previous turn">${ic('skipback')}</button><button class="btn small primary" id="b-next" title="Next turn (N)">${ic('play')} Next turn</button><span class="badge dm">DM view</span></span>` : '<span class="badge cat">live</span>'}</div>
      ${activeIsMine ? `<div class="your-turn">${ic('swords')} YOUR TURN</div>` : ''}
      <div class="init-list">
        ${combatants.map((x, i) => {
          const down = x.down ?? (Number(x.maxHp) > 0 && Number(x.hp) <= 0);
          const m = mon(x);
          const pct = Number(x.maxHp) > 0 ? Math.max(0, Math.min(100, Math.round(100 * Number(x.hp || 0) / Number(x.maxHp)))) : 0;
          return `<div class="init-row ${i === turn ? 'turn' : ''} ${mineRow(x) ? 'mine' : ''} ${down ? 'down' : ''}">
            <span class="init-num">${x.init ?? '—'}</span>
            <span class="init-name">${down ? ic('skull', 'ic-red') + ' ' : ''}${esc(x.name || '—')}${mineRow(x) ? ' <span class="badge cat">you</span>' : ''}
              ${isDM && x.notes ? `<div class="init-notes muted">${esc(x.notes)}</div>` : ''}</span>
            ${isDM ? `<span class="init-hp-ctl">
                <button class="btn small" data-hp="-5" data-i="${i}">−5</button><button class="btn small" data-hp="-1" data-i="${i}">−1</button>
                <span class="init-hp ${down ? 'low' : ''}" style="--hp:${pct}%">${x.hp ?? '?'}${x.maxHp ? '/' + x.maxHp : ''}</span>
                <button class="btn small" data-hp="1" data-i="${i}">+1</button><button class="btn small" data-hp="5" data-i="${i}">+5</button>
                ${m ? `<button class="btn small dm" data-stat="${i}" title="Stat block" aria-label="Stat block">${ic('book')}</button>` : ''}
              </span>` : (x.maxHp && isDM ? `<span class="init-hp ${down ? 'low' : ''}">${x.hp ?? '?'}/${x.maxHp}</span>` : '<span></span>')}
          </div>${m ? `<div class="statblock hidden" data-statblock="${i}">${statBlockHTML(m)}</div>` : ''}`;
        }).join('')}
      </div>
    </div>`;
  if (!isDM) return;
  const saveEnc = () => api('/api/encounter', { method: 'PUT', body: enc });
  $$('[data-hp]').forEach(b => b.onclick = async () => {
    const x = combatants[Number(b.dataset.i)];
    x.hp = Math.max(0, Number(x.hp || 0) + Number(b.dataset.hp));
    await saveEnc(); refresh(c);
  });
  $$('[data-stat]').forEach(b => b.onclick = () => $(`[data-statblock="${b.dataset.stat}"]`).classList.toggle('hidden'));
  $('#b-next').onclick = async () => { const len = combatants.length; enc.turn = ((enc.turn || 0) + 1) % len; if (enc.turn === 0) enc.round = (enc.round || 1) + 1; await saveEnc(); refresh(c); };
  $('#b-prev').onclick = async () => { const len = combatants.length; enc.turn = ((enc.turn || 0) - 1 + len) % len; await saveEnc(); refresh(c); };
}

// ---------- DICE ----------
let lastRollId = null; // for the "fresh" pop animation on the newest card
function rollBreakdown(r) {
  return (r.detail || []).map(d => {
    if (d.mod !== undefined) return (d.mod >= 0 ? '+' : '') + d.mod;
    if (d.rolls && d.rolls.length > 1) return `${d.die}:[${d.rolls.join(',')}]→${d.kept}`;
    return `${d.die}:${d.kept}`;
  }).join(' ');
}
function rollCrit(r) {
  const d20s = (r.detail || []).filter(d => d.die === 'd20');
  return { nat20: d20s.some(d => d.kept === 20), nat1: d20s.some(d => d.kept === 1) };
}
function rollCard(r, fresh) {
  const { nat20, nat1 } = rollCrit(r);
  return `<div class="roll ${nat20 ? 'crit' : ''} ${nat1 ? 'fumble' : ''} ${fresh ? 'fresh' : ''}">
    <div class="roll-total">${r.total}${nat20 ? ' ' + ic('sparkles', 'ic-gold') : ''}${nat1 ? ' ' + ic('skull', 'ic-red') : ''}</div>
    <div class="roll-body">
      <div class="roll-meta"><b>${esc(shortName(r.user))}</b>${r.label ? ` · ${esc(r.label)}` : ''}</div>
      <div class="roll-detail muted">${esc(r.formula)}${r.mode ? ` <span class="badge">${esc(r.mode)}</span>` : ''} · ${rollBreakdown(r)}</div>
    </div>
  </div>`;
}
async function renderDice(c) {
  const rolls = await load('rolls');
  const newest = rolls.length ? rolls[rolls.length - 1] : null;
  const fresh = !!(newest && newest.id !== lastRollId);
  lastRollId = newest ? newest.id : lastRollId;
  const feed = [...rolls].reverse();
  const quick = [4, 6, 8, 10, 12, 20, 100];
  c.innerHTML = `
    <div class="card">
      <div class="dice-quick">${quick.map(f => `<button class="btn die-btn" data-die="d${f}">d${f}</button>`).join('')}</div>
      <div class="row" style="margin-top:10px">
        <input id="roll-formula" placeholder="d20+5 · 2d6+3 · 4d6" style="flex:1" autocomplete="off">
        <select id="roll-mode" title="advantage / disadvantage on the d20">
          <option value="">— roll</option><option value="adv">advantage</option><option value="dis">disadvantage</option></select>
      </div>
      <div class="row" style="margin-top:8px">
        <input id="roll-label" placeholder="Stealth, Fireball, save…" style="flex:1" autocomplete="off">
        <button class="btn primary" id="roll-go">${ic('dice')} Roll</button>
      </div>
    </div>
    <div class="roll-feed">
      ${feed.map((r, i) => rollCard(r, i === 0 && fresh)).join('') || '<p class="muted">No rolls yet — be the first to tempt fate.</p>'}
    </div>`;
  const fInput = $('#roll-formula'), lInput = $('#roll-label'), mSel = $('#roll-mode');
  const go = async (formula) => {
    const f = (formula || fInput.value).trim();
    if (!f) { fInput.focus(); return; }
    try {
      await api('/api/rolls', { method: 'POST', body: { formula: f, label: lInput.value.trim(), mode: mSel.value || undefined } });
    } catch (_) { return; }
    if (!formula) fInput.value = '';
    refresh(c);
  };
  $$('.die-btn').forEach(b => b.onclick = () => go(b.dataset.die));
  $('#roll-go').onclick = () => go();
  fInput.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  lInput.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
}

// ---------- BOARD (noticeboard) ----------
const NOTICE_TYPES = ['rumour', 'wanted', 'job', 'note'];
const NOTICE_ICON = { rumour: 'megaphone', wanted: 'scroll', job: 'coins', note: 'pin' };
function noticeMeta(n) {
  return `<div class="notice-by muted">${esc(shortName(n.createdBy || '?'))}${n.ts ? ` · ${new Date(n.ts).toLocaleDateString()}` : ''}</div>`;
}
async function renderBoard(c) {
  const notices = await load('notices');
  const isDM = S.me.role === 'dm';
  const mine = n => n.createdBy === S.me.name;
  const canEdit = n => mine(n) || isDM;
  const tops = notices.filter(n => !n.parentId).sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  const repliesOf = id => notices.filter(n => n.parentId === id).sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || '')));
  const fields = [
    { key: 'title', label: 'Title', ph: 'Bounty, rumour, job…' },
    { key: 'type', label: 'Type', type: 'select', options: NOTICE_TYPES },
    { key: 'content', label: 'Details (markdown ok)', type: 'textarea' },
    ...(isDM ? [{ key: 'dmOnly', label: 'DM only', type: 'check' }] : [])
  ];
  const replyFields = [{ key: 'content', label: 'Your reply (markdown ok)', type: 'textarea' }];
  c.innerHTML = `
    <div class="toolbar"><h2 style="margin:0;flex:1">${ic('pin')} Noticeboard</h2><button class="btn" id="add">+ New notice</button></div>
    <div id="form-slot"></div>
    ${tops.map(n => {
      const icon = ic(NOTICE_ICON[n.type] || 'pin');
      const replies = repliesOf(n.id);
      return `<div class="card notice ${n.dmOnly ? 'dm' : ''}">
        <h3 style="margin:0 0 2px">${icon} ${esc(n.title || '(untitled)')}
          <span class="badge cat">${esc(n.type || 'note')}</span>${n.dmOnly ? ' <span class="badge dm">DM only</span>' : ''}</h3>
        ${noticeMeta(n)}
        ${md(n.content)}
        <div class="row">
          <button class="btn small" data-reply="${n.id}">${ic('reply')} Reply</button>
          ${canEdit(n) ? `<button class="btn small" data-edit="${n.id}">Edit</button>
            <button class="btn small danger" data-del="${n.id}">Delete</button>` : ''}
        </div>
        <div class="reply-slot" data-slot="${n.id}"></div>
        ${replies.length ? `<div class="replies">${replies.map(r => `
          <div class="reply ${r.dmOnly ? 'dm' : ''}">
            ${noticeMeta(r)}
            ${md(r.content)}
            ${canEdit(r) ? `<div class="row">${mine(r) ? `<button class="btn small" data-edit="${r.id}">Edit</button>` : ''}
              <button class="btn small danger" data-del="${r.id}">Delete</button></div>` : ''}
          </div>`).join('')}</div>` : ''}
      </div>`;
    }).join('') || '<p class="muted">The board is bare. Pin the first notice.</p>'}
  `;
  const openForm = (values = {}, id = null, formFields = fields) => {
    $('#form-slot').innerHTML = `<div class="card">${entryForm(formFields, values)}
      <div class="row" style="margin-top:8px"><button class="btn primary" id="save">Save</button><button class="btn" id="cancel">Cancel</button></div></div>`;
    $('#save').onclick = async () => {
      const v = formValues($('#form-slot'));
      if (id) await api(`/api/notices/${id}`, { method: 'PATCH', body: v });
      else await api('/api/notices', { method: 'POST', body: v });
      render();
    };
    $('#cancel').onclick = render;
    $('#form-slot').scrollIntoView({ behavior: 'smooth' });
  };
  $('#add').onclick = () => openForm({ type: 'note' });
  $$('[data-edit]').forEach(b => b.onclick = () => {
    const n = notices.find(x => x.id === b.dataset.edit);
    openForm(n, n.id, n.parentId ? replyFields : fields);
  });
  $$('[data-del]').forEach(b => b.onclick = async () => {
    if (confirm('Delete this notice?')) { await api(`/api/notices/${b.dataset.del}`, { method: 'DELETE' }); render(); }
  });
  $$('[data-reply]').forEach(b => b.onclick = () => {
    const slot = $(`[data-slot="${b.dataset.reply}"]`);
    slot.innerHTML = `<div class="card">${entryForm(replyFields, {})}
      <div class="row" style="margin-top:8px"><button class="btn primary" id="rsave">Post reply</button><button class="btn" id="rcancel">Cancel</button></div></div>`;
    slot.querySelector('#rsave').onclick = async () => {
      const v = formValues(slot);
      v.parentId = b.dataset.reply; v.type = 'note';
      await api('/api/notices', { method: 'POST', body: v });
      render();
    };
    slot.querySelector('#rcancel').onclick = render;
    slot.querySelector('textarea').focus();
  });
}

// ---------- ARC (co-DM story board — DM only) ----------
const ARC_KINDS = {
  beat:   { label: 'Story beat', icon: 'mappin', statuses: ['planned', 'next', 'now', 'played', 'maybe'] },
  npc:    { label: 'Cast', icon: 'drama', statuses: ['unmet', 'met', 'gone'] },
  clue:   { label: 'Secret / clue', icon: 'search', statuses: ['hidden', 'revealed'] },
  thread: { label: 'Open thread', icon: 'link', statuses: ['open', 'done'] },
  about:  { label: 'Arc notes', icon: 'scroll', statuses: [] }
};
const BEAT_LABEL = { played: '✓ played', now: '▶ we are here', next: 'up next', planned: 'planned', maybe: 'maybe' };
const snip = s => { const t = String(s || '').replace(/[#*_>`|]/g, '').replace(/\s+/g, ' ').trim(); return t.length > 110 ? t.slice(0, 107) + '…' : t; };

async function renderArc(c) {
  const [cards, codex, users] = await Promise.all([load('arc'), load('codex'), load('users/list')]);
  const dms = users.filter(u => u.role === 'dm');
  const arcs = [...new Set(cards.map(x => x.arc).filter(Boolean))];
  let arc = S.search.arc || localStorage.getItem('gc_arc');
  // default to the arc that is being played (has a beat marked now), else the newest
  if (!arcs.includes(arc)) arc = arcs.find(a => cards.some(x => x.arc === a && x.kind === 'beat' && x.status === 'now')) || arcs[arcs.length - 1] || '';
  const inArc = cards.filter(x => x.arc === arc).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const of = k => inArc.filter(x => x.kind === k);
  const beats = of('beat'), cast = of('npc'), clues = of('clue'), threads = of('thread'), about = of('about')[0];

  // who owns what: a DM's user id, 'both', or '' (unassigned)
  const ownerOptions = [{ value: '', label: 'Unassigned' }, ...dms.map(u => ({ value: u.id, label: shortName(u.name) })), { value: 'both', label: 'Both' }];
  const ownerChip = o => {
    if (!o) return '';
    const i = dms.findIndex(u => u.id === o);
    return `<span class="owner o-${o === 'both' ? 'both' : i}">${esc(o === 'both' ? 'Both' : shortName(dms[i]?.name || '?'))}</span>`;
  };
  const who = S.search.arcOwner || 'all';
  const isMine = x => x.owner === S.me.id || x.owner === 'both';
  const match = x => who === 'all' || (who === 'mine' ? isMine(x) : !x.owner);
  const dim = x => match(x) ? '' : 'dim';
  const counts = { all: inArc.length, mine: inArc.filter(isMine).length, none: inArc.filter(x => !x.owner).length };

  // codex link: a badge once players can see it, a reveal button while it's hidden
  const codexBit = (x, small) => {
    const cx = codex.find(e => e.id === x.codexId);
    if (!cx) return '';
    if (cx.revealed) return `<span class="badge active">${ic('scroll')} in Codex</span>`;
    const nudge = x.kind === 'npc' && x.status === 'met';
    return `<button class="btn small dm ${nudge ? 'nudge' : ''}" data-reveal="${cx.id}">${ic('scroll')} ${nudge ? 'Met — reveal in Codex?' : (small ? 'Reveal' : 'Reveal in Codex')}</button>`;
  };

  const now = beats.find(b => b.status === 'now');
  const next = beats.find(b => b.status === 'next');
  const counted = beats.filter(b => b.status !== 'maybe');
  const played = counted.filter(b => b.status === 'played').length;
  const pct = counted.length ? Math.round(100 * played / counted.length) : 0;
  const cluesOut = clues.filter(k => k.status === 'revealed').length;
  const openThreads = threads.filter(t => t.status !== 'done'), doneThreads = threads.filter(t => t.status === 'done');
  const checkRow = x => {
    const on = x.kind === 'clue' ? x.status === 'revealed' : x.status === 'done';
    return `<div class="check-row ck-${x.kind} ${dim(x)} ${on ? 'done' : ''}">
      <input type="checkbox" data-flip="${x.id}" ${on ? 'checked' : ''} title="${x.kind === 'clue' ? 'Revealed to players?' : 'Done?'}">
      <button class="linkish" data-open="${x.id}">${esc(x.title || '(untitled)')}</button>
      ${x.kind === 'clue' ? codexBit(x, true) : ''}${ownerChip(x.owner)}</div>`;
  };

  if (!arcs.length) {
    c.innerHTML = `<div class="card dm"><h3>${ic('compass')} Arc board</h3>
      <p class="muted">Plan a story arc with your co-DM: the scene flow, who's in it, what's still secret, and what you two still need to decide. Live for both DMs, invisible to players.</p>
      <button class="btn dm" id="arc-new">+ Start an arc</button></div>`;
  } else {
    c.innerHTML = `
      <div class="toolbar">
        <select id="arc-pick">${arcs.map(a => `<option ${a === arc ? 'selected' : ''}>${esc(a)}</option>`).join('')}</select>
        <button class="btn small" id="arc-new">+ New arc</button>
        <span class="owner-filter">${[['all', 'All'], ['mine', 'Mine'], ['none', 'Unassigned']].map(([k, l]) =>
          `<button class="btn small ${who === k ? 'on' : ''}" data-who="${k}">${l} ${counts[k]}</button>`).join('')}</span>
      </div>
      <div id="arc-focus"></div>
      <div class="card dm arc-head">
        <h2 style="margin:0">${ic('compass')} ${esc(arc)}</h2>
        <div class="arc-now">${now ? `${ic('play', 'ic-gold')} <b>We are here:</b> <button class="linkish" data-open="${now.id}">${esc(now.title)}</button>` : '<span class="muted">No beat marked “now” yet — open one and set it.</span>'}</div>
        ${next ? `<div class="muted">Up next: ${esc(next.title)}</div>` : ''}
        <div class="arc-progress"><div style="width:${pct}%"></div></div>
        <div class="row spread"><span class="muted">${played} of ${counted.length} beats played</span>
          <button class="btn small primary" id="arc-advance">${ic('play')} Advance story</button></div>
        ${about ? `<details class="collapse arc-notes"><summary>${ic('scroll')} Arc notes</summary>${md(about.content)}
          <button class="btn small" data-open="${about.id}">Edit notes</button></details>` : '<button class="btn small" data-add="about" style="margin-top:8px">+ Arc notes</button>'}
      </div>

      <div class="arc-section">
        <div class="row spread"><h3>${ic('mappin')} Story flow</h3><button class="btn small" data-add="beat">+ Beat</button></div>
        <div class="flow" id="flow">
          ${beats.map((b, i) => `<button class="beat s-${esc(b.status || 'planned')} ${dim(b)}" data-open="${b.id}">
            <span class="beat-num">${i + 1}</span>
            <span class="beat-status">${BEAT_LABEL[b.status] || esc(b.status || '')}</span>
            <span class="beat-title">${esc(b.title)}</span>
            <span class="beat-foot">${b.session ? `<span class="badge">S${esc(b.session)}</span>` : ''}${ownerChip(b.owner)}</span>
          </button>`).join('') || '<p class="muted">No beats yet.</p>'}
        </div>
      </div>

      <div class="arc-cols">
        <div class="arc-col">
          <div class="row spread"><h3>${ic('drama')} Cast</h3><button class="btn small" data-add="npc">+</button></div>
          ${cast.map(n => `<div class="arc-card ${dim(n)} ${n.status === 'gone' ? 'gone' : ''}">
            <div class="row spread"><button class="linkish" data-open="${n.id}"><b>${esc(n.title)}</b></button>
              <span class="badge st-${esc(n.status || '')}">${esc(n.status || '')}</span></div>
            ${n.content ? `<div class="arc-snip muted">${esc(snip(n.content))}</div>` : ''}
            <div class="row">${ownerChip(n.owner)}${codexBit(n)}</div>
          </div>`).join('') || '<p class="muted">No cast yet.</p>'}
        </div>
        <div class="arc-col">
          <div class="row spread"><h3>${ic('search')} Secrets & clues <span class="muted" style="font-weight:400">${cluesOut}/${clues.length} out</span></h3><button class="btn small" data-add="clue">+</button></div>
          ${clues.map(checkRow).join('') || '<p class="muted">No secrets yet.</p>'}
        </div>
        <div class="arc-col">
          <div class="row spread"><h3>${ic('link')} Open threads <span class="muted" style="font-weight:400">${openThreads.length}</span></h3><button class="btn small" data-add="thread">+</button></div>
          ${openThreads.map(checkRow).join('') || '<p class="muted">Nothing open. Suspicious.</p>'}
          ${doneThreads.length ? `<details class="collapse"><summary class="muted">Done (${doneThreads.length})</summary>${doneThreads.map(checkRow).join('')}</details>` : ''}
        </div>
      </div>`;
  }

  const patch = (id, body) => api(`/api/arc/${id}`, { method: 'PATCH', body });
  const slot = $('#arc-focus');

  // --- edit / create form (shown in the focus slot) ---
  const openForm = (values, id) => {
    S.formOpen = true;
    const kind = ARC_KINDS[values.kind] ? values.kind : 'beat';
    const statuses = ARC_KINDS[kind].statuses;
    const fields = [
      { key: 'title', label: 'Title' },
      { key: 'kind', label: 'Type', type: 'select', options: Object.entries(ARC_KINDS).map(([value, k]) => ({ value, label: k.label })) },
      ...(statuses.length ? [{ key: 'status', label: 'Status', type: 'select', options: statuses }] : []),
      { key: 'owner', label: 'Owner', type: 'select', options: ownerOptions },
      ...(kind === 'beat' ? [{ key: 'session', label: 'Session #', ph: '16' }] : []),
      ...(kind !== 'beat' && kind !== 'about' ? [{ key: 'codexId', label: 'Linked Codex entry', type: 'select', options: [{ value: '', label: '— none —' }, ...codex.map(e => ({ value: e.id, label: e.name }))] }] : []),
      { key: 'content', label: 'Notes (markdown ok)', type: 'textarea' }
    ];
    slot.innerHTML = `<div class="card arc-focus">${entryForm(fields, values)}
      <div class="row" style="margin-top:8px"><button class="btn primary" id="af-save">Save</button><button class="btn" id="af-cancel">Cancel</button></div></div>`;
    slot.querySelector('[data-k=kind]').onchange = () => openForm({ ...values, ...formValues(slot), status: undefined }, id);
    slot.querySelector('#af-save').onclick = async () => {
      const v = formValues(slot);
      if (!v.title.trim()) { toast('Give it a title'); return; }
      if (statuses.length && !statuses.includes(v.status)) v.status = statuses[0];
      v.arc = values.arc || arc;
      if (!id) v.order = Math.max(0, ...cards.map(x => x.order ?? 0)) + 1;
      const saved = id ? await patch(id, v) : await api('/api/arc', { method: 'POST', body: v });
      S.formOpen = false; S.view = 'arc:' + saved.id; S.search.arc = v.arc;
      render();
    };
    slot.querySelector('#af-cancel').onclick = () => { S.formOpen = false; render(); };
    slot.querySelector('[data-k=title]').focus();
    slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // --- arc switching ---
  $('#arc-new').onclick = async () => {
    const name = (prompt('Name the new arc (e.g. "The Border Hospital")') || '').trim();
    if (!name) return;
    await api('/api/arc', { method: 'POST', body: { arc: name, kind: 'about', title: 'Arc notes', content: '', order: 0 } });
    S.search.arc = name; localStorage.setItem('gc_arc', name); S.view = null;
    render();
  };
  if (!arcs.length) return;
  $('#arc-pick').onchange = e => { S.search.arc = e.target.value; localStorage.setItem('gc_arc', e.target.value); S.view = null; render(); };
  $$('[data-who]').forEach(b => b.onclick = () => { S.search.arcOwner = b.dataset.who; render(); });

  // --- the big live-play button: now → played, next beat → now ---
  $('#arc-advance').onclick = async () => {
    const i = beats.findIndex(b => b.status === 'now');
    const ahead = beats.slice(i + 1).filter(b => b.status === 'next' || b.status === 'planned');
    const ups = [];
    if (i !== -1) ups.push([beats[i].id, 'played']);
    if (ahead[0]) ups.push([ahead[0].id, 'now']);
    if (ahead[1] && ahead[1].status !== 'next') ups.push([ahead[1].id, 'next']);
    if (!ups.length) { toast('Nothing ahead to advance to — add a beat.'); return; }
    for (const [id, status] of ups) await patch(id, { status });
    toast(ahead[0] ? `▶ Now: ${ahead[0].title}` : '🎉 Arc complete');
    render();
  };

  // --- cards ---
  $$('[data-open]').forEach(b => b.onclick = () => { S.view = 'arc:' + b.dataset.open; S.formOpen = false; S.scrollFocus = true; render(); });
  $$('[data-add]').forEach(b => b.onclick = () => openForm({ kind: b.dataset.add, title: b.dataset.add === 'about' ? 'Arc notes' : '' }, null));
  $$('[data-flip]').forEach(cb => cb.onchange = async () => {
    const x = inArc.find(y => y.id === cb.dataset.flip);
    await patch(x.id, { status: x.kind === 'clue' ? (cb.checked ? 'revealed' : 'hidden') : (cb.checked ? 'done' : 'open') });
    render();
  });
  const bindReveal = root => root.querySelectorAll('[data-reveal]').forEach(b => b.onclick = async e => {
    e.stopPropagation();
    if (!confirm('Reveal this Codex entry to every player now? They get a toast.')) return;
    await api(`/api/codex/${b.dataset.reveal}/reveal`, { method: 'POST' });
    toast('📜 Revealed to players');
    render();
  });
  bindReveal(c);

  // keep "we are here" centred in the flow strip
  const flow = $('#flow'), cur = flow && flow.querySelector('.s-now');
  if (cur) flow.scrollLeft = cur.offsetLeft - flow.clientWidth / 2 + cur.clientWidth / 2;

  // --- focus panel for the open card ---
  const x = S.view && S.view.startsWith('arc:') ? inArc.find(y => y.id === S.view.slice(4)) : null;
  if (!x || S.formOpen) return;
  const k = ARC_KINDS[x.kind] || ARC_KINDS.beat;
  slot.innerHTML = `<div class="card arc-focus">
    <div class="row spread"><h3 style="margin:0">${ic(k.icon)} ${esc(x.title || '(untitled)')}</h3><button class="btn small ghost" id="af-close">✕</button></div>
    <div class="muted" style="font-size:13px">${k.label}${x.session ? ` · S${esc(x.session)}` : ''}${x.updatedBy ? ` · last edited by ${esc(shortName(x.updatedBy))}, ${new Date(x.updatedAt).toLocaleDateString()}` : ''}</div>
    ${k.statuses.length ? `<div class="seg">${k.statuses.map(s => `<button class="btn small ${x.status === s ? 'on' : ''}" data-status="${s}">${esc(x.kind === 'beat' ? BEAT_LABEL[s] : s)}</button>`).join('')}</div>` : ''}
    <div class="row" style="margin-bottom:6px"><label class="muted">Owner</label>
      <select id="af-owner">${ownerOptions.map(o => `<option value="${o.value}" ${o.value === (x.owner || '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>
      ${codexBit(x)}</div>
    ${md(x.content) || '<p class="muted">No notes yet.</p>'}
    <div class="row">
      <button class="btn small" id="af-edit">Edit</button>
      ${x.kind === 'beat' ? '<button class="btn small" data-move="-1">← Earlier</button><button class="btn small" data-move="1">Later →</button>' : ''}
      <button class="btn small danger" id="af-del">Delete</button>
    </div></div>`;
  bindReveal(slot);
  if (S.scrollFocus) { S.scrollFocus = false; slot.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  slot.querySelector('#af-close').onclick = () => { S.view = null; render(); };
  slot.querySelector('#af-edit').onclick = () => openForm({ ...x }, x.id);
  slot.querySelector('#af-owner').onchange = async e => { await patch(x.id, { owner: e.target.value }); render(); };
  slot.querySelector('#af-del').onclick = async () => {
    if (!confirm(`Delete “${x.title}”?`)) return;
    await api(`/api/arc/${x.id}`, { method: 'DELETE' }); S.view = null; render();
  };
  slot.querySelectorAll('[data-status]').forEach(b => b.onclick = async () => {
    const status = b.dataset.status;
    // only one beat can be "now": earlier ones count as played, later ones drop back to planned
    if (x.kind === 'beat' && status === 'now') {
      const at = beats.indexOf(x);
      for (const [j, o] of beats.entries()) if (o !== x && o.status === 'now') await patch(o.id, { status: j < at ? 'played' : 'planned' });
    }
    await patch(x.id, { status });
    render();
  });
  slot.querySelectorAll('[data-move]').forEach(b => b.onclick = async () => {
    const i = beats.indexOf(x), j = i + Number(b.dataset.move);
    if (j < 0 || j >= beats.length) return;
    const arr = [...beats]; [arr[i], arr[j]] = [arr[j], arr[i]];
    for (const [idx, o] of arr.entries()) if (o.order !== idx + 1) await patch(o.id, { order: idx + 1 });
    render();
  });
}

// ---------- cross-tab live side effects (called from the data layer's SSE hook) ----------
let lastTurnKey = null;
async function onEntityEvent(entity) {
  if (!S.me) return;
  if (entity === 'encounter' && S.me.role !== 'dm') {
    let enc;
    try { enc = await load('encounter'); } catch (_) { return; }
    const active = (enc.combatants || [])[enc.turn || 0] || null;
    const myId = S.me.characterId;
    const key = `${enc.round}:${enc.turn}`;
    if (active && myId && active.characterId === myId && key !== lastTurnKey) toast("⚔️ You're up! It's your turn.", 4000);
    lastTurnKey = key;
  } else if (entity === 'chat' && S.tab !== 'chat' && S.pin !== 'chat') {
    const msgs = (typeof RAW !== 'undefined' && RAW.chat) || [];
    const newest = msgs[msgs.length - 1];
    if (newest && newest.user !== S.me.name && newest.kind !== 'sys') toast(`💬 ${shortName(newest.user)}: ${String(newest.text).replace(/[#*_>\n]+/g, ' ').slice(0, 90)}`, 5000);
  } else if (entity === 'rolls') {
    let rolls;
    try { rolls = await load('rolls'); } catch (_) { return; }
    const newest = rolls[rolls.length - 1];
    if (newest && newest.user !== S.me.name && S.tab !== 'dice' && S.pin !== 'dice') {
      toast(`🎲 ${shortName(newest.user)} rolled ${newest.total}${newest.label ? ` — ${newest.label}` : ''}`);
    }
  }
}

// ---------- MY NOTES ----------
async function renderNotes(c) {
  const { text } = await api('/api/notes');
  c.innerHTML = `<div class="card"><h3>My private notes</h3>
    <p class="muted">Only you can see these. Saved automatically.</p>
    <textarea id="notes-ta" style="min-height:340px" placeholder="Theories, loot wishlists, blackmail material…">${esc(text)}</textarea>
    <div class="muted" id="notes-status" style="font-size:13px;min-height:1em"></div></div>`;
  let t = null;
  $('#notes-ta').oninput = () => {
    $('#notes-status').textContent = 'Typing…';
    clearTimeout(t);
    t = setTimeout(async () => {
      await api('/api/notes', { method: 'PUT', body: { text: $('#notes-ta').value } });
      $('#notes-status').textContent = 'Saved ✓';
    }, 700);
  };
}

// ---------- DM SECTION ----------
async function renderDM(c) {
  const [prep, enc, users, history] = await Promise.all([
    api('/api/prep'), api('/api/encounter'), api('/api/users'), api('/api/history')
  ]);
  const chars = await load('characters');
  c.innerHTML = `
    <h2 style="color:var(--dm)">${ic('crown')} Dungeon Master</h2>

    <details class="collapse" open><summary>${ic('swords')} Encounter tracker</summary>
      <div class="card dm">
        <div class="row spread"><b>Round <span id="enc-round">${enc.round || 1}</span></b>
          <span><button class="btn small primary" id="enc-next">${ic('play')} Next turn</button>
          <button class="btn small" id="round-minus">−</button> <button class="btn small" id="round-plus">+ Round</button>
          <button class="btn small danger" id="enc-clear">Clear</button></span></div>
        <table class="enc"><thead><tr><th>Init</th><th>Name</th><th>HP</th><th>Max</th><th>Notes</th><th></th></tr></thead>
          <tbody id="enc-body"></tbody></table>
        <div class="row" style="margin-top:8px">
          <button class="btn small" id="enc-add">+ Add combatant</button>
          <button class="btn small" id="enc-party">+ Add whole party</button>
          <button class="btn small dm" id="enc-sort">Sort by initiative</button>
        </div>
        <div class="row" style="margin-top:8px">
          <select id="enc-monster"><option value="">+ Monster (SRD)…</option>${(typeof BESTIARY !== 'undefined' ? BESTIARY : []).map(b => `<option value="${b.id}">${esc(b.name)} — CR ${esc(b.cr)}, AC ${b.ac}, HP ${b.hp}</option>`).join('')}</select>
          <input id="enc-monster-n" type="number" min="1" max="12" value="1" style="width:64px" title="how many">
          <button class="btn small dm" id="enc-monster-add">Add</button>
          <span class="muted" style="font-size:12px">rolls initiative, fills AC/HP/attacks · run the fight from the Battle tab</span>
        </div>
      </div>
    </details>

    <details class="collapse" open><summary>${ic('book')} Session prep</summary>
      <div id="prep-list">${prep.map(p => `
        <details class="collapse card dm"><summary>${esc(p.title)}</summary>
          <div data-view="${p.id}">${md(p.content)}</div>
          <div class="row"><button class="btn small" data-prep-edit="${p.id}">Edit</button>
          <button class="btn small danger" data-prep-del="${p.id}">Delete</button></div>
        </details>`).join('')}</div>
      <button class="btn dm" id="prep-add">+ New prep page</button>
    </details>

    <details class="collapse"><summary>${ic('users')} Users</summary>
      <div class="card dm"><table class="enc"><thead><tr><th>User</th><th>Role</th><th>Character</th></tr></thead><tbody>
        ${users.map(u => `<tr><td>${esc(u.name)}</td><td>${u.role === 'dm' ? '<span class="badge dm">DM</span>' : 'player'}</td>
          <td>${esc(chars.find(x => x.id === u.characterId)?.name || '—')}</td></tr>`).join('')}
      </tbody></table><p class="muted" style="font-size:13px">Logins are GitHub tokens now (⚙ Settings). Only DM users can enter this screen.</p></div>
    </details>

    <details class="collapse"><summary>${ic('clock')} Recent activity (all edits)</summary>
      <div class="card">${history.map(h => `<div class="hist">${new Date(h.ts).toLocaleString()} — <b>${esc(h.user)}</b> · ${esc(h.entity)} · <b>${esc(h.field)}</b></div>`).join('') || '<p class="muted">No activity yet.</p>'}</div>
    </details>
  `;
  // --- encounter ---
  const body = $('#enc-body');
  const drawEnc = () => {
    if ((enc.turn || 0) >= (enc.combatants || []).length) enc.turn = 0;
    body.innerHTML = (enc.combatants || []).map((x, i) => `<tr class="${i === (enc.turn || 0) ? 'turn' : ''}">
      <td><input class="num" value="${x.init ?? ''}" data-e="init" data-i="${i}"></td>
      <td><input value="${esc(x.name || '')}" data-e="name" data-i="${i}"></td>
      <td><input class="num" value="${x.hp ?? ''}" data-e="hp" data-i="${i}"></td>
      <td><input class="num" value="${x.maxHp ?? ''}" data-e="maxHp" data-i="${i}"></td>
      <td><input value="${esc(x.notes || '')}" data-e="notes" data-i="${i}"></td>
      <td><button class="btn small danger" data-e-del="${i}">✕</button></td></tr>`).join('');
    body.querySelectorAll('input').forEach(inp => inp.onchange = () => {
      const x = enc.combatants[Number(inp.dataset.i)];
      x[inp.dataset.e] = ['init', 'hp', 'maxHp'].includes(inp.dataset.e) ? Number(inp.value) || 0 : inp.value;
      saveEnc();
    });
    body.querySelectorAll('[data-e-del]').forEach(b => b.onclick = () => { enc.combatants.splice(Number(b.dataset.eDel), 1); drawEnc(); saveEnc(); });
  };
  const saveEnc = () => api('/api/encounter', { method: 'PUT', body: enc });
  drawEnc();
  $('#enc-add').onclick = () => { enc.combatants.push({ init: 0, name: '', hp: 0, maxHp: 0, notes: '' }); drawEnc(); saveEnc(); };
  $('#enc-party').onclick = () => {
    for (const ch of chars) enc.combatants.push({ init: 0, name: ch.name.split(' ')[0], hp: ch.hpCurrent ?? 0, maxHp: ch.hpMax ?? 0, notes: 'PC', characterId: ch.id });
    drawEnc(); saveEnc();
  };
  $('#enc-sort').onclick = () => { enc.combatants.sort((a, b) => (b.init || 0) - (a.init || 0)); drawEnc(); saveEnc(); };
  $('#enc-monster-add').onclick = () => {
    const m = (typeof BESTIARY !== 'undefined' ? BESTIARY : []).find(b => b.id === $('#enc-monster').value);
    if (!m) { toast('Pick a monster first'); return; }
    const n = Math.max(1, Math.min(12, Number($('#enc-monster-n').value) || 1));
    for (let i = 0; i < n; i++) enc.combatants.push(monsterCombatant(m, enc.combatants));
    drawEnc(); saveEnc(); toast(`${n} × ${m.name} added — initiative rolled`);
  };
  $('#enc-next').onclick = () => {
    const len = enc.combatants.length;
    if (!len) return;
    enc.turn = ((enc.turn || 0) + 1) % len;
    if (enc.turn === 0) { enc.round = (enc.round || 1) + 1; $('#enc-round').textContent = enc.round; }
    drawEnc(); saveEnc();
  };
  $('#round-plus').onclick = () => { enc.round = (enc.round || 1) + 1; $('#enc-round').textContent = enc.round; saveEnc(); };
  $('#round-minus').onclick = () => { enc.round = Math.max(1, (enc.round || 1) - 1); $('#enc-round').textContent = enc.round; saveEnc(); };
  $('#enc-clear').onclick = () => { if (confirm('Clear the encounter?')) { enc.combatants = []; enc.round = 1; enc.turn = 0; $('#enc-round').textContent = 1; drawEnc(); saveEnc(); } };
  // --- prep ---
  const editPrep = (p) => {
    const holder = document.querySelector(`[data-view="${p.id}"]`);
    holder.innerHTML = `<input id="pt" value="${esc(p.title)}" style="width:100%;margin-bottom:6px">
      <textarea id="pc" style="min-height:300px">${esc(p.content)}</textarea>
      <div class="row"><button class="btn primary" id="ps">Save</button><button class="btn" id="px">Cancel</button></div>`;
    holder.querySelector('#ps').onclick = async () => { await api(`/api/prep/${p.id}`, { method: 'PATCH', body: { title: holder.querySelector('#pt').value, content: holder.querySelector('#pc').value } }); render(); };
    holder.querySelector('#px').onclick = render;
  };
  $$('[data-prep-edit]').forEach(b => b.onclick = () => editPrep(prep.find(p => p.id === b.dataset.prepEdit)));
  $$('[data-prep-del]').forEach(b => b.onclick = async () => { if (confirm('Delete prep page?')) { await api(`/api/prep/${b.dataset.prepDel}`, { method: 'DELETE' }); render(); } });
  $('#prep-add').onclick = async () => { await api('/api/prep', { method: 'POST', body: { title: 'New prep page', content: '' } }); render(); };
}

boot();
