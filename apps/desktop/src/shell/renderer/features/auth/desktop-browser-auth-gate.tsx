import { useCallback, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import authLogoImage from '../../assets/logo.png';
import { useAppStore } from '../../app-shell/providers/app-store';
import { DesktopBrowserAuthGate } from '@nimiplatform/kit/auth/shell';
import { E2E_IDS } from '../../testability/e2e-ids';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';

export function DesktopBrowserAuthGateSurface(props: { notice?: string | null; autoStart?: boolean }) {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const auth = bindings.app.commands.auth;
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  const reportActionableReadiness = useCallback(() => {
    bindings.surfaceLifecycle.reportReadyCandidate();
  }, [bindings]);

  const handleRootMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('button, input, textarea, select, a, [role="button"], [role="link"], [data-no-drag]')) return;
    void bindings.app.commands.startWindowDrag().catch(() => undefined);
  };

  return (
    <DesktopBrowserAuthGate
      bridge={auth.oauthBridge}
      runtimeAccountBroker={auth.runtimeAccountBroker}
      logo={<img src={authLogoImage} alt="Nimi Logo" className="h-full w-full object-contain" />}
      notice={props.notice}
      title={t('Auth.browserSignInTitle', { defaultValue: '在浏览器中安全登录 Nimi' })}
      description={t('Auth.browserSignInDescription', { defaultValue: 'Nimi 账号凭据只在网页中输入。完成后，浏览器会安全返回此设备。' })}
      continueLabel={t('Auth.browserSignInContinue', { defaultValue: '继续登录' })}
      pendingMessage={t('Auth.browserSignInPending', { defaultValue: '请在浏览器中完成登录' })}
      retryLabel={t('Auth.browserSignInRetry', { defaultValue: '重试' })}
      onRootPointerDown={handleRootMouseDown}
      onAuthenticated={(user) => setAuthSession(user)}
      onActionableReady={reportActionableReadiness}
      onEntryAction={() => { void bindings.app.commands.reportAuthEntryAction(); }}
      screenTestId={E2E_IDS.loginScreen}
      actionTestId={E2E_IDS.loginContinueButton}
      autoStart={props.autoStart}
    />
  );
}
