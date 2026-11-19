/* display.js — the player display: a chromeless, player-safe view of the battle map for the TV.
   Opened from the DM's Battle map tab (same origin, so it reuses the logged-in session). Instant
   updates arrive over BroadcastChannel('gc-battle') from the DM tab on this machine; when no DM tab
   is talking it falls back to gh.js polling (the other DM's changes, or a display on its own).
   Never shows hidden tokens, DM-only drawings or HP numbers; fog is solid darkness. */
'use strict';

const S = { me: null, cache: {}, tab: 'display' }; // gh.js only forwards live changes once a user is logged in
const DP = { view: null, battle: null, enc: null, sceneId: null, camRect: null, lastBc: 0, bcVisible: false, snap: true, titleT: 0, chipT: 0, idleT: 0, fsT: 0, edge: null,
  k: 1, anim: null, goal: null, follow: null, size: '' };
const DP_FOG = '#08090B'; // the darkness: under the fog, beyond the map, behind everything (display.css matches it)
DP.reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
const DP_EMBED = /[?&]embed=1/.test(location.search); // inside a player's Battle map tab: no full-screen hints
const dp$ = id => document.getElementById(id);
const dpEsc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dpBcAlive = () => Date.now() - DP.lastBc < 6500 && DP.bcVisible;

function dpNorm(b) {
  b = b && typeof b === 'object' && !Array.isArray(b) ? structuredClone(b) : {};
  b.scenes = Array.isArray(b.scenes) ? b.scenes : [];
  b.display = Object.assign({ sceneId: null, follow: 'dm', camera: null, showInit: true }, b.display || {});
  for (const s of b.scenes) { s.tokens = s.tokens || []; s.drawings = s.drawings || []; s.fog = s.fog || { on: false, reveals: [] }; s.fog.reveals = s.fog.reveals || []; }
  return b;
}
function dpMsg(html) { const m = dp$('dp-msg'); m.innerHTML = html; m.classList.toggle('hidden', !html); }

function dpApplyBattle(b) {
  DP.battle = dpNorm(b);
  const sc = DP.battle.scenes.find(s => s.id === DP.battle.display.sceneId) || null;
  if (!sc) {
    DP.sceneId = null; DP.view.setScene(null);
    dpMsg(`<div class="dp-wait"><div class="dp-sigil"></div><b>The table is set</b><span>Waiting for the Dungeon Master to choose a scene…</span></div>`);
    dpRenderInit(); return;
  }
  dpMsg('');
  if (sc.id !== DP.sceneId) {
    const first = DP.sceneId === null && !DP.view.scene;
    DP.sceneId = sc.id; DP.camRect = null; DP.follow = null;
    const swap = () => { DP.view.setScene(sc); DP.snap = first ? true : 'settle'; DP.view.request(); dp$('dp-stage').classList.remove('fade'); dpTitle(sc.name); };
    if (first) swap(); else { dp$('dp-stage').classList.add('fade'); setTimeout(swap, 380); }
  } else DP.view.setScene(sc);
  DP.view.request();
  dpRenderInit();
}
function dpApplyEnc(enc) { DP.enc = structuredClone(enc || { round: 1, turn: 0, combatants: [] }); DP.view.setEncounter(DP.enc); dpRenderInit(); }

function dpTitle(name) {
  const t = dp$('dp-title');
  t.innerHTML = `<i></i><b>${dpEsc(name || '')}</b><i></i>`;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
  clearTimeout(DP.titleT); DP.titleT = setTimeout(() => t.classList.remove('show'), 3000);
}

/* ---------- camera ----------
   The frame is the screen below the initiative ribbon. What goes in it depends on the DM's choice
   (display.follow): 'fit' the revealed area, 'turn' = follow the active token, 'dm' = the DM's own view
   (cropped to what is revealed), 'locked' = a view the DM pinned. Whatever the target, it is centred
   with 48 px of breathing room (at 1080p) and the camera eases there over ~400 ms. Under fog the space
   beyond the map is the same darkness as the fog, so the camera never pins the map to a screen edge. */
