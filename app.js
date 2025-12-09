// =========================================
// King County ADU Explorer - app.js (refactored foundation)
// =========================================
//
// Goals of this rewrite:
// - Single clear entry point (initApp)
// - Centralized state object (no random globals)
// - Robust CSV loading & parsing
// - Reusable zoning filter logic
// - Clean separation between: data, domain logic, and UI
// - All DOM lookups happen after DOMContentLoaded
//
// This file is intentionally "framework-free" (vanilla JS only)
// so it runs happily on GitHub Pages or any static hosting.

"use strict";

// =========================================
// CONFIG
// =========================================

const CSV_URL = "data.csv";
const PERMITS_URL = "adu_permits.csv";

// Column name mapping for zoning CSV
// Only keys we actively use are listed here.
const COL = {
  // Identity / filters
  city: "City",
  county: "County",
  state: "State",
  zone: "Zone",
  zoneType: "Zone_Type",

  // Site minimums & intensity
  minLotSize: "Min_Lot_Size_Sqft",
  density: "Residential_Density",
  maxImpervious: "Max_Imprevious_Surface",
  maxLotCoverage: "Max_Lot_Coverage_Percent",
  maxFAR: "Max_FAR",
  maxBuildingHeight: "Max_Building_Height",

  // Principal structure setbacks
  principalFront: "Principal_Min_Front_Setback_ft",
  principalStreetSide: "Principal_Min_Street_Side_Setback",

  // ADU / DADU allowance & intensity
  aduAllowed: "ADU_Allowed",
  daduAllowed: "DADU_Allowed",
  ownerOcc: "Owner_Occupancy_Required",
  maxADUs: "Max_ADUs/DADUs_Per_Dwelling_Unit",
  aduParkingRequired: "ADU_Parking_Required",
  aduParkingTransitExempt: "ADU_Parking_Exempt_If_Transit",
  minADUSize: "Min_ADU+DADU_Size_Sqft",
  maxADUSizePct: "Max_ADU/DADU_Size_Percent_Primary/Lot",
  maxADUSize: "Max_ADU_Size_Sqft",
  aduSizeNotes: "ADU_Size_Notes",
  maxADUHeight: "Max_ADU_Height_ft",
  maxDADUSize: "Max_DADU_Size_Sqft",
  maxDADUHeight: "DADU_Max_Height_ft",

  // DADU setbacks
  daduRear: "DADU_Min_Rear_Setback",
  daduSideLotLine: "DADU_Min_LotLine_Side _Setback",
  daduStreetSide: "DADU_Min_Street_Side_Setback",
  daduFromPrincipal: "DADU_Min_Setback_From_Principal",

  // Notes / meta
  greenscapeNotes: "Greenscape_Notes",
  impactFees: "Fee",
  lastReviewed: "Last_Reviewed_Date",
};

// =========================================
// GLOBAL STATE
// =========================================

const state = {
  zoning: {
    headers: [],
    rows: [],        // full CSV rows (arrays)
    byCity: new Map(),
    filteredRows: [], // used for regulations table
  },
  permits: {
    headers: [],
    rows: [],
    filteredRows: [],
  },
  ui: {
    // Regulations table UI refs – populated in initRegulationsUI
    selectAllCities: null,
    searchButton: null,
    placeholder: null,
    tableWrapper: null,
    summaryEl: null,
  },
  initialized: {
    zoningLoaded: false,
    permitsLoaded: false,
  },
};

// =========================================
// PERFORMANCE LIMITS
// =========================================
// To avoid the UI feeling "hung" on large CSVs, we cap how many rows
// we render at once in heavy tables. The user can always narrow results
// with filters or search.
const MAX_REG_ROWS = 400;
const MAX_PERMIT_ROWS = 400;

// =========================================
// CSV PARSING
// =========================================
// Fully RFC4180-style CSV parser:
// - Handles commas inside quoted fields
// - Handles embedded newlines inside quoted fields
// - Handles escaped quotes ("") inside quoted fields
function parseCSV(text) {
  // Strip BOM if present
  if (text && text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows = [];
  let row = [];
  let value = "";
  let insideQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];

    if (insideQuotes) {
      if (c === '"') {
        const next = i + 1 < n ? text[i + 1] : null;
        if (next === '"') {
          // Escaped quote ("")
          value += '"';
          i += 2;
        } else {
          // Closing quote
          insideQuotes = false;
          i += 1;
        }
      } else {
        // Any character inside quotes, including newlines and commas
        value += c;
        i += 1;
      }
    } else {
      if (c === '"') {
        // Opening quote
        insideQuotes = true;
        i += 1;
      } else if (c === ",") {
        // Field terminator
        row.push(value);
        value = "";
        i += 1;
      } else if (c === "\r" || c === "\n") {
        // End of record
        row.push(value);
        value = "";
        rows.push(row);
        row = [];

        // Handle CRLF
        if (c === "\r" && i + 1 < n && text[i + 1] === "\n") {
          i += 2;
        } else {
          i += 1;
        }

        // Skip any additional newlines
        while (i < n && (text[i] === "\r" || text[i] === "\n")) {
          i += 1;
        }
      } else {
        // Regular character outside quotes
        value += c;
        i += 1;
      }
    }
  }

  // Flush last row if there’s remaining content
  if (value !== "" || row.length) {
    row.push(value);
    rows.push(row);
  }

  return rows;
}


// =========================================
// ZONING DATA LOADING & INDEXING
// =========================================

function headerIndex(colKey) {
  const headers = state.zoning.headers;
  if (!headers || !headers.length) return -1;
  const name = COL[colKey] || colKey;
  return headers.indexOf(name);
}

function getCell(row, colKey) {
  const idx = headerIndex(colKey);
  if (idx === -1) return "";
  return row[idx] || "";
}

function getNumeric(row, colKey) {
  const v = getCell(row, colKey);
  if (!v) return NaN;
  const num = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return isNaN(num) ? NaN : num;
}

async function loadZoningData() {
  const res = await fetch(CSV_URL);
  if (!res.ok) {
    throw new Error(`Failed to load zoning CSV: ${res.status}`);
  }
  const text = await res.text();
  const rows = parseCSV(text);
  if (!rows.length) throw new Error("Zoning CSV is empty");

  state.zoning.headers = rows[0];
  // Filter out totally empty lines
  state.zoning.rows = rows.slice(1).filter((r) =>
    r.some((cell) => cell && String(cell).trim() !== "")
  );

  indexZoningByCity();
  state.initialized.zoningLoaded = true;
}

function indexZoningByCity() {
  const cityIdx = headerIndex("city");
  if (cityIdx === -1) return;

  const byCity = new Map();
  for (const row of state.zoning.rows) {
    const city = (row[cityIdx] || "").trim();
    if (!city) continue;
    if (!byCity.has(city)) byCity.set(city, []);
    byCity.get(city).push(row);
  }
  state.zoning.byCity = byCity;
}

// =========================================
// PERMITS DATA
// =========================================

function pHeaderIndex(colName) {
  const headers = state.permits.headers;
  if (!headers || !headers.length) return -1;
  return headers.indexOf(colName);
}

function getPermitCell(row, colName) {
  const idx = pHeaderIndex(colName);
  if (idx === -1) return "";
  return row[idx] || "";
}

async function loadPermitsData() {
  try {
    const res = await fetch(PERMITS_URL);
    if (!res.ok) {
      console.warn("Permits CSV not found or failed to load:", res.status);
      return;
    }
    const text = await res.text();
    const rows = parseCSV(text);
    if (!rows.length) return;
state.permits.headers = rows[0];

// Filter out empty rows first
let parsedRows = rows.slice(1).filter((r) =>
  r.some((cell) => cell && String(cell).trim() !== "")
);

// --- FILTER TO ONLY 2024 + 2025 PERMITS ---
const yearCol = state.permits.headers.indexOf("Year");  // adjust if your column is named differently

if (yearCol !== -1) {
  parsedRows = parsedRows.filter((row) => {
    const year = parseInt((row[yearCol] || "").toString().trim(), 10);
    return year === 2024 || year === 2025;
  });
}

state.permits.rows = parsedRows;
state.permits.filteredRows = parsedRows.slice();

    state.initialized.permitsLoaded = true;
  } catch (err) {
    console.warn("Error loading permits CSV:", err);
  }
}

// =========================================
// GENERIC FILTERING FOR ZONING ROWS
// =========================================

