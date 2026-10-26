/** Hide throwaway vault names from the proposal re-use list without deleting them. */
export function isJunkReusePackageName(name: string): boolean {
  const n = name.trim().toLowerCase();
  if (!n) return true;
  if (/^test(\s|$)/.test(n)) return true;
  if (/test playbook/.test(n)) return true;
  if (/^(sadsdadas|efdsf|asdf|qwerty|xxx+|junk|tmp|temp)\b/.test(n)) return true;
  if (n.length <= 4 && !/\s/.test(n) && !/[aeiou]/i.test(n)) return true;
  return false;
}

export function formatPackageReuseDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
