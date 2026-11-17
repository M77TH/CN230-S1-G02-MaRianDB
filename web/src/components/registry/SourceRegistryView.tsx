import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ArrowUpRight, CalendarDays, ChevronDown, ClipboardList, Database, Download, FileText, Layers, MessageSquareText, RefreshCw, Scale, Search } from 'lucide-react';
import { downloadCsv, isHttpUrl } from '../../utils/format';
import '../../styles/source-registry.css';
import '../../styles/page-header-shared.css';

type RegistryStatus = 'all' | 'approved' | 'rejected' | 'supporting' | 'other';

interface EvidenceAsset {
  figure: string;
  caption: string;
  path: string;
  sha256: string;
  publicUrl?: string;
}

interface RegistrySource {
  sourceId: string;
  legacySourceId?: string;
  title: string;
  publisher: string;
  url: string;
  accessedAt: string;
  sourceType: string;
  sector: string;
  rights: string;
  status: string;
  notes: string;
  sourceUrls?: string[];
  sourceOverview?: string;
  verifiedFindings?: string;
  limitations?: string;
  verificationMethod?: string;
  lciUsage?: string;
  linkedSourceIds?: string[];
  processIds?: string[];
  exchangeIds?: string[];
  evidenceCount?: number;
  evidenceAssets?: EvidenceAsset[];
}

interface RegistryResponse {
  registryPath: string;
  updatedAt: string;
  registrySha256?: string;
  tsrcRegistrySha256?: string;
  total: number;
  statusCounts: Record<string, number>;
  sources: RegistrySource[];
}

function statusLabel(status: string): string {
  if (status === 'approved') return 'อนุมัติ';
  if (status === 'rejected') return 'ไม่อนุมัติ';
  if (status === 'supporting') return 'เอกสารอ้างอิง';
  return status === 'unspecified' ? 'ไม่ระบุสถานะ' : status;
}

function formatDate(value: string): string {
  if (!value) return 'ไม่ระบุ';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('th-TH', { year: 'numeric', month: 'short', day: 'numeric' });
}

function sourceHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function directSourceUrls(source: RegistrySource): string[] {
  const extraUrls = [...new Set((source.sourceUrls ?? []).filter((url) => isHttpUrl(url) && url !== source.url))];
  return extraUrls.length ? extraUrls : isHttpUrl(source.url) ? [source.url] : [];
}

interface SourceRegistryViewProps {
  sourceId?: string;
  onClearSource: () => void;
}

