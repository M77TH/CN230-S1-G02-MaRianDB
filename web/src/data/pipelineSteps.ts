import type { PipelineStep } from '../types/pipeline';

/** Mirrors the executable stages in the repository's run_pipeline.py. */
export const pipelineSteps: PipelineStep[] = [
  {
    stepNumber: '01',
    id: 'SOURCE-DISCOVERY',
    titleTh: 'ค้นหาและคัดเลือกแหล่งข้อมูล',
    titleEn: 'Source Discovery & Approval',
    category: 'data-engineering',
    summary: 'อ่านทะเบียนแหล่งข้อมูลและเลือกเฉพาะรายการที่อนุมัติแล้ว เพื่อกำหนดชุดข้อมูลที่จะเข้าสู่รอบประมวลผลจริง',
    inputs: ['data/registry/source_registry.xlsx', 'รหัสแหล่งข้อมูลที่เลือกในหน้ารัน'],
    outputs: ['รายการ source_id ที่อนุมัติ', 'ลำดับชุดข้อมูลสำหรับรัน'],
    processingDetails: [
      'ตรวจสถานะ approved จากทะเบียนแหล่งข้อมูล',
      'ถ้าผู้ใช้เลือก source_id ระบบจะรันเฉพาะรายการที่เลือก',
      'จัด SRC-047 ไว้ก่อนเมื่ออยู่ในชุดที่เลือก เพราะใช้เป็นข้อมูลอ้างอิงของต้นน้ำ'
    ],
    dataQualityChecks: ['รหัสแหล่งข้อมูลต้องอยู่ในทะเบียน', 'ไม่ประมวลผลรายการที่ยังไม่อนุมัติ'],
    provenanceSource: 'data/registry/source_registry.xlsx'
  },
  {
    stepNumber: '02',
    id: 'RAW-ACQUISITION',
    titleTh: 'ดึงและเก็บไฟล์ต้นฉบับ',
    titleEn: 'Raw Acquisition & Provenance',
    category: 'data-engineering',
    summary: 'ดาวน์โหลดข้อมูลจริงจาก URL ของแหล่งที่อนุมัติ แล้วเก็บไฟล์ดิบพร้อมข้อมูลกำกับเพื่อย้อนกลับไปตรวจสอบต้นทางได้',
    inputs: ['URL และ metadata จาก source registry', 'ไฟล์ต้นฉบับหรือข้อมูลจาก API ของหน่วยงาน'],
    outputs: ['data/raw/*_RAW.*', 'data/raw/_provenance_ledger.jsonl'],
    processingDetails: [
      'เลือก extractor ตามชนิดของ URL และรูปแบบข้อมูล',
      'บันทึกไฟล์ต้นฉบับโดยไม่แก้เนื้อหา',
      'สร้าง SHA-256 และ extraction batch สำหรับติดตามไฟล์และเวลาที่ดึงข้อมูล'
    ],
    sqlOrMathFormula: 'SHA256(raw_file_bytes) → source_sha256',
    dataQualityChecks: ['ตรวจการดาวน์โหลดและชนิดไฟล์', 'เก็บ URL ต้นทางและ checksum ไว้กับไฟล์'],
    provenanceSource: 'src/acquisition/acquisition.py · src/acquisition/provenance.py'
  },
  {
    stepNumber: '03',
    id: 'PARSING',
    titleTh: 'อ่านไฟล์และแยกข้อมูลเป็นตาราง',
    titleEn: 'Parsing & Table Extraction',
    category: 'data-engineering',
    summary: 'แปลงไฟล์ดิบแต่ละชนิดให้อยู่ในรูปตารางที่โค้ดขั้นถัดไปประมวลผลได้ โดยยังเก็บสำเนาดิบไว้เป็นหลักฐาน',
    inputs: ['data/raw/*_RAW.*', 'ชนิดไฟล์และกฎ parser'],
    outputs: ['data/parsed/*', 'ตารางที่อ่านได้จาก CSV, XLSX, HTML หรือ PDF'],
    processingDetails: [
      'เลือก parser ตามนามสกุลและโครงสร้างของไฟล์',
      'อ่านตาราง PTTEP จาก PDF พร้อมเลขหน้า และตรวจ SHA-256 กับเลขหน้าของค่าจากรายงาน PDF ฉบับที่ตรวจแล้ว',
      'บันทึกผลแยกตาม source_id เพื่อให้ตรวจย้อนกลับได้'
    ],
    dataQualityChecks: ['ไฟล์ต้องอ่านได้', 'ต้องพบตารางหรือข้อมูลที่ parser รองรับ'],
    provenanceSource: 'src/parsing/parsing.py'
  },
  {
    stepNumber: '04',
    id: 'STAGING',
    titleTh: 'จัดรูปแบบและเพิ่มที่มาของข้อมูล',
    titleEn: 'Staging & Provenance Binding',
    category: 'data-engineering',
    summary: 'ปรับตารางที่ parse แล้วให้มีรูปแบบสม่ำเสมอ พร้อมผูก source, batch และ checksum เข้ากับแต่ละระเบียนก่อนนำไป map',
    inputs: ['data/parsed/*', 'provenance ledger ของรอบดึงข้อมูล'],
    outputs: ['data/staging/*_STAGED.csv'],
    processingDetails: [
      'ปรับชื่อคอลัมน์ รูปแบบวันที่ ตัวเลข และหน่วยตามกฎของแต่ละแหล่ง',
      'จัดการแถวหัวตารางหรือหมายเหตุที่ปะปนกับข้อมูล',
      'ผูก source_id, extraction_batch_id, URL และ hash กับระเบียนที่ staged'
    ],
    dataQualityChecks: ['โครงสร้างคอลัมน์พร้อมสำหรับ mapping', 'ทุกระเบียนรักษาข้อมูล provenance'],
    provenanceSource: 'src/staging/staging.py · src/acquisition/provenance.py'
  },
  {
    stepNumber: '05',
    id: 'MAPPING',
    titleTh: 'แปลงข้อมูลเข้าสู่แบบจำลอง LCI',
    titleEn: 'LCI Mapping & Allocation',
    category: 'lci-methodology',
    summary: 'จับคู่ข้อมูลเฉพาะแหล่งกับโครงสร้างกลางของโครงการ เช่น process, flow, หน่วย, ทิศทาง และสัดส่วนการปันส่วน',
    inputs: ['data/staging/*_STAGED.csv', 'กฎ mapping และพจนานุกรมหน่วย'],
    outputs: ['data/mapping/*_MAPPED.csv', 'ข้อมูล LCI ที่พร้อมตรวจสอบ'],
    processingDetails: [
      'จับคู่ชื่อกระบวนการและ flow เข้ากับรายการมาตรฐานของ LCI',
      'แปลงค่าหน่วยและกำหนดทิศทาง IN/OUT ตามความหมายของข้อมูล',
      'ใช้ภาระและยอดผลิต BOE ของ PTTEP ในไทย คำนวณค่าประมาณสำหรับเดโมจากสัดส่วนผลิตภัณฑ์ของ DMF'
    ],
    sqlOrMathFormula: 'AFᵢ = พลังงานของผลิตภัณฑ์ i ÷ พลังงานรวมของผลิตภัณฑ์ร่วม',
    dataQualityChecks: ['ระเบียน map ได้กับ process และ flow', 'ตรวจความพร้อมของ SRC-044–047 และความครบของตัวชี้วัดรายปี'],
    provenanceSource: 'src/mapping/mapping.py'
  },
  {
    stepNumber: '06',
    id: 'VALIDATION',
    titleTh: 'ตรวจคุณภาพและแยกข้อมูลผ่าน/ไม่ผ่าน',
    titleEn: 'Validation & Quality Gates',
    category: 'data-engineering',
    summary: 'ตรวจระเบียนที่ map แล้วด้วยกฎคุณภาพของโครงการ และแยกข้อมูลที่ผ่านออกจากข้อมูลที่ต้องกักกันพร้อมเหตุผล',
    inputs: ['data/mapping/*_MAPPED.csv', 'กฎตรวจสอบคุณภาพข้อมูล'],
    outputs: ['data/validation/accepted/*_VALID.csv', 'data/validation/rejected/*_ERR.csv'],
    processingDetails: [
      'ตรวจความครบถ้วนและชนิดข้อมูลของฟิลด์สำคัญ',
      'ตรวจค่าตัวเลข หน่วย ทิศทาง และเงื่อนไข LCI ที่เกี่ยวข้อง',
      'บันทึกเหตุผลของระเบียนที่ไม่ผ่านแทนการทิ้งข้อมูลเงียบ ๆ'
    ],
    dataQualityChecks: ['แถวที่ผ่านถูกส่งไป accepted', 'แถวที่ไม่ผ่านถูกเก็บใน rejected พร้อม error detail'],
    provenanceSource: 'src/validation/validation.py'
  },
  {
    stepNumber: '07',
    id: 'DATABASE-EXPORT',
    titleTh: 'โหลดข้อมูลลงฐานข้อมูลและไฟล์ส่งออก',
    titleEn: 'Database Load & Export',
    category: 'analytics',
    summary: 'สร้างฐานข้อมูลจากผล Validation ของรอบนี้ แล้วเผยแพร่ CSV, XLSX และ SQLite พร้อมกัน',
    inputs: ['data/validation/accepted/*_VALID.csv', 'schema ฐานข้อมูลตาม ERD'],
    outputs: ['data/database/csv/*.csv', 'data/database/xlsx/*.xlsx', 'data/database/petroleum.db', 'data/database/run_manifest.json', 'data/database/pdf_evidence.csv'],
    processingDetails: [
      'จัดระเบียนลง 10 ตารางตามความสัมพันธ์ของฐานข้อมูล',
      'ตรวจ foreign key สำคัญและสร้าง index สำหรับการค้นหา LCI_EXCHANGE',
      'ตรวจความสมบูรณ์ของ SQLite ก่อนเผยแพร่ไฟล์ทั้งหมดลงใน sandbox'
    ],
    dataQualityChecks: ['ตรวจความครบถ้วนของ source ที่อ้างอิงจาก exchange', 'ทำงานเมื่อไม่มี source run ที่ล้มเหลว'],
    provenanceSource: 'src/database/schema.py · src/database/loader.py · run_pipeline.py'
  }
];
