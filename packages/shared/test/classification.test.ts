import { describe, expect, it } from "vitest";

import { classificationSchema, classificationSchemaFor, manualClassificationPatchSchema } from "../src/index.js";

describe("classificationSchema", () => {
  it("accepts one valid primary label", () => {
    const result = classificationSchema.parse({
      primaryLabel: "财务账单",
      sourceLabels: ["招商银行"],
      actionRequired: true,
      suspectedPromotion: false,
      confidence: 0.95,
      reason: "主题显示信用卡账单已生成",
      suggestedAction: "label",
    });

    expect(result.primaryLabel).toBe("财务账单");
  });

  it("forces low-confidence output into review", () => {
    expect(() =>
      classificationSchema.parse({
        primaryLabel: "其他",
        sourceLabels: [],
        actionRequired: false,
        suspectedPromotion: false,
        confidence: 0.4,
        reason: "信息不足",
        suggestedAction: "label",
      }),
    ).toThrow();
  });

  it("rejects an empty manual patch", () => {
    expect(manualClassificationPatchSchema.safeParse({}).success).toBe(false);
  });

  it("validates a result against the user-confirmed taxonomy", () => {
    const schema = classificationSchemaFor(["真实分类 A", "真实分类 B"]);
    const result = {
      primaryLabel: "旧的预设分类",
      sourceLabels: [],
      actionRequired: false,
      suspectedPromotion: false,
      confidence: 0.9,
      reason: "测试动态分类约束",
      suggestedAction: "label" as const,
    };

    expect(schema.safeParse(result).success).toBe(false);
    expect(schema.safeParse({ ...result, primaryLabel: "真实分类 A" }).success).toBe(true);
  });
});
