import { and, desc, eq, gte, inArray, isNull, like, lte, lt, ne, or, sql, type SQL } from "drizzle-orm";
import {
  classificationSchemaFor,
  type Classification,
  type DashboardDto,
  type EmailDetailDto,
  type EmailListItemDto,
  type EmailQuery,
  type LabelDto,
  type ManualClassificationPatch,
  type PaginatedEmailsDto,
} from "@mail-ai/shared";

import type { AttachmentMetadata, ImapMessageMetadata } from "../imap/types.js";
import type { AppDatabase } from "./client.js";
import {
  classificationHistory,
  classifications,
  emails,
  mailAccounts,
  mailboxes,
  syncFailures,
  syncLocks,
  syncRuns,
} from "./schema.js";

export interface SyncCounters {
  scanned: number;
  inserted: number;
  updated: number;
  classified: number;
  failed: number;
}

export interface MailboxMoveRecord {
  id: number;
  accountKey: string;
  mailbox: string;
  uidValidity: string;
  uid: number;
}

export class MailRepository {
  public constructor(private readonly db: AppDatabase) {}

  public acquireSyncLock(accountKey: string, ownerId: string, ttlMs: number, now = new Date()): boolean {
    return this.db.transaction((tx) => {
      tx.delete(syncLocks)
        .where(and(eq(syncLocks.accountKey, accountKey), lt(syncLocks.expiresAt, now)))
        .run();
      const inserted = tx
        .insert(syncLocks)
        .values({ accountKey, ownerId, acquiredAt: now, expiresAt: new Date(now.getTime() + ttlMs) })
        .onConflictDoNothing()
        .run();
      return inserted.changes === 1;
    });
  }

  public renewSyncLock(accountKey: string, ownerId: string, ttlMs: number, now = new Date()): void {
    this.db
      .update(syncLocks)
      .set({ expiresAt: new Date(now.getTime() + ttlMs) })
      .where(and(eq(syncLocks.accountKey, accountKey), eq(syncLocks.ownerId, ownerId)))
      .run();
  }

  public releaseSyncLock(accountKey: string, ownerId: string): void {
    this.db
      .delete(syncLocks)
      .where(and(eq(syncLocks.accountKey, accountKey), eq(syncLocks.ownerId, ownerId)))
      .run();
  }

  public upsertMailAccount(input: { accountKey: string; provider: "163" | "qq"; displayName: string }): void {
    this.db.insert(mailAccounts)
      .values(input)
      .onConflictDoUpdate({
        target: mailAccounts.accountKey,
        set: { provider: input.provider, displayName: input.displayName, updatedAt: new Date() },
      })
      .run();
  }

  public getAccountKeyForEmail(id: number): string | null {
    return this.db.select({ accountKey: mailboxes.accountKey })
      .from(emails)
      .innerJoin(mailboxes, eq(mailboxes.id, emails.mailboxId))
      .where(and(eq(emails.id, id), isNull(emails.deletedAt)))
      .get()?.accountKey ?? null;
  }

  public createSyncRun(
    trigger: "startup" | "idle" | "poll" | "manual",
    mode: "idle" | "poll",
    accountKey?: string,
  ): number {
    const row = this.db
      .insert(syncRuns)
      .values({ trigger, mode, status: "running", accountKey: accountKey ?? null })
      .returning({ id: syncRuns.id })
      .get();
    return row.id;
  }

  public finishSyncRun(
    id: number,
    status: "success" | "failed" | "skipped",
    counters: SyncCounters,
    errorMessage?: string,
  ): void {
    this.db
      .update(syncRuns)
      .set({ status, ...counters, errorMessage, finishedAt: new Date() })
      .where(eq(syncRuns.id, id))
      .run();
  }

  public recordSyncFailure(
    syncRunId: number,
    stage: string,
    message: string,
    options: { errorCode?: string; emailId?: number; retryable?: boolean } = {},
  ): void {
    this.db
      .insert(syncFailures)
      .values({
        syncRunId,
        stage,
        message: message.slice(0, 1_000),
        errorCode: options.errorCode,
        emailId: options.emailId,
        retryable: options.retryable ?? true,
      })
      .run();
  }

