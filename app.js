/* =========================================
   INEM Centro — Isócronas de Emergência
   Main Application Logic
   ========================================= */

'use strict';

// ===================== CONFIG =====================
const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjllZWUxY2ZjM2IzYTQwY2RhZTRjMDA0MTA0MzZkODE3IiwiaCI6Im11cm11cjY0In0=';
const ORS_BASE    = 'https://api.openrouteservice.org/v2';
const EMERGENCY_SPEED_FACTOR = 1.3;
const MAP_CENTER  = [40.15, -8.15];
const MAP_ZOOM    = 8;

// ===================== STATE =====================
const state = {
  activeUnits: new Set(),       // set of unit names that are toggled ON
  isoLayer30: {},               // name -> leaflet layer
  isoLayer60: {},
  markerLayer: {},              // name -> leaflet marker
  band30Active: true,
  band60Active: false,
  searchMarker: null,
  routeLayer: null,
  isoGroupLayers: { 30: L.layerGroup(), 60: L.layerGroup() }
};

// ===================== DATA PARSING =====================
function parseUnits() {
  const units = [];

  // AEM
  (ISOCHRONE_DATA.aem_codu_centro || []).forEach(b => {
    if (b.name.startsWith('AE')) {
      units.push({ ...b, subGroup: 'aem', typeLabel: 'AEM', color: '#3b82f6' });
    } else if (b.name.startsWith('SI')) {
      units.push({ ...b, subGroup: 'siv', typeLabel: 'SIV', color: '#10b981' });
    }
  });

  // VMER + HIDRC
  (ISOCHRONE_DATA.vmer_drc || []).forEach(b => {
    units.push({ ...b, subGroup: 'vmer', typeLabel: 'VMER', color: '#f59e0b' });
  });

  return units;
}

function parseHospitals() {
  return (ISOCHRONE_DATA.hospitais || []).map(h => ({
    ...h,
    subGroup: 'hosp',
    typeLabel: h.type || 'SUB',
    color: '#16a34a'
  }));
}

// ===================== MAP INIT =====================
const renderer = L.canvas({ padding: 0.5 });

const map = L.map('map', {
  center: MAP_CENTER,
  zoom: MAP_ZOOM,
  zoomControl: false,
  renderer
});

L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  maxZoom: 19
}).addTo(map);

L.control.zoom({ position: 'bottomright' }).addTo(map);

state.isoGroupLayers[30].addTo(map);
state.isoGroupLayers[60].addTo(map);

const markersGroup = L.layerGroup().addTo(map);
const hospitalsGroup = L.layerGroup().addTo(map);

// ===================== ICONS =====================
function makeUnitIcon(color, label) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="36" viewBox="0 0 28 36">
    <path d="M14 0C6.27 0 0 6.27 0 14c0 9.75 14 22 14 22S28 23.75 28 14C28 6.27 21.73 0 14 0z" fill="${color}" opacity="0.9"/>
    <circle cx="14" cy="14" r="6" fill="white" opacity="0.95"/>
    <text x="14" y="18" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="7" font-weight="700" fill="${color}">${label}</text>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [28, 36],
    iconAnchor: [14, 36],
    popupAnchor: [0, -38]
  });
}

function makeHospitalIcon(type) {
  const mainColor = (type === 'SUP' || type === 'SUMC') ? '#16a34a' : '#4ade80';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="26" height="34" viewBox="0 0 26 34">
    <path d="M13 0C5.82 0 0 5.82 0 13c0 9.1 13 21 13 21S26 22.1 26 13C26 5.82 20.18 0 13 0z" fill="${mainColor}" opacity="0.9"/>
    <rect x="9" y="8" width="8" height="2" fill="white" rx="1"/>
    <rect x="9" y="13" width="8" height="2" fill="white" rx="1"/>
    <rect x="12" y="8" width="2" height="9" fill="white" rx="1"/>
    <text x="13" y="30" text-anchor="middle" font-family="DM Sans, sans-serif" font-size="5" font-weight="700" fill="${mainColor}">H</text>
  </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [26, 34],
    iconAnchor: [13, 34],
    popupAnchor: [0, -36]
  });
}

