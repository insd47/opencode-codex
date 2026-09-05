/** @jsxImportSource @opentui/solid */
import type { TuiPlugin } from '@opencode-ai/plugin/tui';
import * as accounts from '../accounts/index.js';
import * as selection from '../accounts/selection.js';
import { showAccounts } from './dialog.js';
import { PromptStatus } from './prompt.js';
import { start as startRefresh } from './refresh.js';
import { Sidebar } from './sidebar.js';

export const tui: TuiPlugin = async (api) => {
  await accounts.load();
  await selection.load();

  api.slots.register({
    order: 250,
    slots: {
      session_prompt_right: (_, { session_id }) => (
        <PromptStatus api={api} sessionID={session_id} />
      ),
      sidebar_content: (_, { session_id }) => (
        <Sidebar api={api} sessionID={session_id} />
      ),
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
          const route = api.route.current;
          const params = 'params' in route ? route.params : undefined;
          const sessionID = (params as { sessionID?: unknown } | undefined)
            ?.sessionID;
          showAccounts(
            api,
            typeof sessionID === 'string' ? sessionID : undefined,
          );
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
