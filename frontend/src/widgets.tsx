// Shared presentational primitives + hooks used across the dashboard panels.
// Kept here (not in Dashboard.tsx) so Calendar.tsx and the new panels can reuse
// them without importing Dashboard (which would be circular).

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Envelope } from "./api";

/** Load an envelope and track loading state; `reload` re-fetches.
 *
 * If `cacheKey` is given, the last successfully-fetched envelope is mirrored to
 * `localStorage` and used as the initial state — so a page refresh paints the
 * previous content instantly, before the network resolves. (The backend snapshot
 * cache survives a backend restart; localStorage covers the browser-refresh
 * instant first paint. Both compose.) localStorage failures are swallowed — the
 * hook degrades to memory-only, never throws. */
export function useEnvelope<T>(
  loader: () => Promise<Envelope<T>>,
  opts?: { cacheKey?: string },
) {
  const cacheKey = opts?.cacheKey;
  const [env, setEnv] = useState<Envelope<T> | null>(() => {
    if (!cacheKey) return null;
    return readCache<Envelope<T>>(cacheKey);
  });
  const [loading, setLoading] = useState(false);

  const reload = useCallback(() => {
    setLoading(true);
    loader()
      .then((e) => {
        setEnv(e);
        if (cacheKey && e.status === "ok") writeCache(cacheKey, e);
      })
      .finally(() => setLoading(false));
    // loader identity is stable per panel; intentional single-shot dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => reload(), [reload]);
  return { env, loading, reload };
}

// ---- localStorage helpers (total: swallow all errors) --------------------

const CACHE_PREFIX = "myal1s.env.";

function readCache<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown): void {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(value));
  } catch {
    /* quota / disabled — degrade silently */
  }
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

/** Paginate a list. Returns the current page slice + nav. `pageSize` defaults to
 *  15. Resets to page 1 whenever the list length shrinks past the current page
 *  (e.g. after a filter) so the user isn't stranded on an empty page. */
export function usePagination<T>(items: T[], pageSize = 15) {
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pages);
  const slice = useMemo(
    () => items.slice((safePage - 1) * pageSize, safePage * pageSize),
    [items, safePage, pageSize],
  );
  useEffect(() => {
    if (page > pages) setPage(pages);
  }, [page, pages]);
  return {
    page: safePage,
    pages,
    slice,
    prev: () => setPage((p) => Math.max(1, p - 1)),
    next: () => setPage((p) => Math.min(pages, p + 1)),
    first: () => setPage(1),
  };
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

/** Render envelope status; delegate the `ok` case to `renderData`. A `stale`
 *  envelope (served from the backend snapshot cache when live failed) renders a
 *  "上次更新 …" badge so the user knows it isn't fresh. */
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
  const stale = (env as { stale?: boolean }).stale;
  const fetchedAt = (env as { fetched_at?: string }).fetched_at;
  return (
    <>
      {stale && (
        <p className="stale-badge notice">
          离线缓存（上次更新{fetchedAt ? ` ${fmtStamp(fetchedAt)}` : ""}）— 登录后可刷新。
        </p>
      )}
      {renderData(env.data)}
    </>
  );
}

/** List pager controls: ‹ 第 N/M 页 › (hidden when only one page). */
export function Pager({
  page,
  pages,
  onPrev,
  onNext,
}: {
  page: number;
  pages: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  if (pages <= 1) return null;
  return (
    <div className="pager">
      <button className="ghost" onClick={onPrev} disabled={page <= 1}>‹ 上一页</button>
      <span className="muted">第 {page} / {pages} 页</span>
      <button className="ghost" onClick={onNext} disabled={page >= pages}>下一页 ›</button>
    </div>
  );
}

/** Compact "time ago"/timestamp formatter for the stale badge. */
function fmtStamp(iso: string): string {
  // iso is a UTC ISO string from the backend (_now()). Show local M/D HH:MM.
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso.slice(0, 16);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}-${dd} ${hh}:${mi}`;
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
