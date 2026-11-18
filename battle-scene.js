/* battle-scene.js — the battle map renderer, shared by the DM's Battle map tab (battlemap.js) and the
   player display window (display.js). Canvas 2D. Scene coordinates are pixels of the map; the camera
   maps them to the screen as  screen = scene * z + (x, y). Pure drawing and geometry: no saving here.
   Needs media() from gh.js for images in the private data branch. */
'use strict';

const BS_TAU = Math.PI * 2;
const BS_BACKDROP = '#0c0e13';
const BS_KINDS = {
  pc: { label: 'PC', ring: '#f2c15e' },
  ally: { label: 'Ally', ring: '#4ade80' },
  foe: { label: 'Foe', ring: '#f05252' },
  neutral: { label: 'Neutral', ring: '#a7b1c6' }
};
// [cells, name, short]
const BS_SIZES = [[0.5, 'Tiny', 'T'], [1, 'Medium', 'M'], [2, 'Large', 'L'], [3, 'Huge', 'H'], [4, 'Gargantuan', 'G']];
// SRD creature sizes for the bestiary ids that are not Medium
const BS_MONSTER_SIZE = (() => {
  const out = {};
  for (const id of ['stirge', 'crawling-claw', 'imp', 'quasit', 'will-o-wisp']) out[id] = 0.5;
  for (const id of ['giant-spider', 'dire-wolf', 'giant-bat', 'ochre-jelly', 'gelatinous-cube', 'carrion-crawler', 'ogre']) out[id] = 2;
  return out;
})();
const BS_EMOJI = {
  bandit: '🗡️', 'bandit-captain': '⚔️', thug: '👊', guard: '🛡️', veteran: '⚔️', spy: '🕵️', cultist: '🕯️', 'cult-fanatic': '🔥',
  acolyte: '📿', priest: '✨', doppelganger: '🎭', zombie: '🧟', skeleton: '💀', ghoul: '🧟', ghast: '🧟', shadow: '🌑', specter: '👻',
  wight: '💀', ghost: '👻', 'crawling-claw': '✋', 'giant-rat': '🐀', 'swarm-rats': '🐀', 'giant-spider': '🕷️', 'giant-centipede': '🐛',
  stirge: '🦟', 'giant-bat': '🦇', wolf: '🐺', 'dire-wolf': '🐺', 'black-bear': '🐻', wererat: '🐀', 'gray-ooze': '💧', 'ochre-jelly': '💧',
  'gelatinous-cube': '🧊', darkmantle: '🦑', 'carrion-crawler': '🐛', grick: '🪱', 'rust-monster': '🦗', mimic: '📦', 'animated-armor': '🛡️',
  goblin: '👺', hobgoblin: '👹', orc: '👹', gnoll: '🐺', ogre: '👹', sahuagin: '🦈', merfolk: '🧜', harpy: '🦅', imp: '😈', quasit: '😈', 'will-o-wisp': '✨'
};
const BS_EMOJI_WORDS = [[/spider/i, '🕷️'], [/\brats?\b/i, '🐀'], [/wol(f|ves)|hound|\bdogs?\b|jackal/i, '🐺'], [/\bbats?\b/i, '🦇'], [/skelet|bones?\b/i, '💀'],
  [/zombie|ghoul|ghast|undead/i, '🧟'], [/ghost|spirit|spect|wraith|phantom/i, '👻'], [/dragon|drake|wyrm|wyvern/i, '🐉'], [/snake|serpent|naga/i, '🐍'],
  [/bear/i, '🐻'], [/horse|pony|mule/i, '🐎'], [/\bcats?\b|panther|lion|tiger/i, '🐈'], [/goblin/i, '👺'], [/orc|ogre|troll|bugbear/i, '👹'],
  [/bandit|thief|rogue|assassin|cutthroat/i, '🗡️'], [/guard|soldier|knight|sentry/i, '🛡️'], [/wizard|mage|witch|warlock|sorcer/i, '🧙'],
  [/cult|priest|acolyte|monk/i, '🕯️'], [/demon|devil|fiend|\bimps?\b/i, '😈'], [/bird|eagle|hawk|raven|crow|owl/i, '🦅'], [/fish|shark/i, '🦈'],
  [/slime|ooze|jelly|pudding/i, '💧'], [/beetle|centipede|insect|worm|crawler/i, '🐛'], [/boar|pig/i, '🐗'], [/chest|crate|barrel|cart/i, '📦'],
  [/fire|flame|elemental/i, '🔥'], [/tree|treant|plant|vine|shrub/i, '🌿'], [/statue|golem|construct/i, '🗿'], [/crab/i, '🦀'], [/frog|toad/i, '🐸']];
// jewel-tone palettes for generated tokens: [highlight, body, edge]
const BS_PALETTES = {
  crimson: ['#ef7a70', '#9e1f2b', '#3a0910'], ember: ['#f4a865', '#b5531f', '#461807'], amber: ['#f7d987', '#b78a2c', '#45300a'],
  emerald: ['#7fdcaa', '#207951', '#0a2c1c'], teal: ['#7ddad3', '#1c7d84', '#072d31'], sapphire: ['#8ab3f4', '#2b52ad', '#0b183d'],
  amethyst: ['#cba6f4', '#6c3fa9', '#25113d'], slate: ['#c3cbdc', '#56627b', '#1a202d'], bone: ['#f1e8d2', '#a6977a', '#3d3427'], moss: ['#c2d68a', '#5e7a2a', '#1f2a0b']
};
const BS_KIND_PALETTES = {
  foe: ['crimson', 'ember', 'amethyst', 'slate', 'moss', 'bone', 'crimson'], pc: ['amber', 'sapphire', 'teal', 'emerald', 'amethyst', 'ember'],
  ally: ['emerald', 'teal', 'sapphire'], neutral: ['slate', 'bone', 'amber', 'teal']
};

// ---------- small utils ----------
function bsHash(str) { let h = 2166136261 >>> 0; for (const ch of String(str)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
function bsRng(seed) {
  let a = typeof seed === 'number' ? seed >>> 0 : bsHash(seed);
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function bsCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
function bsRgba(hex, a) {
  const m = String(hex).replace('#', ''); const n = parseInt(m.length === 3 ? m.replace(/./g, c => c + c) : m.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
const bsClamp = (v, a, b) => Math.max(a, Math.min(b, v));
// lighten (amt > 0, towards white) or darken (amt < 0, towards black) a #rrggbb colour
function bsShade(hex, amt) {
  const n = parseInt(String(hex).replace('#', '').slice(0, 6), 16), t = amt < 0 ? 0 : 255, k = Math.abs(amt);
  const ch = v => Math.round(v + (t - v) * k);
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}
// a ring that reads as polished metal: light from the top left
function bsRingStyle(x, cx, cy, r, col) {
  const g = x.createLinearGradient(cx - r, cy - r, cx + r, cy + r);
  g.addColorStop(0, bsShade(col, 0.5)); g.addColorStop(0.45, col); g.addColorStop(1, bsShade(col, -0.42));
  return g;
}
const bsEase = t => 1 - Math.pow(1 - bsClamp(t, 0, 1), 3);

// ---------- scene geometry ----------
function bsGrid(sc) { const g = (sc && sc.grid) || {}; return { size: Math.max(8, Number(g.size) || 70), offsetX: Number(g.offsetX) || 0, offsetY: Number(g.offsetY) || 0, show: g.show !== false, opacity: g.opacity == null ? 0.5 : Number(g.opacity) }; }
function bsSceneSize(sc) {
  if (sc && sc.bgSize && sc.bgSize.w) return { w: sc.bgSize.w, h: sc.bgSize.h };
  const g = bsGrid(sc); return { w: (sc && sc.cols || 24) * g.size, h: (sc && sc.rows || 16) * g.size };
}
function bsSnapCenter(sc, x, y, n) {
  const g = bsGrid(sc), s = g.size, m = Math.max(1, n || 1);
  return [g.offsetX + s * (Math.round((x - g.offsetX) / s - m / 2) + m / 2), g.offsetY + s * (Math.round((y - g.offsetY) / s - m / 2) + m / 2)];
}
function bsSnapVertex(sc, x, y) { const g = bsGrid(sc), s = g.size; return [g.offsetX + s * Math.round((x - g.offsetX) / s), g.offsetY + s * Math.round((y - g.offsetY) / s)]; }
function bsCellCenter(sc, x, y) { return bsSnapCenter(sc, x, y, 1); }
// 5e grid distance in feet between two points (cells counted from their centres)
function bsFeet(sc, a, b, rule) {
  const s = bsGrid(sc).size;
  const dx = Math.round(Math.abs(b[0] - a[0]) / s), dy = Math.round(Math.abs(b[1] - a[1]) / s);
  if (rule === 'alt') { const mx = Math.max(dx, dy), mn = Math.min(dx, dy); return 5 * (mx + Math.floor(mn / 2)); }
  if (rule === 'euclid') return 5 * Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / s);
  return 5 * Math.max(dx, dy);
}
function bsTokenRadius(sc, t) { return Math.max(0.5, Number(t.size) || 1) * bsGrid(sc).size / 2 * 0.92; }
function bsPointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-9) + xi)) inside = !inside;
  }
  return inside;
}
function bsDistSeg(px, py, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const t = l2 ? bsClamp(((px - a[0]) * dx + (py - a[1]) * dy) / l2, 0, 1) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}
// Ramer–Douglas–Peucker: freehand strokes stay small in battle.json
function bsSimplify(pts, eps) {
  if (pts.length < 3) return pts;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) { const d = bsDistSeg(pts[i][0], pts[i][1], pts[0], pts[pts.length - 1]); if (d > max) { max = d; idx = i; } }
  if (max <= eps) return [pts[0], pts[pts.length - 1]];
  return bsSimplify(pts.slice(0, idx + 1), eps).slice(0, -1).concat(bsSimplify(pts.slice(idx), eps));
}

