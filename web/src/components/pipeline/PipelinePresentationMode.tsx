import React, { useCallback, useEffect, useState } from 'react';
import { Table2, X } from 'lucide-react';
import { PipelineDataWalkthrough } from './PipelineDataWalkthrough';
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

export type PresentationSnapshot = {
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

type ProjectSourceRecord = {
  sourceId: string;
  title: string;
  publisher: string;
  status: string;
  notes?: string;
};

type ProjectSourceRegistry = {
  total: number;
  statusCounts: Record<string, number>;
  sources: ProjectSourceRecord[];
};

const SOURCE_STATUS_PREVIEW_PAGE_INDEX = 2;
const SOURCE_STATUS_FILLED_PAGE_INDEX = 3;

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

function SourceExampleGallery({ sources }: { sources: ProjectSourceRecord[] }) {
  const featuredIds = ['SRC-044', 'SRC-045', 'SRC-048', 'SRC-049', 'SRC-047', 'SRC-051', 'SRC-053', 'SRC-055'];
  const examples = featuredIds
    .map((sourceId) => sources.find((source) => source.sourceId === sourceId && source.status === 'approved'))
    .filter((source): source is ProjectSourceRecord => Boolean(source));

  return (
    <section className="pp-example-source-gallery" aria-label="ตัวอย่างแหล่งข้อมูลที่ใช้">
      <div className="pp-example-gallery-heading"><div><span>EXAMPLE SOURCE GALLERY</span><strong>ตัวอย่างแหล่งข้อมูลที่คัดเลือก</strong></div><small>{examples.length} ตัวอย่าง</small></div>
      <div className="pp-example-gallery-grid">
        {examples.map((source) => <article key={source.sourceId}>
          <span className="pp-example-source-id">{source.sourceId}</span>
          <strong>{source.title}</strong>
          <small>{source.publisher}</small>
        </article>)}
      </div>
    </section>
  );
}

function SourceRegistryExcelView({ sources, statusFilled = false }: { sources: ProjectSourceRecord[]; statusFilled?: boolean }) {
  const approved = sources.filter((source) => source.status === 'approved').slice(0, 3);
  const rejected = sources.filter((source) => source.status === 'rejected').slice(0, 3);
  const rows = [...approved, ...rejected].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  const [displayStatusFilled, setDisplayStatusFilled] = useState(statusFilled);
  const [statusAnimation, setStatusAnimation] = useState<'idle' | 'outro' | 'intro'>('idle');

  useEffect(() => {
    if (statusFilled === displayStatusFilled) return;
    setStatusAnimation('outro');
    let finishTimer = 0;
    const introTimer = window.setTimeout(() => {
      setDisplayStatusFilled(statusFilled);
      setStatusAnimation('intro');
      finishTimer = window.setTimeout(() => setStatusAnimation('idle'), 260);
    }, 260);
    return () => {
      window.clearTimeout(introTimer);
      if (finishTimer) window.clearTimeout(finishTimer);
    };
  }, [displayStatusFilled, statusFilled]);

  return (
    <section className="pp-example-source-gallery pp-excel-source-view" aria-label="ตัวอย่างทะเบียนแหล่งข้อมูลใน Excel">
      <div className="pp-example-gallery-heading"><div><span>EXCEL VIEW</span><strong>ทะเบียนแหล่งข้อมูล</strong></div><small>source_registry.xlsx · {rows.length} จาก {formatCount(sources.length)} แถว</small></div>
      <div className="pp-excel-sheet">
        <div className="pp-excel-sheet-bar"><span>source_registry.xlsx</span><span>ข้อมูลตัวอย่างจากไฟล์จริง</span></div>
        <div className="pp-table-scroll">
          <table className="pp-data-table pp-registry-table pp-excel-registry-table">
            <colgroup><col style={{ width: '11%' }} /><col style={{ width: '34%' }} /><col style={{ width: '43%' }} /><col style={{ width: '12%' }} /></colgroup>
            <thead><tr><th scope="col">SOURCE ID</th><th scope="col">ชื่อแหล่งข้อมูล</th><th scope="col">หน่วยงาน</th><th scope="col">สถานะ</th></tr></thead>
            <tbody>{rows.map((source, index) => (
              <tr key={source.sourceId}>
                <td>{source.sourceId}</td><td>{source.title || '—'}</td><td>{source.publisher || '—'}</td>
                <td className={`pp-excel-status-cell is-${statusAnimation}`}>
                  {displayStatusFilled
                    ? <span className={`pp-excel-status-value ${statusAnimation === 'intro' ? 'is-intro' : ''}`} style={{ animationDelay: `${index * 16}ms` }}><span className={`pp-status-pill ${source.status}`}>{source.status === 'approved' ? 'อนุมัติ' : 'คัดออก'}</span></span>
                    : <span className={`pp-excel-status-value ${statusAnimation === 'outro' ? 'is-outro' : ''}`} style={{ animationDelay: `${index * 16}ms` }}>N/A</span>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function SourceDiscoveryBalance({ registry, statusFilled = false, animateFound = false }: { registry: ProjectSourceRegistry; statusFilled?: boolean; animateFound?: boolean }) {
  const approved = registry.statusCounts.approved || 0;
  const rejected = registry.statusCounts.rejected || 0;
  const supporting = registry.statusCounts.supporting || 0;
  const [showStatusBreakdown, setShowStatusBreakdown] = useState(statusFilled);
  const [balanceAnimation, setBalanceAnimation] = useState<'idle' | 'outro' | 'intro'>('idle');
  const share = (count: number) => `${registry.total ? (count / registry.total) * 100 : 0}%`;

  useEffect(() => {
    if (statusFilled === showStatusBreakdown) return;
    setBalanceAnimation('outro');
    let finishTimer = 0;
    const introTimer = window.setTimeout(() => {
      setShowStatusBreakdown(statusFilled);
      setBalanceAnimation('intro');
      finishTimer = window.setTimeout(() => setBalanceAnimation('idle'), 260);
    }, 260);
    return () => {
      window.clearTimeout(introTimer);
      if (finishTimer) window.clearTimeout(finishTimer);
    };
  }, [showStatusBreakdown, statusFilled]);

  return (
    <section className="pp-source-balance is-single" aria-label={showStatusBreakdown ? 'สรุปสถานะแหล่งข้อมูล' : 'จำนวนแหล่งข้อมูลที่พบ'}>
      <div className="pp-source-balance-detail">
        <div className={`pp-source-balance-bar is-${balanceAnimation} ${animateFound && !showStatusBreakdown ? 'is-found-intro' : ''}`} aria-hidden="true">
          {showStatusBreakdown ? <>
            <i className="is-approved" style={{ width: share(approved), animationDelay: '0ms' }} />
            <i className="is-supporting" style={{ width: share(supporting), animationDelay: '35ms' }} />
            <i className="is-rejected" style={{ width: share(rejected), animationDelay: '70ms' }} />
          </> : <i className="is-found" />}
        </div>
        <div className={`pp-source-balance-legend ${showStatusBreakdown ? '' : 'is-single'} is-${balanceAnimation}`}>
          {showStatusBreakdown ? <>
            <div className="is-approved" style={{ animationDelay: '0ms' }}><i /><strong>{formatCount(approved)}</strong><span>APPROVED</span></div>
            {supporting > 0 && <div className="is-supporting" style={{ animationDelay: '35ms' }}><i /><strong>{formatCount(supporting)}</strong><span>SUPPORTING</span></div>}
            <div className="is-rejected" style={{ animationDelay: '70ms' }}><i /><strong>{formatCount(rejected)}</strong><span>REJECTED</span></div>
          </> : <div className="is-found"><i /><strong>{formatCount(registry.total)}</strong><span>แหล่งข้อมูลที่พบ</span></div>}
        </div>
      </div>
    </section>
  );
}

function SourceDiscoveryContent({ registry, view, statusFilled = false }: { registry: ProjectSourceRegistry; view: 'gallery' | 'excel'; statusFilled?: boolean }) {
  return view === 'gallery' ? <SourceExampleGallery sources={registry.sources} /> : <SourceRegistryExcelView sources={registry.sources} statusFilled={statusFilled} />;
}

export const PipelinePresentationMode: React.FC<{ onExit: () => void; runFinishedAt?: string | null }> = ({ onExit, runFinishedAt }) => {
  const { catalog } = useWebsiteData();
  const pipelineSteps = catalog!.data.pipelineSteps;
  const sourceDiscoveryStep = pipelineSteps[0];
  const presentationPages = [
    { kind: 'overview' as const, step: null, page: 'overview' as const },
    { kind: 'step' as const, step: sourceDiscoveryStep, page: 'summary' as const, isWorkingCopy: true },
    { kind: 'step' as const, step: sourceDiscoveryStep, page: 'summary' as const },
    { kind: 'step' as const, step: sourceDiscoveryStep, page: 'summary' as const, isStatusFilled: true },
    ...pipelineSteps.slice(1).flatMap((step, index) => index === 0 ? [
      { kind: 'step' as const, step, page: 'summary' as const, walkthroughPage: 'before' as const },
      { kind: 'step' as const, step, page: 'details' as const, walkthroughPage: 'after' as const }
    ] : [
      { kind: 'step' as const, step, page: 'summary' as const },
      { kind: 'step' as const, step, page: 'details' as const }
    ]),
    { kind: 'query' as const, step: null, page: 'query' as const }
  ];
  const lastSlideIndex = presentationPages.length - 1;
  const [snapshot, setSnapshot] = useState<PresentationSnapshot | null>(null);
  const [sourceRegistry, setSourceRegistry] = useState<ProjectSourceRegistry | null>(null);
  const [snapshotError, setSnapshotError] = useState('');
  const [loading, setLoading] = useState(true);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [slideIndex, setSlideIndex] = useState(0);
  const slideIndexRef = React.useRef(0);
  const [slideDirection, setSlideDirection] = useState<'forward' | 'backward'>('forward');
  const [transitionPhase, setTransitionPhase] = useState<'idle' | 'exit' | 'process' | 'enter'>('idle');
  const isTransitioningRef = React.useRef(false);
  const transitionTimerRef = React.useRef<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(() => document.fullscreenElement === document.documentElement);
  const [chromeVisible, setChromeVisible] = useState(true);
  const wasFullscreenRef = React.useRef(document.fullscreenElement === document.documentElement);
  const previousRunFinishedAt = React.useRef(runFinishedAt);
  const chromeTimerRef = React.useRef<number | null>(null);

  const transitionToSlide = useCallback((next: number | ((current: number) => number)) => {
    const previous = slideIndexRef.current;
    const nextIndex = typeof next === 'function' ? next(previous) : next;
    if (nextIndex === previous || isTransitioningRef.current) return;
    isTransitioningRef.current = true;
    const sameProcessPair = previous >= 4 && nextIndex >= 4 && previous < 17 && nextIndex < 17 && Math.floor((previous - 4) / 2) === Math.floor((nextIndex - 4) / 2);
    if (sameProcessPair || previous === SOURCE_STATUS_FILLED_PAGE_INDEX || nextIndex === SOURCE_STATUS_FILLED_PAGE_INDEX) {
      slideIndexRef.current = nextIndex;
      setSlideIndex(nextIndex);
      setTransitionPhase('idle');
      isTransitioningRef.current = false;
      return;
    }
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setSlideDirection(nextIndex > previous ? 'forward' : 'backward');
    if (reducedMotion) {
      slideIndexRef.current = nextIndex;
      setSlideIndex(nextIndex);
      isTransitioningRef.current = false;
      return;
    }
    setTransitionPhase('exit');
    transitionTimerRef.current = window.setTimeout(() => {
      slideIndexRef.current = nextIndex;
      setSlideIndex(nextIndex);
      setTransitionPhase('enter');
      transitionTimerRef.current = window.setTimeout(() => {
        setTransitionPhase('idle');
        isTransitioningRef.current = false;
        transitionTimerRef.current = null;
      }, 170);
    }, 70);
  }, []);

  useEffect(() => () => {
    if (transitionTimerRef.current !== null) window.clearTimeout(transitionTimerRef.current);
  }, []);

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
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}source_registry.json`, { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not load the source registry.');
        return response.json() as Promise<ProjectSourceRegistry>;
      })
      .then((registry) => { if (!cancelled) setSourceRegistry(registry); })
      .catch(() => { if (!cancelled) setSourceRegistry(null); });
    return () => { cancelled = true; };
  }, []);

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
      transitionToSlide(slideIndex + 1);
    }, 8500);
    return () => window.clearTimeout(timer);
  }, [playing, slideIndex, lastSlideIndex, transitionToSlide]);

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
      if (isTransitioningRef.current && ['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        return;
      }
      if (isFullscreen) {
        event.stopImmediatePropagation();
        if (!['ArrowLeft', 'ArrowRight', 'Escape'].includes(event.key)) {
          event.preventDefault();
          return;
        }
      }
      revealChrome();
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setPlaying(false);
        transitionToSlide((current) => Math.min(lastSlideIndex, current + 1));
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setPlaying(false);
        transitionToSlide((current) => Math.max(0, current - 1));
      } else if (event.key === 'Home') {
        event.preventDefault();
        setPlaying(false);
        transitionToSlide(0);
      } else if (event.key === 'End') {
        event.preventDefault();
        transitionToSlide(lastSlideIndex);
      } else if (event.code === 'Space' && !(event.target instanceof HTMLElement && ['BUTTON', 'INPUT', 'TEXTAREA'].includes(event.target.tagName))) {
        event.preventDefault();
        setPlaying((current) => !current);
      } else if (event.key === 'Escape') {
        if (document.fullscreenElement) void document.exitFullscreen();
        else onExit();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isFullscreen, lastSlideIndex, onExit, revealChrome, transitionToSlide]);

  const activePage = presentationPages[slideIndex];
  const activeStep = activePage.kind === 'step' ? activePage.step : null;
  const stepOrdinal = activeStep ? pipelineSteps.indexOf(activeStep) + 1 : 0;
  const isSourceSummaryPage = Boolean(activeStep && stepOrdinal === 1 && activePage.kind === 'step' && activePage.page === 'summary');
  const isSourceWorkingCopy = 'isWorkingCopy' in activePage && activePage.isWorkingCopy;
  const isSourceStatusFilled = 'isStatusFilled' in activePage && activePage.isStatusFilled;
  const isQuerySlide = activePage.kind === 'query';
  const activeProcessStep = activeStep ? stepOrdinal : isQuerySlide ? 7 : 0;
  const contentStageKey = slideIndex === SOURCE_STATUS_PREVIEW_PAGE_INDEX || slideIndex === SOURCE_STATUS_FILLED_PAGE_INDEX
    ? 'source-registry-status-table'
    : slideIndex >= 4 && slideIndex < presentationPages.length - 1 ? `process-${Math.floor((slideIndex - 4) / 2)}` : slideIndex;

  return (
    <div
      className={`pipeline-presentation is-going-${slideDirection} ${isFullscreen ? 'is-fullscreen' : ''} ${chromeVisible ? 'chrome-visible' : 'chrome-hidden'}`}
      onPointerMove={revealChrome}
      onPointerDown={revealChrome}
    >
      <div className="pp-deck">
        <main className="pp-main">
            <section className="pp-slide" aria-live="polite">
              <header className="pp-slide-header is-overview">
                <span className="pp-kicker">{activeStep ? `${activeStep.titleEn} · CN230` : isQuerySlide ? 'FINAL QUERY · CN230' : 'PIPELINE OVERVIEW · CN230'}</span>
                <button type="button" className="pp-exit-button pp-presentation-back" onClick={onExit} aria-label="ปิดการนำเสนอ" title="ปิดการนำเสนอ"><X size={16} /></button>
              </header>
              <div className={`pp-process-dock ${activePage.kind === 'overview' ? 'is-overview' : 'is-detail is-compact'}`}>
                <div className="pp-intro-flow">
                  <div className="pp-intro-flow-title"><span>THE PROCESS</span><strong>07 ขั้นตอน</strong></div>
                  <div className="pp-intro-stages">
                    {[
                      ['คัดเลือกแหล่ง', 'APPROVED'],
                      ['เก็บไฟล์ดิบ', 'RAW'],
                      ['อ่านและแยกตาราง', 'PARSED'],
                      ['จัดรูปและผูกที่มา', 'STAGED'],
                      ['แปลงเข้าสู่ LCI', 'MAPPING'],
                      ['ตรวจคุณภาพ', 'ACCEPT / REJECT'],
                      ['จัดเก็บและ query', 'SQL QUERY']
                    ].map(([title, output], index) => {
                      const startPageIndex = presentationPages.findIndex((page) => page.kind === 'step' && page.step === pipelineSteps[index] && page.page === 'summary');
                      return (
                        <article className={activeProcessStep === index + 1 ? 'is-active' : ''} key={title}>
                          <button
                            type="button"
                            className="pp-stage-node"
                            aria-label={`ไปยังขั้นตอน ${String(index + 1).padStart(2, '0')} ${title}`}
                            title={`ไปยังขั้นตอน ${String(index + 1).padStart(2, '0')}`}
                            onClick={() => {
                              if (startPageIndex < 0) return;
                              setPlaying(false);
                              transitionToSlide(startPageIndex);
                            }}
                          >{String(index + 1).padStart(2, '0')}</button>
                          <strong>{title}</strong><small>{output}</small>
                        </article>
                      );
                    })}
                  </div>
                </div>
              </div>
              {isSourceSummaryPage && <div className={`pp-source-summary-persistent ${isSourceWorkingCopy ? 'is-slide-up-intro' : ''}`}>
                <div className="pp-step-heading">
                  <div className="pp-big-step">{activeStep?.stepNumber}</div>
                  <div><h1>{activeStep?.titleTh}</h1></div>
                </div>
                {sourceRegistry && <SourceDiscoveryBalance registry={sourceRegistry} statusFilled={isSourceStatusFilled} animateFound={isSourceWorkingCopy} />}
              </div>}
              <div className={`pp-content-stage ${activePage.kind === 'overview' ? 'pp-slide-intro' : ''} ${isSourceWorkingCopy ? 'is-source-working-copy' : ''} ${stepOrdinal > 1 ? 'is-data-walkthrough' : ''} ${stepOrdinal === 5 ? 'is-mapping-step' : ''} ${stepOrdinal === 6 ? 'is-validation-step' : ''} ${stepOrdinal === 7 ? 'is-database-step' : ''} ${transitionPhase === 'exit' && !isSourceStatusFilled ? 'is-leaving' : ''} ${transitionPhase === 'process' ? 'is-waiting' : ''} ${transitionPhase === 'enter' && !isSourceStatusFilled ? 'is-entering' : ''}`} key={contentStageKey}>
              {activePage.kind === 'overview' ? (
                <>
                  <div className="pp-slide-content">
                    <div className="pp-hero-copy">
                      <h1>จากข้อมูลที่กระจัดกระจาย<br /><em>สู่ฐานข้อมูล LCI ที่ query ได้</em></h1>
                    </div>
                  </div>
                </>
              ) : activeStep ? (
                <>
                  {!isSourceSummaryPage && <div className="pp-step-heading">
                    <div className="pp-big-step">{activeStep.stepNumber}</div>
                    <div><h1>{activeStep.titleTh}</h1></div>
                  </div>}
                  {stepOrdinal === 1 ? (
                    sourceRegistry ? <SourceDiscoveryContent registry={sourceRegistry} view={isSourceWorkingCopy ? 'gallery' : 'excel'} statusFilled={isSourceStatusFilled} />
                    : <div className="pp-source-discovery-loading">กำลังโหลดทะเบียนแหล่งข้อมูล…</div>
                  ) : snapshot ? <PipelineDataWalkthrough step={stepOrdinal} after={'walkthroughPage' in activePage ? activePage.walkthroughPage === 'after' : activePage.page === 'details'} walkthroughPage={'walkthroughPage' in activePage ? activePage.walkthroughPage as 'flow' | 'before' | 'after' : undefined} snapshot={snapshot} />
                    : <div className="pp-source-discovery-loading">กำลังโหลดตัวอย่างข้อมูล…</div>}

                </>
              ) : isQuerySlide ? (
                <div className="pp-query-slide">
                  <div className="pp-query-slide-heading"><span className="pp-kicker">FINAL PROOF · REAL SQL, REAL PROJECT DATA</span><h1>ผล query จากฐานข้อมูล <em>LCI</em></h1></div>

                  <div className="pp-query-proof-panel"><div className="pp-query-proof-heading"><span>EXECUTED SQL</span><span className="pp-evidence-dot"><i /> SELECT ONLY</span></div><code className="pp-sql-proof pp-sql-proof-large">{snapshot?.queryProof.sql || 'ฐานข้อมูลยังไม่พร้อมสำหรับ query'}</code><EvidenceTable columns={snapshot?.queryProof.columns || []} rows={snapshot?.queryProof.rows || []} /><div className="pp-evidence-foot"><Table2 size={14} /> อ่าน {formatCount(snapshot?.database.exchangeRows)} ระเบียนจาก {formatCount(snapshot?.database.tableCount)} ตาราง</div></div>
                </div>
              ) : null}
              </div>
              <footer className="pp-slide-meta" style={{ justifyContent: 'center' }}>
                <span role="progressbar" aria-label="Presentation progress" aria-valuemin={1} aria-valuemax={presentationPages.length} aria-valuenow={slideIndex + 1}>
                  {presentationPages.map((_, index) => <span key={index} aria-hidden="true" style={{ display: 'inline-block', width: index === slideIndex ? 18 : 6, height: 6, marginInline: 2, borderRadius: 999, background: index === slideIndex ? '#5c713f' : '#c5c9c0', verticalAlign: 'middle', transition: 'width 240ms ease, background-color 240ms ease' }} />)}
                </span>
                <span className="pp-page-count">{String(slideIndex + 1).padStart(2, '0')} / {String(presentationPages.length).padStart(2, '0')}</span>
              </footer>
            </section>

        </main>
      </div>
      <div className="pp-background-mark" aria-hidden="true">CN230</div>
    </div>
  );
};
