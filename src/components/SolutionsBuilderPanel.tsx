import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
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
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskGroupLineRow,
  TaskGroupRow,
  TaskRow,
} from "../types";
import { applyTaskGroupToTier } from "../lib/applyTaskGroupToTier";
import { nextAutoTaskId } from "../lib/taskIds";
import { percentChangeFromSellAndOld } from "../lib/pricingPercentChange";
import {
  ACCOUNT_MGMT_HOURS_ADDON_RATE,
  CLIENT_REVISION_RISK_SCORE_HINTS,
  INTERNAL_COORDINATION_SCORE_HINTS,
  SCOPE_RISK_SCORE_HINTS,
  computeTierPricing,
  riskScore012Options,
  riskScore012SelectTitle,
  strategicValueScoreSelectTitle,
  strategicValueScoreUiLabel,
  type TierPricingMathConfig,
} from "../lib/tierPricingMath";
import { PricingPanel } from "./PricingPanel";
import { TaskImplementerSelect } from "./TaskImplementerSelect";

export { nextAutoTaskId };

function fmtDerivedHours(n: number): string {
  return Number.isFinite(n)
    ? n.toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 0 })
    : "0";
}

const SCOPE_RISK_OPTIONS = riskScore012Options(SCOPE_RISK_SCORE_HINTS);
const INTERNAL_COORDINATION_OPTIONS = riskScore012Options(INTERNAL_COORDINATION_SCORE_HINTS);
const CLIENT_REVISION_RISK_OPTIONS = riskScore012Options(CLIENT_REVISION_RISK_SCORE_HINTS);

const STRATEGIC_OPTIONS: { value: string; label: string }[] = ([0, 1, 2] as const).map((s) => ({
  value: String(s),
  label: strategicValueScoreUiLabel(s),
}));

