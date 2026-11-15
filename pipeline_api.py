"""Local, loopback-only API for the CN230 pipeline presentation workbench."""

from __future__ import annotations

import csv
import io
import json
import os
import re
import sqlite3
import shutil
import subprocess
import sys
import threading
import time
import uuid
from datetime import date, datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


PROJECT_ROOT = Path(__file__).resolve().parent
WEB_ROOT = (PROJECT_ROOT / "web").resolve()
ROOT_DATA_DIR = PROJECT_ROOT / "data"
WEB_DATA_DIR = WEB_ROOT / "data"
WEB_DATA_SEED_MARKER = WEB_ROOT / ".sandbox-data-seeded"
WEB_DATA_LOCK = threading.RLock()
REGISTRY_PATH = PROJECT_ROOT / "docs" / "source_registry" / "source_registry.csv"
ACCEPTED_PATH = WEB_DATA_DIR / "validation" / "accepted"
SQLITE_PATH = WEB_DATA_DIR / "database" / "petroleum.db"
HOST = "127.0.0.1"
PORT = int(os.environ.get("CN230_PIPELINE_API_PORT", "8765"))
MAX_QUERY_ROWS = 500
MAX_QUERY_LENGTH = 20_000
QUERY_TIMEOUT_SECONDS = 3
SANDBOX_SESSION_TTL_SECONDS = 30 * 60
MAX_SANDBOX_SESSIONS = 12

ARTIFACT_STAGES = {
    "raw": WEB_DATA_DIR / "raw",
    "parsed": WEB_DATA_DIR / "parsed",
    "staging": WEB_DATA_DIR / "staging",
    "mapping": WEB_DATA_DIR / "mapping",
    "accepted": ACCEPTED_PATH,
    "rejected": WEB_DATA_DIR / "validation" / "rejected",
}

