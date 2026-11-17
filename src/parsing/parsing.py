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

from contextlib import contextmanager
import io
import logging
import os
import re
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
DATA_ROOT = Path(os.environ.get("CN230_DATA_DIR", PROJECT_ROOT / "data")).resolve()
RAW_DIR = DATA_ROOT / "raw"
PARSED_DIR = DATA_ROOT / "parsed"
ACQUISITION_DIR = PROJECT_ROOT / "src" / "acquisition"

# นำเข้าเครื่องมือจาก Step 1
if str(ACQUISITION_DIR) not in sys.path:
    sys.path.append(str(ACQUISITION_DIR))

from provenance import load_raw_metadata, verify_raw_integrity
from pdf_evidence import load_pdf_evidence

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



@contextmanager
def _quiet_pypdf_warnings():
    """Suppress noisy non-fatal cmap/font warnings emitted by pypdf during text extraction."""
    logger = logging.getLogger("pypdf")
    previous_level = logger.level
    logger.setLevel(logging.ERROR)
    try:
        yield
    finally:
        logger.setLevel(previous_level)


def _read_pdf_pttep(file_path: Path) -> pd.DataFrame:
    """Read the Thailand columns of the PTTEP environmental performance tables."""
    from pypdf import PdfReader

    def table_years(text: str) -> list[int]:
        year_header = re.search(r"Indicator[ \t]+Unit((?:[ \t]+20[0-9]{2})+)", text)
        regions = re.search(r"(?:(?:Thailand[ \t]+International[ \t]+Global)[ \t]*)+", text)
        if not year_header or not regions:
            raise ValueError("SRC-047: ไม่พบหัวตารางปีหรือคอลัมน์ Thailand / International / Global")
        years = list(map(int, year_header.group(1).split()))
        if len(set(years)) != len(years) or len(years) != regions.group().count("Thailand"):
            raise ValueError("SRC-047: จำนวนปีและกลุ่มคอลัมน์ในรายงานไม่ตรงกัน")
        return years

    rows = []
    number = r"(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]+)(?:[.][0-9]+)?|N/A|ND|[-–]"

    def append_metric(text: str, label: str, pdf_unit: str, indicator: str, unit: str,
                      years: list[int], page: int) -> None:
        pattern = rf"(?m)^[ \t]*(?:{label})[ \t]*(?:{pdf_unit})[ \t\r\n]+([^\r\n]+)$"
        matches = re.findall(pattern, text)
        if len(matches) != 1:
            raise ValueError(f"SRC-047 หน้า {page}: ไม่พบแถวและหน่วยที่มีเพียงรายการเดียวสำหรับ {indicator}")
        values = matches[0].split()
        if len(values) != 3 * len(years) or any(not re.fullmatch(number, v) for v in values):
            raise ValueError(f"SRC-047 หน้า {page}: จำนวนคอลัมน์หรือรูปแบบตัวเลขไม่ตรงกับหัวตารางของ {indicator}")
        for year, value in zip(years, values[::3]):
            rows.append((indicator, unit, year, "Thailand",
                         None if value in {"N/A", "ND", "-", "–"} else float(value.replace(",", "")), page))

    with _quiet_pypdf_warnings(), file_path.open("rb") as stream:
        reader = PdfReader(stream)
        if len(reader.pages) < 2:
            raise ValueError("SRC-047: เอกสารมีหน้าไม่พอสำหรับตารางการผลิตและการปล่อย")
        production = reader.pages[0].extract_text(extraction_mode="layout")
        emissions_layout = reader.pages[1].extract_text(extraction_mode="layout")
        emissions = reader.pages[1].extract_text()

    years = table_years(production)
    if table_years(emissions_layout) != years:
        raise ValueError("SRC-047: ปีในตารางการผลิตและการปล่อยไม่ตรงกัน")
    production_labels = r"-?[ \t]*Production from Operating Asset"
    operating_rows = re.search(rf"(?m)^[ \t]*{production_labels}[ \t]+BOE[^\r\n]*\r?\n(?:[ \t]*\r?\n)*[ \t]*Tonne[^\r\n]*", production)
    if not operating_rows or "Hydrocarbon Production" not in production:
        raise ValueError("SRC-047 หน้า 1: ไม่พบยอดผลิตจากสินทรัพย์ที่ดำเนินงาน")
    append_metric(operating_rows.group(), production_labels, "BOE", "Hydrocarbon Production", "BOE", years, 1)
    append_metric(operating_rows.group(), "", "Tonne", "Hydrocarbon Production", "Tonne", years, 1)
    append_metric(production, "Total Direct Energy Consumption by Activity", "GJ",
                  "Direct Energy Consumption", "GJ", years, 1)

    metrics = (
        (r"Total Direct GHG Emissions \(Scope 1\)", r"Tonne[ \t]+CO2\s+Equivalent",
         "Total Direct GHG Emissions (Scope 1)", "Tonne CO2e"),
        (r"Total Methane Emission \(Scope 1\)", "Metric Tonne", "Methane Emissions (Scope 1)", "Metric Tonne"),
        (r"Volatile Organic Compounds \(VOCs\)", "Tonne VOC", "Volatile Organic Compounds (VOCs)", "Tonne VOC"),
        (r"Nitrogen Oxides \(NOx\)", "Tonne NO2", "Nitrogen Oxides (NOx)", "Tonne NO2"),
        (r"Sulfur Oxides \(SOx\)", "Tonne SO2", "Sulfur Oxides (SOx)", "Tonne SO2"),
    )
    for label, pdf_unit, indicator, unit in metrics:
        append_metric(emissions, label, pdf_unit, indicator, unit, years, 2)

    return pd.DataFrame(rows, columns=["indicator", "unit", "year", "territory", "value", "_source_page"])


