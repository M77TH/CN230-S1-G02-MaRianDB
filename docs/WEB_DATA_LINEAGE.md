# Website data and traceability

## Runtime contract

The website is a static presentation app. It does not start `pipeline_api.py`, call `/api/*`, fetch source websites, or run extraction when opened. Vite serves checked-in files from `web/data/`, and the production build copies those files into `web/dist/`.

To refresh a presentation package after a separate pipeline run, use `npm run sync:presentation-data`. That command copies already-processed outputs from repository-root `data/` into `web/data/`; it does not acquire sources or execute parsing, staging, mapping, validation, or database loading. The package is then committed with the website so teammates can open the same snapshot without your local pipeline output folders.

The pipeline page is an animated replay of the saved result. Its terminal transcript is prepared from the packaged stage summaries and artifact hashes and is explicitly labeled as a replay. CSV previews and saved SQL proof load from `web/data/`; the browser does not execute SQL or pipeline stages. Browser `localStorage` stores the selected source IDs for that browser profile only; it does not store or change the shared dataset. It is not an authenticated account system and does not sync between devices.

| Website feature | Runtime source in `web/data/` | Trace shown or available |
| --- | --- | --- |
| Facility reference points | `web/data/web_catalog.json` and `web/src/data/mapEvidence.ts` | An explicit list maps each point to current SRC citations. The inspector links the catalog coordinate and the source establishing the place. Catalog coordinates are approximate. |
| Documented transport connections | `web/src/data/mapCorridors.ts` | Each line links named places documented in an approved or supporting SRC. Its evidence card identifies the document and page or section. Straight segments are schematic. |
| Station counts and province boundaries | `web/data/map_provinces.json` | SRC-108 original February 2026 workbook, joined by normalized Thai province name to SRC-116. The inspector includes the workbook sheet, column, province and both source URLs. The file includes both source hashes. |
| Licensed petroleum depots | `web/data/map_depots.json` | SRC-111 original workbook. Each detail includes the registration, storage capacity and source row. Records without published coordinates appear in the list. |
| Latest staged EPPO observations | `web/data/map_eppo.json` | The latest month in each packaged staging file for SRC-048 through SRC-050. SRC-049 is joined by the reported refinery label. Each row retains the period, unit, record ID, original file and staging hash. |
| LCI dashboard snapshot and legacy catalog collections | `web/data/web_catalog.json` | Each catalog row retains source IDs, URLs, named references, related record IDs, or an explicit gap. The explorer shows record and collection lineage. |
| Accepted LCI results | `web/data/processed_snapshot.json` and `web/data/validation/accepted/*_VALID.csv` | Per row: source URL/hash, raw filename, extraction batch, report page/period, reported value/unit, conversion/allocation details, and accepted-file hash when supplied by the pipeline. |
| Upstream production shown on the map | `web/data/upstream_map.json` and `web/data/staging/*_STAGED.csv` | Latest-period observations use the explicit DMF reporting group crosswalk. The reported group, block, metric, unit, period, batch, and file hashes accompany each value. The source browser lists the other groups at their original reporting scope. |
| Source registry and evidence | `web/data/source_registry.json` and `web/data/processed_snapshot.json` | SRC ID, publisher, source URL, approval status, usage notes, verification claims, limitations and screenshot hashes. |
| Pipeline replay and saved query proof | `web/data/pipeline_demo.json`, processed artifact files, and `web/data/database/` | Shows outputs prepared before the presentation. It does not execute queries or stages in the browser. |

The basemap uses Esri tiles. The packaged province boundaries and project layers remain available when tiles fail to load.

## What the catalog represents

`web/data/web_catalog.json` is the website's packaged snapshot for curated spatial reference data and the lifecycle dashboard model. Accepted and staged pipeline outputs are packaged alongside it as their own files and snapshots. The catalog contains asset and route records, route connectivity, downstream scenario data, LCI exchanges/configuration, dashboard records, pipeline descriptions, explicit upstream map joins, registry cards, and TSRC evidence cards. Its `provenance` field describes each collection; individual records carry the available citation fields.

The build prepares a separate `web/public/` copy from `web/data/` for Vite. Individual files at or above 100,000,000 bytes are omitted from that static deployment copy and listed in `pipeline_demo.json` as `staticAssetExclusions`; their source files remain in `web/data/` and the repository. This keeps large raw evidence available in the project archive without shipping an oversized public asset.

The map lists all approved and supporting SRC entries in its source browser. Place-level metrics use matched monthly observations or PDF transcriptions with a matching reporting scope and page reference. National or organization-wide statistics are available through their source records and project files.

- The upstream map accepts a unique observation per source after its configured group match. Refresh the packaged staging and accepted data with the presentation sync command.
- The station and depot inputs can be reproduced with `web/scripts/build_map_provinces.py` and `web/scripts/build_map_depots.py` from the original files and pinned hashes. These inputs have their own publication dates.
- LCI and downstream dashboards use curated model snapshots with derivation, source fields, proxy notes and limitations where supplied.

## Traceability gaps to resolve

Open **Data Explorer → Website catalog lineage audit** for the current record counts and the IDs of records without a source, document, URL, or related-record pointer. Resolve those rows before describing their values as verified. A catalog record linked to another record still needs the referenced record's citation reviewed; topology and presets are examples of derived relationships.

Before presenting a quantitative conclusion, record the source/row IDs, transformation, unit, functional unit, allocation rule, assumptions, and limitations used to derive it. If any of these are absent, present the value as a curated estimate or proxy, or omit the conclusion.

## Source evidence refresh

The current packaged register contains 82 sources: 43 rejected historical discovery records (`SRC-001`–`SRC-043`), 18 approved core sources (`SRC-044`–`SRC-061`), and 21 Cradle-to-Gate supporting sources associated with `P01`–`P09`. Downstream, end-use, and grave supporting sources (`P10`–`P20`) are outside the current source scope. The main database follows the 10-table ERD; source evidence cards and assets are not loaded into it. Run `npm run sync:presentation-data` after an intentional pipeline run to refresh the website's registry and saved outputs.

## Related schema

The main schema has 10 LCI tables and two source-evidence tables. The optional map and provenance extension is documented in [the extended ERD](database/ERD_v2.mmd), with additive migrations for [MySQL](database/02_additive_provenance_geospatial_mysql.sql) and [SQLite](database/02_additive_provenance_geospatial_sqlite.sql).
