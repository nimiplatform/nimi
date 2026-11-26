import { useCallback, useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { ShellOAuthCodeBridge } from '@nimiplatform/kit/core/oauth';
import { isDesktopBrowserAuthWaitEnded, performDesktopBrowserAuth } from '../logic/desktop-browser-auth.js';
import { toDesktopBrowserAuthErrorMessage } from '../logic/oauth-helpers.js';
import type { DesktopBrowserAuthRuntimeBroker } from '../types/auth-types.js';
import { AuthVisualBackground } from './auth-visual-background.js';

export type DesktopBrowserAuthGateProps = {
  bridge: ShellOAuthCodeBridge;
  runtimeAccountBroker: DesktopBrowserAuthRuntimeBroker;
  logo?: ReactNode;
  title?: string;
  description?: string;
  continueLabel?: string;
  pendingMessage?: string;
  retryLabel?: string;
  /** Opens the same, still-valid authorization URL again while waiting. */
  reopenLabel?: string;
  /** Stops waiting on this device; it does not cancel the Runtime attempt. */
  endWaitLabel?: string;
  waitEndedMessage?: string;
  notice?: string | null;
  onAuthenticated: (user: Record<string, unknown>) => void;
  onActionableReady?: () => void;
  onEntryAction?: () => void;
  onRootPointerDown?: (event: ReactMouseEvent<HTMLElement>) => void;
  screenTestId?: string;
  actionTestId?: string;
  autoStart?: boolean;
};

// @nimi-authority: rule.nimi.desktop.shell-runtime.r021
// @nimi-authority: rule.nimi.desktop.shell-runtime.r024
export function DesktopBrowserAuthGate(props: DesktopBrowserAuthGateProps) {
  const [status, setStatus] = useState<'idle' | 'pending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [waitEnded, setWaitEnded] = useState(false);
  const [reopen, setReopen] = useState<(() => Promise<boolean>) | null>(null);
  const [isLogoHovered, setIsLogoHovered] = useState(false);
  const waitRef = useRef<AbortController | null>(null);
  const autoStartedRef = useRef(false);
  const descriptionId = useId();

  const begin = useCallback(async () => {
    if (waitRef.current) return;
    props.onEntryAction?.();
    const wait = new AbortController();
    waitRef.current = wait;
    setStatus('pending');
    setError(null);
    setWaitEnded(false);
    setReopen(null);
    try {
      const result = await performDesktopBrowserAuth(props.bridge, {
        runtimeAccountBroker: props.runtimeAccountBroker,
        signal: wait.signal,
        onBrowserOpened: (open) => { if (waitRef.current === wait) setReopen(() => open); },
      });
      if (!result.user) {
        throw new Error('Runtime completed login without an authenticated account projection.');
      }
      if (waitRef.current === wait) props.onAuthenticated(result.user);
    } catch (reason) {
      if (waitRef.current !== wait) return;
      if (isDesktopBrowserAuthWaitEnded(reason)) {
        setStatus('idle');
        setWaitEnded(true);
        return;
      }
      setStatus('error');
      setError(toDesktopBrowserAuthErrorMessage(reason));
    } finally {
      if (waitRef.current === wait) {
        waitRef.current = null;
        setReopen(null);
      }
    }
  }, [props]);

  const endWait = useCallback(() => {
    const wait = waitRef.current;
    if (!wait) return;
    waitRef.current = null;
    wait.abort();
    setReopen(null);
    setWaitEnded(true);
    setStatus('idle');
  }, []);

  useEffect(() => () => {
    const wait = waitRef.current;
    waitRef.current = null;
    wait?.abort();
  }, []);

  useEffect(() => {
    props.onActionableReady?.();
  }, [props.onActionableReady]);

  useEffect(() => {
    if (!props.autoStart || autoStartedRef.current) return;
    autoStartedRef.current = true;
    void begin();
  }, [begin, props.autoStart]);

  const title = props.title || '在浏览器中安全登录 Nimi';
  const description = props.description || 'Nimi 账号凭据只在网页中输入。完成后，浏览器会安全返回此设备。';
  const actionLabel = status === 'error'
    ? (props.retryLabel || '重试')
    : (props.continueLabel || '继续登录');

  return (
    <main
      className="nimi-shell-auth-root nimi-shell-auth-brand-surface absolute inset-0 z-10"
      data-shell-auth-theme="custom"
      data-testid={props.screenTestId}
      onPointerDown={props.onRootPointerDown}
    >
      <div aria-hidden className="nimi-shell-auth-background">
        <AuthVisualBackground isLogoHovered={isLogoHovered} profile="desktop" />
      </div>
      <div className="nimi-shell-auth-shell absolute inset-0 z-10 !p-0">
        <section className="nimi-shell-auth-content">
          <div className="pointer-events-auto flex flex-col items-center text-center">
            {props.logo ? (
              <div
                aria-hidden="true"
                onClick={() => { if (status !== 'pending') void begin(); }}
                onMouseEnter={() => setIsLogoHovered(true)}
                onMouseLeave={() => setIsLogoHovered(false)}
                className={`group relative block h-24 w-24 select-none rounded-full transition-transform duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] ${status === 'pending' ? 'cursor-default' : 'cursor-pointer active:scale-[var(--nimi-motion-pressed-scale)]'}`}
              >
                <span
                  className="block h-full w-full pointer-events-none transition-transform duration-[var(--nimi-motion-base)] ease-[var(--nimi-motion-ease-standard)] group-hover:scale-105"
                >
                  {props.logo}
                </span>
              </div>
            ) : null}

            <h1 className={props.logo ? 'mt-8 text-[length:var(--nimi-type-body-sm-size)] font-medium uppercase tracking-[0.38em] text-[var(--nimi-text-secondary)]' : 'text-[length:var(--nimi-type-body-sm-size)] font-medium uppercase tracking-[0.38em] text-[var(--nimi-text-secondary)]'}>
              Nimi
            </h1>
            <p id={descriptionId} className="mt-2 max-w-xs text-xs leading-relaxed text-[var(--nimi-text-muted)]">
              {title}
            </p>
            <p className="sr-only">{description}</p>

            <button
              type="button"
              aria-label={actionLabel}
              aria-describedby={descriptionId}
              data-testid={props.actionTestId}
              onClick={() => void begin()}
              onMouseEnter={() => setIsLogoHovered(true)}
              onMouseLeave={() => setIsLogoHovered(false)}
              disabled={status === 'pending'}
              className="mt-6 rounded-full bg-[var(--nimi-action-primary-bg)] px-6 py-2.5 text-sm font-medium text-[var(--nimi-action-primary-text)] shadow-sm transition-[background-color,opacity,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:bg-[var(--nimi-action-primary-bg-hover)] active:scale-[var(--nimi-motion-pressed-scale)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--nimi-focus-ring-color)] focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-55 disabled:active:scale-100"
            >
              {actionLabel}
            </button>

            {props.notice && status !== 'pending' ? (
              <p className="mt-3 max-w-sm text-xs text-[var(--nimi-text-muted)]">{props.notice}</p>
            ) : null}

            {status === 'pending' || waitEnded || error ? (
              <div className="mt-12 flex flex-col items-center gap-3">
                {status === 'pending' ? (
                  <>
                    <div aria-hidden className="nimi-shell-auth-dots">
                      <span className="nimi-shell-auth-dot" />
                      <span className="nimi-shell-auth-dot" />
                      <span className="nimi-shell-auth-dot" />
                    </div>
                    <p role="status" className="text-xs text-[var(--nimi-text-muted)]">
                      {props.pendingMessage || '请在浏览器中完成登录'}
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      {reopen ? (
                        <button
                          type="button"
                          onClick={() => { void reopen().catch(() => false); }}
                          className="rounded-full px-3 py-1.5 text-xs text-[var(--nimi-action-primary-bg)] transition-[background-color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:bg-[var(--nimi-action-ghost-hover)] active:scale-[var(--nimi-motion-pressed-scale)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--nimi-focus-ring-color)]"
                        >
                          {props.reopenLabel || '重新打开浏览器'}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={endWait}
                        className="rounded-full px-3 py-1.5 text-xs text-[var(--nimi-text-muted)] transition-[background-color,transform] duration-[var(--nimi-motion-fast)] ease-[var(--nimi-motion-ease-standard)] hover:bg-[var(--nimi-action-ghost-hover)] active:scale-[var(--nimi-motion-pressed-scale)] focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--nimi-focus-ring-color)]"
                      >
                        {props.endWaitLabel || '结束等待'}
                      </button>
                    </div>
                  </>
                ) : null}

                {waitEnded && status === 'idle' ? (
                  <p role="status" className="max-w-sm text-xs text-[var(--nimi-text-muted)]">
                    {props.waitEndedMessage || '已结束等待。如果已在浏览器中完成登录，Nimi 会以账户状态为准自动继续。'}
                  </p>
                ) : null}

                {error ? (
                  <p role="alert" className="max-w-sm text-xs text-[var(--nimi-status-danger)]">{error}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
