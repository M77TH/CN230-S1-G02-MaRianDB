"""
=============================================================================
Step 07: Database Layer (สร้างไฟล์ SQL + MySQL จาก accepted/rejected CSV)
=============================================================================
python src/database/database.py                  # ครบทุกขั้น (ไม่ถามยืนยัน: create จะ DROP ตารางเดิมใน database ทุกครั้ง)
python src/database/database.py create | load | files   # ทำทีละขั้น

ลำดับของ `all`:
   1. เขียน sql/01_schema.sql           (schema.py)   DDL 10 ตาราง
   2. สร้างตารางใน MySQL                (schema.py)   DROP ของเดิมก่อนเสมอ
   3. โหลดข้อมูลลง MySQL                (loader.py)   transaction เดียว รันซ้ำได้
   4. เขียน sql/02_insert_data.sql         (loader.py)   INSERT ชุดเดียวกับที่โหลดลง DB
   5. เขียน sql/03_fr_queries.sql        (queries.py)  query ทดสอบ FR/BR สำหรับ SRS 5.2, 6.1

ค่าเชื่อมต่อ MySQL อยู่ใน .env (ดู .env.example) ไม่เก็บรหัสผ่านในโค้ด
=============================================================================
"""
import argparse
import sys
from pathlib import Path

if sys.platform == "win32":  # ป้องกันปัญหาภาษาไทยใน Console ของ Windows
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, str(Path(__file__).resolve().parent))  # ให้ import ไฟล์พี่น้องได้ไม่ว่าเรียกจากที่ไหน

import loader
import queries
import schema


def load_database() -> dict:
    """จุดเรียกจากไปป์ไลน์: โหลด accepted CSV ลง MySQL"""
    return loader.load_database()


# Alias เพื่อความเข้ากันได้ย้อนหลัง
build_and_verify_database = run_database = run_analysis = load_database


def run(command: str = "all") -> None:
    """รัน Step 07 (ใช้ทั้งจาก CLI และจาก run_pipeline.py) create/all จะ DROP ตารางเดิมแล้วสร้างใหม่โดยไม่ถาม"""
    if command in ("all", "files"):
        schema.write_schema_file()
    if command in ("all", "create"):
        schema.create_tables()
    if command in ("all", "load"):
        loader.load_database(loader.build_all_rows())
    if command in ("all", "files"):
        loader.write_insert_file(loader.build_all_rows())
        queries.write_queries_file()


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Step 07: MySQL schema + loader")
    ap.add_argument("command", nargs="?", default="all", choices=["all", "create", "load", "files"],
                    help="ไม่ใส่ = all (ครบทุกขั้น), create = สร้างตาราง, load = โหลดข้อมูล, files = เขียนไฟล์ .sql 01-03")
    ap.add_argument("--yes", action="store_true", help="(ไม่จำเป็นแล้ว: ไม่ถามยืนยันอยู่แล้ว เก็บไว้ให้คำสั่งเดิมยังรันได้)")
    a = ap.parse_args()
    run(a.command)
