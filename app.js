"use strict";

const ZONING_CSV_URL = "data.csv";
const PERMITS_CSV_URL = "adu_permits.csv";

// EXACT column names from your CSV
const COL = {
  city: "City",
  zone: "Zone",
  zoneType: "Zone_Type",
  aduAllowed: "ADU_Allowed",
  daduAllowed: "DADU_Allowed",
  ownerOcc: "Owner_Occupancy_Required",
  minLotSize: "Min_Lot_Size_Sqft",
  maxADUSize: "Max_ADU_Size_Sqft",
  maxDADUSize: "Max_DADU_Size_Sqft",
  maxHeight: "Max_Building_Height",
  aduParking: "ADU_Parking_Required",
  aduParkingTransit: "ADU_Parking_Exempt_If_Transit",
  fees: "Fee",
  lastReviewed: "Last_Reviewed_Date",
  daduRear: "DADU_Min_Rear_Setback",
  daduSide: "DADU_Min_LotLine_Side _Setback",
  daduStreet: "DADU_Min_Street_Side_Setback",
  daduPrincipal: "DADU_Min_Setback_From_Principal",
  minLotWidth: "Min_Lot_Width_Sqft",
  minLotDepth: "Min_Lot_Depth",
  principalFront: "Principal_Min_Front_Setback_ft",
  principalStreetSide: "Principal_Min_Street_Side_Setback",
  principalInteriorSide: "Principal_Min_Interior_Side_Setback",
  principalRear: "Principal_Min_Rear_Setback",
  maxLotCoverage: "Max_Lot_Coverage_Percent"
};

const state = {
  zoning: { headers: [], rows: [], byCity: new Map() },
  permits: { headers: [], rows: [], filtered: [], currentPage: 1, pageSize: 5 },
  initialized: { zoningLoaded: false, permitsLoaded: false }
};

function getSelectedZoningRow() {
  const city = document.getElementById("feasCity")?.value;
  const zone = document.getElementById("feasZone")?.value;
  if (!city || !zone) return null;

  const cityRows = state.zoning.byCity.get(city) || [];
  const zoneIdx = headerIndex("zone");
  return cityRows.find(r => safeText(r[zoneIdx]).trim() === zone) || null;
}

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') { value += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (c === "," && !inQuotes) {
      row.push(value); value = "";
    } else if ((c === "\n" || c === "\r") && !inQuotes) {
      if (value !== "" || row.length > 0) { row.push(value); rows.push(row); row = []; value = ""; }
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else { value += c; }
  }
  if (value !== "" || row.length > 0) { row.push(value); rows.push(row); }
  return rows.filter(r => r.length && !(r.length === 1 && r[0].trim() === ""));
}

function safeText(s) { return s == null ? "" : String(s); }

function headerIndex(colKey) {
  if (!state.zoning.headers || !COL[colKey]) return -1;
  return state.zoning.headers.findIndex(h => h && h.toString().trim() === COL[colKey]);
}

function getCell(row, colKey) {
  if (!row) return "";
  const idx = headerIndex(colKey);
  return idx === -1 ? "" : safeText(row[idx]).trim();
}

function getNumeric(row, colKey) {
  const raw = getCell(row, colKey);
  if (!raw) return NaN;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  return cleaned ? parseFloat(cleaned) : NaN;
}

async function loadZoningCsv() {
  try {
    const resp = await fetch(ZONING_CSV_URL);
    const text = await resp.text();
    const rows = parseCSV(text);
    const [headerRow, ...dataRows] = rows;
    state.zoning.headers = headerRow;
    state.zoning.rows = dataRows;

    const cityIdx = headerRow.findIndex(h => h.trim() === COL.city);
    dataRows.forEach(r => {
      const city = safeText(r[cityIdx]).trim();
      if (!city) return;
      if (!state.zoning.byCity.has(city)) state.zoning.byCity.set(city, []);
      state.zoning.byCity.get(city).push(r);
    });
    state.initialized.zoningLoaded = true;
  } catch (err) { console.error("Error loading zoning:", err); }
}

async function loadPermitsCsv() {
  try {
    const resp = await fetch(PERMITS_CSV_URL);
    if (!resp.ok) return;
    const text = await resp.text();
    const rows = parseCSV(text);
    const [headerRow, ...dataRows] = rows;
    state.permits.headers = headerRow;
    state.permits.rows = dataRows;
    state.permits.filtered = dataRows.slice();
    state.initialized.permitsLoaded = true;
  } catch (err) { console.log("Permits not available"); }
}

