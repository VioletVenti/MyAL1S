// 待办 module: the composed "important-but-undone" list from /api/todo (starred
// assignments + starred announcements + custom items), sorted by anchor date.
// A create form sits at the top; each row offers a context-appropriate action
// (star → unstar; custom → done/edit/delete). Refreshes when refreshKey bumps
// (login, auto-refresh, or a star/custom change elsewhere).

import { useCallback, useEffect, useState } from "react";
import { fetchTodo } from "./api";
import type { Envelope, TodoItem } from "./api";
import { CustomItemForm, CustomTodoRow } from "./CustomItemEditor";
import { StarToggle, useStars } from "./stars";
import { Panel } from "./widgets";

export default function TodoModule({
  refreshKey,
  bump,
}: {
  refreshKey: number;
  bump: () => void;
}) {
  const [env, setEnv] = useState<Envelope<{ items: TodoItem[] }> | null>(null);
  const [loading, setLoading] = useState(false);
  const { isStarred } = useStars();

  const reload = useCallback(() => {
    setLoading(true);
    fetchTodo()
      .then(setEnv)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  const items = env && env.status === "ok" ? env.data.items : [];

  return (
    <Panel title="待办 · 按 DDL" loading={loading} onReload={reload}>
      <CustomItemForm onCreated={bump} />
      {!env ? (
        <p className="muted">{loading ? "加载中…" : "—"}</p>
      ) : env.status === "needs_otp" ? (
        <p className="notice">需要登录后才能看到星标作业/公告（{env.hint}）</p>
      ) : env.status === "error" ? (
        <p className="error">出错了：{env.message}</p>
      ) : items.length === 0 ? (
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
                <span className="ddl">{it.date ?? ""}</span>
                <span className="row-actions">
                  {/* StarToggle un-stars (since these are all starred); snapshot
                      kept so the calendar still shows it if re-starred. */}
                  {it.source && it.id && isStarred(it.source as "assignment" | "announcement", it.id) ? (
                    <StarToggle source={it.source as "assignment" | "announcement"} itemId={it.id} />
                  ) : null}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </Panel>
  );
}
