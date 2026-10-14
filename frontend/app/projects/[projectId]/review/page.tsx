import type { Metadata } from "next";
import { ProjectReviewView } from "../../../views/ProjectReviewView";
export const metadata: Metadata = { title: "Review and handoff · 랩비움" };
export default async function ProjectReviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectReviewView projectId={projectId} />;
}
