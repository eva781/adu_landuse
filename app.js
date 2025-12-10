"use strict";

/* =========================================================
   CONFIG & COLUMN MAPPING
   ========================================================= */

const ZONING_CSV_URL = "data.csv";
const PERMITS_CSV_URL = "adu_permits.csv";

const COL = {
  city: "City",
  county: "County",
  state: "State",
  zone: "Zone",
  zoneType: "Zone_Type",
  aduAllowed: "ADU_Allowed",
  daduAllowed: "DADU_Allowed",
  aduType: "ADU_Type",
  ownerOcc: "Owner_Occupancy",
  minLotSize: "Min_Lot_Size_sf",
  maxADUSize: "Max_ADU_Size_sf",
  maxDADUSize: "Max_DADU_Size_sf",
  maxFAR: "Max_FAR",
  maxLotCoverage: "Max_Lot_Coverage",
  maxHeight: "Max_Building_Height_ft",
  aduParking: "ADU_Parking",
  aduParkingTransitExempt: "ADU_Parking_Transit_Exempt",
  greenscape: "Greenscape_Notes",
  impactFees: "Impact_Fees",
  lastReviewed: "Last_Reviewed",
  daduRear: "DADU_Rear_Setback_ft",
  daduSideLotLine: "DADU_Side_Lot_Line_Setback_ft",
  daduStreetSide: "DADU_Street_Side_Setback_ft",
  daduFromPrincipal: "DADU_Separation_From_Principal_ft"
};

/* =========================================================
   GLOBAL STATE
   ========================================================= */

const state = {
  zoning: {
    headers: [],
    rows: [],
    byCity: new Map() // city -> rows[]
  },
  permits: {
    headers: [],
    rows: [],
    filtered: [],
    currentPage: 1,
    pageSize: 5
  },
  initialized: {
    zoningLoaded: false,
    permitsLoaded: false
  },
  ui: {
    selectAllCities: null,
    cityFilter: null,
    zoneFilter: null,
    zoneTypeFilter: null,
    aduFilter: null,
    daduFilter: null,
    ownerOccFilter: null,
    searchInput: null,
    regTableBody: null,
    regResultsPlaceholder: null,
    regTableWrapper: null,
    scorecardContainer: null,
    permitsCityFilter: null,
    permitsYearFilter: null,
    permitsSummary: null,
    permitsTableBody: null,
    permitsPagerLabel: null,
    permitsPrevBtn: null,
    permitsNextBtn: null
  }
};

/* =========================================================
   CSV PARSER (ROBUST ENOUGH FOR QUOTED COMMAS)
   ========================================================= */

function parseCSV(text) {
  const rows = [];
  let row = [];
  let value = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (c === '"') {
      // Escaped quote
      if (inQuotes && text[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (c === "," && !inQuotes) {
      row.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !inQuotes) {
      if (value !== "" || row.length > 0) {
        row.push(value);
        rows.push(row);
        row = [];
        value = "";
      }
      // swallow CRLF pairs
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else {
      value += c;
    }
  }

  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }

  return rows.filter(r => r.length && !(r.length === 1 && r[0].trim() === ""));
}

/* =========================================================
   GENERIC HELPERS
   ========================================================= */

function safeText(s) {
  if (s == null) return "";
  return String(s);
}

// Use header text instead of raw index; tolerant of case/spacing
function headerIndex(colKey) {
  if (!state.zoning.headers || !COL[colKey]) return -1;
  return state.zoning.headers.findIndex(
    h =>
      h &&
      h.toString().toLowerCase().trim() === COL[colKey].toLowerCase().trim()
  );
}

function getCell(row, colKey) {
  if (!row) return "";
  const idx = headerIndex(colKey);
  if (idx === -1) return "";
  return safeText(row[idx]).trim();
}

function getNumeric(row, colKey) {
  const raw = getCell(row, colKey);
  if (!raw) return NaN;
  const cleaned = raw.replace(/[^0-9.\-]/g, "");
  return cleaned ? parseFloat(cleaned) : NaN;
}

/* =========================================================
   DATA LOADING
   ========================================================= */

async function loadZoningCsv() {
  try {
    const resp = await fetch(ZONING_CSV_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const rows = parseCSV(text);
    if (!rows.length) throw new Error("No rows in zoning CSV");

    const [headerRow, ...dataRows] = rows;
    state.zoning.headers = headerRow;
    state.zoning.rows = dataRows;

    // Group by city
    const cityIdx = state.zoning.headers.findIndex(
      h => h && h.toLowerCase().trim() === COL.city.toLowerCase().trim()
    );
    state.zoning.byCity.clear();

    dataRows.forEach(r => {
      const cityName = safeText(r[cityIdx] || "").trim();
      if (!cityName) return;
      if (!state.zoning.byCity.has(cityName)) {
        state.zoning.byCity.set(cityName, []);
      }
      state.zoning.byCity.get(cityName).push(r);
    });

    state.initialized.zoningLoaded = true;
  } catch (err) {
    console.error("Error loading zoning CSV:", err);
  }
}

async function loadPermitsCsv() {
  try {
    const resp = await fetch(PERMITS_CSV_URL, { cache: "no-store" });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const text = await resp.text();
    const rows = parseCSV(text);
    if (!rows.length) throw new Error("No rows in permits CSV");

    const [headerRow, ...dataRows] = rows;
    state.permits.headers = headerRow;

    // Try to determine year column from headers
    const h = headerRow.map(hd => hd.toString().toLowerCase());
    const yearIdx = h.findIndex(hd => hd.includes("year"));
    const approvalIdx = h.findIndex(
      hd =>
        (hd.includes("approval") && hd.includes("date")) ||
        (hd.includes("issued") && hd.includes("date"))
    );

    const filtered = [];

    dataRows.forEach(r => {
      let year = NaN;

      if (yearIdx !== -1) {
        year = parseInt((r[yearIdx] || "").toString().slice(0, 4), 10);
      } else if (approvalIdx !== -1) {
        const raw = safeText(r[approvalIdx]);
        const match = raw.match(/(20[0-9]{2})/);
        if (match) year = parseInt(match[1], 10);
      }

      if (!isNaN(year) && year >= 2024 && year <= 2025) {
        // Only keep 2024–2025 permits
        filtered.push(r);
      }
    });

    state.permits.rows = filtered;
    state.permits.filtered = filtered.slice();
    state.initialized.permitsLoaded = true;
  } catch (err) {
    console.error("Error loading permits CSV:", err);
  }
}

/* =========================================================
   SCORECARDS
   ========================================================= */

function computeCityMetrics(cityRows) {
  const n = cityRows.length;
  if (!n) return { n: 0, aduYes: 0, daduYes: 0, score: 0, grade: "—" };

  let aduYes = 0;
  let daduYes = 0;

  cityRows.forEach(r => {
    const adu = getCell(r, "aduAllowed").toLowerCase();
    const dadu = getCell(r, "daduAllowed").toLowerCase();
    if (adu.includes("yes")) aduYes++;
    if (dadu.includes("yes")) daduYes++;
  });

  const aduRatio = aduYes / n;
  const daduRatio = daduYes / n;
  const score = Math.round((aduRatio * 0.6 + daduRatio * 0.4) * 100);

  let grade = "C";
  if (score >= 90) grade = "A+";
  else if (score >= 80) grade = "A";
  else if (score >= 70) grade = "B";
  else if (score >= 60) grade = "B-";
  else if (score >= 50) grade = "C+";
  else if (score >= 40) grade = "C";
  else if (score >= 30) grade = "D";
  else grade = "F";

  return { n, aduYes, daduYes, score, grade };
}

function renderCityScorecards() {
  const container = document.getElementById("cityScorecards");
  state.ui.scorecardContainer = container;
  if (!container || !state.initialized.zoningLoaded) return;

  container.innerHTML = "";

  const cities = Array.from(state.zoning.byCity.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );

  cities.forEach(city => {
    const rows = state.zoning.byCity.get(city) || [];
    const metrics = computeCityMetrics(rows);

    const card = document.createElement("article");
    card.className = "scorecard-item city-card";
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `Filter regulations table for ${city}`);

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

    card.style.cursor = "pointer";
    const activate = () => {
      const cityFilter = document.getElementById("cityFilter");
      if (cityFilter) {
        cityFilter.value = city;
        if (state.ui.selectAllCities) {
          state.ui.selectAllCities.checked = false;
          cityFilter.disabled = false;
        }
      }
      performRegulationsSearch();

      const regsSection = document.querySelector(".filters-card");
      if (regsSection && regsSection.scrollIntoView) {
        regsSection.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };

    card.addEventListener("click", activate);
    card.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        activate();
      }
    });

    container.appendChild(card);
  });
}

