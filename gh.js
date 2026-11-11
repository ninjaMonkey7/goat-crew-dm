/* Goat Crew DM screen — GitHub data layer.
   Defines api() + connectSSE() (the contract app.js expects) and media() for images.
   The database is a set of JSON files on one branch of a PRIVATE GitHub repo; every save
   is a commit made with the logged-in DM's personal access token. Loads BEFORE app.js. */
'use strict';

const GH = { owner: 'ninjaMonkey7', repo: 'goat-crew-campaign-app', branch: 'data', base: 'https://api.github.com', pollMs: 4000 };
(() => { try { Object.assign(GH, JSON.parse(localStorage.getItem('gc_gh_repo') || '{}')); } catch (_) { /* ignore */ } })();
let TOKEN = localStorage.getItem('gc_gh_token') || '';

const FILES = {
  users: 'data/users.json', characters: 'data/characters.json', journal: 'data/journal.json', codex: 'data/codex.json',
  quests: 'data/quests.json', notices: 'data/notices.json', arc: 'data/arc.json', prep: 'data/prep.json',
  encounter: 'data/encounter.json', rolls: 'data/rolls.json', history: 'data/history.json', notes: 'data/notes.json',
  chat: 'data/chat.json', maps: 'data/maps.json', pins: 'data/pins.json', plans: 'data/plans.json'
};
const RAW = {};        // name -> parsed JSON (live cache)
const SHA = {};        // path -> blob sha (optimistic concurrency for writes)
const LIVE_HOOKS = {}; // entity -> fn(prev, next): map.js / chat.js update in place instead of a full re-render
let ME = null, headSha = null, headEtag = null, pollTimer = null, loaded = null;

const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
const defaults = name => name === 'encounter' ? { round: 1, turn: 0, combatants: [] } : (name === 'notes' || name === 'plans') ? {} : name === 'pins' ? { pins: [], party: {} } : [];

// ---------- base64 (UTF-8 safe) ----------
const _enc = new TextEncoder(), _dec = new TextDecoder();
function b64encode(str) {
  const bytes = _enc.encode(str); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, '')); const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return _dec.decode(bytes);
}

