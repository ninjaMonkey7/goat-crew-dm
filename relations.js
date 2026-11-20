/* relations.js — Relationships (DM only): a living web of the player characters, NPCs and factions the party meets.
   relations-graph.js (RelGraph) draws the web; this file is everything around it: search, filters and legend, the
   profile / relationship panel, quick add, saving (data/relations.json through gh.js /api/relations…), undo and live
   updates from the other DM. People are the PCs (characters.json) and the Codex's NPCs and factions (codex.json),
   plus any other Codex entry someone is linked to. On a phone (and whenever the web can't be drawn) there is a list view.
   Names here start rl / RL_ (gh.js already has rel*). app.js calls renderRelations(), relEscape(), relFocusSearch()
   and relNewPerson(). */
'use strict';

/* ---------- vocabulary ---------- */
/* Kinds of relationship. Colour says one thing only, friend or foe: warm ties green, rivals pink, enemies red (and
   heavier), structural ties grey. Which kind it is lives in the words: the web's edge chips, the profile sentences.
   color: dark theme, light: light theme. directed: naturally one-way (A serves B, A owes B), so a new one starts as A → B.
   rel / out / in: how a profile reads a tie from one end (both ways / one way from A / one way from B).
   say(a, b, oneWay): the form's sentence. ph: label placeholder. */
const RL_WARM = ['#34D399', '#059669'], RL_STRUCT = ['#8B8B94', '#71717A'];
const REL_KINDS = {
  ally: { label: 'Ally', color: RL_WARM[0], light: RL_WARM[1], tone: 'warm', rel: 'Ally of', out: 'Backs', in: 'Backed by', ph: 'e.g. sworn to protect each other',
    say: (a, b, one) => one ? `${a} backs ${b}` : `${a} and ${b} are allies` },
  friend: { label: 'Friend', color: RL_WARM[0], light: RL_WARM[1], tone: 'warm', rel: 'Friend of', out: 'Friend to', in: 'Befriended by', ph: 'e.g. childhood friends',
    say: (a, b, one) => one ? `${a} is a friend to ${b}` : `${a} and ${b} are friends` },
  family: { label: 'Family', color: RL_WARM[0], light: RL_WARM[1], tone: 'warm', rel: 'Family of', out: 'Family to', in: 'Family of', ph: 'e.g. sister, uncle',
    say: (a, b, one) => one ? `${a} is family to ${b}` : `${a} and ${b} are family` },
  romance: { label: 'Romance', color: RL_WARM[0], light: RL_WARM[1], tone: 'warm', rel: 'Romance with', out: 'Loves', in: 'Loved by', ph: 'e.g. secret letters',
    say: (a, b, one) => one ? `${a} loves ${b}` : `${a} and ${b} are romantically involved` },
  rival: { label: 'Rival', color: '#FDA4AF', light: '#F87171', tone: 'hostile', rel: 'Rival of', out: 'Rivals', in: 'Rivalled by', ph: 'e.g. both want the captaincy',
    say: (a, b, one) => one ? `${a} sees ${b} as a rival` : `${a} and ${b} are rivals` },
  enemy: { label: 'Enemy', color: '#EF4444', light: '#B91C1C', tone: 'hostile', rel: 'Enemy of', out: 'Hates', in: 'Hated by', ph: 'e.g. swore revenge',
    say: (a, b, one) => one ? `${a} hates ${b}` : `${a} and ${b} are enemies` },
  serves: { label: 'Serves', color: RL_STRUCT[0], light: RL_STRUCT[1], tone: 'structural', directed: true, rel: 'Works with', out: 'Serves', in: 'Served by', ph: 'e.g. bodyguard, spy',
    say: (a, b, one) => one ? `${a} serves ${b}` : `${a} and ${b} work together` },
  owes: { label: 'Owes', color: RL_STRUCT[0], light: RL_STRUCT[1], tone: 'structural', directed: true, rel: 'Shares debts with', out: 'Owes', in: 'Owed by', ph: 'e.g. 50 gp, a favour',
    say: (a, b, one) => one ? `${a} owes ${b}` : `${a} and ${b} owe each other` },
  member: { label: 'Member', color: RL_STRUCT[0], light: RL_STRUCT[1], tone: 'structural', rel: 'Member of', out: 'Member of', in: 'Has member', ph: 'e.g. captain, new recruit',
    say: (a, b) => `${a} is a member of ${b}` },
  knows: { label: 'Knows', color: RL_STRUCT[0], light: RL_STRUCT[1], tone: 'structural', rel: 'Knows', out: 'Knows of', in: 'Known to', ph: 'e.g. drinking buddies',
    say: (a, b, one) => one ? `${a} knows of ${b}` : `${a} and ${b} know each other` }
};
const RL_KIND_LIST = Object.keys(REL_KINDS);
const RL_TONES = [['warm', 'Warm'], ['hostile', 'Hostile'], ['structural', 'Structural']];
const RL_TONE_RANK = { hostile: 0, warm: 1, structural: 2 };          // a profile lists foes first
const RL_TONE_GROUP = { hostile: 'Foes', warm: 'Allies & kin', structural: 'Structural' };
// attitude to the party. The stored key stays 'ally'; people read "Loyal" (so it never reads as the tie "Ally").
// RelGraph.ATTITUDES (when the web provides it) is the one source of the labels and ring colours.
const RL_ATT = [['ally', 'Loyal'], ['friendly', 'Friendly'], ['neutral', 'Neutral'], ['wary', 'Wary'], ['hostile', 'Hostile'], ['unknown', 'Unknown']];
const RL_ATT_SCALE = ['hostile', 'wary', 'neutral', 'friendly', 'ally', 'unknown'];   // foe → friend, then "?" (keys 1–6)
const RL_STATUS = [['alive', 'Alive'], ['dead', 'Dead'], ['missing', 'Missing'], ['unknown', 'Unknown']];
const RL_TYPE_LABEL = { pc: 'Player character', npc: 'NPC', faction: 'Faction' };
const RL_LINK_KEYS = ['a', 'b', 'kind', 'label', 'dir', 'note', 'since', 'ended', 'secret'];
const RL_FACTION_HUES = ['#60A5FA', '#22D3EE', '#E879F9', '#A78BFA', '#94A3B8', '#818CF8']; // until the web says which is whose
const RL_MAX_TIES = 8;                                                // a profile shows this many, then "Show n more"
const RL_PHONE = matchMedia('(max-width: 639px)');
// phones and tablets (any width, either way up) and short windows: the legend always starts folded, whatever was saved
const RL_FOLD_LEGEND = matchMedia('(pointer: coarse), (max-height: 520px)');
const RL_TITLES = new Set(['the', 'a', 'an', 'of', 'captain', 'sergeant', 'lady', 'lord', 'sir', 'dame', 'brother', 'sister', 'old', 'mayor', 'baron',
  'baroness', 'king', 'queen', 'prince', 'princess', 'duke', 'duchess', 'master', 'mistress', 'doctor', 'dr', 'saint', 'st', 'father', 'mother']);
// icons the shared set doesn't have (Lucide, ISC)
Object.entries({
  arrowright: '<path d="M5 12h14" /><path d="m12 5 7 7-7 7" />',
  arrowleft: '<path d="m12 19-7-7 7-7" /><path d="M19 12H5" />',
  swapv: '<path d="m21 16-4 4-4-4" /><path d="M17 20V4" /><path d="m3 8 4-4 4 4" /><path d="M7 4v16" />',
  pinoff: '<path d="M12 17v5" /><path d="M15 9.34V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H7.89" /><path d="m2 2 20 20" /><path d="M9 9v1.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h11" />',
  unlink: '<path d="m18.84 12.25 1.72-1.71h-.02a5.004 5.004 0 0 0-.12-7.07 5.006 5.006 0 0 0-6.95 0l-1.72 1.71" /><path d="m5.17 11.75-1.71 1.71a5.004 5.004 0 0 0 .12 7.07 5.006 5.006 0 0 0 6.95 0l1.71-1.71" /><line x1="8" x2="8" y1="2" y2="5" /><line x1="2" x2="5" y1="8" y2="8" /><line x1="16" x2="16" y1="19" y2="22" /><line x1="19" x2="22" y1="16" y2="16" />',
  hexagon: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />',
  usercircle: '<path d="M18 20a6 6 0 0 0-12 0" /><circle cx="12" cy="10" r="4" /><circle cx="12" cy="12" r="10" />',
  filter: '<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />',
  list: '<path d="M3 12h.01" /><path d="M3 18h.01" /><path d="M3 6h.01" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M8 6h13" />',
  layers: '<path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" /><path d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" /><path d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />',
  chevup: '<path d="m18 15-6-6-6 6" />',
  crosshair: '<circle cx="12" cy="12" r="10" /><line x1="22" x2="18" y1="12" y2="12" /><line x1="6" x2="2" y1="12" y2="12" /><line x1="12" x2="12" y1="6" y2="2" /><line x1="12" x2="12" y1="22" y2="18" />'
}).forEach(([k, v]) => { if (!ICONS[k]) ICONS[k] = v; });

/* ---------- page state (UI only; the data lives in gh.js RAW) ---------- */
const RLS = {
  g: null, root: null, stage: null, view: null, list: null, panelEl: null, data: null, model: null, mute: 0,
  panel: null,                 // { mode: 'person' | 'link' | 'add' | 'cleanup', id }
  dirty: false,                // a form in the panel has unsaved changes (the add-person popover keeps its own: qdirty)
  accept: null,                // while an add form is open: fn(nodeId) → true when a click on the web filled a person field
  pop: null,                   // the open popover: { el, anchor, close }
  sel: null, query: '', kinds: null, types: new Set(['pc', 'npc', 'faction']), showEnded: false, layout: 'web', legend: false,
  mode: 'web',                 // 'web' or 'list' (the list is the phone's default, and the fallback)
  legendHeld: false,           // the legend folded itself while the panel is open
  sheet: 'half', moreTies: false, insKey: '', insExtra: null, fcol: {}, partyOpen: false, legendMore: false,
  moves: {}, moveT: 0, q: Promise.resolve(), imgs: {}, undo: null, liveT: 0, soonT: 0, statusT: 0, session: 0, flash: null
};
(() => { // per-browser view settings (the legend starts folded; the DM's own choice is remembered)
  try {
    const p = JSON.parse(localStorage.getItem('gc_rel') || '{}');
    if (Array.isArray(p.types) && p.types.length) RLS.types = new Set(p.types.filter(t => RL_TYPE_LABEL[t]));
    if (!RLS.types.size) RLS.types = new Set(['pc', 'npc', 'faction']);
    RLS.showEnded = !!p.showEnded; RLS.layout = p.layout === 'party' ? 'party' : 'web'; RLS.legend = p.legend === true && !RL_FOLD_LEGEND.matches;
    RLS.phoneMode = p.phoneMode === 'web' ? 'web' : 'list';
  } catch (_) { RLS.phoneMode = 'list'; }
})();
function rlSavePrefs() { try { localStorage.setItem('gc_rel', JSON.stringify({ types: [...RLS.types], showEnded: RLS.showEnded, layout: RLS.layout, legend: RLS.legend, phoneMode: RLS.phoneMode })); } catch (_) { /* private mode */ } }

