/* battlemap.js — the Battle map tab (DM): an Owlbear-style encounter map. battle-scene.js draws it;
   this file owns the floating UI, the tools, saving and the link to the player display.
   Data: data/battle.json, changed only through small id-keyed mutations (a token's x/y, one fog
   shape, one drawing) so both DMs can edit at once; turns and HP live in encounter.json, shared with
   the Battle tab. The player display (display.html) listens on BroadcastChannel('gc-battle'). */
'use strict';

Object.assign(ICONS, {
  pointer: '<path d="M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" />',
  hand: '<path d="M18 11V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2" /><path d="M14 10V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v2" /><path d="M10 10.5V6a2 2 0 0 0-2-2a2 2 0 0 0-2 2v8" /><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15" />',
  measure: '<path d="M2 8.5A1.5 1.5 0 0 1 3.5 7h17A1.5 1.5 0 0 1 22 8.5v7a1.5 1.5 0 0 1-1.5 1.5h-17A1.5 1.5 0 0 1 2 15.5z" /><path d="M6 7v4" /><path d="M10 7v2.5" /><path d="M14 7v4" /><path d="M18 7v2.5" />',
  brush: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08" /><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z" />',
  aoe: '<path d="M3 12 20 4.5v15z" /><circle cx="3" cy="12" r="1" />',
  fog: '<path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242" /><path d="M16 17H7" /><path d="M17 21H9" />',
  ping: '<path d="M18 8c0 3.613-3.869 7.429-5.393 8.795a1 1 0 0 1-1.214 0C9.87 15.429 6 11.613 6 8a6 6 0 0 1 12 0" /><circle cx="12" cy="8" r="2" /><path d="M8.714 14h-3.71a1 1 0 0 0-.948.683l-2.004 6A1 1 0 0 0 3 22h18a1 1 0 0 0 .948-1.316l-2-6a1 1 0 0 0-.949-.684h-3.712" />',
  tag: '<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z" /><circle cx="7.5" cy="7.5" r="1.5" />',
  apps: '<rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />',
  minimize: '<path d="M8 3v3a2 2 0 0 1-2 2H3" /><path d="M21 8h-3a2 2 0 0 1-2-2V3" /><path d="M3 16h3a2 2 0 0 1 2 2v3" /><path d="M16 21v-3a2 2 0 0 1 2-2h3" />',
  eraser: '<path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" /><path d="M22 21H7" /><path d="m5 11 9 9" />',
  undo: '<path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />',
  redo: '<path d="m15 14 5-5-5-5" /><path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />',
  grid: '<rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M9 3v18" /><path d="M15 3v18" />',
  cast: '<path d="M2 8V6a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6" /><path d="M2 12a9 9 0 0 1 8 8" /><path d="M2 16a5 5 0 0 1 4 4" /><line x1="2" x2="2.01" y1="20" y2="20" />',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" x2="12" y1="3" y2="15" />',
  image: '<rect width="18" height="18" x="3" y="3" rx="2" ry="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />',
  scan: '<path d="M3 7V5a2 2 0 0 1 2-2h2" /><path d="M17 3h2a2 2 0 0 1 2 2v2" /><path d="M21 17v2a2 2 0 0 1-2 2h-2" /><path d="M7 21H5a2 2 0 0 1-2-2v-2" />',
  minus: '<path d="M5 12h14" />',
  squiggle: '<path d="M3 16c2.5-5 4.5-8 6.5-6.5S11 15 13.5 13s3-7 7.5-6" />',
  segment: '<path d="M6.5 17.5 17.5 6.5" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="5" r="2" />',
  rect: '<rect x="3.5" y="6" width="17" height="12" rx="1.5" />',
  circle: '<circle cx="12" cy="12" r="8.5" />',
  cone: '<path d="M3 12 20 4.5v15z" />',
  beam: '<path d="M3.5 15.5 18 7l2.5 4.3L6 19.8z" />',
  cube: '<path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z" /><path d="m3.3 7 8.7 5 8.7-5" /><path d="M12 22V12" />',
  polygon: '<path d="M12 3 21 9.5 17.5 20h-11L3 9.5z" />',
  sqdash: '<path d="M5 3a2 2 0 0 0-2 2" /><path d="M19 3a2 2 0 0 1 2 2" /><path d="M21 19a2 2 0 0 1-2 2" /><path d="M5 21a2 2 0 0 1-2-2" /><path d="M9 3h1" /><path d="M9 21h1" /><path d="M14 3h1" /><path d="M14 21h1" /><path d="M3 9v1" /><path d="M21 9v1" /><path d="M3 14v1" /><path d="M21 14v1" />',
  sun: '<circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.93 4.93 1.41 1.41" /><path d="m17.66 17.66 1.41 1.41" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m6.34 17.66-1.41 1.41" /><path d="m19.07 4.93-1.41 1.41" />',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />',
  userplus: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" x2="19" y1="8" y2="14" /><line x1="22" x2="16" y1="11" y2="11" />',
  chevup: '<path d="m18 15-6-6-6 6" />',
  chevdown: '<path d="m6 9 6 6 6-6" />',
  skipfwd: '<polygon points="5 4 15 12 5 20 5 4" /><line x1="19" x2="19" y1="5" y2="19" />',
  lock: '<rect width="18" height="11" x="3" y="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />',
  video: '<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5" /><rect x="2" y="6" width="14" height="12" rx="2" />',
  heart: '<path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />'
});

// g = the rail group: select/pan | measure/draw/template | fog | ping/eraser (then undo/redo, add token, grid)
const BM_TOOLS = [
  { id: 'select', key: 'v', icon: 'pointer', name: 'Select & move', g: 0, tip: 'Drag tokens · Shift-drag to box-select · Alt places freely' },
  { id: 'pan', key: 'h', icon: 'hand', name: 'Pan', g: 0, tip: 'Or hold Space, or drag with the middle button' },
  { id: 'ruler', key: 'r', icon: 'measure', name: 'Measure', g: 1, tip: 'Drag to measure in 5-foot squares' },
  { id: 'draw', key: 'd', icon: 'brush', name: 'Draw', g: 1 },
  { id: 'template', key: 't', icon: 'aoe', name: 'Spell templates', g: 1 },
  { id: 'fog', key: 'f', icon: 'fog', name: 'Fog of war', g: 2 },
  { id: 'ping', key: 'p', icon: 'ping', name: 'Ping', g: 3, tip: 'Or Alt-click with any tool' },
  { id: 'eraser', key: 'e', icon: 'eraser', name: 'Eraser', g: 3, tip: 'Click or drag across drawings and templates' }
];
const BM_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const BM_MOD = BM_MAC ? '⌘' : 'Ctrl ';
const BM_COLORS = ['#f8fafc', '#f2c15e', '#ef4444', '#22c55e', '#38bdf8', '#a78bfa', '#111827'];
const BM_TPL_COLORS = [['#f97316', 'Fire'], ['#38bdf8', 'Frost'], ['#84cc16', 'Acid'], ['#a78bfa', 'Arcane'], ['#facc15', 'Radiant'], ['#94a3b8', 'Force']];
const BM_WIDTHS = { thin: 0.035, med: 0.07, thick: 0.14 }; // fraction of a grid square
// the map runs under every panel; these keep what matters out from under them (strip, rail, bottom bar)
const BM_PAD = { t: 80, r: 76, b: 84, l: 24 };

const BM_PREFS = (() => { try { return JSON.parse(localStorage.getItem('gc_bm_prefs') || '{}') || {}; } catch (_) { return {}; } })();
const bmPref = (k, d) => (BM_PREFS[k] === undefined ? d : BM_PREFS[k]);
function bmSetPref(k, v) { BM_PREFS[k] = v; try { localStorage.setItem('gc_bm_prefs', JSON.stringify(BM_PREFS)); } catch (_) { /* private mode */ } }

const BM = {
  root: null, stage: null, view: null, doc: null, enc: null, sceneId: null,
  pending: [], saving: false, flushT: 0, firstPending: 0, undo: [], redo: [], hpPend: {}, hpT: 0,
  tool: bmPref('tool', 'select'), prevTool: 'select', act: null, down: null, pointers: new Map(), pinch: null,
  space: false, zoomAnim: null, camAnim: null, fogPoly: null, pop: null, displaySeen: 0, gridBefore: null, gridT: 0,
  cams: {} // this page session's camera per scene: coming back to the tab keeps the view; a fresh load fits the action
};
const bmMounted = () => !!(BM.root && BM.root.isConnected);
const bmClone = o => (o == null ? o : structuredClone(o));

// ---------- data: battle.json through small, id-keyed mutations ----------
function bmNorm(b) {
  b = b && typeof b === 'object' && !Array.isArray(b) ? b : {};
  if (!Array.isArray(b.scenes)) b.scenes = [];
  b.display = Object.assign({ sceneId: null, follow: 'dm', camera: null, showInit: true }, b.display || {});
  for (const s of b.scenes) {
    if (!Array.isArray(s.tokens)) s.tokens = [];
    if (!Array.isArray(s.drawings)) s.drawings = [];
    if (!s.fog || typeof s.fog !== 'object') s.fog = { on: false, reveals: [] };
    if (!Array.isArray(s.fog.reveals)) s.fog.reveals = [];
    s.grid = Object.assign({ size: 70, offsetX: 0, offsetY: 0, show: true, opacity: 0.5 }, s.grid || {});
  }
  return b;
}
function bmScene(id = BM.sceneId, doc = BM.doc) { return doc ? doc.scenes.find(s => s.id === id) || null : null; }
function bmTok(id) { const sc = bmScene(); return sc ? sc.tokens.find(t => t.id === id) : null; }
function bmDrawing(id) { const sc = bmScene(); return sc ? sc.drawings.find(d => d.id === id) : null; }
function bmArrSet(arr, id, val, patch, index) {
  const i = arr.findIndex(x => x.id === id);
  if (val == null) { if (i >= 0 && !patch) arr.splice(i, 1); return; }
  if (i >= 0) { if (patch) Object.assign(arr[i], bmClone(val)); else arr[i] = bmClone(val); }
  else if (!patch) arr.splice(index == null ? arr.length : Math.min(index, arr.length), 0, bmClone(val));
}
/* One change = { coll, id, before, after, patch, index }. coll: tokens | drawings | reveals | prop
   (a scene field: 'name', 'grid', 'fog', 'fog.on') | scenes | display. patch = merge fields only. */
function bmSet(doc, sid, ch, val) {
  if (ch.coll === 'display') { doc.display[ch.id] = bmClone(val); return; }
  if (ch.coll === 'scenes') { bmArrSet(doc.scenes, ch.id, val, ch.patch, ch.index); if (val) bmNorm(doc); return; }
  const sc = doc.scenes.find(s => s.id === sid); if (!sc) return;
  if (ch.coll === 'prop') { const keys = ch.id.split('.'), last = keys.pop(); let o = sc; for (const k of keys) o = o[k] || (o[k] = {}); o[last] = bmClone(val); return; }
  bmArrSet(ch.coll === 'reveals' ? sc.fog.reveals : sc[ch.coll], ch.id, val, ch.patch, ch.index);
}
function bmCommit(label, changes, opt = {}) {
  if (!changes.length) return;
  const sid = opt.sid || BM.sceneId;
  bmQueue(doc => { for (const ch of changes) bmSet(doc, sid, ch, ch.after); }, label);
  if (opt.undo !== false) { BM.undo.push({ label, sid, changes }); if (BM.undo.length > 120) BM.undo.shift(); BM.redo = []; }
  bmChanged();
}
function bmUndoRedo(redo) {
  const e = (redo ? BM.redo : BM.undo).pop();
  if (!e) { toast(redo ? 'Nothing to redo' : 'Nothing to undo', 1200); return; }
  const list = redo ? e.changes : [...e.changes].reverse();
  bmQueue(doc => { for (const ch of list) bmSet(doc, e.sid, ch, redo ? ch.after : ch.before); }, (redo ? 'Redo ' : 'Undo ') + e.label);
  (redo ? BM.undo : BM.redo).push(e);
  if (e.sid !== BM.sceneId && bmScene(e.sid)) bmSelectScene(e.sid);
  bmChanged();
  bmFlash(`${redo ? 'Redo' : 'Undo'}: ${e.label}`);
}
function bmQueue(op, label) {
  BM.pending.push({ op, label });
  op(BM.doc);
  if (!BM.firstPending) BM.firstPending = Date.now();
  clearTimeout(BM.flushT);
  BM.flushT = setTimeout(bmFlush, Date.now() - BM.firstPending > 2500 ? 0 : 450);
  bmSaveState('pending');
  bmPostDoc();
}
async function bmFlush() {
  clearTimeout(BM.flushT);
  if (BM.saving || !BM.pending.length) return;
  const batch = BM.pending.slice(), labels = [...new Set(batch.map(b => b.label))];
  BM.saving = true; bmSaveState('saving');
  try {
    await save('battle', b => { b = bmNorm(b); for (const p of batch) p.op(b); return b; },
      `${(S.me && S.me.name) || 'DM'}: battle map — ${labels.slice(0, 3).join(', ')}${labels.length > 3 ? ` (+${labels.length - 3})` : ''}`);
    BM.pending.splice(0, batch.length);
    BM.firstPending = BM.pending.length ? Date.now() : 0;
    bmSaveState(BM.pending.length ? 'pending' : 'saved');
  } catch (e) {
    console.warn('battle save', e); bmSaveState('error');
    BM.flushT = setTimeout(bmFlush, 6000);
  } finally {
    BM.saving = false;
    bmRebase();
    if (BM.pending.length && !BM.flushT) BM.flushT = setTimeout(bmFlush, 300);
  }
}
// the latest committed copy + whatever this DM has not saved yet
function bmRebase() {
  const d = bmNorm(bmClone(RAW.battle || defaults('battle')));
  for (const p of BM.pending) p.op(d);
  BM.doc = d;
  if (bmMounted()) bmChanged(true);
}
function bmSaveState(s) {
  const el = BM.root && BM.root.querySelector('#bm-save'); if (!el) return;
  el.dataset.state = s;
  el.title = { pending: 'Unsaved changes', saving: 'Saving…', saved: 'All changes saved', error: 'Could not save — retrying' }[s] || '';
}

// ---------- encounter (shared with the Battle tab) ----------
function bmEncView() {
  const e = bmClone(RAW.encounter || defaults('encounter'));
  e.combatants = e.combatants || [];
  for (const c of e.combatants) if (c.id && BM.hpPend[c.id]) c.hp = Math.max(0, (Number(c.hp) || 0) + BM.hpPend[c.id]);
  return e;
}
async function bmEnsureIds() {
  const enc = RAW.encounter || defaults('encounter');
  if ((enc.combatants || []).every(c => c.id)) return enc;
  await save('encounter', e => { for (const c of e.combatants || []) if (!c.id) c.id = uid(); return e; }, `${S.me.name}: link the encounter to the battle map`);
  bmEncChanged();
  return RAW.encounter;
}
function bmHp(cid, d) {
  if (!cid) return;
  BM.hpPend[cid] = (BM.hpPend[cid] || 0) + d;
  bmEncChanged();
  clearTimeout(BM.hpT); BM.hpT = setTimeout(bmFlushHp, 650);
}
async function bmFlushHp() {
  const p = BM.hpPend; if (!Object.keys(p).length) return;
  try {
    await save('encounter', e => { for (const c of e.combatants || []) if (c.id && p[c.id]) c.hp = Math.max(0, (Number(c.hp) || 0) + p[c.id]); return e; }, `${S.me.name}: HP from the battle map`);
    for (const k of Object.keys(p)) delete BM.hpPend[k];
  } catch (e) { console.warn(e); BM.hpT = setTimeout(bmFlushHp, 5000); }
  bmEncChanged();
}
async function bmSetHp(cid, v) {
  delete BM.hpPend[cid];
  await save('encounter', e => { const c = (e.combatants || []).find(x => x.id === cid); if (c) c.hp = Math.max(0, Math.round(v)); return e; }, `${S.me.name}: HP from the battle map`);
  bmEncChanged();
}
// exactly what the Battle tab's ▶ Next turn / ◀ do, on the latest copy
async function bmTurn(dir) {
  const len = ((RAW.encounter || {}).combatants || []).length;
  if (!len) { toast('No encounter yet: add combatants on the DM tab'); return; }
  await save('encounter', e => {
    const n = (e.combatants || []).length; if (!n) return e;
    if (dir > 0) { e.turn = ((e.turn || 0) + 1) % n; if (e.turn === 0) e.round = (e.round || 1) + 1; }
    else e.turn = ((e.turn || 0) - 1 + n) % n;
    return e;
  }, `${S.me.name}: encounter round ${(RAW.encounter && RAW.encounter.round) || 1}`);
  bmEncChanged();
  const enc = BM.enc, cur = enc && enc.combatants[enc.turn || 0];
  const tok = cur && bmScene() && bmScene().tokens.find(t => t.combatantId === cur.id);
  if (tok && BM.view && dir > 0) {
    const [X, Y] = BM.view.toScreen(tok.x, tok.y);
    if (X < BM_PAD.l || Y < BM_PAD.t || X > BM.view.W - BM_PAD.r || Y > BM.view.H - BM_PAD.b) bmCenterOn(tok.x, tok.y);
  }
}
function bmEncChanged() {
  BM.enc = bmEncView();
  bmPostEnc();
  if (!bmMounted()) return;
  BM.view.setEncounter(BM.enc);
  bmRenderInit(); bmRenderTray(); bmRenderInspector(); bmSyncSafe();
}

