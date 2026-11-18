/* admin.js — Admin tab: people, roles, what each person can open, sign-in links and resets.
   Everything goes through /api/admin/* (gh.js), which hands it to the login server; the server
   enforces roles and access. Loads before app.js. */
'use strict';

const ROLE_INFO = {
  player: { label: 'Player', blurb: 'Their own character sheet, the revealed codex, journal, quests, board, dice, and the battle map as players see it.' },
  dm: { label: 'DM', blurb: 'Everything at the table: DM chat, prep, the arc, hidden notes, monster HP and the full battle map.' },
  admin: { label: 'Admin', blurb: 'Everything a DM has, plus this page: adding people, roles, access, sign-in links and resets.' }
};
const AD = { data: null, open: null };

async function renderAdmin(c) {
  if (!isAdmin(S.me)) { c.innerHTML = '<p class="muted">Only an admin can manage people.</p>'; return; }
  c.innerHTML = '<p class="muted">Loading people…</p>';
  try { AD.data = await api('/api/admin/users'); }
  catch (e) { c.innerHTML = `<div class="card"><h3>Couldn't load people</h3><p class="muted">${esc(e.message || '')}</p></div>`; return; }
  const d = AD.data, users = d.users;
  const count = r => users.filter(u => u.role === r).length;
  const active = users.filter(u => u.status === 'active').length, invited = users.filter(u => u.status === 'invited').length;
  const group = role => users.filter(u => u.role === role).sort((a, b) => a.name.localeCompare(b.name));
  c.innerHTML = `
    <div class="adm">
      <div class="adm-head">
        <div>
          <h2>${ic('shield')} People &amp; access</h2>
          <p class="muted">Who can sign in, what they can open, and their sign-in links.</p>
        </div>
        <button class="btn primary" id="adm-add">${ic('userplus')} Add person</button>
      </div>
      ${d.tokenMode ? `<div class="adm-banner">
        <b>${ic('lock')} Roles aren't enforced yet.</b>
        <span>Right now everyone signs in with a GitHub token, which can read everything, so players can't have their own logins. Set up the login server
        (Settings → Login server, about 15 minutes) to turn on passwords, sign-in links, resets and real player access. Until then you can still set names, roles and characters here.</span>
      </div>` : ''}
      <div class="adm-stats">
        <div><b>${count('admin')}</b><span>Admin${count('admin') === 1 ? '' : 's'}</span></div>
        <div><b>${count('dm')}</b><span>DM${count('dm') === 1 ? '' : 's'}</span></div>
        <div><b>${count('player')}</b><span>Player${count('player') === 1 ? '' : 's'}</span></div>
        ${d.tokenMode ? '' : `<div><b>${active}</b><span>Can sign in</span></div><div><b>${invited}</b><span>Link waiting</span></div>`}
      </div>
      ${['admin', 'dm', 'player'].map(r => group(r).length ? `
        <section class="adm-group">
          <h3>${ROLE_INFO[r].label}s <span class="muted">${group(r).length}</span></h3>
          <div class="adm-list">${group(r).map(admRow).join('')}</div>
        </section>` : '').join('')}
    </div>
    <div id="adm-drawer" class="adm-drawer hidden" role="dialog" aria-modal="true" aria-labelledby="adm-drawer-title"></div>
    <div id="adm-modal" class="adm-modal hidden" role="dialog" aria-modal="true"></div>`;
  $('#adm-add').onclick = () => admOpen(null);
  $$('.adm-row').forEach(r => r.onclick = e => { if (!e.target.closest('[data-quick]')) admOpen(r.dataset.id); });
  $$('[data-quick="link"]').forEach(b => b.onclick = e => { e.stopPropagation(); admLink(b.dataset.id, 'invite'); });
}

