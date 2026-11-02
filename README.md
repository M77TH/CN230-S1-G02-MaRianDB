# CN230 Final Project: Data Engineering Pipeline (Source to Canonical)
**Industrial Domain:** Petroleum, Natural Gas & Fuels  
**Team:** G02 MarianDB  
**Course:** CN230 Data Engineering Pipeline: Source to Canonical

ระบบไปป์ไลน์วิศวกรรมข้อมูลแบบครบวงจร (End-to-End Data Engineering Pipeline) สำหรับรวบรวม ตรวจสอบ และแปรรูปข้อมูลพลังงาน ปิโตรเลียม ก๊าซธรรมชาติ เชื้อเพลิง และคาร์บอนฟุตพริ้นท์ของประเทศไทย ตั้งแต่แหล่งข้อมูลต้นทางจนถึงชั้นข้อมูลมาตรฐานกลาง (Canonical Data Model)

---

## 📌 บทนำและวัตถุประสงค์โครงการ (Project Overview & Purpose)

โครงการนี้มุ่งเน้นการออกแบบและสร้างระบบ Data Engineering Pipeline ระดับมาตรฐานองค์กร เพื่อรวบรวมข้อมูลในอุตสาหกรรม **Petroleum, Natural Gas & Fuels** ของประเทศไทย ซึ่งมีความกระจัดกระจาย หลากหลายรูปแบบ และต่างสถาปัตยกรรมการเผยแพร่ ให้มาอยู่ภายใต้มาตรฐานข้อมูลเดียวกัน โดยมีวัตถุประสงค์และเสาหลักสำคัญดังนี้:

1. **บูรณาการข้อมูลพลังงานและสิ่งแวดล้อมข้ามหน่วยงาน (Cross-Agency Integration)**:
   - รวบรวมข้อมูลปริมาณการผลิต การจัดหา การนำเข้า-ส่งออก การบริโภค และการปล่อยก๊าซเรือนกระจกจากหน่วยงานกำกับดูแลหลักของประเทศ ได้แก่:
     - **กรมเชื้อเพลิงธรรมชาติ (DMF)**: ปริมาณการผลิตและการจัดหาปิโตรเลียม (น้ำมันดิบ, ก๊าซธรรมชาติ, คอนเดนเสท) ทั้งระดับรายเดือนและสถิติย้อนหลังกว่า 23 ปี
     - **สำนักงานนโยบายและแผนพลังงาน (EPPO)**: ปริมาณการใช้น้ำมันสำเร็จรูป, ก๊าซ NGV, และการปล่อยก๊าซ CO2 รายสาขาเศรษฐกิจ
     - **องค์การบริหารจัดการก๊าซเรือนกระจก (TGO)**: ฐานข้อมูลคาร์บอนฟุตพริ้นท์ของผลิตภัณฑ์ปิโตรเลียมและปิโตรเคมี
     - **กรมธุรกิจพลังงาน (DOEB)**: ข้อมูลผู้ประกอบการและสถิติเชื้อเพลิง
2. **สร้างรากฐานข้อมูลสำหรับ Life Cycle Inventory (LCI) & Carbon Accounting**:
   - เชื่อมโยงข้อมูลปริมาณการผลิต/การใช้พลังงาน เข้ากับค่าสัมประสิทธิ์การปล่อยก๊าซเรือนกระจกและคาร์บอนฟุตพริ้นท์ เพื่อสนับสนุนการวิเคราะห์ Energy Balance และการประเมินผลกระทบสิ่งแวดล้อมในห่วงโซ่อุปทานพลังงาน
