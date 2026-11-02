"""
=============================================================================
Step 3: Transform & Staging (กระบวนการจัดเตรียมและแปรรูปข้อมูล 7 ขั้นตอนย่อย)
=============================================================================
สถาปัตยกรรมย่อยภายในชั้น Staging (7-Step Data Staging Architecture):
1. Data Extraction     : ดึงตารางดิบจาก data/parsed/*_PARSED_RAW.csv และประวัติจาก _provenance_ledger.jsonl
2. Data Profiling      : วิเคราะห์โครงสร้างข้อมูล ตรวจนับค่าว่าง (Missing Values) คอลัมน์ว่าง 100% แถวชำรุด และแถวซ้ำ
3. Data Cleansing      : ลบช่องว่างซ้ำ แปลงสัญลักษณ์ค่าว่าง ลบแถวชำรุด/แถวซ้ำ เติมค่าหมวดหมู่ที่ขาดหาย และลบลูกน้ำตัวเลขอย่างปลอดภัย
4. Data Transformation : แมปชื่อคอลัมน์สู่มาตรฐานสากล แปลงปี พ.ศ. -> ค.ศ. แปลงเดือน -> ชื่ออังกฤษ/เลขเดือน และคำนวณฟิลด์ธุรกิจ
5. Data Validation     : ตรวจสอบคอลัมน์บังคับ (Required Columns) ความถูกต้องของช่วงข้อมูล (Non-negative, Year/Month) และฟิลด์คำนวณ
6. Data Integration    : จัดเรียงโครงสร้างคอลัมน์ให้สอดคล้องกันข้ามแหล่งข้อมูล และผสานข้อมูล Provenance ครบชุด
7. Data Loading        : บันทึกตารางที่ผ่านการเตรียมพร้อมแล้วลงใน data/staging/*_STAGED.csv
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
ACQUISITION_DIR = PROJECT_ROOT / "src" / "acquisition"

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
        f"            - คำแนะนำ     : ตรวจสอบว่าไฟล์ไม่ชำรุด หรือลองรัน Step 2 (Data Parsing) ใหม่"
    )


# ตารางจับคู่ชื่อคอลัมน์ภาษาไทย / ดิบ -> ภาษาอังกฤษมาตรฐาน
COLUMN_MAPPING = {
    # ทั่วไป & EPPO
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
    "Fuel Type": "fuel_type",
    "FUEL TYPE": "fuel_type",

    # DMF Supply & Production
    "เดือน": "month",
    "ก๊าซธรรมชาติ (ล้านลบ.ฟุตต่อวัน)": "natural_gas_mmcfd",
    "คอนเดนเสท (บาร์เรลต่อวัน)": "condensate_bpd",
    "น้ำมันดิบ (บาร์เรลต่อวัน)": "crude_oil_bpd",
    "รวม (บาร์เรลเทียบเท่าน้ำมันดิบต่อวัน)": "total_boed",
    "BLOCK_TYPE": "block_type",
    "BLOCK": "block_name",
    "SOURCE_GROUP": "source_group",
    "CONDENSATE": "condensate_volume",
    "CONDENSATE_EQUI_OIL": "condensate_equi_oil",
    "GAS_EQUI_OIL": "gas_equi_oil",
    "DAYSOFPRODUCE": "days_of_produce",
    "OIL": "oil_volume",
    "GAS": "gas_volume",

    # TGO Carbon Footprint (อบก.)
    "#": "source_row_no",
    "เลขที่ใบรับรอง": "certificate_no",
    "ชื่อ": "product_name",
    "รายละเอียด": "product_description",
    "อุตสาหกรรม": "industry_group",
    "วันที่อนุมัติ": "approve_date_raw",
    "ปริมาณ CF": "cf_volume_raw",
    "หน่วยการทำงาน": "functional_unit_raw",
    "ขอบเขต": "boundary",
    "ติดต่อ": "contact_person",
    "โทรศัพท์": "phone",
    "อีเมล์": "email",
}

# คอลัมน์บังคับขั้นต่ำของแต่ละกลุ่มชุดข้อมูลหลังการ Transformation & Integration
REQUIRED_COLUMNS_BY_SOURCE = {
    "SRC-043": ["certificate_no", "product_name", "industry_group", "cf_volume_raw", "functional_unit_raw"],
    "SRC-037": ["month", "natural_gas_mmcfd", "condensate_bpd", "crude_oil_bpd", "total_boed"],
    "SRC-044": ["year", "month", "month_num", "product", "quantity", "unit", "block_type", "block_name", "source_group", "oil_volume", "days_of_produce"],
    "SRC-045": ["year", "month", "month_num", "product", "quantity", "unit", "block_type", "block_name", "source_group", "gas_volume", "days_of_produce"],
    "SRC-046": ["year", "month", "month_num", "product", "quantity", "unit", "block_type", "block_name", "source_group", "condensate_volume", "days_of_produce"],
    "SRC-048": ["year", "month", "month_num", "product", "quantity", "unit"],
    "SRC-049": ["year", "month", "month_num", "product", "company", "quantity", "unit"],
    "DEFAULT_EPPO": ["year", "month", "month_num", "quantity", "unit"],
}

# คอลัมน์หลักที่ใช้ตัดสินว่าแถวนั้นเป็นแถวข้อมูลที่สมบูรณ์ (หากว่างทั้งหมดในกลุ่มนี้ถือเป็นแถวชำรุด/Error Row)
CRITICAL_NON_NULL_BY_SOURCE = {
    "SRC-044": ["block_type", "source_group", "oil_volume"],
    "SRC-045": ["block_type", "source_group", "gas_volume"],
    "SRC-046": ["block_type", "source_group", "condensate_volume"],
    "SRC-048": ["year", "month", "product", "quantity"],
    "SRC-049": ["year", "month", "company", "quantity"],
    "SRC-043": ["product_name"],
}

# คำสำคัญสำรองสำหรับจับคู่ชื่อคอลัมน์กรณีเว็บต้นทางมีเว้นวรรคหรือข้อความต่อท้าย
KEYWORD_COLUMN_FALLBACK = [
    (["เลขที่ใบรับรอง", "certificate"], "certificate_no"),
    (["รายละเอียด", "detail"], "product_description"),
    (["อุตสาหกรรม", "industry"], "industry_group"),
    (["วันที่อนุมัติ", "approve"], "approve_date_raw"),
    (["ปริมาณ cf", "cf volume"], "cf_volume_raw"),
    (["หน่วยการทำงาน", "functional unit"], "functional_unit_raw"),
    (["ขอบเขต", "boundary"], "boundary"),
]

# คอลัมน์ที่เป็นข้อความหรือรหัสประจำตัว (ห้ามลบลูกน้ำ และห้ามแปลงเป็น float/int เพื่อรักษาเลข 0 นำหน้า)
TEXT_AND_IDENTIFIER_COLS = {
    "certificate_no",
    "product_name",
    "product_description",
    "industry_group",
    "approve_date_raw",
    "cf_volume_raw",
    "functional_unit_raw",
    "boundary",
    "contact_person",
    "phone",
    "email",
    "product",
    "company",
    "unit",
    "fuel_type",
    "block_type",
    "block_name",
    "source_group",
}

# ตารางจับคู่ชื่อเดือนภาษาไทย -> สากล (English)
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

# ตารางแปลงหน่วยมวลเป็นกิโลกรัม
MASS_TO_KG = {
    "kg": 1.0,
    "กิโลกรัม": 1.0,
    "กก.": 1.0,
    "g": 0.001,
    "กรัม": 0.001,
    "t": 1000.0,
    "ตัน": 1000.0,
    "ton": 1000.0,
    "tonne": 1000.0,
}

# รูปแบบตัวเลขคั่นหลักพันที่ถูกต้อง เช่น 2,164.31 หรือ 1,300
FORMATTED_NUMBER_RE = re.compile(r"^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$")
PLAIN_NUMBER_RE = re.compile(r"^[-+]?\d+(?:\.\d+)?$")


# =============================================================================
# ฟังก์ชันช่วยเหลือสำหรับ Data Cleansing & Transformation
# =============================================================================
def clean_text(value):
    """ทำความสะอาดข้อความ ยุบช่องว่างหลายตัวและแปลงสัญลักษณ์ค่าว่างเป็น np.nan"""
    if pd.isna(value):
        return np.nan
    text = re.sub(r"\s+", " ", str(value)).strip()
    if text in ["", "-", "–", "—", "N/A", "n/a", "NULL", "null", "None", "nan"]:
        return np.nan
    return text


def parse_number(text) -> float:
    """แยกเฉพาะค่าตัวเลขออกจากข้อความที่มีหน่วยติดมา เช่น '964 gCO2e' -> 964.0"""
    if pd.isna(text) or text is None:
        return np.nan
    match = re.search(r"[-+]?\d[\d,]*(?:\.\d+)?", str(text))
    if not match:
        return np.nan
    try:
        return float(match.group(0).replace(",", ""))
    except ValueError:
        return np.nan


def normalize_cf_unit(text) -> str | float:
    """แยกและจัดมาตรฐานหน่วยคาร์บอนฟุตพริ้นท์ เช่น CO₂ -> CO2"""
    if pd.isna(text) or text is None:
        return np.nan
    s = str(text).lower().replace("₂", "2").replace("co₂", "co2")
    s = re.sub(r"[\s_{}\^()]", "", s)
    if "kgco2" in s or s.endswith("kg"):
        return "kgCO2e"
    if "gco2" in s or s.endswith("g"):
        return "gCO2e"
    if "tco2" in s or "tonco2" in s or s.endswith("t") or s.endswith("ton"):
        return "tCO2e"
    return np.nan


def convert_cf_to_kgco2e(value, unit) -> float:
    """แปลงค่าคาร์บอนฟุตพริ้นท์ให้เป็นหน่วยฐานเดียวกันคือ kgCO2e"""
    if value is None or pd.isna(value) or unit is None or pd.isna(unit):
        return np.nan
    if unit == "kgCO2e":
        return float(value)
    if unit == "gCO2e":
        return round(float(value) / 1000.0, 6)
    if unit == "tCO2e":
        return round(float(value) * 1000.0, 6)
    return np.nan


def extract_mass_kg(text) -> float:
    """แปลงเฉพาะ Functional Unit ที่เป็นมวลจริงให้เป็น kg โดยไม่เดาหน่วยที่ไม่ใช่มวล"""
    if pd.isna(text) or text is None:
        return np.nan
    unit_pattern = "|".join(sorted((re.escape(x) for x in MASS_TO_KG), key=len, reverse=True))

    match = re.search(rf"\(\s*([\d,.]+)\s*({unit_pattern})\s*\)", str(text), flags=re.IGNORECASE)
    if not match:
        match = re.search(rf"([\d,.]+)\s*({unit_pattern})(?:\s|$)", str(text), flags=re.IGNORECASE)
    if not match:
        return np.nan

    try:
        value = float(match.group(1).replace(",", ""))
        unit = match.group(2).lower()
        return round(value * MASS_TO_KG[unit], 6)
    except (ValueError, KeyError):
        return np.nan


def parse_thai_date(text) -> str | float:
    """แปลงวันที่ DD/MM/YYYY จากปี พ.ศ. เป็น ค.ศ. รูปแบบ ISO YYYY-MM-DD"""
    if pd.isna(text) or text is None:
        return np.nan
    match = re.search(r"(\d{1,2})/(\d{1,2})/(\d{4})", str(text))
    if not match:
        return np.nan
    day, month, year = map(int, match.groups())
    if year >= 2400:
        year -= 543
    try:
        ts = pd.Timestamp(year=year, month=month, day=day)
        return ts.strftime("%Y-%m-%d")
    except ValueError:
        return np.nan


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
    """แมปชื่อคอลัมน์จากต้นทางสู่ชื่อมาตรฐานภาษาอังกฤษ"""
    new_cols = []
    col_changes = []
    for col in columns:
        col_str = str(col).strip()
        target_col = None
        if col_str in COLUMN_MAPPING:
            target_col = COLUMN_MAPPING[col_str]
        else:
            for kw_list, mapped_target in KEYWORD_COLUMN_FALLBACK:
                if any(k.lower() in col_str.lower() for k in kw_list):
                    target_col = mapped_target
                    break
        if target_col is None:
            clean_name = re.sub(r"[^\w\s-]", "", col_str)
            clean_name = re.sub(r"[\s-]+", "_", clean_name).lower()
            target_col = clean_name if clean_name else col_str

        new_cols.append(target_col)
        if target_col != col_str:
            col_changes.append(f"{col_str} -> {target_col}")
    return new_cols, col_changes


# =============================================================================
# กระบวนการ Staging ทั้ง 7 ขั้นตอนย่อย (7 Staging Sub-Steps)
# =============================================================================
def _run_staging_pipeline_on_dataframe(
    df_raw: pd.DataFrame,
    source_id: str,
    subtrack_name: str,
    prov_meta: dict,
) -> tuple[pd.DataFrame, dict]:
    """
    ดำเนินการจัดเตรียมข้อมูลตาม 7 ขั้นตอนย่อยของ Data Staging:
    1. Extraction (รับตารางดิบและ Provenance)
    2. Profiling  (สำรวจโครงสร้าง ค่าว่าง คอลัมน์ว่าง แถวซ้ำ และแถวชำรุด)
    3. Cleansing  (ล้างช่องว่าง ลบคอลัมน์ว่าง 100% ลบแถวชำรุด/แถวซ้ำ เติมค่าหมวดหมู่ และล้างลูกน้ำตัวเลข)
    4. Transformation (แมปคอลัมน์ แปลงปี พ.ศ.->ค.ศ. แปลงเดือน และสร้างฟิลด์มาตรฐาน/คำนวณ)
    5. Validation (ตรวจสอบคอลัมน์บังคับ ช่วงค่าตัวเลขไม่ติดลบ ช่วงปี/เดือน และความสอดคล้องของฟิลด์)
    6. Integration (จัดเรียงลำดับคอลัมน์ให้เป็นมาตรฐานเดียวกันและผสานฟิลด์ Provenance)
    7. Loading    (ส่งคืนตารางพร้อมบันทึกลงไฟล์ _STAGED.csv)
    """
    df = df_raw.copy()

    # -------------------------------------------------------------------------
    # Sub-Step 2: Data Profiling (วิเคราะห์คุณภาพและปัญหาของข้อมูลดิบก่อนคลีน)
    # -------------------------------------------------------------------------
    initial_rows = len(df)
    initial_cols = len(df.columns)

    # ตรวจดูค่าที่เป็นสัญลักษณ์ว่างเปล่าในตารางดิบ
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

    # -------------------------------------------------------------------------
    # Sub-Step 3: Data Cleansing (ทำความสะอาด ลบแถว/คอลัมน์ขยะ และเติมค่าที่ขาดหาย)
    # -------------------------------------------------------------------------
    # 3.1 ลบคอลัมน์ที่ว่างเปล่า 100% ออกเพื่อไม่ให้มี Blank Column ค้างในตาราง
    if empty_cols_raw:
        df.drop(columns=empty_cols_raw, inplace=True)

    # 3.2 แมปชื่อคอลัมน์เบื้องต้นเพื่ออ้างอิงกฎการคลีนตามความหมายคอลัมน์
    mapped_cols, col_changes = _map_column_names(list(df.columns))
    df.columns = mapped_cols

    # เก็บค่าเดือนดิบก่อนแปลง
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

    # 3.3 ลบแถวที่ว่างเปล่าทั้งหมด
    rows_before_empty_drop = len(df)
    df.dropna(how="all", inplace=True)
    dropped_blank_rows = rows_before_empty_drop - len(df)

    # 3.4 ลบแถวชำรุด (Error Rows) ที่คอลัมน์หลักหายไปทั้งหมด เช่น แถวปี 2023 เดือน 5 ใน DMF ที่ไม่มีชื่อแหล่งและปริมาณผลิต
    critical_cols = [c for c in CRITICAL_NON_NULL_BY_SOURCE.get(source_id, []) if c in df.columns]
    dropped_corrupted_rows = 0
    if critical_cols:
        corrupted_mask = df[critical_cols].isna().any(axis=1)
        dropped_corrupted_rows = int(corrupted_mask.sum())
        if dropped_corrupted_rows > 0:
            df = df[~corrupted_mask].copy()

    # 3.5 ลบแถวที่ซ้ำกันทุกคอลัมน์ (Exact Duplicate Rows)
    rows_before_dedup = len(df)
    df.drop_duplicates(keep="first", inplace=True)
    dropped_duplicates = rows_before_dedup - len(df)

    # 3.6 เติมค่าหมวดหมู่ที่ว่างเปล่าอย่างมีความหมาย (เช่น แหล่งผลิตบนบกของ DMF ที่ไม่มีรหัสแปลงสำรวจ BLOCK)
    filled_missing_count = 0
    if "block_name" in df.columns:
        missing_block_mask = df["block_name"].isna()
        filled_missing_count = int(missing_block_mask.sum())
        if filled_missing_count > 0:
            df.loc[missing_block_mask, "block_name"] = "UNSPECIFIED"

    df.reset_index(drop=True, inplace=True)

    # -------------------------------------------------------------------------
    # Sub-Step 4: Data Transformation (แปลงรูปแบบมาตรฐาน หน่วยวัด และคำนวณฟิลด์)
    # -------------------------------------------------------------------------
    year_converted = 0
    thai_months_converted = 0

    # 4.1 จัดมาตรฐานปี (Year): เก็บ year_raw เสมอ และแปลงปี พ.ศ. (>2400) เป็น ค.ศ.
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

    # 4.2 จัดมาตรฐานเดือน (Month): แปลงเดือนไทย/ตัวเลขเป็นชื่อเดือนอังกฤษ และสร้าง month_num (1..12)
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

    # 4.3 สร้างคอลัมน์มาตรฐานกลาง (product, quantity, unit) สำหรับชุดข้อมูลการผลิต/ใช้ปิโตรเลียม
    if source_id == "SRC-044" and "oil_volume" in df.columns:
        df["product"] = "CRUDE OIL"
        df["quantity"] = df["oil_volume"]
        df["unit"] = "BBL/DAY"
    elif source_id == "SRC-045" and "gas_volume" in df.columns:
        df["product"] = "NATURAL GAS"
        df["quantity"] = df["gas_volume"]
        df["unit"] = "MMSCF/DAY"
    elif source_id == "SRC-046" and "condensate_volume" in df.columns:
        df["product"] = "CONDENSATE"
        df["quantity"] = df["condensate_volume"]
        df["unit"] = "BBL/DAY"
    elif source_id == "SRC-049" and "product" not in df.columns:
        df["product"] = "CRUDE OIL (REFINERY INTAKE)"

    # 4.4 การแปลงเฉพาะทางสำหรับ TGO Carbon Footprint (กรณีรัน SRC-043)
    cf_parsed_count = 0
    cf_kgco2e_count = 0
    mass_kg_count = 0
    derived_per_kg_count = 0
    thai_date_converted = 0

    if "cf_volume_raw" in df.columns:
        df["cf_value"] = df["cf_volume_raw"].apply(parse_number)
        df["cf_unit"] = df["cf_volume_raw"].apply(normalize_cf_unit)
        df["cf_kgco2e"] = df.apply(
            lambda r: convert_cf_to_kgco2e(r["cf_value"], r["cf_unit"]), axis=1
        )
        cf_parsed_count = int(df["cf_value"].notna().sum())
        cf_kgco2e_count = int(df["cf_kgco2e"].notna().sum())

    if "functional_unit_raw" in df.columns:
        df["functional_unit_mass_kg"] = df["functional_unit_raw"].apply(extract_mass_kg)
        mass_kg_count = int(df["functional_unit_mass_kg"].notna().sum())

    if "cf_kgco2e" in df.columns and "functional_unit_mass_kg" in df.columns:
        df["cf_kgco2e_per_kg_product"] = (
            df["cf_kgco2e"] / df["functional_unit_mass_kg"]
        ).round(6)
        derived_per_kg_count = int(df["cf_kgco2e_per_kg_product"].notna().sum())

    if "approve_date_raw" in df.columns:
        df["approved_at"] = df["approve_date_raw"].apply(parse_thai_date)
        thai_date_converted = int(df["approved_at"].notna().sum())

    # ระบุรายชื่อคอลัมน์ตัวเลขทั้งหมดหลังการแปลง
    numeric_cols = []
    for col in df.columns:
        if col in TEXT_AND_IDENTIFIER_COLS or col in ("month", "month_raw", "year_raw"):
            continue
        sample_vals = df[col].dropna()
        if not sample_vals.empty and all(isinstance(v, (int, float, np.number)) for v in sample_vals.head(50)):
            numeric_cols.append(col)

    # -------------------------------------------------------------------------
    # Sub-Step 5: Data Validation (ตรวจสอบกฎธุรกิจและบูรณภาพของข้อมูลในชั้น Staging)
    # -------------------------------------------------------------------------
    req_cols = REQUIRED_COLUMNS_BY_SOURCE.get(
        source_id, REQUIRED_COLUMNS_BY_SOURCE["DEFAULT_EPPO"]
    )
    missing_req = [c for c in req_cols if c not in df.columns]
    if missing_req:
        raise RuntimeError(
            f"ไม่พบคอลัมน์บังคับหลังการแปลงสำหรับ {source_id}: {missing_req} "
            f"(คอลัมน์ที่มี: {list(df.columns)})"
        )

    validation_checks_passed = []
    validation_checks_passed.append(f"Required Columns ({len(req_cols)}/{len(req_cols)})")

    if "quantity" in df.columns:
        q_num = pd.to_numeric(df["quantity"], errors="coerce")
        neg_count = int((q_num < 0).sum())
        if neg_count > 0:
            raise ValueError(f"พบค่า quantity ติดลบจำนวน {neg_count} แถวใน {source_id}")
        validation_checks_passed.append("Non-Negative Quantity (0 negative)")

    if "year" in df.columns:
        y_num = pd.to_numeric(df["year"], errors="coerce")
        invalid_y = int((~y_num.between(1950, 2035)).sum())
        if invalid_y > 0:
            raise ValueError(f"พบปี ค.ศ. นอกช่วงมาตรฐาน (1950-2035) จำนวน {invalid_y} แถว")
        validation_checks_passed.append("Valid Year Range (C.E.)")

    if "month_num" in df.columns:
        m_num = pd.to_numeric(df["month_num"], errors="coerce")
        invalid_m = int((~m_num.between(1, 12)).sum())
        if invalid_m > 0:
            raise ValueError(f"พบเลขเดือนนอกช่วง 1..12 จำนวน {invalid_m} แถว")
        validation_checks_passed.append("Valid Month (1..12)")

    remaining_nulls_in_req = int(df[req_cols].isna().sum().sum())
    validation_checks_passed.append(f"Nulls in Required Cols ({remaining_nulls_in_req})")

    # -------------------------------------------------------------------------
    # Sub-Step 6: Data Integration (จัดเรียงโครงสร้างมาตรฐานเดียวและผสาน Provenance)
    # -------------------------------------------------------------------------
    timestamp_bkk = get_bkk_timestamp()
    raw_file_name = os.path.basename(prov_meta.get("raw_file_path", ""))
    df["_source_id"] = source_id
    df["_subtrack"] = subtrack_name
    df["_extraction_batch_id"] = prov_meta.get("extraction_batch_id", f"BATCH-UNKNOWN-{source_id}")
    df["_source_url"] = prov_meta.get("source_url", "")
    df["_source_sha256"] = prov_meta.get("sha256_checksum", "")
    df["_raw_file"] = raw_file_name
    df["_staged_at"] = timestamp_bkk

    # จัดลำดับคอลัมน์ให้เป็นระเบียบเหมือนกันทุกไฟล์:
    # [1. แกนเวลาและตัวตนหลัก] -> [2. ปริมาณและหน่วยมาตรฐาน] -> [3. รายละเอียดเฉพาะแหล่ง] -> [4. ค่าดิบอ้างอิง (_raw)] -> [5. Provenance (_*)]
    core_priority = ["record_id", "year", "month", "month_num", "product", "company", "fuel_type", "quantity", "unit"]
    raw_evidence_cols = [c for c in df.columns if c.endswith("_raw")]
    provenance_cols = [c for c in df.columns if c.startswith("_")]
    ordered_core = [c for c in core_priority if c in df.columns]
    domain_detail_cols = [
        c for c in df.columns
        if c not in ordered_core and c not in raw_evidence_cols and c not in provenance_cols
    ]

    final_col_order = ordered_core + domain_detail_cols + raw_evidence_cols + provenance_cols
    df = df[final_col_order]

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
        "dropped_duplicates": dropped_duplicates,
        "filled_missing_count": filled_missing_count,
        "commas_removed": commas_removed,
        "nan_converted": nan_converted,
        "whitespace_collapsed": whitespace_collapsed,
        "col_changes": col_changes,
        "year_converted": year_converted,
        "thai_months_converted": thai_months_converted,
        "cf_parsed_count": cf_parsed_count,
        "cf_kgco2e_count": cf_kgco2e_count,
        "mass_kg_count": mass_kg_count,
        "derived_per_kg_count": derived_per_kg_count,
        "thai_date_converted": thai_date_converted,
        "numeric_cols": numeric_cols,
        "validation_checks_passed": validation_checks_passed,
        "remaining_total_nulls": int(df.isna().sum().sum()),
        "ordered_core": ordered_core,
        "domain_detail_cols": domain_detail_cols,
        "raw_evidence_cols": raw_evidence_cols,
    }

    return df, stats


def stage_and_transform(source_id: str = "SRC-044") -> list[Path]:
    """
    ฟังก์ชันหลักสำหรับรันกระบวนการ Data Staging ทั้ง 7 ขั้นตอนย่อย
    """
    STAGING_DIR.mkdir(parents=True, exist_ok=True)

    matching_files = sorted(PARSED_DIR.glob(f"{source_id}_*_PARSED_RAW.csv"))
    if not matching_files:
        matching_files = sorted(PARSED_DIR.glob(f"{source_id}*_PARSED_RAW.csv"))

    if not matching_files:
        raise FileNotFoundError(
            f"ไม่พบไฟล์ตารางดิบ (_PARSED_RAW.csv) สำหรับ '{source_id}' ใน data/parsed/\n"
            f"            - คำแนะนำ     : กรุณารัน Step 2 (Data Parsing) สำหรับ {source_id} ก่อน"
        )

    # ลบไฟล์ *_STG.csv รูปแบบเก่า (ถ้ามีค้างอยู่) เพื่อไม่ให้ซ้ำซ้อนกับ *_STAGED.csv
    for old_stg in STAGING_DIR.glob(f"{source_id}_*_STG.csv"):
        try:
            old_stg.unlink()
        except Exception:
            pass

    is_multi = len(matching_files) > 1
    staged_paths = []

    for idx, parsed_file in enumerate(matching_files, 1):
        parts = parsed_file.stem.split("_")
        subtrack_name = parts[2] if len(parts) >= 3 else parsed_file.name
        output_path = get_staged_output_path(parsed_file)
        prov_meta = get_provenance_for_parsed_file(parsed_file, source_id)

        if is_multi:
            print(f"\n  --- ไฟล์ที่ {idx}/{len(matching_files)} (Subtrack: {subtrack_name}) ---")

        # 1. Data Extraction
        df_raw = _read_parsed_csv_safe(parsed_file)
        sha_short = prov_meta.get("sha256_checksum", "")[:16]
        print(
            f"  {'[1.EXTRACT]':<14}ดึงตารางจาก {parsed_file.name} "
            f"({len(df_raw):,} แถว, {len(df_raw.columns)} คอลัมน์ | SHA-256: {sha_short}...)"
        )

        # รันขั้นตอนที่ 2 ถึง 6
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
        if stats["dropped_duplicates"] > 0:
            clean_actions.append(f"ลบแถวซ้ำ {stats['dropped_duplicates']:,} แถว")
        if stats["filled_missing_count"] > 0:
            clean_actions.append(f"เติมรหัสแปลงสำรวจที่ว่าง (UNSPECIFIED) {stats['filled_missing_count']:,} แถว")
        if stats["commas_removed"] > 0:
            clean_actions.append(f"ลบลูกน้ำตัวเลข {stats['commas_removed']:,} จุด")
        if not clean_actions:
            clean_actions.append("ข้อมูลสะอาดพร้อมแปลงรูปแบบ (ไม่พบแถวชำรุดหรือแถวซ้ำ)")
        print(f"  {'[3.CLEANSE]':<14}{' | '.join(clean_actions)}")

        # 4. Data Transformation
        transform_actions = [f"แมปชื่อคอลัมน์ {len(stats['col_changes'])} รายการ"]
        if stats["year_converted"] > 0:
            transform_actions.append(f"แปลงปี พ.ศ.->ค.ศ. ({stats['year_converted']:,} แถว)")
        transform_actions.append("จัดมาตรฐานเดือน (month & month_num)")
        transform_actions.append("จัดมาตรฐานฟิลด์หลัก (product, quantity, unit)")
        if stats["cf_parsed_count"] > 0:
            transform_actions.append(f"แยกค่า/หน่วย CF ({stats['cf_kgco2e_count']:,} แถว)")
        print(f"  {'[4.TRANSFORM]':<14}{' | '.join(transform_actions)}")

        # 5. Data Validation
        print(
            f"  {'[5.VALIDATE]':<14}ผ่านเกณฑ์คุณภาพครบถ้วน (PASS): "
            f"{', '.join(stats['validation_checks_passed'])}"
        )

        # 6. Data Integration
        print(
            f"  {'[6.INTEGRATE]':<14}จัดเรียงโครงสร้างมาตรฐาน: "
            f"Core({len(stats['ordered_core'])}) + Detail({len(stats['domain_detail_cols'])}) "
            f"+ Raw({len(stats['raw_evidence_cols'])}) + Provenance(7) = {stats['final_cols']} คอลัมน์ "
            f"(ค่าว่างคงเหลือ: {stats['remaining_total_nulls']} จุด)"
        )

        # 7. Data Loading
        df_clean.to_csv(output_path, index=False, encoding="utf-8-sig")
        file_size_kb = output_path.stat().st_size / 1024
        staged_paths.append(output_path)

        print(
            f"  {'[7.LOAD]':<14}บันทึกสำเร็จ -> {output_path.name} "
            f"({stats['final_rows']:,} แถว, {stats['final_cols']} คอลัมน์ | {file_size_kb:.2f} KB)"
        )

    return staged_paths


def stage_all_approved():
    """ทำความสะอาดและจัดเก็บข้อมูลสำหรับทุกชุดข้อมูลที่มีไฟล์อยู่ใน data/parsed/"""
    parsed_files = list(PARSED_DIR.glob("*_PARSED_RAW.csv"))
    if not parsed_files:
        print("[STEP 3] ไม่พบไฟล์ตารางดิบใน data/parsed/ กรุณารัน Step 2 ก่อน")
        return

    source_ids = sorted(list({f.name.split("_")[0] for f in parsed_files if f.name.startswith("SRC-")}))

    print("\n" + "=" * 75)
    print(f"[STEP 3] เริ่มต้นกระบวนการ 7-Step Data Staging ทั้งหมด {len(source_ids)} ชุดข้อมูล (รวม {len(parsed_files)} ไฟล์)")
    print(f"         {', '.join(source_ids)}")
    print("=" * 75)

    success_count = 0
    total_staged_files = 0
    for sid in source_ids:
        try:
            paths = stage_and_transform(sid)
            success_count += 1
            total_staged_files += len(paths)
        except Exception as e:
            print(f"  {'[FAIL]':<12}ล้มเหลวในการทำ Staging สำหรับ {sid}: {e}")

    print(f"\n[SUMMARY] สรุปผลการ Staging: สำเร็จ {success_count}/{len(source_ids)} ชุดข้อมูล (สร้าง {total_staged_files} ไฟล์ใน data/staging/)\n")


def main():
    args = sys.argv[1:]
    clean_args = [a for a in args if not a.startswith("--")]

    if not clean_args or "--all" in args:
        stage_all_approved()
        return

    for sid in clean_args:
        try:
            stage_and_transform(sid)
        except Exception as e:
            print(f"  {'[FAIL]':<12}ล้มเหลวในการทำ Staging สำหรับ {sid}: {e}")


if __name__ == "__main__":
    main()
