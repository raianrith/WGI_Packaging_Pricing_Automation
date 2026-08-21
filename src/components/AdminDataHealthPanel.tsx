import { useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Link } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../lib/audit";
import {
  ignoreHealthTier,
  listHealthIgnoredTier,
  unignoreHealthTier,
} from "../lib/adminHealthIgnore";
import { getSupabase } from "../lib/supabase";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { buildImplementerToGroupMap, rollUpTaskTimesByPricingGroup } from "../lib/taskHoursRollup";
import { syncTierPricingFromTasks } from "../lib/syncTierPricingFromTasks";
import type { TierPricingMathConfig } from "../lib/tierPricingMath";
import { vaultPathForTier } from "../lib/vaultTierHealth";
import type {
  AuditLogRow,
  ImplementerHourGroupRow,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskRow,
} from "../types";

type LogAudit = (
  client: SupabaseClient,
  p: Parameters<typeof insertAuditLog>[1]
) => Promise<void>;

type HealthIssueKind =
  | "pricing_no_tasks"
  | "tasks_no_pricing"
  | "hours_mismatch"
  | "unmapped_implementer";

type HealthIssue = {
  kind: HealthIssueKind;
  tierId: string;
  tierName: string;
  solutionName: string;
  detail: string;
};

type UpdateAttribution = {
  who: string;
  when: string;
};

function auditWho(row: AuditLogRow): string {
  const email = (row.changed_by_email ?? "").trim();
  if (email) return email;
  const uid = (row.changed_by_user_id ?? "").trim();
  if (uid) return uid.slice(0, 8) + "…";
  return "Unknown";
}

