#!/usr/bin/env python3
"""
update_permits.py

Fetches ADU permit data from one or more public endpoints
and writes a unified adu_permits.csv file in the repo root.

Right now this uses:
- City of Bellevue's official "Accessory Dwelling Unit (ADU) Permits Data"
  dataset as a live CSV feed.

You can add more cities later (e.g., Shoreline) by wiring in additional
sources below.
"""

import csv
import datetime as dt
import io
import sys
from dataclasses import dataclass
from typing import List, Dict, Any, Optional

import requests

# -----------------------------------------------------------------------------
# CONFIG – data sources
# -----------------------------------------------------------------------------

@dataclass
class CitySource:
    city_name: str   # How we label the city in output
    url: str         # Endpoint URL (CSV or JSON)
    type: str        # "csv" or "json"
    format: str      # "bellevue_adu" | "generic_csv" | etc.


CITY_SOURCES: List[CitySource] = [
    # 1) BELLEVUE: official ADU permit dataset, refreshed daily on Open Data
    #    Dataset: "Bellevue Accessory Dwelling Unit (ADU) Permits Data"
    #    CSV download endpoint:
    #    https://data.bellevuewa.gov/datasets/befaac91b58e4bca8f9cca811d4200a6_0.csv
    CitySource(
        city_name="Bellevue",
url="https://opendata.arcgis.com/datasets/befaac91b58e4bca8f9cca811d4200a6_0.csv?outSR=4326",
        type="csv",
        format="bellevue_adu",
    ),

    # 2) Example hook for Shoreline (you can add later):
    # CitySource(
    #     city_name="Shoreline",
    #     url="https://raw.githubusercontent.com/YOUR_USER/YOUR_REPO/main/shoreline_adu_permits.csv",
    #     type="csv",
    #     format="generic_csv",
    # ),
]

# These are the columns your frontend already expects:
OUTPUT_FIELDNAMES = [
    "City",
    "Project_Name",
    "ADU_Type",
    "Status",
    "Permit_Number",
    "Parcel",
    "Zone",
    "ADU_Size_Sqft",
    "Approval_Date",
    "Source_URL",
    "Notes",
]

# -----------------------------------------------------------------------------
# LOW-LEVEL HELPERS
# -----------------------------------------------------------------------------

def fetch_text(url: str) -> Optional[str]:
    try:
        resp = requests.get(url, timeout=45)
        if resp.status_code != 200:
            print(f"[WARN] {url} returned {resp.status_code}", file=sys.stderr)
            return None
        return resp.text
    except Exception as e:
        print(f"[ERROR] fetch_text({url}): {e}", file=sys.stderr)
        return None


def parse_csv_text(text: str) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    f = io.StringIO(text)
    reader = csv.DictReader(f)
    for row in reader:
        norm = {
            (k or "").strip(): (v or "").strip()
            for k, v in row.items()
            if k is not None
        }
        rows.append(norm)
    return rows


# -----------------------------------------------------------------------------
# NORMALIZERS
# -----------------------------------------------------------------------------

def normalize_bellevue_adu(raw: Dict[str, Any]) -> Dict[str, str]:
    """
    Map Bellevue's ADU Permits Data row into OUTPUT_FIELDNAMES.

    According to the dataset, typical fields include:
    - CITY
    - STATE
    - ZIP CODE
    - PERMIT STATUS
    - PARCEL NUMBER
    - PERMIT YEAR
    - PERMIT SEQUENCE
    - PROJECT NAME
    - ADDRESS
    - LINK or PERMIT URL (may appear as a URL field)
    plus others.

    We'll be conservative and only use what we can reasonably infer.
    """

    # Start with blanks
    out = {k: "" for k in OUTPUT_FIELDNAMES}

    # City label for your app
    out["City"] = "Bellevue"

    # Project name
    project_name = (
        raw.get("PROJECT NAME")
        or raw.get("Project Name")
        or raw.get("PROJECT_NAME")
        or ""
    ).strip()
    if not project_name:
        project_name = "ADU project"
    out["Project_Name"] = project_name

    # ADU type – we don't get explicit DADU/AADU from this dataset,
    # so we classify very roughly from project name and any type-ish fields.
    text_all = " ".join([project_name, (raw.get("PERMIT TYPE") or "")]).upper()
    if "DETACHED" in text_all or "DADU" in text_all or "BACKYARD" in text_all:
        adu_type = "Detached ADU"
    elif "CONVERSION" in text_all or "GARAGE" in text_all:
        adu_type = "Conversion ADU"
    else:
        adu_type = "Attached/Unknown ADU"
    out["ADU_Type"] = adu_type

    # Status
    status = (
        raw.get("PERMIT STATUS")
        or raw.get("Permit Status")
        or raw.get("STATUS")
        or ""
    ).strip()
    out["Status"] = status

    # Permit number: often composed of year + sequence, but dataset may have a field
    permit_number = (
        raw.get("PERMIT NUMBER")
        or raw.get("Permit Number")
        or raw.get("PERMITNUMBER")
        or ""
    ).strip()

    if not permit_number:
        # Fallback: combine PERMIT YEAR + PERMIT SEQUENCE if present
        year = (raw.get("PERMIT YEAR") or "").strip()
        seq = (raw.get("PERMIT SEQUENCE") or "").strip()
        if year or seq:
            permit_number = f"{year}-{seq}".strip("-")

    out["Permit_Number"] = permit_number

    # Parcel number
    parcel = (
        raw.get("PARCEL NUMBER")
        or raw.get("Parcel Number")
        or raw.get("PARCEL")
        or ""
    ).strip()
    out["Parcel"] = parcel

    # Zoning is NOT part of this dataset; leave blank for now.
    out["Zone"] = ""

    # ADU size is not in this dataset either; leave blank
    out["ADU_Size_Sqft"] = ""

    # Approval date: usually "ISSUE DATE" or similar
    date_fields = [
        "ISSUE DATE",
        "Issue Date",
        "APPROVAL DATE",
        "Approval Date",
    ]
    approval_date = ""
    for f_name in date_fields:
        if f_name in raw and raw[f_name].strip():
            approval_date = raw[f_name].strip().split("T")[0]
            break
    out["Approval_Date"] = approval_date

    # Source URL – look for anything that looks like a link
    source_url = (
        raw.get("LINK")
        or raw.get("Link")
        or raw.get("URL")
        or raw.get("PERMIT URL")
        or ""
    ).strip()
    out["Source_URL"] = source_url

    # Notes field – we can assemble a compact summary
    notes_parts = []

    address = (raw.get("ADDRESS") or raw.get("Address") or "").strip()
    if address:
        notes_parts.append(f"Address: {address}")

    zip_code = (
        raw.get("ZIP CODE")
        or raw.get("ZIP")
        or raw.get("Zip Code")
        or ""
    ).strip()
    if zip_code:
        notes_parts.append(f"ZIP: {zip_code}")

    permit_year = (raw.get("PERMIT YEAR") or "").strip()
    if permit_year:
        notes_parts.append(f"Permit year: {permit_year}")

    if parcel:
        notes_parts.append(f"Parcel: {parcel}")

    if status:
        notes_parts.append(f"Status: {status}")

    out["Notes"] = " | ".join(notes_parts)

    return out


