/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import * as accounts from '../accounts/index.js';
import type { Account } from '../accounts/types.js';
import * as quota from '../quota/index.js';

const STORAGE_KEY = 'quota-plan-multipliers';

function keyFor(account: Account): string {
  return account.email ?? account.id;
}

function accountName(account: Account): string {
  return account.email ?? account.label ?? account.id;
}

function removeAccountOverrides(
  values: Record<string, number>,
  account: Account,
): void {
  for (const key of [
    account.email,
    account.label,
    account.id,
    `id:${account.id}`,
    account.label ? `label:${account.label}` : undefined,
  ]) {
    if (key) delete values[key];
  }
}

export function initializeQuotaPlans(api: TuiPluginApi): void {
  quota.configureMultiplierOverrides(api.kv.get(STORAGE_KEY, {}));
}

function showPlanChoices(api: TuiPluginApi, account: Account): void {
  const current = quota.multiplier(account);
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title={`Quota plan · ${accountName(account)}`}
      current={current}
      skipFilter
      options={[
        {
          title: 'Pro 5x',
          value: 5,
          description: 'Default Pro capacity',
        },
        {
          title: 'Pro 20x',
          value: 20,
          description: 'Four times the Pro 5x capacity',
        },
      ]}
      onSelect={(option) => {
        const values = { ...quota.multiplierOverrides() };
        removeAccountOverrides(values, account);
        if (option.value === 20) values[keyFor(account)] = 20;
        api.kv.set(STORAGE_KEY, values);
        quota.configureMultiplierOverrides(values);
        api.ui.dialog.clear();
        api.ui.toast({
          variant: 'success',
          title: 'Codex quota plan',
          message: `${accountName(account)} · Pro ${option.value}x`,
        });
      }}
    />
  ));
}

export function showQuotaPlans(api: TuiPluginApi): void {
  void accounts.load().then((store) => {
    const proAccounts = store.accounts.filter((account) =>
      account.usage?.planType?.toLowerCase().includes('pro'),
    );
    if (proAccounts.length === 0) {
      api.ui.dialog.replace(() => (
        <api.ui.DialogAlert
          title="Codex quota plan"
          message="No Pro account has fetched usage yet. Wait for quota data to refresh, then try again."
          onConfirm={() => api.ui.dialog.clear()}
        />
      ));
      return;
    }
    api.ui.dialog.replace(() => (
      <api.ui.DialogSelect
        title="Choose a Pro account"
        options={proAccounts.map((account) => ({
          title: accountName(account),
          value: account,
          description: `${quota.plan(account)} · ${
            quota.multiplierOverrides()[keyFor(account)] ? 'configured' : 'default'
          }`,
        }))}
        onSelect={(option) => showPlanChoices(api, option.value)}
      />
    ));
  });
}
