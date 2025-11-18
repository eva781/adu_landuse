// =============================================
// CONFIG
// =============================================
const CSV_URL = "data.csv";

// CSV data
let headers = [];
let rows = [];
let filteredRows = [];

// =============================================
// CSV PARSER (handles commas + quotes)
// =============================================
function parseCSV(text) {
  // strip BOM if present
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const out = [];
  let cur = [];
  let val = "";
  let inside = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const next = text[i + 1];

    if (c === '"' && !inside) {
      inside = true;
    } else if (c === '"' && inside) {
      if (next === '"') {
        val += '"';
        i++;
      } else {
        inside = false;
      }
    } else if (c === "," && !inside) {
      cur.push(val);
      val = "";
    } else if ((c === "\n" || c === "\r") && !inside) {
      if (val.length > 0 || cur.length > 0) {
        cur.push(val);
        out.push(cur);
        cur = [];
        val = "";
      }
      if (c === "\r" && next === "\n") i++;
    } else {
      val += c;
    }
  }

  if (val.length > 0 || cur.length > 0) {
    cur.push(val);
    out.push(cur);
  }

  return out;
}

// =============================================
// LOAD CSV
// =============================================
async function loadCSV() {
  const res = await fetch(CSV_URL);
  if (!res.ok) {
    throw new Error("Unable to load data.csv");
  }
  const text = await res.text();
  const parsed = parseCSV(text);

  if (!parsed.length) {
    throw new Error("Empty CSV");
  }

  headers = parsed[0].map((h) => h.trim());
  rows = parsed.slice(1);
  filteredRows = [...rows];
}

