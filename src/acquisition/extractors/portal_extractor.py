"""
=============================================================================
ตัวดึงข้อมูลประเภทที่ 2: พอร์ทัลข้อมูลเปิดภาครัฐ (CKAN Open Data Portal Extractor)
=============================================================================
ลักษณะของเป้าหมาย:
- พอร์ทัลระบบเปิด เช่น data.go.th, catalog.eppo.go.th, catalog.dmf.go.th
- เข้าถึงข้อมูลผ่าน CKAN Action API: `/api/3/action/package_show?id=...`
- มีระบบป้องกันข้อผิดพลาด 3 ชั้น (3-Layer Error Prevention):
  1. ดึงผ่าน CKAN Action API พร้อมระบบ Retry อัตโนมัติและแจ้งสาเหตุชัดเจน
  2. หาก API ขัดข้อง จะสกัดลิงก์ดาวน์โหลดจากหน้าเว็บ HTML ของชุดข้อมูลโดยตรง (HTML Fallback)
  3. มีคลังลิงก์ตรงสำรอง (Known Direct Resource URLs) สำหรับเซิร์ฟเวอร์ราชการที่มักจำกัด Rate Limit
=============================================================================
"""

import re
import time
import urllib.parse
from urllib.parse import urlparse
import requests
import urllib3
try:
    from base_extractor import BaseExtractor
except ImportError:
    from .base_extractor import BaseExtractor

# ปิดคำเตือน SSL InsecureRequestWarning ชั่วคราวกรณีใบรับรองเว็บราชการบางแห่ง
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)


def _describe_error(err: Exception) -> str:
    """แปลง Exception เครือข่ายให้เป็นข้อความภาษาไทยที่ชัดเจนและเข้าใจง่าย"""
    err_name = type(err).__name__
    if isinstance(err, requests.exceptions.Timeout):
        return f"หมดเวลาการเชื่อมต่อ - เซิร์ฟเวอร์ต้นทางตอบสนองช้าเกินไป ({err_name})"
    if isinstance(err, requests.exceptions.SSLError):
        return f"ปัญหาใบรับรองความปลอดภัย SSL ของเว็บปลายทาง ({err_name})"
    if isinstance(err, requests.exceptions.ConnectionError):
        return f"การเชื่อมต่อถูกตัดหรือเซิร์ฟเวอร์ปลายทางปฏิเสธการเชื่อมต่อ ({err_name})"
    return f"{err_name}: {err}"


