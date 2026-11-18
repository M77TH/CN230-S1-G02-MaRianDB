"""
=============================================================================
Step 07: Database Layer (สร้างไฟล์ SQL, CSV/XLSX/SQLite และ MySQL ตาม ERD 10 ตาราง)
=============================================================================
python src/database/database.py                     # ส่งออก CSV/XLSX/SQLite/SQL เป็นชุดเดียว + โหลด MySQL ถ้ามี
python src/database/database.py export              # บันทึก data/database/csv/ และ data/database/xlsx/ + petroleum.db
python src/database/database.py files               # เขียนไฟล์ sql/01..03
python src/database/database.py create | load       # จัดการ MySQL

ลำดับของ `all`:
   1. เตรียม database/sql/01_schema.sql และ 01_schema_sqlite.sql ในชุดส่งออก
   2. เตรียม database/sql/02_insert_data.sql จากข้อมูลชุดเดียวกัน
   3. เตรียม database/sql/03_fr_queries.sql สำหรับตรวจ FR/BR
   4. บันทึกตารางฐานข้อมูลตาม ERD                          (loader.py)   data/database/csv/*.csv
                                                                       data/database/xlsx/*.xlsx (+ petroleum_database.xlsx)
                                                                       data/database/petroleum.db (SQLite)
   5. สร้างตารางและโหลดลง MySQL (ถ้ามีการตั้งค่า .env)       (schema/loader)

ค่าเชื่อมต่อ MySQL อยู่ใน .env (ดู .env.example) ไม่เก็บรหัสผ่านในโค้ด
=============================================================================
"""
import argparse
import csv
from contextlib import closing, contextmanager
import hashlib
import json
import os
import shutil
import sqlite3
import sys
import time
from datetime import datetime, timezone
from tempfile import TemporaryDirectory
from pathlib import Path

if sys.platform == "win32":  # ป้องกันปัญหาภาษาไทยใน Console ของ Windows
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

if __package__:
    from . import loader, queries, schema
    from .connection import ACCEPTED_DIR, DATABASE_DIR, DATA_ROOT, REJECTED_DIR, has_mysql_config
else:
    sys.path.insert(0, str(Path(__file__).resolve().parent))  # ให้ import ไฟล์พี่น้องได้เมื่อรันสคริปต์โดยตรง
    import loader
    import queries
    import schema
    from connection import ACCEPTED_DIR, DATABASE_DIR, DATA_ROOT, REJECTED_DIR, has_mysql_config

VALID_COMMANDS = ("all", "create", "load", "files", "export")


def export_database() -> dict:
    """จุดเรียกสำหรับส่งออกตารางตาม ERD เป็น CSV, XLSX และ SQLite"""
    accepted_files = sorted(ACCEPTED_DIR.glob("*_VALID.csv"))
    rejected_files = sorted(REJECTED_DIR.glob("*_ERR.csv"))
    rows = loader.build_all_rows(accepted_files, rejected_files)
    return _write_snapshot(rows, accepted_files, rejected_files, include_sql=False)


def load_database() -> dict:
    """จุดเรียกจากไปป์ไลน์: โหลด accepted CSV ลง MySQL"""
    return loader.load_database()


# Alias เพื่อความเข้ากันได้ย้อนหลัง
build_and_verify_database = run_database = run_analysis = load_database


def _replace_path(source: Path, destination: Path) -> None:
    """Replace a file or directory with short retries for transient Windows reader locks."""
    for attempt in range(6):
        try:
            source.replace(destination)
            return
        except PermissionError as error:
            if attempt == 5:
                raise RuntimeError("ปิดไฟล์ในโฟลเดอร์ฐานข้อมูลแล้วลองส่งออกอีกครั้ง") from error
            time.sleep(0.15)


