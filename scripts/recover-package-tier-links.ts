/**
 * Analyze audit_log + current package_solution_tiers and restore missing links.
 *
 * Usage:
 *   npx tsx scripts/recover-package-tier-links.ts           # dry-run (report only)
 *   npx tsx scripts/recover-package-tier-links.ts --apply   # insert missing links
 *
 * Requires .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

type AuditRow = {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
  created_at: string;
  changed_by_email: string | null;
};

type PackageRow = { package_id: string; package_name: string };
type LinkRow = {
  package_id: string;
  solution_tier_id: string;
  quantity?: number | null;
  tier_overrides?: unknown;
  pricing_overrides?: unknown;
  task_overrides?: unknown;
  task_extensions?: unknown;
};

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(path)) return out;
  const raw = readFileSync(path, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i <= 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function tierIdsFromSnap(snap: Record<string, unknown> | null | undefined): string[] {
  if (!snap) return [];
  const raw = snap.solution_tier_ids;
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string" && x.trim().length > 0);
}

function quantitiesFromSnap(snap: Record<string, unknown> | null | undefined): Record<string, number> {
  if (!snap) return {};
  const raw = snap.solution_tier_quantities;
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n) && n >= 1) out[k] = Math.floor(n);
  }
  return out;
}

function linkKey(packageId: string, tierId: string): string {
  return `${packageId}\0${tierId}`;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const env = { ...loadEnvFile(resolve(root, ".env")), ...process.env };
  const url = env.VITE_SUPABASE_URL?.trim();
  const key = env.VITE_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    console.error("Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env");
    process.exit(1);
  }

  const client = createClient(url, key);

  const [pkgRes, linkRes, auditRes, tierRes] = await Promise.all([
    client.from("packages").select("package_id, package_name").order("package_id"),
    client.from("package_solution_tiers").select("*").order("package_id"),
    client
      .from("audit_log")
      .select("id, entity_type, entity_id, action, before_data, after_data, created_at, changed_by_email")
      .eq("entity_type", "packages")
      .order("created_at", { ascending: true })
      .limit(5000),
    client.from("solution_tiers").select("solution_tier_id, solution_tier_name").order("solution_tier_id"),
  ]);

  if (pkgRes.error) throw new Error(pkgRes.error.message);
  if (linkRes.error) throw new Error(linkRes.error.message);
  if (auditRes.error) throw new Error(auditRes.error.message);
  if (tierRes.error) throw new Error(tierRes.error.message);

  const packages = (pkgRes.data ?? []) as PackageRow[];
  const packageIdSet = new Set(packages.map((p) => p.package_id));
  const currentLinks = (linkRes.data ?? []) as LinkRow[];
  const auditRows = (auditRes.data ?? []) as AuditRow[];
  const tiers = tierRes.data ?? [];
  const tierName = new Map(tiers.map((t) => [t.solution_tier_id, t.solution_tier_name]));
  const pkgName = new Map(packages.map((p) => [p.package_id, p.package_name]));

  const currentByPkg = new Map<string, Set<string>>();
  const currentLinkRows = new Map<string, LinkRow>();
  for (const row of currentLinks) {
    const set = currentByPkg.get(row.package_id) ?? new Set<string>();
    set.add(row.solution_tier_id);
    currentByPkg.set(row.package_id, set);
    currentLinkRows.set(linkKey(row.package_id, row.solution_tier_id), row);
  }

  /** Best-known tier set per package from audit history (latest non-delete snapshot). */
  const auditLatestByPkg = new Map<string, { tierIds: string[]; quantities: Record<string, number>; at: string; action: string }>();
  /** Every tier id ever recorded for a package in audit (union). */
  const auditUnionByPkg = new Map<string, Set<string>>();

  for (const row of auditRows) {
    const pid = row.entity_id;
    const snap =
      row.action === "delete"
        ? (row.before_data as Record<string, unknown> | null)
        : (row.after_data as Record<string, unknown> | null);
    const ids = tierIdsFromSnap(snap);
    const qty = quantitiesFromSnap(snap);
    if (ids.length === 0) continue;

    const union = auditUnionByPkg.get(pid) ?? new Set<string>();
    for (const id of ids) union.add(id);
    auditUnionByPkg.set(pid, union);

    if (row.action !== "delete") {
      auditLatestByPkg.set(pid, {
        tierIds: ids,
        quantities: qty,
        at: row.created_at,
        action: row.action,
      });
    }
  }

  /** Links to restore: package had tiers in latest audit but missing now. */
  const toRestore: { package_id: string; solution_tier_id: string; quantity: number; reason: string }[] = [];

  for (const [pid, snap] of auditLatestByPkg) {
    const current = currentByPkg.get(pid) ?? new Set<string>();
    for (const tid of snap.tierIds) {
      if (current.has(tid)) continue;
      toRestore.push({
        package_id: pid,
        solution_tier_id: tid,
        quantity: snap.quantities[tid] ?? 1,
        reason: `Missing vs latest audit ${snap.action} @ ${snap.at}`,
      });
    }
  }

  /** Packages with zero tiers: restore full latest audit set. */
  for (const pkg of packages) {
    const current = currentByPkg.get(pkg.package_id) ?? new Set<string>();
    if (current.size > 0) continue;
    const snap = auditLatestByPkg.get(pkg.package_id);
    if (!snap) continue;
    for (const tid of snap.tierIds) {
      toRestore.push({
        package_id: pkg.package_id,
        solution_tier_id: tid,
        quantity: snap.quantities[tid] ?? 1,
        reason: `Empty package; restore from latest audit @ ${snap.at}`,
      });
    }
  }

  /** Dedupe restore list (prefer latest audit quantity). */
  const restoreDeduped = new Map<string, (typeof toRestore)[number]>();
  for (const r of toRestore) {
    const k = linkKey(r.package_id, r.solution_tier_id);
    if (!restoreDeduped.has(k)) restoreDeduped.set(k, r);
  }
  const restoreList = [...restoreDeduped.values()]
    .filter((r) => packageIdSet.has(r.package_id))
    .sort((a, b) =>
      a.package_id.localeCompare(b.package_id) || a.solution_tier_id.localeCompare(b.solution_tier_id)
    );

  const skippedDeletedPackages = [...restoreDeduped.values()].filter(
    (r) => !packageIdSet.has(r.package_id)
  );
  const skippedDeletedPackageIds = [...new Set(skippedDeletedPackages.map((r) => r.package_id))];

  const report = {
    generatedAt: new Date().toISOString(),
    mode: apply ? "apply" : "dry-run",
    packageCount: packages.length,
    currentLinkCount: currentLinks.length,
    auditPackageRows: auditRows.length,
    packagesWithNoTiersNow: packages
      .filter((p) => !(currentByPkg.get(p.package_id)?.size ?? 0))
      .map((p) => ({ package_id: p.package_id, package_name: p.package_name })),
    skippedDeletedPackageIds,
    restoreCandidates: restoreList.map((r) => ({
      ...r,
      package_name: pkgName.get(r.package_id) ?? r.package_id,
      tier_name: tierName.get(r.solution_tier_id) ?? r.solution_tier_id,
    })),
  };

  const outPath = resolve(root, "scripts/recover-package-tier-links-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log(`\n=== Package tier link recovery (${apply ? "APPLY" : "dry-run"}) ===\n`);
  console.log(`Packages: ${packages.length}, current links: ${currentLinks.length}`);
  console.log(`Packages with NO tiers now: ${report.packagesWithNoTiersNow.length}`);
  console.log(`Restore candidates: ${restoreList.length}`);
  if (skippedDeletedPackageIds.length > 0) {
    console.log(
      `Skipped ${skippedDeletedPackages.length} link(s) for deleted package(s): ${skippedDeletedPackageIds.join(", ")}`
    );
  }
  console.log(`Report written: ${outPath}\n`);

  if (report.packagesWithNoTiersNow.length > 0) {
    console.log("Packages currently missing all tiers:");
    for (const p of report.packagesWithNoTiersNow) {
      const audit = auditLatestByPkg.get(p.package_id);
      console.log(
        `  - ${p.package_name} (${p.package_id})` +
          (audit ? ` — audit had ${audit.tierIds.length} tier(s) @ ${audit.at}` : " — no audit tier snapshot")
      );
    }
    console.log("");
  }

  if (restoreList.length === 0) {
    console.log("Nothing to restore from audit_log package snapshots.");
    console.log(
      "If tiers are still wrong, check Supabase point-in-time recovery or re-link manually in Package Builder."
    );
    return;
  }

  console.log("Links to restore:");
  for (const r of report.restoreCandidates) {
    console.log(
      `  + ${r.package_name} ← ${r.tier_name} (${r.solution_tier_id}) qty ${r.quantity}  [${r.reason}]`
    );
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to insert missing links.");
    console.log("IMPORTANT: Run supabase/package_solution_tiers_allow_shared_tiers.sql first");
    console.log("so the same tier can exist on multiple packages.\n");
    return;
  }

  console.log("\nApplying restores (requires shared-tier migration in Supabase)...\n");

  let inserted = 0;
  let skipped = 0;
  let failed = 0;

  for (const r of restoreList) {
    const k = linkKey(r.package_id, r.solution_tier_id);
    if (currentLinkRows.has(k)) {
      skipped += 1;
      continue;
    }
    const payload: Record<string, unknown> = {
      package_id: r.package_id,
      solution_tier_id: r.solution_tier_id,
      quantity: r.quantity,
      tier_overrides: {},
      pricing_overrides: {},
      task_overrides: {},
      task_extensions: { sections: [], unsectioned: [] },
    };
    const { error } = await client.from("package_solution_tiers").insert(payload);
    if (error) {
      console.error(`  FAIL ${r.package_id} + ${r.solution_tier_id}: ${error.message}`);
      failed += 1;
    } else {
      inserted += 1;
    }
  }

  console.log(`\nDone: inserted ${inserted}, skipped ${skipped}, failed ${failed}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
