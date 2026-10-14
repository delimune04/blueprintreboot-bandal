from __future__ import annotations

import hashlib
import re
import zipfile
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any, Mapping
from uuid import uuid4
from xml.etree import ElementTree

import pandas as pd

from ingest.doi import normalize_doi
from services.metadata_fallback import extract_arxiv_ids, normalize_arxiv_id
from services.reading_note_template import (
    CANONICAL_READING_NOTE_TITLE,
    LEGACY_READING_NOTE_TITLES,
    READING_NOTE_HEADER_FIELDS,
    READING_NOTE_SECTIONS,
    READING_NOTE_SECTION_ALIASES,
    READING_NOTE_TEMPLATE_PATH,
    get_canonical_reading_note_template,
    reading_note_template_file_text,
)
from storage.atomic_json import atomic_write_json, read_json_file, require_json_list
from storage.note_block_store import create_note_block
from storage.note_store import load_note_text, save_note_text
from storage.note_store import note_path_for
from storage.note_block_store import note_blocks_path
from storage.file_transaction import file_transaction
from storage.paths import NOTE_BLOCKS_DIR, NOTE_IMPORTS_JSON, NOTES_DIR
from storage.workspace_lock import workspace_root_for_path, workspace_write_lock


TEMPLATE_PATH = READING_NOTE_TEMPLATE_PATH
SUPPORTED_EXTENSIONS = {".md", ".markdown", ".txt", ".docx"}
HEADER_FIELDS = READING_NOTE_HEADER_FIELDS
CANONICAL_SECTIONS = READING_NOTE_SECTIONS
SECTION_TO_BLOCK_TYPE = {
    "One-line Summary": "summary",
    "Summary": "summary",
    "Key Claims": "claim",
    "Methods": "method",
    "Evidence / Results": "evidence",
    "Questions": "question",
    "Ideas": "idea",
    "Limitations": "limitation",
}


class DuplicateNoteImportError(ValueError):
    pass


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_external_note_template(template_path: Path | None = None) -> str:
    if template_path is None:
        return get_canonical_reading_note_template()
    return reading_note_template_file_text(template_path)


def parse_external_note_file(source_filename: str, content: bytes) -> dict[str, Any]:
    suffix = Path(source_filename).suffix.lower()
    source_sha256 = _sha256_bytes(content)
    if suffix not in SUPPORTED_EXTENSIONS:
        return _empty_parse_result(
            source_filename,
            source_sha256,
            parse_errors=[f"Unsupported file extension: {suffix or 'none'}."],
        )

    if suffix == ".docx":
        text, diagnostics, parse_errors = extract_docx_paragraph_text(content)
        if parse_errors:
            result = _empty_parse_result(source_filename, source_sha256, diagnostics=diagnostics, parse_errors=parse_errors)
            return result
    else:
        try:
            text = content.decode("utf-8-sig")
        except UnicodeDecodeError as exc:
            return _empty_parse_result(
                source_filename,
                source_sha256,
                parse_errors=[f"Could not decode text file as UTF-8: {exc}"],
            )
        diagnostics = []

    return parse_external_note_text(
        text,
        source_filename=source_filename,
        source_sha256=source_sha256,
        diagnostics=diagnostics,
    )


def parse_external_note_text(
    text: str,
    *,
    source_filename: str = "",
    source_sha256: str | None = None,
    diagnostics: list[str] | None = None,
) -> dict[str, Any]:
    diagnostics = list(diagnostics or [])
    parse_errors: list[str] = []
    header_fields = {field: "" for field in HEADER_FIELDS}
    sections: dict[str, list[str]] = {section: [] for section in CANONICAL_SECTIONS}
    current_section = ""
    seen_sections: set[str] = set()
    saw_contract_title = False

    for raw_line in str(text or "").splitlines():
        line = raw_line.rstrip()
        stripped = line.strip()
        if stripped == CANONICAL_READING_NOTE_TITLE or stripped in LEGACY_READING_NOTE_TITLES:
            saw_contract_title = True
            continue

        section_name = _section_heading(stripped)
        if section_name:
            section_name = READING_NOTE_SECTION_ALIASES.get(section_name, section_name)
            if section_name in sections:
                current_section = section_name
                seen_sections.add(section_name)
            else:
                diagnostics.append(f"Ignored unknown section heading: {section_name}.")
                current_section = ""
            continue

        if current_section:
            sections[current_section].append(line)
            continue

        key, value = _header_line(stripped)
        if key in header_fields:
            header_fields[key] = value
        elif stripped and not stripped.startswith("#"):
            diagnostics.append(f"Ignored pre-section line: {stripped[:80]}")

    if not saw_contract_title:
        diagnostics.append("Template title was not found.")
    if not header_fields["template_version"]:
        diagnostics.append("Template version is missing.")
    if not seen_sections:
        parse_errors.append("No recognized template sections were found.")

    cleaned_sections = {
        section: _clean_section_text("\n".join(lines))
        for section, lines in sections.items()
    }
    missing_sections = [section for section in CANONICAL_SECTIONS if section not in seen_sections]
    if missing_sections:
        diagnostics.append("Missing sections: " + ", ".join(missing_sections) + ".")

    return {
        "template_version": header_fields["template_version"],
        "header_fields": header_fields,
        "sections": cleaned_sections,
        "diagnostics": diagnostics,
        "parse_errors": parse_errors,
        "source_filename": source_filename,
        "source_sha256": source_sha256 or _sha256_bytes(str(text or "").encode("utf-8")),
    }


