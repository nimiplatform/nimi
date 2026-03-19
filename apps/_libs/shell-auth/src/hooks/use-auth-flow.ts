import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { RealmModel } from '@nimiplatform/sdk/realm';
import type { AuthPlatformAdapter } from '../platform/auth-platform-adapter.js';
import type { AuthView, EmbeddedAuthStage, DesktopCallbackRequest } from '../types/auth-types.js';
import type { AuthMenuSetters, DesktopCallbackContext } from '../logic/auth-menu-handlers.js';
import {
  handleEmailLogin as doEmailLogin,
  handleSetPasswordAfterOtp as doSetPasswordAfterOtp,
  handleGoogleLogin as doGoogleLogin,
  handleSocialLogin as doSocialLogin,
} from '../logic/auth-menu-handlers.js';
import {
  handleRequestEmailOtp as doRequestEmailOtp,
  handleVerifyEmailOtp as doVerifyEmailOtp,
  handleResendOtp as doResendOtp,
  handleVerify2Fa as doVerify2Fa,
  handleConfirmDesktopAuthorization as doConfirmDesktopAuth,
  handleWalletLogin as doWalletLogin,
} from '../logic/auth-menu-handlers-ext.js';
import { resolveEmailEntryRoute } from '../logic/auth-email-flow.js';
import {
  loadPersistedAuthSession,
  WEB_AUTH_SESSION_KEY,
} from '../logic/auth-session-storage.js';
import {
  resolveDesktopCallbackRequestFromLocation,
} from '../logic/desktop-callback-helpers.js';
import { getUserDisplayLabel } from '../logic/error-helpers.js';

type AuthTokensDto = RealmModel<'AuthTokensDto'>;

export type UseAuthFlowConfig = {
  adapter: AuthPlatformAdapter;
  mode: 'embedded' | 'desktop-browser';
  initialView?: AuthView;
  /** Auth status from app store */
  authStatus?: string;
  /** Auth token from app store */
  authToken?: string | null;
  /** Auth user from app store */
  authUser?: Record<string, unknown> | null;
  /** Set auth session in app store */
  setAuthSession?: (user: Record<string, unknown> | null, token: string, refreshToken?: string) => void;
  /** Set status banner in app store */
  setStatusBanner?: (banner: { kind: string; message: string } | null) => void;
};

export type UseAuthFlowReturn = {
  // State
  view: AuthView;
  embeddedStage: EmbeddedAuthStage;
  email: string;
  password: string;
  confirmPassword: string;
  showPassword: boolean;
  showConfirmPassword: boolean;
  otpCode: string;
  otpResendCountdown: number;
  twoFactorCode: string;
  pending: boolean;
  loginError: string | null;
  showAlternatives: boolean;
  showRegisterConfirm: boolean;
  pendingTokens: AuthTokensDto | null;
  desktopCallbackRequest: DesktopCallbackRequest | null;
  desktopCallbackUserLabel: string;

  // Setters
  setEmail: (value: string) => void;
  setPassword: (value: string) => void;
  setConfirmPassword: (value: string) => void;
  setShowPassword: (value: boolean) => void;
  setShowConfirmPassword: (value: boolean) => void;
  setOtpCode: (value: string) => void;
  setTwoFactorCode: (value: string) => void;
  setShowAlternatives: (value: boolean | ((prev: boolean) => boolean)) => void;

  // Actions
  handleEmbeddedLogoClick: () => void;
  handleInlineEmailContinue: (event: FormEvent) => void;
  handleConfirmRegister: () => void;
  handleCancelRegister: () => void;
  handleInlineOtpRequest: () => void;
  handleHeaderBack: () => void;
  handleEmailLogin: (event: FormEvent) => void;
  handleSetPasswordAfterOtp: (event: FormEvent) => void;
  handleOtpVerify: (event: FormEvent) => void;
  handleResendOtp: () => void;
  handleVerify2Fa: (event: FormEvent) => void;
  handleConfirmDesktopAuth: (event: FormEvent) => void;
  handleWalletLogin: (walletType: 'metamask' | 'okx' | 'binance') => void;
  handleUseAnotherDesktopAccount: () => void;
  handleGoogleLogin: () => void;
  handleTwitterLogin: () => void;
  handleTikTokLogin: () => void;
  handleWeb3Login: () => void;
};

