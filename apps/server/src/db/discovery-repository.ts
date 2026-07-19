import {
  confirmTaxonomySchema,
  mailboxProfileReportSchema,
  taxonomyLabelSchema,
  type ConfirmTaxonomyInput,
  type DiscoveryReportDto,
  type MailboxProfileReport,
  type TaxonomyLabel,
  type TaxonomyStatusDto,
} from "@mail-ai/shared";
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";

import type { DiscoveryEmailInput } from "@mail-ai/classifier";
import type { AppDatabase } from "./client.js";
import {
  classifications,
  discoveryReports,
  emails,
  mailboxes,
  taxonomySuggestions,
  taxonomyVersions,
} from "./schema.js";

export interface DiscoveryEmailRecord extends DiscoveryEmailInput {
  uid: number;
  uidValidity: string;
  bodyLoaded: boolean;
  textPart: string | null;
  htmlPart: string | null;
}

export interface ConfirmedTaxonomy {
  id: number;
  labels: TaxonomyLabel[];
  status: "confirmed" | "active";
  backfillStatus: "pending" | "running" | "completed" | "failed";
}

export class DiscoveryRepository {
  public constructor(
    private readonly db: AppDatabase,
    private readonly accountKey?: string,
  ) {}

  public listDiscoveryEmails(): DiscoveryEmailRecord[] {
    return this.db
      .select({
        id: emails.id,
        mailbox: mailboxes.path,
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
        attachmentsJson: emails.attachmentsJson,
      })
      .from(emails)
      .innerJoin(mailboxes, eq(mailboxes.id, emails.mailboxId))
      .where(and(
        isNull(emails.deletedAt),
        this.accountKey ? eq(mailboxes.accountKey, this.accountKey) : undefined,
      ))
      .orderBy(emails.id)
      .all()
      .map((row) => ({
        id: row.id,
        mailbox: row.mailbox,
        uid: row.uid,
        uidValidity: row.uidValidity,
        fromName: row.fromName,
        fromAddress: row.fromAddress,
        domain: row.fromAddress?.split("@")[1]?.toLowerCase() ?? "",
        subject: row.subject,
        sentAt: row.sentAt?.toISOString() ?? null,
        isUnread: row.isUnread,
        flags: parseStringArray(row.flagsJson),
        imapLabels: parseStringArray(row.imapLabelsJson),
        preview: row.preview,
        bodyText: row.bodyText,
        bodyLoaded: row.bodyLoaded,
        textPart: row.textPart,
        htmlPart: row.htmlPart,
        attachments: parseAttachments(row.attachmentsJson),
      }));
  }

  public saveReport(report: MailboxProfileReport): DiscoveryReportDto {
    const validated = mailboxProfileReportSchema.parse(report);
    return this.db.transaction((tx) => {
      tx.update(discoveryReports)
        .set({ status: "superseded" })
        .where(and(
          eq(discoveryReports.status, "draft"),
          this.accountKey ? eq(discoveryReports.accountKey, this.accountKey) : undefined,
        ))
        .run();
      const row = tx.insert(discoveryReports)
        .values({ accountKey: this.accountKey ?? null, status: "draft", reportJson: JSON.stringify(validated) })
        .returning()
        .get();
      return toReportDto(row);
    });
  }

  public getLatestReport(): DiscoveryReportDto | null {
    const row = this.db.select().from(discoveryReports)
      .where(this.accountKey ? eq(discoveryReports.accountKey, this.accountKey) : undefined)
      .orderBy(desc(discoveryReports.createdAt)).limit(1).get();
    return row ? toReportDto(row) : null;
  }

