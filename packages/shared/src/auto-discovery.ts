import { z } from "zod";

const isoTimestampSchema = z.string().datetime({ offset: true });
const nullableIsoTimestampSchema = isoTimestampSchema.nullable();
const categoryIdSchema = z
  .string()
  .trim()
  .min(2)
  .max(48)
  .regex(/^[a-z][a-z0-9_-]*$/, "category id must be a stable ASCII slug");

export const mailIdentitySchema = z
  .object({
    mailbox: z.string().trim().min(1).max(255),
    uidValidity: z.string().trim().min(1).max(40),
    uid: z.number().int().positive(),
    messageId: z.string().trim().max(998).nullable(),
  })
  .strict();

export type MailIdentity = z.infer<typeof mailIdentitySchema>;

export const attachmentMetadataSchema = z
  .object({
    filename: z.string().trim().max(255).nullable(),
    contentType: z.string().trim().min(1).max(255),
    size: z.number().int().nonnegative().nullable(),
    contentId: z.string().trim().max(998).nullable(),
    disposition: z.enum(["attachment", "inline", "unknown"]),
  })
  .strict();

export type AttachmentMetadata = z.infer<typeof attachmentMetadataSchema>;

/**
 * Canonical local representation. It intentionally contains no authorization
 * data and no complete HTML or attachment bytes.
 */
export const normalizedMailSchema = z
  .object({
    id: z.number().int().positive(),
    identity: mailIdentitySchema,
    fromName: z.string().trim().max(200).nullable(),
    fromAddress: z.string().trim().email().max(320).nullable(),
    fromDomain: z.string().trim().max(253).nullable(),
    subject: z.string().max(998).nullable(),
    subjectTemplate: z.string().trim().min(1).max(300),
    summary: z.string().max(1_500).nullable(),
    listId: z.string().trim().max(998).nullable(),
    unsubscribeAddresses: z.array(z.string().trim().min(1).max(2_048)).max(20),
    receivedAt: nullableIsoTimestampSchema,
    isUnread: z.boolean(),
    imapFlags: z.array(z.string().max(128)).max(64),
    imapLabels: z.array(z.string().max(255)).max(64),
    attachments: z.array(attachmentMetadataSchema).max(100),
    bodySampleState: z.enum(["not_requested", "stored", "unavailable", "redacted"]),
  })
  .strict();

export type NormalizedMail = z.infer<typeof normalizedMailSchema>;

const clusterSampleSchema = z
  .object({
    emailId: z.number().int().positive(),
    value: z.string().min(1).max(4_000),
  })
  .strict();

export const mailClusterSchema = z
  .object({
    id: z.number().int().positive(),
    fingerprint: z.string().trim().min(16).max(128),
    revision: z.number().int().positive(),
    senderAddresses: z.array(z.string().max(320)).max(20),
    senderDomains: z.array(z.string().max(253)).max(20),
    listIds: z.array(z.string().max(998)).max(20),
    subjectTemplates: z.array(z.string().max(300)).max(20),
    emailCount: z.number().int().positive(),
    unreadCount: z.number().int().nonnegative(),
    dateRange: z
      .object({ from: nullableIsoTimestampSchema, to: nullableIsoTimestampSchema })
      .strict(),
    purposeSignals: z
      .array(
        z.enum([
          "transaction",
          "security",
          "work",
          "notification",
          "subscription",
          "promotion",
          "action_required",
          "unknown",
        ]),
      )
      .max(8),
    subjectSamples: z.array(clusterSampleSchema).max(8),
    summarySamples: z.array(clusterSampleSchema).max(8),
    bodySamples: z.array(clusterSampleSchema).max(3),
    needsBodySample: z.boolean(),
  })
  .strict();

export type MailCluster = z.infer<typeof mailClusterSchema>;