class PortalExtractor(BaseExtractor):
    """ตัวดึงข้อมูลจาก Open Data Portals (CKAN API, Datastore Dump, HTML & Direct Fallback)"""

    SUPPORTED_DOMAINS = (
        "data.go.th",
        "catalog.eppo.go.th",
        "catalog.dmf.go.th",
        "catalog.doeb.go.th",
    )

    # ลิงก์ดาวน์โหลดตรงสำรอง (Fallback Direct Resource URLs) ป้องกันปัญหา CKAN API ล่มหรือติด Rate Limit
    # ใช้ Open Government Data of Thailand (data.go.th) Datastore Dump ซึ่งเป็น Mirror ทางการที่เปิดให้บริการ 24/7
    KNOWN_RESOURCE_URLS = {
        "monthly-petroleum-production-2": "https://data.go.th/dataset/a8c2d159-86ec-45aa-b2b9-e16109fe16f6/resource/71ae6506-c87e-4b68-b769-cfd36a995db3/download/monthly-petroleum-production.csv",
        "monthly-petroleum-production": "https://data.go.th/dataset/a8c2d159-86ec-45aa-b2b9-e16109fe16f6/resource/71ae6506-c87e-4b68-b769-cfd36a995db3/download/monthly-petroleum-production.csv",
        "production-oil": "https://data.go.th/datastore/dump/9809b59e-5636-47d0-8447-03a5afafc21f?format=csv",
        "production-natural-gas": "https://data.go.th/datastore/dump/f86d5605-e407-461f-83d8-47f9b4bd0803?format=csv",
        "production-condensate": "https://data.go.th/datastore/dump/1304bcc1-22b1-4b2c-a4b5-954f40310ff6?format=csv",
    }

    @classmethod
    def can_handle(cls, url: str) -> bool:
        """ตรวจสอบว่าโดเมนของ URL สอดคล้องกับพอร์ทัลที่รองรับหรือไม่"""
        domain = urlparse(url.strip()).netloc.lower()
        return any(domain == d or domain.endswith("." + d) for d in cls.SUPPORTED_DOMAINS)

    def _scrape_download_url_from_html(self, sess: requests.Session, page_url: str, domain: str) -> str | None:
        """
        แผนสำรองชั้นที่ 2: หาก CKAN API ขัดข้อง ให้เปิดหน้าเว็บ Dataset แล้วค้นหาลิงก์ /download/ โดยตรง
        """
        try:
            r_html = sess.get(page_url, verify=False, timeout=(4, 15))
            if r_html.status_code == 200:
                matches = re.findall(r'href=["\']([^"\']+/resource/[^"\']+/download/[^"\']+)["\']', r_html.text)
                if matches:
                    dl_link = matches[0]
                    if dl_link.startswith("/"):
                        dl_link = f"https://{domain}{dl_link}"
                    return dl_link
        except Exception:
            pass
        return None

    def extract(
        self,
        url: str,
        preferred_type: str = "CSV",
        year_be: int = 2567,
        month: int = 8,
        **kwargs,
    ) -> tuple[bytes, str, str]:
        """
        เชื่อมต่อ CKAN API เพื่อดึงไฟล์ข้อมูลดิบ พร้อมระบบสำรองอัตโนมัติ (Self-Healing Fallback)
        คืนค่า: (raw_bytes, final_download_url, file_extension)
        """
        clean_url = url.strip()
        parsed = urlparse(clean_url)
        domain = parsed.netloc

        sess = requests.Session()
        sess.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json, text/plain, */*",
            "Accept-Language": "th-TH,th;q=0.9,en-US;q=0.8,en;q=0.7",
        })

        # 1. สกัด package_id จาก path ของ URL
        package_id = clean_url.rstrip("/").split("/")[-1]
        if "?" in package_id:
            package_id = package_id.split("?")[0]

        # 2. ค้นหา Resource ผ่าน CKAN API: package_show (Layer 1)
        api_url = f"https://{domain}/api/3/action/package_show?id={urllib.parse.quote(package_id)}"
        print(f"  {'[PORTAL]':<10}เชื่อมต่อ CKAN Catalog API ({domain})...")

        res_data = None
        last_api_error = "ไม่ทราบสาเหตุ"
        for attempt in range(1, 4):
            try:
                r_api = sess.get(api_url, verify=False, timeout=(4, 25))
                if r_api.status_code == 200:
                    res_data = r_api.json()
                    if res_data.get("success"):
                        break
                    else:
                        last_api_error = f"API ตอบกลับ success=False ({res_data.get('error', {})})"
                else:
                    last_api_error = f"เซิร์ฟเวอร์ตอบกลับ HTTP {r_api.status_code} ({r_api.reason})"
                    print(f"  {'[WARN]':<10}เรียก CKAN API รอบที่ {attempt}/3 ไม่สำเร็จ ({last_api_error}) -> รอ {attempt * 2} วินาที...")
                time.sleep(attempt * 2)
            except Exception as e:
                last_api_error = _describe_error(e)
                print(f"  {'[WARN]':<10}เรียก CKAN API รอบที่ {attempt}/3 ขัดข้อง ({last_api_error}) -> รอ {attempt * 2} วินาที...")
                time.sleep(attempt * 2)

        # 3. กรณี CKAN API ขัดข้อง: สลับไปใช้แผนสำรองอัตโนมัติ (Layer 2: HTML Scraping, Layer 3: Mirror, Layer 4: Known Direct URL)
        if not res_data or not res_data.get("success"):
            print(f"  {'[FALLBACK]':<10}CKAN API ขัดข้อง ({last_api_error}) -> สลับไปใช้ระบบค้นหาลิงก์สำรองอัตโนมัติ...")
            fallback_url = self._scrape_download_url_from_html(sess, clean_url, domain)

            # Layer 3: ตรวจสอบคลัง Known Direct URLs สำรอง (รวมถึง Mirror บน data.go.th)
            if not fallback_url and package_id in self.KNOWN_RESOURCE_URLS:
                fallback_url = self.KNOWN_RESOURCE_URLS[package_id]

            # Layer 4: ค้นหาจาก National Open Data Portal (data.go.th) อัตโนมัติ หากเซิร์ฟเวอร์ของหน่วยงานล่ม
            if not fallback_url and domain != "data.go.th":
                try:
                    mirror_api = f"https://data.go.th/api/3/action/package_show?id={urllib.parse.quote(package_id)}"
                    r_mirror = sess.get(mirror_api, verify=False, timeout=(4, 15))
                    if r_mirror.status_code == 200:
                        m_data = r_mirror.json()
                        if m_data.get("success"):
                            for m_res in m_data.get("result", {}).get("resources", []):
                                if m_res.get("datastore_active") and m_res.get("id"):
                                    fallback_url = f"https://data.go.th/datastore/dump/{m_res['id']}?format={preferred_type.lower()}"
                                    break
                except Exception:
                    pass

            if fallback_url:
                for attempt in range(1, 4):
                    try:
                        print(f"  {'[PORTAL]':<10}กำลังดาวน์โหลดจากลิงก์สำรองโดยตรง (รอบที่ {attempt}/3)...")
                        r_dl = sess.get(fallback_url, verify=False, timeout=(5, 45))
                        if r_dl.status_code == 200 and len(r_dl.content) > 0:
                            print(f"  {'[PORTAL]':<10}ดาวน์โหลดผ่านลิงก์สำรองสำเร็จ: {len(r_dl.content):,} bytes")
                            ext = "xlsx" if r_dl.content.startswith(b"PK") else preferred_type.lower()
                            return r_dl.content, fallback_url, ext
                        else:
                            last_api_error = f"HTTP {r_dl.status_code} ({r_dl.reason})"
                    except Exception as e:
                        last_api_error = _describe_error(e)
                    time.sleep(attempt * 2)

            raise ValueError(
                f"ไม่สามารถดึงข้อมูลจาก {domain} (ชุดข้อมูล: '{package_id}') ได้\n"
                f"            - สาเหตุล่าสุด : {last_api_error}\n"
                f"            - URL ที่เรียก  : {api_url}\n"
                f"            - คำแนะนำ     : เซิร์ฟเวอร์ต้นทางอาจล่มชั่วคราวหรือจำกัดการเชื่อมต่อ (Rate Limit) กรุณาลองรันใหม่อีกครั้ง"
            )

        resources = res_data.get("result", {}).get("resources", [])
        if not resources:
            raise ValueError(
                f"ไม่พบไฟล์ Resource ในชุดข้อมูล CKAN '{package_id}' บน {domain} "
                f"(ชุดข้อมูลอาจถูกลบหรือย้ายที่อยู่บนเว็บไซต์ต้นทาง)"
            )

        print(f"  {'[PORTAL]':<10}เชื่อมต่อ API สำเร็จ: พบ {len(resources)} Resources (Package ID: {package_id[:28]})")

        # ค้นหา Resource ตามชนิดไฟล์ที่คาดหวัง
        target_res = None
        pref_upper = preferred_type.strip().upper()
        for res in resources:
            if res.get("format", "").upper() == pref_upper:
                target_res = res
                break
        if not target_res:
            target_res = resources[0]

        res_id = target_res.get("id")
        res_url = target_res.get("url", "")
        res_format = target_res.get("format", preferred_type).lower()
        is_datastore = target_res.get("datastore_active", False)

        # 4. หากเป็น CSV และมี Datastore Active ให้ดึงจาก Datastore Dump ทันที
        if res_format == "csv" and is_datastore and res_id:
            dump_url = f"https://{domain}/datastore/dump/{res_id}?format=csv"
            try:
                print(f"  {'[PORTAL]':<10}กำลังดึงไฟล์จาก Datastore Dump...")
                r_dump = sess.get(dump_url, verify=False, timeout=(5, 30))
                if r_dump.status_code == 200 and len(r_dump.content) > 0:
                    print(f"  {'[PORTAL]':<10}ดึง Datastore Dump สำเร็จ: {len(r_dump.content):,} bytes")
                    return r_dump.content, dump_url, "csv"
            except Exception as e:
                print(f"  {'[WARN]':<10}Datastore Dump ขัดข้อง ({_describe_error(e)}) -> สลับไปใช้ Resource URL ปกติ...")

        # 5. ดาวน์โหลดจาก Resource URL โดยตรง
        if not res_url:
            raise ValueError(f"ชุดข้อมูล '{package_id}' บน {domain} ไม่มีลิงก์ Resource URL ให้ดาวน์โหลด")

        print(f"  {'[PORTAL]':<10}กำลังดาวน์โหลดไฟล์จาก Resource URL...")
        last_dl_error = "ไม่ทราบสาเหตุ"
        for attempt in range(1, 4):
            try:
                r_res = sess.get(res_url, verify=False, timeout=(5, 45))
                if r_res.status_code == 200 and len(r_res.content) > 0:
                    print(f"  {'[PORTAL]':<10}ดาวน์โหลดจาก Resource URL สำเร็จ: {len(r_res.content):,} bytes")
                    actual_ext = "xlsx" if r_res.content.startswith(b"PK") else res_format
                    return r_res.content, res_url, actual_ext
                else:
                    last_dl_error = f"HTTP {r_res.status_code} ({r_res.reason})"
                    print(f"  {'[WARN]':<10}ดาวน์โหลดรอบที่ {attempt}/3 ไม่สำเร็จ ({last_dl_error}) -> รอ {attempt * 2} วินาที...")
                time.sleep(attempt * 2)
            except Exception as e:
                last_dl_error = _describe_error(e)
                print(f"  {'[WARN]':<10}ดาวน์โหลดรอบที่ {attempt}/3 ขัดข้อง ({last_dl_error}) -> รอ {attempt * 2} วินาที...")
                time.sleep(attempt * 2)

        raise ValueError(
            f"ไม่สามารถดาวน์โหลดไฟล์จาก Resource URL ได้\n"
            f"            - สาเหตุล่าสุด : {last_dl_error}\n"
            f"            - Resource URL: {res_url}\n"
            f"            - คำแนะนำ     : ตรวจสอบการเชื่อมต่ออินเทอร์เน็ตหรือลองรันใหม่อีกครั้ง"
        )


# Functional Wrapper เพื่อความสะดวกในการเรียกใช้งานโดยตรง
def extract_portal(url: str, preferred_type: str = "CSV", **kwargs) -> tuple[bytes, str, str]:
    return PortalExtractor().extract(url=url, preferred_type=preferred_type, **kwargs)
