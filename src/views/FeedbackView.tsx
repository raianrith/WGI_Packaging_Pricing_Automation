import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { FeedbackModal } from "../components/FeedbackModal";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import {
  APP_FEEDBACK_CATEGORIES,
  APP_FEEDBACK_STATUSES,
  appFeedbackAreaLabel,
  appFeedbackCategoryLabel,
  appFeedbackCategoryShort,
  appFeedbackInsertRow,
  appFeedbackPriorityLabel,
  appFeedbackStatusLabel,
  feedbackStatusToSolutionRequestStatus,
  formatAppFeedbackDate,
  mapSolutionRequestToFeedbackBoardRow,
  parseAppFeedbackCategoryParam,
  type AppFeedback,
  type AppFeedbackCategory,
  type AppFeedbackFormInput,
  type AppFeedbackStatus,
  type FeedbackBoardRow,
} from "../lib/appFeedback";
import { canEditProposalPricing } from "../lib/proposalPricingAccess";
import { getSupabase } from "../lib/supabase";

type StatusFilter = "all" | AppFeedbackStatus;
type CategoryFilter = "all" | AppFeedbackCategory;

function requesterDisplayName(user: ReturnType<typeof useAuth>["user"]): string {
  const meta = user?.user_metadata as Record<string, unknown> | undefined;
  const fromMeta =
    (typeof meta?.full_name === "string" && meta.full_name.trim()) ||
    (typeof meta?.name === "string" && meta.name.trim()) ||
    "";
  if (fromMeta) return fromMeta;
  const email = user?.email?.trim() ?? "";
  if (!email) return "";
  return email.split("@")[0] ?? "";
}

function canDeleteFeedback(
  row: FeedbackBoardRow,
  user: ReturnType<typeof useAuth>["user"],
  canManageStatus: boolean
): boolean {
  if (canManageStatus) return true;
  if (user?.id && row.requested_by_user_id === user.id) return true;
  const email = user?.email?.trim().toLowerCase() ?? "";
  return Boolean(email && row.requested_by_email.trim().toLowerCase() === email);
}

