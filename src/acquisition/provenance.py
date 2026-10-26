"""
=============================================================================
ระบบจัดการสมุดคุมประวัติข้อมูล (Data Provenance & Audit Ledger)
=============================================================================
หน้าที่หลักของไฟล์นี้:
1. get_bkk_timestamp()      -> สร้างเวลามาตรฐานประเทศไทย ISO 8601 (+07:00)
2. generate_batch_id()       -> สร้างรหัส Batch ID อัตโนมัติสำหรับแต่ละรอบการดึง
3. compute_sha256()          -> คำนวณค่าแฮช SHA-256 เพื่อยืนยันว่าไฟล์ไม่ถูกดัดแปลง (100% Immutable)
4. record_provenance()       -> บันทึกประวัติการได้มาของไฟล์ลงใน _provenance_ledger.jsonl
5. load_raw_metadata()       -> ใช้ค้นหาประวัติและ Metadata ของไฟล์ดิบสำหรับ Step อื่นๆ
6. verify_raw_integrity()    -> ตรวจสอบความถูกต้องว่าไฟล์ดิบถูกใครแอบแก้หรือไม่
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
    except Exception:
        pass

# กำหนดโซนเวลาประเทศไทย (+07:00) ตามมาตรฐาน ISO 8601
BKK_TZ = timezone(timedelta(hours=7))


# =============================================================================
# ฟังก์ชันที่ 1: สร้างเวลามาตรฐานประเทศไทย (ISO 8601 Timestamp)
# =============================================================================
def get_bkk_timestamp() -> str:
    """
    คืนค่าเวลาปัจจุบันในรูปแบบ ISO 8601 เช่น '2026-10-26T19:30:00+07:00'
    เหตุผลที่ต้องใช้: เพื่อให้รู้เวลาที่แน่นอนว่าดึงข้อมูลมาเมื่อไร (Audit Trail)
    """
    return datetime.now(BKK_TZ).isoformat(timespec="seconds")


# =============================================================================
# ฟังก์ชันที่ 2: สร้างรหัส Batch ID (Unique Extraction Batch)
# =============================================================================
def generate_batch_id(source_id: str) -> str:
    """
    สร้างรหัสเฉพาะสำหรับการดึงข้อมูลแต่ละรอบ เช่น 'BATCH-20261026-193000-SRC-001'
    เหตุผลที่ต้องใช้: ช่วยให้ระบุได้ว่าข้อมูลชุดนี้ถูกดึงมาใน Batch รอบไหน
    """
    ts_str = datetime.now(BKK_TZ).strftime("%Y%m%d-%H%M%S")
    return f"BATCH-{ts_str}-{source_id}"


# =============================================================================
# ฟังก์ชันที่ 3: คำนวณค่าแฮช SHA-256 (Data Fingerprint)
# =============================================================================
def compute_sha256(file_path: str) -> str:
    """
    อ่านไฟล์แบบ Binary และคำนวณ Checksum SHA-256
    เหตุผลที่ต้องใช้:
    - เป็น 'ลายนิ้วมือ' ของไฟล์
    - ยืนยันตามข้อกำหนดของวิชาว่า 'ไฟล์ดิบสภาพเดิม 100% ห้ามแก้ไข'
    - ถ้าไฟล์เปลี่ยนแม้แต่ 1 ตัวอักษร ค่า SHA-256 จะเปลี่ยนทันที
    """
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        # อ่านทีละบล็อก 4096 bytes เพื่อไม่ให้กิน RAM กรณีไฟล์มีขนาดใหญ่
        for byte_block in iter(lambda: f.read(4096), b""):
            sha256_hash.update(byte_block)
    return sha256_hash.hexdigest()


# =============================================================================
# ฟังก์ชันที่ 4: บันทึกลงสมุดคุมประวัติ (_provenance_ledger.jsonl)
# =============================================================================
def record_provenance(
    source_id: str,
    raw_file_path: str,
    source_url: str,
    page_or_table: str = "petroleum_report",
    extraction_method: str = "direct_download",
) -> dict:
    """
    บันทึก Metadata การได้มาของไฟล์ลงในไฟล์ _provenance_ledger.jsonl
    รูปแบบการบันทึก: JSON Lines (JSONL) บันทึกต่อท้ายบรรทัดใหม่เสมอ (Append-Only)
    """
    abs_path = os.path.abspath(raw_file_path)
    raw_dir = os.path.dirname(abs_path)
    ledger_path = os.path.join(raw_dir, "_provenance_ledger.jsonl")

    # รวบรวมข้อมูลหลักฐานการได้มาของข้อมูล
    receipt = {
        "extraction_batch_id": generate_batch_id(source_id),
        "source_id": source_id,
        "accessed_at": get_bkk_timestamp(),
        "source_url": source_url,
        "page_or_table": page_or_table,
        "extraction_method": extraction_method,
        "raw_file_path": abs_path,
        "sha256_checksum": compute_sha256(abs_path),
        "status": "ACQUIRED",
    }

    # บันทึกต่อท้ายแบบ append ("a") ห้ามเขียนทับข้อมูลเก่า
    with open(ledger_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(receipt, ensure_ascii=False) + "\n")

    print(f"  [LEDGER] ลงบันทึกประวัติสำเร็จ: {os.path.basename(ledger_path)}")
    return receipt


# =============================================================================
# ฟังก์ชันที่ 5: ฟังก์ชันสำหรับอ่านประวัติและ Metadata ของไฟล์ดิบไปใช้งานต่อ
# =============================================================================
def load_raw_metadata(raw_file_path: str) -> dict:
    """
    ค้นหาข้อมูลของไฟล์ที่ต้องการจาก _provenance_ledger.jsonl
    โดยอ่านจากล่างขึ้นบน เพื่อเอาประวัติรอบล่าสุด
    """
    abs_path = os.path.abspath(raw_file_path)
    raw_dir = os.path.dirname(abs_path)
    ledger_path = os.path.join(raw_dir, "_provenance_ledger.jsonl")

    if not os.path.exists(ledger_path):
        raise FileNotFoundError(f"ไม่พบไฟล์ Ledger ที่: {ledger_path}")

    with open(ledger_path, "r", encoding="utf-8") as f:
        lines = f.readlines()
        # อ่านย้อนกลับจากล่างขึ้นบน (Reverse) เพื่อเอาบันทึกอันล่าสุด
        for line in reversed(lines):
            line_str = line.strip()
            if not line_str:
                continue
            meta = json.loads(line_str)
            if meta.get("raw_file_path") == abs_path:
                return meta

    raise ValueError(f"ไม่พบประวัติของไฟล์ {raw_file_path} ใน Ledger")


# =============================================================================
# ฟังก์ชันที่ 6: ตรวจสอบว่าไฟล์ถูกแอบดัดแปลงหรือไม่ (Integrity Verification)
# =============================================================================
def verify_raw_integrity(raw_file_path: str) -> dict:
    """
    ตรวจสอบความสมบูรณ์ของไฟล์ดิบ:
    นำ SHA-256 ของไฟล์ปัจจุบัน ไปเทียบกับ SHA-256 ที่เคยบันทึกไว้ใน Ledger
    - ถ้าตรงกัน = ผ่าน (PASS 100% ไม่ถูกแก้ไข)
    - ถ้าไม่ตรง = ถูกดัดแปลง (TAMPERED)
    """
    abs_path = os.path.abspath(raw_file_path)
    filename = os.path.basename(abs_path)

    if not os.path.exists(abs_path):
        print(f"[ERROR] ไม่พบไฟล์ที่: {abs_path}")
        return {"status": "NOT_FOUND", "is_valid": False, "file": filename}

    # 1. คำนวณแฮชปัจจุบันของไฟล์ในดิสก์
    current_hash = compute_sha256(abs_path)

    # 2. ค้นหาแฮชดั้งเดิมที่บันทึกไว้ใน Ledger
    try:
        metadata = load_raw_metadata(abs_path)
        recorded_hash = metadata.get("sha256_checksum", "")
    except Exception as e:
        print(f"[WARN] ไม่พบประวัติใน Ledger สำหรับไฟล์: {filename}")
        return {"status": "NO_RECORD", "is_valid": False, "file": filename, "error": str(e)}

    # 3. ตรวจสอบว่าค่าแฮชตรงกันหรือไม่
    is_valid = (current_hash.lower() == recorded_hash.lower())

    if is_valid:
        print(f"  [PASS] ไฟล์ '{filename}' ปลอดภัย 100% (SHA-256 ตรงกับสมุดคุม)")
    else:
        print(f"[TAMPERED ALERT] ไฟล์ '{filename}' ถูกดัดแปลง! (SHA-256 ไม่ตรงกับที่บันทึกไว้)")
        print(f"   - ค่าแฮชดั้งเดิม : {recorded_hash}")
        print(f"   - ค่าแฮชปัจจุบัน : {current_hash}")

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

    for f in raw_dir.iterdir():
        # ข้ามไฟล์ซ่อน (.gitkeep) และไฟล์สมุดคุม (_provenance_ledger.jsonl)
        if f.name.startswith(".") or f.name == "_provenance_ledger.jsonl" or not f.is_file():
            continue
        res = verify_raw_integrity(str(f))
        results.append(res)

    print("==========================================\n")
    return results


if __name__ == "__main__":
    # สามารถพิมพ์รันตรงๆ: python src/acquisition/provenance.py เพื่อเช็คไฟล์ทั้งหมด
    verify_all_raw_files()
