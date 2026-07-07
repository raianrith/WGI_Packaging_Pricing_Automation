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
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import {
  applyUniformHourDiscount,
  buildPackageAggregateMetadataSeed,
  buildPackageAggregatePricingSeed,
  computePackageAggregatePricingOverrides,
  stripRebuildablePricingOverrideKeys,
} from "../lib/packageAggregatePricing";
import {
  anchorTierForPackage,
  deriveCombinedTasksFromLegacyLinks,
  emptyCombinedTasksState,
  packageCombinedTasksToLinkPayloads,
  parsePackageCombinedTasks,
  patchKeyForVaultTask,
  persistVaultOrdersFromUnifiedState,
  reconcileCombinedTasksForTierSelection,
  sanitizePackageCombinedTasksForDb,
  unifiedTasksToRows,
  type PackageCombinedTasksState,
  type PackageUnifiedOrderEntry,
} from "../lib/packageCombinedTasks";
import {
  parsePricingOverrides,
  pricingToFormStrings,
  sanitizePricingOverridesForDb,
} from "../lib/packagePricingTaskOverrides";
import type { TierPricingMathConfig } from "../lib/tierPricingMath";
import { newPackageTaskId } from "../lib/packageTaskLayout";
import { applyPackageTierMembership } from "../lib/packageTierLinkPersistence";
import {
  adjustTierQuantity,
  emptyTierQuantities,
  tierIdsFromQuantities,
  tierQuantitiesFromLinks,
  totalTierLineCount,
  type PackageTierQuantities,
} from "../lib/packageTierQuantities";
import { buildImplementerToGroupMap, rollUpTaskTimesByPricingGroup } from "../lib/taskHoursRollup";
import { PricingPanel } from "./PricingPanel";
import { SortableTableRowTr, TaskSortableList } from "./TaskTableSortable";
import { TaskImplementerSelect } from "./TaskImplementerSelect";
import {
  emptyPackageDetails,
  packageRowToDetailsValues,
  PackageDetailsFormBlock,
  type PackageDetailFieldKey,
} from "./PackageDetailsFormBlock";
import type {
  ImplementerHourGroupRow,
  Package,
  PackageExtraTaskRow,
  PackagePricingOverrides,
  PackageSolutionTier,
  PackageTaskOverride,
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

function parseDiscountPct(raw: string): number {
  const n = Number(String(raw).trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(100, n);
}

function packageDetailsToDbColumns(
  details: Record<PackageDetailFieldKey, string>
): Partial<Record<PackageDetailFieldKey, string | null>> {
  const o: Partial<Record<PackageDetailFieldKey, string | null>> = {};
  (Object.keys(details) as PackageDetailFieldKey[]).forEach((k) => {
    const t = (details[k] ?? "").trim();
    o[k] = t ? t : null;
  });
  return o;
}

function buildPackageUpsertRow(args: {
  packageId: string;
  name: string;
  today: string;
  createDate?: string;
  details: Record<PackageDetailFieldKey, string>;
  hourPct: number;
  sellPct: number;
  pricingOverridesSparse: PackagePricingOverrides;
  combinedTasks: PackageCombinedTasksState;
}): Record<string, unknown> {
  const cols = packageDetailsToDbColumns(args.details);
  const pr = args.pricingOverridesSparse;
  const hasPricing = pr && Object.keys(pr).length > 0;
  return {
    package_id: args.packageId,
    package_name: args.name,
    ...(args.createDate ? { package_create_date: args.createDate } : {}),
    package_modified_date: args.today,
    ...cols,
    package_hour_discount_pct: args.hourPct,
    package_sell_discount_pct: args.sellPct,
    package_pricing_overrides: hasPricing ? sanitizePricingOverridesForDb(pr) : null,
    package_combined_tasks: sanitizePackageCombinedTasksForDb(args.combinedTasks),
  };
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
  /** Hub modal: pre-select package and hide chrome (title, intro, package picker). */
  embedded?: boolean;
  initialEditPackageId?: string | null;
  onPackageDeleted?: () => void;
};

export function PackagesBuilderPanel({
  subTab,
  packages,
  solutions,
  tiers,
  tasks,
  tierPricing,
  packageTiers,
  taskGroups: _taskGroups,
  taskGroupLines: _taskGroupLines,
  implementerHourGroups,
  tierPricingMathConfig,
  onSaved,
  setOpErr,
  setOpOk,
  logAudit,
  styles: s,
  embedded = false,
  initialEditPackageId = null,
  onPackageDeleted,
}: PackagesBuilderPanelProps) {
  const { panel, formGrid, lbl, input, textarea, btn, btnPrimary, btnDangerSm, btnSm, tbl, th, td, h2, muted } = s;

  const [nameField, setNameField] = useState("");
  const [selectedTierQty, setSelectedTierQty] = useState<PackageTierQuantities>(() => emptyTierQuantities());
  const [tierSearch, setTierSearch] = useState("");

  const [pkgEditId, setPkgEditId] = useState<string | null>(null);
  const [packageDetails, setPackageDetails] =
    useState<Record<PackageDetailFieldKey, string>>(emptyPackageDetails);
  const [hourDiscountPctStr, setHourDiscountPctStr] = useState("0");
  const [storedPackagePricingOverrides, setStoredPackagePricingOverrides] = useState<PackagePricingOverrides | null>(
    null
  );
  const taskNameDatalistId = useId();
  const [pkgNewDrafts, setPkgNewDrafts] = useState<PkgDraftTaskRow[]>([newPkgDraftTaskRow()]);
  const [combinedTasks, setCombinedTasks] = useState<PackageCombinedTasksState>(emptyCombinedTasksState());
  const aggregatePricingDraftRef = useRef<SolutionTierPricing | null>(null);
  const [modelSellBeforeDiscount, setModelSellBeforeDiscount] = useState<number | null>(null);

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

  const loadPackageDrafts = useCallback(
    (packageId: string) => {
      const pkg = packages.find((p) => p.package_id === packageId);
      const links = packageTiersRef.current.filter((r) => r.package_id === packageId);
      setSelectedTierQty(tierQuantitiesFromLinks(links));

      setPackageDetails(packageRowToDetailsValues(pkg ?? null));
      const h = pkg?.package_hour_discount_pct;
      setHourDiscountPctStr(h != null && Number.isFinite(Number(h)) ? String(Number(h)) : "0");
      setStoredPackagePricingOverrides(parsePricingOverrides(pkg?.package_pricing_overrides ?? null));

      const tierIds = tierIdsFromQuantities(tierQuantitiesFromLinks(links));
      const linksByTierId = new Map<string, PackageSolutionTier>();
      for (const l of links) linksByTierId.set(l.solution_tier_id, l);

      const parsed = parsePackageCombinedTasks(pkg?.package_combined_tasks);
      const nextCombined =
        parsed ?? deriveCombinedTasksFromLegacyLinks(tierIds, tasksRef.current, linksByTierId);
      setCombinedTasks(nextCombined);

      aggregatePricingDraftRef.current = null;
    },
    [packages]
  );

  useEffect(() => {
    if (!embedded || subTab !== "update" || !initialEditPackageId) return;
    setPkgEditId(initialEditPackageId);
    const p = packages.find((x) => x.package_id === initialEditPackageId);
    setNameField(p?.package_name ?? "");
  }, [embedded, subTab, initialEditPackageId, packages]);

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

  useEffect(() => {
    setCombinedTasks((prev) =>
      reconcileCombinedTasksForTierSelection(prev, selectedTierQty, tasksRef.current)
    );
  }, [selectedTierQty, tasks]);

  const changeTierQty = (tierId: string, delta: number) => {
    setSelectedTierQty((prev) => adjustTierQuantity(prev, tierId, delta, null).quantities);
  };

  const selectedTierIds = useMemo(() => tierIdsFromQuantities(selectedTierQty), [selectedTierQty]);
  const selectedTierLineCount = totalTierLineCount(selectedTierQty);

  const sparseOverridesForSave = useCallback(
    (wanted: string[], hourPct: number, packageIdForLinks: string | null): PackagePricingOverrides => {
      const linksByTierId = new Map<string, PackageSolutionTier>();
      if (packageIdForLinks) {
        for (const l of packageTiers) {
          if (l.package_id === packageIdForLinks) linksByTierId.set(l.solution_tier_id, l);
        }
      }
      const fallbackSeed = buildPackageAggregatePricingSeed({
        tierIds: wanted,
        pricingRows: tierPricing,
        linksByTierId,
        hourDiscountPct: hourPct,
        packagePricingOverrides: storedPackagePricingOverrides,
      });
      const row = aggregatePricingDraftRef.current;
      const formStrings = pricingToFormStrings(row ?? fallbackSeed);
      const raw = computePackageAggregatePricingOverrides({
        tierIds: wanted,
        pricingRows: tierPricing,
        linksByTierId,
        hourDiscountPct: hourPct,
        form: formStrings,
      });
      return stripRebuildablePricingOverrideKeys(raw);
    },
    [packageTiers, tierPricing, storedPackagePricingOverrides]
  );

  const packagePricingMetadataSeed = useMemo(() => {
    const wanted = [...selectedTierIds].sort(sortId);
    if (wanted.length === 0) return null;
    return buildPackageAggregateMetadataSeed(storedPackagePricingOverrides);
  }, [selectedTierIds, storedPackagePricingOverrides]);

  useEffect(() => {
    const s = packagePricingMetadataSeed;
    if (!s) {
      setModelSellBeforeDiscount(null);
      return;
    }
    setModelSellBeforeDiscount(
      s.sell_price != null && Number.isFinite(Number(s.sell_price)) ? Number(s.sell_price) : null
    );
  }, [packagePricingMetadataSeed]);

  const startNewCreate = () => {
    setNameField("");
    setSelectedTierQty(emptyTierQuantities());
    setTierSearch("");
    setPkgEditId(null);
    setPackageDetails(emptyPackageDetails());
    setCombinedTasks(emptyCombinedTasksState());
    setHourDiscountPctStr("0");
    setStoredPackagePricingOverrides(null);
    aggregatePricingDraftRef.current = null;
    setModelSellBeforeDiscount(null);
    setPkgNewDrafts([newPkgDraftTaskRow()]);
  };

  const saveCreate = async () => {
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    const today = todayISODate();
    const wanted = [...selectedTierIds].sort(sortId);
    const hourPct = parseDiscountPct(hourDiscountPctStr);
    const sellPct = 0;

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
    const sparse = sparseOverridesForSave(wanted, hourPct, null);
    const row = buildPackageUpsertRow({
      packageId: newId,
      name,
      today,
      createDate: today,
      details: packageDetails,
      hourPct,
      sellPct,
      pricingOverridesSparse: sparse,
      combinedTasks,
    });

    const { error } = await client.from("packages").insert(row);
    if (error) {
      setOpErr(friendlyMutationMessage(error.message));
      return;
    }

    const sortErr = await persistVaultOrdersFromUnifiedState(client, combinedTasks, wanted, tasks);
    if (sortErr) {
      setOpErr(sortErr);
      await onSaved();
      return;
    }

    const payloadByTier = packageCombinedTasksToLinkPayloads(combinedTasks, wanted, tasks);
    const assignErr = await applyPackageTierMembership(client, newId, selectedTierQty, payloadByTier);
    if (assignErr) {
      setOpErr(`${assignErr} (Package ${newId} was created; fix links if needed.)`);
      await onSaved();
      return;
    }

    await logAudit(client, {
      entityType: "packages",
      entityId: newId,
      action: "insert",
      before: null,
      after: { ...(rowJson(row as unknown as Package) as Record<string, unknown>), solution_tier_ids: wanted },
    });
    setOpOk(`Package ${newId} created with ${selectedTierLineCount} tier line(s).`);
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
    const hourPct = parseDiscountPct(hourDiscountPctStr);
    const sellPct = 0;

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
    const sparse = sparseOverridesForSave(wanted, hourPct, pkgEditId);
    const rowPatch = buildPackageUpsertRow({
      packageId: pkgEditId,
      name,
      today,
      details: packageDetails,
      hourPct,
      sellPct,
      pricingOverridesSparse: sparse,
      combinedTasks,
    });
    const patch = { ...rowPatch } as Record<string, unknown>;
    delete patch.package_id;
    delete patch.package_create_date;

    const { error: uerr } = await client.from("packages").update(patch).eq("package_id", pkgEditId);
    if (uerr) {
      setOpErr(friendlyMutationMessage(uerr.message));
      return;
    }

    const sortErr = await persistVaultOrdersFromUnifiedState(client, combinedTasks, wanted, tasks);
    if (sortErr) {
      setOpErr(sortErr);
      await onSaved();
      return;
    }

    const payloadByTier = packageCombinedTasksToLinkPayloads(combinedTasks, wanted, tasks);
    const assignErr = await applyPackageTierMembership(client, pkgEditId, selectedTierQty, payloadByTier);
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
    if (embedded) onPackageDeleted?.();
  };

  const onPackagePricingDraft = useCallback((row: SolutionTierPricing) => {
    aggregatePricingDraftRef.current = row;
    setModelSellBeforeDiscount(
      row.sell_price != null && Number.isFinite(Number(row.sell_price)) ? Number(row.sell_price) : null
    );
  }, []);

  const anchorTierIdForPackage = useMemo(
    () => anchorTierForPackage([...selectedTierIds].sort(sortId)),
    [selectedTierIds]
  );

  const packageExtraIdSet = useMemo(
    () => new Set(combinedTasks.extras.map((e) => e.package_task_id)),
    [combinedTasks.extras]
  );

  const unifiedKeyForRow = useCallback(
    (tr: TaskRow) =>
      packageExtraIdSet.has(tr.task_id) ? `extra|${tr.task_id}` : `vault|${tr.solution_tier_id}|${tr.task_id}`,
    [packageExtraIdSet]
  );

  function parseUnifiedOrderKey(raw: string): PackageUnifiedOrderEntry | null {
    const i = raw.indexOf("|");
    if (i < 0) return null;
    const kind = raw.slice(0, i);
    const rest = raw.slice(i + 1);
    if (kind === "extra" && rest) return { k: "extra", package_task_id: rest };
    if (kind === "vault") {
      const j = rest.indexOf("|");
      if (j <= 0) return null;
      const tid = rest.slice(0, j);
      const taskId = rest.slice(j + 1);
      if (!tid || !taskId) return null;
      return { k: "vault", solution_tier_id: tid, task_id: taskId };
    }
    return null;
  }

  const unifiedDisplayRowsBase = useMemo(() => {
    if (!anchorTierIdForPackage) return [] as TaskRow[];
    return unifiedTasksToRows(combinedTasks, tasks, anchorTierIdForPackage);
  }, [combinedTasks, tasks, anchorTierIdForPackage]);

  const implementerToGroup = useMemo(
    () => buildImplementerToGroupMap(implementerHourGroups),
    [implementerHourGroups]
  );

  const packageHoursFromTasksPrediscount = useMemo(() => {
    if (!anchorTierIdForPackage) return null;
    return rollUpTaskTimesByPricingGroup(unifiedDisplayRowsBase, implementerToGroup);
  }, [unifiedDisplayRowsBase, anchorTierIdForPackage, implementerToGroup]);

  const packageTaskHourRollupDiscounted = useMemo(() => {
    if (!packageHoursFromTasksPrediscount) return null;
    return applyUniformHourDiscount(
      packageHoursFromTasksPrediscount,
      parseDiscountPct(hourDiscountPctStr)
    );
  }, [packageHoursFromTasksPrediscount, hourDiscountPctStr]);

  const packageTaskDrivenHours = Boolean(anchorTierIdForPackage && selectedTierLineCount > 0);

  const applyUnifiedPackageOrderFromIds = useCallback(
    (orderedIds: UniqueIdentifier[]) => {
      const next: PackageUnifiedOrderEntry[] = [];
      for (const id of orderedIds) {
        const e = parseUnifiedOrderKey(String(id));
        if (e) next.push(e);
      }
      setCombinedTasks((prev) => ({ ...prev, order: next }));
      setOpOk("Task order updated (save package to persist).");
    },
    [setOpOk]
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
    return [...s].sort((a, b) => a.localeCompare(b));
  }, [tasks]);

  const patchVaultTask = useCallback((tierId: string, taskId: string, partial: PackageTaskOverride) => {
    const pk = patchKeyForVaultTask(tierId, taskId);
    setCombinedTasks((prev) => ({
      ...prev,
      task_patches: { ...prev.task_patches, [pk]: { ...prev.task_patches[pk], ...partial } },
    }));
  }, []);

  const patchUnifiedExtra = useCallback((packageTaskId: string, partial: Partial<PackageExtraTaskRow>) => {
    setCombinedTasks((prev) => ({
      ...prev,
      extras: prev.extras.map((e) => (e.package_task_id === packageTaskId ? { ...e, ...partial } : e)),
    }));
  }, []);

  const onUnifiedVaultNameChange = useCallback(
    (tr: TaskRow, value: string) => {
      const m = firstTaskMatchingName(tasks, value);
      if (m) {
        patchVaultTask(tr.solution_tier_id, tr.task_id, {
          task_name: value,
          task_implementer: m.task_implementer ?? null,
          task_time: m.task_time ?? null,
          task_duration: m.task_duration ?? null,
          task_dependencies: m.task_dependencies ?? null,
          task_notes: m.task_notes ?? null,
        });
      } else {
        patchVaultTask(tr.solution_tier_id, tr.task_id, { task_name: value });
      }
    },
    [tasks, patchVaultTask]
  );
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



  const savePkgNewTasksBulk = useCallback(() => {
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
    setCombinedTasks((prev) => ({
      ...prev,
      extras: [...prev.extras, ...built],
      order: [...prev.order, ...built.map((b) => ({ k: "extra" as const, package_task_id: b.package_task_id }))],
    }));
    setPkgNewDrafts([newPkgDraftTaskRow()]);
    setOpOk(`Added ${rows.length} package-only task row(s). Save the package to persist.`);
  }, [pkgNewDrafts, setOpErr, setOpOk]);

  const hideUnifiedVaultTask = useCallback((tierId: string, taskId: string) => {
    setCombinedTasks((prev) => ({
      ...prev,
      order: prev.order.filter(
        (e) => !(e.k === "vault" && e.solution_tier_id === tierId && e.task_id === taskId)
      ),
      hidden_vault: [...prev.hidden_vault, { solution_tier_id: tierId, task_id: taskId }],
    }));
  }, []);

  const addBlankUnifiedExtraTask = useCallback(() => {
    const id = newPackageTaskId();
    const row: PackageExtraTaskRow = {
      package_task_id: id,
      task_name: "New package task",
      task_implementer: null,
      task_time: null,
      task_duration: null,
      task_dependencies: null,
      task_notes: null,
    };
    setCombinedTasks((prev) => ({
      ...prev,
      extras: [...prev.extras, row],
      order: [...prev.order, { k: "extra", package_task_id: id }],
    }));
  }, []);

  const removeUnifiedExtraTask = useCallback((packageTaskId: string) => {
    setCombinedTasks((prev) => ({
      ...prev,
      extras: prev.extras.filter((e) => e.package_task_id !== packageTaskId),
      order: prev.order.filter((e) => !(e.k === "extra" && e.package_task_id === packageTaskId)),
    }));
  }, []);

  const onPackageDetailChange = useCallback((key: PackageDetailFieldKey, v: string) => {
    setPackageDetails((prev) => ({ ...prev, [key]: v }));
  }, []);

  const tierPickerIntro =
    subTab === "create"
      ? "Set quantity for each solution component to include. You can add the same component multiple times (e.g. 3× Customer Interviews - Basic). The same component can appear in multiple packages."
      : "Manage tier membership and quantities for this package. Set quantity to 0 to remove a tier link on save.";

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
              <th style={{ ...th, width: "6.5rem" }}>Qty</th>
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
                const qty = selectedTierQty[t.solution_tier_id] ?? 0;
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
                      <div className="agency-pkg-wizard__qty">
                        <button
                          type="button"
                          className="agency-pkg-wizard__qty-btn"
                          aria-label={`Decrease quantity for ${t.solution_tier_name}`}
                          disabled={qty <= 0}
                          onClick={() => changeTierQty(t.solution_tier_id, -1)}
                        >
                          −
                        </button>
                        <span className="agency-pkg-wizard__qty-value">{qty}</span>
                        <button
                          type="button"
                          className="agency-pkg-wizard__qty-btn"
                          aria-label={`Increase quantity for ${t.solution_tier_name}`}
                          onClick={() => changeTierQty(t.solution_tier_id, 1)}
                        >
                          +
                        </button>
                      </div>
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


  const showPackageWorkbench =
    (subTab === "create" && selectedTierLineCount > 0) || (subTab === "update" && Boolean(pkgEditId));

  const sellPctApplied = 0;
  const sellAfterPackageDiscount =
    modelSellBeforeDiscount != null && Number.isFinite(modelSellBeforeDiscount)
      ? modelSellBeforeDiscount * (1 - sellPctApplied / 100)
      : null;

  const panelStyle = embedded ? { ...panel, marginBottom: 0, padding: 0 } : panel;

  return (
    <section
      className={
        embedded
          ? "admin-panel admin-panel--editor admin-packages-builder admin-packages-builder--embedded"
          : "admin-panel admin-panel--editor admin-packages-builder"
      }
      style={panelStyle}
    >
      <div className="admin-editor-layout">
        {!embedded ? (
          <>
            <h2 style={h2}>Package Builder</h2>
            {subTab === "create" ? (
              <p className="admin-intro" style={muted}>
                Name the bundle, pick solution tiers, then fill in <strong>package-level</strong> copy, reorder or remove
                vault tasks, add package-only rows, tune combined pricing (hour buckets roll up from those tasks, then
                discounts), and create once. Vault tier descriptions are edited only in Solutions Builder. Build-a-Package
                ceilings live under <strong>Configurable Package</strong>.
              </p>
            ) : (
              <p className="admin-intro" style={muted}>
                Packages store narrative and aggregate pricing on the <strong>packages</strong> row; tier links carry task
                visibility and package-only extras. Pricing hour buckets roll up from the tasks you list below (then package
                hour discount %), before the usual sell math (plus optional sell discount %). Vault tier narratives are not
                editable here.
              </p>
            )}
          </>
        ) : null}

        {subTab === "update" && !embedded ? (
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
        ) : null}

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

        {showPackageWorkbench ? (
          <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "1rem" }}>
            <PackageDetailsFormBlock
              packageIdReadonly={subTab === "update" ? pkgEditId ?? undefined : undefined}
              values={packageDetails}
              onChange={onPackageDetailChange}
              styles={{ lbl, input, textarea, formGrid }}
            />

            <div
              className="admin-packages-builder__sell-banner"
              style={{
                padding: "0.65rem 0.75rem",
                borderRadius: 10,
                background: "color-mix(in srgb, var(--accent) 10%, transparent)",
                border: "1px solid color-mix(in srgb, var(--accent) 22%, transparent)",
                marginTop: 12,
                marginBottom: 12,
              }}
            >
              <p style={{ margin: "0 0 0.35rem", fontWeight: 700, fontSize: "0.9rem" }}>Package modeled sell price</p>
              <p style={{ margin: 0, fontSize: "0.88rem", color: "var(--text)" }}>
                Modeled sell (pricing panel): <strong>{fmtMoney(modelSellBeforeDiscount)}</strong>
                {sellPctApplied > 0 ? (
                  <>
                    {" · "}
                    After {sellPctApplied}% package sell discount: <strong>{fmtMoney(sellAfterPackageDiscount)}</strong>
                  </>
                ) : (
                  <>
                    {" · "}
                    Set <strong>sell price discount %</strong> in <strong>Tier pricing → Sell calculation</strong> below for
                    a net price preview.
                  </>
                )}
              </p>
            </div>

            <datalist id={taskNameDatalistId}>
              {sortedTaskNamesForDatalist.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>

            <div className="admin-packages-builder__tier-section" style={{ ...tierSectionBox, marginTop: 12 }}>
              <h3 className="admin-sb-subhead" style={sectionTitle}>
                Tasks inside this package
              </h3>
              <p style={{ ...muted, marginTop: 0, maxWidth: "68ch" }}>
                Combined vault tasks from the tiers you checked, in one list. Inline edits adjust how each task appears in{" "}
                <strong>this package only</strong> (tier vault checklists elsewhere are unchanged): name, assignee/implementer,
                and hours feed the package hour rollup; drag to reorder, hide vault lines per package, or add package-only
                rows below.
              </p>
              <div className="admin-table-scroll">
                <table className="admin-data-table" style={{ ...tbl, marginTop: 8, minWidth: "min(100%, 56rem)" }}>
                  <thead>
                    <tr>
                      <th style={{ ...th, width: 48 }} aria-label="Drag to reorder" />
                      <th style={th}>Tier</th>
                      <th style={th}>Task id</th>
                      <th style={th}>Name</th>
                      <th style={th}>Implementer</th>
                      <th style={{ ...th, whiteSpace: "nowrap" }}>Hours</th>
                      <th style={{ ...th, width: 120 }} aria-label="Row actions" />
                    </tr>
                  </thead>
                  <TaskSortableList
                    itemIds={unifiedDisplayRowsBase.map((tr) => unifiedKeyForRow(tr))}
                    disabled={unifiedDisplayRowsBase.length === 0}
                    onReorder={applyUnifiedPackageOrderFromIds}
                  >
                    <tbody>
                      {unifiedDisplayRowsBase.map((tr) => {
                        const isExtra = packageExtraIdSet.has(tr.task_id);
                        const timeStr =
                          tr.task_time != null && Number.isFinite(Number(tr.task_time)) ? String(tr.task_time) : "";
                        return (
                          <SortableTableRowTr
                            key={unifiedKeyForRow(tr)}
                            id={unifiedKeyForRow(tr)}
                            disabled={false}
                            renderCells={(dragHandle) => [
                              <td style={td} key="drag">
                                {dragHandle}
                              </td>,
                              <td style={td} key="tier">
                                {isExtra ? (
                                  <span style={{ color: "var(--muted)" }}>package-only</span>
                                ) : (
                                  <span>
                                    {(tiers.find((x) => x.solution_tier_id === tr.solution_tier_id)?.solution_tier_name ??
                                      tr.solution_tier_id) || "—"}
                                  </span>
                                )}
                              </td>,
                              <td style={td} key="id">
                                <code style={{ fontSize: "0.85em" }}>{tr.task_id}</code>
                              </td>,
                              <td style={td} key="nm">
                                <input
                                  style={{ ...input, minWidth: "10rem", width: "100%" }}
                                  list={taskNameDatalistId}
                                  aria-label={`Task name for ${tr.task_id}`}
                                  value={tr.task_name}
                                  onChange={(e) =>
                                    isExtra
                                      ? patchUnifiedExtra(tr.task_id, { task_name: e.target.value })
                                      : onUnifiedVaultNameChange(tr, e.target.value)
                                  }
                                />
                              </td>,
                              <td style={td} key="impl">
                                <TaskImplementerSelect
                                  value={tr.task_implementer ?? ""}
                                  options={distinctImplementerOptions}
                                  inputStyle={input}
                                  onChange={(v) => {
                                    const impl = v.trim() || null;
                                    if (isExtra) patchUnifiedExtra(tr.task_id, { task_implementer: impl });
                                    else patchVaultTask(tr.solution_tier_id, tr.task_id, { task_implementer: impl });
                                  }}
                                />
                              </td>,
                              <td style={td} key="tm">
                                <input
                                  style={{ ...input, width: "4.75rem", minWidth: "4rem" }}
                                  aria-label={`Hours for ${tr.task_id}`}
                                  inputMode="decimal"
                                  value={timeStr}
                                  onChange={(e) => {
                                    const t = optNum(e.target.value);
                                    if (isExtra) patchUnifiedExtra(tr.task_id, { task_time: t });
                                    else patchVaultTask(tr.solution_tier_id, tr.task_id, { task_time: t });
                                  }}
                                />
                              </td>,
                              <td style={td} key="act">
                                <div className="admin-actions-row" style={{ marginTop: 0 }}>
                                  {isExtra ? (
                                    <button
                                      type="button"
                                      style={btnDangerSm}
                                      onClick={() => removeUnifiedExtraTask(tr.task_id)}
                                    >
                                      Remove
                                    </button>
                                  ) : (
                                    <button
                                      type="button"
                                      style={btnDangerSm}
                                      onClick={() => hideUnifiedVaultTask(tr.solution_tier_id, tr.task_id)}
                                    >
                                      Remove from package
                                    </button>
                                  )}
                                </div>
                              </td>,
                            ]}
                          />
                        );
                      })}
                    </tbody>
                  </TaskSortableList>
                </table>
              </div>

              <h4 style={{ ...h2, marginTop: "1rem", fontSize: "0.88rem" }}>Add package-only tasks</h4>
              <p style={{ ...muted, marginTop: 0 }}>
                Draft rows below, save them into this package&apos;s checklist, then use <strong>Create package</strong> or{" "}
                <strong>Save package</strong>.
              </p>
              <p style={{ ...muted, marginTop: 0 }}>
                Quick add:{" "}
                <button type="button" style={btnSm} onClick={addBlankUnifiedExtraTask}>
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
                  <TaskSortableList itemIds={pkgNewDrafts.map((d) => d.key)} onReorder={reorderPkgNewDraftsByKeys}>
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
                                    list.map((r) => (r.key === d.key ? { ...r, time: e.target.value } : r))
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
                                    list.map((r) => (r.key === d.key ? { ...r, dur: e.target.value } : r))
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
                                    list.map((r) => (r.key === d.key ? { ...r, dep: e.target.value } : r))
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
                                    list.map((r) => (r.key === d.key ? { ...r, notes: e.target.value } : r))
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
                                <button type="button" style={btnSm} onClick={() => duplicatePkgNewDraftRow(d.key)}>
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
                <button
                  type="button"
                  className="admin-btn-primary"
                  style={btnPrimary}
                  onClick={() => void savePkgNewTasksBulk()}
                >
                  Save all new tasks into package checklist
                </button>
              </div>
            </div>

            {packagePricingMetadataSeed ? (
              <PricingPanel
                key={`pkg-pricing-${pkgEditId ?? "draft"}-${[...selectedTierIds].sort(sortId).join("|")}`}
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
                tierIdsInScope={[...selectedTierIds].sort(sortId)}
                persistTarget="package"
                packagePricingSeed={packagePricingMetadataSeed}
                taskDrivenHours={packageTaskDrivenHours}
                taskHourRollup={packageTaskHourRollupDiscounted}
                onPackagePricingDraft={onPackagePricingDraft}
                packageHourDiscountPct={hourDiscountPctStr}
                packageDiscountsReadOnly
                packageSellDiscountPct="0"
              />
            ) : null}
          </div>
        ) : null}



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
