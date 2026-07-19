import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readConfig } from "../src/config/env.js";
import { createDatabase, runMigrations, type DatabaseBundle } from "../src/db/client.js";
import { MailRepository } from "../src/db/repository.js";
import { emails, mailboxes } from "../src/db/schema.js";
import type { ImapConnection, ImapMessageMetadata, ReadOnlyMailboxSession } from "../src/imap/types.js";
import { SyncService } from "../src/sync/sync-service.js";

function message(uid: number): ImapMessageMetadata {
  return {
    uid,
    messageId: `<${uid}@example.com>`,
    fromName: "Sender",
    fromAddress: "sender@example.com",
    subject: `Message ${uid}`,
    sentAt: new Date("2025-01-01T00:00:00.000Z"),
    internalDate: new Date("2025-01-01T00:00:00.000Z"),
    size: 100,
    flags: [],
    imapLabels: [],
    isUnread: true,
    textPart: "1",
    htmlPart: null,
    attachments: [],
  };
}

class FakeConnection implements ImapConnection {
  public connected = false;
  public readonly requestedAfter: number[] = [];
  public bodyFetches = 0;
  public readonly remoteUnread = new Map<number, boolean>();

  public constructor(
    private readonly uidValidity = "99",
    private readonly messages: ImapMessageMetadata[] = [message(1), message(2), message(3)],
  ) {
    for (const item of messages) this.remoteUnread.set(item.uid, item.isUnread);
  }

  public async connect(): Promise<void> {
    this.connected = true;
  }

  public async close(): Promise<void> {
    this.connected = false;
  }

  public async withReadOnlyMailbox<T>(
    callback: (session: ReadOnlyMailboxSession) => Promise<T>,
  ): Promise<T> {
    const session: ReadOnlyMailboxSession = {
      snapshot: { path: "INBOX", uidValidity: this.uidValidity, highestModseq: null },
      searchNewUids: async (afterUid) => {
        this.requestedAfter.push(afterUid);
        return this.messages.filter((item) => item.uid > afterUid).map((item) => item.uid);
      },
      fetchMetadata: async (uids) => this.messages
        .filter((item) => uids.includes(item.uid))
        .map((item) => ({ ...item, isUnread: this.remoteUnread.get(item.uid) ?? item.isUnread })),
      fetchChangedFlags: async () => [],
      fetchAllFlags: async () => [],
      fetchBodyPart: async () => {
        this.bodyFetches += 1;
        throw new Error("sync-only mode must not fetch message bodies");
      },
    };
    return await callback(session);
  }

  public async waitForChange(): Promise<boolean> {
    return false;
  }
}

class FailingConnection implements ImapConnection {
  public constructor(private readonly error: Error) {}
  public async connect(): Promise<void> { throw this.error; }
  public async close(): Promise<void> {}
  public async waitForChange(): Promise<boolean> { return false; }
  public async withReadOnlyMailbox<T>(_callback: (session: ReadOnlyMailboxSession) => Promise<T>): Promise<T> {
    throw this.error;
  }
}

function config(overrides: Record<string, string> = {}) {
  return readConfig({
    MAIL_EMAIL: "owner@163.com",
    MAIL_IMAP_HOST: "imap.163.com",
    MAIL_IMAP_PORT: "993",
    MAIL_IMAP_SECURE: "true",
    MAIL_AUTH_CODE: "test-only",
    DATABASE_URL: ":memory:",
    SYNC_PAGE_SIZE: "10",
    ...overrides,
  });
}

