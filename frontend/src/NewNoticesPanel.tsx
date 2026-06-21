// 新到通知 panel: assignment + announcement items new since the last mark-seen
// (seen-id diff on the backend). "标记已读" merges the current ids into the
// seen set, clearing the panel until something new arrives.

import { useCallback, useEffect, useState } from "react";
import type { Announcement, Assignment, Envelope, NewNotices } from "./api";
import { fetchNewNotices, markNoticesSeen } from "./api";
import { StarToggle } from "./stars";
import { Panel } from "./widgets";

export default function NewNoticesPanel({
  refreshKey,
  bump,
}: {
  refreshKey: number;
  bump: () => void;
}) {
  const [env, setEnv] = useState<Envelope<NewNotices> | null>(null);
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    fetchNewNotices()
      .then(setEnv)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  async function markSeen() {
    await markNoticesSeen();
    bump();
    reload();
  }

  const body = () => {
    if (!env) return <p className="muted">{loading ? "加载中…" : "—"}</p>;
    if (env.status === "needs_otp") return <p className="notice">需要登录后才能检测新通知。</p>;
    if (env.status === "error") return <p className="error">出错了：{env.message}</p>;
    const a = env.data.assignment ?? [];
    const n = env.data.announcement ?? [];
    const total = a.length + n.length;
    if (total === 0) return <p className="muted">没有新通知 ✓</p>;
    return (
      <>
        {a.length > 0 && (
          <>
            <h4 className="subhead">新作业（{a.length}）</h4>
            <ul className="list notices">
              {a.map((x: Assignment) => (
                <li key={x.id}>
                  <span className="muted">{x.course}</span>
                  <span className="title">{x.title}</span>
                  <span className="ddl">{x.deadline_raw ?? x.deadline ?? ""}</span>
                  <span className="row-actions">
                    <StarToggle source="assignment" itemId={x.id} snapshot={{ title: x.title, course: x.course, date: x.deadline }} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        {n.length > 0 && (
          <>
            <h4 className="subhead">新公告（{n.length}）</h4>
            <ul className="list notices">
              {n.map((x: Announcement) => (
                <li key={x.id}>
                  <span className="muted">{x.course}</span>
                  <span className="title">{x.title}</span>
                  <span className="ddl">{x.time ?? ""}</span>
                  <span className="row-actions">
                    <StarToggle source="announcement" itemId={x.id} snapshot={{ title: x.title, course: x.course, date: x.time }} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
        <button className="ghost" onClick={() => void markSeen()}>标记已读</button>
      </>
    );
  };

  return (
    <Panel title="新到通知" loading={loading} onReload={reload}>
      {body()}
    </Panel>
  );
}