function makeSearchIcon() {
  const html = `<div class="pulse-icon"></div>`;
  return L.divIcon({
    html,
    className: '',
    iconSize: [18, 18],
    iconAnchor: [9, 9],
    popupAnchor: [0, -12]
  });
}

// ===================== POPUP BUILDERS =====================
function buildUnitPopup(unit) {
  return `<div class="popup-wrap">
    <div class="popup-header">
      <div class="popup-name" style="color:${unit.color}">${unit.name}</div>
      <div class="popup-type">${unit.typeLabel} — INEM Região Centro</div>
      <div class="popup-coords">${unit.lat.toFixed(6)}, ${unit.lon.toFixed(6)}</div>
    </div>
  </div>`;
}

function buildHospitalPopup(h) {
  const typeColors = { SUP: '#16a34a', SUMC: '#22c55e', SUB: '#4ade80' };
  const col = typeColors[h.typeLabel] || '#16a34a';
  return `<div class="popup-wrap">
    <div class="popup-header">
      <div class="popup-name" style="color:${col}">${h.name}</div>
      <div class="popup-type">Hospital — Urgência ${h.typeLabel}</div>
      <div class="popup-coords">${h.lat.toFixed(6)}, ${h.lon.toFixed(6)}</div>
    </div>
  </div>`;
}

function buildSearchPopup(address, results) {
  const { units: etaUnits, hospitals: etaHospitals } = results;

  let unitsHtml = '';
  if (etaUnits.length === 0) {
    unitsHtml = '<tr><td colspan="4" style="text-align:center;color:var(--text-muted);padding:8px 0">Nenhum meio encontrado</td></tr>';
  } else {
    etaUnits.forEach(u => {
      const mins = Math.round(u.etaMin);
      const band = mins <= 30 ? '30' : (mins <= 46 ? '60' : 'far');
      const bandLabel = band === '30' ? '≤30\'' : (band === '60' ? '>30\'' : '>46\'');
      const km = u.distKm ? u.distKm.toFixed(1) + ' km' : '—';
      unitsHtml += `<tr>
        <td><span class="eta-row-name" style="color:${u.color}" data-name="${u.name}" data-lat="${u.lat}" data-lon="${u.lon}">${u.name}</span></td>
        <td><span class="eta-band eta-band--${band}">${bandLabel}</span></td>
        <td class="eta-time">${mins}'</td>
        <td class="eta-dist">${km}</td>
        <td><button class="eta-route-btn" data-olat="${u.lat}" data-olon="${u.lon}" title="Ver rota">
          <svg viewBox="0 0 24 24" fill="none"><path d="M3 12h18M13 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button></td>
      </tr>`;
    });
  }

  let hospHtml = '';
  etaHospitals.forEach(h => {
    const mins = Math.round(h.etaMin);
    const km = h.distKm ? h.distKm.toFixed(1) + ' km' : '—';
    hospHtml += `<tr>
      <td colspan="2"><span class="eta-row-name" style="color:#16a34a" data-name="${h.name}" data-lat="${h.lat}" data-lon="${h.lon}">${h.name}</span>
        <span class="eta-band" style="margin-left:4px;background:rgba(22,163,74,0.1);color:#16a34a">${h.typeLabel}</span></td>
      <td class="eta-time">${mins}'</td>
      <td class="eta-dist">${km}</td>
      <td><button class="eta-route-btn" data-olat="${h.lat}" data-olon="${h.lon}" title="Ver rota">
        <svg viewBox="0 0 24 24" fill="none"><path d="M3 12h18M13 5l7 7-7 7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button></td>
    </tr>`;
  });

  return `<div class="popup-wrap">
    <div class="popup-header">
      <div class="popup-name" style="color:#ef4444">${address}</div>
      <div class="popup-type">Ponto de pesquisa</div>
    </div>
    <div class="popup-body">
      <div class="popup-section-title">Meios de emergência (${etaUnits.length})</div>
      <table class="eta-table">
        <thead><tr><th>Meio</th><th>Banda</th><th>ETA</th><th>Dist.</th><th></th></tr></thead>
        <tbody>${unitsHtml}</tbody>
      </table>
      ${etaHospitals.length > 0 ? `
      <div class="popup-section-title" style="margin-top:10px">Hospitais próximos</div>
      <table class="eta-table">
        <tbody>${hospHtml}</tbody>
      </table>` : ''}
    </div>
  </div>`;
}

