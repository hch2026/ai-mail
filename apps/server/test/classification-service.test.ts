import type { EmailClassifier } from "@mail-ai/classifier";
import { eq } from "drizzle-orm";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDatabase, runMigrations, type DatabaseBundle } from "../src/db/client.js";
import { DiscoveryRepository } from "../src/db/discovery-repository.js";
import { MailRepository } from "../src/db/repository.js";
import { classificationHistory, classifications, emails } from "../src/db/schema.js";
import type { ReadOnlyMailboxSession } from "../src/imap/types.js";
import { ClassificationService } from "../src/services/classification-service.js";

const mailbox: ReadOnlyMailboxSession = {
  snapshot: { path: "INBOX", uidValidity: "1", highestModseq: null },
  searchNewUids: async () => [],
  fetchMetadata: async () => [],
  fetchChangedFlags: async () => [],
  fetchAllFlags: async () => [],
  fetchBodyPart: vi.fn(async () => { throw new Error("classifier must not make a second model pass with the body"); }),
};

describe("ClassificationService", () => {
  let database: DatabaseBundle;
  let repository: MailRepository;
  let emailId: number;

  beforeEach(() => {
    database = createDatabase(":memory:");
    runMigrations(database.db);
    repository = new MailRepository(database.db);
    const mailboxRow = repository.upsertMailbox({
      accountKey: "account",
      path: "INBOX",
      uidValidity: "1",
      highestModseq: null,
    });
    emailId = repository.upsertEmail(mailboxRow.id, "1", {
      uid: 7,
      messageId: "<7@example.com>",
      fromName: "Example",
      fromAddress: "hello@example.com",
      subject: "Ambiguous message",
      sentAt: new Date("2025-01-01T00:00:00.000Z"),
      internalDate: new Date("2025-01-01T00:00:00.000Z"),
      size: 500,
      flags: [],
      imapLabels: [],
      isUnread: true,
      textPart: "1",
      htmlPart: null,
      attachments: [],
    }).id;
  });

  afterEach(() => database.sqlite.close());

  it("stores low-confidence output as review and claims concurrent requests only once", async () => {
    const rawResult = '{"primaryLabel":"个人与其他","confidence":0.62}';
    const classify = vi.fn(async () => ({
      source: "ai" as const,
      modelVersion: "test-model-2026-01",
      rawResult,
      classification: {
        primaryLabel: "个人与其他",
        sourceLabels: ["example.com"],
        actionRequired: false,
        suspectedPromotion: false,
        confidence: 0.62,
        reason: "元数据不足，无法可靠判断",
        suggestedAction: "review" as const,
      },
    }));
    const classifier: EmailClassifier = { classify };
    const service = new ClassificationService(repository, classifier, pino({ enabled: false }));

    const concurrentResults = await Promise.all([
      service.classifyEmail(emailId, mailbox),
      service.classifyEmail(emailId, mailbox),
    ]);
    expect(concurrentResults.sort()).toEqual([false, true]);
    await expect(service.classifyEmail(emailId, mailbox)).resolves.toBe(false);

    expect(classify).toHaveBeenCalledTimes(1);
    expect(mailbox.fetchBodyPart).not.toHaveBeenCalled();
    expect(database.db.select().from(emails).where(eq(emails.id, emailId)).get()).toMatchObject({
      classificationStatus: "review",
      isUnread: true,
      classificationStartedAt: null,
    });
    const stored = database.db.select().from(classifications).where(eq(classifications.emailId, emailId)).get();
    expect(stored).toMatchObject({
      confidence: 0.62,
      reason: "元数据不足，无法可靠判断",
      needsReview: true,
      modelVersion: "test-model-2026-01",
      rawResultJson: rawResult,
    });
    expect(stored?.processedAt).toBeInstanceOf(Date);
    const history = database.db.select().from(classificationHistory).where(eq(classificationHistory.emailId, emailId)).get();
    expect(history?.afterJson).toContain('"rawResult"');
    expect(history?.afterJson).toContain("test-model-2026-01");
  });

  it("does not automatically call the model again after a failed attempt", async () => {
    const classify = vi.fn(async () => { throw new Error("provider unavailable"); });
    const service = new ClassificationService(
      repository,
      { classify },
      pino({ enabled: false }),
    );

    await expect(service.classifyEmail(emailId, mailbox)).rejects.toThrow("provider unavailable");
    await expect(service.classifyEmail(emailId, mailbox)).resolves.toBe(false);

    expect(classify).toHaveBeenCalledTimes(1);
    expect(database.db.select().from(emails).where(eq(emails.id, emailId)).get()?.classificationStatus).toBe("error");
  });

  it("does not call a classifier before a taxonomy is explicitly confirmed", async () => {
    const classify = vi.fn();
    const discoveryRepository = new DiscoveryRepository(database.db);
    const service = new ClassificationService(
      repository,
      { classify },
      pino({ enabled: false }),
      discoveryRepository,
    );

    await expect(service.classifyEmail(emailId, mailbox)).resolves.toBe(false);
    expect(classify).not.toHaveBeenCalled();
    expect(database.db.select().from(classifications).all()).toHaveLength(0);
  });
});
