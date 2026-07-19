import { describe, expect, it } from "vitest";

import { RuleClassifier } from "../src/index.js";

const base = {
  fromName: null,
  fromAddress: "notice@example.com",
  sentAt: "2025-01-01T00:00:00.000Z",
  isUnread: true,
  flags: [],
  imapLabels: [],
  preview: null,
};

describe("RuleClassifier", () => {
  it("classifies a clear bill without reading the body", async () => {
    const result = await new RuleClassifier().classify({ ...base, subject: "本月信用卡账单已生成" });
    expect(result.classification).toMatchObject({
      primaryLabel: "财务账单",
      confidence: 0.84,
      suggestedAction: "label",
    });
  });

  it("sends an ambiguous message to review", async () => {
    const result = await new RuleClassifier().classify({ ...base, subject: "Hello" });
    expect(result.classification).toMatchObject({
      primaryLabel: "其他",
      confidence: 0.45,
      suggestedAction: "review",
    });
  });

  it("normalizes oversized sender domains before Zod validation", async () => {
    const longDomain = `${"subdomain.".repeat(8)}example.com`;
    const result = await new RuleClassifier().classify({
      ...base,
      fromAddress: `notice@${longDomain}`,
      subject: "Hello",
    });
    expect(result.classification.sourceLabels[0]?.length).toBeLessThanOrEqual(50);
  });

  it("prefers Other over Personal for an unknown message", async () => {
    const labels = [
      { label: "个人往来", description: "朋友和个人联系人的直接沟通", estimatedCount: 0, exampleSenders: [], exampleSubjects: [] },
      { label: "其他", description: "无法可靠归入其他类别的邮件", estimatedCount: 0, exampleSenders: [], exampleSubjects: [] },
    ];
    const result = await new RuleClassifier().classify({ ...base, subject: "Unrecognized message" }, labels);
    expect(result.classification).toMatchObject({
      primaryLabel: "其他",
      suggestedAction: "review",
    });
  });

  it("uses the discovered taxonomy instead of the legacy preset labels", async () => {
    const labels = [
      ["账号安全与验证", "验证码、新设备登录、密码修改和风险提醒"],
      ["金融交易、账单与扣费", "银行交易提醒、信用卡账单、发票、扣费、收据和支付记录"],
      ["订单与数字权益", "订单确认、购买成功、兑换码、许可证和会员权益"],
      ["招聘求职与面试", "职位邀请、简历进度、在线测评、笔试、面试和招聘反馈"],
      ["邮箱系统与投递通知", "系统退信、投递异常、邮箱服务和收信提醒"],
      ["社交平台通知", "关注、评论、回复、点赞、私信和社区互动提醒"],
      ["广告与促销", "折扣、优惠券、限时活动和购买推荐"],
      ["个人与其他", "暂时无法可靠归入其他类别的邮件"],
    ].map(([label, description]) => ({ label: label!, description: description!, estimatedCount: 0, exampleSenders: [], exampleSubjects: [] }));

    const result = await new RuleClassifier().classify(
      { ...base, fromAddress: "security@mail.instagram.com", subject: "123456 is your Instagram code" },
      labels,
    );
    expect(result.classification).toMatchObject({
      primaryLabel: "账号安全与验证",
      suggestedAction: "label",
    });
    expect(labels.some((item) => item.label === result.classification.primaryLabel)).toBe(true);
  });
});