def normalize_generic_csv(city_name: str, raw: Dict[str, Any]) -> Dict[str, str]:
    """
    Fallback for future manually-maintained CSV sources (e.g. Shoreline).

    Assumes columns are reasonably close to our OUTPUT_FIELDNAMES.
    """
    out = {k: "" for k in OUTPUT_FIELDNAMES}
    out["City"] = city_name

    mapping_candidates = {
        "Project_Name": ["Project_Name", "PROJECT NAME", "Project", "Description"],
        "ADU_Type": ["ADU_Type", "Type"],
        "Status": ["Status", "PERMIT STATUS"],
        "Permit_Number": ["Permit_Number", "PERMIT NUMBER", "Permit #"],
        "Parcel": ["Parcel", "PARCEL NUMBER"],
        "Zone": ["Zone", "Zoning"],
        "ADU_Size_Sqft": ["ADU_Size_Sqft", "Size", "Square Feet"],
        "Approval_Date": ["Approval_Date", "ISSUE DATE", "Issue Date", "Date"],
        "Source_URL": ["Source_URL", "Link", "URL"],
        "Notes": ["Notes", "Comments"],
    }

    for out_field, candidates in mapping_candidates.items():
        for cand in candidates:
            if cand in raw and raw[cand]:
                out[out_field] = str(raw[cand]).strip()
                break

    return out


# -----------------------------------------------------------------------------
# MAIN
# -----------------------------------------------------------------------------

def main() -> int:
    all_rows: List[Dict[str, str]] = []

    for src in CITY_SOURCES:
        print(f"[INFO] Fetching {src.city_name} from {src.url}", file=sys.stderr)

        if src.type == "csv":
            text = fetch_text(src.url)
            if not text:
                print(f"[WARN] No CSV data for {src.city_name}", file=sys.stderr)
                continue

            parsed = parse_csv_text(text)

            if src.format == "bellevue_adu":
                for raw in parsed:
                    row = normalize_bellevue_adu(raw)
                    all_rows.append(row)
            elif src.format == "generic_csv":
                for raw in parsed:
                    row = normalize_generic_csv(src.city_name, raw)
                    all_rows.append(row)
            else:
                print(f"[WARN] Unsupported CSV format {src.format} for {src.city_name}", file=sys.stderr)
                continue

        else:
            print(f"[WARN] Unsupported source type {src.type} for {src.city_name}", file=sys.stderr)
            continue

    if not all_rows:
        print("[WARN] No rows collected; keeping existing adu_permits.csv (if any).", file=sys.stderr)
        return 0

    # Sort by Approval_Date descending
    def parse_date(s: str) -> dt.date:
        try:
            return dt.datetime.fromisoformat(s).date()
        except Exception:
            return dt.date(1970, 1, 1)

    all_rows.sort(key=lambda r: parse_date(r.get("Approval_Date", "")), reverse=True)

    out_path = "adu_permits.csv"
    print(f"[INFO] Writing {len(all_rows)} rows to {out_path}", file=sys.stderr)

    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_FIELDNAMES)
        writer.writeheader()
        for row in all_rows:
            writer.writerow(row)

    print("[INFO] Done.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
