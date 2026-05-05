import type { TaskGroupLineRow, TaskGroupRow } from "../types";

/** Synthetic task id prefix for archetype lines exposed in the copy-from picker. */
export const TASK_GROUP_TEMPLATE_LINE_PREFIX = "tg-line:" as const;

export type TemplateLinePickerMeta = {
  /** e.g. Template Line from "Standard Flow" */
  headline: string;
  /** Short group name for the tier column */
  groupName: string;
};

export function buildTemplateLinePickerMeta(
  taskGroups: TaskGroupRow[],
  taskGroupLines: TaskGroupLineRow[]
): Map<string, TemplateLinePickerMeta> {
  const nameById = new Map<string, string>();
  for (const g of taskGroups) {
    nameById.set(g.id, (g.name ?? "").trim() || "Task group");
  }
  const m = new Map<string, TemplateLinePickerMeta>();
  for (const line of taskGroupLines) {
    if (line.source_task_id?.trim()) continue;
    if (!line.task_name.trim()) continue;
    const groupName = nameById.get(line.task_group_id) ?? "Task group";
    m.set(`${TASK_GROUP_TEMPLATE_LINE_PREFIX}${line.id}`, {
      headline: `Template Line from "${groupName}"`,
      groupName,
    });
  }
  return m;
}
