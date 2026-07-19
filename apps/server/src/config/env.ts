import { config as loadDotEnv } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

export function envFileCandidates(moduleUrl = import.meta.url, cwd = process.cwd()): string[] {
  return [
    fileURLToPath(new URL("../../../../.env", moduleUrl)),
    resolve(cwd, ".env"),
  ];
}

const envFile = envFileCandidates().find((candidate) => existsSync(candidate));
loadDotEnv(envFile ? { path: envFile } : undefined);

const booleanFromString = z
  .enum(["true", "false"])
  .transform((value) => value === "true");

export const envSchema = z.object({
  MAIL_EMAIL: z.string().email(),
  MAIL_IMAP_HOST: z.string().min(1),
  MAIL_IMAP_PORT: z.coerce.number().int().min(1).max(65_535),
  MAIL_IMAP_SECURE: booleanFromString.default("true"),
  MAIL_AUTH_CODE: z.string().min(1),
  MAIL_MAILBOX: z.string().min(1).default("INBOX"),
  MAIL_163_DISPLAY_NAME: z.string().trim().min(1).max(50).default("163邮箱"),
  MAIL_163_WRITE_ENABLED: booleanFromString.optional(),
  MAIL_QQ_ENABLED: booleanFromString.default("false"),
  MAIL_QQ_DISPLAY_NAME: z.string().trim().min(1).max(50).default("QQ邮箱"),
  MAIL_QQ_EMAIL: z.string().email().optional(),
  MAIL_QQ_AUTH_CODE: z.string().min(1).optional(),
  MAIL_QQ_IMAP_HOST: z.string().min(1).default("imap.qq.com"),
  MAIL_QQ_IMAP_PORT: z.coerce.number().int().min(1).max(65_535).default(993),
  MAIL_QQ_IMAP_SECURE: booleanFromString.default("true"),
  MAIL_QQ_MAILBOX: z.string().min(1).default("INBOX"),
  MAIL_QQ_WRITE_ENABLED: booleanFromString.default("false"),
  DATABASE_URL: z.string().min(1).default("./data/mail.db"),
  SERVER_HOST: z.string().min(1).default("0.0.0.0"),
  SERVER_PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  WEB_ORIGIN: z.string().url().default("http://localhost:5173"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  SYNC_PAGE_SIZE: z.coerce.number().int().min(10).max(2_000).default(200),
  SYNC_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(10).default(300),
  SYNC_IDLE_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(20).default(3),
  SYNC_LOCK_TTL_SECONDS: z.coerce.number().int().min(60).default(900),
  SYNC_FULL_FLAG_REFRESH_SECONDS: z.coerce.number().int().min(300).default(3_600),
  DRY_RUN: booleanFromString.default("true"),
  AI_BASE_URL: z.string().url().default("https://api.openai.com/v1"),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000).default(30_000),
  MAX_BODY_BYTES: z.coerce.number().int().min(16_384).max(5_242_880).default(1_048_576),
  MAX_ATTACHMENT_BYTES: z.coerce.number().int().min(65_536).max(52_428_800).default(26_214_400),
}).superRefine((value, context) => {
  if (!value.MAIL_QQ_ENABLED) return;
  if (!value.MAIL_QQ_EMAIL) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["MAIL_QQ_EMAIL"], message: "required when QQ mail is enabled" });
  }
  if (!value.MAIL_QQ_AUTH_CODE) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["MAIL_QQ_AUTH_CODE"], message: "required when QQ mail is enabled" });
  }
});

export type AppConfig = z.infer<typeof envSchema>;

export type MailProvider = "163" | "qq";

export interface MailAccountConfig {
  id: string;
  provider: MailProvider;
  displayName: string;
  email: string;
  authCode: string;
  imapHost: string;
  imapPort: number;
  imapSecure: boolean;
  mailbox: string;
  writeEnabled: boolean;
}

export function configuredMailAccounts(config: AppConfig): MailAccountConfig[] {
  const accounts: MailAccountConfig[] = [{
    id: "163",
    provider: "163",
    displayName: config.MAIL_163_DISPLAY_NAME,
    email: config.MAIL_EMAIL,
    authCode: config.MAIL_AUTH_CODE,
    imapHost: config.MAIL_IMAP_HOST,
    imapPort: config.MAIL_IMAP_PORT,
    imapSecure: config.MAIL_IMAP_SECURE,
    mailbox: config.MAIL_MAILBOX,
    writeEnabled: config.MAIL_163_WRITE_ENABLED ?? !config.DRY_RUN,
  }];
  if (config.MAIL_QQ_ENABLED && config.MAIL_QQ_EMAIL && config.MAIL_QQ_AUTH_CODE) {
    accounts.push({
      id: "qq",
      provider: "qq",
      displayName: config.MAIL_QQ_DISPLAY_NAME,
      email: config.MAIL_QQ_EMAIL,
      authCode: config.MAIL_QQ_AUTH_CODE,
      imapHost: config.MAIL_QQ_IMAP_HOST,
      imapPort: config.MAIL_QQ_IMAP_PORT,
      imapSecure: config.MAIL_QQ_IMAP_SECURE,
      mailbox: config.MAIL_QQ_MAILBOX,
      writeEnabled: config.MAIL_QQ_WRITE_ENABLED,
    });
  }
  return accounts;
}

export function configForMailAccount(config: AppConfig, account: MailAccountConfig): AppConfig {
  return {
    ...config,
    MAIL_EMAIL: account.email,
    MAIL_AUTH_CODE: account.authCode,
    MAIL_IMAP_HOST: account.imapHost,
    MAIL_IMAP_PORT: account.imapPort,
    MAIL_IMAP_SECURE: account.imapSecure,
    MAIL_MAILBOX: account.mailbox,
    DRY_RUN: !account.writeEnabled,
  };
}

export function readConfig(input: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    const fields = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Invalid server environment variables: ${fields}`);
  }
  return parsed.data;
}
