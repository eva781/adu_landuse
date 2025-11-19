// =========================================
// CONFIG & GLOBAL STATE
// =========================================

const CSV_URL = "data.csv";

let headers = [];
let rawRows = [];
let filteredRows = [];

// Column map for convenience
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

// Coordinates for map markers (approximate)
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
  // Strip BOM if present
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

async function loadData() {
  const res = await fetch(CSV_URL);
  if (!res.ok) {
    throw new Error(`Failed to load ${CSV_URL}: ${res.status}`);
  }
  const text = await res.text();
  const parsed = parseCSV(text);

  if (!parsed.length) {
    throw new Error("CSV appears to be empty");
  }

  // Find the first non-empty row to use as header
  let headerRowIndex = 0;
  while (
    headerRowIndex < parsed.length &&
    parsed[headerRowIndex].every((c) => !c || !c.trim())
  ) {
    headerRowIndex++;
  }
  if (headerRowIndex >= parsed.length) {
    throw new Error("Could not find a header row in CSV");
  }

  headers = parsed[headerRowIndex].map((h) => (h || "").trim());
  const dataRows = parsed.slice(headerRowIndex + 1);

  // Filter out completely empty rows
  rawRows = dataRows.filter((row) =>
    row.some((cell) => cell && cell.trim() !== "")
  );
  filteredRows = rawRows.slice();
}

// =========================================
// UTILS
// =========================================

function headerIndex(name) {
  return headers.indexOf(name);
}

function get(row, colName) {
  const idx = headerIndex(colName);
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
    summary.textContent = `${filteredRows.length} of ${rawRows.length} rows shown`;
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
  if (search) {
    search.addEventListener("input", applyFilters);
  }

  const clearBtn = document.getElementById("clearFilters");
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      ["cityFilter", "zoneFilter", "zoneTypeFilter", "aduFilter", "daduFilter", "ownerOccFilter"].forEach(
        (id) => {
          const el = document.getElementById(id);
          if (el) el.value = "";
        }
      );
      if (search) search.value = "";
      filteredRows = rawRows.slice();
      renderTable();
    });
  }

  ["cityFilter", "zoneFilter", "zoneTypeFilter", "aduFilter", "daduFilter", "ownerOccFilter"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener("change", applyFilters);
    }
  );
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
    if (e.target === modal) {
      modal.style.display = "none";
    }
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
        metrics.ownerOccGood ? "No explicit owner-occupancy requirement" : "Owner-occupancy may apply"
      );
      addLi(
        "Alley flexibility",
        metrics.alleyFlex ? "0 ft alley setback possible for some ADUs" : "Standard setbacks only"
      );
      addLi(
        "Conversion friendliness",
        metrics.conversionsGood ? "Conversions clearly allowed" : "Limited/unclear conversion support"
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
    await loadData();
    buildTableHeader();
    renderCityScorecards();
    initFilters();
    applyFilters();
    initMap();
    initCompareModal();
  } catch (err) {
    console.error(err);
    const summary = document.getElementById("summary");
    if (summary) {
      summary.textContent =
        "Error loading data. Check that data.csv exists, has a proper header row, and is published correctly.";
    }
  }
}

document.addEventListener("DOMContentLoaded", initApp);
