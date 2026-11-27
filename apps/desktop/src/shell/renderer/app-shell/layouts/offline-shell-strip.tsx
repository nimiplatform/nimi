import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { performDesktopBrowserAuth } from '@nimiplatform/kit/auth/shell';
import { AccountReasonCode } from '@nimiplatform/kit/core/sdk-contract';
import { useAppStore } from '../providers/app-store';
import { useDesktopRendererBindings } from '../../renderer/binding-context';
import { E2E_IDS } from '../../testability/e2e-ids';

type OnlineReauthErrorKey =
  | 'OfflineShell.onlineReauthTimeout'
  | 'OfflineShell.onlineReauthOpenFailed'
  | 'OfflineShell.onlineReauthFailed';

function isWaitEndedError(error: unknown): boolean {
  return error instanceof Error && error.name === 'DesktopBrowserAuthWaitEndedError';
}

function classifyOnlineReauthErrorKey(error: unknown): OnlineReauthErrorKey {
  const raw = (
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : ''
  ).toLowerCase();
  if (raw.includes('timeout') || raw.includes('timed out') || raw.includes('超时')) {
    return 'OfflineShell.onlineReauthTimeout';
  }
  if (
    raw.includes('无法打开系统默认浏览器')
    || raw.includes('无法打开系统浏览器')
    || raw.includes('open external')
    || raw.includes('open browser')
  ) {
    return 'OfflineShell.onlineReauthOpenFailed';
  }
  return 'OfflineShell.onlineReauthFailed';
}

