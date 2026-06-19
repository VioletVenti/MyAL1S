import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  type Assignment,
  type Envelope,
  type Grade,
  fetchAssignments,
  fetchCourseTable,
  fetchGrades,
} from "./api";

/** Load an envelope and track loading state; `reload` re-fetches. */
function useEnvelope<T>(loader: () => Promise<Envelope<T>>) {
  const [env, setEnv] = useState<Envelope<T> | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(() => {
    setLoading(true);
    loader()
      .then(setEnv)
      .finally(() => setLoading(false));
    // loader identity is stable per panel; intentional single-shot dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => reload(), [reload]);
  return { env, loading, reload };
}

function Panel({
  title,
  loading,
  onReload,
  children,
}: {
  title: string;
  loading: boolean;
  onReload: () => void;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <header>
        <h2>{title}</h2>
        <button onClick={onReload} disabled={loading}>
          {loading ? "加载中…" : "刷新"}
        </button>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

/** Render envelope status; delegate the `ok` case to `renderData`. */
function EnvelopeBody<T>({
  env,
  loading,
  renderData,
}: {
  env: Envelope<T> | null;
  loading: boolean;
  renderData: (data: T) => ReactNode;
}) {
  if (!env) return <p className="muted">{loading ? "加载中…" : "—"}</p>;
  if (env.status === "needs_otp")
    return (
      <p className="notice">
        需要登录 / 手机令牌{env.mobile_mask ? `（${env.mobile_mask}）` : ""}。{env.hint}
      </p>
    );
  if (env.status === "error") return <p className="error">出错了：{env.message}</p>;
  return <>{renderData(env.data)}</>;
}

function AssignmentsPanel() {
  const { env, loading, reload } = useEnvelope(() => fetchAssignments(false));
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
              {d.assignments.map((a: Assignment, i) => (
                <li key={i}>
                  <span className="course">{a.course}</span>
                  <span className="title">{a.title}</span>
                  <span className="ddl">{a.deadline_raw ?? a.deadline ?? "无截止时间"}</span>
                </li>
              ))}
            </ul>
          )
        }
      />
    </Panel>
  );
}

function GradesPanel() {
  const { env, loading, reload } = useEnvelope(fetchGrades);
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

const DAYS: [string, string][] = [
  ["mon", "周一"],
  ["tue", "周二"],
  ["wed", "周三"],
  ["thu", "周四"],
  ["fri", "周五"],
  ["sat", "周六"],
  ["sun", "周日"],
];

/** Best-effort render of the portal's course-table JSON; raw fallback. */
function renderCourseTable(data: unknown): ReactNode {
  const slots = (data as { course?: unknown })?.course;
  if (!Array.isArray(slots)) {
    return (
      <details>
        <summary>原始课表数据</summary>
        <pre>{JSON.stringify(data, null, 2)}</pre>
      </details>
    );
  }
  return (
    <div className="timetable">
      {DAYS.map(([key, label]) => {
        const items = slots
          .map((slot, idx) => {
            const name = (slot as Record<string, { courseName?: string }>)?.[key]?.courseName;
            return name ? { period: idx + 1, name } : null;
          })
          .filter((x): x is { period: number; name: string } => x !== null);
        if (items.length === 0) return null;
        return (
          <div className="day" key={key}>
            <h4>{label}</h4>
            <ul>
              {items.map((it) => (
                <li key={it.period}>
                  第 {it.period} 节 · {it.name}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function CourseTablePanel() {
  const { env, loading, reload } = useEnvelope(fetchCourseTable);
  return (
    <Panel title="课表" loading={loading} onReload={reload}>
      <EnvelopeBody env={env} loading={loading} renderData={renderCourseTable} />
    </Panel>
  );
}

export default function Dashboard() {
  return (
    <div className="dashboard">
      <AssignmentsPanel />
      <CourseTablePanel />
      <GradesPanel />
    </div>
  );
}
