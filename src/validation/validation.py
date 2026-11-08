"""
=============================================================================
Step 06: Data Validation (ระบบตรวจสอบกฎคุณภาพข้อมูล 7 ข้อบนโครงสร้างกลาง)
=============================================================================
สถาปัตยกรรมและกฎการตรวจสอบ (Quality Check Rules บน Mapped Schema):
1. Rule: Check_Null_URL
   - ตรวจสอบว่ามีลิงก์อ้างอิงต้นทาง (_source_url) และรูปแบบถูกต้อง (http/https)
2. Rule: Validate_Unit
   - ตรวจสอบว่าหน่วยวัด (unit) สอดคล้องกับหน่วยมาตรฐานในตาราง UNIT
3. Rule: Check_Non_Negative
   - ตรวจสอบว่าปริมาณสาร/พลังงาน (amount) ต้องไม่ติดลบ (>= 0)
4. Rule: Validate_Direction
   - ตรวจสอบว่าทิศทางของสายไหล (direction) ต้องเป็น 'IN' หรือ 'OUT' เท่านั้น
5. Rule: Check_Process_Year
   - ตรวจสอบว่าปีที่บันทึกข้อมูล (year) อยู่ในช่วงที่สมเหตุสมผล (1950 - 2035)
6. Rule: Validate_Product_Flow
   - ตรวจสอบว่าชื่อสาร (flow_name), ประเภทสาร (flow_type) และสิ่งแวดล้อม (compartment) ครบถ้วนถูกต้อง
7. Rule: Check_Allocation_Burdens
   - ตรวจสอบว่าสำหรับกระบวนการต้นน้ำแบบหลายทางออก (SRC-044, SRC-045, SRC-046)
     ต้องเป็นปีที่มีข้อมูลมลพิษ/พลังงานจาก PTTEP (SRC-047) เพื่อทำ Allocation & Normalization (ปี 2022-2025)
     ปีอื่นที่ไม่มีข้อมูลมลพิษจะถูกส่งเข้าตาราง REJECTED_RECORD

ผลลัพธ์:
- แถวที่ผ่านเกณฑ์ทุกข้อ -> data/validation/accepted/<filename>_VALID.csv
- แถวที่ไม่ผ่านเกณฑ์ -> data/validation/rejected/<filename>_ERR.csv พร้อม error_type และ raw_data JSON
=============================================================================
"""

import json
import sys
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
MAPPING_DIR = PROJECT_ROOT / "data" / "mapping"
VALIDATION_DIR = PROJECT_ROOT / "data" / "validation"
ACCEPTED_DIR = VALIDATION_DIR / "accepted"
REJECTED_DIR = VALIDATION_DIR / "rejected"

# รายการหน่วยมาตรฐานที่ยอมรับตาม Seed Data ของตาราง UNIT
VALID_UNITS = {
    "BBL",
    "scf",
    "MMSCF",
    "BBL/DAY",
    "MMSCF/DAY",
    "Million Litres",
    "Litres",
    "kg",
    "Tonnes",
    "MJ",
    "kWh",
    "m3",
    "kgCO2e",
    "gCO2e",
    "tCO2e",
    "GJ",
    "BOE",
    "Tonne",
    "Metric Tonne",
    "Tonne CO2e",
    "Tonne VOC",
    "Tonne NO2",
    "Tonne SO2",
    "GJ / Tonne Production",
    "Tonne VOC / Thousand Tonne Production",
    "Tonne NO2 / Thousand Tonne Production",
    "Tonne SO2 / Thousand Tonne Production",
}

VALID_FLOW_TYPES = {"product", "elementary", "waste"}
VALID_COMPARTMENTS = {"technosphere", "air", "water", "soil"}


def _validate_url(url: str) -> bool:
    """ตรวจสอบความถูกต้องของ URL"""
    if pd.isna(url) or not str(url).strip():
        return False
    u = str(url).strip()
    return u.startswith("http://") or u.startswith("https://")


