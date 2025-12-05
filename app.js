// =========================================
// CONFIG & GLOBAL STATE
// =========================================

// Use plain filenames so GitHub Pages can find them
const CSV_URL = "data.csv";
const PERMITS_URL = "adu_permits.csv";

let headers = [];
let rawRows = [];
let filteredRows = [];

let permitHeaders = [];
let permitRows = [];
let filteredPermitRows = [];

// Column map for zoning dataset
const COL = {
  city: "City",
  county: "County",
  state: "State",
  zone: "Zone",
  zoneType: "Zone_Type",
  aduAllowed: "ADU_Allowed",
  daduAllowed: "DADU_Allowed",
  maxADUs: "Max_ADUs/DADUs_Per_Dwelling_Unit",
  maxADUSize: "Max_ADU_Size_Sqft",
  maxADUSizePct: "Max_ADU/DADU_Size_Percent_Primary/Lot",
  maxDADUSize: "Max_DADU_Size_Sqft",
  minLotSize: "Min_Lot_Size_Sqft",
  minLotWidth: "Min_Lot_Width_Sqft",
  minLotDepth: "Min_Lot_Depth",
  minLotFrontage: "Min_Lot_Frontage",
  density: "Residential_Density",
  maxLotCoverage: "Max_Lot_Coverage_Percent",
  maxFAR: "Max_FAR",
  minParking: "Min_Parking_Spaces",
  parkingNotes: "Parking_Notes",
  alleyAccess: "Principal_Min_Rear_Setback_AlleyAccess",
  ownerOcc: "Owner_Occupancy_Required",
  ownerOccNotes: "Owner_Occupancy_Notes",
  frontSetback: "Min_Residential_Attached_Accessory_Front_Setback",
  sideSetback: "Min_Residentia_Attachedl_Accessory_Side_Setback",
  rearSetback: "Min_Residential_Attached_Rear_Setback",
  alleySetback: "Min_Residential_Accessory_Rear_Alley_Setback",
  primaryFrontSetback: "Principal_Min_Front_Setback_ft",
  primaryStreetSide: "Principal_Min_Street_Side_Setback",
  primaryInteriorSide: "Principal_Min_Interior_Side_Setback",
  primaryRear: "Principal_Min_Rear_Setback",
  heightPrimary: "Max_Building_Height",
  heightDADU: "DADU_Max_Height_ft",
  codeSection: "Reference_Code_Section",
  sourceURL: "Source_Document_URL",
  notes: "Greenscape_Notes",
  maxHardSurface: "Max_Imprevious_Surface",
  maxImpervious: "Max_Imprevious_Surface",
  aduParkingReq: "ADU_Parking_Required",
  aduParkingSmall: "ADU_Size_Notes",
  aduParkingTransit: "ADU_Parking_Exempt_If_Transit",
  impactFees: "Fee",
  aduConversionAllowed: "ADU_Conversion_Allowed",
  aduConversionNotes: "ADU_Conversion_Notes",
  daduSetbackNotes: "DADU_Min_Rear_Setback",
  daduSideLotLine: "DADU_Min_LotLine_Side _Setback",
  daduStreetSide: "DADU_Min_Street_Side_Setback",
  daduFromPrincipal: "DADU_Min_Setback_From_Principal",
  minADUDADUSize: "Min_ADU+DADU_Size_Sqft",
  maxADUHeight: "Max_ADU_Height_ft",
  lastReviewed: "Last_Reviewed_Date",
  shortTermRental: "Short_Term_Rental_Allowed",
};

// Column map for permits dataset (matches adu_permits.csv)
const PCOL = {
  city: "City",
  project: "Project_Name",
  type: "ADU_Type",
  status: "Status",
  permit: "Permit_Number",
  parcel: "Parcel",
  zone: "Zone",
  size: "ADU_Size_Sqft",
  approvalDate: "Approval_Date",
  url: "Source_URL",
  notes: "Notes",
};

// Limit how many permit rows we actually render at once.
// The dataset is large; rendering too many rows freezes the browser.
const MAX_PERMITS_RENDERED = 300;


// =========================================
// SIMPLE CSV PARSER
// =========================================

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows = [];
  let current = [];
  let value = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"' && !insideQuotes) {
      insideQuotes = true;
    } else if (c === '"' && insideQuotes) {
      if (next === '"') {
        value += '"';
        i++;
      } else {
        insideQuotes = false;
      }
    } else if (c === "," && !insideQuotes) {
      current.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !insideQuotes) {
      if (value.length > 0 || current.length > 0) {
        current.push(value);
        rows.push(current);
        current = [];
        value = "";
      }
      if (c === "\r" && next === "\n") i++;
    } else {
      value += c;
    }
  }
  if (value.length > 0 || current.length > 0) {
    current.push(value);
    rows.push(current);
  }
  return rows;
}

// =========================================
// DATA LOADING
// =========================================

async function loadZoningData() {
  const res = await fetch(CSV_URL);
  if (!res.ok) throw new Error(`Failed to load ${CSV_URL}: ${res.status}`);
  const text = await res.text();
  const parsed = parseCSV(text);
  if (!parsed.length) throw new Error("Zoning CSV appears to be empty");

  let headerRowIndex = 0;
  while (
    headerRowIndex < parsed.length &&
    parsed[headerRowIndex].every((c) => !c || !c.trim())
  ) {
    headerRowIndex++;
  }
  if (headerRowIndex >= parsed.length) {
    throw new Error("No header row found in zoning CSV");
  }

  headers = parsed[headerRowIndex];
  rawRows = parsed.slice(headerRowIndex + 1).filter((row) =>
    row.some((cell) => cell && cell.trim() !== "")
  );
  filteredRows = rawRows.slice();
}

async function loadPermitsData() {
  try {
    const res = await fetch(PERMITS_URL);
    if (!res.ok) {
      console.warn(
        `Permits CSV not loaded (status ${res.status}); continuing without permit stats.`
      );
      permitHeaders = [];
      permitRows = [];
      filteredPermitRows = [];
      return;
    }
    const text = await res.text();
    const parsed = parseCSV(text);
    if (!parsed.length) {
      console.warn("Permits CSV appears to be empty; continuing without data.");
      permitHeaders = [];
      permitRows = [];
      filteredPermitRows = [];
      return;
    }

    let headerRowIndex = 0;
    while (
      headerRowIndex < parsed.length &&
      parsed[headerRowIndex].every((c) => !c || !c.trim())
    ) {
      headerRowIndex++;
    }
    if (headerRowIndex >= parsed.length) {
      permitHeaders = [];
      permitRows = [];
      filteredPermitRows = [];
      return;
    }
    permitHeaders = parsed[headerRowIndex];
    const dataRows = parsed.slice(headerRowIndex + 1);

    // First drop truly empty rows
    const nonEmptyRows = dataRows.filter((row) =>
      row.some((cell) => cell && cell.trim && cell.trim() !== "")
    );

    // Then keep only the rows that pass our ADU-specific check. If nothing
    // matches (e.g., the dataset already contains only ADU permits and the
    // heuristic is too strict), fall back to the full cleaned set so data
    // still renders instead of showing an empty-state popup.
    const aduRows = nonEmptyRows.filter(isADUPermit);
    permitRows = aduRows.length ? aduRows : nonEmptyRows;
    filteredPermitRows = permitRows.slice();

  } catch (err) {
    console.warn("Error loading permits data:", err);
    permitHeaders = [];
    permitRows = [];
    filteredPermitRows = [];
  }
}

