import { useCallback, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { PackageBuilderPackageType, Solution, SolutionTier } from "../types";
import { getSupabase } from "../lib/supabase";
import { useAuth } from "../context/AuthContext";
import { fetchPackageBuilderCatalog } from "../lib/packageBuilderSlots";
import { isVariableTierRefId } from "../lib/proposalVariableTiers";
import {
  defaultPlaybookPackageConfig,
  fetchPlaybookPackageConfig,
  savePlaybookPackageConfig,
  type PlaybookPackageConfig,
} from "../lib/playbookPackageConfig";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";

type Props = {
  solutions: Solution[];
  tiers: SolutionTier[];
  setOpErr: (msg: string | null) => void;
  setOpOk: (msg: string | null) => void;
  styles: {
    panel: CSSProperties;
    h2: CSSProperties;
    muted: CSSProperties;
    input: CSSProperties;
    btn: CSSProperties;
    btnPrimary: CSSProperties;
  };
};

type SolutionGroup = {
  solution: Solution;
  tiers: SolutionTier[];
};

function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const s = new Set(a);
  return b.every((x) => s.has(x));
}

function configsEqual(a: PlaybookPackageConfig, b: PlaybookPackageConfig): boolean {
  return (
    a.limitPackageTypes === b.limitPackageTypes &&
    a.limitSolutionTiers === b.limitSolutionTiers &&
    sameSet(a.allowedPackageTypeIds, b.allowedPackageTypeIds) &&
    sameSet(a.allowedSolutionTierIds, b.allowedSolutionTierIds)
  );
}

