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