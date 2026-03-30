/* =========================================
   INEM Centro — Tempos de Resposta
   Main Application Logic — v2
   ========================================= */

'use strict';

// ===================== CONFIG =====================
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjllZWUxY2ZjM2IzYTQwY2RhZTRjMDA0MTA0MzZkODE3IiwiaCI6Im11cm11cjY0In0=';
const ORS_BASE    = 'https://api.openrouteservice.org/v2';
const EMERGENCY_SPEED_FACTOR = 1.3;
const MAP_CENTER  = [40.15, -8.15];
const MAP_ZOOM    = 8;

// Route palette: up to 5 blues for units, up to 3 greens for hospitals (low-brightness)
const UNIT_ROUTE_COLORS = ['#3a6898', '#4878b0', '#2a5080', '#5888b8', '#306090'];
const HOSP_ROUTE_COLORS = ['#256838', '#2e7a46', '#388c54'];

// ===================== STATE =====================
const state = {
  timeFilter:  30,                        // active time cap (30 | 60 | 90)
  typeFilters: new Set(['aem','siv','vmer']),
  lastSearch:  null,                      // { lat, lon, label, allUnitETAs, allHospETAs }
  searchMarker: null,
  unitRoutes:  [],                        // [{ name, layer, color }]  max 5
  hospRoutes:  [],                        // [{ name, layer, color }]  max 3
};

// ===================== DATA =====================
function parseUnits() {
  const units = [];
  (ISOCHRONE_DATA.aem_codu_centro || []).forEach(b => {
    if (b.name.startsWith('AE'))
      units.push({ name: b.name, lat: b.lat, lon: b.lon, subGroup: 'aem',  typeLabel: 'AEM',  color: '#4878b0' });
    else if (b.name.startsWith('SI'))
      units.push({ name: b.name, lat: b.lat, lon: b.lon, subGroup: 'siv',  typeLabel: 'SIV',  color: '#2e7a54' });
  });
  (ISOCHRONE_DATA.vmer_drc || []).forEach(b => {
    units.push({ name: b.name, lat: b.lat, lon: b.lon, subGroup: 'vmer', typeLabel: 'VMER', color: '#9a6e28' });
  });
  return units;
}

function parseHospitals() {
  return (ISOCHRONE_DATA.hospitais || []).map(h => ({
    name: h.name, lat: h.lat, lon: h.lon,
    subGroup: 'hosp', typeLabel: h.type || 'SUB', color: '#256838'
  }));
}

const allUnits     = typeof ISOCHRONE_DATA !== 'undefined' ? parseUnits()     : [];
const allHospitals = typeof ISOCHRONE_DATA !== 'undefined' ? parseHospitals() : [];

// ===================== MAP =====================
const map = L.map('map', { center: MAP_CENTER, zoom: MAP_ZOOM, zoomControl: false });

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19
}).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);

// ===================== SEARCH PIN =====================
function makeSearchIcon() {
  return L.divIcon({
    html: `<div class="pulse-icon"></div>`,
    className: '', iconSize: [18,18], iconAnchor: [9,9]
  });
}

// ===================== FILTER CONTROLS =====================
document.querySelectorAll('.filter-time').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-time').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.timeFilter = parseInt(btn.dataset.time);
    if (state.lastSearch) { cleanRoutesOutsideFilter(); renderResults(); }
  });
});

document.querySelectorAll('.filter-type').forEach(btn => {
  btn.addEventListener('click', () => {
    const type = btn.dataset.type;
    if (state.typeFilters.has(type)) {
      state.typeFilters.delete(type);
      btn.classList.remove('active');
    } else {
      state.typeFilters.add(type);
      btn.classList.add('active');
    }
    if (state.lastSearch) { cleanRoutesOutsideFilter(); renderResults(); }
  });
});

// Remove routes for units no longer visible after filter change
function cleanRoutesOutsideFilter() {
  const visibleNames = new Set(getFilteredUnits().map(u => u.name));
  state.unitRoutes = state.unitRoutes.filter(r => {
    if (!visibleNames.has(r.name)) { map.removeLayer(r.layer); return false; }
    return true;
  });
}

// ===================== FILTER HELPERS =====================
function getFilteredUnits() {
  if (!state.lastSearch) return [];
  return state.lastSearch.allUnitETAs.filter(u =>
    state.typeFilters.has(u.subGroup) && u.etaMin <= state.timeFilter
  );
}

