export type AssetStage = 'upstream' | 'midstream' | 'downstream';

export type AssetCategory = 'oil' | 'gas' | 'refinery' | 'gsp' | 'power' | 'depot' | 'airport' | 'petchem';

export interface PipelineObservation {
  sourceId: string;
  sourceGroup: string;
  blockName: string;
  period: string;
  metric: string;
  metricLabel: string;
  value: number;
  unit: string;
  sourceUrl: string;
  sourceSha256: string;
  rawFile: string;
  extractionBatchId: string;
  stagedFile: string;
  stagedFileSha256: string;
  stagingPath: string;
  stagedAt: string;
  joinRule: string;
}

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
  pipelineObservation?: PipelineObservation;
  pipelineMatchNote?: string;
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