export const SourceRegistryView: React.FC<SourceRegistryViewProps> = ({ sourceId, onClearSource }) => {
  const [registry, setRegistry] = useState<RegistryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [statusFilter, setStatusFilter] = useState<RegistryStatus>('all');
  const [sectorFilter, setSectorFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const headingRef = useRef<HTMLHeadingElement>(null);

  const loadRegistry = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}source_registry.json`, { headers: { Accept: 'application/json' } });
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
  useEffect(() => {
    if (sourceId) headingRef.current?.focus();
  }, [sourceId]);

  const sources = useMemo(() => {
    return [...(registry?.sources ?? [])].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
  }, [registry]);
  const totalCount = sources.length;
  const sectors = useMemo(() => Array.from(new Set(sources.map((source) => source.sector).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'th')), [sources]);
  const counts = useMemo(() => ({
    approved: registry?.statusCounts.approved ?? 0,
    rejected: registry?.statusCounts.rejected ?? 0,
    supporting: registry?.statusCounts.supporting ?? 0,
    other: Object.entries(registry?.statusCounts ?? {}).filter(([status]) => status !== 'approved' && status !== 'rejected' && status !== 'supporting').reduce((sum, [, count]) => sum + count, 0)
  }), [registry]);
  const latestUpdatedAt = useMemo(() => {
    const dates = [registry?.updatedAt].filter((value): value is string => Boolean(value));
    return dates.sort((left, right) => right.localeCompare(left))[0] || '';
  }, [registry]);

  const filteredSources = useMemo(() => {
    if (sourceId) return sources.filter((source) => source.sourceId === sourceId);
    const query = searchQuery.trim().toLocaleLowerCase();
    return sources.filter((source) => {
      const matchesStatus = statusFilter === 'all'
        || (statusFilter === 'other' ? source.status !== 'approved' && source.status !== 'rejected' && source.status !== 'supporting' : source.status === statusFilter);
      const matchesSector = sectorFilter === 'all' || source.sector === sectorFilter;
      const searchText = [source.sourceId, source.legacySourceId, source.title, source.publisher, source.url, source.sourceType, source.sector, source.status, source.notes, source.rights, source.sourceOverview, source.verifiedFindings, source.limitations, source.verificationMethod, source.lciUsage, ...(source.sourceUrls ?? []), ...(source.linkedSourceIds ?? [])].join(' ').toLocaleLowerCase();
      return matchesStatus && matchesSector && (!query || searchText.includes(query));
    });
  }, [sources, sourceId, statusFilter, sectorFilter, searchQuery]);

  const exportFiltered = () => {
    downloadCsv(
      `CN230_source_registry_${statusFilter}_${new Date().toISOString().slice(0, 10)}.csv`,
      ['source_id', 'title', 'publisher_or_owner', 'url_or_document_id', 'accessed_at', 'source_type', 'sector', 'rights_or_terms', 'status', 'notes', 'source_overview', 'verified_findings', 'limitations_and_interpretation', 'verification_method', 'lci_usage', 'source_urls', 'linked_source_ids', 'evidence_count', 'evidence_assets', 'legacy_source_id'],
      filteredSources.map((source) => [source.sourceId, source.title, source.publisher, source.url, source.accessedAt, source.sourceType, source.sector, source.rights, source.status, source.notes, source.sourceOverview ?? '', source.verifiedFindings ?? '', source.limitations ?? '', source.verificationMethod ?? '', source.lciUsage ?? '', (source.sourceUrls ?? []).join(' | '), (source.linkedSourceIds ?? []).join(' | '), source.evidenceCount ?? '', (source.evidenceAssets ?? []).map((asset) => `${asset.figure}: ${asset.caption} (${asset.path})`).join(' | '), source.legacySourceId ?? ''])
    );
  };

  return (
    <div className="source-registry-view">
      <main className="sr-content">
        <header className="sr-header workspace-page-header">
          <div className="sr-heading workspace-page-heading">
            <span className="sr-eyebrow workspace-page-eyebrow"><ClipboardList size={13} /> CN230 · SOURCE REGISTER</span>
            <h1 ref={headingRef} tabIndex={-1}>Source Registry</h1>
            <p>ตรวจสอบทะเบียนแหล่งข้อมูล สถานะ ข้อจำกัด และหลักฐานอ้างอิง</p>
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
          <article className="sr-summary-card is-total"><span>รายการในทะเบียน</span><strong>{loading && !registry ? '—' : totalCount.toLocaleString('th-TH')}</strong><small>ทะเบียนแหล่งข้อมูล SRC</small></article>
          <article className="sr-summary-card is-approved"><span><i /> อนุมัติ</span><strong>{counts.approved.toLocaleString('th-TH')}</strong><small>ใช้พิจารณาเข้าสู่ pipeline</small></article>
          <article className="sr-summary-card is-rejected"><span><i /> ไม่อนุมัติ</span><strong>{counts.rejected.toLocaleString('th-TH')}</strong><small>ยังแสดงเหตุผลจากทะเบียน</small></article>
          {counts.supporting > 0 && <article className="sr-summary-card is-supporting"><span><i /> อ้างอิงสนับสนุน</span><strong>{counts.supporting.toLocaleString('th-TH')}</strong><small>SRC · หลักฐานประกอบและข้อจำกัด</small></article>}
          {counts.other > 0 && <article className="sr-summary-card"><span>สถานะอื่น</span><strong>{counts.other.toLocaleString('th-TH')}</strong><small>ตรวจสถานะรายรายการ</small></article>}
        </section>

        <section className="sr-browser" aria-label="ค้นหาและกรองทะเบียนแหล่งข้อมูล">
          {sourceId ? (
            <div className="sr-toolbar">
              <code>{sourceId}</code>
              <button type="button" className="sr-action-button" onClick={() => {
                onClearSource();
                headingRef.current?.focus();
              }}>ดูแหล่งข้อมูลทั้งหมด</button>
            </div>
          ) : <div className="sr-toolbar">
            <div className="sr-status-filter" role="group" aria-label="กรองตามสถานะ">
              {([
                ['all', 'ทั้งหมด', totalCount],
                ['approved', 'อนุมัติ', counts.approved],
                ['rejected', 'ไม่อนุมัติ', counts.rejected],
                ...(counts.supporting ? [['supporting', 'เอกสารอ้างอิง', counts.supporting] as [RegistryStatus, string, number]] : []),
                ...(counts.other ? [['other', 'สถานะอื่น', counts.other] as [RegistryStatus, string, number]] : [])
              ] as [RegistryStatus, string, number][]).map(([status, label, count]) => (
                <button key={status} type="button" className={`sr-status-tab ${statusFilter === status ? 'is-active' : ''}`} onClick={() => setStatusFilter(status)} aria-pressed={statusFilter === status}>
                  {label}<span>{count.toLocaleString('th-TH')}</span>
                </button>
              ))}
            </div>
            <label className="sr-search"><Search size={15} /><input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="ค้นหารหัส ชื่อ หน่วยงาน หรือเหตุผล…" aria-label="ค้นหาทะเบียนแหล่งข้อมูล" /></label>
            <label className="sr-sector-filter"><span>หมวดข้อมูล</span><select value={sectorFilter} onChange={(event) => setSectorFilter(event.target.value)}><option value="all">ทุกหมวด</option>{sectors.map((sector) => <option value={sector} key={sector}>{sector}</option>)}</select><ChevronDown size={13} /></label>
          </div>}

          <div className="sr-results-meta"><span aria-live="polite">{loading ? 'กำลังโหลดทะเบียน…' : `แสดง ${filteredSources.length.toLocaleString('th-TH')} จาก ${totalCount.toLocaleString('th-TH')} รายการ`}</span>{!sourceId && <span>จัดเรียงตามรหัส SRC</span>}</div>

          {error && <div className="sr-error" role="alert"><AlertCircle size={17} /><span>{error}</span><button type="button" onClick={() => void loadRegistry()}>ลองอีกครั้ง</button></div>}
          {loading && !registry && <div className="sr-loading" role="status"><span className="sr-loading-mark"><Database size={17} /></span><strong>กำลังอ่านทะเบียนแหล่งข้อมูล</strong><small>SRC registry + supporting evidence</small></div>}
          {!loading && !error && filteredSources.length === 0 && <div className="sr-empty"><Search size={20} /><strong>{sourceId ? `ไม่พบ ${sourceId} ในทะเบียน` : 'ไม่พบรายการที่ตรงกับตัวกรอง'}</strong><span>{sourceId ? 'ไปที่รายการทั้งหมดเพื่อค้นหาตามชื่อแหล่งข้อมูล' : 'ลองเปลี่ยนสถานะ หมวดข้อมูล หรือคำค้นหา'}</span></div>}

          <div className="sr-source-list" style={sourceId ? { gridTemplateColumns: 'minmax(0, 1fr)' } : undefined}>
            {filteredSources.map((source) => (
              <article className="sr-source-card" key={source.sourceId}>
                <header className="sr-source-header">
                  <div className="sr-source-identifiers">
                    <div className="sr-source-format">
                      <code>{source.sourceId || 'NO ID'}</code>
                      {source.sourceType && <span><FileText size={13} aria-hidden="true" />{source.sourceType}</span>}
                    </div>
                    <span className="sr-status-pill" data-status={source.status}>{statusLabel(source.status)}</span>
                  </div>
                  <h2>{source.title || 'ไม่มีชื่อแหล่งข้อมูล'}</h2>
                  <p className="sr-publisher">{source.publisher || 'ไม่ระบุหน่วยงานเผยแพร่'}</p>
                </header>
                <div className="sr-source-body">
                  <dl className="sr-source-meta">
                    <div><dt><Layers size={14} aria-hidden="true" />หมวดข้อมูล</dt><dd>{source.sector || 'ไม่ระบุ'}</dd></div>
                    <div><dt><CalendarDays size={14} aria-hidden="true" />วันที่เข้าถึง</dt><dd>{formatDate(source.accessedAt)}</dd></div>
                    <div><dt><Scale size={14} aria-hidden="true" />สิทธิ์การใช้งาน</dt><dd>{source.rights || 'ไม่ระบุ'}</dd></div>
                  </dl>
                  {source.notes && (
                    <div className="sr-source-note" data-status={source.status}>
                      <MessageSquareText size={16} aria-hidden="true" />
                      <div>
                        <strong>{source.status === 'rejected' ? 'เหตุผล / หมายเหตุ' : 'หมายเหตุ'}</strong>
                        <p>{source.notes}</p>
                      </div>
                    </div>
                  )}
                  {(source.legacySourceId || source.status === 'supporting') && <details className="sr-support-details" open={sourceId === source.sourceId || undefined}>
                    <summary><span>ข้อมูลการตรวจสอบ · {source.evidenceCount ?? 0} ภาพหลักฐาน</span><ChevronDown size={14} aria-hidden="true" /></summary>
                    <div className="sr-support-content">
                      {source.sourceOverview && <section><strong>ข้อมูลต้นทาง</strong><p>{source.sourceOverview}</p></section>}
                      {source.verifiedFindings && <section><strong>สิ่งที่เอกสารยืนยัน</strong><p>{source.verifiedFindings}</p></section>}
                      {source.verificationMethod && <section><strong>วิธีตรวจสอบ</strong><p>{source.verificationMethod}</p></section>}
                      {source.limitations && <section><strong>ข้อจำกัด / การตีความ</strong><p>{source.limitations}</p></section>}
                      {source.lciUsage && <section><strong>จุดเชื่อมโยงกับ LCI</strong><p>{source.lciUsage}</p></section>}
                      {!!source.linkedSourceIds?.length && <section><strong>แหล่งที่เชื่อมโยง</strong><p>{source.linkedSourceIds.join(' · ')}</p></section>}
                      {!!source.evidenceAssets?.length && <section><strong>หลักฐานที่จัดทำดัชนี</strong><ul>{source.evidenceAssets.map((asset, index) => <li key={`${asset.path}-${index}`}><span>{asset.figure ? `Fig. ${asset.figure} · ` : ''}{asset.caption || 'ภาพหลักฐาน'}</span><code>{asset.path} · SHA-256 {asset.sha256}</code>{asset.publicUrl ? <a href={asset.publicUrl} target="_blank" rel="noreferrer">เปิดภาพหลักฐาน</a> : <small>ไฟล์ภาพไม่ได้รวมในชุดนำเสนอแบบคงที่</small>}</li>)}</ul></section>}
                      {!!source.sourceUrls?.length && source.sourceUrls.length > 1 && <section><strong>ลิงก์ต้นทางเพิ่มเติม</strong><ul>{source.sourceUrls.slice(1).map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul></section>}
                    </div>
                  </details>}
                </div>
                <footer className="sr-source-footer">
                  {isHttpUrl(source.url) ? (
                    <a className="sr-source-link" href={source.url} target="_blank" rel="noreferrer" title={source.url}>
                      <span className="sr-source-link-action">หน้าเว็บต้นทาง <ArrowUpRight size={15} aria-hidden="true" /></span>
                      <span className="sr-source-host">{sourceHostname(source.url)}</span>
                    </a>
                  ) : (
                    <span className="sr-document-ref"><FileText size={15} aria-hidden="true" />{source.url || 'ไม่มี URL หรือ document ID'}</span>
                  )}
                  <div className="sr-extra-source-links" aria-label="ลิงก์ข้อมูลโดยตรง">
                      <span>ลิงก์ข้อมูลโดยตรง</span>
                      {directSourceUrls(source).map((url) => (
                        <a href={url} key={url} target="_blank" rel="noreferrer" title={url}>
                          {sourceHostname(url)}{url === source.url && <small> ใช้ URL หน้าเว็บเดียวกัน</small>} <ArrowUpRight size={12} aria-hidden="true" />
                        </a>
                      ))}
                  </div>
                </footer>
              </article>
            ))}
          </div>

          {registry && <div className="sr-source-attribution">ข้อมูลจาก <code>{registry.registryPath}</code> · SHA-256 SRC {registry.registrySha256 || 'ไม่ระบุ'} · แก้ไขล่าสุด {formatDate(latestUpdatedAt)}</div>}
        </section>
      </main>
    </div>
  );
};
