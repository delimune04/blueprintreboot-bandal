"use client";

import { useI18n } from "../lib/i18n/LocaleProvider";

import { BookOpen, LibraryBig } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { EmptyState, ErrorState, LoadingState, UnavailableState } from "../components/AsyncStates";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { DetailPanel } from "../components/DetailPanel";
import { FirstPageThumbnail } from "../components/FirstPageThumbnail";
import { PaperDocumentAccess } from "../components/PaperDocumentAccess";
import { PaperNextSteps } from "../components/PaperNextSteps";
import { QuickIdeaButton } from "../components/QuickIdeaButton";
import { PageHeader } from "../components/PageHeader";
import { Section } from "../components/Section";
import { StatusBadge } from "../components/StatusBadge";
import { useApiResource } from "../hooks/useApiResource";
import { apiClient } from "../lib/api/client";
import { abstractDisplayParagraphs } from "../lib/abstract-display.mjs";
import { formatAuthorSummary } from "../lib/presentation";

function projectContext(count: number): string {
  if (count === 0) return "No linked projects";
  return `Linked to ${count} project${count === 1 ? "" : "s"}`;
}

export function PaperDetailView({ paperId }: { paperId: string }) {
  const { t, locale } = useI18n();
  const params = useSearchParams();
  const intent = params.get("open");
  const autoAction = intent === "reader" || intent === "download" ? intent : null;
  const resource = useApiResource(`paper:${paperId}`, () => apiClient.getPaper(paperId));
  const abstractParagraphs = resource.status === "success"
    ? abstractDisplayParagraphs(resource.data.abstract)
    : [];
  return (
    <div className="page-stack page-stack--detail paper-detail-overview">
      {resource.status === "loading" ? <LoadingState label={t("Loading paper")} /> : null}
      {resource.status === "unavailable" ? <UnavailableState description={t(resource.message)} /> : null}
      {resource.status === "not-found" ? <EmptyState title={t("Paper not found")} description={t("Return to the Library to choose a paper.")} /> : null}
      {resource.status === "error" ? <ErrorState description={t(resource.message)} /> : null}
      {resource.status === "success" ? (
        <>
          <Breadcrumbs items={[{ label: "Library", href: "/library" }, { label: resource.data.title || "Paper" }]} />
          <PageHeader title={resource.data.title || t("Untitled paper")} description={[formatAuthorSummary(resource.data.authors, resource.data.first_author, locale), resource.data.journal, resource.data.year].filter(Boolean).join(" · ")} actions={<div className="paper-detail-actions"><QuickIdeaButton source={{type:"paper",id:resource.data.paper_id,title:resource.data.title,excerpt:resource.data.abstract}}/><div className="badge-row"><StatusBadge>{resource.data.status}</StatusBadge>{resource.data.priority ? <StatusBadge>{resource.data.priority}</StatusBadge> : null}{resource.data.archived ? <StatusBadge>{t("Archived")}</StatusBadge> : null}{resource.data.missing_pdf ? <StatusBadge tone={resource.data.metadata_only ? "slate" : "rose"}>{resource.data.metadata_only ? (locale === "ko" ? "서지정보 저장" : "Metadata saved") : t("Missing PDF")}</StatusBadge> : null}</div>{!resource.data.missing_pdf && resource.data.relative_pdf_path ? <Link className="reader-action" href={`/papers/${encodeURIComponent(resource.data.paper_id)}/reader`}><BookOpen size={16} />{t("Open Reader")}</Link> : resource.data.metadata_only ? <button className="reader-action" type="button" onClick={() => document.getElementById("paper-document")?.scrollIntoView({behavior:"smooth",block:"start"})}><BookOpen size={16}/>{locale === "ko" ? "PDF 읽기·다운로드" : "Read or download PDF"}</button> : <div className="paper-detail-recovery"><span className="reader-action reader-action--disabled" aria-disabled="true">{t("Reader unavailable")}</span><Link className="reader-action" href="/library"><LibraryBig size={16} />{t("Open Library Scan")}</Link><Link className="text-link" href="/settings/diagnostics">{t("Review diagnostics")}</Link></div>}</div>} />
          <PaperDocumentAccess key={paperId} paper={resource.data} onAttached={resource.retry} autoAction={autoAction}/>
          <div className="paper-detail-content-grid">
            <div className="paper-detail-main">
              <Section title={t("Abstract")}>
                {abstractParagraphs.length ? <div className="abstract-text paper-detail-abstract">{abstractParagraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div> : <p className="abstract-text paper-detail-abstract">{t("No abstract yet.")}</p>}
              </Section>
              <Section title={t("Citation")}>
                <dl className="metadata-list paper-citation">
                  <div><dt>{t("Authors")}</dt><dd>{resource.data.authors.join("; ") || t("Authors unknown")}</dd></div>
                  <div><dt>{t("Journal")}</dt><dd>{resource.data.journal || t("Not recorded")}</dd></div>
                  <div><dt>{t("Year")}</dt><dd>{resource.data.year || t("Not recorded")}</dd></div>
                  <div><dt>{t("DOI")}</dt><dd className="paper-identifier">{resource.data.doi || t("Not recorded")}</dd></div>
                  <div><dt>{t("arXiv")}</dt><dd className="paper-identifier">{resource.data.arxiv_id || t("Not recorded")}</dd></div>
                </dl>
              </Section>
            </div>
            <aside className="paper-detail-context" aria-label={t("Paper context")}>
              <FirstPageThumbnail paperId={resource.data.paper_id} available={!resource.data.missing_pdf && Boolean(resource.data.relative_pdf_path)} size="detail" />
              <DetailPanel title={t("Organization")}><p>{t(projectContext(resource.data.project_links.length))}</p>{resource.data.tags.length ? <div className="tag-list project-tag-row">{resource.data.tags.map((tag) => <StatusBadge presentation="chip" taxonomy="canonical" key={tag}>{tag}</StatusBadge>)}</div> : <p className="deferred-note">{t("No tags yet")}</p>}</DetailPanel>
              <DetailPanel title={t("Reading context")}><p>{resource.data.note_available ? t("A reading note is ready in Reader.") : t("Open Reader to begin a reading note.")}</p></DetailPanel>
            </aside>
          </div>
          <PaperNextSteps paperId={paperId}/>
          {resource.data.keywords.length ? <Section title={t("Keywords")}><div className="tag-list">{resource.data.keywords.map((keyword) => <StatusBadge presentation="chip" taxonomy="alias" key={keyword}>{keyword}</StatusBadge>)}</div></Section> : null}
        </>
      ) : null}
    </div>
  );
}