def _read_reviewed_pdf(file_path: Path, source_id: str, evidence: dict) -> pd.DataFrame:
    """Read reviewed table cells from the exact report version tied to their provenance."""
    from pypdf import PdfReader

    integrity = verify_raw_integrity(str(file_path), verbose=False)
    metadata = load_raw_metadata(str(file_path))
    if not integrity.get("is_valid") or metadata.get("sha256_checksum") != evidence["sha256"]:
        raise ValueError(f"{source_id}: PDF ยังไม่ตรงกับฉบับที่ตรวจไว้ ให้ดึงเอกสารจากต้นทางใหม่")

    rows = []
    with _quiet_pypdf_warnings(), file_path.open("rb") as stream:
        reader = PdfReader(stream)
        page_text = {}
        for cell in evidence["rows"]:
            page = cell["page"]
            if not 1 <= page <= len(reader.pages):
                raise ValueError(f"{source_id}: ไม่พบหน้า PDF {page}")
            if page not in page_text:
                page_text[page] = reader.pages[page - 1].extract_text()
            reported = cell["reported_value"]
            if not re.search(rf"(?<![0-9,]){re.escape(reported)}(?![0-9,])", page_text[page]):
                layout = reader.pages[page - 1].extract_text(extraction_mode="layout")
                if not re.search(rf"(?<![0-9,]){re.escape(reported)}(?![0-9,])", layout):
                    raise ValueError(f"{source_id}: ตรวจสอบค่า {reported} ไม่ได้บน PDF หน้า {page}")
            value = float(reported.replace(",", "")) * cell["multiplier"]
            row = {
                "indicator": cell["indicator"],
                "year": cell["year"],
                "unit": cell["unit"],
                "_source_page": page,
                "_report_scope": evidence["scope"],
                "_report_period": cell["period"],
                "_document_title": evidence["title"],
                "_document_year": evidence["document_year"],
                "_reported_value": reported,
                "_reported_unit": cell["reported_unit"],
                "_conversion_multiplier": cell["multiplier"],
            }
            if evidence["kind"] == "guideline":
                row.update(factor_value=value, regulatory_tier=cell["regulatory_tier"],
                           activity_category=cell["activity_category"])
            else:
                row.update(value=value, territory=evidence["scope"])
                if evidence["kind"] == "operations":
                    row["company"] = evidence["scope"]
            rows.append(row)
    return pd.DataFrame(rows)


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


