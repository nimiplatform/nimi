from __future__ import annotations

import io
import json
import time
import urllib.request
import zipfile
from pathlib import Path
from urllib.error import URLError
from xml.etree import ElementTree as ET


APP_ROOT = Path(__file__).resolve().parents[1]
OUTPUT_PATH = APP_ROOT / "src" / "shell" / "renderer" / "features" / "profile" / "who-lms-data.json"
DAY_TO_MONTHS = 30.4375
PERCENTILE_COLUMNS = ("P3", "P10", "P25", "P50", "P75", "P90", "P97")
NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"

SOURCE_DEFINITIONS = {
    "height:female": {
        "typeId": "height",
        "gender": "female",
        "source": "WHO Child Growth Standards 2006 + WHO Growth Reference 2007",
        "parts": [
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/length-height-for-age/expandable-tables/lhfa-girls-percentiles-expanded-tables.xlsx?sfvrsn=478569a5_9",
                "ageHeader": "Day",
            },
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/growth-reference-5-19-years/height-for-age-(5-19-years)/hfa-girls-perc-who2007-exp.xlsx?sfvrsn=7a910e5d_2",
                "ageHeader": "Month",
            },
        ],
    },
    "height:male": {
        "typeId": "height",
        "gender": "male",
        "source": "WHO Child Growth Standards 2006 + WHO Growth Reference 2007",
        "parts": [
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/length-height-for-age/expandable-tables/lhfa-boys-percentiles-expanded-tables.xlsx?sfvrsn=bc36d818_9",
                "ageHeader": "Day",
            },
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/growth-reference-5-19-years/height-for-age-(5-19-years)/hfa-boys-perc-who2007-exp.xlsx?sfvrsn=27f20eb1_2",
                "ageHeader": "Month",
            },
        ],
    },
    "weight:female": {
        "typeId": "weight",
        "gender": "female",
        "source": "WHO Child Growth Standards 2006 + WHO Growth Reference 2007 (5-10 years only)",
        "parts": [
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/weight-for-age/expanded-tables/wfa-girls-percentiles-expanded-tables.xlsx?sfvrsn=54cfa5e8_9",
                "ageHeader": "Day",
            },
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/growth-reference-5-19-years/weight-for-age-(5-10-years)/hfa-girls-perc-who2007-exp_6040a43e-81da-48fa-a2d4-5c856fe4fe71.xlsx?sfvrsn=5c5825c4_4",
                "ageHeader": "Month",
            },
        ],
    },
    "weight:male": {
        "typeId": "weight",
        "gender": "male",
        "source": "WHO Child Growth Standards 2006 + WHO Growth Reference 2007 (5-10 years only)",
        "parts": [
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/weight-for-age/expanded-tables/wfa-boys-percentiles-expanded-tables.xlsx?sfvrsn=c2f79259_11",
                "ageHeader": "Day",
            },
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/growth-reference-5-19-years/weight-for-age-(5-10-years)/hfa-boys-perc-who2007-exp_07eb5053-9a09-4910-aa6b-c7fb28012ce6.xlsx?sfvrsn=97ab852c_4",
                "ageHeader": "Month",
            },
        ],
    },
    "head-circumference:female": {
        "typeId": "head-circumference",
        "gender": "female",
        "source": "WHO Child Growth Standards 2006",
        "parts": [
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/head-circumference-for-age/expanded-tables/hcfa-girls-percentiles-expanded-tables.xlsx?sfvrsn=71b282d1_13",
                "ageHeader": "Day",
                "maxAgeMonths": 36.0,
            }
        ],
    },
    "head-circumference:male": {
        "typeId": "head-circumference",
        "gender": "male",
        "source": "WHO Child Growth Standards 2006",
        "parts": [
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/head-circumference-for-age/expanded-tables/hcfa-boys-percentiles-expanded-tables.xlsx?sfvrsn=c266c88f_7",
                "ageHeader": "Day",
                "maxAgeMonths": 36.0,
            }
        ],
    },
    "bmi:female": {
        "typeId": "bmi",
        "gender": "female",
        "source": "WHO Child Growth Standards 2006 + WHO Growth Reference 2007",
        "parts": [
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/body-mass-index-for-age/expanded-tables/bfa-girls-percentiles-expanded-tables.xlsx?sfvrsn=e9395fe_9",
                "ageHeader": "Day",
                "minAgeMonths": 24.0,
            },
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/growth-reference-5-19-years/bmi-for-age-(5-19-years)/bmi-girls-perc-who2007-exp.xlsx?sfvrsn=e866c0a0_2",
                "ageHeader": "Month",
            },
        ],
    },
    "bmi:male": {
        "typeId": "bmi",
        "gender": "male",
        "source": "WHO Child Growth Standards 2006 + WHO Growth Reference 2007",
        "parts": [
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/child-growth-standards/indicators/body-mass-index-for-age/expanded-tables/bfa-boys-percentiles-expanded-tables.xlsx?sfvrsn=aec7ec8d_9",
                "ageHeader": "Day",
                "minAgeMonths": 24.0,
            },
            {
                "url": "https://cdn.who.int/media/docs/default-source/child-growth/growth-reference-5-19-years/bmi-for-age-(5-19-years)/bmi-boys-perc-who2007-exp.xlsx?sfvrsn=28412fcf_2",
                "ageHeader": "Month",
            },
        ],
    },
}


