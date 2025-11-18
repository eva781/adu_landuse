// ==========================
// CONFIG
// ==========================

// We're loading CSV that lives in the repo root:
// you uploaded data.csv already.
const CSV_URL = "data.csv";

// Column names in your sheet (must match exactly)
const COL = {
  city: "City",
  zone: "Zone",
  zoneType: "Zone_Type",
  aduAllowed: "ADU_Allowed",
  daduAllowed: "DADU_Allowed",
  maxADUs: "Max_ADUs_Per_Lot",
  maxADUSize: "Max_ADU_Size_Sqft",
  maxDADUSize: "Max_DADU_Size_Sqft",
  minLotSize: "Min_Lot_Size_Sqft",
  maxLotCoverage: "Max_Lot_Coverage_Percent",
  maxImpervious: "Max_Impervious_Surface_Percent",
  minParking: "Min_Parking_Spaces",
  ownerOcc: "Owner_Occupancy_Required",
  heightPrimary: "Max_Building_Height_Primary_ft",
  heightDADU: "DADU_Max_Height_ft",
  frontSetback: "Min_Front_Setback_ft",
  sideSetback: "Min_Side_Setback_ft",
  rearSetback: "Min_Rear_Setback_ft",
  codeSection: "Reference_Code_Section",
  sourceURL: "Source_Document_URL",
  notes: "Notes",
};

// ==========================
// CSV PARSER
// ==========================

function parseCSV(text) {
  // Strip BOM if present so first header isn't "﻿City"
  if (text.charCodeAt(0) === 0xfeff) {
    text = text.slice(1);
  }

  const rows = [];
  let current = [];
  let value = "";
  let insideQuotes = false;

  const pushValue = () => {
    current.push(value);
    value = "";
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && !insideQuotes) {
      insideQuotes = true;
    } else if (char === '"' && insideQuotes) {
      if (next === '"') {
        value += '"';
        i++;
      } else {
        insideQuotes = false;
      }
    } else if (char === "," && !insideQuotes) {
      pushValue();
    } else if ((char === "\n" || char === "\r") && !insideQuotes) {
      if (value.length > 0 || current.length > 0) {
        pushValue();
        rows.push(current);
        current = [];
      }
      if (char === "\r" && next === "\n") i++;
    } else {
      value += char;
    }
  }

  if (value.length > 0 || current.length > 0) {
    pushValue();
    rows.push(current);
  }

  if (!rows.length) return { headers: [], rows: [] };

  const headers = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1).map((cells) => {
    const obj = {};
    headers.forEach((h, i) => {
      obj[h] = (cells[i] || "").trim();
    });
    return obj;
  });

  return { headers, rows: dataRows };
}

// ==========================
// STATE
// ==========================

let rawData = [];
let filteredData = [];

// ==========================
// HELPERS
// ==========================

function get(row, colName) {
  return row[colName] || "";
}

function uniqueValues(colName) {
  const set = new Set();
  rawData.forEach((row) => {
    const v = (row[colName] || "").trim();
    if (v) set.add(v);
  });
  return Array.from(set).sort();
}

function safeValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

// ==========================
// LOAD DATA
// ==========================

function loadData() {
  fetch(CSV_URL)
    .then((res) => {
      if (!res.ok) throw new Error("Failed to load data");
      return res.text();
    })
    .then((text) => {
      const { headers, rows } = parseCSV(text);
      if (!headers.length) throw new Error("No headers in CSV");

      rawData = rows;
      filteredData = rows.slice();

      initFilters();
      applyFilters();
    })
    .catch((err) => {
      console.error(err);
      const summary = document.getElementById("summary");
      if (summary) {
        summary.textContent =
          "Error loading data. Check that data.csv exists and is valid CSV.";
      }
    });
}

// ==========================
// FILTER UI
// ==========================

function populateSelect(selectId, values, placeholder) {
  const select = document.getElementById(selectId);
  if (!select) return;

  select.innerHTML = "";
  const optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = placeholder;
  select.appendChild(optAll);

  values.forEach((value) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = value;
    select.appendChild(opt);
  });

  select.addEventListener("change", applyFilters);
}

function initFilters() {
  populateSelect("cityFilter", uniqueValues(COL.city), "All cities");
  populateSelect("zoneFilter", uniqueValues(COL.zone), "All zones");
  populateSelect("zoneTypeFilter", uniqueValues(COL.zoneType), "All types");

  const search = document.getElementById("searchInput");
  if (search) search.addEventListener("input", debounce(applyFilters, 150));

  const aduSel = document.getElementById("aduAllowedFilter");
  if (aduSel) aduSel.addEventListener("change", applyFilters);

  const daduSel = document.getElementById("daduAllowedFilter");
  if (daduSel) daduSel.addEventListener("change", applyFilters);

  const ownerOccSel = document.getElementById("ownerOccFilter");
  if (ownerOccSel) ownerOccSel.addEventListener("change", applyFilters);

  const clearBtn = document.getElementById("clearFilters");
  if (clearBtn) clearBtn.addEventListener("click", clearFilters);
}

