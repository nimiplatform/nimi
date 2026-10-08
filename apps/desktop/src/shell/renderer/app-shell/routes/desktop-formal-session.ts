import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAppStore, useAppStoreApi } from '../providers/app-store.js';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { useStreamController } from '../../features/turns/stream-controller-context.js';

type Readiness = {
  readonly accountId: string;
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

// @nimi-authority: rule.nimi.runtime.protected-session.r017
export function useDesktopFormalSessionReadiness(): DesktopFormalSessionReadiness {
  const sdk = useDesktopRendererSdk();
  const store = useAppStoreApi();
  const queryClient = useQueryClient();
  const streams = useStreamController();
  const authStatus = useAppStore(state => state.auth.status);
  const accountId = useAppStore(state => typeof state.auth.user?.id === 'string' ? state.auth.user.id : '');
  const enabled = authStatus === 'authenticated' || authStatus === 'refresh-pending';
  const [attempt, setAttempt] = useState(0);
  const [readiness, setReadiness] = useState<Readiness>({ accountId: '', attempt: 0, status: 'checking' });
  const pending = useRef(false);

  useEffect(() => {
    let active = true;
    pending.current = enabled && Boolean(accountId);
    setReadiness({ accountId, attempt, status: 'checking' });
    if (!pending.current) return () => { active = false; };

    const stillCurrent = () => {
      const auth = store.getState().auth;
      return active && auth.user?.id === accountId
        && (auth.status === 'authenticated' || auth.status === 'refresh-pending');
    };
    // Retire UI work and cache before a technical probe can replace scope.
    // Recovery never runs a saved business operation or restores its tab.
    streams.clearAllStreams();
    const cancellation = queryClient.cancelQueries();
    queryClient.clear();
    void (async () => {
      try {
        await cancellation;
        if (!stillCurrent()) return;
        const projection = await sdk.appProduct().auth.status();
        if (!stillCurrent()) return;
        setReadiness({
          accountId, attempt,
          status: projection.sessionBound ? 'ready' : 'failed',
          ...(projection.sessionBound ? {} : { reasonCode: safeReasonCode(projection.reasonCode) }),
        });
      } catch (error) {
        if (stillCurrent()) setReadiness({ accountId, attempt, status: 'failed', reasonCode: safeReasonCode(error) });
      } finally {
        if (active) pending.current = false;
      }
    })();
    return () => { active = false; };
  }, [accountId, attempt, enabled, queryClient, sdk, store, streams]);

  const retry = useCallback(() => {
    if (pending.current || !enabled || !accountId) return;
    pending.current = true;
    streams.clearAllStreams();
    store.getState().setActiveTab('home');
    setAttempt(value => value + 1);
  }, [accountId, enabled, store, streams]);

  // Hide the previous account/attempt in the same render, before effects or
  // a late old technical projection can grant access to its children.
  if (!enabled || !accountId || readiness.accountId !== accountId || readiness.attempt !== attempt) {
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
