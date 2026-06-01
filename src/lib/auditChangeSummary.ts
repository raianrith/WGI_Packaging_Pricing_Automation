import type {
  AuditLogRow,
  Package,
  PackageSolutionTier,
  Solution,
  SolutionTier,
  SolutionTierTaskGroupApplied,
  TaskGroupLineRow,
  TaskGroupRow,
  TaskRow,
} from "../types";

/** User-facing label for `audit_log.entity_type` (table name). */
export const AUDIT_RECORD_TYPE_LABELS: Record<string, string> = {
  packages: "Package",
  solutions: "Solution",
  solution_tiers: "Solution tier",
  solution_tier_pricing: "Tier pricing",
  package_solution_tiers: "Package ↔ tier link",
  tasks: "Task",
  task_groups: "Task group",
  task_group_lines: "Task group line",
  solution_tier_task_group_applied: "Task group on tier",
};

export function auditRecordTypeLabel(entityType: string): string {
  return AUDIT_RECORD_TYPE_LABELS[entityType] ?? entityType.replace(/_/g, " ");
}

export function auditActionLabel(action: string): string {
  switch (action) {
    case "insert":
      return "Created";
    case "update":
      return "Updated";
    case "delete":
      return "Deleted";
    default:
      return action;
  }
}

const FIELD_LABEL_OVERRIDES: Record<string, string> = {
  package_id: "Package",
  package_name: "Package name",
  solution_id: "Solution",
  solution_name: "Solution name",
  solution_tier_id: "Solution tier",
  solution_tier_name: "Tier name",
  solution_tier_phase: "Tier phase",
  solution_tier_category: "Tier category",
  solution_tier_tactic: "Tier tactic",
  task_id: "Task",
  task_name: "Task name",
  task_implementer: "Implementer",
  task_time: "Hours",
  task_duration: "Duration",
  task_dependencies: "Dependencies",
  task_notes: "Notes",
  task_group_id: "Task group",
  name: "Name",
  description: "Description",
  solution_label: "Solution label",
  tier: "Tier label",
  scope: "Scope",
  sort_order: "Sort order",
  line_type: "Line type",
  source_task_id: "Source task",
  hours: "Hours",
};

export function humanizeAuditField(key: string): string {
  const o = FIELD_LABEL_OVERRIDES[key];
  if (o) return o;
  return key
    .replace(/_/g, " ")
    .replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function formatAuditScalar(value: unknown, maxLen = 160): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : String(value);
  if (typeof value === "string") {
    const t = value.trim();
    if (!t.length) return "—";
    return t.length > maxLen ? `${t.slice(0, maxLen - 1)}…` : t;
  }
  try {
    const s = JSON.stringify(value);
    return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
  } catch {
    return String(value);
  }
}

function stableSerialize(value: unknown): string {
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    const norm: Record<string, unknown> = {};
    for (const k of keys) norm[k] = o[k];
    return JSON.stringify(norm);
  }
  return JSON.stringify(value);
}

export type AuditDiffLine = {
  field: string;
  fieldLabel: string;
  before: string;
  after: string;
};

