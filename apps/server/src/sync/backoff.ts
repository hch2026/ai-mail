export function exponentialBackoffMs(attempt: number, random = Math.random): number {
  const cappedAttempt = Math.max(0, Math.min(attempt, 8));
  const base = Math.min(1_000 * 2 ** cappedAttempt, 5 * 60 * 1000);
  const jitter = 0.75 + random() * 0.5;
  return Math.round(base * jitter);
}

export function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = (): void => finish();
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
