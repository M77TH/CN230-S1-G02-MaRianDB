"""อ่าน accepted/rejected CSV -> แถวของ 10 ตาราง -> โหลดลง MySQL, SQLite และบันทึกเป็น CSV/XLSX"""
from contextlib import closing
from datetime import datetime, timezone
import json
import math
from pathlib import Path
import re
import shutil
import sqlite3

import pandas as pd

if __package__:
    from .connection import (
        ACCEPTED_DIR,
        DATABASE_DIR,
        LEDGER_FILE,
        PROJECT_ROOT,
        REGISTRY_FILE,
        REJECTED_DIR,
        SQLITE_DB_PATH,
        SQL_DIR,
        mysql_cursor,
    )
    from .schema import (
        INDEX_SQL,
        INDEX_SQL_SQLITE,
        SCHEMA_SQLITE,
        TABLE_COLUMNS,
        TABLES_CHILD_FIRST,
        TABLES_PARENT_FIRST,
        create_indexes,
        drop_indexes,
    )
else:
    from connection import (
        ACCEPTED_DIR,
        DATABASE_DIR,
        LEDGER_FILE,
        PROJECT_ROOT,
        REGISTRY_FILE,
        REJECTED_DIR,
        SQLITE_DB_PATH,
        SQL_DIR,
        mysql_cursor,
    )
    from schema import (
        INDEX_SQL,
        INDEX_SQL_SQLITE,
        SCHEMA_SQLITE,
        TABLE_COLUMNS,
        TABLES_CHILD_FIRST,
        TABLES_PARENT_FIRST,
        create_indexes,
        drop_indexes,
    )

INSERT_FILE = SQL_DIR / "02_insert_data.sql"
SCRIPT_VERSION = "pipeline-7step"
BATCH_SIZE = 1000
SQL_INSERT_CHUNK_SIZE = 500

QC_RULES = [
    "Check_Null_URL", "Validate_Unit", "Check_Non_Negative", "Validate_Direction",
    "Check_Process_Year", "Validate_Product_Flow", "Check_Allocation_Burdens",
]

# symbol -> (quantity, to_base_factor); ฐาน: volume=m3, mass=kg, energy=MJ
# shortcut: BOE = 6.1178 GJ (ค่ามาตรฐานทั่วไป) ถ้าทีมใช้ค่าอื่นให้แก้ที่นี่
UNIT_TABLE = {
    "BBL": ("volume", 0.158987), "scf": ("volume", 0.0283168466),
    "BBL/DAY": ("volume per day", 0.158987),
    "MMSCF": ("volume", 28316.846592), "Million Litres": ("volume", 1000.0),
    "Litres": ("volume", 0.001), "m3": ("volume", 1.0),
    "kg": ("mass", 1.0), "kgCO2e": ("mass CO2e", 1.0),
    "gCO2e": ("mass CO2e", 0.001), "tCO2e": ("mass CO2e", 1000.0),
    "Tonne": ("mass", 1000.0), "Tonnes": ("mass", 1000.0), "Metric Tonne": ("mass", 1000.0),
    "Tonne CO2e": ("mass CO2e", 1000.0), "Tonne VOC": ("mass", 1000.0),
    "Tonne NO2": ("mass", 1000.0), "Tonne SO2": ("mass", 1000.0),
    "Tonne NOx": ("mass", 1000.0), "Tonne SOx": ("mass", 1000.0),
    "MJ": ("energy", 1.0), "GJ": ("energy", 1000.0), "kWh": ("energy", 3.6), "BOE": ("energy", 6117.8),
    "%": ("fraction", 0.01), "% Destroyed": ("efficiency", 0.01),
    "CO2e": ("GWP", 1.0), "USD/BBL": ("economic", 1.0),
    "kgCH4/m3 throughput": ("emission factor", 1.0), "kgCO2/TJ": ("emission factor", 0.001),
    "kgCO2/m3 flared": ("emission factor", 1.0),
}

_RAW_YEAR_RE = re.compile(r"(\d{4})\d{2}_RAW(?:\.|$)")


def _num(source_id: str) -> int:
    return int(str(source_id).strip().split("-")[1])