// =============================================
// TABLE BUILDING
// =============================================
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
    summary.textContent = `${filteredRows.length} of ${rows.length} rows shown`;
  }

  const urlIdx = headers.indexOf("Source_Document_URL");

  filteredRows.forEach((r) => {
    const tr = document.createElement("tr");

    r.forEach((cell, i) => {
      const td = document.createElement("td");
      const text = cell && cell.trim() !== "" ? cell : "—";

      if (i === urlIdx && text !== "—") {
        const a = document.createElement("a");
        a.href = cell;
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

// =============================================
// FILTERS
// =============================================
function colIndex(name) {
  return headers.indexOf(name);
}

function uniqueValuesByHeader(name) {
  const idx = colIndex(name);
  if (idx === -1) return [];
  const set = new Set();
  rows.forEach((r) => {
    const v = (r[idx] || "").trim();
    if (v) set.add(v);
  });
  return Array.from(set).sort();
}

function fillSelectByHeader(id, headerName, placeholder) {
  const el = document.getElementById(id);
  if (!el) return;

  const values = uniqueValuesByHeader(headerName);
  el.innerHTML = "";

  const any = document.createElement("option");
  any.value = "";
  any.textContent = placeholder;
  el.appendChild(any);

  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });

  el.addEventListener("change", applyFilters);
}

function buildFilters() {
  fillSelectByHeader("cityFilter", "City", "All cities");
  fillSelectByHeader("zoneFilter", "Zone", "All zones");
  fillSelectByHeader("zoneTypeFilter", "Zone_Type", "All types");
  fillSelectByHeader("aduFilter", "ADU_Allowed", "Any");
  fillSelectByHeader("daduFilter", "DADU_Allowed", "Any");
  fillSelectByHeader(
    "ownerOccFilter",
    "Owner_Occupancy_Required",
    "Any"
  );

  const searchInput = document.getElementById("searchInput");
  if (searchInput) {
    searchInput.addEventListener("input", applyFilters);
  }

  const clearBtn = document.getElementById("clearFilters");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearFilters);
  }
}

function clearFilters() {
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

  const s = document.getElementById("searchInput");
  if (s) s.value = "";

  filteredRows = [...rows];
  renderTable();
}

function applyFilters() {
  const cityVal = document.getElementById("cityFilter").value;
  const zoneVal = document.getElementById("zoneFilter").value;
  const typeVal = document.getElementById("zoneTypeFilter").value;
  const aduVal = document.getElementById("aduFilter").value;
  const daduVal = document.getElementById("daduFilter").value;
  const ownerVal = document.getElementById("ownerOccFilter").value;
  const searchVal = (
    document.getElementById("searchInput").value || ""
  )
    .toLowerCase()
    .trim();

  const cityIdx = colIndex("City");
  const zoneIdx = colIndex("Zone");
  const typeIdx = colIndex("Zone_Type");
  const aduIdx = colIndex("ADU_Allowed");
  const daduIdx = colIndex("DADU_Allowed");
  const ownerIdx = colIndex("Owner_Occupancy_Required");

  filteredRows = rows.filter((r) => {
    if (cityVal && r[cityIdx] !== cityVal) return false;
    if (zoneVal && r[zoneIdx] !== zoneVal) return false;
    if (typeVal && r[typeIdx] !== typeVal) return false;
    if (aduVal && r[aduIdx] !== aduVal) return false;
    if (daduVal && r[daduIdx] !== daduVal) return false;
    if (ownerVal && r[ownerIdx] !== ownerVal) return false;

    if (searchVal) {
      const combined = r.join(" ").toLowerCase();
      if (!combined.includes(searchVal)) return false;
    }

    return true;
  });

  renderTable();
}

// =============================================
// MAP VISUALIZATION
// =============================================
const cityCoords = {
  Bellevue: [47.6101, -122.2015],
  Seattle: [47.6062, -122.3321],
  Redmond: [47.673, -122.121],
  Kirkland: [47.678, -122.207],
  Bothell: [47.761, -122.205],
  Renton: [47.4829, -122.2171],
  Shoreline: [47.7557, -122.3415],
  Issaquah: [47.5326, -122.0429],
};

function initMap() {
  const mapEl = document.getElementById("map");
  if (!mapEl || typeof L === "undefined") return;

  const map = L.map("map").setView([47.55, -122.2], 10);

  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(map);

  const cityIdx = colIndex("City");
  const zoneIdx = colIndex("Zone");
  const aduIdx = colIndex("ADU_Allowed");
  const notesIdx = colIndex("Notes");

  const seen = new Set();

  rows.forEach((r) => {
    const city = (r[cityIdx] || "").trim();
    if (!city || seen.has(city)) return;
    seen.add(city);

    const coords = cityCoords[city] || [47.6, -122.2];

    const zone = r[zoneIdx] || "—";
    const adu = r[aduIdx] || "—";
    const notes = r[notesIdx] || "—";

    const popupHTML = `
      <strong>${city}</strong><br/>
      Example zone: ${zone}<br/>
      ADUs allowed: ${adu}<br/>
      Notes: ${notes}
    `;

    L.marker(coords).addTo(map).bindPopup(popupHTML);
  });
}

// =============================================
// MULTI-CITY COMPARE
// =============================================
function initCompareUI() {
  const openBtn = document.getElementById("openCompare");
  const closeBtn = document.getElementById("closeCompare");
  const modal = document.getElementById("compareModal");
  const runBtn = document.getElementById("runCompare");

  if (!modal || !openBtn || !closeBtn || !runBtn) return;

  openBtn.addEventListener("click", () => {
    modal.style.display = "block";
    populateCompareCityList();
  });

  closeBtn.addEventListener("click", () => {
    modal.style.display = "none";
  });

  window.addEventListener("click", (e) => {
    if (e.target === modal) {
      modal.style.display = "none";
    }
  });

  runBtn.addEventListener("click", runCityCompare);
}

function populateCompareCityList() {
  const cityIdx = colIndex("City");
  const cities = uniqueValuesByHeader("City");
  const select = document.getElementById("compareCitySelect");
  select.innerHTML = "";

  cities.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
}

function runCityCompare() {
  const cityIdx = colIndex("City");
  const select = document.getElementById("compareCitySelect");
  const results = document.getElementById("compareResults");
  results.innerHTML = "";

  const selected = Array.from(select.selectedOptions).map(
    (o) => o.value
  );

  if (!selected.length) {
    results.textContent = "Select at least one city to compare.";
    return;
  }

  const cards = selected.map((city) => {
    const cityRows = rows.filter((r) => (r[cityIdx] || "").trim() === city);
    if (!cityRows.length) return "";

    const first = cityRows[0];
    // Pick a curated subset of fields for the card:
    const fields = [
      "Zone",
      "Zone_Type",
      "ADU_Allowed",
      "DADU_Allowed",
      "Max_ADUs_Per_Lot",
      "Max_ADU_Size_Sqft",
      "Min_Lot_Size_Sqft",
      "Min_Parking_Spaces",
      "Owner_Occupancy_Required",
      "Max_Building_Height_Primary_ft",
      "DADU_Max_Height_ft",
      "Min_Front_Setback_ft",
      "Min_Side_Setback_ft",
      "Min_Rear_Setback_ft",
      "Notes",
    ];

    let html = `<div class="compare-card"><h3>${city}</h3><ul>`;
    fields.forEach((f) => {
      const idx = colIndex(f);
      if (idx === -1) return;
      const label = f.replace(/_/g, " ");
      const val = first[idx] && first[idx].trim() !== "" ? first[idx] : "—";
      html += `<li><strong>${label}:</strong> ${val}</li>`;
    });
    html += "</ul></div>";
    return html;
  });

  results.innerHTML = cards.join("");
}

// =============================================
// INIT
// =============================================
async function initApp() {
  try {
    await loadCSV();
    buildTableHeader();
    buildFilters();
    applyFilters();
    initMap();
    initCompareUI();
  } catch (e) {
    console.error(e);
    const summary = document.getElementById("summary");
    if (summary) {
      summary.textContent =
        "Error loading data. Check that data.csv exists and has a header row.";
    }
  }
}

document.addEventListener("DOMContentLoaded", initApp);