def fetch_binary(url: str) -> bytes:
    last_error: Exception | None = None
    for attempt in range(3):
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; ParentOS-WHO-LMS-Generator/1.0)",
                "Accept": "*/*",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                return response.read()
        except URLError as error:
            last_error = error
            if attempt == 2:
                break
            time.sleep(1.0 + attempt)

    raise RuntimeError(f"Failed to download WHO source after retries: {url}") from last_error


def parse_xlsx_rows(contents: bytes) -> list[dict[str, str]]:
    with zipfile.ZipFile(io.BytesIO(contents)) as workbook:
        shared_strings: list[str] = []
        if "xl/sharedStrings.xml" in workbook.namelist():
            shared_tree = ET.fromstring(workbook.read("xl/sharedStrings.xml"))
            for item in shared_tree:
                texts = [node.text or "" for node in item.iter(f"{{{NS_MAIN}}}t")]
                shared_strings.append("".join(texts))

        workbook_tree = ET.fromstring(workbook.read("xl/workbook.xml"))
        first_sheet = workbook_tree.find(f"{{{NS_MAIN}}}sheets")[0]
        relationship_id = first_sheet.attrib[f"{{{NS_REL}}}id"]
        relationships = ET.fromstring(workbook.read("xl/_rels/workbook.xml.rels"))
        worksheet_target = None
        for relationship in relationships:
            if relationship.attrib.get("Id") == relationship_id:
                worksheet_target = relationship.attrib["Target"]
                break

        if worksheet_target is None:
            raise RuntimeError("Workbook is missing the first worksheet target")

        worksheet_tree = ET.fromstring(workbook.read(f"xl/{worksheet_target}"))
        sheet_data = worksheet_tree.find(f"{{{NS_MAIN}}}sheetData")
        rows: list[list[str]] = []
        for row in sheet_data:
            values: list[str] = []
            for cell in row:
                if not cell.tag.endswith("c"):
                    continue
                raw_value = cell.find(f"{{{NS_MAIN}}}v")
                cell_type = cell.attrib.get("t")
                value = raw_value.text if raw_value is not None else ""
                if cell_type == "s" and value:
                    value = shared_strings[int(value)]
                values.append(value)
            if values:
                rows.append(values)

        header = rows[0]
        return [dict(zip(header, row, strict=False)) for row in rows[1:]]


def normalize_age(age_header: str, raw_age: float) -> float:
    if age_header in {"Day", "Age"}:
        return raw_age / DAY_TO_MONTHS
    if age_header == "Month":
        return raw_age
    raise ValueError(f"Unsupported age header: {age_header}")


def build_points(
    rows: list[dict[str, str]],
    age_header: str,
    min_age_months: float | None = None,
    max_age_months: float | None = None,
) -> list[list[float]]:
    points: list[list[float]] = []
    for row in rows:
        actual_age_header = age_header if age_header in row else "Age"
        age_months = normalize_age(actual_age_header, float(row[actual_age_header]))
        if min_age_months is not None and age_months < min_age_months:
            continue
        if max_age_months is not None and age_months > max_age_months:
            continue

        point = [round(age_months, 3)]
        point.extend(round(float(row[column]), 3) for column in PERCENTILE_COLUMNS)
        points.append(point)
    return points


def merge_points(point_sets: list[list[list[float]]]) -> list[list[float]]:
    merged: list[list[float]] = []
    seen_ages: set[float] = set()
    for point_list in point_sets:
        for point in point_list:
            age_months = point[0]
            if age_months in seen_ages:
                continue
            seen_ages.add(age_months)
            merged.append(point)
    merged.sort(key=lambda item: item[0])
    return merged


def build_dataset(definition: dict[str, object]) -> dict[str, object]:
    parts = []
    urls: list[str] = []
    for part in definition["parts"]:
        urls.append(part["url"])
        rows = parse_xlsx_rows(fetch_binary(part["url"]))
        parts.append(
            build_points(
                rows,
                part["ageHeader"],
                part.get("minAgeMonths"),
                part.get("maxAgeMonths"),
            )
        )

    points = merge_points(parts)
    return {
        "typeId": definition["typeId"],
        "gender": definition["gender"],
        "source": definition["source"],
        "urls": urls,
        "coverage": {
            "startAgeMonths": points[0][0],
            "endAgeMonths": points[-1][0],
        },
        "points": points,
    }


def main() -> None:
    datasets: dict[str, object] = {}
    for dataset_key, definition in SOURCE_DEFINITIONS.items():
        print(f"Generating {dataset_key}...")
        datasets[dataset_key] = build_dataset(definition)

    payload = {
        "generatedAt": "2026-04-03",
        "percentiles": [3, 10, 25, 50, 75, 90, 97],
        "datasets": datasets,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
