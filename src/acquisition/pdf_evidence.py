"""Versioned publisher reports and the table cells reviewed for the pipeline."""

import json
from functools import lru_cache
from pathlib import Path

EVIDENCE_FILE = Path(__file__).resolve().parents[2] / "docs" / "source_registry" / "pdf_evidence.json"


@lru_cache(maxsize=1)
def load_pdf_evidence() -> dict:
    with EVIDENCE_FILE.open(encoding="utf-8") as stream:
        return json.load(stream)