/* ---------- small helpers ---------- */
const rlDark = () => document.documentElement.dataset.theme !== 'light';
const rlPhone = () => RL_PHONE.matches;
const rlColor = k => { const d = REL_KINDS[k] || REL_KINDS.knows; return rlDark() ? d.color : d.light; };
/* what the web gets: the agreed shape, with color already the current theme's (so an older web that only reads color is right too) */
const rlKinds = () => Object.fromEntries(RL_KIND_LIST.map(k => { const d = REL_KINDS[k]; return [k, { label: d.label, color: rlDark() ? d.color : d.light, dark: d.color, light: d.light, tone: d.tone, directed: !!d.directed }]; }));
const rlNorm = s => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();
const rlOther = (l, id) => (l.a === id ? l.b : l.a);
const rlNode = id => (RLS.model && RLS.model.byId.get(id)) || null;
const rlNameOf = id => { const n = rlNode(id); return n ? n.name : 'someone'; };
const rlPlural = (n, one, many) => `${n} ${n === 1 ? one : many || one + 's'}`;
const rlLive = () => !!(RLS.root && RLS.root.isConnected);
const rlHas = name => !!(RLS.g && typeof RLS.g[name] === 'function');
function rlInitials(name) {
  let w = String(name || '').replace(/["“”(][^"“”)]*["“”)]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (w.length > 1) { const core = w.filter(x => !RL_TITLES.has(x.toLowerCase())); if (core.length) w = core; }
  return (w.length ? (w.length === 1 ? w[0].slice(0, 2) : w[0][0] + w[w.length - 1][0]) : '?').toUpperCase();
}
function rlExcerpt(text, max = 420) {
  const s = String(text || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<[^>]+>/g, '').trim();
  if (s.length <= max) return s;
  return s.slice(0, s.lastIndexOf(' ', max) > max * 0.6 ? s.lastIndexOf(' ', max) : max).replace(/[\s,.;:–—-]+$/, '') + '…';
}
/* a faction's colour: the web's (it tints the hull and the hexagon), else a fixed one from the same six */
function rlFactionColor(id) {
  if (RLS.fcol[id]) return RLS.fcol[id];
  const facs = RLS.model ? RLS.model.nodes.filter(n => n.type === 'faction').map(n => n.id).sort() : [];
  const i = facs.indexOf(id);
  return RL_FACTION_HUES[(i < 0 ? 0 : i) % RL_FACTION_HUES.length];
}
function rlReadFactionColors() {
  RLS.fcol = {};
  if (rlHas('factionColors')) { try { Object.assign(RLS.fcol, RLS.g.factionColors() || {}); } catch (_) { /* older graph */ } }
}
/* Avatar: portrait, else initials (until the portrait has loaded). Ring = attitude to the party (NPCs and factions); a PC's
   is gold; a faction is a hexagon in its own colour. sizes: xs 24, sm 28, md 32, lg 48 */
function rlAv(n, size = 'md') {
  if (!n) return `<span class="rl-av ${size} t-other" aria-hidden="true"><span>?</span></span>`;
  const cls = `rl-av ${size} t-${n.type}${n.type !== 'pc' ? ' a-' + (n.attitude || 'unknown') : ''}${n.status === 'dead' ? ' dead' : ''}`;
  const url = rlImg(n.path), fc = n.type === 'faction' ? ` style="--fc:${rlFactionColor(n.id)}"` : '';
  return `<span class="${cls}"${fc} aria-hidden="true"${n.path && !url ? ` data-img="${esc(n.path)}"` : ''}>${url ? `<img src="${esc(url)}" alt="">` : `<span>${esc(rlInitials(n.name))}</span>`}</span>`;
}
const rlTypeLabel = n => (n.type === 'other' ? String((n.entry && n.entry.category) || 'Codex entry').replace(/^./, c => c.toUpperCase()) : RL_TYPE_LABEL[n.type]);
/* How a profile reads a link from one end. A member link points at the faction whichever way it was drawn. */
function rlPhrase(l, selfId) {
  const k = REL_KINDS[l.kind] || REL_KINDS.knows, selfA = l.a === selfId;
  if (l.kind === 'member') {
    const me = rlNode(selfId), them = rlNode(rlOther(l, selfId));
    const meGroup = me && me.type === 'faction', themGroup = them && them.type === 'faction';
    if (themGroup && !meGroup) return 'Member of';
    if (meGroup && !themGroup) return 'Member';
    return selfA ? 'Member of' : 'Has member';
  }
  return l.dir === 'ab' ? (selfA ? k.out : k.in) : '';
}
function rlSay(a, b, kind, dir) {
  const k = REL_KINDS[kind]; if (!k) return '';
  if (kind === 'member') { const na = rlNodeOrNew(a), nb = rlNodeOrNew(b); if (na && na.type === 'faction' && !(nb && nb.type === 'faction')) [a, b] = [b, a]; }
  return k.say(`<b>${esc(rlLabelOf(a))}</b>`, `<b>${esc(rlLabelOf(b))}</b>`, dir === 'ab');
}
const rlNodeOrNew = v => (v && typeof v === 'object' ? { type: v.category === 'faction' ? 'faction' : 'npc', name: v.create } : rlNode(v));
const rlLabelOf = v => (v && typeof v === 'object' ? v.create : rlNameOf(v));
/* the faction someone belongs to (their first member tie to one), for the list view and the add-person chips */
function rlFactionOf(id) {
  const m = RLS.model; if (!m) return null;
  for (const l of m.links) {
    if (l.kind !== 'member' || (l.a !== id && l.b !== id)) continue;
    const o = rlNode(rlOther(l, id));
    if (o && o.type === 'faction' && o.id !== id) return o;
  }
  return null;
}
const rlTieSort = selfId => (x, y) => (x.ended - y.ended) || (RL_TONE_RANK[(REL_KINDS[x.kind] || {}).tone] ?? 3) - (RL_TONE_RANK[(REL_KINDS[y.kind] || {}).tone] ?? 3)
  || RL_KIND_LIST.indexOf(x.kind) - RL_KIND_LIST.indexOf(y.kind) || rlNameOf(rlOther(x, selfId)).localeCompare(rlNameOf(rlOther(y, selfId)));
const rlTone = k => (REL_KINDS[k] || REL_KINDS.knows).tone;
/* attitude words and colours: the web's table when it has one */
const rlAttTable = () => (typeof RelGraph !== 'undefined' && RelGraph && RelGraph.ATTITUDES) || null;
const rlAttName = k => { const t = rlAttTable(); return (t && t[k] && t[k].label) || (RL_ATT.find(a => a[0] === k) || [, 'Unknown'])[1]; };
/* what a sentence calls someone: a nickname in quotes, else the first word that isn't a title; a faction keeps its name */
function rlShort(n) {
  if (!n) return 'someone';
  if (n.type === 'faction' || n.type === 'other') return n.name;
  const nick = /["“]([^"”]+)["”]/.exec(n.name); if (nick) return nick[1];
  const w = n.name.split(/\s+/).filter(Boolean), core = w.filter(x => !RL_TITLES.has(x.toLowerCase()));
  return (core[0] || w[0] || n.name);
}
/* One tie as a sentence from one end: "Serves Anna", "Informant to Anna", "Treasurer of The River Guild",
   "Friend of Bo · old shipmates", "Owes Cal 50 gp". withLabel false: the short form for chips. */
function rlTieLine(l, selfId, withLabel = true) {
  const k = REL_KINDS[l.kind] || REL_KINDS.knows, selfA = l.a === selfId, o = rlNode(rlOther(l, selfId)), me = rlNode(selfId);
  const who = rlShort(o), lab = withLabel ? String(l.label || '').trim() : '', cap = s => s.charAt(0).toUpperCase() + s.slice(1), one = l.dir === 'ab';
  if (l.kind === 'serves' && one) return selfA ? (lab ? `${cap(lab)} to ${who}` : `Serves ${who}`) : `Served by ${who}${lab ? ` (${lab})` : ''}`;
  if (l.kind === 'owes' && one) { const amt = lab.replace(/^owes\s+/i, ''); return selfA ? `Owes ${who}${amt ? ' ' + amt : ''}` : `Owed${amt ? ' ' + amt : ''} by ${who}`; }
  if (l.kind === 'member') {
    const meGroup = me && me.type === 'faction', themGroup = o && o.type === 'faction';
    if (themGroup && !meGroup) return `${lab ? cap(lab) : 'Member'} of ${o.name}`;
    if (meGroup && !themGroup) return lab ? `${cap(lab)} of the faction` : 'Member';
    return selfA ? `Member of ${who}` : `Has member ${who}`;
  }
  const base = one ? `${selfA ? k.out : k.in} ${who}` : `${k.rel} ${who}`;
  return lab ? `${base} · ${lab}` : base;
}

/* ---------- legend swatches: the web draws them (same strokes, dashes and rings it uses); a plain fallback otherwise ---------- */
function rlSwatch(type, key) {
  if (typeof RelGraph !== 'undefined' && RelGraph && typeof RelGraph.swatch === 'function') {
    try { const s = RelGraph.swatch(type, key, rlKinds()); if (s) return s; } catch (_) { /* fall back */ }
  }
  if (type === 'link') {
    const d = REL_KINDS[key] || REL_KINDS.knows, w = d.tone === 'hostile' ? 3 : d.tone === 'warm' ? 2 : 1.5, op = key === 'knows' ? .6 : d.tone === 'structural' ? .8 : 1;
    return `<svg width="22" height="8" viewBox="0 0 22 8" aria-hidden="true"><line x1="2" y1="4" x2="${d.directed ? 16 : 20}" y2="4" stroke="${rlColor(key)}" stroke-width="${w + 1}" stroke-linecap="round" opacity="${op}"/>${d.directed ? `<path d="M15 1 L21 4 L15 7 Z" fill="${rlColor(key)}" opacity="${op}"/>` : ''}</svg>`;
  }
  if (type === 'attitude') {
    const w = { ally: 3, hostile: 3, friendly: 2.5, wary: 2.5, neutral: 2, unknown: 1.5 }[key] || 2;
    return `<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">${key === 'ally' ? '<circle cx="8" cy="8" r="7.2" fill="none" style="stroke:var(--att-ally)" stroke-width="1.2" opacity=".35"/>' : ''}<circle cx="8" cy="8" r="${key === 'ally' ? 4.6 : 5.6}" fill="none" style="stroke:var(--att-${key})" stroke-width="${w}"${key === 'unknown' ? ' stroke-dasharray="2.4 2.4"' : ''}/></svg>`;
  }
  const marks = {
    hidden: '<circle cx="8" cy="8" r="7" style="fill:var(--bg3)"/><path d="M4.5 8s1.3-2.4 3.5-2.4S11.5 8 11.5 8 10.2 10.4 8 10.4 4.5 8 4.5 8Z" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="m4.6 4.6 6.8 6.8" stroke="currentColor" stroke-width="1.2"/>',
    dead: '<circle cx="8" cy="8" r="6" style="fill:var(--bg3)" opacity=".55"/><path d="m3 13 10-10" stroke="currentColor" stroke-width="1.2"/>',
    missing: '<circle cx="8" cy="8" r="7" style="fill:var(--bg3)"/><text x="8" y="11.3" text-anchor="middle" font-size="9.5" font-weight="700" fill="currentColor" font-family="var(--sans)">?</text>',
    secret: '<line x1="1" y1="8" x2="21" y2="8" stroke="currentColor" stroke-width="2" stroke-dasharray="5 4"/>',
    ended: '<line x1="1" y1="8" x2="21" y2="8" stroke="currentColor" stroke-width="2" opacity=".3"/><path d="m9 11 2-6m1 6 2-6" stroke="currentColor" stroke-width="1.2"/>'
  };
  const wide = key === 'secret' || key === 'ended';
  return `<svg width="${wide ? 22 : 16}" height="16" viewBox="0 0 ${wide ? 22 : 16} 16" aria-hidden="true">${marks[key] || ''}</svg>`;
}

/* ---------- data → model ---------- */
async function rlFetch() {
  const [doc, codex, chars] = await Promise.all([api('/api/relations'), load('codex'), load('characters')]);
  return { doc: doc || { links: [], people: {} }, codex: codex || [], chars: chars || [] };
}
/* Nodes: every PC, every Codex NPC and faction, and any other Codex entry with a link. Links whose ends are gone
   (a deleted Codex entry or character) are kept aside as `dangling`, hidden and offered for clean-up. */
function rlBuild(data) {
  const people = (data.doc && data.doc.people) || {}, linksIn = (data.doc && Array.isArray(data.doc.links) ? data.doc.links : []).filter(l => l && l.id);
  const linked = new Set(); for (const l of linksIn) { linked.add(l.a); linked.add(l.b); }
  const nodes = [];
  const add = (id, base) => {
    const meta = people[id] || {}, mv = RLS.moves[id];
    const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
    nodes.push({ ...base, id, meta, attitude: base.type === 'pc' ? null : (meta.attitude || 'unknown'), status: meta.status || 'alive',
      x: mv ? mv.x : num(meta.x), y: mv ? mv.y : num(meta.y), pinned: mv ? true : !!meta.pinned });
  };
  for (const c of data.chars) if (c && c.id) add('pc:' + c.id, { name: c.name || 'Unnamed', type: 'pc', path: c.portrait || '', revealed: true, char: c });
  for (const e of data.codex) {
    if (!e || !e.id) continue;
    const type = e.category === 'npc' ? 'npc' : e.category === 'faction' ? 'faction' : 'other';
    if (type === 'other' && !linked.has('codex:' + e.id)) continue;
    add('codex:' + e.id, { name: e.name || 'Unnamed', type, path: e.image || '', revealed: !!e.revealed, entry: e });
  }
  const byId = new Map(nodes.map(n => [n.id, n]));
  const links = [], dangling = [];
  for (const l of linksIn) (byId.has(l.a) && byId.has(l.b) && l.a !== l.b && REL_KINDS[l.kind] ? links : dangling).push(l);
  const deg = new Map(); for (const l of links) { deg.set(l.a, (deg.get(l.a) || 0) + 1); deg.set(l.b, (deg.get(l.b) || 0) + 1); }
  for (const n of nodes) n.deg = deg.get(n.id) || 0;
  return { nodes, byId, links, dangling };
}
/* Private images come through gh.js media() as blob URLs; the web and the avatars get them once loaded. */
function rlImg(path) {
  if (!path) return null;
  if (/^(https?:|data:|blob:)/.test(path)) return path;
  if (!/^media\//.test(path)) return null;
  const hit = RLS.imgs[path];
  if (hit === undefined) {
    RLS.imgs[path] = 'wait';
    media(path).then(u => {
      RLS.imgs[path] = u; rlSoon();
      document.querySelectorAll('.rl-av[data-img]').forEach(a => { if (a.dataset.img === path) { a.removeAttribute('data-img'); a.innerHTML = `<img src="${esc(u)}" alt="">`; } });
    }).catch(() => { RLS.imgs[path] = 'fail'; });
    return null;
  }
  return hit === 'wait' || hit === 'fail' ? null : hit;
}
function rlGraphData() {
  const m = RLS.model;
  return {
    nodes: m.nodes.map(n => ({ id: n.id, name: n.name, type: n.type, img: rlImg(n.path), attitude: n.attitude, status: n.status, revealed: n.revealed, x: n.x, y: n.y, pinned: n.pinned })),
    links: m.links.map(l => ({ id: l.id, a: l.a, b: l.b, kind: l.kind, label: l.label || '', dir: l.dir === 'ab' ? 'ab' : 'both', ended: !!l.ended, secret: !!l.secret })),
    kinds: rlKinds()
  };
}
function rlPush() {
  if (RLS.g) { try { RLS.g.update(rlGraphData()); } catch (e) { console.error('relations graph', e); } rlReadFactionColors(); }
  if (RLS.mode === 'list' || !RLS.g) rlPaintList();
}
function rlSoon() { clearTimeout(RLS.soonT); RLS.soonT = setTimeout(() => { if (rlLive() && RLS.model) rlPush(); }, 120); }
/* the web's own selection calls back into us: mute those echoes while we set it */
function rlMuted(fn) { if (!RLS.g) return; RLS.mute++; try { fn(RLS.g); } catch (e) { console.error(e); } finally { RLS.mute--; } }
function rlSelect(id, frame) { rlMuted(g => g.select(id, { frame: !!frame })); }
function rlFilter() {
  const types = new Set(RLS.types); if (types.has('npc')) types.add('other'); // places and things ride with the NPCs
  if (RLS.g) rlMuted(g => g.filter({ kinds: RLS.kinds ? new Set(RLS.kinds) : null, types, query: RLS.query, hideEnded: !RLS.showEnded }));
  if (RLS.mode === 'list' || !RLS.g) rlPaintList();
}
/* Writes run one after another, so two quick edits never race each other into a conflict. */
function rlWrite(fn) { const run = RLS.q.then(fn, fn); RLS.q = run.catch(() => {}); return run; }
/* The web keeps people clear of the chrome: the toolbar on top, the panel on the right (a sheet at the bottom on a phone), the
   legend in its corner (to its right when open, above it as a chip), and the add-person popover while it's open. Real
   overlaps only, each at most 45% of the canvas, sent whenever one of them changes size. Nothing while the list hides the web. */
function rlInsets(animate = true) {
  if (!rlLive() || !rlHas('setInsets') || RLS.mode === 'list') return;
  const W = RLS.root.clientWidth, H = RLS.root.clientHeight; if (!W || !H) return;
  const top = RLS.root.querySelector('.rl-top'), ins = { top: top.offsetTop + top.offsetHeight + 16, right: 20, bottom: 20, left: 20 };
  const p = RLS.panelEl, panel = p && !p.hidden;
  const sheet = panel && rlPhone();
  if (sheet) { // the sheet's real top: its layout height (not the box mid slide-in) or, mid-drag or mid-snap, where it is now
    const pr = p.getBoundingClientRect(), rr = RLS.root.getBoundingClientRect();
    ins.bottom = Math.round(Math.max(p.offsetHeight, rr.bottom - pr.top)) + 16;
  } else if (panel) ins.right = p.offsetWidth + 20; // layout size, not the box mid slide-in
  const lg = RLS.root.querySelector('#rl-legend');
  if (lg && !lg.hidden && !lg.classList.contains('sheet') && !(panel && rlPhone())) {
    if (lg.classList.contains('closed')) ins.bottom = Math.max(ins.bottom, lg.offsetHeight + 16 + 16); // the chip
    else ins.left = Math.max(ins.left, lg.offsetLeft + lg.offsetWidth + 20);
  }
  if (RLS.insExtra) for (const [k, v] of Object.entries(RLS.insExtra)) ins[k] = Math.max(ins[k], v);
  ins.top = Math.round(Math.min(ins.top, H * .45));
  ins.bottom = Math.round(Math.min(ins.bottom, sheet ? H - ins.top - 24 : H * .45)); // the sheet is sent whole; keep a sliver of web
  for (const k of ['left', 'right']) ins[k] = Math.round(Math.min(ins[k], W * .45));
  const key = JSON.stringify(ins); if (key === RLS.insKey) return;
  RLS.insKey = key;
  rlMuted(g => g.setInsets(ins, animate));
}

/* ---------- the page ---------- */
async function renderRelations(c) {
  rlTeardown();
  const [data, journal] = await Promise.all([rlFetch(), api('/api/journal', { quiet: true }).catch(() => [])]);
  RLS.session = Math.max(0, ...(journal || []).map(e => Number(e.session) || 0));
  RLS.data = data; RLS.model = rlBuild(data);
  c.innerHTML = `<div class="rl" id="rl">
    <div class="rl-stage" id="rl-stage"></div>
    <div class="rl-list" id="rl-list" hidden></div>
    <div class="rl-view" id="rl-view">
      <div class="rl-top">
        <div class="rl-seg rl-mode" role="radiogroup" aria-label="View">
          <button type="button" role="radio" data-mode="list" aria-checked="false" aria-label="List">${ic('list')}<span>List</span></button>
          <button type="button" role="radio" data-mode="web" aria-checked="false" aria-label="Web">${ic('waypoints')}<span>Web</span></button>
          <button type="button" role="radio" data-mode="party" aria-checked="false" aria-label="Party">${ic('users')}<span>Party</span></button>
        </div>
        <div class="rl-search-slot"><div class="rl-search">
          ${ic('search', 'rl-search-ic')}
          <input id="rl-q" type="text" placeholder="Find someone…" autocomplete="off" spellcheck="false" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="rl-sugg" aria-label="Find someone">
          <kbd class="rl-kbd" aria-hidden="true">/</kbd>
          <div class="rl-sugg" id="rl-sugg" role="listbox" aria-label="People" hidden></div>
        </div></div>
        <div class="rl-tools" role="toolbar" aria-label="What the web shows">
          <button type="button" class="rl-chipbtn rl-filterbtn" id="rl-filterbtn" aria-haspopup="dialog" aria-expanded="false" aria-label="Filter" data-tip="Who and which ties the web shows">${ic('filter')}<span>Filter</span><b class="rl-badge" id="rl-filter-n" hidden></b></button>
          <div class="rl-seg rl-layout" role="radiogroup" aria-label="Layout">
            <button type="button" role="radio" data-layout="web" aria-checked="false" aria-label="Web" data-tip="Everyone, arranged by who knows whom">${ic('waypoints')}<span>Web</span></button>
            <button type="button" role="radio" data-layout="party" aria-checked="false" aria-label="Party" data-tip="The party in the middle, everyone else by attitude">${ic('users')}<span>Party</span></button>
          </div>
          <button type="button" class="rl-iconbtn" id="rl-fit" aria-label="Fit everyone in view" data-tip="Fit everyone in view">${ic('maximize')}</button>
        </div>
        <div class="rl-actions">
          <button type="button" class="btn rl-act rl-act-link" id="rl-add-link" aria-label="Add relationship" data-tip="Add relationship">${ic('link')}</button>
          <button type="button" class="btn primary rl-act" id="rl-add-person" aria-haspopup="dialog" aria-expanded="false" aria-label="Add a person" data-tip="Add an NPC or faction  N">${ic('plus', 'rl-wide')}${ic('userplus', 'rl-narrow')}<span>Person</span></button>
        </div>
      </div>
      <div class="rl-legend" id="rl-legend"></div>
      <div class="rl-empty" id="rl-empty" hidden></div>
      <div class="rl-foot"><div class="rl-note" id="rl-note" hidden></div><div class="rl-status" id="rl-status" role="status" aria-live="polite"></div></div>
    </div>
    <aside class="rl-panel" id="rl-panel" aria-label="Details" hidden></aside>
    <div class="rl-scrim" id="rl-scrim" hidden></div>
  </div>`;
  RLS.root = c.querySelector('#rl'); RLS.stage = c.querySelector('#rl-stage'); RLS.view = c.querySelector('#rl-view');
  RLS.list = c.querySelector('#rl-list'); RLS.panelEl = c.querySelector('#rl-panel');
  RLS.mode = rlPhone() ? RLS.phoneMode : 'web';
  rlBindChrome();
  rlMount();
  rlApplyMode();
  rlPaintChrome();
  RLS.insKey = ''; requestAnimationFrame(() => rlInsets(false));
  RLS.ro = new ResizeObserver(() => { rlFitToolbar(); clearTimeout(RLS.roT); RLS.roT = setTimeout(() => rlInsets(true), 80); });
  RLS.ro.observe(RLS.view);
  // come back to whoever was open last time
  if (RLS.panel && RLS.panel.mode === 'person' && rlNode(RLS.panel.id)) rlOpenPerson(RLS.panel.id, { frame: false });
  else if (RLS.panel && RLS.panel.mode === 'link' && RLS.model.links.some(l => l.id === RLS.panel.id)) rlOpenLink(RLS.panel.id);
  else RLS.panel = null;
}
function rlMount() {
  if (typeof RelGraph === 'undefined' || !RelGraph || typeof RelGraph.mount !== 'function') { RLS.g = null; return; }
  try {
    RLS.g = RelGraph.mount(RLS.stage, {
      ...rlGraphData(),
      legend: false, controls: false, // this page's legend is also the kind filter, and it has its own Fit button
      onSelect: id => { if (!RLS.mute) rlOnSelect(id); },
      onSelectLink: id => { if (!RLS.mute) rlOnSelectLink(id); },
      onMove: (id, x, y) => rlOnMove(id, x, y),
      onConnect: (a, b) => rlOnConnect(a, b),
      onOpen: id => { if (!RLS.mute) rlOnOpen(id); }
    });
  } catch (e) { console.error('relations graph', e); RLS.g = null; return; }
  // an older web can't keep clear of an overlaid panel: the canvas narrows instead
  RLS.root.classList.toggle('rl-split', !rlHas('setInsets'));
  rlReadFactionColors();
  rlFilter();
  if (RLS.layout === 'party') rlMuted(g => g.layout('party'));
}
function rlTeardown() {
  if (Object.keys(RLS.moves).length) rlFlushMoves();
  rlPopClose();
  if (RLS.ro) { RLS.ro.disconnect(); RLS.ro = null; }
  if (RLS.g) { try { RLS.g.destroy(); } catch (e) { console.error(e); } }
  RLS.g = null; RLS.root = null; RLS.stage = null; RLS.view = null; RLS.list = null; RLS.panelEl = null; RLS.accept = null; RLS.dirty = false;
}
// leaving the page (another tab renders into #content): stop the web and save any unsaved positions
new MutationObserver(() => { if (RLS.root && !RLS.root.isConnected) rlTeardown(); }).observe(document.getElementById('content'), { childList: true });
// theme switch: the kinds' colours follow it
new MutationObserver(() => { if (rlLive()) { rlPush(); rlPaintChrome(); } }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
addEventListener('pagehide', () => { if (Object.keys(RLS.moves).length) rlFlushMoves(); });
RL_PHONE.addEventListener('change', () => {
  if (!rlLive()) return;
  RLS.mode = rlPhone() ? RLS.phoneMode : 'web';
  rlLegendSheet(false); rlApplyMode(); rlPaintChrome();
  if (RLS.panelEl && !RLS.panelEl.hidden) rlSheetApply();
  RLS.insKey = ''; rlInsets(false);
});

/* List or web. The list is the phone's default (the web is one tap away) and the whole page when the web can't load.
   On a phone, List | Web | Party is one control; elsewhere Web | Party is the layout switch. */
function rlApplyMode() {
  if (!rlLive()) return;
  if (!RLS.g) RLS.mode = 'list';
  const list = RLS.mode === 'list';
  RLS.root.classList.toggle('rl-mode-list', list);
  RLS.root.classList.toggle('rl-nograph', !RLS.g);
  RLS.list.hidden = !list;
  const cur = list ? 'list' : RLS.layout === 'party' ? 'party' : 'web';
  RLS.root.querySelectorAll('.rl-mode [data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === cur)));
  const q = RLS.root.querySelector('#rl-q'); if (q) q.placeholder = rlPhone() ? 'Find…' : 'Find someone…';
  if (list) rlPaintList();
  else if (RLS.g) requestAnimationFrame(() => rlMuted(g => { g.resize(); }));
}
/* The toolbar is one row that never wraps: fold it a step at a time until it fits. Wide: search to an icon, then Web | Party,
   "Filter" and "+ Person" lose their words. Phone: List | Web | Party goes to icons once the search box would be too small to
   type in. Measured, so it suits whatever the labels are. */
const RL_FOLDS = { wide: ['rl-c-search', 'rl-c-seg', 'rl-c-filter', 'rl-c-person'], phone: ['rl-c-seg'] };
function rlFitToolbar() {
  if (!rlLive()) return;
  const v = RLS.view, top = v.querySelector('.rl-top'), phone = rlPhone(), steps = RL_FOLDS[phone ? 'phone' : 'wide'], slot = v.querySelector('.rl-search-slot');
  const tight = () => top.scrollWidth > top.clientWidth + 1 || (phone && slot.offsetWidth < 96);
  const set = n => RL_FOLDS.wide.forEach(c => { const i = steps.indexOf(c); v.classList.toggle(c, i > -1 && i < n); });
  if (RLS.foldN !== undefined && v.querySelector('.rl-search:focus-within, .rl-search.has-q')) return; // an open search overlaps on purpose
  let n = 0; set(0);
  while (n < steps.length && tight()) set(++n);
  RLS.foldN = n;
}
function rlSetLayout(layout) {
  if (RLS.layout === layout) return;
  RLS.layout = layout; rlSavePrefs(); rlPaintChrome(); rlMuted(g => g.layout(layout));
}

/* ---------- popovers: the attitude and status pickers, the filter menu, add person ---------- */
/* rlPop(anchor, html, { cls, align: 'start' | 'end', width }) → the popover element. One at a time; outside click or Esc closes. */
function rlPop(anchor, html, { cls = '', align = 'start', width = 0, onClose, keepOn, canClose } = {}) {
  rlPopClose();
  if (!rlLive()) return null;
  const el = document.createElement('div');
  el.className = `rl-pop ${cls}`; el.setAttribute('role', 'dialog');
  el.innerHTML = html;
  // toolbar popovers live in the toolbar's container (its width decides what the filter menu holds); the panel's on the page
  const host = RLS.view && RLS.view.contains(anchor) ? RLS.view : RLS.root;
  host.appendChild(el);
  const place = () => {
    const r = host.getBoundingClientRect(), a = anchor.getBoundingClientRect();
    const w = Math.min(width || el.offsetWidth, r.width - 16);
    if (width) el.style.width = w + 'px';
    let left = align === 'end' ? a.right - r.left - w : a.left - r.left;
    left = Math.max(8, Math.min(left, r.width - w - 8));
    let top = a.bottom - r.top + 8;
    if (top + el.offsetHeight > r.height - 8 && a.top - r.top - 8 - el.offsetHeight > 8) top = a.top - r.top - 8 - el.offsetHeight; // no room below: above
    el.style.left = left + 'px'; el.style.top = Math.max(8, top) + 'px';
  };
  place();
  anchor.setAttribute('aria-expanded', 'true'); anchor.classList.add('rl-open');
  const outside = e => { if (!el.contains(e.target) && !anchor.contains(e.target) && !(e.target.closest && e.target.closest('.rl-pop')) && !(keepOn && keepOn(e.target))) close(); };
  const close = (refocus, ask) => {
    if (!el.isConnected) return;
    if (ask && canClose && !canClose()) return;
    el.remove(); anchor.setAttribute('aria-expanded', 'false'); anchor.classList.remove('rl-open');
    document.removeEventListener('pointerdown', outside, true);
    if (RLS.pop && RLS.pop.el === el) RLS.pop = null;
    if (refocus && anchor.isConnected) anchor.focus({ preventScroll: true });
    if (onClose) onClose();
  };
  el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true, true); } });
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
  RLS.pop = { el, anchor, close, place };
  return el;
}
function rlPopClose(refocus, ask) { if (RLS.pop) RLS.pop.close(refocus, ask); }
/* The attitude or status picker behind a chip: one tap, arrow keys move, Enter picks */
function rlPickPop(anchor, field, id) {
  const n = rlNode(id); if (!n) return;
  const list = field === 'attitude' ? RL_ATT_SCALE.map(k => [k, rlAttName(k)]) : RL_STATUS, cur = field === 'attitude' ? (n.attitude || 'unknown') : (n.status || 'alive');
  const el = rlPop(anchor, `<div class="rl-pick" role="radiogroup" aria-label="${field === 'attitude' ? 'Attitude to the party' : 'Status'}">
      ${field === 'attitude' ? '<div class="rl-pick-h">Attitude to the party</div>' : ''}
      ${list.map(([v, l]) => `<button type="button" role="radio" class="rl-pick-o s-${v}" data-v="${v}" aria-checked="${v === cur}">${field === 'attitude' ? '<i aria-hidden="true"></i>' : ''}<span>${l}</span>${v === cur ? ic('check', 'rl-pick-ck') : ''}</button>`).join('')}
    </div>`, { cls: 'rl-pop-pick' });
  if (!el) return;
  const xs = [...el.querySelectorAll('[role="radio"]')];
  (xs.find(x => x.dataset.v === cur) || xs[0]).focus();
  el.addEventListener('keydown', e => {
    const i = xs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); xs[(i + (e.key === 'ArrowDown' ? 1 : -1) + xs.length) % xs.length].focus(); }
  });
  el.addEventListener('click', async e => {
    const b = e.target.closest('[data-v]'); if (!b) return;
    rlPopClose(true);
    if (b.dataset.v === cur) return;
    await rlSavePerson(id, { [field]: b.dataset.v });
    const again = RLS.panelEl && (RLS.panelEl.querySelector(`.rp-head [data-pop="${field}"]`) || RLS.panelEl.querySelector(`[data-pop="${field}"]`));
    if (again) again.focus({ preventScroll: true });
  });
}

