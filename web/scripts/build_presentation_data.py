"""Package already-processed project outputs for the static presentation site.

This script reads project data/ only. It never runs source acquisition, parsing,
mapping, validation, or database loading. Run it when intentionally refreshing
the presentation snapshot, then commit the generated web/data files.
"""

from __future__ import annotations

import csv
import hashlib
import json
import shutil
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path


WEB_ROOT = Path(__file__).resolve().parents[1]
PROJECT_ROOT = WEB_ROOT.parent
SOURCE_DATA = PROJECT_ROOT / "data"
PRESENTATION_DATA = WEB_ROOT / "data"

sys.path.insert(0, str(PROJECT_ROOT))
import pipeline_api  # noqa: E402


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def copy_processed_artifacts() -> None:
    # Copy the complete 6-stage pipeline outputs from root data/ into web/data/
    # as an isolated website demo snapshot.
    for obsolete in ("registry", "tsrc", "web"):
        target = PRESENTATION_DATA / obsolete
        if target.exists():
            shutil.rmtree(target)

    if not (SOURCE_DATA / "validation" / "accepted").is_dir():
        return

    for relative in ("raw", "parsed", "staging", "mapping", "validation", "database"):
        source = SOURCE_DATA / relative
        target = PRESENTATION_DATA / relative
        if target.exists():
            shutil.rmtree(target)
        if source.is_dir():
            shutil.copytree(source, target, ignore=shutil.ignore_patterns("*.lock"))


def _rel_inside_data(project_relative_path: str) -> str:
    normalized = project_relative_path.replace("\\", "/")
    if normalized.startswith("web/data/"):
        return normalized[len("web/data/"):]
    if normalized.startswith("data/"):
        return normalized[len("data/"):]
    return normalized


def public_url(project_relative_path: str) -> str:
    rel = _rel_inside_data(project_relative_path)
    return "/" + rel if rel else ""


def read_csv(path: Path) -> list[dict[str, str]]:
    try:
        with path.open(encoding="utf-8-sig", newline="") as stream:
            return list(csv.DictReader(stream))
    except UnicodeDecodeError:
        with path.open(encoding="cp874", newline="") as stream:
            return list(csv.DictReader(stream))


def map_eppo_observations(root: Path) -> list[dict]:
    observations = []
    for source_id, key in (("SRC-048", "product"), ("SRC-049", "company"), ("SRC-050", "sector")):
        files = sorted(root.glob(f"staging/{source_id}_*_STAGED.csv"))
        if not files:
            continue
        if len(files) != 1:
            raise ValueError(f"{source_id}: multiple staged snapshots")
        path = files[0]
        rows = [row for row in read_csv(path) if row.get("year", "").isdigit() and row.get("month_num", "").isdigit()]
        if not rows:
            continue
        period = max((int(row["year"]), int(row["month_num"])) for row in rows)
        file_hash = file_sha256(path)
        for row in rows:
            if (int(row["year"]), int(row["month_num"])) != period:
                continue
            observations.append({
                "sourceId": source_id,
                "sourceGroup": row[key],
                "period": f"{period[0]:04}-{period[1]:02}",
                "metric": key,
                "value": float(row["quantity"]),
                "unit": row["unit"],
                "recordId": row["record_id"],
                "sourceUrl": row["_source_url"],
                "sourceSha256": row["_source_sha256"],
                "rawFile": row["_raw_file"],
                "extractionBatchId": row["_extraction_batch_id"],
                "stagingPath": f"web/data/staging/{path.name}",
                "stagedFileSha256": file_hash,
            })
    return observations


