import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import type { AuthTokensDto } from '@nimiplatform/sdk/realm';
import type {
  AuthMenuProps,
  AuthView,
  EmbeddedAuthStage,
} from './auth-helpers.js';
import {
  dataSync,
  getUserDisplayLabel,
  loadPersistedAuthSession,
  resolveDesktopCallbackRequestFromLocation,
  WEB_AUTH_SESSION_KEY,
} from './auth-helpers.js';
import { resolveEmailEntryRoute } from './auth-email-flow.js';
import logoUrl from '@renderer/assets/logo.png';
import type { AuthMenuSetters, DesktopCallbackContext } from './auth-menu-handlers.js';
import {
  handleEmailLogin as doEmailLogin,
  handleSetPasswordAfterOtp as doSetPasswordAfterOtp,
} from './auth-menu-handlers.js';
import {
  handleRequestEmailOtp as doRequestEmailOtp,
  handleVerifyEmailOtp as doVerifyEmailOtp,
  handleResendOtp as doResendOtp,
  handleVerify2Fa as doVerify2Fa,
  handleConfirmDesktopAuthorization as doConfirmDesktopAuth,
  handleWalletLogin as doWalletLogin,
} from './auth-menu-handlers-ext.js';
import { AuthViewMain } from './auth-view-main.js';
import {
  AuthViewEmailLogin,
  AuthViewEmailSetPassword,
  AuthViewEmailOtpVerify,
  AuthViewEmail2Fa,
} from './auth-view-email.js';
import { AuthViewDesktopAuthorize } from './auth-view-desktop.js';
import { AuthViewWalletSelect } from './auth-view-wallet.js';

const SlotHost = lazy(async () => {
  const mod = await import('@renderer/mod-ui/host/slot-host');
  return { default: mod.SlotHost };
});

function LoadingSpinner({ className = '' }: { className?: string }) {
  return (
    <div className={`flex items-center justify-center gap-1 ${className}`}>
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#4ECCA3]" style={{ animationDelay: '0ms' }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#4ECCA3]" style={{ animationDelay: '150ms' }} />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-[#4ECCA3]" style={{ animationDelay: '300ms' }} />
    </div>
  );
}

function AnimateIn({ children, className = '', delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(true), Math.max(delay, 16));
    return () => clearTimeout(timer);
  }, [delay]);

  return (
    <div
      className={`transition-all duration-300 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-3'
      } ${className}`}
    >
      {children}
    </div>
  );
}

