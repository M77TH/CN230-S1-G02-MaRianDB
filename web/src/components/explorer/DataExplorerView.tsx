import React, { useMemo, useState } from 'react';
import { Download, ExternalLink, Search, ShieldCheck } from 'lucide-react';
import { validatedProductionRecords, validatedRefineryRecords } from '../../data/validatedDatasets';
import { comprehensiveSources } from '../../data/comprehensiveSources';
import { downloadCsv, isHttpUrl } from '../../utils/format';
import '../../styles/views.css';

type DatasetMode = 'production' | 'refinery' | 'sources';

function getProductPillModifier(productType: string): string {
  if (productType === 'Crude Oil') return 'crude';
  if (productType === 'Natural Gas') return 'gas';
  return 'condensate';
}

function getProductLabel(productType: string): string {
  if (productType === 'Crude Oil') return 'น้ำมันดิบ';
  if (productType === 'Natural Gas') return 'ก๊าซธรรมชาติ';
  if (productType === 'Condensate') return 'คอนเดนเสท';
  return productType;
}

function getSourceStatusLabel(status: string): string {
  if (status === 'VERIFIED') return 'ยืนยันแล้ว';
  if (status === 'APPROVED') return 'อนุมัติแล้ว';
  if (status === 'PENDING_QC') return 'รอตรวจสอบ';
  if (status === 'REJECTED') return 'ไม่ผ่าน';
  return status;
}

