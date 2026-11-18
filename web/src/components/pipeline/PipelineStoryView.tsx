import React, { useEffect, useMemo, useRef, useState } from 'react';
import { runBrowserSql, type SqlQueryResult } from '../../utils/browserSqlite';
import {
  CalendarDays,
  Check,
  CheckCircle2,
  Copy,
  ChevronRight,
  Circle,
  Database,
  ExternalLink,
  FileCode2,
  FileSpreadsheet,
  FileText,
  Files,
  Folder,
  FolderOpen,
  GitBranch,
  HardDrive,
  Loader2,
  Play,
  Presentation,
  RotateCcw,
  Search,
  Square,
  Table2,
  Terminal,
  X
} from 'lucide-react';
import { useWebsiteData } from '../../data/websiteData';
import type { PipelineStep } from '../../types/pipeline';
import { PipelinePresentationMode } from './PipelinePresentationMode';
import { copyToClipboard } from '../../utils/format';
import '../../styles/pipeline-workbench.css';
import '../../styles/page-header-shared.css';

type WorkbenchTab = 'run' | 'steps' | 'query' | 'traceability';
type PipelineStoryViewProps = { page?: 'walkthrough' | 'query' };
type RunStatus = 'idle' | 'running' | 'succeeded' | 'blocked';
type SqlPresetKey = 'exchanges' | 'by_source' | 'by_file' | 'processes' | 'qc_rules' | 'traceback' | 'table_preview' | 'material_flows' | 'annual_impacts' | 'upstream_fu' | 'mapping_changes';

interface PipelineFile {
  name: string;
  relativePath: string;
  path: string;
  extension: string;
  sizeBytes: number;
  modifiedAt: string;
  previewable: boolean;
  sourcePath: string;
  publicUrl: string;
  sha256?: string;
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

interface AcceptedFile {
  sourceId: string;
  file: string;
  path: string;
  sourcePath: string;
  publicUrl: string;
  sha256: string;
  records: number;
  updatedAt: string;
}

interface SourceStageMetrics {
  rawRows: number;
  rawBytes: number;
  batchId: string;
  rawSha256: string;
  parsedRows: number;
  stagedRows: number;
  mappedRows: number;
  acceptedRows: number;
  quarantinedRows: number;
  databaseExchanges: number;
  acceptedSha256: string;
  allocationMethod: string;
  pdfPages: string[];
}

interface SourceReplay {
  sourceId: string;
  title?: string;
  publisher?: string;
  sector?: string;
  sourceType?: string;
  phase?: string;
  requiresUpstreamCluster?: boolean;
  acceptedRecords: number;
  stageMetrics?: SourceStageMetrics;
  steps: { label: string; lines: string[] }[];
}

interface DatabaseTablesPayload {
  SOURCE: Record<string, string>[];
  REFERENCE: Record<string, string>[];
  EXTRACTION_BATCH: Record<string, string>[];
  LOCATION: Record<string, string>[];
  UNIT: Record<string, string>[];
  FLOW: Record<string, string>[];
  PROCESS: Record<string, string>[];
  LCI_EXCHANGE: Record<string, string>[];
  QUALITY_CHECK: Record<string, string>[];
  REJECTED_RECORD: Record<string, string>[];
  qcRules: string[];
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
  catalogArtifact: { path: string; sha256: string; modifiedAt?: string };
  stages: PipelineFileStage[];
  sourceReplays: SourceReplay[];
  databaseTables?: DatabaseTablesPayload;
  provenanceLedger?: Record<string, unknown>[];
}

interface SourceRegistryEntry {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  status: string;
}

interface EditorPreview {
  kind: 'table' | 'code' | 'pdf';
  columns: string[];
  rows: string[][];
  totalRows: number;
  sheetNames: string[];
  activeSheet: string | null;
  codeText?: string;
  pdfUrl?: string;
}

const PREFERENCE_KEY = 'cn230.pipeline-workbench.source-selection.v1';
const UPSTREAM_CLUSTER_IDS = ['SRC-044', 'SRC-045', 'SRC-046', 'SRC-047'];
const UPSTREAM_PRODUCTION_IDS = ['SRC-044', 'SRC-045', 'SRC-046'];
const DB_TABLE_NAMES = [
  'SOURCE',
  'REFERENCE',
  'EXTRACTION_BATCH',
  'UNIT',
  'LOCATION',
  'FLOW',
  'PROCESS',
  'LCI_EXCHANGE',
  'QUALITY_CHECK',
  'REJECTED_RECORD',
] as const;
type DbTableName = (typeof DB_TABLE_NAMES)[number];

const DEFAULT_TABLE_HEADERS: Record<DbTableName, string[]> = {
  SOURCE: ['source_id', 'title', 'publisher', 'publish_year', 'description', 'url'],
  REFERENCE: ['reference_id', 'reference_name', 'reference_type', 'reference_url', 'source_id'],
  EXTRACTION_BATCH: ['batch_id', 'extraction_time', 'script_version', 'source_id'],
  UNIT: ['unit_id', 'symbol', 'quantity', 'to_base_factor'],
  LOCATION: ['location_id', 'name', 'country'],
  FLOW: ['flow_id', 'flow_name', 'flow_type', 'compartment', 'default_unit_id'],
  PROCESS: ['process_id', 'process_name', 'domain', 'process_year', 'location_id', 'reference_id'],
  LCI_EXCHANGE: ['exchange_id', 'process_id', 'flow_id', 'direction', 'amount', 'unit_id', 'allocation', 'reference_id', 'batch_id', 'is_reference'],
  QUALITY_CHECK: ['check_id', 'rule_name', 'status', 'exchange_id'],
  REJECTED_RECORD: ['rejected_id', 'raw_data', 'error_type', 'batch_id'],
};

const numberFormat = new Intl.NumberFormat('th-TH');

function formatCount(value: number | null | undefined): string {
  return numberFormat.format(value || 0);
}

function formatDate(value?: string | null): string {
  if (!value) return 'ไม่ทราบวันที่';
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

function getSourcePageUrl(value: string): string | null {
  const safeUrl = getSafeSourceUrl(value);
  if (!safeUrl) return null;
  const url = new URL(safeUrl);
  // DMF resource/download URLs include the dataset's landing page path.
  if (url.hostname === 'catalog.dmf.go.th') {
    const datasetMatch = url.pathname.match(/^\/dataset\/([^/]+)(?:\/resource\/.*)?$/);
    if (datasetMatch) return `${url.origin}/dataset/${datasetMatch[1]}`;
  }
  if (url.hostname === 'catalog.eppo.go.th') {
    const eppoDatasetPages: Record<string, string> = {
      '63491d54-cfd8-46ea-866b-824519097944': '/dataset/e859cce9-1b31-4f13-bfff-151155c7f8e2',
      'f8ce9405-81c1-498b-94b5-9b86c0ca26c1': '/dataset/dataset_11_13',
      'f69c137e-168c-473c-beb0-2f49a3dc076f': '/dataset/dataset_11_22',
    };
    const resourceId = url.pathname.match(/^\/datastore\/dump\/([^/]+)/)?.[1];
    if (resourceId && eppoDatasetPages[resourceId]) return `${url.origin}${eppoDatasetPages[resourceId]}`;
  }
  return safeUrl;
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return text.replace(/((?:Crude Oil|Natural Gas|Condensate) Production)\s*\[[^\]]+\]/gi, '$1');
}

function traceSourceMatchesFlow(source: Record<string, unknown>, flowName: string): boolean {
  const sourceValues = (source.source_values || {}) as Record<string, unknown>;
  const stagedValues = (source.staged_values || {}) as Record<string, unknown>;
  return ['indicator', 'flow_name', 'product', 'product_std'].some((key) =>
    [sourceValues[key], stagedValues[key]].some((value) => String(value ?? '').trim().toLocaleLowerCase() === flowName.trim().toLocaleLowerCase())
  );
}

function sourceKeysForTupleColumn(column: string) {
  const key = column.toLowerCase().replace(/[^a-z0-9]/g, '');
  const aliases: Record<string, string[]> = {
    processyear: ['year', 'yearraw', 'processyear'], year: ['year', 'yearraw'],
    flowname: ['flowname', 'product', 'elementaryflow', 'indicator'], flow: ['flowname', 'product', 'elementaryflow', 'indicator'],
    amount: ['amount', 'value', 'quantity'], amountperfu: ['amount', 'value', 'quantity'], totalamount: ['amount', 'value', 'quantity'],
    direction: ['direction'], unit: ['unit', 'unitname'], processname: ['processname', 'process'],
    sourcerecordid: ['recordid', 'sourcerecordid'], recordid: ['recordid', 'sourcerecordid'],
    sourcerownumber: ['rownumber', 'sourcerownumber'], rownumber: ['rownumber', 'sourcerownumber'],
    sourcelocator: ['locator', 'sourcelocator'], locator: ['locator', 'sourcelocator'],
  };
  return aliases[key] || [key];
}

function tupleColumnOrigins(column: string, sources: Record<string, unknown>[]) {
  const keys = sourceKeysForTupleColumn(column);
  return sources.flatMap((source) => {
    const raw = (source.source_values || {}) as Record<string, unknown>;
    const staged = (source.staged_values || {}) as Record<string, unknown>;
    const matched = [
      ...Object.keys(raw).filter((key) => keys.includes(key.toLowerCase().replace(/[^a-z0-9]/g, ''))).map((key) => `raw · ${key}`),
      ...Object.keys(staged).filter((key) => keys.includes(key.toLowerCase().replace(/[^a-z0-9]/g, ''))).map((key) => `staging · ${key}`),
    ];
    if (!matched.length) return [];
    const locator = String(source.source_locator || source.source_row_number || source.source_record_id || 'source row');
    return [{ source: String(source.source_id || ''), locator, fields: [...new Set(matched)] }];
  }).slice(0, 4);
}

function TraceabilitySourceCard({ source, isFlowEvidence = false }: { source: Record<string, unknown>; isFlowEvidence?: boolean }) {
  const rawValues = (source.source_values || {}) as Record<string, unknown>;
  const stagedValues = (source.staged_values || {}) as Record<string, unknown>;
  const renderValueTable = (title: string, values: Record<string, unknown>) => <section className="pw-source-stage-table"><h3>{title}</h3>{Object.keys(values).length ? <table><thead><tr><th>ฟิลด์</th><th>ค่า</th></tr></thead><tbody>{Object.entries(values).map(([key, value]) => <tr key={key}><th scope="row">{key}</th><td>{formatCell(value)}</td></tr>)}</tbody></table> : <p>ไม่มีข้อมูลในขั้นตอนนี้</p>}</section>;
  return <article className={isFlowEvidence ? 'is-flow-evidence' : ''}>
    <header><div><strong>{String(source.source_id)} · record {String(source.source_record_id)}{source.exchange_id != null && ` · exchange ${String(source.exchange_id)}`}{isFlowEvidence && <em>หลักฐานของ flow นี้</em>}</strong><small>{String(source.source_locator)} · {String(source.raw_file)}</small></div><a href={`${import.meta.env.BASE_URL}raw/${encodeURIComponent(String(source.raw_file))}`} target="_blank" rel="noreferrer">เปิดไฟล์ต้นทาง <ExternalLink size={12} /></a></header>
    <div className="pw-source-stage-tables">{renderValueTable('1 · Raw', rawValues)}{renderValueTable('2 · Staging', stagedValues)}</div>
    <footer>{Boolean(source.source_url) && <a href={String(source.source_url)} target="_blank" rel="noreferrer">Publisher</a>}<span>SHA-256 · {String(source.source_sha256)}</span></footer>
  </article>;
}

function formatSourceRanges(sourceIds: string[]): string {
  if (!sourceIds.length) return '-';
  const nums = sourceIds
    .map((sid) => ({ sid, num: Number(sid.replace(/^SRC-/i, '')) }))
    .filter((item) => !Number.isNaN(item.num))
    .sort((a, b) => a.num - b.num);
  if (nums.length !== sourceIds.length) return sourceIds.join(', ');
  const ranges: string[] = [];
  let start = nums[0];
  let end = nums[0];
  for (let i = 1; i < nums.length; i += 1) {
    if (nums[i].num === end.num + 1) {
      end = nums[i];
    } else {
      ranges.push(start.num === end.num ? start.sid : `${start.sid}..${end.sid}`);
      start = nums[i];
      end = nums[i];
    }
  }
  ranges.push(start.num === end.num ? start.sid : `${start.sid}..${end.sid}`);
  return ranges.join(', ');
}

function parseCsv(text: string): { columns: string[]; rows: string[][]; totalRows: number } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const input = text.replace(/^\uFEFF/, '');

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && input[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }
  row.push(cell);
  if (row.some((value) => value.length > 0)) rows.push(row);

  const columns = rows.shift() || [];
  const body = rows.filter((values) => values.some((value) => value.length > 0));
  return { columns, rows: body.slice(0, 50), totalRows: body.length };
}

function decodeCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Thai government source files commonly use Windows-874 rather than UTF-8.
    return new TextDecoder('windows-874').decode(bytes);
  }
}

function parseJsonl(text: string): { columns: string[]; rows: string[][]; totalRows: number } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0);
  const records: Record<string, unknown>[] = lines.slice(0, 50).map((line) => {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : { value: parsed };
  });
  const columns = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
  const rows = records.map((record) => columns.map((column) => formatCell(record[column])));
  return { columns, rows, totalRows: lines.length };
}

function readSavedSources(): string[] | null {
  try {
    const value = window.localStorage.getItem(PREFERENCE_KEY);
    if (value === null) return null;
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : null;
  } catch {
    return null;
  }
}

function getActiveStepNumber(logs: string[]): number | null {
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const match = logs[index].match(/\[STEP\s+0?(\d)\/0?[67]\]/i);
    if (match) return Number(match[1]);
  }
  return null;
}

