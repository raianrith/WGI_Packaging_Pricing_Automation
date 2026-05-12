import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import type { PackageBuilderSlotTemplate } from "../types";
import { fetchPackageBuilderSlots, PACKAGE_BUILDER_DEFAULT_SLOTS } from "../lib/packageBuilderSlots";
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
  tbl,
  th,
  td,
  setOpErr,
  setOpOk,
  onSaved,
}: Props) {
  const [rows, setRows] = useState<PackageBuilderSlotTemplate[]>(() =>
    PACKAGE_BUILDER_DEFAULT_SLOTS.map((r) => ({ ...r }))
  );
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const client = getSupabase();
    if (!client) return;
    const { rows: next, error } = await fetchPackageBuilderSlots(client);
    setRows(next.map((r) => ({ ...r })));
    setLoadNote(error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async () => {
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
    setBusy(true);
    try {
      const payload = rows.map((r) => ({
        slot: r.slot,
        label: r.label.trim() || `Slot ${r.slot}`,
        hour_ceiling: Math.max(0, Number(r.hour_ceiling) || 0),
        price_ceiling: Math.max(0, Number(r.price_ceiling) || 0),
      }));
      const { error } = await client.from("package_builder_slot_templates").upsert(payload, {
        onConflict: "slot",
      });
      if (error) {
        setOpErr(friendlyMutationMessage(error.message));
        return;
      }
      setOpOk("Package builder tier ceilings saved.");
      notifyPackagingDataChanged();
      await load();
      await onSaved();
    } finally {
      setBusy(false);
    }
  };

  const setRow = (slot: number, patch: Partial<PackageBuilderSlotTemplate>) => {
    setRows((prev) => prev.map((r) => (r.slot === slot ? { ...r, ...patch } : r)));
  };

  return (
    <div
      style={{
        marginTop: "1rem",
        marginBottom: "1.1rem",
        padding: "1rem 1.1rem",
        borderRadius: 14,
        border: "1px solid var(--border)",
        background: "rgba(255, 252, 247, 0.96)",
      }}
    >
      <h3 style={sectionTitle}>Build-a-Package tier slots</h3>
      <p className="admin-intro" style={{ ...muted, marginTop: 0 }}>
        The agency <strong>Packages</strong> tab offers three named slots (Core / Growth / Enterprise by default).
        Set the <strong>hour</strong> and <strong>price (USD)</strong> ceilings for each slot. Vault totals for selected
        solution tiers are compared to these limits while building a package.
      </p>
      {loadNote ? (
        <p style={{ ...muted, fontSize: "0.88rem" }} role="status">
          Could not load saved ceilings from the database ({loadNote}). Showing defaults until save succeeds.
        </p>
      ) : null}
      <table style={{ ...tbl, marginTop: "0.65rem" }}>
        <thead>
          <tr>
            <th style={th}>Slot</th>
            <th style={th}>Label</th>
            <th style={th}>Hour ceiling</th>
            <th style={th}>Price ceiling (USD)</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.slot}>
              <td style={td}>{r.slot}</td>
              <td style={td}>
                <label style={{ display: "block" }}>
                  <FieldCaption>Display name</FieldCaption>
                  <input
                    style={input}
                    value={r.label}
                    onChange={(e) => setRow(r.slot, { label: e.target.value })}
                    aria-label={`Slot ${r.slot} label`}
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
                    onChange={(e) => setRow(r.slot, { hour_ceiling: Number(e.target.value) })}
                    aria-label={`Slot ${r.slot} hour ceiling`}
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
                    onChange={(e) => setRow(r.slot, { price_ceiling: Number(e.target.value) })}
                    aria-label={`Slot ${r.slot} price ceiling`}
                  />
                </label>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ marginTop: "0.75rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <button type="button" style={btnPrimary} disabled={busy} onClick={() => void save()}>
          {busy ? "Saving…" : "Save slot ceilings"}
        </button>
        <button type="button" style={btnSm} disabled={busy} onClick={() => void load()}>
          Reload
        </button>
      </div>
    </div>
  );
}
