"""
=============================================================================
Step 2: Data Parsing (สกัดโครงสร้างสู่ชั้นตาราง)
=============================================================================
เป้าหมายตามสถาปัตยกรรม:
- รับข้อมูลจาก: data/raw/ (ไฟล์สภาพเดิม 100% ที่ได้จาก Step 1)
- แกะข้อมูลจาก HTML/Excel/CSV ออกมาเป็นตาราง (DataFrame)
- สำคัญ: ยังคงชื่อคอลัมน์และค่าดั้งเดิมไว้เพื่อเป็นจุดอ้างอิง (Audit Trail / High Fidelity)
- ตั้งชื่อไฟล์ผลลัพธ์: อิงตามชื่อไฟล์ดิบเดิม โดยแทนที่ _RAW.<ext> ด้วย _PARSED_RAW.csv
- ผลลัพธ์: data/parsed/<original_name>_PARSED_RAW.csv (รองรับ 1-to-1 กับไฟล์ดิบทุก subtrack)

ข้อกำหนดการพัฒนา Step 2 (Data Parsing):
1. ใช้ฟังก์ชัน load_raw_metadata() จาก src/acquisition/provenance.py เพื่อดึงประวัติของไฟล์ดิบ
2. ใช้ pandas.read_csv(), pandas.read_excel(), หรือ BeautifulSoup ตามชนิดไฟล์
3. ส่งมอบไฟล์ไปยัง data/parsed/ เพื่อให้ Step 3 (Transform & Staging) นำไปใช้งานต่อ
=============================================================================
"""

import io
import sys
from pathlib import Path
import pandas as pd
from bs4 import BeautifulSoup

# ป้องกันปัญหาภาษาไทยใน Console ของ Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# กำหนด Path
CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent.parent
RAW_DIR = PROJECT_ROOT / "data" / "raw"
PARSED_DIR = PROJECT_ROOT / "data" / "parsed"
ACQUISITION_DIR = PROJECT_ROOT / "src" / "acquisition"

# นำเข้าเครื่องมือจาก Step 1
if str(ACQUISITION_DIR) not in sys.path:
    sys.path.append(str(ACQUISITION_DIR))

from provenance import load_raw_metadata


def get_parsed_output_path(raw_file: Path) -> Path:
    """
    สร้างชื่อไฟล์ปลายทางใน data/parsed โดยใช้ชื่อเดียวกับไฟล์ดิบ
    แต่เปลี่ยนคำลงท้ายจาก _RAW เป็น _PARSED_RAW.csv
    ตัวอย่าง:
      SRC-033_EPPO_Petroleum-Consumption_TH_202408_RAW.csv
      -> SRC-033_EPPO_Petroleum-Consumption_TH_202408_PARSED_RAW.csv
      SRC-043_TGO_Carbon-Footprint-Petroleum_TH_202408_RAW.html
      -> SRC-043_TGO_Carbon-Footprint-Petroleum_TH_202408_PARSED_RAW.csv
    """
    stem = raw_file.stem
    if stem.endswith("_RAW"):
        new_stem = stem[:-4] + "_PARSED_RAW"
    else:
        new_stem = f"{stem}_PARSED_RAW"
    return PARSED_DIR / f"{new_stem}.csv"


def _read_csv_raw(file_path: Path) -> pd.DataFrame:
    """
    อ่านไฟล์ดิบประเภท .csv โดยทดสอบชุดการเข้ารหัส (Encoding) ที่พบบ่อยในเอกสารราชการไทย
    รักษาข้อมูลดิบทุกฟิลด์ในรูปแบบสตริง (dtype=str) ไม่ดัดแปลงค่าตัวเลขหรือตัดศูนย์นำหน้า
    """
    encodings = ["utf-8-sig", "utf-8", "cp874", "tis-620"]
    for enc in encodings:
        try:
            df = pd.read_csv(file_path, encoding=enc, dtype=str)
            # ตัดช่องว่างหัวท้ายของชื่อคอลัมน์ แต่คงชื่อเดิมไว้ทั้งหมด
            df.columns = [str(c).strip() for c in df.columns]
            return df
        except (UnicodeDecodeError, Exception):
            continue

    raise ValueError(f"ไม่สามารถอ่านไฟล์ CSV ด้วยการเข้ารหัสที่รองรับได้: {file_path.name}")


