"""
=============================================================================
Step 2: Data Parsing (สกัดโครงสร้างสู่ชั้นตาราง)
=============================================================================
เป้าหมายตามสถาปัตยกรรม:
- รับข้อมูลจาก: data/raw/ (ไฟล์สภาพเดิม 100% ที่ได้จาก Step 1)
- แกะข้อมูลจาก HTML/Excel ออกมาเป็นตาราง (DataFrame)
- สำคัญ: ยังคงชื่อคอลัมน์และค่าดั้งเดิมไว้เพื่อเป็นจุดอ้างอิง (Audit Trail)
- ผลลัพธ์: data/parsed/<source_id>_PARSED_RAW.csv

ข้อกำหนดการพัฒนา Step 2 (Data Parsing):
1. ใช้ฟังก์ชัน load_raw_metadata() จาก src/acquisition/provenance.py เพื่อดึงประวัติของไฟล์ดิบ
2. ใช้ pandas.read_csv() หรือ pandas.read_excel() หรือ BeautifulSoup ตามชนิดไฟล์
3. ส่งมอบไฟล์ไปยัง data/parsed/ เพื่อให้ Step 3 นำไปใช้งานต่อ
"""

from pathlib import Path
import sys

# กำหนด Path
CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent.parent
RAW_DIR = PROJECT_ROOT / "data" / "raw"
PARSED_DIR = PROJECT_ROOT / "data" / "parsed"

# นำเข้าเครื่องมือจาก Step 1
sys.path.append(str(PROJECT_ROOT / "src" / "acquisition"))
from provenance import load_raw_metadata


def parse_raw_data(source_id: str = "SRC-001"):
    """
    ฟังก์ชันสกัดโครงสร้างตาราง (Parsing)
    """
    PARSED_DIR.mkdir(parents=True, exist_ok=True)
    raw_files = list(RAW_DIR.glob(f"{source_id}_*RAW.*"))
    if not raw_files:
        raise FileNotFoundError(f"ไม่พบไฟล์ดิบของ {source_id} ใน data/raw/ (กรุณารัน Step 1: Data Acquisition ก่อน)")

    output_path = PARSED_DIR / f"{source_id}_PARSED_RAW.csv"

    if len(raw_files) > 1:
        print(f"[STEP 2] กำลังแกะข้อมูลจาก: {source_id} (พบ {len(raw_files)} ไฟล์ดิบประจำแต่ละเดือน)")
    else:
        print(f"[STEP 2] กำลังแกะข้อมูลจาก: {raw_files[0].name}")

    # =========================================================================
    # TODO [WIP - Work In Progress]:
    # 1. เขียนโค้ดแกะไฟล์ดิบ raw_path เข้า DataFrame
    # 2. ยังคงชื่อคอลัมน์และค่าดั้งเดิมทั้งหมดไว้
    # 3. บันทึกผลลัพธ์เป็น CSV ลง output_path
    # =========================================================================

    print(f"[WIP] อยู่ระหว่างการพัฒนาตรรกะ Parsing สำหรับ: {source_id}")
    return output_path


if __name__ == "__main__":
    target = sys.argv[1] if len(sys.argv) > 1 else "SRC-001"
    parse_raw_data(target)
