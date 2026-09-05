import { promises as fs, watchFile } from 'node:fs';
import path from 'node:path';
import { dataDir } from '../paths.js';
import * as selectors from './selectors.js';
import type { Account, Store } from './types.js';

export const SESSION_HEADER = 'x-opencode-codex-session-id';

export type Scope = 'all' | 'session-and-new' | 'session';

export interface SelectionState {
  version: 1;
  sessions: Record<string, string>;
}

const EMPTY: SelectionState = { version: 1, sessions: {} };
const WATCH_INTERVAL_MS = 1000;

let cached: SelectionState | undefined;
let writeQueue: Promise<void> = Promise.resolve();
let lastWrittenMtimeMs: number | undefined;
let watcherStarted = false;
const listeners = new Set<() => void>();

function file(): string {
  return path.join(dataDir(), 'selection.json');
}

function clone(state: SelectionState): SelectionState {
  return structuredClone(state);
}

export function normalize(value: unknown): SelectionState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return clone(EMPTY);
  }
  const sessions = (value as { sessions?: unknown }).sessions;
  if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)) {
    return clone(EMPTY);
  }
  return {
    version: 1,
    sessions: Object.fromEntries(
      Object.entries(sessions).filter(
        (entry): entry is [string, string] =>
          entry[0].length > 0 &&
          typeof entry[1] === 'string' &&
          entry[1].length > 0,
      ),
    ),
  };
}

async function read(): Promise<SelectionState> {
  try {
    return normalize(JSON.parse(await fs.readFile(file(), 'utf8')));
  } catch {
    return clone(EMPTY);
  }
}

async function write(state: SelectionState): Promise<number | undefined> {
  const target = file();
  await fs.mkdir(path.dirname(target), { recursive: true });
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  await fs.rename(tmp, target);
  try {
    return (await fs.stat(target)).mtimeMs;
  } catch {
    return undefined;
  }
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener();
    } catch {}
  }
}

function startWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;
  const watcher = watchFile(
    file(),
    { interval: WATCH_INTERVAL_MS },
    (current) => {
      if (current.mtimeMs === 0) return;
      if (current.mtimeMs === lastWrittenMtimeMs) return;
      lastWrittenMtimeMs = current.mtimeMs;
      void read().then((fresh) => {
        cached = fresh;
        notify();
      });
    },
  );
  watcher.unref();
}

export async function load(): Promise<SelectionState> {
  if (!cached) cached = await read();
  startWatcher();
  return clone(cached);
}

export function snapshot(): SelectionState {
  return clone(cached ?? EMPTY);
}

async function mutate(
  update: (state: SelectionState) => boolean,
): Promise<SelectionState> {
  let result = snapshot();
  const operation = writeQueue.catch(() => undefined).then(async () => {
    const next = await read();
    if (!update(next)) {
      cached = next;
      result = clone(next);
      return;
    }
    lastWrittenMtimeMs = (await write(next)) ?? lastWrittenMtimeMs;
    cached = next;
    result = clone(next);
    notify();
  });
  writeQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  await operation;
  return result;
}

export function applyScope(
  state: SelectionState,
  accountID: string,
  scope: Scope,
  sessionID?: string,
): SelectionState {
  const next = clone(state);
  if (scope === 'all') {
    for (const id of Object.keys(next.sessions)) {
      next.sessions[id] = accountID;
    }
  }
  if (sessionID) next.sessions[sessionID] = accountID;
  return next;
}

export function changesDefault(scope: Scope): boolean {
  return scope !== 'session';
}

export async function select(
  accountID: string,
  options: { scope: Scope; sessionID?: string },
): Promise<SelectionState> {
  return mutate((state) => {
    const next = applyScope(
      state,
      accountID,
      options.scope,
      options.sessionID,
    );
    if (JSON.stringify(next.sessions) === JSON.stringify(state.sessions)) {
      return false;
    }
    state.sessions = next.sessions;
    return true;
  });
}

export async function seedSessions(
  sessionIDs: Iterable<string>,
  accountID: string | undefined,
): Promise<SelectionState> {
  if (!accountID) return load();
  return mutate((state) => {
    let changed = false;
    for (const sessionID of sessionIDs) {
      if (!sessionID || state.sessions[sessionID]) continue;
      state.sessions[sessionID] = accountID;
      changed = true;
    }
    return changed;
  });
}

export async function ensureSession(
  sessionID: string,
  accountID: string | undefined,
): Promise<SelectionState> {
  return seedSessions([sessionID], accountID);
}

export async function forgetSession(
  sessionID: string,
): Promise<SelectionState> {
  return mutate((state) => {
    if (!state.sessions[sessionID]) return false;
    delete state.sessions[sessionID];
    return true;
  });
}

export function resolveID(
  state: SelectionState,
  sessionID: string | undefined,
  fallbackID?: string,
): string | undefined {
  return (sessionID ? state.sessions[sessionID] : undefined) ?? fallbackID;
}

export function id(sessionID?: string): string | undefined {
  return resolveID(snapshot(), sessionID);
}

export function active(store: Store, sessionID?: string): Account | undefined {
  const selectedID = resolveID(snapshot(), sessionID, store.active);
  if (selectedID) {
    const found = selectors.find(store, selectedID);
    if (found) return found;
  }
  return selectors.active(store);
}

export function pick(
  store: Store,
  options: selectors.PickOptions & { sessionID?: string } = {},
): Account | undefined {
  const now = options.now ?? Date.now();
  const exclude = options.exclude;
  const isEligible = (account: Account) =>
    !exclude?.has(account.id) &&
    (!account.rateLimitUntilMs || account.rateLimitUntilMs <= now);
  const head = active(store, options.sessionID);
  if (head && isEligible(head)) return head;
  const fallback = store.accounts.find(isEligible);
  if (fallback) return fallback;
  if (head && !exclude?.has(head.id)) return head;
  return store.accounts.find((account) => !exclude?.has(account.id)) ?? head;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
