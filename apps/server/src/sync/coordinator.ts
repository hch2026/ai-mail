import type { Logger } from "pino";

import type { AppConfig } from "../config/env.js";
import type { ImapConnectionFactory } from "../imap/types.js";
import { delay, exponentialBackoffMs } from "./backoff.js";
import { safeImapErrorMessage, type SyncResult, type SyncService } from "./sync-service.js";

export interface SyncStatus {
  running: boolean;
  mode: "idle" | "poll";
  dryRun: boolean;
  consecutiveFailures: number;
  lastResult: SyncResult | null;
  nextAttemptAt: string | null;
}

export class SyncCoordinator {
  private readonly abortController = new AbortController();
  private loopPromise: Promise<void> | null = null;
  private activeConnection: ReturnType<ImapConnectionFactory> | null = null;
  private status: SyncStatus;

  public constructor(
    private readonly config: AppConfig,
    private readonly syncService: SyncService,
    private readonly connectionFactory: ImapConnectionFactory,
    private readonly logger: Logger,
  ) {
    this.status = {
      running: false,
      mode: "idle",
      dryRun: config.DRY_RUN,
      consecutiveFailures: 0,
      lastResult: null,
      nextAttemptAt: null,
    };
  }

  public start(): void {
    if (this.loopPromise) return;
    this.status.running = true;
    this.loopPromise = this.loop().finally(() => {
      this.status.running = false;
      this.loopPromise = null;
    });
  }

  public async stop(): Promise<void> {
    this.abortController.abort();
    await this.activeConnection?.close();
    await this.loopPromise;
  }

  public getStatus(): SyncStatus {
    return { ...this.status };
  }

  public async triggerManual(): Promise<SyncResult> {
    const result = await this.syncService.run("manual", this.status.mode);
    this.status.lastResult = result;
    return result;
  }

  private async loop(): Promise<void> {
    while (!this.abortController.signal.aborted) {
      if (this.status.mode === "poll") {
        const result = await this.syncService.run("poll", "poll");
        this.status.lastResult = result;
        this.status.consecutiveFailures = result.status === "failed" ? this.status.consecutiveFailures + 1 : 0;
        await this.wait(this.config.SYNC_POLL_INTERVAL_SECONDS * 1_000);
        continue;
      }

      const connection = this.connectionFactory();
      this.activeConnection = connection;
      try {
        await connection.connect();
        const trigger = this.status.lastResult ? "idle" : "startup";
        const result = await this.syncService.run(trigger, "idle", connection);
        this.status.lastResult = result;
        if (result.status === "failed") throw new Error("sync failed while connected");
        this.status.consecutiveFailures = 0;

        while (!this.abortController.signal.aborted && this.status.mode === "idle") {
          await connection.waitForChange(4 * 60 * 1000);
          if (this.abortController.signal.aborted) break;
          const idleResult = await this.syncService.run("idle", "idle", connection);
          this.status.lastResult = idleResult;
          if (idleResult.status === "failed") throw new Error("IDLE follow-up sync failed");
        }
      } catch (error) {
        this.status.consecutiveFailures += 1;
        this.logger.warn(
          {
            failures: this.status.consecutiveFailures,
            err: safeImapErrorMessage(error, [this.config.MAIL_AUTH_CODE]),
          },
          "IMAP IDLE connection interrupted",
        );
        if (this.status.consecutiveFailures >= this.config.SYNC_IDLE_FAILURE_THRESHOLD) {
          this.status.mode = "poll";
          this.logger.warn("IMAP IDLE is unstable; falling back to polling");
        } else {
          await this.wait(exponentialBackoffMs(this.status.consecutiveFailures - 1));
        }
      } finally {
        await connection.close();
        if (this.activeConnection === connection) this.activeConnection = null;
      }
    }
  }

  private async wait(ms: number): Promise<void> {
    this.status.nextAttemptAt = new Date(Date.now() + ms).toISOString();
    await delay(ms, this.abortController.signal);
    this.status.nextAttemptAt = null;
  }
}
