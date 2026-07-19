import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readConfig } from "../src/config/env.js";
import { createDatabase, runMigrations, type DatabaseBundle } from "../src/db/client.js";
import { MailRepository } from "../src/db/repository.js";
import type { ImapConnection, ReadOnlyMailboxSession } from "../src/imap/types.js";
import { buildSyncApp } from "../src/sync-app.js";
import { SyncCoordinator } from "../src/sync/coordinator.js";
import { SyncService } from "../src/sync/sync-service.js";

class NoopConnection implements ImapConnection {
  public async connect(): Promise<void> {}
  public async close(): Promise<void> {}
  public async waitForChange(): Promise<boolean> { return false; }
  public async withReadOnlyMailbox<T>(callback: (session: ReadOnlyMailboxSession) => Promise<T>): Promise<T> {
    return callback({
      snapshot: { path: "INBOX", uidValidity: "1", highestModseq: null },
      searchNewUids: async () => [],
      fetchMetadata: async () => [],
      fetchChangedFlags: async () => [],
      fetchAllFlags: async () => [],
      fetchBodyPart: async () => { throw new Error("sync-only API must not load bodies"); },
    });
  }
}

describe("read-only synchronization API", () => {
  let database: DatabaseBundle;

  beforeEach(() => {
    database = createDatabase(":memory:");
    runMigrations(database.db);
  });

  afterEach(() => database.sqlite.close());

  it("exposes read operations and does not register classification or mailbox mutation routes", async () => {
    const config = readConfig({
      MAIL_EMAIL: "owner@163.com",
      MAIL_IMAP_HOST: "imap.163.com",
      MAIL_IMAP_PORT: "993",
      MAIL_IMAP_SECURE: "true",
      MAIL_AUTH_CODE: "never-return-this-secret",
      DATABASE_URL: ":memory:",
      WEB_ORIGIN: "http://localhost:5173",
    });
    const logger = pino({ enabled: false });
    const repository = new MailRepository(database.db);
    const mailbox = repository.upsertMailbox({
      accountKey: "account",
      path: "INBOX",
      uidValidity: "1",
      highestModseq: null,
    });
    const email = repository.upsertEmail(mailbox.id, "1", {
      uid: 1,
      messageId: "<1@example.com>",
      fromName: "Sender",
      fromAddress: "sender@example.com",
      subject: "Unread message",
      sentAt: new Date("2025-01-01T00:00:00.000Z"),
      internalDate: new Date("2025-01-01T00:00:00.000Z"),
      size: 100,
      flags: [],
      imapLabels: [],
      isUnread: true,
      textPart: "1",
      htmlPart: null,
      attachments: [],
    });
    const factory = () => new NoopConnection();
    const syncService = new SyncService(config, repository, factory, logger);
    const coordinator = new SyncCoordinator(config, syncService, factory, logger);
    const app = await buildSyncApp(config, logger, { repository, coordinator });

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json()).toEqual({ ok: true, mode: "read-only-imap-sync+classifier" });

    const dashboard = await app.inject({ method: "GET", url: "/api/dashboard" });
    expect(dashboard.json()).toEqual({ total: 1, unread: 1, unclassified: 1, needsReview: 0 });

    const detail = await app.inject({ method: "GET", url: `/api/emails/${email.id}` });
    expect(detail.json()).toMatchObject({ id: email.id, isUnread: true, primaryLabel: null });

    for (const request of [
      { method: "PATCH", url: `/api/emails/${email.id}/classification` },
      { method: "POST", url: `/api/emails/${email.id}/reclassify` },
      { method: "POST", url: "/api/discovery/analyze" },
      { method: "POST", url: "/api/taxonomy/confirm" },
      { method: "DELETE", url: `/api/emails/${email.id}` },
    ] as const) {
      expect((await app.inject(request)).statusCode).toBe(404);
    }

    const status = await app.inject({ method: "GET", url: "/api/sync/status" });
    expect(status.body).not.toContain(config.MAIL_AUTH_CODE);
    expect(status.body).not.toContain(config.MAIL_EMAIL);
    await app.close();
  });
});
