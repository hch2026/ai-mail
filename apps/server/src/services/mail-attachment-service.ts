import type { Logger } from "pino";

import type { AppConfig } from "../config/env.js";
import type { MailRepository } from "../db/repository.js";
import type { AttachmentMetadata, ImapConnectionFactory } from "../imap/types.js";

export interface LoadedAttachment {
  content: Buffer;
  contentType: string;
  filename: string;
}

export class MailAttachmentService {
  private readonly pending = new Map<string, Promise<LoadedAttachment | null>>();

  public constructor(
    private readonly config: AppConfig,
    private readonly repository: MailRepository,
    private readonly connectionFactory: ImapConnectionFactory,
    private readonly logger: Logger,
  ) {}

  public load(emailId: number, attachmentIndex: number): Promise<LoadedAttachment | null> {
    const key = `${emailId}:${attachmentIndex}`;
    const current = this.pending.get(key);
    if (current) return current;
    const operation = this.execute(emailId, attachmentIndex).finally(() => {
      if (this.pending.get(key) === operation) this.pending.delete(key);
    });
    this.pending.set(key, operation);
    return operation;
  }

  private async execute(emailId: number, attachmentIndex: number): Promise<LoadedAttachment | null> {
    const email = this.repository.getEmailForAttachment(emailId, attachmentIndex);
    if (!email) return null;
    if (email.attachment.size !== null && email.attachment.size > this.config.MAX_ATTACHMENT_BYTES) {
      throw new Error("Attachment exceeds the configured download size limit");
    }

    const connection = this.connectionFactory(email.accountKey);
    try {
      await connection.connect();
      return await connection.withReadOnlyMailbox(async (mailbox) => {
        if (mailbox.snapshot.path !== email.mailbox || mailbox.snapshot.uidValidity !== email.uidValidity) {
          throw new Error("Email is not part of the current read-only mailbox epoch");
        }
        const metadata = (await mailbox.fetchMetadata([email.uid]))[0];
        const attachment = resolveAttachment(metadata?.attachments ?? [], email.attachment, attachmentIndex);
        if (!attachment?.part) throw new Error("Attachment MIME part could not be resolved safely");
        if (attachment.size !== null && attachment.size > this.config.MAX_ATTACHMENT_BYTES) {
          throw new Error("Attachment exceeds the configured download size limit");
        }
        const body = await mailbox.fetchBodyPart(
          email.uid,
          attachment.part,
          this.config.MAX_ATTACHMENT_BYTES + 1,
        );
        if (body.content.length > this.config.MAX_ATTACHMENT_BYTES) {
          throw new Error("Attachment exceeds the configured download size limit");
        }
        const filename = safeFilename(attachment.filename ?? email.attachment.filename, attachmentIndex);
        const contentType = inferContentType(
          attachment.contentType || body.contentType || email.attachment.contentType,
          filename,
        );
        this.logger.debug({ emailId, attachmentIndex, bytes: body.content.length }, "attachment loaded through read-only IMAP");
        return { content: body.content, contentType, filename };
      });
    } finally {
      await connection.close();
    }
  }
}

function resolveAttachment(
  current: readonly AttachmentMetadata[],
  stored: AttachmentMetadata,
  index: number,
): AttachmentMetadata | null {
  if (stored.part) {
    const byPart = current.find((item) => item.part === stored.part);
    if (byPart) return byPart;
  }
  const indexed = current[index];
  if (indexed && sameAttachment(indexed, stored)) return indexed;
  const exact = current.filter((item) => sameAttachment(item, stored));
  return exact.length === 1 ? exact[0]! : null;
}

function sameAttachment(left: AttachmentMetadata, right: AttachmentMetadata): boolean {
  const leftName = left.filename?.normalize("NFKC").trim().toLowerCase() ?? null;
  const rightName = right.filename?.normalize("NFKC").trim().toLowerCase() ?? null;
  if (leftName && rightName && leftName !== rightName) return false;
  if (left.size !== null && right.size !== null && left.size !== right.size) return false;
  return Boolean(leftName || rightName || left.size !== null || right.size !== null);
}

function safeFilename(value: string | null, index: number): string {
  const cleaned = value?.normalize("NFKC").replace(/[\u0000-\u001f\u007f/\\]/g, "_").trim();
  return cleaned?.slice(0, 240) || `attachment-${index + 1}`;
}

function inferContentType(value: string, filename: string): string {
  const normalized = value.toLowerCase().split(";", 1)[0]?.trim() || "application/octet-stream";
  if (normalized !== "application/octet-stream") return normalized;
  const extension = filename.split(".").at(-1)?.toLowerCase();
  return ({
    pdf: "application/pdf",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    xml: "application/xml",
    zip: "application/zip",
  } as Record<string, string>)[extension ?? ""] ?? normalized;
}