/* =========================================================
   REGULATIONS TABLE + FILTERS
   ========================================================= */

function initRegulationsUI() {
  state.ui.selectAllCities = document.getElementById("selectAllCities");
  state.ui.cityFilter = document.getElementById("cityFilter");
  state.ui.zoneFilter = document.getElementById("zoneFilter");
  state.ui.zoneTypeFilter = document.getElementById("zoneTypeFilter");
  state.ui.aduFilter = document.getElementById("aduFilter");
  state.ui.daduFilter = document.getElementById("daduFilter");
  state.ui.ownerOccFilter = document.getElementById("ownerOccFilter");
  state.ui.searchInput = document.getElementById("searchInput");
  state.ui.regTableWrapper = document.querySelector(
    ".reg-table-wrapper"
  );
  state.ui.regResultsPlaceholder =
    document.querySelector(".reg-results-placeholder");
  const regTable = document.querySelector(".reg-table");
  state.ui.regTableBody = regTable
    ? regTable.querySelector("tbody")
    : null;

  if (!state.initialized.zoningLoaded) return;

  // Populate filter options from dataset
  populateFilterSelect(state.ui.cityFilter, state.zoning.rows, COL.city);
  populateFilterSelect(
    state.ui.zoneTypeFilter,
    state.zoning.rows,
    COL.zoneType
  );
  populateFilterSelect(
    state.ui.aduFilter,
    state.zoning.rows,
    COL.aduAllowed
  );
  populateFilterSelect(
    state.ui.daduFilter,
    state.zoning.rows,
    COL.daduAllowed
  );
  populateFilterSelect(
    state.ui.ownerOccFilter,
    state.zoning.rows,
    COL.ownerOcc
  );

  // Zone filter will be populated dynamically after city selection
  if (state.ui.zoneFilter) {
    state.ui.zoneFilter.innerHTML = "";
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "All zones";
    state.ui.zoneFilter.appendChild(opt);
  }

  if (state.ui.selectAllCities && state.ui.cityFilter) {
    state.ui.selectAllCities.addEventListener("change", e => {
      const checked = e.target.checked;
      state.ui.cityFilter.disabled = checked;
      if (checked) {
        state.ui.cityFilter.value = "";
        // When all cities are selected, zone options should be global again
        populateZoneFilterForCity("");
      }
    });
  }

  if (state.ui.cityFilter) {
    state.ui.cityFilter.addEventListener("change", () => {
      const cityVal = state.ui.cityFilter.value;
      populateZoneFilterForCity(cityVal);
    });
  }

  const searchBtn = document.getElementById("searchRegulationsBtn");
  const clearBtn = document.getElementById("clearFilters");

  if (searchBtn) {
    searchBtn.addEventListener("click", performRegulationsSearch);
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (state.ui.selectAllCities) {
        state.ui.selectAllCities.checked = false;
      }
      if (state.ui.cityFilter) {
        state.ui.cityFilter.disabled = false;
        state.ui.cityFilter.value = "";
      }
      if (state.ui.zoneFilter) state.ui.zoneFilter.value = "";
      if (state.ui.zoneTypeFilter) state.ui.zoneTypeFilter.value = "";
      if (state.ui.aduFilter) state.ui.aduFilter.value = "";
      if (state.ui.daduFilter) state.ui.daduFilter.value = "";
      if (state.ui.ownerOccFilter) state.ui.ownerOccFilter.value = "";
      if (state.ui.searchInput) state.ui.searchInput.value = "";
      populateZoneFilterForCity("");
      performRegulationsSearch();
    });
  }

  // Initial population: show all rows but only after user explicitly searches
}