// ===================== ISOCHRONES =====================
function styleIsochrone(band, opacity = 0.18) {
  return {
    fillColor: band === 30 ? '#22c55e' : '#ef4444',
    fillOpacity: opacity,
    color: band === 30 ? '#22c55e' : '#ef4444',
    weight: 1.5,
    opacity: 0.5
  };
}

function addIsochrones(unit) {
  const isos = unit.isochrones || {};

  if (isos['30']) {
    const l = L.geoJSON(isos['30'], { style: styleIsochrone(30) });
    state.isoLayer30[unit.name] = l;
    if (state.band30Active) state.isoGroupLayers[30].addLayer(l);
  }

  if (isos['60']) {
    const l = L.geoJSON(isos['60'], { style: styleIsochrone(60) });
    state.isoLayer60[unit.name] = l;
    if (state.band60Active) state.isoGroupLayers[60].addLayer(l);
  }
}

function removeIsochrones(unit) {
  if (state.isoLayer30[unit.name]) {
    state.isoGroupLayers[30].removeLayer(state.isoLayer30[unit.name]);
  }
  if (state.isoLayer60[unit.name]) {
    state.isoGroupLayers[60].removeLayer(state.isoLayer60[unit.name]);
  }
}

function toggleBand(band, active) {
  const layer = state.isoGroupLayers[band];
  if (active) {
    layer.addTo(map);
    // Re-add active unit isos for this band
    const dict = band === 30 ? state.isoLayer30 : state.isoLayer60;
    state.activeUnits.forEach(name => {
      if (dict[name]) layer.addLayer(dict[name]);
    });
  } else {
    map.removeLayer(layer);
  }
}

// ===================== MARKERS =====================
function addUnitMarker(unit) {
  const icon = makeUnitIcon(unit.color, unit.typeLabel.slice(0, 2));
  const marker = L.marker([unit.lat, unit.lon], { icon });
  marker.bindPopup(buildUnitPopup(unit), { maxWidth: 320 });
  marker.bindTooltip(unit.name, { direction: 'top', offset: [0, -36] });
  markersGroup.addLayer(marker);
  state.markerLayer[unit.name] = marker;
}

function removeUnitMarker(unit) {
  if (state.markerLayer[unit.name]) {
    markersGroup.removeLayer(state.markerLayer[unit.name]);
    delete state.markerLayer[unit.name];
  }
}

// ===================== SIDEBAR BUILDING =====================
const allUnits = parseUnits();
const allHospitals = parseHospitals();

