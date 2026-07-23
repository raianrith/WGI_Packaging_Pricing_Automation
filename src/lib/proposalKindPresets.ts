import type { RoadmapPhase, RoadmapScenario } from "./roadmapModel";

export type ProposalKind = "program" | "project";

export function isProposalKind(value: unknown): value is ProposalKind {
  return value === "program" || value === "project";
}

const PROGRAM_SECTION_TITLES = [
  "Phase 1 — Diagnose",
  "Phase 2 — Engineer",
  "Phase 3 — Activate (Track 1: Core Market Presence)",
  "Phase 3 — Activate (Track 2: Activation Campaigns)",
  "Phase 3 — Activate (Track 3: Operational Optimization)",
] as const;

const PROJECT_SECTION_TITLES = ["Section 1", "Section 2", "Section 3"] as const;

function newStructureId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function sectionTitlesForProposalKind(kind: ProposalKind): readonly string[] {
  return kind === "program" ? PROGRAM_SECTION_TITLES : PROJECT_SECTION_TITLES;
}

/** Initial scenario + section structure for Program or Project proposals. */
export function createScenariosAndPhasesForKind(
  kind: ProposalKind,
  newId: () => string = newStructureId
): { scenarios: RoadmapScenario[]; phases: RoadmapPhase[] } {
  const scenarioId = newId();
  const scenarios: RoadmapScenario[] = [
    {
      id: scenarioId,
      title: "Proposal Scenario 1",
      narrative: "",
    },
  ];
  const titles = sectionTitlesForProposalKind(kind);
  const phases: RoadmapPhase[] = titles.map((title, i) => ({
    id: newId(),
    scenarioId,
    title,
    sortOrder: i,
  }));
  return { scenarios, phases };
}

export function defaultPhaseTitleForKind(kind: ProposalKind, indexZeroBased: number): string {
  return kind === "project" ? `Section ${indexZeroBased + 1}` : `Phase ${indexZeroBased + 1}`;
}

export function defaultScenarioTitleForKind(kind: ProposalKind, indexZeroBased: number): string {
  void kind;
  return `Proposal Scenario ${indexZeroBased + 1}`;
}