/* ---------- toolbar, legend, notices ---------- */
function rlBindChrome() {
  const root = RLS.root, q = root.querySelector('#rl-q'), sugg = root.querySelector('#rl-sugg'), box = root.querySelector('.rl-search');
  root.addEventListener('click', e => {
    if (e.target.closest('.rl-pop')) return; // menus handle their own rows
    const lay = e.target.closest('.rl-layout [data-layout]');
    if (lay) return rlSetLayout(lay.dataset.layout);
    const md = e.target.closest('.rl-mode [data-mode]'); // the panel carries a data-mode of its own
    if (md) {
      const m = md.dataset.mode, mode = m === 'list' ? 'list' : 'web';
      if (m !== 'list') rlSetLayout(m);
      if (mode !== RLS.mode) { RLS.mode = RLS.phoneMode = mode; rlSavePrefs(); rlApplyMode(); rlPaintChrome(); RLS.insKey = ''; rlInsets(false); }
      else rlApplyMode();
    }
  });
  root.querySelector('#rl-fit').onclick = () => rlMuted(g => g.fit(true));
  const fb = root.querySelector('#rl-filterbtn');
  fb.onclick = () => (RLS.pop && RLS.pop.anchor === fb ? rlPopClose(true) : rlFilterPop(fb));
  root.querySelector('#rl-add-person').onclick = e => (RLS.pop && RLS.pop.anchor === e.currentTarget ? rlPopClose(true, true) : rlOpenQuick());
  root.querySelector('#rl-add-link').onclick = () => rlOpenAdd({ a: RLS.panel && RLS.panel.mode === 'person' ? RLS.panel.id : null });
  root.querySelector('#rl-scrim').onclick = () => rlLegendSheet(false);
  // search: type-ahead that frames the person; the web dims everyone else while you type. Folded to an icon on a narrow canvas.
  let act = 0, hits = [];
  const close = () => { sugg.hidden = true; q.setAttribute('aria-expanded', 'false'); q.removeAttribute('aria-activedescendant'); };
  const paint = () => {
    const v = q.value.trim();
    box.classList.toggle('has-q', !!v);
    hits = rlMatch(v, 7);
    const exact = hits.some(n => rlNorm(n.name) === rlNorm(v));
    if (!v) { close(); return; }
    act = Math.max(0, Math.min(act, hits.length - (exact ? 1 : 0)));
    sugg.innerHTML = hits.map((n, i) => `<div class="rl-opt${i === act ? ' on' : ''}" role="option" id="rl-opt-${i}" aria-selected="${i === act}" data-i="${i}">
        ${rlAv(n, 'sm')}<span class="rl-opt-name">${rlMark(n.name, v)}</span><span class="rl-opt-meta">${esc(rlTypeLabel(n))}${n.deg ? ` · ${n.deg}` : ''}${!RLS.types.has(n.type === 'other' ? 'npc' : n.type) ? ' · filtered out' : ''}</span></div>`).join('')
      + (exact ? '' : `<div class="rl-opt rl-opt-new${act === hits.length ? ' on' : ''}" role="option" id="rl-opt-${hits.length}" aria-selected="${act === hits.length}" data-i="${hits.length}">${ic('plus')}<span class="rl-opt-name">Add “${esc(v)}” as a new person</span></div>`)
      + (hits.length ? '' : `<div class="rl-opt-none">Nobody called that yet.</div>`);
    sugg.hidden = false; q.setAttribute('aria-expanded', 'true'); q.setAttribute('aria-activedescendant', 'rl-opt-' + act);
  };
  const choose = i => {
    const v = q.value.trim();
    q.value = ''; RLS.query = ''; box.classList.remove('has-q'); close(); rlFilter();
    if (i < hits.length) { q.blur(); rlGoTo(hits[i].id, { focus: true }); }
    else if (v) rlOpenQuick({ name: v });
  };
  let ft = 0;
  q.addEventListener('input', () => { act = 0; paint(); clearTimeout(ft); ft = setTimeout(() => { RLS.query = q.value.trim(); rlFilter(); }, 90); });
  q.addEventListener('focus', () => { if (q.value.trim()) paint(); });
  q.addEventListener('blur', () => setTimeout(close, 120));
  q.addEventListener('keydown', e => {
    const n = hits.length + (sugg.querySelector('.rl-opt-new') ? 1 : 0);
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); act = (act + 1) % n; paint(); }
    else if (e.key === 'ArrowUp' && n) { e.preventDefault(); act = (act - 1 + n) % n; paint(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (q.value.trim()) choose(act); }
    else if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation();
      if (q.value) { q.value = ''; RLS.query = ''; box.classList.remove('has-q'); close(); rlFilter(); } else q.blur();
    }
  });
  sugg.addEventListener('mousedown', e => { const o = e.target.closest('[data-i]'); if (o) { e.preventDefault(); choose(Number(o.dataset.i)); } });
}
function rlToggleType(t, btn) {
  if (RLS.types.has(t) && RLS.types.size === 1) { if (btn) { btn.classList.remove('rl-nope'); void btn.offsetWidth; btn.classList.add('rl-nope'); } return; } // keep at least one
  if (RLS.types.has(t)) RLS.types.delete(t); else RLS.types.add(t);
  rlSavePrefs(); rlFilter(); rlPaintChrome();
}
function rlToggleEnded() { RLS.showEnded = !RLS.showEnded; rlSavePrefs(); rlFilter(); rlPaintChrome(); }
const rlUsedKinds = () => RL_KIND_LIST.filter(k => RLS.model && RLS.model.links.some(l => l.kind === k));
const rlKindOn = k => !RLS.kinds || RLS.kinds.has(k);
/* the valence toggles: all of a family's kinds on or off together (at least one kind stays on) */
function rlToggleTone(tone) {
  const used = rlUsedKinds(), ks = used.filter(k => rlTone(k) === tone); if (!ks.length) return;
  const cur = new Set(RLS.kinds || used), allOn = ks.every(k => cur.has(k));
  ks.forEach(k => (allOn ? cur.delete(k) : cur.add(k)));
  if (!cur.size) return;
  RLS.kinds = used.every(k => cur.has(k)) ? null : cur;
  rlFilter(); rlPaintChrome(); rlRepaintPop();
}
function rlToggleKind(k) {
  const used = rlUsedKinds(), cur = new Set(RLS.kinds || used);
  if (cur.has(k)) cur.delete(k); else cur.add(k);
  if (!cur.size) return;
  RLS.kinds = used.every(x => cur.has(x)) ? null : cur;
  rlFilter(); rlPaintChrome(); rlRepaintPop();
}
function rlRepaintPop() { if (RLS.pop && RLS.pop.repaint) RLS.pop.repaint(); }
/* how many things the filters hide, for the badge on "Filter": people types, plus a family of ties switched off as one or,
   when only part of a family is off, each kind in it */
function rlFilterCount() {
  if (!RLS.model) return 0;
  const used = rlUsedKinds();
  return 3 - RLS.types.size + RL_TONES.reduce((n, [t]) => { const ks = used.filter(k => rlTone(k) === t), off = ks.filter(k => !rlKindOn(k)).length;
    return n + (off && off === ks.length ? 1 : off); }, 0);
}
/* Filter: who the web shows, which ties (the three families and every kind in them) and ended ties, with counts. The list
   only filters by who, so in list mode it gets just that part. */
