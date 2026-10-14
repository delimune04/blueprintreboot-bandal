import type { Metadata } from "next";
import { ProjectResearchView } from "../../../views/ProjectResearchView";
export const metadata: Metadata = { title: "Project research · 랩비움" };
export default async function ProjectResearchPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  return <ProjectResearchView projectId={projectId} />;
}