def _validate_flow_meta(row_dict: dict) -> bool:
    fl_name = str(row_dict.get("flow_name", "")).strip()
    fl_type = str(row_dict.get("flow_type", "")).strip()
    comp = str(row_dict.get("compartment", "")).strip()
    if not fl_name or fl_name == "nan":
        return False
    if fl_type not in VALID_FLOW_TYPES:
        return False
    if comp not in VALID_COMPARTMENTS:
        return False
    return True


def _check_allocation_burdens(row_dict: dict, source_id: str) -> bool:
    """
    สำหรับผลผลิตต้นน้ำ DMF (SRC-044, SRC-045, SRC-046):
    ต้องเป็นปีที่มีข้อมูลมลพิษและการใช้พลังงานจาก PTTEP (SRC-047) ในปี 2022-2025
    จึงจะสามารถคำนวณการปันส่วน (Allocation) และปรับฐานสู่ 1 Functional Unit ได้สมบูรณ์
    """
    if source_id in ["SRC-044", "SRC-045", "SRC-046"]:
        try:
            y = int(float(row_dict.get("year", 0)))
            return y in [2022, 2023, 2024, 2025]
        except Exception:
            return False
    return True


def get_accepted_output_path(mapped_file: Path) -> Path:
    stem = mapped_file.stem.replace("_MAPPED", "")
    return ACCEPTED_DIR / f"{stem}_VALID.csv"


def get_rejected_output_path(mapped_file: Path) -> Path:
    stem = mapped_file.stem.replace("_MAPPED", "")
    return REJECTED_DIR / f"{stem}_ERR.csv"


def validate_dataframe(df: pd.DataFrame, source_id: str) -> tuple[pd.DataFrame, pd.DataFrame, list[dict]]:
    """
    ตรวจสอบข้อมูลใน DataFrame ตามกฎ 7 ข้อ
    คืนค่า: (df_accepted, df_rejected, quality_checks_summary)
    """
    if df.empty:
        return df, pd.DataFrame(), []

    rejected_rows = []
    accepted_mask = np.ones(len(df), dtype=bool)

    rule_checks = [
        ("Check_Null_URL", "ไม่มี URL อ้างอิง", lambda r: _validate_url(r.get("_source_url", ""))),
        ("Validate_Unit", "หน่วยไม่ถูกต้อง", lambda r: str(r.get("unit", "")).strip() in VALID_UNITS),
        ("Check_Non_Negative", "ปริมาณติดลบ", lambda r: pd.notna(r.get("amount")) and float(r.get("amount", 0)) >= 0),
        ("Validate_Direction", "ทิศทางสายไหลไม่ถูกต้อง", lambda r: str(r.get("direction", "")).strip().upper() in ["IN", "OUT"]),
        ("Check_Process_Year", "ปีข้อมูลอยู่นอกช่วงมาตรฐาน", lambda r: pd.notna(r.get("year")) and (1950 <= int(float(r.get("year", 0))) <= 2035)),
        ("Validate_Product_Flow", "ข้อมูล Flow ไม่สมบูรณ์", _validate_flow_meta),
        (
            "Check_Allocation_Burdens",
            "ไม่มีข้อมูลพลังงานและมลพิษจาก PTTEP (SRC-047) เพื่อทำ LCI Allocation & Normalization",
            lambda r: _check_allocation_burdens(r, source_id),
        ),
    ]

    for idx, row in df.iterrows():
        row_dict = row.to_dict()
        row_errors = []
        for rule_name, error_desc, test_func in rule_checks:
            try:
                passed = test_func(row_dict)
            except Exception:
                passed = False

            if not passed:
                row_errors.append((rule_name, error_desc))

        if row_errors:
            accepted_mask[idx] = False
            raw_json = json.dumps(
                {k: (None if pd.isna(v) else v) for k, v in row_dict.items() if not k.startswith("_")},
                ensure_ascii=False,
            )
            for rule_name, error_desc in row_errors:
                rejected_rows.append({
                    "row_index": idx,
                    "source_id": source_id,
                    "rule_name": rule_name,
                    "error_type": error_desc,
                    "status": "Fail",
                    "raw_data": raw_json,
                })

    df_accepted = df[accepted_mask].copy().reset_index(drop=True)
    df_rejected = pd.DataFrame(rejected_rows) if rejected_rows else pd.DataFrame(
        columns=["row_index", "source_id", "rule_name", "error_type", "status", "raw_data"]
    )

    qc_summary = []
    total_rows = len(df)
    for rule_name, _, _ in rule_checks:
        failed_count = sum(1 for r in rejected_rows if r["rule_name"] == rule_name)
        passed_count = total_rows - failed_count
        qc_summary.append({
            "rule_name": rule_name,
            "passed": passed_count,
            "failed": failed_count,
            "status": "Pass" if failed_count == 0 else "Fail",
        })

    return df_accepted, df_rejected, qc_summary


