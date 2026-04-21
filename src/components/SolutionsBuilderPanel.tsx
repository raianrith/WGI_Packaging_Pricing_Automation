import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../lib/audit";
import { todayISODate } from "../lib/dates";
import { getSupabase } from "../lib/supabase";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import type { Solution, SolutionTier, SolutionTierPricing, TaskRow } from "../types";
import {
  computeTierPricing,
  TIER_PRICING_HOURLY_RATE,
} from "../lib/tierPricingMath";
import { PricingPanel } from "./PricingPanel";

const SCORE012: { value: string; label: string }[] = [
  { value: "0", label: "0" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
];

const STRATEGIC_OPTIONS: { value: string; label: string }[] = [
  { value: "0", label: "0 — Support" },
  { value: "1", label: "1 — Revenue" },
  { value: "2", label: "2 — Growth" },
];

function parseNumStr(s: string): number | null {
  const t = s.trim();
  if (t === "" || t.toLowerCase() === "n/a") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function AdminFieldCaption({ children }: { children: ReactNode }) {
  return <span className="admin-field-caption">{children}</span>;
}

function sortId(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return a.localeCompare(b);
}

/** Next id in the `2-n` sequence for solutions. */
export function nextAutoSolutionId(solutions: Solution[]): string {
  let max = 0;
  const re = /^2-(\d+)$/i;
  for (const s of solutions) {
    const m = s.solution_id.trim().match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `2-${max + 1}`;
}

/** Next id in the `3-n` sequence for solution tiers (global across all solutions). */
export function nextAutoTierId(tiers: SolutionTier[]): string {
  let max = 0;
  const re = /^3-(\d+)$/i;
  for (const t of tiers) {
    const m = t.solution_tier_id.trim().match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `3-${max + 1}`;
}

/** Next id in the `4-n` sequence for tasks (global across all tiers). */
export function nextAutoTaskId(tasks: TaskRow[]): string {
  let max = 0;
  const re = /^4-(\d+)$/i;
  for (const k of tasks) {
    const m = k.task_id.trim().match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `4-${max + 1}`;
}

function rowJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

function blankToNull(s: string): (string | null) {
  return s.trim() === "" ? null : s;
}

function optNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

type CreateBranch = null | "full" | "tier_only";
type CreatePhase = "choose" | "foundation" | "tier" | "tasks" | "pricing";

type DraftTaskRow = {
  key: string;
  name: string;
  impl: string;
  time: string;
  dur: string;
  dep: string;
  notes: string;
};

function newDraftTaskRow(): DraftTaskRow {
  return {
    key: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: "",
    impl: "",
    time: "",
    dur: "",
    dep: "",
    notes: "",
  };
}

export type SolutionsBuilderSubTab = "create" | "update";

type BuilderStyles = {
  panel: CSSProperties;
  formGrid: CSSProperties;
  lbl: CSSProperties;
  input: CSSProperties;
  textarea: CSSProperties;
  btn: CSSProperties;
  btnPrimary: CSSProperties;
  btnSm: CSSProperties;
  btnDangerSm: CSSProperties;
  tbl: CSSProperties;
  th: CSSProperties;
  td: CSSProperties;
  h2: CSSProperties;
  muted: CSSProperties;
};

type LogAudit = (
  client: SupabaseClient,
  p: Parameters<typeof insertAuditLog>[1]
) => Promise<void>;

const sectionTitle: CSSProperties = {
  margin: "0 0 0.65rem",
  fontSize: "0.98rem",
  fontWeight: 650,
  letterSpacing: "-0.02em",
};

const sectionWrap: CSSProperties = {
  marginTop: "1.35rem",
  paddingTop: "1.1rem",
  borderTop: "1px solid var(--border)",
};

/** Grouped blocks inside the new-solution form for readability. */
const formSectionBox: CSSProperties = {
  marginTop: "1.1rem",
  padding: "1rem 1.15rem 1.2rem",
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "rgba(255, 252, 247, 0.96)",
  boxShadow: "0 1px 2px rgba(0, 0, 0, 0.04)",
};

const formSectionHeading: CSSProperties = {
  margin: "0 0 0.5rem",
  fontSize: "0.95rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
  color: "var(--text)",
};

const formSubHeading: CSSProperties = {
  margin: "1rem 0 0.45rem",
  fontSize: "0.82rem",
  fontWeight: 650,
  color: "var(--muted)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
};

const idLegendBar: CSSProperties = {
  fontSize: "0.8rem",
  color: "var(--muted)",
  marginBottom: "0.85rem",
  padding: "0.5rem 0.65rem",
  borderRadius: 10,
  background: "rgba(13, 92, 77, 0.06)",
  border: "1px solid rgba(13, 92, 77, 0.12)",
  lineHeight: 1.45,
};

const choiceRow: CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "0.75rem",
  marginTop: "0.75rem",
};

const choiceCard: CSSProperties = {
  flex: "1 1 240px",
  padding: "1rem 1.1rem",
  borderRadius: 12,
  border: "1px solid var(--border)",
  background: "rgba(255, 252, 247, 0.75)",
  textAlign: "left" as const,
  cursor: "pointer",
  font: "inherit",
};

export function SolutionsBuilderPanel({
  subTab,
  solutions,
  tiers,
  tasks,
  tierPricing,
  onSaved,
  setOpErr,
  setOpOk,
  logAudit,
  styles: s,
}: {
  subTab: SolutionsBuilderSubTab;
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  tierPricing: SolutionTierPricing[];
  onSaved: () => Promise<void>;
  setOpErr: (msg: string | null) => void;
  setOpOk: (msg: string | null) => void;
  logAudit: LogAudit;
  styles: BuilderStyles;
}) {
  const { panel, formGrid, lbl, input, textarea, btn, btnPrimary, btnSm, btnDangerSm, tbl, th, td, h2, muted } = s;

  // —— Create wizard ——
  const [createBranch, setCreateBranch] = useState<CreateBranch>(null);
  const [createPhase, setCreatePhase] = useState<CreatePhase>("choose");
  const [ctxSolutionId, setCtxSolutionId] = useState("");
  const [ctxTierId, setCtxTierId] = useState("");
  const [tierOnlySolId, setTierOnlySolId] = useState("");

  const [solNameDraft, setSolNameDraft] = useState("");

  const [tName, setTName] = useState("");
  const [tOwner, setTOwner] = useState("");
  const [tOverview, setTOverview] = useState("");
  const [tLink, setTLink] = useState("");
  const [tDirection, setTDirection] = useState("");
  const [tSop, setTSop] = useState("");
  const [tRes, setTRes] = useState("");

  const [draftTasks, setDraftTasks] = useState<DraftTaskRow[]>([newDraftTaskRow()]);

  const [prSolLabel, setPrSolLabel] = useState("");
  const [prTierLabel, setPrTierLabel] = useState("");
  const [prScope, setPrScope] = useState("");
  const [prHCs, setPrHCs] = useState("");
  const [prHCp, setPrHCp] = useState("");
  const [prHDs, setPrHDs] = useState("");
  const [prHWd, setPrHWd] = useState("");
  const [prHVi, setPrHVi] = useState("");
  const [prHDa, setPrHDa] = useState("");
  const [prHPm, setPrHPm] = useState("");
  const [prHHb, setPrHHb] = useState("");
  const [prHOt, setPrHOt] = useState("");
  const [prScopeRisk, setPrScopeRisk] = useState("0");
  const [prInternalCoord, setPrInternalCoord] = useState("0");
  const [prClientRev, setPrClientRev] = useState("0");
  const [prStratScore, setPrStratScore] = useState("0");
  const [prStandalone, setPrStandalone] = useState("");
  const [prOldPrice, setPrOldPrice] = useState("");
  const [prPctChg, setPrPctChg] = useState("");
  const [prReqCustom, setPrReqCustom] = useState(false);
  const [prTaxable, setPrTaxable] = useState(false);
  const [prNotes, setPrNotes] = useState("");
  const [prTags, setPrTags] = useState("");

  const resetCreateWizard = useCallback(() => {
    setCreateBranch(null);
    setCreatePhase("choose");
    setCtxSolutionId("");
    setCtxTierId("");
    setTierOnlySolId("");
    setSolNameDraft("");
    setTName("");
    setTOwner("");
    setTOverview("");
    setTLink("");
    setTDirection("");
    setTSop("");
    setTRes("");
    setDraftTasks([newDraftTaskRow()]);
    setPrSolLabel("");
    setPrTierLabel("");
    setPrScope("");
    setPrHCs("");
    setPrHCp("");
    setPrHDs("");
    setPrHWd("");
    setPrHVi("");
    setPrHDa("");
    setPrHPm("");
    setPrHHb("");
    setPrHOt("");
    setPrScopeRisk("0");
    setPrInternalCoord("0");
    setPrClientRev("0");
    setPrStratScore("0");
    setPrStandalone("");
    setPrOldPrice("");
    setPrPctChg("");
    setPrReqCustom(false);
    setPrTaxable(false);
    setPrNotes("");
    setPrTags("");
  }, []);

  useEffect(() => {
    if (subTab === "create") resetCreateWizard();
  }, [subTab, resetCreateWizard]);

  useEffect(() => {
    if (tierOnlySolId === "" && solutions.length > 0) {
      setTierOnlySolId(solutions[0].solution_id);
    }
  }, [solutions, tierOnlySolId]);

  const previewTierId = useMemo(() => nextAutoTierId(tiers), [tiers]);
  const previewSolutionId = useMemo(() => nextAutoSolutionId(solutions), [solutions]);
  const previewTaskId = useMemo(() => nextAutoTaskId(tasks), [tasks]);

  const fullPricingHours = useMemo(
    () => ({
      client: parseNumStr(prHCs) ?? 0,
      copy: parseNumStr(prHCp) ?? 0,
      design: parseNumStr(prHDs) ?? 0,
      web: parseNumStr(prHWd) ?? 0,
      video: parseNumStr(prHVi) ?? 0,
      data: parseNumStr(prHDa) ?? 0,
      paidMedia: parseNumStr(prHPm) ?? 0,
      hubspot: parseNumStr(prHHb) ?? 0,
      other: parseNumStr(prHOt) ?? 0,
    }),
    [prHCs, prHCp, prHDs, prHWd, prHVi, prHDa, prHPm, prHHb, prHOt]
  );

  const fullPricingDerived = useMemo(
    () =>
      computeTierPricing({
        hours: fullPricingHours,
        scopeRisk: Number(prScopeRisk),
        internalCoordination: Number(prInternalCoord),
        clientRevisionRisk: Number(prClientRev),
        strategicValueScore: Number(prStratScore),
      }),
    [fullPricingHours, prScopeRisk, prInternalCoord, prClientRev, prStratScore]
  );

  const createFullSolutionStack = async () => {
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    const solName = solNameDraft.trim();
    if (!solName) {
      setOpErr("Solution name is required.");
      return;
    }
    const tierName = tName.trim();
    if (!tierName) {
      setOpErr("Tier name is required.");
      return;
    }
    const rowsToSave = draftTasks.filter((d) => d.name.trim());
    if (rowsToSave.length === 0) {
      setOpErr("Add at least one task with a name.");
      return;
    }

    const today = todayISODate();
    const solId = nextAutoSolutionId(solutions);
    const tierId = nextAutoTierId(tiers);
    const d = fullPricingDerived;

    const solRow: Solution = {
      solution_id: solId,
      solution_name: solName,
      solution_created_date: today,
      solution_modified_date: today,
    };
    const { error: solErr } = await client.from("solutions").insert(solRow);
    if (solErr) {
      setOpErr(friendlyMutationMessage(solErr.message));
      return;
    }
    await logAudit(client, {
      entityType: "solutions",
      entityId: solId,
      action: "insert",
      before: null,
      after: rowJson(solRow),
    });

    const tierRow: SolutionTier = {
      solution_tier_id: tierId,
      solution_id: solId,
      solution_tier_name: tierName,
      solution_tier_owner: blankToNull(tOwner),
      solution_tier_overview: blankToNull(tOverview),
      solution_tier_overview_link: blankToNull(tLink),
      solution_tier_direction: blankToNull(tDirection),
      solution_tier_sop: blankToNull(tSop),
      solution_tier_resources: blankToNull(tRes),
      solution_tier_created_date: today,
      solution_tier_modified_date: today,
    };
    const { error: tierErr } = await client.from("solution_tiers").insert(tierRow);
    if (tierErr) {
      setOpErr(
        `${tierErr.message} (Solution ${solId} was created; finish in Update or delete the solution.)`
      );
      await onSaved();
      return;
    }
    await logAudit(client, {
      entityType: "solution_tiers",
      entityId: tierId,
      action: "insert",
      before: null,
      after: rowJson(tierRow),
    });

    let localTasks = [...tasks];
    for (const rowDraft of rowsToSave) {
      const taskId = nextAutoTaskId(localTasks);
      const taskRow: TaskRow = {
        task_id: taskId,
        solution_tier_id: tierId,
        task_name: rowDraft.name.trim(),
        task_implementer: blankToNull(rowDraft.impl),
        task_time: optNum(rowDraft.time),
        task_duration: optNum(rowDraft.dur),
        task_dependencies: blankToNull(rowDraft.dep),
        task_notes: blankToNull(rowDraft.notes),
        task_create_date: today,
        task_modified_date: today,
      };
      const { error: taskErr } = await client.from("tasks").insert(taskRow);
      if (taskErr) {
        setOpErr(
          `${taskErr.message} (Solution ${solId} and tier ${tierId} exist; add remaining tasks in Update.)`
        );
        await onSaved();
        return;
      }
      await logAudit(client, {
        entityType: "tasks",
        entityId: taskId,
        action: "insert",
        before: null,
        after: rowJson(taskRow),
      });
      localTasks.push(taskRow);
    }

    const pricingPayload: Record<string, unknown> = {
      solution_tier_id: tierId,
      solution_label: prSolLabel.trim() || null,
      tier: prTierLabel.trim() || null,
      scope: prScope.trim() || null,
      hours_client_services: fullPricingHours.client,
      hours_copy: fullPricingHours.copy,
      hours_design: fullPricingHours.design,
      hours_web_dev: fullPricingHours.web,
      hours_video: fullPricingHours.video,
      hours_data: fullPricingHours.data,
      hours_paid_media: fullPricingHours.paidMedia,
      hours_hubspot: fullPricingHours.hubspot,
      hours_other: fullPricingHours.other,
      total_hours: d.totalHours,
      expected_effort_base_price: d.expectedEffortBase,
      scope_risk: d.scopeRisk,
      internal_coordination: d.internalCoordination,
      client_revision_risk: d.clientRevisionRisk,
      risk_multiplier: d.riskMultiplier,
      risk_mitigated_base_price: d.riskMitigatedBase,
      strategic_value_score: d.strategicValueScore,
      strategic_value_multiplier: d.strategicMultiplier,
      sell_price: d.sellPrice,
      standalone_sell_price: parseNumStr(prStandalone),
      old_price: parseNumStr(prOldPrice),
      percent_change: prPctChg.trim() || null,
      requires_customization: prReqCustom,
      taxable: prTaxable,
      notes: prNotes.trim() || null,
      tags: prTags.trim() || null,
    };

    const prevPricing = tierPricing.find((p) => p.solution_tier_id === tierId) ?? null;
    const { error: prErr } = await client
      .from("solution_tier_pricing")
      .upsert(pricingPayload, { onConflict: "solution_tier_id" });
    if (prErr) {
      setOpErr(
        `${prErr.message} (Solution, tier, and tasks were saved; add pricing under Update.)`
      );
      await onSaved();
      return;
    }
    const afterPricing = { ...prevPricing, ...pricingPayload } as SolutionTierPricing;
    await logAudit(client, {
      entityType: "solution_tier_pricing",
      entityId: tierId,
      action: prevPricing ? "update" : "insert",
      before: prevPricing ? rowJson(prevPricing) : null,
      after: rowJson(afterPricing),
    });

    setOpOk(
      `Created solution ${solId}, tier ${tierId}, ${rowsToSave.length} task(s), and pricing (sell $${Math.round(d.sellPrice).toLocaleString()}).`
    );
    await onSaved();
    resetCreateWizard();
  };

  const insertTier = async () => {
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    const solId = tierOnlySolId.trim();
    if (!solId) {
      setOpErr("Select a solution first.");
      return;
    }
    const name = tName.trim();
    if (!name) {
      setOpErr("Tier name is required.");
      return;
    }
    const today = todayISODate();
    const id = nextAutoTierId(tiers);
    const row: SolutionTier = {
      solution_tier_id: id,
      solution_id: solId,
      solution_tier_name: name,
      solution_tier_owner: blankToNull(tOwner),
      solution_tier_overview: blankToNull(tOverview),
      solution_tier_overview_link: blankToNull(tLink),
      solution_tier_direction: blankToNull(tDirection),
      solution_tier_sop: blankToNull(tSop),
      solution_tier_resources: blankToNull(tRes),
      solution_tier_created_date: today,
      solution_tier_modified_date: today,
    };
    const { error } = await client.from("solution_tiers").insert(row);
    if (error) {
      setOpErr(error.message);
      return;
    }
    await logAudit(client, {
      entityType: "solution_tiers",
      entityId: id,
      action: "insert",
      before: null,
      after: rowJson(row),
    });
    setCtxSolutionId(solId);
    setCtxTierId(id);
    setCreatePhase("tasks");
    setDraftTasks([newDraftTaskRow()]);
    setTName("");
    setTOwner("");
    setTOverview("");
    setTLink("");
    setTDirection("");
    setTSop("");
    setTRes("");
    setOpOk(`Tier created as ${id}. Add every task for this tier, then save and continue to pricing.`);
    await onSaved();
  };

  const saveAllDraftTasksAndContinue = async () => {
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    const tierId = ctxTierId.trim();
    if (!tierId) {
      setOpErr("Missing tier context.");
      return;
    }
    const rowsToSave = draftTasks.filter((d) => d.name.trim());
    if (rowsToSave.length === 0) {
      setOpErr("Add at least one task with a name before continuing.");
      return;
    }
    const today = todayISODate();
    let localTasks = [...tasks];
    for (const d of rowsToSave) {
      const id = nextAutoTaskId(localTasks);
      const row: TaskRow = {
        task_id: id,
        solution_tier_id: tierId,
        task_name: d.name.trim(),
        task_implementer: blankToNull(d.impl),
        task_time: optNum(d.time),
        task_duration: optNum(d.dur),
        task_dependencies: blankToNull(d.dep),
        task_notes: blankToNull(d.notes),
        task_create_date: today,
        task_modified_date: today,
      };
      const { error } = await client.from("tasks").insert(row);
      if (error) {
        setOpErr(error.message);
        return;
      }
      await logAudit(client, {
        entityType: "tasks",
        entityId: id,
        action: "insert",
        before: null,
        after: rowJson(row),
      });
      localTasks.push(row);
    }
    setOpOk(`Saved ${rowsToSave.length} task(s). Fill in pricing next.`);
    setCreatePhase("pricing");
    await onSaved();
  };

  const updateDraftRow = (key: string, patch: Partial<DraftTaskRow>) => {
    setDraftTasks((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addDraftTaskRow = () => {
    setDraftTasks((list) => [...list, newDraftTaskRow()]);
  };

  const removeDraftTaskRow = (key: string) => {
    setDraftTasks((list) => (list.length <= 1 ? list : list.filter((r) => r.key !== key)));
  };

  // —— Update workspace ——
  const [updSolutionId, setUpdSolutionId] = useState("");
  const [updSolName, setUpdSolName] = useState("");

  const [updTierFocus, setUpdTierFocus] = useState("");
  const [updTierEditId, setUpdTierEditId] = useState<string | null>(null);
  const [updTName, setUpdTName] = useState("");
  const [updTOwner, setUpdTOwner] = useState("");
  const [updTOverview, setUpdTOverview] = useState("");
  const [updTLink, setUpdTLink] = useState("");
  const [updTDirection, setUpdTDirection] = useState("");
  const [updTSop, setUpdTSop] = useState("");
  const [updTRes, setUpdTRes] = useState("");

  const [updTaskEditId, setUpdTaskEditId] = useState<string | null>(null);
  const [updKName, setUpdKName] = useState("");
  const [updKImpl, setUpdKImpl] = useState("");
  const [updKTime, setUpdKTime] = useState("");
  const [updKDur, setUpdKDur] = useState("");
  const [updKDep, setUpdKDep] = useState("");
  const [updKNotes, setUpdKNotes] = useState("");

  const tiersOfUpdateSol = useMemo(() => {
    if (!updSolutionId) return [];
    return tiers
      .filter((t) => t.solution_id === updSolutionId)
      .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
  }, [tiers, updSolutionId]);

  const tierIdsInUpdateScope = useMemo(
    () => tiersOfUpdateSol.map((t) => t.solution_tier_id),
    [tiersOfUpdateSol]
  );

  const tasksOfFocusTier = useMemo(() => {
    if (!updTierFocus) return [];
    return tasks
      .filter((k) => k.solution_tier_id === updTierFocus)
      .sort((a, b) => sortId(a.task_id, b.task_id));
  }, [tasks, updTierFocus]);

  useEffect(() => {
    if (subTab !== "update") return;
    if (solutions.length === 0) {
      setUpdSolutionId("");
      return;
    }
    if (!updSolutionId || !solutions.some((x) => x.solution_id === updSolutionId)) {
      const first = [...solutions].sort((a, b) => sortId(a.solution_id, b.solution_id))[0];
      setUpdSolutionId(first.solution_id);
    }
  }, [subTab, solutions, updSolutionId]);

  useEffect(() => {
    if (subTab !== "update") return;
    const sol = solutions.find((x) => x.solution_id === updSolutionId);
    if (sol) setUpdSolName(sol.solution_name);
  }, [subTab, solutions, updSolutionId]);

  useEffect(() => {
    if (!updTierFocus || !tiersOfUpdateSol.some((t) => t.solution_tier_id === updTierFocus)) {
      setUpdTierFocus(tiersOfUpdateSol[0]?.solution_tier_id ?? "");
    }
  }, [tiersOfUpdateSol, updTierFocus]);

  const clearTierUpdateForm = () => {
    setUpdTierEditId(null);
    setUpdTName("");
    setUpdTOwner("");
    setUpdTOverview("");
    setUpdTLink("");
    setUpdTDirection("");
    setUpdTSop("");
    setUpdTRes("");
  };

  const clearTaskUpdateForm = () => {
    setUpdTaskEditId(null);
    setUpdKName("");
    setUpdKImpl("");
    setUpdKTime("");
    setUpdKDur("");
    setUpdKDep("");
    setUpdKNotes("");
  };

  useEffect(() => {
    if (subTab === "update") clearTaskUpdateForm();
  }, [updTierFocus, subTab]);

  const startEditTier = (t: SolutionTier) => {
    setUpdTierEditId(t.solution_tier_id);
    setUpdTName(t.solution_tier_name);
    setUpdTOwner(t.solution_tier_owner ?? "");
    setUpdTOverview(t.solution_tier_overview ?? "");
    setUpdTLink(t.solution_tier_overview_link ?? "");
    setUpdTDirection(t.solution_tier_direction ?? "");
    setUpdTSop(t.solution_tier_sop ?? "");
    setUpdTRes(t.solution_tier_resources ?? "");
  };

  const saveUpdateSolution = async () => {
    const client = getSupabase();
    if (!client || !updSolutionId) return;
    setOpErr(null);
    setOpOk(null);
    const prev = solutions.find((x) => x.solution_id === updSolutionId);
    if (!prev) return;
    const name = updSolName.trim();
    if (!name) {
      setOpErr("Solution name is required.");
      return;
    }
    const today = todayISODate();
    const { error } = await client
      .from("solutions")
      .update({ solution_name: name, solution_modified_date: today })
      .eq("solution_id", updSolutionId);
    if (error) {
      setOpErr(friendlyMutationMessage(error.message));
      return;
    }
    const after = { ...prev, solution_name: name, solution_modified_date: today };
    await logAudit(client, {
      entityType: "solutions",
      entityId: updSolutionId,
      action: "update",
      before: rowJson(prev),
      after: rowJson(after),
    });
    setOpOk("Solution saved.");
    await onSaved();
  };

  const deleteUpdateSolution = async () => {
    const client = getSupabase();
    if (!client || !updSolutionId) return;
    if (tiers.some((t) => t.solution_id === updSolutionId)) {
      setOpErr("Delete tiers under this solution first.");
      return;
    }
    setOpErr(null);
    setOpOk(null);
    const prev = solutions.find((x) => x.solution_id === updSolutionId);
    if (!prev) return;
    if (!window.confirm(`Delete solution "${prev.solution_name}" (${updSolutionId})?`)) return;
    const { error } = await client.from("solutions").delete().eq("solution_id", updSolutionId);
    if (error) {
      setOpErr(error.message);
      return;
    }
    await logAudit(client, {
      entityType: "solutions",
      entityId: updSolutionId,
      action: "delete",
      before: rowJson(prev),
      after: null,
    });
    setOpOk("Solution deleted.");
    clearTierUpdateForm();
    clearTaskUpdateForm();
    await onSaved();
  };

  const saveUpdateTier = async () => {
    const client = getSupabase();
    if (!client || !updSolutionId) return;
    setOpErr(null);
    setOpOk(null);
    const today = todayISODate();
    const payload = {
      solution_id: updSolutionId,
      solution_tier_name: updTName.trim(),
      solution_tier_owner: blankToNull(updTOwner),
      solution_tier_overview: blankToNull(updTOverview),
      solution_tier_overview_link: blankToNull(updTLink),
      solution_tier_direction: blankToNull(updTDirection),
      solution_tier_sop: blankToNull(updTSop),
      solution_tier_resources: blankToNull(updTRes),
      solution_tier_modified_date: today,
    };
    if (!payload.solution_tier_name) {
      setOpErr("Tier name is required.");
      return;
    }

    if (updTierEditId) {
      const prev = tiers.find((x) => x.solution_tier_id === updTierEditId);
      if (!prev) return;
      const { error } = await client.from("solution_tiers").update(payload).eq("solution_tier_id", updTierEditId);
      if (error) {
        setOpErr(error.message);
        return;
      }
      const after: SolutionTier = { ...prev, ...payload, solution_tier_id: updTierEditId };
      await logAudit(client, {
        entityType: "solution_tiers",
        entityId: updTierEditId,
        action: "update",
        before: rowJson(prev),
        after: rowJson(after),
      });
      setOpOk("Tier saved.");
      clearTierUpdateForm();
      await onSaved();
      return;
    }

    const id = nextAutoTierId(tiers);
    const row: SolutionTier = {
      solution_tier_id: id,
      solution_id: updSolutionId,
      solution_tier_name: payload.solution_tier_name,
      solution_tier_owner: payload.solution_tier_owner,
      solution_tier_overview: payload.solution_tier_overview,
      solution_tier_overview_link: payload.solution_tier_overview_link,
      solution_tier_direction: payload.solution_tier_direction,
      solution_tier_sop: payload.solution_tier_sop,
      solution_tier_resources: payload.solution_tier_resources,
      solution_tier_created_date: today,
      solution_tier_modified_date: today,
    };
    const { error } = await client.from("solution_tiers").insert(row);
    if (error) {
      setOpErr(error.message);
      return;
    }
    await logAudit(client, {
      entityType: "solution_tiers",
      entityId: id,
      action: "insert",
      before: null,
      after: rowJson(row),
    });
    setOpOk(`Tier created as ${id}.`);
    clearTierUpdateForm();
    setUpdTierFocus(id);
    await onSaved();
  };

  const deleteUpdateTier = async (t: SolutionTier) => {
    const client = getSupabase();
    if (!client) return;
    if (tasks.some((k) => k.solution_tier_id === t.solution_tier_id)) {
      setOpErr("Delete tasks under this tier first.");
      return;
    }
    setOpErr(null);
    setOpOk(null);
    const { error } = await client.from("solution_tiers").delete().eq("solution_tier_id", t.solution_tier_id);
    if (error) {
      setOpErr(error.message);
      return;
    }
    await logAudit(client, {
      entityType: "solution_tiers",
      entityId: t.solution_tier_id,
      action: "delete",
      before: rowJson(t),
      after: null,
    });
    if (updTierEditId === t.solution_tier_id) clearTierUpdateForm();
    if (updTierFocus === t.solution_tier_id) setUpdTierFocus("");
    setOpOk("Tier deleted.");
    await onSaved();
  };

  const saveUpdateTask = async () => {
    const client = getSupabase();
    if (!client || !updTierFocus) return;
    setOpErr(null);
    setOpOk(null);
    const today = todayISODate();
    const name = updKName.trim();
    if (!name) {
      setOpErr("Task name is required.");
      return;
    }
    const payload = {
      solution_tier_id: updTierFocus,
      task_name: name,
      task_implementer: blankToNull(updKImpl),
      task_time: optNum(updKTime),
      task_duration: optNum(updKDur),
      task_dependencies: blankToNull(updKDep),
      task_notes: blankToNull(updKNotes),
      task_modified_date: today,
    };

    if (updTaskEditId) {
      const prev = tasks.find((x) => x.task_id === updTaskEditId);
      if (!prev) return;
      const { error } = await client.from("tasks").update(payload).eq("task_id", updTaskEditId);
      if (error) {
        setOpErr(error.message);
        return;
      }
      const after: TaskRow = { ...prev, ...payload, task_id: updTaskEditId };
      await logAudit(client, {
        entityType: "tasks",
        entityId: updTaskEditId,
        action: "update",
        before: rowJson(prev),
        after: rowJson(after),
      });
      setOpOk("Task saved.");
      clearTaskUpdateForm();
      await onSaved();
      return;
    }

    const id = nextAutoTaskId(tasks);
    const row: TaskRow = {
      task_id: id,
      ...payload,
      task_create_date: today,
      task_modified_date: today,
    };
    const { error } = await client.from("tasks").insert(row);
    if (error) {
      setOpErr(error.message);
      return;
    }
    await logAudit(client, {
      entityType: "tasks",
      entityId: id,
      action: "insert",
      before: null,
      after: rowJson(row),
    });
    setOpOk(`Task created as ${id}.`);
    clearTaskUpdateForm();
    await onSaved();
  };

  const deleteUpdateTask = async (k: TaskRow) => {
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    const { error } = await client.from("tasks").delete().eq("task_id", k.task_id);
    if (error) {
      setOpErr(error.message);
      return;
    }
    await logAudit(client, {
      entityType: "tasks",
      entityId: k.task_id,
      action: "delete",
      before: rowJson(k),
      after: null,
    });
    if (updTaskEditId === k.task_id) clearTaskUpdateForm();
    setOpOk("Task deleted.");
    await onSaved();
  };

  const startEditTask = (k: TaskRow) => {
    setUpdTaskEditId(k.task_id);
    setUpdKName(k.task_name);
    setUpdKImpl(k.task_implementer ?? "");
    setUpdKTime(k.task_time != null ? String(k.task_time) : "");
    setUpdKDur(k.task_duration != null ? String(k.task_duration) : "");
    setUpdKDep(k.task_dependencies ?? "");
    setUpdKNotes(k.task_notes ?? "");
  };

  const tierFormTierOnly = (
    <>
      <label style={lbl}>
        <AdminFieldCaption>Attach to solution</AdminFieldCaption>
        <select style={input} value={tierOnlySolId} onChange={(e) => setTierOnlySolId(e.target.value)}>
          {solutions.map((sol) => (
            <option key={sol.solution_id} value={sol.solution_id}>
              {sol.solution_name} ({sol.solution_id})
            </option>
          ))}
        </select>
      </label>
      <label style={lbl}>
        <AdminFieldCaption>Tier id (assigned on save)</AdminFieldCaption>
        <input style={{ ...input, opacity: 0.85 }} readOnly value={previewTierId || "—"} tabIndex={-1} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Tier name</AdminFieldCaption>
        <input style={input} value={tName} onChange={(e) => setTName(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Owner</AdminFieldCaption>
        <input style={input} value={tOwner} onChange={(e) => setTOwner(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Overview</AdminFieldCaption>
        <textarea style={textarea} rows={3} value={tOverview} onChange={(e) => setTOverview(e.target.value)} />
      </label>
      <label style={lbl}>
        <AdminFieldCaption>Overview link</AdminFieldCaption>
        <input style={input} value={tLink} onChange={(e) => setTLink(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Direction</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={tDirection} onChange={(e) => setTDirection(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>SOP</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={tSop} onChange={(e) => setTSop(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Resources</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={tRes} onChange={(e) => setTRes(e.target.value)} />
      </label>
    </>
  );

  const tierFormUpdateFields = (
    <div className="admin-form-stack" style={formGrid}>
      <label style={lbl}>
        <AdminFieldCaption>Tier id</AdminFieldCaption>
        <input
          style={input}
          readOnly
          disabled={!updTierEditId}
          value={updTierEditId ?? nextAutoTierId(tiers)}
          title={updTierEditId ? "Locked" : "Next id on create"}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Tier name</AdminFieldCaption>
        <input style={input} value={updTName} onChange={(e) => setUpdTName(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Owner</AdminFieldCaption>
        <input style={input} value={updTOwner} onChange={(e) => setUpdTOwner(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Overview</AdminFieldCaption>
        <textarea style={textarea} rows={3} value={updTOverview} onChange={(e) => setUpdTOverview(e.target.value)} />
      </label>
      <label style={lbl}>
        <AdminFieldCaption>Overview link</AdminFieldCaption>
        <input style={input} value={updTLink} onChange={(e) => setUpdTLink(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Direction</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={updTDirection} onChange={(e) => setUpdTDirection(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>SOP</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={updTSop} onChange={(e) => setUpdTSop(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Resources</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={updTRes} onChange={(e) => setUpdTRes(e.target.value)} />
      </label>
    </div>
  );

  const taskFormUpdateFields = (
    <div className="admin-form-stack" style={formGrid}>
      <label style={lbl}>
        <AdminFieldCaption>Task id</AdminFieldCaption>
        <input
          style={input}
          readOnly
          disabled={!updTaskEditId}
          value={updTaskEditId ?? nextAutoTaskId(tasks)}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Task name</AdminFieldCaption>
        <input style={input} value={updKName} onChange={(e) => setUpdKName(e.target.value)} />
      </label>
      <label style={lbl}>
        <AdminFieldCaption>Implementer</AdminFieldCaption>
        <input style={input} value={updKImpl} onChange={(e) => setUpdKImpl(e.target.value)} />
      </label>
      <label style={lbl}>
        <AdminFieldCaption>Time</AdminFieldCaption>
        <input style={input} value={updKTime} onChange={(e) => setUpdKTime(e.target.value)} />
      </label>
      <label style={lbl}>
        <AdminFieldCaption>Duration</AdminFieldCaption>
        <input style={input} value={updKDur} onChange={(e) => setUpdKDur(e.target.value)} />
      </label>
      <label style={lbl}>
        <AdminFieldCaption>Dependencies</AdminFieldCaption>
        <input style={input} value={updKDep} onChange={(e) => setUpdKDep(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Notes</AdminFieldCaption>
        <input style={input} value={updKNotes} onChange={(e) => setUpdKNotes(e.target.value)} />
      </label>
    </div>
  );

  return (
    <section className="admin-panel admin-panel--editor" style={panel}>
      <div className="admin-editor-layout admin-editor-layout--wide">
        <h2 style={h2}>Solutions Builder</h2>
        <p className="admin-intro" style={muted}>
          Create or update solutions, tiers, tasks, and pricing. Auto-ids follow: packages <code>1-</code>, solutions{" "}
          <code>2-</code>, solution tiers <code>3-</code>, tasks <code>4-</code>.
        </p>

        {subTab === "create" && (
          <>
            {createPhase === "choose" && (
              <>
                <h3 style={sectionTitle}>What do you want to create?</h3>
                <div style={choiceRow}>
                  <button
                    type="button"
                    style={choiceCard}
                    onClick={() => {
                      setCreateBranch("full");
                      setCreatePhase("foundation");
                      setOpErr(null);
                      setOpOk(null);
                    }}
                  >
                    <strong>New solution</strong>
                    <p style={{ ...muted, margin: "0.5rem 0 0", fontSize: "0.82rem", lineHeight: 1.45 }}>
                      One page: solution, tier, tasks, and pricing. Nothing is saved until you click{" "}
                      <strong>Create entire solution</strong>.
                    </p>
                  </button>
                  <button
                    type="button"
                    style={{
                      ...choiceCard,
                      opacity: solutions.length === 0 ? 0.55 : 1,
                      cursor: solutions.length === 0 ? "not-allowed" : "pointer",
                    }}
                    disabled={solutions.length === 0}
                    onClick={() => {
                      if (solutions.length === 0) return;
                      setCreateBranch("tier_only");
                      setCreatePhase("tier");
                      setTierOnlySolId(solutions[0]?.solution_id ?? "");
                      setOpErr(null);
                      setOpOk(null);
                    }}
                  >
                    <strong>New tier on existing solution</strong>
                    <p style={{ ...muted, margin: "0.5rem 0 0", fontSize: "0.82rem", lineHeight: 1.45 }}>
                      Pick a solution, add a tier with an auto id, then tasks and pricing for that tier.
                      {solutions.length === 0 ? " Add a solution first (full path or elsewhere)." : ""}
                    </p>
                  </button>
                </div>
              </>
            )}

            {createPhase === "foundation" && createBranch === "full" && (
              <div style={{ marginTop: "0.75rem" }}>
                <h3 style={sectionTitle}>New solution — one page, one save</h3>
                <p style={{ ...muted, marginTop: 0 }}>
                  Fill each section below, then click <strong>Create entire solution</strong>. Nothing is written to the
                  database until then.
                </p>
                <div style={idLegendBar}>
                  <strong style={{ color: "var(--text)" }}>Id prefixes:</strong> package <code>1-</code> · solution{" "}
                  <code>2-</code> · solution tier <code>3-</code> · task <code>4-</code>. On this save: solution{" "}
                  <code>{previewSolutionId}</code>, tier <code>{previewTierId}</code>, tasks from{" "}
                  <code>{previewTaskId}</code> upward.
                </div>

                <div style={formSectionBox}>
                  <h4 style={formSectionHeading}>Section 1 — Solution &amp; tier</h4>
                  <p style={{ ...muted, marginTop: 0, marginBottom: "0.75rem" }}>
                    Names and metadata for the new solution row (<code>2-…</code>) and its first tier (<code>3-…</code>
                    ).
                  </p>
                  <div className="admin-form-stack" style={formGrid}>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Solution name</AdminFieldCaption>
                    <input style={input} value={solNameDraft} onChange={(e) => setSolNameDraft(e.target.value)} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Tier name</AdminFieldCaption>
                    <input style={input} value={tName} onChange={(e) => setTName(e.target.value)} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Owner</AdminFieldCaption>
                    <input style={input} value={tOwner} onChange={(e) => setTOwner(e.target.value)} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Overview</AdminFieldCaption>
                    <textarea style={textarea} rows={3} value={tOverview} onChange={(e) => setTOverview(e.target.value)} />
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Overview link</AdminFieldCaption>
                    <input style={input} value={tLink} onChange={(e) => setTLink(e.target.value)} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Direction</AdminFieldCaption>
                    <textarea style={textarea} rows={2} value={tDirection} onChange={(e) => setTDirection(e.target.value)} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>SOP</AdminFieldCaption>
                    <textarea style={textarea} rows={2} value={tSop} onChange={(e) => setTSop(e.target.value)} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Resources</AdminFieldCaption>
                    <textarea style={textarea} rows={2} value={tRes} onChange={(e) => setTRes(e.target.value)} />
                  </label>
                  </div>
                </div>

                <div style={formSectionBox}>
                  <h4 style={formSectionHeading}>Section 2 — Tasks</h4>
                  <p style={{ ...muted, marginTop: 0, marginBottom: "0.75rem" }}>
                    Each saved row becomes a task with id <code>4-…</code>, linked to the new tier. At least one row
                    needs a task name.
                  </p>
                <div className="admin-actions-row" style={{ marginTop: 0 }}>
                  <button type="button" style={btn} onClick={() => addDraftTaskRow()}>
                    Add task row
                  </button>
                </div>
                <div className="admin-table-scroll" style={{ marginTop: 8 }}>
                  <table className="admin-data-table" style={{ ...tbl, minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th style={th}>Task name</th>
                        <th style={th}>Implementer</th>
                        <th style={th}>Time</th>
                        <th style={th}>Duration</th>
                        <th style={th}>Dependencies</th>
                        <th style={th}>Notes</th>
                        <th style={{ ...th, width: 90 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {draftTasks.map((d) => (
                        <tr key={d.key}>
                          <td style={td}>
                            <input
                              style={input}
                              value={d.name}
                              onChange={(e) => updateDraftRow(d.key, { name: e.target.value })}
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={input}
                              value={d.impl}
                              onChange={(e) => updateDraftRow(d.key, { impl: e.target.value })}
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={input}
                              value={d.time}
                              onChange={(e) => updateDraftRow(d.key, { time: e.target.value })}
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={input}
                              value={d.dur}
                              onChange={(e) => updateDraftRow(d.key, { dur: e.target.value })}
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={input}
                              value={d.dep}
                              onChange={(e) => updateDraftRow(d.key, { dep: e.target.value })}
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={input}
                              value={d.notes}
                              onChange={(e) => updateDraftRow(d.key, { notes: e.target.value })}
                            />
                          </td>
                          <td style={td}>
                            <button type="button" style={btnDangerSm} onClick={() => removeDraftTaskRow(d.key)}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                </div>

                <div style={formSectionBox}>
                  <h4 style={formSectionHeading}>Section 3 — Tier pricing</h4>
                  <p style={{ ...muted, marginTop: 0, marginBottom: "0.65rem" }}>
                    Same rules as the Pricing tab. Base rate {TIER_PRICING_HOURLY_RATE}
                    /hr; sell updates from hours and scores.
                  </p>
                  <div className="admin-form-stack" style={formGrid}>
                  <div style={{ ...formSubHeading, gridColumn: "1 / -1", marginTop: 0 }}>Labels &amp; scope</div>
                  <label style={lbl}>
                    <AdminFieldCaption>Solution label</AdminFieldCaption>
                    <input style={input} value={prSolLabel} onChange={(e) => setPrSolLabel(e.target.value)} />
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Tier label</AdminFieldCaption>
                    <input style={input} value={prTierLabel} onChange={(e) => setPrTierLabel(e.target.value)} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Scope</AdminFieldCaption>
                    <textarea style={textarea} rows={2} value={prScope} onChange={(e) => setPrScope(e.target.value)} />
                  </label>
                  <div style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Hours</div>
                  {(
                    [
                      ["Client services", prHCs, setPrHCs],
                      ["Copy", prHCp, setPrHCp],
                      ["Design", prHDs, setPrHDs],
                      ["Web dev", prHWd, setPrHWd],
                      ["Video", prHVi, setPrHVi],
                      ["Data", prHDa, setPrHDa],
                      ["Paid media", prHPm, setPrHPm],
                      ["HubSpot", prHHb, setPrHHb],
                      ["Other", prHOt, setPrHOt],
                    ] as const
                  ).map(([lab, val, set]) => (
                    <label key={lab} style={lbl}>
                      <AdminFieldCaption>{lab} (hours)</AdminFieldCaption>
                      <input style={input} value={val} onChange={(e) => set(e.target.value)} />
                    </label>
                  ))}
                  <label style={lbl}>
                    <AdminFieldCaption>Total hours</AdminFieldCaption>
                    <input
                      style={{ ...input, cursor: "default" }}
                      readOnly
                      tabIndex={-1}
                      value={
                        Number.isFinite(fullPricingDerived.totalHours)
                          ? fullPricingDerived.totalHours.toLocaleString(undefined, {
                              maximumFractionDigits: 2,
                              minimumFractionDigits: 0,
                            })
                          : "0"
                      }
                    />
                  </label>
                  <div style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Risk &amp; value</div>
                  <label style={lbl}>
                    <AdminFieldCaption>Scope risk</AdminFieldCaption>
                    <select style={input} value={prScopeRisk} onChange={(e) => setPrScopeRisk(e.target.value)}>
                      {SCORE012.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Internal coordination</AdminFieldCaption>
                    <select style={input} value={prInternalCoord} onChange={(e) => setPrInternalCoord(e.target.value)}>
                      {SCORE012.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Client revision risk</AdminFieldCaption>
                    <select style={input} value={prClientRev} onChange={(e) => setPrClientRev(e.target.value)}>
                      {SCORE012.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Strategic value</AdminFieldCaption>
                    <select style={input} value={prStratScore} onChange={(e) => setPrStratScore(e.target.value)}>
                      {STRATEGIC_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Sell price (calculated)</AdminFieldCaption>
                    <input
                      style={{ ...input, cursor: "default" }}
                      readOnly
                      tabIndex={-1}
                      value={`$${Math.round(fullPricingDerived.sellPrice).toLocaleString()}`}
                    />
                  </label>
                  <div style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Optional</div>
                  <label style={lbl}>
                    <AdminFieldCaption>Standalone sell</AdminFieldCaption>
                    <input style={input} value={prStandalone} onChange={(e) => setPrStandalone(e.target.value)} />
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Old price</AdminFieldCaption>
                    <input style={input} value={prOldPrice} onChange={(e) => setPrOldPrice(e.target.value)} />
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Percent change</AdminFieldCaption>
                    <input style={input} value={prPctChg} onChange={(e) => setPrPctChg(e.target.value)} />
                  </label>
                  <label style={{ ...lbl, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" checked={prReqCustom} onChange={(e) => setPrReqCustom(e.target.checked)} />
                    Requires customization
                  </label>
                  <label style={{ ...lbl, flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <input type="checkbox" checked={prTaxable} onChange={(e) => setPrTaxable(e.target.checked)} />
                    Taxable
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Notes</AdminFieldCaption>
                    <textarea style={textarea} rows={2} value={prNotes} onChange={(e) => setPrNotes(e.target.value)} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Tags</AdminFieldCaption>
                    <input style={input} value={prTags} onChange={(e) => setPrTags(e.target.value)} />
                  </label>
                  </div>
                </div>

                <div className="admin-actions-row" style={{ marginTop: 16 }}>
                  <button
                    type="button"
                    className="admin-btn-primary"
                    style={btnPrimary}
                    onClick={() => void createFullSolutionStack()}
                  >
                    Create entire solution
                  </button>
                  <button type="button" style={btn} onClick={resetCreateWizard}>
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {createPhase === "tier" && createBranch === "tier_only" && (
              <div style={sectionWrap}>
                <h3 style={sectionTitle}>Step 1 — Solution tier</h3>
                <div className="admin-form-stack" style={formGrid}>{tierFormTierOnly}</div>
                <div className="admin-actions-row" style={{ marginTop: 10 }}>
                  <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void insertTier()}>
                    Create tier &amp; continue
                  </button>
                  <button type="button" style={btn} onClick={resetCreateWizard}>
                    Back
                  </button>
                </div>
              </div>
            )}

            {createPhase === "tasks" && createBranch === "tier_only" && (
              <div style={sectionWrap}>
                <h3 style={sectionTitle}>Step 2 — Tasks</h3>
                <p style={{ ...muted, marginTop: 0 }}>
                  Solution <code>{ctxSolutionId}</code>, tier <code>{ctxTierId}</code>. Add every task row (at least one
                  with a name). Task ids are assigned on save. Then continue to pricing.
                </p>
                <div className="admin-actions-row" style={{ marginTop: 8 }}>
                  <button type="button" style={btn} onClick={() => addDraftTaskRow()}>
                    Add task row
                  </button>
                </div>
                <div className="admin-table-scroll" style={{ marginTop: 8 }}>
                  <table className="admin-data-table" style={{ ...tbl, minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th style={th}>Task name</th>
                        <th style={th}>Implementer</th>
                        <th style={th}>Time</th>
                        <th style={th}>Duration</th>
                        <th style={th}>Dependencies</th>
                        <th style={th}>Notes</th>
                        <th style={{ ...th, width: 90 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {draftTasks.map((d) => (
                        <tr key={d.key}>
                          <td style={td}>
                            <input
                              style={input}
                              value={d.name}
                              onChange={(e) => updateDraftRow(d.key, { name: e.target.value })}
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={input}
                              value={d.impl}
                              onChange={(e) => updateDraftRow(d.key, { impl: e.target.value })}
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={input}
                              value={d.time}
                              onChange={(e) => updateDraftRow(d.key, { time: e.target.value })}
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={input}
                              value={d.dur}
                              onChange={(e) => updateDraftRow(d.key, { dur: e.target.value })}
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={input}
                              value={d.dep}
                              onChange={(e) => updateDraftRow(d.key, { dep: e.target.value })}
                            />
                          </td>
                          <td style={td}>
                            <input
                              style={input}
                              value={d.notes}
                              onChange={(e) => updateDraftRow(d.key, { notes: e.target.value })}
                            />
                          </td>
                          <td style={td}>
                            <button type="button" style={btnDangerSm} onClick={() => removeDraftTaskRow(d.key)}>
                              Remove
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="admin-actions-row" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    className="admin-btn-primary"
                    style={btnPrimary}
                    onClick={() => void saveAllDraftTasksAndContinue()}
                  >
                    Save all tasks &amp; continue to pricing
                  </button>
                  <button type="button" style={btn} onClick={() => setCreatePhase("tier")}>
                    Back
                  </button>
                </div>
              </div>
            )}

            {createPhase === "pricing" && createBranch === "tier_only" && ctxTierId && (
              <div style={sectionWrap}>
                <h3 style={sectionTitle}>Step 3 — Pricing</h3>
                <p style={{ ...muted, marginTop: 0 }}>
                  Solution <code>{ctxSolutionId}</code>, tier <code>{ctxTierId}</code>. Save pricing below, then finish.
                </p>
                <PricingPanel
                  key={ctxTierId}
                  subTab="create"
                  tiers={tiers}
                  pricing={tierPricing}
                  panelStyle={{ ...panel, marginBottom: 0 }}
                  formGrid={formGrid}
                  lbl={lbl}
                  input={input}
                  textarea={textarea}
                  btn={btn}
                  btnPrimary={btnPrimary}
                  btnSm={btnSm}
                  tbl={tbl}
                  th={th}
                  td={td}
                  h2={{ ...h2, fontSize: "0.95rem" }}
                  muted={muted}
                  onSaved={onSaved}
                  setOpErr={setOpErr}
                  setOpOk={setOpOk}
                  logAudit={logAudit}
                  tierIdsInScope={[ctxTierId]}
                  createLockedTierId={ctxTierId}
                />
                <div className="admin-actions-row" style={{ marginTop: 12 }}>
                  <button type="button" style={btn} onClick={resetCreateWizard}>
                    Done — start another
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {subTab === "update" && (
          <>
            <label style={{ ...lbl, maxWidth: 420, marginTop: 8 }}>
              <AdminFieldCaption>Solution</AdminFieldCaption>
              <select style={input} value={updSolutionId} onChange={(e) => setUpdSolutionId(e.target.value)}>
                {[...solutions]
                  .sort((a, b) => sortId(a.solution_id, b.solution_id))
                  .map((sol) => (
                    <option key={sol.solution_id} value={sol.solution_id}>
                      {sol.solution_name} ({sol.solution_id})
                    </option>
                  ))}
              </select>
            </label>

            <div style={sectionWrap}>
              <h3 style={sectionTitle}>Solution</h3>
              <div className="admin-form-stack" style={formGrid}>
                <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                  <AdminFieldCaption>Name</AdminFieldCaption>
                  <input style={input} value={updSolName} onChange={(e) => setUpdSolName(e.target.value)} />
                </label>
              </div>
              <div className="admin-actions-row" style={{ marginTop: 8 }}>
                <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void saveUpdateSolution()}>
                  Save solution
                </button>
                <button type="button" style={btnDangerSm} onClick={() => void deleteUpdateSolution()}>
                  Delete solution
                </button>
              </div>
            </div>

            <div style={sectionWrap}>
              <h3 style={sectionTitle}>Tiers</h3>
              <div className="admin-table-scroll">
                <table className="admin-data-table" style={{ ...tbl, marginTop: 4 }}>
                  <thead>
                    <tr>
                      <th style={th}>Id</th>
                      <th style={th}>Name</th>
                      <th style={th} />
                    </tr>
                  </thead>
                  <tbody>
                    {tiersOfUpdateSol.map((t) => (
                      <tr key={t.solution_tier_id}>
                        <td style={td}>{t.solution_tier_id}</td>
                        <td style={td}>{t.solution_tier_name}</td>
                        <td style={td}>
                          <button type="button" style={btnSm} onClick={() => startEditTier(t)}>
                            Edit
                          </button>{" "}
                          <button type="button" style={btnDangerSm} onClick={() => void deleteUpdateTier(t)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {tiersOfUpdateSol.length === 0 ? (
                <p style={{ ...muted, marginTop: 8 }}>No tiers yet. Add one with the form below.</p>
              ) : null}
              <h4 style={{ ...sectionTitle, marginTop: "1rem", fontSize: "0.88rem" }}>
                {updTierEditId ? `Edit tier ${updTierEditId}` : "Add tier"}
              </h4>
              {tierFormUpdateFields}
              <div className="admin-actions-row" style={{ marginTop: 8 }}>
                <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void saveUpdateTier()}>
                  {updTierEditId ? "Save tier" : "Create tier"}
                </button>
                {updTierEditId ? (
                  <button type="button" style={btn} onClick={clearTierUpdateForm}>
                    Cancel
                  </button>
                ) : null}
              </div>
            </div>

            <div style={sectionWrap}>
              <h3 style={sectionTitle}>Tasks &amp; pricing (pick tier)</h3>
              <label style={{ ...lbl, maxWidth: 420 }}>
                <AdminFieldCaption>Tier for tasks &amp; pricing</AdminFieldCaption>
                <select style={input} value={updTierFocus} onChange={(e) => setUpdTierFocus(e.target.value)}>
                  {tiersOfUpdateSol.map((t) => (
                    <option key={t.solution_tier_id} value={t.solution_tier_id}>
                      {t.solution_tier_name} ({t.solution_tier_id})
                    </option>
                  ))}
                </select>
              </label>
              {tiersOfUpdateSol.length === 0 ? (
                <p style={{ ...muted, marginTop: 8 }}>Add a tier above to manage tasks and pricing.</p>
              ) : (
                <>
                  <h4 style={{ ...sectionTitle, marginTop: "1rem", fontSize: "0.88rem" }}>Tasks</h4>
                  <div className="admin-table-scroll">
                    <table className="admin-data-table" style={{ ...tbl, marginTop: 4 }}>
                      <thead>
                        <tr>
                          <th style={th}>Id</th>
                          <th style={th}>Name</th>
                          <th style={th} />
                        </tr>
                      </thead>
                      <tbody>
                        {tasksOfFocusTier.map((k) => (
                          <tr key={k.task_id}>
                            <td style={td}>{k.task_id}</td>
                            <td style={td}>{k.task_name}</td>
                            <td style={td}>
                              <button type="button" style={btnSm} onClick={() => startEditTask(k)}>
                                Edit
                              </button>{" "}
                              <button type="button" style={btnDangerSm} onClick={() => void deleteUpdateTask(k)}>
                                Delete
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <h4 style={{ ...sectionTitle, marginTop: "1rem", fontSize: "0.88rem" }}>
                    {updTaskEditId ? `Edit task ${updTaskEditId}` : "Add task"}
                  </h4>
                  {taskFormUpdateFields}
                  <div className="admin-actions-row" style={{ marginTop: 8 }}>
                    <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void saveUpdateTask()}>
                      {updTaskEditId ? "Save task" : "Create task"}
                    </button>
                    {updTaskEditId ? (
                      <button type="button" style={btn} onClick={clearTaskUpdateForm}>
                        Cancel
                      </button>
                    ) : null}
                  </div>

                  <PricingPanel
                    subTab="update"
                    tiers={tiers}
                    pricing={tierPricing}
                    panelStyle={{ ...panel, marginTop: "1.25rem", marginBottom: 0 }}
                    formGrid={formGrid}
                    lbl={lbl}
                    input={input}
                    textarea={textarea}
                    btn={btn}
                    btnPrimary={btnPrimary}
                    btnSm={btnSm}
                    tbl={tbl}
                    th={th}
                    td={td}
                    h2={{ ...h2, fontSize: "0.95rem" }}
                    muted={muted}
                    onSaved={onSaved}
                    setOpErr={setOpErr}
                    setOpOk={setOpOk}
                    logAudit={logAudit}
                    tierIdsInScope={tierIdsInUpdateScope.length > 0 ? tierIdsInUpdateScope : null}
                  />
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
