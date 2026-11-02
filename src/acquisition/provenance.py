"""
=============================================================================
ระบบจัดการสมุดคุมประวัติข้อมูล (Data Provenance & Audit Ledger)
=============================================================================
หน้าที่หลักของไฟล์นี้ (อ้างอิงตามมาตรฐาน CN230 Guideline Notebook):
1. get_bkk_timestamp()      -> สร้างเวลามาตรฐานประเทศไทย ISO 8601 (+07:00)
2. get_utc_timestamp()      -> สร้างเวลามาตรฐานสากล UTC ISO 8601
3. generate_batch_id()      -> สร้างรหัส Batch ID อัตโนมัติสำหรับแต่ละรอบการดึง
4. compute_sha256()         -> คำนวณค่าแฮช SHA-256 เพื่อยืนยันว่าไฟล์ไม่ถูกดัดแปลง (100% Immutable)
5. record_provenance()      -> บันทึกประวัติการได้มาของไฟล์ลงใน _provenance_ledger.jsonl
6. load_raw_metadata()      -> ใช้ค้นหาประวัติและ Metadata ของไฟล์ดิบสำหรับ Step อื่นๆ
7. verify_raw_integrity()   -> ตรวจสอบความถูกต้องว่าไฟล์ดิบถูกใครแอบแก้หรือไม่
=============================================================================
"""

import hashlib
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

# ป้องกันปัญหาภาษาไทยใน Console ของ Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

# กำหนดโซนเวลาประเทศไทย (+07:00) ตามมาตรฐาน ISO 8601
BKK_TZ = timezone(timedelta(hours=7))


def get_bkk_timestamp() -> str:
    """คืนค่าเวลาปัจจุบันในรูปแบบ ISO 8601 (+07:00) เช่น '2026-10-26T19:30:00+07:00'"""
    return datetime.now(BKK_TZ).isoformat(timespec="seconds")


def get_utc_timestamp() -> str:
    """คืนค่าเวลาปัจจุบันในรูปแบบ UTC ISO 8601 ตามมาตรฐาน Guideline Notebook"""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def generate_batch_id(source_id: str) -> str:
    """สร้างรหัสเฉพาะสำหรับการดึงข้อมูลแต่ละรอบ เช่น 'BATCH-20261026-193000-SRC-001'"""
    ts_str = datetime.now(BKK_TZ).strftime("%Y%m%d-%H%M%S")
    return f"BATCH-{ts_str}-{source_id}"


def compute_sha256(file_path: str) -> str:
    """อ่านไฟล์แบบ Binary และคำนวณ Checksum SHA-256"""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


def record_provenance(
    source_id: str,
    raw_file_path: str,
    source_url: str,
    page_or_table: str = "petroleum_report",
    extraction_method: str = "direct_download",
    http_status: int = 200,
) -> dict:
    """
    บันทึก Metadata การได้มาของไฟล์ลงในไฟล์ _provenance_ledger.jsonl
    ครอบคลุมฟิลด์ตาม CN230 Guideline: URL, Timestamp (BKK & UTC), HTTP Status, Bytes, SHA-256, Raw File
    """
    abs_path = os.path.abspath(raw_file_path)
    raw_dir = os.path.dirname(abs_path)
    ledger_path = os.path.join(raw_dir, "_provenance_ledger.jsonl")

    file_bytes = os.path.getsize(abs_path) if os.path.exists(abs_path) else 0
    checksum = compute_sha256(abs_path)

    receipt = {
        "extraction_batch_id": generate_batch_id(source_id),
        "source_id": source_id,
        "accessed_at": get_bkk_timestamp(),
        "retrieved_at_utc": get_utc_timestamp(),
        "http_status": http_status,
        "source_url": source_url,
        "page_or_table": page_or_table,
        "extraction_method": extraction_method,
        "raw_file_path": abs_path,
        "bytes": file_bytes,
        "sha256_checksum": checksum,
        "status": "ACQUIRED",
    }

    with open(ledger_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(receipt, ensure_ascii=False) + "\n")

    print(
        f"  {'[LEDGER]':<10}บันทึก Provenance สำเร็จ: SHA-256={checksum[:16]}... "
        f"({file_bytes:,} bytes)"
    )
    return receipt


