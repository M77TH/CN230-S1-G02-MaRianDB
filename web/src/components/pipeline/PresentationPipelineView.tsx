import React, { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Circle, Clock3, Database, Download, Play, RotateCcw, ShieldCheck } from 'lucide-react';
import { useWebsiteData } from '../../data/websiteData';
import '../../styles/presentation-pipeline.css';

interface ArtifactFile {
  name: string;
  path: string;
  publicUrl: string;
  sizeBytes: number;
  modifiedAt: string;
  previewable: boolean;
}

interface ArtifactStage {
  key: string;
  phase: string;
  label: string;
  path: string;
  fileCount: number;
  updatedAt: string | null;
  files: ArtifactFile[];
}

interface AcceptedFile {
  sourceId: string;
  file: string;
  path: string;
  publicUrl: string;
  sha256: string;
  records: number;
  updatedAt: string;
}

interface PipelineDemoSnapshot {
  mode: string;
  snapshotGeneratedAt: string;
  notice: string;
  sourceIds: string[];
  acceptedRecordCount: number;
  acceptedFileCount: number;
  acceptedFiles: AcceptedFile[];
  upstreamObservationCount: number;
  registryCount: number;
  pipelineSummary: {
    registry: { approved: number; processed: number; missingApprovedSourceIds: string[] };
    database: { ready: boolean; tableCount: number; exchangeRows: number | null };
    updatedAt: string | null;
  };
  catalogArtifact: { path: string; sha256: string };
  stages: ArtifactStage[];
}

interface ReplayHistoryItem {
  id: string;
  completedAt: string;
  sourceIds: string[];
  recordCount: number;
}

interface PresenterState {
  selectedSourceIds: string[] | null;
  completedRuns: ReplayHistoryItem[];
}

const STORAGE_KEY = 'cn230.presentation.replay.v1';
const EMPTY_PRESENTER_STATE: PresenterState = { selectedSourceIds: null, completedRuns: [] };

function readPresenterState(): PresenterState {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY_PRESENTER_STATE;
    const value = JSON.parse(raw) as Partial<PresenterState>;
    return {
      selectedSourceIds: Array.isArray(value.selectedSourceIds) ? value.selectedSourceIds.filter((id): id is string => typeof id === 'string') : null,
      completedRuns: Array.isArray(value.completedRuns) ? value.completedRuns.slice(0, 8) : [],
    };
  } catch {
    return EMPTY_PRESENTER_STATE;
  }
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string | null): string {
  if (!value) return 'ไม่ระบุ';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
}

function shortHash(value: string): string {
  return value ? `${value.slice(0, 12)}…${value.slice(-8)}` : '—';
}

