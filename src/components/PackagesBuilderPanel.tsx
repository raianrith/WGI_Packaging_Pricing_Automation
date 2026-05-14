import type { UniqueIdentifier } from "@dnd-kit/core";
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
import { persistTaskSortOrdersForTier } from "../lib/persistTaskSortOrdersForTier";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { compareTasksByOrder } from "../lib/taskOrder";
import {
  computeSparseOverrides,
  mergeTierWithPackageOverrides,
  overrideFormStringsToPartial,
  parseTierOverrides,
  tierToOverrideFormStrings,
  type PackageTierOverrideKey,
} from "../lib/packageTierOverrides";
import {
  computeSparsePricingOverrides,
  computeSparseTaskOverridesMap,
  emptyPricingForm,
  mergePricingWithPackageOverrides,
  parsePricingOverrides,
  parseTaskOverridesMap,
  pricingFormStringsToPartial,
  pricingToFormStrings,
  taskFormToOverridePartial,
  taskToOverrideFormStrings,
  emptyTaskFormRow,
  type TaskOverrideFormRow,
} from "../lib/packagePricingTaskOverrides";
import { buildImplementerToGroupMap, rollUpTaskTimesByPricingGroup } from "../lib/taskHoursRollup";
import type { TierPricingMathConfig } from "../lib/tierPricingMath";
import { InlineActionFeedback, pickInlineFeedback } from "./InlineActionFeedback";
import { PricingPanel } from "./PricingPanel";
import { SortableTableRowTr, TaskSortableList } from "./TaskTableSortable";
import { SolutionTierFormUpdateBlock } from "./SolutionTierFormUpdateBlock";
import { TaskImplementerSelect } from "./TaskImplementerSelect";
import {
  buildMergedTaskRowsForPackageTier,
  emptyTaskExtensions,
  materializeTaskGroupToPackageExtraTasks,
  materializeTierVaultTasksToPackageExtraTasks,
  newPackageTaskId,
  parseTaskExtensions,
  pruneTaskOverridesForHidden,
} from "../lib/packageTaskLayout";
import {
  applyPackageTierMembership,
  emptyPackageLinkPayload,
  type PackageLinkSavePayload,
} from "../lib/packageTierLinkPersistence";
import type {
  ImplementerHourGroupRow,
  Package,
  PackageExtraTaskRow,
  PackageSolutionTier,
  PackageTaskExtensions,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskGroupLineRow,
  TaskGroupRow,
  TaskRow,
} from "../types";
export type PackageBuilderSubTab = "create" | "update";

