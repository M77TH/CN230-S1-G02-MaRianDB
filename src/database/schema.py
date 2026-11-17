"""MySQL and SQLite schemas for the LCI model and its source evidence."""
if __package__:
    from .connection import SQL_DIR, mysql_cursor
else:
    from connection import SQL_DIR, mysql_cursor

SCHEMA_FILE = SQL_DIR / "01_schema.sql"
SCHEMA_SQLITE_FILE = SQL_DIR / "01_schema_sqlite.sql"

# เรียงตารางแม่ก่อนตารางลูก
_TABLE_SPECS = [
    {
        "name": "SOURCE",
        "pk": "source_id",
        "columns": [
            ("source_id", "int", "NOT NULL"),
            ("title", "varchar(255)", "NOT NULL"),
            ("publisher", "varchar(150)", "NOT NULL"),
            ("publish_year", "int", "DEFAULT NULL"),
            ("description", "varchar(255)", "DEFAULT NULL"),
            ("url", "varchar(255)", "NOT NULL"),
        ],
        "fks": [],
        "checks": [("chk_source_url", "CHECK (TRIM(`url`) <> '')")],
    },
    {
        "name": "UNIT",
        "pk": "unit_id",
        "columns": [
            ("unit_id", "int", "NOT NULL"),
            ("symbol", "varchar(20)", "NOT NULL"),
            ("quantity", "varchar(50)", "NOT NULL"),
            ("to_base_factor", "decimal(18,6)", "NOT NULL"),
        ],
        "fks": [],
        "checks": [],
    },
    {
        "name": "LOCATION",
        "pk": "location_id",
        "columns": [
            ("location_id", "int", "NOT NULL"),
            ("name", "varchar(100)", "NOT NULL"),
            ("country", "varchar(50)", "NOT NULL"),
        ],
        "fks": [],
        "checks": [],
    },
    {
        "name": "REFERENCE",
        "pk": "reference_id",
        "auto_increment": True,
        "columns": [
            ("reference_id", "int", "NOT NULL"),
            ("reference_name", "varchar(255)", "NOT NULL"),
            ("reference_type", "varchar(20)", "NOT NULL"),
            ("reference_url", "varchar(255)", "DEFAULT NULL"),
            ("source_id", "int", "NOT NULL"),
        ],
        "fks": [("REFERENCE_ibfk_1", "source_id", "SOURCE", "source_id")],
        "checks": [],
    },
    {
        "name": "EXTRACTION_BATCH",
        "pk": "batch_id",
        "columns": [
            ("batch_id", "int", "NOT NULL"),
            ("extraction_time", "timestamp", "NOT NULL"),
            ("script_version", "varchar(50)", "NOT NULL"),
            ("source_id", "int", "NOT NULL"),
        ],
        "fks": [("EXTRACTION_BATCH_ibfk_1", "source_id", "SOURCE", "source_id")],
        "checks": [],
    },
    {
        "name": "SOURCE_EVIDENCE_CARD",
        "pk": "source_id",
        "columns": [
            ("source_id", "int", "NOT NULL"),
            ("batch_id", "int", "NOT NULL"),
            ("legacy_source_id", "varchar(12)", "NOT NULL UNIQUE"),
            ("source_document", "varchar(255)", "NOT NULL"),
            ("source_document_sha256", "char(64)", "NOT NULL"),
            ("raw_card_sha256", "char(64)", "NOT NULL"),
            ("record_json", "longtext", "NOT NULL"),
        ],
        "fks": [
            ("fk_evidence_card_source", "source_id", "SOURCE", "source_id"),
            ("fk_evidence_card_batch", "batch_id", "EXTRACTION_BATCH", "batch_id"),
        ],
        "checks": [],
    },
    {
        "name": "SOURCE_EVIDENCE_ASSET",
        "pk": "asset_id",
        "columns": [
            ("asset_id", "int", "NOT NULL"),
            ("source_id", "int", "NOT NULL"),
            ("figure", "varchar(50)", "NOT NULL"),
            ("caption", "text", "NOT NULL"),
            ("asset_path", "varchar(255)", "NOT NULL"),
            ("original_asset_path", "varchar(255)", "NOT NULL"),
            ("size_bytes", "int", "NOT NULL"),
            ("sha256", "char(64)", "NOT NULL"),
        ],
        "fks": [("fk_evidence_asset_card", "source_id", "SOURCE_EVIDENCE_CARD", "source_id")],
        "checks": [("chk_evidence_size", "CHECK (size_bytes > 0)")],
    },
    {
        "name": "FLOW",
        "pk": "flow_id",
        "columns": [
            ("flow_id", "int", "NOT NULL"),
            ("flow_name", "varchar(150)", "NOT NULL"),
            ("flow_type", "varchar(50)", "NOT NULL"),
            ("compartment", "varchar(100)", "DEFAULT NULL"),
            ("default_unit_id", "int", "NOT NULL"),
        ],
        "fks": [("FLOW_ibfk_1", "default_unit_id", "UNIT", "unit_id")],
        "checks": [("chk_flow_type", "CHECK (`flow_type` IN ('product','elementary','waste'))")],
    },
    {
        "name": "PROCESS",
        "pk": "process_id",
        "columns": [
            ("process_id", "int", "NOT NULL"),
            ("process_name", "varchar(150)", "NOT NULL"),
            ("domain", "varchar(100)", "NOT NULL"),
            ("process_year", "int", "DEFAULT NULL"),
            ("location_id", "int", "NOT NULL"),
            ("reference_id", "int", "NOT NULL"),
        ],
        "fks": [
            ("PROCESS_ibfk_1", "location_id", "LOCATION", "location_id"),
            ("PROCESS_ibfk_2", "reference_id", "REFERENCE", "reference_id"),
        ],
        "checks": [("chk_process_year", "CHECK (`process_year` BETWEEN 1900 AND 2100)")],
    },
    {
        "name": "LCI_EXCHANGE",
        "pk": "exchange_id",
        "columns": [
            ("exchange_id", "int", "NOT NULL"),
            ("process_id", "int", "NOT NULL"),
            ("flow_id", "int", "NOT NULL"),
            ("direction", "varchar(3)", "NOT NULL"),
            ("amount", "decimal(18,6)", "NOT NULL"),
            ("unit_id", "int", "NOT NULL"),
            ("allocation", "decimal(9,8)", "NOT NULL DEFAULT '1.00000000'"),
            ("reference_id", "int", "NOT NULL"),
            ("batch_id", "int", "NOT NULL"),
            ("is_reference", "tinyint(1)", ("NOT NULL DEFAULT '0'", "NOT NULL DEFAULT 0")),
        ],
        "fks": [
            ("LCI_EXCHANGE_ibfk_1", "process_id", "PROCESS", "process_id"),
            ("LCI_EXCHANGE_ibfk_2", "flow_id", "FLOW", "flow_id"),
            ("LCI_EXCHANGE_ibfk_3", "unit_id", "UNIT", "unit_id"),
            ("LCI_EXCHANGE_ibfk_4", "reference_id", "REFERENCE", "reference_id"),
            ("LCI_EXCHANGE_ibfk_5", "batch_id", "EXTRACTION_BATCH", "batch_id"),
        ],
        "checks": [
            ("chk_direction", "CHECK (`direction` IN ('IN','OUT'))"),
            ("chk_amount", "CHECK (`amount` >= 0)"),
        ],
    },
    {
        "name": "QUALITY_CHECK",
        "pk": "check_id",
        "columns": [
            ("check_id", "int", "NOT NULL"),
            ("rule_name", "varchar(150)", "NOT NULL"),
            ("status", "varchar(50)", "NOT NULL"),
            ("exchange_id", "int", "NOT NULL"),
        ],
        "fks": [("QUALITY_CHECK_ibfk_1", "exchange_id", "LCI_EXCHANGE", "exchange_id")],
        "checks": [("chk_status", "CHECK (`status` IN ('Pass','Fail'))")],
    },
    {
        "name": "REJECTED_RECORD",
        "pk": "rejected_id",
        "columns": [
            ("rejected_id", "int", "NOT NULL"),
            ("raw_data", "varchar(255)", "NOT NULL"),
            ("error_type", "varchar(255)", "NOT NULL"),
            ("batch_id", "int", "NOT NULL"),
        ],
        "fks": [("REJECTED_RECORD_ibfk_1", "batch_id", "EXTRACTION_BATCH", "batch_id")],
        "checks": [],
    },
]

