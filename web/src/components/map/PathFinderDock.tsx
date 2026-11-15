import React, { useState, useMemo } from 'react';
import {
  GitMerge,
  ArrowRight,
  ArrowLeftRight,
  X,
  Compass,
  Navigation,
  Activity,
  Flame,
  Zap,
  Sparkles,
  ChevronDown,
  ChevronUp
} from 'lucide-react';
import { InfrastructureAsset } from '../../types/asset';
import { findPath, PathResult, PRESET_ROUTES } from '../../utils/networkGraph';

interface PathFinderDockProps {
  allAssets: InfrastructureAsset[];
  activePath: PathResult | null;
  onPathChange: (path: PathResult | null) => void;
  isOpen: boolean;
  onToggleOpen: () => void;
  onFocusPath?: () => void;
}

export const PathFinderDock: React.FC<PathFinderDockProps> = ({
  allAssets,
  activePath,
  onPathChange,
  isOpen,
  onToggleOpen,
  onFocusPath
}) => {
  const [sourceId, setSourceId] = useState<string>('BONGKOT-SOUTH');
  const [targetId, setTargetId] = useState<string>('REF-PTTGC');
  const [isMinimized, setIsMinimized] = useState<boolean>(false);

  // Group assets for clean select menus
  const upstreamAssets = useMemo(
    () => allAssets.filter(a => a.stage === 'upstream'),
    [allAssets]
  );
  const midstreamAssets = useMemo(
    () => allAssets.filter(a => a.stage === 'midstream'),
    [allAssets]
  );
  const downstreamAssets = useMemo(
    () => allAssets.filter(a => a.stage === 'downstream'),
    [allAssets]
  );

  const handleComputePath = (from: string, to: string) => {
    setSourceId(from);
    setTargetId(to);
    const result = findPath(from, to, { allowBidirectional: true });
    onPathChange(result);
  };

  const handleSwap = () => {
    const newFrom = targetId;
    const newTo = sourceId;
    setSourceId(newFrom);
    setTargetId(newTo);
    handleComputePath(newFrom, newTo);
  };

  const handleApplyPreset = (preset: typeof PRESET_ROUTES[0]) => {
    handleComputePath(preset.fromId, preset.toId);
  };

  const handleClear = () => {
    onPathChange(null);
  };

  if (!isOpen) {
    return (
      <button
        className="pathfinder-trigger-btn"
        onClick={onToggleOpen}
        title="เปิดเครื่องมือติดตามเส้นทางพลังงาน"
      >
        <GitMerge size={15} />
        <span>ติดตามเส้นทางพลังงาน</span>
        {activePath && <span className="pathfinder-active-indicator" />}
      </button>
    );
  }

  return (
    <div className={`pathfinder-dock-panel ${isMinimized ? 'is-minimized' : ''}`}>
      {/* Header */}
      <div className="pathfinder-header">
        <div className="pathfinder-header-title">
          <GitMerge size={16} className="text-emerald" />
          <div className="title-text-group">
            <span className="title-en">ติดตามโครงข่ายและเส้นทางลำเลียง</span>
            <span className="title-th">คำนวณระยะทาง พลังงาน และการปล่อยจากการขนส่ง</span>
          </div>
        </div>
        <div className="pathfinder-header-actions">
          <button
            className="action-icon-btn"
            onClick={() => setIsMinimized(!isMinimized)}
            title={isMinimized ? 'ขยายแผง' : 'ย่อแผง'}
          >
            {isMinimized ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          </button>
          <button
            className="action-icon-btn"
            onClick={onToggleOpen}
            title="ปิดเครื่องมือติดตามเส้นทาง"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {!isMinimized && (
        <div className="pathfinder-body">
          {/* Presets Bar */}
          <div className="pathfinder-presets-section">
            <div className="presets-label">
              <Sparkles size={11} />
              <span>เส้นทางพลังงานสำคัญที่แนะนำ:</span>
            </div>
            <div className="presets-list">
              {PRESET_ROUTES.map(preset => (
                <button
                  key={preset.id}
                  className={`preset-pill ${
                    sourceId === preset.fromId && targetId === preset.toId ? 'is-active' : ''
                  }`}
                  onClick={() => handleApplyPreset(preset)}
                >
                  <span className="preset-name">{preset.labelTh}</span>
                  <span className="preset-badge">{preset.badge}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Node Selectors */}
          <div className="pathfinder-selectors">
            <div className="selector-group">
              <label className="selector-label">
                <span className="label-dot dot-origin" />
                <span>จุดเริ่มต้น (แหล่งผลิตต้นน้ำ)</span>
              </label>
              <select
                className="pathfinder-select"
                value={sourceId}
                onChange={e => {
                  setSourceId(e.target.value);
                  handleComputePath(e.target.value, targetId);
                }}
              >
                <optgroup label="── แหล่งผลิตต้นน้ำ ──">
                  {upstreamAssets.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.nameTh} ({a.category.toUpperCase()})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="── โรงกลั่นและโรงแยกก๊าซ ──">
                  {midstreamAssets.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.nameTh} ({a.category.toUpperCase()})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="── โรงไฟฟ้า คลัง สนามบิน และปิโตรเคมี ──">
                  {downstreamAssets.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.nameTh} ({a.category.toUpperCase()})
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>

            <div className="swap-button-row">
              <button
                className="swap-btn"
                onClick={handleSwap}
                title="สลับจุดเริ่มต้นและปลายทาง"
              >
                <ArrowLeftRight size={13} />
              </button>
            </div>

            <div className="selector-group">
              <label className="selector-label">
                <span className="label-dot dot-target" />
                <span>จุดปลายทาง (โรงกลั่น โรงงาน คลัง หรือสนามบิน)</span>
              </label>
              <select
                className="pathfinder-select"
                value={targetId}
                onChange={e => {
                  setTargetId(e.target.value);
                  handleComputePath(sourceId, e.target.value);
                }}
              >
                <optgroup label="── โรงไฟฟ้า คลัง สนามบิน และปิโตรเคมี ──">
                  {downstreamAssets.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.nameTh} ({a.category.toUpperCase()})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="── โรงกลั่น โรงแยกก๊าซ และโรงไฟฟ้า ──">
                  {midstreamAssets.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.nameTh} ({a.category.toUpperCase()})
                    </option>
                  ))}
                </optgroup>
                <optgroup label="── แหล่งผลิตต้นน้ำ ──">
                  {upstreamAssets.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.nameTh} ({a.category.toUpperCase()})
                    </option>
                  ))}
                </optgroup>
              </select>
            </div>
          </div>

          {/* Path Results */}
          {activePath ? (
            <div className="pathfinder-result-box">
              {/* Metrics Grid */}
              <div className="result-metrics-grid">
                <div className="metric-cell">
                  <div className="metric-cell-label">
                    <Navigation size={11} />
                    <span>ระยะทางรวม</span>
                  </div>
                  <div className="metric-cell-val font-mono">
                    {activePath.totalDistanceKm.toFixed(1)} <span className="unit">km</span>
                  </div>
                </div>

                <div className="metric-cell">
                  <div className="metric-cell-label">
                    <Activity size={11} />
                    <span>จำนวนช่วงเส้นทาง</span>
                  </div>
                  <div className="metric-cell-val font-mono">
                    {activePath.legs.length} <span className="unit">ช่วง</span>
                  </div>
                </div>

                <div className="metric-cell">
                  <div className="metric-cell-label">
                    <Flame size={11} />
                    <span>พลังงานขนส่ง</span>
                  </div>
                  <div className="metric-cell-val font-mono">
                    {activePath.totalEnergyMj.toFixed(1)} <span className="unit">MJ/FU</span>
                  </div>
                </div>

                <div className="metric-cell">
                  <div className="metric-cell-label">
                    <Zap size={11} />
                    <span>การปล่อยจากขนส่ง</span>
                  </div>
                  <div className="metric-cell-val font-mono text-emerald">
                    {activePath.totalGhgKgCo2e.toFixed(2)} <span className="unit">kg CO₂e</span>
                  </div>
                </div>
              </div>

              {/* Legs Timeline */}
              <div className="pathfinder-timeline">
                <div className="timeline-title">ช่วงเส้นทางและรูปแบบการขนส่ง</div>
                <div className="timeline-items">
                  {activePath.legs.map((leg, idx) => (
                    <div key={idx} className="timeline-leg">
                      <div className="leg-step-num font-mono">{idx + 1}</div>
                      <div className="leg-info">
                        <div className="leg-endpoints">
                          <span className="from-asset">{leg.fromAsset.shortLabel || leg.fromAsset.nameTh}</span>
                          <ArrowRight size={11} className="leg-arrow" />
                          <span className="to-asset">{leg.toAsset.shortLabel || leg.toAsset.nameTh}</span>
                        </div>
                        <div className="leg-sub">
                          <span className="leg-mode-tag font-mono">{leg.route.mode.toUpperCase()}</span>
                          <span className="leg-dist font-mono">{leg.distanceKm} km</span>
                          <span className="leg-specs">{leg.route.specs}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pathfinder-bottom-actions">
                {onFocusPath && (
                  <button className="pathfinder-action-btn focus-btn" onClick={onFocusPath}>
                    <Compass size={13} />
                    <span>จัดแผนที่ให้เห็นเส้นทาง</span>
                  </button>
                )}
                <button className="pathfinder-action-btn clear-btn" onClick={handleClear}>
                  <X size={13} />
                  <span>ล้างการเน้นเส้นทาง</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="pathfinder-no-path">
              <div className="no-path-text">
                ไม่พบเส้นทางเชื่อมต่อโดยตรงระหว่างสถานที่ที่เลือก ลองสลับจุดเริ่มต้นกับปลายทาง หรือเลือกเส้นทางที่ตรวจสอบแล้วจากรายการด้านบน
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
