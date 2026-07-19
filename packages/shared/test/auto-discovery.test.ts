import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import {
  classificationOutputJsonSchemaFor,
  classificationOutputSchemaFor,
  taxonomyDiscoveryOutputSchema,
} from "../src/index.js";

function category(index: number) {
  return {
    id: `category_${index}`,
    name: `真实分类 ${index}`,
    description: `由当前邮箱邮件簇发现的分类 ${index}`,
    inclusionRules: [`属于第 ${index} 类的真实邮件用途`],
    exclusionRules: ["页脚关键词不能单独触发分类"],
    estimatedCount: 1,
    examples: [{ sender: `sender${index}@example.com`, subject: `样本主题 ${index}` }],
    isFallback: index === 8,
  };
}

function validDiscoveryOutput() {
  return {
    schemaVersion: "taxonomy-discovery.v1",
    mailboxProfile: {
      totalEmails: 8,
      dateRange: {
        from: "2025-01-01T00:00:00.000Z",
        to: "2026-01-01T00:00:00.000Z",
      },
      totalClusters: 2,
      analyzedClusters: 2,
    },
    categories: Array.from({ length: 8 }, (_, index) => category(index + 1)),
    clusterAssignments: [
      {
        clusterId: 101,
        categoryId: "category_1",
        sourceLabels: ["example.com"],
        actionRequired: false,
        suspectedPromotion: false,
        confidence: 0.92,
        mixed: false,
        reason: "发件人与主题模板稳定",
      },
      {
        clusterId: 102,
        categoryId: "category_2",
        sourceLabels: [],
        actionRequired: true,
        suspectedPromotion: false,
        confidence: 0.72,
        mixed: true,
        reason: "用途存在混合，需要人工检查",
      },
    ],
    uncertainClusters: [{ clusterId: 102, reason: "同一来源存在两种业务用途" }],
    possiblePromotions: [],
    quality: { coverage: 1, estimatedFallbackRate: 0.08, warnings: [] },
  };
}

describe("taxonomyDiscoveryOutputSchema", () => {
  it("accepts a taxonomy derived from real clusters without legacy labels", () => {
    const result = taxonomyDiscoveryOutputSchema.parse(validDiscoveryOutput());

    expect(result.categories).toHaveLength(8);
    expect(result.categories.some((item) => item.name === "工作学习")).toBe(false);
  });

  it("requires 8 to 18 categories", () => {
    const value = validDiscoveryOutput();
    value.categories = value.categories.slice(0, 7);

    expect(taxonomyDiscoveryOutputSchema.safeParse(value).success).toBe(false);
  });

  it("rejects duplicate cluster assignments and unknown category references", () => {
    const value = validDiscoveryOutput();
    value.clusterAssignments[1] = {
      ...value.clusterAssignments[1]!,
      clusterId: 101,
      categoryId: "not_confirmed",
    };

    expect(taxonomyDiscoveryOutputSchema.safeParse(value).success).toBe(false);
  });
});

describe("dynamic classification contract", () => {
  const base = {
    primaryCategoryId: "account_activity",
    sourceLabels: ["example.com"],
    actionRequired: false,
    suspectedPromotion: false,
    confidence: 0.91,
    reason: "符合已确认分类规则",
    suggestedAction: "label" as const,
  };

  it("only permits ids in the confirmed taxonomy", () => {
    const schema = classificationOutputSchemaFor(["account_activity", "receipts"]);

    expect(schema.safeParse(base).success).toBe(true);
    expect(schema.safeParse({ ...base, primaryCategoryId: "legacy_gmail_label" }).success).toBe(false);
  });

  it("forces low-confidence results into review", () => {
    const schema = classificationOutputSchemaFor(["account_activity"]);

    expect(schema.safeParse({ ...base, confidence: 0.74, suggestedAction: "label" }).success).toBe(false);
    expect(schema.safeParse({ ...base, confidence: 0.74, suggestedAction: "review" }).success).toBe(true);
  });

  it("cannot build a model schema before taxonomy confirmation", () => {
    expect(() => classificationOutputJsonSchemaFor([])).toThrow(/confirmed taxonomy/i);
    expect(classificationOutputJsonSchemaFor(["account_activity"]).properties.primaryCategoryId.enum)
      .toEqual(["account_activity"]);
  });
});

describe("Responses API JSON Schema artifact", () => {
  it("uses closed objects with every property required", () => {
    const file = new URL("../schemas/taxonomy-discovery-output.schema.json", import.meta.url);
    const root = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

    const visit = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      const record = node as Record<string, unknown>;
      if (record.type === "object") {
        const properties = record.properties as Record<string, unknown>;
        expect(record.additionalProperties).toBe(false);
        expect(new Set(record.required as string[])).toEqual(new Set(Object.keys(properties)));
      }
      for (const value of Object.values(record)) {
        if (Array.isArray(value)) value.forEach(visit);
        else visit(value);
      }
    };

    visit(root);
    const categoriesSchema = (root.properties as Record<string, Record<string, unknown>>)["categories"];
    expect(categoriesSchema?.minItems).toBe(8);
    expect(categoriesSchema?.maxItems).toBe(18);
  });
});
