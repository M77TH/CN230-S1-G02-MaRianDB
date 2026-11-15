import { AssetCategory, InfrastructureAsset } from '../types/asset';
import { RouteMode, TransmissionRoute } from '../types/route';
import {
  DoebDepotCluster,
  ProvinceDownstreamRecord
} from '../data/thailandDownstreamData';
import { parseEnergyGjPerDay } from './lci';

export type MapViewMode = 'transport' | 'emissions';
export type StageRange = 'all' | 'up-to-mid' | 'mid-to-mid' | 'mid-to-down';
export type HeatmapMetric = 'co2e' | 'stations' | 'vehiclesPerStation';
export type DepotScenario = 'tier1' | 'all44' | 'baseline2';
export type NodeColorMode = 'category' | 'volume' | 'emissions';

export interface StageRangeOption {
  id: StageRange;
  label: string;
  processTag: string;
  hint: string;
}

export const STAGE_RANGE_OPTIONS: StageRangeOption[] = [
  { id: 'all', label: 'ครบวงจร', processTag: 'P01–P20', hint: 'เครือข่ายตั้งแต่ต้นทางถึงปลายทาง' },
  { id: 'up-to-mid', label: 'ต้นน้ำ → กลางน้ำ', processTag: 'P01–P09', hint: 'ตั้งแต่แหล่งผลิตถึงโรงแยกก๊าซและโรงกลั่น' },
  { id: 'mid-to-mid', label: 'กลางน้ำ → กลางน้ำ', processTag: 'P06–P11', hint: 'โรงกลั่นและเส้นทางชายฝั่งถึงคลังภูมิภาค' },
  { id: 'mid-to-down', label: 'กลางน้ำ → ปลายน้ำ', processTag: 'P10–P17', hint: 'จากคลังน้ำมันไปยังสถานีบริการทั่วประเทศ' }
];

export const LIGHT_CATEGORY_COLORS: Record<AssetCategory, string> = {
  oil: '#FF9999',
  gas: '#D3FF99',
  refinery: '#FFC099',
  gsp: '#BFECAC',
  depot: '#99ACFF',
  power: '#BEA1F7',
  airport: '#FFD699',
  petchem: '#FF99D8'
};

export const LIGHT_ROUTE_COLORS: Record<RouteMode, string> = {
  // Darkened versions of the supplied cool swatches keep route types
  // distinguishable while letting the pastel facility markers lead.
  'subsea-gas': '#5F9E80',
  'onshore-gas': '#649987',
  'crude-rail': '#689495',
  'road-truck': '#5F959E',
  'marine-tanker': '#5F879E',
  'onshore-oil': '#5F7A9E'
};

export const LIGHT_DOEB_COLORS = {
  central: LIGHT_CATEGORY_COLORS.depot,
  tier1: LIGHT_CATEGORY_COLORS.depot,
  minor: LIGHT_CATEGORY_COLORS.depot,
  legend: LIGHT_CATEGORY_COLORS.depot
} as const;

export const LIGHT_SPECIAL_ROUTE_COLORS = {
  coastalTanker: LIGHT_ROUTE_COLORS['marine-tanker'],
  downstreamSpokes: LIGHT_ROUTE_COLORS['road-truck'],
  demoMid: '#c2410c'
} as const;

const MID_TO_MID_ROUTES = new Set<string>([
  'ROUTE-GSP-PTTGC',
  'ROUTE-TOP-BSRC',
  'ROUTE-THAPPLINE-MTP-SRIRACHA',
  'ROUTE-THAPPLINE-MAIN',
  'ROUTE-FPT-BKK-BPI',
  'ROUTE-NFPT-PHICHIT',
  'ROUTE-NFPT-LAMPANG',
  'ROUTE-TPN-NORTHEAST'
]);

