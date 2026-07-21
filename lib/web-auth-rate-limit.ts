export type LoginAttemptStore = {
  failures: number;
  retryAt: number;
  expiresAt: number;
};

const RECORD_TTL_MS = 15 * 60 * 1000;
const MAX_DELAY_SECONDS = 30;

const attempts = new Map<string, LoginAttemptStore>();

function nowMs(now?: number): number {
  return now ?? Date.now();
}

function delaySeconds(failures: number): number {
  return Math.min(MAX_DELAY_SECONDS, 2 ** (failures - 1));
}

function purgeExpired(now: number): void {
  for (const [key, record] of attempts) {
    if (record.expiresAt <= now) attempts.delete(key);
  }
}

export function getLoginRetryAfterSeconds(key: string, now?: number): number {
  const t = nowMs(now);
  purgeExpired(t);
  const record = attempts.get(key);
  if (!record) return 0;
  if (record.retryAt <= t) return 0;
  return Math.min(MAX_DELAY_SECONDS, Math.ceil((record.retryAt - t) / 1000));
}

export function recordLoginFailure(key: string, now?: number): number {
  const t = nowMs(now);
  purgeExpired(t);
  const prev = attempts.get(key);
  const failures = (prev?.failures ?? 0) + 1;
  const delay = delaySeconds(failures);
  attempts.set(key, {
    failures,
    retryAt: t + delay * 1000,
    expiresAt: t + RECORD_TTL_MS,
  });
  return delay;
}

export function clearLoginFailures(key: string): void {
  purgeExpired(nowMs());
  attempts.delete(key);
}

export function resetLoginRateLimitForTests(): void {
  attempts.clear();
}