// ---------- the player display: BroadcastChannel + window placement ----------
const BM_BC = (typeof BroadcastChannel === 'function') ? new BroadcastChannel('gc-battle') : null;
function bmPost(msg) { if (BM_BC && typeof S !== 'undefined' && S.me) { try { BM_BC.postMessage(msg); } catch (e) { console.warn('bc', e); } } }
let bmDocRaf = 0, bmLiveRaf = 0, bmCamRaf = 0;
function bmCurDoc() { return BM.doc || bmNorm(bmClone(RAW.battle || defaults('battle'))); }
function bmPostDoc() { if (!bmDocRaf) bmDocRaf = requestAnimationFrame(() => { bmDocRaf = 0; bmPost({ t: 'doc', battle: bmCurDoc() }); }); }
function bmPostEnc() { bmPost({ t: 'enc', enc: BM.enc || bmEncView() }); }
function bmPostLive() {
  if (bmLiveRaf) return;
  bmLiveRaf = requestAnimationFrame(() => {
    bmLiveRaf = 0; const v = BM.view; if (!v) return;
    const L = v.live;
    bmPost({ t: 'live', sceneId: BM.sceneId, ruler: L.ruler, previews: (L.previews || []).filter(p => !p.dmOnly),
      drag: L.drag ? { lead: L.drag.lead, pos: [...L.drag.pos], from: [...L.drag.from], snap: L.drag.snap ? [...L.drag.snap] : null } : null });
  });
}
function bmPostCam() {
  if (bmCamRaf) return;
  bmCamRaf = requestAnimationFrame(() => { bmCamRaf = 0; if (BM.view && BM.sceneId) bmPost({ t: 'cam', sceneId: BM.sceneId, rect: bmVisibleRect() }); });
}
// the part of the map the DM actually sees (not under the floating panels)
function bmVisibleRect() {
  const v = BM.view, [x0, y0] = v.toScene(BM_PAD.l, BM_PAD.t), [x1, y1] = v.toScene(v.W - BM_PAD.r, v.H - BM_PAD.b);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
if (BM_BC) BM_BC.onmessage = ev => {
  const m = ev.data || {};
  if (m.t === 'hello') { bmPost({ t: 'doc', battle: bmCurDoc() }); bmPostEnc(); if (bmMounted()) bmPostCam(); }
  if (m.t === 'display-hb') { BM.displaySeen = Date.now(); bmRenderCastDot(); }
};
setInterval(() => { bmPost({ t: 'hb', visible: !document.hidden }); bmRenderCastDot(); }, 2000);
async function bmOpenDisplay() {
  const d = bmCurDoc();
  if (BM.sceneId && !bmScene(d.display.sceneId, d)) bmCommit('Show scene on display', [{ coll: 'display', id: 'sceneId', before: d.display.sceneId, after: BM.sceneId }], { undo: false });
  const url = new URL('display.html', location.href).href;
  let feat = 'popup,width=1280,height=760';
  try {
    if ('getScreenDetails' in window) {
      const sd = await window.getScreenDetails();
      const other = sd.screens.find(s => s !== sd.currentScreen && !s.isPrimary) || sd.screens.find(s => s !== sd.currentScreen);
      if (other) feat = `popup,left=${other.availLeft},top=${other.availTop},width=${other.availWidth},height=${other.availHeight}`;
    }
  } catch (_) { /* permission refused: a normal pop-up the DM can drag to the TV */ }
  const w = window.open(url, 'gc-display', feat);
  if (!w) toast('The browser blocked the pop-up: allow pop-ups for this site, then press Cast again', 5000);
  else { try { w.focus(); } catch (_) { /* ignore */ } bmFlash('Display opened: drag it to the TV if it is not there already'); }
}

// live updates from the other DM (polling) and from this DM's other tabs
LIVE_HOOKS.battle = () => { if (bmMounted()) bmRebase(); else bmPostDoc(); };
LIVE_HOOKS.encounter = () => bmEncChanged();
window.addEventListener('gc-saved', e => {
  const n = e.detail && e.detail.name;
  if (n === 'encounter') bmEncChanged();
  if (n === 'battle' && !bmMounted()) bmPostDoc();
});

// ---------- render the tab ----------
async function renderBattleMap(c) {
  // Players get the same player-safe view as the TV (the login server only sends them that much anyway)
  if (!isStaff(S.me)) { document.body.classList.remove('bm-full'); if (BM.view) { BM.view.destroy(); BM.view = null; } c.innerHTML = '<iframe class="bm-player-frame" src="display.html?embed=1" title="Battle map"></iframe>'; return; }
  await api('/api/battle'); // logged in + data loaded
  if (BM.view) { BM.view.destroy(); BM.view = null; }
  bmRebase();
  BM.enc = bmEncView();
  // full-bleed: battlemap.css folds the app header and tab bar away while this tab is open (body.tab-battlemap.bm-full)
  document.body.classList.add('bm-full');
  c.innerHTML = bmShellHTML();
  BM.root = c.querySelector('.bm'); BM.stage = c.querySelector('#bm-stage');
  bmFitHeight();
  const v = BM.view = new BattleView(c.querySelector('#bm-canvas'));
  v.setChars(RAW.characters || []); v.setEncounter(BM.enc); v.rule = bmPref('rule', '5');
  v.onCamera = () => { bmRenderZoom(); bmPostCam(); bmSaveCamSoon(); bmRenderInspectorPos(); };
  v.labels = bmPref('labels', 'focus'); // names on hover, selection, drag and the active turn; L shows them all
  v.backdrop = bmBackdrop();
  v.onFrame = bmFrame;
  bmBind();
  let id = localStorage.getItem('gc_bm_scene');
  if (!bmScene(id)) id = (BM.doc.display.sceneId && bmScene(BM.doc.display.sceneId)) ? BM.doc.display.sceneId : (BM.doc.scenes[0] && BM.doc.scenes[0].id);
  bmRenderTools();
  bmSelectScene(id || null, true);
  bmSaveState(BM.pending.length ? 'pending' : 'saved');
  bmPostDoc(); bmPostEnc();
}
function bmFitHeight() {
  if (!bmMounted()) return;
  const top = BM.root.parentElement.getBoundingClientRect().top + window.scrollY;
  BM.root.style.height = Math.max(360, window.innerHeight - top) + 'px';
}
window.addEventListener('resize', () => { if (bmMounted()) { bmFitHeight(); bmSyncSafe(); } });
// beyond the map's edge: the theme's backdrop (battlemap.css --bm-backdrop), so light mode reads as a board on a light table
function bmBackdrop() { return (BM.root && getComputedStyle(BM.root).getPropertyValue('--bm-backdrop').trim()) || '#0c0e13'; }
new MutationObserver(() => { if (bmMounted() && BM.view) { BM.view.backdrop = bmBackdrop(); BM.view.request(); } })
  .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
// the screen bands the floating panels cover, so the renderer keeps token labels out from under them
function bmSyncSafe() {
  const v = BM.view; if (!v || !bmMounted()) return;
  const R = BM.root.getBoundingClientRect();
  const box = sel => { const el = BM.root.querySelector(sel); return el && el.offsetParent && !el.classList.contains('hidden') ? el.getBoundingClientRect() : null; };
  const top = [box('#bm-init'), box('.bm-app')].filter(Boolean), rail = box('#bm-tools'), low = [box('.bm-bl'), box('#bm-tray'), box('.bm-zoom')].filter(Boolean);
  v.safe = {
    t: top.length ? Math.round(Math.max(...top.map(b => b.bottom)) - R.top + 6) : 0,
    r: rail ? Math.round(R.right - rail.left + 6) : 0,
    b: low.length ? Math.round(R.bottom - Math.min(...low.map(b => b.top)) + 6) : 0,
    l: 0
  };
  v.request();
}
function bmToggleLabels() {
  const v = BM.view; if (!v) return;
  v.labels = v.labels === 'all' ? 'focus' : 'all'; bmSetPref('labels', v.labels);
  bmRenderToolsState(); v.request();
  bmFlash(v.labels === 'all' ? 'Showing every name' : 'Names on hover, selection and the active turn');
}

function bmShellHTML() {
  return `<div class="bm" tabindex="-1">
    <div class="bm-stage" id="bm-stage"><canvas id="bm-canvas"></canvas></div>
    <div class="bm-app">
      <button class="bm-app-btn bm-glass" id="bm-app" aria-haspopup="true" aria-expanded="false" aria-label="All tabs" data-tip="All tabs · theme · pin a panel">${ic('apps')}<span>Battle map</span>${ic('chevdown', 'bm-chev')}</button>
      <button class="bm-fs-btn bm-glass" id="bm-fs" aria-label="Full screen" data-tip="Full screen" data-key="\\">${ic('maximize')}</button>
    </div>
    <div class="bm-init bm-glass hidden" id="bm-init" aria-label="Initiative"></div>
    <div class="bm-tools bm-glass" id="bm-tools" role="toolbar" aria-label="Battle map tools" aria-orientation="vertical"></div>
    <div class="bm-flyout bm-glass hidden" id="bm-flyout"></div>
    <div class="bm-insp bm-glass hidden" id="bm-insp"></div>
    <div class="bm-bottom">
      <div class="bm-bl">
        <button class="bm-scene bm-glass" id="bm-scene-btn" data-tip="Scenes">${ic('layers')}<span id="bm-scene-name">No scene</span>${ic('chevup', 'bm-chev')}</button>
        <button class="bm-cast bm-glass" id="bm-cast" aria-label="Player display (TV)" data-tip="Player display (TV)">${ic('cast')}<span>Display</span><i class="bm-dot" id="bm-cast-dot"></i>${ic('chevup', 'bm-chev')}</button>
      </div>
      <div class="bm-tray bm-glass hidden" id="bm-tray"></div>
      <div class="bm-br">
        <span class="bm-save" id="bm-save" data-state="saved" aria-live="polite"></span>
        <div class="bm-zoom bm-glass" id="bm-zoom"></div>
      </div>
    </div>
    <div class="bm-pop bm-glass hidden" id="bm-pop"></div>
    <div class="bm-hint hidden" id="bm-hint"></div>
    <div class="bm-flash" id="bm-flash" aria-live="polite"></div>
    <div class="bm-drop hidden" id="bm-drop"><div>${ic('upload')}<b>Drop to create a scene</b><span>JPG, PNG or WebP up to 15 MB</span></div></div>
    <div class="bm-empty hidden" id="bm-empty"></div>
    <input type="file" id="bm-file" accept="image/*" hidden>
    <input type="file" id="bm-token-file" accept="image/*" hidden>
  </div>`;
}

// restore: coming back to the tab in the same page session keeps that scene's view; otherwise fit the action
function bmSelectScene(id, restore) {
  BM.sceneId = id && bmScene(id) ? id : null;
  if (BM.sceneId) localStorage.setItem('gc_bm_scene', BM.sceneId);
  const v = BM.view, sc = bmScene();
  BM.fogPoly = null; BM.act = null; v.live = { drag: null, ruler: null, previews: [], marquee: null, fogDraft: null, calib: null };
  v.setScene(sc);
  BM.root.classList.toggle('bm-noscene', !sc);
  $('#bm-empty').classList.toggle('hidden', !!sc);
  if (!sc) { bmRenderEmpty(); bmRenderAll(); return; }
  const cam = restore && BM.cams[sc.id];
  if (cam && cam.z) v.setCam({ z: cam.z, x: v.W / 2 - cam.cx * cam.z, y: v.H / 2 - cam.cy * cam.z });
  else bmFit(false);
  bmRenderAll();
  bmPostLive(); bmPostCam();
}
function bmChanged(remote) {
  if (!bmMounted()) return;
  const sc = bmScene();
  if (!sc && BM.sceneId) { bmSelectScene(BM.doc.scenes[0] ? BM.doc.scenes[0].id : null); if (remote) bmFlash('The scene was deleted by the other DM'); return; }
  if (!sc && BM.doc.scenes.length) { bmSelectScene(BM.doc.scenes[0].id); return; }
  const v = BM.view;
  // drop selections that no longer exist
  for (const id of [...v.sel]) if (!sc || !sc.tokens.some(t => t.id === id)) v.sel.delete(id);
  if (v.selDrawing) v.selDrawing = sc && sc.drawings.find(d => d.id === v.selDrawing.id) || null;
  v.setScene(sc);
  if (!sc) { $('#bm-empty').classList.remove('hidden'); bmRenderEmpty(); }
  bmRenderAll(true);
}
function bmRenderAll(soft) {
  bmRenderSceneChip(); bmRenderTray(); bmRenderInit(); bmRenderZoom(); bmRenderInspector(soft); bmRenderToolsState(); bmRenderCastDot(); bmSyncSafe();
  if (!soft && BM.pop) bmClosePop();
}

// ---------- camera ----------
function bmZoomLimits() {
  const sc = bmScene(), v = BM.view; if (!sc) return [0.05, 4];
  const { w, h } = bsSceneSize(sc), fit = Math.min(v.W / w, v.H / h);
  return [Math.min(fit * 0.4, 0.5), Math.max(fit * 2, 520 / bsGrid(sc).size)];
}
function bmZoomAt(p, f) {
  const v = BM.view, [lo, hi] = bmZoomLimits(), z = bsClamp(v.cam.z * f, lo, hi), s = v.toScene(p[0], p[1]);
  BM.zoomAnim = null; BM.camAnim = null;
  v.setCam({ z, x: p[0] - s[0] * z, y: p[1] - s[1] * z });
}
function bmZoomBy(f) {
  const v = BM.view, p = [v.W / 2, v.H / 2], [lo, hi] = bmZoomLimits();
  BM.zoomAnim = { target: bsClamp((BM.zoomAnim ? BM.zoomAnim.target : v.cam.z) * f, lo, hi), p, s: v.toScene(p[0], p[1]) };
  v.request();
}
function bmAnimateCam(to) { BM.zoomAnim = null; BM.camAnim = { from: { ...BM.view.cam }, to, t0: performance.now(), dur: 420 }; BM.view.request(); }
// what to frame: the tokens plus two squares, else the revealed area, else the whole map
function bmContentRect(sc) {
  const s = bsGrid(sc).size, { w, h } = bsSceneSize(sc);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (x, y, r) => { x0 = Math.min(x0, x - r); y0 = Math.min(y0, y - r); x1 = Math.max(x1, x + r); y1 = Math.max(y1, y + r); };
  for (const t of sc.tokens) if (Number.isFinite(t.x) && Number.isFinite(t.y)) add(t.x, t.y, Math.max(0.5, Number(t.size) || 1) * s / 2 + 2 * s);
  if (!(x1 > x0) && sc.fog.on) for (const r of sc.fog.reveals) if (!r.hide) for (const [x, y] of r.pts || []) add(x, y, s);
  if (!(x1 > x0 && y1 > y0)) return { x: 0, y: 0, w, h };
  // never tighter than about 16 × 10 squares, and only the map itself
  const grow = (a, b, min) => (b - a >= min ? [a, b] : [(a + b - min) / 2, (a + b + min) / 2]);
  [x0, x1] = grow(x0, x1, Math.min(w, 16 * s)); [y0, y1] = grow(y0, y1, Math.min(h, 10 * s));
  x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(w, x1); y1 = Math.min(h, y1);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w, h };
}
// no dead bands: where the map is bigger than the window it fills it edge to edge
function bmClampCam(c) {
  const sc = bmScene(), v = BM.view; if (!sc) return c;
  const { w, h } = bsSceneSize(sc);
  const axis = (pos, len, span) => (len >= span ? bsClamp(pos, span - len, 0) : bsClamp(pos, 0, span - len));
  return { z: c.z, x: axis(c.x, w * c.z, v.W), y: axis(c.y, h * c.z, v.H) };
}
function bmFit(animate, whole) {
  const sc = bmScene(); if (!sc) return;
  const { w, h } = bsSceneSize(sc), v = BM.view;
  const to = whole ? v.camFor({ x: 0, y: 0, w, h }, BM_PAD) : bmClampCam(v.camFor(bmContentRect(sc), BM_PAD));
  if (animate) bmAnimateCam(to); else v.setCam(to);
}
function bmCenterOn(x, y) { const v = BM.view, z = v.cam.z; bmAnimateCam({ z, x: (BM_PAD.l + v.W - BM_PAD.r) / 2 - x * z, y: (BM_PAD.t + v.H - BM_PAD.b) / 2 - y * z }); }
// per-frame camera easing (smooth wheel zoom, fit, centre)
function bmFrame(t) {
  const v = BM.view; let anim = false;
  if (BM.camAnim) {
    const a = BM.camAnim, k = bsEase((t - a.t0) / a.dur), lz = Math.log(a.from.z) + (Math.log(a.to.z) - Math.log(a.from.z)) * k, z = Math.exp(lz);
    // keep the motion straight in screen space: interpolate the scene point at the centre
    const cx = v.W / 2, cy = v.H / 2, s0 = [(cx - a.from.x) / a.from.z, (cy - a.from.y) / a.from.z], s1 = [(cx - a.to.x) / a.to.z, (cy - a.to.y) / a.to.z];
    const s = [s0[0] + (s1[0] - s0[0]) * k, s0[1] + (s1[1] - s0[1]) * k];
    v.cam = { z, x: cx - s[0] * z, y: cy - s[1] * z };
    if (k >= 1) { v.cam = { ...a.to }; BM.camAnim = null; } else anim = true;
    v.onCamera && v.onCamera();
  } else if (BM.zoomAnim) {
    // time-based easing (~90 ms time constant) so a slow machine converges just as fast
    const a = BM.zoomAnim, dt = Math.min(100, t - (a.t || t - 16)); a.t = t;
    const z0 = v.cam.z, lz = Math.log(z0) + (Math.log(a.target) - Math.log(z0)) * (1 - Math.exp(-dt / 90));
    let z = Math.exp(lz); if (Math.abs(Math.log(z / a.target)) < 0.003) { z = a.target; BM.zoomAnim = null; } else anim = true;
    v.cam = { z, x: a.p[0] - a.s[0] * z, y: a.p[1] - a.s[1] * z };
    v.onCamera && v.onCamera();
  }
  return anim;
}
let bmCamSaveT = 0;
function bmSaveCamSoon() {
  clearTimeout(bmCamSaveT);
  bmCamSaveT = setTimeout(() => {
    const v = BM.view; if (!v || !BM.sceneId) return;
    const [cx, cy] = v.toScene(v.W / 2, v.H / 2);
    BM.cams[BM.sceneId] = { cx, cy, z: v.cam.z };
  }, 400);
}