function buildSidebar() {
  const container = document.getElementById('units-list');
  container.innerHTML = '';

  // Groups in order: Hospitais, AEM, SIV, VMER
  const groups = [
    { key: 'hosp',  label: 'Hospitais', color: '#16a34a', items: allHospitals,                  isHosp: true  },
    { key: 'aem',   label: 'AEM',       color: '#3b82f6', items: allUnits.filter(u => u.subGroup === 'aem')  },
    { key: 'siv',   label: 'SIV',       color: '#10b981', items: allUnits.filter(u => u.subGroup === 'siv')  },
    { key: 'vmer',  label: 'VMER',      color: '#f59e0b', items: allUnits.filter(u => u.subGroup === 'vmer') },
  ];

  groups.forEach(g => {
    const groupEl = document.createElement('div');
    groupEl.className = 'unit-group';
    groupEl.dataset.group = g.key;

    // Header
    const headerEl = document.createElement('div');
    headerEl.className = 'group-header';

    if (g.isHosp) {
      headerEl.innerHTML = `<div class="group-icon-h">H</div>`;
    } else {
      headerEl.innerHTML = `<div class="group-dot" style="background:${g.color}"></div>`;
    }

    headerEl.innerHTML += `
      <span class="group-name">${g.label}</span>
      <span class="group-count">${g.items.length}</span>
      <button class="group-toggle" data-group="${g.key}">Todos</button>
    `;

    groupEl.appendChild(headerEl);

    // Items
    const itemsEl = document.createElement('div');
    itemsEl.className = 'unit-items';

    g.items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'unit-item' + (g.isHosp ? ' hosp' : '');
      row.dataset.name = item.name;

      const isActive = state.activeUnits.has(item.name);

      row.innerHTML = `
        <input type="checkbox" class="unit-checkbox" style="--check-color:${item.color}" ${isActive ? 'checked' : ''} data-name="${item.name}" />
        <span class="unit-name">${item.name}</span>
        ${g.isHosp ? `<span class="unit-type-badge">${item.typeLabel}</span>` : ''}
        <button class="unit-center-btn" data-name="${item.name}" title="Centrar no mapa">
          <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="2"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        </button>
      `;

      // Checkbox click
      row.querySelector('.unit-checkbox').addEventListener('change', e => {
        e.stopPropagation();
        toggleUnit(item, e.target.checked);
      });

      // Row click (not checkbox, not center button)
      row.addEventListener('click', e => {
        if (e.target.closest('.unit-checkbox') || e.target.closest('.unit-center-btn')) return;
        flyToUnit(item);
      });

      // Center button
      row.querySelector('.unit-center-btn').addEventListener('click', e => {
        e.stopPropagation();
        flyToUnit(item);
      });

      itemsEl.appendChild(row);
    });

    groupEl.appendChild(itemsEl);
    container.appendChild(groupEl);

    // Group toggle button
    headerEl.querySelector('.group-toggle').addEventListener('click', () => {
      toggleGroup(g.key, g.items, g.isHosp);
    });
  });

  updateStats();
}

function toggleUnit(item, checked) {
  if (checked) {
    state.activeUnits.add(item.name);
    if (!item.subGroup || item.subGroup === 'hosp') {
      // Hospital: just marker
      const icon = makeHospitalIcon(item.typeLabel);
      const marker = L.marker([item.lat, item.lon], { icon });
      marker.bindPopup(buildHospitalPopup(item), { maxWidth: 300 });
      marker.bindTooltip(item.name, { direction: 'top', offset: [0, -34] });
      hospitalsGroup.addLayer(marker);
      state.markerLayer[item.name] = marker;
    } else {
      addUnitMarker(item);
      addIsochrones(item);
    }
  } else {
    state.activeUnits.delete(item.name);
    if (state.markerLayer[item.name]) {
      const grp = item.subGroup === 'hosp' ? hospitalsGroup : markersGroup;
      grp.removeLayer(state.markerLayer[item.name]);
      delete state.markerLayer[item.name];
    }
    if (item.subGroup !== 'hosp') removeIsochrones(item);
  }
  updateStats();
}

function toggleGroup(groupKey, items, isHosp) {
  const btn = document.querySelector(`.group-toggle[data-group="${groupKey}"]`);
  const anyActive = items.some(i => state.activeUnits.has(i.name));

  items.forEach(item => {
    const checked = !anyActive;
    const cb = document.querySelector(`.unit-checkbox[data-name="${item.name}"]`);
    if (cb) cb.checked = checked;
    toggleUnit(item, checked);
  });

  btn.textContent = anyActive ? 'Todos' : 'Nenhum';
}

function flyToUnit(item) {
  map.flyTo([item.lat, item.lon], 12, { animate: true, duration: 0.8 });
  setTimeout(() => {
    if (state.markerLayer[item.name]) {
      state.markerLayer[item.name].openPopup();
    }
  }, 900);
  closeSidebarMobile();
}