const DP_PAD = 48, DP_EASE_MS = 400, DP_MIN_ROWS = 8, DP_FOLLOW_ROWS = 10;
const dpEaseInOut = k => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const dpEaseOut = k => 1 - Math.pow(1 - k, 3);
// the bounding box of everything revealed, on the map; null without fog, { empty } when nothing is
function dpRevealed(sc) {
  if (!sc.fog || !sc.fog.on) return null;
  const { w, h } = bsSceneSize(sc);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of sc.fog.reveals) if (!r.hide) for (const [x, y] of r.pts || []) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const f = bsGrid(sc).size * 0.25; // the reveal's soft edge reaches a little past its outline
  x0 = Math.max(0, x0 - f); y0 = Math.max(0, y0 - f); x1 = Math.min(w, x1 + f); y1 = Math.min(h, y1 + f);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { empty: true };
}
// can the players see this point? (reveals and hides apply in order; the last one that covers it wins)
function dpVisibleAt(sc, x, y) {
  if (!sc.fog || !sc.fog.on) return true;
  let vis = false;
  for (const r of sc.fog.reveals) if (r.pts && r.pts.length >= 3 && bsPointInPoly(x, y, r.pts)) vis = !r.hide;
  return vis;
}
// where the ribbon really ends (its layout box, so the drop-in animation does not move the frame)
function dpRibbonBottom() { const el = dp$('dp-init'); return el.classList.contains('hidden') ? 0 : el.offsetTop + el.offsetHeight; }
function dpPadFor(top) { const p = Math.round(DP_PAD * bsClamp(DP.k, 0.7, 1.6)); return { t: top + p, r: p, b: p, l: p }; }
// what to frame, and the bounds it may grow into (what is revealed, else the map)
function dpTargetRect(sc, pad) {
  const { w, h } = bsSceneSize(sc), d = DP.battle.display, R = dpRevealed(sc), g = bsGrid(sc).size;
  const fit = R && !R.empty ? R : { x: 0, y: 0, w, h }, out = r => ({ x: r.x, y: r.y, w: r.w, h: r.h, noPad: !!r.noPad, bounds: fit });
  if (d.follow !== 'turn') DP.follow = null;
  if (d.follow === 'locked' && d.camera && d.camera.sceneId === sc.id) return out(d.camera);
  if (d.follow === 'dm' && DP.camRect && DP.camRect.sceneId === sc.id && dpBcAlive()) {
    const c = DP.camRect; if (!R || R.empty) return out(c);
    // the part of the DM's view the players can actually see; all of it when the DM looks elsewhere
    const x0 = Math.max(c.x, fit.x), y0 = Math.max(c.y, fit.y), x1 = Math.min(c.x + c.w, fit.x + fit.w), y1 = Math.min(c.y + c.h, fit.y + fit.h);
    return out(x1 - x0 > g && y1 - y0 > g ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : fit);
  }
  if (d.follow === 'turn') { const r = dpFollowRect(sc, fit, pad); if (r) return out(r); }
  return out(fit);
}
const dpAxis = (c, span, lo, len) => (len <= span ? lo + len / 2 - span / 2 : bsClamp(c - span / 2, lo, lo + len - span));
/* Follow the active token: a frame about ten squares tall around whoever is acting, held still while
   they stay in its middle 60% and kept inside what is revealed. Never follows a token the players
   cannot see (hidden, or standing in fog): the camera would give its position away. */
