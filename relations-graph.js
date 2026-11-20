/* relations-graph.js — the relationship web (PCs, NPCs, factions) drawn as an interactive SVG graph.
   One global: RelGraph. RelGraph.mount(container, opts) → controller; RelGraph.swatch(type, key, kinds) → legend SVG markup.
   Rendering: SVG. Nodes, links and faction hulls live in graph coordinates under one camera transform; names, tie
   labels, hull titles and marks sit in a screen-space overlay, so text stays crisp and the same size at any zoom.
   Colour carries three meanings only: tie kind (edges), attitude to the party (NPC rings) and faction (hulls). Gold is
   the party's. Layout: a small force simulation run to rest off-screen, then tweened into place; the animation loop
   stops completely whenever nothing moves. Theming: CSS variables plus a watch on html[data-theme]. */
'use strict';
const RelGraph = (() => {
  const NS = 'http://www.w3.org/2000/svg';
  const REDUCED = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const R = { pc: 16, faction: 26, npcMin: 16, npcMax: 28 };    // radii in graph units (1 unit = 1px at zoom 1)
  // tie kinds: [dark, light, tone, directed]. Colour is valence only (warm / hostile / structural); the page's kinds win.
  const KIND_FALLBACK = {
    ally: ['#34D399', '#059669', 'warm'], friend: ['#34D399', '#059669', 'warm'], family: ['#34D399', '#059669', 'warm'],
    romance: ['#34D399', '#059669', 'warm'], rival: ['#FDA4AF', '#F87171', 'hostile'], enemy: ['#EF4444', '#B91C1C', 'hostile'],
    serves: ['#8B8B94', '#71717A', 'structural', true], owes: ['#8B8B94', '#71717A', 'structural', true],
    member: ['#8B8B94', '#71717A', 'structural'], knows: ['#8B8B94', '#71717A', 'structural']
  };
  const SPARE = [['#8B8B94', '#71717A']];
  // widths follow tone (rival and knows are the two exceptions the palette calls for)
  const TONE = { warm: { w: 2, op: 1, layer: 1 }, hostile: { w: 3, op: 1, layer: 2 }, structural: { w: 1.5, op: 1, layer: 0 } };
  const KIND_W = { rival: [2, 1], knows: [1, .55] };
  // faction hues avoid red, green and amber (those mean foe, friend and the party)
  const FACTION_HUES = { dark: ['#3E63DD', '#0090FF', '#AD7F58', '#D6409F', '#978365', '#0D74CE'],
    light: ['#3358D4', '#0D74CE', '#A07553', '#C2298A', '#71624B', '#0B68C1'] };
  const CANVAS = { dark: '#111113', light: '#F4F2EC' };
  const NODE_FILL = { dark: '#1E1B24', light: '#FFFFFF' };
  // attitude to the party: a red → grey → green ramp told apart by lightness and width too (amber is the party's)
  const ATTITUDES = {
    ally: { label: 'Loyal', color: '#22C55E', light: '#15803D', width: 3.5 },
    friendly: { label: 'Friendly', color: '#86EFAC', light: '#4ADE80', width: 1.5 },
    neutral: { label: 'Neutral', color: '#A1A1AA', light: '#A1A1AA', width: 2 },
    wary: { label: 'Wary', color: '#FCA5A5', light: '#F87171', width: 1.5 },
    hostile: { label: 'Hostile', color: '#EF4444', light: '#B91C1C', width: 3.5 },
    unknown: { label: 'Unknown', color: '#8B8D98', light: '#80838D', width: 1.5 }
  };
  const PC = { dark: { ring: '#F5A524', fill: 'rgba(245,165,36,.18)', ink: '#F5C26B' }, light: { ring: '#D97706', fill: '#FDE7C2', ink: '#9A4A06' } };
  // attitude → orbit radius in the 'party' layout (multiples of the base ring)
  const ORBIT = { ally: 1, friendly: 1.27, neutral: 1.55, unknown: 1.78, wary: 2, hostile: 2.25 };
  const ORBIT_NAMES = [['ally', 'Loyal'], ['neutral', 'Neutral'], ['hostile', 'Hostile']];
  const ICON = {   // Lucide (ISC licence)
    eyeoff: '<path d="M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49"/><path d="M14.084 14.158a3 3 0 0 1-4.242-4.242"/><path d="M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143"/><path d="m2 2 20 20"/>',
    plus: '<path d="M5 12h14"/><path d="M12 5v14"/>', minus: '<path d="M5 12h14"/>', chev: '<path d="m6 15 6-6 6 6"/>',
    fit: '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>',
    user: '<circle cx="12" cy="8" r="4.2"/><path d="M4.5 20.5c1.2-3.6 4.1-5.6 7.5-5.6s6.3 2 7.5 5.6"/>',
    shield: '<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
    crown: '<path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/>',
    swords: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" x2="19" y1="19" y2="13"/><line x1="16" x2="20" y1="16" y2="20"/><line x1="19" x2="21" y1="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" x2="9" y1="14" y2="18"/><line x1="7" x2="4" y1="17" y2="20"/><line x1="3" x2="5" y1="19" y2="21"/>',
    flag: '<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>',
    coins: '<circle cx="8" cy="8" r="6"/><path d="M18.09 10.37A6 6 0 1 1 10.34 18"/><path d="M7 6h1v4"/><path d="m16.71 13.88.7.71-2.82 2.82"/>',
    key: '<path d="m15.5 7.5 2.3 2.3a1 1 0 0 0 1.4 0l2.1-2.1a1 1 0 0 0 0-1.4L19 4"/><path d="m21 2-9.6 9.6"/><circle cx="7.5" cy="15.5" r="5.5"/>',
    compass: '<path d="m16.24 7.76-1.804 5.411a2 2 0 0 1-1.265 1.265L7.76 16.24l1.804-5.411a2 2 0 0 1 1.265-1.265z"/><circle cx="12" cy="12" r="10"/>',
    book: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    anchor: '<path d="M12 22V8"/><path d="M5 12H2a10 10 0 0 0 20 0h-3"/><circle cx="12" cy="5" r="3"/>'
  };
  // a faction's glyph, picked from generic words in its name (a stable fallback otherwise)
  const GLYPHS = [[/guild|merchant|trade|coin|bank|market|company/i, 'coins'], [/crown|court|king|queen|royal|throne|baron|duke|house/i, 'crown'],
    [/guard|watch|warden|order|knight|shield|keep/i, 'shield'], [/mercenar|army|blade|sword|legion|band|host/i, 'swords'],
    [/tide|sea|ship|harbo|port|anchor|river|wave|fleet|pirate/i, 'anchor'], [/temple|church|faith|cult|priest|lore|librar|scholar|circle/i, 'book'],
    [/thie|shadow|lock|hand|whisper|knife/i, 'key'], [/explor|road|ranger|compass|wander/i, 'compass']];
  const GLYPH_SPARE = ['flag', 'shield', 'crown', 'compass'];

  // ---------- small helpers ----------
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeBack = t => { const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const now = () => performance.now();
  const isLight = () => document.documentElement.getAttribute('data-theme') === 'light';
  const themeKey = () => isLight() ? 'light' : 'dark';
  function hash(s) { let h = 2166136261; s = String(s || ''); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    if (attrs) for (const k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function icon(name, size, parent, cls) {
    const g = el('svg', { viewBox: '0 0 24 24', width: size, height: size, class: 'rg-ic' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' }, parent);
    g.innerHTML = ICON[name]; return g;
  }
  const SMALL = new Set(['the', 'of', 'and', 'a', 'an', 'de', 'la', 'von', 'van', 'du', 'del', 'el']);
  const TITLES = { sergeant: 'Sgt.', captain: 'Capt.', lieutenant: 'Lt.', commander: 'Cmdr.', doctor: 'Dr.', professor: 'Prof.', general: 'Gen.', colonel: 'Col.', major: 'Maj.' };
  const HONORIFIC = /^(sgt\.?|capt\.?|lt\.?|cmdr\.?|dr\.?|prof\.?|gen\.?|col\.?|maj\.?|sergeant|captain|lieutenant|commander|doctor|professor|general|colonel|major|lady|lord|sir|dame|mayor|baron|baroness|count|countess|duke|duchess|brother|sister|father|mother|master|mistress|king|queen|prince|princess|old|the|a|an)$/i;
  const words = name => String(name || '').replace(/[“”"'()\[\]]/g, '').split(/[\s\-_]+/).filter(Boolean);
  function initials(name) {
    const w = words(name), main = w.filter(x => !SMALL.has(x.toLowerCase())), use = main.length ? main : w;
    if (!use.length) return '?';
    return (use[0][0] + (use.length > 1 ? use[use.length - 1][0] : (use[0][1] || ''))).toUpperCase();
  }
  // the name a label shows: the page's short name if any, else the name without a quoted nickname, titles abbreviated
  function labelName(d) {
    if (d.short && String(d.short).trim()) return String(d.short).trim();
    let s = String(d.name || 'Unnamed').replace(/\s*["“][^"”]*["”]\s*/g, ' ').replace(/\s+/g, ' ').trim() || String(d.name || 'Unnamed');
    s = s.replace(/^(\w+)\b/, w => TITLES[w.toLowerCase()] || w);
    return s;
  }
  // a phone label: the first word that isn't a title, plus the next if both fit in 10 characters
  function phoneName(d) {
    const w = words(labelName(d)); let i = 0;
    while (i < w.length - 1 && HONORIFIC.test(w[i])) i++;
    let s = w[i] || '?';
    if (w[i + 1] && (s + ' ' + w[i + 1]).length <= 10 && !HONORIFIC.test(w[i + 1])) s += ' ' + w[i + 1];
    return s.length > 10 ? s.slice(0, 9) + '…' : s;
  }
  const MAXCH = 20;
  const shortName = s => {                 // ≤ 20 characters, cut at a word break when one is near
    s = String(s || 'Unnamed'); if (s.length <= MAXCH) return s;
    let cut = s.slice(0, MAXCH - 1); const sp = cut.lastIndexOf(' ');
    if (sp >= 12) cut = cut.slice(0, sp);
    return cut.replace(/[\s,.'"“-]+$/, '') + '…';
  };
  const measureCtx = document.createElement('canvas').getContext('2d');
  const widthCache = new Map();
  function textWidth(str, font, spacing) {
    const key = font + '|' + (spacing || 0) + '|' + str; let w = widthCache.get(key);
    if (w == null) { measureCtx.font = font; w = measureCtx.measureText(str).width + (spacing || 0) * str.length; if (widthCache.size > 5000) widthCache.clear(); widthCache.set(key, w); }
    return w;
  }
  // up to two lines no wider than maxW; the second ends in an ellipsis if the name still doesn't fit
  function wrap2(text, font, maxW) {
    if (textWidth(text, font) <= maxW) return [text];
    const w = text.split(' '); let l1 = w[0], i = 1;
    while (i < w.length && textWidth(l1 + ' ' + w[i], font) <= maxW) l1 += ' ' + w[i++];
    let l2 = w.slice(i).join(' ');
    if (!l2) return [l1];
    if (textWidth(l2, font) > maxW) { while (l2.length > 1 && textWidth(l2 + '…', font) > maxW) l2 = l2.slice(0, -1); l2 = l2.trimEnd() + '…'; }
    return [l1, l2];
  }
  function cssVar(node, name, fb) { const v = getComputedStyle(node).getPropertyValue(name).trim(); return v || fb; }
  // colour maths for readable tie labels (WCAG contrast)
  function rgb(hex) { hex = String(hex || '').replace('#', ''); if (hex.length === 3) hex = hex.replace(/./g, c => c + c); const n = parseInt(hex.slice(0, 6), 16); return Number.isFinite(n) ? [n >> 16 & 255, n >> 8 & 255, n & 255] : [128, 128, 128]; }
  const toHex = c => '#' + c.map(v => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('');
  function lum(c) { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(c[0]) + .7152 * f(c[1]) + .0722 * f(c[2]); }
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
  const readCache = new Map();
  function readable(hex, bgHex, min) {
    const key = hex + bgHex + min; if (readCache.has(key)) return readCache.get(key);
    const c = rgb(hex), bg = rgb(bgHex), toward = lum(bg) < .5 ? [255, 255, 255] : [0, 0, 0];
    let out = c;
    for (let t = 0; t <= 1.001 && contrast(out, bg) < (min || 4.5); t += .05) out = c.map((v, i) => lerp(v, toward[i], t));
    const res = toHex(out); readCache.set(key, res); return res;
  }
  // a caption's text colour: the faction hue lightened to L* ≥ 78 (dark) or darkened to L* ≤ 32 (light), and ≥ 4.5:1 on its pill
  function lstar(c) { const y = lum(c); return y > .008856 ? 116 * Math.cbrt(y) - 16 : 903.3 * y; }
  function capInk(hex, bgHex, light) {
    const c = rgb(hex), bg = rgb(bgHex), to = light ? [0, 0, 0] : [255, 255, 255];
    let out = c;
    for (let t = 0; t <= 1.001; t += .04) { out = c.map((v, i) => lerp(v, to[i], t)); const L = lstar(out); if ((light ? L <= 32 : L >= 78) && contrast(out, bg) >= 4.5) break; }
    return toHex(out);
  }
  // how a tie kind looks in the current theme (the page's kinds win; our palette fills any gap)
  function kindStyle(kind, kinds, light) {
    const k = (kinds && kinds[kind]) || {}, known = KIND_FALLBACK[kind], fb = known || SPARE[0].concat(['structural']);
    const tone = TONE[k.tone] ? k.tone : fb[2];
    const color = light ? (k.light || (known || !k.color ? fb[1] : k.color)) : (k.color || fb[0]);
    const label = k.label || (kind ? kind[0].toUpperCase() + kind.slice(1) : 'Link');
    const directed = k.directed != null ? !!k.directed : !!fb[3];
    const ov = KIND_W[kind];
    return { color, label, tone, w: ov ? ov[0] : TONE[tone].w, op: ov ? ov[1] : TONE[tone].op, layer: TONE[tone].layer, directed };
  }

  // ---------- geometry ----------
  function convexHull(pts) {               // Andrew's monotone chain
    if (pts.length < 3) return pts.slice();
    const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const lo = [], hi = [];
    for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
    for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (hi.length >= 2 && cross(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
    hi.pop(); lo.pop();
    return lo.concat(hi);
  }
  function chaikin(pts, passes) {           // corner cutting on a closed polygon
    let p = pts;
    for (let k = 0; k < passes; k++) {
      const out = [];
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        out.push([a[0] * .75 + b[0] * .25, a[1] * .75 + b[1] * .25], [a[0] * .25 + b[0] * .75, a[1] * .25 + b[1] * .75]);
      }
      p = out;
    }
    return p;
  }
  // a hull around circles: their rims inflated by `pad`, convex hull, then 2 Chaikin passes (corner radius ≥ pad)
  function blobPath(circles, pad) {
    const pts = [];
    for (const c of circles) { const r = c.r + pad; for (let i = 0; i < 20; i++) { const a = i / 20 * Math.PI * 2; pts.push([c.x + Math.cos(a) * r, c.y + Math.sin(a) * r]); } }
    const h = chaikin(convexHull(pts), 2);
    let d = '';
    for (let i = 0; i < h.length; i++) d += (i ? 'L' : 'M') + h[i][0].toFixed(1) + ',' + h[i][1].toFixed(1);
    return { d: d + 'Z', pts: h };
  }
  function curve(ax, ay, bx, by, bend) {    // a link's quadratic: bend is a signed fraction of the chord
    const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
    return { cx: mx - dy / len * bend * len, cy: my + dx / len * bend * len, len };
  }
  const qpt = (ax, ay, cx, cy, bx, by, t) => { const u = 1 - t; return [u * u * ax + 2 * u * t * cx + t * t * bx, u * u * ay + 2 * u * t * cy + t * t * by]; };
  const qtan = (ax, ay, cx, cy, bx, by, t) => { const u = 1 - t; return [2 * u * (cx - ax) + 2 * t * (bx - cx), 2 * u * (cy - ay) + 2 * t * (by - cy)]; };
  function tAtRadius(ax, ay, cx, cy, bx, by, r, fromEnd) {   // where the curve leaves a circle around its start (or end)
    let lo = 0, hi = .5; const ox = fromEnd ? bx : ax, oy = fromEnd ? by : ay;
    for (let i = 0; i < 14; i++) {
      const m = (lo + hi) / 2, t = fromEnd ? 1 - m : m, p = qpt(ax, ay, cx, cy, bx, by, t);
      if (Math.hypot(p[0] - ox, p[1] - oy) < r) lo = m; else hi = m;
    }
    return fromEnd ? 1 - hi : hi;
  }
  function qsub(ax, ay, cx, cy, bx, by, t0, t1) {           // the piece of a quadratic between t0 and t1
    const p0 = qpt(ax, ay, cx, cy, bx, by, t0), p2 = qpt(ax, ay, cx, cy, bx, by, t1);
    const d0 = qtan(ax, ay, cx, cy, bx, by, t0), s = (t1 - t0) / 2;
    return [p0[0], p0[1], p0[0] + d0[0] * s, p0[1] + d0[1] * s, p2[0], p2[1]];
  }
  // node outlines centred on cx,cy: discs for people, a soft hexagon for factions
  function shapeD(type, r, cx, cy) {
    cx = cx || 0; cy = cy || 0;
    if (type === 'faction') {
      const pts = []; for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; pts.push([cx + Math.cos(a) * r * 1.05, cy + Math.sin(a) * r * 1.05]); }
      let d = '';
      for (let i = 0; i < 6; i++) {
        const p = pts[i], q = pts[(i + 1) % 6], o = pts[(i + 5) % 6], k = .2;
        d += (i ? 'L' : 'M') + (p[0] + (o[0] - p[0]) * k).toFixed(3) + ',' + (p[1] + (o[1] - p[1]) * k).toFixed(3) + 'Q' + p[0].toFixed(3) + ',' + p[1].toFixed(3) + ' '
          + (p[0] + (q[0] - p[0]) * k).toFixed(3) + ',' + (p[1] + (q[1] - p[1]) * k).toFixed(3);
      }
      return d + 'Z';
    }
    return `M${cx - r},${cy}a${r},${r} 0 1,0 ${2 * r},0a${r},${r} 0 1,0 ${-2 * r},0Z`;
  }
  function rnd(seed) { let s = hash(seed) || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; }; }

  // ---------- legend swatches: the page drops these into its legend so it always matches the canvas ----------
  function swatch(type, key, kinds) {
    const light = isLight(), th = light ? 'light' : 'dark', ink = light ? '#1F2328' : '#E4E4E7', canvas = CANVAS[th];
    const svg = (w, h, body) => `<svg class="rg-swatch" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" focusable="false">${body}</svg>`;
    if (type === 'link') {
      const k = kindStyle(key, kinds, light), dir = k.directed;
      const end = dir ? 14 : 21, ar = dir ? `<path d="M22,6 L14,3 L14,9Z" fill="${k.color}" fill-opacity="${k.op}"/>` : '';
      return svg(22, 12, `<path d="M1,6 L${end},6" stroke="${k.color}" stroke-opacity="${k.op}" stroke-width="${k.w}" stroke-linecap="round" fill="none"/>${ar}`);
    }
    if (type === 'attitude') {
      const a = ATTITUDES[key] || ATTITUDES.unknown, c = light ? a.light : a.color, fill = NODE_FILL[th];
      const r = a.outer ? 4.9 : 6.4, w = Math.min(a.width, 2.6);
      const outer = a.outer ? `<circle cx="9" cy="9" r="${r + w / 2 + 2.2}" fill="none" stroke="${c}" stroke-width="1"/>` : '';
      return svg(18, 18, `${outer}<circle cx="9" cy="9" r="${r}" fill="${fill}" stroke="${c}" stroke-width="${w}"${a.dash ? ' stroke-dasharray="2.4 2.4"' : ''}/>`);
    }
    if (type === 'mark') {
      const fill = NODE_FILL[th], line = light ? '#A1A1AA' : '#71717A', dm = light ? '#7C3AED' : '#A78BFA';
      if (key === 'hidden') return svg(18, 18, `<circle cx="9" cy="9" r="7" fill="${canvas}" stroke="#8B5CF6" stroke-width="1"/><g transform="translate(4.5,4.5) scale(.375)" fill="none" stroke="${dm}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${ICON.eyeoff}</g>`);
      if (key === 'missing') return svg(18, 18, `<circle cx="9" cy="9" r="7" fill="${canvas}" stroke="${line}" stroke-width="1"/><text x="9" y="12.4" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="10" font-weight="700" fill="${ink}">?</text>`);
      if (key === 'dead') return svg(18, 18, `<g opacity=".45"><circle cx="9" cy="9" r="6.5" fill="${fill}" stroke="${line}" stroke-width="1.5"/></g><path d="M3.5,14.5 L14.5,3.5" stroke="${ink}" stroke-width="1"/>`);
      if (key === 'secret') return svg(18, 18, `<path d="M0,9 L18,9" stroke="${ink}" stroke-opacity=".8" stroke-width="2" stroke-dasharray="4 3"/>`);
      if (key === 'ended') return svg(18, 18, `<path d="M0,9 L18,9" stroke="${ink}" stroke-opacity=".35" stroke-width="2"/>`);
    }
    return svg(18, 18, '');
  }

  // ---------- styles (injected once) ----------
  const attCSS = th => Object.entries(ATTITUDES).map(([k, a]) => `--rg-a-${k}: ${th === 'light' ? a.light : a.color};`).join(' ');
  const attRules = () => Object.entries(ATTITUDES).map(([k, a]) =>
    `.rg-node.rg-a-${k} { --rg-ring: var(--rg-a-${k}); --rg-rw: ${a.width}; }` + (a.outer ? ` .rg-node.rg-a-${k} .rg-ring2 { opacity: .9; }` : '') +
    (a.dash ? ` .rg-node.rg-a-${k} .rg-ring { stroke-dasharray: ${a.dash}; }` : '')).join('\n');
  const CSS = `
.rg-root { position: relative; width: 100%; height: 100%; min-height: 240px; overflow: hidden; outline: none; touch-action: none;
  user-select: none; -webkit-user-select: none; -webkit-tap-highlight-color: transparent; contain: strict;
  --rg-canvas: ${CANVAS.dark}; --rg-node: ${NODE_FILL.dark}; --rg-hair: transparent; --rg-ink: #E4E4E7; --rg-ink-muted: #A1A1AA; --rg-chip-ink: #E4E4E7;
  --rg-pc: ${PC.dark.ring}; --rg-pc-fill: ${PC.dark.fill}; --rg-pc-ink: ${PC.dark.ink}; --rg-dot: rgba(255,255,255,.035); --rg-sel: #FFFFFF; --rg-find: #60A5FA;
  --rg-dm: #8B5CF6; --rg-dm-ink: #A78BFA; --rg-mono: #EDEDED; --rg-ghost: rgba(255,255,255,.06); --rg-hull: rgba(255,255,255,.045); --rg-hull-line: rgba(255,255,255,.16); --rg-pill: rgba(17,17,19,.92); --rg-cap-bg: rgba(17,17,20,.92); --rg-shade: rgba(0,0,0,.45);
  ${attCSS('dark')}
  background: var(--rg-canvas); color: var(--rg-ink); }
:root[data-theme="light"] .rg-root {
  --rg-canvas: ${CANVAS.light}; --rg-node: ${NODE_FILL.light}; --rg-hair: #E4E0D6; --rg-ink: #1F2328; --rg-ink-muted: #52525B; --rg-chip-ink: #27272A;
  --rg-pc: ${PC.light.ring}; --rg-pc-fill: ${PC.light.fill}; --rg-pc-ink: ${PC.light.ink}; --rg-dot: rgba(0,0,0,.035); --rg-sel: #18181B; --rg-find: #2563EB;
  --rg-dm-ink: #7C3AED; --rg-mono: #1C1C1C; --rg-ghost: rgba(0,0,0,.06); --rg-hull: rgba(20,24,32,.045); --rg-hull-line: rgba(20,24,32,.14); --rg-pill: rgba(244,242,236,.92); --rg-cap-bg: rgba(255,255,255,.92); --rg-shade: rgba(60,45,20,.12);
  ${attCSS('light')} }
.rg-root:focus-visible { box-shadow: inset 0 0 0 2px var(--accent); }
.rg-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; cursor: grab; overflow: visible; }
.rg-root.rg-panning .rg-svg { cursor: grabbing; }
.rg-root.rg-dragging .rg-svg, .rg-root.rg-dragging .rg-node { cursor: grabbing; }
.rg-grid { fill: var(--rg-dot); }
.rg-ic { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.rg-node, .rg-link, .rg-hull, .rg-lbl, .rg-elbl, .rg-hcap, .rg-loose { transition: opacity .24s cubic-bezier(.2,.7,.2,1); }
/* ---- faction territories: neutral (the hue is only the caption's dot and the hexagon); captions are one pill style ---- */
.rg-hull path { fill: var(--rg-hull); stroke: var(--rg-hull-line); stroke-width: 1px; vector-effect: non-scaling-stroke; stroke-linejoin: round; }
.rg-hull.rg-hot path { stroke-width: 1.5px; }
.rg-hull.rg-dim { opacity: 0; }
.rg-hull.rg-out { opacity: .15; }
.rg-hcap { pointer-events: none; opacity: 0; }
.rg-hcap.rg-on { opacity: 1; }
.rg-hcap rect { fill: var(--rg-cap-bg); stroke: var(--rg-hull-line); stroke-width: 1px; }
.rg-hcap circle { fill: var(--rg-c); }
.rg-hcap text { font: 700 11px/1 var(--sans, sans-serif); letter-spacing: .08em; text-transform: uppercase; fill: var(--rg-ink); dominant-baseline: central; text-anchor: middle; }
.rg-hcap.rg-on.rg-dim { opacity: 0; } .rg-hcap.rg-on.rg-out { opacity: .15; }
.rg-party :is(.rg-hull, .rg-hcap), .rg-ego :is(.rg-hull, .rg-hcap) { opacity: 0 !important; }
.rg-loose { font: 600 11px/1 var(--sans, sans-serif); letter-spacing: .04em; fill: var(--rg-ink-muted);
  paint-order: stroke; stroke: var(--rg-canvas); stroke-width: 3px; pointer-events: none; }
/* ---- party orbit guides ---- */
.rg-orbit circle { fill: none; stroke: var(--rg-ink); stroke-opacity: .13; stroke-width: 1px; vector-effect: non-scaling-stroke; stroke-dasharray: 1 6; stroke-linecap: round; }
.rg-orbit circle.rg-orb-hostile { stroke: var(--rg-a-hostile); stroke-opacity: .3; }
.rg-orbit circle.rg-orb-ally { stroke: var(--rg-a-ally); stroke-opacity: .3; }
.rg-orbit circle.rg-orb-pc { stroke: var(--rg-pc); stroke-opacity: .32; stroke-dasharray: none; }
.rg-orbit .rg-orb-core { fill: var(--rg-pc); fill-opacity: .045; stroke: none; }
.rg-olbl { font: 700 10px/1 var(--sans, sans-serif); letter-spacing: .08em; text-transform: uppercase; fill: var(--rg-ink-muted); text-anchor: middle;
  paint-order: stroke; stroke: var(--rg-canvas); stroke-width: 3px; pointer-events: none; }
/* ---- ties: colour = valence, width = tone; secret 4/3 dashes, ended 35% ---- */
.rg-link path.rg-e { fill: none; stroke: var(--rg-c); stroke-opacity: var(--rg-op, 1); stroke-width: var(--rg-w, 2px); vector-effect: non-scaling-stroke;
  stroke-linecap: round; transition: stroke-width .18s, stroke-opacity .18s; }
.rg-link path.rg-hit { fill: none; stroke: transparent; stroke-width: 14px; vector-effect: non-scaling-stroke; cursor: pointer; pointer-events: stroke; }
.rg-link path.rg-arrow { fill: var(--rg-c); fill-opacity: var(--rg-op, 1); stroke: none; }
.rg-link.rg-secret path.rg-e { stroke-dasharray: 4 3; stroke-linecap: butt; }
.rg-link.rg-ended { --rg-op: .35 !important; }
.rg-link:is(.rg-hov, .rg-nb) path.rg-e { stroke-opacity: 1; stroke-width: calc(var(--rg-w, 2px) + .5px); }
.rg-link.rg-ended:is(.rg-hov, .rg-nb) path.rg-e { stroke-opacity: .6; }
.rg-link.rg-lsel path.rg-e { stroke-opacity: 1; stroke-width: calc(var(--rg-w, 2px) + 1.5px); }
.rg-link.rg-dim { opacity: .05; } .rg-link.rg-hdim { opacity: .2; } .rg-link.rg-out { opacity: .05; }
.rg-link.rg-mhide { opacity: 0; pointer-events: none; }
/* ---- nodes ---- */
.rg-node { cursor: pointer; outline: none; }
.rg-node .rg-shadow { fill: var(--rg-shade); opacity: .5; }
.rg-node .rg-disc { fill: var(--rg-node); }
.rg-node .rg-tint { fill: none; }
.rg-node.rg-t-pc .rg-tint { fill: var(--rg-pc-fill); }
.rg-node.rg-t-faction .rg-tint { fill: var(--rg-fc); fill-opacity: .16; }
.rg-node .rg-hitarea { fill: transparent; stroke: none; }
.rg-node .rg-mono { font: 650 14px/1 var(--sans, sans-serif); letter-spacing: .01em; text-anchor: middle; dominant-baseline: central;
  fill: var(--rg-mono); pointer-events: none; }
.rg-node .rg-pglyph { color: var(--rg-ink-muted); opacity: .55; }
.rg-node.rg-t-pc .rg-pglyph { color: var(--rg-pc-ink); opacity: .8; }
.rg-node .rg-fglyph { color: var(--rg-fc); }
.rg-node image { opacity: 0; transition: opacity .35s ease; }
.rg-node image.rg-in { opacity: 1; }
.rg-node .rg-hair { fill: none; stroke: var(--rg-hair); stroke-width: 1; }
.rg-node .rg-gap { fill: none; stroke: var(--rg-canvas); stroke-width: 1; }
.rg-node .rg-ring { fill: none; stroke: var(--rg-ring, var(--rg-a-unknown)); stroke-width: var(--rg-rw, 2); }
.rg-node .rg-ring2 { fill: none; stroke: var(--rg-ring); stroke-width: 1; opacity: 0; }
.rg-node .rg-glow { fill: none; stroke: var(--rg-ring); stroke-width: 4; opacity: 0; }
${attRules()}
.rg-node.rg-t-pc { --rg-ring: var(--rg-pc); --rg-rw: 2.5; }
.rg-node.rg-t-faction { --rg-ring: var(--rg-fc); --rg-rw: 1.5; }
.rg-node.rg-t-faction.rg-unrevealed .rg-ring { stroke-dasharray: 4 3; }
.rg-node.rg-s-dead .rg-body { opacity: .45; }
.rg-node .rg-strike { stroke: var(--rg-ink); stroke-width: 1.5px; vector-effect: non-scaling-stroke; display: none; }
.rg-node.rg-s-dead .rg-strike { display: inline; }
.rg-node .rg-badge circle { fill: var(--rg-canvas); stroke: var(--rg-ink-muted); stroke-width: 1; }
.rg-node .rg-badge.rg-b-hidden circle { stroke: var(--rg-dm); }
.rg-node .rg-badge .rg-ic { color: var(--rg-dm-ink); stroke-width: 2.6; }
.rg-node .rg-badge text { font: 700 9.5px/1 var(--sans, sans-serif); fill: var(--rg-ink); text-anchor: middle; dominant-baseline: central; }
.rg-node .rg-badge.rg-extra { display: none; }
.rg-node:is(.rg-hovered, .rg-selected, :focus-visible) .rg-badge.rg-extra { display: inline; }
.rg-node .rg-sel { fill: none; stroke: var(--rg-sel); stroke-width: 2px; vector-effect: non-scaling-stroke; opacity: 0;
  transform-box: fill-box; transform-origin: center; transition: opacity .2s; }
.rg-node.rg-selected .rg-sel { opacity: 1; animation: rg-selpulse .6s cubic-bezier(.2,.7,.3,1) 1; }
.rg-node.rg-selected .rg-glow { opacity: .22; stroke: var(--rg-sel); stroke-width: 10; }
.rg-node:focus-visible:not(.rg-selected) .rg-sel { opacity: .8; stroke-dasharray: 3 3; }
@keyframes rg-selpulse { 0% { transform: scale(1); } 45% { transform: scale(1.06); } 100% { transform: scale(1); } }
.rg-node .rg-findring { fill: none; stroke: var(--rg-find); stroke-width: 2px; vector-effect: non-scaling-stroke; opacity: 0;
  transform-box: fill-box; transform-origin: center; }
.rg-node.rg-hit .rg-findring { opacity: .95; animation: rg-pulse 1.5s cubic-bezier(.2,.7,.3,1) 3; }
@keyframes rg-pulse { 0% { transform: scale(1); opacity: .95; } 70% { transform: scale(1.4); opacity: 0; } 71% { transform: scale(1); opacity: 0; } 100% { transform: scale(1); opacity: .95; } }
/* focus: everyone else becomes a flat ghost disc at 10% (no ring, face, mark or name) */
.rg-node.rg-dim { opacity: .1; }
.rg-node.rg-dim :is(.rg-ring, .rg-ring2, .rg-glow, image, .rg-mono, .rg-pglyph, .rg-fglyph, .rg-badge, .rg-strike, .rg-shadow, .rg-hair, .rg-gap, .rg-tint) { display: none; }
.rg-node.rg-dim .rg-disc { fill: var(--rg-ghost); }
.rg-node.rg-dim .rg-body { opacity: 1; filter: none; }
.rg-ego .rg-node.rg-dim { opacity: .03; } .rg-ego .rg-link.rg-dim { opacity: .02; }
.rg-node.rg-hdim { opacity: .35; }
.rg-node.rg-out { opacity: .1; filter: var(--rg-grayf); }
/* ---- overlay text: one sans; the knockout halo is the canvas colour ---- */
.rg-lbl { font: 600 12px/1 var(--sans, sans-serif); fill: var(--rg-ink); paint-order: stroke; stroke: var(--rg-canvas);
  stroke-width: 3px; stroke-linejoin: round; opacity: 0; pointer-events: none; }
.rg-lbl.rg-pc { fill: var(--rg-pc-ink); }
.rg-lbl.rg-focus { font-size: 13px; font-weight: 700; }
.rg-lbl.rg-faded { fill: var(--rg-ink-muted); font-style: italic; }
.rg-lbl.rg-on { opacity: 1; }
.rg-elbl { opacity: 0; pointer-events: none; }
.rg-elbl.rg-on { opacity: 1; }
.rg-elbl rect { fill: var(--rg-pill); }
.rg-elbl text { font: 500 11px/1 var(--sans, sans-serif); fill: var(--rg-tc, var(--rg-chip-ink)); dominant-baseline: central; }
.rg-elbl .rg-ic { color: var(--rg-dm-ink); stroke-width: 2.4; }
.rg-elbl .rg-lead { stroke: var(--rg-c); stroke-opacity: .6; stroke-width: 1px; }
.rg-handle { cursor: crosshair; opacity: 0; transition: opacity .15s; }
.rg-handle.rg-on { opacity: 1; }
.rg-handle circle { fill: var(--rg-ink); stroke: var(--rg-canvas); stroke-width: 2px; }
.rg-handle .rg-ic { color: var(--rg-canvas); stroke-width: 3; }
.rg-band { fill: none; stroke: var(--rg-ink); stroke-opacity: .7; stroke-width: 1.5px; stroke-dasharray: 6 5; stroke-linecap: round; pointer-events: none; }
.rg-band-dot { fill: var(--rg-ink); pointer-events: none; }
/* ---- built-in chrome (pages can switch it off): legend + zoom ---- */
.rg-legend { position: absolute; left: 12px; bottom: 12px; max-width: min(232px, 46%); padding: 10px 12px 9px; border-radius: 10px;
  background: color-mix(in srgb, var(--raised, #242428) 92%, transparent); border: 1px solid var(--line); box-shadow: var(--shadow-2);
  -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); font: 500 12px/1.2 var(--sans, sans-serif); color: var(--fg-2, var(--fg)); }
.rg-legend h4 { margin: 0 0 8px; }
.rg-legend h4 button { all: unset; display: flex; align-items: center; gap: 6px; cursor: pointer; font: 600 10px/1 var(--sans, sans-serif);
  letter-spacing: .12em; text-transform: uppercase; color: var(--muted); border-radius: 4px; }
.rg-legend h4 button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.rg-legend h4 .rg-ic { width: 12px; height: 12px; transform: rotate(180deg); }
.rg-legend.rg-collapsed { padding: 8px 10px; } .rg-legend.rg-collapsed h4 { margin: 0; } .rg-legend.rg-collapsed h4 .rg-ic { transform: none; }
.rg-legend.rg-collapsed ul { display: none; }
.rg-legend ul { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: 1fr 1fr; gap: 5px 14px; }
.rg-legend li { display: flex; align-items: center; gap: 7px; white-space: nowrap; min-width: 0; }
.rg-legend li span { overflow: hidden; text-overflow: ellipsis; }
.rg-legend .rg-lsep { grid-column: 1 / -1; height: 1px; background: var(--line); margin: 2px 0; }
.rg-legend.rg-hide { display: none; }
.rg-ctl { position: absolute; right: 12px; bottom: 12px; display: flex; flex-direction: column; border-radius: 10px; overflow: hidden;
  background: color-mix(in srgb, var(--raised, #242428) 92%, transparent); border: 1px solid var(--line); box-shadow: var(--shadow-2); }
.rg-ctl button { width: 34px; height: 34px; display: grid; place-items: center; border: 0; margin: 0; padding: 0; background: none;
  color: var(--fg-2, var(--fg)); cursor: pointer; }
.rg-ctl button + button { border-top: 1px solid var(--line); }
.rg-ctl button:hover { background: var(--tint-2, rgba(255,255,255,.07)); color: var(--fg); }
.rg-ctl button:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.rg-ctl .rg-ic { width: 16px; height: 16px; }
@media (pointer: coarse) { .rg-ctl button { width: 44px; height: 44px; } }
@media (prefers-reduced-motion: reduce) { .rg-root * { transition: none !important; animation: none !important; } }
`;
  function injectCSS() {
    let s = document.getElementById('relgraph-css');
    if (!s) { s = document.createElement('style'); s.id = 'relgraph-css'; document.head.appendChild(s); }
    if (s.textContent !== CSS) s.textContent = CSS;
  }

  let mounts = 0;
  const COARSE = !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);

  // =====================================================================================
  function mount(container, opts) {
    injectCSS();
    opts = opts || {};
    const uid = 'rg' + (++mounts);
    const call = (name, ...a) => { const f = opts[name]; if (typeof f === 'function') { try { f(...a); } catch (e) { console.error(e); } } };

    // ---------- DOM ----------
    const root = document.createElement('div');
    root.className = 'rg-root'; root.tabIndex = 0;
    root.setAttribute('role', 'application'); root.setAttribute('aria-label', 'Relationship map. Drag to pan, scroll to zoom, Tab to move between people.');
    root.style.setProperty('--rg-grayf', `url(#${uid}-gray)`);
    container.appendChild(root);
    const svg = el('svg', { class: 'rg-svg' }, root);
    const defs = el('defs', null, svg);
    defs.innerHTML = `
      <clipPath id="${uid}-clip-disc" clipPathUnits="objectBoundingBox"><circle cx=".5" cy=".5" r=".5"/></clipPath>
      <clipPath id="${uid}-clip-faction" clipPathUnits="objectBoundingBox"><path d="${shapeD('faction', .5, .5, .5)}"/></clipPath>
      <filter id="${uid}-blur3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="2.4"/></filter>
      <filter id="${uid}-gray" color-interpolation-filters="sRGB"><feColorMatrix type="saturate" values="0"/></filter>
      <pattern id="${uid}-grid" width="24" height="24" patternUnits="userSpaceOnUse"><circle class="rg-grid" cx="12" cy="12" r="1"/></pattern>`;
    const grid = defs.querySelector('pattern');
    el('rect', { x: 0, y: 0, width: '100%', height: '100%', fill: `url(#${uid}-grid)` }, svg);
    const view = el('g', { class: 'rg-view' }, svg);
    const gOrbit = el('g', { class: 'rg-orbit' }, view), gHull = el('g', null, view);
    const gLinkL = [el('g', null, view), el('g', null, view), el('g', null, view)];   // structural, warm, hostile (on top)
    const gNode = el('g', null, view);
    const over = el('g', { class: 'rg-over' }, svg);
    const gTitle = el('g', null, over), gOrbitLbl = el('g', null, over), gELbl = el('g', null, over), gLbl = el('g', null, over);
    const looseLbl = el('text', { class: 'rg-loose', 'text-anchor': 'start' }, over); looseLbl.textContent = 'Loose ends'; looseLbl.style.display = 'none';
    const band = el('path', { class: 'rg-band', d: '' }, over), bandDot = el('circle', { class: 'rg-band-dot', r: 0 }, over);
    const handle = el('g', { class: 'rg-handle' }, over);
    el('circle', { r: 9 }, handle); const hic = icon('plus', 12, handle); hic.setAttribute('x', -6); hic.setAttribute('y', -6);
    handle.style.display = opts.onConnect ? '' : 'none';
    const css = id => `url(#${uid}-${id})`;

    let legend = null, ctl = null;
    if (opts.legend !== false) { legend = document.createElement('div'); legend.className = 'rg-legend rg-hide'; root.appendChild(legend); }
    if (opts.controls !== false) {
      ctl = document.createElement('div'); ctl.className = 'rg-ctl';
      for (const [k, label] of [['plus', 'Zoom in'], ['minus', 'Zoom out'], ['fit', 'Fit to screen']]) {
        const b = document.createElement('button'); b.type = 'button'; b.title = label; b.setAttribute('aria-label', label); b.dataset.act = k;
        icon(k, 16, b); ctl.appendChild(b);
      }
      root.appendChild(ctl);
    }

    // ---------- state ----------
    const nodes = new Map(), links = new Map(), hulls = new Map();
    let kinds = {}, mode = 'web', th = themeKey();
    let W = 0, H = 0, compact = false, portrait = false;
    const ins = { top: 20, right: 20, bottom: 20, left: 20 };
    const cam = { x: 0, y: 0, k: 1 };
    let camAnim = null, tween = null, dispAnim = null, raf = 0, destroyed = false;
    let selId = null, selLinkId = null, hoverId = null, hoverLinkId = null, hlLinkId = null, legendKind = null;
    let flt = { kinds: null, types: null, query: '', hideEnded: false };
    let pointerInside = false, orbitBase = 150, pcRing = 70, orderSeq = 0, looseAt = null;

    const KS = kind => kindStyle(kind, kinds, th === 'light');
    const typeOf = d => (d.type === 'pc' || d.type === 'faction' || d.type === 'other') ? d.type : 'npc';
    const isPerson = n => n.type === 'npc' || n.type === 'other';
    // hubs read first: radius 16px plus 2px per tie, up to 28px at six ties; faction hexes a fixed 26px
    const radiusOf = n => n.type === 'faction' ? R.faction : R.npcMin + 2 * Math.min(6, n.deg || 0);
    const X = n => n.x + (n.dx || 0), Y = n => n.y + (n.dy || 0);       // where a node is drawn (focus spreading included)
    // the safe area: the container minus the page's insets (insets that would leave too little room are scaled back)
    const safe = () => {
      let t = ins.top, r = ins.right, b = ins.bottom, l = ins.left;
      const minW = Math.min(W, Math.max(120, W * .35)), minH = Math.min(H, Math.max(120, H * .3));
      if (W - l - r < minW) { const f = Math.max(0, W - minW) / ((l + r) || 1); l *= f; r *= f; }
      if (H - t - b < minH) { const f = Math.max(0, H - minH) / ((t + b) || 1); t *= f; b *= f; }
      return { l, t, r: W - r, b: H - b };
    };
    let sansCache = null, dispCache = null;
    const fontSans = () => sansCache || (sansCache = cssVar(root, '--sans', 'Inter, sans-serif'));
    const fontDisplay = () => dispCache || (dispCache = cssVar(root, '--display', 'Georgia, serif'));

    // ---------- node elements ----------
    function buildNode(n) {
      const g = el('g', { class: 'rg-node', 'data-id': n.id, tabindex: 0, role: 'button' });
      n.el = g; n.bloomEl = el('g', { class: 'rg-bloom' }, g);
      n.lbl = el('text', { class: 'rg-lbl', 'text-anchor': 'middle' }, gLbl);
      gNode.appendChild(g);
      drawNode(n, true);
    }
    function drawNode(n, fresh) {
      const d = n.d, shape = n.type === 'faction' ? 'faction' : 'disc', r = n.r, b = n.bloomEl;
      const sig = [n.type, r.toFixed(2), d.name, d.img || '', d.status, d.revealed, d.attitude, n.mono, n.glyph].join('|');
      if (!fresh && sig === n.sig) { classNode(n); return; }
      n.sig = sig; b.textContent = '';
      const S = rr => shapeD(shape, rr);
      const att = isPerson(n) ? (ATTITUDES[d.attitude] ? d.attitude : 'unknown') : '', a = att && ATTITUDES[att];
      const rw = n.type === 'pc' ? 2.5 : n.type === 'faction' ? 1.5 : a.width;
      n.ringOut = r + rw / 2;                                        // one ring per node: attitude (people), amber (PCs), hue (factions)
      el('path', { class: 'rg-shadow', d: shapeD(shape, r, 0, 1.4), filter: css('blur3') }, b);
      el('path', { class: 'rg-glow', d: S(n.ringOut + 5), filter: css('blur3') }, b);
      el('path', { class: 'rg-findring', d: S(n.ringOut + 3) }, b);
      el('path', { class: 'rg-sel', d: S(n.ringOut + 5) }, b);
      n.hitEl = el('circle', { class: 'rg-hitarea', r }, b);
      const body = el('g', { class: 'rg-body' }, b);
      if (d.status === 'dead') body.setAttribute('filter', css('gray'));
      el('path', { class: 'rg-disc', d: S(r) }, body);
      el('path', { class: 'rg-tint', d: S(r) }, body);
      const src = d.img ? String(d.img) : '';
      if (n.type === 'faction') { const gi = icon(n.glyph || 'flag', 14, body, 'rg-fglyph'); gi.setAttribute('x', -7); gi.setAttribute('y', -7); }
      else {
        if (n.mono && n.mono !== '?') { const m = el('text', { class: 'rg-mono', y: .5 }, body); m.textContent = n.mono; }
        else if (!src) { const gs = Math.round(r * .78), gi = icon('user', gs, body, 'rg-pglyph'); gi.setAttribute('x', -gs / 2); gi.setAttribute('y', -gs / 2); }
      }
      n.imgEl = null;
      if (src) { const im = el('image', { x: -r, y: -r, width: 2 * r, height: 2 * r, preserveAspectRatio: 'xMidYMid slice', 'clip-path': css('clip-' + shape) }, body); n.imgEl = im; loadImage(n, src, im); }
      if (src && n.type === 'pc') el('path', { class: 'rg-gap', d: S(r - rw / 2 - .5) }, body);   // portrait: a 1px canvas gap inside the ring
      else el('path', { class: 'rg-hair', d: S(r - rw / 2 - .5) }, body);
      el('path', { class: 'rg-ring', d: S(r) }, body);
      el('path', { class: 'rg-strike', d: `M${(-r * .82).toFixed(1)},${(r * .82).toFixed(1)}L${(r * .82).toFixed(1)},${(-r * .82).toFixed(1)}` }, b);
      // status marks: at most one at overview (dead, then hidden, then missing); the rest on hover and focus
      const marks = [];
      if (d.revealed === false && n.type !== 'faction') marks.push('hidden');
      if (d.status === 'missing') marks.push('missing');
      const spots = [[.71, -.71], [.71, .71], [-.71, -.71]];
      n.badges = [];
      marks.forEach((m, i) => {
        const extra = d.status === 'dead' || i > 0, at = spots[i] || spots[0];
        const g = el('g', { class: 'rg-badge rg-b-' + m + (extra ? ' rg-extra' : ''), transform: `translate(${(n.ringOut * at[0]).toFixed(1)},${(n.ringOut * at[1]).toFixed(1)})` }, b);
        const inner = el('g', null, g);
        el('circle', { r: 7 }, inner);
        if (m === 'hidden') { const i2 = icon('eyeoff', 9, inner); i2.setAttribute('x', -4.5); i2.setAttribute('y', -4.5); }
        else { const t = el('text', { y: .5 }, inner); t.textContent = '?'; }
        n.badges.push(inner);
      });
      ariaNode(n);
      classNode(n);
    }
    function ariaNode(n) {
      const d = n.d, bits = [d.name || 'Unnamed'];
      if (n.type === 'pc') bits.push('player character'); else if (n.type === 'faction') bits.push('faction');
      if (d.attitude && isPerson(n)) bits.push(d.attitude === 'ally' ? 'loyal' : d.attitude);
      if (d.status && d.status !== 'alive') bits.push(d.status);
      if (d.revealed === false) bits.push('hidden from the players');
      n.el.setAttribute('aria-label', bits.join(', '));
    }
    function classNode(n) {
      const d = n.d, att = isPerson(n) ? (ATTITUDES[d.attitude] ? d.attitude : 'unknown') : '';
      let c = `rg-node rg-t-${n.type}`;
      if (att) c += ` rg-a-${att}`;
      if (d.status && d.status !== 'alive') c += ` rg-s-${d.status}`;
      if (d.revealed === false) c += ' rg-unrevealed';
      n.baseClass = c;
      if (n.hullColor) n.el.style.setProperty('--rg-fc', n.hullColor); else n.el.style.removeProperty('--rg-fc');
      n.stateClass = null;
    }
    // images: media/… paths are private and resolve through media(); anything else loads directly.
    // The <image> stays transparent until the picture has decoded, so a bad URL leaves the monogram showing.
    function loadImage(n, src, im) {
      const token = n.imgToken = {};
      const show = url => {
        const probe = new Image();
        probe.onload = () => { if (n.imgToken !== token || destroyed) return; im.setAttribute('href', url); requestAnimationFrame(() => im.classList.add('rg-in')); };
        probe.onerror = () => { if (n.imgToken === token && im.parentNode) im.remove(); };
        probe.src = url;
      };
      if (/^media\//.test(src)) {
        if (typeof media === 'function') { try { Promise.resolve(media(src)).then(show, () => { if (im.parentNode) im.remove(); }); } catch (_) { im.remove(); } }
        else im.remove();
      } else if (/^(https?:|data:|blob:|\/|\.{0,2}\/?[\w-]+\/)/.test(src)) show(src);
      else im.remove();
    }

    // ---------- tie elements ----------
    function buildLink(l) {
      l.el = el('g', { class: 'rg-link', 'data-lid': l.id });
      l.hit = el('path', { class: 'rg-hit' }, l.el);
      l.path = el('path', { class: 'rg-e' }, l.el);
      l.arrow = el('path', { class: 'rg-arrow' }, l.el);
      l.elbl = el('g', { class: 'rg-elbl' }, gELbl);
      l.pillG = el('g', null, l.elbl);
      l.pill = el('rect', { rx: 4, ry: 4, height: 15, y: -7.5 }, l.pillG);
      l.eic = icon('eyeoff', 10, l.pillG); l.eic.setAttribute('y', -5);
      l.txt = el('text', null, l.pillG);
      styleLink(l);
    }
    function styleLink(l) {
      const d = l.d, k = KS(d.kind);
      l.ks = k; l.color = k.color;
      const layer = gLinkL[k.layer]; if (l.el.parentNode !== layer) layer.appendChild(l.el);
      for (const e of [l.el, l.elbl]) e.style.setProperty('--rg-c', k.color);
      l.el.style.setProperty('--rg-w', k.w + 'px'); l.el.style.setProperty('--rg-op', String(k.op));
      // chip text: the tie's colour mixed 65% with white (dark) or black (light)
      const to = th === 'light' ? 0 : 255; l.elbl.style.setProperty('--rg-tc', toHex(rgb(k.color).map(v => v * .35 + to * .65)));
      const own = d.label && String(d.label).trim();
      let text = own ? `${k.label} · ${own}` : k.label; if (text.length > 30) text = text.slice(0, 29).trimEnd() + '…';
      l.base = text; l.short = k.label; l.dirArrow = d.dir === 'ab';
      l.baseClass = 'rg-link' + (d.secret ? ' rg-secret' : '') + (d.ended ? ' rg-ended' : '');
      const dirTxt = d.dir === 'ab' ? ' → ' : ' – ';
      let t = l.hit.firstChild; if (!t) t = el('title', null, l.hit);
      t.textContent = `${l.a.d.name}${dirTxt}${l.b.d.name}: ${own ? k.label + ' (' + own + ')' : k.label}${d.ended ? ', ended' : ''}${d.secret ? ', secret' : ''}`;
      setChipText(l, text);
      l.stateClass = null;
    }
    // the chip reads "Serves" or "Family · sisters"; direction is the arrowhead's job alone
    function setChipText(l, text) {
      if (l.chipText === text) return;
      l.chipText = text; l.txt.textContent = text;
      const lead = l.d.secret ? 15 : 0, tw = textWidth(text, '500 11px ' + fontSans());
      l.pillW = Math.ceil(tw + 12 + lead); l.pillH = 15;
      l.pill.setAttribute('x', -l.pillW / 2); l.pill.setAttribute('width', l.pillW); l.pill.setAttribute('height', l.pillH); l.pill.setAttribute('y', -l.pillH / 2);
      l.eic.setAttribute('x', -l.pillW / 2 + 5); l.eic.style.display = l.d.secret ? '' : 'none';
      l.txt.setAttribute('x', -l.pillW / 2 + 6 + lead);
    }

    // ---------- data in ----------
    // returns the ids of nodes that are new and have no saved position (the ones the layout must place)
    function ingest(data, animate) {
      if (data.kinds) kinds = data.kinds;
      const seen = new Set(), fresh = [], unplaced = new Set();
      for (const d of (data.nodes || [])) {
        if (!d || d.id == null) continue;
        const id = String(d.id); if (seen.has(id)) continue; seen.add(id);
        let n = nodes.get(id);
        const hasPos = d.x != null && d.y != null && d.x !== '' && d.y !== '' && Number.isFinite(+d.x) && Number.isFinite(+d.y);
        if (!n) {
          n = { id, d, type: typeOf(d), x: hasPos ? +d.x : 0, y: hasPos ? +d.y : 0, dx: 0, dy: 0, vx: 0, vy: 0, pinned: !!d.pinned, deg: 0, r: R.npcMin, order: orderSeq++, isNew: true };
          nodes.set(id, n); fresh.push(n);
          if (!hasPos) unplaced.add(id);
        } else {
          n.d = d; n.type = typeOf(d); n.pinned = !!d.pinned; n.isNew = false;
          if (hasPos && n.pinned && (Math.abs(+d.x - n.x) > .5 || Math.abs(+d.y - n.y) > .5) && !(drag && drag.n === n)) { n.x = +d.x; n.y = +d.y; }
        }
      }
      for (const [id, n] of nodes) if (!seen.has(id)) removeNode(n);
      const lseen = new Set();
      for (const d of (data.links || [])) {
        if (!d) continue;
        const a = nodes.get(String(d.a)), b = nodes.get(String(d.b));
        if (!a || !b || a === b) continue;
        const id = String(d.id != null ? d.id : d.a + '>' + d.b + ':' + d.kind);
        if (lseen.has(id)) continue; lseen.add(id);
        let l = links.get(id);
        if (!l) {
          l = { id, d, a, b }; links.set(id, l); buildLink(l);
          if (animate && !REDUCED) { l.el.style.opacity = '0'; requestAnimationFrame(() => requestAnimationFrame(() => { l.el.style.opacity = ''; })); }
        } else { l.d = d; l.a = a; l.b = b; }
      }
      for (const [id, l] of links) if (!lseen.has(id)) removeLink(l);
      derive();
      for (const n of fresh) {
        buildNode(n);
        if (animate && !REDUCED) { n.bloom = { t0: now() + Math.min(fresh.indexOf(n), 12) * 28, dur: 520 }; n.bloomEl.setAttribute('transform', 'scale(0.001)'); }
      }
      for (const n of nodes.values()) if (!n.isNew) { drawNode(n, false); ariaNode(n); }
      for (const l of links.values()) styleLink(l);
      buildHulls(); buildLegend();
      return unplaced;
    }
    function removeNode(n) {
      nodes.delete(n.id);
      if (selId === n.id) selId = null; if (hoverId === n.id) hoverId = null;
      n.el.style.pointerEvents = 'none'; n.el.style.opacity = '0'; n.lbl.style.opacity = '0';
      setTimeout(() => { n.el.remove(); n.lbl.remove(); }, REDUCED ? 0 : 300);
    }
    function removeLink(l) {
      links.delete(l.id);
      if (selLinkId === l.id) selLinkId = null; if (hoverLinkId === l.id) hoverLinkId = null; if (hlLinkId === l.id) hlLinkId = null;
      l.el.style.opacity = '0'; l.elbl.style.opacity = '0';
      setTimeout(() => { l.el.remove(); l.elbl.remove(); }, REDUCED ? 0 : 300);
    }

    // degrees, neighbours, faction membership, sizes, bends, faction colours, monograms
    function derive() {
      for (const n of nodes.values()) { n.deg = 0; n.nb = new Set(); n.factions = []; n.links = []; }
      const pairs = new Map();
      for (const l of links.values()) {
        l.a.deg++; l.b.deg++; l.a.nb.add(l.b.id); l.b.nb.add(l.a.id); l.a.links.push(l); l.b.links.push(l);
        const key = l.a.id < l.b.id ? l.a.id + '\u0000' + l.b.id : l.b.id + '\u0000' + l.a.id;
        let arr = pairs.get(key); if (!arr) pairs.set(key, arr = []); arr.push(l);
        if (l.d.kind === 'member') {
          if (l.b.type === 'faction' && l.a.type !== 'faction') l.a.factions.push(l.b.id);
          else if (l.a.type === 'faction' && l.b.type !== 'faction') l.b.factions.push(l.a.id);
          else if (l.b.type === 'faction') l.a.factions.push(l.b.id);
        }
      }
      for (const arr of pairs.values()) {
        arr.sort((p, q) => (p.id < q.id ? -1 : 1));
        const m = arr.length;
        arr.forEach((l, i) => { const flip = l.a.id < l.b.id ? 1 : -1; l.bend = (.08 + (m > 1 ? (i - (m - 1) / 2) * .26 : 0)) * flip; });
      }
      for (const n of nodes.values()) { n.r = radiusOf(n); n.loose = n.deg === 0 && n.type !== 'pc'; }
      // factions: sort the ids, deal the 6 hues in order
      const facs = [...nodes.values()].filter(n => n.type === 'faction').sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      facs.forEach((f, i) => { f.hullColor = FACTION_HUES[th][i % 6]; f.glyph = (GLYPHS.find(g => g[0].test(f.d.name || '')) || [0, GLYPH_SPARE[hash(f.id) % GLYPH_SPARE.length]])[1]; });
      for (const n of nodes.values()) if (n.type !== 'faction') n.hullColor = null;
      // one initials rule: two capitals (drawn only when zoomed out far enough that names are hidden)
      for (const n of nodes.values()) if (n.type !== 'faction') n.mono = initials(n.d.name);
    }
    function buildHulls() {
      const want = new Map();
      for (const n of nodes.values()) for (const fid of n.factions) {
        const f = nodes.get(fid); if (!f) continue;
        if (!want.has(fid)) want.set(fid, []);
        if (!want.get(fid).includes(n)) want.get(fid).push(n);
      }
      for (const [fid, h] of hulls) if (!want.has(fid)) { h.el.remove(); h.cap.remove(); hulls.delete(fid); }
      const capBg = th === 'light' ? '#FFFFFF' : '#111114';
      for (const [fid, members] of want) {
        let h = hulls.get(fid);
        if (!h) {
          h = { fid, el: el('g', { class: 'rg-hull', 'data-fid': fid }, gHull) };
          h.path = el('path', null, h.el);
          h.cap = el('g', { class: 'rg-hcap' }, gTitle);
          h.capRect = el('rect', { rx: 9, ry: 9 }, h.cap);
          h.capDot = el('circle', { r: 3 }, h.cap);
          h.capTxt = el('text', null, h.cap);
          hulls.set(fid, h);
          if (!REDUCED) { h.el.style.opacity = '0'; requestAnimationFrame(() => requestAnimationFrame(() => { h.el.style.opacity = ''; })); }
        }
        const f = nodes.get(fid);
        h.f = f; h.people = members; h.nodes = [f].concat(members);
        h.el.style.setProperty('--rg-c', f.hullColor); h.cap.style.setProperty('--rg-c', f.hullColor);
        h.cap.style.setProperty('--rg-cap', capInk(f.hullColor, capBg, th === 'light'));
        const txt = String(f.d.name || '').toUpperCase(), tw = Math.ceil(textWidth(txt, `700 11px ${fontSans()}`, 11 * .08)), cw = tw + 28;
        h.capTxt.textContent = txt; h.capW = cw; h.capH = 18;
        h.capRect.setAttribute('x', -cw / 2); h.capRect.setAttribute('width', cw); h.capRect.setAttribute('y', -9); h.capRect.setAttribute('height', 18);
        h.capDot.setAttribute('cx', -cw / 2 + 11); h.capTxt.setAttribute('x', 6);   // the faction's hue survives only as this dot
        h.stateClass = null;
      }
      // a member tie is redundant where a hull already draws the membership
      for (const l of links.values()) {
        l.mhide = false;
        if (l.d.kind !== 'member') continue;
        const f = l.a.type === 'faction' ? l.a : l.b.type === 'faction' ? l.b : null, p = f === l.a ? l.b : l.a;
        const h = f && hulls.get(f.id);
        if (h && h.people.includes(p)) l.mhide = true;
      }
    }
    // ---------- layout physics ----------
    // The simulation runs to rest off-screen (a few ms for 80 nodes); the result is then tweened into place.
    const live = () => [...nodes.values()];
    const looseMode = () => mode === 'web' && live().some(n => !n.loose);
    function sizeRings() {
      const pcs = live().filter(n => n.type === 'pc').length;
      pcRing = pcs <= 1 ? 0 : Math.max(70, (R.pc * 2 + 64) / (2 * Math.sin(Math.PI / pcs)));
      orbitBase = Math.max(135, pcRing + 100);
    }
    function orbitR(n) {
      if (n.type === 'pc') return pcRing;
      if (n.type === 'faction') {
        const ms = live().filter(m => m.factions && m.factions.includes(n.id) && m.type !== 'pc');
        if (!ms.length) return orbitBase * ORBIT.neutral;
        return orbitBase * ms.reduce((s, m) => s + (ORBIT[m.d.attitude] || ORBIT.unknown), 0) / ms.length;
      }
      return orbitBase * (ORBIT[n.d.attitude] || ORBIT.unknown);
    }
    function pcSlots() {
      const pcs = live().filter(n => n.type === 'pc').sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1));
      const m = new Map(); pcs.forEach((n, i) => m.set(n, -Math.PI / 2 + i * 2 * Math.PI / pcs.length)); return m;
    }
    function place(free) {
      const all = live(), placed = new Set(all.filter(n => !free.has(n.id)).map(n => n.id));
      let cx = 0, cy = 0, ext = 0;
      if (placed.size) {
        for (const id of placed) { const n = nodes.get(id); cx += n.x; cy += n.y; } cx /= placed.size; cy /= placed.size;
        for (const id of placed) { const n = nodes.get(id); ext = Math.max(ext, Math.hypot(n.x - cx, n.y - cy)); }
      }
      const rest = all.filter(n => free.has(n.id) && !n.pinned), slots = pcSlots(), pcsFree = rest.filter(n => n.type === 'pc');
      let loose = 0;
      while (rest.length) {
        let best = 0, bestScore = -1;
        rest.forEach((n, i) => { let s = 0; n.nb.forEach(id => { if (placed.has(id)) s++; }); s = s * 10 + (n.type === 'pc' ? 5 : 0); if (s > bestScore) { bestScore = s; best = i; } });
        const n = rest.splice(best, 1)[0], rr = rnd(n.id);
        const nbs = [...n.nb].map(id => nodes.get(id)).filter(m => m && placed.has(m.id));
        if (mode === 'party') {
          let a = slots.has(n) ? slots.get(n) : rr() * Math.PI * 2;
          if (!slots.has(n) && nbs.length) a = Math.atan2(nbs.reduce((s, m) => s + m.y, 0), nbs.reduce((s, m) => s + m.x, 0)) + (rr() - .5) * .6;
          const rad = orbitR(n) || 0; n.x = Math.cos(a) * rad; n.y = Math.sin(a) * rad;
        } else if (nbs.length) {
          const mx = nbs.reduce((s, m) => s + m.x, 0) / nbs.length, my = nbs.reduce((s, m) => s + m.y, 0) / nbs.length;
          const a = rr() * Math.PI * 2, d = nbs.length > 1 ? 18 + rr() * 20 : 90;
          n.x = mx + Math.cos(a) * d; n.y = my + Math.sin(a) * d;
        } else if (n.type === 'pc' && !placed.size) {
          const i = pcsFree.indexOf(n), a = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, pcsFree.length), rad = pcsFree.length > 1 ? 60 : 0;
          n.x = cx + Math.cos(a) * rad; n.y = cy + Math.sin(a) * rad;
        } else {
          const i = loose++, a = i * 2.39996 + rr() * .3, rad = (placed.size ? ext + 70 : 90) + Math.sqrt(i) * 42;
          n.x = cx + Math.cos(a) * rad; n.y = cy + Math.sin(a) * rad;
        }
        placed.add(n.id);
      }
    }
    let kLayout = 0, aspect = 1;   // phone: the zoom the layout expects, so it can space nodes for their 36px drawn size
    const cr = n => kLayout ? Math.max(n.r, 18 / kLayout) : n.r;
    // Forces (d3 terms): link 110 (70 inside a faction) at 0.6, many-body −420 out to 500, collide r + 18,
    // gravity 0.04 shaped to the container, faction pull 0.18, 64px between territories, outsiders kept out.
    function charge(n) { return n.type === 'pc' ? -460 : -420; }
    const sameFaction = (a, b) => a.factions.some(f => b.factions.includes(f)) || a.factions.includes(b.id) || b.factions.includes(a.id);
    function forces(alpha, all, isFree, L) {
      const N = all.length, party = mode === 'party';
      for (let i = 0; i < N; i++) {
        const a = all[i], fa = isFree(a);
        for (let j = i + 1; j < N; j++) {
          const b = all[j], fb = isFree(b); if (!fa && !fb) continue;
          let dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy;
          if (l2 < 1) { dx = (hash(a.id + b.id) % 100) / 100 - .5 || .3; dy = .37; l2 = dx * dx + dy * dy; }
          if (l2 < 250000) {
            const qa = charge(a) * alpha / l2, qb = charge(b) * alpha / l2;
            if (fa) { a.vx += dx * qb; a.vy += dy * qb; }
            if (fb) { b.vx -= dx * qa; b.vy -= dy * qa; }
          }
          const minD = cr(a) + cr(b) + (kLayout ? (a.type === 'pc' || b.type === 'pc' ? 30 : 18) / kLayout : 36), l = Math.sqrt(l2);
          if (l < minD) {
            const push = (minD - l) / l * .5, share = fa && fb ? .5 : 1;
            if (fa) { a.x -= dx * push * share; a.y -= dy * push * share; }
            if (fb) { b.x += dx * push * share; b.y += dy * push * share; }
          }
        }
      }
      for (const l of L) {
        const a = l.a, b = l.b, fa = isFree(a), fb = isFree(b); if (!fa && !fb) continue;
        const dx = b.x + b.vx - a.x - a.vx, dy = b.y + b.vy - a.y - a.vy, len = Math.hypot(dx, dy) || 1;
        let target = (l.d.kind === 'member' || sameFaction(a, b) ? 70 : 110) + (cr(a) - a.r) + (cr(b) - b.r), s = .6 / Math.max(1, Math.sqrt(Math.min(a.deg, b.deg)));
        if (l.d.ended) { target += 30; s *= .5; }
        if (party) s *= .15;
        const k = (len - target) / len * alpha * s, x = dx * k, y = dy * k;
        let bias = a.deg / (a.deg + b.deg); if (!fa) bias = 1; if (!fb) bias = 0;
        if (fb) { b.vx -= x * bias; b.vy -= y * bias; }
        if (fa) { a.vx += x * (1 - bias); a.vy += y * (1 - bias); }
      }
      if (!party) {
        const hs = [];
        for (const h of hulls.values()) {
          const ms = h.nodes.filter(m => all.includes(m)); if (!ms.length) continue;
          let mx = 0, my = 0; for (const m of ms) { mx += m.x; my += m.y; } mx /= ms.length; my /= ms.length;
          let rad = 0;
          for (const m of ms) {
            if (isFree(m) && m.type !== 'pc') { m.vx += (mx - m.x) * .18 * alpha; m.vy += (my - m.y) * .18 * alpha; }
            rad = Math.max(rad, Math.hypot(m.x - mx, m.y - my) + cr(m));
          }
          hs.push({ ms, mx, my, rad: rad + 22 });
        }
        const pull = Math.max(alpha, .25);
        for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
          const A = hs[i], B = hs[j]; let dx = B.mx - A.mx, dy = B.my - A.my; const d = Math.hypot(dx, dy) || 1, min = A.rad + B.rad + 64;
          if (d >= min || A.ms.some(m => B.ms.includes(m))) continue;
          const k = (min - d) / d * .25 * pull; dx *= k; dy *= k;
          for (const m of A.ms) if (isFree(m)) { m.x -= dx; m.y -= dy; }
          for (const m of B.ms) if (isFree(m)) { m.x += dx; m.y += dy; }
        }
        for (const H of hs) for (const n of all) {
          if (!isFree(n) || H.ms.includes(n)) continue;
          const dx = n.x - H.mx, dy = n.y - H.my, d = Math.hypot(dx, dy) || 1, lim = H.rad + cr(n) + 24;
          if (d < lim) { const k = (lim - d) / d * .3 * pull; n.x += dx * k; n.y += dy * k; }
        }
      }
      // gravity: the party to the middle, shaped to the container (a portrait phone gets a tall web, a wide screen a wide one)
      const slots = party ? pcSlots() : null, ax = Math.pow(aspect, -.7), ay = Math.pow(aspect, .7);
      for (const n of all) {
        if (!isFree(n)) continue;
        if (!party) {
          const g = n.type === 'pc' ? 2 : 1;
          const gx = portrait ? .16 : .04 * ax, gy = portrait ? .022 : .04 * ay;     // a portrait container stretches the web tall
          n.vx -= n.x * gx * g * alpha; n.vy -= n.y * gy * g * alpha;
        } else if (n.type === 'pc') {
          const a = slots.get(n) || 0;
          n.vx += (Math.cos(a) * pcRing - n.x) * .5 * alpha; n.vy += (Math.sin(a) * pcRing - n.y) * .5 * alpha;
        } else {
          const r = Math.hypot(n.x, n.y) || 1, k = (orbitR(n) - r) / r * .8 * alpha;
          n.vx += n.x * k; n.vy += n.y * k;
        }
      }
    }
    function settle(free, ticks) {
      const lm = looseMode();
      const all = live().filter(n => !(lm && n.loose)), isFree = n => free.has(n.id) && !n.pinned && !(drag && drag.n === n);
      const F = all.filter(isFree); if (!F.length) return;
      const L = [...links.values()];
      for (const n of all) { n.vx = 0; n.vy = 0; }
      let alpha = 1; const decay = 1 - Math.pow(.001, 1 / ticks), t0 = now();
      for (let it = 0; it < ticks; it++) {
        forces(alpha, all, isFree, L);
        for (const n of F) {
          n.vx *= .56; n.vy *= .56;
          const v = Math.hypot(n.vx, n.vy); if (v > 60) { n.vx *= 60 / v; n.vy *= 60 / v; }
          n.x += n.vx; n.y += n.vy;
        }
        alpha += -alpha * decay;
        if (now() - t0 > 160) break;      // a hard budget, whatever the size
      }
      for (const n of all) { n.vx = 0; n.vy = 0; }
      if (mode === 'party') projectOrbits(F);
    }
    // party layout: everyone exactly on their attitude's ring, each ring spread so no two discs touch
    function projectOrbits(F) {
      const slots = pcSlots(), bands = new Map();
      for (const n of F) {
        if (n.type === 'pc') { const a = slots.get(n) || 0; n.x = Math.cos(a) * pcRing; n.y = Math.sin(a) * pcRing; continue; }
        const key = Math.round(orbitR(n));
        if (!bands.has(key)) bands.set(key, []);
        bands.get(key).push({ n, a: Math.atan2(n.y, n.x) });
      }
      for (const [R0, items] of bands) {
        const m = items.length, r = Math.max(R0, items.reduce((s, it) => s + it.n.r * 2 + 34, 0) / (2 * Math.PI));
        for (let iter = 0; iter < 120 && m > 1; iter++) {
          items.sort((p, q) => p.a - q.a);
          let moved = false;
          for (let i = 0; i < m; i++) {
            const A = items[i], B = items[(i + 1) % m];
            let gap = B.a - A.a; if (i === m - 1) gap += Math.PI * 2;
            const min = (A.n.r + B.n.r + 34) / r;
            if (gap < min) { const d = (min - gap) / 2 + 1e-4; A.a -= d; B.a += d; moved = true; }
          }
          if (!moved) break;
        }
        for (const it of items) { it.n.x = Math.cos(it.a) * r; it.n.y = Math.sin(it.a) * r; }
      }
    }
    // people with no ties at all wait on a "Not yet tied (n)" shelf under the web, lower left
    function arrangeLoose() {
      looseAt = null;
      if (!looseMode()) return;
      const core = live().filter(n => !n.loose), ls = live().filter(n => n.loose && !n.pinned).sort((a, b) => String(a.d.name).localeCompare(String(b.d.name)));
      if (!ls.length) return;
      let x0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of core) { x0 = Math.min(x0, n.x - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); }
      const font = `600 12px ${fontSans()}`, rowW = Math.max(420, x1 - x0), top = y1 + 92;
      let x = x0 + 20, row = 0;
      for (const n of ls) {
        const w = Math.max(56, textWidth(compact ? phoneName(n.d) : shortName(labelName(n.d)), font) + 18);
        if (x + w - x0 > rowW && x > x0 + 20) { x = x0 + 20; row++; }
        n.x = x + w / 2 - 20 + R.npcMin; n.y = top + row * 64; x += w;
      }
      looseAt = [x0 + 20, top - R.npcMin - 22];
      looseLbl.textContent = `Not yet tied (${ls.length})`;
    }
    // Focus spacing (drawn only, never saved). Desktop: neighbours closer than 150px are eased out so every tie has room
    // for its chip. Phone: a radial ego view — the person in the middle, everyone tied to them on a 130px ring,
    // ordered clockwise warm → structural → hostile.
    let egoMode = false, egoR = 130, egoRx = 130, egoRy = 130, camBefore = null;
    // what the page really leaves visible (its raw insets), unless that is implausibly small
    const visibleSafe = () => {
      const v = { l: ins.left, t: ins.top, r: W - ins.right, b: H - ins.bottom };
      return v.r - v.l >= 150 && v.b - v.t >= 110 ? v : safe();
    };
    const valenceOf = (f, m) => { let v = 1; for (const l of f.links) if (l.a === m || l.b === m) { const t = l.ks ? l.ks.tone : 'structural'; v = Math.max(v, t === 'hostile' ? 3 : t === 'structural' ? 2 : 1); } return v; };
    function computeDisp(animate) {
      const targets = new Map(), f = selId && nodes.get(selId);
      egoMode = !!(f && compact && mode === 'web');
      root.classList.toggle('rg-ego', egoMode);
      if (f && egoMode) {
        const ms = [...f.nb].map(id => nodes.get(id)).filter(Boolean)
          .map(m => ({ m, v: valenceOf(f, m), a: Math.atan2(m.y - f.y, m.x - f.x) }))
          .sort((p, q) => p.v - q.v || p.a - q.a);
        // the ring lives in the part of the screen the page leaves visible (a bottom sheet shrinks it): it narrows or flattens to fit
        const v = visibleSafe(), want = Math.max(130, ms.length * 66 / (2 * Math.PI));
        egoRx = clamp((v.r - v.l) / 2 - 44, 70, want); egoRy = clamp((v.b - v.t) / 2 - 36, 50, want);
        egoR = Math.max(egoRx, egoRy);
        ms.forEach((it, i) => {
          const a = -Math.PI / 2 + i * 2 * Math.PI / Math.max(1, ms.length);
          targets.set(it.m, [f.x + Math.cos(a) * egoRx - it.m.x, f.y + Math.sin(a) * egoRy - it.m.y]);
        });
      } else if (f && mode === 'web') {
        const items = [];
        for (const id of f.nb) {
          const m = nodes.get(id); if (!m) continue;
          const need = Math.max(150, f.r + m.r + 70), dx = m.x - f.x, dy = m.y - f.y, d = Math.hypot(dx, dy) || 1;
          items.push({ m, a: Math.atan2(dy, dx), dist: Math.max(d, need) });
        }
        const n = items.length;
        for (let iter = 0; iter < 80 && n > 1; iter++) {
          items.sort((p, q) => p.a - q.a);
          let moved = false;
          for (let i = 0; i < n; i++) {
            const A = items[i], B = items[(i + 1) % n];
            let gap = B.a - A.a; if (i === n - 1) gap += Math.PI * 2;
            const min = (A.m.r + B.m.r + 40) / Math.min(A.dist, B.dist);
            if (gap < min) { const dd = (min - gap) / 2 + 1e-4; A.a -= dd; B.a += dd; moved = true; }
          }
          if (!moved) break;
        }
        for (const it of items) {
          const tx = f.x + Math.cos(it.a) * it.dist - it.m.x, ty = f.y + Math.sin(it.a) * it.dist - it.m.y;
          if (Math.abs(tx) + Math.abs(ty) > .5) targets.set(it.m, [tx, ty]);
        }
      }
      const items = [];
      for (const n of nodes.values()) {
        const t = targets.get(n) || [0, 0];
        if (drag && drag.n === n) continue;
        if (Math.abs((n.dx || 0) - t[0]) + Math.abs((n.dy || 0) - t[1]) > .1) items.push({ n, sx: n.dx || 0, sy: n.dy || 0, tx: t[0], ty: t[1] });
        n.tdx = t[0]; n.tdy = t[1];
      }
      if (!items.length) { forceLabels = true; kick(); return; }
      if (!animate || REDUCED) { for (const it of items) { it.n.dx = it.tx; it.n.dy = it.ty; } dispAnim = null; }
      else dispAnim = { t0: now(), dur: egoMode ? 300 : 350, items };
      kick();
    }

    // run the layout for `free` nodes, then glide everything from where it was to where it settled
    function relayout(free, o) {
      o = o || {};
      const all = live(), start = new Map(all.map(n => [n, [n.x, n.y]]));
      sizeRings();
      if (o.place !== false) place(free);
      const placedAt = new Map(all.map(n => [n, [n.x, n.y]]));
      kLayout = 0;
      if (W && H) { const sa = safe(); aspect = clamp((sa.r - sa.l) / Math.max(1, sa.b - sa.t), .5, 2.2); }
      settle(free, o.ticks || 320);
      if (compact && W && free.size) {        // phone: once more, spaced for the size nodes are actually drawn at
        for (let pass = 0; pass < 2; pass++) { kLayout = fitFor(all).k; settle(free, 200); }
        kLayout = 0;
      }
      if (mode === 'web') arrangeLoose(); else looseAt = null;
      const end = new Map(all.map(n => [n, [n.x, n.y]]));
      if (selId) computeDisp(!!o.animate);
      if (o.fit) { autoFit = true; setCam(fitFor(all), !!o.animate, 820); }
      if (o.animate && !REDUCED) {
        const items = [];
        for (const n of all) {
          const s = n.isNew && n.bloom ? placedAt.get(n) : start.get(n), e = end.get(n);
          if (n.isNew && n.bloom) { n.x = e[0]; n.y = e[1]; continue; }   // new people bloom in place
          if (Math.abs(s[0] - e[0]) + Math.abs(s[1] - e[1]) < .5) continue;
          items.push({ n, x0: s[0], y0: s[1], x1: e[0], y1: e[1] }); n.x = s[0]; n.y = s[1];
        }
        if (items.length) tween = { t0: now(), dur: o.dur || 760, items };
      }
      forceLabels = true; kick();
    }

    // ---------- camera: everything frames inside the safe area (the page's overlays set it with setInsets) ----------
    const g2s = (x, y) => [x * cam.k + cam.x, y * cam.k + cam.y];
    const s2g = (sx, sy) => [(sx - cam.x) / cam.k, (sy - cam.y) / cam.k];
    const K_MIN = .12, K_MAX = 4;
    let autoFit = true, fitted = false;
    function finalXY(n) {
      let x = n.x, y = n.y;
      if (tween) for (const it of tween.items) if (it.n === n) { x = it.x1; y = it.y1; break; }
      return [x + (n.tdx || 0), y + (n.tdy || 0)];
    }
    function boundsOf(list) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const pts = list.map(n => { const [x, y] = finalXY(n); if (x - n.r < x0) x0 = x - n.r; if (x + n.r > x1) x1 = x + n.r; if (y - n.r < y0) y0 = y - n.r; if (y + n.r > y1) y1 = y + n.r; return [n, x]; });
      // names hang past the outermost discs: allow for the widest of the three nearest each side
      const font = `600 12px ${fontSans()}`, half = n => textWidth(compact ? phoneName(n.d) : shortName(labelName(n.d)), font) / 2 - n.r;
      pts.sort((a, b) => a[1] - b[1]);
      let oh = 0; for (const [n] of pts.slice(0, 3).concat(pts.slice(-3))) if (!(n.type === 'faction' && hulls.has(n.id))) oh = Math.max(oh, half(n));
      return { x0, y0, x1, y1, oh: clamp(oh, 0, 70) };
    }
    function fitFor(list, maxK) {
      const s = safe();
      if (!list.length || !W || !H) return { x: (s.l + s.r) / 2, y: (s.t + s.b) / 2, k: 1 };
      const b = boundsOf(list), aw = Math.max(40, s.r - s.l - 2 * b.oh), ah = Math.max(40, s.b - s.t - 22);
      const kFor = (cx, cy) => Math.min(aw / Math.max(1, 2 * Math.max(cx - b.x0, b.x1 - cx)), ah / Math.max(1, 2 * Math.max(cy - b.y0, b.y1 - cy)));
      let cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      const k0 = kFor(cx, cy), pcs = list.filter(n => n.type === 'pc');
      if (pcs.length) {   // lean toward the party as far as it costs little zoom
        const px = pcs.reduce((a, n) => a + finalXY(n)[0], 0) / pcs.length, py = pcs.reduce((a, n) => a + finalXY(n)[1], 0) / pcs.length;
        for (const f of [.7, .5, .3, .15]) { const tx = lerp(cx, px, f), ty = lerp(cy, py, f); if (kFor(tx, ty) >= k0 * .86) { cx = tx; cy = ty; break; } }
      }
      const k = clamp(kFor(cx, cy), K_MIN, maxK || 1.3);
      return { k, x: (s.l + s.r) / 2 - cx * k, y: (s.t + s.b) / 2 - 9 - cy * k };
    }
    // frame a set of nodes with padding inside the safe area (focus framing)
    function frameFor(list, pad, maxK) {
      const s = safe(), b = boundsOf(list);
      const p = Math.min(pad, (s.r - s.l) * .16, (s.b - s.t) * .16);
      const aw = Math.max(40, s.r - s.l - 2 * p - 2 * b.oh), ah = Math.max(40, s.b - s.t - 2 * p - 22);
      const k = clamp(Math.min(aw / Math.max(1, b.x1 - b.x0), ah / Math.max(1, b.y1 - b.y0)), K_MIN, maxK);
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      return { k, x: (s.l + s.r) / 2 - cx * k, y: (s.t + s.b) / 2 - 9 - cy * k };
    }
    function focusCam(n) {
      if (egoMode) {   // phone: the ring at true size (130px), shrunk only if the safe area can't hold it
        const s = visibleSafe(), k = clamp(Math.min(1, ((s.r - s.l) / 2 - 22) / (egoRx + 22), ((s.b - s.t) / 2 - 14) / (egoRy + 22)), .4, 1);
        return { k, x: (s.l + s.r) / 2 - n.x * k, y: (s.t + s.b) / 2 - n.y * k };
      }
      const list = [n].concat([...n.nb].map(id => nodes.get(id)).filter(Boolean));
      if (list.length > 1) {   // the ego network fills about 70% of the safe area, centred in it
        const s = safe(), b = boundsOf(list), aw = (s.r - s.l) * .7 - 2 * b.oh, ah = (s.b - s.t) * .7 - 22;
        const k = clamp(Math.min(aw / Math.max(1, b.x1 - b.x0), ah / Math.max(1, b.y1 - b.y0)), K_MIN, 1.6);
        return { k, x: (s.l + s.r) / 2 - (b.x0 + b.x1) / 2 * k, y: (s.t + s.b) / 2 - 9 - (b.y0 + b.y1) / 2 * k };
      }
      if (list.length === 1) { const k = clamp(Math.max(cam.k, 1.2), K_MIN, 1.6), s = safe(), [x, y] = finalXY(n); return { k, x: (s.l + s.r) / 2 - x * k, y: (s.t + s.b) / 2 - y * k }; }
      return frameFor(list, 80, 1.6);
    }
    // keep the content inside the safe area with the smallest move
    function nudgeCam() {
      const list = live(); if (!list.length) return null;
      const b = boundsOf(list), s = safe();
      const L = b.x0 * cam.k + cam.x, Rr = b.x1 * cam.k + cam.x, T = b.y0 * cam.k + cam.y, B = b.y1 * cam.k + cam.y + 22;
      const axis = (lo, hi, slo, shi) => (hi - lo <= shi - slo) ? (lo < slo ? slo - lo : hi > shi ? shi - hi : 0) : (lo > slo ? slo - lo : hi < shi ? shi - hi : 0);
      const dx = axis(L, Rr, s.l, s.r), dy = axis(T, B, s.t, s.b);
      return dx || dy ? { k: cam.k, x: cam.x + dx, y: cam.y + dy } : null;
    }
    function setCam(t, animate, dur) {
      if (!animate || REDUCED || !W) { cam.x = t.x; cam.y = t.y; cam.k = t.k; camAnim = null; forceLabels = true; kick(); return; }
      const f = { ...cam };
      camAnim = { t0: now(), dur: dur || 650, kf: f.k, kt: t.k, cf: [(W / 2 - f.x) / f.k, (H / 2 - f.y) / f.k], ct: [(W / 2 - t.x) / t.k, (H / 2 - t.y) / t.k] };
      kick();
    }
    function zoomAt(sx, sy, factor, animate) {
      autoFit = false;
      const k2 = clamp(cam.k * factor, K_MIN, K_MAX), f = k2 / cam.k;
      const t = { k: k2, x: sx - (sx - cam.x) * f, y: sy - (sy - cam.y) * f };
      if (animate) setCam(t, true, 260); else { camAnim = null; cam.x = t.x; cam.y = t.y; cam.k = t.k; kick(); }
    }
    function centreOn(n, k, dur) {
      autoFit = false;
      const kk = k || cam.k, s = safe(), [x, y] = finalXY(n);
      setCam({ k: kk, x: (s.l + s.r) / 2 - x * kk, y: (s.t + s.b) / 2 - y * kk }, true, dur || 300);
    }
    function onScreen(n, margin) {
      const [sx, sy] = g2s(X(n), Y(n)), m = margin || 0, s = safe();
      return sx > s.l + m && sy > s.t + m && sx < s.r - m && sy < s.b - m;
    }

    // ---------- the animation loop: runs only while something is moving ----------
    let forceLabels = true, lastLabels = 0, labelTimer = 0;
    function kick() { if (!raf && !destroyed) raf = requestAnimationFrame(frame); }
    function frame() {
      raf = 0; if (destroyed) return;
      const t = now(); let active = false;
      if (tween) {
        const p = clamp((t - tween.t0) / tween.dur, 0, 1), e = p < .5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
        for (const it of tween.items) { if (drag && drag.n === it.n) continue; it.n.x = lerp(it.x0, it.x1, e); it.n.y = lerp(it.y0, it.y1, e); }
        if (p < 1) active = true; else { tween = null; forceLabels = true; }
      }
      if (dispAnim) {
        const p = clamp((t - dispAnim.t0) / dispAnim.dur, 0, 1), e = easeOut(p);
        for (const it of dispAnim.items) { it.n.dx = lerp(it.sx, it.tx, e); it.n.dy = lerp(it.sy, it.ty, e); }
        if (p < 1) active = true; else { dispAnim = null; forceLabels = true; }
      }
      if (camAnim) {
        const a = camAnim, p = clamp((t - a.t0) / a.dur, 0, 1), e = 1 - Math.pow(1 - p, 4);   // ≈ cubic-bezier(.22,1,.36,1)
        const k = Math.exp(lerp(Math.log(a.kf), Math.log(a.kt), e));
        const cx = lerp(a.cf[0], a.ct[0], e), cy = lerp(a.cf[1], a.ct[1], e);
        cam.k = k; cam.x = W / 2 - cx * k; cam.y = H / 2 - cy * k;
        if (p < 1) active = true; else { camAnim = null; forceLabels = true; }
      }
      if (render(t)) active = true;
      if (active) kick();
    }

    // ---------- render: positions only; looks are classes (see applyClasses) ----------
    const f1 = v => (Math.round(v * 10) / 10);
    function setA(e, name, v) { if (e['_' + name] !== v) { e['_' + name] = v; e.setAttribute(name, v); } }
    let lowZoom = null;
    function render(t) {
      t = t || now();
      const k = cam.k, bigHit = compact || COARSE; let busy = false;
      view.setAttribute('transform', `translate(${cam.x.toFixed(2)},${cam.y.toFixed(2)}) scale(${k.toFixed(5)})`);
      grid.setAttribute('x', (cam.x % 24).toFixed(2)); grid.setAttribute('y', (cam.y % 24).toFixed(2));
      const lz = k < .8 && !compact; if (lz !== lowZoom) { lowZoom = lz; root.classList.toggle('rg-lowzoom', lz); }
      // nodes: bloom-in, pulses; on a phone a 36px minimum drawn size, 44px in the ego view
      for (const n of nodes.values()) {
        n.el.setAttribute('transform', `translate(${f1(X(n))},${f1(Y(n))})`);
        n.vs = !compact ? 1 : egoMode && n.inFocus ? 22 / (n.r * k) : Math.max(1, 18 / (n.r * k));
        let s = n.vs;
        if (n.bloom) {
          const p = clamp((t - n.bloom.t0) / n.bloom.dur, 0, 1);
          s *= Math.max(.001, easeBack(p));
          if (p >= 1) { n.bloom = null; n.bloomEl.style.opacity = ''; } else { busy = true; n.bloomEl.style.opacity = Math.min(1, p * 3).toFixed(2); }
        }
        if (n.pulse) {
          const ph = (t - n.pulse.t0) / 600;
          if (ph >= 2) n.pulse = null; else if (ph >= 0) { s *= 1 + .15 * Math.sin(Math.PI * (ph % 1)); busy = true; } else busy = true;
        }
        n.s = s;
        setA(n.bloomEl, 'transform', Math.abs(s - 1) < .001 ? '' : `scale(${s.toFixed(3)})`);
        if (bigHit) setA(n.hitEl, 'r', f1(Math.max(n.r, 22 / (k * n.vs))));
        if (n.badges.length) { const bs = `scale(${(1 / (k * n.vs)).toFixed(3)})`; for (const b of n.badges) setA(b, 'transform', bs); }
      }
      // ties: ends clipped at the ring + 2px, 8×6px arrowheads ending 3px off the target, bent around nodes in the way
      const alen = 7 / k, aw = 3.5 / k;
      for (const l of links.values()) {
        const a = l.a, b = l.b, ax = X(a), ay = Y(a), bx = X(b), by = Y(b), len0 = Math.hypot(bx - ax, by - ay) || 1;
        const c = curve(ax, ay, bx, by, l.bend + (l.avoid || 0) / len0);
        const arrow = l.d.dir === 'ab', ra = a.ringOut * a.s + 2 / k, rb = b.ringOut * b.s + (arrow ? 3 : 2) / k;
        if (c.len < ra + rb + 4) { l.el.style.display = 'none'; l.mid = null; continue; }
        l.el.style.display = '';
        const t0 = tAtRadius(ax, ay, c.cx, c.cy, bx, by, ra, false), tip = tAtRadius(ax, ay, c.cx, c.cy, bx, by, rb, true);
        const t1 = arrow ? tAtRadius(ax, ay, c.cx, c.cy, bx, by, rb + alen * .85, true) : tip;
        const q = qsub(ax, ay, c.cx, c.cy, bx, by, t0, Math.max(t0 + .01, t1));
        const d = `M${f1(q[0])},${f1(q[1])}Q${f1(q[2])},${f1(q[3])} ${f1(q[4])},${f1(q[5])}`;
        setA(l.path, 'd', d); setA(l.hit, 'd', d);
        if (arrow) {
          const p = qpt(ax, ay, c.cx, c.cy, bx, by, tip), tg = qtan(ax, ay, c.cx, c.cy, bx, by, tip);
          const tl = Math.hypot(tg[0], tg[1]) || 1, ux = tg[0] / tl, uy = tg[1] / tl, bx2 = p[0] - ux * alen, by2 = p[1] - uy * alen, nx = -uy * aw, ny = ux * aw;
          setA(l.arrow, 'd', `M${f1(p[0])},${f1(p[1])}L${f1(bx2 + nx)},${f1(by2 + ny)}L${f1(bx2 - nx)},${f1(by2 - ny)}Z`);
        } else setA(l.arrow, 'd', '');
        // the chip sits mid-tie; in the phone's ego view, out toward the neighbour so the middle stays clear
        const tm = egoMode && (a.id === selId || b.id === selId) ? (a.id === selId ? .62 : .38) : .5;
        const m = qpt(ax, ay, c.cx, c.cy, bx, by, tm), tg = qtan(ax, ay, c.cx, c.cy, bx, by, tm), tl = Math.hypot(tg[0], tg[1]) || 1;
        l.mid = g2s(m[0], m[1]); l.tan = [tg[0] / tl, tg[1] / tl]; l.geo = [ax, ay, c.cx, c.cy, bx, by];
        l.room = (c.len - a.ringOut * a.s - b.ringOut * b.s) * k - 16;
        l.sdir = [bx - ax, by - ay];
      }
      // faction territories: member discs inflated by 22, convex, two Chaikin passes
      const focusOn = !!(selId || selLinkId);
      for (const h of hulls.values()) {
        // while someone is focused, a territory is redrawn around its highlighted members only (18px padding)
        const ms = focusOn ? h.nodes.filter(m => m.inFocus) : h.nodes;
        const cs = (ms.length ? ms : h.nodes).map(m => ({ x: X(m), y: Y(m), r: m.ringOut * (m.s || 1) }));
        if (!cs.length) continue;
        const bp = blobPath(cs, focusOn ? 18 : 22);
        setA(h.path, 'd', bp.d); h.pts = bp.pts;
        let top = Infinity, bot = -Infinity; for (const p of bp.pts) { if (p[1] < top) top = p[1]; if (p[1] > bot) bot = p[1]; }
        const band = Math.max(4, (bot - top) * .12); let sx = 0, n1 = 0, bx = 0, n2 = 0;
        for (const p of bp.pts) { if (p[1] <= top + band) { sx += p[0]; n1++; } if (p[1] >= bot - band) { bx += p[0]; n2++; } }
        h.top = g2s(sx / (n1 || 1), top); h.bot = g2s(bx / (n2 || 1), bot);
      }
      if (mode === 'party') for (const o of orbitLbls) { const p = g2s(0, -o.r); o.el.setAttribute('x', f1(p[0])); o.el.setAttribute('y', f1(p[1] - 6)); }
      if (looseAt) { const p = g2s(looseAt[0], looseAt[1]); looseLbl.style.display = ''; setA(looseLbl, 'x', f1(p[0])); setA(looseLbl, 'y', f1(p[1])); }
      else looseLbl.style.display = 'none';
      // text placement (and edge routing) is decided at most every 120ms, and once more when motion stops; positions follow every frame
      const decide = forceLabels || t - lastLabels >= 120;
      if (decide) { forceLabels = false; lastLabels = t; clearTimeout(labelTimer); labelTimer = 0; routeEdges(); }
      else if (!labelTimer) labelTimer = setTimeout(() => { labelTimer = 0; forceLabels = true; kick(); }, 130);
      layoutText(k, decide);
      placeHandle();
      return busy;
    }
    // a straight tie that would run within r + 6px of a third person bends around them (at least a 28px control offset)
    function routeEdges() {
      const ns = [...nodes.values()].filter(n => !n.out);
      for (const l of links.values()) {
        l.avoid = 0;
        const a = l.a, b = l.b, ax = X(a), ay = Y(a), dx = X(b) - ax, dy = Y(b) - ay, L2 = dx * dx + dy * dy;
        if (L2 < 1 || Math.abs(l.bend) > .2) continue;
        const len = Math.sqrt(L2); let need = 0, side = 0;
        for (const n of ns) {
          if (n === a || n === b) continue;
          const px = X(n) - ax, py = Y(n) - ay, t = (px * dx + py * dy) / L2;
          if (t < .06 || t > .94) continue;
          const dist = (px * -dy + py * dx) / len, clear = n.ringOut * (n.s || 1) + 6;
          if (Math.abs(dist) >= clear) continue;
          const c = Math.min(110, Math.max(28, (clear - Math.abs(dist)) / (2 * t * (1 - t))));
          if (c > need) { need = c; side = dist >= 0 ? -1 : 1; }
        }
        if (need) l.avoid = side * need - l.bend * len;
      }
    }

    // ---------- text: names, faction captions and tie chips, placed greedily by priority ----------
    function setLines(n, lines) {
      const key = lines.join('\n'); if (n.lblKey === key) return;
      n.lblKey = key; n.lbl.textContent = '';
      n.tsp = lines.map((ln, i) => { const t = el('tspan', null, n.lbl); t.textContent = ln; if (i) t.setAttribute('dy', 13); return t; });
    }
    function layoutText(k, decide) {
      const s = safe(), sans = fontSans(), boxes = [], capBoxes = [], circles = [];
      const fx = focusNodeId(), fn = fx && nodes.get(fx), fsStrong = !!(selId || selLinkId);
      for (const n of nodes.values()) {
        if (n.out || n.dim) { n.sx = null; continue; }
        const [sx, sy] = g2s(X(n), Y(n)); n.sx = sx; n.sy = sy; n.sr = n.ringOut * n.s * k;
        circles.push([sx, sy, n.sr, n]);
      }
      const inSafe = b => b[0] >= s.l && b[2] <= s.r && b[1] >= s.t && b[3] <= s.b;
      const over = (b, list, c) => { for (const o of list) if (b[0] - c < o[2] && b[2] + c > o[0] && b[1] - c < o[3] && b[3] + c > o[1]) return true; return false; };
      const hitDisc = (b, self, c) => {
        for (const d of circles) {
          if (d[3] === self) continue;
          const qx = clamp(d[0], b[0], b[2]), qy = clamp(d[1], b[1], b[3]), rr = d[2] + c;
          if ((qx - d[0]) * (qx - d[0]) + (qy - d[1]) * (qy - d[1]) < rr * rr) return true;
        }
        return false;
      };
      // segments a name should not sit on: visible ties and territory outlines (built only when deciding)
      let segs = null;
      if (decide) {
        segs = [];
        for (const l of links.values()) {
          if (!l.mid || l.out || l.dim || (l.mhide && !l.nb)) continue;
          const g = l.geo; let prev = g2s(g[0], g[1]);
          for (let i = 1; i <= 6; i++) { const p = qpt(g[0], g[1], g[2], g[3], g[4], g[5], i / 6), sp = g2s(p[0], p[1]); segs.push([prev[0], prev[1], sp[0], sp[1]]); prev = sp; }
        }
        if (mode !== 'party') for (const h of hulls.values()) if (h.pts && !h.outT) {
          const P = h.pts; for (let i = 0; i < P.length; i += 3) { const a = g2s(P[i][0], P[i][1]), b = g2s(P[(i + 3) % P.length][0], P[(i + 3) % P.length][1]); segs.push([a[0], a[1], b[0], b[1]]); }
        }
      }
      const segHit = b => {
        for (const g of segs) {
          if (Math.max(g[0], g[2]) < b[0] || Math.min(g[0], g[2]) > b[2] || Math.max(g[1], g[3]) < b[1] || Math.min(g[1], g[3]) > b[3]) continue;
          // the segment's bounding box meets the label: check it really crosses (sample it)
          for (let i = 0; i <= 8; i++) { const x = lerp(g[0], g[2], i / 8), y = lerp(g[1], g[3], i / 8); if (x > b[0] && x < b[2] && y > b[1] && y < b[3]) return true; }
        }
        return false;
      };
      // 1. faction captions: a pill centred on the top edge of each territory (bottom edge if a face is in the way)
      for (const h of hulls.values()) {
        const want = mode !== 'party' && h.top && !h.outT;
        if (want && decide) {
          const w = h.capW, ht = h.capH, at = c => [c[0] - w / 2, c[1] - ht / 2, c[0] + w / 2, c[1] + ht / 2];
          // on the top edge (slid either way), 6px outside it, then the same at the bottom; never within 4px of a face
          h.cands = [[0, 'top', 0], [w * .35, 'top', 0], [-w * .35, 'top', 0], [0, 'top', -(ht / 2 + 6)], [w * .35, 'top', -(ht / 2 + 6)], [-w * .35, 'top', -(ht / 2 + 6)],
            [0, 'bot', 0], [0, 'bot', ht / 2 + 6], [w * .35, 'bot', ht / 2 + 6], [-w * .35, 'bot', ht / 2 + 6]];
          h.cp = -1;
          for (let i = 0; i < h.cands.length; i++) {
            const c = h.cands[i], p = c[1] === 'top' ? h.top : h.bot, b = at([p[0] + c[0], p[1] + c[2]]);
            if (!hitDisc(b, null, 4) && !over(b, capBoxes, 2) && inSafe(b)) { h.cp = i; break; }
          }
        }
        const hot = h.fid === hoverId || h.fid === selId;
        const on = want && h.cands && (h.cp >= 0 || hot);
        if (on) {
          const c = h.cands[Math.max(0, h.cp)], p = c[1] === 'top' ? h.top : h.bot, cx = p[0] + c[0], cy = p[1] + c[2];
          setA(h.cap, 'transform', `translate(${f1(cx)},${f1(cy)})`);
          capBoxes.push([cx - h.capW / 2, cy - h.capH / 2, cx + h.capW / 2, cy + h.capH / 2]);
        }
        setA(h.cap, 'class', 'rg-hcap' + (on ? ' rg-on' : '') + (h.dimT ? ' rg-dim' : '') + (h.outT ? ' rg-out' : ''));
      }
      // 2. names. Priority: selected > hovered > the focus's neighbours > search hits > PCs > hostile and wary NPCs > degree
      const list = [];
      for (const n of nodes.values()) {
        let p = 20 + Math.min(25, n.deg * 3);
        if (n.type === 'pc') p = 70;
        else if (isPerson(n) && (n.d.attitude === 'hostile' || n.d.attitude === 'wary')) p = 50 + Math.min(15, n.deg);
        else if (n.type === 'faction') p = 45;
        if (n.hit) p = 85;
        if (fn && fn.nb.has(n.id)) p = 90;
        if (n.id === hoverId) p = 98; if (n.id === selId || (drag && drag.n === n)) p = 100;
        list.push([p, n]);
      }
      list.sort((a, b) => b[0] - a[0]);
      for (const [p, n] of list) {
        const forced = p >= 98, isF = n.id === selId || n.id === hoverId, pc = n.type === 'pc';
        const fs = isF ? 13 : 12, font = `${isF ? 700 : 600} ${fs}px ${sans}`;
        let on = n.sx != null && !(n.out && !n.hit) && !(n.type === 'faction' && hulls.has(n.id));   // territories carry the faction's name
        if (on && !compact && k < .3) on = p >= 85 || pc;
        // what it says: full name on hover/focus, a short name on a phone, two wrapped lines when zoomed in, else ≤ 20 characters
        let lines;
        if (isF) lines = wrap2(String(n.d.name || 'Unnamed'), font, 170);
        else if (egoMode && n.inFocus) { const t = labelName(n.d); lines = [t.length > 14 ? t.slice(0, 13).trimEnd() + '…' : t]; }
        else if (compact) lines = [phoneName(n.d)];
        else if (k >= 1) lines = wrap2(labelName(n.d), font, 120);
        else lines = [shortName(labelName(n.d))];
        setLines(n, lines);
        const w = Math.max(...lines.map(t => textWidth(t, font))), h = fs + (lines.length - 1) * 13;
        const r = n.sr || 0, sx = n.sx, sy = n.sy, dg = r * .72;
        const cand = (i, gap) => {
          switch (i) {
            case 0: return ['middle', sx, [sx - w / 2, sy + r + 4 + gap, sx + w / 2, sy + r + 4 + gap + h]];             // S
            case 1: return ['start', sx + dg + 3 + gap, [sx + dg + 3 + gap, sy + dg + 1, sx + dg + 3 + gap + w, sy + dg + 1 + h]];   // SE
            case 2: return ['end', sx - dg - 3 - gap, [sx - dg - 3 - gap - w, sy + dg + 1, sx - dg - 3 - gap, sy + dg + 1 + h]];     // SW
            case 3: return ['start', sx + r + 6 + gap, [sx + r + 6 + gap, sy - h / 2, sx + r + 6 + gap + w, sy + h / 2]];           // E
            case 4: return ['end', sx - r - 6 - gap, [sx - r - 6 - gap - w, sy - h / 2, sx - r - 6 - gap, sy + h / 2]];             // W
            case 5: return ['middle', sx, [sx - w / 2, sy - r - 4 - gap - h, sx + w / 2, sy - r - 4 - gap]];             // N
            case 6: return ['start', sx + dg + 3 + gap, [sx + dg + 3 + gap, sy - dg - 1 - h, sx + dg + 3 + gap + w, sy - dg - 1]];   // NE
            default: return ['end', sx - dg - 3 - gap, [sx - dg - 3 - gap - w, sy - dg - 1 - h, sx - dg - 3 - gap, sy - dg - 1]];   // NW
          }
        };
        if (decide) {
          n.lp = null;
          if (on) {
            const mine = b => {
              const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2, gap = (c, x, y) => Math.max(0, Math.hypot(clamp(x, b[0], b[2]) - c[0], clamp(y, b[1], b[3]) - c[1]) - c[2]);
              const own = gap([sx, sy, r], sx, sy);
              for (const d of circles) if (d[3] !== n && gap(d, d[0], d[1]) < own + 2 && Math.hypot(d[0] - cx, d[1] - cy) < Math.hypot(sx - cx, sy - cy)) return false;
              return true;
            };
            const ok = (b, strict) => inSafe(b) && !over(b, boxes, 3) && !over(b, capBoxes, 3) && !hitDisc(b, n, 4) && mine(b) && (!strict || !segHit(b));
            outer: for (const strict of [true, false]) for (const gap of [0, 6, 12]) for (let i = 0; i < 8; i++) { if (ok(cand(i, gap)[2], strict)) { n.lp = [i, gap]; break outer; } }
            if (!n.lp && forced) n.lp = [0, 0];
          }
        }
        on = on && !!n.lp;
        if (on) {
          const c = cand(n.lp[0], n.lp[1]), b = c[2];
          let x = c[1]; const dx = b[0] < s.l ? s.l - b[0] : b[2] > s.r ? s.r - b[2] : 0;     // never partly off the canvas
          x += dx; boxes.push([b[0] + dx, b[1], b[2] + dx, b[3]]);
          const y = b[1] + fs * .8;
          setA(n.lbl, 'y', f1(y)); setA(n.lbl, 'text-anchor', c[0]);
          for (const t of n.tsp) setA(t, 'x', f1(x));
        }
        setA(n.lbl, 'class', 'rg-lbl' + (pc ? ' rg-pc' : '') + (isF ? ' rg-focus' : '') + (n.d.status === 'dead' ? ' rg-faded' : '') + (on ? ' rg-on' : ''));
      }
      // 3. tie chips, horizontal and ON the line: always on the focused or hovered person's ties; on every tie when ≤ 40 show
      //    and zoom ≥ 0.9; otherwise on hostile ties only. Each slides along its own tie (25–75%) to clear other chips
      //    (6px) and discs (4px), and hides if nothing fits.
      let shown = 0; for (const l of links.values()) if (l.mid && !l.out && !(l.mhide && !l.nb) && !(l.dim && fsStrong)) shown++;
      const all = shown <= 40 && k >= .9;
      const chipBoxes = [], order = [];
      for (const l of links.values()) {
        const visible = l.mid && !l.out && !(l.mhide && !l.nb);
        const own = visible && (l.id === hoverLinkId || l.id === selLinkId || l.id === hlLinkId);
        const near = visible && fn && (l.a === fn || l.b === fn) && !legendKind;
        const want = visible && (own || near || (!l.dim && (all || l.ks.tone === 'hostile')));
        l.chipOn = false;
        if (want) order.push([own || near ? 1 : 0, l, own]);
        else setA(l.elbl, 'class', 'rg-elbl');
      }
      order.sort((a, b) => b[0] - a[0]);
      const steps = [.5, .45, .55, .4, .6, .35, .65, .3, .7, .25, .75];
      for (const [forced, l, own] of order) {
        setChipText(l, l.base);
        if (!own && l.room < l.pillW + 8 && l.short !== l.base) setChipText(l, l.short);   // too long for the tie: just the type
        const pw = l.pillW, ph = l.pillH, g = l.geo, at = t => { const p = qpt(g[0], g[1], g[2], g[3], g[4], g[5], t); return g2s(p[0], p[1]); };
        const box = c => [c[0] - pw / 2, c[1] - ph / 2, c[0] + pw / 2, c[1] + ph / 2];
        if (decide) {
          l.lt = null;
          for (const t of steps) { const b = box(at(t)); if (inSafe(b) && !over(b, chipBoxes, 6) && !over(b, boxes, 3) && !over(b, capBoxes, 3) && !hitDisc(b, null, 4)) { l.lt = t; break; } }
          if (l.lt == null && forced) l.lt = .5;
        }
        const on = l.lt != null;
        if (on) {
          const c = at(l.lt), b = box(c);
          chipBoxes.push(b);
          setA(l.elbl, 'transform', `translate(${f1(c[0])},${f1(c[1])})`);
        }
        setA(l.elbl, 'class', 'rg-elbl' + (on ? ' rg-on' : ''));
      }
    }

    // ---------- focus, filter and the classes they drive ----------
    const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    function focusNodeId() { return selId || (selLinkId ? null : hoverId); }
    function focusInfo() {
      if (legendKind) {
        const ls = new Set(), ns = new Set();
        for (const l of links.values()) if (l.d.kind === legendKind || (legendKind === '#secret' && l.d.secret) || (legendKind === '#ended' && l.d.ended)) { ls.add(l.id); ns.add(l.a.id); ns.add(l.b.id); }
        return { nodes: ns, links: ls, strong: false };
      }
      if (selLinkId && links.has(selLinkId)) { const l = links.get(selLinkId); return { nodes: new Set([l.a.id, l.b.id]), links: new Set([l.id]), strong: true }; }
      const id = focusNodeId(), n = id && nodes.get(id);
      if (n) return { nodes: new Set([n.id, ...n.nb]), links: new Set(n.links.map(l => l.id)), node: n.id, strong: id === selId };
      return null;
    }
    function applyClasses() {
      const fs = focusInfo(), q = fold(flt.query);
      for (const n of nodes.values()) {
        const typeOut = !!(flt.types && !flt.types.has(n.type));
        n.hit = !!q && !typeOut && fold(n.d.name).includes(q);
        n.out = typeOut || (!!q && !n.hit);
        n.inFocus = !!fs && fs.nodes.has(n.id);
        n.dim = !!fs && !n.inFocus;
        const cls = n.baseClass + (selId === n.id || connectTo === n.id ? ' rg-selected' : '') + (n.hit ? ' rg-hit' : '') + (hoverId === n.id ? ' rg-hovered' : '')
          + (n.out ? ' rg-out' : n.dim ? (fs.strong ? ' rg-dim' : ' rg-hdim') : '');
        if (n.stateClass !== cls) { n.stateClass = cls; n.el.setAttribute('class', cls); n.el.setAttribute('aria-pressed', selId === n.id ? 'true' : 'false'); }
      }
      for (const l of links.values()) {
        const d = l.d;
        l.out = !!(flt.kinds && !flt.kinds.has(d.kind)) || (flt.hideEnded && d.ended) ||
          !!(flt.types && (!flt.types.has(l.a.type) || !flt.types.has(l.b.type))) || (!!q && !l.a.hit && !l.b.hit);
        const inF = !!fs && fs.links.has(l.id);
        l.dim = !!fs && !inF; l.nb = inF && !!(fs.node || legendKind);
        const dimC = l.out ? ' rg-out' : l.dim ? (fs.strong ? ' rg-dim' : ' rg-hdim') : '';
        const cls = l.baseClass + dimC + (l.nb ? ' rg-nb' : '') + (l.id === hoverLinkId || l.id === hlLinkId ? ' rg-hov' : '')
          + (l.id === selLinkId ? ' rg-lsel' : '') + (l.mhide && !inF ? ' rg-mhide' : '');
        if (l.stateClass !== cls) { l.stateClass = cls; l.el.setAttribute('class', cls); }
      }
      for (const h of hulls.values()) {
        const out = h.nodes.every(m => m.out), dim = !!fs && fs.strong && !h.nodes.some(m => m.inFocus);
        const hot = (selId === h.fid || hoverId === h.fid) && !out;
        h.dimT = dim && !out; h.outT = out;
        const cls = 'rg-hull' + (out ? ' rg-out' : dim ? ' rg-dim' : '') + (hot ? ' rg-hot' : '');
        if (h.stateClass !== cls) { h.stateClass = cls; h.el.setAttribute('class', cls); }
      }
      forceLabels = true; kick();
    }

    // ---------- built-in legend (pages with their own pass legend: false) ----------
    let legendOpen = opts.legendOpen != null ? !!opts.legendOpen : null;
    function buildLegend() {
      if (!legend) return;
      const used = new Set(); let secret = false, ended = false;
      for (const l of links.values()) { used.add(l.d.kind); secret = secret || !!l.d.secret; ended = ended || !!l.d.ended; }
      const sig = th + [...used].sort().map(k => k + KS(k).color).join('|') + secret + ended;
      if (sig === legend._sig) return; legend._sig = sig;
      legend.textContent = '';
      if (!used.size) { legend.classList.add('rg-hide'); return; }
      legend.classList.remove('rg-hide');
      const h = document.createElement('h4'), hb = document.createElement('button'); hb.type = 'button';
      hb.textContent = 'Relationships'; icon('chev', 12, hb); h.appendChild(hb); legend.appendChild(h);
      if (legendOpen == null) legendOpen = H >= 560 && W >= 720;
      const setOpen = () => { legend.classList.toggle('rg-collapsed', !legendOpen); hb.setAttribute('aria-expanded', String(legendOpen)); };
      setOpen(); hb.onclick = () => { legendOpen = !legendOpen; setOpen(); };
      const ul = document.createElement('ul'); legend.appendChild(ul);
      const order = Object.keys(kinds || {}), rank = k => { const i = order.indexOf(k); return i < 0 ? 999 : i; };
      const row = (key, label, sw) => { const li = document.createElement('li'); li.dataset.kind = key; li.innerHTML = sw; const sp = document.createElement('span'); sp.textContent = label; li.appendChild(sp); ul.appendChild(li); };
      [...used].sort((a, b) => KS(b).layer - KS(a).layer || rank(a) - rank(b) || (a < b ? -1 : 1)).forEach(k => row(k, KS(k).label, swatch('link', k, kinds)));
      if (secret || ended) { const s = document.createElement('li'); s.className = 'rg-lsep'; ul.appendChild(s); }
      if (secret) row('#secret', 'Secret', swatch('mark', 'secret'));
      if (ended) row('#ended', 'Ended', swatch('mark', 'ended'));
    }

    // ---------- party-layout orbit guides ----------
    let orbitLbls = [];
    function partyExtent(list) { let m = 0; for (const n of list) { const [x, y] = finalXY(n); m = Math.max(m, Math.hypot(x, y) + n.r); } return m; }
    function drawOrbits() {
      root.classList.toggle('rg-party', mode === 'party');
      gOrbit.textContent = ''; gOrbitLbl.textContent = ''; orbitLbls = [];
      if (mode !== 'party') return;
      if (pcRing > 0) { el('circle', { r: pcRing + R.pc + 14, class: 'rg-orb-core' }, gOrbit); el('circle', { r: pcRing, class: 'rg-orb-pc' }, gOrbit); }
      const ext = partyExtent(live());
      for (const [att, label] of ORBIT_NAMES) {
        const r = orbitBase * ORBIT[att];
        if (r > ext + 30) continue;
        el('circle', { r, class: 'rg-orb-' + att }, gOrbit);
        const t = el('text', { class: 'rg-olbl' }, gOrbitLbl); t.textContent = label;
        orbitLbls.push({ r, el: t });
      }
      if (!REDUCED) {
        for (const g of [gOrbit, gOrbitLbl]) { g.style.opacity = '0'; g.style.transition = 'opacity .6s ease .2s'; }
        requestAnimationFrame(() => requestAnimationFrame(() => { gOrbit.style.opacity = ''; gOrbitLbl.style.opacity = ''; }));
      }
    }

    // ---------- interaction ----------
    const ptrs = new Map();
    let gesture = null, drag = null, lastTap = null, longTimer = 0, handleFor = null, connectTo = null;
    function localXY(e) { const b = root.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; }
    function targetOf(t) {
      if (t && t.closest) {
        if (t.closest('.rg-handle')) return { kind: 'handle' };
        const ne = t.closest('.rg-node'); if (ne) { const n = nodes.get(ne.getAttribute('data-id')); if (n) return { kind: 'node', n }; }
        const le = t.closest('.rg-link'); if (le) { const l = links.get(le.getAttribute('data-lid')); if (l) return { kind: 'link', l }; }
      }
      return { kind: 'bg' };
    }
    function nodeAt(cx, cy) { const t = targetOf(document.elementFromPoint(cx, cy)); return t.kind === 'node' ? t.n : null; }
    function setHover(nid, lid) {
      if (nid === hoverId && lid === hoverLinkId) return;
      hoverId = nid; hoverLinkId = lid;
      handleFor = nid && opts.onConnect && !drag && !compact ? nid : null;
      applyClasses();
    }
    function hoverFrom(e, x, y) {
      const tg = targetOf(e.target);
      let nid = tg.kind === 'node' ? tg.n.id : null; const lid = tg.kind === 'link' ? tg.l.id : null;
      if (tg.kind === 'handle') nid = handleFor;
      if (!nid && handleFor && nodes.has(handleFor)) {   // keep the connect handle while the pointer travels to it
        const n = nodes.get(handleFor), [sx, sy] = g2s(X(n), Y(n));
        if (Math.hypot(x - sx, y - sy) < n.ringOut * (n.s || 1) * cam.k + 30) nid = handleFor;
      }
      setHover(nid, nid ? null : lid);
    }
    function placeHandle() {
      const n = handleFor && nodes.get(handleFor);
      const show = !!n && (!gesture || gesture.type === 'connect');
      setA(handle, 'class', 'rg-handle' + (show ? ' rg-on' : ''));
      if (!n) return;
      const [sx, sy] = g2s(X(n), Y(n)), r = n.ringOut * (n.s || 1) * cam.k;
      handle.setAttribute('transform', `translate(${f1(sx + r + 13)},${f1(sy)})`);
    }
    function startDrag(n, sx, sy) {
      n.x += n.dx || 0; n.y += n.dy || 0; n.dx = n.dy = n.tdx = n.tdy = 0;   // a dragged node leaves the focus spread
      if (dispAnim) dispAnim.items = dispAnim.items.filter(it => it.n !== n);
      const [gx, gy] = s2g(sx, sy);
      drag = { n, ox: n.x - gx, oy: n.y - gy }; handleFor = null;
      root.classList.add('rg-dragging');
      if (navigator.vibrate && gesture && gesture.touch && !(navigator.userActivation && !navigator.userActivation.hasBeenActive)) { try { navigator.vibrate(8); } catch (_) { } }
      hoverId = n.id; applyClasses();
    }
    function finishDrag() {
      const n = drag && drag.n; drag = null; root.classList.remove('rg-dragging');
      if (!n || !nodes.has(n.id)) return;
      n.pinned = true;
      call('onMove', n.id, Math.round(n.x * 10) / 10, Math.round(n.y * 10) / 10);
      applyClasses();
    }
    function nodeClick(n) {
      const t = now();
      if (lastTap && lastTap.id === n.id && t - lastTap.t < 360) { lastTap = null; call('onOpen', n.id); return; }
      lastTap = { id: n.id, t };
      api.select(n.id); call('onSelect', n.id);
    }
    function pinchStart() {
      const [a, b] = [...ptrs.values()];
      if (gesture && gesture.type === 'drag') finishDrag();
      clearTimeout(longTimer);
      gesture = { type: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: [(a.x + b.x) / 2, (a.y + b.y) / 2], cam0: { ...cam } };
      root.classList.remove('rg-panning');
    }
    const onDown = e => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const [x, y] = localXY(e);
      ptrs.set(e.pointerId, { x, y });
      try { svg.setPointerCapture(e.pointerId); } catch (_) { }
      camAnim = null;
      if (ptrs.size === 2) { pinchStart(); return; }
      if (ptrs.size > 2) return;
      const tg = targetOf(e.target), touch = e.pointerType !== 'mouse';
      if (tg.kind === 'bg' || tg.kind === 'link') setHover(null, null);
      const base = { x0: x, y0: y, cam0: { ...cam }, touch };
      if (tg.kind === 'handle' && handleFor && nodes.has(handleFor)) { gesture = { ...base, type: 'connect', from: nodes.get(handleFor) }; hoverId = null; applyClasses(); }
      else if (tg.kind === 'node') {
        gesture = { ...base, type: 'node', n: tg.n };
        if (touch) longTimer = setTimeout(() => { if (gesture && gesture.type === 'node') { gesture.type = 'drag'; startDrag(gesture.n, gesture.x0, gesture.y0); } }, 380);
      } else if (tg.kind === 'link') gesture = { ...base, type: 'link', l: tg.l };
      else gesture = { ...base, type: 'bg' };
      e.preventDefault();
    };
    const onMoveP = e => {
      const [x, y] = localXY(e), p = ptrs.get(e.pointerId);
      if (!p) { if (e.pointerType !== 'touch') hoverFrom(e, x, y); return; }
      p.x = x; p.y = y;
      const g = gesture; if (!g) return;
      if (g.type === 'pinch') {
        if (ptrs.size < 2) return;
        const [a, b] = [...ptrs.values()], d = Math.hypot(a.x - b.x, a.y - b.y), m = [(a.x + b.x) / 2, (a.y + b.y) / 2];
        const k = clamp(g.cam0.k * d / g.d0, K_MIN, K_MAX), gx = (g.m0[0] - g.cam0.x) / g.cam0.k, gy = (g.m0[1] - g.cam0.y) / g.cam0.k;
        autoFit = false; cam.k = k; cam.x = m[0] - gx * k; cam.y = m[1] - gy * k; kick(); return;
      }
      const dist = Math.hypot(x - g.x0, y - g.y0), th2 = g.touch ? 8 : 3;
      if (g.type === 'node' && dist > th2) {
        if (g.touch) { clearTimeout(longTimer); g.type = 'pan'; root.classList.add('rg-panning'); }
        else { g.type = 'drag'; startDrag(g.n, g.x0, g.y0); }
      } else if ((g.type === 'bg' || g.type === 'link') && dist > th2) { g.type = 'pan'; root.classList.add('rg-panning'); }
      if (g.type === 'pan') { autoFit = false; cam.x = g.cam0.x + (x - g.x0); cam.y = g.cam0.y + (y - g.y0); kick(); }
      else if (g.type === 'drag' && drag) { const [gx, gy] = s2g(x, y); drag.n.x = gx + drag.ox; drag.n.y = gy + drag.oy; kick(); }
      else if (g.type === 'connect') {
        const f = g.from, [sx, sy] = g2s(X(f), Y(f)), ang = Math.atan2(y - sy, x - sx), r = f.ringOut * cam.k + 3;
        band.setAttribute('d', `M${f1(sx + Math.cos(ang) * r)},${f1(sy + Math.sin(ang) * r)}L${f1(x)},${f1(y)}`);
        bandDot.setAttribute('cx', f1(x)); bandDot.setAttribute('cy', f1(y)); bandDot.setAttribute('r', 4);
        const t = nodeAt(e.clientX, e.clientY), id = t && t !== f ? t.id : null;
        if (id !== connectTo) { connectTo = id; for (const n of nodes.values()) n.stateClass = null; applyClasses(); }
      }
    };
    const onUp = e => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId); clearTimeout(longTimer);
      const g = gesture;
      if (g && g.type === 'pinch') {
        if (ptrs.size === 1) { const r = [...ptrs.values()][0]; gesture = { type: 'pan', x0: r.x, y0: r.y, cam0: { ...cam }, touch: true }; }
        else { gesture = null; forceLabels = true; kick(); }
        return;
      }
      if (!g || ptrs.size) return;
      gesture = null; root.classList.remove('rg-panning');
      const cancel = e.type === 'pointercancel';
      if (g.type === 'drag') finishDrag();
      else if (cancel) { /* nothing */ }
      else if (g.type === 'node') nodeClick(g.n);
      else if (g.type === 'link') { api.selectLink(g.l.id); call('onSelectLink', g.l.id); }
      else if (g.type === 'bg') { lastTap = null; api.select(null); call('onSelect', null); }
      else if (g.type === 'connect') {
        band.setAttribute('d', ''); bandDot.setAttribute('r', 0);
        const to = connectTo; connectTo = null; for (const n of nodes.values()) n.stateClass = null;
        if (!cancel && to && to !== g.from.id) call('onConnect', g.from.id, to);
        applyClasses();
      }
      forceLabels = true; kick();
    };
    const onWheel = e => {
      e.preventDefault();
      const [x, y] = localXY(e), dy = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);
      zoomAt(x, y, Math.exp(-clamp(dy, -120, 120) * (e.ctrlKey ? .011 : .0022)), false);
    };
    svg.addEventListener('pointerdown', onDown);
    svg.addEventListener('pointermove', onMoveP);
    svg.addEventListener('pointerup', onUp);
    svg.addEventListener('pointercancel', onUp);
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('contextmenu', e => { if (gesture) e.preventDefault(); });
    root.addEventListener('pointerenter', () => { pointerInside = true; });
    root.addEventListener('pointerleave', () => { pointerInside = false; if (!gesture) setHover(null, null); });

    // keyboard: Tab walks the people; Enter selects (Enter again opens); +/- zoom; 0 fits; arrows pan
    root.addEventListener('keydown', e => {
      const ne = e.target.closest && e.target.closest('.rg-node'), n = ne && nodes.get(ne.getAttribute('data-id'));
      if (n && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        if (selId === n.id || e.shiftKey) call('onOpen', n.id); else { api.select(n.id); call('onSelect', n.id); }
        return;
      }
      if (e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === '+' || e.key === '=') { zoomAt(W / 2, H / 2, 1.3, true); e.preventDefault(); }
      else if (e.key === '-' || e.key === '_') { zoomAt(W / 2, H / 2, 1 / 1.3, true); e.preventDefault(); }
      else if (e.key === '0') { api.fit(true); e.preventDefault(); }
      else if (e.target === root && /^Arrow/.test(e.key)) {
        const st = 80, d = { ArrowLeft: [st, 0], ArrowRight: [-st, 0], ArrowUp: [0, st], ArrowDown: [0, -st] }[e.key];
        autoFit = false; setCam({ k: cam.k, x: cam.x + d[0], y: cam.y + d[1] }, true, 200); e.preventDefault();
      }
    });
    gNode.addEventListener('focusin', e => {
      const ne = e.target.closest('.rg-node'), n = ne && nodes.get(ne.getAttribute('data-id'));
      if (!n) return;
      if (!onScreen(n, 40)) api.panTo(n.id);
      if (!ptrs.size) setHover(n.id, null);
    });
    gNode.addEventListener('focusout', () => { if (!ptrs.size) setHover(null, null); });
    const onDocKey = e => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (!(pointerInside || root.contains(document.activeElement))) return;
      if (gesture && gesture.type === 'connect') { gesture = null; band.setAttribute('d', ''); bandDot.setAttribute('r', 0); connectTo = null; applyClasses(); e.preventDefault(); return; }
      if (selId || selLinkId) { e.preventDefault(); api.select(null); call('onSelect', null); }
    };
    document.addEventListener('keydown', onDocKey);
    if (ctl) ctl.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.dataset.act === 'plus') zoomAt(W / 2, H / 2, 1.4, true);
      else if (b.dataset.act === 'minus') zoomAt(W / 2, H / 2, 1 / 1.4, true);
      else api.fit(true);
    });
    if (legend) {
      legend.addEventListener('pointerover', e => { const li = e.target.closest('li[data-kind]'), k = li ? li.dataset.kind : null; if (k !== legendKind) { legendKind = k; applyClasses(); } });
      legend.addEventListener('pointerleave', () => { if (legendKind) { legendKind = null; applyClasses(); } });
    }
    // theme flips live: tie colours, faction hues and label contrast are recomputed for the new theme
    function restyle() {
      th = themeKey(); sansCache = dispCache = null;
      derive();
      for (const n of nodes.values()) classNode(n);
      buildHulls();
      for (const l of links.values()) styleLink(l);
      if (legend) { legend._sig = null; buildLegend(); }
      applyClasses();
    }
    const themeObs = new MutationObserver(() => { if (themeKey() !== th) restyle(); });
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (destroyed) return; widthCache.clear(); sansCache = dispCache = null; for (const l of links.values()) { l.chipText = null; styleLink(l); } buildHulls(); applyClasses(); });

    // ---------- public API ----------
    function measure() {
      const b = root.getBoundingClientRect(); W = Math.round(b.width); H = Math.round(b.height);
      compact = W > 0 && W < 640; root.classList.toggle('rg-compact', compact);
      return W > 0 && H > 0 && H > W * 1.15;
    }
    const toSet = v => v == null ? null : v instanceof Set ? v : new Set([].concat(v));
    const api = {
      update(data) {
        if (destroyed || !data) return;
        const unplaced = ingest(data, true);
        if (mode === 'party') sizeRings();
        const lm = looseMode(), free = new Set(unplaced);
        if (lm) for (const n of nodes.values()) if (n.loose && !n.pinned) free.add(n.id);
        if (free.size || mode === 'web') relayout(free, { animate: true, place: true });
        if (mode === 'party') drawOrbits();
        if (selId && !nodes.has(selId)) selId = null;
        if (selLinkId && !links.has(selLinkId)) selLinkId = null;
        computeDisp(true);
        applyClasses(); render();
      },
      select(id, o) {
        const frame = !o || o.frame !== false;
        id = id == null ? null : String(id);
        selId = id && nodes.has(id) ? id : null; selLinkId = null;
        computeDisp(true);
        applyClasses();
        const n = selId && nodes.get(selId);
        if (n && (frame || egoMode)) {      // remember the view from before the focus, so deselecting can go back to it
          if (!camBefore) camBefore = { x: cam.x, y: cam.y, k: cam.k, auto: autoFit };
          autoFit = false; setCam(focusCam(n), true, egoMode ? 300 : 350);
        } else if (!n && camBefore) { const c = camBefore; camBefore = null; autoFit = c.auto; setCam(c.auto ? fitFor(live()) : c, true, 300); }
      },
      selectLink(id) {
        id = id == null ? null : String(id);
        selLinkId = id && links.has(id) ? id : null; selId = null;
        computeDisp(true); applyClasses();
        const l = selLinkId && links.get(selLinkId);
        if (l && !(onScreen(l.a, 40) && onScreen(l.b, 40))) { autoFit = false; setCam(frameFor([l.a, l.b], 96, 1.6), true, 450); }
      },
      highlightLink(id) {
        id = id == null ? null : String(id);
        hlLinkId = id && links.has(id) ? id : null;
        applyClasses();
      },
      filter(f) {
        f = f || {};
        flt = { kinds: toSet(f.kinds), types: toSet(f.types), query: f.query || '', hideEnded: !!f.hideEnded };
        applyClasses();
      },
      flyTo(id) { const n = nodes.get(String(id)); if (n) centreOn(n, clamp(Math.max(cam.k, 1.2), .3, 1.8), 650); },
      panTo(id) { const n = nodes.get(String(id)); if (n) centreOn(n, cam.k, 300); },
      pulse(id) { const n = nodes.get(String(id)); if (!n || REDUCED) return; n.pulse = { t0: now() }; kick(); },
      fit(animate) { measure(); if (!W || !H) return; fitted = true; autoFit = true; setCam(fitFor(live()), animate !== false, 720); },
      setInsets(o, animate) {
        o = o || {}; let changed = false;
        for (const k of ['top', 'right', 'bottom', 'left']) {
          const v = Number.isFinite(+o[k]) ? Math.max(0, +o[k]) : ins[k];
          if (v !== ins[k]) { ins[k] = v; changed = true; }
        }
        if (!changed || !W) { forceLabels = true; kick(); return; }
        const anim = animate !== false, n = selId && nodes.get(selId);
        if (autoFit) setCam(fitFor(live()), anim, 300);
        else if (n) { if (egoMode) computeDisp(anim); setCam(focusCam(n), anim, 300); }
        else { const t = nudgeCam(); if (t) setCam(t, anim, 300); }
        forceLabels = true; kick();
      },
      layout(m) {
        mode = m === 'party' ? 'party' : 'web';
        sizeRings();
        const free = new Set(live().filter(n => !n.pinned).map(n => n.id));
        relayout(free, { animate: true, fit: true, ticks: 360, dur: 900 });
        drawOrbits();
        applyClasses(); render();
      },
      unpin(id) {
        const n = nodes.get(String(id)); if (!n) return;
        n.pinned = false;
        relayout(new Set([n.id]), { animate: true, place: false, ticks: 220 });
      },
      resize() {
        if (destroyed) return;
        const ow = W, oh = H, wasPortrait = portrait;
        portrait = measure();
        if (!W || !H) return;
        if (fitted && portrait !== wasPortrait && mode === 'web') {     // the container changed shape: lay out for it
          relayout(new Set(live().filter(n => !n.pinned).map(n => n.id)), { animate: true, fit: autoFit, place: false, ticks: 260 });
          return;
        }
        if (ow === W && oh === H && fitted) return;
        if (!fitted && (compact || portrait) && mode === 'web') {   // first real size is a phone or portrait: lay out for it
          fitted = true; relayout(new Set(live().filter(n => !n.pinned).map(n => n.id)), { animate: false, place: false, ticks: 260 });
          setCam(fitFor(live()), false); return;
        }
        if (!fitted || autoFit) { fitted = true; camAnim = null; setCam(fitFor(live()), false); return; }
        cam.x += (W - ow) / 2; cam.y += (H - oh) / 2; forceLabels = true; kick();
      },
      destroy() {
        if (destroyed) return;
        destroyed = true; if (raf) cancelAnimationFrame(raf); raf = 0; clearTimeout(longTimer); clearTimeout(labelTimer);
        if (ro) ro.disconnect(); themeObs.disconnect();
        document.removeEventListener('keydown', onDocKey);
        root.remove(); nodes.clear(); links.clear(); hulls.clear();
      },
      positions() {
        const out = {};
        for (const n of nodes.values()) out[n.id] = { x: Math.round(n.x * 10) / 10, y: Math.round(n.y * 10) / 10, pinned: !!n.pinned };
        return out;
      },
      factionColors() {
        const out = {};
        for (const n of nodes.values()) if (n.type === 'faction' && n.hullColor) out[n.id] = n.hullColor;
        return out;
      }
    };

    // ---------- first paint ----------
    const ro = window.ResizeObserver ? new ResizeObserver(() => api.resize()) : null;
    if (ro) ro.observe(root);
    portrait = measure();
    const unplaced0 = ingest(opts, false);
    sizeRings();
    const free0 = new Set(unplaced0);
    if (looseMode()) for (const n of nodes.values()) if (n.loose && !n.pinned) free0.add(n.id);
    if (free0.size) relayout(free0, { animate: false });
    applyClasses();
    if (W && H) { fitted = true; setCam(fitFor(live()), false); }
    render();
    return api;
  }

  return { mount, swatch, ATTITUDES, _helpers: { convexHull, chaikin, blobPath, curve, qpt, tAtRadius, qsub, initials, labelName, phoneName, wrap2, shortName, hash, readable, capInk, contrast: (a, b) => contrast(rgb(a), rgb(b)), kindStyle } };
})();
