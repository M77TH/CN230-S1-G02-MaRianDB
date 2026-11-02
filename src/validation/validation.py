"""
=============================================================================
Step 4: Data Validation (ตรวจสอบคุณภาพข้อมูล)
=============================================================================
เป้าหมายตามสถาปัตยกรรม:
- ตรวจสอบโครงสร้าง Schema, ชนิดข้อมูล (Data Type), และกฎทางธุรกิจ
  (เช่น ข้อมูลห้ามติดลบ, ห้ามมีค่าว่างในคอลัมน์สำคัญ)
- รองรับการตรวจสอบไฟล์ข้อมูลแบบ 1-to-1 ทุกไฟล์ของแต่ละ source_id (Multi-file Validation)
- เครื่องมือแนะนำ: Pandera หรือ Great Expectations
- แยกข้อมูลออกเป็น 2 ส่วน:
  - ผ่านเกณฑ์ (Accepted): data/accepted/
  - ไม่ผ่านเกณฑ์ (Rejected): data/rejected/
=============================================================================
"""

from pathlib import Path
import sys

# ป้องกันปัญหาภาษาไทยใน Console ของ Windows
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


def validate_data(source_id: str = "SRC-001") -> list[Path]:
    """
    ฟังก์ชันตรวจสอบคุณภาพข้อมูล
    รองรับการตรวจสอบทุกไฟล์ Staging ของ source_id (Multi-file Support)
    """
    ACCEPTED_DIR.mkdir(parents=True, exist_ok=True)
    REJECTED_DIR.mkdir(parents=True, exist_ok=True)

    staged_files = sorted(list(STAGING_DIR.glob(f"{source_id}_*_STAGED*.csv")))
    if not staged_files:
        staged_files = sorted(list(STAGING_DIR.glob(f"{source_id}_*_STG.csv")))
    if not staged_files:
        staged_files = sorted(list(STAGING_DIR.glob(f"{source_id}*STG.csv")))

    file_count = len(staged_files)
    print(f"  {'[WIP]':<10}อยู่ระหว่างการพัฒนากฎ Validation สำหรับ {source_id} (ตรวจพบ {file_count} ไฟล์ Staging)")

    return staged_files


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "SRC-001"
    validate_data(target)