export const DataExplorerView: React.FC = () => {
  const [datasetMode, setDatasetMode] = useState<DatasetMode>('production');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedProduct, setSelectedProduct] = useState<string>('All');
  const [selectedBasin, setSelectedBasin] = useState<string>('All');

  const filteredProduction = useMemo(() => {
    const q = searchQuery.toLowerCase();
    return validatedProductionRecords.filter((rec) => {
      const matchSearch =
        rec.fieldName.toLowerCase().includes(q) ||
        rec.fieldCode.toLowerCase().includes(q) ||
        rec.operator.toLowerCase().includes(q) ||
        rec.basin.toLowerCase().includes(q);

      const matchProduct = selectedProduct === 'All' || rec.productType === selectedProduct;
      const matchBasin = selectedBasin === 'All' || rec.basin === selectedBasin;

      return matchSearch && matchProduct && matchBasin;
    });
  }, [searchQuery, selectedProduct, selectedBasin]);

  const filteredSources = useMemo(() => {
    const q = searchQuery.toLowerCase();
    if (!q) return comprehensiveSources;
    return comprehensiveSources.filter(
      (src) =>
        src.source_id.toLowerCase().includes(q) ||
        src.title.toLowerCase().includes(q) ||
        src.publisher_or_owner.toLowerCase().includes(q) ||
        src.sector.toLowerCase().includes(q) ||
        src.notes.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const basins = useMemo(() => {
    const set = new Set(validatedProductionRecords.map((r) => r.basin));
    return ['All', ...Array.from(set)];
  }, []);

  const totalVolume = useMemo(
    () => filteredProduction.reduce((sum, r) => sum + r.productionVolume, 0),
    [filteredProduction]
  );

  const totalTJ = useMemo(
    () => filteredProduction.reduce((sum, r) => sum + r.energyEquivalentTJ, 0),
    [filteredProduction]
  );

  const sourceCounts = useMemo(() => {
    const verified = comprehensiveSources.filter(
      (s) => s.status === 'VERIFIED' || s.status === 'APPROVED'
    ).length;
    const pending = comprehensiveSources.filter((s) => s.status === 'PENDING_QC').length;
    return { verified, pending, total: comprehensiveSources.length };
  }, []);

  const datasetMeta = {
    production: {
      title: 'ข้อมูลการผลิตต้นน้ำ',
      subtitle: 'ปริมาณการผลิตน้ำมัน ก๊าซธรรมชาติ และคอนเดนเสท',
      reference: 'SRC-044 · SRC-045 · SRC-046',
      count: validatedProductionRecords.length
    },
    refinery: {
      title: 'สมดุลวัตถุดิบโรงกลั่น',
      subtitle: 'ข้อมูลการรับน้ำมันดิบจากแหล่งในประเทศและนำเข้า',
      reference: 'SRC-049',
      count: validatedRefineryRecords.length
    },
    sources: {
      title: 'ทะเบียนแหล่งข้อมูล',
      subtitle: 'สถานะการตรวจสอบ แหล่งเผยแพร่ และหลักฐานอ้างอิง',
      reference: 'SRC-001 → SRC-098',
      count: sourceCounts.total
    }
  }[datasetMode];

  const visibleRecordCount =
    datasetMode === 'production'
      ? filteredProduction.length
      : datasetMode === 'refinery'
        ? validatedRefineryRecords.length
        : filteredSources.length;

  const handleExportCSV = () => {
    const filename = `CN230_${datasetMode}_data_${new Date().toISOString().slice(0, 10)}.csv`;
    if (datasetMode === 'production') {
      downloadCsv(
        filename,
        ['ID', 'FieldCode', 'FieldName', 'Basin', 'ProductType', 'Year', 'Month', 'Volume', 'Unit', 'Energy_TJ', 'Operator', 'Source'],
        filteredProduction.map((r) => [
          r.id,
          r.fieldCode,
          r.fieldName,
          r.basin,
          r.productType,
          r.year,
          r.month,
          r.productionVolume,
          r.unit,
          r.energyEquivalentTJ,
          r.operator,
          r.sourceDataset
        ])
      );
    } else if (datasetMode === 'refinery') {
      downloadCsv(
        filename,
        ['RefineryCode', 'RefineryName', 'DomesticCrude_BBL', 'ImportedCrude_BBL', 'Total_BBL', 'PrimaryFeedstocks', 'Period', 'Source'],
        validatedRefineryRecords.map((r) => [
          r.refineryCode,
          r.refineryName,
          r.domesticCrudeIntakeBBL,
          r.importedCrudeIntakeBBL,
          r.totalCrudeIntakeBBL,
          r.primaryDomesticFeedstocks,
          r.monthYear,
          r.sourceDataset
        ])
      );
    }
  };

  return (
    <div className="explorer-view">
      <section className="explorer-intro">
        <div>
          <span className="explorer-intro-eyebrow">CN230 · คลังข้อมูลที่ตรวจสอบแล้ว</span>
          <h1>สำรวจข้อมูลปิโตรเลียมไทย</h1>
          <p>ค้นหาและกรองข้อมูลการผลิต สมดุลโรงกลั่น และทะเบียนแหล่งอ้างอิงจากชุดข้อมูลโครงการ</p>
        </div>
      </section>

      <div className="explorer-workspace">
        <aside className="explorer-dataset-sidebar" aria-label="เลือกชุดข้อมูล">
          <div className="explorer-dataset-sidebar-heading">
            <span>ชุดข้อมูล</span>
            <small>เลือกเพื่อเปิดดู</small>
          </div>

          <button
            type="button"
            onClick={() => setDatasetMode('production')}
            className={`explorer-dataset-choice ${datasetMode === 'production' ? 'is-selected' : ''}`}
            aria-pressed={datasetMode === 'production'}
          >
            <span className="explorer-dataset-choice-copy">
              <strong>การผลิตต้นน้ำ</strong>
              <small>SRC-044 / 045 / 046</small>
            </span>
            <span className="explorer-dataset-count">{validatedProductionRecords.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setDatasetMode('refinery')}
            className={`explorer-dataset-choice ${datasetMode === 'refinery' ? 'is-selected' : ''}`}
            aria-pressed={datasetMode === 'refinery'}
          >
            <span className="explorer-dataset-choice-copy">
              <strong>สมดุลโรงกลั่น</strong>
              <small>SRC-049</small>
            </span>
            <span className="explorer-dataset-count">{validatedRefineryRecords.length}</span>
          </button>
          <button
            type="button"
            onClick={() => setDatasetMode('sources')}
            className={`explorer-dataset-choice ${datasetMode === 'sources' ? 'is-selected' : ''}`}
            aria-pressed={datasetMode === 'sources'}
          >
            <span className="explorer-dataset-choice-copy">
              <strong>ทะเบียนแหล่งข้อมูล</strong>
              <small>หลักฐานและสถานะตรวจสอบ</small>
            </span>
            <span className="explorer-dataset-count">{sourceCounts.total}</span>
          </button>

          <div className="explorer-sidebar-note">
            <ShieldCheck size={14} />
            <span>ข้อมูลจากแหล่งอ้างอิงของโครงการ</span>
          </div>
        </aside>

        <section className="explorer-main-panel">
          <header className="explorer-panel-header">
            <div>
              <span className="explorer-panel-eyebrow">{datasetMeta.reference}</span>
              <h2>{datasetMeta.title}</h2>
              <p>{datasetMeta.subtitle}</p>
            </div>
            <div className="explorer-panel-actions">
              <span className="explorer-record-count">{visibleRecordCount.toLocaleString()} รายการ</span>
          {datasetMode !== 'sources' && (
            <button type="button" onClick={handleExportCSV} className="explorer-export-btn">
              <Download size={13} />
              <span>ส่งออก CSV</span>
            </button>
          )}
            </div>
          </header>

      {/* Secondary Controls (Search & Facets) */}
      {(datasetMode === 'production' || datasetMode === 'sources') && (
        <div className="explorer-subbar">
          <div className="explorer-search-box">
            <Search size={14} className="explorer-search-icon" />
            <input
              type="text"
              placeholder={
                datasetMode === 'production'
                  ? 'ค้นหาชื่อแหล่งผลิต ผู้ดำเนินการ หรือแอ่งตะกอน...'
                  : 'ค้นหารหัสแหล่งข้อมูล ชื่อ หรือหน่วยงาน...'
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="explorer-search-input"
            />
          </div>

          {datasetMode === 'production' && (
            <>
              <div className="explorer-filter-group">
                <span className="explorer-filter-label">ผลิตภัณฑ์:</span>
                {['All', 'Crude Oil', 'Natural Gas', 'Condensate'].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setSelectedProduct(p)}
                    className={`explorer-chip-btn ${selectedProduct === p ? 'is-active' : ''}`}
                  >
                    {p === 'All' ? 'ทั้งหมด' : p === 'Crude Oil' ? 'น้ำมันดิบ' : p === 'Natural Gas' ? 'ก๊าซธรรมชาติ' : 'คอนเดนเสท'}
                  </button>
                ))}
              </div>

              <div className="explorer-filter-group">
                <span className="explorer-filter-label">แอ่งตะกอน:</span>
                <select
                  value={selectedBasin}
                  onChange={(e) => setSelectedBasin(e.target.value)}
                  className="explorer-select"
                >
                  {basins.map((b) => (
                    <option key={b} value={b}>
                      {b === 'All' ? 'ทั้งหมด' : b}
                    </option>
                  ))}
                </select>
              </div>

              <div className="explorer-metrics">
                <div>
                  <span className="explorer-metric-label">พบ </span>
                  <span className="explorer-metric-val">{filteredProduction.length} รายการ</span>
                </div>
                <div>
                  <span className="explorer-metric-label">ปริมาณรวม: </span>
                  <span className="explorer-metric-val explorer-metric-val--amber">
                    {totalVolume.toLocaleString()}
                  </span>
                </div>
                <div>
                  <span className="explorer-metric-label">พลังงานรวม: </span>
                  <span className="explorer-metric-val explorer-metric-val--blue">
                    {totalTJ.toLocaleString(undefined, { maximumFractionDigits: 1 })} TJ
                  </span>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Main Table / Cards Content */}
      <div className="explorer-body">
        {datasetMode === 'production' && (
          <table className="explorer-table">
            <thead>
              <tr>
                <th>รหัสแหล่งผลิต</th>
                <th>ชื่อแหล่งผลิต</th>
                <th>แอ่งตะกอน</th>
                <th>ผลิตภัณฑ์</th>
                <th className="explorer-th-right">ช่วงข้อมูล</th>
                <th className="explorer-th-right">ปริมาณผลิต</th>
                <th className="explorer-th-right">พลังงาน (TJ)</th>
                <th>ผู้ดำเนินการ</th>
                <th>แหล่งอ้างอิง</th>
              </tr>
            </thead>
            <tbody>
              {filteredProduction.map((row) => (
                <tr key={row.id}>
                  <td className="explorer-cell-mono explorer-cell-secondary">{row.fieldCode}</td>
                  <td className="explorer-cell-strong">{row.fieldName}</td>
                  <td className="explorer-cell-secondary">{row.basin}</td>
                  <td>
                    <span className={`explorer-product-pill explorer-product-pill--${getProductPillModifier(row.productType)}`}>
                      {getProductLabel(row.productType)}
                    </span>
                  </td>
                  <td className="explorer-td-right explorer-cell-mono explorer-cell-muted">
                    {row.year}-{String(row.month).padStart(2, '0')}
                  </td>
                  <td className="explorer-td-right explorer-cell-mono explorer-cell-strong">
                    {row.productionVolume.toLocaleString()}{' '}
                    <span className="explorer-unit-sub">{row.unit}</span>
                  </td>
                  <td className="explorer-td-right explorer-cell-mono explorer-cell-amber">
                    {row.energyEquivalentTJ.toFixed(1)}
                  </td>
                  <td className="explorer-cell-secondary">{row.operator}</td>
                  <td className="explorer-cell-source">{row.sourceDataset}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {datasetMode === 'refinery' && (
          <table className="explorer-table explorer-table--refinery">
            <thead>
              <tr>
                <th>รหัสโรงกลั่น</th>
                <th>ชื่อโรงกลั่น</th>
                <th className="explorer-th-right">น้ำมันดิบในประเทศ (บาร์เรล)</th>
                <th className="explorer-th-right">น้ำมันดิบนำเข้า (บาร์เรล)</th>
                <th className="explorer-th-right">รับเข้ารวม (บาร์เรล)</th>
                <th>แหล่งน้ำมันดิบหลัก</th>
                <th>ช่วงข้อมูล</th>
                <th>แหล่งอ้างอิง</th>
              </tr>
            </thead>
            <tbody>
              {validatedRefineryRecords.map((ref) => (
                <tr key={ref.refineryCode}>
                  <td className="explorer-cell-mono explorer-cell-strong">{ref.refineryCode}</td>
                  <td className="explorer-cell-strong">{ref.refineryName}</td>
                  <td className="explorer-td-right explorer-cell-mono explorer-cell-amber">
                    {ref.domesticCrudeIntakeBBL.toLocaleString()}
                  </td>
                  <td className="explorer-td-right explorer-cell-mono explorer-cell-secondary">
                    {ref.importedCrudeIntakeBBL.toLocaleString()}
                  </td>
                  <td className="explorer-td-right explorer-cell-mono explorer-cell-bold-num">
                    {ref.totalCrudeIntakeBBL.toLocaleString()}
                  </td>
                  <td className="explorer-cell-secondary">{ref.primaryDomesticFeedstocks}</td>
                  <td className="explorer-cell-mono explorer-cell-muted">{ref.monthYear}</td>
                  <td className="explorer-cell-source">{ref.sourceDataset}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {datasetMode === 'sources' && (
          <div className="explorer-sources-wrap">
            <div className="explorer-sources-header">
              <div>
                <h3 className="explorer-sources-title">
                  <ShieldCheck size={18} color="#43542d" />
                  ทะเบียนแหล่งข้อมูลและการตรวจสอบ (SRC-001 → SRC-098)
                </h3>
                <p className="explorer-sources-subtitle">
                  รวบรวมแหล่งข้อมูลทางการ พร้อมสถานะการตรวจสอบ ลิงก์ต้นทาง และหลักฐานที่ตรวจสอบย้อนกลับได้
                </p>
              </div>
              <div className="explorer-sources-badges">
                <span className="explorer-status-pill explorer-status-pill--verified">
                  {sourceCounts.verified} ยืนยันแล้ว
                </span>
                <span className="explorer-status-pill explorer-status-pill--pending">
                  {sourceCounts.pending} รอตรวจสอบ
                </span>
                <span className="explorer-status-pill explorer-status-pill--total">
                  รวม {sourceCounts.total} แหล่ง
                </span>
              </div>
            </div>

            <div className="explorer-sources-grid">
              {filteredSources.map((src) => {
                const isVerified = src.status === 'VERIFIED' || src.status === 'APPROVED';
                return (
                  <div key={src.source_id} className="explorer-source-card">
                    <div className="explorer-source-main">
                      <div className="explorer-source-top">
                        <span className={`explorer-source-id ${isVerified ? 'is-verified' : ''}`}>
                          {src.source_id}
                        </span>
                        <span className={`explorer-source-status ${isVerified ? 'is-verified' : ''}`}>
                          {getSourceStatusLabel(src.status)}
                        </span>
                        <span className="explorer-source-name">{src.title}</span>
                      </div>
                      <div className="explorer-source-meta">
                        <strong>หน่วยงาน:</strong> {src.publisher_or_owner} · <strong>ภาคส่วน:</strong> {src.sector} ·{' '}
                        <strong>หมวดหมู่:</strong> {src.category}
                      </div>
                      <div className="explorer-source-notes">{src.notes}</div>
                    </div>

                    {isHttpUrl(src.url_or_document_id) ? (
                      <a
                        href={src.url_or_document_id}
                        target="_blank"
                        rel="noreferrer"
                        className="explorer-source-link"
                      >
                        <span>เปิดแหล่งข้อมูล</span>
                        <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="explorer-source-docref">เอกสารอ้างอิง</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
        </div>
        </section>
      </div>
    </div>
  );
};
