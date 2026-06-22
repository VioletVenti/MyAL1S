// Dashboard composition root. Views (toggled in App via the `view` prop):
//   - "main": the glanceable subset — Calendar + 待办 + 新到通知
//   - "directory": the full listing panels (作业/课程通知/材料/回放/成绩/待审批 + 延后源)
//   - "settings": rendered by App (not here) via the exported SettingsPanel
// All raw teaching-network fields pass through `format.ts` before rendering, so
// no blobs / Debug-names / raw timestamps reach the DOM. Deterministic only.

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  type Announcement,
  type Approval,
  type Assignment,
  type DeanUpdate,
  type DocResult,
  type Grade,
  type Material,
  type MemoryEntry,
  type Permissions,
  type TreeholePost,
  type Video,
  decideApproval,
  fetchAnnouncements,
  fetchApprovals,
  fetchAssignments,
  fetchGrades,
  fetchMaterials,
  fetchPermissions,
  fetchVideos,
  setPermission,
  submitAssignment,
} from "./api";
import Calendar from "./Calendar";
import DeferredPanel from "./DeferredPanel";
import { fmtAnnouncementTime, fmtDate, fmtDeadline, fmtDescription, kindLabel } from "./format";
import NewNoticesPanel from "./NewNoticesPanel";
import TodoModule from "./TodoModule";
import { StarToggle } from "./stars";
import { EnvelopeBody, Pager, Panel, type Category, useEnvelope, usePagination, useRefresh } from "./widgets";

function AssignmentsPanel({ refreshKey }: { refreshKey: number }) {
  const { env, loading, reload } = useEnvelope(() => fetchAssignments(false), { cacheKey: "assignments" });
  useRefresh(refreshKey, reload);
  return (
    <Panel title="作业 · 按 DDL" loading={loading} onReload={reload} category="assignment">
      <EnvelopeBody
        env={env}
        loading={loading}
        renderData={(d) =>
          d.assignments.length === 0 ? (
            <p className="muted">没有未完成的作业 🎉</p>
          ) : (
            <AssignmentList items={d.assignments} onSubmitted={reload} />
          )
        }
      />
    </Panel>
  );
}

function AssignmentList({ items, onSubmitted }: { items: Assignment[]; onSubmitted?: () => void }) {
  const p = usePagination(items);
  return (
    <>
      <ul className="list">
        {p.slice.map((a) => (
          <li key={a.id}>
            <span className="course">{a.course}</span>
            <span className="title">{a.title}</span>
            <span className="ddl">{fmtDeadline(a.deadline, a.deadline_raw)}</span>
            <span className="row-actions">
              <StarToggle source="assignment" itemId={a.id} snapshot={{ title: a.title, course: a.course, date: a.deadline }} />
              <SubmitButton assignment={a} onSubmitted={onSubmitted} />
            </span>
          </li>
        ))}
      </ul>
      <Pager page={p.page} pages={p.pages} onPrev={p.prev} onNext={p.next} />
    </>
  );
}

/** UI direct submit (P2, implicit-confirm path): pick a file → upload → submit.
 *  Disabled once the assignment is already submitted. */