def load_raw_metadata(raw_file_path: str) -> dict:
    """
    ค้นหาข้อมูลของไฟล์ที่ต้องการจาก _provenance_ledger.jsonl
    โดยอ่านจากล่างขึ้นบน เพื่อเอาประวัติรอบล่าสุด
    """
    abs_path = os.path.abspath(raw_file_path)
    target_name = os.path.basename(abs_path)
    raw_dir = os.path.dirname(abs_path)
    ledger_path = os.path.join(raw_dir, "_provenance_ledger.jsonl")

    if not os.path.exists(ledger_path):
        raise FileNotFoundError(f"ไม่พบไฟล์ Ledger ที่: {ledger_path}")

    with open(ledger_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
        for line in reversed(lines):
            line_str = line.strip()
            if not line_str:
                continue
            meta = json.loads(line_str)
            recorded_path = meta.get("raw_file_path", "")
            if recorded_path == abs_path or os.path.basename(recorded_path) == target_name:
                return meta

    raise ValueError(f"ไม่พบประวัติของไฟล์ {raw_file_path} ใน Ledger")


def verify_raw_integrity(raw_file_path: str, verbose: bool = True) -> dict:
    """
    ตรวจสอบความสมบูรณ์ของไฟล์ดิบ:
    นำ SHA-256 ของไฟล์ปัจจุบัน ไปเทียบกับ SHA-256 ที่เคยบันทึกไว้ใน Ledger
    """
    abs_path = os.path.abspath(raw_file_path)
    filename = os.path.basename(abs_path)

    if not os.path.exists(abs_path):
        print(f"  {'[ERROR]':<10}ไม่พบไฟล์ที่: {abs_path}")
        return {"status": "NOT_FOUND", "is_valid": False, "file": filename}

    current_hash = compute_sha256(abs_path)

    try:
        metadata = load_raw_metadata(abs_path)
        recorded_hash = metadata.get("sha256_checksum", "")
    except Exception as e:
        print(f"  {'[WARN]':<10}ไม่พบประวัติใน Ledger สำหรับไฟล์: {filename}")
        return {"status": "NO_RECORD", "is_valid": False, "file": filename, "error": str(e)}

    is_valid = (current_hash.lower() == recorded_hash.lower())

    if is_valid:
        if verbose:
            print(f"  {'[PASS]':<10}ตรวจสอบ SHA-256 ตรงกับสมุดคุม ({current_hash[:16]}... | ปลอดภัย 100%)")
    else:
        print(f"  {'[TAMPERED]':<10}ไฟล์ '{filename}' ถูกดัดแปลง! (SHA-256 ไม่ตรงกับที่บันทึกไว้)")
        print(f"            - ค่าแฮชดั้งเดิม : {recorded_hash}")
        print(f"            - ค่าแฮชปัจจุบัน : {current_hash}")

    return {
        "status": "PASS" if is_valid else "TAMPERED",
        "is_valid": is_valid,
        "file": filename,
        "recorded_hash": recorded_hash,
        "current_hash": current_hash,
    }


def verify_all_raw_files() -> list[dict]:
    """คำสั่งสำหรับตรวจสอบไฟล์ดิบทั้งหมดที่มีอยู่ใน data/raw/"""
    project_root = Path(__file__).resolve().parent.parent.parent
    raw_dir = project_root / "data" / "raw"
    results = []

    print("\n==========================================")
    print("[VERIFY] กำลังตรวจสอบความถูกต้องของไฟล์ดิบทั้งหมดใน data/raw/")
    print("==========================================")

    for f in sorted(raw_dir.iterdir()):
        if f.name.startswith(".") or f.name == "_provenance_ledger.jsonl" or not f.is_file():
            continue
        print(f"  {'[FILE]':<10}{f.name}")
        res = verify_raw_integrity(str(f), verbose=True)
        results.append(res)

    print("==========================================\n")
    return results


if __name__ == "__main__":
    verify_all_raw_files()