const MID_TO_DOWN_ROUTES = new Set<string>([
  'ROUTE-THAPPLINE-MTP-SRIRACHA',
  'ROUTE-THAPPLINE-MAIN',
  'ROUTE-THAPPLINE-BKK-AIR',
  'ROUTE-FPT-BKK-BPI',
  'ROUTE-NFPT-PHICHIT',
  'ROUTE-NFPT-LAMPANG',
  'ROUTE-TPN-NORTHEAST',
  'ROUTE-PTT-RAYONG-BANGPAKONG',
  'ROUTE-PTT-BANGPAKONG-SOUTHBKK',
  'ROUTE-PTT-BANGPAKONG-WANGNOI',
  'ROUTE-PTT-RAYONG-GULFPD',
  'ROUTE-CHANA-GSP-EGAT',
  'ROUTE-GSP-PETCHEM-PTTGC',
  'ROUTE-GSP-PETCHEM-SCGC'
]);

/** Filter core facility asset according to the active lifecycle stage lens. */
export function isAssetInStageRange(asset: InfrastructureAsset, range: StageRange): boolean {
  if (range === 'all') return true;
  if (range === 'up-to-mid') {
    return (
      asset.stage === 'upstream' ||
      asset.category === 'refinery' ||
      asset.category === 'gsp' ||
      asset.id === 'GATE-EGAT-NP'
    );
  }
  if (range === 'mid-to-mid') {
    return (
      asset.category === 'refinery' ||
      asset.category === 'gsp' ||
      asset.category === 'depot'
    );
  }
  return asset.stage === 'midstream' || asset.stage === 'downstream';
}

/** Filter verified LCI & Option B demo transmission corridors according to stage lens. */
export function isRouteInStageRange(route: TransmissionRoute, range: StageRange): boolean {
  if (route.isDemoPath) {
    return range === 'all' || range === 'mid-to-mid';
  }
  if (range === 'all') return true;
  if (range === 'mid-to-mid') return MID_TO_MID_ROUTES.has(route.id);
  if (range === 'mid-to-down') return MID_TO_DOWN_ROUTES.has(route.id);
  return !MID_TO_MID_ROUTES.has(route.id) && !MID_TO_DOWN_ROUTES.has(route.id);
}

/** Check whether coastal product tanker corridor (342 nm) is visible in active stage. */
export function isCoastalInStageRange(range: StageRange): boolean {
  return range === 'all' || range === 'mid-to-mid' || range === 'mid-to-down';
}

/** Check whether provincial Choropleth & Heatmap overlays apply cleanly to stage. */
export function isDownstreamOverlayStage(range: StageRange): boolean {
  return range === 'all' || range === 'mid-to-mid' || range === 'mid-to-down';
}

/** Filter DOEB depot cluster by scenario mode (Tier-1 >= 10 ML vs 44 All vs 2 Baseline). */
export function isDepotInScenario(depot: DoebDepotCluster, scenario: DepotScenario): boolean {
  if (scenario === 'baseline2') return depot.isBaselineCentral;
  if (scenario === 'tier1') return depot.isMajorOil;
  return true;
}

/** Extract provincial value matching the active heatmap metric & depot scenario. */
export function getProvinceMetricValue(
  prov: ProvinceDownstreamRecord,
  metric: HeatmapMetric,
  scenario: DepotScenario
): number {
  if (metric === 'stations') return prov.doebStations;
  if (metric === 'vehiclesPerStation') return prov.vehiclesPerStation;
  if (scenario === 'baseline2') return prov.baseline2CentralKgCo2eL;
  if (scenario === 'all44') return prov.allDoebKgCo2eL;
  return prov.tier1KgCo2eL;
}

/** Light-mode legible ramp: low moss green -> warm amber -> terracotta coral -> deep crimson. */
export function heatmapRampColor(value: number, min: number, max: number): string {
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  if (ratio < 0.25) return '#D3FF99';
  if (ratio < 0.5) return '#FFEB99';
  if (ratio < 0.72) return '#FFC099';
  if (ratio < 0.88) return '#FFADAD';
  return '#FF9999';
}

/** Corridor GHG intensity ramp optimized for light CartoDB Positron tiles. */
export function routeEmissionColor(value: number, min: number, max: number): string {
  const ratio = Math.max(0, Math.min(1, (value - min) / (max - min || 1)));
  if (ratio < 0.3) return '#D3FF99';
  if (ratio < 0.6) return '#FFD699';
  return '#FF9999';
}