function SubmitButton({ assignment, onSubmitted }: { assignment: Assignment; onSubmitted?: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (assignment.submitted) {
    return <span className="kind-chip ok">已提交</span>;
  }

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      const env = await submitAssignment(assignment.id, file);
      const status = (env as { status?: string }).status;
      if (status === "ok") {
        setMsg("已提交 ✓");
        onSubmitted?.();
      } else if (status === "needs_otp") {
        setMsg("需先登录教学网");
      } else if (status === "denied") {
        setMsg("已被权限禁止");
      } else {
        setMsg(`失败：${(env as { message?: string }).message ?? status ?? "未知"}`);
      }
    } catch (err) {
      setMsg(`出错：${String(err)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <input ref={fileRef} type="file" hidden onChange={onFile} />
      <button className="ghost" disabled={busy} onClick={() => fileRef.current?.click()} title="交作业（直接提交）">
        {busy ? "提交中…" : "交作业"}
      </button>
      {msg && <span className="kind-chip">{msg}</span>}
    </>
  );
}

function AnnouncementsPanel({ refreshKey }: { refreshKey: number }) {
  const { env, loading, reload } = useEnvelope(fetchAnnouncements, { cacheKey: "announcements" });
  useRefresh(refreshKey, reload);
  return (
    <Panel title="课程通知" loading={loading} onReload={reload} category="announcement">
      <EnvelopeBody
        env={env}
        loading={loading}
        renderData={(d) =>
          d.announcements.length === 0 ? (
            <p className="muted">暂无公告</p>
          ) : (
            <AnnouncementList items={d.announcements} />
          )
        }
      />
    </Panel>
  );
}

function AnnouncementList({ items }: { items: Announcement[] }) {
  const p = usePagination(items);
  return (
    <>
      <ul className="list announcements">
        {p.slice.map((a) => (
          <li key={a.id} className="ann">
            <div className="ann-main">
              <span className="course">{a.course}</span>
              <span className="title">{a.title}</span>
              <span className="ddl">{fmtAnnouncementTime(a.time)}</span>
            </div>
            {a.descriptions.length > 0 && <div className="ann-desc">{fmtDescription(a.descriptions)}</div>}
            <span className="row-actions">
              <StarToggle source="announcement" itemId={a.id} snapshot={{ title: a.title, course: a.course, date: a.time }} />
            </span>
          </li>
        ))}
      </ul>
      <Pager page={p.page} pages={p.pages} onPrev={p.prev} onNext={p.next} />
    </>
  );
}

function MaterialsPanel({ refreshKey }: { refreshKey: number }) {
  const { env, loading, reload } = useEnvelope(fetchMaterials, { cacheKey: "materials" });
  useRefresh(refreshKey, reload);
  return (
    <Panel title="课程材料" loading={loading} onReload={reload} category="material">
      <EnvelopeBody
        env={env}
        loading={loading}
        renderData={(d) =>
          d.materials.length === 0 ? <p className="muted">暂无课程材料</p> : <MaterialList items={d.materials} />
        }
      />
    </Panel>
  );
}

function MaterialList({ items }: { items: Material[] }) {
  const p = usePagination(items);
  return (
    <>
      <ul className="list">
        {p.slice.map((m, i) => (
          <li key={`${m.ccid}-${i}`}>
            <span className="course">{m.course}</span>
            <span className="title">
              {m.title} <span className="kind-chip">{kindLabel(m.kind)}</span>
            </span>
            <span className="ddl">{m.attachment_count > 0 ? `${m.attachment_count} 附件` : ""}</span>
          </li>
        ))}
      </ul>
      <Pager page={p.page} pages={p.pages} onPrev={p.prev} onNext={p.next} />
    </>
  );
}

function VideosPanel({ refreshKey }: { refreshKey: number }) {
  const { env, loading, reload } = useEnvelope(fetchVideos, { cacheKey: "videos" });
  useRefresh(refreshKey, reload);
  return (
    <Panel title="课程回放" loading={loading} onReload={reload} category="video">
      <EnvelopeBody
        env={env}
        loading={loading}
        renderData={(d) =>
          d.videos.length === 0 ? <p className="muted">暂无回放</p> : <VideoList items={d.videos} />
        }
      />
    </Panel>
  );
}

function VideoList({ items }: { items: Video[] }) {
  const p = usePagination(items);
  return (
    <>
      <ul className="list">
        {p.slice.map((v) => (
          <li key={v.id}>
            <span className="course">{v.course}</span>
            <span className="title">{v.title}</span>
            <span className="ddl">{fmtDate(v.time, false)}</span>
          </li>
        ))}
      </ul>
      <Pager page={p.page} pages={p.pages} onPrev={p.prev} onNext={p.next} />
    </>
  );
}

function GradesPanel({ refreshKey }: { refreshKey: number }) {
  const { env, loading, reload } = useEnvelope(fetchGrades, { cacheKey: "grades" });
  useRefresh(refreshKey, reload);
  return (
    <Panel title="成绩" loading={loading} onReload={reload} category="grade">
      <EnvelopeBody
        env={env}
        loading={loading}
        renderData={(d) =>
          d.grades.length === 0 ? <p className="muted">暂无成绩</p> : <GradeList items={d.grades} />
        }
      />
    </Panel>
  );
}

function GradeList({ items }: { items: Grade[] }) {
  const p = usePagination(items);
  return (
    <>
      <ul className="list">
        {p.slice.map((g, i) => (
          <li key={i}>
            <span className="course">{g.course}</span>
            <span className="title">{g.item}</span>
            <span className="ddl">
              {g.score ?? "—"}
              {g.possible > 0 ? ` / ${g.possible}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <Pager page={p.page} pages={p.pages} onPrev={p.prev} onNext={p.next} />
    </>
  );
}

export type DashboardView = "main" | "directory" | "settings";

/** 待审批 panel (P2 agent two-phase): pending approvals the user confirms/rejects,
 *  plus a short recent-history list. The confirm dispatches the write via the
 *  backend gate (the agent run that created the approval has already ended). */
function ApprovalsPanel({ refreshKey }: { refreshKey: number }) {
  const { env, loading, reload } = useEnvelope(() => fetchApprovals(), { cacheKey: "approvals" });
  useRefresh(refreshKey, reload);
  return (
    <Panel title="待审批" loading={loading} onReload={reload} category="notice">
      <EnvelopeBody
        env={env}
        loading={loading}
        renderData={(d) =>
          d.approvals.length === 0 ? (
            <p className="muted">没有待审批的写操作。</p>
          ) : (
            <ApprovalsList items={d.approvals} onChanged={reload} />
          )
        }
      />
    </Panel>
  );
}

function ApprovalsList({ items, onChanged }: { items: Approval[]; onChanged: () => void }) {
  const pending = items.filter((a) => a.status === "pending");
  const recent = items.filter((a) => a.status !== "pending").slice(0, 8);
  return (
    <>
      {pending.length === 0 ? (
        <p className="muted">（暂无待确认项）</p>
      ) : (
        <ul className="list approvals">
          {pending.map((a) => (
            <ApprovalRow key={a.id} a={a} onChanged={onChanged} />
          ))}
        </ul>
      )}
      {recent.length > 0 && (
        <details className="history">
          <summary>最近处理（{recent.length}）</summary>
          <ul className="list">
            {recent.map((a) => (
              <li key={a.id}>
                <span className="title">{a.summary}</span>
                <span className={`kind-chip ${a.status}`}>{approvalLabel(a.status)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function ApprovalRow({ a, onChanged }: { a: Approval; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function decide(decision: "confirm" | "deny") {
    setBusy(true);
    setErr(null);
    try {
      const env = await decideApproval(a.id, decision);
      if ((env as { status?: string }).status === "needs_otp") {
        setErr("需要先登录教学网（顶部登录条）再确认执行。");
      }
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
      onChanged();
    }
  }

  return (
    <li className="ann approval">
      <div className="ann-main">
        <span className="title">{a.summary}</span>
        {a.filename && <span className="ddl">📎 {a.filename}</span>}
      </div>
      <span className="row-actions">
        <button className="ghost" disabled={busy} onClick={() => decide("confirm")}>
          确认执行
        </button>
        <button className="ghost danger" disabled={busy} onClick={() => decide("deny")}>
          拒绝
        </button>
      </span>
      {err && <div className="error">{err}</div>}
    </li>
  );
}

function approvalLabel(status: string): string {
  return ({ executed: "已执行", denied: "已拒绝", failed: "失败" } as Record<string, string>)[status] ?? status;
}

function groupLabel(group: string): string {
  return ({ assignment_submission: "交作业" } as Record<string, string>)[group] ?? group;
}

/** 权限矩阵设置 (P2). Per semantic group: confirm (default) / deny. auto is P3. */
export function SettingsPanel({ refreshKey }: { refreshKey: number }) {
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyGroup, setBusyGroup] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    fetchPermissions()
      .then(setPerms)
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => reload(), [reload]);
  useRefresh(refreshKey, reload);

  async function setLevel(group: string, level: string) {
    setBusyGroup(group);
    try {
      await setPermission(group, level);
      await reload();
    } catch {
      /* keep stale; the inline select reverts on reload */
    } finally {
      setBusyGroup(null);
    }
  }

  return (
    <Panel title="设置 · 权限矩阵" loading={loading} onReload={reload} category="todo">
      {!perms ? (
        <p className="muted">加载中…</p>
      ) : (
        <div className="matrix">
          <p className="muted">
            每个写操作可设为「需确认」（默认，每次执行前由你在「待审批」确认）或「禁止」。
            「自动」留待 P3（用于文件无关的写，如发帖）。
          </p>
          <table className="matrix-table">
            <thead>
              <tr>
                <th>操作</th>
                <th>级别</th>
              </tr>
            </thead>
            <tbody>
              {perms.groups.map((g) => {
                const cur = g.level ?? perms.default;
                return (
                  <tr key={g.group}>
                    <td>{groupLabel(g.group)}</td>
                    <td>
                      <select
                        value={cur}
                        disabled={busyGroup === g.group}
                        onChange={(e) => setLevel(g.group, e.target.value)}
                      >
                        <option value="confirm">需确认（默认）</option>
                        <option value="deny">禁止</option>
                        <option value="auto" disabled>
                          自动（P3）
                        </option>
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** Directory modules shown in the left nav. Live modules render their panel;
 * deferred ones render the 待接入 placeholder. `cat` drives the accent color. */
type DirModule = {
  id: string;
  label: string;
  cat: Category;
  body: ReactNode;
};

export default function Dashboard({
  view,
  refreshKey,
  bump,
}: {
  view: DashboardView;
  refreshKey: number;
  bump: () => void;
}): ReactNode {
  const [selected, setSelected] = useState("assignments");

  if (view === "main") {
    return (
      <div className="dashboard main-view">
        <Calendar refreshKey={refreshKey} />
        <div className="main-row">
          <TodoModule refreshKey={refreshKey} bump={bump} />
          <NewNoticesPanel refreshKey={refreshKey} bump={bump} />
        </div>
      </div>
    );
  }

  const modules: DirModule[] = [
    { id: "assignments", label: "作业", cat: "assignment", body: <AssignmentsPanel refreshKey={refreshKey} /> },
    { id: "announcements", label: "课程通知", cat: "announcement", body: <AnnouncementsPanel refreshKey={refreshKey} /> },
    { id: "materials", label: "课程材料", cat: "material", body: <MaterialsPanel refreshKey={refreshKey} /> },
    { id: "videos", label: "课程回放", cat: "video", body: <VideosPanel refreshKey={refreshKey} /> },
    { id: "grades", label: "成绩", cat: "grade", body: <GradesPanel refreshKey={refreshKey} /> },
    { id: "approvals", label: "待审批", cat: "notice", body: <ApprovalsPanel refreshKey={refreshKey} /> },
  ];
  const deferred: DirModule[] = [
    { id: "dean", label: "教务通知", cat: "notice", body: <DeferredPanel<DeanUpdate> title="教务通知" futureTool="MCP: get_dean_updates" fields={["id", "title", "time", "category", "url", "summary"]} /> },
    { id: "treehole", label: "北大树洞", cat: "notice", body: <DeferredPanel<TreeholePost> title="北大树洞" futureTool="MCP: list_treehole_posts / get_treehole_post" fields={["id", "title", "body", "time", "tags", "reply_count"]} /> },
    { id: "docs", label: "文档库", cat: "material", body: <DeferredPanel<DocResult> title="文档库" futureTool="GET /api/docs/search" fields={["id", "title", "course", "kind", "snippet", "url"]} /> },
    { id: "memory", label: "记忆", cat: "notice", body: <DeferredPanel<MemoryEntry> title="记忆" futureTool="GET /api/memory" fields={["id", "text", "tags", "created_at"]} /> },
  ];
  const current = [...modules, ...deferred].find((m) => m.id === selected) ?? modules[0];

  return (
    <div className="dashboard directory-view">
      <nav className="dir-nav">
        {modules.map((m) => (
          <button
            key={m.id}
            className={`dir-nav-item cat-${m.cat}${selected === m.id ? " active" : ""}`}
            onClick={() => setSelected(m.id)}
          >
            {m.label}
          </button>
        ))}
        <div className="dir-nav-sep">待接入（P3）</div>
        {deferred.map((m) => (
          <button
            key={m.id}
            className={`dir-nav-item cat-${m.cat}${selected === m.id ? " active" : ""} deferred`}
            onClick={() => setSelected(m.id)}
          >
            {m.label}
          </button>
        ))}
      </nav>
      <div className="dir-content">{current.body}</div>
    </div>
  );
}
