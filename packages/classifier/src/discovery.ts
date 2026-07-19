import { mailboxProfileReportSchema, type MailboxProfileReport, type TaxonomyLabel } from "@mail-ai/shared";

export interface DiscoveryAttachment {
  filename: string | null;
  contentType: string;
  size: number | null;
}

export interface DiscoveryEmailInput {
  id: number;
  mailbox: string;
  fromName: string | null;
  fromAddress: string | null;
  domain: string;
  subject: string | null;
  sentAt: string | null;
  isUnread: boolean;
  flags: string[];
  imapLabels: string[];
  preview: string | null;
  bodyText: string | null;
  attachments: DiscoveryAttachment[];
}

interface PurposeDefinition {
  key: string;
  label: string;
  description: string;
  keywords: readonly string[];
  domainHints?: readonly string[];
  promotion?: boolean;
  action?: boolean;
}

interface PurposeMatch {
  definition: PurposeDefinition;
  confidence: number;
  reason: string;
}

const purposes: readonly PurposeDefinition[] = [
  {
    key: "security",
    label: "账号安全与验证",
    description: "验证码、新设备登录、密码修改和风险提醒",
    keywords: [
      "验证码", "验证代码", "登录提醒", "新设备", "异地登录", "密码修改", "密码已被更改", "安全提醒",
      "帐号安全", "账号安全", "验证您的邮箱", "激活你的", "verification code", "security alert", "sign-in",
      "verify your device", "review this sign in", "unrecognized device", "unrecognized location",
      "password has been changed", "instagram code", "apple id 信息已更", "账户初始化密码", "初始化密码",
    ],
    action: true,
  },
  {
    key: "billing",
    label: "金融交易、账单与扣费",
    description: "银行交易提醒、信用卡账单、发票、扣费、收据和支付记录",
    keywords: [
      "账单", "发票", "扣费", "收据", "对账单", "还款", "付款通知", "消费提醒", "交易流水",
      "信用管家", "开户通知", "invoice", "receipt", "charged", "billing", "transaction",
    ],
  },
  {
    key: "orders",
    label: "购物订单、退款与售后",
    description: "商品订单确认、发货物流、退款、退货和售后处理",
    keywords: [
      "订单确认", "购买成功", "已付款", "已发货", "发货通知", "物流", "配送", "签收", "退款申请",
      "退款成功", "退款通知", "退货", "售后", "淘宝", "天猫", "京东", "amazon order", "order confirmation",
      "order shipped", "delivery", "tracking", "purchase", "refund",
    ],
  },
  {
    key: "travel",
    label: "出行票务与交通",
    description: "火车、飞机等行程的购票、出票、改签、退票和出行提醒",
    keywords: [
      "12306", "rails.com.cn", "车票", "火车票", "购票", "出票", "退票", "改签", "候补购票",
      "列车", "车次", "乘车", "航班", "机票", "登机", "行程单", "flight", "boarding",
    ],
    domainHints: ["rails.com.cn", "12306.cn"],
    action: true,
  },
  {
    key: "recruiting",
    label: "招聘求职与面试",
    description: "职位邀请、简历进度、在线测评、笔试、面试和招聘反馈",
    keywords: [
      "招聘", "职位", "岗位", "投递", "简历", "初筛", "面试", "笔试", "在线测评", "在线评测", "应聘",
      "猎头", "人事经理", "通知邀约", "面谈邀请", "job", "career", "application", "assessment", "interview", "candidate",
    ],
    action: true,
  },
  {
    key: "work_records",
    label: "工作与入职档案",
    description: "录用、合同、入离职、薪资、社保和公积金材料",
    keywords: [
      "offer", "录用", "劳动合同", "入职", "离职", "离职交接", "薪资", "工资单", "社保", "公积金",
      "员工信息", "背景调查", "背景信息", "信息采集", "员工关系", "考勤", "个税", "onboarding", "employment",
    ],
    action: true,
  },
  {
    key: "work_collaboration",
    label: "项目与工作协作",
    description: "项目推进、会议、评审、协作邀请和工作任务",
    keywords: ["项目", "会议", "评审", "协作", "任务", "演示稿", "meeting", "project", "workspace", "invited you"],
    action: true,
  },
  {
    key: "ai_products",
    label: "AI 开发与产品动态",
    description: "AI 模型、编程助手和 AI 开发产品更新",
    keywords: ["人工智能", "大模型", "模型更新", "ai model", "copilot", "chatgpt", "claude", "gemini", "llm", "ai api"],
    domainHints: ["openai.com", "anthropic.com", "huggingface.co"],
  },
  {
    key: "developer_services",
    label: "开发、云与 API 服务",
    description: "代码托管、云平台、API、部署、域名和开发者账户通知",
    keywords: ["api", "github", "gitlab", "cloud", "部署", "构建失败", "域名", "服务器", "developer", "repository", "vercel", "cloudflare"],
    domainHints: ["github.com", "gitlab.com", "vercel.com", "cloudflare.com"],
  },
  {
    key: "service_rules",
    label: "服务通知与规则变更",
    description: "服务条款、隐私政策、规则调整、停服或迁移通知",
    keywords: [
      "规则变更", "条款更新", "隐私政策更新", "服务调整", "服务升级", "章程", "领用合约", "停止服务", "迁移通知",
      "terms update", "terms & conditions", "policy update", "service change",
    ],
  },
  {
    key: "mail_delivery",
    label: "邮箱系统与投递通知",
    description: "系统退信、投递异常、邮箱服务和收信提醒",
    keywords: ["系统退信", "退信", "投递失败", "无法送达", "邮件被退回", "收到了一封重要邮件", "delivery failed", "undeliverable", "mail delivery"],
  },
  {
    key: "account_service",
    label: "工具与账户服务",
    description: "账户开通、订阅状态、存储空间和工具服务提醒",
    keywords: [
      "账户", "账号", "订阅状态", "空间不足", "服务到期", "续卡通知", "寄送通知", "欢迎使用", "欢迎您使用",
      "欢迎加入", "成功连接", "使用指南", "如何使用", "下载链接", "多个邮箱", "天才吧服务", "邀请函待查收",
      "renewal", "account", "subscription", "storage", "welcome to", "getting started",
    ],
  },
  {
    key: "newsletters",
    label: "资讯与兴趣订阅",
    description: "定期简报、行业资讯、兴趣内容和创作者更新",
    keywords: ["newsletter", "周报", "日报", "月报", "简报", "资讯", "digest", "精选", "本周"],
  },
  {
    key: "social",
    label: "社交平台通知",
    description: "关注、评论、回复、点赞、私信和社区互动提醒",
    keywords: [
      "关注了你", "评论了", "回复了", "点赞", "私信", "动态中查看", "错过的精彩时刻", "新鲜事",
      "分享了新鲜事", "有帖子", "mentioned you", "new follower", "see what's been happening", "have posts",
      "in your feed", "reddit", "facebook", "twitter", "linkedin", "instagram",
    ],
    domainHints: ["reddit.com", "facebookmail.com", "x.com", "twitter.com", "linkedin.com", "instagram.com"],
  },
  {
    key: "entertainment",
    label: "娱乐、游戏与音乐",
    description: "游戏、影音、音乐、直播和娱乐内容更新",
    keywords: ["游戏", "steam", "playstation", "xbox", "音乐", "歌单", "直播", "电影", "episode", "gaming", "streaming", "plex"],
    domainHints: ["plex.tv", "steampowered.com"],
  },
  {
    key: "promotion",
    label: "广告与促销",
    description: "折扣、优惠券、限时活动和购买推荐",
    keywords: [
      "促销", "优惠", "福利", "红包", "折扣", "限时", "领券", "秒杀", "推荐购买", "推荐办卡", "换购",
      "抽奖", "有奖", "备用金", "年化利率", "满10减", "夏日活动", "推广", "广告", "（ad）", "(ad)",
      "special offer", "sale", "coupon", "% off",
    ],
    promotion: true,
  },
  {
    key: "personal",
    label: "个人往来",
    description: "个人沟通、问候、家庭朋友和无法归入服务类的往来",
    keywords: ["你好", "近况", "谢谢", "祝好", "生日快乐", "好久不见", "测试", "暖暖的小邮件"],
  },
];

