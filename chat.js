/* chat.js — DM Chat: one shared thread for the two DMs, with a Claude assistant that has read the
   whole campaign. Assistant replies are posted into the thread so both DMs see them.
   The Anthropic API key is per-DM and lives only in that DM's browser (Settings tab). */
'use strict';

const AI = {
  get key() { return localStorage.getItem('gc_ai_key') || ''; },
  get model() { return localStorage.getItem('gc_ai_model') || 'claude-opus-5-5'; },
  get effort() { return localStorage.getItem('gc_ai_effort') || 'medium'; },
  // through the login server the key lives there; otherwise it must be in this browser
  get ready() { return (typeof workerMode === 'function' && workerMode()) ? true : !!this.key; }
};
const AI_MODELS = [['claude-opus-5-5', 'Claude Opus 5.5 (default)'], ['claude-sonnet-5-5', 'Claude Sonnet 5.5 (faster, cheaper)'], ['claude-haiku-5-5', 'Claude Haiku 5.5 (fastest)']];
let streaming = null; // { controller, el }

const trim = (s, n) => { s = String(s || '').replace(/\r/g, '').trim(); return s.length > n ? s.slice(0, n) + ' …[trimmed]' : s; };

// ---------- the campaign snapshot the assistant reads ----------
async function campaignSnapshot() {
  const [chars, codex, quests, arc, enc, journal, prep, plans, maps, pins] = await Promise.all([
    load('characters'), load('codex'), load('quests'), load('arc'), load('encounter'), load('journal'), api('/api/prep'), load('plans'), load('maps'), load('pins')
  ]);
  const out = [];
  out.push(`# The Goat Crew — campaign snapshot (${new Date().toLocaleString()})`);
  out.push('\n## Party (player characters)');
  for (const ch of chars) {
    out.push(`### ${ch.name} — ${ch.race || ''} ${ch.klass || ''}, level ${ch.level ?? '?'}${ch.player ? `, played by ${ch.player}` : ''}`);
    out.push(`HP ${ch.hpCurrent ?? '?'}/${ch.hpMax ?? '?'} · AC ${ch.ac ?? '?'} · gold ${ch.gold ?? '?'}${ch.conditions ? ` · conditions: ${ch.conditions}` : ''}`);
    if (ch.content) out.push('Sheet & backstory: ' + trim(ch.content, 2500));
    if (ch.dmNotes) out.push('DM notes: ' + trim(ch.dmNotes, 1200));
  }
  // arcs: current one first
  const arcs = [...new Set(arc.map(x => x.arc).filter(Boolean))];
  const cur = arcs.find(a => arc.some(x => x.arc === a && x.kind === 'beat' && x.status === 'now')) || arcs[arcs.length - 1];
  out.push('\n## Story arcs (DM planning board)');
  for (const a of [cur, ...arcs.filter(x => x !== cur)].filter(Boolean)) {
    const cards = arc.filter(x => x.arc === a).sort((p, q) => (p.order ?? 0) - (q.order ?? 0));
    out.push(`### Arc: ${a}${a === cur ? ' (CURRENT)' : ''}`);
    const about = cards.find(x => x.kind === 'about'); if (about && about.content) out.push(trim(about.content, 1500));
    const line = (k, label) => { const xs = cards.filter(x => x.kind === k); if (xs.length) out.push(`${label}: ` + xs.map(x => `${x.title} [${x.status}]${x.content ? ' — ' + trim(x.content, a === cur ? 400 : 120) : ''}`).join('; ')); };
    line('beat', 'Beats'); line('npc', 'Cast'); line('clue', 'Secrets/clues'); line('thread', 'Open threads');
  }
  // where the party is
  out.push('\n## Where the party is');
  for (const [pid, plan] of Object.entries(plans || {})) {
    const m = maps.find(x => x.id === pid); const room = plan.rooms.find(r => r.id === plan.party);
    if (room) out.push(`Floor plan "${m ? m.name : pid}": party is in **${room.name}** — ${room.desc || ''}${room.notes ? ' DM notes: ' + trim(room.notes, 600) : ''}`);
    out.push(`Rooms of "${m ? m.name : pid}": ` + plan.rooms.map(r => `${r.name}${r.explored ? ' (explored)' : ''}${r.notes ? ' [notes: ' + trim(r.notes, 200) + ']' : ''}`).join('; '));
  }
  for (const [mid, p] of Object.entries((pins || {}).party || {})) { const m = maps.find(x => x.id === mid); if (m) out.push(`Map "${m.name}": party marker at (${p.x}, ${p.y}).`); }
  if ((enc.combatants || []).length) out.push(`\n## Encounter in progress — round ${enc.round}, turn ${enc.turn + 1}\n` + enc.combatants.map((x, i) => `${i === enc.turn ? '▶ ' : ''}${x.name}: init ${x.init}, HP ${x.hp}/${x.maxHp}${x.notes ? ', ' + x.notes : ''}`).join('\n'));
  out.push('\n## Quests');
  for (const q of quests) out.push(`- ${q.title} [${q.status}${q.dmOnly ? ', DM-only' : ''}]: ${trim(q.notes, 400)}${q.dmNotes ? ' DM: ' + trim(q.dmNotes, 400) : ''}`);
  out.push('\n## Codex (NPCs, places, factions, items)');
  for (const e of codex) out.push(`- **${e.name}** (${e.category}${e.revealed ? '' : ', HIDDEN from players'}): ${trim(e.playerContent, 700)}${e.dmContent ? ' || DM-only: ' + trim(e.dmContent, 900) : ''}`);
  out.push('\n## Session prep pages');
  for (const p of prep) out.push(`### ${p.title}\n${trim(p.content, 5000)}`);
  const recent = [...journal].sort((a, b) => (b.session || 0) - (a.session || 0) || String(b.ts || '').localeCompare(String(a.ts || ''))).slice(0, 4);
  out.push('\n## Recent journal entries (newest first)');
  for (const j of recent) out.push(`### ${j.title}${j.session ? ` (session ${j.session})` : ''}\n${trim(j.content, 3500)}`);
  if (typeof BESTIARY !== 'undefined') out.push('\n## Monsters available in the encounter tracker (SRD)\n' + BESTIARY.map(b => `${b.name} (CR ${b.cr}, AC ${b.ac}, HP ${b.hp})`).join('; '));
  return out.join('\n');
}
function systemPrompt(snapshot) {
  return `You are the table assistant for two co-DMs (Josh and the Co-DM) running "The Goat Crew", a D&D 5e campaign using SRD rules. You are used live during the session, so answer fast and tight: short headings, bullet points, bold names, no padding, no preamble. Both DMs read your replies in a shared chat.

Ground everything in the campaign snapshot below. If the snapshot does not cover something, say so in one line, then offer an idea clearly marked as an idea. Never invent facts about the player characters.

House formats:
- "Options": give exactly 3 options. Each: a bold title; what happens (2–3 sentences); which open threads, clues or NPCs it pays off; one complication; a DC or encounter if relevant. Finish with a one-line pick.
- "Remind me about X": who they are, what they want, their arc so far, what the DMs have noted, then 2 hooks for tonight.
- "Encounter": SRD monsters from the tracker list where possible, with AC/HP/attacks, tactics, terrain, and an easier/harder dial. The party is level 3 with about 5 players present.
- "NPC on the spot": name, one-line look, a voice tic, what they want, a secret, one line of dialogue.
- Rules questions: SRD 5e, cite the rule briefly, give the ruling, move on.

${snapshot}`;
}