def extract_docx_paragraph_text(content: bytes) -> tuple[str, list[str], list[str]]:
    diagnostics: list[str] = []
    parse_errors: list[str] = []
    try:
        with zipfile.ZipFile(BytesIO(content)) as archive:
            document_xml = archive.read("word/document.xml")
    except KeyError:
        return "", diagnostics, ["DOCX file does not contain word/document.xml."]
    except zipfile.BadZipFile:
        return "", diagnostics, ["DOCX file could not be opened as a ZIP archive."]

    try:
        root = ElementTree.fromstring(document_xml)
    except ElementTree.ParseError as exc:
        return "", diagnostics, [f"DOCX document.xml could not be parsed: {exc}"]

    paragraphs: list[str] = []
    for paragraph in root.iter(_word_tag("p")):
        parts: list[str] = []
        for node in paragraph.iter():
            if node.tag == _word_tag("t") and node.text:
                parts.append(node.text)
            elif node.tag == _word_tag("tab"):
                parts.append("\t")
        paragraph_text = "".join(parts).strip()
        if paragraph_text:
            paragraphs.append(paragraph_text)
    diagnostics.append(f"Read {len(paragraphs)} DOCX paragraphs.")
    return "\n".join(paragraphs), diagnostics, parse_errors


def build_structured_block_candidates(parsed_note: Mapping[str, Any]) -> list[dict[str, Any]]:
    sections = parsed_note.get("sections", {})
    if not isinstance(sections, Mapping):
        return []

    candidates: list[dict[str, Any]] = []
    for section, block_type in SECTION_TO_BLOCK_TYPE.items():
        content = str(sections.get(section, "") or "").strip()
        if not content:
            continue
        entries = [content] if section in ("One-line Summary", "Summary") else _section_entries(content)
        for entry in entries:
            text = entry.strip()
            if not text:
                continue
            candidates.append(
                {
                    "block_type": block_type,
                    "title": f"Imported {section}",
                    "text": text,
                    "page": "",
                    "figure": "",
                    "quote": "",
                    "tags": [],
                    "source_section": section,
                }
            )
    return candidates


def match_note_import_to_papers(parsed_note: Mapping[str, Any], index_df: pd.DataFrame) -> dict[str, Any]:
    header = parsed_note.get("header_fields", {})
    if not isinstance(header, Mapping):
        header = {}
    records = index_df.fillna("").to_dict("records") if not index_df.empty else []
    diagnostics: list[str] = []

    confident_matches: list[dict[str, str]] = []
    title_candidates: list[dict[str, str]] = []

    paper_id = str(header.get("paper_id", "") or "").strip()
    if paper_id:
        confident_matches.extend(
            _match_records(records, "paper_id", lambda record: str(record.get("paper_id", "")) == paper_id)
        )
        if confident_matches:
            return _match_result(confident_matches, title_candidates, diagnostics)
        diagnostics.append("No paper matched the template paper_id.")

    doi = normalize_doi(str(header.get("doi", "") or ""))
    if doi:
        confident_matches.extend(
            _match_records(records, "doi", lambda record: normalize_doi(str(record.get("doi", ""))) == doi)
        )
        if confident_matches:
            return _match_result(confident_matches, title_candidates, diagnostics)
        diagnostics.append("No paper matched the template DOI.")

    arxiv_id = normalize_arxiv_id(str(header.get("arxiv_id", "") or ""))
    if arxiv_id:
        confident_matches.extend(_match_records(records, "arxiv_id", lambda record: _record_has_arxiv_id(record, arxiv_id)))
        if confident_matches:
            return _match_result(confident_matches, title_candidates, diagnostics)
        diagnostics.append("No paper matched the template arXiv ID.")

    title = _normalize_title(str(header.get("title", "") or ""))
    if title:
        title_candidates = _match_records(
            records,
            "title",
            lambda record: _normalize_title(str(record.get("title", "") or "")) == title,
        )
        if title_candidates:
            diagnostics.append("Title matched candidate papers; confirm the target manually.")

    return _match_result(confident_matches, title_candidates, diagnostics)