def validate_data(source_id: str = "SRC-044") -> list[Path]:
    """
    ฟังก์ชันหลักสำหรับรันกระบวนการ Step 06: Data Validation
    """
    ACCEPTED_DIR.mkdir(parents=True, exist_ok=True)
    REJECTED_DIR.mkdir(parents=True, exist_ok=True)

    mapped_files = sorted(list(MAPPING_DIR.glob(f"{source_id}_*_MAPPED.csv")))
    if not mapped_files:
        raise FileNotFoundError(
            f"ไม่พบไฟล์ Data Mapping สำหรับ {source_id} ใน data/mapping/\n"
            f"            - คำแนะนำ     : กรุณารัน Step 05 (Data Mapping) สำหรับ {source_id} ก่อน"
        )

    accepted_paths = []

    for mapped_file in mapped_files:
        df = pd.read_csv(mapped_file, low_memory=False)
        total_rows = len(df)

        df_acc, df_rej, qc_summary = validate_dataframe(df, source_id)

        acc_path = get_accepted_output_path(mapped_file)
        rej_path = get_rejected_output_path(mapped_file)

        df_acc.to_csv(acc_path, index=False, encoding="utf-8-sig")
        accepted_paths.append(acc_path)

        acc_count = len(df_acc)
        rej_count = len(df_rej)

        if rej_count > 0:
            df_rej.to_csv(rej_path, index=False, encoding="utf-8-sig")
        elif rej_path.exists():
            rej_path.unlink()

        print(
            f"  {'[VALIDATE]':<14}ตรวจไฟล์ {mapped_file.name} "
            f"(ทั้งหมด: {total_rows:,} แถว | ผ่าน: {acc_count:,} แถว | กักกัน: {rej_count:,} รายการ)"
        )

        for qc in qc_summary:
            status_tag = f"[{qc['status']}]"
            print(f"    - {qc['rule_name']:<27}: ผ่าน {qc['passed']:,} | ไม่ผ่าน {qc['failed']:,} {status_tag}")

        if acc_count > 0:
            print(f"  {'[ACCEPTED]':<14}บันทึกข้อมูลผ่านเกณฑ์ -> data/validation/accepted/{acc_path.name}")
        if rej_count > 0:
            print(f"  {'[REJECTED]':<14}บันทึกข้อมูลกักกัน -> data/validation/rejected/{rej_path.name}")

    return accepted_paths


def validate_all_mapped():
    mapped_files = sorted(MAPPING_DIR.glob("*_MAPPED.csv"))
    if not mapped_files:
        print("[STEP 06] ไม่พบไฟล์ใน data/mapping/ กรุณารัน Step 05 ก่อน")
        return
    source_ids = sorted(list({f.name.split("_")[0] for f in mapped_files if f.name.startswith("SRC-")}))
    for sid in source_ids:
        validate_data(sid)


if __name__ == "__main__":
    args = sys.argv[1:]
    clean_args = [a for a in args if not a.startswith("--")]
    if not clean_args or "--all" in args:
        validate_all_mapped()
    else:
        for sid in clean_args:
            validate_data(sid)