def _utc(ts: str) -> str:
    return datetime.fromisoformat(ts).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _publish_year(raw_file: str) -> int:
    """ประมาณจากชื่อไฟล์ เช่น ..._200301-202603_RAW -> 2026, ..._202408_RAW -> 2024"""
    text = str(raw_file).strip()
    match = _RAW_YEAR_RE.search(text)
    if match:
        return int(match.group(1))
    try:
        return int(text.split("_")[-2].split("-")[-1][:4])
    except (IndexError, ValueError) as exc:
        raise ValueError(f"ไม่สามารถดึง publish_year จากชื่อไฟล์ดิบ '{raw_file}' ได้") from exc


def _to_python_scalar(value):
    """แปลงค่าสเกลาร์จาก pandas/numpy ให้เป็นชนิดข้อมูลพื้นฐานของ Python สำหรับ DB/SQL"""
    if hasattr(value, "item"):
        value = value.item()
    if value is None or (isinstance(value, float) and math.isnan(value)) or pd.isna(value):
        return None
    return value


def _as_bool_int(value) -> int:
    value = _to_python_scalar(value)
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, (int, float)):
        return int(bool(value))
    return int(str(value).strip().lower() in ("true", "1"))


def _read_accepted(accepted_files: list[Path] | None = None) -> pd.DataFrame:
    files = sorted(ACCEPTED_DIR.glob("*_VALID.csv")) if accepted_files is None else accepted_files
    if not files:
        raise FileNotFoundError("ไม่พบไฟล์ใน data/validation/accepted/ กรุณารัน run_pipeline.py ก่อน")
    frames = [pd.read_csv(path, encoding="utf-8-sig") for path in files]
    df = pd.concat(frames, ignore_index=True)
    if df.empty:
        raise ValueError("ไม่มีแถวผ่าน Validation สำหรับส่งออกฐานข้อมูล")
    evidence = json.loads(REGISTRY_FILE.with_name("pdf_evidence.json").read_text(encoding="utf-8"))
    for source_id, rows in df.groupby("_source_id"):
        if source_id not in evidence:
            continue
        expected_fields = {"_extraction_basis", "_source_sha256", "_source_page", "_report_period", "_report_scope"}
        if (
            not expected_fields.issubset(rows.columns)
            or not rows["_extraction_basis"].eq("verified_pdf_transcription").all()
            or not rows["_source_sha256"].eq(evidence[source_id]["sha256"]).all()
            or rows["_source_page"].isna().any()
            or not rows["_report_scope"].eq(evidence[source_id]["scope"]).all()
        ):
            raise ValueError(f"{source_id}: ผล Validation ยังไม่ได้มาจาก PDF ฉบับอ้างอิง กรุณารันใหม่")
    return df


def _load_registry() -> pd.DataFrame:
    reg = pd.read_csv(REGISTRY_FILE, encoding="utf-8-sig")
    reg = reg[reg["source_id"].notna()].copy()
    reg["source_id"] = reg["source_id"].astype(str).str.strip()
    return reg.set_index("source_id")


def _load_ledger() -> dict[str, str]:
    ledger = {}
    for line in LEDGER_FILE.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        rec = json.loads(line)
        ledger[rec["extraction_batch_id"]] = rec["accessed_at"]
    return ledger


