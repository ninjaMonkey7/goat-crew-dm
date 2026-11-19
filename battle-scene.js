/* battle-scene.js — the battle map renderer, shared by the DM's Battle map tab (battlemap.js) and the
   player display window (display.js). Canvas 2D. Scene coordinates are pixels of the map; the camera
   maps them to the screen as  screen = scene * z + (x, y). Pure drawing and geometry: no saving here.
   Needs media() from gh.js for images in the private data branch.

   Frame order (GM): floor (cached bitmap) → grid (on the floor only) → templates → drawings → tokens →
   fog (55% black, vector edge) → template chips → labels → live overlays.
   Frame order (TV): floor → grid → templates → drawings → tokens → labels → fog (cached, noisy feather)
   → the fogged part of every template again, so none is ever cut off → template chips → live overlays.
   Everything expensive (floors, fog, token art, shadows) is built once into offscreen canvases, so a
   pan or a drag only composites. */
'use strict';

const BS_TAU = Math.PI * 2;
const BS_BACKDROP = '#0B0C0F';
const BS_VOID = '#0B0C0F'; // solid rock beyond a dungeon's walls
const BS_FOG_TV = '#08090B'; // the players' fog, and the dark beyond the map edge on the TV
const BS_KINDS = {
  pc: { label: 'PC', ring: '#E2A53A' },
  ally: { label: 'Ally', ring: '#3FA06B' },
  foe: { label: 'Foe', ring: '#D9534F' },
  neutral: { label: 'Neutral', ring: '#D9822B' }
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
// deep, slightly desaturated enamels for generated tokens: [highlight, body, edge]
const BS_PALETTES = {
  oxblood: ['#c0655a', '#6a1f22', '#1e0708'], umber: ['#b38658', '#56391f', '#1a1008'], iron: ['#97a1b0', '#3d4552', '#11151b'],
  moss: ['#9fae68', '#435025', '#141a09'], rust: ['#cc8650', '#73391a', '#230e05'], ash: ['#aca99f', '#4d4a45', '#161513'],
  sapphire: ['#86a7e6', '#274796', '#0a1535'], teal: ['#78ccc2', '#1b6463', '#062324'], emerald: ['#7dcfa0', '#1f6a47', '#08271a'],
  amethyst: ['#b99be2', '#58358c', '#1d1033'], garnet: ['#dc8590', '#7d2537', '#2a0a12'], bronze: ['#dcb574', '#80602b', '#2b1d09']
};
const BS_KIND_PALETTES = {
  foe: ['oxblood', 'umber', 'iron', 'moss', 'rust', 'ash'], pc: ['sapphire', 'teal', 'emerald', 'amethyst', 'garnet', 'bronze'],
  ally: ['emerald', 'teal', 'sapphire', 'moss'], neutral: ['iron', 'bronze', 'ash', 'teal']
};
const BS_INK = '236,224,200'; // the cream of engraved glyphs and initials

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
  g.addColorStop(0, bsShade(col, 0.55)); g.addColorStop(0.42, col); g.addColorStop(1, bsShade(col, -0.45));
  return g;
}
const bsEase = t => 1 - Math.pow(1 - bsClamp(t, 0, 1), 3);
function bsErfc(z) {
  const t = 1 / (1 + 0.5 * Math.abs(z));
  const y = t * Math.exp(-z * z - 1.26551223 + t * (1.00002368 + t * (0.37409196 + t * (0.09678418 + t * (-0.18628806 + t * (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))));
  return z >= 0 ? y : 2 - y;
}

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
// the disc fills ~92% of its footprint
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
// affected squares are only recomputed when the template or the grid changes, not every frame
const BS_TPL_CELLS = new Map();
function bsTplCellsCached(sc, d, g) {
  const gr = bsGrid(sc), key = `${d.shape}|${d.pts[0]}|${d.pts[1]}|${gr.size}|${gr.offsetX}|${gr.offsetY}`;
  let v = BS_TPL_CELLS.get(key);
  if (!v) { v = bsTplCells(sc, g); if (BS_TPL_CELLS.size > 200) BS_TPL_CELLS.clear(); BS_TPL_CELLS.set(key, v); }
  return v;
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
  const name = t.name || (c && c.name) || '', kind = BS_KINDS[t.kind] ? t.kind : 'neutral';
  const monster = t.monster || (c && c.monster) || null, klass = (ch && ch.klass) || '';
  const emoji = t.emoji || (chId ? '' : bsEmojiFor(monster, name));
  return {
    name, base: bsBaseName(name), num: bsNumber(name), kind,
    img: t.img || (ch && ch.portrait) || null, emoji,
    icon: bsIconFor({ pc: kind === 'pc' || !!chId, klass, monster, name, emoji: t.emoji, kind }), klass,
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
// mean luminance 0..1 of an image or canvas (null if the browser will not let us read it)
function bsLuma(src) {
  try {
    const c = bsCanvas(16, 16), x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(src, 0, 0, 16, 16);
    const d = x.getImageData(0, 0, 16, 16).data; let s = 0;
    for (let i = 0; i < d.length; i += 4) s += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
    return s / (256 * 255);
  } catch (_) { return null; }
}

// ---------- noise ----------
let BS_NOISE = null;
// fine white-noise grain (256², tiles)
function bsNoise() {
  if (BS_NOISE) return BS_NOISE;
  const n = 256, c = bsCanvas(n, n), x = c.getContext('2d'), d = x.createImageData(n, n), r = bsRng(11);
  for (let i = 0; i < n * n; i++) { const v = 128 + (r() - 0.5) * 220; d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; }
  x.putImageData(d, 0, 0);
  return (BS_NOISE = c);
}
// soft, tileable value-noise fbm (cloudy mottling for stone, wood and paper)
const BS_FBM = {};
function bsFbm(seed = 7, n = 256) {
  const key = seed + '|' + n; if (BS_FBM[key]) return BS_FBM[key];
  const v = bsFbmArr(seed, n), c = bsCanvas(n, n), x = c.getContext('2d'), d = x.createImageData(n, n);
  for (let i = 0; i < n * n; i++) { d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = Math.round(v[i] * 255); d.data[i * 4 + 3] = 255; }
  x.putImageData(d, 0, 0);
  return (BS_FBM[key] = c);
}
// the same noise as numbers 0..1 (for the fog feather)
const BS_FBM_ARR = {};
function bsFbmArr(seed = 7, n = 256) {
  const key = seed + '|' + n; if (BS_FBM_ARR[key]) return BS_FBM_ARR[key];
  const r = bsRng(seed * 7919 + 1), acc = new Float32Array(n * n);
  let amp = 1;
  for (let g = 4; g <= Math.min(64, n / 2); g *= 2) {
    const lat = new Float32Array(g * g); for (let i = 0; i < g * g; i++) lat[i] = r();
    const step = n / g;
    for (let y = 0; y < n; y++) {
      const fy = y / step, y0 = Math.floor(fy), ty = fy - y0, sy = ty * ty * (3 - 2 * ty), ya = (y0 % g) * g, yb = ((y0 + 1) % g) * g;
      for (let x = 0; x < n; x++) {
        const fx = x / step, x0 = Math.floor(fx), tx = fx - x0, sx = tx * tx * (3 - 2 * tx), xa = x0 % g, xb = (x0 + 1) % g;
        const a = lat[ya + xa] + (lat[ya + xb] - lat[ya + xa]) * sx, b = lat[yb + xa] + (lat[yb + xb] - lat[yb + xa]) * sx;
        acc[y * n + x] += (a + (b - a) * sy) * amp;
      }
    }
    amp *= 0.52;
  }
  let mn = Infinity, mx = -Infinity; for (let i = 0; i < acc.length; i++) { if (acc[i] < mn) mn = acc[i]; if (acc[i] > mx) mx = acc[i]; }
  for (let i = 0; i < acc.length; i++) acc[i] = (acc[i] - mn) / (mx - mn || 1);
  return (BS_FBM_ARR[key] = acc);
}
// tile an image over (0,0,w,h) at a given tile size, blended
function bsTile(x, img, w, h, size, alpha, op, ox = 0, oy = 0) {
  x.save(); x.globalAlpha = alpha; x.globalCompositeOperation = op || 'source-over';
  for (let ty = -oy; ty < h; ty += size) for (let tx = -ox; tx < w; tx += size) x.drawImage(img, tx, ty, size + 0.5, size + 0.5);
  x.restore();
}
function bsVignette(x, w, h, rgba, inner = 0.35, op) {
  x.save(); if (op) x.globalCompositeOperation = op;
  const v = x.createRadialGradient(w / 2, h / 2, Math.min(w, h) * inner, w / 2, h / 2, Math.hypot(w, h) * 0.6);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, rgba); x.fillStyle = v; x.fillRect(0, 0, w, h);
  x.restore();
}
function bsBlotches(x, w, h, s, rnd, n, colors, op, size = [1.5, 5]) {
  x.save(); x.globalCompositeOperation = op || 'source-over';
  for (let i = 0; i < n; i++) {
    const cx = rnd() * w, cy = rnd() * h, r = s * (size[0] + rnd() * (size[1] - size[0])), col = colors[Math.floor(rnd() * colors.length)];
    const gr = x.createRadialGradient(cx, cy, 0, cx, cy, r); gr.addColorStop(0, col); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  x.restore();
}

// ---------- procedural floors for blank scenes (built once per scene into a cached bitmap + mips) ----------
/* The floor picker (battlemap.js) lists these in order. 'dungeon' is a generated layout of rooms; the
   others are a single surface edged by a wall (or, on parchment, an inked frame) so the map's bounds
   always read. A scene may carry an optional floorSeed: change it to deal a different dungeon. */
const BS_FLOORS = { flagstone: 'Flagstones', planks: 'Tavern planks', parchment: 'Parchment', dungeon: 'Dungeon' };
const BS_FLOOR_DEFAULT = 'dungeon'; // the floor a new blank scene should start on
const BS_FLOOR_CACHE = new Map();
function bsFloor(sc) {
  const { w, h } = bsSceneSize(sc), g = bsGrid(sc), style = BS_FLOORS[sc.floor] ? sc.floor : 'flagstone';
  const seed = style === 'dungeon' && sc.floorSeed != null ? String(sc.floorSeed) : '';
  const key = `${sc.id}|${style}|${seed}|${w}x${h}|${g.size}|${g.offsetX}|${g.offsetY}`;
  if (BS_FLOOR_CACHE.has(key)) return BS_FLOOR_CACHE.get(key);
  const k = Math.min(1, 3072 / Math.max(w, h));
  const c = bsCanvas(w * k, h * k), x = c.getContext('2d');
  x.scale(k, k);
  const rnd = bsRng(sc.id + style + seed);
  let clip = null, plan = null;
  if (style === 'planks') { bsPlanks(x, w, h, g.size, rnd, k); bsPerimeter(x, w, h, g.size, k); }
  else if (style === 'parchment') { bsParchment(x, w, h, g.size, rnd, k); bsInkFrame(x, w, h, g.size); }
  else if (style === 'dungeon') { plan = bsDungeonPlan(sc); bsDungeon(x, w, h, plan, rnd, k); clip = plan.path; }
  else { bsFlagstone(x, w, h, g.size, rnd, k); bsPerimeter(x, w, h, g.size, k); }
  // clip: where the floor is (the grid is drawn there only); null = everywhere. plan / perimeter: walls the
  // view strokes again as vectors each frame, so they stay crisp at any zoom and pixel ratio
  const out = { mips: bsMips(c), scale: k, light: style === 'parchment', clip, plan, perimeter: style === 'flagstone' || style === 'planks' ? g.size * 0.06 : 0 };
  if (BS_FLOOR_CACHE.size > 6) BS_FLOOR_CACHE.delete(BS_FLOOR_CACHE.keys().next().value);
  BS_FLOOR_CACHE.set(key, out);
  return out;
}
/* A wall around the whole floor (flagstones, planks): a dark stroke ~6 px at 100% with ~12 px of
   ambient occlusion falling onto the floor inside it. */
function bsPerimeter(x, w, h, s, k) {
  const ww = s * 0.06;
  const rock = new Path2D(); rock.rect(-w, -h, w * 3, h * 3); rock.rect(0, 0, w, h);
  x.save(); x.beginPath(); x.rect(0, 0, w, h); x.clip(); bsInnerShade(x, k, rock, s); x.restore();
  x.save(); x.lineWidth = s * 0.013; x.strokeStyle = 'rgba(255,236,214,.18)'; x.strokeRect(ww + s * 0.0065, ww + s * 0.0065, w - ww * 2 - s * 0.013, h - ww * 2 - s * 0.013);
  x.lineWidth = ww * 2; x.strokeStyle = '#060708'; x.strokeRect(0, 0, w, h); x.restore();
}
/* The ambient occlusion walls throw onto the floor: two soft shadows cast by the rock (an even-odd
   Path2D, floor cut out of a big rectangle). Call with the floor clipped, so only the shadow lands. */
function bsInnerShade(x, k, rock, s) {
  // a tight contact shadow and a wider falloff: ~45% dark at the wall's face, ~7% about 12 px out (at 100%)
  for (const [blur, a] of [[s * 0.06, 0.7], [s * 0.2, 1]]) {
    x.save(); x.shadowColor = `rgba(0,0,0,${a})`; x.shadowBlur = blur * k; x.shadowOffsetX = 0; x.shadowOffsetY = 0;
    x.fillStyle = '#000'; x.fill(rock, 'evenodd'); x.restore();
  }
}
// parchment: an inked double rule a little inside the edge, like the border of a drawn map
function bsInkFrame(x, w, h, s) {
  x.save();
  const a = s * 0.16, b = s * 0.26;
  x.strokeStyle = 'rgba(64,40,16,.72)'; x.lineWidth = s * 0.028; x.strokeRect(a, a, w - a * 2, h - a * 2);
  x.strokeStyle = 'rgba(64,40,16,.5)'; x.lineWidth = s * 0.011; x.strokeRect(b, b, w - b * 2, h - b * 2);
  x.restore();
}
// keep the part of a convex polygon where nx*x + ny*y <= d
function bsClipHalf(poly, nx, ny, d) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = nx * a[0] + ny * a[1] - d, db = nx * b[0] + ny * b[1] - d;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  return out;
}
// soften the corners of a polygon (sampled quadratic fillets)
function bsRoundPoly(poly, rad) {
  const n = poly.length, out = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], p = poly[(i + n - 1) % n], q = poly[(i + 1) % n];
    const la = Math.hypot(p[0] - a[0], p[1] - a[1]) || 1, lb = Math.hypot(q[0] - a[0], q[1] - a[1]) || 1, r = Math.min(rad, la * 0.42, lb * 0.42);
    const s1 = [a[0] + (p[0] - a[0]) * r / la, a[1] + (p[1] - a[1]) * r / la], s2 = [a[0] + (q[0] - a[0]) * r / lb, a[1] + (q[1] - a[1]) * r / lb];
    for (let t = 0; t <= 1.001; t += 0.25) { const u = 1 - t; out.push([u * u * s1[0] + 2 * u * t * a[0] + t * t * s2[0], u * u * s1[1] + 2 * u * t * a[1] + t * t * s2[1]]); }
  }
  return out;
}
// worn, hand-cut edges: subdivide and nudge each point along the edge normal
function bsRoughen(pts, amp, rnd, step) {
  const out = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    out.push(a);
    const m = Math.floor(L / step); if (m < 1) continue;
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L;
    for (let j = 1; j <= m; j++) { const t = j / (m + 1), d = (rnd() - 0.5) * 2 * amp; out.push([a[0] + (b[0] - a[0]) * t + nx * d, a[1] + (b[1] - a[1]) * t + ny * d]); }
  }
  return out;
}
function bsPolyPath(x, pts) { x.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]); x.closePath(); }
/* Soft bevel for a raised shape: light catches the top-left inner edge, the bottom-right inner edge
   falls into shade. Casts shadows from everything *outside* the shape into it (canvas shadows are in
   device pixels, hence k). Call with the shape already clipped. */
function bsBevel(x, pts, bb, k, blur, light, dark, off) {
  const hole = () => { x.beginPath(); x.rect(bb[0] - 400, bb[1] - 400, bb[2] - bb[0] + 800, bb[3] - bb[1] + 800); bsPolyPath(x, pts); };
  x.save(); x.fillStyle = '#000'; x.shadowBlur = blur * k;
  if (light) { x.shadowColor = light; x.shadowOffsetX = x.shadowOffsetY = off * k; hole(); x.fill('evenodd'); }
  if (dark) { x.shadowColor = dark; x.shadowOffsetX = x.shadowOffsetY = -off * 1.15 * k; hole(); x.fill('evenodd'); }
  x.restore();
}

/* Dungeon flagstones: irregular hand-laid stones (a jittered Voronoi tiling that never lines up with
   the grid), each with its own colour and value, mottled texture, bevelled worn edges sitting proud
   of a gritty mortar bed, the odd crack and chip, then uneven torch-light and a vignette. */
