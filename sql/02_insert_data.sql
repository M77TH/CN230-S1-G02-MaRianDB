-- สร้างอัตโนมัติโดย src/database/database.py (ข้อมูลเดียวกับที่โหลดลง MySQL)
-- โหลดเป็นก้อนเดียวใน Transaction: ตรวจผลก่อน COMMIT ถ้าไม่เป็น 0 ให้สั่ง ROLLBACK; แทน
USE petroleum;
SET FOREIGN_KEY_CHECKS = 0;
START TRANSACTION;
-- ตรวจผลก่อนยืนยัน: นับ exchange ที่ไม่มีแหล่งข้อมูล (ต้องได้ 0)
SELECT COUNT(*) FROM `LCI_EXCHANGE` e LEFT JOIN `REFERENCE` r ON r.reference_id = e.reference_id LEFT JOIN `SOURCE` s ON s.source_id = r.source_id WHERE s.source_id IS NULL;
COMMIT;
SET FOREIGN_KEY_CHECKS = 1;
-- สร้าง Index หลังโหลดข้อมูลเสร็จ (เร็วกว่าสร้างก่อนโหลดเมื่อข้อมูลมาก)
CREATE INDEX `idx_exchange_process_flow` ON `LCI_EXCHANGE` (`process_id`, `flow_id`);
