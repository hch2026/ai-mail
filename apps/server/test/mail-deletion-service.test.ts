import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readConfig } from "../src/config/env.js";
import { createDatabase, runMigrations, type DatabaseBundle } from "../src/db/client.js";
import { MailRepository } from "../src/db/repository.js";
import type { ImapConnection, MailboxMoveRequest, ReadOnlyMailboxSession } from "../src/imap/types.js";
import { MailDeletionService } from "../src/services/mail-deletion-service.js";

describe("MailDeletionService", () => {
  let database: DatabaseBundle;
  let repository: MailRepository;
  let emailId: number;

  beforeEach(() => {
    database = createDatabase(":memory:");
    runMigrations(database.db);
    repository = new MailRepository(database.db);
    const mailbox = repository.upsertMailbox({
      accountKey: "account",
      path: "INBOX",
      uidValidity: "42",
      highestModseq: null,
    });
    emailId = repository.upsertEmail(mailbox.id, "42", {
      uid: 77,
      messageId: "<77@example.com>",
      fromName: "Promotion",
      fromAddress: "promotion@example.com",
      subject: "限时优惠",
      sentAt: new Date("2026-01-01T00:00:00.000Z"),
      internalDate: new Date("2026-01-01T00:00:00.000Z"),
      size: 100,
      flags: [],
      imapLabels: [],
      isUnread: true,
      textPart: "1",
      htmlPart: null,
      attachments: [],
    }).id;
  });

  afterEach(() => database.sqlite.close());

  it("only previews selected messages while DRY_RUN is enabled", async () => {
    const moveMessagesToTrash = vi.fn(async () => ({ moved: 1, targetMailbox: "已删除" }));
    const service = new MailDeletionService(
      config(true),
      repository,
      () => connection(moveMessagesToTrash),
      pino({ enabled: false }),
    );

    await expect(service.moveToTrash([emailId])).resolves.toEqual({
      requested: 1,
      moved: 0,
      dryRun: true,
      targetMailbox: null,
    });
    expect(moveMessagesToTrash).not.toHaveBeenCalled();
    expect(repository.getEmailDetail(emailId)).not.toBeNull();
  });

  it("marks mail hidden only after the remote move to trash succeeds", async () => {
    const moveMessagesToTrash = vi.fn(async (request: MailboxMoveRequest) => {
      expect(request).toEqual({ mailbox: "INBOX", uidValidity: "42", uids: [77] });
      return { moved: 1, targetMailbox: "已删除" };
    });
    const service = new MailDeletionService(
      config(false),
      repository,
      () => connection(moveMessagesToTrash),
      pino({ enabled: false }),
    );

    await expect(service.moveToTrash([emailId])).resolves.toEqual({
      requested: 1,
      moved: 1,
      dryRun: false,
      targetMailbox: "已删除",
    });
    expect(moveMessagesToTrash).toHaveBeenCalledTimes(1);
    expect(repository.getEmailDetail(emailId)).toBeNull();
    expect(repository.countEmails()).toBe(0);
  });
});

function config(dryRun: boolean) {
  return readConfig({
    MAIL_EMAIL: "owner@163.com",
    MAIL_IMAP_HOST: "imap.163.com",
    MAIL_IMAP_PORT: "993",
    MAIL_IMAP_SECURE: "true",
    MAIL_AUTH_CODE: "never-log-this",
    DATABASE_URL: ":memory:",
    WEB_ORIGIN: "http://localhost:5173",
    DRY_RUN: String(dryRun),
  });
}

function connection(
  moveMessagesToTrash: NonNullable<ImapConnection["moveMessagesToTrash"]>,
): ImapConnection {
  return {
    connect: async () => undefined,
    close: async () => undefined,
    waitForChange: async () => false,
    moveMessagesToTrash,
    withReadOnlyMailbox: async <T>(callback: (session: ReadOnlyMailboxSession) => Promise<T>) => callback({
      snapshot: { path: "INBOX", uidValidity: "42", highestModseq: null },
      searchNewUids: async () => [],
      fetchMetadata: async () => [],
      fetchChangedFlags: async () => [],
      fetchAllFlags: async () => [],
      fetchBodyPart: async () => { throw new Error("not used"); },
    }),
  };
}
