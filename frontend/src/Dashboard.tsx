// Dashboard composition root. Two views (toggled in App via the `view` prop):
//   - "main": the glanceable subset — Calendar + 待办 + 新到通知
//   - "directory": the full listing panels (作业/课程通知/材料/回放/成绩 + 延后源)
// All raw teaching-network fields pass through `format.ts` before rendering, so
// no blobs / Debug-names / raw timestamps reach the DOM. Deterministic only.

import { type ReactNode } from "react";
import {
  type Announcement,
  type Assignment,
  type DeanUpdate,
  type DocResult,
  type Grade,
  type Material,
  type MemoryEntry,
  type TreeholePost,
  type Video,
  fetchAnnouncements,
  fetchAssignments,
  fetchGrades,
  fetchMaterials,
  fetchVideos,
} from "./api";
import Calendar from "./Calendar";
import DeferredPanel from "./DeferredPanel";
import { fmtAnnouncementTime, fmtDate, fmtDeadline, fmtDescription, kindLabel } from "./format";
import NewNoticesPanel from "./NewNoticesPanel";
import TodoModule from "./TodoModule";
import { StarToggle } from "./stars";
import { EnvelopeBody, Panel, useEnvelope, useRefresh } from "./widgets";

function AssignmentsPanel({ refreshKey }: { refreshKey: number }) {
  const { env, loading, reload } = useEnvelope(() => fetchAssignments(false));
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
            <ul className="list">
              {d.assignments.map((a: Assignment) => (
                <li key={a.id}>
                  <span className="course">{a.course}</span>
                  <span className="title">{a.title}</span>
                  <span className="ddl">{fmtDeadline(a.deadline, a.deadline_raw)}</span>
                  <span className="row-actions">
                    <StarToggle source="assignment" itemId={a.id} snapshot={{ title: a.title, course: a.course, date: a.deadline }} />
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      />
    </Panel>
  );
}

function AnnouncementsPanel({ refreshKey }: { refreshKey: number }) {
  const { env, loading, reload } = useEnvelope(fetchAnnouncements);
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
            <ul className="list announcements">
              {d.announcements.map((a: Announcement) => (
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
          )
        }
      />
    </Panel>
  );
}

function MaterialsPanel({ refreshKey }: { refreshKey: number }) {
  const { env, loading, reload } = useEnvelope(fetchMaterials);
  useRefresh(refreshKey, reload);
  return (
    <Panel title="课程材料" loading={loading} onReload={reload} category="material">
      <EnvelopeBody
        env={env}
        loading={loading}
        renderData={(d) =>
          d.materials.length === 0 ? (
            <p className="muted">暂无课程材料</p>
          ) : (
            <ul className="list">
              {d.materials.map((m: Material, i) => (
                <li key={`${m.ccid}-${i}`}>
                  <span className="course">{m.course}</span>
                  <span className="title">
                    {m.title} <span className="kind-chip">{kindLabel(m.kind)}</span>
                  </span>
                  <span className="ddl">{m.attachment_count > 0 ? `${m.attachment_count} 附件` : ""}</span>
                </li>
              ))}
            </ul>
          )
        }
      />
    </Panel>
  );
}

function VideosPanel({ refreshKey }: { refreshKey: number }) {
  const { env, loading, reload } = useEnvelope(fetchVideos);
  useRefresh(refreshKey, reload);
  return (
    <Panel title="课程回放" loading={loading} onReload={reload} category="video">
      <EnvelopeBody
        env={env}
        loading={loading}
        renderData={(d) =>
          d.videos.length === 0 ? (
            <p className="muted">暂无回放</p>
          ) : (
            <ul className="list">
              {d.videos.map((v: Video) => (
                <li key={v.id}>
                  <span className="course">{v.course}</span>
                  <span className="title">{v.title}</span>
                  <span className="ddl">{fmtDate(v.time, false)}</span>
                </li>
              ))}
            </ul>
          )
        }
      />
    </Panel>
  );
}

function GradesPanel({ refreshKey }: { refreshKey: number }) {
  const { env, loading, reload } = useEnvelope(fetchGrades);
  useRefresh(refreshKey, reload);
  return (
    <Panel title="成绩" loading={loading} onReload={reload} category="grade">
      <EnvelopeBody
        env={env}
        loading={loading}
        renderData={(d) =>
          d.grades.length === 0 ? (
            <p className="muted">暂无成绩</p>
          ) : (
            <ul className="list">
              {d.grades.map((g: Grade, i) => (
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
          )
        }
      />
    </Panel>
  );
}

export type DashboardView = "main" | "directory";

export default function Dashboard({
  view,
  refreshKey,
  bump,
}: {
  view: DashboardView;
  refreshKey: number;
  bump: () => void;
}): ReactNode {
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
  return (
    <div className="dashboard directory-view">
      <div className="panel-grid">
        <AssignmentsPanel refreshKey={refreshKey} />
        <AnnouncementsPanel refreshKey={refreshKey} />
        <MaterialsPanel refreshKey={refreshKey} />
        <VideosPanel refreshKey={refreshKey} />
        <GradesPanel refreshKey={refreshKey} />
        <DeferredPanel<DeanUpdate>
          title="教务通知"
          futureTool="MCP: get_dean_updates"
          fields={["id", "title", "time", "category", "url", "summary"]}
        />
        <DeferredPanel<TreeholePost>
          title="北大树洞"
          futureTool="MCP: list_treehole_posts / get_treehole_post"
          fields={["id", "title", "body", "time", "tags", "reply_count"]}
        />
        <DeferredPanel<DocResult>
          title="文档库"
          futureTool="GET /api/docs/search"
          fields={["id", "title", "course", "kind", "snippet", "url"]}
        />
        <DeferredPanel<MemoryEntry>
          title="记忆"
          futureTool="GET /api/memory"
          fields={["id", "text", "tags", "created_at"]}
        />
      </div>
    </div>
  );
}
