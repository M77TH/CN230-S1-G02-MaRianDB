import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Check, ExternalLink } from 'lucide-react';
import type { AssetCategory, AssetStage, InfrastructureAsset } from '../../types/asset';
import { useWebsiteData } from '../../data/websiteData';
import { RouteMode } from '../../types/route';
import { EncodingMode } from '../../utils/lci';
import { resolveSourceIds, VERIFIED_SOURCE_LINKS } from '../../utils/sourceLinks';
import { SourceLinkChips } from './SourceLinkChips';
import {
  DepotScenario,
  HeatmapMetric,
  LIGHT_CATEGORY_COLORS,
  LIGHT_ROUTE_COLORS,
  MapViewMode,
  NodeColorMode
} from '../../utils/mapThemes';

export type FilterCategory =
  | 'all'
  | 'upstream'
  | 'refinery'
  | 'gsp'
  | 'power'
  | 'oil'
  | 'gas'
  | 'depot'
  | 'airport'
  | 'petchem';

const FLOW_STAGE_ORDER: AssetStage[] = ['upstream', 'midstream', 'downstream'];

const getCategoryFlowStage = (category: AssetCategory, infrastructureAssets: InfrastructureAsset[]): AssetStage => {
  const stageCounts = FLOW_STAGE_ORDER.map((stage) => ({
    stage,
    count: infrastructureAssets.filter(
      (asset) => asset.category === category && asset.stage === stage
    ).length
  }));
  return stageCounts.reduce((dominant, current) =>
    current.count > dominant.count ? current : dominant
  ).stage;
};

interface MapLegendDockProps {
  activeFilter: FilterCategory;
  onFilterChange: (cat: FilterCategory) => void;
  showLocations: boolean;
  allLocationsSelected: boolean;
  allPathsSelected: boolean;
  onSelectAllLocations: () => void;
  onUnselectAllLocations: () => void;
  onSelectAllPaths: () => void;
  onUnselectAllPaths: () => void;
  routeVisibility: Record<RouteMode, boolean>;
  onToggleRouteMode: (mode: RouteMode) => void;
  hideNames: boolean;
  autoHideNames: boolean;
  onToggleHideNames: () => void;
  encoding: EncodingMode;
  onEncodingChange: (enc: EncodingMode) => void;
  ghgRange: { min: number; max: number };
  assetCounts: Record<AssetCategory, number>;
  viewMode: MapViewMode;
  nodeColorMode: NodeColorMode;
  onNodeColorModeChange: (mode: NodeColorMode) => void;
  heatmapMetric: HeatmapMetric;
  depotScenario: DepotScenario;
}

