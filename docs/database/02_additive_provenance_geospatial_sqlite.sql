-- Additive extension for source evidence, row lineage, and geospatial records.
-- Safe to apply over the existing 10-table schema: this file does not DROP or rewrite data.
-- SQLite; run with foreign_keys enabled.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS SOURCE_CATALOG (
  source_code TEXT PRIMARY KEY,
  source_role TEXT NOT NULL CHECK (source_role IN ('SRC_NUMERIC', 'TSRC_SUPPORTING', 'OTHER')),
  title TEXT NOT NULL,
  publisher TEXT,
  source_url TEXT,
  status TEXT NOT NULL DEFAULT 'unspecified',
  rights_and_notes TEXT,
  accessed_at TEXT,
  source_document_sha256 TEXT
);

CREATE TABLE IF NOT EXISTS PIPELINE_ARTIFACT (
  artifact_id TEXT PRIMARY KEY,
  source_code TEXT,
  batch_id INTEGER,
  stage TEXT NOT NULL,
  relative_path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  row_count INTEGER CHECK (row_count IS NULL OR row_count >= 0),
  generated_at TEXT NOT NULL,
  parent_artifact_id TEXT,
  FOREIGN KEY (source_code) REFERENCES SOURCE_CATALOG(source_code) ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY (batch_id) REFERENCES EXTRACTION_BATCH(batch_id) ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY (parent_artifact_id) REFERENCES PIPELINE_ARTIFACT(artifact_id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_artifact_source_stage ON PIPELINE_ARTIFACT(source_code, stage);
CREATE INDEX IF NOT EXISTS idx_artifact_batch ON PIPELINE_ARTIFACT(batch_id);

CREATE TABLE IF NOT EXISTS SOURCE_EVIDENCE (
  evidence_id TEXT PRIMARY KEY,
  source_code TEXT NOT NULL,
  claim TEXT NOT NULL,
  verified_findings TEXT,
  limitations TEXT,
  verification_method TEXT,
  source_url TEXT,
  evidence_asset_path TEXT,
  evidence_sha256 TEXT,
  usage_scope TEXT NOT NULL DEFAULT 'supporting',
  captured_at TEXT,
  FOREIGN KEY (source_code) REFERENCES SOURCE_CATALOG(source_code) ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_evidence_source ON SOURCE_EVIDENCE(source_code);

CREATE TABLE IF NOT EXISTS MAP_ASSET (
  asset_id TEXT PRIMARY KEY,
  name_th TEXT,
  name_en TEXT NOT NULL,
  stage TEXT,
  category TEXT,
  latitude REAL CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  longitude REAL CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  coordinate_method TEXT,
  coordinate_status TEXT NOT NULL DEFAULT 'unverified',
  location_note TEXT
);

CREATE TABLE IF NOT EXISTS MAP_ROUTE (
  route_id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  from_asset_id TEXT,
  to_asset_id TEXT,
  geometry_json TEXT,
  geometry_sha256 TEXT,
  distance_km REAL CHECK (distance_km IS NULL OR distance_km >= 0),
  distance_method TEXT,
  evidence_status TEXT NOT NULL DEFAULT 'unverified',
  route_note TEXT,
  FOREIGN KEY (from_asset_id) REFERENCES MAP_ASSET(asset_id) ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY (to_asset_id) REFERENCES MAP_ASSET(asset_id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_map_route_endpoints ON MAP_ROUTE(from_asset_id, to_asset_id);

CREATE TABLE IF NOT EXISTS MAP_ASSET_SOURCE (
  asset_id TEXT NOT NULL,
  source_code TEXT NOT NULL,
  claim_role TEXT NOT NULL,
  evidence_id TEXT,
  locator_and_note TEXT,
  PRIMARY KEY (asset_id, source_code, claim_role),
  FOREIGN KEY (asset_id) REFERENCES MAP_ASSET(asset_id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (source_code) REFERENCES SOURCE_CATALOG(source_code) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (evidence_id) REFERENCES SOURCE_EVIDENCE(evidence_id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS MAP_ROUTE_SOURCE (
  route_id TEXT NOT NULL,
  source_code TEXT NOT NULL,
  claim_role TEXT NOT NULL,
  evidence_id TEXT,
  locator_and_note TEXT,
  PRIMARY KEY (route_id, source_code, claim_role),
  FOREIGN KEY (route_id) REFERENCES MAP_ROUTE(route_id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (source_code) REFERENCES SOURCE_CATALOG(source_code) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (evidence_id) REFERENCES SOURCE_EVIDENCE(evidence_id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE IF NOT EXISTS SOURCE_OBSERVATION (
  observation_id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_code TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  row_locator TEXT NOT NULL,
  source_group TEXT,
  period_start TEXT,
  period_end TEXT,
  metric TEXT NOT NULL,
  reported_value NUMERIC,
  unit TEXT,
  original_row_json TEXT,
  source_row_sha256 TEXT,
  exchange_id INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (artifact_id, row_locator, metric),
  FOREIGN KEY (source_code) REFERENCES SOURCE_CATALOG(source_code) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (artifact_id) REFERENCES PIPELINE_ARTIFACT(artifact_id) ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY (exchange_id) REFERENCES LCI_EXCHANGE(exchange_id) ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_source_observation_lookup ON SOURCE_OBSERVATION(source_code, metric, period_start);