// ---------- GitHub REST ----------
function fail(code, msg) { const e = new Error(msg); e.code = code; if (typeof toast === 'function') toast(msg, 3500); throw e; }
async function gh(path, opts = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) };
  if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  return fetch(GH.base + path, { method: opts.method || 'GET', headers, cache: 'no-store', body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}
const repoPath = p => `/repos/${encodeURIComponent(GH.owner)}/${encodeURIComponent(GH.repo)}/${p}`;
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
const refPath = () => repoPath(`git/ref/heads/${encodeURIComponent(GH.branch)}`);
function explain(status, what) {
  if (status === 401) return 'GitHub rejected the token. Paste a fine-grained token with Contents: read & write on the data repo.';
  if (status === 403) return 'GitHub refused (403): the token has no access to the data repo, or the rate limit is spent.';
  if (status === 404) return `Not found on GitHub: ${what}. Check the repo/branch in Settings and that the token can see this private repo.`;
  return `GitHub error ${status} (${what})`;
}

async function readFile(name) {
  const path = FILES[name];
  const r = await gh(repoPath(`contents/${encPath(path)}?ref=${encodeURIComponent(GH.branch)}`));
  if (r.status === 404 && SHA[path] === undefined && headSha) { RAW[name] = defaults(name); SHA[path] = null; return RAW[name]; } // missing file: first save creates it
  if (!r.ok) fail(r.status, explain(r.status, path));
  const j = await r.json();
  SHA[path] = j.sha;
  RAW[name] = JSON.parse(b64decode(j.content));
  return RAW[name];
}

/* save(name, mutate, message): apply `mutate` to the latest copy and commit it. On a write
   conflict (someone else saved the same file first) re-read and re-apply, up to 4 times. */
async function save(name, mutate, message) {
  const path = FILES[name];
  for (let attempt = 0; attempt < 4; attempt++) {
    const next = mutate(structuredClone(RAW[name] ?? defaults(name)));
    const body = { message: message || `${ME ? ME.name : 'app'}: update ${name}`, content: b64encode(JSON.stringify(next, null, 1) + '\n'), branch: GH.branch };
    if (SHA[path]) body.sha = SHA[path];
    const r = await gh(repoPath(`contents/${encPath(path)}`), { method: 'PUT', body });
    if (r.ok) {
      const j = await r.json();
      SHA[path] = j.content.sha; if (j.commit) headSha = j.commit.sha;
      RAW[name] = next;
      return next;
    }
    if (r.status === 409 || r.status === 422) { await readFile(name); continue; }
    fail(r.status, explain(r.status, path));
  }
  fail(409, 'Could not save: the other DM changed the same thing at the same moment. Try again.');
}

// ---------- initial load + polling (replaces SSE / Firestore listeners) ----------
async function loadAll() {
  if (loaded) return loaded;
  loaded = (async () => {
    const r = await gh(refPath());
    if (!r.ok) fail(r.status, explain(r.status, `branch ${GH.branch}`));
    headEtag = r.headers.get('etag');
    headSha = (await r.json()).object.sha;
    await Promise.all(Object.keys(FILES).map(readFile));
  })();
  loaded.catch(() => { loaded = null; });
  return loaded;
}
function setLive(on) { const d = document.querySelector('#live-dot'); if (d) d.classList.toggle('on', !!on); }

async function poll() {
  if (document.hidden || !loaded) return;
  try {
    const r = await gh(refPath(), { headers: headEtag ? { 'If-None-Match': headEtag } : {} });
    if (r.status === 304) { setLive(true); return; }
    if (!r.ok) { setLive(false); return; }
    headEtag = r.headers.get('etag');
    const sha = (await r.json()).object.sha;
    setLive(true);
    if (sha === headSha) return;
    headSha = sha;
    await syncTree(sha);
  } catch (e) { console.warn('poll', e); setLive(false); }
}
async function syncTree(sha) {
  const r = await gh(repoPath(`git/trees/${sha}?recursive=1`));
  if (!r.ok) return;
  const bySha = Object.fromEntries(((await r.json()).tree || []).map(t => [t.path, t.sha]));
  const changed = Object.entries(FILES).filter(([, path]) => bySha[path] && bySha[path] !== SHA[path]);
  await Promise.all(changed.map(async ([name]) => {
    const prev = RAW[name];
    await readFile(name);
    onEntityChange(name, prev, RAW[name]);
  }));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

function onEntityChange(entity, prev, next) {
  if (typeof S === 'undefined' || !S.me) return;
  delete S.cache[entity];
  if (LIVE_HOOKS[entity]) { try { LIVE_HOOKS[entity](prev, next); } catch (e) { console.error(e); } }
  if (typeof onEntityEvent === 'function') onEntityEvent(entity, prev, next);
  const tabEntity = { party: 'characters', battle: 'encounter', dice: 'rolls', board: 'notices', journal: 'journal', codex: 'codex', quests: 'quests', arc: 'arc', dm: entity }[S.tab];
  if ((tabEntity === entity || S.tab === 'dm') && !S.formOpen) {
    if (!document.activeElement || !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName)) render();
  }
}

// connectSSE keeps its old name — called from showMain() in app.js
async function connectSSE() {
  try {
    await loadAll();
    setLive(true);
    if (!pollTimer) pollTimer = setInterval(poll, GH.pollMs);
  } catch (e) { console.error(e); setLive(false); }
}

// ---------- media: images live in the private data branch, fetched with the token ----------
const MEDIA = {};
function media(path) {
  if (MEDIA[path]) return MEDIA[path];
  MEDIA[path] = (async () => {
    const r = await gh(repoPath(`contents/${encPath(path)}?ref=${encodeURIComponent(GH.branch)}`), { headers: { Accept: 'application/vnd.github.raw+json' } });
    if (!r.ok) throw new Error(`media ${r.status}: ${path}`);
    return URL.createObjectURL(await r.blob());
  })();
  MEDIA[path].catch(() => { delete MEDIA[path]; });
  return MEDIA[path];
}
new MutationObserver(() => {
  document.querySelectorAll('img[src^="media/"]:not([data-media])').forEach(img => {
    const p = img.getAttribute('src'); img.dataset.media = p; img.removeAttribute('src');
    media(p).then(u => { img.src = u; }).catch(() => { img.alt = '(image unavailable)'; });
  });
}).observe(document.documentElement, { childList: true, subtree: true });

// ---------- visibility filters (everyone here is a DM, kept for parity with the old app) ----------
const isDMUser = u => u.role === 'dm';
function charView(c, user) { const out = { ...c }; if (!isDMUser(user) && user.characterId !== c.id) delete out.dmNotes; out.editable = isDMUser(user) || user.characterId === c.id; return out; }
function codexView(e, user) { if (isDMUser(user)) return { ...e }; if (!e.revealed) return null; const { dmContent, ...rest } = e; return rest; }
function journalView(e, user) { return isDMUser(user) || !e.dmOnly ? { ...e } : null; }
function questView(q, user) { if (isDMUser(user)) return { ...q }; if (q.dmOnly) return null; const { dmNotes, ...rest } = q; return rest; }
function noticeView(n, user) { return isDMUser(user) || !n.dmOnly ? { ...n } : null; }
function arcView(e, user) { return isDMUser(user) ? { ...e } : null; }
function encounterView(enc, user) {
  if (isDMUser(user)) return enc;
  return { round: enc.round || 1, turn: enc.turn || 0, combatants: (enc.combatants || []).map(x => ({ name: x.name, init: x.init, characterId: x.characterId || null, down: (Number(x.maxHp) > 0 && Number(x.hp) <= 0) || undefined })) };
}

// ---------- dice (client-side RNG) ----------
const die = n => 1 + Math.floor(Math.random() * n);
function rollDice(formula, mode) {
  const src = String(formula).replace(/\s+/g, '').toLowerCase();
  if (!src || src.length > 40 || !/^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$/.test(src)) throw new Error('Bad dice formula — try d20+5 or 2d6+3');
  mode = mode === 'adv' || mode === 'dis' ? mode : null;
  let total = 0, modeUsed = false; const detail = [];
  for (const term of src.match(/[+-]?[^+-]+/g)) {
    const sign = term[0] === '-' ? -1 : 1; const body = term.replace(/^[+-]/, '');
    if (body.includes('d')) {
      const [nRaw, fRaw] = body.split('d'); const n = Number(nRaw || 1), faces = Number(fRaw);
      if (n < 1 || n > 20 || faces < 2 || faces > 1000) throw new Error('Dice out of range (max 20 dice, d1000)');
      for (let i = 0; i < n; i++) {
        if (!modeUsed && mode && faces === 20) { const a = die(20), b = die(20); const kept = mode === 'adv' ? Math.max(a, b) : Math.min(a, b); detail.push({ die: 'd20', rolls: [a, b], kept }); total += sign * kept; modeUsed = true; }
        else { const r = die(faces); detail.push({ die: 'd' + faces, rolls: [r], kept: r }); total += sign * r; }
      }
    } else { total += sign * Number(body); detail.push({ mod: sign * Number(body) }); }
  }
  return { formula: src, mode: modeUsed ? mode : null, detail, total };
}

const CHAR_FIELDS = ['name', 'player', 'race', 'klass', 'level', 'hpCurrent', 'hpMax', 'ac', 'gold', 'slots', 'conditions', 'content', 'dmNotes', 'portrait'];
const COLLECTIONS = {
  journal: { view: journalView, fields: ['session', 'title', 'content', 'tags', 'dmOnly'] },
  codex: { view: codexView, fields: ['category', 'name', 'playerContent', 'dmContent', 'image', 'revealed'] },
  quests: { view: questView, fields: ['title', 'status', 'notes', 'dmNotes', 'dmOnly'] },
  notices: { view: noticeView, fields: ['title', 'content', 'type', 'dmOnly', 'parentId'] },
  arc: { view: arcView, fields: ['arc', 'kind', 'title', 'content', 'status', 'owner', 'order', 'session', 'codexId'] }
};
function pickAllowed(body, allowed) { const out = {}; for (const [k, v] of Object.entries(body || {})) if (allowed.includes(k) && v !== undefined) out[k] = v; return out; }

// ---------- history log: batched into one commit every few seconds ----------
let pendingHistory = [], historyTimer = null;
function logHistory(user, entity, entityId, field, oldVal, newVal) {
  pendingHistory.push({ id: uid(), ts: new Date().toISOString(), user: user.name, entity, entityId, field,
    old: typeof oldVal === 'string' ? oldVal.slice(0, 300) : (oldVal ?? null), new: typeof newVal === 'string' ? newVal.slice(0, 300) : (newVal ?? null) });
  clearTimeout(historyTimer);
  historyTimer = setTimeout(async () => {
    const batch = pendingHistory; pendingHistory = [];
    try { await save('history', arr => [...arr, ...batch].slice(-300), `${user.name}: activity log`); } catch (e) { console.warn('history', e); }
  }, 4000);
}

// ---------- session ----------
async function requireMe() {
  if (ME) return ME;
  if (!TOKEN) fail(401, 'Not logged in');
  const id = localStorage.getItem('gc_session');
  if (!id) fail(401, 'Not logged in');
  const users = RAW.users || await readFile('users');
  const u = users.find(x => x.id === id);
  if (!u) { localStorage.removeItem('gc_session'); fail(401, 'Not logged in'); }
  ME = u;
  return ME;
}

// ---------- api() — same signature app.js already uses ----------
async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  try { return await route(path, method, opts.body); }
  catch (e) { if (!e.code) { console.error(e); if (typeof toast === 'function') toast(e.message || 'Error', 3500); } throw e; }
}