def _read_excel_raw(file_path: Path) -> pd.DataFrame:
    """
    อ่านไฟล์ดิบประเภท .xlsx / .xls โดยค้นหาแถวที่เป็นหัวตารางจริง (Header Row)
    ตัดส่วน Banner ข้อความประกาศด้านบน และตัดเชิงอรรถ/หมายเหตุส่วนล่างออก
    """
    raw_df = pd.read_excel(file_path, header=None, dtype=str)

    header_idx = None
    for i, row in raw_df.iterrows():
        vals = [str(x).strip() for x in row if pd.notna(x) and str(x).strip() not in ("nan", "")]
        # ตรวจจับหัวตาราง: มีคำว่า 'เดือน' หรือมีข้อมูลหลายคอลัมน์ที่ไม่ใช่ข้อความประโยคยาว
        if "เดือน" in vals or (len(vals) >= 3 and not any(len(v) > 50 for v in vals)):
            header_idx = i
            break

    if header_idx is None:
        header_idx = 0

    headers = [str(c).replace("\n", " ").strip() for c in raw_df.iloc[header_idx]]

    data_rows = []
    for i in range(header_idx + 1, len(raw_df)):
        row = raw_df.iloc[i]
        first_col = str(row.iloc[0]).strip()
        # หยุดเมื่อพบเชิงอรรถ/หมายเหตุ หรือแถวว่าง
        if "หมายเหตุ" in first_col or first_col in ("nan", ""):
            break
        data_rows.append(row.values)

    df = pd.DataFrame(data_rows, columns=headers)
    return df


def _read_html_raw(file_path: Path) -> pd.DataFrame:
    """
    สกัดตารางจากไฟล์ดิบประเภท .html โดยค้นหาแท็ก <table> ในหน้าเว็บ
    รักษาชื่อคอลัมน์และค่าข้อมูลตามที่ระบุใน HTML ดั้งเดิม
    """
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        html_content = f.read()

    soup = BeautifulSoup(html_content, "html.parser")
    # ค้นหาตารางแคตตาล็อกหลัก หรือตารางแรกในเอกสาร
    table = soup.find("table", class_="catalog-table") or soup.find("table")
    if table is None:
        raise ValueError(f"ไม่พบแท็ก <table> ในไฟล์ HTML: {file_path.name}")

    dfs = pd.read_html(io.StringIO(str(table)))
    if not dfs:
        raise ValueError(f"ไม่สามารถแปลง <table> ใน {file_path.name} เป็น DataFrame ได้")

    df = dfs[0].astype(str)
    df.columns = [str(c).strip() for c in df.columns]
    return df