function admStatus(u) {
  if (u.status === 'token') return '<span class="adm-status muted">GitHub token</span>';
  if (u.bootstrap && u.status === 'no-login') return '<span class="adm-status ok">● Admin passcode</span><span class="adm-sub">set on the login server</span>';
  if (u.status === 'active') return `<span class="adm-status ok">● Can sign in</span><span class="adm-sub">${u.lastLogin ? 'last ' + admAgo(u.lastLogin) : 'not signed in yet'}</span>`;
  if (u.status === 'invited') return `<span class="adm-status wait">● Link waiting</span><span class="adm-sub">expires ${admIn(u.inviteExp)}</span>`;
  if (u.status === 'disabled') return '<span class="adm-status off">● Switched off</span>';
  return '<span class="adm-status muted">No login yet</span>';
}
function admAccess(u) {
  const all = AD.data.tabs.filter(t => u.role !== 'player' || t.player);
  const n = all.filter(t => u.tabs.includes(t.id)).length;
  return n >= all.length ? `All ${u.role === 'player' ? 'player ' : ''}tabs` : `${n} of ${all.length} tabs`;
}
function admRow(u) {
  const ch = AD.data.characters.find(c => c.id === u.characterId);
  const canLink = !AD.data.tokenMode && u.status !== 'disabled' && !(u.bootstrap && u.status !== 'active' && u.status !== 'no-login');
  return `<div class="adm-row ${u.status === 'disabled' ? 'is-off' : ''}" data-id="${esc(u.id)}" tabindex="0" role="button" aria-label="Edit ${esc(u.name)}">
    <div class="adm-av role-${esc(u.role)}">${esc((u.name || '?').trim()[0] || '?')}</div>
    <div class="adm-who"><b>${esc(u.name)}</b><span>${u.email ? esc(u.email) : (ch ? 'plays ' + esc(ch.name) : '<i>no e-mail</i>')}</span></div>
    <div class="adm-col adm-char">${ch ? `${ic('users')} ${esc(ch.name)}` : '<span class="muted">—</span>'}</div>
    <div class="adm-col adm-state">${admStatus(u)}</div>
    <div class="adm-col adm-acc">${esc(admAccess(u))}</div>
    <div class="adm-col adm-act">${canLink && u.status !== 'active' ? `<button class="btn small" data-quick="link" data-id="${esc(u.id)}">${ic('send')} Send link</button>` : ''}<span class="adm-chev">›</span></div>
  </div>`;
}