// ---------- streaming call to the Messages API ----------
async function streamClaude({ system, messages, onText, signal, maxTokens = 3000 }) {
  const body = { model: AI.model, max_tokens: maxTokens, stream: true, messages, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], output_config: { effort: AI.effort } };
  const viaWorker = typeof workerMode === 'function' && workerMode();
  const headers = viaWorker
    ? { 'content-type': 'application/json', 'authorization': 'Bearer ' + WSESSION, 'anthropic-version': '2023-06-01' }
    : { 'content-type': 'application/json', 'x-api-key': AI.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  const withFallback = /^claude-(opus|sonnet|fable)-5/.test(AI.model);
  if (withFallback) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
  const endpoint = viaWorker ? WORKER + '/ai/messages' : 'https://api.anthropic.com/v1/messages';
  const send = () => fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body), signal });
  let r = await send();
  if (r.status === 400 && withFallback) {
    const txt = await r.text();
    if (/fallback/i.test(txt)) { delete body.fallbacks; delete headers['anthropic-beta']; r = await send(); }
    else throw new Error(apiErr(txt));
  }
  if (!r.ok) throw new Error(apiErr(await r.text(), r.status));
  const reader = r.body.getReader(); const dec = new TextDecoder();
  let buf = '', text = '', stop = null, idx;
  for (;;) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue;
        let ev; try { ev = JSON.parse(line.slice(5).trim()); } catch (_) { continue; }
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') { text += ev.delta.text; onText(text); }
        else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) stop = ev.delta.stop_reason;
        else if (ev.type === 'error') throw new Error((ev.error && ev.error.message) || 'stream error');
      }
    }
  }
  return { text, stop };
}
function apiErr(txt, status) {
  try { const j = JSON.parse(txt); if (j.error && j.error.message) return (status === 401 ? 'API key rejected: ' : '') + j.error.message; } catch (_) { /* ignore */ }
  return `Claude API error${status ? ' ' + status : ''}: ${String(txt).slice(0, 200)}`;
}

// ---------- the chat tab ----------
/* Layout: the thread scrolls with the page (or the side rail); a sticky dock at the bottom holds the
   quick-ask row ("Remind me about" menu, then one-tap chips; scrolls sideways) and the composer. The composer has
   one send action and one recipient control, "To: Co-DM / Assistant". Keys (shown in the hint): Enter sends to
   whoever is selected (Co-DM by default), Ctrl/⌘ + Enter asks the assistant, Shift + Enter is a new line. */
const CHAT = { mode: 'dm', draft: '' };
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '');
const chatScroller = () => { const log = $('#chat-log'); return (log && log.closest('#rail')) || document.scrollingElement; };
function chatToBottom() { const sc = chatScroller(); if (sc) sc.scrollTop = sc.scrollHeight; }

async function renderChat(c) {
  const [msgs, chars, codex] = await Promise.all([load('chat'), load('characters'), load('codex')]);
  const people = [
    ...chars.map(ch => ({ v: 'pc:' + ch.id, name: ch.name, group: 'Party' })),
    ...codex.filter(e => e.category === 'npc').map(e => ({ v: 'npc:' + e.id, name: e.name, group: 'NPCs' }))
  ].filter(p => p.name);
  c.innerHTML = `
    <div class="chat-wrap">
      <div id="chat-log" class="chat-log" aria-live="polite"></div>
      <div class="chat-dock">
        <div class="chat-quick-wrap"><div class="chat-quick" role="toolbar" aria-label="Ask the assistant">
          <button class="chat-chip chat-menu-btn" id="chat-who" aria-haspopup="listbox" aria-expanded="false" title="Pick a PC or NPC: who they are, what they want, two hooks">${ic('brain')} Remind me about ${ic('chev', 'chip-chev')}</button>
          <span class="chat-quick-sep" aria-hidden="true"></span>
          <button class="chat-chip" data-q="catchup" title="Where are we, what's open, what to remember">${ic('compass')} Catch me up</button>
          <button class="chat-chip" data-q="options" title="3 ways the next scene could go">${ic('shuffle')} Options from here</button>
          <button class="chat-chip" data-q="encounter">${ic('swords')} Encounter idea</button>
          <button class="chat-chip" data-q="npc">${ic('drama')} NPC on the spot</button>
          <button class="chat-chip" data-q="recap">${ic('scroll')} Recap so far</button>
        </div></div>
        <div class="composer" data-mode="${CHAT.mode}">
          <textarea id="chat-text" rows="1" aria-label="Message" aria-describedby="chat-hint"></textarea>
          <div class="composer-bar">
            <div class="composer-to"><span id="chat-to-lbl">To</span>
              <div class="composer-mode" role="radiogroup" aria-labelledby="chat-to-lbl">
                <button type="button" role="radio" data-mode="dm">${ic('users')} Co-DM</button>
                <button type="button" role="radio" data-mode="ai">${ic('bot')} Assistant</button>
              </div></div>
            <span class="composer-hint" id="chat-hint"></span>
            ${streaming
              ? `<button class="composer-send stop" id="chat-stop" title="Stop the answer" aria-label="Stop the answer">${ic('square')}</button>`
              : `<button class="composer-send" id="chat-send" aria-label="Send" ${CHAT.draft.trim() ? '' : 'disabled'}>${ic('send')}</button>`}
          </div>
        </div>
      </div>
    </div>`;
  drawChat(msgs, true);
  const ta = $('#chat-text'), box = c.querySelector('.composer'), send = $('#chat-send'), hint = $('#chat-hint');
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; };
  const sync = () => {
    const ai = CHAT.mode === 'ai';
    box.dataset.mode = CHAT.mode;
    box.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-checked', String(b.dataset.mode === CHAT.mode)));
    ta.placeholder = ai ? 'Ask the assistant about the campaign…' : 'Message your co-DM…';
    const k = s => `<span class="kbd">${s}</span>`, sep = '<i aria-hidden="true">·</i>';
    hint.innerHTML = ai
      ? (AI.ready ? `${k('Enter')} ask${sep}${k('Shift Enter')} new line${sep}both DMs see the answer` : 'The assistant needs a key: see Settings')
      : `${k('Enter')} send${sep}${k(MAC ? '⌘ Enter' : 'Ctrl Enter')} ask the assistant${sep}${k('Shift Enter')} new line`;
    if (send) { send.disabled = !ta.value.trim(); send.title = ai ? `Ask the assistant (Enter)` : `Send to your co-DM (Enter)`; send.setAttribute('aria-label', send.title); }
  };
  ta.value = CHAT.draft; grow(); sync();
  const takeText = () => { const t = ta.value.trim(); ta.value = ''; CHAT.draft = ''; grow(); sync(); return t; };
  const sendDM = async () => { const t = takeText(); if (!t) return; await api('/api/chat', { method: 'POST', body: { text: t, kind: 'dm' } }); drawChat(await load('chat'), true); };
  const ask = () => { const t = takeText(); if (t) askAssistant(t, t); };
  if (send) send.onclick = () => (CHAT.mode === 'ai' ? ask() : sendDM());
  ta.addEventListener('input', () => { CHAT.draft = ta.value; grow(); sync(); });
  ta.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
    e.preventDefault();
    if (streaming) { toast('The assistant is still answering — hit Stop first'); return; }
    if (e.metaKey || e.ctrlKey) ask(); else if (CHAT.mode === 'ai') ask(); else sendDM();
  });
  box.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => { CHAT.mode = b.dataset.mode; sync(); ta.focus(); });
  box.addEventListener('click', e => { if (e.target === box) ta.focus(); });
  c.querySelectorAll('[data-q]').forEach(b => b.onclick = () => quickAsk(b.dataset.q));
  // the chip row scrolls sideways; fade whichever edge has more chips behind it
  const row = c.querySelector('.chat-quick'), rowWrap = c.querySelector('.chat-quick-wrap');
  const fades = () => { rowWrap.classList.toggle('fade-l', row.scrollLeft > 2); rowWrap.classList.toggle('fade-r', row.scrollLeft + row.clientWidth < row.scrollWidth - 2); };
  row.addEventListener('scroll', fades, { passive: true }); requestAnimationFrame(fades);
  $('#chat-who').onclick = e => { e.stopPropagation(); chatPeopleMenu($('#chat-who'), people, p => askAssistant(`Remind me about ${p.name}.`, `🧠 Remind me about ${p.name}`)); };
  if ($('#chat-stop')) $('#chat-stop').onclick = () => streaming && streaming.controller.abort();
}

