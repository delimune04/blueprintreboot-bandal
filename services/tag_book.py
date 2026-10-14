from __future__ import annotations

import re
from collections import Counter
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from storage.atomic_json import atomic_write_json, read_json_file


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_TAG_BOOK_DIR = PROJECT_ROOT / "config" / "tag_book"
DEFAULT_TAG_BOOK_PATH = DEFAULT_TAG_BOOK_DIR / "tag_book.json"
DEFAULT_METHOD_LEXICON_PATH = DEFAULT_TAG_BOOK_DIR / "method_lexicon.json"
DEFAULT_NORMALIZATION_RULES_PATH = DEFAULT_TAG_BOOK_DIR / "normalization_rules.json"
DEFAULT_BLOCKED_TERMS_PATH = DEFAULT_TAG_BOOK_DIR / "blocked_terms.json"
DEFAULT_CANDIDATE_PATTERNS_PATH = DEFAULT_TAG_BOOK_DIR / "candidate_patterns.json"

LEGACY_RULE_PATH = PROJECT_ROOT / "config" / "tag_rules.json"
LEGACY_CANONICAL_TAG_PATH = PROJECT_ROOT / "config" / "canonical_tags.json"

CATEGORY_VALUES = (
    "field",
    "organism",
    "method",
    "assay",
    "gene_or_protein",
    "cell_line_or_sample",
    "tissue_or_cell_type",
    "concept",
    "model_or_algorithm",
    "paper_type",
    "dataset",
    "other",
)
ACTIVE_STATUSES = {"", "active"}
INACTIVE_STATUSES = {"blocked", "deprecated"}

SOURCE_WEIGHTS = {
    "keywords": 6,
    "pdf_keywords": 6,
    "title": 5,
    "openalex_topics": 5,
    "openalex_keywords": 5,
    "abstract": 4,
    "pdf_abstract": 4,
    "markdown_text": 3,
    "pdf_section_headings": 3,
    "extracted_text_preview": 3,
    "extracted_text": 3,
    "text_preview": 3,
    "note_methods": 3,
    "note_evidence": 3,
    "note_summary": 2,
    "note_claims": 2,
    "note_questions": 1,
    "note_ideas": 1,
    "note_limitations": 1,
    "crossref_subjects": 3,
    "journal": 2,
    "filename": 1,
}
SOURCE_FIELDS = tuple(SOURCE_WEIGHTS.keys())
SOURCE_LABELS = {
    "title": "title",
    "abstract": "abstract",
    "keywords": "keywords",
    "pdf_abstract": "pdf abstract",
    "pdf_keywords": "pdf keywords",
    "pdf_section_headings": "pdf section headings",
    "filename": "filename",
    "note_methods": "note section: Methods",
    "note_evidence": "note section: Evidence / Results",
    "note_summary": "note section: Summary",
    "note_claims": "note section: Key Claims",
    "note_questions": "note section: Questions",
    "note_ideas": "note section: Ideas",
    "note_limitations": "note section: Limitations",
}

DEFAULT_NORMALIZATION_RULES = {
    "lowercase": True,
    "casefold": False,
    "trim_whitespace": True,
    "strip_trailing_punctuation": True,
    "collapse_non_alphanumeric_to_hyphen": True,
}
SELECTABLE_SUGGESTION_KINDS = {"known_canonical", "new_candidate", "weak_candidate"}
REJECTED_SUGGESTION_KIND = "rejected_candidate"
QUALITY_LABELS = ("high", "medium", "weak", "rejected")
SECTION_PREFIXES = (
    "abstract",
    "background",
    "conclusion",
    "conclusions",
    "discussion",
    "evidence",
    "evidence results",
    "introduction",
    "keyword",
    "keywords",
    "materials and methods",
    "method",
    "methods",
    "result",
    "results",
    "summary",
    "title",
)
BOILERPLATE_TAIL_PATTERNS = (
    r"\s+levels?\s+for\s+(?:the\s+)?analysis$",
    r"\s+for\s+(?:the\s+)?analysis$",
    r"\s+for\s+various\s+downstream\s+tasks?$",
    r"\s+for\s+downstream\s+tasks?$",
    r"\s+for\s+the\s+downstream\s+analysis$",
    r"\s+in\s+this\s+study$",
    r"\s+of\s+this\s+study$",
    r"\s+of\s+the\s+study$",
    r"\s+used\s+in\s+this\s+study$",
)
STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "as",
    "at",
    "be",
    "by",
    "for",
    "from",
    "in",
    "into",
    "is",
    "of",
    "on",
    "or",
    "the",
    "these",
    "this",
    "those",
    "to",
    "using",
    "via",
    "with",
}
METHOD_LIKE_TERMS = {
    "algorithm",
    "analysis",
    "assay",
    "atlas",
    "cytometry",
    "imaging",
    "method",
    "microscopy",
    "model",
    "network",
    "pipeline",
    "protocol",
    "screen",
    "screening",
    "sequencing",
    "spectrometry",
}
MODALITY_LIKE_TERMS = {
    "atac-seq",
    "chip-seq",
    "crispr",
    "cytometry",
    "genomics",
    "metabolomics",
    "microscopy",
    "proteomics",
    "qpcr",
    "rna-seq",
    "scrna-seq",
    "sequencing",
    "spatial",
    "spectrometry",
    "transcriptomics",
}
GENERIC_MODEL_TERMS = {"foundation", "large-scale", "large", "scale", "deep", "learning", "model"}
SPECIFICITY_SUPPRESSIONS = {
    "root-development": {"lateral-root", "root-apical-meristem", "lateral-root-development"},
}


def normalize_tag(value: Any) -> str:
    return normalize_tag_with_rules(value, DEFAULT_NORMALIZATION_RULES)