def build_source_replays(registry: dict, artifact_index: dict, accepted: dict) -> list[dict]:
    sources = {source["sourceId"]: source for source in registry["sources"]}
    source_ids = set(accepted["sourceIds"])
    accepted_by_source = defaultdict(list)
    for artifact in accepted["files"]:
        accepted_by_source[artifact["sourceId"]].append(artifact)

    files_by_source = defaultdict(list)
    for stage in artifact_index["stages"]:
        if stage["key"] not in {"raw", "parsed", "staging", "mapping", "rejected"}:
            continue
        for artifact in stage["files"]:
            source_id = artifact["name"].split("_", 1)[0].upper()
            if source_id in source_ids:
                files_by_source[source_id, stage["key"]].append(PROJECT_ROOT / artifact["path"])

    raw_ledger = PRESENTATION_DATA / "raw" / "_provenance_ledger.jsonl"
    if not raw_ledger.is_file():
        raw_ledger = SOURCE_DATA / "raw" / "_provenance_ledger.jsonl"
    acquisition_by_file = {}
    if raw_ledger.is_file():
        for line in raw_ledger.read_text(encoding="utf-8").splitlines():
            if line.strip():
                entry = json.loads(line)
                if entry.get("status") == "ACQUIRED":
                    acquisition_by_file[entry.get("raw_file_rel_path")] = entry

    database = PRESENTATION_DATA / "database" / "csv"
    if not database.is_dir():
        database = SOURCE_DATA / "database" / "csv"
    batches_path = database / "EXTRACTION_BATCH.csv"
    exchanges_path = database / "LCI_EXCHANGE.csv"
    exchange_counts: Counter[str] | None = None
    if batches_path.is_file() and exchanges_path.is_file():
        batch_sources = {row["batch_id"]: f"SRC-{int(row['source_id']):03d}" for row in read_csv(batches_path)}
        exchange_counts = Counter(batch_sources[row["batch_id"]] for row in read_csv(exchanges_path))

    replays = []
    for source_id in accepted["sourceIds"]:
        source = sources.get(source_id)
        registry_lines = [f"{source_id} · No saved registry entry"]
        if source:
            registry_lines = [f"{source_id} · {source['title']}", f"{source['publisher']} · {source['status']}"]
        steps = [{"label": "REGISTRY", "lines": registry_lines}]

        raw_lines = []
        raw_rows = 0
        raw_bytes = 0
        raw_batch_id = ""
        raw_sha256 = ""
        for path in files_by_source[source_id, "raw"]:
            relative_path = path.relative_to(PROJECT_ROOT).as_posix()
            rel_inside = _rel_inside_data(relative_path)
            source_rel = f"data/{rel_inside}"
            raw_bytes += path.stat().st_size
            size = f"{path.stat().st_size:,} bytes"
            if path.suffix.casefold() == ".csv":
                csv_len = len(read_csv(path))
                raw_rows += csv_len
                description = f"{csv_len:,} CSV rows · {size}"
            else:
                description = size
            raw_lines.append(f"Captured {source_rel} · {description}")
            entry = acquisition_by_file.get(source_rel) or acquisition_by_file.get(relative_path)
            if entry and entry.get("sha256_checksum") == file_sha256(path):
                raw_batch_id = entry.get("extraction_batch_id", "")
                raw_sha256 = entry.get("sha256_checksum", "")
                raw_lines.append(f"Batch {raw_batch_id} · HTTP {entry['http_status']}")
                raw_lines.append(f"SHA-256 {raw_sha256}")
        steps.append({"label": "RAW ACQUISITION", "lines": raw_lines or ["No saved raw file"]})

        stage_row_counts = {"parsed": 0, "staging": 0, "mapping": 0}
        allocation_method = ""
        pdf_pages: list[str] = []
        for key, label, action in (
            ("parsed", "PARSE", "Extracted table rows"),
            ("staging", "STAGE", "Normalized rows and attached provenance"),
            ("mapping", "MAP", "Mapped rows to LCI exchanges"),
        ):
            lines = []
            for path in files_by_source[source_id, key]:
                if path.suffix.casefold() != ".csv":
                    continue
                rows = read_csv(path)
                stage_row_counts[key] += len(rows)
                lines.append(f"{action} · {len(rows):,} rows → {path.name}")
                if key != "mapping" or not rows:
                    continue
                first = rows[0]
                lines.append(f"Example · {first['flow_name']} · {first['direction']} {first['amount']} {first['unit']}")
                methods = sorted({row[column] for row in rows for column in ("_allocation_basis", "_extraction_basis") if row.get(column)})
                pages = sorted({row["_source_page"] for row in rows if row.get("_source_page")})
                if methods:
                    allocation_method = ", ".join(methods)
                    lines.append(f"Method · {allocation_method}")
                if pages:
                    pdf_pages = pages
                    lines.append(f"PDF pages · {', '.join(pages)}")
            steps.append({"label": label, "lines": lines or ["No saved CSV output"]})

        accepted_files = accepted_by_source[source_id]
        accepted_rows = sum(artifact["records"] for artifact in accepted_files)
        rejected_files = [(path, len(read_csv(path))) for path in files_by_source[source_id, "rejected"]]
        quarantined_rows = sum(count for _, count in rejected_files)
        validation_lines = [f"{accepted_rows:,} accepted · {quarantined_rows:,} quarantined"]
        for artifact in accepted_files:
            validation_lines.extend([artifact["file"], f"SHA-256 {artifact['sha256']}"])
        validation_lines.extend(f"{path.name} · {count:,} quarantined" for path, count in rejected_files if count)
        steps.append({"label": "VALIDATE", "lines": validation_lines})

        db_exchanges = exchange_counts[source_id] if exchange_counts is not None else accepted_rows
        database_line = "No saved exchange or extraction batch export"
        if exchange_counts is not None:
            database_line = f"{db_exchanges:,} rows in LCI_EXCHANGE.csv matched by extraction batch"
        steps.append({"label": "DATABASE EXPORT", "lines": [database_line]})
        is_upstream_cluster = source_id in {"SRC-044", "SRC-045", "SRC-046", "SRC-047"}
        replays.append({
            "sourceId": source_id,
            "title": source["title"] if source else source_id,
            "publisher": source["publisher"] if source else "",
            "sector": source.get("sector", "") if source else "",
            "sourceType": source.get("sourceType", "") if source else "",
            "phase": "UPSTREAM CLUSTER" if is_upstream_cluster else "MIDSTREAM & GUIDELINES",
            "requiresUpstreamCluster": source_id in {"SRC-044", "SRC-045", "SRC-046"},
            "acceptedRecords": accepted_rows,
            "stageMetrics": {
                "rawRows": raw_rows,
                "rawBytes": raw_bytes,
                "batchId": raw_batch_id,
                "rawSha256": raw_sha256,
                "parsedRows": stage_row_counts["parsed"],
                "stagedRows": stage_row_counts["staging"],
                "mappedRows": stage_row_counts["mapping"],
                "acceptedRows": accepted_rows,
                "quarantinedRows": quarantined_rows,
                "databaseExchanges": db_exchanges,
                "acceptedSha256": accepted_files[0]["sha256"] if accepted_files else "",
                "allocationMethod": allocation_method,
                "pdfPages": pdf_pages,
            },
            "steps": steps,
        })
    return replays


