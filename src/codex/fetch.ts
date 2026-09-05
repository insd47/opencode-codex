import * as accounts from '../accounts/index.js';
import * as selection from '../accounts/selection.js';
import type { Account } from '../accounts/types.js';
import { CODEX_ENDPOINT } from '../config.js';
import * as token from './token.js';
import * as trace from './trace.js';

const HEADER_TIMEOUT_MS = 25_000;
const HEADER_FETCH_ATTEMPTS = 3;
const HEADER_TIMEOUT_COOLDOWN_MS = 60_000;
const RETRY_JITTER_MIN_MS = 250;
const RETRY_JITTER_MAX_MS = 1_000;
const STREAM_PROGRESS_INTERVAL_MS = 10_000;

const headerTimeoutUntil = new Map<string, number>();

function isCodexRoute(url: URL): boolean {
  return (
    url.pathname.includes('/v1/responses') ||
    url.pathname.includes('/chat/completions')
  );
}

function parseRetryAfter(
  value: string | null,
  now: number,
): number | undefined {
  if (!value) return;
  const secs = Number(value);
  if (Number.isFinite(secs) && secs > 0) return now + secs * 1000;
  const ts = Date.parse(value);
  if (Number.isFinite(ts) && ts > now) return ts;
  return undefined;
}

function requestHeaders(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
): Headers {
  const headers = new Headers(
    input instanceof Request ? input.headers : undefined,
  );
  if (!init?.headers) return headers;
  new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  return headers;
}

function buildHeaders(source: Headers, account: Account): Headers {
  const headers = new Headers(source);
  headers.delete('authorization');
  headers.set('authorization', `Bearer ${account.access}`);
  headers.set('ChatGPT-Account-Id', account.id);
  return headers;
}

function methodFor(input: RequestInfo | URL, init: RequestInit | undefined): string {
  if (init?.method) return init.method;
  if (input instanceof Request) return input.method;
  return 'GET';
}

function contentLength(headers: Headers): string | undefined {
  return headers.get('content-length') ?? undefined;
}

function requestBodyMetadata(
  init: RequestInit | undefined,
): Record<string, unknown> {
  const body = init?.body;
  if (typeof body !== 'string') return {};
  const metadata: Record<string, unknown> = {
    bodyBytes: new TextEncoder().encode(body).byteLength,
  };
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    if (typeof parsed.model === 'string') metadata.model = parsed.model;
    if (typeof parsed.stream === 'boolean') metadata.stream = parsed.stream;
    if (Array.isArray(parsed.input)) metadata.inputItems = parsed.input.length;
    if (Array.isArray(parsed.messages)) metadata.messages = parsed.messages.length;
    if (Array.isArray(parsed.tools)) metadata.tools = parsed.tools.length;
    if (parsed.reasoning && typeof parsed.reasoning === 'object') {
      metadata.reasoning = true;
    }
  } catch {}
  return metadata;
}

function timeoutError(ms: number): DOMException {
  return new DOMException(
    `Codex upstream did not return headers within ${ms}ms`,
    'TimeoutError',
  );
}

function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && err.name === 'TimeoutError';
}

function canRetry(init: RequestInit | undefined): boolean {
  const body = init?.body;
  return !(typeof ReadableStream !== 'undefined' && body instanceof ReadableStream);
}

function retryDelayMs(): number {
  return Math.floor(
    RETRY_JITTER_MIN_MS +
      Math.random() * (RETRY_JITTER_MAX_MS - RETRY_JITTER_MIN_MS),
  );
}

function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout>;
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function timeoutExcluded(now: number, requestExcluded: Set<string>): Set<string> {
  const excluded = new Set(requestExcluded);
  for (const [accountID, until] of headerTimeoutUntil) {
    if (until <= now) headerTimeoutUntil.delete(accountID);
    else excluded.add(accountID);
  }
  return excluded;
}

function fetchSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): {
  signal: AbortSignal;
  clearTimeout: () => void;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => {
    controller.abort(timeoutError(timeoutMs));
  }, timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    clearTimeout: () => clearTimeout(timer),
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}

function wrapBody(
  response: Response,
  context: trace.Context | undefined,
  cleanup: () => void,
): Response {
  if (!context) return response;
  const body = response.body;
  if (!body) {
    trace.log(context, 'upstream.body.none');
    cleanup();
    return response;
  }

  const reader = body.getReader();
  let chunks = 0;
  let bytes = 0;
  let done = false;
  let lastProgressMs = Date.now();

  const finish = (event: string, fields: Record<string, unknown> = {}) => {
    if (done) return;
    done = true;
    trace.log(context, event, { chunks, bytes, ...fields });
    cleanup();
  };

  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          finish('upstream.body.end');
          controller.close();
          return;
        }
        chunks += 1;
        bytes += next.value.byteLength;
        if (chunks === 1) {
          trace.log(context, 'upstream.body.first_chunk', {
            bytes: next.value.byteLength,
          });
        }
        const now = Date.now();
        if (now - lastProgressMs >= STREAM_PROGRESS_INTERVAL_MS) {
          lastProgressMs = now;
          trace.log(context, 'upstream.body.progress', { chunks, bytes });
        }
        controller.enqueue(next.value);
      } catch (err) {
        finish('upstream.body.error', { error: trace.error(err) });
        controller.error(err);
      }
    },
    async cancel(reason) {
      finish('upstream.body.cancel', { reason: trace.error(reason) });
      await reader.cancel(reason).catch(() => undefined);
    },
  });

  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

