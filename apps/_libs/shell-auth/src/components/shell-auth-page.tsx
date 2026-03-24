import {
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { toDesktopBrowserAuthErrorMessage } from '@nimiplatform/shell-core/oauth';
import { useTranslation } from 'react-i18next';
import type { ShellAuthPageProps } from '../types/auth-types.js';
import { useAuthFlow } from '../hooks/use-auth-flow.js';
import { performDesktopWebAuth } from '../logic/desktop-web-auth.js';
import { AnimateIn, LoadingSpinner } from './primitives.js';
import { AuthViewMain } from './auth-view-main.js';
import {
  AuthViewEmailLogin,
  AuthViewEmailOtpVerify,
  AuthViewEmailSetPassword,
  AuthViewEmail2Fa,
} from './auth-view-email.js';
import { AuthViewDesktopAuthorize } from './auth-view-desktop-authorize.js';
import { AuthViewWalletSelect } from './auth-view-wallet-select.js';

function renderLogo(
  logo: ReactNode | string,
  altText: string,
  className: string,
): ReactNode {
  if (typeof logo === 'string') {
    return (
      <img
        src={logo}
        alt={altText}
        draggable={false}
        className={className}
      />
    );
  }

  return (
    <div className={className} aria-hidden="true">
      {logo}
    </div>
  );
}

export function ShellAuthPage(props: ShellAuthPageProps) {
  const { t } = useTranslation();
  const {
    adapter,
    session,
    branding,
    appearance,
    background,
    footer,
    desktopBrowserAuth,
    copy,
    testIds,
  } = props;
  const [isLogoHovered, setIsLogoHovered] = useState(false);
  const [desktopAuthPending, setDesktopAuthPending] = useState(false);
  const [desktopAuthError, setDesktopAuthError] = useState<string | null>(null);
  const desktopAttemptRef = useRef(0);

  const flow = useAuthFlow({
    adapter,
    mode: session.mode,
    authStatus: session.authStatus,
    authToken: session.authToken,
    authUser: session.authUser,
    setAuthSession: session.setAuthSession,
    setStatusBanner: session.setStatusBanner,
  });

  const rootStyle = appearance.rootStyle || {};
  const footerPlacement = appearance.footerPlacement || 'outside-content';
  const renderedBackground = typeof background === 'function'
    ? background({ isLogoHovered, mode: session.mode })
    : background;
  const isEmbedded = session.mode === 'embedded';
  const isLogoStage = flow.view === 'main' && flow.embeddedStage === 'logo';
  const isAuthenticating = flow.pending || desktopAuthPending;
  const displayError = flow.loginError || desktopAuthError || session.authError || null;
  const logoAltText = branding.logoAltText || branding.networkLabel;
  const desktopLogoErrorHintText = desktopAuthError
    ? (copy?.desktopLogoHintText || t('Auth.desktopAuthFailed', 'Authorization failed. Click logo to retry.'))
    : undefined;
  const desktopHintVisibility = desktopBrowserAuth?.hintVisibility || 'always';
  const shouldShowDesktopHint = desktopHintVisibility === 'always'
    || isLogoHovered
    || Boolean(desktopLogoErrorHintText)
    || desktopAuthPending;

  const handleDesktopBrowserAuth = () => {
    if (!desktopBrowserAuth) {
      return;
    }

    const attemptId = ++desktopAttemptRef.current;
    void (async () => {
      setDesktopAuthPending(true);
      setDesktopAuthError(null);

      try {
        const result = await performDesktopWebAuth(desktopBrowserAuth.bridge, {
          baseUrl: desktopBrowserAuth.baseUrl,
          onOpened: () => {
            session.setStatusBanner?.({
              kind: 'info',
              message: copy?.desktopAuthOpenMessage || '已打开浏览器，请在网页完成授权登录。',
            });
          },
        });

        if (attemptId !== desktopAttemptRef.current) {
          return;
        }

        await adapter.applyToken(result.accessToken);
        const user = await adapter.loadCurrentUser();
        session.setAuthSession?.(user, result.accessToken);
        await adapter.syncAfterLogin?.();
        await adapter.onLoginComplete?.();

        session.setStatusBanner?.({
          kind: 'success',
          message: copy?.desktopAuthSuccessMessage || '网页登录授权成功，已登录。',
        });
      } catch (error) {
        if (attemptId !== desktopAttemptRef.current) {
          return;
        }
        const message = toDesktopBrowserAuthErrorMessage(error);
        setDesktopAuthError(message);
        session.setStatusBanner?.({
          kind: 'error',
          message,
        });
      } finally {
        if (attemptId === desktopAttemptRef.current) {
          setDesktopAuthPending(false);
        }
      }
    })();
  };

  const handleRootMouseDown = (event: ReactMouseEvent<HTMLElement>) => {
    desktopBrowserAuth?.onRootPointerDown?.(event);
  };

  const contentClassName = useMemo(() => {
    return [
      'nimi-shell-auth-content',
      appearance.contentClassName || '',
    ].filter(Boolean).join(' ');
  }, [appearance.contentClassName]);

  const shellClassName = useMemo(() => {
    return [
      'nimi-shell-auth-shell',
      appearance.shellClassName || '',
    ].filter(Boolean).join(' ');
  }, [appearance.shellClassName]);

  return (
    <main
      data-auth-mode={session.mode}
      data-shell-auth-theme={appearance.theme}
      data-testid={testIds?.screen}
      className={['nimi-shell-auth-root', appearance.rootClassName || ''].filter(Boolean).join(' ')}
      style={rootStyle}
      onMouseDown={session.mode === 'desktop-browser' ? handleRootMouseDown : undefined}
    >
      {renderedBackground ? (
        <div aria-hidden className="nimi-shell-auth-background">
          {renderedBackground}
        </div>
      ) : null}

      <div className={shellClassName}>
        <div className={contentClassName}>
          {copy?.title || copy?.subtitle ? (
            <div className="nimi-shell-auth-header">
              {copy.title ? <div className="nimi-shell-auth-title">{copy.title}</div> : null}
              {copy.subtitle ? <div className="nimi-shell-auth-subtitle">{copy.subtitle}</div> : null}
            </div>
          ) : null}

          {!isEmbedded ? (
            <div className="pointer-events-auto flex flex-col items-center gap-8">
              <button
                type="button"
                data-testid={testIds?.logoTrigger}
                onClick={handleDesktopBrowserAuth}
                onMouseEnter={() => setIsLogoHovered(true)}
                onMouseLeave={() => setIsLogoHovered(false)}
                disabled={isAuthenticating}
                className="group relative cursor-pointer focus:outline-none"
              >
                {renderLogo(
                  branding.logo,
                  logoAltText,
                  'h-32 w-32 rounded-full object-cover transition-transform duration-200 group-hover:scale-105 select-none pointer-events-none',
                )}
              </button>

              <div className="text-center">
                <h1 className="mb-3 text-[13px] font-medium uppercase tracking-[0.38em] text-[var(--nimi-text-secondary)]">
                  {branding.networkLabel}
                </h1>
                {desktopAuthPending ? (
                  <div className={`transition-opacity duration-500 ${shouldShowDesktopHint ? 'opacity-100' : 'opacity-0'}`}>
                    <LoadingSpinner />
                  </div>
                ) : (
                  <p className={`text-xs text-[var(--nimi-text-muted)] transition-opacity duration-500 ${
                    shouldShowDesktopHint ? 'opacity-100' : 'opacity-0'
                  }`}>
                    {desktopLogoErrorHintText
                      || copy?.desktopLogoIdleHintText
                      || t('Auth.clickToAuthorize')}
                  </p>
                )}
                {desktopAuthError ? (
                  <p className="mt-2 text-xs text-[var(--nimi-status-danger)]">{desktopAuthError}</p>
                ) : null}
              </div>
            </div>
          ) : (
            <div className="pointer-events-auto flex w-full flex-col items-center gap-6">
              <button
                type="button"
                data-testid={testIds?.logoTrigger}
                onClick={() => {
                  if (isLogoStage) {
                    flow.handleEmbeddedLogoClick();
                  } else {
                    flow.handleHeaderBack();
                  }
                }}
                onMouseEnter={() => setIsLogoHovered(true)}
                onMouseLeave={() => setIsLogoHovered(false)}
                disabled={flow.pending}
                className="group relative cursor-pointer focus:outline-none transition-all duration-500 ease-out"
              >
                {renderLogo(
                  branding.logo,
                  logoAltText,
                  `rounded-full object-cover select-none pointer-events-none transition-all duration-500 ease-out ${
                    isLogoStage
                      ? 'h-32 w-32 group-hover:scale-105'
                      : 'h-16 w-16'
                  }`,
                )}
              </button>

              {isLogoStage ? (
                <AnimateIn className="text-center" delay={100}>
                  <h1 className="text-[13px] font-medium uppercase tracking-[0.38em] text-[var(--nimi-text-secondary)]">
                    {branding.networkLabel}
                  </h1>
                </AnimateIn>
              ) : null}

              {flow.view === 'main' && flow.embeddedStage === 'email' ? (
                <AnimateIn className="w-full">
                  <AuthViewMain
                    email={flow.email}
                    pending={flow.pending}
                    showAlternatives={flow.showAlternatives}
                    googleDisabledReason={t('Auth.comingSoon')}
                    twitterDisabledReason={t('Auth.comingSoon')}
                    tikTokDisabledReason={t('Auth.comingSoon')}
                    onEmailChange={flow.setEmail}
                    onContinue={flow.handleInlineEmailContinue}
                    onAlternativeToggle={() => flow.setShowAlternatives((current) => !current)}
                    onGoogleLogin={flow.handleGoogleLogin}
                    onTwitterLogin={flow.handleTwitterLogin}
                    onTikTokLogin={flow.handleTikTokLogin}
                    onWeb3Login={flow.handleWeb3Login}
                    testIds={{
                      emailInput: testIds?.emailInput,
                      emailSubmitArrow: testIds?.emailSubmitArrow,
                      alternativeToggle: testIds?.alternativeToggle,
                      alternativePanel: testIds?.alternativePanel,
                    }}
                  />
                </AnimateIn>
              ) : null}

              {flow.view === 'main' && flow.embeddedStage === 'email' ? (
                <div className={`w-full origin-top transition-all duration-200 ease-out ${
                  flow.showRegisterConfirm
                    ? 'scale-100 opacity-100'
                    : 'pointer-events-none h-0 scale-95 opacity-0'
                }`}>
                  <div className="nimi-shell-auth-inline-card rounded-2xl p-5">
                    <p className="nimi-shell-auth-inline-label mb-1 text-center text-sm font-medium">
                      {t('Auth.emailNotRegistered')}
                    </p>
                    <p className="nimi-shell-auth-inline-help mb-4 text-center text-xs">
                      {t('Auth.registerConfirmHint')}
                    </p>
                    <div className="flex items-center justify-center gap-3">
                      <button
                        type="button"
                        onClick={flow.handleCancelRegister}
                        className="rounded-full border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-5 py-2 text-sm font-medium text-[var(--nimi-text-muted)] transition hover:border-[var(--nimi-border-subtle)]"
                      >
                        {t('Auth.cancel')}
                      </button>
                      <button
                        type="button"
                        onClick={flow.handleConfirmRegister}
                        disabled={flow.pending}
                        className="rounded-full bg-[var(--nimi-action-primary-bg)] px-5 py-2 text-sm font-medium text-[var(--nimi-action-primary-text)] transition hover:bg-[var(--nimi-action-primary-bg-hover)] disabled:opacity-50"
                      >
                        {t('Auth.confirmRegister')}
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}

              {flow.view === 'main' && flow.embeddedStage === 'credential' && flow.supportsPasswordLogin ? (
                <AnimateIn className="w-full">
                  <AuthViewEmailLogin
                    email={flow.email}
                    password={flow.password}
                    pending={flow.pending}
                    onPasswordChange={flow.setPassword}
                    onSubmit={flow.handleEmailLogin}
                    onUseEmailCodeInstead={flow.handleInlineOtpRequest}
                    testIds={{
                      passwordInput: testIds?.passwordInput,
                      otpButton: testIds?.otpButton,
                    }}
                  />
                </AnimateIn>
              ) : null}

              {flow.view === 'desktop_authorize' ? (
                <AnimateIn className="w-full">
                  <AuthViewDesktopAuthorize
                    authStatus={session.authStatus || ''}
                    desktopCallbackUserLabel={flow.desktopCallbackUserLabel}
                    pending={flow.pending}
                    onSubmit={flow.handleConfirmDesktopAuth}
                    onUseAnotherAccount={flow.handleUseAnotherDesktopAccount}
                  />
                </AnimateIn>
              ) : null}

              {flow.view === 'email_otp_verify' ? (
                <AnimateIn className="w-full">
                  <AuthViewEmailOtpVerify
                    email={flow.email}
                    otpCode={flow.otpCode}
                    otpResendCountdown={flow.otpResendCountdown}
                    pending={flow.pending}
                    onOtpCodeChange={flow.setOtpCode}
                    onSubmit={flow.handleOtpVerify}
                    onResendOtp={flow.handleResendOtp}
                  />
                </AnimateIn>
              ) : null}

              {flow.view === 'email_set_password' && flow.pendingTokens ? (
                <AnimateIn className="w-full">
                  <AuthViewEmailSetPassword
                    password={flow.password}
                    confirmPassword={flow.confirmPassword}
                    showPassword={flow.showPassword}
                    showConfirmPassword={flow.showConfirmPassword}
                    pending={flow.pending}
                    onPasswordChange={flow.setPassword}
                    onConfirmPasswordChange={flow.setConfirmPassword}
                    onShowPasswordToggle={() => flow.setShowPassword(!flow.showPassword)}
                    onShowConfirmPasswordToggle={() => flow.setShowConfirmPassword(!flow.showConfirmPassword)}
                    onSubmit={flow.handleSetPasswordAfterOtp}
                  />
                </AnimateIn>
              ) : null}

              {flow.view === 'email_2fa' ? (
                <AnimateIn className="w-full">
                  <AuthViewEmail2Fa
                    twoFactorCode={flow.twoFactorCode}
                    pending={flow.pending}
                    onTwoFactorCodeChange={flow.setTwoFactorCode}
                    onSubmit={flow.handleVerify2Fa}
                  />
                </AnimateIn>
              ) : null}

              {flow.view === 'wallet_select' ? (
                <AnimateIn className="w-full">
                  <AuthViewWalletSelect
                    pending={flow.pending}
                    onWalletLogin={flow.handleWalletLogin}
                  />
                </AnimateIn>
              ) : null}

              {displayError && !flow.pending ? (
                <AnimateIn>
                  <p className="text-center text-xs text-[var(--nimi-status-danger)]">{displayError}</p>
                </AnimateIn>
              ) : null}
            </div>
          )}

          {footer && footerPlacement === 'inside-content' ? (
            <div className="pointer-events-auto w-full">
              {footer}
            </div>
          ) : null}
        </div>

        {footer && footerPlacement === 'outside-content' ? (
          <div className="pointer-events-auto w-full">
            {footer}
          </div>
        ) : null}
      </div>
    </main>
  );
}
