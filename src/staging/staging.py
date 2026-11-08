"""
=============================================================================
Step 04: Data Staging (ตารางชั่วคราวเฉพาะแหล่งข้อมูล + Provenance Metadata)
=============================================================================
สถาปัตยกรรมย่อยภายในชั้น Staging (Source-Specific Data Staging Architecture):
1. Data Extraction     : ดึงตารางดิบจาก data/parsed/*_PARSED_RAW.csv และประวัติจาก _provenance_ledger.jsonl
2. Data Profiling      : วิเคราะห์โครงสร้างข้อมูล ตรวจนับค่าว่าง (Missing Values) คอลัมน์ว่าง 100% แถวชำรุด และแถวซ้ำ
3. Data Cleansing      : ลบช่องว่างซ้ำ แปลงสัญลักษณ์ค่าว่าง ลบแถวชำรุด/แถวซ้ำ เติมค่าหมวดหมู่ที่ขาดหาย และลบลูกน้ำตัวเลขอย่างปลอดภัย
4. Data Normalization  : ปรับชื่อคอลัมน์เฉพาะของแหล่งข้อมูลสู่ชื่อมาตรฐาน (_raw คู่กับค่าที่แปลงแล้ว) แปลงปี พ.ศ. -> ค.ศ. และจัดมาตรฐานเดือน/หน่วยวัด
5. Scope Filtering     : คัดกรองเฉพาะขอบเขตโครงงาน (เช่น SRC-047 ตัดอัตราส่วนความเข้มข้น Intensity, SRC-050 คัดเฉพาะภาคส่วน GSP)
6. Provenance Binding  : ผสานฟิลด์ Provenance (_source_id, _subtrack, _extraction_batch_id, _source_url, _source_sha256, _raw_file, _staged_at)
7. Data Loading        : บันทึกตารางชั่วคราวเฉพาะแหล่งข้อมูลลงใน data/staging/*_STAGED.csv
=============================================================================
"""

import json
import os
import re
import sys
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
PARSED_DIR = PROJECT_ROOT / "data" / "parsed"
STAGING_DIR = PROJECT_ROOT / "data" / "staging"
RAW_DIR = PROJECT_ROOT / "data" / "raw"

# โซนเวลาประเทศไทย (+07:00)
BKK_TZ = timezone(timedelta(hours=7))


def get_bkk_timestamp() -> str:
    """คืนค่าเวลาปัจจุบันในรูปแบบ ISO 8601 ประเทศไทย"""
    return datetime.now(BKK_TZ).isoformat(timespec="seconds")


def get_staged_output_path(parsed_file: Path) -> Path:
    """
    สร้างชื่อไฟล์ปลายทางใน data/staging โดยใช้ชื่อเดียวกับไฟล์ใน data/parsed
    แต่เปลี่ยนคำลงท้ายจาก _PARSED_RAW เป็น _STAGED.csv
    """
    stem = parsed_file.stem
    if stem.endswith("_PARSED_RAW"):
        new_stem = stem[:-11] + "_STAGED"
    elif stem.endswith("_PARSED"):
        new_stem = stem[:-7] + "_STAGED"
    else:
        new_stem = f"{stem}_STAGED"
    return STAGING_DIR / f"{new_stem}.csv"


def _read_parsed_csv_safe(file_path: Path) -> pd.DataFrame:
    """อ่านไฟล์ CSV จาก data/parsed/ พร้อมระบบสำรองชุดอักขระอัตโนมัติ"""
    encodings = ["utf-8-sig", "utf-8", "cp874", "tis-620"]
    last_err = None
    for enc in encodings:
        try:
            return pd.read_csv(file_path, dtype=str, encoding=enc)
        except Exception as e:
            last_err = e
            continue
    raise ValueError(
        f"ไม่สามารถอ่านไฟล์ตารางดิบ '{file_path.name}' ได้\n"
        f"            - สาเหตุล่าสุด : {type(last_err).__name__}: {last_err}\n"
        f"            - คำแนะนำ     : ตรวจสอบว่าไฟล์ไม่ชำรุด หรือลองรัน Step 03 (Data Parsing) ใหม่"
    )


