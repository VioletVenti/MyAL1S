// Shared star state. A starred assignment / announcement surfaces in the 待办
// module + on the calendar. The star set is owned once (StarProvider) so every
// StarToggle across the dashboard reflects the same truth and a toggle in one
// panel updates the others — no per-component fetching or drift.

import { type ReactNode, createContext, useCallback, useContext, useEffect, useState } from "react";
import type { StarSource } from "./api";
import { fetchStars, removeStar, setStar } from "./api";

interface StarCtx {
  starred: Set<string>;
  isStarred: (source: StarSource, itemId: string) => boolean;
  toggle: (
    source: StarSource,
    itemId: string,
    snapshot?: { title?: string | null; course?: string | null; date?: string | null },
  ) => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<StarCtx | null>(null);

export function StarProvider({ children, onChange }: { children: ReactNode; onChange?: () => void }) {
  const [starred, setStarred] = useState<Set<string>>(new Set());

  const refresh = useCallback(async () => {
    const env = await fetchStars();
    if (env.status === "ok") {
      setStarred(new Set(env.data.stars.map((s) => `${s.source}:${s.item_id}`)));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isStarred = useCallback(
    (source: StarSource, itemId: string) => starred.has(`${source}:${itemId}`),
    [starred],
  );

  const toggle: StarCtx["toggle"] = useCallback(
    async (source, itemId, snapshot) => {
      const key = `${source}:${itemId}`;
      if (starred.has(key)) {
        await removeStar(source, itemId);
        setStarred((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      } else {
        await setStar(source, itemId, snapshot ?? {});
        setStarred((prev) => new Set(prev).add(key));
      }
      onChange?.();
    },
    [starred, onChange],
  );

  return <Ctx.Provider value={{ starred, isStarred, toggle, refresh }}>{children}</Ctx.Provider>;
}

export function useStars(): StarCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStars must be used inside <StarProvider>");
  return ctx;
}

export function StarToggle({
  source,
  itemId,
  snapshot,
}: {
  source: StarSource;
  itemId: string;
  snapshot?: { title?: string | null; course?: string | null; date?: string | null };
}) {
  const { isStarred, toggle } = useStars();
  const on = isStarred(source, itemId);
  return (
    <button
      className={`star-toggle${on ? " on" : ""}`}
      title={on ? "取消星标（移出待办/日历）" : "星标 → 加入待办 / 日历"}
      onClick={() => void toggle(source, itemId, snapshot)}
    >
      {on ? "★" : "☆"}
    </button>
  );
}