function updateStats() {
  const units = allUnits;
  const aem  = units.filter(u => u.subGroup === 'aem'  && state.activeUnits.has(u.name)).length;
  const siv  = units.filter(u => u.subGroup === 'siv'  && state.activeUnits.has(u.name)).length;
  const vmer = units.filter(u => u.subGroup === 'vmer' && state.activeUnits.has(u.name)).length;
  const total = aem + siv + vmer;

  document.getElementById('stat-total').textContent = total;
  document.getElementById('stat-aem').textContent   = aem;
  document.getElementById('stat-siv').textContent   = siv;
  document.getElementById('stat-vmer').textContent  = vmer;
}

// ===================== INITIAL ACTIVATION =====================
function initUnits() {
  // Activate all units by default
  allUnits.forEach(u => {
    state.activeUnits.add(u.name);
    addUnitMarker(u);
    addIsochrones(u);
  });

  allHospitals.forEach(h => {
    state.activeUnits.add(h.name);
    const icon = makeHospitalIcon(h.typeLabel);
    const marker = L.marker([h.lat, h.lon], { icon });
    marker.bindPopup(buildHospitalPopup(h), { maxWidth: 300 });
    marker.bindTooltip(h.name, { direction: 'top', offset: [0, -34] });
    hospitalsGroup.addLayer(marker);
    state.markerLayer[h.name] = marker;
  });

  buildSidebar();
}

// ===================== ISOCHRONE BAND TOGGLES =====================
document.getElementById('btn-iso-30').addEventListener('click', () => {
  state.band30Active = !state.band30Active;
  document.getElementById('btn-iso-30').classList.toggle('active', state.band30Active);
  toggleBand(30, state.band30Active);
});

document.getElementById('btn-iso-60').addEventListener('click', () => {
  state.band60Active = !state.band60Active;
  document.getElementById('btn-iso-60').classList.toggle('active', state.band60Active);
  toggleBand(60, state.band60Active);
});

// ===================== SEARCH =====================
const searchInput  = document.getElementById('search-input');
const searchResults = document.getElementById('search-results');
const searchClear   = document.getElementById('search-clear');

let searchDebounce = null;

searchInput.addEventListener('input', () => {
  const val = searchInput.value.trim();
  searchClear.classList.toggle('visible', val.length > 0);
  clearTimeout(searchDebounce);
  if (val.length < 2) { hideResults(); return; }
  searchDebounce = setTimeout(() => doSearch(val), 280);
});

searchInput.addEventListener('keydown', e => {
  if (e.key === 'Escape') { clearSearch(); }
});

searchClear.addEventListener('click', clearSearch);

function clearSearch() {
  searchInput.value = '';
  searchClear.classList.remove('visible');
  hideResults();
  if (state.searchMarker) {
    map.removeLayer(state.searchMarker);
    state.searchMarker = null;
  }
  if (state.routeLayer) {
    map.removeLayer(state.routeLayer);
    state.routeLayer = null;
  }
}

function hideResults() {
  searchResults.classList.remove('visible');
  searchResults.innerHTML = '';
}

