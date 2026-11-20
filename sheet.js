/* sheet.js — the character sheet (Party → a character), laid out like the 2014 5e paper sheet.
   Plain fields for now: nothing is worked out from the rules yet, so homebrew fits anywhere.
   Two homes for the data:
     src "c" — fields on the character itself (name, race, class, level, AC, HP, conditions, gold, notes),
               because the tracker, battle map and DM chat read them;
     src "s" — everything else, in the character's own sheet file (data/sheets/<id>.json).
   Saving: every edit goes into a small queue (also kept in this browser, so a dropped connection or a closed tab
   loses nothing) and is sent in batches about a second after you stop typing. Edits from other screens arrive
   field by field and never overwrite the box you are typing in. */
'use strict';

const SHEET_ABILITIES = [['str', 'Strength'], ['dex', 'Dexterity'], ['con', 'Constitution'], ['int', 'Intelligence'], ['wis', 'Wisdom'], ['cha', 'Charisma']];
const SHEET_SKILLS = [
  ['acrobatics', 'Acrobatics', 'Dex'], ['animal', 'Animal Handling', 'Wis'], ['arcana', 'Arcana', 'Int'], ['athletics', 'Athletics', 'Str'],
  ['deception', 'Deception', 'Cha'], ['history', 'History', 'Int'], ['insight', 'Insight', 'Wis'], ['intimidation', 'Intimidation', 'Cha'],
  ['investigation', 'Investigation', 'Int'], ['medicine', 'Medicine', 'Wis'], ['nature', 'Nature', 'Int'], ['perception', 'Perception', 'Wis'],
  ['performance', 'Performance', 'Cha'], ['persuasion', 'Persuasion', 'Cha'], ['religion', 'Religion', 'Int'], ['sleight', 'Sleight of Hand', 'Dex'],
  ['stealth', 'Stealth', 'Dex'], ['survival', 'Survival', 'Wis']
];
const SHEET_SECTIONS = [
  ['basics', 'Basics'], ['abilities', 'Abilities'], ['saves', 'Saving throws'], ['skills', 'Skills'], ['combat', 'Combat'],
  ['attacks', 'Attacks'], ['spells', 'Spellcasting'], ['features', 'Features & traits'], ['profs', 'Proficiencies & languages'],
  ['gear', 'Equipment & money'], ['personality', 'Personality'], ['appearance', 'Appearance'], ['allies', 'Allies & organisations'],
  ['backstory', 'Backstory'], ['notes', 'Notes']
];
// list sections: columns are [key, label, type]
const SHEET_ROWS = {
  classes: { cols: [['name', 'Class'], ['subclass', 'Subclass'], ['level', 'Level', 'num'], ['hitDie', 'Hit die']], add: 'Add a class', empty: 'One class? The Class box above is enough. Add rows here for multiclassing.' },
  attacks: { cols: [['name', 'Name'], ['bonus', 'Atk bonus'], ['damage', 'Damage / type'], ['notes', 'Range, properties, notes']], add: 'Add an attack', empty: 'No attacks yet.' },
  cantrips: { cols: [['name', 'Cantrip'], ['notes', 'Notes']], add: 'Add a cantrip', empty: 'No cantrips.' },
  spells: { cols: [['prepared', 'Prepared', 'check'], ['name', 'Spell'], ['notes', 'Notes']], add: 'Add a spell', empty: 'No spells at this level.' },
  features: { cols: [['name', 'Name'], ['source', 'From (race, class, feat…)'], ['text', 'What it does', 'area']], add: 'Add a feature or trait', empty: 'No features or traits yet.' },
  items: { cols: [['equipped', 'Equipped', 'check'], ['name', 'Item'], ['qty', 'Qty', 'num'], ['weight', 'Weight'], ['notes', 'Notes']], add: 'Add an item', empty: 'No equipment yet.' }
};
const PROF_LEVELS = { '': { sym: '○', label: 'Not proficient' }, p: { sym: '●', label: 'Proficient' }, e: { sym: '◉', label: 'Expertise' } };
const PROF_NEXT = { '': 'p', p: 'e', e: '' };

// ---------- path helpers (same path language as applySheetOps in gh.js) ----------
function sheetGet(obj, p) {
  let cur = obj;
  for (const s of String(p).split('.')) {
    if (cur == null) return undefined;
    cur = s[0] === '@' ? (Array.isArray(cur) ? cur.find(x => x && x.id === s.slice(1)) : undefined) : cur[s];
  }
  return cur;
}
const emptyQ = () => ({ c: {}, ops: [] });
const qEmpty = q => !q || (!Object.keys(q.c).length && !q.ops.length);
/* older + newer → one queue; a later "set" on the same path replaces the earlier one */
function qMerge(older, newer) {
  const out = { c: { ...older.c, ...newer.c }, ops: [] };
  const laterSets = new Set(newer.ops.filter(o => o.op === 'set').map(o => o.p));
  out.ops = [...older.ops.filter(o => !(o.op === 'set' && laterSets.has(o.p))), ...newer.ops];
  return out;
}

