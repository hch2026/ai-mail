import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readConfig } from "../src/config/env.js";
import { createDatabase, runMigrations, type DatabaseBundle } from "../src/db/client.js";
import { MailRepository } from "../src/db/repository.js";
import type { ImapConnection, ReadOnlyMailboxSession } from "../src/imap/types.js";
import { MailAttachmentService } from "../src/services/mail-attachment-service.js";

describe("MailAttachmentService", () => {
  let database: DatabaseBundle;

  beforeEach(() => {
    database = createDatabase(":memory:");
    runMigrations(database.db);
  });

  afterEach(() => database.sqlite.close());

  it("resolves historical attachment metadata and downloads the MIME part read-only", async () => {
    const repository = new MailRepository(database.db);
    const mailbox = repository.upsertMailbox({ accountKey: "account", path: "INBOX", uidValidity: "9", highestModseq: null });
    const email = repository.upsertEmail(mailbox.id, "9", {
      uid: 88,
      messageId: "<88@example.com>",
      fromName: "Sender",
      fromAddress: "sender@example.com",
      subject: "PNG attachment",
      sentAt: new Date("2026-01-01T00:00:00.000Z"),
      internalDate: new Date("2026-01-01T00:00:00.000Z"),
      size: 500,
      flags: [],
      imapLabels: [],
      isUnread: true,
      textPart: "1",
      htmlPart: null,
      attachments: [{ filename: "photo.png", contentType: "image/png", size: 9 }],
    });
    const fetchBodyPart = vi.fn(async () => ({
      content: Buffer.from("png-bytes"),
      contentType: "image/png",
      charset: null,
    }));
    const connection: ImapConnection = {
      connect: async () => undefined,
      close: async () => undefined,
      waitForChange: async () => false,
      withReadOnlyMailbox: async <T>(callback: (session: ReadOnlyMailboxSession) => Promise<T>) => callback({
        snapshot: { path: "INBOX", uidValidity: "9", highestModseq: null },
        searchNewUids: async () => [],
        fetchMetadata: async () => [{
          uid: 88,
          messageId: "<88@example.com>",
          fromName: "Sender",
          fromAddress: "sender@example.com",
          subject: "PNG attachment",
          sentAt: new Date("2026-01-01T00:00:00.000Z"),
          internalDate: new Date("2026-01-01T00:00:00.000Z"),
          size: 500,
          flags: [],
          imapLabels: [],
          isUnread: true,
          textPart: "1",
          htmlPart: null,
          attachments: [{ filename: "photo.png", contentType: "image/png", size: 9, part: "2", disposition: "attachment" }],
        }],
        fetchChangedFlags: async () => [],
        fetchAllFlags: async () => [],
        fetchBodyPart,
      }),
    };
    const service = new MailAttachmentService(config(), repository, () => connection, pino({ enabled: false }));

    await expect(service.load(email.id, 0)).resolves.toMatchObject({
      contentType: "image/png",
      filename: "photo.png",
      content: Buffer.from("png-bytes"),
    });
    expect(fetchBodyPart).toHaveBeenCalledWith(88, "2", 26_214_401);
    expect(repository.getEmailDetail(email.id)?.isUnread).toBe(true);
  });
});

function config() {
  return readConfig({
    MAIL_EMAIL: "owner@163.com",
    MAIL_IMAP_HOST: "imap.163.com",
    MAIL_IMAP_PORT: "993",
    MAIL_IMAP_SECURE: "true",
    MAIL_AUTH_CODE: "never-log-this",
    DATABASE_URL: ":memory:",
    WEB_ORIGIN: "http://localhost:5173",
  });
}