function bsFlagstone(x, w, h, s, rnd, k, opt = {}) {
  x.fillStyle = '#211d18'; x.fillRect(0, 0, w, h);
  bsTile(x, bsFbm(3), w, h, s * 3, 0.55, 'overlay');
  bsTile(x, bsNoise(), w, h, 128, 0.35, 'overlay');
  // seeds: a jittered square lattice (not staggered, so the stones come out as irregular 4–6 sided
  // slabs rather than a honeycomb); some seeds dropped (big slabs), some doubled (small fillers)
  const sp = s * 1.12, jit = 0.78, gap = s * 0.03, cols = Math.ceil(w / sp) + 6, rows = Math.ceil(h / sp) + 6;
  const cells = Array.from({ length: cols * rows }, () => []);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const roll = rnd(), n = roll < 0.13 ? 0 : roll > 0.93 ? 2 : 1;
    for (let i = 0; i < n; i++) cells[r * cols + c].push([(c - 3 + 0.5 + (rnd() - 0.5) * jit) * sp, (r - 3 + 0.5 + (rnd() - 0.5) * jit) * sp]);
  }
  const tex = bsFbm(5), grain = bsNoise();
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) for (const p of cells[r * cols + c]) {
    if (p[0] < -sp * 1.5 || p[1] < -sp * 1.5 || p[0] > w + sp * 1.5 || p[1] > h + sp * 1.5) continue;
    let poly = [[p[0] - sp * 3, p[1] - sp * 3], [p[0] + sp * 3, p[1] - sp * 3], [p[0] + sp * 3, p[1] + sp * 3], [p[0] - sp * 3, p[1] + sp * 3]];
    for (let dr = -3; dr <= 3 && poly.length > 2; dr++) for (let dc = -3; dc <= 3 && poly.length > 2; dc++) {
      const rr = r + dr, cc = c + dc; if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
      for (const q of cells[rr * cols + cc]) {
        if (q === p) continue;
        const nx = q[0] - p[0], ny = q[1] - p[1], L = Math.hypot(nx, ny); if (L < 1e-6) continue;
        const ux = nx / L, uy = ny / L;
        poly = bsClipHalf(poly, ux, uy, ux * (p[0] + q[0]) / 2 + uy * (p[1] + q[1]) / 2 - gap * (0.75 + rnd() * 0.5) / 2);
        if (poly.length < 3) break;
      }
    }
    if (poly.length >= 3) bsStone(x, poly, s, rnd, k, tex, grain);
  }
  // grime in the low spots, a little moss, uneven light, then the room's edges fall away into dark
  bsBlotches(x, w, h, s, rnd, Math.round(w * h / (s * s) / 10) + 4, ['rgba(12,10,6,.45)', 'rgba(0,0,0,.35)', 'rgba(40,52,24,.3)'], 'multiply', [1, 3.5]);
  bsTile(x, bsFbm(9), w, h, Math.max(w, h) * 0.7, 0.55, 'soft-light', rnd() * 300, rnd() * 300);
  bsBlotches(x, w, h, s, rnd, Math.max(2, Math.round(w * h / (s * s) / 90)), ['rgba(255,196,120,.10)', 'rgba(255,214,160,.08)'], 'screen', [3, 7]);
  if (opt.vignette !== false) bsVignette(x, w, h, 'rgba(0,0,0,.55)', 0.3);
}
function bsStone(x, poly, s, rnd, k, tex, grain) {
  const pts = bsRoughen(bsRoundPoly(poly, s * (0.05 + rnd() * 0.07)), s * 0.009, rnd, s * 0.06);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of pts) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; }
  const bw = x1 - x0, bh = y1 - y0, path = () => { x.beginPath(); bsPolyPath(x, pts); };
  // most stones a warm grey; some cooler blue-grey, a few with a green or ochre cast
  const roll = rnd();
  const hue = roll < 0.58 ? 30 + rnd() * 14 : roll < 0.86 ? 205 + rnd() * 18 : roll < 0.94 ? 70 + rnd() * 20 : 24 + rnd() * 8;
  const sat = roll < 0.58 ? 6 + rnd() * 7 : roll < 0.86 ? 5 + rnd() * 6 : roll < 0.94 ? 8 + rnd() * 7 : 16 + rnd() * 8;
  const L = 27 + rnd() * 10 - (rnd() < 0.1 ? 6 : 0);
  // seated in the mortar: a soft shadow down and to the right
  x.save(); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = s * 0.045 * k; x.shadowOffsetX = s * 0.01 * k; x.shadowOffsetY = s * 0.018 * k;
  path(); x.fillStyle = `hsl(${hue},${sat}%,${L}%)`; x.fill(); x.restore();
  x.save(); path(); x.clip();
  const gr = x.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, `hsl(${hue},${sat}%,${L + 5}%)`); gr.addColorStop(1, `hsl(${hue},${sat}%,${L - 5}%)`);
  x.fillStyle = gr; x.fillRect(x0, y0, bw, bh);
  // mottled stone: a random patch of cloudy noise, then fine grain
  const ts = 50 + rnd() * 70;
  x.globalCompositeOperation = 'soft-light'; x.globalAlpha = 0.85;
  x.drawImage(tex, rnd() * (256 - ts), rnd() * (256 - ts), ts, ts, x0, y0, bw, bh);
  x.globalCompositeOperation = 'overlay'; x.globalAlpha = 0.28;
  x.drawImage(grain, rnd() * 128, rnd() * 128, 96 + rnd() * 32, 96 + rnd() * 32, x0, y0, bw, bh);
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  // a worn, smoother patch where feet go
  if (rnd() < 0.5) {
    const cx = x0 + bw * (0.3 + rnd() * 0.4), cy = y0 + bh * (0.3 + rnd() * 0.4), rr = Math.max(bw, bh) * (0.3 + rnd() * 0.3);
    const wg = x.createRadialGradient(cx, cy, 0, cx, cy, rr); wg.addColorStop(0, 'rgba(255,248,236,.07)'); wg.addColorStop(1, 'rgba(255,248,236,0)');
    x.fillStyle = wg; x.fillRect(x0, y0, bw, bh);
  }
  // pits and specks
  const pits = Math.round(bw * bh / (s * s) * 10);
  for (let i = 0; i < pits; i++) {
    x.beginPath(); x.arc(x0 + rnd() * bw, y0 + rnd() * bh, s * (0.004 + rnd() * 0.01), 0, BS_TAU);
    x.fillStyle = rnd() < 0.7 ? 'rgba(0,0,0,.28)' : 'rgba(255,255,255,.07)'; x.fill();
  }
  // the odd hairline crack
  if (rnd() < 0.17) {
    let cx = x0 + bw * (0.1 + rnd() * 0.3), cy = y0 + bh * (0.15 + rnd() * 0.7); const ang = (rnd() - 0.5) * 1.4;
    const crack = [[cx, cy]];
    for (let i = 0; i < 7; i++) { cx += Math.cos(ang + (rnd() - 0.5) * 1.3) * s * 0.11; cy += Math.sin(ang + (rnd() - 0.5) * 1.3) * s * 0.11; crack.push([cx, cy]); }
    x.beginPath(); crack.forEach((q, i) => i ? x.lineTo(q[0], q[1]) : x.moveTo(q[0], q[1]));
    x.lineCap = 'round'; x.lineJoin = 'round';
    x.lineWidth = s * 0.012; x.strokeStyle = 'rgba(10,8,6,.55)'; x.stroke();
    x.save(); x.translate(s * 0.007, s * 0.007); x.lineWidth = s * 0.006; x.strokeStyle = 'rgba(255,240,220,.07)'; x.stroke(); x.restore();
  }
  // bevel: soft highlight top-left, soft shade bottom-right (not a black outline)
  bsBevel(x, pts, [x0, y0, x1, y1], k, s * 0.055, 'rgba(255,240,220,.17)', 'rgba(0,0,0,.5)', s * 0.02);
  // chipped edges: little bites of mortar
  const chips = Math.floor(rnd() * 3);
  for (let i = 0; i < chips; i++) {
    const q = pts[Math.floor(rnd() * pts.length)];
    x.beginPath(); x.ellipse(q[0], q[1], s * (0.02 + rnd() * 0.035), s * (0.015 + rnd() * 0.02), rnd() * Math.PI, 0, BS_TAU);
    x.fillStyle = 'rgba(22,20,16,.85)'; x.fill();
  }
  x.restore();
}

/* Tavern planks: boards of mixed lengths and timber (honey, walnut, the odd weathered grey) with
   long grain, knots and end checks, rounded crowns, soft shadowed seams, nail heads, foot-worn paths
   and old spills. Board width deliberately does not divide the grid square. */
function bsPlanks(x, w, h, s, rnd, k) {
  x.fillStyle = '#120b06'; x.fillRect(0, 0, w, h);
  const ph = s * 0.455, tex = bsFbm(5), grain = bsNoise();
  for (let y = -rnd() * ph * 0.5; y < h; y += ph) {
    let xx = -rnd() * s * 3; const rowTone = (rnd() - 0.5) * 3;
    while (xx < w) { const len = s * (2.4 + rnd() * 3.6); bsPlank(x, xx, y, len, ph, rnd, k, tex, grain, rowTone); xx += len; }
  }
  bsTile(x, bsFbm(13), w, h, Math.max(w, h) * 0.6, 0.5, 'soft-light', rnd() * 200, rnd() * 200);
  bsBlotches(x, w, h, s, rnd, Math.round(w * h / (s * s) / 22) + 3, ['rgba(40,18,6,.4)', 'rgba(0,0,0,.3)', 'rgba(60,30,10,.25)'], 'multiply', [0.8, 2.6]);
  bsBlotches(x, w, h, s, rnd, Math.max(2, Math.round(w * h / (s * s) / 70)), ['rgba(255,210,150,.10)'], 'screen', [3, 7]);
  bsVignette(x, w, h, 'rgba(0,0,0,.6)', 0.3);
}
function bsPlank(x, x0, y0, len, ph, rnd, k, tex, grain, rowTone) {
  const gap = Math.max(1, ph * 0.055), fam = rnd();
  let hue, sat, L;
  if (fam < 0.62) { hue = 24 + rnd() * 7; sat = 34 + rnd() * 10; L = 27 + rnd() * 6; }
  else if (fam < 0.9) { hue = 19 + rnd() * 6; sat = 30 + rnd() * 10; L = 22 + rnd() * 4; }
  else { hue = 30 + rnd() * 8; sat = 16 + rnd() * 8; L = 28 + rnd() * 5; }
  L += rowTone;
  const X = x0 + gap / 2, Y = y0 + gap / 2, Wd = len - gap, Hd = ph - gap, rad = ph * 0.07;
  x.save(); x.shadowColor = 'rgba(0,0,0,.65)'; x.shadowBlur = ph * 0.12 * k; x.shadowOffsetY = ph * 0.05 * k;
  bsRoundRect(x, X, Y, Wd, Hd, rad); x.fillStyle = `hsl(${hue},${sat}%,${L}%)`; x.fill(); x.restore();
  x.save(); bsRoundRect(x, X, Y, Wd, Hd, rad); x.clip();
  // a rounded crown: lighter along the middle, darker at the edges
  const gr = x.createLinearGradient(0, Y, 0, Y + Hd);
  gr.addColorStop(0, `hsl(${hue},${sat}%,${L - 2}%)`); gr.addColorStop(0.3, `hsl(${hue},${sat}%,${L + 4}%)`);
  gr.addColorStop(0.65, `hsl(${hue},${sat}%,${L + 1}%)`); gr.addColorStop(1, `hsl(${hue},${sat}%,${L - 7}%)`);
  x.fillStyle = gr; x.fillRect(X, Y, Wd, Hd);
  // grain: noise stretched hard along the board
  x.globalCompositeOperation = 'overlay'; x.globalAlpha = 0.5;
  x.drawImage(tex, rnd() * 220, rnd() * 100, 14 + rnd() * 18, 150, X, Y, Wd, Hd);
  x.globalCompositeOperation = 'multiply'; x.globalAlpha = 0.22;
  x.drawImage(grain, rnd() * 240, rnd() * 60, 4 + rnd() * 4, 190, X, Y, Wd, Hd);
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  const lines = 4 + Math.floor(rnd() * 5);
  for (let i = 0; i < lines; i++) {
    const yy = Y + Hd * (0.12 + rnd() * 0.76), amp = Hd * (0.03 + rnd() * 0.07), fr = 1.5 + rnd() * 3.5, p0 = rnd() * BS_TAU;
    x.beginPath();
    for (let t = 0; t <= 1.0001; t += 0.04) { const px = X + t * Wd, py = yy + Math.sin(t * fr * Math.PI + p0) * amp; t === 0 ? x.moveTo(px, py) : x.lineTo(px, py); }
    x.lineWidth = Hd * (0.012 + rnd() * 0.025); x.strokeStyle = `hsla(${hue},${sat}%,${L - 10}%,${0.2 + rnd() * 0.25})`; x.stroke();
  }
  if (rnd() < 0.28) {
    const kx = X + Wd * (0.2 + rnd() * 0.6), ky = Y + Hd * (0.35 + rnd() * 0.3);
    const kg = x.createRadialGradient(kx, ky, 0, kx, ky, Hd * 0.3); kg.addColorStop(0, `hsla(${hue},${sat}%,${L - 14}%,.85)`); kg.addColorStop(1, `hsla(${hue},${sat}%,${L - 6}%,0)`);
    x.fillStyle = kg; x.beginPath(); x.ellipse(kx, ky, Hd * 0.42, Hd * 0.24, 0, 0, BS_TAU); x.fill();
    for (let i = 1; i <= 3; i++) { x.beginPath(); x.ellipse(kx, ky, Hd * 0.14 * i, Hd * 0.08 * i, 0, 0, BS_TAU); x.strokeStyle = `hsla(${hue},${sat}%,${L - 12}%,.35)`; x.lineWidth = Hd * 0.018; x.stroke(); }
  }
  // end grain darkens toward each butt joint
  for (const [ex, dir] of [[X, 1], [X + Wd, -1]]) {
    const eg = x.createLinearGradient(ex, 0, ex + dir * Hd * 0.6, 0); eg.addColorStop(0, 'rgba(0,0,0,.22)'); eg.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = eg; x.fillRect(Math.min(ex, ex + dir * Hd * 0.6), Y, Hd * 0.6, Hd);
  }
  x.fillStyle = 'rgba(255,226,190,.09)'; x.fillRect(X, Y, Wd, Math.max(0.8, Hd * 0.05));
  x.restore();
  for (const nx of [X + ph * 0.3, X + Wd - ph * 0.3]) for (const ny of [Y + Hd * 0.28, Y + Hd * 0.72]) {
    x.beginPath(); x.arc(nx, ny, ph * 0.042, 0, BS_TAU); x.fillStyle = 'rgba(14,10,8,.75)'; x.fill();
    x.beginPath(); x.arc(nx - ph * 0.01, ny - ph * 0.012, ph * 0.018, 0, BS_TAU); x.fillStyle = 'rgba(255,236,210,.18)'; x.fill();
  }
}

/* Parchment: cream stock with cloudy tone, fibres, foxing and the odd ring stain, two soft fold
   creases and darkened, aged edges. */