PIPELINE_EXPLORER_STAGES = {
    "raw": {"path": WEB_DATA_DIR / "raw", "phase": "02", "label": "Raw acquisition"},
    "parsed": {"path": WEB_DATA_DIR / "parsed", "phase": "03", "label": "Parsing"},
    "staging": {"path": WEB_DATA_DIR / "staging", "phase": "04", "label": "Staging"},
    "mapping": {"path": WEB_DATA_DIR / "mapping", "phase": "05", "label": "Mapping"},
    "accepted": {"path": WEB_DATA_DIR / "validation" / "accepted", "phase": "06", "label": "Validation · accepted"},
    "rejected": {"path": WEB_DATA_DIR / "validation" / "rejected", "phase": "06", "label": "Validation · rejected"},
    "database": {"path": WEB_DATA_DIR / "database", "phase": "07", "label": "Database & export"},
}
EXCEL_PREVIEW_MAX_ROWS = 50
JSONL_PREVIEW_MAX_BYTES = 2 * 1024 * 1024
JSONL_PREVIEW_MAX_ROWS = 200


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class RunManager:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.current: dict | None = None

    def start(self, source_ids: list[str], force: bool, to_db: bool) -> dict:
        with self.lock:
            if self.current and self.current["status"] in ("starting", "running"):
                raise ApiError("A pipeline run is already active.", 409)

            run_id = uuid.uuid4().hex
            run = {
                "runId": run_id,
                "status": "starting",
                "sourceIds": source_ids,
                "force": force,
                "toDatabase": to_db,
                "logs": [],
                "exitCode": None,
                "startedAt": datetime.now(timezone.utc).isoformat(),
                "finishedAt": None,
                "process": None,
            }
            self.current = run
            threading.Thread(target=self._execute, args=(run,), daemon=True).start()
            return self._public(run)

    def _execute(self, run: dict) -> None:
        command = [sys.executable, "run_pipeline.py", *run["sourceIds"]]
        if run["force"]:
            command.append("--force")
        if not run["toDatabase"]:
            command.append("--no-db")

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["CN230_DATA_DIR"] = str(WEB_DATA_DIR)
        env["CN230_WEB_RUN"] = "1"
        try:
            process = subprocess.Popen(
                command,
                cwd=PROJECT_ROOT,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding="utf-8",
                errors="replace",
                bufsize=1,
                env=env,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
            with self.lock:
                run["process"] = process
                run["status"] = "running"

            assert process.stdout is not None
            for line in process.stdout:
                self._append(run, line.rstrip("\r\n"))
            exit_code = process.wait()
            with self.lock:
                run["exitCode"] = exit_code
                run["status"] = {0: "succeeded", 3: "blocked"}.get(exit_code, "failed")
                run["finishedAt"] = datetime.now(timezone.utc).isoformat()
        except Exception as error:  # Surface launcher/runtime failures in the terminal.
            self._append(run, f"[API ERROR] {type(error).__name__}: {error}")
            with self.lock:
                run["status"] = "failed"
                run["exitCode"] = -1
                run["finishedAt"] = datetime.now(timezone.utc).isoformat()

    def _append(self, run: dict, line: str) -> None:
        with self.lock:
            run["logs"].append(line)
            if len(run["logs"]) > 10_000:
                del run["logs"][:2_000]

    def get(self, run_id: str, cursor: int = 0) -> dict:
        with self.lock:
            if not self.current or self.current["runId"] != run_id:
                raise ApiError("Run was not found.", 404)
            run = self.current
            safe_cursor = max(0, min(cursor, len(run["logs"])))
            result = self._public(run)
            result["logs"] = run["logs"][safe_cursor:]
            result["cursor"] = len(run["logs"])
            return result

    def cancel(self, run_id: str) -> dict:
        with self.lock:
            if not self.current or self.current["runId"] != run_id:
                raise ApiError("Run was not found.", 404)
            process = self.current.get("process")
            if self.current["status"] not in ("starting", "running") or not process:
                raise ApiError("This run is no longer active.", 409)
            process.terminate()
            return self._public(self.current)

    @staticmethod
    def _public(run: dict) -> dict:
        return {key: value for key, value in run.items() if key not in ("process", "logs")}


RUNS = RunManager()


def approved_sources() -> list[dict[str, str]]:
    if not REGISTRY_PATH.exists():
        return []
    with REGISTRY_PATH.open("r", encoding="utf-8-sig", newline="") as source_file:
        rows = csv.DictReader(source_file)
        items = []
        for row in rows:
            if (row.get("status") or "").strip().casefold() != "approved":
                continue
            source_id = (row.get("source_id") or "").strip().upper()
            if not re.fullmatch(r"SRC-\d{3}", source_id):
                continue
            items.append({
                "sourceId": source_id,
                "title": (row.get("title") or source_id).strip(),
                "publisher": (row.get("publisher_or_owner") or "").strip(),
                "url": (row.get("url_or_document_id") or "").strip(),
            })
    return sorted(items, key=lambda item: item["sourceId"])


def source_registry() -> dict:
    """Return every source row, preserving approved and rejected registry entries."""
    if not REGISTRY_PATH.is_file():
        raise ApiError("The source registry file is missing.", 404)

    with REGISTRY_PATH.open("r", encoding="utf-8-sig", newline="") as registry_file:
        rows = csv.DictReader(registry_file)
        sources = []
        status_counts: dict[str, int] = {}
        for row in rows:
            status = (row.get("status") or "unspecified").strip().casefold() or "unspecified"
            status_counts[status] = status_counts.get(status, 0) + 1
            sources.append({
                "sourceId": (row.get("source_id") or "").strip().upper(),
                "title": (row.get("title") or "").strip(),
                "publisher": (row.get("publisher_or_owner") or "").strip(),
                "url": (row.get("url_or_document_id") or "").strip(),
                "accessedAt": (row.get("accessed_at") or "").strip(),
                "sourceType": (row.get("source_type") or "").strip(),
                "sector": (row.get("sector") or "").strip(),
                "rights": (row.get("rights_or_terms") or "").strip(),
                "status": status,
                "notes": (row.get("notes") or "").strip(),
            })

    return {
        "registryPath": "docs/source_registry/source_registry.csv",
        "updatedAt": datetime.fromtimestamp(REGISTRY_PATH.stat().st_mtime, timezone.utc).isoformat(),
        "total": len(sources),
        "statusCounts": status_counts,
        "sources": sorted(sources, key=lambda item: item["sourceId"]),
    }


def count_csv_records() -> int:
    total = 0
    for path in sorted(ACCEPTED_PATH.glob("*_VALID.csv")) if ACCEPTED_PATH.exists() else []:
        try:
            with path.open("r", encoding="utf-8-sig", newline="") as stream:
                total += max(0, sum(1 for _ in csv.reader(stream)) - 1)
        except (OSError, UnicodeError, csv.Error):
            continue
    return total


def _csv_artifact_summary(stage: str, source_id: str | None = None) -> dict:
    directory = ARTIFACT_STAGES[stage]
    pattern = "*_RAW.*" if stage == "raw" else "*.csv"
    paths = sorted(directory.glob(pattern)) if directory.exists() else []
    if source_id:
        paths = [path for path in paths if path.name.upper().startswith(source_id.upper() + "_")]

    total_rows = 0
    source_ids: set[str] = set()
    sample: list[dict] = []
    sample_columns: list[str] = []
    latest_mtime = 0.0
    for path in paths:
        match = re.match(r"(SRC-\d{3})_", path.name, re.IGNORECASE)
        if match:
            source_ids.add(match.group(1).upper())
        try:
            latest_mtime = max(latest_mtime, path.stat().st_mtime)
            if path.suffix.casefold() != ".csv":
                continue
            try:
                content = path.read_text(encoding="utf-8-sig")
            except UnicodeError:
                # Thai source CSVs may be published using Windows-874/TIS-620.
                content = path.read_text(encoding="cp874")
            reader = csv.DictReader(io.StringIO(content))
            if not sample_columns:
                sample_columns = [str(column) for column in (reader.fieldnames or [])]
            for row in reader:
                total_rows += 1
                if len(sample) < 3 and (not source_id or path.name.upper().startswith(source_id.upper() + "_")):
                    sample.append({
                        str(key): (str(value)[:120] if value is not None else "")
                        for key, value in row.items()
                        if key is not None
                    })
        except (OSError, UnicodeError, csv.Error):
            continue

    # For a focused source trace the row total above is already source-specific.
    return {
        "files": len(paths),
        "rows": total_rows,
        "sourceIds": sorted(source_ids),
        "columns": sample_columns,
        "sample": sample,
        "updatedAt": datetime.fromtimestamp(latest_mtime, timezone.utc).isoformat() if latest_mtime else None,
    }


def pipeline_file_index() -> dict:
    """List pipeline data artifacts only, with each file's filesystem timestamp."""
    stages = []
    for key, stage in PIPELINE_EXPLORER_STAGES.items():
        directory: Path = stage["path"]
        files = []
        if directory.is_dir():
            for path in directory.rglob("*"):
                if not path.is_file() or path.name == ".gitkeep" or path.name.startswith("~$") or path.suffix == ".tmp":
                    continue
                try:
                    resolved_path = path.resolve()
                    resolved_root = directory.resolve()
                    if resolved_root not in resolved_path.parents:
                        continue
                    stat = path.stat()
                except OSError:
                    continue
                relative_name = path.relative_to(directory).as_posix()
                files.append({
                    "name": path.name,
                    "relativePath": relative_name,
                    "path": (directory.relative_to(PROJECT_ROOT) / path.relative_to(directory)).as_posix(),
                    "extension": path.suffix.lower().lstrip("."),
                    "sizeBytes": stat.st_size,
                    "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                    "previewable": path.suffix.lower() in {".csv", ".xlsx", ".jsonl"},
                })
        files.sort(key=lambda item: (item["modifiedAt"], item["relativePath"].casefold()), reverse=True)
        stages.append({
            "key": key,
            "phase": stage["phase"],
            "label": stage["label"],
            "path": directory.relative_to(PROJECT_ROOT).as_posix(),
            "fileCount": len(files),
            "updatedAt": files[0]["modifiedAt"] if files else None,
            "files": files,
        })
    return {"stages": stages, "generatedAt": datetime.now(timezone.utc).isoformat()}


def _spreadsheet_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if value is None or isinstance(value, (str, int, float, bool)):
        return value if value is not None else ""
    return str(value)


def pipeline_file_preview(stage_key: str, relative_name: str, sheet_name: str | None = None) -> dict:
    """Read a small, read-only data preview from an allowlisted pipeline folder."""
    stage = PIPELINE_EXPLORER_STAGES.get(stage_key)
    if not stage or not isinstance(relative_name, str) or not relative_name:
        raise ApiError("Choose a file from the pipeline data explorer.", 400)
    directory: Path = stage["path"].resolve()
    path = (directory / relative_name).resolve()
    if directory not in path.parents or not path.is_file():
        raise ApiError("The selected file is outside the pipeline data folders.", 404)

    suffix = path.suffix.casefold()
    if suffix == ".jsonl":
        try:
            if path.stat().st_size > JSONL_PREVIEW_MAX_BYTES:
                raise ApiError("JSONL preview is limited to files under 2 MB.", 413)
            records: list[dict[str, object]] = []
            columns: list[str] = []
            truncated = False
            with path.open("r", encoding="utf-8-sig") as stream:
                for line_number, line in enumerate(stream, start=1):
                    if not line.strip():
                        continue
                    if len(records) >= JSONL_PREVIEW_MAX_ROWS:
                        truncated = True
                        break
                    try:
                        value = json.loads(line)
                    except json.JSONDecodeError as error:
                        raise ApiError(f"Invalid JSON on line {line_number}: {error.msg}.", 422) from error
                    record = value if isinstance(value, dict) else {"value": value}
                    normalized: dict[str, object] = {}
                    for key, cell in record.items():
                        column = str(key)
                        if column not in columns:
                            columns.append(column)
                        normalized[column] = (
                            json.dumps(cell, ensure_ascii=False)
                            if isinstance(cell, (dict, list))
                            else cell
                        )
                    records.append(normalized)
            return {
                "path": path.relative_to(PROJECT_ROOT).as_posix(),
                "format": "jsonl",
                "sheetNames": [],
                "activeSheet": None,
                "columns": columns,
                "rows": [[record.get(column, "") for column in columns] for record in records],
                "rowCountPreviewed": len(records),
                "truncated": truncated,
            }
        except ApiError:
            raise
        except (OSError, UnicodeError) as error:
            raise ApiError(f"Could not read JSONL preview: {error}", 422) from error

    if suffix == ".csv":
        def read_csv_preview(encoding: str) -> tuple[list[str], list[list[str]], bool]:
            with path.open("r", encoding=encoding, newline="") as stream:
                reader = csv.reader(stream)
                headers = next(reader, [])
                preview_rows = []
                for row in reader:
                    if len(preview_rows) >= EXCEL_PREVIEW_MAX_ROWS:
                        return headers, preview_rows, True
                    preview_rows.append(row)
                return headers, preview_rows, False

        try:
            try:
                headers, rows, truncated = read_csv_preview("utf-8-sig")
            except UnicodeDecodeError:
                headers, rows, truncated = read_csv_preview("cp874")
        except (OSError, UnicodeError, csv.Error) as error:
            raise ApiError(f"Could not read CSV preview: {error}", 422) from error
        return {
            "path": path.relative_to(PROJECT_ROOT).as_posix(),
            "format": "csv",
            "sheetNames": [],
            "activeSheet": None,
            "columns": [header or f"Column {index + 1}" for index, header in enumerate(headers)],
            "rows": rows,
            "rowCountPreviewed": len(rows),
            "truncated": truncated,
        }

    if suffix != ".xlsx":
        raise ApiError("File preview is available for CSV, XLSX, and JSONL files.", 415)
    try:
        from openpyxl import load_workbook
    except ImportError as error:
        raise ApiError("XLSX preview needs the project's openpyxl dependency.", 503) from error

    try:
        workbook = load_workbook(path, read_only=True, data_only=True)
        try:
            sheet_names = workbook.sheetnames
            if not sheet_names:
                return {
                    "path": path.relative_to(PROJECT_ROOT).as_posix(),
                    "format": "xlsx", "sheetNames": [], "activeSheet": None,
                    "columns": [], "rows": [], "rowCountPreviewed": 0, "truncated": False,
                }
            active_sheet = sheet_name if sheet_name in sheet_names else sheet_names[0]
            iterator = workbook[active_sheet].iter_rows(values_only=True)
            raw_headers = list(next(iterator, ()))
            headers = [str(value) if value is not None else f"Column {index + 1}" for index, value in enumerate(raw_headers)]
            preview_rows = []
            truncated = False
            for row in iterator:
                if len(preview_rows) >= EXCEL_PREVIEW_MAX_ROWS:
                    truncated = True
                    break
                values = [_spreadsheet_value(value) for value in row]
                if len(values) < len(headers):
                    values.extend([""] * (len(headers) - len(values)))
                preview_rows.append(values)
            return {
                "path": path.relative_to(PROJECT_ROOT).as_posix(),
                "format": "xlsx",
                "sheetNames": sheet_names,
                "activeSheet": active_sheet,
                "columns": headers,
                "rows": preview_rows,
                "rowCountPreviewed": len(preview_rows),
                "truncated": truncated,
            }
        finally:
            workbook.close()
    except (OSError, ValueError, KeyError) as error:
        raise ApiError(f"Could not read spreadsheet preview: {error}", 422) from error


def presentation_snapshot() -> dict:
    registry_rows: list[dict[str, str]] = []
    if REGISTRY_PATH.exists():
        with REGISTRY_PATH.open("r", encoding="utf-8-sig", newline="") as stream:
            registry_rows = list(csv.DictReader(stream))
    approved = {
        (row.get("source_id") or "").strip().upper()
        for row in registry_rows
        if (row.get("status") or "").strip().casefold() == "approved"
        and re.fullmatch(r"SRC-\d{3}", (row.get("source_id") or "").strip().upper())
    }
    registry_statuses: dict[str, int] = {}
    for row in registry_rows:
        status = (row.get("status") or "unspecified").strip().casefold() or "unspecified"
        registry_statuses[status] = registry_statuses.get(status, 0) + 1

    source_examples = []
    for wanted_status in ("approved", "rejected"):
        match = next((
            row for row in sorted(registry_rows, key=lambda item: (item.get("source_id") or ""))
            if (row.get("status") or "").strip().casefold() == wanted_status
        ), None)
        if match:
            source_examples.append({
                "sourceId": (match.get("source_id") or "").strip().upper(),
                "title": (match.get("title") or "").strip(),
                "publisher": (match.get("publisher_or_owner") or "").strip(),
                "status": wanted_status,
            })

    artifacts = {stage: _csv_artifact_summary(stage) for stage in ARTIFACT_STAGES}
    trace = {stage: _csv_artifact_summary(stage, "SRC-044") for stage in ARTIFACT_STAGES}
    represented = set(artifacts["accepted"]["sourceIds"])

    database: dict = {"ready": False, "tables": [], "tableCount": 0, "exchangeRows": None}
    query_proof: dict = {"sql": None, "columns": [], "rows": []}
    if SQLITE_PATH.is_file() and SQLITE_PATH.stat().st_size:
        try:
            connection = sqlite3.connect(f"{SQLITE_PATH.as_uri()}?mode=ro", uri=True, timeout=2)
            try:
                names = [row[0] for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
                )]
                tables = []
                for name in names:
                    count = connection.execute(f"SELECT COUNT(*) FROM {_quote_identifier(name)}").fetchone()[0]
                    tables.append({"name": name, "rows": count})
                database = {
                    "ready": True,
                    "tables": tables,
                    "tableCount": len(tables),
                    "exchangeRows": next((table["rows"] for table in tables if table["name"].casefold() == "lci_exchange"), None),
                }
                proof_sql = (
                    "SELECT p.process_name, p.process_year, f.flow_name, x.direction, "
                    "x.amount, u.symbol AS unit "
                    "FROM LCI_EXCHANGE x "
                    "JOIN PROCESS p USING (process_id) "
                    "JOIN FLOW f USING (flow_id) "
                    "JOIN UNIT u USING (unit_id) "
                    "ORDER BY x.exchange_id LIMIT 6"
                )
                proof_sandbox = sqlite3.connect(":memory:")
                try:
                    connection.backup(proof_sandbox)
                    proof_cursor = proof_sandbox.execute(proof_sql)
                    query_proof = {
                        "sql": proof_sql,
                        "columns": [column[0] for column in proof_cursor.description or []],
                        "rows": [list(row) for row in proof_cursor.fetchall()],
                    }
                finally:
                    proof_sandbox.close()
            finally:
                connection.close()
        except sqlite3.Error:
            pass

    mtimes = [
        datetime.fromisoformat(item["updatedAt"]).timestamp()
        for item in artifacts.values() if item.get("updatedAt")
    ]
    if database["ready"]:
        mtimes.append(SQLITE_PATH.stat().st_mtime)

    return {
        "registry": {
            "total": len(registry_rows),
            "statuses": registry_statuses,
            "approved": len(approved),
            "approvedSourceIds": sorted(approved),
            "processed": len(represented),
            "processedSourceIds": sorted(represented),
            "missingApprovedSourceIds": sorted(approved - represented),
            "sourceExamples": source_examples,
        },
        "artifacts": artifacts,
        "sourceTrace": trace,
        "database": database,
        "queryProof": query_proof,
        "updatedAt": datetime.fromtimestamp(max(mtimes), timezone.utc).isoformat() if mtimes else None,
    }


