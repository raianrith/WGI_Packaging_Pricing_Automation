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
import type {
  ImplementerHourGroupRow,
  PackageSolutionTier,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  SolutionType,
  TaskGroupLineRow,
  TaskGroupRow,
  TaskRow,
  TierResourceExampleRow,
} from "../types";
import { applyTaskGroupToTier } from "../lib/applyTaskGroupToTier";
import { isSolutionModuleName, parseSolutionType } from "../lib/buildCatalogDirectoryRows";
import { SolutionTierInlineRiskPricing } from "./SolutionTierInlineRiskPricing";
import {
  draftFieldsFromTierVaultTasks,
  insertCopiedVaultTasksFromTier,
  sourceTierMeta,
  tierCopySourceLabelFromNotes,
} from "../lib/tierTaskCopy";
import { nextAutoSolutionId, nextAutoTierId } from "../lib/entityIdSequences";
import { fetchAllTaskIdRows, nextAutoTaskId } from "../lib/taskIds";
import { persistTaskSortOrdersForTier } from "../lib/persistTaskSortOrdersForTier";
import { compareTasksByOrder, tierMaxSortOrder } from "../lib/taskOrder";
import {
  type TierPricingMathConfig,
} from "../lib/tierPricingMath";
import { syncTierPricingFromTasks } from "../lib/syncTierPricingFromTasks";
import { MarkdownTextarea } from "./MarkdownTextarea";
import TierResourcesEditor from "./TierResourcesEditor";
import {
  emptyResourceExampleRow,
  hydrateTierResourceEditorState,
  resourceStructuredFieldsForSave,
} from "../lib/tierResourceFields";
import { InlineActionFeedback, pickInlineFeedback } from "./InlineActionFeedback";
import { PricingPanel } from "./PricingPanel";
import type { UniqueIdentifier } from "@dnd-kit/core";
import { TaskImplementerSelect } from "./TaskImplementerSelect";
import { TierCategorySelect } from "./TierCategorySelect";
import { TierPhaseSelect } from "./TierPhaseSelect";
import { TierTacticSelect } from "./TierTacticSelect";
import {
  normalizeTierPhase,
  normalizeTierTactic,
  normalizeTierTaxonomyLabel,
  tierTaxonomyOptionsFromRows,
} from "../lib/tierTaxonomy";
import { SortableTableRowTr, TaskSortableList } from "./TaskTableSortable";

function solutionTypeForEdit(sol: Solution): SolutionType {
  return (
    parseSolutionType(sol.solution_type) ??
    (isSolutionModuleName(sol.solution_name) ? "solution_module" : "configured_solution")
  );
}

export { nextAutoSolutionId, nextAutoTierId, nextAutoTaskId };

/** Zones for footer-free feedback beside task/template/copy buttons in Solutions Builder */
type SBInlineZone =
  | "fs_apply_tg"
  | "fs_copy_tier"
  | "fs_add_row"
  | "to_apply_tg"
  | "to_copy_tier"
  | "to_add_row"
  | "upd_apply_tg"
  | "upd_copy_db"
  | "upd_copy_draft";

function AdminFieldCaption({ children }: { children: ReactNode }) {
  return <span className="admin-field-caption">{children}</span>;
}

type TierTaxonomySelectLists = { phase: string[]; category: string[]; tactic: string[] };

function TierTaxonomyFormFields({
  lbl,
  input,
  phase,
  setPhase,
  category,
  setCategory,
  tactic,
  setTactic,
  taxonomy,
}: {
  lbl: CSSProperties;
  input: CSSProperties;
  phase: string;
  setPhase: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  tactic: string;
  setTactic: (v: string) => void;
  taxonomy: TierTaxonomySelectLists;
}) {
  return (
    <>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Tier Phase</AdminFieldCaption>
        <TierPhaseSelect inputStyle={input} value={phase} onChange={setPhase} options={taxonomy.phase} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Tier Category</AdminFieldCaption>
        <TierCategorySelect inputStyle={input} value={category} onChange={setCategory} options={taxonomy.category} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Tier Tactic</AdminFieldCaption>
        <TierTacticSelect inputStyle={input} value={tactic} onChange={setTactic} options={taxonomy.tactic} />
      </label>
    </>
  );
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
  /** Where this draft task came from in the UI (manual vs task-group template). */
  source: string;
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
    source: "Created Task (manual)",
  };
}

/** Build draft task rows from a task-group template (one-page "new solution" — no tier id until final save). */
function draftRowsFromTaskGroupLines(
  lines: TaskGroupLineRow[],
  allTasks: TaskRow[],
  sourceTaskGroupName: string
): DraftTaskRow[] {
  const sorted = [...lines].sort((a, b) => a.sort_order - b.sort_order);
  const out: DraftTaskRow[] = [];
  for (const line of sorted) {
    const key = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    if (line.line_type === "copy_from_task" && line.source_task_id) {
      const src = allTasks.find((t) => t.task_id === line.source_task_id);
      if (src) {
        const af = autofillFromTask(src);
        out.push({
          key,
          name: (line.task_name ?? "").trim() || src.task_name,
          impl: (line.task_implementer ?? "").trim() || af.impl,
          time: line.hours != null && Number.isFinite(line.hours) ? String(line.hours) : af.time,
          dur: line.duration != null && Number.isFinite(line.duration) ? String(line.duration) : af.dur,
          dep: af.dep,
          notes: af.notes,
          source: `From Task Group: ${sourceTaskGroupName}`,
        });
        continue;
      }
    }
    out.push({
      key,
      name: (line.task_name ?? "").trim(),
      impl: (line.task_implementer ?? "").trim(),
      time: line.hours != null && Number.isFinite(line.hours) ? String(line.hours) : "",
      dur: line.duration != null && Number.isFinite(line.duration) ? String(line.duration) : "",
      dep: "",
      notes: "",
      source: `From Task Group: ${sourceTaskGroupName}`,
    });
  }
  return out;
}

type StepperProps = { branch: CreateBranch; phase: CreatePhase };

function SolutionsBuilderCreateStepper({ branch, phase }: StepperProps) {
  if (phase === "choose") {
    return (
      <div className="admin-sb-path-banner" role="status">
        <p className="admin-sb-path-banner__title">How do you want to build?</p>
        <p className="admin-sb-path-banner__text">
          Choose a <strong>full new solution</strong> (one save at the end) or a <strong>new tier</strong> on a solution
          that already exists. Use <strong>Back</strong> or reset when the control is available to return here.
        </p>
      </div>
    );
  }
  if (branch === "full" && phase === "foundation") {
    return (
      <div className="admin-sb-stepper admin-sb-stepper--inline" role="status" aria-label="Create mode">
        <span className="admin-sb-pill">Single-page flow</span>
        <span className="admin-sb-stepper__note">
          Nothing is written to the database until you press <strong>Create entire solution</strong> at the bottom.
        </span>
      </div>
    );
  }
  if (branch === "tier_only" && (phase === "tier" || phase === "tasks" || phase === "pricing")) {
    return (
      <div className="admin-sb-stepper admin-sb-stepper--inline" role="status" aria-label="Create mode">
        <span className="admin-sb-pill">Single-page flow</span>
        <span className="admin-sb-stepper__note">
          Keep everything in one place: create tier, add tasks, and set pricing without leaving this page.
        </span>
      </div>
    );
  }
  return null;
}

type UpdateSectionHeadProps = { badge: string; title: string; hint?: string; muted: CSSProperties };

