"""
=============================================================================
Step 5: Canonicalization & Relational Database Loader
=============================================================================
หน้าที่หลัก:
1. สร้างฐานข้อมูลเชิงสัมพันธ์ SQLite (sql/lci_database.sqlite)
   ตามโครงสร้าง Relational Schema ทั้ง 10 ตารางตาม PDF ข้อ 4.2 & 4.3:
   - LOCATION
   - SOURCE
   - REFERENCE
   - PROCESS
   - UNIT
   - FLOW
   - EXTRACTION_BATCH
   - LCI_EXCHANGE
   - QUALITY_CHECK
   - REJECTED_RECORD
2. กำหนดและบังคับใช้ Primary Keys, Foreign Keys (PRAGMA foreign_keys = ON)
   และ CHECK constraints (เช่น CHECK(direction IN ('IN', 'OUT')))
3. Seed ข้อมูลหลัก (UNIT, LOCATION)
4. หลอมรวมข้อมูลจาก data/accepted/ และ data/rejected/ เข้าสู่ 10 ตาราง
5. ส่งออกไฟล์ส่งมอบสำหรับเพื่อนร่วมทีม:
   - ไฟล์ SQLite: sql/lci_database.sqlite (และ data/lci_database.sqlite)
   - ไฟล์ CSV แยกรายตาราง 10 ไฟล์: data/database_export/<TABLE_NAME>.csv
   - ไฟล์สคริปต์ SQL: sql/01_create_schema.sql, sql/02_seed_master_data.sql,
     sql/03_insert_lci_data.sql, sql/04_verification_queries.sql
=============================================================================
"""

import csv
import json
import os
import re
import sqlite3
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path
import pandas as pd

# กำหนด Console encoding สำหรับ Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent.parent
ACCEPTED_DIR = PROJECT_ROOT / "data" / "accepted"
REJECTED_DIR = PROJECT_ROOT / "data" / "rejected"
RAW_DIR = PROJECT_ROOT / "data" / "raw"
DOCS_DIR = PROJECT_ROOT / "docs"
SQL_DIR = PROJECT_ROOT / "sql"
EXPORT_DIR = PROJECT_ROOT / "data" / "database_export"

DB_PATH = SQL_DIR / "lci_database.sqlite"
SECONDARY_DB_PATH = PROJECT_ROOT / "data" / "lci_database.sqlite"

BKK_TZ = timezone(timedelta(hours=7))

