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

# ---------------------------------------------------------------------------
# Windows DNS Patch สำหรับ data.go.th ป้องกันปัญหา Errno 11002 getaddrinfo failed
# เมื่อรันบน Windows ที่เครือข่าย ISP บางแห่งค้นหาชื่อโดเมน .go.th ไม่พบ
# ---------------------------------------------------------------------------
_orig_getaddrinfo = socket.getaddrinfo


def _custom_getaddrinfo(host, port, family=0, type=0, proto=0, flags=0):
    try:
        return _orig_getaddrinfo(host, port, family, type, proto, flags)
    except socket.gaierror:
        if host == "data.go.th":
            # DNS Fallback สำหรับ National Open Data Portal บน Anycast CDN
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
            preferred_type (str): ชนิดไฟล์ที่คาดหวัง เช่น CSV, XLSX, HTML, PDF
            year_be (int): งวดปี พ.ศ. (สำหรับเว็บที่มีงวดรายเดือน/ปี เช่น DMF)
            month (int): งวดเดือน (1 ถึง 12)

        ค่าที่ส่งกลับ (Output):
            tuple[bytes, str, str]:
                - bytes_data: ข้อมูลไบนารีสภาพดิบ 100% (Untouched Raw Bytes)
                - final_url: ลิงก์ URL ปลายทางที่ดาวน์โหลดข้อมูลมาจริง
                - extension: นามสกุลไฟล์จริง เช่น csv, xlsx, html, pdf
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
    def http_get_bytes(
        cls,
        url: str,
        timeout: int = 15,
        max_retries: int = 3,
        backoff_factor: float = 1.5,
    ) -> bytes:
        """
        ดาวน์โหลดข้อมูลไบนารีจาก URL ผ่าน HTTP GET
        - ใช้ requests เป็นหลัก พร้อมการตรวจสอบ HTTP status ที่ชัดเจน
        - มีระบบ Retry พร้อม Exponential Backoff ป้องกันเน็ตสะดุด
        - กรณีไม่มี requests จะสลับไปใช้ urllib ในตัว Python
        """
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
        }

        # 1. พยายามใช้ไลบรารี requests ก่อน
        try:
            import requests
            import urllib3

            urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

            last_exc = None
            for attempt in range(1, max_retries + 1):
                try:
                    resp = requests.get(url, headers=headers, timeout=timeout, verify=False)
                    # หากเป็น Client Error 4xx (เช่น 404, 403) ให้แจ้งข้อผิดพลาดทันทีโดยไม่ retry ซ้ำ
                    if 400 <= resp.status_code < 500:
                        resp.raise_for_status()

                    if resp.status_code == 200 and len(resp.content) > 0:
                        return resp.content

                    # หากตอบรหัสอื่นที่ไม่ใช่ 200 หรือได้เนื้อหาว่าง ให้ระบุเป็น error
                    resp.raise_for_status()
                except requests.HTTPError as http_err:
                    if 400 <= getattr(http_err.response, "status_code", 0) < 500:
                        raise http_err
                    last_exc = http_err
                except Exception as e:
                    last_exc = e

                if attempt < max_retries:
                    time.sleep(attempt * backoff_factor)

            if last_exc:
                raise last_exc
            raise RuntimeError(f"ไม่สามารถดาวน์โหลดข้อมูลจาก {url} (เนื้อหาว่างเปล่า)")

        except ImportError:
            # 2. กรณีไม่มีไลบรารี requests ให้สลับไปใช้ urllib ของ Python มาตรฐาน
            ctx = cls.get_ssl_context()
            req = urllib.request.Request(url, headers=headers)
            last_err = None

            for attempt in range(1, max_retries + 1):
                try:
                    with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
                        data = resp.read()
                        if len(data) > 0:
                            return data
                except urllib.error.HTTPError as h_err:
                    if 400 <= h_err.code < 500:
                        raise h_err
                    last_err = h_err
                except Exception as e:
                    last_err = e

                if attempt < max_retries:
                    time.sleep(attempt * backoff_factor)

            if last_err:
                raise last_err
            raise RuntimeError(f"ไม่สามารถดาวน์โหลดข้อมูลจาก {url} ผ่าน urllib")


# =============================================================================
# Backward Compatibility Wrappers (เชื่อมต่อไปยัง router.py เพื่อป้องกัน Breaking Changes)
# =============================================================================
def get_registered_extractors() -> list[type[BaseExtractor]]:
    """ส่งต่อการเรียกไปยัง router.py"""
    try:
        from router import get_registered_extractors as _gre
    except ImportError:
        from .router import get_registered_extractors as _gre
    return _gre()


def resolve_extractor(url: str) -> BaseExtractor:
    """ส่งต่อการเรียกไปยัง router.py"""
    try:
        from router import resolve_extractor as _re
    except ImportError:
        from .router import resolve_extractor as _re
    return _re(url)


def route_and_extract(
    url: str,
    preferred_type: str = "CSV",
    year_be: int = 2567,
    month: int = 8,
    **kwargs,
) -> tuple[bytes, str, str]:
    """ส่งต่อการเรียกไปยัง router.py"""
    try:
        from router import route_and_extract as _rae
    except ImportError:
        from .router import route_and_extract as _rae
    return _rae(
        url=url,
        preferred_type=preferred_type,
        year_be=year_be,
        month=month,
        **kwargs,
    )
