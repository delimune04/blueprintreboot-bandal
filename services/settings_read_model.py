from __future__ import annotations

import csv
import hashlib
import json
import os
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Literal, Mapping, NotRequired, TypedDict
from zipfile import BadZipFile, ZipFile

from config.contact import APP_VERSION
from services.backup_snapshot import verify_backup_snapshot
from services.tag_book import (
    DEFAULT_TAG_BOOK_DIR,
    LEGACY_CANONICAL_TAG_PATH,
    LEGACY_RULE_PATH,
)
from services.managed_pdf import resolve_indexed_pdf
from storage.paths import (
    EXPORTS_DIR,
    INDEX_CSV,
    NOTES_DIR,
    NOTE_BLOCKS_DIR,
    PAPERS_DIR,
    PROJECTS_DIR,
)
from storage.identities import is_safe_paper_id
from storage.persistent_state import (
    BACKUP_FILE_PATHS,
    PERSISTENT_JSON_STORES,
    json_shape_error,
    note_block_shape_error,
)


SettingsState = Literal["healthy", "warning", "unavailable", "empty"]
ProbeState = Literal["available", "missing", "corrupt", "unavailable"]
BackupEvidenceState = Literal["absent", "invalid", "stale", "verified_full", "verified_light", "unavailable"]

MAX_DISCOVERED_ENTRIES = 10_000
MAX_INDEX_BYTES = 32 * 1024 * 1024
MAX_INDEX_ROWS = 50_000
MAX_JSON_BYTES = 8 * 1024 * 1024
MAX_TOTAL_JSON_BYTES = 64 * 1024 * 1024
MAX_SETTINGS_BACKUP_BYTES = 64 * 1024 * 1024
MAX_SETTINGS_BACKUP_MEMBER_BYTES = 32 * 1024 * 1024
MAX_SETTINGS_BACKUP_MEMBERS = 10_000
BACKUP_STALE_AFTER = timedelta(days=7)

WORKSPACE_RESOURCE_CODES = (
    "papers",
    "notes",
    "projects",
    "tags",
    "note_blocks",
    "project_links",
    "tag_candidate_reviews",
)
INTEGRITY_ISSUE_CODES = (
    "missing_pdfs",
    "unindexed_pdfs",
    "orphan_notes",
    "orphan_note_blocks",
    "orphan_project_links",
    "corrupt_json",
    "corrupt_index",
)


class SettingsAggregate(TypedDict):
    state: SettingsState
    count: int | None


class SettingsApplication(TypedDict):
    product_version: str
    api_state: Literal["available"]


class SettingsBackupReadiness(TypedDict):
    state: Literal["healthy", "warning", "unavailable"]
    snapshot_available: bool | None
    last_updated_at: str | None
    evidence_state: NotRequired[BackupEvidenceState]
    snapshot_type: NotRequired[Literal["full", "light"] | None]


class SettingsSummary(TypedDict):
    application: SettingsApplication
    workspace: dict[str, SettingsAggregate]
    data_integrity: dict[str, SettingsAggregate]
    backup_readiness: SettingsBackupReadiness


@dataclass(frozen=True)
class _Result:
    available: bool
    value: Any = None


@dataclass(frozen=True)
class _JsonProbe:
    state: ProbeState
    value: Any = None


@dataclass
class _ReadBudget:
    remaining_bytes: int

    def reserve(self, byte_count: int) -> None:
        if byte_count < 0 or byte_count > self.remaining_bytes:
            raise RuntimeError("The bounded Settings read budget was exceeded.")
        self.remaining_bytes -= byte_count


def _safe_call(loader) -> _Result:
    try:
        return _Result(True, loader())
    except Exception:
        return _Result(False)


def _bounded_files(
    directory: Path,
    *,
    suffix: str,
    recursive: bool,
) -> list[Path]:
    root = Path(directory)
    if not root.exists():
        return []
    if not root.is_dir():
        raise OSError("Expected an app-owned directory.")

    matches: list[Path] = []
    pending = [root]
    discovered = 0
    while pending:
        current = pending.pop()
        with os.scandir(current) as entries:
            for entry in entries:
                discovered += 1
                if discovered > MAX_DISCOVERED_ENTRIES:
                    raise RuntimeError("The bounded Settings scan limit was exceeded.")
                if entry.is_symlink():
                    continue
                if recursive and entry.is_dir(follow_symlinks=False):
                    pending.append(Path(entry.path))
                elif entry.is_file(follow_symlinks=False) and entry.name.lower().endswith(suffix):
                    matches.append(Path(entry.path))
    return sorted(matches, key=lambda path: path.as_posix().casefold())