TABLES_PARENT_FIRST = [spec["name"] for spec in _TABLE_SPECS]
TABLES_CHILD_FIRST = list(reversed(TABLES_PARENT_FIRST))
TABLE_COLUMNS = {spec["name"]: [col[0] for col in spec["columns"]] for spec in _TABLE_SPECS}


def _sql_type(mysql_type: str, dialect: str) -> str:
    if dialect == "mysql":
        return mysql_type
    if mysql_type in ("int", "tinyint(1)"):
        return "INTEGER"
    return mysql_type.upper()


def _format_column(col: tuple, is_pk: bool, auto_inc: bool, dialect: str) -> str:
    name, mysql_type, constraint = col
    clause = constraint[0 if dialect == "mysql" else 1] if isinstance(constraint, tuple) else constraint
    col_type = _sql_type(mysql_type, dialect)
    if dialect == "sqlite" and is_pk:
        suffix = " PRIMARY KEY AUTOINCREMENT" if auto_inc else " PRIMARY KEY"
        return f"  `{name}` {col_type} {clause}{suffix}"
    if dialect == "mysql" and is_pk and auto_inc:
        return f"  `{name}` {col_type} {clause} AUTO_INCREMENT"
    return f"  `{name}` {col_type} {clause}"


def _build_create_table(spec: dict, dialect: str) -> str:
    pk = spec["pk"]
    auto_inc = spec.get("auto_increment", False)
    lines = [_format_column(col, col[0] == pk, auto_inc, dialect) for col in spec["columns"]]
    if dialect == "mysql":
        lines.append(f"  PRIMARY KEY (`{pk}`)")
        for _, fk_col, _, _ in spec["fks"]:
            lines.append(f"  KEY `{fk_col}` (`{fk_col}`)")
    for fk_name, fk_col, ref_table, ref_col in spec["fks"]:
        lines.append(
            f"  CONSTRAINT `{fk_name}` FOREIGN KEY (`{fk_col}`) "
            f"REFERENCES `{ref_table}` (`{ref_col}`) ON DELETE CASCADE ON UPDATE CASCADE"
        )
    for chk_name, expr in spec["checks"]:
        lines.append(f"  CONSTRAINT `{chk_name}` {expr}")
    closing = ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;" if dialect == "mysql" else ");"
    return f"CREATE TABLE `{spec['name']}` (\n" + ",\n".join(lines) + f"\n{closing}"


