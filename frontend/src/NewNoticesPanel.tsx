// 新到通知 panel: assignment + announcement items new since the last mark-seen
// (seen-id diff on the backend). "标记已读" merges the current ids into the
// seen set, clearing the panel until something new arrives.

import type { Announcement, Assignment } from "./api";
import { fetchNewNotices, markNoticesSeen } from "./api";
import { StarToggle } from "./stars";
import { EnvelopeBody, Panel, useEnvelope, useRefresh } from "./widgets";

export default function NewNoticesPanel({
  refreshKey,
  bump,
}: {
  refreshKey: number;
  bump: () => void;
}) {
  const { env, loading, reload } = useEnvelope(fetchNewNotices);
  useRefresh(refreshKey, reload);

  const markSeen = async () => {
    await markNoticesSeen();
    bump();
    reload();
  };

  return (
    <Panel title="新到通知" loading={loading} onReload={reload}>
      <EnvelopeBody
        env={env}
        loading={loading}
        renderData={(d) => {
          const a = d.assignment ?? [];
          const n = d.announcement ?? [];
          if (a.length === 0 && n.length === 0) {
            return <p className="muted">没有新通知 ✓</p>;
          }
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
        }}
      />
    </Panel>
  );
}
