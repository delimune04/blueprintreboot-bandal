from pathlib import Path

import pytest

from services.tag_book import normalize_tag
from services.note_import import apply_external_note_import, parse_external_note_text
from services.reading_note_template import refresh_reading_note_header
from storage.note_store import save_note_text
from storage.file_transaction import file_transaction


def test_unicode_tag_names_preserve_korean_and_ascii_identity():
    assert normalize_tag("지구과학") == "지구과학"
    assert normalize_tag("CCS 저장") == "ccs-저장"
    assert normalize_tag("ATAC-seq") == "atac-seq"
    assert normalize_tag("  ChIP_seq!!  ") == "chip-seq"


def test_bilingual_note_import_keeps_canonical_section_contract():
    text = "# 랩비움 읽기 노트\n\ntemplate_version: 1.0\npaper_id: paper-1\n\n## 요약\n연구 요약\n\n## 근거 / 결과\n관측 근거\n\n## 자유 메모\n보존할 메모\n"
    parsed = parse_external_note_text(text)
    assert not parsed["parse_errors"]
    assert parsed["sections"]["Summary"] == "연구 요약"
    assert parsed["sections"]["Evidence / Results"] == "관측 근거"
    assert parsed["sections"]["Raw Notes"] == "보존할 메모"
    refreshed = refresh_reading_note_header(text, {"paper_id": "paper-1", "title": "수정 제목"})
    assert "## 요약\n연구 요약" in refreshed["text"]
    assert refreshed["text"].startswith("# 랩비움 읽기 노트")


def test_note_import_late_log_failure_rolls_back_all_files(tmp_path, monkeypatch):
    record = {"paper_id": "paper-1", "title": "논문"}
    notes = tmp_path / "notes"
    blocks = tmp_path / "data" / "note_blocks"
    log = tmp_path / "data" / "note_imports.json"
    note_path = save_note_text(record, "original note", notes)
    parsed = parse_external_note_text("# BluePrint Reading Note\n## Summary\nnew summary\n## Raw Notes\nnew raw note\n")
    def fail_log(*_args):
        raise OSError("history write failed")
    monkeypatch.setattr("services.note_import._append_note_import_log", fail_log)
    with pytest.raises(OSError, match="history write failed"):
        apply_external_note_import(record, parsed, notes_dir=notes, note_blocks_dir=blocks, log_path=log)
    assert note_path.read_text() == "original note"
    assert not (blocks / "paper-1.json").exists()
    assert not log.exists()


def test_file_group_failure_restores_removed_source_and_existing_target(tmp_path):
    source, target = tmp_path / "source", tmp_path / "target"
    source.write_bytes(b"source bytes")
    target.write_bytes(b"target bytes")
    with pytest.raises(OSError, match="late failure"):
        with file_transaction([source, target]):
            source.unlink()
            target.write_bytes(b"partial new value")
            raise OSError("late failure")
    assert source.read_bytes() == b"source bytes"
    assert target.read_bytes() == b"target bytes"
