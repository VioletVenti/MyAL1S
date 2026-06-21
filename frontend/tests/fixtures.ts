// Static, deterministic API-response fixtures for the render tests. These mirror
// the real `{status, data}` envelope shapes (and the dashboard-route envelope
// added in the blank-page fix) so the test exercises the real code paths —
// including the needs_otp degrades — without a backend or network.

export const fixtures: Record<string, unknown> = {
  // Deterministic endpoints — bare domain objects.
  "course-table": { status: "needs_otp", mobile_mask: null, hint: "登录一次" },
  assignments: {
    status: "ok",
    data: {
      include_finished: false,
      assignments: [
        {
          id: "a1",
          course: "高等数学",
          title: "作业一",
          deadline: "2026-06-27T11:59:00+08:00",
          deadline_raw: "截止时间 2026年6月27日 星期六 上午11:59 -0800",
          submitted: false,
          last_attempt: null,
        },
      ],
    },
  },
  announcements: {
    status: "ok",
    data: {
      announcements: [
        {
          id: "n1",
          course: "高等数学",
          title: "课程公告",
          time: "发布时间 : 2026年4月4日 10:00",
          descriptions: ["公告正文第一段", "公告正文第二段"],
          attachments: ["file.pdf"],
        },
      ],
    },
  },
  materials: {
    status: "ok",
    data: {
      materials: [
        { course: "线性代数", ccid: "_1_1:_2_1", title: "课件第一章", kind: "文档", attachment_count: 2 },
      ],
    },
  },
  videos: {
    status: "ok",
    data: { videos: [{ id: "v1", course: "线性代数", title: "第1讲", time: "2026-03-04 14:00" }] },
  },
  grades: {
    status: "ok",
    data: { grades: [{ course: "线性代数", item: "期中", score: 92, possible: 100 }] },
  },
  stars: {
    status: "ok",
    data: {
      stars: [
        { source: "assignment", item_id: "a1", title: "作业一", course: "高等数学", date: "2026-06-27T11:59:00+08:00", created_at: "2026-06-21T00:00:00+00:00" },
      ],
    },
  },
  // NOTE: /conversations + /models + /custom-items return BARE shapes (not the
  // {status,data} envelope) — listConversations() reads `.conversations`, etc.
  conversations: { conversations: [] },
  "custom-items": { items: [] },
  // Dashboard routes — wrapped in the {status, data} envelope (the blank-page
  // fix). new-notices.data carries both sources; a bare {assignment} would crash
  // NewNoticesPanel's EnvelopeBody.
  todo: {
    status: "ok",
    data: {
      items: [
        { kind: "star", source: "assignment", id: "a1", live: false, title: "作业一", course: "高等数学", date: "2026-06-27T11:59:00+08:00", submitted: null },
      ],
    },
  },
  calendar: {
    status: "ok",
    data: {
      course_table: { status: "needs_otp", mobile_mask: null, hint: "登录一次" },
      items: [
        { kind: "star", source: "assignment", id: "a1", live: false, title: "作业一", course: "高等数学", date: "2026-06-27T11:59:00+08:00", submitted: null },
      ],
      week: "2026-W26",
    },
  },
  "new-notices": { status: "ok", data: { assignment: [], announcement: [] } },
  models: {
    models: [{ label: "DeepSeek", model: "anthropic:evomap-deepseek-v4-flash" }],
  },
};
