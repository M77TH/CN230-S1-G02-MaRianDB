"""
=============================================================================
Step 3: Transform & Staging (แปลงและทำความสะอาด)
=============================================================================
เป้าหมายตามสถาปัตยกรรม:
- รับข้อมูลจาก: data/parsed/ (หรือ data/raw/)
- จับคู่ชื่อคอลัมน์ (Schema Mapping)
- ลบแถวขยะ, ลบเครื่องหมายในตัวเลข (เช่น ลูกน้ำ comma)
- แนบ Metadata ประวัติ (_source_id, _extraction_batch_id, _staged_at)
- ผลลัพธ์: data/staging/<source_id>_STG.csv
"""

from pathlib import Path
import sys

CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent.parent
PARSED_DIR = PROJECT_ROOT / "data" / "parsed"
STAGING_DIR = PROJECT_ROOT / "data" / "staging"

# นำเข้าเครื่องมือจาก Step 1
sys.path.append(str(PROJECT_ROOT / "src" / "acquisition"))
from provenance import load_raw_metadata


def stage_and_transform(source_id: str = "SRC-001"):
    """
    ฟังก์ชันแปลงและทำความสะอาดข้อมูล (Staging & Cleaning)
    """
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    output_path = STAGING_DIR / f"{source_id}_STG.csv"

    # =========================================================================
    # TODO [WIP - Work In Progress]:
    # 1. โหลดข้อมูลจาก data/parsed/<source_id>_PARSED_RAW.csv
    # 2. ทำความสะอาด: ลบลูกน้ำในตัวเลข, แปลงชนิดข้อมูล, จัดการช่องว่าง
    # 3. แนบ Metadata ประวัติลงในตาราง
    # 4. บันทึกผลลัพธ์เป็น CSV ลง output_path
    # =========================================================================

    print(f"  [WIP] อยู่ระหว่างการพัฒนาตรรกะ Staging สำหรับ: {source_id}")
    return output_path


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "SRC-001"
    stage_and_transform(target)