def normalize_tag_with_rules(value: Any, rules: dict[str, Any] | None = None) -> str:
    active_rules = {**DEFAULT_NORMALIZATION_RULES, **(rules or {})}
    text = str(value or "")
    if active_rules.get("trim_whitespace", True):
        text = text.strip()
    if active_rules.get("strip_trailing_punctuation", True):
        text = re.sub(r"[\s\.,;:!\?]+$", "", text)
    if active_rules.get("casefold", False):
        text = text.casefold()
    elif active_rules.get("lowercase", True):
        text = text.lower()
    if active_rules.get("collapse_non_alphanumeric_to_hyphen", True):
        # Keep Unicode letters and digits (including Hangul). Existing ASCII
        # canonical keys retain exactly the same normalization as before.
        text = re.sub(r"[^\w]+|_+", "-", text, flags=re.UNICODE)
    else:
        text = re.sub(r"[\s_]+", "-", text)
    return text.strip("-")


def load_tag_book(
    tag_book_dir: str | Path | None = None,
    *,
    legacy_rule_path: str | Path | None = None,
    legacy_canonical_tag_path: str | Path | None = None,
) -> dict[str, Any]:
    base_dir = Path(tag_book_dir) if tag_book_dir is not None else DEFAULT_TAG_BOOK_DIR
    tag_book_path = base_dir / "tag_book.json"
    if tag_book_path.exists():
        raw_tag_book = _read_json(tag_book_path, {"tags": []})
        loaded_from = tag_book_path
        loaded_from_fallback = False
    else:
        raw_tag_book = {
            "version": "compat",
            "tags": _legacy_tag_records(
                rule_path=legacy_rule_path,
                canonical_tag_path=legacy_canonical_tag_path,
            ),
        }
        loaded_from = None
        loaded_from_fallback = True

    raw_records = _coerce_raw_tag_records(raw_tag_book)
    tags: dict[str, dict[str, Any]] = {}
    for raw_record in raw_records:
        record = _normalize_tag_record(raw_record)
        canonical = record["canonical"]
        if canonical and canonical not in tags:
            tags[canonical] = record

    return {
        "version": str(raw_tag_book.get("version", "2") if isinstance(raw_tag_book, dict) else "2"),
        "tags": tags,
        "raw_tag_records": raw_records,
        "method_lexicon": _load_method_lexicon(base_dir / "method_lexicon.json"),
        "normalization_rules": _read_json(base_dir / "normalization_rules.json", {}),
        "blocked_terms": _load_blocked_terms(base_dir / "blocked_terms.json"),
        "candidate_patterns": _load_candidate_patterns(base_dir / "candidate_patterns.json"),
        "source_paths": {
            "tag_book": str(loaded_from or tag_book_path),
            "method_lexicon": str(base_dir / "method_lexicon.json"),
            "normalization_rules": str(base_dir / "normalization_rules.json"),
            "blocked_terms": str(base_dir / "blocked_terms.json"),
            "candidate_patterns": str(base_dir / "candidate_patterns.json"),
        },
        "loaded_from_fallback": loaded_from_fallback,
    }


def save_tag_book(tag_book: dict[str, Any], tag_book_dir: str | Path | None = None) -> None:
    base_dir = Path(tag_book_dir) if tag_book_dir is not None else DEFAULT_TAG_BOOK_DIR
    base_dir.mkdir(parents=True, exist_ok=True)
    tags = tag_book.get("tags", {})
    if isinstance(tags, dict):
        records = list(tags.values())
    else:
        records = list(tags or [])
    payload = {
        "version": str(tag_book.get("version", "2")),
        "tags": sorted((_serializable_tag_record(record) for record in records), key=lambda item: item["canonical"]),
    }
    atomic_write_json(base_dir / "tag_book.json", payload, ensure_ascii=False, indent=2, trailing_newline=True)