def _quote_identifier(identifier: str) -> str:
    return '"' + identifier.replace('"', '""') + '"'


def _load_accepted_csvs(*, allow_cross_thread: bool = False) -> tuple[sqlite3.Connection, int]:
    paths = sorted(ACCEPTED_PATH.glob("*_VALID.csv")) if ACCEPTED_PATH.exists() else []
    if not paths:
        raise ApiError("No validated CSV extracts are available yet. Run the pipeline first.", 409)

    columns: list[str] = []
    for path in paths:
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.reader(stream)
            header = next(reader, [])
            for name in header:
                clean_name = name.strip()
                if clean_name and clean_name not in columns:
                    columns.append(clean_name)
    if not columns:
        raise ApiError("The validated CSV files do not contain column headers.", 409)

    # Sandbox sessions are reused across ThreadingHTTPServer request threads.
    # Their per-session lock serializes access when cross-thread use is enabled.
    connection = sqlite3.connect(":memory:", check_same_thread=not allow_cross_thread)
    quoted_columns = [_quote_identifier(column) for column in columns]
    connection.execute(
        "CREATE TABLE VALIDATED_RECORDS ("
        + ", ".join(f"{column} TEXT" for column in quoted_columns)
        + ', "_source_file" TEXT)'
    )
    insert_sql = (
        "INSERT INTO VALIDATED_RECORDS ("
        + ", ".join([*quoted_columns, '"_source_file"'])
        + ") VALUES ("
        + ", ".join("?" for _ in range(len(columns) + 1))
        + ")"
    )

    record_count = 0
    batch: list[tuple[str | None, ...]] = []
    for path in paths:
        with path.open("r", encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream)
            for row in reader:
                batch.append(tuple(row.get(column) for column in columns) + (path.name,))
                if len(batch) >= 1_000:
                    connection.executemany(insert_sql, batch)
                    record_count += len(batch)
                    batch.clear()
    if batch:
        connection.executemany(insert_sql, batch)
        record_count += len(batch)
    connection.execute('CREATE INDEX idx_validated_source ON VALIDATED_RECORDS("_source_id")')
    connection.commit()
    return connection, record_count


