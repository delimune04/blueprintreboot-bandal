from __future__ import annotations

import hashlib
import math
import re
from collections.abc import Mapping
from datetime import datetime
from pathlib import PurePosixPath, PureWindowsPath
from typing import Any

from api.schemas import (
    CandidateQualityCounts,
    CandidateSummaryResponse,
    TagCandidateReviewQueueItem,
    CanonicalTag,
    EditablePaperMetadata,
    FullTextDocumentResponse,
    FullTextStatusResponse,
    LinkedNoteBlockSummary,
    LinkedPaperSummary,
    NoteBlockCollectionResponse,
    NoteBlockCommandResponse,
    NoteBlockItem,
    NoteBlockLinkCommandResponse,
    NoteBlockLinkCommandState,
    NoteBlockProjectLink,
    NoteBlockSourcePaper,
    PaperDetail,
    PaperLinkCommandResponse,
    PaperLinkCommandState,
    PaperListItem,
    ProjectCommandResponse,
    ProjectCommandState,
    ProjectDetail,
    ProjectLink,
    ProjectLinkTarget,
    ProjectListItem,
    ProjectTargetState,
    ReaderNoteBaseline,
    ReaderNoteHeader,
    ReaderPdfState,
    ReaderSnapshotResponse,
    SettingsApplicationSection,
    SettingsBackupReadinessSection,
    SettingsDataIntegritySection,
    SettingsIntegrityIssue,
    SettingsSummaryResponse,
    SettingsWorkspaceResource,
    SettingsWorkspaceSection,
)
from services.project_commands import (
    NoteBlockLinkCommandResult as DomainNoteBlockLinkCommandResult,
    PaperLinkCommandResult as DomainPaperLinkCommandResult,
    ProjectCommandResult as DomainProjectCommandResult,
)
from services.note_block_commands import NoteBlockCommandResult as DomainNoteBlockCommandResult
from services.full_text_workflow import FullTextDocument as DomainFullTextDocument, FullTextStatus as DomainFullTextStatus


class PaperContractError(ValueError):
    """A domain value cannot be represented by the public Paper API contract."""


class ProjectContractError(ValueError):
    """A domain value cannot be represented by the public Project API contract."""


class NoteBlockContractError(ValueError):
    """A domain value cannot be represented by the public Note Block API contract."""


class TagContractError(ValueError):
    """A domain value cannot be represented by the public Tag API contract."""


class SettingsContractError(ValueError):
    """A domain value cannot be represented by the public Settings API contract."""


class FullTextContractError(ValueError):
    """A domain value cannot be represented by the public full-text API contract."""


_SETTINGS_RESOURCE_METADATA = {
    "papers": ("Papers", "indexed papers"),
    "notes": ("Notes", "Reading Notes"),
    "projects": ("Projects", "Projects"),
    "tags": ("Tags", "canonical Tags"),
    "note_blocks": ("Note blocks", "note blocks"),
    "project_links": ("Project links", "Project links"),
    "tag_candidate_reviews": ("Tag candidate reviews", "tag candidate review items"),
}
_SETTINGS_ISSUE_GUIDANCE = {
    "missing_pdfs": {
        "severity": "warning",
        "explanation": "Indexed paper records whose managed PDF was not found.",
        "next_action": "Run the Streamlit Library Health Check before reconnecting or removing any record.",
    },
    "unindexed_pdfs": {
        "severity": "warning",
        "explanation": "Managed PDFs that do not have a paper-index record.",
        "next_action": "Use the existing Streamlit scan workflow to review unindexed PDFs.",
    },
    "orphan_notes": {
        "severity": "warning",
        "explanation": "Reading Note files without a matching paper identity.",
        "next_action": "Review and preserve orphan notes in the Streamlit health workflow.",
    },
    "orphan_note_blocks": {
        "severity": "warning",
        "explanation": "Note-block files without a matching paper identity.",
        "next_action": "Review and preserve orphan note blocks in the Streamlit health workflow.",
    },
    "orphan_project_links": {
        "severity": "warning",
        "explanation": "Project links whose stored Project, paper, or note-block target is missing.",
        "next_action": "Review orphan Project links in Streamlit before unlinking or reattaching anything.",
    },
    "corrupt_json": {
        "severity": "error",
        "explanation": "App-owned JSON stores that are invalid or have an unsupported top-level shape.",
        "next_action": "Do not overwrite affected state; use the Streamlit recovery workflow and a backup copy.",
    },
    "corrupt_index": {
        "severity": "error",
        "explanation": "The paper index violates required schema or paper-identity invariants.",
        "next_action": "Preserve paper_index.csv and repair or restore it explicitly before using write commands.",
    },
}


