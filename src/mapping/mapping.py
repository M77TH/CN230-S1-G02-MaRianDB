"""
=============================================================================
Step 05: Data Mapping & LCI Allocation (การแปลงข้อมูลและปันส่วนภาระต่อ 1 FU)
=============================================================================
หน้าที่หลัก:
1. อ่านตารางชั่วคราวเฉพาะแหล่งข้อมูลจาก data/staging/*_STAGED.csv
2. ดำเนินการปันส่วนพลังงานและการปรับฐาน (Energy Allocation & Normalization) ตามคู่มือ ISO 14044:
   - รวบรวมข้อมูลการผลิตปิโตรเลียมรวมรายปี (Activity Data) จาก DMF (SRC-044, SRC-045, SRC-046)
   - แปลงเป็นหน่วยพลังงานเทียบเท่าน้ำมันดิบ (BOE) เพื่อหาสัดส่วนการปันส่วนพลังงาน (allocation ratio)
   - ปันส่วนภาระมลพิษและการใช้พลังงานรวมรายปีจาก PTTEP (SRC-047) ให้แต่ละผลผลิต
   - ปรับฐานให้เป็นค่าต่อ 1 Functional Unit (1 FU: amount = 1.00 สำหรับสายไหลอ้างอิง)
3. ปรับฐานข้อมูลกลางน้ำ EPPO (SRC-048, SRC-049, SRC-050) จากรายเดือนเป็นผลรวมรายปี (Annual Aggregation)
4. แมปเข้าสู่โครงสร้างกลาง Unified Mapped LCI Schema (24 คอลัมน์ รวมคอลัมน์ allocation)
   ลงใน data/mapping/*_MAPPED.csv
=============================================================================
"""

import calendar
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
import numpy as np
import pandas as pd

# กำหนด Console encoding สำหรับ Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except Exception:
        pass

CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent.parent
STAGING_DIR = PROJECT_ROOT / "data" / "staging"
MAPPING_DIR = PROJECT_ROOT / "data" / "mapping"

BKK_TZ = timezone(timedelta(hours=7))

# โครงสร้างคอลัมน์กลางมาตรฐานเดียวกันทุกไฟล์ใน data/mapping/*_MAPPED.csv
MAPPED_COLUMNS = [
    "record_id",
    "year",
    "month",
    "month_num",
    "domain",
    "process_name",
    "location_name",
    "country",
    "flow_name",
    "flow_type",
    "compartment",
    "direction",
    "amount",
    "unit",
    "is_reference",
    "allocation",
    "_source_id",
    "_subtrack",
    "_extraction_batch_id",
    "_source_url",
    "_source_sha256",
    "_raw_file",
    "_staged_at",
    "_mapped_at",
]


def get_bkk_timestamp() -> str:
    return datetime.now(BKK_TZ).isoformat(timespec="seconds")


def get_mapped_output_path(staged_file: Path) -> Path:
    stem = staged_file.stem.replace("_STAGED", "").replace("_STG", "")
    return MAPPING_DIR / f"{stem}_MAPPED.csv"


def _standardize_product_flow(p) -> str:
    """แปลงชื่อผลิตภัณฑ์ปิโตรเลียมให้ตรงกับมาตรฐานตาราง FLOW"""
    if pd.isna(p):
        return "Petroleum Product"
    p_str = str(p).upper().strip()
    if "CRUDE" in p_str:
        return "Crude Oil"
    if "NATURAL GAS" in p_str:
        return "Natural Gas"
    if "CONDENSATE" in p_str:
        return "Condensate"
    if "DIESEL" in p_str:
        return "Diesel"
    if "GASOLINE" in p_str or "ULG" in p_str or "GASOHOL" in p_str:
        return "Gasoline"
    if "JET" in p_str:
        return "Jet Fuel"
    if "FUEL OIL" in p_str:
        return "Fuel Oil"
    if "LPG" in p_str:
        return "LPG"
    if "KEROSENE" in p_str:
        return "Kerosene"
    return p_str.title()