  public confirmTaxonomy(input: ConfirmTaxonomyInput): ConfirmedTaxonomy {
    const validated = confirmTaxonomySchema.parse(input);
    return this.db.transaction((tx) => {
      const report = tx.select().from(discoveryReports).where(eq(discoveryReports.id, validated.reportId)).get();
      if (!report || report.status !== "draft") throw new Error("Discovery report is not available for confirmation");
      if (this.accountKey && report.accountKey !== this.accountKey) {
        throw new Error("Discovery report belongs to another mail account");
      }
      tx.update(taxonomyVersions)
        .set({ status: "superseded" })
        .where(and(
          or(eq(taxonomyVersions.status, "confirmed"), eq(taxonomyVersions.status, "active")),
          this.accountKey ? eq(taxonomyVersions.accountKey, this.accountKey) : undefined,
        ))
        .run();
      tx.update(discoveryReports)
        .set({ status: "confirmed", confirmedAt: new Date() })
        .where(eq(discoveryReports.id, report.id))
        .run();
      const version = tx.insert(taxonomyVersions)
        .values({
          accountKey: this.accountKey ?? report.accountKey,
          reportId: report.id,
          status: "confirmed",
          labelsJson: JSON.stringify(validated.labels),
          backfillStatus: "pending",
        })
        .returning()
        .get();
      return {
        id: version.id,
        labels: validated.labels,
        status: "confirmed",
        backfillStatus: version.backfillStatus,
      };
    });
  }

  public getConfirmedTaxonomy(): ConfirmedTaxonomy | null {
    const row = this.db
      .select()
      .from(taxonomyVersions)
      .where(and(
        or(eq(taxonomyVersions.status, "confirmed"), eq(taxonomyVersions.status, "active")),
        this.accountKey ? eq(taxonomyVersions.accountKey, this.accountKey) : undefined,
      ))
      .orderBy(desc(taxonomyVersions.id))
      .limit(1)
      .get();
    if (!row) return null;
    return {
      id: row.id,
      labels: parseTaxonomy(row.labelsJson),
      status: row.status as "confirmed" | "active",
      backfillStatus: row.backfillStatus,
    };
  }

  public startBackfill(versionId: number): void {
    this.db.update(taxonomyVersions)
      .set({ backfillStatus: "running", backfillStartedAt: new Date() })
      .where(eq(taxonomyVersions.id, versionId))
      .run();
  }

  public finishBackfill(versionId: number, success: boolean): void {
    this.db.transaction((tx) => {
      tx.update(taxonomyVersions)
        .set({
          status: success ? "active" : "confirmed",
          backfillStatus: success ? "completed" : "failed",
          backfillCompletedAt: new Date(),
        })
        .where(eq(taxonomyVersions.id, versionId))
        .run();
      if (success) {
        tx.update(taxonomyVersions)
          .set({ status: "superseded" })
          .where(and(
            ne(taxonomyVersions.id, versionId),
            eq(taxonomyVersions.status, "active"),
            this.accountKey ? eq(taxonomyVersions.accountKey, this.accountKey) : undefined,
          ))
          .run();
      }
    });
  }

  public getBackfillEmailIds(versionId: number, limit = 200): number[] {
    return this.db
      .select({ id: emails.id })
      .from(emails)
      .innerJoin(mailboxes, eq(mailboxes.id, emails.mailboxId))
      .leftJoin(classifications, eq(classifications.emailId, emails.id))
      .where(and(
        isNull(emails.deletedAt),
        this.accountKey ? eq(mailboxes.accountKey, this.accountKey) : undefined,
        or(isNull(classifications.taxonomyVersionId), ne(classifications.taxonomyVersionId, versionId)),
      ))
      .orderBy(emails.id)
      .limit(limit)
      .all()
      .map((row) => row.id);
  }

