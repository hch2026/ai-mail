import { classificationSchema, classificationSchemaFor, type TaxonomyLabel } from "@mail-ai/shared";

import type { ClassificationInput, ClassificationResult, EmailClassifier } from "./types.js";
import { inferPurpose } from "./discovery.js";

interface Rule {
  label: "工作学习" | "财务账单" | "账户安全" | "购物物流" | "社交通知" | "订阅资讯" | "推广营销" | "个人往来";
  keywords: readonly string[];
  promotion?: boolean;
  action?: boolean;
}

const rules: readonly Rule[] = [
  {
    label: "账户安全",
    keywords: ["验证码", "登录提醒", "异地登录", "安全提醒", "密码重置", "verification code", "security alert"],
    action: true,
  },
  {
    label: "财务账单",
    keywords: ["账单", "还款", "发票", "扣款", "交易提醒", "余额", "对账单", "invoice", "payment"],
  },
  {
    label: "购物物流",
    keywords: ["订单", "发货", "快递", "物流", "签收", "退款", "配送", "tracking", "shipped"],
  },
  {
    label: "工作学习",
    keywords: ["会议", "项目", "面试", "简历", "课程", "作业", "考试", "论文", "meeting", "project"],
    action: true,
  },
  {
    label: "推广营销",
    keywords: ["促销", "优惠", "折扣", "限时", "领券", "秒杀", "推广", "unsubscribe", "sale", "coupon"],
    promotion: true,
  },
  {
    label: "订阅资讯",
    keywords: ["周报", "日报", "newsletter", "资讯", "简报", "订阅", "digest"],
  },
  {
    label: "社交通知",
    keywords: ["关注了你", "评论了", "回复了", "点赞", "新消息", "邀请你", "mentioned you"],
  },
  {
    label: "个人往来",
    keywords: ["你好", "近况", "谢谢", "祝好", "生日快乐"],
  },
];

function sourceLabels(input: ClassificationInput): string[] {
  const domain = input.fromAddress?.split("@").at(-1)?.trim().toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 50);
  return domain ? [domain] : [];
}

export class RuleClassifier implements EmailClassifier {
  public async classify(input: ClassificationInput, taxonomy?: readonly TaxonomyLabel[]): Promise<ClassificationResult> {
    if (taxonomy && taxonomy.length > 0) return classifyWithDiscoveredTaxonomy(input, taxonomy);

    const searchable = [input.fromName, input.fromAddress, input.subject, input.preview, input.bodyText]
      .filter((value): value is string => Boolean(value))
      .join("\n")
      .toLowerCase();

    for (const rule of rules) {
      const matched = rule.keywords.find((keyword) => searchable.includes(keyword.toLowerCase()));
      if (!matched) continue;
      const bodyConfirmed = Boolean(input.bodyText);
      const selected = selectTaxonomyLabel(rule.label, rule.keywords, taxonomy);
      const confidence = selected.matched ? (bodyConfirmed ? 0.9 : 0.84) : 0.62;
      const schema = taxonomy ? classificationSchemaFor(taxonomy.map((item) => item.label)) : classificationSchema;
      return ruleResult(schema.parse({
        primaryLabel: selected.label,
        sourceLabels: sourceLabels(input),
        actionRequired: rule.action ?? /请|待|到期|确认|完成|回复|verify|action required/i.test(searchable),
        suspectedPromotion: rule.promotion ?? false,
        confidence,
        reason: `邮件${input.bodyText ? "正文或" : ""}元数据命中“${matched}”特征`,
        suggestedAction: confidence < 0.75 ? "review" : "label",
      }));
    }

    const fallback = selectTaxonomyLabel("其他", ["其他", "个人", "待复核", "无法判断"], taxonomy);
    const schema = taxonomy ? classificationSchemaFor(taxonomy.map((item) => item.label)) : classificationSchema;
    return ruleResult(schema.parse({
      primaryLabel: fallback.label,
      sourceLabels: sourceLabels(input),
      actionRequired: /请|待|到期|确认|完成|回复|verify|action required/i.test(searchable),
      suspectedPromotion: false,
      confidence: input.bodyText ? 0.68 : 0.45,
      reason: input.bodyText ? "正文中仍未发现明确分类特征" : "仅凭邮件元数据无法可靠判断分类",
      suggestedAction: "review",
    }));
  }
}

