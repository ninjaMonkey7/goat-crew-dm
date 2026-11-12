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
async function renderChat(c) {
  const [msgs, chars, codex] = await Promise.all([load('chat'), load('characters'), load('codex')]);
  const people = [...chars.map(ch => ['pc:' + ch.id, ch.name + ' (PC)']), ...codex.filter(e => e.category === 'npc').map(e => ['npc:' + e.id, e.name])];
  c.innerHTML = `
    <div class="chat-wrap">
      <div class="chat-quick">
        <button class="btn" data-q="catchup" title="Where are we, what's open, what to remember">${ic('compass')} Catch me up</button>
        <button class="btn" data-q="options" title="3 ways the next scene could go">${ic('shuffle')} Options from here</button>
        <span class="ai-pick"><select id="chat-who" aria-label="Remind me about a character"><option value="">Remind me about…</option>${people.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></span>
        <button class="btn" data-q="encounter">${ic('swords')} Encounter idea</button>
        <button class="btn" data-q="npc">${ic('drama')} NPC on the spot</button>
        <button class="btn" data-q="recap">${ic('scroll')} Recap so far</button>
        ${streaming ? `<button class="btn danger" id="chat-stop">${ic('square')} Stop</button>` : ''}
      </div>
      <div id="chat-log" class="chat-log"></div>
      <div class="chat-input">
        <textarea id="chat-text" placeholder="Message your co-DM… or ask the assistant (e.g. what does Keth owe the Wraith?)"></textarea>
        <div class="chat-btns"><button class="btn" id="chat-send" title="Only the two DMs see this (Enter)">${ic('send')} Send</button><button class="btn primary" id="chat-ask" title="Both DMs see the answer (Ctrl/⌘ Enter)">${ic('bot')} Ask</button></div>
      </div>
    </div>`;
  drawChat(msgs, true);
  const ta = $('#chat-text');
  const takeText = () => { const t = ta.value.trim(); ta.value = ''; return t; };
  $('#chat-send').onclick = async () => { const t = takeText(); if (!t) return; await api('/api/chat', { method: 'POST', body: { text: t, kind: 'dm' } }); drawChat(await load('chat'), true); };
  $('#chat-ask').onclick = () => { const t = takeText(); if (t) askAssistant(t, t); };
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#chat-send').click(); } if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); $('#chat-ask').click(); } });
  $$('[data-q]').forEach(b => b.onclick = () => quickAsk(b.dataset.q));
  $('#chat-who').onchange = e => { const v = e.target.value; e.target.value = ''; if (!v) return; const [kind, id] = v.split(':'); const name = kind === 'pc' ? chars.find(x => x.id === id)?.name : codex.find(x => x.id === id)?.name; if (name) askAssistant(`Remind me about ${name}.`, `🧠 Remind me about ${name}`); };
  if ($('#chat-stop')) $('#chat-stop').onclick = () => streaming && streaming.controller.abort();
}
function msgHTML(m) {
  const mine = m.user === S.me.name;
  const when = m.ts ? new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  if (m.kind === 'ai') return `<div class="msg ai"><div class="msg-meta"><b style="color:var(--dm)">${ic('bot')} Assistant</b>${m.askedBy ? `<span>for ${esc(shortName(m.askedBy))}</span>` : ''}<span>${when}</span></div><div class="msg-text">${md(m.text)}</div></div>`;
  if (m.kind === 'sys') return `<div class="msg sys">${esc(m.text)}</div>`;
  return `<div class="msg ${mine ? 'mine' : ''} ${m.kind === 'ask' ? 'ask' : ''}"><div class="msg-meta"><b>${esc(shortName(m.user))}</b>${m.kind === 'ask' ? '<span>asked the assistant</span>' : ''}<span>${when}</span></div><div class="msg-text">${esc(m.text)}</div></div>`;
}
function drawChat(msgs, toBottom) {
  const log = $('#chat-log'); if (!log) return;
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60;
  log.innerHTML = msgs.map(msgHTML).join('') || `<div class="chat-empty"><p><b>Nothing here yet.</b></p><p>Messages between the two DMs stay here. The buttons above ask the assistant, and its answers land in this thread for both of you.</p><p>Add your Anthropic API key under ⚙ Settings to turn the assistant on.</p></div>`;
  if (streaming && streaming.el) log.appendChild(streaming.el);
  if (toBottom || atBottom) log.scrollTop = log.scrollHeight;
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
  el.innerHTML = `<div class="msg-meta"><b style="color:var(--dm)">${ic('bot')} Assistant</b><span>thinking…</span></div><div class="msg-text"></div>`;
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
      onText: t => { shown = t; const live = streaming && streaming.el; if (live && live.isConnected) { live.querySelector('.msg-text').innerHTML = md(t); live.querySelector('.msg-meta span').textContent = 'answering…'; const log = $('#chat-log'); if (log) log.scrollTop = log.scrollHeight; } }
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
async function renderSettings(c) {
  const setup = await api('/api/setup');
  const otherDMs = (await api('/api/users/list')).filter(u => u.role === 'dm' && u.id !== S.me.id);
  const worker = setup.mode === 'worker';
  c.innerHTML = `
    <h2>${ic('settings')} Settings <span class="muted" style="font-size:14px;font-weight:400">— stored only in this browser</span></h2>
    <div class="settings-grid">
      <div class="card">
        <h3>${ic('key')} Login server</h3>
        <p class="muted" style="font-size:13px">${worker ? `This device logs in through <b>${esc(setup.worker)}</b>${setup.workerFromConfig ? ' (set in the site config)' : ''}. It holds the GitHub token and the assistant key; you hold a passcode.` : 'Not in use: this device logs in with a GitHub token. A login server (a free Cloudflare Worker, see worker/README.md in the private repo) keeps every secret off the browsers and lets DMs log in with a passcode.'}</p>
        <label>Server URL</label>
        <input id="st-worker" value="${esc(setup.worker || '')}" placeholder="https://goat-crew-dm.….workers.dev" spellcheck="false">
        <div class="row" style="margin-top:8px"><button class="btn primary" id="st-worker-save">Save & log in again</button>${worker ? '<button class="btn" id="st-worker-off">Use a GitHub token instead</button>' : ''}</div>
      </div>
      <div class="card">
        <h3>${ic('bot')} Assistant (Anthropic)</h3>
        ${worker ? `<p class="muted" style="font-size:13px">The key lives on the login server: ${setup.assistantOnServer ? '<span class="badge active">configured</span>' : '<span class="badge hidden-e">not configured</span> (add ANTHROPIC_API_KEY to the worker)'}.</p>` : `
        <label>API key ${AI.key ? '<span class="badge active">set</span>' : '<span class="badge hidden-e">missing</span>'}</label>
        <input id="st-aikey" type="password" autocomplete="off" placeholder="${AI.key ? 'saved — paste to replace' : 'sk-ant-…'}">`}
        <label>Model</label>
        <select id="st-model">${AI_MODELS.map(([v, l]) => `<option value="${v}" ${v === AI.model ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label>Effort (how long it thinks)</label>
        <select id="st-effort">${['low', 'medium', 'high'].map(v => `<option ${v === AI.effort ? 'selected' : ''}>${v}</option>`).join('')}</select>
        ${worker ? '' : '<p class="muted" style="font-size:13px">Create a key at console.anthropic.com → API keys. Each DM uses their own key; it never leaves this browser except to call Anthropic directly.</p>'}
        <button class="btn primary" id="st-ai-save">Save</button>
      </div>
      <div class="card ${worker ? 'hidden' : ''}">
        <h3>${ic('github')} GitHub (campaign data)</h3>
        <label>Token ${setup.hasToken ? '<span class="badge active">set</span>' : '<span class="badge hidden-e">missing</span>'}</label>
        <input id="st-ghtoken" type="password" autocomplete="off" placeholder="${setup.hasToken ? 'saved — paste to replace' : 'github_pat_…'}">
        <label>Data repo</label>
        <div class="row"><input id="st-owner" value="${esc(setup.owner)}" placeholder="owner" style="flex:1;min-width:0"><input id="st-repo" value="${esc(setup.repo)}" placeholder="repo" style="flex:1;min-width:0"><input id="st-branch" value="${esc(setup.branch)}" placeholder="branch" style="width:90px"></div>
        <p class="muted" style="font-size:13px">Fine-grained token: github.com → Settings → Developer settings → Fine-grained tokens → only the data repo → Repository permissions → Contents: Read and write.</p>
        <button class="btn primary" id="st-gh-save">Save & reload</button>
      </div>
      <div class="card">
        <h3>${ic('users')} Invite your co-DM</h3>
        <p class="muted" style="font-size:13px">${worker
          ? 'Makes a link that names the login server and who they are. They open it, type their passcode, and they\'re in. Send the passcode separately.'
          : 'Makes a link that carries <b>this device\'s GitHub token</b> and signs them in as the DM you pick. They open it once on their device and they\'re in: no GitHub account or token of their own. Send it privately (not in a group chat), and to cut access later revoke the token on GitHub.'}</p>
        <div class="row"><select id="st-invite-user">${otherDMs.map(u => `<option value="${u.id}">${esc(u.name)}</option>`).join('')}</select>
          <button class="btn" id="st-invite" ${(worker || setup.hasToken) && otherDMs.length ? '' : 'disabled'}>${ic('link')} Copy invite link</button></div>
        <div class="muted" id="st-invite-out" style="font-size:12px;word-break:break-all;margin-top:6px;min-height:1em"></div>
        <hr style="border:none;border-top:1px solid var(--line);margin:14px 0 10px">
        <button class="btn danger" id="st-forget">Forget everything on this device</button>
      </div>
      <div class="card">
        <h3>Shortcuts</h3>
        <p class="muted" style="font-size:14px">Anywhere: <span class="kbd">N</span> next turn while the Battle panel is showing, <span class="kbd">/</span> jump to the chat box, <span class="kbd">Esc</span> close the map panel.<br>
        DM Chat: <span class="kbd">Enter</span> sends to your co-DM, <span class="kbd">Ctrl/⌘ + Enter</span> asks the assistant.<br>
        Map: tap a room for notes; <b>Party moves here</b> is what your co-DM sees.<br>
        Battle: run a fight from the Battle tab (−/+ HP, ▶ Next turn, 📖 stat block); add monsters from the DM tab.</p>
        <p class="muted" style="font-size:13px">Live updates poll the data repo every 4 s: ● green in the header means connected.</p>
      </div>
    </div>`;
  $('#st-ai-save').onclick = () => {
    const k = $('#st-aikey') ? $('#st-aikey').value.trim() : ''; if (k) localStorage.setItem('gc_ai_key', k);
    localStorage.setItem('gc_ai_model', $('#st-model').value); localStorage.setItem('gc_ai_effort', $('#st-effort').value);
    toast('Assistant settings saved'); render();
  };
  $('#st-worker-save').onclick = async () => { await api('/api/worker', { method: 'POST', body: { url: $('#st-worker').value } }); location.reload(); };
  if ($('#st-worker-off')) $('#st-worker-off').onclick = async () => { await api('/api/worker', { method: 'POST', body: { url: '' } }); location.reload(); };
  $('#st-gh-save').onclick = async () => {
    await api('/api/repo', { method: 'POST', body: { owner: $('#st-owner').value, repo: $('#st-repo').value, branch: $('#st-branch').value } });
    const t = $('#st-ghtoken').value.trim(); if (t) await api('/api/token', { method: 'POST', body: { token: t } });
    location.reload();
  };
  $('#st-invite').onclick = async () => {
    const id = $('#st-invite-user').value;
    const link = worker
      ? `${location.origin}${location.pathname}#worker=${encodeURIComponent(setup.worker)}&user=${encodeURIComponent(id)}`
      : `${location.origin}${location.pathname}#token=${encodeURIComponent(TOKEN)}&user=${encodeURIComponent(id)}`;
    const out = $('#st-invite-out');
    try { await navigator.clipboard.writeText(link); out.textContent = worker ? `Copied. It opens the passcode login for ${$('#st-invite-user').selectedOptions[0].textContent}; send their passcode separately.` : `Copied. It signs in as ${$('#st-invite-user').selectedOptions[0].textContent} and carries your token: send it privately.`; toast('Invite link copied'); }
    catch (_) { out.textContent = link; toast('Clipboard blocked: copy the link below', 4000); }
  };
  $('#st-forget').onclick = () => { if (!confirm('Remove the GitHub token, API key, login server and session from this browser?')) return; ['gc_gh_token', 'gc_gh_repo', 'gc_ai_key', 'gc_ai_model', 'gc_ai_effort', 'gc_session', 'gc_user', 'gc_worker', 'gc_wsession', 'gc_wassistant', 'gc_pin'].forEach(k => localStorage.removeItem(k)); location.reload(); };
}
