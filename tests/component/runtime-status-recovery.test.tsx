// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRuntimeStatus } from "@/ui/use-runtime-status";
import { initialRuntimeStatus } from "@/lib/runtime-status";

const ready = { ...initialRuntimeStatus, codex: "connected" as const, ready: true };
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("runtime availability recovery", () => {
  it("ends checking after a deadline and stops automatic retries", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise<Response>(() => undefined));
    vi.stubGlobal("fetch", fetcher);
    const { result } = renderHook(() => useRuntimeStatus({ hydrated: true, online: true, projectId: "a", retry: 0 }));
    expect(result.current.codex).toBe("checking");
    await act(() => vi.advanceTimersByTimeAsync(40_001));
    expect(result.current.codex).toBe("unavailable");
    await act(() => vi.advanceTimersByTimeAsync(200_000));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current.codex).toBe("unavailable");
  });
  it("does not show checking again during a background retry and allows manual recovery", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender } = renderHook(({ retry }) => useRuntimeStatus({ hydrated: true, online: true, projectId: "a", retry }), { initialProps: { retry: 0 } });
    await act(() => vi.advanceTimersByTimeAsync(15_000));
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(result.current.codex).toBe("unavailable");
    fetcher.mockImplementation(async () => Response.json(ready));
    rerender({ retry: 1 });
    await act(() => vi.advanceTimersByTimeAsync(1));
    expect(result.current.ready).toBe(true);
  });
  it("ignores a late response from a previously selected project", async () => {
    let releaseOld!: (response: Response) => void;
    const fetcher = vi.fn((url: string) => url.includes("projectId=a")
      ? new Promise<Response>(resolve => { releaseOld = resolve; }) : Promise.resolve(Response.json(ready)));
    vi.stubGlobal("fetch", fetcher);
    const { result, rerender } = renderHook(({ projectId }) => useRuntimeStatus({ hydrated: true, online: true, projectId, retry: 0 }), { initialProps: { projectId: "a" } });
    rerender({ projectId: "b" });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.ready).toBe(true);
    await act(async () => { releaseOld(Response.json({ ...ready, codex: "unavailable", ready: false })); });
    expect(result.current.ready).toBe(true);
  });
});