function classifyWithDiscoveredTaxonomy(
  input: ClassificationInput,
  taxonomy: readonly TaxonomyLabel[],
): ClassificationResult {
  const domain = input.fromAddress?.split("@")[1]?.toLowerCase() ?? "";
  const match = inferPurpose({
    id: 0,
    mailbox: "INBOX",
    fromName: input.fromName,
    fromAddress: input.fromAddress,
    domain,
    subject: input.subject,
    sentAt: input.sentAt,
    isUnread: input.isUnread,
    flags: input.flags,
    imapLabels: input.imapLabels,
    preview: input.preview,
    bodyText: input.bodyText ?? null,
    attachments: [],
  });
  const selected = selectDiscoveredTaxonomyLabel(
    match.definition.key,
    match.definition.label,
    match.definition.description,
    taxonomy,
  );
  const confidence = selected.matched ? match.confidence : Math.min(match.confidence, 0.62);
  const searchable = [input.subject, input.preview, input.bodyText]
    .filter((value): value is string => Boolean(value))
    .join("\n");
  const classification = classificationSchemaFor(taxonomy.map((item) => item.label)).parse({
    primaryLabel: selected.label,
    sourceLabels: sourceLabels(input),
    actionRequired: match.definition.action ?? /请|待|到期|确认|完成|回复|verify|action required/i.test(searchable),
    suspectedPromotion: match.definition.promotion ?? false,
    confidence,
    reason: match.reason,
    suggestedAction: confidence < 0.75 ? "review" : "label",
  });
  return ruleResult(classification);
}

function ruleResult(classification: ClassificationResult["classification"]): ClassificationResult {
  return {
    source: "rule",
    modelVersion: "local-rule-v3",
    classification,
    rawResult: JSON.stringify(classification),
  };
}

function selectDiscoveredTaxonomyLabel(
  purposeKey: string,
  purposeLabel: string,
  purposeDescription: string,
  taxonomy: readonly TaxonomyLabel[],
): { label: string; matched: boolean } {
  if (purposeKey === "unknown") {
    const fallback = fallbackTaxonomyLabel(taxonomy);
    return { label: fallback.label, matched: /其他|个人/.test(fallback.label) };
  }
  const exact = taxonomy.find((item) => item.label === purposeLabel || item.description === purposeDescription);
  if (exact) return { label: exact.label, matched: true };

  const hints = purposeLabel.split(/[、，,/与和\s]+/).filter((item) => item.length >= 2);
  const scored = taxonomy.map((item) => {
    const searchable = `${item.label} ${item.description}`;
    const score = hints.reduce((total, hint) => total + (searchable.includes(hint) ? 1 : 0), 0);
    return { label: item.label, score };
  }).sort((a, b) => b.score - a.score);
  if ((scored[0]?.score ?? 0) > 0) return { label: scored[0]!.label, matched: true };

  const fallback = fallbackTaxonomyLabel(taxonomy);
  return { label: fallback.label, matched: purposeKey === "unknown" && /其他|个人/.test(fallback.label) };
}

function selectTaxonomyLabel(
  legacyLabel: string,
  keywords: readonly string[],
  taxonomy: readonly TaxonomyLabel[] | undefined,
): { label: string; matched: boolean } {
  if (!taxonomy || taxonomy.length === 0) return { label: legacyLabel, matched: true };
  const hints = [legacyLabel, ...keywords].map((item) => item.toLowerCase());
  const scored = taxonomy.map((item) => {
    const searchable = `${item.label} ${item.description}`.toLowerCase();
    const score = hints.reduce((total, hint) => total + (searchable.includes(hint) || hint.includes(item.label.toLowerCase()) ? 1 : 0), 0);
    return { label: item.label, score };
  }).sort((a, b) => b.score - a.score);
  if ((scored[0]?.score ?? 0) > 0) return { label: scored[0]!.label, matched: true };
  const fallback = fallbackTaxonomyLabel(taxonomy);
  return { label: fallback.label, matched: false };
}

function fallbackTaxonomyLabel(taxonomy: readonly TaxonomyLabel[]): TaxonomyLabel {
  return taxonomy.find((item) => item.label.trim() === "其他")
    ?? taxonomy.find((item) => /其他|复核|观察/.test(item.label))
    ?? taxonomy.find((item) => /个人/.test(item.label))
    ?? taxonomy[0]!;
}
