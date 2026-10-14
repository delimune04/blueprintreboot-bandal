import json
import re
from pathlib import Path

from config.contact import APP_VERSION
from scripts.reconcile_release_state import (
    CONTROLLED_STATUS_SET,
    OUTPUT_PATH,
    validate_manifest,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = PROJECT_ROOT / "docs" / "tracker_sync_status.json"


def read_text(relative_path: str) -> str:
    return (PROJECT_ROOT / relative_path).read_text(encoding="utf-8")


def read_manifest() -> dict:
    return json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))


def test_version_contract_is_consistent() -> None:
    package = json.loads(read_text("frontend/package.json"))
    lock = json.loads(read_text("frontend/package-lock.json"))
    readme = read_text("README.md")
    manifest = read_manifest()
    shell = read_text("frontend/app/components/AppShell.tsx")
    sidebar = read_text("frontend/app/components/SidebarNavigation.tsx")

    assert APP_VERSION == "1.6.5"
    assert package["version"] == APP_VERSION
    assert lock["version"] == APP_VERSION
    assert lock["packages"][""]["version"] == APP_VERSION
    assert manifest["product_version"] == APP_VERSION
    assert manifest["release_name"] == "v1.6.5-visual-language-design-system-refinement"
    assert manifest["product_release_baseline"]["product_version"] == "1.4.0"
    assert manifest["product_release_baseline"]["release_name"] == "v1.4.0-pdfjs-reader-foundation"
    assert manifest["release_name"] in readme
    assert 'import packageMetadata from "../../package.json"' not in shell
    assert "packageMetadata.version" not in shell
    assert "applicationVersion" not in shell
    assert "v{applicationVersion}" not in sidebar
    assert 't("Research workspace")' in sidebar
    assert "Local workspace" not in shell
    assert "version-label" not in shell
    assert "v1.5.4" not in shell
    assert "Project commands" not in shell


def test_pdf_inspector_is_pinned_once_as_a_default_dependency() -> None:
    required = read_text("requirements.txt").splitlines()
    optional = read_text("requirements-optional.txt").splitlines()

    assert required.count("pdf-inspector==0.2.6") == 1
    assert all(not line.startswith("pdf-inspector") for line in optional)
    assert "markitdown[pdf]" in optional


def test_primary_workflow_preserves_full_manual_and_automatic_gate() -> None:
    workflow = read_text(".github/workflows/tests.yml")

    assert re.search(r"(?m)^on:\s*$", workflow)
    for trigger in ("push", "pull_request", "workflow_dispatch"):
        assert re.search(rf"(?m)^  {trigger}:\s*$", workflow)
    assert re.search(r"(?m)^  python:\s*$", workflow)
    assert re.search(r"(?m)^  frontend:\s*$", workflow)
    for command in (
        "python scripts/smoke_check.py",
        "python -m pytest",
        "npm ci",
        "npm run lint",
        "npm test",
    ):
        assert command in workflow


def test_current_frontend_launch_instructions_use_one_canonical_url() -> None:
    for relative_path in (
        "README.md",
        "docs/DEV_WORKFLOW.md",
        "docs/RELEASE_CHECKLIST.md",
        "docs/checklists/new_pc_restore_checklist.md",
    ):
        text = read_text(relative_path)
        assert "http://127.0.0.1:3000" in text
        assert "http://localhost:3000" not in text

    launcher = read_text("scripts/run_frontend.ps1")
    assert '$bindAddress = "127.0.0.1"' in launcher
    assert "[int]$Port = 3000" in launcher
    assert '$canonicalBrowserUrl = "http://${bindAddress}:$Port"' in launcher
    assert "http://localhost:3000" not in launcher


