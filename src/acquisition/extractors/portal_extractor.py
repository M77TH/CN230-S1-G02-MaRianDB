"""
============================================================
ตัวดึงข้อมูลประเภทที่ 1: พอร์ทัลข้อมูลเปิดและคลิกดาวน์โหลด (Portal Extractor)
============================================================
ลักษณะของเป้าหมาย:
- พอร์ทัลข้อมูลเปิดภาครัฐมาตรฐาน CKAN API และระบบรายการชุดข้อมูล:
  1. data.go.th (ศูนย์กลางข้อมูลเปิดภาครัฐ)
  2. catalog.eppo.go.th (ศูนย์สารสนเทศพลังงานแห่งชาติ สนพ.)
  3. catalog.dmf.go.th (ศูนย์ข้อมูลเปิด กรมเชื้อเพลิงธรรมชาติ)
  4. data.doeb.go.th (กรมธุรกิจพลังงาน)
- การทำงาน (Click-to-Download / API Resolution):
  1. ดึง package_id จาก URL ชุดข้อมูล
  2. เชื่อมต่อ CKAN API action: package_show เพื่อค้นหา Resource ID และปุ่มดาวน์โหลด
  3. รองรับ Datastore Dump ความเร็วสูง (/datastore/dump/{id}?format=csv)
  4. มีระบบ Automatic Retry 3 ครั้ง พร้อม Exponential Backoff สำหรับเซิร์ฟเวอร์ที่ตอบสนองช้า
============================================================
"""

import json
import re
import time
import urllib.parse
from urllib.parse import urlparse
import requests
import urllib3
from base_extractor import BaseExtractor

urllib3.disable_warnings()