3. **หลักธรรมาภิบาลและการรักษาความน่าเชื่อถือของข้อมูล (Data Governance & Integrity)**:
   - **Approved Sources Gate**: ประมวลผลเฉพาะชุดข้อมูลที่ได้รับอนุมัติในทะเบียน Catalog (`docs/source_registry/source_registry.xlsx`) เท่านั้น ชุดข้อมูลที่มีสถานะอื่นจะไม่ถูกดึงเข้ามาในระบบ
   - **Modular Strategy Extractor Architecture**: ออกแบบตรรกะการดึงข้อมูลแยกตามสถาปัตยกรรมเว็บไซต์ (CKAN Portals, Web Applications, HTML Snapshots, Direct URLs) พร้อมระบบป้องกันข้อผิดพลาด 3 ชั้น (3-Layer Fallback), Idempotency และ Rate-Limit Protection
   - **100% Immutable Raw Preservation**: จัดเก็บไฟล์ดิบดั้งเดิมโดยไม่มีการดัดแปลงแม้แต่ไบต์เดียว
   - **Cryptographic Provenance Audit**: มีสมุดคุมประวัติ (`_provenance_ledger.jsonl`) บันทึกรหัส Batch, เวลาเข้าถึง (ISO 8601 +07:00 และ UTC), HTTP Status, ขนาดไฟล์ (Bytes), URL ต้นทาง และค่าแฮช `SHA-256` สำหรับสอบย้อนกลับ (Data Lineage) ได้สมบูรณ์ทุกขั้นตอน

---

## 🏛️ สถาปัตยกรรมข้อมูล 5 ขั้นตอน (Data Pipeline Architecture)

สถาปัตยกรรมของไปป์ไลน์ถูกแบ่งออกเป็น 5 ลำดับขั้นมาตรฐาน (5-Stage Data Engineering Architecture) โดยรองรับการประมวลผลแบบ **1-to-1 Multi-File Support** (หาก 1 แหล่งข้อมูลมีหลายตารางย่อย เช่น `SRC-043` ที่มีทั้งกลุ่มปิโตรเลียมและปิโตรเคมี ทุกขั้นตอนจะประมวลผลและแยกไฟล์อิสระครบทุกตาราง):

### รายละเอียดการทำงานของแต่ละลำดับขั้น (Pipeline Stages Breakdown)

#### 1. Step 1: Data Acquisition (การรวบรวมและจัดเก็บข้อมูลดิบ)
* **หน้าที่:** ดึงไฟล์ข้อมูลจากแหล่งกำเนิดต้นทางที่มีสถาปัตยกรรมแตกต่างกัน และจัดเก็บลงใน `data/raw/` อย่างปลอดภัย
* **กลไกการทำงาน:**
  * **Strict Quality Gate:** โหลดเฉพาะชุดข้อมูลที่มีสถานะ `approved` ในแคตตาล็อกกลาง (`docs/source_registry/source_registry.xlsx`)
  * **Modular Strategy Pattern (`src/acquisition/extractors/`):**
    * `PortalExtractor`: เชื่อมต่อ CKAN Open Data API, Datastore CSV Dump พร้อมระบบสำรอง 3 ชั้น (CKAN API -> HTML Page Scraping Fallback -> Known Direct Resource URL)
    * `FormExtractor`: รองรับเว็บแอปพลิเคชันที่มี Form Search / Session เช่น เว็บไซต์จัดหาปิโตรเลียม DMF และตาราง HTML ของ TGO (แยกดึงตารางผลิตภัณฑ์ปิโตรเลียม `industry=9` และปิโตรเคมี `industry=20`)
    * `DirectExtractor`: ดาวน์โหลดไฟล์ผ่าน URL ตรง รองรับทั้ง `.csv`, `.xlsx`, `.pdf`, `.zip`
  * **Cryptographic Lineage & Idempotency:** คำนวณแฮช `SHA-256` และบันทึกลงใน `data/raw/_provenance_ledger.jsonl` หากมีไฟล์เดิมอยู่แล้วและแฮชตรงกันจะข้ามการดาวน์โหลดซ้ำโดยอัตโนมัติ