// ---------- save queue, one per character (outlives the page that made the edit) ----------
const SHEET_SYNC = new Map(); // id -> { q, inflight, timer, fails, status, msg }
const sheetQKey = id => `gc_sheetq_${(S.me && S.me.id) || 'anon'}_${id}`;
function sheetSync(id) {
  let st = SHEET_SYNC.get(id);
  if (!st) {
    let q = emptyQ();
    try { const saved = JSON.parse(localStorage.getItem(sheetQKey(id)) || 'null'); if (saved && saved.c && Array.isArray(saved.ops)) q = saved; } catch (_) { /* ignore */ }
    st = { id, q, inflight: null, timer: null, fails: 0, status: qEmpty(q) ? 'saved' : 'pending', msg: '' };
    SHEET_SYNC.set(id, st);
    if (!qEmpty(q)) sheetSchedule(st, 500); // edits left over from last time: send them now
  }
  return st;
}
function sheetPersist(st) {
  const all = st.inflight ? qMerge(st.inflight, st.q) : st.q;
  try { if (qEmpty(all)) localStorage.removeItem(sheetQKey(st.id)); else localStorage.setItem(sheetQKey(st.id), JSON.stringify(all)); } catch (_) { /* storage full or blocked: still saving in memory */ }
}
function sheetPending(st) { return st.inflight ? qMerge(st.inflight, st.q) : st.q; }
function sheetSchedule(st, ms) {
  clearTimeout(st.timer);
  st.timer = setTimeout(() => sheetFlush(st), ms);
}
async function sheetFlush(st) {
  if (st.inflight) { st.again = true; return; }
  if (qEmpty(st.q)) { sheetStatus(st, 'saved'); return; }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) { sheetStatus(st, 'offline'); return; } // the 'online' event resumes
  const batch = st.q; st.q = emptyQ(); st.inflight = batch; st.again = false;
  sheetStatus(st, 'saving');
  try {
    if (Object.keys(batch.c).length) { await api(`/api/characters/${st.id}`, { method: 'PATCH', body: batch.c, quiet: true }); batch.c = {}; }
    if (batch.ops.length) { await api(`/api/characters/${st.id}/sheet`, { method: 'POST', body: { ops: batch.ops }, quiet: true }); batch.ops = []; }
    st.fails = 0; st.inflight = null; sheetPersist(st);
    sheetStatus(st, qEmpty(st.q) ? 'saved' : 'pending');
    if (!qEmpty(st.q)) sheetSchedule(st, 400);
  } catch (e) {
    st.q = qMerge(batch, st.q); st.inflight = null; sheetPersist(st); // keep everything not yet sent, in order
    st.fails++;
    const permanent = [400, 401, 403, 404, 413].includes(e.code);
    sheetStatus(st, permanent ? 'blocked' : 'retry', e.message || 'Could not save');
    if (!permanent) sheetSchedule(st, Math.min(30000, 2000 * 2 ** Math.min(st.fails - 1, 4)));
  }
}
function sheetStatus(st, status, msg = '') {
  st.status = status; st.msg = msg;
  if (SHEET_VIEW && SHEET_VIEW.id === st.id) paintSheetStatus();
}
function sheetQueueSet(id, src, p, v) {
  const st = sheetSync(id);
  if (src === 'c') st.q.c[p] = v;
  else st.q = qMerge(st.q, { c: {}, ops: [{ op: 'set', p, v }] });
  sheetPersist(st); sheetStatus(st, 'pending'); sheetSchedule(st, 1000);
}
function sheetQueueOp(id, op) {
  const st = sheetSync(id);
  st.q = qMerge(st.q, { c: {}, ops: [op] });
  sheetPersist(st); sheetStatus(st, 'pending'); sheetSchedule(st, 300);
}
function sheetResumeAll() { for (const st of SHEET_SYNC.values()) if (!qEmpty(st.q) && !st.inflight) sheetSchedule(st, 200); }
/* Saves left from an earlier visit (this person, this browser) start again as soon as the Party tab opens. */
function sheetResumeStored() {
  try {
    const pre = `gc_sheetq_${(S.me && S.me.id) || 'anon'}_`;
    for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith(pre)) sheetSync(k.slice(pre.length)); }
  } catch (_) { /* ignore */ }
}
window.addEventListener('online', sheetResumeAll);
document.addEventListener('visibilitychange', () => { if (!document.hidden) sheetResumeAll(); });
window.addEventListener('beforeunload', e => {
  for (const st of SHEET_SYNC.values()) if (!qEmpty(sheetPending(st))) { e.preventDefault(); e.returnValue = ''; return; }
});

// ---------- the open sheet ----------
let SHEET_VIEW = null; // { id, ch, sheet, ed, root }
function sheetVal(src, p) { return src === 'c' ? (SHEET_VIEW.ch || {})[p] : sheetGet(SHEET_VIEW.sheet, p); }
function sheetIsPending(src, p) {
  const st = SHEET_SYNC.get(SHEET_VIEW.id); if (!st) return false;
  const q = sheetPending(st);
  return src === 'c' ? p in q.c : q.ops.some(o => o.op === 'set' && o.p === p);
}
const fv = v => (v == null ? '' : String(v));

