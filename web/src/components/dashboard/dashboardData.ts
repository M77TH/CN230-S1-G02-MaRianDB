import type { FunctionalUnitId } from '../../types/lciDashboard';

interface SupplyChainStageColumn {
  stageIndex: number;
  labelTh: string;
  range: string;
}

export const SUPPLY_CHAIN_STAGES: SupplyChainStageColumn[] = [
  { stageIndex: 0, labelTh: 'ต้นน้ำ', range: 'P01–P02' },
  { stageIndex: 1, labelTh: 'กลางน้ำ', range: 'P03–P09' },
  { stageIndex: 2, labelTh: 'ปลายน้ำและการใช้งาน', range: 'P10–P17' },
  { stageIndex: 3, labelTh: 'ปลายทาง (Grave)', range: 'P18–P20' }
];

export const FU_PATHWAYS: Record<FunctionalUnitId, string[]> = {
  'FU-1': ['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P10', 'P11', 'P12', 'P13'],
  'FU-2': ['P01', 'P02', 'P07', 'P08', 'P09', 'P15'],
  'FU-3': ['P01', 'P02', 'P06', 'P07', 'P18', 'P19', 'P20']
};

interface ScopeSplitSummary {
  upstreamShare: string;
  upstreamKg: string;
  upstreamLabel: string;
  useShare: string;
  useKg: string;
  useLabel: string;
  keyFinding: string;
}

export const SCOPE_SPLIT_BY_FU: Record<FunctionalUnitId, ScopeSplitSummary> = {
  'FU-1': {
    upstreamShare: '9.9%',
    upstreamKg: '0.2986',
    upstreamLabel: 'Well-to-Tank (ต้นน้ำ + กลั่น + ขนส่ง)',
    useShare: '90.1%',
    useKg: '2.7076',
    useLabel: 'Tank-to-Wheel (เผาไหม้ท่อไอเสีย)',
    keyFinding:
      '90.1% ของการปล่อยก๊าซเรือนกระจกตลอดวัฏจักรเกิดขึ้นที่ท่อไอเสียยานยนต์ (Scope 3 Category 11: Use of Sold Products)'
  },
  'FU-2': {
    upstreamShare: '21.5%',
    upstreamKg: '15.36',
    upstreamLabel: 'Well-to-Gate (อ่าวไทย + โรงแยกก๊าซ + ท่อ ปตท.)',
    useShare: '78.5%',
    useKg: '56.16',
    useLabel: 'Power Generation (เผาไหม้ผลิตไฟฟ้า CCGT)',
    keyFinding:
      '78.5% เกิดขึ้นในเตาเผาโรงไฟฟ้าพลังความร้อนร่วม (ผลิตไฟฟ้า 120 kWh @ 0.596 kg CO₂e/kWh)'
  },
  'FU-3': {
    upstreamShare: '39.4%',
    upstreamKg: '1.848',
    upstreamLabel: 'Cradle-to-Gate (ต้นน้ำ + แครกเกอร์ + โพลิเมอร์)',
    useShare: '60.6%',
    useKg: '2.840',
    useLabel: 'End-of-Life (เตาเผาขยะมูลฝอย EOL)',
    keyFinding:
      '60.6% ของการปล่อยก๊าซเกิดขึ้นจากการเผาทำลายขยะพลาสติกหลังการบริโภค (Fossil Carbon Oxidation)'
  }
};

export const GAS_SPECIATION_DATA: Record<
  FunctionalUnitId,
  {
    co2Kg: number;
    co2Pct: number;
    ch4Kg: number;
    ch4KgCo2e: number;
    ch4Pct: number;
    n2oKg: number;
    n2oKgCo2e: number;
    n2oPct: number;
    keyGasInsight: string;
  }