def _required_identity(value: object, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise PaperContractError(f"Paper {field_name} is required.")
    return normalized


def _text(value: object) -> str:
    if value is None or (isinstance(value, float) and math.isnan(value)):
        return ""
    return str(value or "").strip()


def _year(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    normalized = str(value).strip()
    return "" if normalized.casefold() in {"nan", "none"} else normalized


def _boolean(value: object, field_name: str) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int) and value in (0, 1):
        return bool(value)
    normalized = str(value or "").strip().casefold()
    if normalized in {"true", "1", "yes"}:
        return True
    if normalized in {"false", "0", "no", ""}:
        return False
    raise PaperContractError(f"Paper {field_name} must be boolean.")


def _string_list(value: object) -> list[str]:
    source = value if isinstance(value, (list, tuple)) else _text(value).split(",")
    return [normalized for item in source if (normalized := _text(item))]


def _author_list(value: object) -> list[str]:
    source = value if isinstance(value, (list, tuple)) else _text(value).split(";")
    return [normalized for item in source if (normalized := _text(item))]


def _safe_filename(value: object) -> str:
    normalized = _text(value).replace("\\", "/")
    return PurePosixPath(normalized).name if normalized else ""


def _safe_relative_path(value: object) -> str:
    normalized = _text(value).replace("\\", "/")
    path = PurePosixPath(normalized)
    if not normalized:
        return ""
    if path.is_absolute() or PureWindowsPath(normalized).is_absolute() or ".." in path.parts:
        raise PaperContractError("Paper PDF path must be workspace-relative.")
    return path.as_posix()


def _strict_text(value: object, field_name: str, error_type: type[ValueError]) -> str:
    if not isinstance(value, str):
        raise error_type(f"{field_name} must be a string.")
    return value.strip()


def _strict_untrimmed_text(
    value: object,
    field_name: str,
    error_type: type[ValueError],
) -> str:
    if not isinstance(value, str):
        raise error_type(f"{field_name} must be a string.")
    return value


def _strict_string_list(
    value: object,
    field_name: str,
    error_type: type[ValueError],
) -> list[str]:
    if not isinstance(value, (list, tuple)):
        raise error_type(f"{field_name} must be a list.")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise error_type(f"{field_name} must contain only strings.")
        normalized = item.strip()
        if normalized:
            result.append(normalized)
    return result


def _nonnegative_integer(
    value: object,
    field_name: str,
    error_type: type[ValueError],
) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise error_type(f"{field_name} must be a non-negative integer.")
    return value


def _strict_revision(
    value: object,
    field_name: str,
    error_type: type[ValueError],
) -> str:
    revision = _strict_text(value, field_name, error_type)
    if re.fullmatch(r"[0-9a-f]{64}", revision) is None:
        raise error_type(f"{field_name} must be a deterministic revision.")
    return revision


def adapt_project_list_item(source: Mapping[str, Any]) -> ProjectListItem:
    project_id = _strict_text(source.get("project_id"), "project_id", ProjectContractError)
    name = _strict_text(source.get("name"), "name", ProjectContractError)
    if not project_id or not name:
        raise ProjectContractError("Project identity and name are required.")
    return ProjectListItem(
        project_id=project_id,
        name=name,
        description=_strict_untrimmed_text(
            source.get("description"),
            "description",
            ProjectContractError,
        ),
        status=_strict_text(source.get("status"), "status", ProjectContractError),
        priority=_strict_text(source.get("priority"), "priority", ProjectContractError),
        tags=_strict_string_list(source.get("tags"), "tags", ProjectContractError),
        created_at=_strict_text(
            source.get("created_at"),
            "created_at",
            ProjectContractError,
        ),
        updated_at=_strict_text(
            source.get("updated_at"),
            "updated_at",
            ProjectContractError,
        ),
        project_revision=_strict_revision(
            source.get("project_revision"),
            "project_revision",
            ProjectContractError,
        ),
        link_count=_nonnegative_integer(
            source.get("link_count"),
            "link_count",
            ProjectContractError,
        ),
        linked_paper_count=_nonnegative_integer(
            source.get("linked_paper_count"),
            "linked_paper_count",
            ProjectContractError,
        ),
        linked_note_block_count=_nonnegative_integer(
            source.get("linked_note_block_count"),
            "linked_note_block_count",
            ProjectContractError,
        ),
    )


def _adapt_linked_paper(source: Mapping[str, Any]) -> LinkedPaperSummary:
    paper_id = _strict_text(source.get("paper_id"), "paper.paper_id", ProjectContractError)
    if not paper_id:
        raise ProjectContractError("Linked paper identity is required.")
    archived = source.get("archived")
    if not isinstance(archived, bool):
        raise ProjectContractError("paper.archived must be boolean.")
    return LinkedPaperSummary(
        paper_id=paper_id,
        title=_strict_text(source.get("title"), "paper.title", ProjectContractError),
        first_author=_strict_text(
            source.get("first_author"),
            "paper.first_author",
            ProjectContractError,
        ),
        year=_strict_text(source.get("year"), "paper.year", ProjectContractError),
        status=_strict_text(source.get("status"), "paper.status", ProjectContractError),
        priority=_strict_text(
            source.get("priority"),
            "paper.priority",
            ProjectContractError,
        ),
        tags=_strict_string_list(source.get("tags"), "paper.tags", ProjectContractError),
        archived=archived,
    )


def _adapt_linked_note_block(source: Mapping[str, Any]) -> LinkedNoteBlockSummary:
    return LinkedNoteBlockSummary(
        block_id=_strict_text(source.get("block_id"), "note_block.block_id", ProjectContractError),
        paper_id=_strict_text(source.get("paper_id"), "note_block.paper_id", ProjectContractError),
        source_paper_title=_strict_untrimmed_text(
            source.get("source_paper_title"),
            "note_block.source_paper_title",
            ProjectContractError,
        ),
        block_type=_strict_text(
            source.get("block_type"),
            "note_block.block_type",
            ProjectContractError,
        ),
        title=_strict_untrimmed_text(source.get("title"), "note_block.title", ProjectContractError),
        text_preview=_strict_untrimmed_text(
            source.get("text_preview"),
            "note_block.text_preview",
            ProjectContractError,
        ),
        page=_strict_untrimmed_text(source.get("page"), "note_block.page", ProjectContractError),
        figure=_strict_untrimmed_text(
            source.get("figure"),
            "note_block.figure",
            ProjectContractError,
        ),
        tags=_strict_string_list(source.get("tags"), "note_block.tags", ProjectContractError),
    )


def adapt_project_detail(
    source: Mapping[str, Any],
    *,
    links_limit: int,
    links_offset: int,
) -> ProjectDetail:
    base = adapt_project_list_item(source)
    raw_links = source.get("links")
    if not isinstance(raw_links, (list, tuple)):
        raise ProjectContractError("Project links must be a list.")
    links: list[ProjectLinkTarget] = []
    for raw_link in raw_links:
        if not isinstance(raw_link, Mapping):
            raise ProjectContractError("Project links must be objects.")
        try:
            target_state = ProjectTargetState(
                _strict_text(
                    raw_link.get("target_state"),
                    "link.target_state",
                    ProjectContractError,
                )
            )
        except ValueError:
            raise ProjectContractError("Project target state is unsupported.") from None
        raw_paper = raw_link.get("paper")
        paper = _adapt_linked_paper(raw_paper) if isinstance(raw_paper, Mapping) else None
        raw_note_block = raw_link.get("note_block")
        note_block = (
            _adapt_linked_note_block(raw_note_block)
            if isinstance(raw_note_block, Mapping)
            else None
        )
        target_type = _strict_text(
            raw_link.get("target_type"),
            "link.target_type",
            ProjectContractError,
        )
        if target_type == "paper":
            if target_state is ProjectTargetState.available and paper is None:
                target_state = ProjectTargetState.unavailable
            if note_block is not None:
                raise ProjectContractError("Paper targets cannot expose Note Block data.")
        elif target_type == "note_block":
            if target_state is ProjectTargetState.available and note_block is None:
                target_state = ProjectTargetState.unavailable
            if paper is not None:
                raise ProjectContractError("Note Block targets cannot expose Paper-detail data.")
        if target_state is not ProjectTargetState.available and (paper is not None or note_block is not None):
            raise ProjectContractError("Unavailable Project targets cannot expose resolved data.")
        links.append(
            ProjectLinkTarget(
                link_id=_strict_text(
                    raw_link.get("link_id"),
                    "link.link_id",
                    ProjectContractError,
                ),
                link_type=_strict_text(
                    raw_link.get("link_type"),
                    "link.link_type",
                    ProjectContractError,
                ),
                target_type=target_type,
                target_id=_strict_text(
                    raw_link.get("target_id"),
                    "link.target_id",
                    ProjectContractError,
                ),
                target_state=target_state,
                paper_id=_strict_text(
                    raw_link.get("paper_id"),
                    "link.paper_id",
                    ProjectContractError,
                ),
                created_at=_strict_text(
                    raw_link.get("created_at"),
                    "link.created_at",
                    ProjectContractError,
                ),
                paper=paper,
                note_block=note_block,
            )
        )
    links.sort(key=lambda link: (link.created_at, link.link_id))
    page = links[links_offset : links_offset + links_limit]
    total = len(links)
    return ProjectDetail(
        **base.model_dump(),
        links=page,
        links_total=total,
        links_limit=links_limit,
        links_offset=links_offset,
        links_has_more=links_offset + len(page) < total,
        links_revision=_strict_revision(
            source.get("links_revision"),
            "links_revision",
            ProjectContractError,
        ),
        orphaned_link_count=_nonnegative_integer(
            source.get("orphaned_link_count"),
            "orphaned_link_count",
            ProjectContractError,
        ),
    )


def _adapt_project_command_state(source) -> ProjectCommandState:
    return ProjectCommandState(
        project_id=_strict_text(
            source.project_id,
            "project.project_id",
            ProjectContractError,
        ),
        name=_strict_text(source.name, "project.name", ProjectContractError),
        description=_strict_untrimmed_text(
            source.description,
            "project.description",
            ProjectContractError,
        ),
        status=_strict_text(source.status, "project.status", ProjectContractError),
        priority=_strict_text(
            source.priority,
            "project.priority",
            ProjectContractError,
        ),
        tags=_strict_string_list(
            source.tags,
            "project.tags",
            ProjectContractError,
        ),
        created_at=_strict_text(
            source.created_at,
            "project.created_at",
            ProjectContractError,
        ),
        updated_at=_strict_text(
            source.updated_at,
            "project.updated_at",
            ProjectContractError,
        ),
        project_revision=_strict_revision(
            source.project_revision,
            "project.project_revision",
            ProjectContractError,
        ),
        links_revision=_strict_revision(
            source.links_revision,
            "project.links_revision",
            ProjectContractError,
        ),
        link_count=_nonnegative_integer(
            source.link_count,
            "project.link_count",
            ProjectContractError,
        ),
        linked_paper_count=_nonnegative_integer(
            source.linked_paper_count,
            "project.linked_paper_count",
            ProjectContractError,
        ),
        linked_note_block_count=_nonnegative_integer(
            source.linked_note_block_count,
            "project.linked_note_block_count",
            ProjectContractError,
        ),
    )


def adapt_project_command_result(
    result: DomainProjectCommandResult,
) -> ProjectCommandResponse:
    try:
        return ProjectCommandResponse(
            status=result.status,
            project=_adapt_project_command_state(result.project),
        )
    except ValueError:
        raise ProjectContractError(
            "Project command result contains unsupported values."
        ) from None


def adapt_paper_link_command_result(
    result: DomainPaperLinkCommandResult,
) -> PaperLinkCommandResponse:
    try:
        return PaperLinkCommandResponse(
            status=result.status,
            project=_adapt_project_command_state(result.project),
            link=PaperLinkCommandState(
                link_id=_strict_text(
                    result.link.link_id,
                    "link.link_id",
                    ProjectContractError,
                ),
                project_id=_strict_text(
                    result.link.project_id,
                    "link.project_id",
                    ProjectContractError,
                ),
                paper_id=_strict_text(
                    result.link.paper_id,
                    "link.paper_id",
                    ProjectContractError,
                ),
                link_type=_strict_text(
                    result.link.link_type,
                    "link.link_type",
                    ProjectContractError,
                ),
                created_at=_strict_text(
                    result.link.created_at,
                    "link.created_at",
                    ProjectContractError,
                ),
            ),
        )
    except ValueError:
        raise ProjectContractError(
            "Paper link command result contains unsupported values."
        ) from None


def adapt_canonical_tag(source: Mapping[str, Any]) -> CanonicalTag:
    canonical_key = _strict_text(
        source.get("canonical_key"),
        "canonical_key",
        TagContractError,
    )
    label = _strict_text(source.get("label"), "label", TagContractError)
    if not canonical_key or not label:
        raise TagContractError("Canonical tag identity and label are required.")
    return CanonicalTag(
        canonical_key=canonical_key,
        label=label,
        category=_strict_text(source.get("category"), "category", TagContractError),
        aliases=_strict_string_list(source.get("aliases"), "aliases", TagContractError),
        status=_strict_text(source.get("status"), "status", TagContractError),
        suggestion_strength=_nonnegative_integer(
            source.get("suggestion_strength"),
            "suggestion_strength",
            TagContractError,
        ),
    )


def _adapt_note_block_item(source: Mapping[str, Any]) -> NoteBlockItem:
    try:
        return NoteBlockItem(
            id=_strict_text(source.get("id"), "id", NoteBlockContractError),
            paper_id=_strict_text(source.get("paper_id"), "paper_id", NoteBlockContractError),
            block_type=_strict_text(
                source.get("block_type"),
                "block_type",
                NoteBlockContractError,
            ),
            title=_strict_untrimmed_text(source.get("title"), "title", NoteBlockContractError),
            text=_strict_untrimmed_text(source.get("text"), "text", NoteBlockContractError),
            page=_strict_untrimmed_text(source.get("page"), "page", NoteBlockContractError),
            figure=_strict_untrimmed_text(source.get("figure"), "figure", NoteBlockContractError),
            quote=_strict_untrimmed_text(source.get("quote"), "quote", NoteBlockContractError),
            tags=_strict_string_list(source.get("tags"), "tags", NoteBlockContractError),
            created_at=_strict_text(
                source.get("created_at"),
                "created_at",
                NoteBlockContractError,
            ),
            updated_at=_strict_text(
                source.get("updated_at"),
                "updated_at",
                NoteBlockContractError,
            ),
        )
    except ValueError as exc:
        if isinstance(exc, NoteBlockContractError):
            raise
        raise NoteBlockContractError("Note Block contains unsupported values.") from None


def adapt_note_block_collection(source: Mapping[str, Any]) -> NoteBlockCollectionResponse:
    raw_source = source.get("source_paper")
    raw_items = source.get("items")
    raw_links = source.get("project_links")
    if not isinstance(raw_source, Mapping):
        raise NoteBlockContractError("Note Block source Paper must be an object.")
    if not isinstance(raw_items, (list, tuple)):
        raise NoteBlockContractError("Note Block items must be a list.")
    if not isinstance(raw_links, (list, tuple)):
        raise NoteBlockContractError("Note Block Project links must be a list.")
    if any(not isinstance(item, Mapping) for item in raw_items):
        raise NoteBlockContractError("Note Block items must be objects.")
    if any(not isinstance(link, Mapping) for link in raw_links):
        raise NoteBlockContractError("Note Block Project links must be objects.")
    try:
        response = NoteBlockCollectionResponse(
            source_paper=NoteBlockSourcePaper(
                paper_id=_strict_text(
                    raw_source.get("paper_id"),
                    "source_paper.paper_id",
                    NoteBlockContractError,
                ),
                title=_strict_untrimmed_text(
                    raw_source.get("title"),
                    "source_paper.title",
                    NoteBlockContractError,
                ),
            ),
            items=[
                _adapt_note_block_item(item)
                for item in raw_items
            ],
            total=_nonnegative_integer(source.get("total"), "total", NoteBlockContractError),
            note_blocks_revision=_strict_revision(
                source.get("note_blocks_revision"),
                "note_blocks_revision",
                NoteBlockContractError,
            ),
            project_links=[
                NoteBlockProjectLink(
                    link_id=_strict_text(link.get("link_id"), "link_id", NoteBlockContractError),
                    project_id=_strict_text(
                        link.get("project_id"),
                        "project_id",
                        NoteBlockContractError,
                    ),
                    project_name=_strict_untrimmed_text(
                        link.get("project_name"),
                        "project_name",
                        NoteBlockContractError,
                    ),
                    project_status=_strict_text(
                        link.get("project_status"),
                        "project_status",
                        NoteBlockContractError,
                    ),
                    note_block_id=_strict_text(
                        link.get("note_block_id"),
                        "note_block_id",
                        NoteBlockContractError,
                    ),
                    link_type=_strict_text(
                        link.get("link_type"),
                        "link_type",
                        NoteBlockContractError,
                    ),
                    links_revision=_strict_revision(
                        link.get("links_revision"),
                        "links_revision",
                        NoteBlockContractError,
                    ),
                )
                for link in raw_links
            ],
            project_links_state=_strict_text(
                source.get("project_links_state"),
                "project_links_state",
                NoteBlockContractError,
            ),
        )
        if response.total != len(response.items):
            raise NoteBlockContractError("Note Block total does not match its items.")
        if any(item.paper_id != response.source_paper.paper_id for item in response.items):
            raise NoteBlockContractError("Note Block Paper identity is inconsistent.")
        block_ids = {item.id for item in response.items}
        if len(block_ids) != len(response.items):
            raise NoteBlockContractError("Note Block identities must be unique.")
        if any(link.note_block_id not in block_ids for link in response.project_links):
            raise NoteBlockContractError("Project link targets an absent Note Block.")
        return response
    except ValueError as exc:
        if isinstance(exc, NoteBlockContractError):
            raise
        raise NoteBlockContractError("Note Block collection contains unsupported values.") from None


def adapt_note_block_command_result(
    source: DomainNoteBlockCommandResult,
) -> NoteBlockCommandResponse:
    return NoteBlockCommandResponse(
        status=source.status,
        block=_adapt_note_block_item(source.block),
        note_blocks_revision=_strict_revision(
            source.note_blocks_revision,
            "note_blocks_revision",
            NoteBlockContractError,
        ),
        total=_nonnegative_integer(source.total, "total", NoteBlockContractError),
    )


def adapt_note_block_link_command_result(
    source: DomainNoteBlockLinkCommandResult,
) -> NoteBlockLinkCommandResponse:
    return NoteBlockLinkCommandResponse(
        status=source.status,
        project=_adapt_project_command_state(source.project),
        link=NoteBlockLinkCommandState(
            link_id=_strict_text(source.link.link_id, "link.link_id", ProjectContractError),
            project_id=_strict_text(
                source.link.project_id,
                "link.project_id",
                ProjectContractError,
            ),
            paper_id=_strict_text(source.link.paper_id, "link.paper_id", ProjectContractError),
            note_block_id=_strict_text(
                source.link.note_block_id,
                "link.note_block_id",
                ProjectContractError,
            ),
            link_type=_strict_text(source.link.link_type, "link.link_type", ProjectContractError),
            created_at=_strict_text(
                source.link.created_at,
                "link.created_at",
                ProjectContractError,
            ),
        ),
    )


def adapt_candidate_summary(source: Mapping[str, Any]) -> CandidateSummaryResponse:
    quality = source.get("quality_counts")
    if not isinstance(quality, Mapping):
        raise TagContractError("Candidate quality counts must be an object.")
    try:
        return CandidateSummaryResponse(
            availability=_strict_text(
                source.get("availability"),
                "availability",
                TagContractError,
            ),
            state=_strict_text(source.get("state"), "state", TagContractError),
            source=_strict_text(source.get("source"), "source", TagContractError),
            evaluated_paper_count=_nonnegative_integer(
                source.get("evaluated_paper_count"),
                "evaluated_paper_count",
                TagContractError,
            ),
            candidate_count=_nonnegative_integer(
                source.get("candidate_count"),
                "candidate_count",
                TagContractError,
            ),
            known_canonical_match_count=_nonnegative_integer(
                source.get("known_canonical_match_count"),
                "known_canonical_match_count",
                TagContractError,
            ),
            quality_counts=CandidateQualityCounts(
                high=_nonnegative_integer(quality.get("high"), "quality.high", TagContractError),
                medium=_nonnegative_integer(
                    quality.get("medium"),
                    "quality.medium",
                    TagContractError,
                ),
                weak=_nonnegative_integer(quality.get("weak"), "quality.weak", TagContractError),
                rejected=_nonnegative_integer(
                    quality.get("rejected"),
                    "quality.rejected",
                    TagContractError,
                ),
            ),
        )
    except ValueError as error:
        if isinstance(error, TagContractError):
            raise
        raise TagContractError("Candidate summary contains unsupported values.") from None


def adapt_candidate_review_queue_item(source: Mapping[str, Any]) -> TagCandidateReviewQueueItem:
    """Allowlist a task-facing queue item without exposing review-store state."""

    try:
        candidate_count = _nonnegative_integer(
            source.get("candidate_count"), "candidate_count", TagContractError,
        )
        if candidate_count < 1:
            raise TagContractError("Candidate queue items require a reviewable candidate.")
        labels = _strict_string_list(
            source.get("candidate_labels"), "candidate_labels", TagContractError,
        )
        if len(labels) > 3:
            raise TagContractError("Candidate review labels exceed their bound.")
        paper_id = _strict_text(source.get("paper_id"), "paper_id", TagContractError)
        title = _strict_text(source.get("title"), "title", TagContractError)
        if not paper_id or not title:
            raise TagContractError("Candidate queue Paper identity and title are required.")
        return TagCandidateReviewQueueItem(
            paper_id=paper_id,
            title=title,
            candidate_count=candidate_count,
            unresolved_count=_nonnegative_integer(source.get("unresolved_count"), "unresolved_count", TagContractError),
            resolved_count=_nonnegative_integer(source.get("resolved_count"), "resolved_count", TagContractError),
            approved_count=_nonnegative_integer(source.get("approved_count"), "approved_count", TagContractError),
            candidate_labels=labels,
        )
    except ValueError as error:
        if isinstance(error, TagContractError):
            raise
        raise TagContractError("Candidate review queue item contains unsupported values.") from None


def _settings_mapping(value: object, field_name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise SettingsContractError(f"{field_name} must be an object.")
    return value


def _settings_state(
    value: object,
    field_name: str,
    allowed: set[str],
) -> str:
    state = _strict_text(value, field_name, SettingsContractError)
    if state not in allowed:
        raise SettingsContractError(f"{field_name} is unsupported.")
    return state


def _settings_count(source: Mapping[str, Any], field_name: str) -> tuple[str, int | None]:
    state = _settings_state(
        source.get("state"),
        f"{field_name}.state",
        {"healthy", "warning", "unavailable", "empty"},
    )
    count = source.get("count")
    if state == "unavailable":
        if count is not None:
            raise SettingsContractError(f"{field_name}.count must be null when unavailable.")
        return state, None
    return state, _nonnegative_integer(
        count,
        f"{field_name}.count",
        SettingsContractError,
    )


def _workspace_section_state(resources: list[SettingsWorkspaceResource]) -> str:
    states = [resource.state for resource in resources]
    if all(state == "unavailable" for state in states):
        return "unavailable"
    if any(state in {"warning", "unavailable"} for state in states):
        return "warning"
    if all(state == "empty" for state in states):
        return "empty"
    return "healthy"


def _workspace_resource_summary(code: str, state: str, count: int | None) -> str:
    _label, noun = _SETTINGS_RESOURCE_METADATA[code]
    if state == "unavailable":
        return f"The {noun} count is unavailable."
    if state == "empty":
        return f"No {noun} are currently stored."
    if state == "warning":
        return f"{count} {noun} are stored; review the integrity summary."
    return f"{count} {noun} are available."


def _integrity_section_state(issues: list[SettingsIntegrityIssue]) -> str:
    states = [issue.state for issue in issues]
    if all(state == "unavailable" for state in states):
        return "unavailable"
    if any(state in {"warning", "unavailable"} for state in states):
        return "warning"
    return "healthy"


def _safe_version(value: object) -> str:
    version = _strict_text(value, "application.product_version", SettingsContractError)
    if len(version) > 64 or not re.fullmatch(
        r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.-]+)?",
        version,
    ):
        raise SettingsContractError("The canonical product version is invalid.")
    return version