async function doSearch(query) {
  const results = [];

  // 1. GPS coordinates?
  const gpsMatch = query.match(/^(-?\d+\.?\d*)[,\s]+(-?\d+\.?\d*)$/);
  if (gpsMatch) {
    const lat = parseFloat(gpsMatch[1]);
    const lon = parseFloat(gpsMatch[2]);
    if (lat >= 36 && lat <= 44 && lon >= -10 && lon <= -6) {
      results.push({ label: `${lat}, ${lon}`, sub: 'Coordenadas GPS', lat, lon });
    }
  }

  // 2. Postal code (offline)
  const cpMatch = query.replace(/\s/g, '').match(/^(\d{4})-?(\d{3})?$/);
  if (cpMatch && typeof POSTAL_DATA !== 'undefined') {
    const cp4 = cpMatch[1];
    const cp3 = cpMatch[2] || '';
    const fullCp = cp3 ? `${cp4}-${cp3}` : cp4;
    const lines = POSTAL_DATA.split('\n');
    let count = 0;
    for (const line of lines) {
      if (!line.trim()) continue;
      const parts = line.split('|');
      if (parts.length < 4) continue;
      const [cp, loc, lat, lon] = parts;
      if (cp.startsWith(fullCp) || cp.replace('-','').startsWith(cp4)) {
        results.push({
          label: cp + ' — ' + loc,
          sub: 'Código Postal CTT',
          lat: parseFloat(lat),
          lon: parseFloat(lon)
        });
        if (++count >= 8) break;
      }
    }
  }

  // 3. CP4 index lookup (faster)
  if (cpMatch && typeof POSTAL_CP4 !== 'undefined') {
    const cp4 = cpMatch[1];
    const entry = POSTAL_CP4[cp4];
    if (entry && results.length === 0) {
      results.push({
        label: cp4 + ' — ' + entry.loc,
        sub: 'Código Postal CTT',
        lat: entry.lat,
        lon: entry.lon
      });
    }
  }

  // 4. Free text → Photon geocoder
  if (results.length < 3 && !cpMatch) {
    try {
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query + ' Portugal')}&limit=5&lang=pt`;
      const resp = await fetch(url);
      const data = await resp.json();
      (data.features || []).forEach(f => {
        const p = f.properties;
        const name = [p.name, p.city || p.town || p.village, p.county, p.country].filter(Boolean).join(', ');
        results.push({
          label: name,
          sub: (p.postcode ? p.postcode + ' ' : '') + (p.country || ''),
          lat: f.geometry.coordinates[1],
          lon: f.geometry.coordinates[0]
        });
      });
    } catch (_) {}

    // Nominatim fallback
    if (results.length === 0) {
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&countrycodes=pt&limit=5`;
        const resp = await fetch(url, { headers: { 'Accept-Language': 'pt' } });
        const data = await resp.json();
        data.forEach(r => {
          results.push({
            label: r.display_name.split(',').slice(0,3).join(','),
            sub: r.type,
            lat: parseFloat(r.lat),
            lon: parseFloat(r.lon)
          });
        });
      } catch (_) {}
    }
  }

  renderResults(results);
}

function renderResults(results) {
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
  hideResults();
  searchInput.value = r.label;

  // Place search marker
  if (state.searchMarker) map.removeLayer(state.searchMarker);
  state.searchMarker = L.marker([r.lat, r.lon], { icon: makeSearchIcon(), zIndexOffset: 1000 });
  map.addLayer(state.searchMarker);
  map.flyTo([r.lat, r.lon], 12, { animate: true, duration: 0.7 });

  // Calculate ETAs
  const etaResults = await computeETAs(r.lat, r.lon);
  const popup = buildSearchPopup(r.label, etaResults);
  state.searchMarker.bindPopup(popup, { maxWidth: 360, minWidth: 260 }).openPopup();

  // Bind route buttons after popup is open
  state.searchMarker.on('popupopen', () => {
    document.querySelectorAll('.eta-route-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const olat = parseFloat(btn.dataset.olat);
        const olon = parseFloat(btn.dataset.olon);
        drawRoute(r.lat, r.lon, olat, olon);
      });
    });

    document.querySelectorAll('.eta-row-name').forEach(el => {
      el.addEventListener('click', () => {
        const lat = parseFloat(el.dataset.lat);
        const lon = parseFloat(el.dataset.lon);
        map.flyTo([lat, lon], 13, { animate: true, duration: 0.6 });
      });
    });
  });

  closeSidebarMobile();
}

