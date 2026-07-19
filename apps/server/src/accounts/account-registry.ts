import type { AccountDto } from "@mail-ai/shared";

import type { AppConfig, MailAccountConfig } from "../config/env.js";
import { configForMailAccount, configuredMailAccounts } from "../config/env.js";
import { accountKeyFor } from "../sync/sync-service.js";

export interface RegisteredMailAccount {
  accountKey: string;
  config: MailAccountConfig;
  appConfig: AppConfig;
}

export class AccountRegistry {
  private readonly byId = new Map<string, RegisteredMailAccount>();
  private readonly byKey = new Map<string, RegisteredMailAccount>();

  public constructor(config: AppConfig) {
    for (const account of configuredMailAccounts(config)) {
      const registered = {
        accountKey: accountKeyFor(account.email),
        config: account,
        appConfig: configForMailAccount(config, account),
      };
      this.byId.set(account.id, registered);
      this.byKey.set(registered.accountKey, registered);
    }
  }

  public all(): RegisteredMailAccount[] {
    return [...this.byId.values()];
  }

  public default(): RegisteredMailAccount {
    const account = this.byId.get("163") ?? this.all()[0];
    if (!account) throw new Error("No mail account is configured");
    return account;
  }

  public requireById(id?: string): RegisteredMailAccount {
    if (!id) return this.default();
    const account = this.byId.get(id);
    if (!account) throw new Error("Unknown mail account");
    return account;
  }

  public requireByKey(accountKey: string): RegisteredMailAccount {
    const account = this.byKey.get(accountKey);
    if (!account) throw new Error("Email belongs to an unconfigured mail account");
    return account;
  }

  public listDtos(): AccountDto[] {
    const defaultId = this.default().config.id;
    return this.all().map(({ config }) => ({
      id: config.id,
      provider: config.provider,
      displayName: config.displayName,
      writeEnabled: config.writeEnabled,
      isDefault: config.id === defaultId,
    }));
  }
}
