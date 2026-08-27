import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import type {
  PackageBuilderPackageType,
  PackageBuilderSlotBucket,
  PackageBuilderSlotTemplate,
  SolutionTier,
  SolutionTierTaxonomyOptionRow,
} from "../types";
import {
  emptySlotRiskPresets,
  fetchPackageBuilderCatalog,
  isPersistedPackageBuilderId,
  isPersistedPackageBuilderTypeId,
  newLocalPackageBuilderSlotId,
  newLocalPackageBuilderTypeId,
  copySlotLimitSettings,
  replaceSlotSelectionChildren,
  slotLimitSummary,
  slotNarrativePayload,
  slotRiskPresetPayload,
  slotsForPackageType,
  normalizePackageTypeTags,
  defaultPackageBuilderSlots,
  defaultPackageBuilderTypes,
} from "../lib/packageBuilderSlots";
import { suggestedHourDiscountPctForLabel } from "../lib/packageTierDiscounts";
import {
  emptySlotSelectionRules,
  newLocalBucketId,
  normalizePreselectedTiers,
  normalizeSlotBuckets,
  selectionRulesSummary,
} from "../lib/packageSlotSelectionRules";
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
type EditorTab = "limits" | "components" | "content" | "tags" | "discount";

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

function parseOptionalHourDiscountPct(raw: number | null): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  return Math.min(100, Math.max(0, Math.round(raw * 10) / 10));
}