function parseNumStr(s: string): number | null {
  const t = s.trim();
  if (t === "" || t.toLowerCase() === "n/a") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function AdminFieldCaption({ children }: { children: ReactNode }) {
  return <span className="admin-field-caption">{children}</span>;
}

type MarkdownTextareaProps = {
  value: string;
  onChange: (next: string) => void;
  textareaStyle: CSSProperties;
  rows?: number;
};

function MarkdownTextarea({ value, onChange, textareaStyle, rows = 2 }: MarkdownTextareaProps) {
  const ref = useRef<HTMLTextAreaElement | null>(null);

  const setNext = useCallback(
    (next: string, nextStart?: number, nextEnd?: number) => {
      onChange(next);
      window.setTimeout(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        if (typeof nextStart === "number" && typeof nextEnd === "number") {
          el.setSelectionRange(nextStart, nextEnd);
        }
      }, 0);
    },
    [onChange]
  );

  const wrapSelection = useCallback(
    (before: string, after: string, fallback = "text") => {
      const el = ref.current;
      if (!el) return;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? start;
      const selected = value.slice(start, end);
      const content = selected || fallback;
      const next = `${value.slice(0, start)}${before}${content}${after}${value.slice(end)}`;
      const caretStart = start + before.length;
      const caretEnd = caretStart + content.length;
      setNext(next, caretStart, caretEnd);
    },
    [setNext, value]
  );

  const prefixSelectedLines = useCallback(
    (prefix: string) => {
      const el = ref.current;
      if (!el) return;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? start;
      const lineStart = value.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
      const lineEndRaw = value.indexOf("\n", end);
      const lineEnd = lineEndRaw === -1 ? value.length : lineEndRaw;
      const selectedBlock = value.slice(lineStart, lineEnd);
      const nextBlock = selectedBlock
        .split("\n")
        .map((line) => (line.trim().length === 0 ? line : `${prefix}${line}`))
        .join("\n");
      const next = `${value.slice(0, lineStart)}${nextBlock}${value.slice(lineEnd)}`;
      setNext(next, lineStart, lineStart + nextBlock.length);
    },
    [setNext, value]
  );

  return (
    <div className="admin-md-field">
      <div className="admin-md-toolbar" role="toolbar" aria-label="Formatting">
        <button type="button" className="admin-md-toolbar__btn" onClick={() => wrapSelection("**", "**", "bold text")}>
          Bold
        </button>
        <button type="button" className="admin-md-toolbar__btn" onClick={() => wrapSelection("*", "*", "italic text")}>
          Italic
        </button>
        <button type="button" className="admin-md-toolbar__btn" onClick={() => prefixSelectedLines("- ")}>
          Bullet list
        </button>
        <button
          type="button"
          className="admin-md-toolbar__btn"
          onClick={() => wrapSelection("[", "](https://example.com)", "link text")}
        >
          Link
        </button>
      </div>
      <textarea ref={ref} style={textareaStyle} rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
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

function formatRollupBucketForInput(n: number): string {
  if (n == null || !Number.isFinite(n) || n === 0) return "";
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 100) / 100);
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

/** Build draft task rows from a task-group template (one-page "new solution" — no tier id until final save). */
function draftRowsFromTaskGroupLines(lines: TaskGroupLineRow[], allTasks: TaskRow[]): DraftTaskRow[] {
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
          name: src.task_name,
          impl: af.impl,
          time: af.time,
          dur: af.dur,
          dep: af.dep,
          notes: af.notes,
        });
        continue;
      }
    }
    out.push({
      key,
      name: (line.task_name ?? "").trim(),
      impl: (line.task_implementer ?? "").trim(),
      time: line.hours != null && Number.isFinite(line.hours) ? String(line.hours) : "",
      dur: "",
      dep: "",
      notes: "",
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
  tierPricingMathConfig,
  implementerHourGroups = [],
  taskGroups = [],
  taskGroupLines = [],
  onSaved,
  setOpErr,
  setOpOk,
  onRequestSubTabChange,
  logAudit,
  styles: s,
}: {
  subTab: SolutionsBuilderSubTab;
  tierPricingMathConfig: TierPricingMathConfig;
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  tierPricing: SolutionTierPricing[];
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
    return out.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [tasks]);
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
      computeTierPricing(
        {
          hours: fullPricingHours,
          scopeRisk: Number(prScopeRisk),
          internalCoordination: Number(prInternalCoord),
          clientRevisionRisk: Number(prClientRev),
          strategicValueScore: Number(prStratScore),
        },
        tierPricingMathConfig
      ),
    [fullPricingHours, prScopeRisk, prInternalCoord, prClientRev, prStratScore, tierPricingMathConfig]
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
    const tasksAlreadyOnTier = tasks.filter((k) => k.solution_tier_id === tierId);
    if (rowsToSave.length === 0 && tasksAlreadyOnTier.length === 0) {
      setOpErr("Add at least one task (or apply a task group template above) before continuing.");
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
    setOpOk(
      rowsToSave.length > 0
        ? `Saved ${rowsToSave.length} task(s). Fill in pricing next.`
        : "Continuing to pricing for tasks already on this tier."
    );
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
  /** Keep update page concise until user chooses to edit a solution. */
  const [showUpdateDetails, setShowUpdateDetails] = useState(false);

  const [updTierFocus, setUpdTierFocus] = useState("");
  /** Task group template to apply in bulk to `updTierFocus` (update tab). */
  const [applyTemplateGroupId, setApplyTemplateGroupId] = useState("");
  /** Task group template in create-wizard (tier-only) tasks step. */
  const [createApplyTemplateGroupId, setCreateApplyTemplateGroupId] = useState("");
  /** Task group template for one-page "new solution" — appends rows to draft tasks. */
  const [fullStackApplyGroupId, setFullStackApplyGroupId] = useState("");
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
        task_duration: null,
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

  useEffect(() => {
    if (subTab !== "create" || createBranch !== "full" || createPhase !== "foundation") return;
    const r = fullCreateHourRollup;
    setPrHCs(formatRollupBucketForInput(r.client_services));
    setPrHCp(formatRollupBucketForInput(r.copy));
    setPrHDs(formatRollupBucketForInput(r.design));
    setPrHWd(formatRollupBucketForInput(r.web_dev));
    setPrHVi(formatRollupBucketForInput(r.video));
    setPrHDa(formatRollupBucketForInput(r.data));
    setPrHPm(formatRollupBucketForInput(r.paid_media));
    setPrHHb(formatRollupBucketForInput(r.hubspot));
    setPrHOt(formatRollupBucketForInput(r.other));
  }, [subTab, createBranch, createPhase, fullCreateHourRollup]);

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

  useEffect(() => {
    if (subTab !== "update") return;
    setShowUpdateDetails(false);
  }, [subTab]);

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

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

  const deleteSolutionById = async (solutionId: string) => {
    const client = getSupabase();
    if (!client || !solutionId) return;
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
    setOpOk("Task deleted.");
    await onSaved();
  };

  const applyTaskGroupTemplateToTier = useCallback(async () => {
    if (!updTierFocus || !applyTemplateGroupId) {
      setOpErr("Select a tier and a task group template.");
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
      setOpErr(res.message);
      return;
    }
    setOpOk(`Added ${res.created} task(s) from the template.`);
    setApplyTemplateGroupId("");
    await onSaved();
  }, [applyTemplateGroupId, logAudit, onSaved, setOpErr, setOpOk, taskGroupLines, tasks, updTierFocus]);

  const applyTaskGroupTemplateToCreateTier = useCallback(async () => {
    if (!ctxTierId.trim() || !createApplyTemplateGroupId) {
      setOpErr("Select a task group template to apply (tier is already set from the previous step).");
      return;
    }
    const lines = (taskGroupLines ?? [])
      .filter((l) => l.task_group_id === createApplyTemplateGroupId)
      .sort((a, b) => a.sort_order - b.sort_order);
    const res = await applyTaskGroupToTier({
      solution_tier_id: ctxTierId.trim(),
      task_group_id: createApplyTemplateGroupId,
      lines,
      allTasks: tasks,
      logAudit,
    });
    if (!res.ok) {
      setOpErr(res.message);
      return;
    }
    setOpOk(`Added ${res.created} task(s) from the template. You can add more rows below, then continue to pricing.`);
    setCreateApplyTemplateGroupId("");
    await onSaved();
  }, [createApplyTemplateGroupId, ctxTierId, logAudit, onSaved, setOpErr, setOpOk, taskGroupLines, tasks]);

  const appendTaskGroupToFullSolutionDraft = useCallback(() => {
    if (!fullStackApplyGroupId) {
      setOpErr("Select a task group template.");
      return;
    }
    const lines = (taskGroupLines ?? [])
      .filter((l) => l.task_group_id === fullStackApplyGroupId)
      .sort((a, b) => a.sort_order - b.sort_order);
    if (lines.length === 0) {
      setOpErr("This task group has no lines.");
      return;
    }
    const newRows = draftRowsFromTaskGroupLines(lines, tasks);
    if (newRows.length === 0) {
      setOpErr("No rows could be built from that template.");
      return;
    }
    setDraftTasks((prev) => [...prev, ...newRows]);
    setOpOk(
      `Added ${newRows.length} row(s) from the template. They save with the new tier when you click Create entire solution. You can still edit the table.`
    );
    setOpErr(null);
    setFullStackApplyGroupId("");
  }, [fullStackApplyGroupId, setOpErr, setOpOk, taskGroupLines, tasks]);

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

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Selling</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>How can this solution be described to the client</AdminFieldCaption>
        <MarkdownTextarea value={tDescribedToClient} onChange={setTDescribedToClient} textareaStyle={textarea} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Resources</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Resources</AdminFieldCaption>
        <MarkdownTextarea value={tRes} onChange={setTRes} textareaStyle={textarea} />
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

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Selling</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>How can this solution be described to the client</AdminFieldCaption>
        <MarkdownTextarea value={updTDescribedToClient} onChange={setUpdTDescribedToClient} textareaStyle={textarea} />
      </label>

      <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Resources</h4>
      <label style={{ ...lbl, gridColumn: "1 / -1" }}>
        <AdminFieldCaption>Resources</AdminFieldCaption>
        <MarkdownTextarea value={updTRes} onChange={setUpdTRes} textareaStyle={textarea} />
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

                  <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Selling</h4>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>How can this solution be described to the client</AdminFieldCaption>
                    <MarkdownTextarea value={tDescribedToClient} onChange={setTDescribedToClient} textareaStyle={textarea} />
                  </label>

                  <h4 style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Resources</h4>
                  <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                    <AdminFieldCaption>Resources</AdminFieldCaption>
                    <MarkdownTextarea value={tRes} onChange={setTRes} textareaStyle={textarea} />
                  </label>
                  </div>
                </div>

                <div style={formSectionBox}>
                  <h4 id="sb-full-section-tasks" style={formSectionHeading}>
                    Section 2 — Tasks
                  </h4>
                  <p style={{ ...muted, marginTop: 0, marginBottom: "0.75rem" }}>
                    Add rows by hand, or <strong>load a task-group template</strong> to fill the table (same templates as{" "}
                    <strong>Admin → Task-Group templates</strong>). On save, each row with a name becomes a task (id{" "}
                    <code>4-…</code>) for the new tier. At least one task name is required.
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
                    </div>
                  </div>
                ) : null}
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
                  <h4 id="sb-full-section-pricing" style={formSectionHeading}>
                    Section 3 — Tier pricing
                  </h4>
                  <p style={{ ...muted, marginTop: 0, marginBottom: "0.65rem" }}>
                    Derived sell amounts use the same math as the Pricing tab (rules:{" "}
                    <strong>Admin → Pricing calculator</strong>, this browser).
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
                  <p style={{ ...muted, gridColumn: "1 / -1", margin: "0 0 0.5rem", fontSize: "0.84rem" }}>
                    These fields stay in sync with <strong>Section 2</strong> task rows: each row&apos;s <strong>Time</strong> and{" "}
                    <strong>Implementer</strong> roll into a bucket (Client services, Design, &hellip;) using the same{" "}
                    <strong>Implementer&ndash;Pricing mapping</strong> as elsewhere. Unmapped or blank implementer goes to
                    &quot;Other&quot;. You can still edit a bucket if you need a manual adjustment; another change in the
                    task table will refresh the split.
                  </p>
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
                    <AdminFieldCaption>Total resource hours</AdminFieldCaption>
                    <input
                      style={{ ...input, cursor: "default" }}
                      readOnly
                      tabIndex={-1}
                      value={fmtDerivedHours(fullPricingDerived.totalHours)}
                    />
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Account mgmt add-on ({ACCOUNT_MGMT_HOURS_ADDON_RATE * 100}%)</AdminFieldCaption>
                    <input
                      style={{ ...input, cursor: "default" }}
                      readOnly
                      tabIndex={-1}
                      title="Automatic before sell math."
                      value={fmtDerivedHours(fullPricingDerived.accountMgmtAddonHours)}
                    />
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Billable hours (resource + account mgmt)</AdminFieldCaption>
                    <input
                      style={{ ...input, cursor: "default" }}
                      readOnly
                      tabIndex={-1}
                      value={fmtDerivedHours(fullPricingDerived.hoursForExpectedEffort)}
                    />
                  </label>
                  <div style={{ ...formSubHeading, gridColumn: "1 / -1" }}>Risk &amp; value</div>
                  <label style={lbl}>
                    <AdminFieldCaption>Scope risk</AdminFieldCaption>
                    <select
                      style={input}
                      value={prScopeRisk}
                      title={riskScore012SelectTitle(SCOPE_RISK_SCORE_HINTS)}
                      onChange={(e) => setPrScopeRisk(e.target.value)}
                    >
                      {SCOPE_RISK_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Internal coordination</AdminFieldCaption>
                    <select
                      style={input}
                      value={prInternalCoord}
                      title={riskScore012SelectTitle(INTERNAL_COORDINATION_SCORE_HINTS)}
                      onChange={(e) => setPrInternalCoord(e.target.value)}
                    >
                      {INTERNAL_COORDINATION_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Client revision risk</AdminFieldCaption>
                    <select
                      style={input}
                      value={prClientRev}
                      title={riskScore012SelectTitle(CLIENT_REVISION_RISK_SCORE_HINTS)}
                      onChange={(e) => setPrClientRev(e.target.value)}
                    >
                      {CLIENT_REVISION_RISK_OPTIONS.map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Strategic value</AdminFieldCaption>
                    <select
                      style={input}
                      value={prStratScore}
                      title={strategicValueScoreSelectTitle()}
                      onChange={(e) => setPrStratScore(e.target.value)}
                    >
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
                        below, or apply a task group from <strong>Admin → Task-Group templates</strong>. Ids for manual
                        rows are assigned on save.
                      </p>
                      {taskGroups.length > 0 ? (
                        <div style={{ ...formSectionBox, marginTop: 12, marginBottom: 12 }}>
                          <p style={formSectionHeading}>Apply task group to this new tier</p>
                          <p style={{ ...muted, margin: "0 0 0.6rem", fontSize: "0.86rem", maxWidth: "52ch" }}>
                            Inserts new <code>4-…</code> tasks for tier <code>{ctxTierId}</code>. Safe to use more than
                            once (new ids each time). Configure templates in{" "}
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
                              onClick={() => void applyTaskGroupTemplateToCreateTier()}
                              disabled={!ctxTierId.trim() || !createApplyTemplateGroupId}
                            >
                              Apply to tier
                            </button>
                          </div>
                        </div>
                      ) : null}
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
                          Save all tasks
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
                  <a href="#sb-update-section-tiers" className="admin-sb-quicknav__link">
                    1. Tiers
                  </a>
                  <a href="#sb-update-section-tasks-pricing" className="admin-sb-quicknav__link">
                    2. Tasks &amp; pricing
                  </a>
                </nav>
              ) : null}

              <div style={{ ...formSectionBox, marginTop: "0.55rem" }}>
                <h4 style={formSectionHeading}>All solutions</h4>
                <div className="admin-table-scroll">
                  <table className="admin-data-table" style={{ ...tbl, marginTop: 4 }}>
                    <thead>
                      <tr>
                        <th style={th}>Solution</th>
                        <th style={th}>Id</th>
                        <th style={th}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...solutions]
                        .sort((a, b) => sortId(a.solution_id, b.solution_id))
                        .map((sol) => (
                          <tr
                            key={sol.solution_id}
                            className={updSolutionId === sol.solution_id ? "admin-sb-solution-row--active" : undefined}
                          >
                            <td style={td}>{sol.solution_name}</td>
                            <td style={td}>
                              <code>{sol.solution_id}</code>
                            </td>
                            <td style={td}>
                              <div className="admin-actions-row" style={{ marginTop: 0 }}>
                                <button
                                  type="button"
                                  style={btnSm}
                                  onClick={() => {
                                    setUpdSolutionId(sol.solution_id);
                                    setShowUpdateDetails(false);
                                  }}
                                >
                                  View all tiers
                                </button>
                                <button
                                  type="button"
                                  style={btnDangerSm}
                                  onClick={() => void deleteSolutionById(sol.solution_id)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                {updSolutionId ? (
                  <div style={{ ...formSectionBox, marginTop: 12 }}>
                    <p style={formSectionHeading}>
                      Solution tiers for {solutions.find((s) => s.solution_id === updSolutionId)?.solution_name ?? updSolutionId}
                    </p>
                    <div className="admin-table-scroll">
                      <table className="admin-data-table" style={{ ...tbl, marginTop: 4 }}>
                        <thead>
                          <tr>
                            <th style={th}>Tier</th>
                            <th style={th}>Id</th>
                            <th style={th}>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tiersOfUpdateSol.map((t) => (
                            <tr key={t.solution_tier_id}>
                              <td style={td}>{t.solution_tier_name}</td>
                              <td style={td}>
                                <code>{t.solution_tier_id}</code>
                              </td>
                              <td style={td}>
                                <div className="admin-actions-row" style={{ marginTop: 0 }}>
                                  <button
                                    type="button"
                                    style={btnSm}
                                    onClick={() => {
                                      startEditTier(t);
                                      setShowUpdateDetails(true);
                                      window.setTimeout(() => jumpTo("sb-update-section-tiers"), 0);
                                    }}
                                  >
                                    Update
                                  </button>
                                  <button type="button" style={btnDangerSm} onClick={() => void deleteUpdateTier(t)}>
                                    Delete
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {tiersOfUpdateSol.length === 0 ? (
                      <p style={{ ...muted, marginTop: 8 }}>No tiers yet for this solution.</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {showUpdateDetails ? (
              <>
                <div id="sb-update-section-tiers" className="admin-sb-block">
              <UpdateSectionHead
                badge="1"
                title="Tiers"
                hint="List every tier, add a new one, or edit. To bulk-add tasks from a template, use the Tasks & pricing section (step 3) after a tier exists."
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
                badge="2"
                title="Tasks & pricing for a tier"
                hint="Select a tier, then add tasks (manually, from a task-group template, or both) and set pricing. Templates are configured in Admin → Task-Group templates."
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
                      </div>
                    </div>
                  ) : null}
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