/* "Remind me about…": a small searchable menu above the chip (a native select can't match the chips) */
function chatPeopleMenu(anchor, people, pick) {
  const old = document.querySelector('.chat-menu'); if (old) { old.remove(); anchor.setAttribute('aria-expanded', 'false'); return; }
  const menu = document.createElement('div');
  menu.className = 'chat-menu';
  menu.innerHTML = `<input type="search" placeholder="Find a PC or NPC…" aria-label="Find a PC or NPC" autocomplete="off" spellcheck="false"><div class="chat-menu-list" role="listbox"></div>`;
  document.body.appendChild(menu);
  const input = menu.querySelector('input'), list = menu.querySelector('.chat-menu-list');
  let shown = [];
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    shown = people.filter(p => !q || p.name.toLowerCase().includes(q));
    let grp = '';
    list.innerHTML = shown.map((p, i) => `${p.group !== grp ? `<div class="chat-menu-grp">${esc(grp = p.group)}</div>` : ''}<button type="button" role="option" data-i="${i}" class="${i === 0 ? 'active' : ''}">${esc(p.name)}</button>`).join('') || '<div class="chat-menu-empty">No match</div>';
    list.querySelectorAll('[data-i]').forEach(b => b.onclick = () => { close(); pick(shown[Number(b.dataset.i)]); });
  };
  const place = () => {
    const r = anchor.getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    menu.style.top = (r.top - h - 8 > 8 ? r.top - h - 8 : Math.min(r.bottom + 8, innerHeight - h - 8)) + 'px';
  };
  const away = e => { if (!menu.contains(e.target) && e.target !== anchor) close(); };
  const keys = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); anchor.focus(); } };
  function close() {
    menu.remove(); anchor.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', away, true); document.removeEventListener('keydown', keys, true);
    removeEventListener('resize', close); removeEventListener('scroll', place, true);
  }
  input.addEventListener('input', () => { draw(); place(); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); const p = shown[0]; close(); pick(p); } else if (e.key === 'ArrowDown') { e.preventDefault(); const b = list.querySelector('[data-i]'); if (b) b.focus(); } });
  list.addEventListener('keydown', e => {
    const bs = [...list.querySelectorAll('[data-i]')], i = bs.indexOf(document.activeElement);
    if (e.key === 'ArrowDown' && i < bs.length - 1) { e.preventDefault(); bs[i + 1].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); (i > 0 ? bs[i - 1] : input).focus(); }
  });
  draw(); place(); anchor.setAttribute('aria-expanded', 'true'); input.focus();
  document.addEventListener('pointerdown', away, true); document.addEventListener('keydown', keys, true);
  addEventListener('resize', close); addEventListener('scroll', place, true);
}

/* Assistant answers: the shared markdown renderer, then mark the ruling (a line or bullet that opens with a bold
   "Ruling:", "Verdict:", "Pick:" …) so only it keeps full bold, and a line that is nothing but bold text as a subhead. */
