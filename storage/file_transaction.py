"""Rollback a bounded group of app-owned files inside a workspace write lock.

Callers hold the established workspace lock and validate their domain inputs.
Snapshots are bytes, preserving existing contents exactly on command failure.
"""
from __future__ import annotations

import os
import tempfile
from contextlib import contextmanager
from pathlib import Path
from collections.abc import Iterable


def _restore_bytes(path: Path, content: bytes | None) -> None:
    if content is None:
        path.unlink(missing_ok=True)
        return
    if path.is_file() and path.read_bytes() == content:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{path.name}.rollback-", dir=path.parent)
    temporary = Path(temporary_name)
    try:
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def file_transaction(paths: Iterable[Path]):
    snapshots = {
        Path(path): Path(path).read_bytes() if Path(path).exists() else None
        for path in paths
    }
    try:
        yield
    except BaseException as failure:
        errors = []
        for path, content in snapshots.items():
            try:
                _restore_bytes(path, content)
            except OSError as error:
                errors.append(error)
        if errors:
            raise RuntimeError("The command failed and its rollback could not be completed; preserve the workspace and recover from backup.") from failure
        raise
