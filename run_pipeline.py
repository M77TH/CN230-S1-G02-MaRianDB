"""
=============================================================================
โปรแกรมสั่งการไปป์ไลน์แบบครบวงจร (End-to-End Pipeline Orchestrator: Step 01 - 07)
=============================================================================
สอดคล้องกับแนวคิดหลักของรายวิชา CN230 (Source to Validated LCI Schema):
- [01/06] Source Discovery   : คัดกรองแหล่งข้อมูลที่ได้รับอนุมัติจาก docs/source_registry/
- [02/06] Raw Acquisition    : ดึงไฟล์ดิบและบันทึก SHA-256 ลง data/raw/
- [03/06] Parsing            : สกัดตารางโครงสร้างเดิมลง data/parsed/
- [04/06] Staging            : คลีนข้อมูลเฉพาะแหล่ง + แปะ Provenance ลง data/staging/
- [05/06] Data Mapping       : แปลงฟิลด์เข้าสู่โครงสร้างกลาง LCI + ปันส่วน ISO 14044 ลง data/mapping/
- [06/06] Validation         : ตรวจ 7 กฎคุณภาพ (QC) คัดแยกเข้า data/validation/accepted/ & rejected/

- [07/07] Database          : โหลดเข้า MySQL 10 ตาราง (ต้องมี .env; --no-db = ข้าม, --yes = ไม่ถามก่อน DROP ตาราง)
=============================================================================
"""

import sys
from pathlib import Path

# ป้องกันปัญหาภาษาไทยใน Console ของ Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8", line_buffering=True)
        sys.stderr.reconfigure(encoding="utf-8", line_buffering=True)
    except Exception:
        pass

PROJECT_ROOT = Path(__file__).resolve().parent
SRC_DIR = PROJECT_ROOT / "src"

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from acquisition.acquisition import acquire_source, get_approved_sources
from parsing.parsing import parse_raw_data
from staging.staging import stage_data
from mapping.mapping import map_data
from validation.validation import validate_data
from database.database import run as run_database_step

BANNER_WIDTH = 95


