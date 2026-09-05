/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import {
  StyledText,
  bold,
  fg,
  type TextChunk,
  type TextRenderable,
} from '@opentui/core';
import * as selection from '../accounts/selection.js';
import type { Store } from '../accounts/types.js';
import * as quota from '../quota/index.js';
import { bindAccountsText } from './live-text.js';

const BAR_WIDTH = 17;

interface Line {
  label: string;
  remaining: number;
  reset?: string;
}

function activeLines(store: Store): Line[] {
  const a = selection.active(store);
  if (!a?.usage) return [];
  return a.usage.windows.map((w) => ({
    label: quota.label(w.windowMinutes),
    remaining: quota.left(w.usedPercent) ?? 0,
    reset: quota.countdown(w.resetAtMs),
  }));
}

function poolLines(store: Store): Line[] {
  return quota.aggregate(store.accounts).map((row) => ({
    label: quota.label(row.windowMinutes),
    remaining: row.remaining,
  }));
}

export function Sidebar(props: { api: TuiPluginApi }) {
  const content = (store: Store): StyledText => {
    const theme = props.api.theme.current;
    if (store.accounts.length === 0) {
      return new StyledText([
        bold(fg(theme.text)('Codex')),
        fg(theme.textMuted)(
          '\nNo accounts. Use /connect → openai to add one.',
        ),
      ]);
    }

    const chunks: TextChunk[] = [];
    const appendRows = (title: string, rows: Line[]): void => {
      if (chunks.length > 0) chunks.push(fg(theme.textMuted)('\n\n'));
      chunks.push(bold(fg(theme.text)(title)));
      for (const line of rows) {
        const parts = quota.bar(line.remaining, BAR_WIDTH);
        const pct = Math.round(line.remaining);
        const tail =
          line.reset && pct < 100
            ? `  ${line.label} · ${pct}% (${line.reset})`
            : `  ${line.label} · ${pct}%`;
        chunks.push(
          fg(theme.textMuted)('\n'),
          fg(theme.accent)(parts.filled),
          fg(theme.borderSubtle)(parts.empty),
          fg(theme.textMuted)(tail),
        );
      }
    };

    if (selection.active(store)) appendRows('Quota', activeLines(store));
    if (store.accounts.length > 1) appendRows('All Quota', poolLines(store));
    return new StyledText(chunks);
  };

  return (
    <text
      ref={(text: TextRenderable) =>
        bindAccountsText(props.api, text, content)
      }
      selectable={false}
      wrapMode="none"
    />
  );
}
