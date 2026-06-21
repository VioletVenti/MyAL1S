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
import ErrorBoundary from "../src/ErrorBoundary";
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

describe("<App/> renders without blanking", () => {
  beforeEach(() => {
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

  it("switches to the directory view and renders the listing panels", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /待办/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "课程材料" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "课程通知" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "课程回放" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "成绩" })).toBeInTheDocument();
  });

  it("shows the 待接入 placeholders in the directory view", async () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    await waitFor(() => expect(screen.getByRole("heading", { name: "教务通知" })).toBeInTheDocument());
    expect(screen.getByRole("heading", { name: "北大树洞" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "文档库" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "记忆" })).toBeInTheDocument();
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
