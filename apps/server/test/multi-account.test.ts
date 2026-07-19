import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AccountRegistry } from "../src/accounts/account-registry.js";
import { readConfig } from "../src/config/env.js";
import { createDatabase, runMigrations, type DatabaseBundle } from "../src/db/client.js";
import { DiscoveryRepository } from "../src/db/discovery-repository.js";
import { MailRepository } from "../src/db/repository.js";
import type { ImapConnection, MailboxMoveRequest, ReadOnlyMailboxSession } from "../src/imap/types.js";
import { MailDeletionService } from "../src/services/mail-deletion-service.js";

const labels = Array.from({ length: 8 }, (_, index) => ({
  label: `账户分类 ${index + 1}`,
  description: `测试账户隔离分类 ${index + 1}`,
  estimatedCount: 0,
  exampleSenders: [],
  exampleSubjects: [],
}));

function config() {
  return readConfig({
    MAIL_EMAIL: "owner@163.com",
    MAIL_IMAP_HOST: "imap.163.com",
    MAIL_IMAP_PORT: "993",
    MAIL_IMAP_SECURE: "true",
    MAIL_AUTH_CODE: "secret-163-code",
    MAIL_QQ_ENABLED: "true",
    MAIL_QQ_EMAIL: "123456@qq.com",
    MAIL_QQ_AUTH_CODE: "secret-qq-code",
    MAIL_QQ_WRITE_ENABLED: "true",
    DATABASE_URL: ":memory:",
    WEB_ORIGIN: "http://localhost:5173",
  });
}

class TrashConnection implements ImapConnection {
  public constructor(
    private readonly accountKey: string,
    private readonly usedAccounts: string[],
  ) {}
  public async connect(): Promise<void> { this.usedAccounts.push(this.accountKey); }
  public async close(): Promise<void> {}
  public async waitForChange(): Promise<boolean> { return false; }
  public async withReadOnlyMailbox<T>(_callback: (session: ReadOnlyMailboxSession) => Promise<T>): Promise<T> {
    throw new Error("not used");
  }
  public async moveMessagesToTrash(input: MailboxMoveRequest) {
    return { moved: input.uids.length, targetMailbox: "Trash" };
  }
}

describe("multi-account isolation", () => {
  let database: DatabaseBundle;

  beforeEach(() => {
    database = createDatabase(":memory:");
    runMigrations(database.db);
  });
  afterEach(() => database.sqlite.close());

  it("never exposes account addresses or authorization codes in account DTOs", () => {
    const registry = new AccountRegistry(config());
    const serialized = JSON.stringify(registry.listDtos());
    expect(registry.listDtos()).toEqual([
      { id: "163", provider: "163", displayName: "163邮箱", writeEnabled: false, isDefault: true },
      { id: "qq", provider: "qq", displayName: "QQ邮箱", writeEnabled: true, isDefault: false },
    ]);
    expect(serialized).not.toContain("owner@163.com");
    expect(serialized).not.toContain("123456@qq.com");
    expect(serialized).not.toContain("secret-163-code");
    expect(serialized).not.toContain("secret-qq-code");
  });

  it("keeps UID and taxonomy data separate for 163 and QQ", () => {
    const registry = new AccountRegistry(config());
    const [mail163, qq] = registry.all();
    const repository = new MailRepository(database.db);
    const mailbox163 = repository.upsertMailbox({ accountKey: mail163!.accountKey, path: "INBOX", uidValidity: "1", highestModseq: null });
    const mailboxQq = repository.upsertMailbox({ accountKey: qq!.accountKey, path: "INBOX", uidValidity: "1", highestModseq: null });
    for (const mailbox of [mailbox163, mailboxQq]) {
      repository.upsertEmail(mailbox.id, "1", {
        uid: 7,
        messageId: null,
        fromName: null,
        fromAddress: "sender@example.com",
        subject: "same uid",
        sentAt: new Date(),
        internalDate: new Date(),
        size: 10,
        flags: [],
        imapLabels: [],
        isUnread: true,
        textPart: "1",
        htmlPart: null,
        attachments: [],
      });
    }
    expect(repository.getDashboard(undefined, mail163!.accountKey).total).toBe(1);
    expect(repository.getDashboard(undefined, qq!.accountKey).total).toBe(1);
    expect(repository.getDashboard().total).toBe(2);

    const discovery163 = new DiscoveryRepository(database.db, mail163!.accountKey);
    const discoveryQq = new DiscoveryRepository(database.db, qq!.accountKey);
    const report163 = discovery163.saveReport({ totalEmails: 1, dateRange: { from: "", to: "" }, topSenders: [], clusters: [], suggestedTaxonomy: labels, uncertainClusters: [], possiblePromotions: [] });
    discovery163.confirmTaxonomy({ reportId: report163.id, labels });
    expect(discovery163.getConfirmedTaxonomy()).not.toBeNull();
    expect(discoveryQq.getConfirmedTaxonomy()).toBeNull();
  });

  it("routes a trash move to the selected email's account and rejects mixed accounts", async () => {
    const appConfig = config();
    const registry = new AccountRegistry(appConfig);
    const [mail163, qq] = registry.all();
    const repository = new MailRepository(database.db);
    const ids = registry.all().map((account, index) => {
      const mailbox = repository.upsertMailbox({ accountKey: account.accountKey, path: "INBOX", uidValidity: "1", highestModseq: null });
      return repository.upsertEmail(mailbox.id, "1", {
        uid: index + 1,
        messageId: null,
        fromName: null,
        fromAddress: null,
        subject: null,
        sentAt: null,
        internalDate: null,
        size: null,
        flags: [], imapLabels: [], isUnread: true, textPart: null, htmlPart: null, attachments: [],
      }).id;
    });
    const usedAccounts: string[] = [];
    const service = new MailDeletionService(
      appConfig,
      repository,
      (accountKey) => new TrashConnection(accountKey!, usedAccounts),
      pino({ enabled: false }),
      () => true,
    );

    await expect(service.moveToTrash([ids[0]!, ids[1]!])).rejects.toThrow(/multiple mail accounts/i);
    expect(usedAccounts).not.toContain(mail163!.accountKey);
    await expect(service.moveToTrash([ids[1]!])).resolves.toMatchObject({ moved: 1, dryRun: false });
    expect(usedAccounts).toEqual([qq!.accountKey]);
  });
});
