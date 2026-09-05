import {
  RenderableEvents,
  type StyledText,
  type TextRenderable,
} from '@opentui/core';
import type { TuiPluginApi } from '@opencode-ai/plugin/tui';
import * as accounts from '../accounts/index.js';
import * as selection from '../accounts/selection.js';
import type { Store } from '../accounts/types.js';

type Subscribe = (listener: () => void) => () => void;

/**
 * Keep an OpenTUI text node in sync without relying on the plugin's Solid
 * reactive owner. Packaged OpenCode plugins can load a separate Solid runtime,
 * so a signal update may never invalidate the host-rendered component tree.
 */
export function bindAccountsText(
  api: TuiPluginApi,
  text: TextRenderable,
  render: (store: Store) => StyledText | string,
  extraSubscriptions: Subscribe[] = [],
): void {
  let disposed = false;
  const update = (): void => {
    if (disposed) return;
    text.content = render(accounts.snapshot());
    text.requestRender();
  };
  const unsubscribers = [
    accounts.subscribe(update),
    selection.subscribe(update),
    ...extraSubscriptions.map((subscribe) => subscribe(update)),
  ];
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    for (const unsubscribe of unsubscribers) unsubscribe();
  };

  text.once(RenderableEvents.DESTROYED, dispose);
  api.lifecycle.onDispose(dispose);
  update();
  void accounts.load().then(update);
}
