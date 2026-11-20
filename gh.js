/* Goat Crew DM screen — GitHub data layer.
   Defines api() + connectSSE() (the contract app.js expects) and media() for images.
   The database is a set of JSON files on one branch of a PRIVATE GitHub repo; every save
   is a commit made with the logged-in DM's personal access token. Loads BEFORE app.js. */
'use strict';

const GH = { owner: 'ninjaMonkey7', repo: 'goat-crew-campaign-app', branch: 'data', base: 'https://api.github.com', pollMs: 4000 };
(() => { try { Object.assign(GH, JSON.parse(localStorage.getItem('gc_gh_repo') || '{}')); } catch (_) { /* ignore */ } })();
// Invite link: index.html#token=…&user=codm (token mode) or #worker=https://…&user=codm (login server).
// Sign-in link from an admin: index.html#invite=<signed token>[&worker=https://…] → "choose your password".
(() => {
  try {
    const h = new URLSearchParams(location.hash.replace(/^#/, ''));
    const t = (h.get('token') || '').trim(), u = (h.get('user') || '').trim(), w = (h.get('worker') || '').trim(), inv = (h.get('invite') || '').trim();
    if (!t && !u && !w && !inv) return;
    if (inv) { sessionStorage.setItem('gc_invite', inv); localStorage.removeItem('gc_wsession'); localStorage.removeItem('gc_session'); }
    if (w) { localStorage.setItem('gc_worker', w.replace(/\/+$/, '')); localStorage.removeItem('gc_wsession'); }
    if (t) localStorage.setItem('gc_gh_token', t);
    if (u) { localStorage.setItem('gc_user', u); if (t) localStorage.setItem('gc_session', u); }
    history.replaceState(null, '', location.pathname + location.search);
  } catch (_) { /* ignore */ }
})();
let TOKEN = localStorage.getItem('gc_gh_token') || '';
// Login server (Cloudflare Worker) mode: it holds the GitHub token and the Anthropic key; we hold a signed session.
const CFG = (typeof window !== 'undefined' && window.GC_CONFIG) || {};
let WORKER = (localStorage.getItem('gc_worker') || CFG.worker || '').replace(/\/+$/, '');
let WSESSION = localStorage.getItem('gc_wsession') || '';
const workerMode = () => !!WORKER;

const FILES = {
  users: 'data/users.json', characters: 'data/characters.json', journal: 'data/journal.json', codex: 'data/codex.json',
  quests: 'data/quests.json', notices: 'data/notices.json', arc: 'data/arc.json', prep: 'data/prep.json',
  encounter: 'data/encounter.json', rolls: 'data/rolls.json', history: 'data/history.json', notes: 'data/notes.json',
  chat: 'data/chat.json', maps: 'data/maps.json', pins: 'data/pins.json', plans: 'data/plans.json',
  battle: 'data/battle.json', relations: 'data/relations.json'
};
const RAW = {};        // name -> parsed JSON (live cache)
const SHA = {};        // path -> blob sha (optimistic concurrency for writes)
const LIVE_HOOKS = {}; // entity -> fn(prev, next): map.js / chat.js update in place instead of a full re-render
let ME = null, headSha = null, headEtag = null, pollTimer = null, loaded = null;

const uid = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, '0')).join('');
const defaults = name => name === 'encounter' ? { round: 1, turn: 0, combatants: [] } : (name === 'notes' || name === 'plans') ? {} : name === 'pins' ? { pins: [], party: {} }
  : name === 'battle' ? { scenes: [], display: { sceneId: null, follow: 'dm', camera: null, showInit: true } } : name === 'relations' ? { links: [], people: {} } : [];

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
let QUIET = 0; // background saves report through their own status line, not pop-ups
function fail(code, msg) { const e = new Error(msg); e.code = code; if (typeof toast === 'function' && msg !== 'Not logged in' && !QUIET) toast(msg, 3500); throw e; }
async function gh(path, opts = {}) {
  const headers = { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(opts.headers || {}) };
  if (workerMode()) { if (WSESSION) headers.Authorization = 'Bearer ' + WSESSION; }
  else if (TOKEN) headers.Authorization = 'Bearer ' + TOKEN;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const base = workerMode() ? WORKER + '/gh' : GH.base;
  return fetch(base + path, { method: opts.method || 'GET', headers, cache: 'no-store', body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
}
async function workerCall(path, opts = {}) {
  const headers = { Accept: 'application/json', ...(opts.headers || {}) };
  if (WSESSION) headers.Authorization = 'Bearer ' + WSESSION;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  let r;
  try { r = await fetch(WORKER + path, { method: opts.method || 'GET', headers, cache: 'no-store', body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined }); }
  catch (e) { fail(0, `Cannot reach the login server at ${WORKER}`); }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) fail(r.status, j.message || `Login server error ${r.status}`);
  return j;
}
const repoPath = p => `/repos/${encodeURIComponent(GH.owner)}/${encodeURIComponent(GH.repo)}/${p}`;
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
const refPath = () => repoPath(`git/ref/heads/${encodeURIComponent(GH.branch)}`);
function explain(status, what) {
  if (status === 401 && workerMode()) return 'Your session has expired. Log out and log in again with your passcode.';
  if (status === 401) return 'GitHub rejected the token. Paste a fine-grained token with Contents: read & write on the data repo.';
  if (status === 403 && workerMode()) return 'GitHub refused the login server\'s key (403). An admin should check GITHUB_TOKEN on the login server.';
  if (status === 403) return 'GitHub refused (403): the token has no access to the data repo, or the rate limit is spent.';
  if (status === 404) return `Not found on GitHub: ${what}. Check the repo/branch in Settings and that the token can see this private repo.`;
  return `GitHub error ${status} (${what})`;
}
/* Why a request failed, in plain words. Through the login server a refusal can come from the server itself
   ("Players can't change that", "You can only change your own character sheet") or from GitHub. Only GitHub's
   own refusals (they carry a documentation_url, or the server's "GitHub 403") mention the GitHub key. */
async function whyFailed(r, what) {
  let j = null; try { j = await r.clone().json(); } catch (_) { /* not JSON */ }
  const msg = j && j.message ? String(j.message) : '';
  const fromGitHub = !!(j && j.documentation_url) || /^GitHub \d+$/.test(msg);
  if (/rate limit/i.test(msg)) return 'GitHub\'s hourly request limit is used up. Wait a few minutes and try again.';
  if (/^Players can't change that/i.test(msg)) return 'Only the DMs can change that.';
  if (workerMode() && msg && !fromGitHub && r.status !== 401) return msg;
  return explain(r.status, what);
}

async function readFile(name) {
  const path = FILES[name];
  const r = await gh(repoPath(`contents/${encPath(path)}?ref=${encodeURIComponent(GH.branch)}`));
  if (r.status === 404 && (SHA[path] === undefined || SHA[path] === null) && headSha) { RAW[name] = defaults(name); SHA[path] = null; return RAW[name]; } // missing file: first save creates it
  if (!r.ok) fail(r.status, await whyFailed(r, path));
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
    if (ME) body.author = { name: ME.name, email: `${ME.id}@goat-crew.local` }; // git history shows which DM saved
    if (SHA[path]) body.sha = SHA[path];
    const r = await gh(repoPath(`contents/${encPath(path)}`), { method: 'PUT', body });
    if (r.ok) {
      const j = await r.json();
      SHA[path] = j.content.sha; advanceHead(j.commit);
      RAW[name] = next;
      try { window.dispatchEvent(new CustomEvent('gc-saved', { detail: { name } })); } catch (_) { /* no window (tests) */ }
      return next;
    }
    if (r.status === 409 || r.status === 422) { await readFile(name); continue; }
    fail(r.status, await whyFailed(r, path));
  }
  fail(409, 'Could not save: the other DM changed the same thing at the same moment. Try again.');
}

/* ---------- character sheets: one file per character, data/sheets/<id>.json ----------
   Kept apart from characters.json so two players saving at once never collide, and so the party list stays small.
   Fields the tracker and battle map use (name, race, class, level, AC, HP, conditions, gold) stay on the character. */
const SHEETS = {};                                   // character id -> parsed sheet (loaded when first opened)
const sheetPath = id => `data/sheets/${id}.json`;
const SHEET_ID_RE = /^[a-z0-9_-]+$/i;
async function readSheet(id) {
  const path = sheetPath(id);
  const r = await gh(repoPath(`contents/${encPath(path)}?ref=${encodeURIComponent(GH.branch)}`));
  if (r.status === 404) { SHEETS[id] = {}; SHA[path] = null; return SHEETS[id]; } // no sheet yet: the first save creates it
  if (!r.ok) fail(r.status, await whyFailed(r, path));
  const j = await r.json();
  SHA[path] = j.sha;
  let v = {}; try { v = JSON.parse(b64decode(j.content || '')); } catch (_) { v = {}; }
  SHEETS[id] = v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  return SHEETS[id];
}
async function saveSheet(id, mutate, message) {
  const path = sheetPath(id);
  if (SHEETS[id] === undefined) await readSheet(id);
  for (let attempt = 0; attempt < 4; attempt++) {
    const next = mutate(structuredClone(SHEETS[id] || {}));
    const body = { message: message || `${ME ? ME.name : 'app'}: sheet ${id}`, content: b64encode(JSON.stringify(next, null, 1) + '\n'), branch: GH.branch };
    if (ME) body.author = { name: ME.name, email: `${ME.id}@goat-crew.local` };
    if (SHA[path]) body.sha = SHA[path];
    const r = await gh(repoPath(`contents/${encPath(path)}`), { method: 'PUT', body });
    if (r.ok) { const j = await r.json(); SHA[path] = j.content.sha; advanceHead(j.commit); SHEETS[id] = next; return next; }
    if (r.status === 409 || r.status === 422) { await readSheet(id); continue; } // someone else saved first: re-apply our edits on top of theirs
    fail(r.status, await whyFailed(r, path));
  }
  fail(409, 'Could not save the sheet: it changed at the same moment on another screen. Try again.');
}
/* Sheet edits arrive as small operations, applied to the latest copy, so edits from two screens merge:
   { op: 'set', p: 'abilities.str.score', v: 14 } · { op: 'add', p: 'attacks', v: { id, … } } · { op: 'del', p: 'attacks.@<rowId>' }
   A path step "@id" picks the list row with that id (rows move when others add or delete, ids don't). */
const SHEET_PATH_RE = /^[\w@-]+(\.[\w@-]+){0,5}$/;
const BAD_KEYS = new Set(['__proto__', 'prototype', 'constructor']);
function sheetWalk(root, segs, create) {
  let cur = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const s = segs[i];
    let next;
    if (s[0] === '@') { next = Array.isArray(cur) ? cur.find(x => x && x.id === s.slice(1)) : null; if (!next) return null; }
    else {
      next = cur[s];
      if (next == null || typeof next !== 'object') { if (!create) return null; next = segs[i + 1][0] === '@' ? [] : {}; cur[s] = next; }
    }
    cur = next;
  }
  return cur;
}
function applySheetOps(sheet, ops) {
  for (const o of ops || []) {
    if (!o || typeof o.p !== 'string' || !SHEET_PATH_RE.test(o.p)) continue;
    const segs = o.p.split('.');
    if (segs.some(s => BAD_KEYS.has(s.replace(/^@/, '')))) continue;
    const last = segs[segs.length - 1];
    if (o.op === 'set') {
      if (last[0] === '@') continue;
      const parent = sheetWalk(sheet, segs, true);
      if (parent && typeof parent === 'object' && !Array.isArray(parent)) parent[last] = o.v;
    } else if (o.op === 'add') {
      if (!o.v || typeof o.v !== 'object' || !o.v.id || last[0] === '@') continue;
      const parent = sheetWalk(sheet, segs, true);
      if (!parent || Array.isArray(parent)) continue;
      if (!Array.isArray(parent[last])) parent[last] = [];
      if (!parent[last].some(x => x && x.id === o.v.id)) parent[last].push(o.v);
    } else if (o.op === 'del') {
      if (last[0] !== '@' || segs.length < 2) continue;
      const arr = sheetWalk(sheet, [...segs.slice(0, -1), 'x'], false); // walks the whole parent path: the list itself
      if (Array.isArray(arr)) { const i = arr.findIndex(x => x && x.id === last.slice(1)); if (i >= 0) arr.splice(i, 1); }
    }
  }
  return sheet;
}

