import { blankResearchPage, newResearchBlock } from "./pages.mjs";
export const RESEARCH_TEMPLATES = [
  { id: "blank", label: "Blank page" },
  { id: "literature-review", label: "Literature review" },
  { id: "lab-handoff", label: "Lab handoff" },
  { id: "industry-decision", label: "Industry decision record" },
  { id: "ccs-evidence", label: "CCS evidence review" },
];
const layouts = {
  "literature-review": [
    ["heading", "Research question"], ["paragraph", "Question:\nScope:\nInclusion criteria:\nSearch date and sources:"],
    ["heading", "Evidence comparison"], ["paragraph", "Claim | Supporting source and page | Contrary evidence | Limitations | Reviewer\n"],
    ["heading", "Synthesis"], ["paragraph", "Agreement:\nDisagreement:\nMissing evidence:"], ["checklist", "Verify each claim against its original source."],
  ],
  "lab-handoff": [
    ["heading", "Experiment context"], ["paragraph", "Research question:\nProtocol version:\nSample or dataset:\nRun date:"],
    ["heading", "Reproducibility record"], ["paragraph", "Code repository and commit:\nData checksum:\nConfiguration:\nSoftware and environment:\nOutput registry:"],
    ["heading", "Handoff checks"], ["checklist", "Link the protocol, data, and evidence sources."], ["checklist", "Record what remains unverified and who will review it."],
  ],
  "industry-decision": [
    ["heading", "Decision and alternatives"], ["paragraph", "Decision question:\nOptions considered:\nConstraints:\nDecision owner and date:"],
    ["heading", "Evidence and assumptions"], ["paragraph", "Metric | Value | Unit | Range | Source and page | Evidence kind | Uncertainty | Reviewer\n"],
    ["heading", "Contradictions and risk"], ["paragraph", "Assumptions:\nConflicting evidence:\nRisks:\nNext measurement:\nResponsible owner:"],
    ["heading", "Reproduction and review"], ["paragraph", "Code commit:\nData checksum:\nConfiguration:\nSoftware version:\nOutput registry:"], ["checklist", "Record expert review before accepting a decision."],
  ],
  "ccs-evidence": [
    ["heading", "Site screening evidence"], ["paragraph", "Candidate site:\nDecision question:\nEvidence scope:\nReviewer:"],
    ["heading", "Reservoir and containment evidence"], ["paragraph", "Metric | Value | Unit | Range | Source and page | Measured / modeled / assumed | Uncertainty | Reviewer\n"],
    ["heading", "Pressure, groundwater, and monitoring"], ["paragraph", "Pressure assumptions:\nContainment evidence:\nGroundwater considerations:\nMonitoring evidence:\nUnresolved contradictions:"],
    ["heading", "Next measurements and reproducibility"], ["paragraph", "Next measurement:\nOwner:\nCode commit:\nData checksum:\nModel configuration:\nSoftware version:\nOutput registry:"],
    ["checklist", "Preserve the source and uncertainty for each parameter."], ["checklist", "Keep screening scores separate from a geological feasibility conclusion."],
  ],
};
export function createResearchTemplate(id, translate = (value) => value, parentId = null) {
  const page = blankResearchPage(parentId);
  const template = RESEARCH_TEMPLATES.find((item) => item.id === id) || RESEARCH_TEMPLATES[0];
  page.title = translate(template.id === "blank" ? "Untitled research page" : template.label);
  page.blocks = (layouts[template.id] || []).map(([type, content]) => ({ ...newResearchBlock(type), text: translate(content) }));
  return page;
}
