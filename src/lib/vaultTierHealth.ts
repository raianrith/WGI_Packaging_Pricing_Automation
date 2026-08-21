import { buildImplementerToGroupMap, rollUpTaskTimesByPricingGroup } from "./taskHoursRollup";
import type { ImplementerHourGroupRow, SolutionTierPricing, TaskRow } from "../types";

export type VaultTierHealthKind =
  | "ok"
  | "pricing_no_tasks"
  | "tasks_no_pricing"
  | "hours_mismatch";

export type VaultTierHealth = {
  kind: VaultTierHealthKind;
  label: string;
  detail: string;
};

function hoursClose(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.05;
}

export function computeVaultTierHealth(params: {
  tierId: string;
  tasks: TaskRow[];
  pricing: SolutionTierPricing | null | undefined;
  implementerHourGroups: ImplementerHourGroupRow[];
}): VaultTierHealth {
  const list = params.tasks.filter((t) => t.solution_tier_id === params.tierId);
  const pricing = params.pricing ?? null;
  const taskCount = list.length;

  if (pricing && taskCount === 0) {
    const sell =
      pricing.sell_price != null
        ? `sell $${Math.round(Number(pricing.sell_price)).toLocaleString()}`
        : "pricing row";
    return {
      kind: "pricing_no_tasks",
      label: "Price, no tasks",
      detail: `Has ${sell} but 0 vault tasks.`,
    };
  }

  if (!pricing && taskCount > 0) {
    return {
      kind: "tasks_no_pricing",
      label: "Tasks, no price",
      detail: `${taskCount} task(s) but no pricing row.`,
    };
  }

  if (pricing && taskCount > 0 && params.implementerHourGroups.length > 0) {
    const map = buildImplementerToGroupMap(params.implementerHourGroups);
    const roll = rollUpTaskTimesByPricingGroup(list, map);
    const rollTotal =
      roll.client_services +
      roll.copy +
      roll.design +
      roll.web_dev +
      roll.video +
      roll.data +
      roll.paid_media +
      roll.hubspot +
      roll.other;
    const storedTotal = Number(pricing.total_hours ?? 0);
    if (!hoursClose(storedTotal, rollTotal)) {
      return {
        kind: "hours_mismatch",
        label: "Hours drift",
        detail: `Stored ${Math.round(storedTotal * 10) / 10}h vs tasks ${Math.round(rollTotal * 10) / 10}h.`,
      };
    }
  }

  return { kind: "ok", label: "OK", detail: "Tasks and pricing look aligned." };
}

export function vaultPathForTier(tierId: string, tab: "overview" | "tasks" | "pricing" = "overview"): string {
  const q = new URLSearchParams();
  q.set("tier", tierId.trim());
  q.set("tab", tab);
  return `/admin/vault?${q.toString()}`;
}