async function fetchHeaders(
  target: URL,
  init: RequestInit | undefined,
  headers: Headers,
  context: trace.Context | undefined,
  attempt: number,
  attempts: number,
  account: Account,
  metadata: Record<string, unknown>,
): Promise<{ response: Response; cleanup: () => void }> {
  trace.log(context, 'upstream.fetch.start', {
    attempt,
    attempts,
    account: trace.accountId(account.id),
    headerTimeoutMs: HEADER_TIMEOUT_MS,
    contentLength: contentLength(headers),
    contentType: headers.get('content-type') ?? undefined,
    ...metadata,
  });

  const upstreamSignal = fetchSignal(init?.signal ?? undefined, HEADER_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      ...init,
      signal: upstreamSignal.signal,
      headers,
    });
    upstreamSignal.clearTimeout();
    trace.log(context, 'upstream.headers', {
      attempt,
      account: trace.accountId(account.id),
      status: response.status,
      contentType: response.headers.get('content-type') ?? undefined,
      cfRay: response.headers.get('cf-ray') ?? undefined,
    });
    return { response, cleanup: upstreamSignal.cleanup };
  } catch (err) {
    upstreamSignal.cleanup();
    throw err;
  }
}

/**
 * Build a fetch implementation that proxies requests through the picked
 * Codex account. The returned function has the standard `fetch` signature.
 */
export function create(): typeof fetch {
  return async function codexFetch(
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const parsed =
      input instanceof URL
        ? input
        : new URL(typeof input === 'string' ? input : input.url);
    const isCodex = isCodexRoute(parsed);
    const context = isCodex ? trace.create() : undefined;
    const originalHeaders = requestHeaders(input, init);
    const sessionID = originalHeaders.get(selection.SESSION_HEADER) ?? undefined;
    originalHeaders.delete(selection.SESSION_HEADER);
    const metadata = requestBodyMetadata(init);
    const target = isCodexRoute(parsed) ? new URL(CODEX_ENDPOINT) : parsed;
    trace.log(context, 'request.start', {
      method: methodFor(input, init),
      sourcePath: parsed.pathname,
      targetHost: target.host,
      targetPath: target.pathname,
      sessionSelected: !!selection.id(sessionID),
      signalProvided: !!init?.signal,
      aborted: init?.signal?.aborted ?? false,
      ...metadata,
    });

    const onAbort = () => {
      trace.log(context, 'request.abort', {
        reason: trace.error(init?.signal?.reason),
      });
    };
    init?.signal?.addEventListener('abort', onAbort, { once: true });
    const cleanup = () => init?.signal?.removeEventListener('abort', onAbort);

    const attempts = canRetry(init) ? HEADER_FETCH_ATTEMPTS : 1;
    const requestTimedOutAccounts = new Set<string>();
    let response: Response | undefined;
    let upstreamCleanup: (() => void) | undefined;
    let fresh: Account | undefined;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const excluded = timeoutExcluded(Date.now(), requestTimedOutAccounts);
      const account = selection.pick(accounts.snapshot(), {
        exclude: excluded,
        sessionID,
      });
      if (!account) {
        cleanup();
        trace.log(context, 'request.no_account', { sourcePath: parsed.pathname });
        return new Response(
          JSON.stringify({ error: { message: 'No Codex account configured' } }),
          {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }

      try {
        trace.log(context, 'token.ensure.start', {
          attempt,
          account: trace.accountId(account.id),
          tokenFresh: token.isFresh(account),
        });
        fresh = await token.ensure(account, init?.signal ?? undefined);
        trace.log(context, 'token.ensure.end', {
          attempt,
          account: trace.accountId(fresh.id),
          refreshed:
            fresh.access !== account.access || fresh.expires !== account.expires,
        });
      } catch (err) {
        cleanup();
        trace.log(context, 'token.ensure.error', { error: trace.error(err) });
        throw err;
      }

      const attemptAccount = fresh;
      const headers = buildHeaders(originalHeaders, attemptAccount);
      try {
        const result = await fetchHeaders(
          target,
          init,
          headers,
          context,
          attempt,
          attempts,
          attemptAccount,
          metadata,
        );
        response = result.response;
        upstreamCleanup = result.cleanup;
        headerTimeoutUntil.delete(attemptAccount.id);
        break;
      } catch (err) {
        lastError = err;
        if (isTimeoutError(err)) {
          requestTimedOutAccounts.add(attemptAccount.id);
          headerTimeoutUntil.set(
            attemptAccount.id,
            Date.now() + HEADER_TIMEOUT_COOLDOWN_MS,
          );
        }
        const retry =
          attempt < attempts && isTimeoutError(err) && !init?.signal?.aborted;
        trace.log(context, retry ? 'upstream.fetch.retry' : 'upstream.fetch.error', {
          attempt,
          attempts,
          account: trace.accountId(attemptAccount.id),
          error: trace.error(err),
        });
        if (!retry) {
          cleanup();
          throw err;
        }
        try {
          await delay(retryDelayMs(), init?.signal ?? undefined);
        } catch (delayErr) {
          cleanup();
          throw delayErr;
        }
      }
    }

    if (!response || !upstreamCleanup || !fresh) {
      cleanup();
      throw lastError;
    }

    if (response.status === 429 || response.status === 402) {
      const now = Date.now();
      const until =
        parseRetryAfter(response.headers.get('retry-after'), now) ??
        now + 5 * 60_000;
      void accounts.rateLimit(fresh.id, until);
    } else if (response.ok) {
      void accounts.touch(fresh.id);
      if (fresh.rateLimitUntilMs) void accounts.clearRateLimit(fresh.id);
    }
    return wrapBody(response, context, () => {
      upstreamCleanup();
      cleanup();
    });
  };
}
