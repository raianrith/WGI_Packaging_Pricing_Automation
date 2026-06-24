import type { PackageBuilderPackageType } from "../types";
import type { TierTaxonomyKind } from "../types";

type TaxonomyOptions = {
  phase: string[];
  category: string[];
  tactic: string[];
};

type Props = {
  phaseTags: string[];
  categoryTags: string[];
  tacticTags: string[];
  options: TaxonomyOptions;
  disabled?: boolean;
  sectionTitle?: string;
  sectionLead?: string;
  onChange: (
    patch: Partial<Pick<PackageBuilderPackageType, "phase_tags" | "category_tags" | "tactic_tags">>
  ) => void;
};

const KIND_CONFIG: {
  kind: TierTaxonomyKind;
  label: string;
  hint: string;
  field: "phase_tags" | "category_tags" | "tactic_tags";
  pillClass: string;
}[] = [
  {
    kind: "phase",
    label: "Phases",
    hint: "Which lifecycle phases apply.",
    field: "phase_tags",
    pillClass: "admin-pkg-builder__taxonomy-pill--phase",
  },
  {
    kind: "category",
    label: "Categories",
    hint: "Playbook categories for filtering.",
    field: "category_tags",
    pillClass: "admin-pkg-builder__taxonomy-pill--category",
  },
  {
    kind: "tactic",
    label: "Tactics",
    hint: "Tactics this family emphasizes.",
    field: "tactic_tags",
    pillClass: "admin-pkg-builder__taxonomy-pill--tactic",
  },
];

function tagsForKind(
  kind: TierTaxonomyKind,
  props: Pick<Props, "phaseTags" | "categoryTags" | "tacticTags">
): string[] {
  if (kind === "phase") return props.phaseTags;
  if (kind === "category") return props.categoryTags;
  return props.tacticTags;
}

export function PackageTypeTaxonomyTagsEditor({
  phaseTags,
  categoryTags,
  tacticTags,
  options,
  disabled,
  sectionTitle = "Playbook tags",
  sectionLead = "Tag this family with phases, categories, and tactics from your playbook lists.",
  onChange,
}: Props) {
  const tagProps = { phaseTags, categoryTags, tacticTags };

  const setTags = (field: (typeof KIND_CONFIG)[number]["field"], next: string[]) => {
    onChange({ [field]: next });
  };

  const addTag = (field: (typeof KIND_CONFIG)[number]["field"], kind: TierTaxonomyKind, label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const current = tagsForKind(kind, tagProps);
    if (current.some((t) => t.localeCompare(trimmed, undefined, { sensitivity: "base" }) === 0)) return;
    setTags(field, [...current, trimmed].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })));
  };

  const removeTag = (field: (typeof KIND_CONFIG)[number]["field"], kind: TierTaxonomyKind, label: string) => {
    const current = tagsForKind(kind, tagProps);
    setTags(
      field,
      current.filter((t) => t.localeCompare(label, undefined, { sensitivity: "base" }) !== 0)
    );
  };

  const selectAllTags = (field: (typeof KIND_CONFIG)[number]["field"], kind: TierTaxonomyKind) => {
    const all = options[kind];
    setTags(
      field,
      [...all].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    );
  };

  return (
    <section className="admin-pkg-builder__tags" aria-label="Package type taxonomy tags">
      <div className="admin-pkg-builder__tags-head">
        <h4 className="admin-pkg-builder__tags-title">{sectionTitle}</h4>
        <p className="admin-pkg-builder__tags-lead">{sectionLead}</p>
      </div>
      <div className="admin-pkg-builder__tags-grid">
        {KIND_CONFIG.map(({ kind, label, hint, field, pillClass }) => {
          const selected = tagsForKind(kind, tagProps);
          const available = options[kind].filter(
            (opt) =>
              !selected.some((t) => t.localeCompare(opt, undefined, { sensitivity: "base" }) === 0)
          );
          const selectId = `pkg-type-${kind}-tag-add`;
          const allSelected = available.length === 0 && options[kind].length > 0;
          return (
            <div key={kind} className={`admin-pkg-builder__tag-group admin-pkg-builder__tag-group--${kind}`}>
              <div className="admin-pkg-builder__tag-group-head">
                <div className="admin-pkg-builder__tag-group-copy">
                  <span className="admin-pkg-builder__tag-group-label">{label}</span>
                  <span className="admin-pkg-builder__tag-group-hint">{hint}</span>
                </div>
                <button
                  type="button"
                  className={`admin-pkg-builder__tag-select-all admin-pkg-builder__tag-select-all--${kind}`}
                  disabled={disabled || options[kind].length === 0 || allSelected}
                  onClick={() => selectAllTags(field, kind)}
                >
                  Select all
                </button>
              </div>
              <div className="admin-pkg-builder__tag-pills" role="list" aria-label={`${label} tags`}>
                {selected.length === 0 ? (
                  <span className="admin-pkg-builder__tag-empty">None selected</span>
                ) : (
                  selected.map((tag) => (
                    <span key={tag} className={`admin-pkg-builder__taxonomy-pill ${pillClass}`} role="listitem">
                      {tag}
                      <button
                        type="button"
                        className="admin-pkg-builder__taxonomy-pill-remove"
                        disabled={disabled}
                        aria-label={`Remove ${label.toLowerCase()} tag ${tag}`}
                        onClick={() => removeTag(field, kind, tag)}
                      >
                        ×
                      </button>
                    </span>
                  ))
                )}
              </div>
              <label className="admin-pkg-builder__tag-add" htmlFor={selectId}>
                <span className="admin-pkg-builder__tag-add-label">Add {label.toLowerCase()}</span>
                <div className="admin-pkg-builder__tag-add-control">
                  <select
                    id={selectId}
                    className="admin-pkg-builder__tag-add-select"
                    disabled={disabled || available.length === 0}
                    defaultValue=""
                    onChange={(e) => {
                      const value = e.target.value;
                      if (value) addTag(field, kind, value);
                      e.target.value = "";
                    }}
                  >
                    <option value="">
                      {available.length === 0 ? "All options added" : "Choose…"}
                    </option>
                    {available.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                </div>
              </label>
            </div>
          );
        })}
      </div>
    </section>
  );
}
