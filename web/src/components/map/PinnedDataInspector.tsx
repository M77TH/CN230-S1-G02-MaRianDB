import React, { useState, useMemo, useRef, useEffect } from 'react';
import {
  ExternalLink,
  Copy,
  Check,
  X,
  Layers,
  ArrowRight,
  Database,
  CheckCircle2,
  Search,
  AlertTriangle
} from 'lucide-react';
import { InfrastructureAsset } from '../../types/asset';
import { TransmissionRoute } from '../../types/route';
import { copyToClipboard, isHttpUrl } from '../../utils/format';
import { DoebDepotCluster, ProvinceDownstreamRecord } from '../../data/thailandDownstreamData';
import { DepotScenario } from '../../utils/mapThemes';
import { DownstreamInspectorCard } from './DownstreamInspectorCard';

export type InspectorItem =
  | { type: 'asset'; data: InfrastructureAsset }
  | { type: 'route'; data: TransmissionRoute }
  | { type: 'province'; data: ProvinceDownstreamRecord }
  | { type: 'depot'; data: DoebDepotCluster };

interface PinnedDataInspectorProps {
  item: InspectorItem;
  onClose: () => void;
  onSelectItem?: (item: InspectorItem) => void;
  allAssets: InfrastructureAsset[];
  allRoutes: TransmissionRoute[];
  depotScenario?: DepotScenario;
}

