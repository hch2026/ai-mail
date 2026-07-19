const ACTIVE_ACCOUNT_QUERY_PARAM = "account";

export function loadActiveAccountId(): string | undefined {
  return new URL(window.location.href).searchParams.get(ACTIVE_ACCOUNT_QUERY_PARAM) ?? undefined;
}

export function saveActiveAccountId(accountId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set(ACTIVE_ACCOUNT_QUERY_PARAM, accountId);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
