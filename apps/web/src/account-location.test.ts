import { beforeEach, describe, expect, it } from "vitest";

import { loadActiveAccountId, saveActiveAccountId } from "./account-location.js";

describe("active account URL state", () => {
  beforeEach(() => window.history.replaceState({}, "", "/"));

  it("restores the selected account from the URL after a page reload", () => {
    window.history.replaceState({}, "", "/?account=qq");

    expect(loadActiveAccountId()).toBe("qq");
  });

  it("updates the account parameter without discarding other URL state", () => {
    window.history.replaceState({}, "", "/?page=2#mail-list");

    saveActiveAccountId("qq");

    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("?page=2&account=qq");
    expect(window.location.hash).toBe("#mail-list");
  });
});