// ===================== STATUS CHIP =====================
function showStatus(text) {
  const chip = document.getElementById('status-chip');
  document.getElementById('status-text').textContent = text;
  chip.classList.remove('hidden');
}
function hideStatus() {
  document.getElementById('status-chip').classList.add('hidden');
}

// ===================== RESULTS PANEL =====================
function renderResults() {
  const panel = document.getElementById('results-panel');

  if (!state.lastSearch) {
    panel.innerHTML = `<div class="results-placeholder">
      <svg viewBox="0 0 24 24" fill="none"><circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="1.5"/>
      <path d="M21 21l-4.35-4.35" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      <p>Pesquise uma morada ou código postal para ver os meios de emergência mais próximos</p>
    </div>`;
    return;
  }

  const filtered = getFilteredUnits();
  const hospitals = state.lastSearch.allHospETAs;

  // Count fallback sources across all results
  const allResults = [...state.lastSearch.allUnitETAs, ...hospitals];
  const nEstimate  = allResults.filter(r => r.source === 'estimate').length;
  const nGrid      = allResults.filter(r => r.source === 'grid').length;

  let sourceSummary = '';
  if (nEstimate > 0) sourceSummary = `<span style="color:#ef4444">${nEstimate} estimado${nEstimate > 1 ? 's' : ''}</span>`;
  else if (nGrid > 0) sourceSummary = `<span style="color:#f59e0b">${nGrid} aprox.</span>`;

  let html = '';

  // ---- Recalculate bar ----
  html += `<div class="recalc-bar">
    <span class="recalc-bar-label">
      ${sourceSummary || '<strong>ORS</strong> · rede viária real'}
    </span>
    <button class="recalc-btn" id="recalc-btn">
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M23 4v6h-6M1 20v-6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      Recalcular
    </button>
  </div>`;

  // ---- Units section ----
  html += `<div class="results-section">
    <div class="results-section-header">
      <span class="results-section-title">Meios de Emergência</span>
      <span class="results-section-count">${filtered.length}</span>
    </div>`;

  if (filtered.length === 0) {
    html += `<div class="results-empty">Nenhum meio em ≤${state.timeFilter}' com os filtros activos</div>`;
  } else {
    filtered.forEach(u => {
      const mins = Math.round(u.etaMin);
      const km   = u.distKm ? u.distKm.toFixed(1) : '—';
      const activeRoute = state.unitRoutes.find(r => r.name === u.name);
      const routeColor  = activeRoute ? activeRoute.color : '';
      html += resultRowHTML(u.name, u.typeLabel, u.color, mins, km, 'unit', !!activeRoute, routeColor, u.lat, u.lon, false, u.source);
    });
  }
  html += '</div>';

  // ---- Hospitals section ----
  html += `<div class="results-section">
    <div class="results-section-header">
      <span class="results-section-title">Hospitais</span>
      <span class="results-section-count">${hospitals.length}</span>
    </div>`;

  hospitals.forEach(h => {
    const mins = Math.round(h.etaMin);
    const km   = h.distKm ? h.distKm.toFixed(1) : '—';
    const typeColors = { SUP: '#256838', SUMC: '#2e7a46', SUB: '#387050' };
    const col = typeColors[h.typeLabel] || '#256838';
    const activeRoute = state.hospRoutes.find(r => r.name === h.name);
    const routeColor  = activeRoute ? activeRoute.color : '';
    html += resultRowHTML(h.name, h.typeLabel, col, mins, km, 'hosp', !!activeRoute, routeColor, h.lat, h.lon, true, h.source);
  });
  html += '</div>';

  panel.innerHTML = html;

  // Bind clicks
  panel.querySelectorAll('.result-row').forEach(row => {
    row.addEventListener('click', async e => {
      if (e.target.closest('.result-route-btn')) return;
      const btn = row.querySelector('.result-route-btn');
      if (!btn) return;
      await handleRouteToggle(btn.dataset.name, btn.dataset.rtype, parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lon));
      renderResults();
    });
  });

  panel.querySelectorAll('.result-route-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      await handleRouteToggle(btn.dataset.name, btn.dataset.rtype, parseFloat(btn.dataset.lat), parseFloat(btn.dataset.lon));
      renderResults();
    });
  });

  // Recalculate button
  const recalcBtn = document.getElementById('recalc-btn');
  if (recalcBtn) {
    recalcBtn.addEventListener('click', async () => {
      if (!state.lastSearch) return;
      recalcBtn.classList.add('loading');
      recalcBtn.textContent = 'A calcular…';

      clearAllRoutes();
      document.getElementById('results-panel').innerHTML = `
        <div class="results-computing">
          <div class="spinner"></div>
          A recalcular ETAs via ORS…
        </div>`;
      showStatus('A recalcular…');

      const { allUnitETAs, allHospETAs } = await computeAllETAs(state.lastSearch.lat, state.lastSearch.lon);
      state.lastSearch.allUnitETAs = allUnitETAs;
      state.lastSearch.allHospETAs = allHospETAs;

      const filtered = allUnitETAs.filter(u => state.typeFilters.has(u.subGroup) && u.etaMin <= state.timeFilter);
      showStatus(`${filtered.length} meios · ${allHospETAs.length} hospitais`);
      renderResults();
    });
  }
}

