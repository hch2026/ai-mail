import type { EmailClassifier } from "@mail-ai/classifier";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "../src/app.js";
import { readConfig } from "../src/config/env.js";
import { createDatabase, runMigrations, type DatabaseBundle } from "../src/db/client.js";
import { DiscoveryRepository } from "../src/db/discovery-repository.js";
import { MailRepository } from "../src/db/repository.js";
import type { ImapConnection, ReadOnlyMailboxSession } from "../src/imap/types.js";
import { BackfillService } from "../src/services/backfill-service.js";
import { ClassificationService } from "../src/services/classification-service.js";
import { DiscoveryService } from "../src/services/discovery-service.js";
import { ReclassificationService } from "../src/services/reclassification-service.js";
import { MailContentService } from "../src/services/mail-content-service.js";
import { MailAttachmentService } from "../src/services/mail-attachment-service.js";
import { MailDeletionService } from "../src/services/mail-deletion-service.js";
import { SyncCoordinator } from "../src/sync/coordinator.js";
import { SyncService } from "../src/sync/sync-service.js";

class ReadOnlyConnection implements ImapConnection {
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
      fetchBodyPart: async () => { throw new Error("management actions must not load or mutate mailbox content"); },
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

describe("classification management API", () => {
  let database: DatabaseBundle;

  beforeEach(() => {
    database = createDatabase(":memory:");
    runMigrations(database.db);
  });

  afterEach(() => database.sqlite.close());

  it("filters action mail, edits local classification and explicitly reclassifies without mailbox writes", async () => {
    const config = readConfig({
      MAIL_EMAIL: "owner@163.com",
      MAIL_IMAP_HOST: "imap.163.com",
      MAIL_IMAP_PORT: "993",
      MAIL_IMAP_SECURE: "true",
      MAIL_AUTH_CODE: "test-only-secret",
      DATABASE_URL: ":memory:",
      WEB_ORIGIN: "http://localhost:5173",
    });
    const logger = pino({ enabled: false });
    const repository = new MailRepository(database.db);
    const discoveryRepository = new DiscoveryRepository(database.db);
    const mailbox = repository.upsertMailbox({ accountKey: "account", path: "INBOX", uidValidity: "1", highestModseq: null });
    const email = repository.upsertEmail(mailbox.id, "1", {
      uid: 12,
      messageId: "<12@example.com>",
      fromName: "Example",
      fromAddress: "notice@example.com",
      subject: "请处理测试事项",
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
    const report = discoveryRepository.saveReport({
      totalEmails: 1,
      dateRange: { from: "", to: "" },
      topSenders: [],
      clusters: [],
      suggestedTaxonomy: taxonomyLabels,
      uncertainClusters: [],
      possiblePromotions: [],
    });
    const taxonomy = discoveryRepository.confirmTaxonomy({ reportId: report.id, labels: taxonomyLabels });
    repository.saveClassification(email.id, {
      primaryLabel: taxonomyLabels[0]!.label,
      sourceLabels: ["example.com"],
      actionRequired: true,
      suspectedPromotion: false,
      confidence: 0.7,
      reason: "需要人工确认",
      suggestedAction: "review",
    }, "rule", { taxonomyVersionId: taxonomy.id, modelVersion: "seed-rule", rawResult: "{}" });

    const classify = vi.fn<EmailClassifier["classify"]>(async () => ({
      source: "ai",
      modelVersion: "test-model",
      rawResult: "{\"primaryLabel\":\"分类 3\"}",
      classification: {
        primaryLabel: taxonomyLabels[2]!.label,
        sourceLabels: ["example.com"],
        actionRequired: false,
        suspectedPromotion: false,
        confidence: 0.91,
        reason: "测试重新分类",
        suggestedAction: "label",
      },
    }));
    const classificationService = new ClassificationService(repository, { classify }, logger, discoveryRepository);
    const factory = () => new ReadOnlyConnection();
    const syncService = new SyncService(config, repository, factory, logger, classificationService);
    const coordinator = new SyncCoordinator(config, syncService, factory, logger);
    const discoveryService = new DiscoveryService(config, discoveryRepository, repository, factory, logger);
    const reclassificationService = new ReclassificationService(repository, discoveryRepository, factory, classificationService);
    const backfillService = new BackfillService(discoveryRepository, factory, classificationService, logger);
    const mailContentService = new MailContentService(config, repository, factory, logger);
    const mailAttachmentService = new MailAttachmentService(config, repository, factory, logger);
    const mailDeletionService = new MailDeletionService(config, repository, factory, logger);
    const app = await buildApp(config, logger, {
      repository,
      coordinator,
      reclassificationService,
      discoveryRepository,
      discoveryService,
      backfillService,
      mailContentService,
      mailAttachmentService,
      mailDeletionService,
    });

    const filtered = await app.inject({ method: "GET", url: "/api/emails?actionRequired=true&page=1&pageSize=30" });
    expect(filtered.json()).toMatchObject({ total: 1, items: [{ id: email.id, actionRequired: true }] });

    const deletionPreview = await app.inject({
      method: "POST",
      url: "/api/emails/bulk-delete",
      payload: { emailIds: [email.id] },
    });
    expect(deletionPreview.statusCode).toBe(200);
    expect(deletionPreview.json()).toEqual({ requested: 1, moved: 0, dryRun: true, targetMailbox: null });
    expect(repository.getEmailDetail(email.id, taxonomy.id)).not.toBeNull();

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/emails/${email.id}/classification`,
      payload: { primaryLabel: taxonomyLabels[1]!.label, actionRequired: false, note: "人工调整" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json()).toMatchObject({ primaryLabel: taxonomyLabels[1]!.label, actionRequired: false, isUnread: true, classificationSource: "manual" });

    const reclassified = await app.inject({ method: "POST", url: `/api/emails/${email.id}/reclassify` });
    expect(reclassified.statusCode).toBe(200);
    expect(reclassified.json()).toMatchObject({ primaryLabel: taxonomyLabels[2]!.label, confidence: 0.91, isUnread: true });
    expect(classify).toHaveBeenCalledTimes(1);

    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.json()).toEqual({ ok: true, mode: "read-only-sync+confirmed-trash-move" });
    await app.close();
  });
});
