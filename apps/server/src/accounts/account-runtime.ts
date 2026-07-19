import type { AccountDto } from "@mail-ai/shared";

import type { DiscoveryRepository } from "../db/discovery-repository.js";
import type { BackfillService } from "../services/backfill-service.js";
import type { DiscoveryService } from "../services/discovery-service.js";
import type { ReclassificationService } from "../services/reclassification-service.js";
import type { SyncCoordinator } from "../sync/coordinator.js";
import type { RegisteredMailAccount } from "./account-registry.js";

export interface AccountRuntimeContext {
  account: RegisteredMailAccount;
  coordinator: SyncCoordinator;
  discoveryRepository: DiscoveryRepository;
  discoveryService: DiscoveryService;
  reclassificationService: ReclassificationService;
  backfillService: BackfillService;
}

export class AccountRuntimeManager {
  private readonly byId = new Map<string, AccountRuntimeContext>();
  private readonly byKey = new Map<string, AccountRuntimeContext>();

  public constructor(
    contexts: AccountRuntimeContext[],
    private readonly accounts: AccountDto[],
  ) {
    for (const context of contexts) {
      this.byId.set(context.account.config.id, context);
      this.byKey.set(context.account.accountKey, context);
    }
  }

  public listAccounts(): AccountDto[] {
    return this.accounts;
  }

  public default(): AccountRuntimeContext {
    const account = this.accounts.find((item) => item.isDefault);
    if (!account) throw new Error("No default mail account is configured");
    return this.requireById(account.id);
  }

  public requireById(id?: string): AccountRuntimeContext {
    if (!id) return this.default();
    const context = this.byId.get(id);
    if (!context) throw new Error("Unknown mail account");
    return context;
  }

  public requireByKey(accountKey: string): AccountRuntimeContext {
    const context = this.byKey.get(accountKey);
    if (!context) throw new Error("Email belongs to an unconfigured mail account");
    return context;
  }

  public start(): void {
    for (const context of this.byId.values()) {
      context.coordinator.start();
      context.backfillService.resumePending();
    }
  }

  public async stop(): Promise<void> {
    await Promise.all([...this.byId.values()].map((context) => context.coordinator.stop()));
  }
}