def run_single_pipeline(
    source_id: str = "SRC-044",
    force: bool = False,
    index: int = 1,
    total: int = 1,
) -> dict:
    """
    สั่งรันไปป์ไลน์รายแหล่งข้อมูลตั้งแต่ Step 02 ถึง Step 06
    """
    print("\n" + "=" * BANNER_WIDTH)
    print(f"[{index}/{total}] DATASET: {source_id}")
    print("=" * BANNER_WIDTH)

    # -------------------------------------------------------------
    # Step 02: Raw Acquisition (เก็บดิบ)
    # -------------------------------------------------------------
    print(">>> [STEP 02/06] RAW ACQUISITION (เก็บไฟล์ดิบ + SHA-256 -> data/raw/)")
    acq_count = 0
    try:
        acq_result = acquire_source(source_id=source_id, force=force)
        if acq_result and acq_result.get("status") == "skipped":
            reason = acq_result.get("reason", "Not approved")
            print(f"\nSTATUS: STOPPED (ข้ามเนื่องจากไม่ได้รับอนุมัติใน Source Registry)\n")
            return {
                "source_id": source_id,
                "status": "NOT APPROVED",
                "progress": "Step 01 (Stopped)",
                "details": reason,
            }
        if acq_result and acq_result.get("status") == "failed":
            reason = acq_result.get("reason", "Extraction error")
            print(f"\nSTATUS: FAILED / OFFLINE ({reason}) - ดำเนินการต่อชุดข้อมูลถัดไป\n")
            return {
                "source_id": source_id,
                "status": "FAILED",
                "progress": "Step 02 (Offline)",
                "details": reason,
            }
        raw_files = list((PROJECT_ROOT / "data" / "raw").glob(f"{source_id}_*RAW.*"))
        acq_count = len(raw_files)
    except Exception as e:
        print(f"  {'[FAIL]':<10}Step 02 ล้มเหลว: {e}")
        return {
            "source_id": source_id,
            "status": "FAILED",
            "progress": "Step 02 (Error)",
            "details": str(e).splitlines()[0],
        }

    # -------------------------------------------------------------
    # Step 03: Parsing (อ่านรูปแบบ)
    # -------------------------------------------------------------
    print("\n>>> [STEP 03/06] PARSING (อ่านรูปแบบตารางต้นฉบับ -> data/parsed/)")
    parsed_count = 0
    try:
        paths = parse_raw_data(source_id=source_id)
        parsed_count = len(paths)
    except Exception as e:
        print(f"  {'[FAIL]':<10}Step 03 ล้มเหลว: {e}")
        return {
            "source_id": source_id,
            "status": "FAILED",
            "progress": "Step 03 (Error)",
            "details": str(e).splitlines()[0],
        }

    # -------------------------------------------------------------
    # Step 04: Staging (ตารางชั่วคราวเฉพาะแหล่ง + Provenance)
    # -------------------------------------------------------------
    print("\n>>> [STEP 04/06] STAGING (ตารางชั่วคราวเฉพาะแหล่ง + Provenance -> data/staging/)")
    staged_count = 0
    try:
        staged_paths = stage_data(source_id=source_id)
        staged_count = len(staged_paths)
    except Exception as e:
        print(f"  {'[FAIL]':<10}Step 04 ล้มเหลว: {e}")
        return {
            "source_id": source_id,
            "status": "FAILED",
            "progress": "Step 04 (Error)",
            "details": str(e).splitlines()[0],
        }

    # -------------------------------------------------------------
    # Step 05: Mapping (แปลงเข้าโครงสร้างกลาง & ปันส่วน 1 FU)
    # -------------------------------------------------------------
    print("\n>>> [STEP 05/06] MAPPING (แปลงสู่โครงสร้างกลาง LCI + ปันส่วน ISO 14044 -> data/mapping/)")
    mapped_count = 0
    try:
        mapped_paths = map_data(source_id=source_id)
        mapped_count = len(mapped_paths)
    except Exception as e:
        print(f"  {'[FAIL]':<10}Step 05 ล้มเหลว: {e}")
        return {
            "source_id": source_id,
            "status": "FAILED",
            "progress": "Step 05 (Error)",
            "details": str(e).splitlines()[0],
        }

    # -------------------------------------------------------------
    # Step 06: Validation (ตรวจกฎคุณภาพ 7 ข้อ)
    # -------------------------------------------------------------
    print("\n>>> [STEP 06/06] VALIDATION (ตรวจกฎ QC 7 ข้อ -> data/validation/accepted/ & rejected/)")
    acc_count = 0
    try:
        acc_paths = validate_data(source_id=source_id)
        acc_count = len(acc_paths)
    except Exception as e:
        print(f"  {'[FAIL]':<10}Step 06 ล้มเหลว: {e}")
        return {
            "source_id": source_id,
            "status": "FAILED",
            "progress": "Step 06 (Error)",
            "details": str(e).splitlines()[0],
        }

    progress_str = "Step 01 -> 06"
    details_str = (
        f"Raw {acq_count} | Parsed {parsed_count} | Staged {staged_count} | "
        f"Mapped {mapped_count} | Valid {acc_count}"
    )

    print(f"\nSTATUS: COMPLETED for {source_id} (Validated)\n")

    return {
        "source_id": source_id,
        "status": "COMPLETED",
        "progress": progress_str,
        "details": details_str,
    }


