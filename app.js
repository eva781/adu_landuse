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
// FEASIBILITY CHECKER (INTERACTIVE DIAGRAM)
// =========================================

const FEAS_DIAGRAM_STATE = {
  scale: 1,
  drawWidthPx: 450,   // smaller canvas so it fits
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
  home: null,  // { xFt, yFt, widthFt, depthFt }
  adu: null,   // { xFt, yFt, widthFt, depthFt, baseTargetSqft }
  svg: null,
  dragging: null,   // { shape: 'home'|'adu', offsetXFt, offsetYFt }
  resizing: null,   // { shape: 'home'|'adu', corner: 'tl'|'tr'|'bl'|'br' }
  lotResize: null,  // { edge: 'right'|'bottom' }
  _mouseHandlersAttached: false,
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

  // ---- Fill city options ----
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

  // ---- Run feasibility on click ----
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

  // -----------------------------
  // Inner: feasibility evaluation
  // -----------------------------
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

    // If lot width/depth provided but lotSize not, compute it
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

  // ---------------------------------------
  // Inner: interactive diagram with editing
  // ---------------------------------------
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

    // ----- LOT & SCALE SETUP (IN FEET) -----
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

    // Scale to fill height nicely (lot depth controls overall scale)
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

    // ----- BUILDABLE AREA (IN FEET) -----
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

    // ----- INITIAL HOME & ADU IF NEEDED -----
    if (!FEAS_DIAGRAM_STATE.home || !FEAS_DIAGRAM_STATE.adu) {
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
    }

    const lotLabel =
      "Lot" + (lotSize ? ` (${lotSize.toLocaleString()} sf)` : "");

    // ----- SVG SKELETON -----
    diagramEl.innerHTML = `
      <svg id="feasSvg" width="100%" height="100%" viewBox="0 0 ${drawWidthPx} ${drawHeightPx}">
        <!-- Lot outline -->
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

        <!-- Buildable area -->
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

        <!-- Lot edge handles -->
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

        <!-- Existing home group -->
        <g id="homeGroup" class="shape-group" data-shape="home">
          <rect id="homeRect" fill="#111827" rx="6" ry="6" />
          <text id="homeLabel" fill="#e5e7eb" font-size="11"></text>
          <circle class="resize-handle" data-shape="home" data-corner="tl" r="5" fill="#fbbf24" />
          <circle class="resize-handle" data-shape="home" data-corner="tr" r="5" fill="#fbbf24" />
          <circle class="resize-handle" data-shape="home" data-corner="bl" r="5" fill="#fbbf24" />
          <circle class="resize-handle" data-shape="home" data-corner="br" r="5" fill="#fbbf24" />
        </g>

        <!-- ADU group -->
        <g id="aduGroup" class="shape-group" data-shape="adu">
          <rect id="aduRect" fill="rgba(79,70,229,0.85)" rx="6" ry="6" />
          <text id="aduLabel" fill="#eef2ff" font-size="11"></text>
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
      const scale = FEAS_DIAGRAM_STATE.scale;

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

      // Update buildable box
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

      // Lot handles
      lotHandleRight.setAttribute("cx", lotLeftPx + lotWpx);
      lotHandleRight.setAttribute("cy", lotTopPx + lotHpx / 2);
      lotHandleBottom.setAttribute("cx", lotLeftPx + lotWpx / 2);
      lotHandleBottom.setAttribute("cy", lotTopPx + lotHpx);

      // Home
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

      // ADU
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

      // Sync back to inputs
      const widthInput = document.getElementById("feasLotWidth");
      const depthInput = document.getElementById("feasLotDepth");
      const sizeInput = document.getElementById("feasLotSize");
      if (widthInput) widthInput.value = Math.round(lot.widthFt);
      if (depthInput) depthInput.value = Math.round(lot.depthFt);
      if (sizeInput) sizeInput.value = lotArea;
    }

    redrawAll();

    // ---- SHAPE DRAGGING ----
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

    homeGroup.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("resize-handle")) return;
      startDragShape(e, "home");
    });

    aduGroup.addEventListener("mousedown", (e) => {
      if (e.target.classList.contains("resize-handle")) return;
      startDragShape(e, "adu");
    });

    // ---- SHAPE RESIZING ----
    function startResize(evt, shapeName, corner) {
      FEAS_DIAGRAM_STATE.resizing = { shape: shapeName, corner };
      evt.stopPropagation();
    }

    handles.forEach((h) => {
      h.addEventListener("mousedown", (e) => {
        const shapeName = h.getAttribute("data-shape");
        const corner = h.getAttribute("data-corner");
        startResize(e, shapeName, corner);
      });
    });

    // ---- LOT EDGE RESIZING ----
    lotHandleRight.addEventListener("mousedown", (e) => {
      FEAS_DIAGRAM_STATE.lotResize = { edge: "right" };
      e.stopPropagation();
    });

    lotHandleBottom.addEventListener("mousedown", (e) => {
      FEAS_DIAGRAM_STATE.lotResize = { edge: "bottom" };
      e.stopPropagation();
    });

    // ---- GLOBAL MOUSE HANDLERS (run once) ----
    if (!FEAS_DIAGRAM_STATE._mouseHandlersAttached) {
      FEAS_DIAGRAM_STATE._mouseHandlersAttached = true;

      window.addEventListener("mousemove", (evt) => {
        const svg = FEAS_DIAGRAM_STATE.svg;
        if (!svg) return;

        const pt = svg.createSVGPoint();
        pt.x = evt.clientX;
        pt.y = evt.clientY;
        const svgPt = pt.matrixTransform(svg.getScreenCTM().inverse());
        const lot = FEAS_DIAGRAM_STATE.lot;
        const scale = FEAS_DIAGRAM_STATE.scale;

        // Dragging shapes
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

        // Resizing shapes
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

        // Resizing lot edges
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
      });

      window.addEventListener("mouseup", () => {
        FEAS_DIAGRAM_STATE.dragging = null;
        FEAS_DIAGRAM_STATE.resizing = null;
        FEAS_DIAGRAM_STATE.lotResize = null;
      });
    }
  }
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
    initMap();
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