#### 2. Step 2: Data Parsing (การสกัดโครงสร้างสู่ชั้นตารางดิบ)
* **หน้าที่:** สกัดข้อมูลจากไฟล์ดิบหลากหลายรูปแบบ (`.csv`, `.xlsx`, `.html`) ให้อยู่ในรูป Tabular DataFrame แบบ 1-to-1
* **กลไกการทำงาน:**
  * **Encoding Detection:** ตรวจสอบชุดอักขระอัตโนมัติ (`utf-8-sig`, `utf-8`, `cp874`, `tis-620`)
  * **HTML Diagnostic & Evidence-Based Table Selection:** ตรวจนับคำสำคัญใน HTML (`[DIAG]`) ยุบหัวตารางซ้อนด้วย `flatten_columns()` และให้คะแนนทุกตารางด้วย `table_score()` เพื่อเลือกตารางข้อมูลที่มีหลักฐานตรงที่สุดแทนการเดา `tables[0]`
  * **คงค่าเดิม 100% (High Raw Fidelity):** เก็บข้อมูลทุกเซลล์ในรูป `dtype=str` โดยยังไม่เปลี่ยนชื่อคอลัมน์หรือดัดแปลงตัวเลข บันทึกลงใน `data/parsed/*_PARSED_RAW.csv`

#### 3. Step 3: Transform & Staging (การจัดเตรียมและแปรรูปข้อมูลผ่าน 7 ขั้นตอนย่อย)
* **หน้าที่:** ปรับปรุงโครงสร้างและคุณภาพข้อมูลผ่าน **7 Staging Sub-Steps** พร้อมรักษาคอลัมน์ **ก่อน (`_raw`) → หลัง (Normalized)** ในตารางเดียวกัน
* **7 ขั้นตอนย่อยภายในชั้น Staging (`src/transform/staging.py`):**
  1. **`[1.EXTRACT]` Data Extraction:** ดึงข้อมูลตารางดิบจาก `data/parsed/*_PARSED_RAW.csv` และประวัติต้นทางจาก `_provenance_ledger.jsonl`
  2. **`[2.PROFILE]` Data Profiling:** วิเคราะห์โครงสร้างข้อมูลดิบ ตรวจนับค่าว่างรายคอลัมน์ (`Missing Values`), คอลัมน์ที่ว่างเปล่า 100% (`Blank Columns`), แถวชำรุด (`Corrupted Rows`), และแถวที่ซ้ำกันทุกคอลัมน์ (`Exact Duplicates`)
  3. **`[3.CLEANSE]` Data Cleansing:** ลบช่องว่างซ้ำ (`clean_text`), แปลงสัญลักษณ์ค่าว่าง (`-`, `N/A`) เป็น `NaN`, ลบคอลัมน์ว่าง 100%, ลบแถวชำรุด/แถวซ้ำ, เติมรหัสแปลงสำรวจที่ว่าง (`UNSPECIFIED`) สำหรับแหล่งผลิตบนบก และลบลูกน้ำคั่นหลักพันเฉพาะตัวเลขโดยไม่กระทบชื่อผลิตภัณฑ์
  4. **`[4.TRANSFORM]` Data Transformation:** แมปชื่อคอลัมน์สู่ภาษาอังกฤษมาตรฐาน, แปลงปี พ.ศ. $\rightarrow$ ค.ศ. (คู่กับ `year_raw`), แปลงเดือนเป็นชื่ออังกฤษ + `month_num` (คู่กับ `month_raw`), จัดมาตรฐานฟิลด์หลัก (`product`, `quantity`, `unit`), และแยกค่า/หน่วย CF
  5. **`[5.VALIDATE]` Data Validation:** ตรวจสอบคอลัมน์บังคับ (`REQUIRED_COLUMNS_BY_SOURCE`), ตรวจสอบว่าค่า `quantity >= 0`, ปี ค.ศ. และเลขเดือนอยู่ในช่วงที่ถูกต้อง และไม่มีค่าว่างค้างในคอลัมน์บังคับ
  6. **`[6.INTEGRATE]` Data Integration:** จัดเรียงลำดับคอลัมน์ให้สอดคล้องกันทุกชุดข้อมูล (`Core Columns` $\rightarrow$ `Detail Columns` $\rightarrow$ `Raw Evidence (_raw)` $\rightarrow$ `Provenance (_*)`)
  7. **`[7.LOAD]` Data Loading:** บันทึกตารางลงใน `data/staging/*_STAGED.csv`

