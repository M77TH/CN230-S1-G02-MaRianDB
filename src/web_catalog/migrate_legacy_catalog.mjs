// One-time migration helper: seed web/data/web_catalog.json from the legacy
// frontend data modules. The running website never imports those modules.
// Treat web/data/web_catalog.json as canonical after migration; do not use this
// script as a routine refresh because it will replace curated catalog edits.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const moduleAt = (relativePath) => import(pathToFileURL(path.join(projectRoot, relativePath)).href);
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(projectRoot, relativePath), 'utf8'));

const [assets, routes, lci, steps, sources, validated, mapJoins, downstream, dashboardSections] = await Promise.all([
  moduleAt('web/src/data/infrastructureAssets.ts'),
  moduleAt('web/src/data/transmissionRoutes.ts'),
  moduleAt('web/src/data/lciMasterDataset.ts'),
  moduleAt('web/src/data/pipelineSteps.ts'),
  moduleAt('web/src/data/comprehensiveSources.ts'),
  moduleAt('web/src/data/validatedDatasets.ts'),
  moduleAt('web/src/data/pipelineMapJoins.ts'),
  moduleAt('web/src/data/thailandDownstreamData.ts'),
  moduleAt('web/src/components/dashboard/dashboardData.ts'),
]);

const processDashboard = await readJson('web/src/data/processDashboardData.json');
const oldCatalogPath = path.join(projectRoot, 'web/data/web_catalog.json');
let previous = {};
try {
  const existingCatalog = JSON.parse(await readFile(oldCatalogPath, 'utf8'));
  previous = existingCatalog.data ?? existingCatalog;
} catch {
  // First export: the route graph configuration is still in its original module.
}
if (!previous.routeConnections || !previous.routePresets) {
  const graphSource = await readFile(path.join(projectRoot, 'web/src/utils/networkGraph.ts'), 'utf8');
  const readLiteral = async (name, declaration) => {
    const match = graphSource.match(new RegExp(`export const ${name}\\s*${declaration}\\s*=\\s*(\\[[\\s\\S]*?^\\]);`, 'm'));
    if (!match) throw new Error(`Could not locate ${name} in the original pathfinding module.`);
    const module = await import(`data:text/javascript,${encodeURIComponent(`export default ${match[1]}`)}`);
    return module.default;
  };
  previous.routeConnections ??= await readLiteral('ROUTE_CONNECTIONS', '(?:\\s*:\\s*EdgeDefinition\\[\\])?');
  previous.routePresets ??= await readLiteral('PRESET_ROUTES', '');
}

