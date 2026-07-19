import { createClassifier } from "@mail-ai/classifier";
import { buildApp } from "./app.js";
import { readConfig } from "./config/env.js";
import { createLogger } from "./config/logger.js";
import { AccountRegistry } from "./accounts/account-registry.js";
import { AccountRuntimeManager, type AccountRuntimeContext } from "./accounts/account-runtime.js";
import { createDatabase, runMigrations } from "./db/client.js";
import { DiscoveryRepository } from "./db/discovery-repository.js";
import { MailRepository } from "./db/repository.js";
import { ImapFlowConnection } from "./imap/imapflow-reader.js";
import { BackfillService } from "./services/backfill-service.js";
import { ClassificationService } from "./services/classification-service.js";
import { DiscoveryService } from "./services/discovery-service.js";
import { ReclassificationService } from "./services/reclassification-service.js";
import { MailContentService } from "./services/mail-content-service.js";
import { MailAttachmentService } from "./services/mail-attachment-service.js";
import { MailDeletionService } from "./services/mail-deletion-service.js";
import { SyncCoordinator } from "./sync/coordinator.js";
import { SyncService } from "./sync/sync-service.js";

const config = readConfig();
const logger = createLogger(config);
const database = createDatabase(config.DATABASE_URL);
runMigrations(database.db);
const repository = new MailRepository(database.db);
const accountRegistry = new AccountRegistry(config);
for (const account of accountRegistry.all()) {
  repository.upsertMailAccount({
    accountKey: account.accountKey,
    provider: account.config.provider,
    displayName: account.config.displayName,
  });
}
const connectionFactory = (accountKey?: string) => new ImapFlowConnection(
  accountKey ? accountRegistry.requireByKey(accountKey).appConfig : accountRegistry.default().appConfig,
);
const classifier = createClassifier({
  baseUrl: config.AI_BASE_URL,
  apiKey: config.AI_API_KEY,
  model: config.AI_MODEL,
  timeoutMs: config.AI_TIMEOUT_MS,
});
const contexts: AccountRuntimeContext[] = accountRegistry.all().map((account) => {
  const accountFactory = () => new ImapFlowConnection(account.appConfig);
  const discoveryRepository = new DiscoveryRepository(database.db, account.accountKey);
  const classificationService = new ClassificationService(repository, classifier, logger, discoveryRepository);
  const syncService = new SyncService(
    account.appConfig,
    repository,
    accountFactory,
    logger,
    classificationService,
  );
  const coordinator = new SyncCoordinator(account.appConfig, syncService, accountFactory, logger);
  const discoveryService = new DiscoveryService(
    account.appConfig,
    discoveryRepository,
    repository,
    accountFactory,
    logger,
  );
  const reclassificationService = new ReclassificationService(
    repository,
    discoveryRepository,
    accountFactory,
    classificationService,
  );
  const backfillService = new BackfillService(
    discoveryRepository,
    accountFactory,
    classificationService,
    logger,
  );
  return {
    account,
    coordinator,
    discoveryRepository,
    discoveryService,
    reclassificationService,
    backfillService,
  };
});
const accountManager = new AccountRuntimeManager(contexts, accountRegistry.listDtos());
const defaultContext = accountManager.default();
const mailContentService = new MailContentService(config, repository, connectionFactory, logger);
const mailAttachmentService = new MailAttachmentService(config, repository, connectionFactory, logger);
const mailDeletionService = new MailDeletionService(
  config,
  repository,
  connectionFactory,
  logger,
  (accountKey) => accountRegistry.requireByKey(accountKey).config.writeEnabled,
);
const app = await buildApp(config, logger, {
  repository,
  coordinator: defaultContext.coordinator,
  reclassificationService: defaultContext.reclassificationService,
  discoveryRepository: defaultContext.discoveryRepository,
  discoveryService: defaultContext.discoveryService,
  backfillService: defaultContext.backfillService,
  mailContentService,
  mailAttachmentService,
  mailDeletionService,
  accountManager,
});

const shutdown = async (): Promise<void> => {
  await accountManager.stop();
  await app.close();
  database.sqlite.close();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await app.listen({ host: config.SERVER_HOST, port: config.SERVER_PORT });
accountManager.start();
