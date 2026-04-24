import { useCallback, useState } from "react";
import type { CSSProperties } from "react";
import { getSupabase } from "../lib/supabase";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";
import { PRICING_HOUR_GROUP_KEYS, pricingHourGroupLabel } from "../lib/pricingHourGroups";
import type { ImplementerHourGroupRow, PricingHourGroupKey } from "../types";

type Props = {
  rows: ImplementerHourGroupRow[];
  loadNote: string | null;
  onRefresh: () => Promise<void>;
  setOpErr: (s: string | null) => void;
  setOpOk: (s: string | null) => void;
  panel: CSSProperties;
  h2: CSSProperties;
  muted: CSSProperties;
  formGrid: CSSProperties;
  lbl: CSSProperties;
  input: CSSProperties;
  btn: CSSProperties;
  btnPrimary: CSSProperties;
  btnDangerSm: CSSProperties;
  tbl: CSSProperties;
  th: CSSProperties;
  td: CSSProperties;
};

export function ImplementerMappingPanel({
  rows,
  loadNote,
  onRefresh,
  setOpErr,
  setOpOk,
  panel,
  h2,
  muted,
  formGrid,
  lbl,
  input,
  btn,
  btnPrimary,
  btnDangerSm,
  tbl,
  th,
  td,
}: Props) {
  const [nameField, setNameField] = useState("");
  const [groupField, setGroupField] = useState<PricingHourGroupKey>("client_services");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const resetForm = useCallback(() => {
    setNameField("");
    setGroupField("client_services");
    setEditingId(null);
  }, []);

  const startEdit = (r: ImplementerHourGroupRow) => {
    setOpErr(null);
    setOpOk(null);
    setEditingId(r.id);
    setNameField(r.implementer_name);
    setGroupField(r.hour_group);
  };

  const save = useCallback(async () => {
    const client = getSupabase();
    if (!client) return;
    const name = nameField.trim();
    if (!name) {
      setOpErr("Implementer name is required.");
      return;
    }
    setOpErr(null);
    setOpOk(null);
    setSaving(true);
    try {
      if (editingId) {
        const { error } = await client
          .from("implementer_pricing_hour_groups")
          .update({ implementer_name: name, hour_group: groupField })
          .eq("id", editingId);
        if (error) {
          setOpErr(friendlyMutationMessage(error.message));
          return;
        }
        setOpOk("Mapping updated.");
        resetForm();
      } else {
        const { error } = await client.from("implementer_pricing_hour_groups").insert({
          implementer_name: name,
          hour_group: groupField,
        });
        if (error) {
          setOpErr(friendlyMutationMessage(error.message));
          return;
        }
        setOpOk("Mapping added.");
        resetForm();
      }
      notifyPackagingDataChanged();
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }, [editingId, nameField, groupField, onRefresh, resetForm, setOpErr, setOpOk]);

  const remove = useCallback(
    async (r: ImplementerHourGroupRow) => {
      if (!window.confirm(`Delete mapping for “${r.implementer_name}”?`)) return;
      const client = getSupabase();
      if (!client) return;
      setOpErr(null);
      setOpOk(null);
      setSaving(true);
      try {
        const { error } = await client
          .from("implementer_pricing_hour_groups")
          .delete()
          .eq("id", r.id);
        if (error) {
          setOpErr(friendlyMutationMessage(error.message));
          return;
        }
        if (editingId === r.id) resetForm();
        setOpOk("Mapping deleted.");
        notifyPackagingDataChanged();
        await onRefresh();
      } finally {
        setSaving(false);
      }
    },
    [editingId, onRefresh, resetForm, setOpErr, setOpOk]
  );

  return (
    <section className="admin-panel admin-panel--editor" style={panel}>
      <div className="admin-editor-layout admin-editor-layout--wide">
        <h2 style={h2}>Implementer → pricing hours</h2>
        <p className="admin-intro" style={muted}>
          Each <strong>task implementer</strong> label (as entered on tasks) maps to one pricing{" "}
          <strong>hour group</strong>. This will be used to roll up task time into the tier&apos;s
          hours by column (Client services, Copy, Web dev, and so on).
        </p>
        {loadNote ? (
          <p className="admin-hint" style={{ ...muted, color: "#92400e", marginTop: 8 }}>
            {loadNote}
          </p>
        ) : null}

        <div
          className="admin-form-stack"
          style={{ ...formGrid, maxWidth: 520, marginTop: "0.75rem" }}
        >
          <label style={lbl}>
            <span className="admin-field-caption">Implementer name</span>
            <input
              style={input}
              value={nameField}
              onChange={(e) => setNameField(e.target.value)}
              placeholder="e.g. Strategist"
              disabled={saving}
            />
          </label>
          <label style={lbl}>
            <span className="admin-field-caption">Hour group</span>
            <select
              style={input}
              value={groupField}
              onChange={(e) => setGroupField(e.target.value as PricingHourGroupKey)}
              disabled={saving}
            >
              {PRICING_HOUR_GROUP_KEYS.map((k) => (
                <option key={k} value={k}>
                  {pricingHourGroupLabel(k)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="admin-actions-row" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="admin-btn-primary"
            style={btnPrimary}
            onClick={() => void save()}
            disabled={saving}
          >
            {editingId ? "Save changes" : "Add mapping"}
          </button>
          {editingId ? (
            <button type="button" style={btn} onClick={resetForm} disabled={saving}>
              Cancel edit
            </button>
          ) : null}
        </div>

        <div className="admin-table-scroll" style={{ marginTop: 16 }}>
          <table className="admin-data-table" style={tbl}>
            <thead>
              <tr>
                <th style={th}>Implementer</th>
                <th style={th}>Hour group</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && !loadNote ? (
                <tr>
                  <td colSpan={3} style={td}>
                    No mappings yet. Add one above.
                  </td>
                </tr>
              ) : null}
              {rows.map((r) => (
                <tr key={r.id}>
                  <td style={td}>{r.implementer_name}</td>
                  <td style={td}>{pricingHourGroupLabel(r.hour_group)}</td>
                  <td style={td}>
                    <button
                      type="button"
                      style={btn}
                      onClick={() => startEdit(r)}
                      disabled={saving}
                    >
                      Edit
                    </button>{" "}
                    <button
                      type="button"
                      style={btnDangerSm}
                      onClick={() => void remove(r)}
                      disabled={saving}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