# ---------------------------------------------------------------------------
# DDL Definition for 10 Normalized Relational Tables (Section 4.2 & 4.3)
# ---------------------------------------------------------------------------
DDL_STATEMENTS = """
-- ============================================================================
-- CN230 Petroleum Life Cycle Inventory (LCI) Relational Database Schema
-- Normalized to 3NF conforming to Section 4.1 ERD & Section 4.2 Schema
-- ============================================================================

PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS REJECTED_RECORD;
DROP TABLE IF EXISTS QUALITY_CHECK;
DROP TABLE IF EXISTS LCI_EXCHANGE;
DROP TABLE IF EXISTS PROCESS;
DROP TABLE IF EXISTS FLOW;
DROP TABLE IF EXISTS EXTRACTION_BATCH;
DROP TABLE IF EXISTS REFERENCE;
DROP TABLE IF EXISTS SOURCE;
DROP TABLE IF EXISTS LOCATION;
DROP TABLE IF EXISTS UNIT;

-- 1. ตาราง LOCATION
CREATE TABLE LOCATION (
    location_id INTEGER PRIMARY KEY AUTOINCREMENT,
    name VARCHAR(100) NOT NULL,
    country VARCHAR(50) NOT NULL DEFAULT 'Thailand',
    CONSTRAINT uq_location_name UNIQUE (name, country)
);

-- 2. ตาราง SOURCE
CREATE TABLE SOURCE (
    source_id INTEGER PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    publisher VARCHAR(150) NOT NULL,
    publish_year INTEGER,
    description VARCHAR(255),
    url VARCHAR(255) NOT NULL
);

-- 3. ตาราง REFERENCE
CREATE TABLE REFERENCE (
    reference_id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference_name VARCHAR(255) NOT NULL,
    reference_type VARCHAR(20) NOT NULL,
    reference_url VARCHAR(255),
    source_id INTEGER NOT NULL,
    FOREIGN KEY (source_id) REFERENCES SOURCE (source_id) ON DELETE CASCADE
);

-- 4. ตาราง UNIT
CREATE TABLE UNIT (
    unit_id INTEGER PRIMARY KEY,
    symbol VARCHAR(20) NOT NULL UNIQUE,
    quantity VARCHAR(50) NOT NULL,
    to_base_factor DECIMAL(18,6) NOT NULL
);

-- 5. ตาราง FLOW
CREATE TABLE FLOW (
    flow_id INTEGER PRIMARY KEY AUTOINCREMENT,
    flow_name VARCHAR(150) NOT NULL,
    flow_type VARCHAR(50) NOT NULL,
    compartment VARCHAR(100),
    unit_id INTEGER NOT NULL,
    FOREIGN KEY (unit_id) REFERENCES UNIT (unit_id),
    CONSTRAINT uq_flow UNIQUE (flow_name, flow_type, compartment)
);

-- 6. ตาราง PROCESS
CREATE TABLE PROCESS (
    process_id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_name VARCHAR(150) NOT NULL,
    domain VARCHAR(100) NOT NULL DEFAULT 'Petroleum',
    process_year INTEGER,
    location_id INTEGER NOT NULL,
    reference_id INTEGER NOT NULL,
    FOREIGN KEY (location_id) REFERENCES LOCATION (location_id),
    FOREIGN KEY (reference_id) REFERENCES REFERENCE (reference_id),
    CONSTRAINT uq_process UNIQUE (process_name, domain, process_year, location_id, reference_id)
);

-- 7. ตาราง EXTRACTION_BATCH
CREATE TABLE EXTRACTION_BATCH (
    batch_id INTEGER PRIMARY KEY AUTOINCREMENT,
    extraction_time TIMESTAMP NOT NULL,
    script_version VARCHAR(50) NOT NULL,
    source_id INTEGER NOT NULL,
    batch_code VARCHAR(100) UNIQUE,
    FOREIGN KEY (source_id) REFERENCES SOURCE (source_id)
);

-- 8. ตาราง LCI_EXCHANGE
CREATE TABLE LCI_EXCHANGE (
    exchange_id INTEGER PRIMARY KEY AUTOINCREMENT,
    process_id INTEGER NOT NULL,
    flow_id INTEGER NOT NULL,
    direction VARCHAR(3) NOT NULL CHECK (direction IN ('IN', 'OUT')),
    amount DECIMAL(18,6) NOT NULL,
    unit_id INTEGER NOT NULL,
    reference_id INTEGER NOT NULL,
    batch_id INTEGER NOT NULL,
    is_reference BOOLEAN NOT NULL DEFAULT 0,
    FOREIGN KEY (process_id) REFERENCES PROCESS (process_id),
    FOREIGN KEY (flow_id) REFERENCES FLOW (flow_id),
    FOREIGN KEY (unit_id) REFERENCES UNIT (unit_id),
    FOREIGN KEY (reference_id) REFERENCES REFERENCE (reference_id),
    FOREIGN KEY (batch_id) REFERENCES EXTRACTION_BATCH (batch_id)
);

-- 9. ตาราง QUALITY_CHECK
CREATE TABLE QUALITY_CHECK (
    check_id INTEGER PRIMARY KEY AUTOINCREMENT,
    rule_name VARCHAR(150) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('Pass', 'Fail')),
    exchange_id INTEGER,
    FOREIGN KEY (exchange_id) REFERENCES LCI_EXCHANGE (exchange_id)
);

-- 10. ตาราง REJECTED_RECORD
CREATE TABLE REJECTED_RECORD (
    rejected_id INTEGER PRIMARY KEY AUTOINCREMENT,
    raw_data VARCHAR(255) NOT NULL,
    error_type VARCHAR(255) NOT NULL,
    check_id INTEGER NOT NULL,
    FOREIGN KEY (check_id) REFERENCES QUALITY_CHECK (check_id)
);

-- ดัชนีเพื่อเพิ่มประสิทธิภาพการค้นหา (Performance Indexes)
CREATE INDEX idx_exchange_process ON LCI_EXCHANGE (process_id);
CREATE INDEX idx_exchange_flow ON LCI_EXCHANGE (flow_id);
CREATE INDEX idx_process_location ON PROCESS (location_id);
CREATE INDEX idx_flow_unit ON FLOW (unit_id);
CREATE INDEX idx_qc_exchange ON QUALITY_CHECK (exchange_id);
"""

