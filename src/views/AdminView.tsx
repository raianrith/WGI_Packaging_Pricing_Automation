import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ADMIN_VIEW_DESCRIPTION,
  AGENCY_HERO_TITLE,
} from "../branding";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";
import { insertAuditLog } from "../lib/audit";
import { todayISODate } from "../lib/dates";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { computeTierPricing } from "../lib/tierPricingMath";
import { SolutionsBuilderPanel } from "../components/SolutionsBuilderPanel";
import type {
  AuditLogRow,
  Package,
  PackageSolutionTier,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskRow,
} from "../types";

type AdminTab =
  | "packages"
  | "solutions_builder"
  | "bulk"
  | "glossary"
  | "audit";

/** Create-only vs list + edit — shown under each entity tab (not Change history). */
export type AdminSubTab = "create" | "update";

/** Single caption row so label+input stacks align across grid columns (avoids extra flex rows for “(locked)”). */
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

/** Next id in the `1-n` sequence (admin package builder). Ignores other id shapes. */
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

export function AdminView() {
  const [tab, setTab] = useState<AdminTab>("packages");
  const [adminSubTab, setAdminSubTab] = useState<AdminSubTab>("create");
  const [packages, setPackages] = useState<Package[]>([]);
  const [solutions, setSolutions] = useState<Solution[]>([]);
  const [tiers, setTiers] = useState<SolutionTier[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [packageTiers, setPackageTiers] = useState<PackageSolutionTier[]>([]);
  const [tierPricing, setTierPricing] = useState<SolutionTierPricing[]>([]);
  const [pricingLoadNote, setPricingLoadNote] = useState<string | null>(null);
  const [auditLog, setAuditLog] = useState<AuditLogRow[]>([]);
  const [auditLoadNote, setAuditLoadNote] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [opErr, setOpErr] = useState<string | null>(null);
  const [opOk, setOpOk] = useState<string | null>(null);

  const [expAuditId, setExpAuditId] = useState<string | null>(null);
  const [auditEntityType, setAuditEntityType] = useState<string>("all");
  const [auditTextSearch, setAuditTextSearch] = useState("");

  const refresh = useCallback(async (opts?: { silent?: boolean }) => {
    const silent = Boolean(opts?.silent);
    setLoadErr(null);
    setAuditLoadNote(null);
    setPricingLoadNote(null);
    const keyErr = browserKeyConfigurationError();
    if (keyErr) {
      setLoadErr(keyErr);
      setLoading(false);
      return;
    }
    const client = getSupabase();
    if (!client || !envConfigured()) {
      setLoadErr("Configure .env with Supabase URL and publishable key.");
      setLoading(false);
      return;
    }

    if (!silent) {
      setLoading(true);
    }
    const [pRes, sRes, tRes, kRes, prRes, ptRes, aRes] = await Promise.all([
      client.from("packages").select("*").order("package_id"),
      client.from("solutions").select("*").order("solution_id"),
      client.from("solution_tiers").select("*").order("solution_tier_id"),
      client.from("tasks").select("*").order("task_id"),
      client.from("solution_tier_pricing").select("*").order("solution_tier_id"),
      client.from("package_solution_tiers").select("*").order("package_id"),
      client.from("audit_log").select("*").order("created_at", { ascending: false }).limit(500),
    ]);

    const err = pRes.error || sRes.error || tRes.error || kRes.error || ptRes.error;
    if (err) {
      setLoadErr(err.message);
      setLoading(false);
      return;
    }

    const pkgs = (pRes.data ?? []) as Package[];
    const sols = (sRes.data ?? []) as Solution[];
    const trs = (tRes.data ?? []) as SolutionTier[];
    const tks = (kRes.data ?? []) as TaskRow[];
    pkgs.sort((a, b) => sortId(a.package_id, b.package_id));
    sols.sort((a, b) => sortId(a.solution_id, b.solution_id));
    trs.sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
    tks.sort((a, b) => sortId(a.task_id, b.task_id));
    setPackages(pkgs);
    setSolutions(sols);
    setTiers(trs);
    setTasks(tks);
    setPackageTiers((ptRes.data ?? []) as PackageSolutionTier[]);

    if (prRes.error) {
      setTierPricing([]);
      setPricingLoadNote(
        prRes.error.message.includes("solution_tier_pricing") ||
          prRes.error.code === "PGRST205"
          ? "Pricing table missing or blocked: create solution_tier_pricing and allow SELECT (see supabase/read_policies_for_dashboard.sql)."
          : `Pricing could not load: ${prRes.error.message}`
      );
    } else {
      setTierPricing((prRes.data ?? []) as SolutionTierPricing[]);
    }

    if (aRes.error) {
      setAuditLog([]);
      setAuditLoadNote(
        aRes.error.message.includes("audit_log") || aRes.error.code === "PGRST205"
          ? "Run supabase/audit_log.sql in the SQL Editor to enable change history."
          : aRes.error.message
      );
    } else {
      setAuditLog((aRes.data ?? []) as AuditLogRow[]);
    }

    setLoading(false);
    notifyPackagingDataChanged();
  }, []);

  const refreshAfterSave = useCallback(() => refresh({ silent: true }), [refresh]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    setAdminSubTab("create");
  }, [tab]);

  const logAudit = useCallback(
    async (
      client: SupabaseClient,
      params: Parameters<typeof insertAuditLog>[1]
    ) => {
      const { error } = await insertAuditLog(client, params);
      if (error) {
        const hint =
          /audit_log|schema cache/i.test(error)
            ? " Run supabase/audit_log.sql in Supabase → SQL Editor, then save again (or wait ~1 min for the API cache to refresh)."
            : "";
        setOpErr(`Saved, but history was not recorded: ${error}.${hint}`);
      }
    },
    []
  );

  const filteredAudit = useMemo(() => {
    let list = auditLog;
    if (auditEntityType !== "all") {
      list = list.filter((r) => r.entity_type === auditEntityType);
    }
    const q = auditTextSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (r) =>
          r.entity_id.toLowerCase().includes(q) ||
          r.action.toLowerCase().includes(q) ||
          r.entity_type.toLowerCase().includes(q)
      );
    }
    return list;
  }, [auditLog, auditEntityType, auditTextSearch]);

  return (
    <div className="admin-page-shell" style={shell}>
      <header className="admin-page-header">
        <div className="admin-hero-top">
          <span className="admin-hero__eyebrow">Admin · edit access</span>
          <button
            type="button"
            className="agency-btn-secondary admin-hero__reload"
            style={btnReload}
            onClick={() => void refresh()}
            disabled={loading}
          >
            Reload data
          </button>
        </div>
        <h1 style={title}>{AGENCY_HERO_TITLE}</h1>
        <p className="admin-hero__desc" style={subtitle}>
          {ADMIN_VIEW_DESCRIPTION}{" "}
          <Link to="/" style={link}>
            Back to agency view
          </Link>
        </p>
      </header>

      {loadErr && (
        <div className="admin-banner admin-banner--err" style={bannerErr} role="alert">
          {loadErr}
        </div>
      )}
      {pricingLoadNote && !loadErr && (
        <div className="admin-banner admin-banner--note" style={bannerNote} role="status">
          {pricingLoadNote}
        </div>
      )}
      {auditLoadNote && !loadErr && (
        <div
          className="admin-banner admin-banner--note"
          style={bannerNote}
          role="status"
        >
          {auditLoadNote}
        </div>
      )}
      {loading && (
        <div className="admin-loading">
          <p className="admin-loading__text">Loading from Supabase…</p>
        </div>
      )}

      {opErr && (
        <div className="admin-banner admin-banner--err" style={bannerErr} role="alert">
          {opErr}
        </div>
      )}
      {opOk && (
        <div className="admin-banner admin-banner--ok" style={bannerOk} role="status">
          {opOk}
        </div>
      )}

      {!loadErr && !loading && (
        <div className="admin-workspace">
          <div className="admin-tabs" role="tablist" aria-label="Admin sections">
            {(
              [
                ["packages", "Package Builder"],
                ["solutions_builder", "Solutions Builder"],
                ["bulk", "Bulk Import"],
                ["glossary", "Data Glossary"],
                ["audit", "Change history"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                className={tab === id ? "admin-tab admin-tab--active" : "admin-tab"}
                onClick={() => {
                  setTab(id);
                  setAdminSubTab("create");
                  setOpErr(null);
                  setOpOk(null);
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {tab !== "audit" && tab !== "bulk" && tab !== "glossary" && (
            <div className="admin-subtabs" role="tablist" aria-label="Create or update records">
              <button
                type="button"
                role="tab"
                aria-selected={adminSubTab === "create"}
                className={
                  adminSubTab === "create"
                    ? "admin-subtab admin-subtab--active"
                    : "admin-subtab"
                }
                onClick={() => {
                  setAdminSubTab("create");
                  setOpErr(null);
                  setOpOk(null);
                }}
              >
                Create new
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={adminSubTab === "update"}
                className={
                  adminSubTab === "update"
                    ? "admin-subtab admin-subtab--active"
                    : "admin-subtab"
                }
                onClick={() => {
                  setAdminSubTab("update");
                  setOpErr(null);
                  setOpOk(null);
                }}
              >
                Update
              </button>
            </div>
          )}

          {tab === "packages" && (
            <PackagesPanel
              subTab={adminSubTab}
              packages={packages}
              solutions={solutions}
              tiers={tiers}
              packageTiers={packageTiers}
              onSaved={refreshAfterSave}
              setOpErr={setOpErr}
              setOpOk={setOpOk}
              logAudit={logAudit}
            />
          )}
          {tab === "solutions_builder" && (
            <SolutionsBuilderPanel
              subTab={adminSubTab}
              solutions={solutions}
              tiers={tiers}
              tasks={tasks}
              tierPricing={tierPricing}
              onSaved={refreshAfterSave}
              setOpErr={setOpErr}
              setOpOk={setOpOk}
              logAudit={logAudit}
              styles={{
                panel,
                formGrid,
                lbl,
                input,
                textarea,
                btn,
                btnPrimary,
                btnSm,
                btnDangerSm,
                tbl,
                th,
                td,
                h2,
                muted,
              }}
            />
          )}
          {tab === "bulk" && (
            <BulkImportPanel
              packages={packages}
              solutions={solutions}
              tiers={tiers}
              tasks={tasks}
              pricing={tierPricing}
              packageTiers={packageTiers}
              onSaved={refreshAfterSave}
              setOpErr={setOpErr}
              setOpOk={setOpOk}
            />
          )}
          {tab === "glossary" && <DataGlossaryPanel />}
          {tab === "audit" && (
            <section className="admin-panel admin-panel--editor" style={panel}>
              <div className="admin-editor-layout admin-editor-layout--wide">
              <h2 style={h2}>Change history</h2>
              <p className="admin-intro" style={muted}>
                Filter by entity type or search id / action (substring).
              </p>
              <div className="admin-audit-toolbar">
                <select
                  className="admin-field"
                  style={{ ...input, marginTop: 0, maxWidth: 280 }}
                  value={auditEntityType}
                  onChange={(e) => setAuditEntityType(e.target.value)}
                >
                  <option value="all">All entity types</option>
                  <option value="packages">packages</option>
                  <option value="solutions">solutions</option>
                  <option value="solution_tiers">solution_tiers</option>
                  <option value="solution_tier_pricing">solution_tier_pricing</option>
                  <option value="tasks">tasks</option>
                </select>
                <input
                  className="admin-field kb-filter-input"
                  style={{ ...input, marginTop: 0, flex: "1 1 200px", maxWidth: 420 }}
                  placeholder="Search id, type, or action…"
                  value={auditTextSearch}
                  onChange={(e) => setAuditTextSearch(e.target.value)}
                />
              </div>
              <div className="admin-table-scroll" style={{ marginTop: 12 }}>
                <table className="admin-data-table" style={tbl}>
                  <thead>
                    <tr>
                      <th style={th}>When (UTC)</th>
                      <th style={th}>Entity</th>
                      <th style={th}>Id</th>
                      <th style={th}>Action</th>
                      <th style={th}>Detail</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredAudit.map((row) => (
                      <tr key={row.id}>
                        <td style={td}>{row.created_at?.replace("T", " ").slice(0, 19)}</td>
                        <td style={td}>{row.entity_type}</td>
                        <td style={td}>{row.entity_id}</td>
                        <td style={td}>{row.action}</td>
                        <td style={td}>
                          <button
                            type="button"
                            style={btnSm}
                            onClick={() =>
                              setExpAuditId((id) => (id === row.id ? null : row.id))
                            }
                          >
                            {expAuditId === row.id ? "Hide" : "JSON"}
                          </button>
                          {expAuditId === row.id && (
                            <pre style={preJson}>
                              {JSON.stringify(
                                { before: row.before_data, after: row.after_data },
                                null,
                                2
                              )}
                            </pre>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {filteredAudit.length === 0 && (
                  <p className="admin-hint" style={muted}>
                    No audit rows yet. Apply database migration and save an edit.
                  </p>
                )}
              </div>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

type BulkImportDoc = {
  packages?: Partial<Package>[];
  solutions?: Partial<Solution>[];
  tiers?: Partial<SolutionTier>[];
  tasks?: Partial<TaskRow>[];
  pricing?: Partial<SolutionTierPricing>[];
  package_solution_tiers?: Partial<PackageSolutionTier>[];
};

type BulkPreview = {
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  pricing: Partial<SolutionTierPricing>[];
  package_solution_tiers: PackageSolutionTier[];
};

type BulkValidationIssue = {
  table: "packages" | "solutions" | "tiers" | "tasks" | "pricing" | "package_solution_tiers";
  row: number;
  column?: string;
  message: string;
};

type ImportEntityCounts = {
  table: "packages" | "solutions" | "tiers" | "tasks" | "pricing" | "package_solution_tiers";
  total: number;
  created: number;
  updated: number;
  failed: number;
  skipped: number;
};

const BULK_TEMPLATE_VERSION = "2026.04.22";
const BULK_IMPORT_CHUNK_SIZE = 200;

let xlsxPromise: Promise<typeof import("xlsx")> | null = null;
async function loadXlsx() {
  if (!xlsxPromise) xlsxPromise = import("xlsx");
  return xlsxPromise;
}

function normStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function normOptStr(v: unknown): string | null {
  const t = normStr(v);
  return t || null;
}

function normOptNum(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normBool(v: unknown, fallback = false): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const t = v.trim().toLowerCase();
    if (t === "true" || t === "1" || t === "yes") return true;
    if (t === "false" || t === "0" || t === "no") return false;
  }
  if (typeof v === "number") return v !== 0;
  return fallback;
}

function buildBulkPreview(doc: BulkImportDoc): BulkPreview {
  const today = todayISODate();
  const packages: Package[] = (doc.packages ?? [])
    .map((r) => {
      const id = normStr(r.package_id);
      if (!id) return null;
      return {
        package_id: id,
        package_name: normStr(r.package_name) || id,
        package_create_date: normStr(r.package_create_date) || today,
        package_modified_date: normStr(r.package_modified_date) || today,
      };
    })
    .filter((x): x is Package => x != null);

  const solutions: Solution[] = (doc.solutions ?? [])
    .map((r) => {
      const id = normStr(r.solution_id);
      if (!id) return null;
      return {
        solution_id: id,
        solution_name: normStr(r.solution_name) || id,
        solution_created_date: normStr(r.solution_created_date) || today,
        solution_modified_date: normStr(r.solution_modified_date) || today,
      };
    })
    .filter((x): x is Solution => x != null);

  const tiers: SolutionTier[] = (doc.tiers ?? [])
    .map((r) => {
      const id = normStr(r.solution_tier_id);
      const solutionId = normStr(r.solution_id);
      if (!id || !solutionId) return null;
      return {
        solution_tier_id: id,
        solution_id: solutionId,
        solution_tier_name: normStr(r.solution_tier_name) || id,
        solution_tier_owner: normOptStr(r.solution_tier_owner),
        solution_tier_overview: normOptStr(r.solution_tier_overview),
        solution_tier_overview_link: normOptStr(r.solution_tier_overview_link),
        solution_tier_direction: normOptStr(r.solution_tier_direction),
        solution_tier_sop: normOptStr(r.solution_tier_sop),
        solution_tier_resources: normOptStr(r.solution_tier_resources),
        solution_tier_created_date: normStr(r.solution_tier_created_date) || today,
        solution_tier_modified_date: normStr(r.solution_tier_modified_date) || today,
      };
    })
    .filter((x): x is SolutionTier => x != null);

  const tasks: TaskRow[] = (doc.tasks ?? [])
    .map((r) => {
      const id = normStr(r.task_id);
      const tierId = normStr(r.solution_tier_id);
      if (!id || !tierId) return null;
      return {
        task_id: id,
        solution_tier_id: tierId,
        task_name: normStr(r.task_name) || id,
        task_implementer: normOptStr(r.task_implementer),
        task_time: normOptNum(r.task_time),
        task_duration: normOptNum(r.task_duration),
        task_dependencies: normOptStr(r.task_dependencies),
        task_notes: normOptStr(r.task_notes),
        task_create_date: normStr(r.task_create_date) || today,
        task_modified_date: normStr(r.task_modified_date) || today,
      };
    })
    .filter((x): x is TaskRow => x != null);

  const pricing: Partial<SolutionTierPricing>[] = [];
  for (const r of doc.pricing ?? []) {
    const tierId = normStr(r.solution_tier_id);
    if (!tierId) continue;
    const hours = {
      client: normOptNum(r.hours_client_services) ?? 0,
      copy: normOptNum(r.hours_copy) ?? 0,
      design: normOptNum(r.hours_design) ?? 0,
      web: normOptNum(r.hours_web_dev) ?? 0,
      video: normOptNum(r.hours_video) ?? 0,
      data: normOptNum(r.hours_data) ?? 0,
      paidMedia: normOptNum(r.hours_paid_media) ?? 0,
      hubspot: normOptNum(r.hours_hubspot) ?? 0,
      other: normOptNum(r.hours_other) ?? 0,
    };
    const derived = computeTierPricing({
      hours,
      scopeRisk: normOptNum(r.scope_risk),
      internalCoordination: normOptNum(r.internal_coordination),
      clientRevisionRisk: normOptNum(r.client_revision_risk),
      strategicValueScore: normOptNum(r.strategic_value_score),
    });
    pricing.push({
      solution_tier_id: tierId,
      solution_label: normOptStr(r.solution_label),
      tier: normOptStr(r.tier),
      scope: normOptStr(r.scope),
      hours_client_services: hours.client,
      hours_copy: hours.copy,
      hours_design: hours.design,
      hours_web_dev: hours.web,
      hours_video: hours.video,
      hours_data: hours.data,
      hours_paid_media: hours.paidMedia,
      hours_hubspot: hours.hubspot,
      hours_other: hours.other,
      total_hours: normOptNum(r.total_hours) ?? derived.totalHours,
      expected_effort_base_price:
        normOptNum(r.expected_effort_base_price) ?? derived.expectedEffortBase,
      scope_risk: normOptNum(r.scope_risk),
      internal_coordination: normOptNum(r.internal_coordination),
      client_revision_risk: normOptNum(r.client_revision_risk),
      risk_multiplier: normOptNum(r.risk_multiplier) ?? derived.riskMultiplier,
      risk_mitigated_base_price:
        normOptNum(r.risk_mitigated_base_price) ?? derived.riskMitigatedBase,
      strategic_value_score: normOptNum(r.strategic_value_score),
      strategic_value_multiplier:
        normOptNum(r.strategic_value_multiplier) ?? derived.strategicMultiplier,
      sell_price: normOptNum(r.sell_price) ?? derived.sellPrice,
      standalone_sell_price: normOptNum(r.standalone_sell_price),
      old_price: normOptNum(r.old_price),
      percent_change: normOptStr(r.percent_change),
      requires_customization: normBool(r.requires_customization, false),
      taxable: normBool(r.taxable, false),
      notes: normOptStr(r.notes),
      tags: normOptStr(r.tags),
    });
  }

  const package_solution_tiers: PackageSolutionTier[] = (doc.package_solution_tiers ?? [])
    .map((r) => {
      const package_id = normStr(r.package_id);
      const solution_tier_id = normStr(r.solution_tier_id);
      if (!package_id || !solution_tier_id) return null;
      return { package_id, solution_tier_id };
    })
    .filter((x): x is PackageSolutionTier => x != null);

  return { packages, solutions, tiers, tasks, pricing, package_solution_tiers };
}

function isIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function validateBulkPreview(
  preview: BulkPreview,
  existing: { packages: Package[]; solutions: Solution[]; tiers: SolutionTier[] }
): BulkValidationIssue[] {
  const errs: BulkValidationIssue[] = [];
  const pkgIds = new Set(existing.packages.map((p) => p.package_id));
  for (const p of preview.packages) pkgIds.add(p.package_id);
  const solIds = new Set(existing.solutions.map((s) => s.solution_id));
  for (const s of preview.solutions) solIds.add(s.solution_id);
  const tierIds = new Set(existing.tiers.map((t) => t.solution_tier_id));
  for (const t of preview.tiers) tierIds.add(t.solution_tier_id);

  const dupPkg = new Set<string>();
  const seenPkg = new Set<string>();
  preview.packages.forEach((p) => {
    if (seenPkg.has(p.package_id)) dupPkg.add(p.package_id);
    seenPkg.add(p.package_id);
  });
  const dupSol = new Set<string>();
  const seenSol = new Set<string>();
  preview.solutions.forEach((s) => {
    if (seenSol.has(s.solution_id)) dupSol.add(s.solution_id);
    seenSol.add(s.solution_id);
  });
  const dupTier = new Set<string>();
  const seenTier = new Set<string>();
  preview.tiers.forEach((t) => {
    if (seenTier.has(t.solution_tier_id)) dupTier.add(t.solution_tier_id);
    seenTier.add(t.solution_tier_id);
  });
  const dupTask = new Set<string>();
  const seenTask = new Set<string>();
  preview.tasks.forEach((t) => {
    if (seenTask.has(t.task_id)) dupTask.add(t.task_id);
    seenTask.add(t.task_id);
  });
  const dupPricing = new Set<string>();
  const seenPricing = new Set<string>();
  preview.pricing.forEach((p) => {
    const id = normStr(p.solution_tier_id);
    if (!id) return;
    if (seenPricing.has(id)) dupPricing.add(id);
    seenPricing.add(id);
  });

  for (const [i, p] of preview.packages.entries()) {
    if (dupPkg.has(p.package_id)) {
      errs.push({
        table: "packages",
        row: i + 2,
        column: "package_id",
        message: `Duplicate package_id '${p.package_id}' in upload.`,
      });
    }
    if (p.package_create_date && !isIsoDate(p.package_create_date)) {
      errs.push({
        table: "packages",
        row: i + 2,
        column: "package_create_date",
        message: "Use YYYY-MM-DD format.",
      });
    }
    if (p.package_modified_date && !isIsoDate(p.package_modified_date)) {
      errs.push({
        table: "packages",
        row: i + 2,
        column: "package_modified_date",
        message: "Use YYYY-MM-DD format.",
      });
    }
  }

  for (const [i, s] of preview.solutions.entries()) {
    if (dupSol.has(s.solution_id)) {
      errs.push({
        table: "solutions",
        row: i + 2,
        column: "solution_id",
        message: `Duplicate solution_id '${s.solution_id}' in upload.`,
      });
    }
    if (s.solution_created_date && !isIsoDate(s.solution_created_date)) {
      errs.push({
        table: "solutions",
        row: i + 2,
        column: "solution_created_date",
        message: "Use YYYY-MM-DD format.",
      });
    }
    if (s.solution_modified_date && !isIsoDate(s.solution_modified_date)) {
      errs.push({
        table: "solutions",
        row: i + 2,
        column: "solution_modified_date",
        message: "Use YYYY-MM-DD format.",
      });
    }
  }
  for (const [i, t] of preview.tiers.entries()) {
    if (dupTier.has(t.solution_tier_id)) {
      errs.push({
        table: "tiers",
        row: i + 2,
        column: "solution_tier_id",
        message: `Duplicate solution_tier_id '${t.solution_tier_id}' in upload.`,
      });
    }
    if (!solIds.has(t.solution_id)) {
      errs.push({
        table: "tiers",
        row: i + 2,
        column: "solution_id",
        message: `Missing solution '${t.solution_id}'.`,
      });
    }
    if (t.solution_tier_created_date && !isIsoDate(t.solution_tier_created_date)) {
      errs.push({
        table: "tiers",
        row: i + 2,
        column: "solution_tier_created_date",
        message: "Use YYYY-MM-DD format.",
      });
    }
    if (t.solution_tier_modified_date && !isIsoDate(t.solution_tier_modified_date)) {
      errs.push({
        table: "tiers",
        row: i + 2,
        column: "solution_tier_modified_date",
        message: "Use YYYY-MM-DD format.",
      });
    }
  }
  for (const [i, t] of preview.tasks.entries()) {
    if (dupTask.has(t.task_id)) {
      errs.push({
        table: "tasks",
        row: i + 2,
        column: "task_id",
        message: `Duplicate task_id '${t.task_id}' in upload.`,
      });
    }
    if (!tierIds.has(t.solution_tier_id)) {
      errs.push({
        table: "tasks",
        row: i + 2,
        column: "solution_tier_id",
        message: `Missing tier '${t.solution_tier_id}'.`,
      });
    }
    if (t.task_create_date && !isIsoDate(t.task_create_date)) {
      errs.push({
        table: "tasks",
        row: i + 2,
        column: "task_create_date",
        message: "Use YYYY-MM-DD format.",
      });
    }
    if (t.task_modified_date && !isIsoDate(t.task_modified_date)) {
      errs.push({
        table: "tasks",
        row: i + 2,
        column: "task_modified_date",
        message: "Use YYYY-MM-DD format.",
      });
    }
  }
  for (const [i, p] of preview.pricing.entries()) {
    const id = normStr(p.solution_tier_id);
    if (id && dupPricing.has(id)) {
      errs.push({
        table: "pricing",
        row: i + 2,
        column: "solution_tier_id",
        message: `Duplicate pricing row for tier '${id}' in upload.`,
      });
    }
    if (id && !tierIds.has(id)) {
      errs.push({
        table: "pricing",
        row: i + 2,
        column: "solution_tier_id",
        message: `Missing tier '${id}'.`,
      });
    }
    const scoreChecks: Array<[keyof SolutionTierPricing, number | null | undefined]> = [
      ["scope_risk", p.scope_risk],
      ["internal_coordination", p.internal_coordination],
      ["client_revision_risk", p.client_revision_risk],
      ["strategic_value_score", p.strategic_value_score],
    ];
    for (const [k, v] of scoreChecks) {
      if (v == null) continue;
      if (![0, 1, 2].includes(Math.round(Number(v)))) {
        errs.push({
          table: "pricing",
          row: i + 2,
          column: String(k),
          message: "Use 0, 1, or 2.",
        });
      }
    }
  }
  const seenPstTier = new Set<string>();
  for (const [i, row] of preview.package_solution_tiers.entries()) {
    if (seenPstTier.has(row.solution_tier_id)) {
      errs.push({
        table: "package_solution_tiers",
        row: i + 2,
        column: "solution_tier_id",
        message: `Duplicate solution_tier_id '${row.solution_tier_id}' in upload (each tier may appear once).`,
      });
    }
    seenPstTier.add(row.solution_tier_id);
    if (!pkgIds.has(row.package_id)) {
      errs.push({
        table: "package_solution_tiers",
        row: i + 2,
        column: "package_id",
        message: `Missing package '${row.package_id}'.`,
      });
    }
    if (!tierIds.has(row.solution_tier_id)) {
      errs.push({
        table: "package_solution_tiers",
        row: i + 2,
        column: "solution_tier_id",
        message: `Missing tier '${row.solution_tier_id}'.`,
      });
    }
  }
  return errs;
}

function readSheetRows(
  workbook: import("xlsx").WorkBook,
  xlsx: typeof import("xlsx"),
  names: string[]
): Record<string, unknown>[] {
  const sheetName = names.find((n) => Boolean(workbook.Sheets[n]));
  if (!sheetName) return [];
  return xlsx.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName]!, {
    defval: "",
    raw: false,
  });
}

function bulkDocFromWorkbook(
  workbook: import("xlsx").WorkBook,
  xlsx: typeof import("xlsx")
): BulkImportDoc {
  return {
    packages: readSheetRows(workbook, xlsx, ["packages", "Packages"]) as Partial<Package>[],
    solutions: readSheetRows(workbook, xlsx, ["solutions", "Solutions"]) as Partial<Solution>[],
    tiers: readSheetRows(workbook, xlsx, [
      "tiers",
      "Tiers",
      "solution_tiers",
    ]) as Partial<SolutionTier>[],
    tasks: readSheetRows(workbook, xlsx, ["tasks", "Tasks"]) as Partial<TaskRow>[],
    pricing: readSheetRows(workbook, xlsx, [
      "pricing",
      "Pricing",
      "solution_tier_pricing",
    ]) as Partial<SolutionTierPricing>[],
    package_solution_tiers: readSheetRows(workbook, xlsx, [
      "package_solution_tiers",
      "Package_solution_tiers",
    ]) as Partial<PackageSolutionTier>[],
  };
}

function workbookTemplateVersion(
  workbook: import("xlsx").WorkBook,
  xlsx: typeof import("xlsx")
): string | null {
  const sheet = workbook.Sheets.instructions ?? workbook.Sheets.Instructions;
  if (!sheet) return null;
  const rows = xlsx.utils.sheet_to_json<(string | null)[]>(sheet, {
    header: 1,
    defval: "",
    raw: false,
  });
  for (const row of rows) {
    if (String(row[0] ?? "").trim() === "TemplateVersion") {
      const v = String(row[1] ?? "").trim();
      return v || null;
    }
  }
  return null;
}

async function downloadValidationErrorsWorkbook(
  issues: BulkValidationIssue[]
): Promise<void> {
  const xlsx = await loadXlsx();
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(
    issues.map((i) => ({
      table: i.table,
      row: i.row,
      column: i.column ?? "",
      error: i.message,
    }))
  );
  xlsx.utils.book_append_sheet(wb, ws, "errors");
  xlsx.writeFile(wb, "bulk-import-errors.xlsx");
}

function chunkRows<T>(rows: T[], chunkSize: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += chunkSize) out.push(rows.slice(i, i + chunkSize));
  return out;
}

function sheetFromRows(
  xlsx: typeof import("xlsx"),
  headers: string[],
  rows: Record<string, unknown>[]
): import("xlsx").WorkSheet {
  if (rows.length === 0) return xlsx.utils.aoa_to_sheet([headers]);
  return xlsx.utils.json_to_sheet(rows, { header: headers });
}

async function downloadBulkTemplateWorkbook(data: {
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  pricing: SolutionTierPricing[];
  packageTiers: PackageSolutionTier[];
}): Promise<void> {
  const xlsx = await loadXlsx();
  const wb = xlsx.utils.book_new();
  const instructions = xlsx.utils.aoa_to_sheet([
    ["Bulk Import template (current database export)"],
    ["TemplateVersion", BULK_TEMPLATE_VERSION],
    ["1) This file is pre-filled with current database rows."],
    ["2) Edit/add rows in each sheet. Keep header names unchanged."],
    ["2) Upload this workbook in Admin > Bulk Import > Upload Excel file."],
    ["3) Click Preview import, fix issues if any, then Run import."],
    [""],
    ["Package ↔ tier links:"],
    ["- Use the package_solution_tiers sheet: each row is package_id + solution_tier_id."],
    ["- A tier may appear in at most one row (one package). Manage links in Package Builder too."],
    [""],
    ["Pricing calculator rule:"],
    [
      "- Enter input columns (hours_* + scope_risk + internal_coordination + client_revision_risk + strategic_value_score).",
    ],
    [
      "- Derived pricing math is calculated automatically during import (total_hours, expected_effort_base_price, risk_multiplier, risk_mitigated_base_price, strategic_value_multiplier, sell_price).",
    ],
  ]);
  xlsx.utils.book_append_sheet(wb, instructions, "instructions");

  const packagesWs = sheetFromRows(
    xlsx,
    ["package_id", "package_name", "package_create_date", "package_modified_date"],
    data.packages.map((p) => ({ ...p }))
  );
  xlsx.utils.book_append_sheet(wb, packagesWs, "packages");

  const solutionsWs = sheetFromRows(
    xlsx,
    ["solution_id", "solution_name", "solution_created_date", "solution_modified_date"],
    data.solutions.map((s) => ({ ...s }))
  );
  xlsx.utils.book_append_sheet(wb, solutionsWs, "solutions");

  const pstWs = sheetFromRows(
    xlsx,
    ["package_id", "solution_tier_id", "created_at"],
    data.packageTiers.map((r) => ({
      package_id: r.package_id,
      solution_tier_id: r.solution_tier_id,
      created_at: r.created_at ?? "",
    }))
  );
  xlsx.utils.book_append_sheet(wb, pstWs, "package_solution_tiers");

  const tiersWs = sheetFromRows(
    xlsx,
    [
      "solution_tier_id",
      "solution_id",
      "solution_tier_name",
      "solution_tier_owner",
      "solution_tier_overview",
      "solution_tier_overview_link",
      "solution_tier_direction",
      "solution_tier_sop",
      "solution_tier_resources",
      "solution_tier_created_date",
      "solution_tier_modified_date",
    ],
    data.tiers.map((t) => ({ ...t }))
  );
  xlsx.utils.book_append_sheet(wb, tiersWs, "tiers");

  const tasksWs = sheetFromRows(
    xlsx,
    [
      "task_id",
      "solution_tier_id",
      "task_name",
      "task_implementer",
      "task_time",
      "task_duration",
      "task_dependencies",
      "task_notes",
      "task_create_date",
      "task_modified_date",
    ],
    data.tasks.map((t) => ({ ...t }))
  );
  xlsx.utils.book_append_sheet(wb, tasksWs, "tasks");

  const pricingHeaders = [
    "solution_tier_id",
    "solution_label",
    "tier",
    "scope",
    "hours_client_services",
    "hours_copy",
    "hours_design",
    "hours_web_dev",
    "hours_video",
    "hours_data",
    "hours_paid_media",
    "hours_hubspot",
    "hours_other",
    "scope_risk",
    "internal_coordination",
    "client_revision_risk",
    "strategic_value_score",
    "standalone_sell_price",
    "old_price",
    "percent_change",
    "requires_customization",
    "taxable",
    "notes",
    "tags",
  ];
  const pricingWs = sheetFromRows(
    xlsx,
    pricingHeaders,
    data.pricing.map((p) => ({
      solution_tier_id: p.solution_tier_id,
      solution_label: p.solution_label ?? "",
      tier: p.tier ?? "",
      scope: p.scope ?? "",
      hours_client_services: p.hours_client_services ?? "",
      hours_copy: p.hours_copy ?? "",
      hours_design: p.hours_design ?? "",
      hours_web_dev: p.hours_web_dev ?? "",
      hours_video: p.hours_video ?? "",
      hours_data: p.hours_data ?? "",
      hours_paid_media: p.hours_paid_media ?? "",
      hours_hubspot: p.hours_hubspot ?? "",
      hours_other: p.hours_other ?? "",
      scope_risk: p.scope_risk ?? "",
      internal_coordination: p.internal_coordination ?? "",
      client_revision_risk: p.client_revision_risk ?? "",
      strategic_value_score: p.strategic_value_score ?? "",
      standalone_sell_price: p.standalone_sell_price ?? "",
      old_price: p.old_price ?? "",
      percent_change: p.percent_change ?? "",
      requires_customization: p.requires_customization,
      taxable: p.taxable,
      notes: p.notes ?? "",
      tags: p.tags ?? "",
    }))
  );
  xlsx.utils.book_append_sheet(wb, pricingWs, "pricing");

  xlsx.writeFile(wb, "bulk-import-template.xlsx");
}

const BULK_GLOSSARY: Record<
  | "packages"
  | "solutions"
  | "tiers"
  | "tasks"
  | "pricing"
  | "package_solution_tiers",
  { label: string; columns: Array<{ name: string; description: string }> }
> = {
  packages: {
    label: "packages",
    columns: [
      {
        name: "package_id",
        description: "Package ID (for example: 1-1). Keep this value unique.",
      },
      {
        name: "package_name",
        description: "Package name users see in the app.",
      },
      {
        name: "package_create_date",
        description: "Created date in YYYY-MM-DD format (optional).",
      },
      {
        name: "package_modified_date",
        description: "Last updated date in YYYY-MM-DD format (optional).",
      },
    ],
  },
  solutions: {
    label: "solutions",
    columns: [
      {
        name: "solution_id",
        description: "Solution ID (for example: 2-2). Keep this value unique.",
      },
      {
        name: "solution_name",
        description: "Solution name users see in the app.",
      },
      {
        name: "solution_created_date",
        description: "Created date in YYYY-MM-DD format (optional).",
      },
      {
        name: "solution_modified_date",
        description: "Last updated date in YYYY-MM-DD format (optional).",
      },
    ],
  },
  tiers: {
    label: "tiers",
    columns: [
      {
        name: "solution_tier_id",
        description: "Tier ID (for example: 3-3). Keep this value unique.",
      },
      { name: "solution_id", description: "Solution ID this tier belongs to." },
      {
        name: "solution_tier_name",
        description: "Tier name users see (for example: Basic, Standard, Advanced).",
      },
      { name: "solution_tier_owner", description: "Owner of this tier (person or role)." },
      { name: "solution_tier_overview", description: "Overview text shown in Agency mode." },
      { name: "solution_tier_overview_link", description: "Optional link label." },
      { name: "solution_tier_direction", description: "Direction text block." },
      { name: "solution_tier_sop", description: "SOP text block." },
      { name: "solution_tier_resources", description: "Resources text block." },
      { name: "solution_tier_created_date", description: "Created date in YYYY-MM-DD format (optional)." },
      { name: "solution_tier_modified_date", description: "Last updated date in YYYY-MM-DD format (optional)." },
    ],
  },
  tasks: {
    label: "tasks",
    columns: [
      { name: "task_id", description: "Task ID (for example: 4-21). Keep this value unique." },
      { name: "solution_tier_id", description: "Tier ID this task belongs to." },
      { name: "task_name", description: "Task name (for example: Conduct interviews)." },
      { name: "task_implementer", description: "Who does the task." },
      { name: "task_time", description: "Time number shown in KPI totals." },
      { name: "task_duration", description: "Optional duration number." },
      { name: "task_dependencies", description: "Dependencies or prerequisites." },
      { name: "task_notes", description: "Extra notes for the team." },
      { name: "task_create_date", description: "Created date in YYYY-MM-DD format (optional)." },
      { name: "task_modified_date", description: "Last updated date in YYYY-MM-DD format (optional)." },
    ],
  },
  pricing: {
    label: "pricing",
    columns: [
      { name: "solution_tier_id", description: "Tier ID for this pricing row (one row per tier)." },
      { name: "solution_label", description: "Optional solution label." },
      { name: "tier", description: "Optional tier label (example: Basic)." },
      { name: "scope", description: "Scope notes for this tier." },
      { name: "hours_client_services", description: "Hours for client services work." },
      { name: "hours_copy", description: "Hours for copy work." },
      { name: "hours_design", description: "Hours for design work." },
      { name: "hours_web_dev", description: "Hours for web development work." },
      { name: "hours_video", description: "Hours for video work." },
      { name: "hours_data", description: "Hours for data/analytics work." },
      { name: "hours_paid_media", description: "Hours for paid media work." },
      { name: "hours_hubspot", description: "Hours for HubSpot/automation work." },
      { name: "hours_other", description: "Hours for any other work." },
      { name: "scope_risk", description: "Score 0, 1, or 2." },
      { name: "internal_coordination", description: "Score 0, 1, or 2." },
      { name: "client_revision_risk", description: "Score 0, 1, or 2." },
      { name: "strategic_value_score", description: "Score 0, 1, or 2." },
      { name: "standalone_sell_price", description: "Optional standalone price." },
      { name: "old_price", description: "Optional old price." },
      { name: "percent_change", description: "Optional percent text (example: +8%)." },
      { name: "requires_customization", description: "TRUE or FALSE." },
      { name: "taxable", description: "TRUE or FALSE." },
      { name: "notes", description: "Optional notes." },
      { name: "tags", description: "Optional tags (comma-separated)." },
    ],
  },
  package_solution_tiers: {
    label: "package_solution_tiers",
    columns: [
      {
        name: "package_id",
        description: "Package ID this tier belongs to (must exist in packages sheet).",
      },
      {
        name: "solution_tier_id",
        description: "Tier ID (must exist in tiers sheet). Each tier may appear in at most one row.",
      },
      {
        name: "created_at",
        description: "Optional timestamp; may be left blank on import.",
      },
    ],
  },
};

function BulkImportPanel({
  packages,
  solutions,
  tiers,
  tasks,
  pricing,
  packageTiers,
  onSaved,
  setOpErr,
  setOpOk,
}: {
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  pricing: SolutionTierPricing[];
  packageTiers: PackageSolutionTier[];
  onSaved: () => Promise<void>;
  setOpErr: (s: string | null) => void;
  setOpOk: (s: string | null) => void;
}) {
  const [uploadedDoc, setUploadedDoc] = useState<BulkImportDoc | null>(null);
  const [uploadedFileName, setUploadedFileName] = useState<string>("");
  const [preview, setPreview] = useState<BulkPreview | null>(null);
  const [validErrs, setValidErrs] = useState<BulkValidationIssue[]>([]);
  const [isImporting, setIsImporting] = useState(false);
  const [templateNotice, setTemplateNotice] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<number>(0);
  const [importPhase, setImportPhase] = useState<string>("");
  const [importReport, setImportReport] = useState<ImportEntityCounts[] | null>(null);

  const runPreview = () => {
    setOpErr(null);
    setOpOk(null);
    if (!uploadedDoc) {
      setOpErr("Upload an Excel file first.");
      return;
    }
    try {
      const p = buildBulkPreview(uploadedDoc);
      const errs = validateBulkPreview(p, { packages, solutions, tiers });
      setPreview(p);
      setValidErrs(errs);
      if (errs.length > 0) {
        setOpErr(`Validation found ${errs.length} issue(s). Fix and preview again.`);
      } else {
        setOpOk(
          `Preview ready: ${p.packages.length} packages, ${p.solutions.length} solutions, ${p.tiers.length} tiers, ${p.tasks.length} tasks, ${p.pricing.length} pricing rows, ${p.package_solution_tiers.length} package ↔ tier links.`
        );
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to parse JSON.";
      setPreview(null);
      setValidErrs([]);
      setOpErr(msg);
    }
  };

  const loadExcelFile = async (file: File | null) => {
    if (!file) return;
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      setOpErr("Please upload an Excel file (.xlsx or .xls).");
      return;
    }
    try {
      const xlsx = await loadXlsx();
      const buf = await file.arrayBuffer();
      const wb = xlsx.read(buf, { type: "array" });
      const doc = bulkDocFromWorkbook(wb, xlsx);
      const version = workbookTemplateVersion(wb, xlsx);
      setUploadedDoc(doc);
      setUploadedFileName(file.name);
      setPreview(null);
      setValidErrs([]);
      setImportReport(null);
      setOpErr(null);
      if (version && version !== BULK_TEMPLATE_VERSION) {
        setTemplateNotice(
          `Template version ${version} is older than expected ${BULK_TEMPLATE_VERSION}. Download latest template to avoid column mismatch.`
        );
      } else {
        setTemplateNotice(null);
      }
      setOpOk(`Loaded ${file.name}. Click Preview import.`);
    } catch {
      setOpErr("Could not read that Excel file. Use the downloaded template format.");
    }
  };

  const doImport = async () => {
    if (!preview) {
      setOpErr("Run Preview first.");
      return;
    }
    if (validErrs.length > 0) {
      setOpErr("Fix validation errors before importing.");
      return;
    }
    const client = getSupabase();
    if (!client) {
      setOpErr("Supabase client unavailable.");
      return;
    }
    setOpErr(null);
    setOpOk(null);
    setIsImporting(true);
    setImportProgress(0);
    setImportPhase("Preparing import...");
    setImportReport(null);
    try {
      let completedChunks = 0;
      const pstChunks = preview.package_solution_tiers.length
        ? 1
        : 0;
      const totalChunks =
        chunkRows(preview.packages, BULK_IMPORT_CHUNK_SIZE).length +
        chunkRows(preview.solutions, BULK_IMPORT_CHUNK_SIZE).length +
        chunkRows(preview.tiers, BULK_IMPORT_CHUNK_SIZE).length +
        chunkRows(preview.tasks, BULK_IMPORT_CHUNK_SIZE).length +
        chunkRows(preview.pricing, BULK_IMPORT_CHUNK_SIZE).length +
        pstChunks;
      const tick = (phase: string) => {
        completedChunks += 1;
        setImportPhase(phase);
        const pct = totalChunks > 0 ? Math.round((completedChunks / totalChunks) * 100) : 100;
        setImportProgress(Math.min(100, pct));
      };

      const processEntity = async <T extends { [k: string]: unknown }>(args: {
        tableLabel: ImportEntityCounts["table"];
        tableName: "packages" | "solutions" | "solution_tiers" | "tasks" | "solution_tier_pricing";
        rows: T[];
        key: keyof T & string;
        existing: Set<string>;
        phaseLabel: string;
      }): Promise<ImportEntityCounts> => {
        const chunks = chunkRows(args.rows, BULK_IMPORT_CHUNK_SIZE);
        const counts: ImportEntityCounts = {
          table: args.tableLabel,
          total: args.rows.length,
          created: 0,
          updated: 0,
          failed: 0,
          skipped: 0,
        };
        for (const chunk of chunks) {
          const createdInChunk = chunk.filter((r) => !args.existing.has(String(r[args.key]))).length;
          const updatedInChunk = chunk.length - createdInChunk;
          const { error } = await client
            .from(args.tableName)
            .upsert(chunk as never, { onConflict: args.key });
          if (!error) {
            counts.created += createdInChunk;
            counts.updated += updatedInChunk;
            for (const row of chunk) args.existing.add(String(row[args.key]));
          } else {
            for (const row of chunk) {
              const id = String(row[args.key]);
              const { error: rowErr } = await client
                .from(args.tableName)
                .upsert(row as never, { onConflict: args.key });
              if (rowErr) counts.failed += 1;
              else {
                if (args.existing.has(id)) counts.updated += 1;
                else counts.created += 1;
                args.existing.add(id);
              }
            }
          }
          tick(args.phaseLabel);
        }
        return counts;
      };

      const reports: ImportEntityCounts[] = [];
      const existingPkg = new Set(packages.map((x) => x.package_id));
      const existingSol = new Set(solutions.map((x) => x.solution_id));
      const existingTier = new Set(tiers.map((x) => x.solution_tier_id));
      const existingTask = new Set(tasks.map((x) => x.task_id));
      const existingPricing = new Set(pricing.map((x) => x.solution_tier_id));

      reports.push(
        await processEntity({
          tableLabel: "packages",
          tableName: "packages",
          rows: preview.packages,
          key: "package_id",
          existing: existingPkg,
          phaseLabel: "Importing packages...",
        })
      );
      reports.push(
        await processEntity({
          tableLabel: "solutions",
          tableName: "solutions",
          rows: preview.solutions,
          key: "solution_id",
          existing: existingSol,
          phaseLabel: "Importing solutions...",
        })
      );
      reports.push(
        await processEntity({
          tableLabel: "tiers",
          tableName: "solution_tiers",
          rows: preview.tiers,
          key: "solution_tier_id",
          existing: existingTier,
          phaseLabel: "Importing tiers...",
        })
      );
      reports.push(
        await processEntity({
          tableLabel: "tasks",
          tableName: "tasks",
          rows: preview.tasks,
          key: "task_id",
          existing: existingTask,
          phaseLabel: "Importing tasks...",
        })
      );
      reports.push(
        await processEntity({
          tableLabel: "pricing",
          tableName: "solution_tier_pricing",
          rows: preview.pricing as Record<string, unknown>[],
          key: "solution_tier_id",
          existing: existingPricing,
          phaseLabel: "Importing pricing...",
        })
      );

      if (preview.package_solution_tiers.length > 0) {
        setImportPhase("Importing package ↔ tier links...");
        const tierIds = preview.package_solution_tiers.map((r) => r.solution_tier_id);
        const { error: pstDelErr } = await client
          .from("package_solution_tiers")
          .delete()
          .in("solution_tier_id", tierIds);
        if (pstDelErr) {
          setOpErr(friendlyMutationMessage(pstDelErr.message));
          tick("Package ↔ tier links");
          return;
        }
        const { error: pstInsErr } = await client
          .from("package_solution_tiers")
          .insert(preview.package_solution_tiers);
        if (pstInsErr) {
          setOpErr(friendlyMutationMessage(pstInsErr.message));
          tick("Package ↔ tier links");
          return;
        }
        reports.push({
          table: "package_solution_tiers",
          total: preview.package_solution_tiers.length,
          created: preview.package_solution_tiers.length,
          updated: 0,
          failed: 0,
          skipped: 0,
        });
        tick("Package ↔ tier links");
      }

      const stamp = new Date().toISOString();
      await insertAuditLog(client, {
        entityType: "packages",
        entityId: `bulk-import:${stamp}`,
        action: "update",
        before: null,
        after: { report: reports, file: uploadedFileName || null },
      });

      await onSaved();
      setImportProgress(100);
      setImportPhase("Import complete");
      setImportReport(reports);
      const failed = reports.reduce((n, r) => n + r.failed, 0);
      setOpOk(
        failed > 0
          ? `Import finished with ${failed} failed row(s). Review report below.`
          : "Import complete with no row failures."
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Import failed.";
      setOpErr(msg);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <section className="admin-panel admin-panel--editor" style={panel}>
      <div className="admin-editor-layout admin-editor-layout--wide admin-bulk-import">
        <h2 style={h2}>Bulk Import</h2>
        <div className="admin-bulk-import__hero">
          <p className="admin-intro admin-bulk-import__intro" style={muted}>
            Use this tab to import many rows at once from Excel. Download the template, fill each sheet,
            upload it, preview, then run import.
          </p>
          <ol className="admin-bulk-import__steps" style={muted}>
            <li>Click <strong>Download Excel template</strong>.</li>
            <li>
              Fill the sheets: packages, solutions, tiers, tasks, pricing, package_solution_tiers.
            </li>
            <li>Upload the file, then click <strong>Preview import</strong>.</li>
            <li>If preview looks good, click <strong>Run import</strong>.</li>
          </ol>
          <div className="admin-actions-row admin-bulk-import__actions" style={{ marginTop: 2 }}>
            <button
              type="button"
              style={btn}
              onClick={() =>
                void downloadBulkTemplateWorkbook({
                  packages,
                  solutions,
                  tiers,
                  tasks,
                  pricing,
                  packageTiers,
                })
              }
              disabled={isImporting}
            >
              Download Excel template
            </button>
            <label style={{ ...btn, display: "inline-flex", alignItems: "center", gap: 8 }}>
              Upload Excel file
              <input
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
                style={{ display: "none" }}
                onChange={(e) => void loadExcelFile(e.target.files?.[0] ?? null)}
                disabled={isImporting}
              />
            </label>
          </div>
          {uploadedFileName ? (
            <p className="admin-hint admin-bulk-import__file-note" style={{ ...muted, marginTop: 6 }}>
              Uploaded file: <strong>{uploadedFileName}</strong>
            </p>
          ) : null}
        {templateNotice ? (
          <p className="admin-hint" style={{ ...muted, marginTop: 4, color: "#92400e" }}>
            {templateNotice}
          </p>
        ) : null}
          <p className="admin-hint admin-bulk-import__hint" style={{ ...muted, marginTop: 4 }}>
            Use the <code>package_solution_tiers</code> sheet to link tiers to packages (one row per
            tier; each tier can appear at most once).
          </p>
        </div>
        <div
          className="admin-bulk-import__card"
          style={{
            marginTop: 10,
            border: "1px solid var(--border)",
            borderRadius: 12,
            padding: "0.85rem 0.9rem",
            background: "rgba(255, 252, 247, 0.7)",
          }}
        >
          <h3 style={{ ...h2, fontSize: "0.94rem", marginBottom: "0.45rem" }}>
            How pricing is calculated
          </h3>
          <p style={{ ...muted, marginTop: 0, marginBottom: 6 }}>
            Enter hours and 0-2 scores in the <code>pricing</code> sheet. The importer calculates the
            derived price fields automatically.
          </p>
          <ul style={{ ...muted, margin: "0 0 0 1.1rem", lineHeight: 1.5 }}>
            <li>
              <strong>Expected effort</strong> = total hours x hourly rate ($210).
            </li>
            <li>
              <strong>Risk multiplier</strong> is based on{" "}
              <code>scope_risk + internal_coordination + client_revision_risk</code>.
            </li>
            <li>
              <strong>Risk mitigated base</strong> = expected effort x risk multiplier.
            </li>
            <li>
              <strong>Strategic multiplier</strong> comes from <code>strategic_value_score</code> (0-2).
            </li>
            <li>
              <strong>Sell price</strong> = risk mitigated base x strategic multiplier, rounded up to the
              nearest $100.
            </li>
          </ul>
        </div>
        <div className="admin-actions-row">
          <button type="button" style={btn} onClick={runPreview} disabled={isImporting}>
            Preview import
          </button>
          <button
            type="button"
            className="admin-btn-primary"
            style={btnPrimary}
            onClick={() => void doImport()}
            disabled={isImporting || !preview || validErrs.length > 0}
          >
            {isImporting ? "Importing..." : "Run import"}
          </button>
          <button
            type="button"
            style={btn}
            onClick={() => {
              setUploadedDoc(null);
              setUploadedFileName("");
              setPreview(null);
              setValidErrs([]);
              setImportReport(null);
              setTemplateNotice(null);
              setImportProgress(0);
              setImportPhase("");
              setOpErr(null);
              setOpOk(null);
            }}
            disabled={isImporting}
          >
            Clear
          </button>
        </div>

        {preview && (
          <div className="admin-table-scroll" style={{ marginTop: 12 }}>
            <table className="admin-data-table" style={tbl}>
              <thead>
                <tr>
                  <th style={th}>Entity</th>
                  <th style={th}>Rows in payload</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={td}>packages</td>
                  <td style={td}>{preview.packages.length}</td>
                </tr>
                <tr>
                  <td style={td}>solutions</td>
                  <td style={td}>{preview.solutions.length}</td>
                </tr>
                <tr>
                  <td style={td}>tiers</td>
                  <td style={td}>{preview.tiers.length}</td>
                </tr>
                <tr>
                  <td style={td}>tasks</td>
                  <td style={td}>{preview.tasks.length}</td>
                </tr>
                <tr>
                  <td style={td}>pricing</td>
                  <td style={td}>{preview.pricing.length}</td>
                </tr>
                <tr>
                  <td style={td}>package_solution_tiers</td>
                  <td style={td}>{preview.package_solution_tiers.length}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {validErrs.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <p style={{ ...muted, color: "var(--danger)", margin: "0 0 0.35rem" }}>
              Validation issues ({validErrs.length}):
            </p>
            <ul style={{ margin: 0, paddingLeft: "1.2rem", color: "var(--danger)", fontSize: "0.86rem" }}>
              {validErrs.map((x) => (
                <li key={`${x.table}:${x.row}:${x.column ?? ""}:${x.message}`}>
                  [{x.table} row {x.row}
                  {x.column ? `, ${x.column}` : ""}] {x.message}
                </li>
              ))}
            </ul>
            <div className="admin-actions-row" style={{ marginTop: 8 }}>
              <button type="button" style={btn} onClick={() => void downloadValidationErrorsWorkbook(validErrs)}>
                Download errors workbook
              </button>
            </div>
          </div>
        )}
        {(isImporting || importReport) && (
          <div className="admin-table-scroll" style={{ marginTop: 12 }}>
            <p className="admin-hint" style={{ ...muted, marginBottom: 6 }}>
              {importPhase || "Import status"} {isImporting ? `(${importProgress}%)` : ""}
            </p>
            {isImporting ? (
              <div style={{ width: "100%", background: "rgba(0,0,0,0.08)", borderRadius: 999, height: 8 }}>
                <div
                  style={{
                    width: `${importProgress}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: "var(--accent)",
                  }}
                />
              </div>
            ) : null}
            {importReport ? (
              <table className="admin-data-table" style={{ ...tbl, marginTop: 10 }}>
                <thead>
                  <tr>
                    <th style={th}>Table</th>
                    <th style={th}>Total</th>
                    <th style={th}>Created</th>
                    <th style={th}>Updated</th>
                    <th style={th}>Failed</th>
                    <th style={th}>Skipped</th>
                  </tr>
                </thead>
                <tbody>
                  {importReport.map((r) => (
                    <tr key={r.table}>
                      <td style={td}>{r.table}</td>
                      <td style={td}>{r.total}</td>
                      <td style={td}>{r.created}</td>
                      <td style={td}>{r.updated}</td>
                      <td style={td}>{r.failed}</td>
                      <td style={td}>{r.skipped}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function DataGlossaryPanel() {
  const [glossaryTable, setGlossaryTable] = useState<keyof typeof BULK_GLOSSARY>("packages");

  return (
    <section className="admin-panel admin-panel--editor" style={panel}>
      <div className="admin-editor-layout admin-editor-layout--wide">
        <h2 style={h2}>Data Glossary</h2>
        <p className="admin-intro" style={muted}>
          Select a table to see column names and plain-language descriptions for template uploads.
        </p>
        <label style={{ ...lbl, maxWidth: 320 }}>
          <AdminFieldCaption>Table</AdminFieldCaption>
          <select
            style={input}
            value={glossaryTable}
            onChange={(e) =>
              setGlossaryTable(e.target.value as keyof typeof BULK_GLOSSARY)
            }
          >
            <option value="packages">packages</option>
            <option value="solutions">solutions</option>
            <option value="tiers">tiers</option>
            <option value="tasks">tasks</option>
            <option value="pricing">pricing</option>
            <option value="package_solution_tiers">package_solution_tiers</option>
          </select>
        </label>
        <div className="admin-table-scroll" style={{ marginTop: 10 }}>
          <table className="admin-data-table" style={tbl}>
            <thead>
              <tr>
                <th style={th}>Column</th>
                <th style={th}>Description</th>
              </tr>
            </thead>
            <tbody>
              {BULK_GLOSSARY[glossaryTable].columns.map((c) => (
                <tr key={c.name}>
                  <td style={td}>
                    <code>{c.name}</code>
                  </td>
                  <td style={td}>{c.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function PackagesPanel({
  subTab,
  packages,
  solutions,
  tiers,
  packageTiers,
  onSaved,
  setOpErr,
  setOpOk,
  logAudit,
}: {
  subTab: AdminSubTab;
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  packageTiers: PackageSolutionTier[];
  onSaved: () => Promise<void>;
  setOpErr: (s: string | null) => void;
  setOpOk: (s: string | null) => void;
  logAudit: (
    client: SupabaseClient,
    p: Parameters<typeof insertAuditLog>[1]
  ) => Promise<void>;
}) {
  const [nameField, setNameField] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedTierIds, setSelectedTierIds] = useState<string[]>([]);
  const [tierSearch, setTierSearch] = useState("");

  const startNew = () => {
    setEditingId(null);
    setNameField("");
    setSelectedTierIds([]);
    setTierSearch("");
  };

  const loadPackageForEdit = (p: Package) => {
    setEditingId(p.package_id);
    setNameField(p.package_name);
    setTierSearch("");
    setSelectedTierIds(
      packageTiers.filter((r) => r.package_id === p.package_id).map((r) => r.solution_tier_id)
    );
  };

  useEffect(() => {
    if (subTab === "create") startNew();
  }, [subTab]);

  const solutionById = useMemo(() => {
    const m = new Map<string, Solution>();
    for (const s of solutions) m.set(s.solution_id, s);
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

  const toggleTier = (tierId: string, include: boolean) => {
    setSelectedTierIds((prev) => {
      if (include) return prev.includes(tierId) ? prev : [...prev, tierId];
      return prev.filter((x) => x !== tierId);
    });
  };

  /** Each tier belongs to at most one package (unique solution_tier_id in junction). */
  const applyPackageTierMembership = async (
    client: SupabaseClient,
    packageId: string,
    wantedTierIds: string[]
  ): Promise<string | null> => {
    const { error: e0 } = await client
      .from("package_solution_tiers")
      .delete()
      .eq("package_id", packageId);
    if (e0) return friendlyMutationMessage(e0.message);
    if (wantedTierIds.length === 0) return null;
    const { error: e1 } = await client
      .from("package_solution_tiers")
      .delete()
      .in("solution_tier_id", wantedTierIds);
    if (e1) return friendlyMutationMessage(e1.message);
    const { error: e2 } = await client.from("package_solution_tiers").insert(
      wantedTierIds.map((solution_tier_id) => ({ package_id: packageId, solution_tier_id }))
    );
    if (e2) return friendlyMutationMessage(e2.message);
    return null;
  };

  const save = async () => {
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    const today = todayISODate();
    const wanted = [...selectedTierIds];

    if (subTab === "create") {
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
      const assignErr = await applyPackageTierMembership(client, newId, wanted);
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
      setOpOk(`Package created as ${newId} with ${wanted.length} tier link(s).`);
      startNew();
      await onSaved();
      return;
    }

    if (!editingId) {
      setOpErr("Select a package to update.");
      return;
    }
    const prev = packages.find((x) => x.package_id === editingId);
    if (!prev) return;
    const name = nameField.trim();
    if (!name) {
      setOpErr("Name is required.");
      return;
    }
    const { error } = await client
      .from("packages")
      .update({ package_name: name, package_modified_date: today })
      .eq("package_id", editingId);
    if (error) {
      setOpErr(friendlyMutationMessage(error.message));
      return;
    }
    const afterPkg = { ...prev, package_name: name, package_modified_date: today };
    await logAudit(client, {
      entityType: "packages",
      entityId: editingId,
      action: "update",
      before: rowJson(prev),
      after: rowJson(afterPkg),
    });
    const assignErr = await applyPackageTierMembership(client, editingId, wanted);
    if (assignErr) {
      setOpErr(assignErr);
      await onSaved();
      return;
    }
    setOpOk("Package and tier links saved.");
    startNew();
    await onSaved();
  };

  const removeCurrentPackage = async () => {
    if (!editingId) {
      setOpErr("Select a package first.");
      return;
    }
    const p = packages.find((x) => x.package_id === editingId);
    if (!p) return;
    if (
      !window.confirm(
        `Delete package "${p.package_name}" (${p.package_id})? Tier links for this package will be removed.`
      )
    ) {
      return;
    }
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    const { error } = await client.from("packages").delete().eq("package_id", p.package_id);
    if (error) {
      setOpErr(friendlyMutationMessage(error.message));
      return;
    }
    await logAudit(client, {
      entityType: "packages",
      entityId: p.package_id,
      action: "delete",
      before: rowJson(p),
      after: null,
    });
    setOpOk("Package deleted.");
    startNew();
    await onSaved();
  };

  const isCreate = subTab === "create";

  const tierPickerIntro =
    "Check each solution tier to include in this package. A tier can only belong to one package at a time; saving here moves it from another package if needed.";

  const tierPickerBlock = (
    <>
      <p className="admin-intro" style={{ ...muted, marginTop: "0.75rem" }}>
        {tierPickerIntro}
      </p>
      <label style={{ ...lbl, marginTop: 8 }}>
        <AdminFieldCaption>Filter tiers</AdminFieldCaption>
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
                const pkgLabel =
                  pid == null
                    ? "—"
                    : `${packageNameById.get(pid) ?? "—"} (${pid})`;
                return (
                  <tr key={t.solution_tier_id}>
                    <td style={td}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) =>
                          toggleTier(t.solution_tier_id, e.target.checked)
                        }
                        aria-label={`Include tier ${t.solution_tier_name} in this package`}
                      />
                    </td>
                    <td style={td}>{sol?.solution_name ?? t.solution_id}</td>
                    <td style={td}>{t.solution_tier_name}</td>
                    <td style={td}>
                      <code style={{ fontSize: "0.85em" }}>{t.solution_tier_id}</code>
                    </td>
                    <td style={{ ...td, fontSize: "0.88em", color: "var(--muted, #666)" }}>
                      {pkgLabel}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );

  return (
    <section className="admin-panel admin-panel--editor" style={panel}>
      <div className="admin-editor-layout">
        <h2 style={h2}>Package Builder</h2>
        {isCreate ? (
          <>
            <p className="admin-intro" style={muted}>
              Name the bundle and choose which solution tiers belong to it. The next package id in
              the <code style={{ fontSize: "0.9em" }}>1-n</code> sequence is assigned automatically
              (for example if the highest existing id is <code style={{ fontSize: "0.9em" }}>1-11</code>
              , the new package becomes <code style={{ fontSize: "0.9em" }}>1-12</code>).
            </p>
            <div className="admin-form-stack" style={formGrid}>
              <label style={lbl}>
                <AdminFieldCaption>Next package id (preview)</AdminFieldCaption>
                <input
                  style={{ ...input, opacity: 0.92 }}
                  readOnly
                  value={packages.length ? nextAutoPackageId(packages) : "1-1"}
                  aria-readonly="true"
                />
              </label>
              <label style={lbl}>
                <AdminFieldCaption>Name</AdminFieldCaption>
                <input
                  style={input}
                  value={nameField}
                  onChange={(e) => setNameField(e.target.value)}
                  placeholder="Display name"
                />
              </label>
            </div>
            {tierPickerBlock}
            <div className="admin-actions-row">
              <button
                type="button"
                className="admin-btn-primary"
                style={btnPrimary}
                onClick={() => void save()}
              >
                Create package
              </button>
              <button type="button" style={btn} onClick={startNew}>
                Clear form
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="admin-intro" style={muted}>
              Select an existing package, rename it if needed, and add or remove individual
              solution tiers using the list below.
            </p>
            <div className="admin-form-stack" style={formGrid}>
              <label style={lbl}>
                <AdminFieldCaption>Package</AdminFieldCaption>
                <select
                  style={input}
                  value={editingId ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) {
                      startNew();
                      return;
                    }
                    const p = packages.find((x) => x.package_id === v);
                    if (p) loadPackageForEdit(p);
                  }}
                >
                  <option value="">Select a package…</option>
                  {[...packages]
                    .sort((a, b) => sortId(a.package_id, b.package_id))
                    .map((p) => (
                      <option key={p.package_id} value={p.package_id}>
                        {p.package_name} ({p.package_id})
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {editingId ? (
              <>
                <h3 className="admin-editing-heading" style={{ marginTop: "1rem" }}>
                  Editing <code style={{ fontSize: "0.9em" }}>{editingId}</code>
                </h3>
                <div className="admin-form-stack" style={formGrid}>
                  <label style={lbl}>
                    <AdminFieldCaption>
                      Package id <span style={muted}>(locked)</span>
                    </AdminFieldCaption>
                    <input style={input} value={editingId} disabled />
                  </label>
                  <label style={lbl}>
                    <AdminFieldCaption>Name</AdminFieldCaption>
                    <input
                      style={input}
                      value={nameField}
                      onChange={(e) => setNameField(e.target.value)}
                      placeholder="Display name"
                    />
                  </label>
                </div>
                {tierPickerBlock}
                <div className="admin-actions-row">
                  <button
                    type="button"
                    className="admin-btn-primary"
                    style={btnPrimary}
                    onClick={() => void save()}
                  >
                    Save changes
                  </button>
                  <button type="button" style={btn} onClick={startNew}>
                    Clear selection
                  </button>
                  <button
                    type="button"
                    style={btnDangerSm}
                    onClick={() => void removeCurrentPackage()}
                  >
                    Delete package
                  </button>
                </div>
              </>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}


const shell: CSSProperties = {
  minHeight: "100%",
  padding: "1.25rem clamp(1.5rem, 5vw, 4rem) 2.5rem",
};

const title: CSSProperties = {
  margin: "0 0 0.55rem",
  fontSize: "1.5rem",
  fontWeight: 700,
  letterSpacing: "-0.035em",
  lineHeight: 1.22,
};

const subtitle: CSSProperties = {
  margin: 0,
  color: "var(--muted)",
  fontSize: "0.94rem",
  maxWidth: "min(100%, 68rem)",
  lineHeight: 1.55,
};

const btnReload: CSSProperties = {
  padding: "0.5rem 1rem",
  fontSize: "0.85rem",
  fontWeight: 600,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
};

const link: CSSProperties = { color: "var(--accent)", fontWeight: 600 };

const muted: CSSProperties = { color: "var(--muted)", fontSize: "0.88rem" };

const bannerErr: CSSProperties = {
  padding: "0.85rem 1.05rem",
  borderRadius: "var(--radius-lg)",
  background: "#fef2f2",
  border: "1px solid #fecaca",
  color: "var(--danger)",
  marginBottom: "0.85rem",
  fontSize: "0.9rem",
  lineHeight: 1.45,
};

const bannerOk: CSSProperties = {
  padding: "0.85rem 1.05rem",
  borderRadius: "var(--radius-lg)",
  background: "#ecfdf5",
  border: "1px solid #a7f3d0",
  color: "#065f46",
  marginBottom: "0.85rem",
  fontSize: "0.9rem",
  lineHeight: 1.45,
};

const bannerNote: CSSProperties = {
  padding: "0.85rem 1.05rem",
  borderRadius: "var(--radius-lg)",
  background: "#fffbeb",
  border: "1px solid #fde68a",
  color: "#92400e",
  marginBottom: "0.85rem",
  fontSize: "0.88rem",
  lineHeight: 1.45,
};

const panel: CSSProperties = {
  padding: "1.25rem 1.35rem",
  marginBottom: "1.25rem",
};

const h2: CSSProperties = {
  margin: "0 0 0.85rem",
  fontSize: "1.08rem",
  fontWeight: 700,
  letterSpacing: "-0.02em",
};

const formGrid: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
  gap: "0.75rem",
};

const lbl: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "0.35rem",
  fontSize: "0.78rem",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  color: "var(--muted)",
};

const input: CSSProperties = {
  fontFamily: "inherit",
  fontSize: "0.9rem",
  padding: "0.5rem 0.65rem",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "rgba(255, 252, 247, 0.95)",
  color: "var(--text)",
  width: "100%",
};

const textarea: CSSProperties = {
  ...input,
  resize: "vertical" as const,
  minHeight: 64,
};

const btn: CSSProperties = {
  padding: "0.5rem 0.9rem",
  fontSize: "0.85rem",
  fontWeight: 600,
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--surface)",
  color: "var(--text)",
  cursor: "pointer",
  transition: "background 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
};

const btnPrimary: CSSProperties = {
  ...btn,
  background: "var(--accent)",
  color: "#fffcf7",
  borderColor: "rgba(13, 92, 77, 0.45)",
};

const btnSm: CSSProperties = {
  padding: "0.32rem 0.58rem",
  fontSize: "0.78rem",
  fontWeight: 600,
  borderRadius: 8,
  border: "1px solid var(--border)",
  background: "rgba(255, 252, 247, 0.95)",
  cursor: "pointer",
  transition: "background 0.12s ease",
};

const btnDangerSm: CSSProperties = {
  ...btnSm,
  borderColor: "#fecaca",
  color: "var(--danger)",
  background: "#fef2f2",
};

const tbl: CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "0.85rem",
};

const th: CSSProperties = {
  textAlign: "left",
  padding: "0.5rem 0.6rem",
  borderBottom: "2px solid var(--border)",
  color: "var(--muted)",
  fontWeight: 600,
  fontSize: "0.8rem",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
};

const td: CSSProperties = {
  padding: "0.52rem 0.6rem",
  borderBottom: "1px solid var(--border)",
  verticalAlign: "top",
};

const preJson: CSSProperties = {
  marginTop: 8,
  padding: 8,
  background: "var(--bg)",
  borderRadius: 6,
  fontSize: "0.72rem",
  overflow: "auto",
  maxWidth: 420,
};
