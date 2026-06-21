// Shared presentational primitives + hooks used across the dashboard panels.
// Kept here (not in Dashboard.tsx) so Calendar.tsx and the new panels can reuse
// them without importing Dashboard (which would be circular).

import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import type { Envelope } from "./api";

/** Load an envelope and track loading state; `reload` re-fetches. */
export function useEnvelope<T>(loader: () => Promise<Envelope<T>>) {
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

/** Re-run `reload` when `refreshKey` changes (login / auto-refresh / mutations),
 *  but NOT on first mount — `useEnvelope` already fetches once on mount, so
 *  calling reload here too would double-fetch every panel on initial load. */
export function useRefresh(refreshKey: number, reload: () => void) {
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    reload();
  }, [refreshKey, reload]);
}

export type Category =
  | "calendar"
  | "todo"
  | "notice"
  | "assignment"
  | "announcement"
  | "material"
  | "video"
  | "grade";

export function Panel({
  title,
  loading,
  onReload,
  actions,
  category,
  children,
}: {
  title: string;
  loading?: boolean;
  onReload?: () => void;
  actions?: ReactNode;
  category?: Category;
  children: ReactNode;
}) {
  return (
    <section className={`panel${category ? ` cat-${category}` : ""}`}>
      <header>
        <h2>{title}</h2>
        <span className="panel-actions">
          {actions}
          {onReload && (
            <button onClick={onReload} disabled={loading}>
              {loading ? "加载中…" : "刷新"}
            </button>
          )}
        </span>
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}

/** Render envelope status; delegate the `ok` case to `renderData`. */
export function EnvelopeBody<T>({
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

/** Short weekday labels in ISO order (Mon..Sun), paired with their api key. */
export const WEEKDAYS: [string, string][] = [
  ["mon", "周一"],
  ["tue", "周二"],
  ["wed", "周三"],
  ["thu", "周四"],
  ["fri", "周五"],
  ["sat", "周六"],
  ["sun", "周日"],
];