function renderCityScorecards() {
  const container = document.getElementById("cityScorecards");
  if (!container || !state.initialized.zoningLoaded) return;
  container.innerHTML = "";

  Array.from(state.zoning.byCity.keys()).sort().forEach(city => {
    const rows = state.zoning.byCity.get(city);
    let aduYes = 0, daduYes = 0;
    rows.forEach(r => {
      const adu = getCell(r, "aduAllowed").toLowerCase();
      const dadu = getCell(r, "daduAllowed").toLowerCase();
      if (adu.includes("yes") || adu.includes("permitted")) aduYes++;
      if (dadu.includes("yes") || dadu.includes("permitted")) daduYes++;
    });

    const score = Math.round(((aduYes / rows.length) * 0.6 + (daduYes / rows.length) * 0.4) * 100);
    let grade = "F";
    if (score >= 90) grade = "A+";
    else if (score >= 80) grade = "A";
    else if (score >= 70) grade = "B";
    else if (score >= 60) grade = "B-";
    else if (score >= 50) grade = "C+";
    else if (score >= 40) grade = "C";
    else if (score >= 30) grade = "D";

    const card = document.createElement("article");
    card.className = "scorecard-item city-card";
    card.style.cursor = "pointer";
    card.innerHTML = `
      <header class="scorecard-header">
        <h3 class="scorecard-city">${city}</h3>
        <div class="scorecard-grade">${grade}</div>
      </header>
      <div class="scorecard-bar-wrap">
        <div class="scorecard-bar" style="width: ${score}%"></div>
      </div>
      <ul class="scorecard-bullets">
        <li>ADU in ${aduYes}/${rows.length} zones</li>
        <li>DADU in ${daduYes}/${rows.length} zones</li>
        <li>Score: ${score}/100</li>
      </ul>
    `;
    card.onclick = () => {
      document.getElementById("cityFilter").value = city;
      performRegulationsSearch();
      document.querySelector(".filters-card").scrollIntoView({ behavior: "smooth" });
    };
    container.appendChild(card);
  });
}

function initRegulationsUI() {
  if (!state.initialized.zoningLoaded) return;

  const cityFilter = document.getElementById("cityFilter");
  const zoneFilter = document.getElementById("zoneFilter");
  
  const populateSelect = (sel, colKey) => {
    const idx = headerIndex(colKey);
    if (idx === -1) return;
    const vals = [...new Set(state.zoning.rows.map(r => safeText(r[idx]).trim()).filter(v => v))].sort();
    sel.innerHTML = '<option value="">Any</option>';
    vals.forEach(v => sel.innerHTML += `<option value="${v}">${v}</option>`);
  };

  populateSelect(cityFilter, "city");
  populateSelect(document.getElementById("zoneTypeFilter"), "zoneType");
  populateSelect(document.getElementById("aduFilter"), "aduAllowed");
  populateSelect(document.getElementById("daduFilter"), "daduAllowed");
  populateSelect(document.getElementById("ownerOccFilter"), "ownerOcc");

  cityFilter.onchange = () => {
    const city = cityFilter.value;
    const rows = city ? state.zoning.byCity.get(city) || [] : state.zoning.rows;
    const idx = headerIndex("zone");
    const zones = [...new Set(rows.map(r => safeText(r[idx]).trim()).filter(z => z))].sort();
    zoneFilter.innerHTML = '<option value="">All zones</option>';
    zones.forEach(z => zoneFilter.innerHTML += `<option value="${z}">${z}</option>`);
  };

  document.getElementById("searchRegulationsBtn").onclick = performRegulationsSearch;
  document.getElementById("clearFilters").onclick = () => {
    ["cityFilter", "zoneFilter", "zoneTypeFilter", "aduFilter", "daduFilter", "ownerOccFilter", "searchInput"]
      .forEach(id => document.getElementById(id).value = "");
    document.getElementById("regTableWrapper").classList.add("hidden");
    document.getElementById("regPlaceholder").style.display = "block";
  };
}

