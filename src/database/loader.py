"""อ่าน accepted/rejected CSV -> แถวของ 10 ตาราง -> โหลดลง MySQL และเขียน sql/02_insert_data.sql"""
import json
import sys
from datetime import datetime, timezone

import pandas as pd

from schema import INDEX_SQL, create_indexes, drop_indexes

from connection import (ACCEPTED_DIR, LEDGER_FILE, REGISTRY_FILE, REJECTED_DIR,
                        SQL_DIR, _connect)

INSERT_FILE = SQL_DIR / "02_insert_data.sql"
SCRIPT_VERSION = "pipeline-7step"
BATCH_SIZE = 1000

# ลำดับลบ: ตารางลูกก่อนตารางแม่ (ตรงกับ FK ใน sql/MaRianDB.sql)
TABLES_CHILD_FIRST = [
    "REJECTED_RECORD", "QUALITY_CHECK", "LCI_EXCHANGE", "PROCESS", "FLOW",
    "EXTRACTION_BATCH", "REFERENCE", "LOCATION", "UNIT", "SOURCE",
]

QC_RULES = [
    "Check_Null_URL", "Validate_Unit", "Check_Non_Negative", "Validate_Direction",
    "Check_Process_Year", "Validate_Product_Flow", "Check_Allocation_Burdens",
]

# symbol -> (quantity, to_base_factor); ฐาน: volume=m3, mass=kg, energy=MJ
# shortcut: BOE = 6.1178 GJ (ค่ามาตรฐานทั่วไป) ถ้าทีมใช้ค่าอื่นให้แก้ที่นี่
UNIT_TABLE = {
    "BBL": ("volume", 0.158987), "scf": ("volume", 0.0283168466),
    "MMSCF": ("volume", 28316.846592), "Million Litres": ("volume", 1000.0),
    "kg": ("mass", 1.0), "kgCO2e": ("mass CO2e", 1.0),
    "Tonne": ("mass", 1000.0), "Metric Tonne": ("mass", 1000.0),
    "Tonne CO2e": ("mass CO2e", 1000.0), "Tonne VOC": ("mass", 1000.0),
    "Tonne NO2": ("mass", 1000.0), "Tonne SO2": ("mass", 1000.0),
    "MJ": ("energy", 1.0), "GJ": ("energy", 1000.0), "BOE": ("energy", 6117.8),
}


def _num(source_id: str) -> int:
    return int(source_id.split("-")[1])


def _utc(ts: str) -> str:
    return datetime.fromisoformat(ts).astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def _publish_year(raw_file: str) -> int:
    """ประมาณจากชื่อไฟล์ เช่น ..._200301-202603_RAW -> 2026, ..._202408_RAW -> 2024"""
    return int(raw_file.split("_")[-2].split("-")[-1][:4])


def _read_accepted() -> pd.DataFrame:
    files = sorted(ACCEPTED_DIR.glob("*_VALID.csv"))
    if not files:
        sys.exit("[ERROR] ไม่พบไฟล์ใน data/validation/accepted/ กรุณารัน run_pipeline.py ก่อน")
    return pd.concat((pd.read_csv(f, encoding="utf-8-sig") for f in files), ignore_index=True)


