import {
  bulkConfirmSchema,
  bulkDeleteSchema,
  confirmTaxonomySchema,
  emailQuerySchema,
  manualClassificationPatchSchema,
} from "@mail-ai/shared";
import type { FastifyInstance } from "fastify";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import type { Logger } from "pino";
import { z } from "zod";

import type { MailRepository } from "../db/repository.js";
import type { DiscoveryRepository } from "../db/discovery-repository.js";
import type { BackfillService } from "../services/backfill-service.js";
import type { DiscoveryService } from "../services/discovery-service.js";
import type { ReclassificationService } from "../services/reclassification-service.js";
import type { MailContentService } from "../services/mail-content-service.js";
import type { MailAttachmentService } from "../services/mail-attachment-service.js";
import type { MailDeletionService } from "../services/mail-deletion-service.js";
import type { SyncCoordinator } from "../sync/coordinator.js";
import type { AccountRuntimeContext, AccountRuntimeManager } from "../accounts/account-runtime.js";

const idParamsSchema = z.object({ id: z.coerce.number().int().positive() });
const attachmentParamsSchema = z.object({
  id: z.coerce.number().int().positive(),
  index: z.coerce.number().int().min(0).max(999),
});
const attachmentQuerySchema = z.object({
  inline: z.enum(["true", "false"]).transform((value) => value === "true").default("false"),
});

export interface ApiDependencies {
  repository: MailRepository;
  coordinator: SyncCoordinator;
  reclassificationService: ReclassificationService;
  discoveryRepository: DiscoveryRepository;
  discoveryService: DiscoveryService;
  backfillService: BackfillService;
  mailContentService: MailContentService;
  mailAttachmentService: MailAttachmentService;
  mailDeletionService: MailDeletionService;
  accountManager?: AccountRuntimeManager;
}

