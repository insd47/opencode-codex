import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregate,
  configureMultiplierOverrides,
  multiplier,
  multiplierOverrides,
  normalizeMultiplierOverrides,
  plan,
  planMultiplier,
  subscribeMultiplierOverrides,
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

test('defaults ambiguous Pro to 5x and unknown plans to 1x', () => {
  const ambiguous = account({ id: 'pro', planType: 'pro', windows: [] });
  const unknown = account({ id: 'unknown', planType: 'enterprise', windows: [] });
  assert.equal(multiplier(ambiguous, {}), 5);
  assert.equal(multiplier(unknown, {}), 1);
  assert.equal(planMultiplier('Pro 5x'), 5);
  assert.equal(planMultiplier('20x-pro'), 20);
});

test('shows configured Pro tiers in account status labels', () => {
  const pro = account({
    id: 'pro',
    email: 'pro@example.com',
    planType: 'pro',
    windows: [],
  });
  configureMultiplierOverrides({});
  assert.equal(plan(pro), 'Pro 5x');
  configureMultiplierOverrides({ 'pro@example.com': 20 });
  try {
    assert.equal(plan(pro), 'Pro 20x');
  } finally {
    configureMultiplierOverrides({});
  }
});

test('ignores invalid multiplier configuration entries', () => {
  assert.deepEqual(
    normalizeMultiplierOverrides({
      'id:a': 5,
      'id:b': 0,
      'id:c': '20',
      'id:d': 7,
    }),
    { 'id:a': 5 },
  );
  assert.deepEqual(normalizeMultiplierOverrides('not-an-object'), {});
});

test('ignores stale Pro overrides when an account is Plus', () => {
  const plus = account({
    id: 'plus',
    email: 'same@example.com',
    planType: 'plus',
    windows: [],
  });
  assert.equal(multiplier(plus, { 'same@example.com': 20 }), 1);
});

test('notifies subscribers when stored overrides change', () => {
  let notifications = 0;
  const unsubscribe = subscribeMultiplierOverrides(() => notifications++);
  try {
    configureMultiplierOverrides({ 'pro@example.com': 20 });
    assert.deepEqual(multiplierOverrides(), { 'pro@example.com': 20 });
    assert.equal(notifications, 1);
    configureMultiplierOverrides({ 'pro@example.com': 20 });
    assert.equal(notifications, 1);
  } finally {
    unsubscribe();
    configureMultiplierOverrides({});
  }
});