# ตารางจับคู่ชื่อคอลัมน์ดิบ -> ชื่อคอลัมน์มาตรฐานเฉพาะของแต่ละแหล่งข้อมูล (Source-Specific Staging Schema)
COLUMN_MAPPING = {
    # ทั่วไป & EPPO (SRC-048, SRC-049, SRC-050)
    "_id": "record_id",
    "id": "record_id",
    "Year": "year",
    "YEAR": "year",
    "Month": "month",
    "MONTH": "month",
    "Product": "product",
    "PRODUCT": "product",
    "Company": "company",
    "COMPANY": "company",
    "Quantity": "quantity",
    "QUANTITY": "quantity",
    "UNIT": "unit",
    "Unit": "unit",
    "Sector": "sector",
    "SECTOR": "sector",

    # DMF Production (SRC-044, SRC-045, SRC-046)
    "BLOCK_TYPE": "block_type",
    "BLOCK": "block_name",
    "SOURCE_GROUP": "source_group",
    "OIL": "oil_bbl_day",
    "GAS": "gas_mmscf_day",
    "GAS_EQUI_OIL": "gas_equi_oil_bbl_day",
    "CONDENSATE": "condensate_bbl_day",
    "CONDENSATE_EQUI_OIL": "condensate_equi_oil_bbl_day",
    "DAYSOFPRODUCE": "days_of_produce",

    # PTTEP Sustainability (SRC-047)
    "indicator": "indicator",
    "unit": "unit",
    "year": "year",
    "territory": "territory",
    "value": "value",

    # TGO Carbon Footprint (สำรองกรณี SRC-043)
    "#": "record_id",
    "เลขที่ใบรับรอง": "certificate_no",
    "ชื่อ": "product_name",
    "รายละเอียด": "product_description",
    "อุตสาหกรรม": "industry_group",
    "วันที่อนุมัติ": "approve_date_raw",
    "ปริมาณ CF": "cf_volume_raw",
    "หน่วยการทำงาน": "functional_unit_raw",
    "ขอบเขต": "boundary",
}

# ลำดับคอลัมน์เฉพาะของแต่ละแหล่งข้อมูลในชั้น Staging (ยังไม่ปะปนคอลัมน์ Mapping ข้ามแหล่ง)
SOURCE_STAGING_COLUMNS = {
    "SRC-044": [
        "record_id", "year", "month", "month_num",
        "block_type", "block_name", "source_group",
        "oil_bbl_day", "days_of_produce",
        "year_raw", "month_raw",
    ],
    "SRC-045": [
        "record_id", "year", "month", "month_num",
        "block_type", "block_name", "source_group",
        "gas_mmscf_day", "gas_equi_oil_bbl_day", "days_of_produce",
        "year_raw", "month_raw",
    ],
    "SRC-046": [
        "record_id", "year", "month", "month_num",
        "block_type", "block_name", "source_group",
        "condensate_bbl_day", "condensate_equi_oil_bbl_day", "days_of_produce",
        "year_raw", "month_raw",
    ],
    "SRC-047": [
        "record_id", "year", "territory",
        "indicator", "value", "unit",
        "year_raw",
    ],
    "SRC-048": [
        "record_id", "year", "month", "month_num",
        "product", "quantity", "unit",
        "year_raw", "month_raw",
    ],
    "SRC-049": [
        "record_id", "year", "month", "month_num",
        "company", "quantity", "unit",
        "year_raw", "month_raw",
    ],
    "SRC-050": [
        "record_id", "year", "month", "month_num",
        "sector", "quantity", "unit",
        "year_raw", "month_raw",
    ],
}

