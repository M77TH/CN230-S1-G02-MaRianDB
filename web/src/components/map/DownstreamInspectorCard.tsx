import React, { useState } from 'react';
import { X, Fuel, Route as RouteIcon, ShieldCheck, Calculator, Copy, Check, MapPin } from 'lucide-react';
import { getProvinceDepotId, type DoebDepotCluster, type ProvinceDownstreamRecord } from '../../data/thailandDownstreamData';
import { useWebsiteData } from '../../data/websiteData';
import { DepotScenario } from '../../utils/mapThemes';
import { VERIFIED_SOURCE_LINKS } from '../../utils/sourceLinks';
import { SourceLinkChips } from './SourceLinkChips';

interface DownstreamInspectorCardProps {
  mode: 'province' | 'depot';
  province?: ProvinceDownstreamRecord;
  depot?: DoebDepotCluster;
  scenario: DepotScenario;
  onClose: () => void;
  onSelectProvince?: (prov: ProvinceDownstreamRecord) => void;
  onSelectDepot?: (dep: DoebDepotCluster) => void;
}

export const DownstreamInspectorCard: React.FC<DownstreamInspectorCardProps> = ({
  mode,
  province,
  depot,
  scenario,
  onClose,
  onSelectProvince,
  onSelectDepot
}) => {
  const { catalog } = useWebsiteData();
  const { depotClusters: DOEB_REGIONAL_CLUSTERS, provinceData: PROVINCE_DOWNSTREAM_DATA } = catalog!.data.downstream;
  const [activeTab, setActiveTab] = useState<'profile' | 'audit' | 'lci'>('profile');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const handleCopy = (val: string, key: string) => {
    navigator.clipboard.writeText(val);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1600);
  };

  const isProvince = mode === 'province' && Boolean(province);
  const titleEn = isProvince
    ? `${province!.provinceEn} Last-Mile Hub`
    : `${depot!.province} Regional Depot (${depot!.id})`;
  const titleTh = isProvince
    ? `จ.${province!.provinceTh} · ศูนย์กระจาย ${province!.hubAmphoe}`
    : `${depot!.repCompany} · อ.${depot!.amphoe} จ.${depot!.province}`;

  const matchedHub = isProvince
    ? DOEB_REGIONAL_CLUSTERS.find((d) => d.id === getProvinceDepotId(province!, scenario))
    : depot;

  const activeKm = isProvince
    ? scenario === 'baseline2'
      ? province!.baseline2CentralKm
      : scenario === 'all44'
      ? province!.allDoebKm
      : province!.tier1Km
    : 0;

  const activeCo2 = isProvince
    ? scenario === 'baseline2'
      ? province!.baseline2CentralKgCo2eL
      : scenario === 'all44'
      ? province!.allDoebKgCo2eL
      : province!.tier1KgCo2eL
    : 0;

  const servedProvinces = !isProvince && depot
    ? PROVINCE_DOWNSTREAM_DATA.filter((p) => getProvinceDepotId(p, scenario) === depot.id)
    : [];

  return (
    <aside className="clean-inspector-card" aria-label="Downstream Traceability Dossier">
      {/* 1. Header Row */}
      <div className="inspector-top-bar">
        <div className="inspector-tag-cluster">
          <span className="mono-badge-tag font-mono">
            {isProvince ? 'P11 / P17 · LAST-MILE' : 'P11 · DOEB DEPOT'}
          </span>
          <span className="mono-category-text font-mono">
            {isProvince ? `PROVINCE ${province!.proCode}` : `${depot!.depotCount} LICENSES`}
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

      {/* 2. Title */}
      <div className="inspector-title-block">
        <h1 className="title-primary font-sans">{titleEn}</h1>
        <h2 className="title-secondary font-sans">{titleTh}</h2>
      </div>

      {/* 3. Node Bar */}
      <div className="facility-index-nav">
        <span className="facility-node-id font-mono">
          {isProvince ? `ISO-TH-${province!.proCode} · ${province!.region}` : `CLUSTER ${depot!.id} · ${depot!.region}`}
        </span>
        {isProvince && matchedHub && onSelectDepot && (
          <button
            type="button"
            className="facility-index-trigger font-mono"
            onClick={() => onSelectDepot(matchedHub)}
          >
            Inspect {matchedHub.id} ↗
          </button>
        )}
      </div>

      {/* 4. Tabs */}
      <nav className="inspector-tab-nav" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'profile'}
          className={`tab-btn ${activeTab === 'profile' ? 'active' : ''}`}
          onClick={() => setActiveTab('profile')}
        >
          <span>Regional Profile</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'audit'}
          className={`tab-btn ${activeTab === 'audit' ? 'active' : ''}`}
          onClick={() => setActiveTab('audit')}
        >
          <span>Source Proof</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'lci'}
          className={`tab-btn ${activeTab === 'lci' ? 'active' : ''}`}
          onClick={() => setActiveTab('lci')}
        >
          <span>Valhalla LCI</span>
        </button>
      </nav>

      {/* 5. Content */}
      <div className="inspector-scroll-area">
        {activeTab === 'profile' && isProvince && province && (
          <div className="tab-pane">
            <section className="clean-section-card">
              <div className="card-header-line">
                <Fuel size={13} color="#43542d" />
                <span className="card-header-title font-mono">DOEB & RML STATION DENSITY</span>
              </div>
              <div className="table-rows">
                <div className="table-row-item">
                  <span className="table-key font-mono">DOEB STATIONS</span>
                  <span className="table-val font-mono font-bold">
                    {province.doebStations.toLocaleString()} stations
                  </span>
                </div>
                <div className="table-row-item">
                  <span className="table-key font-mono">OIL VEHICLES (DLT)</span>
                  <span className="table-val font-mono">
                    {province.rmlOilVehicles.toLocaleString()} vehicles
                  </span>
                </div>
                <div className="table-row-item">
                  <span className="table-key font-mono">VEHICLES / PUMP</span>
                  <span className="table-val font-mono font-bold">
                    {province.vehiclesPerStation.toLocaleString()} : 1
                  </span>
                </div>
                <div className="table-row-item">
                  <span className="table-key font-mono">OSM MAPPED RATIO</span>
                  <span className="table-val font-mono">
                    {province.osmFuel} / {province.doebStations} ({province.osmCoveragePct}%)
                  </span>
                </div>
              </div>
              <SourceLinkChips
                links={[
                  VERIFIED_SOURCE_LINKS['TSRC-47'],
                  VERIFIED_SOURCE_LINKS['TSRC-48'],
                  VERIFIED_SOURCE_LINKS['TSRC-49'],
                  VERIFIED_SOURCE_LINKS['TSRC-54']
                ]}
                variant="chips"
                showHost
                className="inspector-inline-sources"
              />
            </section>

            <section className="clean-section-card">
              <div className="card-header-line">
                <RouteIcon size={13} color="#ca6248" />
                <span className="card-header-title font-mono">REGIONAL HUB ROUTING COMPARISON</span>
              </div>
              <div className="table-rows">
                <div className="table-row-item">
                  <span className="table-key font-mono">TIER-1 REGIONAL HUB</span>
                  <span className="table-val font-mono font-semibold">
                    {province.tier1NearestHub} ({province.tier1HubCompany}, {province.tier1HubMl.toFixed(1)} ML)
                  </span>
                </div>
                <div className="table-row-item">
                  <span className="table-key font-mono">TIER-1 ROAD DISTANCE</span>
                  <span className="table-val font-mono font-bold text-emerald">
                    {province.tier1Km.toFixed(2)} km ({province.tier1Min.toFixed(0)} min)
                  </span>
                </div>
                <div className="table-row-item">
                  <span className="table-key font-mono">2-CENTRAL BASELINE</span>
                  <span className="table-val font-mono">
                    {province.baseline2CentralHub} · {province.baseline2CentralKm.toFixed(2)} km
                  </span>
                </div>
                <div className="table-row-item">
                  <span className="table-key font-mono">COASTAL/REGIONAL GAIN</span>
                  <span className="table-val font-mono font-bold text-cyan">
                    -{Math.max(0, -province.deltaVsBaselineKm).toFixed(1)} km road saved
                  </span>
                </div>
              </div>
              <SourceLinkChips
                links={[
                  VERIFIED_SOURCE_LINKS['TSRC-50'],
                  VERIFIED_SOURCE_LINKS['TSRC-53'],
                  VERIFIED_SOURCE_LINKS['THAPPLINE-SPRC']
                ]}
                variant="chips"
                showHost
                className="inspector-inline-sources"
              />
            </section>
          </div>
        )}

        {activeTab === 'profile' && !isProvince && depot && (
          <div className="tab-pane">
            <section className="clean-section-card">
              <div className="card-header-line">
                <MapPin size={13} color="#517b9d" />
                <span className="card-header-title font-mono">DOEB SECTION 7 & 16 CLUSTER</span>
              </div>
              <div className="table-rows">
                <div className="table-row-item">
                  <span className="table-key font-mono">CLUSTER ID</span>
                  <div className="table-val-group">
                    <span className="table-val font-mono font-bold text-cyan">{depot.id}</span>
                    <button
                      type="button"
                      className="clean-copy-btn"
                      onClick={() => handleCopy(depot.id, 'dep-id')}
                      title="Copy ID"
                    >
                      {copiedKey === 'dep-id' ? <Check size={11} className="text-emerald" /> : <Copy size={11} />}
                    </button>
                  </div>
                </div>
                <div className="table-row-item">
                  <span className="table-key font-mono">LICENSED STORAGE</span>
                  <span className="table-val font-mono font-bold">
                    {depot.totalMl.toLocaleString()} ML
                  </span>
                </div>
                <div className="table-row-item">
                  <span className="table-key font-mono">FACILITIES / OPERATOR</span>
                  <span className="table-val font-mono">
                    {depot.depotCount} depot(s) · {depot.repCompany}
                  </span>
                </div>
                <div className="table-row-item">
                  <span className="table-key font-mono">TIER CLASSIFICATION</span>
                  <span className="table-val font-mono">
                    {depot.isBaselineCentral
                      ? 'Baseline Central Hub (Thappline)'
                      : depot.isMajorOil
                      ? 'Tier-1 Major Oil Hub (≥10 ML)'
                      : 'Secondary Section 16 Depot'}
                  </span>
                </div>
                <div className="table-row-item">
                  <span className="table-key font-mono">LICENSE CODE</span>
                  <span className="table-val font-mono">{depot.repLicense}</span>
                </div>
              </div>
              <SourceLinkChips
                links={[
                  VERIFIED_SOURCE_LINKS['TSRC-50'],
                  ...(depot.isBaselineCentral ? [VERIFIED_SOURCE_LINKS['THAPPLINE-SPRC']] : [])
                ]}
                variant="chips"
                showHost
                className="inspector-inline-sources"
              />
            </section>

            {servedProvinces.length > 0 && onSelectProvince && (
              <section className="clean-section-card">
                <div className="card-header-line">
                  <RouteIcon size={13} color="#43542d" />
                  <span className="card-header-title font-mono">
                    PROVINCES SERVED VIA NEAREST TIER-1 ({servedProvinces.length})
                  </span>
                </div>
                <div className="served-prov-chips">
                  {servedProvinces.map((p) => (
                    <button
                      key={p.proCode}
                      type="button"
                      className="served-prov-chip font-mono"
                      onClick={() => onSelectProvince(p)}
                    >
                      <span>{p.provinceEn}</span>
                      <span className="chip-km">{p.tier1Km.toFixed(0)} km</span>
                    </button>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {activeTab === 'audit' && (
          <div className="tab-pane">
            <section className="clean-section-card">
              <div className="card-header-line">
                <ShieldCheck size={13} color="#43542d" />
                <span className="card-header-title font-mono">VERIFIED LEVEL-1 PRIMARY REGISTRY</span>
              </div>
              <div className="evidence-box-clean">
                <div className="evidence-row-top">
                  <span className="source-label-badge font-mono">TSRC-47 / 48 / 49</span>
                  <span className="ctrl-f-chip font-mono">DOEB Sec 11 + RML + DLT</span>
                </div>
                <p className="evidence-doc-name">
                  Rocket Media Lab x DOEB (25,310 national fuel stations) + DLT (44,839,553 fuel vehicles, retrieved 17 Mar 2026)
                </p>
                <SourceLinkChips
                  links={[
                    VERIFIED_SOURCE_LINKS['TSRC-47'],
                    VERIFIED_SOURCE_LINKS['TSRC-48'],
                    VERIFIED_SOURCE_LINKS['TSRC-49']
                  ]}
                  variant="list"
                />
              </div>
              <div className="evidence-box-clean" style={{ marginTop: 8 }}>
                <div className="evidence-row-top">
                  <span className="source-label-badge font-mono">TSRC-50</span>
                  <span className="ctrl-f-chip font-mono">DOEB Sec 7/16 Depots</span>
                </div>
                <p className="evidence-doc-name">
                  Department of Energy Business official registry — 188 petroleum storage depots totaling 18,390.81 ML (10,678.34 ML liquid oil)
                </p>
                <SourceLinkChips
                  links={[
                    VERIFIED_SOURCE_LINKS['TSRC-50'],
                    VERIFIED_SOURCE_LINKS['TSRC-50-XLSX']
                  ]}
                  variant="list"
                />
              </div>
              <div className="evidence-box-clean" style={{ marginTop: 8 }}>
                <div className="evidence-row-top">
                  <span className="source-label-badge font-mono">TSRC-53</span>
                  <span className="ctrl-f-chip font-mono">OSM Valhalla Graph</span>
                </div>
                <p className="evidence-doc-name">
                  OSRM/Valhalla heavy-truck road routing across all 77 provincial Amphoe Muang centroids vs LCX-026 200 km national assumption
                </p>
                <SourceLinkChips
                  links={[
                    VERIFIED_SOURCE_LINKS['TSRC-53'],
                    VERIFIED_SOURCE_LINKS['TSRC-53-API'],
                    VERIFIED_SOURCE_LINKS['TGO-CFO']
                  ]}
                  variant="list"
                />
              </div>
            </section>
          </div>
        )}

        {activeTab === 'lci' && (
          <div className="tab-pane">
            <section className="clean-section-card">
              <div className="card-header-line">
                <Calculator size={13} color="#ca6248" />
                <span className="card-header-title font-mono">LEVEL-2 VALHALLA EMISSION MATH</span>
              </div>
              {isProvince && province ? (
                <div className="table-rows">
                  <div className="table-row-item">
                    <span className="table-key font-mono">TRUCK EF (EMEP/TGO)</span>
                    <span className="table-val font-mono">0.0677 kgCO₂e / t·km</span>
                  </div>
                  <div className="table-row-item">
                    <span className="table-key font-mono">DIESEL MASS / LITRE</span>
                    <span className="table-val font-mono">0.000835 tonne / L (0.835 kg/L)</span>
                  </div>
                  <div className="table-row-item">
                    <span className="table-key font-mono">ROUND-TRIP FACTOR</span>
                    <span className="table-val font-mono">2× empty-return tanker adjustment</span>
                  </div>
                  <div className="table-row-item">
                    <span className="table-key font-mono">ACTIVE SCENARIO ({scenario.toUpperCase()})</span>
                    <span className="table-val font-mono font-bold text-cyan">
                      {activeKm.toFixed(2)} km → {activeCo2.toFixed(6)} kgCO₂e/L
                    </span>
                  </div>
                  <div className="table-row-item">
                    <span className="table-key font-mono">2-CENTRAL VS TIER-1</span>
                    <span className="table-val font-mono">
                      {province.baseline2CentralKgCo2eL.toFixed(6)} vs {province.tier1KgCo2eL.toFixed(6)} kgCO₂e/L
                    </span>
                  </div>
                  <div className="table-row-item">
                    <span className="table-key font-mono">LCX-026 MODEL DELTA</span>
                    <span className="table-val font-mono">
                      {(activeKm - 200).toFixed(1)} km ({activeCo2 >= 0.00677 ? '+' : ''}
                      {(activeCo2 - 0.00677).toFixed(6)} kgCO₂e/L)
                    </span>
                  </div>
                </div>
              ) : (
                <div className="table-rows">
                  <div className="table-row-item">
                    <span className="table-key font-mono">NATIONAL WEIGHTED (31 HUBS)</span>
                    <span className="table-val font-mono font-bold text-emerald">
                      78.57 km · 0.002660 kgCO₂e/L
                    </span>
                  </div>
                  <div className="table-row-item">
                    <span className="table-key font-mono">2-CENTRAL BASELINE</span>
                    <span className="table-val font-mono">
                      377.45 km · 0.012778 kgCO₂e/L
                    </span>
                  </div>
                  <div className="table-row-item">
                    <span className="table-key font-mono">LCX-026 ASSUMPTION</span>
                    <span className="table-val font-mono">
                      200.00 km · 0.006770 kgCO₂e/L
                    </span>
                  </div>
                  <div className="table-row-item">
                    <span className="table-key font-mono">COASTAL TANKER SUBSTITUTE</span>
                    <span className="table-val font-mono">
                      342 nm (633 km) Sriracha → Songkhla/Surat
                    </span>
                  </div>
                </div>
              )}
              <SourceLinkChips
                links={[
                  VERIFIED_SOURCE_LINKS['EMEP-2023'],
                  VERIFIED_SOURCE_LINKS['TGO-CFO'],
                  VERIFIED_SOURCE_LINKS['TSRC-36'],
                  VERIFIED_SOURCE_LINKS['TSRC-58']
                ]}
                variant="chips"
                showHost
                className="inspector-inline-sources"
              />
            </section>
          </div>
        )}
      </div>

      <footer className="inspector-footer-line">
        <span className="font-mono text-muted">SOURCE WEBPAGES</span>
        <SourceLinkChips
          links={[
            VERIFIED_SOURCE_LINKS['TSRC-47'],
            VERIFIED_SOURCE_LINKS['TSRC-50'],
            VERIFIED_SOURCE_LINKS['TSRC-48'],
            VERIFIED_SOURCE_LINKS['TSRC-49'],
            VERIFIED_SOURCE_LINKS['TSRC-53']
          ]}
          variant="chips"
        />
      </footer>
    </aside>
  );
};
