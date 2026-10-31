import { DragDropProvider, useDraggable, useDroppable } from "@dnd-kit/react";
import { WORKFLOW } from "../model";
function Card({ task, openTask, update, busy }) {
  const { ref, handleRef } = useDraggable({ id: task.key, disabled: busy });
  return (
    <article ref={ref} className="v2-kanban-card">
      <div className="v2-card-meta">
        <span>{task.brand}</span>
        <button
          ref={handleRef}
          aria-label={`ลาก ${task.topic}`}
          className="v2-drag-handle"
        >
          ⠿
        </button>
      </div>
      <button className="v2-task-link" onClick={() => openTask(task.key)}>
        {task.topic}
      </button>
      <p>{task.project}</p>
      <div className="v2-card-meta">
        <span>{task.owners.join(", ") || "ยังไม่มีเจ้าของ"}</span>
        <span>{task.dueDate || "ไม่กำหนดวัน"}</span>
      </div>
      <select
        aria-label={`Workflow ${task.topic}`}
        value={task.status}
        onKeyDown={(event) => event.stopPropagation()}
        disabled={busy}
        onChange={(e) => update(task.key, e.target.value)}
      >
        {WORKFLOW.map(([id, label]) => (
          <option key={id} value={id}>
            {label}
          </option>
        ))}
      </select>
    </article>
  );
}
function Column({ id, label, tasks, ...props }) {
  const { ref, isDropTarget } = useDroppable({ id, disabled: props.busy });
  return (
    <section
      ref={ref}
      className={`v2-kanban-column ${isDropTarget ? "v2-drop-target" : ""}`}
    >
      <h2>
        <span className={`v2-dot ${id}`} />
        {label}
        <small>{tasks.length}</small>
      </h2>
      {tasks.map((task) => (
        <Card key={task.key} task={task} {...props} />
      ))}
      {!tasks.length && <p className="v2-empty">วางงานที่นี่</p>}
    </section>
  );
}
export default function Kanban({ tasks, openTask, update, busy }) {
  // Current API: https://dndkit.com/react/quickstart/
  return (
    <>
      <p className="v2-hint">
        ลากงานระหว่างสถานะ หรือใช้เมนูในบัตร · เปลี่ยน Done ในรายละเอียดงาน
      </p>
      <DragDropProvider
        onDragEnd={(event) => {
          if (event.canceled) return;
          const { source, target } = event.operation;
          if (source && target && WORKFLOW.some(([id]) => id === target.id))
            update(source.id, target.id);
        }}
      >
        <div className="v2-kanban">
          {WORKFLOW.map(([id, label]) => (
            <Column
              key={id}
              id={id}
              label={label}
              tasks={tasks.filter((t) => !t.done && t.status === id)}
              openTask={openTask}
              update={update}
              busy={busy}
            />
          ))}
        </div>
      </DragDropProvider>
      <details className="v2-card v2-completed">
        <summary>งานเสร็จแล้ว ({tasks.filter((t) => t.done).length})</summary>
        {tasks
          .filter((t) => t.done)
          .map((t) => (
            <button key={t.key} onClick={() => openTask(t.key)}>
              {t.topic}
            </button>
          ))}
      </details>
    </>
  );
}
