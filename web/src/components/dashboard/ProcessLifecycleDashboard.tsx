import React, { useMemo, useState } from 'react';
import { useWebsiteData } from '../../data/websiteData';
import '../../styles/process-lifecycle-dashboard.css';

type FunctionalUnitId = 'FU-1' | 'FU-2' | 'FU-3';
type EolScenario = 'incineration' | 'landfill';

interface ProcessRecord {
  id: string;
  nameTh: string;
  nameEn: string;
  facilities: string;
  status: string;
  stageName: string;
  stageIndex: number;
  inventoryValue: string;
  formulaOrMethod: string;
  sourceId: string;
  dqr: string;
}

interface ExchangeRecord {
  exchange_id: string;
  fu_id: FunctionalUnitId;
  process_id: string;
  process_name: string;
  flow_name: string;
  direction: string;
  compartment: string;
  amount: string;
  unit: string;
  source_id: string;
  derivation: string;
  pedigree_dqr: string;
  status: string;
}

interface RouteRecord {
  route_id: string;
  transport_mode: string;
  functional_unit: string;
  distance_km: string;
  tonnes_per_fu: string;
  tkm_per_fu: string;
  energy_mj_per_fu: string;
  ghg_kgco2e_per_fu: string;
  nox_g_per_fu: string;
  sox_g_per_fu: string;
  pm25_g_per_fu: string;
  voc_g_per_fu: string;
}

type FunctionalUnitConfig = {
  title: string;
  label: string;
  unit: string;
  linkedProcesses: string[];
  note: string;
};

type LifecycleLane = { id: number; title: string; range: string };

const dqrDimensions = ['Reliability', 'Completeness', 'Time', 'Geography', 'Technology'];
function formatAmount(value: string | number): string {
  const amount = Number(value || 0);
  if (amount !== 0 && Math.abs(amount) < 0.0001) return amount.toExponential(2);
  return amount.toLocaleString('en-US', { maximumFractionDigits: 4 });
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    VERIFIED: 'Verified', VERIFIED_DERIVED: 'Verified · derived', PROXY: 'Proxy',
    DATA_GAP: 'Data gap', ASSUMPTION: 'Assumption', RESIDUAL: 'Residual',
    CALCULATED: 'Calculated', OUT: 'Out of scope'
  };
  return labels[status] || status || 'Unrated';
}

