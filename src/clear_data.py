import os
import shutil
import sys
from pathlib import Path

# กำหนด Console encoding สำหรับ Windows
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

CURRENT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = CURRENT_DIR.parent if CURRENT_DIR.name == "src" else CURRENT_DIR
DATA_DIR = PROJECT_ROOT / "data"


def clear_data(folders: list[str] = None) -> int:
    """
    ฟังก์ชันล้างไฟล์ข้อมูลที่ดาวน์โหลดมาใน data/ เพื่อรีเซ็ตระบบ
    โดยจะเก็บไฟล์ .gitkeep ไว้เสมอเพื่อให้โฟลเดอร์ไม่หายไปจาก Git
    """
    if folders is None:
        target_folders = ["raw", "parsed", "staging", "accepted", "rejected"]
    else:
        target_folders = folders

    total_deleted = 0
    print("\n==========================================")
    print("[CLEAN] เริ่มต้นล้างข้อมูลในโฟลเดอร์ data/")
    print("==========================================")

    for sub in target_folders:
        folder_path = DATA_DIR / sub
        if not folder_path.exists():
            continue

        deleted_in_folder = 0
        for item in folder_path.iterdir():
            if item.name == ".gitkeep":
                continue

            try:
                if item.is_file():
                    item.unlink()
                    deleted_in_folder += 1
                elif item.is_dir():
                    shutil.rmtree(item)
                    deleted_in_folder += 1
            except Exception as e:
                print(f"[WARN] ไม่สามารถลบ {item.name}: {e}")

        total_deleted += deleted_in_folder
        print(f"[INFO] ล้าง data/{sub}/: ลบไป {deleted_in_folder} ไฟล์")

    print(f"\n[OK] ล้างข้อมูลเสร็จสมบูรณ์! ลบไฟล์ทั้งหมด {total_deleted} ไฟล์")
    print("==========================================\n")
    return total_deleted


if __name__ == "__main__":
    # สามารถระบุโฟลเดอร์เฉพาะ เช่น python src/clear_data.py raw
    # หรือถ้ารันเปล่าๆ จะล้างข้อมูลทุกโฟลเดอร์
    args = sys.argv[1:]
    if args:
        clear_data(folders=args)
    else:
        clear_data()
