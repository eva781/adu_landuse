// 1) Replace this with your published Google Sheets CSV URL
// Make sure it ends with something like: .../pub?output=csv
const CSV_URL =
https://docs.google.com/spreadsheets/d/e/2PACX-1vTeC5eZxa23_nAI0UMbuLofZyoNHHpYuAsagqV5cMS15UkgTUl290Ntxu6bVwUly-RWoGYWCcxQVeCe/pubhtml

let rawData = [];
let filteredData = [];
let headerMap = {}; // maps logical fields -> actual CSV header names

// ==========================================
// CSV PARSER (handles quoted commas)
// ==========================================

function parseCSVWithHeaders(text) {
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

// ==========================================
// HEADER MAPPING (auto-detect columns)
// ==========================================

function inferHeaderMap(headers) {
  const lowered = headers.map((h) => h.toLowerCase());

  const findHeader = (...candidates) => {
    // exact match preferred
    for (const candidate of candidates) {
      const idx = lowered.indexOf(candidate.toLowerCase());
      if (idx !== -1) return headers[idx];
    }
    // fallback: substring match
    for (const candidate of candidates) {
      for (let i = 0; i < lowered.length; i++) {
        if (lowered[i].includes(candidate.toLowerCase())) {
          return headers[i];
        }
      }
    }
    return null;
  };

  return {
    city: findHeader("city", "municipality"),
    zone: findHeader("zone", "zoning"),
    zoneType: findHeader("zone_type", "zone type", "zone category"),
    aduAllowed: findHeader("adu_allowed", "adu allowed"),
    daduAllowed: findHeader("dadu_allowed", "dadu allowed", "detached adu allowed"),
    maxADUs: findHeader("max_adus_per_lot", "max adus per lot"),
    maxADUSize: findHeader("max_adu_size_sqft", "max adu size"),
    minLotSize: findHeader("min_lot_size_sqft", "minimum lot size"),
    minParking: findHeader("min_parking_spaces", "adu_parking_required", "min parking"),
    ownerOcc: findHeader("owner_occupancy_required", "owner occupancy"),
    heightPrimary: findHeader("max_building_height_primary_ft", "primary_height"),
    heightDADU: findHeader("dadu_max_height_ft", "max_dadu_height_ft"),
    frontSetback: findHeader("front_setback_ft", "front setback"),
    sideSetback: findHeader("side_setback_ft", "side setback"),
    rearSetback: findHeader("rear_setback_ft", "rear setback"),
    codeSection: findHeader("reference_code_section", "code_section", "code section"),
    sourceURL: findHeader("source_document_url", "source_pdf_url"),
    notes: findHeader("notes", "remarks", "comments"),
  };
}

// Convenience accessor
function getField(row, key) {
  if (!key) return "";
  return row[key] || "";
}

// ==========================================
// DATA LOADING
// ==========================================

function loadData() {
  fetch(CSV_URL)
    .then((res) => {
      if (!res.ok) throw new Error("Failed to load data");
      return res.text();
    })
    .then((text) => {
      const { headers, rows } = parseCSVWithHeaders(text);
      if (!headers.length) throw new Error("No headers in CSV");

      rawData = rows;
      filteredData = rows.slice();
      headerMap = inferHeaderMap(headers);

      initFilters();
      applyFilters();
    })
    .catch((err) => {
      console.error(err);
      const summary = document.getElementById("summary");
      if (summary) {
        summary.textContent =
          "Error loading data. Check the CSV URL in app.js and that the sheet is published as CSV.";
      }
    });
}

// ==========================================
// FILTER INITIALIZATION
// ==========================================

function uniqueValues(data, headerKey) {
  if (!headerKey) return [];
  const set = new Set();
  data.forEach((row) => {
    const val = (row[headerKey] || "").trim();
    if (val) set.add(val);
  });
  return Array.from(set).sort();
}

function populateSelect(select, values, placeholder) {
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
}

function initFilters() {
  const citySelect = document.getElementById("cityFilter");
  const zoneSelect = document.getElementById("zoneFilter");
  const zoneTypeSelect = document.getElementById("zoneTypeFilter");

  if (citySelect && headerMap.city) {
    populateSelect(
      citySelect,
      uniqueValues(rawData, headerMap.city),
      "All cities"
    );
    citySelect.addEventListener("change", applyFilters);
  }

  if (zoneSelect && headerMap.zone) {
    populateSelect(
      zoneSelect,
      uniqueValues(rawData, headerMap.zone),
      "All zones"
    );
    zoneSelect.addEventListener("change", applyFilters);
  }

  if (zoneTypeSelect && headerMap.zoneType) {
    populateSelect(
      zoneTypeSelect,
      uniqueValues(rawData, headerMap.zoneType),
      "All types"
    );
    zoneTypeSelect.addEventListener("change", applyFilters);
  }

  const aduSelect = document.getElementById("aduAllowedFilter");
  if (aduSelect) aduSelect.addEventListener("change", applyFilters);

  const daduSelect = document.getElementById("daduAllowedFilter");
  if (daduSelect) daduSelect.addEventListener("change", applyFilters);

  const ownerOccSelect = document.getElementById("ownerOccFilter");
  if (ownerOccSelect) ownerOccSelect.addEventListener("change", applyFilters);

  const search = document.getElementById("searchInput");
  if (search) search.addEventListener("input", debounce(applyFilters, 150));

  const clearBtn = document.getElementById("clearFilters");
  if (clearBtn) clearBtn.addEventListener("click", clearFilters);
}

// ==========================================
// FILTERING & SEARCH
// ==========================================

function applyFilters() {
  const cityVal = safeSelectValue("cityFilter");
  const zoneVal = safeSelectValue("zoneFilter");
  const zoneTypeVal = safeSelectValue("zoneTypeFilter");
  const aduVal = safeSelectValue("aduAllowedFilter");
  const daduVal = safeSelectValue("daduAllowedFilter");
  const ownerOccVal = safeSelectValue("ownerOccFilter");
  const searchVal = (document.getElementById("searchInput")?.value || "")
    .toLowerCase()
    .trim();

  filteredData = rawData.filter((row) => {
    if (cityVal && headerMap.city && row[headerMap.city] !== cityVal) {
      return false;
    }
    if (zoneVal && headerMap.zone && row[headerMap.zone] !== zoneVal) {
      return false;
    }
    if (
      zoneTypeVal &&
      headerMap.zoneType &&
      row[headerMap.zoneType] !== zoneTypeVal
    ) {
      return false;
    }
    if (
      aduVal &&
      headerMap.aduAllowed &&
      row[headerMap.aduAllowed] !== aduVal
    ) {
      return false;
    }
    if (
      daduVal &&
      headerMap.daduAllowed &&
      row[headerMap.daduAllowed] !== daduVal
    ) {
      return false;
    }
    if (
      ownerOccVal &&
      headerMap.ownerOcc &&
      row[headerMap.ownerOcc] !== ownerOccVal
    ) {
      return false;
    }

    if (searchVal) {
      const parts = [];

      [
        headerMap.city,
        headerMap.zone,
        headerMap.zoneType,
        headerMap.aduAllowed,
        headerMap.daduAllowed,
        headerMap.minLotSize,
        headerMap.minParking,
        headerMap.codeSection,
        headerMap.notes,
      ].forEach((key) => {
        if (key) parts.push(row[key] || "");
      });

      const haystack = parts.join(" ").toLowerCase();
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

function safeSelectValue(id) {
  const el = document.getElementById(id);
  return el ? el.value : "";
}

// ==========================================
// RENDERING
// ==========================================

function render() {
  const tbody = document.getElementById("resultsBody");
  const summary = document.getElementById("summary");
  const chipsContainer = document.getElementById("activeFilters");

  if (!tbody) return;

  tbody.innerHTML = "";
  if (chipsContainer) chipsContainer.innerHTML = "";

  if (summary) {
    summary.textContent = `${filteredData.length} of ${rawData.length} rows shown`;
  }

  const filters = [];
  const cityVal = safeSelectValue("cityFilter");
  const zoneVal = safeSelectValue("zoneFilter");
  const zoneTypeVal = safeSelectValue("zoneTypeFilter");
  const aduVal = safeSelectValue("aduAllowedFilter");
  const daduVal = safeSelectValue("daduAllowedFilter");
  const ownerOccVal = safeSelectValue("ownerOccFilter");
  const searchVal = (document.getElementById("searchInput")?.value || "").trim();

  if (cityVal) filters.push(`City: ${cityVal}`);
  if (zoneVal) filters.push(`Zone: ${zoneVal}`);
  if (zoneTypeVal) filters.push(`Type: ${zoneTypeVal}`);
  if (aduVal) filters.push(`ADU: ${aduVal}`);
  if (daduVal) filters.push(`DADU: ${daduVal}`);
  if (ownerOccVal) filters.push(`Owner occ.: ${ownerOccVal}`);
  if (searchVal) filters.push(`Search: “${searchVal}”`);

  if (chipsContainer) {
    filters.forEach((text) => {
      const chip = document.createElement("div");
      chip.className = "chip";
      chip.textContent = text;
      chipsContainer.appendChild(chip);
    });
  }

  // Build table rows
  filteredData.forEach((row) => {
    const tr = document.createElement("tr");

    const city = getField(row, headerMap.city);
    const zone = getField(row, headerMap.zone);
    const zoneType = getField(row, headerMap.zoneType);
    const adu = getField(row, headerMap.aduAllowed);
    const dadu = getField(row, headerMap.daduAllowed);
    const maxADUSize = getField(row, headerMap.maxADUSize);
    const maxADUs = getField(row, headerMap.maxADUs);
    const minLot = getField(row, headerMap.minLotSize);
    const minParking = getField(row, headerMap.minParking);
    const ownerOcc = getField(row, headerMap.ownerOcc);
    const heightPrimary = getField(row, headerMap.heightPrimary);
    const heightDADU = getField(row, headerMap.heightDADU);
    const frontSetback = getField(row, headerMap.frontSetback);
    const sideSetback = getField(row, headerMap.sideSetback);
    const rearSetback = getField(row, headerMap.rearSetback);
    const codeSection = getField(row, headerMap.codeSection);
    const sourceURL = getField(row, headerMap.sourceURL);
    const notes = getField(row, headerMap.notes);

    const setbacksCombined =
      [frontSetback, sideSetback, rearSetback]
        .map((v) => (v ? v : "—"))
        .join(" / ") || "—";

    const cells = [
      city || "—",
      zone || "—",
      zoneType || "—",
      adu || "—",
      dadu || "—",
      maxADUSize || "—",
      maxADUs || "—",
      minLot || "—",
      minParking || "—",
      ownerOcc || "—",
      heightPrimary || "—",
      heightDADU || "—",
      setbacksCombined,
      codeSection || "—",
      notes || "—",
    ];

    cells.forEach((value, idx) => {
      const td = document.createElement("td");

      // Make code section a link if we have a URL
      if (idx === 13 && codeSection && sourceURL) {
        const a = document.createElement("a");
        a.href = sourceURL;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = codeSection;
        td.appendChild(a);
      } else {
        td.textContent = value;
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

// ==========================================
// UTIL: debounce
// ==========================================

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(null, args), delay);
  };
}

// ==========================================
// BOOTSTRAP
// ==========================================

document.addEventListener("DOMContentLoaded", loadData);

