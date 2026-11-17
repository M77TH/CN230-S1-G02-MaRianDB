import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileSpreadsheet,
  Filter,
  FolderKanban,
  Grid3X3,
  Info,
  Layers,
  ListFilter,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Table2,
  X
} from 'lucide-react';
import { useWebsiteData } from '../../data/websiteData';
import { copyToClipboard, downloadCsv, formatAmount, isHttpUrl } from '../../utils/format';
import '../../styles/views.css';

export type DatasetMode =
  | 'all'
  | 'upstream'
  | 'refinery_intake'
  | 'refinery_output'
  | 'gsp'
  | 'emissions'
  | 'files'
  | 'sources';

type RecordViewMode = 'table' | 'grouped' | 'pivot';
type GroupByField = 'process_name' | 'flow_name' | '_source_id' | 'year';
type SortField = 'source' | 'year' | 'process' | 'flow' | 'direction' | 'amount';
type SortDirection = 'asc' | 'desc';
type ProcessedRecord = Record<string, string>;

interface AcceptedFileMeta {
  sourceId: string;
  file: string;
  path: string;
  sha256: string;
  records: number;
  updatedAt: string;
  publicUrl?: string;
}

interface AcceptedDataResponse {
  stage: string;
  dataPath: string;
  updatedAt: string | null;
  sourceIds: string[];
  recordCount: number;
  files: AcceptedFileMeta[];
  records: ProcessedRecord[];
}

interface RegistrySource {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  status: string;
  sector: string;
  notes: string;
  sourceOverview?: string;
  verifiedFindings?: string;
  limitations?: string;
  verificationMethod?: string;
  evidenceCount?: number;
  evidenceAssets?: { figure: string; caption: string; path: string; sha256: string; publicUrl?: string }[];
}

interface RegistryResponse {
  registryPath: string;
  updatedAt: string;
  total: number;
  sources: RegistrySource[];
}

interface ProcessedSnapshotResponse {
  accepted: AcceptedDataResponse;
  registry: RegistryResponse;
}

