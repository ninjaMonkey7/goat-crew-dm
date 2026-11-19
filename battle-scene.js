/* battle-scene.js — the battle map renderer, shared by the DM's Battle map tab (battlemap.js) and the
   player display window (display.js). Canvas 2D. Scene coordinates are pixels of the map; the camera
   maps them to the screen as  screen = scene * z + (x, y). Pure drawing and geometry: no saving here.
   Needs media() from gh.js for images in the private data branch.

   Frame order: floor (cached bitmap) → grid overlay → templates → drawings → tokens → fog (cached,
   feathered mask) → labels (GM) → live overlays. Everything expensive (floors, fog, token art, shadows)
   is built once into offscreen canvases, so a pan or a drag only composites. */
'use strict';

const BS_TAU = Math.PI * 2;
const BS_BACKDROP = '#0c0e13';
const BS_KINDS = {
  pc: { label: 'PC', ring: '#f2c15e' },
  ally: { label: 'Ally', ring: '#4ade80' },
  foe: { label: 'Foe', ring: '#f05252' },
  neutral: { label: 'Neutral', ring: '#e8943a' }
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
  const c = bsCanvas(n, n), x = c.getContext('2d'), d = x.createImageData(n, n);
  for (let i = 0; i < n * n; i++) { const v = Math.round((acc[i] - mn) / (mx - mn || 1) * 255); d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = v; d.data[i * 4 + 3] = 255; }
  x.putImageData(d, 0, 0);
  return (BS_FBM[key] = c);
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
const BS_FLOORS = { flagstone: 'Dungeon flagstones', planks: 'Tavern planks', parchment: 'Parchment' };
const BS_FLOOR_CACHE = new Map();
function bsFloor(sc) {
  const { w, h } = bsSceneSize(sc), g = bsGrid(sc), style = BS_FLOORS[sc.floor] ? sc.floor : 'flagstone';
  const key = `${sc.id}|${style}|${w}x${h}|${g.size}|${g.offsetX}|${g.offsetY}`;
  if (BS_FLOOR_CACHE.has(key)) return BS_FLOOR_CACHE.get(key);
  const k = Math.min(1, 3072 / Math.max(w, h));
  const c = bsCanvas(w * k, h * k), x = c.getContext('2d');
  x.scale(k, k);
  const rnd = bsRng(sc.id + style);
  if (style === 'planks') bsPlanks(x, w, h, g.size, rnd, k);
  else if (style === 'parchment') bsParchment(x, w, h, g.size, rnd, k);
  else bsFlagstone(x, w, h, g.size, rnd, k);
  const out = { mips: bsMips(c), scale: k, light: style === 'parchment' };
  if (BS_FLOOR_CACHE.size > 6) BS_FLOOR_CACHE.delete(BS_FLOOR_CACHE.keys().next().value);
  BS_FLOOR_CACHE.set(key, out);
  return out;
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
function bsFlagstone(x, w, h, s, rnd, k) {
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
  bsVignette(x, w, h, 'rgba(0,0,0,.55)', 0.3);
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
// a minted coin for tokens without art: lit enamel, cloudy texture, an engraved border, an embossed emblem or initials
function bsGenDisc(x, info, px) {
  const r = px / 2, h = bsHash(info.base + '|' + info.kind), rnd = bsRng(h);
  const list = BS_KIND_PALETTES[info.kind] || BS_KIND_PALETTES.neutral, pal = BS_PALETTES[list[h % list.length]];
  const g = x.createRadialGradient(r * 0.66, r * 0.5, r * 0.04, r, r * 1.04, r * 1.06);
  g.addColorStop(0, pal[0]); g.addColorStop(0.52, pal[1]); g.addColorStop(1, pal[2]);
  x.fillStyle = g; x.fillRect(0, 0, px, px);
  const ts = 70 + rnd() * 90, tex = bsFbm(5);
  x.globalCompositeOperation = 'soft-light'; x.globalAlpha = 0.75; x.drawImage(tex, rnd() * (256 - ts), rnd() * (256 - ts), ts, ts, 0, 0, px, px);
  x.globalCompositeOperation = 'overlay'; x.globalAlpha = 0.12; x.drawImage(bsNoise(), rnd() * 100, rnd() * 100, 120, 120, 0, 0, px, px);
  x.globalCompositeOperation = 'source-over'; x.globalAlpha = 1;
  // engraved border
  const lw = Math.max(1, px * 0.011);
  x.beginPath(); x.arc(r, r + lw * 0.6, r * 0.82, 0, BS_TAU); x.lineWidth = lw; x.strokeStyle = 'rgba(255,255,255,.13)'; x.stroke();
  x.beginPath(); x.arc(r, r, r * 0.82, 0, BS_TAU); x.strokeStyle = 'rgba(0,0,0,.4)'; x.stroke();
  x.save();
  x.shadowColor = 'rgba(0,0,0,.6)'; x.shadowBlur = px * 0.03; x.shadowOffsetY = px * 0.014;
  if (info.emoji) {
    const gs = Math.round(px * 0.62); x.drawImage(bsGlyph(info.emoji, Math.max(48, gs)), r - gs / 2, r - gs / 2, gs, gs);
  } else {
    const txt = bsInitials(info.base);
    x.font = `700 ${Math.round(px * (txt.length > 1 ? 0.42 : 0.5))}px "Cormorant Garamond", Georgia, serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    const tg = x.createLinearGradient(0, r * 0.6, 0, r * 1.4); tg.addColorStop(0, '#fbf4e4'); tg.addColorStop(1, '#d6c4a0');
    x.fillStyle = tg; x.fillText(txt, r, r * 1.05);
  }
  x.restore();
}
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
    x.fillStyle = '#1a1d24'; x.fillRect(0, 0, px, px);
    x.drawImage(im, r - im.width * k / 2, r - im.height * k / 2, im.width * k, im.height * k);
  } else bsGenDisc(x, info, px);
  // set into a bezel: the art darkens toward the rim, with a soft sheen from the top left
  const v = x.createRadialGradient(r, r, r * 0.7, r, r, r);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.8, 'rgba(0,0,0,.14)'); v.addColorStop(1, 'rgba(0,0,0,.55)'); x.fillStyle = v; x.fillRect(0, 0, px, px);
  const hl = x.createLinearGradient(0, 0, px * 0.6, px); hl.addColorStop(0, 'rgba(255,255,255,.16)'); hl.addColorStop(0.42, 'rgba(255,255,255,0)'); x.fillStyle = hl; x.fillRect(0, 0, px, px);
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
   (view.safe works too). backdrop: optional colour beyond the map edge (view.backdrop too).
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
  draw(now) {
    const { ctx, dpr, W, H } = this, sc = this.scene;
    let anim = false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // on the TV, beyond the map edge is the same darkness as the fog, so there is no seam
    ctx.fillStyle = this.player && sc && sc.fog && sc.fog.on ? '#05070b' : this.backdrop || BS_BACKDROP; ctx.fillRect(0, 0, W, H);
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
    // the TV labels before the fog (so darkness covers them); the GM's sit above it, always legible
    if (this.player) this.drawLabels();
    this.drawFog(sc, w, h);
    if (!this.player) this.drawLabels();
    anim = this.drawOverlays(sc, now) || anim;
    return anim;
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
    ctx.lineWidth = lw / dpr;
    ctx.strokeStyle = this._lightFloor ? `rgba(58,38,18,${(0.1 + op * 0.3) * fade})` : `rgba(255,255,255,${(0.04 + op * 0.2) * fade})`;
    ctx.stroke();
  }
  /* One visual language for every template: tinted affected squares, a ~20% fill of the template
     colour, a 1.5px stroke at 80%, a 6px origin handle. */
  drawTemplate(sc, d, selected, preview) {
    const { ctx, dpr } = this, g = bsTpl(sc, d), col = d.color || '#f97316', z = this.cam.z;
    ctx.save();
    const s = bsGrid(sc).size * z;
    if (s >= 6) {
      const al = v => Math.round(v * dpr) / dpr;
      ctx.beginPath();
      for (const [cx, cy] of bsTplCellsCached(sc, d, g)) { const [X, Y] = this.toScreen(cx, cy), X0 = al(X), Y0 = al(Y); ctx.rect(X0, Y0, al(X + s) - X0, al(Y + s) - Y0); }
      ctx.fillStyle = bsRgba(col, 0.13); ctx.fill();
    }
    const [ox, oy] = this.toScreen(g.o[0], g.o[1]);
    ctx.beginPath();
    if (g.r != null) ctx.arc(ox, oy, g.r * z, 0, BS_TAU);
    else g.poly.forEach((p, i) => { const [X, Y] = this.toScreen(p[0], p[1]); i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y); });
    ctx.closePath();
    ctx.fillStyle = bsRgba(col, 0.2); ctx.fill();
    ctx.lineJoin = 'round'; ctx.lineWidth = 1.5; ctx.strokeStyle = bsRgba(col, 0.8); ctx.stroke();
    ctx.beginPath(); ctx.arc(ox, oy, 3, 0, BS_TAU); ctx.fillStyle = col; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.stroke();
    if (selected || preview) {
      const [ex, ey] = this.toScreen(g.e[0], g.e[1]);
      if (selected && !this.player) { ctx.beginPath(); ctx.arc(ex, ey, 5.5, 0, BS_TAU); ctx.fillStyle = '#fff'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = col; ctx.stroke(); }
      const lx = g.r != null ? ox : (ox + ex) / 2, ly = g.r != null ? oy - g.r * z - (this.player ? 40 : 28) : (oy + ey) / 2 - (this.player ? 18 : 12);
      bsPill(ctx, `${g.ft} ft ${BS_TPL_NAMES[g.shape] || ''}`, lx, ly, { size: this.player ? 18 : 12, dot: col, dpr });
    }
    ctx.restore();
  }
  drawShape(sc, d, selected) {
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
    if (d.fill && (d.type === 'rect' || d.type === 'circle')) { ctx.fillStyle = bsRgba(col, 0.2); ctx.fill(); }
    if (d.dmOnly && !this.player) ctx.setLineDash([lw * 2.2, lw * 1.8]);
    ctx.lineWidth = lw + 2.5; ctx.strokeStyle = 'rgba(0,0,0,.32)'; ctx.stroke();
    ctx.lineWidth = lw; ctx.strokeStyle = col; ctx.stroke();
    if (selected) { ctx.setLineDash([5, 4]); ctx.lineWidth = 1.5; ctx.strokeStyle = '#fff'; ctx.stroke(); }
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
      const side = info.down ? '#7b818c' : BS_KINDS[info.kind].ring, ring = bsClamp(R * 0.055, 1.75, 4.5);
      const sel = !P && this.sel.has(t.id), hov = !P && this.hover === t.id, focus = sel || hov || e.dragging || info.turn;
      const dR = R + (info.num && R >= 9 ? 3 : 1); // keep labels clear of the disc and its badge
      discs.push({ X, Y, R: dR });
      ctx.save();
      if (hidden) ctx.globalAlpha = 0.5;
      // lifted off the floor; higher while carried
      const sh = bsShadowSprite(), lift = e.dragging ? 1 : 0, ss = 2.56 * R * (1 + lift * 0.1);
      ctx.save(); ctx.globalAlpha *= lift ? 0.42 : 0.6; ctx.drawImage(sh, X - ss / 2, Y - ss / 2 + R * (0.045 + lift * 0.12), ss, ss); ctx.restore();
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
      const want = P ? info.turn && !hidden : focus || (this.labels === 'all' && R >= 18);
      if (want && R >= 6) lbl.push({ text: info.name, X, Y, R: dR + (sel ? 5 : hov ? 2 : 0), dot: BS_KINDS[info.kind].ring, turn: info.turn, focus, dim: info.down || hidden, pri: info.turn ? 4 : e.dragging ? 3 : sel ? 2 : hov ? 1 : 0 });
    }
    return anim;
  }
  /* Name labels, placed so they never sit on a token or on each other: below, above, right, left;
     then the same with the name cut to ~96px; then further out. A passive label ('all' mode) that
     still does not fit is left out; a focused one always shows. */
  drawLabels() {
    const L = this._lbl; if (!L || !L.length) return;
    const { ctx, dpr } = this, P = this.player, fs = P ? bsClamp(Math.round(this.H * 0.021), 18, 36) : 12;
    const discs = this._discs || [], placed = [], gapP = 3, sf = this.safe || {};
    const bx0 = (sf.l || 0) + 4, by0 = (sf.t || 0) + 4, bx1 = this.W - (sf.r || 0) - 4, by1 = this.H - (sf.b || 0) - 4;
    const hits = r => {
      if (r.x < bx0 || r.y < by0 || r.x + r.w > bx1 || r.y + r.h > by1) return true;
      for (const d of discs) { const cx = bsClamp(d.X, r.x, r.x + r.w), cy = bsClamp(d.Y, r.y, r.y + r.h); if ((d.X - cx) ** 2 + (d.Y - cy) ** 2 < (d.R + 1) ** 2) return true; }
      for (const p of placed) if (r.x < p.x + p.w + gapP && p.x < r.x + r.w + gapP && r.y < p.y + p.h + gapP && p.y < r.y + r.h + gapP) return true;
      return false;
    };
    L.sort((a, b) => b.pri - a.pri);
    for (const l of L) {
      const opt = { size: fs, dot: l.dot, weight: P ? 700 : 600, border: l.turn ? 'rgba(242,193,94,.85)' : undefined, borderW: l.turn && P ? 1.5 : 1, bg: P ? 'rgba(10,12,18,.88)' : undefined, dpr };
      const g = P ? 6 : 4, full = bsPillMeasure(ctx, l.text, opt), cut = bsPillMeasure(ctx, l.text, { ...opt, maxW: 96 * fs / 12 });
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
  /* Fog: one cached mask per fog state, at most ~1.5k texels across. Each reveal (or hide) grows by
     half the feather, then the mask is blurred, so a revealed area is fully clear inside and fades
     to dark over ~20 scene px (16–24 px at 100%). The GM sees it as ~60% black, the TV as solid dark. */
  fogMask(sc, w, h) {
    if (this._fog.sig === this._fogSig && this._fog.canvas) return this._fog;
    const F = bsClamp(bsGrid(sc).size * 0.2, 16, 24), k = Math.min(0.5, 1536 / Math.max(w, h));
    const cw = Math.max(1, Math.ceil(w * k)), ch = Math.max(1, Math.ceil(h * k));
    const c = bsCanvas(cw, ch), x = c.getContext('2d', { willReadFrequently: true });
    x.setTransform(k, 0, 0, k, 0, 0);
    x.fillStyle = '#000'; x.fillRect(0, 0, w, h);
    x.lineJoin = 'round'; x.lineWidth = F; x.strokeStyle = '#000';
    for (const op of (sc.fog && sc.fog.reveals) || []) {
      if (!op.pts || op.pts.length < 3) continue;
      x.globalCompositeOperation = op.hide ? 'source-over' : 'destination-out';
      x.beginPath(); op.pts.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1])); x.closePath(); x.fill(); x.stroke();
    }
    x.setTransform(1, 0, 0, 1, 0, 0); x.globalCompositeOperation = 'source-over';
    try {
      const img = x.getImageData(0, 0, cw, ch), d = img.data, a = new Float32Array(cw * ch);
      for (let i = 0; i < a.length; i++) a[i] = d[i * 4 + 3];
      const r = Math.max(1, Math.round(F * k / 2.56 - 0.5));
      for (let p = 0; p < 3; p++) bsBoxBlur(a, cw, ch, r);
      const col = this.player ? [5, 7, 11] : [3, 4, 8];
      for (let i = 0; i < a.length; i++) { d[i * 4] = col[0]; d[i * 4 + 1] = col[1]; d[i * 4 + 2] = col[2]; d[i * 4 + 3] = a[i]; }
      x.putImageData(img, 0, 0);
    } catch (_) { /* no pixel access: a hard-edged mask still works */ }
    // hand the per-frame drawImage a plain (GPU-friendly) canvas, not the read-back one
    const out = bsCanvas(cw, ch); out.getContext('2d').drawImage(c, 0, 0);
    this._fog = { sig: this._fogSig, canvas: out, k };
    return this._fog;
  }
  drawFog(sc, w, h) {
    if (!sc.fog || !sc.fog.on) return;
    const { ctx, dpr, cam } = this, m = this.fogMask(sc, w, h), s = dpr * cam.z / m.k;
    ctx.save(); ctx.setTransform(s, 0, 0, s, dpr * cam.x, dpr * cam.y); ctx.imageSmoothingEnabled = true;
    if (!this.player) ctx.globalAlpha = 0.6;
    ctx.drawImage(m.canvas, 0, 0);
    ctx.restore();
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