function filterZoningRows(options) {
  const {
    city,
    zone,
    zoneType,
    adu,
    dadu,
    ownerOcc,
    search,
    selectAllCities,
  } = options;

  const rows = state.zoning.rows;
  const cityIdx = headerIndex("city");
  const zoneIdx = headerIndex("zone");
  const zoneTypeIdx = headerIndex("zoneType");
  const aduIdx = headerIndex("aduAllowed");
  const daduIdx = headerIndex("daduAllowed");
  const ownerIdx = headerIndex("ownerOcc");

  const searchLower = (search || "").toLowerCase().trim();

  return rows.filter((row) => {
    // City
    if (!selectAllCities && city && cityIdx !== -1) {
      const v = (row[cityIdx] || "").trim();
      if (v !== city) return false;
    }

    // Zone
    if (zone && zoneIdx !== -1) {
      const v = (row[zoneIdx] || "").trim();
      if (v !== zone) return false;
    }

    // Zone type
    if (zoneType && zoneTypeIdx !== -1) {
      const v = (row[zoneTypeIdx] || "").trim();
      if (v !== zoneType) return false;
    }

    // ADU allowed
    if (adu && aduIdx !== -1) {
      const v = (row[aduIdx] || "").trim();
      if (v !== adu) return false;
    }

    // DADU allowed
    if (dadu && daduIdx !== -1) {
      const v = (row[daduIdx] || "").trim();
      if (v !== dadu) return false;
    }

    // Owner occupancy
    if (ownerOcc && ownerIdx !== -1) {
      const v = (row[ownerIdx] || "").trim();
      if (v !== ownerOcc) return false;
    }

    // Free-text search across all cells
    if (searchLower) {
      const haystack = row.join(" ").toLowerCase();
      if (!haystack.includes(searchLower)) return false;
    }

    return true;
  });
}

// =========================================
// REGULATIONS TABLE RENDERING
// =========================================

const DISPLAY_COLUMNS = [
  {
    key: "city",
    label: "City",
    render(row) {
      return getCell(row, "city");
    },
  },
  {
    key: "zone",
    label: "Zone & type",
    render(row) {
      const zone = getCell(row, "zone");
      const type = getCell(row, "zoneType");
      return type ? `${zone} – ${type}` : zone;
    },
  },
  {
    key: "adu",
    label: "ADU / DADU",
    render(row) {
      const adu = getCell(row, "aduAllowed");
      const dadu = getCell(row, "daduAllowed");
      const owner = getCell(row, "ownerOcc");

      const parts = [];
      if (adu) parts.push(`ADU: ${adu}`);
      if (dadu) parts.push(`DADU: ${dadu}`);
      if (owner) parts.push(`Owner occ: ${owner}`);
      return parts.join(" · ");
    },
  },
  {
    key: "lot",
    label: "Lot & intensity",
    render(row) {
      const minLot = getCell(row, "minLotSize");
      const density = getCell(row, "density");
      const far = getCell(row, "maxFAR");
      const coverage = getCell(row, "maxLotCoverage");

      const bits = [];
      if (minLot) bits.push(`Min lot: ${minLot} sf`);
      if (density) bits.push(`Density: ${density}`);
      if (far) bits.push(`Max FAR: ${far}`);
      if (coverage) bits.push(`Lot coverage: ${coverage}%`);
      return bits.join(" · ");
    },
  },
  {
    key: "parking",
    label: "Parking",
    render(row) {
      const required = getCell(row, "aduParkingRequired");
      const transit = getCell(row, "aduParkingTransitExempt");
      const parts = [];
      if (required) parts.push(`ADU parking: ${required}`);
      if (transit) parts.push(`Transit exemption: ${transit}`);
      return parts.join(" · ");
    },
  },
  {
    key: "sizeHeight",
    label: "Size & height",
    render(row) {
      const maxSize = getCell(row, "maxADUSize");
      const maxPct = getCell(row, "maxADUSizePct");
      const maxADUHeight = getCell(row, "maxADUHeight");
      const maxDADUHeight = getCell(row, "maxDADUHeight");

      const bits = [];
      if (maxSize) bits.push(`Max ADU: ${maxSize} sf`);
      if (maxPct) bits.push(`Max %: ${maxPct}`);
      if (maxADUHeight) bits.push(`ADU ht: ${maxADUHeight} ft`);
      if (maxDADUHeight) bits.push(`DADU ht: ${maxDADUHeight} ft`);
      return bits.join(" · ");
    },
  },
  {
    key: "setbacks",
    label: "DADU setbacks",
    render(row) {
      const rear = getCell(row, "daduRear");
      const side = getCell(row, "daduSideLotLine");
      const street = getCell(row, "daduStreetSide");
      const fromPrincipal = getCell(row, "daduFromPrincipal");

      const bits = [];
      if (rear) bits.push(`Rear: ${rear}`);
      if (side) bits.push(`Side: ${side}`);
      if (street) bits.push(`Street: ${street}`);
      if (fromPrincipal) bits.push(`From primary: ${fromPrincipal}`);
      return bits.join(" · ");
    },
  },
  {
    key: "notes",
    label: "Notes & code",
    render(row) {
      const greenscape = getCell(row, "greenscapeNotes");
      const fees = getCell(row, "impactFees");
      const reviewed = getCell(row, "lastReviewed");

      const bits = [];
      if (greenscape) bits.push(greenscape);
      if (fees) bits.push(`Fees: ${fees}`);
      if (reviewed) bits.push(`Last reviewed: ${reviewed}`);
      return bits.join(" · ");
    },
  },
];

function buildTableHeader() {
  const thead = document.getElementById("tableHead");
  if (!thead) return;
  thead.innerHTML = "";

  const tr = document.createElement("tr");
  DISPLAY_COLUMNS.forEach((col) => {
    const th = document.createElement("th");
    th.textContent = col.label;
    tr.appendChild(th);
  });
  thead.appendChild(tr);
}

