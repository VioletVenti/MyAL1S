// Render tests for <App/> — the regression guard for the P1 blank-page bug.
// History: /api/new-notices (and todo/calendar) once returned a BARE object
// (no {status, data} envelope); NewNoticesPanel's EnvelopeBody then called
// renderData(undefined), dereferenced .assignment, threw during render → React
// unmounted the whole tree → blank background. `npm run build` was green
// throughout. These tests mount the real <App/> with stubbed fetch so that
// class of bug fails the gate.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import Calendar from "../src/Calendar";
import ErrorBoundary from "../src/ErrorBoundary";
import NewNoticesPanel from "../src/NewNoticesPanel";
import { StarProvider } from "../src/stars";
import { fixtures } from "./fixtures";

// Stub fetch → the static fixtures, keyed by the /api/<path>.
function stubFetch(overrides: Record<string, unknown> = {}) {
  const table = { ...fixtures, ...overrides };
  return vi.fn(async (input: RequestInfo | URL) => {
    const u = typeof input === "string" ? input : input.toString();
    const path = u.replace(/^https?:\/\/[^/]+/, "").split("?")[0].replace(/^\/api\//, "").replace(/\/$/, "");
    const body = path in table ? table[path] : { status: "error", message: `no fixture for ${path}` };
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  });
}

// Isolate the envelope cache across every test: the resilience fallback now
// serves cached data on failure, so a leaked localStorage entry from a prior
// test would change what a later test renders (and mask a crash).
afterEach(() => {
  localStorage.clear();
});

describe("<App/> renders without blanking", () => {
  beforeEach(() => {
    localStorage.clear(); // isolate the envelope cache — a prior test's cached
    // envelope would otherwise survive and mask a crash / change the rendered
    // state (the resilience fallback now serves cached data on failure).
    vi.stubGlobal("fetch", stubFetch());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders the main view with the calendar + 待办 panel (not a blank page)", async () => {
    render(<App />);
    expect(screen.getByText("MyAL1S")).toBeInTheDocument(); // header = tree alive
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: /待办/ })).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: /周历/ })).toBeInTheDocument();
    });
  });

  it("directory view shows a left nav and renders ONE selected module at a time", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /待办/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    // The default-selected module (作业) shows; the nav lists all modules.
    await waitFor(() => expect(screen.getByRole("heading", { name: /作业/ })).toBeInTheDocument());
    // The nav buttons are present (clicking switches the shown module).
    expect(screen.getByRole("button", { name: "课程材料" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "课程材料" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "课程材料" })).toBeInTheDocument());
    // Only the selected module's panel is mounted — 成绩 is NOT shown now.
    expect(screen.queryByRole("heading", { name: "成绩" })).not.toBeInTheDocument();
  });

  it("directory nav's deferred group shows the 待接入 placeholder when clicked", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "教务通知" })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "教务通知" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "教务通知" })).toBeInTheDocument());
    // The deferred placeholder body is shown (at least one "待接入" element).
    expect(screen.getAllByText(/待接入/).length).toBeGreaterThan(0);
  });
});

describe("blank-page regression: an ErrorBoundary contains crashes (no blank page)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the boundary fallback (not a blank background) when a panel throws", async () => {
    // The pre-fix bug: /api/new-notices with NO {status,data} envelope makes
    // EnvelopeBody call renderData(undefined) → NewNoticesPanel dereferences
    // d.assignment → throws during render. Without a boundary this blanked the
    // whole page; WITH the ErrorBoundary it surfaces a visible 渲染出错 panel.
    // Render <App/> wrapped in the SAME boundary main.tsx uses, then assert the
    // boundary fallback (not a blank page) is shown. Tolerate React's dev-mode
    // re-throw (it logs "Consider adding an error boundary" but the boundary
    // still contains it).
    vi.stubGlobal("fetch", stubFetch({ "new-notices": { assignment: [], announcement: [] } }));
    const { container } = render(
      <ErrorBoundary>
        <App />
      </ErrorBoundary>,
    );
    await waitFor(() => {
      // The boundary fallback surfaced (page NOT blank).
      expect(container.textContent).toMatch(/渲染出错/);
    });
    expect(container.childElementCount).toBeGreaterThan(0);
  });
});

