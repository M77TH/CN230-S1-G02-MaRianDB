"""
=============================================================================
Step 4: Data Validation Engine (ระบบตรวจสอบคุณภาพข้อมูลและคัดแยกรายการ)
=============================================================================
สถาปัตยกรรมและกฎการตรวจสอบ (Quality Check Rules):
1. Rule: Check_Null_URL
   - ตรวจสอบว่ามีลิงก์อ้างอิงต้นทาง (_source_url) และรูปแบบถูกต้อง
2. Rule: Validate_Unit
   - ตรวจสอบว่าหน่วยวัด (unit) สอดคล้องกับหน่วยมาตรฐานในตาราง UNIT
3. Rule: Check_Non_Negative
   - ตรวจสอบว่าปริมาณสาร/พลังงาน (amount / quantity) ต้องไม่ติดลบ (>= 0)
4. Rule: Validate_Direction
   - ตรวจสอบว่าทิศทางของสายไหล (direction) ต้องเป็น 'IN' หรือ 'OUT' เท่านั้น
5. Rule: Check_Process_Year
   - ตรวจสอบว่าปีที่บันทึกข้อมูล (year) อยู่ในช่วงที่สมเหตุสมผล (1950 - 2035)
6. Rule: Validate_Product_Flow
   - ตรวจสอบว่าชื่อสารและผลิตภัณฑ์ (product, flow_name) ต้องไม่ว่างเปล่า

ผลลัพธ์:
- แถวที่ผ่านเกณฑ์ทุกข้อ -> data/accepted/<filename>_ACCEPTED.csv
- แถวที่ไม่ผ่านเกณฑ์ -> data/rejected/<filename>_REJECTED.csv พร้อม error_type และ raw_data JSON
- เก็บสถิติผลการตรวจเพื่อเตรียมส่งเข้าตาราง QUALITY_CHECK และ REJECTED_RECORD ใน Step 5
=============================================================================
"""

import json
import os
import re
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
STAGING_DIR = PROJECT_ROOT / "data" / "staging"
ACCEPTED_DIR = PROJECT_ROOT / "data" / "accepted"
REJECTED_DIR = PROJECT_ROOT / "data" / "rejected"

# รายการหน่วยมาตรฐานที่ยอมรับตาม Seed Data ของตาราง UNIT
VALID_UNITS = {
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
}


def _validate_url(url: str) -> bool:
    """ตรวจสอบความถูกต้องของ URL"""
    if pd.isna(url) or not str(url).strip():
        return False
    u = str(url).strip()
    return u.startswith("http://") or u.startswith("https://")


def get_accepted_output_path(staged_file: Path) -> Path:
    stem = staged_file.stem.replace("_STAGED", "").replace("_STG", "")
    return ACCEPTED_DIR / f"{stem}_ACCEPTED.csv"


def get_rejected_output_path(staged_file: Path) -> Path:
    stem = staged_file.stem.replace("_STAGED", "").replace("_STG", "")
    return REJECTED_DIR / f"{stem}_REJECTED.csv"


def validate_dataframe(df: pd.DataFrame, source_id: str) -> tuple[pd.DataFrame, pd.DataFrame, list[dict]]:
    """
    ตรวจสอบข้อมูลใน DataFrame ตามกฎ 6 ข้อ
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
        ("Validate_Product_Flow", "ไม่มีชื่อผลิตภัณฑ์/Flow", lambda r: bool(str(r.get("flow_name", "")).strip() and str(r.get("flow_name", "")).strip() != "nan")),
    ]

    # ตรวจสอบทีละแถว
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
            # บันทึกลง rejected list
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

    # สรุปผล Quality Check
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
    ฟังก์ชันหลักสำหรับรันกระบวนการ Data Validation
    """
    ACCEPTED_DIR.mkdir(parents=True, exist_ok=True)
    REJECTED_DIR.mkdir(parents=True, exist_ok=True)

    staged_files = sorted(list(STAGING_DIR.glob(f"{source_id}_*_STAGED*.csv")))
    if not staged_files:
        staged_files = sorted(list(STAGING_DIR.glob(f"{source_id}_*_STG.csv")))
    if not staged_files:
        staged_files = sorted(list(STAGING_DIR.glob(f"{source_id}*STG.csv")))

    if not staged_files:
        raise FileNotFoundError(f"ไม่พบไฟล์ Staging สำหรับ {source_id} ใน data/staging/")

    accepted_paths = []

    for staged_file in staged_files:
        df = pd.read_csv(staged_file, low_memory=False)
        total_rows = len(df)

        df_acc, df_rej, qc_summary = validate_dataframe(df, source_id)

        acc_path = get_accepted_output_path(staged_file)
        rej_path = get_rejected_output_path(staged_file)

        df_acc.to_csv(acc_path, index=False, encoding="utf-8-sig")
        df_rej.to_csv(rej_path, index=False, encoding="utf-8-sig")
        accepted_paths.append(acc_path)

        acc_count = len(df_acc)
        rej_count = len(df_rej)

        print(
            f"  {'[VALIDATE]':<14}ตรวจไฟล์ {staged_file.name} "
            f"(ทั้งหมด: {total_rows:,} แถว | ผ่าน: {acc_count:,} แถว | ไม่ผ่าน: {rej_count:,} รายการ)"
        )

        for qc in qc_summary:
            status_tag = f"[{qc['status']}]"
            print(f"    - {qc['rule_name']:<25}: ผ่าน {qc['passed']:,} | ไม่ผ่าน {qc['failed']:,} {status_tag}")

        if acc_count > 0:
            print(f"  {'[ACCEPTED]':<14}บันทึกข้อมูลผ่านเกณฑ์: {acc_path.name}")
        if rej_count > 0:
            print(f"  {'[REJECTED]':<14}บันทึกข้อมูลไม่ผ่านเกณฑ์: {rej_path.name}")

    return accepted_paths


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "SRC-044"
    validate_data(target)
