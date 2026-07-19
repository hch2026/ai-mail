import { z } from "zod";

export const LEGACY_PRIMARY_LABELS = [
  "工作学习",
  "财务账单",
  "账户安全",
  "购物物流",
  "社交通知",
  "订阅资讯",
  "推广营销",
  "个人往来",
  "其他",
] as const;

export const primaryLabelSchema = z.string().trim().min(1).max(80);

export const classificationSchema = z
  .object({
    primaryLabel: primaryLabelSchema,
    sourceLabels: z.array(z.string().trim().min(1).max(50)).max(12),
    actionRequired: z.boolean(),
    suspectedPromotion: z.boolean(),
    confidence: z.number().min(0).max(1),
    reason: z.string().trim().min(1).max(200),
    suggestedAction: z.enum(["label", "review"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.confidence < 0.75 && value.suggestedAction !== "review") {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["suggestedAction"],
        message: "confidence below 0.75 must be sent to review",
      });
    }
  });

export type Classification = z.infer<typeof classificationSchema>;

export function classificationSchemaFor(allowedLabels: readonly string[]) {
  const labels = new Set(allowedLabels);
  return classificationSchema.superRefine((value, context) => {
    if (!labels.has(value.primaryLabel)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["primaryLabel"],
        message: "primaryLabel is not part of the confirmed taxonomy",
      });
    }
  });
}

export const manualClassificationPatchSchema = z
  .object({
    primaryLabel: primaryLabelSchema.optional(),
    sourceLabels: z.array(z.string().trim().min(1).max(50)).max(12).optional(),
    actionRequired: z.boolean().optional(),
    suspectedPromotion: z.boolean().optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.primaryLabel !== undefined ||
      value.sourceLabels !== undefined ||
      value.actionRequired !== undefined ||
      value.suspectedPromotion !== undefined,
    "at least one classification field is required",
  );

export type ManualClassificationPatch = z.infer<typeof manualClassificationPatchSchema>;