/** Field-level changes for updates. Inserts/deletes typically use snapshots only in raw JSON. */
export function computeAuditDiff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null
): AuditDiffLine[] {
  if (!before || !after) return [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const lines: AuditDiffLine[] = [];
  for (const field of keys) {
    const bv = before[field];
    const av = after[field];
    if (stableSerialize(bv) === stableSerialize(av)) continue;
    lines.push({
      field,
      fieldLabel: humanizeAuditField(field),
      before: formatAuditScalar(bv),
      after: formatAuditScalar(av),
    });
  }
  lines.sort((a, b) => a.fieldLabel.localeCompare(b.fieldLabel));
  return lines;
}

const NAME_KEYS = [
  "package_name",
  "solution_name",
  "solution_tier_name",
  "task_name",
  "name",
] as const;

/** Best-effort display name from a stored snapshot when the row isn’t in the loaded workspace. */
export function pickNameFromSnapshot(data: Record<string, unknown> | null | undefined): string | null {
  if (!data) return null;
  for (const k of NAME_KEYS) {
    const v = data[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

export type AuditLookupInput = {
  packages: Package[];
  solutions: Solution[];
  tiers: SolutionTier[];
  tasks: TaskRow[];
  taskGroups: TaskGroupRow[];
  taskGroupLines: TaskGroupLineRow[];
  taskGroupApplied: SolutionTierTaskGroupApplied[];
  packageTiers: PackageSolutionTier[];
};

export function createAuditEntityLabelResolver(input: AuditLookupInput) {
  const pkgName = new Map(input.packages.map((p) => [p.package_id, p.package_name]));
  const solName = new Map(input.solutions.map((s) => [s.solution_id, s.solution_name]));
  const tierRow = new Map(input.tiers.map((t) => [t.solution_tier_id, t]));

  function tierDisplay(tierId: string): string | null {
    const t = tierRow.get(tierId);
    if (!t) return null;
    const sol = solName.get(t.solution_id);
    return sol ? `${t.solution_tier_name} (${sol})` : t.solution_tier_name;
  }

  /**
   * Short line for the Change History table: which package, solution, tier, or group
   * this row belongs with (derived from entity id and snapshots).
   */
  function relatedContext(row: AuditLogRow): string {
    const snap = (row.after_data ?? row.before_data ?? undefined) as Record<string, unknown> | undefined;

    switch (row.entity_type) {
      case "packages": {
        let tierIds: string[] = [];
        if (snap && Array.isArray(snap.solution_tier_ids)) {
          tierIds = (snap.solution_tier_ids as unknown[]).filter((x): x is string => typeof x === "string");
        }
        if (tierIds.length === 0) {
          tierIds = [
            ...new Set(
              input.packageTiers.filter((x) => x.package_id === row.entity_id).map((x) => x.solution_tier_id)
            ),
          ];
        }
        if (tierIds.length === 0) return "No linked tiers";
        const labels = tierIds.map((id) => tierDisplay(id) ?? id);
        const max = 4;
        const head = labels.slice(0, max).join(" · ");
        const tail = labels.length > max ? ` (+${labels.length - max} more)` : "";
        return `Tiers (${tierIds.length}): ${head}${tail}`;
      }
      case "solutions": {
        const n = input.tiers.filter((t) => t.solution_id === row.entity_id).length;
        return n === 0 ? "No tiers in vault" : `${n} tier(s) on this solution`;
      }
      case "solution_tiers":
      case "solution_tier_pricing": {
        const t = tierRow.get(row.entity_id);
        if (!t) {
          const td = tierDisplay(row.entity_id);
          return td ? `Tier: ${td}` : "—";
        }
        const sol = solName.get(t.solution_id);
        return sol ? `Solution: ${sol}` : `Tier: ${t.solution_tier_name}`;
      }
      case "tasks": {
        const task = input.tasks.find((x) => x.task_id === row.entity_id);
        if (!task) return "—";
        const td = tierDisplay(task.solution_tier_id);
        return td ? `Tier: ${td}` : `Tier id ${task.solution_tier_id}`;
      }
      case "package_solution_tiers": {
        const pid = snap && typeof snap.package_id === "string" ? snap.package_id : null;
        const stid = snap && typeof snap.solution_tier_id === "string" ? snap.solution_tier_id : null;
        if (!pid || !stid) return "—";
        const pkgN = pkgName.get(pid) ?? pid;
        const tierN = tierDisplay(stid) ?? stid;
        return `Package: ${pkgN} · Tier: ${tierN}`;
      }
      case "task_groups": {
        const lines = input.taskGroupLines.filter((l) => l.task_group_id === row.entity_id).length;
        return lines > 0 ? `${lines} line(s) in group` : "Task group template";
      }
      case "task_group_lines": {
        const line = input.taskGroupLines.find((x) => x.id === row.entity_id);
        const g = line ? input.taskGroups.find((x) => x.id === line.task_group_id) : null;
        return g?.name?.trim() ? `Task group: ${g.name.trim()}` : "—";
      }
      case "solution_tier_task_group_applied": {
        const app = input.taskGroupApplied.find((a) => a.id === row.entity_id);
        const tid =
          app?.solution_tier_id ??
          (snap && typeof snap.solution_tier_id === "string" ? snap.solution_tier_id : null);
        const gid =
          app?.task_group_id ?? (snap && typeof snap.task_group_id === "string" ? snap.task_group_id : null);
        const gname = gid != null ? input.taskGroups.find((g) => g.id === gid)?.name?.trim() : null;
        const tierL = tid != null ? tierDisplay(tid) : null;
        const parts = [
          gname ? `Group: ${gname}` : null,
          tierL ? `Tier: ${tierL}` : null,
        ].filter(Boolean);
        return parts.length ? parts.join(" · ") : "—";
      }
      default:
        return "—";
    }
  }

  function labelFor(entityType: string, entityId: string, row: AuditLogRow): string | null {
    switch (entityType) {
      case "packages":
        return pkgName.get(entityId) ?? null;
      case "solutions":
        return solName.get(entityId) ?? null;
      case "solution_tiers":
      case "solution_tier_pricing":
        return tierDisplay(entityId);
      case "tasks": {
        const task = input.tasks.find((x) => x.task_id === entityId);
        if (task?.task_name?.trim()) return task.task_name.trim();
        return pickNameFromSnapshot(row.after_data ?? row.before_data ?? undefined);
      }
      case "task_groups": {
        const g = input.taskGroups.find((x) => x.id === entityId);
        return g?.name?.trim() ? g.name.trim() : null;
      }
      case "task_group_lines": {
        const line = input.taskGroupLines.find((x) => x.id === entityId);
        if (!line) return pickNameFromSnapshot(row.after_data ?? row.before_data ?? undefined);
        const gName =
          input.taskGroups.find((g) => g.id === line.task_group_id)?.name?.trim() || "Task group";
        const tn = line.task_name.trim() || "Unnamed line";
        return `${tn} · ${gName}`;
      }
      case "solution_tier_task_group_applied": {
        const app = input.taskGroupApplied.find((a) => a.id === entityId);
        const snap = row.after_data ?? row.before_data ?? undefined;
        const tid =
          app?.solution_tier_id ??
          (typeof snap?.solution_tier_id === "string" ? snap.solution_tier_id : null);
        const gid =
          app?.task_group_id ?? (typeof snap?.task_group_id === "string" ? snap.task_group_id : null);
        const gname =
          gid != null ? input.taskGroups.find((g) => g.id === gid)?.name?.trim() ?? "Task group" : null;
        const tierL = tid != null ? tierDisplay(tid) : null;
        if (gname && tierL) return `${gname} → ${tierL}`;
        if (gname) return gname;
        if (tierL) return tierL;
        return null;
      }
      case "package_solution_tiers": {
        const snap = row.after_data ?? row.before_data ?? undefined;
        const pid = typeof snap?.package_id === "string" ? snap.package_id : null;
        const stid = typeof snap?.solution_tier_id === "string" ? snap.solution_tier_id : null;
        if (pid && stid) {
          const p = pkgName.get(pid) ?? "Package";
          const t = tierDisplay(stid) ?? "Tier";
          return `${p} · ${t}`;
        }
        const match = input.packageTiers.find((x) => x.package_id === pid && x.solution_tier_id === stid);
        if (match && pid && stid) {
          const p = pkgName.get(pid) ?? "Package";
          const t = tierDisplay(stid) ?? "Tier";
          return `${p} · ${t}`;
        }
        return null;
      }
      default:
        return null;
    }
  }

  return { labelFor, tierDisplay, relatedContext };
}

/** One-line description for the main table column. */
export function buildAuditDescription(
  row: AuditLogRow,
  diffLines: AuditDiffLine[],
  entityLabel: string | null,
  fallbackName: string | null
): string {
  const typeLabel = auditRecordTypeLabel(row.entity_type);
  const name = entityLabel ?? fallbackName;
  const action = auditActionLabel(row.action);

  if (row.action === "insert") {
    return name ? `${action} ${typeLabel}: ${name}` : `${action} ${typeLabel}`;
  }
  if (row.action === "delete") {
    return name ? `${action} ${typeLabel}: ${name}` : `${action} ${typeLabel}`;
  }
  if (diffLines.length === 0) {
    return name ? `${action} ${typeLabel}: ${name}` : `${action} ${typeLabel}`;
  }
  const fields = diffLines.map((d) => d.fieldLabel);
  const max = 5;
  const head = fields.slice(0, max).join(", ");
  const tail = fields.length > max ? ` (+${fields.length - max} fields)` : "";
  return name ? `${action} ${typeLabel} ${name}: ${head}${tail}` : `${action} ${typeLabel}: ${head}${tail}`;
}

/** Display label for who recorded the audit row (email preferred). */
export function auditActorLabel(row: AuditLogRow): string {
  const email = row.changed_by_email?.trim();
  if (email) return email;
  const uid = row.changed_by_user_id?.trim();
  if (uid) return uid.length <= 14 ? uid : `${uid.slice(0, 8)}…${uid.slice(-4)}`;
  return "";
}

export function auditRowSearchText(
  row: AuditLogRow,
  resolver: ReturnType<typeof createAuditEntityLabelResolver>,
  description: string
): string {
  const friendly = resolver.labelFor(row.entity_type, row.entity_id, row);
  const snapName = pickNameFromSnapshot(row.after_data ?? row.before_data ?? undefined);
  const diff = computeAuditDiff(row.before_data, row.after_data);
  const diffBlob = diff.map((d) => `${d.fieldLabel} ${d.before} ${d.after}`).join(" ");
  const actor = auditActorLabel(row);
  const related = resolver.relatedContext(row);
  return [
    row.entity_id,
    row.entity_type,
    row.action,
    friendly ?? "",
    snapName ?? "",
    auditRecordTypeLabel(row.entity_type),
    auditActionLabel(row.action),
    description,
    diffBlob,
    actor,
    row.changed_by_user_id ?? "",
    related,
  ]
    .join(" ")
    .toLowerCase();
}

export function shortEntityId(id: string): string {
  if (!id) return "";
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…`;
}
