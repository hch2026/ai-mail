import { describe, expect, it } from "vitest";

import { envFileCandidates, readConfig } from "../src/config/env.js";

describe("envFileCandidates", () => {
  it("finds the workspace root env file when the server runs from its package directory", () => {
    const candidates = envFileCandidates(
      "file:///workspace/apps/server/src/config/env.ts",
      "/workspace/apps/server",
    );

    expect(candidates).toEqual([
      "/workspace/.env",
      "/workspace/apps/server/.env",
    ]);
  });

  it("allows explicitly enabling recoverable mailbox writes", () => {
    expect(readConfig({
      MAIL_EMAIL: "owner@163.com",
      MAIL_IMAP_HOST: "imap.163.com",
      MAIL_IMAP_PORT: "993",
      MAIL_IMAP_SECURE: "true",
      MAIL_AUTH_CODE: "test-only",
      DRY_RUN: "false",
    }).DRY_RUN).toBe(false);
  });
});