#### 4. Step 4: Data Validation (การตรวจสอบคุณภาพและความถูกต้องของข้อมูล) — *[WIP]*
* **หน้าที่:** ตรวจสอบความถูกต้องสมบูรณ์ของข้อมูลตาม Data Contracts, Business Rules และการตรวจจับข้อมูลซ้ำ (Duplicate Detection)
* **กลไกตามแผนพัฒนา (อ้างอิง Guideline Cells 17–18):**
  * แบ่งสถานะคุณภาพเป็น 3 ระดับ: `ACCEPTED` (สมบูรณ์ครบถ้วน), `REVIEW` (ข้อมูลหลักครบแต่มี `validation_warnings`), และ `REJECTED` (ข้อมูลสำคัญขาดหายหรือผิดกฎธุรกิจ)

#### 5. Step 5: Canonicalization (การปรับสู่โมเดลมาตรฐานกลางและฐานข้อมูล) — *[WIP]*
* **หน้าที่:** หลอมรวมข้อมูลที่ผ่านเกณฑ์เข้าสู่ Canonical Data Model และฐานข้อมูล SQLite
* **กลไกตามแผนพัฒนา (อ้างอิง Guideline Cells 19–22):**
  * คัดเฉพาะแถวที่ไม่ใช่ `REJECTED` และไม่ซ้ำเข้าสู่ `canonical_df`
  * ส่งออกในรูปแบบ **CSV**, **JSONL**, และนำเข้าฐานข้อมูล **SQLite** พร้อมรัน SQL Query เพื่อสร้างหลักฐานใน `sql/evidence/`

---

## 📏 กฎและการควบคุมคุณภาพข้อมูลประจำแต่ละขั้นตอน (Pipeline Rules & Quality Gates)

ไปป์ไลน์มีการบังคับใช้กฎตรวจสอบคุณภาพ (Quality Gates) ในแต่ละขั้นตอนอย่างเคร่งครัด หากข้อมูลไม่ผ่านเกณฑ์ขั้นต่ำ ระบบจะแจ้งเตือน (`[RULE]` / `[FAIL]`) ทันที:

| ขั้นตอน (Stage) | รหัสกฎ (Rule ID) | ชื่อกฎ (Rule Name) | เงื่อนไขและการบังคับใช้ (Enforcement Logic) |
|:---|:---:|:---|:---|
| **Step 1: Acquisition** | **Rule 1.1** | **Approved Source Gate** | อนุญาตให้ดึงเฉพาะชุดข้อมูลที่มี `status == 'approved'` ใน `source_registry.xlsx` เท่านั้น หากเป็น `candidate` หรือ `rejected` จะถูกข้ามทันที (`[SKIPPED]`) |
| **Step 1: Acquisition** | **Rule 1.2** | **SHA-256 Immutability Gate** | ไฟล์ดิบใน `data/raw/` ต้องมีค่าแฮช `SHA-256` ตรงกับที่บันทึกใน `_provenance_ledger.jsonl` 100% เพื่อรับประกันว่าไฟล์ต้นฉบับไม่ถูกดัดแปลง |
| **Step 1: Acquisition** | **Rule 1.3** | **3-Layer Extraction Resilience** | หาก CKAN API ขัดข้องหรือติด Rate Limit ระบบจะสลับไปสกัดลิงก์จากหน้า HTML (`_scrape_download_url_from_html`) และคลังลิงก์สำรอง (`KNOWN_RESOURCE_URLS`) อัตโนมัติ |
| **Step 2: Parsing** | **Rule 2.1** | **High-Fidelity String Preservation** | บังคับอ่านข้อมูลตารางด้วย `dtype=str` ห้ามแปลงชนิดตัวเลขหรือแก้หัวคอลัมน์ในชั้น `data/parsed/` |
| **Step 2: Parsing** | **Rule 2.2** | **HTML Diagnostic Check** | ตรวจสอบการปรากฏของคำสำคัญ (`DIAGNOSTIC_KEYWORDS_TGO`) ในไฟล์ HTML ก่อนเริ่มแกะตาราง |
| **Step 2: Parsing** | **Rule 2.3** | **Evidence-Based Table Selection** | ใช้ฟังก์ชัน `table_score()` ให้คะแนนทุก `<table>` ในไฟล์ HTML จากคำสำคัญ และเลือกตารางข้อมูลชั้นในสุดที่ได้คะแนนสูงสุดแทนการเดา `tables[0]` |
| **Step 2: Parsing** | **Rule 2.4** | **Minimum Score & Non-Empty Gate** | หาก `best_score == 0` หรือตารางที่สกัดได้ว่างเปล่า (`df.empty` หรือมีน้อยกว่า 2 คอลัมน์) ระบบจะหยุดและแจ้ง `ValueError` ทันที |
| **Step 3: Staging** | **Rule 3.1** | **Required Mapped Columns Gate** | หลังแมปชื่อคอลัมน์แล้ว ต้องมีคอลัมน์บังคับประจำแหล่งข้อมูล (`REQUIRED_COLUMNS_BY_SOURCE`) ครบทุกคอลัมน์ หากขาดแม้แต่คอลัมน์เดียวจะหยุดและแจ้ง `RuntimeError` ทันที |
| **Step 3: Staging** | **Rule 3.2** | **Text & Identifier Protection** | ล็อกคอลัมน์ข้อความและรหัส (`product_name`, `certificate_no`, `phone` ฯลฯ) ไม่ให้ถูกลบลูกน้ำ (รักษาชื่อสารเคมี เช่น `1,3-Butadiene`) และไม่แปลงเป็นตัวเลข (รักษาเลข `0` นำหน้า) |
| **Step 3: Staging** | **Rule 3.3** | **Strict Formatted Number Comma Rule** | ลบเครื่องหมายลูกน้ำ `,` เฉพาะค่าที่ตรงตามแพตเทิร์นตัวเลขคั่นหลักพัน (`^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$`) ในคอลัมน์ตัวเลขเท่านั้น |
| **Step 3: Staging** | **Rule 3.4** | **No-Guessing Mass Conversion Rule** | แปลง `functional_unit_raw` เป็น `functional_unit_mass_kg` เฉพาะหน่วยมวลที่ระบุชัดเจน (`kg`, `กิโลกรัม`, `g`, `กรัม`, `t`, `ตัน`) ห้ามเดาค่าจากหน่วยนับอื่น (`ชิ้น`, `ลิตร`, `m²` ให้เป็น `NaN`) |
| **Step 3: Staging** | **Rule 3.5** | **Raw Evidence Traceability Rule** | ทุกคอลัมน์ที่มีการแปลงค่าหรือหน่วยในชั้น Staging ต้องคงคอลัมน์ `_raw` ดั้งเดิมไว้คู่กันเสมอ (`approve_date_raw`, `cf_volume_raw`, `functional_unit_raw`, `year_raw`, `month_raw`) |
| **Step 4: Validation** *(Planned)* | **Rule 4.1** | **3-Tier Quality Status & Duplicate Gate** | จำแนกแต่ละแถวเป็น `ACCEPTED`, `REVIEW`, หรือ `REJECTED` พร้อมตรวจจับข้อมูลซ้ำด้วย Business Key (`certificate_no` หรือคีย์ผสม) |
| **Step 5: Canonical** *(Planned)* | **Rule 5.1** | **Canonical Admission & SQLite Audit** | นำเข้าเฉพาะแถวที่ `quality_status != 'REJECTED'` และไม่ซ้ำ เข้าสู่ฐานข้อมูล SQLite พร้อมรัน SQL ตรวจสอบความถูกต้อง |

