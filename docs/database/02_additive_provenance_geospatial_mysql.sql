-- Additive extension for source evidence, row lineage, and geospatial records.
-- Safe to apply over the existing 10-table schema: this file does not DROP or rewrite data.
-- MySQL 8.x

CREATE TABLE IF NOT EXISTS `SOURCE_CATALOG` (
  `source_code` varchar(16) NOT NULL,
  `source_role` varchar(24) NOT NULL,
  `title` varchar(500) NOT NULL,
  `publisher` varchar(255) DEFAULT NULL,
  `source_url` text DEFAULT NULL,
  `status` varchar(40) NOT NULL DEFAULT 'unspecified',
  `rights_and_notes` text DEFAULT NULL,
  `accessed_at` datetime DEFAULT NULL,
  `source_document_sha256` char(64) DEFAULT NULL,
  PRIMARY KEY (`source_code`),
  CONSTRAINT `chk_source_catalog_role` CHECK (`source_role` IN ('SRC_NUMERIC', 'TSRC_SUPPORTING', 'OTHER'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `PIPELINE_ARTIFACT` (
  `artifact_id` varchar(64) NOT NULL,
  `source_code` varchar(16) DEFAULT NULL,
  `batch_id` int DEFAULT NULL,
  `stage` varchar(32) NOT NULL,
  `relative_path` varchar(1024) NOT NULL,
  `sha256` char(64) NOT NULL,
  `row_count` bigint unsigned DEFAULT NULL,
  `generated_at` datetime NOT NULL,
  `parent_artifact_id` varchar(64) DEFAULT NULL,
  PRIMARY KEY (`artifact_id`),
  KEY `idx_artifact_source_stage` (`source_code`, `stage`),
  KEY `idx_artifact_batch` (`batch_id`),
  CONSTRAINT `fk_artifact_source` FOREIGN KEY (`source_code`) REFERENCES `SOURCE_CATALOG` (`source_code`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_artifact_batch` FOREIGN KEY (`batch_id`) REFERENCES `EXTRACTION_BATCH` (`batch_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_artifact_parent` FOREIGN KEY (`parent_artifact_id`) REFERENCES `PIPELINE_ARTIFACT` (`artifact_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `SOURCE_EVIDENCE` (
  `evidence_id` varchar(64) NOT NULL,
  `source_code` varchar(16) NOT NULL,
  `claim` text NOT NULL,
  `verified_findings` text DEFAULT NULL,
  `limitations` text DEFAULT NULL,
  `verification_method` text DEFAULT NULL,
  `source_url` text DEFAULT NULL,
  `evidence_asset_path` varchar(1024) DEFAULT NULL,
  `evidence_sha256` char(64) DEFAULT NULL,
  `usage_scope` varchar(40) NOT NULL DEFAULT 'supporting',
  `captured_at` datetime DEFAULT NULL,
  PRIMARY KEY (`evidence_id`),
  KEY `idx_evidence_source` (`source_code`),
  CONSTRAINT `fk_evidence_source` FOREIGN KEY (`source_code`) REFERENCES `SOURCE_CATALOG` (`source_code`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `MAP_ASSET` (
  `asset_id` varchar(80) NOT NULL,
  `name_th` varchar(255) DEFAULT NULL,
  `name_en` varchar(255) NOT NULL,
  `stage` varchar(24) DEFAULT NULL,
  `category` varchar(40) DEFAULT NULL,
  `latitude` decimal(10,7) DEFAULT NULL,
  `longitude` decimal(10,7) DEFAULT NULL,
  `coordinate_method` varchar(100) DEFAULT NULL,
  `coordinate_status` varchar(40) NOT NULL DEFAULT 'unverified',
  `location_note` text DEFAULT NULL,
  PRIMARY KEY (`asset_id`),
  CONSTRAINT `chk_map_asset_latitude` CHECK (`latitude` IS NULL OR `latitude` BETWEEN -90 AND 90),
  CONSTRAINT `chk_map_asset_longitude` CHECK (`longitude` IS NULL OR `longitude` BETWEEN -180 AND 180)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `MAP_ROUTE` (
  `route_id` varchar(100) NOT NULL,
  `mode` varchar(40) NOT NULL,
  `from_asset_id` varchar(80) DEFAULT NULL,
  `to_asset_id` varchar(80) DEFAULT NULL,
  `geometry_json` json DEFAULT NULL,
  `geometry_sha256` char(64) DEFAULT NULL,
  `distance_km` decimal(12,4) DEFAULT NULL,
  `distance_method` varchar(100) DEFAULT NULL,
  `evidence_status` varchar(40) NOT NULL DEFAULT 'unverified',
  `route_note` text DEFAULT NULL,
  PRIMARY KEY (`route_id`),
  KEY `idx_map_route_endpoints` (`from_asset_id`, `to_asset_id`),
  CONSTRAINT `fk_map_route_origin` FOREIGN KEY (`from_asset_id`) REFERENCES `MAP_ASSET` (`asset_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_map_route_destination` FOREIGN KEY (`to_asset_id`) REFERENCES `MAP_ASSET` (`asset_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `chk_map_route_distance` CHECK (`distance_km` IS NULL OR `distance_km` >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `MAP_ASSET_SOURCE` (
  `asset_id` varchar(80) NOT NULL,
  `source_code` varchar(16) NOT NULL,
  `claim_role` varchar(40) NOT NULL,
  `evidence_id` varchar(64) DEFAULT NULL,
  `locator_and_note` text DEFAULT NULL,
  PRIMARY KEY (`asset_id`, `source_code`, `claim_role`),
  CONSTRAINT `fk_asset_source_asset` FOREIGN KEY (`asset_id`) REFERENCES `MAP_ASSET` (`asset_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_asset_source_catalog` FOREIGN KEY (`source_code`) REFERENCES `SOURCE_CATALOG` (`source_code`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_asset_source_evidence` FOREIGN KEY (`evidence_id`) REFERENCES `SOURCE_EVIDENCE` (`evidence_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `MAP_ROUTE_SOURCE` (
  `route_id` varchar(100) NOT NULL,
  `source_code` varchar(16) NOT NULL,
  `claim_role` varchar(40) NOT NULL,
  `evidence_id` varchar(64) DEFAULT NULL,
  `locator_and_note` text DEFAULT NULL,
  PRIMARY KEY (`route_id`, `source_code`, `claim_role`),
  CONSTRAINT `fk_route_source_route` FOREIGN KEY (`route_id`) REFERENCES `MAP_ROUTE` (`route_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_route_source_catalog` FOREIGN KEY (`source_code`) REFERENCES `SOURCE_CATALOG` (`source_code`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_route_source_evidence` FOREIGN KEY (`evidence_id`) REFERENCES `SOURCE_EVIDENCE` (`evidence_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS `SOURCE_OBSERVATION` (
  `observation_id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `source_code` varchar(16) NOT NULL,
  `artifact_id` varchar(64) NOT NULL,
  `row_locator` varchar(255) NOT NULL,
  `source_group` varchar(255) DEFAULT NULL,
  `period_start` date DEFAULT NULL,
  `period_end` date DEFAULT NULL,
  `metric` varchar(150) NOT NULL,
  `reported_value` decimal(24,8) DEFAULT NULL,
  `unit` varchar(40) DEFAULT NULL,
  `original_row_json` json DEFAULT NULL,
  `source_row_sha256` char(64) DEFAULT NULL,
  `exchange_id` int DEFAULT NULL,
  `created_at` datetime NOT NULL,
  PRIMARY KEY (`observation_id`),
  UNIQUE KEY `uq_source_observation_locator_metric` (`artifact_id`, `row_locator`, `metric`),
  KEY `idx_source_observation_lookup` (`source_code`, `metric`, `period_start`),
  CONSTRAINT `fk_observation_source` FOREIGN KEY (`source_code`) REFERENCES `SOURCE_CATALOG` (`source_code`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_observation_artifact` FOREIGN KEY (`artifact_id`) REFERENCES `PIPELINE_ARTIFACT` (`artifact_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_observation_exchange` FOREIGN KEY (`exchange_id`) REFERENCES `LCI_EXCHANGE` (`exchange_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
