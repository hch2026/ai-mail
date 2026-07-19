import { afterEach, describe, expect, it, vi } from "vitest";

import { api } from "./client.js";

describe("API client request headers", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("does not send an empty JSON content type for bodyless POST requests", async () => {
    const fetchMock = vi.fn(async (_path: string, init?: RequestInit) => ({
      ok: true,
      json: async () => ({ status: "success" }),
      requestInit: init,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await api.sync();
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.has("content-type")).toBe(false);
  });

  it("sets JSON content type when a request has a JSON body", async () => {
    const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ confirmed: 1 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await api.confirmReviews([1]);
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("serializes unread, action and review filters for the management list", async () => {
    const fetchMock = vi.fn(async (_path: string, _init?: RequestInit) => ({
      ok: true,
      json: async () => ({ items: [], total: 0, page: 1, pageSize: 30 }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    await api.emails({ unread: true, actionRequired: true, review: true, page: 1, pageSize: 30 });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/emails?unread=true&actionRequired=true&review=true&page=1&pageSize=30");
  });
});