export function OfflineShellStrip() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const offlineTier = useAppStore((state) => state.offlineTier);
  const authStatus = useAppStore((state) => state.auth.status);
  const accountReasonCode = useAppStore((state) => state.auth.accountReasonCode);

  const isRuntimeReadOnly = offlineTier === 'L2';
  const isOnlineReauthRequired = !isRuntimeReadOnly
    && authStatus === 'authenticated'
    && accountReasonCode === AccountReasonCode.REFRESH_OUTCOME_AMBIGUOUS;

  const [phase, setPhase] = useState<'idle' | 'pending' | 'error'>('idle');
  const [errorKey, setErrorKey] = useState<OnlineReauthErrorKey | null>(null);
  const [waitEnded, setWaitEnded] = useState(false);
  const [reopen, setReopen] = useState<(() => Promise<boolean>) | null>(null);
  const waitRef = useRef<AbortController | null>(null);

  const abortInFlight = useCallback(() => {
    const wait = waitRef.current;
    if (!wait) return;
    waitRef.current = null;
    wait.abort();
    setReopen(null);
  }, []);

  useEffect(() => () => {
    abortInFlight();
  }, [abortInFlight]);

  useEffect(() => {
    if (!isOnlineReauthRequired) {
      abortInFlight();
      setPhase('idle');
      setErrorKey(null);
      setWaitEnded(false);
    }
  }, [abortInFlight, isOnlineReauthRequired]);

  const beginOnlineReauth = useCallback(async () => {
    if (!isOnlineReauthRequired || waitRef.current) return;
    const wait = new AbortController();
    waitRef.current = wait;
    setPhase('pending');
    setErrorKey(null);
    setWaitEnded(false);
    setReopen(null);
    const authCommands = bindings.app.commands.auth;
    try {
      const result = await performDesktopBrowserAuth(authCommands.oauthBridge, {
        runtimeAccountBroker: authCommands.runtimeAccountBroker,
        signal: wait.signal,
        onBrowserOpened: (open) => {
          if (waitRef.current === wait) {
            setReopen(() => open);
          }
        },
      });
      if (!result.user) {
        throw new Error('Runtime completed login without an authenticated account projection.');
      }
      if (waitRef.current === wait) {
        setPhase('idle');
        setErrorKey(null);
        setWaitEnded(false);
      }
    } catch (reason) {
      if (waitRef.current !== wait) return;
      if (wait.signal.aborted || isWaitEndedError(reason)) {
        setPhase('idle');
        setErrorKey(null);
        setWaitEnded(true);
        return;
      }
      setPhase('error');
      setErrorKey(classifyOnlineReauthErrorKey(reason));
    } finally {
      if (waitRef.current === wait) {
        waitRef.current = null;
        setReopen(null);
      }
    }
  }, [bindings, isOnlineReauthRequired]);

  const endWait = useCallback(() => {
    const wait = waitRef.current;
    if (!wait) return;
    waitRef.current = null;
    wait.abort();
    setReopen(null);
    setWaitEnded(true);
    setErrorKey(null);
    setPhase('idle');
  }, []);

  if (offlineTier === 'L0' && !isOnlineReauthRequired) {
    return null;
  }

  const isWarningTone = isRuntimeReadOnly || isOnlineReauthRequired;
  const title = isRuntimeReadOnly
    ? t('OfflineShell.runtimeUnavailableTitle')
    : isOnlineReauthRequired
      ? t('OfflineShell.onlineReauthTitle')
      : t('OfflineShell.cloudOfflineTitle');
  const body = isRuntimeReadOnly
    ? t('OfflineShell.runtimeUnavailableBody')
    : isOnlineReauthRequired
      ? t('OfflineShell.onlineReauthBody')
      : t('OfflineShell.cloudOfflineBody');

  return (
    <div
      role={isRuntimeReadOnly ? 'alert' : 'status'}
      data-testid={E2E_IDS.offlineStrip}
      className={`border-b px-4 py-2 text-sm ${
        isWarningTone
          ? 'border-[color-mix(in_srgb,var(--nimi-status-warning)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-warning)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-warning)]'
          : 'border-[color-mix(in_srgb,var(--nimi-status-info)_28%,transparent)] bg-[color-mix(in_srgb,var(--nimi-status-info)_10%,var(--nimi-surface-card))] text-[var(--nimi-status-info)]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{title}</p>
          <p className="text-xs opacity-80">{body}</p>
          {isOnlineReauthRequired && phase === 'pending' ? (
            <p role="status" data-testid="offline-strip-reauth-status" className="mt-1 text-xs">
              {t('OfflineShell.onlineReauthPending')}
            </p>
          ) : null}
          {isOnlineReauthRequired && errorKey ? (
            <p role="alert" data-testid="offline-strip-reauth-error" className="mt-1 text-xs text-[var(--nimi-status-danger)]">
              {t(errorKey)}
            </p>
          ) : null}
          {isOnlineReauthRequired && waitEnded && phase === 'idle' ? (
            <p role="status" data-testid="offline-strip-reauth-status" className="mt-1 text-xs opacity-90">
              {t('OfflineShell.onlineReauthWaitEnded')}
            </p>
          ) : null}
        </div>
        {isOnlineReauthRequired ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {phase === 'pending' && reopen ? (
              <button
                type="button"
                data-testid="offline-strip-reauth-reopen"
                onClick={() => { void reopen().catch(() => false); }}
                className="rounded-full border border-current/25 px-3 py-1 text-xs font-medium transition-opacity hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
              >
                {t('OfflineShell.onlineReauthReopen')}
              </button>
            ) : null}
            {phase === 'pending' ? (
              <button
                type="button"
                data-testid="offline-strip-reauth-cancel"
                onClick={endWait}
                className="rounded-full border border-current/25 px-3 py-1 text-xs font-medium transition-opacity hover:opacity-85 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)]"
              >
                {t('OfflineShell.onlineReauthCancel')}
              </button>
            ) : null}
            <button
              type="button"
              data-testid="offline-strip-reauth-button"
              disabled={phase === 'pending'}
              onClick={() => { void beginOnlineReauth(); }}
              className="rounded-full bg-[var(--nimi-action-primary-bg)] px-3.5 py-1 text-xs font-medium text-[var(--nimi-action-primary-text)] transition-opacity hover:bg-[var(--nimi-action-primary-bg-hover)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nimi-focus-ring-color)] disabled:cursor-default disabled:opacity-55"
            >
              {phase === 'error'
                ? t('OfflineShell.onlineReauthRetry')
                : t('OfflineShell.onlineReauthAction')}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