  public upsertMailbox(input: {
    accountKey: string;
    path: string;
    uidValidity: string;
    highestModseq: string | null;
  }): { id: number; highestUid: number; highestModseq: string | null; lastFlagRefreshAt: Date | null } {
    const now = new Date();
    this.db
      .insert(mailboxes)
      .values({ ...input, updatedAt: now })
      .onConflictDoUpdate({
        target: [mailboxes.accountKey, mailboxes.path, mailboxes.uidValidity],
        set: { updatedAt: now },
      })
      .run();
    const row = this.db
      .select({
        id: mailboxes.id,
        highestUid: mailboxes.highestUid,
        highestModseq: mailboxes.highestModseq,
        lastFlagRefreshAt: mailboxes.lastFlagRefreshAt,
      })
      .from(mailboxes)
      .where(
        and(
          eq(mailboxes.accountKey, input.accountKey),
          eq(mailboxes.path, input.path),
          eq(mailboxes.uidValidity, input.uidValidity),
        ),
      )
      .get();
    if (!row) throw new Error("mailbox upsert did not return a row");
    return row;
  }

  public upsertEmail(mailboxId: number, uidValidity: string, message: ImapMessageMetadata): {
    id: number;
    inserted: boolean;
    needsClassification: boolean;
  } {
    const existing = this.db
      .select({ id: emails.id, classificationStatus: emails.classificationStatus })
      .from(emails)
      .where(
        and(
          eq(emails.mailboxId, mailboxId),
          eq(emails.uidValidity, uidValidity),
          eq(emails.uid, message.uid),
        ),
      )
      .get();
    const values = {
      mailboxId,
      uidValidity,
      uid: message.uid,
      messageId: message.messageId,
      fromName: message.fromName,
      fromAddress: message.fromAddress,
      subject: message.subject,
      sentAt: message.sentAt,
      internalDate: message.internalDate,
      size: message.size,
      flagsJson: JSON.stringify(message.flags),
      imapLabelsJson: JSON.stringify(message.imapLabels),
      isUnread: message.isUnread,
      textPart: message.textPart,
      htmlPart: message.htmlPart,
      attachmentsJson: JSON.stringify(message.attachments),
      updatedAt: new Date(),
    };
    this.db
      .insert(emails)
      .values(values)
      .onConflictDoUpdate({
        target: [emails.mailboxId, emails.uidValidity, emails.uid],
        set: values,
      })
      .run();
    const row = this.db
      .select({ id: emails.id })
      .from(emails)
      .where(
        and(
          eq(emails.mailboxId, mailboxId),
          eq(emails.uidValidity, uidValidity),
          eq(emails.uid, message.uid),
        ),
      )
      .get();
    if (!row) throw new Error("email upsert did not return a row");
    return {
      id: row.id,
      inserted: existing === undefined,
      needsClassification:
        existing === undefined || existing.classificationStatus === "pending",
    };
  }

  public listStoredUids(mailboxId: number, uidValidity: string): number[] {
    return this.db
      .select({ uid: emails.uid })
      .from(emails)
      .where(and(eq(emails.mailboxId, mailboxId), eq(emails.uidValidity, uidValidity)))
      .orderBy(emails.uid)
      .all()
      .map((row) => row.uid);
  }

  public getEmailForClassification(id: number) {
    const row = this.db
      .select({
        id: emails.id,
        uid: emails.uid,
        uidValidity: emails.uidValidity,
        fromName: emails.fromName,
        fromAddress: emails.fromAddress,
        subject: emails.subject,
        sentAt: emails.sentAt,
        isUnread: emails.isUnread,
        flagsJson: emails.flagsJson,
        imapLabelsJson: emails.imapLabelsJson,
        preview: emails.preview,
        bodyText: emails.bodyText,
        bodyLoaded: emails.bodyLoaded,
        textPart: emails.textPart,
        htmlPart: emails.htmlPart,
      })
      .from(emails)
      .where(and(eq(emails.id, id), isNull(emails.deletedAt)))
      .get();
    if (!row) return null;
    return {
      ...row,
      flags: parseStringArray(row.flagsJson),
      imapLabels: parseStringArray(row.imapLabelsJson),
    };
  }

