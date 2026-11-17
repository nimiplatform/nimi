import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore, useAppStoreApi } from '../providers/app-store.js';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { captureAccountActionScope } from '../providers/account-action-scope.js';
import type { AppStoreState } from '../providers/store-types.js';

type Readiness = {
  readonly scopeKey: string;
  readonly attempt: number;
  readonly status: 'checking' | 'ready' | 'failed';
  readonly reasonCode?: string;
};

export type DesktopFormalSessionReadiness = {
  readonly status: Readiness['status'];
  readonly reasonCode?: string;
  readonly retry: () => void;
};

export const DesktopFormalSessionRecoveryContext = createContext<(() => void) | null>(null);

export function useDesktopFormalSessionRecovery(): (() => void) | null {
  return useContext(DesktopFormalSessionRecoveryContext);
}

function formalScopeKey({ auth }: AppStoreState): string {
  return (auth.status === 'authenticated' || auth.status === 'refresh-pending')
    && auth.user?.id && auth.user.realmEnvironmentId && auth.authorizationRevision
    ? JSON.stringify([auth.user.id, auth.user.realmEnvironmentId, auth.authorizationRevision])
    : '';
}

// @nimi-authority: rule.nimi.runtime.protected-session.r017
export function useDesktopFormalSessionReadiness(): DesktopFormalSessionReadiness {
  const { sdk, app: { events } } = useDesktopRendererBindings();
  const store = useAppStoreApi();
  const queryClient = useQueryClient();
  const authStatus = useAppStore(state => state.auth.status);
  const scopeKey = useAppStore(formalScopeKey);
  const startedScope = useRef('');
  const enabled = Boolean(scopeKey) && (authStatus === 'authenticated' || startedScope.current === scopeKey);
  const [attempt, setAttempt] = useState(0);
  const [readiness, setReadiness] = useState<Readiness>({ scopeKey: '', attempt: 0, status: 'checking' });
  const pending = useRef(false);

  useEffect(() => {
    if (!enabled) {
      startedScope.current = '';
      pending.current = false;
      setReadiness({ scopeKey: '', attempt, status: 'checking' });
      return;
    }
    const scope = captureAccountActionScope(store, { allowRefreshing: true });
    if (!scope || formalScopeKey(store.getState()) !== scopeKey) {
      scope?.dispose();
      return;
    }
    if (startedScope.current && startedScope.current !== scopeKey) store.navigation.reset({ id: 'home' });
    startedScope.current = scopeKey;
    pending.current = true;
    const stillCurrent = () => scope.isCurrent() && formalScopeKey(store.getState()) === scopeKey;

    // Retire UI work and cache before a technical probe can replace scope.
    const cancellation = queryClient.cancelQueries();
    queryClient.clear();
    void (async () => {
      try {
        await cancellation;
        if (!stillCurrent()) return;
        const projection = await sdk.appProduct().auth.status();
        if (!stillCurrent()) return;
        setReadiness({
          scopeKey, attempt,
          status: projection.sessionBound ? 'ready' : 'failed',
          ...(projection.sessionBound ? {} : { reasonCode: safeReasonCode(projection.reasonCode) }),
        });
      } catch (error) {
        if (stillCurrent()) setReadiness({ scopeKey, attempt, status: 'failed', reasonCode: safeReasonCode(error) });
      } finally {
        if (!scope.signal.aborted) pending.current = false;
      }
    })();
    return () => scope.dispose();
  }, [scopeKey, attempt, enabled, queryClient, sdk, store]);

  const retry = useCallback(() => {
    if (pending.current || !enabled) return;
    pending.current = true;
    store.navigation.reset({ id: 'home' });
    setAttempt(value => value + 1);
  }, [enabled, store]);
  useEffect(() => events.subscribeFormalSessionInvalidation(retry), [events, retry]);

  // A changed scope or invalidated attempt hides children before effects run.
  if (!enabled || readiness.scopeKey !== scopeKey || readiness.attempt !== attempt) {
    return { status: 'checking', retry };
  }
  return { status: readiness.status, reasonCode: readiness.reasonCode, retry };
}

function safeReasonCode(value: unknown): string {
  const code = typeof value === 'string' ? value
    : value && typeof value === 'object' && 'reasonCode' in value ? value.reasonCode : undefined;
  return typeof code === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/u.test(code)
    ? code : 'runtime-operation-failed';
}
