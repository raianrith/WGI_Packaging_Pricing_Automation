import type { TaskGroupLineRow, TaskRow } from "../types";

/** Mutable task columns derived from a template line (for insert or update). */
export type ResolvedTemplateTaskFields = Pick<
  TaskRow,
  "task_name" | "task_implementer" | "task_time" | "task_duration" | "task_dependencies" | "task_notes"
>;

export function resolveTemplateLineToTaskFields(
  line: TaskGroupLineRow,
  allTasks: TaskRow[]
): ResolvedTemplateTaskFields | { error: string } {
  if (line.line_type === "copy_from_task" && line.source_task_id) {
    const src = allTasks.find((t) => t.task_id === line.source_task_id);
    if (!src) {
      return {
        error: `Template line references missing task ${line.source_task_id}. Refresh data or fix the template.`,
      };
    }
    return {
      task_name: src.task_name,
      task_implementer: src.task_implementer,
      task_time: src.task_time,
      task_duration: src.task_duration,
      task_dependencies: src.task_dependencies,
      task_notes: src.task_notes,
    };
  }
  return {
    task_name: line.task_name.trim(),
    task_implementer: line.task_implementer?.trim() ? line.task_implementer.trim() : null,
    task_time: line.hours,
    task_duration: null,
    task_dependencies: null,
    task_notes: null,
  };
}
