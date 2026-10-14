import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from services import settings_read_model
from services.backup_snapshot import create_backup_snapshot


NOW = datetime(2026, 10, 14, 5, 0, tzinfo=timezone.utc)


def _workspace(root: Path) -> Path:
    source = root / "data/settings.json"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text('{"theme":"dark"}', encoding="utf-8")
    return source


def _snapshot(root: Path, *, full: bool = True, now=NOW) -> Path:
    result = create_backup_snapshot(project_root=root, exports_dir=root / "exports", include_pdfs=full, now=now)
    return Path(result["snapshot_path"])


def _read(root: Path):
    return settings_read_model._snapshot_readiness(root / "exports", workspace_root=root, now=NOW)


def test_snapshot_filename_is_not_backup_evidence(tmp_path) -> None:
    _workspace(tmp_path)
    assert _read(tmp_path)["evidence_state"] == "absent"
    (tmp_path / "exports").mkdir()
    (tmp_path / "exports/blueprint_snapshot_fake.zip").write_bytes(b"not a ZIP")
    result = _read(tmp_path)
    assert result["state"] == "warning"
    assert result["evidence_state"] == "invalid"
    assert result["snapshot_available"] is False
    assert result["last_updated_at"] is None


def test_verified_full_and_light_snapshots_remain_distinct(tmp_path) -> None:
    _workspace(tmp_path)
    full = _snapshot(tmp_path)
    result = _read(tmp_path)
    assert result["state"] == "healthy"
    assert result["evidence_state"] == "verified_full"
    assert result["snapshot_type"] == "full"
    full.unlink()
    _snapshot(tmp_path, full=False)
    result = _read(tmp_path)
    assert result["state"] == "warning"
    assert result["evidence_state"] == "verified_light"
    assert result["snapshot_available"] is True
    assert result["snapshot_type"] == "light"


def test_archive_mtime_cannot_rejuvenate_an_old_backup(tmp_path) -> None:
    _workspace(tmp_path)
    old = NOW - timedelta(days=8)
    snapshot = _snapshot(tmp_path, now=old)
    os.utime(snapshot, (NOW.timestamp(), NOW.timestamp()))
    result = _read(tmp_path)
    assert result["evidence_state"] == "stale"
    assert result["snapshot_available"] is True
    assert result["last_updated_at"] == old.isoformat().replace("+00:00", "Z")


def test_edited_critical_state_marks_verified_backup_stale_even_if_mtime_is_same(tmp_path) -> None:
    source = _workspace(tmp_path)
    _snapshot(tmp_path)
    before = source.stat()
    source.write_text('{"theme":"lite"}', encoding="utf-8")
    os.utime(source, ns=(before.st_atime_ns, before.st_mtime_ns))
    result = _read(tmp_path)
    assert result["evidence_state"] == "stale"
    assert result["snapshot_type"] == "full"


def test_added_and_removed_user_files_mark_backup_stale(tmp_path) -> None:
    source = _workspace(tmp_path)
    _snapshot(tmp_path)
    source.unlink()
    assert _read(tmp_path)["evidence_state"] == "stale"


def test_full_snapshot_detects_added_live_pdf_without_reading_it(tmp_path, monkeypatch) -> None:
    _workspace(tmp_path)
    _snapshot(tmp_path)
    pdf = tmp_path / "papers/new.pdf"
    pdf.parent.mkdir()
    pdf.write_bytes(b"%PDF-new")
    original_open = Path.open

    def guarded_open(path, *args, **kwargs):
        if path.suffix.casefold() == ".pdf":
            raise AssertionError("The Settings read opened a current PDF")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", guarded_open)
    assert _read(tmp_path)["evidence_state"] == "stale"


def test_valid_zip_with_tampered_member_fails_sha_verification(tmp_path) -> None:
    _workspace(tmp_path)
    snapshot = _snapshot(tmp_path)
    with ZipFile(snapshot) as original:
        files = {name: original.read(name) for name in original.namelist()}
    files["data/settings.json"] = b'{"theme":"evil"}'
    with ZipFile(snapshot, "w", compression=ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)
    assert _read(tmp_path)["evidence_state"] == "invalid"


def test_backup_verification_is_bounded_and_does_not_mutate_files(tmp_path, monkeypatch) -> None:
    _workspace(tmp_path)
    _snapshot(tmp_path)
    before = {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in tmp_path.rglob("*") if path.is_file()}
    monkeypatch.setattr(settings_read_model, "MAX_SETTINGS_BACKUP_BYTES", 1)
    assert _read(tmp_path)["evidence_state"] == "unavailable"
    assert before == {path: (path.read_bytes(), path.stat().st_mtime_ns) for path in tmp_path.rglob("*") if path.is_file()}
