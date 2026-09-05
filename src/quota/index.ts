import type { Account } from '../accounts/index.js';

export type QuotaMultiplierOverrides = Readonly<Record<string, number>>;

let configuredOverrides: QuotaMultiplierOverrides = {};
const overrideListeners = new Set<() => void>();

/**
 * Build a progress bar split into filled/empty halves. The caller renders
 * them with different fg colors to produce a two-tone bar.
 */
export function bar(
  percentRemaining: number,
  width: number,
): { filled: string; empty: string } {
  const p = Math.max(0, Math.min(100, Math.round(percentRemaining)));
  const filled = Math.round((p / 100) * width);
  return { filled: '━'.repeat(filled), empty: '━'.repeat(width - filled) };
}

/** Short label for a window — "5h" for the 5-hour primary, "weekly" for the secondary. */
export function label(minutes: number): string {
  if (minutes <= 60 * 12) return `${Math.round(minutes / 60)}h`;
  return 'weekly';
}

/** Human countdown to a reset time ("3h", "5d", "47m", "reset"). */
export function countdown(resetAtMs: number, now = Date.now()): string {
  const diffMs = resetAtMs - now;
  if (!Number.isFinite(diffMs) || diffMs <= 0) return 'reset';
  const minutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  return `${minutes % 60}m`;
}

/** Convert a raw `used_percent` (0-100) into clamped "left percent". */
export function left(usedPercent: number | undefined): number | undefined {
  if (typeof usedPercent !== 'number') return undefined;
  return Math.max(0, Math.min(100, 100 - usedPercent));
}

/** Keep only supported Pro quota multipliers. */
export function normalizeMultiplierOverrides(
  value: unknown,
): QuotaMultiplierOverrides {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        entry[1] === 5 || entry[1] === 20,
    ),
  );
}

export function multiplierOverrides(): QuotaMultiplierOverrides {
  return configuredOverrides;
}

export function configureMultiplierOverrides(value: unknown): void {
  const next = normalizeMultiplierOverrides(value);
  const previousEntries = Object.entries(configuredOverrides);
  const nextEntries = Object.entries(next);
  const unchanged =
    previousEntries.length === nextEntries.length &&
    nextEntries.every(([key, weight]) => configuredOverrides[key] === weight);
  if (unchanged) return;
  configuredOverrides = next;
  for (const listener of overrideListeners) {
    try {
      listener();
    } catch {}
  }
}

export function subscribeMultiplierOverrides(listener: () => void): () => void {
  overrideListeners.add(listener);
  return () => overrideListeners.delete(listener);
}

/** Infer a capacity multiplier from the raw plan name. */
export function planMultiplier(planType: string | undefined): number | undefined {
  if (!planType) return undefined;
  const compact = planType.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (compact.includes('pro20x') || compact.includes('20xpro')) return 20;
  if (compact.includes('pro5x') || compact.includes('5xpro')) return 5;
  if (compact.includes('pro')) return 5;
  if (compact.includes('plus')) return 1;
  return undefined;
}

/**
 * Resolve an account's effective quota capacity. Email addresses can be used
 * directly as override keys; `id:` and `label:` are also supported. Bare Pro
 * values default to 5x because that is the minimum Pro tier; unknown plans
 * fall back to 1x.
 */
export function multiplier(
  account: Account,
  overrides: QuotaMultiplierOverrides = configuredOverrides,
): number {
  const planType = account.usage?.planType;
  const isPro = planType?.toLowerCase().includes('pro') ?? false;
  const keys = [
    account.email,
    account.label,
    account.id,
    `id:${account.id}`,
    account.label ? `label:${account.label}` : undefined,
  ];
  if (isPro) {
    for (const key of keys) {
      if (!key) continue;
      const value = overrides[key];
      if (value === 5 || value === 20) return value;
    }
  }
  return planMultiplier(planType) ?? 1;
}

/**
 * Aggregate windows across multiple accounts into capacity-weighted
 * left-percent per window size. Skips accounts that haven't been fetched yet.
 */
export function aggregate(
  accounts: Account[],
  overrides: QuotaMultiplierOverrides = configuredOverrides,
): Array<{ windowMinutes: number; remaining: number }> {
  const byMinutes = new Map<
    number,
    { weightedLeft: number; totalWeight: number }
  >();
  for (const account of accounts) {
    const weight = multiplier(account, overrides);
    for (const w of account.usage?.windows ?? []) {
      const remaining = left(w.usedPercent);
      if (remaining == null) continue;
      const entry = byMinutes.get(w.windowMinutes) ?? {
        weightedLeft: 0,
        totalWeight: 0,
      };
      entry.weightedLeft += remaining * weight;
      entry.totalWeight += weight;
      byMinutes.set(w.windowMinutes, entry);
    }
  }
  return [...byMinutes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([windowMinutes, entry]) => ({
      windowMinutes,
      remaining: entry.weightedLeft / entry.totalWeight,
    }));
}

/** Friendly plan name. Returns undefined when no usage has been fetched. */
export function plan(account: Account | undefined): string | undefined {
  const raw = account?.usage?.planType;
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes('pro')) {
    const weight = multiplier(account);
    return weight === 5 || weight === 20 ? `Pro ${weight}x` : 'Pro';
  }
  if (lower.includes('plus')) return 'Plus';
  return raw;
}
