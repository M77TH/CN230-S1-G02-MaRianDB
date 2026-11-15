import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Database,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Table2,
  Workflow,
  X
} from 'lucide-react';
import { pipelineSteps } from '../../data/pipelineSteps';
import '../../styles/pipeline-presentation.css';

type ArtifactStage = {
  files: number;
  rows: number;
  sourceIds: string[];
  columns: string[];
  sample: Record<string, string>[];
  updatedAt: string | null;
};

type PresentationSnapshot = {
  registry: {
    total: number;
    statuses: Record<string, number>;
    approved: number;
    approvedSourceIds: string[];
    processed: number;
    processedSourceIds: string[];
    missingApprovedSourceIds: string[];
    sourceExamples: { sourceId: string; title: string; publisher: string; status: string }[];
  };
  artifacts: Record<'raw' | 'parsed' | 'staging' | 'mapping' | 'accepted' | 'rejected', ArtifactStage>;
  sourceTrace: Record<string, ArtifactStage>;
  database: {
    ready: boolean;
    tables: { name: string; rows: number }[];
    tableCount: number;
    exchangeRows: number | null;
  };
  queryProof: { sql: string | null; columns: string[]; rows: unknown[][] };
  updatedAt: string | null;
};

const STAGE_KEYS: (keyof PresentationSnapshot['artifacts'] | null)[] = [
  null, null, 'raw', 'parsed', 'staging', 'mapping', 'accepted', 'accepted'
];

const THAI_LABELS: Record<string, string> = {
  raw: 'ไฟล์ต้นฉบับ',
  parsed: 'ตารางที่อ่านได้',
  staging: 'ระเบียนที่จัดรูปแล้ว',
  mapping: 'ระเบียน LCI ที่ map แล้ว',
  accepted: 'ระเบียนที่ผ่าน validation',
  rejected: 'ระเบียนที่กักกันไว้'
};

const numberFormat = new Intl.NumberFormat('th-TH');
const formatCount = (value: number | null | undefined) => numberFormat.format(value || 0);

