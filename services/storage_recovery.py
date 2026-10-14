from __future__ import annotations

import hashlib
import json
import os
import shutil
import stat
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config.contact import APP_VERSION
from storage.atomic_text import fsync_parent_directory
from storage.identities import is_safe_paper_id
from storage.persistent_state import PERSISTENT_JSON_STORES
from storage.workspace_lock import WorkspaceLockUnavailable, workspace_write_lock


class StorageRecoveryError(RuntimeError):
    pass


@dataclass(frozen=True)
class _OwnedStorage:
    storage_class: str
    rebuildable: bool = False


_PERSISTENT_PATHS = frozenset(item.relative_path for item in PERSISTENT_JSON_STORES)
_MAX_RECOVERY_MANIFEST_BYTES = 1024 * 1024


def _workspace_path(path: str | Path, root: Path, *, output: bool = False) -> Path:
    """Keep lexical ownership and reject symlinks before resolving a target."""
    candidate = Path(os.path.abspath(path))
    try:
        parts = candidate.relative_to(root).parts
    except ValueError:
        message = "Recovery output is restricted to the workspace." if output else "Recovery is restricted to app-owned workspace paths."
        raise StorageRecoveryError(message) from None
    current = root
    for part in parts:
        current /= part
        if current.is_symlink():
            raise StorageRecoveryError("Recovery does not follow workspace symlinks.")
    return candidate


def _owned_storage(path: Path, root: Path) -> _OwnedStorage:
    relative = path.relative_to(root)
    value = relative.as_posix()
    parts = relative.parts
    if value in _PERSISTENT_PATHS or value == "data/paper_index.csv":
        return _OwnedStorage("critical user state")
    if value == ".streamlit/config.toml":
        return _OwnedStorage("application configuration")
    if len(parts) == 2 and parts[0] == "notes" and path.suffix.casefold() == ".md" and is_safe_paper_id(path.stem):
        return _OwnedStorage("critical user state")
    if len(parts) == 3 and parts[:2] == ("data", "note_blocks") and path.suffix.casefold() == ".json" and is_safe_paper_id(path.stem):
        return _OwnedStorage("critical user state")
    if len(parts) >= 2 and parts[0] == "papers" and path.suffix.casefold() == ".pdf":
        return _OwnedStorage("managed PDF")
    if len(parts) == 3 and is_safe_paper_id(path.stem):
        if parts[:2] == ("data", "extracted_text") and path.suffix.casefold() in {".txt", ".json"}:
            return _OwnedStorage("rebuildable cache", True)
        if parts[:2] == ("data", "paper_profiles") and path.suffix.casefold() == ".json":
            return _OwnedStorage("rebuildable cache", True)
    raise StorageRecoveryError("Recovery source is not in the app-owned storage registry.")


def _output_directory(path: str | Path, root: Path) -> Path:
    target = _workspace_path(path, root, output=True)
    parts = target.relative_to(root).parts
    if not parts or not (parts[0] == "exports" or parts[0] == "quarantine" or parts[:2] == ("data", "quarantine")):
        raise StorageRecoveryError("Recovery output must use an app-owned recovery or quarantine directory.")
    return target


@contextmanager
def _write_lock(root: Path):
    try:
        with workspace_write_lock(root):
            yield
    except WorkspaceLockUnavailable:
        raise StorageRecoveryError("The workspace recovery lock is unavailable.") from None


def _regular_stat(path: Path) -> os.stat_result:
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode):
        raise StorageRecoveryError("The diagnosed source file is absent or is not a regular file.")
    return info


def _file_identity(info: os.stat_result) -> tuple[int, int, int, int]:
    return info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns


@contextmanager
def _open_regular(path: Path):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0))
    try:
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise StorageRecoveryError("Recovery requires a regular workspace-owned file.")
        with os.fdopen(descriptor, "rb", closefd=False) as source:
            yield source
    finally:
        os.close(descriptor)


def _now(value: datetime | None = None) -> datetime:
    current = value or datetime.now(timezone.utc)
    if current.tzinfo is None:
        current = current.replace(tzinfo=timezone.utc)
    return current.astimezone(timezone.utc).replace(microsecond=0)


def _within(path: Path, root: Path) -> bool:
    try:
        path.resolve(strict=False).relative_to(root.resolve(strict=False))
        return True
    except ValueError:
        return False


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with _open_regular(path) as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _available(directory: Path, name: str) -> Path:
    candidate = directory / name
    suffix = 2
    while candidate.exists() or candidate.is_symlink() or candidate.with_suffix(candidate.suffix + ".manifest.json").exists() or candidate.with_suffix(candidate.suffix + ".manifest.json").is_symlink():
        candidate = directory / f"{Path(name).stem}_{suffix}{Path(name).suffix}"
        suffix += 1
    return candidate


