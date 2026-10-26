"""
=============================================================================
ตัวดึงข้อมูลประเภทที่ 1: ลิงก์ไฟล์โดยตรง (Direct File Extractor)
=============================================================================
ลักษณะของเป้าหมาย:
- URL ที่ลงท้ายด้วยนามสกุลไฟล์สำเร็จรูป เช่น .csv, .xlsx, .xls, .pdf, .zip
- ดึงสตรีมไบนารีสภาพเดิม 100% ตรงจากเซิร์ฟเวอร์ไฟล์ต้นทาง
=============================================================================
"""

from urllib.parse import urlparse
from base_extractor import BaseExtractor


class DirectExtractor(BaseExtractor):
    """ตัวดึงไฟล์โดยตรงจาก URL สถิต"""

    SUPPORTED_EXTENSIONS = (".xlsx", ".xls", ".csv", ".pdf", ".zip", ".json")

    @classmethod
    def can_handle(cls, url: str) -> bool:
        """ตรวจสอบว่าเป้าหมายเป็นลิงก์ไฟล์ตรงตามนามสกุลที่กำหนดหรือไม่"""
        path_lower = urlparse(url.strip()).path.lower()
        return any(path_lower.endswith(ext) for ext in cls.SUPPORTED_EXTENSIONS)

    def extract(
        self,
        url: str,
        preferred_type: str = "CSV",
        year_be: int = 2567,
        month: int = 8,
        **kwargs,
    ) -> tuple[bytes, str, str]:
        """
        ดึงไฟล์โดยตรงจากลิงก์ URL สถิต
        คืนค่า: (raw_bytes, final_url, file_extension)
        """
        clean_url = url.strip()
        parsed = urlparse(clean_url)
        
        # ตรวจสอบนามสกุลไฟล์จาก path
        ext = "csv"
        for candidate in self.SUPPORTED_EXTENSIONS:
            if parsed.path.lower().endswith(candidate):
                ext = candidate.replace(".", "").lower()
                break

        print(f"[DIRECT] กำลังดาวน์โหลดไฟล์โดยตรง ({ext}): {clean_url}")
        content_bytes = self.http_get_bytes(clean_url, timeout=30)
        
        if not content_bytes or len(content_bytes) == 0:
            raise ValueError(f"ไม่สามารถดาวน์โหลดไฟล์โดยตรงจาก: {clean_url}")

        return content_bytes, clean_url, ext


# Functional Wrapper เพื่อความสะดวกในการเรียกใช้งานโดยตรง
def extract_direct_file(url: str, preferred_type: str = "CSV", **kwargs) -> tuple[bytes, str, str]:
    return DirectExtractor().extract(url=url, preferred_type=preferred_type, **kwargs)
