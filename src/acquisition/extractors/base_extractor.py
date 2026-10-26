"""
=============================================================================
แม่แบบสัญญามาตรฐานการดึงข้อมูล (Base Extractor Contract / Protocol)
=============================================================================
หน้าที่หลัก:
1. Unified Extractor Contract:
   - กำหนด Interface มาตรฐานด้วย Abstract Base Class (ABC)
   - ทุก Extractor จะต้องสืบทอดคลาสนี้และ implement เมธอด `extract()`
   - Input: (url, preferred_type, year_be, month)
   - Output: (raw_bytes, final_url, file_extension) สภาพดิบ 100% เหมือนกันทุกเว็บ
2. Open-Closed Strategy Pattern:
   - บังคับ implement `@classmethod can_handle(url)` เพื่อให้แต่ละ Extractor ตัดสินใจเองว่ารองรับ URL หรือไม่
   - ตัว Router ค้นหาและส่งมอบงานแบบ Polymorphism โดยไม่ต้องแก้ if-else
3. Common Network Utilities:
   - จัดเตรียมระบบเชื่อมต่อเครือข่ายส่วนกลาง (http_get_bytes, SSL Bypass, Windows DNS Patch)
=============================================================================
"""

import socket
import ssl
import sys
import time
import urllib.request
from abc import ABC, abstractmethod
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Windows DNS Patch สำหรับ data.go.th ป้องกันปัญหา Errno 11002 getaddrinfo failed
# ---------------------------------------------------------------------------
_orig_getaddrinfo = socket.getaddrinfo

def _custom_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    try:
        return _orig_getaddrinfo(host, port, family, type, proto, flags)
    except socket.gaierror:
        if host == "data.go.th":
            return _orig_getaddrinfo("104.18.25.9", port, family, type, proto, flags)
        raise

socket.getaddrinfo = _custom_getaddrinfo


# =============================================================================
# คลาสแม่แบบมาตรฐาน (Base Extractor Class)
# =============================================================================
class BaseExtractor(ABC):
    """
    คลาสแม่แบบมาตรฐานสำหรับตัวดึงข้อมูลจากเว็บไซต์ทุกประเภท
    บังคับใช้สัญญาเดียวกัน (Unified Extractor Contract)
    """

    @classmethod
    @abstractmethod
    def can_handle(cls, url: str) -> bool:
        """
        ตรวจสอบว่า Extractor คลาสนี้รองรับสถาปัตยกรรมของ URL ที่ระบุหรือไม่
        (ตามหลัก Open-Closed Principle ของ Strategy Pattern)
        """
        pass

    @abstractmethod
    def extract(
        self,
        url: str,
        preferred_type: str = "CSV",
        year_be: int = 2567,
        month: int = 8,
        **kwargs,
    ) -> tuple[bytes, str, str]:
        """
        เมธอดมาตรฐานสำหรับการดึงข้อมูลจากเว็บไซต์
        
        พารามิเตอร์ (Input):
            url (str): ลิงก์ URL ต้นทางของชุดข้อมูล
            preferred_type (str): ชนิดไฟล์ที่คาดหวัง เช่น CSV, XLSX, HTML
            year_be (int): งวดปี พ.ศ. (สำหรับเว็บที่มีงวดรายเดือน/ปี เช่น DMF)
            month (int): งวดเดือน (1 ถึง 12)
            
        ค่าที่ส่งกลับ (Output):
            tuple[bytes, str, str]:
                - bytes_data: ข้อมูลไบนารีสภาพดิบ 100% (Untouched Raw Bytes)
                - final_url: ลิงก์ URL ปลายทางที่ดาวน์โหลดข้อมูลมาจริง
                - extension: นามสกุลไฟล์จริง เช่น csv, xlsx, html
        """
        pass

    @staticmethod
    def get_ssl_context():
        """สร้าง SSL Context สำหรับ bypass ปัญหา SSL Cert ของเว็บราชการ"""
        ctx = ssl.create_default_context()
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
        return ctx

    @classmethod
    def http_get_bytes(cls, url: str, timeout: int = 25, max_retries: int = 3) -> bytes:
        """
        ดาวน์โหลดข้อมูลไบนารีจาก URL ผ่าน HTTP GET
        - พยายามใช้ไลบรารี requests ก่อน หากไม่มีจะสลับไปใช้ urllib ในตัว
        - มีระบบ Retry 3 ครั้ง ป้องกันเน็ตสะดุด
        """
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
        }

        # 1. พยายามใช้ requests library ก่อน
        try:
            import requests
            import urllib3
            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
            for attempt in range(max_retries):
                try:
                    resp = requests.get(url, headers=headers, timeout=timeout, verify=False)
                    if resp.status_code == 200 and len(resp.content) > 0:
                        return resp.content
                except Exception:
                    time.sleep(1)
        except ImportError:
            pass

        # 2. กรณีไม่มี requests ให้ใช้ urllib ในตัว Python
        ctx = cls.get_ssl_context()
        req = urllib.request.Request(url, headers=headers)
        last_err = None
        for attempt in range(max_retries):
            try:
                with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                    data = resp.read()
                    if len(data) > 0:
                        return data
            except Exception as e:
                last_err = e
                time.sleep(1)

        if last_err:
            raise last_err
        return b""


# =============================================================================
# ตัวคัดเลือก Extractor อัตโนมัติ (Polymorphic Strategy Router)
# =============================================================================
def get_registered_extractors() -> list[type[BaseExtractor]]:
    """รายชื่อคลาส Extractor ที่ลงทะเบียนไว้ในระบบ เรียงตามลำดับความเจาะจง"""
    from direct_extractor import DirectExtractor
    from portal_extractor import PortalExtractor
    from form_extractor import FormExtractor

    return [DirectExtractor, PortalExtractor, FormExtractor]


def resolve_extractor(url: str) -> BaseExtractor:
    """
    ตรวจสอบสถาปัตยกรรมของเว็บไซต์ปลายทาง และสร้าง Object Extractor ที่ตรงประเภท
    ผ่านกลไก can_handle() ของแต่ละคลาสตามหลัก Strategy Pattern
    """
    clean_url = url.strip()
    for extractor_cls in get_registered_extractors():
        if extractor_cls.can_handle(clean_url):
            return extractor_cls()

    # Fallback กรณีไม่มีตัวใดตรง
    from form_extractor import FormExtractor
    return FormExtractor()


def route_and_extract(
    url: str,
    preferred_type: str = "CSV",
    year_be: int = 2567,
    month: int = 8,
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
    )