def _get_days_in_month(year: int, month_num: int) -> int:
    try:
        y = int(float(year))
        m = int(float(month_num))
        return calendar.monthrange(y, m)[1]
    except Exception:
        return 30


def _compute_upstream_balances() -> dict:
    """
    คำนวณสถิติผลผลิตปิโตรเลียมรายปีของประเทศไทยจาก DMF (SRC-044, SRC-045, SRC-046)
    แปลงเป็นหน่วยพลังงาน (BOE) และคำนวณสัดส่วนการปันส่วนพลังงาน (Energy Allocation Ratios)
    พร้อมดึงภาระมลพิษและการใช้พลังงานรวมจาก PTTEP (SRC-047)
    """
    balances = {}

    f44 = list(STAGING_DIR.glob("SRC-044_*_STAGED.csv"))
    f45 = list(STAGING_DIR.glob("SRC-045_*_STAGED.csv"))
    f46 = list(STAGING_DIR.glob("SRC-046_*_STAGED.csv"))
    f47 = list(STAGING_DIR.glob("SRC-047_*_STAGED.csv"))

    if not (f44 and f45 and f46):
        return balances

    df44 = pd.read_csv(f44[0], low_memory=False)
    df45 = pd.read_csv(f45[0], low_memory=False)
    df46 = pd.read_csv(f46[0], low_memory=False)

    df44["oil_bbl"] = pd.to_numeric(df44["oil_bbl_day"], errors="coerce") * pd.to_numeric(df44["days_of_produce"], errors="coerce")
    df45["gas_scf"] = pd.to_numeric(df45["gas_mmscf_day"], errors="coerce") * pd.to_numeric(df45["days_of_produce"], errors="coerce") * 1e6
    df45["gas_boe"] = pd.to_numeric(df45["gas_equi_oil_bbl_day"], errors="coerce") * pd.to_numeric(df45["days_of_produce"], errors="coerce")
    df46["cond_bbl"] = pd.to_numeric(df46["condensate_bbl_day"], errors="coerce") * pd.to_numeric(df46["days_of_produce"], errors="coerce")
    df46["cond_boe"] = pd.to_numeric(df46["condensate_equi_oil_bbl_day"], errors="coerce") * pd.to_numeric(df46["days_of_produce"], errors="coerce")

    agg44 = df44.groupby("year")["oil_bbl"].sum()
    agg45_scf = df45.groupby("year")["gas_scf"].sum()
    agg45_boe = df45.groupby("year")["gas_boe"].sum()
    agg46_bbl = df46.groupby("year")["cond_bbl"].sum()
    agg46_boe = df46.groupby("year")["cond_boe"].sum()

    all_years = sorted(list(set(agg44.index).union(set(agg45_scf.index)).union(set(agg46_bbl.index))))

    df47_data = {}
    if f47:
        df47 = pd.read_csv(f47[0], low_memory=False)
        for y, group in df47.groupby("year"):
            ind_map = {}
            for _, r in group.iterrows():
                ind_map[str(r["indicator"]).strip()] = float(r["value"])
            df47_data[int(y)] = ind_map

    for y in all_years:
        o_bbl = float(agg44.get(y, 0.0))
        o_boe = o_bbl
        g_scf = float(agg45_scf.get(y, 0.0))
        g_boe = float(agg45_boe.get(y, 0.0))
        c_bbl = float(agg46_bbl.get(y, 0.0))
        c_boe = float(agg46_boe.get(y, 0.0))

        tot_boe = o_boe + g_boe + c_boe
        if tot_boe > 0:
            alloc_oil = o_boe / tot_boe
            alloc_gas = g_boe / tot_boe
            alloc_cond = c_boe / tot_boe
        else:
            alloc_oil = alloc_gas = alloc_cond = 0.0

        pttep_burdens = df47_data.get(int(y), None)

        balances[int(y)] = {
            "oil_bbl": o_bbl,
            "oil_boe": o_boe,
            "gas_scf": g_scf,
            "gas_boe": g_boe,
            "cond_bbl": c_bbl,
            "cond_boe": c_boe,
            "tot_boe": tot_boe,
            "alloc_oil": alloc_oil,
            "alloc_gas": alloc_gas,
            "alloc_cond": alloc_cond,
            "burdens": pttep_burdens,
        }

    return balances