const AI_RULING = /^(ruling|rules? call|verdict|answer|short answer|bottom line|tl;?dr|pick|my pick|recommendation|call)\b/i;
function aiMd(text) {
  const tpl = document.createElement('template');
  tpl.innerHTML = md(text);
  tpl.content.querySelectorAll('.md p, .md li').forEach(el => {
    const b = el.firstElementChild, lead = el.firstChild;
    if (!b || b.tagName !== 'B' || lead !== b) return;
    if (AI_RULING.test(b.textContent.trim())) el.classList.add('ruling');
    else if (el.tagName === 'P' && el.childNodes.length === 1) el.classList.add('subhead');
    else b.classList.add('lead'); // a "Label:" that opens a line or bullet stays medium; bold mid-sentence reads as plain text

  });
  return tpl.innerHTML;
}
function msgHTML(m) {
  const mine = m.user === S.me.name;
  const when = m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  if (m.kind === 'ai') return `<article class="msg ai">
      <div class="msg-head"><span class="msg-av">${ic('bot')}</span><b>Assistant</b>${m.askedBy ? `<span>for ${esc(shortName(m.askedBy))}</span>` : ''}<span class="msg-time">${when}</span></div>
      <div class="msg-text">${aiMd(m.text)}</div></article>`;
  if (m.kind === 'sys') return `<div class="msg sys">${esc(m.text)}</div>`;
  // people: your messages and every question to the assistant sit on the right in a tinted bubble
  const ask = m.kind === 'ask', right = mine || ask;
  const who = mine ? 'You' : esc(shortName(m.user));
  return `<div class="msg human ${right ? 'right' : 'left'} ${ask ? 'ask' : ''} ${mine ? 'mine' : ''}">
      <div class="msg-head">${ask ? `<span>${who} asked the assistant</span>` : `<b>${who}</b>`}<span class="msg-time">${when}</span></div>
      <div class="bubble">${esc(m.text)}</div></div>`;
}
function drawChat(msgs, toBottom) {
  const log = $('#chat-log'); if (!log) return;
  const sc = chatScroller();
  const atBottom = !sc || sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
  log.innerHTML = msgs.map(msgHTML).join('') || `<div class="chat-empty"><p><b>Nothing here yet.</b></p><p>Messages between the two DMs stay here. The chips below ask the assistant, and its answers land in this thread for both of you.</p><p>Add your Anthropic API key under Settings to turn the assistant on.</p></div>`;
  if (streaming && streaming.el) log.appendChild(streaming.el);
  if (toBottom || atBottom) chatToBottom();
}
LIVE_HOOKS.chat = (prev, next) => { if (S.tab === 'chat' || S.pin === 'chat') drawChat(next, false); };
async function refreshChat() { if (S.tab === 'chat') await render(); else if (S.pin === 'chat') await renderRail(); }

async function quickAsk(kind) {
  const plans = await load('plans'); const maps = await load('maps');
  let here = '';
  for (const [pid, plan] of Object.entries(plans || {})) { const r = plan.rooms.find(x => x.id === plan.party); if (r) { const m = maps.find(x => x.id === pid); here = `${r.name} (${m ? m.name : pid})`; } }
  const prompts = {
    catchup: ['Catch me up in about 12 lines: where the party is right now, what just happened, the open threads and unrevealed secrets for this arc, and 3 things to remember about the PCs for this scene.', '🧭 Catch me up'],
    options: [`Options from here. The party is at ${here || 'the current "now" beat of the current arc'}. Give me 3 options for what happens next, in the house format.`, '🔀 Options from here'],
    encounter: [`Encounter idea for ${here || 'where the party is now'}: level 3 party, about 5 players present. Use the tracker monster list. Include numbers I can type straight into the tracker and an easier/harder dial.`, '⚔️ Encounter idea'],
    npc: [`NPC on the spot, somewhere the party could plausibly meet them right now (${here || 'current location'}). House format.`, '🎭 NPC on the spot'],
    recap: ['Write a 6-line "previously on The Goat Crew" recap I can read aloud to the players at the start of tonight. Player-safe: nothing marked DM-only or hidden.', '📜 Recap so far']
  };
  const [prompt, label] = prompts[kind];
  askAssistant(prompt, label);
}

async function askAssistant(prompt, label) {
  if (streaming) { toast('The assistant is still answering — hit Stop first'); return; }
  if (!AI.ready) { toast('Add your Anthropic API key in ⚙ Settings first', 4000); S.tab = 'settings'; localStorage.setItem('gc_tab', 'settings'); render(); return; }
  if (S.tab === 'chat' && S.pin === 'chat') return;
  const me = S.me.name;
  await api('/api/chat', { method: 'POST', body: { text: label || prompt, kind: 'ask' } });
  const el = document.createElement('div');
  el.className = 'msg ai streaming';
  el.innerHTML = `<div class="msg-head"><span class="msg-av">${ic('bot')}</span><b>Assistant</b><span class="msg-status">thinking…</span></div><div class="msg-text"></div>`;
  const controller = new AbortController();
  streaming = { controller, el };
  await refreshChat();
  try {
    const [snapshot, chat] = await Promise.all([campaignSnapshot(), load('chat')]);
    const recent = chat.filter(m => m.kind !== 'sys').slice(-14, -1).map(m => `- ${m.kind === 'ai' ? 'Assistant' : shortName(m.user)}: ${trim(m.text, 600)}`).join('\n');
    const user = `${recent ? 'Recent DM chat (oldest first):\n' + recent + '\n\n' : ''}Request from ${shortName(me)}: ${prompt}`;
    let shown = '';
    const { text, stop } = await streamClaude({
      system: systemPrompt(snapshot), messages: [{ role: 'user', content: user }], signal: controller.signal,
      onText: t => { shown = t; const live = streaming && streaming.el; if (live && live.isConnected) { const sc = chatScroller(), stick = sc && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 120; live.querySelector('.msg-text').innerHTML = aiMd(t); live.querySelector('.msg-status').textContent = 'answering…'; if (stick) chatToBottom(); } }
    });
    const final = (text || shown || '(no answer)') + (stop === 'max_tokens' ? '\n\n*(cut off at the length limit)*' : stop === 'refusal' ? '\n\n*(the model declined this one)*' : '');
    streaming = null;
    await api('/api/chat', { method: 'POST', body: { text: final, kind: 'ai', user: 'Assistant', askedBy: me } });
  } catch (e) {
    const partial = streaming && streaming.el ? streaming.el.querySelector('.msg-text').textContent : '';
    streaming = null;
    const why = e.name === 'AbortError' ? 'stopped' : e.message;
    try { await api('/api/chat', { method: 'POST', body: { text: (partial ? partial + '\n\n' : '') + `*(assistant ${why})*`, kind: 'ai', user: 'Assistant', askedBy: me } }); } catch (_) { /* ignore */ }
    if (e.name !== 'AbortError') toast('Assistant: ' + why, 5000);
  }
  await refreshChat();
}