function searchBlob(row: FeedbackBoardRow): string {
  return [
    row.title,
    row.details,
    row.category,
    row.area,
    row.related_name,
    row.requested_by_name,
    row.requested_by_email,
    row.impact,
    row.client_need,
    row.typical_use_case,
    row.page_or_url,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function formatWhen(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear()
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" };
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

function inspectorFields(row: AppFeedback): { label: string; value: string }[] {
  const fields: { label: string; value: string }[] = [];
  fields.push({ label: "Category", value: appFeedbackCategoryLabel(row.category) });
  fields.push({ label: "Area", value: appFeedbackAreaLabel(row.area) });
  if (row.related_name?.trim()) fields.push({ label: "Related item", value: row.related_name });
  if (row.page_or_url?.trim()) fields.push({ label: "Page / URL", value: row.page_or_url });
  if (row.details.trim()) fields.push({ label: "Details", value: row.details });
  if (row.impact?.trim()) fields.push({ label: "Impact", value: row.impact });
  if (row.steps_to_reproduce?.trim()) {
    fields.push({ label: "Steps to reproduce", value: row.steps_to_reproduce });
  }
  if (row.expected_behavior?.trim()) {
    fields.push({ label: "Expected", value: row.expected_behavior });
  }
  if (row.actual_behavior?.trim()) fields.push({ label: "Actual", value: row.actual_behavior });
  if (row.client_need?.trim()) fields.push({ label: "Client / business need", value: row.client_need });
  if (row.typical_use_case?.trim()) {
    fields.push({ label: "Typical use case", value: row.typical_use_case });
  }
  if (row.desired_deliverables?.trim()) {
    fields.push({ label: "Desired deliverables", value: row.desired_deliverables });
  }
  if (row.why_productize?.trim()) fields.push({ label: "Why productize", value: row.why_productize });
  const placement = [row.suggested_phase, row.suggested_category, row.suggested_tactic]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(" · ");
  if (placement) fields.push({ label: "Suggested placement", value: placement });
  if (row.additional_notes?.trim()) {
    fields.push({ label: "Additional notes", value: row.additional_notes });
  }
  if (row.review_notes?.trim()) fields.push({ label: "Review notes", value: row.review_notes });
  if (row.status_updated_by_email?.trim()) {
    fields.push({
      label: "Status last updated",
      value: `${row.status_updated_by_email}${
        row.status_updated_at ? ` · ${formatAppFeedbackDate(row.status_updated_at)}` : ""
      }`,
    });
  }
  return fields;
}

export function FeedbackView() {
  const searchId = useId();
  const categoryFilterId = useId();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAdmin } = useAuth();
  const { toastSuccess, toastError } = useToast();
  const [rows, setRows] = useState<FeedbackBoardRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [legacyCount, setLegacyCount] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [initialCategory, setInitialCategory] = useState<AppFeedbackCategory | "">("");

  const canManageStatus = isAdmin || canEditProposalPricing(user);
  const defaultName = requesterDisplayName(user);
  const defaultEmail = user?.email?.trim() ?? "";

  useEffect(() => {
    const fromQuery = parseAppFeedbackCategoryParam(searchParams.get("category"));
    const open = searchParams.get("new") === "1" || Boolean(fromQuery);
    if (!open) return;
    setInitialCategory(fromQuery);
    setModalOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("new");
    next.delete("category");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client) {
      setRows([]);
      setLegacyCount(0);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [feedbackRes, legacyRes] = await Promise.all([
      client.from("app_feedback").select("*").order("created_at", { ascending: false }),
      client.from("solution_requests").select("*").order("created_at", { ascending: false }),
    ]);
    if (feedbackRes.error) {
      toastError(feedbackRes.error.message || "Could not load feedback.");
      setRows([]);
      setLegacyCount(0);
      setLoading(false);
      return;
    }
    const feedbackRows: FeedbackBoardRow[] = ((feedbackRes.data ?? []) as AppFeedback[]).map(
      (row) => ({ ...row, source: "app_feedback" as const })
    );
    const legacyRows: FeedbackBoardRow[] = legacyRes.error
      ? []
      : ((legacyRes.data ?? []) as Parameters<typeof mapSolutionRequestToFeedbackBoardRow>[0][]).map(
          mapSolutionRequestToFeedbackBoardRow
        );
    if (legacyRes.error) {
      console.warn("[feedback] could not load legacy solution_requests", legacyRes.error.message);
    }
    const merged = [...feedbackRows, ...legacyRows].sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    setRows(merged);
    setLegacyCount(legacyRows.length);
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const base: Record<StatusFilter, number> = {
      all: rows.length,
      pending: 0,
      reviewing: 0,
      in_progress: 0,
      resolved: 0,
      deferred: 0,
    };
    for (const row of rows) {
      base[row.status] += 1;
    }
    return base;
  }, [rows]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (categoryFilter !== "all" && r.category !== categoryFilter) return false;
      if (q && !searchBlob(r).includes(q)) return false;
      return true;
    });
  }, [rows, statusFilter, categoryFilter, query]);

  const selected = filtered.find((r) => r.id === selectedId) ?? null;

  const onSubmit = async (form: AppFeedbackFormInput) => {
    const client = getSupabase();
    if (!client) {
      toastError("Supabase is not configured.");
      return;
    }
    setSubmitting(true);
    const insert = appFeedbackInsertRow(form, user?.id ?? null);
    const { data, error } = await client.from("app_feedback").insert(insert).select("*").single();
    if (error) {
      toastError(error.message || "Could not submit feedback.");
      setSubmitting(false);
      return;
    }
    const created: FeedbackBoardRow = { ...(data as AppFeedback), source: "app_feedback" };
    toastSuccess("Feedback submitted. It’s on the board.");
    setRows((prev) => [created, ...prev.filter((r) => r.id !== created.id)]);
    setSelectedId(created.id);
    setSubmitting(false);
    setModalOpen(false);
    setInitialCategory("");
    setStatusFilter("all");
    setCategoryFilter("all");
    setQuery("");
  };

  const updateStatus = async (id: string, status: AppFeedbackStatus) => {
    if (!canManageStatus) return;
    const client = getSupabase();
    if (!client) {
      toastError("Supabase is not configured.");
      return;
    }
    const current = rows.find((r) => r.id === id);
    if (!current) return;
    setStatusBusyId(id);
    const stamp = {
      status_updated_by_email: user?.email ?? null,
      status_updated_at: new Date().toISOString(),
    };
    if (current.source === "solution_request") {
      const legacyStatus = feedbackStatusToSolutionRequestStatus(status);
      const { data, error } = await client
        .from("solution_requests")
        .update({ status: legacyStatus, ...stamp })
        .eq("id", id)
        .select("*")
        .single();
      if (error) {
        toastError(error.message || "Could not update status.");
        setStatusBusyId(null);
        return;
      }
      const updated = mapSolutionRequestToFeedbackBoardRow(
        data as Parameters<typeof mapSolutionRequestToFeedbackBoardRow>[0]
      );
      toastSuccess(`Marked as ${appFeedbackStatusLabel(status)}.`);
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      setStatusBusyId(null);
      return;
    }
    const { data, error } = await client
      .from("app_feedback")
      .update({ status, ...stamp })
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      toastError(error.message || "Could not update status.");
      setStatusBusyId(null);
      return;
    }
    const updated: FeedbackBoardRow = { ...(data as AppFeedback), source: "app_feedback" };
    toastSuccess(`Marked as ${appFeedbackStatusLabel(status)}.`);
    setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
    setStatusBusyId(null);
  };

  const deleteFeedback = async (row: FeedbackBoardRow) => {
    if (!canDeleteFeedback(row, user, canManageStatus)) return;
    const ok = window.confirm(`Delete “${row.title}”? This cannot be undone.`);
    if (!ok) return;
    const client = getSupabase();
    if (!client) {
      toastError("Supabase is not configured.");
      return;
    }
    setDeletingId(row.id);
    const table = row.source === "solution_request" ? "solution_requests" : "app_feedback";
    const { error } = await client.from(table).delete().eq("id", row.id);
    setDeletingId(null);
    if (error) {
      toastError(error.message || "Could not delete feedback.");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    if (row.source === "solution_request") setLegacyCount((n) => Math.max(0, n - 1));
    setSelectedId((id) => (id === row.id ? null : id));
    toastSuccess(`Deleted “${row.title}”.`);
  };

  const inspectorOpen = Boolean(selected);

  const emptyCopy =
    rows.length === 0
      ? "Log a bug, ask for an upgrade, flag missing content, or request a new solution."
      : "Nothing matches this filter. Try another stage or category, or clear search.";

  return (
    <div className="agency-view-shell agency-view-shell--catalog solution-requests app-feedback">
      <header className="solution-requests__intro">
        <p className="solution-requests__eyebrow">Product feedback</p>
        <div className="solution-requests__intro-row">
          <div className="solution-requests__intro-copy">
            <h1 className="solution-requests__title">Feedback</h1>
            <p className="solution-requests__lede">
              One place for bugs, upgrades, content gaps, package notes, and new solution requests —
              with stages so you can see what’s open and who’s asking.
              {legacyCount > 0 ? (
                <>
                  {" "}
                  Includes {legacyCount} earlier{" "}
                  <Link className="agency-hub__link" to="/solution-requests">
                    New Solution Request{legacyCount === 1 ? "" : "s"}
                  </Link>{" "}
                  from the solutions queue.
                </>
              ) : (
                <>
                  {" "}
                  Dedicated Productive handoff still lives under{" "}
                  <Link className="agency-hub__link" to="/solution-requests">
                    New Solution Requests
                  </Link>
                  .
                </>
              )}
            </p>
          </div>
          <button
            type="button"
            className="solution-requests__cta"
            onClick={() => {
              setInitialCategory("");
              setModalOpen(true);
            }}
          >
            Submit Feedback / Request New Solution
          </button>
        </div>
      </header>

      <div className={`catalog-workspace${inspectorOpen ? " is-open" : ""}`}>
        <div className="solution-requests__board">
          <div className="solution-requests__kpis" role="tablist" aria-label="Feedback stage">
            {(
              [
                ["all", "All"],
                ["pending", "Pending"],
                ["reviewing", "Reviewing"],
                ["in_progress", "In progress"],
                ["resolved", "Resolved"],
                ["deferred", "Deferred"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={statusFilter === key}
                className={`solution-requests__kpi${statusFilter === key ? " is-active" : ""}`}
                onClick={() => setStatusFilter(key)}
              >
                <span className="solution-requests__kpi-value">{counts[key]}</span>
                <span className="solution-requests__kpi-label">{label}</span>
              </button>
            ))}
          </div>

          {rows.length > 0 ? (
            <div className="solution-requests__toolbar app-feedback__toolbar" role="search">
              <label className="solution-requests__search" htmlFor={searchId}>
                <span>Search</span>
                <input
                  id={searchId}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Title, requester, category…"
                  autoComplete="off"
                />
              </label>
              <label className="solution-requests__search app-feedback__category-filter" htmlFor={categoryFilterId}>
                <span>Category</span>
                <select
                  id={categoryFilterId}
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value as CategoryFilter)}
                >
                  <option value="all">All categories</option>
                  {APP_FEEDBACK_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {appFeedbackCategoryShort(c)}
                    </option>
                  ))}
                </select>
              </label>
              <span className="solution-requests__shown">{filtered.length} shown</span>
            </div>
          ) : null}

          {loading ? (
            <p className="solution-requests__empty-copy solution-requests__loading">
              Loading feedback…
            </p>
          ) : filtered.length === 0 ? (
            <div className="solution-requests__empty">
              <h2 className="solution-requests__empty-title">
                {rows.length === 0 ? "No feedback yet" : "Nothing in this view"}
              </h2>
              <p className="solution-requests__empty-copy">{emptyCopy}</p>
              {rows.length === 0 ? (
                <button
                  type="button"
                  className="solution-requests__cta"
                  onClick={() => {
                    setInitialCategory("");
                    setModalOpen(true);
                  }}
                >
                  Submit Feedback / Request New Solution
                </button>
              ) : null}
            </div>
          ) : (
            <div className="agency-playbook-browser agency-playbook-browser--directory agency-playbook-browser--catalog">
              <div className="agency-catalog-tier-sheet__scroll agency-catalog-directory__scroll">
                <table className="agency-catalog-tier-sheet__table agency-catalog-directory__table solution-requests__table app-feedback__table">
                  <thead>
                    <tr>
                      <th scope="col">Title</th>
                      <th scope="col">Category</th>
                      <th scope="col">Requester</th>
                      <th scope="col">Stage</th>
                      <th scope="col">Priority</th>
                      <th scope="col">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const selectedRow = selectedId === row.id;
                      const preview =
                        row.details.trim() ||
                        row.related_name?.trim() ||
                        row.impact?.trim() ||
                        "";
                      return (
                        <tr
                          key={`${row.source}:${row.id}`}
                          className={`agency-catalog-directory__parent${selectedRow ? " is-selected" : ""}`}
                          role="button"
                          tabIndex={0}
                          aria-selected={selectedRow}
                          onClick={() => setSelectedId(selectedRow ? null : row.id)}
                          onKeyDown={(e) => {
                            if (e.key !== "Enter" && e.key !== " ") return;
                            e.preventDefault();
                            setSelectedId(selectedRow ? null : row.id);
                          }}
                        >
                          <td>
                            <div className="agency-catalog-directory__name-cell">
                              <div className="agency-catalog-directory__name-copy">
                                <span className="agency-catalog-tier-sheet__tier-title">
                                  {row.title}
                                  {row.source === "solution_request" ? (
                                    <span className="app-feedback__legacy-tag"> Legacy</span>
                                  ) : null}
                                </span>
                                {preview ? (
                                  <span className="agency-catalog-directory__inline-meta">
                                    {preview}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="app-feedback__category-chip">
                              {appFeedbackCategoryShort(row.category)}
                            </span>
                          </td>
                          <td className="solution-requests__requester">{row.requested_by_name}</td>
                          <td>
                            <span className={`solution-requests__status is-${row.status}`}>
                              {appFeedbackStatusLabel(row.status)}
                            </span>
                          </td>
                          <td>
                            <span className={`solution-requests__priority is-${row.priority}`}>
                              {appFeedbackPriorityLabel(row.priority)}
                            </span>
                          </td>
                          <td className="solution-requests__date">{formatWhen(row.created_at)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {selected ? (
          <FeedbackInspector
            row={selected}
            busy={statusBusyId === selected.id}
            deleting={deletingId === selected.id}
            canManageStatus={canManageStatus}
            canDelete={canDeleteFeedback(selected, user, canManageStatus)}
            onClose={() => setSelectedId(null)}
            onStatus={(status) => void updateStatus(selected.id, status)}
            onDelete={() => void deleteFeedback(selected)}
          />
        ) : null}
      </div>

      <FeedbackModal
        open={modalOpen}
        busy={submitting}
        defaultName={defaultName}
        defaultEmail={defaultEmail}
        initialCategory={initialCategory}
        onCancel={() => {
          if (!submitting) {
            setModalOpen(false);
            setInitialCategory("");
          }
        }}
        onConfirm={(form) => void onSubmit(form)}
      />
    </div>
  );
}

function FeedbackInspector({
  row,
  busy,
  deleting,
  canManageStatus,
  canDelete,
  onClose,
  onStatus,
  onDelete,
}: {
  row: FeedbackBoardRow;
  busy: boolean;
  deleting: boolean;
  canManageStatus: boolean;
  canDelete: boolean;
  onClose: () => void;
  onStatus: (status: AppFeedbackStatus) => void;
  onDelete: () => void;
}) {
  const fields = inspectorFields(row);
  const locked = busy || deleting;
  return (
    <aside className="catalog-inspector" aria-label={`${row.title} details`}>
      <header className="catalog-inspector__head">
        <p className="catalog-inspector__type">
          {appFeedbackStatusLabel(row.status)}
          {row.source === "solution_request" ? " · Legacy request" : ""}
        </p>
        <div className="catalog-inspector__head-actions">
          <button
            type="button"
            className="catalog-inspector__close"
            onClick={onClose}
            aria-label="Close details"
          >
            ×
          </button>
        </div>
      </header>
      <h2 className="catalog-inspector__title">{row.title}</h2>
      <p className="catalog-inspector__owner">
        {row.requested_by_name}
        {row.requested_by_email ? ` · ${row.requested_by_email}` : ""}
        {" · "}
        {formatAppFeedbackDate(row.created_at)}
      </p>
      <dl className="catalog-inspector__stats">
        <div>
          <dt>Stage</dt>
          <dd>{appFeedbackStatusLabel(row.status)}</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>{appFeedbackPriorityLabel(row.priority)}</dd>
        </div>
        <div>
          <dt>Category</dt>
          <dd>{appFeedbackCategoryShort(row.category)}</dd>
        </div>
      </dl>
      <div className="catalog-inspector__body">
        {fields.map((field) => (
          <section key={field.label} className="catalog-inspector__section">
            <h3 className="catalog-inspector__section-title">{field.label}</h3>
            <p className="catalog-inspector__overview">{field.value}</p>
          </section>
        ))}
      </div>
      <div className="catalog-inspector__actions">
        {canDelete ? (
          <button
            type="button"
            className="catalog-inspector__btn catalog-inspector__btn--danger"
            disabled={locked}
            onClick={onDelete}
          >
            {deleting ? "Deleting…" : "Delete"}
          </button>
        ) : null}
      </div>
      {canManageStatus ? (
        <div className="solution-requests-inspector__status" role="group" aria-label="Update stage">
          {APP_FEEDBACK_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`solution-requests-inspector__status-btn${row.status === status ? " is-current" : ""}`}
              disabled={locked || row.status === status}
              onClick={() => onStatus(status)}
            >
              {appFeedbackStatusLabel(status)}
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
