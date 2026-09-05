/** @jsxImportSource @opentui/solid */
import type { TuiPlugin } from '@opencode-ai/plugin/tui';
import { showAccounts } from './dialog';
import { PromptStatus } from './prompt';
import { initializeQuotaPlans, showQuotaPlans } from './quota-plan';
import { start as startRefresh } from './refresh.js';
import { Sidebar } from './sidebar';

export const tui: TuiPlugin = async (api) => {
  initializeQuotaPlans(api);

  api.slots.register({
    order: 250,
    slots: {
      session_prompt_right: () => <PromptStatus api={api} />,
      sidebar_content: () => <Sidebar api={api} />,
    },
  });

  api.keymap.registerLayer({
    commands: [
      {
        namespace: 'palette',
        name: 'codex.accounts.switch',
        title: 'Switch Codex account',
        category: 'Codex',
        slashName: 'accounts',
        run() {
          showAccounts(api);
        },
      },
      {
        namespace: 'palette',
        name: 'codex.quota.plan',
        title: 'Configure Codex quota',
        category: 'Codex',
        slashName: 'codex-quota',
        run() {
          showQuotaPlans(api);
        },
      },
    ],
    bindings: [],
  } as Parameters<typeof api.keymap.registerLayer>[0]);

  startRefresh(api);
};

export default {
  id: 'opencode-codex',
  tui,
};
