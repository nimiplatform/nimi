import {
  Suspense,
  lazy,
  useMemo,
  type MouseEvent,
} from 'react';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import type { WebAuthMenuMode } from '@nimiplatform/shell-auth';
import { DesktopShellAuthPage } from '@nimiplatform/shell-auth';
import '@nimiplatform/shell-auth/styles.css';
import { desktopOAuthBridge } from './desktop-auth-adapter.js';
import { createDesktopAuthAdapter } from './desktop-auth-adapter.js';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import type { StatusBanner } from '@renderer/app-shell/providers/store-types.js';

export type { WebAuthMenuMode } from '@nimiplatform/shell-auth';

const SlotHost = lazy(async () => {
  const mod = await import('@renderer/mod-ui/host/slot-host');
  return { default: mod.SlotHost };
});

function toAuthUserRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export function WebAuthMenu(props: { mode?: WebAuthMenuMode }) {
  const flags = getShellFeatureFlags();
  const context = useUiExtensionContext();
  const mode = props.mode || 'embedded';
  const adapter = useMemo(() => createDesktopAuthAdapter(), []);
  const authStatus = useAppStore((state) => state.auth.status);
  const authToken = useAppStore((state) => state.auth.token);
  const authUser = useAppStore((state) => state.auth.user);
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const normalizedAuthUser = toAuthUserRecord(authUser);
  const handleStatusBanner = (banner: { kind: string; message: string } | null) => {
    if (!banner) {
      setStatusBanner(null);
      return;
    }
    setStatusBanner(banner as StatusBanner);
  };
  const footer = flags.enableModUi && mode === 'embedded' ? (
    <Suspense fallback={null}>
      <SlotHost slot="auth.login.form.footer" base={null} context={context} />
    </Suspense>
  ) : null;

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
        authToken,
        authUser: normalizedAuthUser,
        setAuthSession,
        setStatusBanner: handleStatusBanner,
      }}
      footer={footer}
      desktopBrowserAuth={
        mode === 'desktop-browser'
          ? {
              bridge: desktopOAuthBridge,
              onRootPointerDown: handleRootMouseDown,
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