def map_staged_dataframe(df_staged: pd.DataFrame, source_id: str) -> pd.DataFrame:
    """
    แปลง DataFrame จาก Staging เข้าสู่โครงสร้างกลางตามคู่มือการปฏิบัติงาน (ISO 14044):
    - น้ำมันดิบ (SRC-044), ก๊าซธรรมชาติ (SRC-045), คอนเดนเสท (SRC-046):
      รวมยอดรายปี ปันส่วนพลังงาน และปรับฐานเป็น 1 FU (amount = 1.00 สำหรับสินค้าหลัก)
    - กลางน้ำ (SRC-048, SRC-049, SRC-050): รวมยอดรายเดือนเป็นผลรวมรายปี (Annual Sum)
    """
    mapped_rows = []
    timestamp_bkk = get_bkk_timestamp()

    # ดึงค่า Provenance พื้นฐานจากแถวแรกของ Staging
    sample_row = df_staged.iloc[0]
    prov_dict = {
        "_source_id": source_id,
        "_subtrack": sample_row.get("_subtrack", ""),
        "_extraction_batch_id": sample_row.get("_extraction_batch_id", ""),
        "_source_url": sample_row.get("_source_url", ""),
        "_source_sha256": sample_row.get("_source_sha256", ""),
        "_raw_file": sample_row.get("_raw_file", ""),
        "_staged_at": sample_row.get("_staged_at", ""),
        "_mapped_at": timestamp_bkk,
    }

    if source_id in ["SRC-044", "SRC-045", "SRC-046"]:
        upstream_balances = _compute_upstream_balances()
        sorted_years = sorted(upstream_balances.keys())

        rec_counter = 1
        for y in sorted_years:
            b = upstream_balances[y]
            burdens = b.get("burdens")
            has_burdens = burdens is not None

            if source_id == "SRC-044":
                prod_amount = b["oil_bbl"]
                alloc_ratio = b["alloc_oil"]
                flow_name = "Crude Oil"
                flow_unit = "BBL"
                proc_name = "การผลิตน้ำมันดิบ (Crude Oil Production)"
            elif source_id == "SRC-045":
                prod_amount = b["gas_scf"]
                alloc_ratio = b["alloc_gas"]
                flow_name = "Natural Gas"
                flow_unit = "scf"
                proc_name = "การผลิตก๊าซธรรมชาติ (Natural Gas Production)"
            elif source_id == "SRC-046":
                prod_amount = b["cond_bbl"]
                alloc_ratio = b["alloc_cond"]
                flow_name = "Condensate"
                flow_unit = "BBL"
                proc_name = "การผลิตคอนเดนเสท (Condensate Production)"

            if has_burdens and prod_amount > 0:
                # -------------------------------------------------------------
                # ปีที่มีข้อมูลมลพิษครบถ้วน (2022-2025): ทำ 1 FU Normalization
                # -------------------------------------------------------------
                # 1. Reference Product Flow (1 FU = 1.00)
                ref_row = {
                    "record_id": rec_counter,
                    "year": y,
                    "month": "Annual",
                    "month_num": np.nan,
                    "domain": "Upstream - E&P",
                    "process_name": proc_name,
                    "location_name": "ประเทศไทย (Thailand)",
                    "country": "Thailand",
                    "flow_name": flow_name,
                    "flow_type": "product",
                    "compartment": "technosphere",
                    "direction": "OUT",
                    "amount": 1.00,
                    "unit": flow_unit,
                    "is_reference": True,
                    "allocation": 1.00,
                    **prov_dict,
                }
                mapped_rows.append(ref_row)
                rec_counter += 1

                # 2. ปันส่วนมลพิษและการใช้พลังงานต่อ 1 FU (Elementary & Input Flows)
                burden_configs = [
                    ("Total Direct GHG Emissions (Scope 1)", "elementary", "air", "OUT", "kgCO2e", 1000.0),
                    ("Methane Emissions (Scope 1)", "elementary", "air", "OUT", "kg", 1000.0),
                    ("Volatile Organic Compounds (VOCs)", "elementary", "air", "OUT", "kg", 1000.0),
                    ("Nitrogen Oxides (NOx)", "elementary", "air", "OUT", "kg", 1000.0),
                    ("Sulfur Oxides (SOx)", "elementary", "air", "OUT", "kg", 1000.0),
                    ("Direct Energy Consumption", "product", "technosphere", "IN", "MJ", 1000.0),
                ]

                for ind_name, f_type, comp, direction, unit_sym, multiplier in burden_configs:
                    if ind_name in burdens:
                        raw_burden = burdens[ind_name] * multiplier
                        allocated_burden = raw_burden * alloc_ratio
                        normalized_fu_amount = round(allocated_burden / prod_amount, 8)

                        b_row = {
                            "record_id": rec_counter,
                            "year": y,
                            "month": "Annual",
                            "month_num": np.nan,
                            "domain": "Upstream - E&P",
                            "process_name": proc_name,
                            "location_name": "ประเทศไทย (Thailand)",
                            "country": "Thailand",
                            "flow_name": ind_name,
                            "flow_type": f_type,
                            "compartment": comp,
                            "direction": direction,
                            "amount": normalized_fu_amount,
                            "unit": unit_sym,
                            "is_reference": False,
                            "allocation": 1.00,
                            **prov_dict,
                        }
                        mapped_rows.append(b_row)
                        rec_counter += 1

            else:
                # -------------------------------------------------------------
                # ปีที่ไม่มีข้อมูลมลพิษ (2003-2021, 2026): บันทึกเฉพาะยอดผลิตรวม
                # (จะถูกคัดกรองเข้า Rejected Records ใน Step 06 Validation)
                # -------------------------------------------------------------
                ref_row = {
                    "record_id": rec_counter,
                    "year": y,
                    "month": "Annual",
                    "month_num": np.nan,
                    "domain": "Upstream - E&P",
                    "process_name": proc_name,
                    "location_name": "ประเทศไทย (Thailand)",
                    "country": "Thailand",
                    "flow_name": flow_name,
                    "flow_type": "product",
                    "compartment": "technosphere",
                    "direction": "OUT",
                    "amount": round(prod_amount, 2),
                    "unit": flow_unit,
                    "is_reference": True,
                    "allocation": 1.00,
                    **prov_dict,
                }
                mapped_rows.append(ref_row)
                rec_counter += 1

    elif source_id == "SRC-047":
        # ข้อมูลภาพรวมการดำเนินงานด้านสิ่งแวดล้อมระดับประเทศของ PTTEP (2022-2025)
        rec_counter = 1
        for _, r in df_staged.iterrows():
            ind = str(r["indicator"]).strip()
            val = float(r["value"])
            u = str(r["unit"]).strip()
            y = int(float(r["year"]))

            # กรอง Hydrocarbon Production ให้เหลือเฉพาะหน่วย BOE เพื่อไม่ให้มีแถวผลิตภัณฑ์ซ้ำ 2 แถวต่อปี
            if "Hydrocarbon Production" in ind and u != "BOE":
                continue

            if "Hydrocarbon Production" in ind:
                is_ref = False
                f_type = "product"
                comp = "technosphere"
                direction = "OUT"
            elif "Direct Energy Consumption" in ind:
                is_ref = False
                f_type = "product"
                comp = "technosphere"
                direction = "IN"
            else:
                is_ref = False
                f_type = "elementary"
                comp = "air"
                direction = "OUT"

            mapped_rows.append({
                "record_id": rec_counter,
                "year": y,
                "month": "Annual",
                "month_num": np.nan,
                "domain": "Upstream - E&P",
                "process_name": "การสำรวจและผลิตปิโตรเลียม (PTTEP Upstream E&P)",
                "location_name": "ประเทศไทย (Thailand)",
                "country": "Thailand",
                "flow_name": ind,
                "flow_type": f_type,
                "compartment": comp,
                "direction": direction,
                "amount": round(val, 2),
                "unit": u,
                "is_reference": is_ref,
                "allocation": 1.00,
                **prov_dict,
            })
            rec_counter += 1

    elif source_id == "SRC-048":
        # ผลรวมการผลิตน้ำมันสำเร็จรูปรายปีของโรงกลั่นในประเทศ (Annual Sum by Product)
        df = df_staged.copy()
        df["quantity"] = pd.to_numeric(df["quantity"], errors="coerce")
        df["product_std"] = df["product"].apply(_standardize_product_flow)

        rec_counter = 1
        agg_df = df.groupby(["year", "product_std"])["quantity"].sum().reset_index()
        # คำนวณยอดรวมรายปีเพื่อหาอัตราส่วนปันส่วนปริมาตร (Volume Allocation Ratio) ปัด 8 หลัก
        year_totals = agg_df.groupby("year")["quantity"].sum().to_dict()

        for _, r in agg_df.iterrows():
            y = int(float(r["year"]))
            p_name = r["product_std"]
            qty = round(float(r["quantity"]), 3)
            tot_qty = year_totals.get(r["year"], 0.0)
            alloc_ratio = round(qty / tot_qty, 8) if tot_qty > 0 else 0.0
            is_ref = False

            mapped_rows.append({
                "record_id": rec_counter,
                "year": y,
                "month": "Annual",
                "month_num": np.nan,
                "domain": "Midstream - Refinery",
                "process_name": "การกลั่นน้ำมันปิโตรเลียม (Refining Process)",
                "location_name": "โรงกลั่นน้ำมันในประเทศ (Refineries in Thailand)",
                "country": "Thailand",
                "flow_name": p_name,
                "flow_type": "product",
                "compartment": "technosphere",
                "direction": "OUT",
                "amount": qty,
                "unit": "Million Litres",
                "is_reference": is_ref,
                "allocation": alloc_ratio,
                **prov_dict,
            })
            rec_counter += 1

    elif source_id == "SRC-049":
        # ผลรวมการใช้น้ำมันดิบเข้ากลั่นรายปีแยกตามโรงกลั่น (Annual Sum in BBL by Company)
        df = df_staged.copy()
        df["quantity"] = pd.to_numeric(df["quantity"], errors="coerce")
        df["days"] = df.apply(lambda r: _get_days_in_month(r["year"], r["month_num"]), axis=1)
        df["bbl_month"] = df["quantity"] * df["days"]

        rec_counter = 1
        agg_df = df.groupby(["year", "company"])["bbl_month"].sum().reset_index()
        for _, r in agg_df.iterrows():
            y = int(float(r["year"]))
            comp_name = str(r["company"]).strip()
            total_bbl = round(float(r["bbl_month"]), 2)

            mapped_rows.append({
                "record_id": rec_counter,
                "year": y,
                "month": "Annual",
                "month_num": np.nan,
                "domain": "Midstream - Refinery",
                "process_name": f"การนำเข้าน้ำมันดิบเข้ากลั่น (โรงกลั่น {comp_name})",
                "location_name": f"โรงกลั่น {comp_name} (Refinery)",
                "country": "Thailand",
                "flow_name": "Crude Oil",
                "flow_type": "product",
                "compartment": "technosphere",
                "direction": "IN",
                "amount": total_bbl,
                "unit": "BBL",
                "is_reference": False,
                "allocation": 1.00,
                **prov_dict,
            })
            rec_counter += 1

    elif source_id == "SRC-050":
        # ผลรวมการใช้ก๊าซธรรมชาติป้อนเข้าโรงแยกก๊าซ GSP รายปี (Annual Sum in scf)
        df = df_staged.copy()
        df["quantity"] = pd.to_numeric(df["quantity"], errors="coerce")
        df["days"] = df.apply(lambda r: _get_days_in_month(r["year"], r["month_num"]), axis=1)
        df["scf_month"] = df["quantity"] * df["days"] * 1e6

        rec_counter = 1
        agg_df = df.groupby("year")["scf_month"].sum().reset_index()
        for _, r in agg_df.iterrows():
            y = int(float(r["year"]))
            total_scf = round(float(r["scf_month"]), 2)

            mapped_rows.append({
                "record_id": rec_counter,
                "year": y,
                "month": "Annual",
                "month_num": np.nan,
                "domain": "Midstream - GSP",
                "process_name": "การแยกก๊าซธรรมชาติ (Gas Separation Plant - GSP)",
                "location_name": "ภาคส่วน GSP (Sector GSP)",
                "country": "Thailand",
                "flow_name": "Natural Gas",
                "flow_type": "product",
                "compartment": "technosphere",
                "direction": "IN",
                "amount": total_scf,
                "unit": "scf",
                "is_reference": False,
                "allocation": 1.00,
                **prov_dict,
            })
            rec_counter += 1

    else:
        raise ValueError(f"ไม่พบกฎการแมปข้อมูล (Mapping) สำหรับแหล่งข้อมูล: {source_id}")

    res_df = pd.DataFrame(mapped_rows)
    for col in MAPPED_COLUMNS:
        if col not in res_df.columns:
            res_df[col] = np.nan

    return res_df[MAPPED_COLUMNS].copy()