function rlFilterPop(anchor) {
  const html = () => {
    const m = RLS.model, used = rlUsedKinds(), web = RLS.mode !== 'list', ended = m.links.filter(l => l.ended).length;
    const cnt = k => m.links.filter(l => l.kind === k && (RLS.showEnded || !l.ended)).length;
    const row = (attr, on, lead, label, n, cls = '') => `<button type="button" class="rl-frow${cls}" ${attr} aria-pressed="${on}">${lead}<span>${label}</span><b class="rl-n">${n}</b>${ic('check', 'rl-fck')}</button>`;
    const who = ['pc', 'npc', 'faction'].map(t => row(`data-ptype="${t}"`, RLS.types.has(t), t === 'faction' ? ic('hexagon', 'rl-glyph-hex') : `<i class="rl-glyph g-${t}" aria-hidden="true"></i>`,
      { pc: 'Player characters', npc: 'NPCs', faction: 'Factions' }[t], m.nodes.filter(n => n.type === t).length)).join('');
    const ties = RL_TONES.map(([t, name]) => { const ks = used.filter(k => rlTone(k) === t); if (!ks.length) return ''; const on = ks.filter(rlKindOn).length;
      return `<button type="button" class="rl-frow rl-frow-tone" data-ptone="${t}" aria-pressed="${on === ks.length}" ${on && on < ks.length ? 'data-mixed' : ''}><span class="rl-tsw ts-${t}" aria-hidden="true"></span><span>${name}</span><b class="rl-n">${ks.reduce((a, k) => a + cnt(k), 0)}</b>${ic('check', 'rl-fck')}</button>`
        + ks.map(k => row(`data-pkind="${k}"`, rlKindOn(k), '', REL_KINDS[k].label, cnt(k), ' rl-frow-kind')).join(''); }).join('');
    return `<div class="rl-fpop">
      <div class="rl-fpop-sec"><h5>Show</h5>${who}</div>
      ${web && ties ? `<div class="rl-fpop-sec"><h5>Ties</h5>${ties}</div>` : ''}
      ${web && (ended || RLS.showEnded) ? `<div class="rl-fpop-sec">${row('data-pended', RLS.showEnded, ic('clock'), 'Show ended ties', ended)}</div>` : ''}
      ${rlFilterCount() ? '<div class="rl-fpop-sec"><button type="button" class="rl-linkish rl-fpop-all" data-pall>Clear filters</button></div>' : ''}
    </div>`;
  };
  const el = rlPop(anchor, html(), { cls: 'rl-pop-filter', width: 280 });
  if (!el) return;
  // repaint in place: keep the scroll and the focused row
  RLS.pop.repaint = () => {
    const a = el.contains(document.activeElement) ? document.activeElement : null, sc = el.scrollTop;
    const at = a && [...a.attributes].find(x => /^data-p/.test(x.name)), sel = at && (at.value ? `[${at.name}="${at.value}"]` : `[${at.name}]`);
    el.innerHTML = html(); el.scrollTop = sc;
    const b = (sel && el.querySelector(sel)) || (a && el.querySelector('button')); if (b) b.focus({ preventScroll: true });
  };
  el.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    const d = b.dataset;
    if (d.ptype) rlToggleType(d.ptype, b); else if (d.ptone) rlToggleTone(d.ptone); else if (d.pkind) rlToggleKind(d.pkind);
    else if ('pended' in d) rlToggleEnded();
    else if ('pall' in d) { RLS.types = new Set(['pc', 'npc', 'faction']); RLS.kinds = null; rlSavePrefs(); rlFilter(); rlPaintChrome(); }
    else return;
    rlRepaintPop();
  });
  const f = el.querySelector('button'); if (f) f.focus({ preventScroll: true });
}
/* best matches first: name starts with it, then a word does, then anywhere; the party before the rest on a tie */
function rlMatch(q, limit = 8, exclude, filter) {
  const nq = rlNorm(q).trim(); if (!nq || !RLS.model) return [];
  const out = [];
  for (const n of RLS.model.nodes) {
    if ((exclude && exclude.has(n.id)) || (filter && !filter(n))) continue;
    const nm = rlNorm(n.name), i = nm.indexOf(nq);
    if (i < 0) continue;
    out.push([i === 0 ? 0 : /[\s"'(-]/.test(nm[i - 1]) ? 1 : 2, n]);
  }
  return out.sort((x, y) => x[0] - y[0] || (x[1].type === 'pc' ? 0 : 1) - (y[1].type === 'pc' ? 0 : 1) || y[1].deg - x[1].deg || x[1].name.localeCompare(y[1].name)).slice(0, limit).map(x => x[1]);
}
function rlMark(name, q) {
  const nn = rlNorm(name), i = nn.indexOf(rlNorm(q).trim());
  if (i < 0 || !q.trim()) return esc(name);
  const j = i + rlNorm(q).trim().length;
  return `${esc(name.slice(0, i))}<mark>${esc(name.slice(i, j))}</mark>${esc(name.slice(j))}`;
}
/* Counts, toggles, legend, the clean-up notice and the empty state: everything that depends on the data or the filters. */
function rlPaintChrome() {
  if (!rlLive()) return;
  const m = RLS.model, root = RLS.root, dark = rlDark();
  for (const k of RL_KIND_LIST) root.style.setProperty('--rk-' + k, rlColor(k));
  root.style.setProperty('--rv-warm', dark ? RL_WARM[0] : RL_WARM[1]); root.style.setProperty('--rv-structural', dark ? RL_STRUCT[0] : RL_STRUCT[1]);
  root.style.setProperty('--rv-hostile', rlColor('enemy')); root.style.setProperty('--rv-rival', rlColor('rival'));
  const at = rlAttTable(); if (at) for (const [k, v] of Object.entries(at)) root.style.setProperty('--att-' + k, dark ? v.color : (v.light || v.color));
  const nf = rlFilterCount(), fb = root.querySelector('#rl-filterbtn'), badge = root.querySelector('#rl-filter-n');
  badge.textContent = nf || ''; badge.hidden = !nf;
  fb.classList.toggle('on', !!nf); fb.setAttribute('aria-label', nf ? `Filter, ${nf} hidden` : 'Filter');
  root.querySelectorAll('.rl-layout [data-layout]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.layout === RLS.layout)));
  const cur = RLS.mode === 'list' ? 'list' : RLS.layout;
  root.querySelectorAll('.rl-mode [data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === cur)));
  rlPaintLegend();
  rlFitToolbar();
  // links to deleted entries: hidden, offered for clean-up
  const note = root.querySelector('#rl-note'), dn = m.dangling.length;
  note.hidden = !dn;
  if (dn) {
    note.innerHTML = `${ic('unlink')}<span>${rlPlural(dn, 'tie')} ${dn === 1 ? 'points' : 'point'} at someone who was deleted</span><button type="button" class="rl-linkish" id="rl-clean">Review</button>`;
    note.querySelector('#rl-clean').onclick = () => rlOpenCleanup();
  }
  // empty state: no relationships yet
  const empty = root.querySelector('#rl-empty');
  empty.hidden = m.links.length > 0 || RLS.mode === 'list';
  if (!empty.hidden) {
    empty.innerHTML = `<div class="rl-empty-art" aria-hidden="true"><svg viewBox="0 0 120 64" width="120" height="64"><path d="M22 40 L60 18 L98 40" class="e1"/><path d="M22 40 L98 40" class="e2"/><circle cx="22" cy="40" r="10" class="n1"/><circle cx="60" cy="18" r="12" class="n2"/><circle cx="98" cy="40" r="9" class="n3"/></svg></div>
      <h3>Who's tied to whom?</h3>
      <p>Map the allies, rivals, debts and secrets around the party. Only the DMs ever see this page.</p>
      <button type="button" class="btn primary" id="rl-first">${ic('plus')} Add the first relationship</button>
      <p class="rl-empty-tip">${RLS.g ? 'or drag from one person to another on the web' : 'or add a person first'}</p>`;
    empty.querySelector('#rl-first').onclick = () => rlOpenAdd({});
  }
}
/* Legend: a lookup, not a fixture. A pill until opened (the DM's choice is remembered); open, it is three lines of ties, the
   attitude rings and, behind "More", the marks. Filtering lives in the toolbar. On a phone it opens as a sheet. */
function rlPaintLegend() {
  const m = RLS.model, root = RLS.root, lg = root.querySelector('#rl-legend');
  const used = rlUsedKinds(), vis = m.links.filter(l => (RLS.showEnded || !l.ended) && rlKindOn(l.kind)).length;
  const sheet = lg.classList.contains('sheet');
  const closed = !sheet && (rlPhone() || !RLS.legend || RLS.legendHeld);
  lg.hidden = !used.length || RLS.mode === 'list' || (rlPhone() && RLS.panel);
  lg.classList.toggle('closed', closed);
  const row = (t, name) => {
    const ks = used.filter(k => rlTone(k) === t); if (!ks.length) return '';
    const sw = t === 'hostile' ? ks.map(k => `<span class="rl-sw">${rlSwatch('link', k)}</span>`).join('') : `<span class="rl-sw">${rlSwatch('link', ks.find(k => k !== 'knows') || ks[0])}</span>`;
    return `<div class="rl-lg-row"><span class="rl-lg-sws">${sw}</span><b>${name}</b><span>${ks.map(k => REL_KINDS[k].label.toLowerCase() + (REL_KINDS[k].directed ? ' →' : '')).join(', ')}</span></div>`;
  };
  const marks = [['hidden', 'Hidden from players'], ['dead', 'Dead'], ['missing', 'Missing'], ['secret', 'Secret tie']];
  if (m.links.some(l => l.ended)) marks.push(['ended', 'Ended tie']);
  lg.innerHTML = `<button type="button" class="rl-legend-h" aria-expanded="${!closed}" aria-controls="rl-legend-b">${ic('layers', 'rl-lg-ic')}<span>Legend</span><span class="rl-legend-sum">${rlPlural(vis, 'tie')}</span>${ic(sheet ? 'x' : 'chev', 'rl-chev')}</button>
    <div class="rl-legend-b" id="rl-legend-b">
      <div class="rl-lg-sec">${RL_TONES.map(([t, n]) => row(t, n)).join('')}<div class="rl-lg-row rl-lg-fine"><span class="rl-lg-sws"><span class="rl-sw">${rlSwatch('mark', 'secret')}</span></span><span>dashed: the party doesn't know</span></div></div>
      <div class="rl-lg-sec"><h5>Rings <span>· attitude to the party</span></h5><div class="rl-lg-grid">${RL_ATT_SCALE.map(v => `<span class="rl-key">${rlSwatch('attitude', v)}<span>${esc(rlAttName(v))}</span></span>`).join('')}</div></div>
      <div class="rl-lg-sec"><button type="button" class="rl-linkish rl-lg-more" aria-expanded="${RLS.legendMore}">${ic('chev', 'rl-chev')}${RLS.legendMore ? 'Fewer' : 'More'}: marks</button>
        ${RLS.legendMore ? `<div class="rl-lg-grid">${marks.map(([v, l]) => `<span class="rl-key mk-${v}">${rlSwatch('mark', v)}<span>${l}</span></span>`).join('')}</div>` : ''}</div>
    </div>`;
  lg.querySelector('.rl-legend-h').onclick = () => {
    if (rlPhone()) { rlLegendSheet(!lg.classList.contains('sheet')); return; }
    if (RLS.legendHeld) { RLS.legendHeld = false; RLS.legend = true; }   // opened by hand while the panel is open: stays open
    else RLS.legend = !RLS.legend;
    rlSavePrefs(); rlPaintLegend(); rlInsets(true);
  };
  lg.querySelector('.rl-lg-more').onclick = () => { RLS.legendMore = !RLS.legendMore; rlPaintLegend(); const b = lg.querySelector('.rl-lg-more'); if (b) b.focus({ preventScroll: true }); rlInsets(true); };
}
function rlLegendSheet(open) {
  if (!rlLive()) return;
  const lg = RLS.root.querySelector('#rl-legend'), scrim = RLS.root.querySelector('#rl-scrim');
  lg.classList.toggle('sheet', !!open); scrim.hidden = !open;
  rlPaintLegend();
  if (open) { const h = lg.querySelector('.rl-legend-h'); if (h) h.focus({ preventScroll: true }); }
}
function rlStatus(state, msg) {
  const el = RLS.root && RLS.root.querySelector('#rl-status'); if (!el) return;
  clearTimeout(RLS.statusT);
  el.dataset.state = state;
  el.innerHTML = state === 'saving' ? `${ic('spinner', 'rl-spin')}<span>Saving layout…</span>` : state === 'saved' ? `${ic('check')}<span>Layout saved</span>`
    : state === 'failed' ? `${ic('alert')}<span>${esc(msg || 'Layout not saved')}. Retrying…</span>` : '';
  el.classList.add('on');
  if (state === 'saved') RLS.statusT = setTimeout(() => el.classList.remove('on'), 1600);
}

/* ---------- the list: recently seen first, the party folded into one row, each faction with its members, then the rest ---------- */
function rlRecent(nodes) {
  const num = n => { const x = /(\d+)/.exec((n.meta && n.meta.lastSeen) || ''); return x ? Number(x[1]) : -1; };
  const seen = nodes.filter(n => n.type !== 'pc' && num(n) >= 0).sort((a, b) => num(b) - num(a) || b.deg - a.deg);
  if (!seen.length) return [];
  const top = num(seen[0]), recent = seen.filter(n => num(n) >= top - 1);   // the last two sessions anyone was seen in
  return (recent.length >= 3 ? recent : seen.slice(0, 5)).slice(0, 8);
}
function rlPaintList() {
  if (!rlLive() || !RLS.list || RLS.list.hidden) return;
  const m = RLS.model, q = rlNorm(RLS.query), sel = RLS.panel && RLS.panel.mode === 'person' ? RLS.panel.id : null;
  const shown = n => RLS.types.has(n.type === 'other' ? 'npc' : n.type) && (!q || rlNorm(n.name).includes(q));
  const tiesOf = id => m.links.filter(l => (l.a === id || l.b === id) && (RLS.showEnded || !l.ended) && rlKindOn(l.kind)).sort(rlTieSort(id));
  const row = n => {
    const ties = tiesOf(n.id).filter(l => l.kind !== 'member' || rlNode(rlOther(l, n.id)).type !== 'faction'), fac = n.type !== 'faction' ? rlFactionOf(n.id) : null;
    const role = n.type === 'pc' ? [[n.char.race, n.char.klass].filter(Boolean).join(' '), n.char.level ? `Level ${n.char.level}` : ''].filter(Boolean).join(' · ')
      : [fac ? (() => { const ml = m.links.find(l => l.kind === 'member' && ((l.a === n.id && l.b === fac.id) || (l.b === n.id && l.a === fac.id))); return ml && ml.label ? `${ml.label[0].toUpperCase() + ml.label.slice(1)}, ${fac.name}` : fac.name; })() : rlTypeLabel(n),
        n.meta && n.meta.where ? n.meta.where : ''].filter(Boolean).join(' · ');
    const att = n.type !== 'pc' ? n.attitude || 'unknown' : null;
    return `<button type="button" class="rl-lv-row${n.id === sel ? ' on' : ''}" data-id="${esc(n.id)}">
      ${rlAv(n, 'md')}
      <span class="rl-lv-main">
        <span class="rl-lv-l1"><span class="rl-lv-name">${esc(n.name)}</span>${n.type !== 'pc' && !n.revealed ? `<span class="rl-lv-hid" title="Hidden from players">${ic('eyeoff')}</span>` : ''}${att ? `<span class="rl-lv-att s-${att}"><i aria-hidden="true"></i>${esc(rlAttName(att))}</span>` : ''}</span>
        ${role ? `<span class="rl-lv-role">${esc(role)}</span>` : ''}
        ${ties.length ? `<span class="rl-lv-ties">${ties.slice(0, 2).map(l => `<span class="rl-tchip v-${rlTone(l.kind)}">${esc(rlTieLine(l, n.id, false))}</span>`).join('')}${ties.length > 2 ? `<span class="rl-tchip more">+${ties.length - 2}</span>` : ''}</span>` : ''}
      </span>
    </button>`;
  };
  const sec = (key, name, color, rows, extra = '') => rows.length ? `<section class="rl-lv-g g-${key}" style="--fc:${color}"><h4><i aria-hidden="true"></i><span>${esc(name)}</span><b>${rows.length}</b></h4>${extra}${rows.map(row).join('')}</section>` : '';
  const recent = q ? [] : rlRecent(m.nodes).filter(shown);
  const party = m.nodes.filter(n => n.type === 'pc' && shown(n));
  const placed = new Set();
  const facs = m.nodes.filter(n => n.type === 'faction').sort((a, b) => b.deg - a.deg || a.name.localeCompare(b.name));
  const facSecs = facs.map(f => {
    const members = m.nodes.filter(n => n.type !== 'pc' && n.type !== 'faction' && !placed.has(n.id) && (rlFactionOf(n.id) || {}).id === f.id);
    members.forEach(n => placed.add(n.id)); placed.add(f.id);
    return sec('faction', f.name, rlFactionColor(f.id), [f, ...members.sort((a, b) => b.deg - a.deg || a.name.localeCompare(b.name))].filter(shown));
  }).join('');
  const loose = m.nodes.filter(n => n.type !== 'pc' && !placed.has(n.id) && shown(n)).sort((a, b) => b.deg - a.deg || a.name.localeCompare(b.name));
  // the party: one row of faces that opens into the full list (when searching, the rows themselves)
  const partyHTML = !party.length ? '' : (RLS.partyOpen || q)
    ? sec('party', 'The party', 'var(--rl-pc-ring)', party, q ? '' : '<button type="button" class="rl-linkish rl-lv-fold" data-party>Fold the party</button>')
    : `<section class="rl-lv-g g-party" style="--fc:var(--rl-pc-ring)"><button type="button" class="rl-lv-party" data-party aria-expanded="false"><span class="rl-lv-faces">${party.slice(0, 10).map(n => rlAv(n, 'md')).join('')}</span><span class="rl-lv-party-t"><b>The party</b><span>${party.length} · tap to list</span></span>${ic('chev', 'rl-caret')}</button></section>`;
  const html = sec('recent', 'Recently seen', 'var(--rl-sub)', recent) + partyHTML + facSecs + sec('loose', 'Unaffiliated', 'var(--rl-sub)', loose);
  const top = RLS.list.scrollTop;
  RLS.list.innerHTML = `<div class="rl-lv">${!RLS.g ? `<p class="rl-lv-note">${ic('alert')}<span>The web can't be drawn on this screen right now, so here is everyone as a list.</span></p>` : ''}
    ${!m.links.length ? `<div class="rl-lv-empty"><b>No ties yet.</b><span>Map who's tied to whom around the party.</span><button type="button" class="btn primary small" id="rl-lv-first">${ic('plus')}Add the first relationship</button></div>` : ''}
    ${html || '<p class="rl-lv-none">Nobody matches.</p>'}</div>`;
  RLS.list.scrollTop = top;
  RLS.list.querySelectorAll('[data-id]').forEach(b => b.onclick = () => rlOpenPerson(b.dataset.id, { focus: true }));
  RLS.list.querySelectorAll('[data-party]').forEach(b => b.onclick = () => { RLS.partyOpen = !RLS.partyOpen; rlPaintList(); });
  const first = RLS.list.querySelector('#rl-lv-first'); if (first) first.onclick = () => rlOpenAdd({});
}

/* ---------- events from the web ---------- */
function rlOnSelect(id) {
  if (id && RLS.accept && RLS.accept(id)) { rlSelect(RLS.panel && RLS.panel.mode === 'person' ? RLS.panel.id : null, false); return; } // filled a person field
  if (!id) { if (RLS.panel && !RLS.dirty && RLS.panel.mode !== 'add') rlClose(); return; }
  if (RLS.panel && RLS.panel.mode === 'person' && RLS.panel.id === id) return;
  if (!rlDiscardOk()) { rlSelect(RLS.panel && RLS.panel.mode === 'person' ? RLS.panel.id : null, false); return; }
  rlOpenPerson(id, { frame: true });
}
function rlOnSelectLink(id) {
  if (!id) return;
  if (!rlDiscardOk()) return;
  rlOpenLink(id);
}
// double-click, or Enter twice from the keyboard: frame them and put the keyboard in their profile
function rlOnOpen(id) { if (rlDiscardOk()) rlOpenPerson(id, { frame: true, focus: true }); }
function rlOnConnect(a, b) {
  if (!a || !b || a === b) return;
  if (!rlDiscardOk()) return;
  rlOpenAdd({ a, b });
}
/* Positions: a burst of drags becomes one commit, a moment after the last one. */
function rlOnMove(id, x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  RLS.moves[id] = { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, pinned: true };
  clearTimeout(RLS.moveT); RLS.moveT = setTimeout(rlFlushMoves, 1400);
}
async function rlFlushMoves() {
  clearTimeout(RLS.moveT);
  const ids = Object.keys(RLS.moves); if (!ids.length) return;
  let pos = {}; if (RLS.g) { try { pos = RLS.g.positions() || {}; } catch (_) { pos = {}; } }
  const batch = {};
  for (const id of ids) {
    const p = pos[id] && Number.isFinite(pos[id].x) ? pos[id] : RLS.moves[id];
    batch[id] = { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, pinned: p.pinned === undefined ? true : !!p.pinned };
  }
  RLS.moves = {};
  rlStatus('saving');
  try {
    await rlWrite(() => api('/api/relations/layout', { method: 'PUT', body: { positions: batch }, quiet: true }));
    if (RLS.data) { const ppl = RLS.data.doc.people = { ...(RLS.data.doc.people || {}) }; for (const [id, p] of Object.entries(batch)) ppl[id] = { ...(ppl[id] || {}), ...p }; }
    rlStatus('saved');
  } catch (e) {
    for (const id of ids) if (!RLS.moves[id]) RLS.moves[id] = batch[id]; // try again with the next burst, or in a few seconds
    rlStatus('failed', navigator.onLine === false ? 'Offline: layout not saved' : 'Layout not saved');
    RLS.moveT = setTimeout(rlFlushMoves, 8000);
  }
}

/* ---------- refresh: our own saves, and the other DM's (LIVE_HOOKS) ---------- */
async function rlRefresh({ panel = 'safe' } = {}) {
  if (!rlLive()) return;
  let data;
  try { data = await rlFetch(); } catch (e) { console.warn('relations refresh', e); return; }
  if (!rlLive()) return;
  RLS.data = data; RLS.model = rlBuild(data);
  rlPush(); rlPaintChrome(); rlFilter();
  if (panel) rlPanelSync(panel === 'force');
}
/* Bring the open panel up to date without ever re-rendering over something being typed. */
const rlBusy = () => !!(RLS.panelEl && (RLS.dirty || (RLS.panelEl.contains(document.activeElement) && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName))
  || RLS.panelEl.querySelector('.rp-link-edit:not([hidden]), .rp-add-slot:not(:empty)') || (RLS.pop && RLS.panelEl.contains(RLS.pop.anchor))));
function rlPanelSync(force) {
  const p = RLS.panel; if (!p || !RLS.panelEl) return;
  const busy = !force && rlBusy();
  RLS.stale = busy; // caught up when they leave the field or close the form (rlCatchUp)
  if (p.mode === 'person') {
    if (!rlNode(p.id)) { rlClose(true); toast('That person was removed (their Codex entry is gone).', 3500); return; }
    if (!busy) rlOpenPerson(p.id, { frame: false, keepScroll: true });
  } else if (p.mode === 'link') {
    const l = RLS.model.links.find(x => x.id === p.id);
    if (!l) {
      if (busy) { const w = RLS.panelEl.querySelector('.rf-warn'); if (w) { w.dataset.live = '1'; w.hidden = false; w.textContent = 'The other DM deleted this tie. Saving puts it back.'; } }
      else { rlClose(true); toast('That tie was deleted on another screen.', 3500); }
      return;
    }
    if (!busy) rlOpenLink(p.id, { keepScroll: true });
  } else if (p.mode === 'cleanup') rlOpenCleanup();
}
function rlCatchUp() { setTimeout(() => { if (RLS.stale && rlLive() && !rlBusy()) rlPanelSync(); }, 0); }
function rlLiveHook(name) {
  const prev = LIVE_HOOKS[name];
  LIVE_HOOKS[name] = (a, b, c) => {
    if (prev) { try { prev(a, b, c); } catch (e) { console.error(e); } }
    if (rlLive()) { clearTimeout(RLS.liveT); RLS.liveT = setTimeout(() => rlRefresh(), 80); } // one refresh when several files change together
  };
}
['relations', 'codex', 'characters'].forEach(rlLiveHook);

/* ---------- the panel (a side panel over the web; a bottom sheet on a phone, 55% tall, drag the grip to 92%) ---------- */
function rlShow(mode, id, html, { keepScroll = false } = {}) {
  const p = RLS.panelEl; if (!p) return;
  const was = !p.hidden, top = keepScroll && was && p.querySelector('.rp-scroll') ? p.querySelector('.rp-scroll').scrollTop : 0;
  rlPopClose();
  RLS.panel = { mode, id }; RLS.dirty = false; RLS.accept = null; RLS.stale = false;
  p.innerHTML = `<button type="button" class="rp-grip" aria-label="${RLS.sheet === 'full' ? 'Make the panel smaller' : 'Make the panel taller'}"><i></i></button><div class="rp-scroll">${html}</div>`;
  rlSheetGrip(p);
  if (!p.dataset.bound) { p.dataset.bound = '1'; p.addEventListener('focusout', rlCatchUp); }
  p.dataset.mode = mode;
  if (!was) {
    p.hidden = false; RLS.root.classList.add('has-panel');
    p.classList.remove('rp-in'); void p.offsetWidth; p.classList.add('rp-in');
    RLS.sheet = 'half'; rlSheetApply(); rlSheetSettle();
    // the legend folds out of the way while the panel is open (and comes back when it closes)
    if (!rlPhone() && RLS.legend && !RLS.legendHeld) { RLS.legendHeld = true; rlPaintLegend(); }
    rlInsets(true);
    if (RLS.root.classList.contains('rl-split')) requestAnimationFrame(() => rlMuted(g => g.resize()));
  }
  if (top) p.querySelector('.rp-scroll').scrollTop = top;
  p.querySelectorAll('[data-act="close"]').forEach(b => b.onclick = () => rlClose());
  return was;
}
/* once the sheet's slide-in or snap has finished (transitionend / animationend, or a timer just after the .25s, waiting a
   little longer while it is still moving on a slow frame), tell the web where it really sits */
function rlSheetSettle() {
  const p = RLS.panelEl; if (!p || p.hidden || !rlPhone()) return;
  if (RLS.sheetDone) RLS.sheetDone(true);
  let t = 0, tries = 0;
  const done = quiet => {
    clearTimeout(t);
    if (!quiet && tries++ < 10 && p.getAnimations && p.getAnimations().some(a => a.playState === 'running')) { t = setTimeout(done, 100); return; }
    p.removeEventListener('transitionend', end); p.removeEventListener('animationend', end);
    if (RLS.sheetDone === done) RLS.sheetDone = null;
    if (!quiet && !p.hidden) { RLS.insKey = ''; rlInsets(true); }
  };
  const end = e => { if (e.target === p) done(); };
  t = setTimeout(done, 320);
  p.addEventListener('transitionend', end); p.addEventListener('animationend', end);
  RLS.sheetDone = done;
}
function rlSheetApply() {
  const p = RLS.panelEl; if (!p) return;
  p.style.height = rlPhone() && !p.hidden ? (RLS.sheet === 'full' ? '92%' : '55%') : '';
  const g = p.querySelector('.rp-grip'); if (g) g.setAttribute('aria-label', RLS.sheet === 'full' ? 'Make the panel smaller' : 'Make the panel taller');
}
/* phone sheet: drag the grip between half and nearly full height; drag it low to close; tap to switch */
function rlSheetGrip(p) {
  const grip = p.querySelector('.rp-grip');
  grip.onclick = () => { if (grip.dataset.dragged) { delete grip.dataset.dragged; return; } RLS.sheet = RLS.sheet === 'full' ? 'half' : 'full'; rlSheetApply(); rlSheetSettle(); };
  grip.onpointerdown = e => {
    if (!rlPhone()) return;
    const H = RLS.root.clientHeight, y0 = e.clientY, h0 = p.getBoundingClientRect().height; let moved = false, last = 0;
    grip.setPointerCapture(e.pointerId); p.classList.add('dragging');
    const mv = ev => {
      if (Math.abs(ev.clientY - y0) > 5) moved = true;
      p.style.height = Math.max(H * .18, Math.min(H * .92, h0 + y0 - ev.clientY)) + 'px';
      if (moved && ev.timeStamp - last > 120) { last = ev.timeStamp; rlInsets(true); } // the web follows the sheet, smoothed
    };
    const up = () => {
      grip.removeEventListener('pointermove', mv); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      p.classList.remove('dragging');
      if (!moved) return;
      grip.dataset.dragged = '1';
      const f = p.getBoundingClientRect().height / H;
      if (f < .32) { rlClose(); return; }
      RLS.sheet = f > .74 ? 'full' : 'half'; rlSheetApply(); rlInsets(true); rlSheetSettle();
    };
    grip.addEventListener('pointermove', mv); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  };
}
function rlDiscardOk() { return !RLS.dirty || confirm('Discard the changes you haven\'t saved?'); }
function rlClose(force) {
  if (!force && !rlDiscardOk()) return false;
  const p = RLS.panelEl;
  RLS.panel = null; RLS.dirty = false; RLS.accept = null;
  rlPopClose();
  if (p && !p.hidden) {
    p.hidden = true; p.innerHTML = ''; p.style.height = ''; RLS.root.classList.remove('has-panel');
    if (RLS.legendHeld) { RLS.legendHeld = false; rlPaintLegend(); }
    rlInsets(true);
    if (RLS.root.classList.contains('rl-split')) requestAnimationFrame(() => rlMuted(g => g.resize()));
  }
  rlMuted(g => { g.select(null, { frame: false }); g.selectLink(null); if (typeof g.highlightLink === 'function') g.highlightLink(null); });
  if (RLS.mode === 'list' || !RLS.g) rlPaintList();
  return true;
}
/* Go to someone: show them (switching their type back on if it was filtered out), frame them and their ties, open their profile. */
function rlGoTo(id, { focus = false } = {}) {
  const n = rlNode(id); if (!n) return;
  if (!rlDiscardOk()) return;
  const t = n.type === 'other' ? 'npc' : n.type;
  if (!RLS.types.has(t)) { RLS.types.add(t); rlSavePrefs(); rlFilter(); rlPaintChrome(); toast(`Showing ${RL_TYPE_LABEL[t].toLowerCase()}s again`); }
  rlOpenPerson(id, { frame: true, focus });
}

/* ----- a person's profile: name, where they were last seen, chips (attitude, status, hidden: each opens or toggles), then
   their ties in friend-or-foe groups, then what's known, then details. ----- */
function rlOpenPerson(id, { frame = false, focus = false, keepScroll = false } = {}) {
  const n = rlNode(id); if (!n) return;
  if (!(RLS.panel && RLS.panel.mode === 'person' && RLS.panel.id === id)) RLS.moreTies = false;
  rlShow('person', id, rlPersonHTML(n), { keepScroll });
  RLS.sel = id;
  rlMuted(g => { g.selectLink(null); g.select(id, { frame }); });
  if (RLS.mode === 'list' || !RLS.g) rlPaintList();
  rlBindPerson(n);
  if (focus) { const h = RLS.panelEl.querySelector('.rp-name'); if (h) h.focus({ preventScroll: true }); }
}
function rlPersonHTML(n) {
  const meta = n.meta || {}, isPC = n.type === 'pc', e = n.entry, ch = n.char;
  const ties = RLS.model.links.filter(l => l.a === n.id || l.b === n.id).sort(rlTieSort(n.id));
  const shown = RLS.moreTies ? ties : ties.slice(0, RL_MAX_TIES);
  const pinned = !!(meta.pinned || RLS.moves[n.id]);
  const att = n.attitude || 'unknown', st = n.status || 'alive';
  const line = isPC ? [[ch.race, ch.klass].filter(Boolean).join(' '), ch.level ? `Level ${ch.level}` : '', ch.player ? `played by ${ch.player}` : ''].filter(Boolean).join(' · ')
    : [meta.lastSeen ? `Last seen ${meta.lastSeen}` : '', meta.where || ''].filter(Boolean).join(' · ');
  const text = (s, cls = '') => `<div class="rp-text ${cls}">${md(rlExcerpt(s))}</div>`;
  const groups = RL_TONES.map(([t]) => t).sort((a, b) => RL_TONE_RANK[a] - RL_TONE_RANK[b]).map(t => [t, shown.filter(l => rlTone(l.kind) === t)]).filter(([, ls]) => ls.length);
  return `<header class="rp-head${line ? '' : ' no-line'}">
      ${rlAv(n, 'lg')}
      <div class="rp-id">
        <h2 class="rp-name" tabindex="-1">${esc(n.name)}</h2>
        ${line ? `<p class="rp-line" title="${esc(line)}">${esc(line)}</p>` : ''}
        <div class="rp-chips">
          ${isPC ? '<span class="rp-chip plain">Player character</span>'
            : `<button type="button" class="rp-chip att s-${att}" data-pop="attitude" aria-haspopup="dialog" aria-expanded="false" aria-label="Attitude to the party: ${esc(rlAttName(att))}. Change" data-tip="Attitude to the party: click to change"><i aria-hidden="true"></i>${att === 'unknown' ? 'Attitude unknown' : `${esc(rlAttName(att))} to party`}${ic('chev', 'rp-chip-caret')}</button>`}
          <button type="button" class="rp-chip st st-${st}" data-pop="status" aria-haspopup="dialog" aria-expanded="false" aria-label="Status: ${st}. Change" data-tip="Status: click to change">${esc(st[0].toUpperCase() + st.slice(1))}${ic('chev', 'rp-chip-caret')}</button>
          ${e ? `<button type="button" class="rp-chip vis ${n.revealed ? 'is-on' : 'is-off'}" data-act="reveal" aria-pressed="${n.revealed}" data-tip="${n.revealed ? 'In the players\' Codex. Click to hide' : 'Only the DMs know them. Click to reveal to the players'}">${ic(n.revealed ? 'eye' : 'eyeoff')}${n.revealed ? 'Visible' : 'Hidden'}</button>` : ''}
        </div>
      </div>
      <div class="rp-tools">
        <button type="button" class="rp-tool" data-act="focus" aria-label="Show them and their ties on the web" data-tip="Show on the web">${ic('locate')}</button>
        ${pinned && RLS.g ? `<button type="button" class="rp-tool" data-act="unpin" aria-label="Unpin: let the web place them" data-tip="Pinned where you dropped them. Click to let the web place them">${ic('pinoff')}</button>` : ''}
        <button type="button" class="rp-tool" data-act="close" aria-label="Close" data-tip="Close  Esc">${ic('x')}</button>
      </div>
    </header>
    <section class="rp-sec rp-ties">
      <div class="rp-sec-h"><h3>Ties${ties.length ? ` <span class="rp-count">${ties.length}</span>` : ''}</h3><button type="button" class="rl-linkish rp-add" data-act="add">${ic('plus')}Add tie</button></div>
      <div class="rp-add-slot"></div>
      ${ties.length ? groups.map(([t, ls]) => `<div class="rp-tgroup v-${t}"><h4>${RL_TONE_GROUP[t]}</h4><ul class="rp-tie-list">${ls.map(l => rlTieHTML(l, n.id)).join('')}</ul></div>`).join('')
        + (ties.length > shown.length ? `<button type="button" class="rl-linkish rp-more-ties" data-act="more">Show ${ties.length - shown.length} more</button>` : '')
        : `<p class="rp-empty">No ties yet. ${RLS.g ? `Add one, or drag from ${esc(n.name)} to someone on the web.` : 'Add one to start their web.'}</p>`}
    </section>
    ${e ? `<section class="rp-sec rp-prose">
      <h3>What the players know</h3>
      ${String(e.playerContent || '').trim() ? text(e.playerContent) : '<p class="rp-none">Nothing written for the players yet.</p>'}
      <div class="rp-dmbox"><h3 class="rp-h-dm">${ic('eyeoff')}DM notes</h3>
      ${String(e.dmContent || '').trim() ? text(e.dmContent, 'rp-dm') : '<p class="rp-none">No DM notes yet.</p>'}</div>
      <button type="button" class="rl-linkish rp-open" data-act="codex">${ic('scroll')}Open in Codex${ic('arrowright')}</button>
    </section>` : isPC ? `<section class="rp-sec rp-prose"><button type="button" class="rl-linkish rp-open" data-act="sheet">${ic('users')}Open character sheet${ic('arrowright')}</button></section>` : ''}
    ${isPC ? '' : `<section class="rp-sec rp-details">
      <h3>Details</h3>
      <dl class="rp-grid">
        <dt id="rp-seen-l">Last seen</dt><dd><div class="rp-edit" data-field="lastSeen" data-max="40" data-ph="${RLS.session ? `e.g. Session ${RLS.session}` : 'e.g. Session 3'}" role="button" tabindex="0" aria-labelledby="rp-seen-l">${meta.lastSeen ? esc(meta.lastSeen) : `<span class="rp-ph">${RLS.session ? `e.g. Session ${RLS.session}` : 'Add'}</span>`}</div></dd>
        <dt id="rp-where-l">Last known at</dt><dd><div class="rp-edit" data-field="where" data-max="80" data-ph="Add a place" role="button" tabindex="0" aria-labelledby="rp-where-l">${meta.where ? esc(meta.where) : '<span class="rp-ph">Add a place</span>'}</div></dd>
      </dl>
    </section>`}`;
}
/* One tie, two lines: who (in full), then the sentence from this person's side ("Serves Anna", "Rival of Bo · hunts
   his ships"). The bar on the left is friend or foe; secret and ended are said in words. Hover shows it on the web. */
function rlTieHTML(l, selfId) {
  const o = rlNode(rlOther(l, selfId)), t = rlTone(l.kind);
  const tip = [rlSay(l.a, l.b, l.kind, l.dir).replace(/<[^>]+>/g, ''), l.since ? `since ${l.since}` : '', l.note].filter(Boolean).join(' · ');
  return `<li class="rp-tie v-${t}${l.kind === 'enemy' ? ' v-enemy' : ''}${l.ended ? ' ended' : ''}${RLS.flash === l.id ? ' rl-flash' : ''}" data-link="${esc(l.id)}">
    <div class="rp-tie-row">
      <button type="button" class="rp-tie-main" data-go="${esc(o.id)}" title="${esc(tip)}">
        ${rlAv(o, 'xs')}
        <span class="rp-tie-txt">
          <span class="rp-tie-l1"><b>${esc(o.name)}</b>${l.secret ? `<span class="rp-flag">${ic('eyeoff')}secret</span>` : ''}${l.ended ? '<span class="rp-flag">ended</span>' : ''}</span>
          <span class="rp-tie-l2">${esc(rlTieLine(l, selfId))}</span>
        </span>
      </button>
      <span class="rp-tie-acts">
        <button type="button" class="rp-tool sm" data-edit="${esc(l.id)}" aria-label="Edit tie with ${esc(o.name)}" data-tip="Edit">${ic('pencil')}</button>
        <button type="button" class="rp-tool sm danger" data-del="${esc(l.id)}" aria-label="Delete tie with ${esc(o.name)}" data-tip="Delete">${ic('trash')}</button>
      </span>
    </div>
    <div class="rp-link-edit" hidden></div>
  </li>`;
}
function rlBindPerson(n) {
  const p = RLS.panelEl, id = n.id;
  RLS.flash = null;
  p.querySelector('[data-act="focus"]').onclick = () => rlMuted(g => g.select(id, { frame: true }));
  const up = p.querySelector('[data-act="unpin"]');
  if (up) up.onclick = async () => {
    delete RLS.moves[id];
    rlMuted(g => g.unpin(id));
    up.remove();
    try { await rlWrite(() => api(`/api/relations/people/${encodeURIComponent(id)}`, { method: 'PATCH', body: { pinned: false } })); } catch (_) { /* toast already */ }
    rlRefresh();
  };
  p.querySelectorAll('[data-pop]').forEach(b => b.onclick = () => (RLS.pop && RLS.pop.anchor === b ? rlPopClose(true) : rlPickPop(b, b.dataset.pop, id)));
  // click-to-edit text: Enter or leaving saves, Esc puts it back
  p.querySelectorAll('.rp-edit').forEach(box => {
    const start = () => {
      if (box.querySelector('input')) return;
      const now = rlNode(id), cur = ((now && now.meta) || {})[box.dataset.field] || '';
      box.innerHTML = `<input class="rp-inline" value="${esc(cur)}" maxlength="${box.dataset.max}" placeholder="${esc(box.dataset.ph)}" autocomplete="off">`;
      const inp = box.querySelector('input'); inp.focus(); inp.select();
      let done = false;
      const finish = async save => {
        if (done) return; done = true;
        const v = inp.value.trim();
        const shown = save ? v : cur;
        box.innerHTML = shown ? esc(shown) : `<span class="rp-ph">${esc(box.dataset.ph)}</span>`;
        if (save && v !== cur) { const ok = await rlSavePerson(id, { [box.dataset.field]: v || null }, { quiet: true }); if (ok) { box.classList.remove('saved'); void box.offsetWidth; box.classList.add('saved'); } }
        rlCatchUp();
      };
      inp.addEventListener('keydown', e => {
        if (e.key === 'Enter') { e.preventDefault(); finish(true); box.focus(); }
        else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); box.focus(); }
      });
      inp.addEventListener('blur', () => finish(true));
    };
    box.addEventListener('click', start);
    box.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target === box) { e.preventDefault(); start(); } });
  });
  const rv = p.querySelector('[data-act="reveal"]');
  if (rv) rv.onclick = async () => {
    const want = !n.revealed;
    rv.disabled = true;
    try {
      const cur = rlNode(id);
      if (cur && cur.entry && !!cur.entry.revealed !== want) await rlWrite(() => api(`/api/codex/${cur.entry.id}/reveal`, { method: 'POST' }));
      toast(want ? `${n.name} is now in the players' Codex` : `${n.name} is hidden from the players again`);
    } catch (_) { /* toast already */ }
    rlRefresh({ panel: 'force' });
  };
  const cx = p.querySelector('[data-act="codex"]');
  if (cx) cx.onclick = () => { if (!rlDiscardOk()) return; S.tab = 'codex'; S.view = null; S.search.codex = n.name; S.search.codexCat = 'all'; localStorage.setItem('gc_tab', 'codex'); render(); };
  const sh = p.querySelector('[data-act="sheet"]');
  if (sh) sh.onclick = () => { if (!rlDiscardOk()) return; S.tab = 'party'; S.view = 'char:' + n.char.id; localStorage.setItem('gc_tab', 'party'); render(); };
  p.querySelector('[data-act="add"]').onclick = () => rlInlineAdd(n);
  const more = p.querySelector('[data-act="more"]'); if (more) more.onclick = () => { RLS.moreTies = true; rlOpenPerson(id, { keepScroll: true }); };
  p.querySelectorAll('[data-go]').forEach(b => b.onclick = () => rlGoTo(b.dataset.go));
  p.querySelectorAll('[data-edit]').forEach(b => b.onclick = () => rlInlineEdit(b.dataset.edit, n.id));
  p.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { const l = RLS.model.links.find(x => x.id === b.dataset.del); if (l) rlDelete(l); });
  // hovering a tie lights that edge on the web (and only that: the camera stays put)
  if (rlHas('highlightLink')) p.querySelectorAll('.rp-tie').forEach(li => {
    li.addEventListener('mouseenter', () => rlMuted(g => g.highlightLink(li.dataset.link)));
    li.addEventListener('mouseleave', () => rlMuted(g => g.highlightLink(null)));
    li.addEventListener('focusin', () => rlMuted(g => g.highlightLink(li.dataset.link)));
    li.addEventListener('focusout', () => rlMuted(g => g.highlightLink(null)));
  });
}
/* Attitude, status, where, last seen: shown at once, saved behind; a failed save puts the truth back. */
async function rlSavePerson(id, patch, { quiet = false } = {}) {
  const ppl = RLS.data.doc.people = { ...(RLS.data.doc.people || {}) }, cur = { ...(ppl[id] || {}) };
  for (const [k, v] of Object.entries(patch)) { if (v === null || v === '') delete cur[k]; else cur[k] = v; }
  ppl[id] = cur;
  RLS.model = rlBuild(RLS.data); rlPush();
  if ((patch.attitude || patch.status) && RLS.panel && RLS.panel.mode === 'person' && RLS.panel.id === id && !rlBusy()) rlOpenPerson(id, { keepScroll: true });
  try {
    await rlWrite(() => api(`/api/relations/people/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch, quiet }));
    return true;
  } catch (e) {
    if (quiet) toast(`Not saved: ${e.message}`, 3500);
    rlRefresh({ panel: 'force' });
    return false;
  }
}

/* ----- delete with Undo ----- */
async function rlDelete(l) {
  const line = `${rlNameOf(l.a)} – ${REL_KINDS[l.kind] ? REL_KINDS[l.kind].label.toLowerCase() : l.kind} – ${rlNameOf(l.b)}`;
  // gone from the screen at once
  RLS.data.doc.links = RLS.data.doc.links.filter(x => x.id !== l.id);
  RLS.model = rlBuild(RLS.data); rlPush(); rlPaintChrome();
  if (RLS.panel && RLS.panel.mode === 'link' && RLS.panel.id === l.id) rlClose(true); else rlPanelSync(true);
  try { await rlWrite(() => api(`/api/relations/links/${encodeURIComponent(l.id)}`, { method: 'DELETE' })); }
  catch (_) { rlRefresh({ panel: 'force' }); return; }
  const back = Object.fromEntries(['id', ...RL_LINK_KEYS].filter(k => l[k] !== undefined).map(k => [k, l[k]]));
  rlUndoToast(`Deleted ${line}`, async () => {
    try { await rlWrite(() => api('/api/relations/links', { method: 'POST', body: back })); RLS.flash = l.id; toast('Tie restored'); }
    catch (_) { /* toast already */ }
    rlRefresh({ panel: 'force' });
  });
}
function rlUndoToast(msg, undo, ms = 8000) {
  const host = $('#toasts'); if (!host) return;
  host.querySelectorAll('.rl-toast').forEach(t => t.remove());
  const t = document.createElement('div');
  t.className = 'toast rl-toast'; t.setAttribute('role', 'status');
  t.innerHTML = `<span>${esc(msg)}</span><button type="button" class="rl-undo">${ic('rotate')}Undo</button>`;
  host.appendChild(t);
  let done = false;
  const gone = () => { if (!t.isConnected) return; t.classList.add('out'); setTimeout(() => t.remove(), 260); if (RLS.undo && RLS.undo.t === t) RLS.undo = null; };
  const run = () => { if (done) return; done = true; gone(); undo(); };
  t.querySelector('.rl-undo').onclick = run;
  RLS.undo = { t, run };
  setTimeout(gone, ms);
}
document.addEventListener('keydown', e => {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== 'z' || !rlLive() || !RLS.undo) return;
  const tag = (e.target && e.target.tagName) || '';
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
  e.preventDefault(); RLS.undo.run();
});

/* ---------- person fields in forms: a chip once chosen, else a type-ahead (with "add as new" while typing) ---------- */
/* opts: { value, fixed, placeholder, label, exclude: () => Set, create, compact, onChange(v) }. A value is a node id or { create: name }. */
function rlPicker(host, opts) {
  let value = opts.value || null, act = 0, hits = [];
  const uidp = 'rp' + Math.random().toString(36).slice(2, 8), sz = opts.compact ? 'xs' : 'sm';
  const paint = (focus) => {
    if (value) {
      const n = typeof value === 'object' ? null : rlNode(value);
      host.innerHTML = `<div class="rf-chip${typeof value === 'object' ? ' new' : ''}${opts.compact ? ' compact' : ''}">${n ? rlAv(n, sz) : `<span class="rl-av ${sz} t-npc a-unknown" aria-hidden="true">${ic('plus')}</span>`}
        <span class="rf-chip-name">${esc(n ? n.name : value.create)}</span><span class="rf-chip-meta">${n ? esc(rlTypeLabel(n)) : 'new NPC'}</span>
        ${value === opts.fixed ? '' : `<button type="button" class="rf-chip-x" aria-label="Change ${esc(opts.label || 'person')}">${ic('x')}</button>`}</div>`;
      const x = host.querySelector('.rf-chip-x');
      if (x) x.onclick = () => { value = null; opts.onChange && opts.onChange(null); paint(true); };
      return;
    }
    host.innerHTML = `<div class="rf-pick${opts.compact ? ' compact' : ''}"><input type="text" class="rf-pick-in" placeholder="${esc(opts.placeholder || 'Type a name…')}" aria-label="${esc(opts.label || 'Person')}" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="false" aria-controls="${uidp}-l" aria-autocomplete="list"><div class="rf-pick-list" id="${uidp}-l" role="listbox" hidden></div></div>`;
    const inp = host.querySelector('input'), list = host.querySelector('.rf-pick-list');
    const draw = () => {
      const v = inp.value.trim(), ex = opts.exclude ? opts.exclude() : new Set();
      hits = v ? rlMatch(v, 6, ex) : (RLS.model ? [...RLS.model.nodes].filter(n => !ex.has(n.id) && n.type !== 'other').sort((x, y) => y.deg - x.deg).slice(0, 6) : []);
      const exact = hits.some(n => rlNorm(n.name) === rlNorm(v));
      const canNew = opts.create && v && !exact;
      const total = hits.length + (canNew ? 1 : 0);
      act = Math.max(0, Math.min(act, total - 1));
      list.innerHTML = (v ? '' : '<div class="rf-pick-h">Most connected</div>') + hits.map((n, i) => `<div class="rl-opt${i === act ? ' on' : ''}" role="option" id="${uidp}-${i}" data-i="${i}" aria-selected="${i === act}">${rlAv(n, sz)}<span class="rl-opt-name">${v ? rlMark(n.name, v) : esc(n.name)}</span><span class="rl-opt-meta">${esc(rlTypeLabel(n))}</span></div>`).join('')
        + (canNew ? `<div class="rl-opt rl-opt-new${act === hits.length ? ' on' : ''}" role="option" id="${uidp}-${hits.length}" data-i="${hits.length}" aria-selected="${act === hits.length}">${ic('plus')}<span class="rl-opt-name">Add “${esc(v)}” as a new NPC</span></div>` : '')
        + (!total ? '<div class="rl-opt-none">No match.</div>' : '');
      list.hidden = false; inp.setAttribute('aria-expanded', 'true'); if (total) inp.setAttribute('aria-activedescendant', `${uidp}-${act}`);
    };
    const choose = i => {
      const v = inp.value.trim();
      if (i < hits.length) value = hits[i].id; else if (opts.create && v) value = { create: v.slice(0, 80) }; else return;
      opts.onChange && opts.onChange(value); paint();
      // on to the next thing to fill: the other person, the kind, or (all done) the button that saves
      const f = host.closest('form'), next = f && (f.querySelector('.rf-pick-in') || f.querySelector('.rf-kind [aria-checked="true"]') || f.querySelector('.rf-kind button') || f.querySelector('[type="submit"]'));
      if (next) next.focus({ preventScroll: true });
    };
    inp.addEventListener('input', () => { act = 0; draw(); });
    inp.addEventListener('focus', draw);
    inp.addEventListener('blur', () => setTimeout(() => { if (list.isConnected) { list.hidden = true; inp.setAttribute('aria-expanded', 'false'); } }, 140));
    inp.addEventListener('keydown', e => {
      const total = list.querySelectorAll('[data-i]').length;
      if (e.key === 'ArrowDown' && total) { e.preventDefault(); act = (act + 1) % total; draw(); }
      else if (e.key === 'ArrowUp' && total) { e.preventDefault(); act = (act - 1 + total) % total; draw(); }
      else if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) { if (inp.value.trim() && total) { e.preventDefault(); e.stopPropagation(); choose(act); } }
      else if (e.key === 'Escape' && !list.hidden) { e.preventDefault(); e.stopPropagation(); list.hidden = true; inp.setAttribute('aria-expanded', 'false'); }
      else if (e.key === 'Tab' && inp.value.trim() && total && !e.shiftKey) { choose(act); }
    });
    list.addEventListener('mousedown', e => { const o = e.target.closest('[data-i]'); if (o) { e.preventDefault(); choose(Number(o.dataset.i)); } });
    if (focus) inp.focus({ preventScroll: true });
  };
  paint();
  return { get: () => value, set: v => { value = v; paint(); }, focus: () => { const i = host.querySelector('input'); if (i) i.focus(); }, empty: () => !value };
}
/* Make { create: name } values real Codex entries (hidden from players), one by one. → node ids */
async function rlCreateIfNew(values) {
  const out = [];
  for (const v of values) {
    if (v && typeof v === 'object' && v.create) {
      const e = await api('/api/codex', { method: 'POST', body: { name: v.create, category: v.category === 'faction' ? 'faction' : 'npc', playerContent: '', dmContent: '', image: '', revealed: false } });
      out.push('codex:' + e.id);
    } else out.push(v);
  }
  return out;
}

/* ---------- the relationship form: add (from a profile, the toolbar or a drag) and edit ---------- */
/* opts: { link (edit), a, b, fixed (a node that stays one of the two ends), onDone(link), onCancel, inline } */
function rlLinkForm(host, opts) {
  const ed = opts.link || null;
  const st = {
    a: ed ? ed.a : opts.a || null, b: ed ? ed.b : opts.b || null, kind: ed ? ed.kind : null, dir: ed ? (ed.dir === 'ab' ? 'ab' : 'both') : 'both', dirTouched: !!ed,
    label: ed ? ed.label || '' : '', since: ed ? ed.since || '' : '', note: ed ? ed.note || '' : '', secret: ed ? !!ed.secret : false, ended: ed ? !!ed.ended : false
  };
  const more = !!(st.since || st.note || st.ended);
  const fid = 'rf' + Math.random().toString(36).slice(2, 7);
  host.innerHTML = `<form class="rf${opts.inline ? ' rf-inline' : ''}" novalidate>
    ${ed ? '' : `<div class="rf-ends">
      <div class="rf-end"><span class="rf-end-l">From</span><div class="rf-slot" data-end="a"></div></div>
      <button type="button" class="rf-swap" aria-label="Swap the two people" data-tip="Swap">${ic('swapv')}</button>
      <div class="rf-end"><span class="rf-end-l">To</span><div class="rf-slot" data-end="b"></div></div>
    </div>`}
    <div class="rf-row"><span class="rf-l" id="${fid}-k">Kind</span>
      <div class="rf-kind" role="radiogroup" aria-labelledby="${fid}-k">${RL_KIND_LIST.map(k => `<button type="button" role="radio" class="tone-${REL_KINDS[k].tone}" data-k="${k}" aria-checked="${st.kind === k}" style="--k:var(--rk-${k})" tabindex="${st.kind === k || (!st.kind && k === 'ally') ? 0 : -1}"><span class="rl-sw">${rlSwatch('link', k)}</span>${REL_KINDS[k].label}</button>`).join('')}</div>
    </div>
    <p class="rf-say" aria-live="polite"></p>
    <div class="rf-row"><label class="rf-l" for="${fid}-label">Label <span>optional</span></label><input id="${fid}-label" class="rf-in" data-f="label" maxlength="60" value="${esc(st.label)}" placeholder="${esc(st.kind ? REL_KINDS[st.kind].ph : 'e.g. sister, owes 50 gp')}" autocomplete="off"></div>
    <div class="rf-row rf-two">
      <div><span class="rf-l" id="${fid}-d">Direction</span>
        <div class="rl-seg sm rf-dir" role="radiogroup" aria-labelledby="${fid}-d"><button type="button" role="radio" data-d="both" aria-checked="${st.dir === 'both'}">Both ways</button><button type="button" role="radio" data-d="ab" aria-checked="${st.dir === 'ab'}">One way ${ic('arrowright')}</button></div></div>
      <div><span class="rf-l">Secret</span>
        <button type="button" class="rl-switch-row" role="switch" data-f="secret" aria-checked="${st.secret}" data-tip="On: the party doesn't know about this"><span class="rl-switch" aria-hidden="true"></span><span>Party doesn't know</span></button></div>
    </div>
    <details class="rf-more"${more ? ' open' : ''}><summary>${ic('chev', 'rl-chev')}Since, notes${ed ? ', ended' : ''}</summary>
      <div class="rf-row"><label class="rf-l" for="${fid}-since">Since</label><div class="rf-since"><input id="${fid}-since" class="rf-in" data-f="since" maxlength="40" value="${esc(st.since)}" placeholder="e.g. Session ${RLS.session || 3}" autocomplete="off">${RLS.session ? `<button type="button" class="rf-fill" data-fill="Session ${RLS.session}">Session ${RLS.session}</button>` : ''}</div></div>
      <div class="rf-row"><label class="rf-l" for="${fid}-note">DM note <span>markdown ok</span></label><textarea id="${fid}-note" class="rf-in" data-f="note" maxlength="4000" rows="3" placeholder="What's behind it, what could change it…">${esc(st.note)}</textarea></div>
      <div class="rf-row"><button type="button" class="rl-switch-row" role="switch" data-f="ended" aria-checked="${st.ended}"><span class="rl-switch" aria-hidden="true"></span><span>It's over (ended)</span></button></div>
    </details>
    <p class="rf-err" role="alert" hidden></p>
    <p class="rf-warn" hidden></p>
    <div class="rf-actions">
      <button type="submit" class="btn primary small">${ed ? 'Save' : 'Add tie'}</button>
      <button type="button" class="btn small ghost" data-act="cancel">Cancel</button>
      ${ed ? `<button type="button" class="btn small ghost danger rf-del" data-act="delete">${ic('trash')}Delete</button>` : `<span class="rf-hint">${RLS.g ? 'Tip: click people on the web to fill these in' : ''}</span>`}
    </div>
  </form>`;
  const form = host.querySelector('form'), err = form.querySelector('.rf-err'), say = form.querySelector('.rf-say');
  const dirty = () => { RLS.dirty = true; };
  const pickers = {};
  const sayIt = () => {
    const a = pickers.a ? pickers.a.get() : st.a, b = pickers.b ? pickers.b.get() : st.b;
    say.innerHTML = a && b && st.kind ? rlSay(a, b, st.kind, st.dir) + '.' : '';
    say.style.setProperty('--k', st.kind ? `var(--rk-${st.kind})` : 'transparent');
    say.hidden = !say.innerHTML;
    // a duplicate is pointed out before saving
    const w = form.querySelector('.rf-warn');
    const ai = typeof a === 'string' ? a : null, bi = typeof b === 'string' ? b : null;
    const dup = ai && bi && st.kind && RLS.model.links.find(l => l.id !== (ed && ed.id) && l.kind === st.kind && ((l.a === ai && l.b === bi) || (l.a === bi && l.b === ai)));
    if (!w.dataset.live) { w.hidden = !dup; w.textContent = dup ? `They're already tied as ${REL_KINDS[st.kind].label.toLowerCase()}${dup.label ? ` (“${dup.label}”)` : ''}. Give this one a different label, or edit that one.` : ''; }
  };
  if (!ed) {
    const ex = end => () => { const o = pickers[end === 'a' ? 'b' : 'a'].get(); return new Set(typeof o === 'string' ? [o] : []); };
    for (const end of ['a', 'b']) pickers[end] = rlPicker(form.querySelector(`[data-end="${end}"]`), { value: st[end], fixed: opts.fixed, label: end === 'a' ? 'From' : 'To', placeholder: end === 'a' ? 'Who…' : 'Tied to…', exclude: ex(end), create: true, onChange: () => { dirty(); orient(); sayIt(); } });
    form.querySelector('.rf-swap').onclick = () => { const a = pickers.a.get(), b = pickers.b.get(); pickers.a.set(b); pickers.b.set(a); dirty(); sayIt(); };
    // a click on the web fills the first empty person (or replaces "To")
    RLS.accept = id => {
      if (!form.isConnected) return false;
      const a = pickers.a.get(), b = pickers.b.get();
      if (a === id || b === id) return true;
      if (!a) pickers.a.set(id); else if (!b || b !== opts.fixed) pickers.b.set(id); else pickers.a.set(id);
      dirty(); orient(); sayIt();
      const k = form.querySelector('.rf-kind [aria-checked="true"]') || form.querySelector('.rf-kind button'); if (k && !st.kind) k.focus({ preventScroll: true });
      return true;
    };
  }
  // members point at the faction; serves and owes start one-way
  const orient = () => {
    if (ed || st.kind !== 'member') return;
    const a = pickers.a.get(), b = pickers.b.get(), na = rlNodeOrNew(a), nb = rlNodeOrNew(b);
    if (na && nb && na.type === 'faction' && nb.type !== 'faction') { pickers.a.set(b); pickers.b.set(a); }
  };
  const setDir = d => { st.dir = d; form.querySelectorAll('[data-d]').forEach(x => x.setAttribute('aria-checked', String(x.dataset.d === d))); };
  const kinds = form.querySelector('.rf-kind');
  const pickKind = k => {
    st.kind = k; dirty();
    kinds.querySelectorAll('[data-k]').forEach(x => { const on = x.dataset.k === k; x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; });
    if (!st.dirTouched) setDir(REL_KINDS[k].directed ? 'ab' : 'both');
    form.querySelector('[data-f="label"]').placeholder = REL_KINDS[k].ph;
    orient(); sayIt(); err.hidden = true;
  };
  kinds.addEventListener('click', e => { const b = e.target.closest('[data-k]'); if (b) pickKind(b.dataset.k); });
  kinds.addEventListener('keydown', e => {
    const xs = [...kinds.querySelectorAll('[data-k]')], i = xs.indexOf(document.activeElement);
    const j = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? i + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? i - 1 : null;
    if (j === null || i < 0) return;
    e.preventDefault(); const b = xs[(j + xs.length) % xs.length]; b.focus(); pickKind(b.dataset.k);
  });
  form.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { st.dirTouched = true; setDir(b.dataset.d); dirty(); sayIt(); });
  form.querySelectorAll('.rl-switch-row[data-f]').forEach(b => b.onclick = () => { const on = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', String(on)); st[b.dataset.f] = on; dirty(); });
  form.querySelectorAll('.rf-in').forEach(i => i.addEventListener('input', () => { st[i.dataset.f] = i.value; dirty(); }));
  const fill = form.querySelector('[data-fill]');
  if (fill) fill.onclick = () => { const i = form.querySelector('[data-f="since"]'); i.value = fill.dataset.fill; st.since = i.value; dirty(); i.focus(); };
  form.querySelector('textarea').addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); } });
  form.querySelector('[data-act="cancel"]').onclick = () => { RLS.dirty = false; RLS.accept = null; opts.onCancel && opts.onCancel(); }; // Cancel means discard
  const del = form.querySelector('[data-act="delete"]');
  if (del) del.onclick = () => { RLS.dirty = false; rlDelete(ed); };
  let busy = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const a = ed ? ed.a : pickers.a.get(), b = ed ? ed.b : pickers.b.get();
    const bad = !a ? 'Pick who this starts from.' : !b ? 'Pick who they\'re tied to.' : a === b ? 'Pick two different people.' : !st.kind ? 'Pick a kind of tie.' : '';
    if (bad) { err.textContent = bad; err.hidden = false; (!st.kind && a && b ? kinds.querySelector('button') : form.querySelector('.rf-pick-in') || kinds.querySelector('button')).focus(); return; }
    const w = form.querySelector('.rf-warn');
    if (!w.hidden && !w.dataset.live && !ed && !st.label.trim()) { err.textContent = 'They already have this tie. Add a label to tell them apart.'; err.hidden = false; return; }
    const body = { kind: st.kind, label: st.label.trim(), dir: st.dir, note: st.note.trim(), since: st.since.trim(), secret: st.secret, ended: st.ended };
    busy = true; form.classList.add('busy'); form.querySelector('[type="submit"]').disabled = true;
    try {
      let saved;
      if (ed && RLS.model.links.some(l => l.id === ed.id)) {
        const patch = {}; for (const [k, v] of Object.entries(body)) if (JSON.stringify(v) !== JSON.stringify(ed[k] ?? (typeof v === 'boolean' ? false : ''))) patch[k] = v;
        saved = Object.keys(patch).length ? await rlWrite(() => api(`/api/relations/links/${encodeURIComponent(ed.id)}`, { method: 'PATCH', body: patch })) : ed;
      } else {
        const [ra, rb] = await rlCreateIfNew([a, b]);
        saved = await rlWrite(() => api('/api/relations/links', { method: 'POST', body: { ...body, a: ra, b: rb } }));
      }
      RLS.dirty = false; RLS.accept = null; RLS.flash = saved.id;
      await (opts.onDone ? opts.onDone(saved) : null);
    } catch (e2) { err.textContent = e2.message || 'Could not save'; err.hidden = false; }
    busy = false; if (form.isConnected) { form.classList.remove('busy'); form.querySelector('[type="submit"]').disabled = false; }
  });
  sayIt();
  return { focus: () => { const f = form.querySelector('.rf-pick-in') || (st.kind ? null : kinds.querySelector('[tabindex="0"]')) || form.querySelector('[data-f="label"]'); if (f) f.focus({ preventScroll: true }); } };
}
/* + Relationship / onConnect / the empty state: a new tie in the panel */
function rlOpenAdd({ a = null, b = null } = {}) {
  if (RLS.panel && !rlDiscardOk()) return;
  rlShow('add', null, `<header class="rp-head rp-head-plain"><div class="rp-id"><h2 class="rp-name" tabindex="-1">New relationship</h2><p class="rp-sub">Only the DMs see this.</p></div>
    <div class="rp-tools"><button type="button" class="rp-tool" data-act="close" aria-label="Close" data-tip="Close  Esc">${ic('x')}</button></div></header>
    <section class="rp-sec"><div class="rp-form-slot"></div></section>`);
  RLS.sel = null;
  rlMuted(g => { g.select(null, { frame: false }); g.selectLink(null); });
  const f = rlLinkForm(RLS.panelEl.querySelector('.rp-form-slot'), { a, b, onCancel: () => rlClose(true), onDone: async l => { await rlRefresh({ panel: false }); toast('Tie added'); rlOpenPerson(l.a, { frame: true }); } });
  f.focus();
}
/* Add from a profile: the person is one end already */
function rlInlineAdd(n) {
  const slot = RLS.panelEl.querySelector('.rp-add-slot'); if (!slot) return;
  if (slot.firstChild) { const i = slot.querySelector('.rf-pick-in, input'); if (i) i.focus(); return; }
  RLS.panelEl.querySelectorAll('.rp-link-edit:not([hidden])').forEach(x => { x.hidden = true; x.innerHTML = ''; });
  const f = rlLinkForm(slot, { a: n.id, fixed: n.id, inline: true, onCancel: () => { slot.innerHTML = ''; rlCatchUp(); }, onDone: async () => { await rlRefresh({ panel: false }); rlOpenPerson(n.id, { keepScroll: true }); } });
  f.focus();
}
function rlInlineEdit(linkId, selfId) {
  const li = RLS.panelEl.querySelector(`.rp-tie[data-link="${CSS.escape(linkId)}"]`), l = RLS.model.links.find(x => x.id === linkId);
  if (!li || !l) return;
  const box = li.querySelector('.rp-link-edit');
  if (!box.hidden) { if (rlDiscardOk()) { RLS.dirty = false; box.hidden = true; box.innerHTML = ''; li.classList.remove('editing'); } return; }
  RLS.panelEl.querySelectorAll('.rp-link-edit:not([hidden])').forEach(x => { x.hidden = true; x.innerHTML = ''; x.closest('.rp-tie').classList.remove('editing'); });
  box.hidden = false; li.classList.add('editing');
  const f = rlLinkForm(box, { link: l, inline: true, onCancel: () => { box.hidden = true; box.innerHTML = ''; li.classList.remove('editing'); rlCatchUp(); }, onDone: async () => { await rlRefresh({ panel: false }); rlOpenPerson(selfId, { keepScroll: true }); } });
  f.focus();
}