export const MapLegendDock: React.FC<MapLegendDockProps> = ({
  activeFilter,
  onFilterChange,
  showLocations,
  allLocationsSelected,
  allPathsSelected,
  onSelectAllLocations,
  onUnselectAllLocations,
  onSelectAllPaths,
  onUnselectAllPaths,
  routeVisibility,
  onToggleRouteMode,
  hideNames,
  autoHideNames,
  onToggleHideNames,
  encoding,
  onEncodingChange,
  ghgRange,
  assetCounts,
  viewMode,
  nodeColorMode,
  onNodeColorModeChange,
  heatmapMetric,
  depotScenario
}) => {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const { catalog } = useWebsiteData();
  const infrastructureAssets = catalog!.data.assets;

  const facilityItems: {
    id: string;
    color: string;
    titleTh: string;
    category: FilterCategory;
    count: number;
    flowStage: AssetStage;
  }[] = [
    { id: 'oil', color: LIGHT_CATEGORY_COLORS.oil, titleTh: 'แหล่งน้ำมันดิบและคอนเดนเสท', category: 'oil', count: assetCounts.oil, flowStage: getCategoryFlowStage('oil', infrastructureAssets) },
    { id: 'gas', color: LIGHT_CATEGORY_COLORS.gas, titleTh: 'แหล่งก๊าซธรรมชาติและแท่นผลิต', category: 'gas', count: assetCounts.gas, flowStage: getCategoryFlowStage('gas', infrastructureAssets) },
    { id: 'refinery', color: LIGHT_CATEGORY_COLORS.refinery, titleTh: 'โรงกลั่นน้ำมัน', category: 'refinery', count: assetCounts.refinery, flowStage: getCategoryFlowStage('refinery', infrastructureAssets) },
    { id: 'gsp', color: LIGHT_CATEGORY_COLORS.gsp, titleTh: 'โรงแยกก๊าซธรรมชาติ (GSP)', category: 'gsp', count: assetCounts.gsp, flowStage: getCategoryFlowStage('gsp', infrastructureAssets) },
    { id: 'power', color: LIGHT_CATEGORY_COLORS.power, titleTh: 'โรงไฟฟ้าน้ำพอง (ประตูปลายทาง)', category: 'power', count: infrastructureAssets.filter((asset) => asset.id === 'GATE-EGAT-NP').length, flowStage: 'downstream' }
  ];

  const routeItems: {
    id: string;
    color: string;
    titleTh: string;
    type: 'line-solid' | 'line-dashed';
    mode: RouteMode;
  }[] = [
    { id: 'subsea', mode: 'subsea-gas', color: LIGHT_ROUTE_COLORS['subsea-gas'], titleTh: 'ท่อส่งก๊าซใต้ทะเล', type: 'line-solid' },
    { id: 'onshore-gas', mode: 'onshore-gas', color: LIGHT_ROUTE_COLORS['onshore-gas'], titleTh: 'โครงข่ายท่อก๊าซบนบก', type: 'line-solid' },
    { id: 'onshore-oil', mode: 'onshore-oil', color: LIGHT_ROUTE_COLORS['onshore-oil'], titleTh: 'ท่อน้ำมันและผลิตภัณฑ์บนบก', type: 'line-solid' },
    { id: 'marine', mode: 'marine-tanker', color: LIGHT_ROUTE_COLORS['marine-tanker'], titleTh: 'เรือขนส่งทางทะเลและชายฝั่ง', type: 'line-dashed' },
    { id: 'rail', mode: 'crude-rail', color: LIGHT_ROUTE_COLORS['crude-rail'], titleTh: 'รถไฟขนส่งน้ำมันดิบ (รฟท.)', type: 'line-dashed' },
    { id: 'road', mode: 'road-truck', color: LIGHT_ROUTE_COLORS['road-truck'], titleTh: 'รถบรรทุกน้ำมันทางถนน', type: 'line-dashed' }
  ];

  const heatmapMeta = heatmapMetric === 'co2e'
    ? catalog!.data.mapConfig.heatmapLegends.co2e[depotScenario]
    : catalog!.data.mapConfig.heatmapLegends[heatmapMetric].default;

  return (
    <div className="legend-dock-wrapper">
      <button
        type="button"
        className={`hide-names-pill font-mono ${hideNames || autoHideNames ? 'active' : ''}`}
        onClick={onToggleHideNames}
        disabled={autoHideNames}
        title={autoHideNames ? 'ซ่อนชื่ออัตโนมัติเมื่อซูมออกในระดับภูมิภาค' : 'แสดงหรือซ่อนชื่อสถานที่บนแผนที่'}
      >
        <span className={`checkbox-box ${hideNames || autoHideNames ? 'checked' : ''}`}>
          {(hideNames || autoHideNames) && <Check size={11} strokeWidth={3} />}
        </span>
        <span>{autoHideNames ? 'ซ่อนชื่ออัตโนมัติ' : hideNames ? 'แสดงชื่อบนแผนที่' : 'ซ่อนชื่อบนแผนที่'}</span>
      </button>

      <aside className={`legend-card ${isCollapsed ? 'is-collapsed' : ''}`} aria-label="คำอธิบายสัญลักษณ์และตัวควบคุมแผนที่">
        <div className="legend-header-row">
          <div className="legend-title font-mono">
            {viewMode === 'emissions' ? 'การปล่อยและความหนาแน่น' : 'สัญลักษณ์และชั้นข้อมูล'}
          </div>
          <button
            type="button"
            className="legend-collapse-btn font-mono"
            onClick={() => setIsCollapsed(!isCollapsed)}
            title={isCollapsed ? 'ขยายแผง' : 'ย่อแผง'}
          >
            {isCollapsed ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>

        {isCollapsed && (
          <div className="legend-quick-key">
            <span className="legend-quick-key-item">
              <i className="legend-flow-symbol flow-upstream" />
              ต้นน้ำ
            </span>
            <span className="legend-quick-key-item">
              <i className="legend-flow-symbol flow-midstream" />
              กลางน้ำ
            </span>
            <span className="legend-quick-key-item">
              <i className="legend-flow-symbol flow-downstream" />
              ปลายน้ำ
            </span>
            <span className="legend-quick-key-item">
              {viewMode === 'emissions' ? <i className="legend-quick-heat" /> : <i className="legend-quick-line" />}
              {viewMode === 'emissions' ? 'สีพื้นที่ = ความหนาแน่น' : 'เส้น = เส้นทาง'}
            </span>
          </div>
        )}

        {!isCollapsed && (
          <>
            {viewMode === 'emissions' ? (
              <div className="heatmap-legend-block">
                <div className="heatmap-legend-title">{heatmapMeta.title}</div>
                <div className="heatmap-stops-grid">
                  {heatmapMeta.stops.map((stop) => (
                    <div key={stop.label} className="heatmap-stop-chip">
                      <span className="heatmap-swatch" style={{ backgroundColor: stop.color }} />
                      <span className="heatmap-stop-label font-mono">{stop.label}</span>
                    </div>
                  ))}
                </div>
                <div className="heatmap-source-line font-mono">
                  <span>{heatmapMeta.source}</span>
                  <SourceLinkChips
                    links={resolveSourceIds(heatmapMeta.sourceIds, catalog!.data.sourceCards)}
                    variant="chips"
                    showHost
                    className="heatmap-source-chips"
                  />
                </div>

                <div className="legend-section-label font-mono" style={{ marginTop: 10 }}>
                  การปล่อยของเส้นทาง (กก.CO₂e/ตัน·กม.)
                </div>
                <div className="emission-ramp-container" style={{ marginTop: 4, marginBottom: 8 }}>
                  <div className="emission-gradient-bar light-gradient" />
                  <div className="emission-ramp-labels font-mono">
                    <span>{ghgRange.min.toFixed(3)} (ท่อ)</span>
                    <span>{(ghgRange.max / 2).toFixed(3)} (ราง)</span>
                    <span>{ghgRange.max.toFixed(3)} (รถบรรทุก)</span>
                  </div>
                </div>
              </div>
            ) : (
              <>
                <div className="encoding-group">
                  <div className="encoding-label font-mono">กำหนดสีสัญลักษณ์</div>
                  <div className="encoding-toggle-row">
                    <button
                      type="button"
                      className={`enc-btn ${nodeColorMode === 'category' ? 'active' : ''}`}
                      onClick={() => {
                        onNodeColorModeChange('category');
                        onEncodingChange('throughput');
                      }}
                    >
                      ประเภท
                    </button>
                    <button
                      type="button"
                      className={`enc-btn ${nodeColorMode === 'volume' ? 'active' : ''}`}
                      onClick={() => {
                        onNodeColorModeChange('volume');
                        onEncodingChange('throughput');
                      }}
                    >
                      ปริมาณ (GJ/วัน)
                    </button>
                    <button
                      type="button"
                      className={`enc-btn ${nodeColorMode === 'emissions' ? 'active heat' : ''}`}
                      onClick={() => {
                        onNodeColorModeChange('emissions');
                        onEncodingChange('emissions');
                      }}
                    >
                      ก๊าซเรือนกระจก
                    </button>
                  </div>

                  {nodeColorMode === 'volume' && (
                    <div className="volume-ramp-note font-mono">
                      <span className="volume-chip"><i style={{ background: '#43542d' }} />สูงมาก (&gt;300k GJ/วัน)</span>
                      <span className="volume-chip"><i style={{ background: '#667844' }} />สูง</span>
                      <span className="volume-chip"><i style={{ background: '#0f766e' }} />ปานกลาง</span>
                      <span className="volume-chip"><i style={{ background: '#94a3b8' }} />ต่ำ</span>
                    </div>
                  )}

                  {encoding === 'emissions' && nodeColorMode === 'emissions' && (
                    <div className="emission-ramp-container">
                      <div className="emission-gradient-bar light-gradient" />
                      <div className="emission-ramp-labels font-mono">
                        <span>{ghgRange.min.toFixed(3)}</span>
                        <span>kgCO₂e/t·km</span>
                        <span>{ghgRange.max.toFixed(3)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="legend-section-heading">
              <div className="legend-section-label font-mono">
                {activeFilter !== 'all' ? (
                  <button
                    type="button"
                    className="filter-reset-link"
                    onClick={() => onFilterChange('all')}
                  >
                    ↺ ล้างตัวกรองประเภท
                  </button>
                ) : (
                  'สถานที่ในระบบ'
                )}
              </div>
              <div className="legend-section-actions">
                <button
                  type="button"
                  className="legend-section-action font-mono"
                  onClick={allLocationsSelected ? onUnselectAllLocations : onSelectAllLocations}
                  aria-pressed={allLocationsSelected}
                  title={allLocationsSelected ? 'ซ่อนสถานที่ทั้งหมด' : 'แสดงสถานที่ทั้งหมด'}
                >
                  {allLocationsSelected ? 'ล้างทั้งหมด' : 'เลือกทั้งหมด'}
                </button>
              </div>
            </div>
            <ul className="legend-bullets">
              {facilityItems.map((item) => {
                const isSelected = showLocations && activeFilter === item.category;
                const isFaded = !showLocations || (activeFilter !== 'all' && !isSelected);
                return (
                  <React.Fragment key={item.id}>
                    <li>
                      <button
                        type="button"
                        className={`legend-bullet-btn ${isSelected ? 'selected' : ''} ${isFaded ? 'faded' : ''}`}
                        onClick={() => onFilterChange(isSelected ? 'all' : item.category)}
                      >
                        <span className="bullet-flow-shapes" aria-hidden="true">
                          <i className={`bullet-swatch flow-${item.flowStage}`} style={{ backgroundColor: item.color }} />
                        </span>
                        <span className="bullet-text">
                          <span className="bullet-en">{item.titleTh}</span>
                        </span>
                        <span className="bullet-count font-mono">{item.count}</span>
                      </button>
                    </li>
                  </React.Fragment>
                );
              })}
            </ul>

            <div className="legend-section-heading" style={{ marginTop: 10 }}>
              <div className="legend-section-label font-mono">เส้นทางลำเลียง</div>
              <div className="legend-section-actions">
                <button
                  type="button"
                  className="legend-section-action font-mono"
                  onClick={allPathsSelected ? onUnselectAllPaths : onSelectAllPaths}
                  aria-pressed={allPathsSelected}
                  title={allPathsSelected ? 'ซ่อนเส้นทางทั้งหมด' : 'แสดงเส้นทางทั้งหมด'}
                >
                  {allPathsSelected ? 'ล้างทั้งหมด' : 'เลือกทั้งหมด'}
                </button>
              </div>
            </div>
            <ul className="legend-bullets">
              {routeItems.map((item) => (
                <li key={item.id} className={item.mode === 'crude-rail' ? 'legend-bullet-row' : undefined}>
                  <button
                    type="button"
                    className={`legend-bullet-btn ${!routeVisibility[item.mode] ? 'faded' : ''}`}
                    onClick={() => onToggleRouteMode(item.mode)}
                    aria-pressed={routeVisibility[item.mode]}
                  >
                    <span
                      className={`bullet-line ${item.type === 'line-dashed' ? 'dashed' : 'solid'}`}
                      style={{
                        borderColor: item.color,
                        backgroundColor: item.type === 'line-solid' ? item.color : 'transparent',
                        color: item.color
                      }}
                    />
                    <span className="bullet-text">
                      <span className="bullet-en">{item.titleTh}</span>
                    </span>
                    <span className="bullet-count font-mono">{routeVisibility[item.mode] ? 'เปิด' : 'ปิด'}</span>
                  </button>
                  {item.mode === 'crude-rail' && (
                    <a
                      href={VERIFIED_SOURCE_LINKS['PTTEP-S1'].url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="legend-ext-link"
                      title={`เปิดแหล่งข้อมูล ${VERIFIED_SOURCE_LINKS['PTTEP-S1'].label} (${VERIFIED_SOURCE_LINKS['PTTEP-S1'].url})`}
                    >
                      <ExternalLink size={11} />
                    </a>
                  )}
                </li>
              ))}
            </ul>

          </>
        )}
      </aside>
    </div>
  );
};
