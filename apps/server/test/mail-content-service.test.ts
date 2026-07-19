import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { readConfig } from "../src/config/env.js";
import { createDatabase, runMigrations, type DatabaseBundle } from "../src/db/client.js";
import { MailRepository } from "../src/db/repository.js";
import type { ImapConnection, ReadOnlyMailboxSession } from "../src/imap/types.js";
import { MailContentService } from "../src/services/mail-content-service.js";

describe("MailContentService", () => {
  let database: DatabaseBundle;

  beforeEach(() => {
    database = createDatabase(":memory:");
    runMigrations(database.db);
  });

  afterEach(() => database.sqlite.close());

  it("loads text, sanitized HTML and CID images without changing unread state", async () => {
    const config = readConfig({
      MAIL_EMAIL: "owner@163.com",
      MAIL_IMAP_HOST: "imap.163.com",
      MAIL_IMAP_PORT: "993",
      MAIL_IMAP_SECURE: "true",
      MAIL_AUTH_CODE: "not-logged",
      DATABASE_URL: ":memory:",
      WEB_ORIGIN: "http://localhost:5173",
    });
    const repository = new MailRepository(database.db);
    const mailbox = repository.upsertMailbox({
      accountKey: "account",
      path: "INBOX",
      uidValidity: "1",
      highestModseq: null,
    });
    const email = repository.upsertEmail(mailbox.id, "1", {
      uid: 42,
      messageId: "<42@example.com>",
      fromName: "Sender",
      fromAddress: "sender@example.com",
      subject: "Rich mail",
      sentAt: new Date("2026-01-01T00:00:00.000Z"),
      internalDate: new Date("2026-01-01T00:00:00.000Z"),
      size: 500,
      flags: [],
      imapLabels: [],
      isUnread: true,
      textPart: "1",
      htmlPart: "2",
      attachments: [],
    });
    const fetchBodyPart = vi.fn<ReadOnlyMailboxSession["fetchBodyPart"]>(async (_uid, part) => {
      if (part === "1") return { content: Buffer.from("完整文本内容"), contentType: "text/plain", charset: "utf-8" };
      if (part === "2") return {
        content: Buffer.from('<p onclick="steal()">完整 HTML</p><script>steal()</script><img src="cid:hero@example"><img src="https://tracker.invalid/pixel.png"><a href="https://bad.invalid">链接文字</a>'),
        contentType: "text/html",
        charset: "utf-8",
      };
      return { content: Buffer.from("png-bytes"), contentType: "image/png", charset: null };
    });
    const fetchMetadata = vi.fn<ReadOnlyMailboxSession["fetchMetadata"]>(async () => [{
      uid: 42,
      messageId: "<42@example.com>",
      fromName: "Sender",
      fromAddress: "sender@example.com",
      subject: "Rich mail",
      sentAt: new Date("2026-01-01T00:00:00.000Z"),
      internalDate: new Date("2026-01-01T00:00:00.000Z"),
      size: 500,
      flags: [],
      imapLabels: [],
      isUnread: true,
      textPart: "1",
      htmlPart: "2",
      attachments: [{
        filename: "hero.png",
        contentType: "image/png",
        size: 9,
        part: "3",
        contentId: "<hero@example>",
        disposition: "inline",
      }],
    }]);
    const connect = vi.fn(async () => undefined);
    const connection: ImapConnection = {
      connect,
      close: async () => undefined,
      waitForChange: async () => false,
      withReadOnlyMailbox: async <T>(callback: (session: ReadOnlyMailboxSession) => Promise<T>) => callback({
        snapshot: { path: "INBOX", uidValidity: "1", highestModseq: null },
        searchNewUids: async () => [],
        fetchMetadata,
        fetchChangedFlags: async () => [],
        fetchAllFlags: async () => [],
        fetchBodyPart,
      }),
    };
    const service = new MailContentService(config, repository, () => connection, pino({ enabled: false }));

    const content = await service.load(email.id);
    expect(content).toMatchObject({
      bodyText: "完整文本内容",
      contentLoaded: true,
      remoteImageCount: 1,
      inlineImageCount: 1,
    });
    expect(content?.bodyHtml).toContain("data:image/png;base64,");
    expect(content?.bodyHtml).toContain("data-remote-src=\"https://tracker.invalid/pixel.png\"");
    expect(content?.bodyHtml).not.toContain("<script");
    expect(content?.bodyHtml).not.toContain("onclick");
    expect(content?.bodyHtml).not.toContain("href=");
    expect(repository.getEmailDetail(email.id)?.isUnread).toBe(true);

    await service.load(email.id);
    expect(connect).toHaveBeenCalledTimes(1);
  });

  it("repairs a previously cached empty body", async () => {
    const config = readConfig({
      MAIL_EMAIL: "owner@163.com",
      MAIL_IMAP_HOST: "imap.163.com",
      MAIL_IMAP_PORT: "993",
      MAIL_IMAP_SECURE: "true",
      MAIL_AUTH_CODE: "not-logged",
      DATABASE_URL: ":memory:",
      WEB_ORIGIN: "http://localhost:5173",
    });
    const repository = new MailRepository(database.db);
    const mailboxRecord = repository.upsertMailbox({
      accountKey: "account",
      path: "INBOX",
      uidValidity: "1",
      highestModseq: null,
    });
    const email = repository.upsertEmail(mailboxRecord.id, "1", {
      uid: 43,
      messageId: "<43@example.com>",
      fromName: "GitHub",
      fromAddress: "noreply@github.com",
      subject: "Please verify your device",
      sentAt: new Date("2026-01-01T00:00:00.000Z"),
      internalDate: new Date("2026-01-01T00:00:00.000Z"),
      size: 938,
      flags: [],
      imapLabels: [],
      isUnread: true,
      textPart: null,
      htmlPart: null,
      attachments: [],
    });
    repository.saveMailContent(email.id, {
      bodyText: null,
      bodyHtml: null,
      remoteImageCount: 0,
      inlineImageCount: 0,
    });

    const fetchBodyPart = vi.fn<ReadOnlyMailboxSession["fetchBodyPart"]>(async () => ({
      content: Buffer.from("Verification code: 123456"),
      contentType: "text/plain",
      charset: "UTF-8",
    }));
    const connection: ImapConnection = {
      connect: async () => undefined,
      close: async () => undefined,
      waitForChange: async () => false,
      withReadOnlyMailbox: async <T>(callback: (session: ReadOnlyMailboxSession) => Promise<T>) => callback({
        snapshot: { path: "INBOX", uidValidity: "1", highestModseq: null },
        searchNewUids: async () => [],
        fetchMetadata: async () => [{
          uid: 43,
          messageId: "<43@example.com>",
          fromName: "GitHub",
          fromAddress: "noreply@github.com",
          subject: "Please verify your device",
          sentAt: new Date("2026-01-01T00:00:00.000Z"),
          internalDate: new Date("2026-01-01T00:00:00.000Z"),
          size: 938,
          flags: [],
          imapLabels: [],
          isUnread: true,
          textPart: "1",
          htmlPart: null,
          attachments: [],
        }],
        fetchChangedFlags: async () => [],
        fetchAllFlags: async () => [],
        fetchBodyPart,
      }),
    };
    const service = new MailContentService(config, repository, () => connection, pino({ enabled: false }));

    await expect(service.load(email.id)).resolves.toMatchObject({
      bodyText: "Verification code: 123456",
      contentLoaded: true,
    });
    expect(fetchBodyPart).toHaveBeenCalledWith(43, "1", config.MAX_BODY_BYTES);
    expect(repository.getEmailDetail(email.id)?.isUnread).toBe(true);
  });
});
