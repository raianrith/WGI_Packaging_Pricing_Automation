import type { RoadmapProposalRow } from "../types";
import type { RoadmapCard, RoadmapPhase, RoadmapScenario } from "./roadmapModel";

export type RoadmapHorizon = "3" | "4" | "6" | "12" | "custom";

export type RoadmapProposalSnapshot = {
  version: 1;
  clientLabel: string;
  roadmapTitle: string;
  horizon: RoadmapHorizon;
  clientBudget: string;
  scenarios: RoadmapScenario[];
  phases: RoadmapPhase[];
  cards: RoadmapCard[];
};

function isRoadmapHorizon(value: unknown): value is RoadmapHorizon {
  return value === "3" || value === "4" || value === "6" || value === "12" || value === "custom";
}

function newStructureId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
}

export function parseProposalSnapshot(row: RoadmapProposalRow): RoadmapProposalSnapshot | null {
  if (!row.proposal_state || typeof row.proposal_state !== "object") return null;
  const raw = row.proposal_state as Partial<RoadmapProposalSnapshot>;
  if (!Array.isArray(raw.scenarios) || !Array.isArray(raw.phases) || !Array.isArray(raw.cards)) return null;
  return {
    version: 1,
    clientLabel: typeof raw.clientLabel === "string" ? raw.clientLabel : row.client_label,
    roadmapTitle: typeof raw.roadmapTitle === "string" ? raw.roadmapTitle : row.roadmap_title,
    horizon: isRoadmapHorizon(raw.horizon) ? raw.horizon : "6",
    clientBudget: typeof raw.clientBudget === "string" ? raw.clientBudget : row.client_budget ?? "",
    scenarios: raw.scenarios as RoadmapScenario[],
    phases: raw.phases as RoadmapPhase[],
    cards: raw.cards as RoadmapCard[],
  };
}

/** Deep-clone scenarios, phases, and line items with fresh ids for the current draft. */
export function cloneProposalStructure(
  snapshot: Pick<RoadmapProposalSnapshot, "scenarios" | "phases" | "cards">
): Pick<RoadmapProposalSnapshot, "scenarios" | "phases" | "cards"> {
  const scenarioIdMap = new Map<string, string>();
  const phaseIdMap = new Map<string, string>();

  const scenarios = snapshot.scenarios.map((s) => {
    const id = newStructureId();
    scenarioIdMap.set(s.id, id);
    return { ...s, id };
  });

  const phases = snapshot.phases.map((p) => {
    const id = newStructureId();
    phaseIdMap.set(p.id, id);
    return {
      ...p,
      id,
      scenarioId: scenarioIdMap.get(p.scenarioId) ?? p.scenarioId,
    };
  });

  const cards = snapshot.cards.map((c) => ({
    ...c,
    key: newStructureId(),
    scenarioId: scenarioIdMap.get(c.scenarioId) ?? c.scenarioId,
    phaseId: phaseIdMap.get(c.phaseId) ?? c.phaseId,
  }));

  return { scenarios, phases, cards };
}

export function proposalStructureCounts(row: RoadmapProposalRow): {
  scenarios: number;
  phases: number;
  cards: number;
} | null {
  const snap = parseProposalSnapshot(row);
  if (!snap || snap.scenarios.length === 0) return null;
  return {
    scenarios: snap.scenarios.length,
    phases: snap.phases.length,
    cards: snap.cards.length,
  };
}