function formatAuditWhen(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function jsonTierId(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  const v = data.solution_tier_id;
  if (typeof v === "string" && v.trim()) return v.trim();
  return null;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function hoursClose(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.05;
}

export function AdminDataHealthPanel({
  solutions,
  tiers,
  tasks,
  tierPricing,
  auditLog = [],
  implementerHourGroups,
  tierPricingMathConfig,
  onRefresh,
  setOpErr,
  setOpOk,
  logAudit,
  panel,
  h2,
  muted,
  btn,
  btnPrimary,
  btnSm,
  tbl,
  th,
  td,
}: {
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  tierPricing: SolutionTierPricing[];
  auditLog?: AuditLogRow[];
  implementerHourGroups: ImplementerHourGroupRow[];
  tierPricingMathConfig: TierPricingMathConfig;
  onRefresh: () => Promise<void>;
  setOpErr: (s: string | null) => void;
  setOpOk: (s: string | null) => void;
  logAudit: LogAudit;
  panel: CSSProperties;
  h2: CSSProperties;
  muted: CSSProperties;
  btn: CSSProperties;
  btnPrimary: CSSProperties;
  btnSm: CSSProperties;
  tbl: CSSProperties;
  th: CSSProperties;
  td: CSSProperties;
}) {
  const [busyTierId, setBusyTierId] = useState<string | null>(null);
  const [busyAll, setBusyAll] = useState(false);
  const [filter, setFilter] = useState<HealthIssueKind | "all">("all");
  const [ignoreTick, setIgnoreTick] = useState(0);
  const [showIgnored, setShowIgnored] = useState(false);

  const solById = useMemo(() => new Map(solutions.map((s) => [s.solution_id, s])), [solutions]);
  const tierById = useMemo(() => new Map(tiers.map((t) => [t.solution_tier_id, t])), [tiers]);
  const pricingByTier = useMemo(
    () => new Map(tierPricing.map((p) => [p.solution_tier_id, p])),
    [tierPricing]
  );
  const tasksByTier = useMemo(() => {
    const m = new Map<string, TaskRow[]>();
    for (const t of tasks) {
      const list = m.get(t.solution_tier_id) ?? [];
      list.push(t);
      m.set(t.solution_tier_id, list);
    }
    return m;
  }, [tasks]);

  const implementerMap = useMemo(
    () => buildImplementerToGroupMap(implementerHourGroups),
    [implementerHourGroups]
  );

  /** Latest task-hours editor and pricing editor per tier, from recent audit_log. */
  const attributionByTier = useMemo(() => {
    const taskTierById = new Map(tasks.map((t) => [t.task_id, t.solution_tier_id]));
    const tasksBy: Map<string, UpdateAttribution> = new Map();
    const priceBy: Map<string, UpdateAttribution> = new Map();

    // auditLog is newest-first from Admin load.
    for (const row of auditLog) {
      const attr: UpdateAttribution = {
        who: auditWho(row),
        when: formatAuditWhen(row.created_at),
      };

      if (row.entity_type === "solution_tier_pricing") {
        const tid = (row.entity_id ?? "").trim();
        if (tid && !priceBy.has(tid)) priceBy.set(tid, attr);
        continue;
      }

      if (row.entity_type === "tasks") {
        const tid =
          jsonTierId(row.after_data) ??
          jsonTierId(row.before_data) ??
          taskTierById.get(row.entity_id) ??
          null;
        if (tid && !tasksBy.has(tid)) tasksBy.set(tid, attr);
      }
    }

    return { tasksBy, priceBy };
  }, [auditLog, tasks]);

  const issues = useMemo(() => {
    const out: HealthIssue[] = [];
    const tierIds = new Set<string>([
      ...tiers.map((t) => t.solution_tier_id),
      ...pricingByTier.keys(),
      ...tasksByTier.keys(),
    ]);

    const unmappedImpl = new Set<string>();
    for (const t of tasks) {
      const name = (t.task_implementer ?? "").trim();
      if (!name) continue;
      if (!implementerMap.has(name.toLowerCase()) && !implementerMap.has(name)) {
        unmappedImpl.add(name);
      }
    }
    for (const name of [...unmappedImpl].sort((a, b) => a.localeCompare(b))) {
      out.push({
        kind: "unmapped_implementer",
        tierId: "",
        tierName: "—",
        solutionName: "—",
        detail: `Implementer “${name}” has no hour-group mapping (hours land in Other).`,
      });
    }

    for (const tid of tierIds) {
      const tier = tierById.get(tid);
      const sol = tier ? solById.get(tier.solution_id) : null;
      const tierName = tier?.solution_tier_name ?? tid;
      const solutionName = sol?.solution_name ?? tier?.solution_id ?? "—";
      const list = tasksByTier.get(tid) ?? [];
      const pricing = pricingByTier.get(tid) ?? null;
      const taskCount = list.length;

      if (pricing && taskCount === 0) {
        const sell = pricing.sell_price != null ? `sell $${Math.round(Number(pricing.sell_price)).toLocaleString()}` : "pricing row";
        out.push({
          kind: "pricing_no_tasks",
          tierId: tid,
          tierName,
          solutionName,
          detail: `Has ${sell} but 0 vault tasks.`,
        });
        continue;
      }

      if (!pricing && taskCount > 0) {
        out.push({
          kind: "tasks_no_pricing",
          tierId: tid,
          tierName,
          solutionName,
          detail: `${taskCount} task(s) but no solution_tier_pricing row.`,
        });
        continue;
      }

      if (pricing && taskCount > 0 && implementerHourGroups.length > 0) {
        const roll = rollUpTaskTimesByPricingGroup(list, implementerMap);
        const storedTotal = Number(pricing.total_hours ?? 0);
        const rollTotal =
          roll.client_services +
          roll.copy +
          roll.design +
          roll.web_dev +
          roll.video +
          roll.data +
          roll.paid_media +
          roll.hubspot +
          roll.other;
        if (!hoursClose(storedTotal, rollTotal)) {
          out.push({
            kind: "hours_mismatch",
            tierId: tid,
            tierName,
            solutionName,
            detail: `Stored ${round1(storedTotal)}h vs task rollup ${round1(rollTotal)}h.`,
          });
        }
      }
    }

    return out;
  }, [
    tiers,
    tierById,
    solById,
    pricingByTier,
    tasksByTier,
    implementerMap,
    implementerHourGroups.length,
    tasks,
  ]);

  const ignoredIds = useMemo(() => {
    void ignoreTick;
    return new Set(listHealthIgnoredTier().map((e) => e.tierId));
  }, [ignoreTick]);

  const activeIssues = useMemo(
    () => issues.filter((i) => !i.tierId || !ignoredIds.has(i.tierId)),
    [issues, ignoredIds]
  );

  const ignoredIssues = useMemo(
    () => issues.filter((i) => i.tierId && ignoredIds.has(i.tierId)),
    [issues, ignoredIds]
  );

  const filtered = useMemo(() => {
    const base = showIgnored ? ignoredIssues : activeIssues;
    return filter === "all" ? base : base.filter((i) => i.kind === filter);
  }, [filter, showIgnored, activeIssues, ignoredIssues]);

  const fixableTierIds = useMemo(() => {
    const ids = new Set<string>();
    for (const i of activeIssues) {
      if (!i.tierId) continue;
      if (i.kind === "tasks_no_pricing" || i.kind === "hours_mismatch" || i.kind === "pricing_no_tasks") {
        ids.add(i.tierId);
      }
    }
    return [...ids];
  }, [activeIssues]);

  const syncOne = async (tierId: string) => {
    const client = getSupabase();
    if (!client || !tierId) return;
    setBusyTierId(tierId);
    setOpErr(null);
    setOpOk(null);
    try {
      const res = await syncTierPricingFromTasks({
        client,
        tierIds: tierId,
        mathConfig: tierPricingMathConfig,
        implementerHourGroups,
        logAudit,
      });
      if (!res.ok) {
        setOpErr(friendlyMutationMessage(res.message));
        return;
      }
      setOpOk(`Synced pricing from tasks for ${tierId}.`);
      await onRefresh();
    } finally {
      setBusyTierId(null);
    }
  };

  const syncAll = async () => {
    const client = getSupabase();
    if (!client || fixableTierIds.length === 0) return;
    setBusyAll(true);
    setOpErr(null);
    setOpOk(null);
    try {
      const res = await syncTierPricingFromTasks({
        client,
        tierIds: fixableTierIds,
        mathConfig: tierPricingMathConfig,
        implementerHourGroups,
        logAudit,
      });
      if (!res.ok) {
        setOpErr(friendlyMutationMessage(res.message));
        return;
      }
      setOpOk(
        `Synced pricing from tasks for ${fixableTierIds.length} tier(s) (${res.updated} updated, ${res.created} created).`
      );
      await onRefresh();
    } finally {
      setBusyAll(false);
    }
  };

  const counts = useMemo(() => {
    const src = showIgnored ? ignoredIssues : activeIssues;
    const c: Record<HealthIssueKind | "all", number> = {
      all: src.length,
      pricing_no_tasks: 0,
      tasks_no_pricing: 0,
      hours_mismatch: 0,
      unmapped_implementer: 0,
    };
    for (const i of src) c[i.kind] += 1;
    return c;
  }, [showIgnored, activeIssues, ignoredIssues]);

  return (
    <section className="admin-panel" style={panel}>
      <h2 style={h2}>Data health</h2>
      <p style={{ ...muted, marginTop: 0, maxWidth: "64ch" }}>
        Compares vault tasks to stored tier pricing. Fix actions run the same sync used when you save tasks
        (hours + multipliers + sell; risk scores preserved when a pricing row already exists).{" "}
        <strong>Task hours / Price updated by</strong> comes from recent Change History (who last changed
        tasks or pricing for that tier).
      </p>

      <div className="admin-health-summary" role="status">
        <span className="admin-health-pill">{counts.all} issue{counts.all === 1 ? "" : "s"}</span>
        <span className="admin-health-pill admin-health-pill--muted">
          {counts.pricing_no_tasks} pricing · no tasks
        </span>
        <span className="admin-health-pill admin-health-pill--muted">
          {counts.tasks_no_pricing} tasks · no pricing
        </span>
        <span className="admin-health-pill admin-health-pill--muted">
          {counts.hours_mismatch} hour mismatch
        </span>
        <span className="admin-health-pill admin-health-pill--muted">
          {counts.unmapped_implementer} unmapped implementer
        </span>
      </div>

      <div className="admin-actions-row" style={{ marginTop: 12, flexWrap: "wrap", gap: 8 }}>
        <label style={{ fontSize: "0.86rem", display: "flex", alignItems: "center", gap: 8 }}>
          Filter
          <select
            className="admin-field"
            value={filter}
            onChange={(e) => setFilter(e.target.value as HealthIssueKind | "all")}
            style={{ minWidth: "12rem" }}
          >
            <option value="all">All ({counts.all})</option>
            <option value="pricing_no_tasks">Pricing, no tasks ({counts.pricing_no_tasks})</option>
            <option value="tasks_no_pricing">Tasks, no pricing ({counts.tasks_no_pricing})</option>
            <option value="hours_mismatch">Hours mismatch ({counts.hours_mismatch})</option>
            <option value="unmapped_implementer">
              Unmapped implementer ({counts.unmapped_implementer})
            </option>
          </select>
        </label>
        <button
          type="button"
          className="admin-btn-primary"
          style={btnPrimary}
          disabled={busyAll || fixableTierIds.length === 0}
          onClick={() => void syncAll()}
        >
          {busyAll ? "Syncing…" : `Sync pricing from tasks (${fixableTierIds.length})`}
        </button>
        <button type="button" style={btn} onClick={() => void onRefresh()}>
          Refresh
        </button>
        <button
          type="button"
          style={btn}
          onClick={() => setShowIgnored((v) => !v)}
        >
          {showIgnored
            ? `Show active issues (${activeIssues.length})`
            : `Show ignored manual prices (${ignoredIssues.length})`}
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="admin-vault-empty" role="status" style={{ marginTop: 16 }}>
          <strong>All clear.</strong> No issues in this filter — vault tasks and pricing look aligned.
        </div>
      ) : (
        <div className="admin-table-scroll" style={{ marginTop: 14 }}>
          <table className="admin-data-table" style={tbl}>
            <thead>
              <tr>
                <th style={th}>Kind</th>
                <th style={th}>Solution</th>
                <th style={th}>Tier</th>
                <th style={th}>Detail</th>
                <th style={th}>Task hours / Price updated by</th>
                <th style={th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((i, idx) => {
                const taskAttr = i.tierId ? attributionByTier.tasksBy.get(i.tierId) : undefined;
                const priceAttr = i.tierId ? attributionByTier.priceBy.get(i.tierId) : undefined;
                return (
                <tr key={`${i.kind}-${i.tierId}-${i.detail}-${idx}`}>
                  <td style={td}>
                    <code style={{ fontSize: "0.78rem" }}>{i.kind}</code>
                  </td>
                  <td style={td}>{i.solutionName}</td>
                  <td style={td}>
                    {i.tierId ? (
                      <>
                        {i.tierName}{" "}
                        <code style={{ fontSize: "0.78rem" }}>{i.tierId}</code>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={td}>{i.detail}</td>
                  <td style={{ ...td, fontSize: "0.82rem", lineHeight: 1.45, minWidth: "11rem" }}>
                    {i.tierId ? (
                      <>
                        <div>
                          <span style={{ color: "var(--muted)" }}>Tasks: </span>
                          {taskAttr ? (
                            <>
                              {taskAttr.who}
                              <span style={{ color: "var(--muted)" }}> · {taskAttr.when}</span>
                            </>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          )}
                        </div>
                        <div>
                          <span style={{ color: "var(--muted)" }}>Price: </span>
                          {priceAttr ? (
                            <>
                              {priceAttr.who}
                              <span style={{ color: "var(--muted)" }}> · {priceAttr.when}</span>
                            </>
                          ) : (
                            <span style={{ color: "var(--muted)" }}>—</span>
                          )}
                        </div>
                      </>
                    ) : (
                      <span style={{ color: "var(--muted)" }}>—</span>
                    )}
                  </td>
                  <td style={td}>
                    <div className="admin-actions-row" style={{ marginTop: 0, flexWrap: "wrap", gap: 6 }}>
                      {i.tierId ? (
                        <>
                          <Link
                            className="admin-health-link"
                            to={vaultPathForTier(i.tierId, i.kind === "pricing_no_tasks" ? "tasks" : "pricing")}
                          >
                            Open
                          </Link>
                          {i.kind !== "unmapped_implementer" ? (
                            <button
                              type="button"
                              style={btnSm}
                              disabled={busyTierId === i.tierId || busyAll}
                              onClick={() => void syncOne(i.tierId)}
                            >
                              {busyTierId === i.tierId ? "…" : "Sync"}
                            </button>
                          ) : null}
                          {i.kind === "pricing_no_tasks" || i.kind === "hours_mismatch" ? (
                            showIgnored ? (
                              <button
                                type="button"
                                style={btnSm}
                                onClick={() => {
                                  unignoreHealthTier(i.tierId);
                                  setIgnoreTick((n) => n + 1);
                                  setOpOk(`Stopped ignoring ${i.tierId}.`);
                                }}
                              >
                                Unignore
                              </button>
                            ) : (
                              <button
                                type="button"
                                style={btnSm}
                                onClick={() => {
                                  ignoreHealthTier(i.tierId, "manual_price");
                                  setIgnoreTick((n) => n + 1);
                                  setOpOk(
                                    `Marked ${i.tierId} as intentional manual price (hidden from active issues).`
                                  );
                                }}
                              >
                                Ignore (manual)
                              </button>
                            )
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
