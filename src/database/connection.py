"""เส้นทางไฟล์ + การเชื่อมต่อ MySQL (อ่านค่าจาก .env ไม่เก็บรหัสผ่านในโค้ด)"""
from contextlib import contextmanager
import os
from pathlib import Path

try:
    import mysql.connector as _mysql_connector
except ImportError:
    _mysql_connector = None

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_ROOT = Path(os.environ.get("CN230_DATA_DIR", PROJECT_ROOT / "data")).resolve()
ACCEPTED_DIR = DATA_ROOT / "validation" / "accepted"
REJECTED_DIR = DATA_ROOT / "validation" / "rejected"
SQL_DIR = PROJECT_ROOT / "sql"
REGISTRY_FILE = PROJECT_ROOT / "docs" / "source_registry" / "source_registry.csv"
LEDGER_FILE = DATA_ROOT / "raw" / "_provenance_ledger.jsonl"
ENV_FILE = PROJECT_ROOT / ".env"
DATABASE_DIR = DATA_ROOT / "database"
DATABASE_CSV_DIR = DATABASE_DIR / "csv"
DATABASE_XLSX_DIR = DATABASE_DIR / "xlsx"
SQLITE_DB_PATH = DATABASE_DIR / "petroleum.db"


def _load_env() -> dict:
    """อ่านค่าเชื่อมต่อจาก .env (ไม่เก็บรหัสผ่านในโค้ด และไม่พิมพ์ค่าออกมา)"""
    cfg = {}
    if ENV_FILE.exists():
        for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                cfg[k.strip()] = v.strip()
    cfg.update({k: v for k, v in os.environ.items() if k.startswith("MYSQL_")})
    return cfg


def has_mysql_config() -> bool:
    """ตรวจสอบว่ามีรหัสผ่าน MySQL สำหรับเชื่อมต่อหรือไม่"""
    cfg = _load_env()
    return bool(cfg.get("MYSQL_PASSWORD"))


def _connect(with_db: bool = True):
    if _mysql_connector is None:
        raise RuntimeError("ไม่พบไลบรารี mysql-connector-python")
    cfg = _load_env()
    if not cfg.get("MYSQL_PASSWORD"):
        raise RuntimeError("ไม่พบ MYSQL_PASSWORD ใน .env: คัดลอก .env.example เป็น .env แล้วกรอกค่า")
    kw = dict(
        host=cfg.get("MYSQL_HOST") or "localhost",
        port=int(cfg.get("MYSQL_PORT") or 3306),
        user=cfg.get("MYSQL_USER") or "root",
        password=cfg["MYSQL_PASSWORD"],
        charset="utf8mb4",
    )
    db = cfg.get("MYSQL_DATABASE") or "petroleum"
    if with_db:
        kw["database"] = db
    return _mysql_connector.connect(**kw), db


@contextmanager
def mysql_cursor(with_db: bool = True, *, rollback_on_error: bool = False):
    """เปิดการเชื่อมต่อ MySQL พร้อม cursor และปิดทรัพยากรอัตโนมัติ"""
    conn, db = _connect(with_db=with_db)
    cur = conn.cursor()
    try:
        yield conn, cur, db
    except Exception:
        if rollback_on_error:
            conn.rollback()
        raise
    finally:
        cur.close()
        conn.close()

