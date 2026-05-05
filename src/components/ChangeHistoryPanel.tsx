import { Fragment, useMemo, useState, type CSSProperties } from "react";
import type { AuditLogRow } from "../types";
import {
  auditActionLabel,
  auditRecordTypeLabel,
  auditRowSearchText,
  buildAuditDescription,
  computeAuditDiff,
  createAuditEntityLabelResolver,
  pickNameFromSnapshot,
  shortEntityId,
  type AuditLookupInput,
} from "../lib/auditChangeSummary";

const ENTITY_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: "all", label: "All record types" },
  { value: "packages", label: "Packages" },
  { value: "solutions", label: "Solutions" },
  { value: "solution_tiers", label: "Solution tiers" },
  { value: "solution_tier_pricing", label: "Tier pricing" },
  { value: "package_solution_tiers", label: "Package ↔ tier links" },
  { value: "tasks", label: "Tasks" },
  { value: "task_groups", label: "Task groups" },
  { value: "task_group_lines", label: "Task group lines" },
  { value: "solution_tier_task_group_applied", label: "Task group applied to tier" },
];

function formatLocalWhen(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso.replace("T", " ").slice(0, 19);
  }
}

type Props = AuditLookupInput & {
  auditLog: AuditLogRow[];
  styles: {
    panel: CSSProperties;
    h2: CSSProperties;
    muted: CSSProperties;
    tbl: CSSProperties;
    th: CSSProperties;
    td: CSSProperties;
    btnSm: CSSProperties;
    input: CSSProperties;
    preJson: CSSProperties;
  };
};