export function useAuthFlow(config: UseAuthFlowConfig): UseAuthFlowReturn {
  const {
    adapter,
    mode,
    authStatus = '',
    authToken = null,
    authUser = null,
    setAuthSession: externalSetAuthSession,
    setStatusBanner: externalSetStatusBanner,
  } = config;

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
    () => getUserDisplayLabel(desktopCallbackUser, 'Current Account'),
    [desktopCallbackUser],
  );

  const initialView: AuthView =
    config.initialView
    ?? (desktopCallbackRequest && (authStatus === 'authenticated' || Boolean(desktopCallbackToken))
      ? 'desktop_authorize'
      : 'main');

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
    setStatusBanner: externalSetStatusBanner ?? (() => {}),
    setAuthSession: externalSetAuthSession ?? (() => {}),
  }), [externalSetStatusBanner, externalSetAuthSession]);

  const desktopCtx: DesktopCallbackContext = useMemo(() => ({
    desktopCallbackRequest,
    desktopCallbackToken,
    desktopCallbackUser,
    authToken,
  }), [desktopCallbackRequest, desktopCallbackToken, desktopCallbackUser, authToken]);

  // OTP countdown timer
  useEffect(() => {
    if (otpResendCountdown <= 0) return;
    const timer = window.setTimeout(() => {
      setOtpResendCountdown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => { window.clearTimeout(timer); };
  }, [otpResendCountdown]);

  // Desktop callback storage sync
  useEffect(() => {
    if (!desktopCallbackRequest || typeof window === 'undefined') return;

    const syncFromPersistedSession = () => {
      const latest = loadPersistedAuthSession();
      const latestToken = String(latest?.accessToken || '').trim();
      if (!latestToken) return;
      const latestRefreshToken = String(latest?.refreshToken || '').trim();
      const latestUser = latest?.user && typeof latest.user === 'object' ? latest.user : null;
      void adapter.applyToken(latestToken, latestRefreshToken || undefined);
      externalSetAuthSession?.(latestUser, latestToken, latestRefreshToken || undefined);
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.storageArea !== window.localStorage) return;
      if (event.key && event.key !== WEB_AUTH_SESSION_KEY) return;
      syncFromPersistedSession();
    };

    window.addEventListener('storage', handleStorage);
    return () => { window.removeEventListener('storage', handleStorage); };
  }, [desktopCallbackRequest, externalSetAuthSession, adapter]);

  // Cleanup pending tokens on unmount
  useEffect(() => {
    return () => {
      if (!pendingTokens) return;
      void adapter.applyToken('');
    };
  }, [pendingTokens, adapter]);

  // Reset password fields when entering set_password view
  useEffect(() => {
    if (view !== 'email_set_password') return;
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
  }, [view]);

  // If pending tokens cleared while in set_password, go back
  useEffect(() => {
    if (view === 'email_set_password' && !pendingTokens) {
      setView('main');
      setEmbeddedStage('credential');
    }
  }, [pendingTokens, view]);

  // --- Actions ---

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

    void adapter.checkEmail(normalizedEmail).then((result) => {
      setPending(false);
      if (!result) {
        setEmbeddedStage('credential');
        setView('main');
        return;
      }

      const route = resolveEmailEntryRoute(result);
      if (route === 'register_with_otp') {
        setShowRegisterConfirm(true);
      } else if (route === 'login_with_otp') {
        void doRequestEmailOtp(
          { preventDefault: () => undefined } as FormEvent,
          normalizedEmail,
          setters,
          adapter,
        );
      } else {
        setEmbeddedStage('credential');
        setView('main');
      }
    }).catch(() => {
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
      adapter,
    );
  };

  const handleCancelRegister = () => {
    setShowRegisterConfirm(false);
  };

  const handleInlineOtpRequest = () => {
    setShowAlternatives(false);
    void doRequestEmailOtp({ preventDefault: () => undefined } as FormEvent, email, setters, adapter);
  };

  const handleUseAnotherDesktopAccount = () => {
    setView('main');
    setEmbeddedStage('email');
    setShowAlternatives(false);
    setLoginError(null);
    setPassword('');
  };

  const clearOtpFlowState = () => {
    setOtpCode('');
    setOtpResendCountdown(0);
    setTempToken('');
    setTwoFactorCode('');
    setTwoFactorReturnView('main');
  };

  const clearPendingOnboardingState = () => {
    if (!pendingTokens) return;
    void adapter.applyToken('');
    setPendingTokens(null);
    setPassword('');
    setConfirmPassword('');
    setShowPassword(false);
    setShowConfirmPassword(false);
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

  return {
    // State
    view,
    embeddedStage,
    email,
    password,
    confirmPassword,
    showPassword,
    showConfirmPassword,
    otpCode,
    otpResendCountdown,
    twoFactorCode,
    pending,
    loginError,
    showAlternatives,
    showRegisterConfirm,
    pendingTokens,
    desktopCallbackRequest,
    desktopCallbackUserLabel,

    // Setters
    setEmail,
    setPassword,
    setConfirmPassword,
    setShowPassword,
    setShowConfirmPassword,
    setOtpCode,
    setTwoFactorCode,
    setShowAlternatives,

    // Actions
    handleEmbeddedLogoClick,
    handleInlineEmailContinue,
    handleConfirmRegister,
    handleCancelRegister,
    handleInlineOtpRequest,
    handleHeaderBack,
    handleEmailLogin: (event: FormEvent) => {
      void doEmailLogin(event, email, password, false, setters, desktopCtx, adapter);
    },
    handleSetPasswordAfterOtp: (event: FormEvent) => {
      if (pendingTokens) {
        void doSetPasswordAfterOtp(event, password, confirmPassword, pendingTokens, setters, desktopCtx, adapter);
      }
    },
    handleOtpVerify: (event: FormEvent) => {
      void doVerifyEmailOtp(event, email, otpCode, setters, desktopCtx, adapter);
    },
    handleResendOtp: () => {
      void doResendOtp(email, otpResendCountdown, setters, adapter);
    },
    handleVerify2Fa: (event: FormEvent) => {
      void doVerify2Fa(event, tempToken, twoFactorCode, setters, desktopCtx, adapter);
    },
    handleConfirmDesktopAuth: (event: FormEvent) => {
      void doConfirmDesktopAuth(event, setters, desktopCtx, adapter);
    },
    handleWalletLogin: (walletType) => {
      void doWalletLogin(walletType, setters, desktopCtx, adapter);
    },
    handleUseAnotherDesktopAccount,
    handleGoogleLogin: () => {
      void doGoogleLogin(setters, desktopCtx, adapter);
    },
    handleTwitterLogin: () => {
      void doSocialLogin('TWITTER', setters, desktopCtx, adapter);
    },
    handleTikTokLogin: () => {
      void doSocialLogin('TIKTOK', setters, desktopCtx, adapter);
    },
    handleWeb3Login: () => {
      setView('wallet_select');
      setLoginError(null);
    },
  };
}