function bsParchment(x, w, h, s, rnd, k) {
  x.fillStyle = '#ddc9a0'; x.fillRect(0, 0, w, h);
  bsTile(x, bsFbm(21), w, h, Math.max(w, h) * 0.55, 0.2, 'multiply', rnd() * 200, rnd() * 200);
  bsTile(x, bsFbm(4), w, h, s * 2.4, 0.35, 'soft-light');
  bsBlotches(x, w, h, s, rnd, Math.round(w * h / (s * s) / 6) + 8, ['rgba(160,118,62,.13)', 'rgba(255,246,222,.2)', 'rgba(120,84,40,.1)']);
  x.save(); x.globalAlpha = 0.07; x.strokeStyle = '#5a4020'; x.lineWidth = 1;
  for (let i = 0; i < w * h / 700; i++) { const px = rnd() * w, py = rnd() * h, a = rnd() * BS_TAU, l = 4 + rnd() * 16; x.beginPath(); x.moveTo(px, py); x.quadraticCurveTo(px + Math.cos(a + 0.4) * l * 0.5, py + Math.sin(a + 0.4) * l * 0.5, px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
  x.restore();
  bsTile(x, bsNoise(), w, h, 128, 0.16, 'multiply');
  // foxing: small rust-brown spots
  for (let i = 0; i < w * h / (s * s) / 3; i++) {
    const cx = rnd() * w, cy = rnd() * h, r = s * (0.01 + rnd() * 0.04);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r); g.addColorStop(0, 'rgba(130,80,30,.22)'); g.addColorStop(1, 'rgba(130,80,30,0)');
    x.fillStyle = g; x.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  for (let i = 0; i < 2; i++) {
    const cx = rnd() * w, cy = rnd() * h, r = s * (0.7 + rnd() * 1.1);
    x.beginPath(); x.arc(cx, cy, r, rnd() * 2, rnd() * 2 + 5); x.strokeStyle = 'rgba(120,80,30,.13)'; x.lineWidth = s * (0.04 + rnd() * 0.04); x.stroke();
  }
  // fold creases
  for (const vert of [true, false]) {
    const p = (vert ? w : h) * (0.4 + rnd() * 0.2), len = vert ? h : w;
    for (const [d, col] of [[0, 'rgba(110,76,36,.16)'], [s * 0.025, 'rgba(255,250,236,.28)']]) {
      const g = vert ? x.createLinearGradient(p + d - s * 0.05, 0, p + d + s * 0.05, 0) : x.createLinearGradient(0, p + d - s * 0.05, 0, p + d + s * 0.05);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, col); g.addColorStop(1, 'rgba(0,0,0,0)');
      x.fillStyle = g; if (vert) x.fillRect(p + d - s * 0.05, 0, s * 0.1, len); else x.fillRect(0, p + d - s * 0.05, len, s * 0.1);
    }
  }
  bsVignette(x, w, h, 'rgba(110,64,22,.6)', 0.28, 'multiply');
  bsVignette(x, w, h, 'rgba(60,32,10,.35)', 0.45);
}

/* ---------- Dungeon: a generated layout for blank scenes ----------
   Deterministic per scene (id, size, grid and the optional floorSeed): a main hall near the middle,
   rooms of varied sizes around it, joined by 5 ft corridors (A* with a turn penalty, so they run
   straight) that meet the rooms at doors or open arches, and a passage off the edge of the map. Walls,
   doors and props all sit on the 5 ft grid. Rooms are floored with the crafted flagstones; the rock is
   flat. bsDungeonPlan(sc) is the layout in grid cells (cell: 0 rock, 1 room, 2 corridor). */
const BS_PLANS = new Map();
const BS_INWARD = { N: [0, 1], S: [0, -1], W: [1, 0], E: [-1, 0] }; // from a wall into its room
function bsDungeonPlan(sc) {
  const { w, h } = bsSceneSize(sc), g = bsGrid(sc), s = g.size, seed = sc.floorSeed != null ? String(sc.floorSeed) : '';
  const key = `${sc.id}|${seed}|${w}x${h}|${s}|${g.offsetX}|${g.offsetY}`;
  if (BS_PLANS.has(key)) return BS_PLANS.get(key);
  const ox = ((g.offsetX % s) + s) % s, oy = ((g.offsetY % s) + s) % s;
  const C = Math.max(1, Math.floor((w - ox) / s + 1e-6)), R = Math.max(1, Math.floor((h - oy) / s + 1e-6)), N = C * R;
  const rnd = bsRng(`${sc.id}|dungeon|${seed}`);
  const cell = new Uint8Array(N);
  const I = (c, r) => r * C + c, inb = (c, r) => c >= 0 && r >= 0 && c < C && r < R;
  const rooms = [];
  const addRoom = (x, y, rw, rh, main) => {
    const o = { x, y, w: rw, h: rh, main: !!main, i: rooms.length, doors: {} };
    rooms.push(o);
    for (let r = y; r < y + rh; r++) for (let c = x; c < x + rw; c++) if (inb(c, r)) cell[I(c, r)] = 1;
    return o;
  };
  const clear = (x, y, rw, rh, gap) => x >= 1 && y >= 1 && x + rw <= C - 1 && y + rh <= R - 1 &&
    rooms.every(o => x + rw + gap <= o.x || o.x + o.w + gap <= x || y + rh + gap <= o.y || o.y + o.h + gap <= y);
  const small = C < 9 || R < 7;
  if (small) addRoom(C >= 4 ? 1 : 0, R >= 3 ? 1 : 0, C, R, true); // one room's corner, running off the far edges
  // the hall is where the fight is: big and near the middle; on a smaller map, if that leaves no room
  // for anything else, try again with a smaller hall pushed off-centre
  else for (const [kw, kh, off] of [[0.38, 0.42, 0], [0.3, 0.34, 0.5], [0.24, 0.28, 1]]) {
    rooms.length = 0; cell.fill(0);
    const mw = bsClamp(Math.round(C * kw + rnd() * 2), 4, Math.min(16, C - 4)), mh = bsClamp(Math.round(R * kh + rnd() * 2), 3, Math.min(12, R - 4));
    const jx = (rnd() - 0.5) * (3 + off * (C - mw - 4)), jy = (rnd() - 0.5) * (3 + off * (R - mh - 4));
    addRoom(bsClamp(Math.round((C - mw) / 2 + jx), 1, C - 1 - mw), bsClamp(Math.round((R - mh) / 2 + jy), 1, R - 1 - mh), mw, mh, true);
    const want = Math.max(3, Math.round(N / 50));
    for (let n = 0; n < 700 && rooms.length < want + 1; n++) {
      const t = rnd(); let rw, rh;
      if (t < 0.4) { rw = 3 + Math.floor(rnd() * 2); rh = 3 + Math.floor(rnd() * 2); }
      else if (t < 0.78) { rw = 4 + Math.floor(rnd() * 4); rh = 4 + Math.floor(rnd() * 3); }
      else if (rnd() < 0.5) { rw = 5 + Math.floor(rnd() * 4); rh = 2 + Math.floor(rnd() * 2); }
      else { rw = 2 + Math.floor(rnd() * 2); rh = 5 + Math.floor(rnd() * 4); }
      if (rw > C - 2 || rh > R - 2) continue;
      const x = 1 + Math.floor(rnd() * (C - 1 - rw)), y = 1 + Math.floor(rnd() * (R - 1 - rh));
      if (clear(x, y, rw, rh, 2)) addRoom(x, y, rw, rh, false);
    }
    if (rooms.length >= Math.min(4, 1 + Math.floor(N / 60))) break;
  }
  // which room's 8-neighbourhood each rock cell is in (-1 none, -2 more than one): corridors keep out
  const ring = new Int16Array(N).fill(-1);
  for (const o of rooms) for (let r = o.y - 1; r <= o.y + o.h; r++) for (let c = o.x - 1; c <= o.x + o.w; c++) {
    if (!inb(c, r) || cell[I(c, r)]) continue;
    const i = I(c, r); ring[i] = ring[i] === -1 || ring[i] === o.i ? o.i : -2;
  }
  // doors: one per wall of a room, shared by every corridor leaving through that wall
  const span = (o, side) => { const along = side === 'N' || side === 'S', a = along ? o.x : o.y, n = along ? o.w : o.h; return n >= 3 ? [a + 1, a + n - 2] : [a, a + n - 1]; };
  const doorAt = (o, side, p) => side === 'N' ? [[p, o.y], [p, o.y - 1]] : side === 'S' ? [[p, o.y + o.h - 1], [p, o.y + o.h]] : side === 'W' ? [[o.x, p], [o.x - 1, p]] : [[o.x + o.w - 1, p], [o.x + o.w, p]];
  const doorFor = (o, side, want) => {
    if (o.doors[side]) return o.doors[side];
    const [lo, hi] = span(o, side), opts = [];
    for (let p = lo; p <= hi; p++) opts.push([Math.abs(p - want) + rnd() * 0.9, p]);
    opts.sort((a, b) => a[0] - b[0]);
    for (const [, p] of opts) {
      const [inC, out] = doorAt(o, side, p);
      if (out[0] > 0 && out[1] > 0 && out[0] < C - 1 && out[1] < R - 1 && ring[I(out[0], out[1])] === o.i) return { room: o.i, side, p, in: inC, out };
    }
    return null;
  };
  // A* over rock cells, 4-way, with a penalty for turning and for running alongside another corridor
  const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const nearCorr = (c, r) => D.some(([dc, dr]) => inb(c + dc, r + dr) && cell[I(c + dc, r + dr)] === 2);
  const route = (a, b) => {
    const S = I(a[0], a[1]), G = I(b[0], b[1]); if (S === G) return [S];
    const dist = new Float32Array(N * 5).fill(Infinity), prev = new Int32Array(N * 5).fill(-1), heap = [];
    const hu = i => 0.55 * (Math.abs(i % C - b[0]) + Math.abs(((i / C) | 0) - b[1]));
    dist[S * 5 + 4] = 0; bsHeapPush(heap, hu(S), S * 5 + 4);
    while (heap.length) {
      const [f, st] = bsHeapPop(heap), i = (st / 5) | 0, d = st % 5;
      if (f - hu(i) > dist[st] + 1e-6) continue;
      if (i === G) { const out = []; for (let q = st; q >= 0; q = prev[q]) out.push((q / 5) | 0); return out.reverse(); }
      const c = i % C, r = (i / C) | 0;
      for (let nd = 0; nd < 4; nd++) {
        const nc = c + D[nd][0], nr = r + D[nd][1];
        if (nc <= 0 || nr <= 0 || nc >= C - 1 || nr >= R - 1) continue;
        const ni = I(nc, nr); if (cell[ni] === 1 || (ring[ni] !== -1 && ni !== G)) continue;
        let step = cell[ni] === 2 ? 0.55 : 1 + (nearCorr(nc, nr) ? 0.6 : 0);
        if (d !== 4 && nd !== d) step += 0.9;
        const ns = ni * 5 + nd, nv = dist[st] + step;
        if (nv < dist[ns]) { dist[ns] = nv; prev[ns] = st; bsHeapPush(heap, nv + hu(ni), ns); }
      }
    }
    return null;
  };
  const ctr = o => [o.x + o.w / 2, o.y + o.h / 2];
  const sides = (a, b) => {
    const [ax, ay] = ctr(a), [bx, by] = ctr(b), dx = bx - ax, dy = by - ay;
    const sepX = a.x + a.w <= b.x || b.x + b.w <= a.x, sepY = a.y + a.h <= b.y || b.y + b.h <= a.y;
    return sepX && (!sepY || Math.abs(dx) >= Math.abs(dy)) ? (dx > 0 ? ['E', 'W'] : ['W', 'E']) : (dy > 0 ? ['S', 'N'] : ['N', 'S']);
  };
  const linked = new Set();
  const link = (a, b) => {
    const [sa, sb] = sides(a, b), along = sa === 'N' || sa === 'S', [ax, ay] = ctr(a), [bx, by] = ctr(b);
    let wa = along ? bx - 0.5 : by - 0.5, wb = along ? ax - 0.5 : ay - 0.5;
    const [la, ha] = span(a, sa), [lb, hb] = span(b, sb), lo = Math.max(la, lb), hi = Math.min(ha, hb);
    if (hi >= lo) wa = wb = lo + Math.floor(rnd() * (hi - lo + 1)); // the walls overlap: a straight passage
    const da = doorFor(a, sa, wa), db = doorFor(b, sb, wb); if (!da || !db) return false;
    const path = route(da.out, db.out); if (!path) return false;
    for (const i of path) if (!cell[i]) cell[i] = 2;
    a.doors[sa] = da; b.doors[sb] = db; linked.add(a.i + ',' + b.i).add(b.i + ',' + a.i);
    return true;
  };
  const dd = (a, b) => { const [ax, ay] = ctr(a), [bx, by] = ctr(b); return Math.hypot(ax - bx, ay - by); };
  if (rooms.length > 1) {
    // a spanning tree from the hall, nearest rooms first; a room no corridor can reach is filled in
    const tree = [rooms[0]], rest = rooms.slice(1);
    while (rest.length) {
      const pairs = [];
      for (const a of tree) for (const b of rest) pairs.push([dd(a, b), a, b]);
      pairs.sort((p, q) => p[0] - q[0]);
      let joined = null;
      for (const [, a, b] of pairs) if (link(a, b)) { joined = b; break; }
      if (!joined) break;
      tree.push(joined); rest.splice(rest.indexOf(joined), 1);
    }
    for (const o of rest) { o.dead = true; for (let r = o.y; r < o.y + o.h; r++) for (let c = o.x; c < o.x + o.w; c++) cell[I(c, r)] = 0; }
    // a loop or two, so not every corridor is a dead end
    const extra = [];
    for (const a of tree) for (const b of tree) if (a.i < b.i && !linked.has(a.i + ',' + b.i)) extra.push([dd(a, b) * (0.7 + rnd() * 0.6), a, b]);
    extra.sort((p, q) => p[0] - q[0]);
    let loops = Math.max(1, Math.round(tree.length / 4));
    for (const [, a, b] of extra.slice(0, 6)) { if (loops <= 0) break; if (link(a, b)) loops--; }
  }
  // a passage or two off the edge of the map, so the dungeon reads as part of something bigger
  if (!small) {
    const cands = [];
    for (const o of rooms) if (!o.dead) for (const side of ['N', 'S', 'W', 'E']) {
      const [lo, hi] = span(o, side), [ic, ir] = BS_INWARD[side];
      for (let p = lo; p <= hi; p++) {
        if (o.doors[side] && o.doors[side].p !== p) continue;
        const [inC, out] = doorAt(o, side, p), run = [];
        let c = out[0], r = out[1], ok = inb(c, r) && ring[I(c, r)] === o.i;
        while (ok) {
          run.push(I(c, r));
          if (c === 0 || r === 0 || c === C - 1 || r === R - 1) break;
          c -= ic; r -= ir;
          ok = inb(c, r) && cell[I(c, r)] !== 1 && ring[I(c, r)] === -1;
        }
        if (ok && run.length) cands.push([run.length + rnd() * 3 + (o.main ? 4 : 0), o, side, p, inC, out, run]);
      }
    }
    cands.sort((a, b) => a[0] - b[0]);
    const used = new Set();
    for (const [, o, side, p, inC, out, run] of cands) {
      if (used.size >= (N > 500 ? 2 : 1) || used.has(o.i)) continue;
      used.add(o.i); for (const i of run) if (!cell[i]) cell[i] = 2;
      if (!o.doors[side]) o.doors[side] = { room: o.i, side, p, in: inC, out };
    }
  }
  const doors = [];
  for (const o of rooms) if (!o.dead) for (const d of Object.values(o.doors)) doors.push({ ...d, kind: rnd() < 0.32 ? 'arch' : 'door' });
  // props, each on its own square: pillars, rubble, barrels and crates, one stair; never in a doorway
  const occ = new Uint8Array(N), props = [], lights = [];
  for (const d of doors) { occ[I(d.in[0], d.in[1])] = 1; const [ic, ir] = BS_INWARD[d.side]; if (inb(d.in[0] + ic, d.in[1] + ir)) occ[I(d.in[0] + ic, d.in[1] + ir)] = 1; }
  const roomCell = (o, c, r) => inb(c, r) && c >= o.x && r >= o.y && c < o.x + o.w && r < o.y + o.h;
  const put = (type, c, r, extra) => { occ[I(c, r)] = 1; props.push({ type, c, r, seed: (rnd() * 1e9) | 0, ...extra }); };
  const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  for (const o of rooms) {
    if (o.dead) continue;
    if (small) { if (roomCell(o, o.x + 1, o.y + 1)) put('pillar', o.x + 1, o.y + 1); continue; }
    const walls = ['N', 'S', 'W', 'E'].filter(sd => !o.doors[sd]);
    if ((o.main && o.w >= 6 && o.h >= 5) || (o.w >= 5 && o.h >= 5 && rnd() < 0.45)) {
      const xs = [o.x + 1, o.x + o.w - 2], ys = [o.y + 1, o.y + o.h - 2];
      if (o.w >= 9 && o.w % 2) xs.splice(1, 0, o.x + (o.w - 1) / 2);
      if (o.h >= 9 && o.h % 2) ys.splice(1, 0, o.y + (o.h - 1) / 2);
      for (const c of xs) for (const r of ys) if (!occ[I(c, r)]) put('pillar', c, r);
    }
    if (rnd() < (o.main ? 0.35 : 0.5)) {
      const ex = rnd() < 0.5, ey = rnd() < 0.5, c = ex ? o.x + o.w - 1 : o.x, r = ey ? o.y + o.h - 1 : o.y;
      if (!occ[I(c, r)]) put('rubble', c, r, { dx: ex ? 1 : -1, dy: ey ? 1 : -1 });
    }
    if (!o.main && o.w * o.h >= 9 && walls.length && rnd() < 0.65) {
      const sd = walls[Math.floor(rnd() * walls.length)], along = sd === 'N' || sd === 'S';
      const line = along ? (sd === 'N' ? o.y : o.y + o.h - 1) : (sd === 'W' ? o.x : o.x + o.w - 1);
      const n = along ? o.w : o.h, cnt = 2 + Math.floor(rnd() * 3), start = (along ? o.x : o.y) + Math.floor(rnd() * Math.max(1, n - cnt + 1));
      for (let q = start; q < start + cnt; q++) { const c = along ? q : line, r = along ? line : q; if (roomCell(o, c, r) && !occ[I(c, r)]) put(rnd() < 0.55 ? 'barrel' : 'crate', c, r); }
    }
    // a sconce or two on the walls (light pools are part of the floor)
    const free = walls.slice();
    for (let l = 0; l < (o.w * o.h >= 30 ? 2 : 1) && free.length; l++) {
      const sd = free.splice(Math.floor(rnd() * free.length), 1)[0], along = sd === 'N' || sd === 'S';
      const wx = along ? o.x + Math.floor(o.w / 2) + 0.5 : (sd === 'W' ? o.x : o.x + o.w), wy = along ? (sd === 'N' ? o.y : o.y + o.h) : o.y + Math.floor(o.h / 2) + 0.5;
      lights.push({ x: ox + wx * s, y: oy + wy * s, side: sd, r: s * bsClamp(Math.max(o.w, o.h) * 0.5, 1.8, 3.2) });
    }
  }
  if (!small) {
    // one stair down, two squares deep against a wall without a door, in a side room if there is one
    const order = shuffle(rooms.filter(o => !o.dead && !o.main && Math.min(o.w, o.h) >= 3));
    const hall = rooms.find(o => o.main); if (hall) order.push(hall);
    stair: for (const o of order) for (const sd of shuffle(['N', 'S', 'W', 'E'])) {
      if (o.doors[sd]) continue;
      const along = sd === 'N' || sd === 'S', [lo, hi] = span(o, sd), [ic, ir] = BS_INWARD[sd], mid = (lo + hi) / 2;
      if ((along ? o.h : o.w) < 3) continue;
      const ps = []; for (let p = lo; p <= hi; p++) ps.push(p); ps.sort((a, b) => Math.abs(a - mid) - Math.abs(b - mid));
      for (const p of ps) {
        const c0 = along ? p : (sd === 'W' ? o.x : o.x + o.w - 1), r0 = along ? (sd === 'N' ? o.y : o.y + o.h - 1) : p;
        if (occ[I(c0, r0)] || occ[I(c0 + ic, r0 + ir)]) continue;
        put('stair', c0, r0, { side: sd }); occ[I(c0 + ic, r0 + ir)] = 1;
        break stair;
      }
    }
  }
  // geometry: the floor (row runs, so one fill has no seams), corridors, and every floor/rock edge as a wall
  const X = c => ox + c * s, Y = r => oy + r * s, isF = (c, r) => inb(c, r) && cell[I(c, r)] !== 0;
  const path = new Path2D(), corr = new Path2D(), walls = new Path2D(), rock = new Path2D();
  for (let r = 0; r < R; r++) for (const [P, test] of [[path, v => v !== 0], [corr, v => v === 2]]) {
    let st = -1;
    for (let c = 0; c <= C; c++) {
      const on = c < C && test(cell[I(c, r)]);
      if (on && st < 0) st = c; else if (!on && st >= 0) { P.rect(X(st), Y(r), (c - st) * s, s); st = -1; }
    }
  }
  for (let r = 1; r < R; r++) { let st = -1; for (let c = 0; c <= C; c++) { const on = c < C && isF(c, r - 1) !== isF(c, r); if (on && st < 0) st = c; else if (!on && st >= 0) { walls.moveTo(X(st), Y(r)); walls.lineTo(X(c), Y(r)); st = -1; } } }
  for (let c = 1; c < C; c++) { let st = -1; for (let r = 0; r <= R; r++) { const on = r < R && isF(c - 1, r) !== isF(c, r); if (on && st < 0) st = r; else if (!on && st >= 0) { walls.moveTo(X(c), Y(st)); walls.lineTo(X(c), Y(r)); st = -1; } } }
  rock.rect(-w, -h, w * 3, h * 3); rock.addPath(path);
  const plan = { C, R, s, ox, oy, cell, rooms: rooms.filter(o => !o.dead), doors, props, lights, path, corr, walls, rock };
  if (BS_PLANS.size > 8) BS_PLANS.delete(BS_PLANS.keys().next().value);
  BS_PLANS.set(key, plan);
  return plan;
}
function bsHeapPush(hp, f, v) { hp.push([f, v]); let i = hp.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (hp[p][0] <= hp[i][0]) break; [hp[p], hp[i]] = [hp[i], hp[p]]; i = p; } }
function bsHeapPop(hp) {
  const top = hp[0], last = hp.pop();
  if (hp.length) {
    hp[0] = last; let i = 0;
    for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < hp.length && hp[l][0] < hp[m][0]) m = l; if (r < hp.length && hp[r][0] < hp[m][0]) m = r; if (m === i) break; [hp[m], hp[i]] = [hp[i], hp[m]]; i = m; }
  }
  return top;
}
/* Paint a plan: flat rock, flagstones clipped to the rooms (corridors a shade darker), props, ~12 px of
   ambient occlusion along every wall, warm light from the sconces, then the walls (6 px dark strokes
   with a faint chiselled lip on the rock side), doors and sconces. */