// ===================== ETA CALCULATION =====================
async function computeETAs(destLat, destLon) {
  const activeEmergUnits = allUnits.filter(u => state.activeUnits.has(u.name));

  // Step 1: Try grid ETAs (pré-calculados via OSRM)
  let unitETAs = [];
  if (typeof GRID_ETA_DATA !== 'undefined') {
    unitETAs = computeGridETAs(destLat, destLon, activeEmergUnits);
  }

  // Step 2: For units not covered by grid, use ORS matrix
  const missing = activeEmergUnits.filter(u => !unitETAs.find(e => e.name === u.name));
  if (missing.length > 0) {
    const orsETAs = await computeORSETAs(destLat, destLon, missing);
    unitETAs = [...unitETAs, ...orsETAs];
  }

  // Sort by ETA
  unitETAs.sort((a, b) => a.etaMin - b.etaMin);

  // Filter to relevant (≤90 min emergency)
  const relevantUnits = unitETAs.filter(u => u.etaMin <= 90);

  // Hospitals: find 3 closest (2 main + 1 SUB)
  const mainHosps = allHospitals.filter(h => h.typeLabel !== 'SUB');
  const subHosps  = allHospitals.filter(h => h.typeLabel === 'SUB');

  const hospETAs = await computeHospitalETAs(destLat, destLon, mainHosps, subHosps);

  return { units: relevantUnits, hospitals: hospETAs };
}

function computeGridETAs(destLat, destLon, units) {
  if (!GRID_ETA_DATA || !GRID_ETA_DATA.destinations) return [];

  const dests = GRID_ETA_DATA.destinations;
  const etaMatrix = GRID_ETA_DATA.durations; // [destIdx][originIdx]

  // Find 3 nearest grid points to destLat/destLon
  const dists = dests.map((d, i) => ({
    i,
    d: Math.hypot(d[0] - destLat, d[1] - destLon)
  }));
  dists.sort((a, b) => a.d - b.d);
  const nearest3 = dists.slice(0, 3);

  const results = [];
  units.forEach(unit => {
    // Find origin index in grid
    const origins = GRID_ETA_DATA.origins;
    const oIdx = origins.findIndex(o => o.name === unit.name);
    if (oIdx < 0) return;

    // Interpolate from 3 nearest grid points
    let sumW = 0, sumETA = 0;
    nearest3.forEach(n => {
      if (n.d < 0.0001) n.d = 0.0001;
      const w = 1 / n.d;
      const rawSec = etaMatrix[n.i]?.[oIdx];
      if (rawSec == null) return;
      sumW += w;
      sumETA += w * rawSec;
    });
    if (sumW === 0) return;

    const rawSec = sumETA / sumW;
    const emergMin = (rawSec / EMERGENCY_SPEED_FACTOR) / 60;
    const distKm = haversineKm(destLat, destLon, unit.lat, unit.lon);

    results.push({ ...unit, etaMin: emergMin, distKm, source: 'grid' });
  });

  return results;
}

async function computeORSETAs(destLat, destLon, units) {
  if (units.length === 0) return [];

  try {
    const locations = [[destLon, destLat], ...units.map(u => [u.lon, u.lat])];
    const sources = [0];
    const destinations = units.map((_, i) => i + 1);

    const resp = await fetch(`${ORS_BASE}/matrix/driving-car`, {
      method: 'POST',
      headers: { 'Authorization': ORS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations, sources, destinations, metrics: ['duration'] })
    });

    if (!resp.ok) throw new Error('ORS matrix failed');
    const data = await resp.json();
    const durations = data.durations?.[0] || [];

    return units.map((u, i) => {
      const rawSec = durations[i] ?? null;
      if (rawSec == null) return { ...u, etaMin: estimateETA(destLat, destLon, u), distKm: haversineKm(destLat, destLon, u.lat, u.lon), source: 'estimate' };
      return { ...u, etaMin: (rawSec / EMERGENCY_SPEED_FACTOR) / 60, distKm: haversineKm(destLat, destLon, u.lat, u.lon), source: 'ors' };
    });
  } catch (_) {
    // Fallback: straight-line estimate
    return units.map(u => ({
      ...u,
      etaMin: estimateETA(destLat, destLon, u),
      distKm: haversineKm(destLat, destLon, u.lat, u.lon),
      source: 'estimate'
    }));
  }
}