// =========================================
// UTILS
// =========================================

function headerIndex(name) {
  return headers.indexOf(name);
}

function pHeaderIndex(name) {
  return permitHeaders.indexOf(name);
}

function get(row, colKey) {
  const idx = headerIndex(colKey);
  if (idx === -1) return "";
  return row[idx] || "";
}
// Keep only rows that look like actual ADU/DADU permits.
// Your CSV already mostly contains ADU permits, but some rows like
// "Adult Family Home", "Adult Toys", etc. are clearly not what we want.
// Those go away here.
function getPermit(row, colKey) {
  const idx = pHeaderIndex(colKey);
  if (idx === -1) return "";
  return row[idx] || "";
}
// Heuristic: keep only rows that look like actual ADU / DADU permits,
// not every building permit in the source CSV.
//
// IMPORTANT: use word boundaries so we don't match "adu" inside "adult", etc.
function isADUPermit(row) {
  const project = (getPermit(row, PCOL.project) || "").toString().toLowerCase();
  const notes = (getPermit(row, PCOL.notes) || "").toString().toLowerCase();

  const textToSearch = `${project} ${notes}`;

  // Word/phrase patterns that indicate an ADU/DADU project
  const patterns = [
    /\badu\b/i,
    /\bdadu\b/i,
    /\baccessory dwelling\b/i,
    /\baccessory dwelling unit\b/i,
    /\bbackyard cottage\b/i,
    /\bmother[- ]in[- ]law\b/i,
    /\bdetached accessory dwelling\b/i,
  ];

  // Explicitly avoid common false positives like "adult"
  const negativePatterns = [
    /\badult\b/i,          // "adult family home", etc.
  ];

  // If any negative pattern matches, it's not an ADU even if other words appear
  if (negativePatterns.some((re) => re.test(textToSearch))) {
    return false;
  }

  // Keep the row only if at least one positive pattern matches as a whole word/phrase
  return patterns.some((re) => re.test(textToSearch));
}


