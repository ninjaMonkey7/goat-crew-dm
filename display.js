/* display.js — the player display: a chromeless, player-safe view of the battle map for the TV.
   Opened from the DM's Battle map tab (same origin, so it reuses the logged-in session). Instant
   updates arrive over BroadcastChannel('gc-battle') from the DM tab on this machine; when no DM tab
   is talking it falls back to gh.js polling (the other DM's changes, or a display on its own).
   Never shows hidden tokens, DM-only drawings or HP numbers; fog is solid darkness. */
'use strict';

const S = { me: null, cache: {}, tab: 'display' }; // gh.js only forwards live changes once a user is logged in
const DP = { view: null, battle: null, enc: null, sceneId: null, camRect: null, lastBc: 0, bcVisible: false, lastT: 0, snap: true, titleT: 0, chipT: 0, idleT: 0, fsT: 0, edge: null };
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
    DP.sceneId = sc.id; DP.camRect = null;
    const swap = () => { DP.view.setScene(sc); DP.snap = true; DP.view.request(); dp$('dp-stage').classList.remove('fade'); dpTitle(sc.name); };
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

// ---------- camera: follow the DM, fit what is revealed, or a locked view ----------
function dpTargetRect() {
  const sc = DP.view.scene; if (!sc) return null;
  const { w, h } = bsSceneSize(sc), d = DP.battle.display;
  if (d.follow === 'dm' && DP.camRect && DP.camRect.sceneId === sc.id && dpBcAlive()) return DP.camRect;
  if (d.follow === 'locked' && d.camera && d.camera.sceneId === sc.id) return d.camera;
  if (sc.fog.on) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of sc.fog.reveals) if (!r.hide) for (const [x, y] of r.pts || []) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (x1 > x0 && y1 > y0) {
      const s = bsGrid(sc).size; // one square of breathing room, never past the map edge
      x0 = Math.max(0, x0 - s); y0 = Math.max(0, y0 - s); x1 = Math.min(w, x1 + s); y1 = Math.min(h, y1 + s);
      if (x1 > x0 && y1 > y0) return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }
  }
  return { x: 0, y: 0, w, h };
}
// keep the map out from under the ribbon: at least 96 px, or wherever the ribbon really ends
function dpPad() {
  const el = dp$('dp-init'), top = el.classList.contains('hidden') ? 28 : Math.max(96, el.offsetTop + el.offsetHeight + 10); // layout box: ignores the drop-in animation
  return { t: top, r: 28, b: 28, l: 28 };
}
/* No dead strips past the map: where the map is bigger than the screen it fills it edge to edge (below
   the ribbon's band at the top); where it is smaller it stays whole. The fit rect alone, centred, used
   to leave the space beyond the map's edge on screen, and with it the map's edge line. */
function dpClamp(c, pad) {
  const v = DP.view, { w, h } = bsSceneSize(v.scene);
  const axis = (pos, len, lo, hi) => (len >= hi - lo ? bsClamp(pos, hi - len, lo) : bsClamp(pos, lo, hi - len));
  return { z: c.z, x: axis(c.x, w * c.z, 0, v.W), y: axis(c.y, h * c.z, pad.t > 40 ? pad.t : 0, v.H) };
}
function dpFrame(t) {
  const v = DP.view, r = dpTargetRect(); if (!r) { DP.lastT = t; return false; }
  const pad = dpPad(), to = dpClamp(v.camFor(r, pad), pad);
  v.safe = { t: pad.t > 40 ? pad.t - 6 : 0, r: 0, b: 0, l: 0 }; // token labels stay out from under the ribbon
  const dt = Math.min(80, t - (DP.lastT || t)); DP.lastT = t;
  if (DP.snap) { v.cam = to; DP.snap = false; return false; }
  const W2 = v.W / 2, H2 = v.H / 2, cz = v.cam.z;
  const c0 = [(W2 - v.cam.x) / cz, (H2 - v.cam.y) / cz], c1 = [(W2 - to.x) / to.z, (H2 - to.y) / to.z];
  const k = 1 - Math.exp(-dt / 260);
  const z = Math.exp(Math.log(cz) + (Math.log(to.z) - Math.log(cz)) * k);
  const c = [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k];
  if (Math.abs(Math.log(z / to.z)) < 0.0015 && Math.hypot(c[0] - c1[0], c[1] - c1[1]) * z < 0.4) { v.cam = to; return false; }
  v.cam = { z, x: W2 - c[0] * z, y: H2 - c[1] * z };
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
  const info = c => { const i = bsCombatantInfo(c, RAW.characters || [], null); const tok = sc.tokens.find(t => t.combatantId && t.combatantId === c.id); if (tok) { i.kind = BS_KINDS[tok.kind] ? tok.kind : i.kind; if (tok.img) i.img = tok.img; if (tok.name) { i.name = tok.name; i.base = bsBaseName(tok.name); } } return i; };
  const sig = JSON.stringify([enc.round, turn, now && [now.id, now.name, now.hp > 0], next.map(c => [c.id, c.name, Number(c.maxHp) > 0 && Number(c.hp) <= 0])]);
  if (el.dataset.sig === sig && !el.classList.contains('hidden')) return;
  const turnChanged = el.dataset.turn !== `${enc.round}:${turn}`;
  el.dataset.sig = sig; el.dataset.turn = `${enc.round}:${turn}`;
  const nowInfo = now ? info(now) : null;
  el.innerHTML = `<div class="dp-round"><span>Round</span><b>${enc.round || 1}</b></div>
    <div class="dp-now ${turnChanged ? 'enter' : ''}">${now ? `<canvas id="dp-now-disc"></canvas><div class="dp-now-text"><span>${nowInfo.down ? 'Down' : 'Now acting'}</span><b>${dpEsc(nowInfo.name)}</b></div>` : `<div class="dp-now-text"><span>Now acting</span><b class="dp-dim">…</b></div>`}</div>
    ${next.length ? `<div class="dp-next"><span>Up next</span><div class="dp-next-row">${next.map((c, i) => `<div class="dp-up" style="--i:${i}"><canvas data-n="${i}"></canvas><b>${dpEsc(bsBaseName(info(c).name))}${bsNumber(info(c).name) ? ` <i>${bsNumber(info(c).name)}</i>` : ''}</b></div>`).join('')}</div></div>` : ''}`;
  const wasHidden = el.classList.contains('hidden');
  el.classList.remove('hidden');
  if (now) dpFaceDisc(dp$('dp-now-disc'), nowInfo, 60, '#f2b544');
  el.querySelectorAll('canvas[data-n]').forEach(cv => dpFaceDisc(cv, info(next[Number(cv.dataset.n)]), 38));
  if (wasHidden) DP.view.request();
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
  dpWake();
  try { S.me = await api('/api/me'); await loadAll(); }
  catch (_) {
    dpMsg(`<div class="dp-wait"><div class="dp-sigil"></div><b>Open this from the DM screen</b><span>This is the players' view of the battle map. On the DM screen, go to <em>Battle map</em> and press <em>Display</em> → <em>Cast to the TV</em>; it opens here already signed in.</span></div>`);
    return;
  }
  connectSSE();
  const v = DP.view = new BattleView(dp$('dp-canvas'), { player: true });
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
  // the camera re-targets when the window changes size (moved to the TV, full screen)
  window.addEventListener('resize', () => { DP.view.request(); });
  if (!DP_EMBED) dpFsHint(); // embedded in a player's Battle map tab: no full-screen prompt
  if (document.fonts) document.fonts.ready.then(() => { BS_SPRITES.clear(); v.request(); dp$('dp-init').dataset.sig = ''; dpRenderInit(); });
})();