/* ----- a tie chosen on the web ----- */
function rlOpenLink(id, { keepScroll = false } = {}) {
  const l = RLS.model.links.find(x => x.id === id); if (!l) return;
  const a = rlNode(l.a), b = rlNode(l.b), k = REL_KINDS[l.kind];
  const when = l.ts ? new Date(l.ts) : null;
  rlShow('link', id, `<header class="rp-head rp-head-plain"><div class="rp-id"><h2 class="rp-name" tabindex="-1">${esc(k ? k.label : l.kind)}${l.label ? ` <span class="rp-name-l">${esc(l.label)}</span>` : ''}</h2>
      <div class="rp-chips"><span class="rp-chip plain">Tie</span><span class="rp-kchip" style="--k:var(--rk-${l.kind})">${esc((k && { warm: 'Warm', hostile: 'Hostile', structural: 'Structural' }[k.tone]) || '')}</span>${l.secret ? `<span class="rp-chip plain">${ic('eyeoff')}Secret</span>` : ''}${l.ended ? '<span class="rp-chip st st-dead">Ended</span>' : ''}</div></div>
      <div class="rp-tools"><button type="button" class="rp-tool" data-act="close" aria-label="Close" data-tip="Close  Esc">${ic('x')}</button></div></header>
    <section class="rp-sec">
      <div class="rp-pair" style="--k:var(--rk-${l.kind})">
        <button type="button" class="rp-end" data-go="${esc(a.id)}">${rlAv(a, 'lg')}<span>${esc(a.name)}</span><small>${esc(rlTypeLabel(a))}</small></button>
        <span class="rp-edge${l.dir === 'ab' ? ' one' : ''}${l.ended ? ' ended' : ''}${l.secret ? ' secret' : ''}" aria-hidden="true"><i></i>${l.dir === 'ab' ? ic('arrowright') : ''}</span>
        <button type="button" class="rp-end" data-go="${esc(b.id)}">${rlAv(b, 'lg')}<span>${esc(b.name)}</span><small>${esc(rlTypeLabel(b))}</small></button>
      </div>
    </section>
    <section class="rp-sec"><div class="rp-form-slot"></div>
      ${l.by || when ? `<p class="rp-meta">${l.by ? `Last changed by ${esc(shortName(l.by))}` : 'Last changed'}${when && !isNaN(when) ? ` · ${when.toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</p>` : ''}
    </section>`, { keepScroll });
  RLS.sel = null;
  rlMuted(g => { g.select(null, { frame: false }); g.selectLink(id); });
  RLS.panelEl.querySelectorAll('[data-go]').forEach(b2 => b2.onclick = () => rlGoTo(b2.dataset.go));
  rlLinkForm(RLS.panelEl.querySelector('.rp-form-slot'), { link: l, onCancel: () => rlClose(true), onDone: async saved => { await rlRefresh({ panel: false }); toast('Saved'); rlOpenLink(saved.id); } });
}

/* ----- add a person during play: a popover under "+ Person" (or N). Every field is labelled; nothing to decode. Name, NPC or
   faction, attitude (keys 1–6), up to three ties (type a name, or click people on the web) and the factions they belong to.
   While it's open the web keeps people out from under it. Two commits: the Codex entry (hidden from players), then their
   details and ties together. Enter adds; ⌘Enter adds and opens their profile. The web pans to them, pulses and keeps them
   selected a moment; Undo takes it all back. ----- */
function relNewPerson() { if (rlLive()) rlOpenQuick(); }
function rlOpenQuick({ name = '' } = {}) {
  if (!rlLive()) return;
  const anchor = RLS.root.querySelector('#rl-add-person');
  const facs = RLS.model.nodes.filter(n => n.type === 'faction').sort((a, b) => a.name.localeCompare(b.name));
  const kindOpts = RL_TONES.map(([t, tn]) => `<optgroup label="${tn}">${RL_KIND_LIST.filter(k => rlTone(k) === t).map(k => `<option value="${k}"${k === 'knows' ? ' selected' : ''}>${REL_KINDS[k].label}${REL_KINDS[k].directed ? ' →' : ''}</option>`).join('')}</optgroup>`).join('');
  const prevAccept = RLS.accept;
  RLS.qdirty = false;
  const el = rlPop(anchor, `<form class="rq" novalidate aria-label="Add a person">
      <div class="rq-h"><div><b>New person</b><span>Hidden from players until you reveal them.</span></div><button type="button" class="rp-tool sm rq-x" aria-label="Close" data-tip="Close  Esc">${ic('x')}</button></div>
      <div class="rq-f"><label class="rq-l" for="rq-name">Name or description</label>
        <input class="rq-name" id="rq-name" maxlength="80" value="${esc(name)}" placeholder="e.g. a nervous dockhand" autocomplete="off" spellcheck="false"></div>
      <p class="rf-warn rq-dup" hidden></p>
      <div class="rq-f"><span class="rq-l" id="rq-t-l">Type</span><div class="rl-seg sm rq-type" role="radiogroup" aria-labelledby="rq-t-l"><button type="button" role="radio" data-t="npc" aria-checked="true">${ic('usercircle')}NPC</button><button type="button" role="radio" data-t="faction" aria-checked="false">${ic('hexagon')}Faction</button></div></div>
      <div class="rq-f"><span class="rq-l" id="rq-a-l">Attitude to the party <span>keys 1–6</span></span>
        <div class="rq-att" role="radiogroup" aria-labelledby="rq-a-l">${RL_ATT_SCALE.map((v, i) => `<button type="button" role="radio" class="rq-seg s-${v}" data-v="${v}" aria-checked="${v === 'unknown'}" tabindex="${v === 'unknown' ? 0 : -1}" aria-keyshortcuts="${i + 1}"><i aria-hidden="true"></i><span>${v === 'unknown' ? '?' : esc(rlAttName(v))}</span></button>`).join('')}</div></div>
      <div class="rq-f"><span class="rq-l">Tied to <span>type a name, or click people on the web</span></span><div class="rq-ties"></div>
        <button type="button" class="rl-linkish rq-addtie">${ic('plus')}Another tie</button></div>
      ${facs.length ? `<div class="rq-f rq-member"><span class="rq-l">Member of</span><div class="rq-facs">${facs.map(f => `<button type="button" class="rq-fac" data-f="${esc(f.id)}" aria-pressed="false" style="--fc:${rlFactionColor(f.id)}">${ic('check', 'rq-fac-ck')}<i aria-hidden="true"></i>${esc(f.name)}</button>`).join('')}</div></div>` : ''}
      <p class="rf-err" role="alert" hidden></p>
      <div class="rq-foot"><span class="rq-keys"><kbd>Enter</kbd> add · <kbd>⌘ Enter</kbd> add and open</span><button type="submit" class="btn primary small">Add</button></div>
    </form>`, { cls: 'rl-pop-quick', align: 'end', width: 380,
    onClose: () => {
      RLS.qdirty = false; RLS.accept = prevAccept && prevAccept !== quickAccept ? prevAccept : null;
      if (RLS.root) RLS.root.classList.remove('rl-picking');
      RLS.insExtra = null; rlInsets(true);           // the web goes back where it was
    },
    keepOn: t => RLS.qdirty || (RLS.stage && RLS.stage.contains(t)),   // clicks on the web fill a tie; a half-typed person isn't thrown away
    canClose: () => !RLS.qdirty || confirm('Discard this new person?') });
  if (!el) return;
  // pick mode: people on the web can be clicked straight into a tie; the web makes room beside the popover
  RLS.root.classList.add('rl-picking');
  if (!rlPhone()) { RLS.insExtra = { right: el.offsetWidth + 28 }; rlInsets(true); }
  el.querySelector('.rq-x').onclick = () => rlPopClose(true, true);
  const form = el.querySelector('form'), nameIn = form.querySelector('.rq-name'), err = form.querySelector('.rf-err'), tiesBox = form.querySelector('.rq-ties');
  let type = 'npc', att = 'unknown', openAfter = false;
  const ties = [];
  const addTie = () => {
    if (ties.length >= 3) return null;
    const row = document.createElement('div'); row.className = 'rq-tie';
    row.innerHTML = `<select class="rq-kind" aria-label="Kind of tie">${kindOpts}</select><div class="rf-slot"></div>${ties.length ? `<button type="button" class="rf-chip-x" aria-label="Remove this tie">${ic('x')}</button>` : ''}`;
    tiesBox.appendChild(row);
    const t = { row, kind: row.querySelector('select'), who: rlPicker(row.querySelector('.rf-slot'), { label: 'Tied to', placeholder: ties.length ? 'and who…' : 'Who…  (optional)', compact: true, onChange: () => { RLS.qdirty = true; rlPopPlace(); } }) };
    ties.push(t);
    t.kind.onchange = () => { RLS.qdirty = true; };
    const x = row.querySelector('.rf-chip-x'); if (x) x.onclick = () => { ties.splice(ties.indexOf(t), 1); row.remove(); form.querySelector('.rq-addtie').hidden = false; rlPopPlace(); };
    form.querySelector('.rq-addtie').hidden = ties.length >= 3;
    rlPopPlace();
    return t;
  };
  addTie();
  form.querySelector('.rq-addtie').onclick = () => { const t = addTie(); if (t) t.who.focus(); };
  // a click on the web fills the first empty tie
  const quickAccept = id => { if (!form.isConnected) return false; const t = ties.find(x => !x.who.get()) || (ties.length < 3 ? addTie() : ties[ties.length - 1]); t.who.set(id); RLS.qdirty = true; rlPopPlace(); return true; };
  RLS.accept = quickAccept;
  form.querySelectorAll('.rq-type [role="radio"]').forEach(b => b.onclick = () => {
    form.querySelectorAll('.rq-type [role="radio"]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
    type = b.dataset.t; nameIn.placeholder = type === 'faction' ? 'e.g. The Lantern Guild' : 'e.g. a nervous dockhand';
    const mem = form.querySelector('.rq-member'); if (mem) mem.hidden = type === 'faction';
    dupCheck(); RLS.qdirty = true; rlPopPlace();
  });
  const segs = [...form.querySelectorAll('.rq-seg')];
  const setAtt = b => { att = b.dataset.v; segs.forEach(x => { const on = x === b; x.setAttribute('aria-checked', String(on)); x.tabIndex = on ? 0 : -1; }); RLS.qdirty = true; };
  segs.forEach(b => b.onclick = () => setAtt(b));
  form.querySelector('.rq-att').addEventListener('keydown', e => {
    const i = segs.indexOf(document.activeElement), j = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : null;
    if (j === null || i < 0) return; e.preventDefault(); const b = segs[(j + segs.length) % segs.length]; b.focus(); setAtt(b);
  });
  form.querySelectorAll('.rq-fac').forEach(b => b.onclick = () => { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); RLS.qdirty = true; });
  const dupCheck = () => {
    const v = rlNorm(nameIn.value.trim()), w = form.querySelector('.rq-dup');
    const same = v && RLS.model.nodes.find(n => rlNorm(n.name) === v);
    w.hidden = !same;
    if (same) { w.innerHTML = `${esc(same.name)} is already here (${esc(rlTypeLabel(same))}). <button type="button" class="rl-linkish">Open them instead</button>`; w.querySelector('button').onclick = () => { RLS.qdirty = false; rlPopClose(); rlGoTo(same.id, { focus: true }); }; }
    rlPopPlace();
  };
  nameIn.addEventListener('input', () => { RLS.qdirty = !!nameIn.value.trim(); dupCheck(); err.hidden = true; });
  form.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); openAfter = true; form.requestSubmit(); return; }
    // 1–6 pick the attitude (not while typing in a text field)
    const typing = e.target.matches && e.target.matches('input[type="text"], input:not([type]), textarea');
    if (!typing && !e.metaKey && !e.ctrlKey && !e.altKey && /^[1-6]$/.test(e.key)) { e.preventDefault(); const b = segs[Number(e.key) - 1]; b.focus(); setAtt(b); }
  });
  let busy = false;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const nm = nameIn.value.trim().replace(/\s+/g, ' ');
    if (!nm) { err.textContent = 'Give them a name or a short description.'; err.hidden = false; nameIn.focus(); openAfter = false; rlPopPlace(); return; }
    busy = true; form.classList.add('busy'); form.querySelector('[type="submit"]').disabled = true;
    const open = openAfter; openAfter = false;
    try {
      const entry = await api('/api/codex', { method: 'POST', body: { name: nm, category: type, playerContent: '', dmContent: '', image: '', revealed: false } });
      const id = 'codex:' + entry.id, person = { attitude: att }, add = [];
      for (const t of ties) {
        const o = t.who.get(); if (!o || typeof o !== 'string' || !rlNode(o) || o === id) continue;
        const kind = t.kind.value; let [a, b] = [id, o];
        if (kind === 'member' && type === 'faction' && rlNode(o).type !== 'faction') [a, b] = [o, id]; // a new faction has members
        add.push({ a, b, kind, dir: REL_KINDS[kind].directed ? 'ab' : 'both' });
      }
      if (type !== 'faction') form.querySelectorAll('.rq-fac[aria-pressed="true"]').forEach(f => { if (!add.some(x => x.kind === 'member' && x.b === f.dataset.f)) add.push({ a: id, b: f.dataset.f, kind: 'member', dir: 'both' }); });
      // they appear 90px from whoever they're first tied to
      const near = add.length ? (add[0].a === id ? add[0].b : add[0].a) : null;
      if (near && RLS.g) { try { const p = RLS.g.positions()[near]; if (p) { const t = Math.random() * Math.PI * 2; person.x = Math.round(p.x + 90 * Math.cos(t)); person.y = Math.round(p.y + 90 * Math.sin(t)); } } catch (_) { /* placed by the web */ } }
      const res = await rlWrite(() => api('/api/relations/apply', { method: 'POST', body: { people: { [id]: person }, add } }));
      RLS.qdirty = false;
      rlPopClose();
      await rlRefresh({ panel: false });
      if (open) rlOpenPerson(id, { frame: true, focus: true });
      else {
        rlMuted(g => { g.select(id, { frame: false }); g.panTo(id); g.pulse(id); });
        setTimeout(() => { if (!(RLS.panel && RLS.panel.id === id)) rlMuted(g => g.select(RLS.panel && RLS.panel.mode === 'person' ? RLS.panel.id : null, { frame: false })); }, 2000);
      }
      if (open) rlMuted(g => g.pulse(id));
      const added = (res && res.added) || [];
      rlUndoToast(`Added ${nm}`, async () => {
        try {
          await rlWrite(() => api('/api/relations/apply', { method: 'POST', body: { del: added.map(l => l.id), people: { [id]: { attitude: null, x: null, y: null } } } }));
          await api(`/api/codex/${entry.id}`, { method: 'DELETE' });
          if (RLS.panel && RLS.panel.id === id) rlClose(true);
          toast(`Removed ${nm}`);
        } catch (_) { /* toast already */ }
        rlRefresh({ panel: 'force' });
      }, 5000);
    } catch (e2) {
      err.textContent = e2.message || 'Could not add them'; err.hidden = false; rlPopPlace();
      busy = false; if (form.isConnected) { form.classList.remove('busy'); form.querySelector('[type="submit"]').disabled = false; }
    }
  });
  nameIn.focus();
  if (name) { nameIn.setSelectionRange(name.length, name.length); RLS.qdirty = true; dupCheck(); }
}
function rlPopPlace() { if (RLS.pop && RLS.pop.place) RLS.pop.place(); }

/* ----- ties to deleted people ----- */
function rlOpenCleanup() {
  const d = RLS.model.dangling;
  if (!d.length) { if (RLS.panel && RLS.panel.mode === 'cleanup') rlClose(true); return; }
  const end = id => (rlNode(id) ? `<b>${esc(rlNameOf(id))}</b>` : '<span class="rp-gone">a deleted entry</span>');
  rlShow('cleanup', null, `<header class="rp-head rp-head-plain"><div class="rp-id"><h2 class="rp-name" tabindex="-1">Broken ties</h2><p class="rp-sub">${rlPlural(d.length, 'tie')} to someone who was deleted.</p></div>
    <div class="rp-tools"><button type="button" class="rp-tool" data-act="close" aria-label="Close" data-tip="Close  Esc">${ic('x')}</button></div></header>
    <section class="rp-sec"><p class="rp-none">Their Codex entry or character is gone, so these are hidden from the web. Remove them, or recreate the entry to bring them back.</p>
      <ul class="rp-broken">${d.map(l => `<li><span class="rl-sw">${rlSwatch('link', REL_KINDS[l.kind] ? l.kind : 'knows')}</span><span>${end(l.a)} <em>${esc(REL_KINDS[l.kind] ? REL_KINDS[l.kind].label.toLowerCase() : l.kind)}</em> ${end(l.b)}${l.label ? ` · ${esc(l.label)}` : ''}</span></li>`).join('')}</ul>
      <div class="rf-actions"><button type="button" class="btn small danger" data-act="purge">${ic('trash')}Remove ${d.length === 1 ? 'it' : `all ${d.length}`}</button><button type="button" class="btn small ghost" data-act="close">Not now</button></div>
    </section>`);
  RLS.panelEl.querySelector('[data-act="purge"]').onclick = async e => {
    e.currentTarget.disabled = true;
    try { await rlWrite(() => api('/api/relations/apply', { method: 'POST', body: { del: d.map(l => l.id) } })); toast(`Removed ${rlPlural(d.length, 'broken tie')}`); }
    catch (_) { /* toast already */ }
    rlClose(true); rlRefresh();
  };
}

/* ---------- keyboard: app.js forwards Esc, "/" and N on this page ---------- */
function relEscape(e) {
  if (!rlLive()) return false;
  if (RLS.pop) { e.preventDefault(); rlPopClose(true, true); return true; }
  const lg = RLS.root.querySelector('#rl-legend');
  if (lg && lg.classList.contains('sheet')) { e.preventDefault(); rlLegendSheet(false); return true; }
  const t = e.target, typing = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  if (typing && RLS.root.contains(t)) { e.preventDefault(); t.blur(); return true; }
  if (RLS.panel) { e.preventDefault(); rlClose(); return true; }
  if (RLS.query) { e.preventDefault(); const q = RLS.root.querySelector('#rl-q'); if (q) q.value = ''; RLS.query = ''; rlFilter(); return true; }
  return false;
}
function relFocusSearch() { const q = rlLive() && RLS.root.querySelector('#rl-q'); if (!q) return false; q.focus(); q.select(); return true; }