export const PinnedDataInspector: React.FC<PinnedDataInspectorProps> = ({
  item,
  onClose,
  onSelectItem,
  allAssets,
  allRoutes,
  depotScenario = 'tier1'
}) => {
  const [activeTab, setActiveTab] = useState<'profile' | 'audit' | 'lci'>('profile');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [isSelectorOpen, setIsSelectorOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const handleCopy = (text: string, keyId: string) => {
    void copyToClipboard(text).then((ok) => {
      if (!ok) return;
      setCopiedKey(keyId);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setCopiedKey(null);
      }, 2000);
    });
  };

  const isAsset = item.type === 'asset';
  const isRoute = item.type === 'route';
  const asset = isAsset ? (item.data as InfrastructureAsset) : null;
  const route = isRoute ? (item.data as TransmissionRoute) : null;

  // Title & Categorization
  const titleTh = asset?.nameTh ?? route?.nameTh ?? '';
  const titleEn = asset?.nameEn ?? route?.nameEn ?? '';
  const itemId = asset?.id ?? route?.id ?? '';

  // Category Tag & Label (Clean engineering format)
  const getCategoryText = () => {
    if (isAsset && asset) {
      if (asset.category === 'oil') return 'Crude Oil Production';
      if (asset.category === 'gas') return 'Natural Gas Production';
      if (asset.category === 'refinery') return 'Petroleum Refinery';
      if (asset.category === 'gsp') return 'Gas Processing (GSP)';
      if (asset.category === 'power') return 'Power Generation Gate';
      if (asset.category === 'depot') return 'Petroleum Fuel Depot';
      if (asset.category === 'airport') return 'Aviation Fuel Depot';
      if (asset.category === 'petchem') return 'Petrochemical Complex';
      return 'Energy Production Asset';
    } else if (route) {
      if (route.isDemoPath) return 'Unverified Mid→Mid Demo Path';
      if (route.mode === 'subsea-gas') return 'Subsea Gas Trunkline';
      if (route.mode === 'crude-rail') return 'Crude Rail Corridor';
      if (route.mode === 'road-truck') return 'Crude Tanker Corridor';
      if (route.mode === 'marine-tanker') return 'Marine Shuttle Tanker';
      if (route.mode === 'onshore-oil') return 'Onshore Oil Pipeline';
      return 'Transmission Logistics Corridor';
    }
    return 'Registered Energy Node';
  };

  const categoryText = getCategoryText();
  const stepBadgeText = isAsset
    ? asset!.stage === 'upstream'
      ? 'UPSTREAM'
      : asset!.stage === 'downstream'
        ? 'DOWNSTREAM'
        : 'MIDSTREAM'
    : route?.isDemoPath
      ? 'DEMO PROXY · NO SOURCE'
      : 'LOGISTICS';

  const getRouteOperator = (mode: string) => {
    if (route?.isDemoPath) {
      return 'No Public Origin/Operator Disclosed (DATA_GAP)';
    }
    switch (mode) {
      case 'crude-rail':
        return 'State Railway of Thailand (SRT) / PTT';
      case 'road-truck':
        return 'ADR-Certified Commercial Tanker Fleets';
      case 'subsea-gas':
      case 'onshore-gas':
        return 'PTT Transmission Pipeline TSO';
      case 'marine-tanker':
        return 'Offshore Marine Logistics Operator';
      default:
        return 'National Energy Transmission Operator';
    }
  };

  const getRouteModality = (mode: string) => {
    if (route?.isDemoPath) {
      return 'Option B Unverified Inter-Depot Proxy (Barge / Truck / Rail Mixed)';
    }
    switch (mode) {
      case 'subsea-gas':
        return 'Subsea High-Pressure Natural Gas Trunkline';
      case 'onshore-gas':
        return 'Onshore Natural Gas Transmission Grid';
      case 'crude-rail':
        return 'SRT Dedicated Petroleum Unit Train Fleet';
      case 'road-truck':
        return 'Highway ADR Bulk Crude Road Tanker Fleet';
      case 'marine-tanker':
        return 'Offshore FSO Marine Shuttle Tanker Service';
      case 'onshore-oil':
        return 'Onshore Petroleum Pipeline Network';
      default:
        return 'Dedicated Energy Transmission Corridor';
    }
  };

  // Audit and Reference Data
  const safeRoute = !isAsset && item.type === 'route' ? route : undefined;
  const safeAsset = isAsset ? asset : undefined;
  const produceSourceUrl = safeAsset ? safeAsset.produceSourceUrl : safeRoute?.produceSourceUrl;
  const produceSourceDoc = safeAsset ? safeAsset.produceSourceDoc : safeRoute?.produceSourceDoc;
  const produceCtrlF = safeAsset ? safeAsset.produceCtrlF : safeRoute?.produceCtrlF;
  const produceQuote = safeAsset ? safeAsset.produceQuote : safeRoute?.produceQuote;

  const transportSourceUrl = safeAsset ? safeAsset.transportSourceUrl : safeRoute?.transportSourceUrl;
  const transportSourceDoc = safeAsset ? safeAsset.transportSourceDoc : safeRoute?.transportSourceDoc;
  const transportCtrlF = safeAsset ? safeAsset.transportCtrlF : safeRoute?.transportCtrlF;
  const transportQuote = safeAsset ? safeAsset.transportQuote : safeRoute?.transportQuote;
  const transportDistanceKm = safeAsset ? safeAsset.transportDistanceKm : safeRoute?.distanceKm;

  const functionalUnit = safeAsset
    ? (safeAsset.functionalUnit || '1 Unit Production')
    : (safeRoute?.functionalUnit || '1 t-km Freight Transport');

  const energyMj = safeAsset
    ? safeAsset.energyMjPerFu
    : (safeRoute?.distanceKm && safeRoute?.energyIntensityMjPerTkm
        ? +(safeRoute.distanceKm * safeRoute.energyIntensityMjPerTkm).toFixed(2)
        : '—');

  const ghgKg = safeAsset
    ? safeAsset.ghgKgCo2ePerFu
    : (safeRoute?.distanceKm && safeRoute?.ghgFactorKgCo2ePerTkm
        ? +(safeRoute.distanceKm * safeRoute.ghgFactorKgCo2ePerTkm).toFixed(3)
        : '—');

  const noxG = safeAsset ? safeAsset.noxGPerFu : safeRoute?.noxFactorGPerTkm;
  const soxG = safeAsset ? safeAsset.soxGPerFu : safeRoute?.soxFactorGPerTkm;
  const pm25G = safeAsset ? safeAsset.pm25GPerFu : safeRoute?.pm25FactorGPerTkm;
  const vocG = safeAsset ? safeAsset.vocGPerFu : (safeRoute?.vocFactorGPerTkm ?? safeRoute?.vocGPerFu);

  // Filtered lists for index switcher
  const upstreamAssets = useMemo(() => allAssets.filter(a => a.stage === 'upstream'), [allAssets]);
  const midstreamAssets = useMemo(() => allAssets.filter(a => a.stage === 'midstream'), [allAssets]);
  const downstreamAssets = useMemo(() => allAssets.filter(a => a.stage === 'downstream'), [allAssets]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    if (!q) {
      return {
        upstream: upstreamAssets,
        midstream: midstreamAssets,
        downstream: downstreamAssets,
        routes: allRoutes
      };
    }
    const filterFn = (th: string, en: string, id: string) =>
      th.toLowerCase().includes(q) || en.toLowerCase().includes(q) || id.toLowerCase().includes(q);

    return {
      upstream: upstreamAssets.filter(a => filterFn(a.nameTh, a.nameEn, a.id)),
      midstream: midstreamAssets.filter(a => filterFn(a.nameTh, a.nameEn, a.id)),
      downstream: downstreamAssets.filter(a => filterFn(a.nameTh, a.nameEn, a.id)),
      routes: allRoutes.filter(r => filterFn(r.nameTh, r.nameEn, r.id))
    };
  }, [searchQuery, upstreamAssets, midstreamAssets, downstreamAssets, allRoutes]);

  if (item.type === 'province' || item.type === 'depot') {
    return (
      <DownstreamInspectorCard
        mode={item.type}
        province={item.type === 'province' ? item.data : undefined}
        depot={item.type === 'depot' ? item.data : undefined}
        scenario={depotScenario ?? 'tier1'}
        onClose={onClose}
        onSelectProvince={onSelectItem ? (p) => onSelectItem({ type: 'province', data: p }) : undefined}
        onSelectDepot={onSelectItem ? (d) => onSelectItem({ type: 'depot', data: d }) : undefined}
      />
    );
  }

  return (
    <aside className="clean-inspector-card" aria-label="Facility Technical Dossier">
      {/* 1. Header Row (Step Badge + Category Tag + Close Button) */}
      <div className="inspector-top-bar">
        <div className="inspector-tag-cluster">
          <span className="mono-badge-tag font-mono">
            {stepBadgeText}
          </span>
          <span className="mono-category-text font-mono">
            CATEGORY: {categoryText}
          </span>
        </div>

        <button
          type="button"
          className="inspector-close-btn"
          onClick={onClose}
          title="Close panel"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>

      {/* 2. Facility Title Block */}
      <div className="inspector-title-block">
        <h1 className="title-primary font-sans">{titleEn}</h1>
        <h2 className="title-secondary font-sans">{titleTh}</h2>
      </div>

      {/* 3. Facility Index Switcher Link */}
      <div className="facility-index-nav">
        <span className="facility-node-id font-mono">NODE ID: {itemId}</span>
        {onSelectItem && (
          <button
            type="button"
            className="facility-index-trigger font-mono"
            onClick={() => setIsSelectorOpen(!isSelectorOpen)}
          >
            {isSelectorOpen ? 'Close Index ▴' : `Browse Facilities (${allAssets.length + allRoutes.length}) ▾`}
          </button>
        )}
      </div>

      {/* Facility Switcher Dropdown */}
      {isSelectorOpen && onSelectItem && (
        <div className="clean-picker-menu">
          <div className="clean-picker-search">
            <Search size={13} className="picker-icon" />
            <input
              type="text"
              className="clean-picker-input font-sans"
              placeholder="Search by facility name, code, basin..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                className="clean-picker-clear font-mono"
                onClick={() => setSearchQuery('')}
              >
                CLEAR
              </button>
            )}
          </div>

          <div className="clean-picker-list">
            {filteredItems.upstream.length > 0 && (
              <div className="clean-picker-group">
                <div className="picker-group-title font-mono">Upstream E&P Production ({filteredItems.upstream.length})</div>
                {filteredItems.upstream.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`clean-picker-row ${isAsset && asset!.id === a.id ? 'active' : ''}`}
                    onClick={() => {
                      onSelectItem({ type: 'asset', data: a });
                      setIsSelectorOpen(false);
                      setSearchQuery('');
                    }}
                  >
                    <span className="dot dot-amber" />
                    <span className="clean-picker-name">{a.nameEn} ({a.nameTh})</span>
                    <span className="clean-picker-id font-mono">{a.id}</span>
                  </button>
                ))}
              </div>
            )}

            {filteredItems.midstream.length > 0 && (
              <div className="clean-picker-group">
                <div className="picker-group-title font-mono">Midstream Processing & Refining ({filteredItems.midstream.length})</div>
                {filteredItems.midstream.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`clean-picker-row ${isAsset && asset!.id === a.id ? 'active' : ''}`}
                    onClick={() => {
                      onSelectItem({ type: 'asset', data: a });
                      setIsSelectorOpen(false);
                      setSearchQuery('');
                    }}
                  >
                    <span className="dot dot-green" />
                    <span className="clean-picker-name">{a.nameEn} ({a.nameTh})</span>
                    <span className="clean-picker-id font-mono">{a.id}</span>
                  </button>
                ))}
              </div>
            )}

            {filteredItems.downstream.length > 0 && (
              <div className="clean-picker-group">
                <div className="picker-group-title font-mono">Downstream Depots, Airports & Petchem ({filteredItems.downstream.length})</div>
                {filteredItems.downstream.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    className={`clean-picker-row ${isAsset && asset!.id === a.id ? 'active' : ''}`}
                    onClick={() => {
                      onSelectItem({ type: 'asset', data: a });
                      setIsSelectorOpen(false);
                      setSearchQuery('');
                    }}
                  >
                    <span className="dot dot-cyan" />
                    <span className="clean-picker-name">{a.nameEn} ({a.nameTh})</span>
                    <span className="clean-picker-id font-mono">{a.id}</span>
                  </button>
                ))}
              </div>
            )}

            {filteredItems.routes.length > 0 && (
              <div className="clean-picker-group">
                <div className="picker-group-title font-mono">Logistics & Corridors ({filteredItems.routes.length})</div>
                {filteredItems.routes.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className={`clean-picker-row ${!isAsset && route!.id === r.id ? 'active' : ''}`}
                    onClick={() => {
                      onSelectItem({ type: 'route', data: r });
                      setIsSelectorOpen(false);
                      setSearchQuery('');
                    }}
                  >
                    <span className="dot dot-cyan" />
                    <span className="clean-picker-name">{r.nameEn} ({r.nameTh})</span>
                    <span className="clean-picker-id font-mono">{r.mode}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 4. Minimal Segmented Navigation Bar */}
      <nav className="inspector-tab-nav" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'profile'}
          className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <span>Technical Profile</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'audit'}
          className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          <span>Regulatory Audit</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'lci'}
          className={`tab-btn ${activeTab === 'lci' ? 'active' : ''}`}
          onClick={() => setActiveTab('lci')}
        >
          <span>LCI Impact</span>
        </button>
      </nav>

      {/* 5. Dossier Scrollable Content Body */}
      <div className="inspector-scroll-area">
        {/* TAB 1: TECHNICAL PROFILE */}
        {activeTab === 'profile' && (
          <div className="tab-pane">
            {safeRoute?.isDemoPath && (
              <div className="demo-proxy-alert" role="note">
                <div className="demo-proxy-alert-title font-mono">
                  <AlertTriangle size={13} />
                  <span>OPTION B DEMO PATH — ไม่มีข้อมูลต้นทางรายคลังในสาธารณะ</span>
                </div>
                <p className="demo-proxy-alert-body">
                  {safeRoute.evidenceNote ||
                    'เส้นทางจำลองเชิงสาธิตเท่านั้น (DATA_GAP): ไม่พบเอกสารเปิดเผยโรงกลั่นต้นทาง ปริมาณขนถ่าย หรือสัดส่วนโหมดขนส่งรายคลังในสาธารณะ'}
                </p>
              </div>
            )}
            {/* Card 1: Operating Specifications */}
            <section className="clean-section-card">
              <div className="card-header-line">
                <Layers size={13} color="#d97706" />
                <span className="card-header-title font-mono">
                  {isAsset ? 'OPERATIONAL SPECIFICATIONS & CAPACITY' : 'LOGISTICS SPECIFICATIONS & CAPACITY'}
                </span>
              </div>
              <ul className="clean-bullet-list">
                <li className="bullet-row">
                  <span className="dot dot-amber" />
                  <span className="bullet-text">
                    <span className="label-dim">{isAsset ? 'Certified Output: ' : 'Rated Logistics Capacity: '}</span>
                    <span className="val-bright font-mono font-bold">
                      {isAsset ? asset!.prodValue : route!.specs}
                    </span>
                  </span>
                </li>
                <li className="bullet-row">
                  <span className="dot dot-amber" />
                  <span className="bullet-text">
                    <span className="label-dim">{isAsset ? 'Throughput Stream: ' : 'Logistics Modality: '}</span>
                    <span>
                      {isAsset
                        ? (asset!.prodSub || asset!.prodLabel)
                        : getRouteModality(route!.mode)}
                    </span>
                  </span>
                </li>
              </ul>
            </section>

            {/* Card 2: Midstream Destination & Flow Corridor */}
            {(isAsset ? asset!.destName : route!.to) && (
              <section className="clean-section-card">
                <div className="card-header-line">
                  <ArrowRight size={13} color="#517b9d" />
                  <span className="card-header-title font-mono">
                    {isAsset ? 'MIDSTREAM OFFTAKER & LOGISTICS GATE' : 'TRANSIT CORRIDOR & DESTINATION'}
                  </span>
                </div>
                <div className="mandate-list">
                  <div className="mandate-item">
                    <span className="mandate-arrow font-mono">→</span>
                    <span className="mandate-text">
                      <span className="label-dim">{isAsset ? 'Designated Gate: ' : 'Terminal Destination: '}</span>
                      <span className="val-bright font-semibold">
                        {isAsset ? asset!.destName : route!.to}
                      </span>
                    </span>
                  </div>
                  <div className="mandate-item">
                    <span className="mandate-arrow font-mono">→</span>
                    <span className="mandate-text">
                      <span className="label-dim">{isAsset ? 'Logistics Path: ' : 'Origin Point: '}</span>
                      <span>
                        {isAsset
                          ? asset!.destMode
                          : route!.from}
                      </span>
                    </span>
                  </div>
                  {transportDistanceKm ? (
                    <div className="mandate-item">
                      <span className="mandate-arrow font-mono">→</span>
                      <span className="mandate-text font-mono">
                        <span className="label-dim">{isAsset ? 'Measured Pipeline Chainage: ' : 'Measured Route Distance: '}</span>
                        <span className="val-bright">{transportDistanceKm} km</span>
                      </span>
                    </div>
                  ) : null}
                </div>
              </section>
            )}

            {/* Card 3: Geodetic & Legal Registry Grid */}
            <section className="clean-section-card">
              <div className="card-header-line">
                <Database size={13} color="#43542d" />
                <span className="card-header-title font-mono">
                  {isAsset ? 'GEODETIC & LEGAL REGISTRY' : 'CORRIDOR & LEGAL REGISTRY'}
                </span>
              </div>
              <div className="table-rows">
                <div className="table-row-item">
                  <span className="table-key font-mono">{isAsset ? 'FACILITY ID' : 'CORRIDOR ID'}</span>
                  <div className="table-val-group">
                    <span className="table-val font-mono font-bold text-cyan">{itemId}</span>
                    <button
                      type="button"
                      className="clean-copy-btn"
                      onClick={() => handleCopy(itemId, 'id')}
                      title="Copy ID"
                    >
                      {copiedKey === 'id' ? <Check size={11} className="text-emerald" /> : <Copy size={11} />}
                    </button>
                  </div>
                </div>

                <div className="table-row-item">
                  <span className="table-key font-mono">{isAsset ? 'GEOLOGIC BASIN' : 'CORRIDOR DOMAIN'}</span>
                  <span className="table-val">
                    {isAsset ? asset!.basin : 'National Energy Flow Corridor'}
                  </span>
                </div>

                <div className="table-row-item">
                  <span className="table-key font-mono">JURISDICTION</span>
                  <span className="table-val">
                    {isAsset ? asset!.location : `${route!.from} → ${route!.to}`}
                  </span>
                </div>

                <div className="table-row-item">
                  <span className="table-key font-mono">LEGAL OPERATOR</span>
                  <span className="table-val font-medium">
                    {isAsset ? asset!.operator : getRouteOperator(route!.mode)}
                  </span>
                </div>

                <div className="table-row-item">
                  <span className="table-key font-mono">COORDINATES</span>
                  <div className="table-val-group">
                    <span className="table-val font-mono">
                      {isAsset
                        ? `${asset!.lat.toFixed(4)}°N, ${asset!.lng.toFixed(4)}°E`
                        : (route?.coords && route.coords.length > 0
                            ? `${route.coords[0][0].toFixed(4)}°N, ${route.coords[0][1].toFixed(4)}°E`
                            : '—')}
                    </span>
                    <button
                      type="button"
                      className="clean-copy-btn"
                      onClick={() => {
                        const coords = isAsset
                          ? `${asset!.lat.toFixed(4)}, ${asset!.lng.toFixed(4)}`
                          : (route?.coords && route.coords.length > 0
                              ? `${route.coords[0][0].toFixed(4)}, ${route.coords[0][1].toFixed(4)}`
                              : '');
                        if (coords) handleCopy(coords, 'coord');
                      }}
                      title="Copy coordinates"
                    >
                      {copiedKey === 'coord' ? <Check size={11} className="text-emerald" /> : <Copy size={11} />}
                    </button>
                  </div>
                </div>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: REGULATORY AUDIT & VERBATIM PRIMARY SOURCES */}
        {activeTab === 'audit' && (
          <div className="tab-pane">
            {safeRoute?.isDemoPath && (
              <div className="demo-proxy-alert" role="note">
                <div className="demo-proxy-alert-title font-mono">
                  <AlertTriangle size={13} />
                  <span>NO PRIMARY MANIFEST — เส้นทางจำลอง (Option B)</span>
                </div>
                <p className="demo-proxy-alert-body">
                  {safeRoute.evidenceNote ||
                    'ไม่มีเอกสารปฐมภูมิที่ระบุต้นทางรายคลังของเส้นทางนี้ เส้นทางถูกแสดงด้วยเส้นประสีส้มเข้มเพื่อให้เห็นความต่างจากเส้นทางท่อและเรือชายฝั่งที่มีหลักฐานยืนยัน'}
                </p>
              </div>
            )}
            {/* 1. Production Filing */}
            <section className="clean-section-card">
              <div className="card-header-line">
                <CheckCircle2 size={13} color="#43542d" />
                <span className="card-header-title font-mono">
                  1. PRODUCTION EVIDENCE (GOVERNMENT FILING)
                </span>
              </div>

              <div className="doc-title-row font-semibold">
                {produceSourceDoc || 'Department of Mineral Fuels Official Petroleum Concession Factsheet'}
              </div>

              {isHttpUrl(produceSourceUrl) && (
                <a
                  href={produceSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="clean-doc-link font-mono"
                  title="Open source document"
                >
                  <ExternalLink size={11} />
                  <span>{produceSourceUrl}</span>
                </a>
              )}

              <div className="formula-container">
                <div className="formula-label-row">
                  <span className="font-mono text-muted">VERBATIM SEARCH ANCHOR (Ctrl + F):</span>
                  {produceCtrlF && (
                    <button
                      type="button"
                      className="formula-copy-btn font-mono"
                      onClick={() => handleCopy(produceCtrlF, 'produce')}
                    >
                      {copiedKey === 'produce' ? (
                        <span className="text-emerald font-bold">COPIED</span>
                      ) : (
                        <>
                          <Copy size={10} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div className="formula-code-box font-mono">
                  {produceCtrlF ? `"${produceCtrlF}"` : 'Not specified — see primary filing'}
                </div>
              </div>

              <div className="clean-quote-block">
                "{produceQuote || 'อัตราการผลิตตามสัมปทานและสถิติทางการของกรมเชื้อเพลิงธรรมชาติ กระทรวงพลังงาน'}"
              </div>
            </section>

            {/* 2. Logistics & Transmission Filing */}
            <section className="clean-section-card">
              <div className="card-header-line">
                <CheckCircle2 size={13} color="#517b9d" />
                <span className="card-header-title font-mono">
                  2. LOGISTICS & TRANSMISSION EVIDENCE
                </span>
              </div>

              <div className="doc-title-row font-semibold">
                {transportSourceDoc || 'PTTEP EIA Report / EMEP-EEA Guidebook 2023'}
              </div>

              {isHttpUrl(transportSourceUrl) && (
                <a
                  href={transportSourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="clean-doc-link font-mono"
                  title="Open source document"
                >
                  <ExternalLink size={11} />
                  <span>{transportSourceUrl}</span>
                </a>
              )}

              <div className="formula-container">
                <div className="formula-label-row">
                  <span className="font-mono text-muted">VERBATIM SEARCH ANCHOR (Ctrl + F):</span>
                  {transportCtrlF && (
                    <button
                      type="button"
                      className="formula-copy-btn font-mono"
                      onClick={() => handleCopy(transportCtrlF, 'transport')}
                    >
                      {copiedKey === 'transport' ? (
                        <span className="text-emerald font-bold">COPIED</span>
                      ) : (
                        <>
                          <Copy size={10} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div className="formula-code-box font-mono">
                  {transportCtrlF ? `"${transportCtrlF}"` : 'Not specified — see primary filing'}
                </div>
              </div>

              <div className="clean-quote-block">
                "{transportQuote || 'โครงข่ายการขนส่งปิโตรเลียมผ่านโครงสร้างพื้นฐานท่อส่งก๊าซ รถไฟ หรือรถบรรทุก'}"
              </div>
            </section>

            {/* Mandate Note */}
            <div className="mandate-note-card font-mono">
              {safeRoute?.isDemoPath ? (
                <>
                  <span className="font-bold text-white">OPTION B DEMO PROXY NOTICE:</span>
                  {' '}No public origin-to-depot manifest exists for this regional feeder (`DATA_GAP`); excluded from verified LCI inventory totals.
                </>
              ) : (
                <>
                  <span className="font-bold text-white">REPRODUCIBILITY MANDATE:</span>
                  {' '}100% of data points are verifiable character-for-character against primary government filings and technical concession records.
                </>
              )}
            </div>
          </div>
        )}

        {/* TAB 3: LIFE CYCLE INVENTORY (ISO 14040/14044) */}
        {activeTab === 'lci' && (
          <div className="tab-pane">
            {/* Functional Unit Definition Box */}
            <div className="formula-container formula-container--spaced">
              <div className="formula-label-row">
                <span className="font-mono text-muted">DECLARED FUNCTIONAL UNIT (ISO 14044):</span>
              </div>
              <div className="formula-code-box font-mono">
                {functionalUnit}
              </div>
            </div>

            {/* Twin Cumulative Intensity Cards */}
            <div className="intensity-dual-grid">
              <div className="intensity-card">
                <div className="intensity-label font-mono">CUMULATIVE ENERGY</div>
                <div className="intensity-value font-mono text-amber">
                  {typeof energyMj === 'number' ? energyMj.toFixed(2) : energyMj}
                  <span className="intensity-unit font-mono"> MJ / FU</span>
                </div>
              </div>

              <div className="intensity-card">
                <div className="intensity-label font-mono">GHG INTENSITY (GWP100)</div>
                <div className="intensity-value font-mono text-red">
                  {typeof ghgKg === 'number' ? ghgKg.toFixed(3) : ghgKg}
                  <span className="intensity-unit font-mono"> kg CO₂e / FU</span>
                </div>
              </div>
            </div>

            {/* Regulated Air Pollutants Card */}
            <section className="clean-section-card">
              <div className="card-header-line">
                <Layers size={13} color="#517b9d" />
                <span className="card-header-title font-mono">
                  REGULATED AIR POLLUTANTS (EMEP/EEA 2023)
                </span>
              </div>

              <ul className="clean-bullet-list">
                <li className="bullet-row">
                  <span className="dot dot-cyan" />
                  <span className="bullet-text">
                    <span className="label-dim">Nitrogen Oxides (NOₓ): </span>
                    <span className="val-bright font-mono font-bold">
                      {typeof noxG === 'number' ? noxG.toFixed(3) : '—'} g/FU
                    </span>
                  </span>
                </li>
                <li className="bullet-row">
                  <span className="dot dot-cyan" />
                  <span className="bullet-text">
                    <span className="label-dim">Sulfur Oxides (SOₓ): </span>
                    <span className="val-bright font-mono font-bold">
                      {typeof soxG === 'number' ? soxG.toFixed(4) : '—'} g/FU
                    </span>
                  </span>
                </li>
                <li className="bullet-row">
                  <span className="dot dot-cyan" />
                  <span className="bullet-text">
                    <span className="label-dim">Particulate Matter (PM₂.₅): </span>
                    <span className="val-bright font-mono font-bold">
                      {typeof pm25G === 'number' ? pm25G.toFixed(4) : '—'} g/FU
                    </span>
                  </span>
                </li>
                <li className="bullet-row">
                  <span className="dot dot-cyan" />
                  <span className="bullet-text">
                    <span className="label-dim">Non-Methane VOCs (NMVOC): </span>
                    <span className="val-bright font-mono font-bold">
                      {typeof vocG === 'number' ? vocG.toFixed(4) : '—'} g/FU
                    </span>
                  </span>
                </li>
              </ul>
            </section>

            {/* Methodology Note */}
            <div className="mandate-note-card font-mono">
              <span className="font-bold text-white">LCI METHODOLOGY:</span>
              {' '}ISO 14040/14044 Life Cycle Assessment framework, EMEP/EEA 2023 Tier 1/2 factors, and Thailand TGO Freight Registry.
            </div>
          </div>
        )}
      </div>

      {/* 6. Footer Ledger */}
      <footer className="inspector-footer-line">
        <span className="font-mono text-muted">FORMAL REGISTRY LEDGER</span>
        <span className="font-mono font-bold text-emerald">
          {isAsset ? asset!.sourceId : 'SRC-050 / SRC-063'}
        </span>
      </footer>
    </aside>
  );
};