function performRegulationsSearch() {
  const tbody = document.getElementById("tableBody");
  const wrapper = document.getElementById("regTableWrapper");
  const placeholder = document.getElementById("regPlaceholder");

  const filters = {
    city: document.getElementById("cityFilter").value.toLowerCase(),
    zone: document.getElementById("zoneFilter").value.toLowerCase(),
    zoneType: document.getElementById("zoneTypeFilter").value.toLowerCase(),
    adu: document.getElementById("aduFilter").value.toLowerCase(),
    dadu: document.getElementById("daduFilter").value.toLowerCase(),
    owner: document.getElementById("ownerOccFilter").value.toLowerCase(),
    search: document.getElementById("searchInput").value.toLowerCase()
  };

  if (!filters.city && !filters.zone && !filters.search) {
    placeholder.innerHTML = "<h3>Ready to Search</h3><p>Select at least a city or zone.</p>";
    placeholder.style.display = "block";
    wrapper.classList.add("hidden");
    return;
  }

  const filtered = state.zoning.rows.filter(row => {
    if (filters.city && getCell(row, "city").toLowerCase() !== filters.city) return false;
    if (filters.zone && getCell(row, "zone").toLowerCase() !== filters.zone) return false;
    if (filters.zoneType && getCell(row, "zoneType").toLowerCase() !== filters.zoneType) return false;
    if (filters.adu && !getCell(row, "aduAllowed").toLowerCase().includes(filters.adu)) return false;
    if (filters.dadu && !getCell(row, "daduAllowed").toLowerCase().includes(filters.dadu)) return false;
    if (filters.owner && !getCell(row, "ownerOcc").toLowerCase().includes(filters.owner)) return false;
    if (filters.search && !row.join(" ").toLowerCase().includes(filters.search)) return false;
    return true;
  });

  if (!filtered.length) {
    placeholder.innerHTML = "<h3>No Results</h3><p>No regulations match your criteria.</p>";
    placeholder.style.display = "block";
    wrapper.classList.add("hidden");
    return;
  }

  placeholder.style.display = "none";
  wrapper.classList.remove("hidden");

  const thead = document.getElementById("tableHead");
  thead.innerHTML = "<tr>" + state.zoning.headers.map(h => `<th>${h}</th>`).join("") + "</tr>";
  tbody.innerHTML = filtered.map(row => 
    "<tr>" + row.map(cell => `<td>${safeText(cell)}</td>`).join("") + "</tr>"
  ).join("");
}

  function initFeasibilityUI() {
    if (!state.initialized.zoningLoaded) return;

    const citySelect = document.getElementById("feasCity");
    const zoneSelect = document.getElementById("feasZone");

  citySelect.innerHTML = '<option value="">Select city</option>';
  Array.from(state.zoning.byCity.keys()).sort().forEach(c => {
    citySelect.innerHTML += `<option value="${c}">${c}</option>`;
  });

  citySelect.onchange = () => {
    const city = citySelect.value;
      const rows = state.zoning.byCity.get(city) || [];
      const idx = headerIndex("zone");
      const zones = [...new Set(rows.map(r => safeText(r[idx]).trim()).filter(z => z))].sort();
      zoneSelect.innerHTML = '<option value="">Select zone</option>';
      zones.forEach(z => zoneSelect.innerHTML += `<option value="${z}">${z}</option>`);
      zoneSelect.disabled = !zones.length;
      populateFeasibilityDefaults();
    };

    zoneSelect.onchange = () => {
      populateFeasibilityDefaults();
      runFeasibilityCheck();
    };

    document.getElementById("runFeasibility").onclick = () => runFeasibilityCheck();
    buildFeasDiagram();

    const inputs = [
      "feasLotSize", "feasLotWidth", "feasLotDepth",
      "feasHouseWidth", "feasHouseDepth", "feasADUSize"
    ];
    inputs.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("input", () => updateFeasDiagram());
    });
  }

  function buildFeasDiagram() {
    const container = document.getElementById("feasDiagram");
    if (!container || container.dataset.init) return;
    container.dataset.init = "true";
    container.innerHTML = `
      <div class="parcel-viewport">
        <div class="parcel-lot" id="parcelLot">
          <div class="parcel-label" id="lotLabel">Lot: —</div>
          <div class="parcel-buildable" id="buildableRect"></div>
          <div class="parcel-structure parcel-primary" id="primaryRect">
            <span class="parcel-structure__label" id="primaryLabel">Primary</span>
          </div>
          <div class="parcel-structure parcel-adu" id="aduRect">
            <span class="parcel-structure__label" id="aduLabel">ADU</span>
          </div>
        </div>
        <div class="parcel-legend">
          <span class="legend-chip legend-lot"></span> Lot
          <span class="legend-chip legend-buildable"></span> Buildable area
          <span class="legend-chip legend-primary"></span> Existing home
          <span class="legend-chip legend-adu"></span> ADU target
        </div>
        <p class="parcel-footnote" id="parcelFootnote"></p>
      </div>
    `;
  }

