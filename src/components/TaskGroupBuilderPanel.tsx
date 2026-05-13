import { useCallback, useEffect, useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UniqueIdentifier } from "@dnd-kit/core";
import { insertAuditLog } from "../lib/audit";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";
import { getSupabase } from "../lib/supabase";
import { normalizeTierPricingMathConfig, type TierPricingMathConfig } from "../lib/tierPricingMath";
import { buildSolutionTierPricingMathUpdate } from "../lib/recomputeStoredTierPricing";
import { buildImplementerToGroupMap, rollUpTaskTimesByPricingGroup } from "../lib/taskHoursRollup";
import {
  buildTemplateLinePickerMeta,
  TASK_GROUP_TEMPLATE_LINE_PREFIX,
  type TemplateLinePickerMeta,
} from "../lib/taskGroupTemplatePicker";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { syncTaskGroupTemplateToAppliedTiers } from "../lib/syncTaskGroupTemplateToAppliedTiers";
import { TaskImplementerSelect } from "./TaskImplementerSelect";
import { SortableTableRowTr, TaskSortableList } from "./TaskTableSortable";
import type {
  ImplementerHourGroupRow,
  Solution,
  SolutionTier,
  SolutionTierTaskGroupApplied,
  SolutionTierPricing,
  TaskGroupLineRow,
  TaskGroupLineType,
  TaskGroupRow,
  TaskRow,
} from "../types";

function sortTierIdKey(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true });
}

function rowJson(row: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
}

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "" || t.toLowerCase() === "n/a") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

type Props = {
  tasks: TaskRow[];
  tiers: SolutionTier[];
  solutions: Solution[];
  implementerHourGroups: ImplementerHourGroupRow[];
  tierPricing: SolutionTierPricing[];
  tierPricingMathConfig: TierPricingMathConfig;
  taskGroups: TaskGroupRow[];
  taskGroupLines: TaskGroupLineRow[];
  /** Rows from `solution_tier_task_group_applied` (template applied to tier). */
  taskGroupApplied: SolutionTierTaskGroupApplied[];
  loadNote: string | null;
  onRefresh: () => Promise<void>;
  setOpErr: (s: string | null) => void;
  setOpOk: (s: string | null) => void;
  logAudit: (
    client: SupabaseClient,
    p: Parameters<typeof insertAuditLog>[1]
  ) => Promise<void>;
  panel: CSSProperties;
  h2: CSSProperties;
  muted: CSSProperties;
  lbl: CSSProperties;
  input: CSSProperties;
  btn: CSSProperties;
  btnPrimary: CSSProperties;
  btnDangerSm: CSSProperties;
  tbl: CSSProperties;
  th: CSSProperties;
  td: CSSProperties;
};

type LineDraftItem =
  | { key: string; line_type: "archetype"; name: string; implementer: string; hours: string }
  | { key: string; line_type: "copy_from_task"; taskId: string };

type AddLineMode = "archetype" | "copy_from_task";

function tierContextLabel(
  k: TaskRow,
  tierList: SolutionTier[],
  solutionList: Solution[]
): { label: string; title: string } {
  const t = tierList.find((x) => x.solution_tier_id === k.solution_tier_id);
  if (!t) {
    return { label: k.solution_tier_id, title: `Unknown tier id: ${k.solution_tier_id}` };
  }
  const sol = solutionList.find((s) => s.solution_id === t.solution_id);
  const solName = sol?.solution_name?.trim() || t.solution_id;
  const label = `${t.solution_tier_name} · ${solName}`;
  return {
    label,
    title: `Tier: ${k.solution_tier_id} (${t.solution_tier_name}) — Solution: ${t.solution_id}${sol ? ` (${sol.solution_name})` : ""}`,
  };
}

type TaskLinkPickerProps = {
  search: string;
  onSearch: (q: string) => void;
  selectedTaskId: string;
  onSelect: (taskId: string) => void;
  filteredTasks: TaskRow[];
  tiers: SolutionTier[];
  solutions: Solution[];
  isRowDisabled: (k: TaskRow) => boolean;
  disabled: boolean;
  inputStyle: CSSProperties;
  mutedStyle: CSSProperties;
  templateLineMeta?: Map<string, TemplateLinePickerMeta>;
};

