import type { PricingHourGroupKey } from "../types";

export const PRICING_HOUR_GROUP_KEYS: PricingHourGroupKey[] = [
  "client_services",
  "copy",
  "design",
  "web_dev",
  "video",
  "data",
  "paid_media",
  "hubspot",
  "other",
];

const LABELS: Record<PricingHourGroupKey, string> = {
  client_services: "Client services",
  copy: "Copy",
  design: "Design",
  web_dev: "Web dev",
  video: "Video",
  data: "Data",
  paid_media: "Paid media",
  hubspot: "HubSpot",
  other: "Other",
};

export function pricingHourGroupLabel(k: PricingHourGroupKey): string {
  return LABELS[k] ?? k;
}