// ==========================
// FILTER LOGIC
// ==========================

function applyFilters() {
  const cityVal = safeValue("cityFilter");
  const zoneVal = safeValue("zoneFilter");
  const zoneTypeVal = safeValue("zoneTypeFilter");
  const aduVal = safeValue("aduAllowedFilter");
  const daduVal = safeValue("daduAllowedFilter");
  const ownerOccVal = safeValue("ownerOccFilter");
  const searchVal = (document.getElementById("searchInput")?.value || "")
    .toLowerCase()
    .trim();

  filteredData = rawData.filter((row) => {
    if (cityVal && get(row, COL.city) !== cityVal) return false;
    if (zoneVal && get(row, COL.zone) !== zoneVal) return false;
    if (zoneTypeVal && get(row, COL.zoneType) !== zoneTypeVal) return false;
    if (aduVal && get(row, COL.aduAllowed) !== aduVal) return false;
    if (daduVal && get(row, COL.daduAllowed) !== daduVal) return false;
    if (ownerOccVal && get(row, COL.ownerOcc) !== ownerOccVal) return false;

    if (searchVal) {
      const haystack = (
        get(row, COL.city) +
        " " +
        get(row, COL.zone) +
        " " +
        get(row, COL.zoneType) +
        " " +
        get(row, COL.notes) +
        " " +
        get(row, COL.codeSection) +
        " " +
        get(row, COL.parkingNotes || "Parking_Notes")
      )
        .toLowerCase()
        .trim();

      if (!haystack.includes(searchVal)) return false;
    }

    return true;
  });

  render();
}

function clearFilters() {
  ["cityFilter", "zoneFilter", "zoneTypeFilter", "aduAllowedFilter", "daduAllowedFilter", "ownerOccFilter"].forEach(
    (id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    }
  );
  const search = document.getElementById("searchInput");
  if (search) search.value = "";
  filteredData = rawData.slice();
  render();
}

// ==========================
// RENDER TABLE
// ==========================

function render() {
  const tbody = document.getElementById("resultsBody");
  const summary = document.getElementById("summary");
  if (!tbody) return;

  tbody.innerHTML = "";

  if (summary) {
    summary.textContent = `${filteredData.length} of ${rawData.length} rows shown`;
  }

  filteredData.forEach((row) => {
    const tr = document.createElement("tr");

    const city = get(row, COL.city) || "—";
    const zone = get(row, COL.zone) || "—";
    const zoneType = get(row, COL.zoneType) || "—";
    const adu = get(row, COL.aduAllowed) || "—";
    const dadu = get(row, COL.daduAllowed) || "—";
    const maxADUSize = get(row, COL.maxADUSize) || "—";
    const maxDADUSize = get(row, COL.maxDADUSize) || "—";
    const maxADUs = get(row, COL.maxADUs) || "—";
    const minLot = get(row, COL.minLotSize) || "—";
    const maxLotCoverage = get(row, COL.maxLotCoverage) || "—";
const maxImpervious = get(row, COL.maxImpervious) || "—";
    const minParking = get(row, COL.minParking) || "—";
    const ownerOcc = get(row, COL.ownerOcc) || "—";
    const heightPrimary = get(row, COL.heightPrimary) || "—";
    const heightDADU = get(row, COL.heightDADU) || "—";
    const frontSetback = get(row, COL.frontSetback) || "—";
    const sideSetback = get(row, COL.sideSetback) || "—";
    const rearSetback = get(row, COL.rearSetback) || "—";
    const codeSection = get(row, COL.codeSection);
    const sourceURL = get(row, COL.sourceURL);
    const notes = get(row, COL.notes) || "—";

    const setbacksCombined =
      `${frontSetback} / ${sideSetback} / ${rearSetback}`;

    const cells = [
      city,
      zone,
      zoneType,
      adu,
      dadu,
      maxADUSize,
      maxDADUSize,
      maxADUs,
      minLot,
      maxLotCoverage,      
      maxImpervious,
      minParking,
      ownerOcc,
      heightPrimary,
      heightDADU,
      setbacksCombined,
      codeSection || "—",
      notes,
    ];

    cells.forEach((val, idx) => {
      const td = document.createElement("td");
      if (idx === 14 && codeSection && sourceURL) {
        const a = document.createElement("a");
        a.href = sourceURL;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = codeSection;
        td.appendChild(a);
      } else {
        td.textContent = val;
      }
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

// ==========================
// UTIL
// ==========================

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(null, args), delay);
  };
}

// ==========================
// BOOTSTRAP
// ==========================

document.addEventListener("DOMContentLoaded", loadData);
