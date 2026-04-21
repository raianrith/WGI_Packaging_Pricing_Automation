import { useCallback, useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { useLocation } from "react-router-dom";
import { PACKAGING_DATA_CHANGED_EVENT } from "../lib/packagingEvents";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";

type Counts = {
  packages: number;
  solutions: number;
  tiers: number;
  tasks: number;
};

export function GlobalKpiStrip() {
  const location = useLocation();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (browserKeyConfigurationError() || !envConfigured()) {
      setCounts(null);
      setLoading(false);
      return;
    }
    const client = getSupabase();
    if (!client) {
      setCounts(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [p, s, t, k] = await Promise.all([
      client.from("packages").select("*", { count: "exact", head: true }),
      client.from("solutions").select("*", { count: "exact", head: true }),
      client.from("solution_tiers").select("*", { count: "exact", head: true }),
      client.from("tasks").select("*", { count: "exact", head: true }),
    ]);
    const err = p.error || s.error || t.error || k.error;
    if (err) {
      setCounts(null);
      setLoading(false);
      return;
    }
    setCounts({
      packages: p.count ?? 0,
      solutions: s.count ?? 0,
      tiers: t.count ?? 0,
      tasks: k.count ?? 0,
    });
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load, location.pathname]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void load();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  useEffect(() => {
    function onDataChanged() {
      void load();
    }
    window.addEventListener(PACKAGING_DATA_CHANGED_EVENT, onDataChanged);
    return () => window.removeEventListener(PACKAGING_DATA_CHANGED_EVENT, onDataChanged);
  }, [load]);

  if (browserKeyConfigurationError() || !envConfigured()) {
    return null;
  }

  const items: { key: keyof Counts; label: string; hint: string }[] = [
    { key: "packages", label: "Packages", hint: "Bundles" },
    { key: "solutions", label: "Solutions", hint: "Offerings" },
    { key: "tiers", label: "Tiers", hint: "Variants" },
    { key: "tasks", label: "Tasks", hint: "Steps" },
  ];

  return (
    <section className="global-kpi-strip" aria-label="Vault totals">
      <header className="global-kpi-strip__head">
        <h2 className="global-kpi-strip__title">At a glance</h2>
        <p className="global-kpi-strip__subtitle">Live counts from your workspace</p>
      </header>
      <ul className="global-kpi-strip__grid" role="list">
        {items.map((item, i) => {
          const value = counts?.[item.key];
          const showDash = loading || value === undefined;
          return (
            <li key={item.key}>
              <article
                className="global-kpi-card"
                style={
                  {
                    "--kpi-accent": accentLine[i % accentLine.length],
                  } as CSSProperties
                }
              >
                <p className="global-kpi-card__value" aria-live="polite">
                  {showDash ? "—" : formatCount(value)}
                </p>
                <p className="global-kpi-card__label">{item.label}</p>
                <p className="global-kpi-card__hint">{item.hint}</p>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function formatCount(n: number): string {
  return n.toLocaleString();
}

const accentLine = [
  "var(--accent)",
  "#1b6f5c",
  "#b45309",
  "#1d4ed8",
] as const;
