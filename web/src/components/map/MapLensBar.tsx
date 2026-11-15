import React from 'react';
import { Flame, Route as RouteIcon, Waypoints, Layers } from 'lucide-react';
import {
  DepotScenario,
  HeatmapMetric,
  MapViewMode,
  NodeColorMode,
  STAGE_RANGE_OPTIONS,
  StageRange
} from '../../utils/mapThemes';
import { DOWNSTREAM_SUMMARY } from '../../data/thailandDownstreamData';

interface MapLensBarProps {
  hasInspector: boolean;
  viewMode: MapViewMode;
  onViewModeChange: (mode: MapViewMode) => void;
  stageRange: StageRange;
  onStageRangeChange: (range: StageRange) => void;
  nodeColorMode: NodeColorMode;
  onNodeColorModeChange: (mode: NodeColorMode) => void;
  heatmapMetric: HeatmapMetric;
  onHeatmapMetricChange: (metric: HeatmapMetric) => void;
  depotScenario: DepotScenario;
  onDepotScenarioChange: (scenario: DepotScenario) => void;
  showValhallaSpokes: boolean;
  onToggleValhallaSpokes: () => void;
  visibleAssetCount: number;
  visibleRouteCount: number;
}

export const MapLensBar: React.FC<MapLensBarProps> = ({
  hasInspector,
  viewMode,
  onViewModeChange,
  stageRange,
  onStageRangeChange,
  nodeColorMode,
  onNodeColorModeChange,
  heatmapMetric,
  onHeatmapMetricChange,
  depotScenario,
  onDepotScenarioChange,
  showValhallaSpokes,
  onToggleValhallaSpokes,
  visibleAssetCount,
  visibleRouteCount
}) => {
  const activeScenarioKpi =
    depotScenario === 'baseline2'
      ? {
          km: DOWNSTREAM_SUMMARY.baseline_2central.station_weighted_km,
          co2: DOWNSTREAM_SUMMARY.baseline_2central.station_weighted_kgco2e_L,
          tag: 'ศูนย์กลาง 2 แห่ง'
        }
      : depotScenario === 'all44'
      ? {
          km: DOWNSTREAM_SUMMARY.all_doeb_hubs.station_weighted_km,
          co2: DOWNSTREAM_SUMMARY.all_doeb_hubs.station_weighted_kgco2e_L,
          tag: 'คลัง DOEB 44 แห่ง'
        }
      : {
          km: DOWNSTREAM_SUMMARY.tier1_major_hubs.station_weighted_km,
          co2: DOWNSTREAM_SUMMARY.tier1_major_hubs.station_weighted_kgco2e_L,
          tag: 'คลังหลัก 31 แห่ง'
        };

  return (
    <div className={`map-lens-shell ${hasInspector ? 'shifted-right' : ''}`}>
      {/* Primary Top Pill: 2 View Modes + 4 Stage Ranges */}
      <div className="lens-primary-row">
        <div className="lens-mode-switch" role="group" aria-label="รูปแบบการแสดงแผนที่">
          <button
            type="button"
            className={`lens-mode-btn ${viewMode === 'transport' ? 'active' : ''}`}
            onClick={() => onViewModeChange('transport')}
          >
            <RouteIcon size={13} />
            <span>เส้นทางขนส่ง</span>
          </button>
          <button
            type="button"
            className={`lens-mode-btn ${viewMode === 'emissions' ? 'active heat' : ''}`}
            onClick={() => onViewModeChange('emissions')}
          >
            <Flame size={13} />
            <span>CO₂ และความหนาแน่น</span>
          </button>
        </div>

        <div className="lens-divider" />

        <div className="lens-stage-pills" role="group" aria-label="เลือกช่วงกระบวนการ">
          {STAGE_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              className={`lens-stage-btn ${stageRange === opt.id ? 'active' : ''}`}
              onClick={() => onStageRangeChange(opt.id)}
              title={`${opt.processTag}: ${opt.hint}`}
            >
              <span>{opt.label}</span>
              <span className="lens-stage-tag font-mono">{opt.processTag}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Secondary Contextual Pill: Mode-Specific Controls & Live Traceable KPI */}
      <div className="lens-secondary-row">
        {viewMode === 'transport' ? (
          <>
            <div className="lens-chip-group" title="กำหนดสีจุดสถานที่ตามประเภทหรือปริมาณการผลิตพลังงาน">
              <span className="lens-chip-label font-mono">
                <Layers size={11} />
                สี:
              </span>
              <button
                type="button"
                className={`lens-mini-btn ${nodeColorMode === 'category' ? 'active' : ''}`}
                onClick={() => onNodeColorModeChange('category')}
              >
                ประเภท
              </button>
              <button
                type="button"
                className={`lens-mini-btn ${nodeColorMode === 'volume' ? 'active' : ''}`}
                onClick={() => onNodeColorModeChange('volume')}
              >
                ปริมาณผลิต
              </button>
            </div>

            <span className="lens-kpi-badge font-mono">
              {visibleAssetCount} จุด · {visibleRouteCount} เส้นทาง
            </span>
          </>
        ) : (
          <>
            <div className="lens-chip-group" title="แผนที่ความหนาแน่นระดับ 77 จังหวัด">
              <span className="lens-chip-label font-mono">แสดงตาม:</span>
              <button
                type="button"
                className={`lens-mini-btn ${heatmapMetric === 'co2e' ? 'active heat' : ''}`}
                onClick={() => onHeatmapMetricChange('co2e')}
              >
                CO₂e/L รถบรรทุก
              </button>
              <button
                type="button"
                className={`lens-mini-btn ${heatmapMetric === 'stations' ? 'active heat' : ''}`}
                onClick={() => onHeatmapMetricChange('stations')}
              >
                สถานีบริการ
              </button>
              <button
                type="button"
                className={`lens-mini-btn ${heatmapMetric === 'vehiclesPerStation' ? 'active heat' : ''}`}
                onClick={() => onHeatmapMetricChange('vehiclesPerStation')}
              >
                รถ/สถานี
              </button>
            </div>

            <div className="lens-chip-group" title="เปรียบเทียบสถานการณ์คลังจ่ายน้ำมัน">
              <span className="lens-chip-label font-mono">คลัง:</span>
              <button
                type="button"
                className={`lens-mini-btn ${depotScenario === 'tier1' ? 'active' : ''}`}
                onClick={() => onDepotScenarioChange('tier1')}
              >
                31 คลังหลัก
              </button>
              <button
                type="button"
                className={`lens-mini-btn ${depotScenario === 'all44' ? 'active' : ''}`}
                onClick={() => onDepotScenarioChange('all44')}
              >
                44 แห่ง
              </button>
              <button
                type="button"
                className={`lens-mini-btn ${depotScenario === 'baseline2' ? 'active warn' : ''}`}
                onClick={() => onDepotScenarioChange('baseline2')}
              >
                2 ศูนย์กลาง
              </button>
            </div>

            <button
              type="button"
              className={`lens-toggle-pill ${showValhallaSpokes ? 'on' : ''}`}
              onClick={onToggleValhallaSpokes}
              title="แสดงหรือซ่อนเส้นทางจากคลัง DOEB ไปยังทั้ง 77 จังหวัด"
            >
              <Waypoints size={12} />
              <span>เส้นทาง 77 จังหวัด</span>
            </button>

            <span className="lens-kpi-badge font-mono">
              {activeScenarioKpi.km.toFixed(1)} km · {activeScenarioKpi.co2.toFixed(6)} kgCO₂e/L
            </span>
          </>
        )}
      </div>
    </div>
  );
};
