#!/usr/bin/env python3
"""
update_permits.py

Fetch Bellevue ADU permits from the official ArcGIS FeatureServer endpoint,
normalize into a unified schema, drop cancelled permits, and write
adu_permits.csv in the repo root.
"""

import csv
import datetime as dt
import sys
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

import requests


# -----------------------------
# CONFIG
# -----------------------------

OUTPUT_CSV = "adu_permits.csv"

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


@dataclass
class CitySource:
    city_name: str
    url: str
    type: str          # "arcgis_json", could add "csv" later
    format: str        # which normalizer to use


CITY_SOURCES: List[CitySource] = [
    CitySource(
        city_name="Bellevue",
        # ArcGIS FeatureServer layer for ADU permits
        url=(
            "https://services.arcgis.com/9YgDo7Ef8pPKUwMb/ArcGIS/rest/services/"
            "Accessory_Dwelling_Unit_ADU_Permits/FeatureServer/0/query"
            "?where=1%3D1&outFields=*&f=json"
        ),
        type="arcgis_json",
        format="bellevue_arcgis",
    ),
]


# -----------------------------
# NORMALIZERS
# -----------------------------


def normalize_bellevue_arcgis(feature: Dict[str, Any]) -> Dict[str, str]:
    """
    Normalize a single ArcGIS feature from Bellevue's ADU permits layer
    into our unified OUTPUT_FIELDNAMES schema.
    """
    attrs = feature.get("attributes", {}) or {}

    def get_attr(key: str) -> str:
        val = attrs.get(key)
        return "" if val is None else str(val).strip()

    # Approval date often stored as epoch milliseconds in ArcGIS
    approval_raw = attrs.get("ApprovalDate") or attrs.get("Approval_Date")
    approval_iso: str = ""
    if isinstance(approval_raw, (int, float)):
        try:
            # ArcGIS uses milliseconds since epoch
            approval_iso = dt.datetime.utcfromtimestamp(
                approval_raw / 1000.0
            ).date().isoformat()
        except Exception:
            approval_iso = ""
    elif isinstance(approval_raw, str):
        # If already string, best effort
        try:
            approval_iso = dt.date.fromisoformat(approval_raw[:10]).isoformat()
        except Exception:
            approval_iso = approval_raw.strip()

    # Some typical field names in Bellevue's layer; adjust if needed
    project_name = get_attr("ProjectName") or get_attr("PROJECT_NAME")
    adu_type = get_attr("ADUType") or get_attr("ADU_TYPE")
    status = get_attr("Status") or get_attr("PERMIT_STATUS")
    permit_no = get_attr("PermitNumber") or get_attr("PERMIT_NUMBER")
    parcel = get_attr("ParcelNumber") or get_attr("PARCEL")
    zone = get_attr("Zoning") or get_attr("ZONE")
    size_sqft = get_attr("ADUSizeSqft") or get_attr("ADU_SIZE_SQFT")
    source_url = (
        get_attr("DetailPageURL")
        or get_attr("URL")
        or get_attr("LINK")
    )
    notes = get_attr("Notes")

    return {
        "City": "Bellevue",
        "Project_Name": project_name,
        "ADU_Type": adu_type,
        "Status": status,
        "Permit_Number": permit_no,
        "Parcel": parcel,
        "Zone": zone,
        "ADU_Size_Sqft": size_sqft,
        "Approval_Date": approval_iso,
        "Source_URL": source_url,
        "Notes": notes,
    }


# Map format name -> normalizer function
NORMALIZERS = {
    "bellevue_arcgis": normalize_bellevue_arcgis,
}


# -----------------------------
# MAIN FETCH / WRITE LOGIC
# -----------------------------


def fetch_all_cities() -> List[Dict[str, str]]:
    all_rows: List[Dict[str, str]] = []

    for src in CITY_SOURCES:
        print(f"[INFO] Fetching {src.city_name} from {src.url}")

        try:
            resp = requests.get(src.url, timeout=60)
        except Exception as e:
            print(f"[WARN] Request error for {src.city_name}: {e}", file=sys.stderr)
            continue

        if resp.status_code != 200:
            print(
                f"[WARN] {src.url} returned {resp.status_code} "
                f"for {src.city_name}",
                file=sys.stderr,
            )
            continue

        out_rows: List[Dict[str, str]] = []

        if src.type == "arcgis_json":
            try:
                data = resp.json()
            except Exception as e:
                print(
                    f"[WARN] Failed to parse JSON for {src.city_name}: {e}",
                    file=sys.stderr,
                )
                continue

            features = data.get("features", [])
            normalizer = NORMALIZERS.get(src.format)
            if not normalizer:
                print(
                    f"[WARN] No normalizer for format {src.format}",
                    file=sys.stderr,
                )
                continue

            for feat in features:
                out = normalizer(feat)
                out_rows.append(out)
        else:
            print(
                f"[WARN] Unsupported source type {src.type} for {src.city_name}",
                file=sys.stderr,
            )
            continue

        print(f"[INFO] {src.city_name}: collected {len(out_rows)} rows")
        all_rows.extend(out_rows)

    return all_rows


def filter_and_sort_rows(rows: List[Dict[str, str]]) -> List[Dict[str, str]]:
    if not rows:
        return []

    # Drop cancelled/canceled permits
    filtered: List[Dict[str, str]] = []
    for row in rows:
        status = (row.get("Status") or "").strip().lower()
        if status.startswith("cancel"):
            continue
        filtered.append(row)

    # Sort by approval date desc
    def parse_date(s: str) -> dt.date:
        try:
            return dt.datetime.fromisoformat(s[:10]).date()
        except Exception:
            return dt.date(1970, 1, 1)

    filtered.sort(
        key=lambda r: parse_date(r.get("Approval_Date", "")),
        reverse=True,
    )

    return filtered


def write_csv(rows: List[Dict[str, str]], path: str = OUTPUT_CSV) -> None:
    if not rows:
        print(
            "[WARN] No rows to write; not overwriting existing adu_permits.csv",
            file=sys.stderr,
        )
        return

    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=OUTPUT_FIELDNAMES)
        writer.writeheader()
        for row in rows:
            writer.writerow(row)

    print(f"[INFO] Wrote {len(rows)} rows to {path}")


def main() -> int:
    rows = fetch_all_cities()
    if not rows:
        print(
            "[WARN] No rows collected; keeping existing adu_permits.csv (if any).",
            file=sys.stderr,
        )
        return 0

    cleaned = filter_and_sort_rows(rows)
    write_csv(cleaned, OUTPUT_CSV)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
