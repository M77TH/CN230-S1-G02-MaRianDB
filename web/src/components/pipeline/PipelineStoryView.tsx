import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  Database,
  ExternalLink,
  File,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Files,
  FolderOpen,
  GitBranch,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Square,
  Table2,
  Terminal,
  X
} from 'lucide-react';
import { pipelineSteps } from '../../data/pipelineSteps';
import { PipelineStep } from '../../types/pipeline';
import { PipelinePresentationMode } from './PipelinePresentationMode';
import '../../styles/pipeline-workbench.css';

type WorkbenchTab = 'run' | 'steps' | 'query';
type DatabaseTarget = 'validated' | 'mart';
type RunStatus = 'starting' | 'running' | 'succeeded' | 'blocked' | 'failed';

interface WorkbenchHealth {
  ok: boolean;
  approvedSources: number;
  acceptedFiles: number;
  acceptedRecords: number;
  sqliteReady: boolean;
}

interface RunnerSource {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
}

interface PipelineRun {
  runId: string;
  status: RunStatus;
  sourceIds: string[];
  force: boolean;
  toDatabase: boolean;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
}

interface RunPoll extends PipelineRun {
  logs: string[];
  cursor: number;
}

interface QueryTable {
  name: string;
  columns: string[];
  rows: number;
}

interface QuerySchema {
  target: DatabaseTarget;
  label: string;
  tables: QueryTable[];
}

interface QueryResult {
  target: DatabaseTarget;
  columns: string[];
  rows: unknown[][];
  rowCount: number;
  truncated: boolean;
  durationMs: number;
  statementType?: 'query' | 'sandbox change';
  message?: string;
}

interface PipelineFile {
  name: string;
  relativePath: string;
  path: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  previewable: boolean;
}

interface PipelineFileStage {
  key: string;
  phase: string;
  label: string;
  path: string;
  fileCount: number;
  updatedAt: string | null;
  files: PipelineFile[];
}

interface PipelineFileIndex {
  stages: PipelineFileStage[];
  generatedAt: string;
}

interface PipelineFilePreview {
  path: string;
  format: 'csv' | 'xlsx' | 'jsonl';
  sheetNames: string[];
  activeSheet: string | null;
  columns: string[];
  rows: unknown[][];
  rowCountPreviewed: number;
  truncated: boolean;
}

interface SandboxSession {
  sessionId: string;
  target: DatabaseTarget;
  tableCount: number;
  sourceRows: number | null;
}

interface ApiError {
  error?: string;
}

const API_BASE = '/api';
const MAX_VISIBLE_LOGS = 1_500;

const INITIAL_VALIDATED_QUERY = `SELECT
  _source_id,
  flow_name,
  direction,
  COUNT(*) AS record_count,
  COUNT(DISTINCT process_name) AS process_count
FROM VALIDATED_RECORDS
GROUP BY _source_id, flow_name, direction
ORDER BY record_count DESC
LIMIT 50;`;

const QUERY_PRESETS: Record<DatabaseTarget, { label: string; description: string; sql: string }[]> = {
  validated: [
    {
      label: 'สรุปข้อมูลตามแหล่ง',
      description: 'นับระเบียนจริงในไฟล์ accepted แยกตามแหล่งและ flow',
      sql: INITIAL_VALIDATED_QUERY
    },
    {
      label: 'ดูระเบียนต้นน้ำ',
      description: 'แสดงข้อมูลจริงจาก SRC-044',
      sql: `SELECT
  record_id, year, process_name, flow_name,
  direction, amount, unit, _source_id
FROM VALIDATED_RECORDS
WHERE _source_id = 'SRC-044'
ORDER BY year DESC, record_id
LIMIT 50;`
    },
    {
      label: 'ตรวจรอบการดึงข้อมูล',
      description: 'ตรวจ batch และไฟล์ที่สร้างข้อมูล accepted',
      sql: `SELECT
  _source_id,
  _extraction_batch_id,
  _source_file,
  COUNT(*) AS record_count
FROM VALIDATED_RECORDS
GROUP BY _source_id, _extraction_batch_id, _source_file
ORDER BY _source_id
LIMIT 50;`
    }
  ],
  mart: [
    {
      label: 'ตัวอย่าง LCI Exchange',
      description: 'เชื่อม process, flow และ unit จาก SQLite จริง',
      sql: `SELECT
  p.process_name,
  f.flow_name,
  e.direction,
  e.amount,
  u.symbol,
  e.allocation
FROM LCI_EXCHANGE AS e
JOIN PROCESS AS p ON p.process_id = e.process_id
JOIN FLOW AS f ON f.flow_id = e.flow_id
JOIN UNIT AS u ON u.unit_id = e.unit_id
ORDER BY p.process_name, f.flow_name
LIMIT 50;`
    },
    {
      label: 'ที่มาและ batch',
      description: 'ไล่จาก exchange กลับไปยังแหล่งข้อมูลและรอบที่ดึง',
      sql: `SELECT
  e.exchange_id,
  f.flow_name,
  e.amount,
  u.symbol,
  s.source_id,
  s.title,
  b.extraction_time
FROM LCI_EXCHANGE AS e
JOIN FLOW AS f ON f.flow_id = e.flow_id
JOIN UNIT AS u ON u.unit_id = e.unit_id
JOIN REFERENCE AS r ON r.reference_id = e.reference_id
JOIN SOURCE AS s ON s.source_id = r.source_id
JOIN EXTRACTION_BATCH AS b ON b.batch_id = e.batch_id
ORDER BY e.exchange_id
LIMIT 50;`
    },
    {
      label: 'ผลตรวจคุณภาพ',
      description: 'สรุปสถานะกฎตรวจสอบใน QUALITY_CHECK',
      sql: `SELECT status, rule_name, COUNT(*) AS check_count
FROM QUALITY_CHECK
GROUP BY status, rule_name
ORDER BY status, rule_name;`
    }
  ]
};

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers }
  });
  const payload = await response.json().catch(() => ({} as ApiError));
  if (!response.ok) {
    throw new Error((payload as ApiError).error || `API request failed (${response.status})`);
  }
  return payload as T;
}

function getActiveStepNumber(logs: string[]): number {
  let activeStep = 0;
  const pattern = /\[STEP\s+(\d{2})\/(?:0[67])\]/g;
  logs.join('\n').replace(pattern, (_match, number: string) => {
    activeStep = Number(number);
    return _match;
  });
  return activeStep;
}

function getFailedStepNumber(logs: string[]): number {
  const text = logs.join('\n');
  if (/Step 07 ไม่สำเร็จ|STEP 07.*FAIL/i.test(text)) return 7;
  const match = text.match(/Step\s+(\d{2})[^\n]*(?:ล้มเหลว|Error|Offline)/i);
  return match ? Number(match[1]) : 0;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat('th-TH').format(value);
}

function formatDate(value?: string | null): string {
  if (!value) return 'ยังไม่มีข้อมูลวันที่';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return 'ไม่ทราบวันที่';
  return new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' }).format(parsed);
}

function formatFileSize(value: number): string {
  if (value < 1_024) return `${value} B`;
  if (value < 1_048_576) return `${(value / 1_024).toFixed(1)} KB`;
  return `${(value / 1_048_576).toFixed(1)} MB`;
}

function getSafeSourceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function snapshotExplorerFiles(stages: PipelineFileStage[]): Map<string, string> {
  return new Map(stages.flatMap((stage) => stage.files.map((file) => [file.path, `${file.sizeBytes}:${file.modifiedAt}`] as const)));
}

function StageStatusIcon({ state }: { state: 'waiting' | 'running' | 'complete' | 'failed' }) {
  if (state === 'complete') return <CheckCircle2 size={16} />;
  if (state === 'running') return <Loader2 size={16} className="pw-spin" />;
  if (state === 'failed') return <X size={16} />;
  return <Circle size={16} />;
}

