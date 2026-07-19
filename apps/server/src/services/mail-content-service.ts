import type { EmailContentDto } from "@mail-ai/shared";
import type { Logger } from "pino";

import type { AppConfig } from "../config/env.js";
import type { MailRepository } from "../db/repository.js";
import type {
  AttachmentMetadata,
  BodyPartContent,
  ImapConnectionFactory,
} from "../imap/types.js";
import { parseBodyPartAsHtml, parseBodyPartAsSafeText } from "./body-text.js";
import { sanitizeEmailHtml } from "./email-html.js";

const MAX_INLINE_IMAGES = 20;
const MAX_TOTAL_INLINE_IMAGE_BYTES = 8 * 1024 * 1024;

function normalizeContentId(value: string): string {
  return value.trim().replace(/^<|>$/g, "").toLowerCase();
}

function contentDto(
  emailId: number,
  detail: NonNullable<ReturnType<MailRepository["getEmailDetail"]>>,
): EmailContentDto {
  return {
    emailId,
    bodyText: detail.bodyText,
    bodyHtml: detail.bodyHtml,
    contentLoaded: detail.contentLoaded,
    remoteImageCount: detail.remoteImageCount,
    inlineImageCount: detail.inlineImageCount,
  };
}

export class MailContentService {
  private readonly pending = new Map<number, Promise<EmailContentDto | null>>();

  public constructor(
    private readonly config: AppConfig,
    private readonly repository: MailRepository,
    private readonly connectionFactory: ImapConnectionFactory,
    private readonly logger: Logger,
  ) {}

  public load(emailId: number): Promise<EmailContentDto | null> {
    const current = this.pending.get(emailId);
    if (current) return current;
    const operation = this.execute(emailId).finally(() => {
      if (this.pending.get(emailId) === operation) this.pending.delete(emailId);
    });
    this.pending.set(emailId, operation);
    return operation;
  }

  private async execute(emailId: number): Promise<EmailContentDto | null> {
    const email = this.repository.getEmailForContent(emailId);
    if (!email) return null;
    const cached = this.repository.getEmailDetail(emailId);
    // Retry legacy/failed loads that were marked complete without yielding any
    // displayable content. This also repairs records created before single-part
    // root MIME sections were recognized.
    if (email.contentLoaded && cached && (cached.bodyText !== null || cached.bodyHtml !== null)) {
      return contentDto(emailId, cached);
    }

    const connection = this.connectionFactory(email.accountKey);
    try {
      await connection.connect();
      await connection.withReadOnlyMailbox(async (mailbox) => {
        if (mailbox.snapshot.path !== email.mailbox || mailbox.snapshot.uidValidity !== email.uidValidity) {
          throw new Error("Email is not part of the current read-only mailbox epoch");
        }

        const metadata = (await mailbox.fetchMetadata([email.uid]))[0];
        const textPart = metadata?.textPart ?? email.textPart;
        const htmlPart = metadata?.htmlPart ?? email.htmlPart;
        let bodyText = email.bodyText;
        let rawHtml: string | null = null;

        if (textPart) {
          bodyText = await parseBodyPartAsSafeText(
            await mailbox.fetchBodyPart(email.uid, textPart, this.config.MAX_BODY_BYTES),
          );
        }
        if (htmlPart) {
          const htmlBodyPart = await mailbox.fetchBodyPart(email.uid, htmlPart, this.config.MAX_BODY_BYTES);
          rawHtml = await parseBodyPartAsHtml(htmlBodyPart);
          if (!bodyText) bodyText = await parseBodyPartAsSafeText(htmlBodyPart);
        }

        const inlineImages = await this.loadInlineImages(
          email.uid,
          metadata?.attachments ?? [],
          rawHtml,
          mailbox.fetchBodyPart.bind(mailbox),
        );
        const sanitized = rawHtml
          ? sanitizeEmailHtml(rawHtml, inlineImages)
          : { html: "", remoteImageCount: 0, inlineImageCount: 0 };

        this.repository.saveMailContent(emailId, {
          bodyText: bodyText?.trim() || null,
          bodyHtml: sanitized.html || null,
          remoteImageCount: sanitized.remoteImageCount,
          inlineImageCount: sanitized.inlineImageCount,
        });
      });
    } finally {
      await connection.close();
    }

    const detail = this.repository.getEmailDetail(emailId);
    if (!detail) return null;
    this.logger.debug(
      { emailId, remoteImageCount: detail.remoteImageCount, inlineImageCount: detail.inlineImageCount },
      "mail content loaded through read-only IMAP",
    );
    return contentDto(emailId, detail);
  }

  private async loadInlineImages(
    uid: number,
    attachments: readonly AttachmentMetadata[],
    rawHtml: string | null,
    fetchPart: (uid: number, part: string, maxBytes: number) => Promise<BodyPartContent>,
  ): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    if (!rawHtml) return result;
    let totalBytes = 0;
    const normalizedHtml = rawHtml.toLowerCase();
    const candidates = attachments.filter((item) => {
      if (!item.part || !item.contentId || !item.contentType.toLowerCase().startsWith("image/")) return false;
      return normalizedHtml.includes(`cid:${normalizeContentId(item.contentId)}`);
    }).slice(0, MAX_INLINE_IMAGES);

    for (const item of candidates) {
      if (!item.part || !item.contentId || totalBytes >= MAX_TOTAL_INLINE_IMAGE_BYTES) break;
      const remaining = MAX_TOTAL_INLINE_IMAGE_BYTES - totalBytes;
      const part = await fetchPart(uid, item.part, Math.min(this.config.MAX_BODY_BYTES, remaining));
      if (!part.contentType.toLowerCase().startsWith("image/") || part.content.length > remaining) continue;
      totalBytes += part.content.length;
      result.set(
        normalizeContentId(item.contentId),
        `data:${part.contentType.toLowerCase()};base64,${part.content.toString("base64")}`,
      );
    }
    return result;
  }
}
