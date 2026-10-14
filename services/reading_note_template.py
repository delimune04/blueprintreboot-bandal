from __future__ import annotations

import re
from pathlib import Path
from typing import Mapping

from services.metadata_fallback import extract_arxiv_ids, normalize_arxiv_id
from storage.paths import PROJECT_ROOT


CANONICAL_READING_NOTE_TITLE = "# BluePrint Reading Note"
LEGACY_READING_NOTE_TITLES = (
    "# BluePrint External Reading Note",
    "# 랩비움 Reading Note",
    "# 랩비움 읽기 노트",
)
READING_NOTE_TEMPLATE_VERSION = "1.0"
READING_NOTE_TEMPLATE_PATH = PROJECT_ROOT / "docs" / "templates" / "blueprint_reading_note_template.md"
READING_NOTE_HEADER_FIELDS = (
    "template_version",
    "paper_id",
    "title",
    "doi",
    "arxiv_id",
    "year",
    "first_author",
    "tags",
)
READING_NOTE_SECTIONS = (
    "One-line Summary",
    "Summary",
    "Key Claims",
    "Methods",
    "Evidence / Results",
    "Questions",
    "Ideas",
    "Limitations",
    "Raw Notes",
)
READING_NOTE_BULLET_SECTIONS = (
    "Key Claims",
    "Methods",
    "Evidence / Results",
    "Questions",
    "Ideas",
    "Limitations",
)
# Display translations are accepted on import without rewriting existing notes
# or changing the canonical stored format, identifiers, or template version.
READING_NOTE_SECTION_ALIASES = {
    "한 줄 요약": "One-line Summary",
    "한줄 요약": "One-line Summary",
    "요약": "Summary",
    "핵심 주장": "Key Claims",
    "방법": "Methods",
    "연구 방법": "Methods",
    "근거 / 결과": "Evidence / Results",
    "근거/결과": "Evidence / Results",
    "질문": "Questions",
    "아이디어": "Ideas",
    "한계": "Limitations",
    "원본 메모": "Raw Notes",
    "자유 메모": "Raw Notes",
}
REFRESHABLE_READING_NOTE_HEADER_FIELDS = (
    "paper_id",
    "title",
    "doi",
    "arxiv_id",
    "year",
    "first_author",
    "tags",
)
RECOGNIZED_READING_NOTE_TITLES = (CANONICAL_READING_NOTE_TITLE, *LEGACY_READING_NOTE_TITLES)


def get_canonical_reading_note_template() -> str:
    return render_reading_note_template()


def render_reading_note_template(paper_record: Mapping[str, str] | None = None) -> str:
    header = _header_values_for_record(paper_record)
    lines = [CANONICAL_READING_NOTE_TITLE, ""]
    lines.extend(_header_line(field, header[field]) for field in READING_NOTE_HEADER_FIELDS)
    lines.append("")
    for section in READING_NOTE_SECTIONS:
        lines.append(f"## {section}")
        lines.append("")
        if section in READING_NOTE_BULLET_SECTIONS:
            lines.append("*")
            lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def refresh_reading_note_header(
    note_text: str,
    paper_record: Mapping[str, str] | None = None,
) -> dict[str, object]:
    existing = str(note_text or "")
    if not existing.strip():
        return {
            "text": render_reading_note_template(paper_record),
            "changed": True,
            "action": "inserted",
            "message": "Inserted BluePrint Reading Note template.",
        }

    section_start = _first_section_start(existing)
    header_text = existing if section_start < 0 else existing[:section_start]
    body_text = "" if section_start < 0 else existing[section_start:]
    header_lines = header_text.splitlines()
    title_index = _recognized_title_line_index(header_lines)
    if title_index < 0:
        return {
            "text": existing,
            "changed": False,
            "action": "ignored",
            "message": "Reading Note header was not refreshed because the canonical title was not found.",
        }

    existing_header_values, preserved_header_lines = _split_existing_header_lines(header_lines[title_index + 1 :])
    updated_header_values = _header_values_for_record(paper_record)
    updated_header_values["template_version"] = (
        existing_header_values.get("template_version") or READING_NOTE_TEMPLATE_VERSION
    )

    rebuilt_lines = list(header_lines[:title_index])
    rebuilt_lines.extend(
        [
            header_lines[title_index].strip(),
            "",
            *(_header_line(field, updated_header_values[field]) for field in READING_NOTE_HEADER_FIELDS),
        ]
    )
    if preserved_header_lines:
        rebuilt_lines.append("")
        rebuilt_lines.extend(preserved_header_lines)

    refreshed_text = "\n".join(rebuilt_lines).rstrip() + "\n\n" + body_text.lstrip("\n")
    if not body_text:
        refreshed_text = refreshed_text.rstrip() + "\n"

    return {
        "text": refreshed_text,
        "changed": refreshed_text != existing,
        "action": "refreshed",
        "message": "Reading Note header refreshed from paper metadata.",
    }