function buildTerminalLines(
  replays: SourceReplay[],
  stageFilesByKey: Map<string, PipelineFile[]>,
  forceRefresh: boolean,
  includeDatabase: boolean,
  dbCounts: Record<string, number>
): { lines: string[]; finalStatus: RunStatus; validatedIds: string[]; blockedIds: string[]; missingUpstream: string[] } {
  const sep = '='.repeat(78);
  const selectedIds = replays.map((r) => r.sourceId);
  const hasUpstreamProd = selectedIds.some((id) => UPSTREAM_PRODUCTION_IDS.includes(id));
  const missingUpstream = hasUpstreamProd ? UPSTREAM_CLUSTER_IDS.filter((id) => !selectedIds.includes(id)) : [];
  const isBlocked = missingUpstream.length > 0;

  const phase1 = replays.filter((r) => UPSTREAM_CLUSTER_IDS.includes(r.sourceId));
  const phase2 = replays.filter((r) => !UPSTREAM_CLUSTER_IDS.includes(r.sourceId));
  const ordered = [...phase1, ...phase2];

  const lines: string[] = [
    sep,
    '>>> [STEP 01/06] SOURCE DISCOVERY (สำรวจและคัดกรองแหล่งข้อมูลจาก docs/source_registry/ · ตัวอย่าง)',
    sep,
    '  [CATALOG]     Approved (18): SRC-044..SRC-061 | Cradle-to-Gate supporting (21): P01..P09',
    `  [TARGETS]     Selected for Run (${ordered.length}) : ${formatSourceRanges(selectedIds)}`,
  ];

  const phaseParts: string[] = [];
  if (phase1.length) phaseParts.push(`1. UPSTREAM CLUSTER (${phase1.length})`);
  if (phase2.length) phaseParts.push(`${phaseParts.length + 1}. MIDSTREAM & GUIDELINES (${phase2.length})`);
  if (phaseParts.length) {
    lines.push(`  [ORDER]       ${phaseParts.join(' | ')}`);
  }

  const findFileName = (stageKey: string, sid: string, fallbackSuffix: string) => {
    const found = (stageFilesByKey.get(stageKey) || []).find((f) => f.name.toUpperCase().startsWith(`${sid}_`));
    return found ? found.name : `${sid}_${fallbackSuffix}`;
  };

  let datasetIdx = 1;
  const runPhase = (phaseNum: number, totalPhases: number, title: string, group: SourceReplay[]) => {
    lines.push(
      '',
      sep,
      `PHASE ${phaseNum}/${totalPhases} · ${title} (${formatSourceRanges(group.map((g) => g.sourceId))} | ${group.length} แหล่ง)`,
      sep
    );
    for (const item of group) {
      const sid = item.sourceId;
      const m = item.stageMetrics;
      const deferMap = UPSTREAM_PRODUCTION_IDS.includes(sid);
      const rawFile = findFileName('raw', sid, 'RAW');
      const parsedFile = findFileName('parsed', sid, 'PARSED_RAW.csv');
      const stagedFile = findFileName('staging', sid, 'STAGED.csv');

      lines.push(
        '',
        sep,
        `[${datasetIdx}/${ordered.length}] DATASET: ${sid}`,
        sep,
        '>>> [STEP 02/06] RAW ACQUISITION (เก็บไฟล์ดิบ + SHA-256 -> web/data/raw/)',
        `  [PREPARED DATA] ${rawFile} (${formatCount(m?.rawBytes || 0)} bytes)${forceRefresh ? ' · --force selected; no download performed' : ''}`,
        `  [PROVENANCE]  Batch: ${m?.batchId || '—'} | SHA-256: ${(m?.rawSha256 || '').slice(0, 16)}...`,
        '>>> [STEP 03/06] PARSING (สกัดตารางดิบ -> web/data/parsed/)',
        `  [PARSED]      สกัดตารางสำเร็จ: ${formatCount(m?.parsedRows || 0)} แถว -> ${parsedFile}`,
        '>>> [STEP 04/06] STAGING (คลีนข้อมูล + แนบ Provenance -> web/data/staging/)',
        `  [STAGED]      คลีนข้อมูลสำเร็จ: ${formatCount(m?.stagedRows || 0)} แถว -> ${stagedFile}`
      );

      if (deferMap) {
        lines.push(`  [DEFERRED]    รอทำ Step 05–06 หลังจบการ Stage กลุ่ม Upstream (${sid})`);
      } else {
        const mappedFile = findFileName('mapping', sid, 'MAPPED.csv');
        const validFile = findFileName('accepted', sid, 'VALID.csv');
        const basis = m?.allocationMethod ? ` (${m.allocationMethod})` : '';
        lines.push(
          '>>> [STEP 05/06] MAPPING (แปลงสู่โครงสร้างกลาง LCI -> web/data/mapping/)',
          `  [MAPPED]      แปลงโครงสร้าง LCI สำเร็จ: ${formatCount(m?.mappedRows || 0)} แถว${basis} -> ${mappedFile}`,
          '>>> [STEP 06/06] VALIDATION (ตรวจกฎ QC 7 ข้อ -> web/data/validation/accepted/)',
          `  [VALIDATED]   ผ่านเกณฑ์ ${formatCount(m?.acceptedRows || item.acceptedRecords)} แถว | กักกัน ${formatCount(m?.quarantinedRows || 0)} แถว -> ${validFile}`,
          `STATUS: VALIDATED ${sid}`
        );
      }
      datasetIdx += 1;
    }

    if (title === 'UPSTREAM CLUSTER') {
      const deferred = group.filter((g) => UPSTREAM_PRODUCTION_IDS.includes(g.sourceId));
      deferred.forEach((item, idx) => {
        const sid = item.sourceId;
        const m = item.stageMetrics;
        lines.push(
          '',
          sep,
          `[UPSTREAM ${idx + 1}/${deferred.length}] COMPLETING STEP 05-06: ${sid}`,
          sep,
          '>>> [STEP 05/06] MAPPING (ปันส่วนพลังงานจากข้อมูลต้นทาง + แปลงสู่โครงสร้างกลาง -> web/data/mapping/)'
        );
        if (isBlocked) {
          lines.push(
            `  [BLOCKED]     ${sid}: ข้อมูลสำหรับคำนวณสัดส่วนพลังงานยังไม่ครบ (ขาดไฟล์ Staged ของ ${missingUpstream.join(', ')})`,
            `STATUS: BLOCKED ${sid}`
          );
        } else {
          const mappedFile = findFileName('mapping', sid, 'MAPPED.csv');
          const validFile = findFileName('accepted', sid, 'VALID.csv');
          lines.push(
            `  [NOTICE]      ${sid}: ตัดปีที่ไม่อยู่ในช่วงข้อมูลอ้างอิงออก 20 ปี (2003–2021, 2026)`,
            `  [MAPPED]      ปันส่วนพลังงานและแปลงโครงสร้างสำเร็จ: ${formatCount(m?.mappedRows || 0)} แถว -> ${mappedFile}`,
            '>>> [STEP 06/06] VALIDATION (ตรวจกฎ QC 7 ข้อ -> web/data/validation/accepted/)',
            `  [VALIDATED]   ผ่านเกณฑ์ ${formatCount(m?.acceptedRows || item.acceptedRecords)} แถว | กักกัน ${formatCount(m?.quarantinedRows || 0)} แถว -> ${validFile}`,
            `STATUS: VALIDATED ${sid}`
          );
        }
      });
    }
  };

  const activePhases: { title: string; group: SourceReplay[] }[] = [];
  if (phase1.length) activePhases.push({ title: 'UPSTREAM CLUSTER', group: phase1 });
  if (phase2.length) activePhases.push({ title: 'MIDSTREAM & GUIDELINES', group: phase2 });
  activePhases.forEach((p, idx) => runPhase(idx + 1, activePhases.length, p.title, p.group));

  const sortedReplays = [...ordered].sort((a, b) => a.sourceId.localeCompare(b.sourceId));
  const validatedIds = sortedReplays
    .filter((r) => !(isBlocked && UPSTREAM_PRODUCTION_IDS.includes(r.sourceId)))
    .map((r) => r.sourceId);
  const blockedIds = sortedReplays
    .filter((r) => isBlocked && UPSTREAM_PRODUCTION_IDS.includes(r.sourceId))
    .map((r) => r.sourceId);

  lines.push(
    '',
    sep,
    'PIPELINE SAMPLE SUMMARY (STEP 01 - 06: SOURCE TO VALIDATION)',
    sep,
    '  #   | Source ID  | Status       | Progress           | Details',
    '  ' + '-'.repeat(74)
  );
  sortedReplays.forEach((r, idx) => {
    const blocked = isBlocked && UPSTREAM_PRODUCTION_IDS.includes(r.sourceId);
    const status = (blocked ? 'BLOCKED' : 'VALIDATED').padEnd(12, ' ');
    const progress = (blocked ? 'Step 05 (Blocked)' : 'Step 01 -> 06').padEnd(18, ' ');
    const details = blocked
      ? `ขาดไฟล์ Staged ของ ${missingUpstream.join(', ')}`
      : `Raw 1 | Parsed 1 | Staged 1 | Mapped 1 | Valid 1 (${formatCount(r.acceptedRecords)} rows)`;
    lines.push(`  ${String(idx + 1).padEnd(3, ' ')} | ${r.sourceId.padEnd(10, ' ')} | ${status} | ${progress} | ${details}`);
  });
  lines.push(
    sep,
    `  Prepared data status · Total: ${sortedReplays.length} | Validated: ${validatedIds.length} | Skipped: 0 | Blocked: ${blockedIds.length} | Failed: 0`,
    sep
  );

  if (isBlocked) {
    lines.push('  [NOTICE]      ข้าม Database เพราะยังรอข้อมูลสำหรับ Allocation');
    return { lines, finalStatus: 'blocked', validatedIds, blockedIds, missingUpstream };
  }

  if (!includeDatabase) {
    lines.push('  [NOTICE]      ข้าม Database ตามตัวเลือก --no-db');
    return { lines, finalStatus: 'succeeded', validatedIds, blockedIds, missingUpstream };
  }

  lines.push(
    '',
    '>>> [STEP 07/07] DATABASE LOAD & EXPORT',
    '  [PREPARED DATA] แสดงผล export ที่เตรียมไว้ · ไม่มีการเขียนไฟล์ใหม่',
    `                QUALITY_CHECK         : ${formatCount(dbCounts.QUALITY_CHECK)} แถว`,
    `                LCI_EXCHANGE          : ${formatCount(dbCounts.LCI_EXCHANGE)} แถว`,
    `                PROCESS               : ${formatCount(dbCounts.PROCESS)} แถว`,
    `                FLOW                  : ${formatCount(dbCounts.FLOW)} แถว`,
    `                EXTRACTION_BATCH      : ${formatCount(dbCounts.EXTRACTION_BATCH)} แถว`,
    `                REFERENCE             : ${formatCount(dbCounts.REFERENCE)} แถว`,
    `                LOCATION              : ${formatCount(dbCounts.LOCATION)} แถว`,
    `                UNIT                  : ${formatCount(dbCounts.UNIT)} แถว`,
    `                SOURCE                : ${formatCount(dbCounts.SOURCE)} แถว`,
    `                REJECTED_RECORD       : ${formatCount(dbCounts.REJECTED_RECORD)} แถว`,
    `  [STEP 07/07]  LCI Datasets (${validatedIds.length})   : ${formatSourceRanges(validatedIds)} [data available]`,
    `[EXAMPLE COMPLETE] แสดงข้อมูลตัวอย่างสำหรับ ${validatedIds.length} sources · ไม่ได้รัน pipeline จริง`
  );

  return { lines, finalStatus: 'succeeded', validatedIds, blockedIds, missingUpstream };
}

function StageStatusIcon({ state }: { state: 'waiting' | 'running' | 'complete' | 'failed' }) {
  if (state === 'complete') return <CheckCircle2 size={16} />;
  if (state === 'running') return <Loader2 size={16} className="pw-spin" />;
  if (state === 'failed') return <X size={16} />;
  return <Circle size={16} />;
}