function statusClass(status: string): string {
  return status.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function processRowIncludes(rowProcessId: string, processId: string): boolean {
  if (rowProcessId === processId) return true;
  const range = rowProcessId.match(/^P(\d{2})-P?(\d{2})$/);
  if (range) {
    const target = Number(processId.match(/^P(\d{2})/)?.[1]);
    return target >= Number(range[1]) && target <= Number(range[2]);
  }
  return rowProcessId.match(/^(P\d{2})/)?.[1] === processId;
}

const isImpactRow = (row: ExchangeRecord) => /ghg|co2/i.test(row.flow_name);

function impactComponents(rows: ExchangeRecord[], fuId: FunctionalUnitId, eolScenario: EolScenario) {
  const definitions = fuId === 'FU-1'
    ? [
        { code: 'P02', label: 'Upstream extraction', fallback: 'VERIFIED_DERIVED' },
        { code: 'P06', label: 'Petroleum refining', fallback: 'VERIFIED_DERIVED' },
        { code: 'P11', label: 'Depot & road distribution', fallback: 'ASSUMPTION' },
        { code: 'P13', label: 'Road combustion', fallback: 'VERIFIED' }
      ]
    : fuId === 'FU-2'
      ? [
          { code: 'P02', label: 'Domestic gas extraction', fallback: 'VERIFIED_DERIVED' },
          { code: 'P07-P09', label: 'GSP, LNG & transmission', fallback: 'RESIDUAL' },
          { code: 'P15', label: 'Power-generation combustion', fallback: 'VERIFIED' }
        ]
      : [
          { code: 'P07', label: 'GSP feedstock · proxy', fallback: 'PROXY' },
          { code: 'P18', label: 'Petrochemical conversion', fallback: 'VERIFIED' },
          { code: eolScenario === 'incineration' ? 'P19a' : 'P19b', label: `End of life · ${eolScenario}`, fallback: eolScenario === 'incineration' ? 'CALCULATED' : 'PROXY' }
        ];

  return definitions.map((definition) => {
    const matches = rows.filter((row) => {
      if (definition.code === 'P19a' || definition.code === 'P19b') return row.process_id === definition.code && isImpactRow(row);
      return processRowIncludes(row.process_id, definition.code) && isImpactRow(row);
    });
    return {
      ...definition,
      amount: matches.reduce((total, row) => total + Number(row.amount || 0), 0),
      status: matches[0]?.status || definition.fallback
    };
  }).filter((item) => item.amount > 0);
}

function SimpleTable<T extends object>({ columns, rows, rowKey }: {
  columns: { key: keyof T & string; label: string }[];
  rows: T[];
  rowKey: keyof T & string;
}) {
  if (!rows.length) return <div className="richer-empty">No records to show.</div>;
  return (
    <div className="richer-table-scroll">
      <table className="richer-table">
        <thead><tr>{columns.map((column) => <th key={column.key}>{column.label}</th>)}</tr></thead>
        <tbody>{rows.map((row, index) => (
          <tr key={String(row[rowKey] ?? index)}>
            {columns.map((column) => {
              const value = row[column.key];
              return <td key={column.key} title={String(value ?? '')}>{String(value ?? '—')}</td>;
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

interface ProcessLifecycleDashboardProps {
  onScrollToTop: () => void;
  onOpenDataExplorer: () => void;
}

export const ProcessLifecycleDashboard: React.FC<ProcessLifecycleDashboardProps> = ({ onScrollToTop, onOpenDataExplorer }) => {
  const { catalog } = useWebsiteData();
  const { processes, ledger, routes, functionalUnits, lifecycleLanes } = catalog!.data.processDashboard as {
    processes: ProcessRecord[];
    ledger: ExchangeRecord[];
    routes: RouteRecord[];
    functionalUnits: Record<FunctionalUnitId, FunctionalUnitConfig>;
    lifecycleLanes: LifecycleLane[];
  };
  const [selectedFuId, setSelectedFuId] = useState<FunctionalUnitId>('FU-1');
  const [selectedProcessId, setSelectedProcessId] = useState('P02');
  const [eolScenario, setEolScenario] = useState<EolScenario>('incineration');
  const [routeMode, setRouteMode] = useState('all');

  const info = functionalUnits[selectedFuId];
  const fuRows = useMemo(() => ledger.filter((row) => row.fu_id === selectedFuId), [selectedFuId]);
  const components = useMemo(() => impactComponents(fuRows, selectedFuId, eolScenario), [fuRows, selectedFuId, eolScenario]);
  const totalImpact = components.reduce((sum, item) => sum + item.amount, 0);
  const selectedProcess = processes.find((process) => process.id === selectedProcessId) || processes[1];
  const activeProcessRows = fuRows.filter((row) => processRowIncludes(row.process_id, selectedProcess.id));
  const directPathRows = fuRows.filter((row) => info.linkedProcesses.some((code) => processRowIncludes(row.process_id, code)));
  const linkedCodes = new Set(info.linkedProcesses);
  const gapProcesses = info.linkedProcesses.map((id) => processes.find((process) => process.id === id))
    .filter((process): process is ProcessRecord => process?.status === 'DATA_GAP');
  const nonGhgRows = fuRows.filter((row) => !isImpactRow(row));
  const otherFlows = Object.values(nonGhgRows.reduce<Record<string, {
    flow_name: string; unit: string; direction: string; compartment: string; amount: number; records: number;
  }>>((groups, row) => {
    const direction = row.direction.toUpperCase();
    const key = [row.flow_name, row.unit, direction, row.compartment].join('|');
    const group = groups[key] || (groups[key] = { flow_name: row.flow_name, unit: row.unit, direction, compartment: row.compartment, amount: 0, records: 0 });
    group.amount += Number(row.amount || 0);
    group.records += 1;
    return groups;
  }, {})).sort((a, b) => a.compartment.localeCompare(b.compartment) || a.flow_name.localeCompare(b.flow_name));
  const compartments = nonGhgRows.reduce<Record<string, number>>((counts, row) => {
    counts[row.compartment] = (counts[row.compartment] || 0) + 1;
    return counts;
  }, {});
  const routeCounts = routes.reduce<Record<string, number>>((counts, route) => {
    counts[route.transport_mode] = (counts[route.transport_mode] || 0) + 1;
    return counts;
  }, {});
  const filteredRoutes = routeMode === 'all' ? routes : routes.filter((route) => route.transport_mode === routeMode);
  const processStatusCounts = processes.reduce<Record<string, number>>((counts, process) => {
    counts[process.status] = (counts[process.status] || 0) + 1;
    return counts;
  }, {});
  const qualitySummary = [
    { label: 'VERIFIED', count: processStatusCounts.VERIFIED || 0, color: 'green' },
    { label: 'DATA GAP', count: processStatusCounts.DATA_GAP || 0, color: 'red' },
    { label: 'PROXY / ASSUMPTION', count: (processStatusCounts.PROXY || 0) + (processStatusCounts.ASSUMPTION || 0), color: 'amber' },
    { label: 'OUT OF SCOPE', count: processStatusCounts.OUT || 0, color: 'grey' },
    { label: 'RESIDUAL / CALCULATED', count: (processStatusCounts.RESIDUAL || 0) + (processStatusCounts.CALCULATED || 0), color: 'blue' }
  ];
  const totalLabel = formatAmount(totalImpact);
  const handleFunctionalUnitChange = (fuId: FunctionalUnitId) => {
    setSelectedFuId(fuId);
    setSelectedProcessId(functionalUnits[fuId].linkedProcesses[0] || 'P02');
  };

  return (
    <div className="richer-dashboard" id="lci-visual-dashboard">
      <header className="richer-heading">
        <div>
          <span className="richer-eyebrow">Petroleum life cycle inventory · visual dashboard</span>
          <h1>See the whole process. <em>Then follow the impact.</em></h1>
          <p>Switch the functional unit to see which petroleum processes, exchanges, emissions and data gaps belong to that model path.</p>
        </div>
        <button className="richer-button" type="button" onClick={onScrollToTop}>← Open network map</button>
      </header>

      <aside className="richer-provenance-note" role="note">
        <div><strong>Curated LCI model snapshot · separate from the prepared pipeline replay</strong><p>This dashboard's totals and route factors are calculated from the curated catalog in web/data/web_catalog.json. Each process shows its status, source, and method where supplied. These totals do not refresh automatically; open the explorer for the packaged accepted rows and their hashes, batches, conversions, and allocation details.</p></div>
        <button className="richer-button" type="button" onClick={onOpenDataExplorer}>Open processed data</button>
      </aside>

      <div className="richer-fu-toolbar">
        <div className="richer-fu-selector" role="tablist" aria-label="Functional unit">
          {(Object.keys(functionalUnits) as FunctionalUnitId[]).map((fuId) => (
            <button key={fuId} className={`richer-fu-tab ${selectedFuId === fuId ? 'is-active' : ''}`} type="button" role="tab" aria-selected={selectedFuId === fuId} onClick={() => handleFunctionalUnitChange(fuId)}>
              <span>{fuId}</span><strong>{functionalUnits[fuId].title}</strong>
            </button>
          ))}
        </div>
        <span className="richer-fu-description">{info.label}</span>
      </div>

      <div className="richer-kpis">
        <article className="richer-kpi main-kpi"><span>MODELLED CLIMATE IMPACT</span><strong>{totalLabel}</strong><small>{info.unit} · sum of the plotted GHG ledger components</small></article>
        <article className="richer-kpi"><span>EXCHANGE RECORDS</span><strong>{fuRows.length}</strong><small>of {ledger.length} curated LCI rows</small></article>
        <article className="richer-kpi"><span>PROCESS STEPS IN VIEW</span><strong>20</strong><small>{directPathRows.length} ledger records link to this path</small></article>
        <article className="richer-kpi"><span>TRANSPORT ROUTE RECORDS</span><strong>{routes.length}</strong><small>6 transport modes</small></article>
      </div>

      <section className="richer-card richer-lifecycle-card">
        <div className="richer-section-heading richer-map-heading">
          <div><span className="richer-card-kicker">System map · P01–P20</span><h2>Petroleum life cycle, from extraction to end of life</h2><p>Green nodes are on the selected functional-unit path. Select a process to inspect its model, evidence status and matching exchange rows.</p></div>
          <div className="richer-legend"><span><i className="legend-green" />On selected path</span><span><i className="legend-amber" />Proxy / assumption</span><span><i className="legend-red" />Data gap</span></div>
        </div>
        <div className="richer-map-scroll"><div className="richer-process-map">
          {lifecycleLanes.map((lane, index) => (
            <div className="richer-lane" key={lane.id}>
              <div className="richer-lane-head"><span>{lane.title}</span><small>{lane.range}</small></div>
              <div className="richer-lane-nodes">{processes.filter((process) => process.stageIndex === lane.id).map((process) => {
                const directRows = fuRows.filter((row) => row.process_id === process.id);
                const groupedRows = fuRows.filter((row) => row.process_id !== process.id && processRowIncludes(row.process_id, process.id));
                const caption = directRows.length ? `${directRows.length} exchange rows in ${selectedFuId}` : groupedRows.length ? 'Included in a grouped exchange row' : linkedCodes.has(process.id) ? 'Relevant step · no row in this ledger' : 'No row in this functional-unit ledger';
                const onPath = linkedCodes.has(process.id);
                return (
                  <button key={process.id} className={`richer-process-node status-${statusClass(process.status)} ${onPath ? 'on-path' : 'off-path'} ${selectedProcessId === process.id ? 'node-selected' : ''}`} type="button" aria-pressed={selectedProcessId === process.id} onClick={() => setSelectedProcessId(process.id)}>
                    <span className="richer-node-top"><b>{process.id}</b><i>{statusLabel(process.status)}</i></span><strong>{process.nameEn}</strong><small>{caption}</small>
                  </button>
                );
              })}</div>
              {index < lifecycleLanes.length - 1 && <span className="richer-lane-arrow" aria-hidden="true">→</span>}
            </div>
          ))}
        </div></div>
        <p className="richer-footnote">The map shows all 20 modeled processes. A step can be in scope even when the 43-row proof ledger has no direct exchange row for it.</p>
      </section>

      <div className="richer-impact-heading">
        <div><span className="richer-eyebrow">Impact breakdown · {selectedFuId}</span><h2>Where does the climate impact come from?</h2><p>Contribution bars use the GHG exchanges in the curated ledger. They share one functional-unit basis.</p></div>
        <a className="richer-button" href="/exports/lci-ledger.csv" download>↓ Download exchange ledger</a>
      </div>
      <div className="richer-impact-grid">
        <section className="richer-card richer-impact-card">
          <div className="richer-impact-top"><div><span className="richer-card-kicker">GHG contribution</span><h3>{info.title} · {info.unit}</h3></div><strong>{totalLabel}<small>{info.unit}</small></strong></div>
          {components.map((component) => <div className="richer-impact-row" key={component.code}>
            <div className="richer-impact-name"><b>{component.code}</b><span>{component.label}</span></div>
            <div className="richer-impact-track"><i style={{ width: `${totalImpact ? component.amount / totalImpact * 100 : 0}%` }} /></div>
            <span className="richer-impact-number">{formatAmount(component.amount)}</span>
            <span className="richer-impact-share">{totalImpact ? (component.amount / totalImpact * 100).toFixed(1) : '0.0'}%</span>
            <span className={`richer-status ${statusClass(component.status)}`}>{statusLabel(component.status)}</span>
          </div>)}
          <div className="richer-impact-scale"><span>0%</span><span>Share of modeled GHG total</span><span>100%</span></div>
          <div className="richer-impact-stack">{components.map((component) => <i key={component.code} className={`status-${statusClass(component.status)}`} title={`${component.label} · ${formatAmount(component.amount)} ${info.unit}`} style={{ width: `${totalImpact ? component.amount / totalImpact * 100 : 0}%` }} />)}</div>
          {selectedFuId === 'FU-1' && <div className="richer-scenario-note"><strong>Optional rail scenario · P04</strong><span>+{formatAmount(fuRows.filter((row) => processRowIncludes(row.process_id, 'P04') && isImpactRow(row)).reduce((sum, row) => sum + Number(row.amount || 0), 0))} kg CO₂e / L · PROXY · excluded from the 3.0062 baseline</span></div>}
          {selectedFuId === 'FU-3' && <div className="richer-scenario-switch"><span>End-of-life scenario</span>{(['incineration', 'landfill'] as EolScenario[]).map((scenario) => <button key={scenario} className={eolScenario === scenario ? 'is-on' : ''} type="button" aria-pressed={eolScenario === scenario} onClick={() => setEolScenario(scenario)}>{scenario === 'incineration' ? 'Incineration' : 'Landfill'}</button>)}</div>}
          <p className="richer-method-note">{info.note}</p>
        </section>

        <section className="richer-card richer-other-card">
          <span className="richer-card-kicker">Other inventory exchanges</span><h3>Inputs and outputs beyond CO₂e</h3>
          <p>{nonGhgRows.length} non-GHG records include resource use, water, waste and other emissions. Values are grouped by flow, unit and direction.</p>
          <div className="richer-mix-bar">{Object.entries(compartments).map(([compartment, count]) => <i key={compartment} className={`mix-${statusClass(compartment)}`} style={{ width: `${count / Math.max(1, fuRows.length) * 100}%` }} title={`${compartment} · ${count} exchanges`} />)}</div>
          <div className="richer-other-flows">{otherFlows.map((flow) => <div className="richer-other-flow" key={`${flow.flow_name}-${flow.unit}-${flow.direction}-${flow.compartment}`}>
            <span className={`richer-flow-direction ${statusClass(flow.compartment)}`}>{flow.direction === 'INPUT' || flow.direction === 'IN' ? 'IN' : 'OUT'}</span>
            <div><strong>{flow.flow_name}</strong><small>{flow.compartment} · {flow.records} row{flow.records === 1 ? '' : 's'}</small></div>
            <b>{formatAmount(flow.amount)} <small>{flow.unit}</small></b>
          </div>)}</div>
          <div className="richer-mix-legend"><span><i className="mix-air" />Air</span><span><i className="mix-technosphere" />Technosphere</span><span><i className="mix-water" />Water / resource</span><span><i className="mix-waste" />Waste</span></div>
        </section>
      </div>

      {gapProcesses.length ? <div className="richer-gap-callout"><span>!</span><div><strong>Visible data gaps in this pathway · {gapProcesses.map((process) => process.id).join(', ')}</strong><p>{gapProcesses.map((process) => `${process.id}: ${process.inventoryValue}`).join(' · ')}</p><small>Unavailable activity data is shown as a gap, not treated as zero environmental impact.</small></div></div> : <div className="richer-gap-callout is-clear"><span>✓</span><div><strong>No process tagged DATA_GAP on this selected path</strong><p>Proxy, residual and calculated records remain separately labeled below.</p></div></div>}

      <section className="richer-card richer-inspector">
        <div className="richer-inspector-main">
          <div className="richer-inspector-title"><div><span className="richer-card-kicker">{selectedProcess.id} · {selectedProcess.stageName}</span><h2>{selectedProcess.nameEn}</h2><p>{selectedProcess.nameTh}</p></div><span className={`richer-status ${statusClass(selectedProcess.status)}`}>{statusLabel(selectedProcess.status)}</span></div>
          <p className="richer-process-description">{selectedProcess.inventoryValue}</p>
          <div className="richer-process-facts"><div><small>FACILITIES / SYSTEM</small><span>{selectedProcess.facilities}</span></div><div><small>METHOD</small><span>{selectedProcess.formulaOrMethod}</span></div><div><small>SOURCE IDS</small><span>{selectedProcess.sourceId}</span></div></div>
        </div>
        <aside className="richer-process-dqr"><span className="richer-card-kicker">Data quality · DQR</span><strong>{selectedProcess.dqr}</strong><small>Five pedigree dimensions<br />1 = strongest · 5 = weakest</small>
          {dqrDimensions.map((dimension, index) => { const score = Number(selectedProcess.dqr.split('-')[index] || 0); return <div className="richer-dqr-mini" key={dimension}><span>{dimension}</span><i><b style={{ width: `${Math.max(0, 100 - (score - 1) * 25)}%` }} /></i><em>{score}</em></div>; })}
        </aside>
        <div className="richer-process-exchanges"><div className="richer-sample-head"><h3>{selectedFuId} · exchanges attached to {selectedProcess.id}</h3><span>{activeProcessRows.length ? `${activeProcessRows.length} ledger rows` : 'No direct ledger rows'}</span></div>
          {activeProcessRows.length ? <SimpleTable rowKey="exchange_id" columns={[
            { key: 'exchange_id', label: 'Exchange' }, { key: 'process_id', label: 'Process' }, { key: 'flow_name', label: 'Flow' },
            { key: 'direction', label: 'Direction' }, { key: 'amount', label: 'Amount' }, { key: 'unit', label: 'Unit' },
            { key: 'compartment', label: 'Compartment' }, { key: 'status', label: 'Status' }, { key: 'source_id', label: 'Source' }
          ]} rows={activeProcessRows.map((row) => ({ ...row, amount: formatAmount(row.amount) }))} />
            : <div className="richer-empty">This process appears in the 20-step system map, but the selected functional unit has no direct row in the 43-record proof ledger. Its model status and source references are shown above.</div>}
        </div>
      </section>

      <div className="richer-impact-heading richer-route-heading">
        <div><span className="richer-eyebrow">Transport network · {routes.length} routes</span><h2>See the logistics burden by mode.</h2><p>Route records use two separate reference bases: 1 barrel for oil and 1 MMSCF for gas. Compare routes within the same basis.</p></div>
        <a className="richer-button" href="/exports/routes.csv" download>↓ Download all routes</a>
      </div>
      <div className="richer-route-grid">
        <section className="richer-card richer-route-chart"><span className="richer-card-kicker">Routes per transport mode</span><h3>How the petroleum network moves</h3><p>Counts show the routes in the evidence ledger; emissions are listed per route and reference flow.</p>
          {Object.entries(routeCounts).sort((a, b) => b[1] - a[1]).map(([mode, count]) => <div className="richer-bar-row" key={mode}><span>{mode.replace(/-/g, ' ')}</span><i><b className={mode.includes('truck') || mode.includes('tanker') ? 'coral' : ''} style={{ width: `${count / Math.max(...Object.values(routeCounts)) * 100}%` }} /></i><strong>{count}</strong></div>)}
          <div className="richer-route-note">Never sum route impacts across the two different functional-unit bases.</div>
        </section>
        <section className="richer-card richer-route-table"><div className="richer-route-table-head"><div><span className="richer-card-kicker">Route / toxin ledger</span><h3>{filteredRoutes.length} routes</h3></div>
          <select className="richer-select" aria-label="Filter routes by transport mode" value={routeMode} onChange={(event) => setRouteMode(event.target.value)}><option value="all">All modes</option>{Object.keys(routeCounts).sort().map((mode) => <option value={mode} key={mode}>{mode.replace(/-/g, ' ')}</option>)}</select>
        </div>
          <SimpleTable rowKey="route_id" columns={[
            { key: 'route_id', label: 'Route' }, { key: 'transport_mode', label: 'Mode' }, { key: 'functional_unit', label: 'Reference unit' },
            { key: 'distance_km', label: 'Distance · km' }, { key: 'ghg_kgco2e_per_fu', label: 'GHG · kg CO₂e / FU' },
            { key: 'nox_g_per_fu', label: 'NOx · g / FU' }, { key: 'sox_g_per_fu', label: 'SOx · g / FU' }
          ]} rows={filteredRoutes.slice(0, 12)} />
          <div className="richer-route-note">Showing up to 12 route rows. Download the CSV for the full ledger.</div>
        </section>
      </div>

      <section className="richer-card richer-quality-card">
        <div className="richer-quality-head"><div><span className="richer-card-kicker">Coverage &amp; evidence status</span><h2>The model includes confidence and missing-data signals</h2><p>Statuses show whether a process is verified, derived, proxy-based, outside scope or missing.</p></div><span className="richer-process-count">{processes.length} PROCESS DEFINITIONS</span></div>
        <div className="richer-quality-summary">{qualitySummary.map((item) => <div className="richer-quality-chip" key={item.label}><i className={item.color} /><strong>{item.count}</strong><span>{item.label}</span></div>)}</div>
        <div className="richer-dqr-table-wrap"><div className="richer-dqr-header"><span>PROCESS</span>{dqrDimensions.map((_, index) => <span key={index}>D{index + 1}</span>)}<span>STATUS</span></div>
          {processes.map((process) => <div className="richer-dqr-row" key={process.id}><span>{process.id}</span>{process.dqr.split('-').map((score, index) => <span className="richer-dqr-score" key={`${process.id}-${index}`} title={`${dqrDimensions[index]}: score ${score}`}><small>D{index + 1}</small><b>{score}</b></span>)}<span className={`richer-dqr-status status-${statusClass(process.status)}`}>{statusLabel(process.status)}</span></div>)}
        </div>
        <div className="richer-dqr-explainer">{dqrDimensions.map((dimension, index) => <span key={dimension}><b>D{index + 1}</b> {dimension}</span>)}<strong>1 strongest · 5 weakest</strong></div>
      </section>

      <div className="richer-ledger-link"><div><strong>Curated lifecycle model</strong><small>{ledger.length} exchanges for three functional units from web/data/web_catalog.json. This snapshot is separate from the precomputed accepted records shown in the data explorer.</small></div><a href="/exports/lci-ledger.csv" download>Download curated ledger →</a></div>
    </div>
  );
};