/* Spell templates: { type:'template', shape:'circle'|'cone'|'line'|'cube', pts:[origin, end], color }.
   circle = radius from origin; cone = 5e cone (width equals distance, ~53°); line = 5 ft wide;
   cube = square whose near face is centred on the origin. All rotate with the end point. */
const BS_TPL_NAMES = { circle: 'radius', cone: 'cone', line: 'line', cube: 'cube' };
function bsTpl(sc, d) {
  const [o, e] = d.pts, s = bsGrid(sc).size;
  const L = Math.max(1, Math.hypot(e[0] - o[0], e[1] - o[1])), a = Math.atan2(e[1] - o[1], e[0] - o[0]);
  const ux = Math.cos(a), uy = Math.sin(a), vx = -uy, vy = ux;
  const ft = Math.round(L / s * 5);
  const out = { shape: d.shape, o, e, L, a, ft };
  if (d.shape === 'circle') out.r = L;
  else if (d.shape === 'cone') out.poly = [o, [o[0] + L * ux + L / 2 * vx, o[1] + L * uy + L / 2 * vy], [o[0] + L * ux - L / 2 * vx, o[1] + L * uy - L / 2 * vy]];
  else { const half = d.shape === 'line' ? s / 2 : L / 2; out.poly = [[o[0] + half * vx, o[1] + half * vy], [o[0] + L * ux + half * vx, o[1] + L * uy + half * vy], [o[0] + L * ux - half * vx, o[1] + L * uy - half * vy], [o[0] - half * vx, o[1] - half * vy]]; }
  return out;
}
function bsTplContains(g, x, y, pad = 0) { return g.r != null ? Math.hypot(x - g.o[0], y - g.o[1]) <= g.r + pad : bsPointInPoly(x, y, g.poly); }
function bsTplCells(sc, g) {
  const gr = bsGrid(sc), s = gr.size; const out = [];
  const xs = g.r != null ? [g.o[0] - g.r, g.o[0] + g.r] : g.poly.map(p => p[0]), ys = g.r != null ? [g.o[1] - g.r, g.o[1] + g.r] : g.poly.map(p => p[1]);
  const c0 = Math.floor((Math.min(...xs) - gr.offsetX) / s), c1 = Math.ceil((Math.max(...xs) - gr.offsetX) / s);
  const r0 = Math.floor((Math.min(...ys) - gr.offsetY) / s), r1 = Math.ceil((Math.max(...ys) - gr.offsetY) / s);
  if ((c1 - c0) * (r1 - r0) > 6000) return out;
  for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) {
    const cx = gr.offsetX + (c + 0.5) * s, cy = gr.offsetY + (r + 0.5) * s;
    if (bsTplContains(g, cx, cy, -0.001)) out.push([gr.offsetX + c * s, gr.offsetY + r * s]);
  }
  return out;
}

// ---------- token identity ----------
const bsBaseName = n => String(n || '').replace(/\s+\d+$/, '').trim();
const bsNumber = n => (String(n || '').match(/\s(\d+)$/) || [])[1] || '';
function bsInitials(name) {
  const w = bsBaseName(name).split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]).replace(/^./, c => c.toUpperCase());
}
function bsEmojiFor(monster, name) {
  if (monster && BS_EMOJI[monster]) return BS_EMOJI[monster];
  for (const [re, e] of BS_EMOJI_WORDS) if (re.test(name || '')) return e;
  return '';
}
function bsKindOf(c) { return c && (c.characterId || /^pc$/i.test(String(c.notes || '').trim())) ? 'pc' : c && c.monster ? 'foe' : 'neutral'; }
/* Everything the renderer needs about a token, resolved against the encounter and the party. */
function bsTokenInfo(t, enc, chars, turnId) {
  const c = t.combatantId && enc ? (enc.combatants || []).find(x => x.id === t.combatantId) : null;
  const chId = t.characterId || (c && c.characterId);
  const ch = chId && chars ? chars.find(x => x.id === chId) : null;
  const max = c ? Number(c.maxHp) || 0 : 0, hp = c ? Number(c.hp) || 0 : 0;
  const name = t.name || (c && c.name) || '';
  return {
    name, base: bsBaseName(name), num: bsNumber(name), kind: BS_KINDS[t.kind] ? t.kind : 'neutral',
    img: t.img || (ch && ch.portrait) || null, emoji: t.emoji || (chId ? '' : bsEmojiFor(t.monster || (c && c.monster), name)),
    hp: max > 0 ? { hp, max } : null, down: max > 0 ? hp <= 0 : !!t.down, bloodied: max > 0 && hp > 0 && hp <= max / 2,
    turn: !!(c && turnId && c.id === turnId), combatant: c
  };
}
function bsCombatantInfo(c, chars, turnId) {
  return bsTokenInfo({ name: c.name, kind: bsKindOf(c), combatantId: c.id, characterId: c.characterId, monster: c.monster }, { combatants: [c] }, chars, turnId);
}

// ---------- images (private repo via media()) with a mip chain for smooth zoomed-out drawing ----------
const BS_IMG = {};
function bsImage(path, onReady) {
  if (!path) return null;
  let e = BS_IMG[path];
  if (!e) {
    e = BS_IMG[path] = { ready: false, failed: false, waiters: [], img: null, mips: null };
    const getUrl = /^(blob:|data:|https?:)/.test(path) ? Promise.resolve(path) : (typeof media === 'function' ? media(path) : Promise.reject(new Error('no media()')));
    getUrl.then(url => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = url; }))
      .then(im => { e.img = im; e.ready = true; })
      .catch(() => { e.failed = true; })
      .finally(() => { const w = e.waiters; e.waiters = []; w.forEach(f => { try { f(); } catch (_) { /* ignore */ } }); });
  }
  if (!e.ready && onReady && !e.failed) e.waiters.push(onReady);
  return e.ready ? e : null;
}
function bsMips(src) {
  const out = [src]; let c = src;
  while (Math.max(c.width, c.height) > 700 && out.length < 6) {
    const n = bsCanvas(c.width / 2, c.height / 2), x = n.getContext('2d');
    x.imageSmoothingQuality = 'high'; x.drawImage(c, 0, 0, n.width, n.height); out.push(n); c = n;
  }
  return out;
}

