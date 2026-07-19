import pino, { type Logger } from "pino";

import type { AppConfig } from "./env.js";

export function createLogger(config: Pick<AppConfig, "LOG_LEVEL">): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: [
        "MAIL_AUTH_CODE",
        "MAIL_QQ_AUTH_CODE",
        "AI_API_KEY",
        "password",
        "pass",
        "authorization",
        "req.headers.authorization",
        "req.headers.cookie",
        "config.MAIL_AUTH_CODE",
        "config.MAIL_QQ_AUTH_CODE",
        "config.AI_API_KEY",
      ],
      censor: "[REDACTED]",
    },
  });
}