/** Production / output volume color ramp when coloring nodes by source volume (GJ/day). */
export function volumeRampColor(energyGj: number, maxEnergyGj: number): string {
  const ratio = Math.max(0, Math.min(1, Math.log10(energyGj + 10) / Math.log10((maxEnergyGj || 1e6) + 10)));
  if (ratio > 0.78) return '#43542d'; // Mega source (>300k GJ/day)
  if (ratio > 0.58) return '#667844'; // Large major complex
  if (ratio > 0.38) return '#0f766e'; // Medium field / terminal
  return '#94a3b8';                   // Minor / satellite gate
}

/** Compute node fill color according to viewMode + nodeColorMode. */
export function getAssetDisplayColor(
  asset: InfrastructureAsset,
  viewMode: MapViewMode,
  nodeColorMode: NodeColorMode,
  maxEnergyGj: number,
  minGhg: number,
  maxGhg: number
): string {
  if (viewMode === 'emissions' || nodeColorMode === 'emissions') {
    const val = typeof asset.ghgKgCo2ePerFu === 'number' ? asset.ghgKgCo2ePerFu : minGhg;
    return routeEmissionColor(val, minGhg, maxGhg);
  }
  if (nodeColorMode === 'volume') {
    return volumeRampColor(parseEnergyGjPerDay(asset.prodValue), maxEnergyGj);
  }
  return LIGHT_CATEGORY_COLORS[asset.category] || '#1b43bb';
}

/** Dynamic legend metadata for active heatmap metric & scenario. */
export function getHeatmapLegendMeta(metric: HeatmapMetric, scenario: DepotScenario) {
  if (metric === 'stations') {
    return {
      title: 'จำนวนสถานีบริการน้ำมันรายจังหวัด',
      unit: 'สถานี',
      min: 36,
      max: 1074,
      source: 'TSRC-47 / TSRC-48 / TSRC-54 (DOEB 25,310 total)',
      stops: [
        { color: '#d9f99d', label: '< 200' },
        { color: '#fde047', label: '200–450' },
        { color: '#fb923c', label: '450–700' },
        { color: '#ea580c', label: '700–900' },
        { color: '#b91c1c', label: '900+ (Korat/CNX/BKK)' }
      ]
    };
  }
  if (metric === 'vehiclesPerStation') {
    return {
      title: 'จำนวนรถใช้น้ำมันต่อสถานีบริการ (RML/ขบ.)',
      unit: 'คัน/สถานี',
      min: 390,
      max: 13173,
      source: 'TSRC-49 DLT 44.84M Fuel Vehicles',
      stops: [
        { color: '#d9f99d', label: '< 1,000' },
        { color: '#fde047', label: '1,000–2,000' },
        { color: '#fb923c', label: '2,000–4,000' },
        { color: '#ea580c', label: '4,000–7,000' },
        { color: '#b91c1c', label: '7,000+ (Bangkok)' }
      ]
    };
  }
  const isBaseline = scenario === 'baseline2';
  return {
    title: isBaseline
      ? 'การปล่อย CO₂e จากรถขนส่ง — คลังศูนย์กลาง 2 แห่ง'
      : 'การปล่อย CO₂e จากรถขนส่ง — คลัง DOEB หลายระดับ',
    unit: 'kgCO₂e/L',
    min: 0.0005,
    max: isBaseline ? 0.032 : 0.011,
    source: 'TSRC-50 / TSRC-53 Valhalla Road Graph',
    stops: isBaseline
      ? [
          { color: '#d9f99d', label: '< 0.004' },
          { color: '#fde047', label: '0.004–0.011' },
          { color: '#fb923c', label: '0.011–0.018' },
          { color: '#ea580c', label: '0.018–0.025' },
          { color: '#b91c1c', label: '0.025+ (South/North)' }
        ]
      : [
          { color: '#d9f99d', label: '< 0.0015' },
          { color: '#fde047', label: '0.0015–0.0030' },
          { color: '#fb923c', label: '0.0030–0.0055' },
          { color: '#ea580c', label: '0.0055–0.0080' },
          { color: '#b91c1c', label: '0.0080+ (>235 km)' }
        ]
  };
}
