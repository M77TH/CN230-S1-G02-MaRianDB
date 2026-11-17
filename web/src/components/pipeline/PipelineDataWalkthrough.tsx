import type { PresentationSnapshot } from './PipelinePresentationMode';

type Props = { step: number; after: boolean; walkthroughPage?: 'flow' | 'before' | 'after'; snapshot: PresentationSnapshot };
type Field = { key: string; label: string; width?: string };
const n = (value: number) => new Intl.NumberFormat('en-US').format(value);
const valueText = (value: unknown) => {
  if (value === undefined || value === null || value === '') return '—';
  const text = String(value);
  return /^-?\d+\.\d{7,}$/.test(text) ? Number(text).toLocaleString('en-US', { maximumSignificantDigits: 7 }) : text;
};

function Sheet({ rows, fields, changed = [], status, rowStatuses }: { rows: Record<string, string>[]; fields: Field[]; changed?: string[]; status?: boolean; rowStatuses?: string[] }) {
  return <div className="dw-sheet"><table><colgroup>{fields.map(f => <col key={f.key} style={{ width: f.width }} />)}{status !== undefined && <col style={{ width: '13%' }} />}</colgroup>
    <thead><tr>{fields.map(f => <th key={f.key}>{f.label}</th>)}{status !== undefined && <th>สถานะ</th>}</tr></thead>
    <tbody>{rows.map((row, i) => {
      const rowStatus = rowStatuses?.[i] || (status ? 'ACCEPTED' : 'N/A');
      const statusClass = rowStatus === 'REJECTED' ? 'dw-rejected' : rowStatus === 'ACCEPTED' ? 'dw-pass' : 'dw-pending';
      return <tr key={i}>{fields.map(f => <td key={f.key} className={changed.includes(f.key) ? 'dw-changed' : ''} title={row[f.key]}><span key={row[f.key]}>{valueText(row[f.key])}</span></td>)}{status !== undefined && <td className={rowStatus === 'REJECTED' ? 'dw-rejected-cell' : rowStatus === 'ACCEPTED' ? 'dw-changed' : ''}><span key={rowStatus} className={statusClass}>{rowStatus}</span></td>}</tr>;
    })}</tbody>
  </table></div>;
}

