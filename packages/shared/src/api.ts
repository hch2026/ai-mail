import { z } from "zod";

import { primaryLabelSchema } from "./classification.js";

export const emailQuerySchema = z.object({
  accountId: z.string().trim().min(1).max(40).optional(),
  label: primaryLabelSchema.optional(),
  unread: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  sender: z.string().trim().max(200).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  review: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  actionRequired: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

export type EmailQuery = z.infer<typeof emailQuerySchema>;

export interface AccountDto {
  id: string;
  provider: "163" | "qq";
  displayName: string;
  writeEnabled: boolean;
  isDefault: boolean;
}

export const bulkConfirmSchema = z.object({
  emailIds: z.array(z.number().int().positive()).min(1).max(500),
});

export type BulkConfirmInput = z.infer<typeof bulkConfirmSchema>;

export const bulkDeleteSchema = z.object({
  emailIds: z.array(z.number().int().positive()).min(1).max(500),
});

export type BulkDeleteInput = z.infer<typeof bulkDeleteSchema>;

export interface BulkDeleteResultDto {
  requested: number;
  moved: number;
  dryRun: boolean;
  targetMailbox: string | null;
}

export interface DashboardDto {
  total: number;
  unread: number;
  unclassified: number;
  needsReview: number;
}

export interface LabelDto {
  label: string;
  total: number;
  unread: number;
}

export interface EmailListItemDto {
  id: number;
  uid: number;
  messageId: string | null;
  fromName: string | null;
  fromAddress: string | null;
  subject: string | null;
  sentAt: string | null;
  isUnread: boolean;
  preview: string | null;
  primaryLabel: string | null;
  confidence: number | null;
  needsReview: boolean;
  actionRequired: boolean;
  suspectedPromotion: boolean;
}

export interface EmailDetailDto extends EmailListItemDto {
  mailbox: string;
  uidValidity: string;
  flags: string[];
  bodyText: string | null;
  bodyHtml: string | null;
  bodyLoaded: boolean;
  contentLoaded: boolean;
  remoteImageCount: number;
  inlineImageCount: number;
  attachments: EmailAttachmentDto[];
  sourceLabels: string[];
  reason: string | null;
  suggestedAction: "label" | "review" | null;
  classificationSource: "ai" | "rule" | "manual" | null;
  taxonomyVersionId: number | null;
  modelVersion: string | null;
  rawResult: string | null;
  processedAt: string | null;
  history: Array<{
    id: number;
    actor: string;
    before: unknown;
    after: unknown;
    note: string | null;
    createdAt: string;
  }>;
}

export interface EmailAttachmentDto {
  index: number;
  filename: string | null;
  contentType: string;
  size: number | null;
}

export interface EmailContentDto {
  emailId: number;
  bodyText: string | null;
  bodyHtml: string | null;
  contentLoaded: boolean;
  remoteImageCount: number;
  inlineImageCount: number;
}

export interface PaginatedEmailsDto {
  items: EmailListItemDto[];
  total: number;
  page: number;
  pageSize: number;
}
