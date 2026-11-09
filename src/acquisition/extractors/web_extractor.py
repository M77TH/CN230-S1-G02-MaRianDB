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
    )

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

        # 1. กรณีหน้าเว็บรายงานความยั่งยืน PTTEP (SRC-047)
        if "sustainability.pttep.com" in clean_url or "pttep" in clean_url.lower():
            pttep_res = self._extract_pttep_pdf(clean_url)
            if pttep_res:
                return pttep_res

        # 2. กรณีหน้าเว็บรายงาน HTML ทั่วไป (Web Snapshot)
        print(f"  {'[SCRAPER]':<10}กำลังดึง Snapshot หน้าเว็บดิบ: {clean_url}")
        bytes_data = self.http_get_bytes(clean_url, timeout=15)

        if not bytes_data or len(bytes_data) == 0:
            raise ValueError(f"ไม่สามารถดึงข้อมูลหน้าเว็บจาก: {clean_url}")

        ext = "html" if preferred_type.strip().upper() == "HTML" else preferred_type.strip().lower()
        return bytes_data, clean_url, ext


# Functional Wrapper เพื่อความสะดวกในการเรียกใช้งานโดยตรง
def extract_web(url: str, preferred_type: str = "HTML", **kwargs) -> tuple[bytes, str, str]:
    return WebExtractor().extract(url=url, preferred_type=preferred_type, **kwargs)
