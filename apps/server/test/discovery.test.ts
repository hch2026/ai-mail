import pino from "pino";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { readConfig } from "../src/config/env.js";
import { createDatabase, runMigrations, type DatabaseBundle } from "../src/db/client.js";
import { DiscoveryRepository } from "../src/db/discovery-repository.js";
import { MailRepository } from "../src/db/repository.js";
import { taxonomyVersions } from "../src/db/schema.js";
import type { ImapConnection, ReadOnlyMailboxSession } from "../src/imap/types.js";
import { DiscoveryService } from "../src/services/discovery-service.js";

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
      fetchBodyPart: async () => ({ content: Buffer.from(""), contentType: "text/plain", charset: "utf-8" }),
    });
  }
}

const taxonomyLabels = Array.from({ length: 8 }, (_, index) => ({
  label: `分类 ${index + 1}`,
  description: `第 ${index + 1} 个测试分类`,
  estimatedCount: index === 0 ? 1 : 0,
  exampleSenders: [],
  exampleSubjects: [],
}));

describe("taxonomy discovery lifecycle", () => {
  let database: DatabaseBundle;

  beforeEach(() => {
    database = createDatabase(":memory:");
    runMigrations(database.db);
  });

  afterEach(() => database.sqlite.close());

  it("creates only a draft report and never activates a taxonomy during analysis", async () => {
    const config = readConfig({
      MAIL_EMAIL: "owner@163.com",
      MAIL_IMAP_HOST: "imap.163.com",
      MAIL_IMAP_PORT: "993",
      MAIL_IMAP_SECURE: "true",
      MAIL_AUTH_CODE: "test-only",
      DATABASE_URL: ":memory:",
    });
    const repository = new MailRepository(database.db);
    const discoveryRepository = new DiscoveryRepository(database.db);
    const mailbox = repository.upsertMailbox({ accountKey: "account", path: "INBOX", uidValidity: "1", highestModseq: null });
    repository.upsertEmail(mailbox.id, "1", {
      uid: 1,
      messageId: "<1@example.com>",
      fromName: "Example Bank",
      fromAddress: "notice@bank.example",
      subject: "本月账单已生成",
      sentAt: new Date("2025-01-01T00:00:00.000Z"),
      internalDate: new Date("2025-01-01T00:00:00.000Z"),
      size: 100,
      flags: [],
      imapLabels: [],
      isUnread: true,
      textPart: null,
      htmlPart: null,
      attachments: [],
    });
    const service = new DiscoveryService(
      config,
      discoveryRepository,
      repository,
      () => new NoopConnection(),
      pino({ enabled: false }),
    );

    const report = await service.analyze();
    expect(report.status).toBe("draft");
    expect(report.report.totalEmails).toBe(1);
    expect(report.report.suggestedTaxonomy).toHaveLength(8);
    expect(discoveryRepository.getConfirmedTaxonomy()).toBeNull();
    expect(database.db.select().from(taxonomyVersions).all()).toHaveLength(0);
  });

  it("supersedes the previous version only after a new draft is explicitly confirmed", () => {
    const repository = new DiscoveryRepository(database.db);
    const reportOne = repository.saveReport({
      totalEmails: 1,
      dateRange: { from: "", to: "" },
      topSenders: [],
      clusters: [],
      suggestedTaxonomy: taxonomyLabels,
      uncertainClusters: [],
      possiblePromotions: [],
    });
    const versionOne = repository.confirmTaxonomy({ reportId: reportOne.id, labels: taxonomyLabels });
    repository.finishBackfill(versionOne.id, true);

    const reportTwo = repository.saveReport({
      totalEmails: 1,
      dateRange: { from: "", to: "" },
      topSenders: [],
      clusters: [],
      suggestedTaxonomy: taxonomyLabels.map((item) => ({ ...item, label: `新版${item.label}` })),
      uncertainClusters: [],
      possiblePromotions: [],
    });
    const versionTwo = repository.confirmTaxonomy({
      reportId: reportTwo.id,
      labels: reportTwo.report.suggestedTaxonomy,
    });
    const rows = database.db.select().from(taxonomyVersions).all();

    expect(rows.find((row) => row.id === versionOne.id)?.status).toBe("superseded");
    expect(rows.find((row) => row.id === versionTwo.id)?.status).toBe("confirmed");
  });
});
