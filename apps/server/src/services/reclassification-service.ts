import type { MailRepository } from "../db/repository.js";
import type { DiscoveryRepository } from "../db/discovery-repository.js";
import type { ImapConnectionFactory } from "../imap/types.js";
import type { ClassificationService } from "./classification-service.js";

export class ReclassificationService {
  public constructor(
    private readonly repository: MailRepository,
    private readonly discoveryRepository: DiscoveryRepository,
    private readonly connectionFactory: ImapConnectionFactory,
    private readonly classificationService: ClassificationService,
  ) {}

  public async reclassify(emailId: number) {
    if (!this.repository.getEmailForClassification(emailId)) return null;
    const connection = this.connectionFactory();
    try {
      await connection.connect();
      await connection.withReadOnlyMailbox(async (mailbox) => {
        await this.classificationService.classifyEmail(emailId, mailbox, undefined, { force: true });
      });
      return this.repository.getEmailDetail(emailId, this.discoveryRepository.getConfirmedTaxonomy()?.id);
    } finally {
      await connection.close();
    }
  }
}
