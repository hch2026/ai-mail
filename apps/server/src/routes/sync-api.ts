import { emailQuerySchema } from "@mail-ai/shared";
import type { FastifyInstance } from "fastify";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Logger } from "pino";
import { z } from "zod";

import type { MailRepository } from "../db/repository.js";
import type { SyncCoordinator } from "../sync/coordinator.js";

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });

export interface SyncApiDependencies {
  repository: MailRepository;
  coordinator: SyncCoordinator;
}

export async function registerSyncApi(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse<IncomingMessage>, Logger>,
  dependencies: SyncApiDependencies,
): Promise<void> {
  const { repository, coordinator } = dependencies;

  app.get("/api/dashboard", async () => repository.getDashboard());
  app.get("/api/labels", async () => []);
  app.get("/api/emails", async (request, reply) => {
    const query = emailQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid email filters" });
    return repository.listEmails(query.data);
  });
  app.get("/api/emails/:id", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid email id" });
    const email = repository.getEmailDetail(params.data.id);
    return email ?? reply.code(404).send({ error: "Email not found" });
  });
  app.post("/api/sync", async (_request, reply) => {
    const result = await coordinator.triggerManual();
    return reply.code(result.status === "failed" ? 502 : 202).send(result);
  });
  app.get("/api/sync/status", async () => ({
    ...coordinator.getStatus(),
    recentRuns: repository.listSyncRuns(),
    failures: repository.listSyncFailures(),
  }));
}