// ---------- floating UI ----------
function bmRenderTools() {
  const el = $('#bm-tools'), sep = '<span class="bm-sep" role="separator"></span>';
  el.innerHTML = BM_TOOLS.map((t, i) => `${i && t.g !== BM_TOOLS[i - 1].g ? sep : ''}<button class="bm-tool" data-tool="${t.id}" aria-label="${t.name} (${t.key.toUpperCase()})" data-tip="${t.name}" data-key="${t.key.toUpperCase()}">${ic(t.icon)}</button>`).join('')
    + `${sep}
      <button class="bm-tool" id="bm-undo" aria-label="Undo" data-tip="Undo" data-key="${BM_MOD}Z">${ic('undo')}</button>
      <button class="bm-tool" id="bm-redo" aria-label="Redo" data-tip="Redo" data-key="${BM_MAC ? '⇧⌘Z' : 'Ctrl Y'}">${ic('redo')}</button>
      ${sep}
      <button class="bm-tool" id="bm-add-tok" aria-label="Add a token" data-tip="Add a token" data-key="A">${ic('userplus')}</button>
      <button class="bm-tool" id="bm-labels" aria-label="Show every name" data-key="L">${ic('tag')}</button>
      <button class="bm-tool" id="bm-grid-btn" aria-label="Grid settings" data-tip="Grid & scale" data-key="G">${ic('grid')}</button>`;
  el.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => bmSetTool(b.dataset.tool));
  $('#bm-undo').onclick = () => bmUndoRedo(false);
  $('#bm-redo').onclick = () => bmUndoRedo(true);
  $('#bm-add-tok').onclick = () => (BM.pop === 'token' ? bmClosePop() : bmOpenNewToken());
  $('#bm-grid-btn').onclick = () => (BM.pop === 'grid' ? bmClosePop() : bmOpenGrid());
  $('#bm-labels').onclick = () => bmToggleLabels();
}
function bmRenderToolsState() {
  if (!bmMounted()) return;
  $$('#bm-tools [data-tool]').forEach(b => { const on = b.dataset.tool === BM.tool; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  const u = $('#bm-undo'), r = $('#bm-redo');
  if (u) { u.disabled = !BM.undo.length; u.dataset.tip = BM.undo.length ? `Undo ${BM.undo[BM.undo.length - 1].label}` : 'Nothing to undo'; }
  if (r) { r.disabled = !BM.redo.length; r.dataset.tip = BM.redo.length ? `Redo ${BM.redo[BM.redo.length - 1].label}` : 'Nothing to redo'; }
  $('#bm-grid-btn').classList.toggle('open', BM.pop === 'grid');
  $('#bm-add-tok').classList.toggle('open', BM.pop === 'token');
  const lb = $('#bm-labels'), all = !!(BM.view && BM.view.labels === 'all');
  if (lb) { lb.classList.toggle('open', all); lb.setAttribute('aria-pressed', all); lb.dataset.tip = all ? 'Names: always shown' : 'Names: on hover and turn'; }
  const app = $('#bm-app'); if (app) { app.classList.toggle('open', BM.pop === 'app'); app.setAttribute('aria-expanded', BM.pop === 'app'); }
  BM.stage.dataset.tool = BM.tool;
}
function bmSetTool(id) {
  if (id !== 'calibrate') bmSetPref('tool', id);
  if (BM.tool !== 'calibrate') BM.prevTool = BM.tool;
  BM.tool = id; BM.fogPoly = null;
  const v = BM.view; v.live.fogDraft = null; v.live.previews = []; v.live.ruler = null;
  if (id !== 'select') { v.selDrawing = null; }
  bmRenderToolsState(); bmRenderFlyout(); bmRenderInspector(); bmHint();
  v.request(); bmPostLive();
}
function bmHint(text) {
  const el = $('#bm-hint'); if (!el) return;
  const t = text || (BM.tool === 'calibrate' ? 'Drag across exactly one grid square on the map · Esc cancels'
    : BM.tool === 'fog' && bmPref('fogShape', 'rect') === 'poly' ? (BM.fogPoly ? 'Click to add points · click the first point or press Enter to close · Esc cancels' : 'Click to start a polygon')
      : '');
  el.textContent = t; el.classList.toggle('hidden', !t);
}
function bmFlash(text) {
  const el = $('#bm-flash'); if (!el) return;
  el.textContent = text; el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  clearTimeout(bmFlash.t); bmFlash.t = setTimeout(() => el.classList.remove('show'), 1800);
}
const bmSeg = (name, opts, cur) => `<div class="bm-seg" role="radiogroup">${opts.map(([v, label, icon]) => `<button role="radio" aria-checked="${v === cur}" class="${v === cur ? 'on' : ''}" data-${name}="${v}" title="${label}">${icon ? ic(icon) : ''}${icon ? '' : `<span>${label}</span>`}</button>`).join('')}</div>`;
function bmRenderFlyout() {
  const el = $('#bm-flyout'), t = BM.tool, tool = BM_TOOLS.find(x => x.id === t);
  let body = '';
  if (t === 'draw') {
    const col = bmPref('drawColor', BM_COLORS[0]), shape = bmPref('drawShape', 'path'), w = bmPref('drawWidth', 'med');
    body = `<label>Shape</label>${bmSeg('shape', [['path', 'Freehand', 'squiggle'], ['line', 'Line', 'segment'], ['rect', 'Rectangle', 'rect'], ['circle', 'Circle', 'circle']], shape)}
      <label>Colour</label><div class="bm-swatches">${BM_COLORS.map(c => `<button class="bm-sw ${c === col ? 'on' : ''}" data-color="${c}" style="--c:${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
      <label>Stroke</label>${bmSeg('width', [['thin', 'Thin'], ['med', 'Medium'], ['thick', 'Thick']], w)}
      <label class="bm-check"><input type="checkbox" id="bm-fill" ${bmPref('drawFill', false) ? 'checked' : ''}> Fill shapes</label>
      <label class="bm-check"><input type="checkbox" id="bm-dmonly" ${bmPref('drawDm', false) ? 'checked' : ''}> DM only <span class="muted">(not on the TV)</span></label>`;
  } else if (t === 'template') {
    const col = bmPref('tplColor', BM_TPL_COLORS[0][0]), shape = bmPref('tplShape', 'circle');
    body = `<label>Shape</label>${bmSeg('tshape', [['circle', 'Sphere / radius', 'circle'], ['cone', 'Cone', 'cone'], ['line', 'Line', 'beam'], ['cube', 'Cube', 'cube']], shape)}
      <label>Effect</label><div class="bm-swatches">${BM_TPL_COLORS.map(([c, n]) => `<button class="bm-sw ${c === col ? 'on' : ''}" data-tcolor="${c}" style="--c:${c}" title="${n}" aria-label="${n}"></button>`).join('')}</div>
      <label>Size when clicked</label><div class="bm-row"><input type="number" id="bm-tpl-ft" min="5" max="300" step="5" value="${bmPref('tplFt', 20)}"><span class="muted">ft</span></div>
      <p class="bm-note">Drag from the point of origin to size and aim. Select a template to move it or drag its handle to rotate · <span class="kbd">[</span> <span class="kbd">]</span> turn 15°.</p>`;
  } else if (t === 'fog') {
    const sc = bmScene(), on = sc && sc.fog.on;
    body = `<label class="bm-switch"><input type="checkbox" id="bm-fog-on" ${on ? 'checked' : ''}><span></span> Fog of war ${on ? 'on' : 'off'}</label>
      <label>Brush</label>${bmSeg('fmode', [['reveal', 'Reveal'], ['hide', 'Hide']], bmPref('fogMode', 'reveal'))}
      ${bmSeg('fshape', [['rect', 'Rectangle', 'sqdash'], ['poly', 'Polygon', 'polygon']], bmPref('fogShape', 'rect'))}
      <div class="bm-row" style="margin-top:8px"><button class="btn small" id="bm-fog-all">${ic('sun')} Reveal all</button><button class="btn small" id="bm-fog-reset">${ic('moon')} Reset</button></div>
      <p class="bm-note">You see fog as a hatched veil; the TV shows darkness.</p>`;
  } else if (t === 'ruler') {
    body = `<label>Diagonals</label>${bmSeg('rule', [['5', '5 ft each'], ['alt', '5 / 10 ft'], ['euclid', 'True distance']], bmPref('rule', '5'))}`;
  }
  if (!tool || !body) { el.classList.add('hidden'); el.innerHTML = ''; return; }
  el.innerHTML = `<div class="bm-fly-head">${ic(tool.icon)}<b>${tool.name}</b><span class="kbd">${tool.key.toUpperCase()}</span></div>${body}`;
  el.classList.remove('hidden');
  const btn = $(`#bm-tools [data-tool="${t}"]`);
  if (btn) el.style.top = Math.max(12, btn.getBoundingClientRect().top - BM.root.getBoundingClientRect().top - 8) + 'px';
  const re = () => bmRenderFlyout();
  el.querySelectorAll('[data-shape]').forEach(b => b.onclick = () => { bmSetPref('drawShape', b.dataset.shape); re(); });
  el.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { bmSetPref('drawColor', b.dataset.color); re(); bmRecolorSelected(b.dataset.color); });
  el.querySelectorAll('[data-width]').forEach(b => b.onclick = () => { bmSetPref('drawWidth', b.dataset.width); re(); });
  el.querySelectorAll('[data-tshape]').forEach(b => b.onclick = () => { bmSetPref('tplShape', b.dataset.tshape); re(); });
  el.querySelectorAll('[data-tcolor]').forEach(b => b.onclick = () => { bmSetPref('tplColor', b.dataset.tcolor); re(); bmRecolorSelected(b.dataset.tcolor); });
  el.querySelectorAll('[data-fmode]').forEach(b => b.onclick = () => { bmSetPref('fogMode', b.dataset.fmode); re(); });
  el.querySelectorAll('[data-fshape]').forEach(b => b.onclick = () => { bmSetPref('fogShape', b.dataset.fshape); BM.fogPoly = null; BM.view.live.fogDraft = null; BM.view.request(); re(); bmHint(); });
  el.querySelectorAll('[data-rule]').forEach(b => b.onclick = () => { bmSetPref('rule', b.dataset.rule); BM.view.rule = b.dataset.rule; re(); });
  const q = s => el.querySelector(s);
  if (q('#bm-fill')) q('#bm-fill').onchange = e => bmSetPref('drawFill', e.target.checked);
  if (q('#bm-dmonly')) q('#bm-dmonly').onchange = e => bmSetPref('drawDm', e.target.checked);
  if (q('#bm-tpl-ft')) q('#bm-tpl-ft').onchange = e => bmSetPref('tplFt', bsClamp(Math.round((Number(e.target.value) || 20) / 5) * 5, 5, 300));
  if (q('#bm-fog-on')) q('#bm-fog-on').onchange = e => { const sc = bmScene(); bmCommit(e.target.checked ? 'Fog on' : 'Fog off', [{ coll: 'prop', id: 'fog.on', before: !!sc.fog.on, after: e.target.checked }]); re(); };
  if (q('#bm-fog-all')) q('#bm-fog-all').onclick = () => bmFogAll(true);
  if (q('#bm-fog-reset')) q('#bm-fog-reset').onclick = () => bmFogAll(false);
}
function bmFogAll(reveal) {
  const sc = bmScene(); if (!sc) return;
  const { w, h } = bsSceneSize(sc), before = bmClone(sc.fog);
  const after = { on: true, reveals: reveal ? [{ id: uid(), pts: [[0, 0], [w, 0], [w, h], [0, h]] }] : [] };
  bmCommit(reveal ? 'Reveal all' : 'Reset fog', [{ coll: 'prop', id: 'fog', before, after }]);
  bmRenderFlyout();
}
function bmRecolorSelected(color) {
  const d = BM.view && BM.view.selDrawing; if (!d) return;
  bmCommit('Recolour', [{ coll: 'drawings', id: d.id, before: { color: d.color }, after: { color }, patch: true }]);
}

function bmRenderSceneChip() {
  const sc = bmScene(), n = $('#bm-scene-name'); if (!n) return;
  n.textContent = sc ? sc.name || 'Untitled scene' : 'No scene';
  const onTv = sc && BM.doc.display.sceneId === sc.id;
  $('#bm-scene-btn').classList.toggle('ontv', !!onTv);
  $('#bm-scene-btn').dataset.tip = onTv ? 'Scenes · this one is on the TV' : 'Scenes';
}
function bmRenderZoom() {
  const el = $('#bm-zoom'), sc = bmScene(); if (!el || !BM.view) return;
  const cell = sc ? bsGrid(sc).size * BM.view.cam.z : 0;
  let cells = 1; while (cell * cells < 14 && cells < 64) cells *= 2;
  const bar = Math.round(bsClamp(cell * cells, 6, 80));
  const html = `<button class="bm-ib" data-z="out" aria-label="Zoom out" data-tip="Zoom out" data-key="−">${ic('minus')}</button>
    <button class="bm-zpct" data-z="fit" aria-label="Fit to the action" data-tip="Fit to the action · Shift-click: whole map" data-key="0">${Math.round(BM.view.cam.z * 100)}%</button>
    <button class="bm-ib" data-z="in" aria-label="Zoom in" data-tip="Zoom in" data-key="+">${ic('plus')}</button>
    <span class="bm-scale" title="Scale: one square is 5 feet"><i style="width:${bar}px"></i>${cells * 5} ft</span>`;
  if (el.dataset.k !== html) { el.innerHTML = html; el.dataset.k = html; el.querySelectorAll('[data-z]').forEach(b => b.onclick = e => b.dataset.z === 'fit' ? bmFit(true, e.shiftKey) : bmZoomBy(b.dataset.z === 'in' ? 1.35 : 1 / 1.35)); }
}
function bmRenderCastDot() {
  const d = $('#bm-cast-dot'); if (!d) return;
  const live = Date.now() - BM.displaySeen < 7000;
  d.classList.toggle('live', live);
  const b = $('#bm-cast'); if (b) b.dataset.tip = live ? 'Player display · connected' : 'Player display · not open';
}

// initiative strip: round · whose turn · who is next · next turn
function bmRenderInit() {
  const el = $('#bm-init'); if (!el) return;
  const enc = BM.enc || bmEncView(), list = enc.combatants || [];
  if (!list.length || !bmScene()) { el.classList.add('hidden'); el.innerHTML = ''; el.dataset.sig = ''; return; }
  const turn = Math.min(enc.turn || 0, list.length - 1), cur = list[turn];
  const sig = JSON.stringify([enc.round, turn, list.map(c => [c.id, c.name, c.hp, c.maxHp, c.characterId, c.monster]), bmScene().tokens.filter(t => t.combatantId).map(t => [t.combatantId, t.img, t.kind])]);
  if (el.dataset.sig === sig && !el.classList.contains('hidden')) return;
  el.dataset.sig = sig;
  // the same language as the TV ribbon: round medallion · now acting · up next, then the amber Next
  const next = []; for (let i = 1; i < list.length && next.length < 4; i++) next.push(list[(turn + i) % list.length]);
  const hpOf = c => Number(c.maxHp) > 0 ? { hp: Number(c.hp) || 0, max: Number(c.maxHp) } : null;
  const hp = c => { const h = hpOf(c); return h ? `<span class="bm-init-hp ${h.hp <= 0 ? 'down' : h.hp <= h.max / 2 ? 'low' : ''}">${h.hp}<i>/${h.max}</i></span>` : ''; };
  const curDown = (hpOf(cur) || {}).hp <= 0;
  const nm = c => `${esc(bsBaseName(c.name) || c.name || '—')}${bsNumber(c.name) ? ` <i>${bsNumber(c.name)}</i>` : ''}`;
  el.innerHTML = `<div class="bm-round" title="Round ${enc.round || 1}"><small>Round</small><b>${enc.round || 1}</b></div>
    <button class="bm-ib bm-prev" id="bm-prev" aria-label="Previous turn" data-tip="Previous turn">${ic('skipback')}</button>
    <button class="bm-init-cur ${curDown ? 'down' : ''}" data-cid="${esc(cur.id || '')}" data-tip="Centre on ${esc(cur.name)}"><canvas data-disc="${turn}"></canvas><span><small>${curDown ? 'Down' : 'Now acting'}</small><b>${esc(cur.name || '—')}</b></span>${hp(cur)}</button>
    ${next.length ? `<div class="bm-init-next" aria-label="Up next"><small>Up next</small><div class="bm-init-row">${next.map((c, i) => `<button class="bm-init-up ${(hpOf(c) || {}).hp <= 0 ? 'down' : ''}" style="--i:${i}" data-cid="${esc(c.id || '')}" data-tip="Centre on ${esc(c.name)}"><canvas data-disc="${list.indexOf(c)}"></canvas><b>${nm(c)}</b></button>`).join('')}</div></div>` : ''}
    <button class="bm-next" id="bm-next" aria-label="Next turn" data-tip="Next turn" data-key="N"><span>Next</span>${ic('skipfwd')}</button>`;
  el.classList.remove('hidden');
  el.querySelectorAll('canvas[data-disc]').forEach(cv => {
    const c = list[Number(cv.dataset.disc)], isCur = !!cv.closest('.bm-init-cur'), info = bsCombatantInfo(c, RAW.characters, null);
    const tok = c.id && bmScene().tokens.find(t => t.combatantId === c.id); // the disc matches the token on the map
    if (tok) { if (BS_KINDS[tok.kind]) info.kind = tok.kind; if (tok.img) info.img = tok.img; }
    bmFaceDisc(cv, info, isCur ? 40 : 26, isCur ? '#F2B544' : null);
  });
  $('#bm-next').onclick = () => bmTurn(1);
  $('#bm-prev').onclick = () => bmTurn(-1);
  el.querySelectorAll('[data-cid]').forEach(b => b.onclick = () => {
    const t = bmScene().tokens.find(x => x.combatantId && x.combatantId === b.dataset.cid);
    if (t) { BM.view.sel = new Set([t.id]); BM.view.selDrawing = null; bmCenterOn(t.x, t.y); bmRenderInspector(); BM.view.request(); }
    else bmFlash('Not on this map yet: drag it in from the tray');
  });
}

/* A head-and-shoulders crop for tall portraits, so a face reads at 26–40 px instead of a dark torso.
   Square art, emoji and initials go through the usual token disc. */
function bmFaceDisc(cv, info, css, ring) {
  ring = info.down ? '#6b7280' : ring || BS_KINDS[info.kind].ring;
  const e = info.img ? bsImage(info.img, () => { if (cv.isConnected) bmFaceDisc(cv, info, css, ring); }) : null;
  const im = e && e.img;
  if (!im && info.img && !info.down) return bsDisc(cv, { ...info, img: null }, css, { ring }); // initials until the image arrives
  if (!im || info.down || im.height / im.width < 1.15) return bsDisc(cv, info, css, { ring });
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5), px = Math.round(css * dpr), x = cv.getContext('2d');
  cv.width = px; cv.height = px; cv.style.width = css + 'px'; cv.style.height = css + 'px';
  const side = im.width * 0.62, sx = (im.width - side) / 2, sy = im.height * 0.05, lw = Math.max(2, px * 0.075), R = px / 2;
  x.clearRect(0, 0, px, px);
  x.save(); x.beginPath(); x.arc(R, R, R - lw * 0.6, 0, BS_TAU); x.clip();
  x.imageSmoothingQuality = 'high'; x.drawImage(im, sx, sy, side, side, 0, 0, px, px); x.restore();
  x.beginPath(); x.arc(R, R, R - lw / 2, 0, BS_TAU); x.lineWidth = lw; x.strokeStyle = ring; x.stroke();
  x.beginPath(); x.arc(R, R, R - lw - 0.5, 0, BS_TAU); x.lineWidth = 1; x.strokeStyle = 'rgba(0,0,0,.4)'; x.stroke();
  return cv;
}

// token tray: encounter combatants not yet on this scene
function bmRenderTray() {
  const el = $('#bm-tray'), sc = bmScene(); if (!el) return;
  if (!sc) { el.classList.add('hidden'); return; }
  const enc = BM.enc || bmEncView(), placed = new Set(sc.tokens.map(t => t.combatantId).filter(Boolean));
  const todo = (enc.combatants || []).map((c, i) => ({ c, i })).filter(x => !x.c.id || !placed.has(x.c.id));
  // a compact tray only while someone is still waiting to be placed (Add a token lives on the rail)
  if (!todo.length) { el.classList.add('hidden'); el.innerHTML = ''; el.dataset.sig = ''; return; }
  el.classList.remove('hidden');
  const sig = JSON.stringify([todo.map(x => [x.i, x.c.name, x.c.hp, x.c.characterId, x.c.monster]), (enc.combatants || []).length]);
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  el.innerHTML = `<div class="bm-tray-head"><small>To place</small>${todo.length > 1 ? `<button class="bm-tray-all" id="bm-add-all" title="Place every combatant on the map">${ic('userplus')}<span>Add all</span><b>${todo.length}</b></button>` : '<span class="bm-tray-tip">Drag onto the map</span>'}</div>
    <div class="bm-tray-list">${todo.map(x => `<button class="bm-tray-item" data-i="${x.i}" title="${esc(x.c.name)} · drag onto the map, or click to place"><canvas></canvas><span>${esc(bsBaseName(x.c.name) || '—')}${bsNumber(x.c.name) ? ` <i>${bsNumber(x.c.name)}</i>` : ''}</span></button>`).join('')}</div>`;
  el.querySelectorAll('.bm-tray-item').forEach(b => {
    const x = todo.find(y => y.i === Number(b.dataset.i));
    bsDisc(b.querySelector('canvas'), bsCombatantInfo(x.c, RAW.characters, null), 36);
    b.addEventListener('pointerdown', e => bmTrayDrag(e, b, x));
  });
  if ($('#bm-add-all')) $('#bm-add-all').onclick = () => bmAddAll();
}
function bmTokenFromCombatant(c) {
  const kind = bsKindOf(c);
  return { id: uid(), name: c.name || 'Token', x: 0, y: 0, size: (c.monster && BS_MONSTER_SIZE[c.monster]) || 1, kind, img: null, characterId: c.characterId || null, combatantId: c.id || null, monster: c.monster || null, hidden: false };
}
async function bmCombatantAt(i, name) {
  const enc = await bmEnsureIds();
  const list = enc.combatants || [];
  return (list[i] && list[i].name === name) ? list[i] : list.find(c => c.name === name) || null;
}
// nearest free square to (x, y), spiralling out
function bmFreeSpot(sc, x, y, n, taken) {
  const s = bsGrid(sc).size, occ = (px, py) => sc.tokens.concat(taken || []).some(t => Math.hypot(t.x - px, t.y - py) < s * (Math.max(1, t.size || 1) + Math.max(1, n)) / 2 * 0.9);
  const [cx, cy] = bsSnapCenter(sc, x, y, n), { w, h } = bsSceneSize(sc), step = s * Math.max(1, n);
  for (let r = 0; r < 14; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    const px = cx + dx * step, py = cy + dy * step;
    if (px < 0 || py < 0 || px > w || py > h) continue;
    if (!occ(px, py)) return [px, py];
  }
  return [cx, cy];
}
function bmViewCenter() { const v = BM.view; return v.toScene((BM_PAD.l + v.W - BM_PAD.r) / 2, (BM_PAD.t + v.H - BM_PAD.b) / 2); }
async function bmPlace(item, at, free) {
  const sc = bmScene(); if (!sc) return;
  let c;
  try { c = await bmCombatantAt(item.i, item.c.name); } catch (e) { return; }
  if (!c) { toast('That combatant is gone from the encounter'); return; }
  if (bmScene().tokens.some(t => t.combatantId === c.id)) return;
  const t = bmTokenFromCombatant(c);
  const [x, y] = at ? (free ? at : bsSnapCenter(sc, at[0], at[1], t.size)) : bmFreeSpot(sc, ...bmViewCenter(), t.size);
  t.x = x; t.y = y;
  bmCommit(`Place ${t.name}`, [{ coll: 'tokens', id: t.id, before: null, after: t }]);
  BM.view.sel = new Set([t.id]); BM.view.selDrawing = null; bmRenderInspector();
}
async function bmAddAll() {
  const sc = bmScene(); if (!sc) return;
  const enc = await bmEnsureIds(), placed = new Set(bmScene().tokens.map(t => t.combatantId));
  const todo = (enc.combatants || []).filter(c => !placed.has(c.id));
  if (!todo.length) return;
  const [cx, cy] = bmViewCenter(), s = bsGrid(sc).size, made = [];
  // party gathers on the left of the view, everyone else on the right
  for (const c of todo) {
    const t = bmTokenFromCombatant(c), side = t.kind === 'pc' || t.kind === 'ally' ? -1 : 1;
    [t.x, t.y] = bmFreeSpot(sc, cx + side * s * 3, cy, t.size, made);
    made.push(t);
  }
  bmCommit(`Place ${made.length} combatants`, made.map(t => ({ coll: 'tokens', id: t.id, before: null, after: t })));
  bmFlash(`${made.length} tokens placed`);
}
function bmTrayDrag(e, btn, item) {
  if (e.button !== 0) return;
  e.preventDefault();
  try { btn.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
  const start = [e.clientX, e.clientY], sc = bmScene(); let ghost = null;
  const size = (item.c.monster && BS_MONSTER_SIZE[item.c.monster]) || 1;
  const move = ev => {
    if (!ghost && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > 5) {
      const px = Math.max(28, bsGrid(sc).size * size * BM.view.cam.z * 0.92);
      ghost = document.createElement('canvas'); ghost.className = 'bm-ghost';
      bsDisc(ghost, bsCombatantInfo(item.c, RAW.characters, null), px);
      document.body.appendChild(ghost); btn.classList.add('dragging');
    }
    if (ghost) { const half = parseFloat(ghost.style.width) / 2; ghost.style.transform = `translate(${ev.clientX - half}px, ${ev.clientY - half}px)`; }
  };
  const up = ev => {
    btn.removeEventListener('pointermove', move); btn.removeEventListener('pointerup', up); btn.removeEventListener('pointercancel', up);
    btn.classList.remove('dragging');
    if (ev.type === 'pointercancel') { if (ghost) ghost.remove(); return; }
    if (!ghost) { bmPlace(item, null); return; }
    ghost.remove();
    const r = BM.stage.getBoundingClientRect(), over = document.elementFromPoint(ev.clientX, ev.clientY);
    if (over && BM.stage.contains(over) && ev.clientX >= r.left && ev.clientY >= r.top) bmPlace(item, BM.view.toScene(ev.clientX - r.left, ev.clientY - r.top), ev.altKey);
  };
  btn.addEventListener('pointermove', move); btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up);
}

// ---------- inspector: the selected token(s), template or drawing ----------
function bmRenderInspector(soft) {
  const el = $('#bm-insp'); if (!el || !BM.view) return;
  const v = BM.view, sc = bmScene(), toks = sc ? [...v.sel].map(id => sc.tokens.find(t => t.id === id)).filter(Boolean) : [];
  const d = v.selDrawing;
  if (soft && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' && document.activeElement.type !== 'checkbox') return; // don't clobber typing
  if (!toks.length && !d) { el.classList.add('hidden'); el.innerHTML = ''; el.dataset.sig = ''; return; }
  const sig = JSON.stringify([toks, d, toks.map(t => { const i = bsTokenInfo(t, BM.enc, RAW.characters, null); return [i.hp, i.img]; }), (BM.enc && BM.enc.combatants || []).map(c => [c.id, c.name])]);
  if (el.dataset.sig === sig && !el.classList.contains('hidden')) return;
  el.dataset.sig = sig;
  el.classList.remove('hidden');
  if (d) {
    const isT = d.type === 'template', g = isT ? bsTpl(sc, d) : null;
    const cols = isT ? BM_TPL_COLORS.map(x => x[0]) : BM_COLORS;
    el.innerHTML = `<div class="bm-insp-head"><span class="bm-insp-icon" style="--c:${d.color}">${ic(isT ? { circle: 'circle', cone: 'cone', line: 'beam', cube: 'cube' }[d.shape] : { path: 'squiggle', line: 'segment', rect: 'rect', circle: 'circle' }[d.type])}</span>
      <div><b>${isT ? `${g.ft} ft ${BS_TPL_NAMES[d.shape]}` : { path: 'Freehand', line: 'Line', rect: 'Rectangle', circle: 'Circle' }[d.type]}</b><small>${isT ? 'Spell template' : d.dmOnly ? 'Drawing · DM only' : 'Drawing'}</small></div>
      <button class="bm-ib" id="bm-insp-x" aria-label="Deselect">${ic('x')}</button></div>
      <div class="bm-swatches">${cols.map(c => `<button class="bm-sw ${c === d.color ? 'on' : ''}" data-icolor="${c}" style="--c:${c}" aria-label="Colour"></button>`).join('')}</div>
      ${isT ? `<div class="bm-row"><button class="btn small" data-rot="-15" title="Rotate left ([)">↺ 15°</button><button class="btn small" data-rot="15" title="Rotate right (])">↻ 15°</button></div>` : `<label class="bm-check"><input type="checkbox" id="bm-i-dm" ${d.dmOnly ? 'checked' : ''}> DM only</label>`}
      <div class="bm-row bm-insp-foot"><button class="btn small danger" id="bm-i-del">${ic('trash')} Delete <span class="kbd">Del</span></button></div>`;
    el.querySelectorAll('[data-icolor]').forEach(b => b.onclick = () => bmRecolorSelected(b.dataset.icolor));
    el.querySelectorAll('[data-rot]').forEach(b => b.onclick = () => bmRotateTpl(Number(b.dataset.rot)));
    if ($('#bm-i-dm')) $('#bm-i-dm').onchange = e => bmCommit('DM only', [{ coll: 'drawings', id: d.id, before: { dmOnly: !!d.dmOnly }, after: { dmOnly: e.target.checked }, patch: true }]);
    $('#bm-i-del').onclick = () => bmDeleteSelection();
    $('#bm-insp-x').onclick = () => { v.selDrawing = null; bmRenderInspector(); v.request(); };
    return;
  }
  const one = toks.length === 1 ? toks[0] : null;
  const info = one ? bsTokenInfo(one, BM.enc, RAW.characters, BM.view.turnId) : null;
  const kindOf = t => (BS_KINDS[t.kind] ? t.kind : 'neutral'), sizeOf = t => Number(t.size) || 1;
  const kind = toks.every(t => kindOf(t) === kindOf(toks[0])) ? kindOf(toks[0]) : null;
  const size = toks.every(t => sizeOf(t) === sizeOf(toks[0])) ? sizeOf(toks[0]) : null, hidden = toks.every(t => t.hidden);
  const enc = BM.enc || bmEncView(), c = info && info.combatant;
  const linkOpts = one ? `<option value="">— not linked —</option>${(enc.combatants || []).map((x, i) => `<option value="${i}" ${c && x.id === c.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}` : '';
  el.innerHTML = `<div class="bm-insp-head">${one ? '<canvas id="bm-insp-disc"></canvas>' : `<span class="bm-insp-count">${toks.length}</span>`}
      <div class="bm-grow">${one ? `<input id="bm-i-name" value="${esc(one.name)}" aria-label="Token name" spellcheck="false">` : `<b>${toks.length} tokens</b>`}<small>${one ? `${BS_KINDS[one.kind || 'neutral'].label} · ${(BS_SIZES.find(s => s[0] === (one.size || 1)) || BS_SIZES[1])[1]}${one.hidden ? ' · hidden' : ''}` : 'Shift-click to add or remove'}</small></div>
      <button class="bm-ib" id="bm-insp-x" aria-label="Deselect" title="Deselect (Esc)">${ic('x')}</button></div>
    ${info && info.hp ? `<div class="bm-hp ${info.down ? 'down' : info.bloodied ? 'low' : ''}">
        <div class="bm-hp-top"><span>${ic('heart')} HP</span><input id="bm-i-hp" inputmode="numeric" value="${info.hp.hp}" aria-label="Hit points"><span class="muted">/ ${info.hp.max}</span>${info.down ? '<span class="bm-tag red">Down</span>' : info.bloodied ? '<span class="bm-tag">Bloodied</span>' : ''}</div>
        <div class="bm-hp-bar"><i style="width:${Math.round(100 * bsClamp(info.hp.hp / info.hp.max, 0, 1))}%"></i></div>
        <div class="bm-hp-btns">${[-5, -1, 1, 5].map(n => `<button class="btn small" data-hp="${n}">${n > 0 ? '+' : '−'}${Math.abs(n)}</button>`).join('')}</div></div>` : ''}
    <label>Side</label><div class="bm-seg bm-kinds">${Object.entries(BS_KINDS).map(([k, x]) => `<button class="${kind === k ? 'on' : ''}" data-kind="${k}" style="--c:${x.ring}"><i></i>${x.label}</button>`).join('')}</div>
    <label>Size</label><div class="bm-seg">${BS_SIZES.map(([n, name, s]) => `<button class="${size === n ? 'on' : ''}" data-size="${n}" title="${name}">${s}</button>`).join('')}</div>
    ${one ? `<label>Initiative link</label><select id="bm-i-link">${linkOpts}</select>` : ''}
    <label class="bm-switch"><input type="checkbox" id="bm-i-hidden" ${hidden ? 'checked' : ''}><span></span> Hidden from players</label>
    <div class="bm-row bm-insp-foot">
      ${one ? `<button class="btn small" id="bm-i-img" title="Use an image for this token">${ic('image')} Image</button><button class="btn small" id="bm-i-center" title="Centre the view on it">${ic('locate')}</button>` : ''}
      <button class="btn small danger" id="bm-i-del" title="Remove from the map (Delete)">${ic('trash')} Remove</button></div>`;
  if (one) bsDisc($('#bm-insp-disc'), info, 44);
  const patchAll = (label, fields) => bmCommit(label, toks.map(t => ({ coll: 'tokens', id: t.id, before: Object.fromEntries(Object.keys(fields).map(k => [k, t[k] ?? null])), after: fields, patch: true })));
  el.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => patchAll('Change side', { kind: b.dataset.kind }));
  el.querySelectorAll('[data-size]').forEach(b => b.onclick = () => {
    const n = Number(b.dataset.size);
    bmCommit('Resize', toks.map(t => { const [x, y] = bsSnapCenter(sc, t.x, t.y, n); return { coll: 'tokens', id: t.id, before: { size: t.size, x: t.x, y: t.y }, after: { size: n, x, y }, patch: true }; }));
  });
  $('#bm-i-hidden').onchange = e => patchAll(e.target.checked ? 'Hide from players' : 'Show to players', { hidden: e.target.checked });
  $('#bm-i-del').onclick = () => bmDeleteSelection();
  $('#bm-insp-x').onclick = () => { v.sel.clear(); bmRenderInspector(); v.request(); };
  if (one) {
    const nm = $('#bm-i-name');
    nm.onchange = () => { const name = nm.value.trim() || one.name; if (name !== one.name) bmCommit('Rename token', [{ coll: 'tokens', id: one.id, before: { name: one.name }, after: { name }, patch: true }]); };
    nm.onkeydown = e => { if (e.key === 'Enter') nm.blur(); };
    $('#bm-i-link').onchange = async e => {
      const i = e.target.value === '' ? null : Number(e.target.value);
      let cid = null;
      if (i != null) { const encN = await bmEnsureIds(); cid = (encN.combatants[i] || {}).id || null; }
      bmCommit('Link token', [{ coll: 'tokens', id: one.id, before: { combatantId: one.combatantId || null }, after: { combatantId: cid }, patch: true }]);
    };
    $('#bm-i-center').onclick = () => bmCenterOn(one.x, one.y);
    $('#bm-i-img').onclick = () => { const f = $('#bm-token-file'); f.value = ''; f.onchange = () => f.files[0] && bmTokenImage(one.id, f.files[0]); f.click(); };
    el.querySelectorAll('[data-hp]').forEach(b => b.onclick = () => bmHp(c && c.id, Number(b.dataset.hp)));
    const hpIn = $('#bm-i-hp');
    if (hpIn) { hpIn.onchange = () => { const n = Number(hpIn.value); if (Number.isFinite(n) && c) bmSetHp(c.id, n); }; hpIn.onkeydown = e => { if (e.key === 'Enter') hpIn.blur(); }; }
  }
}
function bmRenderInspectorPos() { /* the inspector is docked top-left; nothing follows the camera */ }
async function bmTokenImage(id, file) {
  try {
    bmFlash('Uploading image…');
    const up = await uploadMedia(file, 'media/battle', { maxSide: 512 });
    const t = bmTok(id); if (!t) return;
    bmCommit('Token image', [{ coll: 'tokens', id, before: { img: t.img || null }, after: { img: up.path }, patch: true }]);
  } catch (e) { toast('Upload failed: ' + e.message, 4000); }
}
function bmDeleteSelection() {
  const v = BM.view, sc = bmScene(); if (!sc) return;
  if (v.selDrawing) {
    const d = v.selDrawing, i = sc.drawings.findIndex(x => x.id === d.id);
    v.selDrawing = null;
    bmCommit(d.type === 'template' ? 'Delete template' : 'Delete drawing', [{ coll: 'drawings', id: d.id, before: bmClone(d), after: null, index: i }]);
    return;
  }
  const toks = [...v.sel].map(id => sc.tokens.find(t => t.id === id)).filter(Boolean);
  if (!toks.length) return;
  v.sel.clear();
  bmCommit(toks.length > 1 ? `Remove ${toks.length} tokens` : `Remove ${toks[0].name}`, toks.map(t => ({ coll: 'tokens', id: t.id, before: bmClone(t), after: null, index: sc.tokens.indexOf(t) })));
  bmFlash(`${toks.length > 1 ? toks.length + ' tokens' : toks[0].name} removed · ⌘Z to undo`);
}
function bmRotateTpl(deg) {
  const d = BM.view.selDrawing; if (!d || d.type !== 'template') return;
  const [o, e] = d.pts, a = Math.atan2(e[1] - o[1], e[0] - o[0]) + deg * Math.PI / 180, L = Math.hypot(e[0] - o[0], e[1] - o[1]);
  bmCommit('Rotate template', [{ coll: 'drawings', id: d.id, before: { pts: bmClone(d.pts) }, after: { pts: [o, [o[0] + Math.cos(a) * L, o[1] + Math.sin(a) * L]] }, patch: true }]);
}

// ---------- popovers: scenes, new scene, grid, display ----------
function bmClosePop() {
  const p = $('#bm-pop'); if (p) { p.classList.add('hidden'); p.innerHTML = ''; p.className = 'bm-pop bm-glass hidden'; }
  if (BM.pop === 'grid' && BM.gridBefore) bmCommitGrid();
  BM.pop = null; if (bmMounted()) bmRenderToolsState();
}
function bmOpenPop(kind, html, cls) {
  bmClosePop();
  const p = $('#bm-pop'); BM.pop = kind;
  p.removeAttribute('style'); // the last popover's anchoring
  p.className = `bm-pop bm-glass ${cls || ''}`; p.innerHTML = html;
  bmRenderToolsState();
  return p;
}
// line a popover up with the button that opened it: beside a rail button, or above a bottom-bar button
function bmAnchorPop(p, btn, side) {
  if (!btn || !BM.root) return;
  const r = btn.getBoundingClientRect(), R = BM.root.getBoundingClientRect();
  if (side === 'left') p.style.top = Math.max(12, Math.min(r.top - R.top - 8, R.height - p.offsetHeight - 12)) + 'px';
  else p.style.left = Math.max(12, Math.min(r.left - R.left, R.width - p.offsetWidth - 12)) + 'px';
}

// ---------- the app's tabs, folded into one menu while the map is full-bleed ----------
function bmOpenAppMenu() {
  const tabs = $$('#tabs .tab').filter(b => !b.classList.contains('hidden'));
  const pins = $$('#pin-pick option').filter(o => o.value && !o.hidden && o.value !== 'battlemap');
  const pinned = ($('#pin-pick') || {}).value || '';
  const role = { player: 'Player', dm: 'DM', admin: 'Admin' }[S.me && S.me.role] || '', dark = document.documentElement.dataset.theme !== 'light';
  const live = $('#live-dot') && $('#live-dot').classList.contains('on');
  const p = bmOpenPop('app', `<div class="bm-pop-head"><b>${ic('goat')} Goat Crew</b><span class="bm-app-who" title="${live ? 'Live: changes sync' : 'Not connected'}"><i class="bm-dot ${live ? 'live' : ''}"></i>${esc((S.me && S.me.name) || '')}${role ? ` · ${role}` : ''}</span></div>
    <div class="bm-appgrid" role="menu">${tabs.map(b => `<button role="menuitem" class="bm-apptab ${b.dataset.tab === 'battlemap' ? 'on' : ''} ${b.classList.contains('dm-only') ? 'dm' : ''}" data-go="${esc(b.dataset.tab)}">${b.innerHTML}</button>`).join('')}</div>
    ${pins.length ? `<label>Pin a panel beside the map</label><div class="bm-pins">${pins.map(o => `<button class="${o.value === pinned ? 'on' : ''}" data-pin="${esc(o.value)}">${esc(o.textContent)}</button>`).join('')}</div>` : ''}
    <div class="bm-pop-actions">
      <button class="btn small" id="bm-app-theme">${ic(dark ? 'sun' : 'moon')} ${dark ? 'Light' : 'Dark'} theme</button>
      <button class="btn small" id="bm-app-fs">${ic(document.fullscreenElement ? 'minimize' : 'maximize')} ${document.fullscreenElement ? 'Exit full screen' : 'Full screen'}</button>
      <button class="btn small ghost" id="bm-app-out">${ic('logout')} Log out</button>
    </div>`, 'bm-pop-app');
  p.querySelectorAll('[data-go]').forEach(b => b.onclick = () => {
    const tab = $(`#tabs .tab[data-tab="${b.dataset.go}"]`); bmClosePop();
    if (tab && b.dataset.go !== 'battlemap') tab.click();
  });
  p.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => {
    const pick = $('#pin-pick'); if (!pick) return;
    pick.value = pick.value === b.dataset.pin ? '' : b.dataset.pin; pick.dispatchEvent(new Event('change'));
    bmClosePop();
  });
  p.querySelector('#bm-app-theme').onclick = () => {
    const to = dark ? 'light' : 'dark';
    if (window.gcTheme) window.gcTheme.set(to); else { const t = $('#theme-toggle'); if (t) t.click(); }
    bmOpenAppMenu();
  };
  p.querySelector('#bm-app-fs').onclick = () => { bmClosePop(); bmToggleFs(); };
  p.querySelector('#bm-app-out').onclick = () => { const o = $('#logout'); bmClosePop(); if (o) o.click(); };
  const first = p.querySelector('.bm-apptab.on') || p.querySelector('.bm-apptab'); if (first) first.focus({ preventScroll: true });
}
function bmToggleFs() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => toast('Full screen was blocked by the browser'));
}
function bmRenderFsBtn() {
  const b = $('#bm-fs'); if (!b) return;
  const on = !!document.fullscreenElement;
  b.innerHTML = ic(on ? 'minimize' : 'maximize'); b.dataset.tip = on ? 'Exit full screen' : 'Full screen'; b.setAttribute('aria-label', b.dataset.tip);
  b.classList.toggle('on', on);
}
document.addEventListener('fullscreenchange', () => { if (bmMounted()) { bmRenderFsBtn(); bmFitHeight(); } });
function bmOpenScenes() {
  const d = BM.doc, cur = BM.sceneId;
  const p = bmOpenPop('scenes', `<div class="bm-pop-head"><b>Scenes</b><span class="muted">${d.scenes.length}</span></div>
    <div class="bm-scene-list">${d.scenes.map(s => `<button class="bm-scene-row ${s.id === cur ? 'on' : ''}" data-sid="${s.id}"><span class="bm-scene-thumb" data-thumb="${s.id}"></span><span class="bm-grow">${esc(s.name || 'Untitled')}</span>${d.display.sceneId === s.id ? `<span class="bm-tag tv">${ic('cast')} TV</span>` : ''}${s.id === cur ? ic('check') : ''}</button>`).join('') || '<p class="muted" style="margin:6px 4px">No scenes yet.</p>'}</div>
    <div class="bm-pop-actions">
      <button class="btn small" id="bm-sc-new">${ic('plus')} New scene</button>
      ${cur ? `<button class="btn small" id="bm-sc-tv" ${d.display.sceneId === cur ? 'disabled' : ''}>${ic('cast')} Show on TV</button>
      <button class="btn small" id="bm-sc-ren">${ic('pencil')} Rename</button>
      <button class="btn small danger" id="bm-sc-del">${ic('trash')} Delete</button>` : ''}
    </div>`, 'bm-pop-scenes');
  p.querySelectorAll('[data-sid]').forEach(b => b.onclick = () => { bmClosePop(); if (b.dataset.sid !== BM.sceneId) bmSelectScene(b.dataset.sid); });
  p.querySelectorAll('[data-thumb]').forEach(el => bmThumb(el, d.scenes.find(s => s.id === el.dataset.thumb)));
  $('#bm-sc-new').onclick = () => bmOpenNewScene();
  if (cur) {
    $('#bm-sc-tv').onclick = () => { bmShowOnTv(cur); bmClosePop(); };
    $('#bm-sc-ren').onclick = () => {
      const sc = bmScene(), name = prompt('Scene name', sc.name || ''); if (name == null || !name.trim()) return;
      bmCommit('Rename scene', [{ coll: 'prop', id: 'name', before: sc.name, after: name.trim().slice(0, 80) }]); bmClosePop();
    };
    $('#bm-sc-del').onclick = () => {
      const sc = bmScene();
      if (!confirm(`Delete the scene “${sc.name}”? Its tokens, drawings and fog go with it (the image stays in the data repo).`)) return;
      bmClosePop();
      const i = BM.doc.scenes.indexOf(sc), changes = [{ coll: 'scenes', id: sc.id, before: bmClone(sc), after: null, index: i }];
      if (BM.doc.display.sceneId === sc.id) changes.push({ coll: 'display', id: 'sceneId', before: sc.id, after: null });
      bmCommit(`Delete scene ${sc.name}`, changes, { sid: sc.id });
      bmSelectScene(BM.doc.scenes[0] ? BM.doc.scenes[0].id : null);
      bmFlash('Scene deleted · ⌘Z to undo');
    };
  }
}
function bmShowOnTv(id) {
  const d = BM.doc; if (d.display.sceneId === id) return;
  bmCommit('Show scene on TV', [{ coll: 'display', id: 'sceneId', before: d.display.sceneId, after: id }], { undo: false });
  bmFlash('Now showing on the TV');
}
function bmThumb(el, sc) {
  if (!sc) return;
  const cv = document.createElement('canvas'), { w, h } = bsSceneSize(sc), k = 56 / Math.max(w, h);
  cv.width = Math.max(1, Math.round(w * k * 2)); cv.height = Math.max(1, Math.round(h * k * 2));
  el.appendChild(cv);
  const draw = () => {
    const x = cv.getContext('2d');
    const src = sc.bg ? (bsImage(sc.bg, draw) || {}).img : bsFloor(sc).mips.slice(-1)[0];
    if (src) x.drawImage(src, 0, 0, cv.width, cv.height); else { x.fillStyle = '#1b2030'; x.fillRect(0, 0, cv.width, cv.height); }
  };
  draw();
}
function bmNewSceneHTML(hero) {
  const maps = (RAW.maps || []).filter(m => m.type === 'image' && m.path);
  const n = (BM.doc.scenes.length || 0) + 1;
  return `${hero ? `<div class="bm-hero-head">${ic('swords')}<h2>Set the stage</h2><p>Start a battle map from your own image, a region map or a blank grid.</p></div>` : `<div class="bm-pop-head"><b>New scene</b><button class="bm-ib" id="bm-ns-x" aria-label="Close">${ic('x')}</button></div>`}
    <label class="bm-ns-name">Name <input id="bm-ns-name" value="Scene ${n}" maxlength="80" spellcheck="false"></label>
    <div class="bm-ns-grid">
      <div class="bm-ns-card bm-ns-drop" id="bm-ns-upload" tabindex="0" role="button" aria-label="Upload a battle map image">
        <div class="bm-ns-ico">${ic('upload')}</div><b>Upload a map</b><span>Drop an image here or browse. JPG, PNG or WebP up to 15 MB; big maps are scaled to 4096 px.</span>
      </div>
      <div class="bm-ns-card">
        <div class="bm-ns-ico">${ic('map')}</div><b>Use a region map</b>
        <div class="bm-ns-maps">${maps.map(m => `<button class="bm-ns-map" data-map="${esc(m.id)}"><span>${esc(m.name)}</span><small>${m.width || '?'}×${m.height || '?'}</small></button>`).join('') || '<span class="muted">No image maps in maps.json</span>'}</div>
      </div>
      <div class="bm-ns-card">
        <div class="bm-ns-ico">${ic('grid')}</div><b>Blank grid</b>
        <div class="bm-row bm-ns-dims"><input type="number" id="bm-ns-cols" min="4" max="80" value="24" aria-label="Columns"><span>×</span><input type="number" id="bm-ns-rows" min="4" max="80" value="16" aria-label="Rows"><span class="muted">squares</span></div>
        <div class="bm-ns-floors">${Object.entries(BS_FLOORS).map(([k, label], i) => `<button class="bm-ns-floor ${i === 0 ? 'on' : ''}" data-floor="${k}" title="${label}"><canvas data-fprev="${k}"></canvas><span>${label}</span></button>`).join('')}</div>
        <button class="btn primary small" id="bm-ns-blank">Create grid</button>
      </div>
    </div>`;
}
function bmWireNewScene(root) {
  const q = s => root.querySelector(s), name = () => (q('#bm-ns-name').value || '').trim().slice(0, 80) || 'Untitled scene';
  const up = q('#bm-ns-upload');
  up.onclick = () => bmPickFile(f => bmCreateFromFile(f, name()));
  up.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); up.click(); } };
  up.ondragover = e => { e.preventDefault(); up.classList.add('over'); };
  up.ondragleave = () => up.classList.remove('over');
  up.ondrop = e => { e.preventDefault(); e.stopPropagation(); up.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) bmCreateFromFile(f, name()); };
  root.querySelectorAll('[data-map]').forEach(b => b.onclick = () => {
    const m = (RAW.maps || []).find(x => x.id === b.dataset.map); if (!m) return;
    const nm = q('#bm-ns-name').value.trim() && !/^Scene \d+$/.test(q('#bm-ns-name').value.trim()) ? name() : m.name;
    const size = Math.max(24, Math.round(Math.max(m.width, m.height) / 40));
    bmCreateScene({ name: nm, bg: m.path, bgSize: { w: m.width, h: m.height }, grid: { size, offsetX: 0, offsetY: 0, show: false, opacity: 0.4 } });
  });
  let floor = 'flagstone';
  root.querySelectorAll('[data-floor]').forEach(b => b.onclick = () => { floor = b.dataset.floor; root.querySelectorAll('[data-floor]').forEach(x => x.classList.toggle('on', x === b)); });
  root.querySelectorAll('[data-fprev]').forEach(cv => {
    const fake = { id: 'preview-' + cv.dataset.fprev, floor: cv.dataset.fprev, cols: 4, rows: 3, grid: { size: 60 } };
    const src = bsFloor(fake).mips[0]; cv.width = 120; cv.height = 90; const x = cv.getContext('2d'); x.drawImage(src, 0, 0, 120, 90);
    x.strokeStyle = 'rgba(0,0,0,.4)'; x.lineWidth = 1; x.beginPath(); for (let i = 1; i < 4; i++) { x.moveTo(i * 30 + 0.5, 0); x.lineTo(i * 30 + 0.5, 90); } for (let i = 1; i < 3; i++) { x.moveTo(0, i * 30 + 0.5); x.lineTo(120, i * 30 + 0.5); } x.stroke();
  });
  q('#bm-ns-blank').onclick = () => {
    const cols = bsClamp(Math.round(Number(q('#bm-ns-cols').value) || 24), 4, 80), rows = bsClamp(Math.round(Number(q('#bm-ns-rows').value) || 16), 4, 80);
    bmCreateScene({ name: name(), bg: null, floor, cols, rows, grid: { size: 100, offsetX: 0, offsetY: 0, show: true, opacity: floor === 'flagstone' ? 0.3 : 0.55 } });
  };
  if (q('#bm-ns-x')) q('#bm-ns-x').onclick = () => bmClosePop();
}
function bmOpenNewScene() { const p = bmOpenPop('new', bmNewSceneHTML(false), 'bm-pop-new'); bmWireNewScene(p); setTimeout(() => { const n = p.querySelector('#bm-ns-name'); if (n) n.select(); }, 30); }
function bmRenderEmpty() { const el = $('#bm-empty'); el.innerHTML = `<div class="bm-hero bm-glass">${bmNewSceneHTML(true)}</div>`; bmWireNewScene(el); }
function bmPickFile(cb) { const f = $('#bm-file'); f.value = ''; f.onchange = () => f.files[0] && cb(f.files[0]); f.click(); }
function bmCreateScene(fields) {
  const sc = bmNorm({ scenes: [{ id: uid(), tokens: [], drawings: [], fog: { on: false, reveals: [] }, ...fields }] }).scenes[0];
  const changes = [{ coll: 'scenes', id: sc.id, before: null, after: sc }];
  if (!BM.doc.display.sceneId || !bmScene(BM.doc.display.sceneId)) changes.push({ coll: 'display', id: 'sceneId', before: BM.doc.display.sceneId, after: sc.id });
  bmCommit(`New scene ${sc.name}`, changes, { sid: sc.id });
  bmClosePop();
  bmSelectScene(sc.id);
  bmFlash(sc.bg && !sc.grid.show ? 'Scene created · turn the grid on and calibrate it from the grid button' : `Scene “${sc.name}” created`);
  return sc;
}
async function bmCreateFromFile(file, name) {
  if (!file || !/^image\//.test(file.type)) { toast('That is not an image'); return; }
  if (file.size > 15 * 1024 * 1024) { toast(`That image is ${(file.size / 1048576).toFixed(1)} MB; the limit is 15 MB`, 4000); return; }
  const busy = $('#bm-hint'); busy.textContent = 'Uploading the map…'; busy.classList.remove('hidden'); busy.classList.add('busy');
  try {
    const up = await uploadMedia(file, 'media/battle');
    // a battle map export is usually 50–200 px per square; guess, then the DM calibrates
    const guess = [70, 100, 140, 50, 128, 150, 200, 64].find(s => up.w % s === 0 && up.h % s === 0 && up.w / s >= 8 && up.w / s <= 60) || Math.round(Math.max(up.w, up.h) / 30);
    const nm = (name && !/^Scene \d+$/.test(name)) ? name : file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').slice(0, 80) || name;
    bmCreateScene({ name: nm, bg: up.path, bgSize: { w: up.w, h: up.h }, grid: { size: guess, offsetX: 0, offsetY: 0, show: true, opacity: 0.45 } });
    bmFlash('Map uploaded · check the grid lines up, or calibrate it (G)');
  } catch (e) { toast('Upload failed: ' + (e.message || e), 5000); }
  finally { busy.classList.remove('busy'); bmHint(); }
}

function bmOpenGrid() {
  const sc = bmScene(); if (!sc) return;
  BM.gridBefore = bmClone(sc.grid); BM.gridSid = sc.id;
  const g = sc.grid, { w } = bsSceneSize(sc), rule = bmPref('rule', '5'), img = !!sc.bg; // a blank scene's grid is its floor: no resizing
  const geo = html => (img ? html : '');
  const p = bmOpenPop('grid', `<div class="bm-pop-head"><b>${ic('grid')} Grid & scale</b><button class="bm-ib" id="bm-g-x" aria-label="Close">${ic('x')}</button></div>
    <label class="bm-switch"><input type="checkbox" id="bm-g-show" ${g.show ? 'checked' : ''}><span></span> Show grid</label>
    ${geo(`<div class="bm-slider"><label>Square</label><input type="range" id="bm-g-size" min="16" max="300" step="1" value="${Math.round(g.size)}"><input type="number" id="bm-g-size-n" value="${Math.round(g.size * 10) / 10}" step="0.5"><span>px</span></div>
    <div class="bm-slider"><label>Offset X</label><input type="range" id="bm-g-ox" min="0" max="${Math.round(g.size)}" step="0.5" value="${((g.offsetX % g.size) + g.size) % g.size}"><input type="number" id="bm-g-ox-n" value="${Math.round((((g.offsetX % g.size) + g.size) % g.size) * 10) / 10}" step="0.5"></div>
    <div class="bm-slider"><label>Offset Y</label><input type="range" id="bm-g-oy" min="0" max="${Math.round(g.size)}" step="0.5" value="${((g.offsetY % g.size) + g.size) % g.size}"><input type="number" id="bm-g-oy-n" value="${Math.round((((g.offsetY % g.size) + g.size) % g.size) * 10) / 10}" step="0.5"></div>`)}
    <div class="bm-slider"><label>Opacity</label><input type="range" id="bm-g-op" min="0" max="1" step="0.05" value="${g.opacity}"><span class="bm-val">${Math.round(g.opacity * 100)}%</span></div>
    ${geo(`<button class="btn small bm-wide" id="bm-g-cal">${ic('scan')} Calibrate: drag across one square</button>
    <div class="bm-row bm-g-across"><span>Map is</span><input type="number" id="bm-g-across" min="2" max="200" value="${Math.round(w / g.size * 10) / 10}" step="0.5"><span>squares wide</span></div>`)}
    <label>Diagonals</label>${bmSeg('grule', [['5', '5 ft each'], ['alt', '5 / 10 ft'], ['euclid', 'True']], rule)}
    <p class="bm-note">1 square = 5 ft.${img ? '' : ' A blank scene is sized in squares, so only the look of its grid changes here.'} Changes show live, on the TV too.</p>`, 'bm-pop-grid');
  bmAnchorPop(p, $('#bm-grid-btn'), 'left');
  // live edits go through the save queue (they survive the other DM's updates); one undo step when the panel closes
  const sid = sc.id, live = patch => {
    const cur = bmScene(sid); if (!cur) return;
    const next = { ...cur.grid, ...patch };
    bmQueue(doc => { const s2 = doc.scenes.find(x => x.id === sid); if (s2) s2.grid = bmClone(next); }, 'Grid');
    bmChanged(); bmRenderZoom();
  };
  const pair = (r, n, key) => {
    const R = p.querySelector(r), N = p.querySelector(n); if (!R) return;
    R.oninput = () => { N.value = R.value; live({ [key]: Number(R.value) }); if (key === 'size') { p.querySelector('#bm-g-ox').max = R.value; p.querySelector('#bm-g-oy').max = R.value; } };
    N.onchange = () => { const v = Number(N.value); if (Number.isFinite(v) && (key !== 'size' || v >= 8)) { R.value = v; live({ [key]: v }); } };
  };
  pair('#bm-g-size', '#bm-g-size-n', 'size'); pair('#bm-g-ox', '#bm-g-ox-n', 'offsetX'); pair('#bm-g-oy', '#bm-g-oy-n', 'offsetY');
  p.querySelector('#bm-g-op').oninput = e => { p.querySelector('.bm-val').textContent = Math.round(e.target.value * 100) + '%'; live({ opacity: Number(e.target.value) }); };
  p.querySelector('#bm-g-show').onchange = e => live({ show: e.target.checked });
  if (img) p.querySelector('#bm-g-across').onchange = e => { const n = Number(e.target.value); if (n >= 2) { const size = Math.round(w / n * 100) / 100; live({ size }); p.querySelector('#bm-g-size').value = size; p.querySelector('#bm-g-size-n').value = size; } };
  if (img) p.querySelector('#bm-g-cal').onclick = () => { bmClosePop(); bmSetTool('calibrate'); };
  p.querySelectorAll('[data-grule]').forEach(b => b.onclick = () => { bmSetPref('rule', b.dataset.grule); BM.view.rule = b.dataset.grule; p.querySelectorAll('[data-grule]').forEach(x => { x.classList.toggle('on', x === b); x.setAttribute('aria-checked', x === b); }); });
  p.querySelector('#bm-g-x').onclick = () => bmClosePop();
}
// the edits are already queued; this records them as a single undo step
function bmCommitGrid() {
  const sc = bmScene(BM.gridSid), before = BM.gridBefore; BM.gridBefore = null;
  if (!sc || !before || JSON.stringify(before) === JSON.stringify(sc.grid)) return;
  BM.undo.push({ label: 'Grid', sid: sc.id, changes: [{ coll: 'prop', id: 'grid', before, after: bmClone(sc.grid) }] }); BM.redo = [];
}
function bmOpenDisplayPop() {
  const d = BM.doc.display, sc = bmScene(), live = Date.now() - BM.displaySeen < 7000;
  const onTv = d.sceneId && bmScene(d.sceneId);
  const p = bmOpenPop('display', `<div class="bm-pop-head"><b>${ic('cast')} Player display</b><span class="bm-tag ${live ? 'ok' : ''}">${live ? 'Connected' : 'Not open'}</span></div>
    <button class="btn primary bm-wide" id="bm-d-open">${ic('cast')} ${live ? 'Bring the display forward' : 'Cast to the TV'}</button>
    <p class="bm-note">Opens a full-screen window for the second screen. It updates instantly from this tab.</p>
    <label>On the TV</label>
    <div class="bm-row"><span class="bm-grow bm-ellipsis">${onTv ? esc(onTv.name) : '<span class="muted">Nothing yet</span>'}</span>${sc && d.sceneId !== sc.id ? `<button class="btn small" id="bm-d-this">Show this scene</button>` : ''}</div>
    <label>TV camera</label>
    <div class="bm-radios">${[['dm', 'Follow my view', 'video'], ['fit', 'Fit the revealed area', 'scan'], ['locked', 'Locked', 'lock']].map(([k, label, icn]) => `<button class="bm-radio ${d.follow === k ? 'on' : ''}" data-follow="${k}">${ic(icn)}<span>${label}</span></button>`).join('')}</div>
    <button class="btn small bm-wide" id="bm-d-lock">${ic('lock')} Lock the TV to my current view</button>
    <label class="bm-switch"><input type="checkbox" id="bm-d-init" ${d.showInit !== false ? 'checked' : ''}><span></span> Initiative ribbon on the TV</label>`, 'bm-pop-display');
  bmAnchorPop(p, $('#bm-cast'));
  const setD = (k, v, label) => bmCommit(label, [{ coll: 'display', id: k, before: BM.doc.display[k], after: v }], { undo: false });
  p.querySelector('#bm-d-open').onclick = () => { bmClosePop(); bmOpenDisplay(); };
  if (p.querySelector('#bm-d-this')) p.querySelector('#bm-d-this').onclick = () => { bmShowOnTv(sc.id); bmOpenDisplayPop(); };
  p.querySelectorAll('[data-follow]').forEach(b => b.onclick = () => { setD('follow', b.dataset.follow, 'Display camera'); bmOpenDisplayPop(); });
  p.querySelector('#bm-d-lock').onclick = () => { if (!sc) return; setD('camera', { sceneId: sc.id, ...bmVisibleRect() }, 'Lock display camera'); setD('follow', 'locked', 'Display camera'); bmFlash('TV locked to this view'); bmOpenDisplayPop(); };
  p.querySelector('#bm-d-init').onchange = e => setD('showInit', e.target.checked, 'Display initiative');
}
function bmOpenNewToken() {
  const chars = RAW.characters || [];
  const p = bmOpenPop('token', `<div class="bm-pop-head"><b>${ic('plus')} Add a token</b><button class="bm-ib" id="bm-t-x" aria-label="Close">${ic('x')}</button></div>
    <label>Name</label><input id="bm-t-name" placeholder="Cart, Statue, Mysterious stranger…" maxlength="60" spellcheck="false">
    <label>Or a party member</label><select id="bm-t-char"><option value="">—</option>${chars.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>
    <label>Side</label><div class="bm-seg bm-kinds">${Object.entries(BS_KINDS).map(([k, x]) => `<button class="${k === 'neutral' ? 'on' : ''}" data-tkind="${k}" style="--c:${x.ring}"><i></i>${x.label}</button>`).join('')}</div>
    <label>Size</label><div class="bm-seg">${BS_SIZES.map(([n, name, s]) => `<button class="${n === 1 ? 'on' : ''}" data-tsize="${n}" title="${name}">${s}</button>`).join('')}</div>
    <div class="bm-row bm-insp-foot"><button class="btn primary small" id="bm-t-add">Place token</button></div>`, 'bm-pop-token');
  bmAnchorPop(p, $('#bm-add-tok'), 'left');
  let kind = 'neutral', size = 1;
  p.querySelectorAll('[data-tkind]').forEach(b => b.onclick = () => { kind = b.dataset.tkind; p.querySelectorAll('[data-tkind]').forEach(x => x.classList.toggle('on', x === b)); });
  p.querySelectorAll('[data-tsize]').forEach(b => b.onclick = () => { size = Number(b.dataset.tsize); p.querySelectorAll('[data-tsize]').forEach(x => x.classList.toggle('on', x === b)); });
  p.querySelector('#bm-t-char').onchange = e => { const c = chars.find(x => x.id === e.target.value); if (c) { p.querySelector('#bm-t-name').value = c.name; kind = 'pc'; p.querySelectorAll('[data-tkind]').forEach(x => x.classList.toggle('on', x.dataset.tkind === 'pc')); } };
  p.querySelector('#bm-t-x').onclick = () => bmClosePop();
  const add = () => {
    const sc = bmScene(), name = p.querySelector('#bm-t-name').value.trim(); if (!name) { p.querySelector('#bm-t-name').focus(); return; }
    const chId = p.querySelector('#bm-t-char').value || null;
    const t = { id: uid(), name, x: 0, y: 0, size, kind, img: null, characterId: chId, combatantId: null, hidden: false };
    [t.x, t.y] = bmFreeSpot(sc, ...bmViewCenter(), size);
    bmCommit(`Add ${name}`, [{ coll: 'tokens', id: t.id, before: null, after: t }]);
    BM.view.sel = new Set([t.id]); bmClosePop(); bmRenderInspector();
  };
  p.querySelector('#bm-t-add').onclick = add;
  p.querySelector('#bm-t-name').onkeydown = e => { if (e.key === 'Enter') add(); };
  setTimeout(() => { const n = p.querySelector('#bm-t-name'); if (n) n.focus(); }, 30); // the popover may already be closed
}

// ---------- pointer, wheel and keyboard ----------
function bmBind() {
  const st = BM.stage;
  st.addEventListener('pointerdown', bmDown);
  st.addEventListener('pointermove', bmMove);
  st.addEventListener('pointerup', bmUp);
  st.addEventListener('pointercancel', bmUp);
  st.addEventListener('pointerleave', () => { if (BM.view && BM.view.hover) { BM.view.hover = null; BM.view.request(); } });
  st.addEventListener('wheel', bmWheel, { passive: false });
  st.addEventListener('dblclick', e => { if (BM.tool === 'fog' && BM.fogPoly) { e.preventDefault(); bmFogPolyClose(); } });
  st.addEventListener('contextmenu', e => e.preventDefault());
  $('#bm-scene-btn').onclick = () => (BM.pop === 'scenes' ? bmClosePop() : bmOpenScenes());
  $('#bm-cast').onclick = () => (BM.pop === 'display' ? bmClosePop() : bmOpenDisplayPop());
  $('#bm-app').onclick = () => (BM.pop === 'app' ? bmClosePop() : bmOpenAppMenu());
  $('#bm-fs').onclick = () => bmToggleFs();
  bmRenderFsBtn(); bmTips();
  // drop an image anywhere on the map to start a scene
  const drop = $('#bm-drop'), root = BM.root; let depth = 0;
  const hasFile = e => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
  root.addEventListener('dragenter', e => { if (!hasFile(e)) return; e.preventDefault(); depth++; drop.classList.remove('hidden'); });
  root.addEventListener('dragover', e => { if (hasFile(e)) e.preventDefault(); });
  root.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) drop.classList.add('hidden'); });
  root.addEventListener('drop', e => { if (!hasFile(e)) return; e.preventDefault(); depth = 0; drop.classList.add('hidden'); const f = e.dataTransfer.files[0]; if (f) bmCreateFromFile(f, ''); });
  root.addEventListener('pointerdown', e => { if (BM.pop && !e.target.closest('#bm-pop, #bm-scene-btn, #bm-cast, #bm-grid-btn, #bm-add-tok, #bm-app')) bmClosePop(); }, true);
}
const bmLocal = e => { const r = BM.stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
function bmDown(e) {
  const v = BM.view, sc = bmScene(); if (!v || !sc) return;
  if (document.activeElement && document.activeElement !== document.body && BM.root.contains(document.activeElement)) document.activeElement.blur();
  try { BM.stage.setPointerCapture(e.pointerId); } catch (_) { /* pointer already gone */ }
  const p = bmLocal(e); BM.pointers.set(e.pointerId, p);
  if (BM.pointers.size === 2) { bmCancelAct(); const [a, b] = [...BM.pointers.values()], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; BM.pinch = { d0: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, z0: v.cam.z, s0: v.toScene(m[0], m[1]) }; BM.zoomAnim = BM.camAnim = null; return; }
  if (BM.pointers.size > 2) return;
  const sp = v.toScene(p[0], p[1]), tool = BM.tool;
  BM.down = { p, moved: false };
  if (e.button === 1 || e.button === 2 || BM.space || tool === 'pan') { BM.act = { type: 'pan', p, cam: { ...v.cam } }; BM.zoomAnim = BM.camAnim = null; BM.stage.classList.add('panning'); return; }
  if (e.altKey && tool !== 'draw' && tool !== 'template' && tool !== 'fog') { BM.act = { type: 'altping', p, cam: { ...v.cam } }; return; }
  if (tool === 'select') {
    const sd = v.selDrawing;
    if (sd && sd.type === 'template') { const g = bsTpl(sc, sd), [ex, ey] = v.toScreen(g.e[0], g.e[1]); if (Math.hypot(p[0] - ex, p[1] - ey) <= 14) { BM.act = { type: 'tpl-end', id: sd.id, before: bmClone(sd.pts) }; return; } }
    const t = v.hitToken(p[0], p[1]);
    if (t) {
      if (e.shiftKey) { if (v.sel.has(t.id)) v.sel.delete(t.id); else v.sel.add(t.id); v.selDrawing = null; bmRenderInspector(); v.request(); return; }
      if (!v.sel.has(t.id)) { v.sel = new Set([t.id]); v.selDrawing = null; bmRenderInspector(); }
      const ids = [...v.sel].filter(id => sc.tokens.some(x => x.id === id));
      BM.act = { type: 'drag', lead: t.id, ids, from: new Map(ids.map(id => { const x = sc.tokens.find(k => k.id === id); return [id, [x.x, x.y]]; })), grab: sp, started: false };
      v.request(); return;
    }
    const d = v.hitDrawing(p[0], p[1]);
    if (d && !e.shiftKey) {
      v.sel.clear(); v.selDrawing = d; bmRenderInspector(); v.request();
      BM.act = { type: 'shape-move', id: d.id, before: bmClone(d.pts), grab: sp };
      return;
    }
    if (e.shiftKey) { BM.act = { type: 'marquee', a: sp }; return; }
    BM.act = { type: 'pan', p, cam: { ...v.cam }, clear: true }; BM.zoomAnim = BM.camAnim = null; return;
  }
  if (tool === 'ruler') { const a = bsCellCenter(sc, sp[0], sp[1]); v.live.ruler = { a, b: a }; BM.act = { type: 'ruler' }; clearTimeout(bmUp.rulerT); v.request(); bmPostLive(); return; }
  if (tool === 'draw') {
    const shape = bmPref('drawShape', 'path'), s = bsGrid(sc).size;
    const d = { id: uid(), type: shape, pts: shape === 'path' ? [sp] : [sp, sp], color: bmPref('drawColor', BM_COLORS[0]), width: Math.max(1, Math.round(s * BM_WIDTHS[bmPref('drawWidth', 'med')] * 10) / 10), dmOnly: !!bmPref('drawDm', false) };
    if (bmPref('drawFill', false) && (shape === 'rect' || shape === 'circle')) d.fill = true;
    BM.act = { type: 'draw', d }; v.live.previews = [d]; v.request(); return;
  }
  if (tool === 'template') { const o = e.altKey ? sp : bsSnapVertex(sc, sp[0], sp[1]); BM.act = { type: 'tpl', o, d: { id: uid(), type: 'template', shape: bmPref('tplShape', 'circle'), color: bmPref('tplColor', BM_TPL_COLORS[0][0]), pts: [o, o] } }; return; }
  if (tool === 'fog') { BM.act = bmPref('fogShape', 'rect') === 'rect' ? { type: 'fog-rect', a: sp } : { type: 'fog-poly', p, cam: { ...v.cam } }; return; }
  if (tool === 'ping') { bmPing(sp); return; }
  if (tool === 'eraser') { BM.act = { type: 'erase', changes: [] }; bmEraseAt(p); return; }
  if (tool === 'calibrate') { BM.act = { type: 'calib', a: sp }; v.live.calib = { a: sp, b: sp }; v.request(); }
}
function bmCancelAct() {
  const v = BM.view, a = BM.act; BM.act = null;
  if (!v) return;
  if (a && (a.type === 'shape-move' || a.type === 'tpl-end')) { const d = bmDrawing(a.id); if (d) { d.pts = a.before; v.setScene(bmScene()); } }
  v.live.drag = null; v.live.marquee = null; v.live.previews = []; v.live.calib = null;
  if (bmPref('fogShape', 'rect') === 'rect') v.live.fogDraft = null;
  BM.stage.classList.remove('panning');
  v.request(); bmPostLive();
}
function bmSnapLen(sc, o, sp, free) {
  const s = bsGrid(sc).size, L = Math.hypot(sp[0] - o[0], sp[1] - o[1]); if (L < 1) return [o[0] + s, o[1]];
  const Ls = free ? L : Math.max(1, Math.round(L / s)) * s;
  return [o[0] + (sp[0] - o[0]) / L * Ls, o[1] + (sp[1] - o[1]) / L * Ls];
}
function bmMove(e) {
  const v = BM.view; if (!v) return;
  const p = bmLocal(e);
  if (BM.pointers.has(e.pointerId)) BM.pointers.set(e.pointerId, p);
  if (BM.pinch) {
    if (BM.pointers.size < 2) return;
    const [a, b] = [...BM.pointers.values()], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], [lo, hi] = bmZoomLimits();
    const z = bsClamp(BM.pinch.z0 * Math.hypot(a[0] - b[0], a[1] - b[1]) / BM.pinch.d0, lo, hi);
    v.setCam({ z, x: m[0] - BM.pinch.s0[0] * z, y: m[1] - BM.pinch.s0[1] * z }); return;
  }
  const sc = bmScene(); if (!sc) return;
  const a = BM.act, sp = v.toScene(p[0], p[1]);
  if (!a) {
    if (BM.tool === 'fog' && BM.fogPoly) { v.live.fogDraft = { pts: BM.fogPoly.pts, cursor: sp, hide: BM.fogPoly.hide }; v.request(); }
    if (e.pointerType === 'mouse' && BM.tool === 'select' && !BM.space) {
      const t = v.hitToken(p[0], p[1]), id = t ? t.id : null;
      BM.stage.classList.toggle('over-token', !!t || !!v.hitDrawing(p[0], p[1]));
      if (id !== v.hover) { v.hover = id; v.request(); }
    }
    return;
  }
  if (BM.down && !BM.down.moved && Math.hypot(p[0] - BM.down.p[0], p[1] - BM.down.p[1]) > 4) BM.down.moved = true;
  const moved = BM.down && BM.down.moved;
  if (moved && (a.type === 'altping' || a.type === 'fog-poly')) a.type = 'pan'; // a drag with these pans instead
  switch (a.type) {
    case 'pan': if (!moved) break; BM.stage.classList.add('panning'); v.setCam({ z: a.cam.z, x: a.cam.x + p[0] - a.p[0], y: a.cam.y + p[1] - a.p[1] }); break;
    case 'drag': {
      if (!moved) break;
      a.started = true; BM.stage.classList.add('dragging');
      const dx = sp[0] - a.grab[0], dy = sp[1] - a.grab[1], pos = new Map(), snap = e.altKey ? null : new Map();
      for (const [id, f] of a.from) { const q = [f[0] + dx, f[1] + dy]; pos.set(id, q); if (snap) { const t = sc.tokens.find(x => x.id === id); snap.set(id, bsSnapCenter(sc, q[0], q[1], t ? t.size : 1)); } }
      v.live.drag = { lead: a.lead, pos, from: a.from, snap }; bmPostLive(); break;
    }
    case 'marquee': v.live.marquee = { x: Math.min(a.a[0], sp[0]), y: Math.min(a.a[1], sp[1]), w: Math.abs(sp[0] - a.a[0]), h: Math.abs(sp[1] - a.a[1]) }; break;
    case 'ruler': v.live.ruler.b = e.altKey ? sp : bsCellCenter(sc, sp[0], sp[1]); bmPostLive(); break;
    case 'draw': {
      const d = a.d;
      if (d.type === 'path') { const l = d.pts[d.pts.length - 1]; if (Math.hypot(sp[0] - l[0], sp[1] - l[1]) * v.cam.z > 2) d.pts.push(sp); }
      else if (e.shiftKey && d.type === 'line') { const o = d.pts[0], ang = Math.round(Math.atan2(sp[1] - o[1], sp[0] - o[0]) / (Math.PI / 4)) * Math.PI / 4, L = Math.hypot(sp[0] - o[0], sp[1] - o[1]); d.pts[1] = [o[0] + Math.cos(ang) * L, o[1] + Math.sin(ang) * L]; }
      else if (e.shiftKey && d.type === 'rect') { const o = d.pts[0], m = Math.max(Math.abs(sp[0] - o[0]), Math.abs(sp[1] - o[1])); d.pts[1] = [o[0] + Math.sign(sp[0] - o[0]) * m, o[1] + Math.sign(sp[1] - o[1]) * m]; }
      else d.pts[1] = sp;
      bmPostLive(); break;
    }
    case 'tpl': if (!moved) break; a.d.pts = [a.o, bmSnapLen(sc, a.o, sp, e.altKey)]; v.live.previews = [a.d]; bmPostLive(); break;
    case 'tpl-end': { const d = bmDrawing(a.id); if (!d) break; d.pts = [d.pts[0], bmSnapLen(sc, d.pts[0], sp, e.altKey)]; v.setScene(sc); bmPostDoc(); break; }
    case 'shape-move': {
      if (!moved) break;
      const d = bmDrawing(a.id); if (!d) break;
      let dx = sp[0] - a.grab[0], dy = sp[1] - a.grab[1];
      if (d.type === 'template' && !e.altKey) { const o = bsSnapVertex(sc, a.before[0][0] + dx, a.before[0][1] + dy); dx = o[0] - a.before[0][0]; dy = o[1] - a.before[0][1]; }
      d.pts = a.before.map(q => [q[0] + dx, q[1] + dy]); v.setScene(sc); bmPostDoc(); BM.stage.classList.add('dragging'); break;
    }
    case 'fog-rect': { const r = [Math.min(a.a[0], sp[0]), Math.min(a.a[1], sp[1]), Math.max(a.a[0], sp[0]), Math.max(a.a[1], sp[1])]; v.live.fogDraft = { pts: [[r[0], r[1]], [r[2], r[1]], [r[2], r[3]], [r[0], r[3]]], closed: true, hide: bmPref('fogMode', 'reveal') === 'hide' }; break; }
    case 'erase': bmEraseAt(p); break;
    case 'calib': v.live.calib = { a: a.a, b: sp }; break;
  }
  v.request();
}
function bmUp(e) {
  BM.pointers.delete(e.pointerId);
  if (BM.pinch) { if (BM.pointers.size < 2) BM.pinch = null; return; }
  const a = BM.act, v = BM.view; BM.act = null;
  BM.stage.classList.remove('panning', 'dragging');
  if (!a || !v) return;
  const sc = bmScene(); if (!sc) return;
  const p = bmLocal(e), sp = v.toScene(p[0], p[1]), moved = BM.down && BM.down.moved, cancelled = e.type === 'pointercancel';
  switch (a.type) {
    case 'pan': if (a.clear && !moved) { v.sel.clear(); v.selDrawing = null; bmRenderInspector(); } break;
    case 'altping': if (!moved && !cancelled) bmPing(sp); break;
    case 'drag': {
      if (!a.started || !v.live.drag) { v.live.drag = null; break; }
      const L = v.live.drag; v.live.drag = null;
      if (cancelled) break;
      const changes = [];
      for (const id of a.ids) {
        const to = (L.snap ? L.snap.get(id) : L.pos.get(id)) || L.pos.get(id), from = a.from.get(id);
        if (to && from && (Math.abs(to[0] - from[0]) > 0.01 || Math.abs(to[1] - from[1]) > 0.01)) changes.push({ coll: 'tokens', id, before: { x: from[0], y: from[1] }, after: { x: Math.round(to[0] * 100) / 100, y: Math.round(to[1] * 100) / 100 }, patch: true });
      }
      const lead = sc.tokens.find(t => t.id === a.lead);
      if (changes.length) bmCommit(changes.length > 1 ? `Move ${changes.length} tokens` : `Move ${lead ? lead.name : 'token'}`, changes);
      else v.request();
      break;
    }
    case 'marquee': { const m = v.live.marquee; v.live.marquee = null; if (m) { v.sel = new Set(v.tokensIn(m).map(t => t.id)); v.selDrawing = null; bmRenderInspector(); } break; }
    case 'ruler': bmUp.rulerT = setTimeout(() => { if (!BM.view) return; BM.view.live.ruler = null; BM.view.request(); bmPostLive(); }, 1600); break;
    case 'draw': {
      const d = a.d; v.live.previews = [];
      if (cancelled) break;
      if (d.type === 'path') { d.pts = bsSimplify(d.pts, 1.2 / v.cam.z).map(q => [Math.round(q[0] * 10) / 10, Math.round(q[1] * 10) / 10]); }
      const len = d.pts.length > 1 ? Math.hypot(d.pts[d.pts.length - 1][0] - d.pts[0][0], d.pts[d.pts.length - 1][1] - d.pts[0][1]) : 0;
      if (d.type !== 'path' && len * v.cam.z < 4) break;
      bmCommit({ path: 'Draw', line: 'Line', rect: 'Rectangle', circle: 'Circle' }[d.type], [{ coll: 'drawings', id: d.id, before: null, after: d }]);
      break;
    }
    case 'tpl': {
      v.live.previews = [];
      if (cancelled) break;
      const d = a.d;
      if (!moved) { const s = bsGrid(sc).size; d.pts = [a.o, [a.o[0] + bmPref('tplFt', 20) / 5 * s, a.o[1]]]; }
      bmCommit(`${bsTpl(sc, d).ft} ft ${BS_TPL_NAMES[d.shape]}`, [{ coll: 'drawings', id: d.id, before: null, after: d }]);
      v.selDrawing = bmDrawing(d.id); bmRenderInspector();
      break;
    }
    case 'tpl-end': case 'shape-move': {
      const d = bmDrawing(a.id); if (!d) break;
      if (cancelled || !(a.type === 'tpl-end' || moved)) { d.pts = a.before; v.setScene(sc); break; }
      const after = bmClone(d.pts); d.pts = a.before;
      bmCommit(a.type === 'tpl-end' ? 'Aim template' : d.type === 'template' ? 'Move template' : 'Move drawing', [{ coll: 'drawings', id: d.id, before: { pts: a.before }, after: { pts: after }, patch: true }]);
      v.selDrawing = bmDrawing(d.id);
      break;
    }
    case 'fog-rect': {
      const fd = v.live.fogDraft; v.live.fogDraft = null;
      if (cancelled || !fd) break;
      const r = fd.pts; if (Math.abs(r[2][0] - r[0][0]) * v.cam.z < 6 || Math.abs(r[2][1] - r[0][1]) * v.cam.z < 6) break;
      bmFogAdd(r.map(q => [Math.round(q[0]), Math.round(q[1])]), fd.hide);
      break;
    }
    case 'fog-poly': {
      if (moved || cancelled) break;
      const hide = bmPref('fogMode', 'reveal') === 'hide';
      if (!BM.fogPoly) BM.fogPoly = { pts: [], hide };
      const f = BM.fogPoly, first = f.pts[0];
      if (first && f.pts.length >= 3) { const [X, Y] = v.toScreen(first[0], first[1]); if (Math.hypot(X - p[0], Y - p[1]) <= 10) { bmFogPolyClose(); break; } }
      f.pts.push([Math.round(sp[0]), Math.round(sp[1])]);
      v.live.fogDraft = { pts: f.pts, cursor: sp, hide: f.hide }; bmHint();
      break;
    }
    case 'erase': if (a.changes.length) { BM.undo.push({ label: 'Erase', sid: BM.sceneId, changes: a.changes }); BM.redo = []; bmRenderToolsState(); } break;
    case 'calib': {
      v.live.calib = null;
      const size = Math.max(Math.abs(sp[0] - a.a[0]), Math.abs(sp[1] - a.a[1]));
      if (size * v.cam.z < 6 || cancelled) { bmFlash('Drag across one whole square'); break; }
      const x0 = Math.min(a.a[0], sp[0]), y0 = Math.min(a.a[1], sp[1]);
      const g = { ...sc.grid, size: Math.round(size * 100) / 100, offsetX: Math.round((((x0 % size) + size) % size) * 100) / 100, offsetY: Math.round((((y0 % size) + size) % size) * 100) / 100, show: true };
      bmCommit('Calibrate grid', [{ coll: 'prop', id: 'grid', before: bmClone(sc.grid), after: g }]);
      bmSetTool(BM.prevTool && BM.prevTool !== 'calibrate' ? BM.prevTool : 'select');
      bmFlash(`Grid set: one square is ${Math.round(size)} px`);
      break;
    }
  }
  v.request(); bmPostLive();
}
function bmFogAdd(pts, hide) {
  const sc = bmScene(), r = { id: uid(), pts }; if (hide) r.hide = true;
  const changes = [{ coll: 'reveals', id: r.id, before: null, after: r }];
  if (!sc.fog.on) changes.unshift({ coll: 'prop', id: 'fog.on', before: false, after: true });
  bmCommit(hide ? 'Hide area' : 'Reveal area', changes);
  if (changes.length > 1) bmRenderFlyout();
}
function bmFogPolyClose() {
  const f = BM.fogPoly; BM.fogPoly = null; BM.view.live.fogDraft = null; bmHint();
  if (f && f.pts.length >= 3) bmFogAdd(f.pts, f.hide);
  BM.view.request();
}
function bmEraseAt(p) {
  const v = BM.view, d = v.hitDrawing(p[0], p[1]), a = BM.act; if (!d || !a) return;
  const sc = bmScene(), i = sc.drawings.findIndex(x => x.id === d.id);
  const ch = { coll: 'drawings', id: d.id, before: bmClone(d), after: null, index: i };
  a.changes.push(ch);
  if (v.selDrawing && v.selDrawing.id === d.id) { v.selDrawing = null; bmRenderInspector(); }
  bmCommit('Erase', [ch], { undo: false });
}
function bmPing(sp) {
  BM.view.ping(sp[0], sp[1], '#f2c15e');
  bmPost({ t: 'ping', sceneId: BM.sceneId, x: sp[0], y: sp[1], color: '#f2c15e' });
}
function bmWheel(e) {
  const v = BM.view; if (!v || !bmScene()) return;
  e.preventDefault();
  const p = bmLocal(e);
  if (e.ctrlKey) { bmZoomAt(p, Math.exp(-bsClamp(e.deltaY, -50, 50) * 0.012)); return; } // trackpad pinch
  const dy = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  const [lo, hi] = bmZoomLimits(), base = BM.zoomAnim ? BM.zoomAnim.target : v.cam.z;
  BM.camAnim = null;
  BM.zoomAnim = { target: bsClamp(base * Math.exp(-bsClamp(dy, -150, 150) * 0.0021), lo, hi), p, s: BM.zoomAnim && Math.hypot(BM.zoomAnim.p[0] - p[0], BM.zoomAnim.p[1] - p[1]) < 2 ? BM.zoomAnim.s : v.toScene(p[0], p[1]) };
  v.request();
}
document.addEventListener('keydown', e => {
  if (!bmMounted() || !BM.view) return;
  const tag = (e.target && e.target.tagName || '').toUpperCase(), typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag) || (e.target && e.target.isContentEditable);
  if (typing) return;
  const k = e.key, lk = k.length === 1 ? k.toLowerCase() : k, mod = e.metaKey || e.ctrlKey, v = BM.view;
  if (mod && lk === 'z') { e.preventDefault(); bmUndoRedo(e.shiftKey); return; }
  if (mod && lk === 'y') { e.preventDefault(); bmUndoRedo(true); return; }
  if (mod || e.altKey) return;
  if (k === ' ') { e.preventDefault(); if (!BM.space) { BM.space = true; BM.stage.classList.add('space'); } return; }
  if (k === 'Escape') {
    if (BM.pop) { bmClosePop(); return; }
    if (BM.fogPoly) { BM.fogPoly = null; v.live.fogDraft = null; bmHint(); v.request(); return; }
    if (BM.act) { bmCancelAct(); return; }
    if (BM.tool === 'calibrate') { bmSetTool(BM.prevTool || 'select'); return; }
    if (v.sel.size || v.selDrawing) { v.sel.clear(); v.selDrawing = null; bmRenderInspector(); v.request(); }
    return;
  }
  if (k === 'Enter' && BM.fogPoly) { e.preventDefault(); bmFogPolyClose(); return; }
  if (k === '\\') { e.preventDefault(); bmToggleFs(); return; }
  if (!bmScene()) return;
  if (k === 'Delete' || k === 'Backspace') { if (v.sel.size || v.selDrawing) { e.preventDefault(); bmDeleteSelection(); } return; }
  if (k.startsWith('Arrow') && v.sel.size) {
    e.preventDefault();
    const sc = bmScene(), s = bsGrid(sc).size * (e.shiftKey ? 5 : 1), d = { ArrowLeft: [-s, 0], ArrowRight: [s, 0], ArrowUp: [0, -s], ArrowDown: [0, s] }[k];
    const toks = [...v.sel].map(id => sc.tokens.find(t => t.id === id)).filter(Boolean);
    bmCommit('Nudge', toks.map(t => ({ coll: 'tokens', id: t.id, before: { x: t.x, y: t.y }, after: { x: t.x + d[0], y: t.y + d[1] }, patch: true })));
    return;
  }
  if ((lk === '[' || lk === ']') && v.selDrawing && v.selDrawing.type === 'template') { bmRotateTpl(lk === '[' ? -15 : 15); return; }
  const tool = BM_TOOLS.find(t => t.key === lk);
  if (tool) { e.preventDefault(); bmSetTool(tool.id); return; }
  if (lk === 'g') { e.preventDefault(); BM.pop === 'grid' ? bmClosePop() : bmOpenGrid(); return; }
  if (lk === 'a') { e.preventDefault(); BM.pop === 'token' ? bmClosePop() : bmOpenNewToken(); return; }
  if (lk === 'l') { e.preventDefault(); bmToggleLabels(); return; }
  if (lk === 'n' && !$('#b-next')) { e.preventDefault(); bmTurn(1); return; }
  if (lk === '+' || lk === '=') { bmZoomBy(1.35); return; }
  if (lk === '-' || lk === '_') { bmZoomBy(1 / 1.35); return; }
  if (lk === '0' || e.code === 'Digit0') { bmFit(true, e.shiftKey); } // 0 fits the action, Shift-0 the whole map
});