function uniqueValues(colKey) {
  const idx = headerIndex(colKey);
  if (idx === -1) return [];
  const set = new Set();
  rawRows.forEach((row) => {
    const v = row[idx];
    if (v && v.trim()) set.add(v.trim());
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function toNumber(v) {
  if (v == null) return null;
  if (typeof v === "number") return isNaN(v) ? null : v;
  const num = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(num) ? null : num;
}

// =========================================
// TABLE RENDERING & FILTERS (ALL COLUMNS)
// =========================================

const DISPLAY_COLUMNS = [
  { label: "City", render: (row) => formatValue(get(row, COL.city)) },
  {
    label: "Zone & type",
    render: (row) =>
      formatParts([
        formatValue(get(row, COL.zone)),
        formatValue(get(row, COL.zoneType)),
      ]),
  },
  {
    label: "ADU policy",
    render: (row) =>
      formatParts([
        `ADU: ${formatValue(get(row, COL.aduAllowed))}`,
        `DADU: ${formatValue(get(row, COL.daduAllowed))}`,
        `Max units: ${formatValue(get(row, COL.maxADUs))}`,
      ]),
  },
  {
    label: "Site minimums",
    render: (row) =>
      formatParts(
        [
          sizedLabel("Lot", get(row, COL.minLotSize)),
          sizedLabel("Width", get(row, COL.minLotWidth)),
          sizedLabel("Depth", get(row, COL.minLotDepth)),
          sizedLabel("Frontage", get(row, COL.minLotFrontage)),
          sizedLabel("Density", get(row, COL.density)),
          sizedLabel("Coverage", get(row, COL.maxLotCoverage)),
        ].filter(Boolean)
      ),
  },
  {
    label: "Setbacks",
    render: (row) =>
      formatParts(
        [
          sizedLabel("Front", get(row, COL.primaryFrontSetback)),
          sizedLabel("Street", get(row, COL.primaryStreetSide)),
          sizedLabel("Interior", get(row, COL.primaryInteriorSide)),
          sizedLabel("Rear", get(row, COL.primaryRear)),
          sizedLabel(
            "Rear (alley)",
            get(row, COL.alleyAccess) || get(row, COL.alleySetback)
          ),
          sizedLabel("Accessory front", get(row, COL.frontSetback)),
          sizedLabel("Accessory side", get(row, COL.sideSetback)),
          sizedLabel("Accessory rear", get(row, COL.rearSetback)),
          sizedLabel("Accessory alley", get(row, COL.alleySetback)),
          sizedLabel("DADU rear", get(row, COL.daduSetbackNotes)),
          sizedLabel("DADU side", get(row, COL.daduSideLotLine)),
          sizedLabel("DADU street", get(row, COL.daduStreetSide)),
          sizedLabel("From house", get(row, COL.daduFromPrincipal)),
        ].filter(Boolean)
      ),
  },
  {
    label: "Parking",
    render: (row) =>
      formatParts(
        [
          sizedLabel("Min spaces", get(row, COL.minParking)),
          sizedLabel("Required", get(row, COL.aduParkingReq)),
          sizedLabel("Transit", get(row, COL.aduParkingTransit)),
          formatValue(get(row, COL.parkingNotes)),
        ].filter(Boolean)
      ),
  },
  {
    label: "Size & height",
    render: (row) =>
      formatParts(
        [
          sizedLabel("Min ADU/DADU", get(row, COL.minADUDADUSize)),
          sizedLabel("Max ADU", get(row, COL.maxADUSize)),
          sizedLabel("Max DADU", get(row, COL.maxDADUSize)),
          sizedLabel("ADU % of lot", get(row, COL.maxADUSizePct)),
          sizedLabel("ADU height", get(row, COL.maxADUHeight)),
          sizedLabel("DADU height", get(row, COL.heightDADU)),
          sizedLabel("Primary height", get(row, COL.heightPrimary)),
          sizedLabel("FAR", get(row, COL.maxFAR)),
          sizedLabel("Hard surface", get(row, COL.maxImpervious)),
        ].filter(Boolean)
      ),
  },
  {
    label: "Occupancy & fees",
    render: (row) =>
      formatParts(
        [
          sizedLabel("Owner occ", get(row, COL.ownerOcc)),
          sizedLabel("Short-term", get(row, COL.shortTermRental)),
          sizedLabel("Fees", get(row, COL.impactFees)),
          formatValue(get(row, COL.ownerOccNotes)),
        ].filter(Boolean)
      ),
  },
  {
    label: "Notes",
    render: (row) => formatValue(get(row, COL.notes)),
  },
  { label: "Code link", render: (row) => renderCodeLink(row) },
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

function renderTable() {
  const tbody = document.getElementById("tableBody");
  const summary = document.getElementById("summary");
  const emptyState = document.getElementById("tableEmpty");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (summary) {
    const countText =
      filteredRows.length === rawRows.length
        ? `${filteredRows.length} zoning rows shown`
        : `${filteredRows.length} of ${rawRows.length} zoning rows shown`;
    summary.textContent = countText;
  }

  if (!filteredRows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = DISPLAY_COLUMNS.length;
    td.className = "table-empty-row";
    td.textContent = "No results. Adjust or clear your filters.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    if (emptyState) emptyState.hidden = false;
    return;
  }

  if (emptyState) emptyState.hidden = true;

  filteredRows.forEach((row) => {
    const tr = document.createElement("tr");

    DISPLAY_COLUMNS.forEach((col) => {
      const td = document.createElement("td");
      const rendered = col.render(row);
      if (rendered instanceof HTMLElement) {
        td.appendChild(rendered);
      } else {
        td.textContent = rendered;
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

function formatValue(value) {
  const text = value == null ? "" : String(value).trim();
  return text || "—";
}

function formatParts(parts) {
  const clean = parts
    .map((p) => (p == null ? "" : String(p).trim()))
    .filter((p) => p && p !== "—");
  if (!clean.length) return "—";
  return clean.join(" • ");
}

function sizedLabel(label, value) {
  const text = value == null ? "" : String(value).trim();
  if (!text) return "";
  return `${label}: ${text}`;
}

function renderCodeLink(row) {
  const url = get(row, COL.sourceURL);
  if (!url) return "—";
  const a = document.createElement("a");
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.textContent = "Open code";
  a.className = "table-link";
  return a;
}

function fillSelect(id, colName, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;
  const values = uniqueValues(colName);

  el.innerHTML = "";
  const optAny = document.createElement("option");
  optAny.value = "";
  optAny.textContent = placeholder;
  el.appendChild(optAny);

  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });
}

function applyFilters() {
  const cityVal = (document.getElementById("cityFilter").value || "").trim();
  const zoneVal = (document.getElementById("zoneFilter").value || "").trim();
  const zoneTypeVal = (document.getElementById("zoneTypeFilter").value || "").trim();
  const aduVal = (document.getElementById("aduFilter").value || "").trim();
  const daduVal = (document.getElementById("daduFilter").value || "").trim();
  const ownerVal = (document.getElementById("ownerOccFilter").value || "").trim();
  const searchVal = (document.getElementById("searchInput").value || "")
    .toLowerCase()
    .trim();

  const cityIdx = headerIndex(COL.city);
  const zoneIdx = headerIndex(COL.zone);
  const zoneTypeIdx = headerIndex(COL.zoneType);
  const aduIdx = headerIndex(COL.aduAllowed);
  const daduIdx = headerIndex(COL.daduAllowed);
  const ownerIdx = headerIndex(COL.ownerOcc);

  filteredRows = rawRows.filter((row) => {
    if (cityVal && row[cityIdx] !== cityVal) return false;
    if (zoneVal && row[zoneIdx] !== zoneVal) return false;
    if (zoneTypeVal && row[zoneTypeIdx] !== zoneTypeVal) return false;
    if (aduVal && row[aduIdx] !== aduVal) return false;
    if (daduVal && row[daduIdx] !== daduVal) return false;
    if (ownerVal && row[ownerIdx] !== ownerVal) return false;

    if (searchVal) {
      const combined = row.join(" ").toLowerCase();
      if (!combined.includes(searchVal)) return false;
    }

    return true;
  });

  renderTable();
}

function initFilters() {
  fillSelect("cityFilter", COL.city, "All cities");
  fillSelect("zoneFilter", COL.zone, "All zones");
  fillSelect("zoneTypeFilter", COL.zoneType, "All zone types");
  fillSelect("aduFilter", COL.aduAllowed, "Any ADU");
  fillSelect("daduFilter", COL.daduAllowed, "Any DADU");
  fillSelect("ownerOccFilter", COL.ownerOcc, "Any owner-occupancy");

  const search = document.getElementById("searchInput");
  if (search) search.addEventListener("input", applyFilters);

  const clearBtn = document.getElementById("clearFilters");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      [
        "cityFilter",
        "zoneFilter",
        "zoneTypeFilter",
        "aduFilter",
        "daduFilter",
        "ownerOccFilter",
      ].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.value = "";
      });

      if (search) search.value = "";

      filteredRows = rawRows.slice();
      renderTable();
    });
  }

  [
    "cityFilter",
    "zoneFilter",
    "zoneTypeFilter",
    "aduFilter",
    "daduFilter",
    "ownerOccFilter",
  ].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener("change", applyFilters);
  });
}

// =========================================
// CITY SCORECARDS (LETTER GRADES)
// =========================================

function renderCityScorecards() {
  const container = document.getElementById("cityScorecards");
  if (!container) return;

  container.innerHTML = "";

  if (!rawRows.length) {
    return;
  }

  const cityIdx = headerIndex(COL.city);
  if (cityIdx === -1) return;

  const aduIdx = headerIndex(COL.aduAllowed);
  const daduIdx = headerIndex(COL.daduAllowed);

  const statsByCity = new Map();

  rawRows.forEach((row) => {
    const city = (row[cityIdx] || "").trim();
    if (!city) return;

    if (!statsByCity.has(city)) {
      statsByCity.set(city, {
        count: 0,
        aduYes: 0,
        daduYes: 0,
      });
    }
    const stats = statsByCity.get(city);
    stats.count++;

    const aduVal = ((aduIdx !== -1 ? row[aduIdx] : "") || "")
      .toString()
      .toLowerCase();
    const daduVal = ((daduIdx !== -1 ? row[daduIdx] : "") || "")
      .toString()
      .toLowerCase();

    if (aduVal === "yes" || aduVal === "y" || aduVal === "true") {
      stats.aduYes++;
    }
    if (daduVal === "yes" || daduVal === "y" || daduVal === "true") {
      stats.daduYes++;
    }
  });

  const frag = document.createDocumentFragment();

  const entries = Array.from(statsByCity.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  entries.forEach(([city, stats]) => {
    const aduRatio = stats.count ? stats.aduYes / stats.count : 0;
    const daduRatio = stats.count ? stats.daduYes / stats.count : 0;
    const combined = (aduRatio + daduRatio) / 2;

    let grade = "C";
    if (combined >= 0.9) grade = "A+";
    else if (combined >= 0.75) grade = "A";
    else if (combined >= 0.6) grade = "B+";
    else if (combined >= 0.45) grade = "B";
    else if (combined >= 0.3) grade = "C+";
    else grade = "C";

    const card = document.createElement("div");
    card.className = "city-card";

    const title = document.createElement("h3");
    title.textContent = city;

    const meta = document.createElement("p");
    meta.className = "muted small";
    meta.textContent = `${stats.count} zoning row${stats.count === 1 ? "" : "s"} in dataset`;

    const aduLine = document.createElement("p");
    aduLine.className = "muted small";
    aduLine.textContent = `ADUs allowed in ${stats.aduYes} zone${stats.aduYes === 1 ? "" : "s"}, DADUs allowed in ${stats.daduYes} zone${stats.daduYes === 1 ? "" : "s"}.`;

    const gradeBadge = document.createElement("div");
    gradeBadge.className = "grade-pill";
    gradeBadge.textContent = grade;

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(aduLine);
    card.appendChild(gradeBadge);

    frag.appendChild(card);
  });

  container.appendChild(frag);
}
// =========================================
// PERMITS FEED (CLEAN + RESPONSIVE)
// =========================================

// How many rows we render without freezing the browser
// const MAX_PERMITS_RENDERED = 300;

function getPermitYear(row) {
  // 1) Try the Approval_Date column first (if you ever populate it later)
  const raw = getPermit(row, PCOL.approvalDate);
  if (raw) {
    const match = String(raw).match(/\b(19\d{2}|20\d{2})\b/);
    if (match) return match[1];

    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return String(d.getFullYear());
  }

  // 2) Fallback: pull "Permit year: 2020" from Notes
  const notes = getPermit(row, PCOL.notes);
  if (notes) {
    // Pattern like: "Permit year: 2019"
    const m = String(notes).match(/Permit year:\s*(19\d{2}|20\d{2})/i);
    if (m) return m[1];

    // As a last resort, grab any 4-digit year in the notes
    const m2 = String(notes).match(/\b(19\d{2}|20\d{2})\b/);
    if (m2) return m2[1];
  }

  return "";
}

function formatPermitDate(row) {
  const raw = getPermit(row, PCOL.approvalDate);
  if (raw && String(raw).trim()) {
    // If you later populate real dates, you could format them here.
    return String(raw).trim();
  }

  const yr = getPermitYear(row);
  return yr || "";
}

function initPermitsFilters() {
  const citySelect = document.getElementById("permitsCityFilter");
  const yearSelect = document.getElementById("permitsYearFilter");
  const clearBtn   = document.getElementById("permitsClearFilters");

  if (!citySelect || !yearSelect || !clearBtn) return;

  const citySet = new Set();
  const yearSet = new Set();

  permitRows.forEach((row) => {
    const city = getPermit(row, PCOL.city);
    if (city) citySet.add(city.trim());

    const yr = getPermitYear(row);
    if (yr) yearSet.add(yr);
  });

  // Build city filter
  citySelect.innerHTML = '<option value="">All cities</option>';
  [...citySet].sort().forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    citySelect.appendChild(opt);
  });

  // Build year filter
  yearSelect.innerHTML = '<option value="">All years</option>';
  [...yearSet].sort().forEach((y) => {
    const opt = document.createElement("option");
    opt.value = y;
    opt.textContent = y;
    yearSelect.appendChild(opt);
  });

  citySelect.addEventListener("change", applyPermitFilters);
  yearSelect.addEventListener("change", applyPermitFilters);
  clearBtn.addEventListener("click", () => {
    citySelect.value = "";
    yearSelect.value = "";
    filteredPermitRows = permitRows.slice();
    renderPermits();
  });

  filteredPermitRows = permitRows.slice();
  renderPermits();
}