def _build_rows(df: pd.DataFrame) -> dict:
    """แปลง accepted CSV เป็นแถวของแต่ละตาราง (id กำหนดเองเพราะ schema ไม่มี AUTO_INCREMENT)"""
    reg = pd.read_csv(REGISTRY_FILE, encoding="utf-8-sig")
    reg["source_id"] = reg["source_id"].str.strip()  # registry มีช่องว่างท้าย เช่น 'SRC-048 '
    reg = reg.set_index("source_id")
    ledger = {}
    for line in LEDGER_FILE.read_text(encoding="utf-8").splitlines():
        rec = json.loads(line)
        ledger[rec["extraction_batch_id"]] = rec["accessed_at"]

    rows = {t: [] for t in TABLES_CHILD_FIRST}
    unit_id, loc_id, flow_id, batch_id, proc_id = {}, {}, {}, {}, {}

    for sid, g in df.groupby("_source_id"):
        r = reg.loc[sid]
        n = _num(sid)  # source_id = reference_id = เลขท้ายของ SRC-xxx
        rows["SOURCE"].append((n, r["title"], r["publisher_or_owner"], _publish_year(g["_raw_file"].iloc[0]),
                               f"{r['sector']} | {r['source_type']}", r["url_or_document_id"]))
        rows["REFERENCE"].append((n, r["title"], r["source_type"], g["_source_url"].iloc[0], n))
        for b in g["_extraction_batch_id"].unique():
            batch_id[b] = len(batch_id) + 1
            rows["EXTRACTION_BATCH"].append((batch_id[b], _utc(ledger[b]), SCRIPT_VERSION, n))

    for sym in df["unit"].unique():
        if sym not in UNIT_TABLE:
            sys.exit(f"[ERROR] หน่วย '{sym}' ไม่อยู่ใน UNIT_TABLE")
        unit_id[sym] = len(unit_id) + 1
        rows["UNIT"].append((unit_id[sym], sym, *UNIT_TABLE[sym]))

    for name, country in df[["location_name", "country"]].drop_duplicates().itertuples(index=False):
        loc_id[name] = len(loc_id) + 1
        rows["LOCATION"].append((loc_id[name], name, country))

    # FLOW: หน่วยเริ่มต้น = หน่วยที่พบครั้งแรก (exchange เก็บหน่วยจริงของตัวเองแยกต่างหาก)
    for t in df.drop_duplicates(["flow_name", "flow_type", "compartment"]).to_dict("records"):
        flow_id[(t["flow_name"], t["flow_type"], t["compartment"])] = len(flow_id) + 1
        rows["FLOW"].append((len(flow_id), t["flow_name"], t["flow_type"], t["compartment"], unit_id[t["unit"]]))

    k = len(QC_RULES)
    for i, t in enumerate(df.to_dict("records"), start=1):
        n = _num(t["_source_id"])
        year = int(t["year"])
        pk = (n, t["process_name"], t["location_name"], year)
        if pk not in proc_id:
            proc_id[pk] = len(proc_id) + 1
            rows["PROCESS"].append((proc_id[pk], t["process_name"], t["domain"], year, loc_id[t["location_name"]], n))
        rows["LCI_EXCHANGE"].append((
            i, proc_id[pk], flow_id[(t["flow_name"], t["flow_type"], t["compartment"])], t["direction"],
            t["amount"], unit_id[t["unit"]], t["allocation"], n, batch_id[t["_extraction_batch_id"]],
            int(str(t["is_reference"]) == "True"),
        ))
        for j, rule in enumerate(QC_RULES, start=1):
            rows["QUALITY_CHECK"].append(((i - 1) * k + j, rule, "Pass", i))

    # REJECTED_RECORD: batch_id = รอบสกัดของ source เดียวกันที่มีใน accepted
    src_batch = {_num(s): batch_id[b] for s, b in df.groupby("_source_id")["_extraction_batch_id"].first().items()}
    rej = [pd.read_csv(f, encoding="utf-8-sig") for f in sorted(REJECTED_DIR.glob("*_ERR.csv"))]
    for rid, t in enumerate(pd.concat(rej).to_dict("records") if rej else [], start=1):
        n = _num(t["source_id"])
        if n not in src_batch:
            sys.exit(f"[ERROR] {t['source_id']} มีแถวกักกันแต่ไม่มีแถว accepted จึงไม่มี batch_id")
        # raw_data/error_type ยาวไม่เกิน 255 ตาม schema
        rows["REJECTED_RECORD"].append((rid, str(t["raw_data"])[:255], str(t["error_type"])[:255], src_batch[n]))
    return rows


# LCI_EXCHANGE ไม่มีคอลัมน์ source_id ตรง ๆ จึงไล่ผ่าน REFERENCE -> SOURCE
MISSING_SOURCE_SQL = ("SELECT COUNT(*) FROM `LCI_EXCHANGE` e "
                      "LEFT JOIN `REFERENCE` r ON r.reference_id = e.reference_id "
                      "LEFT JOIN `SOURCE` s ON s.source_id = r.source_id WHERE s.source_id IS NULL")