function renderRegulationsTable() {
  const tbody = document.getElementById("tableBody");
  const summary = state.ui.summaryEl || document.getElementById("summary");
  const tableWrapper = state.ui.tableWrapper || document.getElementById("regTableWrapper");
  const placeholder = state.ui.placeholder || document.getElementById("regPlaceholder");
  
  if (!tbody) {
    console.error("Table body element not found");
    return;
  }

  const rows = state.zoning.filteredRows || [];
  const total = state.zoning.rows.length;

  // Clear existing content
  tbody.innerHTML = "";

  if (!rows.length) {
    // Hide table, show placeholder
    if (tableWrapper) {
      tableWrapper.classList.add("hidden");
    }
    if (placeholder) {
      placeholder.style.display = "block";
      placeholder.innerHTML =
        '<h3>No Results Found</h3><p>Try adjusting your filters or search terms.</p>';
    }

    if (summary) {
      summary.textContent =
        "No matching regulations. Adjust or clear your filters.";
    }
    return;
  }

  // We have rows: show table, hide placeholder
  if (tableWrapper) {
    tableWrapper.classList.remove("hidden");
  }
  if (placeholder) {
    placeholder.style.display = "none";
  }

  // Respect max row cap to keep the UI responsive on very large CSVs
  const sliceCount = Math.min(rows.length, MAX_REG_ROWS);
  const rowsToRender = rows.slice(0, sliceCount);

  // Render each row
  rowsToRender.forEach((row) => {
    const tr = document.createElement("tr");
    DISPLAY_COLUMNS.forEach((col) => {
      const td = document.createElement("td");
      try {
        const rendered = col.render(row);
        td.textContent = rendered || "—";
      } catch (error) {
        console.error(`Error rendering column ${col.key}:`, error);
        td.textContent = "—";
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });

  // Update summary
  if (summary) {
    if (rows.length === total && rows.length <= MAX_REG_ROWS) {
      summary.textContent = `Showing all ${rows.length} regulation(s).`;
    } else if (rows.length > MAX_REG_ROWS) {
      summary.textContent = `Showing first ${sliceCount} of ${rows.length} matching regulation(s). Add filters to narrow further.`;
    } else {
      summary.textContent = `Showing ${rows.length} of ${total} regulation(s).`;
    }
  }
}

// =========================================
// REGULATIONS UI: FILTERS & SEARCH
// =========================================

function fillSelect(id, colKey, placeholderLabel) {
  const el = document.getElementById(id);
  if (!el) return;

  const idx = headerIndex(colKey);
  if (idx === -1) return;

  const values = new Set();
  for (const row of state.zoning.rows) {
    const v = (row[idx] || "").trim();
    if (v) values.add(v);
  }

  const sorted = Array.from(values).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  el.innerHTML = "";

  // Optional placeholder / "all" option
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = placeholderLabel || "All";
  el.appendChild(opt0);

  sorted.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });
}
// -----------------------------------------
// Helpers for feasibility UI
// -----------------------------------------

// Populate the Zone dropdown based on the chosen city
function updateFeasZoneOptions() {
  const citySelect = document.getElementById("feasCity");
  const zoneSelect = document.getElementById("feasZone");
  if (!citySelect || !zoneSelect) return;

  const city = (citySelect.value || "").trim();
  zoneSelect.innerHTML = "";

  const baseOption = document.createElement("option");
  if (!city) {
    baseOption.value = "";
    baseOption.textContent = "Select a city first";
    zoneSelect.appendChild(baseOption);
    zoneSelect.disabled = true;
    return;
  }

  const rows = state.zoning.byCity.get(city) || [];
  const zoneIdx = headerIndex("zone");
  if (zoneIdx === -1 || !rows.length) {
    baseOption.value = "";
    baseOption.textContent = "No zones found for this city";
    zoneSelect.appendChild(baseOption);
    zoneSelect.disabled = true;
    return;
  }

  const zones = Array.from(
    new Set(
      rows
        .map((row) => (row[zoneIdx] || "").toString().trim())
        .filter((z) => z)
    )
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  baseOption.value = "";
  baseOption.textContent = "All zones in city";
  zoneSelect.appendChild(baseOption);

  zones.forEach((z) => {
    const opt = document.createElement("option");
    opt.value = z;
    opt.textContent = z;
    zoneSelect.appendChild(opt);
  });

  zoneSelect.disabled = false;
}
function buildFeasDiagramShell() {
  const container = document.getElementById("feasDiagram");
  if (!container) return;

  // Only initialize once
  if (container.dataset.initialized === "true") return;
  container.dataset.initialized = "true";

  // Make sure the container has some height even before CSS kicks in
  container.style.minHeight = "260px";
  container.style.display = "flex";
  container.style.alignItems = "stretch";
  container.style.justifyContent = "center";

  container.innerHTML = `
    <div class="parcel-stage">
      <div class="lot-box" id="lotBox">
        <div class="lot-label" id="lotLabel">Lot: — sf</div>

        <div class="buildable-box" id="buildableRect">
          <div class="buildable-label" id="buildableLabel">
            Buildable envelope (conceptual)
          </div>
        </div>

        <div class="primary-box" id="primaryRect">
          <span class="primary-label" id="primaryLabel">Primary home</span>
        </div>

        <div class="adu-box" id="aduRect">
          <span class="adu-label" id="aduLabel">ADU footprint</span>
        </div>

        <!-- Simple handles just for visual affordance -->
        <div class="resize-handle lot-width-handle" id="lotWidthHandle" title="Lot width"></div>
        <div class="resize-handle lot-depth-handle" id="lotDepthHandle" title="Lot depth"></div>
      </div>
    </div>
  `;

  // Lightweight hover feedback on handles (no heavy drag logic)
  const lotBox = document.getElementById("lotBox");
  const widthHandle = document.getElementById("lotWidthHandle");
  const depthHandle = document.getElementById("lotDepthHandle");

  if (lotBox && widthHandle && depthHandle) {
    widthHandle.addEventListener("mouseenter", () =>
      lotBox.classList.add("lot-highlight-width")
    );
    widthHandle.addEventListener("mouseleave", () =>
      lotBox.classList.remove("lot-highlight-width")
    );

    depthHandle.addEventListener("mouseenter", () =>
      lotBox.classList.add("lot-highlight-depth")
    );
    depthHandle.addEventListener("mouseleave", () =>
      lotBox.classList.remove("lot-highlight-depth")
    );
  }
}

// Data → diagram geometry
function renderFeasibilityDiagram(zoneRow, inputs) {
  const lotBox = document.getElementById("lotBox");
  const buildableRect = document.getElementById("buildableRect");
  const primaryRect = document.getElementById("primaryRect");
  const aduRect = document.getElementById("aduRect");
  const lotLabel = document.getElementById("lotLabel");
  const buildableLabel = document.getElementById("buildableLabel");
  const primaryLabel = document.getElementById("primaryLabel");
  const aduLabel = document.getElementById("aduLabel");

  if (!lotBox || !buildableRect || !primaryRect || !aduRect) return;

  const {
    lotSize,
    lotWidth,
    lotDepth,
    houseWidth,
    houseDepth,
    aduSize,
    hasAlley,
  } = inputs;

  const fmtInt = (n) =>
    isNaN(n) || n <= 0 ? "—" : Math.round(n).toLocaleString();

  // Normalized lot dimensions
  let w = !isNaN(lotWidth) && lotWidth > 0 ? lotWidth : Math.sqrt(lotSize || 1);
  let d = !isNaN(lotDepth) && lotDepth > 0 ? lotDepth : Math.sqrt(lotSize || 1);
  if (!w || !d) {
    w = 100;
    d = 100;
  }

  // Grab DADU-related setback cells
  const rawRear = getCell(zoneRow, "daduRear");
  const rawSide = getCell(zoneRow, "daduSideLotLine");
  const rawStreet = getCell(zoneRow, "daduStreetSide");
  const rawFromPrimary = getCell(zoneRow, "daduFromPrincipal");

  const numFromText = (txt) => {
    if (!txt) return NaN;
    const match = String(txt).match(/([0-9.]+)/);
    return match ? parseFloat(match[1]) : NaN;
  };

  let rearFt = numFromText(rawRear);
  let sideFt = numFromText(rawSide);
  let frontFt = numFromText(rawFromPrimary);

  if (isNaN(rearFt)) rearFt = 10;
  if (isNaN(sideFt)) sideFt = 5;
  if (isNaN(frontFt)) frontFt = 15;

  // Alley access → slightly relax rear setback visually
  if (hasAlley) {
    rearFt = Math.max(rearFt * 0.7, 5);
  }

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

  const sidePct = clamp((sideFt / w) * 100, 0, 40);
  const frontPct = clamp((frontFt / d) * 100, 0, 40);
  const rearPct = clamp((rearFt / d) * 100, 0, 40);

  const buildableWidthPct = clamp(100 - sidePct * 2, 20, 96);
  const buildableHeightPct = clamp(100 - frontPct - rearPct, 20, 96);

  // Position buildable envelope
  Object.assign(buildableRect.style, {
    position: "absolute",
    left: `${sidePct}%`,
    right: `${sidePct}%`,
    top: `${frontPct}%`,
    bottom: `${rearPct}%`,
  });

  // Primary footprint from inputs or generic proportion
  let primaryWidthPct = 35;
  let primaryHeightPct = 30;

  if (!isNaN(houseWidth) && houseWidth > 0) {
    primaryWidthPct = clamp(
      (houseWidth / w) * buildableWidthPct,
      15,
      Math.min(60, buildableWidthPct)
    );
  }
  if (!isNaN(houseDepth) && houseDepth > 0) {
    primaryHeightPct = clamp(
      (houseDepth / d) * buildableHeightPct,
      15,
      Math.min(50, buildableHeightPct)
    );
  }

  Object.assign(primaryRect.style, {
    position: "absolute",
    left: `${sidePct + 5}%`,
    top: `${frontPct + 5}%`,
    width: `${primaryWidthPct}%`,
    height: `${primaryHeightPct}%`,
  });

  // ADU footprint from target size vs lot size
  let aduWidthPct = 22;
  let aduHeightPct = 22;

  if (!isNaN(aduSize) && aduSize > 0 && !isNaN(lotSize) && lotSize > 0) {
    const footprintRatio = Math.min(aduSize / lotSize, 0.35);
    const sideShare = Math.sqrt(footprintRatio);

    aduWidthPct = clamp(sideShare * buildableWidthPct * 1.2, 10, 30);
    aduHeightPct = clamp(sideShare * buildableHeightPct * 1.2, 10, 30);
  }

  const aduLeftBase = sidePct + buildableWidthPct * 0.55;
  let aduTopBase = frontPct + buildableHeightPct * 0.35;

  if (hasAlley) {
    // With alley, bias the ADU further back in the lot
    aduTopBase = frontPct + buildableHeightPct * 0.55;
  }

  Object.assign(aduRect.style, {
    position: "absolute",
    left: `${aduLeftBase}%`,
    top: `${aduTopBase}%`,
    width: `${aduWidthPct}%`,
    height: `${aduHeightPct}%`,
  });

  // Labels: lot + buildable + primary + ADU
  if (lotLabel) {
    lotLabel.textContent = `Lot • ${fmtInt(lotSize)} sf`;
  }

  if (buildableLabel) {
    const maxCoveragePct = getNumeric(zoneRow, "maxLotCoverage");
    let coverageText = "";
    if (!isNaN(lotSize) && !isNaN(maxCoveragePct) && maxCoveragePct > 0) {
      const coverageFraction =
        maxCoveragePct > 1 ? maxCoveragePct / 100 : maxCoveragePct;
      const maxFootprint = lotSize * coverageFraction;
      coverageText = ` · Max footprint (coverage): ${fmtInt(maxFootprint)} sf`;
    }
    buildableLabel.textContent = `Buildable area (approx) – Lot: ${fmtInt(
      lotSize
    )} sf${coverageText}`;
  }

  if (primaryLabel) {
    const homeFootprint =
      !isNaN(houseWidth) && !isNaN(houseDepth)
        ? houseWidth * houseDepth
        : NaN;
    primaryLabel.textContent = `Primary home • ${
      isNaN(homeFootprint) ? "footprint not specified" : `${fmtInt(homeFootprint)} sf`
    }`;
  }

  if (aduLabel) {
    const maxADUSize = getNumeric(zoneRow, "maxADUSize");
    let limitText = "";
    if (!isNaN(maxADUSize) && maxADUSize > 0) {
      limitText = ` / Max ADU: ${fmtInt(maxADUSize)} sf`;
    }
    aduLabel.textContent = `ADU • ${fmtInt(aduSize)} sf${limitText}`;
  }
}

// Detailed "report" panel
function renderFeasibilityDetails(zoneRow, context) {
  const detailsEl = document.getElementById("feasibilityDetails");
  if (!detailsEl) return;

  const {
    city,
    zone,
    lotSize,
    lotWidth,
    lotDepth,
    houseWidth,
    houseDepth,
    aduSize,
    hasTransit,
    hasAlley,
    status,
  } = context;

  const fmt = (n, suffix = "") =>
    isNaN(n) || n <= 0 ? "—" : `${Math.round(n).toLocaleString()}${suffix}`;
  const get = (key) => getCell(zoneRow, key) || "—";

  const zoneType = get("zoneType");
  const minLot = get("minLotSize");
  const density = get("density");
  const far = get("maxFAR");
  const coverage = get("maxLotCoverage");
  const aduAllowed = get("aduAllowed");
  const daduAllowed = get("daduAllowed");
  const owner = get("ownerOcc");
  const maxSize = get("maxADUSize");
  const maxPct = get("maxADUSizePct");
  const maxADUHeight = get("maxADUHeight");
  const maxDADUHeight = get("maxDADUHeight");
  const rear = get("daduRear");
  const side = get("daduSideLotLine");
  const street = get("daduStreetSide");
  const fromPrimary = get("daduFromPrincipal");
  const parkingReq = get("aduParkingRequired");
  const parkingTransit = get("aduParkingTransitExempt");
  const greenscape = get("greenscapeNotes");
  const impactFees = get("impactFees");
  const lastReviewed = get("lastReviewed");

  const statusLabel =
    status === "yes"
      ? "Generally feasible"
      : status === "maybe"
      ? "Potentially feasible with constraints"
      : status === "no"
      ? "Not clearly feasible in this row"
      : "Needs review";

  const heading = `${city || ""}${zone ? ` – ${zone}` : ""}${
    zoneType && zoneType !== "—" ? ` (${zoneType})` : ""
  }`;

  detailsEl.innerHTML = `
    <h3>Feasibility report: ${heading}</h3>
    <p class="feasibility-status-tag">Status: ${statusLabel}</p>
    <dl class="feasibility-report">
      <div class="feasibility-metric">
        <dt>Lot inputs</dt>
        <dd>
          Lot size: ${fmt(lotSize, " sf")} · Width: ${fmt(
    lotWidth,
    " ft"
  )} · Depth: ${fmt(lotDepth, " ft")}
          <br/>Existing home: ${fmt(houseWidth, " ft")} (width) × ${fmt(
    houseDepth,
    " ft"
  )} (depth)
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>Target ADU</dt>
        <dd>Target size: ${fmt(aduSize, " sf")} · Size limit (row): ${
    maxSize || "—"
  } · % of primary/lot limit: ${maxPct || "—"}</dd>
      </div>

      <div class="feasibility-metric">
        <dt>Intensity (from dataset)</dt>
        <dd>
          Min lot size: ${minLot || "—"} · Density: ${density || "—"}
          <br/>Max FAR: ${far || "—"} · Max lot coverage: ${coverage || "—"}
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>ADU &amp; DADU permissions</dt>
        <dd>
          ADU allowed: ${aduAllowed || "—"} · DADU allowed: ${
    daduAllowed || "—"
  }
          <br/>Owner occupancy: ${owner || "—"}
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>Height limits</dt>
        <dd>
          Max ADU height: ${maxADUHeight || "—"} · Max DADU height: ${
    maxDADUHeight || "—"
  }
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>DADU setbacks</dt>
        <dd>
          Rear: ${rear || "—"} · Side: ${side || "—"} · Street: ${
    street || "—"
  } · From primary: ${fromPrimary || "—"}
          <br/>Alley access: ${hasAlley ? "Yes (assumed in diagram)" : "No"}
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>Parking</dt>
        <dd>
          ADU parking requirement: ${parkingReq || "—"}
          <br/>Transit-based relief: ${parkingTransit || "—"}
          <br/>Transit radius in inputs: ${
            hasTransit ? "Checked" : "Not checked"
          }
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>Landscape, fees &amp; notes</dt>
        <dd>
          Greenscape / open space notes: ${greenscape || "—"}
          <br/>Impact fees: ${impactFees || "—"}
          <br/>Last reviewed: ${lastReviewed || "—"}
        </dd>
      </div>
    </dl>
    <p class="feasibility-disclaimer">
      This diagram and report are a simplified interpretation of the zoning dataset you provided.
      They are intended as a screening tool only and do not replace a full zoning and building code review
      or direct confirmation with local planning staff.
    </p>
  `;
}

function initRegulationsFilters() {
  fillSelect("cityFilter", "city", "All cities");
  fillSelect("zoneFilter", "zone", "All zones");
  fillSelect("zoneTypeFilter", "zoneType", "All zone types");
  fillSelect("aduFilter", "aduAllowed", "Any ADU");
  fillSelect("daduFilter", "daduAllowed", "Any DADU");
  fillSelect("ownerOccFilter", "ownerOcc", "Any owner-occupancy");
}

function performRegulationsSearch() {
  if (!state.initialized.zoningLoaded) return;

  const city = (document.getElementById("cityFilter")?.value || "").trim();
  const zone = (document.getElementById("zoneFilter")?.value || "").trim();
  const zoneType =
    (document.getElementById("zoneTypeFilter")?.value || "").trim();
  const adu = (document.getElementById("aduFilter")?.value || "").trim();
  const dadu = (document.getElementById("daduFilter")?.value || "").trim();
  const ownerOcc =
    (document.getElementById("ownerOccFilter")?.value || "").trim();
  const search =
    (document.getElementById("searchInput")?.value || "").toLowerCase();
  const selectAllCities = !!state.ui.selectAllCities?.checked;

  const filtered = filterZoningRows({
    city,
    zone,
    zoneType,
    adu,
    dadu,
    ownerOcc,
    search,
    selectAllCities,
  });

  state.zoning.filteredRows = filtered;
  buildTableHeader();
  renderRegulationsTable();
}

function clearRegulationsFilters() {
  if (state.ui.selectAllCities) {
    state.ui.selectAllCities.checked = false;
  }

  const ids = [
    "cityFilter",
    "zoneFilter",
    "zoneTypeFilter",
    "aduFilter",
    "daduFilter",
    "ownerOccFilter",
    "searchInput",
  ];

  ids.forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    // For select and input, just reset to empty
    el.value = "";
    if (id === "cityFilter") {
      el.disabled = false;
    }
  });

  // Hide table, show placeholder
  if (state.ui.tableWrapper) {
    state.ui.tableWrapper.classList.add("hidden");
  }
  if (state.ui.placeholder) {
    state.ui.placeholder.style.display = "block";
    state.ui.placeholder.innerHTML =
      '<h3>Ready to Search</h3><p>Select filters above, then click "Search Regulations" to view results.</p>';
  }

  // Clear table body & header
  const thead = document.getElementById("tableHead");
  const tbody = document.getElementById("tableBody");
  if (thead) thead.innerHTML = "";
  if (tbody) tbody.innerHTML = "";

  // Reset summary
  const summary = state.ui.summaryEl || document.getElementById("summary");
  if (summary) {
    summary.textContent =
      "Data and diagrams are simplified for feasibility screening and do not replace a detailed code review or conversation with planning staff.";
  }

  state.zoning.filteredRows = [];
}