/* one field. src 'c' | 's', p = path, t = text | num | area | check | prof */
function sf(src, p, label, o = {}) {
  const t = o.t || 'text', v = sheetVal(src, p), ed = SHEET_VIEW.ed;
  const attrs = `data-src="${src}" data-p="${esc(p)}" data-t="${t}" aria-label="${esc(o.aria || label)}"`;
  let ctl;
  if (t === 'area') ctl = `<textarea ${attrs} rows="${o.rows || 3}" ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${ed ? '' : 'readonly'}>${esc(fv(v))}</textarea>`;
  else if (t === 'check') ctl = `<input type="checkbox" ${attrs} ${v ? 'checked' : ''} ${ed ? '' : 'disabled'}>`;
  else if (t === 'prof') { const lv = PROF_LEVELS[v] ? v : ''; ctl = `<button type="button" class="prof-dot lv-${lv || 'n'}" ${attrs} data-v="${lv}" title="${PROF_LEVELS[lv].label}${ed ? ' (click to change)' : ''}" ${ed ? '' : 'disabled'}>${PROF_LEVELS[lv].sym}</button>`; }
  else ctl = `<input ${attrs} value="${esc(fv(v))}" ${t === 'num' ? 'inputmode="numeric"' : ''} ${o.ph ? `placeholder="${esc(o.ph)}"` : ''} ${ed ? '' : 'readonly'} autocomplete="off">`;
  if (o.step && ed && t === 'num') ctl = `<div class="sf-step"><button type="button" class="btn step" data-step="-1" data-for-src="${src}" data-for-p="${esc(p)}" aria-label="${esc(label)} down">−</button>${ctl}<button type="button" class="btn step" data-step="1" data-for-src="${src}" data-for-p="${esc(p)}" aria-label="${esc(label)} up">+</button></div>`;
  if (o.bare) return ctl;
  if (t === 'check') return `<label class="sf sf-check ${o.cls || ''}">${ctl}<span class="sf-l">${label}</span></label>`;
  return `<label class="sf ${o.cls || ''}"><span class="sf-l">${label}</span>${ctl}</label>`;
}
function rowsHTML(p, kind) {
  const def = SHEET_ROWS[kind], ed = SHEET_VIEW.ed;
  const list = (sheetGet(SHEET_VIEW.sheet, p) || []).filter(r => r && r.id);
  const cls = c => `c-${c[2] || 'text'} c-${c[0]}`;
  const head = `<div class="rows-h">${def.cols.map(c => `<span class="${cls(c)}">${c[1]}</span>`).join('')}${ed ? '<span class="c-del"></span>' : ''}</div>`;
  const body = list.map(r => `<div class="row-i" data-row="${esc(r.id)}">${def.cols.map(c => `<div class="${cls(c)}" data-col="${esc(c[1])}">${sf('s', `${p}.@${r.id}.${c[0]}`, c[1], { t: c[2] || 'text', bare: true, rows: 2, aria: `${c[1]}` })}</div>`).join('')}
    ${ed ? `<button type="button" class="row-del" data-del="${esc(p)}.@${esc(r.id)}" aria-label="Remove this row" data-tip="Remove">${ic('x')}</button>` : ''}</div>`).join('');
  return `<div class="rows rows-${kind} ${ed ? '' : 'ro'}" data-rows="${esc(p)}" data-kind="${kind}" data-ids="${list.map(r => r.id).join(',')}">
    ${list.length ? head + body : `<p class="muted rows-empty">${def.empty}</p>`}
    ${ed ? `<button type="button" class="btn small rows-add" data-add="${esc(p)}" data-kind="${kind}">${ic('plus')} ${def.add}</button>` : ''}</div>`;
}

