from __future__ import annotations

import hashlib
import math
import unicodedata
from pathlib import Path
from typing import Any, Mapping, TypedDict

from services.library_health import cached_library_health_check
from services.managed_pdf import ManagedPdfState, resolve_indexed_pdf
from services.paper_metadata_mutation import (
    normalized_web_metadata,
    paper_lifecycle_revision,
    paper_metadata_revision,
    paper_pdf_revision,
    paper_reading_status_revision,
    paper_tags_revision,
)
from services.reading_note_template import reading_note_header_values
from storage.extracted_text_store import extracted_text_path
from storage.index_store import read_index_snapshot
from storage.paper_profile_store import paper_profile_path
from storage.paths import (
    EXTRACTED_TEXT_DIR,
    INDEX_CSV,
    NOTES_DIR,
    NOTE_BLOCKS_DIR,
    PAPERS_DIR,
    PAPER_PROFILES_DIR,
    PROJECTS_DIR,
    PROJECT_ROOT,
)
from storage.project_link_store import list_project_links


class HealthSummary(TypedDict):
    overall_state: str
    blocking_issues: int
    warning_count: int
    corrupt_critical_state_count: int
    quarantine_count: int
    missing_pdf_count: int
    duplicate_review_count: int


class LibraryStatus(TypedDict):
    active_count: int
    archived_count: int
    missing_count: int
    duplicate_count: int
    corrupt_count: int
    quarantine_count: int
    degraded: bool
    workspace_warnings: list[str]


class PaperListItem(TypedDict):
    paper_id: str
    title: str
    first_author: str
    year: str
    status: str
    priority: str
    tags: list[str]
    archived: bool
    missing_pdf: bool
    health: list[str]


class _SearchablePaperListItem(dict[str, Any]):
    """A normal public list mapping with non-serialized search context."""

    def __init__(self, payload: PaperListItem, search_text: str) -> None:
        super().__init__(payload)
        self.search_text = search_text


class PaperDetail(PaperListItem):
    authors: list[str]
    journal: str
    abstract: str
    keywords: list[str]
    arxiv_id: str
    filename: str
    relative_pdf_path: str
    doi: str
    project_links: list[dict[str, str]]
    note_available: bool
    extracted_text_available: bool
    profile_available: bool
    lifecycle_state: str
    recoverable_warnings: list[str]
    reading_status_revision: str
    pdf_revision: str
    lifecycle_revision: str


class ReaderSnapshot(TypedDict):
    paper: PaperDetail
    editable_metadata: dict[str, str]
    metadata_revision: str
    tags_revision: str
    pdf_state: str
    saved_note_available: bool
    saved_note_content: str
    canonical_note_header: dict[str, str]
    saved_note_baseline: dict[str, Any]
    warnings: list[str]
    unavailable_reason: str


def _archived(record: Mapping[str, Any]) -> bool:
    return str(record.get("is_archived", "false")).lower() == "true"


def _first_author(record: Mapping[str, Any]) -> str:
    authors = str(record.get("authors", "") or "").strip()
    return authors.split(";")[0].split(",")[0].strip() if authors else ""


def _tags(value: object) -> list[str]:
    return [item.strip() for item in str(value or "").split(",") if item.strip()]


def _metadata_text(value: object) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return str(value).strip()


def _authors(value: object) -> list[str]:
    source = value if isinstance(value, (list, tuple)) else _metadata_text(value).split(";")
    return [author for item in source if (author := _metadata_text(item))]


def _keywords(value: object) -> list[str]:
    source = value if isinstance(value, (list, tuple)) else _metadata_text(value).split(",")
    return [keyword for item in source if (keyword := _metadata_text(item))]


def _safe_pdf(record: Mapping[str, Any], root: Path, papers_dir: Path) -> tuple[Path | None, str]:
    del root
    result = resolve_indexed_pdf(record, papers_dir=Path(papers_dir))
    if result.state is ManagedPdfState.invalid or result.path is None:
        return None, ""
    resolved = result.path
    try:
        relative = resolved.relative_to(Path(papers_dir).resolve(strict=False).parent).as_posix()
    except ValueError:
        return None, ""
    return resolved, relative


