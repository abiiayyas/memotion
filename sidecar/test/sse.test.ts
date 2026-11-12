import { afterEach, describe, expect, it, vi } from "vitest";
import { keepAlive } from "../src/sse.js";

afterEach(() => vi.useRealTimers());

describe("keepAlive", () => {
  it("writes a comment line every interval while a run is silent, and nothing after stop()", () => {
    vi.useFakeTimers();
    const written: string[] = [];
    const stop = keepAlive({ write: (chunk) => (written.push(chunk), Promise.resolve()) }, 15_000);

    vi.advanceTimersByTime(14_999);
    expect(written).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(written).toEqual([": keepalive\n\n"]);
    vi.advanceTimersByTime(30_000);
    expect(written).toHaveLength(3);

    stop();
    vi.advanceTimersByTime(60_000);
    expect(written).toHaveLength(3);
  });

  it("gives up when the connection is gone instead of writing into it forever", async () => {
    vi.useFakeTimers();
    let calls = 0;
    keepAlive({ write: () => (calls++, Promise.reject(new Error("closed"))) }, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(calls).toBe(1);
  });
});
