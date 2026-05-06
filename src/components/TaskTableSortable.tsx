import {
  DndContext,
  type DragEndEvent,
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
import type { CSSProperties, ReactElement, ReactNode } from "react";

type TaskSortableListProps = {
  itemIds: UniqueIdentifier[];
  disabled?: boolean;
  onReorder: (nextIds: UniqueIdentifier[]) => void | Promise<void>;
  children: ReactNode;
};

/**
 * Vertical sortable list for table rows: wrap `<tbody>…</tbody>`; each row uses {@link SortableTableRowTr}.
 * Renders only providers (no extra DOM nodes).
 */
export function TaskSortableList({ itemIds, disabled, onReorder, children }: TaskSortableListProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    if (disabled) return;
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = itemIds.indexOf(active.id);
    const newIndex = itemIds.indexOf(over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = arrayMove([...itemIds], oldIndex, newIndex);
    void Promise.resolve(onReorder(next)).catch(() => {});
  };

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={itemIds} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

type SortableTableRowTrProps = {
  id: UniqueIdentifier;
  disabled?: boolean;
  /** Return table cells; first cell usually shows `dragHandle`. */
  renderCells: (dragHandle: ReactElement) => ReactElement[];
};

export function SortableTableRowTr({ id, disabled, renderCells }: SortableTableRowTrProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    disabled,
  });

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    ...(isDragging ? { zIndex: 2, position: "relative" } : {}),
  };

  const dragHandle = (
    <button
      type="button"
      className="admin-task-drag-handle"
      disabled={disabled}
      aria-label="Drag to reorder"
      {...attributes}
      {...listeners}
    >
      <span className="admin-task-drag-handle__grip" aria-hidden>
        ⠿
      </span>
    </button>
  );

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={isDragging ? "admin-task-row--dragging" : undefined}
    >
      {renderCells(dragHandle)}
    </tr>
  );
}
