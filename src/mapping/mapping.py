"""
=============================================================================
Step 05: Data Mapping & LCI Allocation (การแปลงข้อมูลและปันส่วนภาระต่อ 1 FU)
=============================================================================
หน้าที่หลัก:
1. อ่านตารางชั่วคราวเฉพาะแหล่งข้อมูลจาก data/staging/*_STAGED.csv
2. ดำเนินการปันส่วนพลังงานและการปรับฐาน (Energy Allocation & Normalization) สำหรับเดโมโดยใช้ข้อมูล PTTEP เป็นตัวแทน:
   - รวบรวมข้อมูลการผลิตปิโตรเลียมรวมรายปี (Activity Data) จาก DMF (SRC-044, SRC-045, SRC-046)
   - แปลงเป็นหน่วยพลังงานเทียบเท่าน้ำมันดิบ (BOE) เพื่อหาสัดส่วนการปันส่วนพลังงาน (allocation ratio)
   - ใช้ภาระและยอดผลิต BOE ของ PTTEP ในไทย (SRC-047) และใช้ DMF ประมาณสัดส่วนผลิตภัณฑ์
   - ปรับฐานให้เป็นค่าต่อ 1 Functional Unit (1 FU: amount = 1.00 สำหรับสายไหลอ้างอิง)
3. ปรับฐานข้อมูลกลางน้ำ EPPO (SRC-048, SRC-049, SRC-050) จากรายเดือนเป็นผลรวมรายปี (Annual Aggregation)
4. แมปเข้าสู่โครงสร้างกลาง Unified Mapped LCI Schema พร้อมหลักฐานการปันส่วน
   ลงใน data/mapping/*_MAPPED.csv
=============================================================================
"""

import calendar
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
import numpy as np
import pandas as pd

# กำหนด Console encoding สำหรับ Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent.parent
DATA_ROOT = Path(os.environ.get("CN230_DATA_DIR", PROJECT_ROOT / "data")).resolve()
STAGING_DIR = DATA_ROOT / "staging"
MAPPING_DIR = DATA_ROOT / "mapping"

BKK_TZ = timezone(timedelta(hours=7))

# โครงสร้างคอลัมน์กลางมาตรฐานเดียวกันทุกไฟล์ใน data/mapping/*_MAPPED.csv
MAPPED_COLUMNS = [
    "record_id",
    "year",
    "month",
    "month_num",
    "domain",
    "process_name",
    "location_name",
    "country",
    "flow_name",
    "flow_type",
    "compartment",
    "direction",
    "amount",
    "unit",
    "is_reference",
    "allocation",
    "_source_id",
    "_subtrack",
    "_extraction_batch_id",
    "_source_url",
    "_source_sha256",
    "_raw_file",
    "_staged_at",
    "_mapped_at",
    "_extraction_basis",
    "_source_page",
    "_report_scope",
    "_report_period",
    "_document_title",
    "_document_year",
    "_reported_value",
    "_reported_unit",
    "_conversion_multiplier",
    "_allocation_basis",
    "_allocation_share",
    "_allocation_pttep_boe",
    "_allocation_proxy_volume",
    "_allocation_input_batches",
    "_allocation_exclusion_reason",
    "_source_lineage",
]


def get_bkk_timestamp() -> str:
    return datetime.now(BKK_TZ).isoformat(timespec="seconds")


def get_mapped_output_path(staged_file: Path) -> Path:
    stem = staged_file.stem.replace("_STAGED", "").replace("_STG", "")
    return MAPPING_DIR / f"{stem}_MAPPED.csv"


_PRODUCT_FLOW_RULES = (
    (("CRUDE",), "Crude Oil"),
    (("NATURAL GAS",), "Natural Gas"),
    (("CONDENSATE",), "Condensate"),
    (("DIESEL",), "Diesel"),
    (("GASOLINE", "ULG", "GASOHOL"), "Gasoline"),
    (("JET",), "Jet Fuel"),
    (("FUEL OIL",), "Fuel Oil"),
    (("LPG",), "LPG"),
    (("KEROSENE",), "Kerosene"),
)

_REFINERY_SUST_INFO = {
    "SRC-051": ("BCP", "การกลั่นน้ำมันปิโตรเลียม (โรงกลั่นบางจาก พระโขนง)", "โรงกลั่นบางจาก พระโขนง (Bangchak Phra Khanong)"),
    "SRC-053": ("BSRC", "การกลั่นน้ำมันปิโตรเลียม (โรงกลั่นบางจาก ศรีราชา)", "โรงกลั่นบางจาก ศรีราชา (BSRC Sriracha)"),
    "SRC-054": ("IRPC", "การกลั่นน้ำมันและปิโตรเคมี (โรงกลั่นไออาร์พีซี ระยอง)", "โรงกลั่นไออาร์พีซี ระยอง (IRPC Rayong)"),
    "SRC-055": ("SPRC", "การกลั่นน้ำมันปิโตรเลียม (โรงกลั่นสตาร์ ปิโตรเลียม มาบตาพุด)", "โรงกลั่นสตาร์ ปิโตรเลียม มาบตาพุด (SPRC Map Ta Phut)"),
    "SRC-056": ("TOP", "การกลั่นน้ำมันปิโตรเลียม (โรงกลั่นไทยออยล์ ศรีราชา)", "โรงกลั่นไทยออยล์ ศรีราชา (Thaioil Sriracha)"),
    "SRC-057": ("PTTGC", "การกลั่นน้ำมันและโอเลฟินส์ (โรงกลั่นพีทีที โกลบอล เคมิคอล มาบตาพุด)", "โรงกลั่นพีทีที โกลบอล เคมิคอล มาบตาพุด (PTTGC Map Ta Phut)"),
}

