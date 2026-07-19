import type { EmailClassifier } from "@mail-ai/classifier";
import type { Logger } from "pino";

import type { MailRepository } from "../db/repository.js";
import type { ConfirmedTaxonomy, DiscoveryRepository } from "../db/discovery-repository.js";
import type { ReadOnlyMailboxSession } from "../imap/types.js";

export class ClassificationService {
  public constructor(
    private readonly repository: MailRepository,
    private readonly classifier: EmailClassifier,
    private readonly logger: Logger,
    private readonly discoveryRepository?: DiscoveryRepository,
  ) {}

  public async classifyEmail(
    emailId: number,
    _mailbox: ReadOnlyMailboxSession,
    taxonomyOverride?: ConfirmedTaxonomy,
    options: { force?: boolean } = {},
  ): Promise<boolean> {
    const email = this.repository.getEmailForClassification(emailId);
    if (!email) throw new Error(`Email ${emailId} does not exist`);
    const taxonomy = taxonomyOverride ?? this.discoveryRepository?.getConfirmedTaxonomy();
    if (this.discoveryRepository && !taxonomy) return false;
    if (!this.repository.claimClassification(emailId, taxonomy?.id, options.force ?? false)) return false;

    const input = {
      fromName: email.fromName,
      fromAddress: email.fromAddress,
      subject: email.subject,
      sentAt: email.sentAt?.toISOString() ?? null,
      isUnread: email.isUnread,
      flags: email.flags,
      imapLabels: email.imapLabels,
      preview: email.preview,
      bodyText: email.bodyText,
    };

    try {
      const result = await this.classifier.classify(input, taxonomy?.labels);
      this.repository.saveClassification(emailId, result.classification, result.source, {
        ...(taxonomy ? { taxonomyVersionId: taxonomy.id } : {}),
        modelVersion: result.modelVersion,
        rawResult: result.rawResult,
      });
      if (taxonomy && result.classification.confidence < 0.75) {
        const domain = email.fromAddress?.split("@")[1]?.toLowerCase() ?? "unknown";
        const subjectPattern = (email.subject ?? "no-subject")
          .toLowerCase()
          .replace(/\d{2,}/g, "#")
          .slice(0, 80);
        this.discoveryRepository?.recordUncertainPattern(
          taxonomy.id,
          `${domain}|${subjectPattern}`,
          emailId,
          `建议评估：${domain}`,
        );
      }
      return true;
    } catch (error) {
      this.repository.markClassificationError(emailId);
      this.logger.warn(
        { emailId, err: error instanceof Error ? error.message : "classification failed" },
        "email classification failed",
      );
      throw error;
    }
  }
}