def _open_query_database(target: str) -> tuple[sqlite3.Connection, str, int | None]:
    if target == "validated":
        connection, row_count = _load_accepted_csvs()
        connection.execute("PRAGMA query_only = ON")
        return connection, "validated", row_count
    if target != "mart":
        raise ApiError("Choose either the validated extracts or SQLite data mart.")
    if not SQLITE_PATH.is_file() or SQLITE_PATH.stat().st_size == 0:
        raise ApiError("The SQLite data mart is not built yet. Run the pipeline with database export enabled.", 409)

    uri = SQLITE_PATH.resolve().as_uri() + "?mode=ro"
    source = sqlite3.connect(uri, uri=True, timeout=2)
    sandbox = sqlite3.connect(":memory:")
    try:
        source.backup(sandbox)
    except sqlite3.Error:
        sandbox.close()
        raise
    finally:
        source.close()
    sandbox.execute("PRAGMA query_only = ON")
    return sandbox, "mart", None


def database_schema(target: str) -> dict:
    connection, mode, row_count = _open_query_database(target)
    try:
        table_names = [
            row[0]
            for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )
        ]
        tables = []
        for table_name in table_names:
            quoted_table = _quote_identifier(table_name)
            columns = [row[1] for row in connection.execute(f"PRAGMA table_info({quoted_table})")]
            table_count = row_count if mode == "validated" else connection.execute(
                f"SELECT COUNT(*) FROM {quoted_table}"
            ).fetchone()[0]
            tables.append({"name": table_name, "columns": columns, "rows": table_count})
        return {
            "target": mode,
            "label": "ข้อมูลผ่านการตรวจสอบ · CSV" if mode == "validated" else "ฐานข้อมูล LCI · SQLite",
            "tables": tables,
        }
    finally:
        connection.close()