def run_pipeline(source_ids: list[str] | str = None, force: bool = False, to_db: bool = True, yes: bool = False):
    """
    ควบคุมการรัน Pipeline ตั้งแต่ Step 01 ถึง Step 07 (to_db=False = หยุดที่ Step 06)
    """
    print("\n" + "=" * BANNER_WIDTH)
    print(">>> [STEP 01/06] SOURCE DISCOVERY (สำรวจและคัดกรองแหล่งข้อมูลจาก docs/source_registry/)")
    print("=" * BANNER_WIDTH)

    approved_list = get_approved_sources()
    if source_ids:
        targets = [source_ids] if isinstance(source_ids, str) else source_ids
    else:
        targets = approved_list
    # SRC-047 (PTTEP) ต้องผ่านก่อน เพราะ SRC-044/045/046 ใช้ปันส่วนภาระมลพิษจากมัน
    targets = sorted(targets, key=lambda x: x != "SRC-047")

    total = len(targets)
    print(f"  {'[CATALOG]':<14}Approved Sources in Registry : {', '.join(approved_list)}")
    print(f"  {'[TARGETS]':<14}Selected for Pipeline Run ({total}) : {', '.join(targets)}")

    results = []
    for idx, sid in enumerate(targets, 1):
        res = run_single_pipeline(source_id=sid, force=force, index=idx, total=total)
        results.append(res)

    completed_cnt = sum(1 for r in results if r["status"] == "COMPLETED")
    skipped_cnt = sum(1 for r in results if r["status"] == "NOT APPROVED")
    failed_cnt = sum(1 for r in results if r["status"] == "FAILED")

    print("\n" + "=" * BANNER_WIDTH)
    print("PIPELINE EXECUTION SUMMARY (STEP 01 - 06: SOURCE TO VALIDATION)")
    print("=" * BANNER_WIDTH)
    print(f"  {'#':<3} | {'Source ID':<10} | {'Status':<12} | {'Progress':<15} | {'Details'}")
    print("  " + "-" * (BANNER_WIDTH - 4))
    for i, r in enumerate(results, 1):
        sid = r["source_id"]
        st = r["status"]
        prog = r["progress"]
        det = r["details"]
        print(f"  {i:<3} | {sid:<10} | {st:<12} | {prog:<15} | {det}")
    print("=" * BANNER_WIDTH)
    print(f"  Total: {total} | Completed: {completed_cnt} | Skipped: {skipped_cnt} | Failed: {failed_cnt}")
    print("-" * BANNER_WIDTH)
    print("  [OUTPUT] ผลลัพธ์ข้อมูลที่ผ่านการตรวจสอบคุณภาพ:")
    print("  - ข้อมูลผ่านเกณฑ์ (Accepted) : data/validation/accepted/*_VALID.csv")
    print("  - ข้อมูลกักกัน (Rejected)   : data/validation/rejected/*_ERR.csv")
    print("=" * BANNER_WIDTH + "\n")

    # Step 07: Database (โหลดเข้า MySQL) ข้ามถ้ามีแหล่งล้มเหลว เพื่อไม่โหลดข้อมูลที่ไม่ครบ
    if not to_db:
        print(">>> [STEP 07/07] ข้าม (--no-db) รันเองได้ด้วย: python src/database/database.py\n")
    elif failed_cnt:
        print(f">>> [STEP 07/07] ข้าม: มี {failed_cnt} แหล่งล้มเหลว แก้แล้วรัน pipeline ใหม่ หรือรัน python src/database/database.py เอง\n")
    else:
        try:
            run_database_step("all", yes)
        except (SystemExit, Exception) as e:  # เช่น ไม่มี .env, ต่อ MySQL ไม่ได้, ผู้ใช้ไม่ยืนยัน
            print(f"  {'[FAIL]':<10}Step 07 ไม่สำเร็จ: {e} (ข้อมูลใน data/ ยังครบ รัน python src/database/database.py ใหม่ได้)\n")


if __name__ == "__main__":
    args = sys.argv[1:]
    force = "--force" in args
    clean_args = [a for a in args if not a.startswith("--")]

    run_pipeline(source_ids=clean_args if clean_args else None, force=force,
                 to_db="--no-db" not in args, yes="--yes" in args)
