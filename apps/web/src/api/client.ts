import type {
  AccountDto,
  DashboardDto,
  BulkDeleteResultDto,
  DiscoveryReportDto,
  EmailContentDto,
  EmailDetailDto,
  EmailQuery,
  LabelDto,
  ManualClassificationPatch,
  PaginatedEmailsDto,
  TaxonomyLabel,
  TaxonomyStatusDto,
} from "@mail-ai/shared";

export interface SyncRunDto {
  id: number;
  trigger: string;
  mode: string;
  status: string;
  scanned: number;
  inserted: number;
  updated: number;
  classified: number;
  failed: number;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface SyncFailureDto {
  id: number;
  syncRunId: number | null;
  emailId: number | null;
  stage: string;
  errorCode: string | null;
  message: string;
  retryable: boolean;
  createdAt: string;
}

export interface SyncStatusDto {
  running: boolean;
  mode: "idle" | "poll";
  dryRun: boolean;
  consecutiveFailures: number;
  nextAttemptAt: string | null;
  recentRuns: SyncRunDto[];
  failures: SyncFailureDto[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(path, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error ?? `请求失败 (${response.status})`);
  }
  return (await response.json()) as T;
}

function queryString(input: Partial<EmailQuery>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

function accountQuery(accountId?: string): string {
  return accountId ? `?accountId=${encodeURIComponent(accountId)}` : "";
}

export const api = {
  accounts: () => request<AccountDto[]>("/api/accounts"),
  dashboard: (accountId?: string) => request<DashboardDto>(`/api/dashboard${accountQuery(accountId)}`),
  labels: (accountId?: string) => request<LabelDto[]>(`/api/labels${accountQuery(accountId)}`),
  emails: (query: Partial<EmailQuery>) => request<PaginatedEmailsDto>(`/api/emails${queryString(query)}`),
  reviews: (query: Partial<EmailQuery>) => request<PaginatedEmailsDto>(`/api/reviews${queryString(query)}`),
  email: (id: number) => request<EmailDetailDto>(`/api/emails/${id}`),
  emailContent: (id: number) => request<EmailContentDto>(`/api/emails/${id}/content`, { method: "POST" }),
  attachmentUrl: (emailId: number, attachmentIndex: number, inline = false) =>
    `/api/emails/${emailId}/attachments/${attachmentIndex}${inline ? "?inline=true" : ""}`,
  reclassify: (id: number) => request<EmailDetailDto>(`/api/emails/${id}/reclassify`, { method: "POST" }),
  patchClassification: (id: number, patch: ManualClassificationPatch) =>
    request<EmailDetailDto>(`/api/emails/${id}/classification`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  confirmReviews: (emailIds: number[]) =>
    request<{ confirmed: number }>("/api/reviews/confirm", {
      method: "POST",
      body: JSON.stringify({ emailIds }),
    }),
  bulkDelete: (emailIds: number[]) =>
    request<BulkDeleteResultDto>("/api/emails/bulk-delete", {
      method: "POST",
      body: JSON.stringify({ emailIds }),
    }),
  sync: (accountId?: string) => request(`/api/sync${accountQuery(accountId)}`, { method: "POST" }),
  syncStatus: (accountId?: string) => request<SyncStatusDto>(`/api/sync/status${accountQuery(accountId)}`),
  discoveryReport: (accountId?: string) => request<DiscoveryReportDto>(`/api/discovery/report${accountQuery(accountId)}`),
  analyzeDiscovery: (accountId?: string) => request<DiscoveryReportDto>(`/api/discovery/analyze${accountQuery(accountId)}`, { method: "POST" }),
  taxonomyStatus: (accountId?: string) => request<TaxonomyStatusDto>(`/api/taxonomy/status${accountQuery(accountId)}`),
  confirmTaxonomy: (reportId: number, labels: TaxonomyLabel[], accountId?: string) =>
    request<{ taxonomyVersionId: number; backfillStarted: boolean }>(`/api/taxonomy/confirm${accountQuery(accountId)}`, {
      method: "POST",
      body: JSON.stringify({ reportId, labels }),
    }),
  retryBackfill: (accountId?: string) => request<{ taxonomyVersionId: number; backfillStarted: boolean }>(
    `/api/taxonomy/backfill/retry${accountQuery(accountId)}`,
    { method: "POST" },
  ),
};
