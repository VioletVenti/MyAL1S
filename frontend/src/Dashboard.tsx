// Dashboard composition root: the whole main (non-chat) content area. Stacks
// the weekly Calendar, 待办 / 新到通知 modules, the teaching-network listing
// panels (作业 / 课程通知 / 课程材料 / 课程回放 / 成绩), and the four deferred-source
// placeholders. Deterministic data only — nothing here goes through the LLM.

import { type ReactNode, useEffect } from "react";
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
import NewNoticesPanel from "./NewNoticesPanel";
import TodoModule from "./TodoModule";
import { StarToggle } from "./stars";
import { EnvelopeBody, Panel, useEnvelope } from "./widgets";

function AssignmentsPanel({ refreshKey }: { refreshKey: number }) {
  const { env, loading, reload } = useEnvelope(() => fetchAssignments(false));
  // refreshKey is read via the hook's loader identity; bump via App remounts
  // the dashboard. Keep an effect-free refresh by depending on refreshKey:
  useRefresh(refreshKey, reload);
  return (
    <Panel title="作业 · 按 DDL" loading={loading} onReload={reload}>
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
                  <span className="ddl">{a.deadline_raw ?? a.deadline ?? "无截止"}</span>
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
    <Panel title="课程通知" loading={loading} onReload={reload}>
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
                    <span className="ddl">{a.time ?? ""}</span>
                  </div>
                  {a.descriptions.length > 0 && <div className="ann-desc">{a.descriptions.join(" / ")}</div>}
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
    <Panel title="课程材料" loading={loading} onReload={reload}>
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
                  <span className="title">{m.title} <span className="muted">[{m.kind}]</span></span>
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
    <Panel title="课程回放" loading={loading} onReload={reload}>
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
                  <span className="ddl">{v.time}</span>
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
    <Panel title="成绩" loading={loading} onReload={reload}>
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

/** Re-run `reload` whenever refreshKey changes (login / auto-refresh / mutations).
 * `reload` is stable (useCallback []), so this safely re-fetches on key change. */
function useRefresh(refreshKey: number, reload: () => void) {
  useEffect(() => {
    reload();
  }, [refreshKey, reload]);
}

export default function Dashboard({
  refreshKey,
  bump,
}: {
  refreshKey: number;
  bump: () => void;
}): ReactNode {
  return (
    <div className="dashboard">
      <Calendar refreshKey={refreshKey} />
      <TodoModule refreshKey={refreshKey} bump={bump} />
      <NewNoticesPanel refreshKey={refreshKey} bump={bump} />
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
