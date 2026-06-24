import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { Package, SolutionTierTaxonomyOptionRow } from "../types";
import { PackageTypeTaxonomyTagsEditor } from "./PackageTypeTaxonomyTagsEditor";
import { filterPresetPackages, packageTaxonomyPayload } from "../lib/presetPackages";
import { fetchPackageBuilderCatalog } from "../lib/packageBuilderSlots";
import { tierTaxonomyOptionsFromRows } from "../lib/tierTaxonomy";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { getSupabase } from "../lib/supabase";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";

type Props = {
  packages: Package[];
  muted: CSSProperties;
  input: CSSProperties;
  btnPrimary: CSSProperties;
  setOpErr: (s: string | null) => void;
  setOpOk: (s: string | null) => void;
  onSaved: () => Promise<void>;
};

function sortId(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return a.localeCompare(b);
}

function tagCount(pkg: Package): number {
  return (pkg.phase_tags?.length ?? 0) + (pkg.category_tags?.length ?? 0) + (pkg.tactic_tags?.length ?? 0);
}

export function PresetPackageTaxonomyTagsPanel({
  packages,
  muted,
  input,
  btnPrimary,
  setOpErr,
  setOpOk,
  onSaved,
}: Props) {
  const [presetPackages, setPresetPackages] = useState<Package[]>([]);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [taxonomyOptions, setTaxonomyOptions] = useState(tierTaxonomyOptionsFromRows([]));
  const [packageFilter, setPackageFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadNote, setLoadNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client) return;
    const [builderPack, taxRes] = await Promise.all([
      fetchPackageBuilderCatalog(client),
      client.from("solution_tier_taxonomy_options").select("id,kind,label").order("kind").order("label"),
    ]);
    setLoadNote(builderPack.error);
    if (!taxRes.error && taxRes.data) {
      setTaxonomyOptions(
        tierTaxonomyOptionsFromRows(taxRes.data as SolutionTierTaxonomyOptionRow[])
      );
    }
    const preset = filterPresetPackages(packages, builderPack.catalog.types).sort((a, b) =>
      sortId(a.package_id, b.package_id)
    );
    setPresetPackages(preset);
    setSelectedPackageId((prev) =>
      prev && preset.some((p) => p.package_id === prev) ? prev : preset[0]?.package_id ?? null
    );
  }, [packages]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredPackages = useMemo(() => {
    const q = packageFilter.trim().toLowerCase();
    if (!q) return presetPackages;
    return presetPackages.filter(
      (p) =>
        p.package_name.toLowerCase().includes(q) ||
        p.package_id.toLowerCase().includes(q)
    );
  }, [presetPackages, packageFilter]);

  const selectedPackage = useMemo(
    () => presetPackages.find((p) => p.package_id === selectedPackageId) ?? null,
    [presetPackages, selectedPackageId]
  );

  const taggedCount = useMemo(
    () => presetPackages.filter((pkg) => tagCount(pkg) > 0).length,
    [presetPackages]
  );

  const setPackage = (packageId: string, patch: Partial<Package>) => {
    setPresetPackages((prev) =>
      prev.map((p) => (p.package_id === packageId ? { ...p, ...patch } : p))
    );
  };

  const saveSelected = async () => {
    if (!selectedPackage) return;
    const client = getSupabase();
    if (!client) {
      setOpErr("Supabase is not configured.");
      return;
    }
    setBusy(true);
    setOpErr(null);
    setOpOk(null);
    const payload = packageTaxonomyPayload(selectedPackage);
    const { error } = await client
      .from("packages")
      .update(payload)
      .eq("package_id", selectedPackage.package_id);
    setBusy(false);
    if (error) {
      setOpErr(friendlyMutationMessage(error.message));
      return;
    }
    setOpOk(`Saved tags for ${selectedPackage.package_name}.`);
    notifyPackagingDataChanged();
    await onSaved();
  };

  return (
    <div className="admin-pkg-builder admin-pkg-builder--preset-tags">
      <header className="admin-pkg-builder__hero">
        <h2 className="admin-pkg-builder__title">Add Tags to Preset Packages</h2>
        <p className="admin-pkg-builder__lead" style={muted}>
          Tag preset packages with phase, category, and tactic labels so they appear in the Home
          guided browse. Custom packages built from configurable families are excluded.
        </p>
        {presetPackages.length > 0 ? (
          <div className="admin-pkg-builder__stats" aria-label="Preset package summary">
            <span className="admin-pkg-builder__stat">
              {presetPackages.length} preset package{presetPackages.length === 1 ? "" : "s"}
            </span>
            <span className="admin-pkg-builder__stat">
              {taggedCount} tagged
            </span>
          </div>
        ) : null}
      </header>

      {loadNote ? (
        <p className="admin-pkg-builder__alert" role="status">
          Could not load full configuration ({loadNote}). Run{" "}
          <code>packages_preset_taxonomy_tags.sql</code> in Supabase if tag columns are missing.
        </p>
      ) : null}

      {presetPackages.length === 0 ? (
        <p className="admin-pkg-builder__empty" style={muted}>
          No preset packages found. Packages whose category matches a configurable family are
          treated as custom builds and are not listed here.
        </p>
      ) : (
        <div className="admin-pkg-builder__layout">
          <aside className="admin-pkg-builder__types" aria-label="Preset packages">
            <div className="admin-pkg-builder__panel-head">
              <h3 className="admin-pkg-builder__panel-title">Preset packages</h3>
            </div>

            <label className="admin-pkg-builder__preset-search">
              <span className="admin-pkg-builder__preset-search-label">Search</span>
              <input
                type="search"
                className="admin-pkg-builder__preset-search-input"
                style={input}
                value={packageFilter}
                onChange={(e) => setPackageFilter(e.target.value)}
                placeholder="Search by name or ID…"
                aria-label="Search preset packages"
              />
            </label>

            {filteredPackages.length === 0 ? (
              <p className="admin-pkg-builder__preset-empty" style={muted}>
                No packages match your search.
              </p>
            ) : (
              <ul className="admin-pkg-builder__type-list">
                {filteredPackages.map((pkg) => {
                  const active = pkg.package_id === selectedPackageId;
                  const count = tagCount(pkg);
                  return (
                    <li
                      key={pkg.package_id}
                      className={
                        active
                          ? "admin-pkg-builder__type-item is-active"
                          : "admin-pkg-builder__type-item"
                      }
                    >
                      <div className="admin-pkg-builder__type-card-wrap admin-pkg-builder__type-card-wrap--preset">
                        <button
                          type="button"
                          className="admin-pkg-builder__type-card"
                          disabled={busy}
                          onClick={() => setSelectedPackageId(pkg.package_id)}
                        >
                          <span className="admin-pkg-builder__preset-id" title={`Package ${pkg.package_id}`}>
                            {pkg.package_id}
                          </span>
                          <span className="admin-pkg-builder__type-body">
                            <span className="admin-pkg-builder__preset-name">{pkg.package_name}</span>
                            <span className="admin-pkg-builder__type-meta-row">
                              {count > 0 ? (
                                <span className="admin-pkg-builder__type-tag-count">
                                  {count} tag{count === 1 ? "" : "s"}
                                </span>
                              ) : (
                                <span className="admin-pkg-builder__type-meta">No tags yet</span>
                              )}
                            </span>
                          </span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </aside>

          <main className="admin-pkg-builder__main" aria-label="Preset package tags">
            {!selectedPackage ? (
              <p className="admin-pkg-builder__empty" style={muted}>
                Select a preset package to edit its playbook tags.
              </p>
            ) : (
              <>
                <div className="admin-pkg-builder__main-head">
                  <div>
                    <h3 className="admin-pkg-builder__main-title">{selectedPackage.package_name}</h3>
                    <p className="admin-pkg-builder__main-hint" style={muted}>
                      Package ID {selectedPackage.package_id}. Tags control where this preset appears
                      in the Home guided browse.
                    </p>
                  </div>
                  <div className="admin-pkg-builder__main-actions">
                    <button
                      type="button"
                      className="admin-btn-primary admin-pkg-builder__save-btn"
                      style={btnPrimary}
                      disabled={busy}
                      onClick={() => void saveSelected()}
                    >
                      {busy ? "Saving…" : "Save tags"}
                    </button>
                  </div>
                </div>

                <PackageTypeTaxonomyTagsEditor
                  phaseTags={selectedPackage.phase_tags ?? []}
                  categoryTags={selectedPackage.category_tags ?? []}
                  tacticTags={selectedPackage.tactic_tags ?? []}
                  options={taxonomyOptions}
                  disabled={busy}
                  sectionLead="Tag this preset package with phases, categories, and tactics from your playbook lists."
                  onChange={(patch) => setPackage(selectedPackage.package_id, patch)}
                />
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
