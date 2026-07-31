import {
  useCallback,
  useMemo,
  type MouseEvent,
} from 'react';
import authLogoImage from '../../assets/logo.png';
import { useAppStore } from '../../app-shell/providers/app-store';
import type { WebAuthMenuMode } from '@nimiplatform/kit/auth/shell';
import { DesktopShellAuthPage } from '@nimiplatform/kit/auth';
import { nimiToast } from '@nimiplatform/kit/ui';
import { toNimiRealmAuthUserRecord } from '@nimiplatform/sdk/realm';
import { E2E_IDS } from '../../testability/e2e-ids';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export function WebAuthMenu(props: { mode?: WebAuthMenuMode }) {
  const mode = props.mode || 'embedded';
  const bindings = useDesktopRendererBindings();
  const auth = bindings.app.commands.auth;
  const adapter = useMemo(() => auth.adapter, [auth]);
  const authStatus = useAppStore((state) => state.auth.status);
  const authUser = useAppStore((state) => state.auth.user);
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  const reportActionableReadiness = useCallback(() => {
    bindings.surfaceLifecycle.reportReadyCandidate();
  }, [bindings]);
  const normalizedAuthUser = toNimiRealmAuthUserRecord(authUser);
  const handleStatusBanner = (banner: { kind: string; message: string } | null) => {
    if (!banner) {
      return;
    }
    const kind = String(banner.kind || 'info');
    nimiToast.show({
      tone: kind === 'error'
        ? 'danger'
        : kind === 'warning'
          ? 'warning'
          : kind === 'success'
            ? 'success'
            : 'info',
      message: banner.message,
    });
  };

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

    void bindings.app.commands.startWindowDrag().catch(() => {
      // no-op
    });
  };

  return (
    <DesktopShellAuthPage
      adapter={adapter}
      logo={authLogoImage}
      logoAltText="Nimi Logo"
      session={{
        mode,
        authStatus,
        authUser: normalizedAuthUser,
        setAuthSession: (user) => setAuthSession(user),
        setStatusBanner: handleStatusBanner,
      }}
      onActionableReady={reportActionableReadiness}
      onEntryAction={() => {
        void bindings.app.commands.reportAuthEntryAction();
      }}
      semanticIds={{ entryAction: 'desktop-login-primary' }}
      desktopBrowserAuth={
        mode === 'desktop-browser'
          ? {
              bridge: auth.oauthBridge,
              onRootPointerDown: handleRootMouseDown,
              runtimeAccountBroker: auth.runtimeAccountBroker,
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
