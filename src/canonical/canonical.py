"""
=============================================================================
Step 5: Canonicalization (ปรับสู่มาตรฐานกลาง)
=============================================================================
เป้าหมายตามสถาปัตยกรรม:
- แปลงหน่วยวัด (Unit Harmonization) เช่น บาร์เรล -> ลิตร, BTU -> จูล
- ปรับรหัสอ้างอิงให้ตรงกับ Master Data ขององค์กร
- รองรับการหลอมรวมข้อมูลหลายไฟล์ของแต่ละ source_id เข้าสู่โมเดลกลาง (Multi-file Canonicalization)
- นำเข้าสู่ฐานข้อมูลกลาง: LCI Database / Data Warehouse
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


def canonicalize_data(source_id: str = "SRC-001") -> list[Path]:
    """
    ฟังก์ชันปรับข้อมูลสู่มาตรฐานกลางและโหลดเข้าฐานข้อมูล
    รองรับการประมวลผลทุกไฟล์ของ source_id (Multi-file Support)
    """
    staged_files = sorted(list(STAGING_DIR.glob(f"{source_id}_*_STAGED*.csv")))
    if not staged_files:
        staged_files = sorted(list(STAGING_DIR.glob(f"{source_id}_*_STG.csv")))
    if not staged_files:
        staged_files = sorted(list(STAGING_DIR.glob(f"{source_id}*STG.csv")))

    file_count = len(staged_files)
    print(f"  {'[WIP]':<10}อยู่ระหว่างการพัฒนาตรรกะ Canonicalization สำหรับ {source_id} (ตรวจพบ {file_count} ไฟล์ Staging)")

    return staged_files


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "SRC-001"
    canonicalize_data(target)
