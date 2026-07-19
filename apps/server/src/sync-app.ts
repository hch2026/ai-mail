import cors from "@fastify/cors";
import Fastify from "fastify";
import type { Logger } from "pino";

import type { AppConfig } from "./config/env.js";
import { registerSyncApi, type SyncApiDependencies } from "./routes/sync-api.js";

export async function buildSyncApp(
  config: AppConfig,
  logger: Logger,
  dependencies: SyncApiDependencies,
) {
  const app = Fastify({ loggerInstance: logger });
  await app.register(cors, { origin: config.WEB_ORIGIN });
  app.get("/health", async () => ({ ok: true, mode: "read-only-imap-sync+classifier" }));
  await registerSyncApi(app, dependencies);
  return app;
}
