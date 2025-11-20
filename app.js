// =========================================
// CONFIG & GLOBAL STATE
// =========================================

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
  maxADUs: "Max_ADUs_Per_Lot",
  maxADUSize: "Max_ADU_Size_Sqft",
  maxADUSizePct: "Max_ADU_Size_Percent_Primary",
  maxDADUSize: "Max_DADU_Size_Sqft",
  minLotSize: "Min_Lot_Size_Sqft",
  minParking: "Min_Parking_Spaces",
  parkingNotes: "Parking_Notes",
  alleyAccess: "Alley_Access_Allowed",
  ownerOcc: "Owner_Occupancy_Required",
  ownerOccNotes: "Owner_Occupancy_Notes",
  frontSetback: "Min_Front_Setback_ft",
  sideSetback: "Min_Side_Setback_ft",
  rearSetback: "Min_Rear_Setback_ft",
  heightPrimary: "Max_Building_Height_Primary_ft",
  heightDADU: "DADU_Max_Height_ft",
  codeSection: "Reference_Code_Section",
  sourceURL: "Source_Document_URL",
  notes: "Notes",
  maxHardSurface: "Max_Hard_Surface_Percent",
  maxImpervious: "Max_Impervious_Surface_Percent",
  aduParkingReq: "ADU_Parking_Required",
  aduParkingSmall: "ADU_Parking_Exempt_If_Small",
  aduParkingTransit: "ADU_Parking_Exempt_If_Transit",
  impactFees: "Impact_Fees_Notes",
  aduConversionAllowed: "ADU_Conversion_Allowed",
  aduConversionNotes: "ADU_Conversion_Notes",
  daduSetbackNotes: "DADU_Setback_Notes",
};

// Column map for permits dataset
const PCOL = {
  city: "City",
  project: "Project_Name",
  type: "ADU_Type",
  status: "Status",
  permitNumber: "Permit_Number",
  parcel: "Parcel",
  zone: "Zone",
  size: "ADU_Size_Sqft",
  approvalDate: "Approval_Date",
  url: "Source_URL",
  notes: "Notes",
};

// Approximate map coordinates
const CITY_COORDS = {
  Bellevue: [47.6101, -122.2015],
  Seattle: [47.6062, -122.3321],
  Shoreline: [47.7557, -122.3415],
  Redmond: [47.673, -122.121],
  Kirkland: [47.678, -122.207],
  Bothell: [47.761, -122.205],
  Renton: [47.4829, -122.2171],
  Burien: [47.4704, -122.3468],
  Issaquah: [47.5326, -122.0429],
};

// =========================================
// CSV PARSER
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
    throw new Error("Could not find a header row in zoning CSV");
  }

  headers = parsed[headerRowIndex].map((h) => (h || "").trim());
  const dataRows = parsed.slice(headerRowIndex + 1);

  rawRows = dataRows.filter((row) =>
    row.some((cell) => cell && cell.trim() !== "")
  );
  filteredRows = rawRows.slice();
}

