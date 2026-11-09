"""Query ทดสอบ FR-01..04 และ BR-01..03 (SRS 5.2/6.1): เขียนเป็น sql/03_fr_queries.sql"""
from connection import SQL_DIR

QUERIES_FILE = SQL_DIR / "03_fr_queries.sql"

QUERIES_SQL = r"""-- SRS 5.2 / 6.1: Query ทดสอบ Functional Requirement (FR) และ Business Rule (BR)
-- รันหลัง: python src/database/database.py
USE petroleum;

-- ===== FR-01: ดูแหล่งอ้างอิงเอกสารและรอบการสกัดข้อมูลของ exchange (JOIN REFERENCE + EXTRACTION_BATCH)
SELECT e.exchange_id, f.flow_name, e.direction, e.amount,
       r.reference_name, r.reference_url,
       b.batch_id, b.extraction_time, b.script_version
FROM LCI_EXCHANGE e
JOIN FLOW f             ON f.flow_id = e.flow_id
JOIN REFERENCE r        ON r.reference_id = e.reference_id
JOIN EXTRACTION_BATCH b ON b.batch_id = e.batch_id
ORDER BY e.exchange_id
LIMIT 10;

-- ===== FR-02: exchange ทั้งหมดของกระบวนการผลิตน้ำมันดิบ ต่อ 1 BBL (amount ของ Crude Oil อ้างอิง = 1.0)
SELECT p.process_id, p.process_year, f.flow_name, e.direction, e.amount, u.symbol, e.is_reference
FROM LCI_EXCHANGE e
JOIN PROCESS p ON p.process_id = e.process_id
JOIN FLOW f    ON f.flow_id = e.flow_id
JOIN UNIT u    ON u.unit_id = e.unit_id
WHERE p.process_name LIKE '%Crude Oil Production%'
ORDER BY p.process_year, e.direction DESC, f.flow_name;

-- ===== FR-03: amount ที่แปลงเป็นหน่วยฐานแล้ว (amount x to_base_factor)
SELECT e.exchange_id, f.flow_name, e.amount, u.symbol, u.quantity, u.to_base_factor,
       e.amount * u.to_base_factor AS amount_base
FROM LCI_EXCHANGE e
JOIN FLOW f ON f.flow_id = e.flow_id
JOIN UNIT u ON u.unit_id = e.unit_id
WHERE u.to_base_factor <> 1
ORDER BY e.exchange_id
LIMIT 10;

-- ===== FR-04: ชื่อ ผู้เผยแพร่ ปี URL ของแหล่งข้อมูลแต่ละ exchange (ต้องตรงกับรหัสอ้างอิง)
SELECT e.exchange_id, s.source_id, s.title, s.publisher, s.publish_year, s.url
FROM LCI_EXCHANGE e
JOIN REFERENCE r ON r.reference_id = e.reference_id
JOIN SOURCE s    ON s.source_id = r.source_id
ORDER BY e.exchange_id
LIMIT 10;

-- ===== BR-01: เพิ่มข้อมูลโดยเว้นว่าง url ต้อง ERROR (1048 Column 'url' cannot be null)
INSERT INTO SOURCE (source_id, title, publisher, publish_year, description, url)
VALUES (999, 'BR-01 test', 'test', 2026, NULL, NULL);

-- ===== BR-02: is_reference = TRUE แล้ว amount ต้องเท่ากับ 1.0 -> ผลลัพธ์ที่ผิดกฎต้องไม่มีแถว
SELECT exchange_id, amount FROM LCI_EXCHANGE WHERE is_reference = TRUE AND amount <> 1.0;
-- จำนวนแถวอ้างอิงที่ตรวจ (ต้อง > 0 เพื่อไม่ให้ผ่านแบบว่างเปล่า)
SELECT COUNT(*) AS reference_rows FROM LCI_EXCHANGE WHERE is_reference = TRUE;

-- ===== BR-03: SUM(allocation) ของผลิตภัณฑ์ OUT ในกระบวนการเดียวกันต้องเท่ากับ 1
-- แสดงกระบวนการที่ผิดกฎ (ถ้าถูกต้องต้องไม่มีแถว)
SELECT e.process_id, COUNT(*) AS n_products, SUM(e.allocation) AS sum_allocation
FROM LCI_EXCHANGE e
JOIN FLOW f ON f.flow_id = e.flow_id
WHERE e.direction = 'OUT' AND f.flow_type = 'product'
GROUP BY e.process_id
HAVING ABS(SUM(e.allocation) - 1) > 0.000001;

-- ===== VERIFY-01: ความสมบูรณ์ของ Foreign Key (Zero Orphaned Records) ทุกคอลัมน์ FK ของ LCI_EXCHANGE ต้องได้ 0
SELECT 'process'   AS fk, COUNT(*) AS orphans FROM LCI_EXCHANGE e LEFT JOIN PROCESS p          ON p.process_id   = e.process_id   WHERE p.process_id   IS NULL
UNION ALL SELECT 'flow',      COUNT(*) FROM LCI_EXCHANGE e LEFT JOIN FLOW f             ON f.flow_id      = e.flow_id      WHERE f.flow_id      IS NULL
UNION ALL SELECT 'unit',      COUNT(*) FROM LCI_EXCHANGE e LEFT JOIN UNIT u             ON u.unit_id      = e.unit_id      WHERE u.unit_id      IS NULL
UNION ALL SELECT 'reference', COUNT(*) FROM LCI_EXCHANGE e LEFT JOIN REFERENCE r        ON r.reference_id = e.reference_id WHERE r.reference_id IS NULL
UNION ALL SELECT 'batch',     COUNT(*) FROM LCI_EXCHANGE e LEFT JOIN EXTRACTION_BATCH b ON b.batch_id     = e.batch_id     WHERE b.batch_id     IS NULL
UNION ALL SELECT 'quality_check', COUNT(*) FROM QUALITY_CHECK q LEFT JOIN LCI_EXCHANGE e ON e.exchange_id = q.exchange_id WHERE e.exchange_id IS NULL
UNION ALL SELECT 'rejected_batch', COUNT(*) FROM REJECTED_RECORD x LEFT JOIN EXTRACTION_BATCH b ON b.batch_id = x.batch_id WHERE b.batch_id IS NULL;

-- ===== VERIFY-02: สมดุลปริมาตรโรงกลั่นรายปี (น้ำมันดิบเข้า IN เทียบผลิตภัณฑ์ออก OUT เป็น m3 ด้วย to_base_factor)
-- ข้อจำกัด: เทียบเฉพาะหน่วยปริมาตร (BBL, Million Litres) ของ domain Midstream - Refinery; ratio ใกล้ 1 = สมดุล
SELECT p.process_year,
       ROUND(SUM(CASE WHEN e.direction = 'IN'  THEN e.amount * u.to_base_factor END), 0) AS in_m3,
       ROUND(SUM(CASE WHEN e.direction = 'OUT' THEN e.amount * u.to_base_factor END), 0) AS out_m3,
       ROUND(SUM(CASE WHEN e.direction = 'OUT' THEN e.amount * u.to_base_factor END)
           / SUM(CASE WHEN e.direction = 'IN'  THEN e.amount * u.to_base_factor END), 3) AS out_in_ratio
FROM LCI_EXCHANGE e
JOIN PROCESS p ON p.process_id = e.process_id
JOIN UNIT u    ON u.unit_id = e.unit_id
WHERE p.domain = 'Midstream - Refinery' AND u.quantity = 'volume'
GROUP BY p.process_year
HAVING in_m3 IS NOT NULL AND out_m3 IS NOT NULL
ORDER BY p.process_year;

-- ===== TXN-01: โหลดข้อมูลเป็นก้อนเดียวใน Transaction (ตัวอย่าง: ตรวจผลก่อนยืนยัน แล้วย้อนกลับทั้งหมด)
-- รันทั้ง 5 บรรทัดนี้ติดกัน: ผลที่ 1 ต้องได้ 1 (เห็นแถวใน transaction) ผลที่ 2 ต้องได้ 0 (หลัง ROLLBACK แถวหายไป)
START TRANSACTION;
INSERT INTO LOCATION (location_id, name, country) VALUES (9999, 'TXN test', 'Thailand');
SELECT COUNT(*) AS rows_inside_txn FROM LOCATION WHERE location_id = 9999;
ROLLBACK;
SELECT COUNT(*) AS rows_after_rollback FROM LOCATION WHERE location_id = 9999;

-- ===== IDX-01: Index (process_id, flow_id) + EXPLAIN ก่อน/หลังสร้าง Index (รองรับ FR-02 ที่กรองด้วย process_id)
-- รันทีละบล็อก แล้วแคปผล EXPLAIN ก่อนและหลัง: หลังสร้างต้องเห็น key = idx_exchange_process_flow
-- (1) ก่อนสร้าง Index (ลบ index ของเราออกก่อน)
DROP INDEX idx_exchange_process_flow ON LCI_EXCHANGE;
EXPLAIN
SELECT amount, unit_id
FROM LCI_EXCHANGE
WHERE process_id = 1 AND flow_id = 3;
-- (2) หลังสร้าง Index
CREATE INDEX idx_exchange_process_flow ON LCI_EXCHANGE (process_id, flow_id);
EXPLAIN
SELECT amount, unit_id
FROM LCI_EXCHANGE
WHERE process_id = 1 AND flow_id = 3;
"""


def write_queries_file() -> None:
    QUERIES_FILE.write_text(QUERIES_SQL, encoding="utf-8", newline="\n")
    print(f"  {'[FILE]':<14}เขียน {QUERIES_FILE.name}")