def _build_rows(df: pd.DataFrame, rejected_files: list[Path] | None = None) -> dict:
    """แปลง accepted CSV เป็นแถวของแต่ละตาราง (id กำหนดเองเรียง 1..N เพื่อให้โหลดซ้ำได้ค่าเดิมในทรานแซกชันเดียว)"""
    reg = _load_registry()
    ledger = _load_ledger()
    df = df.copy()
    df["_source_id"] = df["_source_id"].astype(str).str.strip()
    df["unit"] = df["unit"].astype(str).str.strip()

    rows = {t: [] for t in TABLES_CHILD_FIRST}
    unit_id, loc_id, flow_id, batch_id, proc_id, ref_id = {}, {}, {}, {}, {}, {}

    for sid, g in df.groupby("_source_id"):
        if sid not in reg.index:
            raise ValueError(f"ไม่พบ {sid} ใน {REGISTRY_FILE}")
        r = reg.loc[sid]
        n = _num(sid)  # source_id = เลขท้ายของ SRC-xxx
        ref_id[sid] = len(ref_id) + 1  # reference_id = ลำดับ 1..N (AUTO_INCREMENT ใน schema)
        first = g.iloc[0]
        document_title = first.get("_document_title")
        title = str(document_title) if pd.notna(document_title) else r["title"]
        if pd.notna(document_title):
            document_year = first.get("_document_year")
            publish_year = int(document_year) if pd.notna(document_year) else None
        else:
            publish_year = _publish_year(first["_raw_file"])
        rows["SOURCE"].append((
            n, title, r["publisher_or_owner"], publish_year,
            f"{r['sector']} | {r['source_type']}", r["url_or_document_id"],
        ))
        rows["REFERENCE"].append((ref_id[sid], title, r["source_type"], first["_source_url"], n))
        for b in g["_extraction_batch_id"].unique():
            if b not in ledger:
                raise ValueError(f"ไม่พบ batch_id '{b}' ใน {LEDGER_FILE}")
            batch_id[b] = len(batch_id) + 1
            rows["EXTRACTION_BATCH"].append((batch_id[b], _utc(ledger[b]), SCRIPT_VERSION, n))

    for sym in df["unit"].unique():
        if sym not in UNIT_TABLE:
            raise ValueError(f"หน่วย '{sym}' ไม่อยู่ใน UNIT_TABLE")
        unit_id[sym] = len(unit_id) + 1
        rows["UNIT"].append((unit_id[sym], sym, *UNIT_TABLE[sym]))

    for name, country in df[["location_name", "country"]].drop_duplicates().itertuples(index=False):
        loc_id[(name, country)] = len(loc_id) + 1
        rows["LOCATION"].append((loc_id[(name, country)], name, country))

    # FLOW: หน่วยเริ่มต้น = หน่วยที่พบครั้งแรก (exchange เก็บหน่วยจริงของตัวเองแยกต่างหาก)
    for t in df.drop_duplicates(["flow_name", "flow_type", "compartment"]).to_dict("records"):
        fkey = (t["flow_name"], t["flow_type"], t["compartment"])
        flow_id[fkey] = len(flow_id) + 1
        rows["FLOW"].append((flow_id[fkey], t["flow_name"], t["flow_type"], t["compartment"], unit_id[t["unit"]]))

    k = len(QC_RULES)
    for i, t in enumerate(df.to_dict("records"), start=1):
        n = _num(t["_source_id"])
        ref = ref_id[t["_source_id"]]
        year = int(t["year"])
        pk = (n, t["process_name"], t["domain"], t["location_name"], t["country"], year)
        if pk not in proc_id:
            proc_id[pk] = len(proc_id) + 1
            rows["PROCESS"].append((
                proc_id[pk], t["process_name"], t["domain"], year,
                loc_id[(t["location_name"], t["country"])], ref,
            ))
        rows["LCI_EXCHANGE"].append((
            i, proc_id[pk], flow_id[(t["flow_name"], t["flow_type"], t["compartment"])], t["direction"],
            _to_python_scalar(t["amount"]), unit_id[t["unit"]], _to_python_scalar(t["allocation"]),
            ref, batch_id[t["_extraction_batch_id"]], _as_bool_int(t["is_reference"]),
        ))
        for j, rule in enumerate(QC_RULES, start=1):
            rows["QUALITY_CHECK"].append(((i - 1) * k + j, rule, "Pass", i))

    # REJECTED_RECORD: batch_id = รอบสกัดของ source เดียวกันที่มีใน accepted
    src_batch = {_num(s): batch_id[b] for s, b in df.groupby("_source_id")["_extraction_batch_id"].first().items()}
    files = sorted(REJECTED_DIR.glob("*_ERR.csv")) if rejected_files is None else rejected_files
    rej_frames = [
        d for d in (pd.read_csv(f, encoding="utf-8-sig") for f in files)
        if not d.empty
    ]
    rej_records = pd.concat(rej_frames, ignore_index=True).to_dict("records") if rej_frames else []
    for rid, t in enumerate(rej_records, start=1):
        n = _num(t["source_id"])
        if n not in src_batch:
            raise ValueError(f"{t['source_id']} มีแถวกักกันแต่ไม่มีแถว accepted จึงไม่มี batch_id")
        # raw_data/error_type ยาวไม่เกิน 255 ตาม schema
        rejected_batch_name = t.get("_extraction_batch_id")
        if pd.notna(rejected_batch_name) and rejected_batch_name not in batch_id:
            if rejected_batch_name not in ledger:
                raise ValueError(f"ไม่พบ batch_id '{rejected_batch_name}' ของแถวกักกันใน {LEDGER_FILE}")
            batch_id[rejected_batch_name] = len(batch_id) + 1
            rows["EXTRACTION_BATCH"].append(
                (batch_id[rejected_batch_name], _utc(ledger[rejected_batch_name]), SCRIPT_VERSION, n)
            )
        rejected_batch = batch_id.get(rejected_batch_name, src_batch[n])
        rows["REJECTED_RECORD"].append((rid, str(t["raw_data"])[:255], str(t["error_type"])[:255], rejected_batch))

    return {
        t: [tuple(_to_python_scalar(val) for val in row) for row in table_rows]
        for t, table_rows in rows.items()
    }