def test_schema_five_manifest_is_the_current_release_authority() -> None:
    manifest = read_manifest()

    validate_manifest(manifest)
    assert manifest["schema_version"] == "5.0"
    assert manifest["controlled_statuses"] == [
        "VERIFIED",
        "PARTIALLY VERIFIED",
        "DOCUMENTED ONLY",
        "NOT VERIFIED",
        "BLOCKED",
    ]
    assert manifest["product_release_baseline"]["tag"]["status"] == "VERIFIED"
    assert manifest["completed_control_plane_change"]["number"] == 6
    assert manifest["completed_control_plane_change"]["state"] == "MERGED"
    assert manifest["repository_head_observation"]["commit_sha"] is None
    assert manifest["repository_head_observation"]["required_invariant"] is False
    assert manifest["automated_validation"]["pr_head_ci"]["run_id"] == "30190817882"
    assert manifest["automated_validation"]["pr_head_ci"]["status"] == "PARTIALLY VERIFIED"
    assert manifest["automated_validation"]["post_merge_main_ci"]["status"] == "NOT VERIFIED"
    assert manifest["manual_validation"]["reader_runtime"]["status"] == "VERIFIED"
    assert manifest["manual_validation"]["streamlit_regression"]["status"] == "VERIFIED"
    assert manifest["manual_validation"]["reader_snapshot_runtime"]["status"] == "PARTIALLY VERIFIED"
    assert manifest["manual_validation"]["reader_write_runtime"]["status"] == "PARTIALLY VERIFIED"
    assert manifest["manual_validation"]["project_write_runtime"]["status"] == "VERIFIED"
    assert {
        item["status"]
        for item in manifest["manual_validation"]["project_write_runtime"]["checks"].values()
    } == {"VERIFIED"}
    assert {
        item["evidence"]["date"]
        for item in manifest["manual_validation"]["project_write_runtime"]["checks"].values()
    } == {"2026-08-02"}
    assert manifest["manual_validation"]["note_block_write_runtime"]["status"] == "VERIFIED"
    assert {
        item["status"]
        for item in manifest["manual_validation"]["note_block_write_runtime"]["checks"].values()
    } == {"VERIFIED"}
    assert {
        item["evidence"]["date"]
        for item in manifest["manual_validation"]["note_block_write_runtime"]["checks"].values()
    } == {"2026-08-02"}
    assert manifest["manual_validation"]["metadata_enrichment_runtime"]["status"] == "VERIFIED"
    pdf_scan_import = manifest["manual_validation"]["pdf_scan_import_runtime"]
    assert pdf_scan_import["status"] == "VERIFIED"
    assert {
        item["status"] for item in pdf_scan_import["checks"].values()
    } == {"VERIFIED"}
    library_paper_workflow = manifest["manual_validation"]["library_paper_workflow_runtime"]
    assert library_paper_workflow["status"] == "VERIFIED"
    assert {
        item["status"] for item in library_paper_workflow["checks"].values()
    } == {"VERIFIED"}
    pdf_foundation = manifest["manual_validation"]["pdf_foundation_runtime"]
    assert pdf_foundation["status"] == "PARTIALLY VERIFIED"
    assert {item["status"] for item in pdf_foundation["checks"].values()} == {
        "VERIFIED",
        "NOT VERIFIED",
    }
    assert {
        check_id
        for check_id, item in pdf_foundation["checks"].items()
        if item["status"] == "VERIFIED"
    } == {"sharp_rendering_zoom", "text_selection_alignment"}
    tag_candidate_review = manifest["manual_validation"]["tag_candidate_review_runtime"]
    assert tag_candidate_review["status"] == "PARTIALLY VERIFIED"
    assert {
        item["status"] for item in tag_candidate_review["checks"].values()
    } == {"VERIFIED", "NOT VERIFIED"}
    assert {
        check_id
        for check_id, item in tag_candidate_review["checks"].items()
        if item["status"] == "NOT VERIFIED"
    } == {"network_privacy"}
    assert {
        item["status"]
        for item in manifest["manual_validation"]["metadata_enrichment_runtime"]["checks"].values()
    } == {"VERIFIED"}
    assert {
        item["evidence"]["date"]
        for item in manifest["manual_validation"]["metadata_enrichment_runtime"]["checks"].values()
    } == {"2026-08-16"}
    assert {
        check_id
        for check_id, item in manifest["manual_validation"]["reader_write_runtime"]["checks"].items()
        if item["status"] == "NOT VERIFIED"
    } == {"unreadable_note_warning", "missing_pdf"}
    assert {
        item["status"]
        for item in manifest["manual_validation"]["reader_write_runtime"]["checks"].values()
    } == {"VERIFIED", "NOT VERIFIED"}
    assert "manual_validation.reader_snapshot_runtime" in manifest["unresolved_evidence"]["items"]
    assert "manual_validation.reader_write_runtime" in manifest["unresolved_evidence"]["items"]
    assert "manual_validation.project_write_runtime" not in manifest["unresolved_evidence"]["items"]
    assert "manual_validation.note_block_write_runtime" not in manifest["unresolved_evidence"]["items"]
    assert "manual_validation.metadata_enrichment_runtime" not in manifest["unresolved_evidence"]["items"]
    assert "manual_validation.pdf_scan_import_runtime" not in manifest["unresolved_evidence"]["items"]
    assert "manual_validation.library_paper_workflow_runtime" not in manifest["unresolved_evidence"]["items"]
    assert "manual_validation.pdf_foundation_runtime" in manifest["unresolved_evidence"]["items"]
    assert "manual_validation.tag_candidate_review_runtime" in manifest["unresolved_evidence"]["items"]
    assert manifest["recurring_operational_procedures"]["clean_pc_restore"]["status"] == "NOT VERIFIED"
    assert manifest["publication_state"]["github_release"]["status"] == "NOT VERIFIED"


