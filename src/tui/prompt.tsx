/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import { StyledText, fg, type TextRenderable } from '@opentui/core';
import * as selection from '../accounts/selection.js';
import type { Store } from '../accounts/types.js';
import * as quota from '../quota/index.js';
import { bindAccountsText } from './live-text.js';

const MAX = 24;

function trim(label: string, max = MAX): string {
  return label.length > max ? label.slice(0, max - 1) + '…' : label;
}

export function PromptStatus(props: { api: TuiPluginApi; sessionID: string }) {
  const content = (store: Store): StyledText => {
    const a = selection.active(store, props.sessionID);
    if (!a) {
      return new StyledText([
        fg(props.api.theme.current.textMuted)('no Codex account'),
      ]);
    }
    const name = a.label || a.email || a.id;
    const plan = quota.plan(a);
    return new StyledText([
      fg(props.api.theme.current.accent)(trim(name)),
      fg(props.api.theme.current.textMuted)(plan ? ` · ${plan}` : ''),
    ]);
  };

  return (
    <text
      ref={(text: TextRenderable) =>
        bindAccountsText(props.api, text, content, props.sessionID)
      }
      fg={props.api.theme.current.textMuted}
      selectable={false}
      truncate
      wrapMode="none"
    />
  );
}
