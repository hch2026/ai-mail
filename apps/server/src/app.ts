import cors from "@fastify/cors";
import Fastify from "fastify";
import type { Logger } from "pino";

import type { AppConfig } from "./config/env.js";
import { registerApi, type ApiDependencies } from "./routes/api.js";

export async function buildApp(config: AppConfig, logger: Logger, dependencies: ApiDependencies) {
  const app = Fastify({ loggerInstance: logger });
  await app.register(cors, { origin: config.WEB_ORIGIN });

  app.get("/health", async () => ({ ok: true, mode: "read-only-sync+confirmed-trash-move" }));
  await registerApi(app, dependencies);

  return app;
}
