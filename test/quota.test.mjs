import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregate,
  multiplier,
  parseMultiplierOverrides,
  planMultiplier,
} from '../dist/quota/index.js';

function account({ id, email, planType, windows }) {
  return {
    id,
    email,
    refresh: 'refresh',
    access: 'access',
    expires: 0,
    addedAt: 0,
    usage: windows
      ? { fetchedAt: 0, planType, windows }
      : undefined,
  };
}

function window(windowMinutes, remaining) {
  return { windowMinutes, usedPercent: 100 - remaining, resetAtMs: 0 };
}

test('weights asymmetric Plus and Pro 20x pools by capacity', () => {
  const plusFull = account({
    id: 'plus',
    planType: 'plus',
    windows: [window(300, 100)],
  });
  const proEmpty = account({
    id: 'pro',
    planType: 'pro-20x',
    windows: [window(300, 0)],
  });
  const plusEmpty = account({
    id: 'plus',
    planType: 'plus',
    windows: [window(300, 0)],
  });
  const proFull = account({
    id: 'pro',
    planType: 'pro-20x',
    windows: [window(300, 100)],
  });

  assert.ok(Math.abs(aggregate([plusFull, proEmpty])[0].remaining - 100 / 21) < 1e-9);
  assert.ok(Math.abs(aggregate([plusEmpty, proFull])[0].remaining - 2000 / 21) < 1e-9);
});

test('supports mixed Pro 5x and Pro 20x accounts through per-account overrides', () => {
  const accounts = [
    account({ id: 'plus', planType: 'plus', windows: [window(300, 100)] }),
    account({
      id: 'pro5',
      email: 'five@example.com',
      planType: 'pro',
      windows: [window(300, 50)],
    }),
    account({
      id: 'pro20',
      email: 'twenty@example.com',
      planType: 'pro',
      windows: [window(300, 0)],
    }),
  ];
  const rows = aggregate(accounts, {
    'five@example.com': 5,
    'id:pro20': 20,
  });

  assert.equal(rows.length, 1);
  assert.ok(Math.abs(rows[0].remaining - 350 / 26) < 1e-9);
});

test('weights each quota window independently and excludes unfetched accounts', () => {
  const rows = aggregate(
    [
      account({
        id: 'plus',
        planType: 'plus',
        windows: [window(300, 100), window(10080, 100)],
      }),
      account({
        id: 'pro',
        planType: 'pro',
        windows: [window(10080, 0)],
      }),
      account({ id: 'unfetched' }),
    ],
    { 'id:pro': 20 },
  );

  assert.deepEqual(rows, [
    { windowMinutes: 300, remaining: 100 },
    { windowMinutes: 10080, remaining: 100 / 21 },
  ]);
});

test('preserves arithmetic means for equal-capacity accounts', () => {
  const rows = aggregate([
    account({ id: 'a', planType: 'plus', windows: [window(300, 10)] }),
    account({ id: 'b', planType: 'plus', windows: [window(300, 30)] }),
  ]);
  assert.equal(rows[0].remaining, 20);
});

test('uses a documented 1x fallback for ambiguous and unknown plans', () => {
  const ambiguous = account({ id: 'pro', planType: 'pro', windows: [] });
  const unknown = account({ id: 'unknown', planType: 'enterprise', windows: [] });
  assert.equal(multiplier(ambiguous, {}), 1);
  assert.equal(multiplier(unknown, {}), 1);
  assert.equal(planMultiplier('Pro 5x'), 5);
  assert.equal(planMultiplier('20x-pro'), 20);
});

test('ignores invalid multiplier configuration entries', () => {
  assert.deepEqual(parseMultiplierOverrides('{"id:a":5,"id:b":0,"id:c":"20"}'), {
    'id:a': 5,
  });
  assert.deepEqual(parseMultiplierOverrides('not-json'), {});
});