function initRegulationsUI() {
  state.ui.selectAllCities = document.getElementById("selectAllCities");
  state.ui.searchButton = document.getElementById("searchRegulationsBtn");
  state.ui.placeholder = document.getElementById("regPlaceholder");
  state.ui.tableWrapper = document.getElementById("regTableWrapper");
  state.ui.summaryEl = document.getElementById("summary");

  // Initial placeholder state
  if (state.ui.placeholder && state.ui.tableWrapper) {
    state.ui.placeholder.style.display = "block";
    state.ui.placeholder.innerHTML =
      '<h3>Ready to Search</h3><p>Select filters above, then click "Search Regulations" to view results.</p>';
    state.ui.tableWrapper.classList.add("hidden");
  }

  // Select-all functionality
  if (state.ui.selectAllCities) {
    state.ui.selectAllCities.addEventListener("change", function () {
      const cityFilter = document.getElementById("cityFilter");
      if (!cityFilter) return;
      if (this.checked) {
        cityFilter.value = "";
        cityFilter.disabled = true;
      } else {
        cityFilter.disabled = false;
      }
    });
  }

  // Search button
  if (state.ui.searchButton) {
    state.ui.searchButton.addEventListener("click", () => {
      performRegulationsSearch();
    });
  }

  // Clear filters button
  const clearBtn = document.getElementById("clearFilters");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      clearRegulationsFilters();
    });
  }

  // Enter key triggers search
  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") {
        performRegulationsSearch();
      }
    });
  }
}