_REFINERY_OP_INFO = {
    "SRC-058": ("BSRC", "โรงกลั่นบางจาก ศรีราชา (BSRC Sriracha)"),
    "SRC-059": ("IRPC", "โรงกลั่นไออาร์พีซี ระยอง (IRPC Rayong)"),
    "SRC-060": ("TOP", "โรงกลั่นไทยออยล์ ศรีราชา (Thaioil Sriracha)"),
    "SRC-061": ("BCP", "โรงกลั่นบางจาก พระโขนง (Bangchak Phra Khanong)"),
}

_UPSTREAM_FLOW_CONFIG = {
    "SRC-044": ("oil_bbl", "alloc_oil", "Crude Oil", "BBL", "การผลิตน้ำมันดิบ (Crude Oil Production)"),
    "SRC-045": ("gas_scf", "alloc_gas", "Natural Gas", "scf", "การผลิตก๊าซธรรมชาติ (Natural Gas Production)"),
    "SRC-046": ("cond_bbl", "alloc_cond", "Condensate", "BBL", "การผลิตคอนเดนเสท (Condensate Production)"),
}

_UPSTREAM_BURDEN_CONFIGS = (
    ("Total Direct GHG Emissions (Scope 1)", "elementary", "air", "OUT", "kgCO2e", 1000.0),
    ("Methane Emissions (Scope 1)", "elementary", "air", "OUT", "kg", 1000.0),
    ("Volatile Organic Compounds (VOCs)", "elementary", "air", "OUT", "kg", 1000.0),
    ("Nitrogen Oxides (NOx)", "elementary", "air", "OUT", "kg", 1000.0),
    ("Sulfur Oxides (SOx)", "elementary", "air", "OUT", "kg", 1000.0),
    ("Direct Energy Consumption", "product", "technosphere", "IN", "MJ", 1000.0),
)


def _standardize_product_flow(p) -> str:
    """แปลงชื่อผลิตภัณฑ์ปิโตรเลียมให้ตรงกับมาตรฐานตาราง FLOW"""
    if pd.isna(p):
        return "Petroleum Product"
    p_str = str(p).upper().strip()
    for keywords, std_name in _PRODUCT_FLOW_RULES:
        if any(kw in p_str for kw in keywords):
            return std_name
    return p_str.title()


def _get_days_in_month(year: int, month_num: int) -> int:
    try:
        y = int(float(year))
        m = int(float(month_num))
        return calendar.monthrange(y, m)[1]
    except Exception:
        return 30


UPSTREAM_PRODUCTION_SOURCES = frozenset(_UPSTREAM_FLOW_CONFIG)
UPSTREAM_ALLOCATION_SOURCES = UPSTREAM_PRODUCTION_SOURCES | {"SRC-047"}
UPSTREAM_ALLOCATION_BASIS = "UPSTREAM_ENERGY_ALLOCATION_V1"
UPSTREAM_BURDEN_FLOWS = frozenset(metric[0] for metric in _UPSTREAM_BURDEN_CONFIGS)
_PTTEP_UNITS = {
    "Hydrocarbon Production": "BOE",
    "Total Direct GHG Emissions (Scope 1)": "Tonne CO2e",
    "Methane Emissions (Scope 1)": "Metric Tonne",
    "Volatile Organic Compounds (VOCs)": "Tonne VOC",
    "Nitrogen Oxides (NOx)": "Tonne NO2",
    "Sulfur Oxides (SOx)": "Tonne SO2",
    "Direct Energy Consumption": "GJ",
}


class AllocationBlocked(ValueError):
    """Required inputs to the upstream demo calculation are unavailable."""