function dpFollowRect(sc, fit, pad) {
  const enc = DP.enc, list = (enc && enc.combatants) || [], cur = list[Math.min(enc && enc.turn || 0, list.length - 1)];
  const tok = cur && cur.id && sc.tokens.find(t => t.combatantId === cur.id && !t.hidden);
  if (!tok || !dpVisibleAt(sc, tok.x, tok.y)) { DP.follow = null; return null; }
  // the frame is filled edge to edge (noPad); only where it meets the edge of what is revealed does
  // the usual breathing room show
  const v = DP.view, s = bsGrid(sc).size, top = pad.t - pad.l, fw = v.W, fh = Math.max(40, v.H - top);
  const spanH = DP_FOLLOW_ROWS * s, spanW = spanH * fw / fh, room = pad.l * spanH / fh;
  const B = { x: fit.x - room, y: fit.y - room, w: fit.w + room * 2, h: fit.h + room * 2 };
  if (B.w <= spanW && B.h <= spanH) { DP.follow = null; return null; } // all of it fits at that zoom: frame all of it
  const F = DP.follow;
  if (F && F.sceneId === sc.id && Math.abs(F.w - spanW) < 1 && Math.abs(F.h - spanH) < 1 &&
    tok.x > F.x + F.w * 0.2 && tok.x < F.x + F.w * 0.8 && tok.y > F.y + F.h * 0.2 && tok.y < F.y + F.h * 0.8) return F;
  return (DP.follow = { sceneId: sc.id, x: dpAxis(tok.x, spanW, B.x, B.w), y: dpAxis(tok.y, spanH, B.y, B.h), w: spanW, h: spanH, noPad: true });
}
function dpCamFor(sc, r, pad, top) {
  const v = DP.view, g = bsGrid(sc).size, fw = Math.max(40, v.W - pad.l - pad.r), fh = Math.max(40, v.H - pad.t - pad.b);
  // never closer than ~8 squares tall (one small room would fill the TV with three tokens): a smaller
  // target grows to that, staying inside what is revealed rather than showing darkness past its edge
  const minH = DP_MIN_ROWS * g, minW = minH * fw / fh;
  if (r.w < minW && r.h < minH) {
    const B = r.bounds || r;
    r = { x: dpAxis(r.x + r.w / 2, minW, B.x, B.w), y: dpAxis(r.y + r.h / 2, minH, B.y, B.h), w: minW, h: minH };
  }
  const c = v.camFor(r, pad);
  if (sc.fog && sc.fog.on) return c;
  // no fog: no dead bands where the map is bigger than the frame (it fills it below the ribbon)
  const { w, h } = bsSceneSize(sc);
  const axis = (pos, len, lo, hi) => (len >= hi - lo ? bsClamp(pos, hi - len, lo) : bsClamp(pos, lo, hi - len));
  return { z: c.z, x: axis(c.x, w * c.z, 0, v.W), y: axis(c.y, h * c.z, top, v.H) };
}
const dpCamMoved = (a, b) => Math.abs(Math.log(a.z / b.z)) > 0.001 || Math.hypot(a.x - b.x, a.y - b.y) > 0.5;
function dpFrame(t) {
  const v = DP.view, sc = v.scene; if (!sc || !DP.battle) { DP.anim = null; return false; }
  const top = dpRibbonBottom(), pad = dpPadFor(top), r = dpTargetRect(sc, pad);
  const to = dpCamFor(sc, r, r.noPad ? { t: top, r: 0, b: 0, l: 0 } : pad, top);
  v.safe = { t: top ? top + 4 : 0, r: 0, b: 0, l: 0 }; // token labels stay out from under the ribbon
  if (DP.reduced) { DP.anim = null; DP.goal = to; DP.snap = false; v.cam = to; return false; } // reduced motion: cut, never glide
  const size = `${v.W}x${v.H}`;
  if (size !== DP.size) { DP.size = size; if (!DP.snap) DP.snap = true; } // moved to the TV, full screen: no swoop
  if (DP.snap) {
    const settle = DP.snap === 'settle'; DP.snap = false; DP.goal = to; DP.anim = null;
    if (!settle) { v.cam = to; return false; }
    // a new scene starts a touch wide and settles in as it fades up
    const z0 = to.z * 0.9, cx = (v.W / 2 - to.x) / to.z, cy = (v.H / 2 - to.y) / to.z;
    v.cam = { z: z0, x: v.W / 2 - cx * z0, y: v.H / 2 - cy * z0 };
    DP.anim = { from: { ...v.cam }, to, t0: t, dur: DP_EASE_MS + 150, ease: dpEaseOut };
  } else if (!DP.goal || dpCamMoved(DP.goal, to)) {
    // a reveal, a new turn, the DM's camera: ease from wherever we are (mid-flight: no restart from rest)
    const busy = DP.anim && t - DP.anim.t0 < DP.anim.dur;
    DP.anim = { from: { ...v.cam }, to, t0: t, dur: DP_EASE_MS, ease: busy ? dpEaseOut : dpEaseInOut };
    DP.goal = to;
  }
  const a = DP.anim; if (!a) return false;
  const p = bsClamp((t - a.t0) / a.dur, 0, 1), k = a.ease(p);
  if (p >= 1) { v.cam = { ...a.to }; DP.anim = null; return false; }
  // zoom on a log scale; the scene point at the screen centre travels in a straight line
  const W2 = v.W / 2, H2 = v.H / 2, z = Math.exp(Math.log(a.from.z) + (Math.log(a.to.z) - Math.log(a.from.z)) * k);
  const c0 = [(W2 - a.from.x) / a.from.z, (H2 - a.from.y) / a.from.z], c1 = [(W2 - a.to.x) / a.to.z, (H2 - a.to.y) / a.to.z];
  v.cam = { z, x: W2 - (c0[0] + (c1[0] - c0[0]) * k) * z, y: H2 - (c0[1] + (c1[1] - c0[1]) * k) * z };
  return true;
}