function sectionBody(id) {
  const ed = SHEET_VIEW.ed;
  switch (id) {
    case 'basics': return `<div class="sf-grid">
        ${sf('c', 'name', 'Character name')}${sf('c', 'player', 'Player name')}${sf('c', 'race', 'Race')}
        ${sf('c', 'klass', 'Class & subclass', { ph: 'Rogue (Assassin)' })}${sf('c', 'level', 'Level', { t: 'num' })}
        ${sf('s', 'background', 'Background')}${sf('s', 'alignment', 'Alignment')}
        ${sf('s', 'xp', 'Experience points', { t: 'num' })}${sf('s', 'xpNext', 'Next level at', { t: 'num' })}</div>
      <h4 class="sheet-sub">Class levels</h4>${rowsHTML('classes', 'classes')}`;
    case 'abilities': return `<div class="abil-grid">${SHEET_ABILITIES.map(([k, n]) => `<div class="abil">
        <span class="abil-n">${n}</span>${sf('s', `abilities.${k}.score`, `${n} score`, { t: 'num', bare: true })}
        <span class="abil-m">${sf('s', `abilities.${k}.mod`, `${n} modifier`, { bare: true, ph: '+0' })}</span></div>`).join('')}</div>
      <div class="sf-grid">${sf('s', 'prof', 'Proficiency bonus', { ph: '+2' })}${sf('s', 'inspiration', 'Inspiration', { t: 'check' })}</div>`;
    case 'saves': return `<div class="save-list">${SHEET_ABILITIES.map(([k, n]) => `<div class="skill">
        ${sf('s', `saves.${k}.prof`, `${n} save proficient`, { t: 'check', bare: true })}
        ${sf('s', `saves.${k}.bonus`, `${n} save bonus`, { bare: true, ph: '+0' })}<span class="skill-n">${n}</span></div>`).join('')}</div>`;
    case 'skills': return `<p class="muted sheet-hint">${ed ? 'Tap the dot: ○ none, ● proficient, ◉ expertise.' : '○ none · ● proficient · ◉ expertise'}</p>
      <div class="skill-list">${SHEET_SKILLS.map(([k, n, a]) => `<div class="skill">
        ${sf('s', `skills.${k}.prof`, `${n} proficiency`, { t: 'prof', bare: true })}
        ${sf('s', `skills.${k}.bonus`, `${n} bonus`, { bare: true, ph: '+0' })}<span class="skill-n">${n} <small>${a}</small></span></div>`).join('')}</div>
      <div class="sf-grid">${sf('s', 'passivePerception', 'Passive Wisdom (Perception)', { t: 'num' })}</div>`;
    case 'combat': return `<div class="sf-grid">
        ${sf('c', 'ac', 'Armour class', { t: 'num' })}${sf('s', 'initiative', 'Initiative', { ph: '+2' })}${sf('s', 'speed', 'Speed', { ph: '30 ft' })}
        ${sf('c', 'hpMax', 'Hit point maximum', { t: 'num' })}${sf('c', 'hpCurrent', 'Current hit points', { t: 'num', step: true })}${sf('s', 'hpTemp', 'Temporary hit points', { t: 'num', step: true })}
        ${sf('s', 'hitDice', 'Hit dice', { ph: '3d8' })}${sf('s', 'hitDiceLeft', 'Hit dice left', { t: 'num', step: true })}
        ${sf('c', 'conditions', 'Conditions', { ph: 'poisoned, prone…', cls: 'sf-wide' })}</div>
      <div class="death">
        <span class="sf-l">Death saves</span>
        <span class="death-row"><b>Successes</b>${[1, 2, 3].map(i => sf('s', `deathSaves.s${i}`, `Death save success ${i}`, { t: 'check', bare: true })).join('')}</span>
        <span class="death-row"><b>Failures</b>${[1, 2, 3].map(i => sf('s', `deathSaves.f${i}`, `Death save failure ${i}`, { t: 'check', bare: true })).join('')}</span>
      </div>`;
    case 'attacks': return `${rowsHTML('attacks', 'attacks')}
      <div class="sf-grid">${sf('s', 'attackNotes', 'Attack notes (sneak attack, special moves…)', { t: 'area', rows: 4, cls: 'sf-wide' })}</div>`;
    case 'spells': {
      const lv = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(L => {
        const has = (sheetGet(SHEET_VIEW.sheet, `spells.${L}`) || []).length || sheetGet(SHEET_VIEW.sheet, `slots.${L}.max`);
        return `<details class="spl" data-lvl="${L}" ${has ? 'open' : ''}><summary>Level ${L}<span class="spl-slots" data-slots="${L}">${slotSummary(L)}</span></summary>
          <div class="sf-grid sf-tight">${sf('s', `slots.${L}.max`, 'Slots', { t: 'num' })}${sf('s', `slots.${L}.used`, 'Used', { t: 'num', step: true })}</div>
          ${rowsHTML(`spells.${L}`, 'spells')}</details>`;
      }).join('');
      return `<div class="sf-grid">${sf('s', 'spell.class', 'Spellcasting class')}${sf('s', 'spell.ability', 'Spellcasting ability', { ph: 'Charisma' })}
          ${sf('s', 'spell.dc', 'Spell save DC', { t: 'num' })}${sf('s', 'spell.attack', 'Spell attack bonus', { ph: '+5' })}</div>
        <h4 class="sheet-sub">Cantrips</h4>${rowsHTML('cantrips', 'cantrips')}
        <h4 class="sheet-sub">Spells by level</h4>${lv}`;
    }
    case 'features': return rowsHTML('features', 'features');
    case 'profs': return `<div class="sf-grid sf-cols2">
        ${sf('s', 'languages', 'Languages', { t: 'area', rows: 2 })}${sf('s', 'proficiencies.armor', 'Armour', { t: 'area', rows: 2 })}
        ${sf('s', 'proficiencies.weapons', 'Weapons', { t: 'area', rows: 2 })}${sf('s', 'proficiencies.tools', 'Tools', { t: 'area', rows: 2 })}
        ${sf('s', 'proficiencies.vehicles', 'Vehicles', { t: 'area', rows: 2 })}${sf('s', 'proficiencies.other', 'Other proficiencies', { t: 'area', rows: 2 })}
        ${sf('s', 'otherSpeeds', 'Other speeds (climb, swim, fly)', { ph: 'Swim 30 ft' })}</div>`;
    case 'gear': return `<div class="coins">${sf('s', 'coins.cp', 'CP', { t: 'num' })}${sf('s', 'coins.sp', 'SP', { t: 'num' })}${sf('s', 'coins.ep', 'EP', { t: 'num' })}${sf('c', 'gold', 'GP', { t: 'num' })}${sf('s', 'coins.pp', 'PP', { t: 'num' })}</div>
      ${rowsHTML('items', 'items')}
      <div class="sf-grid">${sf('s', 'treasure', 'Other treasure & loot', { t: 'area', rows: 3, cls: 'sf-wide' })}</div>`;
    case 'personality': return `<div class="sf-grid sf-cols2">
        ${sf('s', 'personality.traits', 'Personality traits', { t: 'area' })}${sf('s', 'personality.ideals', 'Ideals', { t: 'area' })}
        ${sf('s', 'personality.bonds', 'Bonds', { t: 'area' })}${sf('s', 'personality.flaws', 'Flaws', { t: 'area' })}</div>`;
    case 'appearance': return `<div class="sf-grid">
        ${sf('s', 'look.age', 'Age')}${sf('s', 'look.height', 'Height')}${sf('s', 'look.weight', 'Weight')}${sf('s', 'look.size', 'Size', { ph: 'Medium' })}
        ${sf('s', 'look.gender', 'Gender')}${sf('s', 'look.eyes', 'Eyes')}${sf('s', 'look.hair', 'Hair')}${sf('s', 'look.skin', 'Skin')}
        ${sf('s', 'look.notes', 'What they look like', { t: 'area', rows: 3, cls: 'sf-wide' })}</div>`;
    case 'allies': return `<div class="sf-grid">${sf('s', 'allies', 'Allies, organisations, contacts', { t: 'area', rows: 6, cls: 'sf-wide' })}</div>`;
    case 'backstory': return `<div class="sf-grid">${sf('s', 'backstory', 'Backstory', { t: 'area', rows: 10, cls: 'sf-wide' })}</div>`;
    case 'notes': return `<p class="muted sheet-hint">Free text, markdown ok. Older sheets copied in from documents live here.</p>
      ${ed ? `<div class="row"><button type="button" class="btn small" id="edit-content">${ic('pencil')} Edit notes</button></div>` : ''}
      <div id="content-view">${md(SHEET_VIEW.ch.content) || '<p class="muted">No notes.</p>'}</div>`;
  }
  return '';
}
function slotSummary(L) {
  const max = sheetGet(SHEET_VIEW.sheet, `slots.${L}.max`), used = sheetGet(SHEET_VIEW.sheet, `slots.${L}.used`);
  const n = (sheetGet(SHEET_VIEW.sheet, `spells.${L}`) || []).length;
  return [max ? `${Math.max(0, (Number(max) || 0) - (Number(used) || 0))}/${max} slots left` : '', n ? `${n} spell${n === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ');
}
function headHTML() {
  const ch = SHEET_VIEW.ch, ed = SHEET_VIEW.ed;
  const max = Number(ch.hpMax) || 0, cur = Number(ch.hpCurrent ?? 0);
  const pct = max ? Math.max(0, Math.min(100, 100 * cur / max)) : null;
  return `<div class="sheet-id">
      ${ch.portrait ? `<img class="portrait" src="${esc(ch.portrait)}" alt="">` : `<div class="portrait-ph">${esc((ch.name || '?')[0])}</div>`}
      <div class="sheet-id-t"><h2>${esc(ch.name || 'Unnamed')}</h2>
        <div class="muted">${esc([ch.race, ch.klass].filter(Boolean).join(' '))}${ch.level ? ` · level ${esc(ch.level)}` : ''}${ch.player ? ` · played by ${esc(ch.player)}` : ''}</div>
        ${pct !== null ? `<div class="hp-bar" aria-hidden="true"><div class="${pct < 30 ? 'low' : ''}" style="width:${pct}%"></div></div>` : ''}</div></div>
    <div class="sheet-quick">
      ${sf('c', 'ac', 'AC', { t: 'num', cls: 'q' })}
      ${sf('c', 'hpCurrent', 'HP', { t: 'num', step: true, cls: 'q q-hp' })}
      ${sf('c', 'hpMax', 'Max HP', { t: 'num', cls: 'q' })}
      ${sf('s', 'hpTemp', 'Temp HP', { t: 'num', cls: 'q' })}
      ${ed ? `<div class="sf q q-dmg"><span class="sf-l">Damage / heal</span><div class="dmg-row"><input id="dmg-n" inputmode="numeric" placeholder="0" aria-label="Amount of damage or healing" autocomplete="off">
        <button type="button" class="btn small" data-hp="dmg">Damage</button><button type="button" class="btn small" data-hp="heal">Heal</button></div></div>` : ''}
    </div>`;
}

async function renderCharDetail(c, ch) {
  if (!ch) { S.view = null; return renderParty(c); }
  const st = sheetSync(ch.id);
  let res, loadErr = '';
  try { res = await api(`/api/characters/${ch.id}/sheet`); } catch (e) { loadErr = e.message || 'Could not load the sheet'; res = { sheet: {}, editable: false }; }
  const pend = sheetPending(st);
  // show my unsaved edits on top of what the server has
  SHEET_VIEW = { id: ch.id, ch: { ...ch, ...pend.c }, sheet: applySheetOps(structuredClone(res.sheet || {}), pend.ops), ed: !!ch.editable && !loadErr, root: null };
  const openSecs = sheetOpenState();
  c.innerHTML = `<div class="sheet" id="sheet" data-id="${esc(ch.id)}">
    <div class="sheet-bar">
      <button class="btn small ghost" id="back" type="button">← Party</button>
      <span class="sheet-status" id="sheet-status" role="status" aria-live="polite"></span>
    </div>
    ${loadErr ? `<div class="card sheet-err"><b>Couldn't load this sheet.</b> ${esc(loadErr)} <button class="btn small" id="sheet-reload" type="button">Try again</button></div>` : ''}
    ${!SHEET_VIEW.ed && !loadErr ? `<p class="muted sheet-hint">${ic('eye')} You're viewing ${esc(ch.name)}'s sheet. Only ${esc(ch.player || 'their player')} and the DMs can change it.</p>` : ''}
    <div class="card sheet-head" id="sheet-head">${headHTML()}</div>
    <nav class="sheet-nav" aria-label="Sheet sections">${SHEET_SECTIONS.map(([id, t]) => `<a href="#sec-${id}" data-jump="${id}">${t}</a>`).join('')}</nav>
    ${SHEET_SECTIONS.map(([id, t]) => `<details class="card sheet-sec" id="sec-${id}" data-sec="${id}" ${openSecs[id] === false ? '' : 'open'}>
      <summary><h3>${t}</h3></summary><div class="sheet-sec-b">${sectionBody(id)}</div></details>`).join('')}
    ${isStaff(S.me) ? `<div class="card dm"><h3>DM notes <span class="badge dm">DM only</span></h3>
      ${sf('c', 'dmNotes', 'DM notes', { t: 'area', rows: 4, ph: `Secrets about ${ch.name}…`, bare: true })}</div>` : ''}
    <div id="sheet-hist"></div>
  </div>`;
  SHEET_VIEW.root = c.querySelector('#sheet');
  S.sheetLive = sheetLiveCharacters;
  paintSheetStatus();
  bindSheet(c, ch);
  // edit history of the character's main fields, loaded after the sheet shows
  api(`/api/characters/${ch.id}/history`).then(hist => {
    const box = c.querySelector('#sheet-hist'); if (!box || !hist.length) return;
    box.innerHTML = `<details class="collapse"><summary>Change history (${hist.length})</summary><div class="card">` +
      hist.map(h => `<div class="hist">${new Date(h.ts).toLocaleString()} — <b>${esc(h.user)}</b> changed <b>${esc(h.field)}</b>: ${esc(JSON.stringify(h.old))} → ${esc(JSON.stringify(h.new))}</div>`).join('') + '</div></details>';
  }).catch(() => {});
}

function sheetOpenState() { try { return JSON.parse(localStorage.getItem('gc_sheet_secs') || '{}') || {}; } catch (_) { return {}; } }
function paintSheetStatus() {
  if (!SHEET_VIEW) return;
  const el = SHEET_VIEW.root && SHEET_VIEW.root.querySelector('#sheet-status'); if (!el) return;
  const st = SHEET_SYNC.get(SHEET_VIEW.id) || { status: 'saved' };
  if (!SHEET_VIEW.ed) { el.className = 'sheet-status'; el.innerHTML = ''; return; }
  const map = {
    saved: ['ok', `${ic('check')} All changes saved`],
    pending: ['wait', 'Unsaved changes…'],
    saving: ['wait', 'Saving…'],
    offline: ['warn', `You're offline. Changes are kept on this device and save when you reconnect.`],
    retry: ['warn', `Couldn't save yet, retrying. Your changes are kept on this device. <button class="btn small" type="button" id="sheet-retry">Retry now</button>`],
    blocked: ['bad', `Not saved: ${esc(st.msg)} <button class="btn small" type="button" id="sheet-retry">Try again</button>`]
  };
  const [cls, html] = map[st.status] || map.saved;
  el.className = `sheet-status s-${cls}`; el.innerHTML = html;
  const r = el.querySelector('#sheet-retry'); if (r) r.onclick = () => { const s2 = sheetSync(SHEET_VIEW.id); s2.fails = 0; sheetFlush(s2); };
}

