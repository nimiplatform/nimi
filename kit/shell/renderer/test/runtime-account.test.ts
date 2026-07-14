import { afterEach, describe, expect, it } from 'vitest';
import {
  beginRuntimeAccountLogin,
  completeRuntimeAccountLogin,
  getRuntimeAccountSessionStatus,
  invokeRuntimeAccountRealmUnary,
  logoutRuntimeAccount,
  parseDesktopAccountBeginLoginResponse,
  parseDesktopAccountRealmUnaryResponse,
  parseDesktopAccountSessionStatus,
  switchRuntimeAccount,
} from '../src/bridge/index.js';

type RuntimeAccountTestGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: {
    invoke?: (command: string, payload?: unknown) => Promise<unknown>;
  };
};

const testGlobal = globalThis as RuntimeAccountTestGlobal;

afterEach(() => {
  delete testGlobal.__NIMI_TAURI_TEST__;
});

describe('protected Desktop account status', () => {
  it('invokes one exact no-input command and returns the safe projection', async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    testGlobal.__NIMI_TAURI_TEST__ = {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        return {
          state: 'authenticated',
          accountProjection: {
            accountId: 'account-1',
            displayName: 'Nimi User',
            realmEnvironmentId: 'realm-1',
          },
        };
      },
    };

    await expect(getRuntimeAccountSessionStatus()).resolves.toEqual({
      state: 'authenticated',
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
    expect(() => parseDesktopAccountSessionStatus({ state: 'forged' })).toThrow(/unsupported state/);
    expect(() => parseDesktopAccountSessionStatus({ state: 'authenticated' })).toThrow(/requires accountProjection/);
    expect(() => parseDesktopAccountSessionStatus({
      state: 'authenticated',
      accountProjection: {
        accountId: 'account-1',
        displayName: 'Nimi User',
        realmEnvironmentId: 'realm-1',
        sessionToken: 'forbidden',
      },
    })).toThrow(/forbidden fields/);
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
            oauthAuthorizationUrl: 'http://127.0.0.1:19443/api/auth/oauth/authorize?state=state-1',
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
            httpStatus: 0,
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
  });
});
