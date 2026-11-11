/* chat.js — DM Chat: one shared thread for the two DMs, with a Claude assistant that has read the
   whole campaign. Assistant replies are posted into the thread so both DMs see them.
   The Anthropic API key is per-DM and lives only in that DM's browser (Settings tab). */
'use strict';

const AI = {
  get key() { return localStorage.getItem('gc_ai_key') || ''; },
  get model() { return localStorage.getItem('gc_ai_model') || 'claude-opus-5-5'; },
  get effort() { return localStorage.getItem('gc_ai_effort') || 'medium'; }
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
async function streamClaude({ system, messages, onText, signal }) {
  const body = { model: AI.model, max_tokens: 3000, stream: true, messages, system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }], output_config: { effort: AI.effort } };
  const headers = { 'content-type': 'application/json', 'x-api-key': AI.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
  const withFallback = /^claude-(opus|sonnet|fable)-5/.test(AI.model);
  if (withFallback) { body.fallbacks = 'default'; headers['anthropic-beta'] = 'server-side-fallback-2026-07-01'; }
  const send = () => fetch('https://api.anthropic.com/v1/messages', { method: 'POST', headers, body: JSON.stringify(body), signal });
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
        <button class="btn" data-q="catchup" title="Where are we, what's open, what to remember">🧭 Catch me up</button>
        <button class="btn" data-q="options" title="3 ways the next scene could go">🔀 Options from here</button>
        <span class="ai-pick"><select id="chat-who"><option value="">🧠 Remind me about…</option>${people.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></span>
        <button class="btn" data-q="encounter">⚔️ Encounter idea</button>
        <button class="btn" data-q="npc">🎭 NPC on the spot</button>
        <button class="btn" data-q="recap">📜 Recap so far</button>
        ${streaming ? '<button class="btn danger" id="chat-stop">■ Stop</button>' : ''}
      </div>
      <div id="chat-log" class="chat-log"></div>
      <div class="chat-input">
        <textarea id="chat-text" placeholder="Message your co-DM… or ask the assistant (e.g. what does Keth owe the Wraith?)"></textarea>
        <div class="chat-btns"><button class="btn" id="chat-send" title="Only the two DMs see this">💬 Send</button><button class="btn primary" id="chat-ask" title="Both DMs see the answer">🤖 Ask</button></div>
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
  if (m.kind === 'ai') return `<div class="msg ai"><div class="msg-meta"><b style="color:var(--dm)">🤖 Assistant</b>${m.askedBy ? `<span>for ${esc(shortName(m.askedBy))}</span>` : ''}<span>${when}</span></div><div class="msg-text">${md(m.text)}</div></div>`;
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
LIVE_HOOKS.chat = (prev, next) => { if (S.tab === 'chat') drawChat(next, false); };

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
  if (!AI.key) { toast('Add your Anthropic API key in ⚙ Settings first', 4000); S.tab = 'settings'; localStorage.setItem('gc_tab', 'settings'); render(); return; }
  const me = S.me.name;
  await api('/api/chat', { method: 'POST', body: { text: label || prompt, kind: 'ask' } });
  const el = document.createElement('div');
  el.className = 'msg ai streaming';
  el.innerHTML = `<div class="msg-meta"><b style="color:var(--dm)">🤖 Assistant</b><span>thinking…</span></div><div class="msg-text"></div>`;
  const controller = new AbortController();
  streaming = { controller, el };
  if (S.tab === 'chat') { drawChat(await load('chat'), true); render(); }
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
  if (S.tab === 'chat') render();
}

// ---------- settings ----------
async function renderSettings(c) {
  const setup = await api('/api/setup');
  c.innerHTML = `
    <h2>⚙ Settings <span class="muted" style="font-size:14px;font-weight:400">— stored only in this browser</span></h2>
    <div class="settings-grid">
      <div class="card">
        <h3>🤖 Assistant (Anthropic)</h3>
        <label>API key ${AI.key ? '<span class="badge active">set</span>' : '<span class="badge hidden-e">missing</span>'}</label>
        <input id="st-aikey" type="password" autocomplete="off" placeholder="${AI.key ? 'saved — paste to replace' : 'sk-ant-…'}">
        <label>Model</label>
        <select id="st-model">${AI_MODELS.map(([v, l]) => `<option value="${v}" ${v === AI.model ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <label>Effort (how long it thinks)</label>
        <select id="st-effort">${['low', 'medium', 'high'].map(v => `<option ${v === AI.effort ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <p class="muted" style="font-size:13px">Create a key at console.anthropic.com → API keys. Each DM uses their own key; it never leaves this browser except to call Anthropic directly.</p>
        <button class="btn primary" id="st-ai-save">Save</button>
      </div>
      <div class="card">
        <h3>🐙 GitHub (campaign data)</h3>
        <label>Token ${setup.hasToken ? '<span class="badge active">set</span>' : '<span class="badge hidden-e">missing</span>'}</label>
        <input id="st-ghtoken" type="password" autocomplete="off" placeholder="${setup.hasToken ? 'saved — paste to replace' : 'github_pat_…'}">
        <label>Data repo</label>
        <div class="row"><input id="st-owner" value="${esc(setup.owner)}" placeholder="owner" style="flex:1;min-width:0"><input id="st-repo" value="${esc(setup.repo)}" placeholder="repo" style="flex:1;min-width:0"><input id="st-branch" value="${esc(setup.branch)}" placeholder="branch" style="width:90px"></div>
        <p class="muted" style="font-size:13px">Fine-grained token: github.com → Settings → Developer settings → Fine-grained tokens → only the data repo → Repository permissions → Contents: Read and write.</p>
        <button class="btn primary" id="st-gh-save">Save & reload</button>
        <button class="btn danger" id="st-forget">Forget everything on this device</button>
      </div>
      <div class="card">
        <h3>Shortcuts</h3>
        <p class="muted" style="font-size:14px">DM Chat: <span class="kbd">Enter</span> sends to your co-DM, <span class="kbd">Ctrl/⌘ + Enter</span> asks the assistant.<br>
        Map: tap a room for notes; <b>Party moves here</b> is what your co-DM sees.<br>
        Battle: run a fight from the Battle tab (−/+ HP, ▶ Next turn, 📖 stat block); add monsters from the DM tab.</p>
        <p class="muted" style="font-size:13px">Live updates poll the data repo every 4 s: ● green in the header means connected.</p>
      </div>
    </div>`;
  $('#st-ai-save').onclick = () => {
    const k = $('#st-aikey').value.trim(); if (k) localStorage.setItem('gc_ai_key', k);
    localStorage.setItem('gc_ai_model', $('#st-model').value); localStorage.setItem('gc_ai_effort', $('#st-effort').value);
    toast('Assistant settings saved'); render();
  };
  $('#st-gh-save').onclick = async () => {
    await api('/api/repo', { method: 'POST', body: { owner: $('#st-owner').value, repo: $('#st-repo').value, branch: $('#st-branch').value } });
    const t = $('#st-ghtoken').value.trim(); if (t) await api('/api/token', { method: 'POST', body: { token: t } });
    location.reload();
  };
  $('#st-forget').onclick = () => { if (!confirm('Remove the GitHub token, API key and session from this browser?')) return; ['gc_gh_token', 'gc_gh_repo', 'gc_ai_key', 'gc_ai_model', 'gc_ai_effort', 'gc_session', 'gc_user'].forEach(k => localStorage.removeItem(k)); location.reload(); };
}
