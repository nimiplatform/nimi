import {
  useMemo,
  useState,
  type MouseEvent,
} from 'react';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { WebAuthMenuMode } from '@nimiplatform/kit/auth';
import { DesktopShellAuthPage } from '@nimiplatform/kit/auth';
import '@nimiplatform/kit/auth/styles.css';
import { toRealmAuthUserRecord } from '@nimiplatform/sdk/realm';
import {
  createDesktopAuthAdapter,
  createDesktopRuntimeAccountBrowserBroker,
  desktopOAuthBridge,
} from './desktop-auth-adapter.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { InlineFeedback, type InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';

export function WebAuthMenu(props: { mode?: WebAuthMenuMode }) {
  const mode = props.mode || 'embedded';
  const adapter = useMemo(() => createDesktopAuthAdapter(), []);
  const runtimeAccountBroker = useMemo(() => createDesktopRuntimeAccountBrowserBroker(), []);
  const authStatus = useAppStore((state) => state.auth.status);
  const authUser = useAppStore((state) => state.auth.user);
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  const [authFeedback, setAuthFeedback] = useState<InlineFeedbackState | null>(null);
  const normalizedAuthUser = toRealmAuthUserRecord(authUser);
  const handleStatusBanner = (banner: { kind: string; message: string } | null) => {
    if (!banner) {
      setAuthFeedback(null);
      return;
    }
    if (banner.kind === 'error' || banner.kind === 'warning') {
      setAuthFeedback(banner as InlineFeedbackState);
      return;
    }
    setAuthFeedback(null);
  };
  const footer = (
    <div className="space-y-3">
      {authFeedback ? (
        <InlineFeedback feedback={authFeedback} onDismiss={() => setAuthFeedback(null)} />
      ) : null}
    </div>
  );

  const handleRootMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (mode !== 'desktop-browser') {
      return;
    }
    if (event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement | null;
    if (!target) {
      return;
    }
    if (
      target.closest(
        'button, input, textarea, select, option, a, label, summary, [role="button"], [role="link"], [contenteditable="true"], [data-no-drag]',
      )
    ) {
      return;
    }

    void desktopBridge.startWindowDrag().catch(() => {
      // no-op
    });
  };

  return (
    <DesktopShellAuthPage
      adapter={adapter}
      session={{
        mode,
        authStatus,
        authUser: normalizedAuthUser,
        setAuthSession: (user) => setAuthSession(user),
        setStatusBanner: handleStatusBanner,
      }}
      footer={footer}
      desktopBrowserAuth={
        mode === 'desktop-browser'
          ? {
              bridge: desktopOAuthBridge,
              onRootPointerDown: handleRootMouseDown,
              runtimeAccountBroker,
            }
          : undefined
      }
      testIds={{
        screen: E2E_IDS.loginScreen,
        logoTrigger: E2E_IDS.loginLogoTrigger,
        emailInput: E2E_IDS.loginEmailInput,
        emailSubmitArrow: E2E_IDS.loginEmailSubmitArrow,
        alternativeToggle: E2E_IDS.loginAlternativeToggle,
        alternativePanel: E2E_IDS.loginAlternativePanel,
        passwordInput: E2E_IDS.loginPasswordInput,
        otpButton: E2E_IDS.loginOtpButton,
      }}
    />
  );
}