export async function registerApi(
  app: FastifyInstance<Server, IncomingMessage, ServerResponse<IncomingMessage>, Logger>,
  dependencies: ApiDependencies,
): Promise<void> {
  const {
    repository,
    coordinator,
    reclassificationService,
    discoveryRepository,
    discoveryService,
    backfillService,
    mailContentService,
    mailAttachmentService,
    mailDeletionService,
    accountManager,
  } = dependencies;

  const legacyContext: Omit<AccountRuntimeContext, "account"> = {
    coordinator,
    reclassificationService,
    discoveryRepository,
    discoveryService,
    backfillService,
  };
  const contextForAccountId = (accountId?: string) => accountManager?.requireById(accountId) ?? legacyContext;
  const contextForQuery = (query: unknown) => {
    const accountId = query && typeof query === "object" && typeof (query as { accountId?: unknown }).accountId === "string"
      ? (query as { accountId: string }).accountId
      : undefined;
    return contextForAccountId(accountId);
  };
  const contextForEmail = (emailId: number) => {
    if (!accountManager) return legacyContext;
    const accountKey = repository.getAccountKeyForEmail(emailId);
    return accountKey ? accountManager.requireByKey(accountKey) : null;
  };
  const accountKeyOf = (context: ReturnType<typeof contextForAccountId>) => accountManager
    ? (context as AccountRuntimeContext).account.accountKey
    : undefined;

  app.get("/api/accounts", async () => accountManager?.listAccounts() ?? [{
    id: "163", provider: "163", displayName: "163邮箱", writeEnabled: false, isDefault: true,
  }]);
  app.get("/api/dashboard", async (request) => {
    const context = contextForQuery(request.query);
    return repository.getDashboard(context.discoveryRepository.getConfirmedTaxonomy()?.id, accountKeyOf(context));
  });
  app.get("/api/labels", async (request) => {
    const context = contextForQuery(request.query);
    return repository.getLabels(context.discoveryRepository.getConfirmedTaxonomy()?.id, accountKeyOf(context));
  });
  app.get("/api/emails", async (request, reply) => {
    const query = emailQuerySchema.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ error: "Invalid email filters" });
    try {
      const context = contextForAccountId(query.data.accountId);
      return repository.listEmails(query.data, context.discoveryRepository.getConfirmedTaxonomy()?.id, accountKeyOf(context));
    } catch {
      return reply.code(400).send({ error: "Unknown mail account" });
    }
  });
  app.post("/api/emails/bulk-delete", async (request, reply) => {
    const body = bulkDeleteSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid email delete selection" });
    try {
      return await mailDeletionService.moveToTrash(body.data.emailIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Mailbox delete operation failed";
      const safeMessage = /selected|running|epochs|recoverable|UIDVALIDITY|trash mailbox/i.test(message)
        ? message
        : "Unable to move selected emails to the account trash mailbox";
      return reply.code(409).send({ error: safeMessage });
    }
  });
  app.get("/api/emails/:id", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid email id" });
    const context = contextForEmail(params.data.id);
    const email = context
      ? repository.getEmailDetail(params.data.id, context.discoveryRepository.getConfirmedTaxonomy()?.id)
      : null;
    return email ?? reply.code(404).send({ error: "Email not found" });
  });
  app.post("/api/emails/:id/content", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid email id" });
    try {
      const content = await mailContentService.load(params.data.id);
      return content ?? reply.code(404).send({ error: "Email not found" });
    } catch {
      return reply.code(502).send({ error: "Unable to load email content through read-only IMAP" });
    }
  });
  app.get("/api/emails/:id/attachments/:index", async (request, reply) => {
    const params = attachmentParamsSchema.safeParse(request.params);
    const query = attachmentQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) return reply.code(400).send({ error: "Invalid attachment request" });
    try {
      const attachment = await mailAttachmentService.load(params.data.id, params.data.index);
      if (!attachment) return reply.code(404).send({ error: "Attachment not found" });
      const canRenderInline = attachment.contentType === "application/pdf"
        || /^image\/(?:png|jpe?g|gif|webp)$/i.test(attachment.contentType);
      const disposition = query.data.inline && canRenderInline ? "inline" : "attachment";
      const encodedFilename = encodeURIComponent(attachment.filename).replace(/['()]/g, (value) => `%${value.charCodeAt(0).toString(16)}`);
      return reply
        .header("Content-Type", attachment.contentType)
        .header("Content-Length", String(attachment.content.length))
        .header("Content-Disposition", `${disposition}; filename="attachment"; filename*=UTF-8''${encodedFilename}`)
        .header("X-Content-Type-Options", "nosniff")
        .header("Cache-Control", "private, max-age=300")
        .send(attachment.content);
    } catch {
      return reply.code(502).send({ error: "Unable to load attachment through read-only IMAP" });
    }
  });
  app.post("/api/emails/:id/reclassify", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    if (!params.success) return reply.code(400).send({ error: "Invalid email id" });
    const context = contextForEmail(params.data.id);
    if (!context) return reply.code(404).send({ error: "Email not found" });
    if (!context.discoveryRepository.getConfirmedTaxonomy()) {
      return reply.code(409).send({ error: "Confirm a taxonomy before reclassifying emails" });
    }
    const email = await context.reclassificationService.reclassify(params.data.id);
    return email ?? reply.code(404).send({ error: "Email not found" });
  });
  app.patch("/api/emails/:id/classification", async (request, reply) => {
    const params = idParamsSchema.safeParse(request.params);
    const body = manualClassificationPatchSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "Invalid classification patch" });
    const context = contextForEmail(params.data.id);
    if (!context) return reply.code(404).send({ error: "Email not found" });
    const taxonomy = context.discoveryRepository.getConfirmedTaxonomy();
    if (!taxonomy) return reply.code(409).send({ error: "Confirm a taxonomy before editing classifications" });
    if (body.data.primaryLabel && !taxonomy.labels.some((item) => item.label === body.data.primaryLabel)) {
      return reply.code(400).send({ error: "The selected label is not part of the confirmed taxonomy" });
    }
    if (!repository.getEmailForClassification(params.data.id)) {
      return reply.code(404).send({ error: "Email not found" });
    }
    try {
      repository.applyManualPatch(
        params.data.id,
        body.data,
        taxonomy.id,
        taxonomy.labels.map((item) => item.label),
      );
    } catch (error) {
      return reply.code(409).send({
        error: error instanceof Error ? error.message : "Manual classification failed",
      });
    }
    return repository.getEmailDetail(params.data.id, taxonomy.id);
  });
  app.post("/api/sync", async (request, reply) => {
    let context;
    try { context = contextForQuery(request.query); } catch { return reply.code(400).send({ error: "Unknown mail account" }); }
    const result = await context.coordinator.triggerManual();
    return reply.code(result.status === "failed" ? 502 : 202).send(result);
  });
  app.get("/api/sync/status", async (request, reply) => {
    let context;
    try { context = contextForQuery(request.query); } catch { return reply.code(400).send({ error: "Unknown mail account" }); }
    const accountKey = accountKeyOf(context);
    return {
      ...context.coordinator.getStatus(),
      recentRuns: repository.listSyncRuns(50, accountKey),
      failures: repository.listSyncFailures(100, accountKey),
    };
  });
  app.get("/api/reviews", async (request, reply) => {
    const parsed = emailQuerySchema.safeParse({ ...(request.query as object), review: "true" });
    if (!parsed.success) return reply.code(400).send({ error: "Invalid review filters" });
    const context = contextForAccountId(parsed.data.accountId);
    return repository.listEmails(parsed.data, context.discoveryRepository.getConfirmedTaxonomy()?.id, accountKeyOf(context));
  });
  app.post("/api/reviews/confirm", async (request, reply) => {
    const body = bulkConfirmSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid review selection" });
    const context = contextForQuery(request.query);
    const taxonomy = context.discoveryRepository.getConfirmedTaxonomy();
    if (!taxonomy) return reply.code(409).send({ error: "Confirm a taxonomy before reviewing emails" });
    return reply.send({ confirmed: repository.confirmReviews(body.data.emailIds, taxonomy.id) });
  });
  app.get("/api/discovery/report", async (request, reply) => {
    const context = contextForQuery(request.query);
    const report = context.discoveryRepository.getLatestReport();
    return report ?? reply.code(404).send({ error: "Mailbox profile report has not been generated" });
  });
  app.post("/api/discovery/analyze", async (request, reply) => {
    try {
      const report = await contextForQuery(request.query).discoveryService.analyze();
      return reply.code(201).send(report);
    } catch (error) {
      return reply.code(409).send({
        error: error instanceof Error ? error.message : "Mailbox discovery failed",
      });
    }
  });
  app.get("/api/taxonomy/status", async (request) => contextForQuery(request.query).discoveryRepository.getStatus());
  app.post("/api/taxonomy/confirm", async (request, reply) => {
    const body = confirmTaxonomySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: "Invalid taxonomy confirmation" });
    try {
      const context = contextForQuery(request.query);
      const taxonomy = context.discoveryRepository.confirmTaxonomy(body.data);
      context.backfillService.start(taxonomy.id);
      return reply.code(202).send({ taxonomyVersionId: taxonomy.id, backfillStarted: true });
    } catch (error) {
      return reply.code(409).send({ error: error instanceof Error ? error.message : "Taxonomy confirmation failed" });
    }
  });
  app.post("/api/taxonomy/backfill/retry", async (request, reply) => {
    const context = contextForQuery(request.query);
    const taxonomy = context.discoveryRepository.getConfirmedTaxonomy();
    if (!taxonomy || taxonomy.backfillStatus !== "failed") {
      return reply.code(409).send({ error: "There is no failed taxonomy backfill to retry" });
    }
    context.backfillService.start(taxonomy.id);
    return reply.code(202).send({ taxonomyVersionId: taxonomy.id, backfillStarted: true });
  });
}