export const PipelineStoryView: React.FC = () => {
  const [activeTab, setActiveTab] = useState<WorkbenchTab>('run');
  const [presentationMode, setPresentationMode] = useState(false);
  const [health, setHealth] = useState<WorkbenchHealth | null>(null);
  const healthRef = useRef<WorkbenchHealth | null>(null);
  const [apiError, setApiError] = useState('');
  const [sources, setSources] = useState<RunnerSource[]>([]);
  const [sourceSearch, setSourceSearch] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [forceRefresh, setForceRefresh] = useState(false);
  const [includeDatabase, setIncludeDatabase] = useState(true);
  const [run, setRun] = useState<PipelineRun | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const logCursorRef = useRef(0);
  const [runError, setRunError] = useState('');
  const [selectedStep, setSelectedStep] = useState<PipelineStep>(pipelineSteps[0]);
  const [explorerStages, setExplorerStages] = useState<PipelineFileStage[]>([]);
  const [explorerStageKey, setExplorerStageKey] = useState('mapping');
  const [explorerExpandedFolders, setExplorerExpandedFolders] = useState<Record<string, boolean>>({
    'web/data': true,
    'web/data/mapping': true,
    'web/data/database': false,
    'web/data/validation': false,
    'web/data/validation/accepted': false,
    'web/data/validation/rejected': false
  });
  const [explorerFile, setExplorerFile] = useState<PipelineFile | null>(null);
  const [explorerPreview, setExplorerPreview] = useState<PipelineFilePreview | null>(null);
  const [explorerSheet, setExplorerSheet] = useState('');
  const [explorerLoading, setExplorerLoading] = useState(false);
  const [explorerPreviewLoading, setExplorerPreviewLoading] = useState(false);
  const [explorerError, setExplorerError] = useState('');
  const [explorerPreviewError, setExplorerPreviewError] = useState('');
  const [explorerUpdatedAt, setExplorerUpdatedAt] = useState('');
  const [explorerRefreshKey, setExplorerRefreshKey] = useState(0);
  const explorerFileSnapshotRef = useRef<Map<string, string>>(new Map());
  const [demoDataResetting, setDemoDataResetting] = useState(false);
  const [demoDataResetMessage, setDemoDataResetMessage] = useState('');
  const [queryTarget, setQueryTarget] = useState<DatabaseTarget>('validated');
  const [sandboxSession, setSandboxSession] = useState<SandboxSession | null>(null);
  const sandboxSessionRef = useRef<SandboxSession | null>(null);
  const [sandboxResetting, setSandboxResetting] = useState(false);
  const [querySchema, setQuerySchema] = useState<QuerySchema | null>(null);
  const [schemaError, setSchemaError] = useState('');
  const [sql, setSql] = useState(INITIAL_VALIDATED_QUERY);
  const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
  const [queryError, setQueryError] = useState('');
  const [queryBusy, setQueryBusy] = useState(false);
  const [sourcesBusy, setSourcesBusy] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  const sandboxSessionId = sandboxSession?.sessionId;

  const refreshHealth = useCallback(async () => {
    try {
      const next = await apiRequest<WorkbenchHealth>('/health');
      if (!healthRef.current || (!healthRef.current.sqliteReady && next.sqliteReady)) {
        setQueryTarget(next.sqliteReady ? 'mart' : 'validated');
      }
      healthRef.current = next;
      setHealth(next);
      setApiError('');
      return next;
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'เชื่อมต่อ local API ไม่สำเร็จ');
      return null;
    }
  }, []);

  const loadSources = useCallback(async () => {
    setSourcesBusy(true);
    try {
      const result = await apiRequest<{ sources: RunnerSource[] }>('/sources');
      setSources(result.sources);
      setSelectedSourceIds((current) => {
        if (current.length) return current.filter((id) => result.sources.some((source) => source.sourceId === id));
        const upstreamDemoSources = ['SRC-044', 'SRC-045', 'SRC-046']
          .filter((id) => result.sources.some((source) => source.sourceId === id));
        return upstreamDemoSources.length ? upstreamDemoSources : result.sources.slice(0, 1).map((source) => source.sourceId);
      });
    } catch (error) {
      setApiError(error instanceof Error ? error.message : 'โหลดทะเบียนแหล่งข้อมูลไม่สำเร็จ');
    } finally {
      setSourcesBusy(false);
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    void loadSources();
  }, [refreshHealth, loadSources]);

  useEffect(() => {
    if (activeTab !== 'run') return;
    let cancelled = false;
    setExplorerLoading(true);
    setExplorerError('');
    apiRequest<PipelineFileIndex>('/pipeline/files')
      .then((result) => {
        if (cancelled) return;
        explorerFileSnapshotRef.current = snapshotExplorerFiles(result.stages);
        setExplorerStages(result.stages);
        setExplorerUpdatedAt(result.generatedAt);
        const currentFile = explorerFile
          ? result.stages.flatMap((stage) => stage.files).find((file) => file.path === explorerFile.path)
          : undefined;
        const preferredStage = result.stages.find((stage) => stage.key === 'mapping' && stage.files.some((file) => file.previewable))
          || result.stages.find((stage) => stage.files.some((file) => file.previewable))
          || result.stages.find((stage) => stage.files.length > 0);
        const preferredFile = currentFile
          || preferredStage?.files.find((file) => file.previewable)
          || preferredStage?.files[0]
          || null;
        setExplorerFile(preferredFile);
        setExplorerStageKey(currentFile
          ? result.stages.find((stage) => stage.files.some((file) => file.path === currentFile.path))?.key || preferredStage?.key || 'mapping'
          : preferredStage?.key || 'mapping');
      })
      .catch((error) => {
        if (!cancelled) setExplorerError(error instanceof Error ? error.message : 'โหลดไฟล์ pipeline ไม่สำเร็จ');
      })
      .finally(() => { if (!cancelled) setExplorerLoading(false); });
    return () => { cancelled = true; };
  }, [activeTab, run?.finishedAt, explorerFile?.path, explorerRefreshKey]);

  useEffect(() => {
    if (activeTab !== 'run' || (run?.status !== 'starting' && run?.status !== 'running')) return;
    let cancelled = false;
    let refreshing = false;
    const refreshArtifacts = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        const result = await apiRequest<PipelineFileIndex>('/pipeline/files');
        if (cancelled) return;
        const previousSnapshot = explorerFileSnapshotRef.current;
        const nextSnapshot = snapshotExplorerFiles(result.stages);
        const changedStages = result.stages.filter((stage) => stage.files.some((file) => previousSnapshot.get(file.path) !== nextSnapshot.get(file.path)));
        const changedFiles = changedStages.flatMap((stage) => stage.files.filter((file) => previousSnapshot.get(file.path) !== nextSnapshot.get(file.path)));
        explorerFileSnapshotRef.current = nextSnapshot;
        setExplorerStages(result.stages);
        setExplorerUpdatedAt(result.generatedAt);
        setExplorerError('');
        if (changedStages.length > 0) {
          setExplorerExpandedFolders((current) => ({ ...current, ...Object.fromEntries(changedStages.map((stage) => [stage.path, true])) }));
          if (explorerFile) {
            const refreshedFile = result.stages.flatMap((stage) => stage.files).find((file) => file.path === explorerFile.path);
            if (refreshedFile && previousSnapshot.get(refreshedFile.path) !== nextSnapshot.get(refreshedFile.path)) setExplorerFile(refreshedFile);
          } else {
            const newPreviewableFile = changedFiles
              .filter((file) => file.previewable)
              .sort((left, right) => right.modifiedAt.localeCompare(left.modifiedAt))[0];
            if (newPreviewableFile) {
              const stage = result.stages.find((item) => item.files.some((file) => file.path === newPreviewableFile.path));
              setExplorerFile(newPreviewableFile);
              if (stage) setExplorerStageKey(stage.key);
            }
          }
        }
      } catch (error) {
        if (!cancelled) setExplorerError(error instanceof Error ? error.message : 'ติดตามไฟล์ pipeline ไม่สำเร็จ');
      } finally {
        refreshing = false;
      }
    };
    const interval = window.setInterval(() => void refreshArtifacts(), 750);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [activeTab, run?.status, explorerFile?.path]);

  useEffect(() => {
    if (!explorerFile?.previewable) {
      setExplorerPreview(null);
      setExplorerPreviewError('');
      setExplorerPreviewLoading(false);
      return;
    }
    let cancelled = false;
    const params = new URLSearchParams({ stage: explorerStageKey, name: explorerFile.relativePath });
    if (explorerSheet) params.set('sheet', explorerSheet);
    setExplorerPreview(null);
    setExplorerPreviewError('');
    setExplorerPreviewLoading(true);
    apiRequest<PipelineFilePreview>(`/pipeline/files/preview?${params.toString()}`)
      .then((preview) => { if (!cancelled) setExplorerPreview(preview); })
      .catch((error) => {
        if (!cancelled) setExplorerPreviewError(error instanceof Error ? error.message : 'เปิดตัวอย่างไฟล์ไม่สำเร็จ');
      })
      .finally(() => { if (!cancelled) setExplorerPreviewLoading(false); });
    return () => { cancelled = true; };
  }, [explorerFile?.path, explorerFile?.relativePath, explorerFile?.previewable, explorerFile?.modifiedAt, explorerFile?.sizeBytes, explorerStageKey, explorerSheet]);

  useEffect(() => {
    if (activeTab !== 'query') {
      setQuerySchema(null);
      return;
    }
    if (!sandboxSessionId) {
      setQuerySchema(null);
      setSchemaError('ยังไม่มีข้อมูลใน web/data · รัน pipeline เพื่อสร้าง snapshot');
      return;
    }
    let cancelled = false;
    setQuerySchema(null);
    setSchemaError('');
    apiRequest<QuerySchema>(`/database/sandbox/schema?sessionId=${sandboxSessionId}`)
      .then((schema) => {
        if (!cancelled) setQuerySchema(schema);
      })
      .catch((error) => {
        if (!cancelled) {
          setQuerySchema(null);
          setSchemaError(error instanceof Error ? error.message : 'โหลดโครงสร้างฐานข้อมูลไม่สำเร็จ');
        }
      });
    return () => { cancelled = true; };
  }, [activeTab, sandboxSessionId]);

  useEffect(() => {
    if (activeTab !== 'query' || sandboxSessionRef.current?.target === queryTarget) return;
    let cancelled = false;
    const previousSessionId = sandboxSessionRef.current?.sessionId;
    sandboxSessionRef.current = null;
    setSandboxSession(null);
    setSandboxResetting(true);
    setQueryError('');
    apiRequest<SandboxSession>('/database/sandbox/reset', {
      method: 'POST',
      body: JSON.stringify({ target: queryTarget, sessionId: previousSessionId })
    })
      .then((session) => {
        if (!cancelled) {
          sandboxSessionRef.current = session;
          setSandboxSession(session);
          setQueryResult(null);
        }
      })
      .catch((error) => {
        if (!cancelled) setQueryError(error instanceof Error ? error.message : 'เริ่ม sandbox ไม่สำเร็จ');
      })
      .finally(() => { if (!cancelled) setSandboxResetting(false); });
    return () => { cancelled = true; };
  }, [activeTab, queryTarget]);

  useEffect(() => {
    if (activeTab !== 'query') return;
    setSql(QUERY_PRESETS[queryTarget][0].sql);
    setQueryResult(null);
    setQueryError('');
  }, [queryTarget, activeTab]);

  useEffect(() => {
    if (!run || (run.status !== 'starting' && run.status !== 'running')) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const next = await apiRequest<RunPoll>(`/pipeline/runs/${run.runId}?cursor=${logCursorRef.current}`);
        if (cancelled) return;
        logCursorRef.current = next.cursor;
        setLogs((current) => [...current, ...next.logs].slice(-MAX_VISIBLE_LOGS));
        setRun({
          runId: next.runId,
          status: next.status,
          sourceIds: next.sourceIds,
          force: next.force,
          toDatabase: next.toDatabase,
          exitCode: next.exitCode,
          startedAt: next.startedAt,
          finishedAt: next.finishedAt
        });
        if (next.finishedAt) void refreshHealth();
      } catch (error) {
        if (!cancelled) setRunError(error instanceof Error ? error.message : 'ติดตามสถานะ run ไม่สำเร็จ');
      }
    };
    void poll();
    const interval = window.setInterval(() => void poll(), 400);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [run?.runId, run?.status, refreshHealth]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal) terminal.scrollTop = terminal.scrollHeight;
  }, [logs]);

  const activeRun = run?.status === 'starting' || run?.status === 'running';
  const filteredSources = useMemo(() => {
    const query = sourceSearch.trim().toLocaleLowerCase();
    if (!query) return sources;
    return sources.filter((source) =>
      `${source.sourceId} ${source.title} ${source.publisher}`.toLocaleLowerCase().includes(query)
    );
  }, [sourceSearch, sources]);

  const activeExplorerStage = explorerStages.find((stage) => stage.key === explorerStageKey) || null;
  const allVisibleSelected = filteredSources.length > 0 && filteredSources.every((source) => selectedSourceIds.includes(source.sourceId));
  const runText = logs.join('\n');
  const activeStage = getActiveStepNumber(logs);
  const failedStage = getFailedStepNumber(logs);
  const allocationBlock = run?.status === 'blocked'
    ? logs.find((line) => line.includes('[BLOCKED]'))?.replace(/^.*?\[BLOCKED\]\s*/, '')
    : undefined;

  const handleStartRun = async () => {
    if (!selectedSourceIds.length) {
      setRunError('เลือกแหล่งข้อมูลอย่างน้อย 1 รายการก่อนเริ่ม run');
      return;
    }
    setRunError('');
    setLogs([]);
    logCursorRef.current = 0;
    try {
      const started = await apiRequest<PipelineRun>('/pipeline/run', {
        method: 'POST',
        body: JSON.stringify({ sourceIds: selectedSourceIds, force: forceRefresh, toDatabase: includeDatabase })
      });
      setRun(started);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'เริ่ม pipeline ไม่สำเร็จ');
    }
  };

  const handleCancelRun = async () => {
    if (!run) return;
    try {
      await apiRequest(`/pipeline/runs/${run.runId}/cancel`, { method: 'POST', body: '{}' });
      setRunError('ส่งคำขอหยุด pipeline แล้ว');
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'หยุด pipeline ไม่สำเร็จ');
    }
  };

  const toggleSource = (sourceId: string) => {
    setSelectedSourceIds((current) => current.includes(sourceId)
      ? current.filter((id) => id !== sourceId)
      : [...current, sourceId].sort());
  };

  const toggleVisibleSources = () => {
    const visibleIds = filteredSources.map((source) => source.sourceId);
    setSelectedSourceIds((current) => allVisibleSelected
      ? current.filter((id) => !visibleIds.includes(id))
      : Array.from(new Set([...current, ...visibleIds])).sort());
  };

  const toggleExplorerFolder = (path: string) => {
    setExplorerExpandedFolders((current) => ({ ...current, [path]: !(current[path] ?? false) }));
  };

  const selectExplorerStage = (stage: PipelineFileStage, files = stage.files) => {
    const isOpen = explorerExpandedFolders[stage.path] ?? false;
    setExplorerExpandedFolders((current) => ({ ...current, [stage.path]: !isOpen }));
    setExplorerStageKey(stage.key);
    setExplorerFile(files.find((file) => file.previewable) || files[0] || null);
    setExplorerSheet('');
    if (stage.key === 'database') {
      const nextExpanded = !isOpen;
      const folders = Array.from(new Set(stage.files.filter((file) => file.relativePath.includes('/')).map((file) => file.relativePath.split('/')[0])));
      setExplorerExpandedFolders((current) => {
        const next = { ...current, [stage.path]: nextExpanded };
        folders.forEach((folder) => { next[`${stage.path}/${folder}`] = nextExpanded; });
        return next;
      });
    }
  };

  const selectExplorerSubfolder = (stage: PipelineFileStage, folder: string, files: PipelineFile[]) => {
    const path = `${stage.path}/${folder}`;
    toggleExplorerFolder(path);
    setExplorerStageKey(stage.key);
    setExplorerFile(files.find((file) => file.previewable) || files[0] || null);
    setExplorerSheet('');
  };

  const explorerStageFor = (key: string) => explorerStages.find((stage) => stage.key === key);
  const databaseStage = explorerStageFor('database');
  const mappingStage = explorerStageFor('mapping');
  const parsedStage = explorerStageFor('parsed');
  const rawStage = explorerStageFor('raw');
  const stagingStage = explorerStageFor('staging');
  const acceptedStage = explorerStageFor('accepted');
  const rejectedStage = explorerStageFor('rejected');
  const databaseFolderNames = Array.from(new Set(databaseStage?.files.filter((file) => file.relativePath.includes('/')).map((file) => file.relativePath.split('/')[0]) || [])).sort();
  const validationFileCount = (acceptedStage?.fileCount || 0) + (rejectedStage?.fileCount || 0);

  const renderExplorerFileRow = (stage: PipelineFileStage, file: PipelineFile, depth: number) => (
    <button key={file.path} type="button" className={`pw-vscode-file ${explorerFile?.path === file.path ? 'is-selected' : ''}`} style={{ paddingLeft: `${depth * 12}px` }} onClick={() => { setExplorerStageKey(stage.key); selectExplorerFile(file); }} aria-pressed={explorerFile?.path === file.path}>
      {file.extension === 'jsonl' ? <FileCode2 size={13} /> : file.previewable ? <FileSpreadsheet size={13} /> : file.extension === 'pdf' ? <FileText size={13} /> : <File size={13} />}
      <span><strong title={file.name}>{file.name}</strong><small><CalendarDays size={9} />{formatDate(file.modifiedAt)}</small></span><em>{formatFileSize(file.sizeBytes)}</em>
    </button>
  );

  const renderExplorerStageFolder = (stage: PipelineFileStage, label = stage.path.split('/').pop() || stage.key, depth = 1) => {
    const isExpanded = explorerExpandedFolders[stage.path] ?? false;
    return (
      <React.Fragment key={stage.key}>
        <button type="button" className={`pw-vscode-folder ${explorerStageKey === stage.key ? 'is-selected' : ''}`} style={{ paddingLeft: `${depth * 12}px` }} onClick={() => selectExplorerStage(stage)} aria-pressed={explorerStageKey === stage.key} aria-expanded={isExpanded}>
          <ChevronRight size={11} className={isExpanded ? 'is-expanded' : ''} /><FolderOpen size={13} />
          <span><strong>{label}</strong><small>{formatCount(stage.fileCount)} files</small></span>
        </button>
        {isExpanded && stage.files.filter((file) => !file.relativePath.includes('/')).map((file) => renderExplorerFileRow(stage, file, depth + 1))}
      </React.Fragment>
    );
  };

  const selectExplorerFile = (file: PipelineFile) => {
    setExplorerFile(file);
    setExplorerSheet('');
  };

  const handleRunQuery = async () => {
    if (!sandboxSession) {
      setQueryError('sandbox กำลังเตรียม snapshot กรุณารอสักครู่');
      return;
    }
    setQueryBusy(true);
    setQueryError('');
    setQueryResult(null);
    try {
      const result = await apiRequest<QueryResult>('/database/sandbox/query', {
        method: 'POST',
        body: JSON.stringify({ sql, sessionId: sandboxSession.sessionId })
      });
      setQueryResult(result);
      if (result.statementType === 'sandbox change') {
        const schema = await apiRequest<QuerySchema>(`/database/sandbox/schema?sessionId=${sandboxSession.sessionId}`);
        setQuerySchema(schema);
        setSchemaError('');
      }
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : 'query ไม่สำเร็จ');
    } finally {
      setQueryBusy(false);
    }
  };

  const handleResetSandbox = () => {
    setSandboxResetting(true);
    setQueryResult(null);
    setQueryError('');
    apiRequest<SandboxSession>('/database/sandbox/reset', {
      method: 'POST',
      body: JSON.stringify({ target: queryTarget, sessionId: sandboxSessionRef.current?.sessionId })
    })
      .then((session) => {
        sandboxSessionRef.current = session;
        setSandboxSession(session);
        setSql(QUERY_PRESETS[queryTarget][0].sql);
      })
      .catch((error) => setQueryError(error instanceof Error ? error.message : 'รีเซ็ต sandbox ไม่สำเร็จ'))
      .finally(() => setSandboxResetting(false));
  };

  const handleResetWebDemoData = async () => {
    setDemoDataResetting(true);
    setDemoDataResetMessage('');
    setExplorerError('');
    try {
      await apiRequest<{ dataPath: string; deletedFiles: number; deletedDirectories: number; message: string }>('/pipeline/demo/reset', {
        method: 'POST',
        body: JSON.stringify({})
      });
      setExplorerFile(null);
      setExplorerPreview(null);
      setExplorerSheet('');
      setExplorerStageKey('mapping');
      setExplorerExpandedFolders({ 'web/data': true, 'web/data/mapping': true });
      setExplorerUpdatedAt('');
      setExplorerRefreshKey((current) => current + 1);
      sandboxSessionRef.current = null;
      setSandboxSession(null);
      setQuerySchema(null);
      setSchemaError('');
      setQueryTarget('validated');
      setSql(INITIAL_VALIDATED_QUERY);
      setQueryResult(null);
      setQueryError('');
      await refreshHealth();
      setDemoDataResetMessage('ล้าง web/data แล้ว · root data ยังเดิม · รัน pipeline เพื่อสร้างข้อมูล demo ใหม่');
    } catch (error) {
      setExplorerError(error instanceof Error ? error.message : 'รีเซ็ตข้อมูล web demo ไม่สำเร็จ');
    } finally {
      setDemoDataResetting(false);
    }
  };

  const selectTab = (tab: WorkbenchTab) => setActiveTab(tab);

  const enterPresentation = () => {
    setPresentationMode(true);
    document.documentElement.classList.add('cn230-presentation-fullscreen');
    if (document.fullscreenEnabled && !document.fullscreenElement) {
      void document.documentElement.requestFullscreen().catch(() => undefined);
    }
  };

  const exitPresentation = () => {
    setPresentationMode(false);
    setActiveTab('run');
    document.documentElement.classList.remove('cn230-presentation-fullscreen');
    if (document.fullscreenElement) void document.exitFullscreen();
  };

  const stageState = (stepNumber: number): 'waiting' | 'running' | 'complete' | 'failed' => {
    if (!run) return 'waiting';
    if (run.status === 'blocked') return stepNumber < 5 ? 'complete' : 'waiting';
    if (stepNumber === 7 && !run.toDatabase) return 'waiting';
    const hasLogFailure = /\[FAIL\]|STATUS: FAILED|ไม่สำเร็จ|ล้มเหลว/.test(runText);
    const hasPipelineFailure = run.status === 'failed' || hasLogFailure;
    const failedAt = failedStage || activeStage;
    if ((run.status === 'succeeded' || run.status === 'failed') && !hasPipelineFailure) return 'complete';
    if (hasPipelineFailure && stepNumber === failedAt) return 'failed';
    if (activeStage && stepNumber < activeStage) return 'complete';
    if (activeStage && stepNumber === activeStage && activeRun) return 'running';
    if (run.status === 'succeeded' && !hasPipelineFailure) return 'complete';
    return 'waiting';
  };

  const tabs: { id: WorkbenchTab; number: string; title: string; subtitle: string; icon: React.ReactNode }[] = [
    { id: 'run', number: '01', title: 'รัน pipeline จริง', subtitle: 'เลือก source แล้วติดตาม log', icon: <Play size={16} /> },
    { id: 'steps', number: '02', title: 'อธิบายแต่ละขั้น', subtitle: 'inputs · processing · outputs', icon: <BookOpen size={16} /> },
    { id: 'query', number: '03', title: 'ทดลอง query', subtitle: 'SQL sandbox · reset ได้', icon: <FileCode2 size={16} /> }
  ];

  if (presentationMode) {
    return <PipelinePresentationMode onExit={exitPresentation} runFinishedAt={run?.finishedAt} />;
  }

  return (
    <div className="pipeline-view pipeline-workbench">
      <main className="pw-scroll-area">
        <div className="pw-content">
          <header className="pw-heading">
            <div className="pw-heading-copy">
              <span className="pw-eyebrow"><span className="pw-eyebrow-dot" /> CN230 · DATA ENGINEERING LAB</span>
              <h1>Pipeline Workbench</h1>
              <p>รันกระบวนการจริง อธิบายทุกขั้นตอน และทดลอง query กับข้อมูลของโครงการ</p>
            </div>
            <div className="pw-heading-actions">
              <div className={`pw-api-status ${apiError ? 'is-offline' : health ? 'is-online' : ''}`} role="status" aria-live="polite">
                <span className="pw-status-indicator" />
                <span>{apiError ? 'LOCAL API OFFLINE' : health ? 'LOCAL PIPELINE READY' : 'CONNECTING'}</span>
              </div>
            </div>
          </header>

          <nav className="pw-tabs" aria-label="เครื่องมือ pipeline" role="tablist">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                id={`pw-tab-${tab.id}`}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`pw-panel-${tab.id}`}
                className={`pw-tab ${activeTab === tab.id ? 'is-active' : ''}`}
                onClick={() => selectTab(tab.id)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
                  event.preventDefault();
                  const currentIndex = tabs.findIndex((item) => item.id === tab.id);
                  const offset = event.key === 'ArrowRight' ? 1 : -1;
                  const nextTab = tabs[(currentIndex + offset + tabs.length) % tabs.length];
                  setActiveTab(nextTab.id);
                  document.getElementById(`pw-tab-${nextTab.id}`)?.focus();
                }}
              >
                <span className="pw-tab-icon">{tab.icon}</span>
                <span className="pw-tab-index">{tab.number}</span>
                <span className="pw-tab-copy"><strong>{tab.title}</strong><small>{tab.subtitle}</small></span>
                <ChevronRight size={15} className="pw-tab-arrow" />
              </button>
            ))}
          </nav>

          {apiError && (
            <div className="pw-api-alert" role="status">
              <Server size={16} />
              <div><strong>ยังเชื่อมต่อ local pipeline API ไม่ได้</strong><span>{apiError} · รีสตาร์ต `npm run dev` เพื่อเปิด API สำหรับรัน pipeline และ query</span></div>
            </div>
          )}

          {activeTab === 'run' && (
            <section id="pw-panel-run" className="pw-panel pw-run-panel" role="tabpanel" aria-labelledby="pw-tab-run">
              <div className="pw-panel-heading">
                <div><span className="pw-section-kicker">LIVE EXECUTION</span><h2>รัน pipeline ใน website sandbox</h2><p>เรียก `run_pipeline.py` ให้เขียนผลลง `web/data/` · รันจาก terminal ยังใช้ root `data/`</p></div>
                <div className="pw-explorer-heading-actions pw-run-header-actions">
                  <button type="button" onClick={handleResetWebDemoData} disabled={demoDataResetting || explorerLoading || explorerPreviewLoading || activeRun} title="ล้างเฉพาะ web/data โดยไม่แตะ root data"><RotateCcw size={13} className={demoDataResetting ? 'pw-spin' : ''} /> {demoDataResetting ? 'กำลัง reset…' : 'Reset demo data'}</button>
                  <button type="button" onClick={() => setExplorerRefreshKey((current) => current + 1)} disabled={explorerLoading || demoDataResetting} title="รีเฟรชรายการไฟล์"><RefreshCw size={13} className={explorerLoading ? 'pw-spin' : ''} /> รีเฟรช</button>
                </div>
              </div>

              <div className="pw-run-grid">
                <section className="pw-control-card" aria-label="ตั้งค่าการรัน">
                  <div className="pw-card-heading"><div><strong>เลือก source</strong><small>ใช้ทะเบียน approved ของโปรเจกต์</small></div><span className="pw-selection-count">{selectedSourceIds.length} เลือก</span></div>
                  <div className="pw-source-toolbar">
                    <label className="pw-source-search"><Search size={14} /><input aria-label="ค้นหา source หรือหน่วยงาน" value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="ค้นหา source หรือหน่วยงาน" /></label>
                    <button type="button" className="pw-text-button" onClick={toggleVisibleSources}>{allVisibleSelected ? 'ยกเลิกที่แสดง' : 'เลือกที่แสดง'}</button>
                  </div>
                  <div className="pw-source-list">
                    {sourcesBusy && <div className="pw-empty-inline"><Loader2 size={15} className="pw-spin" /> กำลังโหลดทะเบียน…</div>}
                    {!sourcesBusy && filteredSources.length === 0 && <div className="pw-empty-inline">ไม่พบแหล่งข้อมูลที่ค้นหา</div>}
                    {filteredSources.map((source) => {
                      const checked = selectedSourceIds.includes(source.sourceId);
                      const sourceUrl = getSafeSourceUrl(source.url);
                      return (
                        <div key={source.sourceId} className={`pw-source-option ${checked ? 'is-selected' : ''}`}>
                          <input id={`source-select-${source.sourceId}`} type="checkbox" checked={checked} onChange={() => toggleSource(source.sourceId)} />
                          <label htmlFor={`source-select-${source.sourceId}`} className="pw-source-option-label">
                            <span className="pw-source-check">{checked && <Check size={12} />}</span>
                            <span className="pw-source-copy"><strong>{source.sourceId} <em>{source.title}</em></strong><small>{source.publisher}</small></span>
                          </label>
                          {sourceUrl ? (
                            <a className="pw-source-open-link" href={sourceUrl} target="_blank" rel="noopener noreferrer" aria-label={`เปิดแหล่งข้อมูลจริง ${source.sourceId} ในแท็บใหม่`} title="เปิดแหล่งข้อมูลจริงในแท็บใหม่">
                              <ExternalLink size={14} />
                            </a>
                          ) : (
                            <span className="pw-source-open-link is-disabled" aria-disabled="true" title="ไม่มี URL ต้นทางที่เปิดได้">
                              <ExternalLink size={14} />
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <p className="pw-allocation-note">Allocation ต้นน้ำใช้ SRC-044–047 · ผลคำนวณเป็นค่าประมาณสำหรับเดโมโดยใช้ PTTEP เป็นตัวแทน</p>
                  <div className="pw-run-options">
                    <label><input type="checkbox" checked={forceRefresh} onChange={(event) => setForceRefresh(event.target.checked)} /><span><strong>ดึงไฟล์ต้นฉบับใหม่</strong><small>ปิดไว้จะใช้ไฟล์เดิมหรือโหลดเมื่อยังไม่มี · เปิด `--force` เพื่อดาวน์โหลดทับใหม่</small></span></label>
                    <label><input type="checkbox" checked={includeDatabase} onChange={(event) => setIncludeDatabase(event.target.checked)} /><span><strong>สร้างฐานข้อมูลปลายทาง</strong><small>ส่งออก CSV / XLSX / SQLite เมื่อ validation ผ่าน</small></span></label>
                  </div>

                  <div className="pw-run-actions">
                  <button type="button" className="pw-run-button" onClick={handleStartRun} disabled={!health || !!apiError || activeRun || demoDataResetting || selectedSourceIds.length === 0}>
                      {activeRun ? <Loader2 size={16} className="pw-spin" /> : <Play size={15} fill="currentColor" />}
                      {activeRun ? 'กำลังรัน pipeline…' : 'เริ่มรัน pipeline'}
                    </button>
                    {activeRun && <button type="button" className="pw-stop-button" onClick={handleCancelRun}><Square size={13} fill="currentColor" /> หยุด</button>}
                  </div>
                  {runError && <div className="pw-inline-error" role="status">{runError}</div>}
                </section>

                <section className="pw-monitor-card" aria-label="ความคืบหน้า pipeline">
                  <div className="pw-card-heading pw-monitor-heading"><div><strong>ความคืบหน้าของรอบนี้</strong><small>{run ? `${run.sourceIds.join(', ')} · ${run.runId.slice(0, 8)}` : 'เลือก source แล้วเริ่ม run เพื่อดูแต่ละ stage'}</small></div><button type="button" className="pw-icon-button" onClick={() => { void refreshHealth(); void loadSources(); }} title="รีเฟรชสถานะ"><RefreshCw size={14} /></button></div>
                  <div className="pw-stage-track">
                    {pipelineSteps.map((step, index) => {
                      const state = stageState(Number(step.stepNumber));
                      return (
                        <div key={step.id} className={`pw-stage-node state-${state}`}>
                          <span className="pw-stage-marker"><StageStatusIcon state={state} /></span>
                          <span className="pw-stage-copy"><strong>{step.stepNumber} · {step.titleTh}</strong><small>{step.titleEn}</small></span>
                          {index < pipelineSteps.length - 1 && <span className="pw-stage-connector" />}
                        </div>
                      );
                    })}
                  </div>

                  <div className="pw-terminal-header"><span><Terminal size={14} /> LIVE PROCESS OUTPUT</span><span className={`pw-run-state ${run ? `state-${run.status}` : ''}`}><i />{run ? run.status.toUpperCase() : 'IDLE'}</span></div>
                  <div className="pw-terminal" ref={terminalRef} role="log" aria-live="off" aria-label="log จาก process จริง">
                    {logs.length === 0 ? (
                      <div className="pw-terminal-empty"><span>$</span><p>เมื่อเริ่มรัน output จริงจาก Python จะแสดงที่นี่</p><small>stdout · UTF-8 · อัปเดตต่อเนื่อง</small></div>
                    ) : logs.map((line, index) => <div key={`${index}-${line}`} className={`pw-log-line ${/FAIL|ERROR|FAILED|ไม่สำเร็จ|ล้มเหลว/i.test(line) ? 'is-error' : /COMPLETED|สำเร็จ/i.test(line) ? 'is-success' : ''}`}><span>{String(index + 1).padStart(3, '0')}</span><code>{line || ' '}</code></div>)}
                    {activeRun && <div className="pw-log-cursor"><span /> process กำลังทำงาน</div>}
                  </div>
                  {run?.status === 'succeeded' && <div className={`pw-run-result ${/\[FAIL\]|FAILED|ไม่สำเร็จ|ล้มเหลว/.test(runText) ? 'has-warning' : 'is-success'}`}><CheckCircle2 size={15} /><span>{/\[FAIL\]|FAILED|ไม่สำเร็จ|ล้มเหลว/.test(runText) ? 'process จบแล้ว โปรดตรวจคำเตือนใน log' : 'pipeline run เสร็จแล้ว'}</span><button type="button" onClick={() => { setActiveTab('query'); void refreshHealth(); }}>ไปทดลอง query <ChevronRight size={13} /></button></div>}
                  {run?.status === 'blocked' && (
                    <div className="pw-run-result has-warning" role="status">
                      <Circle size={15} />
                      <span>รอข้อมูลสำหรับ Allocation · {allocationBlock || 'ดูแหล่งข้อมูลที่ขาดใน log'}</span>
                    </div>
                  )}
                  {run?.status === 'failed' && <div className="pw-run-result has-warning"><X size={15} /><span>process จบด้วย exit code {run.exitCode}</span></div>}
                </section>
              </div>
            </section>
          )}

          {activeTab === 'run' && (
            <section className="pw-file-explorer" aria-label="ไฟล์ผลลัพธ์ของ pipeline">
              <div className="pw-explorer-heading">
                <div><span className="pw-section-kicker">PIPELINE DATA EXPLORER</span><h2>ไฟล์ผลลัพธ์ของแต่ละ phase</h2><p>สำรวจ artifact ใน `web/data/` และเปิด CSV / XLSX / JSONL เพื่อดูข้อมูลในตาราง</p></div>
                <div className="pw-explorer-heading-actions"><span><HardDrive size={13} /> WEB DATA · ISOLATED</span></div>
              </div>

              {explorerError && <div className="pw-explorer-error" role="alert"><X size={14} />{explorerError}</div>}
              {demoDataResetMessage && <div className="pw-demo-reset-message" role="status"><CheckCircle2 size={14} />{demoDataResetMessage}</div>}
              <div className="pw-vscode-workspace">
                <div className="pw-vscode-titlebar"><span><Database size={13} /> CN230 · PIPELINE WORKSPACE</span><code>{activeExplorerStage?.path || 'web/data/'}</code><span className="pw-vscode-window-controls" aria-hidden="true"><i /><i /><i /></span></div>
                <div className="pw-vscode-main">
                  <div className="pw-vscode-activity" aria-hidden="true"><span className="is-active"><Files size={18} /></span><span><Search size={17} /></span><span><GitBranch size={17} /></span><span><Database size={17} /></span></div>
                  <aside className="pw-vscode-sidebar" aria-label="pipeline file explorer">
                    <div className="pw-vscode-sidebar-heading"><span>EXPLORER</span><span>{explorerStages.reduce((total, stage) => total + stage.fileCount, 0)} files</span></div>
                    <div className="pw-vscode-root"><ChevronRight size={12} className="is-expanded" /><FolderOpen size={14} /><strong>CN230 PROJECT</strong></div>
                    {explorerLoading && explorerStages.length === 0 ? <div className="pw-explorer-empty"><Loader2 size={14} className="pw-spin" /> กำลังอ่านไฟล์…</div> : explorerStages.length === 0 ? <div className="pw-explorer-empty"><FolderOpen size={14} /> ไม่มี artifact</div> : (
                      <div className="pw-vscode-stage-tree" aria-label="โฟลเดอร์ pipeline ตาม phase">
                        <button type="button" className="pw-vscode-folder-heading" onClick={() => toggleExplorerFolder('web/data')} aria-expanded={explorerExpandedFolders['web/data'] ?? true}>
                          <ChevronRight size={11} className={(explorerExpandedFolders['web/data'] ?? true) ? 'is-expanded' : ''} /><FolderOpen size={13} /><strong>web/data</strong><small>demo outputs</small>
                        </button>
                        {(explorerExpandedFolders['web/data'] ?? true) && <div className="pw-vscode-tree-children">
                          {databaseStage && <>
                            {renderExplorerStageFolder(databaseStage, 'database', 1)}
                            {(explorerExpandedFolders[databaseStage.path] ?? false) && <div>
                              {databaseFolderNames.map((folder) => {
                                const files = databaseStage.files.filter((file) => file.relativePath.startsWith(`${folder}/`));
                                const folderPath = `${databaseStage.path}/${folder}`;
                                const isExpanded = explorerExpandedFolders[folderPath] ?? false;
                                return <React.Fragment key={folder}>
                                  <button type="button" className={`pw-vscode-folder pw-vscode-subfolder ${isExpanded ? 'is-selected' : ''}`} onClick={() => selectExplorerSubfolder(databaseStage, folder, files)} aria-expanded={isExpanded}>
                                    <ChevronRight size={11} className={isExpanded ? 'is-expanded' : ''} /><FolderOpen size={13} /><span><strong>{folder}</strong><small>{formatCount(files.length)} files</small></span>
                                  </button>
                                  {isExpanded && files.map((file) => renderExplorerFileRow(databaseStage, file, 3))}
                                </React.Fragment>;
                              })}
                            </div>}
                          </>}
                          {mappingStage && renderExplorerStageFolder(mappingStage, 'mapping', 1)}
                          {parsedStage && renderExplorerStageFolder(parsedStage, 'parsed', 1)}
                          {rawStage && renderExplorerStageFolder(rawStage, 'raw', 1)}
                          {stagingStage && renderExplorerStageFolder(stagingStage, 'staging', 1)}
                          {(acceptedStage || rejectedStage) && <>
                            <button type="button" className={`pw-vscode-folder ${explorerExpandedFolders['web/data/validation'] ? 'is-selected' : ''}`} onClick={() => toggleExplorerFolder('web/data/validation')} aria-expanded={explorerExpandedFolders['web/data/validation'] ?? false}>
                              <ChevronRight size={11} className={explorerExpandedFolders['web/data/validation'] ? 'is-expanded' : ''} /><FolderOpen size={13} /><span><strong>validation</strong><small>{formatCount(validationFileCount)} files</small></span>
                            </button>
                            {explorerExpandedFolders['web/data/validation'] && <div>
                              {acceptedStage && renderExplorerStageFolder(acceptedStage, 'accepted', 2)}
                              {rejectedStage && renderExplorerStageFolder(rejectedStage, 'rejected', 2)}
                            </div>}
                          </>}
                        </div>}
                      </div>
                    )}
                    <div className="pw-vscode-sidebar-status"><CalendarDays size={10} /> REFRESHED {formatDate(explorerUpdatedAt)}</div>
                  </aside>

                  <main className="pw-vscode-editor" aria-label="file preview">
                    <div className="pw-vscode-editor-tabs"><div className="pw-vscode-active-tab">{explorerFile?.extension === 'jsonl' ? <FileCode2 size={13} /> : explorerFile?.previewable ? <FileSpreadsheet size={13} /> : <FileText size={13} />}<span>{explorerFile?.name || 'Select a file'}</span><i /></div><div className="pw-vscode-editor-tab-space" /></div>
                    <div className="pw-vscode-breadcrumb"><span>web/data</span><ChevronRight size={11} /><span>{activeExplorerStage?.path.replace('web/data/', '') || 'pipeline'}</span><ChevronRight size={11} /><strong>{explorerFile?.name || 'file preview'}</strong><span className={`pw-vscode-format format-${explorerFile?.extension || 'file'}`}>{explorerFile?.extension.toUpperCase() || 'FILE'}</span></div>
                    <div className="pw-vscode-editor-body">
                      {!explorerFile && <div className="pw-explorer-sheet-empty"><FileSpreadsheet size={26} /><strong>เลือกไฟล์จาก Explorer</strong><span>เลือก phase และไฟล์ทางซ้ายเพื่อเปิดตัวอย่าง</span></div>}
                      {explorerFile && !explorerFile.previewable && <div className="pw-explorer-sheet-empty"><FileText size={26} /><strong>ไฟล์นี้ไม่มีตัวอย่างใน Explorer</strong><span>ไฟล์ {explorerFile.extension.toUpperCase() || 'ชนิดนี้'} แสดงวันที่และตำแหน่งใน Explorer แต่ตัวอย่างรองรับ CSV, XLSX และ JSONL</span><small>แก้ไขล่าสุด {formatDate(explorerFile.modifiedAt)} · {formatFileSize(explorerFile.sizeBytes)}</small></div>}
                      {explorerFile?.previewable && explorerPreviewLoading && <div className="pw-explorer-sheet-empty"><Loader2 size={20} className="pw-spin" /><strong>กำลังเปิดไฟล์…</strong><span>อ่านตัวอย่างข้อมูลจากไฟล์ในโครงการ</span></div>}
                      {explorerFile?.previewable && explorerPreviewError && <div className="pw-explorer-error" role="alert"><X size={14} />{explorerPreviewError}</div>}
                      {explorerPreview && !explorerPreviewLoading && (
                        <>
                          {explorerPreview.sheetNames.length > 1 && <div className="pw-explorer-sheet-tabs" role="tablist" aria-label="เลือก worksheet">
                            {explorerPreview.sheetNames.map((sheet) => <button key={sheet} type="button" className={(explorerSheet || explorerPreview.activeSheet) === sheet ? 'is-selected' : ''} onClick={() => setExplorerSheet(sheet)} role="tab" aria-selected={(explorerSheet || explorerPreview.activeSheet) === sheet}>{sheet}</button>)}
                          </div>}
                          <div className="pw-explorer-grid-wrap">
                            {explorerPreview.columns.length === 0 ? <div className="pw-explorer-grid-empty">{explorerPreview.format === 'jsonl' ? 'ไฟล์นี้ยังไม่มีระเบียนให้แสดง' : 'ไฟล์นี้ยังไม่มีแถวหัวตารางให้แสดง'}</div> : <table className="pw-explorer-grid"><thead><tr><th className="pw-explorer-row-number">#</th>{explorerPreview.columns.map((column, index) => <th key={`${column}-${index}`} title={column}>{column}</th>)}</tr></thead><tbody>
                              {explorerPreview.rows.map((row, rowIndex) => <tr key={rowIndex}><th className="pw-explorer-row-number">{rowIndex + 1}</th>{explorerPreview.columns.map((_column, columnIndex) => { const value = row[columnIndex]; return <td key={columnIndex} title={formatCell(value)}>{formatCell(value)}</td>; })}</tr>)}
                            </tbody></table>}
                          </div>
                          <div className="pw-vscode-editor-status"><span>{explorerPreview.format.toUpperCase()} · {formatCount(explorerPreview.rowCountPreviewed)} {explorerPreview.format === 'jsonl' ? 'records' : 'rows'}{explorerPreview.truncated ? ` · first ${formatCount(explorerPreview.rowCountPreviewed)} shown` : ''}</span><span>Modified {formatDate(explorerFile?.modifiedAt)}</span></div>
                        </>
                      )}
                    </div>
                  </main>
                </div>
              </div>
            </section>
          )}

          {activeTab === 'steps' && (
            <section id="pw-panel-steps" className="pw-panel pw-steps-panel" role="tabpanel" aria-labelledby="pw-tab-steps">
              <div className="pw-panel-heading">
                <div><span className="pw-section-kicker">HOW THE PIPELINE WORKS</span><h2>จาก source ไปสู่ข้อมูลที่ query ได้</h2><p>คำอธิบายอิงตามฟังก์ชันและไฟล์ผลลัพธ์ของ `run_pipeline.py` จริง</p></div>
                <div className="pw-steps-actions"><button type="button" className="pw-secondary-button" onClick={() => setActiveTab('run')}><Play size={14} /> ไปหน้ารัน pipeline</button><button type="button" className="pw-secondary-button pw-presentation-launch" onClick={enterPresentation}><Play size={14} /> นำเสนอเต็มจอ</button></div>
              </div>

              <div className="pw-step-browser">
                <nav className="pw-step-list" aria-label="ขั้นตอน pipeline">
                  {pipelineSteps.map((step) => (
                    <button key={step.id} type="button" onClick={() => setSelectedStep(step)} className={`pw-step-choice ${selectedStep.id === step.id ? 'is-selected' : ''}`} aria-pressed={selectedStep.id === step.id}>
                      <span className="pw-step-choice-number">{step.stepNumber}</span><span><strong>{step.titleTh}</strong><small>{step.titleEn}</small></span><ChevronRight size={14} />
                    </button>
                  ))}
                </nav>
                <article className="pw-step-detail">
                  <div className="pw-step-detail-top"><span className="pw-step-detail-number">{selectedStep.stepNumber}</span><div><span className="pw-section-kicker">{selectedStep.titleEn}</span><h3>{selectedStep.titleTh}</h3></div></div>
                  <p className="pw-step-summary">{selectedStep.summary}</p>
                  <div className="pw-step-flow">
                    <section><span className="pw-info-label">INPUT · รับอะไรเข้ามา</span><ul>{selectedStep.inputs.map((item) => <li key={item}>{item}</li>)}</ul></section>
                    <div className="pw-flow-arrow"><ChevronRight size={18} /></div>
                    <section><span className="pw-info-label">OUTPUT · ได้อะไรออกมา</span><ul>{selectedStep.outputs.map((item) => <li key={item}>{item}</li>)}</ul></section>
                  </div>
                  <section className="pw-process-block"><span className="pw-info-label">WHAT THIS STEP DOES</span><ol>{selectedStep.processingDetails.map((detail, index) => <li key={detail}><span>{String(index + 1).padStart(2, '0')}</span>{detail}</li>)}</ol></section>
                  <div className="pw-step-footer-grid">
                    <section className="pw-quality-block"><span className="pw-info-label">QUALITY GATE</span><ul>{selectedStep.dataQualityChecks.map((item) => <li key={item}><CheckCircle2 size={14} />{item}</li>)}</ul></section>
                    <section className="pw-provenance-block"><span className="pw-info-label">IMPLEMENTATION / SOURCE</span><code>{selectedStep.provenanceSource}</code>{selectedStep.sqlOrMathFormula && <pre>{selectedStep.sqlOrMathFormula}</pre>}</section>
                  </div>
                  <div className="pw-step-pager"><button type="button" onClick={() => setSelectedStep(pipelineSteps[Math.max(0, pipelineSteps.findIndex((step) => step.id === selectedStep.id) - 1)])} disabled={selectedStep.id === pipelineSteps[0].id}>ก่อนหน้า</button><span>ขั้นที่ {selectedStep.stepNumber} / 07</span><button type="button" onClick={() => setSelectedStep(pipelineSteps[Math.min(pipelineSteps.length - 1, pipelineSteps.findIndex((step) => step.id === selectedStep.id) + 1)])} disabled={selectedStep.id === pipelineSteps[pipelineSteps.length - 1].id}>ขั้นถัดไป <ChevronRight size={13} /></button></div>
                </article>
              </div>

            </section>
          )}

          {activeTab === 'query' && (
            <section id="pw-panel-query" className="pw-panel pw-query-panel" role="tabpanel" aria-labelledby="pw-tab-query">
              <div className="pw-panel-heading">
                <div><span className="pw-section-kicker">ISOLATED SQL SANDBOX</span><h2>ทดลอง query กับข้อมูลจริง</h2><p>เริ่มจากสำเนาในหน่วยความจำ ทดลอง CREATE / INSERT / UPDATE / DELETE ได้ใน sandbox นี้ แล้ว reset เพื่อโหลด snapshot จาก `web/data/` ใหม่</p></div>
                <span className="pw-readonly-badge"><CheckCircle2 size={14} /> MEMORY-ONLY SANDBOX · RESETTABLE</span>
              </div>

              <div className="pw-query-targets" role="group" aria-label="แหล่งข้อมูลสำหรับ query">
                <button type="button" className={`pw-target-tab ${queryTarget === 'validated' ? 'is-selected' : ''}`} aria-pressed={queryTarget === 'validated'} onClick={() => setQueryTarget('validated')}>
                  <FileCode2 size={15} /><span><strong>Validated extracts</strong><small>{formatCount(health?.acceptedFiles || 0)} CSV · {formatCount(health?.acceptedRecords || 0)} records</small></span><i className="pw-target-dot is-ready" />
                </button>
                <button type="button" className={`pw-target-tab ${queryTarget === 'mart' ? 'is-selected' : ''}`} aria-pressed={queryTarget === 'mart'} onClick={() => setQueryTarget('mart')} disabled={!health?.sqliteReady}>
                  <Database size={15} /><span><strong>SQLite data mart</strong><small>{querySchema ? `${querySchema.tables.length} tables · memory copy` : 'SQLite snapshot · memory copy'}</small></span><i className={`pw-target-dot ${health?.sqliteReady ? 'is-ready' : ''}`} />
                </button>
              </div>

              <div className="pw-query-workspace">
                <aside className="pw-query-sidebar">
                  <div className="pw-sidebar-heading"><span>QUERY STARTERS</span><small>{queryTarget === 'validated' ? 'accepted CSV snapshot' : 'SQLite memory copy'}</small></div>
                  <div className="pw-preset-list">
                    {QUERY_PRESETS[queryTarget].map((preset) => (
                      <button type="button" key={preset.label} onClick={() => { setSql(preset.sql); setQueryResult(null); setQueryError(''); }} className={`pw-preset-button ${sql === preset.sql ? 'is-selected' : ''}`}>
                        <strong>{preset.label}</strong><small>{preset.description}</small>
                      </button>
                    ))}
                  </div>
                  <div className="pw-table-browser">
                    <div className="pw-sidebar-heading"><span>TABLES</span><small>{querySchema?.tables.length ?? 0}</small></div>
                    {schemaError && <p className="pw-schema-error">{schemaError}</p>}
                    {querySchema?.tables.map((table) => (
                      <button type="button" key={table.name} className="pw-table-row" onClick={() => { setSql(`SELECT *\nFROM ${table.name}\nLIMIT 50;`); setQueryResult(null); setQueryError(''); }} title={`คัดลอกชื่อ ${table.name} ลง editor`}>
                        <Table2 size={13} /><span><strong>{table.name}</strong><small>{table.columns.length} columns</small></span><em>{formatCount(table.rows)}</em>
                      </button>
                    ))}
                    {!querySchema && !schemaError && <div className="pw-empty-inline"><Loader2 size={14} className="pw-spin" /> กำลังอ่าน schema…</div>}
                  </div>
                  <div className="pw-sandbox-note"><span className="pw-lock-mark"><Check size={12} /></span><p>SQL ทำงานกับ memory copy เท่านั้น · การแก้ไขอยู่จนกด reset · จำกัดเวลา 3 วินาทีและผล query 500 แถว</p></div>
                </aside>

                <div className="pw-query-main">
                  <div className="pw-editor-card">
                  <div className="pw-editor-toolbar"><span><FileCode2 size={14} /> SQL SANDBOX</span><button type="button" className="pw-reset-sandbox" onClick={handleResetSandbox} disabled={sandboxResetting || queryBusy}><RotateCcw size={12} /> {sandboxResetting ? 'กำลัง reset…' : 'รีเซ็ต query'}</button><span>{sandboxSession ? `memory session · ${sandboxSession.target}` : 'กำลังเตรียม sandbox…'}</span></div>
                    <textarea className="pw-sql-editor" value={sql} onChange={(event) => { setSql(event.target.value); setQueryResult(null); }} spellCheck={false} autoCapitalize="off" autoCorrect="off" aria-label="SQL sandbox editor" disabled={sandboxResetting} />
                    <div className="pw-editor-footer"><span>SELECT + scratch edits · 3 sec · 500 rows</span><button type="button" className="pw-query-button" onClick={handleRunQuery} disabled={queryBusy || sandboxResetting || !sandboxSession || !querySchema}>
                      {queryBusy ? <Loader2 size={15} className="pw-spin" /> : <Play size={14} fill="currentColor" />}{queryBusy ? 'กำลัง query…' : 'Run query'}
                    </button></div>
                  </div>

                  <div className="pw-results-card">
                    <div className="pw-results-heading"><div><strong>{queryResult?.statementType === 'sandbox change' ? 'ผลการแก้ข้อมูลใน sandbox' : 'ผลลัพธ์'}</strong><small>{queryResult ? `${formatCount(queryResult.rowCount)} ${queryResult.statementType === 'sandbox change' ? 'แถวได้รับผลกระทบ' : 'แถว'} · ${queryResult.durationMs} ms · ${queryResult.target === 'mart' ? 'memory copy' : 'accepted snapshot'}` : 'ผลทดลองจะปรากฏที่นี่ · กด reset เพื่อล้างและคืน snapshot เดิม'}</small></div>{queryResult?.truncated && <span className="pw-truncated-pill">แสดง 500 แถวแรก</span>}</div>
                    {queryError && <div className="pw-query-error" role="alert"><X size={15} />{queryError}</div>}
                    {queryResult?.statementType === 'sandbox change' && <div className="pw-query-success" role="status"><CheckCircle2 size={15} /><span>{queryResult.message || 'เปลี่ยนข้อมูลใน in-memory sandbox แล้ว'} รีเซ็ตได้ทุกเมื่อ โดยไฟล์โครงการไม่เปลี่ยน</span></div>}
                    {queryResult && queryResult.statementType !== 'sandbox change' && (
                      <div className="pw-result-table-wrap">
                        {queryResult.rows.length === 0 ? <div className="pw-query-empty">Query สำเร็จ แต่ไม่พบแถวที่ตรงกับเงื่อนไข</div> : (
                          <table className="pw-result-table"><thead><tr>{queryResult.columns.map((column, index) => <th scope="col" key={`${column}-${index}`}>{column}</th>)}</tr></thead><tbody>{queryResult.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={`${rowIndex}-${cellIndex}`} title={formatCell(cell)}>{formatCell(cell)}</td>)}</tr>)}</tbody></table>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  );
};