def load_database(rows: dict | None = None) -> dict:
    """โหลด accepted CSV ลง MySQL ใน transaction เดียว; รันซ้ำได้ (ลบทุกตารางแล้วโหลดใหม่)"""
    print("\n" + "=" * 80)
    print(">>> [STEP 07/07] DATABASE LAYER (Load accepted data into MySQL)")
    print("=" * 80)
    rows = rows or build_all_rows()
    rejected = sorted(REJECTED_DIR.glob("*_ERR.csv"))

    conn, db = _connect()
    cur = conn.cursor()
    try:
        drop_indexes(cur)  # โหลดซ้ำ: ไม่ให้ Index ถ่วง INSERT สร้างใหม่หลังโหลดเสร็จ
        for t in TABLES_CHILD_FIRST:
            cur.execute(f"DELETE FROM `{t}`")
        for t in reversed(TABLES_CHILD_FIRST):
            data = rows[t]
            if not data:
                continue
            sql = f"INSERT INTO `{t}` VALUES ({', '.join(['%s'] * len(data[0]))})"
            for i in range(0, len(data), BATCH_SIZE):
                cur.executemany(sql, data[i:i + BATCH_SIZE])
        # ตรวจก่อนยืนยัน (ตามตัวอย่างอาจารย์): exchange ที่ไม่มีแหล่งข้อมูลต้องเป็น 0 ถ้าไม่ใช่ให้ ROLLBACK ทั้งชุด
        cur.execute(MISSING_SOURCE_SQL)
        missing = cur.fetchone()[0]
        if missing:
            raise RuntimeError(f"พบ {missing} exchange ที่ไม่มีแหล่งข้อมูล ยกเลิกการโหลดทั้งหมด (ROLLBACK)")
        conn.commit()
        create_indexes(cur)  # DDL ทำ commit เองอยู่แล้ว จึงสร้างหลัง COMMIT ข้อมูล
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

    counts = {t: len(v) for t, v in rows.items()}
    for t in reversed(TABLES_CHILD_FIRST):
        print(f"  {'[LOAD]':<14}{t:<17}{counts[t]:>7,} แถว")
    print("=" * 80 + "\n")
    return {"status": "LOADED", "database": db, "rows": counts, "rejected_file_count": len(rejected)}


def build_all_rows() -> dict:
    return _build_rows(_read_accepted())


def _lit(v) -> str:
    """แปลงค่าเป็น SQL literal (ใช้เฉพาะเขียนไฟล์ INSERT; การโหลดจริงใช้ executemany)"""
    if hasattr(v, "item"):  # numpy -> python
        v = v.item()
    if v is None or (isinstance(v, float) and v != v):
        return "NULL"
    if isinstance(v, (int, float)):
        return repr(v)
    return "'" + str(v).replace("\\", "\\\\").replace("'", "''") + "'"


def write_insert_file(rows: dict) -> None:
    """เขียน sql/02_insert_data.sql จากแถวชุดเดียวกับที่โหลดลง DB (ไฟล์ตรงกับ DB เสมอ)"""
    out = ["-- สร้างอัตโนมัติโดย src/database/database.py (ข้อมูลเดียวกับที่โหลดลง MySQL)",
           "-- โหลดเป็นก้อนเดียวใน Transaction: ตรวจผลก่อน COMMIT ถ้าไม่เป็น 0 ให้สั่ง ROLLBACK; แทน",
           "USE petroleum;", "SET FOREIGN_KEY_CHECKS = 0;", "START TRANSACTION;"]
    for t in reversed(TABLES_CHILD_FIRST):
        data = rows[t]
        for i in range(0, len(data), 500):
            vals = ",\n  ".join("(" + ", ".join(_lit(x) for x in r) + ")" for r in data[i:i + 500])
            out.append(f"INSERT INTO `{t}` VALUES\n  {vals};")
    out += ["-- ตรวจผลก่อนยืนยัน: นับ exchange ที่ไม่มีแหล่งข้อมูล (ต้องได้ 0)", MISSING_SOURCE_SQL + ";",
            "COMMIT;", "SET FOREIGN_KEY_CHECKS = 1;",
            "-- สร้าง Index หลังโหลดข้อมูลเสร็จ (เร็วกว่าสร้างก่อนโหลดเมื่อข้อมูลมาก)", INDEX_SQL]
    INSERT_FILE.write_text("\n".join(out) + "\n", encoding="utf-8", newline="\n")
    print(f"  {'[FILE]':<14}เขียน {INSERT_FILE.name}")