def execute_read_query(sql: str, target: str) -> dict:
    if not isinstance(sql, str) or not sql.strip():
        raise ApiError("Enter a SQL query first.")
    if len(sql) > MAX_QUERY_LENGTH:
        raise ApiError(f"Query is too long (maximum {MAX_QUERY_LENGTH:,} characters).", 413)
    if not re.match(r"(?is)^\s*(SELECT|WITH|EXPLAIN\s+QUERY\s+PLAN)\b", sql):
        raise ApiError("Only read-only SELECT, WITH, or EXPLAIN QUERY PLAN statements are allowed.")

    connection, mode, _ = _open_query_database(target)
    started = time.perf_counter()
    deadline = started + QUERY_TIMEOUT_SECONDS

    write_actions = {
        sqlite3.SQLITE_INSERT,
        sqlite3.SQLITE_UPDATE,
        sqlite3.SQLITE_DELETE,
        sqlite3.SQLITE_CREATE_INDEX,
        sqlite3.SQLITE_CREATE_TABLE,
        sqlite3.SQLITE_CREATE_TEMP_INDEX,
        sqlite3.SQLITE_CREATE_TEMP_TABLE,
        sqlite3.SQLITE_CREATE_TEMP_TRIGGER,
        sqlite3.SQLITE_CREATE_TEMP_VIEW,
        sqlite3.SQLITE_CREATE_TRIGGER,
        sqlite3.SQLITE_CREATE_VIEW,
        sqlite3.SQLITE_CREATE_VTABLE,
        sqlite3.SQLITE_DROP_INDEX,
        sqlite3.SQLITE_DROP_TABLE,
        sqlite3.SQLITE_DROP_TEMP_INDEX,
        sqlite3.SQLITE_DROP_TEMP_TABLE,
        sqlite3.SQLITE_DROP_TEMP_TRIGGER,
        sqlite3.SQLITE_DROP_TEMP_VIEW,
        sqlite3.SQLITE_DROP_TRIGGER,
        sqlite3.SQLITE_DROP_VIEW,
        sqlite3.SQLITE_DROP_VTABLE,
        sqlite3.SQLITE_ALTER_TABLE,
        sqlite3.SQLITE_ATTACH,
        sqlite3.SQLITE_DETACH,
        sqlite3.SQLITE_PRAGMA,
        sqlite3.SQLITE_TRANSACTION,
        sqlite3.SQLITE_SAVEPOINT,
        sqlite3.SQLITE_REINDEX,
        sqlite3.SQLITE_ANALYZE,
    }

    def authorize(action: int, arg1: str | None, arg2: str | None, _db: str | None, _trigger: str | None) -> int:
        if action in write_actions:
            return sqlite3.SQLITE_DENY
        if action == sqlite3.SQLITE_FUNCTION and (arg2 or arg1 or "").casefold() in {
            "load_extension", "writefile", "readfile"
        }:
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    connection.set_authorizer(authorize)
    connection.set_progress_handler(lambda: int(time.perf_counter() > deadline), 1_000)
    try:
        cursor = connection.execute(sql)
        if cursor.description is None:
            raise ApiError("The statement did not return a result set.")
        columns = [column[0] for column in cursor.description]
        rows = cursor.fetchmany(MAX_QUERY_ROWS + 1)
        truncated = len(rows) > MAX_QUERY_ROWS
        if truncated:
            rows = rows[:MAX_QUERY_ROWS]
        return {
            "target": mode,
            "columns": columns,
            "rows": [list(row) for row in rows],
            "rowCount": len(rows),
            "truncated": truncated,
            "durationMs": round((time.perf_counter() - started) * 1_000, 1),
        }
    except sqlite3.OperationalError as error:
        if "interrupted" in str(error).casefold():
            raise ApiError(f"Query exceeded the {QUERY_TIMEOUT_SECONDS}-second sandbox limit.", 408) from error
        raise ApiError(str(error)) from error
    except sqlite3.Error as error:
        raise ApiError(str(error)) from error
    finally:
        connection.close()


