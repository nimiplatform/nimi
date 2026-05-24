import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { RealmModel } from '@nimiplatform/kit/core/sdk-contract';
import { toErrorMessage } from '../logic/oauth-helpers.js';
import type { AuthPlatformAdapter } from '../platform/auth-platform-adapter.js';
import type { AuthView, EmbeddedAuthStage } from '../types/auth-types.js';
import type { AuthMenuSetters } from '../logic/auth-menu-handlers.js';
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
  handleWalletLogin as doWalletLogin,
} from '../logic/auth-menu-handlers-ext.js';
import { resolveEmailEntryRoute } from '../logic/auth-email-flow.js';
import { AUTH_COPY } from '../logic/auth-copy.js';

type AuthTokensDto = RealmModel<'AuthTokensDto'>;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function isLikelyEmailAddress(value: string): boolean {
  return EMAIL_SHAPE.test(value);
}

export type UseAuthFlowConfig = {
  adapter: AuthPlatformAdapter;
  mode: 'embedded' | 'desktop-browser';
  initialView?: AuthView;
  /** Auth status from app store */
  authStatus?: string;
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
  supportsPasswordLogin: boolean;

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
  handleWalletLogin: (walletType: 'metamask' | 'okx' | 'binance') => void;
  handleGoogleLogin: () => void;
  handleTwitterLogin: () => void;
  handleTikTokLogin: () => void;
  handleWeb3Login: () => void;
};

function handleUnexpectedAsyncError(
  error: unknown,
  fallbackMessage: string,
  setPending: (value: boolean) => void,
  setLoginError: (value: string | null) => void,
): void {
  setPending(false);
  setLoginError(toErrorMessage(error, fallbackMessage));
}

export function useAuthFlow(config: UseAuthFlowConfig): UseAuthFlowReturn {
  const {
    adapter,
    mode,
    setAuthSession: externalSetAuthSession,
    setStatusBanner: externalSetStatusBanner,
  } = config;

  const supportsPasswordLogin =
    adapter.supportsPasswordLogin !== false && typeof adapter.passwordLogin === 'function';

  const [view, setView] = useState<AuthView>(config.initialView ?? 'main');
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
  const authSessionSetterRef = useRef(externalSetAuthSession ?? (() => {}));
  const statusBannerSetterRef = useRef(externalSetStatusBanner ?? (() => {}));

  useEffect(() => {
    authSessionSetterRef.current = externalSetAuthSession ?? (() => {});
  }, [externalSetAuthSession]);

  useEffect(() => {
    statusBannerSetterRef.current = externalSetStatusBanner ?? (() => {});
  }, [externalSetStatusBanner]);

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
    setStatusBanner: (banner) => statusBannerSetterRef.current(banner),
    setAuthSession: (user, token, refreshToken) => authSessionSetterRef.current(user, token, refreshToken),
  }), []);

  // OTP countdown timer
  useEffect(() => {
    if (otpResendCountdown <= 0) return;
    const timer = window.setTimeout(() => {
      setOtpResendCountdown((current) => Math.max(0, current - 1));
    }, 1000);
    return () => { window.clearTimeout(timer); };
  }, [otpResendCountdown]);

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
      setLoginError(AUTH_COPY.emailRequired);
      return;
    }
    if (!isLikelyEmailAddress(normalizedEmail)) {
      setLoginError(AUTH_COPY.emailInvalid);
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
        ).catch((error) => {
          handleUnexpectedAsyncError(error, '发送验证码失败', setPending, setLoginError);
        });
      } else {
        if (!supportsPasswordLogin) {
          void doRequestEmailOtp(
            { preventDefault: () => undefined } as FormEvent,
            normalizedEmail,
            setters,
            adapter,
          ).catch((error) => {
            handleUnexpectedAsyncError(error, '发送验证码失败', setPending, setLoginError);
          });
          return;
        }
        setEmbeddedStage('credential');
        setView('main');
      }
    }).catch((error) => {
      setPending(false);
      setLoginError(toErrorMessage(error, '邮箱检查失败，请重试'));
    });
  };

  const handleConfirmRegister = () => {
    setShowRegisterConfirm(false);
    void doRequestEmailOtp(
      { preventDefault: () => undefined } as FormEvent,
      email.trim(),
      setters,
      adapter,
    ).catch((error) => {
      handleUnexpectedAsyncError(error, '发送验证码失败', setPending, setLoginError);
    });
  };

  const handleCancelRegister = () => {
    setShowRegisterConfirm(false);
  };

  const handleInlineOtpRequest = () => {
    setShowAlternatives(false);
    void doRequestEmailOtp(
      { preventDefault: () => undefined } as FormEvent,
      email,
      setters,
      adapter,
    ).catch((error) => {
      handleUnexpectedAsyncError(error, '发送验证码失败', setPending, setLoginError);
    });
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
    supportsPasswordLogin,

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
      void doEmailLogin(event, email, password, false, setters, adapter);
    },
    handleSetPasswordAfterOtp: (event: FormEvent) => {
      if (pendingTokens) {
        void doSetPasswordAfterOtp(event, password, confirmPassword, pendingTokens, setters, adapter);
      }
    },
    handleOtpVerify: (event: FormEvent) => {
      void doVerifyEmailOtp(event, email, otpCode, setters, adapter);
    },
    handleResendOtp: () => {
      void doResendOtp(email, otpResendCountdown, setters, adapter);
    },
    handleVerify2Fa: (event: FormEvent) => {
      void doVerify2Fa(event, tempToken, twoFactorCode, setters, adapter);
    },
    handleWalletLogin: (walletType) => {
      void doWalletLogin(walletType, setters, adapter);
    },
    handleGoogleLogin: () => {
      void doGoogleLogin(setters, adapter);
    },
    handleTwitterLogin: () => {
      void doSocialLogin('TWITTER', setters, adapter);
    },
    handleTikTokLogin: () => {
      void doSocialLogin('TIKTOK', setters, adapter);
    },
    handleWeb3Login: () => {
      setView('wallet_select');
      setLoginError(null);
    },
  };
}