def parse_raw_data(source_id: str) -> list[Path]:
    """
    ฟังก์ชันสกัดโครงสร้างตาราง (Parsing Engine):
    - รับข้อมูลดิบจาก data/raw/<source_id>_*RAW.*
    - ตรวจสอบประวัติผ่าน load_raw_metadata()
    - สกัดข้อมูลตามนามสกุลไฟล์ (.csv, .xlsx, .html)
    - บันทึกตารางดิบลง data/parsed/ แยก 1-to-1 ตามแต่ละไฟล์ดิบ (รองรับกรณีมีหลาย subtrack)
    - ชื่อไฟล์ผลลัพธ์จะคงชื่อเดิมของไฟล์ดิบและแทนที่ _RAW ด้วย _PARSED_RAW.csv
    """
    PARSED_DIR.mkdir(parents=True, exist_ok=True)
    raw_files = sorted(list(RAW_DIR.glob(f"{source_id}_*RAW.*")))

    if not raw_files:
        raise FileNotFoundError(
            f"ไม่พบไฟล์ดิบของ {source_id} ใน data/raw/ (กรุณารัน Step 1: Data Acquisition ก่อน)"
        )

    print(f"\n[STEP 2: PARSING] กำลังแกะโครงสร้างตารางสำหรับ: {source_id} (พบ {len(raw_files)} ไฟล์ดิบ)")
    output_paths = []

    for raw_file in raw_files:
        ext = raw_file.suffix.lower()
        file_desc = raw_file.name
        output_path = get_parsed_output_path(raw_file)

        # ดึงประวัติจาก Ledger เพื่อยืนยันการเชื่อมต่อ Lineage
        try:
            meta = load_raw_metadata(str(raw_file.resolve()))
            batch_id = meta.get("extraction_batch_id", "N/A")
            target_desc = meta.get("page_or_table", "N/A")
            print(f"  - กำลังประมวลผล: {file_desc} (Batch: {batch_id} | ตาราง: {target_desc})")
        except Exception:
            print(f"  - กำลังประมวลผล: {file_desc}")

        # สกัดข้อมูลตามชนิดไฟล์
        if ext == ".csv":
            df = _read_csv_raw(raw_file)
        elif ext in [".xlsx", ".xls"]:
            df = _read_excel_raw(raw_file)
        elif ext in [".html", ".htm"]:
            df = _read_html_raw(raw_file)
        else:
            raise NotImplementedError(f"ไม่รองรับนามสกุลไฟล์: {ext}")

        # บันทึกเป็น CSV 1-to-1 ลง data/parsed/ โดยคงหัวคอลัมน์และค่าเดิมไว้ทั้งหมด
        df.to_csv(output_path, index=False, encoding="utf-8-sig")
        output_paths.append(output_path)

        print(
            f"    -> บันทึกสำเร็จ: {output_path.name} "
            f"({len(df):,} แถว, {len(df.columns)} คอลัมน์)"
        )

    return output_paths


def parse_all_approved():
    """
    สกัดข้อมูลสำหรับชุดข้อมูล Approved ทั้งหมดที่มีไฟล์ดิบอยู่ใน data/raw/
    """
    raw_files = list(RAW_DIR.glob("*_RAW.*"))
    if not raw_files:
        print("[STEP 2] ไม่พบไฟล์ดิบใน data/raw/ กรุณารัน Step 1 ก่อน")
        return

    # ค้นหา source_id ทั้งหมดที่มีไฟล์ดิบพร้อมประมวลผล
    source_ids = sorted(list({f.name.split("_")[0] for f in raw_files if f.name.startswith("SRC-")}))

    print("\n" + "=" * 65)
    print(f"[STEP 2] เริ่มต้นสกัดโครงสร้างตารางทั้งหมด {len(source_ids)} ชุดข้อมูล (รวม {len(raw_files)} ไฟล์ดิบ)")
    print(f"         {', '.join(source_ids)}")
    print("=" * 65)

    success_count = 0
    total_parsed_files = 0
    for sid in source_ids:
        try:
            paths = parse_raw_data(sid)
            success_count += 1
            total_parsed_files += len(paths)
        except Exception as e:
            print(f"[ERROR] ล้มเหลวในการสกัด {sid}: {e}")

    print(f"\n[SUMMARY] สรุปผลการ Parsing: สำเร็จ {success_count}/{len(source_ids)} ชุดข้อมูล (สร้าง {total_parsed_files} ไฟล์ใน data/parsed/)\n")


def main():
    args = sys.argv[1:]
    clean_args = [a for a in args if not a.startswith("--")]

    if not clean_args or "--all" in args:
        parse_all_approved()
        return

    for sid in clean_args:
        try:
            parse_raw_data(sid)
        except Exception as e:
            print(f"[ERROR] ล้มเหลวในการสกัด {sid}: {e}")


if __name__ == "__main__":
    main()