def _compute_upstream_balances() -> tuple[dict, list[str]]:
    """Match PTTEP's measured intensity with DMF's estimated product mix."""
    paths = {sid: sorted(STAGING_DIR.glob(f"{sid}_*_STAGED.csv")) for sid in sorted(UPSTREAM_ALLOCATION_SOURCES)}
    missing = [sid for sid, files in paths.items() if not files]
    ambiguous = [sid for sid, files in paths.items() if len(files) > 1]
    issues = []
    if missing:
        issues.append(f"ยังไม่มี Staging ของ {', '.join(missing)}")
    if ambiguous:
        issues.append(f"พบ Staging มากกว่าหนึ่งฉบับของ {', '.join(ambiguous)}")
    if issues:
        raise AllocationBlocked(" / ".join(issues))

    frames = {sid: pd.read_csv(files[0], low_memory=False) for sid, files in paths.items()}
    input_batches = {}
    for sid, frame in frames.items():
        batches = frame.get("_extraction_batch_id")
        if (
            batches is None or frame.empty or batches.isna().any() or batches.nunique() != 1
            or not str(batches.iloc[0]).strip() or str(batches.iloc[0]).startswith("BATCH-UNKNOWN")
        ):
            raise AllocationBlocked(f"{sid}: ข้อมูล Staging ว่าง หรือไม่สามารถระบุรอบการสกัดได้")
        input_batches[sid] = str(batches.iloc[0])

    pttep = frames["SRC-047"]
    if "_extraction_basis" not in pttep or not pttep["_extraction_basis"].eq("pdf_table").all():
        raise AllocationBlocked("กรุณารัน SRC-047 ใหม่เพื่ออ่านตารางจาก PDF จริง")
    pttep = pttep.loc[pttep["territory"].eq("Thailand")].copy()
    pttep = pttep.loc[pttep.apply(lambda row: _PTTEP_UNITS.get(row["indicator"]) == row["unit"], axis=1)]

    production = {}
    complete_months = set(range(1, 13))
    production_fields = {
        "SRC-044": ("oil_bbl_day", "oil_bbl_day", 1),
        "SRC-045": ("gas_mmscf_day", "gas_equi_oil_bbl_day", 1_000_000),
        "SRC-046": ("condensate_bbl_day", "condensate_equi_oil_bbl_day", 1),
    }
    for sid, (volume_col, boe_col, factor) in production_fields.items():
        frame = frames[sid]
        values = frame[[volume_col, boe_col, "days_of_produce"]].apply(pd.to_numeric, errors="coerce")
        if not np.isfinite(values.to_numpy()).all() or (values < 0).any().any():
            raise AllocationBlocked(f"{sid}: พบยอดผลิตหรือจำนวนวันที่ไม่ถูกต้องใน Staging")
        frame["native_volume"] = pd.to_numeric(frame[volume_col]) * frame["days_of_produce"] * factor
        frame["boe"] = pd.to_numeric(frame[boe_col]) * frame["days_of_produce"]
        production[sid] = {
            int(year): (float(group["native_volume"].sum()), float(group["boe"].sum()))
            for year, group in frame.groupby("year")
            if set(group["month_num"]) == complete_months
        }

    balances = {}
    excluded = []
    all_years = sorted(set(pttep["year"]).union(*(set(frame["year"]) for frame in frames.values())))
    for year in all_years:
        report = pttep.loc[pttep["year"].eq(year)]
        if report.empty:
            excluded.append(f"{year}: ไม่มีข้อมูล PTTEP ของไทย")
            continue
        indicators = report["indicator"]
        if indicators.duplicated().any() or set(indicators) != set(_PTTEP_UNITS):
            excluded.append(f"{year}: ตัวชี้วัด PTTEP ขาด ซ้ำ หรือหน่วยไม่ตรง")
            continue
        metrics = dict(zip(indicators, pd.to_numeric(report["value"], errors="coerce")))
        pttep_boe = metrics["Hydrocarbon Production"]
        if pttep_boe <= 0 or any(not np.isfinite(v) or v < 0 for v in metrics.values()):
            excluded.append(f"{year}: ค่าภาระหรือยอดผลิต PTTEP ไม่ถูกต้อง")
            continue
        missing_production = [sid for sid, annual in production.items()
                              if year not in annual or min(annual[year]) <= 0]
        if missing_production:
            excluded.append(f"{year}: ยอดผลิตรายปีไม่ครบหรือเป็นศูนย์ ({', '.join(missing_production)})")
            continue
        total_dmf_boe = sum(annual[year][1] for annual in production.values())
        products = {}
        for sid, annual in production.items():
            native_volume, dmf_boe = annual[year]
            share = dmf_boe / total_dmf_boe
            # PTTEP total is measured; the shares and conversion to product units are estimated from DMF.
            proxy_volume = pttep_boe * share * native_volume / dmf_boe
            products[sid] = (share, proxy_volume)
        del metrics["Hydrocarbon Production"]
        balances[int(year)] = (pttep_boe, products, metrics, input_batches)

    if not balances:
        details = "; ".join(excluded[-5:])
        raise AllocationBlocked(f"ไม่มีปีที่มีข้อมูล PTTEP และยอดผลิต DMF ครบสำหรับคำนวณ{': ' + details if details else ''}")
    return balances, excluded


