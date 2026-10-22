import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { useFeed } from "./useFeed";
import ActivityHistory from "../components/ActivityHistory";
import AssignTeam from "../components/AssignTeam";
import { assignmentKeyForTask } from "../lib/assignmentResolver";
import { normalizeBrandKey } from "../lib/sharedState";
import { taskSheetUrl } from "../lib/sharedState";
import { validatePlan, WORKFLOW, dependencyWarnings } from "./model";
function PlanForm({ task, plan, savePlan, busy }) {
  const [start, setStart] = useState(plan?.start_date || "");
  const [end, setEnd] = useState(plan?.end_date || "");
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        const message = validatePlan(start, end);
        setError(message);
        if (!message) await savePlan(task.key, start, end, plan?.version || 0);
      }}
    >
      <h3>วันตามแผน</h3>
      <p className="v2-hint">ไม่เปลี่ยนกำหนดส่งจริงใน Google Sheets</p>
      <div className="v2-two">
        <label>
          เริ่มแผน
          <input
            aria-label="เริ่มแผน"
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
          />
        </label>
        <label>
          สิ้นสุดแผน
          <input
            aria-label="สิ้นสุดแผน"
            type="date"
            value={end}
            onChange={(e) => setEnd(e.target.value)}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="v2-actions">
        <button type="submit" disabled={busy}>
          บันทึกแผน
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => savePlan(task.key, "", "", plan?.version || 0)}
        >
          ล้างแผน
        </button>
      </div>
    </form>
  );
}
function Comments({ task, state, user, isAdmin, mutate, enabled, busy }) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const comments = useFeed(['v2-comments', user?.id, task.key], 'v2_comments', task.key, enabled);
  const events = useFeed(['v2-events', user?.id, task.key], 'v2_events', task.key, enabled && historyOpen);
  const query = {data:{comments:comments.data,events:events.data},error:comments.error || events.error,isSuccess:comments.isSuccess,refetch:comments.refetch};
  const [body, setBody] = useState("");
  const [mentions, setMentions] = useState([]);
  const [edit, setEdit] = useState(null);
  const latestEdit = edit && query.data?.comments.find((c) => c.id === edit.id);
  const editConflict = edit && query.isSuccess && (!latestEdit || latestEdit.version !== edit.version);
  const submit = async (e) => {
    e.preventDefault();
    if (busy || editConflict) return;
    if (
      await mutate("comment", {
        taskKey: task.key,
        body,
        mentions,
        ...(edit ? { id: edit.id, expectedVersion: edit.version } : {}),
      })
    ) {
      setBody("");
      setMentions([]);
      setEdit(null);
      // Mutation invalidation refreshes the first page; keep loaded older pages.
    }
  };
  return (
    <section>
      <h3>ความคิดเห็นและการกล่าวถึง</h3>
      {query.error && (
        <p className="v2-warning">
          โหลดความคิดเห็นไม่ได้: {query.error.message}
        </p>
      )}
      <form onSubmit={submit}>
        {editConflict && (
          <div className="v2-warning" role="alert">
            ความคิดเห็นนี้เปลี่ยนจากอีกหน้าจอ หรือไม่อยู่ในรายการล่าสุด ข้อความร่างยังอยู่
            {latestEdit && (
              <button type="button" onClick={() => {
                setEdit(latestEdit);
                setBody(latestEdit.body);
                setMentions([]);
              }}>
                โหลดความคิดเห็นล่าสุด
              </button>
            )}
          </div>
        )}
        <textarea
          aria-label="ความคิดเห็น"
          value={body}
          maxLength={5000}
          required
          onChange={(e) => setBody(e.target.value)}
          placeholder="อัปเดตหรือปรึกษาทีมเกี่ยวกับงานนี้…"
        />
        <label>
          กล่าวถึงสมาชิก
          <select
            multiple
            aria-label="กล่าวถึงสมาชิก"
            value={mentions}
            onChange={(e) =>
              setMentions([...e.target.selectedOptions].map((o) => o.value))
            }
          >
            {(state.teamMembers || []).map((m) => (
              <option key={m.name}>{m.name}</option>
            ))}
          </select>
        </label>
        <div className="v2-actions">
          <button disabled={!enabled || busy || editConflict || !body.trim()}>
            {edit ? "บันทึกความคิดเห็น" : "ส่งความคิดเห็น"}
          </button>
          {edit && (
            <button
              type="button"
              onClick={() => {
                setEdit(null);
                setBody("");
                setMentions([]);
              }}
            >
              ยกเลิกแก้ไข
            </button>
          )}
        </div>
      </form>
      <div className="v2-comments">
        {(query.data?.comments || []).map((c) => (
          <article key={c.id}>
            <div>
              <strong>{c.author_email}</strong>
              <small>{new Date(c.created_at).toLocaleString("th-TH")}</small>
            </div>
            <p>{c.body}</p>
            {(c.author_id === user?.id || isAdmin) && (
              <div className="v2-actions">
                <button
                  disabled={busy}
                  onClick={() => {
                    setEdit(c);
                    setBody(c.body);
                    setMentions([]);
                  }}
                >
                  แก้ไข
                </button>
                <button
                  disabled={busy}
                  onClick={async () => {
                    await mutate("remove_comment", {
                      id: c.id, taskKey: task.key, expectedVersion: c.version,
                    });
                  }}
                >
                  ลบ
                </button>
              </div>
            )}
          </article>
        ))}
      </div>
      {(comments.hasNext || (historyOpen && events.hasNext)) && (
        <button disabled={comments.isFetchingMore || events.isFetchingMore} onClick={() => { if(comments.hasNext) comments.loadMore(); if(historyOpen && events.hasNext) events.loadMore(); }}>
          โหลดความคิดเห็นและประวัติเพิ่มเติม
        </button>
      )}
      <details onToggle={(event) => setHistoryOpen(event.currentTarget.open)}>
        <summary>ประวัติ V2 ล่าสุด</summary>
        {(query.data?.events || []).map((e) => (
          <p key={e.id}>
            {e.action} · {e.actor_email} ·{" "}
            {new Date(e.created_at).toLocaleString("th-TH")}
          </p>
        ))}
      </details>
    </section>
  );
}
export default function TaskDrawer({
  task,
  tasks,
  state,
  extras,
  user,
  isAdmin,
  onClose,
  write,
  complete,
  savePlan,
  mutate,
  busy,
  enabled,
  errorMessage,
}) {
  const [note, setNote] = useState(state.remarks?.[task.key] || "");
  const [baseVersion, setBaseVersion] = useState(
    state.noteVersions?.[task.key] || 0,
  );
  const [next, setNext] = useState(state.nextActions?.[task.key] || "");
  const [predecessor, setPredecessor] = useState("");
  const conflict = baseVersion !== (state.noteVersions?.[task.key] || 0);
  const dependencies = extras.dependencies || [];
  const plans = extras.plans || {};
  const assignmentKey = assignmentKeyForTask(
    task,
    state.brandProjects,
    task.brand,
  );
  const projectAssignment = state.brandProjects?.find(
    (p) => p.id === assignmentKey,
  );
  const assignments = {
    ...state.assignments,
    ...Object.fromEntries(
      (state.brandProjects || []).map((p) => [p.id, p.assignment || {}]),
    ),
  };
  const warnings = dependencyWarnings(dependencies, plans).filter(
    (d) => d.successor === task.key,
  );
  const dirty =
    note !== (state.remarks?.[task.key] || "") ||
    next !== (state.nextActions?.[task.key] || "");
  const [confirmClose, setConfirmClose] = useState(false);
  const requestClose = () => {
    if (dirty) setConfirmClose(true);
    else onClose();
  };
  return (
    <Dialog.Root
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="v2-drawer-backdrop" />
        <Dialog.Popup className="v2-drawer v2-scope">
          <div className="v2-section-head">
            <div>
              <small>
                {task.brand} / {task.project}
              </small>
              <Dialog.Title>{task.topic}</Dialog.Title>
            </div>
            <button onClick={requestClose} aria-label="ปิดรายละเอียด">
              ✕
            </button>
          </div>
          <Dialog.Description className="v2-hint">
            กำหนดส่งจริง {task.dueDate || "ไม่ระบุ"} ·{" "}
            {task.owners.join(", ") || "ยังไม่มีเจ้าของ"}
          </Dialog.Description>
          {errorMessage && (
            <div className="v2-error" role="alert">
              {errorMessage}
            </div>
          )}
          {confirmClose && (
            <div className="v2-warning">
              มีข้อความที่ยังไม่บันทึก
              <div className="v2-actions">
                <button onClick={() => setConfirmClose(false)}>แก้ไขต่อ</button>
                <button onClick={onClose}>ทิ้งข้อความและปิด</button>
              </div>
            </div>
          )}
          <div className="v2-two">
            <label>
              Workflow
              <select
                aria-label="Workflow"
                value={task.status}
                disabled={busy}
                onChange={(e) => write("workflow", task.key, e.target.value)}
              >
                {WORKFLOW.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Priority
              <select
                aria-label="Priority"
                value={task.priority}
                disabled={busy}
                onChange={(e) => write("priorities", task.key, e.target.value)}
              >
                {["normal", "high", "urgent"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="v2-actions">
            <button disabled={busy} onClick={() => complete(task, !task.done)}>
              {task.done ? "นำ Done ออก" : "✓ ทำเครื่องหมาย Done"}
            </button>
            <a href={taskSheetUrl(task)} target="_blank" rel="noreferrer">
              เปิด Google Sheets ↗
            </a>
          </div>
          <section>
            <h3>ทีมรับผิดชอบ</h3>
            <AssignTeam
              displayName={task.project}
              assignmentKey={assignmentKey}
              legacyKey={normalizeBrandKey(task.brand)}
              assignments={assignments}
              members={state.teamMembers}
              onUpdate={(key, value, mutation) =>
                write(
                  projectAssignment ? "projectAssignments" : "assignments",
                  key,
                  projectAssignment
                    ? value
                    : mutation || { clear: !Object.keys(value || {}).length },
                )
              }
            />
          </section>
          <section>
            <h3>Note เดิม</h3>
            <textarea
              aria-label="Note"
              value={note}
              maxLength={5000}
              onChange={(e) => setNote(e.target.value)}
            />
            {conflict && (
              <div className="v2-warning">
                Note เปลี่ยนจากอีกหน้าจอ
                <button
                  onClick={() => {
                    setNote(state.remarks?.[task.key] || "");
                    setBaseVersion(state.noteVersions?.[task.key] || 0);
                  }}
                >
                  โหลดค่าล่าสุด
                </button>
              </div>
            )}
            <button
              disabled={busy || conflict}
              onClick={async () => {
                if (
                  await write("remarks", task.key, note, {
                    expectedNoteVersion: baseVersion,
                  })
                )
                  setBaseVersion(baseVersion + 1);
              }}
            >
              บันทึก Note
            </button>
            <label>
              Next Action
              <textarea
                value={next}
                maxLength={2000}
                onChange={(e) => setNext(e.target.value)}
              />
            </label>
            <button
              disabled={busy}
              onClick={() => write("nextActions", task.key, next)}
            >
              บันทึก Next Action
            </button>
          </section>
          <PlanForm
            key={plans[task.key]?.version || 0}
            task={task}
            plan={plans[task.key]}
            savePlan={savePlan}
            busy={busy}
          />
          <section>
            <h3>งานที่ต้องเสร็จก่อน</h3>
            {warnings.length > 0 && (
              <p className="v2-warning">
                วันเริ่มแผนทับกับวันสิ้นสุดงานก่อนหน้า
              </p>
            )}
            <div className="v2-actions">
              <select
                aria-label="งานก่อนหน้า"
                value={predecessor}
                onChange={(e) => setPredecessor(e.target.value)}
              >
                <option value="">เลือกงาน</option>
                {tasks
                  .filter((t) => t.key !== task.key)
                  .map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.brand} · {t.topic}
                    </option>
                  ))}
              </select>
              <button
                disabled={!predecessor || busy}
                onClick={() =>
                  mutate("dependency", { predecessor, successor: task.key })
                }
              >
                เพิ่ม
              </button>
            </div>
            {dependencies
              .filter((d) => d.successor === task.key)
              .map((d) => (
                <div className="v2-dependency" key={d.predecessor}>
                  <span>
                    {tasks.find((t) => t.key === d.predecessor)?.topic ||
                      d.predecessor}
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => mutate("remove_dependency", d)}
                  >
                    นำออก
                  </button>
                </div>
              ))}
          </section>
          <Comments
            task={task}
            state={state}
            user={user}
            isAdmin={isAdmin}
            mutate={mutate}
            enabled={enabled}
            busy={busy}
          />
          {enabled && (
            <OriginalHistory taskKey={task.key} />
          )}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function OriginalHistory({taskKey}) {
  const [open,setOpen] = useState(false);
  return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>ประวัติการแก้ไขเดิม</summary>{open && <ActivityHistory taskKey={taskKey} />}</details>;
}
