import React, { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Database, Download, Search, Table2 } from 'lucide-react';
import { downloadCsv } from '../../utils/format';
import { runBrowserSql } from '../../utils/browserSqlite';
import '../../styles/data-explorer.css';
import '../../styles/page-header-shared.css';

type DatasetKey = 'all' | 'upstream' | 'refinery' | 'facility';
type DataRow = Record<string, string | number | null | undefined>;
interface Column { key: string; label: string; }
interface DatasetConfig { label: string; description: string; sources: string[]; columns: Column[]; }
const EXCHANGE_COLUMNS: Column[] = [
  { key: 'exchangeId', label: 'Exchange ID' }, { key: 'sourceId', label: 'Source ID' }, { key: 'sourceTitle', label: 'Source' }, { key: 'publisher', label: 'Publisher' },
  { key: 'process', label: 'Process' }, { key: 'year', label: 'Year' }, { key: 'location', label: 'Location' }, { key: 'flow', label: 'Flow' },
  { key: 'flowType', label: 'Flow type' }, { key: 'compartment', label: 'Compartment' }, { key: 'direction', label: 'Direction' }, { key: 'amount', label: 'Amount' },
  { key: 'unit', label: 'Unit' }, { key: 'allocation', label: 'Allocation' }, { key: 'reference', label: 'Reference' }, { key: 'linkedSourceRows', label: 'Linked source rows' },
];
const DATASETS: Record<DatasetKey, DatasetConfig> = {
  all: { label: 'All mapped LCI exchanges', description: 'Mapped exchanges joined with process, flow, unit, location and source details', sources: [], columns: EXCHANGE_COLUMNS },
  upstream: { label: 'Upstream production and burdens', description: 'Mapped crude oil, natural gas, condensate and upstream burden exchanges', sources: ['SRC-044', 'SRC-045', 'SRC-046', 'SRC-047'], columns: EXCHANGE_COLUMNS },
  refinery: { label: 'Refinery inputs and outputs', description: 'Mapped petroleum product, crude intake and gas intake exchanges', sources: ['SRC-048', 'SRC-049', 'SRC-050'], columns: EXCHANGE_COLUMNS },
  facility: { label: 'Facility process data', description: 'Mapped facility-level LCI exchanges and linked source evidence', sources: ['SRC-051', 'SRC-052', 'SRC-053', 'SRC-054', 'SRC-055', 'SRC-056', 'SRC-057', 'SRC-058', 'SRC-059', 'SRC-060', 'SRC-061'], columns: EXCHANGE_COLUMNS },
};

function formatDisplayValue(key: string, value: unknown): string {
  if (typeof value === 'number') {
    return key === 'year' ? String(value) : value.toLocaleString('en-US', { maximumFractionDigits: 4 });
  }
  return String(value);
}

async function loadDataset(config: DatasetConfig): Promise<DataRow[]> {
  const sourceFilter = config.sources.length
    ? `WHERE printf('SRC-%03d', s.source_id) IN (${config.sources.map((sourceId) => `'${sourceId}'`).join(', ')})`
    : '';
  const result = await runBrowserSql(`SELECT e.exchange_id AS exchangeId, printf('SRC-%03d', s.source_id) AS sourceId, s.title AS sourceTitle, s.publisher AS publisher, p.process_name AS process, p.process_year AS year, loc.name AS location, f.flow_name AS flow, f.flow_type AS flowType, f.compartment AS compartment, e.direction AS direction, e.amount AS amount, u.symbol AS unit, e.allocation AS allocation, ref.reference_name AS reference, (SELECT COUNT(*) FROM EXCHANGE_SOURCE_ROW linked WHERE linked.exchange_id=e.exchange_id) AS linkedSourceRows FROM LCI_EXCHANGE e JOIN PROCESS p USING(process_id) JOIN LOCATION loc ON loc.location_id=p.location_id JOIN FLOW f USING(flow_id) JOIN UNIT u USING(unit_id) JOIN REFERENCE ref USING(reference_id) JOIN SOURCE s ON s.source_id=ref.source_id ${sourceFilter} ORDER BY p.process_year DESC, s.source_id, e.exchange_id`, 5000);
  return result.rows.map((row) => Object.fromEntries(result.columns.map((column, index) => [column, row[index]])) as DataRow);
}

