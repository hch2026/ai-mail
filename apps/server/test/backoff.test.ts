import { getEventListeners } from "node:events";
import { describe, expect, it } from "vitest";

import { delay, exponentialBackoffMs } from "../src/sync/backoff.js";

describe("exponentialBackoffMs", () => {
  it("grows exponentially and caps the attempt", () => {
    expect(exponentialBackoffMs(0, () => 0.5)).toBe(1_000);
    expect(exponentialBackoffMs(3, () => 0.5)).toBe(8_000);
    expect(exponentialBackoffMs(100, () => 0.5)).toBe(256_000);
  });

  it("removes abort listeners after a completed delay", async () => {
    const controller = new AbortController();
    await delay(1, controller.signal);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
  });
});
