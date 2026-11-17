export interface ProductionRecord {
  id: string;
  fieldCode: string;
  fieldName: string;
  basin: string;
  productType: 'Crude Oil' | 'Natural Gas' | 'Condensate';
  year: number;
  month: number;
  productionVolume: number;
  unit: string;
  energyEquivalentTJ: number;
  operator: string;
  sourceDataset: string;
}

export interface RefineryIntakeRecord {
  refineryCode: string;
  refineryName: string;
  domesticCrudeIntakeBBL: number;
  importedCrudeIntakeBBL: number;
  totalCrudeIntakeBBL: number;
  primaryDomesticFeedstocks: string;
  monthYear: string;
  sourceDataset: string;
}
