import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Database, Download, Search, Table2 } from 'lucide-react';
import { downloadCsv } from '../../utils/format';
import '../../styles/data-explorer.css';

type DatasetKey = 'upstream' | 'products' | 'refinery' | 'gas';
type DataRow = Record<string, string | number | null | undefined>;
interface Column { key: string; label: string; }
interface DatasetConfig { label: string; description: string; sources: string[]; columns: Column[]; }
const DATASETS: Record<DatasetKey, DatasetConfig> = {
  upstream: { label: 'Upstream field production', description: 'Monthly crude oil, natural gas and condensate production by field', sources: ['SRC-044', 'SRC-045', 'SRC-046'], columns: [
    { key: 'recordId', label: 'Record ID' }, { key: 'year', label: 'Year' }, { key: 'month', label: 'Month' }, { key: 'field', label: 'Field / block' }, { key: 'blockType', label: 'Block type' }, { key: 'sourceGroup', label: 'Source group' }, { key: 'product', label: 'Product' }, { key: 'productionRate', label: 'Production rate' }, { key: 'unit', label: 'Unit' }, { key: 'producingDays', label: 'Producing days' }, { key: 'sourceId', label: 'Source' },
  ] },
  products: { label: 'Petroleum product output', description: 'Monthly refinery production by petroleum product', sources: ['SRC-048'], columns: [
    { key: 'recordId', label: 'Record ID' }, { key: 'year', label: 'Year' }, { key: 'month', label: 'Month' }, { key: 'product', label: 'Product' }, { key: 'quantity', label: 'Quantity' }, { key: 'unit', label: 'Unit' }, { key: 'sourceId', label: 'Source' },
  ] },
  refinery: { label: 'Refinery crude intake', description: 'Monthly crude oil intake by refinery company', sources: ['SRC-049'], columns: [
    { key: 'recordId', label: 'Record ID' }, { key: 'year', label: 'Year' }, { key: 'month', label: 'Month' }, { key: 'company', label: 'Refinery' }, { key: 'quantity', label: 'Quantity' }, { key: 'unit', label: 'Unit' }, { key: 'sourceId', label: 'Source' },
  ] },
  gas: { label: 'Natural gas to GSP', description: 'Monthly natural gas intake by gas separation plant', sources: ['SRC-050'], columns: [
    { key: 'recordId', label: 'Record ID' }, { key: 'year', label: 'Year' }, { key: 'month', label: 'Month' }, { key: 'sector', label: 'Sector' }, { key: 'quantity', label: 'Quantity' }, { key: 'unit', label: 'Unit' }, { key: 'sourceId', label: 'Source' },
  ] },
};

const FILES: Record<string, string> = {
  'SRC-044': 'SRC-044_DMF_Petroleum-Production_TH_200301-202603_STAGED.csv',
  'SRC-045': 'SRC-045_DMF_Petroleum-Production_TH_200301-202603_STAGED.csv',
  'SRC-046': 'SRC-046_DMF_Petroleum-Production_TH_200301-202603_STAGED.csv',
  'SRC-048': 'SRC-048_EPPO_Petroleum-Production_TH_202408_STAGED.csv',
  'SRC-049': 'SRC-049_EPPO_Petroleum-Consumption_TH_202408_STAGED.csv',
  'SRC-050': 'SRC-050_EPPO_Petroleum-Consumption_TH_202408_STAGED.csv',
};

function parseCsv(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let value = ''; let quoted = false;
  const input = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { value += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(value); value = ''; }
    else if (char === '\n') { row.push(value.replace(/\r$/, '')); rows.push(row); row = []; value = ''; }
    else value += char;
  }
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row); }
  return rows;
}

function normalize(sourceId: string, raw: Record<string, string>): DataRow | null {
  const year = Number(raw.year);
  if (!Number.isInteger(year) || year < 2022 || year > 2025) return null;
  if (['SRC-044', 'SRC-045', 'SRC-046'].includes(sourceId)) {
    const measurement = sourceId === 'SRC-044' ? 'oil_bbl_day' : sourceId === 'SRC-045' ? 'gas_mmscf_day' : 'condensate_bbl_day';
    const product = sourceId === 'SRC-044' ? 'Crude oil' : sourceId === 'SRC-045' ? 'Natural gas' : 'Condensate';
    return { recordId: `${sourceId}-${raw.record_id}`, year, month: raw.month, field: raw.block_name, blockType: raw.block_type, sourceGroup: raw.source_group, product, productionRate: raw[measurement], unit: sourceId === 'SRC-045' ? 'MMSCF/day' : 'bbl/day', producingDays: raw.days_of_produce, sourceId };
  }
  const category = sourceId === 'SRC-048' ? 'product' : sourceId === 'SRC-049' ? 'company' : 'sector';
  return { recordId: `${sourceId}-${raw.record_id}`, year, month: raw.month, [category]: raw[category], quantity: raw.quantity, unit: raw.unit, sourceId };
}

async function loadDataset(config: DatasetConfig): Promise<DataRow[]> {
  const baseUrl = import.meta.env.BASE_URL;
  const batches = await Promise.all(config.sources.map(async (sourceId) => {
    const response = await fetch(`${baseUrl}staging/${FILES[sourceId]}`, { headers: { Accept: 'text/csv' } });
    if (!response.ok) throw new Error(`Could not load ${sourceId} staged records (${response.status}).`);
    const [header = [], ...values] = parseCsv(await response.text());
    const rows: DataRow[] = [];
    for (const cells of values) {
      const raw = Object.fromEntries(header.map((key, index) => [key, cells[index] ?? '']));
      const normalized = normalize(sourceId, raw);
      if (normalized) rows.push(normalized);
    }
    return rows;
  }));
  return batches.flat();
}