class PortalExtractor(BaseExtractor):
    """ตัวดึงข้อมูลจาก Open Data Portals (CKAN & Click-to-Download)"""

    SUPPORTED_DOMAINS = ("data.go.th", "eppo.go.th", "doeb.go.th", "dmf.go.th", "ckan")

    # ลิงก์ตรงของไฟล์ Master สำหรับชุดข้อมูลสำคัญ ป้องกันปัญหา API 502/Timeout ชั่วคราว
    KNOWN_RESOURCE_URLS = {
        "production-oil": "https://catalog.dmf.go.th/dataset/d31a2911-071b-4b85-ab84-0717f0251061/resource/9809b59e-5636-47d0-8447-03a5afafc21f/download/production_oil.csv",
        "production-natural-gas": "https://catalog.dmf.go.th/dataset/ad91d31d-7e3b-48a3-b454-53c174156705/resource/f86d5605-e407-461f-83d8-47f9b4bd0803/download/production_gas.csv",
        "production-condensate": "https://catalog.dmf.go.th/dataset/d12c4281-6728-4542-a49f-da30d9919f4c/resource/1304bcc1-22b1-4b2c-a4b5-954f40310ff6/download/production_condensate.csv",
    }

    @classmethod
    def can_handle(cls, url: str) -> bool:
        """ตรวจสอบว่า URL สอดคล้องกับพอร์ทัล Open Data / CKAN หรือไม่"""
        parsed = urlparse(url.strip())
        domain = parsed.netloc.lower()
        path_lower = parsed.path.lower()
        is_portal_path = "dataset" in path_lower or "package" in path_lower
        return is_portal_path and any(k in domain for k in cls.SUPPORTED_DOMAINS)

    def extract(
        self,
        url: str,
        preferred_type: str = "CSV",
        year_be: int = 2567,
        month: int = 8,
        **kwargs,
    ) -> tuple[bytes, str, str]:
        """
        ดึงข้อมูลจาก Open Data Portal
        คืนค่า: (raw_bytes, final_url, file_extension)
        """
        clean_url = url.strip()
        parsed_url = urlparse(clean_url)
        domain = parsed_url.netloc

        # 1. ดึง package_id จาก URL
        pkg_match = re.search(r"dataset/([a-zA-Z0-9_\-]+)", parsed_url.path)
        package_id = pkg_match.group(1) if pkg_match else parsed_url.path.rstrip("/").split("/")[-1]

        sess = requests.Session()
        sess.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml,application/json;q=0.9,*/*;q=0.8",
        })

        # 2. กรณีมี Known Direct URL ให้ดาวน์โหลดตรงทันที (เร็วและเชื่อถือได้สูงสุด)
        if package_id in self.KNOWN_RESOURCE_URLS:
            direct_u = self.KNOWN_RESOURCE_URLS[package_id]
            for attempt in range(1, 4):
                try:
                    print(f"  [PORTAL] กำลังดาวน์โหลดไฟล์ตรง (รอบที่ {attempt}/3)...")
                    r_dl = sess.get(direct_u, verify=False, timeout=90)
                    if r_dl.status_code == 200 and len(r_dl.content) > 0:
                        print(f"  [PORTAL] ดาวน์โหลดไฟล์สำเร็จ: {len(r_dl.content):,} bytes")
                        return r_dl.content, direct_u, "csv"
                    elif r_dl.status_code in [429, 502, 503, 504]:
                        time.sleep(attempt * 2)
                except Exception as e:
                    print(f"[PORTAL WARN] รอบที่ {attempt} ล้มเหลว ({e}), กำลังลองใหม่...")
                    time.sleep(attempt * 2)

        # 3. ค้นหา Resource ผ่าน CKAN API: package_show
        api_url = f"https://{domain}/api/3/action/package_show?id={urllib.parse.quote(package_id)}"
        print(f"  [PORTAL] เชื่อมต่อ CKAN Catalog API...")

        res_data = None
        for attempt in range(1, 4):
            try:
                r_api = sess.get(api_url, verify=False, timeout=60)
                if r_api.status_code == 200:
                    res_data = r_api.json()
                    if res_data.get("success"):
                        break
                time.sleep(attempt * 2)
            except Exception:
                time.sleep(attempt * 2)

        if not res_data or not res_data.get("success"):
            raise ValueError(f"ไม่สามารถเรียกดูข้อมูล CKAN API จาก {domain} สำหรับชุดข้อมูล: {package_id}")

        resources = res_data.get("result", {}).get("resources", [])
        if not resources:
            raise ValueError(f"ไม่พบ Resource ในชุดข้อมูล CKAN: {package_id}")

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
                print(f"  [PORTAL] กำลังดึงไฟล์จาก Datastore Dump...")
                r_dump = sess.get(dump_url, verify=False, timeout=45)
                if r_dump.status_code == 200 and len(r_dump.content) > 0:
                    return r_dump.content, dump_url, "csv"
            except Exception as e:
                print(f"[PORTAL WARN] Datastore Dump ขัดข้อง ({e}) สลับไปดาวน์โหลด Resource URL ปกติ...")

        # 5. ดาวน์โหลดจาก Resource URL โดยตรง
        if not res_url:
            raise ValueError(f"ชุดข้อมูล {package_id} ไม่มีลิงก์ Resource URL ให้ดาวน์โหลด")

        print(f"  [PORTAL] กำลังดาวน์โหลดไฟล์จาก Resource URL...")
        for attempt in range(1, 4):
            try:
                r_res = sess.get(res_url, verify=False, timeout=90)
                if r_res.status_code == 200 and len(r_res.content) > 0:
                    actual_ext = "xlsx" if r_res.content.startswith(b"PK") else res_format
                    return r_res.content, res_url, actual_ext
                time.sleep(attempt * 2)
            except Exception as e:
                print(f"[PORTAL WARN] ดาวน์โหลดรอบที่ {attempt} ล้มเหลว ({e})...")
                time.sleep(attempt * 2)

        raise ValueError(f"ไม่สามารถดาวน์โหลดไฟล์ Resource จาก: {res_url}")


# Functional Wrapper เพื่อความสะดวกในการเรียกใช้งานโดยตรง
def extract_portal(url: str, preferred_type: str = "CSV", **kwargs) -> tuple[bytes, str, str]:
    return PortalExtractor().extract(url=url, preferred_type=preferred_type, **kwargs)
