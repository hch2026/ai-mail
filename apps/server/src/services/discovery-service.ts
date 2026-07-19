import { buildMailboxProfileReport, inferPurpose } from "@mail-ai/classifier";
import type { Logger } from "pino";

import type { AppConfig } from "../config/env.js";
import type { DiscoveryRepository } from "../db/discovery-repository.js";
import type { MailRepository } from "../db/repository.js";
import type { ImapConnectionFactory } from "../imap/types.js";
import { parseBodyPartAsSafeText } from "./body-text.js";

export class DiscoveryService {
  private currentAnalysis: Promise<ReturnType<DiscoveryRepository["saveReport"]>> | null = null;

  public constructor(
    private readonly config: AppConfig,
    private readonly discoveryRepository: DiscoveryRepository,
    private readonly mailRepository: MailRepository,
    private readonly connectionFactory: ImapConnectionFactory,
    private readonly logger: Logger,
  ) {}

  public analyze() {
    if (this.currentAnalysis) return this.currentAnalysis;
    const promise = this.execute().finally(() => {
      if (this.currentAnalysis === promise) this.currentAnalysis = null;
    });
    this.currentAnalysis = promise;
    return promise;
  }

  private async execute() {
    let emails = this.discoveryRepository.listDiscoveryEmails();
    if (emails.length === 0) throw new Error("No synchronized emails are available for discovery");

    const selectedKeys = new Map<string, number>();
    const representatives = emails.filter((email) => {
      if (email.bodyLoaded || !(email.textPart ?? email.htmlPart)) return false;
      const match = inferPurpose(email);
      if (match.confidence >= 0.75) return false;
      const key = `${email.domain}|${(email.subject ?? "").replace(/\d+/g, "#").slice(0, 50)}`;
      const used = selectedKeys.get(key) ?? 0;
      if (used >= 2 || selectedKeys.size >= 30) return false;
      selectedKeys.set(key, used + 1);
      return true;
    });

    if (representatives.length > 0) {
      const connection = this.connectionFactory();
      try {
        await connection.connect();
        await connection.withReadOnlyMailbox(async (mailbox) => {
          for (const email of representatives) {
            if (email.uidValidity !== mailbox.snapshot.uidValidity) continue;
            const partId = email.textPart ?? email.htmlPart;
            if (!partId) continue;
            try {
              const part = await mailbox.fetchBodyPart(email.uid, partId, this.config.MAX_BODY_BYTES);
              const bodyText = await parseBodyPartAsSafeText(part);
              this.mailRepository.saveBody(email.id, bodyText);
            } catch (error) {
              this.logger.debug(
                { emailId: email.id, err: error instanceof Error ? error.message : "body sample failed" },
                "discovery representative body could not be loaded",
              );
            }
          }
        });
      } finally {
        await connection.close();
      }
      emails = this.discoveryRepository.listDiscoveryEmails();
    }

    const report = buildMailboxProfileReport(emails);
    return this.discoveryRepository.saveReport(report);
  }
}