export function ChangeHistoryPanel(props: Props) {
  const { auditLog, styles } = props;
  const [entityFilter, setEntityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const resolver = useMemo(
    () =>
      createAuditEntityLabelResolver({
        packages: props.packages,
        solutions: props.solutions,
        tiers: props.tiers,
        tasks: props.tasks,
        taskGroups: props.taskGroups,
        taskGroupLines: props.taskGroupLines,
        taskGroupApplied: props.taskGroupApplied,
        packageTiers: props.packageTiers,
      }),
    [
      props.packages,
      props.solutions,
      props.tiers,
      props.tasks,
      props.taskGroups,
      props.taskGroupLines,
      props.taskGroupApplied,
      props.packageTiers,
    ]
  );

  const filtered = useMemo(() => {
    let list = auditLog;
    if (entityFilter !== "all") {
      list = list.filter((r) => r.entity_type === entityFilter);
    }
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((row) => {
      const diff = computeAuditDiff(row.before_data, row.after_data);
      const friendly = resolver.labelFor(row.entity_type, row.entity_id, row);
      const fb = friendly ?? pickNameFromSnapshot(row.after_data ?? row.before_data ?? undefined);
      const desc = buildAuditDescription(row, diff, friendly, fb);
      return auditRowSearchText(row, resolver, desc).includes(q);
    });
  }, [auditLog, entityFilter, resolver, search]);

  const { panel, h2, muted, tbl, th, td, btnSm, input, preJson } = styles;

  return (
    <section className="admin-panel admin-panel--editor" style={panel}>
      <div className="admin-editor-layout admin-editor-layout--wide">
        <h2 style={h2}>Change History</h2>
        <p className="admin-intro" style={muted}>
          Recent saves from this admin workspace are recorded below. Dates use your browser&apos;s local
          timezone. Open a row to see which fields changed (updates) or the full snapshot (raw JSON).
        </p>
        <div className="admin-audit-toolbar">
          <select
            className="admin-field"
            style={{ ...input, marginTop: 0, maxWidth: 280 }}
            value={entityFilter}
            onChange={(e) => setEntityFilter(e.target.value)}
          >
            {ENTITY_FILTER_OPTIONS.map(({ value, label }) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <input
            className="admin-field kb-filter-input"
            style={{ ...input, marginTop: 0, flex: "1 1 220px", maxWidth: 480 }}
            placeholder="Search descriptions, IDs, fields, actions…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <p className="admin-hint admin-audit-caption" style={{ ...muted, marginTop: "0.35rem" }}>
          Showing {filtered.length} of {auditLog.length} loaded entr
          {auditLog.length === 1 ? "y" : "ies"} (newest first, max 500 from the database).
        </p>

        <div className="admin-table-scroll" style={{ marginTop: 12 }}>
          <table className="admin-data-table admin-audit-table" style={tbl}>
            <thead>
              <tr>
                <th style={th}>When (local)</th>
                <th style={th}>Action</th>
                <th style={th}>Record type</th>
                <th style={th}>What happened</th>
                <th style={{ ...th }}>Record ID</th>
                <th style={{ ...th, width: "1%" }} aria-label="Expand details">
                  {""}
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((row) => {
                const diff = computeAuditDiff(row.before_data, row.after_data);
                const friendly = resolver.labelFor(row.entity_type, row.entity_id, row);
                const snapName = pickNameFromSnapshot(row.after_data ?? row.before_data ?? undefined);
                const desc = buildAuditDescription(row, diff, friendly, snapName);
                const expanded = expandedId === row.id;
                const badgeClass =
                  row.action === "insert"
                    ? "admin-audit-badge admin-audit-badge--insert"
                    : row.action === "delete"
                      ? "admin-audit-badge admin-audit-badge--delete"
                      : "admin-audit-badge admin-audit-badge--update";
                return (
                  <Fragment key={row.id}>
                    <tr>
                      <td style={td}>{formatLocalWhen(row.created_at ?? "")}</td>
                      <td style={td}>
                        <span className={badgeClass}>{auditActionLabel(row.action)}</span>
                      </td>
                      <td style={td}>{auditRecordTypeLabel(row.entity_type)}</td>
                      <td style={td}>{desc}</td>
                      <td style={td} className="admin-audit-id-cell">
                        <code className="admin-audit-id" title={row.entity_id}>
                          {shortEntityId(row.entity_id)}
                        </code>
                      </td>
                      <td style={td}>
                        <button
                          type="button"
                          style={btnSm}
                          aria-expanded={expanded}
                          aria-controls={`audit-detail-${row.id}`}
                          onClick={() =>
                            setExpandedId((id) => (id === row.id ? null : row.id))
                          }
                        >
                          {expanded ? "Close" : "Details"}
                        </button>
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="admin-audit-expand-row">
                        <td style={{ ...td, padding: "0 0.6rem 0.85rem" }} colSpan={6}>
                          <div
                            id={`audit-detail-${row.id}`}
                            className="admin-audit-detail"
                            role="region"
                          >
                            {diff.length > 0 ? (
                              <>
                                <p className="admin-audit-detail__title">Fields that changed</p>
                                <div className="admin-audit-diff-wrap">
                                  <table className="admin-audit-diff-table">
                                    <thead>
                                      <tr>
                                        <th scope="col">Field</th>
                                        <th scope="col">Before</th>
                                        <th scope="col">After</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {diff.map((d) => (
                                        <tr key={d.field}>
                                          <td>{d.fieldLabel}</td>
                                          <td className="admin-audit-diff-table__cell admin-audit-diff-table__before">
                                            {d.before}
                                          </td>
                                          <td className="admin-audit-diff-table__cell admin-audit-diff-table__after">
                                            {d.after}
                                          </td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              </>
                            ) : (
                              <p className="admin-audit-detail__empty" style={muted}>
                                {row.action === "insert" &&
                                  "This is a new record. The full snapshot is in the JSON block below."}
                                {row.action === "delete" &&
                                  "This record was removed. The last saved values are in the JSON block below."}
                                {row.action === "update" &&
                                  "No simple field differences were detected between before and after snapshots (they may match, or changes are nested). Compare raw JSON."}
                              </p>
                            )}
                            <details className="admin-audit-raw-json">
                              <summary>Technical details (raw JSON)</summary>
                              <pre style={{ ...preJson, maxWidth: "100%", marginTop: 8 }}>
                                {JSON.stringify(
                                  {
                                    audit_id: row.id,
                                    entity_type: row.entity_type,
                                    entity_id: row.entity_id,
                                    action: row.action,
                                    before: row.before_data,
                                    after: row.after_data,
                                  },
                                  null,
                                  2
                                )}
                              </pre>
                            </details>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <p className="admin-hint" style={muted}>
              {auditLog.length === 0
                ? "No history rows loaded yet — apply audit_log migration and save an edit, then reload."
                : "Nothing matches these filters — try clearing search or widening the record type filter."}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