describe("NewNoticesPanel is compact (collapses long lists)", () => {
  it("shows only the preview count, then expands to all", async () => {
    const many = Array.from({ length: 8 }, (_, i) => ({
      id: `a${i}`,
      course: "课",
      title: `作业${i}`,
      deadline: null,
      deadline_raw: null,
      submitted: false,
      last_attempt: null,
    }));
    vi.stubGlobal("fetch", stubFetch({ "new-notices": { status: "ok", data: { assignment: many, announcement: [] } } }));
    const { container } = render(
      <StarProvider>
        <NewNoticesPanel refreshKey={0} bump={() => {}} />
      </StarProvider>,
    );

    // Collapsed: only 3 (PREVIEW) rows + an "展开全部 8 条" toggle.
    await waitFor(() => expect(container.querySelectorAll(".list.notices li")).toHaveLength(3));
    const expandBtn = Array.from(container.querySelectorAll("button")).find((b) =>
      /展开全部 8 条/.test(b.textContent || ""),
    );
    expect(expandBtn).toBeTruthy();
    fireEvent.click(expandBtn!);

    // Expanded: all 8 rows.
    await waitFor(() => expect(container.querySelectorAll(".list.notices li")).toHaveLength(8));
    vi.unstubAllGlobals();
  });
});

describe("Calendar renders the time-axis timetable", () => {
  it("places class blocks by wall-clock period (08:00 / 09:00 / 13:00)", async () => {
    // /api/calendar envelope whose data.course_table is a logged-in table.
    const calResp = {
      status: "ok",
      data: {
        week: "2026-W26",
        items: [],
        course_table: fixtures["course-table-ok"],
      },
    };
    vi.stubGlobal("fetch", stubFetch({ calendar: calResp }));
    const { container } = render(<Calendar refreshKey={0} />);

    // The 7 day columns + axis appear once loaded.
    await waitFor(() => expect(container.querySelectorAll(".cal-col")).toHaveLength(7));
    const blocks = container.querySelectorAll(".cal-block");
    expect(blocks.length).toBeGreaterThanOrEqual(3);
    // Period 1 (08:00) block sits at the top of its column (top ≈ 0).
    const firstTop = parseFloat((blocks[0] as HTMLElement).style.top);
    expect(firstTop).toBe(0); // 08:00 = DAY_START, 0px
    expect(container.textContent).toContain("8:00");
  });

  it("dims (does NOT hide) a 单周 class on an even school week", async () => {
    // A course-table with a 单周 period-1 class on Monday.
    const calResp = {
      status: "ok",
      data: {
        week: "2026-W26",
        items: [],
        course_table: {
          status: "ok",
          data: {
            nowXnxq: { xndxq: "2025-20262" },
            course: [{ mon: { courseName: "单周课 上课信息：1-15周 单周 理教101 教师：张三" } }],
          },
        },
      },
    };
    vi.stubGlobal("fetch", stubFetch({ calendar: calResp }));
    const { container } = render(<Calendar refreshKey={0} />);
    await waitFor(() => expect(container.querySelectorAll(".cal-col")).toHaveLength(7));
    // No teaching week set yet → the class is active (not dimmed).
    let block = container.querySelector(".cal-block") as HTMLElement;
    expect(block.classList.contains("inactive")).toBe(false);

    // Set the teaching week to 2 (even) via the 教学周 input — a 单周 class is
    // inactive on an even week. It is still RENDERED (not filtered out), just dimmed.
    const swInput = container.querySelector('input[type="number"]') as HTMLInputElement;
    fireEvent.change(swInput, { target: { value: "2" } });
    await waitFor(() => {
      block = container.querySelector(".cal-block") as HTMLElement;
      expect(block.classList.contains("inactive")).toBe(true);
    });
    // The block is still in the DOM (dimmed, not hidden).
    expect(container.querySelectorAll(".cal-block").length).toBeGreaterThanOrEqual(1);
    // No 单/双 badge anymore.
    expect(container.querySelector(".cal-parity-badge")).toBeNull();
  });
});

