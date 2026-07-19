import type { Logger } from "pino";

import type { DiscoveryRepository } from "../db/discovery-repository.js";
import type { ImapConnectionFactory } from "../imap/types.js";
import type { ClassificationService } from "./classification-service.js";

export class BackfillService {
  private running: Promise<void> | null = null;

  public constructor(
    private readonly discoveryRepository: DiscoveryRepository,
    private readonly connectionFactory: ImapConnectionFactory,
    private readonly classificationService: ClassificationService,
    private readonly logger: Logger,
  ) {}

  public start(versionId: number): void {
    if (this.running) return;
    const promise = this.execute(versionId).finally(() => {
      if (this.running === promise) this.running = null;
    });
    this.running = promise;
  }

  public resumePending(): void {
    const taxonomy = this.discoveryRepository.getConfirmedTaxonomy();
    if (
      taxonomy?.status === "confirmed" &&
      (taxonomy.backfillStatus === "pending" || taxonomy.backfillStatus === "running")
    ) {
      this.start(taxonomy.id);
    }
  }

  private async execute(versionId: number): Promise<void> {
    const taxonomy = this.discoveryRepository.getConfirmedTaxonomy();
    if (!taxonomy || taxonomy.id !== versionId) throw new Error("Confirmed taxonomy is unavailable");
    this.discoveryRepository.startBackfill(versionId);
    const connection = this.connectionFactory();
    try {
      await connection.connect();
      await connection.withReadOnlyMailbox(async (mailbox) => {
        while (true) {
          const ids = this.discoveryRepository.getBackfillEmailIds(versionId, 100);
          if (ids.length === 0) break;
          for (const emailId of ids) {
            // The selected set contains only messages missing this taxonomy
            // version. Force allows a failed message to be retried instead of
            // being selected forever while claimClassification rejects it.
            await this.classificationService.classifyEmail(emailId, mailbox, taxonomy, { force: true });
          }
        }
      });
      const remaining = this.discoveryRepository.getBackfillEmailIds(versionId, 1);
      if (remaining.length > 0) throw new Error("Backfill verification found unclassified emails");
      this.discoveryRepository.finishBackfill(versionId, true);
      this.logger.info({ taxonomyVersionId: versionId }, "taxonomy backfill completed");
    } catch (error) {
      this.discoveryRepository.finishBackfill(versionId, false);
      this.logger.error(
        { taxonomyVersionId: versionId, err: error instanceof Error ? error.message : "backfill failed" },
        "taxonomy backfill failed",
      );
    } finally {
      await connection.close();
    }
  }
}
