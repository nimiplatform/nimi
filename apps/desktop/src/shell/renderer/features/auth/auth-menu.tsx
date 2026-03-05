import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import type { AuthMenuProps, AuthView } from './auth-helpers.js';
import {
  dataSync,
  getGoogleClientId,
  getUserDisplayLabel,
  loadPersistedAuthSession,
  loadRememberedLogin,
  resolveDesktopCallbackRequestFromLocation,
  WEB_AUTH_SESSION_KEY,
} from './auth-helpers.js';
import logoUrl from '@renderer/assets/logo.png';
import type { AuthMenuSetters, DesktopCallbackContext } from './auth-menu-handlers.js';
import {
  handleGoogleLogin as doGoogleLogin,
  handleEmailLogin as doEmailLogin,
  handleEmailRegister as doEmailRegister,
  handleSocialLogin as doSocialLogin,
} from './auth-menu-handlers.js';
import {
  handleRequestEmailOtp as doRequestEmailOtp,
  handleVerifyEmailOtp as doVerifyEmailOtp,
  handleResendOtp as doResendOtp,
  handleVerify2Fa as doVerify2Fa,
  handleConfirmDesktopAuthorization as doConfirmDesktopAuth,
  handleWalletLogin as doWalletLogin,
} from './auth-menu-handlers-ext.js';
import { AuthMenuHeader } from './auth-menu-header.js';
import { AuthViewMain } from './auth-view-main.js';
import {
  AuthViewEmailLogin,
  AuthViewEmailRegister,
  AuthViewEmailOtp,
  AuthViewEmailOtpVerify,
  AuthViewEmail2Fa,
} from './auth-view-email.js';
import { AuthViewDesktopAuthorize } from './auth-view-desktop.js';
import { resolveSocialOauthConfig } from './social-oauth.js';

const SlotHost = lazy(async () => {
  const mod = await import('@renderer/mod-ui/host/slot-host');
  return { default: mod.SlotHost };
});

