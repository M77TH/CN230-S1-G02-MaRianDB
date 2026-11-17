"""Local, loopback-only API for the CN230 pipeline presentation workbench."""

from __future__ import annotations

import csv
import hashlib
import io
import json
import mimetypes
import os
import re
import sqlite3
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
ROOT_DATA_DIR = (PROJECT_ROOT / "data").resolve()
# Website demo data lives in web/data/, isolated from terminal runs in root data/.
WEB_DATA_DIR = (WEB_ROOT / "data").resolve()
WEB_DATA_LOCK = threading.RLock()
REGISTRY_PATH = PROJECT_ROOT / "docs" / "source_registry" / "source_registry.csv"
EVIDENCE_CAPTURE_ROOT = (PROJECT_ROOT / "evidence_captures").resolve()
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
                "sourceUrls": _parse_json_list(row.get("source_urls")),
            })
    return sorted(items, key=lambda item: item["sourceId"])


def _parse_json_list(raw: str | None) -> list:
    if not raw or not raw.strip():
        return []
    try:
        parsed = json.loads(raw)
        return parsed if isinstance(parsed, list) else []
    except json.JSONDecodeError:
        return []


def source_registry() -> dict:
    """Return canonical registry rows with supporting evidence details."""
    if not REGISTRY_PATH.is_file():
        raise ApiError("The source registry file is missing.", 404)

    sources = {}
    with REGISTRY_PATH.open("r", encoding="utf-8-sig", newline="") as registry_file:
        for row in csv.DictReader(registry_file):
            source_id = (row.get("source_id") or "").strip().upper()
            if not source_id:
                continue
            entry = {
                "sourceId": source_id,
                "title": (row.get("title") or "").strip(),
                "publisher": (row.get("publisher_or_owner") or "").strip(),
                "url": (row.get("url_or_document_id") or "").strip(),
                "sourceUrls": _parse_json_list(row.get("source_urls")),
                "accessedAt": (row.get("accessed_at") or "").strip(),
                "sourceType": (row.get("source_type") or "").strip(),
                "sector": (row.get("sector") or "").strip(),
                "rights": (row.get("rights_or_terms") or "").strip(),
                "status": (row.get("status") or "").strip().casefold() or "unspecified",
                "notes": (row.get("notes") or "").strip(),
            }
            evidence_assets = _parse_json_list(row.get("evidence_assets"))
            source_urls = _parse_json_list(row.get("source_urls"))
            linked_source_ids = _parse_json_list(row.get("linked_source_ids"))
            process_ids = _parse_json_list(row.get("process_ids"))
            exchange_ids = _parse_json_list(row.get("exchange_ids"))
            if (
                entry["status"] == "supporting"
                or evidence_assets
                or (row.get("verified_findings") or "").strip()
                or (row.get("limitations_and_interpretation") or "").strip()
            ):
                entry.update({
                    "sourceUrls": source_urls,
                    "sourceOverview": (row.get("source_overview") or "").strip(),
                    "verifiedFindings": (row.get("verified_findings") or "").strip(),
                    "limitations": (row.get("limitations_and_interpretation") or "").strip(),
                    "verificationMethod": (row.get("verification_method") or "").strip(),
                    "lciUsage": (row.get("lci_usage") or "").strip(),
                    "linkedSourceIds": linked_source_ids,
                    "processIds": process_ids,
                    "exchangeIds": exchange_ids,
                    "evidenceCount": int(row["evidence_count"]) if (row.get("evidence_count") or "").strip().isdigit() else len(evidence_assets),
                    "evidenceAssets": [
                        {
                            "figure": asset.get("figure", ""),
                            "caption": asset.get("caption", ""),
                            "path": asset.get("asset_path", ""),
                            "sha256": asset.get("sha256", ""),
                        }
                        for asset in evidence_assets
                        if isinstance(asset, dict)
                    ],
                })
            sources[source_id] = entry

    status_counts: dict[str, int] = {}
    for source in sources.values():
        status = source["status"]
        status_counts[status] = status_counts.get(status, 0) + 1
    return {
        "registryPath": "docs/source_registry/source_registry.csv",
        "updatedAt": datetime.fromtimestamp(REGISTRY_PATH.stat().st_mtime, timezone.utc).isoformat(),
        "registrySha256": _file_sha256(REGISTRY_PATH),
        "total": len(sources),
        "statusCounts": status_counts,
        "sources": [source for _, source in sorted(sources.items())],
    }