# LCI_EXCHANGE ไม่มีคอลัมน์ source_id ตรง ๆ จึงไล่ผ่าน REFERENCE -> SOURCE
MISSING_SOURCE_SQL = ("SELECT COUNT(*) FROM `LCI_EXCHANGE` e "
                      "LEFT JOIN `REFERENCE` r ON r.reference_id = e.reference_id "
                      "LEFT JOIN `SOURCE` s ON s.source_id = r.source_id WHERE s.source_id IS NULL")


def _insert_rows(cur, rows: dict, placeholder: str) -> None:
    """แทรกข้อมูลทั้ง 10 ตารางตามลำดับตารางแม่ -> ตารางลูก"""
    for t in TABLES_PARENT_FIRST:
        data = rows[t]
        if not data:
            continue
        placeholders = ", ".join([placeholder] * len(data[0]))
        sql = f"INSERT INTO `{t}` VALUES ({placeholders})"
        for i in range(0, len(data), BATCH_SIZE):
            cur.executemany(sql, data[i:i + BATCH_SIZE])


def _assert_no_missing_sources(cur) -> None:
    """ตรวจความสมบูรณ์อ้างอิงก่อน COMMIT: exchange ที่ไม่มีแหล่งข้อมูลต้องเป็น 0"""
    cur.execute(MISSING_SOURCE_SQL)
    missing = cur.fetchone()[0]
    if missing:
        raise RuntimeError(f"พบ {missing} exchange ที่ไม่มีแหล่งข้อมูล ยกเลิกการโหลดทั้งหมด (ROLLBACK)")


def load_database(rows: dict | None = None) -> dict:
    """โหลด accepted CSV ลง MySQL ใน transaction เดียว; รันซ้ำได้ (ลบทุกตารางแล้วโหลดใหม่)"""
    print("\n" + "=" * 80)
    print(">>> [STEP 07/07] DATABASE LAYER (Load accepted data into MySQL)")
    print("=" * 80)
    if rows is None:
        rows = build_all_rows()
    rejected = sorted(REJECTED_DIR.glob("*_ERR.csv"))

    with mysql_cursor(rollback_on_error=True) as (conn, cur, db):
        drop_indexes(cur)  # โหลดซ้ำ: ไม่ให้ Index ถ่วง INSERT สร้างใหม่หลังโหลดเสร็จ
        for t in TABLES_CHILD_FIRST:
            cur.execute(f"DELETE FROM `{t}`")
        _insert_rows(cur, rows, "%s")
        # ตรวจก่อนยืนยัน (ตามตัวอย่างอาจารย์): exchange ที่ไม่มีแหล่งข้อมูลต้องเป็น 0 ถ้าไม่ใช่ให้ ROLLBACK ทั้งชุด
        _assert_no_missing_sources(cur)
        conn.commit()
        create_indexes(cur)  # DDL ทำ commit เองอยู่แล้ว จึงสร้างหลัง COMMIT ข้อมูล

    counts = {t: len(v) for t, v in rows.items()}
    for t in TABLES_PARENT_FIRST:
        print(f"  {'[LOAD]':<14}{t:<17}{counts[t]:>7,} แถว")
    print("=" * 80 + "\n")
    return {"status": "LOADED", "database": db, "rows": counts, "rejected_file_count": len(rejected)}