def _safe_utc_timestamp(value: object) -> str:
    timestamp = _strict_text(value, "backup_readiness.last_updated_at", SettingsContractError)
    if len(timestamp) > 40 or not timestamp.endswith("Z"):
        raise SettingsContractError("The backup timestamp is invalid.")
    try:
        parsed = datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    except ValueError:
        raise SettingsContractError("The backup timestamp is invalid.") from None
    if parsed.utcoffset() is None or parsed.utcoffset().total_seconds() != 0:
        raise SettingsContractError("The backup timestamp must be UTC.")
    return timestamp


def adapt_settings_summary(source: Mapping[str, Any]) -> SettingsSummaryResponse:
    application = _settings_mapping(source.get("application"), "application")
    workspace_source = _settings_mapping(source.get("workspace"), "workspace")
    integrity_source = _settings_mapping(
        source.get("data_integrity"),
        "data_integrity",
    )
    backup_source = _settings_mapping(
        source.get("backup_readiness"),
        "backup_readiness",
    )

    version = _safe_version(application.get("product_version"))
    api_state = _settings_state(
        application.get("api_state"),
        "application.api_state",
        {"available"},
    )
    resources: list[SettingsWorkspaceResource] = []
    for code, (label, _noun) in _SETTINGS_RESOURCE_METADATA.items():
        state, count = _settings_count(
            _settings_mapping(workspace_source.get(code), f"workspace.{code}"),
            f"workspace.{code}",
        )
        resources.append(
            SettingsWorkspaceResource(
                code=code,
                label=label,
                state=state,
                count=count,
                summary=_workspace_resource_summary(code, state, count),
            )
        )
    workspace_state = _workspace_section_state(resources)
    workspace_summaries = {
        "healthy": "Available workspace stores are readable.",
        "warning": "Some workspace data or lightweight diagnostics need attention.",
        "unavailable": "Workspace counts are temporarily unavailable.",
        "empty": "The workspace stores are empty.",
    }

    issues: list[SettingsIntegrityIssue] = []
    for code, guidance in _SETTINGS_ISSUE_GUIDANCE.items():
        state, count = _settings_count(
            _settings_mapping(
                integrity_source.get(code),
                f"data_integrity.{code}",
            ),
            f"data_integrity.{code}",
        )
        if state == "empty":
            raise SettingsContractError("Integrity state cannot be empty.")
        issues.append(
            SettingsIntegrityIssue(
                code=code,
                state=state,
                count=count,
                severity=guidance["severity"],
                explanation=guidance["explanation"],
                next_action=guidance["next_action"],
            )
        )
    integrity_state = _integrity_section_state(issues)
    integrity_summaries = {
        "healthy": "All available lightweight integrity checks report zero issues.",
        "warning": "Some lightweight integrity checks found issues or are unavailable.",
        "unavailable": "Lightweight integrity diagnostics are temporarily unavailable.",
    }

    backup_state = _settings_state(
        backup_source.get("state"),
        "backup_readiness.state",
        {"healthy", "warning", "unavailable"},
    )
    snapshot_available = backup_source.get("snapshot_available")
    last_updated_at = backup_source.get("last_updated_at")
    evidence_state = backup_source.get("evidence_state")
    snapshot_type = backup_source.get("snapshot_type")
    if evidence_state is not None and evidence_state not in {"absent", "invalid", "stale", "verified_full", "verified_light", "unavailable"}:
        raise SettingsContractError("Unsupported backup verification evidence.")
    if snapshot_type is not None and snapshot_type not in {"full", "light"}:
        raise SettingsContractError("Unsupported backup snapshot type.")
    if backup_state == "healthy":
        if snapshot_available is not True:
            raise SettingsContractError("Healthy backup evidence must be present.")
        safe_last_updated_at = _safe_utc_timestamp(last_updated_at)
        backup_summary = "A verified full backup snapshot is available." if evidence_state == "verified_full" else "Backup snapshot evidence is available."
    elif backup_state == "warning":
        if evidence_state in {"stale", "verified_light"}:
            if snapshot_available is not True:
                raise SettingsContractError("Verified backup evidence must be present.")
            safe_last_updated_at = _safe_utc_timestamp(last_updated_at)
            backup_summary = "The verified backup is stale; create a current snapshot." if evidence_state == "stale" else "A verified light backup is available; PDF files are not included."
        else:
            if snapshot_available is not False or last_updated_at is not None:
                raise SettingsContractError("Absent backup evidence must not include a timestamp.")
            safe_last_updated_at = None
            backup_summary = "No verified backup snapshot is available." if evidence_state == "invalid" else "No backup snapshot evidence is available."
    else:
        if snapshot_available is not None or last_updated_at is not None:
            raise SettingsContractError("Unavailable backup evidence must use null values.")
        safe_last_updated_at = None
        backup_summary = "Backup snapshot evidence is temporarily unavailable."

    try:
        return SettingsSummaryResponse(
            application=SettingsApplicationSection(
                state="healthy",
                product_version=version,
                api_state=api_state,
                api_contract_version=version,
                summary="The local read-only API is available.",
            ),
            workspace=SettingsWorkspaceSection(
                state=workspace_state,
                resources=resources,
                summary=workspace_summaries[workspace_state],
            ),
            data_integrity=SettingsDataIntegritySection(
                state=integrity_state,
                issues=issues,
                summary=integrity_summaries[integrity_state],
            ),
            backup_readiness=SettingsBackupReadinessSection(
                state=backup_state,
                snapshot_available=snapshot_available,
                last_updated_at=safe_last_updated_at,
                summary=backup_summary,
                evidence_state=evidence_state,
                snapshot_type=snapshot_type,
            ),
        )
    except ValueError:
        raise SettingsContractError("Settings summary contains unsupported values.") from None


