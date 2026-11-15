export type LciStatus =
  | 'VERIFIED'
  | 'VERIFIED_DERIVED'
  | 'CALCULATED'
  | 'PROXY'
  | 'RESIDUAL'
  | 'ASSUMPTION'
  | 'DATA_GAP'
  | 'PENDING_QC'
  | 'OUT'
  | 'APPROVED'
  | 'REJECTED';

export type FunctionalUnitId = 'FU-1' | 'FU-2' | 'FU-3';

export interface LciExchangeRecord {
  exchange_id: string;
  fu_id: FunctionalUnitId;
  process_id: string;
  process_name: string;
  flow_name: string;
  direction: 'input' | 'output';
  compartment: 'air' | 'water' | 'resource' | 'waste' | 'technosphere';
  amount: number | string;
  unit: string;
  source_id: string;
  derivation: string;
  pedigree_dqr: string;
  status: LciStatus;
}

export interface ProcessChainItem {
  id: string;
  nameTh: string;
  nameEn: string;
  facilities: string;
  status: LciStatus;
  stageName: 'ต้นน้ำ (Upstream)' | 'กลางน้ำ (Midstream)' | 'ปลายน้ำและการใช้งาน (Downstream & End-Use)' | 'ปลายทางและของเสีย (Grave & Waste)';
  stageIndex: number;
  inventoryValue: string;
  formulaOrMethod: string;
  sourceId: string;
  dqr: string;
}

export interface FunctionalUnitDetail {
  id: FunctionalUnitId;
  titleTh: string;
  titleEn: string;
  subTitle: string;
  referenceUnit: string;
  totalGhgKgCo2e: number;
  equivalentMetric?: string;
  stages: {
    stageName: string;
    processCode: string;
    amountKgCo2e: number;
    pct: number;
    color: string;
  }[];
  nationalValidationNote: string;
  keyInsights: string[];
}

export interface ComprehensiveSourceItem {
  source_id: string;
  title: string;
  publisher_or_owner: string;
  url_or_document_id: string;
  source_type: string;
  sector: string;
  rights_or_terms: string;
  status: LciStatus;
  notes: string;
  category: 'Approved Main (Step 01)' | 'Digging Addendum (SRC-064..086)' | 'LCI Extension (SRC-087..094)' | 'Mid-to-Mid Primary Audit (SRC-095..098)' | 'Screened Source';
}

export interface OtherProductLci {
  productNameTh: string;
  productNameEn: string;
  cradleToGateKgCo2ePerKg: number;
  combustionFactorText: string;
  combustionFactorPerUnit: number;
  unit: string;
  totalFormulaOrVal: string;
  referenceSource: string;
}
