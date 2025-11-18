// 1) Replace this with your published Google Sheets CSV URL
// Make sure it ends with something like: .../pub?output=csv
const CSV_URL =
https://docs.google.com/spreadsheets/d/e/2PACX-1vTeC5eZxa23_nAI0UMbuLofZyoNHHpYuAsagqV5cMS15UkgTUl290Ntxu6bVwUly-RWoGYWCcxQVeCe/pub?output=csv

let rawData = [];
let filteredData = [];

// Columns we care about (must match your sheet headers)
const COLUMNS = [
  "City",
  "County",
  "State",
  "Zone",
  "Zone_Type",
  "ADU_Allowed",
  "DADU_Allowed",
  "Max_ADUs_Per_Lot",
  "Max_ADU_Size_Sqft",
  "Max_ADU_Size_Percent_Primary",
  "Max_DADU_Size_Sqft",
  "Max_ADU_Height_ft",
  "Max_Lot_Coverage_Percent",
  "Max_FAR",
  "Min_Lot_Size_Sqft",
  "Min_Parking_Spaces",
  "Parking_Notes",
  "Alley_Access_Allowed",
  "Owner_Occupancy_Required",
  "Owner_Occupancy_Notes",
  "Short_Term_Rental_Allowed",
  "Occupancy_Limit_Notes",
  "Min_Front_Setback_ft",
  "Min_Side_Setback_ft",
  "Min_Rear_Setback_ft",
  "Min_Separation_From_Primary_ft",
  "Design_Standards_Notes",
  "Entry_Orientation_Notes",
  "Process_Type",
  "Impact_Fees_Notes",
  "Affordability_Requirements",
  "Reference_Code_Section",
  "Source_Document_URL",
  "Last_Reviewed_Date",
  "Notes",
];

// --- CSV parsing (simple but handles quoted commas) -----------------------

function parseCSV(text) {
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

  if (!rows.length) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows.slice(1).map((cells) => {
    const row = {};
    headers.forEach((h, i) => {
      row[h] = (cells[i] || "").trim();
    });
    return row;
  });
}

// --- Data loading & initialization ---------------------------------------

function loadData() {
  fetch(CSV_URL)
    .then((res) => {
      if (!res.ok) throw new Error("Failed to load data");
      return res.text();
    })
    .then((text) => {
      rawData = parseCSV(text);
      filteredData = rawData.slice();
      initFilters();
      applyFilters(); // also renders
    })
    .catch((err) => {
      console.error(err);
      document.getElementById("summary").textContent =
        "Error loading data. Check the CSV URL in app.js.";
    });
}

function initFilters() {
  const citySelect = document.getElementById("cityFilter");
  const zoneSelect = document.getElementById("zoneFilter");
  const zoneTypeSelect = document.getElementById("zoneTypeFilter");

  const cities = uniqueValues(rawData, "City");
  const zones = uniqueValues(rawData, "Zone");
  const zoneTypes = uniqueValues(rawData, "Zone_Type");

  populateSelect(citySelect, cities, "All cities");
  populateSelect(zoneSelect, zones, "All zones");
  populateSelect(zoneTypeSelect, zoneTypes, "All types");

  citySelect.addEventListener("change", applyFilters);
  zoneSelect.addEventListener("change", applyFilters);
  zoneTypeSelect.addEventListener("change", applyFilters);
  document
    .getElementById("aduAllowedFilter")
    .addEventListener("change", applyFilters);
  document
    .getElementById("daduAllowedFilter")
    .addEventListener("change", applyFilters);
  document
    .getElementById("ownerOccFilter")
    .addEventListener("change", applyFilters);
  document
    .getElementById("searchInput")
    .addEventListener("input", debounce(applyFilters, 150));
  document
    .getElementById("clearFilters")
    .addEventListener("click", clearFilters);
}

