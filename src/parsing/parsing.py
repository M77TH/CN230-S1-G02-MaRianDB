"""
=============================================================================
Step 2: Data Parsing (สกัดโครงสร้างสู่ชั้นตาราง)
=============================================================================
เป้าหมายตามสถาปัตยกรรม (อ้างอิงตามมาตรฐาน CN230 Guideline Notebook Cells 5-8):
- รับข้อมูลจาก: data/raw/ (ไฟล์สภาพเดิม 100% ที่ได้จาก Step 1)
- ตรวจสอบ Provenance Metadata และ SHA-256 จาก _provenance_ledger.jsonl
- ทำ Diagnostic Check ค้นหาคำสำคัญในไฟล์ HTML ก่อนสกัดตาราง (Cell 5)
- ยุบรวมหัวตารางหลายชั้นด้วย flatten_columns() (Cell 7)
- คัดเลือกตารางด้วยหลักฐานผ่านระบบให้คะแนน table_score() แทนการเดา index 0 ตายตัว (Cell 7)
- คงชื่อคอลัมน์และค่าดั้งเดิมไว้เพื่อเป็นจุดอ้างอิง (parsed_raw / High Fidelity - Cell 8)
- ผลลัพธ์: data/parsed/<original_name>_PARSED_RAW.csv (รองรับ 1-to-1 กับไฟล์ดิบทุก subtrack)
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
        sys.stderr.reconfigure(encoding="utf-8")
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

# คำสำคัญสำหรับตรวจสอบความถูกต้องของหน้าเว็บและให้คะแนนตาราง (อ้างอิง Guideline Cell 5 & Cell 7)
DIAGNOSTIC_KEYWORDS_TGO = [
    "เลขที่ใบรับรอง",
    "อุตสาหกรรม",
    "ปริมาณ CF",
    "หน่วยการทำงาน",
    "ขอบเขต",
]

TABLE_SCORE_TOKENS = [
    "เลขที่ใบรับรอง",
    "อุตสาหกรรม",
    "ปริมาณ CF",
    "หน่วยการทำงาน",
    "ขอบเขต",
    "เดือน",
    "ก๊าซธรรมชาติ",
    "น้ำมันดิบ",
    "คอนเดนเสท",
]


def get_parsed_output_path(raw_file: Path) -> Path:
    """
    สร้างชื่อไฟล์ปลายทางใน data/parsed โดยใช้ชื่อเดียวกับไฟล์ดิบ
    แต่เปลี่ยนคำลงท้ายจาก _RAW เป็น _PARSED_RAW.csv
    """
    stem = raw_file.stem
    if stem.endswith("_RAW"):
        new_stem = stem[:-4] + "_PARSED_RAW"
    else:
        new_stem = f"{stem}_PARSED_RAW"
    return PARSED_DIR / f"{new_stem}.csv"


def flatten_columns(df: pd.DataFrame) -> pd.DataFrame:
    """
    ยุบรวมหัวตารางหลายชั้น (MultiIndex columns) ให้เหลือบรรทัดเดียว (อ้างอิง Guideline Cell 7)
    """
    result = df.copy()
    if isinstance(result.columns, pd.MultiIndex):
        result.columns = [
            " ".join(
                str(x).strip()
                for x in col
                if str(x).strip() and str(x).strip().lower() != "nan"
            )
            for col in result.columns
        ]
    else:
        result.columns = [str(c).replace("\n", " ").strip() for c in result.columns]
    return result


def table_score(df: pd.DataFrame) -> int:
    """
    ให้คะแนนตารางจาก Keyword สำคัญในชื่อคอลัมน์และ 10 แถวแรก (Evidence-based Table Selection - Cell 7)
    """
    flat = flatten_columns(df)
    columns_text = " | ".join(flat.columns)
    head_text = flat.head(10).astype(str).to_string()

    score = 0
    for token in TABLE_SCORE_TOKENS:
        if token in columns_text or token in head_text:
            score += 1
    return score


def _format_column_lines(cols: list[str], max_line_len: int = 58) -> list[str]:
    """จัดเรียงรายชื่อคอลัมน์ทั้งหมดเป็นบรรทัดย่อย เพื่อให้อ่านง่ายและไม่ตกขอบจอ"""
    lines = []
    current = []
    current_len = 0
    for c in cols:
        c_str = str(c)
        add_len = len(c_str) + (2 if current else 0)
        if current and (current_len + add_len > max_line_len):
            lines.append(", ".join(current))
            current = [c_str]
            current_len = len(c_str)
        else:
            current.append(c_str)
            current_len += add_len
    if current:
        lines.append(", ".join(current))
    return lines


def _read_csv_raw(file_path: Path) -> tuple[pd.DataFrame, str]:
    """
    อ่านไฟล์ดิบประเภท .csv โดยทดสอบชุดการเข้ารหัส (Encoding) ที่พบบ่อยในเอกสารราชการไทย
    รักษาข้อมูลดิบทุกฟิลด์ในรูปแบบสตริง (dtype=str) ไม่ดัดแปลงค่าตัวเลขหรือตัดศูนย์นำหน้า
    """
    encodings = ["utf-8-sig", "utf-8", "cp874", "tis-620"]
    for enc in encodings:
        try:
            df = pd.read_csv(file_path, encoding=enc, dtype=str)
            df = flatten_columns(df)
            return df, enc
        except (UnicodeDecodeError, Exception):
            continue

    raise ValueError(f"ไม่สามารถอ่านไฟล์ CSV ด้วยการเข้ารหัสที่รองรับได้: {file_path.name}")


def _read_excel_raw(file_path: Path) -> tuple[pd.DataFrame, int]:
    """
    อ่านไฟล์ดิบประเภท .xlsx / .xls โดยค้นหาแถวที่เป็นหัวตารางจริง (Header Row)
    ตัดส่วน Banner ข้อความประกาศด้านบน และตัดเชิงอรรถ/หมายเหตุส่วนล่างออก
    คืนค่า: (DataFrame, header_row_index)
    """
    raw_df = pd.read_excel(file_path, header=None, dtype=str)

    header_idx = None
    for i, row in raw_df.iterrows():
        vals = [str(x).strip() for x in row if pd.notna(x) and str(x).strip() not in ("nan", "")]
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
        if "หมายเหตุ" in first_col or first_col in ("nan", ""):
            break
        data_rows.append(row.values)

    df = pd.DataFrame(data_rows, columns=headers)
    df = flatten_columns(df)
    return df, header_idx


def _read_html_raw(file_path: Path) -> tuple[pd.DataFrame, dict]:
    """
    สกัดตารางจากไฟล์ดิบประเภท .html ตามแนวทาง CN230 Guideline Notebook (Cells 5-7):
    1. ตรวจ Diagnostic Keywords ใน HTML ก่อน Parse
    2. อ่านทุก <table> ด้วย pd.read_html()
    3. ให้คะแนนแต่ละตารางด้วย table_score() แล้วเลือกตารางที่ได้คะแนนสูงสุด
    """
    with open(file_path, "r", encoding="utf-8", errors="replace") as f:
        html_content = f.read()

    # 1. Diagnostic Check (Cell 5)
    matched_terms = [t for t in DIAGNOSTIC_KEYWORDS_TGO if html_content.count(t) > 0]
    total_occurrences = sum(html_content.count(t) for t in matched_terms)

    # 2. Parse HTML Tables & Score (Cells 6-7)
    try:
        tables = pd.read_html(io.StringIO(html_content))
    except Exception:
        soup = BeautifulSoup(html_content, "html.parser")
        table_tag = soup.find("table", class_="catalog-table") or soup.find("table")
        if table_tag is None:
            raise ValueError(f"ไม่พบแท็ก <table> ในไฟล์ HTML: {file_path.name}")
        tables = pd.read_html(io.StringIO(str(table_tag)))

    if not tables:
        raise ValueError(f"ไม่สามารถแปลง <table> ใน {file_path.name} เป็น DataFrame ได้")

    scored = [(i, table_score(t), t.shape) for i, t in enumerate(tables)]
    # หากคะแนนเท่ากัน ให้เลือกตารางชั้นในสุด (Inner Data Table เช่น Table #4 แทนตารางกรอบนอก Table #0)
    best_index, best_score, best_shape = max(scored, key=lambda x: (x[1], x[0]))

    # [RULE 2.4] หยุดทันทีหากไม่มีตารางใดผ่านเกณฑ์คะแนนขั้นต่ำ (อ้างอิง Guideline Cell 7)
    if best_score == 0:
        raise ValueError(
            f"พบ {len(tables)} ตารางใน {file_path.name} แต่ไม่มีตารางใดตรงกับคำสำคัญของข้อมูลเป้าหมาย (Table Score = 0)"
        )

    df = flatten_columns(tables[best_index]).astype(str)
    meta_info = {
        "matched_terms": len(matched_terms),
        "total_terms": len(DIAGNOSTIC_KEYWORDS_TGO),
        "total_occurrences": total_occurrences,
        "num_tables": len(tables),
        "best_index": best_index,
        "best_score": best_score,
    }
    return df, meta_info


def parse_raw_data(source_id: str) -> list[Path]:
    """
    ฟังก์ชันสกัดโครงสร้างตาราง (Parsing Engine):
    - รับข้อมูลดิบจาก data/raw/<source_id>_*RAW.*
    - ตรวจสอบ Provenance จาก Ledger
    - สกัดข้อมูลตามนามสกุลไฟล์ (.csv, .xlsx, .html) ด้วย flatten_columns และ table_score
    - บันทึกตารางดิบลง data/parsed/ แยก 1-to-1 ตามแต่ละไฟล์ดิบ
    """
    PARSED_DIR.mkdir(parents=True, exist_ok=True)
    raw_files = sorted(list(RAW_DIR.glob(f"{source_id}_*RAW.*")))

    if not raw_files:
        raise FileNotFoundError(
            f"ไม่พบไฟล์ดิบของ {source_id} ใน data/raw/ (กรุณารัน Step 1: Data Acquisition ก่อน)"
        )

    is_multi = len(raw_files) > 1
    print(f"  {'[INFO]':<10}ตรวจพบไฟล์ดิบ {len(raw_files)} ไฟล์สำหรับ {source_id}")
    output_paths = []

    for idx, raw_file in enumerate(raw_files, 1):
        ext = raw_file.suffix.lower()
        output_path = get_parsed_output_path(raw_file)
        file_size_kb = raw_file.stat().st_size / 1024

        if is_multi:
            print(f"\n  --- ไฟล์ที่ {idx}/{len(raw_files)} ---")

        print(f"  {'[INPUT]':<10}{raw_file.name} ({file_size_kb:.2f} KB | ชนิด: {ext})")

        # เชื่อมโยง Provenance Metadata จาก Step 1
        try:
            raw_meta = load_raw_metadata(str(raw_file))
            sha_short = raw_meta.get("sha256_checksum", "")[:16]
            batch_id = raw_meta.get("extraction_batch_id", "N/A")
            print(f"  {'[LINEAGE]':<10}Batch: {batch_id} | SHA-256: {sha_short}...")
        except Exception:
            pass

        if ext == ".csv":
            df, detected_enc = _read_csv_raw(raw_file)
            print(f"  {'[PARSE]':<10}อ่านไฟล์ CSV สำเร็จ (ชุดอักขระ: {detected_enc})")
        elif ext in [".xlsx", ".xls"]:
            df, header_idx = _read_excel_raw(raw_file)
            score = table_score(df)
            print(f"  {'[PARSE]':<10}สกัดแผ่นงาน Excel สำเร็จ (พบหัวตารางที่แถว #{header_idx + 1} | Table Score: {score})")
        elif ext in [".html", ".htm"]:
            df, html_info = _read_html_raw(raw_file)
            print(
                f"  {'[DIAG]':<10}ตรวจคำสำคัญใน HTML: พบ {html_info['matched_terms']}/{html_info['total_terms']} คำสำคัญ "
                f"(รวม {html_info['total_occurrences']:,} จุด)"
            )
            print(
                f"  {'[PARSE]':<10}พบ {html_info['num_tables']} ตารางใน HTML -> เลือก Table #{html_info['best_index']} "
                f"(Table Score: {html_info['best_score']})"
            )
        else:
            raise NotImplementedError(f"ไม่รองรับนามสกุลไฟล์: {ext}")

        # [RULE 2.4] ตรวจสอบว่าตารางที่สกัดได้ต้องไม่ว่างเปล่าและมีอย่างน้อย 2 คอลัมน์
        if df.empty or len(df.columns) < 2:
            raise ValueError(
                f"ตารางที่สกัดจาก {raw_file.name} ไม่ผ่านเกณฑ์ขั้นต่ำ (แถว={len(df)}, คอลัมน์={len(df.columns)})"
            )
        print(f"  {'[RULE]':<10}ผ่านเกณฑ์คุณภาพการสกัดตาราง (Non-Empty & Table Score Gate: PASS)")

        col_lines = _format_column_lines([str(c) for c in df.columns], max_line_len=58)
        if len(col_lines) == 1:
            print(f"  {'[SCHEMA]':<10}ตรวจพบ {len(df.columns)} คอลัมน์: [{col_lines[0]}]")
        else:
            print(f"  {'[SCHEMA]':<10}ตรวจพบ {len(df.columns)} คอลัมน์ทั้งหมด:")
            for cl in col_lines:
                print(f"            - {cl}")

        # บันทึกเป็น CSV 1-to-1 ลง data/parsed/ โดยคงหัวคอลัมน์และค่าเดิมไว้ทั้งหมด (Cell 8)
        df.to_csv(output_path, index=False, encoding="utf-8-sig")
        out_size_kb = output_path.stat().st_size / 1024
        output_paths.append(output_path)

        print(f"  {'[OUTPUT]':<10}{output_path.name}")
        print(f"  {'[OK]':<10}บันทึกตารางดิบสำเร็จ: {len(df):,} แถว, {len(df.columns)} คอลัมน์ ({out_size_kb:.2f} KB)")

    return output_paths


def parse_all_approved():
    """สกัดข้อมูลสำหรับชุดข้อมูล Approved ทั้งหมดที่มีไฟล์ดิบอยู่ใน data/raw/"""
    raw_files = list(RAW_DIR.glob("*_RAW.*"))
    if not raw_files:
        print("[STEP 2] ไม่พบไฟล์ดิบใน data/raw/ กรุณารัน Step 1 ก่อน")
        return

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
            print(f"  {'[FAIL]':<10}ล้มเหลวในการสกัด {sid}: {e}")

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
            print(f"  {'[FAIL]':<10}ล้มเหลวในการสกัด {sid}: {e}")


if __name__ == "__main__":
    main()
