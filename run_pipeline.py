"""
=============================================================================
โปรแกรมสั่งการไปป์ไลน์แบบครบวงจร (End-to-End Pipeline Orchestrator)
=============================================================================
หน้าที่หลัก:
- เป็นตัวควบคุม (Orchestrator) สั่งรันขั้นตอน Step 1 ถึง Step 5 ต่อเนื่องกัน
- ตรวจสอบให้มั่นใจว่าจะประมวลผล "เฉพาะชุดข้อมูลที่ได้รับอนุมัติ (Approved Sources) เท่านั้น"
- รองรับการรันชุดข้อมูลเดียว, หลายชุดพร้อมกัน (เช่น SRC-043 SRC-001 SRC-045), หรือรันทั้งหมด
- แสดงผลสถานะการประมวลผลอย่างชัดเจน พร้อมตารางสรุปผลลัพธ์ภาพรวม
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

# นำเข้าโมดูลของแต่ละขั้นตอนในไปป์ไลน์ผ่าน src namespace
if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from acquisition.acquisition import acquire_source, get_approved_sources
from parsing.parsing import parse_raw_data
from transform.staging import stage_and_transform
from validation.validation import validate_data
from canonical.canonical import canonicalize_data

BANNER_WIDTH = 90


def run_single_pipeline(
    source_id: str = "SRC-033",
    force: bool = False,
    index: int = 1,
    total: int = 1,
) -> dict:
    """
    ฟังก์ชันสั่งรัน End-to-End Pipeline สำหรับชุดข้อมูล 1 รายการ
    """
    print("\n" + "=" * BANNER_WIDTH)
    print(f"[{index}/{total}] DATASET: {source_id}")
    print("=" * BANNER_WIDTH)

    # -------------------------------------------------------------
    # Step 1: Data Acquisition
    # -------------------------------------------------------------
    print(">>> STEP 1: DATA ACQUISITION")
    acq_count = 0
    try:
        acq_result = acquire_source(source_id=source_id, force=force)
        if acq_result and acq_result.get("status") == "skipped":
            reason = acq_result.get("reason", "Not approved")
            print(f"\nSTATUS: STOPPED (ข้ามเนื่องจากไม่ได้รับอนุมัติใน Catalog)\n")
            return {
                "source_id": source_id,
                "status": "NOT APPROVED",
                "progress": "Step 1 (Stopped)",
                "details": reason,
            }
        if acq_result and acq_result.get("status") == "failed":
            reason = acq_result.get("reason", "Extraction error")
            print(f"\nSTATUS: FAILED / OFFLINE ({reason}) - ดำเนินการต่อชุดข้อมูลถัดไป\n")
            return {
                "source_id": source_id,
                "status": "FAILED",
                "progress": "Step 1 (Offline)",
                "details": reason,
            }
        raw_files = list((PROJECT_ROOT / "data" / "raw").glob(f"{source_id}_*RAW.*"))
        acq_count = len(raw_files)
    except Exception as e:
        print(f"  {'[FAIL]':<10}Step 1 ล้มเหลว: {e}")
        print(f"\nSTATUS: FAILED (เกิดข้อผิดพลาดใน Step 1)\n")
        return {
            "source_id": source_id,
            "status": "FAILED",
            "progress": "Step 1 (Error)",
            "details": str(e).splitlines()[0],
        }

    # -------------------------------------------------------------
    # Step 2: Data Parsing
    # -------------------------------------------------------------
    print("\n>>> STEP 2: DATA PARSING")
    parsed_count = 0
    try:
        paths = parse_raw_data(source_id=source_id)
        parsed_count = len(paths)
    except Exception as e:
        print(f"  {'[FAIL]':<10}Step 2 ล้มเหลว: {e}")
        print(f"\nSTATUS: FAILED (เกิดข้อผิดพลาดใน Step 2)\n")
        return {
            "source_id": source_id,
            "status": "FAILED",
            "progress": "Step 2 (Error)",
            "details": str(e).splitlines()[0],
        }

    # -------------------------------------------------------------
    # Step 3: Transform & Staging
    # -------------------------------------------------------------
    print("\n>>> STEP 3: TRANSFORM & STAGING")
    step3_ok = False
    staged_msg = ""
    staged_count = 0
    try:
        res_paths = stage_and_transform(source_id=source_id)
        staged_paths = res_paths if isinstance(res_paths, list) else [res_paths]
        step3_ok = True
        staged_count = len(staged_paths)
        staged_msg = f"Staged {staged_count} file(s)"
    except Exception as e:
        print(f"  {'[WARN]':<10}Step 3: {e}")
        staged_msg = f"Step 3 Failed: {str(e).splitlines()[0]}"

    # -------------------------------------------------------------
    # Step 4: Data Validation
    # -------------------------------------------------------------
    print("\n>>> STEP 4: DATA VALIDATION")
    step4_ok = False
    acc_count = 0
    try:
        acc_paths = validate_data(source_id=source_id)
        step4_ok = True
        acc_count = len(acc_paths)
    except Exception as e:
        print(f"  {'[WARN]':<10}Step 4: {e}")

    # คำนวณความคืบหน้าของไปป์ไลน์จริง
    if step4_ok and step3_ok:
        progress_str = "Step 1 -> 4"
        status_sub = "Validated & Accepted"
        details_str = f"Acquired {acq_count} | Parsed {parsed_count} | Staged {staged_count} | Accepted {acc_count} file(s)"
    elif step3_ok:
        progress_str = "Step 1 -> 3"
        status_sub = "Staged (Validation Pending)"
        details_str = f"Acquired {acq_count} | Parsed {parsed_count} | Staged {staged_count} file(s)"
    else:
        progress_str = "Step 1 -> 2"
        status_sub = "Parsed"
        details_str = f"Acquired {acq_count} | Parsed {parsed_count} file(s) | {staged_msg}"

    print(f"\nSTATUS: COMPLETED for {source_id} ({status_sub})\n")

    return {
        "source_id": source_id,
        "status": "COMPLETED",
        "progress": progress_str,
        "details": details_str,
    }


def run_pipeline(source_ids: list[str] | str = None, force: bool = False):
    """
    ควบคุมการรัน Pipeline แบบครบวงจร พร้อมสรุปผลท้ายสุด
    """
    if source_ids:
        targets = [source_ids] if isinstance(source_ids, str) else source_ids
    else:
        targets = get_approved_sources()

    total = len(targets)
    print("\n" + "=" * BANNER_WIDTH)
    print(f"STARTING PIPELINE RUN: {total} DATASET(S)")
    print(f"Targets: {', '.join(targets)}")
    print("=" * BANNER_WIDTH)

    results = []
    for idx, sid in enumerate(targets, 1):
        res = run_single_pipeline(source_id=sid, force=force, index=idx, total=total)
        results.append(res)

    # -------------------------------------------------------------
    # Step 5: Final Canonicalization & Database Assembly
    # -------------------------------------------------------------
    print("\n" + "=" * BANNER_WIDTH)
    print(">>> STEP 5: FINAL CANONICALIZATION & RELATIONAL DATABASE ASSEMBLY")
    print("=" * BANNER_WIDTH)
    canonical_res = None
    try:
        canonical_res = canonicalize_data()
    except Exception as e:
        print(f"  {'[FAIL]':<10}Step 5 ล้มเหลว: {e}")

    completed_cnt = sum(1 for r in results if r["status"] == "COMPLETED")
    skipped_cnt = sum(1 for r in results if r["status"] == "NOT APPROVED")
    failed_cnt = sum(1 for r in results if r["status"] == "FAILED")

    print("\n" + "=" * BANNER_WIDTH)
    print("PIPELINE EXECUTION SUMMARY")
    print("=" * BANNER_WIDTH)
    print(f"  {'#':<3} | {'Source ID':<12} | {'Status':<14} | {'Progress':<16} | {'Details'}")
    print("  " + "-" * (BANNER_WIDTH - 4))
    for i, r in enumerate(results, 1):
        sid = r["source_id"]
        st = r["status"]
        prog = r["progress"]
        det = r["details"]
        print(f"  {i:<3} | {sid:<12} | {st:<14} | {prog:<16} | {det}")
    print("=" * BANNER_WIDTH)
    print(f"  Total: {total} | Completed: {completed_cnt} | Skipped: {skipped_cnt} | Failed: {failed_cnt}")

    if canonical_res and "table_counts" in canonical_res:
        print("-" * BANNER_WIDTH)
        print("  LCI RELATIONAL DATABASE STATUS (sql/lci_database.sqlite & data/database_export/)")
        print("-" * BANNER_WIDTH)
        for tbl, cnt in canonical_res["table_counts"].items():
            print(f"  - Table {tbl:<18}: {cnt:>8,} records")

    print("=" * BANNER_WIDTH + "\n")


if __name__ == "__main__":
    args = sys.argv[1:]
    force = "--force" in args
    clean_args = [a for a in args if not a.startswith("--")]

    run_pipeline(source_ids=clean_args if clean_args else None, force=force)
