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


def run_single_pipeline(
    source_id: str = "SRC-033",
    force: bool = False,
    index: int = 1,
    total: int = 1,
) -> dict:
    """
    ฟังก์ชันสั่งรัน End-to-End Pipeline สำหรับชุดข้อมูล 1 รายการ
    """
    print("\n" + "=" * 70)
    print(f"[{index}/{total}] DATASET: {source_id}")
    print("=" * 70)

    # -------------------------------------------------------------
    # Step 1: Data Acquisition
    # -------------------------------------------------------------
    print(">>> STEP 1: DATA ACQUISITION")
    try:
        acq_result = acquire_source(source_id=source_id, force=force)
        if acq_result and acq_result.get("status") == "skipped":
            reason = acq_result.get("reason", "Not approved")
            print(f"\nSTATUS: STOPPED (ข้ามเนื่องจากไม่ได้รับอนุมัติใน Catalog)")
            print("=" * 70)
            return {
                "source_id": source_id,
                "status": "NOT APPROVED",
                "progress": "Step 1 (Stopped)",
                "details": reason,
            }
    except Exception as e:
        print(f"  [FAIL] Step 1 ล้มเหลว: {e}")
        print(f"\nSTATUS: FAILED (เกิดข้อผิดพลาดใน Step 1)")
        print("=" * 70)
        return {
            "source_id": source_id,
            "status": "FAILED",
            "progress": "Step 1 (Error)",
            "details": str(e),
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
        print(f"  [FAIL] Step 2 ล้มเหลว: {e}")
        print(f"\nSTATUS: FAILED (เกิดข้อผิดพลาดใน Step 2)")
        print("=" * 70)
        return {
            "source_id": source_id,
            "status": "FAILED",
            "progress": "Step 2 (Error)",
            "details": str(e),
        }

    # -------------------------------------------------------------
    # Step 3-5: Downstream (Transform, Validation, Canonicalization)
    # -------------------------------------------------------------
    print("\n>>> STEP 3-5: DOWNSTREAM")
    try:
        stage_and_transform(source_id=source_id)
    except Exception as e:
        print(f"  [WARN] Step 3: {e}")

    try:
        validate_data(source_id=source_id)
    except Exception as e:
        print(f"  [WARN] Step 4: {e}")

    try:
        canonicalize_data(source_id=source_id)
    except Exception as e:
        print(f"  [WARN] Step 5: {e}")

    print("-" * 70)
    print(f"STATUS: COMPLETED for {source_id} (Step 1-2 Done | Step 3-5 WIP)")
    print("=" * 70)

    return {
        "source_id": source_id,
        "status": "COMPLETED",
        "progress": "Step 1 -> 2",
        "details": f"Parsed {parsed_count} file(s)",
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
    print("\n" + "=" * 70)
    print(f"STARTING PIPELINE RUN: {total} DATASET(S)")
    print(f"Targets: {', '.join(targets)}")
    print("=" * 70)

    results = []
    for idx, sid in enumerate(targets, 1):
        res = run_single_pipeline(source_id=sid, force=force, index=idx, total=total)
        results.append(res)

    completed_cnt = sum(1 for r in results if r["status"] == "COMPLETED")
    skipped_cnt = sum(1 for r in results if r["status"] == "NOT APPROVED")
    failed_cnt = sum(1 for r in results if r["status"] == "FAILED")

    print("\n" + "=" * 70)
    print("PIPELINE EXECUTION SUMMARY")
    print("=" * 70)
    print(f"  {'#':<3} | {'Source ID':<12} | {'Status':<14} | {'Progress':<16} | {'Details'}")
    print("  " + "-" * 66)
    for i, r in enumerate(results, 1):
        sid = r["source_id"]
        st = r["status"]
        prog = r["progress"]
        det = r["details"]
        print(f"  {i:<3} | {sid:<12} | {st:<14} | {prog:<16} | {det}")
    print("=" * 70)
    print(f"  Total: {total} | Completed: {completed_cnt} | Skipped: {skipped_cnt} | Failed: {failed_cnt}")
    print("=" * 70 + "\n")


if __name__ == "__main__":
    args = sys.argv[1:]
    force = "--force" in args
    clean_args = [a for a in args if not a.startswith("--")]

    run_pipeline(source_ids=clean_args if clean_args else None, force=force)