def _build_mapped_row(
    record_id: int,
    year: int,
    domain: str,
    process_name: str,
    location_name: str,
    flow_name: str,
    flow_type: str,
    compartment: str,
    direction: str,
    amount: float,
    unit: str,
    prov_dict: dict,
    is_reference: bool = False,
    allocation: float = 1.00,
) -> dict:
    """สร้างแถวมาตรฐาน Unified Mapped LCI Schema (24 คอลัมน์)"""
    return {
        "record_id": record_id,
        "year": year,
        "month": "Annual",
        "month_num": np.nan,
        "domain": domain,
        "process_name": process_name,
        "location_name": location_name,
        "country": "Thailand",
        "flow_name": flow_name,
        "flow_type": flow_type,
        "compartment": compartment,
        "direction": direction,
        "amount": amount,
        "unit": unit,
        "is_reference": is_reference,
        "allocation": allocation,
        **prov_dict,
    }


def _format_year_ranges(years: list[str]) -> str:
    """Group consecutive integer years into compact ranges (e.g. 2003-2021, 2026)."""
    numeric = sorted({int(y) for y in years if str(y).isdigit()})
    if not numeric:
        return ", ".join(years)
    ranges = []
    start = end = numeric[0]
    for y in numeric[1:]:
        if y == end + 1:
            end = y
        else:
            ranges.append(f"{start}" if start == end else f"{start}-{end}")
            start = end = y
    ranges.append(f"{start}" if start == end else f"{start}-{end}")
    return ", ".join(ranges)


def _format_excluded_notices(excluded: list[str]) -> list[str]:
    """Summarize allocation candidates that will be checked by Step 06."""
    grouped: dict[str, list[str]] = {}
    for entry in excluded:
        year_part, sep, reason_part = entry.partition(":")
        reason = reason_part.strip() if sep else "ข้อมูลไม่ครบ"
        grouped.setdefault(reason, []).append(year_part.strip())
    lines = []
    for reason, years in grouped.items():
        lines.append(f"ส่ง {len(years)} ปี ({_format_year_ranges(years)}) ไป Validation เพื่อตรวจ allocation: {reason}")
    return lines


def _map_upstream_sources(source_id: str, df_staged: pd.DataFrame, prov_dict: dict) -> list[dict]:
    """แมปข้อมูลต้นน้ำ DMF พร้อมส่งปีที่จัดสรรไม่ได้ให้ Step 06 ตรวจและกักกัน"""
    balances, excluded = _compute_upstream_balances()
    _, _, flow_name, flow_unit, proc_name = _UPSTREAM_FLOW_CONFIG[source_id]
    loc_name = "ประเทศไทย (Thailand)"
    rows = []
    for summary in _format_excluded_notices(excluded):
        print(f"  {'[NOTICE]':<14}{source_id} {summary}")
    print(f"  {'[ALLOCATION]':<14}{source_id}: ค่าประมาณสำหรับเดโม ใช้ข้อมูล PTTEP เป็นตัวแทน")
    for year, (pttep_boe, products, burdens, input_batches) in balances.items():
        share, proxy_volume = products[source_id]
        provenance = {
            **prov_dict,
            "_allocation_basis": UPSTREAM_ALLOCATION_BASIS,
            "_allocation_share": share,
            "_allocation_pttep_boe": pttep_boe,
            "_allocation_proxy_volume": proxy_volume,
            "_allocation_input_batches": json.dumps(input_batches, sort_keys=True),
        }
        process = proc_name
        rows.append(_build_mapped_row(
            len(rows) + 1, year, "Upstream - E&P", process, loc_name,
            flow_name, "product", "technosphere", "OUT", 1.0, flow_unit,
            provenance, is_reference=True,
        ))
        for indicator, flow_type, compartment, direction, unit, multiplier in _UPSTREAM_BURDEN_CONFIGS:
            amount = burdens[indicator] * multiplier * share / proxy_volume
            rows.append(_build_mapped_row(
                len(rows) + 1, year, "Upstream - E&P", process, loc_name,
                indicator, flow_type, compartment, direction, amount, unit, provenance,
            ))

    # Preserve each year's observed production total as a candidate so Step 06,
    # rather than mapping, records the allocation failure in REJECTED_RECORD.
    volume_columns = {
        "SRC-044": ("oil_bbl_day", 1.0),
        "SRC-045": ("gas_mmscf_day", 1_000_000.0),
        "SRC-046": ("condensate_bbl_day", 1.0),
    }
    volume_column, unit_factor = volume_columns[source_id]
    for entry in excluded:
        year_text, _, reason = entry.partition(":")
        year = int(year_text.strip())
        year_rows = df_staged.loc[pd.to_numeric(df_staged["year"], errors="coerce").eq(year)]
        daily = pd.to_numeric(year_rows[volume_column], errors="coerce")
        days = pd.to_numeric(year_rows["days_of_produce"], errors="coerce")
        observed_volume = float((daily * days * unit_factor).sum())
        provenance = {
            **prov_dict,
            "_allocation_exclusion_reason": reason.strip() or "ข้อมูลปันส่วนไม่ครบ",
        }
        rows.append(_build_mapped_row(
            len(rows) + 1, year, "Upstream - E&P", proc_name,
            loc_name, flow_name, "product", "technosphere", "OUT", observed_volume, flow_unit,
            provenance, is_reference=True,
        ))

    return rows