// ---------- initiative ribbon (player-safe: no HP, hidden tokens' combatants left out) ----------
function dpRenderInit() {
  const el = dp$('dp-init'), enc = DP.enc, sc = DP.view && DP.view.scene, d = DP.battle && DP.battle.display;
  const list = (enc && enc.combatants) || [];
  if (!sc || !d || d.showInit === false || !list.length) { if (!el.classList.contains('hidden')) { el.classList.add('hidden'); DP.view && DP.view.request(); } el.dataset.sig = ''; return; }
  const hidden = new Set(sc.tokens.filter(t => t.hidden && t.combatantId).map(t => t.combatantId));
  const visible = c => !(c.id && hidden.has(c.id));
  const turn = Math.min(enc.turn || 0, list.length - 1), cur = list[turn];
  const now = cur && visible(cur) ? cur : null, next = [];
  for (let i = 1; i < list.length && next.length < 4; i++) { const c = list[(turn + i) % list.length]; if (visible(c)) next.push(c); }
  // the disc matches the token on the map: its side, its art (portrait or creature glyph), its name
  const info = c => {
    const i = bsCombatantInfo(c, RAW.characters || [], null), tok = sc.tokens.find(t => t.combatantId && t.combatantId === c.id);
    if (tok) { i.kind = BS_KINDS[tok.kind] ? tok.kind : i.kind; if (tok.img) i.img = tok.img; if (tok.emoji) i.emoji = tok.emoji; if (tok.name) { i.name = tok.name; i.base = bsBaseName(tok.name); i.num = bsNumber(tok.name); } }
    return i;
  };
  const sig = JSON.stringify([enc.round, turn, now && [now.id, now.name, now.hp > 0], next.map(c => [c.id, c.name, Number(c.maxHp) > 0 && Number(c.hp) <= 0]), DP.k]);
  if (el.dataset.sig === sig && !el.classList.contains('hidden')) return;
  const turnChanged = el.dataset.turn !== `${enc.round}:${turn}`;
  el.dataset.sig = sig; el.dataset.turn = `${enc.round}:${turn}`;
  const nowInfo = now ? info(now) : null;
  el.innerHTML = `<div class="dp-round" aria-label="Round ${enc.round || 1}"><span>Round</span><b>${enc.round || 1}</b></div>
    <div class="dp-now ${turnChanged ? 'enter' : ''}">${now ? `<canvas id="dp-now-disc"></canvas><div class="dp-now-text"><span>${nowInfo.down ? 'Down' : 'Now acting'}</span><b>${dpEsc(nowInfo.name)}</b></div>` : `<div class="dp-now-text"><span>Now acting</span><b class="dp-dim">…</b></div>`}</div>
    ${next.length ? `<div class="dp-next"><span>Up next</span><div class="dp-next-row">${next.map((c, i) => { const n = info(c); return `<div class="dp-up ${n.down ? 'down' : ''}" style="--i:${i}"><canvas data-n="${i}"></canvas><b>${dpEsc(n.base || n.name)}${n.num ? ` <i>${n.num}</i>` : ''}</b></div>`; }).join('')}</div></div>` : ''}`;
  const wasHidden = el.classList.contains('hidden');
  el.classList.remove('hidden');
  // discs drawn at the size CSS shows them (both scale with the screen: 72 and 48 px at 1080p)
  if (now) dpFaceDisc(dp$('dp-now-disc'), nowInfo, Math.round(72 * DP.k), '#f2b544');
  el.querySelectorAll('canvas[data-n]').forEach(cv => dpFaceDisc(cv, info(next[Number(cv.dataset.n)]), Math.round(48 * DP.k)));
  // never wider than the screen: drop the furthest up-next until it fits
  const ups = [...el.querySelectorAll('.dp-up')], room = window.innerWidth - Math.round(48 * DP.k);
  el.style.maxWidth = 'none';
  while (ups.length > 1 && el.offsetWidth > room) ups.pop().remove();
  el.style.maxWidth = '';
  if (wasHidden) DP.view.request();
}
// one unit for the whole TV layout: 1px at 1080p (1920×1080), scaled with the window, so a 4K TV,
// a 1440×810 window and the 1080p set all keep the same composition
function dpScale() {
  DP.k = Math.round(bsClamp(Math.min(window.innerHeight / 1080, window.innerWidth / 1920), 0.62, 2) * 1000) / 1000;
  document.documentElement.style.setProperty('--px', DP.k + 'px');
}

