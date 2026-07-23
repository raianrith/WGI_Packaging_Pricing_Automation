import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type { PackageBuilderPackageType, PackageBuilderSlotTemplate, SolutionTier, SolutionTierTaxonomyOptionRow } from "../types";
import {
  defaultPackageBuilderSlots,
  defaultPackageBuilderTypes,
  emptySlotRiskPresets,
  fetchPackageBuilderCatalog,
  isPersistedPackageBuilderId,
  isPersistedPackageBuilderTypeId,
  newLocalPackageBuilderSlotId,
  newLocalPackageBuilderTypeId,
  copySlotLimitSettings,
  slotLimitSummary,
  slotNarrativePayload,
  slotRiskPresetPayload,
  slotsForPackageType,
  normalizePackageTypeTags,
} from "../lib/packageBuilderSlots";
import {
  detailsFormPatchToSlot,
  emptySlotNarrativeFields,
  copySlotNarrativeSettings,
  slotToDetailsFormValues,
} from "../lib/packageSlotNarrative";
import { PackageDetailsFormBlock } from "./PackageDetailsFormBlock";
import { PackageTypeTaxonomyTagsEditor } from "./PackageTypeTaxonomyTagsEditor";
import { tierTaxonomyOptionsFromRows } from "../lib/tierTaxonomy";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { getSupabase } from "../lib/supabase";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";
import {
  CLIENT_REVISION_RISK_SCORE_HINTS,
  INTERNAL_COORDINATION_SCORE_HINTS,
  SCOPE_RISK_SCORE_HINTS,
  clampScore012,
  riskScore012Options,
  riskScore012SelectTitle,
  strategicValueScoreSelectTitle,
  strategicValueScoreUiLabel,
} from "../lib/tierPricingMath";

const SCOPE_OPTIONS = riskScore012Options(SCOPE_RISK_SCORE_HINTS);
const INTERNAL_OPTIONS = riskScore012Options(INTERNAL_COORDINATION_SCORE_HINTS);
const CLIENT_OPTIONS = riskScore012Options(CLIENT_REVISION_RISK_SCORE_HINTS);
const STRATEGIC_OPTIONS = ([0, 1, 2] as const).map((s) => ({
  value: String(s),
  label: strategicValueScoreUiLabel(s),
}));

type VaultTierRow = { solution_tier_id: string; label: string };

type Props = {
  muted: CSSProperties;
  input: CSSProperties;
  btnPrimary: CSSProperties;
  btnSm: CSSProperties;
  btnDangerSm: CSSProperties;
  tbl: CSSProperties;
  th: CSSProperties;
  td: CSSProperties;
  formGrid: CSSProperties;
  textarea: CSSProperties;
  setOpErr: (s: string | null) => void;
  setOpOk: (s: string | null) => void;
  onSaved: () => Promise<void>;
};

function parseOptionalCeiling(raw: number | null): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  return raw < 0 ? 0 : raw;
}

function parseOptionalTierLimit(raw: number | null): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const n = Math.floor(raw);
  if (n <= 0) return null;
  return n;
}

