import hashlib
import json
import threading
from datetime import datetime, timezone
from pathlib import Path

import pytest

from services.storage_recovery import (
    StorageRecoveryError,
    export_recovery_copy,
    quarantine_file,
    restore_quarantined_file,
)
from tests.helpers import make_workspace
from storage.workspace_lock import workspace_write_lock


NOW = datetime(2026, 7, 12, 3, 0, tzinfo=timezone.utc)


def _source(name: str = "recovery"):
    root = make_workspace(name)
    source = root / "data" / "extracted_text" / "paper.txt"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"\x00corrupt\xffbytes")
    return root, source


def test_recovery_copy_preserves_exact_bytes_and_manifest() -> None:
    root, source = _source("recovery-exact")
    before = source.read_bytes()
    result = export_recovery_copy(source, workspace_root=root, recovery_dir=root / "exports" / "recovery", storage_class="rebuildable cache", reason="invalid UTF-8", now=NOW)

    copy = type(source)(result["copy_path"])
    manifest = json.loads(type(source)(result["manifest_path"]).read_text(encoding="utf-8"))
    assert copy.read_bytes() == before == source.read_bytes()
    assert manifest["byte_size"] == len(before)
    assert manifest["sha256"] == hashlib.sha256(before).hexdigest()
    assert manifest["workspace_relative_path"] == "data/extracted_text/paper.txt"


def test_recovery_copy_collision_is_safe() -> None:
    root, source = _source("recovery-collision")
    first = export_recovery_copy(source, workspace_root=root, recovery_dir=root / "exports", storage_class="rebuildable cache", reason="test", now=NOW)
    second = export_recovery_copy(source, workspace_root=root, recovery_dir=root / "exports", storage_class="rebuildable cache", reason="test", now=NOW)
    assert first["copy_path"] != second["copy_path"]


def test_recovery_rejects_outside_workspace() -> None:
    root, _source_path = _source("recovery-contained")
    outside = root.parent / "outside.bin"
    outside.write_bytes(b"outside")
    with pytest.raises(StorageRecoveryError, match="workspace"):
        export_recovery_copy(outside, workspace_root=root, recovery_dir=root / "exports", storage_class="critical user state", reason="test")


def test_recovery_rejects_output_outside_workspace() -> None:
    root, source = _source("recovery-output-contained")
    with pytest.raises(StorageRecoveryError, match="output"):
        export_recovery_copy(source, workspace_root=root, recovery_dir=root.parent / "external-recovery", storage_class="rebuildable cache", reason="test")


def test_quarantine_requires_rebuildable_and_confirmation() -> None:
    root, source = _source("quarantine-eligibility")
    with pytest.raises(StorageRecoveryError, match="confirmation"):
        quarantine_file(source, workspace_root=root, quarantine_dir=root / "quarantine", storage_class="rebuildable cache", reason="test", rebuildable=True, confirm=False)
    with pytest.raises(StorageRecoveryError, match="rebuildable"):
        quarantine_file(source, workspace_root=root, quarantine_dir=root / "quarantine", storage_class="critical user state", reason="test", rebuildable=False, confirm=True)
    assert source.exists()


def test_quarantine_and_verified_restore_round_trip() -> None:
    root, source = _source("quarantine-restore")
    before = source.read_bytes()
    quarantined = quarantine_file(source, workspace_root=root, quarantine_dir=root / "quarantine", storage_class="rebuildable cache", reason="test", rebuildable=True, confirm=True, now=NOW)
    assert not source.exists()
    assert quarantine_file(source, workspace_root=root, quarantine_dir=root / "quarantine", storage_class="rebuildable cache", reason="test", rebuildable=True, confirm=True)["status"] == "already_absent"

    restored = restore_quarantined_file(quarantined["manifest_path"], workspace_root=root, confirm=True)
    assert restored["status"] == "restored"
    assert source.read_bytes() == before
    assert type(source)(quarantined["copy_path"]).exists()