/* A head-and-shoulders crop for tall portraits, so faces read from across the room (the token disc
   centres the crop, which on a full-length portrait is mostly torso). Square art goes through bsDisc. */
function dpFaceDisc(cv, info, css, ring) {
  ring = info.down ? '#6b7280' : ring || BS_KINDS[info.kind].ring;
  const e = info.img ? bsImage(info.img, () => { if (cv.isConnected) dpFaceDisc(cv, info, css, ring); }) : null;
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

/* Under fog the map's outer grid line sits half outside the fog, so wherever a map edge is on screen it
   showed as a thin rule. Paint it over in the backdrop colour (sampled once per scene from a corner that
   is off the map, so it always matches whatever the renderer fills there). */
function dpHideEdges() {
  const v = DP.view, sc = v.scene; if (!sc || !sc.fog || !sc.fog.on) return;
  const { w, h } = bsSceneSize(sc), [x0, y0] = v.toScreen(0, 0), [x1, y1] = v.toScreen(w, h);
  if (x0 <= 0 && y0 <= 0 && x1 >= v.W && y1 >= v.H) return; // the map fills the screen
  const ctx = v.ctx, d = v.dpr;
  if (!DP.edge || DP.edge.id !== sc.id) {
    const off = [[1, 1], [v.W - 2, 1], [1, v.H - 2], [v.W - 2, v.H - 2]].find(([X, Y]) => X < x0 - 36 || X > x1 + 36 || Y < y0 - 36 || Y > y1 + 36);
    if (!off) return;
    const p = ctx.getImageData(Math.floor(off[0] * d), Math.floor(off[1] * d), 1, 1).data;
    DP.edge = { id: sc.id, col: `rgb(${p[0]},${p[1]},${p[2]})` };
  }
  ctx.save(); ctx.setTransform(d, 0, 0, d, 0, 0); ctx.strokeStyle = DP.edge.col; ctx.lineWidth = 4;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0); ctx.restore();
}

// ---------- messages from the DM tab ----------
function dpOnMessage(m) {
  if (!m || !DP.view) return;
  DP.lastBc = Date.now();
  if (m.t === 'hb') { DP.bcVisible = !!m.visible; return; }
  DP.bcVisible = true;
  if (m.t === 'doc') dpApplyBattle(m.battle);
  else if (m.t === 'enc') dpApplyEnc(m.enc);
  else if (m.t === 'cam') { DP.camRect = { ...m.rect, sceneId: m.sceneId }; DP.view.request(); }
  else if (m.t === 'ping') { if (m.sceneId === DP.sceneId) DP.view.ping(m.x, m.y, m.color); }
  else if (m.t === 'live') {
    const v = DP.view, L = v.live, same = m.sceneId === DP.sceneId, hadDrag = !!L.drag;
    L.ruler = same ? m.ruler : null;
    L.previews = same ? (m.previews || []) : [];
    L.drag = same && m.drag ? { lead: m.drag.lead, pos: new Map(m.drag.pos), from: new Map(m.drag.from), snap: m.drag.snap ? new Map(m.drag.snap) : null } : null;
    if (hadDrag && !L.drag && v.scene) v.setScene(v.scene); // glide the dropped token onto its square
    v.request();
  }
}

