import { RouteMode } from '../types/route';

export type EncodingMode = 'throughput' | 'emissions';

// Net calorific values used by the ISO 14044 allocation engine in PipelineStoryView
export const CRUDE_LHV_GJ_PER_BBL = 5.86;
export const CONDENSATE_LHV_GJ_PER_BBL = 5.4;
export const GAS_LHV_GJ_PER_MMSCF = 1055;
const MW_TO_GJ_PER_DAY = 86.4;

/** Daily energy throughput (GJ/day) parsed from a free-text production figure. */
export function parseEnergyGjPerDay(value: string): number {
  if (!value) return 0;
  const s = value.replace(/,/g, '');
  const m = s.match(/([\d.]+)/);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  if (!isFinite(v)) return 0;
  if (/MMSCFD/i.test(s)) return v * GAS_LHV_GJ_PER_MMSCF;
  if (/MW/i.test(s)) return v * MW_TO_GJ_PER_DAY;
  if (/bbl\/(day|d)/i.test(s)) return v * CRUDE_LHV_GJ_PER_BBL;
  return 0;
}

/** Rated throughput (GJ/day) parsed from a route's specification string. */
export function parseRouteCapacityGjPerDay(specs: string, _mode: RouteMode): number {
  if (!specs) return 0;
  const s = specs.replace(/,/g, '');
  const capacity = s.match(/capacity\s+([\d.]+)\s*(MMSCFD|bbl\/day|bbl\/d)/i);
  if (capacity) {
    const v = parseFloat(capacity[1]);
    return /MMSCFD/i.test(capacity[2]) ? v * GAS_LHV_GJ_PER_MMSCF : v * CRUDE_LHV_GJ_PER_BBL;
  }
  const parenBbl = s.match(/\(([\d.]+)\s*bbl\/day\)/i);
  if (parenBbl) return parseFloat(parenBbl[1]) * CRUDE_LHV_GJ_PER_BBL;
  const bareGas = s.match(/([\d.]+)\s*MMSCFD/i);
  if (bareGas) return parseFloat(bareGas[1]) * GAS_LHV_GJ_PER_MMSCF;
  const bareBbl = s.match(/([\d.]+)\s*bbl\/day/i);
  if (bareBbl) return parseFloat(bareBbl[1]) * CRUDE_LHV_GJ_PER_BBL;
  return 0;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function lerp(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

/** Cyan (clean) -> amber -> red (dirty) ramp for transport emission intensity. */
export function emissionColor(value: number, min: number, max: number): string {
  const t = clamp01((value - min) / (max - min || 1));
  const stops: [number, number, number][] = [
    [34, 211, 238],
    [245, 158, 11],
    [239, 68, 68]
  ];
  const seg = t < 0.5 ? 0 : 1;
  const local = t < 0.5 ? t / 0.5 : (t - 0.5) / 0.5;
  const a = stops[seg];
  const b = stops[seg + 1];
  return `rgb(${lerp(a[0], b[0], local)}, ${lerp(a[1], b[1], local)}, ${lerp(a[2], b[2], local)})`;
}

/** Line weight from rated throughput, normalised against the network maximum. */
export function routeWeight(capacityGj: number, maxCapacityGj: number): number {
  if (!capacityGj || !maxCapacityGj) return 1.4;
  return 1.2 + Math.sqrt(clamp01(capacityGj / maxCapacityGj)) * 2.4;
}

/** Marker scale from daily energy throughput, normalised against the network maximum. */
export function markerScale(energyGj: number, maxEnergyGj: number): number {
  if (!energyGj || !maxEnergyGj) return 0.85;
  return 0.8 + Math.sqrt(clamp01(energyGj / maxEnergyGj)) * 0.95;
}

export function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: digits });
}
