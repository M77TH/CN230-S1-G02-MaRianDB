"""
=============================================================================
โปรแกรมสั่งการไปป์ไลน์แบบครบวงจร (End-to-End Pipeline Orchestrator)
=============================================================================
หน้าที่หลัก:
- เป็นตัวควบคุม (Orchestrator) สั่งรันขั้นตอน Step 1 ถึง Step 5 ต่อเนื่องกัน
- ตรวจสอบให้มั่นใจว่าจะประมวลผล "เฉพาะชุดข้อมูลที่ได้รับอนุมัติ (Approved Sources) เท่านั้น"
- เมื่อโค้ด Step 2 ถึง Step 5 พัฒนาเสร็จสมบูรณ์ ทุกขั้นตอนจะเชื่อมต่อกันอัตโนมัติ
=============================================================================
"""

import sys
from pathlib import Path

# ป้องกันปัญหาภาษาไทยใน Console ของ Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

PROJECT_ROOT = Path(__file__).resolve().parent
SRC_DIR = PROJECT_ROOT / "src"

# นำเข้าโมดูลของแต่ละขั้นตอนในไปป์ไลน์ผ่าน src namespace
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from acquisition.acquisition import acquire_source, get_approved_sources
from parsing.parsing import parse_raw_data
from transform.staging import stage_and_transform
from validation.validation import validate_data
from canonical.canonical import canonicalize_data


def run_single_pipeline(source_id: str = "SRC-033", force: bool = False) -> bool:
    """
    ฟังก์ชันสั่งรัน End-to-End Pipeline สำหรับชุดข้อมูล 1 รายการ:
    Step 1 (Acquisition) -> Step 2 (Parsing) -> Step 3 (Staging) -> Step 4 (Validation) -> Step 5 (Canonicalization)
    """
    print("\n" + "=" * 60)
    print(f"[START] เริ่มต้นการทำงาน Data Pipeline แบบ End-to-End")
    print(f"[TARGET] Source ID: {source_id}")
    print("=" * 60)

    # -------------------------------------------------------------
    # Step 1: Data Acquisition (Approved Only + Clean Strategy)
    # ผลลัพธ์: data/raw/ และ data/raw/_provenance_ledger.jsonl
    # -------------------------------------------------------------
    print("\n[GATE G1-G3] >>> STEP 1: DATA ACQUISITION")
    try:
        acq_result = acquire_source(source_id=source_id, force=force)
        # หากชุดข้อมูลนี้ไม่ผ่านการอนุมัติ (ถูก skip) ให้ยุติการประมวลผลทันที
        if acq_result and acq_result.get("status") == "skipped":
            print(f"[STOP] ชุดข้อมูล {source_id} ไม่ได้รับอนุมัติ (Not Approved) -> ยุติไปป์ไลน์")
            return False
    except Exception as e:
        print(f"[FAIL] Step 1 ล้มเหลว: {e}")
        return False

    # -------------------------------------------------------------
    # Step 2: Data Parsing [WIP]
    # ผลลัพธ์: data/parsed/<source_id>_PARSED_RAW.csv
    # -------------------------------------------------------------
    print("\n[GATE G4] >>> STEP 2: DATA PARSING")
    try:
        parse_raw_data(source_id=source_id)
    except Exception as e:
        print(f"[WARN] Step 2: {e}")

    # -------------------------------------------------------------
    # Step 3: Transform & Staging [WIP]
    # ผลลัพธ์: data/staging/<source_id>_STG.csv
    # -------------------------------------------------------------
    print("\n[GATE G5] >>> STEP 3: TRANSFORM & STAGING")
    try:
        stage_and_transform(source_id=source_id)
    except Exception as e:
        print(f"[WARN] Step 3: {e}")

    # -------------------------------------------------------------
    # Step 4: Data Validation [WIP]
    # ผลลัพธ์: data/accepted/ หรือ data/rejected/
    # -------------------------------------------------------------
    print("\n[GATE G6] >>> STEP 4: DATA VALIDATION")
    try:
        validate_data(source_id=source_id)
    except Exception as e:
        print(f"[WARN] Step 4: {e}")

    # -------------------------------------------------------------
    # Step 5: Canonicalization [WIP]
    # ผลลัพธ์: นำเข้า Data Warehouse
    # -------------------------------------------------------------
    print("\n[GATE G7] >>> STEP 5: CANONICALIZATION")
    try:
        canonicalize_data(source_id=source_id)
    except Exception as e:
        print(f"[WARN] Step 5: {e}")

    print("\n" + "=" * 60)
    print(f"[DONE] สิ้นสุดการทำงาน Pipeline สำหรับ {source_id}")
    print("=" * 60 + "\n")
    return True


def run_pipeline(source_id: str = None, force: bool = False):
    """
    ควบคุมการรัน Pipeline:
    - ถ้าระบุ source_id: รันเฉพาะชุดข้อมูลนั้น
    - ถ้าไม่ระบุ source_id: รันทุกชุดข้อมูลที่ได้รับอนุมัติ (Approved Sources) ทั้งหมด
    """
    if source_id:
        run_single_pipeline(source_id=source_id, force=force)
    else:
        approved_list = get_approved_sources()
        print("\n" + "=" * 60)
        print(f"[INFO] สั่งรัน Pipeline สำหรับชุดข้อมูลที่ผ่านการอนุมัติทั้งหมด {len(approved_list)} รายการ:")
        print(f"       {', '.join(approved_list)}")
        print("=" * 60)
        for sid in approved_list:
            run_single_pipeline(source_id=sid, force=force)


if __name__ == "__main__":
    args = sys.argv[1:]
    force = "--force" in args
    clean_args = [a for a in args if not a.startswith("--")]
    
    target = clean_args[0] if clean_args else None
    run_pipeline(source_id=target, force=force)