def _corrupt_records(report: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return [item for item in report.get("corrupt_json", []) if isinstance(item, Mapping)]


def build_health_summary(report: Mapping[str, Any] | None = None, **health_kwargs: Any) -> HealthSummary:
    source = dict(report) if report is not None else cached_library_health_check(**health_kwargs)
    corrupt = _corrupt_records(source)
    corrupt_index = [
        item for item in source.get("corrupt_index", []) if isinstance(item, Mapping)
    ]
    critical = sum(item.get("storage_class") == "critical user state" for item in corrupt) + len(corrupt_index)
    missing = len(source.get("missing_pdfs", []))
    duplicates = len(source.get("duplicate_pdf_hashes", []))
    quarantine = len(source.get("quarantined_caches", []))
    warnings = sum(
        len(source.get(key, []))
        for key in ("duplicate_filenames", "duplicate_dois", "missing_metadata", "stale_extracted_text", "noncanonical_filepaths", "errors")
    )
    blocking = critical + missing
    has_issues = bool(source.get("healthy") is False or source.get("summary", {}).get("issue_count", 0) or corrupt or missing or duplicates or quarantine or warnings)
    return {
        "overall_state": "healthy" if not has_issues else ("blocked" if blocking else "degraded"),
        "blocking_issues": blocking,
        "warning_count": warnings,
        "corrupt_critical_state_count": critical,
        "quarantine_count": quarantine,
        "missing_pdf_count": missing,
        "duplicate_review_count": duplicates,
    }


def build_library_status(
    *,
    index_csv: Path = INDEX_CSV,
    health_report: Mapping[str, Any] | None = None,
    **health_kwargs: Any,
) -> LibraryStatus:
    dataframe = read_index_snapshot(index_csv)
    records = dataframe.to_dict("records")
    report = dict(health_report) if health_report is not None else cached_library_health_check(index_csv=index_csv, **health_kwargs)
    health = build_health_summary(report)
    archived_count = sum(_archived(record) for record in records)
    workspace_warnings: list[str] = []
    if health["missing_pdf_count"]:
        workspace_warnings.append("Some indexed PDFs are missing.")
    if health["corrupt_critical_state_count"]:
        workspace_warnings.append("Critical app-owned state requires manual recovery.")
    if health["duplicate_review_count"]:
        workspace_warnings.append("Duplicate PDF candidates require review.")
    return {
        "active_count": len(records) - archived_count,
        "archived_count": archived_count,
        "missing_count": health["missing_pdf_count"],
        "duplicate_count": health["duplicate_review_count"],
        "corrupt_count": len(_corrupt_records(report))
        + sum(isinstance(item, Mapping) for item in report.get("corrupt_index", [])),
        "quarantine_count": health["quarantine_count"],
        "degraded": health["overall_state"] != "healthy",
        "workspace_warnings": workspace_warnings,
    }


def _paper_health(paper_id: str, report: Mapping[str, Any]) -> tuple[bool, list[str]]:
    missing = any(str(item.get("paper_id", "")) == paper_id for item in report.get("missing_pdfs", []) if isinstance(item, Mapping))
    duplicate = any(
        any(str(record.get("paper_id", "")) == paper_id for record in group.get("indexed_records", []) if isinstance(record, Mapping))
        for group in report.get("duplicate_pdf_hashes", [])
        if isinstance(group, Mapping)
    )
    health: list[str] = []
    if missing:
        health.append("missing_pdf")
    if duplicate:
        health.append("duplicate_candidate")
    return missing, health


def build_paper_list_items(
    *,
    index_csv: Path = INDEX_CSV,
    health_report: Mapping[str, Any] | None = None,
    **health_kwargs: Any,
) -> list[PaperListItem]:
    report = dict(health_report) if health_report is not None else cached_library_health_check(index_csv=index_csv, **health_kwargs)
    items: list[PaperListItem] = []
    for record in read_index_snapshot(index_csv).to_dict("records"):
        paper_id = str(record.get("paper_id", ""))
        missing, health = _paper_health(paper_id, report)
        payload: PaperListItem = {
            "paper_id": paper_id,
            "title": str(record.get("title", "") or record.get("filename", "") or ""),
            "first_author": _first_author(record),
            "year": str(record.get("year", "") or ""),
            "status": str(record.get("status", "unread") or "unread"),
            "priority": str(record.get("reading_priority", "normal") or "normal"),
            "tags": _tags(record.get("tags", "")),
            "archived": _archived(record),
            "missing_pdf": missing,
            "health": health,
        }
        items.append(_SearchablePaperListItem(
            payload,
            "\n".join(
                [
                    _metadata_text(record.get("title") or record.get("filename")),
                    _metadata_text(record.get("authors")),
                    _metadata_text(record.get("journal")),
                    _metadata_text(record.get("doi")),
                    _metadata_text(record.get("tags")),
                    _metadata_text(record.get("keywords")),
                ]
            ).casefold(),
        ))
    return sorted(items, key=lambda item: (item["title"].casefold(), item["paper_id"]))


def filter_paper_list_items(
    papers: list[PaperListItem],
    *,
    q: str = "",
    tag: str = "",
    year: str = "",
    status: str = "",
) -> list[PaperListItem]:
    """Return deterministic metadata-filtered collection items.

    Filtering is deliberately performed against the complete read-model result
    before the HTTP adapter applies pagination.  Search uses only normalized
    public bibliographic fields and never consults PDFs or filesystem paths.
    """

    query_terms = unicodedata.normalize("NFKC", q).casefold().split()
    normalized_tag = tag.strip().casefold()
    normalized_year = year.strip()
    normalized_status = status.strip().casefold()
    result: list[PaperListItem] = []
    for paper in papers:
        search_text = str(getattr(paper, "search_text", "") or paper.get("_search_text", "")).casefold() or "\n".join(
            [paper["title"], paper["first_author"], *paper["tags"]]
        ).casefold()
        search_text = unicodedata.normalize("NFKC", search_text).casefold()
        if not all(term in search_text for term in query_terms):
            continue
        if normalized_tag and not any(item.casefold() == normalized_tag for item in paper["tags"]):
            continue
        if normalized_year and paper["year"] != normalized_year:
            continue
        if normalized_status and paper["status"].casefold() != normalized_status:
            continue
        result.append(paper)
    return result


def build_paper_detail(
    paper_id: str,
    *,
    index_csv: Path = INDEX_CSV,
    workspace_root: Path = PROJECT_ROOT,
    papers_dir: Path = PAPERS_DIR,
    notes_dir: Path = NOTES_DIR,
    extracted_text_dir: Path = EXTRACTED_TEXT_DIR,
    profile_dir: Path = PAPER_PROFILES_DIR,
    projects_dir: Path = PROJECTS_DIR,
    health_report: Mapping[str, Any] | None = None,
    **health_kwargs: Any,
) -> PaperDetail | None:
    dataframe = read_index_snapshot(index_csv)
    matches = dataframe[dataframe["paper_id"] == paper_id]
    if matches.empty:
        return None
    record = matches.iloc[0].to_dict()
    report = dict(health_report) if health_report is not None else cached_library_health_check(index_csv=index_csv, papers_dir=papers_dir, notes_dir=notes_dir, projects_dir=projects_dir, extracted_text_dir=extracted_text_dir, **health_kwargs)
    return _build_paper_detail_from_record(
        record,
        report=report,
        workspace_root=Path(workspace_root),
        papers_dir=Path(papers_dir),
        notes_dir=Path(notes_dir),
        extracted_text_dir=Path(extracted_text_dir),
        profile_dir=Path(profile_dir),
        projects_dir=Path(projects_dir),
    )


def _build_paper_detail_from_record(
    record: Mapping[str, Any],
    *,
    report: Mapping[str, Any],
    workspace_root: Path,
    papers_dir: Path,
    notes_dir: Path,
    extracted_text_dir: Path,
    profile_dir: Path,
    projects_dir: Path,
) -> PaperDetail:
    paper_id = str(record.get("paper_id", ""))
    missing, health = _paper_health(paper_id, report)
    pdf_path, relative_pdf_path = _safe_pdf(record, workspace_root, papers_dir)
    note_path = notes_dir / f"{paper_id}.md"
    try:
        links = list_project_links(projects_dir)
    except Exception:
        links = []
        health = [*health, "project_links_unavailable"]
    public_links = [
        {"project_id": str(link.get("project_id", "")), "link_type": str(link.get("link_type", "")), "target_type": str(link.get("target_type", ""))}
        for link in links
        if str(link.get("paper_id", "")) == paper_id
    ]
    base: PaperListItem = {
        "paper_id": paper_id,
        "title": str(record.get("title", "") or record.get("filename", "") or ""),
        "first_author": _first_author(record),
        "year": str(record.get("year", "") or ""),
        "status": str(record.get("status", "unread") or "unread"),
        "priority": str(record.get("reading_priority", "normal") or "normal"),
        "tags": _tags(record.get("tags", "")),
        "archived": _archived(record),
        "missing_pdf": missing or pdf_path is None or not pdf_path.is_file(),
        "health": health,
    }
    return {
        **base,
        "authors": _authors(record.get("authors")),
        "journal": _metadata_text(record.get("journal")),
        "abstract": _metadata_text(record.get("abstract")),
        "keywords": _keywords(record.get("keywords")),
        "arxiv_id": reading_note_header_values(record)["arxiv_id"],
        "filename": str(record.get("filename", "") or ""),
        "relative_pdf_path": relative_pdf_path,
        "doi": str(record.get("doi", "") or ""),
        "project_links": public_links,
        "note_available": note_path.is_file(),
        "extracted_text_available": extracted_text_path(paper_id, extracted_text_dir).is_file(),
        "profile_available": paper_profile_path(paper_id, profile_dir).is_file(),
        "lifecycle_state": "archived" if _archived(record) else "active",
        "recoverable_warnings": list(health),
        "reading_status_revision": paper_reading_status_revision(record),
        "pdf_revision": paper_pdf_revision(record),
        "lifecycle_revision": paper_lifecycle_revision(record),
    }


def build_reader_snapshot(
    paper_id: str,
    *,
    index_csv: Path = INDEX_CSV,
    notes_dir: Path = NOTES_DIR,
    **detail_kwargs: Any,
) -> ReaderSnapshot | None:
    dataframe = read_index_snapshot(index_csv)
    matches = dataframe[dataframe["paper_id"] == paper_id]
    if matches.empty:
        return None
    record = matches.iloc[0].to_dict()
    workspace_root = Path(detail_kwargs.pop("workspace_root", PROJECT_ROOT))
    papers_dir = Path(detail_kwargs.pop("papers_dir", PAPERS_DIR))
    extracted_text_dir = Path(detail_kwargs.pop("extracted_text_dir", EXTRACTED_TEXT_DIR))
    profile_dir = Path(detail_kwargs.pop("profile_dir", PAPER_PROFILES_DIR))
    projects_dir = Path(detail_kwargs.pop("projects_dir", PROJECTS_DIR))
    health_report = detail_kwargs.pop("health_report", None)
    report = (
        dict(health_report)
        if health_report is not None
        else cached_library_health_check(
            index_csv=index_csv,
            papers_dir=papers_dir,
            notes_dir=notes_dir,
            projects_dir=projects_dir,
            extracted_text_dir=extracted_text_dir,
            **detail_kwargs,
        )
    )
    detail = _build_paper_detail_from_record(
        record,
        report=report,
        workspace_root=workspace_root,
        papers_dir=papers_dir,
        notes_dir=Path(notes_dir),
        extracted_text_dir=extracted_text_dir,
        profile_dir=profile_dir,
        projects_dir=projects_dir,
    )
    note_path = Path(notes_dir) / f"{paper_id}.md"
    note_read_warning = ""
    note_exists = note_path.is_file()
    if note_exists:
        try:
            saved_note = note_path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            saved_note = ""
            note_read_warning = "saved_note_unavailable"
    else:
        saved_note = ""
    baseline = {
        "exists": note_exists,
        "sha256": hashlib.sha256(saved_note.encode("utf-8")).hexdigest(),
        "size_bytes": len(saved_note.encode("utf-8")),
    }
    warnings = list(detail["recoverable_warnings"])
    if note_read_warning:
        warnings.append(note_read_warning)
    unavailable_reason = "PDF file is missing." if detail["missing_pdf"] else ""
    return {
        "paper": detail,
        "editable_metadata": normalized_web_metadata(record),
        "metadata_revision": paper_metadata_revision(record),
        "tags_revision": paper_tags_revision(record),
        "pdf_state": "missing" if detail["missing_pdf"] else "available",
        "saved_note_available": note_exists and not bool(note_read_warning),
        "saved_note_content": saved_note,
        "canonical_note_header": reading_note_header_values(record),
        "saved_note_baseline": baseline,
        "warnings": warnings,
        "unavailable_reason": unavailable_reason,
    }


def paper_lifecycle_summary(record: Mapping[str, Any], *, pdf_exists: bool) -> dict[str, Any]:
    archived = _archived(record)
    return {"paper_id": str(record.get("paper_id", "")), "lifecycle_state": "archived" if archived else "active", "is_archived": archived, "archived_at": str(record.get("archived_at", "")), "pdf_state": "available" if pdf_exists else "missing", "readable": bool(pdf_exists)}


def library_health_summary(report: Mapping[str, Any]) -> dict[str, Any]:
    summary = build_health_summary(report)
    return {"duplicate_candidate_count": summary["duplicate_review_count"], "ignored_duplicate_count": len(report.get("ignored_duplicates", [])), "corrupt_critical_state_count": summary["corrupt_critical_state_count"], "corrupt_rebuildable_cache_count": sum(item.get("storage_class") == "rebuildable cache" for item in _corrupt_records(report)), "quarantined_cache_count": summary["quarantine_count"], "library_state": "healthy" if summary["overall_state"] == "healthy" else "degraded but readable"}
