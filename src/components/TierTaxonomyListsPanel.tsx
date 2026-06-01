import { useCallback, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { getSupabase } from "../lib/supabase";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";
import type { SolutionTier, SolutionTierTaxonomyOptionRow, TierTaxonomyKind } from "../types";

type Props = {
  rows: SolutionTierTaxonomyOptionRow[];
  tiers: SolutionTier[];
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

const KIND_META: Record<TierTaxonomyKind, { title: string; tierField: keyof SolutionTier }> = {
  phase: { title: "Phases", tierField: "solution_tier_phase" },
  category: { title: "Categories", tierField: "solution_tier_category" },
  tactic: { title: "Tactics", tierField: "solution_tier_tactic" },
};

function TierTaxonomySection({
  kind,
  rows,
  tiers,
  saving,
  setSaving,
  onRefresh,
  setOpErr,
  setOpOk,
  formGrid,
  lbl,
  input,
  btn,
  btnPrimary,
  btnDangerSm,
  tbl,
  th,
  td,
}: {
  kind: TierTaxonomyKind;
  rows: SolutionTierTaxonomyOptionRow[];
  tiers: SolutionTier[];
  saving: boolean;
  setSaving: (v: boolean) => void;
  onRefresh: () => Promise<void>;
  setOpErr: (s: string | null) => void;
  setOpOk: (s: string | null) => void;
} & Pick<
  Props,
  "formGrid" | "lbl" | "input" | "btn" | "btnPrimary" | "btnDangerSm" | "tbl" | "th" | "td"
>) {
  const meta = KIND_META[kind];
  const sectionRows = useMemo(
    () =>
      rows
        .filter((r) => r.kind === kind)
        .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: "base" })),
    [rows, kind]
  );
  const [labelField, setLabelField] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const usageCount = useCallback(
    (label: string) => {
      const field = meta.tierField;
      const norm = label.trim();
      return tiers.filter((t) => {
        const raw = t[field];
        return (typeof raw === "string" ? raw : "").trim() === norm;
      }).length;
    },
    [meta.tierField, tiers]
  );

  const resetForm = useCallback(() => {
    setLabelField("");
    setEditingId(null);
  }, []);

  const save = useCallback(async () => {
    const client = getSupabase();
    if (!client) return;
    const label = labelField.trim();
    if (!label) {
      setOpErr(`${meta.title.slice(0, -1)} label is required.`);
      return;
    }
    setOpErr(null);
    setOpOk(null);
    setSaving(true);
    try {
      if (editingId) {
        const prev = sectionRows.find((r) => r.id === editingId);
        const { error } = await client
          .from("solution_tier_taxonomy_options")
          .update({ label })
          .eq("id", editingId);
        if (error) {
          setOpErr(friendlyMutationMessage(error.message));
          return;
        }
        if (prev && prev.label !== label) {
          const { error: tierErr } = await client
            .from("solution_tiers")
            .update({ [meta.tierField]: label })
            .eq(meta.tierField, prev.label);
          if (tierErr) {
            setOpErr(
              `Option updated, but tiers still reference the old label: ${friendlyMutationMessage(tierErr.message)}`
            );
            await onRefresh();
            return;
          }
        }
        setOpOk(`${meta.title.slice(0, -1)} updated.`);
      } else {
        const { error } = await client.from("solution_tier_taxonomy_options").insert({
          kind,
          label,
        });
        if (error) {
          setOpErr(friendlyMutationMessage(error.message));
          return;
        }
        setOpOk(`${meta.title.slice(0, -1)} added.`);
      }
      resetForm();
      notifyPackagingDataChanged();
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }, [
    editingId,
    kind,
    labelField,
    meta.title,
    meta.tierField,
    onRefresh,
    resetForm,
    sectionRows,
    setOpErr,
    setOpOk,
    setSaving,
  ]);

  const remove = useCallback(
    async (r: SolutionTierTaxonomyOptionRow) => {
      const used = usageCount(r.label);
      if (used > 0) {
        setOpErr(`Cannot delete “${r.label}”: ${used} tier(s) still use it. Clear those tiers first.`);
        return;
      }
      if (!window.confirm(`Delete ${kind} option “${r.label}”?`)) return;
      const client = getSupabase();
      if (!client) return;
      setOpErr(null);
      setOpOk(null);
      setSaving(true);
      try {
        const { error } = await client.from("solution_tier_taxonomy_options").delete().eq("id", r.id);
        if (error) {
          setOpErr(friendlyMutationMessage(error.message));
          return;
        }
        if (editingId === r.id) resetForm();
        setOpOk("Option deleted.");
        notifyPackagingDataChanged();
        await onRefresh();
      } finally {
        setSaving(false);
      }
    },
    [editingId, kind, onRefresh, resetForm, setOpErr, setOpOk, setSaving, usageCount]
  );

  const startEdit = (r: SolutionTierTaxonomyOptionRow) => {
    setOpErr(null);
    setOpOk(null);
    setEditingId(r.id);
    setLabelField(r.label);
  };

  return (
    <section style={{ marginTop: "1.5rem" }}>
      <h3 style={{ margin: "0 0 0.35rem", fontSize: "1.05rem" }}>{meta.title}</h3>
      <div className="admin-form-stack" style={{ ...formGrid, maxWidth: 520 }}>
        <label style={lbl}>
          <span className="admin-field-caption">Label</span>
          <input
            style={input}
            value={labelField}
            onChange={(e) => setLabelField(e.target.value)}
            disabled={saving}
          />
        </label>
      </div>
      <div className="admin-actions-row" style={{ marginTop: 10 }}>
        <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void save()} disabled={saving}>
          {editingId ? "Save changes" : "Add"}
        </button>
        {editingId ? (
          <button type="button" style={btn} onClick={resetForm} disabled={saving}>
            Cancel edit
          </button>
        ) : null}
      </div>
      <div className="admin-table-scroll" style={{ marginTop: 12 }}>
        <table className="admin-data-table" style={tbl}>
          <thead>
            <tr>
              <th style={th}>Label</th>
              <th style={th}>Tiers using</th>
              <th style={th} />
            </tr>
          </thead>
          <tbody>
            {sectionRows.map((r) => (
              <tr key={r.id}>
                <td style={td}>{r.label}</td>
                <td style={td}>{usageCount(r.label)}</td>
                <td style={{ ...td, whiteSpace: "nowrap" }}>
                  <button type="button" style={btn} onClick={() => startEdit(r)} disabled={saving}>
                    Edit
                  </button>{" "}
                  <button type="button" style={btnDangerSm} onClick={() => void remove(r)} disabled={saving}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {sectionRows.length === 0 ? (
              <tr>
                <td colSpan={3} style={td}>
                  No options yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function TierTaxonomyListsPanel({
  rows,
  tiers,
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
  const [saving, setSaving] = useState(false);

  return (
    <section className="admin-panel admin-panel--editor" style={panel}>
      <div className="admin-editor-layout admin-editor-layout--wide">
        <h2 style={h2}>Phase, category &amp; tactic lists</h2>
        <p className="admin-intro" style={muted}>
          Manage dropdown values for solution tiers (listed A–Z). <strong>Phase</strong> appears above category;{" "}
          <strong>tactic</strong> appears below category in create and update forms.
        </p>
        {loadNote ? (
          <p style={{ ...muted, color: "var(--warn, #b45309)" }} role="status">
            {loadNote}
          </p>
        ) : null}
        {(["phase", "category", "tactic"] as const).map((kind) => (
          <TierTaxonomySection
            key={kind}
            kind={kind}
            rows={rows}
            tiers={tiers}
            saving={saving}
            setSaving={setSaving}
            onRefresh={onRefresh}
            setOpErr={setOpErr}
            setOpOk={setOpOk}
            formGrid={formGrid}
            lbl={lbl}
            input={input}
            btn={btn}
            btnPrimary={btnPrimary}
            btnDangerSm={btnDangerSm}
            tbl={tbl}
            th={th}
            td={td}
          />
        ))}
      </div>
    </section>
  );
}