def data_catalog_csv_export(dataset: str) -> tuple[str, bytes]:
    """Export a listed collection directly from the website demo data catalog."""
    collections = {
        "lci-ledger": (("processDashboard", "ledger"), "lci_exchange_cradle_to_grave.csv"),
        "routes": (("routes",), "transmission_routes.csv"),
    }
    if dataset not in collections:
        raise ApiError("That catalog export is not available.", 404)
    catalog_path = WEB_DATA_DIR / "web_catalog.json"
    if catalog_path.is_symlink() or not catalog_path.is_file():
        raise ApiError("The website data catalog is missing from web/data/.", 404)
    try:
        catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ApiError("The website data catalog could not be read.", 500) from error
    keys, filename = collections[dataset]
    rows = catalog.get("data", {})
    for key in keys:
        rows = rows.get(key, {}) if isinstance(rows, dict) else []
    if not rows:
        raise ApiError("The requested catalog collection is empty.", 404)
    fields = list(dict.fromkeys(key for row in rows for key in row))
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fields, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return filename, buffer.getvalue().encode("utf-8-sig")


def tsrc_evidence_asset(relative_path: str) -> tuple[str, bytes]:
    """Return a screenshot when its path is present in the source registry."""
    requested_path = relative_path.strip().replace("\\", "/")
    allowed_paths = {
        asset["path"]
        for source in source_registry()["sources"]
        for asset in source.get("evidenceAssets", [])
        if asset["path"]
    }
    if requested_path not in allowed_paths:
        raise ApiError("That file is not a registered evidence asset.", 404)

    asset_path = (PROJECT_ROOT / requested_path).resolve()
    try:
        asset_path.relative_to(EVIDENCE_CAPTURE_ROOT)
    except ValueError as error:
        raise ApiError("The requested file is outside the evidence_captures folder.", 404) from error
    if asset_path.is_symlink() or not asset_path.is_file():
        raise ApiError("The registered evidence file is no longer available.", 404)
    content_type = mimetypes.guess_type(asset_path.name)[0] or "application/octet-stream"
    return content_type, asset_path.read_bytes()


