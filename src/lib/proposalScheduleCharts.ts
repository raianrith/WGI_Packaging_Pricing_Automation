import { formatProposalDisplayDate, normalizeIsoDateInput } from "./proposalDates";
import {
  resolveProposalCardTasks,
  type ProposalCardTasksCtx,
} from "./proposalCardTasks";
import type { RoadmapCard, RoadmapPhase, RoadmapScenario } from "./roadmapModel";
import { sortedPhasesForScenario } from "./roadmapModel";

export type ProposalScheduleBar = {
  key: string;
  label: string;
  scenarioTitle: string;
  phaseTitle: string;
  startMs: number;
  endMs: number;
  startLabel: string;
  endLabel: string;
  scope: RoadmapCard["scope"];
};

export type ImplementerWeekLoad = {
  weekStartMs: number;
  /** Full range, e.g. "Aug 31, 2026 – Sep 6, 2026" */
  weekLabel: string;
  /** Compact header, e.g. "Aug 31" */
  weekShortLabel: string;
  byImplementer: Record<string, number>;
};

function parseDayMs(iso: string | null | undefined): number | null {
  const t = normalizeIsoDateInput(iso);
  if (!t) return null;
  const d = new Date(`${t}T12:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function startOfWeekMs(ms: number): number {
  const d = new Date(ms);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday start
  d.setDate(d.getDate() + diff);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

function addDaysMs(ms: number, days: number): number {
  return ms + days * 24 * 60 * 60 * 1000;
}

function dayCountInclusive(startMs: number, endMs: number): number {
  const a = startOfDayMs(startMs);
  const b = startOfDayMs(endMs);
  return Math.max(1, Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1);
}

function startOfDayMs(ms: number): number {
  const d = new Date(ms);
  d.setHours(12, 0, 0, 0);
  return d.getTime();
}

function isoFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Deliverables with valid dates for Gantt rendering. */
export function buildProposalScheduleBars(
  cards: RoadmapCard[],
  scenarios: RoadmapScenario[],
  phases: RoadmapPhase[]
): ProposalScheduleBar[] {
  const scenarioTitle = new Map(
    scenarios.map((s, i) => [s.id, s.title.trim() || `Scenario ${i + 1}`] as const)
  );
  const phaseTitle = new Map(
    phases.map((p) => [p.id, p.title.trim() || "Phase"] as const)
  );
  const out: ProposalScheduleBar[] = [];
  for (const scenario of scenarios) {
    const phaseOrder = sortedPhasesForScenario(phases, scenario.id);
    const phaseRank = new Map(phaseOrder.map((p, i) => [p.id, i]));
    const scenCards = cards
      .filter((c) => c.scenarioId === scenario.id && c.scope === "included")
      .sort((a, b) => {
        const pa = phaseRank.get(a.phaseId) ?? 999;
        const pb = phaseRank.get(b.phaseId) ?? 999;
        if (pa !== pb) return pa - pb;
        return a.headline.localeCompare(b.headline, undefined, { sensitivity: "base" });
      });
    for (const c of scenCards) {
      let startMs = parseDayMs(c.startDate);
      let endMs = parseDayMs(c.endDate);
      if (startMs == null && endMs == null) continue;
      if (startMs == null) startMs = endMs!;
      if (endMs == null) endMs = startMs;
      if (endMs < startMs) {
        const tmp = startMs;
        startMs = endMs;
        endMs = tmp;
      }
      out.push({
        key: c.key,
        label: c.headline.trim() || "(untitled)",
        scenarioTitle: scenarioTitle.get(scenario.id) ?? "Scenario",
        phaseTitle: phaseTitle.get(c.phaseId) ?? "Phase",
        startMs,
        endMs,
        startLabel: formatProposalDisplayDate(isoFromMs(startMs)),
        endLabel: formatProposalDisplayDate(isoFromMs(endMs)),
        scope: c.scope,
      });
    }
  }
  return out;
}

/**
 * Spread each task’s hours evenly across its deliverable date range,
 * then roll up by implementer per week.
 */
export function buildImplementerWeekLoad(
  cards: RoadmapCard[],
  scenarios: RoadmapScenario[],
  tasksCtx: ProposalCardTasksCtx
): { weeks: ImplementerWeekLoad[]; implementers: string[] } {
  const included = cards.filter(
    (c) => c.scope === "included" && scenarios.some((s) => s.id === c.scenarioId)
  );
  const weekMap = new Map<number, Record<string, number>>();
  const implementerSet = new Set<string>();

  for (const card of included) {
    let startMs = parseDayMs(card.startDate);
    let endMs = parseDayMs(card.endDate);
    if (startMs == null && endMs == null) continue;
    if (startMs == null) startMs = endMs!;
    if (endMs == null) endMs = startMs;
    if (endMs < startMs) {
      const tmp = startMs;
      startMs = endMs;
      endMs = tmp;
    }
    const days = dayCountInclusive(startMs, endMs);
    const tasks = resolveProposalCardTasks(card, tasksCtx);
    for (const t of tasks) {
      if (t.hours == null || !Number.isFinite(t.hours) || t.hours <= 0) continue;
      const implementer = (t.implementer ?? "").trim() || "Unassigned";
      implementerSet.add(implementer);
      const perDay = t.hours / days;
      for (let i = 0; i < days; i++) {
        const dayMs = addDaysMs(startOfDayMs(startMs), i);
        const week = startOfWeekMs(dayMs);
        const bucket = weekMap.get(week) ?? {};
        bucket[implementer] = (bucket[implementer] ?? 0) + perDay;
        weekMap.set(week, bucket);
      }
    }
  }

  const implementers = [...implementerSet].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  const weeks = [...weekMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([weekStartMs, byImplementer]) => {
      const endMs = addDaysMs(weekStartMs, 6);
      return {
        weekStartMs,
        weekLabel: `${formatProposalDisplayDate(isoFromMs(weekStartMs))} – ${formatProposalDisplayDate(isoFromMs(endMs))}`,
        weekShortLabel: formatProposalDisplayDate(isoFromMs(weekStartMs)).replace(/,\s*\d{4}$/, ""),
        byImplementer,
      };
    });

  return { weeks, implementers };
}