---

### ตารางเปรียบเทียบหน้าที่และคุณสมบัติของข้อมูลในแต่ละเลเยอร์ (Data Layer Architecture Matrix)

| เลเยอร์ (Layer) | ไดเรกทอรีจัดเก็บ (Storage Path) | รูปแบบไฟล์ (Format) | ระดับการดัดแปลงข้อมูล (Transformation) | การตรวจสอบความน่าเชื่อถือ (Integrity & Governance) | บทบาทในไปป์ไลน์ (Pipeline Role) |
|:---|:---|:---:|:---:|:---:|:---|
| **Raw Layer** | `data/raw/` | `*_RAW.csv` / `.xlsx` / `.html` | **0% (สภาพเดิม 100%)** | SHA-256 Checksum + Provenance Ledger | แหล่งอ้างอิงความจริงดั้งเดิม (Immutable Source of Truth) |
| **Parsed Layer** | `data/parsed/` | `*_PARSED_RAW.csv` | สกัดโครงสร้างสู่ตาราง คงค่าเดิม 1-to-1 | Table Score Gate + Non-Empty Check | สแนปช็อตตารางดิบเพื่อความโปร่งใสในการตรวจสอบ |
| **Staging Layer** | `data/staging/` | `*_STAGED.csv` | คลีนข้อมูล 7 ขั้นตอนย่อย, แปลง ค.ศ. คู่คอลัมน์ `_raw` | Required Columns + Non-Negative + Provenance | ตารางข้อมูลสะอาด ไร้คอลัมน์ว่าง พร้อมเข้าสู่ขั้นตอนถัดไป |
| **Accepted Layer** | `data/accepted/` | `*_VALID.csv` / `.parquet` | ผ่านการตรวจสอบคุณภาพ (`ACCEPTED` / `REVIEW`) | Business Rules & Duplicate Check | ข้อมูลที่ผ่านเกณฑ์รับรอง พร้อมเข้าสู่โมเดลกลาง |
| **Rejected Layer** | `data/rejected/` | `*_ERR.csv` | ข้อมูลที่ขาดฟิลด์บังคับหรือผิดกฎ (`REJECTED`) | Quarantine Error Log | กักกันข้อมูลผิดพลาดเพื่อการตรวจสอบย้อนกลับ |
| **Canonical Layer** | Data Warehouse / SQLite | `.csv`, `.jsonl`, `.sqlite` | รวมโมเดลกลาง, รหัส `record_id`, เชื่อม LCI | SQL Verification Queries (`sql/evidence/`) | เสิร์ฟข้อมูลสำหรับ SQL Analytics, BI & Carbon Accounting |

---

## 📂 โครงสร้างโปรเจกต์ (Project Structure)