export function AuthMenu({
  mode,
  onLogoHoverChange,
  onLogoClick,
  logoHintText,
  logoErrorText,
  logoDisabled = false,
  logoLoading = false,
}: AuthMenuProps) {
  const { t } = useTranslation();
  const flags = getShellFeatureFlags();
  const context = useUiExtensionContext();
  const authStatus = useAppStore((state) => state.auth.status);
  const authToken = useAppStore((state) => state.auth.token);
  const authUser = useAppStore((state) => state.auth.user);
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const desktopCallbackRequest = useMemo(() => resolveDesktopCallbackRequestFromLocation(), []);
  const persistedAuthSession = loadPersistedAuthSession();
  const persistedToken = String(persistedAuthSession?.accessToken || '').trim();
  const isEmbedded = mode === 'embedded';

  const desktopCallbackToken = useMemo(() => {
    const tokenFromStore = String(authToken || '').trim();
    if (persistedToken) {
      return persistedToken;
    }
    return tokenFromStore;
  }, [authToken, persistedToken]);

  const desktopCallbackUser = useMemo(() => {
    const tokenFromStore = String(authToken || '').trim();
    if (persistedToken && tokenFromStore && persistedToken !== tokenFromStore) {
      if (persistedAuthSession?.user && typeof persistedAuthSession.user === 'object') {
        return persistedAuthSession.user;
      }
    }

    if (authUser && typeof authUser === 'object') {
      return authUser as Record<string, unknown>;
    }

    if (persistedAuthSession?.user && typeof persistedAuthSession.user === 'object') {
      return persistedAuthSession.user;
    }

    return null;
  }, [authToken, authUser, persistedAuthSession, persistedToken]);

  const desktopCallbackUserLabel = useMemo(
    () => getUserDisplayLabel(desktopCallbackUser, t('Auth.currentAccount')),
    [desktopCallbackUser, t],
  );

  const initialView: AuthView =
    desktopCallbackRequest && (authStatus === 'authenticated' || Boolean(desktopCallbackToken))
      ? 'desktop_authorize'
      : 'main';

  const [isHoveringLogo, setIsHoveringLogo] = useState(false);
  const [view, setView] = useState<AuthView>(initialView);
  const [embeddedStage, setEmbeddedStage] = useState<EmbeddedAuthStage>('logo');
  const [showAlternatives, setShowAlternatives] = useState(false);
  const [showRegisterConfirm, setShowRegisterConfirm] = useState(false);
  const [pending, setPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const [otpCode, setOtpCode] = useState('');
  const [otpResendCountdown, setOtpResendCountdown] = useState(0);
  const [pendingTokens, setPendingTokens] = useState<AuthTokensDto | null>(null);
  const [tempToken, setTempToken] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorReturnView, setTwoFactorReturnView] = useState<AuthView>('main');


  const setters: AuthMenuSetters = useMemo(() => ({
    setView,
    setPending,
    setLoginError,
    setPendingTokens,
    setOtpCode,
    setOtpResendCountdown,
    setTempToken,
    setTwoFactorCode,
    setTwoFactorReturnView,
    setStatusBanner,
    setAuthSession,
  }), [setStatusBanner, setAuthSession]);

  const desktopCtx: DesktopCallbackContext = useMemo(() => ({
    desktopCallbackRequest,
    desktopCallbackToken,
    desktopCallbackUser,
    authToken,
  }), [desktopCallbackRequest, desktopCallbackToken, desktopCallbackUser, authToken]);

  const clearOtpFlowState = () => {
    setOtpCode('');
    setOtpResendCountdown(0);
    setTempToken('');
    setTwoFactorCode('');
    setTwoFactorReturnView('main');
  };

  const clearPendingOnboardingState = () => {
    if (!pendingTokens) {
      return;
    }
    dataSync.setToken('');
    dataSync.setRefreshToken('');
    setPendingTokens(null);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  };

  useEffect(() => {
    onLogoHoverChange?.(isHoveringLogo);
  }, [isHoveringLogo, onLogoHoverChange]);

  useEffect(() => {
    if (otpResendCountdown <= 0) {
      return;
    }

    const timer = window.setTimeout(() => {
      setOtpResendCountdown((current) => Math.max(0, current - 1));
    }, 1000);

    return () => {
      window.clearTimeout(timer);
    };
  }, [otpResendCountdown]);

  useEffect(() => {
    if (!desktopCallbackRequest || typeof window === 'undefined') {
      return;
    }

    const syncFromPersistedSession = () => {
      const latest = loadPersistedAuthSession();
      const latestToken = String(latest?.accessToken || '').trim();
      if (!latestToken) {
        return;
      }
      const latestRefreshToken = String(latest?.refreshToken || '').trim();

      const latestUser = latest?.user && typeof latest.user === 'object'
        ? latest.user
        : null;

      dataSync.setToken(latestToken);
      if (latestRefreshToken) {
        dataSync.setRefreshToken(latestRefreshToken);
      }
      setAuthSession(latestUser, latestToken, latestRefreshToken || undefined);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) {
        return;
      }
      if (event.key && event.key !== WEB_AUTH_SESSION_KEY) {
        return;
      }
      syncFromPersistedSession();
    };

    window.addEventListener('storage', handleStorage);
    return () => {
      window.removeEventListener('storage', handleStorage);
    };
  }, [desktopCallbackRequest, setAuthSession]);

  useEffect(() => {
    return () => {
      if (!pendingTokens) {
        return;
      }
      dataSync.setToken('');
      dataSync.setRefreshToken('');
    };
  }, [pendingTokens]);

  useEffect(() => {
    if (view !== 'email_set_password') {
      return;
    }
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  }, [view]);

  useEffect(() => {
    if (view === 'email_set_password' && !pendingTokens) {
      setView('main');
      setEmbeddedStage('credential');
    }
  }, [pendingTokens, view]);

  const handleEmbeddedLogoClick = () => {
    setEmbeddedStage('email');
    setShowAlternatives(false);
    setLoginError(null);
  };

  const handleInlineEmailContinue = (event: FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setLoginError('请输入邮箱');
      return;
    }
    setShowAlternatives(false);
    setLoginError(null);
    setPending(true);

    void dataSync.callApi(
      (realm) => realm.services.AuthService.checkEmail({ email: normalizedEmail }),
      '',
    ).then((result) => {
      setPending(false);
      if (!result) {
        setEmbeddedStage('credential');
        setView('main');
        return;
      }

      const route = resolveEmailEntryRoute(result);
      if (route === 'register_with_otp') {
        // Email not registered — ask user to confirm registration
        setShowRegisterConfirm(true);
      } else if (route === 'login_with_otp') {
        void doRequestEmailOtp(
          { preventDefault: () => undefined } as FormEvent,
          normalizedEmail,
          setters,
        );
      } else {
        // Email registered and password already exists — go to password input
        setEmbeddedStage('credential');
        setView('main');
      }
    }).catch(() => {
      // Check failed — fall back to password input
      setPending(false);
      setEmbeddedStage('credential');
      setView('main');
    });
  };

  const handleConfirmRegister = () => {
    setShowRegisterConfirm(false);
    void doRequestEmailOtp(
      { preventDefault: () => undefined } as FormEvent,
      email.trim(),
      setters,
    );
  };

  const handleCancelRegister = () => {
    setShowRegisterConfirm(false);
  };

  const handleInlineOtpRequest = () => {
    setShowAlternatives(false);
    void doRequestEmailOtp({ preventDefault: () => undefined } as FormEvent, email, setters);
  };

  const handleUseAnotherDesktopAccount = () => {
    setView('main');
    setEmbeddedStage('email');
    setShowAlternatives(false);
    setLoginError(null);
    setPassword('');
  };

  const handleHeaderBack = () => {
    if (view === 'email_otp_verify') {
      setOtpCode('');
      setView('main');
      setEmbeddedStage('credential');
    } else if (view === 'email_set_password') {
      clearPendingOnboardingState();
      clearOtpFlowState();
      setView('main');
      setEmbeddedStage('credential');
    } else if (view === 'email_2fa') {
      setTempToken('');
      setTwoFactorCode('');
      if (twoFactorReturnView === 'email_otp_verify') {
        setView('email_otp_verify');
      } else {
        setView('main');
        setEmbeddedStage('credential');
      }
    } else if (view === 'wallet_select') {
      setView('main');
      setEmbeddedStage('email');
      setShowAlternatives(true);
    } else if (view === 'desktop_authorize') {
      handleUseAnotherDesktopAccount();
    } else if (embeddedStage === 'credential') {
      setView('main');
      setEmbeddedStage('email');
      setPassword('');
    } else if (embeddedStage === 'email') {
      setView('main');
      setEmbeddedStage('logo');
      setShowAlternatives(false);
      setShowRegisterConfirm(false);
    } else {
      setView('main');
      setEmbeddedStage('logo');
      setShowAlternatives(false);
    }
    setLoginError(null);
  };

  if (!isEmbedded) {
    const effectiveLogoHintText = logoHintText || t('Auth.clickToAuthorize');
    const shouldShowLogoHint = isHoveringLogo || Boolean(logoHintText) || Boolean(logoErrorText) || logoLoading;

    return (
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none">
        <div className="pointer-events-auto flex flex-col items-center gap-8">
          <button
            type="button"
            onClick={() => {
              onLogoClick?.();
            }}
            onMouseEnter={() => setIsHoveringLogo(true)}
            onMouseLeave={() => setIsHoveringLogo(false)}
            disabled={pending || logoDisabled}
            className="group relative cursor-pointer focus:outline-none"
          >
            <img
              src={logoUrl}
              alt="Nimi Logo"
              draggable={false}
              className="h-32 w-32 rounded-full object-cover transition-transform duration-200 group-hover:scale-105 select-none pointer-events-none"
            />
          </button>

          <div className="text-center">
            <h1 className="mb-3 text-[13px] font-medium uppercase tracking-[0.38em] text-[#7a7366]">
              {t('Auth.nimiNetwork')}
            </h1>
            {logoLoading ? (
              <div className={`transition-opacity duration-500 ${shouldShowLogoHint ? 'opacity-100' : 'opacity-0'}`}>
                <LoadingSpinner />
              </div>
            ) : (
              <p
                className={`
                  text-xs text-[#8a8579] transition-opacity duration-500
                  ${shouldShowLogoHint ? 'opacity-100' : 'opacity-0'}
                `}
              >
                {effectiveLogoHintText}
              </p>
            )}
            {logoErrorText ? <p className="mt-2 text-xs text-destructive">{logoErrorText}</p> : null}
          </div>
        </div>
      </div>
    );
  }

  const isLogoStage = view === 'main' && embeddedStage === 'logo';

  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none">
      <div className="pointer-events-auto flex flex-col items-center w-full max-w-[440px] px-6 gap-6">
        {/* Logo — full size on logo stage, smaller on other stages; click to go back */}
        <button
          type="button"
          data-testid={E2E_IDS.loginLogoTrigger}
          onClick={() => {
            if (isLogoStage) {
              handleEmbeddedLogoClick();
            } else {
              handleHeaderBack();
            }
          }}
          onMouseEnter={() => setIsHoveringLogo(true)}
          onMouseLeave={() => setIsHoveringLogo(false)}
          disabled={pending}
          className="group relative focus:outline-none transition-all duration-500 ease-out cursor-pointer"
        >
          <img
            src={logoUrl}
            alt="Nimi Logo"
            draggable={false}
            className={`rounded-full object-cover select-none pointer-events-none transition-all duration-500 ease-out ${
              isLogoStage
                ? 'h-32 w-32 group-hover:scale-105'
                : 'h-16 w-16'
            }`}
          />
        </button>

        {/* Logo stage: platform label */}
        {isLogoStage ? (
          <AnimateIn className="text-center" delay={100}>
            <h1 className="text-[13px] font-medium uppercase tracking-[0.38em] text-[#7a7366]">
              {t('Auth.nimiNetwork')}
            </h1>
          </AnimateIn>
        ) : null}

        {/* Email stage: inline input bar */}
        {view === 'main' && embeddedStage === 'email' ? (
          <AnimateIn className="w-full">
            <AuthViewMain
              email={email}
              pending={pending}
              showAlternatives={showAlternatives}
              googleDisabledReason={t('Auth.comingSoon')}
              twitterDisabledReason={t('Auth.comingSoon')}
              tikTokDisabledReason={t('Auth.comingSoon')}
              onEmailChange={setEmail}
              onContinue={handleInlineEmailContinue}
              onAlternativeToggle={() => setShowAlternatives((current) => !current)}
              onGoogleLogin={() => {}}
              onTwitterLogin={() => {}}
              onTikTokLogin={() => {}}
              onWeb3Login={() => {
                setView('wallet_select');
                setLoginError(null);
              }}
            />
          </AnimateIn>
        ) : null}

        {/* Register confirmation dialog */}
        {view === 'main' && embeddedStage === 'email' ? (
          <div className={`w-full origin-top transition-all duration-200 ease-out ${
            showRegisterConfirm
              ? 'scale-100 opacity-100'
              : 'scale-95 opacity-0 pointer-events-none h-0'
          }`}>
            <div className="rounded-2xl border border-[#e7dfd3] bg-white/95 p-5 shadow-[0_18px_40px_rgba(157,145,123,0.12)] backdrop-blur">
              <p className="mb-1 text-center text-sm font-medium text-[#2c271f]">
                {t('Auth.emailNotRegistered')}
              </p>
              <p className="mb-4 text-center text-xs text-[#8a8579]">
                {t('Auth.registerConfirmHint')}
              </p>
              <div className="flex items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleCancelRegister}
                  className="rounded-full border border-[#ddd4c6] bg-white/80 px-5 py-2 text-sm font-medium text-[#6f6758] transition hover:border-[#cbbca4]"
                >
                  {t('Auth.cancel')}
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRegister}
                  disabled={pending}
                  className="rounded-full bg-mint-500 px-5 py-2 text-sm font-medium text-white transition hover:bg-mint-600 disabled:opacity-50"
                >
                  {t('Auth.confirmRegister')}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {/* Credential stage: password form */}
        {view === 'main' && embeddedStage === 'credential' ? (
          <AnimateIn className="w-full">
            <AuthViewEmailLogin
              email={email}
              password={password}
              pending={pending}
              onPasswordChange={setPassword}
              onSubmit={(event) => {
                void doEmailLogin(event, email, password, false, setters, desktopCtx);
              }}
              onUseEmailCodeInstead={handleInlineOtpRequest}
            />
          </AnimateIn>
        ) : null}

        {/* Desktop authorize */}
        {view === 'desktop_authorize' ? (
          <AnimateIn className="w-full">
            <AuthViewDesktopAuthorize
              authStatus={authStatus}
              desktopCallbackUserLabel={desktopCallbackUserLabel}
              pending={pending}
              onSubmit={(event) => {
                void doConfirmDesktopAuth(event, setters, desktopCtx);
              }}
              onUseAnotherAccount={handleUseAnotherDesktopAccount}
            />
          </AnimateIn>
        ) : null}

        {/* OTP verify */}
        {view === 'email_otp_verify' ? (
          <AnimateIn className="w-full">
            <AuthViewEmailOtpVerify
              email={email}
              otpCode={otpCode}
              otpResendCountdown={otpResendCountdown}
              pending={pending}
              onOtpCodeChange={setOtpCode}
              onSubmit={(event) => {
                void doVerifyEmailOtp(event, email, otpCode, setters, desktopCtx);
              }}
              onResendOtp={() => {
                void doResendOtp(email, otpResendCountdown, setters);
              }}
            />
          </AnimateIn>
        ) : null}

        {/* Set password after OTP */}
        {view === 'email_set_password' && pendingTokens ? (
          <AnimateIn className="w-full">
            <AuthViewEmailSetPassword
              password={password}
              confirmPassword={confirmPassword}
              showPassword={showPassword}
              showConfirmPassword={showConfirmPassword}
              pending={pending}
              onPasswordChange={setPassword}
              onConfirmPasswordChange={setConfirmPassword}
              onShowPasswordToggle={() => setShowPassword((current) => !current)}
              onShowConfirmPasswordToggle={() => setShowConfirmPassword((current) => !current)}
              onSubmit={(event) => {
                void doSetPasswordAfterOtp(event, password, confirmPassword, pendingTokens, setters, desktopCtx);
              }}
            />
          </AnimateIn>
        ) : null}

        {/* 2FA */}
        {view === 'email_2fa' ? (
          <AnimateIn className="w-full">
            <AuthViewEmail2Fa
              twoFactorCode={twoFactorCode}
              pending={pending}
              onTwoFactorCodeChange={setTwoFactorCode}
              onSubmit={(event) => {
                void doVerify2Fa(event, tempToken, twoFactorCode, setters, desktopCtx);
              }}
            />
          </AnimateIn>
        ) : null}

        {/* Wallet select */}
        {view === 'wallet_select' ? (
          <AnimateIn className="w-full">
            <AuthViewWalletSelect
              pending={pending}
              onWalletLogin={(walletType) => {
                void doWalletLogin(walletType, setters, desktopCtx);
              }}
            />
          </AnimateIn>
        ) : null}

        {/* Error message */}
        {loginError ? (
          <AnimateIn>
            <p className="text-center text-xs text-destructive">{loginError}</p>
          </AnimateIn>
        ) : null}

        {/* Mod UI slot */}
        {flags.enableModUi ? (
          <div className="w-full">
            <Suspense fallback={null}>
              <SlotHost slot="auth.login.form.footer" base={null} context={context} />
            </Suspense>
          </div>
        ) : null}
      </div>
    </div>
  );
}
