export type RouteMode = 'subsea-gas' | 'onshore-gas' | 'crude-rail' | 'onshore-oil' | 'road-truck' | 'marine-tanker';

export interface TransmissionRoute {
  id: string;
  nameTh: string;
  nameEn: string;
  mode: RouteMode;
  color: string;
  dashArray: string;
  weight: number;
  specs: string;
  from: string;
  to: string;
  coords: [number, number][];
  distanceKm?: number;
  energyIntensityMjPerTkm?: number;
  ghgFactorKgCo2ePerTkm?: number;
  noxFactorGPerTkm?: number;
  soxFactorGPerTkm?: number;
  pm25FactorGPerTkm?: number;
  vocFactorGPerTkm?: number;
  sourceRef?: string;
  sourceUrl?: string;
  // Verification & Audit Metadata
  functionalUnit?: string;
  produceSourceUrl?: string;
  produceSourceDoc?: string;
  produceCtrlF?: string;
  produceQuote?: string;
  transportSourceUrl?: string;
  transportSourceDoc?: string;
  transportCtrlF?: string;
  transportQuote?: string;
  vocGPerFu?: number;
  evidenceStatus?: 'VERIFIED' | 'DEMO_PROXY';
  isDemoPath?: boolean;
  evidenceNote?: string;
}