/* read an element's value as stored */
function elValue(el) {
  const t = el.dataset.t;
  if (t === 'check') return !!el.checked;
  if (t === 'prof') return el.dataset.v || '';
  const raw = el.value;
  if (t === 'num') { const s = raw.trim(); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : s; }
  return raw;
}
function setElValue(el, v) {
  const t = el.dataset.t;
  if (t === 'check') { el.checked = !!v; return; }
  if (t === 'prof') { const lv = PROF_LEVELS[v] ? v : ''; el.dataset.v = lv; el.textContent = PROF_LEVELS[lv].sym; el.className = `prof-dot lv-${lv || 'n'}`; el.title = PROF_LEVELS[lv].label + (SHEET_VIEW.ed ? ' (click to change)' : ''); return; }
  if (el.value !== fv(v)) el.value = fv(v);
}
function sameField(root, src, p) { return [...root.querySelectorAll('[data-p]')].filter(x => x.dataset.src === src && x.dataset.p === p); }
/* a local edit: update the view model, its twins on the page (e.g. HP in the header and in Combat), and queue the save */
function sheetEdit(el, v) {
  const src = el.dataset.src, p = el.dataset.p, V = SHEET_VIEW;
  if (src === 'c') V.ch[p] = v; else applySheetOps(V.sheet, [{ op: 'set', p, v }]);
  sameField(V.root, src, p).forEach(x => { if (x !== el) setElValue(x, v); });
  sheetQueueSet(V.id, src, p, v);
  sheetDerived(src, p);
}
/* the few things worked out from fields: the HP bar and name line in the header, and spell slot summaries */
function sheetDerived(src, p) {
  const V = SHEET_VIEW;
  if (src === 'c' && ['name', 'race', 'klass', 'level', 'player', 'hpCurrent', 'hpMax', 'portrait'].includes(p)) {
    const t = V.root.querySelector('.sheet-id'); if (t) { const tmp = document.createElement('div'); tmp.innerHTML = headHTML(); t.replaceWith(tmp.querySelector('.sheet-id')); }
  }
  const m = src === 's' && String(p).match(/^(?:slots|spells)\.(\d)/);
  if (m) { const s = V.root.querySelector(`[data-slots="${m[1]}"]`); if (s) s.textContent = slotSummary(m[1]); }
}