/* Our own commit becomes the known head only if it sits directly on the head we last synced;
   otherwise the other DM committed in between and the next poll must still fetch their change. */
function advanceHead(commit) {
  if (!commit) return;
  const parent = commit.parents && commit.parents[0] && commit.parents[0].sha;
  if (parent && parent === headSha) headSha = commit.sha;
}

// ---------- initial load + polling (replaces SSE / Firestore listeners) ----------
async function loadAll() {
  if (loaded) return loaded;
  loaded = (async () => {
    const r = await gh(refPath());
    if (!r.ok) fail(r.status, await whyFailed(r, `branch ${GH.branch}`));
    headEtag = r.headers.get('etag');
    headSha = (await r.json()).object.sha;
    // Only fetch files that exist and that this person may read (the login server lists just those for players)
    const t = await gh(repoPath(`git/trees/${headSha}?recursive=1`));
    const present = t.ok ? new Set(((await t.json()).tree || []).map(x => x.path)) : null;
    await Promise.all(Object.entries(FILES).map(([name, path]) => {
      if (present && !present.has(path)) { RAW[name] = defaults(name); SHA[path] = null; return null; }
      return readFile(name);
    }));
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
  // sheets someone has open on this screen: pick up edits made elsewhere
  const sheetsChanged = Object.keys(SHEETS).filter(id => bySha[sheetPath(id)] && bySha[sheetPath(id)] !== SHA[sheetPath(id)]);
  await Promise.all(sheetsChanged.map(async id => {
    const prev = SHEETS[id];
    try { await readSheet(id); } catch (e) { console.warn('sheet', e); return; }
    onEntityChange('sheet', prev, SHEETS[id], id);
  }));
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

function onEntityChange(entity, prev, next, id) {
  if (typeof S === 'undefined' || !S.me) return;
  delete S.cache[entity];
  if (LIVE_HOOKS[entity]) { try { LIVE_HOOKS[entity](prev, next, id); } catch (e) { console.error(e); } }
  if (typeof onEntityEvent === 'function') onEntityEvent(entity, prev, next);
  if (entity === 'sheet') return; // only an open sheet cares, and it updates itself in place (LIVE_HOOKS.sheet)
  // an open character sheet updates field by field instead of re-rendering over what someone is typing
  // 'main' / 'rail' / false: where an open sheet just updated itself, so that panel is not re-rendered
  const sheetIn = entity === 'characters' && typeof S.sheetLive === 'function' ? S.sheetLive(next) : false;
  const typing = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
  const tabEntity = { party: 'characters', battle: 'encounter', dice: 'rolls', board: 'notices', journal: 'journal', codex: 'codex', quests: 'quests', arc: 'arc', dm: entity }[S.tab];
  if ((tabEntity === entity || S.tab === 'dm') && !S.formOpen && !typing && sheetIn !== 'main') render();
  // the pinned panel in the right rail follows the same entity (chat and map update in place via LIVE_HOOKS)
  const pinEntity = S.pin && S.pin !== S.tab ? { party: 'characters', battle: 'encounter', dice: 'rolls' }[S.pin] : null;
  if (pinEntity === entity && !S.formOpen && !typing && sheetIn !== 'rail' && typeof renderRail === 'function') renderRail();
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
/* uploadMedia(file, dir): put an image into the data branch and return { path, w, h }.
   Refuses files over 15 MB; anything over maxSide px on its long side (or a heavy/odd format) is
   downscaled in a canvas and re-encoded as WebP (JPEG where the browser cannot encode WebP). */
const MEDIA_MAX_BYTES = 15 * 1024 * 1024;
async function shrinkImage(file, maxSide, { square = false } = {}) {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  // square: crop the middle (portraits), a little above centre on tall photos, where faces usually are
  const side = Math.min(bmp.width, bmp.height);
  const sx = square ? Math.round((bmp.width - side) / 2) : 0, sy = square ? Math.round(Math.max(0, (bmp.height - side) * 0.35)) : 0;
  const w0 = square ? side : bmp.width, h0 = square ? side : bmp.height, k = Math.min(1, maxSide / Math.max(w0, h0));
  const ext0 = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[file.type];
  if (!square && k === 1 && ext0 && file.size <= 3 * 1024 * 1024) { bmp.close && bmp.close(); return { blob: file, w: w0, h: h0, ext: ext0 }; }
  const w = Math.max(1, Math.round(w0 * k)), h = Math.max(1, Math.round(h0 * k));
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d'); cx.imageSmoothingQuality = 'high'; cx.drawImage(bmp, sx, sy, w0, h0, 0, 0, w, h); bmp.close && bmp.close();
  const enc = (type, q) => new Promise(res => cv.toBlob(res, type, q));
  let blob = await enc('image/webp', 0.86), ext = 'webp';
  if (!blob || blob.type !== 'image/webp') { blob = await enc('image/jpeg', 0.88); ext = 'jpg'; }
  return { blob, w, h, ext };
}
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer()); let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function uploadMedia(file, dir = 'media/battle', { maxSide = 4096, message, square = false, prefix = '' } = {}) {
  if (!file || !/^image\//.test(file.type || '')) fail(415, 'That file is not an image');
  if (file.size > MEDIA_MAX_BYTES) fail(413, `That image is ${(file.size / 1048576).toFixed(1)} MB; the limit is 15 MB`);
  await requireMe();
  let shrunk;
  try { shrunk = await shrinkImage(file, maxSide, { square }); } catch (_) { fail(415, 'That image could not be opened. Try a JPEG or PNG.'); }
  const { blob, w, h, ext } = shrunk;
  const path = `${dir}/${prefix ? prefix + '-' : ''}${prefix ? uid().slice(0, 10) : uid()}.${ext}`;
  const body = { message: message || `${ME.name}: upload ${path}`, content: await blobToBase64(blob), branch: GH.branch, author: { name: ME.name, email: `${ME.id}@goat-crew.local` } };
  const r = await gh(repoPath(`contents/${encPath(path)}`), { method: 'PUT', body });
  if (!r.ok) fail(r.status, await whyFailed(r, path));
  advanceHead((await r.json()).commit);
  MEDIA[path] = Promise.resolve(URL.createObjectURL(blob)); // no need to download what we just sent
  return { path, w, h };
}
new MutationObserver(() => {
  document.querySelectorAll('img[src^="media/"]:not([data-media])').forEach(img => {
    const p = img.getAttribute('src'); img.dataset.media = p; img.removeAttribute('src');
    media(p).then(u => { img.src = u; }).catch(() => { img.alt = '(image unavailable)'; });
  });
}).observe(document.documentElement, { childList: true, subtree: true });

// ---------- visibility filters (everyone here is a DM, kept for parity with the old app) ----------
/* Roles: player < dm < admin. "Staff" (dm, admin) see everything; admin also manages people. */
const ROLE_NAMES = ['player', 'dm', 'admin'];
const isStaff = u => !!u && (u.role === 'dm' || u.role === 'admin');
const isAdmin = u => !!u && u.role === 'admin';
const isDMUser = isStaff;
// Tabs a role can open (the login server has the same list and enforces it for players).
const TAB_DEFS = [
  { id: 'map', label: 'World map', player: true }, { id: 'chat', label: 'DM Chat' }, { id: 'party', label: 'Party', player: true },
  { id: 'battle', label: 'Initiative', player: true }, { id: 'battlemap', label: 'Battle map', player: true }, { id: 'dice', label: 'Dice', player: true },
  { id: 'journal', label: 'Journal', player: true }, { id: 'codex', label: 'Codex', player: true }, { id: 'quests', label: 'Quests', player: true },
  { id: 'board', label: 'Board', player: true }, { id: 'arc', label: 'Arc' }, { id: 'relations', label: 'Relationships' }, { id: 'notes', label: 'My Notes', player: true },
  { id: 'dm', label: 'Prep & tools' }
];
function defaultTabs(role) { const t = TAB_DEFS.filter(x => role !== 'player' || x.player).map(x => x.id); return role === 'admin' ? [...t, 'admin'] : t; }
function charView(c, user) { const out = { ...c }; if (!isDMUser(user) && user.characterId !== c.id) delete out.dmNotes; out.editable = isDMUser(user) || user.characterId === c.id; return out; }
function codexView(e, user) { if (isDMUser(user)) return { ...e }; if (!e.revealed) return null; const { dmContent, ...rest } = e; return rest; }
function journalView(e, user) { return isDMUser(user) || !e.dmOnly ? { ...e } : null; }
function questView(q, user) { if (isDMUser(user)) return { ...q }; if (q.dmOnly) return null; const { dmNotes, ...rest } = q; return rest; }
function noticeView(n, user) { return isDMUser(user) || !n.dmOnly ? { ...n } : null; }
function arcView(e, user) { return isDMUser(user) ? { ...e } : null; }
function encounterView(enc, user) {
  if (isDMUser(user)) return enc;
  return { round: enc.round || 1, turn: enc.turn || 0, combatants: (enc.combatants || []).map(x => ({ id: x.id, name: x.name, init: x.init, tie: x.tie, characterId: x.characterId || null, down: (Number(x.maxHp) > 0 && Number(x.hp) <= 0) || undefined })) };
}

/* Battle map tokens link to combatants by id. The Battle and DM tabs save the whole encounter from
   their own copy, which may predate the ids: carry each id over to the same-named combatant. */
function keepCombatantIds(next, cur) {
  const pool = ((cur && cur.combatants) || []).filter(c => c.id);
  const used = new Set((next.combatants || []).map(c => c.id).filter(Boolean));
  for (const c of next.combatants || []) {
    if (c.id) continue;
    const m = pool.find(x => !used.has(x.id) && x.name === c.name && (x.characterId || null) === (c.characterId || null) && (x.monster || null) === (c.monster || null));
    if (m) { c.id = m.id; used.add(m.id); }
  }
  return next;
}

/* ---------- turn order: one rule for the Battle tab, the DM tab, the battle map and the TV ----------
   encounterOrder(enc) -> indices into enc.combatants, first to act first. enc.turn stays an index into
   enc.combatants (whoever's turn it is); the one after them is order[(order.indexOf(enc.turn) + 1) % n].
   1. Initiative, highest first.
   2. The DM's order within a tie: a numeric `tie` (lower first) that the Battle tab writes on every tied
      combatant when it saves. A list already in initiative order (any encounter the DM has saved; the
      players' copy, which has no `tie`) keeps its ties where they are.
   3. Otherwise encounterTieCmp: Dex, then PCs before everyone else, then name.
   4. The array position, so the result is the same on every page, every time. */
const ENC_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
/* Natural order of two combatants on the same initiative. Dex comes from the bestiary on pages that load it
   (not the TV). A PC's Dex usually isn't recorded, so PCs go ahead of monsters; anyone else unknown goes last. */
function encounterTieCmp(a, b) {
  const dex = x => {
    const m = x && x.monster && typeof BESTIARY !== 'undefined' && Array.isArray(BESTIARY) ? BESTIARY.find(e => e.id === x.monster) : null;
    return m && Number.isFinite(Number(m.dex)) ? Number(m.dex) : x && x.characterId ? Infinity : -Infinity;
  };
  const da = dex(a), db = dex(b);
  if (da !== db) return da > db ? -1 : 1;
  return ((b && b.characterId ? 1 : 0) - (a && a.characterId ? 1 : 0)) || ENC_COLLATOR.compare(String((a && a.name) || ''), String((b && b.name) || ''));
}
function encounterOrder(enc) {
  const list = enc && Array.isArray(enc.combatants) ? enc.combatants : [];
  const init = x => Number(x && x.init) || 0;
  const tie = x => (x && x.tie !== undefined && x.tie !== null && x.tie !== '' && Number.isFinite(Number(x.tie))) ? Number(x.tie) : Infinity;
  const saved = list.every((x, i) => !i || init(list[i - 1]) >= init(x));
  return list.map((_, i) => i).sort((i, j) => {
    const a = list[i], b = list[j], ta = tie(a), tb = tie(b);
    return (init(b) - init(a)) || (ta === tb ? 0 : ta < tb ? -1 : 1) || (saved ? 0 : encounterTieCmp(a, b)) || i - j;
  });
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
  journal: { view: journalView, fields: ['session', 'title', 'content', 'tags', 'dmOnly', 'pos'] },
  codex: { view: codexView, fields: ['category', 'name', 'playerContent', 'dmContent', 'image', 'revealed'] },
  quests: { view: questView, fields: ['title', 'status', 'notes', 'dmNotes', 'dmOnly'] },
  notices: { view: noticeView, fields: ['title', 'content', 'type', 'dmOnly', 'parentId'] },
  arc: { view: arcView, fields: ['arc', 'kind', 'title', 'content', 'status', 'owner', 'order', 'session', 'codexId'] }
};
function pickAllowed(body, allowed) { const out = {}; for (const [k, v] of Object.entries(body || {})) if (allowed.includes(k) && v !== undefined) out[k] = v; return out; }

/* ---------- relationships (DM only): data/relations.json ----------
   { links: [{ id, a, b, kind, label, dir: 'both'|'ab', note, since, ended, secret, ts, by }], people: { <nodeId>: { x, y, pinned, attitude, status, where, lastSeen } } }
   A node id is 'pc:<characterId>' or 'codex:<codexId>'. relations.js owns the kinds' names and colours; this layer only checks
   what may be saved: known fields, sane lengths, both ends real, nobody linked to themselves. */
const REL_KIND_IDS = ['ally', 'friend', 'family', 'romance', 'rival', 'enemy', 'serves', 'member', 'owes', 'knows'];
const REL_ATTITUDES = ['ally', 'friendly', 'neutral', 'wary', 'hostile', 'unknown'];
const REL_STATUSES = ['alive', 'dead', 'missing', 'unknown'];
const REL_NODE_RE = /^(pc|codex):([\w-]{1,64})$/;
const REL_LINK_FIELDS = ['a', 'b', 'kind', 'label', 'dir', 'note', 'since', 'ended', 'secret'];
const REL_PERSON_FIELDS = ['x', 'y', 'pinned', 'attitude', 'status', 'where', 'lastSeen'];
const REL_MAX_LINKS = 3000;
// a hand-edited or half-written file still reads as { links: [], people: {} }
function relDoc(d) {
  const o = d && typeof d === 'object' && !Array.isArray(d) ? d : {};
  return { ...o, links: Array.isArray(o.links) ? o.links.filter(l => l && typeof l === 'object') : [], people: o.people && typeof o.people === 'object' && !Array.isArray(o.people) ? o.people : {} };
}
function relNode(id) {
  const m = REL_NODE_RE.exec(String(id || '')); if (!m) return null;
  return m[1] === 'pc' ? (RAW.characters || []).find(c => c.id === m[2]) || null : (RAW.codex || []).find(e => e.id === m[2]) || null;
}
const relName = id => { const n = relNode(id); return n ? n.name : String(id || '?'); };
const relObj = (v, what) => (v && typeof v === 'object' && !Array.isArray(v) ? v : fail(400, `${what} must be an object`));
function relText(v, max, what) {
  if (v === null) return '';
  if (typeof v !== 'string') fail(400, `${what} must be text`);
  const s = v.trim().replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
  if (s.length > max) fail(400, `${what} is too long (${max} characters at most)`);
  return s;
}
/* A new link (cur = null) or the patched copy of cur. allowId: Undo puts a deleted link back under its own id. */
function relLink(body, cur, allowId = false) {
  const src = relObj(body, 'A relationship');
  for (const k of Object.keys(src)) if (!REL_LINK_FIELDS.includes(k) && !(allowId && k === 'id')) fail(400, `Unknown field "${k}"`);
  const l = cur ? { ...cur } : { id: uid(), a: '', b: '', kind: '', label: '', dir: 'both', note: '', since: '', ended: false, secret: false };
  if (allowId && src.id !== undefined) { if (typeof src.id !== 'string' || !/^[0-9a-f]{16}$/.test(src.id)) fail(400, 'Bad relationship id'); l.id = src.id; }
  for (const k of ['a', 'b']) if (src[k] !== undefined) { if (!relNode(src[k])) fail(400, `${k === 'a' ? 'The first' : 'The second'} person isn't in the party or the Codex (any more)`); l[k] = src[k]; }
  if (src.kind !== undefined) { if (!REL_KIND_IDS.includes(src.kind)) fail(400, 'Unknown kind of relationship'); l.kind = src.kind; }
  if (src.dir !== undefined) { if (src.dir !== 'both' && src.dir !== 'ab') fail(400, 'Direction must be "both" or "ab"'); l.dir = src.dir; }
  if (src.label !== undefined) l.label = relText(src.label, 60, 'The label');
  if (src.since !== undefined) l.since = relText(src.since, 40, '"Since"');
  if (src.note !== undefined) l.note = relText(src.note, 4000, 'The note');
  for (const k of ['ended', 'secret']) if (src[k] !== undefined) { if (typeof src[k] !== 'boolean') fail(400, `"${k}" must be true or false`); l[k] = src[k]; }
  if (!l.a || !l.b) fail(400, 'A relationship needs two people');
  if (!l.kind) fail(400, 'Pick a kind of relationship');
  if (l.a === l.b) fail(400, 'Someone can\'t have a relationship with themselves');
  return l;
}
const relSame = (x, y) => x.id !== y.id && x.kind === y.kind && ((x.a === y.a && x.b === y.b) || (x.a === y.b && x.b === y.a)) && String(x.label || '').toLowerCase() === String(y.label || '').toLowerCase();
function relAddTo(doc, l) {
  if (doc.links.some(x => x.id === l.id)) fail(409, 'That relationship is already there');
  if (doc.links.some(x => relSame(x, l))) fail(409, 'They already have that relationship');
  if (doc.links.length >= REL_MAX_LINKS) fail(400, `That's the limit of ${REL_MAX_LINKS} relationships`);
  doc.links.push(l);
}
/* Person meta: null or '' clears a field. Positions are rounded to a tenth of a pixel. */
function relPerson(body, fields = REL_PERSON_FIELDS) {
  const src = relObj(body, 'Person details'), out = {};
  for (const [k, v] of Object.entries(src)) {
    if (!fields.includes(k)) fail(400, `Unknown field "${k}"`);
    if (v === null || v === '') { out[k] = null; continue; }
    if (k === 'x' || k === 'y') { if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > 1e6) fail(400, 'Bad position'); out[k] = Math.round(v * 10) / 10; }
    else if (k === 'pinned') { if (typeof v !== 'boolean') fail(400, '"pinned" must be true or false'); out[k] = v || null; }
    else if (k === 'attitude') { if (!REL_ATTITUDES.includes(v)) fail(400, 'Unknown attitude'); out[k] = v; }
    else if (k === 'status') { if (!REL_STATUSES.includes(v)) fail(400, 'Unknown status'); out[k] = v; }
    else if (k === 'where') out[k] = relText(v, 80, 'The location') || null;
    else out[k] = relText(v, 40, '"Last seen"') || null;
  }
  return out;
}
function relSetPerson(people, id, patch) {
  const p = { ...(people[id] || {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete p[k]; else p[k] = v; }
  if (Object.keys(p).length) people[id] = p; else delete people[id];
}
const relLine = l => `${relName(l.a)} — ${l.kind}${l.label ? ` (${l.label})` : ''} — ${relName(l.b)}`;

async function relationsRoute(sub, method, body, user) {
  const who = user.name;
  const stamp = l => ({ ...l, ts: new Date().toISOString(), by: who });
  let m;
  if (sub === '' && method === 'GET') return structuredClone(relDoc(RAW.relations));
  // add one relationship (with an id from Undo, it comes back as it was)
  if (sub === '/links' && method === 'POST') {
    const l = stamp(relLink(body, null, true));
    await save('relations', d => { d = relDoc(d); relAddTo(d, l); return d; }, `${who}: relationship — ${relLine(l)}`);
    logHistory(user, 'relations', l.id, '(created)', '', relLine(l));
    return structuredClone(l);
  }
  if ((m = sub.match(/^\/links\/([\w-]{1,40})$/))) {
    const id = m[1], cur = relDoc(RAW.relations).links.find(x => x.id === id);
    if (!cur) fail(404, 'That relationship was deleted on another screen');
    if (method === 'PATCH') {
      relLink(body, cur); // checks before anything is sent
      let out = null;
      await save('relations', d => {
        d = relDoc(d);
        const i = d.links.findIndex(x => x.id === id); if (i < 0) fail(404, 'That relationship was deleted on another screen');
        const next = relLink(body, d.links[i]);
        if (d.links.some(x => relSame(x, next))) fail(409, 'They already have that relationship');
        d.links[i] = out = { ...next, ts: new Date().toISOString(), by: who };
        return d;
      }, `${who}: relationship — ${relLine(relLink(body, cur))}`);
      return structuredClone(out);
    }
    if (method === 'DELETE') {
      await save('relations', d => { d = relDoc(d); d.links = d.links.filter(x => x.id !== id); return d; }, `${who}: remove relationship — ${relLine(cur)}`);
      logHistory(user, 'relations', id, '(deleted)', relLine(cur), '');
      return { ok: true, link: structuredClone(cur) };
    }
  }
  // one person's details: attitude, status, last known location, last seen, position (node ids carry a colon)
  if ((m = sub.match(/^\/people\/([^/]+)$/)) && method === 'PATCH') {
    const id = decodeURIComponent(m[1]);
    if (!relNode(id)) fail(404, 'That person no longer exists');
    const patch = relPerson(body);
    if (!Object.keys(patch).length) return { id, ...(relDoc(RAW.relations).people[id] || {}) };
    await save('relations', d => { d = relDoc(d); relSetPerson(d.people, id, patch); return d; }, `${who}: ${relName(id)} — ${Object.keys(patch).join(', ')}`);
    return { id, ...(relDoc(RAW.relations).people[id] || {}) };
  }
  // where people sit on the web: a burst of drags, one commit. Someone deleted meanwhile is skipped.
  if (sub === '/layout' && method === 'PUT') {
    const pos = relObj(relObj(body, 'The layout').positions, 'positions'), ids = Object.keys(pos).filter(id => relNode(id)).slice(0, 1000);
    const patches = ids.map(id => [id, relPerson(pos[id], ['x', 'y', 'pinned'])]);
    if (patches.length) await save('relations', d => { d = relDoc(d); for (const [id, p] of patches) relSetPerson(d.people, id, p); return d; }, `${who}: relationship web layout (${patches.length})`);
    return { ok: true, saved: patches.length };
  }
  // several changes in one commit: { people: { id: patch }, add: [link], del: [linkId] } (quick add, clean-up)
  if (sub === '/apply' && method === 'POST') {
    const src = relObj(body, 'The change');
    for (const k of Object.keys(src)) if (!['people', 'add', 'del'].includes(k)) fail(400, `Unknown field "${k}"`);
    const people = Object.entries(src.people ? relObj(src.people, 'people') : {}).map(([id, p]) => { if (!relNode(id)) fail(404, 'That person no longer exists'); return [id, relPerson(p)]; });
    const add = (src.add === undefined ? [] : Array.isArray(src.add) ? src.add : fail(400, '"add" must be a list')).slice(0, 50).map(x => stamp(relLink(x, null, true)));
    const del = new Set(src.del === undefined ? [] : Array.isArray(src.del) ? src.del.filter(x => typeof x === 'string') : fail(400, '"del" must be a list'));
    const removed = relDoc(RAW.relations).links.filter(x => del.has(x.id));
    if (!people.length && !add.length && !del.size) return { ok: true, added: [], removed: [] };
    const what = [add.length && `${add.length} new`, removed.length && `${removed.length} removed`, people.length && people.map(([id]) => relName(id)).join(', ')].filter(Boolean).join(' · ');
    await save('relations', d => {
      d = relDoc(d);
      for (const [id, p] of people) relSetPerson(d.people, id, p);
      d.links = d.links.filter(x => !del.has(x.id));
      for (const l of add) relAddTo(d, l);
      return d;
    }, `${who}: relationships — ${what}`);
    for (const l of add) logHistory(user, 'relations', l.id, '(created)', '', relLine(l));
    for (const l of removed) logHistory(user, 'relations', l.id, '(deleted)', relLine(l), '');
    return { ok: true, added: structuredClone(add), removed: structuredClone(removed) };
  }
  fail(404, 'Unknown endpoint /api/relations' + sub);
}

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
/* Who is signed in. With the login server, role and tabs come from the server (it enforces them);
   with a GitHub token in the browser there is no enforcement, so the token holder's users.json role applies. */
async function requireMe() {
  if (ME) return ME;
  if (workerMode() ? !WSESSION : !TOKEN) fail(401, 'Not logged in');
  const id = localStorage.getItem('gc_session');
  if (!id) fail(401, 'Not logged in');
  const server = workerMode() ? await workerCall('/me') : null;
  if (server && server.user !== id) { localStorage.setItem('gc_session', server.user); }
  const users = RAW.users || await readFile('users');
  const u = users.find(x => x.id === (server ? server.user : id));
  if (!u) { localStorage.removeItem('gc_session'); fail(401, 'Not logged in'); }
  const role = server ? server.role : (ROLE_NAMES.includes(u.role) ? u.role : 'player');
  ME = { ...u, role, characterId: server ? server.characterId : u.characterId, tabs: server ? server.tabs : defaultTabs(role) };
  return ME;
}

/* /api/admin/*: people, roles, access, sign-in links. With the login server everything is done (and
   enforced) there. With only a GitHub token, an admin can still edit names, roles and characters in
   users.json, but passwords, links and access limits need the server. */
async function adminRoute(path, method, body, user) {
  if (!isAdmin(user)) fail(403, 'Admins only');
  if (workerMode()) return workerCall('/admin' + path, { method, body: ['POST', 'PATCH', 'PUT'].includes(method) ? (body || {}) : undefined });
  await loadAll();
  const who = user.name;
  if (path === '/users' && method === 'GET') return {
    tokenMode: true, roles: ROLE_NAMES, breakGlass: false,
    tabs: TAB_DEFS.map(t => ({ id: t.id, label: t.label, player: !!t.player })),
    characters: (RAW.characters || []).map(c => ({ id: c.id, name: c.name })),
    users: (RAW.users || []).map(u => { const role = ROLE_NAMES.includes(u.role) ? u.role : 'player'; return { id: u.id, name: u.name, role, characterId: u.characterId || null, email: '', status: 'token', lastLogin: null, inviteExp: null, access: null, tabs: defaultTabs(role), bootstrap: false }; })
  };
  const admins = () => (RAW.users || []).filter(u => u.role === 'admin');
  if (path === '/users' && method === 'POST') {
    const name = String(body.name || '').trim().slice(0, 60); if (!name) fail(400, 'Give them a name');
    const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'user';
    let id = base, n = 2; while ((RAW.users || []).some(u => u.id === id)) id = base + n++;
    await save('users', arr => [...arr, { id, name, role: ROLE_NAMES.includes(body.role) ? body.role : 'player', characterId: body.characterId || null }], `${who}: add ${name}`);
    return { ok: true, id };
  }
  const m = path.match(/^\/users\/([\w-]+)(?:\/(invite|reset|signout))?$/);
  if (!m) fail(404, 'Unknown endpoint');
  if (m[2]) fail(400, 'Sign-in links, resets and sign-outs need the login server. See the note at the top of this page.');
  const target = (RAW.users || []).find(u => u.id === m[1]); if (!target) fail(404, 'No such person');
  if (method === 'PATCH') {
    if (body.role !== undefined && target.id === user.id && body.role !== 'admin') fail(400, 'You can\'t remove your own admin role');
    if (body.role !== undefined && target.role === 'admin' && body.role !== 'admin' && admins().length <= 1) fail(400, 'There must be at least one admin');
    const upd = {}; for (const k of ['name', 'role', 'characterId']) if (body[k] !== undefined) upd[k] = k === 'characterId' ? (body[k] || null) : body[k];
    if (Object.keys(upd).length) await save('users', arr => { Object.assign(arr.find(x => x.id === target.id) || {}, upd); return arr; }, `${who}: ${target.name} — ${Object.keys(upd).join(', ')}`);
    return { ok: true };
  }
  if (method === 'DELETE') {
    if (target.id === user.id) fail(400, 'You can\'t delete yourself');
    await save('users', arr => arr.filter(x => x.id !== target.id), `${who}: remove ${target.name}`);
    return { ok: true };
  }
  fail(404, 'Unknown endpoint');
}

// ---------- api() — same signature app.js already uses ----------
async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  if (opts.quiet) QUIET++;
  try { return await route(path, method, opts.body); }
  catch (e) { if (!e.code) { console.error(e); if (typeof toast === 'function' && !opts.quiet) toast(e.message || 'Error', 3500); } throw e; }
  finally { if (opts.quiet) QUIET--; }
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
  if (path === '/api/worker' && method === 'POST') {
    WORKER = String(body.url || '').trim().replace(/\/+$/, '');
    if (WORKER) localStorage.setItem('gc_worker', WORKER); else localStorage.removeItem('gc_worker');
    WSESSION = ''; localStorage.removeItem('gc_wsession'); localStorage.removeItem('gc_session'); ME = null; loaded = null;
    return { ok: true, mode: workerMode() ? 'worker' : 'direct' };
  }
  if (path === '/api/users/list') {
    if (workerMode() && !WSESSION) return workerCall('/users'); // names only, no session needed
    const users = RAW.users || await readFile('users');
    return [...users].sort((a, b) => (isStaff(a) ? 0 : 1) - (isStaff(b) ? 0 : 1) || (a.order ?? 0) - (b.order ?? 0)).map(u => ({ id: u.id, name: u.name, role: u.role }));
  }
  // --- sign-in links and passwords (login server only) ---
  if (path === '/api/invite/check' && method === 'POST') { if (!workerMode()) fail(400, 'Sign-in links need the login server'); return workerCall('/invite/check', { method: 'POST', body: { token: body.token } }); }
  if (path === '/api/invite/accept' && method === 'POST') {
    if (!workerMode()) fail(400, 'Sign-in links need the login server');
    const res = await workerCall('/invite/accept', { method: 'POST', body: { token: body.token, password: body.password } });
    WSESSION = res.token; localStorage.setItem('gc_wsession', WSESSION); localStorage.setItem('gc_wassistant', res.assistant ? '1' : '');
    localStorage.setItem('gc_session', res.user); localStorage.setItem('gc_user', res.user); ME = null; loaded = null;
    return { ok: true, user: res.user };
  }
  if (path === '/api/me/password' && method === 'POST') { if (!workerMode()) fail(400, 'Passwords need the login server'); return workerCall('/me/password', { method: 'POST', body }); }
  if (path === '/api/login' && method === 'POST') {
    if (workerMode()) {
      const res = await workerCall('/login', { method: 'POST', body: { user: body.userId, passcode: body.passcode } });
      WSESSION = res.token; localStorage.setItem('gc_wsession', WSESSION); localStorage.setItem('gc_wassistant', res.assistant ? '1' : '');
      loaded = null;
    } else {
      if (body.token && String(body.token).trim()) { TOKEN = String(body.token).trim(); localStorage.setItem('gc_gh_token', TOKEN); loaded = null; }
      if (!TOKEN) fail(401, 'Paste your GitHub token first');
    }
    const users = await readFile('users');
    const u = users.find(x => x.id === body.userId);
    if (!u) fail(401, 'Pick who you are');
    localStorage.setItem('gc_session', u.id); ME = null; // requireMe() fills in role and tabs (from the login server when there is one)
    await requireMe();
    return { ok: true };
  }
  if (path === '/api/logout' && method === 'POST') { localStorage.removeItem('gc_session'); if (workerMode()) { WSESSION = ''; localStorage.removeItem('gc_wsession'); } ME = null; return { ok: true }; }
  if (path === '/api/me') { const u = await requireMe(); return { id: u.id, name: u.name, role: u.role, characterId: u.characterId, tabs: u.tabs }; }
  if (path === '/api/setup') return { owner: GH.owner, repo: GH.repo, branch: GH.branch, hasToken: !!TOKEN, mode: workerMode() ? 'worker' : 'direct', worker: WORKER, workerFromConfig: !!CFG.worker && !localStorage.getItem('gc_worker'), hasSession: !!WSESSION, assistantOnServer: localStorage.getItem('gc_wassistant') === '1' };

  const user = await requireMe();
  const isDM = isStaff(user);
  if (path.startsWith('/api/admin/')) return adminRoute(path.slice('/api/admin'.length), method, body, user);
  await loadAll();
  const who = user.name;

  // --- characters ---
  if (path === '/api/characters' && method === 'GET') return RAW.characters.map(c => charView(c, user));
  if ((m = path.match(/^\/api\/characters\/([\w]+)$/)) && method === 'PATCH') {
    const c = RAW.characters.find(x => x.id === m[1]);
    if (!c) fail(404, 'Not found');
    if (!isDM && user.characterId !== c.id) fail(403, 'You can only change your own character');
    if (!isDM && body) delete body.dmNotes;
    const applied = {};
    for (const [k, v] of Object.entries(pickAllowed(body, CHAR_FIELDS))) if (JSON.stringify(c[k]) !== JSON.stringify(v)) { logHistory(user, 'character', c.id, k, c[k], v); applied[k] = v; }
    if (Object.keys(applied).length) await save('characters', arr => { Object.assign(arr.find(x => x.id === c.id), applied); return arr; }, `${who}: ${c.name} — ${Object.keys(applied).join(', ')}`);
    return charView(RAW.characters.find(x => x.id === c.id), user);
  }
  if ((m = path.match(/^\/api\/characters\/([\w-]+)\/sheet$/))) {
    const c = RAW.characters.find(x => x.id === m[1]);
    if (!c || !SHEET_ID_RE.test(c.id)) fail(404, 'Not found');
    const editable = isDM || user.characterId === c.id;
    if (method === 'GET') { if (SHEETS[c.id] === undefined || body === 'fresh') await readSheet(c.id); return { sheet: structuredClone(SHEETS[c.id]), editable }; }
    if (method === 'POST') {
      if (!editable) fail(403, 'You can only change your own character sheet');
      const ops = Array.isArray(body && body.ops) ? body.ops.slice(0, 500) : [];
      if (!ops.length) return { sheet: structuredClone(SHEETS[c.id] || {}), editable };
      const next = await saveSheet(c.id, s => applySheetOps(s, ops), `${who}: ${c.name} — sheet (${ops.length} change${ops.length === 1 ? '' : 's'})`);
      return { sheet: structuredClone(next), editable };
    }
  }
  if ((m = path.match(/^\/api\/characters\/([\w]+)\/history$/)) && method === 'GET') {
    return [...RAW.history, ...pendingHistory].filter(h => h.entity === 'character' && h.entityId === m[1]).sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 50);
  }

  // --- journal custom order: all positions in one commit ---
  if (path === '/api/journal/reorder' && method === 'PUT') {
    const orders = (body && body.orders) || {};
    await save('journal', arr => { for (const e of arr) if (Number.isFinite(orders[e.id])) e.pos = orders[e.id]; return arr; }, `${who}: reorder journal`);
    return { ok: true };
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
  if (path === '/api/encounter' && method === 'PUT') { await save('encounter', cur => keepCombatantIds(structuredClone(body), cur), `${who}: encounter round ${body.round || 1}`); return { ok: true }; }

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

  // --- relationships: the DMs' web of who is tied to whom (the login server never lets a player read or write the file) ---
  if (path === '/api/relations' || path.startsWith('/api/relations/')) {
    if (!isDM) fail(403, 'Only the DMs can see that.');
    return relationsRoute(path.slice('/api/relations'.length), method, body, user);
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
  if (path === '/api/battle' && method === 'GET') return RAW.battle || defaults('battle');
  if (path === '/api/history' && method === 'GET') return [...RAW.history, ...pendingHistory].sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 100);

  fail(404, 'Unknown endpoint ' + path);
}