def adapt_paper_list_item(source: Mapping[str, Any]) -> PaperListItem:
    return PaperListItem(
        paper_id=_required_identity(source.get("paper_id"), "paper_id"),
        title=_required_identity(source.get("title"), "title"),
        first_author=_text(source.get("first_author")),
        year=_year(source.get("year")),
        status=_text(source.get("status")) or "unread",
        priority=_text(source.get("priority")) or "normal",
        tags=_string_list(source.get("tags")),
        archived=_boolean(source.get("archived", False), "archived"),
        missing_pdf=_boolean(source.get("missing_pdf", False), "missing_pdf"),
        health=_string_list(source.get("health")),
    )


def adapt_paper_detail(source: Mapping[str, Any]) -> PaperDetail:
    base = adapt_paper_list_item(source)
    links = source.get("project_links", [])
    if not isinstance(links, (list, tuple)):
        raise PaperContractError("Paper project_links must be a list.")
    project_links = [
        ProjectLink(
            project_id=_text(link.get("project_id")),
            link_type=_text(link.get("link_type")),
            target_type=_text(link.get("target_type")),
        )
        for link in links
        if isinstance(link, Mapping)
    ]
    return PaperDetail(
        **base.model_dump(),
        authors=_author_list(source.get("authors")),
        journal=_text(source.get("journal")),
        abstract=_text(source.get("abstract")),
        keywords=_string_list(source.get("keywords")),
        arxiv_id=_text(source.get("arxiv_id")),
        filename=_safe_filename(source.get("filename")),
        relative_pdf_path=_safe_relative_path(source.get("relative_pdf_path")),
        doi=_text(source.get("doi")),
        project_links=project_links,
        note_available=_boolean(source.get("note_available", False), "note_available"),
        extracted_text_available=_boolean(
            source.get("extracted_text_available", False),
            "extracted_text_available",
        ),
        profile_available=_boolean(source.get("profile_available", False), "profile_available"),
        lifecycle_state=_text(source.get("lifecycle_state")) or ("archived" if base.archived else "active"),
        recoverable_warnings=_string_list(source.get("recoverable_warnings")),
        reading_status_revision=_strict_revision(
            source.get("reading_status_revision"), "reading_status_revision", PaperContractError,
        ),
        pdf_revision=_strict_revision(source.get("pdf_revision"), "pdf_revision", PaperContractError),
        lifecycle_revision=_strict_revision(
            source.get("lifecycle_revision"), "lifecycle_revision", PaperContractError,
        ),
    )