> = {
  'FU-1': {
    co2Kg: 2.9551,
    co2Pct: 98.3,
    ch4Kg: 0.00148,
    ch4KgCo2e: 0.0415,
    ch4Pct: 1.38,
    n2oKg: 0.000036,
    n2oKgCo2e: 0.0096,
    n2oPct: 0.32,
    keyGasInsight:
      'CO₂ จากการเผาไหม้ในเครื่องยนต์คิดเป็น 98.3% ของการปล่อยทั้งหมด ในขณะที่มีเทน (CH₄) เกิดจากการเผาไหม้ไม่สมบูรณ์และการรั่วไหลต้นน้ำ 1.38%'
  },
  'FU-2': {
    co2Kg: 67.942,
    co2Pct: 95.0,
    ch4Kg: 0.1149,
    ch4KgCo2e: 3.218,
    ch4Pct: 4.5,
    n2oKg: 0.00135,
    n2oKgCo2e: 0.358,
    n2oPct: 0.5,
    keyGasInsight:
      'ก๊าซธรรมชาติมีสัดส่วนมีเทนรั่วไหล (Fugitive Methane CH₄) 4.50% ซึ่งมีค่า GWP100 สูงถึง 28 เท่าของคาร์บอนไดออกไซด์ตามเกณฑ์ IPCC AR5'
  },
  'FU-3': {
    co2Kg: 4.622,
    co2Pct: 98.6,
    ch4Kg: 0.00236,
    ch4KgCo2e: 0.066,
    ch4Pct: 1.4,
    n2oKg: 0.0,
    n2oKgCo2e: 0.0,
    n2oPct: 0.0,
    keyGasInsight:
      'การเผาทำลายเม็ดพลาสติก PE ก่อให้เกิดฟอสซิล CO₂ 4.622 kg ตามปริมาณสัมพันธ์เคมี Stoichiometry (44/14 = 3.14 kg CO₂/kg PE จากเนื้อสาร)'
  }
};

export const BENCHMARK_COMPARISONS: Record<
  FunctionalUnitId,
  {
    modelValue: number;
    modelUnit: string;
    benchmarks: {
      name: string;
      value: number;
      deltaPct: number;
      isHigher: boolean;
      reference: string;
      verified: boolean;
    }[];
  }
> = {
  'FU-1': {
    modelValue: 3.0062,
    modelUnit: 'kg CO₂e/L',
    benchmarks: [
      { name: 'แบบจำลอง Bottom-up G02', value: 3.0062, deltaPct: 0, isHigher: false, reference: 'การคำนวณจริง 43 LCI Flows', verified: true },
      { name: 'ฐานข้อมูล อบก. (TGO CFP)', value: 2.982, deltaPct: 0.81, isHigher: true, reference: 'อบก. บัญชีก๊าซเรือนกระจกไทย', verified: true },
      { name: 'IPCC AR5 Guideline Default', value: 3.09, deltaPct: -2.71, isHigher: false, reference: 'IPCC Mobile Combustion', verified: true },
      { name: 'ecoinvent v3.10 (Global Avg)', value: 3.125, deltaPct: -3.8, isHigher: false, reference: 'RoW Market for Diesel', verified: true }
    ]
  },
  'FU-2': {
    modelValue: 71.52,
    modelUnit: 'kg CO₂e/GJ',
    benchmarks: [
      { name: 'แบบจำลอง Bottom-up G02', value: 71.52, deltaPct: 0, isHigher: false, reference: 'การคำนวณจริง 43 LCI Flows', verified: true },
      { name: 'ฐานข้อมูล อบก. (TGO CFO/Grid)', value: 70.8, deltaPct: 1.02, isHigher: true, reference: 'อบก. ค่าปล่อยก๊าซธรรมชาติ', verified: true },
      { name: 'IPCC AR5 Stationary Power', value: 73.2, deltaPct: -2.3, isHigher: false, reference: 'IPCC Energy Stationary', verified: true },
      { name: 'ASEAN Energy Centre Avg', value: 74.5, deltaPct: -4.0, isHigher: false, reference: 'ASEAN Power Outlook 2023', verified: true }
    ]
  },
  'FU-3': {
    modelValue: 4.688,
    modelUnit: 'kg CO₂e/kg',
    benchmarks: [
      { name: 'แบบจำลอง Bottom-up G02 (Incineration)', value: 4.688, deltaPct: 0, isHigher: false, reference: 'การคำนวณจริง 43 LCI Flows', verified: true },
      { name: 'ฐานข้อมูล อบก. (TGO Waste EOL)', value: 4.65, deltaPct: 0.82, isHigher: true, reference: 'อบก. รายการ 481 ขยะพลาสติก', verified: true },
      { name: 'PlasticsEurope Eco-profile', value: 4.82, deltaPct: -2.74, isHigher: false, reference: 'PlasticsEurope PE LCI', verified: true },
      { name: 'US NREL Plastics Database', value: 4.75, deltaPct: -1.31, isHigher: false, reference: 'US NREL LCI Repository', verified: true }
    ]
  }
};