// ---------- journal: draft tonight's recap into the open entry form ----------
async function draftRecap(entries, nextSession) {
  const ta = document.querySelector('#form-slot textarea[data-k="content"]');
  const titleEl = document.querySelector('#form-slot [data-k="title"]');
  const tagsEl = document.querySelector('#form-slot [data-k="tags"]');
  if (!ta) return;
  if (!AI.ready) { ta.value = 'Add your Anthropic API key under Settings to draft recaps, or write the entry by hand.'; toast('Add your Anthropic API key in Settings first', 4000); return; }
  ta.value = 'Drafting from tonight\'s chat, map notes, story beats and the activity log…';
  ta.disabled = true;
  try {
    const [snapshot, chat, plans, maps, hist, arc, enc] = await Promise.all([campaignSnapshot(), load('chat'), load('plans'), load('maps'), api('/api/history'), load('arc'), load('encounter')]);
    const last = [...entries].sort((a, b) => (b.session || 0) - (a.session || 0) || String(b.ts || '').localeCompare(String(a.ts || '')))[0];
    const since = (last && last.ts) ? last.ts : new Date(Date.now() - 12 * 3600e3).toISOString();
    const when = ts => String(ts || '').slice(0, 16).replace('T', ' ');
    const chatLines = chat.filter(m => m.ts > since && m.kind !== 'sys').map(m =>
      `- [${when(m.ts)}] ${m.kind === 'ai' ? 'Assistant suggestion (a plan, not an event)' : shortName(m.user)}: ${trim(m.text, m.kind === 'ai' ? 300 : 900)}`).join('\n');
    const histLines = hist.filter(h => h.ts > since).map(h => `- [${when(h.ts)}] ${shortName(h.user)} · ${h.entity} · ${h.field}: ${JSON.stringify(h.old)} → ${JSON.stringify(h.new)}`.slice(0, 220)).join('\n');
    const rooms = Object.entries(plans || {}).flatMap(([pid, plan]) => plan.rooms.filter(r => r.explored || r.notes).map(r =>
      `- ${(maps.find(m => m.id === pid) || {}).name || pid} / ${r.name}${plan.party === r.id ? ' (party is here now)' : ''}${r.explored ? ' (explored)' : ''}${r.notes ? ': ' + trim(r.notes, 500) : ''}`)).join('\n');
    const beats = arc.filter(x => x.kind === 'beat' && (x.status === 'played' || x.status === 'now')).map(x => `- ${x.arc}: ${x.title} [${x.status}]`).join('\n');
    const tracker = (enc.combatants || []).length ? `Round ${enc.round}: ` + enc.combatants.map(x => `${x.name} ${x.hp}/${x.maxHp}`).join(', ') : 'nothing on the tracker';
    const prompt = `Draft the Journal recap for session ${nextSession} of The Goat Crew.

Voice: match the previous recap below. Narrative past tense, playful, specific, player-facing: this entry is visible to players, so leave out DM-only secrets unless the sources show they were revealed in play.

Format, exactly:
Title: Session ${nextSession} - <short evocative title>

## <scene heading>
(4 to 8 sections in the order things happened, 1 to 3 short paragraphs each)

## Memorable moments
(3 to 6 bullets)

## Loose ends
(bullets: what the party left unresolved)

Tags: <3 to 6 comma-separated tags: places, NPCs, items>

Rules: treat only the sources below as events. Assistant suggestions in the chat are plans, not events, unless a DM message or the activity log confirms them. Where the sources are thin, write what they support and put [fill in: what to add] where the DMs should add detail. No questions, no preamble.

### Previous recap (style sample)
${last ? last.title + '\n' + trim(last.content, 2500) : '(none yet)'}

### DM chat since the last entry (${when(since)})
${chatLines || '(no messages)'}

### Map rooms explored or noted
${rooms || '(none)'}

### Story beats played
${beats || '(none)'}

### Activity log since the last entry
${histLines || '(none)'}

### Tracker
${tracker}`;
    let text = '';
    const res = await streamClaude({ system: systemPrompt(snapshot), messages: [{ role: 'user', content: prompt }], maxTokens: 4500,
      onText: t => { text = t; ta.value = t; ta.scrollTop = ta.scrollHeight; } });
    text = res.text || text;
    const lines = text.split('\n');
    const ti = lines.findIndex(l => /^title:/i.test(l.trim()));
    if (ti >= 0) { if (titleEl) titleEl.value = lines[ti].replace(/^\s*title:\s*/i, '').trim(); lines.splice(ti, 1); }
    const tg = lines.findIndex(l => /^tags:/i.test(l.trim()));
    if (tg >= 0) { if (tagsEl) tagsEl.value = lines[tg].replace(/^\s*tags:\s*/i, '').trim(); lines.splice(tg, 1); }
    ta.value = lines.join('\n').trim() + (res.stop === 'max_tokens' ? '\n\n[fill in: the draft was cut off at the length limit]' : '');
    toast('Draft ready. Read it, fix anything, then Save.', 4500);
  } catch (e) {
    ta.value = `Drafting failed: ${e.message}\n\nWrite the entry by hand, or check the API key under Settings and try again.`;
    toast('Recap: ' + e.message, 5000);
  } finally { ta.disabled = false; ta.focus(); }
}

// ---------- settings ----------
/* One 640px column of sections, each a card of rows (label + help on the left, control on the right). Plain words
   in the rows; the technical detail lives in the "How to" disclosures. Theme, assistant key, model and effort save as
   you change them (with a toast). Anything that reloads the page or signs you in again keeps an explicit button.
   Players see Appearance, Your account and Tips. Dropdowns are custom 32px selects over the native <select>, which
   stays the source of truth (its change handlers below are unchanged). */
const stPill = (ok, yes = 'Set', no = 'Missing') => `<span class="st-pill ${ok ? 'ok' : 'no'}">${ok ? yes : no}</span>`;
const stRow = (label, help, ctl, cls = '') => `<div class="st-row ${cls}"><div class="st-lbl"><b>${label}</b>${help ? `<span>${help}</span>` : ''}</div>${ctl ? `<div class="st-ctl">${ctl}</div>` : ''}</div>`;
const stHowto = (title, body) => `<details class="st-howto"><summary>${ic('help')} ${title}</summary><div class="st-howto-body">${body}</div></details>`;

/* Custom select: a 32px button + a listbox popover, over a hidden native <select> that keeps the value and fires
   'change' exactly as before. Keys: ↑/↓ or Enter opens, ↑/↓ moves, Enter/Space picks, Esc closes, letters jump. */