```text
Project CN230/
├── run_pipeline.py                      # ตัวสั่งการไปป์ไลน์แบบครบวงจร (End-to-End Orchestrator)
├── requirements.txt                     # รายการไลบรารีที่จำเป็น (Dependencies)
├── .gitignore                           # กฎ Git Ignore เพื่อรักษาความสะอาดของ Repository
├── README.md                            # เอกสารแนะนำสถาปัตยกรรม กฎคุณภาพ และคู่มือการใช้งาน
│
├── docs/                                # เอกสารประกอบโครงการ (Project Documentation)
│   ├── source_registry/                 # ทะเบียนแหล่งข้อมูลหลัก (Source Registry)
│   │   └── source_registry.xlsx         # แคตตาล็อกฉบับสมบูรณ์ที่ผ่านการคัดกรอง (Single Source of Truth)
│   ├── requirements/                    # เอกสารข้อกำหนดโครงการ (Business Requirements)
│   ├── erd/                             # ไดอะแกรมความสัมพันธ์ข้อมูล (Entity-Relationship Diagram)
│   └── mapping/                         # สเปกการแปลงและจับคู่ฟิลด์ข้อมูล (Data Mapping Specs)
│
├── sql/                                 # สคริปต์ฐานข้อมูลและการตรวจสอบ (SQL & Evidence)
│   └── evidence/                        # หลักฐานการรัน SQL และผลการตรวจสอบความถูกต้อง
│
├── data/                                # ชั้นจัดเก็บข้อมูลแต่ละขั้นตอนแบบ 1-to-1 (Layered Data Storage)
│   ├── raw/                             # Step 1: ไฟล์ดิบสภาพเดิม 100% (*_RAW.*) + _provenance_ledger.jsonl
│   ├── parsed/                          # Step 2: ไฟล์ตารางที่สกัดโครงสร้างแล้ว (*_PARSED_RAW.csv)
│   ├── staging/                         # Step 3: ไฟล์ตารางที่ผ่าน 7 ขั้นตอนย่อยของ Staging (*_STAGED.csv)
│   ├── accepted/                        # Step 4: ข้อมูลที่ผ่านการตรวจสอบคุณภาพ พร้อมใช้งาน
│   └── rejected/                        # Step 4: ข้อมูลที่ไม่ผ่านเกณฑ์คุณภาพ กักไว้ตรวจสอบ
│
└── src/                                 # โค้ดต้นฉบับแยกตามความรับผิดชอบ (Modular Source Code)
    ├── clear_data.py                    # ยูทิลิตี้สำหรับรีเซ็ตและล้างไฟล์ใน data/ เพื่อเริ่มทดสอบใหม่
    │
    ├── acquisition/                     # Step 1: Data Acquisition
    │   ├── extractors/                  # โมดูลแยกดึงข้อมูลตามประเภทสถาปัตยกรรมเว็บ (Strategy Pattern)
    │   │   ├── base_extractor.py        # แม่แบบ (Protocol) รับส่งค่าแบบเดียวกันทุกเว็บ + Strategy Router
    │   │   ├── portal_extractor.py      # พอร์ทัลข้อมูลเปิด CKAN พร้อมระบบสำรอง 3 ชั้น (API -> HTML -> Direct)
    │   │   ├── direct_extractor.py      # ลิงก์ตรง (.csv, .xlsx, .pdf, .zip)
    │   │   └── form_extractor.py        # เว็บแอปพลิเคชันแบบฟอร์มและตาราง HTML (TGO 2 ตาราง, DMF Supply)
    │   ├── acquisition.py               # ตัว Conductor: อ่าน Catalog -> ตรวจ Approved Gate -> บันทึกไฟล์ดิบ
    │   └── provenance.py                # จัดการ SHA-256 + บันทึกลง _provenance_ledger.jsonl
    │
    ├── parsing/                         # Step 2: Data Parsing
    │   └── parsing.py                   # สกัดตารางด้วย flatten_columns() + table_score() + Non-Empty Gate
    │
    ├── transform/                       # Step 3: Transform & Staging
    │   └── staging.py                   # แปลง Schema, เช็ค Required Columns, แยกค่า/หน่วย CF/มวล/วันที่ พ.ศ.
    │
    ├── validation/                      # Step 4: Data Validation
    │   └── validation.py                # กฎตรวจสอบความถูกต้องของ Schema และ Business Rules [WIP]
    │
    └── canonical/                       # Step 5: Canonicalization
        └── canonical.py                 # ตัวปรับสู่โมเดลมาตรฐานกลางและส่งออกสู่ SQLite [WIP]
```

---

## 📋 มาตรฐานการตั้งชื่อไฟล์แบบ 1-to-1 ทุกเลเยอร์ (File Naming Convention)

