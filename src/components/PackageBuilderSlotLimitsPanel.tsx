import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { PackageBuilderSlotTemplate } from "../types";
import {
  defaultPackageBuilderSlots,
  fetchPackageBuilderSlots,
  isPersistedPackageBuilderSlotId,
  newLocalPackageBuilderSlotId,
} from "../lib/packageBuilderSlots";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { getSupabase } from "../lib/supabase";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";

function FieldCaption({ children }: { children: ReactNode }) {
  return <span className="admin-field-caption">{children}</span>;
}

const sectionTitle: CSSProperties = {
  margin: "0 0 0.55rem",
  fontSize: "0.95rem",
  fontWeight: 650,
  letterSpacing: "-0.02em",
};

type Props = {
  muted: CSSProperties;
  input: CSSProperties;
  btnPrimary: CSSProperties;
  btnSm: CSSProperties;
  btnDangerSm: CSSProperties;
  tbl: CSSProperties;
  th: CSSProperties;
  td: CSSProperties;
  setOpErr: (s: string | null) => void;
  setOpOk: (s: string | null) => void;
  onSaved: () => Promise<void>;
};

export function PackageBuilderSlotLimitsPanel({
  muted,
  input,
  btnPrimary,
  btnSm,
  btnDangerSm,
  tbl,
  th,
  td,
  setOpErr,
  setOpOk,
  onSaved,
}: Props) {
  const [rows, setRows] = useState<PackageBuilderSlotTemplate[]>(() =>
    defaultPackageBuilderSlots().map((r) => ({ ...r }))
  );
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastPersistedIdsRef = useRef<string[]>([]);

  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client) return;
    const { rows: next, error } = await fetchPackageBuilderSlots(client);
    setRows(next.map((r) => ({ ...r })));
    setLoadNote(error);
    lastPersistedIdsRef.current = next.filter((r) => isPersistedPackageBuilderSlotId(r.id)).map((r) => r.id);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setRow = (id: string, patch: Partial<PackageBuilderSlotTemplate>) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  };

  const addSlot = () => {
    setRows((prev) => {
      const maxOrder = prev.reduce((m, r) => Math.max(m, r.sort_order), 0);
      return [
        ...prev,
        {
          id: newLocalPackageBuilderSlotId(),
          sort_order: maxOrder + 1,
          label: "New slot",
          hour_ceiling: 0,
          price_ceiling: 0,
          updated_at: null,
        },
      ];
    });
  };

  const removeSlot = (id: string) => {
    if (rows.length <= 1) return;
    if (!globalThis.confirm("Remove this slot? Agency users will no longer see it when building a package.")) {
      return;
    }
    setRows((prev) => {
      const next = prev.filter((r) => r.id !== id);
      return next.map((r, i) => ({ ...r, sort_order: i + 1 }));
    });
  };

  const save = async () => {
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    setBusy(true);
    const nowIso = new Date().toISOString();
    try {
      const ordered = [...rows]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((r, i) => ({
          ...r,
          sort_order: i + 1,
          label: r.label.trim() || `Slot ${i + 1}`,
          hour_ceiling: Math.max(0, Number(r.hour_ceiling) || 0),
          price_ceiling: Math.max(0, Number(r.price_ceiling) || 0),
        }));

      const orderedIds = new Set(ordered.map((r) => r.id));
      for (const prevId of lastPersistedIdsRef.current) {
        if (!isPersistedPackageBuilderSlotId(prevId)) continue;
        if (orderedIds.has(prevId)) continue;
        const { error: delErr } = await client.from("package_builder_slot_templates").delete().eq("id", prevId);
        if (delErr) {
          setOpErr(friendlyMutationMessage(delErr.message));
          return;
        }
      }

      /* Move persisted rows off 1..n before assigning final sort_order (avoids unique(sort_order) violations). */
      const BUMP_BASE = 10_000_000;
      const persistedInOrder = ordered.filter((r) => isPersistedPackageBuilderSlotId(r.id));
      let bump = 0;
      for (const r of persistedInOrder) {
        bump += 1;
        const { error: bumpErr } = await client
          .from("package_builder_slot_templates")
          .update({ sort_order: BUMP_BASE + bump })
          .eq("id", r.id);
        if (bumpErr) {
          setOpErr(friendlyMutationMessage(bumpErr.message));
          return;
        }
      }

      for (const r of ordered) {
        if (isPersistedPackageBuilderSlotId(r.id)) {
          const { error: upErr } = await client
            .from("package_builder_slot_templates")
            .update({
              sort_order: r.sort_order,
              label: r.label,
              hour_ceiling: r.hour_ceiling,
              price_ceiling: r.price_ceiling,
              updated_at: nowIso,
            })
            .eq("id", r.id);
          if (upErr) {
            setOpErr(friendlyMutationMessage(upErr.message));
            return;
          }
        }
      }

      for (const r of ordered) {
        if (isPersistedPackageBuilderSlotId(r.id)) continue;
        const { error: insErr } = await client.from("package_builder_slot_templates").insert({
          sort_order: r.sort_order,
          label: r.label,
          hour_ceiling: r.hour_ceiling,
          price_ceiling: r.price_ceiling,
        });
        if (insErr) {
          setOpErr(friendlyMutationMessage(insErr.message));
          return;
        }
      }

      setOpOk("Tier slot ceilings saved.");
      notifyPackagingDataChanged();
      await load();
      await onSaved();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <h3 style={sectionTitle}>Build-a-Package tier slots</h3>
      <p className="admin-intro" style={{ ...muted, marginTop: 0 }}>
        These slots appear when agency users open <strong>Packages → Build a Package</strong>. Each slot defines a{" "}
        <strong>hour</strong> and <strong>price (USD)</strong> ceiling; vault totals for selected solution tiers are
        compared to those limits. Add or remove slots as needed — at least one slot must remain.
      </p>
      {loadNote ? (
        <p style={{ ...muted, fontSize: "0.88rem" }} role="status">
          Could not load saved slots from the database ({loadNote}). Showing defaults until save succeeds. If you
          upgraded from an older schema, run <code>package_builder_slot_templates_uuid_migration.sql</code> in
          Supabase.
        </p>
      ) : null}

      <div style={{ marginTop: "0.65rem", display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
        <button type="button" style={btnSm} disabled={busy} onClick={addSlot}>
          Add slot
        </button>
      </div>

      <table style={{ ...tbl, marginTop: "0.65rem" }}>
        <thead>
          <tr>
            <th style={th}>Order</th>
            <th style={th}>Label</th>
            <th style={th}>Hour ceiling</th>
            <th style={th}>Price ceiling (USD)</th>
            <th style={th}> </th>
          </tr>
        </thead>
        <tbody>
          {[...rows]
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((r) => (
              <tr key={r.id}>
                <td style={td}>{r.sort_order}</td>
                <td style={td}>
                  <label style={{ display: "block" }}>
                    <FieldCaption>Display name</FieldCaption>
                    <input
                      style={input}
                      value={r.label}
                      onChange={(e) => setRow(r.id, { label: e.target.value })}
                      aria-label={`Slot order ${r.sort_order} label`}
                    />
                  </label>
                </td>
                <td style={td}>
                  <label style={{ display: "block" }}>
                    <FieldCaption>Hours</FieldCaption>
                    <input
                      style={input}
                      type="number"
                      min={0}
                      step={1}
                      value={Number.isFinite(r.hour_ceiling) ? r.hour_ceiling : 0}
                      onChange={(e) => setRow(r.id, { hour_ceiling: Number(e.target.value) })}
                      aria-label={`Slot order ${r.sort_order} hour ceiling`}
                    />
                  </label>
                </td>
                <td style={td}>
                  <label style={{ display: "block" }}>
                    <FieldCaption>USD</FieldCaption>
                    <input
                      style={input}
                      type="number"
                      min={0}
                      step={1000}
                      value={Number.isFinite(r.price_ceiling) ? r.price_ceiling : 0}
                      onChange={(e) => setRow(r.id, { price_ceiling: Number(e.target.value) })}
                      aria-label={`Slot order ${r.sort_order} price ceiling`}
                    />
                  </label>
                </td>
                <td style={td}>
                  <button
                    type="button"
                    style={btnDangerSm}
                    disabled={busy || rows.length <= 1}
                    onClick={() => removeSlot(r.id)}
                    aria-label={`Remove slot ${r.label}`}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
        </tbody>
      </table>
      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" style={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save slots"}
        </button>
        <button type="button" style={btnSm} disabled={busy} onClick={() => void load()}>
          Reload
        </button>
      </div>
    </div>
  );
}
