import { useCallback, useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { ShellOAuthCodeBridge } from '@nimiplatform/kit/core/oauth';
import { performDesktopBrowserAuth } from '../logic/desktop-browser-auth.js';
import { toDesktopBrowserAuthErrorMessage } from '../logic/oauth-helpers.js';
import type { DesktopBrowserAuthRuntimeBroker } from '../types/auth-types.js';

export type DesktopBrowserAuthGateProps = {
  bridge: ShellOAuthCodeBridge;
  runtimeAccountBroker: DesktopBrowserAuthRuntimeBroker;
  logo?: ReactNode;
  title?: string;
  description?: string;
  continueLabel?: string;
  pendingMessage?: string;
  retryLabel?: string;
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
  const autoStartedRef = useRef(false);
  const descriptionId = useId();

  const begin = useCallback(async () => {
    props.onEntryAction?.();
    setStatus('pending');
    setError(null);
    try {
      const result = await performDesktopBrowserAuth(props.bridge, {
        runtimeAccountBroker: props.runtimeAccountBroker,
      });
      if (!result.user) {
        throw new Error('Runtime completed login without an authenticated account projection.');
      }
      props.onAuthenticated(result.user);
    } catch (reason) {
      setStatus('error');
      setError(toDesktopBrowserAuthErrorMessage(reason));
    }
  }, [props]);

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
      className="nimi-shell-auth-root nimi-shell-auth-clean-surface absolute inset-0 z-10"
      data-shell-auth-theme="custom"
      data-testid={props.screenTestId}
      onMouseDown={props.onRootPointerDown}
    >
      <div className="nimi-shell-auth-shell absolute inset-0 z-10 !p-0">
        <section className="nimi-shell-auth-content">
          <div className="pointer-events-auto flex flex-col items-center text-center">
            <button
              type="button"
              aria-label={actionLabel}
              aria-describedby={descriptionId}
              data-testid={props.actionTestId}
              disabled={status === 'pending'}
              onClick={() => void begin()}
              className="group relative cursor-pointer rounded-full focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--nimi-focus-ring-color)] disabled:cursor-wait"
            >
              {props.logo ? (
                <span className="block h-24 w-24 select-none transition-transform duration-200 ease-out group-hover:scale-105 group-disabled:scale-100">
                  {props.logo}
                </span>
              ) : null}
            </button>

            <h1 className="mt-10 text-[30px] font-medium leading-snug text-[var(--nimi-text-primary)]">
              Nimi Ecosystem
            </h1>
            <p id={descriptionId} className="sr-only">{title}. {description}</p>

            {props.notice && status !== 'pending' ? (
              <p className="mt-3 max-w-sm text-xs text-[var(--nimi-text-muted)]">{props.notice}</p>
            ) : null}

            <div className="mt-12 flex flex-col items-center gap-3">
              <div aria-hidden className="nimi-shell-auth-dots">
                <span className="nimi-shell-auth-dot" />
                <span className="nimi-shell-auth-dot" />
                <span className="nimi-shell-auth-dot" />
              </div>

              {status === 'pending' ? (
                <p role="status" className="text-xs text-[var(--nimi-text-muted)]">
                  {props.pendingMessage || '请在浏览器中完成登录'}
                </p>
              ) : (
                <p className="text-xs text-[var(--nimi-text-muted)]">{actionLabel}</p>
              )}

              {error ? (
                <p role="alert" className="max-w-sm text-xs text-[var(--nimi-status-danger)]">{error}</p>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
