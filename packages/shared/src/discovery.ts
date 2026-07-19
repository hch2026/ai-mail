import { z } from "zod";

export const taxonomyLabelSchema = z.object({
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(300),
  estimatedCount: z.number().int().nonnegative(),
  exampleSenders: z.array(z.string().trim().min(1).max(200)).max(8),
  exampleSubjects: z.array(z.string().trim().min(1).max(300)).max(8),
});

export type TaxonomyLabel = z.infer<typeof taxonomyLabelSchema>;

export const emailClusterSchema = z.object({
  name: z.string().trim().min(1).max(160),
  count: z.number().int().positive(),
  unreadCount: z.number().int().nonnegative(),
  exampleSubjects: z.array(z.string().max(300)).max(6),
  suggestedPrimaryLabel: z.string().trim().min(1).max(80),
  reason: z.string().trim().min(1).max(300),
  confidence: z.number().min(0).max(1),
});

export type EmailCluster = z.infer<typeof emailClusterSchema>;

export const mailboxProfileReportSchema = z.object({
  totalEmails: z.number().int().nonnegative(),
  dateRange: z.object({ from: z.string(), to: z.string() }),
  topSenders: z.array(z.object({
    sender: z.string(),
    domain: z.string(),
    count: z.number().int().positive(),
    unreadCount: z.number().int().nonnegative(),
  })),
  clusters: z.array(emailClusterSchema),
  suggestedTaxonomy: z.array(taxonomyLabelSchema).min(8).max(18),
  uncertainClusters: z.array(emailClusterSchema),
  possiblePromotions: z.array(emailClusterSchema),
});

export type MailboxProfileReport = z.infer<typeof mailboxProfileReportSchema>;

export const confirmTaxonomySchema = z.object({
  reportId: z.number().int().positive(),
  labels: z.array(taxonomyLabelSchema).min(8).max(18).superRefine((items, context) => {
    const labels = new Set<string>();
    for (const [index, item] of items.entries()) {
      if (labels.has(item.label)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [index, "label"],
          message: "taxonomy labels must be unique",
        });
      }
      labels.add(item.label);
    }
  }),
});

export type ConfirmTaxonomyInput = z.infer<typeof confirmTaxonomySchema>;

export interface DiscoveryReportDto {
  id: number;
  status: "draft" | "confirmed" | "superseded";
  report: MailboxProfileReport;
  createdAt: string;
  confirmedAt: string | null;
}

export interface TaxonomyStatusDto {
  state: "discovery-required" | "draft-ready" | "confirmed" | "backfilling" | "backfill-failed" | "active";
  activeVersionId: number | null;
  labels: TaxonomyLabel[];
  reportId: number | null;
  backfill: { total: number; classified: number; pending: number; review: number } | null;
  pendingSuggestions: Array<{
    id: number;
    patternKey: string;
    count: number;
    suggestedLabel: string;
    status: "pending" | "accepted" | "rejected";
  }>;
}
