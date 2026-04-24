import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../lib/audit";
import { todayISODate } from "../lib/dates";
import { getSupabase } from "../lib/supabase";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { buildImplementerToGroupMap, rollUpTaskTimesByPricingGroup } from "../lib/taskHoursRollup";
import type { ImplementerHourGroupRow, Solution, SolutionTier, SolutionTierPricing, TaskRow } from "../types";
import { percentChangeFromSellAndOld } from "../lib/pricingPercentChange";
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

function firstTaskMatchingName(tasks: TaskRow[], name: string): TaskRow | null {
  const t = name.trim();
  if (!t) return null;
  for (const k of tasks) {
    if (k.task_name.trim() === t) return k;
  }
  return null;
}

function autofillFromTask(t: TaskRow) {
  return {
    impl: t.task_implementer ?? "",
    time: t.task_time != null ? String(t.task_time) : "",
    dur: t.task_duration != null ? String(t.task_duration) : "",
    dep: t.task_dependencies ?? "",
    notes: t.task_notes ?? "",
  };
}

function TaskImplementerSelect({
  value,
  options,
  inputStyle,
  onChange,
}: {
  value: string;
  options: string[];
  inputStyle: CSSProperties;
  onChange: (value: string) => void;
}) {
  const merged = useMemo(() => {
    const s = new Set(options);
    const out = [...options];
    if (value.trim() && !s.has(value)) out.push(value);
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [options, value]);
  return (
    <select style={inputStyle} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {merged.map((x) => (
        <option key={x} value={x}>
          {x}
        </option>
      ))}
    </select>
  );
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
  implementerHourGroups = [],
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
  implementerHourGroups?: ImplementerHourGroupRow[];
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
  const [tSop, setTSop] = useState("");
  const [tWhatIsIt, setTWhatIsIt] = useState("");
  const [tWhyValuable, setTWhyValuable] = useState("");
  const [tWhenUsed, setTWhenUsed] = useState("");
  const [tAssumptionPrereq, setTAssumptionPrereq] = useState("");
  const [tInScope, setTInScope] = useState("");
  const [tOutScope, setTOutScope] = useState("");
  const [tFinalDeliverable, setTFinalDeliverable] = useState("");
  const [tHowWorkDone, setTHowWorkDone] = useState("");
  const [tDescribedToClient, setTDescribedToClient] = useState("");
  const [tRes, setTRes] = useState("");

  /** When set, new tier inserts also copy hidden legacy fields (overview, link, direction) from this row. */
  const [createAutofillFrom, setCreateAutofillFrom] = useState<SolutionTier | null>(null);
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
  const [prOldPrice, setPrOldPrice] = useState("");
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
    setTSop("");
    setTWhatIsIt("");
    setTWhyValuable("");
    setTWhenUsed("");
    setTAssumptionPrereq("");
    setTInScope("");
    setTOutScope("");
    setTFinalDeliverable("");
    setTHowWorkDone("");
    setTDescribedToClient("");
    setTRes("");
    setCreateAutofillFrom(null);
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
    setPrOldPrice("");
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
  const taskNameDatalistId = useId();
  const sortedTaskNamesForDatalist = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const k of tasks) {
      const n = k.task_name.trim();
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [tasks]);
  const distinctImplementerOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const k of tasks) {
      const v = (k.task_implementer ?? "").trim();
      if (v) seen.add(v);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [tasks]);

  const sortedTiersForAutofill = useMemo(
    () => [...tiers].sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id)),
    [tiers]
  );
  const solutionNameForTier = (solutionId: string) =>
    solutions.find((s) => s.solution_id === solutionId)?.solution_name ?? solutionId;

  const onCreateAutofillSelect = (value: string) => {
    if (!value) {
      setCreateAutofillFrom(null);
      return;
    }
    const t = tiers.find((x) => x.solution_tier_id === value);
    if (!t) return;
    setCreateAutofillFrom(t);
    setTName(t.solution_tier_name);
    setTOwner(t.solution_tier_owner ?? "");
    setTSop(t.solution_tier_sop ?? "");
    setTWhatIsIt(t.solution_tier_what_is_it ?? "");
    setTWhyValuable(t.solution_tier_why_is_it_valuable ?? "");
    setTWhenUsed(t.solution_tier_when_should_it_be_used ?? "");
    setTAssumptionPrereq(t.solution_tier_assumption_prerequisites ?? "");
    setTInScope(t.solution_tier_in_scope ?? "");
    setTOutScope(t.solution_tier_out_of_scope ?? "");
    setTFinalDeliverable(t.solution_tier_final_deliverable ?? "");
    setTHowWorkDone(t.solution_tier_how_do_we_get_this_work_done ?? "");
    setTDescribedToClient(t.solution_tier_described_to_client ?? "");
    setTRes(t.solution_tier_resources ?? "");
  };

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

  const prPercentFromOld = useMemo(
    () => percentChangeFromSellAndOld(fullPricingDerived.sellPrice, prOldPrice),
    [fullPricingDerived.sellPrice, prOldPrice]
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

    const leg = createAutofillFrom;
    const tierRow: SolutionTier = {
      solution_tier_id: tierId,
      solution_id: solId,
      solution_tier_name: tierName,
      solution_tier_owner: blankToNull(tOwner),
      solution_tier_overview: leg ? leg.solution_tier_overview : null,
      solution_tier_overview_link: leg ? leg.solution_tier_overview_link : null,
      solution_tier_direction: leg ? leg.solution_tier_direction : null,
      solution_tier_sop: blankToNull(tSop),
      solution_tier_resources: blankToNull(tRes),
      solution_tier_what_is_it: blankToNull(tWhatIsIt),
      solution_tier_why_is_it_valuable: blankToNull(tWhyValuable),
      solution_tier_when_should_it_be_used: blankToNull(tWhenUsed),
      solution_tier_assumption_prerequisites: blankToNull(tAssumptionPrereq),
      solution_tier_in_scope: blankToNull(tInScope),
      solution_tier_out_of_scope: blankToNull(tOutScope),
      solution_tier_final_deliverable: blankToNull(tFinalDeliverable),
      solution_tier_how_do_we_get_this_work_done: blankToNull(tHowWorkDone),
      solution_tier_described_to_client: blankToNull(tDescribedToClient),
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
      standalone_sell_price: null,
      old_price: parseNumStr(prOldPrice),
      percent_change: percentChangeFromSellAndOld(d.sellPrice, prOldPrice).forDb,
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
    const leg = createAutofillFrom;
    const row: SolutionTier = {
      solution_tier_id: id,
      solution_id: solId,
      solution_tier_name: name,
      solution_tier_owner: blankToNull(tOwner),
      solution_tier_overview: leg ? leg.solution_tier_overview : null,
      solution_tier_overview_link: leg ? leg.solution_tier_overview_link : null,
      solution_tier_direction: leg ? leg.solution_tier_direction : null,
      solution_tier_sop: blankToNull(tSop),
      solution_tier_resources: blankToNull(tRes),
      solution_tier_what_is_it: blankToNull(tWhatIsIt),
      solution_tier_why_is_it_valuable: blankToNull(tWhyValuable),
      solution_tier_when_should_it_be_used: blankToNull(tWhenUsed),
      solution_tier_assumption_prerequisites: blankToNull(tAssumptionPrereq),
      solution_tier_in_scope: blankToNull(tInScope),
      solution_tier_out_of_scope: blankToNull(tOutScope),
      solution_tier_final_deliverable: blankToNull(tFinalDeliverable),
      solution_tier_how_do_we_get_this_work_done: blankToNull(tHowWorkDone),
      solution_tier_described_to_client: blankToNull(tDescribedToClient),
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
    setTSop("");
    setTWhatIsIt("");
    setTWhyValuable("");
    setTWhenUsed("");
    setTAssumptionPrereq("");
    setTInScope("");
    setTOutScope("");
    setTFinalDeliverable("");
    setTHowWorkDone("");
    setTDescribedToClient("");
    setTRes("");
    setCreateAutofillFrom(null);
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

  const onDraftTaskNameChange = (key: string, value: string) => {
    setDraftTasks((list) =>
      list.map((r) => {
        if (r.key !== key) return r;
        const m = firstTaskMatchingName(tasks, value);
        if (m) return { ...r, name: value, ...autofillFromTask(m) };
        return { ...r, name: value };
      })
    );
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
  const [updTSop, setUpdTSop] = useState("");
  const [updTWhatIsIt, setUpdTWhatIsIt] = useState("");
  const [updTWhyValuable, setUpdTWhyValuable] = useState("");
  const [updTWhenUsed, setUpdTWhenUsed] = useState("");
  const [updTAssumptionPrereq, setUpdTAssumptionPrereq] = useState("");
  const [updTInScope, setUpdTInScope] = useState("");
  const [updTOutScope, setUpdTOutScope] = useState("");
  const [updTFinalDeliverable, setUpdTFinalDeliverable] = useState("");
  const [updTHowWorkDone, setUpdTHowWorkDone] = useState("");
  const [updTDescribedToClient, setUpdTDescribedToClient] = useState("");
  const [updTRes, setUpdTRes] = useState("");
  /** When set, tier save uses legacy fields (overview, link, direction) from this source. */
  const [updAutofillFrom, setUpdAutofillFrom] = useState<SolutionTier | null>(null);

  const [updTaskEditId, setUpdTaskEditId] = useState<string | null>(null);
  const [updKName, setUpdKName] = useState("");
  const [updKImpl, setUpdKImpl] = useState("");
  const [updKTime, setUpdKTime] = useState("");
  const [updKDur, setUpdKDur] = useState("");
  const [updKDep, setUpdKDep] = useState("");
  const [updKNotes, setUpdKNotes] = useState("");
  /** Update tab: add several new tasks for the focused tier before saving. */
  const [updNewTaskDrafts, setUpdNewTaskDrafts] = useState<DraftTaskRow[]>([newDraftTaskRow()]);

  const tiersOfUpdateSol = useMemo(() => {
    if (!updSolutionId) return [];
    return tiers
      .filter((t) => t.solution_id === updSolutionId)
      .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
  }, [tiers, updSolutionId]);

  const tasksOfFocusTier = useMemo(() => {
    if (!updTierFocus) return [];
    return tasks
      .filter((k) => k.solution_tier_id === updTierFocus)
      .sort((a, b) => sortId(a.task_id, b.task_id));
  }, [tasks, updTierFocus]);

  const implementerToGroup = useMemo(
    () => buildImplementerToGroupMap(implementerHourGroups),
    [implementerHourGroups]
  );

  const tasksForHourRollup = useMemo(() => {
    if (subTab !== "update" || !updTierFocus) return [] as TaskRow[];
    const base: TaskRow[] = tasksOfFocusTier.map((k) => {
      if (updTaskEditId && k.task_id === updTaskEditId) {
        return {
          ...k,
          task_time: optNum(updKTime),
          task_implementer: updKImpl.trim() || k.task_implementer,
        };
      }
      return k;
    });
    const today = todayISODate();
    const fromDrafts: TaskRow[] = updNewTaskDrafts
      .filter((d) => d.name.trim())
      .map((d) => ({
        task_id: `new-${d.key}`,
        solution_tier_id: updTierFocus,
        task_name: d.name,
        task_implementer: d.impl.trim() || null,
        task_time: optNum(d.time),
        task_duration: null,
        task_dependencies: null,
        task_notes: null,
        task_create_date: today,
        task_modified_date: today,
      }));
    return [...base, ...fromDrafts];
  }, [
    subTab,
    updTierFocus,
    tasksOfFocusTier,
    updTaskEditId,
    updKTime,
    updKImpl,
    updNewTaskDrafts,
  ]);

  const taskHourRollupForPricing = useMemo(() => {
    if (subTab !== "update" || implementerHourGroups.length === 0) {
      return null;
    }
    return rollUpTaskTimesByPricingGroup(tasksForHourRollup, implementerToGroup);
  }, [subTab, implementerHourGroups, tasksForHourRollup, implementerToGroup]);

  const previewNextTaskIdUpdate = useMemo(() => nextAutoTaskId(tasks), [tasks]);

  const updTiersForAutofill = useMemo(
    () =>
      updTierEditId
        ? sortedTiersForAutofill.filter((t) => t.solution_tier_id !== updTierEditId)
        : sortedTiersForAutofill,
    [sortedTiersForAutofill, updTierEditId]
  );

  const onUpdAutofillSelect = (value: string) => {
    if (!value) {
      setUpdAutofillFrom(null);
      return;
    }
    const t = tiers.find((x) => x.solution_tier_id === value);
    if (!t) return;
    if (updTierEditId && t.solution_tier_id === updTierEditId) return;
    setUpdAutofillFrom(t);
    setUpdTName(t.solution_tier_name);
    setUpdTOwner(t.solution_tier_owner ?? "");
    setUpdTSop(t.solution_tier_sop ?? "");
    setUpdTWhatIsIt(t.solution_tier_what_is_it ?? "");
    setUpdTWhyValuable(t.solution_tier_why_is_it_valuable ?? "");
    setUpdTWhenUsed(t.solution_tier_when_should_it_be_used ?? "");
    setUpdTAssumptionPrereq(t.solution_tier_assumption_prerequisites ?? "");
    setUpdTInScope(t.solution_tier_in_scope ?? "");
    setUpdTOutScope(t.solution_tier_out_of_scope ?? "");
    setUpdTFinalDeliverable(t.solution_tier_final_deliverable ?? "");
    setUpdTHowWorkDone(t.solution_tier_how_do_we_get_this_work_done ?? "");
    setUpdTDescribedToClient(t.solution_tier_described_to_client ?? "");
    setUpdTRes(t.solution_tier_resources ?? "");
  };

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
    setUpdTSop("");
    setUpdTWhatIsIt("");
    setUpdTWhyValuable("");
    setUpdTWhenUsed("");
    setUpdTAssumptionPrereq("");
    setUpdTInScope("");
    setUpdTOutScope("");
    setUpdTFinalDeliverable("");
    setUpdTHowWorkDone("");
    setUpdTDescribedToClient("");
    setUpdTRes("");
    setUpdAutofillFrom(null);
  };

  const clearTaskUpdateForm = () => {
    setUpdTaskEditId(null);
    setUpdKName("");
    setUpdKImpl("");
    setUpdKTime("");
    setUpdKDur("");
    setUpdKDep("");
    setUpdKNotes("");
    setUpdNewTaskDrafts([newDraftTaskRow()]);
  };

  useEffect(() => {
    if (subTab === "update") clearTaskUpdateForm();
  }, [updTierFocus, subTab]);

  const startEditTier = (t: SolutionTier) => {
    setUpdTierFocus(t.solution_tier_id);
    setUpdTierEditId(t.solution_tier_id);
    setUpdTName(t.solution_tier_name);
    setUpdTOwner(t.solution_tier_owner ?? "");
    setUpdTSop(t.solution_tier_sop ?? "");
    setUpdTWhatIsIt(t.solution_tier_what_is_it ?? "");
    setUpdTWhyValuable(t.solution_tier_why_is_it_valuable ?? "");
    setUpdTWhenUsed(t.solution_tier_when_should_it_be_used ?? "");
    setUpdTAssumptionPrereq(t.solution_tier_assumption_prerequisites ?? "");
    setUpdTInScope(t.solution_tier_in_scope ?? "");
    setUpdTOutScope(t.solution_tier_out_of_scope ?? "");
    setUpdTFinalDeliverable(t.solution_tier_final_deliverable ?? "");
    setUpdTHowWorkDone(t.solution_tier_how_do_we_get_this_work_done ?? "");
    setUpdTDescribedToClient(t.solution_tier_described_to_client ?? "");
    setUpdTRes(t.solution_tier_resources ?? "");
    setUpdAutofillFrom(null);
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
    const prevTier = updTierEditId ? tiers.find((x) => x.solution_tier_id === updTierEditId) : null;
    const legU = updAutofillFrom;
    const payload = {
      solution_id: updSolutionId,
      solution_tier_name: updTName.trim(),
      solution_tier_owner: blankToNull(updTOwner),
      solution_tier_overview: legU ? legU.solution_tier_overview : (prevTier?.solution_tier_overview ?? null),
      solution_tier_overview_link: legU
        ? legU.solution_tier_overview_link
        : (prevTier?.solution_tier_overview_link ?? null),
      solution_tier_direction: legU ? legU.solution_tier_direction : (prevTier?.solution_tier_direction ?? null),
      solution_tier_sop: blankToNull(updTSop),
      solution_tier_resources: blankToNull(updTRes),
      solution_tier_what_is_it: blankToNull(updTWhatIsIt),
      solution_tier_why_is_it_valuable: blankToNull(updTWhyValuable),
      solution_tier_when_should_it_be_used: blankToNull(updTWhenUsed),
      solution_tier_assumption_prerequisites: blankToNull(updTAssumptionPrereq),
      solution_tier_in_scope: blankToNull(updTInScope),
      solution_tier_out_of_scope: blankToNull(updTOutScope),
      solution_tier_final_deliverable: blankToNull(updTFinalDeliverable),
      solution_tier_how_do_we_get_this_work_done: blankToNull(updTHowWorkDone),
      solution_tier_described_to_client: blankToNull(updTDescribedToClient),
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
      solution_tier_what_is_it: payload.solution_tier_what_is_it,
      solution_tier_why_is_it_valuable: payload.solution_tier_why_is_it_valuable,
      solution_tier_when_should_it_be_used: payload.solution_tier_when_should_it_be_used,
      solution_tier_assumption_prerequisites: payload.solution_tier_assumption_prerequisites,
      solution_tier_in_scope: payload.solution_tier_in_scope,
      solution_tier_out_of_scope: payload.solution_tier_out_of_scope,
      solution_tier_final_deliverable: payload.solution_tier_final_deliverable,
      solution_tier_how_do_we_get_this_work_done: payload.solution_tier_how_do_we_get_this_work_done,
      solution_tier_described_to_client: payload.solution_tier_described_to_client,
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

  const saveUpdateTasksBulk = async () => {
    const client = getSupabase();
    if (!client || !updTierFocus) return;
    setOpErr(null);
    setOpOk(null);
    const rowsToSave = updNewTaskDrafts.filter((d) => d.name.trim());
    if (rowsToSave.length === 0) {
      setOpErr("Add at least one task row with a name, or click Edit on an existing task.");
      return;
    }
    const today = todayISODate();
    let localTasks = [...tasks];
    for (const d of rowsToSave) {
      const id = nextAutoTaskId(localTasks);
      const row: TaskRow = {
        task_id: id,
        solution_tier_id: updTierFocus,
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
    setOpOk(`Created ${rowsToSave.length} task(s) for tier ${updTierFocus}.`);
    setUpdNewTaskDrafts([newDraftTaskRow()]);
    await onSaved();
  };

  const saveUpdateTask = async () => {
    const client = getSupabase();
    if (!client || !updTierFocus || !updTaskEditId) return;
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
    setUpdNewTaskDrafts([newDraftTaskRow()]);
    setUpdTaskEditId(k.task_id);
    setUpdKName(k.task_name);
    setUpdKImpl(k.task_implementer ?? "");
    setUpdKTime(k.task_time != null ? String(k.task_time) : "");
    setUpdKDur(k.task_duration != null ? String(k.task_duration) : "");
    setUpdKDep(k.task_dependencies ?? "");
    setUpdKNotes(k.task_notes ?? "");
  };

  const createTierAutofillBlock = (
    <>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Autofill from existing tier</AdminFieldCaption>
        <select
          style={input}
          value={createAutofillFrom?.solution_tier_id ?? ""}
          onChange={(e) => onCreateAutofillSelect(e.target.value)}
          disabled={tiers.length === 0}
        >
          <option value="">{tiers.length === 0 ? "No tiers in database" : "— Optional —"}</option>
          {sortedTiersForAutofill.map((t) => (
            <option key={t.solution_tier_id} value={t.solution_tier_id}>
              {t.solution_tier_id} — {t.solution_tier_name} ({solutionNameForTier(t.solution_id)})
            </option>
          ))}
        </select>
      </label>
      <p style={{ ...muted, gridColumn: "1 / -1", margin: "0 0 0.5rem", fontSize: "0.8rem", lineHeight: 1.4 }}>
        Fills every field below (and copies overview, link, and direction on save). Clear the list to use blank legacy
        fields.
      </p>
    </>
  );

  const updateTierAutofillBlock = (
    <>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Autofill from existing tier</AdminFieldCaption>
        <select
          style={input}
          value={updAutofillFrom?.solution_tier_id ?? ""}
          onChange={(e) => onUpdAutofillSelect(e.target.value)}
          disabled={updTiersForAutofill.length === 0}
        >
          <option value="">
            {updTiersForAutofill.length === 0 ? "No other tiers to copy" : "— Optional —"}
          </option>
          {updTiersForAutofill.map((t) => (
            <option key={t.solution_tier_id} value={t.solution_tier_id}>
              {t.solution_tier_id} — {t.solution_tier_name} ({solutionNameForTier(t.solution_id)})
            </option>
          ))}
        </select>
      </label>
      <p style={{ ...muted, gridColumn: "1 / -1", margin: "0 0 0.5rem", fontSize: "0.8rem", lineHeight: 1.4 }}>
        Fills the form; when editing, overview/link/direction are only overwritten if you pick a source tier.
      </p>
    </>
  );

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
      {createTierAutofillBlock}

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Description</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is it</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={tWhatIsIt} onChange={(e) => setTWhatIsIt(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Why is it valuable</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={tWhyValuable} onChange={(e) => setTWhyValuable(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>When should it be used</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={tWhenUsed} onChange={(e) => setTWhenUsed(e.target.value)} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Scope</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What assumptions or prerequisites must be in place</AdminFieldCaption>
        <textarea
          style={textarea}
          rows={2}
          value={tAssumptionPrereq}
          onChange={(e) => setTAssumptionPrereq(e.target.value)}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is included in scope</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={tInScope} onChange={(e) => setTInScope(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is not included in scope</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={tOutScope} onChange={(e) => setTOutScope(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is the final deliverable</AdminFieldCaption>
        <textarea
          style={textarea}
          rows={2}
          value={tFinalDeliverable}
          onChange={(e) => setTFinalDeliverable(e.target.value)}
        />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Process</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>How do we get this work done</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={tHowWorkDone} onChange={(e) => setTHowWorkDone(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>SOP</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={tSop} onChange={(e) => setTSop(e.target.value)} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Selling</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>How can this solution be described to the client</AdminFieldCaption>
        <textarea
          style={textarea}
          rows={2}
          value={tDescribedToClient}
          onChange={(e) => setTDescribedToClient(e.target.value)}
        />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Resources</h4>
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
      {updateTierAutofillBlock}

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Description</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is it</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={updTWhatIsIt} onChange={(e) => setUpdTWhatIsIt(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Why is it valuable</AdminFieldCaption>
        <textarea
          style={textarea}
          rows={2}
          value={updTWhyValuable}
          onChange={(e) => setUpdTWhyValuable(e.target.value)}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>When should it be used</AdminFieldCaption>
        <textarea
          style={textarea}
          rows={2}
          value={updTWhenUsed}
          onChange={(e) => setUpdTWhenUsed(e.target.value)}
        />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Scope</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What assumptions or prerequisites must be in place</AdminFieldCaption>
        <textarea
          style={textarea}
          rows={2}
          value={updTAssumptionPrereq}
          onChange={(e) => setUpdTAssumptionPrereq(e.target.value)}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is included in scope</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={updTInScope} onChange={(e) => setUpdTInScope(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is not included in scope</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={updTOutScope} onChange={(e) => setUpdTOutScope(e.target.value)} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is the final deliverable</AdminFieldCaption>
        <textarea
          style={textarea}
          rows={2}
          value={updTFinalDeliverable}
          onChange={(e) => setUpdTFinalDeliverable(e.target.value)}
        />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Process</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>How do we get this work done</AdminFieldCaption>
        <textarea
          style={textarea}
          rows={2}
          value={updTHowWorkDone}
          onChange={(e) => setUpdTHowWorkDone(e.target.value)}
        />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>SOP</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={updTSop} onChange={(e) => setUpdTSop(e.target.value)} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Selling</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>How can this solution be described to the client</AdminFieldCaption>
        <textarea
          style={textarea}
          rows={2}
          value={updTDescribedToClient}
          onChange={(e) => setUpdTDescribedToClient(e.target.value)}
        />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Resources</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Resources</AdminFieldCaption>
        <textarea style={textarea} rows={2} value={updTRes} onChange={(e) => setUpdTRes(e.target.value)} />
      </label>
    </div>
  );

  const updateUpdNewDraft = (key: string, patch: Partial<DraftTaskRow>) => {
    setUpdNewTaskDrafts((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const onUpdNewTaskNameChange = (key: string, value: string) => {
    setUpdNewTaskDrafts((list) =>
      list.map((r) => {
        if (r.key !== key) return r;
        const m = firstTaskMatchingName(tasks, value);
        if (m) return { ...r, name: value, ...autofillFromTask(m) };
        return { ...r, name: value };
      })
    );
  };

  const onUpdateTabEditTaskNameChange = (value: string) => {
    setUpdKName(value);
    const m = firstTaskMatchingName(tasks, value);
    if (m) {
      setUpdKImpl(m.task_implementer ?? "");
      setUpdKTime(m.task_time != null ? String(m.task_time) : "");
      setUpdKDur(m.task_duration != null ? String(m.task_duration) : "");
      setUpdKDep(m.task_dependencies ?? "");
      setUpdKNotes(m.task_notes ?? "");
    }
  };

  const addUpdNewDraftRow = () => {
    setUpdNewTaskDrafts((list) => [...list, newDraftTaskRow()]);
  };
  const removeUpdNewDraftRow = (key: string) => {
    setUpdNewTaskDrafts((list) => (list.length <= 1 ? list : list.filter((r) => r.key !== key)));
  };

  const taskFormUpdateEditFields = (
    <div className="admin-form-stack" style={formGrid}>
      <label style={lbl}>
        <AdminFieldCaption>Task id</AdminFieldCaption>
        <input style={input} readOnly tabIndex={-1} value={updTaskEditId ?? ""} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Task name</AdminFieldCaption>
        <input
          style={input}
          list={taskNameDatalistId}
          value={updKName}
          onChange={(e) => onUpdateTabEditTaskNameChange(e.target.value)}
        />
      </label>
      <label style={lbl}>
        <AdminFieldCaption>Implementer</AdminFieldCaption>
        <TaskImplementerSelect
          value={updKImpl}
          options={distinctImplementerOptions}
          inputStyle={input}
          onChange={setUpdKImpl}
        />
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
      <datalist id={taskNameDatalistId}>
        {sortedTaskNamesForDatalist.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
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
                  {createTierAutofillBlock}

                  <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Description</h4>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>What is it</AdminFieldCaption>
                    <textarea style={textarea} rows={2} value={tWhatIsIt} onChange={(e) => setTWhatIsIt(e.target.value)} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Why is it valuable</AdminFieldCaption>
                    <textarea
                      style={textarea}
                      rows={2}
                      value={tWhyValuable}
                      onChange={(e) => setTWhyValuable(e.target.value)}
                    />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>When should it be used</AdminFieldCaption>
                    <textarea
                      style={textarea}
                      rows={2}
                      value={tWhenUsed}
                      onChange={(e) => setTWhenUsed(e.target.value)}
                    />
                  </label>

                  <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Scope</h4>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>What assumptions or prerequisites must be in place</AdminFieldCaption>
                    <textarea
                      style={textarea}
                      rows={2}
                      value={tAssumptionPrereq}
                      onChange={(e) => setTAssumptionPrereq(e.target.value)}
                    />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>What is included in scope</AdminFieldCaption>
                    <textarea style={textarea} rows={2} value={tInScope} onChange={(e) => setTInScope(e.target.value)} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>What is not included in scope</AdminFieldCaption>
                    <textarea style={textarea} rows={2} value={tOutScope} onChange={(e) => setTOutScope(e.target.value)} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>What is the final deliverable</AdminFieldCaption>
                    <textarea
                      style={textarea}
                      rows={2}
                      value={tFinalDeliverable}
                      onChange={(e) => setTFinalDeliverable(e.target.value)}
                    />
                  </label>

                  <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Process</h4>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>How do we get this work done</AdminFieldCaption>
                    <textarea
                      style={textarea}
                      rows={2}
                      value={tHowWorkDone}
                      onChange={(e) => setTHowWorkDone(e.target.value)}
                    />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>SOP</AdminFieldCaption>
                    <textarea style={textarea} rows={2} value={tSop} onChange={(e) => setTSop(e.target.value)} />
                  </label>

                  <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Selling</h4>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>How can this solution be described to the client</AdminFieldCaption>
                    <textarea
                      style={textarea}
                      rows={2}
                      value={tDescribedToClient}
                      onChange={(e) => setTDescribedToClient(e.target.value)}
                    />
                  </label>

                  <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Resources</h4>
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
                              list={taskNameDatalistId}
                              value={d.name}
                              onChange={(e) => onDraftTaskNameChange(d.key, e.target.value)}
                            />
                          </td>
                          <td style={td}>
                            <TaskImplementerSelect
                              value={d.impl}
                              options={distinctImplementerOptions}
                              inputStyle={input}
                              onChange={(v) => updateDraftRow(d.key, { impl: v })}
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
                  <label style={lbl}>
                    <AdminFieldCaption>Old price</AdminFieldCaption>
                    <input style={input} value={prOldPrice} onChange={(e) => setPrOldPrice(e.target.value)} />
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Percent change</AdminFieldCaption>
                    <input
                      style={{ ...input, cursor: "default" }}
                      readOnly
                      tabIndex={-1}
                      value={prPercentFromOld.display}
                    />
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
                              list={taskNameDatalistId}
                              value={d.name}
                              onChange={(e) => onDraftTaskNameChange(d.key, e.target.value)}
                            />
                          </td>
                          <td style={td}>
                            <TaskImplementerSelect
                              value={d.impl}
                              options={distinctImplementerOptions}
                              inputStyle={input}
                              onChange={(v) => updateDraftRow(d.key, { impl: v })}
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
                  {updTaskEditId ? (
                    <>
                      <h4 style={{ ...sectionTitle, marginTop: "1rem", fontSize: "0.88rem" }}>
                        Edit task <code>{updTaskEditId}</code>
                      </h4>
                      {taskFormUpdateEditFields}
                      <div className="admin-actions-row" style={{ marginTop: 8 }}>
                        <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void saveUpdateTask()}>
                          Save changes
                        </button>
                        <button type="button" style={btn} onClick={clearTaskUpdateForm}>
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h4 style={{ ...sectionTitle, marginTop: "1rem", fontSize: "0.88rem" }}>Add tasks</h4>
                      <p style={{ ...muted, marginTop: 0 }}>
                        Add one or more rows, then save all at once. New task ids use <code>4-…</code> (next:{" "}
                        <code>{previewNextTaskIdUpdate}</code>).
                      </p>
                      <div className="admin-actions-row" style={{ marginTop: 6 }}>
                        <button type="button" style={btn} onClick={() => addUpdNewDraftRow()}>
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
                            {updNewTaskDrafts.map((d) => (
                              <tr key={d.key}>
                                <td style={td}>
                                  <input
                                    style={input}
                                    list={taskNameDatalistId}
                                    value={d.name}
                                    onChange={(e) => onUpdNewTaskNameChange(d.key, e.target.value)}
                                  />
                                </td>
                                <td style={td}>
                                  <TaskImplementerSelect
                                    value={d.impl}
                                    options={distinctImplementerOptions}
                                    inputStyle={input}
                                    onChange={(v) => updateUpdNewDraft(d.key, { impl: v })}
                                  />
                                </td>
                                <td style={td}>
                                  <input
                                    style={input}
                                    value={d.time}
                                    onChange={(e) => updateUpdNewDraft(d.key, { time: e.target.value })}
                                  />
                                </td>
                                <td style={td}>
                                  <input
                                    style={input}
                                    value={d.dur}
                                    onChange={(e) => updateUpdNewDraft(d.key, { dur: e.target.value })}
                                  />
                                </td>
                                <td style={td}>
                                  <input
                                    style={input}
                                    value={d.dep}
                                    onChange={(e) => updateUpdNewDraft(d.key, { dep: e.target.value })}
                                  />
                                </td>
                                <td style={td}>
                                  <input
                                    style={input}
                                    value={d.notes}
                                    onChange={(e) => updateUpdNewDraft(d.key, { notes: e.target.value })}
                                  />
                                </td>
                                <td style={td}>
                                  <button type="button" style={btnDangerSm} onClick={() => removeUpdNewDraftRow(d.key)}>
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
                          onClick={() => void saveUpdateTasksBulk()}
                        >
                          Save all new tasks
                        </button>
                      </div>
                    </>
                  )}

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
                    tierIdsInScope={updTierFocus ? [updTierFocus] : null}
                    updateAutoLoadTierId={updTierFocus || null}
                    taskDrivenHours={implementerHourGroups.length > 0}
                    taskHourRollup={taskHourRollupForPricing}
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
