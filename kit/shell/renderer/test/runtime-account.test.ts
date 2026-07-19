import { afterEach, describe, expect, it } from 'vitest';
import {
  beginRuntimeAccountLogin,
  completeRuntimeAccountLogin,
  getRuntimeAccountSessionStatus,
  invokeRuntimeAccountRealmUnary,
  logoutRuntimeAccount,
  parseDesktopAccountBeginLoginResponse,
  parseDesktopAccountRealmUnaryResponse,
  parseDesktopAccountSessionEvent,
  parseDesktopAccountSessionStatus,
  subscribeRuntimeAccountSessionEvents,
  switchRuntimeAccount,
} from '../src/bridge/index.js';
import { resolveTauriInvokePayload } from '../src/bridge/tauri-api.js';

type RuntimeAccountTestGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: {
    invoke?: (command: string, payload?: unknown) => Promise<unknown>;
    listen?: (
      eventName: string,
      handler: (event: { payload: unknown }) => void,
    ) => (() => void);
  };
};

const testGlobal = globalThis as RuntimeAccountTestGlobal;

afterEach(() => {
  delete testGlobal.__NIMI_TAURI_TEST__;
});

describe('protected Desktop account status', () => {
  it('adapts the shared account stream payload to the exact Tauri command ABI', () => {
    expect(resolveTauriInvokePayload(
      'runtime_account_session_events_open',
      { afterSequence: '9' },
    )).toEqual({ payload: { afterSequence: '9' } });
    expect(resolveTauriInvokePayload(
      'runtime_account_session_events_close',
      { streamId: 'account-session-1' },
    )).toEqual({ payload: { streamId: 'account-session-1' } });
    expect(resolveTauriInvokePayload('runtime_account_session_status', {})).toEqual({});
  });

  it('invokes one exact no-input command and returns the safe projection', async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    testGlobal.__NIMI_TAURI_TEST__ = {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        return {
          sequence: '7',
          state: 'authenticated',
          reasonCode: 1,
          accountReasonCode: 1,
          accountProjection: {
            accountId: 'account-1',
            displayName: 'Nimi User',
            realmEnvironmentId: 'realm-1',
          },
        };
      },
    };

    await expect(getRuntimeAccountSessionStatus()).resolves.toEqual({
      sequence: '7',
      state: 'authenticated',
      reasonCode: 1,
      accountReasonCode: 1,
      accountProjection: {
        accountId: 'account-1',
        displayName: 'Nimi User',
        realmEnvironmentId: 'realm-1',
      },
    });
    expect(calls).toEqual([
      { command: 'runtime_account_session_status', payload: {} },
    ]);
  });

  it('rejects unknown states, missing authenticated projection, and protected material', () => {
    const base = { sequence: '7', reasonCode: 1, accountReasonCode: 1 };
    expect(() => parseDesktopAccountSessionStatus({ ...base, state: 'forged' })).toThrow(/unsupported state/);
    expect(() => parseDesktopAccountSessionStatus({ ...base, state: 'authenticated' })).toThrow(/requires accountProjection/);
    expect(() => parseDesktopAccountSessionStatus({
      ...base,
      state: 'authenticated',
      accountProjection: {
        accountId: 'account-1',
        displayName: 'Nimi User',
        realmEnvironmentId: 'realm-1',
        sessionToken: 'forbidden',
      },
    })).toThrow(/forbidden fields/);
    expect(() => parseDesktopAccountSessionStatus({ ...base, sequence: '01', state: 'anonymous' }))
      .toThrow(/canonical unsigned decimal string/);
    expect(() => parseDesktopAccountSessionStatus({
      ...base,
      sequence: '999999999999999999999',
      state: 'anonymous',
    })).toThrow(/canonical unsigned decimal string/);
    expect(() => parseDesktopAccountSessionStatus({
      ...base,
      state: 'authenticated',
      accountProjection: {
        accountId: 42,
        displayName: 'Nimi User',
        realmEnvironmentId: 'realm-1',
      },
    })).toThrow(/exact non-empty string/);
    expect(() => parseDesktopAccountSessionStatus({
      ...base,
      state: ' authenticated',
    })).toThrow(/exact non-empty string/);
  });

  it('opens, validates, and closes the exact protected account event stream', async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    const events: unknown[] = [];
    let unlistened = false;
    let listener: ((event: { payload: unknown }) => void) | null = null;
    testGlobal.__NIMI_TAURI_TEST__ = {
      listen: (eventName, handler) => {
        expect(eventName).toBe('runtime_account_session_events');
        listener = handler;
        return () => { unlistened = true; };
      },
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        if (command === 'runtime_account_session_events_open') {
          listener?.({
            payload: {
              streamId: 'account-session-1',
              eventType: 'next',
              event: {
                sequence: '9',
                deliveryKind: 'snapshot',
                state: 'authenticated',
                reasonCode: 1,
                accountReasonCode: 1,
                accountProjection: {
                  accountId: 'account-1',
                  displayName: 'Nimi User',
                  realmEnvironmentId: 'realm-1',
                },
                replayTruncated: false,
              },
            },
          });
          return { streamId: 'account-session-1' };
        }
        if (command === 'runtime_account_session_events_close') return {};
        throw new Error(`unexpected command ${command}`);
      },
    };

    const close = await subscribeRuntimeAccountSessionEvents('9', {
      onEvent: (event) => events.push(event),
      onError: (error) => { throw error; },
    });
    expect(events).toEqual([{
      sequence: '9',
      deliveryKind: 'snapshot',
      state: 'authenticated',
      reasonCode: 1,
      accountReasonCode: 1,
      accountProjection: {
        accountId: 'account-1',
        displayName: 'Nimi User',
        realmEnvironmentId: 'realm-1',
      },
      replayTruncated: false,
    }]);
    close();
    await Promise.resolve();
    expect(unlistened).toBe(true);
    expect(calls).toEqual([
      { command: 'runtime_account_session_events_open', payload: { afterSequence: '9' } },
      { command: 'runtime_account_session_events_close', payload: { streamId: 'account-session-1' } },
    ]);
    expect(() => parseDesktopAccountSessionEvent({
      sequence: '10',
      deliveryKind: 'live',
      state: 'authenticated',
      reasonCode: 1,
      accountReasonCode: 1,
      accountProjection: { accountId: 'account-1', displayName: '', realmEnvironmentId: '' },
      replayTruncated: false,
      refreshToken: 'forbidden',
    })).toThrow(/forbidden fields/);
  });

  it('releases the native stream and global listener on terminal delivery', async () => {
    const calls: string[] = [];
    let listener: ((event: { payload: unknown }) => void) | null = null;
    let unlistened = false;
    let completed = 0;
    testGlobal.__NIMI_TAURI_TEST__ = {
      listen: (_eventName, handler) => {
        listener = handler;
        return () => { unlistened = true; };
      },
      invoke: async (command) => {
        calls.push(command);
        if (command === 'runtime_account_session_events_open') {
          return { streamId: 'account-session-terminal' };
        }
        if (command === 'runtime_account_session_events_close') return {};
        throw new Error(`unexpected command ${command}`);
      },
    };

    const close = await subscribeRuntimeAccountSessionEvents('0', {
      onEvent: () => { throw new Error('unexpected event'); },
      onError: (error) => { throw error; },
      onCompleted: () => { completed += 1; },
    });
    listener?.({
      payload: {
        streamId: 'account-session-terminal',
        eventType: 'completed',
      },
    });
    await Promise.resolve();
    close();

    expect(completed).toBe(1);
    expect(unlistened).toBe(true);
    expect(calls).toEqual([
      'runtime_account_session_events_open',
      'runtime_account_session_events_close',
    ]);
  });

  it('projects only validated account stream errors to consumers', async () => {
    let listener: ((event: { payload: unknown }) => void) | null = null;
    let observed: unknown;
    testGlobal.__NIMI_TAURI_TEST__ = {
      listen: (_eventName, handler) => {
        listener = handler;
        return () => undefined;
      },
      invoke: async (command) => {
        if (command === 'runtime_account_session_events_open') {
          return { streamId: 'account-session-error' };
        }
        if (command === 'runtime_account_session_events_close') return {};
        throw new Error(`unexpected command ${command}`);
      },
    };

    await subscribeRuntimeAccountSessionEvents('0', {
      onEvent: () => { throw new Error('unexpected event'); },
      onError: (error) => { observed = error; },
    });
    listener?.({
      payload: {
        streamId: 'account-session-error',
        eventType: 'error',
        error: { reasonCode: 'runtime-service-unavailable', retryable: true },
      },
    });
    await Promise.resolve();

    expect(observed).toMatchObject({
      name: 'BridgeError',
      reasonCode: 'runtime-service-unavailable',
      code: 'runtime-service-unavailable',
      source: 'runtime',
      details: {
        command: 'runtime_account_session_events_open',
        retryable: true,
      },
    });
  });

  it('fails closed on malformed account stream identifiers and error envelopes', async () => {
    testGlobal.__NIMI_TAURI_TEST__ = {
      listen: () => () => undefined,
      invoke: async (command) => {
        if (command === 'runtime_account_session_events_open') return { streamId: 42 };
        throw new Error(`unexpected command ${command}`);
      },
    };
    await expect(subscribeRuntimeAccountSessionEvents('0', {
      onEvent: () => undefined,
      onError: () => undefined,
    })).rejects.toThrow(/exact non-empty string/);

    let listener: ((event: { payload: unknown }) => void) | null = null;
    let observed: unknown;
    testGlobal.__NIMI_TAURI_TEST__ = {
      listen: (_eventName, handler) => {
        listener = handler;
        return () => undefined;
      },
      invoke: async (command) => {
        if (command === 'runtime_account_session_events_open') return { streamId: 'account-session-malformed' };
        if (command === 'runtime_account_session_events_close') return {};
        throw new Error(`unexpected command ${command}`);
      },
    };
    await subscribeRuntimeAccountSessionEvents('0', {
      onEvent: () => undefined,
      onError: (error) => { observed = error; },
    });
    listener?.({
      payload: {
        streamId: 'account-session-malformed',
        eventType: 'error',
        error: {
          reasonCode: 'runtime-service-unavailable',
          retryable: true,
          accessToken: 'forbidden',
        },
      },
    });
    expect(observed).toBeInstanceOf(Error);
    expect((observed as Error).message).toMatch(/forbidden fields/);
  });

  it('uses exact caller-empty protected commands for login, Realm mediation, logout, and switch', async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    testGlobal.__NIMI_TAURI_TEST__ = {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        if (command === 'runtime_account_begin_login') {
          return {
            accepted: true,
            loginAttemptId: 'attempt-1',
            oauthAuthorizationUrl: 'http://127.0.0.1:19443/api/auth/oauth/authorize?state=state-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A41001%2Foauth%2Fcallback',
            callbackOrigin: 'http://127.0.0.1:41001',
            state: 'state-1',
            nonce: 'nonce-1',
            reasonCode: 1,
            accountReasonCode: 1,
            productionInert: false,
          };
        }
        if (command === 'runtime_account_complete_login') {
          return {
            accepted: true,
            state: 3,
            accountProjection: {
              accountId: 'account-1',
              displayName: 'Nimi User',
              realmEnvironmentId: 'realm-1',
            },
            reasonCode: 1,
            accountReasonCode: 1,
            productionInert: false,
          };
        }
        if (command === 'runtime_account_invoke_realm_unary') {
          return {
            accepted: true,
            responseJson: '{"items":[]}',
            reasonCode: 1,
            accountReasonCode: 1,
            productionInert: false,
            httpStatus: 200,
            errorMessage: '',
          };
        }
        return {
          accepted: true,
          state: 1,
          accountProjection: null,
          reasonCode: 1,
          accountReasonCode: 1,
          productionInert: false,
        };
      },
    };

    await beginRuntimeAccountLogin({
      redirectUri: 'http://127.0.0.1:41001/oauth/callback',
      callbackOrigin: 'http://127.0.0.1:41001',
      requestedScopes: [],
      ttlSeconds: 300,
    });
    const completion = await completeRuntimeAccountLogin({
      loginAttemptId: 'attempt-1',
      code: 'oauth-code',
      state: 'state-1',
      nonce: 'nonce-1',
      redirectUri: 'http://127.0.0.1:41001/oauth/callback',
      callbackOrigin: 'http://127.0.0.1:41001',
    });
    expect(completion.accountProjection?.workspaceMemberships).toEqual([]);
    await invokeRuntimeAccountRealmUnary({
      methodId: 'realm.human.get_current_user',
      requestJson: '{}',
      timeoutMs: 30_000,
      idempotencyKey: 'realm-current-user-1',
    });
    await logoutRuntimeAccount('desktop_logout');
    await switchRuntimeAccount('desktop_switch_account');

    expect(calls).toHaveLength(5);
    for (const call of calls) {
      expect(call.payload).toHaveProperty('payload');
      expect(call.payload).not.toHaveProperty('caller');
      expect(call.payload).not.toHaveProperty('realmBaseUrl');
      expect(call.payload).not.toHaveProperty('reason');
      expect((call.payload as { payload: unknown }).payload).not.toHaveProperty('caller');
      expect((call.payload as { payload: unknown }).payload).not.toHaveProperty('realmBaseUrl');
      expect(JSON.stringify(call.payload)).not.toMatch(/token|bearer/iu);
    }
    expect(calls.map((call) => call.command)).toEqual([
      'runtime_account_begin_login',
      'runtime_account_complete_login',
      'runtime_account_invoke_realm_unary',
      'runtime_account_logout',
      'runtime_account_switch_account',
    ]);
  });

  it('rejects malformed or authority-bearing protected account projections', () => {
    expect(() => parseDesktopAccountBeginLoginResponse({
      accepted: 'true',
      loginAttemptId: '',
      oauthAuthorizationUrl: '',
      callbackOrigin: '',
      state: '',
      nonce: '',
      reasonCode: 1,
      accountReasonCode: 1,
      productionInert: false,
    })).toThrow(/accepted must be a boolean/);
    expect(() => parseDesktopAccountRealmUnaryResponse({
      accepted: true,
      responseJson: '{}',
      reasonCode: 1,
      accountReasonCode: 1,
      productionInert: false,
      httpStatus: 0,
      errorMessage: '',
      accessToken: 'forbidden',
    })).toThrow(/forbidden fields/);

    const acceptedLogin = {
      accepted: true,
      loginAttemptId: 'attempt-1',
      oauthAuthorizationUrl: 'https://realm.test/api/auth/oauth/authorize?state=state-1&redirect_uri=http%3A%2F%2F127.0.0.1%3A41001%2Foauth%2Fcallback',
      callbackOrigin: 'http://127.0.0.1:41001',
      state: 'state-1',
      nonce: 'nonce-1',
      reasonCode: 1,
      accountReasonCode: 1,
      productionInert: false,
    };
    expect(() => parseDesktopAccountBeginLoginResponse({
      ...acceptedLogin,
      callbackOrigin: 'http://realm.test:41001',
    })).toThrow(/protected contract/);
    expect(() => parseDesktopAccountBeginLoginResponse({
      ...acceptedLogin,
      oauthAuthorizationUrl: `${acceptedLogin.oauthAuthorizationUrl}#fragment`,
    })).toThrow(/protected contract/);
    expect(() => parseDesktopAccountBeginLoginResponse({
      ...acceptedLogin,
      oauthAuthorizationUrl: acceptedLogin.oauthAuthorizationUrl.replace('41001', '41002'),
    })).toThrow(/protected contract/);
    expect(() => parseDesktopAccountBeginLoginResponse({
      ...acceptedLogin,
      accepted: false,
      reasonCode: 2,
      accountReasonCode: 10,
    })).toThrow(/rejected login response contains authorization material/);
  });

  it('rejects accepted account mutations with method-incoherent state or projection', async () => {
    testGlobal.__NIMI_TAURI_TEST__ = {
      invoke: async (command) => {
        if (command === 'runtime_account_complete_login') {
          return {
            accepted: true,
            state: 1,
            accountProjection: null,
            reasonCode: 1,
            accountReasonCode: 1,
            productionInert: false,
          };
        }
        return {
          accepted: true,
          state: 1,
          accountProjection: {
            accountId: 'account-1',
            displayName: 'Nimi User',
            realmEnvironmentId: 'realm-1',
          },
          reasonCode: 1,
          accountReasonCode: 1,
          productionInert: false,
        };
      },
    };
    await expect(completeRuntimeAccountLogin({
      loginAttemptId: 'attempt-1',
      code: 'code-1',
      state: 'state-1',
      nonce: 'nonce-1',
      redirectUri: 'http://127.0.0.1:41001/oauth/callback',
      callbackOrigin: 'http://127.0.0.1:41001',
    })).rejects.toThrow(/accepted mutation response/);
    await expect(logoutRuntimeAccount('desktop_logout')).rejects.toThrow(/accepted mutation response/);
    await expect(switchRuntimeAccount('desktop_switch_account')).rejects.toThrow(/accepted mutation response/);
  });
});