export const DataExplorerView: React.FC = () => {
  const [dataset, setDataset] = useState<DatasetKey>('all');
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
  const exportCsv = () => downloadCsv(`cn230-${dataset}-mapped-lci-${new Date().toISOString().slice(0, 10)}.csv`, config.columns.map(({ label }) => label), filtered.map((row) => config.columns.map(({ key }) => row[key])));

  return <div className="data-explorer-view"><div className="de-content">
    <header className="de-header workspace-page-header"><div className="workspace-page-heading"><span className="de-eyebrow workspace-page-eyebrow"><Table2 size={13} /> CN230 · DATA WORKSPACE</span><h1>Data Explorer</h1><p>สำรวจและส่งออก LCI exchanges หลัง Mapping จากฐานข้อมูลโครงการ</p></div><button className="de-export" type="button" onClick={exportCsv} disabled={!filtered.length || loading}><Download size={16} /> Download CSV <span>{filtered.length.toLocaleString()}</span></button></header>
    <section className="de-overview" aria-label="Selected dataset summary"><div className="de-dataset-icon"><Table2 size={19} /></div><div className="de-dataset-copy"><span>FINAL DATABASE · JOINED LCI EXCHANGES</span><strong>{config.label}</strong><small>{config.description}</small></div><div className="de-stat"><span>Records</span><strong>{loading ? '…' : rows.length.toLocaleString()}</strong></div><div className="de-stat"><span>Fields</span><strong>{config.columns.length}</strong></div></section>
    <section className="de-browser" aria-label="Browse dataset records"><div className="de-toolbar"><label className="de-select-wrap"><span>Dataset</span><select value={dataset} onChange={(event) => changeDataset(event.target.value as DatasetKey)}><option value="all">All mapped LCI exchanges</option><option value="upstream">Upstream production and burdens</option><option value="refinery">Refinery inputs and outputs</option><option value="facility">Facility process data</option></select></label><label className="de-search"><Search size={16} /><input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder="Search process, flow, source, year…" aria-label="Search records" /><kbd>/</kbd></label><span className="de-result-count" aria-live="polite">{loading ? 'Loading database records…' : `${filtered.length.toLocaleString()} records`}</span></div>
      <div className="de-table-scroll"><table className="de-table"><thead><tr>{config.columns.map(({ key, label }) => <th key={key} scope="col"><button type="button" onClick={() => toggleSort(key)}>{label}{sort.key === key && (sort.direction === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}</button></th>)}</tr></thead><tbody>{visibleRows.map((row, index) => <tr key={`${String(row.exchangeId)}-${index}`}>{config.columns.map(({ key }) => <td key={key} title={String(row[key] ?? '')}>{row[key] === null || row[key] === undefined || row[key] === '' ? <span className="de-null">—</span> : formatDisplayValue(key, row[key])}</td>)}</tr>)}</tbody></table>
        {!loading && !error && !filtered.length && <div className="de-empty"><Search size={21} /><strong>No matching records</strong><span>Try another search or choose a different dataset.</span></div>}
        {loading && <div className="de-empty" role="status"><Database size={21} /><strong>Loading mapped LCI exchanges</strong><span>Joining exchanges with process, flow, unit, location, reference and source tables.</span></div>}
        {error && <div className="de-empty" role="alert"><strong>Could not load dataset</strong><span>{error}</span></div>}
      </div>
      <footer className="de-pagination"><span>Showing {filtered.length ? (page * pageSize + 1).toLocaleString() : '0'}–{Math.min((page + 1) * pageSize, filtered.length).toLocaleString()} of {filtered.length.toLocaleString()}</span><div><button type="button" aria-label="Previous page" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft size={16} /></button><span>Page {page + 1} of {pageCount}</span><button type="button" aria-label="Next page" disabled={page >= pageCount - 1} onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))}><ChevronRight size={16} /></button></div></footer></section>
    <p className="de-footnote">แสดง LCI_EXCHANGE หลัง Mapping โดย join กับ PROCESS, FLOW, UNIT, LOCATION, REFERENCE และ SOURCE · Linked source rows แสดงจำนวนแถวหลักฐานที่ผูกกับ exchange · CSV ส่งออก {filtered.length.toLocaleString()} รายการที่ตรงกับคำค้นหา</p>
  </div></div>;
};