def _sync_snapshot_contents(source: Path, destination: Path) -> None:
    """Fall back to per-file atomic replacement when Windows watchers hold the root directory handle."""
    expected_rel = {item.relative_to(source) for item in source.rglob("*")}
    destination.mkdir(parents=True, exist_ok=True)
    for item in sorted(source.rglob("*")):
        rel = item.relative_to(source)
        target = destination / rel
        if item.is_dir():
            target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            _replace_path(item, target)
    for existing in sorted(destination.rglob("*"), reverse=True):
        rel = existing.relative_to(destination)
        if rel in expected_rel or existing.name == ".gitkeep":
            continue
        if existing.is_file():
            existing.unlink()
        elif existing.is_dir():
            try:
                existing.rmdir()
            except OSError:
                pass


def _promote_snapshot(output: Path, destination: Path, previous: Path) -> None:
    """Publish staged snapshot atomically, falling back to in-place file sync if dir swap is locked."""
    if destination.is_symlink() or previous.is_symlink():
        raise ValueError("Database output directories must not be symlinks")
    if previous.exists() and not destination.exists():
        _replace_path(previous, destination)
    if previous.exists():
        shutil.rmtree(previous)
    for rel_keep in (Path(".gitkeep"), Path("csv/.gitkeep"), Path("xlsx/.gitkeep")):
        if (destination / rel_keep).is_file():
            keep_copy = output / rel_keep
            keep_copy.parent.mkdir(parents=True, exist_ok=True)
            keep_copy.touch()
    if not destination.exists():
        _replace_path(output, destination)
        return

    try:
        destination.replace(previous)
    except PermissionError:
        _sync_snapshot_contents(output, destination)
        return

    try:
        _replace_path(output, destination)
    except (OSError, RuntimeError):
        if previous.exists():
            _replace_path(previous, destination)
        raise
    if previous.exists():
        try:
            shutil.rmtree(previous)
        except OSError as error:
            print(f"  {'[NOTICE]':<14}Published database, previous files still open: {error}")


@contextmanager
def _publication_lock():
    """Serialize promotion between processes sharing the data directory."""
    with (DATA_ROOT / ".database-publish.lock").open("a+b") as lock:
        lock.seek(0)
        if os.name == "nt":
            import msvcrt
            msvcrt.locking(lock.fileno(), msvcrt.LK_LOCK, 1)
            try:
                yield
            finally:
                lock.seek(0)
                msvcrt.locking(lock.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock, fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)