export const PresentationPipelineView: React.FC = () => {
  const { catalog } = useWebsiteData();
  const [snapshot, setSnapshot] = useState<PipelineDemoSnapshot | null>(null);
  const [loadError, setLoadError] = useState('');
  const [presenterState, setPresenterState] = useState<PresenterState>(readPresenterState);
  const [isReplaying, setIsReplaying] = useState(false);
  const [finishedRun, setFinishedRun] = useState<ReplayHistoryItem | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(-1);
  const [logs, setLogs] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch('/pipeline_demo.json', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load the saved presentation snapshot (${response.status}).`);
        return response.json() as Promise<PipelineDemoSnapshot>;
      })
      .then((value) => { if (!cancelled) { setSnapshot(value); setLoadError(''); } })
      .catch((error) => { if (!cancelled) setLoadError(error instanceof Error ? error.message : 'Could not load web/data/pipeline_demo.json.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presenterState)); } catch { /* Storage can be disabled by the browser. */ }
  }, [presenterState]);

  const steps = catalog?.data.pipelineSteps ?? [];
  const availableSourceIds = snapshot?.sourceIds ?? [];
  const selectedSourceIds = useMemo(() => {
    if (presenterState.selectedSourceIds === null) return availableSourceIds;
    return presenterState.selectedSourceIds.filter((sourceId) => availableSourceIds.includes(sourceId));
  }, [availableSourceIds, presenterState.selectedSourceIds]);
  const selectedFiles = useMemo(
    () => (snapshot?.acceptedFiles ?? []).filter((file) => selectedSourceIds.includes(file.sourceId)),
    [snapshot, selectedSourceIds]
  );
  const selectedRecordCount = selectedFiles.reduce((sum, file) => sum + file.records, 0);
  const outputFiles = useMemo(() => (snapshot?.stages ?? []).flatMap((stage) => stage.files
    .filter((file) => {
      const sourceMatch = file.name.match(/^(SRC-\d{3})_/i)?.[1]?.toUpperCase();
      return !sourceMatch || selectedSourceIds.includes(sourceMatch);
    })
    .map((file) => ({ ...file, stageLabel: stage.label }))), [snapshot, selectedSourceIds]);

  useEffect(() => {
    if (!isReplaying) return undefined;
    const timer = window.setTimeout(() => {
      const nextIndex = activeStepIndex + 1;
      if (nextIndex < steps.length) {
        const step = steps[nextIndex];
        setActiveStepIndex(nextIndex);
        setLogs((current) => [...current, `[${step.stepNumber}/${String(steps.length).padStart(2, '0')}] replayed saved result · ${step.titleEn}`]);
        return;
      }

      const completedAt = new Date().toISOString();
      const run: ReplayHistoryItem = {
        id: `REPLAY-${completedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}`,
        completedAt,
        sourceIds: selectedSourceIds,
        recordCount: selectedRecordCount,
      };
      setIsReplaying(false);
      setFinishedRun(run);
      setLogs((current) => [...current, `[DONE] displayed ${selectedRecordCount.toLocaleString()} saved accepted records · no extraction executed`]);
      setPresenterState((current) => ({ ...current, completedRuns: [run, ...current.completedRuns].slice(0, 8) }));
    }, activeStepIndex < 0 ? 350 : 650);
    return () => window.clearTimeout(timer);
  }, [activeStepIndex, isReplaying, selectedRecordCount, selectedSourceIds, steps]);

  const startReplay = () => {
    if (!snapshot || isReplaying || !selectedSourceIds.length) return;
    setFinishedRun(null);
    setActiveStepIndex(-1);
    setLogs([
      `[${new Date().toLocaleTimeString('th-TH')}] presentation replay started`,
      `[INFO] loading the checked-in snapshot generated ${formatDate(snapshot.snapshotGeneratedAt)}`,
      `[INFO] selected sources: ${selectedSourceIds.join(', ')}`,
      '[MODE] precomputed replay · source acquisition and pipeline execution are disabled',
    ]);
    setIsReplaying(true);
  };

  const toggleSource = (sourceId: string) => {
    setFinishedRun(null);
    setPresenterState((current) => {
      const currentSelection = current.selectedSourceIds ?? availableSourceIds;
      const next = currentSelection.includes(sourceId)
        ? currentSelection.filter((id) => id !== sourceId)
        : [...currentSelection, sourceId];
      return { ...current, selectedSourceIds: next };
    });
  };

  const resetBrowserState = () => {
    setPresenterState({ selectedSourceIds: availableSourceIds, completedRuns: [] });
    setFinishedRun(null);
    setIsReplaying(false);
    setActiveStepIndex(-1);
    setLogs([]);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Storage can be disabled by the browser. */ }
  };

  if (loadError) return <div className="pre-pipeline-state is-error" role="alert"><strong>Saved presentation data is unavailable</strong><span>{loadError}</span></div>;
  if (!snapshot || !catalog) return <div className="pre-pipeline-state" role="status"><strong>Loading saved pipeline results</strong><span>Reading the checked-in presentation snapshot from web/data/.</span></div>;

  return (
    <div className="pre-pipeline-view">
      <header className="pre-pipeline-header">
        <div>
          <span className="pre-pipeline-eyebrow"><Database size={14} /> CN230 · PIPELINE PRESENTATION</span>
          <h1>Replay the prepared pipeline run</h1>
          <p>Show the completed result and its artifact trail without fetching sources or running extraction during the presentation.</p>
        </div>
        <div className="pre-pipeline-actions">
          <button className="pre-pipeline-reset" type="button" onClick={resetBrowserState}><RotateCcw size={14} /> Reset this browser</button>
          <button className="pre-pipeline-run" type="button" onClick={startReplay} disabled={isReplaying || !selectedSourceIds.length}><Play size={15} fill="currentColor" /> {isReplaying ? 'Replaying saved run…' : 'Replay saved run'}</button>
        </div>
      </header>

      <div className="pre-pipeline-notice" role="note"><ShieldCheck size={17} /><div><strong>PRECOMPUTED PRESENTATION SNAPSHOT</strong><span>{snapshot.notice}</span></div></div>

      <section className="pre-pipeline-metrics" aria-label="Prepared result summary">
        <article><span>Selected sources</span><strong>{selectedSourceIds.length}</strong><small>of {availableSourceIds.length} with accepted LCI outputs</small></article>
        <article><span>Accepted records</span><strong>{selectedRecordCount.toLocaleString()}</strong><small>{selectedFiles.length} saved validation files</small></article>
        <article><span>Map observations</span><strong>{snapshot.upstreamObservationCount.toLocaleString()}</strong><small>latest staged upstream rows</small></article>
        <article><span>Source references</span><strong>{snapshot.registryCount.toLocaleString()}</strong><small>registered SRC sources</small></article>
      </section>

      <section className="pre-pipeline-card pre-pipeline-source-picker">
        <div className="pre-pipeline-section-title"><div><span>RUN CONFIGURATION</span><h2>Choose saved sources to replay</h2></div><small>Selection is stored in this browser only.</small></div>
        <div className="pre-pipeline-source-list">
          {availableSourceIds.map((sourceId) => {
            const file = snapshot.acceptedFiles.find((item) => item.sourceId === sourceId);
            return <label key={sourceId} className={selectedSourceIds.includes(sourceId) ? 'is-selected' : ''}>
              <input type="checkbox" checked={selectedSourceIds.includes(sourceId)} onChange={() => toggleSource(sourceId)} disabled={isReplaying} />
              <span><b>{sourceId}</b><small>{file?.records.toLocaleString() ?? 0} accepted rows · {file?.file ?? 'saved output'}</small></span>
              <ShieldCheck size={15} />
            </label>;
          })}
        </div>
      </section>

      <section className="pre-pipeline-card pre-pipeline-run-card">
        <div className="pre-pipeline-section-title"><div><span>RUN MONITOR</span><h2>{isReplaying ? 'Replaying saved stage results' : finishedRun ? 'Replay complete' : 'Prepared run is ready'}</h2></div><small><Clock3 size={13} /> Snapshot: {formatDate(snapshot.snapshotGeneratedAt)}</small></div>
        <div className="pre-pipeline-timeline">
          {steps.map((step, index) => {
            const done = finishedRun !== null || (isReplaying && index < activeStepIndex);
            const active = isReplaying && index === activeStepIndex;
            return <article className={`${done ? 'is-done' : ''} ${active ? 'is-active' : ''}`} key={step.id}>
              <span className="pre-pipeline-step-icon">{done ? <CheckCircle2 size={17} /> : active ? <Clock3 size={17} /> : <Circle size={16} />}</span>
              <span className="pre-pipeline-step-number">{step.stepNumber}</span>
              <div><strong>{step.titleEn}</strong><small>{step.summary}</small></div>
              <b>{done ? 'READY' : active ? 'REPLAY' : 'SAVED'}</b>
            </article>;
          })}
        </div>
        <div className="pre-pipeline-terminal" aria-live="polite"><div><i /><i /><i /><span>saved-run replay.log</span></div>{logs.length
          ? <pre>{logs.slice(-9).join('\n')}</pre>
          : <pre>[READY] {snapshot.acceptedFileCount} accepted files · {snapshot.acceptedRecordCount.toLocaleString()} saved records
[READY] {snapshot.stages.reduce((sum, stage) => sum + stage.files.length, 0)} processed artifacts available locally
[MODE] This is a replay of prepared outputs. No source request will be made.</pre>}
        </div>
        {finishedRun && <div className="pre-pipeline-complete"><CheckCircle2 size={16} /><span>Replay {finishedRun.id} completed for {finishedRun.sourceIds.length} selected sources. The displayed values are from the saved snapshot.</span></div>}
      </section>

      <section className="pre-pipeline-card pre-pipeline-output-card">
        <div className="pre-pipeline-section-title"><div><span>PREPARED ARTIFACTS</span><h2>Outputs included in web/data</h2></div><small>{outputFiles.length.toLocaleString()} files · catalog SHA-256 {shortHash(snapshot.catalogArtifact.sha256)}</small></div>
        <div className="pre-pipeline-artifact-list">
          {outputFiles.slice(0, 80).map((file) => <a href={file.publicUrl} download key={`${file.path}-${file.modifiedAt}`}>
            <span className="pre-artifact-stage">{file.stageLabel}</span><b>{file.name}</b><small>{formatBytes(file.sizeBytes)} · {formatDate(file.modifiedAt)}</small><Download size={14} />
          </a>)}
          {outputFiles.length === 0 && <p>No saved processed files match the selected sources.</p>}
        </div>
        <div className="pre-pipeline-attribution"><span>Prepared from project <code>data/</code></span><span>Snapshot package: <code>web/data/presentation_manifest.json</code></span><span>Last processed outputs: {formatDate(snapshot.pipelineSummary.updatedAt)}</span></div>
      </section>

      {presenterState.completedRuns.length > 0 && <section className="pre-pipeline-history"><strong>Saved in this browser</strong><span>{presenterState.completedRuns.length} replay{presenterState.completedRuns.length === 1 ? '' : 's'} · latest {formatDate(presenterState.completedRuns[0].completedAt)}</span></section>}
    </div>
  );
};