function bsDungeon(x, w, h, plan, rnd, k) {
  const { s } = plan;
  x.fillStyle = BS_VOID; x.fillRect(0, 0, w, h);
  x.save(); x.clip(plan.path);
  bsFlagstone(x, w, h, s, rnd, k, { vignette: false });
  x.fillStyle = 'rgba(0,0,0,.16)'; x.fill(plan.corr);
  for (const p of plan.props) bsProp(x, p, plan, k);
  bsInnerShade(x, k, plan.rock, s);
  x.globalCompositeOperation = 'screen';
  for (const L of plan.lights) {
    const [ic, ir] = BS_INWARD[L.side], lx = L.x + ic * s * 0.55, ly = L.y + ir * s * 0.55;
    const g = x.createRadialGradient(lx, ly, 0, lx, ly, L.r);
    g.addColorStop(0, 'rgba(255,178,96,.24)'); g.addColorStop(0.4, 'rgba(255,160,80,.10)'); g.addColorStop(1, 'rgba(255,150,70,0)');
    x.fillStyle = g; x.fillRect(lx - L.r, ly - L.r, L.r * 2, L.r * 2);
  }
  x.restore();
  // walls: a 6 px dark stroke, a fine lit edge where it meets the floor, a faint chiselled lip on the rock side
  x.save(); x.clip(plan.path); x.lineCap = 'square'; x.lineWidth = s * 0.06 + s * 0.026; x.strokeStyle = 'rgba(255,236,214,.2)'; x.stroke(plan.walls); x.restore();
  x.save(); x.clip(plan.rock, 'evenodd'); x.lineCap = 'square'; x.lineWidth = s * 0.06 + s * 0.04; x.strokeStyle = '#1d2026'; x.stroke(plan.walls); x.restore();
  x.save(); x.lineCap = 'square'; x.lineWidth = s * 0.06; x.strokeStyle = '#050607'; x.stroke(plan.walls); x.restore();
  for (const d of plan.doors) bsDoor(x, d, plan, k);
  for (const L of plan.lights) bsSconce(x, L, plan);
}
function bsDoor(x, d, plan, k) {
  const { s, ox, oy } = plan, [c, r] = d.in, vert = d.side === 'E' || d.side === 'W';
  // local frame: the doorway runs from (0,0) to (s,0); the door's faces are at y = ±t
  x.save();
  if (vert) { x.translate(ox + (d.side === 'E' ? c + 1 : c) * s, oy + r * s); x.rotate(Math.PI / 2); }
  else x.translate(ox + c * s, oy + (d.side === 'S' ? r + 1 : r) * s);
  const jl = s * 0.12, jt = s * 0.075;
  for (const a of [0, s - jl]) { x.beginPath(); x.rect(a, -jt, jl, jt * 2); x.fillStyle = '#2a2724'; x.fill(); x.lineWidth = s * 0.012; x.strokeStyle = '#050607'; x.stroke(); }
  if (d.kind === 'door') {
    const t = s * 0.07, L0 = jl, Ld = s - jl * 2;
    x.save(); x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = s * 0.06 * k; x.shadowOffsetY = s * 0.02 * k;
    x.fillStyle = '#4a311b'; x.fillRect(L0, -t, Ld, t * 2); x.restore();
    const g = x.createLinearGradient(0, -t, 0, t); g.addColorStop(0, '#93683d'); g.addColorStop(0.5, '#6f4a29'); g.addColorStop(1, '#46301a');
    x.fillStyle = g; x.fillRect(L0, -t, Ld, t * 2);
    x.strokeStyle = 'rgba(30,18,8,.55)'; x.lineWidth = s * 0.006;
    x.beginPath(); x.moveTo(L0, -t / 3); x.lineTo(L0 + Ld, -t / 3); x.moveTo(L0, t / 3); x.lineTo(L0 + Ld, t / 3); x.stroke();
    x.fillStyle = '#23201d'; for (const f of [0.2, 0.8]) x.fillRect(L0 + Ld * f - s * 0.017, -t, s * 0.034, t * 2);
    x.lineWidth = s * 0.012; x.strokeStyle = '#140d06'; x.strokeRect(L0, -t, Ld, t * 2);
    x.beginPath(); x.arc(L0 + Ld * 0.5, 0, s * 0.02, 0, BS_TAU); x.fillStyle = '#c9a25a'; x.fill();
  } else { x.fillStyle = 'rgba(255,240,220,.05)'; x.fillRect(jl, -jt, s - jl * 2, jt * 2); }
  x.restore();
}
function bsSconce(x, L, plan) {
  const { s } = plan, [ic, ir] = BS_INWARD[L.side], fx = L.x + ic * s * 0.075, fy = L.y + ir * s * 0.075;
  x.save();
  x.beginPath(); x.arc(L.x + ic * s * 0.03, L.y + ir * s * 0.03, s * 0.045, 0, BS_TAU); x.fillStyle = '#16140f'; x.fill();
  x.globalCompositeOperation = 'lighter';
  const g = x.createRadialGradient(fx, fy, 0, fx, fy, s * 0.24);
  g.addColorStop(0, 'rgba(255,214,140,.8)'); g.addColorStop(0.22, 'rgba(255,170,80,.32)'); g.addColorStop(1, 'rgba(255,140,60,0)');
  x.fillStyle = g; x.fillRect(fx - s * 0.24, fy - s * 0.24, s * 0.48, s * 0.48);
  x.globalCompositeOperation = 'source-over';
  x.beginPath(); x.arc(fx, fy, s * 0.024, 0, BS_TAU); x.fillStyle = '#fff3d0'; x.fill();
  x.restore();
}
function bsProp(x, p, plan, k) {
  const { s, ox, oy } = plan, cx = ox + (p.c + 0.5) * s, cy = oy + (p.r + 0.5) * s, rnd = bsRng(p.seed);
  const shade = (blur, dx, dy, a = 0.6) => { x.shadowColor = `rgba(0,0,0,${a})`; x.shadowBlur = blur * s * k; x.shadowOffsetX = dx * s * k; x.shadowOffsetY = dy * s * k; };
  x.save();
  if (p.type === 'pillar') {
    // a square plinth and a round column, lit from the top left
    const b = s * 0.36, cr = s * 0.25;
    x.save(); shade(0.12, 0.04, 0.07); bsRoundRect(x, cx - b, cy - b, b * 2, b * 2, s * 0.05); x.fillStyle = '#3b3833'; x.fill(); x.restore();
    let g = x.createLinearGradient(cx - b, cy - b, cx + b, cy + b); g.addColorStop(0, '#5f5a51'); g.addColorStop(1, '#2b2925');
    bsRoundRect(x, cx - b, cy - b, b * 2, b * 2, s * 0.05); x.fillStyle = g; x.fill(); x.lineWidth = s * 0.012; x.strokeStyle = '#11100e'; x.stroke();
    x.save(); shade(0.07, 0.025, 0.04, 0.55); x.beginPath(); x.arc(cx, cy, cr, 0, BS_TAU); x.fillStyle = '#4a463f'; x.fill(); x.restore();
    g = x.createRadialGradient(cx - cr * 0.4, cy - cr * 0.45, cr * 0.05, cx, cy, cr);
    g.addColorStop(0, '#a0988b'); g.addColorStop(0.55, '#655f56'); g.addColorStop(1, '#35322d');
    x.beginPath(); x.arc(cx, cy, cr, 0, BS_TAU); x.fillStyle = g; x.fill(); x.lineWidth = s * 0.012; x.strokeStyle = '#121110'; x.stroke();
    x.save(); x.clip(); x.globalCompositeOperation = 'soft-light'; x.globalAlpha = 0.6; x.drawImage(bsFbm(5), rnd() * 180, rnd() * 180, 60, 60, cx - cr, cy - cr, cr * 2, cr * 2); x.restore();
    x.beginPath(); x.arc(cx, cy, cr * 0.7, 0, BS_TAU); x.strokeStyle = 'rgba(0,0,0,.22)'; x.lineWidth = s * 0.008; x.stroke();
  } else if (p.type === 'barrel') {
    const r = s * (0.28 + rnd() * 0.04), bx = cx + (rnd() - 0.5) * s * 0.12, by = cy + (rnd() - 0.5) * s * 0.12, lr = r * 0.84;
    x.save(); shade(0.08, 0.03, 0.05); x.beginPath(); x.arc(bx, by, r, 0, BS_TAU); x.fillStyle = '#2a2420'; x.fill(); x.restore();
    const g = x.createLinearGradient(bx - lr, by - lr, bx + lr, by + lr); g.addColorStop(0, '#83603a'); g.addColorStop(1, '#4c321b');
    x.beginPath(); x.arc(bx, by, lr, 0, BS_TAU); x.fillStyle = g; x.fill();
    x.save(); x.clip(); x.translate(bx, by); x.rotate(rnd() * Math.PI); x.strokeStyle = 'rgba(40,22,8,.55)'; x.lineWidth = s * 0.008;
    for (const f of [-0.5, 0, 0.5]) { x.beginPath(); x.moveTo(f * lr, -lr); x.lineTo(f * lr, lr); x.stroke(); }
    x.restore();
    x.beginPath(); x.arc(bx, by, r * 0.93, 0, BS_TAU); x.strokeStyle = 'rgba(210,200,180,.2)'; x.lineWidth = s * 0.008; x.stroke();
    x.beginPath(); x.arc(bx + lr * 0.35, by + lr * 0.1, s * 0.022, 0, BS_TAU); x.fillStyle = '#2a1a0c'; x.fill();
  } else if (p.type === 'crate') {
    const a = s * (0.29 + rnd() * 0.04), f = a * 0.2;
    x.translate(cx + (rnd() - 0.5) * s * 0.08, cy + (rnd() - 0.5) * s * 0.08); x.rotate((rnd() - 0.5) * 0.3);
    x.save(); shade(0.08, 0.03, 0.05); x.fillStyle = '#4a321b'; x.fillRect(-a, -a, a * 2, a * 2); x.restore();
    const g = x.createLinearGradient(-a, -a, a, a); g.addColorStop(0, '#946a3f'); g.addColorStop(1, '#5c3d20');
    x.fillStyle = g; x.fillRect(-a, -a, a * 2, a * 2);
    x.strokeStyle = 'rgba(40,24,10,.5)'; x.lineWidth = s * 0.007;
    for (const q of [-1 / 3, 1 / 3]) { x.beginPath(); x.moveTo(-a, q * a * 2); x.lineTo(a, q * a * 2); x.stroke(); }
    x.strokeStyle = '#3e2813'; x.lineWidth = f * 0.9; x.strokeRect(-a + f * 0.45, -a + f * 0.45, a * 2 - f * 0.9, a * 2 - f * 0.9);
    x.beginPath(); x.moveTo(-a + f, a - f); x.lineTo(a - f, -a + f); x.stroke();
    x.strokeStyle = '#1c1209'; x.lineWidth = s * 0.012; x.strokeRect(-a, -a, a * 2, a * 2);
    x.fillStyle = 'rgba(20,14,8,.85)';
    for (const [nx, ny] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) { x.beginPath(); x.arc(nx * (a - f * 0.45), ny * (a - f * 0.45), s * 0.01, 0, BS_TAU); x.fill(); }
  } else if (p.type === 'rubble') {
    const ccx = cx + p.dx * s * 0.12, ccy = cy + p.dy * s * 0.12;
    const dg = x.createRadialGradient(ccx, ccy, 0, ccx, ccy, s * 0.6); dg.addColorStop(0, 'rgba(70,62,50,.35)'); dg.addColorStop(1, 'rgba(70,62,50,0)');
    x.fillStyle = dg; x.fillRect(ccx - s * 0.6, ccy - s * 0.6, s * 1.2, s * 1.2);
    const stones = [];
    for (let i = 0, n = 9 + Math.floor(rnd() * 6); i < n; i++) {
      const a = rnd() * BS_TAU, d = Math.pow(rnd(), 0.8) * s * 0.42;
      stones.push([ccx + Math.cos(a) * d, ccy + Math.sin(a) * d, Math.max(s * 0.025, s * (0.04 + rnd() * 0.09) * (1 - d / (s * 0.6)))]);
    }
    stones.sort((p1, p2) => p2[2] - p1[2]);
    for (const [sx, sy, sz] of stones) {
      const m = 5 + Math.floor(rnd() * 3), a0 = rnd() * BS_TAU, pts = [];
      for (let j = 0; j < m; j++) { const a = a0 + j * BS_TAU / m + (rnd() - 0.5) * 0.6, rr = sz * (0.7 + rnd() * 0.45); pts.push([sx + Math.cos(a) * rr, sy + Math.sin(a) * rr]); }
      const L = 26 + rnd() * 16, hue = 28 + rnd() * 14;
      x.save(); shade(0.035, 0.012, 0.022, 0.65); x.beginPath(); bsPolyPath(x, pts); x.fillStyle = `hsl(${hue},7%,${L}%)`; x.fill(); x.restore();
      const g = x.createLinearGradient(sx - sz, sy - sz, sx + sz, sy + sz); g.addColorStop(0, `hsl(${hue},8%,${L + 12}%)`); g.addColorStop(1, `hsl(${hue},7%,${L - 8}%)`);
      x.beginPath(); bsPolyPath(x, pts); x.fillStyle = g; x.fill(); x.lineWidth = s * 0.006; x.strokeStyle = 'rgba(0,0,0,.45)'; x.stroke();
    }
  } else if (p.type === 'stair') {
    // two squares deep, going down toward the wall: local +y points into the room from the wall's edge
    const [ic, ir] = BS_INWARD[p.side], m = s * 0.07, W2 = s / 2 - m, Ls = s * 2, n = 9;
    x.translate(cx - ic * s * 0.5, cy - ir * s * 0.5); x.rotate(Math.atan2(-ic, ir));
    x.save(); shade(0.06, 0, 0, 0.5); x.fillStyle = '#0d0e10'; x.fillRect(-s / 2 + m * 0.3, 0, s - m * 0.6, Ls); x.restore();
    for (let i = 0; i < n; i++) {
      const y0 = Ls * (n - 1 - i) / n, y1 = y0 + Ls / n;
      x.fillStyle = `hsl(32,6%,${38 - i * 3.3}%)`; x.fillRect(-W2, y0, W2 * 2, y1 - y0);
      x.fillStyle = 'rgba(0,0,0,.4)'; x.fillRect(-W2, y1 - s * 0.03, W2 * 2, s * 0.03);
      x.fillStyle = 'rgba(255,245,230,.12)'; x.fillRect(-W2, y0, W2 * 2, s * 0.014);
    }
    const g = x.createLinearGradient(0, 0, 0, Ls * 0.75); g.addColorStop(0, 'rgba(0,0,0,.8)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(-W2, 0, W2 * 2, Ls * 0.75);
    x.lineWidth = s * 0.012; x.strokeStyle = '#08090a'; x.strokeRect(-W2, 0, W2 * 2, Ls);
  }
  x.restore();
}

// ---------- token art (cached bitmaps; ring, HP, badges and labels are drawn live) ----------
const BS_SPRITES = new Map();
const BS_GLYPHS = new Map();
/* An emoji turned into an engraved cream emblem: keeps the emoji's own shading for detail, but
   reads as one deliberate set of icons rather than a sticker sheet. */
function bsGlyph(emoji, size) {
  const key = emoji + '|' + size;
  if (BS_GLYPHS.has(key)) return BS_GLYPHS.get(key);
  const c = bsCanvas(size, size), x = c.getContext('2d', { willReadFrequently: true });
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = `${Math.round(size * 0.78)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
  x.fillText(emoji, size / 2, size * 0.54);
  try {
    const img = x.getImageData(0, 0, size, size), a = img.data; let lo = 1, hi = 0;
    for (let i = 0; i < a.length; i += 4) if (a[i + 3] > 140) { const l = (0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]) / 255; if (l < lo) lo = l; if (l > hi) hi = l; }
    const span = Math.max(0.2, hi - lo), ink = BS_INK.split(',').map(Number);
    for (let i = 0; i < a.length; i += 4) {
      if (!a[i + 3]) continue;
      const l = (0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]) / 255, v = 0.52 + 0.48 * bsClamp((l - lo) / span, 0, 1);
      a[i] = ink[0] * v; a[i + 1] = ink[1] * v; a[i + 2] = ink[2] * v;
    }
    x.putImageData(img, 0, 0);
  } catch (_) { /* unreadable: keep the emoji as drawn */ }
  if (BS_GLYPHS.size > 120) BS_GLYPHS.clear();
  BS_GLYPHS.set(key, c);
  return c;
}
/* ---------- token emblems ----------
   Every token without a portrait gets a silhouette: a class emblem for PCs (from the character's
   klass), a creature emblem for monsters (from the bestiary id, else the name). All are vector paths in
   one hand: drawn in a 100-unit box centred on 0,0, filled in bone (#EDE6DA) with details cut through to
   the disc, line work at 4.5 units (≈2.5 px on a Medium token at 100%). */
const BS_EMBLEM_INK = '#EDE6DA';
const BS_CLASS_ICONS = [[/fighter|warrior|soldier|knight/, 'fighter'], [/rogue|thief|assassin|swashbuckler/, 'rogue'], [/wizard|mage|bladesinger/, 'wizard'],
  [/cleric|priest/, 'cleric'], [/ranger|hunter|archer/, 'ranger'], [/sorcer/, 'sorcerer'], [/warlock|hexblade/, 'warlock'], [/bard/, 'bard'],
  [/paladin/, 'paladin'], [/barbarian|berserk/, 'barbarian'], [/druid/, 'druid'], [/monk/, 'monk'], [/artificer|tinker/, 'artificer']];
const BS_MONSTER_ICONS = (() => {
  const out = {}, put = (ic, ids) => ids.split(' ').forEach(id => { out[id] = ic; });
  put('humanoid', 'bandit bandit-captain thug guard veteran spy cultist cult-fanatic acolyte priest doppelganger goblin hobgoblin orc gnoll ogre sahuagin merfolk animated-armor');
  put('undead', 'zombie skeleton ghoul ghast shadow specter wight ghost crawling-claw');
  put('beast', 'giant-rat swarm-rats wolf dire-wolf black-bear wererat giant-bat harpy');
  put('spider', 'giant-spider drider'); put('ooze', 'gray-ooze ochre-jelly gelatinous-cube'); put('crate', 'mimic'); put('sorcerer', 'will-o-wisp');
  put('monster', 'giant-centipede stirge darkmantle carrion-crawler grick rust-monster imp quasit');
  return out;
})();
const BS_ICON_WORDS = [[/spider|drider|arachn/i, 'spider'],
  [/skelet|skull|bones?\b|zombie|ghoul|ghast|wight|ghost|spect|wraith|lich|undead|revenant|mummy|vampire|phantom|banshee/i, 'undead'],
  [/dragon|drake|wyrm|wyvern|kobold/i, 'dragon'], [/ooze|slime|jelly|pudding|\bcube\b|blob/i, 'ooze'],
  [/wol(f|ves)|hound|\bdogs?\b|jackal|\brats?\b|bear|\bbats?\b|boar|\bcats?\b|panther|lion|tiger|beast|horse|\bapes?\b|griffon|harpy|bird|eagle|hawk|raven|crow/i, 'beast'],
  [/fire|flame|elemental|wisp|ember/i, 'sorcerer'], [/chest|crate|barrel|\bcart\b|\bbox\b|mimic|wagon/i, 'crate'], [/tree|treant|plant|vine|shrub|blight|fung|myconid/i, 'druid'],
  [/bandit|thug|guard|soldier|knight|sentry|cult|priest|acolyte|spy|veteran|goblin|\borcs?\b|gnoll|ogre|troll|bugbear|merfolk|sahuagin|mage|witch|assassin|captain|noble|villager|commoner|stranger|figure|merchant|innkeeper|\bm[ae]n\b|wom[ae]n/i, 'humanoid'],
  [/demon|devil|fiend|\bimps?\b|quasit|centipede|crawler|stirge|insect|beetle|worm|grick|darkmantle|horror|aberration|monster/i, 'monster']];
const BS_EMOJI_ICONS = { '🕷️': 'spider', '💀': 'undead', '🧟': 'undead', '👻': 'undead', '🐉': 'dragon', '💧': 'ooze', '🧊': 'ooze', '🐺': 'beast', '🐀': 'beast',
  '🦇': 'beast', '🐻': 'beast', '🔥': 'sorcerer', '📦': 'crate', '🌿': 'druid', '🗡️': 'rogue', '⚔️': 'fighter', '🛡️': 'fighter', '🕯️': 'humanoid', '🧙': 'wizard' };
// which emblem a token wears: { pc, klass, monster, name, emoji, kind } (memoised: the view asks every frame)
const BS_ICON_MEMO = new Map();
function bsIconFor(o) {
  const key = `${o.pc ? 1 : 0}|${o.klass || ''}|${o.monster || ''}|${o.name || ''}|${o.emoji || ''}|${o.kind || ''}`;
  let ic = BS_ICON_MEMO.get(key);
  if (!ic) { ic = bsIconPick(o); if (BS_ICON_MEMO.size > 500) BS_ICON_MEMO.clear(); BS_ICON_MEMO.set(key, ic); }
  return ic;
}
function bsIconPick(o) {
  if (o.pc) { const k = String(o.klass || '').toLowerCase(); for (const [re, ic] of BS_CLASS_ICONS) if (re.test(k)) return ic; return 'figure'; }
  if (o.monster && BS_MONSTER_ICONS[o.monster]) return BS_MONSTER_ICONS[o.monster];
  for (const [re, ic] of BS_ICON_WORDS) if (re.test(o.name || '')) return ic;
  if (o.emoji && BS_EMOJI_ICONS[o.emoji]) return BS_EMOJI_ICONS[o.emoji];
  return o.monster || o.kind === 'foe' ? 'monster' : 'figure';
}
function bsEmblem(x, id) {
  const B = () => x.beginPath(), F = () => x.fill();
  const cut = f => { x.save(); x.globalCompositeOperation = 'destination-out'; x.fillStyle = x.strokeStyle = '#000'; f(); x.restore(); };
  const circ = (cx, cy, r) => { x.moveTo(cx + r, cy); x.arc(cx, cy, r, 0, BS_TAU); };
  const ell = (cx, cy, rx, ry, rot = 0) => { x.moveTo(cx + rx * Math.cos(rot), cy + rx * Math.sin(rot)); x.ellipse(cx, cy, rx, ry, rot, 0, BS_TAU); };
  const poly = pts => { pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath(); };
  const rr = (X, Y, W, H, r) => { x.moveTo(X + r, Y); x.arcTo(X + W, Y, X + W, Y + H, r); x.arcTo(X + W, Y + H, X, Y + H, r); x.arcTo(X, Y + H, X, Y, r); x.arcTo(X, Y, X + W, Y, r); x.closePath(); };
  const line = (pts, lw) => { B(); pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.lineWidth = lw; x.stroke(); };
  const star = (cx, cy, R, r, n) => { for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, q = i % 2 ? r : R; i ? x.lineTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q) : x.moveTo(cx + Math.cos(a) * q, cy + Math.sin(a) * q); } x.closePath(); };
  const SW = 4.5;
  x.fillStyle = x.strokeStyle = BS_EMBLEM_INK; x.lineCap = 'round'; x.lineJoin = 'round';
  switch (id) {
    case 'fighter': { // heater shield with a sword cut through it
      const shield = () => { x.moveTo(-32, -36); x.quadraticCurveTo(0, -44, 32, -36); x.lineTo(32, -6); x.bezierCurveTo(32, 18, 18, 34, 0, 46); x.bezierCurveTo(-18, 34, -32, 18, -32, -6); x.closePath(); };
      B(); shield(); F();
      cut(() => { B(); x.save(); x.translate(0, 1); x.scale(0.8, 0.8); shield(); x.restore(); x.lineWidth = 3; x.stroke(); });
      cut(() => { B(); poly([[0, -29], [5.5, -21], [5.5, 9], [-5.5, 9], [-5.5, -21]]); rr(-16, 8, 32, 6, 2); rr(-3.2, 14, 6.4, 11, 1.5); circ(0, 28.5, 4.4); F(); });
      break;
    }
    case 'rogue': { // two crossed daggers
      const dagger = () => { B(); x.moveTo(0, -50); x.quadraticCurveTo(10.5, -28, 8.5, 2); x.lineTo(-8.5, 2); x.quadraticCurveTo(-10.5, -28, 0, -50); rr(-18, 1, 36, 7, 3.5); rr(-4.2, 8, 8.4, 19, 2); circ(0, 32, 6.5); };
      [[-0.68, 0], [0.68, 1]].forEach(([a, top]) => {
        x.save(); x.rotate(a); x.translate(0, 6);
        if (top) cut(() => { dagger(); x.lineWidth = 7; x.stroke(); F(); });
        dagger(); F(); cut(() => line([[0, -40], [0, -5]], 2.2));
        x.restore();
      });
      break;
    }
    case 'wizard': { // pointed hat with a bent tip, a band and a star
      B(); x.moveTo(-27, 26); x.bezierCurveTo(-18, 4, -6, -24, 6, -42); x.quadraticCurveTo(20, -50, 35, -36); x.quadraticCurveTo(22, -37, 16, -30); x.bezierCurveTo(16, -10, 22, 10, 27, 26); x.closePath(); F();
      cut(() => { B(); x.rect(-30, 3, 60, 5); F(); B(); star(2, -14, 9.5, 3.6, 4); F(); B(); ell(0, 30, 48, 13.5); F(); });
      B(); ell(0, 30, 45, 10.5); F();
      break;
    }
    case 'cleric': { // a radiant holy symbol
      B(); for (let i = 0; i < 12; i++) { const a = i * BS_TAU / 12 - Math.PI / 2, L = i % 2 ? 37 : 48, w = 0.27; x.moveTo(Math.cos(a - w) * 14, Math.sin(a - w) * 14); x.lineTo(Math.cos(a) * L, Math.sin(a) * L); x.lineTo(Math.cos(a + w) * 14, Math.sin(a + w) * 14); x.closePath(); } F();
      cut(() => { B(); circ(0, 0, 25); F(); });
      B(); circ(0, 0, 21); F();
      cut(() => { B(); circ(0, 0, 12.5); x.lineWidth = 3.5; x.stroke(); });
      break;
    }
    case 'ranger': { // a drawn bow and arrow
      x.save(); x.rotate(-Math.PI / 4);
      const ex = -30 + 46 * Math.cos(1.08), ey = 46 * Math.sin(1.08);
      B(); x.arc(-30, 0, 46, -1.08, 1.08); x.lineWidth = 9; x.stroke();
      B(); circ(ex, -ey, 4.5); circ(ex, ey, 4.5); F();
      line([[ex, -ey], [-31, 0], [ex, ey]], 2.5);
      line([[-38, 0], [34, 0]], 4.5);
      B(); poly([[48, 0], [31, -10], [36, 0], [31, 10]]); F();
      B(); poly([[-28, 0], [-37, -11], [-47, -11], [-38, 0]]); poly([[-28, 0], [-37, 11], [-47, 11], [-38, 0]]); F();
      x.restore();
      break;
    }
    case 'sorcerer': { // a flame with a flame inside it
      B(); x.moveTo(0, 46); x.bezierCurveTo(-24, 46, -36, 28, -32, 8); x.bezierCurveTo(-29, -8, -18, -16, -16, -30); x.bezierCurveTo(-8, -22, -6, -14, -6, -8);
      x.bezierCurveTo(-2, -24, 6, -38, 3, -50); x.bezierCurveTo(20, -36, 30, -20, 26, -2); x.bezierCurveTo(32, -8, 34, -16, 33, -22); x.bezierCurveTo(42, -4, 40, 22, 30, 34); x.bezierCurveTo(22, 43, 12, 46, 0, 46); F();
      cut(() => { B(); x.moveTo(0, 40); x.bezierCurveTo(-13, 40, -18, 28, -14, 18); x.bezierCurveTo(-11, 10, -4, 6, -2, -6); x.bezierCurveTo(6, 4, 14, 12, 14, 24); x.bezierCurveTo(14, 34, 9, 40, 0, 40); F(); });
      B(); x.moveTo(0, 35); x.bezierCurveTo(-6, 35, -8, 29, -6, 25); x.bezierCurveTo(-4, 21, -1, 19, 0, 13); x.bezierCurveTo(4, 19, 7, 23, 7, 28); x.bezierCurveTo(7, 32, 4, 35, 0, 35); F();
      break;
    }
    case 'warlock': { // an eldritch eye
      B(); x.moveTo(-46, 6); x.quadraticCurveTo(0, -34, 46, 6); x.quadraticCurveTo(0, 44, -46, 6); F();
      cut(() => { B(); circ(0, 6, 15.5); F(); });
      B(); ell(0, 6, 4.6, 12.5); F();
      for (const a of [-150, -120, -90, -60, -30]) { const t = a * Math.PI / 180; line([[Math.cos(t) * 30, 8 + Math.sin(t) * 30], [Math.cos(t) * 41, 8 + Math.sin(t) * 41]], SW); }
      break;
    }
    case 'bard': { // a lute
      x.save(); x.rotate(0.62); x.translate(0, 2);
      B(); x.moveTo(0, -8); x.bezierCurveTo(14, -8, 25, 10, 25, 24); x.bezierCurveTo(25, 38, 14, 46, 0, 46); x.bezierCurveTo(-14, 46, -25, 38, -25, 24); x.bezierCurveTo(-25, 10, -14, -8, 0, -8); F();
      B(); rr(-5, -40, 10, 36, 2); F();
      x.save(); x.translate(0, -39); x.rotate(-0.55); B(); rr(-5.5, -14, 11, 15, 2.5); F(); x.restore();
      cut(() => { B(); circ(0, 16, 8); F(); B(); x.rect(-10, 32, 20, 3.5); F(); for (const sx of [-2.6, 0, 2.6]) line([[sx, -36], [sx, 32]], 1.2); });
      x.restore();
      break;
    }
    case 'paladin': { // a raised sword in a halo
      B(); circ(0, -10, 29); x.lineWidth = SW; x.stroke();
      const sword = () => { B(); poly([[0, -48], [6, -38], [6, 14], [-6, 14], [-6, -38]]); rr(-20, 12, 40, 7, 3); rr(-3.6, 19, 7.2, 16, 2); circ(0, 40, 5.5); };
      cut(() => { sword(); x.lineWidth = 7; x.stroke(); F(); });
      sword(); F();
      cut(() => line([[0, -38], [0, 8]], 2));
      break;
    }
    case 'barbarian': { // a double-bitted axe
      B(); rr(-3.5, -40, 7, 88, 3); F();
      for (const sx of [1, -1]) { B(); x.moveTo(sx * 3, -36); x.quadraticCurveTo(sx * 22, -40, sx * 40, -48); x.quadraticCurveTo(sx * 53, -22, sx * 40, 4); x.quadraticCurveTo(sx * 22, -6, sx * 3, -10); x.closePath(); F(); }
      cut(() => { for (const sx of [1, -1]) { B(); x.moveTo(sx * 34, -40); x.quadraticCurveTo(sx * 44, -22, sx * 34, -3); x.lineWidth = 2; x.stroke(); } for (const y of [18, 26, 34]) line([[-4, y + 3], [4, y - 1]], 1.6); });
      B(); circ(0, -42, 5); F();
      break;
    }
    case 'druid': { // a leaf
      x.save(); x.rotate(-0.7);
      B(); x.moveTo(0, -46); x.bezierCurveTo(30, -26, 30, 22, 0, 38); x.bezierCurveTo(-30, 22, -30, -26, 0, -46); F();
      line([[0, 36], [0, 49]], SW);
      cut(() => { line([[0, -36], [0, 32]], 2.6); for (const y of [-20, -6, 8, 22]) { line([[0, y + 8], [15, y - 4]], 2); line([[0, y + 8], [-15, y - 4]], 2); } });
      x.restore();
      break;
    }
    case 'monk': { // prayer beads with a tassel
      B(); for (let i = 0; i < 12; i++) { const a = i * BS_TAU / 12 - Math.PI / 2; if (i === 6) continue; circ(Math.cos(a) * 30, -8 + Math.sin(a) * 30, 6.2); } F();
      B(); circ(0, 26, 7.5); F();
      B(); poly([[-5, 32], [5, 32], [10, 49], [-10, 49]]); F();
      cut(() => { line([[-2.5, 37], [-4, 47]], 1.4); line([[2.5, 37], [4, 47]], 1.4); });
      break;
    }
    case 'artificer': { // a cog
      B(); const n = 8;
      for (let i = 0; i < n; i++) { const a = i * BS_TAU / n; for (const [rad, da] of [[33, -0.3], [44, -0.17], [44, 0.17], [33, 0.3]]) { const px = Math.cos(a + da) * rad, py = Math.sin(a + da) * rad; i || da !== -0.3 ? x.lineTo(px, py) : x.moveTo(px, py); } }
      x.closePath(); F();
      cut(() => { B(); circ(0, 0, 13); F(); B(); circ(0, 0, 24); x.lineWidth = 2.5; x.stroke(); });
      break;
    }
    case 'humanoid': { // a hooded figure, eyes glinting in the dark of the hood
      B(); x.moveTo(0, -46); x.bezierCurveTo(22, -40, 30, -14, 30, 6); x.bezierCurveTo(30, 20, 40, 34, 44, 46); x.lineTo(-44, 46); x.bezierCurveTo(-40, 34, -30, 20, -30, 6); x.bezierCurveTo(-30, -14, -22, -40, 0, -46); F();
      cut(() => { B(); ell(0, -4, 15, 19); F(); line([[-8, 30], [-14, 46]], 2); line([[8, 30], [14, 46]], 2); });
      B(); ell(-6.5, -5, 3.8, 2.1, 0.15); ell(6.5, -5, 3.8, 2.1, -0.15); F();
      break;
    }
    case 'spider': {
      const legs = [[[7, -17], [24, -34], [27, -48]], [[9, -12], [34, -20], [44, -36]], [[9, -8], [34, 2], [46, 18]], [[7, -5], [26, 18], [30, 44]]];
      for (const sx of [1, -1]) for (const L of legs) line(L.map(([a, b]) => [a * sx, b]), 4.6);
      cut(() => { B(); ell(0, 14, 16, 21); ell(0, -14, 11, 10); x.lineWidth = 5; x.stroke(); });
      B(); ell(0, 14, 16, 21); ell(0, -14, 11, 10); F();
      cut(() => { B(); poly([[-5, 6], [5, 6], [0, 13]]); poly([[-5, 20], [5, 20], [0, 13]]); circ(-3.6, -17, 2); circ(3.6, -17, 2); F(); });
      break;
    }
    case 'undead': { // a skull
      B(); x.moveTo(-30, 4); x.bezierCurveTo(-34, -30, -16, -44, 0, -44); x.bezierCurveTo(16, -44, 34, -30, 30, 4); x.bezierCurveTo(29, 12, 22, 16, 20, 20); x.lineTo(20, 34);
      x.quadraticCurveTo(20, 42, 12, 42); x.lineTo(-12, 42); x.quadraticCurveTo(-20, 42, -20, 34); x.lineTo(-20, 20); x.bezierCurveTo(-22, 16, -29, 12, -30, 4); F();
      cut(() => { B(); ell(-12, -3, 9.5, 10.5); ell(12, -3, 9.5, 10.5); poly([[0, 9], [5, 19], [-5, 19]]); F(); line([[-14, 31], [14, 31]], 2); for (const tx of [-7, 0, 7]) line([[tx, 25], [tx, 40]], 2); });
      break;
    }
    case 'beast': { // a wolf's head
      B(); poly([[0, 44], [-9, 40], [-30, 14], [-41, 10], [-34, 0], [-36, -22], [-33, -48], [-15, -28], [0, -31], [15, -28], [33, -48], [36, -22], [34, 0], [41, 10], [30, 14], [9, 40]]); F();
      cut(() => { B(); poly([[-30, -38], [-28, -24], [-20, -28]]); poly([[30, -38], [28, -24], [20, -28]]); ell(-13, -5, 6.5, 2.8, 0.45); ell(13, -5, 6.5, 2.8, -0.45); poly([[-7, 28], [7, 28], [0, 36]]); F(); line([[0, 36], [0, 42]], 1.6); });
      break;
    }
    case 'dragon': { // a horned head in profile, jaws open, spines down the neck
      B(); poly([[-42, 48], [-38, 22], [-28, 2], [-32, -8], [-50, -34], [-22, -16], [-20, -22], [-30, -48], [-8, -24], [6, -21], [16, -14], [32, -11], [46, -7], [49, 0],
        [40, 3], [16, 7], [42, 15], [40, 20], [20, 26], [4, 30], [-6, 48]]); F();
      cut(() => { B(); poly([[13, -12], [21, -9], [12, -7]]); circ(42, -3, 1.9); F(); });
      B(); for (const tx of [22, 29, 35]) { const yu = 3 + (40 - tx) / 6, yl = 7 + (tx - 16) * 8 / 26; poly([[tx, yu - 0.5], [tx + 3.6, yu - 1], [tx + 1.6, yu + 4]]); poly([[tx - 2, yl + 0.5], [tx + 1.6, yl + 1], [tx - 0.4, yl - 3.6]]); } F();
      B(); poly([[-38, 36], [-49, 34], [-39, 28]]); poly([[-36, 22], [-47, 17], [-35, 14]]); poly([[-31, 8], [-41, 1], [-29, 0]]); F();
      break;
    }
    case 'ooze': { // a slumped blob on its own puddle, full of bubbles
      B(); ell(0, 36, 47, 10); F();
      B(); x.moveTo(-36, 36); x.bezierCurveTo(-42, 12, -30, -22, -6, -28); x.bezierCurveTo(4, -44, 26, -40, 26, -24); x.bezierCurveTo(40, -16, 42, 14, 36, 36); x.closePath(); F();
      cut(() => { B(); circ(-12, 6, 6.5); circ(12, -12, 4.5); circ(14, 16, 7.5); circ(-20, 24, 3.6); circ(0, 26, 2.8); F(); B(); x.arc(-4, 2, 25, Math.PI * 1.08, Math.PI * 1.38); x.lineWidth = 3; x.stroke(); });
      break;
    }
    case 'crate': {
      B(); rr(-34, -34, 68, 68, 4); F();
      cut(() => { B(); x.rect(-24, -24, 48, 48); F(); });
      B(); poly([[-24, 17], [17, -24], [24, -24], [24, -17], [-17, 24], [-24, 24]]); F();
      cut(() => { B(); for (const [a, b] of [[-29, -29], [29, -29], [-29, 29], [29, 29]]) circ(a, b, 2); F(); });
      break;
    }
    case 'monster': { // three claw marks
      for (const o of [-17, 0, 17]) {
        const p0 = [24 + o, -40 + o * 0.35], p1 = [-24 + o, 40 + o * 0.35], m = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2], n = [0.86, 0.5];
        B(); x.moveTo(p0[0], p0[1]); x.quadraticCurveTo(m[0] + n[0] * 12, m[1] + n[1] * 12, p1[0], p1[1]); x.quadraticCurveTo(m[0] + n[0] * 3, m[1] + n[1] * 3, p0[0], p0[1]); F();
      }
      break;
    }
    default: { // a head and shoulders
      B(); x.moveTo(-38, 46); x.bezierCurveTo(-38, 14, -20, 6, 0, 6); x.bezierCurveTo(20, 6, 38, 14, 38, 46); x.closePath(); F();
      cut(() => { B(); circ(0, -16, 21.5); F(); });
      B(); circ(0, -16, 17); F();
    }
  }
}
const BS_EMBLEMS = new Map();
function bsEmblemCanvas(id, size) {
  const key = id + '|' + size; let c = BS_EMBLEMS.get(key); if (c) return c;
  c = bsCanvas(size, size); const x = c.getContext('2d');
  x.translate(size / 2, size / 2); x.scale(size / 100, size / 100);
  bsEmblem(x, id);
  if (BS_EMBLEMS.size > 200) BS_EMBLEMS.clear();
  BS_EMBLEMS.set(key, c);
  return c;
}
// the deep disc behind an emblem, faintly tinted by side
const BS_DISC_TONES = { pc: ['#2e3341', '#14171f'], ally: ['#253a2e', '#0f1913'], foe: ['#452427', '#1b0c0e'], neutral: ['#43341f', '#1a130a'] };
/* A token without a portrait: a flat, deep disc (no sphere highlight) with the emblem at 60% of its
   diameter. Kept under its old name: it is what every generated token is drawn with. */
function bsGenDisc(x, info, px) {
  const r = px / 2, tone = BS_DISC_TONES[info.kind] || BS_DISC_TONES.neutral, rnd = bsRng(bsHash(info.base + '|' + info.kind));
  const g = x.createRadialGradient(r, r * 0.82, r * 0.1, r, r, r);
  g.addColorStop(0, tone[0]); g.addColorStop(1, tone[1]);
  x.fillStyle = g; x.fillRect(0, 0, px, px);
  const ts = 90 + rnd() * 80;
  x.globalCompositeOperation = 'soft-light'; x.globalAlpha = 0.4; x.drawImage(bsFbm(5), rnd() * (256 - ts), rnd() * (256 - ts), ts, ts, 0, 0, px, px);
  x.globalCompositeOperation = 'overlay'; x.globalAlpha = 0.07; x.drawImage(bsNoise(), rnd() * 100, rnd() * 100, 128, 128, 0, 0, px, px);
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  // the emblem box is a little larger than 60% because the shapes stop short of its edges: they read at ~60%
  const S = Math.round(px * 0.66), em = bsEmblemCanvas(info.icon || bsIconFor(info), S);
  x.save(); x.shadowColor = 'rgba(0,0,0,.65)'; x.shadowBlur = px * 0.03; x.shadowOffsetY = px * 0.014;
  x.drawImage(em, Math.round(r - S / 2), Math.round(r - S / 2));
  x.restore();
}
/* A portrait in the disc: tall art is cropped to head and shoulders, wide art to its centre; a dark
   crop (mean luminance under ~0.32) is lifted ~20% with a gamma curve, which keeps blacks and whites. */
function bsPortrait(x, im, px) {
  const iw = im.width, ih = im.height;
  let side, sx, sy;
  if (ih / iw >= 1.15) { side = iw * 0.5; sx = (iw - side) / 2; sy = ih * 0.045; }
  else { side = Math.min(iw, ih); sx = (iw - side) / 2; sy = (ih - side) * 0.3; }
  x.fillStyle = '#1a1d24'; x.fillRect(0, 0, px, px);
  x.imageSmoothingQuality = 'high'; x.drawImage(im, sx, sy, side, side, 0, 0, px, px);
  try {
    const d = x.getImageData(0, 0, px, px), a = d.data, r = px / 2, r2 = (r * 0.92) ** 2;
    let s = 0, n = 0;
    for (let y = 0; y < px; y += 2) for (let X = 0; X < px; X += 2) {
      if ((X - r) ** 2 + (y - r) ** 2 > r2) continue;
      const i = (y * px + X) * 4; s += 0.2126 * a[i] + 0.7152 * a[i + 1] + 0.0722 * a[i + 2]; n++;
    }
    const L = n ? s / (n * 255) : 1;
    if (L >= 0.32 || L <= 0.005) return;
    const gam = Math.log(Math.min(0.45, L * (L < 0.18 ? 1.35 : 1.22))) / Math.log(L), lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(v / 255, gam);
    for (let i = 0; i < a.length; i += 4) { a[i] = lut[a[i]]; a[i + 1] = lut[a[i + 1]]; a[i + 2] = lut[a[i + 2]]; }
    x.putImageData(d, 0, 0);
  } catch (_) { /* art we may not read back: leave it as drawn */ }
}
function bsSprite(info, px, onReady) {
  const imgE = info.img ? bsImage(info.img, onReady) : null;
  const key = `${imgE ? 'i:' + info.img : 'e:' + (info.icon || bsIconFor(info)) + '|' + info.base}|${info.kind}|${info.down ? 1 : 0}|${px}`;
  let c = BS_SPRITES.get(key);
  if (c) return c;
  c = bsCanvas(px, px);
  const x = c.getContext('2d', { willReadFrequently: !!imgE }), r = px / 2;
  x.save(); x.beginPath(); x.arc(r, r, r, 0, BS_TAU); x.clip();
  if (imgE) bsPortrait(x, imgE.img, px); else bsGenDisc(x, info, px);
  // seated under the ring: a soft darkening at the rim, and no sheen (a token is a flat disc, not a ball)
  const v = x.createRadialGradient(r, r, r * 0.74, r, r, r);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,.42)'); x.fillStyle = v; x.fillRect(0, 0, px, px);
  if (info.down) {
    x.globalCompositeOperation = 'saturation'; x.fillStyle = '#808080'; x.fillRect(0, 0, px, px);
    x.globalCompositeOperation = 'multiply'; x.fillStyle = '#626262'; x.fillRect(0, 0, px, px);
    x.globalCompositeOperation = 'source-over';
  }
  x.restore();
  if (BS_SPRITES.size > 400) BS_SPRITES.clear();
  BS_SPRITES.set(key, c);
  return c;
}
// soft contact shadow (≈ CSS 0 2px 6px rgba(0,0,0,.6) at 100%): a disc of radius 100 in a 256² sprite
let BS_SHADOW = null;
function bsShadowSprite() {
  if (BS_SHADOW) return BS_SHADOW;
  const c = bsCanvas(256, 256), x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128), sig = 7;
  g.addColorStop(0, 'rgba(0,0,0,1)');
  for (let i = 0; i <= 20; i++) { const rr = 100 - 3 * sig + i * 6 * sig / 20; g.addColorStop(rr / 128, `rgba(0,0,0,${(0.5 * bsErfc((rr - 100) / (sig * Math.SQRT2))).toFixed(4)})`); }
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  return (BS_SHADOW = c);
}
// warm halo behind the token whose turn it is: token radius ↔ 72 px
let BS_GLOW = null;
function bsGlowSprite() {
  if (BS_GLOW) return BS_GLOW;
  const c = bsCanvas(256, 256), x = c.getContext('2d'), g = x.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(255,206,110,1)'); g.addColorStop(0.55, 'rgba(255,206,110,.95)'); g.addColorStop(0.68, 'rgba(250,190,90,.45)');
  g.addColorStop(0.84, 'rgba(245,170,70,.12)'); g.addColorStop(1, 'rgba(245,170,70,0)');
  x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  return (BS_GLOW = c);
}
// one bevelled metal ring in the side colour, with hairlines so it reads on any floor
function bsBezel(x, X, Y, R, ring, col) {
  x.beginPath(); x.arc(X, Y, R - ring / 2, 0, BS_TAU); x.lineWidth = ring; x.strokeStyle = bsRingStyle(x, X, Y, R, col); x.stroke();
  x.lineWidth = 1;
  x.beginPath(); x.arc(X, Y, R + 0.3, 0, BS_TAU); x.strokeStyle = 'rgba(0,0,0,.6)'; x.stroke();
  x.beginPath(); x.arc(X, Y, R - ring - 0.3, 0, BS_TAU); x.strokeStyle = 'rgba(0,0,0,.42)'; x.stroke();
  if (ring >= 2) { x.beginPath(); x.arc(X, Y, R - ring * 0.6, Math.PI * 1.1, Math.PI * 1.5); x.lineWidth = Math.max(0.6, ring * 0.3); x.lineCap = 'round'; x.strokeStyle = 'rgba(255,255,255,.42)'; x.stroke(); x.lineCap = 'butt'; }
}
/* HP gauge: an arc segment just inside the ring along the bottom of the disc, filling left to right.
   f = 0..1 (GM), or null for the players' plain "bloodied" mark. */
function bsHpArc(x, X, Y, rIn, R, f) {
  const lw = bsClamp(R * 0.085, 2, 5), r = rIn - lw / 2 - 0.75, a0 = Math.PI * 0.8, span = Math.PI * 0.6;
  if (r < 4) return;
  x.save(); x.lineCap = 'round';
  x.beginPath(); x.arc(X, Y, r, a0, a0 - span, true); x.lineWidth = lw + 2; x.strokeStyle = 'rgba(6,8,12,.75)'; x.stroke();
  const col = f == null ? '#e5484d' : f > 0.5 ? '#4ade80' : f > 0.25 ? '#fbbf24' : '#f05252', ff = f == null ? 1 : f;
  if (ff > 0) { x.beginPath(); x.arc(X, Y, r, a0, a0 - span * ff, true); x.lineWidth = lw; x.strokeStyle = col; x.stroke(); }
  x.restore();
}
/* Draw a token disc with its ring into an HTML canvas (tray, initiative strip, display ribbon). */
function bsDisc(canvas, info, cssPx, opts = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5), px = Math.round(cssPx * dpr);
  canvas.width = px; canvas.height = px; canvas.style.width = cssPx + 'px'; canvas.style.height = cssPx + 'px';
  const x = canvas.getContext('2d'), R = px / 2, ring = Math.max(2 * dpr, px * 0.06);
  const sp = bsSprite(info, bsBucket(px), () => bsDisc(canvas, info, cssPx, opts));
  x.clearRect(0, 0, px, px);
  x.drawImage(sp, ring * 0.5, ring * 0.5, px - ring, px - ring);
  bsBezel(x, R, R, R - 0.5, ring, opts.ring || (info.down ? '#7b818c' : BS_KINDS[info.kind].ring));
  if (info.down) bsCross(x, R, R, R * 0.5, Math.max(2, px * 0.07));
  return canvas;
}
/* The token's own art (portrait, class emblem or creature emblem, in its ring) as a new canvas, for any
   UI outside the map. src: a combatant ({ name, monster, characterId, … }), a token, or a token info.
   opts: { chars (default RAW.characters when present), kind, ring }. Redraws itself when a portrait loads. */
function bsTokenArt(src, cssPx, opts = {}) {
  const chars = opts.chars || (typeof RAW !== 'undefined' && RAW && RAW.characters) || [];
  let info = src && src.icon && src.base != null ? src : null;
  if (!info) info = src && src.combatantId !== undefined && src.x !== undefined ? bsTokenInfo(src, null, chars, null) : bsCombatantInfo(src || {}, chars, null);
  if (opts.kind && BS_KINDS[opts.kind] && opts.kind !== info.kind) info = { ...info, kind: opts.kind };
  return bsDisc(document.createElement('canvas'), info, cssPx, opts);
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
// pills: measure (with an optional max total width, truncating with an ellipsis), then draw
function bsPillMeasure(x, text, opt = {}) {
  const fs = opt.size || 12, padX = Math.round(fs * 0.62), h = Math.round(fs * 1.62), dotW = opt.dot ? Math.round(fs * 0.8) : 0;
  x.font = `${opt.weight || 600} ${fs}px Inter, -apple-system, "Segoe UI", Roboto, sans-serif`;
  let t = String(text);
  const room = opt.maxW ? opt.maxW - padX * 2 - dotW : 0;
  if (room > 0 && x.measureText(t).width > room) { while (t.length > 1 && x.measureText(t + '…').width > room) t = t.slice(0, -1); t = t.trimEnd() + '…'; }
  return { text: t, w: Math.ceil(x.measureText(t).width) + padX * 2 + dotW, h, fs, padX, dotW };
}
function bsPillDraw(x, m, X, Y, opt = {}) {
  const dpr = opt.dpr || 1; X = Math.round(X * dpr) / dpr; Y = Math.round(Y * dpr) / dpr;
  x.font = `${opt.weight || 600} ${m.fs}px Inter, -apple-system, "Segoe UI", Roboto, sans-serif`;
  bsRoundRect(x, X, Y, m.w, m.h, m.h / 2);
  x.fillStyle = opt.bg || 'rgba(14,16,22,.84)'; x.fill();
  x.lineWidth = opt.borderW || 1; x.strokeStyle = opt.border || 'rgba(255,255,255,.12)'; x.stroke();
  let tx = X + m.padX;
  if (opt.dot) { x.beginPath(); x.arc(tx + m.fs * 0.25, Y + m.h / 2, m.fs * 0.25, 0, BS_TAU); x.fillStyle = opt.dot; x.fill(); tx += m.dotW; }
  x.fillStyle = opt.color || '#f3f4f6'; x.textAlign = 'left'; x.textBaseline = 'middle';
  x.fillText(m.text, tx, Y + m.h / 2 + 0.5);
  return { x: X, y: Y, w: m.w, h: m.h };
}
// centred pill (opt.max = maximum text width)
function bsPill(x, text, cx, top, opt = {}) {
  const fs = opt.size || 12, extra = Math.round(fs * 0.62) * 2 + (opt.dot ? Math.round(fs * 0.8) : 0);
  const m = bsPillMeasure(x, text, { ...opt, maxW: opt.max ? opt.max + extra : 0 });
  return bsPillDraw(x, m, cx - m.w / 2, top, opt);
}

/* ---------- the view ----------
   new BattleView(canvas, { player, labels }) — player = the TV: no hidden tokens, no DM-only drawings,
   no HP numbers, fog drawn as solid darkness, and only the active combatant is labelled.
   labels (GM only): 'focus' (default: hovered, selected, dragged and active-turn tokens) or 'all'
   (every token big enough to label); also settable later as view.labels.
   safe: optional screen insets { t, r, b, l } covered by floating UI, which labels keep out of
   (view.safe works too). backdrop: optional colour beyond the map edge (view.backdrop too); on the TV
   it is also the colour of the fog, so the two never show a seam.
   pcLabels (TV only): a name chip under every PC token, sized for a TV (view.pcLabels too).
   gmFog (GM only, default true): false hides the fog overlay on the DM's map (view.gmFog too).
   Set data with setScene / setEncounter / setChars and transient overlays through view.live; call
   request() after changing anything. */
const BS_VIEWS = new Set();
if (typeof document !== 'undefined' && document.fonts && document.fonts.addEventListener) {
  // initials are drawn in the display serif: rebuild token art once the web fonts arrive
  document.fonts.addEventListener('loadingdone', () => { BS_SPRITES.clear(); BS_VIEWS.forEach(v => v.request()); });
}
class BattleView {
  constructor(canvas, opts = {}) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.player = !!opts.player;
    this.labels = opts.labels === 'all' ? 'all' : 'focus';
    this.safe = opts.safe || null;
    this.backdrop = opts.backdrop || null;
    this.pcLabels = !!opts.pcLabels;
    this.gmFog = opts.gmFog !== false;
    this.cam = { x: 0, y: 0, z: 1 };
    this.scene = null; this.enc = null; this.chars = []; this.turnId = null; this.rule = '5';
    this.sel = new Set(); this.hover = null; this.selDrawing = null;
    this.live = { drag: null, ruler: null, previews: [], marquee: null, fogDraft: null, calib: null };
    this.pings = []; this.tweens = new Map(); this.lastPos = new Map();
    this.dpr = 1; this.W = 0; this.H = 0; this.raf = 0; this.dirty = true;
    this.onCamera = null; this.onFrame = null;
    this._fog = { sig: null }; this._fogSig = ''; this._lbl = []; this._discs = [];
    this._loop = this._loop.bind(this);
    this._redraw = () => this.request();
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(canvas.parentElement);
    BS_VIEWS.add(this);
    this.resize();
  }
  destroy() { this.dead = true; BS_VIEWS.delete(this); this.ro.disconnect(); if (this.raf) cancelAnimationFrame(this.raf); }
  resize() {
    const r = this.cv.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5), W = Math.max(1, Math.round(r.width)), H = Math.max(1, Math.round(r.height));
    if (W === this.W && H === this.H && dpr === this.dpr) return;
    const had = this.W > 1;
    const c = had ? this.toScene(this.W / 2, this.H / 2) : null;
    this.W = W; this.H = H; this.dpr = dpr;
    this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr);
    this.cv.style.width = W + 'px'; this.cv.style.height = H + 'px';
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

  /* Which tokens are drawn, where (live drag, tweens) and in what order. Tokens resting on the same
     square fan out and shrink a little so each stays visible and clickable (bx/by keep the true spot). */
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
      out.push({ t, x, y, bx: x, by: y, r: bsTokenRadius(sc, t), dragging: !!d, stack: 1 });
    }
    if (out.length > 1) {
      const tol = bsGrid(sc).size * 0.3, groups = [];
      for (const e of out) {
        if (e.dragging) continue;
        let g = groups.find(q => Math.abs(q.x - e.t.x) < tol && Math.abs(q.y - e.t.y) < tol && Math.abs(q.r - e.r) < 0.5);
        if (!g) groups.push(g = { x: e.t.x, y: e.t.y, r: e.r, list: [] });
        g.list.push(e);
      }
      for (const g of groups) {
        const m = g.list.length; if (m < 2) continue;
        const k = [1, 1, 0.6, 0.52, 0.46][Math.min(m, 4)] * (m > 4 ? 0.85 : 1), rho = g.r * [0, 0, 0.45, 0.55, 0.6][Math.min(m, 4)];
        g.list.sort((a, b) => (a.t.id < b.t.id ? -1 : 1));
        g.list.forEach((e, i) => { const a = -Math.PI * 0.75 + i * BS_TAU / m; e.x += Math.cos(a) * rho; e.y += Math.sin(a) * rho; e.r *= k; e.stack = m; });
      }
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
  // the players' fog, which is also the dark beyond the map edge on the TV
  fogColor() { return this.backdrop || BS_FOG_TV; }
  draw(now) {
    const { ctx, dpr, W, H } = this, sc = this.scene, P = this.player;
    let anim = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // on the TV, beyond the map edge is the same darkness as the fog, so there is no seam
    ctx.fillStyle = P && sc && sc.fog && sc.fog.on ? this.fogColor() : this.backdrop || BS_BACKDROP; ctx.fillRect(0, 0, W, H);
    if (!sc) return false;
    const { w, h } = bsSceneSize(sc), z = this.cam.z;
    const [mx, my] = this.toScreen(0, 0);
    // soft drop shadow under the map
    for (let i = 1; i <= 7; i++) { ctx.strokeStyle = `rgba(0,0,0,${0.09 - i * 0.011})`; ctx.lineWidth = 4; ctx.strokeRect(mx - i * 4 + 2, my - i * 4 + 6, w * z + i * 8 - 4, h * z + i * 8 - 4); }
    this.drawBackground(sc, w, h);
    this.drawGrid(sc, w, h);
    this.drawWalls(w, h);
    if (!P) this.drawBounds(w, h);
    this._chips = []; this._placed = [];
    const drawings = this.drawingList(), tpls = drawings.filter(d => d.type === 'template');
    for (const d of tpls) this.drawTemplate(sc, d, d === this.selDrawing);
    for (const d of drawings) if (d.type !== 'template') this.drawShape(sc, d, d === this.selDrawing);
    anim = this.drawTokens(sc, now) || anim;
    // the TV labels before the fog (so darkness covers them); the GM's sit above it, always legible
    if (P) this.drawLabels();
    this.drawFog(sc, w, h);
    // the TV never cuts a template off at the fog: what the fog covers is drawn again on top of it
    if (P && tpls.length && sc.fog && sc.fog.on) this.drawTemplatesOverFog(sc, w, h, tpls);
    this.drawChips();
    if (!P) this.drawLabels();
    anim = this.drawOverlays(sc, now) || anim;
    return anim;
  }
  // the floor's walls again as vectors over the bitmap (which softens at high zoom): wall cores and doors
  drawWalls(w, h) {
    const src = this._floorSrc; if (!src || !(src.plan || src.perimeter)) return;
    const { ctx, dpr, cam } = this, k = dpr * cam.z;
    ctx.save(); ctx.setTransform(k, 0, 0, k, dpr * cam.x, dpr * cam.y);
    ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
    ctx.strokeStyle = '#050607';
    if (src.perimeter) { ctx.lineWidth = src.perimeter * 2; ctx.strokeRect(0, 0, w, h); }
    else {
      const p = src.plan, vr = this.viewRect(), m = p.s;
      ctx.lineCap = 'square'; ctx.lineWidth = p.s * 0.06; ctx.stroke(p.walls);
      for (const d of p.doors) {
        const dx = p.ox + d.in[0] * p.s, dy = p.oy + d.in[1] * p.s;
        if (dx > vr.x + vr.w + m || dy > vr.y + vr.h + m || dx + m * 2 < vr.x || dy + m * 2 < vr.y) continue;
        bsDoor(ctx, d, p, k);
      }
    }
    ctx.restore();
  }
  // a crisp hairline at the map's edge (DM view), so the bounds read on any floor
  drawBounds(w, h) {
    const { ctx, dpr } = this, [x0, y0] = this.toScreen(0, 0), [x1, y1] = this.toScreen(w, h);
    const lw = Math.max(1, Math.round(dpr)), off = (lw % 2) / 2, al = v => (Math.round(v * dpr) + off) / dpr;
    ctx.save(); ctx.lineWidth = lw / dpr; ctx.strokeStyle = 'rgba(255,255,255,.13)';
    ctx.strokeRect(al(x0) - lw / dpr / 2, al(y0) - lw / dpr / 2, al(x1) - al(x0) + lw / dpr, al(y1) - al(y0) + lw / dpr);
    ctx.restore();
  }
  bgSource(sc) {
    if (sc.bg) {
      const e = bsImage(sc.bg, this._redraw);
      if (!e) return null;
      if (!e.mips) { e.mips = bsMips(e.img); e.luma = bsLuma(e.mips[e.mips.length - 1]); }
      return { mips: e.mips, scale: e.img.width / bsSceneSize(sc).w, light: e.luma != null && e.luma > 0.6 };
    }
    return bsFloor(sc);
  }
  drawBackground(sc, w, h) {
    const { ctx, dpr, cam } = this, src = this.bgSource(sc);
    const vr = this.viewRect(), x0 = Math.max(0, vr.x), y0 = Math.max(0, vr.y), x1 = Math.min(w, vr.x + vr.w), y1 = Math.min(h, vr.y + vr.h);
    this._lightFloor = !!(src && src.light);
    this._floorClip = (src && src.clip) || null;
    this._floorSrc = src || null;
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
  /* The grid is its own overlay: one hairline per line (one device-aligned CSS pixel), ~10–14% white
     on dark floors and a warm dark ink on light ones, scaled by the scene's grid opacity. */
  drawGrid(sc, w, h) {
    const g = bsGrid(sc); if (!g.show || g.opacity <= 0) return;
    const { ctx, cam, dpr } = this, s = g.size * cam.z;
    const fade = bsClamp((s - 6) / 14, 0, 1); if (fade <= 0.01) return;
    const vr = this.viewRect();
    const x0 = Math.max(0, vr.x), x1 = Math.min(w, vr.x + vr.w), y0 = Math.max(0, vr.y), y1 = Math.min(h, vr.y + vr.h);
    if (x1 <= x0 || y1 <= y0) return;
    const lw = Math.max(1, Math.round(dpr)), off = (lw % 2) / 2, al = v => (Math.round(v * dpr) + off) / dpr;
    const [, ty0] = this.toScreen(0, y0), [, ty1] = this.toScreen(0, y1), [tx0] = this.toScreen(x0, 0), [tx1] = this.toScreen(x1, 0);
    ctx.beginPath();
    // interior lines only: a line on the map's outer edge sits half outside the fog and shows on the TV
    for (let k = Math.ceil((x0 - g.offsetX) / g.size); g.offsetX + k * g.size <= x1; k++) { const gx = g.offsetX + k * g.size; if (gx <= 0 || gx >= w) continue; const X = al(this.toScreen(gx, 0)[0]); ctx.moveTo(X, ty0); ctx.lineTo(X, ty1); }
    for (let k = Math.ceil((y0 - g.offsetY) / g.size); g.offsetY + k * g.size <= y1; k++) { const gy = g.offsetY + k * g.size; if (gy <= 0 || gy >= h) continue; const Y = al(this.toScreen(0, gy)[1]); ctx.moveTo(tx0, Y); ctx.lineTo(tx1, Y); }
    const op = bsClamp(g.opacity, 0, 1);
    ctx.save();
    // a dungeon's grid is on its floor only: the rock stays solid
    if (this._floorClip) { ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.x, dpr * cam.y); ctx.clip(this._floorClip); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
    ctx.lineWidth = lw / dpr;
    ctx.strokeStyle = this._lightFloor ? `rgba(58,38,18,${(0.1 + op * 0.3) * fade})` : `rgba(255,255,255,${(0.04 + op * 0.2) * fade})`;
    ctx.stroke();
    ctx.restore();
  }
  /* One labelled style for every template: an 18% fill of its colour, the affected squares tinted to
     30%, a 2px solid stroke at 85% (dashed only while it is being placed), and a chip at the origin
     ("Web · 15 ft cube"). Handles show on the DM's view only, and only while selected or placing. */
  drawTemplate(sc, d, selected, preview, bodyOnly) {
    const { ctx, dpr } = this, g = bsTpl(sc, d), col = d.color || '#f97316', z = this.cam.z, P = this.player;
    ctx.save();
    const [ox, oy] = this.toScreen(g.o[0], g.o[1]);
    const shape = () => {
      ctx.beginPath();
      if (g.r != null) ctx.arc(ox, oy, g.r * z, 0, BS_TAU);
      else g.poly.forEach((p, i) => { const [X, Y] = this.toScreen(p[0], p[1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
      ctx.closePath();
    };
    shape(); ctx.fillStyle = bsRgba(col, 0.18); ctx.fill();
    const s = bsGrid(sc).size * z;
    if (s >= 6) {
      const al = v => Math.round(v * dpr) / dpr;
      ctx.beginPath();
      for (const [cx, cy] of bsTplCellsCached(sc, d, g)) { const [X, Y] = this.toScreen(cx, cy), X0 = al(X), Y0 = al(Y); ctx.rect(X0, Y0, al(X + s) - X0, al(Y + s) - Y0); }
      ctx.fillStyle = bsRgba(col, 0.146); ctx.fill(); // over the 18% fill: 30% in all
    }
    shape(); ctx.lineJoin = 'round'; ctx.lineWidth = 2; ctx.strokeStyle = bsRgba(col, 0.85);
    if (preview) ctx.setLineDash([7, 5]);
    ctx.stroke(); ctx.setLineDash([]);
    if (!P && !bodyOnly && (selected || preview)) {
      ctx.beginPath(); ctx.arc(ox, oy, 3.5, 0, BS_TAU); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
      if (selected) { const [ex, ey] = this.toScreen(g.e[0], g.e[1]); ctx.beginPath(); ctx.arc(ex, ey, 5.5, 0, BS_TAU); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke(); }
    }
    ctx.restore();
    if (bodyOnly) return;
    const name = String(d.name || d.label || '').trim();
    const chip = { text: `${name ? name + ' · ' : ''}${g.ft} ft ${BS_TPL_NAMES[g.shape] || ''}`.trim(), col, ox, oy, ux: Math.cos(g.a), uy: Math.sin(g.a), len: g.L * z, circle: g.r != null };
    if (preview) this.drawChips([chip]); else (this._chips || (this._chips = [])).push(chip);
  }
  /* The TV: the fog covers templates in the dark; draw them again into a layer, keep only where the fog
     is (destination-in the fog mask), and lay that on top. Clear areas keep the template under the tokens. */
  drawTemplatesOverFog(sc, w, h, tpls) {
    const { cv, dpr, cam } = this, m = this.fogMask(sc, w, h);
    let L = this._layer;
    if (!L || L.width !== cv.width || L.height !== cv.height) L = this._layer = bsCanvas(cv.width, cv.height);
    const lx = L.getContext('2d'), main = this.ctx;
    lx.setTransform(1, 0, 0, 1, 0, 0); lx.globalCompositeOperation = 'source-over'; lx.clearRect(0, 0, L.width, L.height);
    lx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx = lx;
    try { for (const d of tpls) this.drawTemplate(sc, d, false, false, true); } finally { this.ctx = main; }
    const s = dpr * cam.z / m.k;
    lx.save(); lx.globalCompositeOperation = 'destination-in'; lx.setTransform(s, 0, 0, s, dpr * cam.x, dpr * cam.y); lx.imageSmoothingEnabled = true; lx.drawImage(m.canvas, 0, 0); lx.restore();
    main.save(); main.setTransform(1, 0, 0, 1, 0, 0); main.drawImage(L, 0, 0); main.restore();
  }
  /* Template chips (11px/600 on a dark pill; TV-sized on the TV), after the tokens and the fog so they
     always read. Each sits at its template's origin (inside the shape, just past the caster, for cones,
     lines and cubes), moved along the template if a token is in the way. */
  drawChips(list) {
    const L = list || this._chips; if (!L || !L.length) return;
    const { ctx, dpr } = this, P = this.player, fs = P ? bsClamp(Math.round(this.H * 14 / 1080), 12, 24) : 11;
    const discs = this._discs || [], placed = this._placed || (this._placed = []);
    const hit = r => {
      for (const d of discs) { const cx = bsClamp(d.X, r.x, r.x + r.w), cy = bsClamp(d.Y, r.y, r.y + r.h); if ((d.X - cx) ** 2 + (d.Y - cy) ** 2 < (d.R + 2) ** 2) return true; }
      for (const p of placed) if (r.x < p.x + p.w + 3 && p.x < r.x + r.w + 3 && r.y < p.y + p.h + 3 && p.y < r.y + r.h + 3) return true;
      return false;
    };
    for (const c of L) {
      const opt = { size: fs, weight: 600, dot: c.col, bg: 'rgba(12,14,19,.88)', border: 'rgba(255,255,255,.14)', dpr };
      const m = bsPillMeasure(ctx, c.text, opt), cands = [];
      if (c.circle) { cands.push([c.ox, c.oy]); for (const k of [1, -1, 2, -2, 3, -3]) cands.push([c.ox, c.oy + k * (m.h + 6)]); }
      else {
        const half = Math.abs(c.ux) * m.w / 2 + Math.abs(c.uy) * m.h / 2;
        for (let t = half + 8; t <= Math.max(half + 8, c.len - half); t += 12) cands.push([c.ox + c.ux * t, c.oy + c.uy * t]);
      }
      let at = cands[0];
      for (const q of cands) if (!hit({ x: q[0] - m.w / 2, y: q[1] - m.h / 2, w: m.w, h: m.h })) { at = q; break; }
      const r = { x: at[0] - m.w / 2, y: at[1] - m.h / 2, w: m.w, h: m.h };
      placed.push(r);
      ctx.save(); bsPillDraw(ctx, m, r.x, r.y, opt); ctx.restore();
    }
  }
  /* Drawings share the template language: solid strokes (dashed only while being drawn), an 18% fill.
     A DM-only drawing is marked with a small eye-off badge on the DM's view instead of dashes. */
  drawShape(sc, d, selected, preview) {
    const { ctx } = this, z = this.cam.z, p = (d.pts || []).map(q => this.toScreen(q[0], q[1]));
    if (!p.length) return;
    const col = d.color || '#f8fafc', lw = Math.max(1.25, (d.width || 4) * z);
    ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    if (d.type === 'path') {
      ctx.moveTo(p[0][0], p[0][1]);
      if (p.length < 3) p.slice(1).forEach(q => ctx.lineTo(q[0], q[1])); else { for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2); ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]); }
      if (p.length === 1) ctx.lineTo(p[0][0] + 0.01, p[0][1]);
    } else if (d.type === 'line') { ctx.moveTo(p[0][0], p[0][1]); ctx.lineTo((p[1] || p[0])[0], (p[1] || p[0])[1]); }
    else if (d.type === 'rect' && p[1]) ctx.rect(Math.min(p[0][0], p[1][0]), Math.min(p[0][1], p[1][1]), Math.abs(p[1][0] - p[0][0]), Math.abs(p[1][1] - p[0][1]));
    else if (d.type === 'circle' && p[1]) ctx.arc(p[0][0], p[0][1], Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), 0, BS_TAU);
    if (d.fill && (d.type === 'rect' || d.type === 'circle')) { ctx.fillStyle = bsRgba(col, 0.18); ctx.fill(); }
    if (preview) ctx.setLineDash([lw * 2.2, lw * 1.8]);
    ctx.lineWidth = lw + 2.5; ctx.strokeStyle = 'rgba(0,0,0,.32)'; ctx.stroke();
    ctx.lineWidth = lw; ctx.strokeStyle = bsRgba(col, d.type === 'rect' || d.type === 'circle' ? 0.85 : 1); ctx.stroke();
    ctx.setLineDash([]);
    if (selected && !this.player) {
      ctx.lineWidth = lw + 7; ctx.strokeStyle = 'rgba(127,209,201,.35)'; ctx.stroke();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.stroke();
    }
    if (d.dmOnly && !this.player && !preview) {
      // badge at the shape's top-left: an eye with a slash
      const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
      let bx = Math.min(...xs), by = Math.min(...ys);
      if (d.type === 'circle' && p[1]) { const R = Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]); bx = p[0][0] - R * 0.71; by = p[0][1] - R * 0.71; }
      ctx.beginPath(); ctx.arc(bx, by, 9, 0, BS_TAU); ctx.fillStyle = 'rgba(12,14,19,.9)'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = bsRgba(col, 0.9); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(bx, by, 5, 3, 0, 0, BS_TAU); ctx.lineWidth = 1.3; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.beginPath(); ctx.moveTo(bx - 5, by + 4.5); ctx.lineTo(bx + 5, by - 4.5); ctx.stroke();
    }
    ctx.restore();
  }
  drawTokens(sc, now) {
    const { ctx, dpr } = this, list = this.tokenList(), P = this.player, z = this.cam.z;
    let anim = this.tweens.size > 0;
    this.lastPos.clear();
    const lbl = this._lbl = [], discs = this._discs = [];
    for (const e of list) {
      const t = e.t; this.lastPos.set(t.id, [e.bx, e.by]);
      const [X, Y] = this.toScreen(e.x, e.y), R = e.r * z;
      if (X + R * 2 < 0 || Y + R * 2 < 0 || X - R * 2 > this.W || Y - R * 2 > this.H) continue;
      const info = bsTokenInfo(t, this.enc, this.chars, this.turnId), hidden = !!t.hidden;
      const side = info.down ? '#7b818c' : BS_KINDS[info.kind].ring, ring = bsClamp(R * 0.068, 1.5, 3.5); // ~3px on a Medium token at 100%
      const sel = !P && this.sel.has(t.id), hov = !P && this.hover === t.id, focus = sel || hov || e.dragging || info.turn;
      const dR = R + (info.num && R >= 9 ? 3 : 1); // keep labels clear of the disc and its badge
      discs.push({ X, Y, R: dR });
      ctx.save();
      if (hidden) ctx.globalAlpha = 0.5;
      // lifted off the floor; higher while carried
      const sh = bsShadowSprite(), lift = e.dragging ? 1 : 0, ss = 2.56 * R * (1 + lift * 0.1);
      ctx.save(); ctx.globalAlpha *= lift ? 0.42 : 0.55; ctx.drawImage(sh, X - ss / 2, Y - ss / 2 + R * (0.045 + lift * 0.12), ss, ss); ctx.restore();
      if (info.turn && !info.down) {
        // breathe for a few seconds when the turn arrives, then hold still (no redraws while idle)
        const live = now - (this.turnSince || 0) < 8000, pulse = live ? 0.5 + 0.5 * Math.sin(now / 420) : 0.55;
        const gs = R * 2 * 1.95 * (1 + 0.05 * pulse);
        ctx.save(); ctx.globalAlpha *= 0.72 + 0.28 * pulse; ctx.globalCompositeOperation = 'lighter';
        ctx.drawImage(bsGlowSprite(), X - gs / 2, Y - gs / 2, gs, gs); ctx.restore();
        if (live) anim = true;
      }
      const sp = bsSprite(info, bsBucket(R * 2 * dpr), this._redraw), ar = R - ring * 0.5;
      ctx.drawImage(sp, X - ar, Y - ar, ar * 2, ar * 2);
      bsBezel(ctx, X, Y, R, ring, side);
      if (hidden) { ctx.globalAlpha = 1; ctx.beginPath(); ctx.arc(X, Y, R + 3, 0, BS_TAU); ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.stroke(); ctx.setLineDash([]); }
      if (R >= 9) {
        if (!P && info.hp) { const f = bsClamp(info.hp.hp / info.hp.max, 0, 1); if (f < 1 || sel || hov) bsHpArc(ctx, X, Y, R - ring, R, f); }
        else if (P && info.bloodied) bsHpArc(ctx, X, Y, R - ring, R, null);
      }
      if (info.down) bsCross(ctx, X, Y, R * 0.45, Math.max(2, R * 0.11));
      if (sel) {
        ctx.beginPath(); ctx.arc(X, Y, R + 3, 0, BS_TAU); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.beginPath(); ctx.arc(X, Y, R + 5.5, 0, BS_TAU); ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(127,209,201,.42)'; ctx.stroke();
      } else if (hov) { ctx.beginPath(); ctx.arc(X, Y, R + 2.5, 0, BS_TAU); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.6)'; ctx.stroke(); }
      if (info.num && R >= 9) {
        const br = bsClamp(R * 0.26, 6.5, 11), bx = X + R * 0.72, by = Y - R * 0.72;
        ctx.beginPath(); ctx.arc(bx, by, br, 0, BS_TAU); ctx.fillStyle = '#0f1218'; ctx.fill(); ctx.lineWidth = 1.25; ctx.strokeStyle = side; ctx.stroke();
        ctx.font = `700 ${Math.round(br * 1.2)}px Inter, -apple-system, sans-serif`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(info.num, bx, by + 0.5);
      }
      if (hidden) {
        const bx = X - R * 0.72, by = Y - R * 0.72, br = bsClamp(R * 0.26, 6.5, 11);
        ctx.beginPath(); ctx.arc(bx, by, br, 0, BS_TAU); ctx.fillStyle = '#10131a'; ctx.fill(); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,.5)'; ctx.stroke();
        ctx.beginPath(); ctx.moveTo(bx - br * 0.55, by + br * 0.55); ctx.lineTo(bx + br * 0.55, by - br * 0.55); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.beginPath(); ctx.ellipse(bx, by, br * 0.55, br * 0.32, 0, 0, BS_TAU); ctx.lineWidth = 1.2; ctx.stroke();
      }
      ctx.restore();
      // TV: the active combatant, and (pcLabels) every PC; DM: focus, or every token big enough ('all')
      const pcChip = P && this.pcLabels && !info.turn && !hidden && (info.kind === 'pc' || !!(t.characterId || (info.combatant && info.combatant.characterId)));
      const want = P ? (info.turn && !hidden) || pcChip : focus || (this.labels === 'all' && R >= 18);
      if (want && R >= 6) lbl.push({ text: info.name, X, Y, R: dR + (sel ? 5 : hov ? 2 : 0), dot: BS_KINDS[info.kind].ring, turn: info.turn, focus: focus || pcChip, dim: info.down || hidden, small: pcChip, pri: info.turn ? 4 : e.dragging ? 3 : sel ? 2 : pcChip ? 1.5 : hov ? 1 : 0 });
    }
    return anim;
  }
  /* Name labels, placed so they never sit on a token or on each other: below, above, right, left;
     then the same with the name cut to ~96px; then further out. A passive label ('all' mode) that
     still does not fit is left out; a focused one always shows. */
  drawLabels() {
    const L = this._lbl; if (!L || !L.length) return;
    const { ctx, dpr } = this, P = this.player, big = P ? bsClamp(Math.round(this.H * 0.021), 18, 36) : 12;
    const small = P ? bsClamp(Math.round(this.H * 14 / 1080), 12, 26) : 12; // TV PC chips: 14px at 1080p
    const discs = this._discs || [], placed = this._placed || (this._placed = []), gapP = 3, sf = this.safe || {};
    const bx0 = (sf.l || 0) + 4, by0 = (sf.t || 0) + 4, bx1 = this.W - (sf.r || 0) - 4, by1 = this.H - (sf.b || 0) - 4;
    const hits = r => {
      if (r.x < bx0 || r.y < by0 || r.x + r.w > bx1 || r.y + r.h > by1) return true;
      for (const d of discs) { const cx = bsClamp(d.X, r.x, r.x + r.w), cy = bsClamp(d.Y, r.y, r.y + r.h); if ((d.X - cx) ** 2 + (d.Y - cy) ** 2 < (d.R + 1) ** 2) return true; }
      for (const p of placed) if (r.x < p.x + p.w + gapP && p.x < r.x + r.w + gapP && r.y < p.y + p.h + gapP && p.y < r.y + r.h + gapP) return true;
      return false;
    };
    L.sort((a, b) => b.pri - a.pri);
    for (const l of L) {
      const fs = l.small ? small : big;
      const opt = { size: fs, dot: l.dot, weight: P && !l.small ? 700 : 600, border: l.turn ? 'rgba(226,165,58,.85)' : undefined, borderW: l.turn && P ? 1.5 : 1, bg: P ? 'rgba(10,12,18,.88)' : undefined, dpr };
      const g = P ? (l.small ? 4 : 6) : 4, full = bsPillMeasure(ctx, l.text, opt), cut = bsPillMeasure(ctx, l.text, { ...opt, maxW: 96 * fs / 12 });
      const spots = (m, far) => [
        [l.X - m.w / 2, l.Y + l.R + g + far * (m.h + 3)], [l.X - m.w / 2, l.Y - l.R - g - m.h - far * (m.h + 3)],
        [l.X + l.R + g + far * 8, l.Y - m.h / 2], [l.X - l.R - g - m.w - far * 8, l.Y - m.h / 2]];
      let best = null;
      for (const [m, far] of cut.w < full.w ? [[full, 0], [cut, 0], [cut, 1], [cut, 2]] : [[full, 0], [full, 1], [full, 2]]) {
        for (const [x, y] of spots(m, far)) { const r = { x, y, w: m.w, h: m.h }; if (!hits(r)) { best = { r, m }; break; } }
        if (best) break;
      }
      if (!best) { if (!l.focus) continue; const [x, y] = spots(cut, 0)[0]; best = { r: { x: bsClamp(x, bx0, bx1 - cut.w), y: bsClamp(y, by0, by1 - cut.h), w: cut.w, h: cut.h }, m: cut }; }
      placed.push(best.r);
      ctx.save(); if (l.dim) ctx.globalAlpha = 0.65;
      bsPillDraw(ctx, best.m, best.r.x, best.r.y, opt);
      ctx.restore();
    }
  }
  /* Fog. Every fog state is first rasterised as coverage (1 = fog): reveals carve, hides paint back, in
     order; grow > 0 widens each op by that many scene px. a = coverage per texel (null if the browser
     will not let us read pixels back). */
  fogRaster(sc, w, h, k, grow) {
    const cw = Math.max(1, Math.ceil(w * k)), ch = Math.max(1, Math.ceil(h * k));
    const c = bsCanvas(cw, ch), x = c.getContext('2d', { willReadFrequently: true });
    x.setTransform(k, 0, 0, k, 0, 0);
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    x.lineJoin = 'round'; x.strokeStyle = '#000'; x.lineWidth = grow * 2;
    for (const op of (sc.fog && sc.fog.reveals) || []) {
      if (!op.pts || op.pts.length < 3) continue;
      x.globalCompositeOperation = op.hide ? 'source-over' : 'destination-out';
      x.beginPath(); op.pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath(); x.fill();
      if (grow > 0) x.stroke();
    }
    let a = null;
    try { const d = x.getImageData(0, 0, cw, ch).data; a = new Float32Array(cw * ch); for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3] / 255; } catch (_) { a = null; }
    return { c, a, cw, ch };
  }
  /* The TV's fog: one cached mask per fog state (and colour). Each reveal is widened by ~0.3 square,
     blurred, then the edge is broken up with value noise, so it feathers over about a square in a ragged,
     torch-lit way instead of reading as a lit rectangle. Deep fog and clear ground are never touched by
     the noise, so nothing leaks through solid fog. */
  fogMask(sc, w, h) {
    const sig = this._fogSig + '|' + this.fogColor();
    if (this._fog.sig === sig && this._fog.canvas) return this._fog;
    const s = bsGrid(sc).size, k = Math.min(0.5, 1536 / Math.max(w, h));
    const R = this.fogRaster(sc, w, h, k, s * 0.3), { cw, ch } = R;
    const out = bsCanvas(cw, ch), ox = out.getContext('2d');
    if (R.a) {
      const a = R.a, col = bsColorRgb(this.fogColor());
      for (let p = 0; p < 3; p++) bsBoxBlur(a, cw, ch, Math.max(1, Math.round(s * k * 0.26)));
      const nz = bsFbmArr(23, 256), ns = 64 / (1.2 * s * k); // noise texels per mask texel: blobs of about a square, and finer
      const img = ox.createImageData(cw, ch), d = img.data;
      for (let y = 0; y < ch; y++) {
        const fy = y * ns, y0 = Math.floor(fy), ty = fy - y0, ya = (y0 & 255) * 256, yb = ((y0 + 1) & 255) * 256;
        for (let X = 0; X < cw; X++) {
          const i = y * cw + X, b = a[i];
          let v = b;
          if (b > 0.002 && b < 0.998) {
            const fx = X * ns, x0 = Math.floor(fx), tx = fx - x0, xa = x0 & 255, xb = (x0 + 1) & 255;
            const n = (nz[ya + xa] * (1 - tx) + nz[ya + xb] * tx) * (1 - ty) + (nz[yb + xa] * (1 - tx) + nz[yb + xb] * tx) * ty;
            v = b + (n - 0.5) * 2.4 * b * (1 - b);
          }
          const t = bsClamp((v - 0.2) / 0.6, 0, 1), o = i * 4;
          d[o] = col[0]; d[o + 1] = col[1]; d[o + 2] = col[2]; d[o + 3] = 255 * t * t * (3 - 2 * t);
        }
      }
      ox.putImageData(img, 0, 0);
    } else ox.drawImage(R.c, 0, 0); // no pixel access: a hard-edged mask still works
    this._fog = { sig, canvas: out, k };
    return this._fog;
  }
  /* The DM's fog: the exact edge as vector loops (marching squares over a crisp raster, simplified),
     filled with 55% black and outlined by a 1px line snapped to device pixels, crisp at any zoom. */
  fogLoops(sc, w, h) {
    if (this._fogGM && this._fogGM.sig === this._fogSig) return this._fogGM;
    const k = Math.min(0.5, 1400 / Math.max(w, h)), R = this.fogRaster(sc, w, h, k, 0);
    let fill = null, loops = [];
    if (R.a) {
      loops = bsContours(R.a, R.cw, R.ch, 0.5).map(l => bsSimplifyLoop(l.map(p => [p[0] / k, p[1] / k]), 0.7 / k)).filter(l => l.length > 2);
      fill = new Path2D(); fill.rect(0, 0, w, h);
      for (const l of loops) { fill.moveTo(l[0][0], l[0][1]); for (let i = 1; i < l.length; i++) fill.lineTo(l[i][0], l[i][1]); fill.closePath(); }
    }
    this._fogGM = { sig: this._fogSig, fill, loops, raster: R.a ? null : R.c, k };
    return this._fogGM;
  }
  drawFog(sc, w, h) {
    if (!sc.fog || !sc.fog.on) return;
    const { ctx, dpr, cam } = this;
    if (!this.player) {
      if (!this.gmFog) return;
      const f = this.fogLoops(sc, w, h);
      ctx.save(); ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, dpr * cam.x, dpr * cam.y);
      ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
      if (f.fill) { ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fill(f.fill, 'evenodd'); }
      else { const s = dpr * cam.z / f.k; ctx.setTransform(s, 0, 0, s, dpr * cam.x, dpr * cam.y); ctx.globalAlpha = 0.55; ctx.drawImage(f.raster, 0, 0); }
      ctx.restore();
      if (f.loops.length) {
        const zz = dpr * cam.z, tx = dpr * cam.x, ty = dpr * cam.y, lw = Math.max(1, Math.round(dpr)), off = (lw % 2) / 2;
        ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.beginPath(); ctx.rect(tx, ty, w * zz, h * zz); ctx.clip();
        ctx.beginPath();
        for (const l of f.loops) { l.forEach((p, i) => { const X = Math.round(p[0] * zz + tx) + off, Y = Math.round(p[1] * zz + ty) + off; i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); }); ctx.closePath(); }
        ctx.lineWidth = lw; ctx.lineJoin = 'miter'; ctx.strokeStyle = 'rgba(232,236,244,.62)'; ctx.stroke();
        ctx.restore();
      }
      return;
    }
    const m = this.fogMask(sc, w, h), s = dpr * cam.z / m.k;
    ctx.save(); ctx.setTransform(s, 0, 0, s, dpr * cam.x, dpr * cam.y); ctx.imageSmoothingEnabled = true;
    ctx.drawImage(m.canvas, 0, 0);
    ctx.restore();
  }
  drawOverlays(sc, now) {
    const { ctx } = this, L = this.live; let anim = false;
    for (const p of L.previews || []) { if (p.type === 'template') this.drawTemplate(sc, p, false, true); else if (!(this.player && p.dmOnly)) this.drawShape(sc, p, false, true); }
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
        if (ft > 0 && id === L.drag.lead) { const [cx, cy] = this.toScreen(cur[0], cur[1]); bsPill(ctx, `${ft} ft`, cx, cy - R - (this.player ? 40 : 30), { size: this.player ? 20 : 13, weight: 700, bg: 'rgba(12,14,20,.9)', dpr: this.dpr }); }
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
      bsPill(ctx, `${ft} ft`, bx, by - (this.player ? 56 : 38), { size: this.player ? 24 : 14, weight: 700, bg: 'rgba(12,14,20,.92)', border: 'rgba(127,209,201,.6)', dpr: this.dpr });
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
// in-place box blur of a w×h float array, clamped at the edges (three passes ≈ a gaussian)
function bsBoxBlur(a, w, h, r) {
  const n = 2 * r + 1, tmp = new Float32Array(Math.max(w, h));
  for (let y = 0; y < h; y++) {
    const o = y * w; let acc = 0;
    for (let i = -r; i <= r; i++) acc += a[o + bsClamp(i, 0, w - 1)];
    for (let x = 0; x < w; x++) { tmp[x] = acc / n; acc += a[o + Math.min(w - 1, x + r + 1)] - a[o + Math.max(0, x - r)]; }
    for (let x = 0; x < w; x++) a[o + x] = tmp[x];
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += a[bsClamp(i, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) { tmp[y] = acc / n; acc += a[Math.min(h - 1, y + r + 1) * w + x] - a[Math.max(0, y - r) * w + x]; }
    for (let y = 0; y < h; y++) a[y * w + x] = tmp[y];
  }
}
/* Marching squares: closed iso-lines at level t of a w×h field, as loops in texel coordinates (texel
   centres at +0.5). The field is padded with "above t" so every loop closes; loops keep the above side
   on their left, so they stitch by following each edge crossing to the next. */
function bsContours(a, w, h, t) {
  const GW = w + 2, GH = h + 2, HE = GW * GH, NE = HE * 2;
  const val = (i, j) => (i <= 0 || j <= 0 || i > w || j > h ? 1 : a[(j - 1) * w + (i - 1)]);
  const next = new Int32Array(NE).fill(-1), px = new Float32Array(NE), py = new Float32Array(NE);
  const lerp = (v0, v1) => { const d = v1 - v0; return Math.abs(d) < 1e-6 ? 0.5 : bsClamp((t - v0) / d, 0, 1); };
  for (let j = 0; j < GH - 1; j++) for (let i = 0; i < GW - 1; i++) {
    const tl = val(i, j), tr = val(i + 1, j), br = val(i + 1, j + 1), bl = val(i, j + 1);
    const idx = (tl >= t ? 8 : 0) | (tr >= t ? 4 : 0) | (br >= t ? 2 : 0) | (bl >= t ? 1 : 0);
    if (idx === 0 || idx === 15) continue;
    const T = j * GW + i, B = (j + 1) * GW + i, L = HE + j * GW + i, R = HE + j * GW + i + 1;
    px[T] = i + lerp(tl, tr); py[T] = j; px[B] = i + lerp(bl, br); py[B] = j + 1;
    px[L] = i; py[L] = j + lerp(tl, bl); px[R] = i + 1; py[R] = j + lerp(tr, br);
    const joined = (tl + tr + br + bl) / 4 >= t;
    switch (idx) {
      case 1: next[B] = L; break; case 2: next[R] = B; break; case 3: next[R] = L; break; case 4: next[T] = R; break;
      case 5: if (joined) { next[T] = L; next[B] = R; } else { next[T] = R; next[B] = L; } break;
      case 6: next[T] = B; break; case 7: next[T] = L; break; case 8: next[L] = T; break; case 9: next[B] = T; break;
      case 10: if (joined) { next[R] = T; next[L] = B; } else { next[L] = T; next[R] = B; } break;
      case 11: next[R] = T; break; case 12: next[L] = R; break; case 13: next[B] = R; break; case 14: next[L] = B; break;
    }
  }
  const loops = [], seen = new Uint8Array(NE);
  for (let e0 = 0; e0 < NE; e0++) {
    if (next[e0] < 0 || seen[e0]) continue;
    const loop = [];
    for (let e = e0; e >= 0 && !seen[e]; e = next[e]) { seen[e] = 1; loop.push([px[e] - 0.5, py[e] - 0.5]); }
    if (loop.length > 2) loops.push(loop);
  }
  return loops;
}
// Douglas–Peucker without recursion (long fog edges would blow the stack)
function bsRdp(pts, eps) {
  const n = pts.length; if (n < 3) return pts.slice();
  const keep = new Uint8Array(n), stack = [[0, n - 1]]; keep[0] = keep[n - 1] = 1;
  while (stack.length) {
    const [i0, i1] = stack.pop(); let idx = -1, max = eps;
    for (let i = i0 + 1; i < i1; i++) { const d = bsDistSeg(pts[i][0], pts[i][1], pts[i0], pts[i1]); if (d > max) { max = d; idx = i; } }
    if (idx >= 0) { keep[idx] = 1; stack.push([i0, idx], [idx, i1]); }
  }
  return pts.filter((_, i) => keep[i]);
}
// a closed loop: split at the point farthest from the first, simplify both halves
function bsSimplifyLoop(loop, eps) {
  if (loop.length < 4) return loop;
  let far = 0, md = -1;
  for (let i = 1; i < loop.length; i++) { const d = (loop[i][0] - loop[0][0]) ** 2 + (loop[i][1] - loop[0][1]) ** 2; if (d > md) { md = d; far = i; } }
  const A = bsRdp(loop.slice(0, far + 1), eps), B = bsRdp(loop.slice(far).concat([loop[0]]), eps);
  return A.concat(B.slice(1, -1));
}
// any CSS colour as [r, g, b]
const BS_RGB = {};
function bsColorRgb(col) {
  if (BS_RGB[col]) return BS_RGB[col];
  let out = [8, 9, 11];
  try { const x = bsCanvas(1, 1).getContext('2d', { willReadFrequently: true }); x.fillStyle = '#08090b'; x.fillStyle = col; x.fillRect(0, 0, 1, 1); const d = x.getImageData(0, 0, 1, 1).data; out = [d[0], d[1], d[2]]; } catch (_) { /* keep the default */ }
  return (BS_RGB[col] = out);
}
