/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import * as accounts from '../accounts/index.js';
import * as selection from '../accounts/selection.js';
import type { Account } from '../accounts/types.js';
import * as quota from '../quota/index.js';
import { activeNow } from './refresh.js';

function accountName(account: Account): string {
  return account.label || account.email || account.id;
}

function showScope(
  api: TuiPluginApi,
  account: Account,
  sessionID?: string,
): void {
  const options: Array<{
    title: string;
    value: selection.Scope;
    description: string;
  }> = [
    {
      title: 'All sessions',
      value: 'all',
      description: 'Switch existing sessions and use for new sessions.',
    },
    ...(sessionID
      ? [
          {
            title: 'This session + new sessions',
            value: 'session-and-new' as const,
            description: 'Keep other existing sessions unchanged.',
          },
          {
            title: 'This session only',
            value: 'session' as const,
            description: 'Keep other sessions and the default unchanged.',
          },
        ]
      : [
          {
            title: 'New sessions only',
            value: 'session-and-new' as const,
            description: 'Keep existing sessions unchanged.',
          },
        ]),
  ];

  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title={`Apply ${accountName(account)} to`}
      current="all"
      options={options}
      onSelect={async (option) => {
        const scope = option.value as selection.Scope;
        if (selection.changesDefault(scope)) {
          const listed = await api.client.session.list().catch(() => undefined);
          await selection.seedSessions(
            listed?.data?.map((session) => session.id) ?? [],
            accounts.active()?.id,
          );
        }
        await selection.select(account.id, { scope, sessionID });
        if (selection.changesDefault(scope)) {
          await accounts.activate(account.id);
        }
        void activeNow(sessionID);
        api.ui.dialog.clear();
        const target =
          scope === 'all'
            ? 'all sessions'
            : scope === 'session-and-new'
              ? sessionID
                ? 'this session and new sessions'
                : 'new sessions'
              : 'this session';
        api.ui.toast({
          variant: 'success',
          message: `${accountName(account)} applied to ${target}.`,
        });
      }}
    />
  ));
}

export function showAccounts(api: TuiPluginApi, sessionID?: string): void {
  const dialog = api.ui.dialog;
  void accounts.load().then((store) => {
    if (store.accounts.length === 0) {
      dialog.replace(() => (
        <api.ui.DialogAlert
          title="Codex accounts"
          message="No accounts yet. Use /connect → openai to add one."
          onConfirm={() => dialog.clear()}
        />
      ));
      return;
    }
    const activeId = selection.active(store, sessionID)?.id;
    dialog.replace(() => (
      <api.ui.DialogSelect
        title="Switch Codex account"
        current={activeId}
        options={store.accounts.map((account) => {
          const status: string[] = [];
          const plan = quota.plan(account);
          if (plan) status.push(`(${plan})`);
          const window5h = account.usage?.windows.find(
            (w) => w.windowMinutes <= 600,
          );
          if (window5h) {
            const left = quota.left(window5h.usedPercent);
            if (left != null) status.push(`5h ${Math.round(left)}%`);
          }
          return {
            title: accountName(account),
            value: account.id,
            description: status.join(' · ') || undefined,
          };
        })}
        onSelect={async (option) => {
          if (typeof option.value !== 'string') return;
          const account = store.accounts.find((item) => item.id === option.value);
          if (account) showScope(api, account, sessionID);
        }}
      />
    ));
  });
}