// =========================================
// CITY SCORECARDS (PER-CITY SUMMARY)
// =========================================

function computeCityScore(cityName, rows) {
  if (!rows || !rows.length) return { score: 0, grade: "?" };

  const aduIdx = headerIndex("aduAllowed");
  const daduIdx = headerIndex("daduAllowed");
  const ownerIdx = headerIndex("ownerOcc");

  let aduYes = 0;
  let daduYes = 0;
  let ownerNo = 0;

  rows.forEach((row) => {
    const adu = aduIdx !== -1 ? String(row[aduIdx] || "").toLowerCase() : "";
    const dadu = daduIdx !== -1 ? String(row[daduIdx] || "").toLowerCase() : "";
    const owner =
      ownerIdx !== -1 ? String(row[ownerIdx] || "").toLowerCase() : "";

    if (adu.includes("yes")) aduYes++;
    if (dadu.includes("yes")) daduYes++;
    if (owner.includes("no")) ownerNo++;
  });

  const n = rows.length;
  const aduScore = n ? aduYes / n : 0;
  const daduScore = n ? daduYes / n : 0;
  const ownerFlexScore = n ? ownerNo / n : 0;

  // Simple weighted score [0–100]
  const score = Math.round(
    (aduScore * 0.4 + daduScore * 0.4 + ownerFlexScore * 0.2) * 100
  );

  let grade = "C";
  if (score >= 85) grade = "A";
  else if (score >= 70) grade = "B";
  else if (score >= 50) grade = "C";
  else grade = "D";

  return { score, grade, aduYes, daduYes, n };
}

