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
    state.permits.rows = rows.slice(1).filter((r) =>
      r.some((cell) => cell && String(cell).trim() !== "")
    );
    state.permits.filteredRows = state.permits.rows.slice();
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

// REPLACE YOUR buildTableHeader AND renderRegulationsTable FUNCTIONS WITH THESE:

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

  // Render each row
  rows.forEach((row) => {
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
    if (rows.length === total) {
      summary.textContent = `Showing all ${rows.length} regulation(s).`;
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

// REPLACE YOUR renderCityScorecards FUNCTION WITH THIS:

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
  container.addEventListener("click", (e) => {
    const btn = e.target.closest(".scorecard-btn");
    if (!btn) return;
    const city = btn.getAttribute("data-city");
    if (!city) return;

    const cityFilter = document.getElementById("cityFilter");
    if (cityFilter) {
      cityFilter.value = city;
      if (state.ui.selectAllCities) {
        state.ui.selectAllCities.checked = false;
        cityFilter.disabled = false;
      }
    }
    performRegulationsSearch();
    const regsSection = document.getElementById("regulations");
    if (regsSection && regsSection.scrollIntoView) {
      regsSection.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  });
}

// =========================================
// LOT-LEVEL FEASIBILITY (HIGH-LEVEL CHECK)
// =========================================

function runFeasibilityCheck() {
  if (!state.initialized.zoningLoaded) return;

  const city = (document.getElementById("feasCity")?.value || "").trim();

  // Lot size can be entered directly or approximated from house width/depth.
  const lotSizeInput =
    (document.getElementById("feasLotSize")?.value || "").trim();
  let lotSize = parseFloat(lotSizeInput.replace(/[^0-9.\-]/g, ""));

  if (isNaN(lotSize)) {
    const wStr =
      (document.getElementById("feasHouseWidth")?.value || "").trim();
    const dStr =
      (document.getElementById("feasHouseDepth")?.value || "").trim();
    const w = parseFloat(wStr.replace(/[^0-9.\-]/g, ""));
    const d = parseFloat(dStr.replace(/[^0-9.\-]/g, ""));
    if (!isNaN(w) && !isNaN(d)) {
      lotSize = w * d;
    }
  }

  const aduSizeStr =
    (document.getElementById("feasADUSize")?.value || "").trim();
  const aduSize = parseFloat(aduSizeStr.replace(/[^0-9.\-]/g, ""));

  const resultEl = document.getElementById("feasResult");
  const diagram = document.getElementById("feasDiagram");

  if (!city || isNaN(lotSize) || isNaN(aduSize)) {
    if (resultEl) {
      resultEl.textContent =
        "Enter a city, approximate lot size (or house width × depth), and ADU size to run a quick feasibility screen.";
    }
    return;
  }

  const rows = state.zoning.byCity.get(city) || [];
  if (!rows.length) {
    if (resultEl) {
      resultEl.textContent =
        "No zoning rows found for this city in the current dataset.";
    }
    return;
  }

  // For now, take the "least restrictive" row for this city as a simple heuristic.
  let bestRow = rows[0];
  let bestScore = -Infinity;

  rows.forEach((row) => {
    const minLot = getNumeric(row, "minLotSize");
    const maxSize = getNumeric(row, "maxADUSize");
    const adu = getCell(row, "aduAllowed").toLowerCase();
    const dadu = getCell(row, "daduAllowed").toLowerCase();

    let s = 0;
    if (!isNaN(minLot) && lotSize >= minLot) s += 2;
    if (!isNaN(maxSize) && aduSize <= maxSize) s += 2;
    if (adu.includes("yes")) s += 1;
    if (dadu.includes("yes")) s += 0.5;

    if (s > bestScore) {
      bestScore = s;
      bestRow = row;
    }
  });

  const minLot = getNumeric(bestRow, "minLotSize");
  const maxSize = getNumeric(bestRow, "maxADUSize");
  const adu = getCell(bestRow, "aduAllowed");
  const dadu = getCell(bestRow, "daduAllowed");
  const owner = getCell(bestRow, "ownerOcc");

  let message = "";
  let status = "unknown";

  const lotOK = !isNaN(minLot) ? lotSize >= minLot : true;
  const sizeOK = !isNaN(maxSize) ? aduSize <= maxSize : true;
  const aduYes = adu.toLowerCase().includes("yes");

  if (!aduYes) {
    status = "no";
    message = `ADUs are not clearly allowed in the most favorable zone row for ${city} in this dataset. Further code review is required.`;
  } else if (lotOK && sizeOK) {
    status = "yes";
    message = `This lot and ADU size appear generally feasible in at least one zone row for ${city}, assuming other standards (setbacks, parking, design) can be met.`;
  } else if (!lotOK && sizeOK) {
    status = "maybe";
    message = `ADU size is within typical limits, but the lot size is below at least one minimum recorded in this dataset. Variances, overlays, or updated code may still allow it.`;
  } else if (lotOK && !sizeOK) {
    status = "maybe";
    message = `Lot size meets a typical minimum, but the ADU size exceeds at least one maximum recorded in this dataset. A smaller ADU may be more feasible.`;
  } else {
    status = "no";
    message = `Both lot size and ADU size fall outside at least one key standard in this dataset. A more detailed code review is needed.`;
  }

  if (owner) {
    message += ` Owner-occupancy in this zone is recorded as: ${owner}.`;
  }

  if (resultEl) {
    resultEl.textContent = message;
    resultEl.dataset.status = status;
  }

  // Diagram tweaks (non-fatal if missing)
  if (diagram) {
    diagram.dataset.status = status;
  }

  const buildableRect = document.getElementById("buildableRect");
  const aduRect = document.getElementById("aduRect");
  const buildableLabel = document.getElementById("buildableLabel");
  const aduLabel = document.getElementById("aduLabel");

  if (buildableRect && aduRect) {
    const lotScale = Math.max(Math.min(lotSize / 10000, 2), 0.3);
    const aduScale = Math.max(Math.min(aduSize / 800, 2), 0.2);

    buildableRect.style.transform = `scale(${lotScale})`;
    aduRect.style.transform = `scale(${aduScale})`;
  }

  if (buildableLabel) {
    buildableLabel.textContent = `Lot: ${isNaN(lotSize) ? "?" : lotSize} sf`;
  }
  if (aduLabel) {
    aduLabel.textContent = `ADU: ${isNaN(aduSize) ? "?" : aduSize} sf`;
  }
}

function initFeasibility() {
  const runBtn = document.getElementById("runFeasibility");
  if (runBtn) {
    runBtn.addEventListener("click", (e) => {
      e.preventDefault();
      runFeasibilityCheck();
    });
  }

  const feasCity = document.getElementById("feasCity");
  if (feasCity) {
    // Populate with cities from zoning dataset, once loaded
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

  const yearFilterEl = document.getElementById("permitsYearFilter");
  const cityFilterEl = document.getElementById("permitsCityFilter");
  const clearBtn = document.getElementById("permitsClearFilters");

  if (yearFilterEl) {
    yearFilterEl.addEventListener("change", () => {
      renderPermits();
    });
  }
  if (cityFilterEl) {
    cityFilterEl.addEventListener("change", () => {
      renderPermits();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (yearFilterEl) yearFilterEl.value = "";
      if (cityFilterEl) cityFilterEl.value = "";
      state.permits.filteredRows = state.permits.rows.slice();
      renderPermits();
    });
  }
}

function renderPermits() {
  const tbody = document.getElementById("permitsTableBody");
  const summary = document.getElementById("permitsSummary");
  const emptyState = document.getElementById("permitsEmpty");

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

  tbody.innerHTML = "";

  if (!filtered.length) {
    if (emptyState) emptyState.hidden = false;
    if (summary)
      summary.textContent =
        "No permits match the selected filters in the current dataset.";
    return;
  }

  if (emptyState) emptyState.hidden = true;

  // Show up to first 6 columns for clarity
  const maxCols = Math.min(headers.length, 6);
  filtered.forEach((row) => {
    const tr = document.createElement("tr");
    for (let i = 0; i < maxCols; i++) {
      const td = document.createElement("td");
      td.textContent = row[i] || "—";
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  if (summary) {
    summary.textContent = `${filtered.length} permit(s) shown.`;
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