def _build_schema_sql(dialect: str) -> str:
    if dialect == "mysql":
        header = [
            "-- Schema ตาม SRS บท 4.2-4.3 (Data Dictionary) สำหรับ MySQL 8.x",
            "-- ต่างจาก sql/MaRianDB.sql: LCI_EXCHANGE มี allocation (DR/BR-03), REJECTED_RECORD ผูก batch_id (DR-09)",
            "-- ไฟล์นี้ DROP ตารางเดิมก่อนสร้างเสมอ",
            "SET FOREIGN_KEY_CHECKS = 0;",
        ]
        fk_enable = "SET FOREIGN_KEY_CHECKS = 1;"
    else:
        header = [
            "-- SQLite LCI and source evidence schema (data/database/petroleum.db)",
            "PRAGMA foreign_keys = OFF;",
        ]
        fk_enable = "PRAGMA foreign_keys = ON;"

    drops = [f"DROP TABLE IF EXISTS `{t}`;" for t in TABLES_CHILD_FIRST]
    creates = [_build_create_table(spec, dialect) for spec in _TABLE_SPECS]
    return "\n".join(header + drops + [fk_enable]) + "\n\n" + "\n\n".join(creates) + "\n"


SCHEMA_SQL = _build_schema_sql("mysql")
SCHEMA_SQLITE = _build_schema_sql("sqlite")