function applyPermitFilters() {
  const cityVal = document.getElementById("permitsCityFilter").value.trim();
  const yearVal = document.getElementById("permitsYearFilter").value.trim();

  filteredPermitRows = permitRows.filter((row) => {
    const city = (getPermit(row, PCOL.city) || "").trim();
    const yr   = getPermitYear(row);

    if (cityVal && city !== cityVal) return false;
    if (yearVal && yr !== yearVal)   return false;

    return true;
  });

  renderPermits();
}

function renderPermits() {
  const tbody   = document.getElementById("permitsTableBody");
  const summary = document.getElementById("permitsSummary");
  const emptyState = document.getElementById("permitsEmpty");
  if (!tbody || !summary) return;

  tbody.innerHTML = "";

  if (!permitRows.length) {
    summary.textContent =
      "No permit dataset loaded yet. Add adu_permits.csv next to index.html to see permits.";
    if (emptyState) emptyState.hidden = false;
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9;
    td.className = "table-empty-row";
    td.textContent = "Permit data is unavailable.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    return;
  }

  // Base rows (filtered or not)
  const base =
    filteredPermitRows && filteredPermitRows.length
      ? filteredPermitRows
      : permitRows;

  // Drop cancelled
  const cleaned = base.filter((row) => {
    const status = (getPermit(row, PCOL.status) || "").toLowerCase();
    return !status.startsWith("cancel");
  });

  if (!cleaned.length) {
    summary.textContent = "No permits match the current filters.";
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 9;
    td.className = "table-empty-row";
    td.textContent = "No permit records meet the current criteria.";
    tr.appendChild(td);
    tbody.appendChild(tr);
    if (emptyState) emptyState.hidden = false;
    return;
  }

  if (emptyState) emptyState.hidden = true;

  // Limit rendered rows
  const rowsToShow = cleaned.slice(0, MAX_PERMITS_RENDERED);

  if (cleaned.length > rowsToShow.length) {
    summary.textContent =
      `${rowsToShow.length} permit(s) shown (first ${rowsToShow.length} of ${cleaned.length}).`;
  } else {
    summary.textContent = `${rowsToShow.length} permit(s) shown.`;
  }

  rowsToShow.forEach((row) => {
    const tr = document.createElement("tr");

    function cell(text) {
      const td = document.createElement("td");
      td.textContent = text || "—";
      tr.appendChild(td);
    }

    cell(getPermit(row, PCOL.city));
    cell(getPermit(row, PCOL.project));
    cell(getPermit(row, PCOL.type));
    cell(getPermit(row, PCOL.status));
    cell(getPermit(row, PCOL.size));
    cell(getPermit(row, PCOL.zone));
    cell(formatPermitDate(row));
    cell(getPermit(row, PCOL.permit));
    cell(getPermit(row, PCOL.parcel));

    const url = getPermit(row, PCOL.url);
    const td = document.createElement("td");
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Open";
      td.appendChild(a);
    } else {
      td.textContent = "—";
    }
    tr.appendChild(td);

    tbody.appendChild(tr);
  });
}

// =========================================
// FEASIBILITY CHECKER (INTERACTIVE DIAGRAM)
// =========================================

const FEAS_DIAGRAM_STATE = {
  scale: 1,
  drawWidthPx: 450,
  drawHeightPx: 260,
  marginPx: 16,
  lot: {
    widthFt: 40,
    depthFt: 100,
    maxFt: 200,
    frontSetFt: 20,
    sideSetFt: 5,
    rearSetFt: 25,
  },
  home: null,
  adu: null,
  svg: null,
  dragging: null,
  resizing: null,
  lotResize: null,
};