function computeLotGeometry(rowData) {
  const lotSizeInput = parseFloat(document.getElementById("feasLotSize").value);
  const lotSize = lotSizeInput || getNumeric(rowData, "minLotSize") || 0;
  let lotWidth = parseFloat(document.getElementById("feasLotWidth").value) || getNumeric(rowData, "minLotWidth") || 0;
  let lotDepth = parseFloat(document.getElementById("feasLotDepth").value) || getNumeric(rowData, "minLotDepth") || 0;

  if (!lotWidth && lotSize) {
    lotWidth = Math.max(Math.sqrt(lotSize), getNumeric(rowData, "minLotWidth") || 0);
  }
  if (!lotDepth && lotWidth && lotSize) {
    lotDepth = Math.max(lotSize / lotWidth, Math.sqrt(lotSize));
  }
  if (!lotWidth && !lotDepth && lotSize) {
    lotWidth = Math.sqrt(lotSize);
    lotDepth = lotWidth;
  }

  const fallbackWidth = lotWidth || Math.sqrt(lotSize) || 60;
  const fallbackDepth = lotDepth || Math.sqrt(lotSize) || 60;
  const lotArea = (lotWidth && lotDepth) ? lotWidth * lotDepth : fallbackWidth * fallbackDepth;

  const maxPxWidth = 480;
  const maxPxHeight = 420;
  const scale = Math.min(maxPxWidth / (lotWidth || fallbackWidth), maxPxHeight / (lotDepth || fallbackDepth));

  return {
    lotSize,
    lotWidth,
    lotDepth,
    lotArea,
    fallbackWidth,
    fallbackDepth,
    lotPxWidth: (lotWidth || fallbackWidth) * scale,
    lotPxHeight: (lotDepth || fallbackDepth) * scale,
    scale
  };
}

function deriveEnvelope(rowData, lotGeom) {
  const frontSetback = rowData ? getNumeric(rowData, "principalFront") : NaN;
  const rearSetback = rowData ? getNumeric(rowData, "principalRear") : NaN;
  const sideSetback = rowData ? getNumeric(rowData, "principalInteriorSide") : NaN;

  const interiorWidth = (!isNaN(sideSetback) && lotGeom.lotWidth)
    ? Math.max(lotGeom.lotWidth - 2 * sideSetback, 0)
    : lotGeom.fallbackWidth * 0.82;
  const interiorDepth = (!isNaN(frontSetback) && !isNaN(rearSetback) && lotGeom.lotDepth)
    ? Math.max(lotGeom.lotDepth - (frontSetback + rearSetback), 0)
    : lotGeom.fallbackDepth * 0.78;

  const coveragePct = rowData ? getNumeric(rowData, "maxLotCoverage") : NaN;
  const coverageArea = (!isNaN(coveragePct) && lotGeom.lotArea)
    ? lotGeom.lotArea * (coveragePct / 100)
    : NaN;
  const setbackArea = interiorWidth * interiorDepth;
  const envelopeArea = !isNaN(coverageArea)
    ? Math.min(coverageArea, setbackArea)
    : setbackArea;

  const aspectRatio = interiorDepth ? interiorWidth / interiorDepth : 1;
  const widthFromArea = Math.sqrt(Math.max(envelopeArea, 0) * aspectRatio) || interiorWidth;
  const depthFromArea = (envelopeArea && widthFromArea) ? envelopeArea / widthFromArea : interiorDepth;

  return {
    frontSetback,
    rearSetback,
    sideSetback,
    coveragePct,
    coverageArea,
    interiorWidth,
    interiorDepth,
    envelopeArea,
    envelopeWidth: Math.max(Math.min(widthFromArea, interiorWidth), 0),
    envelopeDepth: Math.max(Math.min(depthFromArea, interiorDepth), 0),
    showOverlay: !isNaN(coveragePct)
  };
}