def map_data(source_id: str = "SRC-044") -> list[Path]:
    """
    ฟังก์ชันหลักสำหรับรัน Step 05: Data Mapping & LCI Allocation
    """
    MAPPING_DIR.mkdir(parents=True, exist_ok=True)

    staged_files = sorted(STAGING_DIR.glob(f"{source_id}_*_STAGED.csv"))
    if not staged_files:
        raise FileNotFoundError(
            f"ไม่พบไฟล์ Staging สำหรับ '{source_id}' ใน data/staging/\n"
            f"            - คำแนะนำ     : กรุณารัน Step 04 (Data Staging) สำหรับ {source_id} ก่อน"
        )

    mapped_paths = []
    for staged_file in staged_files:
        df_staged = pd.read_csv(staged_file, low_memory=False)
        df_mapped = map_staged_dataframe(df_staged, source_id)

        out_path = get_mapped_output_path(staged_file)
        df_mapped.to_csv(out_path, index=False, encoding="utf-8-sig")
        mapped_paths.append(out_path)

        unique_procs = df_mapped[["process_name", "year", "location_name"]].drop_duplicates().shape[0]
        ref_count = int(df_mapped["is_reference"].sum())
        flows = ", ".join(sorted(df_mapped["flow_name"].dropna().unique().tolist()))

        print(
            f"  {'[MAPPING]':<14}แปลง {staged_file.name} -> {out_path.name}"
        )
        print(
            f"  {'[SCHEMA]':<14}Unified Mapped Schema ({len(df_mapped):,} แถว, {len(df_mapped.columns)} คอลัมน์ | "
            f"Processes: {unique_procs:,} | Ref Flows: {ref_count:,} | Flows: {flows})"
        )

    return mapped_paths


def map_all_staged():
    """รัน Step 05 Data Mapping สำหรับทุกชุดข้อมูลใน data/staging/"""
    staged_files = sorted(STAGING_DIR.glob("*_STAGED.csv"))
    if not staged_files:
        print("[STEP 05] ไม่พบไฟล์ใน data/staging/ กรุณารัน Step 04 ก่อน")
        return
    source_ids = sorted(list({f.name.split("_")[0] for f in staged_files if f.name.startswith("SRC-")}))
    for sid in source_ids:
        map_data(sid)


# Alias เพื่อความเข้ากันได้ย้อนหลัง
map_to_canonical = map_data
mapping_data = map_data


if __name__ == "__main__":
    args = sys.argv[1:]
    clean_args = [a for a in args if not a.startswith("--")]
    if not clean_args or "--all" in args:
        map_all_staged()
    else:
        for sid in clean_args:
            map_data(sid)
