import React, { useEffect, useMemo, useState } from 'react';
import { AlertCircle, ArrowUpRight, Check, ChevronDown, Database, Download, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { downloadCsv, isHttpUrl } from '../../utils/format';
import '../../styles/source-registry.css';

type RegistryStatus = 'all' | 'approved' | 'rejected' | 'other';

interface RegistrySource {
  sourceId: string;
  title: string;
  publisher: string;
  url: string;
  accessedAt: string;
  sourceType: string;
  sector: string;
  rights: string;
  status: string;
  notes: string;
}

interface RegistryResponse {
  registryPath: string;
  updatedAt: string;
  total: number;
  statusCounts: Record<string, number>;
  sources: RegistrySource[];
}

function statusLabel(status: string): string {
  if (status === 'approved') return 'อนุมัติ';
  if (status === 'rejected') return 'ไม่อนุมัติ';
  return status === 'unspecified' ? 'ไม่ระบุสถานะ' : status;
}

function formatDate(value: string): string {
  if (!value) return 'ไม่ระบุ';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

export const SourceRegistryView: React.FC = () => {
  const [registry, setRegistry] = useState<RegistryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<RegistryStatus>('all');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const loadRegistry = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/sources/registry', { headers: { Accept: 'application/json' } });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || 'โหลดทะเบียนแหล่งข้อมูลไม่สำเร็จ');
      setRegistry(payload as RegistryResponse);
      setError('');
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'เชื่อมต่อทะเบียนแหล่งข้อมูลไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadRegistry(); }, []);

  const sources = registry?.sources ?? [];
  const sectors = useMemo(() => Array.from(new Set(sources.map((source) => source.sector).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'th')), [sources]);
  const counts = useMemo(() => ({
    approved: registry?.statusCounts.approved ?? 0,
    rejected: registry?.statusCounts.rejected ?? 0,
    other: Object.entries(registry?.statusCounts ?? {}).filter(([status]) => status !== 'approved' && status !== 'rejected').reduce((sum, [, count]) => sum + count, 0)
  }), [registry]);

  const filteredSources = useMemo(() => {
    const query = searchQuery.trim().toLocaleLowerCase();
    return sources.filter((source) => {
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'other' ? source.status !== 'approved' && source.status !== 'rejected' : source.status === statusFilter);
      const matchesSector = sectorFilter === 'all' || source.sector === sectorFilter;
      const searchText = [source.sourceId, source.title, source.publisher, source.url, source.sourceType, source.sector, source.status, source.notes, source.rights].join(' ').toLocaleLowerCase();
      return matchesStatus && matchesSector && (!query || searchText.includes(query));
    });
  }, [sources, statusFilter, sectorFilter, searchQuery]);

  const exportFiltered = () => {
    downloadCsv(
      `CN230_source_registry_${statusFilter}_${new Date().toISOString().slice(0, 10)}.csv`,
      ['source_id', 'title', 'publisher_or_owner', 'url_or_document_id', 'accessed_at', 'source_type', 'sector', 'rights_or_terms', 'status', 'notes'],
      filteredSources.map((source) => [source.sourceId, source.title, source.publisher, source.url, source.accessedAt, source.sourceType, source.sector, source.rights, source.status, source.notes])
    );
  };

  return (
    <div className="source-registry-view">
      <main className="sr-content">
        <header className="sr-header">
          <div className="sr-heading">
            <span className="sr-eyebrow"><Database size={13} /> CN230 · SOURCE REGISTER</span>
            <h1>ทะเบียนแหล่งข้อมูล</h1>
            <p>รายการทั้งหมดจากทะเบียนโครงการ ทั้งแหล่งที่อนุมัติและไม่อนุมัติ พร้อมเหตุผลและข้อมูลอ้างอิง</p>
          </div>
          <div className="sr-header-actions">
            <button type="button" className="sr-action-button" onClick={() => void loadRegistry()} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'sr-spin' : ''} /> รีเฟรชทะเบียน
            </button>
            <button type="button" className="sr-action-button is-primary" onClick={exportFiltered} disabled={!filteredSources.length}>
              <Download size={14} /> ส่งออก CSV
            </button>
          </div>
        </header>

        <section className="sr-summary" aria-label="สรุปทะเบียนแหล่งข้อมูล">
          <article className="sr-summary-card is-total"><span>รายการในทะเบียน</span><strong>{loading && !registry ? '—' : (registry?.total ?? 0).toLocaleString('th-TH')}</strong><small>อ้างอิงจาก {registry?.registryPath || 'source registry'}</small></article>
          <article className="sr-summary-card is-approved"><span><i /> อนุมัติ</span><strong>{counts.approved.toLocaleString('th-TH')}</strong><small>ใช้พิจารณาเข้าสู่ pipeline</small></article>
          <article className="sr-summary-card is-rejected"><span><i /> ไม่อนุมัติ</span><strong>{counts.rejected.toLocaleString('th-TH')}</strong><small>ยังแสดงเหตุผลจากทะเบียน</small></article>
          {counts.other > 0 && <article className="sr-summary-card"><span>สถานะอื่น</span><strong>{counts.other.toLocaleString('th-TH')}</strong><small>ตรวจสถานะรายรายการ</small></article>}
        </section>

        <section className="sr-browser" aria-label="ค้นหาและกรองทะเบียนแหล่งข้อมูล">
          <div className="sr-toolbar">
            <div className="sr-status-filter" role="group" aria-label="กรองตามสถานะ">
              {([
                ['all', 'ทั้งหมด', registry?.total ?? 0],
                ['approved', 'อนุมัติ', counts.approved],
                ['rejected', 'ไม่อนุมัติ', counts.rejected],
                ...(counts.other ? [['other', 'สถานะอื่น', counts.other] as [RegistryStatus, string, number]] : [])
              ] as [RegistryStatus, string, number][]).map(([status, label, count]) => (
                <button key={status} type="button" className={`sr-status-tab ${statusFilter === status ? 'is-active' : ''}`} onClick={() => setStatusFilter(status)} aria-pressed={statusFilter === status}>
                  {label}<span>{count.toLocaleString('th-TH')}</span>
                </button>
              ))}
            </div>
            <label className="sr-search"><Search size={15} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="ค้นหารหัส ชื่อ หน่วยงาน หรือเหตุผล…" aria-label="ค้นหาทะเบียนแหล่งข้อมูล" /></label>
            <label className="sr-sector-filter"><span>หมวดข้อมูล</span><select value={sectorFilter} onChange={(event) => setSectorFilter(event.target.value)}><option value="all">ทุกหมวด</option>{sectors.map((sector) => <option value={sector} key={sector}>{sector}</option>)}</select><ChevronDown size={13} /></label>
          </div>

          <div className="sr-results-meta"><span>{loading ? 'กำลังโหลดทะเบียน…' : `แสดง ${filteredSources.length.toLocaleString('th-TH')} จาก ${(registry?.total ?? 0).toLocaleString('th-TH')} รายการ`}</span><span>จัดเรียงตามรหัส source</span></div>

          {error && <div className="sr-error" role="alert"><AlertCircle size={17} /><span>{error}</span><button type="button" onClick={() => void loadRegistry()}>ลองอีกครั้ง</button></div>}
          {loading && !registry && <div className="sr-loading" role="status"><span className="sr-loading-mark"><Database size={17} /></span><strong>กำลังอ่าน source registry</strong><small>docs/source_registry/source_registry.csv</small></div>}
          {!loading && !error && filteredSources.length === 0 && <div className="sr-empty"><Search size={20} /><strong>ไม่พบรายการที่ตรงกับตัวกรอง</strong><span>ลองเปลี่ยนสถานะ หมวดข้อมูล หรือคำค้นหา</span></div>}

          <div className="sr-source-list">
            {filteredSources.map((source) => (
              <article className="sr-source-card" key={source.sourceId}>
                <div className="sr-source-card-main">
                  <div className="sr-source-identifiers"><code>{source.sourceId || 'NO ID'}</code><span className={`sr-status-pill ${source.status}`}><i />{statusLabel(source.status)}</span>{source.sourceType && <span className="sr-type-pill">{source.sourceType}</span>}</div>
                  <h2>{source.title || 'ไม่มีชื่อแหล่งข้อมูล'}</h2>
                  <p className="sr-publisher">{source.publisher || 'ไม่ระบุหน่วยงานเผยแพร่'}</p>
                </div>
                <div className="sr-source-meta">
                  <div><span>หมวดข้อมูล</span><strong>{source.sector || 'ไม่ระบุ'}</strong></div>
                  <div><span>วันที่เข้าถึง</span><strong>{formatDate(source.accessedAt)}</strong></div>
                  <div><span>สิทธิ์การใช้งาน</span><strong>{source.rights || 'ไม่ระบุ'}</strong></div>
                </div>
                {source.notes && <div className={`sr-source-note ${source.status === 'rejected' ? 'is-rejected' : ''}`}><span>{source.status === 'rejected' ? 'เหตุผล / หมายเหตุ' : 'หมายเหตุ'}</span><p>{source.notes}</p></div>}
                <footer className="sr-source-footer">
                  {isHttpUrl(source.url) ? <a href={source.url} target="_blank" rel="noreferrer"><ExternalLink size={13} /> เปิดแหล่งข้อมูล <span>{source.url}</span><ArrowUpRight size={12} /></a> : <span className="sr-document-ref"><Check size={13} /> {source.url || 'ไม่มี URL หรือ document ID'}</span>}
                  <span className="sr-row-label">SOURCE REGISTRY</span>
                </footer>
              </article>
            ))}
          </div>

          {registry && <div className="sr-source-attribution">ข้อมูลจาก <code>{registry.registryPath}</code> · แก้ไขล่าสุด {formatDate(registry.updatedAt)}</div>}
        </section>
      </main>
    </div>
  );
};