def _map_pttep_source(df_staged: pd.DataFrame, prov_dict: dict) -> list[dict]:
    """แมปข้อมูลภาพรวมการดำเนินงานด้านสิ่งแวดล้อมระดับประเทศของ PTTEP (SRC-047)"""
    rows = []
    rec_counter = 1
    for _, r in df_staged.iterrows():
        ind = str(r["indicator"]).strip()
        val = float(r["value"])
        u = str(r["unit"]).strip()
        y = int(float(r["year"]))

        # กรอง Hydrocarbon Production ให้เหลือเฉพาะหน่วย BOE เพื่อไม่ให้มีแถวผลิตภัณฑ์ซ้ำ 2 แถวต่อปี
        if "Hydrocarbon Production" in ind and u != "BOE":
            continue

        if "Hydrocarbon Production" in ind:
            f_type, comp, direction = "product", "technosphere", "OUT"
        elif "Direct Energy Consumption" in ind:
            f_type, comp, direction = "product", "technosphere", "IN"
        else:
            f_type, comp, direction = "elementary", "air", "OUT"

        if pd.isna(val):
            continue
        rows.append(_build_mapped_row(
            rec_counter, y, "Upstream - E&P",
            "การสำรวจและผลิตปิโตรเลียม (PTTEP Upstream E&P)",
            "ประเทศไทย (Thailand)",
            ind, f_type, comp, direction, round(val, 2), u,
            {**prov_dict, "_source_page": r.get("_source_page")},
        ))
        rec_counter += 1
    return rows


def _map_eppo_refined_production(df_staged: pd.DataFrame, prov_dict: dict) -> list[dict]:
    """แมปผลรวมการผลิตน้ำมันสำเร็จรูปรายปีของโรงกลั่นในประเทศ (SRC-048)"""
    df = df_staged.copy()
    df["quantity"] = pd.to_numeric(df["quantity"], errors="coerce")
    df["product_std"] = df["product"].apply(_standardize_product_flow)

    agg_df = df.groupby(["year", "product_std"])["quantity"].sum().reset_index()
    year_totals = agg_df.groupby("year")["quantity"].sum().to_dict()

    rows = []
    for rec_counter, (_, r) in enumerate(agg_df.iterrows(), start=1):
        y = int(float(r["year"]))
        qty = round(float(r["quantity"]), 3)
        tot_qty = year_totals.get(r["year"], 0.0)
        alloc_ratio = round(qty / tot_qty, 8) if tot_qty > 0 else 0.0
        rows.append(_build_mapped_row(
            rec_counter, y, "Midstream - Refinery",
            "การกลั่นน้ำมันปิโตรเลียม (Refining Process)",
            "โรงกลั่นน้ำมันในประเทศ (Refineries in Thailand)",
            r["product_std"], "product", "technosphere", "OUT", qty, "Million Litres",
            prov_dict, is_reference=False, allocation=alloc_ratio,
        ))
    return rows


def _map_eppo_refinery_intake(df_staged: pd.DataFrame, prov_dict: dict) -> list[dict]:
    """แมปผลรวมการใช้น้ำมันดิบเข้ากลั่นรายปีแยกตามโรงกลั่น (SRC-049)"""
    df = df_staged.copy()
    df["quantity"] = pd.to_numeric(df["quantity"], errors="coerce")
    df["days"] = df.apply(lambda r: _get_days_in_month(r["year"], r["month_num"]), axis=1)
    df["bbl_month"] = df["quantity"] * df["days"]

    agg_df = df.groupby(["year", "company"])["bbl_month"].sum().reset_index()
    rows = []
    for rec_counter, (_, r) in enumerate(agg_df.iterrows(), start=1):
        comp_name = str(r["company"]).strip()
        rows.append(_build_mapped_row(
            rec_counter, int(float(r["year"])), "Midstream - Refinery",
            f"การนำเข้าน้ำมันดิบเข้ากลั่น (โรงกลั่น {comp_name})",
            f"โรงกลั่น {comp_name} (Refinery)",
            "Crude Oil", "product", "technosphere", "IN", round(float(r["bbl_month"]), 2), "BBL",
            prov_dict,
        ))
    return rows


def _map_eppo_gsp_gas(df_staged: pd.DataFrame, prov_dict: dict) -> list[dict]:
    """แมปผลรวมการใช้ก๊าซธรรมชาติป้อนเข้าโรงแยกก๊าซ GSP รายปี (SRC-050)"""
    df = df_staged.copy()
    df["quantity"] = pd.to_numeric(df["quantity"], errors="coerce")
    df["days"] = df.apply(lambda r: _get_days_in_month(r["year"], r["month_num"]), axis=1)
    df["scf_month"] = df["quantity"] * df["days"] * 1e6

    agg_df = df.groupby("year")["scf_month"].sum().reset_index()
    rows = []
    for rec_counter, (_, r) in enumerate(agg_df.iterrows(), start=1):
        rows.append(_build_mapped_row(
            rec_counter, int(float(r["year"])), "Midstream - GSP",
            "การแยกก๊าซธรรมชาติ (Gas Separation Plant - GSP)",
            "ภาคส่วน GSP (Sector GSP)",
            "Natural Gas", "product", "technosphere", "IN", round(float(r["scf_month"]), 2), "scf",
            prov_dict,
        ))
    return rows