def _strict_string(value: object, field_name: str) -> str:
    if not isinstance(value, str):
        raise PaperContractError(f"Reader {field_name} must be a string.")
    return value


def _reader_warnings(value: object) -> list[str]:
    if not isinstance(value, (list, tuple)):
        raise PaperContractError("Reader warnings must be a list.")
    warnings: list[str] = []
    for item in value:
        if not isinstance(item, str):
            raise PaperContractError("Reader warnings must contain only strings.")
        normalized = item.strip()
        if normalized and normalized not in warnings:
            warnings.append(normalized)
    return warnings


def adapt_reader_snapshot(source: Mapping[str, Any]) -> ReaderSnapshotResponse:
    """Adapt one domain snapshot without re-reading or recomputing saved state."""

    paper_source = source.get("paper")
    header_source = source.get("canonical_note_header")
    baseline_source = source.get("saved_note_baseline")
    if not isinstance(paper_source, Mapping):
        raise PaperContractError("Reader paper must be an object.")
    if not isinstance(header_source, Mapping):
        raise PaperContractError("Reader canonical_note_header must be an object.")
    if not isinstance(baseline_source, Mapping):
        raise PaperContractError("Reader saved_note_baseline must be an object.")

    raw_pdf_state = _strict_string(source.get("pdf_state"), "pdf_state")
    try:
        pdf_state = ReaderPdfState(raw_pdf_state)
    except ValueError:
        raise PaperContractError("Reader pdf_state is not supported.") from None

    saved_note_available = source.get("saved_note_available")
    if not isinstance(saved_note_available, bool):
        raise PaperContractError("Reader saved_note_available must be boolean.")
    saved_note_content = _strict_string(source.get("saved_note_content"), "saved_note_content")
    if not saved_note_available and saved_note_content:
        raise PaperContractError("Reader unavailable saved note cannot expose content.")
    unavailable_reason = _strict_string(source.get("unavailable_reason"), "unavailable_reason")

    paper = adapt_paper_detail(paper_source)
    expected_pdf_state = ReaderPdfState.missing if paper.missing_pdf else ReaderPdfState.available
    if pdf_state is not expected_pdf_state:
        raise PaperContractError("Reader pdf_state conflicts with paper availability.")
    if pdf_state is ReaderPdfState.missing and not unavailable_reason.strip():
        raise PaperContractError("Reader missing PDF state requires an unavailable reason.")
    if pdf_state is ReaderPdfState.available and unavailable_reason:
        raise PaperContractError("Reader available PDF state cannot include an unavailable reason.")

    header = ReaderNoteHeader(
        template_version=_strict_string(header_source.get("template_version"), "canonical_note_header.template_version"),
        paper_id=_strict_string(header_source.get("paper_id"), "canonical_note_header.paper_id"),
        title=_strict_string(header_source.get("title"), "canonical_note_header.title"),
        doi=_strict_string(header_source.get("doi"), "canonical_note_header.doi"),
        arxiv_id=_strict_string(header_source.get("arxiv_id"), "canonical_note_header.arxiv_id"),
        year=_strict_string(header_source.get("year"), "canonical_note_header.year"),
        first_author=_strict_string(header_source.get("first_author"), "canonical_note_header.first_author"),
        tags=_strict_string(header_source.get("tags"), "canonical_note_header.tags"),
    )
    if header.paper_id != paper.paper_id:
        raise PaperContractError("Reader canonical note identity conflicts with paper identity.")

    metadata_source = source.get("editable_metadata")
    if not isinstance(metadata_source, Mapping):
        raise PaperContractError("Reader editable_metadata must be an object.")
    editable_metadata = EditablePaperMetadata(
        title=_strict_string(metadata_source.get("title"), "editable_metadata.title"),
        authors=_strict_string(metadata_source.get("authors"), "editable_metadata.authors"),
        year=_strict_string(metadata_source.get("year"), "editable_metadata.year"),
        journal=_strict_string(metadata_source.get("journal"), "editable_metadata.journal"),
        doi=_strict_string(metadata_source.get("doi"), "editable_metadata.doi"),
        abstract=_strict_string(metadata_source.get("abstract"), "editable_metadata.abstract"),
        keywords=_strict_string(metadata_source.get("keywords"), "editable_metadata.keywords"),
    )
    metadata_revision = _strict_string(source.get("metadata_revision"), "metadata_revision")
    if len(metadata_revision) != 64 or any(
        character not in "0123456789abcdef" for character in metadata_revision
    ):
        raise PaperContractError("Reader metadata_revision must be a lowercase SHA-256 value.")
    tags_revision = _strict_string(source.get("tags_revision"), "tags_revision")
    if len(tags_revision) != 64 or any(
        character not in "0123456789abcdef" for character in tags_revision
    ):
        raise PaperContractError("Reader tags_revision must be a lowercase SHA-256 value.")

    note_exists = baseline_source.get("exists")
    if not isinstance(note_exists, bool):
        raise PaperContractError("Reader saved_note_baseline.exists must be boolean.")
    sha256 = _strict_string(baseline_source.get("sha256"), "saved_note_baseline.sha256")
    size_bytes = baseline_source.get("size_bytes")
    if isinstance(size_bytes, bool) or not isinstance(size_bytes, int) or size_bytes < 0:
        raise PaperContractError("Reader saved_note_baseline.size_bytes must be a non-negative integer.")
    if len(sha256) != 64 or any(character not in "0123456789abcdef" for character in sha256):
        raise PaperContractError("Reader saved_note_baseline.sha256 must be a lowercase SHA-256 value.")
    if saved_note_available and not note_exists:
        raise PaperContractError("Reader saved note availability conflicts with note existence.")
    if saved_note_available:
        encoded = saved_note_content.encode("utf-8")
        if size_bytes != len(encoded) or sha256 != hashlib.sha256(encoded).hexdigest():
            raise PaperContractError("Reader saved note baseline conflicts with saved content.")

    return ReaderSnapshotResponse(
        paper=paper,
        editable_metadata=editable_metadata,
        metadata_revision=metadata_revision,
        tags_revision=tags_revision,
        pdf_state=pdf_state,
        saved_note_available=saved_note_available,
        saved_note_content=saved_note_content,
        canonical_note_header=header,
        saved_note_baseline=ReaderNoteBaseline(
            exists=note_exists,
            sha256=sha256,
            size_bytes=size_bytes,
        ),
        warnings=_reader_warnings(source.get("warnings")),
        unavailable_reason=unavailable_reason,
    )


def adapt_full_text_status(source: DomainFullTextStatus) -> FullTextStatusResponse:
    try:
        return FullTextStatusResponse(
            paper_id=source.paper_id,
            state=source.state,
            extraction_state=source.extraction_state,
            source=source.source,
            provider=source.provider,
            provider_version=source.provider_version,
            content_format=source.content_format,
            classification=source.classification,
            page_count=source.page_count,
            char_count=source.char_count,
            ocr_needed_pages=list(source.ocr_needed_pages),
            extracted_at=source.extracted_at,
            has_content=source.has_content,
            is_stale=source.is_stale,
            can_extract=source.can_extract,
            previous_cache_preserved=source.previous_cache_preserved,
            message=source.message,
        )
    except (TypeError, ValueError):
        raise FullTextContractError from None


def adapt_full_text_document(source: DomainFullTextDocument) -> FullTextDocumentResponse:
    status = adapt_full_text_status(source.status)
    if not isinstance(source.content, str):
        raise FullTextContractError
    return FullTextDocumentResponse(**status.model_dump(), content=source.content)