export function AuthMenu({
  onLogoHoverChange,
  onLogoClick,
  logoHintText,
  logoErrorText,
  logoDisabled = false,
  enableAuthModal = true,
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

  const initialModalView: AuthView =
    desktopCallbackRequest && (authStatus === 'authenticated' || Boolean(desktopCallbackToken))
      ? 'desktop_authorize'
      : 'main';

  const [isHoveringLogo, setIsHoveringLogo] = useState(false);
  const [didAutoOpenDesktopLogin, setDidAutoOpenDesktopLogin] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [view, setView] = useState<AuthView>('main');
  const [pending, setPending] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const [otpCode, setOtpCode] = useState('');
  const [otpResendCountdown, setOtpResendCountdown] = useState(0);
  const [tempToken, setTempToken] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');

  const googleClientId = useMemo(() => getGoogleClientId(), []);
  const twitterOauthConfig = useMemo(() => resolveSocialOauthConfig('TWITTER'), []);
  const tikTokOauthConfig = useMemo(() => resolveSocialOauthConfig('TIKTOK'), []);

  const setters: AuthMenuSetters = useMemo(() => ({
    setView,
    setPending,
    setLoginError,
    setShowLoginModal,
    setOtpCode,
    setOtpResendCountdown,
    setTempToken,
    setTwoFactorCode,
    setStatusBanner,
    setAuthSession,
  }), [setStatusBanner, setAuthSession]);

  const desktopCtx: DesktopCallbackContext = useMemo(() => ({
    desktopCallbackRequest,
    desktopCallbackToken,
    desktopCallbackUser,
    authToken,
  }), [desktopCallbackRequest, desktopCallbackToken, desktopCallbackUser, authToken]);

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
    if (typeof window === 'undefined') return;
    const remembered = loadRememberedLogin();
    if (remembered?.rememberMe) {
      setEmail(remembered.email);
      setPassword(remembered.password);
      setRememberMe(true);
    }
  }, []);

  const openModal = () => {
    if (!enableAuthModal) {
      return;
    }

    setShowLoginModal(true);
    setView(initialModalView);
    setPending(false);
    setLoginError(null);
    setConfirmPassword('');
    setOtpCode('');
    setOtpResendCountdown(0);
    setTempToken('');
    setTwoFactorCode('');
    const remembered = loadRememberedLogin();
    if (!remembered?.rememberMe) {
      setEmail('');
      setPassword('');
      setRememberMe(false);
    }
  };

  useEffect(() => {
    if (!enableAuthModal || !desktopCallbackRequest || didAutoOpenDesktopLogin) {
      return;
    }

    setShowLoginModal(true);
    setView(initialModalView);
    setPending(false);
    setLoginError(null);
    setConfirmPassword('');
    setOtpCode('');
    setOtpResendCountdown(0);
    setTempToken('');
    setTwoFactorCode('');
    const remembered = loadRememberedLogin();
    if (!remembered?.rememberMe) {
      setEmail('');
      setPassword('');
    }
    setDidAutoOpenDesktopLogin(true);
  }, [desktopCallbackRequest, didAutoOpenDesktopLogin, enableAuthModal, initialModalView]);

  const closeModal = () => {
    if (pending) return;
    setShowLoginModal(false);
    setView('main');
    setLoginError(null);
  };

  const handleHeaderBack = () => {
    if (view === 'email_otp_verify') {
      setView('email_otp');
    } else if (view === 'email_register' || view === 'email_2fa') {
      setView('email_login');
    } else {
      setView('main');
    }
    setLoginError(null);
  };

  const effectiveLogoHintText = logoHintText || (enableAuthModal
    ? t('Auth.clickToConnect')
    : t('Auth.clickToAuthorize'));
  const shouldShowLogoHint = isHoveringLogo || Boolean(logoHintText) || Boolean(logoErrorText);

  return (
    <>
      <div className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none">
        <div className="pointer-events-auto flex flex-col items-center gap-8">
          <button
            type="button"
            onClick={() => {
              if (onLogoClick) {
                onLogoClick();
                return;
              }
              openModal();
            }}
            onMouseEnter={() => setIsHoveringLogo(true)}
            onMouseLeave={() => setIsHoveringLogo(false)}
            disabled={pending || logoDisabled}
            className="relative group cursor-pointer focus:outline-none"
          >
            <div
              className={`
                absolute inset-0 -z-10 rounded-full bg-[#4ECCA3] opacity-30 blur-2xl transition-all duration-1000
                ${isHoveringLogo ? 'scale-150 opacity-40' : 'scale-110 animate-pulse'}
              `}
            />
            <img src={logoUrl} alt="Nimi Logo" className="h-32 w-32 rounded-full object-cover transition-transform duration-200 group-hover:scale-105" />
          </button>

          <div className="text-center">
            <h1 className="mb-3 text-[13px] font-medium uppercase tracking-[0.38em] text-[#7a7366]">
              {t('Auth.nimiNetwork')}
            </h1>
            <p
              className={`
                text-xs text-[#8a8579] transition-opacity duration-500
                ${shouldShowLogoHint ? 'opacity-100' : 'opacity-0'}
              `}
            >
              {effectiveLogoHintText}
            </p>
            {logoErrorText ? <p className="mt-2 text-xs text-destructive">{logoErrorText}</p> : null}
          </div>
        </div>
      </div>

      {enableAuthModal && showLoginModal ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={closeModal}
        >
          <div
            className="w-full sm:max-w-md bg-card rounded-3xl shadow-2xl p-0 overflow-hidden border-none min-h-[480px] flex flex-col relative"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="px-8 py-7 md:px-10 md:py-8 flex flex-col h-full w-full pb-16">
              <AuthMenuHeader
                view={view}
                pending={pending}
                onBack={handleHeaderBack}
                onClose={closeModal}
              />

              <div className="flex-1 flex flex-col min-h-0">
              {view === 'desktop_authorize' ? (
                <AuthViewDesktopAuthorize
                  authStatus={authStatus}
                  desktopCallbackUserLabel={desktopCallbackUserLabel}
                  pending={pending}
                  onSubmit={(e) => { void doConfirmDesktopAuth(e, setters, desktopCtx); }}
                  onUseAnotherAccount={() => {
                    setView('main');
                    setLoginError(null);
                  }}
                />
              ) : null}

              {view === 'main' ? (
                <AuthViewMain
                  pending={pending}
                  onSetView={(v) => {
                    setView(v);
                    setLoginError(null);
                  }}
                  onGoogleLogin={() => { void doGoogleLogin(googleClientId, setters, desktopCtx); }}
                  onTwitterLogin={() => { void doSocialLogin('TWITTER', setters, desktopCtx); }}
                  onTikTokLogin={() => { void doSocialLogin('TIKTOK', setters, desktopCtx); }}
                  onWalletLogin={(wt) => { void doWalletLogin(wt, setters, desktopCtx); }}
                  twitterDisabledReason={twitterOauthConfig.enabled ? undefined : twitterOauthConfig.disabledReason}
                  tikTokDisabledReason={tikTokOauthConfig.enabled ? undefined : tikTokOauthConfig.disabledReason}
                />
              ) : null}

              {view === 'email_login' ? (
                <AuthViewEmailLogin
                  email={email}
                  password={password}
                  showPassword={showPassword}
                  rememberMe={rememberMe}
                  pending={pending}
                  onEmailChange={setEmail}
                  onPasswordChange={setPassword}
                  onShowPasswordToggle={() => setShowPassword((current) => !current)}
                  onRememberMeChange={setRememberMe}
                  onSubmit={(e) => { void doEmailLogin(e, email, password, rememberMe, setters, desktopCtx); }}
                  onSwitchToRegister={() => {
                    setView('email_register');
                    setLoginError(null);
                  }}
                />
              ) : null}

              {view === 'email_register' ? (
                <AuthViewEmailRegister
                  email={email}
                  password={password}
                  confirmPassword={confirmPassword}
                  showPassword={showPassword}
                  showConfirmPassword={showConfirmPassword}
                  pending={pending}
                  onEmailChange={setEmail}
                  onPasswordChange={setPassword}
                  onConfirmPasswordChange={setConfirmPassword}
                  onShowPasswordToggle={() => setShowPassword((current) => !current)}
                  onShowConfirmPasswordToggle={() => setShowConfirmPassword((current) => !current)}
                  onSubmit={(e) => { void doEmailRegister(e, email, password, confirmPassword, setters, desktopCtx); }}
                />
              ) : null}

              {view === 'email_otp' ? (
                <AuthViewEmailOtp
                  email={email}
                  pending={pending}
                  onEmailChange={setEmail}
                  onSubmit={(e) => { void doRequestEmailOtp(e, email, setters); }}
                />
              ) : null}

              {view === 'email_otp_verify' ? (
                <AuthViewEmailOtpVerify
                  email={email}
                  otpCode={otpCode}
                  otpResendCountdown={otpResendCountdown}
                  pending={pending}
                  onOtpCodeChange={setOtpCode}
                  onSubmit={(e) => { void doVerifyEmailOtp(e, email, otpCode, setters, desktopCtx); }}
                  onResendOtp={() => { void doResendOtp(email, otpResendCountdown, setters); }}
                />
              ) : null}

              {view === 'email_2fa' ? (
                <AuthViewEmail2Fa
                  twoFactorCode={twoFactorCode}
                  pending={pending}
                  onTwoFactorCodeChange={setTwoFactorCode}
                  onSubmit={(e) => { void doVerify2Fa(e, tempToken, twoFactorCode, setters, desktopCtx); }}
                />
              ) : null}

              {loginError ? (
                <p className="mt-2 mb-2 text-xs text-destructive text-center">{loginError}</p>
              ) : null}

              {flags.enableModUi ? (
                <div className="mt-4 pt-4">
                  <Suspense fallback={null}>
                    <SlotHost slot="auth.login.form.footer" base={null} context={context} />
                  </Suspense>
                </div>
              ) : null}
              </div>
            </div>

            <div className="absolute bottom-5 left-0 right-0 text-center text-[12px] font-normal" style={{ color: '#999999' }}>{t('Auth.poweredByNimi')}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}
