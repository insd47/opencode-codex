import type { Account } from '../accounts/index.js';

export const QUOTA_MULTIPLIERS_ENV = 'OPENCODE_CODEX_QUOTA_MULTIPLIERS';

export type QuotaMultiplierOverrides = Readonly<Record<string, number>>;

let cachedOverridesRaw: string | undefined;
let cachedOverrides: QuotaMultiplierOverrides = {};

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

/** Parse positive, finite per-account quota multipliers from JSON. */
export function parseMultiplierOverrides(
  raw: string | undefined,
): QuotaMultiplierOverrides {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(
        (entry): entry is [string, number] =>
          typeof entry[1] === 'number' &&
          Number.isFinite(entry[1]) &&
          entry[1] > 0,
      ),
    );
  } catch {
    return {};
  }
}

function configuredMultiplierOverrides(): QuotaMultiplierOverrides {
  const raw = process.env[QUOTA_MULTIPLIERS_ENV];
  if (raw === cachedOverridesRaw) return cachedOverrides;
  cachedOverridesRaw = raw;
  cachedOverrides = parseMultiplierOverrides(raw);
  return cachedOverrides;
}

/** Infer a capacity multiplier only when the raw plan name is unambiguous. */
export function planMultiplier(planType: string | undefined): number | undefined {
  if (!planType) return undefined;
  const compact = planType.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (compact.includes('pro20x') || compact.includes('20xpro')) return 20;
  if (compact.includes('pro5x') || compact.includes('5xpro')) return 5;
  if (compact.includes('plus')) return 1;
  return undefined;
}

/**
 * Resolve an account's effective quota capacity. Email addresses can be used
 * directly as override keys; `id:` and `label:` are also supported. Bare or
 * unknown Pro variants conservatively fall back to 1x because the usage API
 * currently reports both tiers as `pro`.
 */
export function multiplier(
  account: Account,
  overrides: QuotaMultiplierOverrides = configuredMultiplierOverrides(),
): number {
  const keys = [
    account.email,
    account.label,
    account.id,
    `id:${account.id}`,
    account.label ? `label:${account.label}` : undefined,
  ];
  for (const key of keys) {
    if (!key) continue;
    const value = overrides[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return planMultiplier(account.usage?.planType) ?? 1;
}

/**
 * Aggregate windows across multiple accounts into capacity-weighted
 * left-percent per window size. Skips accounts that haven't been fetched yet.
 */
export function aggregate(
  accounts: Account[],
  overrides: QuotaMultiplierOverrides = configuredMultiplierOverrides(),
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
  if (lower.includes('pro')) return 'Pro';
  if (lower.includes('plus')) return 'Plus';
  return raw;
}
