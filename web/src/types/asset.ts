export type AssetStage = 'upstream' | 'midstream' | 'downstream';

export type AssetCategory = 'oil' | 'gas' | 'refinery' | 'gsp' | 'power' | 'depot' | 'airport' | 'petchem';

export interface InfrastructureAsset {
  id: string;
  nameTh: string;
  nameEn: string;
  shortLabel: string;
  lat: number;
  lng: number;
  basin: string;
  location: string;
  operator: string;
  stage: AssetStage;
  category: AssetCategory;
  prodLabel: string;
  prodValue: string;
  prodSub: string;
  destName?: string;
  destMode?: string;
  sourceId: string;
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
  transportDistanceKm?: number;
  energyMjPerFu?: number;
  ghgKgCo2ePerFu?: number;
  noxGPerFu?: number;
  soxGPerFu?: number;
  pm25GPerFu?: number;
  vocGPerFu?: number;
}