export const PipelineStoryView: React.FC<PipelineStoryViewProps> = ({ page = 'walkthrough' }) => {
  const { catalog } = useWebsiteData();
  const pipelineSteps = catalog!.data.pipelineSteps;
  const [activeTab, setActiveTab] = useState<WorkbenchTab>(page === 'query' ? 'query' : 'run');
  const [snapshot, setSnapshot] = useState<PipelineDemoSnapshot | null>(null);
  const [sources, setSources] = useState<SourceRegistryEntry[]>([]);
  const [loadError, setLoadError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [sourceSearch, setSourceSearch] = useState('');
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const forceRefresh = false;
  const includeDatabase = true;
  const [runError, setRunError] = useState('');

  const [runStatus, setRunStatus] = useState<RunStatus>('idle');
  const [runSourceIds, setRunSourceIds] = useState<string[]>([]);
  const [runIncludeDatabase, setRunIncludeDatabase] = useState(true);
  const [logs, setLogs] = useState<string[]>([]);
  const [demoDataResetMessage, setDemoDataResetMessage] = useState('');

  const [selectedStep, setSelectedStep] = useState<PipelineStep>(pipelineSteps[0]);
  const [sqlPreset, setSqlPreset] = useState<SqlPresetKey>('traceback');
  const [selectedPreviewTable, setSelectedPreviewTable] = useState<DbTableName>('LCI_EXCHANGE');
  const [querySidebarTab, setQuerySidebarTab] = useState<'presets' | 'tables'>('presets');
  const [queryHasRun, setQueryHasRun] = useState(false);
  const [querySql, setQuerySql] = useState('');
  const [queryResult, setQueryResult] = useState<SqlQueryResult | null>(null);
  const [queryError, setQueryError] = useState('');
  const [queryRunning, setQueryRunning] = useState(false);
  const [copiedQueryRow, setCopiedQueryRow] = useState<number | null>(null);
  const [traceQueryTuple, setTraceQueryTuple] = useState<{ columns: string[]; values: unknown[] } | null>(null);
  const [traceSearch, setTraceSearch] = useState('');
  const [traceResults, setTraceResults] = useState<SqlQueryResult | null>(null);
  const [traceSources, setTraceSources] = useState<Record<string, unknown>[]>([]);
  const [traceSelectedId, setTraceSelectedId] = useState('');
  const [traceSelectedFlowName, setTraceSelectedFlowName] = useState('');
  const [traceSelectedSourceId, setTraceSelectedSourceId] = useState('');
  const [traceMappedOutput, setTraceMappedOutput] = useState<{ processName: string; processYear: string; flowName: string; amount: string; unit: string; direction: string; allocation?: string; isReference?: string; allocationShare?: string; allocationMethod?: string; allocatedVolume?: string; allocationUnit?: string } | null>(null);
  const [traceShowAllPrimarySources, setTraceShowAllPrimarySources] = useState(false);
  const [traceShowSupportingSources, setTraceShowSupportingSources] = useState(false);
  const traceRequestId = useRef(0);
  const [traceLoading, setTraceLoading] = useState(false);
  const [traceError, setTraceError] = useState('');
  const [isPresenting, setIsPresenting] = useState(false);

  const [explorerStageKey, setExplorerStageKey] = useState('mapping');
  const [explorerFilePath, setExplorerFilePath] = useState('');
  const [activeSheet, setActiveSheet] = useState<string>('');
  const [explorerExpandedFolders, setExplorerExpandedFolders] = useState<Record<string, boolean>>({
    'web/data': true,
    'web/data/raw': false,
    'web/data/parsed': false,
    'web/data/staging': false,
    'web/data/mapping': false,
    'web/data/validation': false,
    'web/data/validation/accepted': false,
    'web/data/validation/rejected': false,
    'web/data/database': false,
    'web/data/database/csv': false,
    'web/data/database/sql': false,
    'web/data/database/xlsx': false,
  });
  const [preview, setPreview] = useState<EditorPreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState('');
  const [previewRetryKey, setPreviewRetryKey] = useState(0);
  const terminalRef = useRef<HTMLDivElement>(null);
  const runTimerRef = useRef<number | null>(null);
  const runAcquisitionOpenedRef = useRef(false);

  useEffect(() => () => {
    if (runTimerRef.current !== null) window.clearTimeout(runTimerRef.current);
  }, []);

  const computeDbForSources = (snap: PipelineDemoSnapshot | null, targetSourceIds: string[], withDb: boolean) => {
    const dbTables = snap?.databaseTables;
    const hasUpProd = targetSourceIds.some((id) => UPSTREAM_PRODUCTION_IDS.includes(id));
    const missingUp = hasUpProd ? UPSTREAM_CLUSTER_IDS.filter((id) => !targetSourceIds.includes(id)) : [];
    const blocked = missingUp.length > 0;
    const validIds = targetSourceIds.filter((id) => !(blocked && UPSTREAM_PRODUCTION_IDS.includes(id)));

    if (!withDb || blocked || validIds.length === 0 || !dbTables) {
      return {
        ready: false,
        blocked,
        missingUp,
        validIds,
        tables: {
          SOURCE: [] as Record<string, string>[],
          REFERENCE: [] as Record<string, string>[],
          EXTRACTION_BATCH: [] as Record<string, string>[],
          UNIT: [] as Record<string, string>[],
          LOCATION: [] as Record<string, string>[],
          FLOW: [] as Record<string, string>[],
          PROCESS: [] as Record<string, string>[],
          LCI_EXCHANGE: [] as Record<string, string>[],
          QUALITY_CHECK: [] as Record<string, string>[],
          REJECTED_RECORD: [] as Record<string, string>[],
        },
        counts: {
          QUALITY_CHECK: 0,
          LCI_EXCHANGE: 0,
          PROCESS: 0,
          FLOW: 0,
          EXTRACTION_BATCH: 0,
          REFERENCE: 0,
          LOCATION: 0,
          UNIT: 0,
          SOURCE: 0,
          REJECTED_RECORD: 0,
        },
      };
    }

    const numericIds = new Set(validIds.map((sid) => String(Number(sid.replace(/^SRC-/i, '')))));
    const rawSources = dbTables.SOURCE.filter((row) => numericIds.has(String(row.source_id)));
    const rawRefs = dbTables.REFERENCE.filter((row) => numericIds.has(String(row.source_id)));
    const rawBatches = dbTables.EXTRACTION_BATCH.filter((row) => numericIds.has(String(row.source_id)));

    const origBatchIds = new Set(rawBatches.map((row) => String(row.batch_id)));
    const rawExchanges = dbTables.LCI_EXCHANGE.filter((row) => origBatchIds.has(String(row.batch_id)));
    const rawRejected = dbTables.REJECTED_RECORD.filter((row) => origBatchIds.has(String(row.batch_id)));
    const exchangeIds = new Set(rawExchanges.map((row) => String(row.exchange_id)));
    const rawQc = dbTables.QUALITY_CHECK.filter((row) => exchangeIds.has(String(row.exchange_id)));

    const origProcessIds = new Set(rawExchanges.map((row) => String(row.process_id)));
    const origFlowIds = new Set(rawExchanges.map((row) => String(row.flow_id)));
    const rawProcesses = dbTables.PROCESS.filter((row) => origProcessIds.has(String(row.process_id)));
    const rawFlows = dbTables.FLOW.filter((row) => origFlowIds.has(String(row.flow_id)));

    const origLocationIds = new Set(rawProcesses.map((row) => String(row.location_id)));
    const origUnitIds = new Set([
      ...rawExchanges.map((row) => String(row.unit_id)),
      ...rawFlows.map((row) => String(row.default_unit_id)),
    ]);
    const rawLocations = dbTables.LOCATION.filter((row) => origLocationIds.has(String(row.location_id)));
    const rawUnits = dbTables.UNIT.filter((row) => origUnitIds.has(String(row.unit_id)));

    return {
      ready: true,
      blocked: false,
      missingUp: [] as string[],
      validIds,
      tables: {
        SOURCE: rawSources,
        REFERENCE: rawRefs,
        EXTRACTION_BATCH: rawBatches,
        UNIT: rawUnits,
        LOCATION: rawLocations,
        FLOW: rawFlows,
        PROCESS: rawProcesses,
        LCI_EXCHANGE: rawExchanges,
        QUALITY_CHECK: rawQc,
        REJECTED_RECORD: rawRejected,
      },
      counts: {
        QUALITY_CHECK: rawQc.length,
        LCI_EXCHANGE: rawExchanges.length,
        PROCESS: rawProcesses.length,
        FLOW: rawFlows.length,
        EXTRACTION_BATCH: rawBatches.length,
        REFERENCE: rawRefs.length,
        LOCATION: rawLocations.length,
        UNIT: rawUnits.length,
        SOURCE: rawSources.length,
        REJECTED_RECORD: rawRejected.length,
      },
    };
  };

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    Promise.all([
      fetch('/pipeline_demo.json', { headers: { Accept: 'application/json' } }),
      fetch('/source_registry.json', { headers: { Accept: 'application/json' } }),
    ])
      .then(async ([snapshotResponse, registryResponse]) => {
        if (!snapshotResponse.ok || !registryResponse.ok) throw new Error('ไม่สามารถโหลดไฟล์ไปป์ไลน์ที่เตรียมไว้จาก web/data/ ได้');
        const [nextSnapshot, registry] = await Promise.all([snapshotResponse.json(), registryResponse.json()]);
        if (!Array.isArray(nextSnapshot.sourceReplays) || !Array.isArray(nextSnapshot.stages) || !Array.isArray(registry.sources)) {
          throw new Error('แพ็กเกจไปป์ไลน์ที่บันทึกไว้ไม่มีข้อมูลแหล่งที่มาหรือทะเบียนแหล่งข้อมูล');
        }
        return { nextSnapshot: nextSnapshot as PipelineDemoSnapshot, nextSources: registry.sources as SourceRegistryEntry[] };
      })
      .then(({ nextSnapshot, nextSources }) => {
        if (cancelled) return;
        setSnapshot(nextSnapshot);
        setSources(nextSources);
        const saved = readSavedSources();
        const available = new Set(nextSnapshot.sourceIds);
        const initialSelected = saved === null
          ? nextSnapshot.sourceIds
          : saved.filter((sourceId) => available.has(sourceId));
        const effectiveSelected = initialSelected.length > 0 ? initialSelected : nextSnapshot.sourceIds;
        setSelectedSourceIds(effectiveSelected);
        setRunIncludeDatabase(true);

        // The checked-in snapshot is the replay source, not a completed run.
        // Start with a clean workbench after every page load; results appear only
        // after the user explicitly starts the pipeline.
        setRunSourceIds([]);
        setLogs([]);
        setRunStatus('idle');
        setExplorerFilePath('');
        setPreview(null);
        setPreviewError('');
      })
      .catch((error) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : 'ไม่สามารถโหลดชุดข้อมูลไปป์ไลน์ที่เตรียมไว้ได้');
      });
    return () => { cancelled = true; };
  }, [retryKey]);

  useEffect(() => {
    if (!snapshot) return;
    try {
      window.localStorage.setItem(PREFERENCE_KEY, JSON.stringify(selectedSourceIds));
    } catch {
      // Browser storage is optional.
    }
  }, [selectedSourceIds, snapshot]);

  const approvedSources = useMemo(() => {
    if (!snapshot) return [];
    const registryById = new Map(sources.map((source) => [source.sourceId, source]));
    return snapshot.sourceIds.map((sourceId) => registryById.get(sourceId)).filter((source): source is SourceRegistryEntry => Boolean(source));
  }, [snapshot, sources]);

  const filteredSources = useMemo(() => {
    const query = sourceSearch.trim().toLocaleLowerCase();
    if (!query) return approvedSources;
    return approvedSources.filter((source) => `${source.sourceId} ${source.title} ${source.publisher}`.toLocaleLowerCase().includes(query));
  }, [approvedSources, sourceSearch]);

  const computedDatabase = useMemo(
    () => computeDbForSources(snapshot, runSourceIds, runIncludeDatabase),
    [snapshot, runSourceIds, runIncludeDatabase]
  );

  const explorerStages = useMemo<PipelineFileStage[]>(() => {
    if (!snapshot) return [];
    const runSet = new Set(runSourceIds);
    const validSet = new Set(computedDatabase.validIds);
    const stageSources: Record<'raw' | 'parsed' | 'staging' | 'mapping' | 'accepted', Set<string>> = {
      raw: new Set(),
      parsed: new Set(),
      staging: new Set(),
      mapping: new Set(),
      accepted: new Set(),
    };
    logs.forEach((line) => {
      const sourceId = line.match(/SRC-\d{3}/i)?.[0].toUpperCase();
      if (!sourceId) return;
      if (/\[PREPARED DATA\]/i.test(line)) stageSources.raw.add(sourceId);
      if (/\[PARSED\]/i.test(line)) stageSources.parsed.add(sourceId);
      if (/\[STAGED\]/i.test(line)) stageSources.staging.add(sourceId);
      if (/\[MAPPED\]/i.test(line)) stageSources.mapping.add(sourceId);
      if (/\[VALIDATED\]/i.test(line)) stageSources.accepted.add(sourceId);
    });
    const databaseGenerated = logs.some((line) => line.includes('[EXAMPLE COMPLETE]'));

    return snapshot.stages.map((stage) => {
      let files: PipelineFile[] = [];
      if (stage.key === 'raw') {
        files = stage.files.filter((file) => {
          if (file.name === '_provenance_ledger.jsonl') return stageSources.raw.size > 0;
          const prefix = file.name.split('_', 1)[0].toUpperCase();
          return runSet.has(prefix) && stageSources.raw.has(prefix);
        });
      } else if (stage.key === 'parsed' || stage.key === 'staging') {
        const completedSources = stageSources[stage.key];
        files = stage.files.filter((file) => {
          const prefix = file.name.split('_', 1)[0].toUpperCase();
          return runSet.has(prefix) && completedSources.has(prefix);
        });
      } else if (stage.key === 'mapping') {
        files = stage.files.filter((file) => {
          const prefix = file.name.split('_', 1)[0].toUpperCase();
          return validSet.has(prefix) && stageSources.mapping.has(prefix);
        });
      } else if (stage.key === 'accepted' || stage.key === 'rejected') {
        files = stage.files.filter((file) => {
          const prefix = file.name.split('_', 1)[0].toUpperCase();
          return validSet.has(prefix) && stageSources.accepted.has(prefix);
        });
      } else if (stage.key === 'database') {
        files = computedDatabase.ready && databaseGenerated ? stage.files : [];
      }
      return {
        ...stage,
        fileCount: files.length,
        files,
      };
    });
  }, [snapshot, runSourceIds, computedDatabase.validIds, computedDatabase.ready, logs]);

  // Find the currently selected file across all stages
  const explorerSelection = useMemo(() => {
    for (const stage of explorerStages) {
      const found = stage.files.find((f) => f.path === explorerFilePath);
      if (found) return { stage, file: found };
    }
    return { stage: explorerStages.find((s) => s.key === explorerStageKey) || null, file: null };
  }, [explorerStages, explorerFilePath, explorerStageKey]);

  const activeExplorerStage = explorerSelection.stage;
  const explorerFile = explorerSelection.file;

  const allVisibleSelected = filteredSources.length > 0 && filteredSources.every((source) => selectedSourceIds.includes(source.sourceId));
  const activeRun = runStatus === 'running';
  const activeStage = getActiveStepNumber(logs);
  const allocationBlock = runStatus === 'blocked'
    ? `ขาดไฟล์ Staged ของ ${computedDatabase.missingUp.join(', ')}`
    : undefined;

  useEffect(() => {
    const terminal = terminalRef.current;
    if (terminal && activeRun) {
      terminal.scrollTop = terminal.scrollHeight;
    }
  }, [logs, activeRun]);

  // Open any clicked file in the right-side IDE editor
  useEffect(() => {
    if (!explorerFile) {
      setPreview(null);
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }

    const ext = explorerFile.extension.toLowerCase();
    const baseNameUpper = explorerFile.name.replace(/\.[^.]+$/, '').toUpperCase();

    // 1. Provenance ledger (.jsonl) filtered by runSourceIds
    if (explorerFile.name === '_provenance_ledger.jsonl' && snapshot?.provenanceLedger) {
      const runSet = new Set(runSourceIds);
      const filteredLedger = snapshot.provenanceLedger.filter((entry) =>
        runSet.has(String(entry.source_id || '').toUpperCase())
      );
      const columns = Array.from(new Set(filteredLedger.flatMap((record) => Object.keys(record))));
      const rows = filteredLedger.slice(0, 50).map((record) => columns.map((col) => formatCell(record[col])));
      setPreview({
        kind: 'table',
        columns,
        rows,
        totalRows: filteredLedger.length,
        sheetNames: [],
        activeSheet: null,
      });
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }

    // 2. Database CSV, XLSX, or SQLite (.db) backed by computedDatabase.tables
    const isMultiSheetWorkbook =
      explorerFile.name === 'all_tables.xlsx' ||
      explorerFile.name === 'petroleum_database.xlsx' ||
      explorerFile.name === 'petroleum.db';
    const isSingleDbTableFile =
      activeExplorerStage?.key === 'database' &&
      (ext === 'csv' || ext === 'xlsx') &&
      (DB_TABLE_NAMES as readonly string[]).includes(baseNameUpper);

    if (isMultiSheetWorkbook || isSingleDbTableFile) {
      const sheetNames: string[] = isMultiSheetWorkbook
        ? [...DB_TABLE_NAMES]
        : [baseNameUpper];
      const currentSheet = (activeSheet && sheetNames.includes(activeSheet) ? activeSheet : sheetNames[0]) as DbTableName;
      const tableRows = computedDatabase.tables[currentSheet] || [];
      const columns = tableRows.length > 0 ? Object.keys(tableRows[0]) : (DEFAULT_TABLE_HEADERS[currentSheet] || []);
      const rows = tableRows.slice(0, 50).map((record) => columns.map((col) => formatCell(record[col])));
      setPreview({
        kind: 'table',
        columns,
        rows,
        totalRows: tableRows.length,
        sheetNames: sheetNames.length > 1 ? sheetNames : [],
        activeSheet: currentSheet,
      });
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }

    // 3. PDF files in raw/
    if (ext === 'pdf') {
      setPreview({
        kind: 'pdf',
        columns: [],
        rows: [],
        totalRows: 0,
        sheetNames: [],
        activeSheet: null,
        pdfUrl: explorerFile.publicUrl,
      });
      setPreviewError('');
      setPreviewLoading(false);
      return;
    }

    // 4. SQL or JSON files in database/
    if (ext === 'sql' || ext === 'json') {
      let cancelled = false;
      setPreview(null);
      setPreviewError('');
      setPreviewLoading(true);
      fetch(explorerFile.publicUrl)
        .then(async (response) => {
          if (!response.ok) throw new Error(`ไม่สามารถเปิดไฟล์ ${explorerFile.name} (${response.status})`);
          return response.text();
        })
        .then((text) => {
          if (cancelled) return;
          const lines = text.split(/\r?\n/);
          setPreview({
            kind: 'code',
            columns: [],
            rows: [],
            totalRows: lines.length,
            sheetNames: [],
            activeSheet: null,
            codeText: lines.slice(0, 300).join('\n'),
          });
        })
        .catch((error) => {
          if (!cancelled) setPreviewError(error instanceof Error ? error.message : 'เปิดไฟล์ไม่สำเร็จ');
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
      return () => { cancelled = true; };
    }

    // 5. Standard CSV/JSONL files in raw/, parsed/, staging/, mapping/, validation/, database/
    if (ext === 'csv' || ext === 'jsonl') {
      let cancelled = false;
      setPreview(null);
      setPreviewError('');
      setPreviewLoading(true);
      fetch(explorerFile.publicUrl)
        .then(async (response) => {
          if (!response.ok) throw new Error(`อ่านไฟล์ในแพ็กเกจไม่ได้ (${response.status})`);
          return ext === 'csv' ? decodeCsv(await response.arrayBuffer()) : response.text();
        })
        .then((text) => {
          if (cancelled) return;
          const parsed = ext === 'jsonl' ? parseJsonl(text) : parseCsv(text);
          setPreview({
            kind: 'table',
            columns: parsed.columns,
            rows: parsed.rows,
            totalRows: parsed.totalRows,
            sheetNames: [],
            activeSheet: null,
          });
        })
        .catch((error) => {
          if (!cancelled) setPreviewError(error instanceof Error ? error.message : 'ไม่สามารถอ่านไฟล์ในแพ็กเกจนี้ได้');
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false);
        });
      return () => { cancelled = true; };
    }

    setPreview(null);
    setPreviewError('');
    setPreviewLoading(false);
    return undefined;
  }, [explorerFile, activeExplorerStage?.key, activeSheet, runSourceIds, computedDatabase, snapshot?.provenanceLedger, previewRetryKey]);

  const handleStartRun = () => {
    if (!snapshot) return;
    if (!selectedSourceIds.length) {
      setRunError('เลือกแหล่งข้อมูลอย่างน้อย 1 รายการก่อนเริ่ม run');
      return;
    }
    setRunError('');
    setDemoDataResetMessage('');
    if (runTimerRef.current !== null) window.clearTimeout(runTimerRef.current);

    const targetIds = [...selectedSourceIds].sort();
    const stageMap = new Map(snapshot.stages.map((s) => [s.key, s.files]));
    const dbInfo = computeDbForSources(snapshot, targetIds, includeDatabase);
    const replays = snapshot.sourceReplays.filter((r) => targetIds.includes(r.sourceId));
    const built = buildTerminalLines(replays, stageMap, forceRefresh, includeDatabase, dbInfo.counts);

    setRunStatus('running');
    setRunSourceIds(targetIds);
    setRunIncludeDatabase(includeDatabase);
    runAcquisitionOpenedRef.current = false;
    setLogs([]);
    let cursor = 0;
    const revealNextLine = () => {
      cursor = Math.min(built.lines.length, cursor + 1);
      const revealedLine = built.lines[cursor - 1];
      setLogs(built.lines.slice(0, cursor));
      if (!runAcquisitionOpenedRef.current && /\[PREPARED DATA\]/i.test(revealedLine)) {
        const sourceId = revealedLine.match(/SRC-\d{3}/i)?.[0].toUpperCase();
        const rawFile = sourceId && (stageMap.get('raw') || []).find((file) => file.name.toUpperCase().startsWith(`${sourceId}_`));
        if (rawFile) {
          runAcquisitionOpenedRef.current = true;
          setExplorerStageKey('raw');
          setExplorerFilePath(rawFile.path);
          setExplorerExpandedFolders((current) => ({ ...current, 'web/data': true, 'web/data/raw': true }));
        }
      }
      if (cursor >= built.lines.length) {
        runTimerRef.current = null;
        setRunStatus(built.finalStatus);
        // Auto-open the first mapped or raw file in the IDE after run completes
        const nextValidIds = new Set(dbInfo.validIds);
        const mappingFiles = (stageMap.get('mapping') || []).filter((f) => nextValidIds.has(f.name.split('_', 1)[0].toUpperCase()));
        const rawFiles = (stageMap.get('raw') || []).filter((f) => targetIds.includes(f.name.split('_', 1)[0].toUpperCase()));
        if (mappingFiles.length > 0) {
          setExplorerStageKey('mapping');
          setExplorerFilePath(mappingFiles[0].path);
          setExplorerExpandedFolders((curr) => ({ ...curr, 'web/data': true, 'web/data/mapping': true }));
        } else if (rawFiles.length > 0) {
          setExplorerStageKey('raw');
          setExplorerFilePath(rawFiles[0].path);
          setExplorerExpandedFolders((curr) => ({ ...curr, 'web/data': true, 'web/data/raw': true }));
        }
        return;
      }
      // Vary the pause so the simulated process output feels like a live stream.
      const delayMs = 75 + Math.floor(Math.random() * 146);
      runTimerRef.current = window.setTimeout(revealNextLine, delayMs);
    };
    runTimerRef.current = window.setTimeout(revealNextLine, 75 + Math.floor(Math.random() * 146));
  };

  const handleCancelRun = () => {
    if (runTimerRef.current !== null) window.clearTimeout(runTimerRef.current);
    runTimerRef.current = null;
    setRunStatus('idle');
    setLogs((current) => [...current, '[CANCELLED] หยุดการแสดงตัวอย่างตามคำขอของผู้ใช้']);
  };

  const handleResetWebDemoData = () => {
    if (runTimerRef.current !== null) window.clearTimeout(runTimerRef.current);
    runTimerRef.current = null;
    setRunStatus('idle');
    setRunSourceIds([]);
    setLogs([]);
    setExplorerFilePath('');
    setActiveSheet('');
    setPreview(null);
    setPreviewError('');
    setDemoDataResetMessage('รีเซ็ตสถานะตัวอย่างและซ่อนผลลัพธ์ใน IDE แล้ว · ไฟล์ใน web/data/ ไม่ได้ถูกลบ');
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

  // Pure folder expand/collapse toggle (like VS Code)
  const toggleExplorerFolder = (folderKey: string, stageKey?: string) => {
    if (stageKey) setExplorerStageKey(stageKey);
    setExplorerExpandedFolders((current) => ({ ...current, [folderKey]: !current[folderKey] }));
  };

  // Open a file on the right side when clicked
  const handleSelectFile = (stage: PipelineFileStage, file: PipelineFile) => {
    setExplorerStageKey(stage.key);
    setExplorerFilePath(file.path);
    setActiveSheet('');
  };

  const explorerStageFor = (key: string) => explorerStages.find((stage) => stage.key === key);
  const databaseStage = explorerStageFor('database');
  const mappingStage = explorerStageFor('mapping');
  const parsedStage = explorerStageFor('parsed');
  const rawStage = explorerStageFor('raw');
  const stagingStage = explorerStageFor('staging');
  const acceptedStage = explorerStageFor('accepted');
  const rejectedStage = explorerStageFor('rejected');
  const validationFileCount = (acceptedStage?.fileCount || 0) + (rejectedStage?.fileCount || 0);
  const totalExplorerFiles = explorerStages.reduce((total, stage) => total + stage.fileCount, 0);

  const renderExplorerFileRow = (stage: PipelineFileStage, file: PipelineFile, depth: number) => {
    let rightLabel = formatFileSize(file.sizeBytes);
    if (stage.key === 'database' && (file.relativePath.startsWith('csv/') || file.relativePath.startsWith('xlsx/'))) {
      const tableName = file.name.replace(/\.(csv|xlsx)$/i, '').toUpperCase() as keyof typeof computedDatabase.counts;
      if (tableName in computedDatabase.counts) {
        rightLabel = `${formatCount(computedDatabase.counts[tableName])} rows`;
      }
    } else if (file.name === '_provenance_ledger.jsonl') {
      rightLabel = `${formatCount(runSourceIds.length)} rows`;
    }
    const ext = file.extension.toLowerCase();
    return (
      <button
        key={file.path}
        type="button"
        className={`pw-vscode-file ${explorerFile?.path === file.path ? 'is-selected' : ''}`}
        style={{ paddingLeft: `${depth * 12}px` }}
        onClick={() => handleSelectFile(stage, file)}
        aria-pressed={explorerFile?.path === file.path}
        title={file.path}
      >
        {ext === 'jsonl' || ext === 'sql' || ext === 'json' ? (
          <FileCode2 size={13} />
        ) : ext === 'csv' || ext === 'xlsx' || ext === 'db' ? (
          <FileSpreadsheet size={13} />
        ) : (
          <FileText size={13} />
        )}
        <span><strong>{file.name}</strong><small><CalendarDays size={10} />{formatDate(file.modifiedAt)}</small></span>
        <em>{rightLabel}</em>
      </button>
    );
  };

  const renderExplorerStageFolder = (stage: PipelineFileStage | undefined, folderPath: string, label: string, depth: number) => {
    const isExpanded = Boolean(explorerExpandedFolders[folderPath]);
    const files = stage?.files || [];
    const directFiles = files.filter((file) => !file.relativePath.includes('/'));
    return (
      <React.Fragment key={folderPath}>
        <button
          type="button"
          className={`pw-vscode-folder ${explorerStageKey === stage?.key ? 'is-selected' : ''}`}
          style={{ paddingLeft: `${depth * 12}px` }}
          onClick={() => toggleExplorerFolder(folderPath, stage?.key)}
          aria-expanded={isExpanded}
        >
          <ChevronRight size={11} className={isExpanded ? 'is-expanded' : ''} />
          {isExpanded ? <FolderOpen size={13} /> : <Folder size={13} />}
          <span><strong>{label}</strong><small>{formatCount(files.length)} files</small></span>
        </button>
        {isExpanded && (
          <div className="pw-vscode-tree-children">
            {directFiles.length === 0 ? (
              <div className="pw-vscode-file-header" style={{ paddingLeft: `${(depth + 1) * 12}px` }}>ไม่มีไฟล์ในโฟลเดอร์นี้</div>
            ) : (
              directFiles.map((file) => stage && renderExplorerFileRow(stage, file, depth + 1))
            )}
          </div>
        )}
      </React.Fragment>
    );
  };

  const renderDatabaseFolder = () => {
    const folderPath = 'web/data/database';
    const isExpanded = Boolean(explorerExpandedFolders[folderPath]);
    const files = databaseStage?.files || [];
    const subfolders = ['csv', 'sql', 'xlsx'];
    const directFiles = files.filter((file) => !file.relativePath.includes('/'));

    return (
      <React.Fragment key={folderPath}>
        <button
          type="button"
          className={`pw-vscode-folder ${explorerStageKey === 'database' ? 'is-selected' : ''}`}
          style={{ paddingLeft: '12px' }}
          onClick={() => toggleExplorerFolder(folderPath, 'database')}
          aria-expanded={isExpanded}
        >
          <ChevronRight size={11} className={isExpanded ? 'is-expanded' : ''} />
          {isExpanded ? <FolderOpen size={13} /> : <Folder size={13} />}
          <span><strong>database</strong><small>{formatCount(files.length)} files</small></span>
        </button>
        {isExpanded && (
          <div className="pw-vscode-tree-children">
            {subfolders.map((sub) => {
              const subPath = `${folderPath}/${sub}`;
              const subExpanded = Boolean(explorerExpandedFolders[subPath]);
              const subFiles = files.filter((file) => file.relativePath.startsWith(`${sub}/`));
              return (
                <React.Fragment key={subPath}>
                  <button
                    type="button"
                    className={`pw-vscode-folder pw-vscode-subfolder ${subExpanded ? 'is-selected' : ''}`}
                    style={{ paddingLeft: '24px' }}
                    onClick={() => toggleExplorerFolder(subPath, 'database')}
                    aria-expanded={subExpanded}
                  >
                    <ChevronRight size={11} className={subExpanded ? 'is-expanded' : ''} />
                    {subExpanded ? <FolderOpen size={13} /> : <Folder size={13} />}
                    <span><strong>{sub}</strong><small>{formatCount(subFiles.length)} files</small></span>
                  </button>
                  {subExpanded && (
                    <div className="pw-vscode-tree-children">
                      {subFiles.length === 0 ? (
                        <div className="pw-vscode-file-header" style={{ paddingLeft: '36px' }}>ไม่มีไฟล์ในโฟลเดอร์นี้</div>
                      ) : (
                        subFiles.map((file) => databaseStage && renderExplorerFileRow(databaseStage, file, 3))
                      )}
                    </div>
                  )}
                </React.Fragment>
              );
            })}
            {directFiles.map((file) => databaseStage && renderExplorerFileRow(databaseStage, file, 2))}
          </div>
        )}
      </React.Fragment>
    );
  };

  const stageState = (stepNumber: number): 'waiting' | 'running' | 'complete' | 'failed' => {
    if (runStatus === 'idle' && logs.length === 0) return 'waiting';
    if (runStatus === 'blocked') return stepNumber < 5 ? 'complete' : stepNumber === 5 ? 'failed' : 'waiting';
    if (stepNumber === 7 && !runIncludeDatabase) return 'waiting';
    if (runStatus === 'succeeded') return 'complete';
    if (activeStage && stepNumber < activeStage) return 'complete';
    if (activeStage && stepNumber === activeStage && activeRun) return 'running';
    return 'waiting';
  };

  const dynamicQuery = useMemo(() => {
    const { tables, counts, ready, validIds } = computedDatabase;
    const querySourceIds = page === 'query'
      ? (snapshot?.databaseTables?.SOURCE || []).map((source) => `SRC-${String(source.source_id).padStart(3, '0')}`)
      : validIds;
    const querySourceNumbers = page === 'query'
      ? (snapshot?.databaseTables?.SOURCE || []).map((source) => String(source.source_id))
      : validIds.map((id) => String(Number(id.replace(/^SRC-/i, ''))));
    const srcNumList = querySourceNumbers.join(', ') || '0';
    const headerComment = querySourceIds.length
      ? `-- ค้นจากฐานข้อมูลที่เตรียมไว้ ${querySourceIds.length} sources (${formatSourceRanges(querySourceIds)})`
      : '-- ยังไม่มี source ใน preview (เลือก source และเริ่มการสาธิตในแท็บ 01)';
    const emptyQuerySql = `${headerComment}\n-- เริ่มการสาธิตในแท็บ 01 เพื่อเลือก source และแสดง query ตัวอย่าง`;

    const presets: Record<SqlPresetKey, { label: string; description: string; sql: string; columns: string[]; rows: unknown[][]; totalRows: number }> = {
      exchanges: {
        label: 'ตัวอย่าง LCI Exchange',
        description: 'เชื่อม process, flow, unit และ source จากแหล่งที่เลือก',
        sql: `${headerComment}\nSELECT\n  e.exchange_id,\n  'SRC-0' || r.source_id AS source_id,\n  p.process_name,\n  p.process_year,\n  f.flow_name,\n  e.direction,\n  e.amount,\n  u.symbol AS unit\nFROM LCI_EXCHANGE AS e\nJOIN PROCESS AS p ON p.process_id = e.process_id\nJOIN FLOW AS f ON f.flow_id = e.flow_id\nJOIN UNIT AS u ON u.unit_id = e.unit_id\nJOIN REFERENCE AS r ON r.reference_id = e.reference_id\nWHERE r.source_id IN (${srcNumList})\nORDER BY CAST(e.exchange_id AS INTEGER)\nLIMIT 50;`,
        columns: ['exchange_id', 'source_id', 'process_name', 'process_year', 'flow_name', 'direction', 'amount', 'unit'],
        rows: ready ? tables.LCI_EXCHANGE.slice(0, 50).map((e) => {
          const p = tables.PROCESS.find((row) => String(row.process_id) === String(e.process_id));
          const f = tables.FLOW.find((row) => String(row.flow_id) === String(e.flow_id));
          const u = tables.UNIT.find((row) => String(row.unit_id) === String(e.unit_id));
          const r = tables.REFERENCE.find((row) => String(row.reference_id) === String(e.reference_id));
          return [
            e.exchange_id,
            r ? `SRC-${String(r.source_id).padStart(3, '0')}` : '—',
            p?.process_name || '—',
            p?.process_year || '—',
            f?.flow_name || '—',
            e.direction,
            e.amount,
            u?.symbol || '—',
          ];
        }) : [],
        totalRows: counts.LCI_EXCHANGE,
      },
      by_source: {
        label: 'ขอบเขตและความครอบคลุมของข้อมูล',
        description: 'ดูจำนวน exchange, process, ปี และชนิด flow ของแต่ละแหล่ง',
        sql: `${headerComment}\nSELECT\n  'SRC-0' || s.source_id AS source_id,\n  s.title,\n  COUNT(DISTINCT p.process_id) AS process_count,\n  COUNT(e.exchange_id) AS exchange_count\nFROM SOURCE AS s\nLEFT JOIN REFERENCE AS r USING (source_id)\nLEFT JOIN LCI_EXCHANGE AS e USING (reference_id)\nLEFT JOIN PROCESS AS p ON p.process_id = e.process_id\nWHERE s.source_id IN (${srcNumList})\nGROUP BY s.source_id, s.title\nORDER BY CAST(s.source_id AS INTEGER);`,
        columns: ['source_id', 'title', 'process_count', 'exchange_count'],
        rows: ready ? tables.SOURCE.map((s) => {
          const refIds = new Set(tables.REFERENCE.filter((r) => String(r.source_id) === String(s.source_id)).map((r) => String(r.reference_id)));
          const exRows = tables.LCI_EXCHANGE.filter((e) => refIds.has(String(e.reference_id)));
          const procIds = new Set(exRows.map((e) => String(e.process_id)));
          return [
            `SRC-${String(s.source_id).padStart(3, '0')}`,
            s.title,
            procIds.size,
            exRows.length,
          ];
        }) : [],
        totalRows: counts.SOURCE,
      },
      by_file: {
        label: 'ไฟล์ accepted จาก manifest',
        description: 'ข้อมูลไฟล์จาก manifest; SOURCE_FILE ไม่ใช่ตารางใน SQLite',
        sql: `${headerComment}\n-- ตัวอย่างนี้แสดง metadata จาก acceptedFiles ใน manifest\n-- SOURCE_FILE ไม่ใช่ตารางใน SQLite และ SQL นี้ไม่ได้ถูกรัน`,
        columns: ['source_id', 'title', 'publisher', 'source_url', 'accepted_file', 'file_path', 'sha256'],
        rows: ready ? snapshot?.acceptedFiles
          .filter((file) => validIds.includes(file.sourceId))
          .map((file) => {
            const source = tables.SOURCE.find((row) => String(row.source_id) === String(Number(file.sourceId.replace(/^SRC-/i, ''))));
            const registryEntry = sources.find((row) => row.sourceId === file.sourceId);
            return [
              file.sourceId,
              source?.title || registryEntry?.title || '—',
              source?.publisher || registryEntry?.publisher || '—',
              source?.url || registryEntry?.url || '—',
              file.file,
              file.sourcePath,
              file.sha256,
            ];
          }) || [] : [],
        totalRows: snapshot?.acceptedFiles.filter((file) => validIds.includes(file.sourceId)).length || 0,
      },
      processes: {
        label: 'รายการกระบวนการ (PROCESS)',
        description: 'แสดงกระบวนการ ปี และสถานที่จาก source ที่เลือก',
        sql: `${headerComment}\nSELECT\n  'SRC-0' || r.source_id AS source_id,\n  p.process_name,\n  p.domain,\n  p.process_year,\n  l.name AS location_name\nFROM PROCESS AS p\nJOIN LOCATION AS l USING (location_id)\nJOIN REFERENCE AS r USING (reference_id)\nWHERE r.source_id IN (${srcNumList})\nORDER BY CAST(r.source_id AS INTEGER), p.process_year DESC, p.process_id ASC\nLIMIT 50;`,
        columns: ['source_id', 'process_name', 'domain', 'process_year', 'location_name'],
        rows: ready ? [...tables.PROCESS].sort((left, right) => {
          const leftSourceId = Number(tables.REFERENCE.find((row) => String(row.reference_id) === String(left.reference_id))?.source_id || 0);
          const rightSourceId = Number(tables.REFERENCE.find((row) => String(row.reference_id) === String(right.reference_id))?.source_id || 0);
          if (leftSourceId !== rightSourceId) return leftSourceId - rightSourceId;
          const leftYear = Number(left.process_year);
          const rightYear = Number(right.process_year);
          if (Number.isFinite(leftYear) && Number.isFinite(rightYear) && leftYear !== rightYear) return rightYear - leftYear;
          if (Number.isFinite(leftYear) !== Number.isFinite(rightYear)) return Number.isFinite(leftYear) ? -1 : 1;
          return Number(left.process_id) - Number(right.process_id);
        }).slice(0, 50).map((p) => {
          const r = tables.REFERENCE.find((row) => String(row.reference_id) === String(p.reference_id));
          const l = tables.LOCATION.find((row) => String(row.location_id) === String(p.location_id));
          return [
            r ? `SRC-${String(r.source_id).padStart(3, '0')}` : '—',
            p.process_name,
            p.domain,
            p.process_year,
            l?.name || '—',
          ];
        }) : [],
        totalRows: counts.PROCESS,
      },
      qc_rules: {
        label: 'ข้อมูลที่ถูกกักกันและเหตุผล',
        description: 'ตรวจรายการที่ไม่ผ่าน QC พร้อม source และข้อความอธิบาย',
        sql: `${headerComment}\nSELECT printf('SRC-%03d', s.source_id) AS source_id, s.title, rr.rejected_id, rr.error_type, rr.raw_data FROM REJECTED_RECORD rr JOIN EXTRACTION_BATCH b USING(batch_id) JOIN SOURCE s USING(source_id) WHERE s.source_id IN (${srcNumList}) ORDER BY s.source_id, rr.rejected_id LIMIT 100;`,
        columns: ['source_id', 'title', 'rejected_id', 'error_type', 'raw_data'],
        rows: ready ? tables.REJECTED_RECORD.slice(0, 100).map((row) => {
          const batch = tables.EXTRACTION_BATCH.find((item) => String(item.batch_id) === String(row.batch_id));
          const source = tables.SOURCE.find((item) => String(item.source_id) === String(batch?.source_id));
          return [source ? `SRC-${String(source.source_id).padStart(3, '0')}` : '—', source?.title || '—', row.rejected_id, row.error_type, row.raw_data];
        }) : [],
        totalRows: counts.REJECTED_RECORD,
      },
      material_flows: {
        label: 'วัตถุดิบและการไหลของผลิตภัณฑ์',
        description: 'สำรวจน้ำมันดิบ ก๊าซ ผลิตภัณฑ์ และวัตถุดิบเข้าโรงกลั่นตาม process',
        sql: `${headerComment}\nSELECT printf('SRC-%03d', s.source_id) AS source_id, p.process_name, p.process_year, f.flow_name, e.direction, e.amount, u.symbol AS unit, f.flow_type, f.compartment FROM LCI_EXCHANGE e JOIN PROCESS p USING(process_id) JOIN FLOW f USING(flow_id) JOIN UNIT u USING(unit_id) JOIN REFERENCE r USING(reference_id) JOIN SOURCE s USING(source_id) WHERE s.source_id IN (${srcNumList}) AND f.flow_type='product' ORDER BY s.source_id, p.process_year DESC, f.flow_name LIMIT 100;`,
        columns: ['source_id', 'process_name', 'process_year', 'flow_name', 'direction', 'amount', 'unit', 'flow_type', 'compartment'],
        rows: [], totalRows: 0,
      },
      annual_impacts: {
        label: 'พลังงานและการปล่อยรายปี',
        description: 'เปรียบเทียบ flow ต่อปีและ source โดยแยกหน่วย ไม่รวมค่าคนละหน่วยเข้าด้วยกัน',
        sql: `${headerComment}\nSELECT printf('SRC-%03d', s.source_id) AS source_id, p.process_year, f.flow_name, e.direction, u.symbol AS unit, COUNT(*) AS exchange_count, ROUND(SUM(e.amount), 6) AS total_amount FROM LCI_EXCHANGE e JOIN PROCESS p USING(process_id) JOIN FLOW f USING(flow_id) JOIN UNIT u USING(unit_id) JOIN REFERENCE r USING(reference_id) JOIN SOURCE s USING(source_id) WHERE s.source_id IN (${srcNumList}) AND (f.flow_type='elementary' OR f.flow_name LIKE '%Energy%') GROUP BY s.source_id, p.process_year, f.flow_name, e.direction, u.symbol ORDER BY p.process_year DESC, s.source_id, f.flow_name LIMIT 200;`,
        columns: ['source_id', 'process_year', 'flow_name', 'direction', 'unit', 'exchange_count', 'total_amount'],
        rows: [], totalRows: 0,
      },
      upstream_fu: {
        label: 'LCI ต้นน้ำต่อ Functional Unit',
        description: 'ดู reference flow และภาระสิ่งแวดล้อมต่อหน่วยผลิตภัณฑ์ พร้อมปีและแหล่งข้อมูล',
        sql: `${headerComment}\nSELECT printf('SRC-%03d', s.source_id) AS source_id, p.process_year, p.process_name, f.flow_name, f.flow_type, f.compartment, e.direction, e.amount AS amount_per_fu, u.symbol AS unit, e.is_reference FROM LCI_EXCHANGE e JOIN PROCESS p USING(process_id) JOIN FLOW f USING(flow_id) JOIN UNIT u USING(unit_id) JOIN REFERENCE r USING(reference_id) JOIN SOURCE s USING(source_id) WHERE s.source_id IN (${srcNumList}) AND s.source_id BETWEEN 44 AND 47 ORDER BY p.process_year DESC, s.source_id, e.is_reference DESC, f.flow_name LIMIT 150;`,
        columns: ['source_id', 'process_year', 'process_name', 'flow_name', 'flow_type', 'compartment', 'direction', 'amount_per_fu', 'unit', 'is_reference'],
        rows: [], totalRows: 0,
      },
      mapping_changes: {
        label: 'ข้อมูลที่เปลี่ยนระหว่าง Raw และ Staging',
        description: 'ดูค่า Raw และ Staging ของแต่ละแถวต้นทาง พร้อมจำนวน LCI exchange ที่เชื่อมโยง',
        sql: `${headerComment}\nWITH selected_rows AS (
  SELECT sr.source_id, sr.source_record_id, sr.source_row_number, sr.source_locator,
         sr.source_values AS raw_values, sr.staged_values AS staging_values,
         sr.raw_file, sr.source_url
  FROM SOURCE_ROW sr
  WHERE CAST(SUBSTR(sr.source_id, 5) AS INTEGER) IN (${srcNumList})
    AND sr.source_values <> sr.staged_values
    AND EXISTS (
      SELECT 1 FROM EXCHANGE_SOURCE_ROW link
      WHERE link.source_id = sr.source_id AND link.source_record_id = sr.source_record_id
    )
  ORDER BY sr.source_id, CAST(sr.source_row_number AS INTEGER)
  LIMIT 100
)
SELECT selected_rows.*,
  (SELECT COUNT(*) FROM EXCHANGE_SOURCE_ROW link
   WHERE link.source_id = selected_rows.source_id
     AND link.source_record_id = selected_rows.source_record_id) AS linked_exchange_count
FROM selected_rows
ORDER BY source_id, CAST(source_row_number AS INTEGER);`,
        columns: ['source_id', 'source_record_id', 'source_row_number', 'source_locator', 'raw_values', 'staging_values', 'linked_exchange_count', 'raw_file', 'source_url'],
        rows: [], totalRows: 0,
      },
      traceback: {
        label: 'ตัวอย่างการสืบย้อนกลับ',
        description: 'ตัวอย่างนี้กรอง SRC-049 (EPPO) เพื่อเปิดหน้าเว็บชุดข้อมูลได้รวดเร็ว',
        sql: `-- ตัวอย่างการสืบย้อนกลับจาก SRC-049 (EPPO)\nSELECT\n  e.exchange_id, p.process_name, p.process_year, f.flow_name, e.direction,\n  e.amount AS mapped_amount, u.symbol AS mapped_unit,\n  sr.source_id, sr.source_record_id, sr.source_locator, sr.raw_file,\n  sr.source_values AS original_source_values, sr.staged_values AS cleaned_staged_values, sr.source_url\nFROM LCI_EXCHANGE AS e\nJOIN PROCESS AS p USING (process_id)\nJOIN FLOW AS f USING (flow_id)\nJOIN UNIT AS u USING (unit_id)\nJOIN REFERENCE AS ref USING (reference_id)\nJOIN EXCHANGE_SOURCE_ROW AS link ON link.exchange_id = e.exchange_id\nJOIN SOURCE_ROW AS sr ON sr.source_id = link.source_id\n  AND sr.source_record_id = link.source_record_id\nWHERE ref.source_id = 49\nORDER BY e.exchange_id, sr.source_id, CAST(sr.source_row_number AS INTEGER)\nLIMIT 50;`,
        columns: ['exchange_id', 'process_name', 'process_year', 'flow_name', 'direction', 'mapped_amount', 'mapped_unit', 'source_id', 'source_record_id', 'source_locator', 'raw_file', 'original_source_values', 'cleaned_staged_values', 'source_url'],
        rows: [],
        totalRows: 0,
      },
      table_preview: {
        label: `ตาราง ${selectedPreviewTable}`,
        description: 'ดูข้อมูลที่บันทึกไว้ในตารางจาก source ที่เลือก',
        sql: `${headerComment}\nSELECT *\nFROM ${selectedPreviewTable}\nLIMIT 50;`,
        columns: tables[selectedPreviewTable].length ? Object.keys(tables[selectedPreviewTable][0]) : DEFAULT_TABLE_HEADERS[selectedPreviewTable],
        rows: ready ? tables[selectedPreviewTable].slice(0, 50).map((row) => DEFAULT_TABLE_HEADERS[selectedPreviewTable].map((column) => row[column])) : [],
        totalRows: counts[selectedPreviewTable],
      },
    };

    if (!ready && page !== 'query') {
      Object.values(presets).forEach((preset) => {
        preset.sql = emptyQuerySql;
        preset.rows = [];
        preset.totalRows = 0;
      });
    }

    return presets;
  }, [computedDatabase, page, selectedPreviewTable, snapshot?.acceptedFiles, snapshot?.databaseTables?.SOURCE, sources]);

  const activePreset = dynamicQuery[sqlPreset];
  const queryUnavailableMessage = computedDatabase.blocked
    ? `เลือก source ต้นน้ำให้ครบก่อน: ${computedDatabase.missingUp.join(', ')}`
    : computedDatabase.validIds.length === 0
      ? 'เริ่มการสาธิตในแท็บ 01 เพื่อเลือก source และโหลดข้อมูลตัวอย่างก่อน'
      : 'เริ่มการสาธิตในแท็บ 01 เพื่อเตรียมข้อมูลสำหรับ query';

  useEffect(() => {
    setQuerySql(activePreset.sql);
    setQueryResult(null);
    setQueryError('');
    setQueryHasRun(false);
  }, [activePreset.sql]);

  const runSql = async () => {
    if (page !== 'query' && !computedDatabase.ready) return;
    setQueryRunning(true);
    setQueryError('');
    setQueryResult(null);
    setQueryHasRun(true);
    try {
      setQueryResult(await runBrowserSql(querySql));
    } catch (error) {
      setQueryError(error instanceof Error ? error.message : 'Database query failed.');
    } finally {
      setQueryRunning(false);
    }
  };

  const findTraceResults = async (term: string) => {
    setTraceQueryTuple(null);
    const requestId = ++traceRequestId.current;
    setTraceLoading(true);
    setTraceError('');
    setTraceSources([]);
    setTraceSelectedId('');
    setTraceSelectedFlowName('');
    setTraceSelectedSourceId('');
    setTraceMappedOutput(null);
    setTraceShowAllPrimarySources(false);
    setTraceShowSupportingSources(false);
    try {
      const terms = term.trim().split(/\s+/).filter(Boolean);
      const matchTerm = (rawTerm: string) => {
        const value = rawTerm.replace(/'/g, "''");
        const like = `%${value}%`;
        const numeric = /^-?\d+(?:\.\d+)?$/.test(value);
        const year = /^\d{4}$/.test(value) ? Number(value) : NaN;
        const isYear = (year >= 1900 && year <= 2035) || (year >= 2500 && year <= 2600);
        if (isYear) {
          const processYear = year >= 2500 ? year - 543 : year;
          return `p.process_year = ${processYear}`;
        }
        const sourceCode = value.match(/^SRC-0*(\d{1,3})$/i);
        if (sourceCode) {
          const sourceNumber = Number(sourceCode[1]);
          return `(s.source_id = ${sourceNumber}
            OR EXISTS (SELECT 1 FROM EXCHANGE_SOURCE_ROW source_match WHERE source_match.exchange_id=e.exchange_id AND source_match.source_id=${sourceNumber}))`;
        }
        if (numeric) {
          return `(CAST(e.exchange_id AS TEXT) = '${value}'
            OR CAST(e.amount AS REAL) = CAST('${value}' AS REAL)
            OR CAST(e.allocation AS REAL) = CAST('${value}' AS REAL)
            OR CAST(sr.source_id AS TEXT) = '${value}'
            OR sr.source_record_id = '${value}'
            OR sr.source_row_number = '${value}'
            OR EXISTS (SELECT 1 FROM json_each(COALESCE(sr.source_values, '{}')) AS raw_cell WHERE raw_cell.type IN ('text', 'integer', 'real') AND CAST(raw_cell.value AS TEXT) = '${value}')
            OR EXISTS (SELECT 1 FROM json_each(COALESCE(sr.staged_values, '{}')) AS staged_cell WHERE staged_cell.type IN ('text', 'integer', 'real') AND CAST(staged_cell.value AS TEXT) = '${value}'))`;
        }
        return `(CAST(e.exchange_id AS TEXT) = '${value}'
          OR p.process_name LIKE '${like}' OR p.domain LIKE '${like}'
          OR loc.name LIKE '${like}' OR loc.country LIKE '${like}'
          OR f.flow_name LIKE '${like}' OR f.flow_type LIKE '${like}' OR f.compartment LIKE '${like}'
          OR e.direction LIKE '${like}' OR CAST(e.amount AS TEXT) LIKE '${like}' OR u.symbol LIKE '${like}' OR CAST(e.allocation AS TEXT) LIKE '${like}'
          OR ref.reference_name LIKE '${like}' OR ref.reference_type LIKE '${like}' OR ref.reference_url LIKE '${like}'
          OR CAST(sr.source_id AS TEXT) LIKE '${like}' OR printf('SRC-%03d', sr.source_id) LIKE '${like}'
          OR s.title LIKE '${like}' OR s.publisher LIKE '${like}' OR s.description LIKE '${like}' OR s.url LIKE '${like}'
          OR matched_source.title LIKE '${like}' OR matched_source.publisher LIKE '${like}' OR matched_source.description LIKE '${like}' OR matched_source.url LIKE '${like}'
          OR sr.source_record_id LIKE '${like}' OR sr.source_row_number LIKE '${like}' OR sr.source_locator LIKE '${like}' OR sr.raw_file LIKE '${like}' OR sr.source_url LIKE '${like}' OR sr.source_sha256 LIKE '${like}'
          OR EXISTS (SELECT 1 FROM json_each(COALESCE(sr.source_values, '{}')) AS raw_cell WHERE raw_cell.type IN ('text', 'integer', 'real') AND CAST(raw_cell.value AS TEXT) LIKE '${like}')
          OR EXISTS (SELECT 1 FROM json_each(COALESCE(sr.staged_values, '{}')) AS staged_cell WHERE staged_cell.type IN ('text', 'integer', 'real') AND CAST(staged_cell.value AS TEXT) LIKE '${like}'))`;
      };
      const where = terms.length ? `WHERE ${terms.map(matchTerm).join(' AND ')}` : '';
      const sql = `SELECT DISTINCT e.exchange_id, p.process_name, p.process_year, f.flow_name, e.direction, e.amount, u.symbol AS unit, e.allocation, e.is_reference, ua.allocation_share, ua.allocation_method, ua.allocated_reference_volume, ua.unit AS allocation_unit, printf('SRC-%03d', s.source_id) AS source_id, s.title AS source_title, (SELECT group_concat(DISTINCT printf('SRC-%03d', linked.source_id)) FROM EXCHANGE_SOURCE_ROW linked WHERE linked.exchange_id=e.exchange_id) AS linked_source_ids FROM LCI_EXCHANGE e JOIN PROCESS p USING(process_id) JOIN LOCATION loc USING(location_id) JOIN FLOW f USING(flow_id) JOIN UNIT u USING(unit_id) JOIN REFERENCE ref USING(reference_id) JOIN SOURCE s ON s.source_id=ref.source_id LEFT JOIN UPSTREAM_ALLOCATION ua ON ua.source_id=printf('SRC-%03d', ref.source_id) AND ua.year=p.process_year AND ua.process_name=p.process_name LEFT JOIN EXCHANGE_SOURCE_ROW x ON x.exchange_id=e.exchange_id LEFT JOIN SOURCE_ROW sr ON sr.source_id=x.source_id AND sr.source_record_id=x.source_record_id LEFT JOIN SOURCE matched_source ON matched_source.source_id=sr.source_id ${where} ORDER BY e.exchange_id LIMIT 500`;
      const result = await runBrowserSql(sql, 100);
      if (requestId !== traceRequestId.current) return;
      setTraceResults(result);
    } catch (error) {
      if (requestId !== traceRequestId.current) return;
      setTraceError(error instanceof Error ? error.message : 'Could not search the LCI database.');
      setTraceResults(null);
    } finally {
      if (requestId === traceRequestId.current) setTraceLoading(false);
    }
  };

  const selectTraceExchange = async (exchangeId: string, flowName: string, sourceId: string, mappedOutput: { processName: string; processYear: string; flowName: string; amount: string; unit: string; direction: string; allocation?: string; isReference?: string; allocationShare?: string; allocationMethod?: string; allocatedVolume?: string; allocationUnit?: string }) => {
    setTraceQueryTuple(null);
    const requestId = ++traceRequestId.current;
    setTraceSelectedId(exchangeId);
    setTraceSelectedFlowName(flowName);
    setTraceSelectedSourceId(sourceId);
    setTraceMappedOutput(mappedOutput);
    setTraceShowAllPrimarySources(false);
    setTraceShowSupportingSources(false);
    setTraceError('');
    setTraceSources([]);
    try {
      const sql = `SELECT sr.source_id, sr.source_record_id, sr.source_row_number, sr.source_locator, sr.raw_file, sr.source_url, sr.source_sha256, sr.source_values, sr.staged_values FROM EXCHANGE_SOURCE_ROW x JOIN SOURCE_ROW sr ON sr.source_id=x.source_id AND sr.source_record_id=x.source_record_id WHERE x.exchange_id=${Number(exchangeId)} ORDER BY sr.source_id, CAST(sr.source_row_number AS INTEGER) LIMIT 5000`;
      const result = await runBrowserSql(sql, 5000);
      if (requestId !== traceRequestId.current) return;
      const sources = result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, column === 'source_values' || column === 'staged_values' ? JSON.parse(String(row[index] || '{}')) : row[index]])));
      sources.sort((left, right) => Number(traceSourceMatchesFlow(right, flowName)) - Number(traceSourceMatchesFlow(left, flowName))
        || Number(String(right.source_id) === sourceId) - Number(String(left.source_id) === sourceId)
        || String(left.source_id).localeCompare(String(right.source_id))
        || Number(left.source_row_number) - Number(right.source_row_number));
      setTraceSources(sources);
      if (!result.rows.length) setTraceError('ไม่พบแถวต้นทางที่เชื่อมกับ exchange นี้ใน snapshot');
    } catch (error) {
      if (requestId !== traceRequestId.current) return;
      setTraceSources([]);
      setTraceError(error instanceof Error ? error.message : 'Could not load source lineage.');
    }
  };

  const traceQueryOutputRow = async (columns: string[], values: unknown[]) => {
    const requestId = ++traceRequestId.current;
    const tuple = Object.fromEntries(columns.map((column, index) => [column.toLowerCase().replace(/[^a-z0-9]/g, ''), values[index]]));
    const traceAllLinkedRows = Number(tuple.linkedsourcerowcount) > 1;
    setTraceQueryTuple({ columns, values });
    setTraceMappedOutput(null);
    const selected = Object.fromEntries(columns.map((column, index) => [column.toLowerCase().replace(/[^a-z0-9]/g, ''), values[index]]));
    setTraceError('');
    setTraceSelectedId('');
    setTraceSources([]);
    const sqlValue = (value: unknown) => `'${String(value ?? '').replace(/'/g, "''")}'`;
    const conditions: string[] = [];
    const exchangeId = tuple.exchangeid;
    if (exchangeId != null && String(exchangeId) !== '') {
      conditions.push(`e.exchange_id = ${Number(exchangeId)}`);
      const linkedSourceNumber = String(tuple.sourceid ?? '').match(/^SRC-0*(\d{1,3})$/i)?.[1];
      if (!traceAllLinkedRows && linkedSourceNumber && (tuple.sourcerecordid != null || tuple.sourcerownumber != null || tuple.sourcelocator != null)) {
        conditions.push(`x.source_id = 'SRC-${String(Number(linkedSourceNumber)).padStart(3, '0')}'`);
      }
      if (!traceAllLinkedRows && tuple.sourcerecordid != null && String(tuple.sourcerecordid).trim()) conditions.push(`sr.source_record_id = ${sqlValue(tuple.sourcerecordid)}`);
      if (!traceAllLinkedRows && tuple.sourcerownumber != null && String(tuple.sourcerownumber).trim()) conditions.push(`sr.source_row_number = ${sqlValue(tuple.sourcerownumber)}`);
      if (!traceAllLinkedRows && tuple.sourcelocator != null && String(tuple.sourcelocator).trim()) conditions.push(`sr.source_locator = ${sqlValue(tuple.sourcelocator)}`);
    } else {
      const sourceId = String(tuple.sourceid ?? '').match(/\d+/)?.[0];
      const processYear = tuple.processyear ?? tuple.year;
      const flowName = tuple.flowname ?? tuple.flow;
      const direction = tuple.direction;
      const unit = tuple.unit;
      const sourceRecordId = tuple.sourcerecordid ?? tuple.recordid;
      const sourceRowNumber = tuple.sourcerownumber ?? tuple.rownumber;
      const sourceLocator = tuple.sourcelocator ?? tuple.locator;
      if (sourceId) conditions.push(`s.source_id = ${Number(sourceId)}`);
      if (processYear != null && String(processYear).trim() && Number.isFinite(Number(processYear))) conditions.push(`p.process_year = ${Number(processYear)}`);
      if (flowName != null && String(flowName).trim()) conditions.push(`f.flow_name = ${sqlValue(flowName)}`);
      if (direction != null && String(direction).trim()) conditions.push(`e.direction = ${sqlValue(direction)}`);
      if (unit != null && String(unit).trim()) conditions.push(`u.symbol = ${sqlValue(unit)}`);
      if (sourceRecordId != null && String(sourceRecordId).trim()) conditions.push(`sr.source_record_id = ${sqlValue(sourceRecordId)}`);
      if (sourceRowNumber != null && String(sourceRowNumber).trim()) conditions.push(`sr.source_row_number = ${sqlValue(sourceRowNumber)}`);
      if (sourceLocator != null && String(sourceLocator).trim()) conditions.push(`sr.source_locator = ${sqlValue(sourceLocator)}`);
    }
    if (!conditions.length) {
      setTraceError('แถวนี้ไม่มี exchange ID หรือคอลัมน์ source / year / flow ที่ใช้เชื่อมกลับไปยัง LCI ได้');
      document.getElementById('pw-panel-traceability')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    try {
      const tracedSourceSql = traceAllLinkedRows ? 's.source_id' : 'COALESCE(sr.source_id, s.source_id)';
      const sql = `SELECT DISTINCT e.exchange_id, p.process_name, p.process_year, f.flow_name, e.direction, e.amount, u.symbol AS unit, e.allocation, e.is_reference, ua.allocation_share, ua.allocation_method, ua.allocated_reference_volume, ua.unit AS allocation_unit, printf('SRC-%03d', ${tracedSourceSql}) AS source_id, s.title AS source_title FROM LCI_EXCHANGE e JOIN PROCESS p USING(process_id) JOIN FLOW f USING(flow_id) JOIN UNIT u USING(unit_id) JOIN REFERENCE ref USING(reference_id) JOIN SOURCE s ON s.source_id=ref.source_id LEFT JOIN UPSTREAM_ALLOCATION ua ON ua.source_id=printf('SRC-%03d', ref.source_id) AND ua.year=p.process_year AND ua.process_name=p.process_name LEFT JOIN EXCHANGE_SOURCE_ROW x ON x.exchange_id=e.exchange_id LEFT JOIN SOURCE_ROW sr ON sr.source_id=x.source_id AND sr.source_record_id=x.source_record_id WHERE ${conditions.join(' AND ')} ORDER BY e.exchange_id LIMIT 500`;
      const result = await runBrowserSql(sql, 500);
      if (requestId !== traceRequestId.current) return;
      setTraceResults(result);
      setTraceSearch('');
      setTraceSelectedId('');
      setTraceSources([]);
      document.getElementById('pw-panel-traceability')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (!result.rows.length) {
        setTraceError('ไม่พบ exchange ที่ตรงกับข้อมูลในแถวนี้');
        return;
      }
      const first = Object.fromEntries(result.columns.map((column, index) => [column, result.rows[0][index]]));
      setTraceSelectedId(String(first.exchange_id));
      setTraceSelectedFlowName(String(first.flow_name ?? ''));
      setTraceSelectedSourceId(String(first.source_id ?? ''));
      setTraceMappedOutput({
        processName: String(first.process_name ?? selected.processname ?? 'LCI exchange'),
        processYear: String(first.process_year ?? selected.processyear ?? selected.year ?? ''),
        flowName: String(first.flow_name ?? selected.flowname ?? selected.flow ?? ''),
        amount: String(first.amount ?? selected.amount ?? selected.totalamount ?? selected.amountperfu ?? ''),
        unit: String(first.unit ?? selected.unit ?? ''),
        direction: String(first.direction ?? selected.direction ?? ''),
        allocation: first.allocation == null ? undefined : String(first.allocation),
        isReference: first.is_reference == null ? undefined : String(first.is_reference),
        allocationShare: first.allocation_share == null ? undefined : String(first.allocation_share),
        allocationMethod: first.allocation_method == null ? undefined : String(first.allocation_method),
        allocatedVolume: first.allocated_reference_volume == null ? undefined : String(first.allocated_reference_volume),
        allocationUnit: first.allocation_unit == null ? undefined : String(first.allocation_unit),
      });
      setTraceShowAllPrimarySources(false);
      setTraceShowSupportingSources(false);
      const exchangeIds = result.rows.map((row) => Number(row[result.columns.indexOf('exchange_id')])).filter(Number.isFinite);
      const lineageFilters = [`x.exchange_id IN (${exchangeIds.join(',')})`];
      const linkedSourceNumber = String(tuple.sourceid ?? '').match(/^SRC-0*(\d{1,3})$/i)?.[1];
      if (!traceAllLinkedRows && linkedSourceNumber && (tuple.sourcerecordid != null || tuple.sourcerownumber != null || tuple.sourcelocator != null)) {
        lineageFilters.push(`x.source_id = 'SRC-${String(Number(linkedSourceNumber)).padStart(3, '0')}'`);
      }
      if (!traceAllLinkedRows && tuple.sourcerecordid != null && String(tuple.sourcerecordid).trim()) lineageFilters.push(`sr.source_record_id = ${sqlValue(tuple.sourcerecordid)}`);
      if (!traceAllLinkedRows && tuple.sourcerownumber != null && String(tuple.sourcerownumber).trim()) lineageFilters.push(`sr.source_row_number = ${sqlValue(tuple.sourcerownumber)}`);
      if (!traceAllLinkedRows && tuple.sourcelocator != null && String(tuple.sourcelocator).trim()) lineageFilters.push(`sr.source_locator = ${sqlValue(tuple.sourcelocator)}`);
      const lineage = await runBrowserSql(`SELECT x.exchange_id, sr.source_id, sr.source_record_id, sr.source_row_number, sr.source_locator, sr.raw_file, sr.source_url, sr.source_sha256, sr.source_values, sr.staged_values FROM EXCHANGE_SOURCE_ROW x JOIN SOURCE_ROW sr ON sr.source_id=x.source_id AND sr.source_record_id=x.source_record_id WHERE ${lineageFilters.join(' AND ')} ORDER BY sr.source_id, CAST(sr.source_row_number AS INTEGER) LIMIT 5000`, 5000);
      if (requestId !== traceRequestId.current) return;
      const linkedSources = lineage.rows.map((row) => Object.fromEntries(lineage.columns.map((column, index) => [column, column === 'source_values' || column === 'staged_values' ? JSON.parse(String(row[index] || '{}')) : row[index]])));
      linkedSources.sort((left, right) => Number(traceSourceMatchesFlow(right, String(first.flow_name ?? ''))) - Number(traceSourceMatchesFlow(left, String(first.flow_name ?? '')))
        || Number(String(right.source_id) === String(first.source_id)) - Number(String(left.source_id) === String(first.source_id))
        || String(left.source_id).localeCompare(String(right.source_id))
        || Number(left.source_row_number) - Number(right.source_row_number));
      setTraceSources(linkedSources);
      if (!linkedSources.length) setTraceError('ไม่พบแถวต้นทางที่เชื่อมกับ exchange ในแถว Query นี้');
    } catch (error) {
      if (requestId !== traceRequestId.current) return;
      setTraceError(error instanceof Error ? error.message : 'Could not trace the selected query row.');
    }
  };


  const openPresentation = async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      setIsPresenting(true);
    } catch {
      setIsPresenting(false);
    }
  };

  const closePresentation = () => {
    setIsPresenting(false);
    if (document.fullscreenElement) void document.exitFullscreen();
  };

  useEffect(() => {
    const workbenchTabs: WorkbenchTab[] = page === 'walkthrough' ? ['run'] : [];
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable ||
        target.closest('input, textarea, select, [role="textbox"]')
      )) return;

      if (event.shiftKey && event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        if (!isPresenting) void openPresentation();
        return;
      }

      if (event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const currentIndex = workbenchTabs.indexOf(activeTab);
      const nextIndex = currentIndex + (event.key === 'ArrowRight' ? 1 : -1);
      if (nextIndex < 0 || nextIndex >= workbenchTabs.length) return;
      event.preventDefault();
      setActiveTab(workbenchTabs[nextIndex]);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeTab, isPresenting, openPresentation, page]);

  const traceFlowEvidenceSources = traceSources.filter((source) => traceSourceMatchesFlow(source, traceSelectedFlowName));
  const traceMainSourceRows = traceSources.filter((source) => String(source.source_id) === traceSelectedSourceId);
  const tracePrimarySources = traceFlowEvidenceSources.length
    ? traceFlowEvidenceSources
    : traceMainSourceRows.length ? traceMainSourceRows : traceSources;
  const traceSupportingSources = traceSources.filter((source) => !tracePrimarySources.includes(source));
  const traceVisiblePrimarySources = traceShowAllPrimarySources ? tracePrimarySources : tracePrimarySources.slice(0, 3);
  const traceSupportingCounts = traceSupportingSources.reduce<Record<string, number>>((counts, source) => {
    const sourceId = String(source.source_id);
    counts[sourceId] = (counts[sourceId] || 0) + 1;
    return counts;
  }, {});

  if (isPresenting) {
    return <PipelinePresentationMode onExit={closePresentation} />;
  }

  if (loadError) {
    return (
      <div className="pipeline-view pipeline-workbench">
        <main className="pw-scroll-area"><div className="pw-content">
          <div className="pw-api-alert" role="alert"><HardDrive size={16} /><div><strong>ไม่สามารถโหลดชุดข้อมูลไปป์ไลน์ที่เตรียมไว้ได้</strong><span>{loadError}</span><button type="button" onClick={() => setRetryKey((current) => current + 1)}>ลองอีกครั้ง</button></div></div>
        </div></main>
      </div>
    );
  }

  return (
    <div className="pipeline-view pipeline-workbench">
      <main className="pw-scroll-area">
        <div className="pw-content">
          <header className="pw-heading workspace-page-header">
            <div className="pw-heading-copy workspace-page-heading">
              <span className="pw-eyebrow workspace-page-eyebrow"><GitBranch size={13} /> CN230 · DATA ENGINEERING LAB</span>
              <h1>{page === 'walkthrough' ? 'Pipeline Walkthrough' : 'Query'}</h1>
              <p>{page === 'walkthrough' ? 'สำรวจ pipeline และดูการทำงานจากแหล่งข้อมูลที่เลือก' : 'ค้นหา LCI exchange ด้วย SQL และตรวจย้อนกลับถึงแถวต้นทาง'}</p>
            </div>
            {page === 'walkthrough' && <div className="pw-heading-actions">
              <button type="button" className="pw-secondary-button pw-presentation-launch" onClick={openPresentation} title="กด Shift + Enter เพื่อเปิดโหมดนำเสนอ">
                <Presentation size={15} /> นำเสนอ pipeline
              </button>
            </div>}
          </header>

          {page === 'walkthrough' && activeTab === 'run' && (
            <section className="pw-panel pw-run-panel">
              <div className="pw-panel-heading">
                <div><span className="pw-section-kicker">PIPELINE EXAMPLE</span><h2>แสดงลำดับการทำงานของ pipeline</h2></div>
                <button
                  type="button"
                  className="pw-secondary-button pw-reset-browser-button"
                  onClick={handleResetWebDemoData}
                  disabled={activeRun}
                  title="รีเซ็ตสถานะตัวอย่างและซ่อนผลลัพธ์จากมุมมอง IDE; ไม่ลบไฟล์ข้อมูล"
                >
                  <RotateCcw size={14} /> รีเซ็ตตัวอย่าง
                </button>
              </div>

              <div className="pw-run-grid">
                <section className="pw-control-card" aria-label="ตั้งค่าการสาธิต">
                  <div className="pw-card-heading"><div><strong>เลือก source</strong><small>ใช้ทะเบียน approved ของโปรเจกต์</small></div><span className="pw-selection-count">{selectedSourceIds.length} เลือก</span></div>
                  <div className="pw-source-toolbar">
                    <label className="pw-source-search"><Search size={14} /><input aria-label="ค้นหา source หรือหน่วยงาน" value={sourceSearch} onChange={(event) => setSourceSearch(event.target.value)} placeholder="ค้นหา source หรือหน่วยงาน" /></label>
                    <button type="button" className="pw-text-button" onClick={toggleVisibleSources}>{allVisibleSelected ? 'ยกเลิกที่แสดง' : 'เลือกที่แสดง'}</button>
                  </div>
                  <div className="pw-source-list">
                    {!snapshot && <div className="pw-empty-inline"><Loader2 size={15} className="pw-spin" /> กำลังโหลดทะเบียน…</div>}
                    {snapshot && filteredSources.length === 0 && <div className="pw-empty-inline">ไม่พบแหล่งข้อมูลที่ค้นหา</div>}
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

                  <div className="pw-run-actions">
                    <button type="button" className="pw-run-button" onClick={handleStartRun} disabled={!snapshot || activeRun || selectedSourceIds.length === 0}>
                      {activeRun ? <Loader2 size={16} className="pw-spin" /> : <Play size={15} fill="currentColor" />}
                      {activeRun ? 'กำลังแสดงตัวอย่าง…' : 'เริ่มการสาธิต'}
                    </button>
                    {activeRun && <button type="button" className="pw-stop-button" onClick={handleCancelRun}><Square size={13} fill="currentColor" /> หยุด</button>}
                  </div>
                  {runError && <div className="pw-inline-error" role="status">{runError}</div>}
                </section>

                <section className="pw-monitor-card" aria-label="สถานะการสาธิต">
                  <div className="pw-card-heading pw-monitor-heading">
                    <div>
                      <strong>สถานะการสาธิต</strong>
                      <small>{runSourceIds.length ? `${formatSourceRanges(runSourceIds)} (${runSourceIds.length} แหล่ง)` : 'เลือก source แล้วเริ่มการสาธิตเพื่อดูแต่ละ stage'}</small>
                    </div>
                  </div>
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

                  <div className="pw-terminal-header"><span><Terminal size={14} /> EXAMPLE OUTPUT</span><span className={`pw-run-state state-${runStatus}`}><i />{runStatus.toUpperCase()}</span></div>
                  <div className="pw-terminal" ref={terminalRef} role="log" aria-live="off" aria-label="บันทึกตัวอย่างจากข้อมูลที่เตรียมไว้">
                    {logs.length === 0 ? (
                      <div className="pw-terminal-empty"><span>$</span><p>เริ่มการสาธิตเพื่อดูตัวอย่างการทำงานของ pipeline</p><small>ใช้ข้อมูลที่เตรียมไว้ · ไม่ได้เรียก process จริง</small></div>
                    ) : logs.map((line, index) => (
                      <div key={`${index}-${line}`} className={`pw-log-line ${/FAIL|ERROR|FAILED|BLOCKED|ไม่สำเร็จ|ล้มเหลว/i.test(line) ? 'is-error' : /COMPLETE|VALIDATED|สำเร็จ/i.test(line) ? 'is-success' : ''}`}>
                        <span>{String(index + 1).padStart(3, '0')}</span>
                        <code>{line || ' '}</code>
                      </div>
                    ))}
                    {activeRun && <div className="pw-log-cursor"><span /> กำลังแสดงตัวอย่าง</div>}
                  </div>
                  {runStatus === 'succeeded' && logs.length > 0 && (
                    <div className="pw-run-result is-success">
                      <CheckCircle2 size={15} />
                      <span>แสดงตัวอย่างเสร็จแล้ว · {formatCount(runSourceIds.length)} แหล่ง{runIncludeDatabase ? ` · ${formatCount(computedDatabase.counts.LCI_EXCHANGE)} LCI exchanges ในข้อมูล` : ' · ไม่ได้รวมขั้นส่งออกฐานข้อมูล'}</span>
                      <button type="button" onClick={() => setActiveTab('query')}>ไปทดลอง query <ChevronRight size={13} /></button>
                    </div>
                  )}
                  {runStatus === 'blocked' && (
                    <div className="pw-run-result has-warning" role="status">
                      <Circle size={15} />
                      <span>รอข้อมูลสำหรับ Allocation · {allocationBlock || 'ต้องเลือก SRC-044..047 ให้ครบทั้ง 4 แหล่ง'}</span>
                    </div>
                  )}
                </section>
              </div>
            </section>
          )}

          {activeTab === 'run' && (
            <section className="pw-file-explorer" aria-label="ไฟล์ผลลัพธ์ของ pipeline">
              <div className="pw-explorer-heading">
                <div><span className="pw-section-kicker">PIPELINE DATA EXPLORER</span><h2>ไฟล์ผลลัพธ์ของแต่ละ phase</h2><p>คลิกโฟลเดอร์ทางซ้ายเพื่อกางดูรายการไฟล์ และคลิกชื่อไฟล์เพื่อเปิดดูข้อมูลทางด้านขวาเหมือนใน IDE</p></div>
                <div className="pw-explorer-heading-actions"><span><HardDrive size={13} /> WEB DATA · ISOLATED</span></div>
              </div>

              {demoDataResetMessage && <div className="pw-demo-reset-message" role="status"><CheckCircle2 size={14} />{demoDataResetMessage}</div>}
              <div className="pw-vscode-workspace">
                <div className="pw-vscode-titlebar"><span><Database size={13} /> CN230 · PIPELINE WORKSPACE</span><code>{explorerFile?.path || activeExplorerStage?.path || 'web/data/'}</code><span className="pw-vscode-window-controls" aria-hidden="true"><i /><i /><i /></span></div>
                <div className="pw-vscode-main">
                  <div className="pw-vscode-activity" aria-hidden="true"><span className="is-active"><Files size={18} /></span><span><Search size={17} /></span><span><GitBranch size={17} /></span><span><Database size={17} /></span></div>
                  <aside className="pw-vscode-sidebar" aria-label="pipeline file explorer">
                    <div className="pw-vscode-sidebar-heading"><span>EXPLORER</span><span>{formatCount(totalExplorerFiles)} files</span></div>
                    <div className="pw-vscode-root"><ChevronRight size={12} className="is-expanded" /><FolderOpen size={14} /><strong>CN230 PROJECT</strong></div>
                    <div className="pw-vscode-stage-tree" aria-label="โฟลเดอร์ pipeline ตาม phase">
                      <button
                        type="button"
                        className="pw-vscode-folder-heading"
                        onClick={() => toggleExplorerFolder('web/data')}
                        aria-expanded={explorerExpandedFolders['web/data'] ?? true}
                      >
                        <ChevronRight size={11} className={(explorerExpandedFolders['web/data'] ?? true) ? 'is-expanded' : ''} />
                        {(explorerExpandedFolders['web/data'] ?? true) ? <FolderOpen size={13} /> : <Folder size={13} />}
                        <strong>web/data</strong>
                        <small>{formatCount(totalExplorerFiles)} files</small>
                      </button>
                      {(explorerExpandedFolders['web/data'] ?? true) && (
                        <div className="pw-vscode-tree-children">
                          {renderDatabaseFolder()}
                          {renderExplorerStageFolder(mappingStage, 'web/data/mapping', 'mapping', 1)}
                          {renderExplorerStageFolder(parsedStage, 'web/data/parsed', 'parsed', 1)}
                          {renderExplorerStageFolder(rawStage, 'web/data/raw', 'raw', 1)}
                          {renderExplorerStageFolder(stagingStage, 'web/data/staging', 'staging', 1)}

                          <button
                            type="button"
                            className={`pw-vscode-folder ${explorerExpandedFolders['web/data/validation'] ? 'is-selected' : ''}`}
                            style={{ paddingLeft: '12px' }}
                            onClick={() => toggleExplorerFolder('web/data/validation')}
                            aria-expanded={explorerExpandedFolders['web/data/validation'] ?? false}
                          >
                            <ChevronRight size={11} className={explorerExpandedFolders['web/data/validation'] ? 'is-expanded' : ''} />
                            {explorerExpandedFolders['web/data/validation'] ? <FolderOpen size={13} /> : <Folder size={13} />}
                            <span><strong>validation</strong><small>{formatCount(validationFileCount)} files</small></span>
                          </button>
                          {explorerExpandedFolders['web/data/validation'] && (
                            <div className="pw-vscode-tree-children">
                              {renderExplorerStageFolder(acceptedStage, 'web/data/validation/accepted', 'accepted', 2)}
                              {renderExplorerStageFolder(rejectedStage, 'web/data/validation/rejected', 'rejected', 2)}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="pw-vscode-sidebar-status"><CalendarDays size={10} /> PREPARED DATA · {formatCount(runSourceIds.length)} SOURCES</div>
                  </aside>

                  <main className="pw-vscode-editor" aria-label="file preview">
                    <div className="pw-vscode-editor-tabs">
                      <div className="pw-vscode-active-tab">
                        {explorerFile?.extension === 'jsonl' || explorerFile?.extension === 'sql' || explorerFile?.extension === 'json' ? (
                          <FileCode2 size={13} />
                        ) : explorerFile ? (
                          <FileSpreadsheet size={13} />
                        ) : (
                          <FileText size={13} />
                        )}
                        <span>{explorerFile?.name || 'ไม่ได้เปิดไฟล์'}</span>
                        {explorerFile && (
                          <button
                            type="button"
                            onClick={() => { setExplorerFilePath(''); setPreview(null); }}
                            style={{ border: 0, background: 'transparent', color: '#999', cursor: 'pointer', display: 'inline-grid', placeItems: 'center' }}
                            title="ปิดแท็บไฟล์"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      <div className="pw-vscode-editor-tab-space" />
                    </div>
                    <div className="pw-vscode-breadcrumb">
                      <span>web/data</span>
                      <ChevronRight size={11} />
                      <span>{activeExplorerStage?.path.replace('web/data/', '') || 'pipeline'}</span>
                      <ChevronRight size={11} />
                      <strong>{explorerFile?.name || 'เลือกไฟล์จากแถบซ้าย'}</strong>
                      <span className={`pw-vscode-format format-${explorerFile?.extension || 'file'}`}>{explorerFile?.extension.toUpperCase() || 'IDE'}</span>
                    </div>
                    <div className="pw-vscode-editor-body">
                      {!explorerFile && (
                        <div className="pw-explorer-sheet-empty">
                          <FileSpreadsheet size={26} />
                          <strong>{totalExplorerFiles === 0 ? 'ยังไม่ได้เลือกไฟล์ตัวอย่าง' : 'คลิกเลือกไฟล์จากแถบ EXPLORER ทางซ้าย'}</strong>
                          <span>{totalExplorerFiles === 0 ? 'เลือก source แล้วเริ่มการสาธิตเพื่อแสดงไฟล์ตัวอย่าง · ไม่มีการสร้างหรือเขียนไฟล์ใหม่' : 'กางโฟลเดอร์ database, mapping, parsed, raw, staging หรือ validation แล้วคลิกไฟล์เพื่อเปิดดูข้อมูลทางขวา'}</span>
                        </div>
                      )}
                      {explorerFile && previewLoading && (
                        <div className="pw-explorer-sheet-empty"><Loader2 size={20} className="pw-spin" /><strong>กำลังเปิดไฟล์ {explorerFile.name}…</strong><span>อ่านข้อมูลตัวอย่างจาก web/data/</span></div>
                      )}
                      {explorerFile && previewError && (
                        <div className="pw-explorer-error" role="alert"><X size={14} />{previewError}<button type="button" onClick={() => setPreviewRetryKey((c) => c + 1)}>ลองใหม่</button></div>
                      )}
                      {explorerFile && preview && !previewLoading && !previewError && (
                        <>
                          {preview.sheetNames.length > 1 && (
                            <div className="pw-explorer-sheet-tabs" role="tablist" aria-label="เลือกตาราง / worksheet">
                              {preview.sheetNames.map((sheet) => (
                                <button
                                  key={sheet}
                                  type="button"
                                  className={(activeSheet || preview.activeSheet) === sheet ? 'is-selected' : ''}
                                  onClick={() => setActiveSheet(sheet)}
                                  role="tab"
                                  aria-selected={(activeSheet || preview.activeSheet) === sheet}
                                >
                                  {sheet}
                                </button>
                              ))}
                            </div>
                          )}

                          {preview.kind === 'table' && (
                            <div className="pw-explorer-grid-wrap">
                              {preview.columns.length === 0 ? (
                                <div className="pw-explorer-grid-empty">ไฟล์นี้ยังไม่มีระเบียนให้แสดง</div>
                              ) : (
                                <table className="pw-explorer-grid">
                                  <thead>
                                    <tr>
                                      <th className="pw-explorer-row-number">#</th>
                                      {preview.columns.map((column, index) => <th key={`${column}-${index}`} title={column}>{column}</th>)}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {preview.rows.map((row, rowIndex) => (
                                      <tr key={rowIndex}>
                                        <th className="pw-explorer-row-number">{rowIndex + 1}</th>
                                        {preview.columns.map((_column, columnIndex) => {
                                          const value = row[columnIndex];
                                          return <td key={columnIndex} title={formatCell(value)}>{formatCell(value)}</td>;
                                        })}
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              )}
                            </div>
                          )}

                          {preview.kind === 'code' && (
                            <div className="pw-explorer-grid-wrap" style={{ background: '#1e1e1e', color: '#d4d4d4', padding: '12px 16px' }}>
                              <pre style={{ margin: 0, fontFamily: 'var(--font-mono)', fontSize: '11.5px', lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>
                                {preview.codeText}
                              </pre>
                            </div>
                          )}

                          {preview.kind === 'pdf' && preview.pdfUrl && (
                            <div className="pw-explorer-grid-wrap" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                              <iframe
                                src={preview.pdfUrl}
                                title={explorerFile.name}
                                style={{ width: '100%', flex: 1, border: 0, minHeight: '420px' }}
                              />
                            </div>
                          )}

                          <div className="pw-vscode-editor-status">
                            <span>
                              {explorerFile.extension.toUpperCase()}
                              {preview.activeSheet ? ` · Sheet: ${preview.activeSheet}` : ''}
                              {preview.kind === 'table' ? ` · ${formatCount(preview.totalRows)} rows` : preview.kind === 'code' ? ` · ${formatCount(preview.totalRows)} lines` : ` · ${formatFileSize(explorerFile.sizeBytes)}`}
                            </span>
                            <span>{explorerFile.path} · Modified {formatDate(explorerFile.modifiedAt)}</span>
                          </div>
                        </>
                      )}
                    </div>
                  </main>
                </div>
              </div>
            </section>
          )}

          {page === 'walkthrough' && activeTab === 'steps' && (
            <section id="pw-panel-steps" className="pw-panel pw-steps-panel" role="tabpanel" aria-labelledby="pw-tab-steps">
              <div className="pw-panel-heading"><div><span className="pw-section-kicker">PIPELINE ARCHITECTURE</span><h2>อธิบายการทำงานทั้ง 7 ขั้นตอน</h2><p>เส้นทางในรายละเอียดอ้างถึงการรันจริงจาก root `data/`; หน้าเว็บใช้ชุดข้อมูลตัวอย่างใน `web/data/`</p></div><button type="button" className="pw-secondary-button" onClick={() => setActiveTab('run')}><Play size={14} /> ไปหน้าตัวอย่าง</button></div>
              <div className="pw-step-browser">
                <nav className="pw-step-list" aria-label="ขั้นตอนของไปป์ไลน์">
                  {pipelineSteps.map((step) => <button key={step.id} type="button" onClick={() => setSelectedStep(step)} className={`pw-step-choice ${selectedStep.id === step.id ? 'is-selected' : ''}`} aria-pressed={selectedStep.id === step.id}><span className="pw-step-choice-number">{step.stepNumber}</span><span><strong>{step.titleTh}</strong><small>{step.titleEn}</small></span><ChevronRight size={14} /></button>)}
                </nav>
                <article className="pw-step-detail">
                  <div className="pw-step-detail-top"><span className="pw-step-detail-number">{selectedStep.stepNumber}</span><div><span className="pw-section-kicker">{selectedStep.titleEn}</span><h3>{selectedStep.titleTh}</h3></div></div>
                  <p className="pw-step-summary">{selectedStep.summary}</p>
                  <div className="pw-step-flow"><section><span className="pw-info-label">ข้อมูลเข้า</span><ul>{selectedStep.inputs.map((item) => <li key={item}>{item}</li>)}</ul></section><div className="pw-flow-arrow"><ChevronRight size={18} /></div><section><span className="pw-info-label">ผลลัพธ์</span><ul>{selectedStep.outputs.map((item) => <li key={item}>{item}</li>)}</ul></section></div>
                  <section className="pw-process-block"><span className="pw-info-label">รายละเอียดขั้นตอนนี้</span><ol>{selectedStep.processingDetails.map((detail, index) => <li key={detail}><span>{String(index + 1).padStart(2, '0')}</span>{detail}</li>)}</ol></section>
                  <div className="pw-step-footer-grid"><section className="pw-quality-block"><span className="pw-info-label">เกณฑ์ตรวจสอบคุณภาพ</span><ul>{selectedStep.dataQualityChecks.map((item) => <li key={item}><CheckCircle2 size={14} />{item}</li>)}</ul></section><section className="pw-provenance-block"><span className="pw-info-label">รายละเอียดการทำงาน / แหล่งข้อมูล</span><code>{selectedStep.provenanceSource}</code>{selectedStep.sqlOrMathFormula && <pre>{selectedStep.sqlOrMathFormula}</pre>}</section></div>
                  <div className="pw-step-pager"><button type="button" onClick={() => setSelectedStep(pipelineSteps[Math.max(0, pipelineSteps.findIndex((step) => step.id === selectedStep.id) - 1)])} disabled={selectedStep.id === pipelineSteps[0].id}>ก่อนหน้า</button><span>ขั้นตอนที่ {selectedStep.stepNumber} / 07</span><button type="button" onClick={() => setSelectedStep(pipelineSteps[Math.min(pipelineSteps.length - 1, pipelineSteps.findIndex((step) => step.id === selectedStep.id) + 1)])} disabled={selectedStep.id === pipelineSteps[pipelineSteps.length - 1].id}>ถัดไป <ChevronRight size={13} /></button></div>
                </article>
              </div>
            </section>
          )}

          {page === 'query' && (
            <section id="pw-panel-query" className="pw-panel pw-query-panel" role="tabpanel" aria-labelledby="pw-tab-query">
              <div className="pw-panel-heading">
                <div><span className="pw-section-kicker">SQLITE QUERY</span><h2>ค้นข้อมูลและสืบย้อนแหล่งที่มา</h2><p>แก้ SQL แล้วรันกับฐานข้อมูล SQLite ในเครื่อง · ผลลัพธ์แสดงจาก query จริง</p></div>
              </div>

              <div className="pw-query-workspace">
                <aside className="pw-query-sidebar">
                  <div className="pw-sidebar-tabs" role="tablist" aria-label="เลือก preset หรือ table">
                    <button type="button" role="tab" aria-selected={querySidebarTab === 'presets'} className={querySidebarTab === 'presets' ? 'is-active' : ''} onClick={() => setQuerySidebarTab('presets')}>Preset <small>{Object.keys(dynamicQuery).length}</small></button>
                    <button type="button" role="tab" aria-selected={querySidebarTab === 'tables'} className={querySidebarTab === 'tables' ? 'is-active' : ''} onClick={() => setQuerySidebarTab('tables')}>Table <small>{DB_TABLE_NAMES.length}</small></button>
                  </div>
                  {querySidebarTab === 'presets' ? <div className="pw-preset-list" role="tabpanel">
                    {(['traceback', 'mapping_changes', 'by_source', 'material_flows', 'annual_impacts', 'upstream_fu', 'qc_rules'] as SqlPresetKey[]).map((key) => {
                      const item = dynamicQuery[key];
                      return (
                      <button
                        key={key}
                        type="button"
                        className={`pw-preset-button ${sqlPreset === key ? 'is-selected' : ''}`}
                        onClick={() => { setSqlPreset(key); setQueryHasRun(false); }}
                      >
                        <strong>{item.label}</strong>
                        <small>{item.description}</small>
                      </button>
                      );
                    })}
                  </div> : <div className="pw-table-browser" role="tabpanel">
                    {([
                      'LCI_EXCHANGE', 'PROCESS', 'FLOW', 'QUALITY_CHECK', 'SOURCE', 'REFERENCE',
                      'EXTRACTION_BATCH', 'LOCATION', 'UNIT', 'REJECTED_RECORD',
                    ] as DbTableName[]).map((name) => (
                      <button
                        type="button"
                        key={name}
                        className="pw-table-row"
                        onClick={() => {
                          setSelectedPreviewTable(name);
                          setSqlPreset('table_preview');
                          setQueryHasRun(false);
                        }}
                      >
                        <Table2 size={13} /><span><strong>{name}</strong><small>{DEFAULT_TABLE_HEADERS[name].length} columns</small></span><em>{formatCount(computedDatabase.counts[name])}</em>
                      </button>
                    ))}
                  </div>}
                </aside>

                <div className="pw-query-main">
                  <div className="pw-editor-card">
                    <div className="pw-editor-toolbar">
                      <span><FileCode2 size={14} /> SQL QUERY</span>
                      <button type="button" className="pw-reset-sandbox" onClick={() => { setSqlPreset('annual_impacts'); setSelectedPreviewTable('LCI_EXCHANGE'); setQuerySql(dynamicQuery.annual_impacts.sql); setQueryResult(null); setQueryHasRun(false); }}><RotateCcw size={12} /> รีเซ็ต query</button>
                    </div>
                    <textarea
                      className="pw-sql-editor"
                      value={querySql}
                      onChange={(event) => setQuerySql(event.target.value)}
                      spellCheck={false}
                      aria-label="SQL query"
                    />
                    <div className="pw-editor-footer">
                      <span>{page === 'query' || computedDatabase.ready ? 'รัน SELECT กับ SQLite · สูงสุด 500 แถว' : 'เริ่ม demo ก่อนเพื่อเลือก source และเปิด query'}</span>
                      <button type="button" className="pw-query-button" onClick={() => void runSql()} disabled={queryRunning || (page !== 'query' && !computedDatabase.ready) || !querySql.trim()}>
                        <Play size={13} /> {queryRunning ? 'กำลังค้น…' : 'รัน Query'}
                      </button>
                    </div>
                  </div>

                  <div className="pw-results-card">
                    <div className="pw-results-heading">
                      <div>
                        <strong>ผลลัพธ์ {queryHasRun ? `· ${activePreset.label}` : ''}</strong>
                        <small>{!queryHasRun ? computedDatabase.ready ? 'เลือก preset หรือแก้ SQL แล้วกด “รัน Query”' : queryUnavailableMessage : queryRunning ? 'กำลังรัน SQL…' : queryError ? queryError : queryResult ? `${formatCount(queryResult.rowCount)} แถว · ${queryResult.durationMs} ms${queryResult.truncated ? ' · จำกัดผลลัพธ์ 500 แถว' : ''}` : 'ไม่มีผลลัพธ์'}</small>
                      </div>
                    </div>
                    <div className="pw-result-table-wrap">
                      {!queryHasRun ? <div className="pw-query-empty">{computedDatabase.ready ? 'เลือก query แล้วกด “รัน Query”' : queryUnavailableMessage}</div> : queryError ? <div className="pw-query-empty" role="alert">{queryError}</div> : !queryResult?.rows.length ? <div className="pw-query-empty">{queryRunning ? 'กำลังค้นข้อมูล…' : 'ไม่พบแถวข้อมูล'}</div> : (
                        <table className="pw-result-table">
                          <thead><tr><th scope="col" className="pw-result-actions-heading">แถว</th>{queryResult.columns.map((column, index) => <th scope="col" key={`${column}-${index}`}>{column}</th>)}</tr></thead>
                          <tbody>{queryResult.rows.map((row, rowIndex) => <tr key={rowIndex}>
                            <td className="pw-result-actions"><button type="button" title="คัดลอกแถว" aria-label={`คัดลอกแถวที่ ${rowIndex + 1}`} onClick={() => { void copyToClipboard(row.map((cell) => String(cell ?? '')).join('\t')).then((ok) => { if (ok) { setCopiedQueryRow(rowIndex); window.setTimeout(() => setCopiedQueryRow((current) => current === rowIndex ? null : current), 1400); } }); }}><Copy size={12} />{copiedQueryRow === rowIndex ? 'คัดลอกแล้ว' : 'คัดลอก'}</button><button type="button" title="สืบย้อนแถวนี้" aria-label={`สืบย้อนแถวที่ ${rowIndex + 1}`} onClick={() => void traceQueryOutputRow(queryResult.columns, row)}><GitBranch size={12} /></button></td>
                            {row.map((cell, cellIndex) => {
                              const column = queryResult.columns[cellIndex]?.toLowerCase();
                              const isSourceUrl = column === 'source_url' || column === '_source_url';
                              const sourceUrl = isSourceUrl && typeof cell === 'string' ? getSourcePageUrl(cell) : null;
                              return (
                                <td key={`${rowIndex}-${cellIndex}`} title={formatCell(cell)}>
                                  {sourceUrl ? <a className="pw-result-source-link" href={sourceUrl} target="_blank" rel="noopener noreferrer">{formatCell(cell)}</a> : formatCell(cell)}
                                </td>
                              );
                            })}
                          </tr>)}</tbody>
                        </table>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          )}

          {page === 'query' && (
            <section id="pw-panel-traceability" className="pw-panel pw-lineage-panel" role="tabpanel" aria-labelledby="pw-tab-traceability">
              <div className="pw-panel-heading"><div><span className="pw-section-kicker">RESEARCHER WORKFLOW</span><h2>ค้นข้อมูล LCI และตรวจสอบย้อนกลับ</h2><p>ค้น exchange ที่สนใจ แล้วดูแถวต้นทาง ค่าก่อนและหลัง Staging และหลักฐานใน snapshot เดียว</p></div></div>
              <form className="pw-lineage-search" onSubmit={(event) => { event.preventDefault(); void findTraceResults(traceSearch); }}>
                <label><span>ค้นด้วย source ID, ชื่อ process/flow, ปีของ process, exchange ID, locator หรือค่าจากไฟล์ต้นทาง · ทุกคำต้องตรง</span><div><Search size={16} /><input value={traceSearch} onChange={(event) => setTraceSearch(event.target.value)} placeholder="เช่น SRC-047 2022 VOC หรือ exchange ID" /><button type="submit" disabled={traceLoading}><Search size={14} />{traceLoading ? 'กำลังค้น…' : 'ค้นหา'}</button></div></label>
              </form>
              {traceError && <div className="pw-lineage-message" role="status">{traceError}</div>}
              {traceResults && <div className="pw-lineage-results-layout">
                <section className="pw-lineage-result-list"><header><strong>LCI exchanges ที่ตรงกับคำค้น</strong><small>{formatCount(traceResults.rowCount)} exchanges{traceResults.truncated ? ' · แสดง 100 รายการแรก' : ''}</small></header>
                  {!traceResults.rows.length ? <div className="pw-query-empty">ไม่พบ exchange ที่ตรงกับคำค้น</div> : traceResults.rows.map((row, index) => {
                    const item = Object.fromEntries(traceResults.columns.map((column, columnIndex) => [column, row[columnIndex]]));
                    const id = String(item.exchange_id ?? '');
                    return <button type="button" key={`${id}-${index}`} className={`pw-lineage-result ${traceSelectedId === id ? 'is-selected' : ''}`} onClick={() => void selectTraceExchange(id, String(item.flow_name ?? ''), String(item.source_id ?? ''), { processName: String(item.process_name ?? ''), processYear: String(item.process_year ?? ''), flowName: String(item.flow_name ?? ''), amount: String(item.amount ?? ''), unit: String(item.unit ?? ''), direction: String(item.direction ?? ''), allocation: item.allocation == null ? undefined : String(item.allocation), isReference: item.is_reference == null ? undefined : String(item.is_reference), allocationShare: item.allocation_share == null ? undefined : String(item.allocation_share), allocationMethod: item.allocation_method == null ? undefined : String(item.allocation_method), allocatedVolume: item.allocated_reference_volume == null ? undefined : String(item.allocated_reference_volume), allocationUnit: item.allocation_unit == null ? undefined : String(item.allocation_unit) })}>
                      <span>LCI source {String(item.source_id)} · exchange #{id}</span><strong>{formatCell(item.process_name)}</strong><small>ปี {String(item.process_year)} · {String(item.flow_name)}</small><small>{String(item.direction)} · ปริมาณ {String(item.amount)} {String(item.unit)}</small><small>แหล่งที่เชื่อม: {String(item.linked_source_ids || item.source_id)}</small>
                    </button>;
                  })}
                </section>
                <section className="pw-lineage-detail"><header><strong>{traceQueryTuple ? 'ข้อมูลต้นทางของแถว Query ที่เลือก' : 'ข้อมูลต้นทางของ LCI ที่เลือก'}</strong><small>{traceSelectedId ? `${traceSelectedSourceId} · exchange ${traceSelectedId} · ${traceSelectedFlowName}${traceQueryTuple && traceResults ? ` · ${formatCount(traceResults.rowCount)} exchanges ในแถวนี้` : ''}` : 'เลือกผลลัพธ์เพื่อดูข้อมูลที่มา'}</small></header>
                  {traceMappedOutput && <div className="pw-lineage-mapped-output"><span>ผลลัพธ์ปัจจุบันหลัง Mapping</span><strong>{traceMappedOutput.amount} {traceMappedOutput.unit}</strong><small>{traceMappedOutput.processName} · {traceMappedOutput.processYear} · {traceMappedOutput.flowName} · {traceMappedOutput.direction}</small></div>}
                  {!traceSelectedId ? <div className="pw-query-empty">เลือก exchange ทางซ้ายเพื่อดูเฉพาะแถวที่เชื่อมกับรายการนั้น</div> : !traceSources.length ? <div className="pw-query-empty">{traceError || 'กำลังโหลดแถวต้นทาง…'}</div> : <div className="pw-lineage-evidence-groups">
                    {traceQueryTuple && <section className="pw-query-trace-tuple"><header><strong>ที่มาของแต่ละคอลัมน์ในแถวที่เลือก</strong><small>แถวต้นทางที่เชื่อมกับ exchange แสดงด้านล่าง</small></header><div className="pw-query-trace-fields">{traceQueryTuple.columns.map((column, index) => {
                      const origins = tupleColumnOrigins(column, traceSources);
                      const normalized = column.toLowerCase().replace(/[^a-z0-9]/g, '');
                      const derived = ['exchange_count', 'total_amount', 'amount_per_fu'].includes(column.toLowerCase());
                      return <article key={`${column}-${index}`}><strong>{column}</strong><span>{formatCell(traceQueryTuple.values[index])}</span><small>{origins.length ? origins.map((origin) => `${origin.source} · ${origin.locator} · ${origin.fields.join(', ')}`).join(' | ') : derived ? `คำนวณจาก exchange ที่ตรงกัน ${formatCount(traceResults?.rowCount || 0)} รายการ` : ['sourceid', 'processyear', 'flowname', 'direction', 'unit', 'processname', 'exchangeid'].includes(normalized) ? 'ข้อมูลประกอบของ LCI exchange ที่เลือก' : 'ข้อมูลจากผล Query; ตรวจสอบแถวต้นทางที่เชื่อมโยงด้านล่าง'}</small></article>;
                    })}</div></section>}
                    <section><header><strong>{traceFlowEvidenceSources.length ? 'แถวต้นทางของ flow นี้' : `แถวข้อมูลจาก ${traceSelectedSourceId}`}</strong><small>{formatCount(tracePrimarySources.length)} แถวที่เกี่ยวข้องโดยตรง</small></header>
                      <div className="pw-lineage-source-list">{traceVisiblePrimarySources.map((source, index) => <TraceabilitySourceCard key={`${String(source.source_id)}-${String(source.source_record_id)}-${index}`} source={source} isFlowEvidence={traceFlowEvidenceSources.includes(source)} />)}</div>
                      {tracePrimarySources.length > 3 && <button type="button" className="pw-lineage-expand-button" aria-expanded={traceShowAllPrimarySources} onClick={() => setTraceShowAllPrimarySources((value) => !value)}>{traceShowAllPrimarySources ? 'ย่อรายการ' : `ดูแถวที่เกี่ยวข้องทั้งหมด ${formatCount(tracePrimarySources.length)} แถว`}</button>}
                    </section>
                    {traceSupportingSources.length > 0 && <section className="pw-lineage-supporting-group"><button type="button" className="pw-lineage-support-toggle" aria-expanded={traceShowSupportingSources} onClick={() => setTraceShowSupportingSources((value) => !value)}><strong>{traceShowSupportingSources ? 'ซ่อน' : 'แสดง'}ข้อมูลประกอบและแหล่งร่วม</strong><span>{formatCount(traceSupportingSources.length)} แถว · {Object.entries(traceSupportingCounts).map(([sourceId, count]) => `${sourceId} ${formatCount(count)}`).join(' · ')}</span></button>
                      {traceShowSupportingSources && <div className="pw-lineage-source-list">{traceSupportingSources.map((source, index) => <TraceabilitySourceCard key={`${String(source.source_id)}-${String(source.source_record_id)}-${index}`} source={source} />)}</div>}
                    </section>}
                  </div>}
                </section>
              </div>}
            </section>
          )}
        </div>
      </main>
    </div>
  );
};