function populateFilterSelect(selectEl, rows, headerLabel) {
  if (!selectEl) return;
  const headerIdx = state.zoning.headers.findIndex(
    h => h && h.toString().toLowerCase().trim() === headerLabel.toLowerCase().trim()
  );
  if (headerIdx === -1) return;

  const values = Array.from(
    new Set(
      rows
        .map(r => safeText(r[headerIdx]).trim())
        .filter(v => v)
    )
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  selectEl.innerHTML = "";
  const baseOpt = document.createElement("option");
  baseOpt.value = "";
  baseOpt.textContent = "Any";
  selectEl.appendChild(baseOpt);

  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

function populateZoneFilterForCity(city) {
  if (!state.ui.zoneFilter || !state.initialized.zoningLoaded) return;

  const zoneHeaderIdx = state.zoning.headers.findIndex(
    h => h && h.toString().toLowerCase().trim() === COL.zone.toLowerCase().trim()
  );
  const cityHeaderIdx = state.zoning.headers.findIndex(
    h => h && h.toString().toLowerCase().trim() === COL.city.toLowerCase().trim()
  );

  if (zoneHeaderIdx === -1) return;

  let rows = state.zoning.rows;
  if (city && cityHeaderIdx !== -1) {
    rows = rows.filter(
      r =>
        safeText(r[cityHeaderIdx]).trim().toLowerCase() ===
        city.toLowerCase()
    );
  }

  const zones = Array.from(
    new Set(
      rows.map(r => safeText(r[zoneHeaderIdx]).trim()).filter(z => z)
    )
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

  state.ui.zoneFilter.innerHTML = "";
  const baseOpt = document.createElement("option");
  baseOpt.value = "";
  baseOpt.textContent = city ? "All zones in city" : "All zones";
  state.ui.zoneFilter.appendChild(baseOpt);

  zones.forEach(z => {
    const opt = document.createElement("option");
    opt.value = z;
    opt.textContent = z;
    state.ui.zoneFilter.appendChild(opt);
  });
}

function performRegulationsSearch() {
  if (!state.initialized.zoningLoaded) return;
  if (!state.ui.regTableBody) return;

  const cityVal = state.ui.cityFilter
    ? state.ui.cityFilter.value.trim().toLowerCase()
    : "";
  const zoneVal = state.ui.zoneFilter
    ? state.ui.zoneFilter.value.trim().toLowerCase()
    : "";
  const zoneTypeVal = state.ui.zoneTypeFilter
    ? state.ui.zoneTypeFilter.value.trim().toLowerCase()
    : "";
  const aduVal = state.ui.aduFilter
    ? state.ui.aduFilter.value.trim().toLowerCase()
    : "";
  const daduVal = state.ui.daduFilter
    ? state.ui.daduFilter.value.trim().toLowerCase()
    : "";
  const ownerVal = state.ui.ownerOccFilter
    ? state.ui.ownerOccFilter.value.trim().toLowerCase()
    : "";
  const searchTerm = state.ui.searchInput
    ? state.ui.searchInput.value.trim().toLowerCase()
    : "";

  const cityIdx = headerIndex("city");
  const zoneIdx = headerIndex("zone");
  const zoneTypeIdx = headerIndex("zoneType");
  const aduIdx = headerIndex("aduAllowed");
  const daduIdx = headerIndex("daduAllowed");
  const ownerIdx = headerIndex("ownerOcc");

  let filtered = state.zoning.rows.filter(row => {
    if (cityVal && cityIdx !== -1) {
      const v = safeText(row[cityIdx]).trim().toLowerCase();
      if (v !== cityVal) return false;
    }
    if (zoneVal && zoneIdx !== -1) {
      const v = safeText(row[zoneIdx]).trim().toLowerCase();
      if (v !== zoneVal) return false;
    }
    if (zoneTypeVal && zoneTypeIdx !== -1) {
      const v = safeText(row[zoneTypeIdx]).trim().toLowerCase();
      if (v !== zoneTypeVal) return false;
    }
    if (aduVal && aduIdx !== -1) {
      const v = safeText(row[aduIdx]).trim().toLowerCase();
      if (v !== aduVal) return false;
    }
    if (daduVal && daduIdx !== -1) {
      const v = safeText(row[daduIdx]).trim().toLowerCase();
      if (v !== daduVal) return false;
    }
    if (ownerVal && ownerIdx !== -1) {
      const v = safeText(row[ownerIdx]).trim().toLowerCase();
      if (v !== ownerVal) return false;
    }

    if (searchTerm) {
      const hay = row.join(" ").toLowerCase();
      if (!hay.includes(searchTerm)) return false;
    }

    return true;
  });

  const tbody = state.ui.regTableBody;
  tbody.innerHTML = "";

  if (!filtered.length) {
    if (state.ui.regResultsPlaceholder) {
      state.ui.regResultsPlaceholder.style.display = "block";
    }
    if (state.ui.regTableWrapper) {
      state.ui.regTableWrapper.classList.add("hidden");
    }
    return;
  }

  if (state.ui.regResultsPlaceholder) {
    state.ui.regResultsPlaceholder.style.display = "none";
  }
  if (state.ui.regTableWrapper) {
    state.ui.regTableWrapper.classList.remove("hidden");
  }

  // Render full header row dynamically so all columns show
  const regTable = tbody.closest("table");
  if (regTable) {
    const thead = regTable.querySelector("thead");
    if (thead) {
      thead.innerHTML = "";
      const tr = document.createElement("tr");
      state.zoning.headers.forEach(h => {
        const th = document.createElement("th");
        th.textContent = safeText(h);
        tr.appendChild(th);
      });
      thead.appendChild(tr);
    }
  }

  // Render body
  filtered.forEach(row => {
    const tr = document.createElement("tr");
    state.zoning.headers.forEach((_, idx) => {
      const td = document.createElement("td");
      td.textContent = safeText(row[idx]);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

/* =========================================================
   LOT-LEVEL FEASIBILITY CHECKER
   ========================================================= */

function buildFeasDiagramShell() {
  const container = document.getElementById("feasDiagram");
  if (!container) return;
  if (container.dataset.initialized === "true") return;
  container.dataset.initialized = "true";

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

        <div class="resize-handle lot-width-handle" id="lotWidthHandle" title="Lot width"></div>
        <div class="resize-handle lot-depth-handle" id="lotDepthHandle" title="Lot depth"></div>
      </div>
    </div>
  `;

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

// Data → diagram geometry, incorporating setbacks
// Render the visual diagram based on lot + zone snapshot
function renderFeasibilityDiagram({
  lotSize,
  lotWidth,
  lotDepth,
  houseWidth,
  houseDepth,
  aduSize,
  status,
  hasAlley,
  zoneRow, // <- new
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

  // --- Normalize lot size ---------------------------------------------------
  const effectiveLotSize =
    !isNaN(lotSize) && lotSize > 0 ? lotSize : 4000; // fallback if blank

  if (lotLabel) {
    lotLabel.textContent = `Lot • ${effectiveLotSize.toLocaleString()} sf${
      lotWidth && lotDepth ? ` (${lotWidth}′ × ${lotDepth}′)` : ""
    }`;
  }

  // --- Lot & building scaling ----------------------------------------------
  const baseLot = Math.max(effectiveLotSize, 2000);
  const lotScale = Math.sqrt(effectiveLotSize / baseLot);

  const primaryScale =
    houseWidth && houseDepth
      ? Math.sqrt((houseWidth * houseDepth) / 1000)
      : 1;

  const primaryWidthPct = Math.min(40 * primaryScale, 60);
  const primaryDepthPct = Math.min(35 * primaryScale, 50);

  // --- Buildable envelope from coverage + setbacks -------------------------
  let buildableWidthPct = 80;
  let buildableDepthPct = 60;

  if (zoneRow) {
    // 1) Coverage: max footprint as a fraction of lot area
    const coveragePct = getNumeric(zoneRow, "maxLotCoverage"); // 0–100 or NaN

    if (!isNaN(coveragePct) && coveragePct > 0 && coveragePct <= 100) {
      const coverageRatio = coveragePct / 100;
      const approxFootprintRatio = Math.sqrt(coverageRatio);
      buildableWidthPct = Math.max(
        30,
        Math.min(90, approxFootprintRatio * 100)
      );
      buildableDepthPct = Math.max(
        30,
        Math.min(90, approxFootprintRatio * 70)
      );
    }

    // 2) Setbacks: shrink in from lot edges when we know width/depth
    const frontSetback = getNumeric(zoneRow, "frontSetback");
    const rearSetback = getNumeric(zoneRow, "rearSetback");
    const sideSetback = getNumeric(zoneRow, "sideSetback");
    const streetSideSetback = getNumeric(zoneRow, "streetSideSetback");

    if (lotWidth && lotDepth) {
      const left = !isNaN(sideSetback) ? sideSetback : 0;
      const right = !isNaN(streetSideSetback) ? streetSideSetback : left;
      const front = !isNaN(frontSetback) ? frontSetback : 0;
      const rear = !isNaN(rearSetback) ? rearSetback : front;

      const horizInsetPct = ((left + right) / lotWidth) * 100;
      const vertInsetPct = ((front + rear) / lotDepth) * 100;

      if (!isNaN(horizInsetPct) && horizInsetPct < 100) {
        buildableWidthPct = Math.max(
          20,
          Math.min(buildableWidthPct, 100 - horizInsetPct)
        );
      }
      if (!isNaN(vertInsetPct) && vertInsetPct < 100) {
        buildableDepthPct = Math.max(
          20,
          Math.min(buildableDepthPct, 100 - vertInsetPct)
        );
      }
    }
  }

  // Position buildable envelope centered within the 70% lot height
  buildableRect.style.width = `${buildableWidthPct}%`;
  buildableRect.style.height = `${buildableDepthPct}%`;
  buildableRect.style.left = `${(100 - buildableWidthPct) / 2}%`;
  buildableRect.style.top = `${(70 - buildableDepthPct) / 2}%`;

  // Primary house – biased toward "front" (bottom) of parcel
  primaryRect.style.width = `${primaryWidthPct}%`;
  primaryRect.style.height = `${primaryDepthPct}%`;
  primaryRect.style.left = "10%";
  primaryRect.style.bottom = "10%";

  // ADU – generally at rear; if alley, hug the alley side more clearly
  const aduWidthPct = Math.min(primaryWidthPct * 0.7, 35);
  const aduDepthPct = Math.min(primaryDepthPct * 0.7, 35);

  aduRect.style.width = `${aduWidthPct}%`;
  aduRect.style.height = `${aduDepthPct}%`;
  aduRect.style.right = hasAlley ? "5%" : "10%";
  aduRect.style.top = hasAlley ? "10%" : "20%";
  aduRect.dataset.hasAlley = hasAlley ? "true" : "false";

  // Labels
  if (buildableLabel) {
    buildableLabel.textContent = "Buildable envelope (conceptual)";
  }

  if (primaryLabel) {
    primaryLabel.textContent = `Primary home${
      houseWidth && houseDepth ? ` · ${houseWidth}′ × ${houseDepth}′` : ""
    }`;
  }

  if (aduLabel) {
    const aduText =
      aduSize && !isNaN(aduSize)
        ? `ADU • ~${aduSize.toLocaleString()} sf`
        : "ADU footprint (approx.)";

    aduLabel.textContent = hasAlley
      ? `${aduText} · alley-loaded`
      : aduText;
  }

  container.dataset.status = status || "unknown";
}

// Detailed textual report
function renderFeasibilityDetails(zoneRow, context) {
  const detailsEl = document.getElementById("feasibilityDetails");
  if (!detailsEl) return;

  const {
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
    hasTransit,
    hasAlley
  } = context;

  const fmt = (v, suffix = "") =>
    isNaN(v) || v == null ? "—" : `${v.toLocaleString()}${suffix}`;

  const minLot = getNumeric(zoneRow, "minLotSize");
  const maxSize = getNumeric(zoneRow, "maxADUSize");
  const maxDADU = getNumeric(zoneRow, "maxDADUSize");
  const maxCoverage = getNumeric(zoneRow, "maxLotCoverage");
  const maxFar = getNumeric(zoneRow, "maxFAR");
  const maxHeight = getNumeric(zoneRow, "maxHeight");

  const aduAllowed = getCell(zoneRow, "aduAllowed");
  const daduAllowed = getCell(zoneRow, "daduAllowed");
  const ownerOcc = getCell(zoneRow, "ownerOcc");
  const parkingReq = getCell(zoneRow, "aduParking");
  const parkingTransit = getCell(zoneRow, "aduParkingTransitExempt");
  const greenscape = getCell(zoneRow, "greenscape");
  const impactFees = getCell(zoneRow, "impactFees");
  const lastReviewed = getCell(zoneRow, "lastReviewed");

  const rearStr = getCell(zoneRow, "daduRear");
  const sideStr = getCell(zoneRow, "daduSideLotLine");
  const streetStr = getCell(zoneRow, "daduStreetSide");
  const fromPrimaryStr = getCell(zoneRow, "daduFromPrincipal");

  let statusLabel = "Screening only";
  if (status === "yes") statusLabel = "Generally feasible (screening)";
  else if (status === "maybe") statusLabel = "Potentially feasible with caveats";
  else if (status === "no") statusLabel = "Not clearly feasible from this row";

  detailsEl.innerHTML = `
    <h3>Lot-level feasibility report</h3>
    <dl class="feasibility-metrics">
      <div class="feasibility-metric">
        <dt>Context</dt>
        <dd>
          City: ${safeText(city) || "—"}<br/>
          Zone: ${safeText(zone) || "—"}${
            zoneType ? ` (${safeText(zoneType)})` : ""
          }<br/>
          Screening status: ${statusLabel}
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>Lot &amp; existing home</dt>
        <dd>
          Lot size: ${fmt(lotSize, " sf")}<br/>
          Lot width × depth: ${fmt(lotWidth, " ft")} × ${fmt(
    lotDepth,
    " ft"
  )}<br/>
          Existing home: ${fmt(houseWidth, " ft")} × ${fmt(
    houseDepth,
    " ft"
  )}<br/>
          Target ADU size: ${fmt(aduSize, " sf")}
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>Key zoning standards (from dataset)</dt>
        <dd>
          Minimum lot size: ${fmt(minLot, " sf")}<br/>
          Maximum ADU size: ${fmt(maxSize, " sf")}<br/>
          Maximum detached ADU size: ${fmt(maxDADU, " sf")}<br/>
          Maximum lot coverage: ${
            isNaN(maxCoverage) ? "—" : `${maxCoverage}%`
          }<br/>
          Maximum FAR: ${isNaN(maxFar) ? "—" : maxFar}<br/>
          Maximum building height: ${fmt(maxHeight, " ft")}
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>ADU allowances</dt>
        <dd>
          ADU allowed: ${aduAllowed || "—"}<br/>
          Detached ADU allowed: ${daduAllowed || "—"}<br/>
          Owner-occupancy requirement: ${ownerOcc || "—"}
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>DADU setbacks &amp; separation</dt>
        <dd>
          Rear yard setback: ${rearStr || "—"}<br/>
          Side lot line setback: ${sideStr || "—"}<br/>
          Street-side setback: ${streetStr || "—"}<br/>
          Separation from primary: ${fromPrimaryStr || "—"}<br/>
          Alley access flagged in inputs: ${
            hasAlley ? "Yes (rear relaxed visually)" : "No"
          }
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>Parking</dt>
        <dd>
          ADU parking requirement: ${parkingReq || "—"}<br/>
          Transit-based relief (dataset): ${parkingTransit || "—"}<br/>
          Transit radius flag in inputs: ${
            hasTransit ? "Checked" : "Not checked"
          }
        </dd>
      </div>

      <div class="feasibility-metric">
        <dt>Landscape, fees &amp; notes</dt>
        <dd>
          Greenscape / open space notes: ${greenscape || "—"}<br/>
          Impact fees: ${impactFees || "—"}<br/>
          Dataset last reviewed: ${lastReviewed || "—"}
        </dd>
      </div>
    </dl>
    <p class="feasibility-disclaimer">
      This diagram and report are a simplified visual interpretation of the dataset you provided.
      They support feasibility screening only and do not replace a full zoning / building code review
      or direct confirmation with planning staff.
    </p>
  `;
}

function runFeasibilityCheck() {
  if (!state.initialized.zoningLoaded) return;

  try {
    const city = safeText(
      document.getElementById("feasCity")?.value || ""
    ).trim();
    const zone = safeText(
      document.getElementById("feasZone")?.value || ""
    ).trim();

    const lotSizeStr = safeText(
      document.getElementById("feasLotSize")?.value || ""
    ).trim();
    const lotWidthStr = safeText(
      document.getElementById("feasLotWidth")?.value || ""
    ).trim();
    const lotDepthStr = safeText(
      document.getElementById("feasLotDepth")?.value || ""
    ).trim();
    const houseWidthStr = safeText(
      document.getElementById("feasHouseWidth")?.value || ""
    ).trim();
    const houseDepthStr = safeText(
      document.getElementById("feasHouseDepth")?.value || ""
    ).trim();
    const aduSizeStr = safeText(
      document.getElementById("feasADUSize")?.value || ""
    ).trim();

    const hasTransit = !!document.getElementById("feasTransit")?.checked;
    const hasAlley = !!document.getElementById("feasAlley")?.checked;

    const parseNum = str => {
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

    // Approximate lot size from width × depth if needed
    if ((isNaN(lotSize) || !lotSize) && !isNaN(lotWidth) && !isNaN(lotDepth)) {
      lotSize = lotWidth * lotDepth;
    }

    const summaryEl = document.getElementById("feasibilitySummary");
    const detailsEl = document.getElementById("feasibilityDetails");
    const diagramEl = document.getElementById("feasDiagram");

    if (detailsEl) detailsEl.innerHTML = "";
    if (diagramEl) diagramEl.dataset.status = "";

    if (!city || !zone) {
      if (summaryEl) {
        summaryEl.innerHTML =
          "<p class='feasibility-headline' data-status='unknown'>Select a city and zone to run the lot-level feasibility check.</p>";
      }
      return;
    }

    const cityRows = state.zoning.byCity.get(city) || [];
    const zoneIdx = headerIndex("zone");
    const zoneTypeIdx = headerIndex("zoneType");

    const zoneRows = cityRows.filter(r => {
      const z = zoneIdx !== -1 ? safeText(r[zoneIdx]).trim() : "";
      return z === zone;
    });

    if (!zoneRows.length) {
      if (summaryEl) {
        summaryEl.innerHTML =
          "<p class='feasibility-headline' data-status='unknown'>No matching zoning rows were found for this city/zone. Check your dataset.</p>";
      }
      return;
    }

    // Pick a "best" row: prioritize ADU allowed and highest maximum ADU size
    let bestRow = zoneRows[0];
    let bestScore = -Infinity;
    zoneRows.forEach(r => {
      const adu = getCell(r, "aduAllowed").toLowerCase();
      const dadu = getCell(r, "daduAllowed").toLowerCase();
      const maxSize = getNumeric(r, "maxADUSize");
      let score = 0;
      if (adu.includes("yes")) score += 2;
      if (dadu.includes("yes")) score += 1;
      if (!isNaN(maxSize)) score += maxSize / 1000;
      if (score > bestScore) {
        bestScore = score;
        bestRow = r;
      }
    });

    const minLot = getNumeric(bestRow, "minLotSize");
    const maxSize = getNumeric(bestRow, "maxADUSize");
    const aduAllowed = getCell(bestRow, "aduAllowed");
    const ownerOcc = getCell(bestRow, "ownerOcc");
    const parkingTransit = getCell(bestRow, "aduParkingTransitExempt");

    const lotOK = !isNaN(minLot) ? lotSize >= minLot : true;
    const sizeOK = !isNaN(maxSize) ? aduSize <= maxSize : true;
    const aduYes = aduAllowed.toLowerCase().includes("yes");

    let status = "unknown";
    let headline = "";

    if (!aduYes) {
      status = "no";
      headline = `ADUs are not clearly allowed in the selected zone row for ${city}. Further code review is required.`;
    } else if (lotOK && sizeOK) {
      status = "yes";
      headline = `This lot and ADU size appear generally feasible in at least one zoning row, assuming setbacks, parking, and design standards can be met.`;
    } else if (!lotOK && sizeOK) {
      status = "maybe";
      headline = `ADU size is within typical limits, but the lot size is below a recorded minimum. Overlays, variances or updated code may still allow it.`;
    } else if (lotOK && !sizeOK) {
      status = "maybe";
      headline = `Lot size meets a typical minimum, but the ADU size exceeds a recorded maximum. A smaller ADU may be more feasible.`;
    } else {
      status = "no";
      headline = `Both lot size and ADU size fall outside at least one key standard in this zone. A more detailed code review is needed.`;
    }

    if (hasTransit && parkingTransit) {
      headline += ` Transit-based parking relief is flagged in this zone: ${parkingTransit}.`;
    }
    if (hasAlley) {
      headline += ` Alley access is assumed, which often helps with rear-yard siting and parking access.`;
    }
    if (ownerOcc) {
      headline += ` Owner-occupancy in this row is recorded as: ${ownerOcc}.`;
    }

    if (summaryEl) {
      summaryEl.innerHTML = `<p class="feasibility-headline" data-status="${status}">${headline}</p>`;
    }
    if (diagramEl) {
      diagramEl.dataset.status = status;
    }

    // Diagram + report (using the best matching zoning row)
    buildFeasDiagramShell();

    // 1) Diagram
    renderFeasibilityDiagram({
      lotSize,
      lotWidth,
      lotDepth,
      houseWidth,
      houseDepth,
      aduSize,
      status,
      hasAlley,
      zoneRow: bestRow,
    });

    // 2) Detailed report
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
      hasTransit,
      hasAlley,
      zoneRow: bestRow,
    });


function initFeasibilityUI() {
  if (!state.initialized.zoningLoaded) return;

  const citySelect = document.getElementById("feasCity");
  const zoneSelect = document.getElementById("feasZone");
  const runBtn = document.getElementById("runFeasibility");

  if (!citySelect || !zoneSelect || !runBtn) return;

  // Populate cities
  const cities = Array.from(state.zoning.byCity.keys()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  citySelect.innerHTML = "";
  const baseOpt = document.createElement("option");
  baseOpt.value = "";
  baseOpt.textContent = "Select city";
  citySelect.appendChild(baseOpt);
  cities.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    citySelect.appendChild(opt);
  });

  zoneSelect.innerHTML = "";
  const baseZoneOpt = document.createElement("option");
  baseZoneOpt.value = "";
  baseZoneOpt.textContent = "Choose a city first";
  zoneSelect.appendChild(baseZoneOpt);
  zoneSelect.disabled = true;

  citySelect.addEventListener("change", () => {
    const city = safeText(citySelect.value).trim();
    const rows = state.zoning.byCity.get(city) || [];
    const zoneIdx = headerIndex("zone");
    zoneSelect.innerHTML = "";
    if (!rows.length || zoneIdx === -1) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = rows.length
        ? "No zones found for this city"
        : "Choose a city first";
      zoneSelect.appendChild(opt);
      zoneSelect.disabled = true;
      return;
    }

    const baseOption = document.createElement("option");
    baseOption.value = "";
    baseOption.textContent = "All zones in city";
    zoneSelect.appendChild(baseOption);

    const zones = Array.from(
      new Set(
        rows.map(r => safeText(r[zoneIdx]).trim()).filter(z => z)
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    zones.forEach(z => {
      const opt = document.createElement("option");
      opt.value = z;
      opt.textContent = z;
      zoneSelect.appendChild(opt);
    });

    zoneSelect.disabled = false;
  });

  runBtn.addEventListener("click", runFeasibilityCheck);

  // Initialize diagram shell once so user always sees something
  buildFeasDiagramShell();
}

/* =========================================================
   PERMITS TABLE + PAGINATION (5 PER PAGE, 2024–2025 ONLY)
   ========================================================= */

function initPermitsUI() {
  if (!state.initialized.permitsLoaded) return;

  state.ui.permitsCityFilter = document.getElementById("permitsCityFilter");
  state.ui.permitsYearFilter = document.getElementById("permitsYearFilter");
  state.ui.permitsSummary = document.getElementById("permitsSummary");

  const permitsTable = document.getElementById("permitsTable");
  state.ui.permitsTableBody = permitsTable
    ? permitsTable.querySelector("tbody")
    : null;

  // Build pagination controls dynamically if not present
  const permitsCard = document.querySelector(".permits-card");
  if (permitsCard && !document.getElementById("permitsPagerLabel")) {
    const pager = document.createElement("div");
    pager.className = "permits-pager";
    pager.style.display = "flex";
    pager.style.justifyContent = "flex-end";
    pager.style.alignItems = "center";
    pager.style.gap = "0.5rem";
    pager.style.marginTop = "0.75rem";

    pager.innerHTML = `
      <button type="button" id="permitsPrev" class="btn-outline" aria-label="Previous page">← Prev</button>
      <span id="permitsPageLabel" class="permits-page-label"></span>
      <button type="button" id="permitsNext" class="btn-outline" aria-label="Next page">Next →</button>
    `;

    const tableWrapper = permitsCard.querySelector(".table-wrapper");
    if (tableWrapper && tableWrapper.parentNode) {
      tableWrapper.parentNode.appendChild(pager);
    } else {
      permitsCard.appendChild(pager);
    }
  }

  state.ui.permitsPrevBtn = document.getElementById("permitsPrev");
  state.ui.permitsNextBtn = document.getElementById("permitsNext");
  state.ui.permitsPagerLabel = document.getElementById("permitsPageLabel");

  // Populate filters from dataset (but underlying rows are already 2024–2025)
  populatePermitsFilters();

  const clearBtn = document.getElementById("permitsClearFilters");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (state.ui.permitsCityFilter) state.ui.permitsCityFilter.value = "";
      if (state.ui.permitsYearFilter) state.ui.permitsYearFilter.value = "";
      state.permits.currentPage = 1;
      state.permits.filtered = state.permits.rows.slice();
      renderPermitsTable();
    });
  }

  if (state.ui.permitsCityFilter) {
    state.ui.permitsCityFilter.addEventListener("change", () => {
      state.permits.currentPage = 1;
      filterPermits();
    });
  }
  if (state.ui.permitsYearFilter) {
    state.ui.permitsYearFilter.addEventListener("change", () => {
      state.permits.currentPage = 1;
      filterPermits();
    });
  }

  if (state.ui.permitsPrevBtn) {
    state.ui.permitsPrevBtn.addEventListener("click", () => {
      if (state.permits.currentPage > 1) {
        state.permits.currentPage -= 1;
        renderPermitsTable();
      }
    });
  }
  if (state.ui.permitsNextBtn) {
    state.ui.permitsNextBtn.addEventListener("click", () => {
      const totalPages = Math.max(
        1,
        Math.ceil(state.permits.filtered.length / state.permits.pageSize)
      );
      if (state.permits.currentPage < totalPages) {
        state.permits.currentPage += 1;
        renderPermitsTable();
      }
    });
  }

  // Initial view
  filterPermits();
}

function populatePermitsFilters() {
  const cityFilter = state.ui.permitsCityFilter;
  const yearFilter = state.ui.permitsYearFilter;
  if (!cityFilter && !yearFilter) return;

  const headers = state.permits.headers.map(h =>
    h ? h.toString().toLowerCase() : ""
  );
  const cityIdx = headers.findIndex(h => h.includes("city"));
  const approvalIdx = headers.findIndex(
    h =>
      (h.includes("approval") && h.includes("date")) ||
      (h.includes("issued") && h.includes("date"))
  );
  const yearIdx = headers.findIndex(h => h.includes("year"));

  if (cityFilter && cityIdx !== -1) {
    const cities = Array.from(
      new Set(
        state.permits.rows
          .map(r => safeText(r[cityIdx]).trim())
          .filter(v => v)
      )
    ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));

    cityFilter.innerHTML = "";
    const base = document.createElement("option");
    base.value = "";
    base.textContent = "All cities";
    cityFilter.appendChild(base);
    cities.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      cityFilter.appendChild(opt);
    });
  }

  if (yearFilter) {
    const years = Array.from(
      new Set(
        state.permits.rows
          .map(r => {
            if (yearIdx !== -1) {
              return parseInt(
                safeText(r[yearIdx]).slice(0, 4),
                10
              );
            }
            if (approvalIdx !== -1) {
              const raw = safeText(r[approvalIdx]);
              const match = raw.match(/(20[0-9]{2})/);
              return match ? parseInt(match[1], 10) : NaN;
            }
            return NaN;
          })
          .filter(y => !isNaN(y))
      )
    )
      .filter(y => y >= 2024 && y <= 2025)
      .sort();

    yearFilter.innerHTML = "";
    const baseY = document.createElement("option");
    baseY.value = "";
    baseY.textContent = "2024–2025 (all)";
    yearFilter.appendChild(baseY);
    years.forEach(y => {
      const opt = document.createElement("option");
      opt.value = String(y);
      opt.textContent = String(y);
      yearFilter.appendChild(opt);
    });
  }
}

function filterPermits() {
  const headers = state.permits.headers.map(h =>
    h ? h.toString().toLowerCase() : ""
  );

  const cityFilterVal = state.ui.permitsCityFilter
    ? state.ui.permitsCityFilter.value.trim().toLowerCase()
    : "";
  const yearFilterVal = state.ui.permitsYearFilter
    ? state.ui.permitsYearFilter.value.trim()
    : "";

  const cityIdx = headers.findIndex(h => h.includes("city"));
  const yearIdx = headers.findIndex(h => h.includes("year"));
  const approvalIdx = headers.findIndex(
    h =>
      (h.includes("approval") && h.includes("date")) ||
      (h.includes("issued") && h.includes("date"))
  );

  state.permits.filtered = state.permits.rows.filter(r => {
    if (cityFilterVal && cityIdx !== -1) {
      const c = safeText(r[cityIdx]).trim().toLowerCase();
      if (c !== cityFilterVal) return false;
    }

    if (yearFilterVal) {
      let year = NaN;
      if (yearIdx !== -1) {
        year = parseInt(
          safeText(r[yearIdx]).slice(0, 4),
          10
        );
      } else if (approvalIdx !== -1) {
        const raw = safeText(r[approvalIdx]);
        const match = raw.match(/(20[0-9]{2})/);
        if (match) year = parseInt(match[1], 10);
      }
      if (String(year) !== yearFilterVal) return false;
    }

    return true;
  });

  state.permits.currentPage = 1;
  renderPermitsTable();
}

function renderPermitsTable() {
  if (!state.ui.permitsTableBody) return;

  const tbody = state.ui.permitsTableBody;
  tbody.innerHTML = "";

  const total = state.permits.filtered.length;
  const pageSize = state.permits.pageSize;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(state.permits.currentPage, 1), totalPages);
  state.permits.currentPage = page;

  const start = (page - 1) * pageSize;
  const end = Math.min(start + pageSize, total);
  const slice = state.permits.filtered.slice(start, end);

  const headers = state.permits.headers.map(h => h.toString().toLowerCase());
  const cityIdx = headers.findIndex(h => h.includes("city"));
  const projectIdx = headers.findIndex(
    h => h.includes("project") || h.includes("description")
  );
  const aduTypeIdx = headers.findIndex(
    h => h.includes("adu") && h.includes("type")
  );
  const applicantIdx = headers.findIndex(
    h => h.includes("applicant") || h.includes("owner")
  );
  const approvalIdx = headers.findIndex(
    h =>
      (h.includes("approval") && h.includes("date")) ||
      (h.includes("issued") && h.includes("date"))
  );
  const statusIdx = headers.findIndex(h => h.includes("status"));
  const linkIdx = headers.findIndex(
    h => h.includes("link") || h.includes("url")
  );

  slice.forEach(r => {
    const tr = document.createElement("tr");

    const city = cityIdx !== -1 ? safeText(r[cityIdx]).trim() : "";
    const project = projectIdx !== -1 ? safeText(r[projectIdx]).trim() : "";
    const type = aduTypeIdx !== -1 ? safeText(r[aduTypeIdx]).trim() : "";
    const applicant =
      applicantIdx !== -1 ? safeText(r[applicantIdx]).trim() : "";
    const approval =
      approvalIdx !== -1 ? safeText(r[approvalIdx]).trim() : "";
    const status =
      statusIdx !== -1 ? safeText(r[statusIdx]).trim() : "";
    const link = linkIdx !== -1 ? safeText(r[linkIdx]).trim() : "";

    const cells = [
      city,
      project,
      type,
      applicant,
      approval,
      status,
      link
    ];

    cells.forEach((val, idx) => {
      const td = document.createElement("td");
      if (idx === 6 && val) {
        const a = document.createElement("a");
        a.href = val;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "View permit";
        td.appendChild(a);
      } else {
        td.textContent = val;
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });

  if (state.ui.permitsSummary) {
    state.ui.permitsSummary.textContent = total
      ? `Showing ${start + 1}–${end} of ${total} ADU permits (2024–2025 only)`
      : "No permits match the filters (2024–2025).";
  }

  if (state.ui.permitsPagerLabel) {
    state.ui.permitsPagerLabel.textContent = total
      ? `Page ${page} of ${totalPages}`
      : "No results";
  }

  if (state.ui.permitsPrevBtn) {
    state.ui.permitsPrevBtn.disabled = page <= 1;
  }
  if (state.ui.permitsNextBtn) {
    state.ui.permitsNextBtn.disabled = page >= totalPages;
  }
}

/* =========================================================
   MAP INITIALIZATION (SAFE IF LEAFLET MISSING)
   ========================================================= */

function initMap() {
  const mapEl = document.getElementById("map");
  if (!mapEl) return;
  if (typeof L === "undefined") {
    // Leaflet not loaded – fail silently
    return;
  }

  const map = L.map("map").setView([47.6, -122.3], 10);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors"
  }).addTo(map);

  // You can hook zoning rows / permits markers here later if desired.
}

/* =========================================================
   APP ENTRYPOINT
   ========================================================= */

async function initApp() {
  // Load both datasets in parallel
  await Promise.all([loadZoningCsv(), loadPermitsCsv()]);

  // Initialize UI modules after data present
  renderCityScorecards();
  initRegulationsUI();
  initFeasibilityUI();
  initPermitsUI();
  initMap();
}

window.addEventListener("DOMContentLoaded", () => {
  initApp().catch(err => {
    console.error("initApp error:", err);
  });
});