export const HOTSPOT_CARDS = [
  {
    sectorTag: 'ภาคขนส่งทางถนน (Transport)',
    pctBadge: '90.1% HOTSPOT',
    heading: 'ดีเซลและเบนซิน: วิกฤตปล่อยที่ปลายท่อไอเสีย',
    description:
      'การปรับปรุงประสิทธิภาพโรงกลั่นไม่สามารถลดคาร์บอนของน้ำมันเชื้อเพลิงได้อย่างมีนัยสำคัญ เนื่องจาก 90.1% เกิดขึ้นตอนเผาไหม้ในเครื่องยนต์บนท้องถนน (Scope 3 Category 11)',
    roadmaps: [
      '1. ผลักดันการผสมไบโอดีเซล B10 และ HVO (Hydrotreated Vegetable Oil 100%)',
      '2. เปลี่ยนผ่านฟลีตรถบรรทุกและรถโดยสารสู่ไฟฟ้า (BEV Fleet Transition)',
      '3. ขยายโครงข่ายขนส่งน้ำมันทางท่อ (FPT / TPN) และระบบรางเพื่อลดรถบรรทุกบนถนน'
    ]
  },
  {
    sectorTag: 'ภาคการผลิตไฟฟ้า (Power Sector)',
    pctBadge: '78.5% HOTSPOT',
    heading: 'ก๊าซธรรมชาติ: เตาเผากังหันก๊าซ CCGT',
    description:
      'ก๊าซ 1 GJ ปลดปล่อย 71.52 kg CO₂e โดย 78.5% เกิดขึ้นในเตาเผาโรงไฟฟ้าพลังความร้อนร่วม (ผลิตไฟฟ้า 120 kWh ที่ 0.596 kg/kWh)',
    roadmaps: [
      '1. เร่งรัดโครงการ Carbon Capture & Storage (Arthit CCS & Eastern Seaboard Hub)',
      '2. เพิ่มประสิทธิภาพ Heat Rate ของโรงไฟฟ้า SPP/IPP ให้ต่ำกว่า 7,500 Btu/kWh',
      '3. ผสมไฮโดรเจนสะอาด (Hydrogen Co-firing 5–20%) ในกังหันก๊าซ'
    ]
  },
  {
    sectorTag: 'ภาคปิโตรเคมีและพลาสติก (Materials)',
    pctBadge: '60.6% HOTSPOT',
    heading: 'พลาสติก PE: การเผาทำลายขยะปลายทาง (EOL)',
    description:
      'พลาสติกกักเก็บคาร์บอนฟอสซิลไว้ในเนื้อสาร (Embodied Carbon 3.14 kg CO₂/kg PE) หากนำไปเผาทำลายจะปล่อยก๊าซทันทีถึง 4.688 kg CO₂e/kg เทียบกับการฝังกลบที่ 2.338 kg',
    roadmaps: [
      '1. ส่งเสริมระบบรีไซเคิลเชิงกล (Mechanical Recycling) หลีกเลี่ยงการเผาทำลายได้เกือบ 100%',
      '2. บังคับใช้กฎหมายขยายความรับผิดชอบของผู้ผลิต (Extended Producer Responsibility - EPR)',
      '3. วิจัยพัฒนาเม็ดพลาสติกชีวภาพ (Bio-PE) จากเอทานอลอ้อยและมันสำปะหลัง'
    ]
  }
];

export const ISO_AUDIT_PHASES = [
  {
    title: 'Phase 1: Goal & Scope',
    description:
      'กำหนดขอบเขต Cradle-to-Grave ครอบคลุม 3 Functional Units (ดีเซล, ก๊าซธรรมชาติ, เม็ดพลาสติก PE) สอดคล้องกับโครงสร้างพลังงานจริงของประเทศไทย'
  },
  {
    title: 'Phase 2: LCI Inventory',
    description:
      'จัดทำบัญชีสิ่งแวดล้อม 43 รายการ (LCX-001..043) เชื่อมโยง 98 แหล่งข้อมูลปฐมภูมิ และปันส่วนผลผลิตตามมวล (Mass Allocation) ตาม ISO 14044'
  },
  {
    title: 'Phase 3: Impact (LCIA)',
    description:
      'ประเมินผลกระทบด้านการเปลี่ยนแปลงสภาพภูมิอากาศด้วยตัวแปร IPCC AR5 GWP100 (CO₂=1, CH₄=28, N₂O=265) พร้อมแจกแจงตามรายกระบวนการ'
  },
  {
    title: 'Phase 4: Interpretation',
    description:
      'ตรวจสอบความสอดคล้องกับฐานข้อมูล LCI แห่งชาติของ อบก. มีความคลาดเคลื่อนเพียง 0.8% และวิเคราะห์จุดวิกฤต (Hotspot) สำหรับข้อเสนอนโยบาย'
  }
];