const records = {
  assets: assets.infrastructureAssets,
  routes: routes.transmissionRoutes,
  routeConnections: previous.routeConnections,
  routePresets: previous.routePresets,
  downstream: {
    coastalTankerCorridors: downstream.COASTAL_TANKER_CORRIDORS,
    depotClusters: downstream.DOEB_REGIONAL_CLUSTERS,
    provinceData: downstream.PROVINCE_DOWNSTREAM_DATA,
    summary: downstream.DOWNSTREAM_SUMMARY,
  },
  lciModel: {
    functionalUnitConfigs: lci.functionalUnitConfigs,
    exchanges: lci.lciExchanges,
    nationalPetroleumBalance: lci.nationalPetroleumBalance,
    otherProducts: lci.otherProductsLci,
    processChainItems: lci.processChainItems,
    benchmarkComparisons: dashboardSections.BENCHMARK_COMPARISONS,
    functionalUnitPathways: dashboardSections.FU_PATHWAYS,
    gasSpeciation: dashboardSections.GAS_SPECIATION_DATA,
    hotspotCards: dashboardSections.HOTSPOT_CARDS,
    isoAuditPhases: dashboardSections.ISO_AUDIT_PHASES,
    scopeSplitByFunctionalUnit: dashboardSections.SCOPE_SPLIT_BY_FU,
    supplyChainStages: dashboardSections.SUPPLY_CHAIN_STAGES,
    simulatorSpecs: {
      'FU-1': { id: 'FU-1', buttonLabel: 'ดีเซล (FU-1, ลิตร)', unitLabel: 'ลิตร', defaultVolume: 10000, minVolume: 100, maxVolume: 200000, stepVolume: 500, upstreamRatio: 0.099, presets: [{ label: 'รถกระบะส่วนตัว 1 คัน/ปี (1,500 L)', volume: 1500 }, { label: 'รถบรรทุก 18 ล้อ 1 คัน/ปี (36,000 L)', volume: 36000 }, { label: 'ฟลีตรถบรรทุก 10 คัน (100,000 L)', volume: 100000 }] },
      'FU-2': { id: 'FU-2', buttonLabel: 'ก๊าซ (FU-2, GJ)', unitLabel: 'GJ', defaultVolume: 500, minVolume: 10, maxVolume: 50000, stepVolume: 50, upstreamRatio: 0.215, presets: [{ label: 'ครัวเรือนขนาดเล็ก (50 GJ)', volume: 50 }, { label: 'หม้อไอน้ำโรงงานอุตสาหกรรม (2,500 GJ)', volume: 2500 }, { label: 'โรงไฟฟ้า SPP ผลิตไฟฟ้า (20,000 GJ)', volume: 20000 }] },
      'FU-3': { id: 'FU-3', buttonLabel: 'เม็ด PE (FU-3, กก.)', unitLabel: 'กก.', defaultVolume: 2000, minVolume: 50, maxVolume: 100000, stepVolume: 200, upstreamRatio: 0.394, presets: [{ label: 'ร้านสะดวกซื้อบรรจุภัณฑ์ (5,000 kg)', volume: 5000 }, { label: 'โรงงานฉีดพลาสติกขนาดกลาง (25,000 kg)', volume: 25000 }, { label: 'เทศบาลขยะพลาสติกชุมชน (100 ตัน)', volume: 100000 }] },
    },
  },
  processDashboard: {
    ...processDashboard,
    functionalUnits: {
      'FU-1': { title: 'Diesel · 1 litre', label: '1 L diesel (B0) combusted in road transport', unit: 'kg CO₂e / L', linkedProcesses: ['P02', 'P03', 'P04', 'P05', 'P06', 'P10', 'P11', 'P13'], note: 'P04 is an optional rail scenario. P05 and P10 are data gaps and are not counted as zero impact.' },
      'FU-2': { title: 'Natural gas · 1 GJ', label: '1 GJ natural gas combusted for power generation', unit: 'kg CO₂e / GJ', linkedProcesses: ['P02', 'P07', 'P08', 'P09', 'P15'], note: 'P07–P09 is a residual combined value. The 120 kWh electricity output is marked proxy.' },
      'FU-3': { title: 'Petrochemical · 1 kg', label: '1 kg petrochemical product through end of life', unit: 'kg CO₂e / kg', linkedProcesses: ['P07', 'P18', 'P19'], note: 'Incineration and landfill are alternative end-of-life scenarios. Do not add them together.' },
    },
    lifecycleLanes: [
      { id: 0, title: 'UPSTREAM', range: 'P01–P02' },
      { id: 1, title: 'MIDSTREAM', range: 'P03–P09' },
      { id: 2, title: 'DOWNSTREAM & USE', range: 'P10–P17' },
      { id: 3, title: 'END OF LIFE', range: 'P18–P20' },
    ],
  },
  pipelineSteps: steps.pipelineSteps,
  mapJoins: mapJoins.pipelineMapJoins,
  mapConfig: {
    heatmapLegends: {
      stations: { default: { title: 'จำนวนสถานีบริการน้ำมันรายจังหวัด', unit: 'สถานี', min: 36, max: 1074, source: 'TSRC-47 / TSRC-48 / TSRC-54 (DOEB 25,310 total)', sourceIds: ['TSRC-47', 'TSRC-48', 'TSRC-54'], stops: [{ color: '#d9f99d', label: '< 200' }, { color: '#fde047', label: '200–450' }, { color: '#fb923c', label: '450–700' }, { color: '#ea580c', label: '700–900' }, { color: '#b91c1c', label: '900+ (Korat/CNX/BKK)' }] } },
      vehiclesPerStation: { default: { title: 'จำนวนรถใช้น้ำมันต่อสถานีบริการ (RML/ขบ.)', unit: 'คัน/สถานี', min: 390, max: 13173, source: 'TSRC-49 DLT 44.84M Fuel Vehicles', sourceIds: ['TSRC-49'], stops: [{ color: '#d9f99d', label: '< 1,000' }, { color: '#fde047', label: '1,000–2,000' }, { color: '#fb923c', label: '2,000–4,000' }, { color: '#ea580c', label: '4,000–7,000' }, { color: '#b91c1c', label: '7,000+ (Bangkok)' }] } },
      co2e: {
        baseline2: { title: 'การปล่อย CO₂e จากรถขนส่ง — คลังศูนย์กลาง 2 แห่ง', unit: 'kgCO₂e/L', min: 0.0005, max: 0.032, source: 'TSRC-50 / TSRC-53 Valhalla Road Graph', sourceIds: ['TSRC-50', 'TSRC-53'], stops: [{ color: '#d9f99d', label: '< 0.004' }, { color: '#fde047', label: '0.004–0.011' }, { color: '#fb923c', label: '0.011–0.018' }, { color: '#ea5800', label: '0.018–0.025' }, { color: '#b91c1c', label: '0.025+ (South/North)' }] },
        tier1: { title: 'การปล่อย CO₂e จากรถขนส่ง — คลัง DOEB หลายระดับ', unit: 'kgCO₂e/L', min: 0.0005, max: 0.011, source: 'TSRC-50 / TSRC-53 Valhalla Road Graph', sourceIds: ['TSRC-50', 'TSRC-53'], stops: [{ color: '#d9f99d', label: '< 0.0015' }, { color: '#fde047', label: '0.0015–0.0030' }, { color: '#fb923c', label: '0.0030–0.0055' }, { color: '#ea5800', label: '0.0055–0.0080' }, { color: '#b91c1c', label: '0.0080+ (>235 km)' }] },
        all44: { title: 'การปล่อย CO₂e จากรถขนส่ง — คลัง DOEB หลายระดับ', unit: 'kgCO₂e/L', min: 0.0005, max: 0.011, source: 'TSRC-50 / TSRC-53 Valhalla Road Graph', sourceIds: ['TSRC-50', 'TSRC-53'], stops: [{ color: '#d9f99d', label: '< 0.0015' }, { color: '#fde047', label: '0.0015–0.0030' }, { color: '#fb923c', label: '0.0030–0.0055' }, { color: '#ea5800', label: '0.0055–0.0080' }, { color: '#b91c1c', label: '0.0080+ (>235 km)' }] },
      },
    },
  },
  sourceCards: sources.comprehensiveSources,
  validatedDatasets: {
    productionRecords: validated.validatedProductionRecords,
    refineryRecords: validated.validatedRefineryRecords,
  },
};

