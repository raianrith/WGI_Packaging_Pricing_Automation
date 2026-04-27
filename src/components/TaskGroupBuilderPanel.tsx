import { useCallback, useId, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { insertAuditLog } from "../lib/audit";
import { notifyPackagingDataChanged } from "../lib/packagingEvents";
import { getSupabase } from "../lib/supabase";
import { friendlyMutationMessage } from "../lib/supabaseErrors";
import { TaskImplementerSelect } from "./TaskImplementerSelect";
import type {
  ImplementerHourGroupRow,
  Solution,
  SolutionTier,
  TaskGroupLineRow,
  TaskGroupLineType,
  TaskGroupRow,
  TaskRow,
} from "../types";

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
  taskGroups: TaskGroupRow[];
  taskGroupLines: TaskGroupLineRow[];
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
            const { label: tierLabel, title: tierTitle } = tierContextLabel(k, tierList, solutionList);
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
                    <code className="admin-tg-task-picker__id">{k.task_id}</code>
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
  taskGroups,
  taskGroupLines,
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

  const sortedTasks = useMemo(
    () => [...tasks].sort((a, b) => a.task_id.localeCompare(b.task_id, undefined, { numeric: true })),
    [tasks]
  );

  const implementerSelectOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const r of implementerHourGroups) {
      const n = (r.implementer_name ?? "").trim();
      if (n) seen.add(n);
    }
    for (const k of tasks) {
      const v = (k.task_implementer ?? "").trim();
      if (v) seen.add(v);
    }
    return [...seen].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [implementerHourGroups, tasks]);

  const filteredForLink = useMemo(() => {
    const q = linkSearch.trim().toLowerCase();
    if (!q) return sortedTasks;
    return sortedTasks.filter((k) => {
      const { label: tierL } = tierContextLabel(k, tiers, solutions);
      const hay = `${k.task_id} ${k.task_name} ${k.solution_tier_id} ${tierL} ${k.task_implementer ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sortedTasks, linkSearch, solutions, tiers]);

  const filterAdd = useMemo(() => {
    const q = taskFilter.trim().toLowerCase();
    if (!q) return sortedTasks;
    return sortedTasks.filter((k) => {
      const { label: tierL } = tierContextLabel(k, tiers, solutions);
      const hay = `${k.task_id} ${k.task_name} ${k.solution_tier_id} ${tierL} ${k.task_implementer ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [sortedTasks, taskFilter, solutions, tiers]);

  const linesByGroup = useMemo(() => {
    const m = new Map<string, TaskGroupLineRow[]>();
    for (const l of taskGroupLines) {
      if (!m.has(l.task_group_id)) m.set(l.task_group_id, []);
      m.get(l.task_group_id)!.push(l);
    }
    for (const arr of m.values()) arr.sort((a, b) => a.sort_order - b.sort_order);
    return m;
  }, [taskGroupLines]);

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
    setCreateLineDraft((d) => [
      ...d,
      { key: crypto.randomUUID(), line_type: "copy_from_task", taskId: linkPick },
    ]);
    setLinkPick("");
    setOpOk("Added to new-group draft.");
  }, [addMode, archHours, archImpl, archName, createLineDraft, linkPick, setOpErr, setOpOk]);

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
          const src = tasks.find((t) => t.task_id === d.taskId);
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
    logAudit,
    newGroupDescription,
    newGroupName,
    onRefresh,
    setOpErr,
    setOpOk,
    taskGroups,
    tasks,
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
        const src = tasks.find((t) => t.task_id === linkPickAdd);
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
    linkPickAdd,
    logAudit,
    nextSortOrder,
    onRefresh,
    selectedGroupId,
    tasks,
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
        {loadNote ? (
          <p className="admin-hint" style={{ ...muted, color: "#92400e", marginTop: 8 }}>
            {loadNote}
          </p>
        ) : null}

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
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {taskGroups.length === 0 && !loadNote ? (
                  <tr>
                    <td colSpan={3} style={td}>
                      No task groups. Create one below.
                    </td>
                  </tr>
                ) : null}
                {taskGroups.map((g) => (
                  <tr key={g.id} style={selectedGroupId === g.id ? { background: "rgba(13, 92, 77, 0.06)" } : undefined}>
                    <td style={td}>
                      <strong>{g.name}</strong>
                      {g.description ? (
                        <span style={{ ...muted, display: "block", fontSize: "0.82rem", fontWeight: 400 }}>{g.description}</span>
                      ) : null}
                    </td>
                    <td style={td}>{linesByGroup.get(g.id)?.length ?? 0}</td>
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
                      <button type="button" style={btnDangerSm} onClick={() => void deleteGroup(g)} disabled={saving}>
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
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
                      <button
                        type="button"
                        className="admin-tg-draft-list__remove"
                        style={btnDangerSm}
                        onClick={() => setCreateLineDraft((x) => x.filter((y) => y.key !== d.key))}
                        disabled={saving}
                      >
                        Remove
                      </button>
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
                    <th style={th}>Task name</th>
                    <th style={th}>Implementer</th>
                    <th style={th}>Hours</th>
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {linesInSelected.length === 0 ? (
                    <tr>
                      <td colSpan={5} style={td}>
                        No lines. Add one below.
                      </td>
                    </tr>
                  ) : null}
                  {linesInSelected.map((r, idx) => (
                    <tr key={r.id}>
                      <td style={td}>{idx + 1}</td>
                      <td style={td}>
                        {r.line_type === "copy_from_task" && r.source_task_id ? (
                          <span title={`Copy from task ${r.source_task_id}`}>{r.task_name || "—"}</span>
                        ) : (
                          r.task_name || "—"
                        )}
                      </td>
                      <td style={td}>{(r.task_implementer ?? "").trim() || "—"}</td>
                      <td style={td}>{formatTaskGroupLineHours(r.hours)}</td>
                      <td style={td}>
                        <button type="button" style={btn} onClick={() => startEditLine(r)} disabled={saving}>
                          Edit
                        </button>{" "}
                        <button type="button" style={btnDangerSm} onClick={() => void removeLine(r)} disabled={saving}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  ))}
                  {linesInSelected.length > 0 ? (
                    <tr style={{ fontWeight: 600, borderTop: "1px solid rgba(13, 92, 77, 0.2)" }}>
                      <td colSpan={3} style={td}>
                        Total hours
                      </td>
                      <td style={td}>{formatTaskGroupLineHours(totalLineHours)}</td>
                      <td style={td} />
                    </tr>
                  ) : null}
                </tbody>
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
    </section>
  );
}
