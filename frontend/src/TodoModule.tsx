// 待办 module: the composed "important-but-undone" list from /api/todo (starred
// assignments + starred announcements + custom items), sorted by anchor date.
// A create form sits at the top; each row offers a context-appropriate action
// (star → unstar; custom → done/edit/delete). Refreshes when refreshKey bumps
// (login, auto-refresh, or a star/custom change elsewhere).

import { fetchTodo } from "./api";
import { CustomItemForm, CustomTodoRow } from "./CustomItemEditor";
import { fmtDeadline, fmtDate } from "./format";
import { StarToggle } from "./stars";
import { EnvelopeBody, Panel, useEnvelope, useRefresh } from "./widgets";

export default function TodoModule({
  refreshKey,
  bump,
}: {
  refreshKey: number;
  bump: () => void;
}) {
  const { env, loading, reload } = useEnvelope(fetchTodo);
  // Re-fetch when refreshKey changes (login / auto-refresh / star+custom mutations),
  // but not on first mount (useEnvelope already does that — avoids a double fetch).
  useRefresh(refreshKey, reload);
  const items = env && env.status === "ok" ? env.data.items : [];

  return (
    <Panel title="待办 · 按 DDL" loading={loading} onReload={reload} category="todo">
      <CustomItemForm onCreated={bump} />
      <EnvelopeBody
        env={env}
        loading={loading}
        renderData={() =>
          items.length === 0 ? (
            <p className="muted">没有待办 🎉 用上面的表单新增，或在作业/公告里点 ☆ 标记重要项。</p>
          ) : (
            <ul className="list todo">
              {items.map((it) =>
                it.kind === "custom" ? (
                  <CustomTodoRow key={it.id} item={it} onChanged={bump} />
                ) : (
                  <li key={it.id}>
                    <span className="cal-item-kind">
                      {it.source === "announcement" ? "公告" : "作业"}
                    </span>
                    <span className="title">
                      {it.title}
                      {it.submitted === true && <span className="muted"> (已交)</span>}
                      {it.live === false && <span className="muted"> (快照)</span>}
                    </span>
                    <span className="muted">{it.course}</span>
                    <span className="ddl">
                      {it.source === "announcement"
                        ? fmtDate(it.date, false)
                        : fmtDeadline(it.date, null)}
                    </span>
                    {/* Render the toggle unconditionally: these items are starred
                        server-side, and StarToggle reads the live star set from
                        the provider, so it shows the correct ★/☆ regardless of
                        whether fetchStars has resolved yet (no first-paint race). */}
                    {it.source === "assignment" || it.source === "announcement" ? (
                      <span className="row-actions">
                        <StarToggle source={it.source} itemId={it.id} />
                      </span>
                    ) : null}
                  </li>
                ),
              )}
            </ul>
          )
        }
      />
    </Panel>
  );
}
