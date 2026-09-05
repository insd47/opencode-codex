import assert from 'node:assert/strict';
import test from 'node:test';
import {
  EVENT_REFRESH_COOLDOWN_MS,
  shouldRefresh,
} from '../dist/tui/refresh.js';

function account(fetchedAt) {
  return {
    id: 'account',
    refresh: 'refresh',
    access: 'access',
    expires: 0,
    addedAt: 0,
    usage:
      fetchedAt == null
        ? undefined
        : { fetchedAt, windows: [], planType: 'pro' },
  };
}

test('refreshes accounts with no usage or stale usage', () => {
  const now = 100_000;
  assert.equal(shouldRefresh(account(), now), true);
  assert.equal(
    shouldRefresh(account(now - EVENT_REFRESH_COOLDOWN_MS), now),
    true,
  );
});

test('coalesces nearby lifecycle refresh triggers', () => {
  const now = 100_000;
  assert.equal(shouldRefresh(account(now - 1), now), false);
  assert.equal(shouldRefresh(account(Number.NaN), now), true);
});
