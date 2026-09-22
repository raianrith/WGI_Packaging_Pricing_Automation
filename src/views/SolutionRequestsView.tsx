import { useCallback, useEffect, useMemo, useState } from "react";
import { SolutionRequestModal } from "../components/SolutionRequestModal";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
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

export function SolutionRequestsView() {
  const { user, isAdmin } = useAuth();
  const { toastSuccess, toastError, toastNote } = useToast();
  const [rows, setRows] = useState<SolutionRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [statusBusyId, setStatusBusyId] = useState<string | null>(null);

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
    if (statusFilter === "all") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

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
    setSubmitting(false);
    setModalOpen(false);
    setStatusFilter("all");
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
    } else if (data) {
      const updated = data as SolutionRequest;
      setRows((prev) => prev.map((r) => (r.id === id ? updated : r)));
      toastSuccess(`Marked as ${solutionRequestStatusLabel(status)}.`);
    }
    setStatusBusyId(null);
  };

  return (
    <div className="solution-requests">
      <header className="solution-requests__hero">
        <div className="solution-requests__hero-copy">
          <p className="solution-requests__eyebrow">Solutions Directory</p>
          <h1 className="solution-requests__title">New Solution Requests</h1>
          <p className="solution-requests__lead">
            Capture ideas to productize, track review status, and keep an approved queue ready
            for build work.
          </p>
        </div>
        <button
          type="button"
          className="solution-requests__cta"
          onClick={() => setModalOpen(true)}
        >
          Request a new solution
        </button>
      </header>

      <div className="solution-requests__stats" aria-label="Request counts by status">
        {(
          [
            ["all", "All"],
            ["pending", "Pending"],
            ["approved", "Approved"],
            ["in_progress", "In Progress"],
            ["not_approved", "Not Approved"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={`solution-requests__stat${statusFilter === key ? " is-active" : ""}`}
            onClick={() => setStatusFilter(key)}
          >
            <span className="solution-requests__stat-value">{counts[key]}</span>
            <span className="solution-requests__stat-label">{label}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <p className="solution-requests__empty">Loading requests…</p>
      ) : filtered.length === 0 ? (
        <div className="solution-requests__empty-card">
          <h2 className="solution-requests__empty-title">
            {rows.length === 0 ? "No requests yet" : "Nothing in this status"}
          </h2>
          <p className="solution-requests__empty-copy">
            {rows.length === 0
              ? "Start the queue by requesting a solution that should become a directory offering."
              : "Try another status filter, or submit a new request."}
          </p>
          {rows.length === 0 ? (
            <button
              type="button"
              className="roadmap-btn roadmap-btn--primary"
              onClick={() => setModalOpen(true)}
            >
              Request a new solution
            </button>
          ) : null}
        </div>
      ) : (
        <ul className="solution-requests__list">
          {filtered.map((row) => {
            const open = expandedId === row.id;
            const placement = [row.suggested_phase, row.suggested_category, row.suggested_tactic]
              .map((v) => v?.trim())
              .filter(Boolean)
              .join(" · ");
            const preview =
              row.client_need.trim() ||
              row.typical_use_case.trim() ||
              row.desired_deliverables.trim() ||
              "";
            return (
              <li key={row.id}>
                <article
                  className={`solution-requests-card solution-requests-card--${row.status}${
                    open ? " is-expanded" : ""
                  }`}
                >
                  <button
                    type="button"
                    className="solution-requests-card__head"
                    aria-expanded={open}
                    onClick={() => setExpandedId(open ? null : row.id)}
                  >
                    <span className="solution-requests-card__mark" aria-hidden>
                      <span className="solution-requests-card__chevron">{open ? "▾" : "▸"}</span>
                    </span>
                    <span className="solution-requests-card__main">
                      <span className="solution-requests-card__title-row">
                        <span className="solution-requests-card__title">{row.solution_name}</span>
                        <span
                          className={`solution-requests-card__status solution-requests-card__status--${row.status}`}
                        >
                          {solutionRequestStatusLabel(row.status)}
                        </span>
                        <span
                          className={`solution-requests-card__priority solution-requests-card__priority--${row.priority}`}
                        >
                          {solutionRequestPriorityLabel(row.priority)}
                        </span>
                      </span>
                      <span className="solution-requests-card__meta">
                        {row.requested_by_name}
                        {row.requested_by_email ? ` · ${row.requested_by_email}` : ""}
                        {" · "}
                        {formatSolutionRequestDate(row.created_at)}
                      </span>
                      {!open && preview ? (
                        <span className="solution-requests-card__preview">{preview}</span>
                      ) : null}
                    </span>
                    <span className="solution-requests-card__hint">
                      {open ? "Collapse" : "Expand"}
                    </span>
                  </button>

                  {open ? (
                    <div className="solution-requests-card__body">
                      <dl className="solution-requests-card__grid">
                        <Detail label="Client / business need" value={row.client_need} />
                        <Detail label="Typical use case" value={row.typical_use_case} />
                        <Detail label="Desired deliverables" value={row.desired_deliverables} />
                        <Detail label="Why productize" value={row.why_productize} />
                        {placement ? <Detail label="Suggested placement" value={placement} /> : null}
                        {row.in_scope ? <Detail label="In scope" value={row.in_scope} /> : null}
                        {row.out_of_scope ? (
                          <Detail label="Out of scope" value={row.out_of_scope} />
                        ) : null}
                        {row.known_work ? <Detail label="Known work" value={row.known_work} /> : null}
                        {row.related_offerings ? (
                          <Detail label="Related offerings" value={row.related_offerings} />
                        ) : null}
                        {row.additional_notes ? (
                          <Detail label="Additional notes" value={row.additional_notes} />
                        ) : null}
                        {row.review_notes ? (
                          <Detail label="Review notes" value={row.review_notes} />
                        ) : null}
                      </dl>

                      {canManageStatus ? (
                        <div className="solution-requests-card__actions">
                          <span className="solution-requests-card__actions-label">Update status</span>
                          <div className="solution-requests-card__status-btns">
                            {SOLUTION_REQUEST_STATUSES.map((status) => (
                              <button
                                key={status}
                                type="button"
                                className={`solution-requests-card__status-btn solution-requests-card__status-btn--${status}${
                                  row.status === status ? " is-current" : ""
                                }`}
                                disabled={statusBusyId === row.id || row.status === status}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  void updateStatus(row.id, status);
                                }}
                              >
                                {solutionRequestStatusLabel(status)}
                              </button>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              </li>
            );
          })}
        </ul>
      )}

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

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="solution-requests-card__detail">
      <dt className="solution-requests-card__detail-label">{label}</dt>
      <dd className="solution-requests-card__detail-value">{value}</dd>
    </div>
  );
}