/* ---------- edit drawer ---------- */
function admOpen(id) {
  const d = AD.data, isNew = !id;
  const u = isNew ? { id: null, name: '', email: '', role: 'player', characterId: null, tabs: defaultTabs('player'), access: null, status: 'no-login' } : d.users.find(x => x.id === id);
  if (!u) return;
  AD.open = { ...u, tabsSel: new Set(u.tabs.filter(t => t !== 'admin')), custom: !!u.access };
  const dr = $('#adm-drawer');
  const self = u.id === S.me.id;
  dr.innerHTML = `
    <div class="adm-scrim" data-close></div>
    <div class="adm-panel">
      <div class="adm-panel-head">
        <h3 id="adm-drawer-title">${isNew ? 'Add a person' : esc(u.name)}</h3>
        <button class="btn ghost small" data-close aria-label="Close">${ic('x')}</button>
      </div>
      <div class="adm-panel-body">
        <label>Name</label>
        <input id="ad-name" value="${esc(u.name)}" maxlength="60" placeholder="e.g. Sam">
        <label>E-mail <span class="muted">(only used to e-mail their sign-in link)</span></label>
        <input id="ad-email" type="email" value="${esc(u.email || '')}" placeholder="name@example.com" ${d.tokenMode ? 'disabled' : ''}>
        <label>Role</label>
        <div class="segmented adm-roles" role="group" aria-label="Role">${d.roles.map(r => `<button type="button" data-role="${r}" aria-pressed="${r === u.role}" ${self && r !== 'admin' ? 'disabled' : ''}>${ROLE_INFO[r].label}</button>`).join('')}</div>
        <p class="adm-hint" id="ad-role-blurb">${esc(ROLE_INFO[u.role].blurb)}</p>
        <label>Character</label>
        <select id="ad-char"><option value="">— none —</option>${d.characters.map(c => `<option value="${esc(c.id)}" ${c.id === u.characterId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
        <div class="adm-acc-head"><label>Can open</label>${d.tokenMode ? '' : '<button type="button" class="btn ghost small" id="ad-acc-reset">Reset to default</button>'}</div>
        <div class="adm-tabs" id="ad-tabs"></div>
        <p class="adm-hint" id="ad-acc-hint"></p>
        ${isNew || d.tokenMode ? '' : `
        <div class="adm-section">
          <h4>${ic('lock')} Sign-in</h4>
          <div class="adm-signin">${admStatus(u)}</div>
          <div class="adm-btns">
            <button class="btn" id="ad-link" ${u.status === 'disabled' ? 'disabled' : ''}>${ic('send')} ${u.status === 'active' ? 'Send a new sign-in link' : 'Send sign-in link'}</button>
            <button class="btn" id="ad-reset" ${u.status !== 'active' || self ? 'disabled' : ''}>${ic('rotate')} Reset password</button>
            <button class="btn" id="ad-signout" ${u.status !== 'active' ? 'disabled' : ''}>${ic('logout')} Sign out everywhere</button>
          </div>
          <p class="adm-hint">A sign-in link works once and lasts 7 days; they choose their own password. Resetting stops the old password at once and signs them out on every device.</p>
        </div>
        <div class="adm-section adm-danger">
          <h4>${ic('power')} Danger zone</h4>
          <div class="adm-btns">
            <button class="btn" id="ad-toggle" ${self || u.bootstrap ? 'disabled' : ''}>${u.status === 'disabled' ? `${ic('power')} Switch login back on` : `${ic('power')} Switch off login`}</button>
            <button class="btn danger" id="ad-delete" ${self || u.bootstrap ? 'disabled' : ''}>${ic('trash')} Remove person</button>
          </div>
          ${u.bootstrap ? '<p class="adm-hint">This is the main admin set on the login server (ADMIN_USER), so it can\'t be switched off or removed here.</p>' : ''}
        </div>`}
      </div>
      <div class="adm-panel-foot">
        <span class="err" id="ad-err"></span>
        <button class="btn ghost" data-close>Cancel</button>
        <button class="btn primary" id="ad-save">${isNew ? `${ic('userplus')} Add person` : 'Save changes'}</button>
      </div>
    </div>`;
  dr.classList.remove('hidden');
  document.body.classList.add('adm-locked');
  admDrawTabs();
  setTimeout(() => $('#ad-name').focus(), 30);
  $$('#adm-drawer [data-close]').forEach(b => b.onclick = admClose);
  dr.onkeydown = e => { if (e.key === 'Escape') admClose(); };
  $$('#adm-drawer [data-role]').forEach(b => b.onclick = () => {
    AD.open.role = b.dataset.role;
    $$('#adm-drawer [data-role]').forEach(x => x.setAttribute('aria-pressed', x === b));
    $('#ad-role-blurb').textContent = ROLE_INFO[AD.open.role].blurb;
    if (!AD.open.custom) AD.open.tabsSel = new Set(defaultTabs(AD.open.role).filter(t => t !== 'admin'));
    admDrawTabs();
  });
  if ($('#ad-acc-reset')) $('#ad-acc-reset').onclick = () => { AD.open.custom = false; AD.open.tabsSel = new Set(defaultTabs(AD.open.role).filter(t => t !== 'admin')); admDrawTabs(); };
  $('#ad-save').onclick = () => admSave(isNew);
  if (!isNew && !d.tokenMode) {
    $('#ad-link').onclick = () => admLink(u.id, 'invite');
    $('#ad-reset').onclick = () => admConfirm(`Reset ${u.name}'s password?`, 'Their old password stops working straight away and they are signed out on every device. You\'ll get a new sign-in link to send them.', 'Reset password', () => admLink(u.id, 'reset'));
    $('#ad-signout').onclick = () => admConfirm(`Sign ${u.name} out everywhere?`, 'Every device they are signed in on goes back to the sign-in screen. Their password stays the same.', 'Sign out everywhere', async () => { await api(`/api/admin/users/${u.id}/signout`, { method: 'POST' }); toast(`${u.name} is signed out everywhere`); });
    $('#ad-toggle').onclick = () => u.status === 'disabled'
      ? admDo(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { disabled: false } }), `${u.name} can sign in again`)
      : admConfirm(`Switch off ${u.name}'s login?`, 'They are signed out at once and can\'t sign in until you switch it back on. Nothing they made is deleted.', 'Switch off', () => admDo(() => api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { disabled: true } }), `${u.name}'s login is switched off`));
    $('#ad-delete').onclick = () => admConfirm(`Remove ${u.name}?`, `They lose their login and disappear from the people list. Their character${u.characterId ? ' sheet' : ''}, rolls and journal entries stay.`, 'Remove', () => admDo(() => api(`/api/admin/users/${u.id}`, { method: 'DELETE' }), `${u.name} removed`), true);
  }
}
function admDrawTabs() {
  const o = AD.open, d = AD.data;
  const allowed = d.tabs.filter(t => o.role !== 'player' || t.player);
  $('#ad-tabs').innerHTML = allowed.map(t => `<label class="adm-tab ${o.tabsSel.has(t.id) ? 'on' : ''}"><input type="checkbox" data-tab="${t.id}" ${o.tabsSel.has(t.id) ? 'checked' : ''} ${d.tokenMode ? 'disabled' : ''}>${ic(TAB_ICONS[t.id] || 'square')}<span>${esc(t.label)}</span></label>`).join('');
  $('#ad-acc-hint').textContent = d.tokenMode ? 'Per-person access needs the login server.'
    : o.role === 'player' ? 'Players never see DM chat, prep, the arc or hidden notes, whatever is ticked here.'
    : 'DMs and admins can read everything; unticking only hides the tab for them.';
  $$('#ad-tabs input').forEach(i => i.onchange = () => {
    o.custom = true;
    if (i.checked) o.tabsSel.add(i.dataset.tab); else o.tabsSel.delete(i.dataset.tab);
    i.closest('.adm-tab').classList.toggle('on', i.checked);
  });
}
async function admSave(isNew) {
  const o = AD.open, err = $('#ad-err'); err.textContent = '';
  const body = { name: $('#ad-name').value.trim(), role: o.role, characterId: $('#ad-char').value || null };
  if (!body.name) { err.textContent = 'Give them a name'; return; }
  if (!AD.data.tokenMode) {
    body.email = $('#ad-email').value.trim();
    const allowed = AD.data.tabs.filter(t => o.role !== 'player' || t.player).map(t => t.id);
    const sel = allowed.filter(t => o.tabsSel.has(t));
    body.access = o.custom && sel.length !== allowed.length ? { tabs: sel } : null;
  }
  $('#ad-save').disabled = true;
  try {
    if (isNew) {
      const res = await api('/api/admin/users', { method: 'POST', body });
      admClose(); await renderAdmin($('#content'));
      toast(`${body.name} added`);
      if (!AD.data.tokenMode) admLink(res.id, 'invite');
    } else {
      await api(`/api/admin/users/${o.id}`, { method: 'PATCH', body });
      admClose(); await renderAdmin($('#content')); toast('Saved');
    }
  } catch (e) { err.textContent = e.message || 'Could not save'; $('#ad-save').disabled = false; }
}
function admClose() { const dr = $('#adm-drawer'); if (dr) { dr.classList.add('hidden'); dr.innerHTML = ''; } document.body.classList.remove('adm-locked'); AD.open = null; }
async function admDo(fn, msg) { try { await fn(); admClose(); await renderAdmin($('#content')); if (msg) toast(msg); } catch (e) { toast(e.message || 'Something went wrong', 4000); } }

