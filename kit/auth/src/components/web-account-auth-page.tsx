import {
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { WebAccountAuthPageProps } from '../types/auth-types.js';
import { useAuthFlow } from '../hooks/use-auth-flow.js';
import { AnimateIn } from './primitives.js';
import { AuthViewMain } from './auth-view-main.js';
import {
  AuthViewEmailLogin,
  AuthViewEmailOtpVerify,
  AuthViewEmailSetPassword,
  AuthViewEmail2Fa,
} from './auth-view-email.js';
import { AuthViewWalletSelect } from './auth-view-wallet-select.js';
import { AuthVisualBackground } from './auth-visual-background.js';

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

export function WebAccountAuthPage(props: WebAccountAuthPageProps) {
  const { t } = useTranslation();
  const {
    adapter,
    session,
    branding,
    appearance,
    background,
    footer,
    copy,
    semanticIds,
    testIds,
  } = props;
  const [isLogoHovered, setIsLogoHovered] = useState(false);
  const actionableReadyReportedRef = useRef(false);

  const flow = useAuthFlow({
    adapter,
    mode: session.mode,
    authStatus: session.authStatus,
    authUser: session.authUser,
    setAuthSession: session.setAuthSession,
    setStatusBanner: session.setStatusBanner,
  });

  const rootStyle = appearance.rootStyle || {};
  const footerPlacement = appearance.footerPlacement || 'outside-content';
  const renderedBackground = background === undefined
    ? <AuthVisualBackground isLogoHovered={isLogoHovered} profile="web" />
    : typeof background === 'function'
      ? background({ isLogoHovered, mode: session.mode })
      : background;
  const isLogoStage = flow.view === 'main' && flow.embeddedStage === 'logo';
  const actionableLogoReady = !flow.pending && isLogoStage;
  const displayError = flow.loginError || session.authError || null;
  const logoAltText = branding.logoAltText || branding.networkLabel;
  useLayoutEffect(() => {
    if (!actionableLogoReady || actionableReadyReportedRef.current) return;
    actionableReadyReportedRef.current = true;
    props.onActionableReady?.();
  }, [actionableLogoReady, props.onActionableReady]);

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
      className={['nimi-shell-auth-root', 'nimi-shell-auth-brand-surface', appearance.rootClassName || ''].filter(Boolean).join(' ')}
      style={rootStyle}
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

          <div className="pointer-events-auto flex w-full flex-col items-center gap-6">
              <button
                type="button"
                aria-label={isLogoStage ? logoAltText : t('Common.back', { defaultValue: 'Back' })}
                data-nimi-semantic-id={isLogoStage ? semanticIds?.entryAction : undefined}
                data-testid={testIds?.logoTrigger}
                onClick={() => {
                  if (isLogoStage) {
                    props.onEntryAction?.();
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
                    onEmailChange={flow.setEmail}
                    onContinue={flow.handleInlineEmailContinue}
                    onAlternativeToggle={() => flow.setShowAlternatives((current) => !current)}
                    onGoogleLogin={flow.handleGoogleLogin}
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

              {flow.view === 'email_set_password' && flow.pendingPasswordSetup ? (
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