def _read_limited_bytes(
    path: Path,
    maximum: int,
    *,
    budget: _ReadBudget | None = None,
) -> bytes:
    size = path.stat().st_size
    if size > maximum:
        raise RuntimeError("The bounded Settings read limit was exceeded.")
    if budget is not None:
        budget.reserve(size)
    with path.open("rb") as source:
        content = source.read(maximum + 1)
    if len(content) > maximum:
        raise RuntimeError("The bounded Settings read limit was exceeded.")
    return content


def _probe_json(path: Path, *, budget: _ReadBudget) -> _JsonProbe:
    target = Path(path)
    if not target.exists():
        return _JsonProbe("missing")
    if not target.is_file():
        return _JsonProbe("unavailable")
    try:
        content = _read_limited_bytes(
            target,
            MAX_JSON_BYTES,
            budget=budget,
        )
        value = json.loads(content.decode("utf-8-sig"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return _JsonProbe("corrupt")
    except Exception:
        return _JsonProbe("unavailable")
    return _JsonProbe("available", value)


def _read_index_records(path: Path) -> list[dict[str, str]]:
    target = Path(path)
    if not target.exists():
        return []
    if not target.is_file():
        raise OSError("The paper index is unavailable.")
    content = _read_limited_bytes(target, MAX_INDEX_BYTES)
    text = content.decode("utf-8-sig")
    reader = csv.DictReader(text.splitlines())
    if reader.fieldnames is None:
        return []
    required_columns = {"paper_id", "filename", "filepath"}
    if not required_columns <= set(reader.fieldnames):
        raise ValueError("The paper index contract is unavailable.")
    records: list[dict[str, str]] = []
    for row in reader:
        if len(records) >= MAX_INDEX_ROWS:
            raise RuntimeError("The bounded Settings row limit was exceeded.")
        records.append({str(key): str(value or "") for key, value in row.items() if key is not None})
    paper_ids = [record.get("paper_id", "") for record in records]
    if any(not is_safe_paper_id(paper_id) for paper_id in paper_ids):
        raise ValueError("The paper index contains an invalid paper_id.")
    if len(paper_ids) != len(set(paper_ids)):
        raise ValueError("The paper index contains duplicate paper_id values.")
    if any(not record.get("filename", "").strip() and not record.get("filepath", "").strip() for record in records):
        raise ValueError("The paper index contains an unusable PDF identity.")
    return records


def _path_key(path: Path) -> str:
    return os.path.normcase(str(Path(path).resolve(strict=False)))


def _indexed_pdf_path(
    record: Mapping[str, str],
    *,
    index_csv: Path,
    papers_dir: Path,
) -> Path | None:
    del index_csv
    return resolve_indexed_pdf(record, papers_dir=Path(papers_dir)).path


def _aggregate(count: int | None, *, warning: bool = False) -> SettingsAggregate:
    if count is None:
        return {"state": "unavailable", "count": None}
    if warning:
        return {"state": "warning", "count": count}
    return {"state": "empty" if count == 0 else "healthy", "count": count}


def _issue(count: int | None) -> SettingsAggregate:
    if count is None:
        return {"state": "unavailable", "count": None}
    return {"state": "warning" if count else "healthy", "count": count}


def _backup_evidence(state: BackupEvidenceState, *, snapshot_type: Literal["full", "light"] | None = None, timestamp: str | None = None) -> SettingsBackupReadiness:
    verified = state in {"stale", "verified_full", "verified_light"}
    return {
        "state": "unavailable" if state == "unavailable" else "healthy" if state == "verified_full" else "warning",
        "snapshot_available": None if state == "unavailable" else verified,
        "last_updated_at": timestamp if verified else None,
        "evidence_state": state,
        "snapshot_type": snapshot_type if verified else None,
    }


def _backup_live_files(root: Path) -> dict[str, Path]:
    paths = [root / value for value in (*BACKUP_FILE_PATHS, "data/paper_index.csv", ".streamlit/config.toml")]
    for directory in ("notes", "data/projects", "data/note_blocks"):
        paths.extend(_bounded_files(root / directory, suffix="", recursive=True))
    owned: dict[str, Path] = {}
    for path in paths:
        if path.is_symlink():
            continue
        if not path.is_file() or path.name in {".gitkeep", "secrets.toml"} or path.suffix.casefold() in {".tmp", ".log"}:
            continue
        if any(part.startswith(".") and part not in {".streamlit"} for part in path.relative_to(root).parts):
            continue
        try:
            path.resolve(strict=False).relative_to(root.resolve(strict=False))
        except ValueError:
            raise OSError("Backup source ownership is unavailable.") from None
        owned[path.relative_to(root).as_posix()] = path
    return owned


def _backup_matches_live_state(manifest: Mapping[str, Any], root: Path) -> bool:
    archived = {
        entry["path"]: entry for entry in manifest["included_files"]
        if not entry["path"].startswith("papers/")
    }
    current = _backup_live_files(root)
    if set(current) != set(archived):
        return False
    budget = _ReadBudget(MAX_SETTINGS_BACKUP_BYTES)
    for relative_path, path in current.items():
        before = path.stat()
        expected = archived[relative_path]
        if before.st_size != expected["size_bytes"]:
            return False
        budget.reserve(before.st_size)
        if before.st_size > MAX_SETTINGS_BACKUP_MEMBER_BYTES:
            raise RuntimeError("Backup state exceeds the bounded Settings read limit.")
        digest = hashlib.sha256()
        with path.open("rb") as source:
            remaining = before.st_size
            while remaining:
                chunk = source.read(min(1024 * 1024, remaining))
                if not chunk:
                    raise OSError("Backup source changed during the read.")
                digest.update(chunk)
                remaining -= len(chunk)
            if source.read(1):
                raise OSError("Backup source changed during the read.")
        after = path.stat()
        if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
            raise OSError("Backup source changed during the read.")
        if digest.hexdigest() != expected["sha256"].casefold():
            return False
    return True


def _backup_matches_live_pdf_inventory(manifest: Mapping[str, Any], root: Path, timestamp: datetime) -> bool:
    """Check full-snapshot PDF coverage without opening current PDF contents."""
    archived = {entry["path"]: entry for entry in manifest["included_files"] if entry["path"].startswith("papers/")}
    current = {path.relative_to(root).as_posix(): path for path in _bounded_files(root / "papers", suffix=".pdf", recursive=True)}
    if set(current) != set(archived):
        return False
    for relative_path, path in current.items():
        info = path.stat()
        # Snapshot timestamps use whole seconds; accept the creation second.
        if info.st_size != archived[relative_path]["size_bytes"] or info.st_mtime >= timestamp.timestamp() + 1:
            return False
    return True


def _snapshot_readiness(exports_dir: Path, *, workspace_root: Path | None = None, now: datetime | None = None) -> SettingsBackupReadiness:
    snapshot_result = _safe_call(
        lambda: [
            path
            for path in _bounded_files(
                Path(exports_dir),
                suffix=".zip",
                recursive=False,
            )
            if path.name.startswith("blueprint_snapshot_")
        ]
    )
    if not snapshot_result.available:
        return _backup_evidence("unavailable")
    snapshots = list(snapshot_result.value)
    if not snapshots:
        return _backup_evidence("absent")
    try:
        latest = max(snapshots, key=lambda path: (path.stat().st_mtime_ns, path.name))
        before = latest.stat()
        if before.st_size > MAX_SETTINGS_BACKUP_BYTES:
            return _backup_evidence("unavailable")
        with ZipFile(latest, "r") as archive:
            members = archive.infolist()
            if len(members) > MAX_SETTINGS_BACKUP_MEMBERS or sum(member.file_size for member in members) > MAX_SETTINGS_BACKUP_BYTES or any(member.file_size > MAX_SETTINGS_BACKUP_MEMBER_BYTES for member in members):
                return _backup_evidence("unavailable")
        verified = verify_backup_snapshot(latest)
        after = latest.stat()
        if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
            return _backup_evidence("unavailable")
        if not verified.get("valid") or not isinstance(verified.get("manifest"), Mapping):
            return _backup_evidence("invalid")
        manifest = verified["manifest"]
        created_at = manifest.get("created_at")
        if not isinstance(created_at, str) or len(created_at) > 40:
            return _backup_evidence("invalid")
        timestamp = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
        if timestamp.tzinfo is None:
            return _backup_evidence("invalid")
        current_time = now or datetime.now(timezone.utc)
        if current_time.tzinfo is None:
            current_time = current_time.replace(tzinfo=timezone.utc)
        timestamp = timestamp.astimezone(timezone.utc).replace(microsecond=0)
        if timestamp > current_time + timedelta(minutes=1):
            return _backup_evidence("invalid")
        last_updated_at = timestamp.isoformat().replace("+00:00", "Z")
        snapshot_type: Literal["full", "light"] = manifest["snapshot_type"]
        root = Path(workspace_root) if workspace_root is not None else Path(exports_dir).parent
        stale = current_time - timestamp > BACKUP_STALE_AFTER or not _backup_matches_live_state(manifest, root)
        if not stale and snapshot_type == "full":
            stale = not _backup_matches_live_pdf_inventory(manifest, root, timestamp)
        evidence_state: BackupEvidenceState = "stale" if stale else "verified_full" if snapshot_type == "full" else "verified_light"
        return _backup_evidence(evidence_state, snapshot_type=snapshot_type, timestamp=last_updated_at)
    except (BadZipFile, ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return _backup_evidence("invalid")
    except Exception:
        return _backup_evidence("unavailable")


def build_settings_summary(
    *,
    index_csv: Path = INDEX_CSV,
    papers_dir: Path = PAPERS_DIR,
    notes_dir: Path = NOTES_DIR,
    note_blocks_dir: Path = NOTE_BLOCKS_DIR,
    projects_dir: Path = PROJECTS_DIR,
    tag_book_dir: Path = DEFAULT_TAG_BOOK_DIR,
    legacy_rule_path: Path = LEGACY_RULE_PATH,
    legacy_canonical_tag_path: Path = LEGACY_CANONICAL_TAG_PATH,
    exports_dir: Path = EXPORTS_DIR,
    review_store_path: Path | None = None,
    app_version: str = APP_VERSION,
) -> SettingsSummary:
    """Build a bounded, deterministic Settings summary without mutating workspace state."""

    version = str(app_version).strip()
    if not version:
        raise ValueError("A canonical application version is required.")

    index_csv = Path(index_csv)
    papers_dir = Path(papers_dir)
    notes_dir = Path(notes_dir)
    note_blocks_dir = Path(note_blocks_dir)
    projects_dir = Path(projects_dir)
    tag_book_dir = Path(tag_book_dir)
    legacy_rule_path = Path(legacy_rule_path)
    legacy_canonical_tag_path = Path(legacy_canonical_tag_path)
    review_store_path = Path(review_store_path) if review_store_path is not None else index_csv.parent / "tag_candidate_reviews.json"

    index_corrupt = False
    try:
        paper_records = _read_index_records(index_csv)
        index_result = _Result(True, paper_records)
    except (ValueError, UnicodeDecodeError, csv.Error):
        index_result = _Result(False)
        paper_records = []
        index_corrupt = True
    except Exception:
        index_result = _Result(False)
        paper_records = []
    paper_ids = {
        str(record.get("paper_id", "")).strip()
        for record in paper_records
        if str(record.get("paper_id", "")).strip()
    }

    pdf_result = _safe_call(
        lambda: _bounded_files(papers_dir, suffix=".pdf", recursive=True)
    )
    note_result = _safe_call(
        lambda: _bounded_files(notes_dir, suffix=".md", recursive=False)
    )
    note_block_file_result = _safe_call(
        lambda: _bounded_files(note_blocks_dir, suffix=".json", recursive=False)
    )
    tag_config_file_result = _safe_call(
        lambda: _bounded_files(tag_book_dir, suffix=".json", recursive=False)
    )

    workspace_root = index_csv.parent.parent
    fixed_json_paths = [
        workspace_root / definition.relative_path
        for definition in PERSISTENT_JSON_STORES
    ]
    fixed_json_paths.extend([legacy_rule_path, legacy_canonical_tag_path, review_store_path])
    discovered_json_paths = [
        *(list(note_block_file_result.value) if note_block_file_result.available else []),
        *(list(tag_config_file_result.value) if tag_config_file_result.available else []),
    ]
    json_paths = {
        _path_key(path): path
        for path in [*fixed_json_paths, *discovered_json_paths]
    }
    json_budget = _ReadBudget(MAX_TOTAL_JSON_BYTES)
    probes = {
        key: _probe_json(path, budget=json_budget)
        for key, path in json_paths.items()
    }
    shape_corrupt: set[str] = set()
    definitions = {
        _path_key(workspace_root / definition.relative_path): definition
        for definition in PERSISTENT_JSON_STORES
    }
    for key, value_probe in probes.items():
        definition = definitions.get(key)
        if definition is not None and value_probe.state == "available":
            if json_shape_error(definition, value_probe.value):
                shape_corrupt.add(key)
        elif value_probe.state == "available" and Path(json_paths[key]).parent.name == "note_blocks":
            path = Path(json_paths[key])
            if note_block_shape_error(value_probe.value, paper_id=path.stem):
                shape_corrupt.add(key)

    def probe(path: Path) -> _JsonProbe:
        key = _path_key(path)
        if key not in probes:
            probes[key] = _probe_json(path, budget=json_budget)
        return probes[key]

    def list_store(path: Path) -> _Result:
        value_probe = probe(path)
        if value_probe.state == "missing":
            return _Result(True, [])
        if value_probe.state != "available":
            return _Result(False)
        if not isinstance(value_probe.value, list) or any(
            not isinstance(item, Mapping) for item in value_probe.value
        ):
            shape_corrupt.add(_path_key(path))
            return _Result(False)
        return _Result(True, list(value_probe.value))

    projects_result = list_store(projects_dir / "projects.json")
    project_links_result = list_store(projects_dir / "project_links.json")

    review_probe = probe(review_store_path)
    if review_probe.state == "missing":
        candidate_reviews_result = _Result(True, 0)
    elif review_probe.state == "available" and _path_key(review_store_path) not in shape_corrupt:
        papers = review_probe.value.get("papers", {})
        candidate_reviews_result = _Result(
            True,
            sum(len(context.get("candidates", [])) for context in papers.values()),
        )
    else:
        candidate_reviews_result = _Result(False)

    tag_book_path = tag_book_dir / "tag_book.json"
    tag_probe = probe(tag_book_path)
    if tag_probe.state == "missing":
        legacy_probe = probe(legacy_canonical_tag_path)
        if legacy_probe.state == "missing":
            tags_result = _Result(True, 0)
        elif legacy_probe.state == "available" and isinstance(
            legacy_probe.value, (list, Mapping)
        ):
            tags_result = _Result(True, len(legacy_probe.value))
        else:
            if legacy_probe.state == "available":
                shape_corrupt.add(_path_key(legacy_canonical_tag_path))
            tags_result = _Result(False)
    elif tag_probe.state == "available" and isinstance(tag_probe.value, Mapping):
        raw_tags = tag_probe.value.get("tags", tag_probe.value)
        if isinstance(raw_tags, (list, Mapping)):
            tags_result = _Result(True, len(raw_tags))
        else:
            shape_corrupt.add(_path_key(tag_book_path))
            tags_result = _Result(False)
    else:
        if tag_probe.state == "available":
            shape_corrupt.add(_path_key(tag_book_path))
        tags_result = _Result(False)

    note_blocks_available = note_block_file_result.available
    note_block_count = 0
    note_block_ids_by_paper: dict[str, set[str]] = {}
    orphan_note_block_count = 0
    if note_blocks_available:
        for path in list(note_block_file_result.value):
            block_result = list_store(path)
            if not block_result.available:
                note_blocks_available = False
                continue
            blocks = list(block_result.value)
            note_block_count += len(blocks)
            paper_id = path.stem
            note_block_ids_by_paper.setdefault(paper_id, set()).update(
                str(block.get("id", "")).strip()
                for block in blocks
                if str(block.get("id", "")).strip()
            )
            if index_result.available and paper_id not in paper_ids:
                orphan_note_block_count += 1

    missing_pdf_count: int | None = None
    if index_result.available:
        missing_pdf_count = 0
        for record in paper_records:
            candidate = _indexed_pdf_path(
                record,
                index_csv=index_csv,
                papers_dir=papers_dir,
            )
            if candidate is None or not candidate.is_file():
                missing_pdf_count += 1

    unindexed_pdf_count: int | None = None
    if index_result.available and pdf_result.available:
        indexed_paths = {
            _path_key(candidate)
            for record in paper_records
            if (
                candidate := _indexed_pdf_path(
                    record,
                    index_csv=index_csv,
                    papers_dir=papers_dir,
                )
            )
            is not None
        }
        unindexed_pdf_count = sum(
            _path_key(path) not in indexed_paths for path in list(pdf_result.value)
        )

    orphan_note_count: int | None = None
    if index_result.available and note_result.available:
        orphan_note_count = sum(
            path.stem not in paper_ids for path in list(note_result.value)
        )

    orphan_project_link_count: int | None = None
    if (
        index_result.available
        and projects_result.available
        and project_links_result.available
        and note_blocks_available
    ):
        project_ids = {
            str(project.get("id", "")).strip()
            for project in list(projects_result.value)
            if str(project.get("id", "")).strip()
        }

        def orphaned(link: Mapping[str, Any]) -> bool:
            project_id = str(link.get("project_id", "")).strip()
            paper_id = str(link.get("paper_id", "")).strip()
            target_type = str(link.get("target_type", "")).strip()
            target_id = str(link.get("target_id", "")).strip()
            if project_id not in project_ids:
                return True
            if target_type == "paper":
                return target_id not in paper_ids
            if not paper_id or paper_id not in paper_ids:
                return True
            if target_type == "note_block":
                return target_id not in note_block_ids_by_paper.get(paper_id, set())
            return target_type not in {"paper", "note_block"}

        orphan_project_link_count = sum(
            orphaned(link) for link in list(project_links_result.value)
        )

    json_scan_available = (
        note_block_file_result.available
        and tag_config_file_result.available
        and all(item.state != "unavailable" for item in probes.values())
    )
    corrupt_json_count = (
        len(
            {
                key
                for key, item in probes.items()
                if item.state == "corrupt"
            }
            | shape_corrupt
        )
        if json_scan_available
        else None
    )

    integrity: dict[str, SettingsAggregate] = {
        "missing_pdfs": _issue(missing_pdf_count),
        "unindexed_pdfs": _issue(unindexed_pdf_count),
        "orphan_notes": _issue(orphan_note_count),
        "orphan_note_blocks": _issue(
            orphan_note_block_count
            if index_result.available and note_blocks_available
            else None
        ),
        "orphan_project_links": _issue(orphan_project_link_count),
        "corrupt_json": _issue(corrupt_json_count),
        "corrupt_index": _issue(1 if index_corrupt else (0 if index_result.available else None)),
    }

    def has_issue(code: str) -> bool:
        aggregate = integrity[code]
        return aggregate["count"] is not None and aggregate["count"] > 0

    workspace: dict[str, SettingsAggregate] = {
        "papers": _aggregate(
            len(paper_records) if index_result.available else None,
            warning=has_issue("missing_pdfs") or has_issue("unindexed_pdfs"),
        ),
        "notes": _aggregate(
            len(list(note_result.value)) if note_result.available else None,
            warning=has_issue("orphan_notes"),
        ),
        "projects": _aggregate(
            len(list(projects_result.value)) if projects_result.available else None,
            warning=has_issue("orphan_project_links"),
        ),
        "tags": _aggregate(
            int(tags_result.value) if tags_result.available else None,
        ),
        "note_blocks": _aggregate(
            note_block_count if note_blocks_available else None,
            warning=has_issue("orphan_note_blocks"),
        ),
        "project_links": _aggregate(
            len(list(project_links_result.value))
            if project_links_result.available
            else None,
            warning=has_issue("orphan_project_links"),
        ),
        "tag_candidate_reviews": _aggregate(
            int(candidate_reviews_result.value)
            if candidate_reviews_result.available
            else None,
            warning=_path_key(review_store_path) in shape_corrupt,
        ),
    }

    return {
        "application": {
            "product_version": version,
            "api_state": "available",
        },
        "workspace": workspace,
        "data_integrity": integrity,
        "backup_readiness": _snapshot_readiness(exports_dir, workspace_root=workspace_root),
    }