def test_restore_conflict_and_tampering_preserve_destination() -> None:
    root, source = _source("restore-conflict")
    quarantined = quarantine_file(source, workspace_root=root, quarantine_dir=root / "quarantine", storage_class="rebuildable cache", reason="test", rebuildable=True, confirm=True)
    source.write_bytes(b"new active bytes")
    with pytest.raises(StorageRecoveryError, match="conflict"):
        restore_quarantined_file(quarantined["manifest_path"], workspace_root=root, confirm=True)
    assert source.read_bytes() == b"new active bytes"
    source.unlink()
    type(source)(quarantined["copy_path"]).write_bytes(b"tampered")
    with pytest.raises(StorageRecoveryError, match="match"):
        restore_quarantined_file(quarantined["manifest_path"], workspace_root=root, confirm=True)
    assert not source.exists()


def test_failed_quarantine_copy_preserves_source(monkeypatch) -> None:
    root, source = _source("quarantine-copy-failure")
    before = source.read_bytes()
    monkeypatch.setattr("services.storage_recovery.shutil.copyfileobj", lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("copy failed")))
    with pytest.raises(OSError, match="copy failed"):
        quarantine_file(source, workspace_root=root, quarantine_dir=root / "quarantine", storage_class="rebuildable cache", reason="test", rebuildable=True, confirm=True)
    assert source.read_bytes() == before


def test_restore_rejects_nonmatching_external_manifest() -> None:
    root, source = _source("restore-manifest-contained")
    external_copy = root.parent / "external-quarantine.bin"
    external_copy.write_bytes(source.read_bytes())
    manifest = root / "data" / "quarantine" / "crafted.manifest.json"
    manifest.parent.mkdir(parents=True)
    manifest.write_text(json.dumps({"original_path": str(source), "copy_path": str(external_copy), "sha256": hashlib.sha256(source.read_bytes()).hexdigest(), "byte_size": source.stat().st_size}), encoding="utf-8")
    source.unlink()
    with pytest.raises(StorageRecoveryError, match="workspace-owned"):
        restore_quarantined_file(manifest, workspace_root=root, confirm=True)
    assert not source.exists()


@pytest.mark.parametrize("relative", ["data/settings.json", "data/paper_index.csv", "notes/paper.md", ".streamlit/config.toml"])
def test_quarantine_cannot_reclassify_user_state_as_a_cache(tmp_path, relative) -> None:
    source = tmp_path / relative
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"irreplaceable bytes")
    with pytest.raises(StorageRecoveryError, match="registry-defined rebuildable"):
        quarantine_file(source, workspace_root=tmp_path, quarantine_dir=tmp_path / "data/quarantine", storage_class="rebuildable cache", reason="spoofed classification", rebuildable=True, confirm=True)
    assert source.read_bytes() == b"irreplaceable bytes"


@pytest.mark.parametrize("relative", ["README.md", ".streamlit/secrets.toml", "data/unregistered.json", "data/extracted_text/nested/paper.txt"])
def test_recovery_registry_refuses_unregistered_or_secret_sources(tmp_path, relative) -> None:
    source = tmp_path / relative
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_bytes(b"sensitive or unrelated bytes")
    with pytest.raises(StorageRecoveryError, match="registry"):
        export_recovery_copy(source, workspace_root=tmp_path, recovery_dir=tmp_path / "exports/recovery", storage_class="critical user state", reason="test")
    assert source.read_bytes() == b"sensitive or unrelated bytes"
    assert not (tmp_path / "exports").exists()


def test_recovery_refuses_even_internal_source_symlinks(tmp_path) -> None:
    source = tmp_path / "data/extracted_text/paper.txt"
    source.parent.mkdir(parents=True)
    target = source.with_name("other.txt")
    target.write_bytes(b"keep target")
    source.symlink_to(target)
    with pytest.raises(StorageRecoveryError, match="symlink"):
        quarantine_file(source, workspace_root=tmp_path, quarantine_dir=tmp_path / "data/quarantine", storage_class="rebuildable cache", reason="test", rebuildable=True, confirm=True)
    assert source.is_symlink()
    assert target.read_bytes() == b"keep target"