async function route(path, method, body) {
  let m;
  // --- auth / setup ---
  if (path === '/api/token' && method === 'POST') {
    TOKEN = String(body.token || '').trim(); localStorage.setItem('gc_gh_token', TOKEN);
    loaded = null; for (const k of Object.keys(RAW)) delete RAW[k]; for (const k of Object.keys(SHA)) delete SHA[k];
    await readFile('users');
    return { ok: true };
  }
  if (path === '/api/repo' && method === 'POST') {
    for (const k of ['owner', 'repo', 'branch']) if (body[k]) GH[k] = String(body[k]).trim();
    localStorage.setItem('gc_gh_repo', JSON.stringify({ owner: GH.owner, repo: GH.repo, branch: GH.branch }));
    return { ok: true };
  }
  if (path === '/api/users/list') {
    const users = RAW.users || await readFile('users');
    return [...users].sort((a, b) => (a.role === 'dm' ? 0 : 1) - (b.role === 'dm' ? 0 : 1) || (a.order ?? 0) - (b.order ?? 0)).map(u => ({ id: u.id, name: u.name, role: u.role }));
  }
  if (path === '/api/login' && method === 'POST') {
    if (body.token && String(body.token).trim()) { TOKEN = String(body.token).trim(); localStorage.setItem('gc_gh_token', TOKEN); loaded = null; }
    if (!TOKEN) fail(401, 'Paste your GitHub token first');
    const users = await readFile('users');
    const u = users.find(x => x.id === body.userId);
    if (!u) fail(401, 'Pick who you are');
    localStorage.setItem('gc_session', u.id); ME = u;
    return { ok: true };
  }
  if (path === '/api/logout' && method === 'POST') { localStorage.removeItem('gc_session'); ME = null; return { ok: true }; }
  if (path === '/api/me') { const u = await requireMe(); return { id: u.id, name: u.name, role: u.role, characterId: u.characterId }; }
  if (path === '/api/setup') return { owner: GH.owner, repo: GH.repo, branch: GH.branch, hasToken: !!TOKEN };

  const user = await requireMe();
  const isDM = user.role === 'dm';
  await loadAll();
  const who = user.name;

  // --- characters ---
  if (path === '/api/characters' && method === 'GET') return RAW.characters.map(c => charView(c, user));
  if ((m = path.match(/^\/api\/characters\/([\w]+)$/)) && method === 'PATCH') {
    const c = RAW.characters.find(x => x.id === m[1]);
    if (!c) fail(404, 'Not found');
    const applied = {};
    for (const [k, v] of Object.entries(pickAllowed(body, CHAR_FIELDS))) if (JSON.stringify(c[k]) !== JSON.stringify(v)) { logHistory(user, 'character', c.id, k, c[k], v); applied[k] = v; }
    if (Object.keys(applied).length) await save('characters', arr => { Object.assign(arr.find(x => x.id === c.id), applied); return arr; }, `${who}: ${c.name} — ${Object.keys(applied).join(', ')}`);
    return charView(RAW.characters.find(x => x.id === c.id), user);
  }
  if ((m = path.match(/^\/api\/characters\/([\w]+)\/history$/)) && method === 'GET') {
    return [...RAW.history, ...pendingHistory].filter(h => h.entity === 'character' && h.entityId === m[1]).sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 50);
  }

  // --- journal / codex / quests / notices / arc ---
  for (const [name, cfg] of Object.entries(COLLECTIONS)) {
    if (path === `/api/${name}` && method === 'GET') return RAW[name].map(e => cfg.view(e, user)).filter(Boolean);
    if (path === `/api/${name}` && method === 'POST') {
      const e = { id: uid(), createdBy: who, order: Date.now(), ts: new Date().toISOString(), ...pickAllowed(body, cfg.fields) };
      await save(name, arr => { arr.push(e); return arr; }, `${who}: new ${name} — ${e.title || e.name || ''}`);
      logHistory(user, name, e.id, '(created)', '', e.title || e.name || '');
      return cfg.view(e, user);
    }
    m = path.match(new RegExp(`^/api/${name}/([\\w]+)$`));
    if (m && method === 'PATCH') {
      const e = RAW[name].find(x => x.id === m[1]);
      if (!e) fail(404, 'Not found');
      const applied = {};
      for (const [k, v] of Object.entries(pickAllowed(body, cfg.fields))) if (JSON.stringify(e[k]) !== JSON.stringify(v)) { logHistory(user, name, e.id, k, e[k], v); applied[k] = v; }
      if (Object.keys(applied).length && name === 'arc') { applied.updatedBy = who; applied.updatedAt = new Date().toISOString(); }
      if (Object.keys(applied).length) await save(name, arr => { Object.assign(arr.find(x => x.id === e.id), applied); return arr; }, `${who}: ${name} — ${e.title || e.name || e.id}`);
      return cfg.view(RAW[name].find(x => x.id === e.id), user);
    }
    if (m && method === 'DELETE') {
      const e = RAW[name].find(x => x.id === m[1]);
      if (!e) fail(404, 'Not found');
      logHistory(user, name, e.id, '(deleted)', e.title || e.name || '', '');
      await save(name, arr => arr.filter(x => x.id !== e.id && !(name === 'notices' && x.parentId === e.id)), `${who}: delete ${name} — ${e.title || e.name || ''}`);
      return { ok: true };
    }
  }
  if ((m = path.match(/^\/api\/codex\/([\w]+)\/reveal$/)) && method === 'POST') {
    const e = RAW.codex.find(x => x.id === m[1]);
    if (!e) fail(404, 'Not found');
    const revealed = !e.revealed;
    await save('codex', arr => { arr.find(x => x.id === e.id).revealed = revealed; return arr; }, `${who}: ${revealed ? 'reveal' : 'hide'} ${e.name}`);
    logHistory(user, 'codex', e.id, 'revealed', !revealed, revealed);
    return { ok: true, revealed };
  }

  // --- my private notes ---
  if (path === '/api/notes' && method === 'GET') return { text: (RAW.notes[user.id] || {}).text || '' };
  if (path === '/api/notes' && method === 'PUT') { await save('notes', o => { o[user.id] = { text: String(body.text || '') }; return o; }, `${who}: notes`); return { ok: true }; }

  // --- encounter ---
  if (path === '/api/encounter' && method === 'GET') return encounterView(structuredClone(RAW.encounter || defaults('encounter')), user);
  if (path === '/api/encounter' && method === 'PUT') { await save('encounter', () => structuredClone(body), `${who}: encounter round ${body.round || 1}`); return { ok: true }; }

  // --- dice ---
  if (path === '/api/rolls' && method === 'GET') return [...(RAW.rolls || [])].sort((a, b) => String(a.ts || '').localeCompare(String(b.ts || ''))).slice(-40);
  if (path === '/api/rolls' && method === 'POST') {
    let roll; try { roll = rollDice(String(body.formula || 'd20'), body.mode); } catch (e) { fail(400, e.message); }
    const entry = { id: uid(), ts: new Date().toISOString(), order: Date.now(), user: who, label: String(body.label || '').slice(0, 80), formula: roll.formula, mode: roll.mode, detail: roll.detail, total: roll.total };
    await save('rolls', arr => [...arr, entry].slice(-150), `${who}: rolled ${entry.total}${entry.label ? ' (' + entry.label + ')' : ''}`);
    return entry;
  }

  // --- maps / pins / floor plans ---
  if (path === '/api/maps' && method === 'GET') return RAW.maps || [];
  if (path === '/api/pins' && method === 'GET') return RAW.pins || defaults('pins');
  if (path === '/api/pins' && method === 'POST') {
    const op = body.op;
    await save('pins', p => {
      p.pins = p.pins || []; p.party = p.party || {};
      if (op === 'add') p.pins.push({ id: uid(), ...body.pin });
      else if (op === 'update') Object.assign(p.pins.find(x => x.id === body.id) || {}, body.fields || {});
      else if (op === 'remove') p.pins = p.pins.filter(x => x.id !== body.id);
      else if (op === 'party') { if (body.x == null) delete p.party[body.mapId]; else p.party[body.mapId] = { x: body.x, y: body.y }; }
      return p;
    }, `${who}: map ${op}${body.pin ? ' — ' + body.pin.label : ''}`);
    return RAW.pins;
  }
  if (path === '/api/plans' && method === 'GET') return RAW.plans || {};
  if ((m = path.match(/^\/api\/plans\/([\w]+)$/)) && method === 'PATCH') {
    await save('plans', p => {
      const plan = p[m[1]]; if (!plan) fail(404, 'No such floor plan');
      if (body.party !== undefined) plan.party = body.party;
      for (const [rid, fields] of Object.entries(body.rooms || {})) { const room = plan.rooms.find(r => r.id === rid); if (room) Object.assign(room, fields); }
      return p;
    }, `${who}: ${m[1]} plan — ${body.party !== undefined ? 'party moved' : 'room notes'}`);
    return RAW.plans[m[1]];
  }

  // --- DM chat ---
  if (path === '/api/chat' && method === 'GET') return (RAW.chat || []).slice(-300);
  if (path === '/api/chat' && method === 'POST') {
    const msg = { id: uid(), ts: new Date().toISOString(), user: body.user || who, kind: body.kind || 'dm', text: String(body.text || '').slice(0, 12000), askedBy: body.askedBy };
    await save('chat', arr => [...arr, msg].slice(-400), `${msg.user}: chat`);
    return msg;
  }

  // --- DM only from here ---
  if (!isDM) fail(403, 'DM only');
  if (path === '/api/prep' && method === 'GET') return RAW.prep.map(p => ({ ...p }));
  if (path === '/api/prep' && method === 'POST') {
    const e = { id: uid(), title: (body && body.title) || 'Untitled', content: (body && body.content) || '', order: Date.now() };
    await save('prep', arr => [...arr, e], `${who}: new prep — ${e.title}`);
    return e;
  }
  if ((m = path.match(/^\/api\/prep\/([\w]+)$/)) && method === 'PATCH') {
    const upd = {}; if (body.title !== undefined) upd.title = body.title; if (body.content !== undefined) upd.content = body.content;
    await save('prep', arr => { Object.assign(arr.find(x => x.id === m[1]) || {}, upd); return arr; }, `${who}: prep — ${upd.title || m[1]}`);
    return { ...(RAW.prep.find(x => x.id === m[1]) || {}), id: m[1] };
  }
  if ((m = path.match(/^\/api\/prep\/([\w]+)$/)) && method === 'DELETE') { await save('prep', arr => arr.filter(x => x.id !== m[1]), `${who}: delete prep`); return { ok: true }; }
  if (path === '/api/users' && method === 'GET') return [...RAW.users].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map(u => ({ id: u.id, name: u.name, role: u.role, characterId: u.characterId }));
  if ((m = path.match(/^\/api\/users\/([\w]+)$/)) && method === 'PATCH') {
    const upd = {}; for (const f of ['name', 'characterId']) if (body[f] !== undefined) upd[f] = body[f];
    await save('users', arr => { Object.assign(arr.find(x => x.id === m[1]) || {}, upd); return arr; }, `${who}: user ${m[1]}`);
    return { ok: true };
  }
  if (path === '/api/history' && method === 'GET') return [...RAW.history, ...pendingHistory].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 100);

  fail(404, 'Unknown endpoint ' + path);
}
