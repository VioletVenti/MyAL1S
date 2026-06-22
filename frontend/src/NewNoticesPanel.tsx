// 新到通知 panel: assignment + announcement items new since the last mark-seen
// (seen-id diff on the backend). "标记已读" merges the current ids into the
// seen set, clearing the panel until something new arrives.
//
// Compact by design: on the main view this card shares a row with 待办, so it
// shows a count summary + only the first few items per source, with an inline
// "展开全部 N 条" toggle. Nothing is dropped — expanding reveals the rest.

import { useState } from "react";
import type { Announcement, Assignment } from "./api";
import { fetchNewNotices, markNoticesSeen } from "./api";
import { fmtAnnouncementTime, fmtDeadline } from "./format";
import { StarToggle } from "./stars";
import { EnvelopeBody, Panel, useEnvelope, useRefresh } from "./widgets";

/** How many items per source to show before collapsing. */
const PREVIEW = 3;

export default function NewNoticesPanel({
  refreshKey,
  bump,
}: {
  refreshKey: number;
  bump: () => void;
}) {
  const { env, loading, reload } = useEnvelope(fetchNewNotices);
  useRefresh(refreshKey, reload);
  const [expanded, setExpanded] = useState(false);

  const markSeen = async () => {
    await markNoticesSeen();
    bump();
    reload();
  };

  return (
    <Panel title="新到通知" loading={loading} onReload={reload} category="notice">
      <EnvelopeBody
        env={env}
        loading={loading}
        renderData={(d) => {
          const a = d.assignment ?? [];
          const n = d.announcement ?? [];
          if (a.length === 0 && n.length === 0) {
            return <p className="muted">没有新通知 ✓</p>;
          }
          const aView = expanded ? a : a.slice(0, PREVIEW);
          const nView = expanded ? n : n.slice(0, PREVIEW);
          const hidden = a.length + n.length - aView.length - nView.length;
          return (
            <>
              {a.length > 0 && (
                <>
                  <h4 className="subhead">新作业 · {a.length}</h4>
                  <ul className="list notices">
                    {aView.map((x: Assignment) => (
                      <li key={x.id}>
                        <span className="muted">{x.course}</span>
                        <span className="title">{x.title}</span>
                        <span className="ddl">{fmtDeadline(x.deadline, x.deadline_raw)}</span>
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
                  <h4 className="subhead">新公告 · {n.length}</h4>
                  <ul className="list notices">
                    {nView.map((x: Announcement) => (
                      <li key={x.id}>
                        <span className="muted">{x.course}</span>
                        <span className="title">{x.title}</span>
                        <span className="ddl">{fmtAnnouncementTime(x.time)}</span>
                        <span className="row-actions">
                          <StarToggle source="announcement" itemId={x.id} snapshot={{ title: x.title, course: x.course, date: x.time }} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <div className="notices-actions">
                {hidden > 0 && (
                  <button className="ghost linkish" onClick={() => setExpanded(true)}>
                    展开全部 {a.length + n.length} 条（还有 {hidden}）
                  </button>
                )}
                <button className="ghost" onClick={() => void markSeen()}>标记已读</button>
              </div>
            </>
          );
        }}
      />
    </Panel>
  );
}

