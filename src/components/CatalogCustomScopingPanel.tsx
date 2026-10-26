import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { EntityLink } from "./EntityLink";
import { proposalPath } from "../lib/entityLinks";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import { customScopingDeliverableLabel } from "../lib/customScopingRequest";
import {
  catalogCustomScopingSearchBlob,
  catalogDeliverableShortLabel,
  catalogProposalStatusLabel,
  collectCatalogCustomScoping,
  removeCustomRequestFromSnapshot,
  removeCustomSolutionFromSnapshot,
  type CatalogCustomScopingRequestRow,
  type CatalogCustomSolutionRow,
  type CatalogRequestStatus,
} from "../lib/catalogCustomScoping";
import { parseProposalSnapshot, type RoadmapProposalSnapshot } from "../lib/roadmapProposalSnapshot";
import { getSupabase } from "../lib/supabase";
import type { RoadmapProposalRow } from "../types";

type ListTab = "requests" | "solutions";

type Props = {
  onCounts?: (counts: { requests: number; solutions: number }) => void;
};

function statusLabel(status: CatalogRequestStatus): string {
  if (status === "fulfilled") return "Done";
  if (status === "skipped") return "Skip";
  return "Open";
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

function requestInspectorFields(row: CatalogCustomScopingRequestRow): { label: string; value: string }[] {
  const r = row.request;
  const fields: { label: string; value: string }[] = [];
  if (r.overviewAndGoal) fields.push({ label: "Overview", value: r.overviewAndGoal });
  if (r.clientComponents) fields.push({ label: "Client provides", value: r.clientComponents });
  if (r.examplesAndResources) fields.push({ label: "Examples", value: r.examplesAndResources });
  if (r.budget) fields.push({ label: "Budget", value: r.budget });
  if (r.deadline) fields.push({ label: "Deadline", value: r.deadline });
  if (r.expectations) fields.push({ label: "Assumptions", value: r.expectations });
  if (r.otherNotes) fields.push({ label: "Notes", value: r.otherNotes });
  return fields;
}

export function CatalogCustomScopingPanel({ onCounts }: Props) {
  const searchId = useId();
  const statusId = useId();
  const { user } = useAuth();
  const { toastError, toastSuccess } = useToast();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [proposals, setProposals] = useState<RoadmapProposalRow[]>([]);
  const [tab, setTab] = useState<ListTab>("requests");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | CatalogRequestStatus>("all");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const onCountsRef = useRef(onCounts);
  onCountsRef.current = onCounts;

  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client) {
      setProposals([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    const { data, error: err } = await client
      .from("roadmap_proposals")
      .select("*")
      .order("updated_at", { ascending: false });
    if (err) {
      setError(err.message || "Could not load proposals.");
      setProposals([]);
    } else {
      setProposals((data ?? []) as RoadmapProposalRow[]);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const index = useMemo(() => collectCatalogCustomScoping(proposals), [proposals]);

  useEffect(() => {
    onCountsRef.current?.({
      requests: index.requests.length,
      solutions: index.solutions.length,
    });
  }, [index]);

  const q = query.trim().toLowerCase();
  const requests = useMemo(() => {
    return index.requests.filter((row) => {
      if (statusFilter !== "all" && row.status !== statusFilter) return false;
      if (q && !catalogCustomScopingSearchBlob(row).includes(q)) return false;
      return true;
    });
  }, [index.requests, q, statusFilter]);

  const solutions = useMemo(() => {
    return index.solutions.filter((row) => {
      if (q && !catalogCustomScopingSearchBlob(row).includes(q)) return false;
      return true;
    });
  }, [index.solutions, q]);

  const selectedRequest = tab === "requests" ? requests.find((r) => r.id === selectedId) ?? null : null;
  const selectedSolution = tab === "solutions" ? solutions.find((r) => r.id === selectedId) ?? null : null;
  const inspectorOpen = Boolean(selectedRequest || selectedSolution);
  const shownCount = tab === "requests" ? requests.length : solutions.length;

  const switchTab = (next: ListTab) => {
    setTab(next);
    setSelectedId(null);
  };

  const persistSnapshot = useCallback(
    async (proposalId: string, snapshot: RoadmapProposalSnapshot): Promise<boolean> => {
      const client = getSupabase();
      if (!client) {
        toastError("Could not save. Supabase is not configured.");
        return false;
      }
      const { data, error: err } = await client
        .from("roadmap_proposals")
        .update({
          proposal_state: snapshot,
          updated_by_user_id: user?.id ?? null,
          updated_by_email: user?.email ?? null,
        })
        .eq("id", proposalId)
        .select("*")
        .maybeSingle();
      if (err) {
        toastError(err.message || "Could not save the proposal.");
        return false;
      }
      if (data) {
        setProposals((prev) => prev.map((row) => (row.id === proposalId ? (data as RoadmapProposalRow) : row)));
      } else {
        await load();
      }
      return true;
    },
    [load, toastError, user?.email, user?.id]
  );

  const deleteRequest = useCallback(
    async (row: CatalogCustomScopingRequestRow) => {
      const linked =
        row.linkedCount > 0
          ? ` ${row.linkedCount} custom solution${row.linkedCount === 1 ? "" : "s"} on this proposal will stay.`
          : " This cannot be undone.";
      const ok = window.confirm(
        `Delete custom request “${row.request.name}” from “${row.roadmapTitle}”?${linked}`
      );
      if (!ok) return;
      const proposal = proposals.find((p) => p.id === row.proposalId);
      const snap = proposal ? parseProposalSnapshot(proposal) : null;
      if (!snap) {
        toastError("Could not read this proposal.");
        return;
      }
      setDeletingId(row.id);
      const saved = await persistSnapshot(row.proposalId, removeCustomRequestFromSnapshot(snap, row.request.id));
      setDeletingId(null);
      if (!saved) return;
      setSelectedId((id) => (id === row.id ? null : id));
      toastSuccess(`Deleted “${row.request.name}”.`);
    },
    [persistSnapshot, proposals, toastError, toastSuccess]
  );

  const deleteSolution = useCallback(
    async (row: CatalogCustomSolutionRow) => {
      const ok = window.confirm(
        `Delete custom solution “${row.headline}” from “${row.roadmapTitle}”? This cannot be undone.`
      );
      if (!ok) return;
      const proposal = proposals.find((p) => p.id === row.proposalId);
      const snap = proposal ? parseProposalSnapshot(proposal) : null;
      if (!snap) {
        toastError("Could not read this proposal.");
        return;
      }
      setDeletingId(row.id);
      const saved = await persistSnapshot(row.proposalId, removeCustomSolutionFromSnapshot(snap, row.card.key));
      setDeletingId(null);
      if (!saved) return;
      setSelectedId((id) => (id === row.id ? null : id));
      toastSuccess(`Deleted “${row.headline}”.`);
    },
    [persistSnapshot, proposals, toastError, toastSuccess]
  );

  return (
    <div className={`catalog-workspace${inspectorOpen ? " is-open" : ""}`}>
      <div className="agency-playbook-browser agency-playbook-browser--directory agency-playbook-browser--catalog catalog-custom-scoping">
        <div className="catalog-toolbar" role="search" aria-label="Filter custom requests and solutions">
          <div className="catalog-scope" role="tablist" aria-label="Custom requests and solutions">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "requests"}
              className={`catalog-scope__btn${tab === "requests" ? " is-active" : ""}`}
              onClick={() => switchTab("requests")}
            >
              Custom requests
              <span className="catalog-scope__count">{index.requests.length}</span>
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "solutions"}
              className={`catalog-scope__btn${tab === "solutions" ? " is-active" : ""}`}
              onClick={() => switchTab("solutions")}
            >
              Custom solutions
              <span className="catalog-scope__count">{index.solutions.length}</span>
            </button>
          </div>
          <div className="catalog-toolbar__fields">
            <div
              className={`agency-tier-filter-field agency-tier-filter-field--search agency-tier-filter-field--search-directory${query.trim() ? " agency-tier-filter-field--active" : ""}`}
            >
              <label className="agency-tier-filter-field__label" htmlFor={searchId}>
                Search
              </label>
              <div className="agency-tier-filter-field__control agency-tier-filter-field__control--search">
                <input
                  id={searchId}
                  type="search"
                  className="agency-tier-filter-field__input"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={tab === "requests" ? "Name, client…" : "Solution, client…"}
                  autoComplete="off"
                />
              </div>
            </div>
            {tab === "requests" ? (
              <div
                className={`agency-tier-filter-field agency-tier-filter-field--select${statusFilter !== "all" ? " agency-tier-filter-field--active" : ""}`}
              >
                <label className="agency-tier-filter-field__label" htmlFor={statusId}>
                  Status
                </label>
                <div className="agency-tier-filter-field__control">
                  <select
                    id={statusId}
                    className="agency-tier-filter-field__select"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as "all" | CatalogRequestStatus)}
                  >
                    <option value="all">All</option>
                    <option value="open">Open</option>
                    <option value="fulfilled">Done</option>
                    <option value="skipped">Skip</option>
                  </select>
                </div>
              </div>
            ) : null}
            <span className="catalog-toolbar__count">{shownCount} shown</span>
          </div>
        </div>

        {loading ? (
          <p className="catalog-custom-scoping__empty">Loading…</p>
        ) : error ? (
          <p className="catalog-custom-scoping__empty" role="alert">
            {error}
          </p>
        ) : tab === "requests" ? (
          <RequestTable
            rows={requests}
            emptyMessage={
              index.requests.length === 0 ? "No custom requests yet." : "No custom requests match."
            }
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(selectedId === id ? null : id)}
          />
        ) : (
          <SolutionTable
            rows={solutions}
            emptyMessage={
              index.solutions.length === 0 ? "No custom solutions yet." : "No custom solutions match."
            }
            selectedId={selectedId}
            onSelect={(id) => setSelectedId(selectedId === id ? null : id)}
          />
        )}
      </div>

      {selectedRequest ? (
        <RequestInspector
          row={selectedRequest}
          busy={deletingId === selectedRequest.id}
          onClose={() => setSelectedId(null)}
          onDelete={() => void deleteRequest(selectedRequest)}
        />
      ) : selectedSolution ? (
        <SolutionInspector
          row={selectedSolution}
          busy={deletingId === selectedSolution.id}
          onClose={() => setSelectedId(null)}
          onDelete={() => void deleteSolution(selectedSolution)}
        />
      ) : null}
    </div>
  );
}