ทุกขั้นตอนตั้งแต่ Step 1 ถึง Step 3 ใช้กฎการตั้งชื่อไฟล์แบบ **1-to-1** เดียวกันทั้งหมด โดยเปลี่ยนเฉพาะคำลงท้ายประจำเลเยอร์ (`_RAW.<ext>` $\rightarrow$ `_PARSED_RAW.csv` $\rightarrow$ `_STAGED.csv`):

* **กรณีไฟล์สถิติรายงวด (Monthly Snapshot):**
  * **Step 1 (`data/raw/`):** `SRC-048_EPPO_Petroleum-Production_TH_202408_RAW.csv`
  * **Step 2 (`data/parsed/`):** `SRC-048_EPPO_Petroleum-Production_TH_202408_PARSED_RAW.csv`
  * **Step 3 (`data/staging/`):** `SRC-048_EPPO_Petroleum-Production_TH_202408_STAGED.csv`
* **กรณีแหล่งข้อมูลที่มีหลายตารางย่อย (Multi-Subtrack Source เช่น `SRC-043`):**
  * ตารางที่ 1 (ปิโตรเคมี): `SRC-043_TGO_Carbon-Footprint-Petrochemical_TH_202408_{RAW.html | PARSED_RAW.csv | STAGED.csv}`
  * ตารางที่ 2 (ปิโตรเลียม): `SRC-043_TGO_Carbon-Footprint-Petroleum_TH_202408_{RAW.html | PARSED_RAW.csv | STAGED.csv}`
* **กรณีไฟล์ชุดประวัติศาสตร์ระยะยาว (Historical Multi-Year Span):**
  * `SRC-044_DMF_Petroleum-Production_TH_200301-202603_{RAW.csv | PARSED_RAW.csv | STAGED.csv}`

---

## 🛠️ การติดตั้งและคำสั่งใช้งาน (Getting Started)

### 1. ติดตั้งไลบรารีที่จำเป็น
```bash
pip install -r requirements.txt
```

### 2. การสั่งรันไปป์ไลน์แบบครบวงจร (End-to-End Execution)
* **รันทุกชุดข้อมูลที่ได้รับอนุมัติต่อเนื่อง Step 1 ถึง Step 5:**
  ```bash
  python run_pipeline.py
  ```
* **รันเฉพาะชุดข้อมูลที่ต้องการ (ระบุ 1 หรือหลายชุดข้อมูลพร้อมกัน):**
  ```bash
  python run_pipeline.py SRC-037 SRC-043 SRC-044
  ```
* **บังคับดาวน์โหลดไฟล์ดิบใหม่ทั้งหมดโดยไม่ใช้แคช:**
  ```bash
  python run_pipeline.py --force
  ```

### 3. การสั่งรันแยกเฉพาะแต่ละขั้นตอน (Standalone Stage Execution)
* **Step 1 (Data Acquisition & Provenance Verification):**
  ```bash
  python src/acquisition/acquisition.py          # ดึงข้อมูล Approved ทั้งหมด
  python src/acquisition/acquisition.py --list   # แสดงรายชื่อ Approved Sources
  python src/acquisition/provenance.py           # ตรวจสอบ SHA-256 ของไฟล์ดิบทั้งหมด
  ```
* **Step 2 (Data Parsing):**
  ```bash
  python src/parsing/parsing.py                  # สกัดตารางจากไฟล์ดิบทั้งหมด
  python src/parsing/parsing.py SRC-043          # สกัดตารางเฉพาะ SRC-043
  ```
* **Step 3 (Transform & Staging):**
  ```bash
  python src/transform/staging.py                # ทำความสะอาดและสร้างไฟล์ Staging ทั้งหมด
  python src/transform/staging.py SRC-043        # ทำความสะอาดเฉพาะ SRC-043
  ```

### 4. การรีเซ็ตสภาพแวดล้อมข้อมูล (Environment Reset)
```bash
python src/clear_data.py
```