def _copy_manifest_path(copy_path: Path) -> Path:
    return copy_path.with_suffix(copy_path.suffix + ".manifest.json")


def export_recovery_copy(
    source: str | Path,
    *,
    workspace_root: str | Path,
    recovery_dir: str | Path,
    storage_class: str,
    reason: str,
    now: datetime | None = None,
) -> dict[str, Any]:
    root = Path(workspace_root).resolve(strict=False)
    with _write_lock(root):
        return _export_recovery_copy(source, root=root, recovery_dir=recovery_dir, reason=reason, now=now)


def _export_recovery_copy(source: str | Path, *, root: Path, recovery_dir: str | Path, reason: str, now: datetime | None) -> dict[str, Any]:
    source_path = _workspace_path(source, root)
    classification = _owned_storage(source_path, root)
    try:
        before = _regular_stat(source_path)
    except FileNotFoundError:
        raise StorageRecoveryError("The diagnosed source file is absent or is not a regular file.") from None
    output_dir = _output_directory(recovery_dir, root)
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = _now(now)
    relative = source_path.relative_to(root).as_posix()
    safe_name = relative.replace("/", "__").replace("\\", "__")
    destination = _available(output_dir, f"{timestamp.strftime('%Y%m%dT%H%M%SZ')}__{safe_name}")
    manifest_path = _copy_manifest_path(destination)
    copy_created = False
    manifest_created = False
    try:
        with _open_regular(source_path) as reader:
            if _file_identity(os.fstat(reader.fileno())) != _file_identity(before):
                raise StorageRecoveryError("The active file changed before recovery copying; it was preserved.")
            with destination.open("xb") as writer:
                copy_created = True
                shutil.copyfileobj(reader, writer)
                writer.flush()
                os.fsync(writer.fileno())
        source_sha = _sha256(source_path)
        copy_sha = _sha256(destination)
        source_size = source_path.stat().st_size
        if source_sha != copy_sha or source_size != destination.stat().st_size or _file_identity(_regular_stat(source_path)) != _file_identity(before):
            raise StorageRecoveryError("Recovery copy verification failed.")
        manifest = {
            "original_path": str(source_path),
            "workspace_relative_path": relative,
            "storage_class": classification.storage_class,
            "byte_size": source_size,
            "sha256": source_sha,
            "operation_timestamp": timestamp.isoformat().replace("+00:00", "Z"),
            "app_version": APP_VERSION,
            "reason": reason,
            "copy_path": str(destination),
        }
        with manifest_path.open("x", encoding="utf-8", newline="") as writer:
            manifest_created = True
            json.dump(manifest, writer, indent=2, ensure_ascii=False)
            writer.write("\n")
            writer.flush()
            os.fsync(writer.fileno())
        fsync_parent_directory(destination)
    except Exception:
        if copy_created and destination.exists():
            destination.unlink()
        if manifest_created and manifest_path.exists():
            manifest_path.unlink()
        raise
    return {"copy_path": str(destination), "manifest_path": str(manifest_path), "manifest": manifest}


def quarantine_file(
    source: str | Path,
    *,
    workspace_root: str | Path,
    quarantine_dir: str | Path,
    storage_class: str,
    reason: str,
    rebuildable: bool,
    confirm: bool,
    now: datetime | None = None,
) -> dict[str, Any]:
    if not confirm:
        raise StorageRecoveryError("Quarantine requires explicit confirmation.")
    if not rebuildable:
        raise StorageRecoveryError("Quarantine is allowed by default only for rebuildable caches.")
    root = Path(workspace_root).resolve(strict=False)
    with _write_lock(root):
        source_path = _workspace_path(source, root)
        if not _owned_storage(source_path, root).rebuildable:
            raise StorageRecoveryError("Quarantine is allowed only for registry-defined rebuildable caches.")
        _output_directory(quarantine_dir, root)
        if not source_path.exists():
            return {"status": "already_absent", "original_path": str(source_path)}
        before = _regular_stat(source_path)
        exported = _export_recovery_copy(source_path, root=root, recovery_dir=quarantine_dir, reason=reason, now=now)
        copy_path = Path(exported["copy_path"])
        if _sha256(copy_path) != exported["manifest"]["sha256"]:
            raise StorageRecoveryError("Quarantine verification failed; the active file was preserved.")
        _workspace_path(source_path, root)
        if _file_identity(_regular_stat(source_path)) != _file_identity(before) or _sha256(source_path) != exported["manifest"]["sha256"] or source_path.stat().st_size != exported["manifest"]["byte_size"]:
            raise StorageRecoveryError("The active file changed during quarantine; it was preserved.")
        source_path.unlink()
        fsync_parent_directory(source_path)
        return {"status": "quarantined", "original_path": str(source_path), **exported}


