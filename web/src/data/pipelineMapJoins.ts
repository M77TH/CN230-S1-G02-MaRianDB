/**
 * Exact join keys between named map assets and DMF staging rows.
 *
 * These entries only identify a source row; they do not contain or calculate
 * any production values. Broad/multi-field DMF groups are intentionally omitted.
 */
export interface PipelineMapJoin {
  sourceId: 'SRC-044' | 'SRC-045';
  sourceGroup: string;
  explanation: string;
}

export const pipelineMapJoins: Record<string, PipelineMapJoin> = {
  NAMPHONG: {
    sourceId: 'SRC-045',
    sourceGroup: 'น้ำพอง',
    explanation: 'Exact DMF source_group label for Nam Phong.'
  },
  ERAWAN: {
    sourceId: 'SRC-045',
    sourceGroup: 'เอราวัณ',
    explanation: 'Exact DMF source_group label for Erawan.'
  },
  PLATHONG: {
    sourceId: 'SRC-044',
    sourceGroup: 'ปลาทอง',
    explanation: 'Exact DMF source_group label for Plathong; the separate Plathong 2 row is not included.'
  },
  SATUN: {
    sourceId: 'SRC-045',
    sourceGroup: 'สตูล',
    explanation: 'Exact DMF source_group label for Satun.'
  },
  FUNAN: {
    sourceId: 'SRC-045',
    sourceGroup: 'ฟูนาน',
    explanation: 'Exact DMF source_group label for Funan.'
  },
  'BONGKOT-NORTH': {
    sourceId: 'SRC-045',
    sourceGroup: 'G2N',
    explanation: 'Exact DMF source_group block key for Greater Bongkot North.'
  },
  'BONGKOT-SOUTH': {
    sourceId: 'SRC-045',
    sourceGroup: 'G2S',
    explanation: 'Exact DMF source_group block key for Greater Bongkot South.'
  },
  ARTHIT: {
    sourceId: 'SRC-045',
    sourceGroup: 'อาทิตย์',
    explanation: 'Exact DMF source_group label for Arthit.'
  },
  BENCHAMAS: {
    sourceId: 'SRC-044',
    sourceGroup: 'เบญจมาศ',
    explanation: 'Exact DMF source_group label for Benchamas.'
  },
  JASMINE: {
    sourceId: 'SRC-044',
    sourceGroup: 'จัสมิน บานเย็น',
    explanation: 'Exact DMF source_group label for the combined Jasmine and Banyen facilities shown as one map asset.'
  },
  NONGYAO: {
    sourceId: 'SRC-044',
    sourceGroup: 'นงเยาว์',
    explanation: 'Exact DMF source_group label for Nong Yao.'
  },
  BUALUANG: {
    sourceId: 'SRC-044',
    sourceGroup: 'บัวหลวง',
    explanation: 'Exact DMF source_group label for Bualuang.'
  },
  WASANA: {
    sourceId: 'SRC-044',
    sourceGroup: 'วาสนา',
    explanation: 'Exact DMF source_group label for Wasana.'
  }
};