// ---------- full screen, idle cursor ----------
function dpToggleFs() {
  if (DP_EMBED) return;
  dpFsHint(false);
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => dpChip('Full screen was blocked: click the page, then press F'));
}
function dpChip(text, ms = 3500) { const c = dp$('dp-chip'); c.textContent = text; c.classList.add('show'); clearTimeout(DP.chipT); DP.chipT = setTimeout(() => c.classList.remove('show'), ms); }
// "Press F for full screen": shown while windowed, fading out after 4 s (and again when the mouse moves)
function dpFsHint(show = true) {
  const el = dp$('dp-fs'); clearTimeout(DP.fsT);
  if (!show || DP_EMBED || document.fullscreenElement) { el.classList.remove('show'); return; }
  el.classList.remove('hidden'); void el.offsetWidth; el.classList.add('show');
  DP.fsT = setTimeout(() => el.classList.remove('show'), 4000);
}
document.addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey && !DP_EMBED) { e.preventDefault(); dpToggleFs(); } });
// a click anywhere on the TV window goes full screen, as the old centred prompt did
document.addEventListener('click', e => { if (!DP_EMBED && e.button === 0 && !document.fullscreenElement) dpToggleFs(); });
document.addEventListener('fullscreenchange', () => { dpFsHint(!document.fullscreenElement); });
function dpWake(e) {
  document.body.classList.remove('idle'); clearTimeout(DP.idleT); DP.idleT = setTimeout(() => document.body.classList.add('idle'), 2000);
  if (e && e.type === 'mousemove' && !dp$('dp-fs').classList.contains('show')) dpFsHint();
}
['mousemove', 'pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, dpWake, { passive: true }));

(async function dpBoot() {
  dpScale(); dpWake();
  try { S.me = await api('/api/me'); await loadAll(); }
  catch (_) {
    dpMsg(`<div class="dp-wait"><div class="dp-sigil"></div><b>Open this from the DM screen</b><span>This is the players' view of the battle map. On the DM screen, go to <em>Battle map</em> and press <em>Display</em> → <em>Cast to the TV</em>; it opens here already signed in.</span></div>`);
    return;
  }
  connectSSE();
  const v = DP.view = new BattleView(dp$('dp-canvas'), { player: true, backdrop: DP_FOG });
  v.backdrop = DP_FOG;
  v.pcLabels = true; // a name chip under every PC token (renderers without it ignore the flag)
  v.onFrame = dpFrame;
  const draw = v.draw;
  v.draw = function (...a) { const r = draw.apply(this, a); try { dpHideEdges(); } catch (_) { /* never break a frame */ } return r; };
  v.setChars(RAW.characters || []);
  dpApplyEnc(RAW.encounter);
  dpApplyBattle(RAW.battle);
  LIVE_HOOKS.battle = (p, n) => { if (!dpBcAlive()) dpApplyBattle(n); };
  LIVE_HOOKS.encounter = (p, n) => { if (!dpBcAlive()) dpApplyEnc(n); };
  LIVE_HOOKS.characters = (p, n) => { v.setChars(n || []); dp$('dp-init').dataset.sig = ''; dpRenderInit(); };
  if (typeof BroadcastChannel === 'function') {
    const bc = new BroadcastChannel('gc-battle');
    bc.onmessage = e => dpOnMessage(e.data);
    bc.postMessage({ t: 'hello' });
    setInterval(() => bc.postMessage({ t: 'display-hb' }), 2500);
    bc.postMessage({ t: 'display-hb' });
  }
  // the camera re-targets (without a swoop: see dpFrame) and the ribbon re-scales when the window
  // changes size (moved to the TV, full screen)
  window.addEventListener('resize', () => {
    const k = DP.k; dpScale();
    if (k !== DP.k) { dp$('dp-init').dataset.sig = ''; dpRenderInit(); }
    DP.view.request();
  });
  if (!DP_EMBED) dpFsHint(); // embedded in a player's Battle map tab: no full-screen prompt
  if (document.fonts) document.fonts.ready.then(() => { BS_SPRITES.clear(); v.request(); dp$('dp-init').dataset.sig = ''; dpRenderInit(); });
})();