export function PipelineDataWalkthrough({ step, after, walkthroughPage, snapshot: s }: Props) {
  const raw = s.sourceTrace.raw;
  const staged = s.sourceTrace.staging;
  const mapped = s.sourceTrace.mapping;
  const accepted = s.sourceTrace.accepted;
  const rejected = s.sourceTrace.rejected;
  const provenance = staged.sample[0] || {};
  const rejectedExamples = rejected.sample.slice(0, 2).map(row => {
    let raw: Record<string, unknown> = {};
    try { raw = JSON.parse(row.raw_data || '{}') as Record<string, unknown>; } catch { /* Keep available fields if the sample is malformed. */ }
    return {
      year: String(raw.year ?? row.error_type?.match(/ปี\s*(\d{4})/)?.[1] ?? '—'),
      flow_name: String(raw.flow_name ?? '—'),
      direction: String(raw.direction ?? '—'),
      amount: String(raw.amount ?? '—'),
      unit: String(raw.unit ?? '—'),
      error_type: row.error_type || 'ไม่ผ่านเกณฑ์ตรวจสอบ',
    };
  });
  const acceptedExamples = accepted.sample.slice(0, 6).map(row => ({ ...row, error_type: '' }));
  const validationRecordsUnsorted: { row: Record<string, string>; status: string }[] = [
    ...acceptedExamples.map(row => ({ row, status: 'ACCEPTED' })),
    ...rejectedExamples.map(row => ({ row, status: 'REJECTED' })),
  ];
  const validationRecords = validationRecordsUnsorted.sort((a, b) => Number(a.row.year) - Number(b.row.year));
  const validationRows: Record<string, string>[] = validationRecords.map(({ row }) => after ? row : { ...row, error_type: '' });
  const validationFields: Field[] = [
    { key: 'year', label: 'year', width: '8%' },
    { key: 'flow_name', label: 'flow_name', width: '23%' },
    { key: 'direction', label: 'direction', width: '10%' },
    { key: 'amount', label: 'amount', width: '14%' },
    { key: 'unit', label: 'unit', width: '10%' },
    { key: 'error_type', label: 'error_type', width: '22%' },
  ];
  const validationStatuses = validationRecords.map(record => record.status);
  const lciFields: Field[] = [
    { key: 'year', label: 'year', width: '11%' }, { key: 'flow_name', label: 'flow_name', width: '43%' },
    { key: 'direction', label: 'direction', width: '12%' }, { key: 'amount', label: 'amount', width: '22%' }, { key: 'unit', label: 'unit', width: '12%' }
  ];
  const captions: Record<number, [string, string]> = {
    2: ['ตรวจ URL และเลือก Extractor ให้ตรงแหล่ง', 'ดาวน์โหลดไฟล์และออก Provenance receipt'],
    3: ['ไฟล์ CSV ที่ได้รับจาก DMF', 'อ่านแต่ละช่องเป็นตาราง โดยคงค่าต้นฉบับ'],
    4: ['ค่าจากตารางต้นฉบับ', 'จัดรูปค่า และผูกที่มากับทุกระเบียน'],
    5: ['เตรียมข้อมูลผลิตและภาระสิ่งแวดล้อม', 'ได้ LCI รายปีต่อหน่วยผลิตภัณฑ์'],
    6: ['ระเบียนที่ map แล้ว รอตรวจคุณภาพ', 'แยกระเบียนผ่านและไม่ผ่าน พร้อมแสดงเหตุผล'],
    7: ['ระเบียนที่ผ่านการตรวจ พร้อมจัดเก็บ', 'เชื่อม process · flow · unit ใน SQLite']
  };
  const paths: Record<number, [string, string]> = {
    2: walkthroughPage === 'flow' ? ['APPROVED URL', 'MATCHING EXTRACTOR'] : ['APPROVED URL', 'RAW FILE + LEDGER'], 3: ['RAW.csv', 'PARSED.csv'], 4: ['PARSED.csv', 'STAGED.csv'],
    5: ['STAGED + PTTEP', 'MAPPED.csv'], 6: ['MAPPED.csv', 'VALID.csv'], 7: ['VALID.csv', 'petroleum.db']
  };
  return <section className={`dw-walkthrough${step === 5 ? ' is-mapping' : ''}${step === 6 ? ' is-validation' : ''}${step === 7 ? ' is-database' : ''}`}>
    <div className="dw-context"><span><b>SRC-044</b> ปริมาณการผลิตน้ำมันรายเดือน · กรมเชื้อเพลิงธรรมชาติ (DMF)</span><div><span>{paths[step][0]}</span><i>→</i><strong className={after ? 'is-done' : ''}>{paths[step][1]}</strong></div></div>
    <div className="dw-canvas">
      <div className="dw-caption"><h2>{captions[step][after ? 1 : 0]}</h2><span>{step === 2 && walkthroughPage === 'flow' ? 'ขั้นตอนการดึงข้อมูล' : after ? 'ผลลัพธ์' : 'ก่อนประมวลผล'}</span></div>
      {step === 2 && walkthroughPage === 'flow' && <div className="dw-extractor-flow"><article><small>01 · ROUTER</small><strong>ตรวจ source URL</strong><p>เลือก extractor ด้วยชนิดแหล่งและ URL</p></article><i>→</i><article><small>02 · MATCHING EXTRACTOR</small><strong>Portal · Form · Web · Direct</strong><p>CKAN API · แบบฟอร์ม · เว็บ · ลิงก์ CSV / XLSX / PDF / ZIP</p></article><i>→</i><article><small>03 · RETRIEVE</small><strong>ดึงไฟล์ต้นฉบับ</strong><p>บันทึกไฟล์ลง raw พร้อม batch ID</p></article><i>→</i><article><small>04 · PROVENANCE</small><strong>SHA-256 ledger</strong><p>ตรวจ hash ซ้ำแล้วข้ามดาวน์โหลด เว้นแต่สั่ง force</p></article></div>}
      {step === 2 && walkthroughPage !== 'flow' && <>
        <div className="dw-file-heading"><span className="dw-file-type">CSV</span><div><strong>ปริมาณการผลิตน้ำมันรายเดือน</strong><small>catalog.dmf.go.th · SRC-044</small></div><span className={after ? 'dw-pass' : 'dw-pending'} key={String(after)}>{after ? 'บันทึกไฟล์แล้ว' : 'อนุมัติแหล่งแล้ว'}</span></div>
        <div className="dw-acquisition-route"><div><small>01 · ROUTER</small><strong>ตรวจ URL</strong><span>เลือกวิธีดึงข้อมูลให้ตรงกับแหล่ง</span></div><i>→</i><div><small>02 · EXTRACTOR</small><strong>Portal · Form · Web · Direct</strong><span>เชื่อม API · กรอกฟอร์ม · อ่านเว็บ · ดาวน์โหลดไฟล์</span></div><i>→</i><div><small>03 · RAW FILE</small><strong>{after ? 'ดาวน์โหลดแล้ว' : 'รอรับไฟล์'}</strong><span>{after ? provenance._raw_file : 'CSV · XLSX · PDF · ZIP'}</span></div></div>
        <div className="dw-ledger"><div className="dw-ledger-title"><strong>PROVENANCE LEDGER</strong><span>หนึ่ง receipt ต่อไฟล์ที่ดึงได้</span></div><div className="dw-ledger-fields">{[['source_url', provenance._source_url], ['batch_id', provenance._extraction_batch_id], ['SHA-256', provenance._source_sha256], ['raw_file', provenance._raw_file]].map(([label, value]) => <div key={label}><small>{label}</small><span key={String(after)} className={after ? 'dw-revealed' : 'dw-pending'} title={value}>{after ? value || '—' : 'รอการดาวน์โหลด'}</span></div>)}</div><p>Ledger ยังบันทึกเวลาที่ดึง · HTTP status · ขนาดไฟล์ (bytes)</p></div>
      </>}
      {step === 3 && <div className="dw-parse-frame" key={String(after)}>{after ? <Sheet rows={s.sourceTrace.parsed.sample} fields={raw.columns.map(key => ({ key, label: key, width: key === 'SOURCE_GROUP' ? '22%' : '13%' }))} /> : <div className="dw-csv"><div>{raw.columns.join(',')}</div>{raw.sample.map((row, i) => <div key={i}><i>{String(i + 1).padStart(2, '0')}</i>{raw.columns.map(c => row[c] || '').join(',')}</div>)}</div>}<div className="dw-caption-bottom"><strong>{n(raw.rows)} แถว</strong><span>7 คอลัมน์ · ตัวอย่าง 3 แถวแรกจากไฟล์จริง</span></div></div>}
      {step === 4 && <>
        <Sheet rows={(after ? staged : s.sourceTrace.parsed).sample.map(row => after ? { source: row.source_group, year: row.year, month: row.month, block: row.block_name, oil: row.oil_bbl_day } : { source: row.SOURCE_GROUP, year: row.YEAR, month: row.MONTH, block: row.BLOCK, oil: row.OIL })} fields={[{ key: 'source', label: 'แหล่งผลิต', width: '25%' }, { key: 'year', label: after ? 'year' : 'YEAR', width: '15%' }, { key: 'month', label: after ? 'month' : 'MONTH', width: '20%' }, { key: 'block', label: after ? 'block_name' : 'BLOCK', width: '22%' }, { key: 'oil', label: after ? 'oil_bbl_day' : 'OIL', width: '18%' }]} changed={after ? ['year', 'month', 'block', 'oil'] : []} />
        <div className="dw-change-notes"><span>ปี <b>2547 → 2004</b></span><span>เดือน <b>8 → August</b></span><span>ค่าว่าง <b>→ UNSPECIFIED</b></span></div>
        <div className="dw-metadata"><div><small>SOURCE ID</small><span className={after ? 'dw-revealed' : 'dw-pending'} key={String(after)}>{after ? provenance._source_id : 'N/A'}</span></div><div><small>EXTRACTION BATCH</small><span className={after ? 'dw-revealed' : 'dw-pending'} key={String(after)}>{after ? provenance._extraction_batch_id : 'N/A'}</span></div><div><small>จำนวนแถวทั้งหมด</small><span>{n(s.sourceTrace.parsed.rows)} → <b>{after ? n(staged.rows) : 'N/A'}</b></span></div></div>
      </>}
      {step === 5 && <>
        <div className="dw-allocation"><div><small>ข้อมูลผลิต · DMF</small><strong>SRC-044 · 045 · 046</strong><span>น้ำมันดิบ · ก๊าซธรรมชาติ · คอนเดนเสท</span></div><i>+</i><div><small>ภาระสิ่งแวดล้อม · PTTEP</small><strong>SRC-047</strong><span>ภาระในไทยและยอดผลิต BOE</span></div><i>→</i><div className="dw-allocation-result"><small>LCI · SRC-044</small><strong>{after ? n(mapped.rows) : 'N/A'} <small>ระเบียน</small></strong><span>รายปี · ช่วง 2022–2025</span></div></div>
        {after ? <Sheet rows={mapped.sample} fields={lciFields} changed={['amount', 'unit', 'direction']} /> : <div className="dw-mapping-input">
          <div><small>ยอดผลิต PTTEP · {mapped.sample[0]?.year}</small><strong>{n(Number(mapped.sample[0]?._allocation_pttep_boe))}</strong><span>BOE</span></div>
          <div><small>สัดส่วนน้ำมันดิบจาก DMF</small><strong>{(Number(mapped.sample[0]?._allocation_share) * 100).toFixed(2)}%</strong><span>ใช้ปันส่วนภาระสิ่งแวดล้อม</span></div>
          <div><small>ปริมาณน้ำมันดิบ proxy</small><strong>{n(Math.round(Number(mapped.sample[0]?._allocation_proxy_volume)))}</strong><span>BBL · ปัดแสดงเป็นจำนวนเต็ม</span></div>
          <p>ภาระสิ่งแวดล้อม × สัดส่วนปันส่วน ÷ ปริมาณ proxy <b>→ ภาระต่อ 1 BBL</b></p>
        </div>}
        <div className="dw-caption-bottom"><strong>1 BBL น้ำมันดิบเป็น reference flow</strong><span>ค่าประมาณเดโมจาก PTTEP proxy · รวมข้อมูลรายเดือนและปันส่วนก่อน map</span></div>
      </>}
      {step === 6 && <>
        <Sheet rows={validationRows} fields={validationFields} status={after} rowStatuses={after ? validationStatuses : undefined} />
        <div className="dw-validation-result"><div><span><b>{after ? n(accepted.rows) : n(mapped.rows)}</b> {after ? 'ACCEPTED' : 'รอตรวจสอบ'}</span><span>{after ? `${n(rejected.rows)} REJECTED · ตัวอย่าง SRC-044` : 'ตรวจฟิลด์ · ชนิดข้อมูล · หน่วย · ทิศทาง'}</span></div></div>
      </>}
      {step === 7 && <>
        <div className="dw-database-links">{['PROCESS', 'LCI_EXCHANGE', 'FLOW', 'UNIT'].map(name => <div key={name} className={after ? 'is-loaded' : ''}><small>{name}</small><strong key={String(after)}>{after ? n(s.database.tables.find(t => t.name === name)?.rows || 0) : 'N/A'}</strong><span>แถว · ทั้งฐานข้อมูล</span></div>)}</div>
        {after ? <Sheet rows={accepted.sample} fields={lciFields} changed={['flow_name', 'unit']} /> : <div className="dw-database-pending"><strong>ยังไม่มีระเบียนในตาราง</strong><span>ตัวอย่างข้อมูลจะแสดงหลังโหลดฐานข้อมูล</span></div>}
        <div className="dw-caption-bottom"><strong>{after ? `${n(s.database.exchangeRows || 0)} LCI exchanges จาก ${n(s.registry.processed)} แหล่ง` : `${n(accepted.rows)} ระเบียน SRC-044 พร้อมโหลด`}</strong><span>{after ? 'petroleum.db · ส่งออก CSV และ XLSX · ทดลอง SQL ในหน้าถัดไป' : 'รอโหลดไฟล์ VALID เข้า petroleum.db'}</span></div>
      </>}
    </div>
  </section>;
}