function runFeasibilityCheck() {
  const row = getSelectedZoningRow();
  const aduSizeInput = parseFloat(document.getElementById("feasADUSize").value);
  const summaryEl = document.getElementById("feasibilitySummary");
  const detailsEl = document.getElementById("feasibilityDetails");

  if (!row) {
    summaryEl.innerHTML = "<p>Select a city and zone.</p>";
    return;
  }

  const lotGeom = computeLotGeometry(row);
  const envelope = deriveEnvelope(row, lotGeom);

  const city = getCell(row, "city");
  const zone = getCell(row, "zone");
  const minLot = getNumeric(row, "minLotSize");
  const minWidth = getNumeric(row, "minLotWidth");
  const minDepth = getNumeric(row, "minLotDepth");
  const maxADU = getNumeric(row, "maxADUSize");
  const aduAllowed = getCell(row, "aduAllowed");

  const aduSize = aduSizeInput || maxADU || 0;
  const lotOK = isNaN(minLot) || lotGeom.lotSize >= minLot;
  const widthOK = isNaN(minWidth) || lotGeom.lotWidth >= minWidth;
  const depthOK = isNaN(minDepth) || lotGeom.lotDepth >= minDepth;
  const sizeOK = isNaN(maxADU) || aduSize <= maxADU;
  const allowed = aduAllowed.toLowerCase().includes("yes") || aduAllowed.toLowerCase().includes("permitted");

  let status = "unknown";
  let msg = "";

  if (!allowed) {
    status = "no";
    msg = "ADUs not clearly allowed in this zone.";
  } else if (lotOK && widthOK && depthOK && sizeOK) {
    status = "yes";
    msg = "Lot size, dimensions, and ADU target align with zoning defaults (subject to full review).";
  } else if (!lotOK || !widthOK || !depthOK) {
    status = "maybe";
    msg = "Lot dimensions fall below minimums; confirm with local planner.";
  } else {
    status = "maybe";
    msg = "ADU size exceeds maximum. Consider scaling down.";
  }

  const fmt = v => isNaN(v) ? "—" : v.toLocaleString();
  const coverageSummary = envelope.showOverlay
    ? `${fmt(getNumeric(row, "maxLotCoverage"))}% · est. ${fmt(Math.round(envelope.envelopeArea))} sf buildable`
    : "Not provided – reference municipal code";

  summaryEl.innerHTML = `<p data-status="${status}">${msg}</p>`;
  detailsEl.innerHTML = `
    <h3>Feasibility Report</h3>
    <dl class="feasibility-metrics">
      <div><dt>City</dt><dd>${city}</dd></div>
      <div><dt>Zone</dt><dd>${zone}</dd></div>
      <div><dt>Min Lot Size</dt><dd>${fmt(minLot)} sf</dd></div>
      <div><dt>Min Lot Width</dt><dd>${fmt(minWidth)} ft</dd></div>
      <div><dt>Min Lot Depth</dt><dd>${fmt(minDepth)} ft</dd></div>
      <div><dt>Max ADU Size</dt><dd>${fmt(maxADU)} sf</dd></div>
      <div><dt>ADU Allowed</dt><dd>${aduAllowed}</dd></div>
      <div><dt>Owner Occupancy</dt><dd>${getCell(row, "ownerOcc") || "—"}</dd></div>
      <div><dt>Parking Required</dt><dd>${getCell(row, "aduParking") || "—"}</dd></div>
      <div><dt>Transit Exempt</dt><dd>${getCell(row, "aduParkingTransit") || "—"}</dd></div>
      <div><dt>Buildable Envelope</dt><dd>${fmt(Math.round(envelope.envelopeWidth))}' × ${fmt(Math.round(envelope.envelopeDepth))}'</dd></div>
      <div><dt>Lot Coverage</dt><dd>${coverageSummary}</dd></div>
    </dl>
  `;

  document.getElementById("lotLabel").textContent = `Lot: ${lotGeom.lotSize ? lotGeom.lotSize.toLocaleString() + " sf" : "—"}`;
  updateFeasDiagram(row, lotGeom, envelope);
}

  function populateFeasibilityDefaults() {
    const match = getSelectedZoningRow();
    if (!match) return;

    const fillNumber = (id, value) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (!isNaN(value)) {
        el.placeholder = Math.round(value).toString();
        if (!el.value) el.value = Math.round(value);
      }
    };

    fillNumber("feasLotSize", getNumeric(match, "minLotSize"));
    fillNumber("feasLotWidth", getNumeric(match, "minLotWidth"));
    fillNumber("feasLotDepth", getNumeric(match, "minLotDepth"));
    fillNumber("feasADUSize", getNumeric(match, "maxADUSize"));

    const defaultHouseWidth = getNumeric(match, "minLotWidth") * 0.4;
    const defaultHouseDepth = getNumeric(match, "minLotDepth") * 0.4;
    fillNumber("feasHouseWidth", defaultHouseWidth);
    fillNumber("feasHouseDepth", defaultHouseDepth);
    updateFeasDiagram(match);
  }

  function updateFeasDiagram(row, geom, envelope) {
    const lotEl = document.getElementById("parcelLot");
    if (!lotEl) return;

    const rowData = row || getSelectedZoningRow();
    const lotGeom = geom || computeLotGeometry(rowData);
    const env = envelope || deriveEnvelope(rowData, lotGeom);

    lotEl.style.width = `${lotGeom.lotPxWidth}px`;
    lotEl.style.height = `${lotGeom.lotPxHeight}px`;

    const buildableNote = document.getElementById("parcelFootnote");
    const buildEl = document.getElementById("buildableRect");

    if (buildEl) {
      if (!env.showOverlay) {
        buildEl.style.display = "none";
        if (buildableNote) buildableNote.textContent = "Reference municipal code for lot coverage requirements";
      } else {
        buildEl.style.display = "block";
        if (buildableNote) buildableNote.textContent = "";

        buildEl.style.width = `${(env.envelopeWidth || lotGeom.fallbackWidth) * lotGeom.scale}px`;
        buildEl.style.height = `${(env.envelopeDepth || lotGeom.fallbackDepth) * lotGeom.scale}px`;
        buildEl.style.left = `${Math.max(((lotGeom.lotWidth - env.envelopeWidth) / 2 || lotGeom.fallbackWidth * 0.1) * lotGeom.scale, 4)}px`;
        buildEl.style.top = `${Math.max(((lotGeom.lotDepth - env.envelopeDepth) / 2 || lotGeom.fallbackDepth * 0.1) * lotGeom.scale, 4)}px`;
      }
    }

    const houseWidthRaw = parseFloat(document.getElementById("feasHouseWidth").value);
    const houseDepthRaw = parseFloat(document.getElementById("feasHouseDepth").value);
    const maxHouseWidth = env.interiorWidth || lotGeom.fallbackWidth * 0.9;
    const maxHouseDepth = env.interiorDepth || lotGeom.fallbackDepth * 0.9;
    const houseWidth = Math.min(Math.max(houseWidthRaw || maxHouseWidth * 0.45, 6), maxHouseWidth);
    const houseDepth = Math.min(Math.max(houseDepthRaw || maxHouseDepth * 0.5, 6), maxHouseDepth);

    const houseEl = document.getElementById("primaryRect");
    const houseLeft = Math.max((!isNaN(env.sideSetback) ? env.sideSetback : maxHouseWidth * 0.05) * lotGeom.scale, 4);
    const houseTop = Math.max((!isNaN(env.frontSetback) ? env.frontSetback : maxHouseDepth * 0.12) * lotGeom.scale, 4);
    if (houseEl) {
      houseEl.style.width = `${houseWidth * lotGeom.scale}px`;
      houseEl.style.height = `${houseDepth * lotGeom.scale}px`;
      houseEl.style.left = `${houseLeft}px`;
      houseEl.style.top = `${houseTop}px`;
    }

    const daduRear = getNumeric(rowData, "daduRear");
    const daduSide = getNumeric(rowData, "daduSide");
    const daduPrincipal = getNumeric(rowData, "daduPrincipal");

    const aduSize = parseFloat(document.getElementById("feasADUSize").value) || 0;
    const aduSide = aduSize ? Math.sqrt(aduSize) : Math.min(env.interiorWidth, env.interiorDepth) * 0.25;
    const aduWidth = Math.min(Math.max(aduSide, 6), env.interiorWidth || lotGeom.fallbackWidth * 0.5);
    const aduDepth = Math.min(Math.max(aduSide, 6), env.interiorDepth || lotGeom.fallbackDepth * 0.5);

    const sep = !isNaN(daduPrincipal) ? daduPrincipal : env.rearSetback || 10;
    const rearBuffer = !isNaN(daduRear) ? daduRear : (env.rearSetback || 5);
    const sideBuffer = !isNaN(daduSide) ? daduSide : (env.sideSetback || 5);

    const aduEl = document.getElementById("aduRect");
    if (aduEl) {
      let aduLeftFt = Math.max((lotGeom.lotWidth - sideBuffer - aduWidth), sideBuffer);
      let aduTopFt = Math.max((lotGeom.lotDepth - rearBuffer - aduDepth), sep + (houseTop / lotGeom.scale) + (houseDepth));

      const maxTop = Math.max(lotGeom.lotDepth - aduDepth - (env.frontSetback || 0), 0);
      aduTopFt = Math.min(aduTopFt, maxTop);

      aduEl.style.width = `${aduWidth * lotGeom.scale}px`;
      aduEl.style.height = `${aduDepth * lotGeom.scale}px`;
      aduEl.style.left = `${Math.max(aduLeftFt * lotGeom.scale, sideBuffer * lotGeom.scale)}px`;
      aduEl.style.top = `${Math.max(aduTopFt * lotGeom.scale, (env.frontSetback || 4) * lotGeom.scale)}px`;
    }

    const primaryLabel = document.getElementById("primaryLabel");
    if (primaryLabel) primaryLabel.textContent = `${Math.round(houseWidth)}' × ${Math.round(houseDepth)}'`;
    const aduLabel = document.getElementById("aduLabel");
    if (aduLabel) aduLabel.textContent = aduSize ? `${Math.round(aduSize)} sf` : `${Math.round(aduWidth)}' × ${Math.round(aduDepth)}'`;

    const lotLabel = document.getElementById("lotLabel");
    if (lotLabel) {
      const dims = lotGeom.lotWidth && lotGeom.lotDepth ? `${Math.round(lotGeom.lotWidth)}' × ${Math.round(lotGeom.lotDepth)}'` : "—";
      lotLabel.textContent = `Lot: ${lotGeom.lotArea ? Math.round(lotGeom.lotArea).toLocaleString() + " sf" : "—"} (${dims})`;
    }
  }