def test_restore_refuses_a_file_created_at_publication_time(tmp_path, monkeypatch) -> None:
    source = tmp_path / "data/extracted_text/paper.txt"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"quarantined bytes")
    saved = quarantine_file(source, workspace_root=tmp_path, quarantine_dir=tmp_path / "data/quarantine", storage_class="rebuildable cache", reason="test", rebuildable=True, confirm=True)
    from services import storage_recovery
    link = storage_recovery.os.link

    def intervening_write(temporary, destination, **kwargs):
        Path(destination).write_bytes(b"newly active bytes")
        return link(temporary, destination, **kwargs)

    monkeypatch.setattr(storage_recovery.os, "link", intervening_write)
    with pytest.raises(StorageRecoveryError, match="conflict"):
        restore_quarantined_file(saved["manifest_path"], workspace_root=tmp_path, confirm=True)
    assert source.read_bytes() == b"newly active bytes"
    assert Path(saved["copy_path"]).read_bytes() == b"quarantined bytes"
    assert not list(source.parent.glob("*.tmp"))


def test_failed_exclusive_recovery_copy_does_not_delete_existing_bytes(tmp_path, monkeypatch) -> None:
    source = tmp_path / "data/extracted_text/paper.txt"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"source bytes")
    existing = tmp_path / "exports/recovery/existing.txt"
    existing.parent.mkdir(parents=True)
    existing.write_bytes(b"prior recovery bytes")
    monkeypatch.setattr("services.storage_recovery._available", lambda *_args: existing)
    with pytest.raises(FileExistsError):
        export_recovery_copy(source, workspace_root=tmp_path, recovery_dir=existing.parent, storage_class="rebuildable cache", reason="test")
    assert existing.read_bytes() == b"prior recovery bytes"
    assert source.read_bytes() == b"source bytes"


def test_failed_manifest_publication_preserves_an_intervening_manifest(tmp_path, monkeypatch) -> None:
    source = tmp_path / "data/extracted_text/paper.txt"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"source bytes")
    original_open = Path.open

    def raced_open(path, mode="r", *args, **kwargs):
        if mode == "x" and path.name.endswith(".manifest.json"):
            with original_open(path, "x", encoding="utf-8") as writer:
                writer.write("prior manifest bytes")
            raise FileExistsError("intervening manifest")
        return original_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(Path, "open", raced_open)
    with pytest.raises(FileExistsError):
        export_recovery_copy(source, workspace_root=tmp_path, recovery_dir=tmp_path / "exports/recovery", storage_class="rebuildable cache", reason="test")
    manifests = list((tmp_path / "exports/recovery").glob("*.manifest.json"))
    assert len(manifests) == 1
    assert manifests[0].read_text() == "prior manifest bytes"
    assert source.read_bytes() == b"source bytes"


def test_recovery_holds_shared_workspace_lock_during_copy_and_manifest(tmp_path, monkeypatch) -> None:
    from services import storage_recovery
    source = tmp_path / "data/extracted_text/paper.txt"
    source.parent.mkdir(parents=True)
    source.write_bytes(b"before concurrent writer")
    entered_copy = threading.Event()
    release_copy = threading.Event()
    writer_entered = threading.Event()
    errors = []
    exported = []
    original_copy = storage_recovery.shutil.copyfileobj

    def paused_copy(*args, **kwargs):
        entered_copy.set()
        assert release_copy.wait(2)
        original_copy(*args, **kwargs)

    monkeypatch.setattr(storage_recovery.shutil, "copyfileobj", paused_copy)

    def recover():
        try:
            exported.append(export_recovery_copy(source, workspace_root=tmp_path, recovery_dir=tmp_path / "exports/recovery", storage_class="rebuildable cache", reason="test"))
        except Exception as error:
            errors.append(error)

    def mutate():
        with workspace_write_lock(tmp_path):
            writer_entered.set()
            source.write_bytes(b"after concurrent writer")

    recovery_thread = threading.Thread(target=recover)
    recovery_thread.start()
    assert entered_copy.wait(2)
    writer_thread = threading.Thread(target=mutate)
    writer_thread.start()
    try:
        assert not writer_entered.wait(0.05)
    finally:
        release_copy.set()
        recovery_thread.join(2)
        writer_thread.join(2)
    assert not errors
    assert writer_entered.is_set()
    assert Path(exported[0]["copy_path"]).read_bytes() == b"before concurrent writer"
    assert source.read_bytes() == b"after concurrent writer"