function resultRowHTML(name, typeLabel, color, mins, km, rtype, isActive, routeColor, lat, lon, isHosp = false, source = 'ors') {
  const activeStyle  = isActive ? `style="--route-color:${routeColor}"` : '';
  const activeClass  = isActive ? 'route-active' : '';
  const hospClass    = isHosp   ? ' hosp-row'    : '';
  const sourceClass  = source !== 'ors' ? ` source-${source}` : '';

  const sourceBadge = source === 'estimate'
    ? `<span class="source-badge source-badge--estimate" title="ETA estimado por linha recta — ORS indisponível">EST</span>`
    : source === 'grid'
    ? `<span class="source-badge source-badge--grid" title="ETA aproximado por grelha pré-calculada">~</span>`
    : '';

  const distLabel = source === 'estimate' ? `~${km} km` : `${km} km`;

  return `<div class="result-row${hospClass}${sourceClass} ${activeClass}" ${activeStyle}>
    <div class="result-dot" style="background:${color}"></div>
    <div class="result-info">
      <span class="result-name">${name}</span>
      <span class="result-type-badge" style="color:${color}">${typeLabel}</span>
      ${sourceBadge}
    </div>
    <div class="result-meta">
      <span class="result-eta">${mins}'</span>
      <span class="result-dist">${distLabel}</span>
    </div>
    <button class="result-route-btn ${isActive ? 'active' : ''}"
            data-name="${name}" data-rtype="${rtype}" data-lat="${lat}" data-lon="${lon}"
            title="${isActive ? 'Remover rota' : 'Ver rota no mapa'}">
      <svg viewBox="0 0 24 24" fill="none">
        ${isActive
          ? '<path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>'
          : '<path d="M3 12h18M13 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>'}
      </svg>
    </button>
  </div>`;
}

// ===================== ROUTE MANAGEMENT =====================
async function handleRouteToggle(name, rtype, toLat, toLon) {
  const isHosp   = rtype === 'hosp';
  const routes   = isHosp ? state.hospRoutes : state.unitRoutes;
  const colors   = isHosp ? HOSP_ROUTE_COLORS : UNIT_ROUTE_COLORS;
  const maxCount = isHosp ? 3 : 5;

  // Toggle off if already active
  const existIdx = routes.findIndex(r => r.name === name);
  if (existIdx >= 0) {
    map.removeLayer(routes[existIdx].layer);
    routes.splice(existIdx, 1);
    return;
  }

  // At capacity: remove oldest
  while (routes.length >= maxCount) {
    const oldest = routes.shift();
    map.removeLayer(oldest.layer);
  }

  // Assign color by current queue length
  const color = colors[routes.length % colors.length];

  if (!state.lastSearch) return;
  showStatus('A traçar rota…');
  const layer = await fetchRoute(state.lastSearch.lat, state.lastSearch.lon, toLat, toLon, color);
  hideStatus();

  routes.push({ name, layer, color });
}

async function fetchRoute(fromLat, fromLon, toLat, toLon, color) {
  try {
    const resp = await fetch(`${ORS_BASE}/directions/driving-car/geojson`, {
      method: 'POST',
      headers: { 'Authorization': ORS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [[fromLon, fromLat], [toLon, toLat]], preference: 'fastest' })
    });
    if (!resp.ok) throw new Error('ORS directions ' + resp.status);
    const gj = await resp.json();
    const layer = L.geoJSON(gj, {
      style: { color, weight: 4, opacity: 0.88, lineJoin: 'round' }
    }).addTo(map);
    // Fit map to show the full route
    try { map.fitBounds(layer.getBounds(), { padding: [50, 50], maxZoom: 14 }); } catch(_) {}
    return layer;
  } catch (_) {
    // Fallback: straight line
    const layer = L.polyline([[fromLat, fromLon],[toLat, toLon]], {
      color, weight: 3, opacity: 0.7, dashArray: '8 5'
    }).addTo(map);
    try { map.fitBounds(layer.getBounds(), { padding: [50, 50] }); } catch(_) {}
    return layer;
  }
}

