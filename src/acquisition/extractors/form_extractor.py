"""
============================================================
ตัวดึงข้อมูลประเภทที่ 3: เว็บแอปพลิเคชันและแบบฟอร์มสืบค้น (Form Extractor)
============================================================
ลักษณะของเป้าหมาย:
- หน้าเว็บที่ต้องส่งคำขอผ่านแบบฟอร์ม (Interactive Form Submission / POST Payload):
  1. thaicarbonlabel.tgo.or.th (องค์การบริหารจัดการก๊าซเรือนกระจก - TGO)
     -> คัดกรองตามกลุ่มอุตสาหกรรม (ปิโตรเลียม ID 9, ปิโตรเคมี ID 20)
  2. dmf.go.th/public/supply (ระบบรายงานการจัดหาปิโตรเลียม กรมเชื้อเพลิงธรรมชาติ)
     -> ส่งพารามิเตอร์ปี พ.ศ. เพื่อเจเนอเรตไฟล์ Excel
  3. หน้าเว็บแสดงตารางรายงาน HTML ทั่วไป
============================================================
"""

import io
import re
from urllib.parse import urlparse
import requests
import urllib3
from base_extractor import BaseExtractor

urllib3.disable_warnings()


class FormExtractor(BaseExtractor):
    """ตัวดึงข้อมูลจากเว็บแอปพลิเคชันแบบมีฟอร์มค้นหาและตาราง HTML"""

    @classmethod
    def can_handle(cls, url: str) -> bool:
        """ทำหน้าที่รองรับเว็บแบบฟอร์มโต้ตอบและเป็น Fallback สำหรับ HTML ทั่วไป"""
        return True

    # -------------------------------------------------------------------------
    # 1. ระบบดึงข้อมูล อบก. (TGO Carbon Footprint Portal)
    # -------------------------------------------------------------------------
    def extract_tgo_tables(self) -> dict[str, tuple[bytes, str]]:
        """
        ดึงตารางข้อมูล TGO แยกเป็น 2 ตารางอิสระ:
        1. ปิโตรเลี่ยม (Industry ID 9)
        2. ปิโตรเคมี และเคมีภัณฑ์ (Industry ID 20)
        คืนค่า: {label: (content_bytes, action_url)}
        """
        s = requests.Session()
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": "https://thaicarbonlabel.tgo.or.th/index.php?lang=TH&mod=WTJGMFlXeHZadz09",
        }
        s.headers.update(headers)
        try:
            s.get("https://thaicarbonlabel.tgo.or.th/index.php?lang=TH&mod=WTJGMFlXeHZadz09", verify=False, timeout=15)
        except Exception:
            pass

        action_url = "https://thaicarbonlabel.tgo.or.th/index.php?lang=TH&mod=WTJGMFlXeHZadz09&action=Y0c5emRBPT0"
        results = {}

        targets = [
            ("9", "Petroleum", "ปิโตรเลี่ยม"),
            ("20", "Petrochemical", "ปิโตรเคมี และเคมีภัณฑ์"),
        ]

        for ind_id, eng_label, th_label in targets:
            data = {
                "current": action_url,
                "section": "_SBPRODUCTS",
                "industry": ind_id,
                "style": "_TABLE",
                "sorting": "_ASC",
                "year": "0",
                "quarter": "0",
            }
            try:
                resp = s.post(action_url, data=data, verify=False, timeout=30)
                if "<table" in resp.text.lower() and len(resp.content) > 5000:
                    print(f"  [FORM] ดึงตาราง TGO สำเร็จ: {th_label} ({len(resp.content):,} bytes)")
                    results[eng_label] = (resp.content, action_url)
            except Exception as e:
                print(f"[FORM WARN] การดึงตาราง TGO ({th_label}) ล้มเหลว: {e}")

        return results

    def _extract_tgo_table(self, url: str) -> tuple[bytes, str, str] | None:
        """ดึงตารางผลิตภัณฑ์ปิโตรเลียมจาก TGO เป็นค่าเริ่มต้น"""
        tables = self.extract_tgo_tables()
        if "Petroleum" in tables:
            content, action_url = tables["Petroleum"]
            return content, action_url, "html"
        return None

    # -------------------------------------------------------------------------
    # 2. ระบบดึงข้อมูลการจัดหาปิโตรเลียม (DMF Supply Form - Menu 966)
    # -------------------------------------------------------------------------
    def _extract_supply_excel(self, menu_id: str, year_be: int) -> tuple[bytes, str, str] | None:
        """ดึงไฟล์ Excel สรุปทั้งปีจากระบบจัดหาปิโตรเลียม (supply menu 966)"""
        s = requests.Session()
        s.headers.update({
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        })

        idx_url = f"https://dmf.go.th/public/supply/data/index/menu/{menu_id}/groupid/1"
        try:
            s.headers["Referer"] = idx_url
            idx_resp = s.get(idx_url, verify=False, timeout=15)
            m_opts = re.findall(r'<option[^>]*value=["\']([^"\']*)["\'][^>]*>\s*(\d{4})\s*</option>', idx_resp.text)
            opt_id = None
            for val, yr in m_opts:
                if str(year_be) == yr:
                    opt_id = val
                    break
            if not opt_id and m_opts:
                opt_id = m_opts[0][0]

            if opt_id:
                ref = f"https://dmf.go.th/public/supply/data/index/menu/{menu_id}/id/{opt_id}/"
                s.headers["Referer"] = ref
                post_url = f"https://dmf.go.th/public/supply/data/excel/menu/{menu_id}/"
                resp = s.post(post_url, data={"id": opt_id}, verify=False, timeout=15)
                m = re.search(r"(\w+_\d+\.xlsx)", resp.text)
                if m:
                    fn = m.group(1)
                    dl_url = f"https://dmf.go.th/public/supply_upload/{fn}"
                    dl_resp = s.get(dl_url, verify=False, timeout=25)
                    if dl_resp.content.startswith(b"PK"):
                        print(f"[FORM] ดาวน์โหลดไฟล์ Excel การจัดหาปิโตรเลียมสำเร็จ: {len(dl_resp.content):,} bytes")
                        return dl_resp.content, dl_url, "xlsx"
        except Exception as e:
            print(f"[FORM WARN] การดึง Excel การจัดหาปิโตรเลียมล้มเหลว: {e}")
        return None

    # -------------------------------------------------------------------------
    # 3. Main Extract Router
    # -------------------------------------------------------------------------
    def extract(
        self,
        url: str,
        preferred_type: str = "HTML",
        year_be: int = 2567,
        month: int = 8,
        **kwargs,
    ) -> tuple[bytes, str, str]:
        """
        ส่งคำขอไปยังแบบฟอร์มหรือดึง Snapshot หน้าเว็บดิบ 100%
        คืนค่า: (raw_bytes, final_url, file_extension)
        """
        clean_url = url.strip()
        parsed = urlparse(clean_url)

        # 1. ตรวจสอบกรณีเว็บ TGO Carbon Footprint
        if "thaicarbonlabel.tgo.or.th" in clean_url:
            tgo_res = self._extract_tgo_table(clean_url)
            if tgo_res:
                return tgo_res

        # 2. ตรวจสอบกรณีเว็บแบบฟอร์มจัดหาปิโตรเลียม (DMF Supply)
        if "supply" in parsed.path:
            menu_match = re.search(r"menu/(\d+)", parsed.path)
            menu_id = menu_match.group(1) if menu_match else "966"
            excel_res = self._extract_supply_excel(menu_id, year_be)
            if excel_res:
                return excel_res

        # 3. กรณีหน้าเว็บรายงาน HTML ทั่วไป (Universal Snapshot)
        print(f"[FORM] กำลังดึง Snapshot หน้าเว็บดิบ: {clean_url}")
        bytes_data = self.http_get_bytes(clean_url, timeout=25)

        if not bytes_data or len(bytes_data) == 0:
            raise ValueError(f"ไม่สามารถดึงข้อมูลหน้าเว็บจาก: {clean_url}")

        ext = "html" if preferred_type.strip().upper() == "HTML" else "data"
        return bytes_data, clean_url, ext


# Functional Wrapper เพื่อความสะดวกในการเรียกใช้งานโดยตรง
def extract_form(url: str, preferred_type: str = "HTML", **kwargs) -> tuple[bytes, str, str]:
    return FormExtractor().extract(url=url, preferred_type=preferred_type, **kwargs)
