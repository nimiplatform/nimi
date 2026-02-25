import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import type { FormEvent } from 'react';
import type { AuthMode } from './auth-form-state';
import { getAuthErrorMessage } from './auth-form-state';
import { persistAccessToken } from './auth-session-storage';

type AuthSubmitInput = {
  mode: AuthMode;
  identifier: string;
  password: string;
  setPending: (value: boolean) => void;
  setPassword: (value: string) => void;
  setStatusBanner: (payload: { kind: 'success' | 'error' | 'warning'; message: string }) => void;
  setAuthSession: (user: Record<string, unknown> | null, token: string) => void;
};

export function createAuthSubmitHandler(input: AuthSubmitInput) {
  return async (event: FormEvent) => {
    event.preventDefault();
    const flowId = createRendererFlowId('login');
    const source = 'passwordLoginButton';
    const normalizedIdentifier = input.identifier.trim();

    logRendererEvent({
      level: 'info',
      area: 'events',
      message: 'action:password-login-button:clicked',
      flowId,
      source,
      details: {
        identifierLength: normalizedIdentifier.length,
      },
    });
    logRendererEvent({
      level: 'info',
      area: 'auth-controller',
      message: 'action:password-login:controller-entered',
      flowId,
      source,
      details: {
        mode: input.mode,
      },
    });

    if (!normalizedIdentifier || !input.password) {
      input.setStatusBanner({
        kind: 'error',
        message: '请输入账号和密码',
      });
      return;
    }

    input.setPending(true);
    input.setStatusBanner({
      kind: 'warning',
      message: input.mode === 'register' ? '正在注册...' : '正在登录...',
    });

    try {
      logRendererEvent({
        level: 'info',
        area: 'auth-action',
        message: 'action:password-login-action:start',
        flowId,
        source,
        details: {
          mode: input.mode,
          identifierLength: normalizedIdentifier.length,
        },
      });

      const result = input.mode === 'register'
        ? await dataSync.register(normalizedIdentifier, input.password, {
            flowId,
            source,
            startedAt: performance.now(),
          })
        : await dataSync.login(normalizedIdentifier, input.password, {
            flowId,
            source,
            startedAt: performance.now(),
          });

      const tokens = result?.tokens;
      const accessToken = typeof tokens?.accessToken === 'string' ? tokens.accessToken : '';
      if (!accessToken) {
        throw new Error('登录响应缺少 accessToken');
      }

      const user = tokens?.user && typeof tokens.user === 'object'
        ? (tokens.user as Record<string, unknown>)
        : null;

      dataSync.setToken(accessToken);
      input.setAuthSession(user, accessToken);
      persistAccessToken(accessToken);

      await Promise.allSettled([
        queryClient.invalidateQueries({ queryKey: ['chats'] }),
        queryClient.invalidateQueries({ queryKey: ['contacts'] }),
      ]);

      input.setStatusBanner({
        kind: 'success',
        message: input.mode === 'register' ? '注册并登录成功。' : '登录成功。',
      });
      input.setPassword('');

      logRendererEvent({
        level: 'info',
        area: 'auth-action',
        message: 'action:password-login-action:done',
        flowId,
        source,
        details: {
          mode: input.mode,
          hasAccessToken: true,
        },
      });
    } catch (error) {
      const message = getAuthErrorMessage(error);
      input.setStatusBanner({
        kind: 'error',
        message,
      });
      logRendererEvent({
        level: 'error',
        area: 'auth-action',
        message: 'action:password-login-action:failed',
        flowId,
        source,
        details: {
          mode: input.mode,
          error: message,
        },
      });
    } finally {
      input.setPending(false);
    }
  };
}
