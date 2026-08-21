/** Admin URL → internal section ids (preserves every legacy Admin capability). */

export type AdminSectionId =
  | "vault"
  | "packages"
  | "task-groups"
  | "taxonomy"
  | "implementers"
  | "pricing"
  | "health"
  | "glossary"
  | "audit"
  | "users";

/** Create / update / configurable slots — used by Vault + Packages. */
export type AdminModeId = "create" | "update" | "slots";

export type AdminNavItem = {
  id: AdminSectionId;
  label: string;
  hint: string;
};

export type AdminNavGroup = {
  id: string;
  label: string;
  items: AdminNavItem[];
};

export const ADMIN_NAV_GROUPS: AdminNavGroup[] = [
  {
    id: "vault",
    label: "Vault",
    items: [
      {
        id: "vault",
        label: "Solutions & tiers",
        hint: "Solutions, tiers, tasks, and tier pricing",
      },
    ],
  },
  {
    id: "assemblies",
    label: "Assemblies",
    items: [
      {
        id: "packages",
        label: "Packages",
        hint: "Preset packages and configurable slot limits",
      },
      {
        id: "task-groups",
        label: "Task groups",
        hint: "Reusable task templates and sync to tiers",
      },
    ],
  },
  {
    id: "system",
    label: "System",
    items: [
      {
        id: "implementers",
        label: "Implementer mapping",
        hint: "Map implementers to pricing hour groups",
      },
      {
        id: "taxonomy",
        label: "Phase / category / tactic",
        hint: "Taxonomy lists used on tiers",
      },
      {
        id: "pricing",
        label: "Pricing math",
        hint: "Hourly rate, multipliers, recalculate all",
      },
      {
        id: "health",
        label: "Data health",
        hint: "Find tiers where tasks and pricing disagree",
      },
      {
        id: "glossary",
        label: "Data glossary",
        hint: "Column meanings for imports and tables",
      },
    ],
  },
  {
    id: "ops",
    label: "Ops",
    items: [
      {
        id: "audit",
        label: "Change history",
        hint: "Audit log of Admin writes",
      },
      {
        id: "users",
        label: "Active users",
        hint: "Who is signed in right now",
      },
    ],
  },
];

export function adminPath(section: AdminSectionId, mode?: AdminModeId | null): string {
  if (section === "vault") {
    if (mode === "create") return "/admin/vault/create";
    return "/admin/vault";
  }
  if (section === "packages") {
    if (mode === "create") return "/admin/packages/create";
    if (mode === "slots") return "/admin/packages/slots";
    return "/admin/packages";
  }
  return `/admin/${section}`;
}

export function parseAdminLocation(pathname: string): {
  section: AdminSectionId;
  mode: AdminModeId;
} {
  const raw = pathname.replace(/^\/admin\/?/, "").replace(/\/+$/, "");
  const [seg0, seg1] = raw.split("/").filter(Boolean);
  const section = (seg0 as AdminSectionId | undefined) ?? "vault";
  const known: AdminSectionId[] = [
    "vault",
    "packages",
    "task-groups",
    "taxonomy",
    "implementers",
    "pricing",
    "health",
    "glossary",
    "audit",
    "users",
  ];
  const safeSection = known.includes(section) ? section : "vault";

  let mode: AdminModeId = "update";
  if (safeSection === "vault") {
    mode = seg1 === "create" ? "create" : "update";
  } else if (safeSection === "packages") {
    if (seg1 === "create") mode = "create";
    else if (seg1 === "slots") mode = "slots";
    else mode = "update";
  }

  return { section: safeSection, mode };
}