function inspectRecord(record) {
  const sourceIds = new Set();
  const urls = new Set();
  const namedReferences = new Set();
  const relatedRecords = new Set();
  const visit = (value, key = '') => {
    if (Array.isArray(value)) return value.forEach((item) => visit(item, key));
    if (!value || typeof value !== 'object') {
      if (typeof value !== 'string') return;
      for (const match of value.matchAll(/(?:SRC|TSRC|TTRC)-\d{2,3}/gi)) sourceIds.add(match[0].toUpperCase());
      if ((/url|uri|reference/i.test(key) || /^https?:\/\//i.test(value)) && /^https?:\/\//i.test(value)) urls.add(value);
      if (/source.?doc|source.?ref|provenance.?source|reference.?name|citation/i.test(key) && value.trim()) namedReferences.add(value.trim());
      if (/^(routeId|fromId|toId|assetId|processId|exchangeId)$/i.test(key) && value.trim()) relatedRecords.add(value.trim());
      return;
    }
    for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
  };
  visit(record);
  return { sourceIds: [...sourceIds], urls: [...urls], namedReferences: [...namedReferences], relatedRecords: [...relatedRecords] };
}

const RECORD_KEYS = /^(id|source.?id|source.?ref|exchange.?id|process.?id|route.?id|asset.?id|record.?id|routeId|fromId|toId)$/i;
function extractRecords(value) {
  if (Array.isArray(value)) return value.flatMap(extractRecords);
  if (!value || typeof value !== 'object') return [];
  const keys = Object.keys(value);
  if (keys.some((key) => RECORD_KEYS.test(key)) || (keys.includes('sourceIds') && keys.includes('title'))) return [value];
  return Object.values(value).flatMap(extractRecords);
}

const lineage = Object.entries(records).map(([dataset, collection]) => {
  const rows = extractRecords(collection);
  const audit = rows.map(inspectRecord);
  const unlinked = audit.flatMap((item, index) => item.sourceIds.length || item.urls.length || item.namedReferences.length || item.relatedRecords.length ? [] : [index]);
  return {
    dataset,
    recordCount: rows.length,
    recordsWithSourceId: audit.filter((item) => item.sourceIds.length).length,
    recordsWithUrl: audit.filter((item) => item.urls.length).length,
    recordsWithNamedReference: audit.filter((item) => item.namedReferences.length).length,
    recordsWithRelatedRecord: audit.filter((item) => item.relatedRecords.length).length,
    unlinkedCount: unlinked.length,
    unlinkedRecordIds: unlinked.slice(0, 100).map((index) => rows[index]?.id ?? rows[index]?.source_id ?? String(index)),
  };
});

const catalog = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  catalogSource: 'web/data/web_catalog.json',
  lineageMethod: 'Nested-record scan for SRC/TSRC/TTRC identifiers, URLs, named document citations, and links to related catalog records. Unlinked rows have none of these pointers. This structural audit does not certify that a citation supports a value.',
  lineage,
  provenance: {
    assets: 'Migrated curated map asset records. Each record retains its sourceId and available produce/transport citation fields. Coordinates remain curated unless a row-level coordinate evidence field is added.',
    routes: 'Migrated curated route records. Each route retains sourceUrl/sourceRef and engineering quote fields where supplied; topology is separately cataloged.',
    routeConnections: 'Curated network topology previously embedded in the pathfinding code; review each edge against its route record and external source before treating it as verified.',
    downstream: 'Curated downstream/DOEB model snapshot. Values are scenario or proxy outputs from the included notes/method fields, not live official observations.',
    lciModel: 'Curated lifecycle model snapshot. Includes simulator assumptions. This is separate from accepted pipeline output; source IDs and derivations are retained where supplied.',
    processDashboard: 'Curated lifecycle dashboard snapshot. Rows retain source_id/derivation/status; calculations and proxy scopes must be read with their notes.',
    pipelineSteps: 'Description of the implemented pipeline, generated from the project’s pipeline-step documentation module.',
    mapJoins: 'Explicit mapping rules that join a map asset to an exact source_id/source_group in current staged SRC data.',
    mapConfig: 'Map display thresholds and legend labels, migrated into the catalog. Each threshold carries its supporting TSRC identifiers; read the TSRC evidence cards and limitations before using as a conclusion.',
    sourceCards: 'Curated source register cards, with source_id and source URL/document ID where available.',
    validatedDatasets: 'Curated validation examples. These records may not represent the current accepted CSV snapshot.',
  },
  data: records,
};

await writeFile(oldCatalogPath, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');
console.log(`Wrote ${path.relative(projectRoot, oldCatalogPath)} (${lineage.length} collections, ${lineage.reduce((sum, item) => sum + item.recordCount, 0)} records).`);
