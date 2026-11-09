"""เส้นทางไฟล์ + การเชื่อมต่อ MySQL (อ่านค่าจาก .env ไม่เก็บรหัสผ่านในโค้ด)"""
import os
import sys
from pathlib import Path

import mysql.connector

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
ACCEPTED_DIR = PROJECT_ROOT / "data" / "validation" / "accepted"
REJECTED_DIR = PROJECT_ROOT / "data" / "validation" / "rejected"
SQL_DIR = PROJECT_ROOT / "sql"
REGISTRY_FILE = PROJECT_ROOT / "docs" / "source_registry" / "source_registry.csv"
LEDGER_FILE = PROJECT_ROOT / "data" / "raw" / "_provenance_ledger.jsonl"
ENV_FILE = PROJECT_ROOT / ".env"


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
    if not cfg.get("MYSQL_PASSWORD"):
        sys.exit("[ERROR] ไม่พบ MYSQL_PASSWORD: คัดลอก .env.example เป็น .env แล้วกรอกค่า")
    return cfg


def _connect(with_db: bool = True):
    cfg = _load_env()
    kw = dict(
        host=cfg.get("MYSQL_HOST", "localhost"), port=int(cfg.get("MYSQL_PORT", 3306)),
        user=cfg.get("MYSQL_USER", "root"), password=cfg["MYSQL_PASSWORD"], charset="utf8mb4",
    )
    db = cfg.get("MYSQL_DATABASE", "petroleum")
    if with_db:
        kw["database"] = db
    return mysql.connector.connect(**kw), db