describe("P2 write-ops UI", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", stubFetch());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("a failed fetch falls back to the cached snapshot (stale), not an error", async () => {
    // Seed a good assignments envelope in localStorage (as a prior successful
    // load would), then have fetch return an error. The panel must keep showing
    // the cached data with a stale badge — NOT blank it with "出错了".
    const cached = {
      status: "ok",
      data: {
        include_finished: false,
        assignments: [
          { id: "ax", course: "高等数学", title: "缓存里的作业", deadline: null, deadline_raw: null, submitted: false, last_attempt: null },
        ],
      },
    };
    localStorage.setItem("myal1s.env.assignments", JSON.stringify(cached));
    vi.stubGlobal(
      "fetch",
      stubFetch({ assignments: { status: "error", message: "请求超时或已取消" } }),
    );
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    // The cached assignment shows immediately from localStorage; once the failed
    // fetch resolves, the fallback marks it stale (离线缓存 badge). The harsh
    // "出错了" error never reaches the DOM.
    await waitFor(() => expect(screen.getByText("缓存里的作业")).toBeInTheDocument());
    await waitFor(() => expect(screen.getAllByText(/离线缓存/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/出错了/)).not.toBeInTheDocument();
  });

  it("settings view renders the permission matrix (not a blank page)", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /权限矩阵/ })).toBeInTheDocument(),
    );
    // The 交作业 group row is present with its level selector (the 禁止 option
    // is unique to the matrix — the chat model picker has no such option).
    expect(screen.getByText("交作业")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "禁止" })).toBeInTheDocument();
  });

  it("when not connected, shows a single 未连接 notice (no spinning panels)", async () => {
    vi.stubGlobal("fetch", stubFetch({ session: { connected: false } }));
    render(<App />);
    await waitFor(() => expect(screen.getByText(/未连接教学网/)).toBeInTheDocument());
    // While gated, no panel headings mount — so no 加载中 spinners either.
    expect(screen.queryByRole("heading", { name: /待办/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /周历/ })).not.toBeInTheDocument();
  });

  it("a pending write approval shows an inline 确认执行 / 拒绝 banner in the chat", async () => {
    const pending = [
      {
        id: "ap1",
        conversation_id: null,
        tool_name: "submit_assignment",
        group_name: "assignment_submission",
        args: { assignment_id: "a1", file_id: "f1" },
        filename: "hw1.pdf",
        summary: "交作业: hw1.pdf",
        status: "pending",
        result: null,
        created_at: "2026-06-23T00:00:00+00:00",
        decided_at: null,
      },
    ];
    vi.stubGlobal("fetch", stubFetch({ approvals: { status: "ok", data: { approvals: pending } } }));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "确认执行" })).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "拒绝" })).toBeInTheDocument();
    expect(screen.getByText(/交作业: hw1\.pdf/)).toBeInTheDocument();
  });

  it("the chat shows an always-visible 历史会话 list", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        conversations: {
          conversations: [
            { id: "c1", title: "旧对话一", created_at: "", updated_at: "" },
          ],
        },
      }),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByText("历史会话（1）")).toBeInTheDocument());
    expect(screen.getByText("旧对话一")).toBeInTheDocument();
  });

  it("an unsubmitted assignment shows a 交作业 button; a submitted one shows 已提交", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "交作业" })).toBeInTheDocument(),
    );
    // The submitted fixture (作业二) renders an 已提交 chip, not a submit button —
    // so exactly ONE 交作业 button exists (the unsubmitted 作业一).
    expect(screen.getAllByRole("button", { name: "交作业" })).toHaveLength(1);
    expect(screen.getByText("已提交")).toBeInTheDocument();
  });
});
