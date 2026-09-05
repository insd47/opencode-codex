import assert from 'node:assert/strict';
import test from 'node:test';
import {
  active,
  applyScope,
  changesDefault,
  normalize,
  pick,
  resolveID,
} from '../dist/accounts/selection.js';

function account(id, rateLimitUntilMs) {
  return {
    id,
    refresh: 'refresh',
    access: 'access',
    expires: 0,
    addedAt: 0,
    rateLimitUntilMs,
  };
}

test('normalizes persisted session selections', () => {
  assert.deepEqual(
    normalize({
      version: 99,
      sessions: { a: 'account-a', b: '', c: 42, '': 'account-d' },
    }),
    { version: 1, sessions: { a: 'account-a' } },
  );
  assert.deepEqual(normalize(null), { version: 1, sessions: {} });
});

test('all sessions updates every known session and the current session', () => {
  const next = applyScope(
    { version: 1, sessions: { a: 'old-a', b: 'old-b' } },
    'next',
    'all',
    'c',
  );
  assert.deepEqual(next.sessions, { a: 'next', b: 'next', c: 'next' });
  assert.equal(changesDefault('all'), true);
});

test('this session plus new sessions leaves other session pins unchanged', () => {
  const next = applyScope(
    { version: 1, sessions: { a: 'old-a', b: 'old-b' } },
    'next',
    'session-and-new',
    'a',
  );
  assert.deepEqual(next.sessions, { a: 'next', b: 'old-b' });
  assert.equal(changesDefault('session-and-new'), true);
});

test('this session only does not change the new-session default', () => {
  const next = applyScope(
    { version: 1, sessions: { a: 'old-a', b: 'old-b' } },
    'next',
    'session',
    'a',
  );
  assert.deepEqual(next.sessions, { a: 'next', b: 'old-b' });
  assert.equal(changesDefault('session'), false);
});

test('resolves a session pin before the account-store default', () => {
  const first = account('first');
  const second = account('second');
  const store = { version: 1, active: 'first', accounts: [first, second] };

  const selections = applyScope(
    { version: 1, sessions: {} },
    'second',
    'session',
    'session-a',
  );
  assert.equal(resolveID(selections, 'session-a', store.active), 'second');
  assert.equal(resolveID(selections, 'unknown', store.active), 'first');
  assert.equal(active(store, 'unknown')?.id, 'first');
  assert.equal(pick(store)?.id, 'first');
});

test('falls back when the preferred account is rate limited', () => {
  const now = 1_000;
  const first = account('first', now + 10_000);
  const second = account('second');
  const store = { version: 1, active: 'first', accounts: [first, second] };
  assert.equal(pick(store, { now })?.id, 'second');
});