def _report_evidence(row: pd.Series, provenance: dict) -> dict:
    fields = (
        "_source_page", "_report_scope", "_report_period", "_document_title", "_document_year",
        "_reported_value", "_reported_unit", "_conversion_multiplier",
    )
    return {**provenance, **{field: row.get(field) for field in fields}}


def _map_refinery_sustainability(df_staged: pd.DataFrame, source_id: str, prov_dict: dict) -> list[dict]:
    """Preserve the publisher's scope when mapping reported energy and emissions."""
    _, default_process, default_location = _REFINERY_SUST_INFO[source_id]
    rows = []
    for _, row in df_staged.iterrows():
        indicator = str(row["indicator"]).strip()
        scope = row.get("_report_scope")
        process = f"Environmental performance ({scope})" if pd.notna(scope) else default_process
        location = str(scope) if pd.notna(scope) else default_location
        is_energy = "Energy Consumption" in indicator
        flow_type, compartment, direction = (
            ("product", "technosphere", "IN") if is_energy else ("elementary", "air", "OUT")
        )
        rows.append(_build_mapped_row(
            len(rows) + 1, int(row["year"]), "Midstream - Refinery", process, location,
            indicator, flow_type, compartment, direction, float(row["value"]), str(row["unit"]).strip(),
            _report_evidence(row, prov_dict),
        ))
    return rows


def _map_refinery_mda(df_staged: pd.DataFrame, source_id: str, prov_dict: dict) -> list[dict]:
    """Keep quarterly and annual operations distinct in the published schema."""
    company, default_location = _REFINERY_OP_INFO[source_id]
    rows = []
    for _, row in df_staged.iterrows():
        indicator = str(row["indicator"]).strip()
        value = float(row["value"])
        unit = str(row["unit"]).strip()
        period = row.get("_report_period")
        scope = row.get("_report_scope")
        location = str(scope) if pd.notna(scope) else default_location
        process = f"Refinery operations ({location if pd.notna(scope) else company})"
        if pd.notna(period) and period != "Annual":
            process += f" [{period}]"
        exchange = _build_mapped_row(
            len(rows) + 1, int(row["year"]), "Midstream - Refinery", process, location,
            indicator, "product", "technosphere", "IN" if "Intake Throughput" in indicator else "OUT",
            value, unit, _report_evidence(row, prov_dict),
            allocation=round(value / 100.0, 8) if unit == "%" else 1.0,
        )
        if pd.notna(period):
            exchange["month"] = period
        rows.append(exchange)
    return rows


def _map_dmf_guidelines(df_staged: pd.DataFrame, prov_dict: dict) -> list[dict]:
    """Publish regulatory reference factors with explicit source metadata."""
    rows = []
    for _, row in df_staged.iterrows():
        unit = str(row["unit"]).strip()
        if "%" in unit and "Destroyed" in unit:
            unit = "% Destroyed"
        elif "throughput" in unit:
            unit = "kgCH4/m3 throughput"
        exchange = _build_mapped_row(
            len(rows) + 1, int(row["year"]), "Regulatory Framework",
            "เกณฑ์การคำนวณการปล่อยก๊าซเรือนกระจก (DMF GHG Guidelines)", "ประเทศไทย (Thailand)",
            str(row["indicator"]).strip(), "product", "technosphere", "OUT",
            float(row["factor_value"]), unit, _report_evidence(row, prov_dict),
        )
        exchange["month"] = "Reference"
        rows.append(exchange)
    return rows


