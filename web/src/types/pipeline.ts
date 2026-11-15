export interface PipelineStep {
  stepNumber: string;
  id: string;
  titleTh: string;
  titleEn: string;
  category: 'data-engineering' | 'lci-methodology' | 'analytics';
  summary: string;
  inputs: string[];
  outputs: string[];
  processingDetails: string[];
  sqlOrMathFormula?: string;
  dataQualityChecks: string[];
  provenanceSource: string;
}