async function loadSnapshot(): Promise<PresentationSnapshot> {
  const response = await fetch('/api/presentation/snapshot', { headers: { Accept: 'application/json' } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'โหลดข้อมูลประกอบการนำเสนอไม่สำเร็จ');
  return payload as PresentationSnapshot;
}

function EvidenceTable({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  if (!columns.length || !rows.length) return <div className="pp-table-empty">ยังไม่มีตัวอย่างข้อมูลในฐานข้อมูลนี้</div>;
  return (
    <div className="pp-table-scroll">
      <table className="pp-data-table">
        <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
        <tbody>{rows.slice(0, 6).map((row, index) => (
          <tr key={index}>{row.map((value, cellIndex) => <td key={cellIndex}>{String(value ?? '—')}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function SourceSample({ stage, artifact }: { stage: string; artifact?: ArtifactStage }) {
  if (!artifact?.sample.length) {
    return <div className="pp-sample-empty">ไฟล์ขั้นนี้ยังไม่มีแถวตัวอย่างที่อ่านเป็น CSV ได้</div>;
  }
  const columns = artifact.columns.slice(0, 5);
  return (
    <div className="pp-source-sample">
      <div className="pp-sample-title"><span>SRC-044 · {THAI_LABELS[stage] || stage}</span><span>{formatCount(artifact.rows)} แถว</span></div>
      <div className="pp-table-scroll">
        <table className="pp-data-table">
          <thead><tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr></thead>
          <tbody>{artifact.sample.slice(0, 3).map((row, index) => (
            <tr key={index}>{columns.map((column) => <td key={column}>{row[column] || '—'}</td>)}</tr>
          ))}</tbody>
        </table>
      </div>
      <div className="pp-column-note">{formatCount(artifact.columns.length)} คอลัมน์ใน artifact จริง</div>
    </div>
  );
}

function RegistryExample({ sources, total }: { sources: PresentationSnapshot['registry']['sourceExamples']; total: number }) {
  if (!sources.length) return <div className="pp-sample-empty">ไม่พบตัวอย่างรายการใน source registry</div>;
  return (
    <div className="pp-registry-example">
      <div className="pp-sample-title"><span>ตัวอย่างจริงจาก docs/source_registry/source_registry.csv</span><span>คัดเลือกจาก {formatCount(total)} รายการ</span></div>
      <div className="pp-table-scroll">
        <table className="pp-data-table pp-registry-table">
          <thead><tr><th scope="col">SOURCE</th><th scope="col">ชื่อแหล่งข้อมูล</th><th scope="col">หน่วยงาน</th><th scope="col">สถานะ</th></tr></thead>
          <tbody>{sources.map((source) => (
            <tr key={source.sourceId}>
              <td>{source.sourceId}</td><td>{source.title || '—'}</td><td>{source.publisher || '—'}</td>
              <td><span className={`pp-status-pill ${source.status}`}>{source.status === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ'}</span></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="pp-column-note">source ที่อนุมัติเท่านั้นจึงเข้าสู่การประมวลผล · แสดงตัวอย่างทั้งสองสถานะ</div>
    </div>
  );
}

function DatabaseTableExample({ tables }: { tables: PresentationSnapshot['database']['tables'] }) {
  if (!tables.length) return <div className="pp-sample-empty">ยังไม่พบตารางใน SQLite data mart</div>;
  return (
    <div className="pp-database-tables">
      <div className="pp-sample-title"><span>ตารางปลายทางใน SQLite จริง</span><span>{tables.length} tables</span></div>
      <div className="pp-database-table-grid">
        {tables.map((table) => <div className="pp-database-table-row" key={table.name}><span><Database size={13} />{table.name}</span><strong>{formatCount(table.rows)}</strong></div>)}
      </div>
      <div className="pp-column-note">LCI_EXCHANGE เป็นตารางระเบียนแลกเปลี่ยนหลัก · รวม {formatCount(tables.find((table) => table.name.toUpperCase() === 'LCI_EXCHANGE')?.rows)} records</div>
    </div>
  );
}

export const PipelinePresentationMode: React.FC<{ onExit: () => void; runFinishedAt?: string | null }> = ({ onExit, runFinishedAt }) => {
  const [snapshot, setSnapshot] = useState<PresentationSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement === document.documentElement);
  const [fullscreenError, setFullscreenError] = useState('');
  const previousRunFinishedAt = React.useRef(runFinishedAt);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSnapshot(await loadSnapshot());
      setSnapshotError('');
      setRetryAttempt(0);
    } catch (error) {
      setSnapshotError(error instanceof Error ? error.message : 'เชื่อมต่อข้อมูลประกอบไม่ได้');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (!runFinishedAt || runFinishedAt === previousRunFinishedAt.current) return;
    previousRunFinishedAt.current = runFinishedAt;
    void refresh();
  }, [runFinishedAt, refresh]);

  useEffect(() => {
    if (!snapshotError || loading || retryAttempt >= 4) return;
    const delay = [1_500, 3_000, 6_000, 12_000][retryAttempt];
    const timer = window.setTimeout(() => {
      setRetryAttempt((current) => current + 1);
      void refresh();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [snapshotError, loading, retryAttempt, refresh]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(() => {
      if (slideIndex >= pipelineSteps.length + 1) {
        setPlaying(false);
        return;
      }
      setSlideIndex(slideIndex + 1);
    }, 8500);
    return () => window.clearTimeout(timer);
  }, [playing, slideIndex]);

  useEffect(() => {
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement === document.documentElement;
      setIsFullscreen(active);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    handleFullscreenChange();
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setPlaying(false);
        setSlideIndex((current) => Math.min(pipelineSteps.length + 1, current + 1));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setPlaying(false);
        setSlideIndex((current) => Math.max(0, current - 1));
      } else if (event.key === 'Escape') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else onExit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExit]);

  const activeStep = slideIndex > 0 && slideIndex <= pipelineSteps.length ? pipelineSteps[slideIndex - 1] : null;
  const isQuerySlide = slideIndex === pipelineSteps.length + 1;
  const artifactKey = activeStep ? STAGE_KEYS[slideIndex] : null;
  const sourceArtifact = artifactKey && snapshot ? snapshot.sourceTrace[artifactKey] : undefined;
  const rejectedArtifact = snapshot?.artifacts.rejected;
  const rejectedSources = snapshot?.registry.statuses.rejected || snapshot?.registry.statuses.reject || 0;
  const slideCount = pipelineSteps.length + 2;
  const lastSlideIndex = slideCount - 1;
  const currentFlowIndex = activeStep ? slideIndex - 1 : isQuerySlide ? pipelineSteps.length : -1;

  const setSlide = (next: number) => {
    setSlideIndex(Math.max(0, Math.min(lastSlideIndex, next)));
    setPlaying(false);
  };

  const toggleFullscreen = async () => {
    setFullscreenError('');
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setFullscreenError('เบราว์เซอร์ไม่อนุญาตให้เปิดเต็มจอ');
    }
  };

  const metrics = useMemo(() => {
    if (!snapshot) return [];
    if (slideIndex === 0) return [
      { label: 'แหล่งในทะเบียน', value: formatCount(snapshot.registry.total), note: `${formatCount(rejectedSources)} รายการยังไม่อนุมัติ` },
      { label: 'อนุมัติแล้ว', value: formatCount(snapshot.registry.approved), note: 'ผ่านการคัดเลือกจากทะเบียน' },
      { label: 'มีผลลัพธ์ในชุดปัจจุบัน', value: formatCount(snapshot.registry.processed), note: 'นับจากไฟล์ accepted' },
      { label: 'ระเบียน LCI', value: formatCount(snapshot.database.exchangeRows), note: snapshot.database.ready ? 'ใน SQLite จริง' : 'ยังไม่มี SQLite' }
    ];
    const stepNo = slideIndex;
    if (stepNo === 1) return [
      { label: 'แหล่ง approved', value: formatCount(snapshot.registry.approved), note: 'รายชื่อจาก source registry' },
      { label: 'ได้รับผลลัพธ์ปัจจุบัน', value: formatCount(snapshot.registry.processed), note: 'พบไฟล์ accepted' },
      { label: 'ยังไม่พบในผลลัพธ์', value: formatCount(snapshot.registry.missingApprovedSourceIds.length), note: snapshot.registry.missingApprovedSourceIds.join(', ') || 'ครบทุก source' }
    ];
    if (stepNo === 7) return [
      { label: 'ตารางใน SQLite', value: formatCount(snapshot.database.tableCount), note: 'schema ที่โหลดจริง' },
      { label: 'ระเบียน LCI_EXCHANGE', value: formatCount(snapshot.database.exchangeRows), note: 'พร้อม query' },
      { label: 'ผลตรวจคุณภาพ', value: formatCount(snapshot.database.tables.find((table) => table.name.toUpperCase() === 'QUALITY_CHECK')?.rows), note: 'ผลตรวจรายกฎในฐานข้อมูล' }
    ];
    if (stepNo === 8) return [
      { label: 'แถวจาก query', value: formatCount(snapshot.queryProof.rows.length), note: 'ผลจาก SQL จริง' },
      { label: 'ระเบียน LCI_EXCHANGE', value: formatCount(snapshot.database.exchangeRows), note: 'ฐานข้อมูลชุดปัจจุบัน' },
      { label: 'ตารางให้ query', value: formatCount(snapshot.database.tableCount), note: 'ใน sandbox snapshot' }
    ];
    const stage = snapshot.artifacts[artifactKey as keyof PresentationSnapshot['artifacts']];
    const items = [{ label: THAI_LABELS[artifactKey || ''] || 'ไฟล์ artifact', value: formatCount(stage.files), note: 'ไฟล์ในโฟลเดอร์ขั้นนี้' }];
    if (artifactKey !== 'raw') items.push({ label: 'จำนวนระเบียน', value: formatCount(stage.rows), note: 'นับจาก CSV จริง' });
    items.push({ label: 'source ที่ปรากฏ', value: formatCount(stage.sourceIds.length), note: 'ตรวจจากชื่อไฟล์ artifact' });
    if (stepNo === 6) items.push({ label: 'กักกันไว้', value: formatCount(rejectedArtifact?.rows), note: 'เก็บ error detail ใน ERR.csv' });
    return items;
  }, [snapshot, slideIndex, artifactKey, rejectedArtifact, rejectedSources]);

  return (
    <div className={`pipeline-presentation ${isFullscreen ? 'is-fullscreen' : ''}`}>
      <div className="pp-deck">
        <header className="pp-topbar">
          <div className="pp-brand"><span className="pp-brand-mark"><Workflow size={18} /></span><span><strong>CN230 · PIPELINE STORY</strong><small>เรื่องเล่าจากข้อมูลและโค้ดจริงของโครงการ</small></span></div>
          <div className="pp-top-actions">
            <span className={`pp-live-tag ${snapshotError ? 'is-error' : ''}`}><i />{snapshotError ? 'เชื่อมต่อไม่ได้' : loading ? 'กำลังอ่านข้อมูลจริง' : 'ข้อมูลจริงพร้อมแสดง'}</span>
            <button type="button" className="pp-icon-button" onClick={() => void refresh()} aria-label="โหลดข้อมูลใหม่" title="โหลดข้อมูลใหม่"><RotateCcw size={15} /></button>
            <button type="button" className="pp-exit-button pp-fullscreen-button" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? 'ออกจากเต็มจอ' : 'เปิดเต็มจอ'} title={fullscreenError || (isFullscreen ? 'ออกจากเต็มจอ' : 'เปิดเต็มจอ')}>
              {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}{isFullscreen ? ' ย่อเต็มจอ' : ' เต็มจอ'}
            </button>
            <button type="button" className="pp-exit-button" onClick={onExit}><X size={15} /> กลับสู่ส่วน pipeline</button>
          </div>
        </header>

        <main className="pp-main">
            <div className="pp-slide-meta"><span>{activeStep ? `STEP ${activeStep.stepNumber} / 07` : isQuerySlide ? 'REAL DATA · LIVE QUERY' : 'EXECUTIVE OVERVIEW'}</span><span>{formatCount(slideIndex + 1)} / {formatCount(slideCount)} สไลด์</span></div>

            <nav className="pp-process-track" aria-label="ลำดับ pipeline นำเสนอ">
              {pipelineSteps.map((step, index) => (
                <button type="button" key={step.id} className={`pp-track-item ${currentFlowIndex === index ? 'is-active' : ''} ${currentFlowIndex > index ? 'is-done' : ''}`} aria-current={currentFlowIndex === index ? 'step' : undefined} onClick={() => setSlide(index + 1)}>
                  <span className="pp-track-number">{step.stepNumber}</span><span className="pp-track-title">{step.titleTh}</span>
                </button>
              ))}
              <span className="pp-flow-bead" style={{ left: `${Math.max(0, Math.min(100, ((currentFlowIndex + 0.5) / pipelineSteps.length) * 100))}%` }} aria-hidden="true" />
            </nav>

            <section className="pp-slide" key={slideIndex} aria-live="polite">
              {slideIndex === 0 ? (
                <>
                  <div className="pp-hero-copy">
                    <span className="pp-kicker">FROM SOURCE TO QUERYABLE LCI</span>
                    <h1>จากแหล่งข้อมูล<br /><em>สู่ฐานข้อมูลที่ตรวจสอบย้อนกลับได้</em></h1>
                    <p>เรื่องเล่าของ pipeline จริง ตั้งแต่คัดเลือกแหล่งข้อมูลจนถึง query ระเบียน LCI ที่จัดเก็บใน SQLite</p>
                  </div>
                  <div className="pp-funnel-card">
                    <div className="pp-funnel-heading"><div><span className="pp-kicker">CURRENT DATA SNAPSHOT</span><h2>ภาพรวมชุดข้อมูลปัจจุบัน</h2></div><span className="pp-source-badge"><Database size={13} /> อ่านจากไฟล์และฐานข้อมูลจริง</span></div>
                    <div className="pp-funnel-flow">
                      <div className="pp-funnel-step"><small>ลงทะเบียน</small><strong>{formatCount(snapshot?.registry.total)}</strong><span>แหล่งข้อมูล</span></div>
                      <ArrowRight className="pp-funnel-arrow" size={18} />
                      <div className="pp-funnel-step"><small>อนุมัติ</small><strong>{formatCount(snapshot?.registry.approved)}</strong><span>แหล่งข้อมูล</span></div>
                      <ArrowRight className="pp-funnel-arrow" size={18} />
                      <div className="pp-funnel-step"><small>พบในผลลัพธ์ปัจจุบัน</small><strong>{formatCount(snapshot?.registry.processed)}</strong><span>แหล่งข้อมูล</span></div>
                      <ArrowRight className="pp-funnel-arrow" size={18} />
                      <div className="pp-funnel-step is-final"><small>โหลดลงฐานข้อมูล</small><strong>{formatCount(snapshot?.database.exchangeRows)}</strong><span>ระเบียน LCI</span></div>
                    </div>
                    {!!snapshot?.registry.missingApprovedSourceIds.length && (
                      <div className="pp-data-caveat"><CircleAlert size={16} /><span><b>จุดที่ควรอธิบายกับผู้ฟัง:</b> มี source ที่อนุมัติแล้วแต่ยังไม่พบในไฟล์ accepted ปัจจุบัน ({snapshot.registry.missingApprovedSourceIds.join(', ')}) ตัวเลข pipeline นี้จึงนับจากผลลัพธ์ที่มีอยู่จริง</span></div>
                    )}
                  </div>
                  <div className="pp-overview-metrics">
                    {metrics.map((metric) => <div className="pp-metric" key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong><span>{metric.note}</span></div>)}
                  </div>
                  <div className="pp-overview-bottom"><span><CheckCircle2 size={15} /> ไล่ทีละขั้นด้วย artifact จาก source เดียวกัน: SRC-044</span><button type="button" onClick={() => setSlide(1)}>เริ่มเล่า pipeline <ArrowRight size={15} /></button></div>
                </>
              ) : activeStep ? (
                <>
                  <div className="pp-step-heading">
                    <div className="pp-big-step">{activeStep.stepNumber}</div>
                    <div><span className="pp-kicker">{activeStep.titleEn}</span><h1>{activeStep.titleTh}</h1><p>{activeStep.summary}</p></div>
                  </div>
                  <div className="pp-metrics-row">
                    {metrics.map((metric) => <div className="pp-metric" key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong><span>{metric.note}</span></div>)}
                  </div>

                  <div className="pp-transformation">
                    <div className="pp-transform-card"><span>INPUT · สิ่งที่ขั้นนี้รับเข้า</span><ul>{activeStep.inputs.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></div>
                    <div className="pp-transform-arrow"><ArrowRight size={18} /></div>
                    <div className="pp-transform-card is-output"><span>OUTPUT · สิ่งที่ได้</span><ul>{activeStep.outputs.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></div>
                  </div>

                  <div className="pp-detail-grid">
                    <section className="pp-detail-card pp-process-card"><div className="pp-card-title"><span>เบื้องหลังขั้นตอน</span><small>{activeStep.processingDetails.length} กิจกรรมหลัก</small></div><ol>{activeStep.processingDetails.map((detail, index) => <li key={detail}><i>{String(index + 1).padStart(2, '0')}</i><span>{detail}</span></li>)}</ol>{activeStep.sqlOrMathFormula && <div className="pp-formula">{activeStep.sqlOrMathFormula}</div>}</section>
                    <section className="pp-detail-card pp-evidence-card">
                      <div className="pp-card-title"><span>{slideIndex === 7 ? 'ตารางข้อมูลที่ pipeline สร้างจริง' : slideIndex === 1 ? 'ตัวอย่างจากทะเบียน source จริง' : 'ตัวอย่าง artifact ที่ได้ในขั้นนี้'}</span><span className="pp-evidence-dot"><i /> EVIDENCE</span></div>
                      {slideIndex === 7 ? <><DatabaseTableExample tables={snapshot?.database.tables || []} /><div className="pp-evidence-foot"><Table2 size={13} /> {formatCount(snapshot?.database.tableCount)} ตาราง · {formatCount(snapshot?.database.exchangeRows)} ระเบียน LCI_EXCHANGE</div></> : slideIndex === 1 ? <RegistryExample sources={snapshot?.registry.sourceExamples || []} total={snapshot?.registry.total || 0} /> : slideIndex === 6 ? <div className="pp-validation-samples"><SourceSample stage="accepted" artifact={snapshot?.sourceTrace.accepted} /><SourceSample stage="rejected" artifact={snapshot?.sourceTrace.rejected} /></div> : <SourceSample stage={artifactKey || ''} artifact={sourceArtifact} />}
                    </section>
                  </div>

                  <div className="pp-gates-row">
                    <section className="pp-gate-card"><span>QUALITY GATE · เกณฑ์ที่ต้องผ่าน</span>{activeStep.dataQualityChecks.slice(0, 3).map((check) => <div key={check}><CheckCircle2 size={14} />{check}</div>)}</section>
                    {slideIndex === 5 && <section className="pp-dependency-card"><Workflow size={16} /><span><b>Dependency และ grain ของข้อมูล</b> · ใช้ SRC-047 เป็น burden อ้างอิงก่อน map SRC-044/045/046; ข้อมูล SRC-044 ถูกรวมจากรายเดือนเป็น process-year/reference flow ({formatCount(snapshot?.sourceTrace.staging.rows)} → {formatCount(snapshot?.sourceTrace.mapping.rows)} แถว) จึงไม่ใช่การคัดลอกแถวต่อแถว</span></section>}
                    {slideIndex === 6 && <section className="pp-dependency-card is-warning"><CircleAlert size={16} /><span><b>การตีความผล:</b> ไม่ผ่านจะถูกเก็บใน rejected พร้อมเหตุผล ในตัวอย่าง SRC-044 ผ่าน {formatCount(snapshot?.sourceTrace.accepted.rows)} และกักกัน {formatCount(snapshot?.sourceTrace.rejected.rows)} แถว; รวมทั้งระบบกักกัน {formatCount(rejectedArtifact?.rows)} แถว</span></section>}
                  </div>

                  <div className="pp-source-line"><span>IMPLEMENTATION / SOURCE</span><code>{activeStep.provenanceSource}</code><span className="pp-updated">{snapshot?.updatedAt ? `artifact ล่าสุด ${new Date(snapshot.updatedAt).toLocaleString('th-TH')}` : 'ยังไม่มีเวลาปรับปรุง artifact'}</span></div>
                </>
              ) : isQuerySlide ? (
                <div className="pp-query-slide">
                  <div className="pp-query-slide-heading"><span className="pp-kicker">FINAL PROOF · REAL SQL, REAL PROJECT DATA</span><h1>ข้อมูลที่ผ่าน pipeline<br /><em>query ได้จริงในฐานข้อมูล</em></h1><p>ระบบอ่าน SQLite snapshot ใน sandbox แล้ว join ตาราง process, flow และ unit เพื่อแสดง LCI exchange ตัวอย่าง</p></div>
                  <div className="pp-overview-metrics pp-query-metrics">{metrics.map((metric) => <div className="pp-metric" key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong><span>{metric.note}</span></div>)}</div>
                  <div className="pp-query-proof-panel"><div className="pp-query-proof-heading"><span>EXECUTED SQL</span><span className="pp-evidence-dot"><i /> SELECT ONLY</span></div><code className="pp-sql-proof pp-sql-proof-large">{snapshot?.queryProof.sql || 'ฐานข้อมูลยังไม่พร้อมสำหรับ query'}</code><EvidenceTable columns={snapshot?.queryProof.columns || []} rows={snapshot?.queryProof.rows || []} /><div className="pp-evidence-foot"><Table2 size={14} /> อ่าน {formatCount(snapshot?.database.exchangeRows)} ระเบียนจาก {formatCount(snapshot?.database.tableCount)} ตาราง · สำเนาในหน่วยความจำเท่านั้น</div></div>
                </div>
              ) : null}
            </section>

            <footer className="pp-controls">
              <button type="button" className="pp-control-button" onClick={() => setSlide(slideIndex - 1)} disabled={slideIndex === 0}><ChevronLeft size={15} /> ก่อนหน้า</button>
              <div className="pp-progress" aria-label={`สไลด์ ${slideIndex + 1} จาก ${slideCount}`}>
                {Array.from({ length: slideCount }, (_, index) => <button type="button" key={index} className={slideIndex === index ? 'is-current' : slideIndex > index ? 'is-complete' : ''} onClick={() => setSlide(index)} aria-label={`ไปสไลด์ ${index + 1}`} />)}
              </div>
              <div className="pp-control-actions">
                <button type="button" className="pp-play-button" onClick={() => {
                  if (slideIndex >= lastSlideIndex) setSlideIndex(0);
                  setPlaying((current) => !current);
                }}>{playing ? <Pause size={14} /> : <Play size={14} />}{playing ? 'พัก' : 'เล่นอัตโนมัติ'}</button>
                <button type="button" className="pp-control-button pp-next-button" onClick={() => setSlide(slideIndex >= lastSlideIndex ? 0 : slideIndex + 1)}>{slideIndex >= lastSlideIndex ? <><RotateCcw size={14} /> เล่นซ้ำ</> : <>ขั้นถัดไป <ChevronRight size={15} /></>}</button>
              </div>
            </footer>
        </main>
      </div>
      <div className="pp-background-mark" aria-hidden="true">CN230</div>
    </div>
  );
};