def _build_sandbox_connection(target: str) -> tuple[sqlite3.Connection, str, int | None]:
    if target == "validated":
        connection, row_count = _load_accepted_csvs(allow_cross_thread=True)
        return connection, "validated", row_count
    if target != "mart":
        raise ApiError("Choose either the validated extracts or SQLite data mart.")
    if not SQLITE_PATH.is_file() or SQLITE_PATH.stat().st_size == 0:
        raise ApiError("The SQLite data mart is not built yet. Run the pipeline with database export enabled.", 409)

    uri = SQLITE_PATH.resolve().as_uri() + "?mode=ro"
    source = sqlite3.connect(uri, uri=True, timeout=2)
    # This connection persists in a sandbox session and is used by later HTTP
    # requests, which ThreadingHTTPServer may handle on different threads.
    sandbox = sqlite3.connect(":memory:", check_same_thread=False)
    try:
        source.backup(sandbox)
    except sqlite3.Error:
        sandbox.close()
        raise
    finally:
        source.close()
    return sandbox, "mart", None


class SandboxSessionManager:
    """Holds short-lived SQLite copies in memory; no sandbox SQL touches project files."""

    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.sessions: dict[str, dict] = {}

    def _expire_old_sessions(self) -> None:
        cutoff = time.monotonic() - SANDBOX_SESSION_TTL_SECONDS
        expired = [session_id for session_id, session in self.sessions.items() if session["lastUsed"] < cutoff]
        while len(self.sessions) - len(expired) >= MAX_SANDBOX_SESSIONS:
            oldest = min(self.sessions.items(), key=lambda item: item[1]["lastUsed"])[0]
            if oldest not in expired:
                expired.append(oldest)
        for session_id in expired:
            session = self.sessions.pop(session_id, None)
            if session:
                with session["lock"]:
                    session["connection"].close()

    def reset(self, target: str, session_id: str | None = None) -> dict:
        connection, mode, row_count = _build_sandbox_connection(target)
        table_count = connection.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchone()[0]
        now = time.monotonic()
        next_id = uuid.uuid4().hex
        with self.lock:
            if session_id:
                old = self.sessions.pop(session_id, None)
                if old:
                    with old["lock"]:
                        old["connection"].close()
            self._expire_old_sessions()
            self.sessions[next_id] = {
                "connection": connection,
                "target": mode,
                "rowCount": row_count,
                "tableCount": table_count,
                "lastUsed": now,
                "lock": threading.RLock(),
            }
        return {
            "sessionId": next_id,
            "target": mode,
            "tableCount": table_count,
            "sourceRows": row_count,
            "message": "Sandbox reset to a fresh in-memory snapshot.",
        }

    def clear(self) -> None:
        with self.lock:
            sessions = list(self.sessions.values())
            self.sessions.clear()
        for session in sessions:
            with session["lock"]:
                session["connection"].close()

    def schema(self, session_id: str) -> dict:
        if not isinstance(session_id, str) or not re.fullmatch(r"[0-9a-f]{32}", session_id):
            raise ApiError("Reset the sandbox to start a valid session.", 409)
        with self.lock:
            session = self.sessions.get(session_id)
        if not session:
            raise ApiError("Sandbox session expired. Reset it to create a fresh snapshot.", 409)
        with session["lock"]:
            connection: sqlite3.Connection = session["connection"]
            names = [row[0] for row in connection.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
            )]
            tables = []
            for name in names:
                quoted_name = _quote_identifier(name)
                columns = [row[1] for row in connection.execute(f"PRAGMA table_info({quoted_name})")]
                row_count = connection.execute(f"SELECT COUNT(*) FROM {quoted_name}").fetchone()[0]
                tables.append({"name": name, "columns": columns, "rows": row_count})
            session["lastUsed"] = time.monotonic()
            return {
                "target": session["target"],
                "label": "Sandbox snapshot · validated CSV" if session["target"] == "validated" else "Sandbox snapshot · SQLite data mart",
                "tables": tables,
            }

    def execute(self, session_id: str, sql: str) -> dict:
        if not isinstance(session_id, str) or not re.fullmatch(r"[0-9a-f]{32}", session_id):
            raise ApiError("Reset the sandbox to start a valid session.", 409)
        if not isinstance(sql, str) or not sql.strip():
            raise ApiError("Enter a SQL statement first.")
        if len(sql) > MAX_QUERY_LENGTH:
            raise ApiError(f"Statement is too long (maximum {MAX_QUERY_LENGTH:,} characters).", 413)
        if not re.match(r"(?is)^\s*(SELECT|WITH|EXPLAIN|CREATE|INSERT|UPDATE|DELETE|DROP|ALTER|REPLACE)\b", sql):
            raise ApiError("Sandbox accepts SELECT queries and temporary table/data changes only.")

        with self.lock:
            session = self.sessions.get(session_id)
        if not session:
            raise ApiError("Sandbox session expired. Reset it to create a fresh snapshot.", 409)

        with session["lock"]:
            connection: sqlite3.Connection = session["connection"]
            started = time.perf_counter()
            deadline = started + QUERY_TIMEOUT_SECONDS
            denied_actions = {
                sqlite3.SQLITE_ATTACH,
                sqlite3.SQLITE_DETACH,
                sqlite3.SQLITE_PRAGMA,
                sqlite3.SQLITE_CREATE_VTABLE,
                sqlite3.SQLITE_DROP_VTABLE,
            }

            def authorize(action: int, arg1: str | None, arg2: str | None, _db: str | None, _trigger: str | None) -> int:
                if action in denied_actions:
                    return sqlite3.SQLITE_DENY
                if action == sqlite3.SQLITE_FUNCTION and (arg2 or arg1 or "").casefold() in {
                    "load_extension", "writefile", "readfile"
                }:
                    return sqlite3.SQLITE_DENY
                return sqlite3.SQLITE_OK

            connection.set_authorizer(authorize)
            connection.set_progress_handler(lambda: int(time.perf_counter() > deadline), 1_000)
            try:
                before_changes = connection.total_changes
                cursor = connection.execute(sql)
                if cursor.description is None:
                    connection.commit()
                    rows: list[tuple] = []
                    columns: list[str] = []
                    row_count = max(0, connection.total_changes - before_changes)
                    truncated = False
                else:
                    columns = [column[0] for column in cursor.description]
                    fetched = cursor.fetchmany(MAX_QUERY_ROWS + 1)
                    connection.commit()
                    truncated = len(fetched) > MAX_QUERY_ROWS
                    rows = fetched[:MAX_QUERY_ROWS]
                    row_count = len(rows)
                session["lastUsed"] = time.monotonic()
                return {
                    "target": session["target"],
                    "columns": columns,
                    "rows": [list(row) for row in rows],
                    "rowCount": row_count,
                    "truncated": truncated,
                    "durationMs": round((time.perf_counter() - started) * 1_000, 1),
                    "statementType": "query" if columns else "sandbox change",
                    "message": "Changes exist only in this memory session; Reset restores the original snapshot.",
                }
            except sqlite3.OperationalError as error:
                connection.rollback()
                if "interrupted" in str(error).casefold():
                    raise ApiError(f"Statement exceeded the {QUERY_TIMEOUT_SECONDS}-second sandbox limit.", 408) from error
                raise ApiError(str(error)) from error
            except sqlite3.Error as error:
                connection.rollback()
                raise ApiError(str(error)) from error
            finally:
                connection.set_progress_handler(None, 0)
                connection.set_authorizer(None)