/* ---------- sign-in link dialog ---------- */
function admInviteUrl(token) {
  const base = location.origin + location.pathname;
  const fromConfig = !!(window.GC_CONFIG && GC_CONFIG.worker) && !localStorage.getItem('gc_worker');
  return `${base}#invite=${encodeURIComponent(token)}${fromConfig ? '' : `&worker=${encodeURIComponent(WORKER)}`}`;
}
async function admLink(id, kind) {
  let res;
  try { res = await api(`/api/admin/users/${id}/${kind}`, { method: 'POST' }); }
  catch (e) { toast(e.message || 'Could not make a link', 4000); return; }
  const link = admInviteUrl(res.token), u = res.user;
  const until = new Date(res.exp).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const subject = 'Your sign-in for the Goat Crew table';
  const message = `Hi ${u.name},\n\n${kind === 'reset' ? 'Your password for the Goat Crew screen has been reset. ' : ''}Here's your sign-in link for the Goat Crew screen:\n${link}\n\nOpen it, choose a password, and you're in. It works once and expires on ${until}.\n`;
  if (AD.open) admClose();
  await renderAdmin($('#content'));
  const md = $('#adm-modal');
  md.innerHTML = `
    <div class="adm-scrim" data-close></div>
    <div class="adm-dialog">
      <div class="adm-dialog-icon">${ic(kind === 'reset' ? 'rotate' : 'send')}</div>
      <h3>${kind === 'reset' ? `Password reset for ${esc(u.name)}` : `Sign-in link for ${esc(u.name)}`}</h3>
      <p class="muted">${kind === 'reset' ? 'Their old password has stopped working and every device is signed out. ' : ''}Send them this link. It works once, expires on <b>${esc(until)}</b>, and lets them choose their own password.</p>
      <div class="adm-linkbox"><input id="am-link" readonly value="${esc(link)}"><button class="btn" id="am-copy">${ic('copy')} Copy</button></div>
      <label class="muted" for="am-msg">Message</label>
      <textarea id="am-msg" rows="6">${esc(message)}</textarea>
      <div class="adm-dialog-actions">
        ${u.email ? `<a class="btn" id="am-mail" href="mailto:${encodeURIComponent(u.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}">${ic('mail')} E-mail ${esc(u.email)}</a>` : `<span class="adm-hint">Add an e-mail address to send it from here.</span>`}
        ${navigator.share ? `<button class="btn" id="am-share">${ic('share')} Share…</button>` : ''}
        <button class="btn" id="am-copymsg">${ic('copy')} Copy message</button>
        <button class="btn primary" data-close>Done</button>
      </div>
      <p class="adm-hint">Send it privately (a direct message, not a group chat): anyone with the link can set the password until it's used.</p>
    </div>`;
  md.classList.remove('hidden');
  const close = () => { md.classList.add('hidden'); md.innerHTML = ''; };
  $$('#adm-modal [data-close]').forEach(b => b.onclick = close);
  md.onkeydown = e => { if (e.key === 'Escape') close(); };
  const copy = async (text, what) => { try { await navigator.clipboard.writeText(text); toast(`${what} copied`); } catch (_) { $('#am-link').select(); toast('Select and copy it by hand', 3000); } };
  $('#am-copy').onclick = () => copy(link, 'Link');
  $('#am-copymsg').onclick = () => copy($('#am-msg').value, 'Message');
  if ($('#am-mail')) $('#am-mail').onclick = () => { $('#am-mail').href = `mailto:${encodeURIComponent(u.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent($('#am-msg').value)}`; };
  if ($('#am-share')) $('#am-share').onclick = async () => { try { await navigator.share({ title: subject, text: $('#am-msg').value }); } catch (_) { /* cancelled */ } };
  setTimeout(() => $('#am-copy').focus(), 30);
}