function UpdateSectionHead({ badge, title, hint, muted: m }: UpdateSectionHeadProps) {
  return (
    <header className="admin-sb-block-header">
      <div className="admin-sb-section-head">
        <span className="admin-sb-badge">{badge}</span>
        <h3 className="admin-sb-block-title">{title}</h3>
      </div>
      {hint ? (
        <p className="admin-sb-hint" style={{ ...m, marginTop: "0.35rem" }}>
          {hint}
        </p>
      ) : null}
    </header>
  );
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

/** Grouped blocks inside the new-solution form for readability. */
const formSectionBox: CSSProperties = {
  marginTop: "1.1rem",
  padding: "1rem 1.15rem 1.2rem",
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  boxShadow: "var(--shadow-sm)",
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
  background: "var(--accent-soft)",
  border: "1px solid var(--border)",
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
  background: "var(--surface)",
  textAlign: "left" as const,
  cursor: "pointer",
  font: "inherit",
  color: "var(--text)",
  boxShadow: "var(--shadow-sm)",
};

export function SolutionsBuilderPanel({
  subTab,
  solutions,
  tiers,
  tasks,
  tierPricing,
  tierPricingMathConfig,
  tierTaxonomyOptions: tierTaxonomyOptionsProp,
  implementerHourGroups = [],
  taskGroups = [],
  taskGroupLines = [],
  packageTiers = [],
  onSaved,
  setOpErr,
  setOpOk,
  onRequestSubTabChange,
  logAudit,
  styles: s,
}: {
  subTab: SolutionsBuilderSubTab;
  tierPricingMathConfig: TierPricingMathConfig;
  tierTaxonomyOptions?: TierTaxonomySelectLists;
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  tierPricing: SolutionTierPricing[];
  /** Used only to warn how many package links will drop when deleting a tier (DB cascades). */
  packageTiers?: PackageSolutionTier[];
  implementerHourGroups?: ImplementerHourGroupRow[];
  taskGroups?: TaskGroupRow[];
  taskGroupLines?: TaskGroupLineRow[];
  onSaved: () => Promise<void>;
  setOpErr: (msg: string | null) => void;
  setOpOk: (msg: string | null) => void;
  onRequestSubTabChange?: (tab: SolutionsBuilderSubTab) => void;
  logAudit: LogAudit;
  styles: BuilderStyles;
}) {
  const { panel, formGrid, lbl, input, textarea, btn, btnPrimary, btnSm, btnDangerSm, tbl, th, td, h2, muted } = s;

  const taxonomy = useMemo(
    () => tierTaxonomyOptionsProp ?? tierTaxonomyOptionsFromRows([]),
    [tierTaxonomyOptionsProp]
  );
  const normTierPhase = useCallback((v: string) => normalizeTierPhase(v, taxonomy.phase), [taxonomy.phase]);
  const normTierCategory = useCallback(
    (v: string) => normalizeTierTaxonomyLabel(v, taxonomy.category),
    [taxonomy.category]
  );
  const normTierTactic = useCallback((v: string) => normalizeTierTactic(v, taxonomy.tactic), [taxonomy.tactic]);

  const [sbInlineFb, setSbInlineFb] = useState<{
    zone: SBInlineZone;
    message: string;
    variant: "ok" | "err";
  } | null>(null);

  const showSbInline = useCallback(
    (zone: SBInlineZone, message: string, variant: "ok" | "err" = "ok") => {
      setOpOk(null);
      setOpErr(null);
      setSbInlineFb({ zone, message, variant });
    },
    [setOpOk, setOpErr]
  );

  /** Keep solution_tier_pricing hours + sell math aligned with vault tasks. */
  const syncPricingFromTasks = useCallback(
    async (tierId: string | string[]) => {
      const client = getSupabase();
      if (!client) return { ok: true as const, updated: 0, created: 0 };
      return syncTierPricingFromTasks({
        client,
        tierIds: tierId,
        mathConfig: tierPricingMathConfig,
        implementerHourGroups,
        logAudit,
      });
    },
    [tierPricingMathConfig, implementerHourGroups, logAudit]
  );

  // —— Create wizard ——
  const [createBranch, setCreateBranch] = useState<CreateBranch>(null);
  const [createPhase, setCreatePhase] = useState<CreatePhase>("choose");
  const [ctxSolutionId, setCtxSolutionId] = useState("");
  const [ctxTierId, setCtxTierId] = useState("");
  const [tierOnlySolId, setTierOnlySolId] = useState("");

  const [solNameDraft, setSolNameDraft] = useState("");
  const [solTypeDraft, setSolTypeDraft] = useState<SolutionType>("configured_solution");
  const [solAddOnsAllowed, setSolAddOnsAllowed] = useState(false);

  const [tName, setTName] = useState("");
  const [tPhase, setTPhase] = useState("");
  const [tCategory, setTCategory] = useState("");
  const [tTactic, setTTactic] = useState("");
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
  const [tResTpl, setTResTpl] = useState("");
  const [tResTools, setTResTools] = useState("");
  const [tResExamples, setTResExamples] = useState<TierResourceExampleRow[]>(() => [emptyResourceExampleRow()]);

  /** When set, new tier inserts also copy hidden legacy fields (overview, link, direction) from this row. */
  const [createAutofillFrom, setCreateAutofillFrom] = useState<SolutionTier | null>(null);
  const [draftTasks, setDraftTasks] = useState<DraftTaskRow[]>([newDraftTaskRow()]);
  const [draftTaskBulkSelectedKeys, setDraftTaskBulkSelectedKeys] = useState<Set<string>>(
    new Set()
  );
  const [saveDraftTasksBusy, setSaveDraftTasksBusy] = useState(false);
  const [fullStackPricingDraft, setFullStackPricingDraft] = useState<SolutionTierPricing | null>(null);

  const resetCreateWizard = useCallback(() => {
    setCreateBranch(null);
    setCreatePhase("choose");
    setCtxSolutionId("");
    setCtxTierId("");
    setTierOnlySolId("");
    setSolNameDraft("");
    setSolTypeDraft("configured_solution");
    setSolAddOnsAllowed(false);
    setTName("");
    setTCategory("");
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
    setTResTpl("");
    setTResTools("");
    setTResExamples([emptyResourceExampleRow()]);
    setCreateAutofillFrom(null);
    setDraftTasks([newDraftTaskRow()]);
    setDraftTaskBulkSelectedKeys(new Set());
    setFullStackPricingDraft(null);
    setCreateApplyTemplateGroupId("");
    setFullStackApplyGroupId("");
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
    for (const line of taskGroupLines) {
      const n = line.task_name.trim();
      if (n && !seen.has(n)) {
        seen.add(n);
        out.push(n);
      }
    }
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [tasks, taskGroupLines]);
  /** Match Implementer–Pricing mapping only (not every label ever used on tasks). */
  const distinctImplementerOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of implementerHourGroups) {
      const n = (r.implementer_name ?? "").trim();
      if (n) seen.add(n);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [implementerHourGroups]);

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
    setTName((prev) => (prev.trim() ? prev : t.solution_tier_name));
    setTPhase((prev) => (prev.trim() ? prev : (t.solution_tier_phase ?? "")));
    setTCategory((prev) => (prev.trim() ? prev : (t.solution_tier_category ?? "")));
    setTTactic((prev) => (prev.trim() ? prev : (t.solution_tier_tactic ?? "")));
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
    {
      const h = hydrateTierResourceEditorState(t);
      setTResTpl(h.templates);
      setTResTools(h.tools);
      setTResExamples(h.examples);
    }
  };

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
    const [solRes, tierRes] = await Promise.all([
      client.from("solutions").select("solution_id"),
      client.from("solution_tiers").select("solution_tier_id"),
    ]);
    const taskPrefetch = await fetchAllTaskIdRows(client);
    const prefetchErr = solRes.error ?? tierRes.error ?? (taskPrefetch.error ? { message: taskPrefetch.error } : null);
    if (prefetchErr) {
      setOpErr(friendlyMutationMessage(prefetchErr.message));
      return;
    }
    const solId = nextAutoSolutionId(solRes.data ?? []);
    const tierId = nextAutoTierId(tierRes.data ?? []);
    const pricingDraft = fullStackPricingDraft;
    if (!pricingDraft) {
      setOpErr("Pricing draft is missing. Fill in Section 3 before creating the solution.");
      return;
    }

    const solRow: Solution = {
      solution_id: solId,
      solution_name: solName,
      solution_created_date: today,
      solution_modified_date: today,
      solution_type: solTypeDraft,
      add_ons_allowed: solAddOnsAllowed,
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
    const resSave = resourceStructuredFieldsForSave(tResTpl, tResTools, tResExamples);
    const tierRow: SolutionTier = {
      solution_tier_id: tierId,
      solution_id: solId,
      solution_tier_name: tierName,
      solution_tier_phase: normTierPhase(tPhase),
      solution_tier_category: normTierCategory(tCategory),
      solution_tier_tactic: normTierTactic(tTactic),
      solution_tier_owner: blankToNull(tOwner),
      solution_tier_overview: leg ? leg.solution_tier_overview : null,
      solution_tier_overview_link: leg ? leg.solution_tier_overview_link : null,
      solution_tier_direction: leg ? leg.solution_tier_direction : null,
      solution_tier_sop: blankToNull(tSop),
      ...resSave,
      solution_tier_what_is_it: blankToNull(tWhatIsIt),
      solution_tier_why_is_it_valuable: blankToNull(tWhyValuable),
      solution_tier_when_should_it_be_used: blankToNull(tWhenUsed),
      solution_tier_assumption_prerequisites: blankToNull(tAssumptionPrereq),
      solution_tier_in_scope: blankToNull(tInScope),
      solution_tier_out_of_scope: blankToNull(tOutScope),
      solution_tier_final_deliverable: blankToNull(tFinalDeliverable),
      solution_tier_how_do_we_get_this_work_done: blankToNull(tHowWorkDone),
      solution_tier_described_to_client: null,
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

    let localTasks: Pick<TaskRow, "task_id">[] = [...taskPrefetch.rows];
    for (let i = 0; i < rowsToSave.length; i++) {
      const rowDraft = rowsToSave[i]!;
      const taskId = nextAutoTaskId(localTasks);
      const taskRow: TaskRow = {
        task_id: taskId,
        solution_tier_id: tierId,
        sort_order: i + 1,
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
      solution_label: pricingDraft.solution_label,
      tier: pricingDraft.tier,
      scope: pricingDraft.scope,
      hours_client_services: pricingDraft.hours_client_services,
      hours_copy: pricingDraft.hours_copy,
      hours_design: pricingDraft.hours_design,
      hours_web_dev: pricingDraft.hours_web_dev,
      hours_video: pricingDraft.hours_video,
      hours_data: pricingDraft.hours_data,
      hours_paid_media: pricingDraft.hours_paid_media,
      hours_hubspot: pricingDraft.hours_hubspot,
      hours_other: pricingDraft.hours_other,
      total_hours: pricingDraft.total_hours,
      expected_effort_base_price: pricingDraft.expected_effort_base_price,
      scope_risk: pricingDraft.scope_risk,
      internal_coordination: pricingDraft.internal_coordination,
      client_revision_risk: pricingDraft.client_revision_risk,
      risk_multiplier: pricingDraft.risk_multiplier,
      risk_mitigated_base_price: pricingDraft.risk_mitigated_base_price,
      strategic_value_score: pricingDraft.strategic_value_score,
      strategic_value_multiplier: pricingDraft.strategic_value_multiplier,
      sell_price: pricingDraft.sell_price,
      standalone_sell_price: null,
      old_price: pricingDraft.old_price,
      percent_change: pricingDraft.percent_change,
      requires_customization: pricingDraft.requires_customization,
      taxable: pricingDraft.taxable,
      notes: pricingDraft.notes,
      tags: pricingDraft.tags,
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

    const pricingSync = await syncPricingFromTasks(tierId);
    if (!pricingSync.ok) {
      setOpErr(
        `Created solution/tier/tasks, but pricing sync from tasks failed: ${pricingSync.message}`
      );
      await onSaved();
      return;
    }

    setOpOk(
      `Created solution ${solId}, tier ${tierId}, ${rowsToSave.length} task(s), and pricing synced from those tasks.`
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
    const { data: tierIdRows, error: tierPrefetchErr } = await client
      .from("solution_tiers")
      .select("solution_tier_id");
    if (tierPrefetchErr) {
      setOpErr(friendlyMutationMessage(tierPrefetchErr.message));
      return;
    }
    const id = nextAutoTierId(tierIdRows ?? []);
    const leg = createAutofillFrom;
    const resInsert = resourceStructuredFieldsForSave(tResTpl, tResTools, tResExamples);
    const row: SolutionTier = {
      solution_tier_id: id,
      solution_id: solId,
      solution_tier_name: name,
      solution_tier_phase: normTierPhase(tPhase),
      solution_tier_category: normTierCategory(tCategory),
      solution_tier_tactic: normTierTactic(tTactic),
      solution_tier_owner: blankToNull(tOwner),
      solution_tier_overview: leg ? leg.solution_tier_overview : null,
      solution_tier_overview_link: leg ? leg.solution_tier_overview_link : null,
      solution_tier_direction: leg ? leg.solution_tier_direction : null,
      solution_tier_sop: blankToNull(tSop),
      ...resInsert,
      solution_tier_what_is_it: blankToNull(tWhatIsIt),
      solution_tier_why_is_it_valuable: blankToNull(tWhyValuable),
      solution_tier_when_should_it_be_used: blankToNull(tWhenUsed),
      solution_tier_assumption_prerequisites: blankToNull(tAssumptionPrereq),
      solution_tier_in_scope: blankToNull(tInScope),
      solution_tier_out_of_scope: blankToNull(tOutScope),
      solution_tier_final_deliverable: blankToNull(tFinalDeliverable),
      solution_tier_how_do_we_get_this_work_done: blankToNull(tHowWorkDone),
      solution_tier_described_to_client: null,
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
    setTCategory("");
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
    setTResTpl("");
    setTResTools("");
    setTResExamples([emptyResourceExampleRow()]);
    setCreateAutofillFrom(null);
    setOpOk(`Tier created as ${id}. Add every task for this tier, then save and continue to pricing.`);
    await onSaved();
  };

  const saveAllDraftTasksAndContinue = async () => {
    if (saveDraftTasksBusy) return;
    const client = getSupabase();
    if (!client) return;
    setSaveDraftTasksBusy(true);
    setOpErr(null);
    setOpOk(null);
    try {
      const tierId = ctxTierId.trim();
      if (!tierId) {
        setOpErr("Missing tier context.");
        return;
      }
      const rowsToSave = draftTasks.filter((d) => d.name.trim());
      const tasksAlreadyOnTier = tasks.filter((k) => k.solution_tier_id === tierId);
      if (rowsToSave.length === 0 && tasksAlreadyOnTier.length === 0) {
        setOpErr("Add at least one task (or apply a task group template above) before continuing.");
        return;
      }
      const today = todayISODate();
      const { rows: tierOnlyTaskSeed, error: tierOnlyTaskPrefetchErr } = await fetchAllTaskIdRows(client);
      if (tierOnlyTaskPrefetchErr) {
        setOpErr(friendlyMutationMessage(tierOnlyTaskPrefetchErr));
        return;
      }
      let localTasks: Pick<TaskRow, "task_id">[] = [...tierOnlyTaskSeed];
      const baseMaxSort = tierMaxSortOrder(tasks, tierId);
      for (let i = 0; i < rowsToSave.length; i++) {
        const d = rowsToSave[i]!;
        const id = nextAutoTaskId(localTasks);
        const row: TaskRow = {
          task_id: id,
          solution_tier_id: tierId,
          sort_order: baseMaxSort + i + 1,
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
      if (rowsToSave.length > 0) {
        setDraftTasks([newDraftTaskRow()]);
        setDraftTaskBulkSelectedKeys(new Set());
        const pricingSync = await syncPricingFromTasks(tierId);
        if (!pricingSync.ok) {
          setOpErr(`Tasks saved, but pricing sync failed: ${pricingSync.message}`);
          await onSaved();
          return;
        }
      }
      setOpOk(
        rowsToSave.length > 0
          ? `Saved ${rowsToSave.length} task(s) to Supabase. The draft table was cleared so you will not duplicate them on the next save. Continue to pricing below.`
          : "Continuing to pricing for tasks already on this tier."
      );
      setCreatePhase("pricing");
      await onSaved();
    } finally {
      setSaveDraftTasksBusy(false);
    }
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
    if (createBranch === "full") showSbInline("fs_add_row", "Blank row added.", "ok");
    else if (createBranch === "tier_only") showSbInline("to_add_row", "Blank row added.", "ok");
  };

  const removeDraftTaskRow = (key: string) => {
    setDraftTasks((list) => (list.length <= 1 ? list : list.filter((r) => r.key !== key)));
  };

  const duplicateDraftTaskRow = (key: string) => {
    setDraftTasks((list) => {
      const i = list.findIndex((r) => r.key === key);
      if (i === -1) return list;
      const row = list[i];
      const copy: DraftTaskRow = {
        ...row,
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      };
      return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
    });
  };

  const reorderDraftTasksByKeys = useCallback((nextKeys: UniqueIdentifier[]) => {
    setDraftTasks((prev) => {
      const m = new Map(prev.map((r) => [r.key, r]));
      return nextKeys.map((k) => m.get(String(k))).filter((r): r is DraftTaskRow => r != null);
    });
  }, []);

  const draftTaskTotalHours = useMemo(() => {
    let sum = 0;
    for (const d of draftTasks) {
      const t = d.time.trim();
      if (!t) continue;
      const n = Number(t);
      if (!Number.isFinite(n)) continue;
      sum += n;
    }
    return sum;
  }, [draftTasks]);

  // —— Update workspace ——
  const [updSolutionId, setUpdSolutionId] = useState("");
  /** Inline rename: `solution_id` being edited in the Solutions table (update tab). */
  const [solutionRenameId, setSolutionRenameId] = useState<string | null>(null);
  const [solutionRenameDraft, setSolutionRenameDraft] = useState("");
  /** Inline rename: `solution_tier_id` being edited in the tier summary/detail tables (update tab). */
  const [tierRenameId, setTierRenameId] = useState<string | null>(null);
  const [tierRenameDraft, setTierRenameDraft] = useState("");
  /** Keep update page concise until user chooses to edit a solution. */
  const [showUpdateDetails, setShowUpdateDetails] = useState(false);
  /**
   * Which solution's tiers panel is open in the Solutions table.
   * Separate from `updSolutionId` — that id is also auto-selected for forms and must not
   * force the list row to stay expanded (Hide tiers clears this only).
   */
  const [expandedSolutionId, setExpandedSolutionId] = useState<string | null>(null);
  /** Tier ids with inline risk/strategic pricing panel open under the solutions list. */
  const [inlinePricingTierIds, setInlinePricingTierIds] = useState<Set<string>>(() => new Set());

  const openInlinePricing = useCallback((tierId: string) => {
    setInlinePricingTierIds((prev) => {
      const next = new Set(prev);
      next.add(tierId);
      return next;
    });
  }, []);

  const closeInlinePricing = useCallback((tierId: string) => {
    setInlinePricingTierIds((prev) => {
      const next = new Set(prev);
      next.delete(tierId);
      return next;
    });
  }, []);

  const [updTierFocus, setUpdTierFocus] = useState("");
  /** Task group template to apply in bulk to `updTierFocus` (update tab). */
  const [applyTemplateGroupId, setApplyTemplateGroupId] = useState("");
  /** Task group template in create-wizard (tier-only) tasks step. */
  const [createApplyTemplateGroupId, setCreateApplyTemplateGroupId] = useState("");
  /** Task group template for one-page "new solution" — appends rows to draft tasks. */
  const [fullStackApplyGroupId, setFullStackApplyGroupId] = useState("");
  /** Copy vault tasks from another tier (distinct from templates). */
  const [fullStackCopyTierId, setFullStackCopyTierId] = useState("");
  const [tierOnlyCopyTierId, setTierOnlyCopyTierId] = useState("");
  /** Update tab: source tier for “copy from tier” insert + bulk draft fill. */
  const [updCopyTierPick, setUpdCopyTierPick] = useState("");
  const [updTierEditId, setUpdTierEditId] = useState<string | null>(null);
  const [updTName, setUpdTName] = useState("");
  const [updTPhase, setUpdTPhase] = useState("");
  const [updTCategory, setUpdTCategory] = useState("");
  const [updTTactic, setUpdTTactic] = useState("");
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
  const [updResTpl, setUpdResTpl] = useState("");
  const [updResTools, setUpdResTools] = useState("");
  const [updResExamples, setUpdResExamples] = useState<TierResourceExampleRow[]>(() => [emptyResourceExampleRow()]);
  const [updSolName, setUpdSolName] = useState("");
  const [updSolType, setUpdSolType] = useState<SolutionType>("configured_solution");
  const [updSolAddOnsAllowed, setUpdSolAddOnsAllowed] = useState(false);
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
      .sort((a, b) =>
        a.solution_tier_name.localeCompare(b.solution_tier_name, undefined, { sensitivity: "base" })
      );
  }, [tiers, updSolutionId]);

  const solutionsAlphabetical = useMemo(
    () =>
      [...solutions].sort((a, b) =>
        a.solution_name.localeCompare(b.solution_name, undefined, { sensitivity: "base" })
      ),
    [solutions]
  );

  const tierCountBySolutionId = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tiers) m.set(t.solution_id, (m.get(t.solution_id) ?? 0) + 1);
    return m;
  }, [tiers]);

  const pricingByTierId = useMemo(() => {
    const m = new Map<string, SolutionTierPricing>();
    for (const row of tierPricing) m.set(row.solution_tier_id, row);
    return m;
  }, [tierPricing]);

  const tasksOfFocusTier = useMemo(() => {
    if (!updTierFocus) return [];
    return tasks.filter((k) => k.solution_tier_id === updTierFocus).sort(compareTasksByOrder);
  }, [tasks, updTierFocus]);

  /** Tier-only wizard: copy-from-tier / task-group apply saves tasks immediately; drafts are only for new manual rows. */
  const tierOnlySavedVaultTasks = useMemo(() => {
    const tid = ctxTierId.trim();
    if (!tid) return [];
    return tasks.filter((k) => k.solution_tier_id === tid).sort(compareTasksByOrder);
  }, [tasks, ctxTierId]);

  const updTierTotalTaskHours = useMemo(() => {
    let sum = 0;
    for (const t of tasksOfFocusTier) {
      const n = t.task_time;
      if (n == null || !Number.isFinite(Number(n))) continue;
      sum += Number(n);
    }
    return sum;
  }, [tasksOfFocusTier]);

  const updTierTotalTaskDuration = useMemo(() => {
    let sum = 0;
    for (const t of tasksOfFocusTier) {
      const n = t.task_duration;
      if (n == null || !Number.isFinite(Number(n))) continue;
      sum += Number(n);
    }
    return sum;
  }, [tasksOfFocusTier]);

  const [updTaskBulkSelectedIds, setUpdTaskBulkSelectedIds] = useState<Set<string>>(new Set());
  const [updTaskBulkBusy, setUpdTaskBulkBusy] = useState(false);
  const [updTaskReorderBusy, setUpdTaskReorderBusy] = useState(false);

  useEffect(() => {
    setUpdTaskBulkSelectedIds(new Set());
  }, [updTierFocus]);

  useEffect(() => {
    setSbInlineFb(null);
  }, [subTab, updTierFocus]);

  const taskGroupById = useMemo(() => new Map(taskGroups.map((g) => [g.id, g])), [taskGroups]);
  const taskGroupLineById = useMemo(
    () => new Map(taskGroupLines.map((l) => [l.id, l])),
    [taskGroupLines]
  );

  const sourceLabelForTask = (t: TaskRow): string => {
    const tierCopy = tierCopySourceLabelFromNotes(t.task_notes);
    if (tierCopy) return tierCopy;
    const lineId = t.spawned_from_task_group_line_id ?? null;
    if (lineId) {
      const line = taskGroupLineById.get(lineId);
      if (line) {
        const group = taskGroupById.get(line.task_group_id);
        return group?.name ? `From "${group.name}"` : "From task group";
      }
      return "From task group";
    }
    return "Created Task (manual)";
  };


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
          task_duration: optNum(updKDur),
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
        task_duration: optNum(d.dur),
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
    updKDur,
    updKImpl,
    updNewTaskDrafts,
  ]);

  const taskHourRollupForPricing = useMemo(() => {
    if (subTab !== "update" || implementerHourGroups.length === 0) {
      return null;
    }
    return rollUpTaskTimesByPricingGroup(tasksForHourRollup, implementerToGroup);
  }, [subTab, implementerHourGroups, tasksForHourRollup, implementerToGroup]);

  /** “New tier on existing solution” — Section 3 pricing: roll up saved vault tasks + unsaved draft rows. */
  const tierOnlyTasksForHourRollup = useMemo((): TaskRow[] => {
    const tid = ctxTierId.trim();
    if (!tid) return [];
    const today = todayISODate();
    const fromDrafts: TaskRow[] = draftTasks
      .filter((d) => d.name.trim())
      .map((d) => ({
        task_id: `draft-${d.key}`,
        solution_tier_id: tid,
        task_name: d.name.trim(),
        task_implementer: d.impl.trim() || null,
        task_time: optNum(d.time),
        task_duration: optNum(d.dur),
        task_dependencies: null,
        task_notes: null,
        task_create_date: today,
        task_modified_date: today,
      }));
    return [...tierOnlySavedVaultTasks, ...fromDrafts];
  }, [ctxTierId, tierOnlySavedVaultTasks, draftTasks]);

  const tierOnlyHourRollupForPricing = useMemo(() => {
    if (!ctxTierId.trim() || implementerHourGroups.length === 0) {
      return null;
    }
    return rollUpTaskTimesByPricingGroup(tierOnlyTasksForHourRollup, implementerToGroup);
  }, [ctxTierId, implementerHourGroups, tierOnlyTasksForHourRollup, implementerToGroup]);

  const fullCreateDraftTasksForRollup = useMemo((): TaskRow[] => {
    const today = todayISODate();
    return draftTasks
      .filter((d) => d.name.trim())
      .map((d) => ({
        task_id: `draft-${d.key}`,
        solution_tier_id: "",
        task_name: d.name.trim(),
        task_implementer: d.impl.trim() || null,
        task_time: optNum(d.time),
        task_duration: optNum(d.dur),
        task_dependencies: null,
        task_notes: null,
        task_create_date: today,
        task_modified_date: today,
      }));
  }, [draftTasks]);

  const fullCreateHourRollup = useMemo(
    () => rollUpTaskTimesByPricingGroup(fullCreateDraftTasksForRollup, implementerToGroup),
    [fullCreateDraftTasksForRollup, implementerToGroup]
  );
  const draftPricingTierId = useMemo(() => `draft-tier-${previewTierId}`, [previewTierId]);
  const fullCreateDraftTier = useMemo<SolutionTier>(
    () => ({
      solution_tier_id: draftPricingTierId,
      solution_id: previewSolutionId || "draft-solution",
      solution_tier_name: tName.trim() || "New tier",
      solution_tier_phase: normTierPhase(tPhase),
      solution_tier_category: normTierCategory(tCategory),
      solution_tier_tactic: normTierTactic(tTactic),
      solution_tier_owner: blankToNull(tOwner),
      solution_tier_overview: null,
      solution_tier_overview_link: null,
      solution_tier_direction: null,
      solution_tier_sop: null,
      solution_tier_resources: null,
      solution_tier_resource_templates: null,
      solution_tier_resource_tools: null,
      solution_tier_resource_examples: null,
      solution_tier_what_is_it: null,
      solution_tier_why_is_it_valuable: null,
      solution_tier_when_should_it_be_used: null,
      solution_tier_assumption_prerequisites: null,
      solution_tier_in_scope: null,
      solution_tier_out_of_scope: null,
      solution_tier_final_deliverable: null,
      solution_tier_how_do_we_get_this_work_done: null,
      solution_tier_described_to_client: null,
      solution_tier_created_date: todayISODate(),
      solution_tier_modified_date: todayISODate(),
    }),
    [draftPricingTierId, previewSolutionId, tName, tPhase, tCategory, tTactic, tOwner, normTierPhase, normTierCategory, normTierTactic]
  );

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
    setUpdTName((prev) => (prev.trim() ? prev : t.solution_tier_name));
    setUpdTPhase(t.solution_tier_phase ?? "");
    setUpdTCategory(t.solution_tier_category ?? "");
    setUpdTTactic(t.solution_tier_tactic ?? "");
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
    {
      const h = hydrateTierResourceEditorState(t);
      setUpdResTpl(h.templates);
      setUpdResTools(h.tools);
      setUpdResExamples(h.examples);
    }
  };

  useEffect(() => {
    if (subTab !== "update") return;
    if (solutions.length === 0) {
      setUpdSolutionId("");
      setExpandedSolutionId(null);
      setInlinePricingTierIds(new Set());
      return;
    }
    if (!updSolutionId || !solutions.some((x) => x.solution_id === updSolutionId)) {
      const first = [...solutions].sort((a, b) =>
        a.solution_name.localeCompare(b.solution_name, undefined, { sensitivity: "base" })
      )[0];
      setUpdSolutionId(first.solution_id);
    }
    if (expandedSolutionId && !solutions.some((x) => x.solution_id === expandedSolutionId)) {
      setExpandedSolutionId(null);
      setInlinePricingTierIds(new Set());
    }
  }, [subTab, solutions, updSolutionId, expandedSolutionId]);

  useEffect(() => {
    if (!updTierFocus || !tiersOfUpdateSol.some((t) => t.solution_tier_id === updTierFocus)) {
      setUpdTierFocus(tiersOfUpdateSol[0]?.solution_tier_id ?? "");
    }
  }, [tiersOfUpdateSol, updTierFocus]);

  const clearTierUpdateForm = () => {
    setUpdTierEditId(null);
    setUpdTName("");
    setUpdTPhase("");
    setUpdTCategory("");
    setUpdTTactic("");
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
    setUpdResTpl("");
    setUpdResTools("");
    setUpdResExamples([emptyResourceExampleRow()]);
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
    setUpdTaskBulkSelectedIds(new Set());
  };

  useEffect(() => {
    if (subTab === "update") clearTaskUpdateForm();
  }, [updTierFocus, subTab]);

  useEffect(() => {
    if (subTab !== "update") return;
    setShowUpdateDetails(false);
  }, [subTab]);

  useEffect(() => {
    if (subTab !== "update") {
      setSolutionRenameId(null);
      setSolutionRenameDraft("");
      setTierRenameId(null);
      setTierRenameDraft("");
    }
  }, [subTab]);

  const cancelSolutionRename = useCallback(() => {
    setSolutionRenameId(null);
    setSolutionRenameDraft("");
  }, []);

  const cancelTierRename = useCallback(() => {
    setTierRenameId(null);
    setTierRenameDraft("");
  }, []);

  useEffect(() => {
    cancelTierRename();
  }, [updSolutionId, cancelTierRename]);

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const startEditSolution = (sol: Solution) => {
    cancelSolutionRename();
    cancelTierRename();
    setUpdSolutionId(sol.solution_id);
    setUpdSolName(sol.solution_name);
    setUpdSolType(solutionTypeForEdit(sol));
    setUpdSolAddOnsAllowed(Boolean(sol.add_ons_allowed));
    setShowUpdateDetails(true);
  };

  const startEditTier = (t: SolutionTier) => {
    cancelTierRename();
    setUpdTierFocus(t.solution_tier_id);
    setUpdTierEditId(t.solution_tier_id);
    setUpdTName(t.solution_tier_name);
    setUpdTPhase(t.solution_tier_phase ?? "");
    setUpdTCategory(t.solution_tier_category ?? "");
    setUpdTTactic(t.solution_tier_tactic ?? "");
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
    {
      const h = hydrateTierResourceEditorState(t);
      setUpdResTpl(h.templates);
      setUpdResTools(h.tools);
      setUpdResExamples(h.examples);
    }
    setUpdAutofillFrom(null);
    const parent = solutions.find((s) => s.solution_id === t.solution_id);
    if (parent) {
      setUpdSolName(parent.solution_name);
      setUpdSolType(solutionTypeForEdit(parent));
      setUpdSolAddOnsAllowed(Boolean(parent.add_ons_allowed));
    }
  };

  const saveUpdateSolution = async () => {
    const client = getSupabase();
    if (!client || !updSolutionId) return;
    const name = updSolName.trim();
    if (!name) {
      setOpErr("Solution name is required.");
      return;
    }
    const prev = solutions.find((x) => x.solution_id === updSolutionId);
    if (!prev) return;
    setOpErr(null);
    setOpOk(null);
    const today = todayISODate();
    const patch = {
      solution_name: name,
      solution_type: updSolType,
      add_ons_allowed: updSolAddOnsAllowed,
      solution_modified_date: today,
    };
    const { error } = await client.from("solutions").update(patch).eq("solution_id", updSolutionId);
    if (error) {
      setOpErr(friendlyMutationMessage(error.message));
      return;
    }
    const next: Solution = { ...prev, ...patch };
    await logAudit(client, {
      entityType: "solutions",
      entityId: updSolutionId,
      action: "update",
      before: rowJson(prev),
      after: rowJson(next),
    });
    setOpOk(`Solution "${name}" updated.`);
    await onSaved();
  };

  const saveSolutionRename = async () => {
    const client = getSupabase();
    if (!client || !solutionRenameId) return;
    const name = solutionRenameDraft.trim();
    if (!name) {
      setOpErr("Solution name is required.");
      return;
    }
    const prev = solutions.find((x) => x.solution_id === solutionRenameId);
    if (!prev) {
      cancelSolutionRename();
      return;
    }
    if (name === prev.solution_name) {
      cancelSolutionRename();
      return;
    }
    setOpErr(null);
    setOpOk(null);
    const today = todayISODate();
    const patch = { solution_name: name, solution_modified_date: today };
    const { error } = await client.from("solutions").update(patch).eq("solution_id", solutionRenameId);
    if (error) {
      setOpErr(friendlyMutationMessage(error.message));
      return;
    }
    const next: Solution = { ...prev, ...patch };
    await logAudit(client, {
      entityType: "solutions",
      entityId: solutionRenameId,
      action: "update",
      before: rowJson(prev),
      after: rowJson(next),
    });
    setOpOk(`Solution renamed to "${name}".`);
    cancelSolutionRename();
    await onSaved();
  };

  const saveTierRename = async () => {
    const client = getSupabase();
    if (!client || !tierRenameId) return;
    const name = tierRenameDraft.trim();
    if (!name) {
      setOpErr("Tier name is required.");
      return;
    }
    const prev = tiers.find((x) => x.solution_tier_id === tierRenameId);
    if (!prev) {
      cancelTierRename();
      return;
    }
    if (name === prev.solution_tier_name) {
      cancelTierRename();
      return;
    }
    setOpErr(null);
    setOpOk(null);
    const today = todayISODate();
    const patch = { solution_tier_name: name, solution_tier_modified_date: today };
    const { error } = await client.from("solution_tiers").update(patch).eq("solution_tier_id", tierRenameId);
    if (error) {
      setOpErr(friendlyMutationMessage(error.message));
      return;
    }
    const next: SolutionTier = { ...prev, ...patch };
    await logAudit(client, {
      entityType: "solution_tiers",
      entityId: tierRenameId,
      action: "update",
      before: rowJson(prev),
      after: rowJson(next),
    });
    if (updTierEditId === tierRenameId) setUpdTName(name);
    setOpOk(`Tier renamed to "${name}".`);
    cancelTierRename();
    await onSaved();
  };

  const deleteSolutionById = async (solutionId: string) => {
    const client = getSupabase();
    if (!client || !solutionId) return;
    if (solutionRenameId === solutionId) cancelSolutionRename();
    cancelTierRename();
    setOpErr(null);
    setOpOk(null);
    const prev = solutions.find((x) => x.solution_id === solutionId);
    if (!prev) return;
    const tiersInSolution = tiers.filter((t) => t.solution_id === solutionId);
    const tierIds = tiersInSolution.map((t) => t.solution_tier_id);
    const tasksInSolution = tasks.filter((k) => tierIds.includes(k.solution_tier_id));
    const taskIds = tasksInSolution.map((k) => k.task_id);
    if (
      !window.confirm(
        `Delete solution "${prev.solution_name}" (${solutionId}) and all related data?` +
          `\n\nThis will also delete ${tiersInSolution.length} tier(s) and ${tasksInSolution.length} task(s).`
      )
    ) {
      return;
    }
    if (taskIds.length > 0) {
      // Avoid task_group_lines_shape_check before deleting referenced tasks.
      const { error: relinkErr } = await client
        .from("task_group_lines")
        .update({ line_type: "archetype", source_task_id: null })
        .in("source_task_id", taskIds);
      if (relinkErr) {
        setOpErr(`Could not detach task-group template references: ${relinkErr.message}`);
        return;
      }
      const { error: taskErr } = await client.from("tasks").delete().in("task_id", taskIds);
      if (taskErr) {
        setOpErr(friendlyMutationMessage(taskErr.message));
        return;
      }
    }
    if (tierIds.length > 0) {
      const { error: pricingErr } = await client.from("solution_tier_pricing").delete().in("solution_tier_id", tierIds);
      if (pricingErr) {
        setOpErr(friendlyMutationMessage(pricingErr.message));
        return;
      }
      const { error: tierErr } = await client.from("solution_tiers").delete().in("solution_tier_id", tierIds);
      if (tierErr) {
        setOpErr(friendlyMutationMessage(tierErr.message));
        return;
      }
    }
    const { error } = await client.from("solutions").delete().eq("solution_id", solutionId);
    if (error) {
      setOpErr(friendlyMutationMessage(error.message));
      return;
    }
    await logAudit(client, {
      entityType: "solutions",
      entityId: solutionId,
      action: "delete",
      before: rowJson(prev),
      after: null,
    });
    setOpOk(`Solution deleted (${tiersInSolution.length} tier(s), ${tasksInSolution.length} task(s) removed).`);
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
    const resUpd = resourceStructuredFieldsForSave(updResTpl, updResTools, updResExamples);
    const payload = {
      solution_id: updSolutionId,
      solution_tier_name: updTName.trim(),
      solution_tier_phase: normTierPhase(updTPhase),
      solution_tier_category: normTierCategory(updTCategory),
      solution_tier_tactic: normTierTactic(updTTactic),
      solution_tier_owner: blankToNull(updTOwner),
      solution_tier_overview: legU ? legU.solution_tier_overview : (prevTier?.solution_tier_overview ?? null),
      solution_tier_overview_link: legU
        ? legU.solution_tier_overview_link
        : (prevTier?.solution_tier_overview_link ?? null),
      solution_tier_direction: legU ? legU.solution_tier_direction : (prevTier?.solution_tier_direction ?? null),
      solution_tier_sop: blankToNull(updTSop),
      ...resUpd,
      solution_tier_what_is_it: blankToNull(updTWhatIsIt),
      solution_tier_why_is_it_valuable: blankToNull(updTWhyValuable),
      solution_tier_when_should_it_be_used: blankToNull(updTWhenUsed),
      solution_tier_assumption_prerequisites: blankToNull(updTAssumptionPrereq),
      solution_tier_in_scope: blankToNull(updTInScope),
      solution_tier_out_of_scope: blankToNull(updTOutScope),
      solution_tier_final_deliverable: blankToNull(updTFinalDeliverable),
      solution_tier_how_do_we_get_this_work_done: blankToNull(updTHowWorkDone),
      solution_tier_described_to_client: null,
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

    const { data: newTierRows, error: newTierPrefetchErr } = await client
      .from("solution_tiers")
      .select("solution_tier_id");
    if (newTierPrefetchErr) {
      setOpErr(friendlyMutationMessage(newTierPrefetchErr.message));
      return;
    }
    const id = nextAutoTierId(newTierRows ?? []);
    const row: SolutionTier = {
      solution_tier_id: id,
      solution_id: updSolutionId,
      solution_tier_name: payload.solution_tier_name,
      solution_tier_phase: payload.solution_tier_phase,
      solution_tier_category: payload.solution_tier_category,
      solution_tier_tactic: payload.solution_tier_tactic,
      solution_tier_owner: payload.solution_tier_owner,
      solution_tier_overview: payload.solution_tier_overview,
      solution_tier_overview_link: payload.solution_tier_overview_link,
      solution_tier_direction: payload.solution_tier_direction,
      solution_tier_sop: payload.solution_tier_sop,
      solution_tier_resources: payload.solution_tier_resources ?? null,
      solution_tier_resource_templates: payload.solution_tier_resource_templates ?? null,
      solution_tier_resource_tools: payload.solution_tier_resource_tools ?? null,
      solution_tier_resource_examples: payload.solution_tier_resource_examples ?? null,
      solution_tier_what_is_it: payload.solution_tier_what_is_it,
      solution_tier_why_is_it_valuable: payload.solution_tier_why_is_it_valuable,
      solution_tier_when_should_it_be_used: payload.solution_tier_when_should_it_be_used,
      solution_tier_assumption_prerequisites: payload.solution_tier_assumption_prerequisites,
      solution_tier_in_scope: payload.solution_tier_in_scope,
      solution_tier_out_of_scope: payload.solution_tier_out_of_scope,
      solution_tier_final_deliverable: payload.solution_tier_final_deliverable,
      solution_tier_how_do_we_get_this_work_done: payload.solution_tier_how_do_we_get_this_work_done,
      solution_tier_described_to_client: null,
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

    const tierTasks = tasks.filter((k) => k.solution_tier_id === t.solution_tier_id);
    const taskIds = tierTasks.map((k) => k.task_id);
    const pricingRow = tierPricing.find((p) => p.solution_tier_id === t.solution_tier_id) ?? null;
    const pkgLinkCount = packageTiers.filter((pt) => pt.solution_tier_id === t.solution_tier_id).length;

    const summaryLines: string[] = [];
    if (taskIds.length > 0) {
      summaryLines.push(`• ${taskIds.length} vault task(s)`);
    }
    summaryLines.push("• Pricing row for this tier in the vault (if any)");
    if (pkgLinkCount > 0) {
      summaryLines.push(
        `• ${pkgLinkCount} package assignment(s) — this tier will be removed from those packages`
      );
    }

    if (tierRenameId === t.solution_tier_id) cancelTierRename();

    if (
      !window.confirm(
        `Delete tier "${t.solution_tier_name}" (${t.solution_tier_id})?\n\n` +
          `This permanently removes:\n${summaryLines.join("\n")}\n\n` +
          `Related database rows (e.g. task-group applications) are cleaned up automatically.\n\n` +
          `You cannot undo this.`
      )
    ) {
      return;
    }

    setOpErr(null);
    setOpOk(null);

    try {
      if (taskIds.length > 0) {
        const { error: relinkErr } = await client
          .from("task_group_lines")
          .update({ line_type: "archetype", source_task_id: null })
          .in("source_task_id", taskIds);
        if (relinkErr) {
          setOpErr(`Could not detach task-group template references: ${relinkErr.message}`);
          return;
        }
        const { error: taskErr } = await client.from("tasks").delete().in("task_id", taskIds);
        if (taskErr) {
          setOpErr(friendlyMutationMessage(taskErr.message));
          return;
        }
        for (const task of tierTasks) {
          await logAudit(client, {
            entityType: "tasks",
            entityId: task.task_id,
            action: "delete",
            before: rowJson(task),
            after: null,
          });
        }
      }

      const { error: pricingErr } = await client
        .from("solution_tier_pricing")
        .delete()
        .eq("solution_tier_id", t.solution_tier_id);
      if (pricingErr) {
        setOpErr(friendlyMutationMessage(pricingErr.message));
        return;
      }
      if (pricingRow) {
        await logAudit(client, {
          entityType: "solution_tier_pricing",
          entityId: t.solution_tier_id,
          action: "delete",
          before: rowJson(pricingRow),
          after: null,
        });
      }

      const { error } = await client.from("solution_tiers").delete().eq("solution_tier_id", t.solution_tier_id);
      if (error) {
        setOpErr(friendlyMutationMessage(error.message));
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
      setOpOk(
        taskIds.length > 0
          ? `Tier deleted (removed ${taskIds.length} task(s)${pricingRow ? " and pricing" : ""}).`
          : "Tier deleted."
      );
      await onSaved();
    } catch (e) {
      setOpErr(friendlyMutationMessage(String(e)));
    }
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
    const { rows: updTaskSeedRows, error: updTaskPrefetchErr } = await fetchAllTaskIdRows(client);
    if (updTaskPrefetchErr) {
      setOpErr(friendlyMutationMessage(updTaskPrefetchErr));
      return;
    }
    let localTasks: Pick<TaskRow, "task_id">[] = [...updTaskSeedRows];
    const baseMaxSort = tierMaxSortOrder(tasks, updTierFocus);
    for (let i = 0; i < rowsToSave.length; i++) {
      const d = rowsToSave[i]!;
      const id = nextAutoTaskId(localTasks);
      const row: TaskRow = {
        task_id: id,
        solution_tier_id: updTierFocus,
        sort_order: baseMaxSort + i + 1,
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
    const pricingSync = await syncPricingFromTasks(updTierFocus);
    if (!pricingSync.ok) {
      setOpErr(`Tasks created, but pricing sync failed: ${pricingSync.message}`);
      await onSaved();
      return;
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
    const pricingSync = await syncPricingFromTasks(updTierFocus);
    if (!pricingSync.ok) {
      setOpErr(`Task saved, but pricing sync failed: ${pricingSync.message}`);
      await onSaved();
      return;
    }
    setOpOk("Task saved.");
    clearTaskUpdateForm();
    await onSaved();
  };

  const deleteUpdateTask = async (k: TaskRow) => {
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    // A task can be referenced by task-group template lines in copy_from_task mode.
    // If we delete the task first, source_task_id becomes null and can violate
    // task_group_lines_shape_check. Convert those lines to archetype before delete.
    const { error: relinkErr } = await client
      .from("task_group_lines")
      .update({ line_type: "archetype", source_task_id: null })
      .eq("source_task_id", k.task_id);
    if (relinkErr) {
      setOpErr(`Could not detach task-group template references: ${relinkErr.message}`);
      return;
    }
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
    const pricingSync = await syncPricingFromTasks(k.solution_tier_id);
    if (!pricingSync.ok) {
      setOpErr(`Task deleted, but pricing sync failed: ${pricingSync.message}`);
      await onSaved();
      return;
    }
    setOpOk("Task deleted.");
    await onSaved();
  };

  const bulkDeleteSelectedUpdateTasks = useCallback(async () => {
    const ids = [...updTaskBulkSelectedIds];
    if (ids.length === 0) return;
    if (!window.confirm(`Delete ${ids.length} selected task(s) from this tier?`)) return;

    const client = getSupabase();
    if (!client) return;
    setUpdTaskBulkBusy(true);
    setOpErr(null);
    setOpOk(null);

    const selectedTasks = tasksOfFocusTier.filter((t) => updTaskBulkSelectedIds.has(t.task_id));

    try {
      // Prevent task-group template lines that were using these tasks as source from breaking shape-checks.
      const { error: relinkErr } = await client
        .from("task_group_lines")
        .update({ line_type: "archetype", source_task_id: null })
        .in("source_task_id", ids);
      if (relinkErr) {
        setOpErr(`Could not detach task-group template references: ${relinkErr.message}`);
        return;
      }

      const { error: delErr } = await client.from("tasks").delete().in("task_id", ids);
      if (delErr) {
        setOpErr(delErr.message);
        return;
      }

      for (const t of selectedTasks) {
        await logAudit(client, {
          entityType: "tasks",
          entityId: t.task_id,
          action: "delete",
          before: rowJson(t),
          after: null,
        });
      }

      if (updTaskEditId && ids.includes(updTaskEditId)) clearTaskUpdateForm();
      setUpdTaskBulkSelectedIds(new Set());
      const pricingSync = await syncPricingFromTasks(updTierFocus!);
      if (!pricingSync.ok) {
        setOpErr(`Deleted tasks, but pricing sync failed: ${pricingSync.message}`);
        await onSaved();
        return;
      }
      setOpOk(`Deleted ${ids.length} task(s).`);
      await onSaved();
    } finally {
      setUpdTaskBulkBusy(false);
    }
  }, [
    clearTaskUpdateForm,
    logAudit,
    onSaved,
    rowJson,
    setOpErr,
    setOpOk,
    syncPricingFromTasks,
    tasksOfFocusTier,
    updTaskBulkSelectedIds,
    updTaskEditId,
    updTierFocus,
  ]);

  const applyFocusTierTaskOrder = useCallback(
    async (orderedIds: UniqueIdentifier[]) => {
      const client = getSupabase();
      if (!client || !updTierFocus) return;
      const ids = orderedIds.map(String);
      setUpdTaskReorderBusy(true);
      setOpErr(null);
      setOpOk(null);
      try {
        const res = await persistTaskSortOrdersForTier(client, updTierFocus, ids);
        if (!res.ok) {
          setOpErr(res.message);
          return;
        }
        await onSaved();
        setOpOk("Task order updated.");
      } finally {
        setUpdTaskReorderBusy(false);
      }
    },
    [onSaved, updTierFocus]
  );

  const applyTaskGroupTemplateToTier = useCallback(async () => {
    if (!updTierFocus || !applyTemplateGroupId) {
      showSbInline("upd_apply_tg", "Select a tier and a task group template.", "err");
      return;
    }
    const lines = (taskGroupLines ?? [])
      .filter((l) => l.task_group_id === applyTemplateGroupId)
      .sort((a, b) => a.sort_order - b.sort_order);
    const res = await applyTaskGroupToTier({
      solution_tier_id: updTierFocus,
      task_group_id: applyTemplateGroupId,
      lines,
      allTasks: tasks,
      logAudit,
    });
    if (!res.ok) {
      showSbInline("upd_apply_tg", res.message, "err");
      return;
    }
    showSbInline("upd_apply_tg", `Added ${res.created} task(s) from the template.`, "ok");
    setApplyTemplateGroupId("");
    await onSaved();
  }, [
    applyTemplateGroupId,
    logAudit,
    onSaved,
    showSbInline,
    taskGroupLines,
    tasks,
    updTierFocus,
  ]);

  const applyTaskGroupTemplateToCreateTier = useCallback(() => {
    if (!ctxTierId.trim() || !createApplyTemplateGroupId) {
      showSbInline(
        "to_apply_tg",
        "Select a task group template to apply (tier is already set from the previous step).",
        "err"
      );
      return;
    }
    const lines = (taskGroupLines ?? [])
      .filter((l) => l.task_group_id === createApplyTemplateGroupId)
      .sort((a, b) => a.sort_order - b.sort_order);
    if (lines.length === 0) {
      showSbInline("to_apply_tg", "This task group has no lines.", "err");
      return;
    }
    const sourceTaskGroupName =
      taskGroups.find((g) => g.id === createApplyTemplateGroupId)?.name ?? createApplyTemplateGroupId;
    const newRows = draftRowsFromTaskGroupLines(lines, tasks, sourceTaskGroupName);
    if (newRows.length === 0) {
      showSbInline("to_apply_tg", "No rows could be built from that template.", "err");
      return;
    }
    setDraftTasks((prev) => [...prev, ...newRows]);
    showSbInline(
      "to_apply_tg",
      `Added ${newRows.length} editable draft row(s) from the template. You can adjust them below before saving.`,
      "ok"
    );
    setCreateApplyTemplateGroupId("");
  }, [createApplyTemplateGroupId, ctxTierId, showSbInline, taskGroupLines, taskGroups, tasks]);

  const appendTaskGroupToFullSolutionDraft = useCallback(() => {
    if (!fullStackApplyGroupId) {
      showSbInline("fs_apply_tg", "Select a task group template.", "err");
      return;
    }
    const lines = (taskGroupLines ?? [])
      .filter((l) => l.task_group_id === fullStackApplyGroupId)
      .sort((a, b) => a.sort_order - b.sort_order);
    if (lines.length === 0) {
      showSbInline("fs_apply_tg", "This task group has no lines.", "err");
      return;
    }
    const sourceTaskGroupName =
      taskGroups.find((g) => g.id === fullStackApplyGroupId)?.name ?? fullStackApplyGroupId;
    const newRows = draftRowsFromTaskGroupLines(lines, tasks, sourceTaskGroupName);
    if (newRows.length === 0) {
      showSbInline("fs_apply_tg", "No rows could be built from that template.", "err");
      return;
    }
    setDraftTasks((prev) => [...prev, ...newRows]);
    showSbInline(
      "fs_apply_tg",
      `Added ${newRows.length} row(s) from the template — edit below, then Create entire solution when ready.`,
      "ok"
    );
    setFullStackApplyGroupId("");
  }, [fullStackApplyGroupId, showSbInline, taskGroupLines, tasks]);

  const appendTierTasksToFullStackDraft = useCallback(() => {
    if (!fullStackCopyTierId.trim()) {
      showSbInline("fs_copy_tier", "Select a tier to copy tasks from.", "err");
      return;
    }
    const srcId = fullStackCopyTierId.trim();
    const { name } = sourceTierMeta(tiers, srcId);
    const seeds = draftFieldsFromTierVaultTasks(tasks, srcId, name);
    if (seeds.length === 0) {
      showSbInline("fs_copy_tier", "That tier has no vault tasks to copy.", "err");
      return;
    }
    const added: DraftTaskRow[] = seeds.map((s) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${Math.random().toString(36).slice(2, 6)}`,
      name: s.name,
      impl: s.impl,
      time: s.time,
      dur: s.dur,
      dep: s.dep,
      notes: s.notes,
      source: s.source,
    }));
    setDraftTasks((prev) => [...prev, ...added]);
    showSbInline(
      "fs_copy_tier",
      `Added ${added.length} draft row(s) from tier ${srcId}. Saves with Create entire solution.`,
      "ok"
    );
    setFullStackCopyTierId("");
  }, [fullStackCopyTierId, showSbInline, tasks, tiers]);

  const applyCopiedTierTasksToTierOnlyTier = useCallback(() => {
    if (!ctxTierId.trim() || !tierOnlyCopyTierId.trim()) {
      showSbInline(
        "to_copy_tier",
        tierOnlyCopyTierId.trim()
          ? "Tier context is missing — create the tier in Section 1 first."
          : "Select which tier's tasks to clone into this wizard.",
        "err"
      );
      return;
    }
    const srcId = tierOnlyCopyTierId.trim();
    if (srcId === ctxTierId.trim()) {
      showSbInline("to_copy_tier", "Pick a different tier than the one you're building.", "err");
      return;
    }
    const { name } = sourceTierMeta(tiers, srcId);
    const seeds = draftFieldsFromTierVaultTasks(tasks, srcId, name);
    if (seeds.length === 0) {
      showSbInline("to_copy_tier", "That tier has no vault tasks to copy.", "err");
      return;
    }
    const added: DraftTaskRow[] = seeds.map((s) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${Math.random().toString(36).slice(2, 6)}`,
      name: s.name,
      impl: s.impl,
      time: s.time,
      dur: s.dur,
      dep: s.dep,
      notes: s.notes,
      source: s.source,
    }));
    setDraftTasks((prev) => [...prev, ...added]);
    showSbInline(
      "to_copy_tier",
      `Added ${added.length} editable draft row(s) from tier ${srcId}. Save all tasks when ready.`,
      "ok"
    );
    setTierOnlyCopyTierId("");
  }, [ctxTierId, tierOnlyCopyTierId, showSbInline, tiers, tasks]);

  const applyCopiedTierTasksToUpdateFocusedTier = useCallback(async () => {
    if (!updTierFocus.trim() || !updCopyTierPick.trim()) {
      showSbInline(
        "upd_copy_db",
        "Select both the working tier above and a source tier whose vault tasks should be copied.",
        "err"
      );
      return;
    }
    const res = await insertCopiedVaultTasksFromTier({
      targetTierId: updTierFocus.trim(),
      sourceTierId: updCopyTierPick.trim(),
      allTasks: tasks,
      tiers,
      logAudit,
    });
    if (!res.ok) {
      showSbInline("upd_copy_db", res.message, "err");
      return;
    }
    showSbInline(
      "upd_copy_db",
      `Copied ${res.created} vault task(s) onto ${updTierFocus.trim()} from ${updCopyTierPick.trim()}.`,
      "ok"
    );
    setUpdCopyTierPick("");
    await onSaved();
  }, [updTierFocus, updCopyTierPick, tiers, tasks, logAudit, onSaved, showSbInline]);

  const appendTierTasksToUpdateNewDrafts = useCallback(() => {
    if (!updCopyTierPick.trim()) {
      showSbInline(
        "upd_copy_draft",
        "Select a tier whose tasks should populate the draft table.",
        "err"
      );
      return;
    }
    const srcId = updCopyTierPick.trim();
    if (srcId === updTierFocus.trim()) {
      showSbInline(
        "upd_copy_draft",
        "Pick a different tier than the one you're adding tasks for.",
        "err"
      );
      return;
    }
    const { name } = sourceTierMeta(tiers, srcId);
    const seeds = draftFieldsFromTierVaultTasks(tasks, srcId, name);
    if (seeds.length === 0) {
      showSbInline("upd_copy_draft", "That tier has no vault tasks to copy.", "err");
      return;
    }
    const added: DraftTaskRow[] = seeds.map((s) => ({
      key: `${Date.now()}-${Math.random().toString(36).slice(2, 11)}-${Math.random().toString(36).slice(2, 6)}`,
      name: s.name,
      impl: s.impl,
      time: s.time,
      dur: s.dur,
      dep: s.dep,
      notes: s.notes,
      source: s.source,
    }));
    setUpdNewTaskDrafts((prev) => [...prev, ...added]);
    showSbInline(
      "upd_copy_draft",
      `Appended ${added.length} row(s) to the draft table (tier ${srcId}). Save all new tasks when ready.`,
      "ok"
    );
  }, [updCopyTierPick, updTierFocus, showSbInline, tiers, tasks]);

  const startEditTask = (k: TaskRow) => {
    setUpdTaskBulkSelectedIds(new Set());
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
        Fills fields below this control (and copies overview, link, and direction on save). If <strong>Tier name</strong> is
        empty, it uses the source tier&apos;s name; if you already typed a name, it is left unchanged. Clear the list to use
        blank legacy fields.
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
        Fills the form; empty <strong>Tier name</strong> is filled from the source tier, otherwise your typed name is kept.
        When editing, overview/link/direction are only overwritten if you pick a source tier.
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
      <TierTaxonomyFormFields
        lbl={lbl}
        input={input}
        phase={tPhase}
        setPhase={setTPhase}
        category={tCategory}
        setCategory={setTCategory}
        tactic={tTactic}
        setTactic={setTTactic}
        taxonomy={taxonomy}
      />
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Owner</AdminFieldCaption>
        <input style={input} value={tOwner} onChange={(e) => setTOwner(e.target.value)} />
      </label>
      {createTierAutofillBlock}

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Description</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is it</AdminFieldCaption>
        <MarkdownTextarea value={tWhatIsIt} onChange={setTWhatIsIt} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Why is it valuable</AdminFieldCaption>
        <MarkdownTextarea value={tWhyValuable} onChange={setTWhyValuable} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>When should it be used</AdminFieldCaption>
        <MarkdownTextarea value={tWhenUsed} onChange={setTWhenUsed} textareaStyle={textarea} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Scope</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What assumptions or prerequisites must be in place</AdminFieldCaption>
        <MarkdownTextarea value={tAssumptionPrereq} onChange={setTAssumptionPrereq} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is included in scope</AdminFieldCaption>
        <MarkdownTextarea value={tInScope} onChange={setTInScope} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is not included in scope</AdminFieldCaption>
        <MarkdownTextarea value={tOutScope} onChange={setTOutScope} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is the final deliverable</AdminFieldCaption>
        <MarkdownTextarea value={tFinalDeliverable} onChange={setTFinalDeliverable} textareaStyle={textarea} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Process</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>How do we get this work done</AdminFieldCaption>
        <MarkdownTextarea value={tHowWorkDone} onChange={setTHowWorkDone} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>SOP</AdminFieldCaption>
        <MarkdownTextarea value={tSop} onChange={setTSop} textareaStyle={textarea} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Resources</h4>
      <div style={{ gridColumn: "1 / -1" }}>
        <TierResourcesEditor
          templates={tResTpl}
          tools={tResTools}
          examples={tResExamples}
          textareaStyle={textarea}
          onTemplates={setTResTpl}
          onTools={setTResTools}
          onExamplesChange={setTResExamples}
        />
      </div>
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
      <TierTaxonomyFormFields
        lbl={lbl}
        input={input}
        phase={updTPhase}
        setPhase={setUpdTPhase}
        category={updTCategory}
        setCategory={setUpdTCategory}
        tactic={updTTactic}
        setTactic={setUpdTTactic}
        taxonomy={taxonomy}
      />
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Owner</AdminFieldCaption>
        <input style={input} value={updTOwner} onChange={(e) => setUpdTOwner(e.target.value)} />
      </label>
      {updateTierAutofillBlock}

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Description</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is it</AdminFieldCaption>
        <MarkdownTextarea value={updTWhatIsIt} onChange={setUpdTWhatIsIt} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Why is it valuable</AdminFieldCaption>
        <MarkdownTextarea value={updTWhyValuable} onChange={setUpdTWhyValuable} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>When should it be used</AdminFieldCaption>
        <MarkdownTextarea value={updTWhenUsed} onChange={setUpdTWhenUsed} textareaStyle={textarea} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Scope</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What assumptions or prerequisites must be in place</AdminFieldCaption>
        <MarkdownTextarea value={updTAssumptionPrereq} onChange={setUpdTAssumptionPrereq} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is included in scope</AdminFieldCaption>
        <MarkdownTextarea value={updTInScope} onChange={setUpdTInScope} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is not included in scope</AdminFieldCaption>
        <MarkdownTextarea value={updTOutScope} onChange={setUpdTOutScope} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>What is the final deliverable</AdminFieldCaption>
        <MarkdownTextarea value={updTFinalDeliverable} onChange={setUpdTFinalDeliverable} textareaStyle={textarea} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Process</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>How do we get this work done</AdminFieldCaption>
        <MarkdownTextarea value={updTHowWorkDone} onChange={setUpdTHowWorkDone} textareaStyle={textarea} />
      </label>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>SOP</AdminFieldCaption>
        <MarkdownTextarea value={updTSop} onChange={setUpdTSop} textareaStyle={textarea} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Resources</h4>
      <div style={{ gridColumn: "1 / -1" }}>
        <TierResourcesEditor
          templates={updResTpl}
          tools={updResTools}
          examples={updResExamples}
          textareaStyle={textarea}
          onTemplates={setUpdResTpl}
          onTools={setUpdResTools}
          onExamplesChange={setUpdResExamples}
        />
      </div>
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

  const duplicateUpdNewDraftRow = (key: string) => {
    setUpdNewTaskDrafts((list) => {
      const i = list.findIndex((r) => r.key === key);
      if (i === -1) return list;
      const row = list[i];
      const copy: DraftTaskRow = {
        ...row,
        key: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      };
      return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
    });
  };

  const reorderUpdNewDraftsByKeys = useCallback((nextKeys: UniqueIdentifier[]) => {
    setUpdNewTaskDrafts((prev) => {
      const m = new Map(prev.map((r) => [r.key, r]));
      return nextKeys.map((k) => m.get(String(k))).filter((r): r is DraftTaskRow => r != null);
    });
  }, []);

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
    <section className="admin-panel admin-panel--editor admin-solutions-builder" style={panel}>
      <datalist id={taskNameDatalistId}>
        {sortedTaskNamesForDatalist.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
      <div className="admin-editor-layout admin-editor-layout--wide">
        <header className="admin-sb-hero">
          <h2 className="admin-sb-hero__title" style={h2}>
            Solutions Builder
          </h2>
          <p className="admin-sb-hero__lead" style={muted}>
            {subTab === "create" ? (
              <>
                One place to fill everything: solution, tier, tasks, and pricing. Use <strong>Create new / Update</strong>{" "}
                above to switch modes. Id pattern: <code>1-</code> package → <code>2-</code> solution → <code>3-</code>{" "}
                tier → <code>4-</code> task.
              </>
            ) : (
              <>
                Select a solution, then work through <strong>Solution</strong>, <strong>Tiers</strong>, and{" "}
                <strong>Tasks &amp; pricing</strong>. For brand-new records, use the <strong>Create new</strong> button in
                this panel.
              </>
            )}
          </p>
        </header>

        {subTab === "create" && (
          <>
            <SolutionsBuilderCreateStepper branch={createBranch} phase={createPhase} />
            <div className="admin-actions-row" style={{ marginTop: 0, marginBottom: 6 }}>
              <button type="button" style={btn} onClick={() => onRequestSubTabChange?.("update")}>
                Back to solution list
              </button>
            </div>
            {createPhase === "choose" && (
              <>
                <h3 className="admin-sb-subhead" style={sectionTitle}>
                  What do you want to create?
                </h3>
                <div className="admin-sb-choice-row" style={choiceRow}>
                  <button
                    type="button"
                    className="admin-sb-choice-card"
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
                    className="admin-sb-choice-card"
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
              <div className="admin-sb-block" style={{ marginTop: "0.6rem" }}>
                <h3 className="admin-sb-subhead" style={sectionTitle}>
                  New solution — one page, one save
                </h3>
                <p style={{ ...muted, marginTop: 0, maxWidth: "62ch" }}>
                  Use the sections below; when you are ready, click <strong>Create entire solution</strong> at the end.
                </p>
                <div style={idLegendBar}>
                  <strong style={{ color: "var(--text)" }}>Id prefixes:</strong> package <code>1-</code> · solution{" "}
                  <code>2-</code> · solution tier <code>3-</code> · task <code>4-</code>. On this save: solution{" "}
                  <code>{previewSolutionId}</code>, tier <code>{previewTierId}</code>, tasks from{" "}
                  <code>{previewTaskId}</code> upward.
                </div>
                <nav className="admin-sb-quicknav" aria-label="Jump to section">
                  <a href="#sb-full-section-solution" className="admin-sb-quicknav__link">
                    1. Solution &amp; tier
                  </a>
                  <a href="#sb-full-section-tasks" className="admin-sb-quicknav__link">
                    2. Tasks
                  </a>
                  <a href="#sb-full-section-pricing" className="admin-sb-quicknav__link">
                    3. Pricing
                  </a>
                  <a href="#sb-full-save" className="admin-sb-quicknav__link">
                    Final save
                  </a>
                </nav>

                <div style={formSectionBox}>
                  <h4 id="sb-full-section-solution" style={formSectionHeading}>
                    Section 1 — Solution &amp; tier
                  </h4>
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
                    <AdminFieldCaption>Solution type</AdminFieldCaption>
                    <select
                      style={input}
                      value={solTypeDraft}
                      onChange={(e) => setSolTypeDraft(e.target.value as SolutionType)}
                    >
                      <option value="configured_solution">Configured Solution</option>
                      <option value="solution_module">Solution Module</option>
                    </select>
                  </label>
                  <label
                    style={{
                      ...lbl,
                      gridColumn: "1 / -1",
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={solAddOnsAllowed}
                      onChange={(e) => setSolAddOnsAllowed(e.target.checked)}
                    />
                    Add Ons Allowed?
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Tier name</AdminFieldCaption>
                    <input style={input} value={tName} onChange={(e) => setTName(e.target.value)} />
                  </label>
                  <TierTaxonomyFormFields
                    lbl={lbl}
                    input={input}
                    phase={tPhase}
                    setPhase={setTPhase}
                    category={tCategory}
                    setCategory={setTCategory}
                    tactic={tTactic}
                    setTactic={setTTactic}
                    taxonomy={taxonomy}
                  />
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Owner</AdminFieldCaption>
                    <input style={input} value={tOwner} onChange={(e) => setTOwner(e.target.value)} />
                  </label>
                  {createTierAutofillBlock}

                  <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Description</h4>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>What is it</AdminFieldCaption>
                    <MarkdownTextarea value={tWhatIsIt} onChange={setTWhatIsIt} textareaStyle={textarea} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Why is it valuable</AdminFieldCaption>
                    <MarkdownTextarea value={tWhyValuable} onChange={setTWhyValuable} textareaStyle={textarea} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>When should it be used</AdminFieldCaption>
                    <MarkdownTextarea value={tWhenUsed} onChange={setTWhenUsed} textareaStyle={textarea} />
                  </label>

                  <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Scope</h4>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>What assumptions or prerequisites must be in place</AdminFieldCaption>
                    <MarkdownTextarea value={tAssumptionPrereq} onChange={setTAssumptionPrereq} textareaStyle={textarea} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>What is included in scope</AdminFieldCaption>
                    <MarkdownTextarea value={tInScope} onChange={setTInScope} textareaStyle={textarea} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>What is not included in scope</AdminFieldCaption>
                    <MarkdownTextarea value={tOutScope} onChange={setTOutScope} textareaStyle={textarea} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>What is the final deliverable</AdminFieldCaption>
                    <MarkdownTextarea value={tFinalDeliverable} onChange={setTFinalDeliverable} textareaStyle={textarea} />
                  </label>

                  <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Process</h4>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>How do we get this work done</AdminFieldCaption>
                    <MarkdownTextarea value={tHowWorkDone} onChange={setTHowWorkDone} textareaStyle={textarea} />
                  </label>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>SOP</AdminFieldCaption>
                    <MarkdownTextarea value={tSop} onChange={setTSop} textareaStyle={textarea} />
                  </label>

                  <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Resources</h4>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <TierResourcesEditor
                      templates={tResTpl}
                      tools={tResTools}
                      examples={tResExamples}
                      textareaStyle={textarea}
                      onTemplates={setTResTpl}
                      onTools={setTResTools}
                      onExamplesChange={setTResExamples}
                    />
                  </div>
                  </div>
                </div>

                <div style={formSectionBox}>
                  <h4 id="sb-full-section-tasks" style={formSectionHeading}>
                    Section 2 — Tasks
                  </h4>
                  <p style={{ ...muted, marginTop: 0, marginBottom: "0.75rem" }}>
                    Add rows by hand, load a <strong>task-group template</strong> (templates in{" "}
                    <strong>Admin → Task-Group templates</strong>), or <strong>copy vault tasks</strong> from an existing
                    tier below. On save, each named row becomes a vault task (id <code>4-…</code>) for the new tier — at least
                    one task name is required.
                  </p>
                {taskGroups.length > 0 ? (
                  <div style={{ ...formSectionBox, marginTop: 0, marginBottom: 12, background: "rgba(13, 92, 77, 0.04)" }}>
                    <p style={formSectionHeading}>Add from task group</p>
                    <p style={{ ...muted, margin: "0 0 0.6rem", fontSize: "0.86rem", maxWidth: "56ch" }}>
                      Appends template lines to the table below. Copy-from-task lines use live task data when the source
                      exists; otherwise template snapshot fields are used. You can add more than once.
                    </p>
                    <label style={{ ...lbl, maxWidth: 420, display: "block" }}>
                      <AdminFieldCaption>Task group</AdminFieldCaption>
                      <select
                        style={input}
                        value={fullStackApplyGroupId}
                        onChange={(e) => setFullStackApplyGroupId(e.target.value)}
                      >
                        <option value="">— Select a template —</option>
                        {taskGroups.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="admin-actions-row" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="admin-btn-primary"
                        style={btnPrimary}
                        onClick={() => void appendTaskGroupToFullSolutionDraft()}
                        disabled={!fullStackApplyGroupId}
                      >
                        Add to task list
                      </button>
                      <InlineActionFeedback model={pickInlineFeedback(sbInlineFb, "fs_apply_tg")} style={{ flex: "1 1 14rem", marginTop: 0 }} />
                    </div>
                  </div>
                ) : null}
                {tiers.length > 0 ? (
                  <div style={{ ...formSectionBox, marginTop: 0, marginBottom: 12, background: "rgba(13, 92, 77, 0.04)" }}>
                    <p style={formSectionHeading}>Copy vault tasks from another tier</p>
                    <p style={{ ...muted, margin: "0 0 0.6rem", fontSize: "0.86rem", maxWidth: "56ch" }}>
                      Appends a snapshot of vault tasks onto the draft table below (names, fields, attribution in notes).
                      You can still edit rows before clicking Create entire solution.
                    </p>
                    <label style={{ ...lbl, maxWidth: 480, display: "block" }}>
                      <AdminFieldCaption>Source tier</AdminFieldCaption>
                      <select
                        style={input}
                        value={fullStackCopyTierId}
                        onChange={(e) => setFullStackCopyTierId(e.target.value)}
                      >
                        <option value="">— Select a tier —</option>
                        {sortedTiersForAutofill.map((t) => {
                          const n = tasks.filter((k) => k.solution_tier_id === t.solution_tier_id).length;
                          return (
                            <option key={t.solution_tier_id} value={t.solution_tier_id} disabled={n === 0}>
                              {t.solution_tier_id} — {t.solution_tier_name} ({solutionNameForTier(t.solution_id)}) [{n}{" "}
                              task(s)]
                            </option>
                          );
                        })}
                      </select>
                    </label>
                    <div className="admin-actions-row" style={{ marginTop: 8 }}>
                      <button
                        type="button"
                        className="admin-btn-primary"
                        style={btnPrimary}
                        onClick={() => void appendTierTasksToFullStackDraft()}
                        disabled={!fullStackCopyTierId.trim()}
                      >
                        Add to task list
                      </button>
                      <InlineActionFeedback model={pickInlineFeedback(sbInlineFb, "fs_copy_tier")} style={{ flex: "1 1 14rem", marginTop: 0 }} />
                    </div>
                  </div>
                ) : null}
                <div className="admin-table-scroll" style={{ marginTop: 8 }}>
                  <table className="admin-data-table" style={{ ...tbl, minWidth: 720 }}>
                    <thead>
                      <tr>
                        <th style={th}>
                          <span style={{ opacity: 0.6 }}>#</span>
                        </th>
                        <th style={{ ...th, width: 48 }} aria-label="Drag to reorder" />
                        <th style={th}>Task name</th>
                        <th style={th}>SOURCE</th>
                        <th style={th}>Implementer</th>
                        <th style={th}>Time</th>
                        <th style={th}>Duration</th>
                        <th style={th}>Dependencies</th>
                        <th style={th}>Notes</th>
                        <th style={{ ...th, width: 140 }} />
                      </tr>
                    </thead>
                    <TaskSortableList itemIds={draftTasks.map((d) => d.key)} onReorder={reorderDraftTasksByKeys}>
                      <tbody>
                        {draftTasks.map((d) => (
                          <SortableTableRowTr
                            key={d.key}
                            id={d.key}
                            renderCells={(dragHandle) => [
                              <td style={td} key="chk">
                                <input
                                  type="checkbox"
                                  checked={draftTaskBulkSelectedKeys.has(d.key)}
                                  onChange={() => {
                                    setDraftTaskBulkSelectedKeys((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(d.key)) next.delete(d.key);
                                      else next.add(d.key);
                                      return next;
                                    });
                                  }}
                                />
                              </td>,
                              <td style={td} key="drag">
                                {dragHandle}
                              </td>,
                              <td style={td} key="name">
                                <input
                                  style={input}
                                  list={taskNameDatalistId}
                                  value={d.name}
                                  onChange={(e) => onDraftTaskNameChange(d.key, e.target.value)}
                                />
                              </td>,
                              <td style={td} key="src">
                                {d.source}
                              </td>,
                              <td style={td} key="impl">
                                <TaskImplementerSelect
                                  value={d.impl}
                                  options={distinctImplementerOptions}
                                  inputStyle={input}
                                  onChange={(v) => updateDraftRow(d.key, { impl: v })}
                                />
                              </td>,
                              <td style={td} key="time">
                                <input
                                  style={input}
                                  value={d.time}
                                  onChange={(e) => updateDraftRow(d.key, { time: e.target.value })}
                                />
                              </td>,
                              <td style={td} key="dur">
                                <input
                                  style={input}
                                  value={d.dur}
                                  onChange={(e) => updateDraftRow(d.key, { dur: e.target.value })}
                                />
                              </td>,
                              <td style={td} key="dep">
                                <input
                                  style={input}
                                  value={d.dep}
                                  onChange={(e) => updateDraftRow(d.key, { dep: e.target.value })}
                                />
                              </td>,
                              <td style={td} key="notes">
                                <input
                                  style={input}
                                  value={d.notes}
                                  onChange={(e) => updateDraftRow(d.key, { notes: e.target.value })}
                                />
                              </td>,
                              <td style={td} key="rm">
                                <span
                                  style={{
                                    display: "inline-flex",
                                    gap: 8,
                                    flexWrap: "wrap",
                                    alignItems: "center",
                                  }}
                                >
                                  <button type="button" style={btnSm} onClick={() => duplicateDraftTaskRow(d.key)}>
                                    Copy
                                  </button>
                                  <button type="button" style={btnDangerSm} onClick={() => removeDraftTaskRow(d.key)}>
                                    Remove
                                  </button>
                                </span>
                              </td>,
                            ]}
                          />
                        ))}
                      </tbody>
                    </TaskSortableList>
                    <tbody>
                      <tr>
                        <td style={td} />
                        <td style={td} />
                        <td style={td} />
                        <td style={td} />
                        <td style={td} />
                        <td style={{ ...td, fontWeight: 700 }}>TOTAL</td>
                        <td style={{ ...td, fontWeight: 700 }}>{draftTaskTotalHours}</td>
                        <td style={td} />
                        <td style={td} />
                        <td style={td} />
                      </tr>
                    </tbody>
                  </table>
                </div>
                <div className="admin-actions-row" style={{ marginTop: 8 }}>
                  <button type="button" style={btn} onClick={() => addDraftTaskRow()}>
                    Add task row
                  </button>
                  <InlineActionFeedback model={pickInlineFeedback(sbInlineFb, "fs_add_row")} style={{ flex: "1 1 14rem", marginTop: 0 }} />
                </div>
                </div>

                <div className="admin-actions-row" style={{ marginTop: 10 }}>
                  <button
                    type="button"
                    style={btnDangerSm}
                    disabled={
                      draftTaskBulkSelectedKeys.size === 0 ||
                      draftTasks.every((d) => !draftTaskBulkSelectedKeys.has(d.key))
                    }
                    onClick={() => {
                      const ids = [...draftTaskBulkSelectedKeys].filter((k) =>
                        draftTasks.some((d) => d.key === k)
                      );
                      if (ids.length === 0) return;
                      if (!window.confirm(`Delete ${ids.length} selected task draft(s)?`)) return;
                      const idSet = new Set(ids);
                      setDraftTasks((prev) => {
                        const next = prev.filter((d) => !idSet.has(d.key));
                        return next.length === 0 ? [newDraftTaskRow()] : next;
                      });
                      setDraftTaskBulkSelectedKeys(new Set());
                    }}
                  >
                    Bulk delete selected tasks
                  </button>
                </div>

                <div style={formSectionBox}>
                  <h4 id="sb-full-section-pricing" style={formSectionHeading}>
                    Section 3 — Tier pricing
                  </h4>
                  <p style={{ ...muted, marginTop: 0, marginBottom: "0.65rem" }}>
                    This now uses the same pricing form and math as <strong>Create new tier on existing solution</strong>.
                  </p>
                  <PricingPanel
                    key={draftPricingTierId}
                    tierPricingMathConfig={tierPricingMathConfig}
                    subTab="create"
                    tiers={[...tiers, fullCreateDraftTier]}
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
                    tierIdsInScope={[draftPricingTierId]}
                    createLockedTierId={draftPricingTierId}
                    taskDrivenHours={implementerHourGroups.length > 0}
                    taskHourRollup={implementerHourGroups.length > 0 ? fullCreateHourRollup : null}
                    persistTarget="draft"
                    onDraftPricingDraft={setFullStackPricingDraft}
                  />
                </div>

                <div id="sb-full-save" className="admin-actions-row" style={{ marginTop: 16 }}>
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

            {createBranch === "tier_only" && createPhase !== "choose" && (
              <div className="admin-sb-block" style={{ marginTop: "0.6rem" }}>
                <h3 className="admin-sb-subhead" style={sectionTitle}>
                  New tier on existing solution — one page
                </h3>
                <p style={{ ...muted, marginTop: 0, maxWidth: "62ch" }}>
                  Use all three sections below in order. You stay on this page the whole time.
                </p>
                <nav className="admin-sb-quicknav" aria-label="Jump to section">
                  <a href="#sb-tieronly-section-tier" className="admin-sb-quicknav__link">
                    1. Tier
                  </a>
                  <a href="#sb-tieronly-section-tasks" className="admin-sb-quicknav__link">
                    2. Tasks
                  </a>
                  <a href="#sb-tieronly-section-pricing" className="admin-sb-quicknav__link">
                    3. Pricing
                  </a>
                  <a href="#sb-tieronly-finish" className="admin-sb-quicknav__link">
                    Finish
                  </a>
                </nav>

                <div style={formSectionBox}>
                  <h4 id="sb-tieronly-section-tier" style={formSectionHeading}>
                    Section 1 — Solution tier
                  </h4>
                  <div className="admin-form-stack" style={formGrid}>
                    {tierFormTierOnly}
                  </div>
                  <div className="admin-actions-row" style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      className="admin-btn-primary"
                      style={btnPrimary}
                      onClick={() => void insertTier()}
                      disabled={Boolean(ctxTierId)}
                    >
                      {ctxTierId ? "Tier created" : "Create tier"}
                    </button>
                    {ctxTierId ? (
                      <span style={{ ...muted, alignSelf: "center" }}>
                        Working on solution <code>{ctxSolutionId}</code>, tier <code>{ctxTierId}</code>.
                      </span>
                    ) : null}
                  </div>
                </div>

                <div style={formSectionBox}>
                  <h4 id="sb-tieronly-section-tasks" style={formSectionHeading}>
                    Section 2 — Tasks
                  </h4>
                  {!ctxTierId ? (
                    <p style={{ ...muted, marginTop: 0 }}>
                      Create the tier in Section 1 first, then add tasks here.
                    </p>
                  ) : (
                    <>
                      <p style={{ ...muted, marginTop: 0 }}>
                        Solution <code>{ctxSolutionId}</code>, tier <code>{ctxTierId}</code>. Add tasks with the table
                        below, apply a task group from <strong>Admin → Task-Group templates</strong>, or copy vault tasks
                        from another tier into this tier. Manual rows receive ids when you save the task batch.
                      </p>
                      {taskGroups.length > 0 ? (
                        <div style={{ ...formSectionBox, marginTop: 12, marginBottom: 12 }}>
                          <p style={formSectionHeading}>Apply task group to this new tier</p>
                          <p style={{ ...muted, margin: "0 0 0.6rem", fontSize: "0.86rem", maxWidth: "52ch" }}>
                            Appends editable draft rows from the selected task group for tier <code>{ctxTierId}</code>.
                            Safe to use more than once, and you can change the rows before saving. Configure templates in{" "}
                            <strong>Admin → Task-Group templates</strong>.
                          </p>
                          <label style={{ ...lbl, maxWidth: 420, display: "block" }}>
                            <AdminFieldCaption>Task group</AdminFieldCaption>
                            <select
                              style={input}
                              value={createApplyTemplateGroupId}
                              onChange={(e) => setCreateApplyTemplateGroupId(e.target.value)}
                            >
                              <option value="">— Select a template —</option>
                              {taskGroups.map((g) => (
                                <option key={g.id} value={g.id}>
                                  {g.name}
                                </option>
                              ))}
                            </select>
                          </label>
                          <div className="admin-actions-row" style={{ marginTop: 8 }}>
                            <button
                              type="button"
                              className="admin-btn-primary"
                              style={btnPrimary}
                              onClick={() => applyTaskGroupTemplateToCreateTier()}
                              disabled={!ctxTierId.trim() || !createApplyTemplateGroupId}
                            >
                              Append to editable draft table
                            </button>
                            <InlineActionFeedback model={pickInlineFeedback(sbInlineFb, "to_apply_tg")} style={{ flex: "1 1 14rem", marginTop: 0 }} />
                          </div>
                        </div>
                      ) : null}
                      {sortedTiersForAutofill.some((x) => x.solution_tier_id !== ctxTierId) ? (
                        <div style={{ ...formSectionBox, marginTop: 12, marginBottom: 12 }}>
                          <p style={formSectionHeading}>Copy vault tasks from another tier</p>
                          <p style={{ ...muted, margin: "0 0 0.6rem", fontSize: "0.86rem", maxWidth: "52ch" }}>
                            Appends editable draft rows cloned from another tier&apos;s checklist (excluding this tier).
                            The first note line records attribution, and you can change anything before saving.
                          </p>
                          <label style={{ ...lbl, maxWidth: 480, display: "block" }}>
                            <AdminFieldCaption>Source tier</AdminFieldCaption>
                            <select
                              style={input}
                              value={tierOnlyCopyTierId}
                              onChange={(e) => setTierOnlyCopyTierId(e.target.value)}
                            >
                              <option value="">— Select a tier —</option>
                              {sortedTiersForAutofill
                                .filter((t) => t.solution_tier_id !== ctxTierId)
                                .map((t) => {
                                  const n = tasks.filter((k) => k.solution_tier_id === t.solution_tier_id).length;
                                  return (
                                    <option key={t.solution_tier_id} value={t.solution_tier_id} disabled={n === 0}>
                                      {t.solution_tier_id} — {t.solution_tier_name} ({solutionNameForTier(t.solution_id)})
                                      [{n} task(s)]
                                    </option>
                                  );
                                })}
                            </select>
                          </label>
                          <div className="admin-actions-row" style={{ marginTop: 8 }}>
                            <button
                              type="button"
                              className="admin-btn-primary"
                              style={btnPrimary}
                              onClick={() => applyCopiedTierTasksToTierOnlyTier()}
                              disabled={!ctxTierId.trim() || !tierOnlyCopyTierId.trim()}
                            >
                              Append to editable draft table
                            </button>
                            <InlineActionFeedback model={pickInlineFeedback(sbInlineFb, "to_copy_tier")} style={{ flex: "1 1 14rem", marginTop: 0 }} />
                          </div>
                        </div>
                      ) : null}
                      <div className="admin-table-scroll" style={{ marginTop: 8 }}>
                        <table className="admin-data-table" style={{ ...tbl, minWidth: 720 }}>
                          <thead>
                            <tr>
                          <th style={th}>
                            <span style={{ opacity: 0.6 }}>#</span>
                          </th>
                          <th style={{ ...th, width: 48 }} aria-label="Drag to reorder" />
                          <th style={th}>Task name</th>
                          <th style={th}>SOURCE</th>
                          <th style={th}>Implementer</th>
                          <th style={th}>Time</th>
                          <th style={th}>Duration</th>
                          <th style={th}>Dependencies</th>
                          <th style={th}>Notes</th>
                          <th style={{ ...th, width: 140 }} />
                            </tr>
                          </thead>
                          {tierOnlySavedVaultTasks.length > 0 ? (
                            <tbody>
                              <tr>
                                <td
                                  colSpan={10}
                                  style={{
                                    ...td,
                                    background: "rgba(13, 92, 77, 0.06)",
                                    fontSize: "0.82rem",
                                    fontWeight: 600,
                                    borderBottom: "1px solid rgba(13, 92, 77, 0.12)",
                                  }}
                                >
                                  Saved in Supabase for this tier ({tierOnlySavedVaultTasks.length}) — use{" "}
                                  <strong>Update</strong> to edit or delete individual tasks.
                                </td>
                              </tr>
                              {tierOnlySavedVaultTasks.map((k) => {
                                const notesPreview = (k.task_notes ?? "").trim();
                                const notesShort =
                                  notesPreview.length > 100 ? `${notesPreview.slice(0, 100)}…` : notesPreview;
                                return (
                                  <tr key={k.task_id}>
                                    <td style={td} aria-hidden />
                                    <td style={td} aria-hidden />
                                    <td style={td}>
                                      <strong>{k.task_name}</strong>
                                      <div style={{ ...muted, fontSize: "0.76rem" }}>{k.task_id}</div>
                                    </td>
                                    <td style={{ ...td, fontSize: "0.78rem", color: "var(--muted)" }}>
                                      {sourceLabelForTask(k)}
                                    </td>
                                    <td style={td}>{k.task_implementer?.trim() ? k.task_implementer : "—"}</td>
                                    <td style={td}>
                                      {k.task_time != null && Number.isFinite(Number(k.task_time))
                                        ? String(k.task_time)
                                        : "—"}
                                    </td>
                                    <td style={td}>
                                      {k.task_duration != null && Number.isFinite(Number(k.task_duration))
                                        ? String(k.task_duration)
                                        : "—"}
                                    </td>
                                    <td style={td}>{k.task_dependencies?.trim() ? k.task_dependencies : "—"}</td>
                                    <td style={td} title={notesPreview || undefined}>
                                      <span style={{ fontSize: "0.82rem" }}>{notesShort || "—"}</span>
                                    </td>
                                    <td style={{ ...td, fontSize: "0.78rem", color: "var(--muted)" }}>Saved</td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          ) : null}
                          <TaskSortableList itemIds={draftTasks.map((d) => d.key)} onReorder={reorderDraftTasksByKeys}>
                            <tbody>
                              {draftTasks.map((d) => (
                                <SortableTableRowTr
                                  key={d.key}
                                  id={d.key}
                                  renderCells={(dragHandle) => [
                                    <td style={td} key="chk">
                                      <input
                                        type="checkbox"
                                        checked={draftTaskBulkSelectedKeys.has(d.key)}
                                        onChange={() => {
                                          setDraftTaskBulkSelectedKeys((prev) => {
                                            const next = new Set(prev);
                                            if (next.has(d.key)) next.delete(d.key);
                                            else next.add(d.key);
                                            return next;
                                          });
                                        }}
                                      />
                                    </td>,
                                    <td style={td} key="drag">
                                      {dragHandle}
                                    </td>,
                                    <td style={td} key="name">
                                      <input
                                        style={input}
                                        list={taskNameDatalistId}
                                        value={d.name}
                                        onChange={(e) => onDraftTaskNameChange(d.key, e.target.value)}
                                      />
                                    </td>,
                                    <td style={td} key="src">
                                      {d.source}
                                    </td>,
                                    <td style={td} key="impl">
                                      <TaskImplementerSelect
                                        value={d.impl}
                                        options={distinctImplementerOptions}
                                        inputStyle={input}
                                        onChange={(v) => updateDraftRow(d.key, { impl: v })}
                                      />
                                    </td>,
                                    <td style={td} key="time">
                                      <input
                                        style={input}
                                        value={d.time}
                                        onChange={(e) => updateDraftRow(d.key, { time: e.target.value })}
                                      />
                                    </td>,
                                    <td style={td} key="dur">
                                      <input
                                        style={input}
                                        value={d.dur}
                                        onChange={(e) => updateDraftRow(d.key, { dur: e.target.value })}
                                      />
                                    </td>,
                                    <td style={td} key="dep">
                                      <input
                                        style={input}
                                        value={d.dep}
                                        onChange={(e) => updateDraftRow(d.key, { dep: e.target.value })}
                                      />
                                    </td>,
                                    <td style={td} key="notes">
                                      <input
                                        style={input}
                                        value={d.notes}
                                        onChange={(e) => updateDraftRow(d.key, { notes: e.target.value })}
                                      />
                                    </td>,
                                    <td style={td} key="rm">
                                      <span
                                        style={{
                                          display: "inline-flex",
                                          gap: 8,
                                          flexWrap: "wrap",
                                          alignItems: "center",
                                        }}
                                      >
                                        <button type="button" style={btnSm} onClick={() => duplicateDraftTaskRow(d.key)}>
                                          Copy
                                        </button>
                                        <button
                                          type="button"
                                          style={btnDangerSm}
                                          onClick={() => removeDraftTaskRow(d.key)}
                                        >
                                          Remove
                                        </button>
                                      </span>
                                    </td>,
                                  ]}
                                />
                              ))}
                            </tbody>
                          </TaskSortableList>
                        </table>
                      </div>
                      <div className="admin-actions-row" style={{ marginTop: 8 }}>
                        <button type="button" style={btn} onClick={() => addDraftTaskRow()}>
                          Add task row
                        </button>
                        <InlineActionFeedback model={pickInlineFeedback(sbInlineFb, "to_add_row")} style={{ flex: "1 1 14rem", marginTop: 0 }} />
                      </div>
                  <div className="admin-actions-row" style={{ marginTop: 10 }}>
                    <button
                      type="button"
                      style={btnDangerSm}
                      disabled={
                        draftTaskBulkSelectedKeys.size === 0 ||
                        draftTasks.every((d) => !draftTaskBulkSelectedKeys.has(d.key))
                      }
                      onClick={() => {
                        const ids = [...draftTaskBulkSelectedKeys].filter((k) =>
                          draftTasks.some((d) => d.key === k)
                        );
                        if (ids.length === 0) return;
                        if (!window.confirm(`Delete ${ids.length} selected task draft(s)?`)) return;
                        const idSet = new Set(ids);
                        setDraftTasks((prev) => {
                          const next = prev.filter((d) => !idSet.has(d.key));
                          return next.length === 0 ? [newDraftTaskRow()] : next;
                        });
                        setDraftTaskBulkSelectedKeys(new Set());
                      }}
                    >
                      Bulk delete selected tasks
                    </button>
                  </div>
                  <div className="admin-actions-row" style={{ marginTop: 10 }}>
                        <button
                          type="button"
                          className="admin-btn-primary"
                          style={btnPrimary}
                          onClick={() => void saveAllDraftTasksAndContinue()}
                          disabled={saveDraftTasksBusy}
                        >
                          {saveDraftTasksBusy ? "Saving tasks..." : "Save all tasks"}
                        </button>
                      </div>
                    </>
                  )}
                </div>

                <div style={formSectionBox}>
                  <h4 id="sb-tieronly-section-pricing" style={formSectionHeading}>
                    Section 3 — Pricing
                  </h4>
                  {!ctxTierId ? (
                    <p style={{ ...muted, marginTop: 0 }}>
                      Create the tier in Section 1 first to configure pricing.
                    </p>
                  ) : (
                    <>
                      <p style={{ ...muted, marginTop: 0 }}>
                        Solution <code>{ctxSolutionId}</code>, tier <code>{ctxTierId}</code>. Save pricing below.
                        {implementerHourGroups.length > 0 ? (
                          <>
                            {" "}
                            Hour buckets sum each task&apos;s <strong>Time</strong> into Client services, Copy, etc., using{" "}
                            <strong>Admin → Implementer–Pricing Mapping</strong> (same as the Update tab).
                          </>
                        ) : (
                          <>
                            {" "}
                            Configure <strong>Admin → Implementer–Pricing Mapping</strong> so hours can roll up from task
                            implementers automatically.
                          </>
                        )}
                      </p>
                      <PricingPanel
                        key={ctxTierId}
                        tierPricingMathConfig={tierPricingMathConfig}
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
                        taskDrivenHours={implementerHourGroups.length > 0}
                        taskHourRollup={tierOnlyHourRollupForPricing}
                      />
                    </>
                  )}
                </div>

                <div id="sb-tieronly-finish" className="admin-actions-row" style={{ marginTop: 12 }}>
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
            <div className="admin-sb-block" style={{ marginTop: "0.6rem" }}>
              <h3 className="admin-sb-subhead" style={sectionTitle}>
                Update solution + tiers — one page
              </h3>
              <p style={{ ...muted, marginTop: 0, maxWidth: "62ch" }}>
                Stay in one form: choose a solution, then update solution details, tiers, tasks, and pricing below.
              </p>
              <div className="admin-actions-row" style={{ marginTop: 6 }}>
                <button
                  type="button"
                  className="admin-btn-primary admin-sb-create-cta"
                  style={btnPrimary}
                  onClick={() => onRequestSubTabChange?.("create")}
                >
                  Create New Solution
                </button>
              </div>
              {showUpdateDetails ? (
                <nav className="admin-sb-quicknav" aria-label="Jump to update section">
                  <a href="#sb-update-section-solution" className="admin-sb-quicknav__link">
                    1. Solution
                  </a>
                  <a href="#sb-update-section-tiers" className="admin-sb-quicknav__link">
                    2. Tiers
                  </a>
                  <a href="#sb-update-section-tasks-pricing" className="admin-sb-quicknav__link">
                    3. Tasks &amp; pricing
                  </a>
                </nav>
              ) : null}

              <div className="admin-sb-solutions-block" style={{ ...formSectionBox, marginTop: "0.55rem" }}>
                <h4 style={formSectionHeading}>Solutions</h4>
                <div className="admin-sb-solutions-list" role="list">
                  {solutionsAlphabetical.map((sol) => {
                    const isExpanded = expandedSolutionId === sol.solution_id;
                    const tierCount = tierCountBySolutionId.get(sol.solution_id) ?? 0;
                    return (
                      <div
                        key={sol.solution_id}
                        className={
                          isExpanded
                            ? "admin-sb-sol-item admin-sb-sol-item--open"
                            : "admin-sb-sol-item"
                        }
                        role="listitem"
                      >
                        <div className="admin-sb-sol-item__row">
                          <div className="admin-sb-sol-item__main">
                            <span className="admin-sb-level-tag admin-sb-level-tag--solution">Solution</span>
                            {solutionRenameId === sol.solution_id ? (
                              <input
                                type="text"
                                className="admin-field"
                                style={{ ...input, width: "100%", maxWidth: "28rem", marginTop: 0 }}
                                value={solutionRenameDraft}
                                onChange={(e) => setSolutionRenameDraft(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === "Escape") {
                                    e.preventDefault();
                                    cancelSolutionRename();
                                  }
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    void saveSolutionRename();
                                  }
                                }}
                                aria-label={`Rename solution ${sol.solution_id}`}
                                autoComplete="off"
                                autoFocus
                              />
                            ) : (
                              <>
                                <span className="admin-sb-sol-item__name">{sol.solution_name}</span>
                                <code className="admin-sb-sol-item__id">{sol.solution_id}</code>
                                {tierCount > 0 ? (
                                  <span className="admin-sb-sol-item__count" title={`${tierCount} tiers`}>
                                    {tierCount} {tierCount === 1 ? "tier" : "tiers"}
                                  </span>
                                ) : null}
                              </>
                            )}
                          </div>
                          <div className="admin-sb-sol-item__actions">
                            {solutionRenameId === sol.solution_id ? (
                              <>
                                <button
                                  type="button"
                                  style={btnPrimary}
                                  className="admin-btn-primary"
                                  onClick={() => void saveSolutionRename()}
                                >
                                  Save
                                </button>
                                <button type="button" style={btnSm} onClick={cancelSolutionRename}>
                                  Cancel
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  style={btnSm}
                                  onClick={() => {
                                    startEditSolution(sol);
                                    window.setTimeout(() => jumpTo("sb-update-section-solution"), 0);
                                  }}
                                >
                                  Update
                                </button>
                                <button
                                  type="button"
                                  style={btnSm}
                                  className={
                                    isExpanded
                                      ? "admin-sb-sol-item__toggle admin-sb-sol-item__toggle--open"
                                      : "admin-sb-sol-item__toggle"
                                  }
                                  aria-expanded={isExpanded}
                                  onClick={() => {
                                    cancelSolutionRename();
                                    cancelTierRename();
                                    setShowUpdateDetails(false);
                                    if (isExpanded) {
                                      setExpandedSolutionId(null);
                                      setInlinePricingTierIds(new Set());
                                      return;
                                    }
                                    setUpdSolutionId(sol.solution_id);
                                    setExpandedSolutionId(sol.solution_id);
                                    setInlinePricingTierIds(new Set());
                                  }}
                                >
                                  {isExpanded ? "Hide tiers" : "Tiers"}
                                </button>
                                <button
                                  type="button"
                                  style={btnSm}
                                  onClick={() => {
                                    setOpErr(null);
                                    cancelTierRename();
                                    setSolutionRenameId(sol.solution_id);
                                    setSolutionRenameDraft(sol.solution_name);
                                  }}
                                >
                                  Rename
                                </button>
                                <button
                                  type="button"
                                  style={btnDangerSm}
                                  onClick={() => void deleteSolutionById(sol.solution_id)}
                                >
                                  Delete
                                </button>
                              </>
                            )}
                          </div>
                        </div>

                        {isExpanded ? (
                          <div className="admin-sb-sol-tiers">
                            <p className="admin-sb-sol-tiers__label">
                              <span className="admin-sb-level-tag admin-sb-level-tag--tier">Tiers</span>
                              <span className="admin-sb-sol-tiers__parent">in {sol.solution_name}</span>
                            </p>
                            {tiersOfUpdateSol.length === 0 ? (
                              <p className="admin-sb-sol-tiers__empty">No tiers yet for this solution.</p>
                            ) : (
                              tiersOfUpdateSol.map((t) => {
                                const pricingOpen = inlinePricingTierIds.has(t.solution_tier_id);
                                return (
                                  <div
                                    key={t.solution_tier_id}
                                    className={
                                      pricingOpen
                                        ? "admin-sb-tier-item admin-sb-tier-item--pricing-open"
                                        : "admin-sb-tier-item"
                                    }
                                  >
                                    <div className="admin-sb-tier-item__row">
                                      <div className="admin-sb-tier-item__main">
                                        <span className="admin-sb-level-tag admin-sb-level-tag--tier">Tier</span>
                                        {tierRenameId === t.solution_tier_id ? (
                                          <input
                                            type="text"
                                            className="admin-field"
                                            style={{
                                              ...input,
                                              width: "100%",
                                              maxWidth: "28rem",
                                              marginTop: 0,
                                            }}
                                            value={tierRenameDraft}
                                            onChange={(e) => setTierRenameDraft(e.target.value)}
                                            onKeyDown={(e) => {
                                              if (e.key === "Escape") {
                                                e.preventDefault();
                                                cancelTierRename();
                                              }
                                              if (e.key === "Enter") {
                                                e.preventDefault();
                                                void saveTierRename();
                                              }
                                            }}
                                            aria-label={`Rename tier ${t.solution_tier_id}`}
                                            autoComplete="off"
                                            autoFocus
                                          />
                                        ) : (
                                          <>
                                            <span className="admin-sb-tier-item__name">
                                              {t.solution_tier_name}
                                            </span>
                                            <code className="admin-sb-sol-item__id">{t.solution_tier_id}</code>
                                          </>
                                        )}
                                      </div>
                                      <div className="admin-sb-sol-item__actions">
                                        {tierRenameId === t.solution_tier_id ? (
                                          <>
                                            <button
                                              type="button"
                                              style={btnPrimary}
                                              className="admin-btn-primary"
                                              onClick={() => void saveTierRename()}
                                            >
                                              Save
                                            </button>
                                            <button type="button" style={btnSm} onClick={cancelTierRename}>
                                              Cancel
                                            </button>
                                          </>
                                        ) : (
                                          <>
                                            <button
                                              type="button"
                                              style={btnSm}
                                              onClick={() => {
                                                startEditTier(t);
                                                setShowUpdateDetails(true);
                                                window.setTimeout(
                                                  () => jumpTo("sb-update-section-tiers"),
                                                  0
                                                );
                                              }}
                                            >
                                              Update
                                            </button>
                                            <button
                                              type="button"
                                              style={btnSm}
                                              className={
                                                pricingOpen
                                                  ? "admin-sb-sol-item__toggle admin-sb-sol-item__toggle--open"
                                                  : "admin-sb-sol-item__toggle"
                                              }
                                              aria-expanded={pricingOpen}
                                              onClick={() => {
                                                if (pricingOpen) closeInlinePricing(t.solution_tier_id);
                                                else openInlinePricing(t.solution_tier_id);
                                              }}
                                            >
                                              {pricingOpen ? "Hide pricing" : "Pricing"}
                                            </button>
                                            <button
                                              type="button"
                                              style={btnSm}
                                              onClick={() => {
                                                cancelSolutionRename();
                                                setOpErr(null);
                                                setTierRenameId(t.solution_tier_id);
                                                setTierRenameDraft(t.solution_tier_name);
                                              }}
                                            >
                                              Rename
                                            </button>
                                            <button
                                              type="button"
                                              style={btnDangerSm}
                                              onClick={() => void deleteUpdateTier(t)}
                                            >
                                              Delete
                                            </button>
                                          </>
                                        )}
                                      </div>
                                    </div>
                                    {pricingOpen ? (
                                      <SolutionTierInlineRiskPricing
                                        tierId={t.solution_tier_id}
                                        tierName={t.solution_tier_name}
                                        solutionName={sol.solution_name}
                                        pricingRow={pricingByTierId.get(t.solution_tier_id) ?? null}
                                        mathConfig={tierPricingMathConfig}
                                        client={getSupabase()}
                                        logAudit={logAudit}
                                        onSaved={onSaved}
                                        onClose={() => closeInlinePricing(t.solution_tier_id)}
                                        onError={(msg) => {
                                          setOpOk(null);
                                          setOpErr(msg || null);
                                        }}
                                        onOk={(msg) => {
                                          setOpErr(null);
                                          setOpOk(msg);
                                        }}
                                      />
                                    ) : null}
                                  </div>
                                );
                              })
                            )}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {showUpdateDetails ? (
              <>
                <div id="sb-update-section-solution" className="admin-sb-block">
                  <UpdateSectionHead
                    badge="1"
                    title="Solution"
                    hint="Name, type (Solution Module or Configured Solution), and whether add-ons are allowed."
                    muted={muted}
                  />
                  <div style={{ ...formSectionBox, marginTop: 12 }}>
                    <h4 style={formSectionHeading}>
                      {updSolutionId ? `Edit solution ${updSolutionId}` : "Edit solution"}
                    </h4>
                    <div className="admin-form-stack" style={formGrid}>
                      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                        <AdminFieldCaption>Solution name</AdminFieldCaption>
                        <input style={input} value={updSolName} onChange={(e) => setUpdSolName(e.target.value)} />
                      </label>
                      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                        <AdminFieldCaption>Solution type</AdminFieldCaption>
                        <select
                          style={input}
                          value={updSolType}
                          onChange={(e) => setUpdSolType(e.target.value as SolutionType)}
                        >
                          <option value="configured_solution">Configured Solution</option>
                          <option value="solution_module">Solution Module</option>
                        </select>
                      </label>
                      <label
                        style={{
                          ...lbl,
                          gridColumn: "1 / -1",
                          flexDirection: "row",
                          alignItems: "center",
                          gap: 8,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={updSolAddOnsAllowed}
                          onChange={(e) => setUpdSolAddOnsAllowed(e.target.checked)}
                        />
                        Add Ons Allowed?
                      </label>
                    </div>
                    <div className="admin-actions-row" style={{ marginTop: 10 }}>
                      <button
                        type="button"
                        className="admin-btn-primary"
                        style={btnPrimary}
                        onClick={() => void saveUpdateSolution()}
                      >
                        Save solution changes
                      </button>
                    </div>
                  </div>
                </div>

                <div id="sb-update-section-tiers" className="admin-sb-block">
              <UpdateSectionHead
                badge="2"
                title="Tiers"
                hint="List every tier, add a new one, or edit. To bulk-add tasks from a template, use the Tasks & pricing section after a tier exists."
                muted={muted}
              />
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
                        <td style={td}>
                          {tierRenameId === t.solution_tier_id ? (
                            <input
                              type="text"
                              className="admin-field"
                              style={{ ...input, width: "100%", maxWidth: "28rem", marginTop: 0 }}
                              value={tierRenameDraft}
                              onChange={(e) => setTierRenameDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Escape") {
                                  e.preventDefault();
                                  cancelTierRename();
                                }
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void saveTierRename();
                                }
                              }}
                              aria-label={`Rename tier ${t.solution_tier_id}`}
                              autoComplete="off"
                              autoFocus
                            />
                          ) : (
                            t.solution_tier_name
                          )}
                        </td>
                        <td style={td}>
                          {tierRenameId === t.solution_tier_id ? (
                            <div className="admin-actions-row" style={{ marginTop: 0 }}>
                              <button
                                type="button"
                                style={btnPrimary}
                                className="admin-btn-primary"
                                onClick={() => void saveTierRename()}
                              >
                                Save name
                              </button>
                              <button type="button" style={btnSm} onClick={cancelTierRename}>
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <>
                              <button type="button" style={btnSm} onClick={() => startEditTier(t)}>
                                Edit
                              </button>{" "}
                              <button
                                type="button"
                                style={btnSm}
                                onClick={() => {
                                  cancelSolutionRename();
                                  setOpErr(null);
                                  setTierRenameId(t.solution_tier_id);
                                  setTierRenameDraft(t.solution_tier_name);
                                }}
                              >
                                Rename
                              </button>{" "}
                              <button type="button" style={btnDangerSm} onClick={() => void deleteUpdateTier(t)}>
                                Delete
                              </button>
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {tiersOfUpdateSol.length === 0 ? (
                <p style={{ ...muted, marginTop: 8 }}>No tiers yet. Add one with the form below.</p>
              ) : null}
              <div style={{ ...formSectionBox, marginTop: 12 }}>
                <h4 style={formSectionHeading}>{updTierEditId ? `Section 1 — Edit tier ${updTierEditId}` : "Section 1 — Add tier"}</h4>
                {tierFormUpdateFields}
                <div className="admin-actions-row" style={{ marginTop: 10 }}>
                  <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void saveUpdateTier()}>
                    {updTierEditId ? "Save tier changes" : "Create tier"}
                  </button>
                  {updTierEditId ? (
                    <button type="button" style={btn} onClick={clearTierUpdateForm}>
                      Cancel
                    </button>
                  ) : null}
                </div>
              </div>
                </div>

                <div id="sb-update-section-tasks-pricing" className="admin-sb-block">
              <UpdateSectionHead
                badge="3"
                title="Tasks & pricing for a tier"
                hint="Select a tier, then add tasks manually, from a task-group template, or by copying vault tasks from another tier. Templates live in Admin → Task-Group templates."
                muted={muted}
              />
              <label style={{ ...lbl, maxWidth: 420 }}>
                <AdminFieldCaption>Tier for tasks &amp; pricing</AdminFieldCaption>
                <select
                  style={input}
                  value={updTierFocus}
                  onChange={(e) => {
                    setUpdTierFocus(e.target.value);
                    setApplyTemplateGroupId("");
                    setUpdCopyTierPick("");
                  }}
                >
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
                  {taskGroups.length > 0 ? (
                    <div style={{ ...formSectionBox, marginTop: 12 }}>
                      <p style={formSectionHeading}>Add tasks from a task group</p>
                      <p style={{ ...muted, margin: "0 0 0.6rem", fontSize: "0.86rem", maxWidth: "52ch" }}>
                        Applies to the <strong>same tier</strong> you selected above. Inserts new <code>4-…</code> tasks. Use
                        after the tier exists; safe to run more than once. Templates:{" "}
                        <strong>Admin → Task-Group templates</strong>.
                      </p>
                      <label style={{ ...lbl, maxWidth: 420, display: "block" }}>
                        <AdminFieldCaption>Task group</AdminFieldCaption>
                        <select
                          style={input}
                          value={applyTemplateGroupId}
                          onChange={(e) => setApplyTemplateGroupId(e.target.value)}
                        >
                          <option value="">— Select a template —</option>
                          {taskGroups.map((g) => (
                            <option key={g.id} value={g.id}>
                              {g.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <div className="admin-actions-row" style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          className="admin-btn-primary"
                          style={btnPrimary}
                          onClick={() => void applyTaskGroupTemplateToTier()}
                          disabled={!updTierFocus || !applyTemplateGroupId}
                        >
                          Apply to tier
                        </button>
                        <InlineActionFeedback model={pickInlineFeedback(sbInlineFb, "upd_apply_tg")} style={{ flex: "1 1 14rem", marginTop: 0 }} />
                      </div>
                    </div>
                  ) : null}
                  {sortedTiersForAutofill.filter((x) => x.solution_tier_id !== updTierFocus).length > 0 &&
                  updTierFocus ? (
                    <div style={{ ...formSectionBox, marginTop: 12 }}>
                      <p style={formSectionHeading}>Copy vault tasks from another tier</p>
                      <p style={{ ...muted, margin: "0 0 0.6rem", fontSize: "0.86rem", maxWidth: "56ch" }}>
                        Clones <strong>vault</strong> checklist items (names, fields, notes) from a different tier. Notes
                        begin with a short &quot;Copied from tier…&quot; line (also shown in SOURCE). Or append the same snapshot
                        to the bulk new-task draft table lower on this page.
                      </p>
                      <label style={{ ...lbl, maxWidth: 480, display: "block" }}>
                        <AdminFieldCaption>Source tier</AdminFieldCaption>
                        <select
                          style={input}
                          value={updCopyTierPick}
                          onChange={(e) => setUpdCopyTierPick(e.target.value)}
                        >
                          <option value="">— Select a tier —</option>
                          {sortedTiersForAutofill
                            .filter((t) => t.solution_tier_id !== updTierFocus)
                            .map((t) => {
                              const n = tasks.filter((k) => k.solution_tier_id === t.solution_tier_id).length;
                              return (
                                <option key={t.solution_tier_id} value={t.solution_tier_id} disabled={n === 0}>
                                  {t.solution_tier_id} — {t.solution_tier_name} ({solutionNameForTier(t.solution_id)}) [
                                  {n} task(s)]
                                </option>
                              );
                            })}
                        </select>
                      </label>
                      <div className="admin-actions-row" style={{ marginTop: 8, flexWrap: "wrap", gap: 8 }}>
                        <button
                          type="button"
                          className="admin-btn-primary"
                          style={btnPrimary}
                          onClick={() => void applyCopiedTierTasksToUpdateFocusedTier()}
                          disabled={!updTierFocus || !updCopyTierPick.trim()}
                        >
                          Copy into this tier now
                        </button>
                        <InlineActionFeedback model={pickInlineFeedback(sbInlineFb, "upd_copy_db")} style={{ flex: "1 1 12rem", marginTop: 0 }} />
                        <button
                          type="button"
                          style={btnSm}
                          onClick={() => appendTierTasksToUpdateNewDrafts()}
                          disabled={!updTierFocus || !updCopyTierPick.trim()}
                        >
                          Append to new-task draft table
                        </button>
                        <InlineActionFeedback model={pickInlineFeedback(sbInlineFb, "upd_copy_draft")} style={{ flex: "1 1 12rem", marginTop: 0 }} />
                      </div>
                    </div>
                  ) : null}
                  <h4 style={{ ...sectionTitle, marginTop: "1rem", fontSize: "0.88rem" }}>Tasks</h4>
                  <div className="admin-table-scroll">
                    <table className="admin-data-table" style={{ ...tbl, marginTop: 4 }}>
                      <thead>
                        <tr>
                          <th style={th}>
                            <input
                              type="checkbox"
                              checked={
                                tasksOfFocusTier.length > 0 &&
                                tasksOfFocusTier.every((t) => updTaskBulkSelectedIds.has(t.task_id))
                              }
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setUpdTaskBulkSelectedIds(new Set(tasksOfFocusTier.map((t) => t.task_id)));
                                } else {
                                  setUpdTaskBulkSelectedIds(new Set());
                                }
                              }}
                              disabled={
                                !!updTaskEditId ||
                                updTaskBulkBusy ||
                                updTaskReorderBusy ||
                                tasksOfFocusTier.length === 0
                              }
                            />
                          </th>
                          <th style={{ ...th, width: 48 }} aria-label="Drag to reorder" />
                          <th style={th}>Id</th>
                          <th style={th}>Name</th>
                          <th style={th}>SOURCE</th>
                          <th style={th}>Hours</th>
                          <th style={th}>Duration</th>
                          <th style={th} />
                        </tr>
                      </thead>
                      <TaskSortableList
                        itemIds={tasksOfFocusTier.map((t) => t.task_id)}
                        disabled={!!updTaskEditId || updTaskBulkBusy || updTaskReorderBusy}
                        onReorder={applyFocusTierTaskOrder}
                      >
                        <tbody>
                          {tasksOfFocusTier.map((k) => (
                            <SortableTableRowTr
                              key={k.task_id}
                              id={k.task_id}
                              disabled={!!updTaskEditId || updTaskBulkBusy || updTaskReorderBusy}
                              renderCells={(dragHandle) => [
                                <td style={td} key="chk">
                                  <input
                                    type="checkbox"
                                    checked={updTaskBulkSelectedIds.has(k.task_id)}
                                    onChange={() => {
                                      setUpdTaskBulkSelectedIds((prev) => {
                                        const next = new Set(prev);
                                        if (next.has(k.task_id)) next.delete(k.task_id);
                                        else next.add(k.task_id);
                                        return next;
                                      });
                                    }}
                                    disabled={
                                      !!updTaskEditId || updTaskBulkBusy || updTaskReorderBusy
                                    }
                                  />
                                </td>,
                                <td style={td} key="drag">
                                  {dragHandle}
                                </td>,
                                <td style={td} key="tid">
                                  {k.task_id}
                                </td>,
                                <td style={td} key="nm">
                                  {k.task_name}
                                </td>,
                                <td style={td} key="src">
                                  {sourceLabelForTask(k)}
                                </td>,
                                <td style={td} key="hrs">
                                  {k.task_time == null || !Number.isFinite(Number(k.task_time))
                                    ? "—"
                                    : String(k.task_time)}
                                </td>,
                                <td style={td} key="dur">
                                  {k.task_duration == null || !Number.isFinite(Number(k.task_duration))
                                    ? "—"
                                    : String(k.task_duration)}
                                </td>,
                                <td style={td} key="act">
                                  <button type="button" style={btnSm} onClick={() => startEditTask(k)}>
                                    Edit
                                  </button>{" "}
                                  <button type="button" style={btnDangerSm} onClick={() => void deleteUpdateTask(k)}>
                                    Delete
                                  </button>
                                </td>,
                              ]}
                            />
                          ))}
                        </tbody>
                      </TaskSortableList>
                      <tbody>
                        <tr>
                          <td style={td} />
                          <td style={td} />
                          <td style={td} />
                          <td style={td} />
                          <td style={{ ...td, fontWeight: 700 }}>TOTAL</td>
                          <td style={{ ...td, fontWeight: 700 }}>{updTierTotalTaskHours}</td>
                          <td style={{ ...td, fontWeight: 700 }}>{updTierTotalTaskDuration}</td>
                          <td style={td} />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="admin-actions-row" style={{ marginTop: 8 }}>
                    <button
                      type="button"
                      style={btnDangerSm}
                      disabled={
                        updTaskBulkSelectedIds.size === 0 ||
                        !!updTaskEditId ||
                        updTaskBulkBusy ||
                        updTaskReorderBusy
                      }
                      onClick={() => void bulkDeleteSelectedUpdateTasks()}
                    >
                      Bulk delete selected tasks
                    </button>
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
                      <div className="admin-table-scroll" style={{ marginTop: 8 }}>
                        <table className="admin-data-table" style={{ ...tbl, minWidth: 720 }}>
                          <thead>
                            <tr>
                              <th style={{ ...th, width: 48 }} aria-label="Drag to reorder" />
                              <th style={th}>Task name</th>
                              <th style={th}>SOURCE</th>
                              <th style={th}>Implementer</th>
                              <th style={th}>Time</th>
                              <th style={th}>Duration</th>
                              <th style={th}>Dependencies</th>
                              <th style={th}>Notes</th>
                              <th style={{ ...th, width: 140 }} />
                            </tr>
                          </thead>
                          <TaskSortableList
                            itemIds={updNewTaskDrafts.map((d) => d.key)}
                            onReorder={reorderUpdNewDraftsByKeys}
                          >
                            <tbody>
                              {updNewTaskDrafts.map((d) => (
                                <SortableTableRowTr
                                  key={d.key}
                                  id={d.key}
                                  renderCells={(dragHandle) => [
                                    <td style={td} key="drag">
                                      {dragHandle}
                                    </td>,
                                    <td style={td} key="name">
                                      <input
                                        style={input}
                                        list={taskNameDatalistId}
                                        value={d.name}
                                        onChange={(e) => onUpdNewTaskNameChange(d.key, e.target.value)}
                                      />
                                    </td>,
                                    <td
                                      style={{ ...td, fontSize: "0.78rem", color: "var(--muted)" }}
                                      key="src"
                                    >
                                      {d.source}
                                    </td>,
                                    <td style={td} key="impl">
                                      <TaskImplementerSelect
                                        value={d.impl}
                                        options={distinctImplementerOptions}
                                        inputStyle={input}
                                        onChange={(v) => updateUpdNewDraft(d.key, { impl: v })}
                                      />
                                    </td>,
                                    <td style={td} key="time">
                                      <input
                                        style={input}
                                        value={d.time}
                                        onChange={(e) => updateUpdNewDraft(d.key, { time: e.target.value })}
                                      />
                                    </td>,
                                    <td style={td} key="dur">
                                      <input
                                        style={input}
                                        value={d.dur}
                                        onChange={(e) => updateUpdNewDraft(d.key, { dur: e.target.value })}
                                      />
                                    </td>,
                                    <td style={td} key="dep">
                                      <input
                                        style={input}
                                        value={d.dep}
                                        onChange={(e) => updateUpdNewDraft(d.key, { dep: e.target.value })}
                                      />
                                    </td>,
                                    <td style={td} key="notes">
                                      <input
                                        style={input}
                                        value={d.notes}
                                        onChange={(e) => updateUpdNewDraft(d.key, { notes: e.target.value })}
                                      />
                                    </td>,
                                    <td style={td} key="rm">
                                      <span
                                        style={{
                                          display: "inline-flex",
                                          gap: 8,
                                          flexWrap: "wrap",
                                          alignItems: "center",
                                        }}
                                      >
                                        <button
                                          type="button"
                                          style={btnSm}
                                          onClick={() => duplicateUpdNewDraftRow(d.key)}
                                        >
                                          Copy
                                        </button>
                                        <button
                                          type="button"
                                          style={btnDangerSm}
                                          onClick={() => removeUpdNewDraftRow(d.key)}
                                        >
                                          Remove
                                        </button>
                                      </span>
                                    </td>,
                                  ]}
                                />
                              ))}
                            </tbody>
                          </TaskSortableList>
                        </table>
                      </div>
                      <div className="admin-actions-row" style={{ marginTop: 8 }}>
                        <button type="button" style={btn} onClick={() => addUpdNewDraftRow()}>
                          Add task row
                        </button>
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
                    tierPricingMathConfig={tierPricingMathConfig}
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
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
