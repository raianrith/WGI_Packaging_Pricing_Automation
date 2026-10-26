import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AGENCY_HOME_DESCRIPTION,
  NAV_PACKAGE_BUILDER,
  NAV_PROPOSAL_BUILDER,
  NAV_SOLUTIONS_OVERVIEW,
} from "../branding";
import { GlobalKpiStrip } from "../components/GlobalKpiStrip";
import { useAuth } from "../context/AuthContext";
import { greetingFirstName } from "../lib/displayName";

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

export function AgencyHomeView() {
  const { isAdmin, profileLoading, displayName } = useAuth();
  const name = greetingFirstName(displayName);
  const greeting = name ? `${greetingWord()}, ${name}` : greetingWord();

  const jumps: JumpLink[] = [
    { to: "/solutions", label: "Catalog", hint: "Solutions and packages in one table" },
    { to: "/directory-details", label: "Solutions Overview", hint: "Scope, process, tasks, and pricing" },
    { to: "/package-overview", label: "Package Overview", hint: "Pricing, components, and tasks for a package" },
    { to: "/custom-solutions", label: "Custom Solutions", hint: "Scoping requests and ops-built custom lines" },
    { to: "/solution-requests", label: "New Solution Request", hint: "Ask for a solution that isn't in the vault" },
  ];
  if (!profileLoading && isAdmin) {
    jumps.push({ to: "/admin", label: "Admin", hint: "Edit vault data, templates, and settings" });
  }

  return (
    <div className="app-home">
      <div className="app-home__glow" aria-hidden />
      <header className="app-home__hero">
        <p className="app-home__eyebrow">Solutions Directory</p>
        <h1 className="app-home__title">{greeting}</h1>
        <p className="app-home__lede">{AGENCY_HOME_DESCRIPTION}</p>
      </header>

      <GlobalKpiStrip variant="home" />

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
