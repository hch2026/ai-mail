import type { BulkDeleteResultDto } from "@mail-ai/shared";
import type { Logger } from "pino";

import type { AppConfig } from "../config/env.js";
import type { MailRepository } from "../db/repository.js";
import type { ImapConnectionFactory } from "../imap/types.js";

export class MailDeletionService {
  private currentOperation: Promise<BulkDeleteResultDto> | null = null;

  public constructor(
    private readonly config: AppConfig,
    private readonly repository: MailRepository,
    private readonly connectionFactory: ImapConnectionFactory,
    private readonly logger: Logger,
    private readonly writeEnabledForAccount?: (accountKey: string) => boolean,
  ) {}

  public moveToTrash(emailIds: number[]): Promise<BulkDeleteResultDto> {
    if (this.currentOperation) throw new Error("Another mailbox delete operation is already running");
    const operation = this.execute(emailIds).finally(() => {
      if (this.currentOperation === operation) this.currentOperation = null;
    });
    this.currentOperation = operation;
    return operation;
  }

  private async execute(emailIds: number[]): Promise<BulkDeleteResultDto> {
    const ids = [...new Set(emailIds)].sort((a, b) => a - b);
    const records = this.repository.getEmailsForMailboxMove(ids);
    if (records.length !== ids.length) {
      throw new Error("Some selected emails no longer exist in the inbox; refresh and select again");
    }
    const groups = new Set(records.map((record) => `${record.mailbox}\u0000${record.uidValidity}`));
    if (groups.size !== 1) {
      throw new Error("Selected emails span multiple mailbox epochs and cannot be deleted together safely");
    }
    const accountKeys = new Set(records.map((record) => record.accountKey));
    if (accountKeys.size !== 1) {
      throw new Error("Selected emails span multiple mail accounts and cannot be deleted together safely");
    }
    const accountKey = records[0]!.accountKey;
    const writeEnabled = this.writeEnabledForAccount?.(accountKey) ?? !this.config.DRY_RUN;
    if (!writeEnabled) {
      return { requested: ids.length, moved: 0, dryRun: true, targetMailbox: null };
    }

    const first = records[0]!;
    const connection = this.connectionFactory(accountKey);
    if (!connection.moveMessagesToTrash) {
      throw new Error("This IMAP connection does not support recoverable deletion");
    }
    try {
      await connection.connect();
      const result = await connection.moveMessagesToTrash({
        mailbox: first.mailbox,
        uidValidity: first.uidValidity,
        uids: records.map((record) => record.uid),
      });
      if (result.moved !== ids.length) {
        throw new Error("IMAP moved an unexpected number of messages; local state was not changed");
      }
      const marked = this.repository.markEmailsMovedToTrash(ids, result.targetMailbox);
      if (marked !== ids.length) {
        this.logger.error({ requested: ids.length, marked }, "remote trash move succeeded but local state update was incomplete");
        throw new Error("Messages were moved remotely, but the local database needs a synchronization refresh");
      }
      this.logger.info({ moved: result.moved, targetMailbox: result.targetMailbox }, "user-confirmed messages moved to trash");
      return {
        requested: ids.length,
        moved: result.moved,
        dryRun: false,
        targetMailbox: result.targetMailbox,
      };
    } finally {
      await connection.close();
    }
  }
}
