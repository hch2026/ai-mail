import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const mailAccounts = sqliteTable("mail_accounts", {
  accountKey: text("account_key").primaryKey(),
  provider: text("provider", { enum: ["163", "qq"] }).notNull(),
  displayName: text("display_name").notNull(),
  createdAt: timestamp("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: timestamp("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const mailboxes = sqliteTable(
  "mailboxes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountKey: text("account_key").notNull(),
    path: text("path").notNull(),
    uidValidity: text("uid_validity").notNull(),
    highestUid: integer("highest_uid").notNull().default(0),
    highestModseq: text("highest_modseq"),
    lastSyncedAt: timestamp("last_synced_at"),
    lastFlagRefreshAt: timestamp("last_flag_refresh_at"),
    createdAt: timestamp("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("mailboxes_account_path_epoch_uq").on(
      table.accountKey,
      table.path,
      table.uidValidity,
    ),
  ],
);

export const emails = sqliteTable(
  "emails",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    mailboxId: integer("mailbox_id")
      .notNull()
      .references(() => mailboxes.id, { onDelete: "cascade" }),
    uidValidity: text("uid_validity").notNull(),
    uid: integer("uid").notNull(),
    messageId: text("message_id"),
    fromName: text("from_name"),
    fromAddress: text("from_address"),
    subject: text("subject"),
    sentAt: timestamp("sent_at"),
    internalDate: timestamp("internal_date"),
    size: integer("size"),
    flagsJson: text("flags_json").notNull().default("[]"),
    imapLabelsJson: text("imap_labels_json").notNull().default("[]"),
    isUnread: integer("is_unread", { mode: "boolean" }).notNull().default(true),
    preview: text("preview"),
    bodyText: text("body_text"),
    bodyHtml: text("body_html"),
    bodyLoaded: integer("body_loaded", { mode: "boolean" }).notNull().default(false),
    contentLoaded: integer("content_loaded", { mode: "boolean" }).notNull().default(false),
    remoteImageCount: integer("remote_image_count").notNull().default(0),
    inlineImageCount: integer("inline_image_count").notNull().default(0),
    textPart: text("text_part"),
    htmlPart: text("html_part"),
    attachmentsJson: text("attachments_json").notNull().default("[]"),
    classificationStatus: text("classification_status", {
      enum: ["pending", "classifying", "classified", "review", "error"],
    })
      .notNull()
      .default("pending"),
    classificationStartedAt: timestamp("classification_started_at"),
    classifiedAt: timestamp("classified_at"),
    deletedAt: timestamp("deleted_at"),
    deletedMailbox: text("deleted_mailbox"),
    createdAt: timestamp("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("emails_mailbox_epoch_uid_uq").on(table.mailboxId, table.uidValidity, table.uid),
    index("emails_unread_idx").on(table.isUnread),
    index("emails_status_idx").on(table.classificationStatus),
    index("emails_sent_at_idx").on(table.sentAt),
    index("emails_from_address_idx").on(table.fromAddress),
    index("emails_deleted_at_idx").on(table.deletedAt),
  ],
);

export const discoveryReports = sqliteTable(
  "discovery_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountKey: text("account_key"),
    status: text("status", { enum: ["draft", "confirmed", "superseded"] }).notNull().default("draft"),
    reportJson: text("report_json").notNull(),
    createdAt: timestamp("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    confirmedAt: timestamp("confirmed_at"),
  },
  (table) => [index("discovery_reports_status_idx").on(table.status)],
);

export const taxonomyVersions = sqliteTable(
  "taxonomy_versions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountKey: text("account_key"),
    reportId: integer("report_id")
      .notNull()
      .references(() => discoveryReports.id, { onDelete: "restrict" }),
    status: text("status", { enum: ["confirmed", "active", "superseded"] }).notNull().default("confirmed"),
    labelsJson: text("labels_json").notNull(),
    backfillStatus: text("backfill_status", { enum: ["pending", "running", "completed", "failed"] })
      .notNull()
      .default("pending"),
    createdAt: timestamp("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    confirmedAt: timestamp("confirmed_at").notNull().default(sql`(unixepoch() * 1000)`),
    backfillStartedAt: timestamp("backfill_started_at"),
    backfillCompletedAt: timestamp("backfill_completed_at"),
  },
  (table) => [index("taxonomy_versions_status_idx").on(table.status)],
);

export const classifications = sqliteTable(
  "classifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    emailId: integer("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    taxonomyVersionId: integer("taxonomy_version_id").references(() => taxonomyVersions.id, {
      onDelete: "set null",
    }),
    primaryLabel: text("primary_label").notNull(),
    sourceLabelsJson: text("source_labels_json").notNull().default("[]"),
    actionRequired: integer("action_required", { mode: "boolean" }).notNull().default(false),
    suspectedPromotion: integer("suspected_promotion", { mode: "boolean" }).notNull().default(false),
    confidence: real("confidence").notNull(),
    reason: text("reason").notNull(),
    suggestedAction: text("suggested_action", { enum: ["label", "review"] }).notNull(),
    source: text("source", { enum: ["ai", "rule", "manual"] }).notNull(),
    modelVersion: text("model_version").notNull().default("legacy-v1"),
    rawResultJson: text("raw_result_json"),
    // A constant default keeps ALTER TABLE compatible with populated SQLite databases.
    // Repository writes always provide the actual processing time explicitly.
    processedAt: timestamp("processed_at").notNull().default(sql`0`),
    needsReview: integer("needs_review", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("classifications_email_uq").on(table.emailId),
    index("classifications_label_idx").on(table.primaryLabel),
    index("classifications_review_idx").on(table.needsReview),
  ],
);

export const taxonomySuggestions = sqliteTable(
  "taxonomy_suggestions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    taxonomyVersionId: integer("taxonomy_version_id")
      .notNull()
      .references(() => taxonomyVersions.id, { onDelete: "cascade" }),
    patternKey: text("pattern_key").notNull(),
    count: integer("count").notNull().default(0),
    sampleEmailIdsJson: text("sample_email_ids_json").notNull().default("[]"),
    suggestedLabel: text("suggested_label").notNull(),
    status: text("status", { enum: ["pending", "accepted", "rejected"] }).notNull().default("pending"),
    createdAt: timestamp("created_at").notNull().default(sql`(unixepoch() * 1000)`),
    updatedAt: timestamp("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [
    uniqueIndex("taxonomy_suggestions_version_pattern_uq").on(table.taxonomyVersionId, table.patternKey),
    index("taxonomy_suggestions_status_idx").on(table.status),
  ],
);

export const classificationHistory = sqliteTable(
  "classification_history",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    emailId: integer("email_id")
      .notNull()
      .references(() => emails.id, { onDelete: "cascade" }),
    actor: text("actor", { enum: ["ai", "rule", "manual", "bulk-confirm"] }).notNull(),
    beforeJson: text("before_json"),
    afterJson: text("after_json").notNull(),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("classification_history_email_idx").on(table.emailId)],
);

export const syncRuns = sqliteTable(
  "sync_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    accountKey: text("account_key"),
    trigger: text("trigger", { enum: ["startup", "idle", "poll", "manual"] }).notNull(),
    mode: text("mode", { enum: ["idle", "poll"] }).notNull(),
    status: text("status", { enum: ["running", "success", "failed", "skipped"] }).notNull(),
    scanned: integer("scanned").notNull().default(0),
    inserted: integer("inserted").notNull().default(0),
    updated: integer("updated").notNull().default(0),
    classified: integer("classified").notNull().default(0),
    failed: integer("failed").notNull().default(0),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at").notNull().default(sql`(unixepoch() * 1000)`),
    finishedAt: timestamp("finished_at"),
  },
  (table) => [index("sync_runs_started_idx").on(table.startedAt)],
);

export const syncFailures = sqliteTable(
  "sync_failures",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    syncRunId: integer("sync_run_id").references(() => syncRuns.id, { onDelete: "set null" }),
    emailId: integer("email_id").references(() => emails.id, { onDelete: "set null" }),
    stage: text("stage").notNull(),
    errorCode: text("error_code"),
    message: text("message").notNull(),
    retryable: integer("retryable", { mode: "boolean" }).notNull().default(true),
    createdAt: timestamp("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (table) => [index("sync_failures_run_idx").on(table.syncRunId)],
);

export const syncLocks = sqliteTable("sync_locks", {
  accountKey: text("account_key").primaryKey(),
  ownerId: text("owner_id").notNull(),
  acquiredAt: timestamp("acquired_at").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const mailboxRelations = relations(mailboxes, ({ many }) => ({ emails: many(emails) }));
export const emailRelations = relations(emails, ({ one, many }) => ({
  mailbox: one(mailboxes, { fields: [emails.mailboxId], references: [mailboxes.id] }),
  classification: one(classifications),
  history: many(classificationHistory),
}));
export const classificationRelations = relations(classifications, ({ one }) => ({
  email: one(emails, { fields: [classifications.emailId], references: [emails.id] }),
}));