def build_all_rows(
    accepted_files: list[Path] | None = None, rejected_files: list[Path] | None = None,
) -> dict:
    return _build_rows(_read_accepted(accepted_files), rejected_files)


def _lit(v) -> str:
    """แปลงค่าเป็น SQL literal (ใช้เฉพาะเขียนไฟล์ INSERT; การโหลดจริงใช้ executemany)"""
    v = _to_python_scalar(v)
    if v is None:
        return "NULL"
    if isinstance(v, bool):
        return "1" if v else "0"
    if isinstance(v, (int, float)):
        return repr(v)
    escaped = str(v).replace("\\", "\\\\").replace("'", "''").replace("\r", "\\r").replace("\n", "\\n")
    return f"'{escaped}'"


def write_insert_file(rows: dict, destination: Path = INSERT_FILE) -> None:
    """เขียน sql/02_insert_data.sql จากแถวชุดเดียวกับที่โหลดลง DB (ไฟล์ตรงกับ DB เสมอ)"""
    destination.parent.mkdir(parents=True, exist_ok=True)
    out = ["-- สร้างอัตโนมัติโดย src/database/database.py (ข้อมูลเดียวกับที่โหลดลง MySQL)",
           "-- โหลดเป็นก้อนเดียวใน Transaction: ตรวจผลก่อน COMMIT ถ้าไม่เป็น 0 ให้สั่ง ROLLBACK; แทน",
           "USE petroleum;", "SET FOREIGN_KEY_CHECKS = 0;", "START TRANSACTION;"]
    for t in TABLES_PARENT_FIRST:
        data = rows[t]
        for i in range(0, len(data), SQL_INSERT_CHUNK_SIZE):
            vals = ",\n  ".join("(" + ", ".join(_lit(x) for x in r) + ")" for r in data[i:i + SQL_INSERT_CHUNK_SIZE])
            out.append(f"INSERT INTO `{t}` VALUES\n  {vals};")
    out += ["-- ตรวจผลก่อนยืนยัน: นับ exchange ที่ไม่มีแหล่งข้อมูล (ต้องได้ 0)", MISSING_SOURCE_SQL + ";",
            "COMMIT;", "SET FOREIGN_KEY_CHECKS = 1;",
            "-- สร้าง Index หลังโหลดข้อมูลเสร็จ (เร็วกว่าสร้างก่อนโหลดเมื่อข้อมูลมาก)", INDEX_SQL]
    destination.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    print(f"  {'[FILE]':<14}เขียน {destination.name}")


def load_sqlite(rows: dict | None = None, *, database_path: Path = SQLITE_DB_PATH) -> dict:
    """โหลดข้อมูล 10 ตารางลง SQLite (data/database/petroleum.db) พร้อมสร้าง Index"""
    if rows is None:
        rows = build_all_rows()
    database_path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(database_path)) as conn:
        with closing(conn.cursor()) as cur:
            try:
                cur.executescript(SCHEMA_SQLITE)
                _insert_rows(cur, rows, "?")
                _assert_no_missing_sources(cur)
                cur.execute(INDEX_SQL_SQLITE)
                if cur.execute("PRAGMA foreign_key_check").fetchone() is not None:
                    raise ValueError("SQLite foreign key check failed")
                if cur.execute("PRAGMA quick_check").fetchone() != ("ok",):
                    raise ValueError("SQLite integrity check failed")
                conn.commit()
            except Exception:
                conn.rollback()
                raise
    return {"status": "LOADED_SQLITE", "database": str(database_path), "rows": {t: len(v) for t, v in rows.items()}}


