import React, { useMemo, useState } from 'react';
import { Activity, ArrowRight, BarChart2, CheckCircle2, Info, Lightbulb, PieChart, Scale } from 'lucide-react';
import { functionalUnitConfigs, otherProductsLci } from '../../data/lciMasterDataset';
import { FunctionalUnitId } from '../../types/lciDashboard';
import { BENCHMARK_COMPARISONS, GAS_SPECIATION_DATA, SCOPE_SPLIT_BY_FU } from './dashboardData';

interface GhgResultsSectionProps {
  selectedFu: FunctionalUnitId;
  onSelectFu: (fu: FunctionalUnitId) => void;
}

const FU_TABS: { id: FunctionalUnitId; label: string }[] = [
  { id: 'FU-1', label: 'FU-1 ดีเซล 1 ลิตร' },
  { id: 'FU-2', label: 'FU-2 ก๊าซ 1 GJ' },
  { id: 'FU-3', label: 'FU-3 ปิโตรเคมี 1 กก.' }
];

export const GhgResultsSection: React.FC<GhgResultsSectionProps> = ({ selectedFu, onSelectFu }) => {
  const [resultsViewMode, setResultsViewMode] = useState<'waterfall' | 'bars' | 'gases'>('waterfall');

  const activeFuDetail = useMemo(() => functionalUnitConfigs[selectedFu], [selectedFu]);
  const scopeSplit = SCOPE_SPLIT_BY_FU[selectedFu];

  const maxStageAmount = useMemo(() => {
    const maxVal = Math.max(...activeFuDetail.stages.map((s) => s.amountKgCo2e));
    return maxVal > 0 ? maxVal : 1;
  }, [activeFuDetail]);

  const waterfallSteps = useMemo(() => {
    let runningSum = 0;
    return activeFuDetail.stages.map((st) => {
      const stepVal = st.amountKgCo2e;
      runningSum += stepVal;
      return {
        ...st,
        stepVal,
        runningSum: Number(runningSum.toFixed(4))
      };
    });
  }, [activeFuDetail]);

  const gasData = GAS_SPECIATION_DATA[selectedFu];
  const benchmarkData = BENCHMARK_COMPARISONS[selectedFu];

  return (
    <section className="dashboard-section" id="results-section">
      <div className="section-header-compact">
        <div>
          <span className="section-eyebrow font-mono text-orange">การประเมินวัฏจักรชีวิตต่อหน่วยหน้าที่ (LCA)</span>
          <h2 className="section-heading">ผลรวม GHG ตลอดวัฏจักร (Cradle-to-Grave Analysis)</h2>
          <p className="section-subtext">
            เปรียบเทียบการสะสมคาร์บอนตลอดสายโซ่ สัดส่วนการปล่อยตามระยะ และผลเทียบเคียงกับมาตรฐานสากล
          </p>
        </div>

        <div className="section-header-controls">
          <div className="view-mode-pill-group font-mono">
            <button
              type="button"
              className={`view-mode-pill ${resultsViewMode === 'waterfall' ? 'is-active' : ''}`}
              onClick={() => setResultsViewMode('waterfall')}
            >
              <Activity size={12} />
              <span>สะสมการปล่อย</span>
            </button>
            <button
              type="button"
              className={`view-mode-pill ${resultsViewMode === 'bars' ? 'is-active' : ''}`}
              onClick={() => setResultsViewMode('bars')}
            >
              <BarChart2 size={12} />
              <span>แท่งเปรียบเทียบ</span>
            </button>
            <button
              type="button"
              className={`view-mode-pill ${resultsViewMode === 'gases' ? 'is-active' : ''}`}
              onClick={() => setResultsViewMode('gases')}
            >
              <PieChart size={12} />
              <span>แจกแจงชนิดก๊าซ</span>
            </button>
          </div>

          <div className="fu-nav-tabs">
            {FU_TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                className={`fu-nav-btn ${selectedFu === tab.id ? 'is-active' : ''}`}
                onClick={() => onSelectFu(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Scope Split Callout Bar */}
      <div className="lifecycle-scope-split-card font-mono">
        <div className="scope-split-segment segment-upstream">
          <span className="scope-pct-badge">{scopeSplit.upstreamShare}</span>
          <div className="scope-info-col">
            <span className="scope-title">{scopeSplit.upstreamLabel}</span>
            <span className="scope-val">{scopeSplit.upstreamKg} kg CO₂e</span>
          </div>
        </div>

        <div className="scope-split-divider">VS</div>

        <div className="scope-split-segment segment-dominant">
          <span className="scope-pct-badge dominant">{scopeSplit.useShare}</span>
          <div className="scope-info-col">
            <span className="scope-title">{scopeSplit.useLabel}</span>
            <span className="scope-val">{scopeSplit.useKg} kg CO₂e</span>
          </div>
        </div>

        <div className="scope-finding-banner">
          <Info size={14} className="text-orange" />
          <span>{scopeSplit.keyFinding}</span>
        </div>
      </div>

      {/* View Modes */}
      {resultsViewMode === 'waterfall' && (
        <div className="waterfall-container font-mono">
          <div className="waterfall-steps-row">
            {waterfallSteps.map((st, idx) => {
              const isDominant = st.pct >= 50;
              return (
                <React.Fragment key={idx}>
                  <div className={`waterfall-step-card ${isDominant ? 'is-dominant-step' : ''}`}>
                    <div className="waterfall-step-top">
                      <span className="waterfall-step-code">{st.processCode}</span>
                      <span className="waterfall-step-pct">{st.pct.toFixed(1)}%</span>
                    </div>
                    <div className="waterfall-step-name font-sans">
                      {st.stageName.split(' (')[0]}
                    </div>
                    <div className="waterfall-delta-val text-amber">
                      +{st.stepVal.toFixed(4)}
                    </div>
                    <div className="waterfall-running-val">
                      สะสม: <strong>{st.runningSum.toFixed(4)}</strong> kg
                    </div>
                  </div>

                  {idx < waterfallSteps.length - 1 && (
                    <div className="waterfall-arrow-connector">
                      <ArrowRight size={16} />
                    </div>
                  )}
                </React.Fragment>
              );
            })}

            <div className="waterfall-arrow-connector">
              <ArrowRight size={16} />
            </div>

            <div className="waterfall-step-card is-final-total">
              <div className="waterfall-step-top">
                <span className="waterfall-step-code">รวมสุทธิ</span>
                <span className="waterfall-step-pct text-emerald">100.0%</span>
              </div>
              <div className="waterfall-step-name font-sans">
                ผลรวม Cradle-to-Grave
              </div>
              <div className="waterfall-delta-val text-white waterfall-total-lg">
                {activeFuDetail.totalGhgKgCo2e}
              </div>
              <div className="waterfall-running-val text-white">
                kg CO₂e ต่อ {activeFuDetail.referenceUnit}
              </div>
            </div>
          </div>
        </div>
      )}

      {resultsViewMode === 'bars' && (
        <div className="ghg-presentation-card">
          <div className="ghg-side-by-side-grid">
            <div className="chart-column">
              <div className="chart-bars-wrap">
                {activeFuDetail.stages.map((st, idx) => {
                  const widthPct = Math.max(3, (st.amountKgCo2e / maxStageAmount) * 100);
                  const isDominant = st.pct >= 50;

                  return (
                    <div key={idx} className="chart-bar-line">
                      <div className="stage-name-col font-mono">
                        {st.stageName.split(' (')[0]} <small>({st.processCode})</small>
                      </div>
                      <div className="bar-track-col">
                        <div
                          className={`bar-fill-element ${isDominant ? 'bar-fill-dominant' : 'bar-fill-subtle'}`}
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="chart-x-axis font-mono">
                <span>0</span>
                <span>{(maxStageAmount * 0.25).toFixed(1)}</span>
                <span>{(maxStageAmount * 0.5).toFixed(1)}</span>
                <span>{(maxStageAmount * 0.75).toFixed(1)}</span>
                <span>{maxStageAmount.toFixed(1)}</span>
              </div>
              <div className="axis-title-label font-mono">
                กก. CO₂e ต่อ 1 หน่วยหน้าที่ (FU)
              </div>
            </div>

            <div className="breakdown-column">
              <div className="breakdown-header-label font-mono">
                กก.CO₂e ต่อ {activeFuDetail.referenceUnit}
              </div>

              <div className="breakdown-rows-list">
                {activeFuDetail.stages.map((st, idx) => {
                  const isDominant = st.pct >= 50;
                  return (
                    <div key={idx} className="breakdown-stat-row">
                      <div className="stat-name-group">
                        <span className={`color-indicator-square ${isDominant ? 'sq-orange' : 'sq-cyan'}`} />
                        <span>{st.stageName.split(' (')[0]} <small>({st.processCode})</small></span>
                      </div>
                      <div className="stat-values-group font-mono">
                        <span className="val-amount">{st.amountKgCo2e.toFixed(4)}</span>
                        <span className="val-pct">{st.pct.toFixed(1)}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="total-cradle-to-grave-box">
                <span className="total-box-label">รวม Cradle-to-Grave</span>
                <span className="total-box-value font-mono">
                  {activeFuDetail.totalGhgKgCo2e} <small>kg CO₂e</small>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {resultsViewMode === 'gases' && (
        <div className="gas-speciation-card font-mono">
          <div className="gas-spec-header">
            <div>
              <h4 className="gas-spec-title">
                การแจกแจงชนิดก๊าซเรือนกระจก (GHG Speciation & GWP100 Profile)
              </h4>
              <p className="gas-spec-subtitle">
                คำนวณตามมาตรฐาน IPCC Fifth Assessment Report (AR5) สัดส่วนคาร์บอนไดออกไซด์ มีเทน และไนตรัสออกไซด์
              </p>
            </div>
            <span className="pillar-badge-verified">IPCC AR5 GWP100</span>
          </div>

          <div className="gas-speciation-grid">
            <div className="gas-spec-card">
              <div className="gas-spec-header">
                <span className="gas-formula">CO₂ (Fossil)</span>
                <span className="gas-gwp-tag">GWP = 1</span>
              </div>
              <div className="gas-val-large text-white">
                {gasData.co2Pct.toFixed(1)}%
              </div>
              <div className="gas-spec-desc font-sans">
                {gasData.co2Kg.toFixed(4)} kg CO₂ จากการเผาไหม้สมบูรณ์ของพันธะไฮโดรคาร์บอน
              </div>
            </div>

            <div className="gas-spec-card">
              <div className="gas-spec-header">
                <span className="gas-formula text-cyan">CH₄ (Methane)</span>
                <span className="gas-gwp-tag">GWP = 28</span>
              </div>
              <div className="gas-val-large text-cyan">
                {gasData.ch4Pct.toFixed(2)}%
              </div>
              <div className="gas-spec-desc font-sans">
                {gasData.ch4KgCo2e.toFixed(4)} kg CO₂e จากการเผาไหม้ไม่สมบูรณ์และ Fugitive Venting
              </div>
            </div>

            <div className="gas-spec-card">
              <div className="gas-spec-header">
                <span className="gas-formula text-purple">N₂O (Nitrous Oxide)</span>
                <span className="gas-gwp-tag">GWP = 265</span>
              </div>
              <div className="gas-val-large text-purple">
                {gasData.n2oPct.toFixed(2)}%
              </div>
              <div className="gas-spec-desc font-sans">
                {gasData.n2oKgCo2e.toFixed(4)} kg CO₂e จากปฏิกิริยา Thermal NOx ที่อุณหภูมิสูง
              </div>
            </div>
          </div>

          <div className="scope-finding-banner scope-finding-banner--spaced">
            <Lightbulb size={14} className="text-orange" />
            <span>{gasData.keyGasInsight}</span>
          </div>
        </div>
      )}

      {/* Regulatory & International Benchmark Comparison */}
      <div className="benchmark-card font-mono">
        <div className="benchmark-header">
          <div className="benchmark-title">
            <Scale size={15} className="text-amber" />
            <span>การเทียบเคียงกับมาตรฐานระดับชาติและสากล (Regulatory Benchmarking & Validation):</span>
          </div>
          <span className="pillar-badge-verified">
            <CheckCircle2 size={12} className="inline-icon" /> ตรวจทานผ่านเกณฑ์ 100%
          </span>
        </div>

        <div className="benchmark-grid">
          {benchmarkData.benchmarks.map((bm, i) => (
            <div key={i} className={`benchmark-item ${i === 0 ? 'is-our-model' : ''}`}>
              <div className="benchmark-item-name font-sans">{bm.name}</div>
              <div className="benchmark-item-val">
                {bm.value.toFixed(4)}{' '}
                <small className="benchmark-unit-small">
                  {benchmarkData.modelUnit}
                </small>
              </div>
              <div
                className={`benchmark-item-delta ${
                  bm.deltaPct === 0
                    ? 'is-positive'
                    : Math.abs(bm.deltaPct) < 2
                      ? 'is-minor'
                      : 'text-muted-subtle'
                }`}
              >
                {bm.deltaPct === 0
                  ? '★ โมเดลคำนวณฐาน'
                  : `ต่าง ${bm.deltaPct > 0 ? '+' : ''}${bm.deltaPct.toFixed(2)}%`}
              </div>
            </div>
          ))}
        </div>

        <div className="table-footnote-caption table-footnote--spaced">
          * {activeFuDetail.nationalValidationNote}
        </div>
      </div>

      {/* Other Finished Fuels Table */}
      <div className="other-fuels-panel">
        <h3 className="other-fuels-title">
          ผลิตภัณฑ์สำเร็จรูปอื่นในระบบพลังงานไทย — Cradle-to-Gate + การเผาไหม้
        </h3>

        <div className="table-responsive-box">
          <table className="other-fuels-table font-mono">
            <thead>
              <tr>
                <th>ผลิตภัณฑ์</th>
                <th>Cradle-to-gate (กก.CO₂e/กก.)</th>
                <th>การเผาไหม้</th>
                <th>รวม Cradle-to-Grave</th>
                <th>แหล่งอ้างอิง</th>
              </tr>
            </thead>
            <tbody>
              {otherProductsLci.map((prod, i) => (
                <tr key={i}>
                  <td className="fuel-name-cell">
                    <strong>{prod.productNameTh}</strong>
                    <span className="text-muted-subtle fuel-name-sub">
                      {prod.productNameEn}
                    </span>
                  </td>
                  <td className="text-center font-bold">{prod.cradleToGateKgCo2ePerKg}</td>
                  <td className="text-center">{prod.combustionFactorText}</td>
                  <td className="text-center font-bold text-highlight">{prod.totalFormulaOrVal}</td>
                  <td className="text-muted-subtle text-sm">{prod.referenceSource}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footnote-caption">
          * ค่า cradle-to-gate จาก อบก. ค่า EF สำหรับ CFP · ค่าการเผาไหม้จาก อบก. CFO · ρ = ความหนาแน่น (กก./ลิตร)
        </div>
      </div>
    </section>
  );
};
