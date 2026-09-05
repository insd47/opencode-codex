import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import * as accounts from '../accounts/index.js';
import * as selection from '../accounts/selection.js';
import type { Account } from '../accounts/types.js';
import * as usage from '../codex/usage.js';

const INTERVAL_MS = 5 * 60_000;
export const EVENT_REFRESH_COOLDOWN_MS = 10_000;
const MAX_REMEMBERED_MESSAGES = 1_000;

async function all(): Promise<void> {
  const store = await accounts.load();
  await Promise.all(
    store.accounts.map((a) => usage.fetch(a).catch(() => undefined)),
  );
}

export async function activeNow(sessionID?: string): Promise<void> {
  const a = selection.active(await accounts.load(), sessionID);
  if (a) await usage.fetch(a).catch(() => undefined);
}

export function shouldRefresh(
  account: Account,
  now = Date.now(),
  maxAgeMs = EVENT_REFRESH_COOLDOWN_MS,
): boolean {
  const fetchedAt = account.usage?.fetchedAt;
  return (
    fetchedAt == null ||
    !Number.isFinite(fetchedAt) ||
    now - fetchedAt >= maxAgeMs
  );
}

async function activeIfStale(sessionID?: string): Promise<void> {
  const a = selection.active(await accounts.load(), sessionID);
  if (a && shouldRefresh(a)) {
    await usage.fetch(a).catch(() => undefined);
  }
}

export function start(api: TuiPluginApi): void {
  void all();
  const interval = setInterval(() => void all(), INTERVAL_MS);

  const seenUserMessages = new Set<string>();
  const offCreated = api.event.on('session.created', (event) => {
    void activeIfStale(event.properties.info.id);
  });
  const offMessage = api.event.on('message.updated', (event) => {
    const message = event.properties.info;
    if (message.role !== 'user' || seenUserMessages.has(message.id)) return;
    seenUserMessages.add(message.id);
    if (seenUserMessages.size > MAX_REMEMBERED_MESSAGES) {
      const oldest = seenUserMessages.values().next().value;
      if (oldest) seenUserMessages.delete(oldest);
    }
    void activeIfStale(message.sessionID);
  });
  const offIdle = api.event.on('session.idle', (event) => {
    void activeNow(event.properties.sessionID);
  });

  api.lifecycle.onDispose(() => {
    clearInterval(interval);
    offCreated();
    offMessage();
    offIdle();
  });
}