function filterVaultTiers(tiers: VaultTierRow[], q: string): VaultTierRow[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return tiers;
  return tiers.filter(
    (t) =>
      t.label.toLowerCase().includes(needle) || t.solution_tier_id.toLowerCase().includes(needle)
  );
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
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);
  const [editorTab, setEditorTab] = useState<EditorTab>("limits");
  const [vaultTiers, setVaultTiers] = useState<VaultTierRow[]>([]);
  const [allowFilter, setAllowFilter] = useState("");
  const [preFilter, setPreFilter] = useState("");
  const [bucketMemberFilter, setBucketMemberFilter] = useState("");
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

  const selectedSlot = useMemo(
    () => typeSlots.find((s) => s.id === selectedSlotId) ?? null,
    [typeSlots, selectedSlotId]
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

  const vaultLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of vaultTiers) m.set(t.solution_tier_id, t.label);
    return m;
  }, [vaultTiers]);

  const allowedVaultTiers = useMemo(
    () => filterVaultTiers(vaultTiers, allowFilter),
    [vaultTiers, allowFilter]
  );

  const preselectAddCandidates = useMemo(() => {
    if (!selectedSlot) return [];
    const taken = new Set(selectedSlot.preselected_tiers.map((p) => p.solution_tier_id));
    return filterVaultTiers(
      vaultTiers.filter((t) => !taken.has(t.solution_tier_id)),
      preFilter
    );
  }, [vaultTiers, preFilter, selectedSlot]);

  const bucketMemberCandidates = useMemo(
    () => filterVaultTiers(vaultTiers, bucketMemberFilter),
    [vaultTiers, bucketMemberFilter]
  );

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

  useEffect(() => {
    if (!selectedTypeId) {
      setSelectedSlotId(null);
      return;
    }
    setSelectedSlotId((prev) => {
      if (prev && typeSlots.some((s) => s.id === prev)) return prev;
      return typeSlots[0]?.id ?? null;
    });
  }, [selectedTypeId, typeSlots]);

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

  const addPreselectedTier = (slotId: string, tierId: string) => {
    if (!tierId) return;
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        if (s.preselected_tiers.some((p) => p.solution_tier_id === tierId)) return s;
        return {
          ...s,
          preselected_tiers: [...s.preselected_tiers, { solution_tier_id: tierId, default_qty: 1 }],
        };
      })
    );
  };

  const updatePreselectedQty = (slotId: string, tierId: string, qty: number) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        return {
          ...s,
          preselected_tiers: s.preselected_tiers.map((p) =>
            p.solution_tier_id === tierId
              ? { ...p, default_qty: Math.max(1, Math.floor(qty) || 1) }
              : p
          ),
        };
      })
    );
  };

  const removePreselectedTier = (slotId: string, tierId: string) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        return {
          ...s,
          preselected_tiers: s.preselected_tiers.filter((p) => p.solution_tier_id !== tierId),
        };
      })
    );
  };

  const addBucket = (slotId: string) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        const maxOrder = s.buckets.reduce((m, b) => Math.max(m, b.sort_order), 0);
        const bucket: PackageBuilderSlotBucket = {
          id: newLocalBucketId(),
          name: "Choice group",
          pick_count: 1,
          sort_order: maxOrder + 1,
          member_tier_ids: [],
        };
        return { ...s, buckets: [...s.buckets, bucket] };
      })
    );
  };

  const updateBucket = (
    slotId: string,
    bucketId: string,
    patch: Partial<PackageBuilderSlotBucket>
  ) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        return {
          ...s,
          buckets: s.buckets.map((b) => (b.id === bucketId ? { ...b, ...patch } : b)),
        };
      })
    );
  };

  const removeBucket = (slotId: string, bucketId: string) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        const next = s.buckets
          .filter((b) => b.id !== bucketId)
          .sort((a, b) => a.sort_order - b.sort_order)
          .map((b, i) => ({ ...b, sort_order: i + 1 }));
        return { ...s, buckets: next };
      })
    );
  };

  const moveBucket = (slotId: string, bucketId: string, dir: -1 | 1) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        const ordered = [...s.buckets].sort((a, b) => a.sort_order - b.sort_order);
        const idx = ordered.findIndex((b) => b.id === bucketId);
        const swap = idx + dir;
        if (idx < 0 || swap < 0 || swap >= ordered.length) return s;
        const tmp = ordered[idx]!;
        ordered[idx] = ordered[swap]!;
        ordered[swap] = tmp;
        return {
          ...s,
          buckets: ordered.map((b, i) => ({ ...b, sort_order: i + 1 })),
        };
      })
    );
  };

  const toggleBucketMember = (slotId: string, bucketId: string, tierId: string, on: boolean) => {
    setSlots((prev) =>
      prev.map((s) => {
        if (s.id !== slotId) return s;
        return {
          ...s,
          buckets: s.buckets.map((b) => {
            if (b.id !== bucketId) return b;
            const cur = new Set(b.member_tier_ids);
            if (on) cur.add(tierId);
            else cur.delete(tierId);
            return { ...b, member_tier_ids: [...cur] };
          }),
        };
      })
    );
  };

  const addPackageType = () => {
    setTypes((prev) => {
      const maxOrder = prev.reduce((m, t) => Math.max(m, t.sort_order), 0);
      const id = newLocalPackageBuilderTypeId();
      const next = [
        ...prev,
        {
          id,
          sort_order: maxOrder + 1,
          name: "New template",
          card_description: null,
          phase_tags: [],
          category_tags: [],
          tactic_tags: [],
          updated_at: null,
        },
      ];
      setSelectedTypeId(id);
      const newSlotId = newLocalPackageBuilderSlotId();
      setSlots((sPrev) => [
        ...sPrev,
        {
          id: newSlotId,
          package_type_id: id,
          sort_order: 1,
          label: "Basic",
          hour_ceiling: null,
          price_ceiling: null,
          solution_tier_limit: null,
          hour_discount_pct: null,
          allowed_solution_tier_ids: [],
          tier_notes: null,
          ...emptySlotRiskPresets(),
          ...emptySlotNarrativeFields(),
          ...emptySlotSelectionRules(),
          updated_at: null,
        },
      ]);
      setSelectedSlotId(newSlotId);
      setEditorTab("limits");
      return next;
    });
  };

  const removePackageType = (id: string) => {
    if (types.length <= 1) return;
    if (
      !globalThis.confirm(
        "Remove this template and all of its solution slots? Agency users will no longer see it."
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
    const newId = newLocalPackageBuilderSlotId();
    setSlots((prev) => {
      const inType = prev.filter((s) => s.package_type_id === selectedTypeId);
      const maxOrder = inType.reduce((m, s) => Math.max(m, s.sort_order), 0);
      return [
        ...prev,
        {
          id: newId,
          package_type_id: selectedTypeId,
          sort_order: maxOrder + 1,
          label: "New solution",
          hour_ceiling: null,
          price_ceiling: null,
          solution_tier_limit: null,
          hour_discount_pct: null,
          allowed_solution_tier_ids: [],
          tier_notes: null,
          ...emptySlotRiskPresets(),
          ...emptySlotNarrativeFields(),
          ...emptySlotSelectionRules(),
          updated_at: null,
        },
      ];
    });
    setSelectedSlotId(newId);
    setEditorTab("limits");
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
    const newId = newLocalPackageBuilderSlotId();
    setSlots((prev) => {
      const inType = prev.filter((s) => s.package_type_id === selectedTypeId);
      const maxOrder = inType.reduce((m, s) => Math.max(m, s.sort_order), 0);
      const baseLabel = source.label.trim() || "Solution";
      const copyLabel = inType.some((s) => s.label === `${baseLabel} (copy)`)
        ? `${baseLabel} (copy ${maxOrder + 1})`
        : `${baseLabel} (copy)`;
      return [
        ...prev,
        {
          ...source,
          id: newId,
          package_type_id: selectedTypeId,
          sort_order: maxOrder + 1,
          label: copyLabel,
          ...copySlotLimitSettings(source),
          updated_at: null,
        },
      ];
    });
    setSelectedSlotId(newId);
    setEditorTab("limits");
  };

  const removeSlot = (id: string) => {
    if (!selectedTypeId) return;
    const count = slots.filter((s) => s.package_type_id === selectedTypeId).length;
    if (count <= 1) return;
    if (!globalThis.confirm("Remove this package solution slot?")) return;
    const remaining = typeSlots.filter((s) => s.id !== id);
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
    if (selectedSlotId === id) {
      setSelectedSlotId(remaining[0]?.id ?? null);
    }
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
          label: s.label.trim() || "Solution",
          hour_ceiling: parseOptionalCeiling(s.hour_ceiling),
          price_ceiling: parseOptionalCeiling(s.price_ceiling),
          solution_tier_limit: parseOptionalTierLimit(s.solution_tier_limit),
          hour_discount_pct: parseOptionalHourDiscountPct(s.hour_discount_pct),
          preselected_tiers: normalizePreselectedTiers(s.preselected_tiers),
          buckets: normalizeSlotBuckets(s.buckets),
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
          hour_discount_pct: s.hour_discount_pct,
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
            hour_discount_pct: s.hour_discount_pct,
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
        const childErr = await replaceSlotSelectionChildren(client, persistedSlotId, {
          allowed_solution_tier_ids: s.allowed_solution_tier_ids,
          preselected_tiers: normalizePreselectedTiers(s.preselected_tiers),
          buckets: normalizeSlotBuckets(s.buckets),
        });
        if (childErr) {
          setOpErr(friendlyMutationMessage(childErr));
          return;
        }
      }

      setOpOk("Templates and solution slots saved.");
      notifyPackagingDataChanged();
      await load();
      await onSaved();
    } finally {
      setBusy(false);
    }
  };

  const selectedTypeName =
    types.find((t) => t.id === selectedTypeId)?.name?.trim() || "Template";

  const layoutClass = selectedSlot
    ? "admin-pkg-builder__layout admin-pkg-builder__layout--tier-focus"
    : "admin-pkg-builder__layout";

  const sortedBuckets = selectedSlot
    ? [...selectedSlot.buckets].sort((a, b) => a.sort_order - b.sort_order)
    : [];

  return (
    <div className="admin-pkg-builder">
      <header className="admin-pkg-builder__hero">
        <h2 className="admin-pkg-builder__title">Configurable Package</h2>
        <p className="admin-pkg-builder__lead" style={muted}>
          Templates group your configurable packages. Select a template, then a solution, to set limits,
          always-included components, choice buckets, and package content. Leave the allow-list empty
          to permit any vault solution for additional picks.
        </p>
        <div className="admin-pkg-builder__stats" aria-label="Configuration summary">
          <span className="admin-pkg-builder__stat">
            {sortedTypes.length} template{sortedTypes.length === 1 ? "" : "s"}
          </span>
          <span className="admin-pkg-builder__stat">
            {totalTierCount} solution{totalTierCount === 1 ? "" : "s"}
          </span>
        </div>
      </header>

      {loadNote ? (
        <p className="admin-pkg-builder__alert" role="status">
          Could not load full configuration ({loadNote}). Run{" "}
          <code>package_builder_types_and_slots_v2.sql</code>,{" "}
          <code>package_builder_slot_narrative_fields.sql</code>,{" "}
          <code>package_builder_type_taxonomy_tags.sql</code>, and{" "}
          <code>package_builder_slot_selection_rules.sql</code>, and <code>package_builder_slot_hour_discount.sql</code> in Supabase if tables or columns are
          missing.
        </p>
      ) : null}

      <div className={layoutClass}>
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
                              {tiers.length} solution{tiers.length === 1 ? "" : "s"}
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
                                  {s.label.trim() || "Solution"}
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

        {!selectedTypeId ? (
          <main className="admin-pkg-builder__main" aria-label="Package solutions">
            <p className="admin-pkg-builder__empty" style={muted}>
              Select a template to configure its solutions.
            </p>
          </main>
        ) : (
          <>
            <div className="admin-pkg-builder__tiers-pane" aria-label="Template solutions">
              <div className="admin-pkg-builder__main-head">
                <div>
                  <h3 className="admin-pkg-builder__main-title">{selectedTypeName}</h3>
                  <p className="admin-pkg-builder__main-hint" style={muted}>
                    Select a solution to edit limits, components, tags, and package content.
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
                    Add solution
                  </button>
                </div>
              </div>

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

              <div className="admin-pkg-builder__tier-list">
                {typeSlots.map((r) => {
                  const active = selectedSlotId === r.id;
                  const rulesSummary = selectionRulesSummary(r);
                  return (
                    <div
                      key={r.id}
                      className={
                        active
                          ? "admin-pkg-builder__tier-row is-active"
                          : "admin-pkg-builder__tier-row"
                      }
                    >
                      <button
                        type="button"
                        className="admin-pkg-builder__tier-row-main"
                        disabled={busy}
                        onClick={() => {
                          setSelectedSlotId(r.id);
                          setEditorTab("limits");
                        }}
                      >
                        <span className="admin-pkg-builder__tier-order">{r.sort_order}</span>
                        <span className="admin-pkg-builder__tier-row-body">
                          <input
                            className="admin-pkg-builder__tier-label"
                            style={input}
                            value={r.label}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setSlot(r.id, { label: e.target.value })}
                            onFocus={() => setSelectedSlotId(r.id)}
                            aria-label={`Solution ${r.sort_order} label`}
                          />
                          <span className="admin-pkg-builder__tier-row-meta" style={muted}>
                            {slotLimitSummary(r)}
                            {rulesSummary ? ` · ${rulesSummary}` : ""}
                          </span>
                        </span>
                      </button>
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
                                {s.label.trim() || `Solution ${s.sort_order}`}
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          style={btnSm}
                          disabled={busy}
                          title="Duplicate solution with same limits and selection rules"
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
                  );
                })}
              </div>
            </div>

            {selectedSlot ? (
              <div className="admin-pkg-builder__tier-editor" aria-label="Solution editor">
                <header className="admin-pkg-builder__editor-head">
                  <div className="admin-pkg-builder__editor-head-text">
                    <p className="admin-pkg-builder__editor-kicker">Editing solution</p>
                    <h3 className="admin-pkg-builder__editor-title">
                      {selectedSlot.label.trim() || `Solution ${selectedSlot.sort_order}`}
                    </h3>
                    <p className="admin-pkg-builder__editor-meta">
                      {slotLimitSummary(selectedSlot)}
                    </p>
                  </div>
                </header>
                <div className="admin-pkg-builder__editor-tabs" role="tablist">
                  {(
                    [
                      ["limits", "Limits & risk"],
                      ["components", "Solution components"],
                      ["tags", "Playbook tags"],
                      ["content", "Package content"],
                      ["discount", "Discount"],
                    ] as const
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      role="tab"
                      aria-selected={editorTab === id}
                      className={
                        editorTab === id
                          ? "admin-pkg-builder__editor-tab is-active"
                          : "admin-pkg-builder__editor-tab"
                      }
                      disabled={busy}
                      onClick={() => setEditorTab(id)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {editorTab === "limits" ? (
                  <div className="admin-pkg-builder__editor-panel">
                    <div className="admin-pkg-builder__limits-panel">
                      <p className="admin-pkg-builder__limits-label">Solution limits</p>
                      <div className="admin-pkg-builder__limits">
                        <label className="admin-pkg-builder__field">
                          <span className="admin-pkg-builder__field-caption">Hour ceiling</span>
                          <input
                            style={input}
                            type="number"
                            min={0}
                            step={1}
                            placeholder="No limit"
                            value={selectedSlot.hour_ceiling ?? ""}
                            onChange={(e) =>
                              setSlot(selectedSlot.id, {
                                hour_ceiling: e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                            aria-label={`Solution ${selectedSlot.sort_order} hour ceiling`}
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
                            value={selectedSlot.price_ceiling ?? ""}
                            onChange={(e) =>
                              setSlot(selectedSlot.id, {
                                price_ceiling: e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                            aria-label={`Solution ${selectedSlot.sort_order} price ceiling`}
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
                            value={selectedSlot.solution_tier_limit ?? ""}
                            onChange={(e) =>
                              setSlot(selectedSlot.id, {
                                solution_tier_limit:
                                  e.target.value === "" ? null : Number(e.target.value),
                              })
                            }
                            aria-label={`Solution ${selectedSlot.sort_order} component limit`}
                          />
                        </label>
                      </div>
                    </div>

                    <div className="admin-pkg-builder__limits-panel">
                      <p className="admin-pkg-builder__limits-label">Preset risk &amp; strategic scores</p>
                      <p className="admin-pkg-builder__limits-hint">
                        Applied at package level when someone finishes building from this solution.
                      </p>
                      <div className="admin-pkg-builder__limits admin-pkg-builder__limits--scores">
                        <label className="admin-pkg-builder__field">
                          <span className="admin-pkg-builder__field-caption">Scope risk</span>
                          <select
                            className="admin-pkg-builder__score-select"
                            style={input}
                            title={riskScore012SelectTitle(SCOPE_RISK_SCORE_HINTS)}
                            value={String(clampScore012(selectedSlot.scope_risk))}
                            onChange={(e) =>
                              setSlot(selectedSlot.id, {
                                scope_risk: clampScore012(Number(e.target.value)),
                              })
                            }
                            aria-label={`Solution ${selectedSlot.sort_order} scope risk`}
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
                            value={String(clampScore012(selectedSlot.internal_coordination))}
                            onChange={(e) =>
                              setSlot(selectedSlot.id, {
                                internal_coordination: clampScore012(Number(e.target.value)),
                              })
                            }
                            aria-label={`Solution ${selectedSlot.sort_order} internal coordination`}
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
                            value={String(clampScore012(selectedSlot.client_revision_risk))}
                            onChange={(e) =>
                              setSlot(selectedSlot.id, {
                                client_revision_risk: clampScore012(Number(e.target.value)),
                              })
                            }
                            aria-label={`Solution ${selectedSlot.sort_order} client revision risk`}
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
                            value={String(clampScore012(selectedSlot.strategic_value_score))}
                            onChange={(e) =>
                              setSlot(selectedSlot.id, {
                                strategic_value_score: clampScore012(Number(e.target.value)),
                              })
                            }
                            aria-label={`Solution ${selectedSlot.sort_order} strategic value`}
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
                      <span className="admin-pkg-builder__field-caption">Solution disclaimer note</span>
                      <textarea
                        className="admin-pkg-builder__notes-input"
                        style={input}
                        rows={3}
                        value={selectedSlot.tier_notes ?? ""}
                        onChange={(e) =>
                          setSlot(selectedSlot.id, {
                            tier_notes: e.target.value.length > 0 ? e.target.value : null,
                          })
                        }
                        placeholder="Shown when users select this package solution in Build a Package (optional)."
                        aria-label={`Solution ${selectedSlot.sort_order} disclaimer note`}
                      />
                    </label>
                  </div>
                ) : null}

                {editorTab === "components" ? (
                  <div className="admin-pkg-builder__editor-panel">
                    <section className="admin-pkg-builder__section admin-pkg-builder__section--card">
                      <div className="admin-pkg-builder__section-head">
                        <div className="admin-pkg-builder__section-copy">
                          <h4 className="admin-pkg-builder__section-title">
                            Allowed list
                            <span className="admin-pkg-builder__section-count">
                              {selectedSlot.allowed_solution_tier_ids.length === 0
                                ? "Any"
                                : selectedSlot.allowed_solution_tier_ids.length}
                            </span>
                          </h4>
                          <p className="admin-pkg-builder__section-lead" style={muted}>
                            Leave all unchecked to allow any solution component from the directory.
                          </p>
                        </div>
                      </div>
                      <input
                        className="admin-pkg-builder__vault-search"
                        style={input}
                        type="search"
                        placeholder="Filter solution components…"
                        value={allowFilter}
                        onChange={(e) => setAllowFilter(e.target.value)}
                      />
                      <div className="admin-pkg-builder__vault-grid">
                        {allowedVaultTiers.map((vt) => {
                          const checked = selectedSlot.allowed_solution_tier_ids.includes(
                            vt.solution_tier_id
                          );
                          return (
                            <label
                              key={vt.solution_tier_id}
                              className={
                                checked
                                  ? "admin-pkg-builder__vault-check is-checked"
                                  : "admin-pkg-builder__vault-check"
                              }
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  toggleAllowedTier(
                                    selectedSlot.id,
                                    vt.solution_tier_id,
                                    e.target.checked
                                  )
                                }
                              />
                              <span>{vt.label}</span>
                            </label>
                          );
                        })}
                      </div>
                    </section>

                    <section className="admin-pkg-builder__section admin-pkg-builder__section--card">
                      <div className="admin-pkg-builder__section-head">
                        <div className="admin-pkg-builder__section-copy">
                          <h4 className="admin-pkg-builder__section-title">
                            Always included
                            <span className="admin-pkg-builder__section-count">
                              {selectedSlot.preselected_tiers.length}
                            </span>
                          </h4>
                          <p className="admin-pkg-builder__section-lead" style={muted}>
                            Locked vault solutions added automatically with a default quantity.
                          </p>
                        </div>
                      </div>
                      <div className="admin-pkg-builder__locked-list">
                        {selectedSlot.preselected_tiers.length === 0 ? (
                          <p className="admin-pkg-builder__empty-inline" style={muted}>
                            None yet — add components below.
                          </p>
                        ) : (
                          selectedSlot.preselected_tiers.map((p) => (
                            <div key={p.solution_tier_id} className="admin-pkg-builder__locked-chip">
                              <span className="admin-pkg-builder__locked-chip-badge">Locked</span>
                              <span className="admin-pkg-builder__locked-chip-label">
                                {vaultLabelById.get(p.solution_tier_id) ?? p.solution_tier_id}
                              </span>
                              <label className="admin-pkg-builder__locked-chip-qty">
                                <span>Qty</span>
                                <input
                                  style={input}
                                  type="number"
                                  min={1}
                                  step={1}
                                  value={p.default_qty}
                                  disabled={busy}
                                  onChange={(e) =>
                                    updatePreselectedQty(
                                      selectedSlot.id,
                                      p.solution_tier_id,
                                      Number(e.target.value)
                                    )
                                  }
                                  aria-label={`Default qty for ${p.solution_tier_id}`}
                                />
                              </label>
                              <button
                                type="button"
                                className="admin-pkg-builder__ghost-danger"
                                disabled={busy}
                                onClick={() =>
                                  removePreselectedTier(selectedSlot.id, p.solution_tier_id)
                                }
                              >
                                Remove
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                      <div className="admin-pkg-builder__add-row">
                        <input
                          className="admin-pkg-builder__vault-search"
                          style={input}
                          type="search"
                          placeholder="Search to add always-included…"
                          value={preFilter}
                          onChange={(e) => setPreFilter(e.target.value)}
                        />
                        <select
                          className="admin-pkg-builder__add-select"
                          style={input}
                          defaultValue=""
                          disabled={busy || preselectAddCandidates.length === 0}
                          aria-label="Add always-included solution component"
                          onChange={(e) => {
                            const tierId = e.target.value;
                            if (tierId) addPreselectedTier(selectedSlot.id, tierId);
                            e.target.value = "";
                          }}
                        >
                          <option value="">Add component…</option>
                          {preselectAddCandidates.map((vt) => (
                            <option key={vt.solution_tier_id} value={vt.solution_tier_id}>
                              {vt.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    </section>

                    <section className="admin-pkg-builder__section admin-pkg-builder__section--card">
                      <div className="admin-pkg-builder__section-head admin-pkg-builder__section-head--row">
                        <div className="admin-pkg-builder__section-copy">
                          <h4 className="admin-pkg-builder__section-title">
                            Choice buckets
                            <span className="admin-pkg-builder__section-count">
                              {sortedBuckets.length}
                            </span>
                          </h4>
                          <p className="admin-pkg-builder__section-lead" style={muted}>
                            Users pick exactly N distinct members from each bucket.
                          </p>
                        </div>
                        <button
                          type="button"
                          className="admin-pkg-builder__btn-quiet"
                          style={btnSm}
                          disabled={busy}
                          onClick={() => addBucket(selectedSlot.id)}
                        >
                          Add bucket
                        </button>
                      </div>
                      <input
                        className="admin-pkg-builder__vault-search"
                        style={input}
                        type="search"
                        placeholder="Filter bucket members…"
                        value={bucketMemberFilter}
                        onChange={(e) => setBucketMemberFilter(e.target.value)}
                      />
                      {sortedBuckets.length === 0 ? (
                        <p className="admin-pkg-builder__empty-inline" style={muted}>
                          No choice groups yet. Add a bucket to let builders pick from a set.
                        </p>
                      ) : null}
                      {sortedBuckets.map((b, idx) => (
                        <article key={b.id} className="admin-pkg-builder__bucket-card">
                          <div className="admin-pkg-builder__bucket-head">
                            <label className="admin-pkg-builder__field">
                              <span className="admin-pkg-builder__field-caption">Name</span>
                              <input
                                style={input}
                                value={b.name}
                                disabled={busy}
                                onChange={(e) =>
                                  updateBucket(selectedSlot.id, b.id, { name: e.target.value })
                                }
                                aria-label={`Bucket ${idx + 1} name`}
                              />
                            </label>
                            <label className="admin-pkg-builder__field admin-pkg-builder__field--pick">
                              <span className="admin-pkg-builder__field-caption">Pick N</span>
                              <input
                                style={input}
                                type="number"
                                min={1}
                                step={1}
                                value={b.pick_count}
                                disabled={busy}
                                onChange={(e) =>
                                  updateBucket(selectedSlot.id, b.id, {
                                    pick_count: Math.max(1, Math.floor(Number(e.target.value)) || 1),
                                  })
                                }
                                aria-label={`Bucket ${idx + 1} pick count`}
                              />
                            </label>
                            <div className="admin-pkg-builder__bucket-actions">
                              <button
                                type="button"
                                className="admin-pkg-builder__icon-btn"
                                style={btnSm}
                                disabled={busy || idx === 0}
                                aria-label="Move bucket up"
                                onClick={() => moveBucket(selectedSlot.id, b.id, -1)}
                              >
                                ↑
                              </button>
                              <button
                                type="button"
                                className="admin-pkg-builder__icon-btn"
                                style={btnSm}
                                disabled={busy || idx >= sortedBuckets.length - 1}
                                aria-label="Move bucket down"
                                onClick={() => moveBucket(selectedSlot.id, b.id, 1)}
                              >
                                ↓
                              </button>
                              <button
                                type="button"
                                className="admin-pkg-builder__ghost-danger"
                                disabled={busy}
                                onClick={() => removeBucket(selectedSlot.id, b.id)}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          <p className="admin-pkg-builder__bucket-members-label">
                            Members · {b.member_tier_ids.length} selected
                          </p>
                          <div className="admin-pkg-builder__vault-grid admin-pkg-builder__vault-grid--bucket">
                            {bucketMemberCandidates.map((vt) => {
                              const checked = b.member_tier_ids.includes(vt.solution_tier_id);
                              return (
                                <label
                                  key={vt.solution_tier_id}
                                  className={
                                    checked
                                      ? "admin-pkg-builder__vault-check is-checked"
                                      : "admin-pkg-builder__vault-check"
                                  }
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    disabled={busy}
                                    onChange={(e) =>
                                      toggleBucketMember(
                                        selectedSlot.id,
                                        b.id,
                                        vt.solution_tier_id,
                                        e.target.checked
                                      )
                                    }
                                  />
                                  <span>{vt.label}</span>
                                </label>
                              );
                            })}
                          </div>
                        </article>
                      ))}
                    </section>
                  </div>
                ) : null}

                {editorTab === "tags" && selectedType ? (
                  <div className="admin-pkg-builder__editor-panel admin-pkg-builder__editor-panel--tags">
                    <p className="admin-pkg-builder__vault-panel-hint" style={muted}>
                      These tags apply to the whole template ({selectedTypeName}), not just this solution.
                    </p>
                    <PackageTypeTaxonomyTagsEditor
                      phaseTags={selectedType.phase_tags}
                      categoryTags={selectedType.category_tags}
                      tacticTags={selectedType.tactic_tags}
                      options={taxonomyOptions}
                      disabled={busy}
                      onChange={(patch) => setType(selectedType.id, patch)}
                    />
                  </div>
                ) : null}

                {editorTab === "content" ? (
                  <div className="admin-pkg-builder__editor-panel">
                    <div className="admin-pkg-builder__details-head">
                      <p className="admin-pkg-builder__vault-panel-hint" style={muted}>
                        Overview, scope, process, and resources copied to packages built from this
                        solution. Package category is set from the template name.
                      </p>
                      <select
                        className="admin-pkg-builder__copy-select admin-pkg-builder__copy-select--details"
                        style={input}
                        defaultValue=""
                        disabled={busy || typeSlots.length <= 1}
                        aria-label={`Copy package details into ${selectedSlot.label}`}
                        onChange={(e) => {
                          const sourceId = e.target.value;
                          if (sourceId) copyDetailsFromTier(selectedSlot.id, sourceId);
                          e.target.value = "";
                        }}
                      >
                        <option value="">Copy details from…</option>
                        {typeSlots
                          .filter((s) => s.id !== selectedSlot.id)
                          .map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.label.trim() || `Solution ${s.sort_order}`}
                            </option>
                          ))}
                      </select>
                    </div>
                    <PackageDetailsFormBlock
                      hideCategory
                      values={slotToDetailsFormValues(selectedSlot)}
                      onChange={(key, value) =>
                        setSlot(selectedSlot.id, detailsFormPatchToSlot(key, value))
                      }
                      styles={packageFormStyles}
                    />
                  </div>
                ) : null}

                {editorTab === "discount" ? (
                  <div className="admin-pkg-builder__editor-panel">
                    <section className="admin-pkg-builder__section admin-pkg-builder__section--card">
                      <div className="admin-pkg-builder__section-head">
                        <div className="admin-pkg-builder__section-copy">
                          <h4 className="admin-pkg-builder__section-title">Package hour discount</h4>
                          <p className="admin-pkg-builder__section-lead" style={muted}>
                            Applied when someone finishes Build a Package from this solution. Use a preset
                            or enter any custom percent (0–100). Leave blank to use the label default
                            (Basic 20%, Standard 25%, Advanced 30%).
                          </p>
                        </div>
                      </div>

                      <div className="admin-pkg-builder__limits">
                        <label className="admin-pkg-builder__field">
                          <span className="admin-pkg-builder__field-caption">Hour discount %</span>
                          <input
                            style={input}
                            type="number"
                            min={0}
                            max={100}
                            step={1}
                            placeholder={
                              suggestedHourDiscountPctForLabel(
                                selectedSlot.label,
                                selectedTypeName
                              ) != null
                                ? `Label default ${suggestedHourDiscountPctForLabel(
                                    selectedSlot.label,
                                    selectedTypeName
                                  )}`
                                : "Custom (e.g. 15)"
                            }
                            value={selectedSlot.hour_discount_pct ?? ""}
                            disabled={busy}
                            onChange={(e) =>
                              setSlot(selectedSlot.id, {
                                hour_discount_pct:
                                  e.target.value === ""
                                    ? null
                                    : parseOptionalHourDiscountPct(Number(e.target.value)),
                              })
                            }
                            aria-label={`Solution ${selectedSlot.sort_order} hour discount percent`}
                          />
                        </label>
                      </div>

                      <p className="admin-pkg-builder__limits-hint" style={muted}>
                        {selectedSlot.hour_discount_pct != null
                          ? `Configured: ${selectedSlot.hour_discount_pct}% hour discount on packages built from this solution.`
                          : (() => {
                              const suggested = suggestedHourDiscountPctForLabel(
                                selectedSlot.label,
                                selectedTypeName
                              );
                              return suggested != null
                                ? `Using label default for now: ${suggested}% (from “${selectedSlot.label.trim() || "Solution"}”).`
                                : "No discount configured and no Basic/Standard/Advanced label match — packages will use 0%.";
                            })()}
                      </p>

                      <div className="admin-pkg-builder__discount-presets">
                        {(
                          [
                            [20, "Basic"],
                            [25, "Standard"],
                            [30, "Advanced"],
                            [0, "None"],
                          ] as const
                        ).map(([pct, label]) => (
                          <button
                            key={`${label}-${pct}`}
                            type="button"
                            className={
                              selectedSlot.hour_discount_pct === pct
                                ? "admin-pkg-builder__btn-quiet is-active"
                                : "admin-pkg-builder__btn-quiet"
                            }
                            style={btnSm}
                            disabled={busy}
                            onClick={() =>
                              setSlot(selectedSlot.id, {
                                hour_discount_pct: pct,
                              })
                            }
                          >
                            {label} ({pct}%)
                          </button>
                        ))}
                        <button
                          type="button"
                          className="admin-pkg-builder__ghost-danger"
                          disabled={busy || selectedSlot.hour_discount_pct == null}
                          onClick={() => setSlot(selectedSlot.id, { hour_discount_pct: null })}
                        >
                          Clear (use label default)
                        </button>
                      </div>
                    </section>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
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