function renderCityScorecards() {
  const container = document.getElementById("cityScorecards");
  if (!container || !state.zoning.byCity.size) return;

  container.innerHTML = "";

  const cities = Array.from(state.zoning.byCity.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  cities.forEach((city) => {
    const rows = state.zoning.byCity.get(city) || [];
    const metrics = computeCityScore(city, rows);

    // FIXED: Use scorecard-item class instead of scorecard
    const card = document.createElement("article");
    card.className = "scorecard-item";

    card.innerHTML = `
      <header class="scorecard-header">
        <h3 class="scorecard-city">${city}</h3>
        <div class="scorecard-grade">${metrics.grade}</div>
      </header>
      <div class="scorecard-bar-wrap">
        <div class="scorecard-bar" style="width: ${metrics.score}%"></div>
      </div>
      <ul class="scorecard-bullets">
        <li>ADU allowed in ${metrics.aduYes} of ${metrics.n} zones</li>
        <li>DADU allowed in ${metrics.daduYes} of ${metrics.n} zones</li>
        <li>Flexibility score: ${metrics.score}/100</li>
      </ul>
    `;

    // Add click handler to the entire card
    card.style.cursor = 'pointer';
    card.addEventListener('click', function() {
      const cityFilter = document.getElementById("cityFilter");
      if (cityFilter) {
        cityFilter.value = city;
        if (state.ui.selectAllCities) {
          state.ui.selectAllCities.checked = false;
          cityFilter.disabled = false;
        }
      }
      performRegulationsSearch();
      
      // Scroll to regulations section
      const regsSection = document.querySelector('.filters-card');
      if (regsSection && regsSection.scrollIntoView) {
        regsSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });

    container.appendChild(card);
  });
}
// =========================================
// LOT-LEVEL FEASIBILITY CHECKER
// =========================================
// =========================================
// LOT-LEVEL FEASIBILITY CHECKER
// =========================================

// Helpers reused across feasibility logic
function headerIndex(colName) {
  if (!state.zoning.headers) return -1;
  return state.zoning.headers.findIndex(
    (h) => h.toLowerCase().trim() === colName.toLowerCase().trim()
  );
}

function getCell(row, colName) {
  const idx = headerIndex(colName);
  if (idx === -1 || !row) return "";
  return (row[idx] ?? "").toString().trim();
}

function getNumeric(row, colName) {
  const raw = getCell(row, colName);
  if (!raw) return NaN;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  return cleaned ? parseFloat(cleaned) : NaN;
}

// Build the static diagram “shell” inside #feasDiagram
function buildFeasDiagramShell() {
  const container = document.getElementById("feasDiagram");
  if (!container) return;

  // Only build once
  if (container.dataset.initialized === "true") return;
  container.dataset.initialized = "true";

  container.innerHTML = `
    <div class="parcel-stage">
      <div class="lot-box" id="lotBox">
        <div class="lot-label" id="lotLabel">Lot: — sf</div>
        <div class="buildable-box" id="buildableRect">
          <div class="buildable-label" id="buildableLabel">Buildable area</div>
        </div>
        <div class="primary-box" id="primaryRect">
          <div class="primary-label" id="primaryLabel">Primary home</div>
        </div>
        <div class="adu-box" id="aduRect">
          <div class="adu-label" id="aduLabel">ADU</div>
        </div>

        <!-- Handles along edges for a bit of interactivity -->
        <div class="resize-handle" id="lotWidthHandle"></div>
        <div class="resize-handle" id="lotDepthHandle"></div>
      </div>
    </div>
  `;

  // Very lightweight handle behavior – no heavy listeners
  const lotBox = document.getElementById("lotBox");
  const widthHandle = document.getElementById("lotWidthHandle");
  const depthHandle = document.getElementById("lotDepthHandle");

  if (lotBox && widthHandle && depthHandle) {
    widthHandle.addEventListener("mouseenter", () => {
      lotBox.classList.add("lot-highlight-width");
    });
    widthHandle.addEventListener("mouseleave", () => {
      lotBox.classList.remove("lot-highlight-width");
    });

    depthHandle.addEventListener("mouseenter", () => {
      lotBox.classList.add("lot-highlight-depth");
    });
    depthHandle.addEventListener("mouseleave", () => {
      lotBox.classList.remove("lot-highlight-depth");
    });
  }
}

// Render the visual diagram based on lot + zone snapshot
function renderFeasibilityDiagram({
  lotSize,
  lotWidth,
  lotDepth,
  houseWidth,
  houseDepth,
  status,
  hasAlley,
}) {
  const lotBox = document.getElementById("lotBox");
  const primaryRect = document.getElementById("primaryRect");
  const aduRect = document.getElementById("aduRect");
  const buildableRect = document.getElementById("buildableRect");
  const lotLabel = document.getElementById("lotLabel");
  const buildableLabel = document.getElementById("buildableLabel");
  const aduLabel = document.getElementById("aduLabel");
  const primaryLabel = document.getElementById("primaryLabel");
  const container = document.getElementById("feasDiagram");
  if (!lotBox || !primaryRect || !aduRect || !buildableRect || !container) {
    return;
  }

  // Simple normalized sizing so shapes look reasonable across lot sizes
  const baseLot = Math.max(lotSize || 4000, 2000); // sf
  const lotScale = Math.sqrt((lotSize || baseLot) / baseLot);
  const primaryScale =
    houseWidth && houseDepth ? Math.sqrt((houseWidth * houseDepth) / 1000) : 1;
  const aduScale = Math.sqrt((Math.min(lotSize || 4000, 800) || 800) / 800);

  // Use percentages so it stays responsive in CSS
  lotBox.style.setProperty("--lot-width-pct", "100%");
  lotBox.style.setProperty("--lot-height-pct", "70%");

  const primaryWidthPct = Math.min(40 * primaryScale, 60);
  const primaryDepthPct = Math.min(35 * primaryScale, 50);

  primaryRect.style.width = `${primaryWidthPct}%`;
  primaryRect.style.height = `${primaryDepthPct}%`;
  primaryRect.style.left = "10%";
  primaryRect.style.top = "15%";

  const aduWidthPct = Math.min(25 * aduScale, 40);
  const aduDepthPct = Math.min(25 * aduScale, 40);

  // Place ADU near rear, shifted if alley=true
  aduRect.style.width = `${aduWidthPct}%`;
  aduRect.style.height = `${aduDepthPct}%`;
  aduRect.style.left = hasAlley ? "55%" : "60%";
  aduRect.style.top = hasAlley ? "55%" : "60%";

  // Buildable rectangle = inset from lot edges (conceptual setbacks)
  buildableRect.style.left = "10%";
  buildableRect.style.top = "20%";
  buildableRect.style.width = "80%";
  buildableRect.style.height = "60%";

  // Labels
  if (lotLabel) {
    lotLabel.textContent = `Lot: ${
      isNaN(lotSize) ? "—" : `${lotSize.toLocaleString()} sf`
    }`;
  }
  if (buildableLabel) {
    buildableLabel.textContent = "Buildable envelope (conceptual)";
  }
  if (primaryLabel) {
    primaryLabel.textContent = `Primary home${
      houseWidth && houseDepth
        ? ` · ${houseWidth}′ × ${houseDepth}′`
        : ""
    }`;
  }
  if (aduLabel) {
    aduLabel.textContent = `ADU footprint (approx.)`;
  }

  container.dataset.status = status || "unknown";
}

// Render the detailed text report
function renderFeasibilityDetails({
  city,
  zone,
  zoneType,
  status,
  lotSize,
  lotWidth,
  lotDepth,
  houseWidth,
  houseDepth,
  aduSize,
  zoneRow,
  hasTransit,
  hasAlley,
}) {
  const detailsEl = document.getElementById("feasibilityDetails");
  if (!detailsEl) return;

  const fmt = (v, suffix = "") =>
    isNaN(v) || v == null ? "—" : `${v.toLocaleString()}${suffix}`;

  const minLot = getNumeric(zoneRow, "minLotSize");
  const far = getCell(zoneRow, "maxFAR") || getCell(zoneRow, "FAR");
  const coverage = getCell(zoneRow, "maxLotCoverage");
  const density = getCell(zoneRow, "maxDensity");
  const maxSize = getNumeric(zoneRow, "maxADUSize");
  const maxPct = getCell(zoneRow, "aduSizeAsPctPrincipal");

  const aduAllowed = getCell(zoneRow, "aduAllowed");
  const daduAllowed = getCell(zoneRow, "daduAllowed");
  const owner = getCell(zoneRow, "ownerOcc");

  const maxADUHeight = getCell(zoneRow, "aduHeight");
  const maxDADUHeight = getCell(zoneRow, "daduHeight");

  const rear = getCell(zoneRow, "daduRear");
  const side = getCell(zoneRow, "daduSideLotLine");
  const street = getCell(zoneRow, "daduStreetSide");
  const fromPrimary = getCell(zoneRow, "daduFromPrincipal");

  const parkingReq = getCell(zoneRow, "aduParkingRequired");
  const parkingTransit = getCell(zoneRow, "aduParkingTransitExempt");
  const greenscape = getCell(zoneRow, "greenscapeNotes");
  const impactFees = getCell(zoneRow, "impactFees");
  const lastReviewed = getCell(zoneRow, "lastReviewed");

  const statusLabel =
    status === "yes"
      ? "Generally feasible"
      : status === "maybe"
      ? "Potentially feasible with constraints"
      : status === "no"
      ? "Not clearly feasible in this row"
      : "Needs review";

  const heading = `${city || ""}${zone ? ` – ${zone}` : ""}${
    zoneType ? ` (${zoneType})` : ""
  }`;

  detailsEl.innerHTML = `
    <h3>Feasibility report: ${heading}</h3>
    <p class="feasibility-status-tag">Status: ${statusLabel}</p>
    <dl class="feasibility-report">
      <div class="feasibility-metric">
        <dt>Lot inputs</dt>
        <dd>
          Lot size: ${fmt(lotSize, " sf")} · Width: ${fmt(lotWidth, " ft")} · Depth: ${fmt(
    lotDepth,
    " ft"
  )}
          <br/>Existing home: ${fmt(houseWidth, " ft")} (width) × ${fmt(
    houseDepth,
    " ft"
  )} (depth)
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>Target ADU</dt>
        <dd>
          Target size: ${fmt(aduSize, " sf")}
          · Size limit (row): ${maxSize || "—"}
          · % of primary limit: ${maxPct || "—"}
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>Intensity (from dataset)</dt>
        <dd>
          Min lot size: ${minLot || "—"} · Density: ${density || "—"}
          <br/>Max FAR: ${far || "—"} · Max lot coverage: ${coverage || "—"}
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>ADU &amp; DADU permissions</dt>
        <dd>
          ADU allowed: ${aduAllowed || "—"} · DADU allowed: ${daduAllowed || "—"}
          <br/>Owner occupancy: ${owner || "—"}
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>Height limits</dt>
        <dd>
          Max ADU height: ${maxADUHeight || "—"} · Max DADU height: ${
    maxDADUHeight || "—"
  }
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>DADU setbacks</dt>
        <dd>
          Rear: ${rear || "—"} · Side: ${side || "—"} · Street: ${street || "—"}
          · From primary: ${fromPrimary || "—"}
          <br/>Alley access: ${hasAlley ? "Yes (assumed in diagram)" : "No"}
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>Parking</dt>
        <dd>
          ADU parking requirement: ${parkingReq || "—"}
          <br/>Transit-based relief: ${parkingTransit || "—"}
          <br/>Transit radius flag in inputs: ${
            hasTransit ? "Checked" : "Not checked"
          }
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>Landscape, fees &amp; notes</dt>
        <dd>
          Greenscape / open space notes: ${greenscape || "—"}
          <br/>Impact fees: ${impactFees || "—"}
          <br/>Last reviewed: ${lastReviewed || "—"}
        </dd>
      </div>
    </dl>
    <p class="feasibility-disclaimer">
      This diagram and report are a simplified visual interpretation of the dataset you provided.
      They are intended for screening only and do not replace a full zoning and building code review
      or direct confirmation with planning staff.
    </p>
  `;
}

// Main feasibility runner
function runFeasibilityCheck() {
  if (!state.initialized.zoningLoaded) {
    return;
  }

  try {
    const city =
      (document.getElementById("feasCity")?.value || "").toString().trim();
    const zone =
      (document.getElementById("feasZone")?.value || "").toString().trim();

    const lotSizeStr =
      (document.getElementById("feasLotSize")?.value || "").trim();
    const lotWidthStr =
      (document.getElementById("feasLotWidth")?.value || "").trim();
    const lotDepthStr =
      (document.getElementById("feasLotDepth")?.value || "").trim();
    const houseWidthStr =
      (document.getElementById("feasHouseWidth")?.value || "").trim();
    const houseDepthStr =
      (document.getElementById("feasHouseDepth")?.value || "").trim();
    const aduSizeStr =
      (document.getElementById("feasADUSize")?.value || "").trim();

    const hasTransit = !!document.getElementById("feasTransit")?.checked;
    const hasAlley = !!document.getElementById("feasAlley")?.checked;

    const parseNum = (str) => {
      if (!str) return NaN;
      const cleaned = str.replace(/[^0-9.\-]/g, "");
      return cleaned ? parseFloat(cleaned) : NaN;
    };

    let lotSize = parseNum(lotSizeStr);
    const lotWidth = parseNum(lotWidthStr);
    const lotDepth = parseNum(lotDepthStr);
    const houseWidth = parseNum(houseWidthStr);
    const houseDepth = parseNum(houseDepthStr);
    const aduSize = parseNum(aduSizeStr);

    // Fallback: approximate lot size from width × depth if needed
    if ((isNaN(lotSize) || !lotSize) && !isNaN(lotWidth) && !isNaN(lotDepth)) {
      lotSize = lotWidth * lotDepth;
    }}

    const summaryEl = document.getElementById("feasibilitySummary");
    const detailsEl = document.getElementById("feasibilityDetails");
    const diagramEl = document.getElementById("feasDiagram");

    if (detailsEl) detailsEl.innerHTML = "";
    if (diagramEl) diagramEl.dataset.status = "";

    if (!city || isNaN(lotSize) || isNaN(aduSize)) {
      if (summaryEl) {
        summaryEl.innerHTML = `
          <p class="feasibility-headline" data-status="incomplete">
            Pick a city and (optionally) a zone, then enter lot size and target ADU size
            to see a feasibility screen.
          </p>`;
      }
      return;
    }

    // Find zoning rows for city (+ zone)
    let rows = state.zoning.byCity.get(city) || [];
    if (!rows.length) {
      if (summaryEl) {
        summaryEl.innerHTML = `
          <p class="feasibility-headline" data-status="unknown">
            No zoning rows found for ${city} in the current dataset.
          </p>`;
      }
      return;
    }

    if (zone) {
      const zoneIdx = headerIndex("zone");
      if (zoneIdx !== -1) {
        rows = rows.filter(
          (row) => (row[zoneIdx] || "").toString().trim() === zone
        );
      }
    }

    if (!rows.length) {
      if (summaryEl) {
        summaryEl.innerHTML = `
          <p class="feasibility-headline" data-status="unknown">
            No zoning rows matched the selected city + zone combination.
          </p>`;
      }
      return;
    }

    // Choose a "least restrictive" row as our working snapshot
    let bestRow = rows[0];
    let bestScore = -Infinity;

    rows.forEach((row) => {
      const minLot = getNumeric(row, "minLotSize");
      const maxSize = getNumeric(row, "maxADUSize");
      const aduAllowed = getCell(row, "aduAllowed").toLowerCase();
      const daduAllowed = getCell(row, "daduAllowed").toLowerCase();

      let score = 0;
      if (!isNaN(minLot) && lotSize >= minLot) score += 2;
      if (!isNaN(maxSize) && aduSize <= maxSize) score += 2;
      if (aduAllowed.includes("yes")) score += 1;
      if (daduAllowed.includes("yes")) score += 0.5;

      if (score > bestScore) {
        bestScore = score;
        bestRow = row;
      }
    });

    const minLot = getNumeric(bestRow, "minLotSize");
    const maxSize = getNumeric(bestRow, "maxADUSize");
    const aduAllowed = getCell(bestRow, "aduAllowed");
    const daduAllowed = getCell(bestRow, "daduAllowed");
    const zoneType = getCell(bestRow, "zoneType");

    let status = "unknown";
    const lotOK = !isNaN(minLot) ? lotSize >= minLot : true;
    const sizeOK = !isNaN(maxSize) ? aduSize <= maxSize : true;
    const aduYes = aduAllowed.toLowerCase().includes("yes");

    if (!aduYes) {
      status = "no";
    } else if (lotOK && sizeOK) {
      status = "yes";
    } else if (lotOK || sizeOK) {
      status = "maybe";
    } else {
      status = "no";
    }

    if (summaryEl) {
      const statusLabel =
        status === "yes"
          ? "generally feasible"
          : status === "maybe"
          ? "potentially feasible with constraints"
          : status === "no"
          ? "not clearly feasible"
          : "needs review";

      summaryEl.innerHTML = `
        <p class="feasibility-headline" data-status="${status}">
          For <strong>${city}</strong>${zone ? `, zone <strong>${zone}</strong>` : ""}:
          this lot and ADU size appear <strong>${statusLabel}</strong> using the most
          permissive matching row in your dataset.
        </p>`;
    }

    // Diagram + report
    buildFeasDiagramShell();
    renderFeasibilityDiagram({
      lotSize,
      lotWidth,
      lotDepth,
      houseWidth,
      houseDepth,
      status,
      hasAlley,
    });

    renderFeasibilityDetails({
      city,
      zone,
      zoneType,
      status,
      lotSize,
      lotWidth,
      lotDepth,
      houseWidth,
      houseDepth,
      aduSize,
      zoneRow: bestRow,
      hasTransit,
      hasAlley,
    });
  } catch (err) {
    console.error("Feasibility check error:", err);
    const summaryEl = document.getElementById("feasibilitySummary");
    if (summaryEl) {
      summaryEl.innerHTML = `
        <p class="feasibility-headline" data-status="error">
          Something went wrong while running the feasibility check. Check the console
          for details and confirm that the zoning CSV headers match the columns this
          tool expects.
        </p>`;
    }
  }
}

// Initialize city + zone selects and wire the Run button + diagram shell
function initFeasibility() {
  buildFeasDiagramShell();

  const runBtn = document.getElementById("runFeasibility");
  if (runBtn) {
    runBtn.addEventListener("click", (e) => {
      e.preventDefault();
      runFeasibilityCheck();
    });
  }

  const feasCity = document.getElementById("feasCity");
  const feasZone = document.getElementById("feasZone");
  if (!feasCity || !state.zoning.byCity) return;

  // Initial helper text in the summary area
  const summaryEl = document.getElementById("feasibilitySummary");
  if (summaryEl) {
    summaryEl.innerHTML = `
      <p class="feasibility-headline" data-status="idle">
        Choose a city and zone, then enter lot and ADU details to see a feasibility snapshot,
        diagram, and detailed report.
      </p>`;
  }

  // Populate cities
  const cities = Array.from(state.zoning.byCity.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  feasCity.innerHTML = "";
  const opt0 = document.createElement("option");
  opt0.value = "";
  opt0.textContent = "Select a city";
  feasCity.appendChild(opt0);

  cities.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    feasCity.appendChild(opt);
  });

  // When city changes, populate zone list from that city's rows
  if (feasZone) {
    const resetZones = (label) => {
      feasZone.innerHTML = "";
      const z0 = document.createElement("option");
      z0.value = "";
      z0.textContent = label;
      feasZone.appendChild(z0);
    };

    resetZones("Select a city first");

    feasCity.addEventListener("change", () => {
      const selectedCity = (feasCity.value || "").trim();
      if (!selectedCity) {
        resetZones("Select a city first");
        return;
      }

      const rows = state.zoning.byCity.get(selectedCity) || [];
      const zoneIdx = headerIndex("zone");
      if (zoneIdx === -1) {
        resetZones("Zones not found for this city");
        return;
      }

      const zones = Array.from(
        new Set(
          rows
            .map((row) => (row[zoneIdx] || "").toString().trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

      resetZones("All zones in city");
      zones.forEach((z) => {
        const opt = document.createElement("option");
        opt.value = z;
        opt.textContent = z;
        feasZone.appendChild(opt);
      });
    });
  }
}


// =========================================
// PERMITS TABLE (BASIC VERSION)
// =========================================

function initPermitsFilters() {
  if (!state.initialized.permitsLoaded) return;

  const yearFilter = document.getElementById("permitsYearFilter");
  const cityFilter = document.getElementById("permitsCityFilter");

  const headers = state.permits.headers;
  const rows = state.permits.rows;

  if (!headers || !headers.length || !rows.length) return;

  // Try to auto-detect a "year" and "city" column by name
  const yearColCandidates = ["Year", "PERMIT_YEAR", "IssueYear"];
  const cityColCandidates = ["City", "CITY", "Jurisdiction"];

  const yearCol =
    yearColCandidates.find((c) => headers.includes(c)) || null;
  const cityCol =
    cityColCandidates.find((c) => headers.includes(c)) || null;

  // Store so renderPermits can reuse
  state.permits.yearCol = yearCol;
  state.permits.cityCol = cityCol;

  // Populate year filter
  if (yearFilter && yearCol) {
    const idx = pHeaderIndex(yearCol);
    const years = new Set();
    rows.forEach((r) => {
      const v = (r[idx] || "").toString().trim();
      if (v) years.add(v);
    });
    const sorted = Array.from(years).sort();
    yearFilter.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "All years";
    yearFilter.appendChild(opt0);
    sorted.forEach((y) => {
      const opt = document.createElement("option");
      opt.value = y;
      opt.textContent = y;
      yearFilter.appendChild(opt);
    });
  }

  // Populate city filter
  if (cityFilter && cityCol) {
    const idx = pHeaderIndex(cityCol);
    const cities = new Set();
    rows.forEach((r) => {
      const v = (r[idx] || "").toString().trim();
      if (v) cities.add(v);
    });
    const sorted = Array.from(cities).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" })
    );
    cityFilter.innerHTML = "";
    const opt0 = document.createElement("option");
    opt0.value = "";
    opt0.textContent = "All cities";
    cityFilter.appendChild(opt0);
    sorted.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      cityFilter.appendChild(opt);
    });
  }
function updateFeasZoneOptions() {
  const citySelect = document.getElementById("feasCity");
  const zoneSelect = document.getElementById("feasZone");
  if (!zoneSelect) return;

  const city = (citySelect?.value || "").trim();

  zoneSelect.innerHTML = "";

  if (!city) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Select a city first";
    zoneSelect.appendChild(opt);
    zoneSelect.disabled = true;
    return;
  }

  const rows = state.zoning.byCity.get(city) || [];
  const zoneIdx = headerIndex("zone");
  const zones = new Set();

  if (zoneIdx !== -1) {
    rows.forEach((row) => {
      const z = (row[zoneIdx] || "").toString().trim();
      if (z) zones.add(z);
    });
  }

  const baseOption = document.createElement("option");
  baseOption.value = "";
  baseOption.textContent = zones.size
    ? "Any zone in this city"
    : "No zones found";
  zoneSelect.appendChild(baseOption);

  if (!zones.size) {
    zoneSelect.disabled = true;
    return;
  }

  zones.forEach((z) => {
    const opt = document.createElement("option");
    opt.value = z;
    opt.textContent = z;
    zoneSelect.appendChild(opt);
  });

  zoneSelect.disabled = false;
}

  // Pagination + filter listeners
  const yearFilterEl = document.getElementById("permitsYearFilter");
  const cityFilterEl = document.getElementById("permitsCityFilter");
  const clearBtn = document.getElementById("permitsClearFilters");
  const prevBtn = document.getElementById("permitsPrev");
  const nextBtn = document.getElementById("permitsNext");

  // Page size + initial page
  state.permits.pageSize = 5;
  if (typeof state.permits.currentPage !== "number") {
    state.permits.currentPage = 1;
  }

  // Filters reset to page 1
  if (yearFilterEl) {
    yearFilterEl.addEventListener("change", () => {
      state.permits.currentPage = 1;
      renderPermits();
    });
  }
  if (cityFilterEl) {
    cityFilterEl.addEventListener("change", () => {
      state.permits.currentPage = 1;
      renderPermits();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (yearFilterEl) yearFilterEl.value = "";
      if (cityFilterEl) cityFilterEl.value = "";
      state.permits.filteredRows = state.permits.rows.slice();
      state.permits.currentPage = 1;
      renderPermits();
    });
  }

  // Prev / Next arrows
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (!state.initialized.permitsLoaded) return;
      const current = state.permits.currentPage || 1;
      if (current > 1) {
        state.permits.currentPage = current - 1;
        renderPermits();
      }
    });
  }

  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (!state.initialized.permitsLoaded) return;
      const pageSize = state.permits.pageSize || 5;
      const total =
        (state.permits.filteredRows && state.permits.filteredRows.length) ||
        state.permits.rows.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const current = state.permits.currentPage || 1;
      if (current < totalPages) {
        state.permits.currentPage = current + 1;
        renderPermits();
      }
    });
  }
}

