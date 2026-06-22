// Pure display-formatters for teaching-network data. The backend (pku3b) emits
// structured fields; this layer turns the raw shapes into clean, short, Chinese
// display strings — stripping the blobs/prefixes/raw timestamps that made the
// P1 UI ugly. Every function is total: on any unexpected shape it returns a
// safe fallback (original string, "无截止", ""), never throws — so a render
// crash (the blank-page bug class) can't recur from here.
//
// Mirrors pku3b's CLI format_course_info (pku3b/src/cli/cmd_course_table.rs)
// for the course-table blob, kept in sync by reading that source.

/** A parsed course-table slot (one (period, weekday) cell). */
export type WeekParity = "odd" | "even" | "all";
export interface CourseSlot {
  name: string;
  room?: string;
  teacher?: string;
  /** Whether this slot runs every week, odd weeks only (单周), or even only (双周).
   *  Parsed from the blob's 上课信息 section. */
  parity: WeekParity;
  /** The school-week range parsed from the blob (e.g. 1-15), if present. */
  weekRange?: [number, number];
}

/**
 * Parse a portal `courseName` blob into a clean {name, room, teacher}.
 *
 * The real blob is HTML — e.g. `<font color='red'><b>人工智能基础(主)<br>上课信
 * 息：11-15周 每周 二教203 教师：王乐业 <br>考试信息：…`. So step 1 is always
 * strip ALL tags; then mirror pku3b CLI `format_course_info`: name before
 * `(主)`, room from the 上课信息 section (last whitespace token = the room),
 * teacher from 教师：. Defensive: any unexpected shape → {name: trimmed blob}.
 */
export function parseCourseSlot(blob: string | null | undefined): CourseSlot {
  if (!blob) return { name: "", parity: "all" };
  // Strip every HTML tag (<font>/<b>/<br>/…) and collapse whitespace/newlines.
  const info = blob
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!info) return { name: "", parity: "all" };
  const name = (info.split("(主)")[0] ?? info).trim() || info;
  const slot: CourseSlot = { name, parity: "all" };

  const classIdx = info.indexOf("上课信息：");
  if (classIdx >= 0) {
    const rest = info.slice(classIdx + "上课信息：".length);
    const teacherIdx = rest.indexOf("教师：");
    const classEnd = teacherIdx >= 0 ? teacherIdx : rest.length;
    const classInfo = rest.slice(0, classEnd).trim().replace(/[,，]+$/, "");
    // Parse week range + parity from "11-15周 单周 二教203" style text.
    const rangeMatch = classInfo.match(/(\d+)\s*-\s*(\d+)\s*周/);
    if (rangeMatch) slot.weekRange = [+rangeMatch[1], +rangeMatch[2]];
    if (/单周/.test(classInfo)) slot.parity = "odd";
    else if (/双周/.test(classInfo)) slot.parity = "even";
    // Room = last whitespace token.
    const room = classInfo.split(/\s+/).pop();
    if (room) slot.room = room;
    if (teacherIdx >= 0) {
      const teacherRest = rest.slice(teacherIdx + "教师：".length);
      const examIdx = teacherRest.indexOf("考试信息");
      const teacherEnd = examIdx >= 0 ? examIdx : teacherRest.length;
      const teacher = teacherRest.slice(0, teacherEnd).trim();
      if (teacher) slot.teacher = teacher;
    }
  }
  return slot;
}

/** Wall-clock components parsed from a date string (the time the source MEANT,
 *  not converted to the runtime's local tz). For RFC3339 with an offset
 *  (e.g. `2026-06-27T11:59:00+08:00`) we keep the encoded wall time (11:59),
 *  because that is the PKU-local time the backend recorded and what the user
 *  expects to see — never a UTC-converted value. */
interface WallDate {
  y: number;
  mo: number;
  d: number;
  h: number;
  mi: number;
  /** Did the source string actually carry a time component? A date-only input
   *  ("2026-06-27" / "2026年6月27日") leaves this false so we don't render 00:00. */
  hasTime: boolean;
}

