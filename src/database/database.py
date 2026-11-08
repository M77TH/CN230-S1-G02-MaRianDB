"""
=============================================================================
Step 07: Database Layer (Load into Relational Database + SQL Queries)
=============================================================================
คู่มือและโครงสร้างตั้งต้นสำหรับทีมงานฐานข้อมูล (Database Team Handover Guide):
สอดคล้องกับ Mental Model ของรายวิชา CN230 (Cell 22: "Load Dataset into Database")

1. ข้อมูลอินพุตที่ส่งมอบจากไปป์ไลน์ (Input Deliverables):
   - data/validation/accepted/*_VALID.csv  -> ข้อมูลที่ผ่านเกณฑ์ 7 กฎคุณภาพ (พร้อมเข้าสู่ตารางหลัก)
   - data/validation/rejected/*_ERR.csv    -> ข้อมูลกักกันพร้อม error_type (นำเข้า REJECTED_RECORD)
   - docs/source_registry/source_registry.csv -> แคตตาล็อกแหล่งกำเนิด (นำเข้า SOURCE)
   - data/raw/_provenance_ledger.jsonl    -> บันทึกเวลาและ SHA-256 (นำเข้า EXTRACTION_BATCH)

2. โครงสร้างตารางเชิงสัมพันธ์ 10 ตารางตาม ERD (3NF Relational Target):
   [1] LOCATION          - รายชื่อพื้นที่ปฏิบัติการ (บนบก, อ่าวไทย, โรงกลั่น 8 แห่ง, โรงแยกก๊าซ GSP)
   [2] SOURCE            - ทะเบียนแหล่งข้อมูล (source_id, title, publisher, url, ...)
   [3] REFERENCE         - รายการเอกสารอ้างอิงต้นทาง เชื่อมโยงกับ SOURCE
   [4] PROCESS           - กระบวนการผลิต/กลั่น/แยกก๊าซ รายสถานที่และรายปี
   [5] UNIT              - หน่วยวัดมาตรฐาน มิติทางฟิสิกส์ และ to_base_factor
   [6] FLOW              - สายไหลสารและมลพิษ (flow_name, flow_type, compartment, default_unit_id)
   [7] EXTRACTION_BATCH  - รอบการสกัดข้อมูล เวลาที่ดึง และเวอร์ชันสคริปต์
   [8] LCI_EXCHANGE      - รายการสายไหลขาเข้า (IN) และขาออก (OUT) พร้อม allocation และ is_reference
   [9] QUALITY_CHECK     - ประวัติการผ่านเกณฑ์คุณภาพของแต่ละ Exchange
   [10] REJECTED_RECORD  - ตารางเก็บแถวข้อมูลที่ไม่ผ่านเกณฑ์ พร้อม error_type และ batch_id

3. ขั้นตอนการพัฒนาที่แนะนำ (Development Workflow):
   - Step 7.1: รัน DDL Schema (sql/MaRianDB.sql หรือ sql/01_create_schema.sql)
   - Step 7.2: Seed ข้อมูลหลัก (ตาราง UNIT, LOCATION, SOURCE)
   - Step 7.3: อ่าน *_VALID.csv แล้ว Insert ลงตาราง PROCESS, FLOW, REFERENCE, LCI_EXCHANGE, QUALITY_CHECK
   - Step 7.4: อ่าน *_ERR.csv แล้ว Insert ลงตาราง REJECTED_RECORD
   - Step 7.5: รัน SQL Verification Queries ตรวจสอบ Foreign Key Integrity และ Balance
=============================================================================
"""

import sys
from pathlib import Path

# ป้องกันปัญหาภาษาไทยใน Console ของ Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent.parent
ACCEPTED_DIR = PROJECT_ROOT / "data" / "validation" / "accepted"
REJECTED_DIR = PROJECT_ROOT / "data" / "validation" / "rejected"
SQL_DIR = PROJECT_ROOT / "sql"


def load_database() -> dict:
    """
    ฟังก์ชันตั้งต้นสำหรับทีมงานฐานข้อมูลนำไปพัฒนาต่อ
    (Scaffolding Entry Point for Database & SQL Verification)
    """
    print("\n" + "=" * 80)
    print(">>> [STEP 07/07] DATABASE LAYER (Load into Relational Database & SQL Queries)")
    print("=" * 80)

    # 1. ตรวจสอบไฟล์อินพุตส่งมอบจาก Step 06 (Validation)
    accepted_files = sorted(list(ACCEPTED_DIR.glob("*_VALID.csv")))
    rejected_files = sorted(list(REJECTED_DIR.glob("*_ERR.csv")))

    print(f"  {'[INPUT]':<14}พบไฟล์ข้อมูลผ่านเกณฑ์ (Accepted) : {len(accepted_files)} ไฟล์ ใน data/validation/accepted/")
    print(f"  {'[INPUT]':<14}พบไฟล์ข้อมูลกักกัน (Rejected)   : {len(rejected_files)} ไฟล์ ใน data/validation/rejected/")

    # 2. ข้อความแนะนำทีมงานขั้นตอนถัดไป
    print(f"\n  {'[GUIDE]':<14}แนวทางการพัฒนาขั้นตอน Database:")
    print("    1. เชื่อมต่อฐานข้อมูลเชิงสัมพันธ์ (MariaDB หรือ SQLite)")
    print("    2. สั่งรัน DDL Schema จากโฟลเดอร์ sql/ เพื่อสร้างตารางทั้ง 10 ตาราง")
    print("    3. วนลูปอ่านข้อมูลจาก *_VALID.csv เพื่อกระจายลง 10 ตารางตาม ERD 3NF")
    print("    4. วนลูปอ่านข้อมูลจาก *_ERR.csv เพื่อบันทึกลงตาราง REJECTED_RECORD")
    print("    5. สั่งรันชุดคำสั่ง SQL Verification Queries เพื่อตรวจ FK และ Flow Balance")
    print("=" * 80 + "\n")

    return {
        "status": "HANDOVER_READY",
        "accepted_file_count": len(accepted_files),
        "rejected_file_count": len(rejected_files),
    }


# Alias เพื่อความเข้ากันได้ย้อนหลัง
build_and_verify_database = load_database
run_database = load_database
run_analysis = load_database


if __name__ == "__main__":
    load_database()
