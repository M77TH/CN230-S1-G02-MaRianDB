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
import type { InfrastructureAsset } from '../../types/asset';
import type { TransmissionRoute } from '../../types/route';
import { copyToClipboard, isHttpUrl } from '../../utils/format';
import type {
  CoastalTankerCorridor,
  DoebDepotCluster,
  ProvinceDownstreamRecord
} from '../../data/thailandDownstreamData';
import { useWebsiteData } from '../../data/websiteData';
import type { DepotScenario } from '../../utils/mapThemes';
import {
  resolveAssetSourceLinks,
  resolveCoastalSourceLinks,
  resolveRouteSourceLinks,
  VERIFIED_SOURCE_LINKS
} from '../../utils/sourceLinks';
import { DownstreamInspectorCard } from './DownstreamInspectorCard';
import { SourceLinkChips } from './SourceLinkChips';

export type InspectorItem =
  | { type: 'asset'; data: InfrastructureAsset }
  | { type: 'route'; data: TransmissionRoute }
  | { type: 'coastal'; data: CoastalTankerCorridor }
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

  const { catalog } = useWebsiteData();
  const sourceCards = catalog?.data.sourceCards ?? [];
  const isAsset = item.type === 'asset';
  const isRoute = item.type === 'route';
  const isCoastal = item.type === 'coastal';
  const asset = isAsset ? (item.data as InfrastructureAsset) : null;
  const route = isRoute ? (item.data as TransmissionRoute) : null;
  const coastal = isCoastal ? (item.data as CoastalTankerCorridor) : null;

  const itemSourceLinks = useMemo(() => {
    if (isAsset && asset) return resolveAssetSourceLinks(asset, sourceCards);
    if (isRoute && route) return resolveRouteSourceLinks(route, sourceCards);
    if (isCoastal && coastal) return resolveCoastalSourceLinks(coastal, sourceCards);
    return [];
  }, [isAsset, asset, isRoute, route, isCoastal, coastal, sourceCards]);

  // Title & Categorization
  const titleTh = asset?.nameTh ?? route?.nameTh ?? coastal?.nameTh ?? '';
  const titleEn = asset?.nameEn ?? route?.nameEn ?? coastal?.nameEn ?? '';
  const itemId = asset?.id ?? route?.id ?? coastal?.id ?? '';

  // Category Tag & Label (Clean engineering format)
  const getCategoryText = () => {
    if (isAsset && asset) {
      if (asset.category === 'oil') return 'แหล่งผลิตน้ำมันดิบ';
      if (asset.category === 'gas') return 'แหล่งผลิตก๊าซธรรมชาติ';
      if (asset.category === 'refinery') return 'โรงกลั่นปิโตรเลียม';
      if (asset.category === 'gsp') return 'โรงแยกก๊าซธรรมชาติ (GSP)';
      if (asset.category === 'power') return 'โรงไฟฟ้า (จุดส่งมอบ)';
      if (asset.category === 'depot') return 'คลังน้ำมันเชื้อเพลิง';
      if (asset.category === 'airport') return 'คลังน้ำมันอากาศยาน';
      if (asset.category === 'petchem') return 'คอมเพล็กซ์ปิโตรเคมี';
      return 'สถานที่ผลิตพลังงาน';
    } else if (isCoastal) {
      return 'เส้นทางเรือขนส่งผลิตภัณฑ์ชายฝั่ง';
    } else if (route) {
      if (route.isDemoPath) return 'เส้นทางสาธิตที่ยังไม่ยืนยัน';
      if (route.mode === 'subsea-gas') return 'ท่อส่งก๊าซธรรมชาติใต้ทะเล';
      if (route.mode === 'crude-rail') return 'เส้นทางรถไฟขนส่งน้ำมันดิบ';
      if (route.mode === 'road-truck') return 'เส้นทางรถบรรทุกน้ำมันดิบ';
      if (route.mode === 'marine-tanker') return 'เส้นทางเรือขนส่งทางทะเล';
      if (route.mode === 'onshore-oil') return 'ท่อส่งน้ำมันบนบก';
      return 'เส้นทางลำเลียงพลังงาน';
    }
    return 'จุดพลังงานในทะเบียน';
  };

  const categoryText = getCategoryText();
  const stepBadgeText = isAsset
    ? asset!.stage === 'upstream'
      ? 'ต้นน้ำ'
      : asset!.stage === 'downstream'
        ? 'ปลายน้ำ'
        : 'กลางน้ำ'
    : isCoastal
      ? 'เส้นทางเรือชายฝั่ง'
      : route?.isDemoPath
        ? 'เส้นทางสาธิต · ไม่มีแหล่งข้อมูล'
        : 'โลจิสติกส์';

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
  const safeRoute = isRoute ? route : undefined;
  const safeAsset = isAsset ? asset : undefined;
  const safeCoastal = isCoastal ? coastal : undefined;
  const produceSourceUrl = safeAsset ? safeAsset.produceSourceUrl : safeRoute?.produceSourceUrl;
  const produceSourceDoc = safeAsset
    ? safeAsset.produceSourceDoc
    : safeRoute?.produceSourceDoc ??
      (safeCoastal ? `Coastal Marine Tanker Registry (${safeCoastal.sourceId})` : undefined);
  const produceCtrlF = safeAsset ? safeAsset.produceCtrlF : safeRoute?.produceCtrlF;
  const produceQuote = safeAsset ? safeAsset.produceQuote : safeRoute?.produceQuote;

  const transportSourceUrl = safeAsset
    ? safeAsset.transportSourceUrl
    : safeRoute?.transportSourceUrl ?? safeRoute?.sourceUrl;
  const transportSourceDoc = safeAsset
    ? safeAsset.transportSourceDoc
    : safeRoute?.transportSourceDoc ??
      (safeCoastal ? `${safeCoastal.voyageTime} · ${safeCoastal.sourceId}` : undefined);
  const transportCtrlF = safeAsset ? safeAsset.transportCtrlF : safeRoute?.transportCtrlF;
  const transportQuote = safeAsset ? safeAsset.transportQuote : safeRoute?.transportQuote;
  const transportDistanceKm = safeAsset
    ? safeAsset.transportDistanceKm
    : (safeRoute?.distanceKm ?? safeCoastal?.distanceKm);

  const corridorSpecs = safeRoute
    ? safeRoute.specs
    : safeCoastal
      ? `${safeCoastal.distanceNm} nm (${safeCoastal.distanceKm} km) · ${safeCoastal.voyageTime}`
      : '—';
  const corridorModality = safeRoute
    ? getRouteModality(safeRoute.mode)
    : 'Coastal Product Tanker Vessel (DOEB Sec 7/16 Ports & Sea Lanes)';
  const corridorFrom = safeRoute?.from ?? safeCoastal?.from ?? '—';
  const corridorTo = safeRoute?.to ?? safeCoastal?.to ?? '';
  const corridorCoords = safeRoute?.coords ?? safeCoastal?.coords;
  const corridorOperator = safeRoute
    ? getRouteOperator(safeRoute.mode)
    : 'Thai Coastal Tanker Fleets (Prima Marine / Maritime Operators)';

  const functionalUnit = safeAsset
    ? (safeAsset.functionalUnit || '1 Unit Production')
    : (safeRoute?.functionalUnit || (safeCoastal ? '1 t-km Coastal Product Tanker' : '1 t-km Freight Transport'));

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
            หมวดหมู่: {categoryText}
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
        <span className="facility-node-id font-mono">รหัสจุด: {itemId}</span>
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
          <span>ข้อมูลทางเทคนิค</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'audit'}
          className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          <span>การตรวจสอบแหล่งอ้างอิง</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'lci'}
          className={`tab-btn ${activeTab === 'lci' ? 'active' : ''}`}
          onClick={() => setActiveTab('lci')}
        >
          <span>ผลกระทบสิ่งแวดล้อม (LCI)</span>
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
                <SourceLinkChips links={itemSourceLinks} variant="chips" showHost className="inspector-inline-sources" />
              </div>
            )}
            {/* Card 1: Operating Specifications */}
            <section className="clean-section-card">
              <div className="card-header-line">
                <Layers size={13} color="#d97706" />
                <span className="card-header-title font-mono">
                  {isAsset ? 'ข้อมูลการดำเนินงานและกำลังการผลิต' : 'ข้อมูลเส้นทางและขีดความสามารถการขนส่ง'}
                </span>
              </div>
              <ul className="clean-bullet-list">
                <li className="bullet-row">
                  <span className="dot dot-amber" />
                  <span className="bullet-text">
                    <span className="label-dim">{isAsset ? 'กำลังการผลิตที่รายงาน: ' : 'ระยะทาง/ขีดความสามารถ: '}</span>
                    <span className="val-bright font-mono font-bold">
                      {isAsset ? asset!.prodValue : corridorSpecs}
                    </span>
                  </span>
                </li>
                <li className="bullet-row">
                  <span className="dot dot-amber" />
                  <span className="bullet-text">
                    <span className="label-dim">{isAsset ? 'ประเภทผลผลิต: ' : 'รูปแบบการขนส่ง: '}</span>
                    <span>
                      {isAsset
                        ? (asset!.prodSub || asset!.prodLabel)
                        : corridorModality}
                    </span>
                  </span>
                </li>
              </ul>
            </section>

            {/* Card 2: Midstream Destination & Flow Corridor */}
            {(isAsset ? asset!.destName : corridorTo) && (
              <section className="clean-section-card">
                <div className="card-header-line">
                  <ArrowRight size={13} color="#517b9d" />
                  <span className="card-header-title font-mono">
                    {isAsset ? 'ผู้รับซื้อและจุดส่งมอบ' : 'เส้นทางขนส่งและปลายทาง'}
                  </span>
                </div>
                <div className="mandate-list">
                  <div className="mandate-item">
                    <span className="mandate-arrow font-mono">→</span>
                    <span className="mandate-text">
                      <span className="label-dim">{isAsset ? 'จุดส่งมอบ: ' : 'ปลายทาง: '}</span>
                      <span className="val-bright font-semibold">
                        {isAsset ? asset!.destName : corridorTo}
                      </span>
                    </span>
                  </div>
                  <div className="mandate-item">
                    <span className="mandate-arrow font-mono">→</span>
                    <span className="mandate-text">
                      <span className="label-dim">{isAsset ? 'เส้นทางขนส่ง: ' : 'ต้นทาง: '}</span>
                      <span>
                        {isAsset
                          ? asset!.destMode
                          : corridorFrom}
                      </span>
                    </span>
                  </div>
                  {transportDistanceKm ? (
                    <div className="mandate-item">
                      <span className="mandate-arrow font-mono">→</span>
                      <span className="mandate-text font-mono">
                        <span className="label-dim">{isAsset ? 'ระยะทางตามแนวท่อ: ' : 'ระยะทางเส้นทาง: '}</span>
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
                  {isAsset ? 'ข้อมูลพิกัดและทะเบียน' : 'ข้อมูลเส้นทางและทะเบียน'}
                </span>
              </div>
              <div className="table-rows">
                <div className="table-row-item">
                  <span className="table-key font-mono">{isAsset ? 'รหัสสถานที่' : 'รหัสเส้นทาง'}</span>
                  <div className="table-val-group">
                    <span className="table-val font-mono font-bold text-cyan">{itemId}</span>
                    <button
                      type="button"
                      className="clean-copy-btn"
                      onClick={() => handleCopy(itemId, 'id')}
                      title="คัดลอกรหัส"
                    >
                      {copiedKey === 'id' ? <Check size={11} className="text-emerald" /> : <Copy size={11} />}
                    </button>
                  </div>
                </div>

                <div className="table-row-item">
                  <span className="table-key font-mono">{isAsset ? 'แอ่งธรณีวิทยา' : 'ขอบเขตเส้นทาง'}</span>
                  <span className="table-val">
                    {isAsset ? asset!.basin : (isCoastal ? 'Gulf of Thailand / Andaman Sea' : 'National Energy Flow Corridor')}
                  </span>
                </div>

                <div className="table-row-item">
                  <span className="table-key font-mono">ที่ตั้ง</span>
                  <span className="table-val">
                    {isAsset ? asset!.location : `${corridorFrom} → ${corridorTo}`}
                  </span>
                </div>

                <div className="table-row-item">
                  <span className="table-key font-mono">ผู้ดำเนินงาน</span>
                  <span className="table-val font-medium">
                    {isAsset ? asset!.operator : corridorOperator}
                  </span>
                </div>

                <div className="table-row-item">
                  <span className="table-key font-mono">พิกัด</span>
                  <div className="table-val-group">
                    <span className="table-val font-mono">
                      {isAsset
                        ? `${asset!.lat.toFixed(4)}°N, ${asset!.lng.toFixed(4)}°E`
                        : (corridorCoords && corridorCoords.length > 0
                            ? `${corridorCoords[0][0].toFixed(4)}°N, ${corridorCoords[0][1].toFixed(4)}°E`
                            : '—')}
                    </span>
                    <button
                      type="button"
                      className="clean-copy-btn"
                      onClick={() => {
                        const coords = isAsset
                          ? `${asset!.lat.toFixed(4)}, ${asset!.lng.toFixed(4)}`
                          : (corridorCoords && corridorCoords.length > 0
                              ? `${corridorCoords[0][0].toFixed(4)}, ${corridorCoords[0][1].toFixed(4)}`
                              : '');
                        if (coords) handleCopy(coords, 'coord');
                      }}
                      title="คัดลอกพิกัด"
                    >
                      {copiedKey === 'coord' ? <Check size={11} className="text-emerald" /> : <Copy size={11} />}
                    </button>
                  </div>
                </div>
              </div>
            </section>

            {/* Card 4: Direct Clickable Source Webpages */}
            {itemSourceLinks.length > 0 && (
              <section className="clean-section-card">
                <div className="card-header-line">
                  <ExternalLink size={13} color="#43542d" />
                  <span className="card-header-title font-mono">แหล่งข้อมูลอ้างอิง</span>
                </div>
                <SourceLinkChips links={itemSourceLinks} variant="list" />
              </section>
            )}
          </div>
        )}

        {/* TAB 2: REGULATORY AUDIT & VERBATIM PRIMARY SOURCES */}
        {activeTab === 'audit' && (
          <div className="tab-pane">
            <section className="clean-section-card">
              <div className="card-header-line">
                <Database size={13} color="#517b9d" />
                <span className="card-header-title font-mono">DATA ORIGIN & SCOPE</span>
              </div>
              <p className="explorer-cell-secondary">
                {safeAsset
                  ? `Map label and coordinates are maintained in web/data/web_catalog.json for ${safeAsset.id}. The source citation below documents the referenced facility; the coordinates were not generated by the current LCI pipeline.`
                  : safeCoastal
                    ? `Coastal product tanker shipping corridor ${safeCoastal.id} (${safeCoastal.distanceNm} nm / ${safeCoastal.distanceKm} km) referencing DOEB oil ports, Vessbook route planner, and Prima Marine fleet disclosures.`
                    : `Route line geometry and distance are maintained in web/data/web_catalog.json for ${safeRoute?.id ?? 'this route'}. The citations below describe the route or its factors; the geometry is not generated by the current LCI pipeline.`}
              </p>
            </section>

            {safeAsset?.stage === 'upstream' && (
              <section className="clean-section-card">
                <div className="card-header-line">
                  <Database size={13} color="#43542d" />
                  <span className="card-header-title font-mono">PROCESSED PIPELINE OBSERVATION</span>
                </div>
                {safeAsset.pipelineObservation ? (
                  <>
                    <ul className="clean-bullet-list">
                      <li className="bullet-row"><span className="dot dot-amber" /><span className="bullet-text"><span className="label-dim">Value / period: </span><span className="val-bright font-mono font-bold">{safeAsset.pipelineObservation.value.toLocaleString('en-US', { maximumFractionDigits: 2 })} {safeAsset.pipelineObservation.unit} · {safeAsset.pipelineObservation.period}</span></span></li>
                      <li className="bullet-row"><span className="dot dot-amber" /><span className="bullet-text"><span className="label-dim">Pipeline row: </span><span className="val-bright font-mono">{safeAsset.pipelineObservation.sourceId} · source_group “{safeAsset.pipelineObservation.sourceGroup}” · block {safeAsset.pipelineObservation.blockName || '—'}</span></span></li>
                      <li className="bullet-row"><span className="dot dot-amber" /><span className="bullet-text"><span className="label-dim">Join explanation: </span><span>{safeAsset.pipelineObservation.joinRule}</span></span></li>
                      <li className="bullet-row"><span className="dot dot-amber" /><span className="bullet-text"><span className="label-dim">Staged artifact: </span><span className="val-bright font-mono">{safeAsset.pipelineObservation.stagingPath} · {safeAsset.pipelineObservation.stagedFile}</span></span></li>
                      <li className="bullet-row"><span className="dot dot-amber" /><span className="bullet-text"><span className="label-dim">Staged file SHA-256: </span><span className="val-bright font-mono">{safeAsset.pipelineObservation.stagedFileSha256}</span></span></li>
                      <li className="bullet-row"><span className="dot dot-amber" /><span className="bullet-text"><span className="label-dim">Raw file / SHA-256: </span><span className="val-bright font-mono">{safeAsset.pipelineObservation.rawFile} · {safeAsset.pipelineObservation.sourceSha256}</span></span></li>
                      <li className="bullet-row"><span className="dot dot-amber" /><span className="bullet-text"><span className="label-dim">Extraction batch: </span><span className="val-bright font-mono">{safeAsset.pipelineObservation.extractionBatchId}</span></span></li>
                    </ul>
                    {isHttpUrl(safeAsset.pipelineObservation.sourceUrl) && (
                      <a href={safeAsset.pipelineObservation.sourceUrl} target="_blank" rel="noopener noreferrer" className="clean-doc-link font-mono">
                        <ExternalLink size={11} /><span>Open raw source file ({safeAsset.pipelineObservation.sourceUrl})</span>
                      </a>
                    )}
                    <div className="clean-quote-block">Monthly staged daily-rate field, copied as reported for the latest year/month. No summing, conversion, or facility-level allocation is performed for this map value.</div>
                  </>
                ) : (
                  <div className="clean-quote-block">{safeAsset.pipelineMatchNote || 'No exact source group record was available in the latest staged snapshot. The static production figure is hidden from the map.'}</div>
                )}
              </section>
            )}

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
                <SourceLinkChips links={itemSourceLinks} variant="chips" showHost className="inspector-inline-sources" />
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
                {produceSourceDoc || 'No source document is assigned to this map record.'}
              </div>

              {isHttpUrl(produceSourceUrl) ? (
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
              ) : (
                <SourceLinkChips links={itemSourceLinks} variant="list" />
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
                {produceQuote ? `“${produceQuote}”` : 'No verbatim production quote is recorded for this map record.'}
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
                {transportSourceDoc || 'No transport source document is assigned to this map record.'}
              </div>

              {isHttpUrl(transportSourceUrl) ? (
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
              ) : (
                <SourceLinkChips links={itemSourceLinks} variant="list" />
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
                {transportQuote ? `“${transportQuote}”` : 'No verbatim transport quote is recorded for this map record.'}
              </div>
            </section>

            {/* Mandate Note */}
            <div className="mandate-note-card font-mono">
              {safeRoute?.isDemoPath ? (
                <>
                  <span className="font-bold text-white">OPTION B DEMO PROXY NOTICE:</span>
                  {' '}No public origin-to-depot manifest exists for this regional feeder (`DATA_GAP`); excluded from verified LCI inventory totals.
                  <SourceLinkChips links={itemSourceLinks} variant="chips" showHost className="inspector-inline-sources" />
                </>
              ) : (
                <>
                  <span className="font-bold text-white">SOURCE TRACEABILITY:</span>
                  {' '}Citations and search anchors are shown where available. Processed observations, curated map references, estimated factors, and proxy routes are distinct data types; the source link does not by itself prove every calculated LCI value.
                  <SourceLinkChips links={itemSourceLinks} variant="chips" showHost className="inspector-inline-sources" />
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
                  REGULATED AIR POLLUTANTS (
                  <a
                    href={VERIFIED_SOURCE_LINKS['EMEP-2023'].url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="source-inline-link"
                  >
                    EMEP/EEA 2023
                  </a>
                  )
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
              <SourceLinkChips
                links={[VERIFIED_SOURCE_LINKS['EMEP-2023'], VERIFIED_SOURCE_LINKS['TGO-CFO'], ...itemSourceLinks]}
                variant="chips"
                showHost
                className="inspector-inline-sources"
              />
            </div>
          </div>
        )}
      </div>

      {/* 6. Footer Ledger */}
      <footer className="inspector-footer-line">
        <span className="font-mono text-muted">
          SOURCE WEBPAGES{isAsset && asset?.sourceId ? ` (${asset.sourceId})` : isCoastal && coastal?.sourceId ? ` (${coastal.sourceId})` : ''}
        </span>
        <SourceLinkChips links={itemSourceLinks} variant="chips" showHost={false} />
      </footer>
    </aside>
  );
};