function clearAllRoutes() {
  [...state.unitRoutes, ...state.hospRoutes].forEach(r => map.removeLayer(r.layer));
  state.unitRoutes = [];
  state.hospRoutes = [];
}

// ===================== ETA COMPUTATION =====================
async function computeAllETAs(destLat, destLon) {
  // Primary: ORS Matrix for all units (road network, real distances)
  let unitETAs = await computeORSETAs(destLat, destLon, allUnits);

  // For any that fell back to estimate, try grid as secondary fallback
  const needGrid = unitETAs.filter(u => u.source === 'estimate').map(u => u.name);
  if (needGrid.length > 0 && typeof GRID_ETA_DATA !== 'undefined') {
    const gridUnits = allUnits.filter(u => needGrid.includes(u.name));
    const gridRes   = computeGridETAs(destLat, destLon, gridUnits);
    unitETAs = unitETAs.map(u => {
      if (u.source !== 'estimate') return u;
      return gridRes.find(g => g.name === u.name) || u;
    });
  }

  unitETAs.sort((a, b) => a.etaMin - b.etaMin);

  const allHospETAs = await computeHospitalETAs(destLat, destLon);
  return { allUnitETAs: unitETAs, allHospETAs };
}

function computeGridETAs(destLat, destLon, units) {
  if (!GRID_ETA_DATA?.destinations || !GRID_ETA_DATA?.origins) return [];
  const dests   = GRID_ETA_DATA.destinations;
  const origins = GRID_ETA_DATA.origins;
  const matrix  = GRID_ETA_DATA.durations;

  // 3 nearest grid destination points
  const sorted = dests
    .map((d, i) => ({ i, d: Math.hypot(d[0] - destLat, d[1] - destLon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 3);

  const results = [];
  units.forEach(unit => {
    const oIdx = origins.findIndex(o => o.name === unit.name);
    if (oIdx < 0) return;

    let sumW = 0, sumETA = 0;
    sorted.forEach(n => {
      const w = 1 / Math.max(n.d, 0.0001);
      const sec = matrix[n.i]?.[oIdx];
      if (sec == null) return;
      sumW += w; sumETA += w * sec;
    });
    if (sumW === 0) return;

    const etaMin = (sumETA / sumW) / EMERGENCY_SPEED_FACTOR / 60;
    // Grid has no road distance — apply typical road tortuosity factor for Portugal
    const distKm = haversineKm(destLat, destLon, unit.lat, unit.lon) * 1.45;
    results.push({ ...unit, etaMin, distKm, source: 'grid' });
  });
  return results;
}

async function computeORSETAs(destLat, destLon, units) {
  if (units.length === 0) return [];
  try {
    // Index 0 = search point; 1..N = units
    // sources = units, destination = search point → time FROM unit TO incident
    const locations    = [[destLon, destLat], ...units.map(u => [u.lon, u.lat])];
    const unitIndices  = units.map((_, i) => i + 1);
    const resp = await fetch(`${ORS_BASE}/matrix/driving-car`, {
      method: 'POST',
      headers: { 'Authorization': ORS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations,
        sources:      unitIndices,   // each unit is a source
        destinations: [0],           // search point is the destination
        metrics: ['duration', 'distance']
      })
    });
    if (!resp.ok) throw new Error('ORS matrix ' + resp.status);
    const data = await resp.json();
    // Response: durations[i][0] = duration from unit i to search point
    return units.map((u, i) => {
      const sec  = data.durations?.[i]?.[0]  ?? null;
      const dist = data.distances?.[i]?.[0]  ?? null;
      const etaMin = sec  != null ? sec  / EMERGENCY_SPEED_FACTOR / 60          : estimateETA(destLat, destLon, u);
      const distKm = dist != null ? dist / 1000                                  : haversineKm(destLat, destLon, u.lat, u.lon) * 1.45;
      return { ...u, etaMin, distKm, source: sec != null ? 'ors' : 'estimate' };
    });
  } catch (_) {
    return units.map(u => ({
      ...u,
      etaMin: estimateETA(destLat, destLon, u),
      distKm: haversineKm(destLat, destLon, u.lat, u.lon) * 1.45,
      source: 'estimate'
    }));
  }
}

async function computeHospitalETAs(destLat, destLon) {
  const main = allHospitals.filter(h => h.typeLabel !== 'SUB');
  const subs = allHospitals.filter(h => h.typeLabel === 'SUB');

  // Pre-select candidates by straight-line distance before calling ORS
  const candidates = [
    ...main.map(h => ({ ...h, distKm: haversineKm(destLat, destLon, h.lat, h.lon) })).sort((a,b) => a.distKm - b.distKm).slice(0, 6),
    ...subs.map(h => ({ ...h, distKm: haversineKm(destLat, destLon, h.lat, h.lon) })).sort((a,b) => a.distKm - b.distKm).slice(0, 4),
  ];

  try {
    // sources = hospitals → destination = search point (time from hospital to incident)
    const locations    = [[destLon, destLat], ...candidates.map(h => [h.lon, h.lat])];
    const hospIndices  = candidates.map((_, i) => i + 1);
    const resp = await fetch(`${ORS_BASE}/matrix/driving-car`, {
      method: 'POST',
      headers: { 'Authorization': ORS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        locations,
        sources:      hospIndices,
        destinations: [0],
        metrics: ['duration', 'distance']
      })
    });
    if (resp.ok) {
      const data = await resp.json();
      candidates.forEach((h, i) => {
        const sec  = data.durations?.[i]?.[0] ?? null;
        const dist = data.distances?.[i]?.[0] ?? null;
        h.etaMin = sec  != null ? sec  / EMERGENCY_SPEED_FACTOR / 60 : estimateETA(destLat, destLon, h);
        h.distKm = dist != null ? dist / 1000                         : h.distKm * 1.45;
        h.source = sec != null ? 'ors' : 'estimate';
      });
    } else {
      candidates.forEach(h => {
        h.etaMin = estimateETA(destLat, destLon, h);
        h.distKm = h.distKm * 1.45;
        h.source = 'estimate';
      });
    }
  } catch (_) {
    candidates.forEach(h => {
      h.etaMin = estimateETA(destLat, destLon, h);
      h.distKm = h.distKm * 1.45;
      h.source = 'estimate';
    });
  }

  candidates.sort((a, b) => a.etaMin - b.etaMin);

  // Pick 3 main (SUP/SUMC) + 2 SUB, sorted by ETA
  const chosen = [];
  let mainPicked = 0, subPicked = 0;
  for (const h of candidates) {
    if (h.typeLabel !== 'SUB' && mainPicked < 3) { chosen.push(h); mainPicked++; }
    else if (h.typeLabel === 'SUB' && subPicked < 2) { chosen.push(h); subPicked++; }
    if (mainPicked >= 3 && subPicked >= 2) break;
  }
  chosen.sort((a, b) => a.etaMin - b.etaMin);
  return chosen;
}

function estimateETA(destLat, destLon, unit) {
  const dist = haversineKm(destLat, destLon, unit.lat, unit.lon);
  return (dist * 1.6) / (80 * EMERGENCY_SPEED_FACTOR) * 60;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ===================== SEARCH =====================
const searchInput   = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchClear   = document.getElementById('search-clear');
let searchDebounce  = null;

searchInput.addEventListener('input', () => {
  const val = searchInput.value.trim();
  searchClear.classList.toggle('visible', val.length > 0);
  clearTimeout(searchDebounce);
  if (val.length < 2) { hideSearchResults(); return; }
  searchDebounce = setTimeout(() => doSearch(val), 280);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') clearSearch();
});

searchClear.addEventListener('click', clearSearch);

function clearSearch() {
  searchInput.value = '';
  searchClear.classList.remove('visible');
  hideSearchResults();
  if (state.searchMarker) { map.removeLayer(state.searchMarker); state.searchMarker = null; }
  clearAllRoutes();
  state.lastSearch = null;
  renderResults();
  hideStatus();
}

function hideSearchResults() {
  searchResults.classList.remove('visible');
  searchResults.innerHTML = '';
}

async function doSearch(query) {
  const results = [];

  // GPS coordinates
  const gpsMatch = query.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
  if (gpsMatch) {
    const lat = parseFloat(gpsMatch[1]), lon = parseFloat(gpsMatch[2]);
    if (lat >= 36 && lat <= 44 && lon >= -10 && lon <= -6)
      results.push({ label: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, sub: 'Coordenadas GPS', lat, lon });
  }

  // Postal code — CP4 index first (fast)
  const cpMatch = query.replace(/\s/g, '').match(/^(\d{4})-?(\d{3})?$/);
  if (cpMatch) {
    const cp4 = cpMatch[1], cp3 = cpMatch[2] || '';
    const fullCp = cp3 ? `${cp4}-${cp3}` : cp4;

    if (cp3 && typeof POSTAL_DATA !== 'undefined') {
      const lines = POSTAL_DATA.split('\n');
      let count = 0;
      for (const line of lines) {
        if (!line.trim()) continue;
        const [cp, loc, lat, lon] = line.split('|');
        if (cp && cp.startsWith(fullCp)) {
          results.push({ label: `${cp} — ${loc}`, sub: 'Código Postal CTT', lat: parseFloat(lat), lon: parseFloat(lon) });
          if (++count >= 8) break;
        }
      }
    } else if (typeof POSTAL_CP4 !== 'undefined' && POSTAL_CP4[cp4]) {
      const e = POSTAL_CP4[cp4];
      results.push({ label: `${cp4} — ${e.loc}`, sub: 'Código Postal CTT', lat: e.lat, lon: e.lon });
    }
  }

  // Free text → Photon geocoder
  if (results.length < 3 && !cpMatch) {
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query + ' Portugal')}&limit=5&lang=pt`;
      const data = await (await fetch(url)).json();
      (data.features || []).forEach(f => {
        const p = f.properties;
        const name = [p.name, p.city||p.town||p.village, p.county, p.country].filter(Boolean).join(', ');
        results.push({ label: name, sub: (p.postcode ? p.postcode + ' ' : '') + (p.country||''), lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0] });
      });
    } catch(_) {}

    // Nominatim fallback
    if (results.length === 0) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=pt&limit=5`;
        const data = await (await fetch(url, { headers: { 'Accept-Language': 'pt' } })).json();
        data.forEach(r => {
          results.push({ label: r.display_name.split(',').slice(0,3).join(','), sub: r.type, lat: parseFloat(r.lat), lon: parseFloat(r.lon) });
        });
      } catch(_) {}
    }
  }

  renderSearchResults(results);
}

