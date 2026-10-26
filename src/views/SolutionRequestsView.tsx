import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { SolutionRequestModal } from "../components/SolutionRequestModal";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { createProductiveSolutionTasks } from "../lib/createProductiveSolutionTasks";
import { notifySolutionRequestSubmitted } from "../lib/notifySolutionRequest";
import { canEditProposalPricing } from "../lib/proposalPricingAccess";
import {
  formatSolutionRequestDate,
  SOLUTION_REQUEST_STATUSES,
  solutionRequestInsertRow,
  solutionRequestPriorityLabel,
  solutionRequestStatusLabel,
  type SolutionRequest,
  type SolutionRequestFormInput,
  type SolutionRequestStatus,
} from "../lib/solutionRequests";
import { getSupabase } from "../lib/supabase";

type StatusFilter = "all" | SolutionRequestStatus;

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

function canDeleteRequest(
  row: SolutionRequest,
  user: ReturnType<typeof useAuth>["user"],
  canManageStatus: boolean
): boolean {
  if (canManageStatus) return true;
  if (user?.id && row.requested_by_user_id === user.id) return true;
  const email = user?.email?.trim().toLowerCase() ?? "";
  return Boolean(email && row.requested_by_email.trim().toLowerCase() === email);
}

function searchBlob(row: SolutionRequest): string {
  return [
    row.solution_name,
    row.requested_by_name,
    row.requested_by_email,
    row.client_need,
    row.typical_use_case,
    row.desired_deliverables,
    row.why_productize,
    row.suggested_phase,
    row.suggested_category,
    row.suggested_tactic,
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

function inspectorFields(row: SolutionRequest): { label: string; value: string }[] {
  const placement = [row.suggested_phase, row.suggested_category, row.suggested_tactic]
    .map((v) => v?.trim())
    .filter(Boolean)
    .join(" · ");
  const fields: { label: string; value: string }[] = [];
  if (row.client_need.trim()) fields.push({ label: "Client / business need", value: row.client_need });
  if (row.typical_use_case.trim()) fields.push({ label: "Typical use case", value: row.typical_use_case });
  if (row.desired_deliverables.trim()) {
    fields.push({ label: "Desired deliverables", value: row.desired_deliverables });
  }
  if (row.why_productize.trim()) fields.push({ label: "Why productize", value: row.why_productize });
  if (placement) fields.push({ label: "Suggested placement", value: placement });
  if (row.in_scope?.trim()) fields.push({ label: "In scope", value: row.in_scope });
  if (row.out_of_scope?.trim()) fields.push({ label: "Out of scope", value: row.out_of_scope });
  if (row.known_work?.trim()) fields.push({ label: "Known work", value: row.known_work });
  if (row.related_offerings?.trim()) fields.push({ label: "Related offerings", value: row.related_offerings });
  if (row.additional_notes?.trim()) fields.push({ label: "Additional notes", value: row.additional_notes });
  if (row.review_notes?.trim()) fields.push({ label: "Review notes", value: row.review_notes });
  return fields;
}

export function SolutionRequestsView() {
  const searchId = useId();
  const { user, isAdmin } = useAuth();
  const { toastSuccess, toastError, toastNote } = useToast();
  const [rows, setRows] = useState<SolutionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canManageStatus = isAdmin || canEditProposalPricing(user);
  const defaultName = requesterDisplayName(user);
  const defaultEmail = user?.email?.trim() ?? "";

  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data, error } = await client
      .from("solution_requests")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toastError(error.message || "Could not load solution requests.");
      setRows([]);
    } else {
      setRows((data ?? []) as SolutionRequest[]);
    }
    setLoading(false);
  }, [toastError]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const base: Record<StatusFilter, number> = {
      all: rows.length,
      pending: 0,
      approved: 0,
      in_progress: 0,
      not_approved: 0,
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
      if (q && !searchBlob(r).includes(q)) return false;
      return true;
    });
  }, [rows, statusFilter, query]);

  const selected = filtered.find((r) => r.id === selectedId) ?? null;

  const onSubmit = async (form: SolutionRequestFormInput) => {
    const client = getSupabase();
    if (!client) {
      toastError("Supabase is not configured.");
      return;
    }
    setSubmitting(true);
    const insert = solutionRequestInsertRow(form, user?.id ?? null);
    const { data, error } = await client
      .from("solution_requests")
      .insert(insert)
      .select("*")
      .single();
    if (error) {
      toastError(error.message || "Could not submit the request.");
      setSubmitting(false);
      return;
    }
    const created = data as SolutionRequest;
    const notify = await notifySolutionRequestSubmitted({
      requestId: created.id,
      form,
      priority: form.priority,
    });
    if (!notify.ok) {
      toastNote("Request saved. Slack notify to Chelsea did not go through.");
    } else {
      toastSuccess("Request submitted. Chelsea has been notified.");
    }
    setRows((prev) => [created, ...prev.filter((r) => r.id !== created.id)]);
    setSelectedId(created.id);
    setSubmitting(false);
    setModalOpen(false);
    setStatusFilter("all");
    setQuery("");
  };

  const persistProductiveLink = async (
    row: SolutionRequest,
    taskListId: string,
    url: string
  ): Promise<SolutionRequest> => {
    const merged: SolutionRequest = {
      ...row,
      productive_task_list_id: taskListId,
      productive_task_list_url: url,
    };
    const client = getSupabase();
    if (!client) return merged;
    const { data, error } = await client
      .from("solution_requests")
      .update({
        productive_task_list_id: taskListId,
        productive_task_list_url: url,
      })
      .eq("id", row.id)
      .select("*")
      .single();
    if (error) {
      console.warn("[solution_requests] could not store Productive link", error.message);
      return merged;
    }
    return (data as SolutionRequest) ?? merged;
  };

  const syncProductiveList = async (row: SolutionRequest) => {
    if (row.productive_task_list_id && row.productive_task_list_url) {
      return { row, created: false, skipped: true, error: undefined as string | undefined };
    }
    const result = await createProductiveSolutionTasks(row);
    if (!result.ok || !result.taskListId || !result.url) {
      return {
        row,
        created: false,
        skipped: false,
        error: result.error || "Productive task list was not created.",
      };
    }
    const saved = await persistProductiveLink(row, result.taskListId, result.url);
    return {
      row: saved,
      created: !result.skipped,
      skipped: Boolean(result.skipped),
      error: undefined as string | undefined,
    };
  };

  const createProductiveList = async (row: SolutionRequest) => {
    setStatusBusyId(row.id);
    const result = await syncProductiveList(row);
    setRows((prev) => prev.map((r) => (r.id === row.id ? result.row : r)));
    if (result.error) {
      toastNote(result.error);
    } else if (result.skipped) {
      toastSuccess("Productive task list was already created.");
    } else {
      toastSuccess("Created a Productive task list for Chelsea, Laura, Jo, and Nicole.");
    }
    setStatusBusyId(null);
  };

  const updateStatus = async (id: string, status: SolutionRequestStatus) => {
    if (!canManageStatus) return;
    const client = getSupabase();
    if (!client) {
      toastError("Supabase is not configured.");
      return;
    }
    setStatusBusyId(id);
    const { data, error } = await client
      .from("solution_requests")
      .update({
        status,
        status_updated_by_email: user?.email ?? null,
        status_updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .select("*")
      .single();
    if (error) {
      toastError(error.message || "Could not update status.");
      setStatusBusyId(null);
      return;
    }
    let updated = data as SolutionRequest;
    if (status === "approved") {
      const productive = await syncProductiveList(updated);
      updated = productive.row;
      if (productive.error) {
        toastSuccess("Marked as Approved.");
        toastNote(productive.error);
      } else {
        toastSuccess("Approved. Created a Productive task list.");
      }
    } else {
      toastSuccess(`Marked as ${solutionRequestStatusLabel(status)}.`);
    }
    setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
    setStatusBusyId(null);
  };

  const deleteRequest = async (row: SolutionRequest) => {
    if (!canDeleteRequest(row, user, canManageStatus)) return;
    const ok = window.confirm(`Delete “${row.solution_name}”? This cannot be undone.`);
    if (!ok) return;
    const client = getSupabase();
    if (!client) {
      toastError("Supabase is not configured.");
      return;
    }
    setDeletingId(row.id);
    const { error } = await client.from("solution_requests").delete().eq("id", row.id);
    setDeletingId(null);
    if (error) {
      toastError(error.message || "Could not delete the request.");
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== row.id));
    setSelectedId((id) => (id === row.id ? null : id));
    toastSuccess(`Deleted “${row.solution_name}”.`);
  };

  const inspectorOpen = Boolean(selected);

  const emptyCopy =
    rows.length === 0
      ? "Start the queue with a solution that should become a directory offering."
      : "Nothing matches this filter. Try another status, or clear search.";

  return (
    <div className="agency-view-shell agency-view-shell--catalog solution-requests">
      <header className="solution-requests__intro">
        <p className="solution-requests__eyebrow">Solutions Directory</p>
        <div className="solution-requests__intro-row">
          <div className="solution-requests__intro-copy">
            <h1 className="solution-requests__title">New Solution Requests</h1>
            <p className="solution-requests__lede">
              Capture ideas to productize, track review, and send approved work into Productive as a
              five-step task list.
            </p>
          </div>
          <button type="button" className="solution-requests__cta" onClick={() => setModalOpen(true)}>
            Request a new solution
          </button>
        </div>
      </header>

      <div className={`catalog-workspace${inspectorOpen ? " is-open" : ""}`}>
        <div className="solution-requests__board">
          <div className="solution-requests__kpis" role="tablist" aria-label="Request status">
            {(
              [
                ["all", "All"],
                ["pending", "Pending"],
                ["approved", "Approved"],
                ["in_progress", "In progress"],
                ["not_approved", "Not approved"],
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
            <div className="solution-requests__toolbar" role="search">
              <label className="solution-requests__search" htmlFor={searchId}>
                <span>Search</span>
                <input
                  id={searchId}
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Name, requester, need…"
                  autoComplete="off"
                />
              </label>
              <span className="solution-requests__shown">{filtered.length} shown</span>
            </div>
          ) : null}

          {loading ? (
            <p className="solution-requests__empty-copy solution-requests__loading">Loading requests…</p>
          ) : filtered.length === 0 ? (
            <div className="solution-requests__empty">
              <h2 className="solution-requests__empty-title">
                {rows.length === 0 ? "No requests yet" : "Nothing in this view"}
              </h2>
              <p className="solution-requests__empty-copy">{emptyCopy}</p>
              {rows.length === 0 ? (
                <button
                  type="button"
                  className="solution-requests__cta"
                  onClick={() => setModalOpen(true)}
                >
                  Request a new solution
                </button>
              ) : null}
            </div>
          ) : (
            <div className="agency-playbook-browser agency-playbook-browser--directory agency-playbook-browser--catalog">
              <div className="agency-catalog-tier-sheet__scroll agency-catalog-directory__scroll">
                <table className="agency-catalog-tier-sheet__table agency-catalog-directory__table solution-requests__table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Requester</th>
                      <th scope="col">Status</th>
                      <th scope="col">Priority</th>
                      <th scope="col">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((row) => {
                      const selectedRow = selectedId === row.id;
                      const preview =
                        row.client_need.trim() ||
                        row.typical_use_case.trim() ||
                        row.desired_deliverables.trim() ||
                        "";
                      return (
                        <tr
                          key={row.id}
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
                                  {row.solution_name}
                                </span>
                                {preview ? (
                                  <span className="agency-catalog-directory__inline-meta">{preview}</span>
                                ) : null}
                              </div>
                            </div>
                          </td>
                          <td className="solution-requests__requester">{row.requested_by_name}</td>
                          <td>
                            <span className={`solution-requests__status is-${row.status}`}>
                              {solutionRequestStatusLabel(row.status)}
                            </span>
                          </td>
                          <td>
                            <span className={`solution-requests__priority is-${row.priority}`}>
                              {solutionRequestPriorityLabel(row.priority)}
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
          <RequestInspector
            row={selected}
            busy={statusBusyId === selected.id}
            deleting={deletingId === selected.id}
            canManageStatus={canManageStatus}
            canDelete={canDeleteRequest(selected, user, canManageStatus)}
            onClose={() => setSelectedId(null)}
            onStatus={(status) => void updateStatus(selected.id, status)}
            onCreateProductive={() => void createProductiveList(selected)}
            onDelete={() => void deleteRequest(selected)}
          />
        ) : null}
      </div>

      <SolutionRequestModal
        open={modalOpen}
        busy={submitting}
        defaultName={defaultName}
        defaultEmail={defaultEmail}
        onCancel={() => {
          if (!submitting) setModalOpen(false);
        }}
        onConfirm={(form) => void onSubmit(form)}
      />
    </div>
  );
}

function RequestInspector({
  row,
  busy,
  deleting,
  canManageStatus,
  canDelete,
  onClose,
  onStatus,
  onCreateProductive,
  onDelete,
}: {
  row: SolutionRequest;
  busy: boolean;
  deleting: boolean;
  canManageStatus: boolean;
  canDelete: boolean;
  onClose: () => void;
  onStatus: (status: SolutionRequestStatus) => void;
  onCreateProductive: () => void;
  onDelete: () => void;
}) {
  const fields = inspectorFields(row);
  const locked = busy || deleting;
  return (
    <aside className="catalog-inspector" aria-label={`${row.solution_name} details`}>
      <header className="catalog-inspector__head">
        <p className="catalog-inspector__type">{solutionRequestStatusLabel(row.status)}</p>
        <div className="catalog-inspector__head-actions">
          <button type="button" className="catalog-inspector__close" onClick={onClose} aria-label="Close details">
            ×
          </button>
        </div>
      </header>
      <h2 className="catalog-inspector__title">{row.solution_name}</h2>
      <p className="catalog-inspector__owner">
        {row.requested_by_name}
        {row.requested_by_email ? ` · ${row.requested_by_email}` : ""}
        {" · "}
        {formatSolutionRequestDate(row.created_at)}
      </p>
      <dl className="catalog-inspector__stats">
        <div>
          <dt>Status</dt>
          <dd>{solutionRequestStatusLabel(row.status)}</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>{solutionRequestPriorityLabel(row.priority)}</dd>
        </div>
        <div>
          <dt>Productive</dt>
          <dd>{row.productive_task_list_url ? "Linked" : "—"}</dd>
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
        {row.productive_task_list_url ? (
          <a
            className="catalog-inspector__btn catalog-inspector__btn--primary"
            href={row.productive_task_list_url}
            target="_blank"
            rel="noreferrer"
          >
            Open Productive
          </a>
        ) : canManageStatus && (row.status === "approved" || row.status === "in_progress") ? (
          <button
            type="button"
            className="catalog-inspector__btn catalog-inspector__btn--primary"
            disabled={locked}
            onClick={onCreateProductive}
          >
            Create Productive tasks
          </button>
        ) : null}
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
        <div className="solution-requests-inspector__status" role="group" aria-label="Update status">
          {SOLUTION_REQUEST_STATUSES.map((status) => (
            <button
              key={status}
              type="button"
              className={`solution-requests-inspector__status-btn${row.status === status ? " is-current" : ""}`}
              disabled={locked || row.status === status}
              onClick={() => onStatus(status)}
            >
              {solutionRequestStatusLabel(status)}
            </button>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