const unknownPurpose: PurposeDefinition = {
  key: "unknown",
  label: "个人与其他",
  description: "暂时无法可靠归入其他类别的邮件",
  keywords: [],
};

function countOccurrences(text: string, keyword: string): number {
  let count = 0;
  let offset = 0;
  const target = keyword.toLowerCase();
  while ((offset = text.indexOf(target, offset)) >= 0) {
    count += 1;
    offset += target.length;
  }
  return count;
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/\p{Cf}/gu, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function inferPurpose(email: DiscoveryEmailInput): PurposeMatch {
  const subject = normalizeSearchText(email.subject ?? "");
  const sender = normalizeSearchText(`${email.fromName ?? ""} ${email.fromAddress ?? ""} ${email.domain}`);
  const preview = normalizeSearchText((email.preview ?? "").slice(0, 800));
  const body = normalizeSearchText((email.bodyText ?? "").slice(0, 2_000));
  let best: { definition: PurposeDefinition; score: number; matched: string | null; metadataScore: number } | null = null;

  for (const definition of purposes) {
    let score = 0;
    let metadataScore = 0;
    let subjectMatchCount = 0;
    let matched: string | null = null;
    for (const keyword of definition.keywords) {
      const normalized = keyword.toLowerCase();
      const subjectHits = countOccurrences(subject, normalized);
      const senderHits = countOccurrences(sender, normalized);
      const previewHits = countOccurrences(preview, normalized);
      const bodyHits = countOccurrences(body, normalized);
      const keywordScore = subjectHits * 4 + senderHits * 3 + previewHits * 1.5 + bodyHits * 0.25;
      score += keywordScore;
      metadataScore += subjectHits * 4 + senderHits * 3 + previewHits * 1.5;
      subjectMatchCount += subjectHits;
      if (keywordScore > 0 && matched === null) matched = keyword;
    }
    // A concrete security phrase in the subject takes precedence over a platform/domain source hint.
    if (definition.key === "security" && subjectMatchCount > 0) score += 20;
    if (definition.domainHints?.some((hint) => email.domain.endsWith(hint))) {
      score += 5;
      metadataScore += 5;
      matched ??= email.domain;
    }
    // A footer-only promotion or account keyword must never override a clear transactional/security subject.
    if ((definition.key === "promotion" || definition.key === "account_service") && metadataScore < 2) {
      score = Math.min(score, 1.5);
    }
    if (!best || score > best.score) best = { definition, score, matched, metadataScore };
  }

  if (!best || best.score < 2.5) {
    return {
      definition: unknownPurpose,
      confidence: email.bodyText ? 0.62 : 0.45,
      reason: email.bodyText ? "代表正文仍缺少稳定用途特征" : "元数据不足，需抽取代表正文复核",
    };
  }
  const confidence = best.score >= 8 ? 0.95 : best.score >= 4 ? 0.86 : best.metadataScore >= 2.5 ? 0.78 : 0.7;
  return {
    definition: best.definition,
    confidence,
    reason: `发件来源或主题命中“${best.matched ?? best.definition.label}”特征`,
  };
}

function normalizeSubject(subject: string | null): string {
  return (subject ?? "无主题")
    .toLowerCase()
    .replace(/^(re|fw|fwd)[：:]\s*/i, "")
    .replace(/[a-f0-9]{12,}/gi, "{id}")
    .replace(/\d{2,}/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 90);
}

function bodyStructureSignature(email: DiscoveryEmailInput): string {
  const length = email.bodyText?.length ?? 0;
  const lengthBucket = length === 0 ? "none" : length < 800 ? "short" : length < 5_000 ? "medium" : "long";
  const attachmentTypes = [...new Set(email.attachments.map((item) => item.contentType.split("/")[0] ?? item.contentType))]
    .sort()
    .join("+");
  return `${lengthBucket}:${attachmentTypes || "no-attachment"}`;
}

function timeRangeBucket(sentAt: string | null): string {
  const year = sentAt ? Number(sentAt.slice(0, 4)) : Number.NaN;
  if (!Number.isFinite(year)) return "unknown-date";
  if (year <= 2019) return "through-2019";
  if (year <= 2022) return "2020-2022";
  if (year <= 2025) return "2023-2025";
  return "2026-plus";
}

function displaySender(email: DiscoveryEmailInput): string {
  return email.fromName?.trim() || email.fromAddress?.trim() || email.domain || "未知发件人";
}

interface TaxonomyCandidate {
  purpose: PurposeDefinition;
  name: string;
  emails: DiscoveryEmailInput[];
}

function splitLargestCandidate(candidates: TaxonomyCandidate[]): boolean {
  const candidate = [...candidates].sort((a, b) => b.emails.length - a.emails.length).find((item) => {
    return new Set(item.emails.map((email) => email.domain)).size > 1;
  });
  if (!candidate) return false;
  const domains = new Map<string, DiscoveryEmailInput[]>();
  for (const email of candidate.emails) {
    const key = email.domain || "未知来源";
    domains.set(key, [...(domains.get(key) ?? []), email]);
  }
  const largestDomain = [...domains.entries()].sort((a, b) => b[1].length - a[1].length)[0];
  if (!largestDomain || largestDomain[1].length === candidate.emails.length) return false;
  candidate.emails = candidate.emails.filter((email) => email.domain !== largestDomain[0]);
  const brand = largestDomain[1][0]?.fromName?.trim() || largestDomain[0];
  candidates.push({
    purpose: candidate.purpose,
    name: `${candidate.purpose.label} / ${brand.slice(0, 28)}`,
    emails: largestDomain[1],
  });
  return true;
}

function buildSuggestedTaxonomy(emails: DiscoveryEmailInput[], matches: Map<number, PurposeMatch>): TaxonomyLabel[] {
  const byPurpose = new Map<string, TaxonomyCandidate>();
  for (const email of emails) {
    const purpose = matches.get(email.id)?.definition ?? unknownPurpose;
    const existing = byPurpose.get(purpose.key);
    if (existing) existing.emails.push(email);
    else byPurpose.set(purpose.key, { purpose, name: purpose.label, emails: [email] });
  }
  const candidates = [...byPurpose.values()];
  if (!byPurpose.has(unknownPurpose.key) && candidates.length < 18) {
    candidates.push({ purpose: unknownPurpose, name: unknownPurpose.label, emails: [] });
  }
  while (candidates.length < 8 && splitLargestCandidate(candidates)) {
    // Split only observed high-volume groups by their real sender domains.
  }
  while (candidates.length > 18) {
    candidates.sort((a, b) => b.emails.length - a.emails.length);
    const overflow = candidates.splice(17);
    const mergedEmails = overflow.flatMap((item) => item.emails);
    candidates.push({ purpose: unknownPurpose, name: "其他与待复核", emails: mergedEmails });
  }
  // Extremely small mailboxes may not contain eight distinct sources. Keep the contract stable
  // by using observed subject templates as the last split dimension.
  while (candidates.length < 8) {
    const largest = [...candidates].sort((a, b) => b.emails.length - a.emails.length)[0];
    if (!largest || largest.emails.length < 2) break;
    const moved = largest.emails.splice(Math.ceil(largest.emails.length / 2));
    candidates.push({ purpose: largest.purpose, name: `${largest.name} / 补充分组 ${candidates.length + 1}`, emails: moved });
  }
  while (candidates.length < 8) {
    candidates.push({ purpose: unknownPurpose, name: `待观察分组 ${candidates.length + 1}`, emails: [] });
  }

  return candidates
    .sort((a, b) => b.emails.length - a.emails.length)
    .map((candidate) => ({
      label: candidate.name,
      description: candidate.purpose.description,
      estimatedCount: candidate.emails.length,
      exampleSenders: [...new Set(candidate.emails.map(displaySender))].slice(0, 5),
      exampleSubjects: [...new Set(candidate.emails.map((email) => email.subject ?? "（无主题）"))].slice(0, 5),
    }));
}

export function buildMailboxProfileReport(emails: DiscoveryEmailInput[]): MailboxProfileReport {
  const matches = new Map(emails.map((email) => [email.id, inferPurpose(email)]));
  const clusterMap = new Map<string, { emails: DiscoveryEmailInput[]; match: PurposeMatch }>();
  for (const email of emails) {
    const match = matches.get(email.id) ?? { definition: unknownPurpose, confidence: 0.45, reason: "信息不足" };
    const structure = bodyStructureSignature(email);
    const key = `${email.mailbox}|${match.definition.key}|${email.domain}|${normalizeSubject(email.subject)}|${timeRangeBucket(email.sentAt)}|${structure}`;
    const cluster = clusterMap.get(key);
    if (cluster) cluster.emails.push(email);
    else clusterMap.set(key, { emails: [email], match });
  }

  const clusters = [...clusterMap.values()]
    .map(({ emails: grouped, match }) => {
      const source = displaySender(grouped[0]!);
      return {
        name: `${match.definition.label} · ${source}`,
        count: grouped.length,
        unreadCount: grouped.filter((email) => email.isUnread).length,
        exampleSubjects: [...new Set(grouped.map((email) => email.subject ?? "（无主题）"))].slice(0, 5),
        suggestedPrimaryLabel: match.definition.label,
        reason: match.reason,
        confidence: match.confidence,
      };
    })
    .sort((a, b) => b.count - a.count || b.confidence - a.confidence);

  const senderMap = new Map<string, DiscoveryEmailInput[]>();
  for (const email of emails) {
    const sender = `${displaySender(email)}\u0000${email.domain}`;
    senderMap.set(sender, [...(senderMap.get(sender) ?? []), email]);
  }
  const dated = emails.flatMap((email) => email.sentAt ? [email.sentAt] : []).sort();
  const report = {
    totalEmails: emails.length,
    dateRange: { from: dated[0] ?? "", to: dated.at(-1) ?? "" },
    topSenders: [...senderMap.entries()]
      .map(([key, items]) => {
        const [sender, domain] = key.split("\u0000");
        return {
          sender: sender ?? "未知发件人",
          domain: domain ?? "",
          count: items.length,
          unreadCount: items.filter((email) => email.isUnread).length,
        };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 25),
    clusters,
    suggestedTaxonomy: buildSuggestedTaxonomy(emails, matches),
    uncertainClusters: clusters.filter((cluster) => cluster.confidence < 0.75),
    possiblePromotions: clusters.filter((cluster) => cluster.suggestedPrimaryLabel === "广告与促销"),
  };
  return mailboxProfileReportSchema.parse(report);
}