function initFeasibility() {
  const citySel = document.getElementById("feasCity");
  const zoneSel = document.getElementById("feasZone");
  const lotSizeInput = document.getElementById("feasLotSize");
  const lotWidthInput = document.getElementById("feasLotWidth");
  const lotDepthInput = document.getElementById("feasLotDepth");
  const houseWidthInput = document.getElementById("feasHouseWidth");
  const houseDepthInput = document.getElementById("feasHouseDepth");
  const aduInput = document.getElementById("feasADUSize");
  const transitCb = document.getElementById("feasTransit");
  const alleyCb = document.getElementById("feasAlley");
  const runBtn = document.getElementById("runFeasibility");

  if (
    !citySel ||
    !zoneSel ||
    !lotSizeInput ||
    !lotWidthInput ||
    !lotDepthInput ||
    !aduInput ||
    !transitCb ||
    !alleyCb ||
    !runBtn
  ) {
    return;
  }

  citySel.innerHTML = "";
  const cities = uniqueValues(COL.city);
  const optBlankCity = document.createElement("option");
  optBlankCity.value = "";
  optBlankCity.textContent = "Select city";
  citySel.appendChild(optBlankCity);
  cities.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    citySel.appendChild(opt);
  });

  function fillZonesForCity(city) {
    zoneSel.innerHTML = "";
    const optBlankZone = document.createElement("option");
    optBlankZone.value = "";
    optBlankZone.textContent = "Select zone";
    zoneSel.appendChild(optBlankZone);

    const zoneIdx = headerIndex(COL.zone);
    const cityIdx = headerIndex(COL.city);
    const set = new Set();

    rawRows.forEach((row) => {
      if (city && (row[cityIdx] || "").trim() !== city) return;
      const z = row[zoneIdx] && row[zoneIdx].trim();
      if (z) set.add(z);
    });

    Array.from(set)
      .sort((a, b) => a.localeCompare(b))
      .forEach((z) => {
        const opt = document.createElement("option");
        opt.value = z;
        opt.textContent = z;
        zoneSel.appendChild(opt);
      });
  }

  citySel.addEventListener("change", () => {
    fillZonesForCity(citySel.value || "");
  });

  runBtn.addEventListener("click", () => {
    const city = citySel.value || "";
    const zone = zoneSel.value || "";
    const lotSize = toNumber(lotSizeInput.value);
    const lotWidth = toNumber(lotWidthInput.value);
    const lotDepth = toNumber(lotDepthInput.value);
    const houseWidth = toNumber(houseWidthInput.value);
    const houseDepth = toNumber(houseDepthInput.value);
    const aduSize = toNumber(aduInput.value);
    const nearTransit = !!transitCb.checked;
    const hasAlley = !!alleyCb.checked;

    runFeasibilityCheck(
      city,
      zone,
      lotSize,
      aduSize,
      nearTransit,
      hasAlley,
      lotWidth,
      lotDepth,
      houseWidth,
      houseDepth
    );
  });

  function runFeasibilityCheck(
    city,
    zone,
    lotSize,
    aduSize,
    nearTransit,
    hasAlley,
    lotWidth,
    lotDepth,
    houseWidth,
    houseDepth
  ) {
    const summaryEl = document.getElementById("feasibilitySummary");
    const detailsEl = document.getElementById("feasibilityDetails");
    const diagramEl = document.getElementById("feasDiagram");
    if (!summaryEl || !detailsEl || !diagramEl) return;

    detailsEl.innerHTML = "";
    diagramEl.innerHTML = "";

    if (!city || !zone) {
      summaryEl.textContent = "Select a city and zone to run a check.";
      return;
    }

    if (!lotSize && lotWidth && lotDepth) {
      lotSize = Math.round(lotWidth * lotDepth);
      lotSizeInput.value = lotSize;
    }

    if (!lotSize || isNaN(lotSize) || lotSize <= 0) {
      summaryEl.textContent = "Enter a valid lot size in square feet.";
      return;
    }

    const cityIdx = headerIndex(COL.city);
    const zoneIdx = headerIndex(COL.zone);

    const matches = rawRows.filter(
      (row) =>
        (row[cityIdx] || "").trim() === city &&
        (row[zoneIdx] || "").trim() === zone
    );

    if (!matches.length) {
      summaryEl.textContent =
        "No rows found for that city/zone combination in the dataset.";
      return;
    }

    const row = matches[0];

    const aduAllowed = (get(row, COL.aduAllowed) || "").toLowerCase();
    const daduAllowed = (get(row, COL.daduAllowed) || "").toLowerCase();
    const minLotSize = toNumber(get(row, COL.minLotSize));
    const maxADUSize = toNumber(get(row, COL.maxADUSize));
    const maxDADUSize = toNumber(get(row, COL.maxDADUSize));
    const parkingReq = (get(row, COL.aduParkingReq) || "").toLowerCase();
    const parkingNotes = get(row, COL.parkingNotes) || "";
    const parkingTransitFlag = (get(row, COL.aduParkingTransit) || "").toLowerCase();
    const parkingSmallFlag = (get(row, COL.aduParkingSmall) || "").toLowerCase();
    const ownerOcc = get(row, COL.ownerOcc) || "";
    const frontSetback = get(row, COL.frontSetback);
    const sideSetback = get(row, COL.sideSetback);
    const rearSetback = get(row, COL.rearSetback);
    const heightPrimary = get(row, COL.heightPrimary);
    const heightDADU = get(row, COL.heightDADU);
    const impactFees = get(row, COL.impactFees);
    const notes = get(row, COL.notes);
    const daduSetbackNotes = get(row, COL.daduSetbackNotes);

    const bulletPoints = [];
    let feasibilityOK = true;

    if (aduAllowed === "yes" || aduAllowed === "y" || aduAllowed === "true") {
      bulletPoints.push("ADUs are allowed in this zone.");
    } else if (aduAllowed) {
      bulletPoints.push(`ADUs may be restricted: ADU_Allowed = "${aduAllowed}".`);
      feasibilityOK = false;
    } else {
      bulletPoints.push("ADU allowance is not clearly specified in the dataset.");
    }

    if (daduAllowed === "yes" || daduAllowed === "y" || daduAllowed === "true") {
      bulletPoints.push("Detached ADUs (DADUs) are allowed in this zone.");
    } else if (daduAllowed) {
      bulletPoints.push(
        `Detached ADUs may be restricted: DADU_Allowed = "${daduAllowed}".`
      );
    }

    if (minLotSize != null) {
      if (lotSize >= minLotSize) {
        bulletPoints.push(
          `Lot size (${lotSize.toLocaleString()} sf) meets the minimum lot size (${minLotSize.toLocaleString()} sf).`
        );
      } else {
        bulletPoints.push(
          `Lot size (${lotSize.toLocaleString()} sf) is below the minimum lot size (${minLotSize.toLocaleString()} sf) recorded for this zone.`
        );
        feasibilityOK = false;
      }
    } else {
      bulletPoints.push("Minimum lot size is not defined in the dataset.");
    }

    if (aduSize != null && !isNaN(aduSize) && aduSize > 0) {
      if (maxADUSize != null) {
        if (aduSize <= maxADUSize) {
          bulletPoints.push(
            `Target ADU size (${aduSize} sf) is within the maximum ADU size (${maxADUSize} sf).`
          );
        } else {
          bulletPoints.push(
            `Target ADU size (${aduSize} sf) exceeds the maximum ADU size (${maxADUSize} sf) recorded for this zone.`
          );
          feasibilityOK = false;
        }
      } else {
        bulletPoints.push(
          "Maximum ADU size is not explicitly recorded; confirm against the municipal code."
        );
      }
    } else {
      bulletPoints.push(
        "No ADU size entered; size-based feasibility not evaluated."
      );
    }

    let parkingSummary = "";
    if (!parkingReq) {
      parkingSummary =
        "Parking requirement not clearly recorded; check code for stall counts.";
    } else if (parkingReq === "no") {
      parkingSummary = "Dataset indicates no additional ADU parking is required.";
    } else {
      let base = "ADU parking is required per the dataset.";
      let relief = [];

      if (
        nearTransit &&
        (parkingTransitFlag === "yes" ||
          parkingNotes.toLowerCase().includes("transit"))
      ) {
        relief.push("near transit");
      }
      if (
        aduSize != null &&
        aduSize > 0 &&
        (parkingSmallFlag === "yes" ||
          parkingNotes.toLowerCase().includes("small"))
      ) {
        relief.push("small-unit exemption");
      }

      if (relief.length) {
        parkingSummary =
          base +
          ` However, exemptions/relief are likely available due to ${relief.join(
            " and "
          )}.`;
      } else {
        parkingSummary = base;
      }
    }
    bulletPoints.push(parkingSummary);

    if (hasAlley) {
      if (
        (get(row, COL.alleyAccess) || "").toLowerCase() === "yes" ||
        daduSetbackNotes.toLowerCase().includes("alley")
      ) {
        bulletPoints.push(
          "Alley access is available and the dataset notes special alley-facing standards that may reduce rear/side setbacks."
        );
      } else {
        bulletPoints.push(
          "Alley access is present but no explicit alley-based relief is recorded; check code text for possible reduced setbacks."
        );
      }
    }

    const sh = [];
    if (frontSetback) sh.push(`front: ${frontSetback} ft`);
    if (sideSetback) sh.push(`side: ${sideSetback} ft`);
    if (rearSetback) sh.push(`rear: ${rearSetback} ft`);
    if (sh.length) {
      bulletPoints.push(`Base setbacks in the dataset: ${sh.join(", ")}.`);
    }

    const hh = [];
    if (heightPrimary) hh.push(`primary: ${heightPrimary} ft`);
    if (heightDADU) hh.push(`DADU: ${heightDADU} ft`);
    if (hh.length) {
      bulletPoints.push(`Height limits: ${hh.join(", ")}.`);
    }

    if (ownerOcc) {
      bulletPoints.push(`Owner-occupancy: ${ownerOcc}.`);
    }
    if (impactFees) {
      bulletPoints.push(`Impact fee notes: ${impactFees}.`);
    }
    if (notes) {
      bulletPoints.push(`Zone notes: ${notes}`);
    }

    summaryEl.innerHTML = feasibilityOK
      ? `<span class="feasibility-good">Likely feasible</span> based on the dataset for one ADU/DADU in ${city} ${zone}, subject to formal review.`
      : `<span class="feasibility-bad">Potential issues detected</span> — see details and confirm with the city.`;

    const h3 = document.createElement("h3");
    h3.textContent = "Key checks";

    const ul = document.createElement("ul");
    bulletPoints.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      ul.appendChild(li);
    });

    const disclaimer = document.createElement("p");
    disclaimer.style.marginTop = "0.4rem";
    disclaimer.style.fontSize = "0.75rem";
    disclaimer.style.color = "#6b7280";
    disclaimer.textContent =
      "This is a simplified feasibility snapshot generated from your spreadsheet and may not capture overlays, critical areas, or recent code changes. Always verify with the municipal code and planning staff.";

    detailsEl.appendChild(h3);
    detailsEl.appendChild(ul);
    detailsEl.appendChild(disclaimer);

    drawFeasDiagram(
      row,
      lotSize,
      lotWidth,
      lotDepth,
      houseWidth,
      houseDepth,
      aduSize
    );
  }

  function drawFeasDiagram(
    row,
    lotSize,
    lotWidthInput,
    lotDepthInput,
    houseWidthInput,
    houseDepthInput,
    aduSize
  ) {
    const diagramEl = document.getElementById("feasDiagram");
    if (!diagramEl) return;

    FEAS_DIAGRAM_STATE.home = null;
    FEAS_DIAGRAM_STATE.adu = null;
    FEAS_DIAGRAM_STATE.dragging = null;
    FEAS_DIAGRAM_STATE.resizing = null;
    FEAS_DIAGRAM_STATE.lotResize = null;

    const lotWidthFt = lotWidthInput && lotWidthInput > 0 ? lotWidthInput : 40;
    const lotDepthFt = lotDepthInput && lotDepthInput > 0 ? lotDepthInput : 100;

    const frontSetFt = toNumber(get(row, COL.frontSetback)) ?? 20;
    const sideSetFt = toNumber(get(row, COL.sideSetback)) ?? 5;
    const rearSetFt = toNumber(get(row, COL.rearSetback)) ?? 25;

    FEAS_DIAGRAM_STATE.lot.widthFt = lotWidthFt;
    FEAS_DIAGRAM_STATE.lot.depthFt = lotDepthFt;
    FEAS_DIAGRAM_STATE.lot.frontSetFt = frontSetFt;
    FEAS_DIAGRAM_STATE.lot.sideSetFt = sideSetFt;
    FEAS_DIAGRAM_STATE.lot.rearSetFt = rearSetFt;
    FEAS_DIAGRAM_STATE.lot.maxFt = 200;

    const marginPx = FEAS_DIAGRAM_STATE.marginPx;
    const drawWidthPx = FEAS_DIAGRAM_STATE.drawWidthPx;
    const drawHeightPx = FEAS_DIAGRAM_STATE.drawHeightPx;

    const maxPixelHeight = drawHeightPx - 2 * marginPx;
    const scale = maxPixelHeight / lotDepthFt;
    FEAS_DIAGRAM_STATE.scale = scale;

    const lotPixelHeight = lotDepthFt * scale;
    const lotPixelWidth = lotWidthFt * scale;
    const lotLeftPx = (drawWidthPx - lotPixelWidth) / 2;
    const lotTopPx = marginPx;

    const ftToPxX = (ft) => lotLeftPx + ft * scale;
    const ftToPxY = (ft) => lotTopPx + ft * scale;
    const pxToFtX = (px) => (px - lotLeftPx) / scale;
    const pxToFtY = (px) => (px - lotTopPx) / scale;

    const buildableLeftFt = sideSetFt;
    const buildableTopFt = frontSetFt;
    const buildableWidthFt = Math.max(
      lotWidthFt - 2 * sideSetFt,
      5
    );
    const buildableHeightFt = Math.max(
      lotDepthFt - frontSetFt - rearSetFt,
      5
    );

    const defaultHomeWidthFt = lotWidthFt * 0.6;
    const defaultHomeDepthFt = lotDepthFt * 0.35;

    const homeWidthFt =
      houseWidthInput && houseWidthInput > 0
        ? houseWidthInput
        : defaultHomeWidthFt;
    const homeDepthFt =
      houseDepthInput && houseDepthInput > 0
        ? houseDepthInput
        : defaultHomeDepthFt;

    const homeXFt =
      buildableLeftFt + (buildableWidthFt - homeWidthFt) * 0.5;
    const homeYFt = buildableTopFt + 2;

    let aduWidthFt = 20;
    let aduDepthFt = 20;
    if (aduSize && aduSize > 0) {
      const side = Math.sqrt(aduSize);
      aduWidthFt = side;
      aduDepthFt = side;
    }

    aduWidthFt = Math.min(aduWidthFt, buildableWidthFt * 0.8);
    aduDepthFt = Math.min(aduDepthFt, buildableHeightFt * 0.6);

    const aduXFt = buildableLeftFt + (buildableWidthFt - aduWidthFt) * 0.5;
    const aduYFt =
      buildableTopFt + buildableHeightFt - aduDepthFt - 2;

    FEAS_DIAGRAM_STATE.home = {
      xFt: homeXFt,
      yFt: homeYFt,
      widthFt: homeWidthFt,
      depthFt: homeDepthFt,
    };

    FEAS_DIAGRAM_STATE.adu = {
      xFt: aduXFt,
      yFt: aduYFt,
      widthFt: aduWidthFt,
      depthFt: aduDepthFt,
      baseTargetSqft: aduSize || null,
    };

    const lotLabel =
      "Lot" + (lotSize ? ` (${lotSize.toLocaleString()} sf)` : "");

    diagramEl.innerHTML = `
      <svg id="feasSvg" width="100%" height="100%" viewBox="0 0 ${drawWidthPx} ${drawHeightPx}">
        <rect id="lotRect"
              x="${lotLeftPx}" y="${lotTopPx}"
              width="${lotPixelWidth}"
              height="${lotPixelHeight}"
              fill="#f9fafb" stroke="#9ca3af" stroke-width="2" rx="10" ry="10" />
        <text id="lotLabel"
              x="${lotLeftPx + 8}" y="${lotTopPx + 16}"
              font-size="12" fill="#4b5563">
          ${lotLabel}
        </text>

        <rect id="buildableRect"
              x="${ftToPxX(buildableLeftFt)}"
              y="${ftToPxY(buildableTopFt)}"
              width="${buildableWidthFt * scale}"
              height="${buildableHeightFt * scale}"
              fill="rgba(59,130,246,0.06)"
              stroke="#3b82f6" stroke-dasharray="4 4" stroke-width="1.5"
              rx="6" ry="6" />
        <text id="buildableLabel"
              x="${ftToPxX(buildableLeftFt) + 6}"
              y="${ftToPxY(buildableTopFt) + 16}"
              font-size="11" fill="#1f2937">
          Buildable area (setbacks)
        </text>

        <circle id="lotHandleRight"
                class="lot-handle"
                cx="${lotLeftPx + lotPixelWidth}"
                cy="${lotTopPx + lotPixelHeight / 2}"
                r="6" fill="#10b981" stroke="#064e3b" stroke-width="1.5" />
        <circle id="lotHandleBottom"
                class="lot-handle"
                cx="${lotLeftPx + lotPixelWidth / 2}"
                cy="${lotTopPx + lotPixelHeight}"
                r="6" fill="#10b981" stroke="#064e3b" stroke-width="1.5" />

        <g id="homeGroup" class="shape-group" data-shape="home">
          <rect id="homeRect" fill="#111827" rx="6" ry="6" />
          <text id="homeLabel" font-size="11"></text>
          <circle class="resize-handle" data-shape="home" data-corner="tl" r="5" fill="#fbbf24" />
          <circle class="resize-handle" data-shape="home" data-corner="tr" r="5" fill="#fbbf24" />
          <circle class="resize-handle" data-shape="home" data-corner="bl" r="5" fill="#fbbf24" />
          <circle class="resize-handle" data-shape="home" data-corner="br" r="5" fill="#fbbf24" />
        </g>

        <g id="aduGroup" class="shape-group" data-shape="adu">
          <rect id="aduRect" fill="rgba(79,70,229,0.85)" rx="6" ry="6" />
          <text id="aduLabel" font-size="11"></text>
          <circle class="resize-handle" data-shape="adu" data-corner="tl" r="5" fill="#f97316" />
          <circle class="resize-handle" data-shape="adu" data-corner="tr" r="5" fill="#f97316" />
          <circle class="resize-handle" data-shape="adu" data-corner="bl" r="5" fill="#f97316" />
          <circle class="resize-handle" data-shape="adu" data-corner="br" r="5" fill="#f97316" />
        </g>

        <text x="${drawWidthPx / 2}"
              y="${lotTopPx - 6}"
              text-anchor="middle" font-size="11" fill="#6b7280">
          Street / front of lot
        </text>
      </svg>
    `;

    const svg = document.getElementById("feasSvg");
    FEAS_DIAGRAM_STATE.svg = svg;

    const lotRect = document.getElementById("lotRect");
    const lotLabelEl = document.getElementById("lotLabel");
    const buildableRect = document.getElementById("buildableRect");
    const buildableLabel = document.getElementById("buildableLabel");
    const lotHandleRight = document.getElementById("lotHandleRight");
    const lotHandleBottom = document.getElementById("lotHandleBottom");
    const homeRect = document.getElementById("homeRect");
    const aduRect = document.getElementById("aduRect");
    const homeLabel = document.getElementById("homeLabel");
    const aduLabel = document.getElementById("aduLabel");
    const homeGroup = document.getElementById("homeGroup");
    const aduGroup = document.getElementById("aduGroup");
    const handles = svg.querySelectorAll(".resize-handle");

    function clampShape(shape) {
      const lot = FEAS_DIAGRAM_STATE.lot;
      shape.xFt = Math.max(0, Math.min(lot.widthFt - shape.widthFt, shape.xFt));
      shape.yFt = Math.max(0, Math.min(lot.depthFt - shape.depthFt, shape.yFt));
    }

    function redrawAll() {
      const lot = FEAS_DIAGRAM_STATE.lot;
      const home = FEAS_DIAGRAM_STATE.home;
      const adu = FEAS_DIAGRAM_STATE.adu;

      clampShape(home);
      clampShape(adu);

      const lotWpx = lot.widthFt * scale;
      const lotHpx = lot.depthFt * scale;

      lotRect.setAttribute("x", lotLeftPx);
      lotRect.setAttribute("y", lotTopPx);
      lotRect.setAttribute("width", lotWpx);
      lotRect.setAttribute("height", lotHpx);

      const lotArea = Math.round(lot.widthFt * lot.depthFt);
      lotLabelEl.textContent =
        "Lot" + (lotArea ? ` (${lotArea.toLocaleString()} sf)` : "");

      const bLeftFt = lot.sideSetFt;
      const bTopFt = lot.frontSetFt;
      const bWidthFt = Math.max(lot.widthFt - 2 * lot.sideSetFt, 5);
      const bHeightFt = Math.max(
        lot.depthFt - lot.frontSetFt - lot.rearSetFt,
        5
      );

      buildableRect.setAttribute("x", ftToPxX(bLeftFt));
      buildableRect.setAttribute("y", ftToPxY(bTopFt));
      buildableRect.setAttribute("width", bWidthFt * scale);
      buildableRect.setAttribute("height", bHeightFt * scale);

      buildableLabel.setAttribute("x", ftToPxX(bLeftFt) + 6);
      buildableLabel.setAttribute("y", ftToPxY(bTopFt) + 16);

      lotHandleRight.setAttribute("cx", lotLeftPx + lotWpx);
      lotHandleRight.setAttribute("cy", lotTopPx + lotHpx / 2);
      lotHandleBottom.setAttribute("cx", lotLeftPx + lotWpx / 2);
      lotHandleBottom.setAttribute("cy", lotTopPx + lotHpx);

      const hx = ftToPxX(home.xFt);
      const hy = ftToPxY(home.yFt);
      const hw = home.widthFt * scale;
      const hh = home.depthFt * scale;

      homeRect.setAttribute("x", hx);
      homeRect.setAttribute("y", hy);
      homeRect.setAttribute("width", hw);
      homeRect.setAttribute("height", hh);

      const homeArea = Math.round(home.widthFt * home.depthFt);
      homeLabel.textContent = `Existing home (${homeArea.toLocaleString()} sf)`;
      homeLabel.setAttribute("x", hx + 8);
      homeLabel.setAttribute("y", hy + 16);
      homeLabel.setAttribute("fill", "#111827");

      const homeHandles = svg.querySelectorAll(
        '.resize-handle[data-shape="home"]'
      );
      homeHandles.forEach((h) => {
        const corner = h.getAttribute("data-corner");
        let cx = hx;
        let cy = hy;
        if (corner.includes("r")) cx = hx + hw;
        if (corner.includes("b")) cy = hy + hh;
        h.setAttribute("cx", cx);
        h.setAttribute("cy", cy);
      });

      const ax = ftToPxX(adu.xFt);
      const ay = ftToPxY(adu.yFt);
      const aw = adu.widthFt * scale;
      const ah = adu.depthFt * scale;

      aduRect.setAttribute("x", ax);
      aduRect.setAttribute("y", ay);
      aduRect.setAttribute("width", aw);
      aduRect.setAttribute("height", ah);

      const aduArea = Math.round(adu.widthFt * adu.depthFt);
      aduLabel.textContent = `ADU (${aduArea.toLocaleString()} sf)`;
      aduLabel.setAttribute("x", ax + 8);
      aduLabel.setAttribute("y", ay + 16);
      aduLabel.setAttribute("fill", "#111827");

      const aduHandles = svg.querySelectorAll(
        '.resize-handle[data-shape="adu"]'
      );
      aduHandles.forEach((h) => {
        const corner = h.getAttribute("data-corner");
        let cx = ax;
        let cy = ay;
        if (corner.includes("r")) cx = ax + aw;
        if (corner.includes("b")) cy = ay + ah;
        h.setAttribute("cx", cx);
        h.setAttribute("cy", cy);
      });

      const widthInput = document.getElementById("feasLotWidth");
      const depthInput = document.getElementById("feasLotDepth");
      const sizeInput = document.getElementById("feasLotSize");
      if (widthInput) widthInput.value = Math.round(lot.widthFt);
      if (depthInput) depthInput.value = Math.round(lot.depthFt);
      if (sizeInput) sizeInput.value = lotArea;
    }

    redrawAll();

    function startDragShape(evt, shapeName) {
      const shape = FEAS_DIAGRAM_STATE[shapeName];
      const pt = svg.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
      const offsetXFt = pxToFtX(svgPt.x) - shape.xFt;
      const offsetYFt = pxToFtY(svgPt.y) - shape.yFt;
      FEAS_DIAGRAM_STATE.dragging = { shape: shapeName, offsetXFt, offsetYFt };
    }

    homeGroup.onmousedown = (e) => {
      if (e.target.classList.contains("resize-handle")) return;
      startDragShape(e, "home");
    };

    aduGroup.onmousedown = (e) => {
      if (e.target.classList.contains("resize-handle")) return;
      startDragShape(e, "adu");
    };

    function startResize(evt, shapeName, corner) {
      FEAS_DIAGRAM_STATE.resizing = { shape: shapeName, corner };
      evt.stopPropagation();
    }

    handles.forEach((h) => {
      h.onmousedown = (e) => {
        const shapeName = h.getAttribute("data-shape");
        const corner = h.getAttribute("data-corner");
        startResize(e, shapeName, corner);
      };
    });

    lotHandleRight.onmousedown = (e) => {
      FEAS_DIAGRAM_STATE.lotResize = { edge: "right" };
      e.stopPropagation();
    };

    lotHandleBottom.onmousedown = (e) => {
      FEAS_DIAGRAM_STATE.lotResize = { edge: "bottom" };
      e.stopPropagation();
    };

    svg.onmousemove = (evt) => {
      const lot = FEAS_DIAGRAM_STATE.lot;

      const pt = svg.createSVGPoint();
      pt.x = evt.clientX;
      pt.y = evt.clientY;
      const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());

      if (FEAS_DIAGRAM_STATE.dragging) {
        const drag = FEAS_DIAGRAM_STATE.dragging;
        const shape = FEAS_DIAGRAM_STATE[drag.shape];
        const newXFt = pxToFtX(svgPt.x) - drag.offsetXFt;
        const newYFt = pxToFtY(svgPt.y) - drag.offsetYFt;
        shape.xFt = newXFt;
        shape.yFt = newYFt;
        redrawAll();
        return;
      }

      if (FEAS_DIAGRAM_STATE.resizing) {
        const rs = FEAS_DIAGRAM_STATE.resizing;
        const shape = FEAS_DIAGRAM_STATE[rs.shape];

        const lotXFt = pxToFtX(svgPt.x);
        const lotYFt = pxToFtY(svgPt.y);
        const minSizeFt = 5;

        if (rs.corner === "tl") {
          const newRightFt = shape.xFt + shape.widthFt;
          let newXFt = Math.min(lotXFt, newRightFt - minSizeFt);
          newXFt = Math.max(0, newXFt);
          shape.widthFt = newRightFt - newXFt;
          shape.xFt = newXFt;
        } else if (rs.corner === "tr") {
          const newWidthFt = Math.max(minSizeFt, lotXFt - shape.xFt);
          shape.widthFt = Math.min(newWidthFt, lot.widthFt - shape.xFt);
        } else if (rs.corner === "bl") {
          const newBottomFt = shape.yFt + shape.depthFt;
          let newYFt = Math.min(lotYFt, newBottomFt - minSizeFt);
          newYFt = Math.max(0, newYFt);
          shape.depthFt = newBottomFt - newYFt;
          shape.yFt = newYFt;
        } else if (rs.corner === "br") {
          const newDepthFt = Math.max(minSizeFt, lotYFt - shape.yFt);
          shape.depthFt = Math.min(newDepthFt, lot.depthFt - shape.yFt);
        }

        redrawAll();
        return;
      }

      if (FEAS_DIAGRAM_STATE.lotResize) {
        const lr = FEAS_DIAGRAM_STATE.lotResize;
        if (lr.edge === "right") {
          let newWidthFt = (svgPt.x - lotLeftPx) / scale;
          newWidthFt = Math.max(20, Math.min(lot.maxFt, newWidthFt));
          lot.widthFt = newWidthFt;
        } else if (lr.edge === "bottom") {
          let newDepthFt = (svgPt.y - lotTopPx) / scale;
          newDepthFt = Math.max(20, Math.min(lot.maxFt, newDepthFt));
          lot.depthFt = newDepthFt;
        }
        redrawAll();
      }
    };

    window.onmouseup = () => {
      FEAS_DIAGRAM_STATE.dragging = null;
      FEAS_DIAGRAM_STATE.resizing = null;
      FEAS_DIAGRAM_STATE.lotResize = null;
    };
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
        "Error loading zoning data. Check that data.csv exists next to index.html (or update CSV_URL in app.js) and that the file is published.";
    }
    renderPermits();
    return;
  }

  try {
    await loadPermitsData();
  } catch (err) {
    console.warn("Error loading permits data (non-fatal):", err);
  }

  try {
    buildTableHeader();
    renderCityScorecards();
    initFilters();
    applyFilters();
    initFeasibility();

    if (permitRows.length) {
      initPermitsFilters();
      filteredPermitRows = permitRows.slice();
      renderPermits();
    } else {
      renderPermits();
    }
  } catch (err) {
    console.error("Error initializing UI:", err);
    if (summary && !summary.textContent) {
      summary.textContent =
        "Data loaded, but there was an error building the interface. Open the browser console for details.";
    }
  }
}

document.addEventListener("DOMContentLoaded", initApp);