async function loadPermitsData() {
  try {
    const res = await fetch(PERMITS_URL);
    if (!res.ok) {
      permitHeaders = [];
      permitRows = [];
      filteredPermitRows = [];
      return;
    }
    const text = await res.text();
    const parsed = parseCSV(text);
    if (!parsed.length) {
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

    permitHeaders = parsed[headerRowIndex].map((h) => (h || "").trim());
    const dataRows = parsed.slice(headerRowIndex + 1);

    permitRows = dataRows.filter((row) =>
      row.some((cell) => cell && cell.trim() !== "")
    );
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

function permitsHeaderIndex(name) {
  return permitHeaders.indexOf(name);
}

function get(row, colName) {
  const idx = headerIndex(colName);
  if (idx === -1) return "";
  const val = row[idx];
  return val == null ? "" : String(val).trim();
}

function getPermit(row, colName) {
  const idx = permitsHeaderIndex(colName);
  if (idx === -1) return "";
  const val = row[idx];
  return val == null ? "" : String(val).trim();
}

function toNumber(val) {
  if (val == null || val === "") return null;
  const n = parseFloat(String(val).replace(/,/g, ""));
  return isNaN(n) ? null : n;
}

function uniqueValues(colName) {
  const idx = headerIndex(colName);
  if (idx === -1) return [];
  const set = new Set();
  rawRows.forEach((row) => {
    const v = row[idx] && row[idx].trim();
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

function uniquePermitValues(colName) {
  const idx = permitsHeaderIndex(colName);
  if (idx === -1) return [];
  const set = new Set();
  permitRows.forEach((row) => {
    const v = row[idx] && row[idx].trim();
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

// =========================================
// TABLE RENDERING
// =========================================

function buildTableHeader() {
  const thead = document.getElementById("tableHead");
  thead.innerHTML = "";
  const tr = document.createElement("tr");

  headers.forEach((h) => {
    const th = document.createElement("th");
    th.textContent = h || "—";
    tr.appendChild(th);
  });

  thead.appendChild(tr);
}

function renderTable() {
  const tbody = document.getElementById("tableBody");
  const summary = document.getElementById("summary");
  tbody.innerHTML = "";

  if (summary) {
    summary.textContent = `${filteredRows.length} of ${rawRows.length} zoning rows shown`;
  }

  const urlIdx = headerIndex(COL.sourceURL);

  filteredRows.forEach((row) => {
    const tr = document.createElement("tr");

    row.forEach((cell, i) => {
      const td = document.createElement("td");
      const rawText = cell == null ? "" : String(cell).trim();
      const text = rawText || "—";

      if (i === urlIdx && rawText) {
        const a = document.createElement("a");
        a.href = rawText;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = "Code link";
        td.appendChild(a);
      } else {
        td.textContent = text;
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

// =========================================
// FILTERS
// =========================================

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

// =========================================
// MAP
// =========================================

function initMap() {
  const mapEl = document.getElementById("map");
  if (!mapEl || typeof L === "undefined") return;

  const map = L.map("map").setView([47.55, -122.2], 10);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  const cityIdx = headerIndex(COL.city);
  const zoneIdx = headerIndex(COL.zone);
  const aduIdx = headerIndex(COL.aduAllowed);
  const daduIdx = headerIndex(COL.daduAllowed);
  const notesIdx = headerIndex(COL.notes);

  const seen = new Set();

  rawRows.forEach((row) => {
    const city = (row[cityIdx] || "").trim();
    if (!city || seen.has(city)) return;
    seen.add(city);

    const coords = CITY_COORDS[city] || [47.6, -122.2];
    const zone = row[zoneIdx] || "—";
    const adu = row[aduIdx] || "—";
    const dadu = row[daduIdx] || "—";
    const notes = row[notesIdx] || "—";

    const popupHTML = `
      <strong>${city}</strong><br/>
      Example zone: ${zone}<br/>
      ADUs allowed: ${adu} | DADUs allowed: ${dadu}<br/>
      <small>${notes}</small>
    `;

    L.marker(coords).addTo(map).bindPopup(popupHTML);
  });
}

// =========================================
// SCORECARD
// =========================================

function computeCityMetrics(cityRows) {
  const lotSizes = [];
  const heights = [];

  let maxADUsAllowed = 0;
  let parkingScoreRaw = 0;
  let parkingCount = 0;

  let ownerOccGood = true;
  let alleyFlex = false;
  let conversionsGood = false;
  let feesGood = false;
  let parkingTransit = false;

  cityRows.forEach((row) => {
    const maxADUsVal = toNumber(get(row, COL.maxADUs));
    if (maxADUsVal && maxADUsVal > maxADUsAllowed) {
      maxADUsAllowed = maxADUsVal;
    }

    const lotSize = toNumber(get(row, COL.minLotSize));
    if (lotSize != null) lotSizes.push(lotSize);

    const h = toNumber(get(row, COL.heightPrimary));
    if (h != null) heights.push(h);

    const parkingReq = (get(row, COL.aduParkingReq) || "").toLowerCase();
    const parkingNotes = (get(row, COL.parkingNotes) || "").toLowerCase();
    const parkingTransitFlag = (get(row, COL.aduParkingTransit) || "").toLowerCase();
    const parkingSmallFlag = (get(row, COL.aduParkingSmall) || "").toLowerCase();

    if (parkingReq) {
      parkingCount++;
      let val = 0.3;
      if (parkingReq === "no") val = 1;
      else if (parkingReq === "conditional") val = 0.6;

      if (
        parkingNotes.includes("no parking required") ||
        parkingTransitFlag === "yes" ||
        parkingSmallFlag === "yes"
      ) {
        val = Math.max(val, 0.8);
        parkingTransit = true;
      }
      parkingScoreRaw += val;
    }

    const ownerReq = (get(row, COL.ownerOcc) || "").toLowerCase();
    if (ownerReq === "yes") ownerOccGood = false;

    const daduNotes = (get(row, COL.daduSetbackNotes) || "").toLowerCase();
    if (daduNotes.includes("alley") && daduNotes.includes("0 ft")) {
      alleyFlex = true;
    }

    const convAllowed = (get(row, COL.aduConversionAllowed) || "").toLowerCase();
    const convNotes = (get(row, COL.aduConversionNotes) || "").toLowerCase();
    if (convAllowed === "yes" || convNotes.includes("convert")) {
      conversionsGood = true;
    }

    const feeNotes = (get(row, COL.impactFees) || "").toLowerCase();
    if (feeNotes.includes("not required") || feeNotes.includes("waived")) {
      feesGood = true;
    }
  });

  const median = (arr) => {
    if (!arr.length) return null;
    const s = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
  };

  const medianLot = median(lotSizes);
  const medianHeight = median(heights);
  const avgParkingScore = parkingCount ? parkingScoreRaw / parkingCount : 0.5;

  return {
    maxADUsAllowed,
    medianLot,
    medianHeight,
    avgParkingScore,
    ownerOccGood,
    alleyFlex,
    conversionsGood,
    feesGood,
    parkingTransit,
  };
}

function scoreFromMetrics(m) {
  const aduCountFactor =
    m.maxADUsAllowed >= 2 ? 1 :
    m.maxADUsAllowed === 1 ? 0.6 :
    0.2;

  let lotFactor = 0.5;
  if (m.medianLot != null) {
    if (m.medianLot <= 3000) lotFactor = 1;
    else if (m.medianLot <= 5000) lotFactor = 0.8;
    else if (m.medianLot <= 7200) lotFactor = 0.6;
    else if (m.medianLot <= 10000) lotFactor = 0.4;
    else lotFactor = 0.2;
  }

  let heightFactor = 0.5;
  if (m.medianHeight != null) {
    if (m.medianHeight <= 20) heightFactor = 0.4;
    else if (m.medianHeight <= 30) heightFactor = 0.7;
    else heightFactor = 1;
  }

  const parkingFactor = m.avgParkingScore || 0.5;
  const ownerFactor = m.ownerOccGood ? 1 : 0.3;
  const alleyFactor = m.alleyFlex ? 1 : 0.4;
  const convFactor = m.conversionsGood ? 1 : 0.6;
  const feesFactor = m.feesGood ? 0.9 : 0.5;

  const score =
    aduCountFactor * 0.2 +
    parkingFactor * 0.2 +
    alleyFactor * 0.1 +
    lotFactor * 0.1 +
    heightFactor * 0.1 +
    ownerFactor * 0.1 +
    convFactor * 0.1 +
    feesFactor * 0.1;

  return Math.round(score * 100);
}

function gradeFromScore(score) {
  if (score >= 90) return "A+";
  if (score >= 85) return "A";
  if (score >= 80) return "A-";
  if (score >= 75) return "B+";
  if (score >= 70) return "B";
  if (score >= 65) return "B-";
  if (score >= 60) return "C+";
  if (score >= 55) return "C";
  if (score >= 50) return "C-";
  if (score >= 40) return "D";
  return "F";
}

function renderCityScorecards() {
  const container = document.getElementById("cityScorecards");
  if (!container || !rawRows.length) return;

  const byCity = {};
  rawRows.forEach((row) => {
    const city = get(row, COL.city) || "Unknown";
    if (!byCity[city]) byCity[city] = [];
    byCity[city].push(row);
  });

  const summaries = Object.keys(byCity).map((city) => {
    const metrics = computeCityMetrics(byCity[city]);
    const score = scoreFromMetrics(metrics);
    const grade = gradeFromScore(score);
    return { city, score, grade, metrics };
  });

  summaries.sort((a, b) => b.score - a.score);

  container.innerHTML = "";

  summaries.forEach((s) => {
    const card = document.createElement("div");
    card.className = "scorecard-item";

    const header = document.createElement("div");
    header.className = "scorecard-header";
    header.innerHTML = `
      <span class="scorecard-city">${s.city}</span>
      <span class="scorecard-grade">${s.grade}</span>
    `;

    const barWrap = document.createElement("div");
    barWrap.className = "scorecard-bar-wrap";
    const bar = document.createElement("div");
    bar.className = "scorecard-bar";
    bar.style.width = s.score + "%";
    bar.textContent = s.score.toString();
    barWrap.appendChild(bar);

    const bullets = document.createElement("ul");
    bullets.className = "scorecard-bullets";

    const aduText =
      s.metrics.maxADUsAllowed >= 2
        ? `Up to ${s.metrics.maxADUsAllowed} ADUs per lot in the most permissive zones.`
        : s.metrics.maxADUsAllowed === 1
        ? "Only one ADU per lot allowed in most zones."
        : "ADU count per lot is not clearly specified in the dataset.";

    const li1 = document.createElement("li");
    li1.textContent = aduText;
    bullets.appendChild(li1);

    if (s.metrics.parkingTransit) {
      const li2 = document.createElement("li");
      li2.textContent =
        "ADU parking relief near transit or for small units is available.";
      bullets.appendChild(li2);
    }

    if (s.metrics.alleyFlex) {
      const li3 = document.createElement("li");
      li3.textContent = "Alley-facing ADUs may reduce side or rear setbacks.";
      bullets.appendChild(li3);
    }

    if (!s.metrics.ownerOccGood) {
      const li4 = document.createElement("li");
      li4.textContent =
        "Owner-occupancy requirements may still apply in some districts.";
      bullets.appendChild(li4);
    }

    card.appendChild(header);
    card.appendChild(barWrap);
    card.appendChild(bullets);
    container.appendChild(card);
  });
}

// =========================================
// PERMITS FEED
// =========================================

function initPermitsFilters() {
  const citySelect = document.getElementById("permitsCityFilter");
  const statusSelect = document.getElementById("permitsStatusFilter");
  const limitSelect = document.getElementById("permitsLimit");
  const clearBtn = document.getElementById("clearPermitsFilters");

  if (!citySelect || !statusSelect || !limitSelect || !clearBtn) return;

  citySelect.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "All cities";
  citySelect.appendChild(optAll);
  uniquePermitValues(PCOL.city).forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    citySelect.appendChild(opt);
  });

  statusSelect.innerHTML = "";
  const optAny = document.createElement("option");
  optAny.value = "";
  optAny.textContent = "Any status";
  statusSelect.appendChild(optAny);
  uniquePermitValues(PCOL.status).forEach((s) => {
    const opt = document.createElement("option");
    opt.value = s;
    opt.textContent = s;
    statusSelect.appendChild(opt);
  });

  citySelect.addEventListener("change", applyPermitFilters);
  statusSelect.addEventListener("change", applyPermitFilters);
  limitSelect.addEventListener("change", applyPermitFilters);

  clearBtn.addEventListener("click", () => {
    citySelect.value = "";
    statusSelect.value = "";
    limitSelect.value = "10";
    filteredPermitRows = permitRows.slice();
    renderPermits();
  });
}

function applyPermitFilters() {
  const cityVal = (document.getElementById("permitsCityFilter").value || "").trim();
  const statusVal = (document.getElementById("permitsStatusFilter").value || "").trim();
  const limitVal = parseInt(
    document.getElementById("permitsLimit").value || "10",
    10
  );

  filteredPermitRows = permitRows.filter((row) => {
    const c = getPermit(row, PCOL.city);
    const s = getPermit(row, PCOL.status);
    if (cityVal && c !== cityVal) return false;
    if (statusVal && s !== statusVal) return false;
    return true;
  });

  filteredPermitRows.sort((a, b) => {
    const da = Date.parse(getPermit(a, PCOL.approvalDate)) || 0;
    const db = Date.parse(getPermit(b, PCOL.approvalDate)) || 0;
    return db - da;
  });

  filteredPermitRows = filteredPermitRows.slice(0, limitVal);

  renderPermits();
}

function renderPermits() {
  const list = document.getElementById("permitsList");
  const summary = document.getElementById("permitsSummary");
  if (!list || !summary) return;

  list.innerHTML = "";

  if (!permitRows.length) {
    summary.textContent =
      "No permit dataset loaded yet. Add adu_permits.csv to the repo to see recent ADU activity.";
    return;
  }

  if (!filteredPermitRows.length) {
    summary.textContent = "No permits match the current filters.";
    return;
  }

  summary.textContent = `${filteredPermitRows.length} permit(s) shown.`;

  filteredPermitRows.forEach((row) => {
    const city = getPermit(row, PCOL.city) || "Unknown city";
    const proj = getPermit(row, PCOL.project) || "Unnamed project";
    const status = getPermit(row, PCOL.status) || "Status unknown";
    const type = getPermit(row, PCOL.type) || "ADU";
    const zone = getPermit(row, PCOL.zone) || "n/a";
    const size = getPermit(row, PCOL.size);
    const dateStr = getPermit(row, PCOL.approvalDate);
    const permitNumber = getPermit(row, PCOL.permitNumber);
    const parcel = getPermit(row, PCOL.parcel);
    const notes = getPermit(row, PCOL.notes);
    const url = getPermit(row, PCOL.url);

    const item = document.createElement("div");
    item.className = "permit-item";

    const header = document.createElement("div");
    header.className = "permit-header";
    header.innerHTML = `
      <span class="permit-project">${proj}</span>
      <span class="permit-meta">${city} • ${status}</span>
    `;

    const meta = document.createElement("div");
    meta.className = "permit-meta";

    const details = [];
    if (type) details.push(type);
    if (zone) details.push(`Zone ${zone}`);
    if (size) details.push(`${size} sf`);
    if (dateStr) details.push(dateStr);
    if (permitNumber) details.push(`Permit #${permitNumber}`);
    if (parcel) details.push(`Parcel ${parcel}`);

    meta.textContent = details.join(" • ");

    const tagsWrap = document.createElement("div");
    tagsWrap.className = "permit-tags";

    if (type) {
      const tag = document.createElement("span");
      tag.className = "permit-tag";
      tag.textContent = type;
      tagsWrap.appendChild(tag);
    }

    if (/issued|approved/i.test(status)) {
      const tag = document.createElement("span");
      tag.className = "permit-tag";
      tag.textContent = "Approved";
      tagsWrap.appendChild(tag);
    } else if (/review/i.test(status)) {
      const tag = document.createElement("span");
      tag.className = "permit-tag";
      tag.textContent = "In review";
      tagsWrap.appendChild(tag);
    }

    const notesEl = document.createElement("div");
    notesEl.className = "permit-notes";
    if (notes) notesEl.textContent = notes;

    const linkEl = document.createElement("div");
    linkEl.className = "permit-link";
    if (url) {
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "View permit / documents";
      linkEl.appendChild(a);
    }

    item.appendChild(header);
    item.appendChild(meta);
    if (tagsWrap.childNodes.length) item.appendChild(tagsWrap);
    if (notes) item.appendChild(notesEl);
    if (url) item.appendChild(linkEl);

    list.appendChild(item);
  });
}

// =========================================
// FEASIBILITY CHECKER
// =========================================

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
    !aduInput ||
    !transitCb ||
    !alleyCb ||
    !runBtn
  )
    return;

  // Fill city options
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

  if (lotSize == null || isNaN(lotSize) || lotSize <= 0) {
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

  // ---- existing feasibility logic (unchanged structurally) ----
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

  // ADU / DADU allowed?
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

  // Lot size vs min lot size
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

  // ADU size vs max
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

  // Parking logic
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

  // Alley flex
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

  // Setbacks / height
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

  // Owner occupancy & fees
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

  // ---- NEW: design envelope diagram ----
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

    );
  });
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

  // Derive lot width/depth if missing
  let lotWidth = lotWidthInput;
  let lotDepth = lotDepthInput;

  if (!lotWidth && !lotDepth && lotSize) {
    const side = Math.sqrt(lotSize);
    lotWidth = side;
    lotDepth = side;
  } else if (!lotWidth && lotDepth && lotSize) {
    lotWidth = lotSize / lotDepth;
  } else if (lotWidth && !lotDepth && lotSize) {
    lotDepth = lotSize / lotWidth;
  }

  if (!lotWidth) lotWidth = 40;
  if (!lotDepth) lotDepth = 100;

  const frontSet = toNumber(get(row, COL.frontSetback)) || 0;
  const sideSet = toNumber(get(row, COL.sideSetback)) || 0;
  const rearSet = toNumber(get(row, COL.rearSetback)) || 0;
  const coveragePct = toNumber(get(row, COL.lotCoverage));

  const buildableWidth = Math.max(lotWidth - 2 * sideSet, lotWidth * 0.4);
  const buildableDepth = Math.max(
    lotDepth - frontSet - rearSet,
    lotDepth * 0.4
  );

  const buildableArea = buildableWidth * buildableDepth;

  // Primary home footprint (front part of buildable area)
  let houseWidth = houseWidthInput;
  let houseDepth = houseDepthInput;

  if (!houseWidth || !houseDepth) {
    // default to front ~40% of lot width/depth
    houseWidth = lotWidth * 0.6;
    houseDepth = lotDepth * 0.35;
  }

  // ADU footprint, based on size & coverage
  let footprintArea = aduSize || null;
  if (coveragePct != null && lotSize) {
    const maxFromCoverage = (coveragePct / 100) * lotSize;
    if (footprintArea != null) {
      footprintArea = Math.min(footprintArea, maxFromCoverage);
    } else {
      footprintArea = maxFromCoverage * 0.4;
    }
  } else if (!footprintArea && buildableArea) {
    footprintArea = buildableArea * 0.2;
  }

  const buildableWidthPct = Math.max(
    15,
    Math.min(100, (buildableWidth / lotWidth) * 100)
  );
  const buildableHeightPct = Math.max(
    15,
    Math.min(100, (buildableDepth / lotDepth) * 100)
  );

  // Represent house & ADU footprints as percentages of buildable box
  let houseWidthFactor = Math.max(
    0.2,
    Math.min(0.9, (houseWidth / buildableWidth) || 0.5)
  );
  let houseDepthFactor = Math.max(
    0.2,
    Math.min(0.7, (houseDepth / buildableDepth) || 0.4)
  );

  let aduFactor = 0.4;
  if (footprintArea && buildableArea > 0) {
    const ratio = footprintArea / buildableArea;
    aduFactor = Math.max(0.2, Math.min(0.8, Math.sqrt(ratio)));
  }

  const houseWidthPct = houseWidthFactor * 100;
  const houseHeightPct = houseDepthFactor * 100;
  const aduWidthPct = aduFactor * 100;
  const aduHeightPct = aduFactor * 100;

  // Positions:
  // - Buildable box is centered
  // - House sits toward the front
  // - ADU sits toward the rear, roughly centered horizontally

  const buildableTop = (100 - buildableHeightPct) / 2;
  const buildableLeft = (100 - buildableWidthPct) / 2;

  const houseTop = buildableTop + 4; // front-ish
  const houseLeft =
    buildableLeft + (buildableWidthPct - houseWidthPct) * 0.1;

  const aduTop =
    buildableTop + buildableHeightPct - aduHeightPct - 4; // rear-ish
  const aduLeft =
    buildableLeft + (buildableWidthPct - aduWidthPct) * 0.5;

  diagramEl.innerHTML = `
    <div class="lot-box">
      <div class="lot-label">Lot${lotSize ? " (" + lotSize.toLocaleString() + " sf)" : ""}</div>
      <div
        class="buildable-box"
        style="top:${buildableTop}%;left:${buildableLeft}%;width:${buildableWidthPct}%;height:${buildableHeightPct}%;"
      >
        <div class="buildable-label">Buildable area</div>

        <div
          class="primary-box"
          style="top:${houseTop - buildableTop}%;left:${houseLeft - buildableLeft}%;width:${houseWidthPct}%;height:${houseHeightPct}%;"
        >
          <span class="primary-label">Existing home</span>
        </div>

        <div
          class="adu-box"
          style="top:${aduTop - buildableTop}%;left:${aduLeft - buildableLeft}%;width:${aduWidthPct}%;height:${aduHeightPct}%;"
        >
          <span class="adu-label">ADU</span>
        </div>
      </div>
    </div>
  `;
}

  citySel.addEventListener("change", () => {
    fillZonesForCity(citySel.value || "");
  });

  runBtn.addEventListener("click", () => {
    const city = citySel.value || "";
    const zone = zoneSel.value || "";
    const lotSize = toNumber(lotInput.value);
    const aduSize = toNumber(aduInput.value);
    const nearTransit = !!transitCb.checked;
    const hasAlley = !!alleyCb.checked;
    runFeasibilityCheck(city, zone, lotSize, aduSize, nearTransit, hasAlley);
  });
}

function runFeasibilityCheck(city, zone, lotSize, aduSize, nearTransit, hasAlley) {
  const summaryEl = document.getElementById("feasibilitySummary");
  const detailsEl = document.getElementById("feasibilityDetails");
  if (!summaryEl || !detailsEl) return;

  detailsEl.innerHTML = "";

  if (!city || !zone) {
    summaryEl.textContent = "Select a city and zone to run a check.";
    return;
  }

  if (lotSize == null || isNaN(lotSize) || lotSize <= 0) {
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

  // For now, use the first row as representative for this zone
  const row = matches[0];

  const aduAllowed = (get(row, COL.aduAllowed) || "").toLowerCase();
  const daduAllowed = (get(row, COL.daduAllowed) || "").toLowerCase();
  const minLotSize = toNumber(get(row, COL.minLotSize));
  const maxADUSize = toNumber(get(row, COL.maxADUSize));
  const maxDADUSize = toNumber(get(row, COL.maxDADUSize));
  const parkingReq = (get(row, COL.aduParkingReq) || "").toLowerCase();
  const parkingNotes = (get(row, COL.parkingNotes) || "");
  const parkingTransitFlag = (get(row, COL.aduParkingTransit) || "").toLowerCase();
  const parkingSmallFlag = (get(row, COL.aduParkingSmall) || "").toLowerCase();
  const ownerOcc = (get(row, COL.ownerOcc) || "");
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

  // ADU / DADU allowed?
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

  // Lot size vs min lot size
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

  // ADU size vs max
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

  // Parking logic
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

  // Alley flex
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

  // Setbacks / height
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

  // Owner occupancy & fees
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
}

// =========================================
// CITY COMPARISON MODAL
// =========================================

function initCompareModal() {
  const openBtn = document.getElementById("openCompare");
  const closeBtn = document.getElementById("closeCompare");
  const modal = document.getElementById("compareModal");
  const runBtn = document.getElementById("runCompare");
  const select = document.getElementById("compareCitySelect");
  const results = document.getElementById("compareResults");

  if (!openBtn || !closeBtn || !modal || !runBtn || !select || !results) return;

  openBtn.addEventListener("click", () => {
    modal.style.display = "block";

    const cities = uniqueValues(COL.city);
    select.innerHTML = "";
    cities.forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c;
      opt.textContent = c;
      select.appendChild(opt);
    });
  });

  closeBtn.addEventListener("click", () => {
    modal.style.display = "none";
  });

  window.addEventListener("click", (e) => {
    if (e.target === modal) modal.style.display = "none";
  });

  runBtn.addEventListener("click", () => {
    const selected = Array.from(select.selectedOptions).map((o) => o.value);
    results.innerHTML = "";

    if (!selected.length) {
      results.textContent = "Select at least one city to compare.";
      return;
    }

    selected.forEach((city) => {
      const rowsCity = rawRows.filter(
        (r) => (get(r, COL.city) || "").trim() === city
      );
      if (!rowsCity.length) return;

      const metrics = computeCityMetrics(rowsCity);
      const score = scoreFromMetrics(metrics);
      const grade = gradeFromScore(score);

      const card = document.createElement("div");
      card.className = "compare-card";

      const ul = document.createElement("ul");
      const addLi = (label, value) => {
        const li = document.createElement("li");
        li.innerHTML = `<strong>${label}:</strong> ${value}`;
        ul.appendChild(li);
      };

      addLi("ADU score", `${score} (${grade})`);
      addLi(
        "Max ADUs per lot",
        metrics.maxADUsAllowed || "not clearly defined"
      );
      addLi(
        "Median min lot size",
        metrics.medianLot ? `${metrics.medianLot.toLocaleString()} sf` : "n/a"
      );
      addLi(
        "Median height limit",
        metrics.medianHeight ? `${metrics.medianHeight} ft` : "n/a"
      );
      addLi(
        "Parking flexibility",
        metrics.avgParkingScore >= 0.8
          ? "High"
          : metrics.avgParkingScore >= 0.6
          ? "Moderate"
          : "Low"
      );
      addLi(
        "Owner-occupancy",
        metrics.ownerOccGood
          ? "No explicit owner-occupancy requirement"
          : "Owner-occupancy may apply"
      );
      addLi(
        "Alley flexibility",
        metrics.alleyFlex ? "0 ft alley setback possible for some ADUs" : "Standard setbacks only"
      );
      addLi(
        "Conversion friendliness",
        metrics.conversionsGood
          ? "Conversions clearly allowed"
          : "Limited/unclear conversion support"
      );

      card.innerHTML = `<h3>${city}</h3>`;
      card.appendChild(ul);
      results.appendChild(card);
    });
  });
}

// =========================================
// INIT
// =========================================

async function initApp() {
  try {
    await loadZoningData();
    await loadPermitsData();

    buildTableHeader();
    renderCityScorecards();
    initFilters();
    applyFilters();
    initCompareModal();
    initFeasibility();

    if (permitRows.length) {
      initPermitsFilters();
      applyPermitFilters();
    } else {
      renderPermits();
    }
  } catch (err) {
    console.error(err);
    const summary = document.getElementById("summary");
    if (summary) {
      summary.textContent =
        "Error loading data. Check that data.csv (and adu_permits.csv, if used) exist, have proper header rows, and are published correctly.";
    }
    renderPermits();
  }
}

document.addEventListener("DOMContentLoaded", initApp);
