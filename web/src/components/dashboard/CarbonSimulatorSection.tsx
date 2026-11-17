import React, { useMemo, useState } from 'react';
import { Calculator, Car, Factory, Sliders, Sparkles, Trees } from 'lucide-react';
import { useWebsiteData } from '../../data/websiteData';
import type { FunctionalUnitId } from '../../types/lciDashboard';

interface FuelSimSpec {
  id: FunctionalUnitId;
  buttonLabel: string;
  unitLabel: string;
  defaultVolume: number;
  minVolume: number;
  maxVolume: number;
  stepVolume: number;
  upstreamRatio: number;
  presets: { label: string; volume: number }[];
}

export const CarbonSimulatorSection: React.FC = () => {
  const { catalog } = useWebsiteData();
  const SIM_FUEL_SPECS = catalog!.data.lciModel.simulatorSpecs as Record<FunctionalUnitId, FuelSimSpec>;
  const functionalUnitConfigs = catalog!.data.lciModel.functionalUnitConfigs;
  const [simulatorMode, setSimulatorMode] = useState<'calc' | 'scenarios'>('calc');
  const [simFuel, setSimFuel] = useState<FunctionalUnitId>('FU-1');
  const [simVolume, setSimVolume] = useState<number>(SIM_FUEL_SPECS['FU-1'].defaultVolume);
  const [simBioBlend, setSimBioBlend] = useState<number>(7);
  const [simCcsRate, setSimCcsRate] = useState<number>(0);
  const [simRecycleRate, setSimRecycleRate] = useState<number>(15);

  const fuelSpec = SIM_FUEL_SPECS[simFuel];

  const simResults = useMemo(() => {
    const fuConfig = functionalUnitConfigs[simFuel];
    const totalKgCo2e = simVolume * fuConfig.totalGhgKgCo2e;
    const totalTonsCo2e = totalKgCo2e / 1000;

    const upstreamTons = totalTonsCo2e * fuelSpec.upstreamRatio;
    const downstreamTons = totalTonsCo2e * (1 - fuelSpec.upstreamRatio);

    const treesNeededPerYear = Math.round(totalKgCo2e / 21.77);
    const evCarKmEquivalent = Math.round(totalKgCo2e / (0.15 * 0.5));
    const householdDays = Math.round((totalKgCo2e / (3000 * 0.5)) * 365);

    let scenarioSavedTons = 0;
    if (simFuel === 'FU-1') {
      const extraBioShare = Math.max(0, (simBioBlend - 7) / 100);
      const bioSaving = downstreamTons * extraBioShare * 0.65;
      const ccsSaving = upstreamTons * (simCcsRate / 100) * 0.85;
      scenarioSavedTons = bioSaving + ccsSaving;
    } else if (simFuel === 'FU-2') {
      const upstreamCcsSaving = upstreamTons * (simCcsRate / 100) * 0.9;
      const downstreamCcsSaving = downstreamTons * (simCcsRate / 100) * 0.85;
      scenarioSavedTons = upstreamCcsSaving + downstreamCcsSaving;
    } else {
      const extraRecycleRate = Math.max(0, (simRecycleRate - 15) / 100);
      scenarioSavedTons = (simVolume * extraRecycleRate * 2.34) / 1000;
    }

    const scenarioPctReduction = totalTonsCo2e > 0 ? (scenarioSavedTons / totalTonsCo2e) * 100 : 0;
    const scenarioFinalTons = Math.max(0, totalTonsCo2e - scenarioSavedTons);

    return {
      totalTonsCo2e,
      upstreamTons,
      downstreamTons,
      treesNeededPerYear,
      evCarKmEquivalent,
      householdDays,
      scenarioSavedTons,
      scenarioPctReduction,
      scenarioFinalTons
    };
  }, [simFuel, simVolume, simBioBlend, simCcsRate, simRecycleRate, fuelSpec]);

  const handleSelectFuel = (fuel: FunctionalUnitId) => {
    setSimFuel(fuel);
    setSimVolume(SIM_FUEL_SPECS[fuel].defaultVolume);
  };

  return (
    <section className="dashboard-section" id="simulator-section">
      <div className="section-header-compact">
        <div>
          <span className="section-eyebrow font-mono text-cyan">เครื่องมือคำนวณและจำลองการปล่อยตลอดวัฏจักร</span>
          <h2 className="section-heading">เครื่องมือคำนวณและจำลองสถานการณ์คาร์บอน (Scenario Simulator)</h2>
          <p className="section-subtext">
            ทดลองคำนวณคาร์บอนฟุตพริ้นท์ตามปริมาณการใช้งานจริงในภาคอุตสาหกรรม และจำลองผลสัมฤทธิ์ของมาตรการลดคาร์บอน (Biofuels, CCS, Circular Plastics)
          </p>
        </div>

        <div className="sim-mode-tabs font-mono">
          <button
            type="button"
            className={`sim-mode-tab ${simulatorMode === 'calc' ? 'is-active' : ''}`}
            onClick={() => setSimulatorMode('calc')}
          >
            <Calculator size={14} />
            <span>คำนวณจากปริมาณการใช้งาน</span>
          </button>
          <button
            type="button"
            className={`sim-mode-tab ${simulatorMode === 'scenarios' ? 'is-active' : ''}`}
            onClick={() => setSimulatorMode('scenarios')}
          >
            <Sliders size={14} />
            <span>จำลองมาตรการลดคาร์บอน</span>
          </button>
        </div>
      </div>

      <div className="simulator-container">
        <div className="sim-calculator-layout">
          <div className="sim-inputs-col font-mono">
            <div className="sim-field-group">
              <label className="sim-field-label">
                <span>1. เลือกชนิดผลิตภัณฑ์ปิโตรเลียม:</span>
                <span className="text-muted-subtle">{simFuel}</span>
              </label>
              <div className="sim-fuel-tabs">
                {(['FU-1', 'FU-2', 'FU-3'] as FunctionalUnitId[]).map((fuelId) => (
                  <button
                    key={fuelId}
                    type="button"
                    className={`fu-nav-btn sim-fuel-tab-btn ${simFuel === fuelId ? 'is-active' : ''}`}
                    onClick={() => handleSelectFuel(fuelId)}
                  >
                    {SIM_FUEL_SPECS[fuelId].buttonLabel}
                  </button>
                ))}
              </div>
            </div>

            <div className="sim-field-group">
              <label className="sim-field-label">
                <span>2. ปริมาณการบริโภค / ใช้งาน:</span>
                <span className="text-amber">
                  {simVolume.toLocaleString()} {fuelSpec.unitLabel}
                </span>
              </label>
              <div className="sim-slider-row">
                <input
                  type="range"
                  min={fuelSpec.minVolume}
                  max={fuelSpec.maxVolume}
                  step={fuelSpec.stepVolume}
                  value={simVolume}
                  onChange={(e) => setSimVolume(Number(e.target.value))}
                  className="sim-range-slider"
                />
                <input
                  type="number"
                  value={simVolume}
                  onChange={(e) => setSimVolume(Math.max(1, Number(e.target.value)))}
                  className="sim-number-input font-mono"
                />
              </div>

              <div className="sim-presets-row font-sans">
                {fuelSpec.presets.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    className="sim-preset-btn"
                    onClick={() => setSimVolume(preset.volume)}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {simulatorMode === 'scenarios' && (
              <div className="sim-policy-sliders">
                {simFuel === 'FU-1' && (
                  <>
                    <div className="sim-field-group">
                      <label className="sim-field-label">
                        <span>สัดส่วนน้ำมันไบโอดีเซลผสม (Biodiesel Blend %):</span>
                        <span className="text-emerald">B{simBioBlend} ({simBioBlend}%)</span>
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={simBioBlend}
                        onChange={(e) => setSimBioBlend(Number(e.target.value))}
                        className="sim-range-slider"
                      />
                      <div className="table-footnote-caption table-footnote--tight">
                        * ปัจจุบันไทยใช้ B7 (7%) · สามารถเพิ่มเป็น B10, B20 หรือ HVO (100% Drop-in Biofuel)
                      </div>
                    </div>

                    <div className="sim-field-group">
                      <label className="sim-field-label">
                        <span>เทคโนโลยีดักจับและกักเก็บคาร์บอน (CCS Rate at Refinery):</span>
                        <span className="text-cyan">{simCcsRate}%</span>
                      </label>
                      <input
                        type="range"
                        min="0"
                        max="90"
                        step="5"
                        value={simCcsRate}
                        onChange={(e) => setSimCcsRate(Number(e.target.value))}
                        className="sim-range-slider"
                      />
                    </div>
                  </>
                )}

                {simFuel === 'FU-2' && (
                  <div className="sim-field-group">
                    <label className="sim-field-label">
                      <span>ดักจับคาร์บอนที่โรงไฟฟ้าความร้อนร่วม (CCGT Post-combustion CCS):</span>
                      <span className="text-cyan">{simCcsRate}%</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="90"
                      step="5"
                      value={simCcsRate}
                      onChange={(e) => setSimCcsRate(Number(e.target.value))}
                      className="sim-range-slider"
                    />
                    <div className="table-footnote-caption table-footnote--tight">
                      * อ้างอิงโครงการนำร่อง Arthit CCS ของ ปตท.สผ. ในอ่าวไทย
                    </div>
                  </div>
                )}

                {simFuel === 'FU-3' && (
                  <div className="sim-field-group">
                    <label className="sim-field-label">
                      <span>อัตราการรีไซเคิลเชิงกลแทนการเผาทำลาย (Mechanical Recycling %):</span>
                      <span className="text-emerald">{simRecycleRate}%</span>
                    </label>
                    <input
                      type="range"
                      min="0"
                      max="80"
                      step="5"
                      value={simRecycleRate}
                      onChange={(e) => setSimRecycleRate(Number(e.target.value))}
                      className="sim-range-slider"
                    />
                    <div className="table-footnote-caption table-footnote--tight">
                      * หลีกเลี่ยงการเผาทำลายซาก (ลด 2.34 kg CO₂e ต่อกิโลกรัมที่รีไซเคิลได้)
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="sim-results-col font-mono">
            <div className="sim-metric-hero">
              <div className="sim-metric-hero-label">
                {simulatorMode === 'calc'
                  ? 'การปล่อยก๊าซเรือนกระจกตลอดวัฏจักรชีวิตสุทธิ (Life Cycle GHG)'
                  : 'การปล่อยหลังประยุกต์มาตรการลดคาร์บอน (Post-Mitigation GHG)'}
              </div>
              <div className="sim-metric-hero-val font-mono">
                {(simulatorMode === 'calc' ? simResults.totalTonsCo2e : simResults.scenarioFinalTons).toLocaleString(
                  'en-US',
                  { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                )}
                <span className="sim-metric-hero-unit">ตัน CO₂e (tCO₂e)</span>
              </div>
              <div className="sim-metric-hero-sub font-sans">
                ต้นน้ำ-กลางน้ำ (Well-to-Tank): {simResults.upstreamTons.toFixed(2)} t · ปลายทาง (Use/EOL):{' '}
                {simResults.downstreamTons.toFixed(2)} t
              </div>
            </div>

            {simulatorMode === 'scenarios' && (
              <div className="national-validation-banner sim-mitigation-banner">
                <Sparkles size={18} className="text-emerald" />
                <div className="validation-banner-text">
                  <strong>ลดการปล่อยลงได้สุทธิ:</strong> {simResults.scenarioSavedTons.toFixed(2)} ตัน CO₂e (
                  {simResults.scenarioPctReduction.toFixed(1)}% Reduction จากสถานการณ์ฐาน)
                </div>
              </div>
            )}

            <div className="sim-equivalents-grid font-sans">
              <div className="sim-equiv-card">
                <Trees size={20} className="sim-equiv-icon text-emerald" />
                <div className="sim-equiv-val font-mono">{simResults.treesNeededPerYear.toLocaleString()}</div>
                <div className="sim-equiv-label">
                  ต้นไม้ที่ต้องปลูกเพื่อดูดซับคาร์บอนเป็นเวลา 1 ปี (Tree Equivalents)
                </div>
              </div>

              <div className="sim-equiv-card">
                <Car size={20} className="sim-equiv-icon text-cyan" />
                <div className="sim-equiv-val font-mono">{simResults.evCarKmEquivalent.toLocaleString()}</div>
                <div className="sim-equiv-label">
                  กิโลเมตรเทียบเท่าการขับรถยนต์ไฟฟ้า (EV km Driven Equivalency)
                </div>
              </div>

              <div className="sim-equiv-card">
                <Factory size={20} className="sim-equiv-icon text-purple" />
                <div className="sim-equiv-val font-mono">{simResults.householdDays.toLocaleString()}</div>
                <div className="sim-equiv-label">
                  วันเทียบเท่าการใช้พลังงานไฟฟ้าของครัวเรือนไทยโดยเฉลี่ย
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