def has_duplicate_note_import(
    target_paper_id: str,
    source_sha256: str,
    *,
    log_path: Path = NOTE_IMPORTS_JSON,
) -> bool:
    return any(
        entry.get("target_paper_id") == target_paper_id
        and entry.get("source_sha256") == source_sha256
        for entry in load_note_import_log(log_path)
    )


def load_note_import_log(log_path: Path = NOTE_IMPORTS_JSON) -> list[dict[str, Any]]:
    path = Path(log_path)
    if not path.exists():
        return []
    value = require_json_list(
        read_json_file(path, store_name="Note import log"),
        path,
        store_name="Note import log",
    )
    return [entry for entry in value if isinstance(entry, dict)]


def apply_external_note_import(
    target_record: Mapping[str, str],
    parsed_note: Mapping[str, Any],
    *,
    import_mode: str = "append_raw_notes_and_create_blocks",
    append_raw_notes: bool = True,
    create_structured_blocks: bool = True,
    force_reimport: bool = False,
    notes_dir: Path = NOTES_DIR,
    note_blocks_dir: Path = NOTE_BLOCKS_DIR,
    log_path: Path = NOTE_IMPORTS_JSON,
) -> dict[str, Any]:
    with workspace_write_lock(workspace_root_for_path(Path(log_path))):
        # The history marker, Markdown, and all generated blocks succeed as one
        # operation. A late failure restores the exact previous bytes, so retry
        # cannot append an unlogged duplicate import.
        paths = [
            note_path_for(target_record, notes_dir),
            note_blocks_path(str(target_record["paper_id"]), note_blocks_dir),
            Path(log_path),
        ]
        with file_transaction(paths):
            return _apply_external_note_import_locked(
                target_record,
                parsed_note,
                import_mode=import_mode,
                append_raw_notes=append_raw_notes,
                create_structured_blocks=create_structured_blocks,
                force_reimport=force_reimport,
                notes_dir=notes_dir,
                note_blocks_dir=note_blocks_dir,
                log_path=log_path,
            )


def _apply_external_note_import_locked(
    target_record: Mapping[str, str],
    parsed_note: Mapping[str, Any],
    *,
    import_mode: str,
    append_raw_notes: bool,
    create_structured_blocks: bool,
    force_reimport: bool,
    notes_dir: Path,
    note_blocks_dir: Path,
    log_path: Path,
) -> dict[str, Any]:
    paper_id = str(target_record["paper_id"])
    source_sha256 = str(parsed_note.get("source_sha256", ""))
    if source_sha256 and not force_reimport and has_duplicate_note_import(paper_id, source_sha256, log_path=log_path):
        raise DuplicateNoteImportError(
            "This source file has already been imported into the selected paper. "
            "Use force_reimport=True only for an intentional duplicate import."
        )

    imported_at = utc_now_iso()
    created_block_ids: list[str] = []

    if create_structured_blocks:
        for candidate in build_structured_block_candidates(parsed_note):
            block = create_note_block(
                paper_id,
                str(candidate["block_type"]),
                title=str(candidate["title"]),
                text=str(candidate["text"]),
                page="",
                figure="",
                quote="",
                tags=[],
                base_dir=note_blocks_dir,
            )
            created_block_ids.append(str(block["id"]))

    appended_markdown = False
    raw_notes = str(parsed_note.get("sections", {}).get("Raw Notes", "") or "").strip()
    if append_raw_notes and raw_notes:
        current_note = load_note_text(target_record, notes_dir=notes_dir)
        append_text = build_raw_notes_markdown_append(parsed_note, imported_at=imported_at)
        save_note_text(target_record, _append_markdown(current_note, append_text), notes_dir=notes_dir)
        appended_markdown = True

    import_id = str(uuid4())
    entry = {
        "import_id": import_id,
        "target_paper_id": paper_id,
        "source_filename": str(parsed_note.get("source_filename", "")),
        "source_sha256": source_sha256,
        "template_version": str(parsed_note.get("template_version", "")),
        "imported_at": imported_at,
        "import_mode": import_mode,
        "created_block_ids": created_block_ids,
        "appended_markdown": appended_markdown,
        "diagnostics": list(parsed_note.get("diagnostics", [])),
    }
    _append_note_import_log(entry, log_path)
    return entry


