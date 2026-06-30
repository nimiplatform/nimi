import { Realm, createRealmFetchTransport } from '../../realm';
import type { NimiRuntimeAccountCaller, Runtime } from '../../runtime';
import { createNimiError, ReasonCode } from '../../types';

export type RuntimeAccountRealmRuntime = {
  readonly account: Pick<Runtime['account'], 'getAccessToken' | 'refreshAccountSession'>;
};

export type RuntimeAccountRealmFetch = typeof fetch;

export function createRealmWithRuntimeAccountToken(input: {
  readonly baseUrl: string;
  readonly fetchImpl?: RuntimeAccountRealmFetch;
  readonly runtime: RuntimeAccountRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): Realm {
  return new Realm({
    transport: createRealmFetchTransport({
      baseUrl: input.baseUrl,
      fetch: createRuntimeAccountRefreshingRealmFetch(input),
      headers: async () => {
        const accessToken = await getRuntimeAccountAccessToken(input);
        return {
          authorization: `Bearer ${accessToken}`,
        };
      },
    }),
  });
}

function createRuntimeAccountRefreshingRealmFetch(input: {
  readonly fetchImpl?: RuntimeAccountRealmFetch;
  readonly runtime: RuntimeAccountRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): RuntimeAccountRealmFetch {
  const fetchImpl = resolveFetchImpl(input.fetchImpl);
  return async (request, init) => {
    const response = await fetchImpl(request, init);
    if (response.status !== 401) {
      return response;
    }

    const refreshed = await input.runtime.account.refreshAccountSession({
      caller: input.accountCaller,
    });
    if (!refreshed.accepted) {
      return response;
    }

    const accessToken = await readRuntimeAccountAccessToken(input);
    if (!accessToken) {
      return response;
    }

    const retryInit: RequestInit = {
      ...init,
      headers: withAuthorizationHeader(init?.headers, accessToken),
    };
    return fetchImpl(request, retryInit);
  };
}

async function getRuntimeAccountAccessToken(input: {
  readonly runtime: RuntimeAccountRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): Promise<string> {
  const accessToken = await readRuntimeAccountAccessToken(input);
  if (!accessToken) {
    throw createNimiError({
      message: 'Runtime account access token unavailable.',
      reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
      actionHint: 'complete_runtime_account_login',
      source: 'runtime',
    });
  }
  return accessToken;
}

async function readRuntimeAccountAccessToken(input: {
  readonly runtime: RuntimeAccountRealmRuntime;
  readonly accountCaller: NimiRuntimeAccountCaller;
}): Promise<string> {
  const token = await input.runtime.account.getAccessToken({
    caller: input.accountCaller,
    requestedScopes: [],
  });
  const accessToken = normalizeText(token.accessToken);
  return token.accepted && accessToken ? accessToken : '';
}

function withAuthorizationHeader(headers: HeadersInit | undefined, accessToken: string): Headers {
  const next = new Headers(headers);
  next.set('authorization', `Bearer ${accessToken}`);
  return next;
}

function resolveFetchImpl(fetchImpl: RuntimeAccountRealmFetch | undefined): RuntimeAccountRealmFetch {
  const resolved = fetchImpl ?? globalThis.fetch?.bind(globalThis);
  if (typeof resolved !== 'function') {
    throw createNimiError({
      message: 'Realm Runtime account helper requires a fetch implementation.',
      reasonCode: ReasonCode.SDK_REALM_FETCH_UNAVAILABLE,
      actionHint: 'provide_realm_fetch_transport_fetch',
      source: 'sdk',
    });
  }
  return resolved;
}

function normalizeText(value: unknown): string {
  return String(value || '').trim();
}
