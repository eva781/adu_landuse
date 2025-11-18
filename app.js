// =============================================
// CONFIG
// =============================================
const CSV_URL = "data.csv";

// =============================================
// CSV PARSER (robust for commas + quotes)
// =============================================
function parseCSV(text) {
  const rows = [];
  let current = [];
  let value = "";
  let inside = false;

  for (let i = 0; i < text.length; i++) {
    let c = text[i];
    let next = text[i + 1];

    if (c === '"' && !inside) {
      inside = true;
    } else if (c === '"' && inside) {
      if (next === '"') {
        value += '"';
        i++;
      } else {
        inside = false;
      }
    } else if (c === "," && !inside) {
      current.push(value);
      value = "";
    } else if ((c === "\n" || c === "\r") && !inside) {
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

// =============================================
// GLOBAL DATA
// =============================================
let headers = [];
let rows = [];
let filtered = [];

// =============================================
// LOAD CSV
// =============================================
async function loadCSV() {
  const res = await fetch(CSV_URL);
  const text = await res.text();

  const parsed = parseCSV(text);

  headers = parsed[0];            // header row
  rows = parsed.slice(1);         // data rows
  filtered = [...rows];           // default view

  buildTableHeader();
  buildFilters();
  applyFilters();
}

// =============================================
// BUILD TABLE HEADER AUTOMATICALLY
// =============================================
function buildTableHeader() {
  const thead = document.getElementById("tableHead");
  thead.innerHTML = "";

  const tr = document.createElement("tr");

  headers.forEach(h => {
    const th = document.createElement("th");
    th.textContent = h || "—";
    tr.appendChild(th);
  });

  thead.appendChild(tr);
}

// =============================================
// FILTER SYSTEM
// =============================================
function uniqueValues(colIndex) {
  const set = new Set();
  rows.forEach(r => {
    const v = r[colIndex] || "";
    if (v.trim() !== "") set.add(v.trim());
  });
  return Array.from(set).sort();
}

function fillSelect(id, values, placeholder) {
  const el = document.getElementById(id);
  el.innerHTML = "";
  const any = document.createElement("option");
  any.value = "";
  any.textContent = placeholder;
  el.appendChild(any);

  values.forEach(v => {
    const opt = document.createElement("option");
    opt.value = v;
    opt.textContent = v;
    el.appendChild(opt);
  });

  el.addEventListener("change", applyFilters);
}

function buildFilters() {
  const cityIndex = headers.indexOf("City");
  const zoneIndex = headers.indexOf("Zone");
  const zoneTypeIndex = headers.indexOf("Zone_Type");
  const aduIndex = headers.indexOf("ADU_Allowed");
  const daduIndex = headers.indexOf("DADU_Allowed");
  const ownerIndex = headers.indexOf("Owner_Occupancy_Required");

  fillSelect("cityFilter", uniqueValues(cityIndex), "All cities");
  fillSelect("zoneFilter", uniqueValues(zoneIndex), "All zones");
  fillSelect("zoneTypeFilter", uniqueValues(zoneTypeIndex), "All types");
  fillSelect("aduFilter", uniqueValues(aduIndex), "Any");
  fillSelect("daduFilter", uniqueValues(daduIndex), "Any");
  fillSelect("ownerOccFilter", uniqueValues(ownerIndex), "Any");

  document.getElementById("searchInput")
    .addEventListener("input", applyFilters);

  document.getElementById("clearFilters")
    .addEventListener("click", clearFilters);
}

function clearFilters() {
  ["cityFilter","zoneFilter","zoneTypeFilter","aduFilter","daduFilter","ownerOccFilter"]
    .forEach(id => document.getElementById(id).value = "");

  document.getElementById("searchInput").value = "";
  filtered = [...rows];
  renderTable();
}

// =============================================
// APPLY FILTERS
// =============================================
function applyFilters() {
  const cityVal  = document.getElementById("cityFilter").value;
  const zoneVal  = document.getElementById("zoneFilter").value;
  const typeVal  = document.getElementById("zoneTypeFilter").value;
  const aduVal   = document.getElementById("aduFilter").value;
  const daduVal  = document.getElementById("daduFilter").value;
  const ownerVal = document.getElementById("ownerOccFilter").value;
  const searchVal = document.getElementById("searchInput").value.toLowerCase();

  const cityIdx = headers.indexOf("City");
  const zoneIdx = headers.indexOf("Zone");
  const typeIdx = headers.indexOf("Zone_Type");
  const aduIdx = headers.indexOf("ADU_Allowed");
  const daduIdx = headers.indexOf("DADU_Allowed");
  const ownerIdx = headers.indexOf("Owner_Occupancy_Required");

  filtered = rows.filter(r => {
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
// RENDER TABLE (ALL COLUMNS, ALWAYS ALIGNED)
// =============================================
function renderTable() {
  const tbody = document.getElementById("tableBody");
  const summary = document.getElementById("summary");

  tbody.innerHTML = "";

  summary.textContent =
    `${filtered.length} of ${rows.length} rows shown`;

  filtered.forEach(r => {
    const tr = document.createElement("tr");

    r.forEach((cell,i) => {
      const td = document.createElement("td");
      // auto-link Source_Document_URL
      if (headers[i] === "Source_Document_URL" && cell.trim() !== "") {
        const a = document.createElement("a");
        a.href = cell;
        a.target = "_blank";
        a.rel = "noopener";
        a.textContent = "Link";
        td.appendChild(a);
      } else {
        td.textContent = cell || "—";
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}
// =====================================
// MULTI-CITY COMPARE MODE
// =====================================

// Open modal
document.getElementById("openCompare").onclick = () => {
  document.getElementById("compareModal").style.display = "block";
  populateCompareCityList();
};

// Close modal
document.getElementById("closeCompare").onclick = () => {
  document.getElementById("compareModal").style.display = "none";
};

// Populate multi-select with unique cities
function populateCompareCityList() {
  const idx = headers.indexOf("City");
  const cities = uniqueValues(idx);

  const el = document.getElementById("compareCitySelect");
  el.innerHTML = "";

  cities.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
    el.appendChild(opt);
  });
}

// Run comparison
document.getElementById("runCompare").onclick = () => {
  const selected = Array.from(
    document.getElementById("compareCitySelect").selectedOptions
  ).map(opt => opt.value);

  const idx = headers.indexOf("City");
  const cards = selected.map(city => {
    const cityRows = rows.filter(r => r[idx] === city);
    if (cityRows.length === 0) return "";

    const first = cityRows[0];

    let html = `<div class="compare-card"><h3>${city}</h3><ul>`;
    headers.forEach((h,i) => {
      html += `<li><strong>${h}:</strong> ${first[i] || "—"}</li>`;
    });
    html += "</ul></div>";

    return html;
  });

  document.getElementById("compareResults").innerHTML = cards.join("");
};

document.addEventListener("DOMContentLoaded", loadCSV);

