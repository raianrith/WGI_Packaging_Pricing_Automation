import type { RoadmapCard, RoadmapPhase } from "./roadmapModel";
import { sortedPhasesForScenario } from "./roadmapModel";

export type CopyScenarioOfferingsResult = {
  cards: RoadmapCard[];
  skippedDuplicates: number;
};

function dedupeKey(card: Pick<RoadmapCard, "kind" | "refId">): string {
  return `${card.kind}:${card.refId}`;
}

function shouldDedupeOnCopy(kind: RoadmapCard["kind"]): boolean {
  return kind === "tier" || kind === "package";
}

/** Map source phase ids to target scenario phases (title match, then index, then fallback). */
export function buildScenarioPhaseIdMap(
  phases: RoadmapPhase[],
  sourceScenarioId: string,
  targetScenarioId: string,
  fallbackPhaseId: string
): Map<string, string> {
  const sourcePhases = sortedPhasesForScenario(phases, sourceScenarioId);
  const targetPhases = sortedPhasesForScenario(phases, targetScenarioId);
  const map = new Map<string, string>();
  for (let i = 0; i < sourcePhases.length; i++) {
    const sp = sourcePhases[i]!;
    const norm = sp.title.trim().toLowerCase();
    const byTitle = targetPhases.find((t) => t.title.trim().toLowerCase() === norm);
    const byIndex = targetPhases[i];
    map.set(sp.id, byTitle?.id ?? byIndex?.id ?? fallbackPhaseId);
  }
  return map;
}

/** Clone offerings from one scenario into another (new card keys; skips duplicate tiers/packages). */
export function copyScenarioOfferings(args: {
  allCards: RoadmapCard[];
  phases: RoadmapPhase[];
  sourceScenarioId: string;
  targetScenarioId: string;
  targetPhaseId: string;
  newKey: () => string;
}): CopyScenarioOfferingsResult {
  const sourceCards = args.allCards.filter((c) => c.scenarioId === args.sourceScenarioId);
  const phaseMap = buildScenarioPhaseIdMap(
    args.phases,
    args.sourceScenarioId,
    args.targetScenarioId,
    args.targetPhaseId
  );

  const existing = new Set(
    args.allCards
      .filter((c) => c.scenarioId === args.targetScenarioId && shouldDedupeOnCopy(c.kind))
      .map(dedupeKey)
  );

  const cards: RoadmapCard[] = [];
  let skippedDuplicates = 0;

  for (const c of sourceCards) {
    if (shouldDedupeOnCopy(c.kind)) {
      const key = dedupeKey(c);
      if (existing.has(key)) {
        skippedDuplicates += 1;
        continue;
      }
      existing.add(key);
    }

    cards.push({
      ...c,
      key: args.newKey(),
      scenarioId: args.targetScenarioId,
      phaseId: phaseMap.get(c.phaseId) ?? args.targetPhaseId,
    });
  }

  return { cards, skippedDuplicates };
}
