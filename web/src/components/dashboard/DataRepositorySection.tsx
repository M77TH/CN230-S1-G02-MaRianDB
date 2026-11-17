import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  ArrowUpRight,
  Copy,
  Database,
  FileText,
  Filter,
  Flame,
  Layers,
  Scale,
  Search,
  TrendingDown,
  Zap
} from 'lucide-react';
import { useWebsiteData } from '../../data/websiteData';
import { copyToClipboard, formatAmount, getStatusBadgeClass, isHttpUrl, toCsvString } from '../../utils/format';

export type RepositoryTab = 'balance' | 'ledger' | 'sources';

interface DataRepositorySectionProps {
  activeTab: RepositoryTab;
  onTabChange: (tab: RepositoryTab) => void;
  ledgerSearchQuery: string;
  onLedgerSearchChange: (query: string) => void;
  onNotify: (message: string) => void;
}

const AGENCY_CHIPS = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'กรมเชื้อเพลิงธรรมชาติ', label: 'กรมเชื้อเพลิงฯ (DMF)' },
  { id: 'สนพ.', label: 'สนพ. (EPPO)' },
  { id: 'อบก.', label: 'อบก. (TGO)' },
  { id: 'ปตท.', label: 'ปตท. (PTT)' },
  { id: 'ปตท.สผ.', label: 'ปตท.สผ. (PTTEP)' },
  { id: 'ไทยออยล์', label: 'ไทยออยล์ (TOP)' },
  { id: 'บางจาก', label: 'บางจาก (BCP)' },
  { id: 'กฟผ.', label: 'กฟผ. (EGAT)' },
  { id: 'IPCC', label: 'IPCC AR5' }
];