// tooltips: the name and its shortcut, beside the rail, above the bottom bar, below everything else
function bmTips() {
  const root = BM.root, tip = document.createElement('div');
  tip.className = 'bm-tip'; tip.setAttribute('role', 'tooltip'); root.appendChild(tip);
  let timer = 0, cur = null, lastShown = 0;
  const hide = () => { clearTimeout(timer); if (tip.classList.contains('show')) lastShown = performance.now(); cur = null; tip.classList.remove('show'); };
  const show = el => {
    if (!el.isConnected || !el.dataset.tip) return;
    tip.innerHTML = `<span>${esc(el.dataset.tip)}</span>${el.dataset.key ? `<kbd>${esc(el.dataset.key)}</kbd>` : ''}`;
    const side = el.closest('.bm-tools') ? 'left' : el.closest('.bm-bottom') ? 'top' : 'bottom';
    const r = el.getBoundingClientRect(), R = root.getBoundingClientRect();
    tip.dataset.side = side; tip.classList.add('show');
    const w = tip.offsetWidth, h = tip.offsetHeight;
    const x = side === 'left' ? r.left - R.left - w - 10 : r.left - R.left + r.width / 2 - w / 2;
    const y = side === 'left' ? r.top - R.top + r.height / 2 - h / 2 : side === 'top' ? r.top - R.top - h - 10 : r.bottom - R.top + 10;
    tip.style.left = bsClamp(x, 8, R.width - w - 8) + 'px'; tip.style.top = bsClamp(y, 8, R.height - h - 8) + 'px';
  };
  root.addEventListener('pointerover', e => {
    if (e.pointerType === 'touch') return;
    const el = e.target.closest && e.target.closest('[data-tip]');
    if (el === cur) return;
    hide(); if (!el || !root.contains(el)) return;
    cur = el; timer = setTimeout(() => show(el), performance.now() - lastShown < 400 ? 0 : 380); // sweeping along the rail shows each at once
  });
  root.addEventListener('pointerout', e => { if (cur && !(e.relatedTarget && cur.contains(e.relatedTarget))) hide(); });
  root.addEventListener('pointerdown', () => { hide(); lastShown = 0; }, true);
  root.addEventListener('focusin', e => { const el = e.target.closest && e.target.closest('[data-tip]'); if (el && el.matches(':focus-visible')) { hide(); cur = el; show(el); } });
  root.addEventListener('focusout', hide);
}
document.addEventListener('keyup', e => { if (e.key === ' ' && BM.space) { BM.space = false; if (BM.stage) BM.stage.classList.remove('space'); } });
window.addEventListener('blur', () => { if (BM.space) { BM.space = false; if (BM.stage) BM.stage.classList.remove('space'); } });