def test_all_current_status_values_are_controlled() -> None:
    manifest = read_manifest()

    def collect(value: object) -> list[str]:
        statuses: list[str] = []
        if isinstance(value, dict):
            for key, child in value.items():
                if key == "status":
                    statuses.append(child)
                statuses.extend(collect(child))
        elif isinstance(value, list):
            for child in value:
                statuses.extend(collect(child))
        return statuses

    statuses = collect(manifest)
    assert statuses
    assert set(statuses) <= CONTROLLED_STATUS_SET


def test_generated_current_status_is_the_only_volatile_document_surface() -> None:
    current_status = OUTPUT_PATH.read_text(encoding="utf-8")

    assert "Generated by scripts/reconcile_release_state.py" in current_status
    assert "PR #6" in current_status
    assert "30190817882" in current_status
    assert "| v1.4.0 tag | VERIFIED |" in current_status
    assert "| Post-merge `main` GitHub Actions | NOT VERIFIED |" in current_status
    assert "| Reader runtime | VERIFIED |" in current_status
    assert "| Streamlit regression | VERIFIED |" in current_status
    assert "v1.5.11 Library/Paper workflow manual validation" in current_status
    assert "| v1.5.11 Library/Paper workflow runtime | VERIFIED |" in current_status
    assert "v1.5.12 PDF foundation manual validation" in current_status
    assert "| v1.5.12 PDF foundation runtime | PARTIALLY VERIFIED |" in current_status
    assert "v1.5.4 Project write manual validation" in current_status
    assert "| v1.5.4 Project write runtime | VERIFIED |" in current_status
    assert "v1.5.5 Note Block write manual validation" in current_status
    assert "v1.5.8 Metadata enrichment manual validation" in current_status
    assert "| v1.5.8 Metadata enrichment runtime | VERIFIED |" in current_status
    assert "v1.5.9 PDF scan/import manual validation" in current_status
    assert "| v1.5.9 PDF scan/import runtime | VERIFIED |" in current_status
    assert "v1.5.10 Tag governance and candidate-review manual validation" in current_status
    assert "| v1.5.10 Tag candidate review runtime | PARTIALLY VERIFIED |" in current_status
    assert "Aggregate state: **VERIFIED**" in current_status
    assert "- v1.5.5 Note Block write runtime:" not in current_status
    smoke_counts = read_manifest()["automated_validation"]["local_smoke"]["counts"]
    assert (
        f"{smoke_counts['passed']} passed, {smoke_counts['warnings']} warnings, "
        f"{smoke_counts['failed']} failed"
    ) in current_status
    assert "97 passed, 1 warnings, 0 failed" in current_status
    assert "98 passed, 0 warnings, 0 failed" in current_status
    assert "not the latest smoke result" in current_status

    for relative_path in (
        "README.md",
        "docs/ROADMAP.md",
        "docs/RELEASE_CHECKLIST.md",
        "docs/BACKLOG.md",
        "docs/checklists/regression_checklist.md",
        "docs/release_notes/v1.4.3.md",
    ):
        assert "CURRENT_RELEASE_STATUS.md" in read_text(relative_path)


def test_readme_describes_pdfjs_as_primary_and_native_as_fallback() -> None:
    readme = read_text("README.md")

    assert "PDF.js canvas renderer as the primary path" in readme
    assert "conditional native fallback" in readme
    assert "browser's native PDF capability" not in readme


def test_external_tracker_mapping_is_versioned_and_controlled() -> None:
    external = read_manifest()["external_tracker"]

    assert external["schema_version"] == "2.0"
    assert external["status_values"] == list(read_manifest()["controlled_statuses"])
    tasks = external["tasks"]
    assert [task["task_id"] for task in tasks] == [
        *[f"R-{number:03d}" for number in range(1, 26)],
        "R-145",
    ]
    assert all(task["status"] in CONTROLLED_STATUS_SET for task in tasks)
    assert all(
        set(task) == {"task_id", "status", "evidence", "disposition", "last_verified"}
        for task in tasks
    )


def test_release_documents_contain_no_private_absolute_user_path() -> None:
    private_user_path = re.compile(r"[A-Za-z]:\\Users\\(?!Public(?:\\|\b))[^\\\s]+", re.IGNORECASE)

    for relative_path in (
        "docs/tracker_sync_status.json",
        "docs/CURRENT_RELEASE_STATUS.md",
        "docs/release_notes/v1.4.0.md",
        "docs/release_notes/v1.5.4.md",
        "docs/release_notes/v1.5.5.md",
        "docs/release_notes/v1.5.6.md",
        "docs/release_notes/v1.5.7.md",
        "docs/release_notes/v1.5.8.md",
        "docs/release_notes/v1.5.9.md",
        "docs/release_notes/v1.5.10.md",
        "docs/release_notes/v1.5.11.md",
        "docs/release_notes/v1.5.12.md",
        "docs/release_notes/v1.6.5.md",
    ):
        assert private_user_path.search(read_text(relative_path)) is None
