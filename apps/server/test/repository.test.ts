import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseBundle } from "../src/db/client.js";
import { MailRepository } from "../src/db/repository.js";
import { emails, mailboxes, syncLocks } from "../src/db/schema.js";

describe("MailRepository", () => {
  let database: DatabaseBundle;

  beforeEach(() => {
    database = createDatabase(":memory:");
    database.sqlite.exec(`
      CREATE TABLE sync_locks (account_key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, acquired_at INTEGER NOT NULL, expires_at INTEGER NOT NULL);
      CREATE TABLE mailboxes (id INTEGER PRIMARY KEY AUTOINCREMENT, account_key TEXT NOT NULL, path TEXT NOT NULL, uid_validity TEXT NOT NULL, highest_uid INTEGER NOT NULL DEFAULT 0, highest_modseq TEXT, last_synced_at INTEGER, last_flag_refresh_at INTEGER, created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000), updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000));
      CREATE UNIQUE INDEX mailboxes_account_path_epoch_uq ON mailboxes(account_key, path, uid_validity);
      CREATE TABLE emails (id INTEGER PRIMARY KEY AUTOINCREMENT, mailbox_id INTEGER NOT NULL REFERENCES mailboxes(id) ON DELETE CASCADE, uid_validity TEXT NOT NULL, uid INTEGER NOT NULL, message_id TEXT, from_name TEXT, from_address TEXT, subject TEXT, sent_at INTEGER, internal_date INTEGER, size INTEGER, flags_json TEXT NOT NULL DEFAULT '[]', imap_labels_json TEXT NOT NULL DEFAULT '[]', is_unread INTEGER NOT NULL DEFAULT 1, preview TEXT, body_text TEXT, body_html TEXT, body_loaded INTEGER NOT NULL DEFAULT 0, content_loaded INTEGER NOT NULL DEFAULT 0, remote_image_count INTEGER NOT NULL DEFAULT 0, inline_image_count INTEGER NOT NULL DEFAULT 0, text_part TEXT, html_part TEXT, attachments_json TEXT NOT NULL DEFAULT '[]', classification_status TEXT NOT NULL DEFAULT 'pending', classification_started_at INTEGER, classified_at INTEGER, deleted_at INTEGER, deleted_mailbox TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000), updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000));
      CREATE UNIQUE INDEX emails_mailbox_epoch_uid_uq ON emails(mailbox_id, uid_validity, uid);
    `);
  });

  afterEach(() => database.sqlite.close());

  it("allows one lock owner and recovers expired leases", () => {
    const repository = new MailRepository(database.db);
    const now = new Date("2025-01-01T00:00:00.000Z");
    expect(repository.acquireSyncLock("account", "owner-a", 1_000, now)).toBe(true);
    expect(repository.acquireSyncLock("account", "owner-b", 1_000, now)).toBe(false);
    expect(repository.acquireSyncLock("account", "owner-b", 1_000, new Date(now.getTime() + 1_001))).toBe(true);
    expect(database.db.select().from(syncLocks).all()).toHaveLength(1);
  });

  it("upserts by mailbox, UIDVALIDITY and UID", () => {
    const repository = new MailRepository(database.db);
    const mailbox = repository.upsertMailbox({
      accountKey: "account",
      path: "INBOX",
      uidValidity: "42",
      highestModseq: null,
    });
    const message = {
      uid: 10,
      messageId: "<message@example.com>",
      fromName: "Sender",
      fromAddress: "sender@example.com",
      subject: "Hello",
      sentAt: new Date(),
      internalDate: new Date(),
      size: 100,
      flags: [],
      imapLabels: [],
      isUnread: true,
      textPart: "1",
      htmlPart: null,
      attachments: [],
    };
    expect(repository.upsertEmail(mailbox.id, "42", message).inserted).toBe(true);
    expect(repository.upsertEmail(mailbox.id, "42", { ...message, subject: "Updated" }).inserted).toBe(false);
    expect(database.db.select().from(emails).all()).toHaveLength(1);
    expect(database.db.select().from(emails).get()?.subject).toBe("Updated");
    expect(database.db.select().from(mailboxes).all()).toHaveLength(1);
  });
});
