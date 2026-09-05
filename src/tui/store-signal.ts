import { createSignal, onCleanup } from 'solid-js';
import * as accounts from '../accounts/index.js';
import * as selection from '../accounts/selection.js';
import type { Store } from '../accounts/index.js';
import * as quota from '../quota/index.js';

export function useAccountsStore(): () => Store {
  const [store, setStore] = createSignal<Store>(accounts.snapshot());
  void accounts.load().then(setStore);
  const off = accounts.subscribe(setStore);
  const offSelection = selection.subscribe(() => setStore(accounts.snapshot()));
  const offQuota = quota.subscribeMultiplierOverrides(() =>
    setStore(accounts.snapshot()),
  );
  onCleanup(() => {
    off();
    offSelection();
    offQuota();
  });
  return store;
}