def load_database_tables(root: Path) -> dict:
    db_csv_dir = root / "database" / "csv"
    tables = {}
    for table_name in (
        "SOURCE",
        "REFERENCE",
        "EXTRACTION_BATCH",
        "LOCATION",
        "UNIT",
        "FLOW",
        "PROCESS",
        "LCI_EXCHANGE",
        "REJECTED_RECORD",
    ):
        csv_path = db_csv_dir / f"{table_name}.csv"
        tables[table_name] = read_csv(csv_path) if csv_path.is_file() else []
    tables["qcRules"] = [
        "Check_Null_URL",
        "Validate_Unit",
        "Check_Non_Negative",
        "Validate_Direction",
        "Check_Process_Year",
        "Validate_Product_Flow",
        "Check_Allocation_Burdens",
    ]
    return tables


def load_provenance_ledger(root: Path) -> list[dict]:
    ledger_path = root / "raw" / "_provenance_ledger.jsonl"
    if not ledger_path.is_file():
        return []
    entries = []
    for line in ledger_path.read_text(encoding="utf-8").splitlines():
        if line.strip():
            entry = json.loads(line)
            if entry.get("status") == "ACQUIRED":
                entries.append(entry)
    return entries


def main() -> None:
    PRESENTATION_DATA.mkdir(parents=True, exist_ok=True)
    copy_processed_artifacts()

    catalog_target = PRESENTATION_DATA / "web_catalog.json"
    legacy_catalog_source = SOURCE_DATA / "web" / "web_catalog.json"
    if legacy_catalog_source.is_file() and not catalog_target.is_file():
        shutil.copy2(legacy_catalog_source, catalog_target)
    if not catalog_target.is_file():
        raise SystemExit(f"Missing curated website catalog: {catalog_target}")
    if not pipeline_api.ACCEPTED_PATH.is_dir():
        raise SystemExit(f"Missing processed accepted data: {pipeline_api.ACCEPTED_PATH}")

    catalog = json.loads(catalog_target.read_text(encoding="utf-8"))
    if catalog.get("catalogSource") != "web/data/web_catalog.json":
        catalog["catalogSource"] = "web/data/web_catalog.json"
        write_json(catalog_target, catalog)
    catalog_artifact = {
        "path": "web/data/web_catalog.json",
        "sha256": file_sha256(catalog_target),
        "modifiedAt": datetime.fromtimestamp(catalog_target.stat().st_mtime, timezone.utc).isoformat(),
    }

    accepted = pipeline_api.processed_accepted_records()
    for artifact in accepted["files"]:
        rel = _rel_inside_data(artifact["path"])
        artifact["sourcePath"] = "data/" + rel
        artifact["path"] = "web/data/" + rel
        artifact["publicUrl"] = "/" + rel

    upstream = pipeline_api.latest_upstream_map_observations()
    for artifact in upstream["files"]:
        rel = _rel_inside_data(artifact["path"])
        artifact["sourcePath"] = "data/" + rel
        artifact["path"] = "web/data/" + rel
        artifact["publicUrl"] = "/" + rel
    for observation in upstream["observations"]:
        rel = _rel_inside_data(observation["stagingPath"])
        observation["sourceStagingPath"] = "data/" + rel
        observation["stagingPath"] = "web/data/" + rel

    registry = pipeline_api.source_registry()
    registry["registryPath"] = "web/data/source_registry.json"
    for source in registry["sources"]:
        for asset in source.get("evidenceAssets", []):
            asset_path = asset.get("path", "").replace("\\", "/")
            asset["publicUrl"] = "/" + asset_path if (PRESENTATION_DATA / asset_path).is_file() else ""

    write_json(PRESENTATION_DATA / "processed_snapshot.json", {
        "snapshotMode": "precomputed presentation snapshot",
        "snapshotGeneratedAt": datetime.now(timezone.utc).isoformat(),
        "accepted": accepted,
        "registry": registry,
    })
    write_json(PRESENTATION_DATA / "upstream_map.json", upstream)
    write_json(PRESENTATION_DATA / "map_eppo.json", map_eppo_observations(PRESENTATION_DATA))
    write_json(PRESENTATION_DATA / "source_registry.json", registry)

    artifact_index = pipeline_api.pipeline_file_index()
    source_replays = build_source_replays(registry, artifact_index, accepted)
    visible_stage_keys = {"raw", "parsed", "staging", "mapping", "accepted", "rejected", "database"}
    visible_stages = []
    for stage in artifact_index.get("stages", []):
        if stage.get("key") not in visible_stage_keys:
            continue
        files = []
        for artifact in stage.get("files", []):
            original_path = artifact.get("path", "")
            rel = _rel_inside_data(original_path)
            artifact["sourcePath"] = "data/" + rel
            artifact["publicUrl"] = "/" + rel
            source_file = PRESENTATION_DATA / rel
            if source_file.is_file():
                artifact["sha256"] = file_sha256(source_file)
            artifact["path"] = "web/data/" + rel
            if artifact["publicUrl"]:
                files.append(artifact)
        stage["files"] = files
        visible_stages.append(stage)

    pipeline_demo = {
        "mode": "precomputed replay",
        "snapshotGeneratedAt": datetime.now(timezone.utc).isoformat(),
        "catalogArtifact": catalog_artifact,
        "sourceIds": accepted["sourceIds"],
        "acceptedRecordCount": accepted["recordCount"],
        "acceptedFileCount": len(accepted["files"]),
        "acceptedFiles": accepted["files"],
        "upstreamObservationCount": len(upstream["observations"]),
        "registryCount": registry["total"],
        "pipelineSummary": pipeline_api.presentation_snapshot(),
        "stages": visible_stages,
        "sourceReplays": source_replays,
        "databaseTables": load_database_tables(PRESENTATION_DATA),
        "provenanceLedger": load_provenance_ledger(PRESENTATION_DATA),
        "notice": "This page replays results prepared before the presentation. It does not fetch sources or execute pipeline stages.",
    }
    write_json(PRESENTATION_DATA / "pipeline_demo.json", pipeline_demo)

    export_dir = PRESENTATION_DATA / "exports"
    export_dir.mkdir(parents=True, exist_ok=True)
    for dataset, filename in (("lci-ledger", "lci-ledger.csv"), ("routes", "routes.csv")):
        _name, payload = pipeline_api.data_catalog_csv_export(dataset)
        (export_dir / filename).write_bytes(payload)

    manifest_path = PRESENTATION_DATA / "presentation_manifest.json"
    package_files = sorted(
        path for path in PRESENTATION_DATA.rglob("*")
        if path.is_file() and path != manifest_path and path.name != ".gitkeep"
    )
    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceDataRoot": "data/",
        "presentationDataRoot": "web/data/",
        "refreshMode": "copy already-processed outputs; no acquisition or pipeline run",
        "catalogArtifact": catalog_artifact,
        "files": [
            {
                "path": f"web/data/{path.relative_to(PRESENTATION_DATA).as_posix()}",
                "sha256": file_sha256(path),
                "sizeBytes": path.stat().st_size,
            }
            for path in package_files
        ],
    }
    write_json(manifest_path, manifest)

    print(
        "Packaged presentation snapshot: "
        f"{accepted['recordCount']} accepted records, "
        f"{len(upstream['observations'])} upstream map observations, "
        f"{len(visible_stages)} artifact stages in {PRESENTATION_DATA}"
    )


if __name__ == "__main__":
    main()