# Seed Data สำหรับตาราง UNIT
SEED_UNITS = [
    (1, "BBL/DAY", "Flow Rate", 158.987300),
    (2, "MMSCF/DAY", "Flow Rate", 28316.846600),
    (3, "Million Litres", "Volume", 1000000.000000),
    (4, "Litres", "Volume", 1.000000),
    (5, "kg", "Mass", 1.000000),
    (6, "Tonnes", "Mass", 1000.000000),
    (7, "MJ", "Energy", 1.000000),
    (8, "kWh", "Energy", 3.600000),
    (9, "m3", "Volume", 1000.000000),
    (10, "kgCO2e", "Emission", 1.000000),
    (11, "gCO2e", "Emission", 0.001000),
    (12, "tCO2e", "Emission", 1000.000000),
]


def load_source_registry_records() -> list[dict]:
    """โหลดข้อมูลจาก docs/source_registry/source_registry.csv หรือ .xlsx"""
    csv_path = DOCS_DIR / "source_registry" / "source_registry.csv"
    if csv_path.exists():
        with open(csv_path, encoding="utf-8-sig") as f:
            return list(csv.DictReader(f))
    xlsx_path = DOCS_DIR / "source_registry" / "source_registry.xlsx"
    if xlsx_path.exists():
        import openpyxl
        wb = openpyxl.load_workbook(xlsx_path, data_only=True)
        ws = wb["Source Registry"] if "Source Registry" in wb.sheetnames else wb.sheetnames[0]
        rows = list(ws.iter_rows(values_only=True))
        wb.close()
        headers = [str(c).strip() for c in rows[0]]
        return [dict(zip(headers, r)) for r in rows[1:] if any(r)]
    return []


def load_provenance_records() -> list[dict]:
    """โหลดประวัติการดึงข้อมูลจาก _provenance_ledger.jsonl"""
    ledger_path = RAW_DIR / "_provenance_ledger.jsonl"
    if not ledger_path.exists():
        return []
    records = []
    with open(ledger_path, encoding="utf-8") as f:
        for line in f:
            if line.strip():
                try:
                    records.append(json.loads(line.strip()))
                except Exception:
                    pass
    return records


def parse_source_int_id(sid_str: str) -> int:
    """แปลงรหัส 'SRC-044' -> 44 (หรือ 100+ สำหรับตัวเลข)"""
    match = re.search(r"\d+", sid_str)
    return int(match.group(0)) if match else 100


