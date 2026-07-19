import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "pino";

import type { AppConfig } from "../config/env.js";
import type { MailRepository, SyncCounters } from "../db/repository.js";
import { chunkUids } from "../imap/mime.js";
import type { ImapConnection, ImapConnectionFactory } from "../imap/types.js";

export interface EmailClassificationWorker {
  classifyEmail(emailId: number, mailbox: import("../imap/types.js").ReadOnlyMailboxSession): Promise<boolean>;
}

export type SyncTrigger = "startup" | "idle" | "poll" | "manual";
export type SyncMode = "idle" | "poll";

export interface SyncResult extends SyncCounters {
  runId: number;
  status: "success" | "failed" | "skipped";
}

export function safeImapErrorMessage(error: unknown, secrets: readonly string[] = []): string {
  let message = error instanceof Error ? error.message : "Unknown synchronization error";
  for (const secret of secrets) {
    if (secret) message = message.split(secret).join("[REDACTED]");
  }
  return message
    .replace(/((?:pass(?:word)?|auth(?:orization)?|token|secret|code)\s*[=:]\s*)\S+/gi, "$1[REDACTED]")
    .slice(0, 1_000);
}

export function accountKeyFor(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase()).digest("hex");
}

export class SyncService {
  private currentRun: Promise<SyncResult> | null = null;
  private readonly accountKey: string;

  public constructor(
    private readonly config: AppConfig,
    private readonly repository: MailRepository,
    private readonly connectionFactory: ImapConnectionFactory,
    private readonly logger: Logger,
    private readonly classificationWorker?: EmailClassificationWorker,
  ) {
    this.accountKey = accountKeyFor(config.MAIL_EMAIL);
  }

  public run(trigger: SyncTrigger, mode: SyncMode, existingConnection?: ImapConnection): Promise<SyncResult> {
    if (this.currentRun) return this.currentRun;
    const promise = this.execute(trigger, mode, existingConnection).finally(() => {
      if (this.currentRun === promise) this.currentRun = null;
    });
    this.currentRun = promise;
    return promise;
  }

  private async execute(
    trigger: SyncTrigger,
    mode: SyncMode,
    existingConnection?: ImapConnection,
  ): Promise<SyncResult> {
    const runId = this.repository.createSyncRun(trigger, mode, this.accountKey);
    const counters: SyncCounters = { scanned: 0, inserted: 0, updated: 0, classified: 0, failed: 0 };
    const ownerId = randomUUID();
    const ttlMs = this.config.SYNC_LOCK_TTL_SECONDS * 1_000;
    if (!this.repository.acquireSyncLock(this.accountKey, ownerId, ttlMs)) {
      this.repository.finishSyncRun(runId, "skipped", counters, "A sync is already running");
      return { runId, status: "skipped", ...counters };
    }

    const connection = existingConnection ?? this.connectionFactory();
    let ownsConnection = existingConnection === undefined;
    try {
      if (ownsConnection) await connection.connect();
      await connection.withReadOnlyMailbox(async (mailbox) => {
        const snapshot = mailbox.snapshot;
        const localMailbox = this.repository.upsertMailbox({
          accountKey: this.accountKey,
          path: snapshot.path,
          uidValidity: snapshot.uidValidity,
          highestModseq: snapshot.highestModseq,
        });

        if (localMailbox.highestModseq && snapshot.highestModseq) {
          try {
            const changes = await mailbox.fetchChangedFlags(localMailbox.highestModseq);
            for (const change of changes) {
              this.repository.updateFlags(
                localMailbox.id,
                snapshot.uidValidity,
                change.uid,
                change.flags,
                change.labels,
              );
            }
          } catch (error) {
            this.logger.debug(
              { err: safeImapErrorMessage(error, [this.config.MAIL_AUTH_CODE]) },
              "incremental flag refresh unavailable",
            );
          }
        } else if (
          localMailbox.highestUid > 0 &&
          (!localMailbox.lastFlagRefreshAt ||
            Date.now() - localMailbox.lastFlagRefreshAt.getTime() >=
              this.config.SYNC_FULL_FLAG_REFRESH_SECONDS * 1_000)
        ) {
          const changes = await mailbox.fetchAllFlags(this.config.SYNC_PAGE_SIZE);
          for (const change of changes) {
            this.repository.updateFlags(
              localMailbox.id,
              snapshot.uidValidity,
              change.uid,
              change.flags,
              change.labels,
            );
          }
          this.repository.completeFlagRefresh(localMailbox.id);
        }

        // Some providers (notably QQ Mail) expose historical messages gradually
        // after IMAP is enabled. Those messages can have UIDs below the highest
        // UID seen during the first sync, so a plain `highestUid + 1:*` cursor
        // would skip them forever. SEARCH ALL is metadata-only; only missing UIDs
        // are fetched and classified below.
        const serverUids = await mailbox.searchNewUids(0);
        const storedUids = new Set(
          this.repository.listStoredUids(localMailbox.id, snapshot.uidValidity),
        );
        const newUids = serverUids.filter((uid) => !storedUids.has(uid));
        let pageHighest = localMailbox.highestUid;
        for (const page of chunkUids(newUids, this.config.SYNC_PAGE_SIZE)) {
          const messages = await mailbox.fetchMetadata(page);
          for (const message of messages) {
            counters.scanned += 1;
            const stored = this.repository.upsertEmail(localMailbox.id, snapshot.uidValidity, message);
            if (stored.inserted) counters.inserted += 1;
            else counters.updated += 1;
            if (stored.needsClassification && this.classificationWorker) {
              try {
                if (await this.classificationWorker.classifyEmail(stored.id, mailbox)) counters.classified += 1;
              } catch (error) {
                counters.failed += 1;
                this.repository.recordSyncFailure(
                  runId,
                  "classification",
                  safeImapErrorMessage(error, [this.config.MAIL_AUTH_CODE]),
                  { emailId: stored.id },
                );
              }
            }
            pageHighest = Math.max(pageHighest, message.uid);
          }
          this.repository.completeMailboxPage(localMailbox.id, pageHighest, snapshot.highestModseq);
          this.repository.renewSyncLock(this.accountKey, ownerId, ttlMs);
        }
        if (newUids.length === 0) {
          this.repository.completeMailboxPage(localMailbox.id, pageHighest, snapshot.highestModseq);
        }
        if (localMailbox.highestUid === 0) this.repository.completeFlagRefresh(localMailbox.id);
      });
      this.repository.finishSyncRun(runId, "success", counters);
      this.logger.info({ runId, accountKey: this.accountKey.slice(0, 12), ...counters, dryRun: this.config.DRY_RUN }, "read-only IMAP sync completed");
      return { runId, status: "success", ...counters };
    } catch (error) {
      counters.failed += 1;
      const message = safeImapErrorMessage(error, [this.config.MAIL_AUTH_CODE]);
      this.repository.recordSyncFailure(runId, "imap-sync", message);
      this.repository.finishSyncRun(runId, "failed", counters, message);
      this.logger.error({ runId, err: message }, "read-only IMAP sync failed");
      return { runId, status: "failed", ...counters };
    } finally {
      this.repository.releaseSyncLock(this.accountKey, ownerId);
      if (ownsConnection) await connection.close();
      ownsConnection = false;
    }
  }
}
