"""
=============================================================================
โปรแกรมสั่งการไปป์ไลน์แบบครบวงจร (End-to-End Pipeline Orchestrator: Step 01 - 07)
=============================================================================
สอดคล้องกับแนวคิดหลักของรายวิชา CN230 (Source to Validated LCI Schema):
- [01/06] Source Discovery   : คัดกรองแหล่งข้อมูลที่ได้รับอนุมัติจาก docs/source_registry/
- [02/06] Raw Acquisition    : ดึงไฟล์ดิบและบันทึก SHA-256 ลง data/raw/
- [03/06] Parsing            : สกัดตารางโครงสร้างเดิมลง data/parsed/
- [04/06] Staging            : คลีนข้อมูลเฉพาะแหล่ง + แปะ Provenance ลง data/staging/
- [05/06] Data Mapping       : แปลงฟิลด์เข้าสู่โครงสร้างกลาง LCI + ปันส่วนภาระ ลง data/mapping/
- [06/06] Validation         : ตรวจ 7 กฎคุณภาพ (QC) คัดแยกเข้า data/validation/accepted/ & rejected/

- [07/07] Database           : บันทึกฐานข้อมูล 10 ตารางตาม ERD ลง data/database/csv/, data/database/xlsx/, SQLite และ MySQL (--no-db = ข้าม)
=============================================================================
"""

import argparse
import os
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
DATA_ROOT = Path(os.environ.get("CN230_DATA_DIR", PROJECT_ROOT / "data")).resolve()
try:
    DATA_PATH_LABEL = DATA_ROOT.relative_to(PROJECT_ROOT).as_posix()
except ValueError:
    DATA_PATH_LABEL = str(DATA_ROOT)

if str(SRC_DIR) not in sys.path:
    sys.path.insert(0, str(SRC_DIR))

from acquisition.acquisition import acquire_source, get_approved_sources
from parsing.parsing import parse_raw_data
from staging.staging import stage_data
from mapping.mapping import (
    AllocationBlocked, UPSTREAM_ALLOCATION_SOURCES, UPSTREAM_PRODUCTION_SOURCES, map_data,
)
from validation.validation import get_rejected_output_path, validate_data
from database.database import run as run_database_step

BLOCKED_EXIT_CODE = 3

BANNER_WIDTH = 95


