import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import * as accounts from '../accounts/index.js';
import * as selection from '../accounts/selection.js';
import * as usage from '../codex/usage.js';

const INTERVAL_MS = 5 * 60_000;
const IDLE_DEBOUNCE_MS = 30_000;

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

export function start(api: TuiPluginApi): void {
  void all();
  const interval = setInterval(() => void all(), INTERVAL_MS);
  let lastIdle = 0;
  const off = api.event.on('session.idle', (event) => {
    const now = Date.now();
    if (now - lastIdle < IDLE_DEBOUNCE_MS) return;
    lastIdle = now;
    void activeNow(event.properties.sessionID);
  });
  api.lifecycle.onDispose(() => {
    clearInterval(interval);
    off();
  });
}
