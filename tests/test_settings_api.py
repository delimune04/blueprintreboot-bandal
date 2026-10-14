from __future__ import annotations

import csv
import json
import os
from copy import deepcopy
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from api import dependencies
from api.adapters import adapt_settings_summary
from api.main import UNAVAILABLE_DETAIL, create_app
from api.schemas import SettingsSummaryResponse
from config.contact import APP_VERSION
from services import settings_read_model
from services.backup_snapshot import create_backup_snapshot


def _write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def _write_index(path: Path, records: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = ["paper_id", "filename", "filepath"]
    with path.open("w", encoding="utf-8", newline="") as target:
        writer = csv.DictWriter(target, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(records)


def _workspace_paths(root: Path) -> dict[str, Path]:
    return {
        "index_csv": root / "data" / "paper_index.csv",
        "papers_dir": root / "papers",
        "notes_dir": root / "notes",
        "note_blocks_dir": root / "data" / "note_blocks",
        "projects_dir": root / "data" / "projects",
        "tag_book_dir": root / "config" / "tag_book",
        "legacy_rule_path": root / "config" / "tag_rules.json",
        "legacy_canonical_tag_path": root / "config" / "canonical_tags.json",
        "exports_dir": root / "exports",
    }


def _build(root: Path, *, app_version: str = APP_VERSION):
    return settings_read_model.build_settings_summary(
        **_workspace_paths(root),
        app_version=app_version,
    )


def _client_for(summary) -> TestClient:
    application = create_app()
    application.dependency_overrides[dependencies.get_settings_summary] = (
        lambda: deepcopy(summary)
    )
    return TestClient(application)


def _seed_populated_workspace(root: Path) -> None:
    paths = _workspace_paths(root)
    for directory_name in (
        "papers_dir",
        "notes_dir",
        "note_blocks_dir",
        "projects_dir",
        "tag_book_dir",
        "exports_dir",
    ):
        paths[directory_name].mkdir(parents=True, exist_ok=True)
    indexed_pdf = paths["papers_dir"] / "indexed-private-name.pdf"
    indexed_pdf.write_bytes(b"%PDF-1.4 private content is never read")
    (paths["papers_dir"] / "unindexed-private-name.pdf").write_bytes(
        b"%PDF-1.4 other private content"
    )
    _write_index(
        paths["index_csv"],
        [
            {
                "paper_id": "paper-1",
                "filename": indexed_pdf.name,
                "filepath": str(indexed_pdf),
            },
            {
                "paper_id": "paper-2",
                "filename": "missing-private-name.pdf",
                "filepath": r"C:\Users\private-user\missing-private-name.pdf",
            },
        ],
    )
    (paths["notes_dir"] / "paper-1.md").write_text(
        "# secret private note content",
        encoding="utf-8",
    )
    (paths["notes_dir"] / "orphan-private-note.md").write_text(
        "token=private-token-value",
        encoding="utf-8",
    )
    _write_json(
        paths["note_blocks_dir"] / "paper-1.json",
        [{"id": "block-1", "paper_id": "paper-1", "block_type": "summary", "text": "private block content"}],
    )
    _write_json(
        paths["note_blocks_dir"] / "orphan-private-block.json",
        [{"id": "block-orphan", "paper_id": "orphan-private-block", "block_type": "summary", "text": "private orphan block"}],
    )
    _write_json(
        paths["projects_dir"] / "projects.json",
        [{"id": "project-1", "name": "/home/private-user/private-project", "status": "active", "priority": "normal"}],
    )
    _write_json(
        paths["projects_dir"] / "project_links.json",
        [
            {
                "id": "link-1",
                "project_id": "project-1",
                "target_type": "note_block",
                "target_id": "block-1",
                "paper_id": "paper-1",
                "link_type": "related",
                "note": "private link note",
            },
            {
                "id": "link-2",
                "project_id": "missing-project",
                "target_type": "paper",
                "target_id": "missing-paper",
                "paper_id": "missing-paper",
                "link_type": "related",
                "note": "hostname-private-machine",
            },
        ],
    )
    _write_json(
        paths["index_csv"].parent / "tag_candidate_reviews.json",
        {
            "version": "1",
            "papers": {
                "paper-1": {
                    "candidates": [
                        {
                            "candidate_id": "candidate-1",
                            "tag_text": "method",
                            "normalized_tag": "method",
                            "state": "unresolved",
                            "evidence": [],
                        }
                    ]
                }
            },
        },
    )
    _write_json(
        paths["tag_book_dir"] / "tag_book.json",
        {
            "version": "2",
            "tags": [
                {"canonical": "one", "label": "Private tag one"},
                {"canonical": "two", "label": "Private tag two"},
            ],
        },
    )


def _resource(body: dict[str, object], code: str) -> dict[str, object]:
    resources = body["workspace"]["resources"]
    return next(item for item in resources if item["code"] == code)


def _issue(body: dict[str, object], code: str) -> dict[str, object]:
    issues = body["data_integrity"]["issues"]
    return next(item for item in issues if item["code"] == code)


def test_populated_settings_summary_is_strict_safe_and_uses_real_aggregates(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _seed_populated_workspace(tmp_path)
    corrupt_path = tmp_path / "data" / "settings.json"
    corrupt_path.write_text(
        '{"secret": "raw-secret-value", "path": "C:\\Users\\private-user"',
        encoding="utf-8",
    )
    snapshot = tmp_path / "exports" / "blueprint_snapshot_private-name.zip"
    snapshot.write_bytes(b"snapshot bytes are not inspected")
    os.utime(snapshot, (1_700_000_000, 1_700_000_000))
    monkeypatch.setenv("BLUEPRINT_PRIVATE_VALUE", "environment-secret-value")

    response = _client_for(_build(tmp_path)).get("/settings/summary")

    assert response.status_code == 200
    body = response.json()
    assert SettingsSummaryResponse.model_validate(body)
    assert set(body) == {
        "application",
        "workspace",
        "data_integrity",
        "backup_readiness",
    }
    assert body["application"]["product_version"] == APP_VERSION
    assert body["application"]["api_state"] == "available"
    assert _resource(body, "papers")["count"] == 2
    assert _resource(body, "notes")["count"] == 2
    assert _resource(body, "projects")["count"] == 1
    assert _resource(body, "tags")["count"] == 2
    assert _resource(body, "note_blocks")["count"] == 2
    assert _resource(body, "project_links")["count"] == 2
    assert _resource(body, "tag_candidate_reviews")["count"] == 1
    assert _issue(body, "missing_pdfs")["count"] == 1
    assert _issue(body, "unindexed_pdfs")["count"] == 1
    assert _issue(body, "orphan_notes")["count"] == 1
    assert _issue(body, "orphan_note_blocks")["count"] == 1
    assert _issue(body, "orphan_project_links")["count"] == 1
    assert _issue(body, "corrupt_json")["count"] == 1
    assert body["backup_readiness"]["state"] == "warning"
    assert body["backup_readiness"]["snapshot_available"] is False
    assert body["backup_readiness"]["last_updated_at"] is None
    serialized = response.text
    for private_value in (
        "private-user",
        "/home/",
        "indexed-private-name.pdf",
        "unindexed-private-name.pdf",
        "orphan-private-note",
        "private-project",
        "private tag",
        "private block",
        "private link",
        "hostname-private-machine",
        "raw-secret-value",
        "environment-secret-value",
        "private-token-value",
        "snapshot_private-name",
        "sha256",
        "filepath",
        "source_paths",
        "snapshot_path",
        "target_path",
        "workspace_relative_path",
    ):
        assert private_value.casefold() not in serialized.casefold()


def test_valid_empty_workspace_is_200_and_verified_zero_is_not_unavailable(
    tmp_path: Path,
) -> None:
    response = _client_for(_build(tmp_path)).get("/settings/summary")

    assert response.status_code == 200
    body = response.json()
    assert body["workspace"]["state"] == "empty"
    assert all(
        resource["state"] == "empty" and resource["count"] == 0
        for resource in body["workspace"]["resources"]
    )
    assert body["data_integrity"]["state"] == "healthy"
    assert all(
        issue["state"] == "healthy" and issue["count"] == 0
        for issue in body["data_integrity"]["issues"]
    )
    assert body["backup_readiness"]["state"] == "warning"
    assert body["backup_readiness"]["snapshot_available"] is False


def test_settings_output_is_deterministic_for_unchanged_workspace(
    tmp_path: Path,
) -> None:
    _seed_populated_workspace(tmp_path)

    first = adapt_settings_summary(_build(tmp_path)).model_dump()
    second = adapt_settings_summary(_build(tmp_path)).model_dump()

    assert first == second


def test_application_version_comes_from_canonical_state(tmp_path: Path) -> None:
    body = _client_for(_build(tmp_path)).get("/settings/summary").json()

    assert body["application"]["product_version"] == APP_VERSION
    assert body["application"]["api_contract_version"] == APP_VERSION


def test_absent_and_present_backup_evidence_are_distinct(tmp_path: Path) -> None:
    paths = _workspace_paths(tmp_path)
    absent = adapt_settings_summary(_build(tmp_path)).model_dump()
    paths["exports_dir"].mkdir(parents=True)
    create_backup_snapshot(project_root=tmp_path, exports_dir=paths["exports_dir"], include_pdfs=True)
    present = adapt_settings_summary(_build(tmp_path)).model_dump()

    assert absent["backup_readiness"]["state"] == "warning"
    assert absent["backup_readiness"]["snapshot_available"] is False
    assert absent["backup_readiness"]["last_updated_at"] is None
    assert present["backup_readiness"]["state"] == "healthy"
    assert present["backup_readiness"]["snapshot_available"] is True
    assert present["backup_readiness"]["last_updated_at"].endswith("Z")


def test_corrupt_project_json_is_a_partial_section_warning_not_a_503(
    tmp_path: Path,
) -> None:
    _seed_populated_workspace(tmp_path)
    (tmp_path / "data" / "projects" / "projects.json").write_text(
        '{"private_path": "/home/private-user/project.json"',
        encoding="utf-8",
    )

    response = _client_for(_build(tmp_path)).get("/settings/summary")

    assert response.status_code == 200
    body = response.json()
    assert _resource(body, "projects")["state"] == "unavailable"
    assert _resource(body, "projects")["count"] is None
    assert _issue(body, "corrupt_json")["state"] == "warning"
    assert _issue(body, "corrupt_json")["count"] == 1
    assert body["workspace"]["state"] == "warning"
    assert "/home/private-user" not in response.text


def test_unavailable_diagnostic_is_null_and_never_displayed_as_zero(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _seed_populated_workspace(tmp_path)
    monkeypatch.setattr(
        settings_read_model,
        "_read_index_records",
        lambda _path: (_ for _ in ()).throw(OSError("private raw index failure")),
    )

    body = adapt_settings_summary(_build(tmp_path)).model_dump()

    assert _resource(body, "papers")["state"] == "unavailable"
    assert _resource(body, "papers")["count"] is None
    for code in (
        "missing_pdfs",
        "unindexed_pdfs",
        "orphan_notes",
        "orphan_note_blocks",
        "orphan_project_links",
    ):
        assert _issue(body, code)["state"] == "unavailable"
        assert _issue(body, code)["count"] is None
    assert body["data_integrity"]["state"] == "warning"


def test_complete_read_model_failure_is_generic_503_without_raw_error(
    tmp_path: Path,
    monkeypatch,
) -> None:
    raw_error = f"private failure at {tmp_path / 'secret' / 'settings.json'}"
    monkeypatch.setattr(
        dependencies.settings_read_model,
        "build_settings_summary",
        lambda: (_ for _ in ()).throw(OSError(raw_error)),
    )

    response = TestClient(create_app()).get("/settings/summary")

    assert response.status_code == 503
    assert response.json() == {"detail": UNAVAILABLE_DETAIL}
    assert raw_error not in response.text
    assert str(tmp_path) not in response.text


def test_adapter_rejects_private_version_content_as_generic_503(tmp_path: Path) -> None:
    summary = _build(tmp_path)
    summary["application"]["product_version"] = r"C:\Users\private-user\1.5.3"

    response = _client_for(summary).get("/settings/summary")

    assert response.status_code == 503
    assert response.json() == {"detail": UNAVAILABLE_DETAIL}
    assert "private-user" not in response.text


def test_settings_read_verifies_snapshot_without_opening_live_pdf_content(
    tmp_path: Path,
    monkeypatch,
) -> None:
    _seed_populated_workspace(tmp_path)
    create_backup_snapshot(project_root=tmp_path, exports_dir=tmp_path / "exports", include_pdfs=False)
    original_open = Path.open

    def guarded_open(path: Path, *args, **kwargs):
        if path.suffix.casefold() == ".pdf":
            raise AssertionError("Settings attempted to open a live PDF file.")
        return original_open(path, *args, **kwargs)

    monkeypatch.setattr(Path, "open", guarded_open)

    result = _build(tmp_path)

    assert result["backup_readiness"]["snapshot_available"] is True
    assert result["backup_readiness"]["evidence_state"] == "verified_light"
    assert result["data_integrity"]["missing_pdfs"]["count"] == 1


def test_settings_json_reads_share_one_bounded_request_budget(
    tmp_path: Path,
    monkeypatch,
) -> None:
    paths = _seed_populated_workspace(tmp_path)
    monkeypatch.setattr(settings_read_model, "MAX_TOTAL_JSON_BYTES", 1)

    result = _build(tmp_path)

    assert result["workspace"]["note_blocks"] == {
        "state": "unavailable",
        "count": None,
    }
    assert result["data_integrity"]["corrupt_json"] == {
        "state": "unavailable",
        "count": None,
    }


def test_settings_get_preserves_file_bytes_mtimes_and_creates_nothing(
    tmp_path: Path,
) -> None:
    _seed_populated_workspace(tmp_path)
    snapshot = tmp_path / "exports" / "blueprint_snapshot_safe.zip"
    snapshot.write_bytes(b"private archive content")

    def evidence() -> dict[str, tuple[bytes, int]]:
        return {
            path.relative_to(tmp_path).as_posix(): (
                path.read_bytes(),
                path.stat().st_mtime_ns,
            )
            for path in tmp_path.rglob("*")
            if path.is_file()
        }

    before = evidence()
    response = _client_for(_build(tmp_path)).get("/settings/summary")
    after = evidence()

    assert response.status_code == 200
    assert after == before
    assert not list(tmp_path.rglob("*cache*"))
    assert not list(tmp_path.rglob("*report*"))
    assert not list(tmp_path.rglob("*repair*"))


def test_settings_route_is_get_only_and_has_no_query_contract() -> None:
    paths = create_app().openapi()["paths"]

    assert set(paths["/settings/summary"]) == {"get"}
    assert paths["/settings/summary"]["get"].get("parameters", []) == []
    assert TestClient(create_app()).post("/settings/summary").status_code == 405