def build_canonical_database() -> dict:
    """
    สร้างฐานข้อมูลเชิงสัมพันธ์ SQLite และนำเข้าข้อมูลทั้งหมด 10 ตาราง
    """
    SQL_DIR.mkdir(parents=True, exist_ok=True)
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)

    # 1. บันทึกสคริปต์ 01_create_schema.sql
    schema_sql_path = SQL_DIR / "01_create_schema.sql"
    with open(schema_sql_path, "w", encoding="utf-8") as f:
        f.write(DDL_STATEMENTS.strip())

    # 2. เชื่อมต่อฐานข้อมูล SQLite และสร้างตาราง
    conn = sqlite3.connect(DB_PATH)
    conn.execute("PRAGMA foreign_keys = ON;")
    conn.executescript(DDL_STATEMENTS)

    cursor = conn.cursor()

    # 3. นำเข้า Master Data: UNIT
    cursor.executemany(
        "INSERT INTO UNIT (unit_id, symbol, quantity, to_base_factor) VALUES (?, ?, ?, ?)",
        SEED_UNITS,
    )
    conn.commit()

    # บันทึกสคริปต์ 02_seed_master_data.sql
    seed_sql_lines = ["-- Master Data Seed for UNIT Table"]
    for u in SEED_UNITS:
        seed_sql_lines.append(
            f"INSERT OR IGNORE INTO UNIT (unit_id, symbol, quantity, to_base_factor) "
            f"VALUES ({u[0]}, '{u[1]}', '{u[2]}', {u[3]});"
        )
    with open(SQL_DIR / "02_seed_master_data.sql", "w", encoding="utf-8") as f:
        f.write("\n".join(seed_sql_lines))

    # 4. นำเข้า SOURCE
    catalog_rows = load_source_registry_records()
    source_map = {}  # "SRC-044" -> int source_id
    for r in catalog_rows:
        sid_raw = r.get("source_id", "").strip()
        if not sid_raw:
            continue
        sid_int = parse_source_int_id(sid_raw)
        title = r.get("title", "").strip()
        pub = r.get("publisher_or_owner", "").strip()
        url = r.get("url_or_document_id", "").strip()
        sector = r.get("sector", "").strip()
        notes = r.get("notes", "").strip()
        desc = f"{sector} | {notes}".strip(" |")

        # Extract publish year if possible
        year_match = re.search(r"20\d\d|25\d\d", r.get("accessed_at", "") + " " + title)
        pub_year = None
        if year_match:
            y = int(year_match.group(0))
            pub_year = y - 543 if y > 2400 else y

        cursor.execute(
            """
            INSERT OR REPLACE INTO SOURCE (source_id, title, publisher, publish_year, description, url)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (sid_int, title, pub, pub_year, desc, url),
        )
        source_map[sid_raw] = sid_int
    conn.commit()

    # 5. นำเข้า EXTRACTION_BATCH & REFERENCE จาก Provenance Ledger
    prov_rows = load_provenance_records()
    batch_map = {}  # batch_code -> int batch_id
    ref_map = {}    # raw_file_name -> int reference_id

    for p in prov_rows:
        sid_str = p.get("source_id", "")
        sid_int = source_map.get(sid_str, parse_source_int_id(sid_str))
        batch_code = p.get("extraction_batch_id", "")
        time_str = p.get("accessed_at") or p.get("retrieved_at_utc") or datetime.now(BKK_TZ).isoformat()
        raw_path = p.get("raw_file_path", "")
        raw_name = os.path.basename(raw_path)
        ext = os.path.splitext(raw_name)[1].replace(".", "").lower() or "csv"
        src_url = p.get("source_url", "")

        # Insert Batch
        if batch_code and batch_code not in batch_map:
            cursor.execute(
                """
                INSERT INTO EXTRACTION_BATCH (extraction_time, script_version, source_id, batch_code)
                VALUES (?, ?, ?, ?)
                """,
                (time_str, "v1.2.0", sid_int, batch_code),
            )
            batch_map[batch_code] = cursor.lastrowid

        # Insert Reference
        if raw_name and raw_name not in ref_map:
            cursor.execute(
                """
                INSERT INTO REFERENCE (reference_name, reference_type, reference_url, source_id)
                VALUES (?, ?, ?, ?)
                """,
                (raw_name, ext, src_url, sid_int),
            )
            ref_map[raw_name] = cursor.lastrowid

    conn.commit()

    # 6. แคช Lookup Tables (LOCATION, FLOW, UNIT)
    unit_map = {u[1]: u[0] for u in SEED_UNITS}

    cursor.execute("SELECT location_id, name, country FROM LOCATION")
    loc_cache = {row[1]: row[0] for row in cursor.fetchall()}

    cursor.execute("SELECT flow_id, flow_name FROM FLOW")
    flow_cache = {row[1]: row[0] for row in cursor.fetchall()}

    cursor.execute("SELECT process_id, process_name, domain, process_year, location_id, reference_id FROM PROCESS")
    proc_cache = {(r[1], r[2], r[3], r[4], r[5]): r[0] for r in cursor.fetchall()}

    # 7. อ่านข้อมูลที่ผ่านการตรวจสอบจาก data/accepted/*_ACCEPTED.csv
    accepted_files = sorted(ACCEPTED_DIR.glob("*_ACCEPTED.csv"))
    print(f"  {'[CANONICAL]':<14}โหลดข้อมูลที่ผ่านเกณฑ์จาก {len(accepted_files)} ไฟล์ใน data/accepted/")

    total_exchanges = 0
    total_qcs = 0

    for fpath in accepted_files:
        df = pd.read_csv(fpath, low_memory=False)
        if df.empty:
            continue

        raw_name = df["_raw_file"].iloc[0] if "_raw_file" in df.columns else ""
        sid_str = df["_source_id"].iloc[0] if "_source_id" in df.columns else ""
        sid_int = source_map.get(sid_str, parse_source_int_id(sid_str))
        batch_code = df["_extraction_batch_id"].iloc[0] if "_extraction_batch_id" in df.columns else ""

        # รับประกันว่ามี reference_id และ batch_id
        if raw_name not in ref_map:
            ext = os.path.splitext(raw_name)[1].replace(".", "").lower() or "csv"
            url = df["_source_url"].iloc[0] if "_source_url" in df.columns else ""
            cursor.execute(
                "INSERT INTO REFERENCE (reference_name, reference_type, reference_url, source_id) VALUES (?, ?, ?, ?)",
                (raw_name, ext, url, sid_int),
            )
            ref_map[raw_name] = cursor.lastrowid
        ref_id = ref_map[raw_name]

        if batch_code not in batch_map:
            cursor.execute(
                "INSERT INTO EXTRACTION_BATCH (extraction_time, script_version, source_id, batch_code) VALUES (?, ?, ?, ?)",
                (datetime.now(BKK_TZ).isoformat(), "v1.2.0", sid_int, batch_code or f"BATCH-{sid_str}"),
            )
            batch_map[batch_code] = cursor.lastrowid
        batch_id = batch_map[batch_code]

        # รวมแถวข้อมูลเตรียม Batch Insert
        exchange_inserts = []
        qc_inserts = []

        for _, row in df.iterrows():
            loc_name = str(row.get("location_name", "ประเทศไทย (Thailand)")).strip()
            country = str(row.get("country", "Thailand")).strip()

            # Location Lookup / Insert
            if loc_name not in loc_cache:
                cursor.execute(
                    "INSERT INTO LOCATION (name, country) VALUES (?, ?)",
                    (loc_name, country),
                )
                loc_cache[loc_name] = cursor.lastrowid
            loc_id = loc_cache[loc_name]

            # Flow Lookup / Insert
            fl_name = str(row.get("flow_name", "Crude Oil")).strip()
            fl_type = str(row.get("flow_type", "product")).strip()
            fl_comp = str(row.get("compartment", "technosphere")).strip()
            u_sym = str(row.get("unit", "BBL/DAY")).strip()
            u_id = unit_map.get(u_sym, 1)

            if fl_name not in flow_cache:
                cursor.execute(
                    "INSERT INTO FLOW (flow_name, flow_type, compartment, unit_id) VALUES (?, ?, ?, ?)",
                    (fl_name, fl_type, fl_comp, u_id),
                )
                flow_cache[fl_name] = cursor.lastrowid
            fl_id = flow_cache[fl_name]

            # Process Lookup / Insert
            proc_name = str(row.get("process_name", "กระบวนการปิโตรเลียม")).strip()
            proc_domain = str(row.get("domain", "Petroleum")).strip()
            proc_year = int(float(row.get("year", 2024))) if pd.notna(row.get("year")) else None
            proc_key = (proc_name, proc_domain, proc_year, loc_id, ref_id)

            if proc_key not in proc_cache:
                cursor.execute(
                    """
                    INSERT INTO PROCESS (process_name, domain, process_year, location_id, reference_id)
                    VALUES (?, ?, ?, ?, ?)
                    """,
                    (proc_name, proc_domain, proc_year, loc_id, ref_id),
                )
                proc_cache[proc_key] = cursor.lastrowid
            proc_id = proc_cache[proc_key]

            # LCI_EXCHANGE parameters
            direction = str(row.get("direction", "OUT")).strip().upper()
            amount = float(row.get("amount", row.get("quantity", 0.0)))
            is_ref = 1 if bool(row.get("is_reference", False)) else 0

            exchange_inserts.append((proc_id, fl_id, direction, amount, u_id, ref_id, batch_id, is_ref))

        cursor.executemany(
            """
            INSERT INTO LCI_EXCHANGE (process_id, flow_id, direction, amount, unit_id, reference_id, batch_id, is_reference)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            exchange_inserts,
        )
        total_exchanges += len(exchange_inserts)

        # บันทึก Quality Check (สถานะ Pass สำหรับแถวที่ผ่านเกณฑ์)
        cursor.execute(
            """
            INSERT INTO QUALITY_CHECK (rule_name, status, exchange_id)
            SELECT 'General_LCI_Validation', 'Pass', exchange_id
            FROM LCI_EXCHANGE
            WHERE exchange_id NOT IN (SELECT exchange_id FROM QUALITY_CHECK WHERE exchange_id IS NOT NULL)
            """
        )
        total_qcs += len(exchange_inserts)

        conn.commit()

    # 8. อ่านข้อมูลที่ไม่ผ่านเกณฑ์จาก data/rejected/*_REJECTED.csv
    rejected_files = sorted(REJECTED_DIR.glob("*_REJECTED.csv"))
    total_rejections = 0
    for rpath in rejected_files:
        df_rej = pd.read_csv(rpath, low_memory=False)
        if df_rej.empty:
            continue
        for _, rrow in df_rej.iterrows():
            r_name = str(rrow.get("rule_name", "Quality_Rule_Violation"))
            err_type = str(rrow.get("error_type", "Validation Error"))
            raw_data = str(rrow.get("raw_data", "{}"))

            # บันทึก QC ล้มเหลว
            cursor.execute(
                "INSERT INTO QUALITY_CHECK (rule_name, status, exchange_id) VALUES (?, ?, ?)",
                (r_name, "Fail", None),
            )
            qc_fail_id = cursor.lastrowid

            # บันทึก REJECTED_RECORD
            cursor.execute(
                "INSERT INTO REJECTED_RECORD (raw_data, error_type, check_id) VALUES (?, ?, ?)",
                (raw_data, err_type, qc_fail_id),
            )
            total_rejections += 1
        conn.commit()

    # 9. ส่งออกไฟล์ CSV ทั้ง 10 ตารางไปยัง data/database_export/
    TABLES = [
        "LOCATION",
        "SOURCE",
        "REFERENCE",
        "PROCESS",
        "UNIT",
        "FLOW",
        "EXTRACTION_BATCH",
        "LCI_EXCHANGE",
        "QUALITY_CHECK",
        "REJECTED_RECORD",
    ]

    table_counts = {}
    for tbl in TABLES:
        df_export = pd.read_sql_query(f"SELECT * FROM {tbl}", conn)
        csv_out = EXPORT_DIR / f"{tbl}.csv"
        df_export.to_csv(csv_out, index=False, encoding="utf-8-sig")
        table_counts[tbl] = len(df_export)

    # คัดลอกฐานข้อมูลไปยัง data/lci_database.sqlite เพื่อความสะดวก
    SECONDARY_DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(DB_PATH, "rb") as fsrc, open(SECONDARY_DB_PATH, "wb") as fdst:
        fdst.write(fsrc.read())

    # 10. สร้างไฟล์สคริปต์ 03_insert_lci_data.sql
    insert_sql_path = SQL_DIR / "03_insert_lci_data.sql"
    with open(insert_sql_path, "w", encoding="utf-8") as f_ins:
        f_ins.write("-- ============================================================================\n")
        f_ins.write("-- SQL Insert Script for CN230 Petroleum LCI Database\n")
        f_ins.write("-- ============================================================================\n\n")
        f_ins.write("PRAGMA foreign_keys = OFF;\nBEGIN TRANSACTION;\n\n")
        for line in conn.iterdump():
            if line.startswith("INSERT INTO"):
                f_ins.write(f"{line}\n")
        f_ins.write("\nCOMMIT;\nPRAGMA foreign_keys = ON;\n")

    # 11. สร้างไฟล์สคริปต์ 04_verification_queries.sql
    VERIFICATION_QUERIES = """
-- ============================================================================
-- SQL Verification Suite for CN230 Petroleum LCI Database
-- ============================================================================

-- Query 1: นับจำนวนระเบียนในทุกตาราง (Record Counts per Table)
SELECT 'LOCATION' AS table_name, COUNT(*) AS count FROM LOCATION
UNION ALL
SELECT 'SOURCE', COUNT(*) FROM SOURCE
UNION ALL
SELECT 'REFERENCE', COUNT(*) FROM REFERENCE
UNION ALL
SELECT 'PROCESS', COUNT(*) FROM PROCESS
UNION ALL
SELECT 'UNIT', COUNT(*) FROM UNIT
UNION ALL
SELECT 'FLOW', COUNT(*) FROM FLOW
UNION ALL
SELECT 'EXTRACTION_BATCH', COUNT(*) FROM EXTRACTION_BATCH
UNION ALL
SELECT 'LCI_EXCHANGE', COUNT(*) FROM LCI_EXCHANGE
UNION ALL
SELECT 'QUALITY_CHECK', COUNT(*) FROM QUALITY_CHECK
UNION ALL
SELECT 'REJECTED_RECORD', COUNT(*) FROM REJECTED_RECORD;

-- Query 2: ตรวจสอบความสมบูรณ์ของ Foreign Key (Foreign Key Integrity Check)
PRAGMA foreign_key_check;

-- Query 3: สรุปภาพรวมปริมาณสายไหลขาเข้า-ขาออก (Input vs Output Balance by Process)
SELECT 
    p.process_name,
    p.domain,
    e.direction,
    f.flow_name,
    u.symbol AS unit,
    ROUND(SUM(e.amount), 2) AS total_amount,
    COUNT(e.exchange_id) AS record_count
FROM LCI_EXCHANGE e
JOIN PROCESS p ON e.process_id = p.process_id
JOIN FLOW f ON e.flow_id = f.flow_id
JOIN UNIT u ON e.unit_id = u.unit_id
GROUP BY p.process_name, p.domain, e.direction, f.flow_name, u.symbol
ORDER BY p.domain, p.process_name, e.direction;

-- Query 4: ตรวจสอบ Functional Unit (ต้องมี is_reference = 1)
SELECT 
    p.process_id,
    p.process_name,
    f.flow_name AS reference_product,
    u.symbol AS unit,
    COUNT(*) AS ref_count
FROM LCI_EXCHANGE e
JOIN PROCESS p ON e.process_id = p.process_id
JOIN FLOW f ON e.flow_id = f.flow_id
JOIN UNIT u ON e.unit_id = u.unit_id
WHERE e.is_reference = 1
GROUP BY p.process_id, p.process_name, f.flow_name, u.symbol
LIMIT 10;

-- Query 5: ตรวจสอบ Data Lineage ย้อนกลับสู่แหล่งกำเนิดภาครัฐ (Traceability to Government Source)
SELECT 
    e.exchange_id,
    p.process_name,
    f.flow_name,
    e.direction,
    e.amount,
    u.symbol,
    s.publisher,
    s.title AS source_title,
    s.url AS main_portal_url,
    b.batch_code,
    b.extraction_time
FROM LCI_EXCHANGE e
JOIN PROCESS p ON e.process_id = p.process_id
JOIN FLOW f ON e.flow_id = f.flow_id
JOIN UNIT u ON e.unit_id = u.unit_id
JOIN REFERENCE r ON e.reference_id = r.reference_id
JOIN SOURCE s ON r.source_id = s.source_id
JOIN EXTRACTION_BATCH b ON e.batch_id = b.batch_id
LIMIT 5;
"""
    with open(SQL_DIR / "04_verification_queries.sql", "w", encoding="utf-8") as f:
        f.write(VERIFICATION_QUERIES.strip())

    conn.close()

    return {
        "db_path": DB_PATH,
        "table_counts": table_counts,
        "total_exchanges": total_exchanges,
        "total_qcs": total_qcs,
        "total_rejections": total_rejections,
    }


def canonicalize_data(source_id: str = "SRC-044") -> dict:
    """
    ฟังก์ชันเชื่อมโยงสำหรับไปป์ไลน์หลัก
    """
    res = build_canonical_database()
    print(f"  {'[CANONICAL]':<14}สร้างฐานข้อมูลเชิงสัมพันธ์สำเร็จ: {DB_PATH.name}")
    print(f"  {'[EXPORT]':<14}ส่งออก 10 ตารางสู่ CSV ที่ data/database_export/")
    for tbl, cnt in res["table_counts"].items():
        print(f"    - {tbl:<18}: {cnt:,} แถว")
    return res


if __name__ == "__main__":
    canonicalize_data()