def parse_raw_data(source_id: str, *, raw_files: list[Path] | None = None) -> list[Path]:
    """
    ฟังก์ชันสกัดโครงสร้างตาราง (Parsing Engine):
    - รับข้อมูลดิบจาก data/raw/<source_id>_*RAW.*
    - ตรวจสอบ Provenance จาก Ledger
    - สกัดข้อมูลตามนามสกุลไฟล์ (.csv, .xlsx, .html) ด้วย flatten_columns และ table_score
    - บันทึกตารางดิบลง data/parsed/ แยก 1-to-1 ตามแต่ละไฟล์ดิบ
    """
    PARSED_DIR.mkdir(parents=True, exist_ok=True)
    if raw_files is None:
        raw_files = sorted(RAW_DIR.glob(f"{source_id}_*RAW.*"))

    if not raw_files:
        raise FileNotFoundError(
            f"ไม่พบไฟล์ดิบของ {source_id} ใน data/raw/ (กรุณารัน Step 1: Data Acquisition ก่อน)"
        )

    is_multi = len(raw_files) > 1
    print(f"  {'[INFO]':<14}ตรวจพบไฟล์ดิบ {len(raw_files)} ไฟล์สำหรับ {source_id}")
    output_paths = []

    for idx, raw_file in enumerate(raw_files, 1):
        ext = raw_file.suffix.lower()
        output_path = get_parsed_output_path(raw_file)
        file_size_kb = raw_file.stat().st_size / 1024

        if is_multi:
            print(f"\n  --- ไฟล์ที่ {idx}/{len(raw_files)} ---")

        print(f"  {'[INPUT]':<14}{raw_file.name} ({file_size_kb:.2f} KB | ชนิด: {ext})")

        # เชื่อมโยง Provenance Metadata จาก Step 1
        try:
            raw_meta = load_raw_metadata(str(raw_file))
            sha_short = raw_meta.get("sha256_checksum", "")[:16]
            batch_id = raw_meta.get("extraction_batch_id", "N/A")
            print(f"  {'[LINEAGE]':<14}Batch: {batch_id} | SHA-256: {sha_short}...")
        except Exception:
            pass

        if ext == ".csv":
            df, detected_enc = _read_csv_raw(raw_file)
            print(f"  {'[PARSE]':<14}อ่านไฟล์ CSV สำเร็จ (ชุดอักขระ: {detected_enc})")
        elif ext in [".xlsx", ".xls"]:
            df, header_idx = _read_excel_raw(raw_file)
            score = table_score(df)
            print(f"  {'[PARSE]':<14}สกัดแผ่นงาน Excel สำเร็จ (พบหัวตารางที่แถว #{header_idx + 1} | Table Score: {score})")
        elif ext in [".html", ".htm"]:
            df, html_info = _read_html_raw(raw_file)
            print(
                f"  {'[DIAG]':<14}ตรวจคำสำคัญใน HTML: พบ {html_info['matched_terms']}/{html_info['total_terms']} คำสำคัญ "
                f"(รวม {html_info['total_occurrences']:,} จุด)"
            )
            print(
                f"  {'[PARSE]':<14}พบ {html_info['num_tables']} ตารางใน HTML -> เลือก Table #{html_info['best_index']} "
                f"(Table Score: {html_info['best_score']})"
            )
        elif ext == ".pdf":
            if source_id == "SRC-047":
                if not verify_raw_integrity(str(raw_file), verbose=False).get("is_valid"):
                    raise ValueError(f"SRC-047: SHA-256 ของ {raw_file.name} ไม่ตรงกับทะเบียนไฟล์ดิบ")
                df = _read_pdf_pttep(raw_file)
                df["_extraction_basis"] = "pdf_table"
                print(f"  {'[PARSE]':<14}สกัดตาราง PTTEP จาก PDF ({len(df)} แถว)")
            elif evidence := load_pdf_evidence().get(source_id):
                df = _read_reviewed_pdf(raw_file, source_id, evidence)
                df["_extraction_basis"] = "verified_pdf_transcription"
                print(f"  {'[PARSE]':<14}ใช้ค่าที่ตรวจจาก PDF ฉบับอ้างอิง ({len(df)} แถว)")
            else:
                raise NotImplementedError(f"ยังไม่มีตัวอ่าน PDF สำหรับ {source_id}")
        else:
            raise NotImplementedError(f"ยังไม่รองรับการอ่านไฟล์ดิบประเภท: {ext}")

        # [RULE 2.4] ตรวจสอบว่าตารางที่สกัดได้ต้องไม่ว่างเปล่าและมีอย่างน้อย 2 คอลัมน์
        if df.empty or len(df.columns) < 2:
            raise ValueError(
                f"ตารางที่สกัดจาก {raw_file.name} ไม่ผ่านเกณฑ์ขั้นต่ำ (แถว={len(df)}, คอลัมน์={len(df.columns)})"
            )
        print(f"  {'[RULE]':<14}ผ่านเกณฑ์คุณภาพการสกัดตาราง (Non-Empty & Table Score Gate: PASS)")

        col_lines = _format_column_lines([str(c) for c in df.columns], max_line_len=58)
        if len(col_lines) == 1:
            print(f"  {'[SCHEMA]':<14}ตรวจพบ {len(df.columns)} คอลัมน์: [{col_lines[0]}]")
        else:
            print(f"  {'[SCHEMA]':<14}ตรวจพบ {len(df.columns)} คอลัมน์ทั้งหมด:")
            for cl in col_lines:
                print(f"                - {cl}")

        # บันทึกเป็น CSV 1-to-1 ลง data/parsed/ โดยคงหัวคอลัมน์และค่าเดิมไว้ทั้งหมด (Cell 8)
        df.to_csv(output_path, index=False, encoding="utf-8-sig")
        out_size_kb = output_path.stat().st_size / 1024
        output_paths.append(output_path)

        print(f"  {'[OUTPUT]':<14}{output_path.name}")
        print(f"  {'[OK]':<14}บันทึกตารางดิบสำเร็จ: {len(df):,} แถว, {len(df.columns)} คอลัมน์ ({out_size_kb:.2f} KB)")

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