def _write_snapshot(
    rows: dict, accepted_files: list[Path], rejected_files: list[Path], *, include_sql: bool,
) -> dict:
    """Build and check a complete export before replacing the published directory."""
    csv.field_size_limit(100_000_000)
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    previous = DATA_ROOT / ".database-previous"

    with TemporaryDirectory(prefix=".database-build-", dir=DATA_ROOT) as work:
        output = Path(work) / "snapshot"
        result = loader.export_database_files(rows, output_dir=output, report=False)
        if include_sql:
            sql = output / "sql"
            sql.mkdir()
            (sql / schema.SCHEMA_FILE.name).write_text(schema.SCHEMA_SQL, encoding="utf-8")
            (sql / schema.SCHEMA_SQLITE_FILE.name).write_text(schema.SCHEMA_SQLITE, encoding="utf-8")
            loader.write_insert_file(rows, sql / loader.INSERT_FILE.name)
            (sql / queries.QUERIES_FILE.name).write_text(queries.QUERIES_SQL, encoding="utf-8")

        manifest = {
            "published_at": datetime.now(timezone.utc).isoformat(),
            "accepted_files": [p.relative_to(DATA_ROOT).as_posix() for p in accepted_files],
            "rejected_files": [p.relative_to(DATA_ROOT).as_posix() for p in rejected_files],
            "validation_file_hashes": {
                p.relative_to(DATA_ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest()
                for p in [*accepted_files, *rejected_files]
            },
            "table_rows": {name: len(records) for name, records in rows.items()},
        }

        audit_fields = [
            "_source_id", "year", "process_name", "unit", "_allocation_basis", "_allocation_share",
            "_allocation_pttep_boe", "_allocation_proxy_volume", "_allocation_input_batches",
        ]
        audit_rows = []
        pdf_rows = []
        exchange_lineage_rows = []
        pdf_fields = [
            "_source_id", "_document_title", "_source_url", "_source_sha256", "_source_page",
            "year", "_report_period", "_report_scope", "flow_name", "_reported_value", "_reported_unit",
            "_conversion_multiplier", "amount", "unit",
        ]
        curated_sources = set()
        exchange_id = 0
        for file in accepted_files:
            with file.open(encoding="utf-8-sig", newline="") as stream:
                for row in csv.DictReader(stream):
                    exchange_id += 1
                    try:
                        source_lineage = json.loads(row.get("_source_lineage") or "[]")
                    except json.JSONDecodeError:
                        source_lineage = []
                    exchange_lineage_rows.append({
                        "exchange_id": exchange_id,
                        "source_id": row.get("_source_id", ""),
                        "mapped_record_id": row.get("record_id", ""),
                        "mapped_year": row.get("year", ""),
                        "mapped_process": row.get("process_name", ""),
                        "mapped_flow": row.get("flow_name", ""),
                        "mapped_amount": row.get("amount", ""),
                        "mapped_unit": row.get("unit", ""),
                        "source_lineage": json.dumps(source_lineage, ensure_ascii=False),
                    })
                    if row.get("_extraction_basis") == "curated_reference":
                        curated_sources.add(row["_source_id"])
                    if row.get("_extraction_basis") == "verified_pdf_transcription":
                        pdf_rows.append({field: row[field] for field in pdf_fields})
                    if row.get("_allocation_basis") and row.get("is_reference", "").lower() in {"true", "1", "1.0"}:
                        audit_rows.append({field: row[field] for field in audit_fields})
        if audit_rows:
            with (output / "upstream_allocation.csv").open("w", encoding="utf-8-sig", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=audit_fields)
                writer.writeheader()
                writer.writerows(audit_rows)
        if pdf_rows:
            with (output / "pdf_evidence.csv").open("w", encoding="utf-8-sig", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=pdf_fields)
                writer.writeheader()
                writer.writerows(pdf_rows)

        lineage_fields = ["exchange_id", "source_id", "mapped_record_id", "mapped_year", "mapped_process", "mapped_flow", "mapped_amount", "mapped_unit"]
        allocation_rows = [
            (
                row["_source_id"], int(float(row["year"])), row["process_name"], row["unit"],
                row["_allocation_basis"], float(row["_allocation_share"]),
                float(row["_allocation_pttep_boe"]), float(row["_allocation_proxy_volume"]),
                row["_allocation_input_batches"],
            )
            for row in audit_rows
        ]

        # Make provenance queryable from the same SQLite snapshot as LCI_EXCHANGE.
        with closing(sqlite3.connect(output / "petroleum.db")) as connection:
            connection.execute("""CREATE TABLE EXCHANGE_LINEAGE (
                exchange_id INTEGER PRIMARY KEY REFERENCES LCI_EXCHANGE(exchange_id),
                source_id TEXT, mapped_record_id TEXT, mapped_year TEXT,
                mapped_process TEXT, mapped_flow TEXT, mapped_amount TEXT,
                mapped_unit TEXT
            )""")
            connection.executemany(
                "INSERT INTO EXCHANGE_LINEAGE VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                ([row[field] for field in lineage_fields] for row in exchange_lineage_rows),
            )
            connection.execute("""CREATE TABLE SOURCE_ROW (
                source_id TEXT NOT NULL, source_record_id TEXT NOT NULL,
                source_row_number TEXT, source_locator TEXT, raw_file TEXT,
                source_url TEXT, source_sha256 TEXT, source_values TEXT NOT NULL,
                staged_values TEXT NOT NULL,
                PRIMARY KEY (source_id, source_record_id)
            )""")
            links = [
                (row["exchange_id"], source["source_id"], source["source_record_id"])
                for row in exchange_lineage_rows
                for source in json.loads(row["source_lineage"])
            ]
            needed_source_rows = {(source_id, record_id) for _, source_id, record_id in links}
            source_rows = []
            for staged_file in sorted((DATA_ROOT / "staging").glob("SRC-*_STAGED.csv")):
                source_id = staged_file.name[:7]
                parsed_files = sorted((DATA_ROOT / "parsed").glob(f"{source_id}_*_PARSED_RAW.csv"))
                parsed_rows = {}
                if len(parsed_files) == 1:
                    with parsed_files[0].open(encoding="utf-8-sig", newline="") as parsed_stream:
                        parsed_rows = {
                            parsed_row.get("_source_row_number", ""): parsed_row
                            for parsed_row in csv.DictReader(parsed_stream)
                        }
                with staged_file.open(encoding="utf-8-sig", newline="") as staged_stream:
                    for staged_row in csv.DictReader(staged_stream):
                        if (staged_row.get("_source_id", ""), staged_row.get("record_id", "")) not in needed_source_rows:
                            continue
                        staged_values = {key: value for key, value in staged_row.items() if not key.startswith("_")}
                        parsed_row = parsed_rows.get(staged_row.get("_source_row_number", ""))
                        source_values = {
                            key: value for key, value in parsed_row.items() if not key.startswith("_")
                        } if parsed_row else staged_values
                        source_rows.append((
                            staged_row.get("_source_id", ""), staged_row.get("record_id", ""),
                            staged_row.get("_source_row_number", ""), staged_row.get("_source_locator", ""),
                            staged_row.get("_raw_file", ""), staged_row.get("_source_url", ""),
                            staged_row.get("_source_sha256", ""),
                            json.dumps(source_values, ensure_ascii=False),
                            json.dumps(staged_values, ensure_ascii=False),
                        ))
            missing_source_rows = needed_source_rows - {(row[0], row[1]) for row in source_rows}
            if missing_source_rows:
                raise ValueError(f"Missing staged provenance for {len(missing_source_rows)} source rows")
            connection.executemany("INSERT OR IGNORE INTO SOURCE_ROW VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", source_rows)
            connection.execute("""CREATE TABLE EXCHANGE_SOURCE_ROW (
                exchange_id INTEGER NOT NULL REFERENCES LCI_EXCHANGE(exchange_id),
                source_id TEXT NOT NULL, source_record_id TEXT NOT NULL,
                PRIMARY KEY (exchange_id, source_id, source_record_id),
                FOREIGN KEY (source_id, source_record_id) REFERENCES SOURCE_ROW(source_id, source_record_id)
            )""")
            connection.executemany("INSERT OR IGNORE INTO EXCHANGE_SOURCE_ROW VALUES (?, ?, ?)", links)
            connection.execute("CREATE INDEX IX_EXCHANGE_SOURCE_ROW_SOURCE_RECORD ON EXCHANGE_SOURCE_ROW(source_id, source_record_id, exchange_id)")
            connection.execute("""CREATE TABLE UPSTREAM_ALLOCATION (
                source_id TEXT NOT NULL, year INTEGER NOT NULL, process_name TEXT NOT NULL,
                unit TEXT NOT NULL, allocation_method TEXT NOT NULL, allocation_share REAL NOT NULL,
                reference_production_boe REAL NOT NULL, allocated_reference_volume REAL NOT NULL,
                input_batches TEXT NOT NULL,
                PRIMARY KEY (source_id, year, process_name)
            )""")
            connection.executemany("INSERT INTO UPSTREAM_ALLOCATION VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", allocation_rows)
            connection.commit()
        with (output / "exchange_source_lineage.csv").open("w", encoding="utf-8-sig", newline="") as stream:
            writer = csv.writer(stream)
            writer.writerow(["exchange_id", "source_id", "source_record_id"])
            writer.writerows(links)
        manifest["table_rows"]["EXCHANGE_LINEAGE"] = len(exchange_lineage_rows)
        manifest["table_rows"]["SOURCE_ROW"] = len(source_rows)
        manifest["table_rows"]["EXCHANGE_SOURCE_ROW"] = len(links)
        manifest["table_rows"]["UPSTREAM_ALLOCATION"] = len(allocation_rows)

        manifest["curated_reference_sources"] = sorted(curated_sources)
        manifest["verified_pdf_sources"] = sorted({row["_source_id"] for row in pdf_rows})
        (output / "run_manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

        with _publication_lock():
            _promote_snapshot(output, DATABASE_DIR, previous)
    print(f"  {'[EXPORT]':<14}Database snapshot: {DATABASE_DIR}")
    for name, records in rows.items():
        print(f"    * {name:<21}: {len(records):>5,} แถว")
    for key in ("csv_dir", "xlsx_dir", "all_tables_xlsx", "sqlite_db"):
        if key in result:
            result[key] = str(DATABASE_DIR / Path(result[key]).relative_to(output))
    return result


def run(
    command: str = "all", *, accepted_files: list[Path] | None = None, rejected_files: list[Path] | None = None,
) -> None:
    """
    รัน Step 07 (ใช้ทั้งจาก CLI และจาก run_pipeline.py)
    - all    : ทำครบทุกขั้น (สร้างไฟล์ schema, export CSV/XLSX/SQLite, เขียน SQL, โหลด MySQL ถ้ามี)
    - export : บันทึกไฟล์ CSV, XLSX และ SQLite ลง data/database/ ตาม ERD
    - files  : เขียนไฟล์ .sql (01_schema.sql, 01_schema_sqlite.sql, 02_insert_data.sql, 03_fr_queries.sql)
    - create : สร้างตารางใน MySQL (DROP ของเดิมก่อนเสมอ)
    - load   : โหลดข้อมูลลง MySQL
    """
    if command not in VALID_COMMANDS:
        raise ValueError(f"ไม่รู้จักคำสั่ง '{command}' (ต้องเป็นหนึ่งใน {', '.join(VALID_COMMANDS)})")

    web_demo = os.environ.get("CN230_WEB_RUN") == "1"
    if web_demo and command not in {"all", "export"}:
        raise ValueError("Web demo supports local database exports only")
    if command in {"all", "export"}:
        if accepted_files is None:
            accepted_files = sorted(ACCEPTED_DIR.glob("*_VALID.csv"))
        if rejected_files is None:
            rejected_files = sorted(REJECTED_DIR.glob("*_ERR.csv"))
        rows = loader.build_all_rows(accepted_files, rejected_files)
        _write_snapshot(rows, accepted_files, rejected_files, include_sql=command == "all")
    else:
        rows = loader.build_all_rows(accepted_files, rejected_files) if command != "create" else None

    # Keep the explicit SQL-only command compatible with the project sql directory.
    if command == "files":
        schema.write_schema_file()
        loader.write_insert_file(rows)
        queries.write_queries_file()

    # Terminal can also load MySQL once the local snapshot has been published.
    if not web_demo and command in ("all", "create", "load"):
        # MySQL is optional for the pipeline's local CSV/XLSX/SQLite exports.
        # When credentials are absent, skip it quietly instead of printing a warning.
        if command == "all" and not has_mysql_config():
            return
        try:
            if command in ("all", "create"):
                schema.create_tables()
            if command in ("all", "load"):
                loader.load_database(rows)
        except Exception as e:
            if command in ("create", "load"):
                raise
            print(f"  {'[INFO]':<14}ข้ามการโหลด MySQL: {e} (แต่ไฟล์ CSV/XLSX/SQLite และ SQL ทั้งหมดสร้างเรียบร้อยแล้ว)\n")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Step 07: Database schema, files, CSV/XLSX exporter, and MySQL loader")
    ap.add_argument("command", nargs="?", default="all", choices=list(VALID_COMMANDS),
                    help="ไม่ใส่ = all (ครบทุกขั้น), export = ส่งออก CSV/XLSX/SQLite, files = เขียนไฟล์ .sql, create = สร้างตาราง MySQL, load = โหลดข้อมูล MySQL")
    ap.add_argument("--yes", action="store_true", help="(ไม่จำเป็นแล้ว: ไม่ถามยืนยันอยู่แล้ว เก็บไว้ให้คำสั่งเดิมยังรันได้)")
    a = ap.parse_args()
    try:
        run(a.command)
    except (FileNotFoundError, ValueError, RuntimeError) as exc:
        sys.exit(f"[ERROR] {exc}")