function formatSavedAt(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function PlaybookPackageConfigPanel({ solutions, tiers, setOpErr, setOpOk, styles }: Props) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [packageTypes, setPackageTypes] = useState<PackageBuilderPackageType[]>([]);
  const [saved, setSaved] = useState<PlaybookPackageConfig>(defaultPlaybookPackageConfig);
  const [draft, setDraft] = useState<PlaybookPackageConfig>(defaultPlaybookPackageConfig);
  const [packageSearch, setPackageSearch] = useState("");
  const [solutionSearch, setSolutionSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setLoadNote(null);
    const client = getSupabase();
    if (!client) {
      setLoadNote("Supabase is not configured.");
      setLoading(false);
      return;
    }
    const [cfgRes, catRes] = await Promise.all([
      fetchPlaybookPackageConfig(client),
      fetchPackageBuilderCatalog(client),
    ]);
    if (cfgRes.error) setLoadNote(`Could not load playbook settings: ${cfgRes.error}`);
    else if (catRes.error) setLoadNote(`Could not load configurable packages: ${catRes.error}`);
    setSaved(cfgRes.config);
    setDraft(cfgRes.config);
    setPackageTypes(catRes.catalog.types);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = !configsEqual(saved, draft);

  const solutionGroups = useMemo((): SolutionGroup[] => {
    const bySolution = new Map<string, SolutionTier[]>();
    for (const t of tiers) {
      if (isVariableTierRefId(t.solution_tier_id)) continue;
      const list = bySolution.get(t.solution_id) ?? [];
      list.push(t);
      bySolution.set(t.solution_id, list);
    }
    return solutions
      .filter((s) => bySolution.has(s.solution_id))
      .map((s) => ({
        solution: s,
        tiers: (bySolution.get(s.solution_id) ?? []).sort((a, b) =>
          a.solution_tier_id.localeCompare(b.solution_tier_id, undefined, { numeric: true })
        ),
      }))
      .sort((a, b) =>
        a.solution.solution_name.localeCompare(b.solution.solution_name, undefined, { sensitivity: "base" })
      );
  }, [solutions, tiers]);

  const totalTierCount = useMemo(
    () => solutionGroups.reduce((n, g) => n + g.tiers.length, 0),
    [solutionGroups]
  );

  const allowedTypeSet = useMemo(() => new Set(draft.allowedPackageTypeIds), [draft.allowedPackageTypeIds]);
  const allowedTierSet = useMemo(() => new Set(draft.allowedSolutionTierIds), [draft.allowedSolutionTierIds]);

  const filteredTypes = useMemo(() => {
    const q = packageSearch.trim().toLowerCase();
    if (!q) return packageTypes;
    return packageTypes.filter((t) => t.name.toLowerCase().includes(q));
  }, [packageTypes, packageSearch]);

  const filteredGroups = useMemo(() => {
    const q = solutionSearch.trim().toLowerCase();
    if (!q) return solutionGroups;
    return solutionGroups
      .map((g) => {
        if (g.solution.solution_name.toLowerCase().includes(q)) return g;
        const tiersHit = g.tiers.filter((t) => t.solution_tier_name.toLowerCase().includes(q));
        return tiersHit.length ? { ...g, tiers: tiersHit } : null;
      })
      .filter((g): g is SolutionGroup => g != null);
  }, [solutionGroups, solutionSearch]);

  const patch = (p: Partial<PlaybookPackageConfig>) => setDraft((d) => ({ ...d, ...p }));

  const toggleType = (id: string) => {
    const next = new Set(allowedTypeSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    patch({ allowedPackageTypeIds: [...next] });
  };

  const setTiers = (ids: string[], allowed: boolean) => {
    const next = new Set(allowedTierSet);
    for (const id of ids) {
      if (allowed) next.add(id);
      else next.delete(id);
    }
    patch({ allowedSolutionTierIds: [...next] });
  };

  const toggleExpanded = (solutionId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(solutionId)) next.delete(solutionId);
      else next.add(solutionId);
      return next;
    });
  };

  const save = async () => {
    const client = getSupabase();
    if (!client) {
      setOpErr("Supabase is not configured.");
      return;
    }
    setSaving(true);
    setOpErr(null);
    const { config, error } = await savePlaybookPackageConfig(client, draft, user?.email ?? null);
    setSaving(false);
    if (error || !config) {
      setOpErr(`Could not save playbook package settings: ${error ?? "unknown error"}`);
      return;
    }
    setSaved(config);
    setDraft(config);
    notifyPackagingDataChanged();
    setOpOk("Playbook package settings saved.");
  };

  const allowedTypeCount = draft.limitPackageTypes
    ? packageTypes.filter((t) => allowedTypeSet.has(t.id)).length
    : packageTypes.length;
  const allowedTierCount = draft.limitSolutionTiers
    ? solutionGroups.reduce((n, g) => n + g.tiers.filter((t) => allowedTierSet.has(t.solution_tier_id)).length, 0)
    : totalTierCount;

  if (loading) {
    return (
      <section className="admin-panel playbook-config" style={styles.panel}>
        <p style={styles.muted}>Loading playbook package settings…</p>
      </section>
    );
  }

  return (
    <section className="admin-panel playbook-config" style={styles.panel}>
      <header className="playbook-config__head">
        <div>
          <h2 style={styles.h2}>Playbook Packages</h2>
          <p style={styles.muted} className="playbook-config__lead">
            Control what proposal builders can bundle into a Playbook Package in the Add Packages step.
            Leave a section on <strong>All allowed</strong> to offer everything.
          </p>
        </div>
        {saved.updatedAt ? (
          <p className="playbook-config__saved" style={styles.muted}>
            Last saved {formatSavedAt(saved.updatedAt)}
            {saved.updatedByEmail ? ` by ${saved.updatedByEmail}` : ""}
          </p>
        ) : null}
      </header>

      {loadNote ? <p className="playbook-config__note">{loadNote}</p> : null}

      <div className="playbook-config__grid">
        <article className="playbook-config__card">
          <div className="playbook-config__card-head">
            <div>
              <h3 className="playbook-config__card-title">Custom packages</h3>
              <p className="playbook-config__card-hint">
                Configurable package templates that can be built inside a playbook.
              </p>
            </div>
            <span className="playbook-config__count">
              {allowedTypeCount} / {packageTypes.length} allowed
            </span>
          </div>

          <div className="playbook-config__mode" role="radiogroup" aria-label="Custom package access">
            <button
              type="button"
              role="radio"
              aria-checked={!draft.limitPackageTypes}
              className={`playbook-config__mode-btn${!draft.limitPackageTypes ? " is-selected" : ""}`}
              onClick={() => patch({ limitPackageTypes: false })}
            >
              All allowed
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={draft.limitPackageTypes}
              className={`playbook-config__mode-btn${draft.limitPackageTypes ? " is-selected" : ""}`}
              onClick={() => patch({ limitPackageTypes: true })}
            >
              Only selected
            </button>
          </div>

          {draft.limitPackageTypes ? (
            <>
              <div className="playbook-config__toolbar">
                <input
                  type="search"
                  style={styles.input}
                  value={packageSearch}
                  onChange={(e) => setPackageSearch(e.target.value)}
                  placeholder="Search custom packages…"
                  aria-label="Search custom packages"
                />
                <button
                  type="button"
                  className="playbook-config__link"
                  onClick={() =>
                    patch({
                      allowedPackageTypeIds: [
                        ...new Set([...draft.allowedPackageTypeIds, ...filteredTypes.map((t) => t.id)]),
                      ],
                    })
                  }
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="playbook-config__link"
                  onClick={() => {
                    const hide = new Set(filteredTypes.map((t) => t.id));
                    patch({ allowedPackageTypeIds: draft.allowedPackageTypeIds.filter((id) => !hide.has(id)) });
                  }}
                >
                  Clear
                </button>
              </div>
              {packageTypes.length === 0 ? (
                <p className="playbook-config__empty">
                  No configurable packages yet. Create them under Packages → Configurable package.
                </p>
              ) : filteredTypes.length === 0 ? (
                <p className="playbook-config__empty">No custom packages match your search.</p>
              ) : (
                <ul className="playbook-config__list">
                  {filteredTypes.map((t) => {
                    const checked = allowedTypeSet.has(t.id);
                    return (
                      <li key={t.id}>
                        <label className={`playbook-config__row${checked ? " is-checked" : ""}`}>
                          <input type="checkbox" checked={checked} onChange={() => toggleType(t.id)} />
                          <span className="playbook-config__row-main">
                            <span className="playbook-config__row-name">{t.name}</span>
                            {t.card_description ? (
                              <span className="playbook-config__row-sub">{t.card_description}</span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
              {draft.allowedPackageTypeIds.length === 0 ? (
                <p className="playbook-config__warn">
                  No custom packages selected — playbooks will only be able to include solutions.
                </p>
              ) : null}
            </>
          ) : (
            <p className="playbook-config__empty">
              All {packageTypes.length} configurable packages can be built inside a playbook.
            </p>
          )}
        </article>

        <article className="playbook-config__card">
          <div className="playbook-config__card-head">
            <div>
              <h3 className="playbook-config__card-title">Solutions</h3>
              <p className="playbook-config__card-hint">
                Solution tiers that can be added directly to a playbook. Variable tiers are never offered.
              </p>
            </div>
            <span className="playbook-config__count">
              {allowedTierCount} / {totalTierCount} allowed
            </span>
          </div>

          <div className="playbook-config__mode" role="radiogroup" aria-label="Solution access">
            <button
              type="button"
              role="radio"
              aria-checked={!draft.limitSolutionTiers}
              className={`playbook-config__mode-btn${!draft.limitSolutionTiers ? " is-selected" : ""}`}
              onClick={() => patch({ limitSolutionTiers: false })}
            >
              All allowed
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={draft.limitSolutionTiers}
              className={`playbook-config__mode-btn${draft.limitSolutionTiers ? " is-selected" : ""}`}
              onClick={() => patch({ limitSolutionTiers: true })}
            >
              Only selected
            </button>
          </div>

          {draft.limitSolutionTiers ? (
            <>
              <div className="playbook-config__toolbar">
                <input
                  type="search"
                  style={styles.input}
                  value={solutionSearch}
                  onChange={(e) => setSolutionSearch(e.target.value)}
                  placeholder="Search solutions or tiers…"
                  aria-label="Search solutions"
                />
                <button
                  type="button"
                  className="playbook-config__link"
                  onClick={() =>
                    setTiers(
                      filteredGroups.flatMap((g) => g.tiers.map((t) => t.solution_tier_id)),
                      true
                    )
                  }
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="playbook-config__link"
                  onClick={() =>
                    setTiers(
                      filteredGroups.flatMap((g) => g.tiers.map((t) => t.solution_tier_id)),
                      false
                    )
                  }
                >
                  Clear
                </button>
              </div>
              {filteredGroups.length === 0 ? (
                <p className="playbook-config__empty">No solutions match your search.</p>
              ) : (
                <ul className="playbook-config__list">
                  {filteredGroups.map((g) => {
                    const ids = g.tiers.map((t) => t.solution_tier_id);
                    const on = ids.filter((id) => allowedTierSet.has(id)).length;
                    const all = on === ids.length;
                    const isOpen = expanded.has(g.solution.solution_id) || solutionSearch.trim().length > 0;
                    return (
                      <li key={g.solution.solution_id} className="playbook-config__group">
                        <div className={`playbook-config__row playbook-config__row--group${on > 0 ? " is-checked" : ""}`}>
                          <input
                            type="checkbox"
                            checked={all}
                            ref={(el) => {
                              if (el) el.indeterminate = on > 0 && !all;
                            }}
                            onChange={() => setTiers(ids, !all)}
                            aria-label={`Allow all tiers of ${g.solution.solution_name}`}
                          />
                          <button
                            type="button"
                            className="playbook-config__group-toggle"
                            onClick={() => toggleExpanded(g.solution.solution_id)}
                            aria-expanded={isOpen}
                          >
                            <span className="playbook-config__row-name">{g.solution.solution_name}</span>
                            <span className="playbook-config__row-meta">
                              {on}/{ids.length} tier{ids.length === 1 ? "" : "s"}
                            </span>
                            <span className="playbook-config__chev" aria-hidden>
                              {isOpen ? "▾" : "▸"}
                            </span>
                          </button>
                        </div>
                        {isOpen ? (
                          <ul className="playbook-config__tiers">
                            {g.tiers.map((t) => {
                              const checked = allowedTierSet.has(t.solution_tier_id);
                              return (
                                <li key={t.solution_tier_id}>
                                  <label className={`playbook-config__row playbook-config__row--tier${checked ? " is-checked" : ""}`}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => setTiers([t.solution_tier_id], !checked)}
                                    />
                                    <span className="playbook-config__row-name">
                                      {t.solution_tier_name || t.solution_tier_id}
                                    </span>
                                    <code className="playbook-config__row-id">{t.solution_tier_id}</code>
                                  </label>
                                </li>
                              );
                            })}
                          </ul>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
              {draft.allowedSolutionTierIds.length === 0 ? (
                <p className="playbook-config__warn">
                  No solutions selected — playbooks will only be able to include custom packages.
                </p>
              ) : null}
            </>
          ) : (
            <p className="playbook-config__empty">
              All {totalTierCount} solution tiers can be added to a playbook.
            </p>
          )}
        </article>
      </div>

      <footer className="playbook-config__footer">
        <span className="playbook-config__status" style={styles.muted}>
          {dirty ? "Unsaved changes" : "All changes saved"}
        </span>
        <div className="playbook-config__actions">
          <button
            type="button"
            style={styles.btn}
            onClick={() => setDraft(saved)}
            disabled={!dirty || saving}
          >
            Discard changes
          </button>
          <button
            type="button"
            style={{ ...styles.btnPrimary, opacity: !dirty || saving ? 0.6 : 1 }}
            onClick={() => void save()}
            disabled={!dirty || saving}
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </footer>
    </section>
  );
}
