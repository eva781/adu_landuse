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
    byCity: new Map()
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
  state.ui.regTableWrapper = document.querySelector(".reg-table-wrapper");
  state.ui.regResultsPlaceholder = document.querySelector(".reg-results-placeholder");
  
  const regTable = document.querySelector(".reg-table");
  state.ui.regTableBody = regTable ? regTable.querySelector("tbody") : null;

  if (!state.initialized.zoningLoaded) return;

  // Populate filter options from dataset
  populateFilterSelect(state.ui.cityFilter, state.zoning.rows, COL.city);
  populateFilterSelect(state.ui.zoneTypeFilter, state.zoning.rows, COL.zoneType);
  populateFilterSelect(state.ui.aduFilter, state.zoning.rows, COL.aduAllowed);
  populateFilterSelect(state.ui.daduFilter, state.zoning.rows, COL.daduAllowed);
  populateFilterSelect(state.ui.ownerOccFilter, state.zoning.rows, COL.ownerOcc);

  // Zone filter starts empty
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
      if (state.ui.selectAllCities) state.ui.selectAllCities.checked = false;
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
      
      // Clear the table and show placeholder
      if (state.ui.regTableBody) state.ui.regTableBody.innerHTML = "";
      if (state.ui.regResultsPlaceholder) {
        state.ui.regResultsPlaceholder.style.display = "block";
        state.ui.regResultsPlaceholder.innerHTML = "<p>Select a city and zone, then click Search to view regulations.</p>";
      }
      if (state.ui.regTableWrapper) state.ui.regTableWrapper.classList.add("hidden");
    });
  }

  // IMPORTANT: Don't populate table initially - wait for user search
  if (state.ui.regResultsPlaceholder) {
    state.ui.regResultsPlaceholder.style.display = "block";
    state.ui.regResultsPlaceholder.innerHTML = "<p>Select a city and zone, then click Search to view regulations.</p>";
  }
  if (state.ui.regTableWrapper) {
    state.ui.regTableWrapper.classList.add("hidden");
  }
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
        safeText(r[cityHeaderIdx]).trim().toLowerCase() === city.toLowerCase()
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

  // Require at least city OR zone to be selected
  if (!cityVal && !zoneVal && !searchTerm) {
    if (state.ui.regResultsPlaceholder) {
      state.ui.regResultsPlaceholder.style.display = "block";
      state.ui.regResultsPlaceholder.innerHTML = "<p>Please select at least a city or zone to search.</p>";
    }
    if (state.ui.regTableWrapper) {
      state.ui.regTableWrapper.classList.add("hidden");
    }
    return;
  }

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
      state.ui.regResultsPlaceholder.innerHTML = "<p>No zoning regulations match your search criteria.</p>";
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

  // Render full header row dynamically
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

  container.style.minHeight = "400px";
  container.style.display = "flex";
  container.style.alignItems = "stretch";
  container.style.justifyContent = "center";

  container.innerHTML = `
    <div class="parcel-stage">
      <div class="lot-box" id="lotBox">
        <div class="lot-label" id="lotLabel">Lot: — sf</div>

        <div class="buildable-box" id="buildableRect">
          <div class="buildable-label" id="buildableLabel">
            Buildable envelope
          </div>
        </div>

        <div class="primary-box" id="primaryRect">
          <span class="primary-label" id="primaryLabel">Primary home</span>
        </div>

        <div class="adu-box" id="aduRect">
          <span class="adu-label" id="aduLabel">ADU</span>
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

function renderFeasibilityDiagram({
  lotSize,
  lotWidth,
  lotDepth,
  houseWidth,
  houseDepth,
  aduSize,
  status,
  hasAlley,
  zoneRow
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

  const effectiveLotSize = !isNaN(lotSize) && lotSize > 0 ? lotSize : 4000;

  if (lotLabel) {
    lotLabel.textContent = `Lot • ${effectiveLotSize.toLocaleString()} sf${
      lotWidth && lotDepth ? ` (${lotWidth}′ × ${lotDepth}′)` : ""
    }`;
  }

  const baseLot = Math.max(effectiveLotSize, 2000);
  const lotScale = Math.sqrt(effectiveLotSize / baseLot);

  const primaryScale =
    houseWidth && houseDepth
      ? Math.sqrt((houseWidth * houseDepth) / 1000)
      : 1;

  const primaryWidthPct = Math.min(40 * primaryScale, 60);
  const primaryDepthPct = Math.min(35 * primaryScale, 50);

  let buildableWidthPct = 80;
  let buildableDepthPct = 60;

  if (zoneRow) {
    const coveragePct = getNumeric(zoneRow, "maxLotCoverage");

    if (!isNaN(coveragePct) && coveragePct > 0 && coveragePct <= 100) {
      const coverageRatio = coveragePct / 100;
      const approxFootprintRatio = Math.sqrt(coverageRatio);
      buildableWidthPct = Math.max(30, Math.min(90, approxFootprintRatio * 100));
      buildableDepthPct = Math.max(30, Math.min(90, approxFootprintRatio * 70));
    }

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
        buildableWidthPct = Math.max(20, Math.min(buildableWidthPct, 100 - horizInsetPct));
      }