function bindSheet(c, ch) {
  const root = SHEET_VIEW.root, id = ch.id;
  c.querySelector('#back').onclick = () => { S.view = null; S.sheetLive = null; S.formOpen = false; SHEET_VIEW = null; refresh(c); };
  const rl = c.querySelector('#sheet-reload'); if (rl) rl.onclick = () => refresh(c);
  if (!SHEET_VIEW.ed) { bindSheetNav(root); return; }
  root.addEventListener('input', e => {
    const el = e.target.closest('[data-p]'); if (!el || el.dataset.t === 'check' || el.dataset.t === 'prof') return;
    sheetEdit(el, elValue(el));
  });
  root.addEventListener('change', e => {
    const el = e.target.closest('[data-p]'); if (!el) return;
    if (el.dataset.t === 'check') sheetEdit(el, elValue(el));
    else { const st = sheetSync(id); if (!qEmpty(st.q)) sheetSchedule(st, 150); } // leaving a box saves sooner
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || !root.contains(b)) return;
    if (b.classList.contains('prof-dot') && b.dataset.p) { const next = PROF_NEXT[b.dataset.v || ''] ?? ''; setElValue(b, next); sheetEdit(b, next); return; }
    if (b.dataset.step) {
      const inp = sameField(root, b.dataset.forSrc, b.dataset.forP).find(x => x.tagName === 'INPUT'); if (!inp) return;
      const cur = Number(inp.value) || 0, nv = cur + Number(b.dataset.step);
      setElValue(inp, nv); sheetEdit(inp, nv); return;
    }
    if (b.dataset.hp) { sheetHp(b.dataset.hp); return; }
    if (b.dataset.add) {
      const p = b.dataset.add, row = { id: uid().slice(0, 10) };
      applySheetOps(SHEET_VIEW.sheet, [{ op: 'add', p, v: row }]);
      sheetQueueOp(id, { op: 'add', p, v: row });
      const box = b.closest('[data-rows]'); const tmp = document.createElement('div'); tmp.innerHTML = rowsHTML(p, b.dataset.kind); box.replaceWith(tmp.firstElementChild);
      const first = root.querySelector(`[data-row="${row.id}"] input:not([type=checkbox]), [data-row="${row.id}"] textarea`); if (first) first.focus();
      sheetDerived('s', p); return;
    }
    if (b.dataset.del) {
      const p = b.dataset.del, rowEl = b.closest('.row-i'), box = b.closest('[data-rows]');
      const name = rowEl && rowEl.querySelector('[data-p$=".name"]');
      if (name && name.value.trim() && !confirm(`Remove "${name.value.trim()}"?`)) return;
      applySheetOps(SHEET_VIEW.sheet, [{ op: 'del', p }]);
      sheetQueueOp(id, { op: 'del', p });
      const tmp = document.createElement('div'); tmp.innerHTML = rowsHTML(box.dataset.rows, box.dataset.kind); box.replaceWith(tmp.firstElementChild);
      sheetDerived('s', box.dataset.rows); return;
    }
  });
  const dn = c.querySelector('#dmg-n'); if (dn) dn.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); sheetHp('dmg'); } });
  const ec = c.querySelector('#edit-content');
  if (ec) ec.onclick = () => {
    const view = c.querySelector('#content-view');
    S.formOpen = true; // a live update must not re-render over this draft
    view.innerHTML = `<textarea id="content-ta" style="min-height:320px" aria-label="Notes">${esc(SHEET_VIEW.ch.content || '')}</textarea>
      <div class="row"><button class="btn primary" id="save-content" type="button">Save notes</button><button class="btn" id="cancel-content" type="button">Cancel</button></div>`;
    ec.disabled = true;
    const done = () => { S.formOpen = false; ec.disabled = false; view.innerHTML = md(SHEET_VIEW.ch.content) || '<p class="muted">No notes.</p>'; };
    c.querySelector('#save-content').onclick = () => { const v = c.querySelector('#content-ta').value; SHEET_VIEW.ch.content = v; sheetQueueSet(id, 'c', 'content', v); sheetFlush(sheetSync(id)); done(); };
    c.querySelector('#cancel-content').onclick = done;
  };
  bindSheetNav(root);
}
function bindSheetNav(root) {
  root.querySelectorAll('[data-jump]').forEach(a => a.onclick = e => {
    e.preventDefault();
    const sec = root.querySelector(`#sec-${a.dataset.jump}`); if (!sec) return;
    sec.open = true; sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  root.querySelectorAll('details.sheet-sec').forEach(d => d.addEventListener('toggle', () => {
    const s = sheetOpenState(); s[d.dataset.sec] = d.open;
    try { localStorage.setItem('gc_sheet_secs', JSON.stringify(s)); } catch (_) { /* ignore */ }
  }));
}
/* Damage comes off temporary HP first; healing stops at the maximum. */
function sheetHp(kind) {
  const root = SHEET_VIEW.root, inp = root.querySelector('#dmg-n'); if (!inp) return;
  const n = Math.abs(parseInt(inp.value, 10)); if (!n) { inp.focus(); return; }
  const V = SHEET_VIEW, max = Number(V.ch.hpMax) || null;
  let cur = Number(V.ch.hpCurrent ?? max ?? 0), temp = Number(sheetGet(V.sheet, 'hpTemp')) || 0;
  if (kind === 'dmg') { const fromTemp = Math.min(temp, n); temp -= fromTemp; cur = Math.max(0, cur - (n - fromTemp)); }
  else cur = max ? Math.min(max, cur + n) : cur + n;
  const hpEl = sameField(root, 'c', 'hpCurrent')[0], tEl = sameField(root, 's', 'hpTemp')[0];
  if (hpEl) { setElValue(hpEl, cur); sheetEdit(hpEl, cur); }
  if (tEl && kind === 'dmg') { setElValue(tEl, temp || null); sheetEdit(tEl, temp || null); }
  inp.value = '';
  toast(kind === 'dmg' ? `Took ${n} damage. HP ${cur}${max ? '/' + max : ''}` : `Healed ${n}. HP ${cur}${max ? '/' + max : ''}`);
}

/* ---------- live updates from other screens ---------- */
function sheetRefreshBound() {
  const V = SHEET_VIEW, root = V.root;
  root.querySelectorAll('[data-rows]').forEach(box => {
    const list = (sheetGet(V.sheet, box.dataset.rows) || []).filter(r => r && r.id);
    if (list.map(r => r.id).join(',') === box.dataset.ids || box.contains(document.activeElement)) return;
    const tmp = document.createElement('div'); tmp.innerHTML = rowsHTML(box.dataset.rows, box.dataset.kind); box.replaceWith(tmp.firstElementChild);
  });
  root.querySelectorAll('[data-p]').forEach(el => {
    if (el === document.activeElement || sheetIsPending(el.dataset.src, el.dataset.p)) return;
    setElValue(el, sheetVal(el.dataset.src, el.dataset.p));
  });
  sheetDerived('c', 'hpCurrent');
  for (let L = 1; L <= 9; L++) sheetDerived('s', `slots.${L}`);
  const cv = root.querySelector('#content-view'); if (cv && !S.formOpen) cv.innerHTML = md(V.ch.content) || '<p class="muted">No notes.</p>';
}
function sheetWhere() { const r = SHEET_VIEW && SHEET_VIEW.root; if (!r || !r.isConnected) return false; return r.closest('#rail') ? 'rail' : 'main'; }
/* characters.json changed elsewhere: returns where the open sheet lives (so that panel isn't re-rendered), or false */
function sheetLiveCharacters(chars) {
  const where = sheetWhere(); if (!where) { S.sheetLive = null; return false; }
  const raw = (chars || []).find(x => x.id === SHEET_VIEW.id); if (!raw) return false;
  const st = SHEET_SYNC.get(SHEET_VIEW.id), pend = st ? sheetPending(st) : emptyQ();
  SHEET_VIEW.ch = { ...charView(raw, S.me), ...pend.c };
  sheetRefreshBound();
  return where;
}
LIVE_HOOKS.sheet = (prev, next, id) => {
  if (!sheetWhere() || SHEET_VIEW.id !== id) return;
  const st = SHEET_SYNC.get(id), pend = st ? sheetPending(st) : emptyQ();
  SHEET_VIEW.sheet = applySheetOps(structuredClone(next || {}), pend.ops);
  sheetRefreshBound();
};
