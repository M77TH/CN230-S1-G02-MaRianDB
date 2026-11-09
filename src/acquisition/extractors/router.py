"""
=============================================================================
ตัวคัดเลือกและเชื่อมโยง Extractor อัตโนมัติ (Polymorphic Strategy Router)
=============================================================================
หน้าที่หลัก:
1. บริหารจัดการการลงทะเบียนของ Extractor Strategy ทั้งหมดในระบบ
2. รับ URL จาก Data Acquisition Engine และวิเคราะห์สถาปัตยกรรมปลายทางผ่าน `can_handle(url)`
3. ส่งมอบงาน (Polymorphic Dispatch) ให้กับ Extractor ที่เหมาะสมที่สุดอย่างเป็นระบบ
=============================================================================
"""

try:
    from base_extractor import BaseExtractor
    from direct_extractor import DirectExtractor
    from portal_extractor import PortalExtractor
    from form_extractor import FormExtractor
    from web_extractor import WebExtractor
except ImportError:
    from .base_extractor import BaseExtractor
    from .direct_extractor import DirectExtractor
    from .portal_extractor import PortalExtractor
    from .form_extractor import FormExtractor
    from .web_extractor import WebExtractor


def get_registered_extractors() -> list[type[BaseExtractor]]:
    """
    รายชื่อคลาส Extractor ที่ลงทะเบียนไว้ในระบบ
    เรียงตามลำดับความจำเพาะเจาะจง (Most specific to least specific):
    1. DirectExtractor: ตรวจสอบนามสกุลไฟล์ปลายทาง (.csv, .xlsx, .pdf, .zip, .json)
    2. PortalExtractor: ตรวจสอบ CKAN Open Data Domains (data.go.th, eppo, dmf, doeb)
    3. FormExtractor: ตรวจสอบระบบเว็บแอปพลิเคชันที่มีแบบฟอร์มเฉพาะ (TGO, DMF Supply)
    4. WebExtractor: ตรวจสอบการสกัดลิงก์เอกสารจากเว็บ (PTTEP) หรือบันทึก Web Snapshot
    """
    return [DirectExtractor, PortalExtractor, FormExtractor, WebExtractor]


def resolve_extractor(url: str) -> BaseExtractor:
    """
    ตรวจสอบสถาปัตยกรรมของเว็บไซต์ปลายทาง และสร้าง Object Extractor ที่ตรงประเภท
    ผ่านกลไก can_handle() ของแต่ละคลาสตามหลัก Strategy Pattern
    """
    clean_url = url.strip()
    for extractor_cls in get_registered_extractors():
        if extractor_cls.can_handle(clean_url):
            return extractor_cls()

    # Fallback สำหรับหน้าเว็บทั่วไป
    return WebExtractor()


def route_and_extract(
    url: str,
    preferred_type: str = "CSV",
    year_be: int = 2567,
    month: int = 8,
    **kwargs,
) -> tuple[bytes, str, str]:
    """
    ฟังก์ชัน Router ระดับบนสุด: ส่ง URL เข้า Extractor ที่เหมาะสม
    คืนค่า: (raw_bytes, final_url, file_extension)
    """
    extractor = resolve_extractor(url)
    return extractor.extract(
        url=url,
        preferred_type=preferred_type,
        year_be=year_be,
        month=month,
        **kwargs,
    )