function RequestTable({
  rows,
  emptyMessage,
  selectedId,
  onSelect,
}: {
  rows: CatalogCustomScopingRequestRow[];
  emptyMessage: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="agency-catalog-tier-sheet__scroll agency-catalog-directory__scroll">
      <table className="agency-catalog-tier-sheet__table agency-catalog-directory__table catalog-custom-scoping__table catalog-custom-scoping__table--requests">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Type</th>
            <th scope="col">Status</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="agency-catalog-tier-sheet__empty">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const selected = selectedId === row.id;
              const type = catalogDeliverableShortLabel(customScopingDeliverableLabel(row.request));
              return (
                <tr
                  key={row.id}
                  className={`agency-catalog-directory__parent${selected ? " is-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-selected={selected}
                  onClick={() => onSelect(row.id)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onSelect(row.id);
                  }}
                >
                  <td>
                    <div className="agency-catalog-directory__name-cell">
                      <div className="agency-catalog-directory__name-copy">
                        <span className="agency-catalog-tier-sheet__tier-title">{row.request.name}</span>
                        <span className="agency-catalog-directory__inline-meta">{row.clientLabel}</span>
                      </div>
                    </div>
                  </td>
                  <td className="agency-catalog-directory__cell--type">
                    <span className="agency-catalog-directory__type" title={customScopingDeliverableLabel(row.request)}>
                      {type}
                    </span>
                  </td>
                  <td>
                    <span className={`catalog-custom-scoping__status is-${row.status}`}>{statusLabel(row.status)}</span>
                  </td>
                  <td className="catalog-custom-scoping__date">{formatWhen(row.updatedAt)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function SolutionTable({
  rows,
  emptyMessage,
  selectedId,
  onSelect,
}: {
  rows: CatalogCustomSolutionRow[];
  emptyMessage: string;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="agency-catalog-tier-sheet__scroll agency-catalog-directory__scroll">
      <table className="agency-catalog-tier-sheet__table agency-catalog-directory__table catalog-custom-scoping__table catalog-custom-scoping__table--solutions">
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Hrs</th>
            <th scope="col">Price</th>
            <th scope="col">Updated</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td colSpan={4} className="agency-catalog-tier-sheet__empty">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const selected = selectedId === row.id;
              return (
                <tr
                  key={row.id}
                  className={`agency-catalog-directory__parent${selected ? " is-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  aria-selected={selected}
                  onClick={() => onSelect(row.id)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter" && e.key !== " ") return;
                    e.preventDefault();
                    onSelect(row.id);
                  }}
                >
                  <td>
                    <div className="agency-catalog-directory__name-cell">
                      <div className="agency-catalog-directory__name-copy">
                        <span className="agency-catalog-tier-sheet__tier-title">{row.headline}</span>
                        <span className="agency-catalog-directory__inline-meta">{row.clientLabel}</span>
                      </div>
                    </div>
                  </td>
                  <td className="agency-catalog-directory__cell--hours">{row.hours}</td>
                  <td className="agency-catalog-directory__cell--price">{row.price}</td>
                  <td className="catalog-custom-scoping__date">{formatWhen(row.updatedAt)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

function RequestInspector({
  row,
  busy,
  onClose,
  onDelete,
}: {
  row: CatalogCustomScopingRequestRow;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const fields = requestInspectorFields(row);
  const type = customScopingDeliverableLabel(row.request);
  return (
    <aside className="catalog-inspector" aria-label={`${row.request.name} details`}>
      <header className="catalog-inspector__head">
        <p className="catalog-inspector__type">{type}</p>
        <div className="catalog-inspector__head-actions">
          <button type="button" className="catalog-inspector__close" onClick={onClose} aria-label="Close details">
            ×
          </button>
        </div>
      </header>
      <h2 className="catalog-inspector__title">{row.request.name}</h2>
      <p className="catalog-inspector__owner">
        {row.clientLabel}
        {" · "}
        <EntityLink to={proposalPath(row.proposalId)}>{row.roadmapTitle}</EntityLink>
        {" · "}
        {catalogProposalStatusLabel(row.reviewStatus)}
      </p>
      <dl className="catalog-inspector__stats">
        <div>
          <dt>Status</dt>
          <dd>{statusLabel(row.status)}</dd>
        </div>
        <div>
          <dt>Lines</dt>
          <dd>{row.linkedCount}</dd>
        </div>
        <div>
          <dt>Updated</dt>
          <dd>{formatWhen(row.updatedAt)}</dd>
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
        <EntityLink className="catalog-inspector__btn catalog-inspector__btn--primary" to={proposalPath(row.proposalId)}>
          Open proposal
        </EntityLink>
        <button
          type="button"
          className="catalog-inspector__btn catalog-inspector__btn--danger"
          disabled={busy}
          onClick={onDelete}
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </aside>
  );
}

function SolutionInspector({
  row,
  busy,
  onClose,
  onDelete,
}: {
  row: CatalogCustomSolutionRow;
  busy: boolean;
  onClose: () => void;
  onDelete: () => void;
}) {
  const description = row.card.description.trim();
  return (
    <aside className="catalog-inspector" aria-label={`${row.headline} details`}>
      <header className="catalog-inspector__head">
        <p className="catalog-inspector__type">Custom</p>
        <div className="catalog-inspector__head-actions">
          <button type="button" className="catalog-inspector__close" onClick={onClose} aria-label="Close details">
            ×
          </button>
        </div>
      </header>
      <h2 className="catalog-inspector__title">{row.headline}</h2>
      <p className="catalog-inspector__owner">
        {row.clientLabel}
        {" · "}
        <EntityLink to={proposalPath(row.proposalId)}>{row.roadmapTitle}</EntityLink>
        {" · "}
        {catalogProposalStatusLabel(row.reviewStatus)}
      </p>
      <dl className="catalog-inspector__stats">
        <div>
          <dt>Hours</dt>
          <dd>{row.hours}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>{row.price}</dd>
        </div>
        <div>
          <dt>Tasks</dt>
          <dd>{row.taskCount}</dd>
        </div>
      </dl>
      <div className="catalog-inspector__body">
        {description ? (
          <section className="catalog-inspector__section">
            <h3 className="catalog-inspector__section-title">Overview</h3>
            <p className="catalog-inspector__overview">{description}</p>
          </section>
        ) : null}
        <section className="catalog-inspector__section">
          <h3 className="catalog-inspector__section-title">Source</h3>
          <p className="catalog-inspector__overview">
            {row.requestName
              ? `${row.requestName}${row.requestType ? ` · ${row.requestType}` : ""}`
              : "Not linked to a request."}
          </p>
        </section>
      </div>
      <div className="catalog-inspector__actions">
        <EntityLink className="catalog-inspector__btn catalog-inspector__btn--primary" to={proposalPath(row.proposalId)}>
          Open proposal
        </EntityLink>
        <button
          type="button"
          className="catalog-inspector__btn catalog-inspector__btn--danger"
          disabled={busy}
          onClick={onDelete}
        >
          {busy ? "Deleting…" : "Delete"}
        </button>
      </div>
    </aside>
  );
}
