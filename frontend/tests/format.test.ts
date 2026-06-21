// Unit tests for the display-format layer. These lock down the exact behaviors
// that the P1 "ugly data" + blank-page fixes depend on (wall-clock preserved,
// date-only never renders 00:00, blob parsed, total/never-throws).

import { describe, expect, it } from "vitest";
import {
  fmtAnnouncementTime,
  fmtDate,
  fmtDeadline,
  fmtDescription,
  kindLabel,
  parseCourseSlot,
  truncate,
} from "../src/format";

describe("parseCourseSlot", () => {
  it("extracts name/room/teacher from the full blob (mirrors pku3b CLI)", () => {
    const slot = parseCourseSlot("高等数学(主) 理教101 上课信息：周一3-4节 理教101 教师：张三 考试信息：2026年7月1日");
    expect(slot.name).toBe("高等数学");
    expect(slot.room).toBe("周一3-4节 理教101");
    expect(slot.teacher).toBe("张三");
  });
  it("falls back to the whole blob when the marker is absent", () => {
    expect(parseCourseSlot("只是一门课").name).toBe("只是一门课");
  });
  it("is total on null/empty/undefined", () => {
    expect(parseCourseSlot(null).name).toBe("");
    expect(parseCourseSlot("").name).toBe("");
    expect(parseCourseSlot(undefined).name).toBe("");
  });
});

describe("fmtDate / fmtDeadline — wall-clock + no 00:00", () => {
  it("preserves the encoded wall-clock time (no tz conversion)", () => {
    expect(fmtDate("2026-06-27T11:59:00+08:00", true)).toBe("6/27 周六 11:59");
    expect(fmtDate("2026-06-27T23:30:00Z", true)).toBe("6/27 周六 23:30");
  });
  it("does NOT append 00:00 for a date-only input, even with withTime", () => {
    expect(fmtDate("2026-06-27", true)).toBe("6/27 周六");
    expect(fmtDate("2026年6月27日", true)).toBe("6/27 周六");
  });
  it("parses Chinese dates (incl. 上午/下午)", () => {
    expect(fmtDate("2026年6月15日 上午8:00", true)).toBe("6/15 周一 08:00");
    expect(fmtDate("2026年6月15日 下午3:30", true)).toBe("6/15 周一 15:30");
  });
  it("returns '' / fallback on null/unparseable, never throws", () => {
    expect(fmtDate(null, true)).toBe("");
    expect(fmtDate("", true)).toBe("");
    // Unparseable → cleaned, 16-char-capped raw.
    expect(fmtDate("not a date at all", true)).toBe("not a date at al");
  });
  it("fmtDeadline prefers RFC3339, then cleaned raw, then 无截止", () => {
    expect(fmtDeadline("2026-06-27T11:59:00+08:00", null)).toBe("6/27 周六 11:59");
    expect(fmtDeadline(null, "截止时间 2026年6月27日 星期六 上午11:59 -0800")).toBe("6/27 周六 11:59");
    expect(fmtDeadline(null, null)).toBe("无截止");
    expect(fmtDeadline("2026-06-27", null)).toBe("6/27 周六"); // date-only, no 00:00
  });
});

describe("fmtAnnouncementTime / truncate / fmtDescription", () => {
  it("strips the 发布时间 prefix", () => {
    expect(fmtAnnouncementTime("发布时间 : 2026年4月4日 10:00")).toBe("4/4 周六");
    expect(fmtAnnouncementTime(null)).toBe("");
  });
  it("truncate caps with ellipsis", () => {
    expect(truncate("a".repeat(100), 10)).toBe("aaaaaaaaaa…");
    expect(truncate("short", 10)).toBe("short");
    expect(truncate(null)).toBe("");
  });
  it("fmtDescription joins + truncates", () => {
    // 20-char first line → truncate(20) keeps it whole + ellipsis.
    expect(fmtDescription(["一二三四五六七八九十一二三四五六七八九十", "第二段"], 20)).toBe(
      "一二三四五六七八九十一二三四五六七八九十…",
    );
    expect(fmtDescription([], 20)).toBe("");
  });
});

describe("kindLabel", () => {
  it("maps old English Debug names + passes Chinese through", () => {
    expect(kindLabel("Document")).toBe("文档");
    expect(kindLabel("Unknown")).toBe("其它");
    expect(kindLabel("文件夹")).toBe("文件夹");
    expect(kindLabel("文档")).toBe("文档");
    expect(kindLabel("")).toBe("");
    expect(kindLabel("未识别的新类型")).toBe("未识别的新类型");
  });
});