def count_csv_records() -> int:
    total = 0
    for path in sorted(ACCEPTED_PATH.glob("*_VALID.csv")) if ACCEPTED_PATH.exists() else []:
        try:
            with path.open("r", encoding="utf-8-sig", newline="") as stream:
                total += max(0, sum(1 for _ in csv.reader(stream)) - 1)
        except (OSError, UnicodeError, csv.Error):
            continue
    return total


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def processed_accepted_records(source_ids: list[str] | None = None) -> dict:
    """Serve current validated CSV records with file and raw-source lineage."""
    if source_ids is not None:
        invalid_ids = [value for value in source_ids if not re.fullmatch(r"SRC-\d{3}", value)]
        if invalid_ids:
            raise ApiError("sourceIds must contain SRC-### identifiers.")

    paths = sorted(ACCEPTED_PATH.glob("*_VALID.csv")) if ACCEPTED_PATH.exists() else []
    if source_ids is not None:
        requested = set(source_ids)
        paths = [path for path in paths if path.name.split("_", 1)[0].upper() in requested]

    files: list[dict] = []
    records: list[dict[str, str]] = []
    latest_mtime = 0.0
    for path in paths:
        match = re.match(r"(SRC-\d{3})_", path.name, re.IGNORECASE)
        if not match:
            continue
        source_id = match.group(1).upper()
        try:
            stat = path.stat()
            with path.open("r", encoding="utf-8-sig", newline="") as stream:
                rows = list(csv.DictReader(stream))
            file_hash = _file_sha256(path)
        except (OSError, UnicodeError, csv.Error) as error:
            raise ApiError(f"Could not read validated file {path.name}: {error}", 500) from error

        latest_mtime = max(latest_mtime, stat.st_mtime)
        files.append({
            "sourceId": source_id,
            "file": path.name,
            "path": path.relative_to(PROJECT_ROOT).as_posix(),
            "sha256": file_hash,
            "records": len(rows),
            "updatedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        })
        for row in rows:
            row["_validated_file"] = path.name
            row["_validated_file_sha256"] = file_hash
            records.append(row)

    return {
        "stage": "validated accepted CSV",
        "dataPath": "web/data/validation/accepted",
        "updatedAt": datetime.fromtimestamp(latest_mtime, timezone.utc).isoformat() if latest_mtime else None,
        "sourceIds": sorted({item["sourceId"] for item in files}),
        "recordCount": len(records),
        "files": files,
        "records": records,
    }


def latest_upstream_map_observations() -> dict:
    """Return the latest staged monthly upstream measurements with their raw lineage."""
    metric_by_source = {
        "SRC-044": ("oil_bbl_day", "bbl/day", "Crude oil production"),
        "SRC-045": ("gas_mmscf_day", "MMSCFD", "Natural gas production"),
        "SRC-046": ("condensate_bbl_day", "bbl/day", "Condensate production"),
    }
    observations: list[dict] = []
    files: list[dict] = []
    latest_period_by_source: dict[str, tuple[int, int]] = {}

    for source_id, (metric, unit, label) in metric_by_source.items():
        paths = list((WEB_DATA_DIR / "staging").glob(f"{source_id}_*_STAGED.csv"))
        if not paths:
            continue
        path = max(paths, key=lambda candidate: candidate.stat().st_mtime)
        try:
            stat = path.stat()
            with path.open("r", encoding="utf-8-sig", newline="") as stream:
                rows = list(csv.DictReader(stream))
            file_hash = _file_sha256(path)
        except (OSError, UnicodeError, csv.Error) as error:
            raise ApiError(f"Could not read staged file {path.name}: {error}", 500) from error

        parsed_periods: list[tuple[int, int]] = []
        for row in rows:
            try:
                year, month_num = int(row.get("year") or 0), int(row.get("month_num") or 0)
            except ValueError:
                continue
            if year and 1 <= month_num <= 12:
                parsed_periods.append((year, month_num))
        if not parsed_periods:
            continue
        period = max(parsed_periods)
        latest_period_by_source[source_id] = period
        files.append({
            "sourceId": source_id,
            "file": path.name,
            "path": path.relative_to(PROJECT_ROOT).as_posix(),
            "sha256": file_hash,
            "updatedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
            "period": f"{period[0]}-{period[1]:02d}",
        })

        for row in rows:
            try:
                row_period = (int(row.get("year") or 0), int(row.get("month_num") or 0))
                value = float(row.get(metric) or "")
            except (ValueError, TypeError):
                continue
            if row_period != period or not row.get("source_group"):
                continue
            observations.append({
                "sourceId": source_id,
                "sourceGroup": row.get("source_group", ""),
                "blockName": row.get("block_name", ""),
                "year": period[0],
                "month": row.get("month", ""),
                "monthNum": period[1],
                "period": f"{period[0]}-{period[1]:02d}",
                "metric": metric,
                "metricLabel": label,
                "value": value,
                "unit": unit,
                "daysOfProduce": row.get("days_of_produce", ""),
                "sourceUrl": row.get("_source_url", ""),
                "sourceSha256": row.get("_source_sha256", ""),
                "rawFile": row.get("_raw_file", ""),
                "extractionBatchId": row.get("_extraction_batch_id", ""),
                "stagedFile": path.name,
                "stagedFileSha256": file_hash,
                "stagingPath": path.relative_to(PROJECT_ROOT).as_posix(),
                "stagedAt": row.get("_staged_at", ""),
            })

    return {
        "stage": "staging",
        "dataPath": "web/data/staging",
        "rule": "For each source ID, use the latest year/month in its staged CSV and report its raw monthly daily-rate field without conversion or summing.",
        "latestPeriods": {source_id: f"{period[0]}-{period[1]:02d}" for source_id, period in latest_period_by_source.items()},
        "files": files,
        "observations": observations,
    }


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
    represented.update(
        source_id for source_id in approved
        if (ACCEPTED_PATH / f"{source_id}_EVIDENCE_VALID.json").is_file()
    )

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
    if (WEB_ROOT / "data").is_symlink() or WEB_DATA_DIR.resolve() != expected or expected.parent != WEB_ROOT:
        raise ApiError("Website demo data must stay inside the web/data/ directory.", 500)
    return WEB_DATA_DIR


def initialize_web_demo_data() -> None:
    """Ensure the website demo data folders exist inside web/data/."""
    with WEB_DATA_LOCK:
        data_dir = _validated_web_data_dir()
        data_dir.mkdir(parents=True, exist_ok=True)
        for child in ("database", "exports", "mapping", "parsed", "raw", "staging", "validation/accepted", "validation/rejected"):
            (data_dir / child).mkdir(parents=True, exist_ok=True)


def reset_web_demo_data() -> dict:
    """Reset in-memory query sandboxes while preserving web/data/ demo files."""
    with RUNS.lock:
        current = RUNS.current
        if current and current["status"] in ("starting", "running"):
            raise ApiError("Stop the website pipeline run before resetting demo data.", 409)
        with WEB_DATA_LOCK:
            _validated_web_data_dir()
            SANDBOXES.clear()
            return {
                "dataPath": "web/data/",
                "deletedFiles": 0,
                "deletedDirectories": 0,
                "message": "In-memory SQL sessions reset. Website demo files in web/data/ were preserved.",
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
        if path == "/api/data/catalog":
            def website_catalog() -> dict:
                _validated_web_data_dir()
                catalog_path = WEB_DATA_DIR / "web_catalog.json"
                if catalog_path.is_symlink() or not catalog_path.is_file():
                    raise ApiError("The generated website data catalog is missing from web/data/.", 404)
                try:
                    catalog = json.loads(catalog_path.read_text(encoding="utf-8"))
                    stat = catalog_path.stat()
                    catalog["artifact"] = {
                        "path": "web/data/web_catalog.json",
                        "sha256": _file_sha256(catalog_path),
                        "modifiedAt": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
                    }
                    return catalog
                except (OSError, json.JSONDecodeError) as error:
                    raise ApiError("The generated website data catalog could not be read.", 500) from error
            return self._handle(website_catalog)
        if path in ("/api/data/export/lci-ledger.csv", "/api/data/export/routes.csv"):
            dataset = "lci-ledger" if path.endswith("lci-ledger.csv") else "routes"
            try:
                filename, body = data_catalog_csv_export(dataset)
            except ApiError as error:
                return self._send_json({"error": str(error)}, error.status)
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/data/accepted":
            raw_source_ids = (query.get("sourceIds") or query.get("sourceId") or [None])[0]
            source_ids = None if raw_source_ids is None else [item.strip().upper() for item in raw_source_ids.split(",") if item.strip()]
            def accepted_data() -> dict:
                with WEB_DATA_LOCK:
                    return processed_accepted_records(source_ids)
            return self._handle(accepted_data)
        if path == "/api/data/upstream-map":
            def upstream_map_data() -> dict:
                with WEB_DATA_LOCK:
                    return latest_upstream_map_observations()
            return self._handle(upstream_map_data)
        if path == "/api/sources/tsrc/evidence":
            relative_path = (query.get("path") or [""])[0]
            try:
                content_type, body = tsrc_evidence_asset(relative_path)
            except ApiError as error:
                return self._send_json({"error": str(error)}, error.status)
            except OSError as error:
                return self._send_json({"error": str(error)}, 500)
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.end_headers()
            self.wfile.write(body)
            return
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