function parseWall(raw: string): WallDate | null {
  if (!raw) return null;
  // RFC3339 / ISO: 2026-06-27T11:59:00+08:00  (or ...Z, or with ms)
  const iso = raw.match(
    /(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/,
  );
  if (iso) {
    return {
      y: +iso[1],
      mo: +iso[2],
      d: +iso[3],
      h: iso[4] ? +iso[4] : 0,
      mi: iso[5] ? +iso[5] : 0,
      hasTime: iso[4] !== undefined,
    };
  }
  // Chinese: 2026年6月27日 星期六 上午11:59. An optional weekday (星期X / 周X)
  // may sit between the date and the time; skip it, then capture 上午/下午.
  // (A naive [^0-9]* would eat 下/午 and drop the AM/PM adjustment.)
  const cn = raw.match(
    /(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s*(?:星期.|周.)?\s*(上午|下午)?\s*(\d{1,2})(?::(\d{1,2}))?)?/,
  );
  if (cn) {
    let h = cn[5] ? +cn[5] : 0;
    if (cn[4] === "下午" && h < 12) h += 12;
    return { y: +cn[1], mo: +cn[2], d: +cn[3], h, mi: cn[6] ? +cn[6] : 0, hasTime: cn[5] !== undefined };
  }
  return null;
}

const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

/** Weekday (周日..周六) for a wall date, computed without Date tz (Doomsday-free:
 *  builds a UTC date from the wall components and reads UTC day — stable). */
function wallWeekday(w: WallDate): string {
  const dt = new Date(Date.UTC(w.y, w.mo - 1, w.d));
  return WD[dt.getUTCDay()];
}

/** Format any date-ish string to a compact form. `withTime=true` appends HH:mm
 *  ONLY when the source actually carried a time component — a date-only input
 *  ("2026-06-27") never renders as "00:00". Keeps the source's wall-clock time
 *  (no tz conversion). */
export function fmtDate(raw: string | null | undefined, withTime = false): string {
  if (!raw) return "";
  const w = parseWall(raw);
  if (!w) {
    // Unparseable — return a cleaned, length-capped version of the raw string.
    return raw.replace(/发布时间[:：]\s*/i, "").trim().slice(0, 16);
  }
  const base = `${w.mo}/${w.d} ${wallWeekday(w)}`;
  if (!(withTime && w.hasTime)) return base;
  const hh = String(w.h).padStart(2, "0");
  const mm = String(w.mi).padStart(2, "0");
  return `${w.mo}/${w.d} ${wallWeekday(w)} ${hh}:${mm}`;
}

/**
 * Format an assignment deadline. Prefers the parsed RFC3339 `deadline`; falls
 * back to a cleaned `deadline_raw`; finally "无截止".
 */
export function fmtDeadline(deadline: string | null | undefined, deadlineRaw: string | null | undefined): string {
  if (deadline) {
    return fmtDate(deadline, true);
  }
  if (deadlineRaw) {
    // deadline_raw may be "截止时间 2026年6月27日 …" — strip the prefix, try parse.
    const cleaned = deadlineRaw.replace(/截止时间[:：]?\s*/i, "").trim();
    if (parseWall(cleaned)) return fmtDate(cleaned, true);
    return cleaned.slice(0, 20);
  }
  return "无截止";
}

/** Strip the "发布时间 : " prefix from an announcement time and format it. */
export function fmtAnnouncementTime(time: string | null | undefined): string {
  if (!time) return "";
  const cleaned = time.replace(/发布时间[:：]\s*/i, "").trim();
  return fmtDate(cleaned, false) || time.slice(0, 16);
}

/** Truncate text to n chars with an ellipsis. Safe for null/empty. */
export function truncate(text: string | null | undefined, n = 80): string {
  if (!text) return "";
  const s = text.replace(/\s+/g, " ").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

/** Join announcement description lines and truncate to one short line. */
export function fmtDescription(descriptions: string[] | null | undefined, n = 80): string {
  if (!descriptions || descriptions.length === 0) return "";
  return truncate(descriptions.join(" / "), n);
}

/** Safety-net Chinese label for a material kind (backend now sends Chinese;
 * this maps the old English Debug names too, for stale/older data). */
export function kindLabel(kind: string | null | undefined): string {
  if (!kind) return "";
  const map: Record<string, string> = {
    Document: "文档",
    File: "文件",
    Folder: "文件夹",
    Audio: "音频",
    Quiz: "测试",
    Unknown: "其它",
    Assignment: "作业",
    Announcement: "公告",
    文档: "文档",
    文件: "文件",
    文件夹: "文件夹",
    音频: "音频",
    测试: "测试",
    其它: "其它",
    作业: "作业",
    公告: "公告",
  };
  return map[kind] ?? kind;
}