  public getEmailForContent(id: number) {
    return this.db
      .select({
        id: emails.id,
        uid: emails.uid,
        uidValidity: emails.uidValidity,
        mailbox: mailboxes.path,
        textPart: emails.textPart,
        htmlPart: emails.htmlPart,
        bodyText: emails.bodyText,
        bodyHtml: emails.bodyHtml,
        bodyLoaded: emails.bodyLoaded,
        contentLoaded: emails.contentLoaded,
        attachmentsJson: emails.attachmentsJson,
        accountKey: mailboxes.accountKey,
      })
      .from(emails)
      .innerJoin(mailboxes, eq(mailboxes.id, emails.mailboxId))
      .where(and(eq(emails.id, id), isNull(emails.deletedAt)))
      .get() ?? null;
  }

  public getEmailForAttachment(id: number, attachmentIndex: number) {
    const row = this.db
      .select({
        id: emails.id,
        uid: emails.uid,
        uidValidity: emails.uidValidity,
        mailbox: mailboxes.path,
        attachmentsJson: emails.attachmentsJson,
        accountKey: mailboxes.accountKey,
      })
      .from(emails)
      .innerJoin(mailboxes, eq(mailboxes.id, emails.mailboxId))
      .where(and(eq(emails.id, id), isNull(emails.deletedAt)))
      .get();
    if (!row) return null;
    const attachment = parseAttachmentMetadata(row.attachmentsJson)[attachmentIndex];
    return attachment ? { ...row, attachment, attachmentIndex } : null;
  }

  public getEmailsForMailboxMove(ids: number[]): MailboxMoveRecord[] {
    if (ids.length === 0) return [];
    return this.db
      .select({
        id: emails.id,
        accountKey: mailboxes.accountKey,
        mailbox: mailboxes.path,
        uidValidity: emails.uidValidity,
        uid: emails.uid,
      })
      .from(emails)
      .innerJoin(mailboxes, eq(mailboxes.id, emails.mailboxId))
      .where(and(inArray(emails.id, ids), isNull(emails.deletedAt)))
      .orderBy(emails.id)
      .all();
  }

  public markEmailsMovedToTrash(ids: number[], targetMailbox: string, now = new Date()): number {
    if (ids.length === 0) return 0;
    return this.db
      .update(emails)
      .set({ deletedAt: now, deletedMailbox: targetMailbox, updatedAt: now })
      .where(and(inArray(emails.id, ids), isNull(emails.deletedAt)))
      .run().changes;
  }

  public saveBody(id: number, bodyText: string): void {
    const preview = bodyText.replace(/\s+/g, " ").trim().slice(0, 300) || null;
    this.db
      .update(emails)
      .set({ bodyText, preview, bodyLoaded: true, updatedAt: new Date() })
      .where(eq(emails.id, id))
      .run();
  }

  public saveMailContent(
    id: number,
    content: {
      bodyText: string | null;
      bodyHtml: string | null;
      remoteImageCount: number;
      inlineImageCount: number;
    },
  ): void {
    const preview = content.bodyText?.replace(/\s+/g, " ").trim().slice(0, 300) || null;
    this.db
      .update(emails)
      .set({
        bodyText: content.bodyText,
        bodyHtml: content.bodyHtml,
        bodyLoaded: true,
        contentLoaded: true,
        remoteImageCount: content.remoteImageCount,
        inlineImageCount: content.inlineImageCount,
        preview,
        updatedAt: new Date(),
      })
      .where(eq(emails.id, id))
      .run();
  }

  public claimClassification(
    emailId: number,
    taxonomyVersionId?: number,
    force = false,
    now = new Date(),
  ): boolean {
    return this.db.transaction((tx) => {
      const email = tx.select({
        status: emails.classificationStatus,
      }).from(emails).where(eq(emails.id, emailId)).get();
      if (!email || email.status === "classifying") return false;
      if (!force && email.status === "error") return false;

      const existing = tx.select({ taxonomyVersionId: classifications.taxonomyVersionId })
        .from(classifications)
        .where(eq(classifications.emailId, emailId))
        .get();
      const alreadyClassified = existing && (
        taxonomyVersionId === undefined || existing.taxonomyVersionId === taxonomyVersionId
      );
      if (!force && alreadyClassified) return false;

      const claimed = tx.update(emails)
        .set({ classificationStatus: "classifying", classificationStartedAt: now, updatedAt: now })
        .where(and(eq(emails.id, emailId), isNull(emails.deletedAt), ne(emails.classificationStatus, "classifying")))
        .run();
      return claimed.changes === 1;
    });
  }

