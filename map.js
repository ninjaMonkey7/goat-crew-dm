/* map.js — Map tab. Raster maps (pan/zoom, pins linked to the Codex, a draggable party marker) and
   floor plans (White Cross Hospital, the tunnels) drawn as SVG from plans.json with clickable rooms.
   Uses Leaflet with a flat pixel CRS. State lives in pins.json / plans.json on the data branch. */
'use strict';

let MAP = null;
const MS = { mapId: null, map: null, pinLayer: null, party: null, svg: null, mode: null, room: null };
const PIN_ICONS = ['📍', '🏰', '🍺', '⚓', '🚪', '🐟', '🏥', '⚔️', '💀', '❓', '⭐', '🏚', '⛪', '🌲', '💰', '🕯'];
const toLL = (map, x, y) => [map.height - y, x];
const fromLL = (map, ll) => ({ x: Math.round(ll.lng), y: Math.round(map.height - ll.lat) });

async function renderMap(c) {
  const [maps, pins, plans] = await Promise.all([load('maps'), load('pins'), load('plans')]);
  let mapId = S.search.map || localStorage.getItem('gc_map') || (maps[0] && maps[0].id);
  if (!maps.some(m => m.id === mapId)) mapId = maps[0] && maps[0].id;
  const map = maps.find(m => m.id === mapId);
  if (!map) { c.innerHTML = '<p class="muted">No maps in maps.json yet.</p>'; return; }
  const plan = map.type === 'plan' ? plans[map.id] : null;
  c.innerHTML = `
    <div class="map-wrap">
      <div class="map-bar">
        <select id="map-pick">${maps.map(m => `<option value="${m.id}" ${m.id === mapId ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
        ${map.type === 'image' ? `<button class="btn small" id="pin-add">${ic('mappin')} Add pin</button><button class="btn small" id="party-set">🐐 Party here</button>` : `<span class="muted" style="font-size:13px">Tap a room: notes, explored, party position</span>`}
        <button class="btn small ghost" id="map-fit" title="Fit to screen">${ic('maximize')} Fit</button>
        <span class="muted" style="font-size:12px;margin-left:auto">scroll / pinch to zoom · drag to pan</span>
      </div>
      <div id="map-canvas"></div>
      <div id="map-side" class="map-side hidden"></div>
      <div id="map-hint" class="map-hint hidden"></div>
    </div>`;
  $('#map-pick').onchange = e => { S.search.map = e.target.value; localStorage.setItem('gc_map', e.target.value); refresh(c); };

  if (MAP) { try { MAP.remove(); } catch (_) { /* ignore */ } MAP = null; }
  Object.assign(MS, { mapId, map, pinLayer: null, party: null, svg: null, mode: null, room: null });
  MAP = L.map('map-canvas', { crs: L.CRS.Simple, minZoom: -4, maxZoom: 3, zoomSnap: 0.25, zoomDelta: 0.5, attributionControl: false, wheelPxPerZoomLevel: 90 });

  if (map.type === 'image') mountImageMap(map, pins).catch(e => toast('Could not load the map image: ' + e.message, 4000));
  else if (plan) mountPlan(map, plan);
  else { $('#map-canvas').innerHTML = `<p class="muted" style="padding:20px">No floor plan "${esc(map.id)}" in plans.json.</p>`; return; }

  $('#map-fit').onclick = () => MAP.fitBounds(MS.bounds, { padding: [10, 10] });
}

// ---------- raster maps: image + pins + party ----------
async function mountImageMap(map, pins) {
  const m = MAP; // this render's map; the image may finish loading after the DM has moved on
  const bounds = [[0, 0], [map.height, map.width]];
  MS.bounds = bounds;
  m.fitBounds(bounds, { padding: [10, 10] });
  m.setMaxBounds([[-map.height * 0.5, -map.width * 0.5], [map.height * 1.5, map.width * 1.5]]);
  MS.pinLayer = L.layerGroup().addTo(m);
  drawPins(pins);

  $('#pin-add').onclick = () => setMode(MS.mode === 'pin' ? null : 'pin');
  $('#party-set').onclick = () => setMode(MS.mode === 'party' ? null : 'party');
  m.on('click', async e => {
    if (MS.mode === 'pin') { setMode(null); openPinForm(fromLL(map, e.latlng)); }
    else if (MS.mode === 'party') { setMode(null); const p = fromLL(map, e.latlng); await api('/api/pins', { method: 'POST', body: { op: 'party', mapId: map.id, x: p.x, y: p.y } }); drawPins(await load('pins')); toast('🐐 Party moved'); }
    else closeSide();
  });
  const url = await media(map.path); // slow on first load; cached afterwards
  if (m !== MAP || MS.map !== map) return; // the DM switched maps or tabs meanwhile
  L.imageOverlay(url, bounds).addTo(m);
}
function setMode(mode) {
  MS.mode = mode;
  const hint = $('#map-hint');
  if (!hint) return;
  hint.classList.toggle('hidden', !mode);
  hint.textContent = mode === 'pin' ? 'Tap the map where the pin goes' : mode === 'party' ? 'Tap where the party is now' : '';
  const canvas = $('#map-canvas'); if (canvas) canvas.style.cursor = mode ? 'crosshair' : '';
}
function drawPins(pins) {
  if (!MS.pinLayer || !MS.map) return;
  const map = MS.map;
  MS.pinLayer.clearLayers();
  for (const pin of (pins.pins || []).filter(p => p.mapId === map.id)) {
    const mk = L.marker(toLL(map, pin.x, pin.y), { draggable: true, icon: L.divIcon({ className: 'pin', html: `<span class="pin-ico">${pin.icon || '📍'}</span><span class="pin-lbl">${esc(pin.label || '')}</span>`, iconAnchor: [11, 11] }) });
    mk.on('click', () => openPinForm(pin, pin));
    mk.on('dragend', async () => { const p = fromLL(map, mk.getLatLng()); await api('/api/pins', { method: 'POST', body: { op: 'update', id: pin.id, fields: { x: p.x, y: p.y } } }); });
    mk.addTo(MS.pinLayer);
  }
  const pp = (pins.party || {})[map.id];
  if (pp) {
    const mk = L.marker(toLL(map, pp.x, pp.y), { draggable: true, zIndexOffset: 1000, icon: L.divIcon({ className: 'party-marker', html: '🐐', iconAnchor: [17, 17] }), title: 'The party' });
    mk.on('dragend', async () => { const p = fromLL(map, mk.getLatLng()); await api('/api/pins', { method: 'POST', body: { op: 'party', mapId: map.id, x: p.x, y: p.y } }); });
    mk.addTo(MS.pinLayer);
  }
}
async function openPinForm(pos, pin = null) {
  const codex = await load('codex');
  const side = $('#map-side');
  const v = pin || { label: '', icon: '📍', codexId: '' };
  const linked = codex.find(e => e.id === v.codexId);
  side.classList.remove('hidden');
  side.innerHTML = `<div class="row spread"><h3>${ic('mappin')} ${pin ? 'Pin' : 'New pin'}</h3><button class="btn small ghost" id="side-close" aria-label="Close">${ic('x')}</button></div>
    <label>Label</label><input id="pin-label" value="${esc(v.label)}" placeholder="What is here?">
    <label>Icon</label><select id="pin-icon">${PIN_ICONS.map(i => `<option ${i === v.icon ? 'selected' : ''}>${i}</option>`).join('')}</select>
    <label>Codex entry</label><select id="pin-codex"><option value="">— none —</option>${codex.map(e => `<option value="${e.id}" ${e.id === v.codexId ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
    ${linked ? `<div class="card" style="margin:8px 0 0;padding:8px 10px;font-size:14px">${md((linked.playerContent || '').slice(0, 400))}${linked.dmContent ? `<div class="muted" style="font-size:13px;border-top:1px dashed var(--line);margin-top:4px;padding-top:4px"><b style="color:var(--dm)">DM:</b> ${esc(linked.dmContent.slice(0, 300))}</div>` : ''}</div>` : ''}
    <div class="row" style="margin-top:10px">
      <button class="btn primary small" id="pin-save">Save</button>
      ${linked ? `<button class="btn small" id="pin-open">Open in Codex</button>` : ''}
      ${pin ? `<button class="btn small danger" id="pin-del">Delete</button>` : ''}
    </div>`;
  $('#side-close').onclick = closeSide;
  $('#pin-save').onclick = async () => {
    const fields = { label: $('#pin-label').value.trim(), icon: $('#pin-icon').value, codexId: $('#pin-codex').value };
    if (!fields.label) { toast('Give the pin a label'); return; }
    if (pin) await api('/api/pins', { method: 'POST', body: { op: 'update', id: pin.id, fields } });
    else await api('/api/pins', { method: 'POST', body: { op: 'add', pin: { mapId: MS.map.id, x: pos.x, y: pos.y, ...fields } } });
    closeSide(); drawPins(await load('pins'));
  };
  if (pin) $('#pin-del').onclick = async () => { if (!confirm(`Delete pin "${pin.label}"?`)) return; await api('/api/pins', { method: 'POST', body: { op: 'remove', id: pin.id } }); closeSide(); drawPins(await load('pins')); };
  if (linked) $('#pin-open').onclick = () => { S.tab = 'codex'; S.search.codex = linked.name; S.search.codexCat = 'all'; localStorage.setItem('gc_tab', 'codex'); render(); };
  $('#pin-label').focus();
}
function closeSide() { const s = $('#map-side'); if (s) { s.classList.add('hidden'); s.innerHTML = ''; } if (MS.svg && MS.room) { MS.svg.querySelectorAll('.room.selected').forEach(g => g.classList.remove('selected')); MS.room = null; } }

// ---------- floor plans: SVG rooms ----------
const SVG_NS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs, parent) => { const n = document.createElementNS(SVG_NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); if (parent) parent.appendChild(n); return n; };
function cavePath(r) {
  let seed = 7; for (const ch of r.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 0xffffffff; };
  const n = 18, cx = r.x + r.w / 2, cy = r.y + r.h / 2, pts = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, j = 0.8 + rnd() * 0.34; pts.push([cx + Math.cos(a) * (r.w / 2) * j, cy + Math.sin(a) * (r.h / 2) * j]); }
  let d = '';
  for (let i = 0; i < n; i++) {
    const p = pts[i], q = pts[(i + 1) % n], nq = pts[(i + 2) % n];
    if (i === 0) d += `M${(p[0] + q[0]) / 2},${(p[1] + q[1]) / 2}`;
    d += ` Q${q[0]},${q[1]} ${(q[0] + nq[0]) / 2},${(q[1] + nq[1]) / 2}`;
  }
  return d + ' Z';
}
function buildPlanSVG(plan) {
  const svg = svgEl('svg', { viewBox: `0 0 ${plan.w} ${plan.h}`, xmlns: SVG_NS });
  svg.classList.add('plan', 'plan-' + (plan.style || 'building'));
  svgEl('rect', { x: 0, y: 0, width: plan.w, height: plan.h, class: 'plan-bg' }, svg);
  const cave = plan.style === 'cave';
  if (!cave) {
    const [wx, wy, ww, wh] = plan.wall || [40, 40, plan.w - 80, plan.h - 80];
    svgEl('rect', { x: wx, y: wy, width: ww, height: wh, rx: 14, class: 'plan-grounds' }, svg);
    svgEl('rect', { x: wx, y: wy, width: ww, height: wh, rx: 14, class: 'plan-wall' }, svg);
  } else {
    const byId = Object.fromEntries(plan.rooms.map(r => [r.id, r]));
    for (const [a, b] of plan.passages || []) {
      const ra = byId[a], rb = byId[b]; if (!ra || !rb) continue;
      svgEl('line', { x1: ra.x + ra.w / 2, y1: ra.y + ra.h / 2, x2: rb.x + rb.w / 2, y2: rb.y + rb.h / 2, class: 'plan-passage' }, svg);
    }
  }
  for (const r of plan.rooms) {
    const g = svgEl('g', { class: 'room', 'data-room': r.id }, svg);
    if (cave) svgEl('path', { d: cavePath(r), class: 'room-floor' }, g);
    else svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, rx: 4, class: 'room-floor' }, g);
    const t = svgEl('text', { x: r.x + r.w / 2, y: r.y + r.h / 2, 'text-anchor': 'middle', 'dominant-baseline': 'middle', class: 'room-label' }, g);
    t.textContent = r.name;
    const goat = svgEl('text', { x: r.x + r.w - 26, y: r.y + 36, 'text-anchor': 'middle', class: 'room-party' }, g); goat.textContent = '';
    const flag = svgEl('text', { x: r.x + 14, y: r.y + 24, class: 'room-flag' }, g); flag.textContent = '';
  }
  for (const [x, y, o] of plan.doors || []) svgEl('rect', { x: o === 'v' ? x - 5 : x - 16, y: o === 'v' ? y - 16 : y - 5, width: o === 'v' ? 10 : 32, height: o === 'v' ? 32 : 10, class: 'plan-door' }, svg);
  for (const mk of plan.marks || []) { const t = svgEl('text', { x: mk.x, y: mk.y, class: 'plan-mark' }, svg); t.textContent = mk.text; }
  if (plan.title) { const t = svgEl('text', { x: 24, y: plan.h - 20, class: 'plan-title' }, svg); t.textContent = plan.title; }
  return svg;
}
function stylePlan(svg, plan) {
  for (const r of plan.rooms) {
    const g = svg.querySelector(`[data-room="${r.id}"]`); if (!g) continue;
    g.classList.toggle('explored', !!r.explored);
    g.classList.toggle('party', plan.party === r.id);
    g.querySelector('.room-label').textContent = r.name;
    g.querySelector('.room-party').textContent = plan.party === r.id ? '🐐' : '';
    g.querySelector('.room-flag').textContent = r.notes ? '📝' : '';
  }
}
function mountPlan(map, plan) {
  const bounds = [[0, 0], [plan.h, plan.w]];
  MS.bounds = bounds;
  const svg = buildPlanSVG(plan);
  stylePlan(svg, plan);
  MS.svg = svg;
  L.svgOverlay(svg, bounds, { interactive: true }).addTo(MAP);
  MAP.fitBounds(bounds, { padding: [10, 10] });
  MAP.setMaxBounds([[-plan.h * 0.5, -plan.w * 0.5], [plan.h * 1.5, plan.w * 1.5]]);
  svg.querySelectorAll('.room').forEach(g => g.addEventListener('click', ev => { ev.stopPropagation(); openRoom(map.id, g.dataset.room); }));
  MAP.on('click', closeSide);
  if (plan.party) { const r = plan.rooms.find(x => x.id === plan.party); if (r) setTimeout(() => MAP.panTo(toLL({ height: plan.h }, r.x + r.w / 2, r.y + r.h / 2), { animate: false }), 50); }
}
async function openRoom(planId, roomId) {
  const plans = await load('plans');
  const plan = plans[planId]; const r = plan.rooms.find(x => x.id === roomId); if (!r) return;
  MS.room = roomId;
  MS.svg.querySelectorAll('.room.selected').forEach(g => g.classList.remove('selected'));
  MS.svg.querySelector(`[data-room="${roomId}"]`).classList.add('selected');
  const side = $('#map-side');
  side.classList.remove('hidden');
  side.innerHTML = `<div class="row spread"><h3>${plan.party === r.id ? '🐐 ' : ''}<span id="room-title">${esc(r.name)}</span></h3><button class="btn small ghost" id="side-close" aria-label="Close">${ic('x')}</button></div>
    <div class="row" style="margin-top:4px">
      <button class="btn small ${plan.party === r.id ? 'on' : 'primary'}" id="room-party">${plan.party === r.id ? '🐐 Party is here' : '🐐 Party moves here'}</button>
      <label class="row" style="gap:5px;margin:0"><input type="checkbox" id="room-explored" ${r.explored ? 'checked' : ''}> explored</label>
    </div>
    <label>Name</label><input id="room-name" value="${esc(r.name)}">
    <label>Read-aloud / description</label><textarea id="room-desc">${esc(r.desc || '')}</textarea>
    <label>DM notes (what happened here, loot, who's inside)</label><textarea id="room-notes" placeholder="Both DMs see these.">${esc(r.notes || '')}</textarea>
    <div class="muted" id="room-status" style="font-size:12px;min-height:1em;margin-top:4px"></div>`;
  $('#side-close').onclick = closeSide;
  const patch = async (body, label) => {
    $('#room-status').textContent = 'Saving…';
    try { await api(`/api/plans/${planId}`, { method: 'PATCH', body }); $('#room-status').textContent = label || 'Saved ✓'; }
    catch (e) { $('#room-status').textContent = 'Not saved: ' + e.message; return; }
    stylePlan(MS.svg, (await load('plans'))[planId]);
  };
  $('#room-party').onclick = async () => { await patch({ party: r.id, rooms: { [r.id]: { explored: true } } }, '🐐 Party moved'); openRoom(planId, roomId); };
  $('#room-explored').onchange = e => patch({ rooms: { [r.id]: { explored: e.target.checked } } });
  let t = null;
  const debounced = () => { clearTimeout(t); $('#room-status').textContent = 'Typing…'; t = setTimeout(() => patch({ rooms: { [r.id]: { name: $('#room-name').value.trim() || r.name, desc: $('#room-desc').value, notes: $('#room-notes').value } } }), 900); };
  $('#room-name').oninput = debounced; $('#room-desc').oninput = debounced; $('#room-notes').oninput = debounced;
}

// live updates from the other DM: redraw in place, never reset the view
const mapShowing = () => (S.tab === 'map' || S.pin === 'map') && MAP && document.body.contains(MAP.getContainer());
LIVE_HOOKS.pins = (prev, next) => { if (mapShowing() && MS.map && MS.map.type === 'image') drawPins(next); };
LIVE_HOOKS.plans = (prev, next) => {
  if (!mapShowing() || !MS.svg || !MS.map) return;
  const plan = next[MS.map.id]; if (!plan) return;
  stylePlan(MS.svg, plan);
  if (MS.room && !document.activeElement?.closest?.('#map-side')) openRoom(MS.map.id, MS.room);
};