def tag_book_to_rulebook(tag_book: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    active_book = tag_book if tag_book is not None else load_tag_book()
    rules: dict[str, dict[str, Any]] = {}
    for canonical, record in active_book.get("tags", {}).items():
        if str(record.get("status", "active")).strip().lower() not in ACTIVE_STATUSES:
            continue
        aliases = _suggestion_aliases(record)
        if not aliases:
            continue
        rules[canonical] = {
            "category": str(record.get("category", "")).strip(),
            "aliases": aliases,
            "weight": _safe_int(record.get("suggestion_strength"), default=1),
        }
    return rules


def tag_book_to_registry(tag_book: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    active_book = tag_book if tag_book is not None else load_tag_book()
    registry: dict[str, dict[str, Any]] = {}
    for canonical, record in active_book.get("tags", {}).items():
        registry[canonical] = {
            "label": str(record.get("label") or _label_from_canonical(canonical)).strip(),
            "category": str(record.get("category", "")).strip(),
            "aliases": [str(alias).strip() for alias in record.get("aliases", []) if str(alias).strip()],
            "status": str(record.get("status", "active")).strip() or "active",
        }
    return registry


def save_tag_book_canonical_registry(
    registry: dict[str, dict[str, Any]],
    tag_book_dir: str | Path | None = None,
) -> None:
    tag_book = load_tag_book(tag_book_dir)
    existing = dict(tag_book.get("tags", {}))
    updated_tags: dict[str, dict[str, Any]] = {}
    for raw_canonical, entry in registry.items():
        canonical = normalize_tag(raw_canonical)
        if not canonical or not isinstance(entry, dict):
            continue
        previous = existing.get(canonical, {})
        updated_tags[canonical] = {
            "canonical": canonical,
            "label": str(entry.get("label") or previous.get("label") or _label_from_canonical(canonical)).strip(),
            "category": str(entry.get("category") or previous.get("category") or "other").strip(),
            "aliases": _dedupe_aliases(entry.get("aliases", previous.get("aliases", []))),
            "status": str(entry.get("status") or previous.get("status") or "active").strip(),
            "suggestion_strength": _safe_int(
                previous.get("suggestion_strength") or entry.get("suggestion_strength"),
                default=1,
            ),
            "description": str(previous.get("description", "")),
            "created_from": str(previous.get("created_from", "tag_manager")),
        }
    tag_book["tags"] = updated_tags
    save_tag_book(tag_book, tag_book_dir)


def validate_tag_book(tag_book: dict[str, Any] | None = None) -> list[str]:
    active_book = tag_book if tag_book is not None else load_tag_book()
    warnings: list[str] = []
    raw_records = list(active_book.get("raw_tag_records", []))
    records = [_normalize_tag_record(record) for record in raw_records]
    blocked_terms = _blocked_term_set(active_book)

    canonical_counts = Counter(record["canonical"] for record in records if record.get("canonical"))
    for canonical, count in sorted(canonical_counts.items()):
        if count > 1:
            warnings.append(f"Duplicate canonical tag '{canonical}' appears {count} times.")

    alias_owners: dict[str, set[str]] = {}
    raw_alias_owners: dict[str, set[str]] = {}
    for record in records:
        canonical = record["canonical"]
        if not canonical:
            warnings.append("Tag record is missing canonical.")
            continue
        if record["category"] and record["category"] not in CATEGORY_VALUES:
            warnings.append(f"Tag '{canonical}' uses non-standard category '{record['category']}'.")
        if canonical in blocked_terms:
            warnings.append(f"Tag '{canonical}' matches a blocked term.")
        for raw_alias in _alias_values_for_validation(record):
            alias = normalize_tag(raw_alias)
            if not alias:
                warnings.append(f"Tag '{canonical}' has an empty alias.")
                continue
            alias_owners.setdefault(alias, set()).add(canonical)
            raw_alias_owners.setdefault(str(raw_alias).strip().lower(), set()).add(canonical)
            if alias in blocked_terms:
                warnings.append(f"Alias '{raw_alias}' for '{canonical}' matches a blocked term.")

    for raw_alias, owners in sorted(raw_alias_owners.items()):
        if len(owners) > 1:
            warnings.append(f"Alias '{raw_alias}' is used by multiple canonical tags: {', '.join(sorted(owners))}.")
    for alias, owners in sorted(alias_owners.items()):
        if len(owners) > 1:
            warnings.append(f"Normalized alias '{alias}' is used by multiple canonical tags: {', '.join(sorted(owners))}.")

    return warnings


def explain_tag_book_suggestions(record: dict[str, Any], tag_book: dict[str, Any] | None = None) -> list[dict]:
    active_book = tag_book if tag_book is not None else load_tag_book()
    existing = _existing_tag_identities(record, active_book)
    blocked_terms = _blocked_term_set(active_book)
    suggestions: dict[tuple[str, str], dict[str, Any]] = {}

    for canonical, tag_record in active_book.get("tags", {}).items():
        if str(tag_record.get("status", "active")).strip().lower() not in ACTIVE_STATUSES:
            continue
        if canonical in existing or canonical in blocked_terms:
            continue
        evidence = _collect_alias_evidence(record, _suggestion_aliases(tag_record))
        if not evidence:
            continue
        score = _score_evidence(evidence, _safe_int(tag_record.get("suggestion_strength"), default=1))
        suggestions[("known_canonical", canonical)] = _build_suggestion(
            display=str(tag_record.get("label") or _label_from_canonical(canonical)),
            canonical=canonical,
            category=str(tag_record.get("category", "")),
            kind="known_canonical",
            score=score,
            confidence=_known_confidence(score),
            evidence=evidence,
            reason="Matched an existing canonical tag or alias in the paper metadata.",
        )

    for method_entry in active_book.get("method_lexicon", []):
        suggestion = _candidate_from_method_entry(record, method_entry, active_book, existing, blocked_terms)
        if suggestion:
            suggestions[(suggestion["kind"], suggestion["canonical"])] = suggestion

    for pattern_entry in active_book.get("candidate_patterns", []):
        for suggestion in _candidates_from_pattern(record, pattern_entry, active_book, existing, blocked_terms):
            if suggestion["canonical"] in {item["canonical"] for item in suggestions.values()}:
                continue
            key = (suggestion["kind"], suggestion["canonical"])
            if key not in suggestions:
                suggestions[key] = suggestion

    filtered_suggestions = _suppress_generic_specific_overlaps(list(suggestions.values()))
    return sorted(
        filtered_suggestions,
        key=lambda item: (
            -int(item.get("score", 0)),
            str(item.get("category", "")),
            str(item.get("canonical", "")),
        ),
    )


def group_suggestions_by_category(suggestions: list[dict]) -> dict[str, list[dict]]:
    grouped: dict[str, list[dict]] = {}
    for suggestion in suggestions:
        category = str(suggestion.get("category", "") or "other")
        grouped.setdefault(category, []).append(suggestion)
    return dict(sorted(grouped.items(), key=lambda item: item[0]))


def suggestion_selection_id(suggestion: dict[str, Any]) -> str:
    kind = str(suggestion.get("kind", "known_canonical") or "known_canonical")
    canonical = normalize_tag(suggestion.get("canonical") or suggestion.get("tag") or suggestion.get("display"))
    return f"{kind}:{canonical}"


def selected_suggestion_tag_values(suggestions: list[dict], selected_ids: set[str] | list[str] | tuple[str, ...]) -> list[str]:
    selected = set(selected_ids)
    values: list[str] = []
    seen: set[str] = set()
    for suggestion in suggestions:
        kind = str(suggestion.get("kind", "known_canonical") or "known_canonical")
        value = normalize_tag(suggestion.get("canonical") or suggestion.get("tag") or suggestion.get("display"))
        selectable = bool(suggestion.get("selectable", kind in SELECTABLE_SUGGESTION_KINDS))
        if kind not in SELECTABLE_SUGGESTION_KINDS or not value:
            continue
        if not selectable or str(suggestion.get("quality", "")) == "rejected":
            continue
        if suggestion_selection_id(suggestion) not in selected or value in seen:
            continue
        values.append(value)
        seen.add(value)
    return values


def extract_evidence_snippet(text: str, matched_text: str, max_chars: int = 240) -> str:
    source = " ".join(str(text or "").split())
    match_text = str(matched_text or "").strip()
    if not source or not match_text or max_chars <= 0:
        return ""

    match = re.search(re.escape(match_text), source, flags=re.IGNORECASE)
    if not match:
        return source[:max_chars].rstrip()

    sentence_start = max(source.rfind(".", 0, match.start()), source.rfind("!", 0, match.start()), source.rfind("?", 0, match.start()))
    start = sentence_start + 1 if sentence_start >= 0 else 0
    while start < len(source) and source[start].isspace():
        start += 1

    sentence_ends = [index for index in (source.find(".", match.end()), source.find("!", match.end()), source.find("?", match.end())) if index >= 0]
    end = min(sentence_ends) + 1 if sentence_ends else len(source)
    snippet = source[start:end].strip()

    if len(snippet) <= max_chars:
        return snippet

    match_offset = match.start() - start
    half_window = max(max_chars // 2, len(match_text))
    window_start = max(0, match_offset - half_window)
    window_end = min(len(snippet), window_start + max_chars)
    window_start = max(0, window_end - max_chars)
    clipped = snippet[window_start:window_end].strip()
    if window_start > 0:
        clipped = "..." + clipped.lstrip()
    if window_end < len(snippet):
        clipped = clipped.rstrip() + "..."
    return clipped


def preview_near_duplicate_tags(
    tag_book: dict[str, Any] | None = None,
    *,
    threshold: float = 0.9,
) -> list[dict[str, Any]]:
    active_book = tag_book if tag_book is not None else load_tag_book()
    tags = sorted(active_book.get("tags", {}))
    preview: list[dict[str, Any]] = []
    for index, left in enumerate(tags):
        for right in tags[index + 1 :]:
            similarity = SequenceMatcher(None, left, right).ratio()
            if similarity >= threshold:
                preview.append(
                    {
                        "left": left,
                        "right": right,
                        "similarity": round(similarity, 3),
                        "reason": "Canonical tags are textually similar; review before any manual merge.",
                    }
                )
    return preview


def clean_candidate_phrase(raw_phrase: Any) -> dict[str, Any]:
    original = str(raw_phrase or "")
    phrase = _normalize_candidate_spacing(original)
    cleanup_notes: list[str] = []

    stripped_phrase, stripped_prefixes = _strip_candidate_prefixes(phrase)
    if stripped_prefixes:
        phrase = stripped_phrase
        cleanup_notes.extend(f"stripped source prefix: {prefix}" for prefix in stripped_prefixes)

    phrase, removed_tails = _strip_boilerplate_tails(phrase)
    cleanup_notes.extend(f"removed boilerplate tail: {tail}" for tail in removed_tails)

    phrase, removed_article = _strip_leading_article(phrase)
    if removed_article:
        cleanup_notes.append(f"removed leading article: {removed_article}")

    phrase = _normalize_candidate_spacing(phrase)
    canonical = normalize_tag(phrase)
    structural_rejection = _candidate_structural_rejection(phrase)
    return {
        "original": original,
        "cleaned": phrase,
        "canonical": canonical,
        "cleanup_notes": cleanup_notes,
        "rejected": bool(structural_rejection),
        "rejection_reason": structural_rejection,
    }


def score_candidate_quality(
    raw_phrase: Any,
    evidence: list[dict[str, Any]] | None = None,
    *,
    category: str = "",
    tag_book: dict[str, Any] | None = None,
    blocked_terms: set[str] | None = None,
    allow_single_token: bool = False,
) -> dict[str, Any]:
    cleanup = clean_candidate_phrase(raw_phrase)
    phrase = str(cleanup["cleaned"])
    canonical = str(cleanup["canonical"])
    evidence = list(evidence or [])
    active_book = tag_book if tag_book is not None else {"tags": {}, "blocked_terms": []}
    active_blocked_terms = blocked_terms if blocked_terms is not None else _blocked_term_set(active_book)

    rejection = ""
    duplicate_of = ""
    cleanup_rejection = str(cleanup["rejection_reason"])
    if cleanup_rejection and not (allow_single_token and cleanup_rejection == "too short or low information"):
        rejection = cleanup_rejection
    elif not allow_single_token and len(_candidate_words(phrase)) < 2:
        rejection = "too short or low information"
    elif canonical in active_blocked_terms or _contains_blocked_token(canonical, active_blocked_terms):
        rejection = "blocked term"
    elif _generic_model_phrase(phrase):
        rejection = "generic model phrase"
    else:
        duplicate_of = _duplicate_canonical_for_candidate(canonical, active_book)
        if duplicate_of:
            rejection = f"already covered by canonical tag: {duplicate_of}"

    score = _candidate_quality_points(phrase, evidence, category)
    if rejection:
        quality = "rejected"
        score = 0
    elif score >= 80:
        quality = "high"
    elif score >= 60:
        quality = "medium"
    elif score >= 35:
        quality = "weak"
    else:
        quality = "rejected"
        rejection = "low candidate quality"
        score = 0

    return {
        **cleanup,
        "quality": quality,
        "quality_score": int(score),
        "quality_reason": rejection or _candidate_quality_reason(phrase, evidence, category, quality),
        "duplicate_of_canonical": duplicate_of,
        "selectable": quality != "rejected",
        "alias_suggestions": _candidate_alias_suggestions(cleanup["original"], phrase),
    }


def _candidate_from_method_entry(
    record: dict[str, Any],
    method_entry: dict[str, Any],
    tag_book: dict[str, Any],
    existing: set[str],
    blocked_terms: set[str],
) -> dict[str, Any] | None:
    canonical = normalize_tag(method_entry.get("canonical") or method_entry.get("display"))
    if not canonical or canonical in existing or canonical in tag_book.get("tags", {}) or canonical in blocked_terms:
        return None
    aliases = _dedupe_aliases([method_entry.get("display", ""), *list(method_entry.get("aliases", []))])
    evidence = _collect_alias_evidence(record, aliases)
    if not evidence:
        return None
    score = _score_evidence(evidence, _safe_int(method_entry.get("suggestion_strength"), default=4))
    quality = score_candidate_quality(
        method_entry.get("display") or canonical,
        evidence,
        category=str(method_entry.get("category", "method") or "method"),
        tag_book=tag_book,
        blocked_terms=blocked_terms,
        allow_single_token=True,
    )
    if quality["quality"] == "rejected":
        return None
    suggestion = _build_suggestion(
        display=str(method_entry.get("display") or _label_from_canonical(canonical)),
        canonical=canonical,
        category=str(method_entry.get("category", "method") or "method"),
        kind="new_candidate",
        score=score + int(quality["quality_score"]),
        confidence=float(method_entry.get("confidence", _candidate_confidence(score))),
        evidence=evidence,
        reason=str(method_entry.get("reason", "Matched a method lexicon entry not yet in the Tag Book.")),
    )
    return _with_candidate_quality(suggestion, quality)


def _candidates_from_pattern(
    record: dict[str, Any],
    pattern_entry: dict[str, Any],
    tag_book: dict[str, Any],
    existing: set[str],
    blocked_terms: set[str],
) -> list[dict[str, Any]]:
    pattern = str(pattern_entry.get("pattern", "") or "")
    if not pattern:
        return []
    try:
        compiled = re.compile(pattern, flags=re.IGNORECASE)
    except re.error:
        return []

    source_fields = tuple(pattern_entry.get("source_fields", []) or SOURCE_FIELDS)
    candidates: dict[str, dict[str, Any]] = {}
    rejected_candidates: dict[str, dict[str, Any]] = {}
    for field in source_fields:
        text = _record_field_text(record.get(field, ""))
        if not text:
            continue
        for match in compiled.finditer(text):
            raw_matched_text = str(match.group(1) if match.groups() else match.group(0)).strip(" .,:;()[]{}")
            cleanup = clean_candidate_phrase(raw_matched_text)
            matched_text = str(cleanup["cleaned"])
            canonical = str(cleanup["canonical"])
            evidence = {
                "source": field,
                "source_label": _source_label(field),
                "matched_text": matched_text,
                "raw_matched_text": raw_matched_text,
                "alias": matched_text,
                "weight": SOURCE_WEIGHTS.get(field, 0),
                "snippet": extract_evidence_snippet(text, raw_matched_text),
            }
            quality = score_candidate_quality(
                raw_matched_text,
                [evidence],
                category=str(pattern_entry.get("category", "method") or "method"),
                tag_book=tag_book,
                blocked_terms=blocked_terms,
            )
            canonical = str(quality["canonical"] or canonical)
            matched_text = str(quality["cleaned"] or matched_text)
            evidence["matched_text"] = matched_text
            evidence["alias"] = matched_text

            if canonical in existing:
                continue
            if quality["quality"] == "rejected":
                rejected = _build_rejected_candidate_suggestion(pattern_entry, quality, evidence)
                if rejected and canonical not in candidates:
                    rejected_candidates.setdefault(canonical or str(id(rejected)), rejected)
                continue

            current = candidates.setdefault(
                canonical,
                _build_suggestion(
                    display=matched_text,
                    canonical=canonical,
                    category=str(pattern_entry.get("category", "method") or "method"),
                    kind=str(pattern_entry.get("kind", "weak_candidate") or "weak_candidate"),
                    score=0,
                    confidence=float(pattern_entry.get("confidence", 0.4)),
                    evidence=[],
                    reason=str(pattern_entry.get("reason", "Pattern matched a plausible candidate tag.")),
                ),
            )
            current["evidence"].append(evidence)
            current["matched_fields"] = sorted(
                {item["source"] for item in current["evidence"]},
                key=_source_sort_key,
            )
            evidence_score = _score_evidence(
                current["evidence"],
                _safe_int(pattern_entry.get("suggestion_strength"), default=2),
            )
            quality = score_candidate_quality(
                current["display"],
                current["evidence"],
                category=str(pattern_entry.get("category", "method") or "method"),
                tag_book=tag_book,
                blocked_terms=blocked_terms,
            )
            current["score"] = evidence_score + int(quality["quality_score"])
            current["confidence"] = _candidate_confidence_from_quality(
                str(quality["quality"]),
                int(quality["quality_score"]),
            )
            _with_candidate_quality(current, quality)
            current["source"] = current["matched_fields"][0] if current["matched_fields"] else ""
            current["source_label"] = _source_label(current["source"]) if current["source"] else ""
            current["matched_text"] = str(current["evidence"][0]["matched_text"]) if current["evidence"] else ""
    return list(candidates.values()) + list(rejected_candidates.values())


def _build_suggestion(
    *,
    display: str,
    canonical: str,
    category: str,
    kind: str,
    score: int,
    confidence: float,
    evidence: list[dict[str, Any]],
    reason: str,
) -> dict[str, Any]:
    matched_fields = sorted({str(item.get("source", "")) for item in evidence if item.get("source")}, key=_source_sort_key)
    matched_text = str(evidence[0].get("matched_text", "")) if evidence else ""
    source_label = _source_label(matched_fields[0]) if matched_fields else ""
    return {
        "display": display,
        "canonical": canonical,
        "tag": canonical,
        "category": category,
        "kind": kind,
        "confidence": round(float(confidence), 3),
        "score": int(score),
        "source": matched_fields[0] if matched_fields else "",
        "source_label": source_label,
        "matched_text": matched_text,
        "evidence": evidence,
        "reason": reason,
        "matched_fields": matched_fields,
    }


def _suppress_generic_specific_overlaps(suggestions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    canonicals = {str(item.get("canonical", "")) for item in suggestions}
    suppressed: set[str] = set()
    for generic, specifics in SPECIFICITY_SUPPRESSIONS.items():
        present_specifics = specifics & canonicals
        if not present_specifics or generic not in canonicals:
            continue
        generic_item = next(item for item in suggestions if item.get("canonical") == generic)
        if _specific_overlap_supports_suppression(generic_item, present_specifics):
            suppressed.add(generic)
    return [item for item in suggestions if str(item.get("canonical", "")) not in suppressed]


def _specific_overlap_supports_suppression(generic_item: dict[str, Any], present_specifics: set[str]) -> bool:
    evidence_text = " ".join(
        str(part)
        for evidence in generic_item.get("evidence", [])
        if isinstance(evidence, dict)
        for part in (evidence.get("snippet", ""), evidence.get("matched_text", ""))
    ).lower()
    if "lateral root" in evidence_text and ("lateral-root" in present_specifics or "lateral-root-development" in present_specifics):
        return True
    if "root apical meristem" in evidence_text and "root-apical-meristem" in present_specifics:
        return True
    return False


def _with_candidate_quality(suggestion: dict[str, Any], quality: dict[str, Any]) -> dict[str, Any]:
    suggestion["quality"] = str(quality.get("quality", "weak"))
    suggestion["quality_score"] = int(quality.get("quality_score", 0) or 0)
    suggestion["quality_reason"] = str(quality.get("quality_reason", ""))
    suggestion["cleanup_notes"] = list(quality.get("cleanup_notes", []))
    suggestion["alias_suggestions"] = list(quality.get("alias_suggestions", []))
    suggestion["duplicate_of_canonical"] = str(quality.get("duplicate_of_canonical", ""))
    suggestion["selectable"] = bool(quality.get("selectable", True))
    suggestion["promotion_note"] = "Review aliases before promoting this candidate to the Tag Book."
    if suggestion["quality"] == "rejected":
        suggestion["kind"] = REJECTED_SUGGESTION_KIND
        suggestion["selectable"] = False
        suggestion["rejection_reason"] = suggestion["quality_reason"]
    elif str(suggestion.get("kind", "")) in {"new_candidate", "weak_candidate"}:
        suggestion["kind"] = "new_candidate" if suggestion["quality"] in {"high", "medium"} else "weak_candidate"
    return suggestion


def _build_rejected_candidate_suggestion(
    pattern_entry: dict[str, Any],
    quality: dict[str, Any],
    evidence: dict[str, Any],
) -> dict[str, Any] | None:
    canonical = str(quality.get("canonical", "") or normalize_tag(quality.get("cleaned", "")))
    display = str(quality.get("cleaned", "") or quality.get("original", "")).strip()
    if not canonical and not display:
        return None
    suggestion = _build_suggestion(
        display=display or canonical,
        canonical=canonical,
        category=str(pattern_entry.get("category", "method") or "method"),
        kind=REJECTED_SUGGESTION_KIND,
        score=0,
        confidence=0.0,
        evidence=[evidence],
        reason=str(quality.get("quality_reason", "Rejected by candidate hygiene.")),
    )
    return _with_candidate_quality(suggestion, quality)


def _collect_alias_evidence(record: dict[str, Any], aliases: list[str]) -> list[dict[str, Any]]:
    evidence: list[dict[str, Any]] = []
    for field in SOURCE_FIELDS:
        text = _record_field_text(record.get(field, ""))
        if not text:
            continue
        match = _first_alias_match(text, aliases)
        if match:
            evidence.append(
                {
                    "source": field,
                    "source_label": _source_label(field),
                    "matched_text": match["matched_text"],
                    "alias": match["alias"],
                    "weight": SOURCE_WEIGHTS.get(field, 0),
                    "snippet": extract_evidence_snippet(text, match["matched_text"]),
                }
            )
    return evidence


def _first_alias_match(text: str, aliases: list[str]) -> dict[str, str]:
    for alias in sorted(aliases, key=lambda value: (-len(str(value)), str(value).lower())):
        needle = str(alias).strip()
        if not needle:
            continue
        pattern = r"(?<![a-z0-9])" + re.escape(needle).replace(r"\ ", r"\s+") + r"(?![a-z0-9])"
        match = re.search(pattern, text, flags=re.IGNORECASE)
        if match:
            return {"matched_text": match.group(0), "alias": needle}
    return {}


def _score_evidence(evidence: list[dict[str, Any]], suggestion_strength: int) -> int:
    fields = {str(item.get("source", "")) for item in evidence}
    return sum(SOURCE_WEIGHTS.get(field, 0) * suggestion_strength for field in fields)


def _known_confidence(score: int) -> float:
    return min(0.99, max(0.5, 0.45 + (score / 100)))


def _candidate_confidence(score: int) -> float:
    return min(0.8, max(0.45, 0.3 + (score / 100)))


def _normalize_candidate_spacing(value: str) -> str:
    text = str(value or "")
    text = re.sub(r"[\u2010-\u2015]", "-", text)
    text = re.sub(r"\s*/\s*", "/", text)
    text = re.sub(r"(?<=\w)\s*-\s*(?=\w)", "-", text)
    text = re.sub(r"[_\t\r\n]+", " ", text)
    text = re.sub(r"\s+", " ", text)
    return text.strip(" \t\r\n.,;:!?()[]{}'\"")


def _strip_candidate_prefixes(phrase: str) -> tuple[str, list[str]]:
    text = phrase
    stripped: list[str] = []
    prefix_pattern = "|".join(re.escape(prefix).replace(r"\ ", r"\s+") for prefix in sorted(SECTION_PREFIXES, key=len, reverse=True))
    while True:
        match = re.match(
            rf"^(?:#+\s*)?(?P<prefix>{prefix_pattern})\b\s*(?:[/:\.\-]+|\s+)?\s*",
            text,
            flags=re.IGNORECASE,
        )
        if not match:
            return text, stripped
        prefix = " ".join(match.group("prefix").lower().split())
        stripped.append(prefix)
        text = text[match.end() :].strip(" \t\r\n.,;:!?-")
        text, article = _strip_leading_article(text)
        if article:
            stripped.append(article)


def _strip_boilerplate_tails(phrase: str) -> tuple[str, list[str]]:
    text = phrase
    removed: list[str] = []
    changed = True
    while changed:
        changed = False
        for pattern in BOILERPLATE_TAIL_PATTERNS:
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if not match:
                continue
            removed.append(match.group(0).strip())
            text = text[: match.start()].strip(" \t\r\n.,;:!?-")
            changed = True
            break
    return text, removed


def _strip_leading_article(phrase: str) -> tuple[str, str]:
    match = re.match(r"^(a|an|the)\s+(.+)$", phrase.strip(), flags=re.IGNORECASE)
    if not match:
        return phrase, ""
    return match.group(2).strip(), match.group(1).lower()


def _candidate_structural_rejection(phrase: str) -> str:
    words = _candidate_words(phrase)
    canonical = normalize_tag(phrase)
    if not canonical:
        return "empty after cleanup"
    if len(canonical) <= 2:
        return "too short or low information"
    if len(words) > 5:
        return "too long"
    if not words:
        return "empty after cleanup"
    if _punctuation_ratio(phrase) > 0.18:
        return "punctuation-heavy"
    if len(words) >= 3 and _stopword_ratio(words) >= 0.5:
        return "stopword-heavy"
    if _sentence_like(phrase, words):
        return "sentence-like phrase"
    return ""


def _candidate_quality_points(phrase: str, evidence: list[dict[str, Any]], category: str) -> int:
    words = _candidate_words(phrase)
    sources = {str(item.get("source", "")) for item in evidence if item.get("source")}
    score = 30
    if _method_like_phrase(phrase, category):
        score += 20
    if _modality_like_phrase(phrase):
        score += 16
    if len(words) in (2, 3):
        score += 8
    elif len(words) == 4:
        score += 4

    source_points = {
        "keywords": 18,
        "pdf_keywords": 18,
        "title": 16,
        "note_methods": 15,
        "note_evidence": 10,
        "abstract": 6,
        "pdf_abstract": 8,
        "pdf_section_headings": 8,
        "markdown_text": 4,
        "extracted_text_preview": 3,
        "extracted_text": 3,
        "filename": 1,
    }
    score += sum(source_points.get(source, 0) for source in sources)
    if sources and sources <= {"abstract", "markdown_text", "extracted_text_preview", "extracted_text"}:
        score -= 8
    if _generic_noun_phrase(phrase):
        score -= 12
    return max(0, min(100, score))


def _candidate_quality_reason(
    phrase: str,
    evidence: list[dict[str, Any]],
    category: str,
    quality: str,
) -> str:
    reasons: list[str] = []
    if _method_like_phrase(phrase, category):
        reasons.append("method-like phrase")
    if _modality_like_phrase(phrase):
        reasons.append("data modality signal")
    preferred_sources = [
        _source_label(source)
        for source in ("keywords", "title", "note_methods")
        if any(str(item.get("source", "")) == source for item in evidence)
    ]
    if preferred_sources:
        reasons.append("preferred source: " + ", ".join(preferred_sources))
    if not reasons and quality == "weak":
        reasons.append("limited source or phrase specificity")
    return "; ".join(reasons) if reasons else quality


def _candidate_words(phrase: str) -> list[str]:
    return [
        match.group(0).lower()
        for match in re.finditer(r"[A-Za-z0-9]+(?:[+/\-][A-Za-z0-9]+)*", str(phrase or ""))
    ]


def _punctuation_ratio(phrase: str) -> float:
    text = str(phrase or "")
    if not text:
        return 0.0
    punctuation = re.findall(r"[^A-Za-z0-9\s/\-+]", text)
    return len(punctuation) / max(1, len(text))


def _stopword_ratio(words: list[str]) -> float:
    if not words:
        return 1.0
    return sum(word in STOPWORDS for word in words) / len(words)


def _sentence_like(phrase: str, words: list[str]) -> bool:
    text = str(phrase or "").strip()
    if re.search(r"[.!?]\s+\w", text):
        return True
    if text.endswith((".", "!", "?")) and len(words) > 3:
        return True
    return any(word in {"shows", "showed", "using", "uses", "used", "were", "was"} for word in words)


def _method_like_phrase(phrase: str, category: str) -> bool:
    words = set(_candidate_words(phrase))
    if str(category or "").strip() in {"assay", "method", "model_or_algorithm", "dataset"}:
        return True
    return bool(words & METHOD_LIKE_TERMS) or any(
        token.endswith("-seq") or token.endswith("omics") for token in words
    )


def _modality_like_phrase(phrase: str) -> bool:
    words = set(_candidate_words(phrase))
    canonical = normalize_tag(phrase)
    return bool(words & MODALITY_LIKE_TERMS) or any(term in canonical for term in MODALITY_LIKE_TERMS)


def _generic_model_phrase(phrase: str) -> bool:
    words = set(_candidate_words(phrase))
    return bool(words) and words <= GENERIC_MODEL_TERMS and "model" in words


def _generic_noun_phrase(phrase: str) -> bool:
    words = set(_candidate_words(phrase))
    generic = {"analysis", "approach", "data", "feature", "gene", "level", "levels", "method", "model", "task", "tasks"}
    return bool(words) and words <= generic


def _duplicate_canonical_for_candidate(canonical: str, tag_book: dict[str, Any]) -> str:
    if not canonical:
        return ""
    if canonical in tag_book.get("tags", {}):
        return canonical
    return _tag_book_alias_index(tag_book).get(canonical, "")


def _candidate_alias_suggestions(original: Any, cleaned: Any) -> list[str]:
    return _dedupe_aliases([str(cleaned or ""), str(original or "")])


def _candidate_confidence_from_quality(quality: str, score: int) -> float:
    if quality == "high":
        return 0.78
    if quality == "medium":
        return 0.62
    if quality == "weak":
        return 0.42
    return 0.0


def _existing_tag_identities(record: dict[str, Any], tag_book: dict[str, Any]) -> set[str]:
    alias_index = _tag_book_alias_index(tag_book)
    identities: set[str] = set()
    for raw_tag in _raw_tag_values(record.get("tags", "")):
        normalized = normalize_tag(raw_tag)
        if normalized:
            identities.add(alias_index.get(normalized, normalized))
    return identities


def _tag_book_alias_index(tag_book: dict[str, Any]) -> dict[str, str]:
    owners_by_alias: dict[str, set[str]] = {}
    for canonical, record in tag_book.get("tags", {}).items():
        for raw_alias in _alias_values_for_validation(record):
            alias = normalize_tag(raw_alias)
            if alias:
                owners_by_alias.setdefault(alias, set()).add(canonical)
    return {
        alias: next(iter(owners))
        for alias, owners in owners_by_alias.items()
        if len(owners) == 1
    }


def _blocked_term_set(tag_book: dict[str, Any]) -> set[str]:
    return {normalize_tag(term) for term in tag_book.get("blocked_terms", []) if normalize_tag(term)}


def _contains_blocked_token(canonical: str, blocked_terms: set[str]) -> bool:
    tokens = set(canonical.split("-"))
    return canonical in blocked_terms or any(term in tokens for term in blocked_terms if len(term) > 2)


def _suggestion_aliases(record: dict[str, Any]) -> list[str]:
    return _dedupe_aliases(
        [
            *list(record.get("aliases", []) or []),
            record.get("label", ""),
            record.get("canonical", ""),
        ]
    )


def _alias_values_for_validation(record: dict[str, Any]) -> list[str]:
    return [
        str(record.get("canonical", "")),
        str(record.get("label", "")),
        *[str(alias) for alias in record.get("aliases", []) or []],
    ]


def _read_json(path: Path, default: Any) -> Any:
    return read_json_file(path, default=default, store_name=f"Tag Book JSON file {path.name}")


def _load_method_lexicon(path: Path) -> list[dict[str, Any]]:
    raw = _read_json(path, {"entries": []})
    entries = raw.get("entries", raw) if isinstance(raw, dict) else raw
    return [entry for entry in entries if isinstance(entry, dict)]


def _load_blocked_terms(path: Path) -> list[str]:
    raw = _read_json(path, {"terms": []})
    terms = raw.get("terms", raw) if isinstance(raw, dict) else raw
    blocked_terms: list[str] = []
    for term in terms if isinstance(terms, list) else []:
        if isinstance(term, dict):
            value = str(term.get("term", "")).strip()
        else:
            value = str(term).strip()
        if value:
            blocked_terms.append(value)
    return blocked_terms


def _load_candidate_patterns(path: Path) -> list[dict[str, Any]]:
    raw = _read_json(path, {"patterns": []})
    patterns = raw.get("patterns", raw) if isinstance(raw, dict) else raw
    return [pattern for pattern in patterns if isinstance(pattern, dict)]


def _coerce_raw_tag_records(raw_tag_book: Any) -> list[dict[str, Any]]:
    if isinstance(raw_tag_book, dict):
        raw_tags = raw_tag_book.get("tags", raw_tag_book)
    else:
        raw_tags = raw_tag_book

    records: list[dict[str, Any]] = []
    if isinstance(raw_tags, dict):
        for canonical, entry in raw_tags.items():
            if not isinstance(entry, dict):
                continue
            record = dict(entry)
            record.setdefault("canonical", canonical)
            records.append(record)
    elif isinstance(raw_tags, list):
        records.extend(dict(entry) for entry in raw_tags if isinstance(entry, dict))
    return records


def _normalize_tag_record(raw_record: dict[str, Any]) -> dict[str, Any]:
    canonical = normalize_tag(raw_record.get("canonical") or raw_record.get("label"))
    label = str(raw_record.get("label") or _label_from_canonical(canonical)).strip()
    return {
        "canonical": canonical,
        "label": label,
        "category": str(raw_record.get("category", "other") or "other").strip(),
        "aliases": _dedupe_aliases(raw_record.get("aliases", [])),
        "status": str(raw_record.get("status", "active") or "active").strip(),
        "suggestion_strength": _safe_int(raw_record.get("suggestion_strength", raw_record.get("weight")), default=1),
        "description": str(raw_record.get("description", "")),
        "created_from": str(raw_record.get("created_from", "")),
    }


def _serializable_tag_record(record: dict[str, Any]) -> dict[str, Any]:
    normalized = _normalize_tag_record(record)
    return {
        "canonical": normalized["canonical"],
        "label": normalized["label"],
        "category": normalized["category"],
        "aliases": normalized["aliases"],
        "status": normalized["status"],
        "suggestion_strength": normalized["suggestion_strength"],
        "description": normalized["description"],
        "created_from": normalized["created_from"],
    }


def _legacy_tag_records(
    *,
    rule_path: str | Path | None = None,
    canonical_tag_path: str | Path | None = None,
) -> list[dict[str, Any]]:
    raw_rules = _read_json(Path(rule_path) if rule_path is not None else LEGACY_RULE_PATH, {})
    raw_registry = _read_json(
        Path(canonical_tag_path) if canonical_tag_path is not None else LEGACY_CANONICAL_TAG_PATH,
        {},
    )
    rules = raw_rules if isinstance(raw_rules, dict) else {}
    registry = raw_registry if isinstance(raw_registry, dict) else {}
    records: list[dict[str, Any]] = []
    for raw_canonical in sorted(set(rules) | set(registry), key=lambda value: normalize_tag(value)):
        canonical = normalize_tag(raw_canonical)
        if not canonical:
            continue
        rule = rules.get(raw_canonical, {})
        registry_entry = registry.get(raw_canonical, registry.get(canonical, {}))
        if not isinstance(rule, dict):
            rule = {}
        if not isinstance(registry_entry, dict):
            registry_entry = {}
        aliases = _dedupe_aliases(
            [
                *list(rule.get("aliases", []) if isinstance(rule.get("aliases"), list) else []),
                *list(registry_entry.get("aliases", []) if isinstance(registry_entry.get("aliases"), list) else []),
            ]
        )
        records.append(
            {
                "canonical": canonical,
                "label": str(registry_entry.get("label") or _label_from_canonical(canonical)),
                "category": str(registry_entry.get("category") or rule.get("category") or "other"),
                "aliases": aliases,
                "status": str(registry_entry.get("status", "active") or "active"),
                "suggestion_strength": _safe_int(rule.get("weight", 1), default=1),
                "description": "",
                "created_from": "legacy_config",
            }
        )
    return records


def _dedupe_aliases(values: Any) -> list[str]:
    if not isinstance(values, list):
        values = [values] if values else []
    aliases: list[str] = []
    seen: set[str] = set()
    for value in values:
        alias = str(value).strip()
        if alias and alias not in seen:
            aliases.append(alias)
            seen.add(alias)
    return aliases


def _raw_tag_values(value: Any) -> list[str]:
    if isinstance(value, (list, tuple, set)):
        return [str(item).strip() for item in value if str(item).strip()]
    return [raw.strip() for raw in re.split(r"[,;]", str(value or "")) if raw.strip()]


def _record_field_text(value: Any) -> str:
    if isinstance(value, list):
        return " ".join(str(item) for item in value)
    if isinstance(value, dict):
        return " ".join(str(item) for item in value.values())
    return str(value or "")


def _safe_int(value: Any, *, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _label_from_canonical(canonical: str) -> str:
    return " ".join(part.capitalize() for part in str(canonical).split("-") if part)


def _source_sort_key(field: str) -> tuple[int, str]:
    return (-SOURCE_WEIGHTS.get(field, 0), field)


def _source_label(field: str) -> str:
    return SOURCE_LABELS.get(field, field.replace("_", " "))