function TaskLinkPicker({
  search,
  onSearch,
  selectedTaskId,
  onSelect,
  filteredTasks,
  tiers: tierList,
  solutions: solutionList,
  isRowDisabled,
  disabled,
  inputStyle,
  mutedStyle,
  templateLineMeta,
}: TaskLinkPickerProps) {
  return (
    <div className="admin-tg-task-picker">
      <input
        type="search"
        className="admin-tg-task-picker__search"
        style={inputStyle}
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search id, name, tier, implementer…"
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
      />
      <ul className="admin-tg-task-picker__list" role="listbox" aria-label="Task search results">
        {filteredTasks.length === 0 ? (
          <li className="admin-tg-task-picker__empty" style={mutedStyle}>
            No tasks match. Clear the search or try different words.
          </li>
        ) : (
          filteredTasks.map((k) => {
            const isDis = isRowDisabled(k) || disabled;
            const isSel = selectedTaskId === k.task_id;
            const tmpl = templateLineMeta?.get(k.task_id);
            const ctx = tmpl
              ? { label: tmpl.groupName, title: `Template line from task group “${tmpl.groupName}”` }
              : tierContextLabel(k, tierList, solutionList);
            const tierLabel = ctx.label;
            const tierTitle = ctx.title;
            const idLabel = tmpl?.headline ?? k.task_id;
            return (
              <li key={k.task_id} className="admin-tg-task-picker__li">
                <button
                  type="button"
                  className={
                    isDis
                      ? "admin-tg-task-picker__row admin-tg-task-picker__row--disabled"
                      : isSel
                        ? "admin-tg-task-picker__row admin-tg-task-picker__row--selected"
                        : "admin-tg-task-picker__row"
                  }
                  onClick={() => {
                    if (!isDis) onSelect(k.task_id);
                  }}
                  disabled={isDis}
                >
                  <div className="admin-tg-task-picker__row-top">
                    {tmpl ? (
                      <span className="admin-tg-task-picker__id admin-tg-task-picker__id--template">{idLabel}</span>
                    ) : (
                      <code className="admin-tg-task-picker__id">{idLabel}</code>
                    )}
                  </div>
                  <div className="admin-tg-task-picker__row-bottom">
                    <span className="admin-tg-task-picker__name">{k.task_name}</span>
                    <span className="admin-tg-task-picker__tier" title={tierTitle}>
                      {tierLabel}
                    </span>
                  </div>
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}

function formatTaskGroupLineHours(h: number | null): string {
  if (h == null || !Number.isFinite(h)) return "—";
  if (h % 1 === 0) return String(h);
  return String(Math.round(h * 1000) / 1000);
}

function summarizeDraft(
  d: LineDraftItem,
  tasks: TaskRow[],
  _tiers: SolutionTier[],
  _solutions: Solution[]
): string {
  if (d.line_type === "copy_from_task") {
    const t = tasks.find((k) => k.task_id === d.taskId);
    return t ? `Copy — ${d.taskId} — ${t.task_name}` : `Copy — ${d.taskId}`;
  }
  return `Archetype — ${d.name || "(name)"}`;
}

export function TaskGroupBuilderPanel({
  tasks,
  tiers,
  solutions,
  implementerHourGroups,
  tierPricing,
  tierPricingMathConfig,
  taskGroups,
  taskGroupLines,
  taskGroupApplied,
  loadNote,
  onRefresh,
  setOpErr,
  setOpOk,
  logAudit,
  panel,
  h2,
  muted,
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
  const groupDatalistId = useId();
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [createLineDraft, setCreateLineDraft] = useState<LineDraftItem[]>([]);
  const [addMode, setAddMode] = useState<AddLineMode>("archetype");
  const [archName, setArchName] = useState("");
  const [archImpl, setArchImpl] = useState("");
  const [archHours, setArchHours] = useState("");
  const [linkSearch, setLinkSearch] = useState("");
  const [linkPick, setLinkPick] = useState("");

  const [taskFilter, setTaskFilter] = useState("");
  const [linkPickAdd, setLinkPickAdd] = useState("");

  const [editName, setEditName] = useState("");
  const [editLineId, setEditLineId] = useState<string | null>(null);
  const [editImpl, setEditImpl] = useState("");
  const [editHours, setEditHours] = useState("");

  const [editGroupId, setEditGroupId] = useState<string | null>(null);
  const [editGroupName, setEditGroupName] = useState("");
  const [editGroupDesc, setEditGroupDesc] = useState("");
  const [tierUsageModalGroupId, setTierUsageModalGroupId] = useState<string | null>(null);
  const [syncTemplateModalGroup, setSyncTemplateModalGroup] = useState<TaskGroupRow | null>(null);
  const [syncTemplateSelectedTierIds, setSyncTemplateSelectedTierIds] = useState<string[]>([]);

  const sortedTasks = useMemo(() => {
    const byId = new Map<string, TaskRow>();
    for (const t of tasks) byId.set(t.task_id, t);
    // Include source tasks already referenced by templates even if missing from current vault rows.
    for (const line of taskGroupLines) {
      const sid = line.source_task_id?.trim();
      if (sid && !byId.has(sid)) {
        byId.set(sid, {
          task_id: sid,
          solution_tier_id: "task-group-template",
          task_name: line.task_name?.trim() || sid,
          task_implementer: line.task_implementer ?? null,
          task_time: line.hours ?? null,
          task_duration: null,
          task_dependencies: null,
          task_notes: null,
          task_create_date: "1970-01-01",
          task_modified_date: "1970-01-01",
        });
      }
      // Archetype lines have no source task id; expose them as selectable picker options.
      if (!sid && line.task_name.trim()) {
        const syntheticId = `${TASK_GROUP_TEMPLATE_LINE_PREFIX}${line.id}`;
        if (byId.has(syntheticId)) continue;
        byId.set(syntheticId, {
          task_id: syntheticId,
          solution_tier_id: "task-group-template",
          task_name: line.task_name.trim(),
          task_implementer: line.task_implementer ?? null,
          task_time: line.hours ?? null,
          task_duration: null,
          task_dependencies: null,
          task_notes: null,
          task_create_date: "1970-01-01",
          task_modified_date: "1970-01-01",
        });
      }
    }
    return [...byId.values()].sort((a, b) => a.task_id.localeCompare(b.task_id, undefined, { numeric: true }));
  }, [tasks, taskGroupLines]);

  const templateLinePickerMeta = useMemo(
    () => buildTemplateLinePickerMeta(taskGroups, taskGroupLines),
    [taskGroups, taskGroupLines]
  );

  /** Match Implementer–Pricing mapping only (not every label ever used on tasks). */
  const implementerSelectOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of implementerHourGroups) {
      const n = (r.implementer_name ?? "").trim();
      if (n) seen.add(n);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [implementerHourGroups]);

  const implementerToGroup = useMemo(
    () => buildImplementerToGroupMap(implementerHourGroups),
    [implementerHourGroups]
  );

  const recalcPricingForTiers = useCallback(
    async (tierIds: string[]) => {
      const client = getSupabase();
      if (!client) return { ok: false as const, message: "Supabase client not available." };
      if (tierIds.length === 0) return { ok: true as const, updated: 0, skipped: 0 };

      // Pull fresh tasks after template sync so rollups are accurate.
      const { data: freshTasks, error: tErr } = await client
        .from("tasks")
        .select("*")
        .in("solution_tier_id", tierIds);
      if (tErr) return { ok: false as const, message: friendlyMutationMessage(tErr.message) };

      const byTier = new Map<string, TaskRow[]>();
      for (const raw of freshTasks ?? []) {
        const t = raw as TaskRow;
        const arr = byTier.get(t.solution_tier_id) ?? [];
        arr.push(t);
        byTier.set(t.solution_tier_id, arr);
      }

      const math = normalizeTierPricingMathConfig(tierPricingMathConfig);
      let updated = 0;
      let skipped = 0;

      for (const tid of tierIds) {
        const prev = tierPricing.find((p) => p.solution_tier_id === tid) ?? null;
        if (!prev) {
          skipped += 1;
          continue;
        }
        const list = byTier.get(tid) ?? [];
        const roll = rollUpTaskTimesByPricingGroup(list, implementerToGroup);
        const nextRow: SolutionTierPricing = {
          ...prev,
          hours_client_services: roll.client_services,
          hours_copy: roll.copy,
          hours_design: roll.design,
          hours_web_dev: roll.web_dev,
          hours_video: roll.video,
          hours_data: roll.data,
          hours_paid_media: roll.paid_media,
          hours_hubspot: roll.hubspot,
          hours_other: roll.other,
        };
        const mathUpdate = buildSolutionTierPricingMathUpdate(nextRow, math);
        const { solution_tier_id: _ignore, ...payload } = {
          ...nextRow,
          ...mathUpdate,
        } as Record<string, unknown>;

        const { error: upErr } = await client.from("solution_tier_pricing").update(payload).eq("solution_tier_id", tid);
        if (upErr) return { ok: false as const, message: friendlyMutationMessage(upErr.message) };

        await logAudit(client, {
          entityType: "solution_tier_pricing",
          entityId: tid,
          action: "update",
          before: rowJson(prev),
          after: rowJson({ ...prev, ...payload }),
        });
        updated += 1;
      }

      return { ok: true as const, updated, skipped };
    },
    [implementerToGroup, logAudit, tierPricing, tierPricingMathConfig]
  );

  const filteredForLink = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    if (!q) return sortedTasks;
    return sortedTasks.filter((k) => {
      const tmpl = templateLinePickerMeta.get(k.task_id);
      const metaHay = tmpl ? `${tmpl.headline} ${tmpl.groupName}` : "";
      const { label: tierL } = tierContextLabel(k, tiers, solutions);
      const hay =
        `${k.task_id} ${k.task_name} ${k.solution_tier_id} ${tierL} ${k.task_implementer ?? ""} ${metaHay}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sortedTasks, linkSearch, solutions, tiers, templateLinePickerMeta]);

  const filterAdd = useMemo(() => {
    const q = taskFilter.trim().toLowerCase();
    if (!q) return sortedTasks;
    return sortedTasks.filter((k) => {
      const tmpl = templateLinePickerMeta.get(k.task_id);
      const metaHay = tmpl ? `${tmpl.headline} ${tmpl.groupName}` : "";
      const { label: tierL } = tierContextLabel(k, tiers, solutions);
      const hay =
        `${k.task_id} ${k.task_name} ${k.solution_tier_id} ${tierL} ${k.task_implementer ?? ""} ${metaHay}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sortedTasks, taskFilter, solutions, tiers, templateLinePickerMeta]);

  const linesByGroup = useMemo(() => {
    const m = new Map<string, TaskGroupLineRow[]>();
    for (const l of taskGroupLines) {
      if (!m.has(l.task_group_id)) m.set(l.task_group_id, []);
      m.get(l.task_group_id)!.push(l);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [taskGroupLines]);

  /**
   * Distinct solution tiers that currently have tasks linked to this template.
   *
   * Important: we *do not* count tiers solely from `solution_tier_task_group_applied`, because those rows
   * represent history and can remain after users delete tasks from the tier.
   */
  const tierUsageByTaskGroup = useMemo(() => {
    const tierById = new Map(tiers.map((t) => [t.solution_tier_id, t]));
    const solById = new Map(solutions.map((s) => [s.solution_id, s]));
    const lineIdsByGroup = new Map<string, Set<string>>();
    for (const line of taskGroupLines) {
      if (!lineIdsByGroup.has(line.task_group_id)) lineIdsByGroup.set(line.task_group_id, new Set());
      lineIdsByGroup.get(line.task_group_id)!.add(line.id);
    }

    const tierIdsByGroup = new Map<string, Set<string>>();
    for (const row of taskGroupApplied) {
      const lineIds = lineIdsByGroup.get(row.task_group_id);
      if (!lineIds || lineIds.size === 0) continue;
      // Count this tier only if at least one task in that tier is still linked to this template.
      const hasLinkedTask = tasks.some(
        (t) =>
          t.solution_tier_id === row.solution_tier_id &&
          ((t.task_group_application_id && t.task_group_application_id === row.id) ||
            (t.spawned_from_task_group_line_id && lineIds.has(t.spawned_from_task_group_line_id)))
      );
      if (!hasLinkedTask) continue;
      if (!tierIdsByGroup.has(row.task_group_id)) tierIdsByGroup.set(row.task_group_id, new Set());
      tierIdsByGroup.get(row.task_group_id)!.add(row.solution_tier_id);
    }
    const out = new Map<string, { count: number; items: { id: string; label: string }[] }>();
    for (const [groupId, idSet] of tierIdsByGroup) {
      const ids = [...idSet].sort(sortTierIdKey);
      const items = ids.map((tid) => {
        const t = tierById.get(tid);
        if (!t) return { id: tid, label: `Unknown tier (${tid})` };
        const sol = solById.get(t.solution_id);
        const solPart = sol?.solution_name?.trim() || t.solution_id;
        return {
          id: tid,
          label: `${solPart} — ${t.solution_tier_name}`.trim(),
        };
      });
      out.set(groupId, { count: items.length, items });
    }
    return out;
  }, [taskGroupApplied, taskGroupLines, tasks, tiers, solutions]);

  const syncModalApplyCountByTier = useMemo(() => {
    if (!syncTemplateModalGroup) return new Map<string, number>();
    const m = new Map<string, number>();
    for (const r of taskGroupApplied) {
      if (r.task_group_id !== syncTemplateModalGroup.id) continue;
      m.set(r.solution_tier_id, (m.get(r.solution_tier_id) ?? 0) + 1);
    }
    return m;
  }, [syncTemplateModalGroup, taskGroupApplied]);

  const syncModalTierItems = useMemo(() => {
    if (!syncTemplateModalGroup) return [];
    return tierUsageByTaskGroup.get(syncTemplateModalGroup.id)?.items ?? [];
  }, [syncTemplateModalGroup, tierUsageByTaskGroup]);

  useEffect(() => {
    if (!tierUsageModalGroupId && !syncTemplateModalGroup) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setTierUsageModalGroupId(null);
        setSyncTemplateModalGroup(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tierUsageModalGroupId, syncTemplateModalGroup]);

  const selectedGroup = useMemo(
    () => (selectedGroupId ? taskGroups.find((g) => g.id === selectedGroupId) ?? null : null),
    [taskGroups, selectedGroupId]
  );
  const linesInSelected = selectedGroupId ? linesByGroup.get(selectedGroupId) ?? [] : [];

  const totalLineHours = useMemo(() => {
    const parts = linesInSelected
      .map((l) => l.hours)
      .filter((h): h is number => h != null && Number.isFinite(h));
    if (parts.length === 0) return null;
    return parts.reduce((a, b) => a + b, 0);
  }, [linesInSelected]);

  const nextSortOrder = useCallback(
    (groupId: string) => {
      const lines = linesByGroup.get(groupId) ?? [];
      const max = lines.reduce((m, l) => Math.max(m, l.sort_order), -1);
      return max + 1;
    },
    [linesByGroup]
  );

  const pushError = (msg: string) => {
    setOpErr(friendlyMutationMessage(msg));
  };

  const findPickerTask = useCallback(
    (taskId: string) => sortedTasks.find((t) => t.task_id === taskId),
    [sortedTasks]
  );

  const addDraftToCreate = useCallback(() => {
    setOpErr(null);
    setOpOk(null);
    if (addMode === "archetype") {
      if (!archName.trim()) {
        setOpErr("Task name is required for an archetype line.");
        return;
      }
      setCreateLineDraft((d) => [
        ...d,
        {
          key: crypto.randomUUID(),
          line_type: "archetype",
          name: archName.trim(),
          implementer: archImpl,
          hours: archHours,
        },
      ]);
      setArchName("");
      setArchImpl("");
      setArchHours("");
      setOpOk("Added to new-group draft.");
      return;
    }
    if (!linkPick.trim()) {
      setOpErr("Select a source task to copy from.");
      return;
    }
    if (createLineDraft.some((x) => x.line_type === "copy_from_task" && x.taskId === linkPick)) {
      setOpErr("That task is already in the draft.");
      return;
    }
    if (linkPick.startsWith(TASK_GROUP_TEMPLATE_LINE_PREFIX)) {
      const src = findPickerTask(linkPick);
      if (!src) {
        setOpErr("Selected template task was not found.");
        return;
      }
      setCreateLineDraft((d) => [
        ...d,
        {
          key: crypto.randomUUID(),
          line_type: "archetype",
          name: src.task_name.trim() || "Task",
          implementer: src.task_implementer ?? "",
          hours: src.task_time == null ? "" : String(src.task_time),
        },
      ]);
      setLinkPick("");
      setOpOk("Added task-group line as an archetype draft row.");
      return;
    }
    setCreateLineDraft((d) => [...d, { key: crypto.randomUUID(), line_type: "copy_from_task", taskId: linkPick }]);
    setLinkPick("");
    setOpOk("Added to new-group draft.");
  }, [addMode, archHours, archImpl, archName, createLineDraft, findPickerTask, linkPick, setOpErr, setOpOk]);

  const createGroupWithDraft = useCallback(async () => {
    const n = newGroupName.trim();
    if (!n) {
      setOpErr("Group name is required.");
      return;
    }
    if (taskGroups.some((g) => g.name === n)) {
      setOpErr("A group with that name already exists.");
      return;
    }
    if (createLineDraft.length === 0) {
      setOpErr("Add at least one line to the draft, or create an empty group from SQL.");
      return;
    }
    const client = getSupabase();
    if (!client) return;
    setOpErr(null);
    setOpOk(null);
      setSaving(true);
    try {
      const lineCount = createLineDraft.length;
      const { data: gRow, error: gErr } = await client
        .from("task_groups")
        .insert({ name: n, description: newGroupDescription.trim() || null })
        .select("id")
        .single();
      if (gErr) {
        pushError(gErr.message);
        return;
      }
      const gid = gRow?.id as string;
      await logAudit(client, {
        entityType: "task_groups",
        entityId: gid,
        action: "insert",
        before: null,
        after: { name: n, description: newGroupDescription || null, id: gid },
      });
      let sort = 0;
      for (const d of createLineDraft) {
        if (d.line_type === "archetype") {
          const { data: ins, error: lErr } = await client
            .from("task_group_lines")
            .insert({
              task_group_id: gid,
              sort_order: sort,
              line_type: "archetype" as TaskGroupLineType,
              source_task_id: null,
              task_name: d.name,
              task_implementer: d.implementer.trim() || null,
              hours: parseNum(d.hours),
            })
            .select("id")
            .single();
          if (lErr) {
            pushError(lErr.message);
            return;
          }
          await logAudit(client, {
            entityType: "task_group_lines",
            entityId: String(ins?.id ?? ""),
            action: "insert",
            before: null,
            after: { task_group_id: gid, line_type: "archetype" },
          });
        } else {
          const src = findPickerTask(d.taskId);
          if (!src) {
            pushError(`Source task ${d.taskId} not found.`);
            return;
          }
          const { data: ins, error: lErr } = await client
            .from("task_group_lines")
            .insert({
              task_group_id: gid,
              sort_order: sort,
              line_type: "copy_from_task" as TaskGroupLineType,
              source_task_id: d.taskId,
              task_name: src.task_name,
              task_implementer: src.task_implementer,
              hours: src.task_time,
            })
            .select("id")
            .single();
          if (lErr) {
            pushError(lErr.message);
            return;
          }
          await logAudit(client, {
            entityType: "task_group_lines",
            entityId: String(ins?.id ?? ""),
            action: "insert",
            before: null,
            after: { task_group_id: gid, line_type: "copy_from_task", source_task_id: d.taskId },
          });
        }
        sort += 1;
      }
      setNewGroupName("");
      setNewGroupDescription("");
      setCreateLineDraft([]);
      setOpOk(`Created group “${n}” with ${lineCount} line(s).`);
      notifyPackagingDataChanged();
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }, [
    createLineDraft,
    findPickerTask,
    logAudit,
    newGroupDescription,
    newGroupName,
    onRefresh,
    setOpErr,
    setOpOk,
    taskGroups,
  ]);

  const addLineToSelected = useCallback(async () => {
    if (!selectedGroupId) return;
    const client = getSupabase();
    if (!client) return;
    if (addMode === "archetype") {
      if (!archName.trim()) {
        setOpErr("Task name is required.");
        return;
      }
    } else if (!linkPickAdd.trim()) {
      setOpErr("Select a source task.");
      return;
    }
    setOpErr(null);
    setOpOk(null);
    setSaving(true);
    try {
      const ord = nextSortOrder(selectedGroupId);
      if (addMode === "archetype") {
        const { data, error } = await client
          .from("task_group_lines")
          .insert({
            task_group_id: selectedGroupId,
            sort_order: ord,
            line_type: "archetype",
            source_task_id: null,
            task_name: archName.trim(),
            task_implementer: archImpl.trim() || null,
            hours: parseNum(archHours),
          })
          .select("id")
          .single();
        if (error) {
          pushError(error.message);
          return;
        }
        await logAudit(client, {
          entityType: "task_group_lines",
          entityId: String(data?.id ?? ""),
          action: "insert",
          before: null,
          after: { task_group_id: selectedGroupId, line_type: "archetype" },
        });
        setArchName("");
        setArchImpl("");
        setArchHours("");
      } else {
        if (linkPickAdd.startsWith(TASK_GROUP_TEMPLATE_LINE_PREFIX)) {
          const src = findPickerTask(linkPickAdd);
          if (!src) {
            pushError("Selected template task was not found.");
            return;
          }
          const { data, error } = await client
            .from("task_group_lines")
            .insert({
              task_group_id: selectedGroupId,
              sort_order: ord,
              line_type: "archetype",
              source_task_id: null,
              task_name: src.task_name.trim() || "Task",
              task_implementer: src.task_implementer?.trim() || null,
              hours: src.task_time ?? null,
            })
            .select("id")
            .single();
          if (error) {
            pushError(error.message);
            return;
          }
          setLinkPickAdd("");
          await logAudit(client, {
            entityType: "task_group_lines",
            entityId: String(data?.id ?? ""),
            action: "insert",
            before: null,
            after: { task_group_id: selectedGroupId, line_type: "archetype" },
          });
          setOpOk("Added archetype line from template task.");
          notifyPackagingDataChanged();
          await onRefresh();
          return;
        }
        const src = findPickerTask(linkPickAdd);
        if (!src) {
          pushError("Source task not found.");
          return;
        }
        const { data, error } = await client
          .from("task_group_lines")
          .insert({
            task_group_id: selectedGroupId,
            sort_order: ord,
            line_type: "copy_from_task",
            source_task_id: linkPickAdd,
            task_name: src.task_name,
            task_implementer: src.task_implementer,
            hours: src.task_time,
          })
          .select("id")
          .single();
        if (error) {
          pushError(error.message);
          return;
        }
        setLinkPickAdd("");
        await logAudit(client, {
          entityType: "task_group_lines",
          entityId: String(data?.id ?? ""),
          action: "insert",
          before: null,
          after: { task_group_id: selectedGroupId, line_type: "copy_from_task", source_task_id: linkPickAdd },
        });
      }
      setOpOk("Line added.");
      notifyPackagingDataChanged();
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }, [
    addMode,
    archHours,
    archImpl,
    archName,
    findPickerTask,
    linkPickAdd,
    logAudit,
    nextSortOrder,
    onRefresh,
    selectedGroupId,
  ]);

  const deleteGroup = useCallback(
    async (g: TaskGroupRow) => {
      if (!window.confirm(`Delete the task group “${g.name}” and all of its template lines?`)) return;
      const client = getSupabase();
      if (!client) return;
      setSaving(true);
      setOpErr(null);
      setOpOk(null);
      try {
        const { error } = await client.from("task_groups").delete().eq("id", g.id);
        if (error) {
          pushError(error.message);
          return;
        }
        await logAudit(client, {
          entityType: "task_groups",
          entityId: g.id,
          action: "delete",
          before: rowJson(g),
          after: null,
        });
        if (selectedGroupId === g.id) setSelectedGroupId(null);
        setOpOk("Group deleted.");
        notifyPackagingDataChanged();
        await onRefresh();
      } finally {
        setSaving(false);
      }
    },
    [logAudit, onRefresh, selectedGroupId]
  );

  const openSyncTemplateModal = useCallback(
    (g: TaskGroupRow) => {
      const lines = linesByGroup.get(g.id) ?? [];
      if (lines.length === 0) {
        setOpErr("This task group has no template lines.");
        return;
      }
      const items = tierUsageByTaskGroup.get(g.id)?.items ?? [];
      if (items.length === 0) {
        setOpErr(null);
        setOpOk("No solution tiers have this template applied yet — nothing to update.");
        return;
      }
      setOpErr(null);
      setOpOk(null);
      setSyncTemplateModalGroup(g);
      setSyncTemplateSelectedTierIds(items.map((it) => it.id));
    },
    [linesByGroup, tierUsageByTaskGroup, setOpErr, setOpOk]
  );

  const confirmSyncTemplateToSelectedTiers = useCallback(async () => {
    const g = syncTemplateModalGroup;
    if (!g) return;
    const lines = linesByGroup.get(g.id) ?? [];
    if (lines.length === 0) {
      setOpErr("This task group has no template lines.");
      return;
    }
    if (syncTemplateSelectedTierIds.length === 0) {
      setOpErr("Select at least one solution tier.");
      return;
    }
    setSaving(true);
    setOpErr(null);
    setOpOk(null);
    try {
      const res = await syncTaskGroupTemplateToAppliedTiers({
        task_group_id: g.id,
        lines,
        allTasks: tasks,
        logAudit,
        solutionTierIds: syncTemplateSelectedTierIds,
      });
      if (!res.ok) {
        setOpErr(res.message);
        return;
      }
      const pr = await recalcPricingForTiers(syncTemplateSelectedTierIds);
      if (!pr.ok) {
        setOpErr(`${pr.message} (Tasks were synced; pricing could not be recalculated.)`);
        return;
      }
      let okMsg = `Synced ${res.updated} task row(s) to match the current template.`;
      if (res.skippedSlots > 0) {
        okMsg += ` Skipped ${res.skippedSlots} template slot(s) with no linked task (often applies from before lineage tracking — run supabase/tasks_task_group_lineage.sql in Supabase, or re-apply the group to those tiers).`;
      }
      if (pr.updated > 0) {
        okMsg += ` Recalculated pricing for ${pr.updated} tier(s).`;
      }
      if (pr.skipped > 0) {
        okMsg += ` Skipped pricing for ${pr.skipped} tier(s) with no pricing row yet.`;
      }
      setOpOk(okMsg);
      setSyncTemplateModalGroup(null);
      notifyPackagingDataChanged();
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }, [
    syncTemplateModalGroup,
    syncTemplateSelectedTierIds,
    linesByGroup,
    tasks,
    logAudit,
    recalcPricingForTiers,
    onRefresh,
    setOpErr,
    setOpOk,
  ]);

  const removeLine = useCallback(
    async (r: TaskGroupLineRow) => {
      if (!window.confirm("Remove this line from the template?")) return;
      const client = getSupabase();
      if (!client) return;
      setSaving(true);
      try {
        const { error } = await client.from("task_group_lines").delete().eq("id", r.id);
        if (error) {
          pushError(error.message);
          return;
        }
        await logAudit(client, {
          entityType: "task_group_lines",
          entityId: r.id,
          action: "delete",
          before: rowJson(r),
          after: null,
        });
        if (editLineId === r.id) {
          setEditLineId(null);
        }
        setOpOk("Line removed.");
        notifyPackagingDataChanged();
        await onRefresh();
      } finally {
        setSaving(false);
      }
    },
    [editLineId, logAudit, onRefresh, setOpOk]
  );

  const duplicateLine = useCallback(
    async (r: TaskGroupLineRow) => {
      const client = getSupabase();
      if (!client) return;
      setOpErr(null);
      setOpOk(null);
      setSaving(true);
      try {
        const groupLines = linesByGroup.get(r.task_group_id) ?? [];
        const toBump = groupLines
          .filter((l) => l.sort_order > r.sort_order)
          .sort((a, b) => b.sort_order - a.sort_order);
        for (const l of toBump) {
          const { error } = await client
            .from("task_group_lines")
            .update({ sort_order: l.sort_order + 1 })
            .eq("id", l.id);
          if (error) {
            pushError(error.message);
            return;
          }
        }
        const { data, error } = await client
          .from("task_group_lines")
          .insert({
            task_group_id: r.task_group_id,
            sort_order: r.sort_order + 1,
            line_type: r.line_type,
            source_task_id: r.source_task_id,
            task_name: r.task_name,
            task_implementer: r.task_implementer,
            hours: r.hours,
          })
          .select("id")
          .single();
        if (error) {
          pushError(error.message);
          return;
        }
        await logAudit(client, {
          entityType: "task_group_lines",
          entityId: String(data?.id ?? ""),
          action: "insert",
          before: null,
          after: { task_group_id: r.task_group_id, line_type: r.line_type },
        });
        setOpOk("Line duplicated.");
        notifyPackagingDataChanged();
        await onRefresh();
      } finally {
        setSaving(false);
      }
    },
    [linesByGroup, logAudit, onRefresh, setOpErr, setOpOk]
  );

  const duplicateCreateDraftLine = useCallback((d: LineDraftItem) => {
    setCreateLineDraft((list) => {
      const i = list.findIndex((x) => x.key === d.key);
      if (i === -1) return list;
      const copy: LineDraftItem =
        d.line_type === "archetype"
          ? {
              key: crypto.randomUUID(),
              line_type: "archetype",
              name: d.name,
              implementer: d.implementer,
              hours: d.hours,
            }
          : { key: crypto.randomUUID(), line_type: "copy_from_task", taskId: d.taskId };
      return [...list.slice(0, i + 1), copy, ...list.slice(i + 1)];
    });
  }, []);

  const startEditGroup = (g: TaskGroupRow) => {
    setEditGroupId(g.id);
    setEditGroupName(g.name);
    setEditGroupDesc(g.description ?? "");
  };

  const saveGroupMeta = useCallback(async () => {
    if (!editGroupId) return;
    const name = editGroupName.trim();
    if (!name) {
      setOpErr("Name is required.");
      return;
    }
    if (taskGroups.some((g) => g.id !== editGroupId && g.name === name)) {
      setOpErr("Another group already uses that name.");
      return;
    }
    const client = getSupabase();
    if (!client) return;
    const prev = taskGroups.find((g) => g.id === editGroupId);
    if (!prev) return;
    setSaving(true);
    try {
      const payload = { name, description: editGroupDesc.trim() || null };
      const { error } = await client.from("task_groups").update(payload).eq("id", editGroupId);
      if (error) {
        pushError(error.message);
        return;
      }
      await logAudit(client, {
        entityType: "task_groups",
        entityId: editGroupId,
        action: "update",
        before: rowJson(prev),
        after: rowJson({ ...prev, ...payload }),
      });
      setOpOk("Group updated.");
      setEditGroupId(null);
      notifyPackagingDataChanged();
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }, [editGroupDesc, editGroupId, editGroupName, logAudit, onRefresh, setOpErr, setOpOk, taskGroups]);

  const startEditLine = (r: TaskGroupLineRow) => {
    setOpErr(null);
    setOpOk(null);
    setEditLineId(r.id);
    setEditName(r.task_name);
    setEditImpl(r.task_implementer ?? "");
    setEditHours(r.hours != null ? String(r.hours) : "");
  };

  const saveLine = useCallback(async () => {
    if (!editLineId) return;
    const client = getSupabase();
    if (!client) return;
    const prev = taskGroupLines.find((x) => x.id === editLineId);
    if (!prev) return;
    const n = editName.trim();
    if (!n) {
      setOpErr("Task name is required.");
      return;
    }
    setSaving(true);
    setOpErr(null);
    setOpOk(null);
    try {
      const payload = {
        task_name: n,
        task_implementer: editImpl.trim() || null,
        hours: parseNum(editHours),
      };
      const { error } = await client.from("task_group_lines").update(payload).eq("id", editLineId);
      if (error) {
        pushError(error.message);
        return;
      }
      await logAudit(client, {
        entityType: "task_group_lines",
        entityId: editLineId,
        action: "update",
        before: rowJson(prev),
        after: rowJson({ ...prev, ...payload, id: editLineId }),
      });
      setOpOk("Line updated.");
      setEditLineId(null);
      notifyPackagingDataChanged();
      await onRefresh();
    } finally {
      setSaving(false);
    }
  }, [editHours, editImpl, editLineId, editName, logAudit, onRefresh, setOpErr, setOpOk, taskGroupLines]);

  const dimOverlay = { opacity: 0.45, pointerEvents: "none" as const };
  const dimNewCardWhileEditing = editGroupId || editLineId ? dimOverlay : undefined;
  const dimLinesSectionWhileGroupEdit = editGroupId ? dimOverlay : undefined;
  const dimLinesTableWhileLineEdit = editLineId ? dimOverlay : undefined;

  const editingLineRow = editLineId ? taskGroupLines.find((x) => x.id === editLineId) ?? null : null;

  const reorderSelectedGroupLines = useCallback(
    async (orderedIds: UniqueIdentifier[]) => {
      if (!selectedGroupId) return;
      const client = getSupabase();
      if (!client) return;
      const nextIds = orderedIds.map(String);
      const byId = new Map(linesInSelected.map((line) => [line.id, line]));
      setSaving(true);
      setOpErr(null);
      setOpOk(null);
      try {
        for (let i = 0; i < nextIds.length; i += 1) {
          const id = nextIds[i]!;
          const prev = byId.get(id);
          if (!prev || prev.sort_order === i) continue;
          const { error } = await client
            .from("task_group_lines")
            .update({ sort_order: i })
            .eq("id", id)
            .eq("task_group_id", selectedGroupId);
          if (error) {
            pushError(error.message);
            return;
          }
          await logAudit(client, {
            entityType: "task_group_lines",
            entityId: id,
            action: "update",
            before: rowJson(prev),
            after: rowJson({ ...prev, sort_order: i }),
          });
        }
        setOpOk("Line order updated.");
        notifyPackagingDataChanged();
        await onRefresh();
      } finally {
        setSaving(false);
      }
    },
    [linesInSelected, logAudit, onRefresh, selectedGroupId, setOpErr, setOpOk]
  );

  return (
    <section className="admin-panel admin-panel--editor admin-task-group-builder" style={panel}>
      <div className="admin-editor-layout admin-editor-layout--wide">
        <h2 style={h2}>Task-Group templates</h2>
        <p className="admin-intro" style={muted}>
          <strong>Templates</strong> are reusable line definitions (archetype text or &quot;copy from&quot; an existing
          task). They do <strong>not</strong> create live tier tasks here. In <strong>Solution Builder → Update</strong>,
          use &quot;Apply task group to tier&quot; to insert tasks for the selected tier. Run{" "}
          <code>supabase/task_groups_v2.sql</code> in the SQL editor if these tables are missing.{" "}
          <strong>Implementer</strong> fields are dropdowns: names come from <strong>Implementer–Pricing Mapping</strong>{" "}
          plus any labels already used on tasks.
        </p>
        {editGroupId ? (
          <div className="admin-tg-edit">
            <p className="admin-tg-edit-title">Edit task group</p>
            <div className="admin-tg-fields">
              <label className="admin-tg-field admin-tg-field--full" style={lbl}>
                <span className="admin-field-caption">Name</span>
                <input style={input} value={editGroupName} onChange={(e) => setEditGroupName(e.target.value)} list={groupDatalistId} />
                <datalist id={groupDatalistId}>
                  {taskGroups.map((g) => (
                    <option key={g.id} value={g.name} />
                  ))}
                </datalist>
              </label>
              <label className="admin-tg-field admin-tg-field--full" style={lbl}>
                <span className="admin-field-caption">Description</span>
                <input style={input} value={editGroupDesc} onChange={(e) => setEditGroupDesc(e.target.value)} />
              </label>
            </div>
            <div className="admin-tg-card-actions">
              <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void saveGroupMeta()} disabled={saving}>
                Save
              </button>
              <button
                type="button"
                style={btn}
                onClick={() => {
                  setEditGroupId(null);
                }}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}

        <div className="admin-tg-section">
          <h3 className="admin-tg-section-title">Template groups</h3>
          <div className="admin-table-scroll">
            <table className="admin-data-table" style={tbl}>
              <thead>
                <tr>
                  <th style={th}>Name</th>
                  <th style={th}>Lines</th>
                  <th style={th}>Tiers using</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {taskGroups.length === 0 && !loadNote ? (
                  <tr>
                    <td colSpan={4} style={td}>
                      No task groups. Create one below.
                    </td>
                  </tr>
                ) : null}
                {taskGroups.map((g) => {
                  const tiersUsingCount = tierUsageByTaskGroup.get(g.id)?.count ?? 0;
                  return (
                    <tr key={g.id} style={selectedGroupId === g.id ? { background: "rgba(13, 92, 77, 0.06)" } : undefined}>
                      <td style={td}>
                        <strong>{g.name}</strong>
                        {g.description ? (
                          <span style={{ ...muted, display: "block", fontSize: "0.82rem", fontWeight: 400 }}>
                            {g.description}
                          </span>
                        ) : null}
                      </td>
                      <td style={td}>{linesByGroup.get(g.id)?.length ?? 0}</td>
                      <td style={td}>
                        {tiersUsingCount === 0 ? (
                          <span style={muted}>0</span>
                        ) : (
                          <button
                            type="button"
                            className="admin-tg-tier-count-btn"
                            onClick={() => setTierUsageModalGroupId(g.id)}
                          >
                            {tiersUsingCount}
                          </button>
                        )}
                      </td>
                      <td style={td}>
                        <button
                          type="button"
                          style={btn}
                          onClick={() => {
                            setSelectedGroupId(g.id);
                            setEditLineId(null);
                            setOpErr(null);
                            setOpOk(null);
                          }}
                          disabled={saving}
                        >
                          {selectedGroupId === g.id ? "Preview Below" : "Manage"}
                        </button>{" "}
                        <button type="button" style={btn} onClick={() => startEditGroup(g)} disabled={saving}>
                          Edit name
                        </button>{" "}
                        <button
                          type="button"
                          style={btn}
                          onClick={() => openSyncTemplateModal(g)}
                          disabled={saving || (linesByGroup.get(g.id)?.length ?? 0) === 0}
                          title="Choose which tiers that use this template should receive the latest definitions"
                        >
                          Sync template to selected tiers
                        </button>{" "}
                        <button type="button" style={btnDangerSm} onClick={() => void deleteGroup(g)} disabled={saving}>
                          Delete
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {!selectedGroupId ? (
        <div className="admin-tg-card" style={dimNewCardWhileEditing}>
          <h3 className="admin-tg-card-title">New template group</h3>
          <p className="admin-tg-card-lead">Name the group, add at least one line to the draft, then create. Lines store defaults used when a tier applies this template.</p>
          <div className="admin-tg-fields">
            <label className="admin-tg-field" style={lbl}>
              <span className="admin-field-caption">Name</span>
              <input style={input} value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} disabled={saving} />
            </label>
            <label className="admin-tg-field" style={lbl}>
              <span className="admin-field-caption">Description</span>
              <input style={input} value={newGroupDescription} onChange={(e) => setNewGroupDescription(e.target.value)} disabled={saving} />
            </label>
            {createLineDraft.length > 0 ? (
              <div className="admin-tg-field admin-tg-field--full">
                <span className="admin-field-caption">Draft ({createLineDraft.length})</span>
                <ol className="admin-tg-draft-list">
                  {createLineDraft.map((d, i) => (
                    <li key={d.key} className="admin-tg-draft-list__item">
                      <span className="admin-tg-draft-list__n">{i + 1}</span>
                      <span className="admin-tg-draft-list__line">{summarizeDraft(d, tasks, tiers, solutions)}</span>
                      <span className="admin-tg-draft-list__actions">
                        <button type="button" style={btn} onClick={() => duplicateCreateDraftLine(d)} disabled={saving}>
                          Copy
                        </button>
                        <button
                          type="button"
                          style={btnDangerSm}
                          onClick={() => setCreateLineDraft((x) => x.filter((y) => y.key !== d.key))}
                          disabled={saving}
                        >
                          Remove
                        </button>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            <div className="admin-tg-field admin-tg-field--full" style={lbl}>
              <span className="admin-field-caption">Add line to draft</span>
              <div className="admin-tg-mode-bar" role="tablist">
                <button
                  type="button"
                  className={addMode === "archetype" ? "admin-tg-mode-btn is-active" : "admin-tg-mode-btn"}
                  onClick={() => setAddMode("archetype")}
                  disabled={saving}
                >
                  Archetype
                </button>
                <button
                  type="button"
                  className={addMode === "copy_from_task" ? "admin-tg-mode-btn is-active" : "admin-tg-mode-btn"}
                  onClick={() => setAddMode("copy_from_task")}
                  disabled={saving}
                >
                  Copy from task
                </button>
              </div>
            </div>
            {addMode === "archetype" ? (
              <>
                <label className="admin-tg-field" style={lbl}>
                  <span className="admin-field-caption">Task name</span>
                  <input style={input} value={archName} onChange={(e) => setArchName(e.target.value)} />
                </label>
                <label className="admin-tg-field" style={lbl}>
                  <span className="admin-field-caption">Implementer</span>
                  <TaskImplementerSelect
                    value={archImpl}
                    options={implementerSelectOptions}
                    inputStyle={input}
                    onChange={setArchImpl}
                    disabled={saving}
                  />
                </label>
                <label className="admin-tg-field" style={lbl}>
                  <span className="admin-field-caption">Hours</span>
                  <input style={input} value={archHours} onChange={(e) => setArchHours(e.target.value)} />
                </label>
              </>
            ) : (
              <div className="admin-tg-field admin-tg-field--full" style={lbl}>
                <span className="admin-field-caption">Search and select a task to copy from</span>
                <TaskLinkPicker
                  search={linkSearch}
                  onSearch={setLinkSearch}
                  selectedTaskId={linkPick}
                  onSelect={setLinkPick}
                  filteredTasks={filteredForLink}
                  tiers={tiers}
                  solutions={solutions}
                  isRowDisabled={() => false}
                  disabled={saving}
                  inputStyle={input}
                  mutedStyle={muted}
                  templateLineMeta={templateLinePickerMeta}
                />
              </div>
            )}
            <div className="admin-tg-card-actions">
              <button type="button" style={btn} onClick={addDraftToCreate} disabled={saving}>
                Add to draft
              </button>
              {createLineDraft.length > 0 ? (
                <button type="button" style={btn} onClick={() => setCreateLineDraft([])} disabled={saving}>
                  Clear draft
                </button>
              ) : null}
              <button
                type="button"
                className="admin-btn-primary"
                style={btnPrimary}
                onClick={() => void createGroupWithDraft()}
                disabled={saving || createLineDraft.length === 0}
              >
                Create group
              </button>
            </div>
          </div>
        </div>
        ) : null}

        {selectedGroup && selectedGroupId ? (
          <div className="admin-tg-section" style={dimLinesSectionWhileGroupEdit}>
            <h3 className="admin-tg-section-title">Lines: {selectedGroup.name}</h3>
            {editLineId ? (
              <div className="admin-tg-edit" style={{ marginBottom: 16 }}>
                <p className="admin-tg-edit-title">Edit template line</p>
                {editingLineRow?.line_type === "copy_from_task" && editingLineRow.source_task_id ? (
                  <p className="admin-tg-edit-hint" style={{ ...muted, fontSize: "0.88rem", marginTop: 0, marginBottom: 10 }}>
                    Copy line — source task <code>{editingLineRow.source_task_id}</code>. Saving updates this template only,
                    not the original task.
                  </p>
                ) : null}
                <div className="admin-tg-fields">
                  <label className="admin-tg-field" style={lbl}>
                    <span className="admin-field-caption">Task name</span>
                    <input style={input} value={editName} onChange={(e) => setEditName(e.target.value)} />
                  </label>
                  <label className="admin-tg-field" style={lbl}>
                    <span className="admin-field-caption">Implementer</span>
                    <TaskImplementerSelect
                      value={editImpl}
                      options={implementerSelectOptions}
                      inputStyle={input}
                      onChange={setEditImpl}
                      disabled={saving}
                    />
                  </label>
                  <label className="admin-tg-field" style={lbl}>
                    <span className="admin-field-caption">Hours</span>
                    <input style={input} value={editHours} onChange={(e) => setEditHours(e.target.value)} />
                  </label>
                </div>
                <div className="admin-tg-card-actions">
                  <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void saveLine()} disabled={saving}>
                    Save
                  </button>
                  <button
                    type="button"
                    style={btn}
                    onClick={() => {
                      setEditLineId(null);
                    }}
                    disabled={saving}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
            <div style={dimLinesTableWhileLineEdit}>
            <div className="admin-table-scroll" style={{ marginBottom: 12 }}>
              <table className="admin-data-table" style={tbl}>
                <thead>
                  <tr>
                    <th style={th}>#</th>
                    <th style={{ ...th, width: 48 }} aria-label="Drag to reorder" />
                    <th style={th}>Task name</th>
                    <th style={th}>Implementer</th>
                    <th style={th}>Hours</th>
                    <th style={th} />
                  </tr>
                </thead>
                {linesInSelected.length === 0 ? (
                  <tbody>
                    <tr>
                      <td colSpan={6} style={td}>
                        No lines. Add one below.
                      </td>
                    </tr>
                  </tbody>
                ) : (
                  <TaskSortableList
                    itemIds={linesInSelected.map((r) => r.id)}
                    disabled={saving || Boolean(editLineId)}
                    onReorder={reorderSelectedGroupLines}
                  >
                    <tbody>
                      {linesInSelected.map((r, idx) => (
                        <SortableTableRowTr
                          key={r.id}
                          id={r.id}
                          disabled={saving || Boolean(editLineId)}
                          renderCells={(dragHandle) => [
                            <td style={td} key="idx">
                              {idx + 1}
                            </td>,
                            <td style={td} key="drag">
                              {dragHandle}
                            </td>,
                            <td style={td} key="name">
                              {r.line_type === "copy_from_task" && r.source_task_id ? (
                                <span title={`Copy from task ${r.source_task_id}`}>{r.task_name || "—"}</span>
                              ) : (
                                r.task_name || "—"
                              )}
                            </td>,
                            <td style={td} key="impl">
                              {(r.task_implementer ?? "").trim() || "—"}
                            </td>,
                            <td style={td} key="hours">
                              {formatTaskGroupLineHours(r.hours)}
                            </td>,
                            <td style={td} key="actions">
                              <button type="button" style={btn} onClick={() => startEditLine(r)} disabled={saving}>
                                Edit
                              </button>{" "}
                              <button type="button" style={btn} onClick={() => void duplicateLine(r)} disabled={saving}>
                                Copy
                              </button>{" "}
                              <button type="button" style={btnDangerSm} onClick={() => void removeLine(r)} disabled={saving}>
                                Remove
                              </button>
                            </td>,
                          ]}
                        />
                      ))}
                    </tbody>
                  </TaskSortableList>
                )}
                {linesInSelected.length > 0 ? (
                  <tbody>
                    <tr style={{ fontWeight: 600, borderTop: "1px solid rgba(13, 92, 77, 0.2)" }}>
                      <td colSpan={4} style={td}>
                        Total hours
                      </td>
                      <td style={td}>{formatTaskGroupLineHours(totalLineHours)}</td>
                      <td style={td} />
                    </tr>
                  </tbody>
                ) : null}
              </table>
            </div>

            <h4 className="admin-tg-subhead" style={muted}>
              Add a line
            </h4>
            <div className="admin-tg-mode-bar" role="tablist" style={{ maxWidth: 420, marginBottom: 10 }}>
              <button
                type="button"
                className={addMode === "archetype" ? "admin-tg-mode-btn is-active" : "admin-tg-mode-btn"}
                onClick={() => setAddMode("archetype")}
                disabled={saving}
              >
                Archetype
              </button>
              <button
                type="button"
                className={addMode === "copy_from_task" ? "admin-tg-mode-btn is-active" : "admin-tg-mode-btn"}
                onClick={() => setAddMode("copy_from_task")}
                disabled={saving}
              >
                Copy from task
              </button>
            </div>
            {addMode === "archetype" ? (
              <div className="admin-tg-fields" style={{ marginBottom: 10 }}>
                <label className="admin-tg-field" style={lbl}>
                  <span className="admin-field-caption">Task name</span>
                  <input style={input} value={archName} onChange={(e) => setArchName(e.target.value)} />
                </label>
                <label className="admin-tg-field" style={lbl}>
                  <span className="admin-field-caption">Implementer</span>
                  <TaskImplementerSelect
                    value={archImpl}
                    options={implementerSelectOptions}
                    inputStyle={input}
                    onChange={setArchImpl}
                    disabled={saving}
                  />
                </label>
                <label className="admin-tg-field" style={lbl}>
                  <span className="admin-field-caption">Hours</span>
                  <input style={input} value={archHours} onChange={(e) => setArchHours(e.target.value)} />
                </label>
              </div>
            ) : (
              <div className="admin-tg-field admin-tg-field--full" style={lbl}>
                <span className="admin-field-caption">Source task</span>
                <TaskLinkPicker
                  search={taskFilter}
                  onSearch={setTaskFilter}
                  selectedTaskId={linkPickAdd}
                  onSelect={setLinkPickAdd}
                  filteredTasks={filterAdd}
                  tiers={tiers}
                  solutions={solutions}
                  isRowDisabled={() => false}
                  disabled={saving}
                  inputStyle={input}
                  mutedStyle={muted}
                  templateLineMeta={templateLinePickerMeta}
                />
              </div>
            )}
            <div className="admin-tg-card-actions" style={{ border: "none", paddingTop: 0 }}>
              <button type="button" className="admin-btn-primary" style={btnPrimary} onClick={() => void addLineToSelected()} disabled={saving}>
                Add line
              </button>
            </div>
            </div>
            <p style={{ marginTop: 12 }}>
              <button
                type="button"
                style={btn}
                onClick={() => {
                  setSelectedGroupId(null);
                  setEditLineId(null);
                }}
                disabled={saving}
              >
                Close
              </button>
            </p>
          </div>
        ) : (
          <p className="admin-tg-hint-bottom" style={muted}>
            <strong>Manage</strong> a group to add or remove template lines, or build a <strong>new</strong> group above.
            Apply templates in Solution Builder (Update) with <strong>Apply task group to tier</strong>.
          </p>
        )}
      </div>

      {syncTemplateModalGroup ? (
        <div
          className="admin-modal-backdrop"
          onClick={() => !saving && setSyncTemplateModalGroup(null)}
          role="presentation"
        >
          <div
            className="admin-modal admin-modal--sync-tiers"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-tg-sync-template-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="admin-tg-sync-template-title" className="admin-modal__title">
              Sync template to tiers — “{syncTemplateModalGroup.name}”
            </h3>
            <p className="admin-modal__lead" style={{ ...muted, marginTop: "0.35rem", fontSize: "0.86rem" }}>
              Choose which solution tiers should be updated to match the <strong>current</strong> template
              (task name, implementer, hours, etc.). Copy-from-task lines use the latest source task data. Only tasks
              with template lineage can be updated.
            </p>
            <div className="admin-modal__checklist-tools" style={{ marginTop: "0.65rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
              <button
                type="button"
                style={btn}
                disabled={saving || syncModalTierItems.length === 0}
                onClick={() => setSyncTemplateSelectedTierIds(syncModalTierItems.map((it) => it.id))}
              >
                Select all
              </button>
              <button
                type="button"
                style={btn}
                disabled={saving}
                onClick={() => setSyncTemplateSelectedTierIds([])}
              >
                Clear
              </button>
            </div>
            <ul className="admin-modal__checklist" style={{ marginTop: "0.5rem" }}>
              {syncModalTierItems.map((it) => {
                const checked = syncTemplateSelectedTierIds.includes(it.id);
                const nApply = syncModalApplyCountByTier.get(it.id) ?? 0;
                return (
                  <li key={it.id}>
                    <label className="admin-modal__check-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={saving}
                        onChange={() => {
                          setSyncTemplateSelectedTierIds((prev) =>
                            prev.includes(it.id)
                              ? prev.filter((x) => x !== it.id)
                              : [...prev, it.id].sort(sortTierIdKey)
                          );
                        }}
                      />
                      <span>
                        <span style={{ fontWeight: 600 }}>{it.label}</span>
                        <span style={{ ...muted, display: "block", fontSize: "0.8rem", marginTop: 2 }}>
                          Tier id <code style={{ fontSize: "0.85em" }}>{it.id}</code>
                          {nApply > 1 ? ` · ${nApply} apply records` : nApply === 1 ? " · 1 apply" : null}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <div className="admin-modal__actions" style={{ marginTop: "1rem", display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
              <button
                type="button"
                className="admin-btn-primary"
                style={btnPrimary}
                disabled={saving || syncTemplateSelectedTierIds.length === 0}
                onClick={() => void confirmSyncTemplateToSelectedTiers()}
              >
                Update selected tiers
              </button>
              <button type="button" style={btn} disabled={saving} onClick={() => setSyncTemplateModalGroup(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {tierUsageModalGroupId ? (
        <div
          className="admin-modal-backdrop"
          onClick={() => setTierUsageModalGroupId(null)}
          role="presentation"
        >
          <div
            className="admin-modal admin-modal--tier-usage"
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-tg-tier-usage-title"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 id="admin-tg-tier-usage-title" className="admin-modal__title">
              Solution tiers using “
              {taskGroups.find((x) => x.id === tierUsageModalGroupId)?.name ?? "this template"}”
            </h3>
            <p className="admin-modal__lead" style={{ ...muted, marginTop: "0.35rem", fontSize: "0.86rem" }}>
              Tiers that still contain at least one task linked to this template. If you applied a template long ago (before
              lineage fields were enabled) or you deleted the spawned tasks, it will not appear here.
            </p>
            <ul className="admin-modal__list admin-modal__list--tier-usage">
              {(tierUsageByTaskGroup.get(tierUsageModalGroupId)?.items ?? []).map((it) => (
                <li key={it.id} className="admin-modal__list-item" title={it.id}>
                  {it.label}
                </li>
              ))}
            </ul>
            {(tierUsageByTaskGroup.get(tierUsageModalGroupId)?.items ?? []).length === 0 ? (
              <p style={{ ...muted, marginBottom: 0 }}>No application records in the database for this template.</p>
            ) : null}
            <div className="admin-modal__actions" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                className="admin-btn-primary"
                style={btnPrimary}
                onClick={() => setTierUsageModalGroupId(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