interface DataExplorerViewProps {
  onOpenRegistry?: (sourceId?: string) => void;
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`);
  return payload as T;
}

function display(value: unknown): string {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function prettyDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('th-TH');
}

function isUpstreamRecord(row: ProcessedRecord): boolean {
  const sourceId = row._source_id || '';
  return row.domain === 'Upstream - E&P' || ['SRC-044', 'SRC-045', 'SRC-046', 'SRC-047'].includes(sourceId);
}

function isRefineryIntakeRecord(row: ProcessedRecord): boolean {
  return row._source_id === 'SRC-049';
}

function isRefineryOutputRecord(row: ProcessedRecord): boolean {
  return row._source_id === 'SRC-048';
}

function isGspRecord(row: ProcessedRecord): boolean {
  return row._source_id === 'SRC-050' || row.domain === 'Midstream - GSP';
}

function isEmissionsOrEnvRecord(row: ProcessedRecord): boolean {
  return (
    row.flow_type === 'elementary' ||
    row.compartment === 'air' ||
    row._subtrack === 'Environmental-Performance' ||
    row._subtrack === 'Regulatory-Guideline'
  );
}

function matchesDatasetMode(row: ProcessedRecord, mode: DatasetMode): boolean {
  switch (mode) {
    case 'all':
    case 'files':
    case 'sources':
      return true;
    case 'upstream':
      return isUpstreamRecord(row);
    case 'refinery_intake':
      return isRefineryIntakeRecord(row);
    case 'refinery_output':
      return isRefineryOutputRecord(row);
    case 'gsp':
      return isGspRecord(row);
    case 'emissions':
      return isEmissionsOrEnvRecord(row);
    default:
      return true;
  }
}

function formatSmartAmount(val: string | undefined, exact: boolean): string {
  if (val === undefined || val === null || val === '') return '—';
  if (exact) return val;
  const num = Number(val);
  if (Number.isNaN(num)) return val;
  return formatAmount(num);
}

function formatPercent(val: string | undefined): string | null {
  if (!val) return null;
  const num = Number(val);
  if (Number.isNaN(num)) return null;
  return `${(num * 100).toFixed(2)}%`;
}

function getRecordKey(row: ProcessedRecord, index?: number): string {
  return `${row._source_id || 'src'}__${row._validated_file || 'file'}__${row.record_id || index || 0}__${row.year || ''}__${row.flow_name || ''}`;
}

const MODE_META: Record<DatasetMode, { title: string; subtitle: string; badge: string }> = {
  all: {
    title: 'ระเบียนที่ผ่านการตรวจสอบทั้งหมด',
    subtitle: 'รวมทุกชุดข้อมูลที่ผ่านขั้นตอน Validation ใน web/data พร้อมค้นหา กรองหลายมิติ และตรวจสอบย้อนกลับถึงไฟล์ต้นทาง',
    badge: 'validation/accepted · 18 แหล่ง'
  },
  upstream: {
    title: 'การสำรวจและผลิตปิโตรเลียมต้นน้ำ (Upstream E&P)',
    subtitle: 'ปริมาณการผลิตน้ำมันดิบ ก๊าซธรรมชาติ คอนเดนเสท และข้อมูลสิ่งแวดล้อมต้นน้ำ (SRC-044 ถึง SRC-047)',
    badge: 'SRC-044 / 045 / 046 / 047'
  },
  refinery_intake: {
    title: 'โรงกลั่น: ปริมาณน้ำมันดิบเข้ากลั่นรายโรงกลั่น',
    subtitle: 'ข้อมูลปริมาณ Crude Oil ขาเข้าแยกตามโรงกลั่นในประเทศไทย (BANGCHAK, ESSO/BSRC, THAI OIL, IRPC, PTTGC, SPRC, FANG, RPC)',
    badge: 'SRC-049 · 8 โรงกลั่น'
  },
  refinery_output: {
    title: 'โรงกลั่น: การผลิตผลิตภัณฑ์ปิโตรเลียมสำเร็จรูป',
    subtitle: 'ปริมาณผลิตภัณฑ์ขาออกจากกระบวนการกลั่น (Diesel, Gasoline, Jet Fuel, LPG, Fuel Oil, Kerosene) พร้อมสัดส่วนปันส่วน (Allocation)',
    badge: 'SRC-048 · 6 ผลิตภัณฑ์หลัก'
  },
  gsp: {
    title: 'โรงแยกก๊าซธรรมชาติ (Gas Separation Plant - GSP)',
    subtitle: 'ปริมาณการใช้ก๊าซธรรมชาติเข้ากระบวนการแยกก๊าซธรรมชาติรายปี (SRC-050)',
    badge: 'SRC-050 · Midstream GSP'
  },
  emissions: {
    title: 'สิ่งแวดล้อม ก๊าซเรือนกระจก และเกณฑ์การคำนวณ',
    subtitle: 'การปล่อยก๊าซเรือนกระจก (Scope 1 & 2, CH4), มลพิษทางอากาศ (NOx, SOx, VOCs), การใช้พลังงานภายใน และเกณฑ์ DMF',
    badge: 'GHG · Air Emissions · ESG'
  },
  files: {
    title: 'ไฟล์ชุดข้อมูลที่ผ่านการตรวจสอบ (Validated CSV Files)',
    subtitle: 'ตรวจสอบรายการไฟล์ CSV ทั้ง 18 ไฟล์ใน web/data/validation/accepted พร้อมค่า SHA-256 และคลิกเพื่อเปิดดูข้อมูลเฉพาะไฟล์',
    badge: '18 Validated Files'
  },
  sources: {
    title: 'ทะเบียนแหล่งข้อมูลและหลักฐานประกอบ (Source Registry)',
    subtitle: 'ทะเบียนแหล่งข้อมูลหลัก (SRC) และหลักฐานทางเทคนิค (TSRC) พร้อมสถานะการตรวจสอบ ข้อจำกัด และลิงก์ต้นฉบับ',
    badge: 'SRC + TSRC Registry'
  }
};

export const DataExplorerView: React.FC<DataExplorerViewProps> = ({ onOpenRegistry }) => {
  const { catalog } = useWebsiteData();

  // Primary navigation & view state
  const [datasetMode, setDatasetMode] = useState<DatasetMode>('all');
  const [recordViewMode, setRecordViewMode] = useState<RecordViewMode>('table');
  const [groupByField, setGroupByField] = useState<GroupByField>('process_name');

  // Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSource, setSelectedSource] = useState('all');
  const [selectedYear, setSelectedYear] = useState('all');
  const [selectedProcess, setSelectedProcess] = useState('all');
  const [selectedFlow, setSelectedFlow] = useState('all');
  const [selectedFile, setSelectedFile] = useState('all');
  const [directionFilter, setDirectionFilter] = useState<'all' | 'IN' | 'OUT'>('all');
  const [flowTypeFilter, setFlowTypeFilter] = useState<'all' | 'product' | 'elementary'>('all');
  const [onlyReference, setOnlyReference] = useState(false);

  // Source registry specific filters
  const [registryStatusFilter, setRegistryStatusFilter] = useState<string>('all');
  const [registrySectorFilter, setRegistrySectorFilter] = useState<string>('all');

  // Table sorting, formatting & pagination state
  const [sortField, setSortField] = useState<SortField>('year');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');
  const [showExactDecimals, setShowExactDecimals] = useState(false);
  const [pageSize, setPageSize] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [pivotYearLimit, setPivotYearLimit] = useState<number>(12);

  // Inspector & expanded group state
  const [selectedRecordKey, setSelectedRecordKey] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  // Data loading state
  const [accepted, setAccepted] = useState<AcceptedDataResponse | null>(null);
  const [registry, setRegistry] = useState<RegistryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const snapshot = await getJson<ProcessedSnapshotResponse>(
        `${import.meta.env.BASE_URL || '/'}processed_snapshot.json`
      );
      setAccepted(snapshot.accepted);
      setRegistry(snapshot.registry);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'โหลด snapshot ที่บันทึกไว้ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleCopy = useCallback(async (text: string, token: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopiedToken(token);
      window.setTimeout(() => {
        setCopiedToken((prev) => (prev === token ? null : prev));
      }, 1800);
    }
  }, []);

  const allRecords = useMemo(() => accepted?.records ?? [], [accepted]);
  const sources = useMemo(() => registry?.sources ?? [], [registry]);

  // Map sourceId -> RegistrySource for rich labels & tooltips
  const sourceMap = useMemo(() => {
    const map = new Map<string, RegistrySource>();
    for (const s of sources) {
      map.set(s.sourceId, s);
    }
    return map;
  }, [sources]);

  // Count accepted records per sourceId
  const acceptedCountBySource = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of allRecords) {
      const sid = row._source_id || '';
      if (sid) counts.set(sid, (counts.get(sid) ?? 0) + 1);
    }
    return counts;
  }, [allRecords]);

  // Sidebar dataset counts
  const modeCounts = useMemo(() => {
    let upstream = 0;
    let refineryIntake = 0;
    let refineryOutput = 0;
    let gsp = 0;
    let emissions = 0;
    for (const row of allRecords) {
      if (isUpstreamRecord(row)) upstream++;
      if (isRefineryIntakeRecord(row)) refineryIntake++;
      if (isRefineryOutputRecord(row)) refineryOutput++;
      if (isGspRecord(row)) gsp++;
      if (isEmissionsOrEnvRecord(row)) emissions++;
    }
    return {
      all: allRecords.length,
      upstream,
      refinery_intake: refineryIntake,
      refinery_output: refineryOutput,
      gsp,
      emissions,
      files: accepted?.files.length ?? 0,
      sources: registry?.total ?? sources.length
    };
  }, [allRecords, accepted, registry, sources]);

  // Records scoped to the active datasetMode (before facet filters)
  const modeScopedRecords = useMemo(() => {
    return allRecords.filter((row) => matchesDatasetMode(row, datasetMode));
  }, [allRecords, datasetMode]);

  // Dynamic facet options based on modeScopedRecords
  const facetOptions = useMemo(() => {
    const sourceCounts = new Map<string, number>();
    const yearCounts = new Map<string, number>();
    const processCounts = new Map<string, number>();
    const flowCounts = new Map<string, number>();

    for (const row of modeScopedRecords) {
      const sid = row._source_id || '';
      const yr = row.year || row._report_period || '';
      const proc = row.process_name || '';
      const flow = row.flow_name || '';
      if (sid) sourceCounts.set(sid, (sourceCounts.get(sid) ?? 0) + 1);
      if (yr) yearCounts.set(yr, (yearCounts.get(yr) ?? 0) + 1);
      if (proc) processCounts.set(proc, (processCounts.get(proc) ?? 0) + 1);
      if (flow) flowCounts.set(flow, (flowCounts.get(flow) ?? 0) + 1);
    }

    const sortedSources = Array.from(sourceCounts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const sortedYears = Array.from(yearCounts.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    const sortedProcesses = Array.from(processCounts.entries()).sort((a, b) => b[1] - a[1]);
    const sortedFlows = Array.from(flowCounts.entries()).sort((a, b) => b[1] - a[1]);

    return {
      sources: sortedSources,
      years: sortedYears,
      processes: sortedProcesses,
      flows: sortedFlows
    };
  }, [modeScopedRecords]);

  // Filtered records (applying search + all facet filters)
  const filteredRecords = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return modeScopedRecords.filter((row) => {
      const sourceId = row._source_id || '';
      const year = row.year || row._report_period || '';
      const processName = row.process_name || '';
      const flowName = row.flow_name || '';

      if (selectedSource !== 'all' && sourceId !== selectedSource) return false;
      if (selectedFile !== 'all' && row._validated_file !== selectedFile) return false;
      if (selectedYear !== 'all') {
        if (selectedYear === 'recent_2022_2026') {
          const numYear = Number(row.year);
          if (Number.isNaN(numYear) || numYear < 2022) return false;
        } else if (year !== selectedYear) {
          return false;
        }
      }
      if (selectedProcess !== 'all' && processName !== selectedProcess) return false;
      if (selectedFlow !== 'all' && flowName !== selectedFlow) return false;
      if (directionFilter !== 'all' && row.direction !== directionFilter) return false;
      if (flowTypeFilter !== 'all' && row.flow_type !== flowTypeFilter) return false;
      if (onlyReference && row.is_reference !== 'True') return false;

      if (query) {
        const sourceTitle = sourceMap.get(sourceId)?.title ?? '';
        const matchesRow = Object.values(row).some((value) =>
          String(value ?? '').toLocaleLowerCase().includes(query)
        );
        const matchesSourceTitle = sourceTitle.toLocaleLowerCase().includes(query);
        if (!matchesRow && !matchesSourceTitle) return false;
      }

      return true;
    });
  }, [
    modeScopedRecords,
    searchQuery,
    selectedSource,
    selectedFile,
    selectedYear,
    selectedProcess,
    selectedFlow,
    directionFilter,
    flowTypeFilter,
    onlyReference,
    sourceMap
  ]);

  // Sorted records
  const sortedRecords = useMemo(() => {
    const copy = [...filteredRecords];
    const dir = sortDirection === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      switch (sortField) {
        case 'source':
          return dir * (a._source_id || '').localeCompare(b._source_id || '');
        case 'year': {
          const ya = Number(a.year) || 0;
          const yb = Number(b.year) || 0;
          if (ya !== yb) return dir * (ya - yb);
          return (a._source_id || '').localeCompare(b._source_id || '');
        }
        case 'process':
          return dir * (a.process_name || '').localeCompare(b.process_name || '', 'th');
        case 'flow':
          return dir * (a.flow_name || '').localeCompare(b.flow_name || '', 'th');
        case 'direction':
          return dir * (a.direction || '').localeCompare(b.direction || '');
        case 'amount': {
          const na = Number(a.amount);
          const nb = Number(b.amount);
          const va = Number.isNaN(na) ? -Infinity : na;
          const vb = Number.isNaN(nb) ? -Infinity : nb;
          return dir * (va - vb);
        }
        default:
          return 0;
      }
    });
    return copy;
  }, [filteredRecords, sortField, sortDirection]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    datasetMode,
    searchQuery,
    selectedSource,
    selectedFile,
    selectedYear,
    selectedProcess,
    selectedFlow,
    directionFilter,
    flowTypeFilter,
    onlyReference,
    pageSize
  ]);

  // Pagination slice
  const totalPages = useMemo(() => {
    if (pageSize <= 0) return 1;
    return Math.max(1, Math.ceil(sortedRecords.length / pageSize));
  }, [sortedRecords.length, pageSize]);

  const paginatedRecords = useMemo(() => {
    if (pageSize <= 0) return sortedRecords;
    const start = (currentPage - 1) * pageSize;
    return sortedRecords.slice(start, start + pageSize);
  }, [sortedRecords, currentPage, pageSize]);

  // Live KPI metrics for currently filtered records
  const liveStats = useMemo(() => {
    const years = new Set<number>();
    const srcs = new Set<string>();
    const procs = new Set<string>();
    const flows = new Set<string>();
    const units = new Map<string, { sum: number; count: number; min: number; max: number }>();
    let inCount = 0;
    let outCount = 0;
    let elementaryCount = 0;

    for (const row of filteredRecords) {
      const y = Number(row.year);
      if (!Number.isNaN(y) && y > 1900) years.add(y);
      if (row._source_id) srcs.add(row._source_id);
      if (row.process_name) procs.add(row.process_name);
      if (row.flow_name) flows.add(row.flow_name);
      if (row.direction === 'IN') inCount++;
      if (row.direction === 'OUT') outCount++;
      if (row.flow_type === 'elementary') elementaryCount++;

      const amt = Number(row.amount);
      const unit = row.unit || '';
      if (!Number.isNaN(amt) && unit) {
        const prev = units.get(unit);
        if (!prev) {
          units.set(unit, { sum: amt, count: 1, min: amt, max: amt });
        } else {
          prev.sum += amt;
          prev.count += 1;
          if (amt < prev.min) prev.min = amt;
          if (amt > prev.max) prev.max = amt;
        }
      }
    }

    const sortedYearNums = Array.from(years).sort((a, b) => a - b);
    const yearSpan =
      sortedYearNums.length === 0
        ? '—'
        : sortedYearNums.length === 1
          ? `${sortedYearNums[0]}`
          : `${sortedYearNums[0]} – ${sortedYearNums[sortedYearNums.length - 1]}`;

    const unitEntries = Array.from(units.entries()).sort((a, b) => b[1].count - a[1].count);
    const singleUnit = unitEntries.length === 1 ? { unit: unitEntries[0][0], ...unitEntries[0][1] } : null;

    return {
      total: filteredRecords.length,
      baseTotal: modeScopedRecords.length,
      yearSpan,
      yearCount: sortedYearNums.length,
      sourceCount: srcs.size,
      processCount: procs.size,
      flowCount: flows.size,
      inCount,
      outCount,
      elementaryCount,
      singleUnit,
      topUnits: unitEntries.slice(0, 3)
    };
  }, [filteredRecords, modeScopedRecords.length]);

  // Grouped summary data (when recordViewMode === 'grouped')
  const groupedData = useMemo(() => {
    const map = new Map<
      string,
      {
        key: string;
        label: string;
        sublabel: string;
        records: ProcessedRecord[];
        sources: Set<string>;
        flows: Set<string>;
        years: Set<string>;
        units: Map<string, number>;
      }
    >();

    for (const row of sortedRecords) {
      const rawKey = row[groupByField] || 'ไม่ระบุ';
      let sublabel = '';
      if (groupByField === '_source_id') {
        sublabel = sourceMap.get(rawKey)?.title || '';
      } else if (groupByField === 'process_name') {
        sublabel = row.location_name || row.domain || '';
      } else if (groupByField === 'flow_name') {
        sublabel = `${row.flow_type === 'elementary' ? 'Air Emission' : 'Product / Energy'} · หน่วยหลัก: ${row.unit || '—'}`;
      }

      let group = map.get(rawKey);
      if (!group) {
        group = {
          key: rawKey,
          label: rawKey,
          sublabel,
          records: [],
          sources: new Set(),
          flows: new Set(),
          years: new Set(),
          units: new Map()
        };
        map.set(rawKey, group);
      }
      group.records.push(row);
      if (row._source_id) group.sources.add(row._source_id);
      if (row.flow_name) group.flows.add(row.flow_name);
      if (row.year) group.years.add(row.year);
      const amt = Number(row.amount);
      if (!Number.isNaN(amt) && row.unit) {
        group.units.set(row.unit, (group.units.get(row.unit) ?? 0) + amt);
      }
    }

    return Array.from(map.values()).sort((a, b) => {
      if (groupByField === 'year') return b.key.localeCompare(a.key);
      return b.records.length - a.records.length;
    });
  }, [sortedRecords, groupByField, sourceMap]);

  // Pivot matrix data (when recordViewMode === 'pivot')
  const pivotData = useMemo(() => {
    const yearSet = new Set<string>();
    const rowMap = new Map<
      string,
      {
        rowKey: string;
        sourceId: string;
        processName: string;
        flowName: string;
        direction: string;
        unit: string;
        byYear: Map<string, ProcessedRecord>;
      }
    >();

    for (const rec of sortedRecords) {
      const yr = rec.year || rec._report_period || '—';
      yearSet.add(yr);
      const rKey = `${rec._source_id}||${rec.process_name}||${rec.flow_name}||${rec.direction}||${rec.unit}`;
      let entry = rowMap.get(rKey);
      if (!entry) {
        entry = {
          rowKey: rKey,
          sourceId: rec._source_id || '',
          processName: rec.process_name || '',
          flowName: rec.flow_name || '',
          direction: rec.direction || '',
          unit: rec.unit || '',
          byYear: new Map()
        };
        rowMap.set(rKey, entry);
      }
      entry.byYear.set(yr, rec);
    }

    const allYears = Array.from(yearSet).sort((a, b) => b.localeCompare(a));
    const visibleYears = pivotYearLimit > 0 ? allYears.slice(0, pivotYearLimit) : allYears;
    const rows = Array.from(rowMap.values()).sort((a, b) => {
      const sCmp = a.sourceId.localeCompare(b.sourceId);
      if (sCmp !== 0) return sCmp;
      const pCmp = a.processName.localeCompare(b.processName, 'th');
      if (pCmp !== 0) return pCmp;
      return a.flowName.localeCompare(b.flowName, 'th');
    });

    return {
      allYearsCount: allYears.length,
      years: visibleYears,
      rows
    };
  }, [sortedRecords, pivotYearLimit]);

  // Selected record & navigation in inspector
  const selectedRecordInfo = useMemo(() => {
    if (!selectedRecordKey) return null;
    const index = sortedRecords.findIndex((r, idx) => getRecordKey(r, idx) === selectedRecordKey);
    if (index === -1) return null;
    return {
      record: sortedRecords[index],
      index,
      total: sortedRecords.length,
      prevKey: index > 0 ? getRecordKey(sortedRecords[index - 1], index - 1) : null,
      nextKey: index < sortedRecords.length - 1 ? getRecordKey(sortedRecords[index + 1], index + 1) : null
    };
  }, [selectedRecordKey, sortedRecords]);

  // Filtered sources for Source Registry mode
  const registrySectors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of sources) {
      if (s.sector) counts.set(s.sector, (counts.get(s.sector) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  }, [sources]);

  const filteredSources = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return sources.filter((source) => {
      if (registryStatusFilter !== 'all' && source.status !== registryStatusFilter) return false;
      if (registrySectorFilter !== 'all' && source.sector !== registrySectorFilter) return false;
      if (!query) return true;
      return [
        source.sourceId,
        source.title,
        source.publisher,
        source.url,
        source.sector,
        source.notes,
        source.sourceOverview,
        source.verifiedFindings,
        source.limitations,
        source.verificationMethod
      ].some((value) => String(value ?? '').toLocaleLowerCase().includes(query));
    });
  }, [sources, searchQuery, registryStatusFilter, registrySectorFilter]);

  // Check if any filter is active
  const hasActiveFilters =
    searchQuery.trim() !== '' ||
    selectedSource !== 'all' ||
    selectedFile !== 'all' ||
    selectedYear !== 'all' ||
    selectedProcess !== 'all' ||
    selectedFlow !== 'all' ||
    directionFilter !== 'all' ||
    flowTypeFilter !== 'all' ||
    onlyReference;

  const resetAllFilters = useCallback(() => {
    setSearchQuery('');
    setSelectedSource('all');
    setSelectedFile('all');
    setSelectedYear('all');
    setSelectedProcess('all');
    setSelectedFlow('all');
    setDirectionFilter('all');
    setFlowTypeFilter('all');
    setOnlyReference(false);
    setRegistryStatusFilter('all');
    setRegistrySectorFilter('all');
  }, []);

  const handleSelectDatasetMode = useCallback((mode: DatasetMode) => {
    setDatasetMode(mode);
    setSelectedSource('all');
    setSelectedFile('all');
    setSelectedYear('all');
    setSelectedProcess('all');
    setSelectedFlow('all');
    setDirectionFilter('all');
    setFlowTypeFilter('all');
    setOnlyReference(false);
  }, []);

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDirection(field === 'amount' || field === 'year' ? 'desc' : 'asc');
      }
    },
    [sortField]
  );

  const renderSortIcon = (field: SortField) => {
    if (sortField !== field) return <ArrowUpDown size={12} className="explorer-sort-icon is-idle" />;
    return sortDirection === 'asc' ? (
      <ArrowUp size={12} className="explorer-sort-icon is-active" />
    ) : (
      <ArrowDown size={12} className="explorer-sort-icon is-active" />
    );
  };

  const recordColumns = useMemo(() => {
    return Array.from(new Set(sortedRecords.flatMap((row) => Object.keys(row))));
  }, [sortedRecords]);

  const unlinkedCatalogRecords = catalog!.lineage.reduce((total, item) => total + item.unlinkedCount, 0);

  const exportRecords = () => {
    if (!recordColumns.length) return;
    downloadCsv(
      `CN230_processed_${datasetMode}_${new Date().toISOString().slice(0, 10)}.csv`,
      recordColumns,
      sortedRecords.map((row) => recordColumns.map((column) => row[column] ?? ''))
    );
  };

  const exportSources = () =>
    downloadCsv(
      `CN230_source_registry_${new Date().toISOString().slice(0, 10)}.csv`,
      [
        'source_id',
        'title',
        'publisher',
        'url',
        'status',
        'sector',
        'notes',
        'source_overview',
        'verified_findings',
        'limitations',
        'verification_method'
      ],
      filteredSources.map((source) => [
        source.sourceId,
        source.title,
        source.publisher,
        source.url,
        source.status,
        source.sector,
        source.notes,
        source.sourceOverview ?? '',
        source.verifiedFindings ?? '',
        source.limitations ?? '',
        source.verificationMethod ?? ''
      ])
    );

  const isRecordMode = datasetMode !== 'sources' && datasetMode !== 'files';
  const currentMeta = MODE_META[datasetMode];

  return (
    <div className="explorer-view">
      {/* Page Header */}
      <section className="explorer-intro">
        <div>
          <span className="explorer-intro-eyebrow">CN230 · ข้อมูลที่ประมวลผลในโครงการ</span>
          <h1>สำรวจข้อมูลปิโตรเลียมไทย</h1>
          <p>
            ค้นหา กรองหลายมิติ เปรียบเทียบรายปี และตรวจสอบย้อนกลับถึงไฟล์ต้นทาง (URL, SHA-256, สูตรแปลงหน่วย และสัดส่วนปันส่วน)
            จากชุดข้อมูลที่ผ่านการตรวจสอบใน <code>web/data</code>
          </p>
        </div>
        <div className="explorer-intro-actions">
          <button
            type="button"
            onClick={() => void loadData()}
            className="explorer-refresh-btn"
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'explorer-spin' : ''} />
            <span>โหลดข้อมูลใหม่</span>
          </button>
          <button
            type="button"
            onClick={datasetMode === 'sources' ? exportSources : exportRecords}
            className="explorer-export-btn"
            disabled={loading || (datasetMode === 'sources' ? filteredSources.length === 0 : sortedRecords.length === 0)}
          >
            <Download size={13} />
            <span>ส่งออก CSV ({datasetMode === 'sources' ? filteredSources.length : sortedRecords.length})</span>
          </button>
        </div>
      </section>

      {/* Main Workspace */}
      <div className="explorer-workspace">
        {/* Left Dataset Rail */}
        <aside className="explorer-dataset-sidebar" aria-label="เลือกชุดข้อมูล">
          <div className="explorer-dataset-sidebar-heading">
            <span>หมวดหมู่ข้อมูล</span>
            <small>เลือกชุดข้อมูลที่ต้องการเข้าถึง</small>
          </div>

          <div className="explorer-sidebar-group-label">ระเบียนที่ผ่าน Validation</div>
          {(
            [
              ['all', 'ระเบียนทั้งหมด', 'validation/accepted', modeCounts.all],
              ['upstream', 'การผลิตต้นน้ำ (Upstream)', 'SRC-044 / 045 / 046 / 047', modeCounts.upstream],
              ['refinery_intake', 'โรงกลั่น: น้ำมันดิบเข้ากลั่น', 'SRC-049 · 8 โรงกลั่น', modeCounts.refinery_intake],
              ['refinery_output', 'โรงกลั่น: ผลิตภัณฑ์สำเร็จรูป', 'SRC-048 · 6 ผลิตภัณฑ์', modeCounts.refinery_output],
              ['gsp', 'โรงแยกก๊าซธรรมชาติ (GSP)', 'SRC-050 · ก๊าซเข้า GSP', modeCounts.gsp],
              ['emissions', 'ก๊าซเรือนกระจก & สิ่งแวดล้อม', 'GHG · Air · เกณฑ์ DMF', modeCounts.emissions]
            ] as [DatasetMode, string, string, number][]
          ).map(([mode, label, sub, count]) => (
            <button
              key={mode}
              type="button"
              onClick={() => handleSelectDatasetMode(mode)}
              className={`explorer-dataset-choice ${datasetMode === mode ? 'is-selected' : ''}`}
              aria-pressed={datasetMode === mode}
            >
              <span className="explorer-dataset-choice-copy">
                <strong>{label}</strong>
                <small>{sub}</small>
              </span>
              <span className="explorer-dataset-count">{count.toLocaleString()}</span>
            </button>
          ))}

          <div className="explorer-sidebar-group-label explorer-sidebar-group-label--spaced">ไฟล์และแหล่งอ้างอิง</div>
          {(
            [
              ['files', 'ไฟล์ที่ผ่านการตรวจสอบ', '18 ไฟล์ CSV + SHA-256', modeCounts.files],
              ['sources', 'ทะเบียนแหล่งข้อมูล', 'SRC + TSRC ทั้งโครงการ', modeCounts.sources]
            ] as [DatasetMode, string, string, number][]
          ).map(([mode, label, sub, count]) => (
            <button
              key={mode}
              type="button"
              onClick={() => handleSelectDatasetMode(mode)}
              className={`explorer-dataset-choice ${datasetMode === mode ? 'is-selected' : ''}`}
              aria-pressed={datasetMode === mode}
            >
              <span className="explorer-dataset-choice-copy">
                <strong>{label}</strong>
                <small>{sub}</small>
              </span>
              <span className="explorer-dataset-count">{count.toLocaleString()}</span>
            </button>
          ))}

          <div className="explorer-sidebar-note">
            <Database size={14} />
            <span>
              อัปเดตล่าสุด: <strong>{prettyDate(datasetMode === 'sources' ? registry?.updatedAt : accepted?.updatedAt)}</strong>
            </span>
          </div>
        </aside>

        {/* Center + Right Content Area */}
        <div className="explorer-content-stack">
          <section className="explorer-main-panel">
            {/* Panel Header with View Switcher */}
            <header className="explorer-panel-header">
              <div className="explorer-panel-title-block">
                <div className="explorer-panel-eyebrow-row">
                  <span className="explorer-panel-eyebrow">{currentMeta.badge}</span>
                  {selectedFile !== 'all' && (
                    <span className="explorer-file-active-pill">
                      ไฟล์: {selectedFile}
                      <button type="button" onClick={() => setSelectedFile('all')} aria-label="ล้างตัวกรองไฟล์">
                        <X size={11} />
                      </button>
                    </span>
                  )}
                </div>
                <h2>{currentMeta.title}</h2>
                <p>{currentMeta.subtitle}</p>
              </div>

              {isRecordMode && (
                <div className="explorer-view-switcher" role="group" aria-label="รูปแบบการแสดงผล">
                  <button
                    type="button"
                    onClick={() => setRecordViewMode('table')}
                    className={`explorer-view-btn ${recordViewMode === 'table' ? 'is-active' : ''}`}
                  >
                    <Table2 size={14} />
                    <span>ตารางข้อมูล</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecordViewMode('grouped')}
                    className={`explorer-view-btn ${recordViewMode === 'grouped' ? 'is-active' : ''}`}
                  >
                    <Layers size={14} />
                    <span>จัดกลุ่มสรุป</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setRecordViewMode('pivot')}
                    className={`explorer-view-btn ${recordViewMode === 'pivot' ? 'is-active' : ''}`}
                  >
                    <Grid3X3 size={14} />
                    <span>เปรียบเทียบรายปี</span>
                  </button>
                </div>
              )}
            </header>

            {/* Multi-dimensional Filter Workbench for Records */}
            {isRecordMode && (
              <div className="explorer-filter-workbench">
                <div className="explorer-filter-row-primary">
                  {/* Search Input */}
                  <div className="explorer-search-box">
                    <Search size={14} className="explorer-search-icon" />
                    <input
                      type="text"
                      placeholder="ค้นหาชื่อกระแส, โรงกลั่น, กระบวนการ, แหล่งข้อมูล, เลขหน้า, batch..."
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      className="explorer-search-input"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="explorer-search-clear"
                        aria-label="ล้างคำค้นหา"
                      >
                        <X size={13} />
                      </button>
                    )}
                  </div>

                  {/* Source Select with full Thai title */}
                  <div className="explorer-facet-control">
                    <label htmlFor="explorer-filter-source">แหล่งข้อมูล</label>
                    <select
                      id="explorer-filter-source"
                      value={selectedSource}
                      onChange={(e) => setSelectedSource(e.target.value)}
                      className="explorer-select"
                    >
                      <option value="all">ทุกแหล่งข้อมูล ({facetOptions.sources.length})</option>
                      {facetOptions.sources.map(([sid, count]) => {
                        const title = sourceMap.get(sid)?.title;
                        return (
                          <option key={sid} value={sid}>
                            {sid} {title ? `· ${title.slice(0, 38)}` : ''} ({count})
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Year Select */}
                  <div className="explorer-facet-control">
                    <label htmlFor="explorer-filter-year">ปี / ช่วงเวลา</label>
                    <select
                      id="explorer-filter-year"
                      value={selectedYear}
                      onChange={(e) => setSelectedYear(e.target.value)}
                      className="explorer-select"
                    >
                      <option value="all">ทุกปี ({facetOptions.years.length} ปี)</option>
                      <option value="recent_2022_2026">ช่วงปีล่าสุด (2022 – 2026)</option>
                      {facetOptions.years.map(([yr, count]) => (
                        <option key={yr} value={yr}>
                          ปี {yr} ({count} รายการ)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Process / Facility Select */}
                  <div className="explorer-facet-control">
                    <label htmlFor="explorer-filter-process">กระบวนการ / โรงกลั่น</label>
                    <select
                      id="explorer-filter-process"
                      value={selectedProcess}
                      onChange={(e) => setSelectedProcess(e.target.value)}
                      className="explorer-select"
                    >
                      <option value="all">ทุกกระบวนการ ({facetOptions.processes.length})</option>
                      {facetOptions.processes.map(([proc, count]) => (
                        <option key={proc} value={proc}>
                          {proc} ({count})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Flow / Product Select */}
                  <div className="explorer-facet-control">
                    <label htmlFor="explorer-filter-flow">กระแส / ผลิตภัณฑ์ / มลพิษ</label>
                    <select
                      id="explorer-filter-flow"
                      value={selectedFlow}
                      onChange={(e) => setSelectedFlow(e.target.value)}
                      className="explorer-select"
                    >
                      <option value="all">ทุกกระแสข้อมูล ({facetOptions.flows.length})</option>
                      {facetOptions.flows.map(([flow, count]) => (
                        <option key={flow} value={flow}>
                          {flow} ({count})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Secondary Quick Toggles & Popular Flow Chips */}
                <div className="explorer-filter-row-secondary">
                  <div className="explorer-pill-group">
                    <span className="explorer-filter-label">ทิศทาง:</span>
                    {(['all', 'IN', 'OUT'] as const).map((dir) => (
                      <button
                        key={dir}
                        type="button"
                        onClick={() => setDirectionFilter(dir)}
                        className={`explorer-chip-btn ${directionFilter === dir ? 'is-active' : ''}`}
                      >
                        {dir === 'all' ? 'ทั้งหมด' : dir === 'IN' ? 'IN (ขาเข้า)' : 'OUT (ขาออก)'}
                      </button>
                    ))}
                  </div>

                  <div className="explorer-pill-group">
                    <span className="explorer-filter-label">ประเภท:</span>
                    {(
                      [
                        ['all', 'ทั้งหมด'],
                        ['product', 'ผลิตภัณฑ์/พลังงาน'],
                        ['elementary', 'มลพิษ/ก๊าซเรือนกระจก']
                      ] as const
                    ).map(([ft, label]) => (
                      <button
                        key={ft}
                        type="button"
                        onClick={() => setFlowTypeFilter(ft)}
                        className={`explorer-chip-btn ${flowTypeFilter === ft ? 'is-active' : ''}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => setOnlyReference((prev) => !prev)}
                    className={`explorer-chip-btn ${onlyReference ? 'is-active' : ''}`}
                  >
                    <Sparkles size={11} />
                    <span>เฉพาะค่าอ้างอิง (Ref Flow)</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setShowExactDecimals((prev) => !prev)}
                    className={`explorer-chip-btn ${showExactDecimals ? 'is-active' : ''}`}
                    title="สลับการแสดงผลตัวเลขแบบจัดรูปแบบอ่านง่าย หรือทศนิยมเต็มจากไฟล์"
                  >
                    <span>{showExactDecimals ? 'แสดงทศนิยมเต็ม' : 'ปัดทศนิยมอ่านง่าย'}</span>
                  </button>

                  {hasActiveFilters && (
                    <button type="button" onClick={resetAllFilters} className="explorer-reset-btn">
                      <RotateCcw size={12} />
                      <span>ล้างตัวกรองทั้งหมด</span>
                    </button>
                  )}
                </div>

                {/* Quick Access Popular Flow Chips */}
                {facetOptions.flows.length > 1 && (
                  <div className="explorer-quick-flows">
                    <span className="explorer-quick-flows-label">
                      <ListFilter size={12} />
                      ทางลัดกระแสข้อมูล:
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedFlow('all')}
                      className={`explorer-flow-shortcut ${selectedFlow === 'all' ? 'is-active' : ''}`}
                    >
                      ทั้งหมด ({modeScopedRecords.length})
                    </button>
                    {facetOptions.flows.slice(0, 8).map(([flow, count]) => (
                      <button
                        key={flow}
                        type="button"
                        onClick={() => setSelectedFlow(selectedFlow === flow ? 'all' : flow)}
                        className={`explorer-flow-shortcut ${selectedFlow === flow ? 'is-active' : ''}`}
                      >
                        <span>{flow}</span>
                        <small>{count}</small>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Live Summary KPI Strip for Records */}
            {isRecordMode && !loading && !error && (
              <div className="explorer-kpi-strip">
                <div className="explorer-kpi-card">
                  <span className="explorer-kpi-label">ระเบียนที่พบ</span>
                  <div className="explorer-kpi-value-row">
                    <strong className="explorer-kpi-value">{liveStats.total.toLocaleString()}</strong>
                    {liveStats.total !== liveStats.baseTotal && (
                      <span className="explorer-kpi-sub">จาก {liveStats.baseTotal.toLocaleString()} รายการ</span>
                    )}
                  </div>
                  <small className="explorer-kpi-meta">
                    ขาเข้า (IN) {liveStats.inCount.toLocaleString()} · ขาออก (OUT) {liveStats.outCount.toLocaleString()}
                  </small>
                </div>

                <div className="explorer-kpi-card">
                  <span className="explorer-kpi-label">ช่วงปีที่มีข้อมูล</span>
                  <div className="explorer-kpi-value-row">
                    <strong className="explorer-kpi-value">{liveStats.yearSpan}</strong>
                  </div>
                  <small className="explorer-kpi-meta">ครอบคลุม {liveStats.yearCount} ปีรายงาน</small>
                </div>

                <div className="explorer-kpi-card">
                  <span className="explorer-kpi-label">ความครอบคลุม</span>
                  <div className="explorer-kpi-value-row">
                    <strong className="explorer-kpi-value">
                      {liveStats.sourceCount} แหล่ง · {liveStats.processCount} กระบวนการ
                    </strong>
                  </div>
                  <small className="explorer-kpi-meta">
                    {liveStats.flowCount} กระแสข้อมูล ({liveStats.elementaryCount} รายการมลพิษทางอากาศ)
                  </small>
                </div>

                <div className="explorer-kpi-card explorer-kpi-card--highlight">
                  {liveStats.singleUnit ? (
                    <>
                      <span className="explorer-kpi-label">ผลรวมปริมาณ ({liveStats.singleUnit.unit})</span>
                      <div className="explorer-kpi-value-row">
                        <strong className="explorer-kpi-value">{formatAmount(liveStats.singleUnit.sum)}</strong>
                        <span className="explorer-kpi-unit">{liveStats.singleUnit.unit}</span>
                      </div>
                      <small className="explorer-kpi-meta">
                        เฉลี่ย {formatAmount(liveStats.singleUnit.sum / liveStats.singleUnit.count)} · ช่วง{' '}
                        {formatAmount(liveStats.singleUnit.min)} – {formatAmount(liveStats.singleUnit.max)}
                      </small>
                    </>
                  ) : (
                    <>
                      <span className="explorer-kpi-label">หน่วยวัดหลักในผลลัพธ์</span>
                      <div className="explorer-kpi-value-row">
                        <strong className="explorer-kpi-value">
                          {liveStats.topUnits.map(([u, info]) => `${u} (${info.count})`).join(' · ') || '—'}
                        </strong>
                      </div>
                      <small className="explorer-kpi-meta">
                        เลือกกรองเฉพาะกระแสเดียวเพื่อดูผลรวมและค่าเฉลี่ยอัตโนมัติ
                      </small>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* Error & Loading states */}
            {error && (
              <div className="explorer-empty-state" role="alert">
                โหลดข้อมูลไม่สำเร็จ: {error}
              </div>
            )}
            {loading && <div className="explorer-empty-state">กำลังอ่าน snapshot จาก web/data...</div>}

            {/* =================================================================
                RECORD MODE 1: TABLE VIEW (with Inspector Drawer beside/overlay)
                ================================================================= */}
            {!loading && !error && isRecordMode && recordViewMode === 'table' && (
              <div className={`explorer-split-layout ${selectedRecordInfo ? 'has-inspector' : ''}`}>
                <div className="explorer-table-pane">
                  {sortedRecords.length === 0 ? (
                    <div className="explorer-empty-state">
                      <p>ไม่มีระเบียนที่ตรงกับตัวกรองปัจจุบัน</p>
                      {hasActiveFilters && (
                        <button type="button" onClick={resetAllFilters} className="explorer-reset-btn">
                          <RotateCcw size={12} />
                          <span>ล้างตัวกรองทั้งหมด</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Pagination & Table Controls Bar */}
                      <div className="explorer-table-toolbar">
                        <div className="explorer-table-range">
                          แสดง{' '}
                          <strong>
                            {pageSize <= 0
                              ? 1
                              : Math.min((currentPage - 1) * pageSize + 1, sortedRecords.length)}
                            –
                            {pageSize <= 0
                              ? sortedRecords.length
                              : Math.min(currentPage * pageSize, sortedRecords.length)}
                          </strong>{' '}
                          จาก <strong>{sortedRecords.length.toLocaleString()}</strong> รายการ
                          <span className="explorer-table-hint">· คลิกที่แถวเพื่อดูที่มาและสูตรการแปลง</span>
                        </div>

                        <div className="explorer-pagination-controls">
                          <label className="explorer-pagesize-label">
                            แถวต่อหน้า:
                            <select
                              value={pageSize}
                              onChange={(e) => setPageSize(Number(e.target.value))}
                              className="explorer-select explorer-select--compact"
                            >
                              <option value={25}>25</option>
                              <option value={50}>50</option>
                              <option value={100}>100</option>
                              <option value={0}>ทั้งหมด ({sortedRecords.length})</option>
                            </select>
                          </label>

                          {pageSize > 0 && totalPages > 1 && (
                            <div className="explorer-page-nav">
                              <button
                                type="button"
                                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                                disabled={currentPage <= 1}
                                className="explorer-page-btn"
                                aria-label="หน้าก่อนหน้า"
                              >
                                <ChevronLeft size={14} />
                              </button>
                              <span className="explorer-page-indicator">
                                หน้า {currentPage} / {totalPages}
                              </span>
                              <button
                                type="button"
                                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                                disabled={currentPage >= totalPages}
                                className="explorer-page-btn"
                                aria-label="หน้าถัดไป"
                              >
                                <ChevronRight size={14} />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="explorer-table-container">
                        <table className="explorer-table explorer-table--clean">
                          <thead>
                            <tr>
                              <th>
                                <button type="button" onClick={() => handleSort('source')} className="explorer-th-sort">
                                  <span>แหล่งข้อมูล</span>
                                  {renderSortIcon('source')}
                                </button>
                              </th>
                              <th>
                                <button type="button" onClick={() => handleSort('year')} className="explorer-th-sort">
                                  <span>ปี / ช่วง</span>
                                  {renderSortIcon('year')}
                                </button>
                              </th>
                              <th>
                                <button type="button" onClick={() => handleSort('process')} className="explorer-th-sort">
                                  <span>กระบวนการ & สถานที่</span>
                                  {renderSortIcon('process')}
                                </button>
                              </th>
                              <th>
                                <button type="button" onClick={() => handleSort('flow')} className="explorer-th-sort">
                                  <span>กระแสข้อมูล (Flow)</span>
                                  {renderSortIcon('flow')}
                                </button>
                              </th>
                              <th>
                                <button type="button" onClick={() => handleSort('direction')} className="explorer-th-sort">
                                  <span>ทิศทาง</span>
                                  {renderSortIcon('direction')}
                                </button>
                              </th>
                              <th className="explorer-th-right">
                                <button
                                  type="button"
                                  onClick={() => handleSort('amount')}
                                  className="explorer-th-sort explorer-th-sort--right"
                                >
                                  <span>ปริมาณ & หน่วย</span>
                                  {renderSortIcon('amount')}
                                </button>
                              </th>
                              <th>การปันส่วน / ที่มา</th>
                              <th className="explorer-th-center">รายละเอียด</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedRecords.map((row, index) => {
                              const rKey = getRecordKey(row, (currentPage - 1) * (pageSize || 0) + index);
                              const isSelected = selectedRecordKey === rKey;
                              const sourceTitle = sourceMap.get(row._source_id || '')?.title;
                              const allocPct =
                                row.allocation && row.allocation !== '1.0' && row.allocation !== '1'
                                  ? formatPercent(row.allocation)
                                  : null;
                              const proxyPct = formatPercent(row._allocation_share);

                              return (
                                <tr
                                  key={rKey}
                                  onClick={() => setSelectedRecordKey(isSelected ? null : rKey)}
                                  className={`explorer-row-interactive ${isSelected ? 'is-selected' : ''}`}
                                >
                                  <td className="explorer-cell-mono">
                                    <span className="explorer-source-badge" title={sourceTitle || row._source_id}>
                                      {display(row._source_id)}
                                    </span>
                                    {sourceTitle && (
                                      <span className="explorer-cell-subtext explorer-cell-subtext--clamp">
                                        {sourceTitle}
                                      </span>
                                    )}
                                  </td>

                                  <td className="explorer-cell-mono explorer-cell-year">
                                    <strong>{display(row.year || row._report_period)}</strong>
                                    {row.month && row.month !== 'Annual' && (
                                      <span className="explorer-cell-subtext">{row.month}</span>
                                    )}
                                  </td>

                                  <td>
                                    <div className="explorer-cell-primary">{display(row.process_name)}</div>
                                    <div className="explorer-cell-subtext">
                                      {display(row.location_name)}
                                      {row.domain ? ` · ${row.domain}` : ''}
                                    </div>
                                  </td>

                                  <td>
                                    <div className="explorer-flow-cell">
                                      <span className="explorer-cell-primary">{display(row.flow_name)}</span>
                                      <div className="explorer-flow-badges">
                                        {row.is_reference === 'True' && (
                                          <span className="explorer-mini-pill explorer-mini-pill--ref" title="Reference Flow">
                                            REF
                                          </span>
                                        )}
                                        <span
                                          className={`explorer-mini-pill ${
                                            row.flow_type === 'elementary'
                                              ? 'explorer-mini-pill--air'
                                              : 'explorer-mini-pill--product'
                                          }`}
                                        >
                                          {row.flow_type === 'elementary' ? 'Air Emission' : 'Product'}
                                        </span>
                                      </div>
                                    </div>
                                  </td>

                                  <td className="explorer-cell-mono">
                                    <span
                                      className={`explorer-dir-badge ${
                                        row.direction === 'IN' ? 'explorer-dir-badge--in' : 'explorer-dir-badge--out'
                                      }`}
                                    >
                                      {display(row.direction)}
                                    </span>
                                  </td>

                                  <td className="explorer-td-right explorer-cell-mono">
                                    <div className="explorer-amount-wrap" title={`ค่าเต็ม: ${row.amount} ${row.unit}`}>
                                      <span className="explorer-amount-num">
                                        {formatSmartAmount(row.amount, showExactDecimals)}
                                      </span>
                                      <span className="explorer-amount-unit">{display(row.unit)}</span>
                                    </div>
                                    {row._reported_value && (
                                      <div className="explorer-cell-subtext">
                                        รายงาน: {row._reported_value} {row._reported_unit}
                                      </div>
                                    )}
                                  </td>

                                  <td className="explorer-cell-mono">
                                    <div className="explorer-lineage-tags">
                                      {allocPct && (
                                        <span className="explorer-lineage-tag" title={`Product Allocation: ${row.allocation}`}>
                                          Alloc {allocPct}
                                        </span>
                                      )}
                                      {proxyPct && (
                                        <span
                                          className="explorer-lineage-tag explorer-lineage-tag--proxy"
                                          title={`PTTEP Proxy Share: ${row._allocation_share}`}
                                        >
                                          Proxy {proxyPct}
                                        </span>
                                      )}
                                      {row._conversion_multiplier && row._conversion_multiplier !== '1' && (
                                        <span className="explorer-lineage-tag">×{row._conversion_multiplier}</span>
                                      )}
                                      {row._source_page && (
                                        <span className="explorer-lineage-tag">หน้า {row._source_page}</span>
                                      )}
                                      {!allocPct && !proxyPct && (!row._conversion_multiplier || row._conversion_multiplier === '1') && !row._source_page && (
                                        <span className="explorer-cell-muted">100% Direct</span>
                                      )}
                                    </div>
                                  </td>

                                  <td className="explorer-td-center">
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSelectedRecordKey(isSelected ? null : rKey);
                                      }}
                                      className={`explorer-inspect-btn ${isSelected ? 'is-active' : ''}`}
                                    >
                                      <Eye size={13} />
                                      <span>{isSelected ? 'ปิด' : 'ดูที่มา'}</span>
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </div>

                {/* Right-Hand Record Inspector Drawer */}
                {selectedRecordInfo && (
                  <RecordInspectorDrawer
                    info={selectedRecordInfo}
                    source={sourceMap.get(selectedRecordInfo.record._source_id || '')}
                    copiedToken={copiedToken}
                    onCopy={handleCopy}
                    onClose={() => setSelectedRecordKey(null)}
                    onSelectKey={(key) => setSelectedRecordKey(key)}
                    onFilterSource={(sid) => setSelectedSource(sid)}
                    onFilterProcess={(proc) => setSelectedProcess(proc)}
                    onFilterFlow={(flow) => setSelectedFlow(flow)}
                    onOpenRegistry={onOpenRegistry}
                  />
                )}
              </div>
            )}

            {/* =================================================================
                RECORD MODE 2: GROUPED SUMMARY VIEW
                ================================================================= */}
            {!loading && !error && isRecordMode && recordViewMode === 'grouped' && (
              <div className="explorer-grouped-view">
                <div className="explorer-grouped-toolbar">
                  <div className="explorer-pill-group">
                    <span className="explorer-filter-label">
                      <FolderKanban size={13} /> จัดกลุ่มตาม:
                    </span>
                    {(
                      [
                        ['process_name', 'กระบวนการ / โรงกลั่น'],
                        ['flow_name', 'กระแส / ผลิตภัณฑ์ / มลพิษ'],
                        ['_source_id', 'แหล่งข้อมูล (SRC)'],
                        ['year', 'ปีรายงาน (Year)']
                      ] as [GroupByField, string][]
                    ).map(([field, label]) => (
                      <button
                        key={field}
                        type="button"
                        onClick={() => setGroupByField(field)}
                        className={`explorer-chip-btn ${groupByField === field ? 'is-active' : ''}`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <span className="explorer-table-hint">
                    พบ {groupedData.length} กลุ่ม จาก {sortedRecords.length.toLocaleString()} ระเบียน
                  </span>
                </div>

                <div className="explorer-grouped-list">
                  {groupedData.map((group) => {
                    const isExpanded = Boolean(expandedGroups[group.key]);
                    const sortedYears = Array.from(group.years).sort();
                    const yearRange =
                      sortedYears.length === 0
                        ? '—'
                        : sortedYears.length === 1
                          ? sortedYears[0]
                          : `${sortedYears[0]}–${sortedYears[sortedYears.length - 1]}`;
                    const unitTotals = Array.from(group.units.entries());

                    return (
                      <article key={group.key} className={`explorer-group-card ${isExpanded ? 'is-expanded' : ''}`}>
                        <header
                          className="explorer-group-card-header"
                          onClick={() =>
                            setExpandedGroups((prev) => ({
                              ...prev,
                              [group.key]: !prev[group.key]
                            }))
                          }
                        >
                          <div className="explorer-group-card-title">
                            <strong>{group.label}</strong>
                            {group.sublabel && <span>{group.sublabel}</span>}
                          </div>

                          <div className="explorer-group-card-metrics">
                            <span className="explorer-group-pill">
                              ปี: <strong>{yearRange}</strong>
                            </span>
                            <span className="explorer-group-pill">
                              แหล่ง: <strong>{Array.from(group.sources).join(', ')}</strong>
                            </span>
                            {unitTotals.length === 1 && (
                              <span className="explorer-group-pill explorer-group-pill--accent">
                                รวม: <strong>{formatAmount(unitTotals[0][1])}</strong> {unitTotals[0][0]}
                              </span>
                            )}
                            <span className="explorer-group-count">{group.records.length} ระเบียน</span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                if (groupByField === 'process_name') setSelectedProcess(group.key);
                                if (groupByField === 'flow_name') setSelectedFlow(group.key);
                                if (groupByField === '_source_id') setSelectedSource(group.key);
                                if (groupByField === 'year') setSelectedYear(group.key);
                                setRecordViewMode('table');
                              }}
                              className="explorer-group-filter-btn"
                            >
                              <Filter size={12} />
                              <span>เปิดในตาราง</span>
                            </button>
                          </div>
                        </header>

                        {isExpanded && (
                          <div className="explorer-group-card-body">
                            <table className="explorer-table explorer-table--compact">
                              <thead>
                                <tr>
                                  <th>แหล่ง</th>
                                  <th>ปี</th>
                                  <th>กระบวนการ</th>
                                  <th>กระแส</th>
                                  <th>ทิศทาง</th>
                                  <th className="explorer-th-right">ปริมาณ</th>
                                  <th>หน่วย</th>
                                  <th>ที่มา</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.records.slice(0, 50).map((row, idx) => {
                                  const rKey = getRecordKey(row, idx);
                                  return (
                                    <tr
                                      key={rKey}
                                      onClick={() => {
                                        setSelectedRecordKey(rKey);
                                        setRecordViewMode('table');
                                      }}
                                      className="explorer-row-interactive"
                                    >
                                      <td className="explorer-cell-mono">{row._source_id}</td>
                                      <td className="explorer-cell-mono">{row.year || row._report_period}</td>
                                      <td>{row.process_name}</td>
                                      <td>{row.flow_name}</td>
                                      <td className="explorer-cell-mono">{row.direction}</td>
                                      <td className="explorer-td-right explorer-cell-mono explorer-cell-strong">
                                        {formatSmartAmount(row.amount, showExactDecimals)}
                                      </td>
                                      <td className="explorer-cell-mono explorer-cell-muted">{row.unit}</td>
                                      <td>
                                        <button type="button" className="explorer-inspect-btn">
                                          <Eye size={12} />
                                          <span>ดูที่มา</span>
                                        </button>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

            {/* =================================================================
                RECORD MODE 3: YEAR PIVOT / MATRIX VIEW
                ================================================================= */}
            {!loading && !error && isRecordMode && recordViewMode === 'pivot' && (
              <div className={`explorer-split-layout ${selectedRecordInfo ? 'has-inspector' : ''}`}>
                <div className="explorer-pivot-pane">
                  <div className="explorer-table-toolbar">
                    <div className="explorer-table-range">
                      ตารางเปรียบเทียบตามปี: <strong>{pivotData.rows.length}</strong> ชุดกระแสข้อมูล ×{' '}
                      <strong>{pivotData.years.length}</strong> ปี
                      <span className="explorer-table-hint">· คลิกตัวเลขในช่องเพื่อเปิดดูที่มาและหลักฐาน</span>
                    </div>
                    <div className="explorer-pill-group">
                      <span className="explorer-filter-label">จำนวนปีที่แสดง:</span>
                      {[
                        [8, '8 ปีล่าสุด'],
                        [15, '15 ปีล่าสุด'],
                        [0, `ทุกปี (${pivotData.allYearsCount})`]
                      ].map(([limit, label]) => (
                        <button
                          key={String(limit)}
                          type="button"
                          onClick={() => setPivotYearLimit(Number(limit))}
                          className={`explorer-chip-btn ${pivotYearLimit === Number(limit) ? 'is-active' : ''}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="explorer-table-container">
                    <table className="explorer-table explorer-table--pivot">
                      <thead>
                        <tr>
                          <th className="explorer-pivot-sticky-col">กระบวนการ · กระแสข้อมูล</th>
                          <th>แหล่ง</th>
                          <th>ทิศทาง</th>
                          <th>หน่วย</th>
                          {pivotData.years.map((yr) => (
                            <th key={yr} className="explorer-th-right explorer-cell-mono">
                              {yr}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {pivotData.rows.map((pRow) => (
                          <tr key={pRow.rowKey}>
                            <td className="explorer-pivot-sticky-col">
                              <div className="explorer-cell-primary">{pRow.flowName}</div>
                              <div className="explorer-cell-subtext">{pRow.processName}</div>
                            </td>
                            <td className="explorer-cell-mono">
                              <span className="explorer-source-badge">{pRow.sourceId}</span>
                            </td>
                            <td className="explorer-cell-mono">
                              <span
                                className={`explorer-dir-badge ${
                                  pRow.direction === 'IN' ? 'explorer-dir-badge--in' : 'explorer-dir-badge--out'
                                }`}
                              >
                                {pRow.direction}
                              </span>
                            </td>
                            <td className="explorer-cell-mono explorer-cell-muted">{pRow.unit}</td>
                            {pivotData.years.map((yr) => {
                              const rec = pRow.byYear.get(yr);
                              if (!rec) {
                                return (
                                  <td key={yr} className="explorer-td-right explorer-cell-mono explorer-cell-empty">
                                    —
                                  </td>
                                );
                              }
                              const rKey = getRecordKey(rec);
                              const isSelected = selectedRecordKey === rKey;
                              return (
                                <td
                                  key={yr}
                                  onClick={() => setSelectedRecordKey(isSelected ? null : rKey)}
                                  className={`explorer-td-right explorer-cell-mono explorer-pivot-val ${
                                    isSelected ? 'is-selected' : ''
                                  }`}
                                  title={`${pRow.flowName} (${yr}): ${rec.amount} ${rec.unit} — คลิกเพื่อดูที่มา`}
                                >
                                  {formatSmartAmount(rec.amount, showExactDecimals)}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {selectedRecordInfo && (
                  <RecordInspectorDrawer
                    info={selectedRecordInfo}
                    source={sourceMap.get(selectedRecordInfo.record._source_id || '')}
                    copiedToken={copiedToken}
                    onCopy={handleCopy}
                    onClose={() => setSelectedRecordKey(null)}
                    onSelectKey={(key) => setSelectedRecordKey(key)}
                    onFilterSource={(sid) => setSelectedSource(sid)}
                    onFilterProcess={(proc) => setSelectedProcess(proc)}
                    onFilterFlow={(flow) => setSelectedFlow(flow)}
                    onOpenRegistry={onOpenRegistry}
                  />
                )}
              </div>
            )}

            {/* =================================================================
                VALIDATED FILES VIEW (datasetMode === 'files')
                ================================================================= */}
            {!loading && !error && datasetMode === 'files' && (
              <div className="explorer-files-view">
                <div className="explorer-files-grid">
                  {(accepted?.files ?? []).map((fileMeta) => {
                    const srcInfo = sourceMap.get(fileMeta.sourceId);
                    return (
                      <article key={fileMeta.file} className="explorer-file-card">
                        <div className="explorer-file-card-top">
                          <div className="explorer-file-card-badges">
                            <span className="explorer-source-badge">{fileMeta.sourceId}</span>
                            {srcInfo?.sector && <span className="explorer-mini-pill">{srcInfo.sector}</span>}
                          </div>
                          <span className="explorer-group-count">{fileMeta.records.toLocaleString()} ระเบียน</span>
                        </div>

                        <h3 className="explorer-file-card-title">{srcInfo?.title || fileMeta.sourceId}</h3>
                        <code className="explorer-file-card-name">{fileMeta.file}</code>

                        <div className="explorer-file-card-meta">
                          <div>
                            <span>Path:</span>
                            <code>{fileMeta.path}</code>
                          </div>
                          <div>
                            <span>SHA-256:</span>
                            <code title={fileMeta.sha256}>{fileMeta.sha256.slice(0, 24)}…</code>
                            <button
                              type="button"
                              onClick={() => void handleCopy(fileMeta.sha256, `file-${fileMeta.file}`)}
                              className="explorer-copy-inline"
                            >
                              {copiedToken === `file-${fileMeta.file}` ? <Check size={11} /> : <Copy size={11} />}
                            </button>
                          </div>
                          <div>
                            <span>อัปเดตเมื่อ:</span>
                            <span>{prettyDate(fileMeta.updatedAt)}</span>
                          </div>
                        </div>

                        <div className="explorer-file-card-actions">
                          <button
                            type="button"
                            onClick={() => {
                              setDatasetMode('all');
                              setSelectedSource(fileMeta.sourceId);
                              setSelectedFile(fileMeta.file);
                              setRecordViewMode('table');
                            }}
                            className="explorer-inspect-btn is-primary"
                          >
                            <FileSpreadsheet size={13} />
                            <span>เปิดดูระเบียนในไฟล์นี้ ({fileMeta.records})</span>
                          </button>
                          {fileMeta.publicUrl && (
                            <a
                              href={fileMeta.publicUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="explorer-source-link"
                            >
                              <Download size={13} />
                              <span>CSV ดิบ</span>
                            </a>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            )}

            {/* =================================================================
                SOURCE REGISTRY VIEW (datasetMode === 'sources')
                ================================================================= */}
            {!loading && datasetMode === 'sources' && (
              <div className="explorer-sources-section">
                <div className="explorer-filter-workbench">
                  <div className="explorer-filter-row-primary">
                    <div className="explorer-search-box">
                      <Search size={14} className="explorer-search-icon" />
                      <input
                        type="text"
                        placeholder="ค้นหารหัส SRC/TSRC, ชื่อเอกสาร, หน่วยงาน, ข้อจำกัด..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="explorer-search-input"
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="explorer-search-clear"
                          aria-label="ล้างคำค้น"
                        >
                          <X size={13} />
                        </button>
                      )}
                    </div>

                    <div className="explorer-pill-group">
                      <span className="explorer-filter-label">สถานะ:</span>
                      {[
                        ['all', `ทั้งหมด (${sources.length})`],
                        ['approved', 'Approved (18)'],
                        ['supporting', 'Supporting TSRC (60)'],
                        ['rejected', 'Rejected (43)']
                      ].map(([st, label]) => (
                        <button
                          key={st}
                          type="button"
                          onClick={() => setRegistryStatusFilter(st)}
                          className={`explorer-chip-btn ${registryStatusFilter === st ? 'is-active' : ''}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="explorer-facet-control">
                      <label htmlFor="explorer-registry-sector">หมวดหมู่ (Sector)</label>
                      <select
                        id="explorer-registry-sector"
                        value={registrySectorFilter}
                        onChange={(e) => setRegistrySectorFilter(e.target.value)}
                        className="explorer-select"
                      >
                        <option value="all">ทุกหมวดหมู่ ({registrySectors.length})</option>
                        {registrySectors.map(([sec, count]) => (
                          <option key={sec} value={sec}>
                            {sec} ({count})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="explorer-sources-wrap">
                  <div className="explorer-sources-grid">
                    {filteredSources.map((source) => {
                      const linkedCount = acceptedCountBySource.get(source.sourceId) ?? 0;
                      return (
                        <article key={source.sourceId} className="explorer-source-card">
                          <div className="explorer-source-main">
                            <div className="explorer-source-top">
                              <span className="explorer-source-id">{source.sourceId}</span>
                              <span
                                className={`explorer-status-pill ${
                                  source.status === 'approved'
                                    ? 'explorer-status-pill--verified'
                                    : source.status === 'rejected'
                                      ? 'explorer-status-pill--pending'
                                      : 'explorer-status-pill--total'
                                }`}
                              >
                                {source.status}
                              </span>
                              <span className="explorer-mini-pill">{source.sector}</span>
                              {linkedCount > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setDatasetMode('all');
                                    setSelectedSource(source.sourceId);
                                    setRecordViewMode('table');
                                  }}
                                  className="explorer-source-jump-btn"
                                >
                                  <Table2 size={12} />
                                  <span>ดู {linkedCount} ระเบียนในตาราง</span>
                                </button>
                              )}
                            </div>
                            <h3>{source.title}</h3>
                            <p className="explorer-source-publisher">{source.publisher}</p>
                            <p>{source.verifiedFindings || source.sourceOverview || source.notes}</p>
                            {source.limitations && (
                              <p>
                                <strong>ข้อจำกัด:</strong> {source.limitations}
                              </p>
                            )}
                            {source.verificationMethod && (
                              <p>
                                <strong>วิธีตรวจสอบ:</strong> {source.verificationMethod}
                              </p>
                            )}
                            <div className="explorer-source-links-row">
                              {isHttpUrl(source.url) && (
                                <a
                                  href={source.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="explorer-source-link"
                                >
                                  <ExternalLink size={13} />
                                  <span>เปิดแหล่งข้อมูลต้นฉบับ</span>
                                </a>
                              )}
                              {onOpenRegistry && (
                                <button
                                  type="button"
                                  onClick={() => onOpenRegistry(source.sourceId)}
                                  className="explorer-source-link"
                                >
                                  <ShieldCheck size={13} />
                                  <span>เปิดในหน้าทะเบียนแหล่งข้อมูล</span>
                                </button>
                              )}
                              {(source.evidenceAssets ?? []).map((asset) =>
                                asset.publicUrl ? (
                                  <a
                                    key={asset.path}
                                    href={asset.publicUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="explorer-source-link"
                                  >
                                    <ShieldCheck size={13} />
                                    {asset.figure} · {asset.caption}
                                  </a>
                                ) : (
                                  <span key={asset.path} className="explorer-source-link">
                                    <ShieldCheck size={13} />
                                    {asset.figure} · {asset.caption} (SHA-256 {asset.sha256.slice(0, 12)}…)
                                  </span>
                                )
                              )}
                            </div>
                          </div>
                        </article>
                      );
                    })}
                    {filteredSources.length === 0 && (
                      <div className="explorer-empty-state">ไม่พบแหล่งข้อมูลที่ตรงกับคำค้น</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </section>

          {/* Compact, Properly Aligned Website Catalog Lineage Audit at bottom of stack */}
          <details className="explorer-catalog-audit">
            <summary>
              <span>
                <strong>
                  <Info size={14} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                  การตรวจสอบความเชื่อมโยงชุดข้อมูลเว็บไซต์ (Website Catalog Lineage Audit)
                </strong>
                <small>
                  {catalog!.lineage.length} ชุดข้อมูลในแคตตาล็อก · {unlinkedCatalogRecords.toLocaleString()}{' '}
                  รายการที่ยังไม่มีตัวชี้แหล่งที่มาโดยตรง
                </small>
              </span>
              <code title={catalog!.artifact?.sha256 || ''}>
                {catalog!.artifact
                  ? `${catalog!.artifact.path} · SHA-256 ${catalog!.artifact.sha256.slice(0, 16)}…`
                  : catalog!.catalogSource}
              </code>
            </summary>
            <p>
              {catalog!.lineageMethod} A listed link is a traceability pointer, not proof that the citation supports the
              value.
            </p>
            <div className="explorer-catalog-audit-grid">
              {catalog!.lineage.map((item) => (
                <article key={item.dataset}>
                  <div>
                    <strong>{item.dataset}</strong>
                    <span>{item.recordCount.toLocaleString()} records</span>
                  </div>
                  <p>{catalog!.provenance[item.dataset] || 'No collection-level provenance note was supplied.'}</p>
                  <small>
                    {item.recordsWithSourceId} with source ID · {item.recordsWithUrl} with URL ·{' '}
                    {item.recordsWithNamedReference} with document citation · {item.recordsWithRelatedRecord} linked to
                    another catalog row · {item.unlinkedCount} without a pointer
                  </small>
                  {item.unlinkedRecordIds.length > 0 && (
                    <details>
                      <summary>Unlinked record IDs</summary>
                      <code>
                        {item.unlinkedRecordIds.join(', ')}
                        {item.unlinkedCount > item.unlinkedRecordIds.length ? ', …' : ''}
                      </code>
                    </details>
                  )}
                </article>
              ))}
            </div>
          </details>
        </div>
      </div>
    </div>
  );
};

/* ==========================================================================
   RECORD INSPECTOR DRAWER COMPONENT
   Rich side-panel showing complete lineage, conversion math & file hashes
   ========================================================================== */
interface RecordInspectorDrawerProps {
  info: {
    record: ProcessedRecord;
    index: number;
    total: number;
    prevKey: string | null;
    nextKey: string | null;
  };
  source?: RegistrySource;
  copiedToken: string | null;
  onCopy: (text: string, token: string) => void;
  onClose: () => void;
  onSelectKey: (key: string) => void;
  onFilterSource: (sourceId: string) => void;
  onFilterProcess: (processName: string) => void;
  onFilterFlow: (flowName: string) => void;
  onOpenRegistry?: (sourceId?: string) => void;
}

const RecordInspectorDrawer: React.FC<RecordInspectorDrawerProps> = ({
  info,
  source,
  copiedToken,
  onCopy,
  onClose,
  onSelectKey,
  onFilterSource,
  onFilterProcess,
  onFilterFlow,
  onOpenRegistry
}) => {
  const { record: row, index, total, prevKey, nextKey } = info;
  const hasConversion = Boolean(row._reported_value || row._conversion_multiplier);
  const hasProxyAllocation = Boolean(row._allocation_basis || row._allocation_share);
  const hasProductAllocation = Boolean(row.allocation && row.allocation !== '1.0' && row.allocation !== '1');

  return (
    <aside className="explorer-inspector" aria-label="รายละเอียดและการตรวจสอบย้อนกลับของระเบียน">
      <header className="explorer-inspector-header">
        <div>
          <span className="explorer-inspector-eyebrow">
            ระเบียน #{row.record_id || index + 1} · ลำดับที่ {index + 1}/{total}
          </span>
          <h3>ตรวจสอบที่มาและวิธีประมวลผล</h3>
        </div>
        <div className="explorer-inspector-nav">
          <button
            type="button"
            disabled={!prevKey}
            onClick={() => prevKey && onSelectKey(prevKey)}
            className="explorer-page-btn"
            title="ระเบียนก่อนหน้า"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            type="button"
            disabled={!nextKey}
            onClick={() => nextKey && onSelectKey(nextKey)}
            className="explorer-page-btn"
            title="ระเบียนถัดไป"
          >
            <ChevronRight size={14} />
          </button>
          <button type="button" onClick={onClose} className="explorer-inspector-close" aria-label="ปิดหน้าต่างรายละเอียด">
            <X size={15} />
          </button>
        </div>
      </header>

      <div className="explorer-inspector-body">
        {/* Highlight Value Card */}
        <section className="explorer-inspector-hero">
          <div className="explorer-inspector-badges">
            <span className="explorer-source-badge">{display(row._source_id)}</span>
            <span className="explorer-mini-pill">ปี {display(row.year || row._report_period)}</span>
            <span
              className={`explorer-dir-badge ${
                row.direction === 'IN' ? 'explorer-dir-badge--in' : 'explorer-dir-badge--out'
              }`}
            >
              {display(row.direction)}
            </span>
            {row.is_reference === 'True' && <span className="explorer-mini-pill explorer-mini-pill--ref">Reference Flow</span>}
          </div>

          <h4 className="explorer-inspector-flow">{display(row.flow_name)}</h4>
          <p className="explorer-inspector-process">
            {display(row.process_name)} · {display(row.location_name)}
          </p>

          <div className="explorer-inspector-value-box">
            <div>
              <span className="explorer-inspector-value-label">ปริมาณที่ผ่านการตรวจสอบ (Validated Amount)</span>
              <div className="explorer-inspector-value-main">
                <strong>{formatSmartAmount(row.amount, false)}</strong>
                <span>{display(row.unit)}</span>
              </div>
              <div className="explorer-inspector-raw-val">
                ค่าทศนิยมเต็ม: <code>{display(row.amount)}</code>
                <button
                  type="button"
                  onClick={() => onCopy(`${row.amount} ${row.unit}`, 'inspector-amount')}
                  className="explorer-copy-inline"
                  title="คัดลอกค่าตัวเลข"
                >
                  {copiedToken === 'inspector-amount' ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
            </div>
          </div>

          {/* Quick Filter Shortcuts */}
          <div className="explorer-inspector-shortcuts">
            {row._source_id && (
              <button type="button" onClick={() => onFilterSource(row._source_id)} className="explorer-shortcut-btn">
                กรองเฉพาะ {row._source_id}
              </button>
            )}
            {row.process_name && (
              <button type="button" onClick={() => onFilterProcess(row.process_name)} className="explorer-shortcut-btn">
                กรองเฉพาะกระบวนการนี้
              </button>
            )}
            {row.flow_name && (
              <button type="button" onClick={() => onFilterFlow(row.flow_name)} className="explorer-shortcut-btn">
                กรองเฉพาะ {row.flow_name}
              </button>
            )}
          </div>
        </section>

        {/* Calculation & Allocation Section */}
        <section className="explorer-inspector-section">
          <h5>การแปลงหน่วยและการปันส่วน (Conversion & Allocation)</h5>
          {hasConversion || hasProxyAllocation || hasProductAllocation ? (
            <div className="explorer-inspector-kv-list">
              {row._reported_value && (
                <div className="explorer-inspector-kv">
                  <span>ค่าที่รายงานในเอกสารต้นฉบับ</span>
                  <strong>
                    {row._reported_value} {row._reported_unit}
                  </strong>
                </div>
              )}
              {row._conversion_multiplier && (
                <div className="explorer-inspector-kv">
                  <span>ตัวคูณแปลงหน่วย (Multiplier)</span>
                  <strong>× {row._conversion_multiplier}</strong>
                </div>
              )}
              {hasProductAllocation && (
                <div className="explorer-inspector-kv">
                  <span>สัดส่วนปันส่วนผลิตภัณฑ์ (Allocation)</span>
                  <strong>
                    {formatPercent(row.allocation)} ({row.allocation})
                  </strong>
                </div>
              )}
              {row._allocation_basis && (
                <div className="explorer-inspector-kv">
                  <span>หลักการจัดสรรต้นน้ำ (Allocation Basis)</span>
                  <strong>{row._allocation_basis}</strong>
                </div>
              )}
              {row._allocation_share && (
                <div className="explorer-inspector-kv">
                  <span>สัดส่วนจัดสรร (Allocation Share)</span>
                  <strong>
                    {formatPercent(row._allocation_share)} ({row._allocation_share})
                  </strong>
                </div>
              )}
              {row._allocation_pttep_boe && (
                <div className="explorer-inspector-kv">
                  <span>ฐานการผลิต PTTEP (BOE)</span>
                  <strong>{formatAmount(row._allocation_pttep_boe)} BOE</strong>
                </div>
              )}
              {row._allocation_proxy_volume && (
                <div className="explorer-inspector-kv">
                  <span>ปริมาณ Proxy ที่จัดสรร</span>
                  <strong>{formatAmount(row._allocation_proxy_volume)} BOE</strong>
                </div>
              )}
            </div>
          ) : (
            <p className="explorer-inspector-note">
              ใช้ค่าโดยตรงจากแหล่งข้อมูล (Direct 100% · ไม่มีการคูณแปลงหน่วยหรือปันส่วนเพิ่มเติม)
            </p>
          )}
        </section>

        {/* Source & Document Provenance Section */}
        <section className="explorer-inspector-section">
          <h5>แหล่งข้อมูลและเอกสารอ้างอิง (Source Provenance)</h5>
          <div className="explorer-inspector-kv-list">
            <div className="explorer-inspector-kv">
              <span>รหัสและชื่อแหล่งข้อมูล</span>
              <strong>
                {display(row._source_id)} {source?.title ? `· ${source.title}` : ''}
              </strong>
            </div>
            {source?.publisher && (
              <div className="explorer-inspector-kv">
                <span>หน่วยงานผู้เผยแพร่</span>
                <strong>{source.publisher}</strong>
              </div>
            )}
            {row._document_title && (
              <div className="explorer-inspector-kv">
                <span>ชื่อเอกสารรายงาน</span>
                <strong>
                  {row._document_title} {row._document_year ? `(${row._document_year})` : ''}
                </strong>
              </div>
            )}
            {row._source_page && (
              <div className="explorer-inspector-kv">
                <span>หน้าเอกสารที่อ้างอิง</span>
                <strong>หน้า {row._source_page}</strong>
              </div>
            )}
            {row._extraction_basis && (
              <div className="explorer-inspector-kv">
                <span>วิธีการดึงข้อมูล</span>
                <strong>{row._extraction_basis}</strong>
              </div>
            )}
            {row._report_scope && (
              <div className="explorer-inspector-kv">
                <span>ขอบเขตการรายงาน</span>
                <strong>{row._report_scope}</strong>
              </div>
            )}
          </div>

          <div className="explorer-inspector-links">
            {isHttpUrl(row._source_url) && (
              <a
                href={row._source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="explorer-source-link"
              >
                <ExternalLink size={13} />
                <span>เปิดไฟล์/URL ต้นทาง</span>
              </a>
            )}
            {onOpenRegistry && row._source_id && (
              <button
                type="button"
                onClick={() => onOpenRegistry(row._source_id)}
                className="explorer-source-link"
              >
                <ShieldCheck size={13} />
                <span>เปิดดู {row._source_id} ในทะเบียน</span>
              </button>
            )}
          </div>
        </section>

        {/* File & Cryptographic Hash Lineage */}
        <section className="explorer-inspector-section">
          <h5>การตรวจสอบระดับไฟล์และ Hash (Pipeline Lineage)</h5>
          <div className="explorer-inspector-kv-list">
            <div className="explorer-inspector-kv">
              <span>ไฟล์ดิบ (Raw File)</span>
              <code>{display(row._raw_file)}</code>
            </div>
            {row._source_sha256 && (
              <div className="explorer-inspector-kv">
                <span>SHA-256 ต้นทาง</span>
                <div className="explorer-hash-row">
                  <code>{row._source_sha256}</code>
                  <button
                    type="button"
                    onClick={() => onCopy(row._source_sha256, 'src-sha')}
                    className="explorer-copy-inline"
                  >
                    {copiedToken === 'src-sha' ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                </div>
              </div>
            )}
            <div className="explorer-inspector-kv">
              <span>ไฟล์ผ่าน Validation</span>
              <code>{display(row._validated_file)}</code>
            </div>
            {row._validated_file_sha256 && (
              <div className="explorer-inspector-kv">
                <span>SHA-256 ไฟล์ Validation</span>
                <div className="explorer-hash-row">
                  <code>{row._validated_file_sha256}</code>
                  <button
                    type="button"
                    onClick={() => onCopy(row._validated_file_sha256, 'val-sha')}
                    className="explorer-copy-inline"
                  >
                    {copiedToken === 'val-sha' ? <Check size={11} /> : <Copy size={11} />}
                  </button>
                </div>
              </div>
            )}
            <div className="explorer-inspector-kv">
              <span>รหัสรอบดึงข้อมูล (Batch ID)</span>
              <code>{display(row._extraction_batch_id)}</code>
            </div>
            <div className="explorer-inspector-kv">
              <span>เวลาประมวลผล (Mapped At)</span>
              <span>{prettyDate(row._mapped_at || row._staged_at)}</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => onCopy(JSON.stringify(row, null, 2), 'row-json')}
            className="explorer-copy-json-btn"
          >
            {copiedToken === 'row-json' ? <Check size={13} /> : <Copy size={13} />}
            <span>{copiedToken === 'row-json' ? 'คัดลอก JSON เรียบร้อยแล้ว' : 'คัดลอกข้อมูลระเบียนทั้งหมด (JSON)'}</span>
          </button>
        </section>
      </div>
    </aside>
  );
};
