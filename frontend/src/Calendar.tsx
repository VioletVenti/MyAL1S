// Weekly calendar: a 7-day grid of the recurring 课表 (period-based), with a
// click-to-reveal overlay of that day's starred assignments / starred
// announcements / custom items (from /api/calendar). Default view shows classes
// only — items appear when a day is expanded. Custom React grid, no calendar lib.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Envelope, TodoItem } from "./api";
import { fetchCalendar } from "./api";
import { EnvelopeBody, WEEKDAYS } from "./widgets";

// ---- ISO-week helpers (pure) --------------------------------------------

function isoWeekOf(d: Date): string {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const isoDay = tmp.getUTCDay() === 0 ? 7 : tmp.getUTCDay(); // Mon=1..Sun=7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - isoDay); // nearest Thursday
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

function shiftWeek(week: string, deltaWeeks: number): string {
  const [y, w] = week.split("-W");
  const jan4 = new Date(Date.UTC(Number(y), 0, 4));
  const isoDayJan4 = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (isoDayJan4 - 1));
  const mon = new Date(week1Mon);
  mon.setUTCDate(week1Mon.getUTCDate() + (Number(w) - 1 + deltaWeeks) * 7);
  return isoWeekOf(mon);
}

/** The 7 UTC dates (Mon..Sun) of an ISO week. */
function datesOfWeek(week: string): Date[] {
  const [y, w] = week.split("-W");
  const jan4 = new Date(Date.UTC(Number(y), 0, 4));
  const isoDayJan4 = jan4.getUTCDay() === 0 ? 7 : jan4.getUTCDay();
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (isoDayJan4 - 1));
  const mon = new Date(week1Mon);
  mon.setUTCDate(week1Mon.getUTCDate() + (Number(w) - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(mon);
    d.setUTCDate(mon.getUTCDate() + i);
    return d;
  });
}

function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/** "Today" as a UTC date key. Computed once so every comparison (initial week,
 *  the 本周 button, the today-highlight) agrees with the UTC-based dateKey the
 *  cells use — avoids the local-vs-UTC slip where a cell keyed in UTC could
 *  render a different day label. */
function todayUtcKey(): string {
  const n = new Date();
  return dateKey(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
}

function itemDateKey(item: TodoItem): string | null {
  if (!item.date) return null;
  const d = new Date(item.date);
  return isNaN(d.getTime()) ? null : dateKey(d);
}

// ---- course-table parsing (mirrors Dashboard.renderCourseTable) ----------

interface Slot {
  period: number;
  name: string;
}

/** Extract per-weekday class lists from the portal course-table JSON. */
function classesByDay(courseTable: Envelope<unknown>): Record<string, Slot[]> {
  if (courseTable.status !== "ok") return {};
  const slots = (courseTable.data as { course?: unknown })?.course;
  if (!Array.isArray(slots)) return {};
  const out: Record<string, Slot[]> = {};
  for (const [key] of WEEKDAYS) out[key] = [];
  slots.forEach((slot, idx) => {
    WEEKDAYS.forEach(([key]) => {
      const name = (slot as Record<string, { courseName?: string }>)?.[key]?.courseName;
      if (name) out[key].push({ period: idx + 1, name });
    });
  });
  return out;
}

// ---- component -----------------------------------------------------------

export default function Calendar({ refreshKey }: { refreshKey: number }) {
  // Initial week from today (UTC-normalized, matching dateKey); memoized so it
  // is stable across renders.
  const [week, setWeek] = useState(() => {
    const n = new Date();
    return isoWeekOf(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
  });
  const [env, setEnv] = useState<Envelope<{ course_table: Envelope<unknown>; items: TodoItem[]; week: string }> | null>(null);
  const [loading, setLoading] = useState(false);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    fetchCalendar(week).finally(() => setLoading(false)).then(setEnv).catch(() => setLoading(false));
  }, [week]);

  useEffect(() => {
    reload();
  }, [reload, refreshKey]);

  const courseTable: Envelope<unknown> = env && env.status === "ok" ? env.data.course_table : { status: "error", message: "未加载" };
  const items: TodoItem[] = env && env.status === "ok" ? env.data.items : [];
  const classes = useMemo(() => classesByDay(courseTable), [courseTable]);
  const dates = useMemo(() => datesOfWeek(week), [week]);

  // Bucket composer items by their date for the per-day reveal.
  const itemsByDate = useMemo(() => {
    const m: Record<string, TodoItem[]> = {};
    for (const it of items) {
      const k = itemDateKey(it);
      if (!k) continue;
      (m[k] ??= []).push(it);
    }
    return m;
  }, [items]);

  return (
    <section className="panel calendar">
      <header>
        <h2>周历 · {week}</h2>
        <span className="panel-actions">
          <button onClick={() => setWeek((w) => shiftWeek(w, -1))}>‹ 上一周</button>
          <button onClick={() => setWeek(() => {
            const n = new Date();
            return isoWeekOf(new Date(Date.UTC(n.getFullYear(), n.getMonth(), n.getDate())));
          })}>本周</button>
          <button onClick={() => setWeek((w) => shiftWeek(w, 1))}>下一周 ›</button>
          <button onClick={reload} disabled={loading}>{loading ? "加载中…" : "刷新"}</button>
        </span>
      </header>
      <div className="panel-body">
        <EnvelopeBody
          env={courseTable}
          loading={loading}
          renderData={() => (
            <div className="calendar-grid">
              {dates.map((d, i) => {
                const [key, label] = WEEKDAYS[i];
                const dKey = dateKey(d);
                const cls = classes[key] ?? [];
                const dayItems = itemsByDate[dKey] ?? [];
                const open = openDay === dKey;
                const today = todayUtcKey() === dKey;
                return (
                  <div
                    key={dKey}
                    className={`cal-day${today ? " today" : ""}${dayItems.length ? " has-items" : ""}`}
                  >
                    <button
                      className="cal-day-head"
                      onClick={() => setOpenDay(open ? null : dKey)}
                      title={dayItems.length ? `${dayItems.length} 个待办/星标` : ""}
                    >
                      <strong>{label}</strong>
                      <span className="cal-date">{d.getUTCMonth() + 1}/{d.getUTCDate()}</span>
                      {dayItems.length > 0 && <span className="cal-badge">★{dayItems.length}</span>}
                    </button>
                    <ul className="cal-classes">
                      {cls.map((c) => (
                        <li key={c.period}>第{c.period}节 · {c.name}</li>
                      ))}
                      {cls.length === 0 && <li className="muted">无课</li>}
                    </ul>
                    {open && (
                      <ul className="cal-items">
                        {dayItems.length === 0 && <li className="muted">这一天没有星标/待办</li>}
                        {dayItems.map((it) => (
                          <li key={it.id} className={it.done ? "done" : ""}>
                            <span className="cal-item-kind">
                              {it.kind === "custom" ? "自定义" : it.source === "announcement" ? "公告" : "作业"}
                            </span>
                            <span>{it.title}</span>
                            {it.course && <span className="muted"> · {it.course}</span>}
                            {it.submitted === true && <span className="muted"> (已交)</span>}
                            {it.done && <span className="muted"> (已完成)</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        />
        <p className="muted cal-hint">默认只显示课表；点击日期可展开当天的星标作业 / 公告 / 自定义待办。</p>
      </div>
    </section>
  );
}
