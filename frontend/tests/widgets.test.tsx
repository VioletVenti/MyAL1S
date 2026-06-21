// Unit tests for the widgets hooks: usePagination (E5) + useEnvelope localStorage
// cache (E6). Render-hook via a tiny harness component (no extra deps).

import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Envelope } from "../src/api";
import { useEnvelope, usePagination } from "../src/widgets";

function renderHook<T>(useFn: () => T): { current: T } {
  const captured: { current: T } = { current: undefined as unknown as T };
  function Probe() {
    captured.current = useFn();
    return null;
  }
  render(<Probe />);
  return captured;
}

describe("usePagination", () => {
  it("slices to pageSize and navigates prev/next", () => {
    const items = Array.from({ length: 37 }, (_, i) => i); // 3 pages of 15
    const h = renderHook(() => usePagination(items, 15));
    expect(h.current.page).toBe(1);
    expect(h.current.pages).toBe(3);
    expect(h.current.slice).toEqual(items.slice(0, 15));
    act(() => h.current.next());
    expect(h.current.page).toBe(2);
    expect(h.current.slice).toEqual(items.slice(15, 30));
    act(() => h.current.next());
    act(() => h.current.next()); // page 4 would overflow → clamps to 3
    expect(h.current.page).toBe(3);
    act(() => h.current.prev());
    expect(h.current.page).toBe(2);
  });

  it("hides the pager when only one page (Pager returns null)", async () => {
    const { Pager } = await import("../src/widgets");
    const { container } = render(<Pager page={1} pages={1} onPrev={() => {}} onNext={() => {}} />);
    expect(container.querySelector(".pager")).toBeNull();
  });
});

describe("useEnvelope localStorage cache (E6)", () => {
  beforeEach(() => {
    localStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("seeds initial state from localStorage and writes back on a successful fetch", async () => {
    const cached: Envelope<{ n: number }> = { status: "ok", data: { n: 1 } };
    localStorage.setItem("myal1s.env.assignments", JSON.stringify(cached));

    const fetcher = vi.fn(async () => ({ status: "ok", data: { n: 2 } }) as Envelope<{ n: number }>);
    function Probe() {
      const { env } = useEnvelope<{ n: number }>(fetcher, { cacheKey: "assignments" });
      return <span data-testid="v">{env ? (env.status === "ok" ? env.data.n : "?") : "none"}</span>;
    }
    render(<Probe />);
    // Paints the cached value BEFORE the fetch resolves.
    expect(screen.getByTestId("v").textContent).toBe("1");
    // After fetch resolves, shows the fresh value + has written it back.
    await waitFor(() => expect(screen.getByTestId("v").textContent).toBe("2"));
    const stored = JSON.parse(localStorage.getItem("myal1s.env.assignments") || "null");
    expect(stored.data.n).toBe(2);
  });

  it("degrades silently when localStorage is unavailable (no throw)", async () => {
    // Make localStorage.setItem throw (quota/disabled).
    const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new Error("quota");
    };
    const fetcher = vi.fn(async () => ({ status: "ok", data: { n: 9 } }) as Envelope<{ n: number }>);
    function Probe() {
      const { env } = useEnvelope<{ n: number }>(fetcher, { cacheKey: "x" });
      return <span>{env && env.status === "ok" ? env.data.n : "none"}</span>;
    }
    let threw = false;
    try {
      render(<Probe />);
      await waitFor(() => expect(screen.queryByText("9")).toBeInTheDocument());
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    Storage.prototype.setItem = orig;
  });
});