  public saveClassification(
    emailId: number,
    classification: Classification,
    source: "ai" | "rule" | "manual",
    options: { note?: string; taxonomyVersionId?: number; modelVersion?: string; rawResult?: string } = {},
  ): void {
    const now = new Date();
    const needsReview = classification.confidence < 0.75 || classification.suggestedAction === "review";
    const taxonomyVersionId = options.taxonomyVersionId ?? null;
    const modelVersion = options.modelVersion ?? (source === "ai" ? "ai-unspecified" : "local-rule-v1");
    const rawResult = options.rawResult ?? JSON.stringify(classification);
    this.db.transaction((tx) => {
      const before = tx.select().from(classifications).where(eq(classifications.emailId, emailId)).get();
      const values = {
        emailId,
        taxonomyVersionId,
        primaryLabel: classification.primaryLabel,
        sourceLabelsJson: JSON.stringify(classification.sourceLabels),
        actionRequired: classification.actionRequired,
        suspectedPromotion: classification.suspectedPromotion,
        confidence: classification.confidence,
        reason: classification.reason,
        suggestedAction: classification.suggestedAction,
        source,
        modelVersion,
        rawResultJson: rawResult,
        processedAt: now,
        needsReview,
        updatedAt: now,
      };
      tx.insert(classifications)
        .values(values)
        .onConflictDoUpdate({ target: classifications.emailId, set: values })
        .run();
      tx.insert(classificationHistory)
        .values({
          emailId,
          actor: source,
          beforeJson: before ? JSON.stringify(toClassificationSnapshot(before)) : null,
          afterJson: JSON.stringify({
            ...classification,
            source,
            needsReview,
            taxonomyVersionId,
            modelVersion,
            rawResult,
            processedAt: now.toISOString(),
          }),
          note: options.note,
        })
        .run();
      tx.update(emails)
        .set({
          classificationStatus: needsReview ? "review" : "classified",
          classificationStartedAt: null,
          classifiedAt: now,
          updatedAt: now,
        })
        .where(eq(emails.id, emailId))
        .run();
    });
  }

  public markClassificationError(emailId: number): void {
    this.db
      .update(emails)
      .set({ classificationStatus: "error", classificationStartedAt: null, updatedAt: new Date() })
      .where(eq(emails.id, emailId))
      .run();
  }

  public getDashboard(taxonomyVersionId?: number, accountKey?: string): DashboardDto {
    const row = this.db
      .select({
        total: sql<number>`count(${emails.id})`,
        unread: sql<number>`coalesce(sum(case when ${emails.isUnread} = 1 then 1 else 0 end), 0)`,
        unclassified: sql<number>`coalesce(sum(case when ${classifications.id} is null then 1 else 0 end), 0)`,
        needsReview: sql<number>`coalesce(sum(case when ${classifications.needsReview} = 1 then 1 else 0 end), 0)`,
      })
      .from(emails)
      .innerJoin(mailboxes, eq(mailboxes.id, emails.mailboxId))
      .leftJoin(classifications, classificationJoin(taxonomyVersionId))
      .where(and(isNull(emails.deletedAt), accountKey ? eq(mailboxes.accountKey, accountKey) : undefined))
      .get();
    return {
      total: Number(row?.total ?? 0),
      unread: Number(row?.unread ?? 0),
      unclassified: Number(row?.unclassified ?? 0),
      needsReview: Number(row?.needsReview ?? 0),
    };
  }

  public getLabels(taxonomyVersionId?: number, accountKey?: string): LabelDto[] {
    if (!taxonomyVersionId) return [];
    const rows = this.db
      .select({
        label: classifications.primaryLabel,
        total: sql<number>`count(${emails.id})`,
        unread: sql<number>`coalesce(sum(case when ${emails.isUnread} = 1 then 1 else 0 end), 0)`,
      })
      .from(classifications)
      .innerJoin(emails, eq(emails.id, classifications.emailId))
      .innerJoin(mailboxes, eq(mailboxes.id, emails.mailboxId))
      .where(and(
        eq(classifications.taxonomyVersionId, taxonomyVersionId),
        isNull(emails.deletedAt),
        accountKey ? eq(mailboxes.accountKey, accountKey) : undefined,
      ))
      .groupBy(classifications.primaryLabel)
      .all();
    return rows
      .map((row) => ({ label: row.label, total: Number(row.total), unread: Number(row.unread) }))
      .sort((a, b) => b.total - a.total || a.label.localeCompare(b.label));
  }

