import type { Plugin } from '@opencode-ai/plugin';
import * as accounts from './accounts/index.js';
import * as selection from './accounts/selection.js';
import * as auth from './auth/index.js';
import * as codex from './codex/fetch.js';
import { OAUTH_DUMMY_KEY, PROVIDER_ID } from './config.js';
import * as oauth from './oauth/index.js';

const plugin: Plugin = async (input) => {
  await accounts.load();
  await selection.load();
  await auth.sync();

  const listed = await input.client.session.list().catch(() => undefined);
  await selection.seedSessions(
    listed?.data?.map((session) => session.id) ?? [],
    accounts.active()?.id,
  );

  let lastAuthFingerprint = auth.fingerprint(accounts.snapshot());
  accounts.subscribe((store) => {
    const nextAuthFingerprint = auth.fingerprint(store);
    if (nextAuthFingerprint === lastAuthFingerprint) return;
    lastAuthFingerprint = nextAuthFingerprint;
    void auth.sync();
  });

  const codexFetch = codex.create();

  return {
    auth: {
      provider: PROVIDER_ID,
      async loader() {
        return { apiKey: OAUTH_DUMMY_KEY, fetch: codexFetch };
      },
      methods: oauth.methods(),
    },
    async event({ event }) {
      if (event.type === 'session.created') {
        await auth.sync();
        await selection.ensureSession(
          event.properties.info.id,
          accounts.active()?.id,
        );
      }
      if (event.type === 'session.deleted') {
        await selection.forgetSession(event.properties.info.id);
      }
      if (event.type === 'session.idle') {
        await auth.sync();
      }
    },
    async 'chat.headers'({ sessionID, model }, output) {
      if (model.providerID !== PROVIDER_ID) return;
      await selection.ensureSession(sessionID, accounts.active()?.id);
      output.headers[selection.SESSION_HEADER] = sessionID;
    },
  };
};

export default {
  id: 'opencode-codex',
  server: plugin,
};