SANDBOXES = SandboxSessionManager()


def _validated_web_data_dir() -> Path:
    expected = (WEB_ROOT / "data").resolve()
    if WEB_DATA_DIR.is_symlink() or WEB_DATA_DIR.resolve() != expected or expected.parent != WEB_ROOT:
        raise ApiError("The web demo data path must stay inside web/data.", 500)
    return WEB_DATA_DIR


def initialize_web_demo_data() -> None:
    """Make an isolated website data snapshot once, without changing root data."""
    with WEB_DATA_LOCK:
        data_dir = _validated_web_data_dir()
        if WEB_DATA_SEED_MARKER.is_symlink():
            raise RuntimeError("The web demo seed marker cannot be a symlink.")
        if not WEB_DATA_SEED_MARKER.exists():
            if not data_dir.exists():
                if ROOT_DATA_DIR.is_dir():
                    shutil.copytree(ROOT_DATA_DIR, data_dir, symlinks=True)
                else:
                    data_dir.mkdir(parents=True, exist_ok=True)
            elif not any(data_dir.iterdir()) and ROOT_DATA_DIR.is_dir():
                shutil.copytree(ROOT_DATA_DIR, data_dir, dirs_exist_ok=True, symlinks=True)
            else:
                data_dir.mkdir(parents=True, exist_ok=True)
            if ROOT_DATA_DIR.is_dir():
                WEB_DATA_SEED_MARKER.touch()
        else:
            data_dir.mkdir(parents=True, exist_ok=True)


def reset_web_demo_data() -> dict:
    """Clear only web/data and expire SQL snapshots backed by that data."""
    with RUNS.lock:
        current = RUNS.current
        if current and current["status"] in ("starting", "running"):
            raise ApiError("Stop the website pipeline run before resetting demo data.", 409)
        with WEB_DATA_LOCK:
            data_dir = _validated_web_data_dir()
            data_dir.mkdir(parents=True, exist_ok=True)
            paths = list(data_dir.rglob("*"))
            deleted_files = sum(1 for path in paths if path.is_file() or path.is_symlink())
            deleted_directories = sum(1 for path in paths if path.is_dir() and not path.is_symlink())
            for child in data_dir.iterdir():
                if child.is_symlink() or child.is_file():
                    child.unlink()
                elif child.is_dir():
                    shutil.rmtree(child)
            if WEB_DATA_SEED_MARKER.is_symlink():
                raise ApiError("The web demo seed marker cannot be a symlink.", 500)
            WEB_DATA_SEED_MARKER.touch()
            SANDBOXES.clear()
            return {
                "dataPath": "web/data",
                "deletedFiles": deleted_files,
                "deletedDirectories": deleted_directories,
                "message": "Website demo data cleared. Root data was left untouched.",
            }


