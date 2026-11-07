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