  public recordUncertainPattern(
    taxonomyVersionId: number,
    patternKey: string,
    emailId: number,
    suggestedLabel: string,
  ): void {
    this.db.transaction((tx) => {
      const current = tx.select().from(taxonomySuggestions).where(and(
        eq(taxonomySuggestions.taxonomyVersionId, taxonomyVersionId),
        eq(taxonomySuggestions.patternKey, patternKey),
      )).get();
      const ids = current ? parseNumberArray(current.sampleEmailIdsJson) : [];
      if (ids.includes(emailId)) return;
      const nextIds = [...ids, emailId].slice(-20);
      tx.insert(taxonomySuggestions)
        .values({ taxonomyVersionId, patternKey, count: 1, sampleEmailIdsJson: JSON.stringify(nextIds), suggestedLabel })
        .onConflictDoUpdate({
          target: [taxonomySuggestions.taxonomyVersionId, taxonomySuggestions.patternKey],
          set: {
            count: (current?.count ?? 0) + 1,
            sampleEmailIdsJson: JSON.stringify(nextIds),
            suggestedLabel,
            updatedAt: new Date(),
          },
        })
        .run();
    });
  }

  public getStatus(): TaxonomyStatusDto {
    const taxonomy = this.getConfirmedTaxonomy();
    const report = this.getLatestReport();
    const totals = taxonomy ? this.db
      .select({
        total: sql<number>`count(${emails.id})`,
        classified: sql<number>`coalesce(sum(case when ${classifications.taxonomyVersionId} = ${taxonomy.id} then 1 else 0 end), 0)`,
        review: sql<number>`coalesce(sum(case when ${classifications.taxonomyVersionId} = ${taxonomy.id} and ${classifications.needsReview} = 1 then 1 else 0 end), 0)`,
      })
      .from(emails)
      .innerJoin(mailboxes, eq(mailboxes.id, emails.mailboxId))
      .leftJoin(classifications, eq(classifications.emailId, emails.id))
      .where(and(
        isNull(emails.deletedAt),
        this.accountKey ? eq(mailboxes.accountKey, this.accountKey) : undefined,
      ))
      .get() : null;
    const pendingSuggestions = taxonomy ? this.db
      .select()
      .from(taxonomySuggestions)
      .where(and(
        eq(taxonomySuggestions.taxonomyVersionId, taxonomy.id),
        eq(taxonomySuggestions.status, "pending"),
        gte(taxonomySuggestions.count, 10),
      ))
      .orderBy(desc(taxonomySuggestions.count))
      .all()
      .map((row) => ({
        id: row.id,
        patternKey: row.patternKey,
        count: row.count,
        suggestedLabel: row.suggestedLabel,
        status: row.status,
      })) : [];
    const classified = Number(totals?.classified ?? 0);
    const total = Number(totals?.total ?? 0);
    const state: TaxonomyStatusDto["state"] = !taxonomy
      ? report?.status === "draft" ? "draft-ready" : "discovery-required"
      : taxonomy.backfillStatus === "running" ? "backfilling"
      : taxonomy.backfillStatus === "failed" ? "backfill-failed"
      : taxonomy.status === "active" ? "active" : "confirmed";
    return {
      state,
      activeVersionId: taxonomy?.id ?? null,
      labels: taxonomy?.labels ?? [],
      reportId: report?.id ?? null,
      backfill: taxonomy ? {
        total,
        classified,
        pending: Math.max(0, total - classified),
        review: Number(totals?.review ?? 0),
      } : null,
      pendingSuggestions,
    };
  }
}

function parseJson(value: string): unknown {
  try { return JSON.parse(value) as unknown; } catch { return null; }
}

function parseStringArray(value: string): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function parseNumberArray(value: string): number[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is number => typeof item === "number") : [];
}

function parseAttachments(value: string) {
  const parsed = parseJson(value);
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.contentType !== "string") return [];
    return [{
      filename: typeof record.filename === "string" ? record.filename : null,
      contentType: record.contentType,
      size: typeof record.size === "number" ? record.size : null,
    }];
  });
}

function parseTaxonomy(value: string): TaxonomyLabel[] {
  const parsed = parseJson(value);
  const result = taxonomyLabelSchema.array().safeParse(parsed);
  return result.success ? result.data : [];
}

function toReportDto(row: typeof discoveryReports.$inferSelect): DiscoveryReportDto {
  return {
    id: row.id,
    status: row.status,
    report: mailboxProfileReportSchema.parse(parseJson(row.reportJson)),
    createdAt: row.createdAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
  };
}
