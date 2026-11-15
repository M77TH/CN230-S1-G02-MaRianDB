"""
=============================================================================
ตัวดึงข้อมูลประเภทที่ 4: เว็บสแครปปิ้งและเอกสารรายงาน (Web & Document Scraper)
=============================================================================
ลักษณะของเป้าหมาย:
- หน้าเว็บที่ต้องสกัดลิงก์ดาวน์โหลดเอกสารจาก HTML (Document Link Discovery):
  เช่น รายงานความยั่งยืน PTTEP (SRC-047) บน sustainability.pttep.com
- หน้าเว็บแสดงรายงาน HTML ทั่วไป (Web Snapshot)
=============================================================================
"""

import re
from urllib.parse import urlparse

try:
    from base_extractor import BaseExtractor
except ImportError:
    from .base_extractor import BaseExtractor


class WebExtractor(BaseExtractor):
    """ตัวดึงข้อมูลจากหน้าเว็บและสกัดลิงก์เอกสารอัตโนมัติ (Web Scraper & Snapshot)"""

    SUPPORTED_DOMAINS = (
        "sustainability.pttep.com",
        "pttep.com",
        "bangchak.co.th",
        "bsrc.co.th",
        "irpc.co.th",
        "sprc.co.th",
        "thaioilgroup.com",
        "pttgcgroup.com",
        "law.dmf.go.th",
        "optiwise.io",
        "shareinvestor.app",
        "listedcompany.com",
    )

    # คลังลิงก์ตรงสำหรับเอกสารรายงานสิ่งแวดล้อมและ MD&A ของโรงกลั่น (SRC-051 ถึง SRC-061)
    KNOWN_DOCUMENT_URLS = {
        # Bangchak Sustainability & MD&A
        "https://sustainability.bangchak.co.th/th/document/sustainability-reports": (
            "https://sustainability.bangchak.co.th/storage/esg-reporting-library/reporting-and-disclosure/sustainability-report/2024/bcp-sr2024-th.pdf"
        ),
        "https://investor.bangchak.co.th/th/document/financial-statements": (
            "https://investor.bangchak.co.th/th/document/viewer/stream/206118/management-discussion-and-analysis-q3-2026"
        ),
        # DMF GHG Calculation Guidelines
        "https://law.dmf.go.th/public/law/index/main": (
            "https://law.dmf.go.th/UserFiles/Law/311/2_เอกสารแนบท้ายประกาศ_คู่มือวิธี.pdf"
        ),
        # BSRC Sustainability & Financial Statements
        "https://www.bsrc.co.th/th/document/sustainability-reports": (
            "https://hub.optiwise.io/storage/122/sustainability-report/2024/bsrc-sd-report-2024-th.pdf"
        ),
        "https://www.bsrc.co.th/th/investor-relations/document/financial-statements": (
            "https://hub.optiwise.io/en/documents/228607/bsrc-fs-2q2026-th.pdf"
        ),
        # IRPC Sustainability & MD&A
        "https://irpc.co.th/sustainability/sustainability-performance-summary/": (
            "https://irpc.listedcompany.com/misc/or/20260325-irpc-or2025-th.pdf"
        ),
        "https://investor.irpc.co.th/th/downloads/financial-statements-and-mdna": (
            "https://core.shareinvestor.app/storage/downloads/irpc/mdna/0471NWS091120261715471220T.pdf"
        ),
        # SPRC Sustainability (www.sprc.co.th ถูก Imperva Incapsula บล็อก HTTP 503 จึงชี้ไปยัง One Report 2025 บน Investor Relations ซึ่งมีข้อมูล GHG/พลังงานปี 2566–2568 ครบถ้วน)
        "https://www.sprc.co.th/th/sustainability/SitePages/Sustainabilityreport.aspx": (
            "https://sprc.listedcompany.com/misc/ar/20260309-sprc-one-report-2025-th.pdf"
        ),
        # Thaioil Sustainability & One Report / MD&A
        "https://www.thaioilgroup.com/news-and-announcement/publications/": (
            "https://top.listedcompany.com/misc/one-report/20250228-top-one-report2024-th.pdf"
        ),
        "https://investor.thaioilgroup.com/th/downloads/one-report": (
            "https://top.listedcompany.com/misc/one-report/20260225-top-one-report2025-th.pdf"
        ),
        # PTTGC Integrated Sustainability Report
        "https://sustainability.pttgcgroup.com/th/document/integrated-sustainability-reports": (
            "https://sustainability.pttgcgroup.com/storage/document/sustainability-performance-data/sustainability-performance-data.pdf"
        ),
    }

    @classmethod
    def can_handle(cls, url: str) -> bool:
        """ตรวจสอบว่า URL เป็นหน้าเว็บสแครปปิ้งหรือรายงานสิ่งแวดล้อมที่รองรับ"""
        clean_url = url.strip().lower()
        domain = urlparse(clean_url).netloc.lower()
        if any(d in domain for d in cls.SUPPORTED_DOMAINS):
            return True
        # รองรับกรณีหน้าเว็บทั่วไปที่ไม่ได้ลงท้ายด้วยนามสกุลไฟล์ตรง
        return False

    def _extract_pttep_pdf(self, clean_url: str) -> tuple[bytes, str, str] | None:
        """สกัดลิงก์ดาวน์โหลด PDF รายงานสิ่งแวดล้อมจากหน้าเว็บความยั่งยืน PTTEP"""
        r_html = self.http_get_bytes(clean_url, timeout=15)
        html_text = r_html.decode("utf-8", errors="ignore")
        pdf_match = re.search(
            r'href=[\'"]([^\'"]*environmental-performance-data[^\'"]*\.pdf)[\'"]',
            html_text,
            re.IGNORECASE,
        )
        if pdf_match:
            pdf_rel = pdf_match.group(1)
            pdf_url = pdf_rel if pdf_rel.startswith("http") else f"https://sustainability.pttep.com{pdf_rel}"
            print(f"  {'[SCRAPER]':<10}พบเอกสาร PDF รายงานสิ่งแวดล้อม PTTEP: {pdf_url}")
            pdf_bytes = self.http_get_bytes(pdf_url, timeout=30)
            if pdf_bytes and pdf_bytes.startswith(b"%PDF"):
                print(f"  {'[SCRAPER]':<10}ดาวน์โหลดเอกสาร PDF สำเร็จ: {len(pdf_bytes):,} bytes")
                return pdf_bytes, pdf_url, "pdf"
        return None

    def extract(
        self,
        url: str,
        preferred_type: str = "HTML",
        year_be: int = 2567,
        month: int = 8,
        **kwargs,
    ) -> tuple[bytes, str, str]:
        """
        สกัดเอกสารหรือดึง Snapshot หน้าเว็บดิบ 100%
        คืนค่า: (raw_bytes, final_url, file_extension)
        """
        clean_url = url.strip()

        # 1. ตรวจสอบคลังลิงก์ตรงสำหรับเอกสารรายงานสิ่งแวดล้อมและ MD&A (SRC-051 ถึง SRC-061)
        if clean_url in self.KNOWN_DOCUMENT_URLS:
            target_doc_url = self.KNOWN_DOCUMENT_URLS[clean_url]
            print(f"  {'[RESOLVE]':<10}พบลิงก์ตรงสำหรับเอกสาร: {target_doc_url}")
            doc_bytes = self.http_get_bytes(target_doc_url, timeout=90)
            if doc_bytes and len(doc_bytes) > 0:
                ext = "pdf"
                print(f"  {'[DOWNLOAD]':<10}ดาวน์โหลดเอกสารสำเร็จ ({len(doc_bytes):,} bytes | ชนิด: {ext})")
                return doc_bytes, target_doc_url, ext

        # 2. กรณีหน้าเว็บรายงานความยั่งยืน PTTEP (SRC-047)
        if "sustainability.pttep.com" in clean_url or "pttep" in clean_url.lower():
            pttep_res = self._extract_pttep_pdf(clean_url)
            if pttep_res:
                return pttep_res

        # 3. กรณีหน้าเว็บรายงาน HTML ทั่วไป (Web Snapshot)
        print(f"  {'[SCRAPER]':<10}กำลังดึง Snapshot หน้าเว็บดิบ: {clean_url}")
        bytes_data = self.http_get_bytes(clean_url, timeout=15)

        if not bytes_data or len(bytes_data) == 0:
            raise ValueError(f"ไม่สามารถดึงข้อมูลหน้าเว็บจาก: {clean_url}")

        ext = "html" if preferred_type.strip().upper() == "HTML" else preferred_type.strip().lower()
        return bytes_data, clean_url, ext


# Functional Wrapper เพื่อความสะดวกในการเรียกใช้งานโดยตรง
def extract_web(url: str, preferred_type: str = "HTML", **kwargs) -> tuple[bytes, str, str]:
    return WebExtractor().extract(url=url, preferred_type=preferred_type, **kwargs)
