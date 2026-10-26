"""
=============================================================================
Step 5: Canonicalization (ปรับสู่มาตรฐานกลาง)
=============================================================================
เป้าหมายตามสถาปัตยกรรม:
- แปลงหน่วยวัด (Unit Harmonization) เช่น บาร์เรล -> ลิตร, BTU -> จูล
- ปรับรหัสอ้างอิงให้ตรงกับ Master Data ขององค์กร
- นำเข้าสู่ฐานข้อมูลกลาง: LCI Database / Data Warehouse
"""

from pathlib import Path
import sys

CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent.parent
ACCEPTED_DIR = PROJECT_ROOT / "data" / "accepted"


def canonicalize_data(source_id: str = "SRC-001"):
    """
    ฟังก์ชันปรับข้อมูลสู่มาตรฐานกลางและโหลดเข้าฐานข้อมูล
    """
    # =========================================================================
    # TODO [WIP - Work In Progress]:
    # 1. โหลดข้อมูลจาก data/accepted/
    # 2. ปรับหน่วยวัด (Unit Harmonization)
    # 3. แมปปิ้งเข้าสู่ Master Data Model
    # 4. บันทึกลง LCI Database หรือ Data Warehouse
    # =========================================================================

    print(f"  [WIP] อยู่ระหว่างการพัฒนาตรรกะ Canonicalization สำหรับ: {source_id}")


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "SRC-001"
    canonicalize_data(target)