function uniqueValues(data, key) {
  return Array.from(
    new Set(data.map((row) => row[key]).filter((v) => v && v.trim().length > 0))
  ).sort();
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

// --- Filtering & rendering ----------------------------------------------

function applyFilters() {
  const city = document.getElementById("cityFilter").value;
  const zone = document.getElementById("zoneFilter").value;
  const zoneType = document.getElementById("zoneTypeFilter").value;
  const aduAllowed = document.getElementById("aduAllowedFilter").value;
  const daduAllowed = document.getElementById("daduAllowedFilter").value;
  const ownerOcc = document.getElementById("ownerOccFilter").value;
  const search = document
    .getElementById("searchInput")
    .value.toLowerCase()
    .trim();

  filteredData = rawData.filter((row) => {
    if (city && row.City !== city) return false;
    if (zone && row.Zone !== zone) return false;
    if (zoneType && row.Zone_Type !== zoneType) return false;
    if (aduAllowed && row.ADU_Allowed !== aduAllowed) return false;
    if (daduAllowed && row.DADU_Allowed !== daduAllowed) return false;
    if (ownerOcc && row.Owner_Occupancy_Required !== ownerOcc) return false;

    if (search) {
      const haystack = [
        row.City,
        row.Zone,
        row.Zone_Type,
        row.ADU_Allowed,
        row.DADU_Allowed,
        row.Parking_Notes,
        row.Owner_Occupancy_Notes,
        row.Design_Standards_Notes,
        row.Entry_Orientation_Notes,
        row.Process_Type,
        row.Impact_Fees_Notes,
        row.Affordability_Requirements,
        row.Reference_Code_Section,
        row.Notes,
      ]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(search)) return false;
    }

    return true;
  });

  render();
}

function clearFilters() {
  document.getElementById("cityFilter").value = "";
  document.getElementById("zoneFilter").value = "";
  document.getElementById("zoneTypeFilter").value = "";
  document.getElementById("aduAllowedFilter").value = "";
  document.getElementById("daduAllowedFilter").value = "";
  document.getElementById("ownerOccFilter").value = "";
  document.getElementById("searchInput").value = "";
  filteredData = rawData.slice();
  render();
}

function render() {
  const tbody = document.getElementById("resultsBody");
  const summary = document.getElementById("summary");
  const chipsContainer = document.getElementById("activeFilters");

  tbody.innerHTML = "";
  chipsContainer.innerHTML = "";

  summary.textContent = `${filteredData.length} of ${rawData.length} zoning rows shown`;

  // Active filter chips
  const filters = [];
  const city = document.getElementById("cityFilter").value;
  const zone = document.getElementById("zoneFilter").value;
  const zoneType = document.getElementById("zoneTypeFilter").value;
  const aduAllowed = document.getElementById("aduAllowedFilter").value;
  const daduAllowed = document.getElementById("daduAllowedFilter").value;
  const ownerOcc = document.getElementById("ownerOccFilter").value;
  const search = document.getElementById("searchInput").value.trim();

  if (city) filters.push(`City: ${city}`);
  if (zone) filters.push(`Zone: ${zone}`);
  if (zoneType) filters.push(`Type: ${zoneType}`);
  if (aduAllowed) filters.push(`ADU: ${aduAllowed}`);
  if (daduAllowed) filters.push(`DADU: ${daduAllowed}`);
  if (ownerOcc) filters.push(`Owner occ.: ${ownerOcc}`);
  if (search) filters.push(`Search: “${search}”`);

  filters.forEach((text) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = text;
    chipsContainer.appendChild(chip);
  });

  // Render table rows
  filteredData.forEach((row) => {
    const tr = document.createElement("tr");

    const setbacks = [
      row.Min_Front_Setback_ft,
      row.Min_Side_Setback_ft,
      row.Min_Rear_Setback_ft,
    ]
      .map((v) => (v ? v : "—"))
      .join(" / ");

    const cells = [
      row.City,
      row.Zone,
      row.Zone_Type,
      row.ADU_Allowed,
      row.DADU_Allowed,
      row.Max_ADU_Size_Sqft,
      row.Max_DADU_Size_Sqft,
      row.Max_ADUs_Per_Lot,
      row.Min_Lot_Size_Sqft,
      row.Min_Parking_Spaces,
      row.Owner_Occupancy_Required,
      row.Max_ADU_Height_ft,
      setbacks,
      row.Reference_Code_Section,
      row.Notes,
    ];

    cells.forEach((value, idx) => {
      const td = document.createElement("td");

      // For code section, link to source document if available
      if (idx === 13 && row.Source_Document_URL && row.Reference_Code_Section) {
        const a = document.createElement("a");
        a.href = row.Source_Document_URL;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        a.textContent = row.Reference_Code_Section;
        td.appendChild(a);
      } else {
        td.textContent = value || "—";
      }

      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

// --- small utility: debounce ---------------------------------------------

function debounce(fn, delay) {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn.apply(null, args), delay);
  };
}

document.addEventListener("DOMContentLoaded", loadData);