function initPermitsUI() {
  if (!state.initialized.permitsLoaded) return;
  const cityFilter = document.getElementById("permitsCityFilter");
  const h = state.permits.headers.map(h => h.toLowerCase());
  const cityIdx = h.findIndex(h => h.includes("city"));
  
  if (cityIdx !== -1) {
    const cities = [...new Set(state.permits.rows.map(r => safeText(r[cityIdx]).trim()))].sort();
    cityFilter.innerHTML = '<option value="">All cities</option>';
    cities.forEach(c => cityFilter.innerHTML += `<option value="${c}">${c}</option>`);
  }

  cityFilter.onchange = filterPermits;
  document.getElementById("permitsClearFilters").onclick = () => {
    cityFilter.value = "";
    filterPermits();
  };

  filterPermits();
}

function filterPermits() {
  const cityVal = document.getElementById("permitsCityFilter").value.toLowerCase();
  const h = state.permits.headers.map(h => h.toLowerCase());
  const cityIdx = h.findIndex(h => h.includes("city"));

  state.permits.filtered = !cityVal ? state.permits.rows : 
    state.permits.rows.filter(r => safeText(r[cityIdx]).trim().toLowerCase() === cityVal);
  
  state.permits.currentPage = 1;
  renderPermitsTable();
}

function renderPermitsTable() {
  const tbody = document.getElementById("permitsTableBody");
  const total = state.permits.filtered.length;
  const page = state.permits.currentPage;
  const size = state.permits.pageSize;
  const start = (page - 1) * size;
  const slice = state.permits.filtered.slice(start, start + size);

  tbody.innerHTML = slice.map(row => 
    "<tr>" + row.map(cell => `<td>${safeText(cell)}</td>`).join("") + "</tr>"
  ).join("");

  document.getElementById("permitsSummary").textContent = 
    total ? `Showing ${start + 1}-${Math.min(start + size, total)} of ${total}` : "No permits";
}

async function initApp() {
  await Promise.all([loadZoningCsv(), loadPermitsCsv()]);
  renderCityScorecards();
  initRegulationsUI();
  initFeasibilityUI();
  initPermitsUI();
}

window.addEventListener("DOMContentLoaded", initApp);