def build_raw_notes_markdown_append(parsed_note: Mapping[str, Any], *, imported_at: str) -> str:
    raw_notes = str(parsed_note.get("sections", {}).get("Raw Notes", "") or "").strip()
    if not raw_notes:
        return ""
    source_filename = str(parsed_note.get("source_filename", "") or "external note")
    template_version = str(parsed_note.get("template_version", "") or "unknown")
    return (
        f"## BluePrint Reading Note Import - {imported_at}\n\n"
        f"- Source file: {source_filename}\n"
        f"- Template version: {template_version}\n\n"
        f"{raw_notes}\n"
    )


def _append_note_import_log(entry: dict[str, Any], log_path: Path) -> None:
    path = Path(log_path)
    entries = load_note_import_log(path)
    entries.append(entry)
    atomic_write_json(path, entries, indent=2, ensure_ascii=False)


def _append_markdown(existing: str, append_text: str) -> str:
    addition = str(append_text or "").strip()
    if not addition:
        return str(existing or "")
    base = str(existing or "").rstrip()
    if not base:
        return addition + "\n"
    return f"{base}\n\n{addition}\n"


def _empty_parse_result(
    source_filename: str,
    source_sha256: str,
    *,
    diagnostics: list[str] | None = None,
    parse_errors: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "template_version": "",
        "header_fields": {field: "" for field in HEADER_FIELDS},
        "sections": {section: "" for section in CANONICAL_SECTIONS},
        "diagnostics": diagnostics or [],
        "parse_errors": parse_errors or [],
        "source_filename": source_filename,
        "source_sha256": source_sha256,
    }


def _header_line(line: str) -> tuple[str, str]:
    if ":" not in line:
        return "", ""
    key, value = line.split(":", 1)
    normalized = key.strip().lower().replace("-", "_")
    return normalized, value.strip()


def _section_heading(line: str) -> str:
    match = re.fullmatch(r"##\s+(.+?)\s*#*", line)
    return match.group(1).strip() if match else ""


def _clean_section_text(text: str) -> str:
    lines = [line.rstrip() for line in str(text or "").splitlines()]
    while lines and not lines[0].strip():
        lines.pop(0)
    while lines and not lines[-1].strip():
        lines.pop()
    if len(lines) == 1 and lines[0].strip() in {"*", "-", "- ", "* "}:
        return ""
    return "\n".join(lines).strip()


def _section_entries(text: str) -> list[str]:
    entries: list[str] = []
    current: list[str] = []
    saw_bullet = False
    for raw_line in str(text or "").splitlines():
        line = raw_line.rstrip()
        bullet_match = re.match(r"^\s*[*-]\s*(.*)$", line)
        if bullet_match:
            saw_bullet = True
            if current:
                entries.append("\n".join(current).strip())
            current = [bullet_match.group(1).strip()]
            continue
        if current:
            current.append(line.strip())
        elif line.strip():
            current = [line.strip()]
    if current:
        entries.append("\n".join(current).strip())
    if not saw_bullet:
        cleaned = _clean_section_text(text)
        return [cleaned] if cleaned else []
    return [entry for entry in entries if entry and entry not in {"*", "-"}]


def _match_records(records: list[dict[str, Any]], match_type: str, predicate: Any) -> list[dict[str, str]]:
    matches: list[dict[str, str]] = []
    for record in records:
        if predicate(record):
            matches.append(
                {
                    "paper_id": str(record.get("paper_id", "")),
                    "title": str(record.get("title", "") or record.get("filename", "")),
                    "filename": str(record.get("filename", "")),
                    "match_type": match_type,
                }
            )
    return matches


def _match_result(
    confident_matches: list[dict[str, str]],
    title_candidates: list[dict[str, str]],
    diagnostics: list[str],
) -> dict[str, Any]:
    auto_target = confident_matches[0]["paper_id"] if len(confident_matches) == 1 else ""
    if len(confident_matches) > 1:
        diagnostics.append("Multiple confident matches were found; select the target manually.")
    return {
        "auto_target_paper_id": auto_target,
        "confident_matches": confident_matches,
        "title_candidates": title_candidates,
        "diagnostics": diagnostics,
    }


def _record_has_arxiv_id(record: Mapping[str, Any], arxiv_id: str) -> bool:
    normalized = normalize_arxiv_id(arxiv_id)
    if not normalized:
        return False
    for field in ("arxiv_id", "doi", "abstract", "keywords", "filename", "title"):
        value = str(record.get(field, "") or "")
        if normalized in extract_arxiv_ids(value):
            return True
    return False


def _normalize_title(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _word_tag(local_name: str) -> str:
    return f"{{http://schemas.openxmlformats.org/wordprocessingml/2006/main}}{local_name}"


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()
