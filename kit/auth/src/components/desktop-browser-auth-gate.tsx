import { useCallback, useEffect, useId, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { ShellOAuthCodeBridge } from '@nimiplatform/kit/core/oauth';
import { performDesktopBrowserAuth } from '../logic/desktop-browser-auth.js';
import { toDesktopBrowserAuthErrorMessage } from '../logic/oauth-helpers.js';
import type { DesktopBrowserAuthRuntimeBroker } from '../types/auth-types.js';
import { AuthVisualBackground } from './auth-visual-background.js';
import { LoadingSpinner } from './primitives.js';

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
  const [isLogoHovered, setIsLogoHovered] = useState(false);
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
  const shouldShowHint = isLogoHovered || status !== 'idle' || Boolean(props.notice);

  return (
    <main
      className="nimi-shell-auth-root nimi-shell-auth-brand-surface absolute inset-0 z-10"
      data-shell-auth-theme="custom"
      data-testid={props.screenTestId}
      onMouseDown={props.onRootPointerDown}
    >
      <div aria-hidden className="nimi-shell-auth-background">
        <AuthVisualBackground isLogoHovered={isLogoHovered} profile="desktop" />
      </div>

      <div className="nimi-shell-auth-shell absolute inset-0 z-10 !p-0">
        <section className="nimi-shell-auth-content">
          <div className="pointer-events-auto flex flex-col items-center gap-8 text-center">
            <button
              type="button"
              aria-label={actionLabel}
              aria-describedby={descriptionId}
              data-testid={props.actionTestId}
              disabled={status === 'pending'}
              onClick={() => void begin()}
              onMouseEnter={() => setIsLogoHovered(true)}
              onMouseLeave={() => setIsLogoHovered(false)}
              className="group relative cursor-pointer rounded-full focus:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--nimi-focus-ring-color)] disabled:cursor-wait"
            >
              {props.logo ? (
                <span className="block h-32 w-32 select-none overflow-hidden rounded-full transition-transform duration-200 ease-out group-hover:scale-105 group-disabled:scale-100">
                  {props.logo}
                </span>
              ) : null}
            </button>

            <div className="min-h-16 text-center">
              <h1 className="mb-3 text-[13px] font-medium uppercase tracking-[0.38em] text-[var(--nimi-text-secondary)]">
                Nimi
              </h1>
              <p id={descriptionId} className="sr-only">{title}. {description}</p>

              {props.notice && status !== 'pending' ? (
                <p className="mb-2 max-w-sm text-xs text-[var(--nimi-text-muted)]">{props.notice}</p>
              ) : null}

              {status === 'pending' ? (
                <div role="status" className="flex flex-col items-center gap-2 text-xs text-[var(--nimi-text-muted)]">
                  <LoadingSpinner />
                  <span>{props.pendingMessage || '请在浏览器中完成登录'}</span>
                </div>
              ) : (
                <p className={`text-xs text-[var(--nimi-text-muted)] transition-opacity duration-500 ${
                  shouldShowHint ? 'opacity-100' : 'opacity-0'
                }`}>
                  {actionLabel}
                </p>
              )}

              {error ? (
                <p role="alert" className="mt-2 max-w-sm text-xs text-[var(--nimi-status-danger)]">{error}</p>
              ) : null}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
