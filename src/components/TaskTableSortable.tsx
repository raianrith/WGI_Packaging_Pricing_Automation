import {
  DndContext,
  type DragEndEvent,
  type DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  createContext,
  useContext,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

function toIdSet(ids: ReadonlySet<UniqueIdentifier> | readonly UniqueIdentifier[] | undefined): Set<string> {
  if (!ids) return new Set();
  if (Array.isArray(ids)) {
    return new Set(ids.map((id) => String(id)));
  }
  const out = new Set<string>();
  for (const id of ids) out.add(String(id));
  return out;
}

/**
 * Move checked items as one block (preserving their relative order).
 * Dropping onto a selected item keeps the block ordered around that drop target's
 * position among non-selected rows.
 */
export function reorderWithSelectedChunk(
  itemIds: readonly UniqueIdentifier[],
  activeId: UniqueIdentifier,
  overId: UniqueIdentifier,
  selectedIds: ReadonlySet<string>
): UniqueIdentifier[] {
  const ids = [...itemIds];
  const active = String(activeId);
  const over = String(overId);
  if (active === over) return ids;

  const selected =
    selectedIds.has(active) && selectedIds.size > 1
      ? selectedIds
      : new Set<string>([active]);

  if (selected.size <= 1) {
    const oldIndex = ids.findIndex((id) => String(id) === active);
    const newIndex = ids.findIndex((id) => String(id) === over);
    if (oldIndex < 0 || newIndex < 0) return ids;
    return arrayMove(ids, oldIndex, newIndex);
  }

  const chunk = ids.filter((id) => selected.has(String(id)));
  const without = ids.filter((id) => !selected.has(String(id)));
  if (chunk.length === 0) return ids;

  const activeOrig = ids.findIndex((id) => String(id) === active);
  const overOrig = ids.findIndex((id) => String(id) === over);
  if (activeOrig < 0 || overOrig < 0) return ids;

  let insertAt: number;
  if (selected.has(over)) {
    insertAt = ids.slice(0, overOrig).filter((id) => !selected.has(String(id))).length;
  } else {
    const overInWithout = without.findIndex((id) => String(id) === over);
    if (overInWithout < 0) return ids;
    insertAt = activeOrig < overOrig ? overInWithout + 1 : overInWithout;
  }

  insertAt = Math.max(0, Math.min(without.length, insertAt));
  return [...without.slice(0, insertAt), ...chunk, ...without.slice(insertAt)];
}

type SelectionCtx = {
  selectedIds: Set<string>;
  activeId: string | null;
};

const SortableSelectionContext = createContext<SelectionCtx>({
  selectedIds: new Set(),
  activeId: null,
});

type TaskSortableListProps = {
  itemIds: UniqueIdentifier[];
  disabled?: boolean;
  /** When the dragged row is in this set (size > 1), the whole selection moves as a chunk. */
  selectedIds?: ReadonlySet<UniqueIdentifier> | readonly UniqueIdentifier[];
  onReorder: (nextIds: UniqueIdentifier[]) => void | Promise<void>;
  children: ReactNode;
};

/**
 * Vertical sortable list for table rows: wrap `<tbody>…</tbody>`; each row uses {@link SortableTableRowTr}.
 * Renders only providers (no extra DOM nodes).
 */
export function TaskSortableList({
  itemIds,
  disabled,
  selectedIds,
  onReorder,
  children,
}: TaskSortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const selectedSet = useMemo(() => toIdSet(selectedIds), [selectedIds]);

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const clearActive = () => setActiveId(null);

  const handleDragEnd = (event: DragEndEvent) => {
    clearActive();
    if (disabled) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const next = reorderWithSelectedChunk(itemIds, active.id, over.id, selectedSet);
    const unchanged =
      next.length === itemIds.length && next.every((id, i) => String(id) === String(itemIds[i]));
    if (unchanged) return;
    void Promise.resolve(onReorder(next)).catch(() => {});
  };

  const ctx = useMemo(
    (): SelectionCtx => ({ selectedIds: selectedSet, activeId }),
    [selectedSet, activeId]
  );

  return (
    <SortableSelectionContext.Provider value={ctx}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={clearActive}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
          {children}
        </SortableContext>
      </DndContext>
    </SortableSelectionContext.Provider>
  );
}

type SortableTableRowTrProps = {
  id: UniqueIdentifier;
  disabled?: boolean;
  className?: string;
  /** Return table cells; first cell usually shows `dragHandle`. */
  renderCells: (dragHandle: ReactElement) => ReactElement[];
};

export function SortableTableRowTr({ id, disabled, className, renderCells }: SortableTableRowTrProps) {
  const { selectedIds, activeId } = useContext(SortableSelectionContext);
  const idStr = String(id);
  const isSelected = selectedIds.has(idStr);
  const chunkActive =
    activeId != null &&
    selectedIds.has(activeId) &&
    selectedIds.size > 1 &&
    isSelected;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging || chunkActive ? { zIndex: 2, position: "relative" } : {}),
  };

  const selectedCount = selectedIds.size;
  const dragLabel =
    isSelected && selectedCount > 1
      ? `Drag ${selectedCount} selected tasks to reorder`
      : "Drag to reorder";

  const dragHandle = (
    <button
      type="button"
      className="admin-task-drag-handle"
      disabled={disabled}
      aria-label={dragLabel}
      title={dragLabel}
      {...attributes}
      {...listeners}
    >
      <span className="admin-task-drag-handle__grip" aria-hidden>
        ⠿
      </span>
    </button>
  );

  const rowClass = [
    className,
    isSelected ? "admin-task-row--selected" : undefined,
    isDragging ? "admin-task-row--dragging" : undefined,
    chunkActive && !isDragging ? "admin-task-row--chunk" : undefined,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <tr ref={setNodeRef} style={style} className={rowClass || undefined}>
      {renderCells(dragHandle)}
    </tr>
  );
}