def export_database_files(
    rows: dict | None = None, *, output_dir: Path = DATABASE_DIR, report: bool = True,
) -> dict:
    """
    บันทึกผลลัพธ์ของแต่ละตารางตาม ERD เป็น CSV และ XLSX ลงใน data/database/
    - data/database/csv/<TABLE>.csv (UTF-8 with BOM รองรับภาษาไทยใน Excel)
    - data/database/xlsx/<TABLE>.xlsx
    - data/database/xlsx/petroleum_database.xlsx (รวมทุกชีตในไฟล์เดียว)
    - data/database/petroleum.db (SQLite Standalone Database)
    """
    if rows is None:
        rows = build_all_rows()
    csv_dir = output_dir / "csv"
    xlsx_dir = output_dir / "xlsx"
    sqlite_path = output_dir / "petroleum.db"
    csv_dir.mkdir(parents=True, exist_ok=True)
    xlsx_dir.mkdir(parents=True, exist_ok=True)

    dfs = {}
    for t in TABLES_PARENT_FIRST:
        col_names = TABLE_COLUMNS[t]
        df = pd.DataFrame(rows[t], columns=col_names)
        dfs[t] = df

        # 1. เขียน CSV สำหรับแต่ละตารางตาม ERD
        df.to_csv(csv_dir / f"{t}.csv", index=False, encoding="utf-8-sig")

        # 2. เขียน XLSX สำหรับแต่ละตารางตาม ERD
        df.to_excel(xlsx_dir / f"{t}.xlsx", index=False, engine="openpyxl")

    # 3. เขียน Excel รวมทุกตารางในไฟล์เดียว (all_tables.xlsx แยกแท็บตามแต่ละตารางใน ERD)
    all_tables_file = xlsx_dir / "all_tables.xlsx"
    with pd.ExcelWriter(all_tables_file, engine="openpyxl") as writer:
        # แต่ละตารางแยกเป็น 1 Tab (Sheet) ตาม ERD
        for t in TABLES_PARENT_FIRST:
            dfs[t].to_excel(writer, sheet_name=t[:31], index=False)
        # แท็บพิเศษ ALL_IN_ONE วางทุกตารางเรียงต่อกันในชีตเดียวพร้อมหัวตาราง
        start_row = 0
        for t in TABLES_PARENT_FIRST:
            pd.DataFrame([[f"=== TABLE: {t} ({len(dfs[t])} rows) ==="]]).to_excel(
                writer, sheet_name="ALL_IN_ONE", startrow=start_row, index=False, header=False
            )
            dfs[t].to_excel(writer, sheet_name="ALL_IN_ONE", startrow=start_row + 1, index=False)
            start_row += len(dfs[t]) + 3

    # คัดลอกไปยัง petroleum_database.xlsx และ data/database/all_tables.xlsx เพื่อความสะดวก
    shutil.copy2(all_tables_file, xlsx_dir / "petroleum_database.xlsx")
    shutil.copy2(all_tables_file, output_dir / "all_tables.xlsx")

    # 4. บันทึก/อัปเดต SQLite data/database/petroleum.db
    load_sqlite(rows, database_path=sqlite_path)

    def _rel(path) -> str:
        try:
            return str(path.relative_to(PROJECT_ROOT))
        except ValueError:
            return str(path)

    counts = {t: len(rows[t]) for t in TABLES_PARENT_FIRST}
    if report:
        print(f"  {'[EXPORT]':<14}บันทึกตารางฐานข้อมูลตาม ERD (10 ตาราง):")
        print(f"  {'[EXPORT]':<14}  - CSV  : {_rel(csv_dir)}/*.csv")
        print(f"  {'[EXPORT]':<14}  - XLSX : {_rel(xlsx_dir)}/*.xlsx")
        print(f"  {'[EXPORT]':<14}  - รวม  : {_rel(xlsx_dir)}/all_tables.xlsx (ทุกตารางแยกแท็บ + ชีต ALL_IN_ONE)")
        print(f"  {'[EXPORT]':<14}  - DB   : {_rel(sqlite_path)}")
        for t, cnt in counts.items():
            print(f"    * {t:<17}: {cnt:>5,} แถว")

    return {
        "status": "EXPORTED",
        "csv_dir": str(csv_dir),
        "xlsx_dir": str(xlsx_dir),
        "all_tables_xlsx": str(all_tables_file),
        "sqlite_db": str(sqlite_path),
        "counts": counts,
    }