export function PackageBuilderSlotLimitsPanel({
  muted,
  input,
  btnPrimary,
  btnSm,
  btnDangerSm,
  tbl: _tbl,
  th: _th,
  td: _td,
  formGrid,
  textarea,
  setOpErr,
  setOpOk,
  onSaved,
}: Props) {
  const [types, setTypes] = useState<PackageBuilderPackageType[]>(() =>
    defaultPackageBuilderTypes().map((t) => ({ ...t }))
  );
  const [slots, setSlots] = useState<PackageBuilderSlotTemplate[]>(() => {
    const t = defaultPackageBuilderTypes()[0]!;
    return defaultPackageBuilderSlots(t.id).map((s) => ({ ...s }));
  });
  const [selectedTypeId, setSelectedTypeId] = useState<string | null>(null);
  const [vaultTiers, setVaultTiers] = useState<VaultTierRow[]>([]);
  const [expandedSlotId, setExpandedSlotId] = useState<string | null>(null);
  const [expandedDetailsSlotId, setExpandedDetailsSlotId] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState("");
  const [taxonomyOptions, setTaxonomyOptions] = useState(tierTaxonomyOptionsFromRows([]));
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastPersistedTypeIdsRef = useRef<string[]>([]);
  const lastPersistedSlotIdsRef = useRef<string[]>([]);

  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client) return;
    const [catalogPack, tiersRes, taxRes] = await Promise.all([
      fetchPackageBuilderCatalog(client),
      client
        .from("solution_tiers")
        .select("solution_tier_id,solution_tier_name,solution_id")
        .order("solution_tier_id", { ascending: true }),
      client.from("solution_tier_taxonomy_options").select("id,kind,label").order("kind").order("label"),
    ]);
    setTypes(catalogPack.catalog.types.map((t) => ({ ...t })));
    setSlots(catalogPack.catalog.slots.map((s) => ({ ...s })));
    setLoadNote(catalogPack.error);
    if (!taxRes.error && taxRes.data) {
      setTaxonomyOptions(
        tierTaxonomyOptionsFromRows(taxRes.data as SolutionTierTaxonomyOptionRow[])
      );
    }
    lastPersistedTypeIdsRef.current = catalogPack.catalog.types
      .filter((t) => isPersistedPackageBuilderTypeId(t.id))
      .map((t) => t.id);
    lastPersistedSlotIdsRef.current = catalogPack.catalog.slots
      .filter((s) => isPersistedPackageBuilderId(s.id))
      .map((s) => s.id);

    const solRes = await client.from("solutions").select("solution_id,solution_name");
    const solName = new Map(
      (solRes.data ?? []).map((s: { solution_id: string; solution_name: string }) => [
        s.solution_id,
        s.solution_name,
      ])
    );
    const rows: VaultTierRow[] = ((tiersRes.data ?? []) as SolutionTier[]).map((t) => ({
      solution_tier_id: t.solution_tier_id,
      label: `${solName.get(t.solution_id) ?? t.solution_id} · ${t.solution_tier_name}`,
    }));
    setVaultTiers(rows);

    const firstType = catalogPack.catalog.types[0]?.id ?? null;
    setSelectedTypeId((prev) =>
      prev && catalogPack.catalog.types.some((t) => t.id === prev) ? prev : firstType
    );
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sortedTypes = useMemo(
    () => [...types].sort((a, b) => a.sort_order - b.sort_order),
    [types]
  );

  const typeSlots = useMemo(() => {
    if (!selectedTypeId) return [];
    return slotsForPackageType(slots, selectedTypeId);
  }, [slots, selectedTypeId]);

  const selectedType = useMemo(
    () => types.find((t) => t.id === selectedTypeId) ?? null,
    [types, selectedTypeId]
  );

  const catalogByType = useMemo(() => {
    return sortedTypes.map((t) => ({
      type: t,
      tiers: slotsForPackageType(slots, t.id),
    }));
  }, [sortedTypes, slots]);

  const totalTierCount = useMemo(
    () => catalogByType.reduce((n, row) => n + row.tiers.length, 0),
    [catalogByType]
  );

  const filteredVaultTiers = useMemo(() => {
    const q = tierFilter.trim().toLowerCase();
    if (!q) return vaultTiers;
    return vaultTiers.filter(
      (t) =>
        t.label.toLowerCase().includes(q) || t.solution_tier_id.toLowerCase().includes(q)
    );
  }, [vaultTiers, tierFilter]);

  const packageFormStyles = useMemo(
    () => ({
      lbl: {
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
        fontSize: "0.78rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: "var(--muted)",
      } as CSSProperties,
      input,
      textarea,
      formGrid: { ...formGrid, gridTemplateColumns: "1fr" },
    }),
    [input, textarea, formGrid]
  );

  const setType = (id: string, patch: Partial<PackageBuilderPackageType>) => {
    setTypes((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const setSlot = (id: string, patch: Partial<PackageBuilderSlotTemplate>) => {
    setSlots((prev) => prev.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  };

  const toggleAllowedTier = (slotId: string, tierId: string, on: boolean) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        const cur = new Set(s.allowed_solution_tier_ids);
        if (on) cur.add(tierId);
        else cur.delete(tierId);
        return { ...s, allowed_solution_tier_ids: [...cur].sort() };
      })
    );
  };

  const addPackageType = () => {
    setTypes((prev) => {
      const maxOrder = prev.reduce((m, t) => Math.max(m, t.sort_order), 0);
      const id = newLocalPackageBuilderTypeId();
      const next = [
        ...prev,
        { id, sort_order: maxOrder + 1, name: "New template", card_description: null, phase_tags: [], category_tags: [], tactic_tags: [], updated_at: null },
      ];
      setSelectedTypeId(id);
      setSlots((sPrev) => [
        ...sPrev,
        {
          id: newLocalPackageBuilderSlotId(),
          package_type_id: id,
          sort_order: 1,
          label: "Basic",
          hour_ceiling: null,
          price_ceiling: null,
          solution_tier_limit: null,
          allowed_solution_tier_ids: [],
          tier_notes: null,
          ...emptySlotRiskPresets(),
          ...emptySlotNarrativeFields(),
          updated_at: null,
        },
      ]);
      return next;
    });
  };

  const removePackageType = (id: string) => {
    if (types.length <= 1) return;
    if (
      !globalThis.confirm(
        "Remove this template and all of its tier slots? Agency users will no longer see it."
      )
    ) {
      return;
    }
    setTypes((prev) => {
      const next = prev.filter((t) => t.id !== id).map((t, i) => ({ ...t, sort_order: i + 1 }));
      return next;
    });
    setSlots((prev) => prev.filter((s) => s.package_type_id !== id));
    setSelectedTypeId((prev) => (prev === id ? null : prev));
  };

  const addSlot = () => {
    if (!selectedTypeId) return;
    setSlots((prev) => {
      const inType = prev.filter((s) => s.package_type_id === selectedTypeId);
      const maxOrder = inType.reduce((m, s) => Math.max(m, s.sort_order), 0);
      return [
        ...prev,
        {
          id: newLocalPackageBuilderSlotId(),
          package_type_id: selectedTypeId,
          sort_order: maxOrder + 1,
          label: "New tier",
          hour_ceiling: null,
          price_ceiling: null,
          solution_tier_limit: null,
          allowed_solution_tier_ids: [],
          tier_notes: null,
          ...emptySlotRiskPresets(),
          ...emptySlotNarrativeFields(),
          updated_at: null,
        },
      ];
    });
  };

  const copySettingsFromTier = (targetId: string, sourceId: string) => {
    if (!sourceId || targetId === sourceId) return;
    const source = slots.find((s) => s.id === sourceId);
    if (!source) return;
    setSlot(targetId, copySlotLimitSettings(source));
  };

  const copyDetailsFromTier = (targetId: string, sourceId: string) => {
    if (!sourceId || targetId === sourceId) return;
    const source = slots.find((s) => s.id === sourceId);
    if (!source) return;
    setSlot(targetId, copySlotNarrativeSettings(source));
  };

  const duplicateSlot = (sourceId: string) => {
    if (!selectedTypeId) return;
    const source = slots.find((s) => s.id === sourceId);
    if (!source) return;
    setSlots((prev) => {
      const inType = prev.filter((s) => s.package_type_id === selectedTypeId);
      const maxOrder = inType.reduce((m, s) => Math.max(m, s.sort_order), 0);
      const baseLabel = source.label.trim() || "Tier";
      const copyLabel = inType.some((s) => s.label === `${baseLabel} (copy)`)
        ? `${baseLabel} (copy ${maxOrder + 1})`
        : `${baseLabel} (copy)`;
      return [
        ...prev,
        {
          ...source,
          id: newLocalPackageBuilderSlotId(),
          package_type_id: selectedTypeId,
          sort_order: maxOrder + 1,
          label: copyLabel,
          ...copySlotLimitSettings(source),
          updated_at: null,
        },
      ];
    });
  };

  const removeSlot = (id: string) => {
    if (!selectedTypeId) return;
    const count = slots.filter((s) => s.package_type_id === selectedTypeId).length;
    if (count <= 1) return;
    if (!globalThis.confirm("Remove this package tier slot?")) return;
    setSlots((prev) => {
      const next = prev.filter((s) => s.id !== id);
      const byType = new Map<string, PackageBuilderSlotTemplate[]>();
      for (const s of next) {
        const list = byType.get(s.package_type_id) ?? [];
        list.push(s);
        byType.set(s.package_type_id, list);
      }
      const out: PackageBuilderSlotTemplate[] = [];
      for (const [, list] of byType) {
        list.sort((a, b) => a.sort_order - b.sort_order);
        list.forEach((s, i) => out.push({ ...s, sort_order: i + 1 }));
      }
      return out;
    });
    if (expandedSlotId === id) setExpandedSlotId(null);
  };

  const save = async () => {
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    setBusy(true);
    const nowIso = new Date().toISOString();
    const BUMP_BASE = 10_000_000;

    try {
      const orderedTypes = [...types]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((t, i) => ({
          ...t,
          sort_order: i + 1,
          name: t.name.trim() || `Template ${i + 1}`,
          phase_tags: normalizePackageTypeTags(t.phase_tags),
          category_tags: normalizePackageTypeTags(t.category_tags),
          tactic_tags: normalizePackageTypeTags(t.tactic_tags),
        }));

      const typeIdMap = new Map<string, string>();

      const orderedTypeIds = new Set(orderedTypes.map((t) => t.id));
      for (const prevId of lastPersistedTypeIdsRef.current) {
        if (!isPersistedPackageBuilderTypeId(prevId)) continue;
        if (orderedTypeIds.has(prevId)) continue;
        const { error: delErr } = await client.from("package_builder_package_types").delete().eq("id", prevId);
        if (delErr) {
          setOpErr(friendlyMutationMessage(delErr.message));
          return;
        }
      }

      let typeBump = 0;
      for (const t of orderedTypes.filter((x) => isPersistedPackageBuilderTypeId(x.id))) {
        typeBump += 1;
        const { error } = await client
          .from("package_builder_package_types")
          .update({ sort_order: BUMP_BASE + typeBump })
          .eq("id", t.id);
        if (error) {
          setOpErr(friendlyMutationMessage(error.message));
          return;
        }
      }

      for (const t of orderedTypes) {
        if (isPersistedPackageBuilderTypeId(t.id)) {
          const { error } = await client
            .from("package_builder_package_types")
            .update({
              sort_order: t.sort_order,
              name: t.name,
              card_description: t.card_description?.trim() ? t.card_description.trim() : null,
              phase_tags: t.phase_tags,
              category_tags: t.category_tags,
              tactic_tags: t.tactic_tags,
              updated_at: nowIso,
            })
            .eq("id", t.id);
          if (error) {
            setOpErr(friendlyMutationMessage(error.message));
            return;
          }
          typeIdMap.set(t.id, t.id);
        }
      }

      for (const t of orderedTypes) {
        if (isPersistedPackageBuilderTypeId(t.id)) continue;
        const { data, error } = await client
          .from("package_builder_package_types")
          .insert({
            sort_order: t.sort_order,
            name: t.name,
            card_description: t.card_description?.trim() ? t.card_description.trim() : null,
            phase_tags: t.phase_tags,
            category_tags: t.category_tags,
            tactic_tags: t.tactic_tags,
          })
          .select("id")
          .single();
        if (error || !data) {
          setOpErr(friendlyMutationMessage(error?.message ?? "Could not create template."));
          return;
        }
        typeIdMap.set(t.id, String((data as { id: string }).id));
      }

      const normalizedSlots = slots.map((s) => {
        const mappedTypeId = typeIdMap.get(s.package_type_id) ?? s.package_type_id;
        return {
          ...s,
          package_type_id: mappedTypeId,
          label: s.label.trim() || "Tier",
          hour_ceiling: parseOptionalCeiling(s.hour_ceiling),
          price_ceiling: parseOptionalCeiling(s.price_ceiling),
          solution_tier_limit: parseOptionalTierLimit(s.solution_tier_limit),
          ...slotNarrativePayload(s),
        };
      });

      const slotsByType = new Map<string, PackageBuilderSlotTemplate[]>();
      for (const s of normalizedSlots) {
        const list = slotsByType.get(s.package_type_id) ?? [];
        list.push(s);
        slotsByType.set(s.package_type_id, list);
      }
      const orderedSlots: PackageBuilderSlotTemplate[] = [];
      for (const t of orderedTypes) {
        const tid = typeIdMap.get(t.id) ?? t.id;
        const list = (slotsByType.get(tid) ?? slotsByType.get(t.id) ?? [])
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((s, i) => ({ ...s, package_type_id: tid, sort_order: i + 1 }));
        orderedSlots.push(...list);
      }

      const orderedSlotIds = new Set(orderedSlots.map((s) => s.id));
      for (const prevId of lastPersistedSlotIdsRef.current) {
        if (!isPersistedPackageBuilderId(prevId)) continue;
        if (orderedSlotIds.has(prevId)) continue;
        await client.from("package_builder_slot_allowed_tiers").delete().eq("slot_id", prevId);
        const { error: delErr } = await client.from("package_builder_slot_templates").delete().eq("id", prevId);
        if (delErr) {
          setOpErr(friendlyMutationMessage(delErr.message));
          return;
        }
      }

      let slotBump = 0;
      for (const s of orderedSlots.filter((x) => isPersistedPackageBuilderId(x.id))) {
        slotBump += 1;
        const { error } = await client
          .from("package_builder_slot_templates")
          .update({ sort_order: BUMP_BASE + slotBump })
          .eq("id", s.id);
        if (error) {
          setOpErr(friendlyMutationMessage(error.message));
          return;
        }
      }

      const slotIdMap = new Map<string, string>();

      for (const s of orderedSlots) {
        const narrative = slotNarrativePayload(s);
        const payload = {
          package_type_id: s.package_type_id,
          sort_order: s.sort_order,
          label: s.label,
          hour_ceiling: s.hour_ceiling,
          price_ceiling: s.price_ceiling,
          solution_tier_limit: s.solution_tier_limit,
          ...slotRiskPresetPayload(s),
          ...narrative,
          updated_at: nowIso,
        };
        if (isPersistedPackageBuilderId(s.id)) {
          const { error } = await client.from("package_builder_slot_templates").update(payload).eq("id", s.id);
          if (error) {
            setOpErr(friendlyMutationMessage(error.message));
            return;
          }
          slotIdMap.set(s.id, s.id);
        }
      }

      for (const s of orderedSlots) {
        if (isPersistedPackageBuilderId(s.id)) continue;
        const { data, error } = await client
          .from("package_builder_slot_templates")
          .insert({
            package_type_id: s.package_type_id,
            sort_order: s.sort_order,
            label: s.label,
            hour_ceiling: s.hour_ceiling,
            price_ceiling: s.price_ceiling,
            solution_tier_limit: s.solution_tier_limit,
            ...slotRiskPresetPayload(s),
            ...slotNarrativePayload(s),
          })
          .select("id")
          .single();
        if (error || !data) {
          setOpErr(friendlyMutationMessage(error?.message ?? "Could not create slot."));
          return;
        }
        slotIdMap.set(s.id, String((data as { id: string }).id));
      }

      for (const s of orderedSlots) {
        const persistedSlotId = slotIdMap.get(s.id) ?? s.id;
        if (!isPersistedPackageBuilderId(persistedSlotId)) continue;
        await client.from("package_builder_slot_allowed_tiers").delete().eq("slot_id", persistedSlotId);
        if (s.allowed_solution_tier_ids.length > 0) {
          const rows = s.allowed_solution_tier_ids.map((solution_tier_id) => ({
            slot_id: persistedSlotId,
            solution_tier_id,
          }));
          const { error: insAllowErr } = await client.from("package_builder_slot_allowed_tiers").insert(rows);
          if (insAllowErr) {
            setOpErr(friendlyMutationMessage(insAllowErr.message));
            return;
          }
        }
      }

      setOpOk("Templates and tier slots saved.");
      notifyPackagingDataChanged();
      await load();
      await onSaved();
    } finally {
      setBusy(false);
    }
  };


  const selectedTypeName =
    types.find((t) => t.id === selectedTypeId)?.name?.trim() || "Template";

  return (
    <div className="admin-pkg-builder">
      <header className="admin-pkg-builder__hero">
        <h2 className="admin-pkg-builder__title">Configurable Package</h2>
        <p className="admin-pkg-builder__lead" style={muted}>
          Templates group your configurable packages. Each template has tiers with optional hour, price, and solution component limits.
          Leave limits blank for no cap; leave the component allow-list empty to permit any solution.
        </p>
        <div className="admin-pkg-builder__stats" aria-label="Configuration summary">
          <span className="admin-pkg-builder__stat">
            {sortedTypes.length} template{sortedTypes.length === 1 ? "" : "s"}
          </span>
          <span className="admin-pkg-builder__stat">
            {totalTierCount} tier{totalTierCount === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      {loadNote ? (
        <p className="admin-pkg-builder__alert" role="status">
          Could not load full configuration ({loadNote}). Run{" "}
          <code>package_builder_types_and_slots_v2.sql</code>,{" "}
          <code>package_builder_slot_narrative_fields.sql</code>, and{" "}
          <code>package_builder_type_taxonomy_tags.sql</code> in Supabase if tables or columns are
          missing.
        </p>
      ) : null}

      <div className="admin-pkg-builder__layout">
        <aside className="admin-pkg-builder__types" aria-label="Templates">
          <div className="admin-pkg-builder__panel-head">
            <h3 className="admin-pkg-builder__panel-title">Templates</h3>
            <button type="button" style={btnSm} disabled={busy} onClick={addPackageType}>
              Add template
            </button>
          </div>

          {sortedTypes.length === 0 ? (
            <p style={{ ...muted, fontSize: "0.86rem", margin: 0 }}>No types yet.</p>
          ) : (
            <ul className="admin-pkg-builder__type-list">
              {catalogByType.map(({ type: t, tiers }) => {
                const active = selectedTypeId === t.id;
                return (
                  <li
                    key={t.id}
                    className={
                      active
                        ? "admin-pkg-builder__type-item is-active"
                        : "admin-pkg-builder__type-item"
                    }
                  >
                    <div className="admin-pkg-builder__type-card-wrap">
                      <button
                        type="button"
                        className="admin-pkg-builder__type-card"
                        disabled={busy}
                        onClick={() => setSelectedTypeId(t.id)}
                      >
                        <span className="admin-pkg-builder__type-order">{t.sort_order}</span>
                        <span className="admin-pkg-builder__type-body">
                          <input
                            className="admin-pkg-builder__type-name"
                            style={input}
                            value={t.name}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setType(t.id, { name: e.target.value })}
                            onFocus={() => setSelectedTypeId(t.id)}
                            aria-label={`Template ${t.sort_order} name`}
                          />
                          <span className="admin-pkg-builder__type-meta-row">
                            <span className="admin-pkg-builder__type-meta">
                              {tiers.length} tier{tiers.length === 1 ? "" : "s"}
                            </span>
                            {(() => {
                              const tagCount =
                                t.phase_tags.length + t.category_tags.length + t.tactic_tags.length;
                              return tagCount > 0 ? (
                                <span className="admin-pkg-builder__type-tag-count">
                                  {tagCount} tag{tagCount === 1 ? "" : "s"}
                                </span>
                              ) : null;
                            })()}
                          </span>
                          {tiers.length > 0 ? (
                            <span className="admin-pkg-builder__tier-pills">
                              {tiers.map((s) => (
                                <span
                                  key={s.id}
                                  className="admin-pkg-builder__tier-pill"
                                  title={slotLimitSummary(s)}
                                >
                                  {s.label.trim() || "Tier"}
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="admin-pkg-builder__type-remove"
                        disabled={busy || types.length <= 1}
                        onClick={() => removePackageType(t.id)}
                        aria-label={`Remove ${t.name}`}
                      >
                        Remove
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <main className="admin-pkg-builder__main" aria-label="Package tiers">
          {!selectedTypeId ? (
            <p className="admin-pkg-builder__empty" style={muted}>
              Select a template to configure its tiers.
            </p>
          ) : (
            <>
              <div className="admin-pkg-builder__main-head">
                <div>
                  <h3 className="admin-pkg-builder__main-title">{selectedTypeName}</h3>
                  <p className="admin-pkg-builder__main-hint" style={muted}>
                    Configure limits and content for each package tier in this family.
                  </p>
                </div>
                <div className="admin-pkg-builder__main-actions">
                  <button
                    type="button"
                    className="admin-btn-primary admin-pkg-builder__save-btn"
                    style={btnPrimary}
                    disabled={busy}
                    onClick={() => void save()}
                  >
                    {busy ? "Saving…" : "Save configuration"}
                  </button>
                  <button
                    type="button"
                    className="admin-pkg-builder__add-tier-btn"
                    style={btnSm}
                    disabled={busy}
                    onClick={addSlot}
                  >
                    Add tier
                  </button>
                </div>
              </div>

              {selectedType ? (
                <PackageTypeTaxonomyTagsEditor
                  phaseTags={selectedType.phase_tags}
                  categoryTags={selectedType.category_tags}
                  tacticTags={selectedType.tactic_tags}
                  options={taxonomyOptions}
                  disabled={busy}
                  onChange={(patch) => setType(selectedType.id, patch)}
                />
              ) : null}

              {selectedType ? (
                <label className="admin-pkg-builder__card-desc">
                  <span className="admin-pkg-builder__field-caption">Package Card Description</span>
                  <textarea
                    style={textarea}
                    rows={3}
                    disabled={busy}
                    value={selectedType.card_description ?? ""}
                    placeholder="Short blurb shown on this package’s card in Custom Package Builder"
                    onChange={(e) =>
                      setType(selectedType.id, {
                        card_description: e.target.value.length > 0 ? e.target.value : null,
                      })
                    }
                  />
                </label>
              ) : null}

              <section className="admin-pkg-builder__section">
                <div className="admin-pkg-builder__section-head">
                  <h4 className="admin-pkg-builder__section-title">Package tiers</h4>
                  <p className="admin-pkg-builder__section-lead" style={muted}>
                    Hour, price, and solution component limits apply when agency users build from this template.
                  </p>
                </div>
                <div className="admin-pkg-builder__tier-list">
                {typeSlots.map((r) => {
                  const vaultOpen = expandedSlotId === r.id;
                  const detailsOpen = expandedDetailsSlotId === r.id;
                  const hasNarrative = Object.values(slotToDetailsFormValues(r)).some((v) => v.trim());
                  const vaultLabel =
                    r.allowed_solution_tier_ids.length === 0
                      ? "Any solution component"
                      : `${r.allowed_solution_tier_ids.length} solution component${
                          r.allowed_solution_tier_ids.length === 1 ? "" : "s"
                        }`;
                  return (
                    <article key={r.id} className="admin-pkg-builder__tier-card">
                      <div className="admin-pkg-builder__tier-head">
                        <span className="admin-pkg-builder__tier-order">{r.sort_order}</span>
                        <div className="admin-pkg-builder__tier-label-wrap">
                          <input
                            className="admin-pkg-builder__tier-label"
                            style={input}
                            value={r.label}
                            onChange={(e) => setSlot(r.id, { label: e.target.value })}
                            aria-label={`Tier ${r.sort_order} label`}
                          />
                        </div>
                        <div className="admin-pkg-builder__tier-toolbar">
                          <select
                            className="admin-pkg-builder__copy-select"
                            style={input}
                            defaultValue=""
                            disabled={busy || typeSlots.length <= 1}
                            aria-label={`Copy settings into ${r.label}`}
                            onChange={(e) => {
                              const sourceId = e.target.value;
                              if (sourceId) copySettingsFromTier(r.id, sourceId);
                              e.target.value = "";
                            }}
                          >
                            <option value="">Copy from…</option>
                            {typeSlots
                              .filter((s) => s.id !== r.id)
                              .map((s) => (
                                <option key={s.id} value={s.id}>
                                  {s.label.trim() || `Tier ${s.sort_order}`}
                                </option>
                              ))}
                          </select>
                          <button
                            type="button"
                            style={btnSm}
                            disabled={busy}
                            title="Duplicate tier with same limits and allow-list"
                            onClick={() => duplicateSlot(r.id)}
                          >
                            Duplicate
                          </button>
                          <button
                            type="button"
                            style={btnDangerSm}
                            disabled={busy || typeSlots.length <= 1}
                            onClick={() => removeSlot(r.id)}
                          >
                            Remove
                          </button>
                        </div>
                      </div>

                      <div className="admin-pkg-builder__tier-body">
                        <div className="admin-pkg-builder__limits-panel">
                          <p className="admin-pkg-builder__limits-label">Tier limits</p>
                          <div className="admin-pkg-builder__limits">
                          <label className="admin-pkg-builder__field">
                            <span className="admin-pkg-builder__field-caption">Hour ceiling</span>
                            <input
                              style={input}
                              type="number"
                              min={0}
                              step={1}
                              placeholder="No limit"
                              value={r.hour_ceiling ?? ""}
                              onChange={(e) =>
                                setSlot(r.id, {
                                  hour_ceiling: e.target.value === "" ? null : Number(e.target.value),
                                })
                              }
                              aria-label={`Tier ${r.sort_order} hour ceiling`}
                            />
                          </label>
                          <label className="admin-pkg-builder__field">
                            <span className="admin-pkg-builder__field-caption">Price ceiling (USD)</span>
                            <input
                              style={input}
                              type="number"
                              min={0}
                              step={1000}
                              placeholder="No limit"
                              value={r.price_ceiling ?? ""}
                              onChange={(e) =>
                                setSlot(r.id, {
                                  price_ceiling: e.target.value === "" ? null : Number(e.target.value),
                                })
                              }
                              aria-label={`Tier ${r.sort_order} price ceiling`}
                            />
                          </label>
                          <label className="admin-pkg-builder__field">
                            <span className="admin-pkg-builder__field-caption">Solution component limit</span>
                            <input
                              style={input}
                              type="number"
                              min={1}
                              step={1}
                              placeholder="No limit"
                              value={r.solution_tier_limit ?? ""}
                              onChange={(e) =>
                                setSlot(r.id, {
                                  solution_tier_limit:
                                    e.target.value === "" ? null : Number(e.target.value),
                                })
                              }
                              aria-label={`Tier ${r.sort_order} solution tier limit`}
                            />
                          </label>
                        </div>
                        </div>

                        <div className="admin-pkg-builder__limits-panel">
                          <p className="admin-pkg-builder__limits-label">Preset risk &amp; strategic scores</p>
                          <p className="admin-pkg-builder__limits-hint">
                            Applied at package level when someone finishes building from this tier.
                          </p>
                          <div className="admin-pkg-builder__limits admin-pkg-builder__limits--scores">
                            <label className="admin-pkg-builder__field">
                              <span className="admin-pkg-builder__field-caption">Scope risk</span>
                              <select
                                className="admin-pkg-builder__score-select"
                                style={input}
                                title={riskScore012SelectTitle(SCOPE_RISK_SCORE_HINTS)}
                                value={String(clampScore012(r.scope_risk))}
                                onChange={(e) =>
                                  setSlot(r.id, { scope_risk: clampScore012(Number(e.target.value)) })
                                }
                                aria-label={`Tier ${r.sort_order} scope risk`}
                              >
                                {SCOPE_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="admin-pkg-builder__field">
                              <span className="admin-pkg-builder__field-caption">Internal coordination</span>
                              <select
                                className="admin-pkg-builder__score-select"
                                style={input}
                                title={riskScore012SelectTitle(INTERNAL_COORDINATION_SCORE_HINTS)}
                                value={String(clampScore012(r.internal_coordination))}
                                onChange={(e) =>
                                  setSlot(r.id, {
                                    internal_coordination: clampScore012(Number(e.target.value)),
                                  })
                                }
                                aria-label={`Tier ${r.sort_order} internal coordination`}
                              >
                                {INTERNAL_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="admin-pkg-builder__field">
                              <span className="admin-pkg-builder__field-caption">Client revision risk</span>
                              <select
                                className="admin-pkg-builder__score-select"
                                style={input}
                                title={riskScore012SelectTitle(CLIENT_REVISION_RISK_SCORE_HINTS)}
                                value={String(clampScore012(r.client_revision_risk))}
                                onChange={(e) =>
                                  setSlot(r.id, {
                                    client_revision_risk: clampScore012(Number(e.target.value)),
                                  })
                                }
                                aria-label={`Tier ${r.sort_order} client revision risk`}
                              >
                                {CLIENT_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="admin-pkg-builder__field">
                              <span className="admin-pkg-builder__field-caption">Strategic value</span>
                              <select
                                className="admin-pkg-builder__score-select"
                                style={input}
                                title={strategicValueScoreSelectTitle()}
                                value={String(clampScore012(r.strategic_value_score))}
                                onChange={(e) =>
                                  setSlot(r.id, {
                                    strategic_value_score: clampScore012(Number(e.target.value)),
                                  })
                                }
                                aria-label={`Tier ${r.sort_order} strategic value`}
                              >
                                {STRATEGIC_OPTIONS.map((o) => (
                                  <option key={o.value} value={o.value}>
                                    {o.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                          </div>
                        </div>

                        <label className="admin-pkg-builder__field admin-pkg-builder__field--full">
                          <span className="admin-pkg-builder__field-caption">
                            Tier disclaimer note
                          </span>
                          <textarea
                            className="admin-pkg-builder__notes-input"
                            style={input}
                            rows={3}
                            value={r.tier_notes ?? ""}
                            onChange={(e) =>
                              setSlot(r.id, {
                                tier_notes: e.target.value.length > 0 ? e.target.value : null,
                              })
                            }
                            placeholder="Shown when users select this package tier in Build a Package (optional)."
                            aria-label={`Tier ${r.sort_order} disclaimer note`}
                          />
                        </label>

                        <div className="admin-pkg-builder__vault-row">
                          <span className="admin-pkg-builder__vault-label">Package content</span>
                          <button
                            type="button"
                            className={
                              detailsOpen
                                ? "admin-pkg-builder__vault-badge admin-pkg-builder__vault-badge--open"
                                : "admin-pkg-builder__vault-badge"
                            }
                            style={btnSm}
                            onClick={() =>
                              setExpandedDetailsSlotId((prev) => (prev === r.id ? null : r.id))
                            }
                          >
                            {detailsOpen ? "Hide details" : hasNarrative ? "Edit details" : "Add details"}
                          </button>
                        </div>

                        {detailsOpen ? (
                          <div className="admin-pkg-builder__details-panel">
                            <div className="admin-pkg-builder__details-head">
                              <p className="admin-pkg-builder__vault-panel-hint" style={muted}>
                                Overview, scope, process, and resources copied to packages built from this
                                tier. Package category is set from the template name.
                              </p>
                              <select
                                className="admin-pkg-builder__copy-select admin-pkg-builder__copy-select--details"
                                style={input}
                                defaultValue=""
                                disabled={busy || typeSlots.length <= 1}
                                aria-label={`Copy package details into ${r.label}`}
                                onChange={(e) => {
                                  const sourceId = e.target.value;
                                  if (sourceId) copyDetailsFromTier(r.id, sourceId);
                                  e.target.value = "";
                                }}
                              >
                                <option value="">Copy details from…</option>
                                {typeSlots
                                  .filter((s) => s.id !== r.id)
                                  .map((s) => (
                                    <option key={s.id} value={s.id}>
                                      {s.label.trim() || `Tier ${s.sort_order}`}
                                    </option>
                                  ))}
                              </select>
                            </div>
                            <PackageDetailsFormBlock
                              hideCategory
                              values={slotToDetailsFormValues(r)}
                              onChange={(key, value) =>
                                setSlot(r.id, detailsFormPatchToSlot(key, value))
                              }
                              styles={packageFormStyles}
                            />
                          </div>
                        ) : null}

                        <div className="admin-pkg-builder__vault-row">
                          <span className="admin-pkg-builder__vault-label">Allowed solution components</span>
                          <button
                            type="button"
                            className={
                              vaultOpen
                                ? "admin-pkg-builder__vault-badge admin-pkg-builder__vault-badge--open"
                                : "admin-pkg-builder__vault-badge"
                            }
                            style={btnSm}
                            onClick={() => setExpandedSlotId((prev) => (prev === r.id ? null : r.id))}
                          >
                            {vaultLabel}
                          </button>
                        </div>

                        {vaultOpen ? (
                          <div className="admin-pkg-builder__vault-panel">
                            <p className="admin-pkg-builder__vault-panel-hint" style={muted}>
                              Leave all unchecked to allow any solution component from the directory.
                            </p>
                            <input
                              className="admin-pkg-builder__vault-search"
                              style={input}
                              type="search"
                              placeholder="Filter solution components…"
                              value={tierFilter}
                              onChange={(e) => setTierFilter(e.target.value)}
                            />
                            <div className="admin-pkg-builder__vault-grid">
                              {filteredVaultTiers.map((vt) => {
                                const checked = r.allowed_solution_tier_ids.includes(
                                  vt.solution_tier_id
                                );
                                return (
                                  <label key={vt.solution_tier_id} className="admin-pkg-builder__vault-check">
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={(e) =>
                                        toggleAllowedTier(r.id, vt.solution_tier_id, e.target.checked)
                                      }
                                    />
                                    <span>{vt.label}</span>
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
                </div>
              </section>
            </>
          )}
        </main>
      </div>

      <footer className="admin-pkg-builder__footer admin-actions-row">
        <button
          type="button"
          className="admin-btn-primary"
          style={btnPrimary}
          disabled={busy}
          onClick={() => void save()}
        >
          {busy ? "Saving…" : "Save configuration"}
        </button>
        <button type="button" style={btnSm} disabled={busy} onClick={() => void load()}>
          Reload
        </button>
      </footer>
    </div>
  );
}
