// Weekly calendar: a 7-day grid of the recurring 课表 (period-based), with a
// click-to-reveal overlay of that day's starred assignments / starred
// announcements / custom items (from /api/calendar). Default view shows classes
// only — items appear when a day is expanded. Custom React grid, no calendar lib.

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Envelope, TodoItem } from "./api";
import { fetchCalendar } from "./api";
import { parseCourseSlot } from "./format";
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

/** Current wall-clock minutes from midnight (local), for the "现在" red rule. */
function wallNowMinutes(): number {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
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
  room?: string;
  teacher?: string;
}

// ---- period → wall-clock time map (PKU fixed convention) ----------------
// 8:00 start, 50-min class + 10-min break; AM 4 / PM 4 / Eve 3 periods.
// The portal `course[]` array index IS the period number (1-based). Times are
// absolute minutes-from-midnight; the time-axis grid positions a class block by
// its [start,end) minute range.
interface PeriodTime {
  start: number; // minutes from midnight
  end: number;
}
const PERIOD_TIMES: Record<number, PeriodTime> = {
  1: { start: 8 * 60, end: 8 * 60 + 50 }, // 08:00–08:50
  2: { start: 9 * 60, end: 9 * 60 + 50 }, // 09:00–09:50
  3: { start: 10 * 60, end: 10 * 60 + 50 }, // 10:00–10:50
  4: { start: 11 * 60, end: 11 * 60 + 50 }, // 11:00–11:50
  5: { start: 13 * 60, end: 13 * 60 + 50 }, // 13:00–13:50
  6: { start: 14 * 60, end: 14 * 60 + 50 }, // 14:00–14:50
  7: { start: 15 * 60, end: 15 * 60 + 50 }, // 15:00–15:50
  8: { start: 16 * 60, end: 16 * 60 + 50 }, // 16:00–16:50
  9: { start: 18 * 60 + 40, end: 18 * 60 + 40 + 50 }, // 18:40–19:30
  10: { start: 19 * 60 + 40, end: 19 * 60 + 40 + 50 }, // 19:40–20:30
  11: { start: 20 * 60 + 40, end: 20 * 60 + 40 + 50 }, // 20:40–21:30
  12: { start: 21 * 60 + 40, end: 21 * 60 + 40 + 50 }, // 21:40–22:30
};

/** Grid row range (top..bottom of the visible day) + px-per-minute scale. */
const DAY_START_MIN = 8 * 60; // 08:00
const DAY_END_MIN = 22 * 60 + 30; // 22:30 (period 12 ends)
const PX_PER_MIN = 1.15; // ~70px per 50-min class — readable block height
const GAP_MIN = 0; // continuous axis; gaps are drawn as empty rows

