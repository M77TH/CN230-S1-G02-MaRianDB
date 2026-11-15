import React, { useMemo } from 'react';
import { Activity, ArrowUpRight, Award, Database } from 'lucide-react';
import { lciExchanges, processChainItems } from '../../data/lciMasterDataset';
import { comprehensiveSources } from '../../data/comprehensiveSources';
import { FunctionalUnitId, ProcessChainItem } from '../../types/lciDashboard';
import { isHttpUrl } from '../../utils/format';
import { FU_PATHWAYS, SUPPLY_CHAIN_STAGES, getStatusBadgeClass } from './dashboardData';

interface ProcessChainSectionProps {
  selectedFu: FunctionalUnitId;
  selectedProcessId: string;
  onSelectProcess: (processId: string) => void;
  highlightActivePathway: boolean;
  onToggleHighlightPathway: () => void;
  onJumpToProcessLedger: (processId: string) => void;
}

function getStatusLabel(status: string): string {
  if (status === 'VERIFIED') return 'ยืนยันแล้ว';
  if (status === 'CALCULATED') return 'คำนวณแล้ว';
  if (status === 'PROXY') return 'ค่าเทียบเคียง';
  if (status === 'DATA_GAP') return 'ข้อมูลขาดหาย';
  return status;
}

export const ProcessChainSection: React.FC<ProcessChainSectionProps> = ({
  selectedFu,
  selectedProcessId,
  onSelectProcess,
  highlightActivePathway,
  onToggleHighlightPathway,
  onJumpToProcessLedger
}) => {
  const activeProcess = useMemo<ProcessChainItem>(
    () => processChainItems.find((p) => p.id === selectedProcessId) || processChainItems[1],
    [selectedProcessId]
  );

  const activeProcessSources = useMemo(() => {
    if (!activeProcess.sourceId) return [];
    const sourceIds = activeProcess.sourceId
      .split(/[\s,/]+/)
      .map((s) => s.trim())
      .filter((s) => s.startsWith('SRC-'));
    return comprehensiveSources.filter((src) => sourceIds.includes(src.source_id));
  }, [activeProcess]);

  const activeProcessExchanges = useMemo(
    () => lciExchanges.filter((e) => e.process_id === activeProcess.id),
    [activeProcess]
  );

  const processesByStage = useMemo(
    () =>
      SUPPLY_CHAIN_STAGES.map((stage) => ({
        ...stage,
        items: processChainItems.filter((p) => p.stageIndex === stage.stageIndex)
      })),
    []
  );

  const pedigreeMatrixDimensions = useMemo(() => {
    const raw = activeProcess.dqr || '2-2-2-1-2';
    const [d1 = 2, d2 = 2, d3 = 2, d4 = 1, d5 = 2] = raw
      .split('-')
      .map((n) => parseInt(n, 10) || 2);

    return [
      {
        code: 'D1',
        nameTh: 'ความน่าเชื่อถือ',
        score: d1,
        desc: d1 === 1 ? 'วัดจริง 100% (Audited ESG)' : d1 === 2 ? 'คำนวณวิศวกรรม (Energy Balance)' : 'ค่าเทียบเคียง (Proxy)'
      },
      {
        code: 'D2',
        nameTh: 'ความครบถ้วน',
        score: d2,
        desc: d2 === 1 ? 'ครอบคลุมทุกโรงงาน (>95%)' : d2 === 2 ? 'ตัวแทนระดับประเทศหลัก' : 'ข้อมูลบางแห่ง'
      },
      {
        code: 'D3',
        nameTh: 'ความทันสมัย',
        score: d3,
        desc: d3 === 1 ? 'ข้อมูลปี 2566–2567 (<3 ปี)' : d3 === 2 ? 'ข้อมูลปี 2564–2565 (<5 ปี)' : 'ข้อมูลก่อนปี 2564'
      },
      {
        code: 'D4',
        nameTh: 'พื้นที่ศึกษา',
        score: d4,
        desc: d4 === 1 ? 'เฉพาะประเทศไทย (Thailand Direct)' : d4 === 2 ? 'กลุ่มประเทศอาเซียน (Regional)' : 'ค่าเฉลี่ยทั่วโลก'
      },
      {
        code: 'D5',
        nameTh: 'เทคโนโลยีจริง',
        score: d5,
        desc: d5 === 1 ? 'ตรงตามเครื่องจักรจริง 100%' : d5 === 2 ? 'ประเภทเดียวกัน (Same Class)' : 'เทคโนโลยีทดแทน'
      }
    ];
  }, [activeProcess]);

  return (
    <section className="dashboard-section" id="process-chain-section">
      <div className="section-header-compact">
        <div>
          <span className="section-eyebrow font-mono">ขอบเขตระบบตลอดวัฏจักร</span>
          <h2 className="section-heading">ห่วงโซ่ 20 กระบวนการ (P01 – P20)</h2>
          <p className="section-subtext">
            เลือกกระบวนการเพื่อดูสิ่งอำนวยความสะดวกจริง การประเมินคุณภาพข้อมูล ISO 14044 (DQR Matrix) และกระแสแลกเปลี่ยน LCI
          </p>
        </div>

        <div className="section-header-controls">
          <div className="status-legend-strip font-mono">
            <span className="legend-tag tag-verified">ยืนยันแล้ว (11)</span>
            <span className="legend-tag tag-derived">คำนวณแล้ว (5)</span>
            <span className="legend-tag tag-proxy">ค่าเทียบเคียง (3)</span>
            <span className="legend-tag tag-gap">ข้อมูลขาดหาย (1)</span>
          </div>

          <button
            type="button"
            onClick={onToggleHighlightPathway}
            className={`pathway-toggle-btn font-mono ${highlightActivePathway ? 'is-active' : ''}`}
            title="สลับโหมดเน้นเส้นทางของหน่วยหน้าที่ที่เลือก"
          >
            <Activity size={12} />
            <span>{highlightActivePathway ? `เน้นเส้นทาง ${selectedFu}` : 'แสดงทั้ง 20 กระบวนการ'}</span>
          </button>
        </div>
      </div>

      {/* 4 Supply Chain Stage Columns */}
      <div className="supply-chain-columns-grid">
        {processesByStage.map((stage) => (
          <div key={stage.stageIndex} className="chain-column">
            <div className="chain-col-header font-mono">
              <span>{stage.labelTh}</span>
              <span className="col-range">{stage.range}</span>
            </div>
            <div className="chain-items-list">
              {stage.items.map((proc) => {
                const isSelected = proc.id === selectedProcessId;
                const isInPathway = !highlightActivePathway || FU_PATHWAYS[selectedFu]?.includes(proc.id);
                return (
                  <button
                    key={proc.id}
                    type="button"
                    className={`chain-proc-btn ${isSelected ? 'is-selected' : ''} ${isInPathway ? 'is-in-pathway' : 'is-dimmed-pathway'}`}
                    onClick={() => onSelectProcess(proc.id)}
                  >
                    <span className={`proc-code-badge font-mono ${getStatusBadgeClass(proc.status)}`}>
                      {proc.id}
                    </span>
                    <span className="proc-title-text">{proc.nameTh}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Process Detail Inspector Card */}
      <div className="process-inspector-wide-card">
        <div className="inspector-card-header">
          <div className="inspector-title-row">
            <span className="inspector-code font-mono">{activeProcess.id}</span>
            <h3 className="inspector-name">{activeProcess.nameTh}</h3>
            <span className="inspector-name-en font-mono">({activeProcess.nameEn})</span>
          </div>
          <span className={`status-badge font-mono ${getStatusBadgeClass(activeProcess.status)}`}>
            {getStatusLabel(activeProcess.status)} · DQR: {activeProcess.dqr}
          </span>
        </div>

        <div className="inspector-details-table">
          <div className="detail-row">
            <span className="detail-label">ช่วงวัฏจักร:</span>
            <span className="detail-value">{activeProcess.stageName}</span>
          </div>

          <div className="detail-row">
            <span className="detail-label">สิ่งอำนวยความสะดวกจริง:</span>
            <span className="detail-value highlight-facilities">{activeProcess.facilities}</span>
          </div>

          <div className="detail-row">
            <span className="detail-label">แหล่งข้อมูลอ้างอิง:</span>
            <span className="detail-value font-mono highlight-source">{activeProcess.sourceId}</span>
          </div>

          <div className="detail-row">
            <span className="detail-label">ค่าที่ใช้ในบัญชี LCI:</span>
            <span className="detail-value font-mono highlight-val">{activeProcess.inventoryValue}</span>
          </div>

          <div className="detail-row">
            <span className="detail-label">สูตรและวิธีการคำนวณ:</span>
            <span className="detail-value font-mono text-muted-subtle">{activeProcess.formulaOrMethod}</span>
          </div>
        </div>

        {/* ISO 14044 Pedigree Matrix Evaluation Box */}
        <div className="inspector-dqr-container">
          <div className="dqr-header-row">
            <div className="dqr-title font-mono">
              <Award size={14} className="text-amber" />
              <span>การประเมินคุณภาพข้อมูล ISO 14044 (Pedigree Matrix Quality Rating):</span>
            </div>
            <span className="dqr-summary-pill font-mono">
              DQR Vector: [{activeProcess.dqr}]
            </span>
          </div>

          <div className="dqr-grid font-mono">
            {pedigreeMatrixDimensions.map((dim) => (
              <div key={dim.code} className="dqr-dimension-card">
                <span className="dqr-dim-name">{dim.code} · {dim.nameTh}</span>
                <div className="dqr-dim-rating">
                  <span className="dqr-score">ระดับ {dim.score}</span>
                  <span className={`dqr-score-desc score-${dim.score}`}>
                    {dim.score === 1 ? 'ดีเยี่ยม' : dim.score === 2 ? 'ดี' : 'ปานกลาง'}
                  </span>
                </div>
                <div className="dqr-dim-detail">{dim.desc}</div>
              </div>
            ))}
          </div>

          {activeProcessExchanges.length > 0 && (
            <button
              type="button"
              className="jump-to-ledger-btn font-mono"
              onClick={() => onJumpToProcessLedger(activeProcess.id)}
            >
              <Database size={13} />
              <span>ตรวจสอบ {activeProcessExchanges.length} รายการแลกเปลี่ยน LCI ของ {activeProcess.id} ในตารางแม่บท →</span>
            </button>
          )}
        </div>

        {/* Related Primary Sources for this Process */}
        <div className="inspector-related-sources-block">
          <div className="related-sources-header font-mono">
            <Database size={13} className="text-cyan" />
            <span>แหล่งข้อมูลอ้างอิงที่เกี่ยวข้อง (Related Primary Sources):</span>
          </div>

          {activeProcessSources.length > 0 ? (
            <div className="inspector-sources-list">
              {activeProcessSources.map((src) => (
                <div key={src.source_id} className="inspector-source-pill-card">
                  <div className="source-pill-top">
                    <span className="source-id-badge font-mono">{src.source_id}</span>
                    <span className={`status-badge-mini font-mono ${getStatusBadgeClass(src.status)}`}>
                      {src.status}
                    </span>
                    <span className="source-publisher-tag font-mono">{src.publisher_or_owner}</span>
                  </div>
                  <div className="source-pill-title">
                    {isHttpUrl(src.url_or_document_id) ? (
                      <a
                        href={src.url_or_document_id}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="source-title-link"
                      >
                        <span>{src.title}</span>
                        <ArrowUpRight size={12} className="inline-icon" />
                      </a>
                    ) : (
                      <span>{src.title}</span>
                    )}
                  </div>
                  {src.notes && <div className="source-pill-note">{src.notes}</div>}
                </div>
              ))}
            </div>
          ) : (
            <div className="source-pill-fallback font-mono">
              <code>{activeProcess.sourceId}</code> · ตรวจสอบในทะเบียนแหล่งข้อมูลปฐมภูมิ {comprehensiveSources.length} รายการด้านล่าง
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