def reading_note_template_file_text(template_path: Path = READING_NOTE_TEMPLATE_PATH) -> str:
    return Path(template_path).read_text(encoding="utf-8")


def apply_reading_note_template_to_text(
    existing_text: str,
    paper_record: Mapping[str, str] | None = None,
    *,
    append_if_non_empty: bool = False,
) -> dict[str, object]:
    template = render_reading_note_template(paper_record)
    existing = str(existing_text or "")
    if not existing.strip():
        return {
            "text": template,
            "changed": True,
            "action": "inserted",
            "message": "Inserted BluePrint Reading Note template.",
        }
    if append_if_non_empty:
        return {
            "text": f"{existing.rstrip()}\n\n{template}",
            "changed": True,
            "action": "appended",
            "message": "Appended BluePrint Reading Note template.",
        }
    return {
        "text": existing,
        "changed": False,
        "action": "blocked_non_empty",
        "message": "Reading Note already has content; confirm before appending the template.",
    }


def _first_author(record: Mapping[str, str]) -> str:
    authors = str(record.get("authors", "") or "").strip()
    if not authors:
        return ""
    return authors.split(";")[0].split(",")[0].strip()


def _arxiv_id_for_record(record: Mapping[str, str]) -> str:
    explicit = normalize_arxiv_id(str(record.get("arxiv_id", "") or ""))
    if explicit:
        return explicit
    searchable = " ".join(
        str(record.get(field, "") or "")
        for field in ("doi", "filename", "title", "abstract", "keywords")
    )
    found = extract_arxiv_ids(searchable)
    return found[0] if found else ""


def _header_line(field: str, value: str) -> str:
    return f"{field}: {value}" if value else f"{field}:"


def _header_values_for_record(paper_record: Mapping[str, str] | None = None) -> dict[str, str]:
    record = dict(paper_record or {})
    return {
        "template_version": READING_NOTE_TEMPLATE_VERSION,
        "paper_id": str(record.get("paper_id", "") or ""),
        "title": str(record.get("title") or record.get("filename") or ""),
        "doi": str(record.get("doi", "") or ""),
        "arxiv_id": _arxiv_id_for_record(record),
        "year": str(record.get("year", "") or ""),
        "first_author": _first_author(record),
        "tags": str(record.get("tags", "") or ""),
    }


def reading_note_header_values(paper_record: Mapping[str, str] | None = None) -> dict[str, str]:
    """Return the canonical public header values without reading or writing a note."""
    return _header_values_for_record(paper_record)


def _first_section_start(text: str) -> int:
    match = re.search(r"(?m)^##\s+", text)
    return match.start() if match else -1


def _recognized_title_line_index(lines: list[str]) -> int:
    for index, line in enumerate(lines):
        stripped = line.strip()
        if not stripped:
            continue
        return index if stripped in RECOGNIZED_READING_NOTE_TITLES else -1
    return -1


def _split_existing_header_lines(lines: list[str]) -> tuple[dict[str, str], list[str]]:
    header_values: dict[str, str] = {}
    preserved_lines: list[str] = []
    for line in lines:
        stripped = line.strip()
        if not stripped:
            continue
        key, value = _parse_header_line(stripped)
        if key in READING_NOTE_HEADER_FIELDS:
            header_values[key] = value
        else:
            preserved_lines.append(line.rstrip())
    return header_values, preserved_lines


def _parse_header_line(line: str) -> tuple[str, str]:
    if ":" not in line:
        return "", ""
    key, value = line.split(":", 1)
    return key.strip().lower().replace("-", "_"), value.strip()