export const taxonomyCategorySuggestionSchema = z
  .object({
    id: categoryIdSchema,
    name: z.string().trim().min(1).max(40),
    description: z.string().trim().min(1).max(240),
    inclusionRules: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
    exclusionRules: z.array(z.string().trim().min(1).max(240)).min(1).max(12),
    estimatedCount: z.number().int().nonnegative(),
    examples: z
      .array(
        z
          .object({
            sender: z.string().trim().min(1).max(320),
            subject: z.string().trim().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(8),
    isFallback: z.boolean(),
  })
  .strict();

export type TaxonomyCategorySuggestion = z.infer<typeof taxonomyCategorySuggestionSchema>;

const clusterAssignmentSchema = z
  .object({
    clusterId: z.number().int().positive(),
    categoryId: categoryIdSchema,
    sourceLabels: z.array(z.string().trim().min(1).max(80)).max(8),
    actionRequired: z.boolean(),
    suspectedPromotion: z.boolean(),
    confidence: z.number().min(0).max(1),
    mixed: z.boolean(),
    reason: z.string().trim().min(1).max(200),
  })
  .strict();

const uncertainClusterSchema = z
  .object({
    clusterId: z.number().int().positive(),
    reason: z.string().trim().min(1).max(200),
  })
  .strict();

const promotionClusterSchema = z
  .object({
    clusterId: z.number().int().positive(),
    reason: z.string().trim().min(1).max(200),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const taxonomyDiscoveryOutputSchema = z
  .object({
    schemaVersion: z.literal("taxonomy-discovery.v1"),
    mailboxProfile: z
      .object({
        totalEmails: z.number().int().nonnegative(),
        dateRange: z
          .object({ from: nullableIsoTimestampSchema, to: nullableIsoTimestampSchema })
          .strict(),
        totalClusters: z.number().int().nonnegative(),
        analyzedClusters: z.number().int().nonnegative(),
      })
      .strict(),
    categories: z.array(taxonomyCategorySuggestionSchema).min(8).max(18),
    clusterAssignments: z.array(clusterAssignmentSchema),
    uncertainClusters: z.array(uncertainClusterSchema),
    possiblePromotions: z.array(promotionClusterSchema),
    quality: z
      .object({
        coverage: z.number().min(0).max(1),
        estimatedFallbackRate: z.number().min(0).max(1),
        warnings: z.array(z.string().trim().min(1).max(240)).max(20),
      })
      .strict(),
  })
  .strict()
  .superRefine((value, context) => {
    const categoryIds = new Set<string>();
    const categoryNames = new Set<string>();
    let fallbackCount = 0;
    for (const [index, category] of value.categories.entries()) {
      if (categoryIds.has(category.id)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["categories", index, "id"],
          message: "category ids must be unique",
        });
      }
      if (categoryNames.has(category.name)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["categories", index, "name"],
          message: "category names must be unique",
        });
      }
      categoryIds.add(category.id);
      categoryNames.add(category.name);
      if (category.isFallback) fallbackCount += 1;
    }
    if (fallbackCount > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categories"],
        message: "at most one fallback category is allowed",
      });
    }

    const assignedClusters = new Set<number>();
    for (const [index, assignment] of value.clusterAssignments.entries()) {
      if (!categoryIds.has(assignment.categoryId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clusterAssignments", index, "categoryId"],
          message: "assignment refers to an unknown category",
        });
      }
      if (assignedClusters.has(assignment.clusterId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["clusterAssignments", index, "clusterId"],
          message: "each cluster must have exactly one primary category",
        });
      }
      assignedClusters.add(assignment.clusterId);
    }
    if (assignedClusters.size !== value.mailboxProfile.analyzedClusters) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["clusterAssignments"],
        message: "cluster assignment count must equal analyzedClusters",
      });
    }
    for (const [index, item] of value.uncertainClusters.entries()) {
      if (!assignedClusters.has(item.clusterId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["uncertainClusters", index, "clusterId"],
          message: "uncertain cluster must also have one provisional assignment",
        });
      }
    }
  });

export type TaxonomyDiscoveryOutput = z.infer<typeof taxonomyDiscoveryOutputSchema>;

const classificationOutputBaseSchema = z
  .object({
    primaryCategoryId: categoryIdSchema,
    sourceLabels: z.array(z.string().trim().min(1).max(80)).max(12),
    actionRequired: z.boolean(),
    suspectedPromotion: z.boolean(),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(200),
    suggestedAction: z.enum(["label", "review"]),
  })
  .strict();

export const classificationOutputSchema = classificationOutputBaseSchema.superRefine((value, context) => {
  if (value.confidence < 0.75 && value.suggestedAction !== "review") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["suggestedAction"],
      message: "confidence below 0.75 must be sent to review",
    });
  }
});

export type ClassificationOutput = z.infer<typeof classificationOutputSchema>;

export function classificationOutputSchemaFor(confirmedCategoryIds: readonly string[]) {
  const ids = new Set(confirmedCategoryIds);
  if (ids.size === 0) throw new Error("a confirmed taxonomy is required before classification");
  return classificationOutputSchema.superRefine((value, context) => {
    if (!ids.has(value.primaryCategoryId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primaryCategoryId"],
        message: "primaryCategoryId is not in the confirmed taxonomy version",
      });
    }
  });
}

/** Creates the strict Responses API schema after a taxonomy has been confirmed. */
export function classificationOutputJsonSchemaFor(confirmedCategoryIds: readonly string[]) {
  const ids = [...new Set(confirmedCategoryIds)];
  if (ids.length === 0) throw new Error("a confirmed taxonomy is required before classification");
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "primaryCategoryId",
      "sourceLabels",
      "actionRequired",
      "suspectedPromotion",
      "confidence",
      "reason",
      "suggestedAction",
    ],
    properties: {
      primaryCategoryId: { type: "string", enum: ids },
      sourceLabels: { type: "array", maxItems: 12, items: { type: "string", minLength: 1, maxLength: 80 } },
      actionRequired: { type: "boolean" },
      suspectedPromotion: { type: "boolean" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      reason: { type: "string", minLength: 1, maxLength: 200 },
      suggestedAction: { type: "string", enum: ["label", "review"] },
    },
  } as const;
}

export interface TaxonomyDraftDto {
  id: number;
  discoveryRunId: number;
  revision: number;
  status: "draft" | "confirmed" | "superseded";
  categories: TaxonomyCategorySuggestion[];
  createdAt: string;
  updatedAt: string;
}

export interface TaxonomyVersionDto {
  id: number;
  version: number;
  sourceDraftId: number;
  status: "active" | "superseded";
  categories: TaxonomyCategorySuggestion[];
  confirmedAt: string;
}

export interface ClassificationRecordDto extends ClassificationOutput {
  emailId: number;
  taxonomyVersionId: number;
  status: "classified" | "review" | "error";
  route: "cluster" | "rule" | "model" | "manual";
  model: string | null;
  modelResponseId: string | null;
  promptVersion: string;
  processedAt: string;
}

export interface TaxonomyAdjustmentSuggestionDto {
  id: number;
  taxonomyVersionId: number;
  kind: "add_category" | "merge_categories" | "split_category" | "update_rules";
  patternKey: string;
  occurrenceCount: number;
  status: "pending" | "accepted" | "rejected";
  rationale: string;
  createdAt: string;
}