# คอลัมน์บังคับขั้นต่ำของแต่ละแหล่งข้อมูลในชั้น Staging
REQUIRED_COLUMNS_BY_SOURCE = {
    "SRC-044": ["year", "month", "month_num", "block_type", "source_group", "oil_bbl_day"],
    "SRC-045": ["year", "month", "month_num", "block_type", "source_group", "gas_mmscf_day"],
    "SRC-046": ["year", "month", "month_num", "block_type", "source_group", "condensate_bbl_day"],
    "SRC-047": ["year", "territory", "indicator", "value", "unit"],
    "SRC-048": ["year", "month", "month_num", "product", "quantity", "unit"],
    "SRC-049": ["year", "month", "month_num", "company", "quantity", "unit"],
    "SRC-050": ["year", "month", "month_num", "sector", "quantity", "unit"],
}

# คอลัมน์หลักที่ใช้ตัดสินว่าแถวนั้นเป็นแถวข้อมูลที่สมบูรณ์ (หากว่างในกลุ่มนี้ถือเป็นแถวชำรุด)
CRITICAL_NON_NULL_BY_SOURCE = {
    "SRC-044": ["block_type", "source_group", "oil_bbl_day"],
    "SRC-045": ["block_type", "source_group", "gas_mmscf_day"],
    "SRC-046": ["block_type", "source_group", "condensate_bbl_day"],
    "SRC-047": ["year", "indicator", "value"],
    "SRC-048": ["year", "month", "product", "quantity"],
    "SRC-049": ["year", "month", "company", "quantity"],
    "SRC-050": ["year", "month", "sector", "quantity"],
}

TEXT_AND_IDENTIFIER_COLS = {
    "certificate_no",
    "product_name",
    "product_description",
    "industry_group",
    "approve_date_raw",
    "cf_volume_raw",
    "functional_unit_raw",
    "boundary",
    "product",
    "company",
    "unit",
    "block_type",
    "block_name",
    "source_group",
    "sector",
    "territory",
    "indicator",
}

THAI_MONTHS = {
    "มกราคม": "January", "ม.ค.": "January",
    "กุมภาพันธ์": "February", "ก.พ.": "February",
    "มีนาคม": "March", "มี.ค.": "March",
    "เมษายน": "April", "เม.ย.": "April",
    "พฤษภาคม": "May", "พ.ค.": "May",
    "มิถุนายน": "June", "มิ.ย.": "June",
    "กรกฎาคม": "July", "ก.ค.": "July",
    "สิงหาคม": "August", "ส.ค.": "August",
    "กันยายน": "September", "ก.ย.": "September",
    "ตุลาคม": "October", "ต.ค.": "October",
    "พฤศจิกายน": "November", "พ.ย.": "November",
    "ธันวาคม": "December", "ธ.ค.": "December",
}

ENGLISH_MONTH_TO_NUM = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
}

NUM_TO_ENGLISH_MONTH = {v: k.capitalize() for k, v in ENGLISH_MONTH_TO_NUM.items()}

FORMATTED_NUMBER_RE = re.compile(r"^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$")
PLAIN_NUMBER_RE = re.compile(r"^[-+]?\d+(?:\.\d+)?$")


def clean_text(value):
    """ทำความสะอาดข้อความ ยุบช่องว่างหลายตัวและแปลงสัญลักษณ์ค่าว่างเป็น np.nan"""
    if pd.isna(value):
        return np.nan
    text = re.sub(r"\s+", " ", str(value)).strip()
    if text in ["", "-", "–", "—", "N/A", "n/a", "NULL", "null", "None", "nan"]:
        return np.nan
    return text


def standardize_unit_symbol(u) -> str:
    """จัดมาตรฐานสัญลักษณ์หน่วยวัดให้ตรงกับตาราง UNIT"""
    if pd.isna(u):
        return "UNSPECIFIED"
    u_str = str(u).strip()
    u_up = u_str.upper()
    if u_up in ["BBL/DAY", "BPD", "BARRELS/DAY"]:
        return "BBL/DAY"
    if u_up in ["MMSCF/DAY", "MMSCFD", "MMSCF"]:
        return "MMSCF/DAY"
    if "MILLION LITRE" in u_up or u_up == "ML":
        return "Million Litres"
    if u_up in ["LITRE", "LITRES", "L"]:
        return "Litres"
    if u_up in ["KG", "KILOGRAM"]:
        return "kg"
    return u_str


