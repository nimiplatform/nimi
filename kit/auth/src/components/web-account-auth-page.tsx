import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Surface } from '@nimiplatform/kit/ui';
import { motion, nimiOverlayPanelMotion, nimiSpring, useNimiReducedMotion } from '@nimiplatform/kit/ui/motion';
import { buttonBase, type WebAccountAuthPageProps } from '../types/auth-types.js';
import { useAuthFlow } from '../hooks/use-auth-flow.js';
import { AnimateIn } from './primitives.js';
import { AuthViewMain } from './auth-view-main.js';
import {
  AuthViewEmailLogin,
  AuthViewEmailOtpVerify,
  AuthViewEmailSetPassword,
  AuthViewEmail2Fa,
} from './auth-view-email.js';
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
    alternatives,
    consent,
    background,
    header,
    footer,
    copy,
    semanticIds,
    testIds,
  } = props;
  const [isLogoHovered, setIsLogoHovered] = useState(false);
  const [consentPrompted, setConsentPrompted] = useState(false);
  const actionableReadyReportedRef = useRef(false);
  const consentInputRef = useRef<HTMLInputElement | null>(null);
  const consentId = useId();
  const consentLabelId = `${consentId}-label`;
  const reducedMotion = useNimiReducedMotion();
  const confirmPanelMotion = nimiOverlayPanelMotion({ kind: 'popover', side: 'bottom', reducedMotion });

  const flow = useAuthFlow({
    adapter,
    mode: session.mode,
    initialStage: props.initialStage,
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
  const logoInteractive = isLogoStage || props.initialStage !== 'email';
  const actionableLogoReady = !flow.pending && isLogoStage;
  const activeConsentError = consent && !consent.checked && consentPrompted
    ? consent.requiredMessage
    : null;
  const displayError = activeConsentError || flow.loginError || session.authError || null;
  const ensureConsent = (): boolean => {
    if (!consent || consent.checked) {
      if (consentPrompted) setConsentPrompted(false);
      return true;
    }
    setConsentPrompted(true);
    consentInputRef.current?.focus();
    return false;
  };
  const logoAltText = branding.logoAltText || branding.networkLabel;
  const entryLabel = t('Auth.signIn', { defaultValue: 'Sign in to Nimi' });
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

      {header ? (
        <div className="nimi-shell-auth-topbar">
          {header}
        </div>
      ) : null}

      <div className={shellClassName}>
        <div className={contentClassName}>
          <div className="pointer-events-auto flex w-full flex-col items-center gap-6">
              <div className="flex w-full flex-col items-center gap-3">
                {logoInteractive ? (
                  <button
                    type="button"
                    aria-label={isLogoStage ? entryLabel : t('Common.back', { defaultValue: 'Back' })}
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
                    className="group relative cursor-pointer rounded-2xl transition-transform duration-[var(--nimi-motion-fast,120ms)] ease-[var(--nimi-motion-ease-standard)] active:scale-[var(--nimi-motion-pressed-scale,0.97)] focus-visible:outline-2 focus-visible:outline-offset-8 focus-visible:outline-[var(--nimi-focus-ring-color)]"
                  >
                    <motion.div
                      animate={{ scale: isLogoStage ? 1 : 0.5 }}
                      transition={reducedMotion ? { duration: 0 } : nimiSpring('default')}
                      className={isLogoStage ? 'h-32 w-32' : 'h-16 w-16 flex items-center justify-center'}
                    >
                      {renderLogo(
                        branding.logo,
                        logoAltText,
                        `h-32 w-32 shrink-0 rounded-full object-cover select-none pointer-events-none transition-transform duration-[var(--nimi-motion-base,200ms)] ease-[var(--nimi-motion-ease-standard)] ${
                          isLogoStage ? 'group-hover:scale-105' : ''
                        }`,
                      )}
                    </motion.div>
                  </button>
                ) : (
                  <div
                    data-testid={testIds?.logoTrigger}
                    onMouseEnter={() => setIsLogoHovered(true)}
                    onMouseLeave={() => setIsLogoHovered(false)}
                    className="relative rounded-2xl"
                  >
                    {renderLogo(
                      branding.logo,
                      logoAltText,
                      'h-16 w-16 rounded-full object-cover select-none pointer-events-none',
                    )}
                  </div>
                )}

                {copy?.title || copy?.subtitle ? (
                  <div className="nimi-shell-auth-header">
                    {copy.title ? <h1 className="nimi-shell-auth-title">{copy.title}</h1> : null}
                    {copy.subtitle ? <p className="nimi-shell-auth-subtitle">{copy.subtitle}</p> : null}
                  </div>
                ) : null}
              </div>

              {flow.view === 'main' && flow.embeddedStage === 'email' ? (
                <AnimateIn className="w-full">
                  <AuthViewMain
                    email={flow.email}
                    pending={flow.pending}
                    showAlternatives={flow.showAlternatives}
                    googleDisabledReason={alternatives?.googleDisabledReason}
                    tikTokDisabledReason={alternatives?.tikTokDisabledReason}
                    onEmailChange={flow.setEmail}
                    onContinue={(event) => {
                      if (!flow.email.trim()) {
                        flow.handleInlineEmailContinue(event);
                        return;
                      }
                      if (!ensureConsent()) {
                        event.preventDefault();
                        return;
                      }
                      flow.handleInlineEmailContinue(event);
                    }}
                    onAlternativeToggle={() => {
                      const next = !flow.showAlternatives;
                      if (next) flow.handleCancelRegister();
                      flow.setShowAlternatives(next);
                    }}
                    onGoogleLogin={() => {
                      if (!ensureConsent()) return;
                      flow.handleGoogleLogin();
                    }}
                    onTikTokLogin={() => {
                      if (!ensureConsent()) return;
                      flow.handleTikTokLogin();
                    }}
                    testIds={{
                      emailInput: testIds?.emailInput,
                      emailSubmitArrow: testIds?.emailSubmitArrow,
                      alternativeToggle: testIds?.alternativeToggle,
                      alternativePanel: testIds?.alternativePanel,
                    }}
                  />
                  {consent ? (
                    <div
                      className="nimi-shell-auth-consent"
                      lang={consent.lang}
                      data-invalid={activeConsentError ? 'true' : undefined}
                    >
                      <span className="nimi-shell-auth-consent-control">
                        <input
                          ref={consentInputRef}
                          id={consentId}
                          type="checkbox"
                          data-testid={testIds?.consentCheckbox}
                          checked={consent.checked}
                          disabled={flow.pending}
                          aria-invalid={activeConsentError ? true : undefined}
                          aria-labelledby={consentLabelId}
                          onChange={(event) => {
                            const next = event.currentTarget.checked;
                            consent.onChange(next);
                            if (next) setConsentPrompted(false);
                          }}
                        />
                        <span className="nimi-shell-auth-consent-box" aria-hidden="true">
                          <svg viewBox="0 0 12 12" fill="none">
                            <path
                              d="M2.5 6.2 4.9 8.6 9.5 3.6"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </span>
                      </span>
                      <span id={consentLabelId} className="nimi-shell-auth-consent-text">
                        {typeof consent.label === 'function' ? consent.label(consentId) : consent.label}
                      </span>
                    </div>
                  ) : null}
                </AnimateIn>
              ) : null}

              {flow.view === 'main' && flow.embeddedStage === 'email' && flow.showRegisterConfirm ? (
                <motion.div
                  className="w-full"
                  initial={confirmPanelMotion.initial}
                  animate={confirmPanelMotion.animate}
                  transition={confirmPanelMotion.transition}
                  style={confirmPanelMotion.style}
                >
                    <Surface material="glass-regular" tone="overlay" elevation="floating" padding="none" className="rounded-2xl p-5">
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
                          className={`${buttonBase} rounded-full border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-5 py-2 text-[var(--nimi-text-muted)] hover:border-[var(--nimi-border-strong)] hover:text-[var(--nimi-text-primary)]`}
                        >
                          {t('Auth.cancel')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (!ensureConsent()) return;
                            flow.handleConfirmRegister();
                          }}
                          disabled={flow.pending}
                          className={`${buttonBase} rounded-full bg-[var(--nimi-action-primary-bg)] px-5 py-2 text-[var(--nimi-action-primary-text)] hover:bg-[var(--nimi-action-primary-bg-hover)]`}
                        >
                          {t('Auth.confirmRegister')}
                        </button>
                      </div>
                    </Surface>
                  </motion.div>
                ) : null}

              {flow.view === 'main' && flow.embeddedStage === 'credential' && flow.supportsPasswordLogin ? (
                <AnimateIn className="w-full">
                  <AuthViewEmailLogin
                    passwordRecoveryLink={props.passwordRecoveryLink}
                    email={flow.email}
                    password={flow.password}
                    pending={flow.pending}
                    onPasswordChange={flow.setPassword}
                    onSubmit={flow.handleEmailLogin}
                    onUseEmailCodeInstead={flow.handleInlineOtpRequest}
                    onBack={flow.handleHeaderBack}
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
                    onBack={flow.handleHeaderBack}
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
                    onBack={flow.handleHeaderBack}
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
                    onBack={flow.handleHeaderBack}
                  />
                </AnimateIn>
              ) : null}

              {displayError && !flow.pending ? (
                <AnimateIn>
                  <p role="alert" className="text-center text-xs text-[var(--nimi-status-danger)]">{displayError}</p>
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
