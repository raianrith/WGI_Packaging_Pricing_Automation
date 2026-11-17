import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AGENCY_HOME_DESCRIPTION,
  NAV_PACKAGE_BUILDER,
  NAV_PROPOSAL_BUILDER,
  NAV_SOLUTIONS_OVERVIEW,
} from "../branding";
import { GlobalKpiStrip } from "../components/GlobalKpiStrip";
import { useAuth } from "../context/AuthContext";
import {
  appFeedbackCategoryShort,
  appFeedbackPriorityLabel,
  appFeedbackStatusLabel,
  formatAppFeedbackDate,
  mapSolutionRequestToFeedbackBoardRow,
  type AppFeedback,
  type FeedbackBoardRow,
} from "../lib/appFeedback";
import { greetingFirstName } from "../lib/displayName";
import { getSupabase } from "../lib/supabase";

type PrimaryCard = {
  to: string;
  kicker: string;
  title: string;
  body: string;
  icon: ReactNode;
};

type JumpLink = {
  to: string;
  label: string;
  hint: string;
};

function greetingWord(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function IconProposal() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="22" height="22" aria-hidden>
      <rect x="4" y="3.5" width="16" height="17" rx="2.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 8.5h8M8 12h8M8 15.5h5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function IconDirectory() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="22" height="22" aria-hidden>
      <path
        d="M4.5 7.5A2.5 2.5 0 0 1 7 5h3.2c.4 0 .8.2 1.1.5L12.5 7H17a2.5 2.5 0 0 1 2.5 2.5v7A2.5 2.5 0 0 1 17 19H7a2.5 2.5 0 0 1-2.5-2.5v-9Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconBuilder() {
  return (
    <svg viewBox="0 0 24 24" fill="none" width="22" height="22" aria-hidden>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1.75" stroke="currentColor" strokeWidth="1.7" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1.75" stroke="currentColor" strokeWidth="1.7" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1.75" stroke="currentColor" strokeWidth="1.7" />
      <path d="M17 14v6M14 17h6" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

const PRIMARY: PrimaryCard[] = [
  {
    to: "/roadmap",
    kicker: "Write a proposal",
    title: NAV_PROPOSAL_BUILDER,
    body: "Assemble offerings, packages, and playbooks into a client-ready proposal.",
    icon: <IconProposal />,
  },
  {
    to: "/solutions",
    kicker: "Look something up",
    title: NAV_SOLUTIONS_OVERVIEW,
    body: "Browse solutions and packages, hours, and pricing without building anything yet.",
    icon: <IconDirectory />,
  },
  {
    to: "/package-builder",
    kicker: "Build a bundle",
    title: NAV_PACKAGE_BUILDER,
    body: "Pick a template, choose components, and confirm package pricing.",
    icon: <IconBuilder />,
  },
];

function assignedSortRank(status: FeedbackBoardRow["status"]): number {
  switch (status) {
    case "in_progress":
      return 0;
    case "reviewing":
      return 1;
    case "pending":
      return 2;
    case "deferred":
      return 3;
    case "resolved":
      return 4;
    default:
      return 5;
  }
}

export function AgencyHomeView() {
  const { user, isAdmin, profileLoading, displayName } = useAuth();
  const name = greetingFirstName(displayName);
  const greeting = name ? `${greetingWord()}, ${name}` : greetingWord();
  const [assigned, setAssigned] = useState<FeedbackBoardRow[]>([]);
  const [assignedLoading, setAssignedLoading] = useState(false);

  const loadAssigned = useCallback(async () => {
    const client = getSupabase();
    const userId = user?.id;
    if (!client || !userId) {
      setAssigned([]);
      setAssignedLoading(false);
      return;
    }
    setAssignedLoading(true);
    const [feedbackRes, legacyRes] = await Promise.all([
      client
        .from("app_feedback")
        .select("*")
        .eq("assigned_to_user_id", userId)
        .neq("status", "resolved")
        .order("updated_at", { ascending: false }),
      client
        .from("solution_requests")
        .select("*")
        .eq("assigned_to_user_id", userId)
        .neq("status", "not_approved")
        .order("updated_at", { ascending: false }),
    ]);
    const feedbackRows: FeedbackBoardRow[] = feedbackRes.error
      ? []
      : ((feedbackRes.data ?? []) as AppFeedback[]).map((row) => ({
          ...row,
          source: "app_feedback" as const,
        }));
    const legacyRows: FeedbackBoardRow[] = legacyRes.error
      ? []
      : ((legacyRes.data ?? []) as Parameters<typeof mapSolutionRequestToFeedbackBoardRow>[0][])
          .map(mapSolutionRequestToFeedbackBoardRow)
          .filter((row) => row.status !== "resolved" && row.status !== "deferred");
    if (feedbackRes.error && /assigned_to_/i.test(feedbackRes.error.message)) {
      console.warn("[home] assignee columns missing — run supabase/app_feedback_assignee.sql");
    }
    const merged = [...feedbackRows, ...legacyRows].sort((a, b) => {
      const rank = assignedSortRank(a.status) - assignedSortRank(b.status);
      if (rank !== 0) return rank;
      return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    });
    setAssigned(merged);
    setAssignedLoading(false);
  }, [user?.id]);

  useEffect(() => {
    void loadAssigned();
  }, [loadAssigned]);

  const jumps: JumpLink[] = [
    { to: "/solutions", label: "Catalog", hint: "Solutions and packages in one table" },
    { to: "/directory-details", label: "Solutions Overview", hint: "Scope, process, tasks, and pricing" },
    { to: "/custom-solutions", label: "Custom Solutions", hint: "Scoping requests and ops-built custom lines" },
    { to: "/feedback", label: "Feedback", hint: "Bugs, upgrades, content gaps, and new solution requests" },
  ];
  if (!profileLoading && isAdmin) {
    jumps.push({ to: "/admin", label: "Admin", hint: "Edit vault data, templates, and settings" });
  }

  const showAssigned = assignedLoading || assigned.length > 0;

  return (
    <div className="app-home">
      <div className="app-home__glow" aria-hidden />
      <header className="app-home__hero">
        <p className="app-home__eyebrow">Solutions Directory</p>
        <h1 className="app-home__title">{greeting}</h1>
        <p className="app-home__lede">{AGENCY_HOME_DESCRIPTION}</p>
      </header>

      <GlobalKpiStrip variant="home" />

      {showAssigned ? (
        <section className="app-home__assigned" aria-label="Assigned to you">
          <div className="app-home__assigned-head">
            <h2 className="app-home__jumps-title">Assigned to you</h2>
            {!assignedLoading && assigned.length > 0 ? (
              <Link className="app-home__assigned-all" to="/feedback">
                Open Feedback
              </Link>
            ) : null}
          </div>
          {assignedLoading ? (
            <p className="app-home__assigned-empty">Loading your assignments…</p>
          ) : (
            <ul className="app-home__assigned-list">
              {assigned.map((row) => (
                <li key={`${row.source}:${row.id}`}>
                  <Link className="app-home__assigned-item" to={`/feedback?id=${encodeURIComponent(row.id)}`}>
                    <span className="app-home__assigned-main">
                      <span className="app-home__assigned-title">
                        {row.title}
                        {row.source === "solution_request" ? (
                          <span className="app-home__assigned-legacy"> Legacy</span>
                        ) : null}
                      </span>
                      <span className="app-home__assigned-meta">
                        From {row.requested_by_name}
                        {" · "}
                        {formatAppFeedbackDate(row.updated_at || row.created_at)}
                      </span>
                    </span>
                    <span className="app-home__assigned-tags">
                      <span className="app-home__assigned-chip">{appFeedbackCategoryShort(row.category)}</span>
                      <span className="app-home__assigned-chip app-home__assigned-chip--status">
                        {appFeedbackStatusLabel(row.status)}
                      </span>
                      <span className="app-home__assigned-chip app-home__assigned-chip--priority">
                        {appFeedbackPriorityLabel(row.priority)}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      <section className="app-home__primary" aria-label="Start here">
        {PRIMARY.map((card) => (
          <Link key={card.to} className="app-home__card" to={card.to}>
            <span className="app-home__card-icon" aria-hidden>
              {card.icon}
            </span>
            <span className="app-home__card-kicker">{card.kicker}</span>
            <span className="app-home__card-title">{card.title}</span>
            <span className="app-home__card-body">{card.body}</span>
            <span className="app-home__card-cta">
              Open <span aria-hidden>→</span>
            </span>
          </Link>
        ))}
      </section>

      <section className="app-home__jumps" aria-label="More places">
        <h2 className="app-home__jumps-title">Jump to</h2>
        <ul className="app-home__jump-list">
          {jumps.map((item) => (
            <li key={item.to}>
              <Link className="app-home__jump" to={item.to}>
                <span className="app-home__jump-label">{item.label}</span>
                <span className="app-home__jump-hint">{item.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