def get_provenance_for_parsed_file(parsed_file: Path, source_id: str) -> dict:
    """ค้นหาข้อมูล Provenance จาก _provenance_ledger.jsonl ที่ตรงกับไฟล์ดิบต้นทาง"""
    ledger_path = RAW_DIR / "_provenance_ledger.jsonl"
    raw_prefix = parsed_file.stem.replace("_PARSED_RAW", "_RAW")
    default_meta = {
        "extraction_batch_id": f"BATCH-UNKNOWN-{source_id}",
        "source_url": "",
        "sha256_checksum": "",
        "raw_file_path": "",
    }
    if not ledger_path.exists():
        return default_meta

    try:
        with open(ledger_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        for line in reversed(lines):
            if not line.strip():
                continue
            meta = json.loads(line.strip())
            raw_name = os.path.basename(meta.get("raw_file_path", ""))
            if raw_name.startswith(raw_prefix):
                return meta
        for line in reversed(lines):
            if not line.strip():
                continue
            meta = json.loads(line.strip())
            if meta.get("source_id") == source_id:
                return meta
    except Exception:
        pass
    return default_meta


def _map_column_names(columns: list) -> tuple[list[str], list[str]]:
    """แมปชื่อคอลัมน์จากต้นทางสู่ชื่อคอลัมน์เฉพาะแหล่งข้อมูลในชั้น Staging"""
    new_cols = []
    col_changes = []
    for col in columns:
        col_str = str(col).strip()
        if col_str in COLUMN_MAPPING:
            target_col = COLUMN_MAPPING[col_str]
        else:
            clean_name = re.sub(r"[^\w\s-]", "", col_str)
            clean_name = re.sub(r"[\s-]+", "_", clean_name).lower()
            target_col = clean_name if clean_name else col_str

        new_cols.append(target_col)
        if target_col != col_str:
            col_changes.append(f"{col_str} -> {target_col}")
    return new_cols, col_changes


def _run_staging_pipeline_on_dataframe(
    df_raw: pd.DataFrame,
    source_id: str,
    subtrack_name: str,
    prov_meta: dict,
) -> tuple[pd.DataFrame, dict]:
    """
    ดำเนินการจัดเตรียมข้อมูลเฉพาะแหล่งในชั้น Staging (Step 04):
    - รักษาโครงสร้างคอลัมน์ของแต่ละแหล่งข้อมูลตามจริง (ไม่บังคับรวมเป็นโครงสร้างเดียวในชั้นนี้)
    - คลีนตัวเลข แปลงปี พ.ศ. -> ค.ศ. จัดมาตรฐานเดือน
    - คัดกรองเฉพาะขอบเขตโครงการ (Scope Filtering)
    - ผสาน Provenance Metadata ครบ 7 ฟิลด์
    """
    df = df_raw.copy()

    # 1. Data Profiling บนตารางดิบ
    initial_rows = len(df)
    initial_cols = len(df.columns)

    df_norm_null = df.apply(lambda col: col.map(clean_text))
    empty_cols_raw = [c for c in df_norm_null.columns if df_norm_null[c].isna().all()]
    null_counts_by_col = {
        c: int(df_norm_null[c].isna().sum())
        for c in df_norm_null.columns
        if df_norm_null[c].isna().sum() > 0 and c not in empty_cols_raw
    }
    total_null_cells = int(df_norm_null.isna().sum().sum())
    all_blank_rows_count = int(df_norm_null.isna().all(axis=1).sum())
    exact_duplicates_count = int(df_norm_null.duplicated(keep="first").sum())

    # 2. Data Cleansing & Column Normalization
    if empty_cols_raw:
        df.drop(columns=empty_cols_raw, inplace=True)

    mapped_cols, col_changes = _map_column_names(list(df.columns))
    df.columns = mapped_cols

    if "month" in df.columns:
        df["month_raw"] = df["month"].apply(clean_text)

    commas_removed = 0
    nan_converted = 0
    whitespace_collapsed = 0

    for col in list(df.columns):
        if col == "month_raw":
            continue
        is_text_col = col in TEXT_AND_IDENTIFIER_COLS

        def cleanse_cell(val):
            nonlocal commas_removed, nan_converted, whitespace_collapsed
            if pd.isna(val):
                return np.nan
            raw_s = str(val)
            if re.search(r"\s{2,}|\n|\r|\t", raw_s):
                whitespace_collapsed += 1
            s = re.sub(r"\s+", " ", raw_s).strip()

            if s in ["", "-", "–", "—", "N/A", "n/a", "NULL", "null", "None", "nan"]:
                nan_converted += 1
                return np.nan

            if is_text_col:
                return s

            if "," in s and FORMATTED_NUMBER_RE.match(s):
                commas_removed += 1
                cleaned_num = s.replace(",", "")
                f_val = float(cleaned_num)
                return int(f_val) if f_val.is_integer() else f_val

            if PLAIN_NUMBER_RE.match(s):
                f_val = float(s)
                return int(f_val) if f_val.is_integer() else f_val

            return s

        df[col] = df[col].apply(cleanse_cell)

    # ลบแถวที่ว่างเปล่าทั้งหมด
    rows_before_empty_drop = len(df)
    df.dropna(how="all", inplace=True)
    dropped_blank_rows = rows_before_empty_drop - len(df)

    # ลบแถวชำรุดที่คอลัมน์หลักหายไป
    critical_cols = [c for c in CRITICAL_NON_NULL_BY_SOURCE.get(source_id, []) if c in df.columns]
    dropped_corrupted_rows = 0
    if critical_cols:
        corrupted_mask = df[critical_cols].isna().any(axis=1)
        dropped_corrupted_rows = int(corrupted_mask.sum())
        if dropped_corrupted_rows > 0:
            df = df[~corrupted_mask].copy()

    # Scope Filtering เฉพาะแหล่งข้อมูล:
    scope_filtered_rows = 0
    if source_id == "SRC-050" and "sector" in df.columns:
        before_scope = len(df)
        df = df[df["sector"].astype(str).str.strip().str.upper() == "GSP"].copy()
        scope_filtered_rows = before_scope - len(df)
    elif source_id == "SRC-047" and "indicator" in df.columns:
        before_scope = len(df)
        df = df[~df["indicator"].str.contains("Intensity", case=False, na=False)].copy()
        scope_filtered_rows = before_scope - len(df)

    # ลบแถวซ้ำทุกคอลัมน์
    rows_before_dedup = len(df)
    df.drop_duplicates(keep="first", inplace=True)
    dropped_duplicates = rows_before_dedup - len(df)

    # เติมค่าหมวดหมู่ที่ว่างเปล่าสำหรับรหัสแปลงสำรวจบนบกของ DMF
    filled_missing_count = 0
    if "block_name" in df.columns:
        missing_block_mask = df["block_name"].isna()
        filled_missing_count = int(missing_block_mask.sum())
        if filled_missing_count > 0:
            df.loc[missing_block_mask, "block_name"] = "UNSPECIFIED"

    df.reset_index(drop=True, inplace=True)

    # สร้าง record_id หากแหล่งข้อมูลต้นทางไม่มีคอลัมน์ _id (เช่น SRC-047)
    if "record_id" not in df.columns:
        df["record_id"] = range(1, len(df) + 1)

    # 3. Data Transformation (Year BE->CE, Month Normalization, Unit Symbol)
    year_converted = 0
    thai_months_converted = 0

    if "year" in df.columns:
        df["year_raw"] = df["year"]

        def transform_year(y):
            nonlocal year_converted
            try:
                val = int(float(y))
                if val > 2400:
                    year_converted += 1
                    return val - 543
                return val
            except (ValueError, TypeError):
                return y

        df["year"] = df["year"].apply(transform_year)

    if "month" in df.columns:
        def transform_month_name(m):
            nonlocal thai_months_converted
            if pd.isna(m):
                return np.nan
            s = str(m).strip()
            if s in THAI_MONTHS:
                thai_months_converted += 1
                return THAI_MONTHS[s]
            try:
                m_int = int(float(s))
                if 1 <= m_int <= 12:
                    return NUM_TO_ENGLISH_MONTH[m_int]
            except (ValueError, TypeError):
                pass
            return s.capitalize() if s.lower() in ENGLISH_MONTH_TO_NUM else s

        df["month"] = df["month"].apply(transform_month_name)
        df["month_num"] = df["month"].apply(
            lambda m: ENGLISH_MONTH_TO_NUM.get(str(m).strip().lower(), np.nan)
        )

    if "unit" in df.columns:
        df["unit"] = df["unit"].apply(standardize_unit_symbol)

    # จัดชนิดข้อมูลตัวเลขให้สะอาดตามฟิลด์ของแต่ละแหล่งข้อมูล
    numeric_target_cols = [
        "oil_bbl_day", "gas_mmscf_day", "gas_equi_oil_bbl_day",
        "condensate_bbl_day", "condensate_equi_oil_bbl_day",
        "days_of_produce", "value", "quantity",
    ]
    numeric_cols = []
    for ncol in numeric_target_cols:
        if ncol in df.columns:
            df[ncol] = pd.to_numeric(df[ncol], errors="coerce").round(6)
            numeric_cols.append(ncol)

    # 4. ตรวจสอบคอลัมน์บังคับของแหล่งข้อมูลในชั้น Staging
    req_cols = REQUIRED_COLUMNS_BY_SOURCE.get(source_id, [])
    missing_req = [c for c in req_cols if c not in df.columns]
    if missing_req:
        raise RuntimeError(
            f"ไม่พบคอลัมน์บังคับในชั้น Staging สำหรับ {source_id}: {missing_req} "
            f"(คอลัมน์ที่มี: {list(df.columns)})"
        )

    validation_checks_passed = [f"Required Source Columns ({len(req_cols)}/{len(req_cols)})"]

    for ncol in numeric_cols:
        neg_count = int((df[ncol] < 0).sum())
        if neg_count > 0:
            raise ValueError(f"พบค่า {ncol} ติดลบจำนวน {neg_count} แถวใน {source_id}")
    validation_checks_passed.append("Non-Negative Numeric Values")

    if "year" in df.columns:
        y_num = pd.to_numeric(df["year"], errors="coerce")
        invalid_y = int((~y_num.between(1950, 2035)).sum())
        if invalid_y > 0:
            raise ValueError(f"พบปี ค.ศ. นอกช่วงมาตรฐาน (1950-2035) จำนวน {invalid_y} แถว")
        validation_checks_passed.append("Valid Year Range (C.E.)")

    # 5. ผสาน Provenance Metadata 7 ฟิลด์
    timestamp_bkk = get_bkk_timestamp()
    raw_file_name = os.path.basename(prov_meta.get("raw_file_path", ""))
    df["_source_id"] = source_id
    df["_subtrack"] = subtrack_name
    df["_extraction_batch_id"] = prov_meta.get("extraction_batch_id", f"BATCH-UNKNOWN-{source_id}")
    df["_source_url"] = prov_meta.get("source_url", "")
    df["_source_sha256"] = prov_meta.get("sha256_checksum", "")
    df["_raw_file"] = raw_file_name
    df["_staged_at"] = timestamp_bkk

    # 6. จัดเรียงคอลัมน์เฉพาะของแหล่งข้อมูล + Provenance
    provenance_cols = [
        "_source_id", "_subtrack", "_extraction_batch_id",
        "_source_url", "_source_sha256", "_raw_file", "_staged_at",
    ]
    preferred_source_cols = SOURCE_STAGING_COLUMNS.get(source_id, [])
    ordered_source_cols = [c for c in preferred_source_cols if c in df.columns]
    extra_cols = [
        c for c in df.columns
        if c not in ordered_source_cols and c not in provenance_cols
    ]
    final_col_order = ordered_source_cols + extra_cols + provenance_cols
    df = df[final_col_order]

    raw_evidence_cols = [c for c in df.columns if c.endswith("_raw")]

    stats = {
        "initial_rows": initial_rows,
        "final_rows": len(df),
        "initial_cols": initial_cols,
        "final_cols": len(df.columns),
        "empty_cols_dropped": empty_cols_raw,
        "null_counts_by_col": null_counts_by_col,
        "total_null_cells": total_null_cells,
        "all_blank_rows_count": all_blank_rows_count,
        "exact_duplicates_count": exact_duplicates_count,
        "dropped_blank_rows": dropped_blank_rows,
        "dropped_corrupted_rows": dropped_corrupted_rows,
        "scope_filtered_rows": scope_filtered_rows,
        "dropped_duplicates": dropped_duplicates,
        "filled_missing_count": filled_missing_count,
        "commas_removed": commas_removed,
        "nan_converted": nan_converted,
        "whitespace_collapsed": whitespace_collapsed,
        "col_changes": col_changes,
        "year_converted": year_converted,
        "thai_months_converted": thai_months_converted,
        "numeric_cols": numeric_cols,
        "validation_checks_passed": validation_checks_passed,
        "remaining_total_nulls": int(df.isna().sum().sum()),
        "source_cols_count": len(ordered_source_cols) + len(extra_cols) - len(raw_evidence_cols),
        "raw_evidence_cols": raw_evidence_cols,
    }

    return df, stats


def stage_data(source_id: str = "SRC-044") -> list[Path]:
    """
    ฟังก์ชันหลักสำหรับรันกระบวนการ Step 04: Data Staging
    """
    STAGING_DIR.mkdir(parents=True, exist_ok=True)

    matching_files = sorted(PARSED_DIR.glob(f"{source_id}_*_PARSED_RAW.csv"))
    if not matching_files:
        matching_files = sorted(PARSED_DIR.glob(f"{source_id}*_PARSED_RAW.csv"))

    if not matching_files:
        raise FileNotFoundError(
            f"ไม่พบไฟล์ตารางดิบ (_PARSED_RAW.csv) สำหรับ '{source_id}' ใน data/parsed/\n"
            f"            - คำแนะนำ     : กรุณารัน Step 03 (Data Parsing) สำหรับ {source_id} ก่อน"
        )

    staged_paths = []

    for parsed_file in matching_files:
        parts = parsed_file.stem.split("_")
        subtrack_name = parts[2] if len(parts) >= 3 else parsed_file.name
        output_path = get_staged_output_path(parsed_file)
        prov_meta = get_provenance_for_parsed_file(parsed_file, source_id)

        # 1. Data Extraction
        df_raw = _read_parsed_csv_safe(parsed_file)
        sha_short = prov_meta.get("sha256_checksum", "")[:16]
        print(
            f"  {'[1.EXTRACT]':<14}ดึงตารางจาก {parsed_file.name} "
            f"({len(df_raw):,} แถว, {len(df_raw.columns)} คอลัมน์ | SHA-256: {sha_short}...)"
        )

        # รันกระบวนการย่อยที่ 2 ถึง 6
        df_clean, stats = _run_staging_pipeline_on_dataframe(
            df_raw=df_raw,
            source_id=source_id,
            subtrack_name=subtrack_name,
            prov_meta=prov_meta,
        )

        # 2. Data Profiling
        null_summary = (
            ", ".join(f"{k}={v:,}" for k, v in stats["null_counts_by_col"].items())
            if stats["null_counts_by_col"]
            else "ไม่พบค่าว่าง"
        )
        empty_col_summary = (
            f"พบ {len(stats['empty_cols_dropped'])} คอลัมน์ ({', '.join(stats['empty_cols_dropped'])})"
            if stats["empty_cols_dropped"]
            else "0 คอลัมน์"
        )
        print(
            f"  {'[2.PROFILE]':<14}สำรวจข้อมูลดิบ: ค่าว่างรายคอลัมน์ [{null_summary}] | "
            f"คอลัมน์ว่าง 100%: {empty_col_summary} | แถวซ้ำ: {stats['exact_duplicates_count']:,} แถว"
        )

        # 3. Data Cleansing
        clean_actions = []
        if stats["empty_cols_dropped"]:
            clean_actions.append(f"ลบคอลัมน์ว่าง {len(stats['empty_cols_dropped'])} คอลัมน์")
        if stats["dropped_corrupted_rows"] > 0:
            clean_actions.append(f"ลบแถวชำรุด {stats['dropped_corrupted_rows']:,} แถว")
        if stats["scope_filtered_rows"] > 0:
            clean_actions.append(f"คัดกรองเฉพาะขอบเขตโครงงาน (ตัดออก {stats['scope_filtered_rows']:,} แถว)")
        if stats["dropped_duplicates"] > 0:
            clean_actions.append(f"ลบแถวซ้ำ {stats['dropped_duplicates']:,} แถว")
        if stats["filled_missing_count"] > 0:
            clean_actions.append(f"เติมรหัสแปลงสำรวจ (UNSPECIFIED) {stats['filled_missing_count']:,} แถว")
        if stats["commas_removed"] > 0:
            clean_actions.append(f"ลบลูกน้ำตัวเลข {stats['commas_removed']:,} จุด")
        if not clean_actions:
            clean_actions.append("ข้อมูลสะอาดพร้อมจัดมาตรฐาน (ไม่พบแถวชำรุดหรือแถวซ้ำ)")
        print(f"  {'[3.CLEANSE]':<14}{' | '.join(clean_actions)}")

        # 4. Data Transformation (Source-Specific Normalization)
        transform_actions = [f"แมปชื่อคอลัมน์เฉพาะแหล่ง {len(stats['col_changes'])} รายการ"]
        if stats["year_converted"] > 0:
            transform_actions.append(f"แปลงปี พ.ศ.->ค.ศ. ({stats['year_converted']:,} แถว)")
        if "month" in df_clean.columns:
            transform_actions.append("จัดมาตรฐานเดือน (month & month_num)")
        transform_actions.append(f"แปลงชนิดตัวเลข ({', '.join(stats['numeric_cols'])})")
        print(f"  {'[4.TRANSFORM]':<14}{' | '.join(transform_actions)}")

        # 5. Staging Integrity Validation
        print(
            f"  {'[5.VALIDATE]':<14}ผ่านเกณฑ์ความสมบูรณ์ระดับ Staging (PASS): "
            f"{', '.join(stats['validation_checks_passed'])}"
        )

        # 6. Data Integration (Source Columns + Raw Evidence + Provenance)
        print(
            f"  {'[6.INTEGRATE]':<14}ผสานโครงสร้างเฉพาะแหล่ง: "
            f"Source({stats['source_cols_count']}) + RawEvidence({len(stats['raw_evidence_cols'])}) "
            f"+ Provenance(7) = {stats['final_cols']} คอลัมน์"
        )

        # 7. Data Loading
        df_clean.to_csv(output_path, index=False, encoding="utf-8-sig")
        file_size_kb = output_path.stat().st_size / 1024
        staged_paths.append(output_path)

        print(
            f"  {'[7.LOAD]':<14}บันทึกตารางเฉพาะแหล่งข้อมูล -> {output_path.name} "
            f"({stats['final_rows']:,} แถว, {stats['final_cols']} คอลัมน์ | {file_size_kb:.2f} KB)"
        )

    return staged_paths


# Alias เพื่อความเข้ากันได้ย้อนหลัง
stage_and_transform = stage_data


def stage_all_approved():
    """รัน Step 04 Staging สำหรับทุกชุดข้อมูลที่มีไฟล์ใน data/parsed/"""
    parsed_files = list(PARSED_DIR.glob("*_PARSED_RAW.csv"))
    if not parsed_files:
        print("[STEP 04] ไม่พบไฟล์ตารางดิบใน data/parsed/ กรุณารัน Step 03 ก่อน")
        return

    source_ids = sorted(list({f.name.split("_")[0] for f in parsed_files if f.name.startswith("SRC-")}))
    for sid in source_ids:
        stage_data(sid)


if __name__ == "__main__":
    args = sys.argv[1:]
    clean_args = [a for a in args if not a.startswith("--")]
    if not clean_args or "--all" in args:
        stage_all_approved()
    else:
        for sid in clean_args:
            stage_data(sid)