function renderSearchResults(results) {
  searchResults.innerHTML = '';
  if (results.length === 0) {
    searchResults.innerHTML = '<div class="search-no-results">Nenhum resultado encontrado</div>';
    searchResults.classList.add('visible');
    return;
  }
  results.forEach(r => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    item.innerHTML = `<div class="search-result-main">${r.label}</div><div class="search-result-sub">${r.sub}</div>`;
    item.addEventListener('click', () => selectResult(r));
    searchResults.appendChild(item);
  });
  searchResults.classList.add('visible');
}

async function selectResult(r) {
  hideSearchResults();
  searchInput.value = r.label;

  // Clear previous
  if (state.searchMarker) map.removeLayer(state.searchMarker);
  clearAllRoutes();
  state.lastSearch = null;

  // Place pin
  state.searchMarker = L.marker([r.lat, r.lon], { icon: makeSearchIcon(), zIndexOffset: 1000 }).addTo(map);
  map.flyTo([r.lat, r.lon], 12, { animate: true, duration: 0.6 });

  // Show computing state in sidebar
  document.getElementById('results-panel').innerHTML = `
    <div class="results-computing">
      <div class="spinner"></div>
      A calcular ETAs para ${allUnits.length} meios…
    </div>`;
  showStatus('A calcular ETAs…');

  closeSidebarMobile();

  const { allUnitETAs, allHospETAs } = await computeAllETAs(r.lat, r.lon);

  state.lastSearch = { lat: r.lat, lon: r.lon, label: r.label, allUnitETAs, allHospETAs };

  // Status chip summary
  const filtered = getFilteredUnits();
  showStatus(`${filtered.length} meios · ${allHospETAs.length} hospitais`);

  renderResults();
}

// ===================== MOBILE SIDEBAR =====================
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('sidebar-overlay');

document.getElementById('hamburger').addEventListener('click', () => {
  sidebar.classList.add('open');
  overlay.classList.add('visible');
});
document.getElementById('hamburger-close').addEventListener('click', closeSidebarMobile);
overlay.addEventListener('click', closeSidebarMobile);

function closeSidebarMobile() {
  sidebar.classList.remove('open');
  overlay.classList.remove('visible');
}

// ===================== BOOT =====================
window.addEventListener('DOMContentLoaded', () => {
  if (typeof ISOCHRONE_DATA === 'undefined') {
    window.ISOCHRONE_DATA = { aem_codu_centro: [], vmer_drc: [], hospitais: [] };
  }
  renderResults(); // show placeholder
});