/** Minutes → "H:MM" label. */
function minToLabel(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${h}:${String(m).padStart(2, "0")}`;
}


/** Extract per-weekday class lists from the portal course-table JSON, parsing
 *  the raw `courseName` blob into a clean {name, room, teacher} via format.ts
 *  (mirrors pku3b's CLI format_course_info). */
function classesByDay(courseTable: Envelope<unknown>): Record<string, Slot[]> {
  if (courseTable.status !== "ok") return {};
  const slots = (courseTable.data as { course?: unknown })?.course;
  if (!Array.isArray(slots)) return {};
  const out: Record<string, Slot[]> = {};
  for (const [key] of WEEKDAYS) out[key] = [];
  slots.forEach((slot, idx) => {
    WEEKDAYS.forEach(([key]) => {
      const raw = (slot as Record<string, { courseName?: string }>)?.[key]?.courseName;
      if (!raw) return;
      const parsed = parseCourseSlot(raw);
      if (parsed.name)
        out[key].push({ period: idx + 1, name: parsed.name, room: parsed.room, teacher: parsed.teacher });
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
  // "现在" rule: current wall-clock minutes, re-ticked every minute so the red
  // "you are here" line stays live across today's column.
  const [nowMin, setNowMin] = useState(() => wallNowMinutes());
  useEffect(() => {
    const id = setInterval(() => setNowMin(wallNowMinutes()), 60_000);
    return () => clearInterval(id);
  }, []);

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
    <section className="panel calendar cat-calendar">
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
          renderData={() => {
            const daySpan = DAY_END_MIN - DAY_START_MIN;
            const axisHeight = daySpan * PX_PER_MIN + GAP_MIN;
            return (
              <>
                {/* day-header row + time-axis grid share ONE scroll container so
                    horizontal scroll keeps the weekday headers aligned with the
                    columns (and the scrollbar sits under both, not between). */}
                <div className="cal-scroll">
                  {/* ---- day-header row ---- */}
                  <div className="cal-head-row">
                    <span className="cal-corner">时间</span>
                    {dates.map((d, i) => {
                      const label = WEEKDAYS[i][1];
                      const dKey = dateKey(d);
                      const dayItems = itemsByDate[dKey] ?? [];
                      const today = todayUtcKey() === dKey;
                      return (
                        <button
                          key={dKey}
                          className={`cal-head${today ? " today" : ""}${dayItems.length ? " has-items" : ""}`}
                          onClick={() => setOpenDay(openDay === dKey ? null : dKey)}
                          title={dayItems.length ? `${dayItems.length} 个待办/星标` : ""}
                        >
                          <strong>{label}</strong>
                          <span className="cal-date">{d.getUTCMonth() + 1}/{d.getUTCDate()}</span>
                          {dayItems.length > 0 && <span className="cal-badge">★{dayItems.length}</span>}
                        </button>
                      );
                    })}
                  </div>

                {/* ---- time-axis grid ---- */}
                <div className="cal-tt">
                  {/* left time axis: one label per period (number + time range),
                      positioned at the same top as the class block. Avoids the
                      dangling "8:00" tick that the header row clipped. */}
                  <div className="cal-axis" style={{ height: axisHeight }}>
                    {Object.entries(PERIOD_TIMES).map(([pStr, t]) => {
                      const top = (t.start - DAY_START_MIN) * PX_PER_MIN;
                      const h = (t.end - t.start) * PX_PER_MIN;
                      return (
                        <div key={pStr} className="cal-slot-label" style={{ top, height: h }}>
                          <span className="cal-slot-no">{pStr}</span>
                          <span className="cal-slot-time">{minToLabel(t.start)}–{minToLabel(t.end)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {/* 7 day columns */}
                  {dates.map((d, i) => {
                    const [key] = WEEKDAYS[i];
                    const dKey = dateKey(d);
                    const cls = classes[key] ?? [];
                    const today = todayUtcKey() === dKey;
                    return (
                      <div key={dKey} className={`cal-col${today ? " today" : ""}`} style={{ height: axisHeight }}>
                        {cls.map((c) => {
                          const t = PERIOD_TIMES[c.period];
                          if (!t) return null;
                          const top = (t.start - DAY_START_MIN) * PX_PER_MIN;
                          const h = (t.end - t.start) * PX_PER_MIN;
                          return (
                            <div
                              key={c.period}
                              className="cal-block"
                              title={`${minToLabel(t.start)}–${minToLabel(t.end)} · ${c.teacher ?? ""}`}
                              style={{ top, height: h }}
                            >
                              <span className="cal-block-name">{c.name}</span>
                              {c.room && <span className="cal-block-room">{c.room}</span>}
                            </div>
                          );
                        })}
                        {/* 现在 (now) red rule — the signature element: a live
                            "you are here" line across today's column. */}
                        {today && nowMin >= DAY_START_MIN && nowMin <= DAY_END_MIN && (
                          <div
                            className="cal-now"
                            style={{ top: (nowMin - DAY_START_MIN) * PX_PER_MIN }}
                            aria-label={`现在 ${minToLabel(nowMin)}`}
                          >
                            <span className="cal-now-label">现在 {minToLabel(nowMin)}</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                </div>

                {/* ---- expanded day's todo/notice items ---- */}
                {openDay && (
                  <ul className="cal-items">
                    {(itemsByDate[openDay] ?? []).length === 0 && (
                      <li className="muted">这一天没有星标/待办</li>
                    )}
                    {(itemsByDate[openDay] ?? []).map((it) => (
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
              </>
            );
          }}
        />
        <p className="muted cal-hint">默认只显示课表；点击日期可展开当天的星标作业 / 公告 / 自定义待办。</p>
      </div>
    </section>
  );
}