def run_single_pipeline(
    source_id: str = "SRC-044",
    force: bool = False,
    index: int = 1,
    total: int = 1,
    defer_mapping_validation: bool = False,
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
    print(f">>> [STEP 02/06] RAW ACQUISITION (เก็บไฟล์ดิบ + SHA-256 -> {DATA_PATH_LABEL}/raw/)")
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
        raw_files = list((DATA_ROOT / "raw").glob(f"{source_id}_*RAW.*"))
        acquired_path = (acq_result or {}).get("raw_file_path") or (acq_result or {}).get("file_path")
        if acquired_path and source_id != "SRC-043":
            # A portable ledger may retain the path from the machine that downloaded it.
            raw_name = Path(str(acquired_path).replace("\\", "/")).name
            raw_files = [DATA_ROOT / "raw" / raw_name]
        acq_count = len(raw_files)
    except Exception as e:
        print(f"  {'[FAIL]':<10}Step 02 ล้มเหลว: {e}")
        return {
            "source_id": source_id,
            "status": "FAILED",
            "progress": "Step 02 (Error)",
            "details": str(e).partition("\n")[0] or type(e).__name__,
        }

    # -------------------------------------------------------------
    # Step 03-06: Parsing -> Staging -> Mapping -> Validation
    # -------------------------------------------------------------
    step_counts = {}
    mapped = []
    validated = []
    parsed = []
    staged = []
    stages = [
        ("03", f"PARSING (อ่านรูปแบบตารางต้นฉบับ -> {DATA_PATH_LABEL}/parsed/)", parse_raw_data),
        ("04", f"STAGING (ตารางชั่วคราวเฉพาะแหล่ง + Provenance -> {DATA_PATH_LABEL}/staging/)", stage_data),
    ]
    if not defer_mapping_validation:
        stages.extend([
            ("05", f"MAPPING (แปลงสู่โครงสร้างกลาง LCI + ปันส่วนภาระ -> {DATA_PATH_LABEL}/mapping/)", map_data),
            ("06", f"VALIDATION (ตรวจกฎ QC 7 ข้อ -> {DATA_PATH_LABEL}/validation/accepted/ & rejected/)", validate_data),
        ])
    for step_num, step_desc, step_fn in stages:
        print(f"\n>>> [STEP {step_num}/06] {step_desc}")
        try:
            if step_num == "03":
                paths = parsed = step_fn(source_id, raw_files=raw_files)
            elif step_num == "04":
                paths = staged = step_fn(source_id, parsed_files=parsed)
            elif step_num == "05":
                paths = mapped = step_fn(source_id, staged_files=staged)
            else:
                paths = validated = step_fn(source_id, mapped_files=mapped)
            step_counts[step_num] = len(paths)
            if not paths:
                raise ValueError(f"{source_id}: ไม่มีผลลัพธ์ของ Step {step_num}")
        except Exception as e:
            print(f"  {'[FAIL]':<10}Step {step_num} ล้มเหลว: {e}")
            return {
                "source_id": source_id,
                "status": "FAILED",
                "progress": f"Step {step_num} (Error)",
                "details": str(e).partition("\n")[0] or type(e).__name__,
            }

    if defer_mapping_validation:
        progress_str = "Step 01 -> 04 (mapping deferred)"
        details_str = f"Raw {acq_count} | Parsed {step_counts['03']} | Staged {step_counts['04']}"
        print(f"\nSTATUS: STAGED for {source_id} (mapping waits for selected upstream sources)\n")
    else:
        progress_str = "Step 01 -> 06"
        details_str = (
            f"Raw {acq_count} | Parsed {step_counts['03']} | Staged {step_counts['04']} | "
            f"Mapped {step_counts['05']} | Valid {step_counts['06']}"
        )
        print(f"\nSTATUS: COMPLETED for {source_id} (Validated)\n")

    return {
        "source_id": source_id,
        "status": "STAGED" if defer_mapping_validation else "COMPLETED",
        "progress": progress_str,
        "details": details_str,
        "mapped": mapped,
        "accepted": validated,
    }


def run_pipeline(source_ids: list[str] | str | None = None, force: bool = False, to_db: bool = True) -> int:
    """
    ควบคุมการรัน Pipeline ตั้งแต่ Step 01 ถึง Step 07 (to_db=False = หยุดที่ Step 06)
    """
    print("\n" + "=" * BANNER_WIDTH)
    print(">>> [STEP 01/06] SOURCE DISCOVERY (สำรวจและคัดกรองแหล่งข้อมูลจาก docs/source_registry/)")
    print("=" * BANNER_WIDTH)

    def _normalize_source_id(source_id: str) -> str:
        """Normalize shorthand source IDs (e.g. src-55 -> SRC-055) for CLI compatibility."""
        cleaned = source_id.strip().upper()
        if cleaned.startswith("SRC-") and cleaned[4:].isdigit():
            return f"SRC-{int(cleaned[4:]):03d}"
        return cleaned

    approved_list = get_approved_sources()
    if source_ids:
        raw_targets = [source_ids] if isinstance(source_ids, str) else source_ids
        targets = list(dict.fromkeys(_normalize_source_id(sid) for sid in raw_targets))
    else:
        targets = approved_list
    # Keep source execution in registry ID order (SRC-044, SRC-045, ...).
    targets = sorted(targets)

    total = len(targets)
    print(f"  {'[CATALOG]':<14}Approved Sources in Registry : {', '.join(approved_list)}")
    print(f"  {'[TARGETS]':<14}Selected for Pipeline Run ({total}) : {', '.join(targets)}")

    results = [
        run_single_pipeline(
            source_id=sid,
            force=force,
            index=idx,
            total=total,
            defer_mapping_validation=sid in UPSTREAM_PRODUCTION_SOURCES,
        )
        for idx, sid in enumerate(targets, 1)
    ]

    # A failed input selected for this run must never fall back to a previous copy.
    failed_inputs = [
        r["source_id"] for r in results
        if r["source_id"] in UPSTREAM_ALLOCATION_SOURCES and r["status"] not in {"STAGED", "COMPLETED"}
    ]
    for r in results:
        if r["status"] != "STAGED":
            continue
        sid = r["source_id"]
        step = "05"
        try:
            print(f"\n>>> [STEP 05/06] MAPPING {sid}")
            if failed_inputs:
                raise AllocationBlocked(f"ต้องรันแหล่งที่ไม่สำเร็จใหม่: {', '.join(failed_inputs)}")
            mapped = map_data(source_id=sid)
            step = "06"
            print(f">>> [STEP 06/06] VALIDATION {sid}")
            validated = validate_data(source_id=sid, mapped_files=mapped)
            r.update(status="COMPLETED", progress="Step 01 -> 06", mapped=mapped, accepted=validated)
            r["details"] += f" | Mapped {len(mapped)} | Valid {len(validated)}"
            print(f"  STATUS: VALIDATED {sid}")
        except AllocationBlocked as e:
            r.update(status="BLOCKED", progress="Step 05 (Blocked)", details=str(e))
            print(f"  [BLOCKED] {sid}: {e}")
        except Exception as e:
            r.update(status="FAILED", progress=f"Step {step} (Error)", details=str(e).partition("\n")[0] or type(e).__name__)
            print(f"  [FAIL] Step {step} {sid}: {e}")

    completed_cnt = sum(1 for r in results if r["status"] == "COMPLETED")
    skipped_cnt = sum(1 for r in results if r["status"] == "NOT APPROVED")
    failed_cnt = sum(1 for r in results if r["status"] == "FAILED")
    blocked_cnt = sum(1 for r in results if r["status"] == "BLOCKED")

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
    print(f"  Total: {total} | Completed: {completed_cnt} | Skipped: {skipped_cnt} | Blocked: {blocked_cnt} | Failed: {failed_cnt}")
    print("-" * BANNER_WIDTH)
    print("=" * BANNER_WIDTH + "\n")

    if failed_cnt or skipped_cnt:
        print("[NOTICE] ข้าม Database เพราะแหล่งที่ขอรันไม่สำเร็จ")
        return 1
    if blocked_cnt:
        print("[NOTICE] ข้าม Database เพราะยังรอข้อมูลสำหรับ Allocation")
        return BLOCKED_EXIT_CODE
    if not completed_cnt:
        print("[FAIL] ไม่มีแหล่งข้อมูลที่ประมวลผลสำเร็จ")
        return 1
    if not to_db:
        print("[NOTICE] ข้าม Database ตามตัวเลือก --no-db")
        return 0

    accepted = [path for result in results for path in result["accepted"]]
    rejected = [
        path for result in results for mapped in result["mapped"]
        if (path := get_rejected_output_path(mapped)).is_file()
    ]

    print(">>> [STEP 07/07] DATABASE LOAD & EXPORT")
    try:
        run_database_step("all", accepted_files=accepted, rejected_files=rejected)
    except (SystemExit, Exception) as e:
        print(f"  [FAIL] Step 07 ไม่สำเร็จ: {e}")
        return 1
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="End-to-End LCI Data Pipeline (Steps 01-07)")
    parser.add_argument("source_ids", nargs="*", help="รหัสแหล่งข้อมูลที่ต้องการรัน (ค่าเริ่มต้น: รันทุกแหล่งที่ approved)")
    parser.add_argument("--force", action="store_true", help="บังคับดาวน์โหลดไฟล์ดิบใหม่ทั้งหมด")
    parser.add_argument("--no-db", action="store_true", help="ข้าม Step 07 (Database export/load)")
    parsed = parser.parse_args()

    sys.exit(run_pipeline(
        source_ids=parsed.source_ids or None,
        force=parsed.force,
        to_db=not parsed.no_db,
    ))