export const DataRepositorySection: React.FC<DataRepositorySectionProps> = ({
  activeTab,
  onTabChange,
  ledgerSearchQuery,
  onLedgerSearchChange,
  onNotify
}) => {
  const { catalog } = useWebsiteData();
  const { exchanges: lciExchanges, nationalPetroleumBalance } = catalog!.data.lciModel;
  const comprehensiveSources = catalog!.data.sourceCards;
  const [ledgerFuFilter, setLedgerFuFilter] = useState<string>('all');
  const [ledgerStatusFilter, setLedgerStatusFilter] = useState<string>('all');
  const [ledgerCompartmentFilter, setLedgerCompartmentFilter] = useState<string>('all');

  const [sourceSearchQuery, setSourceSearchQuery] = useState<string>('');
  const [sourceStatusFilter, setSourceStatusFilter] = useState<string>('all');
  const [sourceCategoryFilter, setSourceCategoryFilter] = useState<string>('all');
  const [sourceAgencyChip, setSourceAgencyChip] = useState<string>('all');
  const [showAllSources, setShowAllSources] = useState<boolean>(false);

  const uniqueLedgerStatuses = useMemo(
    () => Array.from(new Set(lciExchanges.map((e) => e.status))).sort(),
    []
  );

  const uniqueCompartments = useMemo(
    () => Array.from(new Set(lciExchanges.map((e) => e.compartment))).sort(),
    []
  );

  const filteredExchanges = useMemo(() => {
    const q = ledgerSearchQuery.toLowerCase();
    return lciExchanges.filter((item) => {
      const matchFu = ledgerFuFilter === 'all' || item.fu_id === ledgerFuFilter;
      const matchStatus = ledgerStatusFilter === 'all' || item.status === ledgerStatusFilter;
      const matchComp = ledgerCompartmentFilter === 'all' || item.compartment === ledgerCompartmentFilter;
      const matchSearch =
        !q ||
        item.exchange_id.toLowerCase().includes(q) ||
        item.process_id.toLowerCase().includes(q) ||
        item.process_name.toLowerCase().includes(q) ||
        item.flow_name.toLowerCase().includes(q) ||
        item.source_id.toLowerCase().includes(q) ||
        item.derivation.toLowerCase().includes(q);

      return matchFu && matchStatus && matchComp && matchSearch;
    });
  }, [ledgerFuFilter, ledgerStatusFilter, ledgerCompartmentFilter, ledgerSearchQuery]);

  const filteredSources = useMemo(() => {
    const q = sourceSearchQuery.toLowerCase();
    const chip = sourceAgencyChip.toLowerCase();
    return comprehensiveSources.filter((src) => {
      const matchStatus = sourceStatusFilter === 'all' || src.status === sourceStatusFilter;
      const matchCat = sourceCategoryFilter === 'all' || src.category === sourceCategoryFilter;
      const matchAgency =
        sourceAgencyChip === 'all' ||
        src.publisher_or_owner.toLowerCase().includes(chip) ||
        src.title.toLowerCase().includes(chip);

      const matchSearch =
        !q ||
        src.source_id.toLowerCase().includes(q) ||
        src.title.toLowerCase().includes(q) ||
        src.publisher_or_owner.toLowerCase().includes(q) ||
        src.sector.toLowerCase().includes(q) ||
        src.notes.toLowerCase().includes(q);

      return matchStatus && matchCat && matchAgency && matchSearch;
    });
  }, [sourceStatusFilter, sourceCategoryFilter, sourceAgencyChip, sourceSearchQuery]);

  const sourceCountsByStatus = useMemo(() => {
    let verified = 0;
    let approved = 0;
    let pending = 0;
    let rejected = 0;
    comprehensiveSources.forEach((s) => {
      if (s.status === 'VERIFIED') verified++;
      else if (s.status === 'APPROVED') approved++;
      else if (s.status === 'PENDING_QC') pending++;
      else if (s.status === 'REJECTED') rejected++;
    });
    return { verified, approved, pending, rejected, total: comprehensiveSources.length };
  }, []);

  const copyLedgerAsCsv = () => {
    const headers = [
      'ID',
      'FU',
      'Process_ID',
      'Process_Name',
      'Flow_Name',
      'Direction',
      'Compartment',
      'Amount',
      'Unit',
      'Source_ID',
      'Status'
    ];
    const rows = filteredExchanges.map((e) => [
      e.exchange_id,
      e.fu_id,
      e.process_id,
      e.process_name,
      e.flow_name,
      e.direction,
      e.compartment,
      e.amount,
      e.unit,
      e.source_id,
      e.status
    ]);
    void copyToClipboard(toCsvString(headers, rows)).then((ok) => {
      if (ok) {
        onNotify(`คัดลอกตาราง LCI ${filteredExchanges.length} รายการเป็น CSV แล้ว`);
      }
    });
  };

  return (
    <section className="dashboard-section" id="data-explorer-section">
      <div className="section-header-compact">
        <div>
          <span className="section-eyebrow font-mono">ข้อมูลตรวจสอบแล้วและคลังข้อมูล</span>
          <h2 className="section-heading">สถาปัตยกรรมข้อมูลและการดาวน์โหลด (Data Repository)</h2>
          <p className="section-subtext">
            คลิกแท็บเพื่อตรวจสอบสมดุลพลังงาน บัญชีแลกเปลี่ยน LCI และทะเบียนแหล่งข้อมูล
          </p>
        </div>

        <div className="deep-dive-tabs font-mono">
          <button
            type="button"
            className={`dd-tab ${activeTab === 'balance' ? 'active' : ''}`}
            onClick={() => onTabChange('balance')}
          >
            <TrendingDown size={13} />
            <span>สมดุลมวล-พลังงาน</span>
          </button>
          <button
            type="button"
            className={`dd-tab ${activeTab === 'ledger' ? 'active' : ''}`}
            onClick={() => onTabChange('ledger')}
          >
            <Database size={13} />
            <span>ตารางกระแส LCI 43 รายการ</span>
          </button>
          <button
            type="button"
            className={`dd-tab ${activeTab === 'sources' ? 'active' : ''}`}
            onClick={() => onTabChange('sources')}
          >
            <FileText size={13} />
            <span>{comprehensiveSources.length} แหล่งข้อมูลอ้างอิง</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Mass & Energy Balance */}
      {activeTab === 'balance' && (
        <div className="balance-grid-container">
          <div className="balance-card">
            <div className="balance-card-header">
              <Flame size={15} />
              <h4>สมดุลห่วงโซ่น้ำมันดิบ (Crude Oil Supply Balance)</h4>
              <span className="balance-badge font-mono">APERC 2024 / สนพ.</span>
            </div>
            <div className="balance-flow-diagram">
              <div className="flow-step">
                <span className="flow-step-label">อุปทานรวม</span>
                <span className="flow-step-val font-mono">992,000 bbl/d</span>
                <span className="flow-step-sub">นำเข้า 92% · ผลิตเอง 8%</span>
              </div>
              <ArrowRight size={14} className="flow-arrow-icon" />
              <div className="flow-step">
                <span className="flow-step-label">นำเข้ากลั่น 7 โรง</span>
                <span className="flow-step-val font-mono">1,021,000 bbl/d</span>
                <span className="flow-step-sub">กำลังกลั่นรวม 1,245k</span>
              </div>
              <ArrowRight size={14} className="flow-arrow-icon" />
              <div className="flow-step">
                <span className="flow-step-label">ความต้องการบริโภค</span>
                <span className="flow-step-val font-mono">953,000 bbl/d</span>
                <span className="flow-step-sub">ดีเซล 48% · เบนซิน 20%</span>
              </div>
            </div>

            <div className="allocation-title font-mono">
              <Scale size={13} /> สัดส่วนผลผลิตโรงกลั่นสำหรับปันส่วนตามมวล (ISO 14044 Mass Allocation)
            </div>
            <div className="stacked-yield-bar font-mono">
              {nationalPetroleumBalance.refineryYieldsPercent2022.map((y, i) => (
                <div
                  key={i}
                  className="yield-segment"
                  style={{ width: `${y.percent}%`, backgroundColor: y.color }}
                  title={`${y.product}: ${y.percent}%`}
                >
                  {y.percent >= 9 && `${y.percent}%`}
                </div>
              ))}
            </div>
            <div className="yield-legend-grid font-mono">
              {nationalPetroleumBalance.refineryYieldsPercent2022.map((y, i) => (
                <div key={i} className="yield-legend-item">
                  <span className="yield-dot" style={{ backgroundColor: y.color }} />
                  <span>
                    {y.product.split(' ')[0]}: <strong className="yield-pct">{y.percent}%</strong>
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="balance-card">
            <div className="balance-card-header">
              <Zap size={15} />
              <h4>สมดุลก๊าซธรรมชาติ (Natural Gas Supply & Offtake)</h4>
              <span className="balance-badge font-mono">EPPO 2566</span>
            </div>
            <div className="balance-flow-diagram">
              <div className="flow-step">
                <span className="flow-step-label">จัดหารวม</span>
                <span className="flow-step-val font-mono">4,452 MMSCFD</span>
                <span className="flow-step-sub">อ่าวไทย 62% · นำเข้า 38%</span>
              </div>
              <ArrowRight size={14} className="flow-arrow-icon" />
              <div className="flow-step">
                <span className="flow-step-label">ท่อก๊าซ ปตท.</span>
                <span className="flow-step-val font-mono">4,570 km</span>
                <span className="flow-step-sub">ทะเล 2,133 + บก 2,437</span>
              </div>
              <ArrowRight size={14} className="flow-arrow-icon" />
              <div className="flow-step">
                <span className="flow-step-label">ผู้ใช้หลัก</span>
                <span className="flow-step-val font-mono">ผลิตไฟฟ้า 62%</span>
                <span className="flow-step-sub">GSP 18% · โรงงาน 20%</span>
              </div>
            </div>

            <div className="allocation-title font-mono">
              <Layers size={13} /> สัดส่วนการจำหน่ายก๊าซแยกตามกลุ่มลูกค้า (ปตท. ปี 2566)
            </div>
            <div className="gas-sector-bars">
              {nationalPetroleumBalance.naturalGasMmscfd2023.sectors.map((sec, i) => (
                <div key={i} className="sector-bar-row font-mono">
                  <span className="sector-name">{sec.name}</span>
                  <div className="sector-track">
                    <div
                      className="sector-fill"
                      style={{ width: `${sec.percent * 3}%`, backgroundColor: sec.color }}
                    />
                  </div>
                  <span className="sector-val">
                    {sec.volume} MMSCFD ({sec.percent}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Master LCI Ledger */}
      {activeTab === 'ledger' && (
        <div className="ledger-container">
          <div className="ledger-filter-dock">
            <div className="filter-input-wrap grow">
              <Search size={14} className="input-icon" />
              <input
                type="text"
                placeholder="ค้นหารหัส กระบวนการ กระแสข้อมูล หรือแหล่งอ้างอิง..."
                value={ledgerSearchQuery}
                onChange={(e) => onLedgerSearchChange(e.target.value)}
                className="filter-text-input"
              />
            </div>

            <div className="filter-select-wrap">
              <Filter size={14} className="input-icon" />
              <select
                value={ledgerFuFilter}
                onChange={(e) => setLedgerFuFilter(e.target.value)}
                className="filter-select font-mono"
              >
                <option value="all">ทุกหน่วยหน้าที่</option>
                <option value="FU-1">FU-1 ดีเซล 1 ลิตร</option>
                <option value="FU-2">FU-2 ก๊าซ 1 GJ</option>
                <option value="FU-3">FU-3 ปิโตรเคมี 1 กก.</option>
              </select>
            </div>

            <div className="filter-select-wrap">
              <select
                value={ledgerStatusFilter}
                onChange={(e) => setLedgerStatusFilter(e.target.value)}
                className="filter-select font-mono"
              >
                <option value="all">สถานะข้อมูลทั้งหมด</option>
                {uniqueLedgerStatuses.map((st) => (
                  <option key={st} value={st}>
                    {st}
                  </option>
                ))}
              </select>
            </div>

            <div className="filter-select-wrap">
              <select
                value={ledgerCompartmentFilter}
                onChange={(e) => setLedgerCompartmentFilter(e.target.value)}
                className="filter-select font-mono"
              >
                <option value="all">สิ่งแวดล้อมทั้งหมด (Compartment)</option>
                {uniqueCompartments.map((comp) => (
                  <option key={comp} value={comp}>
                    {comp}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="copy-btn-action font-mono"
              onClick={copyLedgerAsCsv}
              title="คัดลอกตารางที่กรองแล้วเป็น CSV"
            >
              <Copy size={13} />
              <span>คัดลอก CSV</span>
            </button>

            <div className="ledger-count-pill font-mono">
              แสดง <strong>{filteredExchanges.length}</strong> จาก {lciExchanges.length} รายการ
            </div>
          </div>

          <div className="table-responsive-box tall-table">
            <table className="master-ledger-table font-mono">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>FU</th>
                  <th>กระบวนการ</th>
                  <th>กระแส (Flow)</th>
                  <th>ทิศทาง</th>
                  <th>ประเภท</th>
                  <th className="text-right">ปริมาณต่อ 1 FU</th>
                  <th>หน่วย</th>
                  <th>แหล่งอ้างอิง</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {filteredExchanges.slice(0, 50).map((row) => (
                  <tr key={row.exchange_id}>
                    <td className="font-bold text-white">{row.exchange_id}</td>
                    <td>
                      <span className="fu-tag-pill">{row.fu_id}</span>
                    </td>
                    <td>
                      <div className="table-proc-id">{row.process_id}</div>
                      <div className="table-proc-name">{row.process_name}</div>
                    </td>
                    <td>
                      <strong>{row.flow_name}</strong>
                    </td>
                    <td className="text-muted-subtle">{row.direction}</td>
                    <td>
                      <span className="font-mono text-xs text-muted-subtle uppercase-cell">
                        {row.compartment}
                      </span>
                    </td>
                    <td className="text-right font-bold text-white">{formatAmount(row.amount)}</td>
                    <td className="text-muted-subtle">{row.unit}</td>
                    <td>
                      <code className="source-link-tag">{row.source_id}</code>
                    </td>
                    <td>
                      <span className={`status-badge-mini ${getStatusBadgeClass(row.status)}`}>
                        {row.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Sources Registry */}
      {activeTab === 'sources' && (
        <div className="sources-container">
          <div className="source-filter-dock">
            <div className="filter-input-wrap grow">
              <Search size={14} className="input-icon" />
              <input
                type="text"
                placeholder="ค้นหาชื่อชุดข้อมูล, ผู้เผยแพร่, หรือ URL..."
                value={sourceSearchQuery}
                onChange={(e) => setSourceSearchQuery(e.target.value)}
                className="filter-text-input"
              />
            </div>

            <div className="filter-select-wrap">
              <select
                value={sourceStatusFilter}
                onChange={(e) => setSourceStatusFilter(e.target.value)}
                className="filter-select font-mono"
              >
                <option value="all">สถานะทั้งหมด ({sourceCountsByStatus.total})</option>
                <option value="VERIFIED">VERIFIED ({sourceCountsByStatus.verified})</option>
                <option value="APPROVED">APPROVED ({sourceCountsByStatus.approved})</option>
                <option value="PENDING_QC">PENDING_QC ({sourceCountsByStatus.pending})</option>
              </select>
            </div>

            <div className="filter-select-wrap">
              <select
                value={sourceCategoryFilter}
                onChange={(e) => setSourceCategoryFilter(e.target.value)}
                className="filter-select font-mono"
              >
                <option value="all">หมวดหมู่ทั้งหมด</option>
                <option value="Approved Main (Step 01)">Approved Main (01..063)</option>
                <option value="Digging Addendum (SRC-064..086)">Digging Addendum (064..086)</option>
                <option value="LCI Extension (SRC-087..094)">LCI Extension (087..094)</option>
                <option value="Mid-to-Mid Primary Audit (SRC-095..098)">Mid-to-Mid Primary Audit (095..098)</option>
              </select>
            </div>

            <div className="ledger-count-pill font-mono">
              {filteredSources.length} / {comprehensiveSources.length} แหล่งข้อมูล
            </div>
          </div>

          <div className="agency-filter-chip-row font-mono">
            <span className="agency-filter-prefix">หน่วยงานหลัก:</span>
            {AGENCY_CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                className={`agency-filter-chip ${sourceAgencyChip === chip.id ? 'is-active' : ''}`}
                onClick={() => setSourceAgencyChip(chip.id)}
              >
                {chip.label}
              </button>
            ))}
          </div>

          <div className="sources-card-grid sources-card-grid--spaced">
            {filteredSources.slice(0, showAllSources ? filteredSources.length : 30).map((src) => (
              <div key={src.source_id} className="source-item-card">
                <div className="source-card-top">
                  <span className="source-id-badge font-mono">{src.source_id}</span>
                  <span className={`status-badge-mini font-mono ${getStatusBadgeClass(src.status)}`}>
                    {src.status}
                  </span>
                </div>

                <h4 className="source-card-title">
                  {isHttpUrl(src.url_or_document_id) ? (
                    <a
                      href={src.url_or_document_id}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="source-title-link"
                    >
                      {src.title}
                      <ArrowUpRight size={13} className="inline-icon" />
                    </a>
                  ) : (
                    src.title
                  )}
                </h4>

                <div className="source-card-meta font-mono">
                  <span>
                    <strong>ผู้เผยแพร่:</strong> {src.publisher_or_owner}
                  </span>
                  <span>
                    <strong>หมวดหมู่:</strong> {src.category}
                  </span>
                  {src.notes && <span className="source-notes-excerpt">{src.notes}</span>}
                </div>
              </div>
            ))}
          </div>

          {filteredSources.length > 30 && (
            <div className="sources-expansion-footer">
              <button
                type="button"
                onClick={() => setShowAllSources(!showAllSources)}
                className="sources-expand-btn font-mono"
              >
                {showAllSources
                  ? '↑ ย่อรายการ'
                  : `↓ แสดงแหล่งข้อมูลทั้งหมด ${filteredSources.length} รายการ`}
              </button>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
