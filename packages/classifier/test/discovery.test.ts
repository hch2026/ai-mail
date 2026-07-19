import { describe, expect, it } from "vitest";

import { buildMailboxProfileReport, inferPurpose, type DiscoveryEmailInput } from "../src/index.js";

function email(id: number, subject: string, domain = "example.com", bodyText: string | null = null): DiscoveryEmailInput {
  return {
    id,
    mailbox: "INBOX",
    fromName: domain,
    fromAddress: `notice@${domain}`,
    domain,
    subject,
    sentAt: `2025-01-${String((id % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    isUnread: id % 2 === 0,
    flags: [],
    imapLabels: [],
    preview: null,
    bodyText,
    attachments: [],
  };
}

describe("taxonomy discovery", () => {
  it("does not treat a purchase confirmation as promotion because of a footer", () => {
    const match = inferPurpose(email(1, "Your purchase confirmation and license", "store.example", "unsubscribe sale"));
    expect(match.definition.key).toBe("orders");
  });

  it("normalizes invisible Unicode formatting in security subjects", () => {
    const match = inferPurpose(email(1, "您的 Apple\u00a0ID 信息已更\u2060新", "id.apple.com"));
    expect(match.definition.key).toBe("security");
  });

  it("routes GitHub device verification to account security", () => {
    const match = inferPurpose(email(1, "[GitHub] Please verify your device", "github.com"));
    expect(match.definition.key).toBe("security");
  });

  it("keeps 12306 purchase and refund messages in travel", () => {
    const purchase = inferPurpose(email(1, "网上购票系统-用户支付通知", "rails.com.cn"));
    const refund = inferPurpose(email(2, "网上购票系统-退票成功通知", "rails.com.cn"));
    expect(purchase.definition.key).toBe("travel");
    expect(refund.definition.key).toBe("travel");
  });

  it("builds an 8-18 label taxonomy from observed senders and purposes", () => {
    const messages = [
      email(1, "Security alert: new device", "auth.example"),
      email(2, "本月账单与发票", "bank.example"),
      email(3, "订单确认与兑换码", "store.example"),
      email(4, "Offer 与入职资料", "company.example"),
      email(5, "项目会议邀请", "work.example"),
      email(6, "AI model update", "openai.com"),
      email(7, "API deployment failed", "cloud.example"),
      email(8, "Terms update", "service.example"),
      email(9, "Weekly newsletter", "news.example"),
      email(10, "New follower on Reddit", "reddit.com"),
      email(11, "限时折扣优惠", "promo.example"),
    ];
    const report = buildMailboxProfileReport(messages);
    expect(report.totalEmails).toBe(messages.length);
    expect(report.suggestedTaxonomy.length).toBeGreaterThanOrEqual(8);
    expect(report.suggestedTaxonomy.length).toBeLessThanOrEqual(18);
    expect(report.possiblePromotions).toHaveLength(1);
  });
});