def restore_quarantined_file(
    manifest_path: str | Path,
    *,
    workspace_root: str | Path,
    confirm: bool,
) -> dict[str, Any]:
    if not confirm:
        raise StorageRecoveryError("Restore requires explicit confirmation.")
    root = Path(workspace_root).resolve(strict=False)
    with _write_lock(root):
        return _restore_quarantined_file(manifest_path, root=root)


def _restore_quarantined_file(manifest_path: str | Path, *, root: Path) -> dict[str, Any]:
    manifest_file = _workspace_path(manifest_path, root)
    _output_directory(manifest_file.parent, root)
    try:
        if _regular_stat(manifest_file).st_size > _MAX_RECOVERY_MANIFEST_BYTES:
            raise StorageRecoveryError("Quarantine manifest exceeds its bounded read limit.")
        with _open_regular(manifest_file) as reader:
            content = reader.read(_MAX_RECOVERY_MANIFEST_BYTES + 1)
        if len(content) > _MAX_RECOVERY_MANIFEST_BYTES:
            raise StorageRecoveryError("Quarantine manifest exceeds its bounded read limit.")
        manifest = json.loads(content.decode("utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise StorageRecoveryError(f"Quarantine manifest could not be read: {exc}") from exc
    if not isinstance(manifest, dict):
        raise StorageRecoveryError("Quarantine manifest must contain a JSON object.")
    destination = Path(os.path.abspath(str(manifest.get("original_path", ""))))
    copy_path = Path(os.path.abspath(str(manifest.get("copy_path", ""))))
    if not _within(manifest_file, root) or not _within(copy_path, root) or _copy_manifest_path(copy_path) != manifest_file:
        raise StorageRecoveryError("Restore requires a matching workspace-owned quarantine copy and manifest.")
    if not _within(destination, root):
        raise StorageRecoveryError("Restore destination is outside the workspace.")
    destination = _workspace_path(destination, root)
    copy_path = _workspace_path(copy_path, root)
    if not _owned_storage(destination, root).rebuildable:
        raise StorageRecoveryError("Restore is restricted to registry-defined quarantined caches.")
    if manifest.get("workspace_relative_path") != destination.relative_to(root).as_posix():
        raise StorageRecoveryError("Quarantine manifest does not match its app-owned storage path.")
    if destination.exists() or destination.is_symlink():
        raise StorageRecoveryError("Restore conflict: the active destination already exists.")
    if not copy_path.is_file() or _sha256(copy_path) != str(manifest.get("sha256", "")):
        raise StorageRecoveryError("Quarantine bytes do not match the manifest.")
    try:
        expected_size = int(manifest.get("byte_size", -1))
    except (TypeError, ValueError) as exc:
        raise StorageRecoveryError("Quarantine manifest byte size is invalid.") from exc
    if copy_path.stat().st_size != expected_size:
        raise StorageRecoveryError("Quarantine byte size does not match the manifest.")
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary: Path | None = None
    try:
        with _open_regular(copy_path) as reader, tempfile.NamedTemporaryFile(mode="wb", prefix=f".{destination.name}.restore-", suffix=".tmp", dir=destination.parent, delete=False) as writer:
            temporary = Path(writer.name)
            shutil.copyfileobj(reader, writer)
            writer.flush()
            os.fsync(writer.fileno())
        if _sha256(temporary) != manifest["sha256"]:
            raise StorageRecoveryError("Restored temporary bytes failed verification.")
        _workspace_path(destination, root)
        try:
            # A hard-link publishes the fully verified bytes atomically and
            # refuses an intervening active file, unlike os.replace().
            os.link(temporary, destination, follow_symlinks=False)
        except FileExistsError:
            raise StorageRecoveryError("Restore conflict: the active destination already exists.") from None
        fsync_parent_directory(destination)
    finally:
        if temporary is not None and temporary.exists():
            temporary.unlink()
    return {"status": "restored", "destination_path": str(destination), "quarantine_copy_retained": True}