async function computeHospitalETAs(destLat, destLon, mainHosps, subHosps) {
  const all = [...mainHosps, ...subHosps];
  // Sort by haversine distance, pick top 5 candidates
  const candidates = all
    .map(h => ({ ...h, distKm: haversineKm(destLat, destLon, h.lat, h.lon) }))
    .sort((a, b) => a.distKm - b.distKm)
    .slice(0, 6);

  // ORS ETAs
  try {
    const locations = [[destLon, destLat], ...candidates.map(h => [h.lon, h.lat])];
    const resp = await fetch(`${ORS_BASE}/matrix/driving-car`, {
      method: 'POST',
      headers: { 'Authorization': ORS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations, sources: [0], destinations: candidates.map((_,i)=>i+1), metrics: ['duration'] })
    });
    if (resp.ok) {
      const data = await resp.json();
      const durs = data.durations?.[0] || [];
      candidates.forEach((h, i) => {
        const rawSec = durs[i] ?? null;
        h.etaMin = rawSec != null ? (rawSec / EMERGENCY_SPEED_FACTOR) / 60 : estimateETA(destLat, destLon, h);
      });
    } else {
      candidates.forEach(h => { h.etaMin = estimateETA(destLat, destLon, h); });
    }
  } catch (_) {
    candidates.forEach(h => { h.etaMin = estimateETA(destLat, destLon, h); });
  }

  candidates.sort((a, b) => a.etaMin - b.etaMin);

  // Pick 2 main + 1 sub
  const chosen = [];
  let mainCount = 0, subCount = 0;
  for (const h of candidates) {
    if (h.typeLabel !== 'SUB' && mainCount < 2) { chosen.push(h); mainCount++; }
    else if (h.typeLabel === 'SUB' && subCount < 1) { chosen.push(h); subCount++; }
    if (chosen.length >= 3) break;
  }
  return chosen;
}

function estimateETA(destLat, destLon, unit) {
  const dist = haversineKm(destLat, destLon, unit.lat, unit.lon);
  // avg road factor 1.6, avg speed 80 km/h normal → emergency 80 * EMERGENCY_SPEED_FACTOR
  const speedKmh = 80 * EMERGENCY_SPEED_FACTOR;
  return (dist * 1.6 / speedKmh) * 60;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ===================== ROUTING =====================
async function drawRoute(fromLat, fromLon, toLat, toLon) {
  if (state.routeLayer) { map.removeLayer(state.routeLayer); state.routeLayer = null; }

  try {
    const resp = await fetch(`${ORS_BASE}/directions/driving-car/geojson`, {
      method: 'POST',
      headers: { 'Authorization': ORS_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [[fromLon, fromLat], [toLon, toLat]] })
    });
    if (!resp.ok) throw new Error('ORS directions failed');
    const gj = await resp.json();

    state.routeLayer = L.geoJSON(gj, {
      style: { color: '#3b82f6', weight: 4, opacity: 0.85, dashArray: '8 4' }
    }).addTo(map);

    map.fitBounds(state.routeLayer.getBounds(), { padding: [40, 40] });
  } catch (_) {
    // Fallback: draw straight line
    state.routeLayer = L.polyline([[fromLat, fromLon],[toLat, toLon]], {
      color: '#3b82f6', weight: 3, opacity: 0.7, dashArray: '6 4'
    }).addTo(map);
    map.fitBounds(state.routeLayer.getBounds(), { padding: [40, 40] });
  }
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

// ===================== POINT-IN-POLYGON FILTER =====================
function pointInPolygon(lat, lon, feature) {
  // GeoJSON Feature Polygon or MultiPolygon
  const type = feature.geometry?.type;
  const coords = feature.geometry?.coordinates;
  if (!coords) return false;

  const rings = type === 'Polygon' ? [coords[0]] :
                type === 'MultiPolygon' ? coords.map(p => p[0]) : [];

  return rings.some(ring => isPointInRing(lat, lon, ring));
}

function isPointInRing(lat, lon, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]; // lon, lat
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// ===================== BOOT =====================
window.addEventListener('DOMContentLoaded', () => {
  if (typeof ISOCHRONE_DATA === 'undefined') {
    console.warn('data.js not loaded or empty — running without isochrones');
    window.ISOCHRONE_DATA = { aem_codu_centro: [], vmer_drc: [], hospitais: [] };
  }
  initUnits();
});