// ---------- procedural floors for blank scenes ----------
let BS_NOISE = null;
function bsNoise() {
  if (BS_NOISE) return BS_NOISE;
  const n = 256, c = bsCanvas(n, n), x = c.getContext('2d'), d = x.createImageData(n, n), r = bsRng(11);
  for (let i = 0; i < n * n; i++) { const v = 128 + (r() - 0.5) * 220; d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; }
  x.putImageData(d, 0, 0);
  return (BS_NOISE = c);
}
const BS_FLOORS = { flagstone: 'Dungeon flagstones', planks: 'Tavern planks', parchment: 'Parchment' };
const BS_FLOOR_CACHE = new Map();
function bsFloor(sc) {
  const { w, h } = bsSceneSize(sc), g = bsGrid(sc), style = BS_FLOORS[sc.floor] ? sc.floor : 'flagstone';
  const key = `${sc.id}|${style}|${w}x${h}|${g.size}|${g.offsetX}|${g.offsetY}`;
  if (BS_FLOOR_CACHE.has(key)) return BS_FLOOR_CACHE.get(key);
  const k = Math.min(1, 4096 / Math.max(w, h));
  const c = bsCanvas(w * k, h * k), x = c.getContext('2d');
  x.scale(k, k);
  const rnd = bsRng(sc.id + style);
  if (style === 'planks') bsPlanks(x, w, h, g.size, rnd);
  else if (style === 'parchment') bsParchment(x, w, h, g.size, rnd);
  else bsFlagstone(x, w, h, g.size, rnd);
  const out = { mips: bsMips(c), scale: k };
  if (BS_FLOOR_CACHE.size > 6) BS_FLOOR_CACHE.delete(BS_FLOOR_CACHE.keys().next().value);
  BS_FLOOR_CACHE.set(key, out);
  return out;
}
function bsTexture(x, w, h, alpha, op) {
  x.save(); x.globalCompositeOperation = op || 'overlay'; x.globalAlpha = alpha;
  x.fillStyle = x.createPattern(bsNoise(), 'repeat'); x.fillRect(0, 0, w, h); x.restore();
}
function bsVignette(x, w, h, rgba) {
  const v = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) * 0.62);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, rgba); x.fillStyle = v; x.fillRect(0, 0, w, h);
}
function bsBlotches(x, w, h, s, rnd, n, colors, op) {
  x.save(); x.globalCompositeOperation = op || 'source-over';
  for (let i = 0; i < n; i++) {
    const cx = rnd() * w, cy = rnd() * h, r = s * (1.5 + rnd() * 5), col = colors[Math.floor(rnd() * colors.length)];
    const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  x.restore();
}
function bsFlagstone(x, w, h, s, rnd) {
  x.fillStyle = '#0f1115'; x.fillRect(0, 0, w, h);
  const cols = Math.ceil(w / s), rows = Math.ceil(h / s), used = new Uint8Array(cols * rows);
  const free = (c, r) => c < cols && r < rows && !used[r * cols + c];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (used[r * cols + c]) continue;
    let cw = 1, ch = 1; const roll = rnd();
    if (roll < 0.04 && free(c + 1, r) && free(c, r + 1) && free(c + 1, r + 1)) { cw = 2; ch = 2; }
    else if (roll < 0.17 && free(c + 1, r)) cw = 2;
    else if (roll < 0.27 && free(c, r + 1)) ch = 2;
    for (let i = 0; i < ch; i++) for (let j = 0; j < cw; j++) used[(r + i) * cols + c + j] = 1;
    bsSlab(x, c * s, r * s, cw * s, ch * s, s, rnd);
  }
  bsTexture(x, w, h, 0.32, 'overlay');
  bsBlotches(x, w, h, s, rnd, Math.round(cols * rows / 14) + 4, ['rgba(10,12,8,.35)', 'rgba(52,66,38,.18)', 'rgba(0,0,0,.28)'], 'multiply');
  bsVignette(x, w, h, 'rgba(0,0,0,.5)');
}
function bsSlab(x, x0, y0, sw, sh, s, rnd) {
  const gap = s * 0.04, j = () => (rnd() - 0.5) * s * 0.035, rr = s * 0.06;
  const p = [[x0 + gap + j(), y0 + gap + j()], [x0 + sw - gap + j(), y0 + gap + j()], [x0 + sw - gap + j(), y0 + sh - gap + j()], [x0 + gap + j(), y0 + sh - gap + j()]];
  const path = () => {
    x.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = p[i], b = p[(i + 1) % 4], pr = p[(i + 3) % 4];
      const ta = Math.hypot(a[0] - pr[0], a[1] - pr[1]), tb = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const s1 = [a[0] + (pr[0] - a[0]) * rr / ta, a[1] + (pr[1] - a[1]) * rr / ta], s2 = [a[0] + (b[0] - a[0]) * rr / tb, a[1] + (b[1] - a[1]) * rr / tb];
      if (i === 0) x.moveTo(s1[0], s1[1]); else x.lineTo(s1[0], s1[1]);
      x.quadraticCurveTo(a[0], a[1], s2[0], s2[1]);
    }
    x.closePath();
  };
  const warm = rnd() < 0.12, l = 16 + rnd() * 13, hue = warm ? 30 + rnd() * 10 : 205 + rnd() * 25, sat = warm ? 6 + rnd() * 5 : 4 + rnd() * 6;
  const gr = x.createLinearGradient(x0, y0, x0 + sw, y0 + sh);
  gr.addColorStop(0, `hsl(${hue},${sat}%,${l + 6}%)`); gr.addColorStop(1, `hsl(${hue},${sat}%,${l - 4}%)`);
  path(); x.fillStyle = gr; x.fill();
  x.save(); path(); x.clip();
  // worn centre and bevelled edges
  const cg = x.createRadialGradient(x0 + sw * (0.3 + rnd() * 0.4), y0 + sh * (0.3 + rnd() * 0.4), 0, x0 + sw / 2, y0 + sh / 2, Math.max(sw, sh) * 0.7);
  cg.addColorStop(0, 'rgba(255,255,255,.05)'); cg.addColorStop(1, 'rgba(0,0,0,.18)'); x.fillStyle = cg; x.fillRect(x0, y0, sw, sh);
  // stone grain: a patch of the noise tile at a random offset, so neighbours differ
  x.globalCompositeOperation = 'soft-light'; x.globalAlpha = 0.55;
  x.drawImage(bsNoise(), rnd() * 128, rnd() * 128, 128, 128, x0, y0, sw, sh);
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  x.lineWidth = s * 0.08;
  x.translate(s * 0.022, s * 0.022); path(); x.strokeStyle = 'rgba(255,255,255,.085)'; x.stroke();
  x.translate(-s * 0.044, -s * 0.044); path(); x.strokeStyle = 'rgba(0,0,0,.5)'; x.stroke();
  x.translate(s * 0.022, s * 0.022);
  // chipped edges
  const chips = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < chips; i++) {
    const side = Math.floor(rnd() * 4), t = 0.15 + rnd() * 0.7;
    const cx = side === 0 ? x0 + sw * t : side === 1 ? x0 + sw - gap : side === 2 ? x0 + sw * t : x0 + gap;
    const cy = side === 0 ? y0 + gap : side === 1 ? y0 + sh * t : side === 2 ? y0 + sh - gap : y0 + sh * t;
    x.beginPath(); x.ellipse(cx, cy, s * (0.03 + rnd() * 0.05), s * (0.02 + rnd() * 0.03), rnd() * Math.PI, 0, BS_TAU);
    x.fillStyle = 'rgba(8,9,12,.75)'; x.fill();
  }
  const pits = Math.round(sw * sh / (s * s) * 14);
  for (let i = 0; i < pits; i++) {
    x.beginPath(); x.arc(x0 + rnd() * sw, y0 + rnd() * sh, s * (0.004 + rnd() * 0.012), 0, BS_TAU);
    x.fillStyle = rnd() < 0.7 ? 'rgba(0,0,0,.3)' : 'rgba(255,255,255,.06)'; x.fill();
  }
  if (rnd() < 0.16) {
    let cx = x0 + sw * (0.1 + rnd() * 0.3), cy = y0 + sh * (0.1 + rnd() * 0.8); const ang = (rnd() - 0.5) * 1.2;
    x.beginPath(); x.moveTo(cx, cy);
    for (let i = 0; i < 6; i++) { cx += Math.cos(ang + (rnd() - 0.5) * 1.4) * s * 0.14; cy += Math.sin(ang + (rnd() - 0.5) * 1.4) * s * 0.14; x.lineTo(cx, cy); }
    x.lineWidth = s * 0.011; x.strokeStyle = 'rgba(0,0,0,.5)'; x.stroke();
    x.translate(0.6, 0.6); x.strokeStyle = 'rgba(255,255,255,.05)'; x.stroke();
  }
  x.restore();
}
function bsPlanks(x, w, h, s, rnd) {
  x.fillStyle = '#140d08'; x.fillRect(0, 0, w, h);
  const ph = s / 2.5;
  for (let y = 0; y < h; y += ph) {
    let xx = -rnd() * s * 3;
    while (xx < w) { const len = s * (2.2 + rnd() * 3.6); bsPlank(x, xx, y, len, ph, rnd); xx += len; }
  }
  bsTexture(x, w, h, 0.22, 'overlay');
  bsBlotches(x, w, h, s, rnd, Math.round(w * h / (s * s) / 18) + 3, ['rgba(20,10,4,.35)', 'rgba(0,0,0,.25)'], 'multiply');
  bsVignette(x, w, h, 'rgba(0,0,0,.55)');
}
function bsPlank(x, x0, y0, len, ph, rnd) {
  const hue = 22 + rnd() * 12, sat = 32 + rnd() * 14, l = 19 + rnd() * 10, gap = Math.max(1, ph * 0.045);
  const gr = x.createLinearGradient(0, y0, 0, y0 + ph);
  gr.addColorStop(0, `hsl(${hue},${sat}%,${l + 3}%)`); gr.addColorStop(0.5, `hsl(${hue},${sat}%,${l + 5}%)`); gr.addColorStop(1, `hsl(${hue},${sat}%,${l - 5}%)`);
  x.fillStyle = gr; x.fillRect(x0 + gap, y0 + gap, len - gap * 2, ph - gap * 2);
  x.save(); x.beginPath(); x.rect(x0 + gap, y0 + gap, len - gap * 2, ph - gap * 2); x.clip();
  const lines = 7 + Math.floor(rnd() * 7);
  for (let i = 0; i < lines; i++) {
    const yy = y0 + ph * (0.1 + rnd() * 0.8), amp = ph * (0.03 + rnd() * 0.08), fr = 2 + rnd() * 4, ph0 = rnd() * BS_TAU;
    x.beginPath();
    for (let t = 0; t <= 1.0001; t += 0.05) { const px = x0 + t * len, py = yy + Math.sin(t * fr + ph0) * amp; t === 0 ? x.moveTo(px, py) : x.lineTo(px, py); }
    x.lineWidth = ph * (0.015 + rnd() * 0.04); x.strokeStyle = `hsla(${hue},${sat}%,${l - 9}%,${0.25 + rnd() * 0.3})`; x.stroke();
  }
  if (rnd() < 0.3) {
    const kx = x0 + len * (0.2 + rnd() * 0.6), ky = y0 + ph * (0.3 + rnd() * 0.4);
    for (let i = 3; i > 0; i--) { x.beginPath(); x.ellipse(kx, ky, ph * 0.12 * i, ph * 0.06 * i, 0, 0, BS_TAU); x.strokeStyle = `hsla(${hue},${sat}%,${l - 10}%,.45)`; x.lineWidth = ph * 0.02; x.stroke(); }
  }
  x.restore();
  for (const nx of [x0 + ph * 0.35, x0 + len - ph * 0.35]) for (const ny of [y0 + ph * 0.3, y0 + ph * 0.7]) {
    x.beginPath(); x.arc(nx, ny, ph * 0.045, 0, BS_TAU); x.fillStyle = 'rgba(0,0,0,.6)'; x.fill();
    x.beginPath(); x.arc(nx - ph * 0.01, ny - ph * 0.01, ph * 0.02, 0, BS_TAU); x.fillStyle = 'rgba(255,230,200,.12)'; x.fill();
  }
}
function bsParchment(x, w, h, s, rnd) {
  x.fillStyle = '#d9c49b'; x.fillRect(0, 0, w, h);
  bsBlotches(x, w, h, s, rnd, Math.round(w * h / (s * s) / 6) + 8, ['rgba(160,118,62,.13)', 'rgba(255,246,222,.18)', 'rgba(120,84,40,.09)']);
  x.save(); x.globalAlpha = 0.06; x.strokeStyle = '#5a4020'; x.lineWidth = 1;
  for (let i = 0; i < w * h / 900; i++) { const px = rnd() * w, py = rnd() * h, a = rnd() * BS_TAU, l = 4 + rnd() * 14; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
  x.restore();
  bsTexture(x, w, h, 0.18, 'multiply');
  for (let i = 0; i < 2; i++) {
    const cx = rnd() * w, cy = rnd() * h, r = s * (0.8 + rnd() * 1.2);
    x.beginPath(); x.arc(cx, cy, r, 0, BS_TAU); x.strokeStyle = 'rgba(120,80,30,.12)'; x.lineWidth = s * 0.06; x.stroke();
  }
  bsVignette(x, w, h, 'rgba(96,60,22,.55)');
}

// ---------- token sprites (cached bitmaps; rings, HP and labels are drawn live) ----------
const BS_SPRITES = new Map();
function bsSprite(info, px, onReady) {
  const imgE = info.img ? bsImage(info.img, onReady) : null;
  const key = `${imgE ? 'i:' + info.img : 'g:' + info.base + info.emoji}|${info.kind}|${info.down ? 1 : 0}|${px}`;
  let c = BS_SPRITES.get(key);
  if (c) return c;
  c = bsCanvas(px, px);
  const x = c.getContext('2d'), r = px / 2;
  x.save(); x.beginPath(); x.arc(r, r, r, 0, BS_TAU); x.clip();
  if (imgE) {
    const im = imgE.img, k = Math.max(px / im.width, px / im.height);
    x.imageSmoothingQuality = 'high';
    x.drawImage(im, r - im.width * k / 2, r - im.height * k / 2, im.width * k, im.height * k);
  } else {
    const list = BS_KIND_PALETTES[info.kind] || BS_KIND_PALETTES.neutral;
    const pal = BS_PALETTES[list[bsHash(info.base) % list.length]];
    const g = x.createRadialGradient(r * 0.72, r * 0.55, r * 0.05, r, r, r * 1.08);
    g.addColorStop(0, pal[0]); g.addColorStop(0.55, pal[1]); g.addColorStop(1, pal[2]);
    x.fillStyle = g; x.fillRect(0, 0, px, px);
    x.globalCompositeOperation = 'overlay'; x.globalAlpha = 0.18; x.fillStyle = x.createPattern(bsNoise(), 'repeat'); x.fillRect(0, 0, px, px);
    x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
    x.beginPath(); x.arc(r, r, r * 0.8, 0, BS_TAU); x.lineWidth = Math.max(1, px * 0.012); x.strokeStyle = 'rgba(255,255,255,.16)'; x.stroke();
    x.beginPath(); x.arc(r, r, r * 0.76, 0, BS_TAU); x.strokeStyle = 'rgba(0,0,0,.18)'; x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.shadowColor = 'rgba(0,0,0,.55)'; x.shadowBlur = px * 0.04; x.shadowOffsetY = px * 0.015;
    if (info.emoji) {
      x.font = `${Math.round(px * 0.46)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
      x.fillText(info.emoji, r, r * 1.04);
    } else {
      const txt = bsInitials(info.base);
      x.font = `700 ${Math.round(px * (txt.length > 1 ? 0.4 : 0.48))}px "Cormorant Garamond", Georgia, serif`;
      x.fillStyle = 'rgba(255,250,240,.94)'; x.fillText(txt, r, r * 1.04);
    }
    x.shadowColor = 'transparent';
  }
  // inner shadow + soft top light: a coin, not a sticker
  const v = x.createRadialGradient(r, r * 0.85, r * 0.55, r, r, r * 1.02);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.42)'); x.fillStyle = v; x.fillRect(0, 0, px, px);
  const hl = x.createLinearGradient(0, 0, 0, px); hl.addColorStop(0, 'rgba(255,255,255,.14)'); hl.addColorStop(0.45, 'rgba(255,255,255,0)'); x.fillStyle = hl; x.fillRect(0, 0, px, px);
  if (info.down) {
    x.globalCompositeOperation = 'saturation'; x.fillStyle = '#808080'; x.fillRect(0, 0, px, px);
    x.globalCompositeOperation = 'multiply'; x.fillStyle = '#6a6a6a'; x.fillRect(0, 0, px, px);
    x.globalCompositeOperation = 'source-over';
  }
  x.restore();
  if (BS_SPRITES.size > 400) BS_SPRITES.clear();
  BS_SPRITES.set(key, c);
  return c;
}
let BS_SHADOW = null;
function bsShadow() {
  if (BS_SHADOW) return BS_SHADOW;
  const c = bsCanvas(128, 128), x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 20, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(0.6, 'rgba(0,0,0,.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return (BS_SHADOW = c);
}
/* Draw a token disc with its ring into an HTML canvas (tray, initiative strip, display ribbon). */
function bsDisc(canvas, info, cssPx, opts = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5), px = Math.round(cssPx * dpr);
  canvas.width = px; canvas.height = px; canvas.style.width = cssPx + 'px'; canvas.style.height = cssPx + 'px';
  const x = canvas.getContext('2d'), ring = Math.max(2, px * 0.07), R = px / 2;
  const sp = bsSprite(info, bsBucket(px), () => bsDisc(canvas, info, cssPx, opts));
  x.clearRect(0, 0, px, px);
  x.drawImage(sp, ring * 0.6, ring * 0.6, px - ring * 1.2, px - ring * 1.2);
  x.beginPath(); x.arc(R, R, R - ring / 2, 0, BS_TAU); x.lineWidth = ring; x.strokeStyle = bsRingStyle(x, R, R, R, opts.ring || (info.down ? '#6b7280' : BS_KINDS[info.kind].ring)); x.stroke();
  x.beginPath(); x.arc(R, R, R - ring - 0.5, 0, BS_TAU); x.lineWidth = 1; x.strokeStyle = 'rgba(0,0,0,.45)'; x.stroke();
  if (info.down) bsCross(x, R, R, R * 0.55, Math.max(2, px * 0.07));
  return canvas;
}
const bsBucket = px => px <= 72 ? 72 : px <= 144 ? 144 : px <= 288 ? 288 : 512;
function bsCross(x, cx, cy, r, lw) {
  x.save(); x.lineCap = 'round';
  for (const [col, w] of [['rgba(0,0,0,.65)', lw + 3], ['#f26d6d', lw]]) {
    x.beginPath(); x.moveTo(cx - r, cy - r); x.lineTo(cx + r, cy + r); x.moveTo(cx + r, cy - r); x.lineTo(cx - r, cy + r);
    x.strokeStyle = col; x.lineWidth = w; x.stroke();
  }
  x.restore();
}
function bsRoundRect(x, X, Y, W, H, r) { x.beginPath(); x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); }
function bsPill(x, text, cx, top, opt = {}) {
  const fs = opt.size || 12, padX = fs * 0.62, h = Math.round(fs * 1.62);
  x.font = `${opt.weight || 600} ${fs}px Inter, -apple-system, "Segoe UI", Roboto, sans-serif`;
  if (opt.max && x.measureText(text).width > opt.max) { while (text.length > 2 && x.measureText(text + '…').width > opt.max) text = text.slice(0, -1); text = text.trimEnd() + '…'; }
  const w = Math.ceil(x.measureText(text).width) + padX * 2 + (opt.dot ? fs * 0.8 : 0);
  const X = Math.round(cx - w / 2), Y = Math.round(top);
  bsRoundRect(x, X, Y, w, h, h / 2);
  x.fillStyle = opt.bg || 'rgba(12,14,20,.8)'; x.fill();
  x.lineWidth = 1; x.strokeStyle = opt.border || 'rgba(255,255,255,.12)'; x.stroke();
  let tx = X + padX;
  if (opt.dot) { x.beginPath(); x.arc(tx + fs * 0.25, Y + h / 2, fs * 0.25, 0, BS_TAU); x.fillStyle = opt.dot; x.fill(); tx += fs * 0.8; }
  x.fillStyle = opt.color || '#f3f4f6'; x.textAlign = 'left'; x.textBaseline = 'middle';
  x.fillText(text, tx, Y + h / 2 + 0.5);
  return { x: X, y: Y, w, h };
}

/* ---------- the view ----------
   new BattleView(canvas, { player }) — player = the TV: no hidden tokens, no DM-only drawings,
   no HP numbers, fog drawn as solid darkness. Set data with setScene / setEncounter / setChars and
   transient overlays through view.live; call request() after changing anything. */
class BattleView {
  constructor(canvas, opts = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.player = !!opts.player;
    this.cam = { x: 0, y: 0, z: 1 };
    this.scene = null; this.enc = null; this.chars = []; this.turnId = null; this.rule = '5';
    this.sel = new Set(); this.hover = null; this.selDrawing = null;
    this.live = { drag: null, ruler: null, previews: [], marquee: null, fogDraft: null, calib: null };
    this.pings = []; this.tweens = new Map(); this.lastPos = new Map();
    this.dpr = 1; this.W = 0; this.H = 0; this.raf = 0; this.dirty = true;
    this.onCamera = null; this.onFrame = null;
    this._fog = { sig: null }; this._fogSig = ''; this._tmp = null; this._hatch = null;
    this._loop = this._loop.bind(this);
    this._redraw = () => this.request();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement);
    this.resize();
  }
  destroy() { this.dead = true; this.ro.disconnect(); if (this.raf) cancelAnimationFrame(this.raf); }
  resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5), W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    const had = this.W > 1;
    const c = had ? this.toScene(this.W / 2, this.H / 2) : null;
    this.W = W; this.H = H; this.dpr = dpr;
    this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr);
    this.cv.style.width = W + 'px'; this.cv.style.height = H + 'px';
    this._tmp = null;
    if (had && c) { this.cam.x = W / 2 - c[0] * this.cam.z; this.cam.y = H / 2 - c[1] * this.cam.z; }
    this.request(true);
  }
  toScene(sx, sy) { return [(sx - this.cam.x) / this.cam.z, (sy - this.cam.y) / this.cam.z]; }
  toScreen(x, y) { return [x * this.cam.z + this.cam.x, y * this.cam.z + this.cam.y]; }
  viewRect() { return { x: -this.cam.x / this.cam.z, y: -this.cam.y / this.cam.z, w: this.W / this.cam.z, h: this.H / this.cam.z }; }
  camFor(rect, pad = {}) {
    const t = pad.t || 0, r = pad.r || 0, b = pad.b || 0, l = pad.l || 0;
    const aw = Math.max(40, this.W - l - r), ah = Math.max(40, this.H - t - b);
    const z = bsClamp(Math.min(aw / Math.max(1, rect.w), ah / Math.max(1, rect.h)), 0.02, 12);
    return { z, x: l + aw / 2 - (rect.x + rect.w / 2) * z, y: t + ah / 2 - (rect.y + rect.h / 2) * z };
  }
  setCam(c, silent) { this.cam = { x: c.x, y: c.y, z: c.z }; this.request(); if (!silent && this.onCamera) this.onCamera(); }
  setScene(sc) {
    const same = sc && this.scene && sc.id === this.scene.id;
    if (same) {
      // glide tokens whose position changed (remote moves, snapping after a drop)
      const now = performance.now();
      for (const t of sc.tokens || []) {
        const last = this.lastPos.get(t.id);
        if (last && (Math.abs(last[0] - t.x) > 0.5 || Math.abs(last[1] - t.y) > 0.5) && !(this.live.drag && this.live.drag.pos.has(t.id)))
          this.tweens.set(t.id, { from: last, to: [t.x, t.y], t0: now, dur: Math.min(420, 160 + Math.hypot(last[0] - t.x, last[1] - t.y) / bsGrid(sc).size * 40) });
      }
    } else { this.tweens.clear(); this.lastPos.clear(); this.sel.clear(); this.selDrawing = null; }
    this.scene = sc;
    this._fogSig = sc ? sc.id + '|' + JSON.stringify(sc.fog || null) + '|' + JSON.stringify(bsSceneSize(sc)) + '|' + bsGrid(sc).size : '';
    this.request();
  }
  setEncounter(enc) {
    this.enc = enc;
    const c = enc && (enc.combatants || [])[enc.turn || 0], id = c && c.id || null;
    if (id !== this.turnId) { this.turnSince = performance.now(); clearTimeout(this._glowT); this._glowT = setTimeout(() => this.request(), 8050); } // last frame: the glow at rest
    this.turnId = id;
    this.request();
  }
  setChars(chars) { this.chars = chars || []; this.request(); }
  ping(x, y, color) { this.pings.push({ x, y, color: color || '#f2c15e', t0: performance.now() }); this.request(); }
  // request(true) draws synchronously (after a resize, so the cleared canvas never shows)
  request(now) {
    this.dirty = true;
    if (this.dead) return;
    if (now && this.W > 1) { const anim = this.draw(performance.now()); this.dirty = false; if (!anim) return; }
    if (!this.raf) this.raf = requestAnimationFrame(this._loop);
  }
  _loop(t) {
    this.raf = 0;
    if (this.dead || !this.cv.isConnected) { if (!this.cv.isConnected) this.destroy(); return; }
    let anim = false;
    if (this.onFrame) anim = this.onFrame(t) || anim;
    anim = this.draw(t) || anim;
    this.dirty = false;
    if (anim && !this.raf) this.raf = requestAnimationFrame(this._loop);
  }

  // which tokens are drawn, where (live drag, tweens) and in what order
  tokenList() {
    const sc = this.scene; if (!sc) return [];
    const now = performance.now(), out = [];
    for (const t of sc.tokens || []) {
      if (this.player && t.hidden) continue;
      let x = t.x, y = t.y;
      const d = this.live.drag && this.live.drag.pos.get(t.id);
      if (d) { x = d[0]; y = d[1]; this.tweens.delete(t.id); }
      else {
        const tw = this.tweens.get(t.id);
        if (tw) {
          const k = bsEase((now - tw.t0) / tw.dur);
          if (k >= 1 || Math.abs(tw.to[0] - t.x) > 0.5 || Math.abs(tw.to[1] - t.y) > 0.5) this.tweens.delete(t.id);
          else { x = tw.from[0] + (tw.to[0] - tw.from[0]) * k; y = tw.from[1] + (tw.to[1] - tw.from[1]) * k; }
        }
      }
      out.push({ t, x, y, r: bsTokenRadius(sc, t), dragging: !!d });
    }
    out.sort((a, b) => (b.r - a.r) || ((this.sel.has(a.t.id) ? 1 : 0) - (this.sel.has(b.t.id) ? 1 : 0)) || ((a.dragging ? 1 : 0) - (b.dragging ? 1 : 0)));
    return out;
  }
  hitToken(sx, sy) {
    const [x, y] = this.toScene(sx, sy), list = this.tokenList();
    for (let i = list.length - 1; i >= 0; i--) { const e = list[i]; if (Math.hypot(x - e.x, y - e.y) <= Math.max(e.r, 10 / this.cam.z)) return e.t; }
    return null;
  }
  tokensIn(rect) {
    return this.tokenList().filter(e => e.x >= rect.x && e.x <= rect.x + rect.w && e.y >= rect.y && e.y <= rect.y + rect.h).map(e => e.t);
  }
  drawingList() { const sc = this.scene; return sc ? (sc.drawings || []).filter(d => !(this.player && d.dmOnly)) : []; }
  hitDrawing(sx, sy) {
    const sc = this.scene; if (!sc) return null;
    const [x, y] = this.toScene(sx, sy), tol = 7 / this.cam.z, list = this.drawingList();
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      if (d.type === 'template') { if (bsTplContains(bsTpl(sc, d), x, y, tol)) return d; continue; }
      const w = (d.width || 4) / 2 + tol, p = d.pts || [];
      if (d.type === 'path' || d.type === 'line') { for (let k = 1; k < p.length; k++) if (bsDistSeg(x, y, p[k - 1], p[k]) <= w) return d; if (p.length === 1 && Math.hypot(x - p[0][0], y - p[0][1]) <= w) return d; }
      else if (d.type === 'rect' && p.length > 1) {
        const x0 = Math.min(p[0][0], p[1][0]), x1 = Math.max(p[0][0], p[1][0]), y0 = Math.min(p[0][1], p[1][1]), y1 = Math.max(p[0][1], p[1][1]);
        const inside = x >= x0 - w && x <= x1 + w && y >= y0 - w && y <= y1 + w;
        const nearEdge = inside && (x <= x0 + w || x >= x1 - w || y <= y0 + w || y >= y1 - w);
        if (d.fill ? inside : nearEdge) return d;
      } else if (d.type === 'circle' && p.length > 1) {
        const R = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), dd = Math.hypot(x - p[0][0], y - p[0][1]);
        if (d.fill ? dd <= R + w : Math.abs(dd - R) <= w) return d;
      }
    }
    return null;
  }

  // ---------- frame ----------
  draw(now) {
    const { ctx, dpr, W, H } = this, sc = this.scene;
    let anim = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // on the TV, beyond the map edge is the same darkness as the fog, so there is no seam
    ctx.fillStyle = this.player && sc && sc.fog && sc.fog.on ? '#05070b' : BS_BACKDROP; ctx.fillRect(0, 0, W, H);
    if (!sc) return false;
    const { w, h } = bsSceneSize(sc), z = this.cam.z;
    const [mx, my] = this.toScreen(0, 0);
    // soft drop shadow under the map
    for (let i = 1; i <= 7; i++) { ctx.strokeStyle = `rgba(0,0,0,${0.09 - i * 0.011})`; ctx.lineWidth = 4; ctx.strokeRect(mx - i * 4 + 2, my - i * 4 + 6, w * z + i * 8 - 4, h * z + i * 8 - 4); }
    this.drawBackground(sc, w, h);
    this.drawGrid(sc, w, h);
    const drawings = this.drawingList();
    for (const d of drawings) if (d.type === 'template') this.drawTemplate(sc, d, d === this.selDrawing);
    for (const d of drawings) if (d.type !== 'template') this.drawShape(sc, d, d === this.selDrawing);
    anim = this.drawTokens(sc, now) || anim;
    this.drawFog(sc, w, h);
    anim = this.drawOverlays(sc, now) || anim;
    return anim;
  }
  bgSource(sc) {
    if (sc.bg) {
      const e = bsImage(sc.bg, this._redraw);
      if (!e) return null;
      if (!e.mips) e.mips = bsMips(e.img);
      return { mips: e.mips, scale: e.img.width / bsSceneSize(sc).w };
    }
    return bsFloor(sc);
  }
  drawBackground(sc, w, h) {
    const { ctx, dpr, cam } = this, src = this.bgSource(sc);
    const vr = this.viewRect(), x0 = Math.max(0, vr.x), y0 = Math.max(0, vr.y), x1 = Math.min(w, vr.x + vr.w), y1 = Math.min(h, vr.y + vr.h);
    ctx.save(); ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.x, dpr * cam.y);
    if (!src) {
      ctx.fillStyle = '#171a22'; ctx.fillRect(0, 0, w, h);
      const t = (performance.now() / 1400) % 1, gx = -w + t * w * 3;
      const g = ctx.createLinearGradient(gx, 0, gx + w, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.5, 'rgba(255,255,255,.04)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h); ctx.restore(); this.request(); return;
    }
    if (x1 > x0 && y1 > y0) {
      const need = cam.z * dpr;
      const lvl = bsClamp(Math.floor(Math.log2(src.scale / need)), 0, src.mips.length - 1);
      const img = src.mips[lvl], k = img.width / w; // texels per scene px at this level
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = need < src.scale ? 'high' : 'medium';
      const sx = Math.max(0, Math.floor(x0 * k)), sy = Math.max(0, Math.floor(y0 * k)), sw = Math.min(img.width - sx, Math.ceil((x1 - x0) * k) + 2), sh = Math.min(img.height - sy, Math.ceil((y1 - y0) * k) + 2);
      if (sw > 0 && sh > 0) ctx.drawImage(img, sx, sy, sw, sh, sx / k, sy / k, sw / k, sh / k);
    }
    ctx.restore();
  }
  drawGrid(sc, w, h) {
    const g = bsGrid(sc); if (!g.show || g.opacity <= 0) return;
    const { ctx, cam, dpr } = this, s = g.size * cam.z;
    const fade = bsClamp((s - 7) / 16, 0, 1) * g.opacity; if (fade <= 0.01) return;
    const vr = this.viewRect();
    const x0 = Math.max(0, vr.x), x1 = Math.min(w, vr.x + vr.w), y0 = Math.max(0, vr.y), y1 = Math.min(h, vr.y + vr.h);
    if (x1 <= x0 || y1 <= y0) return;
    const al = v => (Math.round(v * dpr) + 0.5) / dpr;
    const [, ty0] = this.toScreen(0, y0), [, ty1] = this.toScreen(0, y1), [tx0] = this.toScreen(x0, 0), [tx1] = this.toScreen(x1, 0);
    ctx.beginPath();
    for (let k = Math.ceil((x0 - g.offsetX) / g.size); g.offsetX + k * g.size <= x1; k++) { const X = al(this.toScreen(g.offsetX + k * g.size, 0)[0]); ctx.moveTo(X, ty0); ctx.lineTo(X, ty1); }
    for (let k = Math.ceil((y0 - g.offsetY) / g.size); g.offsetY + k * g.size <= y1; k++) { const Y = al(this.toScreen(0, g.offsetY + k * g.size)[1]); ctx.moveTo(tx0, Y); ctx.lineTo(tx1, Y); }
    ctx.lineWidth = 2 / dpr + 0.6; ctx.strokeStyle = `rgba(0,0,0,${0.5 * fade})`; ctx.stroke();
    ctx.lineWidth = 1 / dpr; ctx.strokeStyle = `rgba(255,255,255,${0.26 * fade})`; ctx.stroke();
  }
  drawTemplate(sc, d, selected, preview) {
    const { ctx } = this, g = bsTpl(sc, d), col = d.color || '#f97316', z = this.cam.z;
    ctx.save();
    // affected squares, then the true shape on top with a crisp edge
    const s = bsGrid(sc).size * z;
    if (s >= 8) { ctx.fillStyle = bsRgba(col, 0.14); for (const [cx, cy] of bsTplCells(sc, g)) { const [X, Y] = this.toScreen(cx, cy); ctx.fillRect(X + 1, Y + 1, s - 2, s - 2); } }
    const [ox, oy] = this.toScreen(g.o[0], g.o[1]);
    ctx.beginPath();
    if (g.r != null) ctx.arc(ox, oy, g.r * z, 0, BS_TAU);
    else g.poly.forEach((p, i) => { const [X, Y] = this.toScreen(p[0], p[1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.closePath();
    const gr = ctx.createRadialGradient(ox, oy, 0, ox, oy, Math.max(4, g.L * z));
    gr.addColorStop(0, bsRgba(col, 0.42)); gr.addColorStop(1, bsRgba(col, 0.16));
    ctx.fillStyle = gr; ctx.fill();
    ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
    ctx.lineWidth = 1.75; ctx.strokeStyle = col; ctx.stroke();
    ctx.beginPath(); ctx.arc(ox, oy, 3.5, 0, BS_TAU); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke();
    if (selected || preview) {
      const [ex, ey] = this.toScreen(g.e[0], g.e[1]);
      if (selected && !this.player) { ctx.beginPath(); ctx.arc(ex, ey, 6, 0, BS_TAU); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke(); }
      const lx = g.r != null ? ox : (ox + ex) / 2, ly = g.r != null ? oy - g.r * z - 26 : (oy + ey) / 2 - 12;
      bsPill(ctx, `${g.ft} ft ${BS_TPL_NAMES[g.shape] || ''}`, lx, ly, { size: this.player ? 18 : 12, dot: col });
    }
    ctx.restore();
  }
  drawShape(sc, d, selected) {
    const { ctx } = this, z = this.cam.z, p = (d.pts || []).map(q => this.toScreen(q[0], q[1]));
    if (!p.length) return;
    const col = d.color || '#f8fafc', lw = Math.max(1, (d.width || 4) * z);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (d.type === 'path') {
      ctx.moveTo(p[0][0], p[0][1]);
      if (p.length < 3) p.slice(1).forEach(q => ctx.lineTo(q[0], q[1])); else { for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2); ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]); }
      if (p.length === 1) ctx.lineTo(p[0][0] + 0.01, p[0][1]);
    } else if (d.type === 'line') { ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo((p[1] || p[0])[0], (p[1] || p[0])[1]); }
    else if (d.type === 'rect' && p[1]) ctx.rect(Math.min(p[0][0], p[1][0]), Math.min(p[0][1], p[1][1]), Math.abs(p[1][0] - p[0][0]), Math.abs(p[1][1] - p[0][1]));
    else if (d.type === 'circle' && p[1]) ctx.arc(p[0][0], p[0][1], Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), 0, BS_TAU);
    if (d.fill && (d.type === 'rect' || d.type === 'circle')) { ctx.fillStyle = bsRgba(col, 0.2); ctx.fill(); }
    if (d.dmOnly && !this.player) ctx.setLineDash([lw * 2.2, lw * 1.8]);
    ctx.lineWidth = lw + 2.5; ctx.strokeStyle = 'rgba(0,0,0,.28)'; ctx.stroke();
    ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.stroke();
    if (selected) { ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); }
    ctx.restore();
  }
  drawTokens(sc, now) {
    const { ctx, dpr } = this, list = this.tokenList(), lbl = [];
    let anim = this.tweens.size > 0;
    this.lastPos.clear();
    for (const e of list) {
      const t = e.t, info = bsTokenInfo(t, this.enc, this.chars, this.turnId), [X, Y] = this.toScreen(e.x, e.y), R = e.r * this.cam.z;
      this.lastPos.set(t.id, [e.x, e.y]);
      if (X + R * 2 < 0 || Y + R * 2 < 0 || X - R * 2 > this.W || Y - R * 3 > this.H) continue;
      const ringCol = BS_KINDS[info.kind].ring, hidden = !!t.hidden;
      ctx.save();
      if (hidden) ctx.globalAlpha = 0.5;
      const lift = e.dragging ? 1.12 : 1;
      ctx.drawImage(bsShadow(), X - R * 1.3, Y - R * 1.3 + R * 0.16 * lift, R * 2.6, R * 2.6 * lift);
      if (info.turn && !info.down) {
        // pulse for a few seconds when the turn arrives, then hold still (no redraws while idle)
        const live = now - (this.turnSince || 0) < 8000;
        const pulse = live ? 0.5 + 0.5 * Math.sin(now / 420) : 0.6;
        ctx.save(); ctx.shadowColor = 'rgba(242,193,94,.95)'; ctx.shadowBlur = R * (0.5 + 0.35 * pulse) + 6;
        ctx.beginPath(); ctx.arc(X, Y, R, 0, BS_TAU); ctx.fillStyle = '#f2c15e'; ctx.fill(); ctx.restore();
        ctx.save(); ctx.beginPath(); ctx.arc(X, Y, R + Math.max(5, R * 0.16), 0, BS_TAU); ctx.setLineDash([Math.max(4, R * 0.22), Math.max(3, R * 0.14)]);
        ctx.lineDashOffset = live ? -now / 60 : 0; ctx.lineWidth = Math.max(1.5, R * 0.05); ctx.strokeStyle = 'rgba(242,193,94,.9)'; ctx.stroke(); ctx.restore();
        if (live) anim = true;
      }
      const px = bsBucket(R * 2 * dpr);
      const sp = bsSprite(info, px, this._redraw);
      const ring = bsClamp(R * 0.11, 1.5, 7);
      ctx.drawImage(sp, X - R + ring * 0.5, Y - R + ring * 0.5, R * 2 - ring, R * 2 - ring);
      ctx.beginPath(); ctx.arc(X, Y, R - ring / 2, 0, BS_TAU); ctx.lineWidth = ring;
      ctx.strokeStyle = bsRingStyle(ctx, X, Y, R, info.down ? '#6b7280' : ringCol); ctx.stroke();
      ctx.beginPath(); ctx.arc(X, Y, R, 0, BS_TAU); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.stroke();
      ctx.beginPath(); ctx.arc(X, Y, R - ring + 0.5, 0, BS_TAU); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(0,0,0,.35)'; ctx.stroke();
      if (hidden) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(X, Y, R + 3, 0, BS_TAU); ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.stroke(); ctx.setLineDash([]); }
      if (info.bloodied && this.player) { ctx.beginPath(); ctx.arc(X, Y, R - ring - 1, Math.PI * 0.15, Math.PI * 0.85); ctx.lineWidth = Math.max(2, R * 0.08); ctx.strokeStyle = 'rgba(214,40,40,.75)'; ctx.stroke(); }
      if (!this.player && info.hp) {
        // HP arc, DM only: a thin gauge just outside the ring, clockwise from twelve o'clock
        const f = bsClamp(info.hp.hp / info.hp.max, 0, 1), lw = bsClamp(R * 0.065, 2, 3.5), rr = R + 2.5 + lw / 2;
        ctx.beginPath(); ctx.arc(X, Y, rr, 0, BS_TAU); ctx.lineWidth = lw + 2; ctx.strokeStyle = 'rgba(8,10,14,.72)'; ctx.stroke();
        if (f > 0) { ctx.beginPath(); ctx.arc(X, Y, rr, -Math.PI / 2, -Math.PI / 2 + BS_TAU * f); ctx.lineWidth = lw; ctx.lineCap = f < 1 ? 'round' : 'butt'; ctx.strokeStyle = f > 0.5 ? '#5ee39a' : f > 0.25 ? '#f5b942' : '#f05252'; ctx.stroke(); ctx.lineCap = 'butt'; }
      }
      if (info.down) bsCross(ctx, X, Y, R * 0.5, Math.max(2, R * 0.12));
      if (this.sel.has(t.id) && !this.player) {
        ctx.beginPath(); ctx.arc(X, Y, R + (info.hp ? 9 : 4) + 2, 0, BS_TAU); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.beginPath(); ctx.arc(X, Y, R + (info.hp ? 9 : 4) + 5, 0, BS_TAU); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(127,209,201,.35)'; ctx.stroke();
      } else if (this.hover === t.id && !this.player) {
        ctx.beginPath(); ctx.arc(X, Y, R + (info.hp ? 9 : 4) + 2, 0, BS_TAU); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.stroke();
      }
      if (info.num && R >= 9) {
        const br = bsClamp(R * 0.3, 7, 13), bx = X + R * 0.72, by = Y + R * 0.72;
        ctx.beginPath(); ctx.arc(bx, by, br, 0, BS_TAU); ctx.fillStyle = '#10131a'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = ringCol; ctx.stroke();
        ctx.font = `700 ${Math.round(br * 1.15)}px Inter, -apple-system, sans-serif`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(info.num, bx, by + 0.5);
      }
      if (hidden) {
        const bx = X + R * 0.72, by = Y - R * 0.72, br = bsClamp(R * 0.28, 7, 12);
        ctx.beginPath(); ctx.arc(bx, by, br, 0, BS_TAU); ctx.fillStyle = '#10131a'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx - br * 0.55, by + br * 0.55); ctx.lineTo(bx + br * 0.55, by - br * 0.55); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(bx, by, br * 0.55, br * 0.32, 0, 0, BS_TAU); ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.restore();
      const focus = this.sel.has(t.id) || this.hover === t.id || e.dragging || info.turn;
      if (R >= 9 && (R >= (this.player ? 24 : 21) || (focus && !this.player))) lbl.push({ text: info.name, X, R, focus, top: Y + R + (info.hp && !this.player ? 8 : 5), kind: info.kind, dim: info.down || hidden, turn: info.turn });
    }
    // name pills last so neighbours never cover them
    const fs = this.player ? 17 : 11.5;
    for (const l of lbl) {
      ctx.save(); if (l.dim) ctx.globalAlpha = 0.6;
      bsPill(ctx, l.text, l.X, l.top, { size: fs, dot: BS_KINDS[l.kind].ring, border: l.turn ? 'rgba(242,193,94,.8)' : undefined, max: l.focus ? 0 : Math.max(l.R * 2.4, fs * 6) });
      ctx.restore();
    }
    return anim;
  }
  hatch() {
    if (this._hatch) return this._hatch;
    const c = bsCanvas(10, 10), x = c.getContext('2d');
    x.fillStyle = 'rgba(6,8,14,.58)'; x.fillRect(0, 0, 10, 10);
    x.strokeStyle = 'rgba(160,175,210,.22)'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(-2, 12); x.lineTo(12, -2); x.moveTo(-2, 2); x.lineTo(2, -2); x.moveTo(8, 12); x.lineTo(12, 8); x.stroke();
    return (this._hatch = this.ctx.createPattern(c, 'repeat'));
  }
  fogMask(sc, w, h) {
    if (this._fog.sig === this._fogSig && this._fog.canvas) return this._fog;
    const k = Math.min(1, 2048 / Math.max(w, h)), c = this._fog.canvas || document.createElement('canvas');
    c.width = Math.ceil(w * k); c.height = Math.ceil(h * k);
    const x = c.getContext('2d'); x.setTransform(k, 0, 0, k, 0, 0);
    x.globalCompositeOperation = 'source-over'; x.fillStyle = this.player ? '#05070b' : '#000'; x.fillRect(0, 0, w, h);
    const feather = this.player ? bsGrid(sc).size * 0.22 * k : 0;
    for (const op of (sc.fog && sc.fog.reveals) || []) {
      if (!op.pts || op.pts.length < 3) continue;
      x.globalCompositeOperation = op.hide ? 'source-over' : 'destination-out';
      if (feather) x.filter = `blur(${feather.toFixed(1)}px)`;
      x.beginPath(); op.pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath(); x.fill();
      x.filter = 'none';
    }
    this._fog = { sig: this._fogSig, canvas: c, k };
    return this._fog;
  }
  drawFog(sc, w, h) {
    if (!sc.fog || !sc.fog.on) return;
    const { ctx, dpr, cam } = this, m = this.fogMask(sc, w, h), s = dpr * cam.z / m.k;
    if (this.player) {
      ctx.save(); ctx.setTransform(s, 0, 0, s, dpr * cam.x, dpr * cam.y); ctx.imageSmoothingEnabled = true; ctx.drawImage(m.canvas, 0, 0); ctx.restore();
      return;
    }
    if (!this._tmp) this._tmp = document.createElement('canvas');
    const t = this._tmp; if (t.width !== this.cv.width || t.height !== this.cv.height) { t.width = this.cv.width; t.height = this.cv.height; }
    const x = t.getContext('2d');
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over'; x.clearRect(0, 0, t.width, t.height);
    x.setTransform(s, 0, 0, s, dpr * cam.x, dpr * cam.y); x.drawImage(m.canvas, 0, 0);
    x.setTransform(dpr, 0, 0, dpr, 0, 0); x.globalCompositeOperation = 'source-in'; x.fillStyle = this.hatch(); x.fillRect(0, 0, this.W, this.H);
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(t, 0, 0); ctx.restore();
  }
  drawOverlays(sc, now) {
    const { ctx } = this, L = this.live; let anim = false;
    for (const p of L.previews || []) { if (p.type === 'template') this.drawTemplate(sc, p, false, true); else if (!(this.player && p.dmOnly)) this.drawShape(sc, p, false); }
    if (L.fogDraft && !this.player) {
      const fd = L.fogDraft, col = fd.hide ? '#f87171' : '#7fd1c9';
      ctx.save(); ctx.beginPath();
      fd.pts.forEach((p, i) => { const [X, Y] = this.toScreen(p[0], p[1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      if (fd.cursor) { const [X, Y] = this.toScreen(fd.cursor[0], fd.cursor[1]); ctx.lineTo(X, Y); }
      if (fd.closed) ctx.closePath();
      ctx.fillStyle = bsRgba(col, 0.12); ctx.fill(); ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = col; ctx.stroke(); ctx.setLineDash([]);
      if (!fd.closed) fd.pts.forEach((p, i) => { const [X, Y] = this.toScreen(p[0], p[1]); ctx.beginPath(); ctx.arc(X, Y, i === 0 ? 6 : 3.5, 0, BS_TAU); ctx.fillStyle = i === 0 ? col : '#fff'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(0,0,0,.5)'; ctx.stroke(); });
      ctx.restore();
    }
    if (L.marquee) { const m = L.marquee; const [X0, Y0] = this.toScreen(m.x, m.y); ctx.save(); ctx.fillStyle = 'rgba(127,209,201,.08)'; ctx.strokeStyle = 'rgba(127,209,201,.85)'; ctx.lineWidth = 1; ctx.fillRect(X0, Y0, m.w * this.cam.z, m.h * this.cam.z); ctx.strokeRect(Math.round(X0) + 0.5, Math.round(Y0) + 0.5, Math.round(m.w * this.cam.z), Math.round(m.h * this.cam.z)); ctx.restore(); }
    if (L.calib) {
      const c = L.calib, [X0, Y0] = this.toScreen(Math.min(c.a[0], c.b[0]), Math.min(c.a[1], c.b[1])), sz = Math.max(Math.abs(c.b[0] - c.a[0]), Math.abs(c.b[1] - c.a[1])) * this.cam.z;
      ctx.save(); ctx.fillStyle = 'rgba(242,193,94,.14)'; ctx.fillRect(X0, Y0, sz, sz); ctx.lineWidth = 2; ctx.strokeStyle = '#f2c15e'; ctx.strokeRect(X0, Y0, sz, sz);
      bsPill(ctx, `1 square · ${Math.round(sz / this.cam.z)} px`, X0 + sz / 2, Y0 + sz + 8); ctx.restore();
    }
    if (L.drag && L.drag.from) {
      for (const [id, from] of L.drag.from) {
        const cur = L.drag.pos.get(id), tgt = (L.drag.snap && L.drag.snap.get(id)) || cur; if (!cur) continue;
        const [ax, ay] = this.toScreen(from[0], from[1]), [bx, by] = this.toScreen(tgt[0], tgt[1]);
        const tok = (sc.tokens || []).find(t => t.id === id); if (!tok || (this.player && tok.hidden)) continue;
        const R = bsTokenRadius(sc, tok) * this.cam.z;
        ctx.save();
        ctx.beginPath(); ctx.arc(ax, ay, R, 0, BS_TAU); ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.45)'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.setLineDash([9, 7]); ctx.lineCap = 'round';
        ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,.4)'; ctx.stroke(); ctx.lineWidth = 3; ctx.strokeStyle = '#ef4444'; ctx.stroke();
        ctx.setLineDash([]);
        if (L.drag.snap) { ctx.beginPath(); ctx.arc(bx, by, R, 0, BS_TAU); ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.setLineDash([2, 4]); ctx.stroke(); ctx.setLineDash([]); }
        const ft = bsFeet(sc, from, tgt, this.rule);
        if (ft > 0 && id === L.drag.lead) { const [cx, cy] = this.toScreen(cur[0], cur[1]); bsPill(ctx, `${ft} ft`, cx, cy - R - (this.player ? 40 : 30), { size: this.player ? 20 : 13, weight: 700, bg: 'rgba(12,14,20,.9)' }); }
        ctx.restore();
      }
    }
    if (L.ruler) {
      const r = L.ruler, [ax, ay] = this.toScreen(r.a[0], r.a[1]), [bx, by] = this.toScreen(r.b[0], r.b[1]), s = bsGrid(sc).size * this.cam.z;
      ctx.save();
      for (const [X, Y] of [[ax, ay], [bx, by]]) { ctx.fillStyle = 'rgba(127,209,201,.16)'; ctx.fillRect(X - s / 2, Y - s / 2, s, s); }
      ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineCap = 'round';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,.45)'; ctx.stroke(); ctx.lineWidth = 2.5; ctx.strokeStyle = '#7fd1c9'; ctx.stroke();
      for (const [X, Y] of [[ax, ay], [bx, by]]) { ctx.beginPath(); ctx.arc(X, Y, 5, 0, BS_TAU); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#7fd1c9'; ctx.stroke(); }
      const ft = bsFeet(sc, r.a, r.b, this.rule);
      bsPill(ctx, `${ft} ft`, bx + (this.player ? 0 : 0), by - (this.player ? 56 : 38), { size: this.player ? 24 : 14, weight: 700, bg: 'rgba(12,14,20,.92)', border: 'rgba(127,209,201,.6)' });
      ctx.restore();
    }
    if (this.pings.length) {
      const keep = [];
      for (const p of this.pings) {
        const age = (now - p.t0) / 1000; if (age > 2.4) continue; keep.push(p);
        const [X, Y] = this.toScreen(p.x, p.y), base = Math.max(30, bsGrid(sc).size * this.cam.z * 1.1) * (this.player ? 1.6 : 1);
        ctx.save();
        for (let i = 0; i < 3; i++) {
          const a = age - i * 0.28; if (a < 0 || a > 1.5) continue;
          const k = bsEase(a / 1.5);
          ctx.beginPath(); ctx.arc(X, Y, base * (0.15 + k), 0, BS_TAU); ctx.lineWidth = 3 * (1 - k) + 1; ctx.strokeStyle = bsRgba(p.color, 0.9 * (1 - k)); ctx.stroke();
        }
        const pop = age < 0.25 ? bsEase(age / 0.25) : age > 2 ? 1 - (age - 2) / 0.4 : 1;
        ctx.beginPath(); ctx.arc(X, Y, 7 * pop * (this.player ? 1.5 : 1), 0, BS_TAU); ctx.fillStyle = p.color; ctx.shadowColor = p.color; ctx.shadowBlur = 14; ctx.fill();
        ctx.restore();
      }
      this.pings = keep; anim = anim || keep.length > 0;
    }
    return anim;
  }
}
