import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  CircleAlert,
  Database,
  Table2,
  Workflow,
  X
} from 'lucide-react';
import { useWebsiteData } from '../../data/websiteData';
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
  const response = await fetch('/pipeline_demo.json', { headers: { Accept: 'application/json' } });
  const payload = await response.json();
  if (!response.ok) throw new Error('Could not load the prepared presentation snapshot.');
  if (!payload.pipelineSummary) throw new Error('The prepared pipeline snapshot has no presentation summary.');
  return payload.pipelineSummary as PresentationSnapshot;
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
  const { catalog } = useWebsiteData();
  const pipelineSteps = catalog!.data.pipelineSteps;
  const presentationPages = [
    { kind: 'overview' as const, step: null, page: 'overview' as const },
    ...pipelineSteps.flatMap((step) => [
      { kind: 'step' as const, step, page: 'summary' as const },
      { kind: 'step' as const, step, page: 'details' as const }
    ]),
    { kind: 'query' as const, step: null, page: 'query' as const }
  ];
  const lastSlideIndex = presentationPages.length - 1;
  const [snapshot, setSnapshot] = useState<PresentationSnapshot | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement === document.documentElement);
  const [chromeVisible, setChromeVisible] = useState(true);
  const wasFullscreenRef = React.useRef(document.fullscreenElement === document.documentElement);
  const previousRunFinishedAt = React.useRef(runFinishedAt);
  const chromeTimerRef = React.useRef<number | null>(null);

  const revealChrome = useCallback(() => {
    if (!isFullscreen) return;
    setChromeVisible(true);
    if (chromeTimerRef.current !== null) window.clearTimeout(chromeTimerRef.current);
    chromeTimerRef.current = window.setTimeout(() => setChromeVisible(false), 2200);
  }, [isFullscreen]);

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
      if (slideIndex >= lastSlideIndex) {
        setPlaying(false);
        return;
      }
      setSlideIndex(slideIndex + 1);
    }, 8500);
    return () => window.clearTimeout(timer);
  }, [playing, slideIndex, lastSlideIndex]);

  useEffect(() => {
    const initiallyActive = document.fullscreenElement === document.documentElement;
    document.documentElement.classList.toggle('cn230-presentation-fullscreen', initiallyActive);
    const handleFullscreenChange = () => {
      const active = document.fullscreenElement === document.documentElement;
      setIsFullscreen(active);
      document.documentElement.classList.toggle('cn230-presentation-fullscreen', active);
      if (wasFullscreenRef.current && !active) onExit();
      wasFullscreenRef.current = active;
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.documentElement.classList.remove('cn230-presentation-fullscreen');
    };
  }, [onExit]);

  useEffect(() => {
    if (chromeTimerRef.current !== null) window.clearTimeout(chromeTimerRef.current);
    if (!isFullscreen) {
      setChromeVisible(true);
      chromeTimerRef.current = null;
      return;
    }
    setChromeVisible(true);
    chromeTimerRef.current = window.setTimeout(() => setChromeVisible(false), 2200);
    return () => {
      if (chromeTimerRef.current !== null) window.clearTimeout(chromeTimerRef.current);
      chromeTimerRef.current = null;
    };
  }, [isFullscreen]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      revealChrome();
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setPlaying(false);
        setSlideIndex((current) => Math.min(lastSlideIndex, current + 1));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setPlaying(false);
        setSlideIndex((current) => Math.max(0, current - 1));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setPlaying(false);
        setSlideIndex(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        setSlideIndex(lastSlideIndex);
      } else if (event.code === 'Space' && !(event.target instanceof HTMLElement && ['BUTTON', 'INPUT', 'TEXTAREA'].includes(event.target.tagName))) {
        event.preventDefault();
        setPlaying((current) => !current);
      } else if (event.key === 'Escape') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else onExit();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [lastSlideIndex, onExit, revealChrome]);

  const activePage = presentationPages[slideIndex];
  const activeStep = activePage.kind === 'step' ? activePage.step : null;
  const stepOrdinal = activeStep ? pipelineSteps.indexOf(activeStep) + 1 : 0;
  const isQuerySlide = activePage.kind === 'query';
  const artifactKey = activeStep ? STAGE_KEYS[stepOrdinal] : null;
  const sourceArtifact = artifactKey && snapshot ? snapshot.sourceTrace[artifactKey] : undefined;
  const rejectedArtifact = snapshot?.artifacts.rejected;
  const rejectedSources = snapshot?.registry.statuses.rejected || snapshot?.registry.statuses.reject || 0;
  const metrics = useMemo(() => {
    if (!snapshot) return [];
    if (slideIndex === 0) return [
      { label: 'แหล่งในทะเบียน', value: formatCount(snapshot.registry.total), note: `${formatCount(rejectedSources)} รายการยังไม่อนุมัติ` },
      { label: 'อนุมัติแล้ว', value: formatCount(snapshot.registry.approved), note: 'ผ่านการคัดเลือกจากทะเบียน' },
      { label: 'มีผลลัพธ์ในชุดปัจจุบัน', value: formatCount(snapshot.registry.processed), note: 'นับจากไฟล์ accepted' },
      { label: 'ระเบียน LCI', value: formatCount(snapshot.database.exchangeRows), note: snapshot.database.ready ? 'ใน SQLite จริง' : 'ยังไม่มี SQLite' }
    ];
    if (isQuerySlide) return [
      { label: 'แถวจาก query', value: formatCount(snapshot.queryProof.rows.length), note: 'ผลจาก SQL จริง' },
      { label: 'ระเบียน LCI_EXCHANGE', value: formatCount(snapshot.database.exchangeRows), note: 'ฐานข้อมูลชุดปัจจุบัน' },
      { label: 'ตารางให้ query', value: formatCount(snapshot.database.tableCount), note: 'ใน sandbox snapshot' }
    ];
    const stepNo = stepOrdinal;
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
    const stage = snapshot.artifacts[artifactKey as keyof PresentationSnapshot['artifacts']];
    const items = [{ label: THAI_LABELS[artifactKey || ''] || 'ไฟล์ artifact', value: formatCount(stage.files), note: 'ไฟล์ในโฟลเดอร์ขั้นนี้' }];
    if (artifactKey !== 'raw') items.push({ label: 'จำนวนระเบียน', value: formatCount(stage.rows), note: 'นับจาก CSV จริง' });
    items.push({ label: 'source ที่ปรากฏ', value: formatCount(stage.sourceIds.length), note: 'ตรวจจากชื่อไฟล์ artifact' });
    if (stepNo === 6) items.push({ label: 'กักกันไว้', value: formatCount(rejectedArtifact?.rows), note: 'เก็บ error detail ใน ERR.csv' });
    return items;
  }, [snapshot, slideIndex, stepOrdinal, isQuerySlide, artifactKey, rejectedArtifact, rejectedSources]);

  return (
    <div
      className={`pipeline-presentation ${isFullscreen ? 'is-fullscreen' : ''} ${chromeVisible ? 'chrome-visible' : 'chrome-hidden'}`}
      onPointerMove={revealChrome}
      onPointerDown={revealChrome}
    >
      <div className="pp-deck">
        <main className="pp-main">
            <section className="pp-slide" aria-live="polite">
              <header className="pp-slide-header is-overview">
                <span className="pp-kicker">PIPELINE OVERVIEW · CN230</span>
                <button type="button" className="pp-exit-button pp-presentation-back" onClick={onExit} aria-label="ปิดการนำเสนอ" title="ปิดการนำเสนอ"><X size={16} /></button>
              </header>
              <div className={`pp-content-stage ${activePage.kind === 'overview' ? 'pp-slide-intro' : ''}`} key={slideIndex}>
              {activePage.kind === 'overview' ? (
                <>
                  <div className="pp-slide-content">
                    <div className="pp-hero-copy">
                      <h1>จากข้อมูลที่กระจัดกระจาย<br /><em>สู่ฐานข้อมูล LCI ที่ query ได้</em></h1>
                    </div>
                    <div className="pp-intro-flow">
                      <div className="pp-intro-flow-title"><span>THE PROCESS</span><strong>07 ขั้นตอน · 05 ช่วงการทำงานต่อเนื่อง</strong></div>
                      <div className="pp-intro-stages">
                        <article><span>01</span><strong>คัดเลือกแหล่งข้อมูล</strong><small>SOURCE REGISTRY → APPROVED</small></article>
                        <article><span>02–04</span><strong>เตรียมข้อมูล</strong><small>RAW → PARSED → STAGING</small></article>
                        <article><span>05</span><strong>แปลงเข้าสู่ LCI</strong><small>STAGING → LCI MAPPING</small></article>
                        <article><span>06</span><strong>ตรวจและแยกผล</strong><small>ACCEPTED ↔ REJECTED</small></article>
                        <article className="is-final"><span>07</span><strong>จัดเก็บและ query</strong><small>SQLITE → SQL QUERY</small></article>
                      </div>
                    </div>
                  </div>
                </>
              ) : activeStep ? (
                <>
                  <div className="pp-step-heading">
                    <div className="pp-big-step">{activeStep.stepNumber}</div>
                    <div><span className="pp-kicker">{activeStep.titleEn}</span><h1>{activeStep.titleTh}</h1><p>{activeStep.summary}</p></div>
                  </div>
                  {activePage.page === 'summary' ? (
                    <>
                      <div className="pp-metrics-row">
                        {metrics.map((metric) => <div className="pp-metric" key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong><span>{metric.note}</span></div>)}
                      </div>
                      <div className="pp-transformation">
                        <div className="pp-transform-card"><span>INPUT · สิ่งที่ขั้นนี้รับเข้า</span><ul>{activeStep.inputs.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></div>
                        <div className="pp-transform-arrow"><ArrowRight size={18} /></div>
                        <div className="pp-transform-card is-output"><span>OUTPUT · สิ่งที่ได้</span><ul>{activeStep.outputs.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul></div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="pp-detail-grid">
                        <section className="pp-detail-card pp-process-card"><div className="pp-card-title"><span>เบื้องหลังขั้นตอน</span><small>{activeStep.processingDetails.length} กิจกรรมหลัก</small></div><ol>{activeStep.processingDetails.map((detail, index) => <li key={detail}><i>{String(index + 1).padStart(2, '0')}</i><span>{detail}</span></li>)}</ol>{activeStep.sqlOrMathFormula && <div className="pp-formula">{activeStep.sqlOrMathFormula}</div>}</section>
                        <section className="pp-detail-card pp-evidence-card">
                          <div className="pp-card-title"><span>{stepOrdinal === 7 ? 'ตารางข้อมูลที่ pipeline สร้างจริง' : stepOrdinal === 1 ? 'ตัวอย่างจากทะเบียน source จริง' : 'ตัวอย่าง artifact ที่ได้ในขั้นนี้'}</span><span className="pp-evidence-dot"><i /> EVIDENCE</span></div>
                          {stepOrdinal === 7 ? <><DatabaseTableExample tables={snapshot?.database.tables || []} /><div className="pp-evidence-foot"><Table2 size={13} /> {formatCount(snapshot?.database.tableCount)} ตาราง · {formatCount(snapshot?.database.exchangeRows)} ระเบียน LCI_EXCHANGE</div></> : stepOrdinal === 1 ? <RegistryExample sources={snapshot?.registry.sourceExamples || []} total={snapshot?.registry.total || 0} /> : stepOrdinal === 6 ? <div className="pp-validation-samples"><SourceSample stage="accepted" artifact={snapshot?.sourceTrace.accepted} /><SourceSample stage="rejected" artifact={snapshot?.sourceTrace.rejected} /></div> : <SourceSample stage={artifactKey || ''} artifact={sourceArtifact} />}
                        </section>
                      </div>
                      <div className="pp-gates-row">
                        <section className="pp-gate-card"><span>QUALITY GATE · เกณฑ์ที่ต้องผ่าน</span>{activeStep.dataQualityChecks.slice(0, 3).map((check) => <div key={check}><CheckCircle2 size={14} />{check}</div>)}</section>
                        {stepOrdinal === 5 && <section className="pp-dependency-card"><Workflow size={16} /><span><b>Dependency และ grain ของข้อมูล</b> · ใช้ SRC-047 เป็น burden อ้างอิงก่อน map SRC-044/045/046; ข้อมูล SRC-044 ถูกรวมจากรายเดือนเป็น process-year/reference flow ({formatCount(snapshot?.sourceTrace.staging.rows)} → {formatCount(snapshot?.sourceTrace.mapping.rows)} แถว) จึงไม่ใช่การคัดลอกแถวต่อแถว</span></section>}
                        {stepOrdinal === 6 && <section className="pp-dependency-card is-warning"><CircleAlert size={16} /><span><b>การตีความผล:</b> ไม่ผ่านจะถูกเก็บใน rejected พร้อมเหตุผล ในตัวอย่าง SRC-044 ผ่าน {formatCount(snapshot?.sourceTrace.accepted.rows)} และกักกัน {formatCount(snapshot?.sourceTrace.rejected.rows)} แถว; รวมทั้งระบบกักกัน {formatCount(rejectedArtifact?.rows)} แถว</span></section>}
                      </div>
                      <div className="pp-source-line"><span>IMPLEMENTATION / SOURCE</span><code>{activeStep.provenanceSource}</code><span className="pp-updated">{snapshot?.updatedAt ? `artifact ล่าสุด ${new Date(snapshot.updatedAt).toLocaleString('th-TH')}` : 'ยังไม่มีเวลาปรับปรุง artifact'}</span></div>
                    </>
                  )}
                </>
              ) : isQuerySlide ? (
                <div className="pp-query-slide">
                  <div className="pp-query-slide-heading"><span className="pp-kicker">FINAL PROOF · REAL SQL, REAL PROJECT DATA</span><h1>ข้อมูลที่ผ่าน pipeline<br /><em>query ได้จริงในฐานข้อมูล</em></h1><p>ระบบอ่าน SQLite snapshot ใน sandbox แล้ว join ตาราง process, flow และ unit เพื่อแสดง LCI exchange ตัวอย่าง</p></div>
                  <div className="pp-overview-metrics pp-query-metrics">{metrics.map((metric) => <div className="pp-metric" key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong><span>{metric.note}</span></div>)}</div>
                  <div className="pp-query-proof-panel"><div className="pp-query-proof-heading"><span>EXECUTED SQL</span><span className="pp-evidence-dot"><i /> SELECT ONLY</span></div><code className="pp-sql-proof pp-sql-proof-large">{snapshot?.queryProof.sql || 'ฐานข้อมูลยังไม่พร้อมสำหรับ query'}</code><EvidenceTable columns={snapshot?.queryProof.columns || []} rows={snapshot?.queryProof.rows || []} /><div className="pp-evidence-foot"><Table2 size={14} /> อ่าน {formatCount(snapshot?.database.exchangeRows)} ระเบียนจาก {formatCount(snapshot?.database.tableCount)} ตาราง · สำเนาในหน่วยความจำเท่านั้น</div></div>
                </div>
              ) : null}
              </div>
            </section>

        </main>
      </div>
      <div className="pp-background-mark" aria-hidden="true">CN230</div>
    </div>
  );
};