function renderPermits() {
  const tbody = document.getElementById("permitsTableBody");
  const summary = document.getElementById("permitsSummary");
  const emptyState = document.getElementById("permitsEmpty");
  const prevBtn = document.getElementById("permitsPrev");
  const nextBtn = document.getElementById("permitsNext");
  const pageLabel = document.getElementById("permitsPageLabel");

  if (!tbody || !state.initialized.permitsLoaded) return;

  const rows = state.permits.rows;
  const headers = state.permits.headers;
  let filtered = rows.slice();

  const yearCol = state.permits.yearCol;
  const cityCol = state.permits.cityCol;

  const yearFilterVal =
    (document.getElementById("permitsYearFilter")?.value || "").trim();
  const cityFilterVal =
    (document.getElementById("permitsCityFilter")?.value || "").trim();

  // Apply filters
  if (yearCol && yearFilterVal) {
    const idx = pHeaderIndex(yearCol);
    filtered = filtered.filter(
      (r) => (r[idx] || "").toString().trim() === yearFilterVal
    );
  }
  if (cityCol && cityFilterVal) {
    const idx = pHeaderIndex(cityCol);
    filtered = filtered.filter(
      (r) => (r[idx] || "").toString().trim() === cityFilterVal
    );
  }

  // Keep a copy of the current filtered set for pagination calculations
  state.permits.filteredRows = filtered;

  tbody.innerHTML = "";

  // No results
  if (!filtered.length) {
    if (emptyState) emptyState.hidden = false;
    if (summary) {
      summary.textContent =
        "No permits match the selected filters in the current dataset.";
    }
    if (pageLabel) pageLabel.textContent = "No permits";
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  if (emptyState) emptyState.hidden = true;

  // Pagination math
  const pageSize = state.permits.pageSize || 5;
  let currentPage = state.permits.currentPage || 1;
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (currentPage > totalPages) currentPage = totalPages;
  if (currentPage < 1) currentPage = 1;
  state.permits.currentPage = currentPage;

  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, total);
  const rowsToRender = filtered.slice(startIndex, endIndex);

  // Render only the current "page"
  const maxCols = Math.min(headers.length, 6);
  rowsToRender.forEach((row) => {
    const tr = document.createElement("tr");
    for (let i = 0; i < maxCols; i++) {
      const td = document.createElement("td");
      td.textContent = row[i] || "—";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  // Update summary + pagination UI
  if (summary) {
    summary.textContent = `Showing ${startIndex + 1}–${endIndex} of ${total} permit(s).`;
  }
  if (pageLabel) {
    pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;
  }
  if (prevBtn) {
    prevBtn.disabled = currentPage <= 1;
  }
  if (nextBtn) {
    nextBtn.disabled = currentPage >= totalPages;
  }
}


// =========================================
// INIT
// =========================================

async function initApp() {
  const summary = document.getElementById("summary");

  try {
    await loadZoningData();
  } catch (err) {
    console.error("Error loading zoning data:", err);
    if (summary) {
      summary.textContent =
        "Error loading zoning data. Check that data.csv exists next to index.html and that it is published.";
    }
    // Even if zoning fails, still try to render permits.
    try {
      await loadPermitsData();
      initPermitsFilters();
      renderPermits();
    } catch (permErr) {
      console.warn("Permits also failed to load:", permErr);
    }
    return;
  }

  // At this point zoning is loaded.
  try {
    await loadPermitsData();
  } catch (err) {
    console.warn("Error loading permits data (non-fatal):", err);
  }

  // Initialize UI that depends on zoning data
  initRegulationsFilters();
  initRegulationsUI();
  renderCityScorecards();
  initFeasibility();

  // Permits UI
  if (state.initialized.permitsLoaded) {
    initPermitsFilters();
    renderPermits();
  }
}

// Attach once DOM is ready
document.addEventListener("DOMContentLoaded", initApp);