function FieldCaption({ children }: { children: ReactNode }) {
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

function nextAutoPackageId(packages: Package[]): string {
  let max = 0;
  const re = /^1-(\d+)$/i;
  for (const p of packages) {
    const m = p.package_id.trim().match(re);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `1-${max + 1}`;
}

function rowJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

function extraRowFromForm(package_task_id: string, f: TaskOverrideFormRow): PackageExtraTaskRow {
  const p = taskFormToOverridePartial(f);
  return {
    package_task_id,
    task_name: p.task_name != null ? String(p.task_name) : "",
    task_implementer: p.task_implementer ?? null,
    task_time: p.task_time ?? null,
    task_duration: p.task_duration ?? null,
    task_dependencies: p.task_dependencies ?? null,
    task_notes: p.task_notes ?? null,
  };
}

function rebuildExtraTasks(
  vaultIds: Set<string>,
  prevExtras: PackageExtraTaskRow[],
  forms: Record<string, TaskOverrideFormRow>
): PackageExtraTaskRow[] {
  const out: PackageExtraTaskRow[] = [];
  const used = new Set<string>();
  for (const e of prevExtras) {
    if (vaultIds.has(e.package_task_id)) continue;
    const f = forms[e.package_task_id];
    if (!f) continue;
    out.push(extraRowFromForm(e.package_task_id, f));
    used.add(e.package_task_id);
  }
  for (const [id, f] of Object.entries(forms)) {
    if (vaultIds.has(id) || used.has(id)) continue;
    out.push(extraRowFromForm(id, f));
    used.add(id);
  }
  return out;
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function optNum(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

type PkgDraftTaskRow = {
  key: string;
  name: string;
  impl: string;
  time: string;
  dur: string;
  dep: string;
  notes: string;
};

function newPkgDraftTaskRow(): PkgDraftTaskRow {
  return {
    key: `pkg-d-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    name: "",
    impl: "",
    time: "",
    dur: "",
    dep: "",
    notes: "",
  };
}

function firstTaskMatchingName(allTasks: TaskRow[], name: string): TaskRow | null {
  const t = name.trim();
  if (!t) return null;
  for (const k of allTasks) {
    if (k.task_name.trim() === t) return k;
  }
  return null;
}

const tierSectionBox: CSSProperties = {
  marginTop: "1.1rem",
  padding: "1rem 1.15rem 1.2rem",
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  boxShadow: "var(--shadow-sm)",
};

const sectionTitle: CSSProperties = {
  margin: "0 0 0.65rem",
  fontSize: "0.98rem",
  fontWeight: 650,
  letterSpacing: "-0.02em",
};

export type PackagesBuilderPanelStyles = {
  panel: CSSProperties;
  formGrid: CSSProperties;
  lbl: CSSProperties;
  input: CSSProperties;
  textarea: CSSProperties;
  btn: CSSProperties;
  btnPrimary: CSSProperties;
  btnDangerSm: CSSProperties;
  btnSm: CSSProperties;
  tbl: CSSProperties;
  th: CSSProperties;
  td: CSSProperties;
  h2: CSSProperties;
  muted: CSSProperties;
};

export type PackagesBuilderPanelProps = {
  subTab: PackageBuilderSubTab;
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  tierPricing: SolutionTierPricing[];
  packageTiers: PackageSolutionTier[];
  taskGroups: TaskGroupRow[];
  taskGroupLines: TaskGroupLineRow[];
  implementerHourGroups: ImplementerHourGroupRow[];
  tierPricingMathConfig: TierPricingMathConfig;
  onSaved: () => Promise<void>;
  setOpErr: (s: string | null) => void;
  setOpOk: (s: string | null) => void;
  logAudit: (client: SupabaseClient, p: Parameters<typeof insertAuditLog>[1]) => Promise<void>;
  styles: PackagesBuilderPanelStyles;
};

type PkgInlineZone = "pkg_apply_tg" | "pkg_copy_tier";

export function PackagesBuilderPanel({
  subTab,
  packages,
  solutions,
  tiers,
  tasks,
  tierPricing,
  packageTiers,
  taskGroups,
  taskGroupLines,
  implementerHourGroups,
  tierPricingMathConfig,
  onSaved,
  setOpErr,
  setOpOk,
  logAudit,
  styles: s,
}: PackagesBuilderPanelProps) {
  const { panel, formGrid, lbl, input, textarea, btn, btnPrimary, btnDangerSm, btnSm, tbl, th, td, h2, muted } = s;

  const [pkgInlineFb, setPkgInlineFb] = useState<{
    zone: PkgInlineZone;
    message: string;
    variant: "ok" | "err";
  } | null>(null);

  const showPkgInline = useCallback(
    (zone: PkgInlineZone, message: string, variant: "ok" | "err" = "ok") => {
      setOpOk(null);
      setOpErr(null);
      setPkgInlineFb({ zone, message, variant });
    },
    [setOpOk, setOpErr]
  );

  const [nameField, setNameField] = useState("");
  const [selectedTierIds, setSelectedTierIds] = useState<string[]>([]);
  const [tierSearch, setTierSearch] = useState("");

  const [pkgEditId, setPkgEditId] = useState<string | null>(null);
  const [pkgEditTierId, setPkgEditTierId] = useState<string | null>(null);
  const [tierForms, setTierForms] = useState<Record<string, Record<string, string>>>({});
  const [pricingForms, setPricingForms] = useState<Record<string, Record<string, string>>>({});
  const pricingFormsRef = useRef(pricingForms);
  useEffect(() => {
    pricingFormsRef.current = pricingForms;
  });
  const [pkgAutofillFromId, setPkgAutofillFromId] = useState("");
  const [packagePricingSeed, setPackagePricingSeed] = useState<SolutionTierPricing | null>(null);
  const taskNameDatalistId = useId();
  const [pkgTaskEditId, setPkgTaskEditId] = useState<string | null>(null);
  const [pkgKName, setPkgKName] = useState("");
  const [pkgKImpl, setPkgKImpl] = useState("");
  const [pkgKTime, setPkgKTime] = useState("");
  const [pkgKDur, setPkgKDur] = useState("");
  const [pkgKDep, setPkgKDep] = useState("");
  const [pkgKNotes, setPkgKNotes] = useState("");
  const [pkgNewDrafts, setPkgNewDrafts] = useState<PkgDraftTaskRow[]>([newPkgDraftTaskRow()]);
  const [taskForms, setTaskForms] = useState<Record<string, Record<string, TaskOverrideFormRow>>>({});
  const [taskExt, setTaskExt] = useState<Record<string, PackageTaskExtensions>>({});
  const [taskGroupPick, setTaskGroupPick] = useState("");
  const [pkgCopyTierId, setPkgCopyTierId] = useState("");
  const [pkgTaskReorderBusy, setPkgTaskReorderBusy] = useState(false);

  useEffect(() => {
    setPkgCopyTierId("");
    setPkgInlineFb(null);
  }, [pkgEditTierId]);

  const solutionById = useMemo(() => {
    const m = new Map<string, Solution>();
    for (const x of solutions) m.set(x.solution_id, x);
    return m;
  }, [solutions]);

  const packageNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of packages) m.set(p.package_id, p.package_name);
    return m;
  }, [packages]);

  const tierRows = useMemo(() => {
    const q = tierSearch.trim().toLowerCase();
    const rows = [...tiers].sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
    if (!q) return rows;
    return rows.filter((t) => {
      const sol = solutionById.get(t.solution_id);
      const solName = sol?.solution_name?.toLowerCase() ?? "";
      return (
        t.solution_tier_name.toLowerCase().includes(q) ||
        t.solution_tier_id.toLowerCase().includes(q) ||
        t.solution_id.toLowerCase().includes(q) ||
        solName.includes(q)
      );
    });
  }, [tiers, tierSearch, solutionById]);

  const tierToPackageId = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of packageTiers) m.set(r.solution_tier_id, r.package_id);
    return m;
  }, [packageTiers]);

  const linesByGroup = useMemo(() => {
    const m = new Map<string, TaskGroupLineRow[]>();
    for (const line of taskGroupLines) {
      const arr = m.get(line.task_group_id) ?? [];
      arr.push(line);
      m.set(line.task_group_id, arr);
    }
    return m;
  }, [taskGroupLines]);

  const packageTiersRef = useRef(packageTiers);
  const tiersRef = useRef(tiers);
  const tasksRef = useRef(tasks);
  const tierPricingRef = useRef(tierPricing);
  useEffect(() => {
    packageTiersRef.current = packageTiers;
    tiersRef.current = tiers;
    tasksRef.current = tasks;
    tierPricingRef.current = tierPricing;
  });

  const loadPackageDrafts = useCallback((packageId: string) => {
      const links = packageTiersRef.current.filter((r) => r.package_id === packageId);
      const tierIds = [...new Set(links.map((l) => l.solution_tier_id))].sort(sortId);
      setSelectedTierIds(tierIds);

      const nextTier: Record<string, Record<string, string>> = {};
      const nextPricing: Record<string, Record<string, string>> = {};
      const nextTask: Record<string, Record<string, TaskOverrideFormRow>> = {};
      const nextExt: Record<string, PackageTaskExtensions> = {};

      for (const link of links) {
        const tid = link.solution_tier_id;
        const vaultTier = tiersRef.current.find((t) => t.solution_tier_id === tid);
        if (!vaultTier) continue;
        const mergedTier = mergeTierWithPackageOverrides(vaultTier, parseTierOverrides(link.tier_overrides));
        nextTier[tid] = tierToOverrideFormStrings(mergedTier);

        const vaultP = tierPricingRef.current.find((p) => p.solution_tier_id === tid) ?? null;
        const mergedP = mergePricingWithPackageOverrides(vaultP, tid, parsePricingOverrides(link.pricing_overrides));
        nextPricing[tid] = pricingToFormStrings(mergedP);

        const ov = parseTaskOverridesMap(link.task_overrides);
        const ext = parseTaskExtensions(link.task_extensions);
        nextExt[tid] = ext;

        const mergedTasks = buildMergedTaskRowsForPackageTier({
          tierId: tid,
          vaultTasks: tasksRef.current,
          taskOverrides: ov,
          taskExtensions: ext,
        });
        const tf: Record<string, TaskOverrideFormRow> = {};
        for (const tr of mergedTasks) tf[tr.task_id] = taskToOverrideFormStrings(tr);
        nextTask[tid] = tf;
      }

      setTierForms(nextTier);
      setPricingForms(nextPricing);
      setTaskForms(nextTask);
      setTaskExt(nextExt);
      const firstTid = tierIds[0] ?? null;
      setPkgEditTierId(firstTid);
      if (firstTid) {
        const vaultP = tierPricingRef.current.find((p) => p.solution_tier_id === firstTid) ?? null;
        const pf = nextPricing[firstTid] ?? emptyPricingForm();
        const sparse = computeSparsePricingOverrides(
          vaultP,
          firstTid,
          pricingFormStringsToPartial(pf)
        );
        setPackagePricingSeed(mergePricingWithPackageOverrides(vaultP, firstTid, sparse));
      } else {
        setPackagePricingSeed(null);
      }
  }, []);

  useEffect(() => {
    if (subTab !== "update" || !pkgEditId) return;
    loadPackageDrafts(pkgEditId);
  }, [subTab, pkgEditId, loadPackageDrafts]);

  useEffect(() => {
    if (subTab === "update" && pkgEditId) {
      const p = packages.find((x) => x.package_id === pkgEditId);
      setNameField(p?.package_name ?? "");
    }
  }, [subTab, pkgEditId, packages]);

  const refreshPackagePricingSeed = useCallback((tid: string) => {
    const vaultP = tierPricing.find((p) => p.solution_tier_id === tid) ?? null;
    const pf = pricingFormsRef.current[tid] ?? emptyPricingForm();
    const sparse = computeSparsePricingOverrides(vaultP, tid, pricingFormStringsToPartial(pf));
    setPackagePricingSeed(mergePricingWithPackageOverrides(vaultP, tid, sparse));
  }, [tierPricing]);

  useEffect(() => {
    if (!pkgEditTierId || !selectedTierIds.includes(pkgEditTierId)) {
      const next = selectedTierIds.sort(sortId)[0] ?? null;
      setPkgEditTierId(next);
      if (next) refreshPackagePricingSeed(next);
      else setPackagePricingSeed(null);
    }
  }, [selectedTierIds, pkgEditTierId, refreshPackagePricingSeed]);

  const toggleTier = (tierId: string, include: boolean) => {
    setSelectedTierIds((prev) => {
      if (include) return prev.includes(tierId) ? prev : [...prev, tierId];
      return prev.filter((x) => x !== tierId);
    });
    if (!include && pkgEditTierId === tierId) setPkgEditTierId(null);
  };

  const startNewCreate = () => {
    setNameField("");
    setSelectedTierIds([]);
    setTierSearch("");
    setPkgEditId(null);
    setPkgEditTierId(null);
    setTierForms({});
    setPricingForms({});
    setTaskForms({});
    setTaskExt({});
    setPackagePricingSeed(null);
    setPkgAutofillFromId("");
    setPkgTaskEditId(null);
    setPkgKName("");
    setPkgKImpl("");
    setPkgKTime("");
    setPkgKDur("");
    setPkgKDep("");
    setPkgKNotes("");
    setPkgNewDrafts([newPkgDraftTaskRow()]);
  };

  const buildPayloadForTier = (tid: string): PackageLinkSavePayload => {
    const vaultTier = tiers.find((t) => t.solution_tier_id === tid);
    if (!vaultTier) return emptyPackageLinkPayload();
    const tier_partial = overrideFormStringsToPartial(tierForms[tid] ?? tierToOverrideFormStrings(vaultTier));
    const tier_overrides = computeSparseOverrides(vaultTier, tier_partial);

    const vaultP = tierPricing.find((p) => p.solution_tier_id === tid) ?? null;
    const pricing_partial = pricingFormStringsToPartial(pricingForms[tid] ?? emptyPricingForm());
    const pricing_overrides = computeSparsePricingOverrides(vaultP, tid, pricing_partial);

    const vaultTasksForTier = tasks.filter((t) => t.solution_tier_id === tid);
    const ext = taskExt[tid] ?? emptyTaskExtensions();
    const hidden = new Set(ext.hidden_task_ids ?? []);
    const forms = { ...(taskForms[tid] ?? {}) };
    for (const h of hidden) delete forms[h];
    const ovVault = computeSparseTaskOverridesMap(vaultTasksForTier, forms);
    const task_overrides = pruneTaskOverridesForHidden(ovVault, hidden);
    const vaultIds = new Set(vaultTasksForTier.map((t) => t.task_id));
    const extra_tasks = rebuildExtraTasks(vaultIds, ext.extra_tasks ?? [], taskForms[tid] ?? {});
    const task_extensions: PackageTaskExtensions = {
      hidden_task_ids: [...hidden],
      extra_tasks,
    };
    return { tier_overrides, pricing_overrides, task_overrides, task_extensions };
  };

  const saveCreate = async () => {
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    const today = todayISODate();
    const wanted = [...selectedTierIds].sort(sortId);

    for (const tid of wanted) {
      const t = tiers.find((x) => x.solution_tier_id === tid);
      if (!t?.solution_tier_name.trim()) {
        setOpErr(`Tier ${tid} needs a non-empty name in Solutions Builder before it can be added to a package.`);
        return;
      }
    }

    const name = nameField.trim();
    if (!name) {
      setOpErr("Package name is required.");
      return;
    }
    const newId = nextAutoPackageId(packages);
    const row: Package = {
      package_id: newId,
      package_name: name,
      package_create_date: today,
      package_modified_date: today,
    };
    const { error } = await client.from("packages").insert(row);
    if (error) {
      setOpErr(friendlyMutationMessage(error.message));
      return;
    }
    const payloadByTier: Record<string, PackageLinkSavePayload> = {};
    for (const tid of wanted) payloadByTier[tid] = emptyPackageLinkPayload();
    const assignErr = await applyPackageTierMembership(client, newId, wanted, payloadByTier);
    if (assignErr) {
      setOpErr(`${assignErr} (Package ${newId} was created; fix links in Package Builder if needed.)`);
      await onSaved();
      return;
    }
    await logAudit(client, {
      entityType: "packages",
      entityId: newId,
      action: "insert",
      before: null,
      after: { ...(rowJson(row) as Record<string, unknown>), solution_tier_ids: wanted },
    });
    setOpOk(`Package ${newId} created with ${wanted.length} tier link(s).`);
    startNewCreate();
    await onSaved();
  };

  const saveUpdate = async () => {
    const client = getSupabase();
    if (!client || !pkgEditId) return;
    setOpErr(null);
    setOpOk(null);
    const today = todayISODate();
    const wanted = [...selectedTierIds].sort(sortId);

    for (const tid of wanted) {
      const t = tiers.find((x) => x.solution_tier_id === tid);
      if (!t?.solution_tier_name.trim()) {
        setOpErr(`Tier ${tid} needs a non-empty name in Solutions Builder before it can be added to a package.`);
        return;
      }
    }

    const name = nameField.trim();
    if (!name) {
      setOpErr("Package name is required.");
      return;
    }

    const beforePkg = packages.find((p) => p.package_id === pkgEditId);
    const { error: uerr } = await client
      .from("packages")
      .update({ package_name: name, package_modified_date: today })
      .eq("package_id", pkgEditId);
    if (uerr) {
      setOpErr(friendlyMutationMessage(uerr.message));
      return;
    }

    const payloadByTier: Record<string, PackageLinkSavePayload> = {};
    for (const tid of wanted) payloadByTier[tid] = buildPayloadForTier(tid);

    const assignErr = await applyPackageTierMembership(client, pkgEditId, wanted, payloadByTier);
    if (assignErr) {
      setOpErr(assignErr);
      await onSaved();
      return;
    }

    await logAudit(client, {
      entityType: "packages",
      entityId: pkgEditId,
      action: "update",
      before: beforePkg ? (rowJson(beforePkg) as Record<string, unknown>) : null,
      after: {
        package_id: pkgEditId,
        package_name: name,
        package_modified_date: today,
        solution_tier_ids: wanted,
      },
    });
    setOpOk(`Package ${pkgEditId} updated (${wanted.length} tier link(s)).`);
    await onSaved();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    loadPackageDrafts(pkgEditId);
  };

  const removeCurrentPackage = async () => {
    const client = getSupabase();
    if (!client || !pkgEditId) return;
    if (!globalThis.confirm(`Delete package ${pkgEditId} and all its tier links? This cannot be undone.`)) return;
    setOpErr(null);
    setOpOk(null);
    const beforePkg = packages.find((p) => p.package_id === pkgEditId);
    const { error: d1 } = await client.from("package_solution_tiers").delete().eq("package_id", pkgEditId);
    if (d1) {
      setOpErr(friendlyMutationMessage(d1.message));
      return;
    }
    const beforeTierIds = packageTiers
      .filter((x) => x.package_id === pkgEditId)
      .map((x) => x.solution_tier_id);
    const { error: d2 } = await client.from("packages").delete().eq("package_id", pkgEditId);
    if (d2) {
      setOpErr(friendlyMutationMessage(d2.message));
      await onSaved();
      return;
    }
    await logAudit(client, {
      entityType: "packages",
      entityId: pkgEditId,
      action: "delete",
      before: beforePkg
        ? {
            ...(rowJson(beforePkg) as Record<string, unknown>),
            solution_tier_ids: beforeTierIds,
          }
        : null,
      after: null,
    });
    setOpOk(`Package ${pkgEditId} deleted.`);
    setPkgEditId(null);
    startNewCreate();
    await onSaved();
  };

  const setTierForm = (tid: string, key: PackageTierOverrideKey, v: string) => {
    setTierForms((prev) => ({
      ...prev,
      [tid]: { ...(prev[tid] ?? {}), [key]: v },
    }));
  };

  const onPackagePricingDraft = useCallback(
    (row: SolutionTierPricing) => {
      if (!pkgEditTierId) return;
      const tid = pkgEditTierId;
      setPricingForms((prev) => ({ ...prev, [tid]: pricingToFormStrings(row) }));
    },
    [pkgEditTierId]
  );

  const vaultSellForTier = (tid: string): number | null => {
    const vaultP = tierPricing.find((p) => p.solution_tier_id === tid) ?? null;
    const merged = mergePricingWithPackageOverrides(vaultP, tid, {});
    return merged.sell_price;
  };

  const previewSellForTier = (tid: string): number | null => {
    const vaultTier = tiers.find((t) => t.solution_tier_id === tid);
    if (!vaultTier) return null;
    const vaultP = tierPricing.find((p) => p.solution_tier_id === tid) ?? null;
    const partial = pricingFormStringsToPartial(pricingForms[tid] ?? emptyPricingForm());
    const sparse = computeSparsePricingOverrides(vaultP, tid, partial);
    const merged = mergePricingWithPackageOverrides(vaultP, tid, sparse);
    return merged.sell_price;
  };

  const displayMergedTasks = useMemo(() => {
    if (!pkgEditTierId || subTab !== "update") return [];
    const tid = pkgEditTierId;
    const vaultTasksForTier = tasks.filter((t) => t.solution_tier_id === tid);
    const hidden = new Set(taskExt[tid]?.hidden_task_ids ?? []);
    const forms = taskForms[tid] ?? {};
    const formsNoHidden = Object.fromEntries(Object.entries(forms).filter(([id]) => !hidden.has(id)));
    const sparseMap = computeSparseTaskOverridesMap(vaultTasksForTier, formsNoHidden);
    const vaultIds = new Set(vaultTasksForTier.map((t) => t.task_id));
    const extras = rebuildExtraTasks(vaultIds, taskExt[tid]?.extra_tasks ?? [], forms);
    return buildMergedTaskRowsForPackageTier({
      tierId: tid,
      vaultTasks: tasks,
      taskOverrides: sparseMap,
      taskExtensions: { hidden_task_ids: [...hidden], extra_tasks: extras },
    });
  }, [pkgEditTierId, subTab, tasks, taskForms, taskExt]);

  const vaultTasksForEdit = useMemo(
    () => (pkgEditTierId ? tasks.filter((t) => t.solution_tier_id === pkgEditTierId) : []),
    [pkgEditTierId, tasks]
  );
  const vaultIdsEdit = useMemo(
    () => new Set(vaultTasksForEdit.map((t) => t.task_id)),
    [vaultTasksForEdit]
  );

  const packageVaultDisplayRows = useMemo(
    () => displayMergedTasks.filter((tr) => vaultIdsEdit.has(tr.task_id)),
    [displayMergedTasks, vaultIdsEdit]
  );
  const packageExtraDisplayRows = useMemo(
    () => displayMergedTasks.filter((tr) => !vaultIdsEdit.has(tr.task_id)),
    [displayMergedTasks, vaultIdsEdit]
  );

  const applyPackageVaultOrderFromIds = useCallback(
    async (orderedIds: UniqueIdentifier[]) => {
      const tid = pkgEditTierId;
      if (!tid) return;
      const swapped = orderedIds.map(String);
      const hidden = new Set(taskExt[tid]?.hidden_task_ids ?? []);
      const hiddenOrdered = tasks
        .filter((t) => t.solution_tier_id === tid && hidden.has(t.task_id))
        .sort(compareTasksByOrder)
        .map((t) => t.task_id);
      const finalIds = [...swapped, ...hiddenOrdered];
      const client = getSupabase();
      if (!client) return;
      setPkgTaskReorderBusy(true);
      setOpErr(null);
      try {
        const res = await persistTaskSortOrdersForTier(client, tid, finalIds);
        if (!res.ok) {
          setOpErr(res.message);
          return;
        }
        await onSaved();
        setOpOk("Vault task order updated for this tier.");
      } finally {
        setPkgTaskReorderBusy(false);
      }
    },
    [onSaved, pkgEditTierId, setOpErr, setOpOk, taskExt, tasks]
  );

  const applyPackageExtraOrderFromIds = useCallback(
    (orderedIds: UniqueIdentifier[]) => {
      const tid = pkgEditTierId;
      if (!tid) return;
      const swapped = orderedIds.map(String);
      setTaskExt((prev) => {
        const cur = { ...(prev[tid] ?? emptyTaskExtensions()) };
        const byId = new Map((cur.extra_tasks ?? []).map((e) => [e.package_task_id, e]));
        cur.extra_tasks = swapped
          .map((id) => byId.get(id))
          .filter((e): e is PackageExtraTaskRow => e != null);
        return { ...prev, [tid]: cur };
      });
      setOpOk("Package-only task order updated (save package to persist).");
    },
    [pkgEditTierId, setOpOk]
  );

  const reorderPkgNewDraftsByKeys = useCallback((nextKeys: UniqueIdentifier[]) => {
    setPkgNewDrafts((prev) => {
      const m = new Map(prev.map((r) => [r.key, r]));
      return nextKeys.map((k) => m.get(String(k))).filter((r): r is PkgDraftTaskRow => r != null);
    });
  }, []);

  const duplicatePkgNewDraftRow = useCallback((key: string) => {
    setPkgNewDrafts((list) => {
      const i = list.findIndex((r) => r.key === key);
      if (i === -1) return list;
      const row = list[i];
      const copy: PkgDraftTaskRow = {
        ...row,
        key: `pkg-d-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      };
      return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
    });
  }, []);

  const distinctImplementerOptions = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) {
      const v = t.task_implementer?.trim();
      if (v) s.add(v);
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const sortedTaskNamesForDatalist = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasks) {
      if (t.task_name.trim()) s.add(t.task_name.trim());
    }
    for (const line of taskGroupLines) {
      if (line.task_name.trim()) s.add(line.task_name.trim());
    }
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [tasks, taskGroupLines]);

  const pkgTiersForAutofill = useMemo(() => {
    if (!pkgEditTierId) return [...tiers].sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
    return tiers
      .filter((t) => t.solution_tier_id !== pkgEditTierId)
      .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
  }, [tiers, pkgEditTierId]);

  const tasksForPackageHourRollup = useMemo(() => {
    if (!pkgEditTierId || subTab !== "update") return [] as TaskRow[];
    const tid = pkgEditTierId;
    const base = displayMergedTasks.map((tr) => {
      if (pkgTaskEditId && tr.task_id === pkgTaskEditId) {
        return {
          ...tr,
          task_name: pkgKName.trim() || tr.task_name,
          task_implementer: pkgKImpl.trim() || tr.task_implementer,
          task_time: optNum(pkgKTime),
          task_duration: optNum(pkgKDur),
          task_dependencies: pkgKDep.trim() || null,
          task_notes: pkgKNotes.trim() || null,
        };
      }
      return tr;
    });
    const today = todayISODate();
    const fromDrafts: TaskRow[] = pkgNewDrafts
      .filter((d) => d.name.trim())
      .map((d) => ({
        task_id: `pkg-new-${d.key}`,
        solution_tier_id: tid,
        task_name: d.name.trim(),
        task_implementer: d.impl.trim() || null,
        task_time: optNum(d.time),
        task_duration: optNum(d.dur),
        task_dependencies: d.dep.trim() || null,
        task_notes: d.notes.trim() || null,
        task_create_date: today,
        task_modified_date: today,
      }));
    return [...base, ...fromDrafts];
  }, [
    pkgEditTierId,
    subTab,
    displayMergedTasks,
    pkgTaskEditId,
    pkgKName,
    pkgKImpl,
    pkgKTime,
    pkgKDur,
    pkgKDep,
    pkgKNotes,
    pkgNewDrafts,
  ]);

  const implementerToGroup = useMemo(
    () => buildImplementerToGroupMap(implementerHourGroups),
    [implementerHourGroups]
  );

  const taskHourRollupForPackage = useMemo(() => {
    if (!pkgEditTierId || implementerHourGroups.length === 0) return null;
    return rollUpTaskTimesByPricingGroup(tasksForPackageHourRollup, implementerToGroup);
  }, [pkgEditTierId, implementerHourGroups, tasksForPackageHourRollup, implementerToGroup]);

  const clearPkgTaskEdit = useCallback(() => {
    setPkgTaskEditId(null);
    setPkgKName("");
    setPkgKImpl("");
    setPkgKTime("");
    setPkgKDur("");
    setPkgKDep("");
    setPkgKNotes("");
  }, []);

  const startPkgEditTask = useCallback((tr: TaskRow) => {
    setPkgTaskEditId(tr.task_id);
    setPkgKName(tr.task_name);
    setPkgKImpl(tr.task_implementer ?? "");
    setPkgKTime(tr.task_time != null ? String(tr.task_time) : "");
    setPkgKDur(tr.task_duration != null ? String(tr.task_duration) : "");
    setPkgKDep(tr.task_dependencies ?? "");
    setPkgKNotes(tr.task_notes ?? "");
  }, []);

  const savePkgTaskEdit = useCallback(() => {
    if (!pkgEditTierId || !pkgTaskEditId) return;
    const tid = pkgEditTierId;
    const id = pkgTaskEditId;
    setTaskForms((prev) => {
      const cur = { ...(prev[tid] ?? {}) };
      cur[id] = {
        task_name: pkgKName,
        task_implementer: pkgKImpl,
        task_time: pkgKTime,
        task_duration: pkgKDur,
        task_dependencies: pkgKDep,
        task_notes: pkgKNotes,
      } as TaskOverrideFormRow;
      return { ...prev, [tid]: cur };
    });
    clearPkgTaskEdit();
    setOpOk("Task draft updated (save the package to persist).");
  }, [pkgEditTierId, pkgTaskEditId, pkgKName, pkgKImpl, pkgKTime, pkgKDur, pkgKDep, pkgKNotes, clearPkgTaskEdit, setOpOk]);

  const onPkgNewTaskNameChange = useCallback(
    (key: string, value: string) => {
      setPkgNewDrafts((list) =>
        list.map((r) => {
          if (r.key !== key) return r;
          const m = firstTaskMatchingName(tasks, value);
          if (m) {
            return {
              ...r,
              name: value,
              impl: m.task_implementer ?? "",
              time: m.task_time != null ? String(m.task_time) : "",
              dur: m.task_duration != null ? String(m.task_duration) : "",
              dep: m.task_dependencies ?? "",
              notes: m.task_notes ?? "",
            };
          }
          return { ...r, name: value };
        })
      );
    },
    [tasks]
  );

  const onPkgEditTaskNameChange = useCallback(
    (value: string) => {
      setPkgKName(value);
      const m = firstTaskMatchingName(tasks, value);
      if (m) {
        setPkgKImpl(m.task_implementer ?? "");
        setPkgKTime(m.task_time != null ? String(m.task_time) : "");
        setPkgKDur(m.task_duration != null ? String(m.task_duration) : "");
        setPkgKDep(m.task_dependencies ?? "");
        setPkgKNotes(m.task_notes ?? "");
      }
    },
    [tasks]
  );

  const savePkgNewTasksBulk = useCallback(() => {
    if (!pkgEditTierId) return;
    const tid = pkgEditTierId;
    const rows = pkgNewDrafts.filter((d) => d.name.trim());
    if (rows.length === 0) {
      setOpErr("Add at least one task name before saving new rows.");
      return;
    }
    setOpErr(null);
    const built: PackageExtraTaskRow[] = rows.map((d) => ({
      package_task_id: newPackageTaskId(),
      task_name: d.name.trim(),
      task_implementer: d.impl.trim() || null,
      task_time: optNum(d.time),
      task_duration: optNum(d.dur),
      task_dependencies: d.dep.trim() || null,
      task_notes: d.notes.trim() || null,
    }));
    setTaskExt((p) => {
      const curExt = p[tid] ?? emptyTaskExtensions();
      return {
        ...p,
        [tid]: { ...curExt, extra_tasks: [...(curExt.extra_tasks ?? []), ...built] },
      };
    });
    setTaskForms((p) => {
      const tf = { ...(p[tid] ?? {}) };
      for (let i = 0; i < built.length; i++) {
        const row = built[i]!;
        const d = rows[i]!;
        tf[row.package_task_id] = {
          ...emptyTaskFormRow(),
          task_name: d.name.trim(),
          task_implementer: d.impl,
          task_time: d.time,
          task_duration: d.dur,
          task_dependencies: d.dep,
          task_notes: d.notes,
        };
      }
      return { ...p, [tid]: tf };
    });
    setPkgNewDrafts([newPkgDraftTaskRow()]);
    setOpOk(`Added ${rows.length} package-only task row(s). Save the package to persist.`);
  }, [pkgEditTierId, pkgNewDrafts, setOpErr, setOpOk]);

  const hideVaultTask = (tid: string, taskId: string) => {
    if (pkgTaskEditId === taskId) clearPkgTaskEdit();
    setTaskExt((prev) => {
      const cur = { ...(prev[tid] ?? emptyTaskExtensions()) };
      const hid = new Set(cur.hidden_task_ids ?? []);
      hid.add(taskId);
      cur.hidden_task_ids = [...hid];
      return { ...prev, [tid]: cur };
    });
    setTaskForms((prev) => {
      const tf = { ...(prev[tid] ?? {}) };
      delete tf[taskId];
      return { ...prev, [tid]: tf };
    });
  };

  const addBlankExtraTask = (tid: string) => {
    const id = newPackageTaskId();
    setTaskExt((prev) => {
      const cur = { ...(prev[tid] ?? emptyTaskExtensions()) };
      const extras = [...(cur.extra_tasks ?? [])];
      extras.push({
        package_task_id: id,
        task_name: "New package task",
        task_implementer: null,
        task_time: null,
        task_duration: null,
        task_dependencies: null,
        task_notes: null,
      });
      cur.extra_tasks = extras;
      return { ...prev, [tid]: cur };
    });
    setTaskForms((prev) => ({
      ...prev,
      [tid]: {
        ...(prev[tid] ?? {}),
        [id]: { ...emptyTaskFormRow(), task_name: "New package task" },
      },
    }));
  };

  const removeExtraTask = (tid: string, packageTaskId: string) => {
    if (pkgTaskEditId === packageTaskId) clearPkgTaskEdit();
    setTaskExt((prev) => {
      const cur = { ...(prev[tid] ?? emptyTaskExtensions()) };
      cur.extra_tasks = (cur.extra_tasks ?? []).filter((e) => e.package_task_id !== packageTaskId);
      return { ...prev, [tid]: cur };
    });
    setTaskForms((prev) => {
      const tf = { ...(prev[tid] ?? {}) };
      delete tf[packageTaskId];
      return { ...prev, [tid]: tf };
    });
  };

  const appendTaskGroup = (tid: string, groupId: string) => {
    const lines = linesByGroup.get(groupId) ?? [];
    const created = materializeTaskGroupToPackageExtraTasks(lines, tasks);
    if (!created.length) {
      showPkgInline("pkg_apply_tg", "This template produced no package lines.", "err");
      return;
    }
    setTaskExt((prev) => {
      const cur = { ...(prev[tid] ?? emptyTaskExtensions()) };
      cur.extra_tasks = [...(cur.extra_tasks ?? []), ...created];
      return { ...prev, [tid]: cur };
    });
    setTaskForms((prev) => {
      const tf = { ...(prev[tid] ?? {}) };
      for (const e of created) tf[e.package_task_id] = taskToOverrideFormStrings(extraTaskToTaskRowLocal(tid, e));
      return { ...prev, [tid]: tf };
    });
    setTaskGroupPick("");
    showPkgInline("pkg_apply_tg", `Added ${created.length} line(s). Save package to persist.`, "ok");
  };

  const appendTierVaultFromOtherTier = (vaultTierId: string) => {
    if (!pkgCopyTierId.trim()) {
      showPkgInline("pkg_copy_tier", "Select a tier whose vault checklist you want to clone.", "err");
      return;
    }
    const srcId = pkgCopyTierId.trim();
    if (srcId === vaultTierId) {
      showPkgInline(
        "pkg_copy_tier",
        "Pick a tier other than this package tier (you're overlaying another tier's vault checklist).",
        "err"
      );
      return;
    }
    const created = materializeTierVaultTasksToPackageExtraTasks(tasks, srcId, tiers);
    if (created.length === 0) {
      showPkgInline("pkg_copy_tier", "That tier has no vault tasks to copy.", "err");
      return;
    }
    setTaskExt((prev) => {
      const cur = { ...(prev[vaultTierId] ?? emptyTaskExtensions()) };
      cur.extra_tasks = [...(cur.extra_tasks ?? []), ...created];
      return { ...prev, [vaultTierId]: cur };
    });
    setTaskForms((prev) => {
      const tf = { ...(prev[vaultTierId] ?? {}) };
      for (const e of created) tf[e.package_task_id] = taskToOverrideFormStrings(extraTaskToTaskRowLocal(vaultTierId, e));
      return { ...prev, [vaultTierId]: tf };
    });
    setPkgCopyTierId("");
    showPkgInline(
      "pkg_copy_tier",
      `Added ${created.length} package-only line(s) from tier ${srcId}. Save package to persist.`,
      "ok"
    );
  };

  function extraTaskToTaskRowLocal(tierId: string, e: PackageExtraTaskRow): TaskRow {
    const placeholder = "1970-01-01";
    return {
      task_id: e.package_task_id,
      solution_tier_id: tierId,
      task_name: e.task_name.trim() || "Package task",
      task_implementer: e.task_implementer?.trim() ? e.task_implementer.trim() : null,
      task_time: e.task_time != null && Number.isFinite(e.task_time) ? e.task_time : null,
      task_duration: e.task_duration != null && Number.isFinite(e.task_duration) ? e.task_duration : null,
      task_dependencies: e.task_dependencies?.trim() ? e.task_dependencies.trim() : null,
      task_notes: e.task_notes?.trim() ? e.task_notes.trim() : null,
      task_create_date: placeholder,
      task_modified_date: placeholder,
    };
  }

  const tierPickerIntro =
    subTab === "create"
      ? "Check each solution tier to include in this package. A tier can only belong to one package at a time; saving moves it from another package if needed."
      : "Check tiers that belong to this package. Uncheck to remove a tier from the package (link row deleted on save). Checking adds the tier with current draft overrides.";

  const tierPickerBlock = (
    <>
      <p className="admin-intro" style={{ ...muted, marginTop: "0.75rem" }}>
        {tierPickerIntro}
      </p>
      <label style={{ ...lbl, marginTop: 8 }}>
        <FieldCaption>Filter tiers</FieldCaption>
        <input
          style={input}
          value={tierSearch}
          onChange={(e) => setTierSearch(e.target.value)}
          placeholder="Tier name, tier id, solution id, or solution name…"
        />
      </label>
      <div
        className="admin-table-scroll"
        style={{ maxHeight: "min(22rem, 50vh)", marginTop: 8, border: "1px solid rgba(0,0,0,0.08)", borderRadius: 8 }}
      >
        <table className="admin-data-table" style={{ ...tbl, marginTop: 0 }}>
          <thead>
            <tr>
              <th style={{ ...th, width: "2.25rem" }} aria-label="Include tier in package" />
              <th style={th}>Solution</th>
              <th style={th}>Tier</th>
              <th style={th}>Tier id</th>
              <th style={th}>Current package</th>
            </tr>
          </thead>
          <tbody>
            {tierRows.length === 0 ? (
              <tr>
                <td colSpan={5} style={td}>
                  No tiers match this filter.
                </td>
              </tr>
            ) : (
              tierRows.map((t) => {
                const sol = solutionById.get(t.solution_id);
                const checked = selectedTierIds.includes(t.solution_tier_id);
                const pid = tierToPackageId.get(t.solution_tier_id);
                const editingThisPackage = subTab === "update" && pkgEditId != null && pid === pkgEditId;
                const pkgLabel =
                  pid == null
                    ? "—"
                    : editingThisPackage
                      ? `${packageNameById.get(pid) ?? "—"} (${pid}) — editing`
                      : `${packageNameById.get(pid) ?? "—"} (${pid})`;
                return (
                  <tr key={t.solution_tier_id}>
                    <td style={td}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggleTier(t.solution_tier_id, e.target.checked)}
                        aria-label={`Include tier ${t.solution_tier_name} in this package`}
                      />
                    </td>
                    <td style={td}>{sol?.solution_name ?? t.solution_id}</td>
                    <td style={td}>{t.solution_tier_name}</td>
                    <td style={td}>
                      <code style={{ fontSize: "0.85em" }}>{t.solution_tier_id}</code>
                    </td>
                    <td style={{ ...td, fontSize: "0.88em", color: "var(--muted, #666)" }}>{pkgLabel}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );

  const origSell = pkgEditTierId ? vaultSellForTier(pkgEditTierId) : null;
  const nextSell = pkgEditTierId ? previewSellForTier(pkgEditTierId) : null;
  const delta =
    origSell != null && nextSell != null && Number.isFinite(origSell) && Number.isFinite(nextSell)
      ? nextSell - origSell
      : null;

  return (
    <section className="admin-panel admin-panel--editor admin-packages-builder" style={panel}>
      <div className="admin-editor-layout">
        <h2 style={h2}>Package Builder</h2>
        {subTab === "create" ? (
          <p className="admin-intro" style={muted}>
            Name the bundle and choose which solution tiers belong to it. The next package id in the{" "}
            <code style={{ fontSize: "0.9em" }}>1-n</code> sequence is assigned automatically. Use{" "}
            <strong>Update</strong> to edit tier copy, pricing overrides, tasks, and membership on existing packages. Use
            the <strong>Edit Tier Slot Ceilings</strong> sub-tab to configure Build-a-Package ceilings.
          </p>
        ) : (
          <p className="admin-intro" style={muted}>
            Pick a package, adjust its name, tier membership, then choose a tier to edit tasks and pricing. Vault values
            stay canonical; changes here are stored only on the package–tier link. Sell price shows vault vs your draft
            (including pricing overrides). Build-a-Package ceilings live under <strong>Edit Tier Slot Ceilings</strong>.
          </p>
        )}

        {subTab === "update" && (
          <div className="admin-form-stack" style={{ ...formGrid, marginBottom: "0.75rem" }}>
            <label style={lbl}>
              <FieldCaption>Package to edit</FieldCaption>
              <select
                style={input}
                value={pkgEditId ?? ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setPkgEditId(v || null);
                  if (v) {
                    const p = packages.find((x) => x.package_id === v);
                    setNameField(p?.package_name ?? "");
                  } else startNewCreate();
                }}
              >
                <option value="">— Select —</option>
                {[...packages].sort((a, b) => sortId(a.package_id, b.package_id)).map((p) => (
                  <option key={p.package_id} value={p.package_id}>
                    {p.package_name} ({p.package_id})
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        <div className="admin-form-stack" style={formGrid}>
          {subTab === "create" && (
            <label style={lbl}>
              <FieldCaption>Next package id (preview)</FieldCaption>
              <input
                style={{ ...input, opacity: 0.92 }}
                readOnly
                value={packages.length ? nextAutoPackageId(packages) : "1-1"}
                aria-readonly="true"
              />
            </label>
          )}
          <label style={lbl}>
            <FieldCaption>Package name</FieldCaption>
            <input
              style={input}
              value={nameField}
              onChange={(e) => setNameField(e.target.value)}
              placeholder="Display name"
              disabled={subTab === "update" && !pkgEditId}
            />
          </label>
        </div>

        {tierPickerBlock}

        {subTab === "update" && pkgEditId && (
          <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <label style={{ ...lbl, maxWidth: 420 }}>
              <FieldCaption>Tier to edit (tasks & pricing)</FieldCaption>
              <select
                style={input}
                value={pkgEditTierId ?? ""}
                onChange={(e) => {
                  const v = e.target.value || null;
                  setPkgEditTierId(v);
                  setPkgAutofillFromId("");
                  setPkgCopyTierId("");
                  clearPkgTaskEdit();
                  setPkgNewDrafts([newPkgDraftTaskRow()]);
                  if (v) refreshPackagePricingSeed(v);
                  else setPackagePricingSeed(null);
                }}
              >
                {selectedTierIds.sort(sortId).map((tid) => {
                  const t = tiers.find((x) => x.solution_tier_id === tid);
                  return (
                    <option key={tid} value={tid}>
                      {t?.solution_tier_name ?? tid} ({tid})
                    </option>
                  );
                })}
              </select>
            </label>

            {pkgEditTierId && (
              <div style={{ marginTop: 12 }}>
                <div
                  className="admin-packages-builder__sell-banner"
                  style={{
                    padding: "0.65rem 0.75rem",
                    borderRadius: 10,
                    background: "rgba(74, 179, 155, 0.08)",
                    border: "1px solid rgba(74, 179, 155, 0.18)",
                    marginBottom: 12,
                  }}
                >
                  <p style={{ margin: "0 0 0.35rem", fontWeight: 700, fontSize: "0.9rem" }}>Sell price (this tier)</p>
                  <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--text)" }}>
                    Vault (saved tier pricing): <strong>{fmtMoney(origSell)}</strong>
                    {" · "}
                    Package preview (vault + your overrides): <strong>{fmtMoney(nextSell)}</strong>
                    {delta != null && Number.isFinite(delta) ? (
                      <>
                        {" · "}
                        Change:{" "}
                        <strong
                          style={{ color: delta > 0 ? "var(--danger)" : delta < 0 ? "var(--accent)" : "inherit" }}
                        >
                          {delta >= 0 ? "+" : ""}
                          {fmtMoney(delta)}
                        </strong>
                        {origSell != null && origSell !== 0 ? (
                          <span style={{ color: "var(--muted)" }}>
                            {" "}
                            ({((100 * delta) / origSell).toFixed(1)}%)
                          </span>
                        ) : null}
                      </>
                    ) : null}
                  </p>
                </div>

                <datalist id={taskNameDatalistId}>
                  {sortedTaskNamesForDatalist.map((n) => (
                    <option key={n} value={n} />
                  ))}
                </datalist>

                <div className="admin-packages-builder__tier-section" style={tierSectionBox}>
                  <h3 className="admin-sb-subhead" style={sectionTitle}>
                    Section 1 — Tier (package overlay)
                  </h3>
                  <p style={{ ...muted, marginTop: 0, maxWidth: "62ch" }}>
                    Same fields as <strong>Solutions Builder → Update → tier editor</strong>. Only{" "}
                    <code style={{ fontSize: "0.85em" }}>package_solution_tiers.tier_overrides</code> is updated when you
                    save the package.
                  </p>
                  <SolutionTierFormUpdateBlock
                    tierIdReadonly={pkgEditTierId}
                    values={(tierForms[pkgEditTierId] ?? {}) as Partial<Record<PackageTierOverrideKey, string>>}
                    onChange={(key, v) => setTierForm(pkgEditTierId, key, v)}
                    autofillBlock={
                      <>
                        <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                          <FieldCaption>Autofill from existing tier</FieldCaption>
                          <select
                            style={input}
                            value={pkgAutofillFromId}
                            onChange={(e) => {
                              const v = e.target.value;
                              setPkgAutofillFromId(v);
                              if (!v) return;
                              const t = tiers.find((x) => x.solution_tier_id === v);
                              if (!t) return;
                              setTierForms((prev) => {
                                const priorRow = prev[pkgEditTierId];
                                const priorName = (priorRow?.solution_tier_name ?? "").trim();
                                const filled = tierToOverrideFormStrings(t);
                                return {
                                  ...prev,
                                  [pkgEditTierId]: {
                                    ...filled,
                                    solution_tier_name:
                                      priorName !== "" ? (priorRow?.solution_tier_name ?? "") : filled.solution_tier_name,
                                  },
                                };
                              });
                            }}
                            disabled={pkgTiersForAutofill.length === 0}
                          >
                            <option value="">
                              {pkgTiersForAutofill.length === 0 ? "No other tiers" : "— Optional —"}
                            </option>
                            {pkgTiersForAutofill.map((t) => (
                              <option key={t.solution_tier_id} value={t.solution_tier_id}>
                                {t.solution_tier_id} — {t.solution_tier_name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <p style={{ ...muted, gridColumn: "1 / -1", margin: "0 0 0.5rem", fontSize: "0.8rem", lineHeight: 1.4 }}>
                          Copies vault tier text into this package overlay. Empty tier display name is filled from the
                          source; if you already typed a name in the overlay, it is left unchanged.
                        </p>
                      </>
                    }
                    styles={{ lbl, input, textarea, formGrid }}
                  />
                </div>

                <div className="admin-packages-builder__tier-section" style={{ ...tierSectionBox, marginTop: "1.25rem" }}>
                  <h3 className="admin-sb-subhead" style={sectionTitle}>
                    Section 2 — Tasks &amp; pricing (package overlay)
                  </h3>
                  <p style={{ ...muted, marginTop: 0, maxWidth: "62ch" }}>
                    Same task and pricing workflow as Solutions Builder: pick a task to edit, add rows, clone another
                    tier&apos;s vault checklist into package extras, then use <strong>Save package</strong> below to persist{" "}
                    <code style={{ fontSize: "0.85em" }}>task_overrides</code>, <code style={{ fontSize: "0.85em" }}>task_extensions</code>
                    , and <code style={{ fontSize: "0.85em" }}>pricing_overrides</code> on this link only.
                  </p>

                  {taskGroups.length > 0 ? (
                    <div
                      className="admin-packages-builder__tier-section"
                      style={{ ...tierSectionBox, marginTop: 12, marginBottom: 12 }}
                    >
                      <p style={{ ...sectionTitle, marginBottom: 6 }}>Add tasks from a task group</p>
                      <label style={{ ...lbl, maxWidth: 420, display: "block" }}>
                        <FieldCaption>Task group</FieldCaption>
                        <select
                          style={input}
                          value={taskGroupPick}
                          onChange={(e) => setTaskGroupPick(e.target.value)}
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
                          style={btnSm}
                          disabled={!taskGroupPick}
                          onClick={() => taskGroupPick && appendTaskGroup(pkgEditTierId, taskGroupPick)}
                        >
                          Apply to tier
                        </button>
                        <InlineActionFeedback model={pickInlineFeedback(pkgInlineFb, "pkg_apply_tg")} style={{ flex: "1 1 14rem", marginTop: 0 }} />
                      </div>
                    </div>
                  ) : null}

                  {pkgEditTierId && tiers.some((t) => t.solution_tier_id !== pkgEditTierId) ? (
                    <div
                      className="admin-packages-builder__tier-section"
                      style={{ ...tierSectionBox, marginTop: 12, marginBottom: 12 }}
                    >
                      <p style={{ ...sectionTitle, marginBottom: 6 }}>Add tasks from another tier&apos;s vault</p>
                      <p style={{ ...muted, marginTop: 0, marginBottom: 8, maxWidth: "58ch", fontSize: "0.86rem" }}>
                        Appends package-only extras that mirror vault tasks from the tier you choose (editable before save).
                      </p>
                      <label style={{ ...lbl, maxWidth: 440, display: "block" }}>
                        <FieldCaption>Source tier (vault)</FieldCaption>
                        <select
                          style={input}
                          value={pkgCopyTierId}
                          onChange={(e) => setPkgCopyTierId(e.target.value)}
                        >
                          <option value="">— Select a tier —</option>
                          {[...tiers]
                            .sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id))
                            .filter((t) => t.solution_tier_id !== pkgEditTierId)
                            .map((t) => {
                              const n = tasks.filter((k) => k.solution_tier_id === t.solution_tier_id).length;
                              return (
                                <option key={t.solution_tier_id} value={t.solution_tier_id} disabled={n === 0}>
                                  {t.solution_tier_id} — {t.solution_tier_name} (
                                  {solutionById.get(t.solution_id)?.solution_name ?? t.solution_id}) [{n} task(s)]
                                </option>
                              );
                            })}
                        </select>
                      </label>
                      <div className="admin-actions-row" style={{ marginTop: 8 }}>
                        <button
                          type="button"
                          style={btnSm}
                          disabled={!pkgCopyTierId.trim() || !pkgEditTierId}
                          onClick={() => pkgEditTierId && appendTierVaultFromOtherTier(pkgEditTierId)}
                        >
                          Add as package extras
                        </button>
                        <InlineActionFeedback model={pickInlineFeedback(pkgInlineFb, "pkg_copy_tier")} style={{ flex: "1 1 14rem", marginTop: 0 }} />
                      </div>
                    </div>
                  ) : null}

                  <h4 style={{ ...h2, marginTop: "1rem", fontSize: "0.88rem" }}>Tasks</h4>
                  <div className="admin-table-scroll">
                    <table className="admin-data-table" style={{ ...tbl, marginTop: 4 }}>
                      <thead>
                        <tr>
                          <th style={{ ...th, width: 48 }} aria-label="Drag to reorder" />
                          <th style={th}>Id</th>
                          <th style={th}>Name</th>
                          <th style={th} />
                        </tr>
                      </thead>
                      <TaskSortableList
                        itemIds={packageVaultDisplayRows.map((tr) => tr.task_id)}
                        disabled={
                          !!pkgTaskEditId || pkgTaskReorderBusy || packageVaultDisplayRows.length === 0
                        }
                        onReorder={applyPackageVaultOrderFromIds}
                      >
                        <tbody>
                          {packageVaultDisplayRows.map((tr) => (
                            <SortableTableRowTr
                              key={tr.task_id}
                              id={tr.task_id}
                              disabled={!!pkgTaskEditId || pkgTaskReorderBusy}
                              renderCells={(dragHandle) => [
                                <td style={td} key="drag">
                                  {dragHandle}
                                </td>,
                                <td style={td} key="id">
                                  <code style={{ fontSize: "0.85em" }}>{tr.task_id}</code>
                                </td>,
                                <td style={td} key="nm">
                                  {tr.task_name}
                                </td>,
                                <td style={td} key="act">
                                  <div className="admin-actions-row" style={{ marginTop: 0 }}>
                                    <button
                                      type="button"
                                      style={btnSm}
                                      onClick={() => startPkgEditTask(tr)}
                                      disabled={!!pkgTaskReorderBusy}
                                    >
                                      Edit
                                    </button>{" "}
                                    <button
                                      type="button"
                                      style={btnDangerSm}
                                      onClick={() => hideVaultTask(pkgEditTierId!, tr.task_id)}
                                      disabled={!!pkgTaskReorderBusy}
                                    >
                                      Hide
                                    </button>
                                  </div>
                                </td>,
                              ]}
                            />
                          ))}
                        </tbody>
                      </TaskSortableList>
                      <TaskSortableList
                        itemIds={packageExtraDisplayRows.map((tr) => tr.task_id)}
                        disabled={
                          !!pkgTaskEditId || pkgTaskReorderBusy || packageExtraDisplayRows.length === 0
                        }
                        onReorder={applyPackageExtraOrderFromIds}
                      >
                        <tbody>
                          {packageExtraDisplayRows.map((tr) => (
                            <SortableTableRowTr
                              key={tr.task_id}
                              id={tr.task_id}
                              disabled={!!pkgTaskEditId || pkgTaskReorderBusy}
                              renderCells={(dragHandle) => [
                                <td style={td} key="drag">
                                  {dragHandle}
                                </td>,
                                <td style={td} key="id">
                                  <code style={{ fontSize: "0.85em" }}>{tr.task_id}</code>
                                  <div style={{ fontSize: "0.72rem", color: "var(--muted)" }}>package-only</div>
                                </td>,
                                <td style={td} key="nm">
                                  {tr.task_name}
                                </td>,
                                <td style={td} key="act">
                                  <div className="admin-actions-row" style={{ marginTop: 0 }}>
                                    <button
                                      type="button"
                                      style={btnSm}
                                      onClick={() => startPkgEditTask(tr)}
                                      disabled={!!pkgTaskReorderBusy}
                                    >
                                      Edit
                                    </button>{" "}
                                    <button
                                      type="button"
                                      style={btnDangerSm}
                                      onClick={() => removeExtraTask(pkgEditTierId!, tr.task_id)}
                                      disabled={!!pkgTaskReorderBusy}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </td>,
                              ]}
                            />
                          ))}
                        </tbody>
                      </TaskSortableList>
                    </table>
                  </div>

                  {pkgTaskEditId ? (
                    <>
                      <h4 style={{ ...h2, marginTop: "1rem", fontSize: "0.88rem" }}>
                        Edit task <code style={{ fontSize: "0.9em" }}>{pkgTaskEditId}</code>
                      </h4>
                      <div className="admin-form-stack" style={formGrid}>
                        <label style={lbl}>
                          <FieldCaption>Task id</FieldCaption>
                          <input style={input} readOnly tabIndex={-1} value={pkgTaskEditId} />
                        </label>
                        <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                          <FieldCaption>Task name</FieldCaption>
                          <input
                            style={input}
                            list={taskNameDatalistId}
                            value={pkgKName}
                            onChange={(e) => onPkgEditTaskNameChange(e.target.value)}
                          />
                        </label>
                        <label style={lbl}>
                          <FieldCaption>Implementer</FieldCaption>
                          <TaskImplementerSelect
                            value={pkgKImpl}
                            options={distinctImplementerOptions}
                            inputStyle={input}
                            onChange={setPkgKImpl}
                          />
                        </label>
                        <label style={lbl}>
                          <FieldCaption>Time</FieldCaption>
                          <input style={input} value={pkgKTime} onChange={(e) => setPkgKTime(e.target.value)} />
                        </label>
                        <label style={lbl}>
                          <FieldCaption>Duration</FieldCaption>
                          <input style={input} value={pkgKDur} onChange={(e) => setPkgKDur(e.target.value)} />
                        </label>
                        <label style={lbl}>
                          <FieldCaption>Dependencies</FieldCaption>
                          <input style={input} value={pkgKDep} onChange={(e) => setPkgKDep(e.target.value)} />
                        </label>
                        <label style={{ ...lbl, gridColumn: "1 / -1" }}>
                          <FieldCaption>Notes</FieldCaption>
                          <input style={input} value={pkgKNotes} onChange={(e) => setPkgKNotes(e.target.value)} />
                        </label>
                      </div>
                      <div className="admin-actions-row" style={{ marginTop: 8 }}>
                        <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void savePkgTaskEdit()}>
                          Save changes
                        </button>
                        <button type="button" style={btn} onClick={clearPkgTaskEdit}>
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <h4 style={{ ...h2, marginTop: "1rem", fontSize: "0.88rem" }}>Add package-only tasks</h4>
                      <p style={{ ...muted, marginTop: 0 }}>
                        Add rows, then save all at once (same pattern as Solutions Builder). Quick add:{" "}
                        <button type="button" style={btnSm} onClick={() => addBlankExtraTask(pkgEditTierId)}>
                          Add one blank row
                        </button>
                      </p>
                      <div className="admin-table-scroll" style={{ marginTop: 8 }}>
                        <table className="admin-data-table" style={{ ...tbl, minWidth: 720 }}>
                          <thead>
                            <tr>
                              <th style={{ ...th, width: 48 }} aria-label="Drag to reorder" />
                              <th style={th}>Task name</th>
                              <th style={th}>Implementer</th>
                              <th style={th}>Time</th>
                              <th style={th}>Duration</th>
                              <th style={th}>Dependencies</th>
                              <th style={th}>Notes</th>
                              <th style={{ ...th, width: 140 }} />
                            </tr>
                          </thead>
                          <TaskSortableList
                            itemIds={pkgNewDrafts.map((d) => d.key)}
                            onReorder={reorderPkgNewDraftsByKeys}
                          >
                            <tbody>
                              {pkgNewDrafts.map((d) => (
                                <SortableTableRowTr
                                  key={d.key}
                                  id={d.key}
                                  renderCells={(dragHandle) => [
                                    <td style={td} key="drag">
                                      {dragHandle}
                                    </td>,
                                    <td style={td} key="nm">
                                      <input
                                        style={input}
                                        list={taskNameDatalistId}
                                        value={d.name}
                                        onChange={(e) => onPkgNewTaskNameChange(d.key, e.target.value)}
                                      />
                                    </td>,
                                    <td style={td} key="impl">
                                      <TaskImplementerSelect
                                        value={d.impl}
                                        options={distinctImplementerOptions}
                                        inputStyle={input}
                                        onChange={(v) =>
                                          setPkgNewDrafts((list) =>
                                            list.map((r) => (r.key === d.key ? { ...r, impl: v } : r))
                                          )
                                        }
                                      />
                                    </td>,
                                    <td style={td} key="time">
                                      <input
                                        style={input}
                                        value={d.time}
                                        onChange={(e) =>
                                          setPkgNewDrafts((list) =>
                                            list.map((r) =>
                                              r.key === d.key ? { ...r, time: e.target.value } : r
                                            )
                                          )
                                        }
                                      />
                                    </td>,
                                    <td style={td} key="dur">
                                      <input
                                        style={input}
                                        value={d.dur}
                                        onChange={(e) =>
                                          setPkgNewDrafts((list) =>
                                            list.map((r) =>
                                              r.key === d.key ? { ...r, dur: e.target.value } : r
                                            )
                                          )
                                        }
                                      />
                                    </td>,
                                    <td style={td} key="dep">
                                      <input
                                        style={input}
                                        value={d.dep}
                                        onChange={(e) =>
                                          setPkgNewDrafts((list) =>
                                            list.map((r) =>
                                              r.key === d.key ? { ...r, dep: e.target.value } : r
                                            )
                                          )
                                        }
                                      />
                                    </td>,
                                    <td style={td} key="notes">
                                      <input
                                        style={input}
                                        value={d.notes}
                                        onChange={(e) =>
                                          setPkgNewDrafts((list) =>
                                            list.map((r) =>
                                              r.key === d.key ? { ...r, notes: e.target.value } : r
                                            )
                                          )
                                        }
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
                                          onClick={() => duplicatePkgNewDraftRow(d.key)}
                                        >
                                          Copy
                                        </button>
                                        <button
                                          type="button"
                                          style={btnDangerSm}
                                          onClick={() =>
                                            setPkgNewDrafts((list) =>
                                              list.length <= 1 ? list : list.filter((r) => r.key !== d.key)
                                            )
                                          }
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
                        <button type="button" style={btnSm} onClick={() => setPkgNewDrafts((l) => [...l, newPkgDraftTaskRow()])}>
                          Add task row
                        </button>
                      </div>
                      <div className="admin-actions-row" style={{ marginTop: 10 }}>
                        <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void savePkgNewTasksBulk()}>
                          Save all new tasks
                        </button>
                      </div>
                    </>
                  )}

                  {packagePricingSeed ? (
                    <PricingPanel
                      key={`pkg-pricing-${pkgEditId}-${pkgEditTierId}`}
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
                      tierIdsInScope={[pkgEditTierId]}
                      updateAutoLoadTierId={pkgEditTierId}
                      taskDrivenHours={implementerHourGroups.length > 0}
                      taskHourRollup={taskHourRollupForPackage}
                      persistTarget="package"
                      packagePricingSeed={packagePricingSeed}
                      onPackagePricingDraft={onPackagePricingDraft}
                    />
                  ) : null}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="admin-actions-row" style={{ marginTop: "0.75rem" }}>
          {subTab === "create" ? (
            <>
              <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void saveCreate()}>
                Create package
              </button>
              <button type="button" style={btn} onClick={startNewCreate}>
                Clear form
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="admin-btn-primary"
                style={btnPrimary}
                disabled={!pkgEditId}
                onClick={() => void saveUpdate()}
              >
                Save package
              </button>
              <button type="button" style={btn} disabled={!pkgEditId} onClick={() => pkgEditId && loadPackageDrafts(pkgEditId)}>
                Reload from server
              </button>
              <button type="button" style={btn} onClick={startNewCreate}>
                Clear selection
              </button>
              <button type="button" style={btnDangerSm} disabled={!pkgEditId} onClick={() => void removeCurrentPackage()}>
                Delete package
              </button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