describe("SyncService", () => {
  let database: DatabaseBundle;

  beforeEach(() => {
    database = createDatabase(":memory:");
    runMigrations(database.db);
  });

  afterEach(() => database.sqlite.close());

  it("does not re-fetch or duplicate messages after a process restart", async () => {
    const appConfig = config();
    const repository = new MailRepository(database.db);
    const firstConnection = new FakeConnection();
    const firstProcess = new SyncService(appConfig, repository, () => firstConnection, pino({ enabled: false }));

    const first = await firstProcess.run("startup", "idle");

    const restartedConnection = new FakeConnection();
    const restartedProcess = new SyncService(
      appConfig,
      new MailRepository(database.db),
      () => restartedConnection,
      pino({ enabled: false }),
    );
    const second = await restartedProcess.run("startup", "idle");

    expect(first).toMatchObject({ status: "success", scanned: 3, inserted: 3 });
    expect(second).toMatchObject({ status: "success", scanned: 0, inserted: 0 });
    expect(firstConnection.requestedAfter).toEqual([0]);
    expect(restartedConnection.requestedAfter).toEqual([0]);
    expect(repository.countEmails()).toBe(3);
  });

  it("backfills historical UIDs that a provider exposes after newer messages", async () => {
    const appConfig = config();
    const repository = new MailRepository(database.db);
    await new SyncService(
      appConfig,
      repository,
      () => new FakeConnection("99", [message(100), message(101)]),
      pino({ enabled: false }),
    ).run("startup", "idle");

    const expanded = new FakeConnection("99", [
      message(1),
      message(2),
      message(100),
      message(101),
      message(102),
    ]);
    const result = await new SyncService(
      appConfig,
      new MailRepository(database.db),
      () => expanded,
      pino({ enabled: false }),
    ).run("poll", "poll");

    expect(result).toMatchObject({ status: "success", scanned: 3, inserted: 3 });
    expect(expanded.requestedAfter).toEqual([0]);
    expect(database.db.select({ uid: emails.uid }).from(emails).all().map((row) => row.uid).sort((a, b) => a - b))
      .toEqual([1, 2, 100, 101, 102]);
  });

  it("keeps unread messages unread and never fetches a body during synchronization", async () => {
    const repository = new MailRepository(database.db);
    const connection = new FakeConnection("99", [message(7)]);
    const service = new SyncService(config(), repository, () => connection, pino({ enabled: false }));

    const result = await service.run("startup", "idle");
    const stored = database.db.select().from(emails).get();

    expect(result.status).toBe("success");
    expect(connection.bodyFetches).toBe(0);
    expect(connection.remoteUnread.get(7)).toBe(true);
    expect(stored?.isUnread).toBe(true);
    expect(stored?.flagsJson).toBe("[]");
  });

  it("starts a separate mailbox epoch when UIDVALIDITY changes", async () => {
    const repository = new MailRepository(database.db);
    const firstConnection = new FakeConnection("99", [message(1)]);
    await new SyncService(config(), repository, () => firstConnection, pino({ enabled: false })).run("startup", "idle");

    const newEpochMessage = { ...message(1), subject: "Same UID in a new mailbox epoch" };
    const secondConnection = new FakeConnection("100", [newEpochMessage]);
    const second = await new SyncService(
      config(),
      new MailRepository(database.db),
      () => secondConnection,
      pino({ enabled: false }),
    ).run("startup", "idle");

    expect(second).toMatchObject({ status: "success", scanned: 1, inserted: 1 });
    expect(secondConnection.requestedAfter).toEqual([0]);
    expect(database.db.select().from(mailboxes).all().map((row) => row.uidValidity).sort()).toEqual(["100", "99"]);
    expect(database.db.select().from(emails).all().map((row) => row.uidValidity).sort()).toEqual(["100", "99"]);
  });

  it("redacts the authorization code from errors, persisted failures, and logs", async () => {
    const authorizationCode = "very-secret-163-code";
    const appConfig = config({ MAIL_AUTH_CODE: authorizationCode });
    const repository = new MailRepository(database.db);
    const chunks: string[] = [];
    const logger = pino({ level: "debug" }, { write: (chunk: string) => chunks.push(chunk) });
    const service = new SyncService(
      appConfig,
      repository,
      () => new FailingConnection(new Error(`authorization=${authorizationCode}; login rejected`)),
      logger,
    );

    const result = await service.run("startup", "idle");
    const persisted = JSON.stringify(repository.listSyncFailures());
    const output = chunks.join("");

    expect(result.status).toBe("failed");
    expect(output).not.toContain(authorizationCode);
    expect(persisted).not.toContain(authorizationCode);
    expect(`${output}${persisted}`).toContain("[REDACTED]");
  });
});
