"""
=============================================================================
Step 4: Data Validation (ตรวจสอบคุณภาพข้อมูล)
=============================================================================
เป้าหมายตามสถาปัตยกรรม:
- ตรวจสอบโครงสร้าง Schema, ชนิดข้อมูล (Data Type), และกฎทางธุรกิจ
  (เช่น ข้อมูลห้ามติดลบ, ห้ามมีค่าว่างในคอลัมน์สำคัญ)
- เครื่องมือแนะนำ: Pandera หรือ Great Expectations
- แยกข้อมูลออกเป็น 2 ส่วน:
  - ผ่านเกณฑ์ (Accepted): data/accepted/
  - ไม่ผ่านเกณฑ์ (Rejected): data/rejected/
"""

from pathlib import Path
import sys

CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent.parent
STAGING_DIR = PROJECT_ROOT / "data" / "staging"
ACCEPTED_DIR = PROJECT_ROOT / "data" / "accepted"
REJECTED_DIR = PROJECT_ROOT / "data" / "rejected"


def validate_data(source_id: str = "SRC-001"):
    """
    ฟังก์ชันตรวจสอบคุณภาพข้อมูล
    """
    ACCEPTED_DIR.mkdir(parents=True, exist_ok=True)
    REJECTED_DIR.mkdir(parents=True, exist_ok=True)

    # =========================================================================
    # TODO [WIP - Work In Progress]:
    # 1. โหลดข้อมูลจาก data/staging/<source_id>_STG.csv
    # 2. สร้าง Schema Validation ด้วย Pandera หรือ Great Expectations
    # 3. ตรวจสอบกฎทางธุรกิจ (Business Rules)
    # 4. บันทึกข้อมูลที่ผ่านลง data/accepted/ และข้อมูลที่ไม่ผ่านลง data/rejected/
    # =========================================================================

    print(f"  [WIP] อยู่ระหว่างการพัฒนากฎ Validation สำหรับ: {source_id}")


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "SRC-001"
    validate_data(target)