# Index สำหรับ query ที่ใช้บ่อย (FR-02): กรองด้วย process_id แล้วตามด้วย flow_id
# สร้างหลังโหลดข้อมูล ไม่ใส่ใน 01_schema.sql: ถ้ามี Index ก่อน ทุก INSERT ต้องแทรกค่าเข้า Index ด้วย
# ข้อมูลหลักแสนถึงล้านแถวจะช้ากว่าการโหลดก่อนแล้วสร้าง Index ครั้งเดียว (ดู EXPLAIN ใน 03_fr_queries.sql)
INDEX_NAME = "idx_exchange_process_flow"
INDEX_SQL = f"CREATE INDEX `{INDEX_NAME}` ON `LCI_EXCHANGE` (`process_id`, `flow_id`);"
INDEX_SQL_SQLITE = f"CREATE INDEX IF NOT EXISTS `{INDEX_NAME}` ON `LCI_EXCHANGE` (`process_id`, `flow_id`);"


def _has_index(cur) -> bool:
    cur.execute("SHOW INDEX FROM `LCI_EXCHANGE` WHERE Key_name = %s", (INDEX_NAME,))
    return bool(cur.fetchall())


def drop_indexes(cur) -> None:
    """ลบ Index ก่อนโหลดซ้ำ (ถ้ามี) เพื่อไม่ให้ INSERT ช้าลง"""
    if _has_index(cur):
        cur.execute(f"DROP INDEX `{INDEX_NAME}` ON `LCI_EXCHANGE`")


def create_indexes(cur) -> None:
    """สร้าง Index หลังโหลดข้อมูลเสร็จ (ข้ามถ้ามีอยู่แล้ว)"""
    if not _has_index(cur):
        cur.execute(INDEX_SQL)


def write_schema_file() -> None:
    SQL_DIR.mkdir(parents=True, exist_ok=True)
    SCHEMA_FILE.write_text(SCHEMA_SQL, encoding="utf-8", newline="\n")
    SCHEMA_SQLITE_FILE.write_text(SCHEMA_SQLITE, encoding="utf-8", newline="\n")
    print(f"  {'[FILE]':<14}เขียน {SCHEMA_FILE.name} และ {SCHEMA_SQLITE_FILE.name}")


def create_tables() -> None:
    """รัน DDL ใน SCHEMA_SQL (DROP TABLE เดิมก่อนสร้างเสมอ)"""
    with mysql_cursor(with_db=False, rollback_on_error=True) as (conn, cur, db):
        cur.execute(f"CREATE DATABASE IF NOT EXISTS `{db}` CHARACTER SET utf8mb4")
        cur.execute(f"USE `{db}`")
        lines = (line for line in SCHEMA_SQL.splitlines() if not line.lstrip().startswith("--"))
        # dump นี้ไม่มี ';' ภายในสตริง จึงแยก statement ด้วย ';' ได้ตรง ๆ
        for stmt in (s.strip() for s in "\n".join(lines).split(";")):
            if stmt:
                cur.execute(stmt)
        conn.commit()
    print(f"  {'[SCHEMA]':<14}สร้างตารางใหม่ใน database `{db}` จาก {SCHEMA_FILE.name} แล้ว")