  public listEmails(query: EmailQuery, taxonomyVersionId?: number, accountKey?: string): PaginatedEmailsDto {
    const conditions: SQL[] = [isNull(emails.deletedAt)];
    if (accountKey) conditions.push(eq(mailboxes.accountKey, accountKey));
    if (query.label) conditions.push(eq(classifications.primaryLabel, query.label));
    if (query.unread !== undefined) conditions.push(eq(emails.isUnread, query.unread));
    if (query.sender) {
      const pattern = `%${query.sender}%`;
      const senderCondition = or(like(emails.fromAddress, pattern), like(emails.fromName, pattern));
      if (senderCondition) conditions.push(senderCondition);
    }
    if (query.from) conditions.push(gte(emails.sentAt, new Date(query.from)));
    if (query.to) conditions.push(lte(emails.sentAt, new Date(query.to)));
    if (query.review !== undefined) conditions.push(eq(classifications.needsReview, query.review));
    if (query.actionRequired !== undefined) {
      conditions.push(eq(classifications.actionRequired, query.actionRequired));
    }
    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const offset = (query.page - 1) * query.pageSize;

    const total = this.db
      .select({ value: sql<number>`count(${emails.id})` })
      .from(emails)
      .innerJoin(mailboxes, eq(mailboxes.id, emails.mailboxId))
      .leftJoin(classifications, classificationJoin(taxonomyVersionId))
      .where(where)
      .get()?.value;
    const rows = this.db
      .select(emailListSelection)
      .from(emails)
      .innerJoin(mailboxes, eq(mailboxes.id, emails.mailboxId))
      .leftJoin(classifications, classificationJoin(taxonomyVersionId))
      .where(where)
      .orderBy(desc(emails.sentAt), desc(emails.id))
      .limit(query.pageSize)
      .offset(offset)
      .all();
    return {
      items: rows.map(toEmailListItem),
      total: Number(total ?? 0),
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  public getEmailDetail(id: number, taxonomyVersionId?: number): EmailDetailDto | null {
    const row = this.db
      .select({
        ...emailListSelection,
        mailbox: mailboxes.path,
        uidValidity: emails.uidValidity,
        flagsJson: emails.flagsJson,
        bodyText: emails.bodyText,
        bodyHtml: emails.bodyHtml,
        bodyLoaded: emails.bodyLoaded,
        contentLoaded: emails.contentLoaded,
        remoteImageCount: emails.remoteImageCount,
        inlineImageCount: emails.inlineImageCount,
        attachmentsJson: emails.attachmentsJson,
        sourceLabelsJson: classifications.sourceLabelsJson,
        reason: classifications.reason,
        suggestedAction: classifications.suggestedAction,
        classificationSource: classifications.source,
        taxonomyVersionId: classifications.taxonomyVersionId,
        modelVersion: classifications.modelVersion,
        rawResult: classifications.rawResultJson,
        processedAt: classifications.processedAt,
      })
      .from(emails)
      .innerJoin(mailboxes, eq(mailboxes.id, emails.mailboxId))
      .leftJoin(classifications, classificationJoin(taxonomyVersionId))
      .where(and(eq(emails.id, id), isNull(emails.deletedAt)))
      .get();
    if (!row) return null;
    const history = this.db
      .select()
      .from(classificationHistory)
      .where(eq(classificationHistory.emailId, id))
      .orderBy(desc(classificationHistory.createdAt))
      .all();
    return {
      ...toEmailListItem(row),
      mailbox: row.mailbox,
      uidValidity: row.uidValidity,
      flags: parseStringArray(row.flagsJson),
      bodyText: row.bodyText,
      bodyHtml: row.bodyHtml,
      bodyLoaded: row.bodyLoaded,
      contentLoaded: row.contentLoaded,
      remoteImageCount: row.remoteImageCount,
      inlineImageCount: row.inlineImageCount,
      attachments: parseAttachments(row.attachmentsJson),
      sourceLabels: parseStringArray(row.sourceLabelsJson ?? "[]"),
      reason: row.reason,
      suggestedAction: row.suggestedAction,
      classificationSource: row.classificationSource,
      taxonomyVersionId: row.taxonomyVersionId,
      modelVersion: row.modelVersion,
      rawResult: row.rawResult,
      processedAt: row.processedAt?.toISOString() ?? null,
      history: history.map((item) => ({
        id: item.id,
        actor: item.actor,
        before: parseJson(item.beforeJson),
        after: parseJson(item.afterJson),
        note: item.note,
        createdAt: item.createdAt.toISOString(),
      })),
    };
  }

  public applyManualPatch(
    emailId: number,
    patch: ManualClassificationPatch,
    taxonomyVersionId: number,
    allowedLabels: readonly string[],
  ): void {
    const current = this.db
      .select()
      .from(classifications)
      .where(and(
        eq(classifications.emailId, emailId),
        eq(classifications.taxonomyVersionId, taxonomyVersionId),
      ))
      .get();
    if (!current && !patch.primaryLabel) {
      throw new Error("Choose a primary label before editing an unclassified email");
    }
    const next = classificationSchemaFor(allowedLabels).parse({
      primaryLabel: patch.primaryLabel ?? current!.primaryLabel,
      sourceLabels: patch.sourceLabels ?? parseStringArray(current?.sourceLabelsJson ?? "[]"),
      actionRequired: patch.actionRequired ?? current?.actionRequired ?? false,
      suspectedPromotion: patch.suspectedPromotion ?? current?.suspectedPromotion ?? false,
      confidence: 1,
      reason: "人工确认或修改分类",
      suggestedAction: "label",
    });
    this.saveClassification(emailId, next, "manual", {
      ...(patch.note ? { note: patch.note } : {}),
      taxonomyVersionId,
      modelVersion: "manual",
    });
  }

  public confirmReviews(emailIds: number[], taxonomyVersionId: number): number {
    if (emailIds.length === 0) return 0;
    return this.db.transaction((tx) => {
      const rows = tx
        .select()
        .from(classifications)
        .where(and(
          inArray(classifications.emailId, emailIds),
          eq(classifications.taxonomyVersionId, taxonomyVersionId),
          eq(classifications.needsReview, true),
        ))
        .all();
      const now = new Date();
      for (const row of rows) {
        const before = toClassificationSnapshot(row);
        const after = { ...before, suggestedAction: "label", needsReview: false };
        tx.update(classifications)
          .set({ needsReview: false, suggestedAction: "label", updatedAt: now })
          .where(eq(classifications.id, row.id))
          .run();
        tx.update(emails)
          .set({ classificationStatus: "classified", updatedAt: now })
          .where(eq(emails.id, row.emailId))
          .run();
        tx.insert(classificationHistory)
          .values({
            emailId: row.emailId,
            actor: "bulk-confirm",
            beforeJson: JSON.stringify(before),
            afterJson: JSON.stringify(after),
            note: "批量确认复核结果",
          })
          .run();
      }
      return rows.length;
    });
  }

  public listSyncRuns(limit = 50, accountKey?: string) {
    const query = this.db
      .select()
      .from(syncRuns)
      .where(accountKey ? eq(syncRuns.accountKey, accountKey) : undefined)
      .orderBy(desc(syncRuns.startedAt))
      .limit(limit);
    return query
      .all()
      .map((row) => ({
        ...row,
        startedAt: row.startedAt.toISOString(),
        finishedAt: row.finishedAt?.toISOString() ?? null,
      }));
  }

  public listSyncFailures(limit = 100, accountKey?: string) {
    return this.db
      .select()
      .from(syncFailures)
      .leftJoin(syncRuns, eq(syncRuns.id, syncFailures.syncRunId))
      .where(accountKey ? eq(syncRuns.accountKey, accountKey) : undefined)
      .orderBy(desc(syncFailures.createdAt))
      .limit(limit)
      .all()
      .map((row) => ({ ...row.sync_failures, createdAt: row.sync_failures.createdAt.toISOString() }));
  }

  public updateFlags(mailboxId: number, uidValidity: string, uid: number, flags: string[], labels: string[]): void {
    this.db
      .update(emails)
      .set({
        flagsJson: JSON.stringify(flags),
        imapLabelsJson: JSON.stringify(labels),
        isUnread: !flags.includes("\\Seen"),
        updatedAt: new Date(),
      })
      .where(
        and(eq(emails.mailboxId, mailboxId), eq(emails.uidValidity, uidValidity), eq(emails.uid, uid)),
      )
      .run();
  }

  public completeMailboxPage(
    mailboxId: number,
    highestUid: number,
    highestModseq: string | null,
  ): void {
    this.db
      .update(mailboxes)
      .set({ highestUid, highestModseq, lastSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(mailboxes.id, mailboxId))
      .run();
  }

  public completeFlagRefresh(mailboxId: number): void {
    this.db
      .update(mailboxes)
      .set({ lastFlagRefreshAt: new Date(), updatedAt: new Date() })
      .where(eq(mailboxes.id, mailboxId))
      .run();
  }

  public countEmails(accountKey?: string): number {
    return this.db.select({ count: sql<number>`count(*)` })
      .from(emails)
      .innerJoin(mailboxes, eq(mailboxes.id, emails.mailboxId))
      .where(and(isNull(emails.deletedAt), accountKey ? eq(mailboxes.accountKey, accountKey) : undefined))
      .get()?.count ?? 0;
  }
}

function parseStringArray(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function toClassificationSnapshot(row: typeof classifications.$inferSelect) {
  return {
    primaryLabel: row.primaryLabel,
    sourceLabels: parseStringArray(row.sourceLabelsJson),
    actionRequired: row.actionRequired,
    suspectedPromotion: row.suspectedPromotion,
    confidence: row.confidence,
    reason: row.reason,
    suggestedAction: row.suggestedAction,
    source: row.source,
    taxonomyVersionId: row.taxonomyVersionId,
    modelVersion: row.modelVersion,
    rawResult: row.rawResultJson,
    processedAt: row.processedAt.toISOString(),
    needsReview: row.needsReview,
  };
}

const emailListSelection = {
  id: emails.id,
  uid: emails.uid,
  messageId: emails.messageId,
  fromName: emails.fromName,
  fromAddress: emails.fromAddress,
  subject: emails.subject,
  sentAt: emails.sentAt,
  isUnread: emails.isUnread,
  preview: emails.preview,
  primaryLabel: classifications.primaryLabel,
  confidence: classifications.confidence,
  needsReview: classifications.needsReview,
  actionRequired: classifications.actionRequired,
  suspectedPromotion: classifications.suspectedPromotion,
};

function toEmailListItem(row: {
  id: number;
  uid: number;
  messageId: string | null;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  sentAt: Date | null;
  isUnread: boolean;
  preview: string | null;
  primaryLabel: string | null;
  confidence: number | null;
  needsReview: boolean | null;
  actionRequired: boolean | null;
  suspectedPromotion: boolean | null;
}): EmailListItemDto {
  return {
    ...row,
    sentAt: row.sentAt?.toISOString() ?? null,
    needsReview: row.needsReview ?? false,
    actionRequired: row.actionRequired ?? false,
    suspectedPromotion: row.suspectedPromotion ?? false,
  };
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseAttachmentMetadata(value: string): AttachmentMetadata[] {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.contentType !== "string") return [];
    return [
      {
        filename: typeof record.filename === "string" ? record.filename : null,
        contentType: record.contentType,
        size: typeof record.size === "number" ? record.size : null,
        part: typeof record.part === "string" ? record.part : null,
        contentId: typeof record.contentId === "string" ? record.contentId : null,
        disposition: record.disposition === "attachment" || record.disposition === "inline"
          ? record.disposition
          : "unknown",
      },
    ];
  });
}

function parseAttachments(value: string): Array<{ index: number; filename: string | null; contentType: string; size: number | null }> {
  return parseAttachmentMetadata(value).map((item, index) => ({
    index,
    filename: item.filename,
    contentType: item.contentType,
    size: item.size,
  }));
}

function classificationJoin(taxonomyVersionId?: number): SQL {
  return taxonomyVersionId
    ? and(
        eq(classifications.emailId, emails.id),
        eq(classifications.taxonomyVersionId, taxonomyVersionId),
      )!
    : and(eq(classifications.emailId, emails.id), sql`0 = 1`)!;
}