/* ---------- small confirm dialog ---------- */
function admConfirm(title, text, okLabel, onOk, danger) {
  const md = $('#adm-modal');
  md.innerHTML = `<div class="adm-scrim" data-close></div>
    <div class="adm-dialog adm-confirm">
      <h3>${esc(title)}</h3><p class="muted">${esc(text)}</p>
      <div class="adm-dialog-actions"><button class="btn ghost" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="am-ok">${esc(okLabel)}</button></div>
    </div>`;
  md.classList.remove('hidden');
  const close = () => { md.classList.add('hidden'); md.innerHTML = ''; };
  $$('#adm-modal [data-close]').forEach(b => b.onclick = close);
  md.onkeydown = e => { if (e.key === 'Escape') close(); };
  $('#am-ok').onclick = async () => { $('#am-ok').disabled = true; close(); await onOk(); };
  setTimeout(() => $('#am-ok').focus(), 30);
}

/* ---------- time words ---------- */
function admAgo(iso) {
  const s = (Date.now() - Date.parse(iso)) / 1000;
  if (s < 90) return 'just now'; if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`; const d = Math.round(s / 86400);
  return d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString();
}
function admIn(ms) { const d = Math.ceil((ms - Date.now()) / 86400e3); return d <= 0 ? 'today' : d === 1 ? 'tomorrow' : `in ${d} days`; }
