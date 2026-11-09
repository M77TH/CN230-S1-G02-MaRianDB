"""DDL ของ 10 ตารางตาม SRS บท 4.3: เขียนเป็น sql/01_schema.sql แล้วรันสร้างตารางใน MySQL"""
from connection import SQL_DIR, _connect

SCHEMA_FILE = SQL_DIR / "01_schema.sql"

SCHEMA_SQL = r"""-- Schema ตาม SRS บท 4.2-4.3 (Data Dictionary) สำหรับ MySQL 8.x
-- ต่างจาก sql/MaRianDB.sql: LCI_EXCHANGE มี allocation (DR/BR-03), REJECTED_RECORD ผูก batch_id (DR-09)
-- ไฟล์นี้ DROP ตารางเดิมก่อนสร้างเสมอ
SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS `REJECTED_RECORD`;
DROP TABLE IF EXISTS `QUALITY_CHECK`;
DROP TABLE IF EXISTS `LCI_EXCHANGE`;
DROP TABLE IF EXISTS `PROCESS`;
DROP TABLE IF EXISTS `FLOW`;
DROP TABLE IF EXISTS `EXTRACTION_BATCH`;
DROP TABLE IF EXISTS `REFERENCE`;
DROP TABLE IF EXISTS `LOCATION`;
DROP TABLE IF EXISTS `UNIT`;
DROP TABLE IF EXISTS `SOURCE`;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE `SOURCE` (
  `source_id` int NOT NULL,
  `title` varchar(255) NOT NULL,
  `publisher` varchar(150) NOT NULL,
  `publish_year` int DEFAULT NULL,
  `description` varchar(255) DEFAULT NULL,
  `url` varchar(255) NOT NULL,
  PRIMARY KEY (`source_id`),
  CONSTRAINT `chk_source_url` CHECK (TRIM(`url`) <> '')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `UNIT` (
  `unit_id` int NOT NULL,
  `symbol` varchar(20) NOT NULL,
  `quantity` varchar(50) NOT NULL,
  `to_base_factor` decimal(18,6) NOT NULL,
  PRIMARY KEY (`unit_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `LOCATION` (
  `location_id` int NOT NULL,
  `name` varchar(100) NOT NULL,
  `country` varchar(50) NOT NULL,
  PRIMARY KEY (`location_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `REFERENCE` (
  `reference_id` int NOT NULL,
  `reference_name` varchar(255) NOT NULL,
  `reference_type` varchar(20) NOT NULL,
  `reference_url` varchar(255) DEFAULT NULL,
  `source_id` int NOT NULL,
  PRIMARY KEY (`reference_id`),
  KEY `source_id` (`source_id`),
  CONSTRAINT `REFERENCE_ibfk_1` FOREIGN KEY (`source_id`) REFERENCES `SOURCE` (`source_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `EXTRACTION_BATCH` (
  `batch_id` int NOT NULL,
  `extraction_time` timestamp NOT NULL,
  `script_version` varchar(50) NOT NULL,
  `source_id` int NOT NULL,
  PRIMARY KEY (`batch_id`),
  KEY `source_id` (`source_id`),
  CONSTRAINT `EXTRACTION_BATCH_ibfk_1` FOREIGN KEY (`source_id`) REFERENCES `SOURCE` (`source_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `FLOW` (
  `flow_id` int NOT NULL,
  `flow_name` varchar(150) NOT NULL,
  `flow_type` varchar(50) NOT NULL,
  `compartment` varchar(100) DEFAULT NULL,
  `default_unit_id` int NOT NULL,
  PRIMARY KEY (`flow_id`),
  KEY `default_unit_id` (`default_unit_id`),
  CONSTRAINT `FLOW_ibfk_1` FOREIGN KEY (`default_unit_id`) REFERENCES `UNIT` (`unit_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_flow_type` CHECK (`flow_type` IN ('product','elementary','waste'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `PROCESS` (
  `process_id` int NOT NULL,
  `process_name` varchar(150) NOT NULL,
  `domain` varchar(100) NOT NULL,
  `process_year` int DEFAULT NULL,
  `location_id` int NOT NULL,
  `reference_id` int NOT NULL,
  PRIMARY KEY (`process_id`),
  KEY `location_id` (`location_id`),
  KEY `reference_id` (`reference_id`),
  CONSTRAINT `PROCESS_ibfk_1` FOREIGN KEY (`location_id`) REFERENCES `LOCATION` (`location_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `PROCESS_ibfk_2` FOREIGN KEY (`reference_id`) REFERENCES `REFERENCE` (`reference_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_process_year` CHECK (`process_year` BETWEEN 1900 AND 2100)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `LCI_EXCHANGE` (
  `exchange_id` int NOT NULL,
  `process_id` int NOT NULL,
  `flow_id` int NOT NULL,
  `direction` varchar(3) NOT NULL,
  `amount` decimal(18,6) NOT NULL,
  `unit_id` int NOT NULL,
  `allocation` decimal(9,8) NOT NULL DEFAULT '1.00000000',
  `reference_id` int NOT NULL,
  `batch_id` int NOT NULL,
  `is_reference` tinyint(1) NOT NULL DEFAULT '0',
  PRIMARY KEY (`exchange_id`),
  KEY `process_id` (`process_id`),
  KEY `flow_id` (`flow_id`),
  KEY `unit_id` (`unit_id`),
  KEY `reference_id` (`reference_id`),
  KEY `batch_id` (`batch_id`),
  CONSTRAINT `LCI_EXCHANGE_ibfk_1` FOREIGN KEY (`process_id`) REFERENCES `PROCESS` (`process_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `LCI_EXCHANGE_ibfk_2` FOREIGN KEY (`flow_id`) REFERENCES `FLOW` (`flow_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `LCI_EXCHANGE_ibfk_3` FOREIGN KEY (`unit_id`) REFERENCES `UNIT` (`unit_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `LCI_EXCHANGE_ibfk_4` FOREIGN KEY (`reference_id`) REFERENCES `REFERENCE` (`reference_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `LCI_EXCHANGE_ibfk_5` FOREIGN KEY (`batch_id`) REFERENCES `EXTRACTION_BATCH` (`batch_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_direction` CHECK (`direction` IN ('IN','OUT')),
  CONSTRAINT `chk_amount` CHECK (`amount` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `QUALITY_CHECK` (
  `check_id` int NOT NULL,
  `rule_name` varchar(150) NOT NULL,
  `status` varchar(50) NOT NULL,
  `exchange_id` int NOT NULL,
  PRIMARY KEY (`check_id`),
  KEY `exchange_id` (`exchange_id`),
  CONSTRAINT `QUALITY_CHECK_ibfk_1` FOREIGN KEY (`exchange_id`) REFERENCES `LCI_EXCHANGE` (`exchange_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `chk_status` CHECK (`status` IN ('Pass','Fail'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `REJECTED_RECORD` (
  `rejected_id` int NOT NULL,
  `raw_data` varchar(255) NOT NULL,
  `error_type` varchar(255) NOT NULL,
  `batch_id` int NOT NULL,
  PRIMARY KEY (`rejected_id`),
  KEY `batch_id` (`batch_id`),
  CONSTRAINT `REJECTED_RECORD_ibfk_1` FOREIGN KEY (`batch_id`) REFERENCES `EXTRACTION_BATCH` (`batch_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
"""


def write_schema_file() -> None:
    SCHEMA_FILE.write_text(SCHEMA_SQL, encoding="utf-8", newline="\n")
    print(f"  {'[FILE]':<14}เขียน {SCHEMA_FILE.name}")


def create_tables() -> None:
    """รัน sql/MaRianDB.sql (ไฟล์นี้ DROP TABLE เดิมก่อนสร้างเสมอ)"""
    conn, db = _connect(with_db=False)
    cur = conn.cursor()
    cur.execute(f"CREATE DATABASE IF NOT EXISTS `{db}` CHARACTER SET utf8mb4")
    cur.execute(f"USE `{db}`")
    lines = (l for l in SCHEMA_SQL.splitlines() if not l.startswith("--"))
    # dump นี้ไม่มี ';' ภายในสตริง จึงแยก statement ด้วย ';' ได้ตรง ๆ
    for stmt in (s.strip() for s in "\n".join(lines).split(";")):
        if stmt:
            cur.execute(stmt)
    conn.commit()
    conn.close()
    print(f"  {'[SCHEMA]':<14}สร้างตารางใหม่ใน database `{db}` จาก {SCHEMA_FILE.name} แล้ว")
