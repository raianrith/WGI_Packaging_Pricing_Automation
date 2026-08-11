import { useCallback, useEffect, useMemo, useState } from "react";
import type { CatalogTierTableRow } from "../components/CatalogTierTable";
import { buildCatalogTierTableRows } from "../lib/buildCatalogTierTableRows";
import { compareTasksByOrder } from "../lib/taskOrder";
import { fetchAllTaskRows } from "../lib/taskIds";
import { filterPresetPackages } from "../lib/presetPackages";
import type { PackageMigrationRow } from "../lib/packageMigrations";
import {
  browserKeyConfigurationError,
  envConfigured,
  getSupabase,
} from "../lib/supabase";
import type {
  Package,
  PackageBuilderPackageType,
  PackageBuilderSlotTemplate,
  PackageSolutionTier,
  Solution,
  SolutionTier,
  SolutionTierPricing,
  TaskRow,
} from "../types";
import { fetchPackageBuilderCatalog } from "../lib/packageBuilderSlots";

function sortId(a: string, b: string): number {
  const pa = a.split("-").map(Number);
  const pb = b.split("-").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na !== nb) return na - nb;
  }
  return a.localeCompare(b);
}

export type VaultCatalogLoadState =
  | { status: "idle" | "loading" }
  | { status: "error"; message: string }
  | {
      status: "ok";
      rows: CatalogTierTableRow[];
      packageTypes: PackageBuilderPackageType[];
      packageBuilderSlots: PackageBuilderSlotTemplate[];
      presetPackages: Package[];
      packageMigrations: PackageMigrationRow[];
      tiers: SolutionTier[];
    };

export function useVaultCatalogRows(): VaultCatalogLoadState & { reload: () => void } {
  const [state, setState] = useState<VaultCatalogLoadState>({ status: "idle" });

  const load = useCallback(async () => {
    const keyErr = browserKeyConfigurationError();
    if (keyErr) {
      setState({ status: "error", message: keyErr });
      return;
    }
    if (!envConfigured()) {
      setState({
        status: "error",
        message:
          "Create a .env file in the project root with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example).",
      });
      return;
    }
    const client = getSupabase();
    if (!client) {
      setState({
        status: "error",
        message:
          "Supabase URL and anon key are missing. Add .env with VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.",
      });
      return;
    }

    setState({ status: "loading" });

    const [pRes, sRes, tRes, tasksPack, prRes, ptRes, migRes, builderPack] = await Promise.all([
      client.from("packages").select("*").order("package_id"),
      client.from("solutions").select("*").order("solution_id"),
      client.from("solution_tiers").select("*").order("solution_tier_id"),
      fetchAllTaskRows(client),
      client.from("solution_tier_pricing").select("*").order("solution_tier_id"),
      client.from("package_solution_tiers").select("*").order("package_id"),
      client.from("package_migrations").select("*").order("former_package_id"),
      fetchPackageBuilderCatalog(client),
    ]);

    const err =
      pRes.error || sRes.error || tRes.error || tasksPack.error || prRes.error || ptRes.error
        ? [pRes.error, sRes.error, tRes.error, tasksPack.error ? { message: tasksPack.error } : null, prRes.error, ptRes.error].find(Boolean)
        : null;

    if (err) {
      let extra = "";
      const m = err.message;
      if (m.includes("permission") || m.includes("RLS")) {
        extra =
          " — Check Row Level Security: allow SELECT for anon (or sign-in) on packages, solutions, solution_tiers, package_solution_tiers, tasks, and solution_tier_pricing.";
      }
      if (/forbidden/i.test(m) && /secret/i.test(m)) {
        extra =
          " — Use the anon public key in .env (VITE_SUPABASE_ANON_KEY), not the service_role secret. Restart the dev server after changing .env.";
      }
      setState({ status: "error", message: m + extra });
      return;
    }

    const packages = (pRes.data ?? []) as Package[];
    const solutions = (sRes.data ?? []) as Solution[];
    const tiers = (tRes.data ?? []) as SolutionTier[];
    const packageTiers = (ptRes.data ?? []) as PackageSolutionTier[];
    const tasks = tasksPack.rows;
    const pricing = prRes.error
      ? ([] as SolutionTierPricing[])
      : ((prRes.data ?? []) as SolutionTierPricing[]);

    packages.sort((a, b) => sortId(a.package_id, b.package_id));
    solutions.sort((a, b) => sortId(a.solution_id, b.solution_id));
    tiers.sort((a, b) => sortId(a.solution_tier_id, b.solution_tier_id));
    tasks.sort((a, b) => {
      const tc = sortId(a.solution_tier_id, b.solution_tier_id);
      if (tc !== 0) return tc;
      return compareTasksByOrder(a, b);
    });

    const rows = buildCatalogTierTableRows({
      packages,
      solutions,
      tiers,
      packageTiers,
      tasks,
      pricing,
    });

    const presetPackages = filterPresetPackages(packages, builderPack.catalog.types);

    const packageMigrations = migRes.error ? [] : ((migRes.data ?? []) as PackageMigrationRow[]);

    setState({
      status: "ok",
      rows,
      packageTypes: builderPack.catalog.types,
      packageBuilderSlots: builderPack.catalog.slots,
      presetPackages,
      packageMigrations,
      tiers,
    });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return useMemo(
    () => ({
      ...state,
      reload: () => {
        void load();
      },
    }),
    [state, load]
  );
}