def _source_lineage_for_tuple(row: dict, df_staged: pd.DataFrame, source_id: str) -> list[dict]:
    """Return source rows that contributed to one mapped tuple, for query-time traceback."""
    year = pd.to_numeric(df_staged.get("year"), errors="coerce")
    candidates = df_staged.loc[year.eq(pd.to_numeric(pd.Series([row.get("year")]), errors="coerce").iloc[0])].copy()
    if source_id == "SRC-048" and "product" in candidates:
        candidates = candidates.loc[candidates["product"].apply(_standardize_product_flow).eq(row.get("flow_name"))]
    elif source_id == "SRC-049" and "company" in candidates:
        candidates = candidates.loc[candidates["company"].astype(str).apply(lambda company: company in str(row.get("process_name", "")))]
    elif source_id in {"SRC-047", "SRC-051", "SRC-053", "SRC-054", "SRC-055", "SRC-056", "SRC-057", "SRC-058", "SRC-059", "SRC-060", "SRC-061", "SRC-052"} and "indicator" in candidates:
        candidates = candidates.loc[candidates["indicator"].astype(str).eq(str(row.get("flow_name", "")))]
        # Sustainability/MDA reports may publish the same indicator for several
        # scopes or periods in one year. Keep the source rows for this exact tuple.
        if source_id in {"SRC-051", "SRC-053", "SRC-054", "SRC-055", "SRC-056", "SRC-057", "SRC-058", "SRC-059", "SRC-060", "SRC-061"} and "_report_scope" in candidates:
            mapped_scope = str(row.get("location_name", ""))
            scoped = candidates["_report_scope"].astype(str).eq(mapped_scope)
            if scoped.any():
                candidates = candidates.loc[scoped]
        if source_id in {"SRC-058", "SRC-059", "SRC-060", "SRC-061"} and "_report_period" in candidates:
            mapped_period = str(row.get("month", "Annual"))
            period_match = candidates["_report_period"].astype(str).eq(mapped_period)
            if period_match.any():
                candidates = candidates.loc[period_match]
        # These mappings pass through a single reported value (apart from unit
        # display normalization). Use it to distinguish repeated indicators.
        value_column = "factor_value" if source_id == "SRC-052" else "value"
        if value_column in candidates:
            source_values = pd.to_numeric(candidates[value_column], errors="coerce")
            mapped_value = pd.to_numeric(pd.Series([row.get("amount")]), errors="coerce").iloc[0]
            value_match = np.isclose(source_values, mapped_value, rtol=1e-7, atol=0.005, equal_nan=False)
            if value_match.any():
                candidates = candidates.loc[value_match]
    elif source_id in _UPSTREAM_FLOW_CONFIG:
        # Keep the monthly activity rows used for this year's production mix,
        # while restricting PTTEP evidence to the exact value used by this tuple.
        mapped_year = int(row["year"])
        inputs = []
        for upstream_id in sorted(UPSTREAM_PRODUCTION_SOURCES):
            if upstream_id == source_id:
                upstream = df_staged
            else:
                paths = sorted(STAGING_DIR.glob(f"{upstream_id}_*_STAGED.csv"))
                if len(paths) != 1:
                    continue
                upstream = pd.read_csv(paths[0], low_memory=False)
            year_rows = upstream.loc[pd.to_numeric(upstream["year"], errors="coerce").eq(mapped_year)]
            if not year_rows.empty:
                inputs.append((upstream_id, year_rows))

        pttep_paths = sorted(STAGING_DIR.glob("SRC-047_*_STAGED.csv"))
        if len(pttep_paths) == 1:
            pttep = pd.read_csv(pttep_paths[0], low_memory=False)
            pttep = pttep.loc[pd.to_numeric(pttep["year"], errors="coerce").eq(mapped_year)]
            if "territory" in pttep:
                pttep = pttep.loc[pttep["territory"].astype(str).eq("Thailand")]
            if "indicator" in pttep:
                indicators = {"Hydrocarbon Production"}
                if row.get("flow_name") in UPSTREAM_BURDEN_FLOWS:
                    indicators.add(str(row["flow_name"]))
                pttep = pttep.loc[pttep["indicator"].astype(str).isin(indicators)]
            inputs.append(("SRC-047", pttep))
        candidates = pd.concat([
            frame.assign(__lineage_source_id=upstream_id)
            for upstream_id, frame in inputs if not frame.empty
        ], ignore_index=True) if any(not frame.empty for _, frame in inputs) else pd.DataFrame()

    lineage = []
    for record in candidates.to_dict("records"):
        lineage.append({
            "source_id": str(record.get("__lineage_source_id", source_id)),
            "source_record_id": str(record.get("record_id", "")),
        })
    return lineage


