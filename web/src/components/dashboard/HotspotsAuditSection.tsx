import React from 'react';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { HOTSPOT_CARDS, ISO_AUDIT_PHASES } from './dashboardData';

export const HotspotsAuditSection: React.FC = () => {
  return (
    <section className="dashboard-section" id="hotspots-section">
      <div className="section-header-compact">
        <div>
          <span className="section-eyebrow font-mono text-emerald">จุดวิกฤตการปล่อยและการตรวจประเมิน ISO 14040/14044</span>
          <h2 className="section-heading">ยุทธศาสตร์ลดคาร์บอนระดับชาติและจุดวิกฤตตลอดวัฏจักร</h2>
          <p className="section-subtext">
            การวิเคราะห์จุดวิกฤต (Hotspot Analysis) และข้อเสนอแนะเชิงนโยบายทางวิศวกรรมสำหรับประเทศไทย มุ่งสู่เป้าหมาย Net Zero 2065
          </p>
        </div>

        <span className="pillar-badge-verified font-mono">
          <CheckCircle2 size={13} className="inline-icon text-emerald" />
          ผ่านเกณฑ์ขั้นที่ 4 ของ ISO 14044
        </span>
      </div>

      {/* 3 Sector Hotspot Matrix */}
      <div className="hotspot-matrix-grid">
        {HOTSPOT_CARDS.map((card) => (
          <div key={card.sectorTag} className="hotspot-card">
            <div className="hotspot-top font-mono">
              <span className="hotspot-sector-tag">{card.sectorTag}</span>
              <span className="hotspot-pct-badge">{card.pctBadge}</span>
            </div>
            <h3 className="hotspot-heading">{card.heading}</h3>
            <p className="hotspot-desc font-sans">{card.description}</p>
            <div className="hotspot-policy-box font-mono">
              <span className="hotspot-policy-title">ข้อเสนอแนะเชิงนโยบาย (Policy Roadmaps):</span>
              <div className="hotspot-policy-text font-sans">
                {card.roadmaps.map((line, i) => (
                  <React.Fragment key={line}>
                    {i > 0 && <br />}
                    {line}
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* ISO 14040/14044 Audit Compliance Certificate */}
      <div className="iso-audit-card font-mono">
        <div className="iso-audit-header">
          <ShieldCheck size={20} className="text-emerald" />
          <h4 className="iso-audit-title font-sans">
            การรับรองความถูกต้องตามระเบียบวิธีวิจัย ISO 14040 / 14044 Life Cycle Assessment
          </h4>
        </div>

        <div className="iso-checklist-grid">
          {ISO_AUDIT_PHASES.map((phase) => (
            <div key={phase.title} className="iso-check-item">
              <div className="iso-check-header">
                <CheckCircle2 size={13} />
                <span>{phase.title}</span>
              </div>
              <div className="iso-check-desc font-sans">{phase.description}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};