class RequestHandler(BaseHTTPRequestHandler):
    server_version = "CN230PipelineAPI/1.0"

    def log_message(self, _format: str, *_args) -> None:
        return

    def _send_json(self, payload: dict, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict:
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if length < 0 or length > 1_000_000:
                raise ApiError("Request body is too large.", 413)
            return json.loads(self.rfile.read(length) or b"{}")
        except (ValueError, json.JSONDecodeError) as error:
            raise ApiError("Request body must be valid JSON.") from error

    def _handle(self, operation) -> None:
        try:
            self._send_json(operation())
        except ApiError as error:
            self._send_json({"error": str(error)}, error.status)
        except (OSError, sqlite3.Error) as error:
            self._send_json({"error": str(error)}, 500)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")
        query = parse_qs(parsed.query)

        if path == "/api/health":
            def health() -> dict:
                with WEB_DATA_LOCK:
                    files = list(ACCEPTED_PATH.glob("*_VALID.csv")) if ACCEPTED_PATH.exists() else []
                    return {
                        "ok": True,
                        "approvedSources": len(approved_sources()),
                        "acceptedFiles": len(files),
                        "acceptedRecords": count_csv_records(),
                        "sqliteReady": SQLITE_PATH.is_file() and SQLITE_PATH.stat().st_size > 0,
                    }
            return self._handle(health)
        if path == "/api/sources":
            return self._handle(lambda: {"sources": approved_sources()})
        if path == "/api/sources/registry":
            return self._handle(source_registry)
        if path == "/api/presentation/snapshot":
            def snapshot() -> dict:
                with WEB_DATA_LOCK:
                    return presentation_snapshot()
            return self._handle(snapshot)
        if path == "/api/pipeline/files":
            def files() -> dict:
                with WEB_DATA_LOCK:
                    return pipeline_file_index()
            return self._handle(files)
        if path == "/api/pipeline/files/preview":
            stage_key = (query.get("stage") or [""])[0]
            relative_name = (query.get("name") or [""])[0]
            sheet_name = (query.get("sheet") or [None])[0]
            def preview() -> dict:
                with WEB_DATA_LOCK:
                    return pipeline_file_preview(stage_key, relative_name, sheet_name)
            return self._handle(preview)
        if path == "/api/database/sandbox/schema":
            session_id = (query.get("sessionId") or [""])[0]
            return self._handle(lambda: SANDBOXES.schema(session_id))
        if path == "/api/database/schema":
            target = (query.get("target") or ["validated"])[0]
            return self._handle(lambda: database_schema(target))
        if path.startswith("/api/pipeline/runs/"):
            run_id = path.rsplit("/", 1)[-1]
            try:
                cursor = int((query.get("cursor") or ["0"])[0])
            except ValueError:
                return self._send_json({"error": "Invalid log cursor."}, 400)
            return self._handle(lambda: RUNS.get(run_id, cursor))
        self._send_json({"error": "Not found."}, 404)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/")

        if path == "/api/pipeline/demo/reset":
            def reset_demo() -> dict:
                self._read_json()
                return reset_web_demo_data()
            return self._handle(reset_demo)

        if path == "/api/pipeline/run":
            def start_run() -> dict:
                body = self._read_json()
                approved = approved_sources()
                approved_ids = {source["sourceId"] for source in approved}
                raw_ids = body.get("sourceIds")
                if raw_ids is None:
                    source_ids = sorted(approved_ids)
                elif isinstance(raw_ids, list) and all(isinstance(item, str) for item in raw_ids):
                    source_ids = sorted({item.strip().upper() for item in raw_ids})
                    if not source_ids:
                        raise ApiError("Select at least one approved source.")
                    unknown = set(source_ids) - approved_ids
                    if unknown:
                        raise ApiError("Only currently approved source IDs can be run: " + ", ".join(sorted(unknown)))
                else:
                    raise ApiError("sourceIds must be a list of approved source IDs.")
                force = body.get("force", False)
                to_database = body.get("toDatabase", True)
                if not isinstance(force, bool) or not isinstance(to_database, bool):
                    raise ApiError("force and toDatabase must be boolean values.")
                return RUNS.start(source_ids, force, to_database)
            return self._handle(start_run)

        if path == "/api/database/query":
            def query() -> dict:
                body = self._read_json()
                return execute_read_query(body.get("sql"), body.get("target", "validated"))
            return self._handle(query)

        if path == "/api/database/sandbox/reset":
            def reset_sandbox() -> dict:
                body = self._read_json()
                target = body.get("target", "validated")
                session_id = body.get("sessionId")
                if session_id is not None and not isinstance(session_id, str):
                    raise ApiError("sessionId must be a string.")
                with WEB_DATA_LOCK:
                    return SANDBOXES.reset(target, session_id)
            return self._handle(reset_sandbox)

        if path == "/api/database/sandbox/query":
            def sandbox_query() -> dict:
                body = self._read_json()
                return SANDBOXES.execute(body.get("sessionId"), body.get("sql"))
            return self._handle(sandbox_query)

        if path.startswith("/api/pipeline/runs/") and path.endswith("/cancel"):
            run_id = path.split("/")[-2]
            return self._handle(lambda: RUNS.cancel(run_id))

        self._send_json({"error": "Not found."}, 404)


def main() -> None:
    initialize_web_demo_data()
    server = ThreadingHTTPServer((HOST, PORT), RequestHandler)
    server.daemon_threads = True
    print(f"CN230 local pipeline API listening on http://{HOST}:{PORT}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