export const DataExplorerView: React.FC = () => {
  const [dataset, setDataset] = useState<DatasetKey>('upstream');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sort, setSort] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'year', direction: 'desc' });
  const pageSize = 50;
  const config = DATASETS[dataset];

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(''); setRows([]);
    loadDataset(config).then((data) => { if (!cancelled) setRows(data); })
      .catch((loadError: unknown) => { if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Could not load dataset.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [dataset]);

  const filtered = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    const searched = rows.filter((row) => !term || config.columns.some(({ key }) => String(row[key] ?? '').toLocaleLowerCase().includes(term)));
    return [...searched].sort((a, b) => {
      const left = a[sort.key]; const right = b[sort.key];
      const cmp = typeof left === 'number' && typeof right === 'number' ? left - right : String(left ?? '').localeCompare(String(right ?? ''), undefined, { numeric: true, sensitivity: 'base' });
      return sort.direction === 'asc' ? cmp : -cmp;
    });
  }, [rows, query, config.columns, sort]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const visibleRows = filtered.slice(page * pageSize, (page + 1) * pageSize);
  const changeDataset = (value: DatasetKey) => { setDataset(value); setPage(0); setQuery(''); setSort({ key: 'year', direction: 'desc' }); };
  const toggleSort = (key: string) => { setSort((current) => ({ key, direction: current.key === key && current.direction === 'asc' ? 'desc' : 'asc' })); setPage(0); };
  const exportCsv = () => downloadCsv(`cn230-${dataset}-2022-2025-${new Date().toISOString().slice(0, 10)}.csv`, config.columns.map(({ label }) => label), filtered.map((row) => config.columns.map(({ key }) => row[key])));

  return <div className="data-explorer-view"><div className="de-content">
    <header className="de-header"><div><span className="de-eyebrow"><Database size={13} /> CN230 · DATA WORKSPACE</span><h1>Data explorer</h1><p>Browse the project’s 2022–2025 records, search across fields, and export your results.</p></div><button className="de-export" type="button" onClick={exportCsv} disabled={!filtered.length || loading}><Download size={16} /> Download CSV <span>{filtered.length.toLocaleString()}</span></button></header>
    <section className="de-overview" aria-label="Selected dataset summary"><div className="de-dataset-icon"><Table2 size={19} /></div><div className="de-dataset-copy"><span>SELECTED DATASET · 2022—2025</span><strong>{config.label}</strong><small>{config.description}</small></div><div className="de-stat"><span>Records</span><strong>{loading ? '…' : rows.length.toLocaleString()}</strong></div><div className="de-stat"><span>Fields</span><strong>{config.columns.length}</strong></div></section>
    <section className="de-browser" aria-label="Browse dataset records"><div className="de-toolbar"><label className="de-select-wrap"><span>Dataset</span><select value={dataset} onChange={(event) => changeDataset(event.target.value as DatasetKey)}><option value="upstream">Upstream field production</option><option value="products">Petroleum product output</option><option value="refinery">Refinery crude intake</option><option value="gas">Natural gas to GSP</option></select></label><label className="de-search"><Search size={16} /><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search records…" aria-label="Search records" /><kbd>/</kbd></label><span className="de-result-count" aria-live="polite">{loading ? 'Loading staged data…' : `${filtered.length.toLocaleString()} records`}</span></div>
      <div className="de-table-scroll"><table className="de-table"><thead><tr>{config.columns.map(({ key, label }) => <th key={key} scope="col"><button type="button" onClick={() => toggleSort(key)}>{label}{sort.key === key && (sort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button></th>)}</tr></thead><tbody>{visibleRows.map((row, index) => <tr key={`${String(row.recordId)}-${index}`}>{config.columns.map(({ key }) => <td key={key} title={String(row[key] ?? '')}>{row[key] === null || row[key] === undefined || row[key] === '' ? <span className="de-null">—</span> : typeof row[key] === 'number' ? row[key].toLocaleString('en-US', { maximumFractionDigits: 4 }) : row[key]}</td>)}</tr>)}</tbody></table>
        {!loading && !error && !filtered.length && <div className="de-empty"><Search size={21} /><strong>No matching records</strong><span>Try another search or choose a different dataset.</span></div>}
        {loading && <div className="de-empty" role="status"><Database size={21} /><strong>Loading the full dataset</strong><span>Reading staged records for 2022–2025.</span></div>}
        {error && <div className="de-empty" role="alert"><strong>Could not load dataset</strong><span>{error}</span></div>}
      </div>
      <footer className="de-pagination"><span>Showing {filtered.length ? (page * pageSize + 1).toLocaleString() : '0'}–{Math.min((page + 1) * pageSize, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}</span><div><button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft size={16} /></button><span>Page {page + 1} of {pageCount}</span><button type="button" aria-label="Next page" disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}><ChevronRight size={16} /></button></div></footer></section>
    <p className="de-footnote">Showing records from 2022 through 2025. CSV export includes all {filtered.length.toLocaleString()} records matching the current search.</p>
  </div></div>;
};