function customSelect(sel, name) {
  if (!sel || sel.dataset.cs) return;
  sel.dataset.cs = '1';
  const wrap = document.createElement('div'); wrap.className = 'csel';
  sel.parentNode.insertBefore(wrap, sel); wrap.appendChild(sel);
  sel.classList.add('csel-native'); sel.tabIndex = -1; sel.setAttribute('aria-hidden', 'true');
  const btn = document.createElement('button');
  btn.type = 'button'; btn.className = 'csel-btn'; btn.setAttribute('aria-haspopup', 'listbox'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = `<span class="csel-val"></span>${ic('chev')}`;
  wrap.appendChild(btn);
  const paint = () => {
    const o = sel.selectedOptions[0], txt = o ? o.textContent : '';
    btn.querySelector('.csel-val').textContent = txt;
    btn.setAttribute('aria-label', `${name}: ${txt}`);
    btn.disabled = sel.disabled || !sel.options.length || !sel.value && sel.options.length === 1;
  };
  paint(); sel.addEventListener('change', paint);
  let list = null;
  const opts = () => [...list.querySelectorAll('[role="option"]')];
  const away = e => { if (list && !list.contains(e.target) && !btn.contains(e.target)) close(); };
  const place = () => {
    if (!list) return;
    const r = btn.getBoundingClientRect(), h = list.offsetHeight;
    list.style.minWidth = r.width + 'px';
    list.style.left = Math.max(8, Math.min(r.left, innerWidth - list.offsetWidth - 8)) + 'px';
    list.style.top = (r.bottom + 4 + h < innerHeight - 8 ? r.bottom + 4 : Math.max(8, r.top - 4 - h)) + 'px';
  };
  function close(focusBtn) {
    if (!list) return;
    list.remove(); list = null; btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', away, true); removeEventListener('resize', onMove); removeEventListener('scroll', onMove, true);
    if (focusBtn) btn.focus();
  }
  const onMove = e => { if (!(e && e.target && list && list.contains(e.target))) close(); };
  const choose = v => { if (sel.value !== v) { sel.value = v; sel.dispatchEvent(new Event('change', { bubbles: true })); } close(true); };
  function open() {
    if (list || btn.disabled) return;
    list = document.createElement('div');
    list.className = 'pop csel-list'; list.setAttribute('role', 'listbox'); list.setAttribute('aria-label', name);
    list.innerHTML = [...sel.options].filter(o => !o.hidden).map(o => `<div class="pop-item ${o.selected ? 'on' : ''}" role="option" tabindex="-1" aria-selected="${o.selected}" data-v="${esc(o.value)}"><span>${esc(o.textContent)}</span>${o.selected ? ic('check', 'pop-check') : ''}</div>`).join('');
    document.body.appendChild(list); place();
    btn.setAttribute('aria-expanded', 'true');
    (list.querySelector('.on') || opts()[0]).focus({ preventScroll: true });
    list.addEventListener('click', e => { const o = e.target.closest('[role="option"]'); if (o) choose(o.dataset.v); });
    list.addEventListener('keydown', e => {
      const xs = opts(), i = xs.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') { e.preventDefault(); (xs[i + 1] || xs[i] || xs[0]).focus(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); (xs[i - 1] || xs[0]).focus(); }
      else if (e.key === 'Home') { e.preventDefault(); xs[0].focus(); }
      else if (e.key === 'End') { e.preventDefault(); xs[xs.length - 1].focus(); }
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (xs[i]) choose(xs[i].dataset.v); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
      else if (e.key === 'Tab') close();
      else if (e.key.length === 1) { const hit = xs.find((x, j) => j > i && x.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase())) || xs.find(x => x.textContent.trim().toLowerCase().startsWith(e.key.toLowerCase())); if (hit) hit.focus(); }
    });
    document.addEventListener('pointerdown', away, true); addEventListener('resize', onMove); addEventListener('scroll', onMove, true);
  }
  btn.addEventListener('click', () => (list ? close() : open()));
  btn.addEventListener('keydown', e => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
}

async function renderSettings(c) {
  const setup = await api('/api/setup');
  const worker = setup.mode === 'worker';
  const staff = isStaff(S.me), admin = isAdmin(S.me);
  const otherDMs = staff && !worker ? (await api('/api/users/list')).filter(u => isStaff(u) && u.id !== S.me.id) : [];
  const roleName = { player: 'Player', dm: 'DM', admin: 'Admin' }[S.me.role] || S.me.role;
  const themePref = window.gcTheme ? gcTheme.pref() : 'system'; // the theme script in index.html keeps these buttons in sync
  const mod = MAC ? '⌘' : 'Ctrl';
  const sec = (title, body, id = '') => `<section class="st-sec"${id ? ` id="${id}"` : ''}><h3 class="st-h">${title}</h3><div class="st-card">${body}</div></section>`;
  const key = (keys, what) => `<div class="st-key"><span>${what}</span><span class="st-keys">${keys.map(k => `<span class="kbd">${k}</span>`).join('')}</span></div>`;
  const tip = (where, what) => `<div class="st-key st-tip"><span><b>${where}</b> ${what}</span></div>`;
  const testable = worker ? !!setup.assistantOnServer : true;

  c.innerHTML = `<div class="st">
    <div class="st-top"><h2>Settings</h2><p class="muted">Saved in this browser only.</p></div>

    ${sec('Appearance', stRow('Theme', 'System follows this device.',
      `<div class="segmented" role="group" aria-label="Theme">${[['system', 'monitor', 'System'], ['light', 'sun', 'Light'], ['dark', 'moon', 'Dark']].map(([v, i, l]) => `<button type="button" data-theme-set="${v}" aria-pressed="${v === themePref}">${ic(i)} ${l}</button>`).join('')}</div>`))}

    ${sec('Your account', `
      ${stRow('Signed in as', '', `<span class="st-who">${esc(shortName(S.me.name) || S.me.name)} <span class="role-pill role-${esc(S.me.role)}">${esc(roleName)}</span></span>`)}
      ${worker ? `<div class="st-row st-col">
          <div class="st-lbl"><b>Change password</b><span>At least 8 characters.</span></div>
          <div class="st-fields">
            <input id="st-pw-cur" type="password" autocomplete="current-password" placeholder="Current password" aria-label="Current password">
            <input id="st-pw-new" type="password" autocomplete="new-password" placeholder="New password" aria-label="New password">
            <input id="st-pw-new2" type="password" autocomplete="new-password" placeholder="New password again" aria-label="New password again">
            <div class="st-actions"><span class="err" id="st-pw-err"></span><button class="btn primary" id="st-pw-save">Change password</button></div>
          </div></div>` : ''}
      ${stRow('Forget this device', staff ? 'Signs you out and removes your saved keys from this browser.' : 'Signs you out and clears your settings from this browser.', '<button class="btn danger" id="st-forget">Forget…</button>')}`)}

    ${staff ? `
    ${sec('Assistant', `
      <div class="st-row">
        <div class="st-lbl"><b>${worker ? 'Assistant key' : 'Anthropic key'} <span id="st-aikey-pill">${worker ? stPill(setup.assistantOnServer, 'Shared', 'Not set up') : stPill(!!AI.key)}</span></b>
          <span>${worker ? 'Shared by every DM. It is kept on the sign-in service, not in this browser.' : 'Your own key. It stays in this browser and is only sent to Anthropic.'}</span>
          <span class="st-test" id="st-aitest-out" role="status" aria-live="polite"></span></div>
        <div class="st-ctl"><div class="st-keyrow">
          ${worker ? '' : `<input id="st-aikey" type="password" autocomplete="off" spellcheck="false" placeholder="${AI.key ? 'Paste to replace' : 'sk-ant-…'}" aria-label="Anthropic key">`}
          ${testable ? `<button class="btn" id="st-aitest" type="button" ${worker || AI.key ? '' : 'disabled'} title="Send a tiny test question with this key">Test</button>` : ''}
        </div></div>
      </div>
      ${stRow('Model', 'Opus is the most capable. Haiku answers fastest.', `<select id="st-model" aria-label="Model">${AI_MODELS.map(([v, l]) => `<option value="${v}" ${v === AI.model ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      ${stRow('Effort', 'How long it thinks before answering.', `<select id="st-effort" aria-label="Effort">${['low', 'medium', 'high'].map(v => `<option value="${v}" ${v === AI.effort ? 'selected' : ''}>${v[0].toUpperCase() + v.slice(1)}</option>`).join('')}</select>`)}
      <div class="st-foot">${worker
        ? stHowto('How to set it up', '<p>Whoever runs the sign-in service adds an <code>ANTHROPIC_API_KEY</code> secret to it (it is a Cloudflare Worker). Every DM then shares that key, and no key reaches a browser.</p>')
        : stHowto('How to get a key', '<ol><li>Sign in at <b>console.anthropic.com</b>.</li><li>Open <b>API keys</b> and create a key.</li><li>Paste it above. It saves when you leave the box. Press <b>Test</b> to check it.</li></ol><p>Each DM uses their own key.</p>')}</div>`, 'st-ai')}

    ${worker ? '' : sec('Campaign data', `
      ${stRow(`Access key ${stPill(setup.hasToken)}`, 'Lets this browser open and save the campaign.',
        `<input id="st-ghtoken" type="password" autocomplete="off" spellcheck="false" placeholder="${setup.hasToken ? 'Saved · paste to replace' : 'github_pat_…'}" aria-label="Access key">`)}
      <details class="st-row st-col st-more">
        <summary class="st-lbl"><b>Where it's stored <span class="st-loc">${esc(setup.owner)}/${esc(setup.repo)}</span></b><span>Only change this if the campaign moves.</span></summary>
        <div class="st-repo">
          <input id="st-owner" value="${esc(setup.owner)}" placeholder="owner" aria-label="Owner" spellcheck="false"><span class="st-sep">/</span>
          <input id="st-repo" value="${esc(setup.repo)}" placeholder="repository" aria-label="Repository" spellcheck="false"><span class="st-sep">@</span>
          <input id="st-branch" value="${esc(setup.branch)}" placeholder="branch" aria-label="Branch" spellcheck="false">
        </div>
      </details>
      <div class="st-foot">${stHowto('How to make an access key', '<p>The campaign lives in a private GitHub repository. The access key is a GitHub <b>fine-grained token</b> for it:</p><ol><li>On github.com open <b>Settings → Developer settings → Fine-grained tokens</b>.</li><li>Give it access to <b>only the campaign repository</b>.</li><li>Under <b>Repository permissions</b> set <b>Contents</b> to <b>Read and write</b>.</li><li>Paste it above and press <b>Save &amp; reload</b>.</li></ol>')}
        <button class="btn primary" id="st-gh-save" disabled>Save &amp; reload</button></div>`)}

    ${sec(worker ? 'People & access' : 'Invite your co-DM', worker
      ? stRow('People', admin ? 'Add players and DMs, choose what each person can open, send sign-in links and reset passwords.' : 'Your admin adds people and sends sign-in links. Ask them if someone needs a login.',
        admin ? `<button class="btn" id="st-open-admin">${ic('shield')} Open People &amp; access</button>` : '')
      : `<div class="st-row st-col">
          <div class="st-lbl"><b>Invite link</b><span>Signs your co-DM in on their own device, no account needed. It carries <b>this browser's access key</b>, so send it privately.</span></div>
          <div class="st-invite"><select id="st-invite-user" aria-label="Sign them in as">${otherDMs.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('') || '<option value="">No other DM yet</option>'}</select>
            <button class="btn" id="st-invite" ${setup.hasToken && otherDMs.length ? '' : 'disabled'}>${ic('link')} Copy invite link</button></div>
          <div class="muted st-out" id="st-invite-out"></div>
        </div>
        <div class="st-foot">${stHowto('How invite links work', '<p>They open the link once and they\'re in, as the DM you picked, with no GitHub account of their own. Don\'t post it in a group chat. To cut access later, delete the access key on GitHub.</p>')}</div>`)}
    ` : ''}

    ${sec(staff ? 'Shortcuts' : 'Tips', (staff ? `
      ${key(['N'], 'Next turn, while the Battle panel is showing')}
      ${key(['/'], 'Jump to the chat box')}
      ${key(['['], 'Collapse or expand the sidebar')}
      ${key(['Esc'], 'Close a menu or the map panel, or leave a field')}
      ${key(['Enter'], 'DM Chat: send to whoever is selected in To')}
      ${key([mod, 'Enter'], 'DM Chat: ask the assistant')}
      ${key(['Shift', 'Enter'], 'DM Chat: new line')}
      ${tip('Battle', 'Click an HP chip to type a value (12, 12/30, −7). Add monsters from Prep &amp; tools.')}
      ${tip('Map', 'Tap a room for notes. <b>Party moves here</b> is what your co-DM sees.')}`
      : `${tip('Party', 'Tap your character to update HP, gold and conditions.')}
      ${tip('Dice', 'Roll from the Dice tab. Everyone at the table sees the result.')}
      ${tip('Battle map', 'Shows the fight as the DMs reveal it.')}`) +
      '<div class="st-note">Changes from the rest of the table arrive on their own. <b>Synced</b> in the top bar means it is up to date; hover it to see when it last checked.</div>')}

    ${staff ? `
    <details class="st-sec st-adv">
      <summary class="st-h">Advanced <span class="st-pill ${worker ? 'ok' : 'off'}">${worker ? 'Sign-in service on' : 'Sign-in service off'}</span></summary>
      <div class="st-card">
        <div class="st-row st-col">
          <div class="st-lbl"><b>Sign-in service</b><span>${worker ? `This device signs in through <b>${esc(setup.worker)}</b>${setup.workerFromConfig ? ' (set in the site config)' : ''}. It holds the keys and decides who can see what.` : 'Off. Turn it on to give everyone their own password, players included.'}</span></div>
          <input id="st-worker" value="${esc(setup.worker || '')}" placeholder="https://….workers.dev" spellcheck="false" aria-label="Sign-in service address">
        </div>
        <div class="st-foot">${stHowto('What is the sign-in service?', '<p>A small, free Cloudflare Worker you host yourself (setup steps: <code>worker/README.md</code> in the private repository). It keeps every key off the browsers and adds passwords, sign-in links and player logins.</p>')}
          <span class="st-btns">${worker ? '<button class="btn" id="st-worker-off">Use an access key instead</button>' : ''}<button class="btn primary" id="st-worker-save" disabled>Save &amp; sign in again</button></span></div>
      </div>
    </details>` : ''}
  </div>`;

  const on = (id, fn) => { const el = $('#' + id); if (el) el.onclick = fn; };
  customSelect($('#st-model'), 'Model'); customSelect($('#st-effort'), 'Effort'); customSelect($('#st-invite-user'), 'Sign them in as');
  // assistant: saves as you go
  const aikey = $('#st-aikey'), aitest = $('#st-aitest'), aiOut = $('#st-aitest-out');
  const saveKey = () => {
    const k = aikey && aikey.value.trim(); if (!k) return false;
    localStorage.setItem('gc_ai_key', k); aikey.value = ''; aikey.placeholder = 'Paste to replace';
    $('#st-aikey-pill').innerHTML = stPill(true); if (aitest) aitest.disabled = false;
    if (aiOut) { aiOut.className = 'st-test'; aiOut.textContent = ''; }
    return true;
  };
  if (aikey) {
    aikey.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); aikey.blur(); } });
    aikey.addEventListener('input', () => { if (aitest) aitest.disabled = !(aikey.value.trim() || AI.key); });
    aikey.addEventListener('change', () => { if (saveKey()) toast('Key saved'); });
  }
  // Test: one tiny request through the same call the chat uses; the answer itself is thrown away
  if (aitest) aitest.onclick = async () => {
    saveKey();
    if (!AI.ready) { aiOut.className = 'st-test no'; aiOut.innerHTML = `${ic('alert')} Paste a key first.`; return; }
    const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 20000);
    aitest.disabled = true; aiOut.className = 'st-test busy'; aiOut.innerHTML = `${ic('spinner')} Checking…`;
    try {
      await streamClaude({ system: 'Connection test. Reply with the single word OK.', messages: [{ role: 'user', content: 'Test' }], onText: () => {}, signal: ctl.signal, maxTokens: 16 });
      const model = (AI_MODELS.find(([v]) => v === AI.model) || [, AI.model])[1].replace(/\s*\(.*\)$/, '');
      aiOut.className = 'st-test ok'; aiOut.innerHTML = `${ic('okcircle')} Works. ${esc(model)} answered at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
      if (!worker) $('#st-aikey-pill').innerHTML = stPill(true, 'Working');
    } catch (e) {
      aiOut.className = 'st-test no';
      aiOut.innerHTML = `${ic('alert')} ${esc(e.name === 'AbortError' ? 'No answer after 20 seconds. Check the connection and try again.' : (e.message || 'It didn\'t work.'))}`;
      if (!worker && /401|rejected|invalid|authentication/i.test(e.message || '')) $('#st-aikey-pill').innerHTML = stPill(false, '', 'Rejected');
    } finally { clearTimeout(timer); aitest.disabled = false; }
  };
  const model = $('#st-model'), effort = $('#st-effort');
  if (model) model.onchange = () => { localStorage.setItem('gc_ai_model', model.value); toast('Model saved: ' + model.selectedOptions[0].textContent.replace(/\s*\(.*\)$/, '')); };
  if (effort) effort.onchange = () => { localStorage.setItem('gc_ai_effort', effort.value); toast('Effort saved: ' + effort.selectedOptions[0].textContent); };
  // GitHub: reloads, so it waits for the button (which wakes up once something changed)
  const ghSave = $('#st-gh-save');
  if (ghSave) {
    const ids = ['st-ghtoken', 'st-owner', 'st-repo', 'st-branch'], start = { 'st-owner': setup.owner || '', 'st-repo': setup.repo || '', 'st-branch': setup.branch || '' };
    const dirty = () => { ghSave.disabled = !($('#st-ghtoken').value.trim() || ids.slice(1).some(i => $('#' + i).value.trim() !== start[i])); };
    ids.forEach(i => $('#' + i).addEventListener('input', dirty));
  }
  const wIn = $('#st-worker'), wSave = $('#st-worker-save');
  if (wIn && wSave) wIn.addEventListener('input', () => { wSave.disabled = wIn.value.trim() === (setup.worker || '').trim(); });
  on('st-worker-save', async () => { await api('/api/worker', { method: 'POST', body: { url: $('#st-worker').value } }); location.reload(); });
  on('st-worker-off', async () => { await api('/api/worker', { method: 'POST', body: { url: '' } }); location.reload(); });
  on('st-gh-save', async () => {
    await api('/api/repo', { method: 'POST', body: { owner: $('#st-owner').value, repo: $('#st-repo').value, branch: $('#st-branch').value } });
    const t = $('#st-ghtoken').value.trim(); if (t) await api('/api/token', { method: 'POST', body: { token: t } });
    location.reload();
  });
  on('st-open-admin', () => { S.tab = 'admin'; localStorage.setItem('gc_tab', 'admin'); render(); });
  on('st-invite', async () => {
    const id = $('#st-invite-user').value; if (!id) return;
    const link = `${location.origin}${location.pathname}#token=${encodeURIComponent(TOKEN)}&user=${encodeURIComponent(id)}`;
    const out = $('#st-invite-out');
    try { await navigator.clipboard.writeText(link); out.textContent = `Copied. It signs in as ${$('#st-invite-user').selectedOptions[0].textContent} and carries your access key: send it privately.`; toast('Invite link copied'); }
    catch (_) { out.textContent = link; toast('Clipboard blocked: copy the link below', 4000); }
  });
  on('st-pw-save', async () => {
    const err = $('#st-pw-err'); err.textContent = '';
    const cur = $('#st-pw-cur').value, a = $('#st-pw-new').value, b = $('#st-pw-new2').value;
    if (a.length < 8) { err.textContent = 'Use at least 8 characters.'; return; }
    if (a !== b) { err.textContent = 'The new passwords don\'t match.'; return; }
    try { await api('/api/me/password', { method: 'POST', body: { current: cur, next: a } }); ['st-pw-cur', 'st-pw-new', 'st-pw-new2'].forEach(i => { $('#' + i).value = ''; }); toast('Password changed'); }
    catch (e) { err.textContent = e.message || 'Could not change it'; }
  });
  on('st-forget', () => { if (!confirm('Sign out and remove your saved keys and settings from this browser?')) return; ['gc_gh_token', 'gc_gh_repo', 'gc_ai_key', 'gc_ai_model', 'gc_ai_effort', 'gc_session', 'gc_user', 'gc_worker', 'gc_wsession', 'gc_wassistant', 'gc_pin'].forEach(k => localStorage.removeItem(k)); location.reload(); });
}
