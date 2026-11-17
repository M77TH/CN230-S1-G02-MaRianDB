import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Award,
  BarChart2,
  Calculator,
  CheckCircle2,
  Database,
  Flame,
  Layers,
  Package,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { FunctionalUnitId } from '../../types/lciDashboard';
import { ProcessChainSection } from './ProcessChainSection';
import { GhgResultsSection } from './GhgResultsSection';
import { CarbonSimulatorSection } from './CarbonSimulatorSection';
import { DataRepositorySection, RepositoryTab } from './DataRepositorySection';
import { HotspotsAuditSection } from './HotspotsAuditSection';
import '../../styles/dashboard.css';

interface ExecutiveVisualDashboardProps {
  onScrollToTop?: () => void;
}

export const ExecutiveVisualDashboard: React.FC<ExecutiveVisualDashboardProps> = ({ onScrollToTop }) => {
  const [selectedProcessId, setSelectedProcessId] = useState<string>('P02');
  const [selectedFu, setSelectedFu] = useState<FunctionalUnitId>('FU-1');
  const [highlightActivePathway, setHighlightActivePathway] = useState<boolean>(true);
  const [activeDeepDiveTab, setActiveDeepDiveTab] = useState<RepositoryTab>('balance');
  const [ledgerSearchQuery, setLedgerSearchQuery] = useState<string>('');
  const [copyToastText, setCopyToastText] = useState<string | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setCopyToastText(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setCopyToastText(null);
    }, 2800);
  }, []);

  const jumpToProcessLedger = useCallback(
    (procId: string) => {
      setActiveDeepDiveTab('ledger');
      setLedgerSearchQuery(procId);
      document.getElementById('data-explorer-section')?.scrollIntoView({ behavior: 'smooth' });
      showToast(`กรองตาราง LCI Ledger สำหรับกระบวนการ ${procId} เรียบร้อยแล้ว`);
    },
    [showToast]
  );

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="lci-executive-dashboard" id="lci-visual-dashboard">
      {copyToastText && (
        <div className="copy-toast font-mono">
          <CheckCircle2 size={16} className="text-emerald" />
          <span>{copyToastText}</span>
        </div>
      )}

      {/* Top Header & Presentation Banner */}
      <section className="dashboard-hero-section">
        <div className="dashboard-header-block">
          <div className="hero-top-row">
            <div className="dashboard-badge-cluster">
              <span className="hero-pill-badge font-mono">
                <ShieldCheck size={12} />
                CN230 · MARIANDB G02
              </span>
              <span className="hero-pill-badge font-mono">ISO 14040 / 14044 LCA</span>
              <span className="hero-pill-badge font-mono">IPCC AR5 GWP100</span>
              <span className="hero-pill-badge font-mono text-emerald">
                ตรวจสอบเส้นทางข้อมูลได้ 100%
              </span>
            </div>

            {onScrollToTop && (
              <button
                type="button"
                onClick={onScrollToTop}
                className="quick-nav-pill-top font-mono"
                title="กลับไปยังแผนที่วงจรชีวิต"
              >
                ↑ กลับสู่แผนที่
              </button>
            )}
          </div>

          <h1 className="dashboard-hero-title">
            ระบบบัญชีรายการสิ่งแวดล้อมปิโตรเลียมไทย{' '}
            <span className="dashboard-title-accent">(Cradle-to-Grave LCI)</span>
            <span className="title-sub font-mono">
              บัญชีวัฏจักรชีวิตพลังงานของประเทศ — ตั้งแต่การผลิตต้นน้ำจนถึงการใช้งานปลายทาง
            </span>
          </h1>

          {/* Executive Telemetry Ribbon */}
          <div className="hero-telemetry-ribbon font-mono">
            <div className="telemetry-ribbon-item">
              <span className="ribbon-val">25 แหล่ง</span>
              <span className="ribbon-label">แหล่งผลิตต้นน้ำ (9 บนบก + 16 อ่าวไทย)</span>
            </div>
            <div className="telemetry-ribbon-sep" />
            <div className="telemetry-ribbon-item">
              <span className="ribbon-val">1,245,000 bbl/d</span>
              <span className="ribbon-label">กำลังกลั่นรวม (7 โรงกลั่นพาณิชย์)</span>
            </div>
            <div className="telemetry-ribbon-sep" />
            <div className="telemetry-ribbon-item">
              <span className="ribbon-val">4,570 กม.</span>
              <span className="ribbon-label">โครงข่ายท่อก๊าซ ปตท. (ในทะเล 2,133 + บนบก 2,437)</span>
            </div>
            <div className="telemetry-ribbon-sep" />
            <div className="telemetry-ribbon-item">
              <span className="ribbon-val">43 รายการ LCI</span>
              <span className="ribbon-label">บัญชีแลกเปลี่ยน LCI (LCX-001..043)</span>
            </div>
            <div className="telemetry-ribbon-sep" />
            <div className="telemetry-ribbon-item">
              <span className="ribbon-val">98 แหล่งข้อมูล</span>
              <span className="ribbon-label">ทะเบียนข้อมูลปฐมภูมิ (SRC-001..098)</span>
            </div>
          </div>

          {/* 3 Executive Hero Pillars */}
          <div className="hero-pillars-grid">
            <div
              className={`pillar-card ${selectedFu === 'FU-1' ? 'is-active' : ''}`}
              onClick={() => setSelectedFu('FU-1')}
            >
              <div className="pillar-top">
                <span className="pillar-tag font-mono">FU-1 · ดีเซลหมุนเร็ว 1 ลิตร</span>
                <Flame size={15} className="pillar-icon text-orange" />
              </div>
              <div className="pillar-main">
                <span className="pillar-value font-mono">3.0062</span>
                <span className="pillar-unit">kg CO₂e/L</span>
              </div>
              <div className="pillar-meta">
                <span>
                  เผาไหม้บนถนน: <strong>90.1%</strong>
                </span>
                <span className="pillar-badge-verified">อบก. ต่าง 0.8%</span>
              </div>
            </div>

            <div
              className={`pillar-card ${selectedFu === 'FU-2' ? 'is-active' : ''}`}
              onClick={() => setSelectedFu('FU-2')}
            >
              <div className="pillar-top">
                <span className="pillar-tag font-mono">FU-2 · ก๊าซธรรมชาติ 1 GJ</span>
                <Zap size={15} className="pillar-icon text-cyan" />
              </div>
              <div className="pillar-main">
                <span className="pillar-value font-mono">71.52</span>
                <span className="pillar-unit">kg CO₂e/GJ</span>
              </div>
              <div className="pillar-meta">
                <span>
                  ผลิตไฟฟ้า (120 kWh): <strong>78.5%</strong>
                </span>
                <span className="pillar-badge-verified">0.596 kg/kWh</span>
              </div>
            </div>

            <div
              className={`pillar-card ${selectedFu === 'FU-3' ? 'is-active' : ''}`}
              onClick={() => setSelectedFu('FU-3')}
            >
              <div className="pillar-top">
                <span className="pillar-tag font-mono">FU-3 · เม็ดพลาสติก PE 1 กก.</span>
                <Package size={15} className="pillar-icon text-purple" />
              </div>
              <div className="pillar-main">
                <span className="pillar-value font-mono">4.688</span>
                <span className="pillar-unit">kg CO₂e/kg</span>
              </div>
              <div className="pillar-meta">
                <span>
                  เตาเผาขยะ (EOL): <strong>4.688</strong>
                </span>
                <span className="pillar-badge-verified">ฝังกลบ: 2.338</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Sticky Quick Navigation Bar */}
      <nav className="dashboard-sticky-subnav font-mono">
        <div className="sticky-subnav-inner">
          <button
            type="button"
            className="subnav-btn"
            onClick={() => scrollToSection('process-chain-section')}
          >
            <Layers size={13} />
            <span>01 ห่วงโซ่ 20 กระบวนการ</span>
          </button>
          <button
            type="button"
            className="subnav-btn"
            onClick={() => scrollToSection('results-section')}
          >
            <BarChart2 size={13} />
            <span>02 ผลรวม GHG ตามช่วง</span>
          </button>
          <button
            type="button"
            className="subnav-btn"
            onClick={() => scrollToSection('simulator-section')}
          >
            <Calculator size={13} />
            <span>03 จำลองคาร์บอน</span>
          </button>
          <button
            type="button"
            className="subnav-btn"
            onClick={() => scrollToSection('data-explorer-section')}
          >
            <Database size={13} />
            <span>04 คลังข้อมูลและสมดุลมวล</span>
          </button>
          <button
            type="button"
            className="subnav-btn"
            onClick={() => scrollToSection('hotspots-section')}
          >
            <Award size={13} />
            <span>05 ยุทธศาสตร์ลดคาร์บอน</span>
          </button>
        </div>
      </nav>

      <ProcessChainSection
        selectedFu={selectedFu}
        selectedProcessId={selectedProcessId}
        onSelectProcess={setSelectedProcessId}
        highlightActivePathway={highlightActivePathway}
        onToggleHighlightPathway={() => setHighlightActivePathway((prev) => !prev)}
        onJumpToProcessLedger={jumpToProcessLedger}
      />

      <GhgResultsSection selectedFu={selectedFu} onSelectFu={setSelectedFu} />

      <CarbonSimulatorSection />

      <DataRepositorySection
        activeTab={activeDeepDiveTab}
        onTabChange={setActiveDeepDiveTab}
        ledgerSearchQuery={ledgerSearchQuery}
        onLedgerSearchChange={setLedgerSearchQuery}
        onNotify={showToast}
      />

      <HotspotsAuditSection />

      <footer className="dashboard-footer">
        <div className="footer-content-wrap">
          <p>
            <strong>CN230 Data Engineering Final Project</strong> · ทีม G02 MarianDB · สถาปัตยกรรมข้อมูล
            Cradle-to-Grave ตามมาตรฐาน ISO 14040/14044
          </p>
          <p className="footer-meta font-mono">
            IPCC AR5 GWP100 · ฐานข้อมูลอ้างอิงประเทศไทย พ.ศ. 2566–2568 · 100% Real Auditable Data
          </p>
          {onScrollToTop && (
            <button type="button" onClick={onScrollToTop} className="footer-back-to-map-btn font-mono">
              ↑ กลับสู่แผนที่ประเทศไทย (Return to Lifecycle Map)
            </button>
          )}
        </div>
      </footer>
    </div>
  );
};