def map_staged_dataframe(df_staged: pd.DataFrame, source_id: str) -> pd.DataFrame:
    """
    แปลง DataFrame จาก Staging เข้าสู่โครงสร้างกลางของโครงการ:
    - น้ำมันดิบ (SRC-044), ก๊าซธรรมชาติ (SRC-045), คอนเดนเสท (SRC-046):
      รวมยอดรายปี ปันส่วนพลังงาน และปรับฐานเป็น 1 FU (amount = 1.00 สำหรับสินค้าหลัก)
    - กลางน้ำ (SRC-048, SRC-049, SRC-050): รวมยอดรายเดือนเป็นผลรวมรายปี (Annual Sum)
    """
    timestamp_bkk = get_bkk_timestamp()

    # ดึงค่า Provenance พื้นฐานจากแถวแรกของ Staging
    sample_row = df_staged.iloc[0]
    prov_dict = {
        "_source_id": source_id,
        "_subtrack": sample_row.get("_subtrack", ""),
        "_extraction_batch_id": sample_row.get("_extraction_batch_id", ""),
        "_source_url": sample_row.get("_source_url", ""),
        "_source_sha256": sample_row.get("_source_sha256", ""),
        "_raw_file": sample_row.get("_raw_file", ""),
        "_staged_at": sample_row.get("_staged_at", ""),
        "_mapped_at": timestamp_bkk,
        "_extraction_basis": sample_row.get("_extraction_basis"),
    }

    if source_id in _UPSTREAM_FLOW_CONFIG:
        mapped_rows = _map_upstream_sources(source_id, df_staged, prov_dict)
    elif source_id == "SRC-047":
        mapped_rows = _map_pttep_source(df_staged, prov_dict)
    elif source_id == "SRC-048":
        mapped_rows = _map_eppo_refined_production(df_staged, prov_dict)
    elif source_id == "SRC-049":
        mapped_rows = _map_eppo_refinery_intake(df_staged, prov_dict)
    elif source_id == "SRC-050":
        mapped_rows = _map_eppo_gsp_gas(df_staged, prov_dict)
    elif source_id in _REFINERY_SUST_INFO:
        mapped_rows = _map_refinery_sustainability(df_staged, source_id, prov_dict)
    elif source_id in _REFINERY_OP_INFO:
        mapped_rows = _map_refinery_mda(df_staged, source_id, prov_dict)
    elif source_id == "SRC-052":
        mapped_rows = _map_dmf_guidelines(df_staged, prov_dict)
    else:
        raise ValueError(f"ไม่พบกฎการแมปข้อมูล (Mapping) สำหรับแหล่งข้อมูล: {source_id}")

    for mapped_row in mapped_rows:
        mapped_row["_source_lineage"] = json.dumps(
            _source_lineage_for_tuple(mapped_row, df_staged, source_id),
            ensure_ascii=False,
            sort_keys=True,
        )

    res_df = pd.DataFrame(mapped_rows)
    for col in MAPPED_COLUMNS:
        if col not in res_df.columns:
            res_df[col] = np.nan

    return res_df[MAPPED_COLUMNS].copy()


def map_data(source_id: str = "SRC-044", *, staged_files: list[Path] | None = None) -> list[Path]:
    """
    ฟังก์ชันหลักสำหรับรัน Step 05: Data Mapping & LCI Allocation
    """
    MAPPING_DIR.mkdir(parents=True, exist_ok=True)

    if staged_files is None:
        staged_files = sorted(STAGING_DIR.glob(f"{source_id}_*_STAGED.csv"))
    if not staged_files:
        raise FileNotFoundError(
            f"ไม่พบไฟล์ Staging สำหรับ '{source_id}' ใน data/staging/\n"
            f"            - คำแนะนำ     : กรุณารัน Step 04 (Data Staging) สำหรับ {source_id} ก่อน"
        )

    mapped_paths = []
    for staged_file in staged_files:
        df_staged = pd.read_csv(staged_file, low_memory=False, dtype={"_reported_value": str})
        df_mapped = map_staged_dataframe(df_staged, source_id)

        if df_mapped.empty:
            raise ValueError(f"{source_id}: Mapping ไม่ได้ผลลัพธ์สำหรับ {staged_file.name}")
        out_path = get_mapped_output_path(staged_file)
        temp_path = out_path.with_suffix(".csv.tmp")
        try:
            df_mapped.to_csv(temp_path, index=False, encoding="utf-8-sig")
            for attempt in range(10):
                try:
                    temp_path.replace(out_path)
                    break
                except PermissionError:
                    if attempt == 9:
                        raise
                    time.sleep(0.5)
        finally:
            temp_path.unlink(missing_ok=True)
        mapped_paths.append(out_path)

        unique_procs = df_mapped[["process_name", "year", "location_name"]].drop_duplicates().shape[0]
        ref_count = int(df_mapped["is_reference"].sum())
        flows = ", ".join(sorted(df_mapped["flow_name"].dropna().unique().tolist()))

        print(
            f"  {'[MAPPING]':<14}แปลง {staged_file.name} -> {out_path.name}"
        )
        print(
            f"  {'[SCHEMA]':<14}Unified Mapped Schema ({len(df_mapped):,} แถว, {len(df_mapped.columns)} คอลัมน์ | "
            f"Processes: {unique_procs:,} | Ref Flows: {ref_count:,} | Flows: {flows})"
        )

    return mapped_paths


def map_all_staged():
    """รัน Step 05 Data Mapping สำหรับทุกชุดข้อมูลใน data/staging/"""
    staged_files = sorted(STAGING_DIR.glob("*_STAGED.csv"))
    if not staged_files:
        print("[STEP 05] ไม่พบไฟล์ใน data/staging/ กรุณารัน Step 04 ก่อน")
        return
    source_ids = sorted(list({f.name.split("_")[0] for f in staged_files if f.name.startswith("SRC-")}))
    for sid in source_ids:
        map_data(sid)


# Alias เพื่อความเข้ากันได้ย้อนหลัง
map_to_canonical = map_data
mapping_data = map_data


if __name__ == "__main__":
    args = sys.argv[1:]
    clean_args = [a for a in args if not a.startswith("--")]
    if not clean_args or "--all" in args:
        map_all_staged()
    else:
        for sid in clean_args:
            map_data(sid)
