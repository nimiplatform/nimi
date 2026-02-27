import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import { OAuthLoginState, OAuthProvider } from '@nimiplatform/sdk/realm';
import type { AuthTokensDto, OAuthLoginResultDto } from '@nimiplatform/sdk/realm';
import { dataSync } from '@runtime/data-sync';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { queryClient } from '@renderer/infra/query-client/query-client';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import {
  loadPersistedAuthSession,
  persistAuthSession,
  WEB_AUTH_SESSION_KEY,
} from './auth-session-storage';

const SlotHost = lazy(async () => {
  const mod = await import('@renderer/mod-ui/host/slot-host');
  return { default: mod.SlotHost };
});

const ParticleBackgroundLight = lazy(async () => {
  const mod = await import('./particle-background-light');
  return { default: mod.ParticleBackgroundLight };
});

// 记住登录凭据的存储键
const REMEMBER_LOGIN_KEY = 'nimi.rememberLogin';

// 记住的登录凭据类型
type RememberedLogin = {
  email: string;
  password: string;
  rememberMe: boolean;
};

// 从 localStorage 加载记住的登录凭据
function loadRememberedLogin(): RememberedLogin | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(REMEMBER_LOGIN_KEY);
    if (stored) {
      return JSON.parse(stored) as RememberedLogin;
    }
  } catch {
    // 忽略解析错误
  }
  return null;
}

// 保存记住的登录凭据到 localStorage
function saveRememberedLogin(login: RememberedLogin): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(REMEMBER_LOGIN_KEY, JSON.stringify(login));
  } catch {
    // 忽略存储错误
  }
}

// 清除记住的登录凭据
function clearRememberedLogin(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(REMEMBER_LOGIN_KEY);
  } catch {
    // 忽略清除错误
  }
}

const LOGO_URL =
  'https://imagedelivery.net/evIMqF8VHO9ZoWtgAWZmSA/16d57f7d-2c76-46c7-eec0-198c46de1700/avatar';
const DESKTOP_CALLBACK_TIMEOUT_MS = 300_000;
const DESKTOP_CALLBACK_PATH = '/oauth/callback';
export type WebAuthMenuMode = 'embedded' | 'desktop-browser';

type DesktopCallbackRequest = {
  callbackUrl: string;
  state: string;
};

type AuthView =
  | 'main'
  | 'desktop_authorize'
  | 'email_login'
  | 'email_register'
  | 'email_otp'
  | 'email_otp_verify'
  | 'email_2fa';

type WalletType = 'metamask' | 'okx' | 'binance';

type WalletProvider = {
  isMetaMask?: boolean;
  isOkxWallet?: boolean;
  isOKXWallet?: boolean;
  isOkx?: boolean;
  isBinance?: boolean;
  isBinanceWallet?: boolean;
  isBinanceChain?: boolean;
  providers?: WalletProvider[];
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
};

type GoogleWindow = Window & {
  google?: {
    accounts?: {
      oauth2?: {
        initTokenClient?: (config: {
          client_id: string;
          scope: string;
          callback: (response: { access_token?: string }) => void;
        }) => { requestAccessToken: () => void };
      };
    };
  };
  ethereum?: WalletProvider;
  okxwallet?: WalletProvider;
  BinanceChain?: WalletProvider;
  binanceWallet?: WalletProvider;
};

function readEnv(name: string): string {
  const importMetaEnv = (import.meta as { env?: Record<string, string> }).env;
  const fromImportMeta = String(importMetaEnv?.[name] || '').trim();
  if (fromImportMeta) {
    return fromImportMeta;
  }

  const globalProcess = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const fromProcess = String(globalProcess?.env?.[name] || '').trim();
  return fromProcess;
}

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1';
}

function normalizeLoopbackCallbackUrl(rawUrl: string): string | null {
  const normalized = String(rawUrl || '').trim();
  if (!normalized) {
    return null;
  }

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== 'http:' || !isLoopbackHost(parsed.hostname)) {
      return null;
    }
    return parsed.toString();
  } catch {
    return null;
  }
}

function readLocationQueryParams(): URLSearchParams {
  if (typeof window === 'undefined') {
    return new URLSearchParams();
  }

  const params = new URLSearchParams(window.location.search);
  const hash = String(window.location.hash || '');
  const queryStart = hash.indexOf('?');
  if (queryStart < 0) {
    return params;
  }

  const hashQuery = hash.slice(queryStart + 1);
  const hashParams = new URLSearchParams(hashQuery);
  hashParams.forEach((value, key) => {
    params.set(key, value);
  });
  return params;
}

function resolveDesktopCallbackRequestFromLocation(): DesktopCallbackRequest | null {
  const params = readLocationQueryParams();
  const callbackUrl = normalizeLoopbackCallbackUrl(String(params.get('desktop_callback') || ''));
  if (!callbackUrl) {
    return null;
  }

  return {
    callbackUrl,
    state: String(params.get('desktop_state') || '').trim(),
  };
}

function buildDesktopCallbackReturnUrl(input: {
  request: DesktopCallbackRequest;
  accessToken: string;
}): string {
  const callbackUrl = new URL(input.request.callbackUrl);
  callbackUrl.searchParams.set('code', input.accessToken);
  if (input.request.state) {
    callbackUrl.searchParams.set('state', input.request.state);
  }
  return callbackUrl.toString();
}

function createDesktopCallbackState(): string {
  const entropy = Math.random().toString(36).slice(2, 10);
  return `desktop-${Date.now().toString(36)}-${entropy}`;
}

function createDesktopCallbackRedirectUri(): string {
  const port = 43_000 + Math.floor(Math.random() * 10_000);
  return `http://127.0.0.1:${port}${DESKTOP_CALLBACK_PATH}`;
}

function normalizeWebAuthLaunchPath(input: URL): URL {
  const normalized = new URL(input.toString());
  if (!normalized.hash) {
    normalized.hash = '#/login';
  }
  return normalized;
}

function resolveDesktopWebAuthLaunchBaseUrl(inputBaseUrl?: string): string {
  const baseUrl = String(inputBaseUrl || readEnv('NIMI_WEB_URL') || 'http://localhost').trim();

  try {
    const parsed = normalizeWebAuthLaunchPath(new URL(baseUrl));
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('桌面网页登录地址仅支持 http/https 协议');
    }

    return parsed.toString();
  } catch (error) {
    throw new Error(
      `无效的 NIMI_WEB_URL：${toErrorMessage(error, '配置解析失败')}`,
    );
  }
}

function buildDesktopWebAuthLaunchUrl(input: {
  callbackUrl: string;
  state: string;
  baseUrl?: string;
}): string {
  const url = new URL(resolveDesktopWebAuthLaunchBaseUrl(input.baseUrl));
  if (url.hash) {
    const hashRaw = url.hash.startsWith('#') ? url.hash.slice(1) : url.hash;
    const [hashPathRaw = '', hashQueryRaw = ''] = hashRaw.split('?');
    const hashPath = hashPathRaw.trim() || '/login';
    const hashQuery = new URLSearchParams(hashQueryRaw);
    hashQuery.set('desktop_callback', input.callbackUrl);
    hashQuery.set('desktop_state', input.state);
    const encodedHashQuery = hashQuery.toString();
    url.hash = encodedHashQuery ? `#${hashPath}?${encodedHashQuery}` : `#${hashPath}`;
    return url.toString();
  }

  url.searchParams.set('desktop_callback', input.callbackUrl);
  url.searchParams.set('desktop_state', input.state);
  return url.toString();
}

function getGoogleClientId(): string {
  return (
    readEnv('VITE_NIMI_GOOGLE_CLIENT_ID')
    || readEnv('VITE_GOOGLE_CLIENT_ID')
    || readEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID')
  );
}

function toErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const body = (error as { body?: unknown }).body;
    if (body && typeof body === 'object') {
      const bodyMessage = (body as { message?: unknown }).message;
      if (typeof bodyMessage === 'string' && bodyMessage.trim().length > 0) {
        return localizeAuthError(bodyMessage);
      }
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return localizeAuthError(error.message);
  }

  return fallback;
}

// Localize error messages to user-friendly English
function localizeAuthError(message: string): string {
  const lowered = message.toLowerCase();
  
  // Invalid credentials
  if (lowered.includes('invalid credentials') || lowered.includes('unauthorized')) {
    return 'Invalid email or password. Please check and try again.';
  }
  
  // Account blocked/disabled
  if (lowered.includes('blocked') || lowered.includes('disabled') || lowered.includes('banned')) {
    return 'Account has been disabled. Please contact support.';
  }
  
  // Account not found
  if (lowered.includes('not found') || lowered.includes('does not exist') || lowered.includes('no user')) {
    return 'This email is not registered. Please sign up first.';
  }
  
  // Invalid email format
  if (lowered.includes('invalid email') || lowered.includes('email format')) {
    return 'Invalid email format.';
  }
  
  // Weak password
  if (lowered.includes('password too weak') || lowered.includes('password strength')) {
    return 'Password is too weak. Please use a stronger password.';
  }
  
  // Invalid/expired code
  if (lowered.includes('invalid code') || lowered.includes('wrong code') || lowered.includes('code expired')) {
    return 'Invalid or expired code. Please request a new one.';
  }
  
  // Rate limit
  if (lowered.includes('rate limit') || lowered.includes('too many requests')) {
    return 'Too many requests. Please try again later.';
  }
  
  // Server error
  if (lowered.includes('internal server error') || lowered.includes('500')) {
    return 'Server error. Please try again later.';
  }
  
  return message;
}

function toDesktopBrowserAuthErrorMessage(error: unknown): string {
  const message = toErrorMessage(error, '网页登录授权失败').trim();
  const lowered = message.toLowerCase();

  if (!message) {
    return '网页登录授权失败，请重试。';
  }

  if (message.includes('等待 OAuth 回调超时') || lowered.includes('timeout')) {
    return '等待网页登录回调超时。请在浏览器完成授权后重试。';
  }

  if (message.includes('state')) {
    return '网页登录回调校验失败（state 不匹配），请重试。';
  }

  if (message.includes('缺少 access token')) {
    return '网页授权未返回 access token，请重试。';
  }

  if (message.includes('无法打开系统浏览器')) {
    return '无法打开系统浏览器，请检查默认浏览器设置后重试。';
  }

  return message;
}

function getUserDisplayLabel(user: Record<string, unknown> | null, fallback: string): string {
  if (!user) {
    return fallback;
  }

  const candidates = ['email', 'username', 'name', 'displayName', 'id'];
  for (const key of candidates) {
    const value = user[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }

  return fallback;
}

function parseChainId(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    if (value.startsWith('0x')) {
      const parsedHex = Number.parseInt(value, 16);
      return Number.isFinite(parsedHex) ? parsedHex : undefined;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function resolveWalletProvider(walletType: WalletType): WalletProvider | null {
  if (typeof window === 'undefined') {
    return null;
  }

  const win = window as GoogleWindow;
  if (walletType === 'metamask') {
    const provider = win.ethereum;
    if (!provider) {
      return null;
    }

    if (provider.isMetaMask) {
      return provider;
    }

    const nested = provider.providers?.find((candidate) => candidate?.isMetaMask);
    return nested ?? null;
  }

  if (walletType === 'okx') {
    const provider = win.okxwallet || win.ethereum;
    if (!provider) {
      return null;
    }

    if (
      provider === win.okxwallet
      || provider.isOkxWallet
      || provider.isOKXWallet
      || provider.isOkx
    ) {
      return provider;
    }

    const nested = provider.providers?.find((candidate) =>
      candidate?.isOkxWallet || candidate?.isOKXWallet || candidate?.isOkx);
    return nested ?? null;
  }

  const provider = win.BinanceChain || win.binanceWallet || win.ethereum;
  if (!provider) {
    return null;
  }

  if (
    provider === win.BinanceChain
    || provider === win.binanceWallet
    || provider.isBinance
    || provider.isBinanceWallet
    || provider.isBinanceChain
  ) {
    return provider;
  }

  const nested = provider.providers?.find((candidate) =>
    candidate?.isBinance || candidate?.isBinanceWallet || candidate?.isBinanceChain);
  return nested ?? null;
}

function loadGoogleScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('window is undefined'));
      return;
    }

    const win = window as GoogleWindow;
    if (win.google?.accounts?.oauth2?.initTokenClient) {
      resolve();
      return;
    }

    const existingScript = document.getElementById('google-identity-services');
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve());
      existingScript.addEventListener('error', () =>
        reject(new Error('Failed to load Google Identity Services script')));
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-identity-services';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Identity Services script'));
    document.head.appendChild(script);
  });
}

function CircleIconButton(props: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={props.label}
      onClick={props.onClick}
      disabled={props.disabled}
      className="h-[40px] w-[40px] rounded-full border border-border bg-card text-foreground shadow-sm transition hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
    >
      {props.children}
    </button>
  );
}

type AuthMenuProps = {
  onLogoHoverChange?: (hovered: boolean) => void;
  onLogoClick?: () => void;
  logoHintText?: string;
  logoErrorText?: string | null;
  logoDisabled?: boolean;
  enableAuthModal?: boolean;
};

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
  const buttonBase =
    'inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]';
  const buttonDefault = 'bg-mint-500 text-white hover:bg-mint-600 shadow-md';
  const buttonOutline = 'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:bg-input/30 dark:border-input dark:hover:bg-input/50';
  const buttonGhost = 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50';
  const inputBase =
    'file:text-foreground placeholder:text-[#999999] selection:bg-mint-500 selection:text-white dark:bg-input/30 border-input w-full min-w-0 rounded-md border bg-transparent text-sm shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-[#4ECCA3] focus-visible:ring-[#4ECCA3]/50 focus-visible:ring-[3px]';

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

      const latestUser = latest?.user && typeof latest.user === 'object'
        ? latest.user
        : null;

      dataSync.setToken(latestToken);
      setAuthSession(latestUser, latestToken);
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

  // 加载记住的登录凭据
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
    // Don't reset email/password if they were loaded from remembered login
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
    // Don't reset email/password if they were loaded from remembered login
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

  const applyTokens = async (tokens: AuthTokensDto, successMessage: string) => {
    const accessToken = String(tokens.accessToken || '').trim();
    if (!accessToken) {
      throw new Error('登录返回缺少 access token');
    }

    const refreshToken =
      typeof tokens.refreshToken === 'string' ? tokens.refreshToken.trim() : '';
    const user = tokens.user && typeof tokens.user === 'object'
      ? (tokens.user as Record<string, unknown>)
      : null;

    dataSync.setToken(accessToken);
    setAuthSession(user, accessToken);
    persistAuthSession({
      accessToken,
      refreshToken,
      user,
    });

    if (desktopCallbackRequest) {
      const callbackReturnUrl = buildDesktopCallbackReturnUrl({
        request: desktopCallbackRequest,
        accessToken,
      });
      window.location.replace(callbackReturnUrl);
      return;
    }

    await Promise.allSettled([
      dataSync.loadChats(),
      dataSync.loadContacts(),
      queryClient.invalidateQueries({ queryKey: ['chats'] }),
      queryClient.invalidateQueries({ queryKey: ['contacts'] }),
    ]);

    setStatusBanner({
      kind: 'success',
      message: successMessage,
    });
    setLoginError(null);
    setShowLoginModal(false);
    setView('main');
  };

  const handleLoginResult = async (result: OAuthLoginResultDto, successMessage: string) => {
    if (result.loginState === OAuthLoginState.BLOCKED) {
      setLoginError(String(result.blockedReason || '账号不可用，请联系支持团队。'));
      return;
    }

    if (result.loginState === OAuthLoginState.NEEDS_2FA) {
      setTempToken(String(result.tempToken || ''));
      setTwoFactorCode('');
      setView('email_2fa');
      return;
    }

    if (!result.tokens) {
      throw new Error('登录返回缺少 tokens');
    }

    await applyTokens(result.tokens, successMessage);

    if (result.loginState === OAuthLoginState.NEEDS_ONBOARDING) {
      setStatusBanner({
        kind: 'warning',
        message: '已登录，请完成资料设置。',
      });
    }
  };

  const handleGoogleLogin = async () => {
    setLoginError(null);
    if (!googleClientId) {
      setLoginError('缺少 Google Client ID（VITE_NIMI_GOOGLE_CLIENT_ID）');
      return;
    }

    setPending(true);
    try {
      await loadGoogleScript();
      const win = window as GoogleWindow;
      const initTokenClient = win.google?.accounts?.oauth2?.initTokenClient;
      if (!initTokenClient) {
        throw new Error('Google OAuth 初始化失败');
      }

      const tokenClient = initTokenClient({
        client_id: googleClientId,
        scope: 'email profile openid',
        callback: (tokenResponse) => {
          const accessToken = String(tokenResponse?.access_token || '').trim();
          if (!accessToken) {
            setLoginError('Google 没有返回 access token');
            setPending(false);
            return;
          }

          void (async () => {
            try {
              const result = await dataSync.callApi(
                (realm) => realm.services.AuthService.oauthLogin({
                  provider: OAuthProvider.GOOGLE,
                  accessToken,
                }),
                'Google 登录失败',
              );
              await handleLoginResult(result, 'Google 登录成功。');
            } catch (error) {
              setLoginError(toErrorMessage(error, 'Google 登录失败'));
            } finally {
              setPending(false);
            }
          })();
        },
      });

      tokenClient.requestAccessToken();
    } catch (error) {
      setLoginError(toErrorMessage(error, 'Google 初始化失败'));
      setPending(false);
    }
  };

  const handleEmailLogin = async (event: FormEvent) => {
    event.preventDefault();
    const identifier = email.trim();
    if (!identifier || !password) {
      setLoginError('请输入邮箱和密码');
      return;
    }

    setPending(true);
    setLoginError(null);
    try {
      const result = await dataSync.callApi(
        (realm) => realm.services.AuthService.passwordLogin({
          identifier,
          password,
        }),
        '邮箱登录失败',
      );
      
      // 保存或清除记住的登录凭据
      if (rememberMe) {
        saveRememberedLogin({ email: identifier, password, rememberMe: true });
      } else {
        clearRememberedLogin();
      }
      
      await handleLoginResult(result, '登录成功。');
    } catch (error) {
      setLoginError(toErrorMessage(error, '邮箱登录失败'));
    } finally {
      setPending(false);
    }
  };

  const handleEmailRegister = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setLoginError('请输入邮箱');
      return;
    }

    if (password.length < 8) {
      setLoginError('密码至少 8 位');
      return;
    }

    if (password !== confirmPassword) {
      setLoginError('两次输入的密码不一致');
      return;
    }

    setPending(true);
    setLoginError(null);
    try {
      const result = await dataSync.callApi(
        (realm) => realm.services.AuthService.passwordRegister({
          email: normalizedEmail,
          password,
        }),
        '邮箱注册失败',
      );
      await handleLoginResult(result, '注册并登录成功。');
    } catch (error) {
      setLoginError(toErrorMessage(error, '邮箱注册失败'));
    } finally {
      setPending(false);
    }
  };

  const handleRequestEmailOtp = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setLoginError('请输入邮箱');
      return;
    }

    setPending(true);
    setLoginError(null);
    try {
      const result = await dataSync.callApi(
        (realm) => realm.services.AuthService.requestEmailOtp({ email: normalizedEmail }),
        '发送验证码失败',
      );
      if (!result?.success) {
        throw new Error(String(result?.message || '发送验证码失败'));
      }
      setOtpCode('');
      setOtpResendCountdown(60);
      setView('email_otp_verify');
    } catch (error) {
      setLoginError(toErrorMessage(error, '发送验证码失败'));
    } finally {
      setPending(false);
    }
  };

  const handleVerifyEmailOtp = async (event: FormEvent) => {
    event.preventDefault();
    const normalizedEmail = email.trim();
    if (!normalizedEmail || otpCode.length !== 6) {
      setLoginError('请输入 6 位验证码');
      return;
    }

    setPending(true);
    setLoginError(null);
    try {
      const result = await dataSync.callApi(
        (realm) => realm.services.AuthService.verifyEmailOtp({
          email: normalizedEmail,
          code: otpCode,
        }),
        '验证码登录失败',
      );
      await handleLoginResult(result, '验证码登录成功。');
    } catch (error) {
      setLoginError(toErrorMessage(error, '验证码登录失败'));
    } finally {
      setPending(false);
    }
  };

  const handleResendOtp = async () => {
    if (otpResendCountdown > 0) {
      return;
    }

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      setLoginError('请输入邮箱');
      return;
    }

    setPending(true);
    setLoginError(null);
    try {
      const result = await dataSync.callApi(
        (realm) => realm.services.AuthService.requestEmailOtp({ email: normalizedEmail }),
        '重新发送验证码失败',
      );
      if (!result?.success) {
        throw new Error(String(result?.message || '重新发送验证码失败'));
      }
      setOtpResendCountdown(60);
      setOtpCode('');
    } catch (error) {
      setLoginError(toErrorMessage(error, '重新发送验证码失败'));
    } finally {
      setPending(false);
    }
  };

  const handleVerify2Fa = async (event: FormEvent) => {
    event.preventDefault();
    if (!tempToken || twoFactorCode.length !== 6) {
      setLoginError('请输入 6 位 2FA 验证码');
      return;
    }

    setPending(true);
    setLoginError(null);
    try {
      const tokens = await dataSync.callApi(
        (realm) => realm.services.AuthService.verify2Fa({
          tempToken,
          code: twoFactorCode,
        }),
        '2FA 验证失败',
      );
      await applyTokens(tokens, '2FA 验证成功，已登录。');
    } catch (error) {
      setLoginError(toErrorMessage(error, '2FA 验证失败'));
    } finally {
      setPending(false);
    }
  };

  const handleConfirmDesktopAuthorization = async (event: FormEvent) => {
    event.preventDefault();
    if (!desktopCallbackRequest) {
      setLoginError('无效的桌面授权请求，请重试。');
      setView('main');
      return;
    }

    const latestPersistedAuthSession = loadPersistedAuthSession();
    const accessToken = String(
      latestPersistedAuthSession?.accessToken
      || authToken
      || desktopCallbackToken
      || '',
    ).trim();
    if (!accessToken) {
      setLoginError('当前未检测到已登录会话，请先登录后再授权。');
      setView('main');
      return;
    }

    setPending(true);
    setLoginError(null);
    try {
      dataSync.setToken(accessToken);
      const user = await dataSync.loadCurrentUser();
      const normalizedUser = user && typeof user === 'object'
        ? (user as Record<string, unknown>)
        : null;

      setAuthSession(normalizedUser, accessToken);
      persistAuthSession({
        accessToken,
        refreshToken: latestPersistedAuthSession?.refreshToken || '',
        user: normalizedUser ?? desktopCallbackUser,
      });

      const callbackReturnUrl = buildDesktopCallbackReturnUrl({
        request: desktopCallbackRequest,
        accessToken,
      });
      window.location.replace(callbackReturnUrl);
    } catch (error) {
      const message = toErrorMessage(error, '当前登录态已失效，请重新登录后再授权。');
      const normalized = message.toUpperCase();
      setLoginError(
        normalized.includes('HTTP_401') || normalized.includes('UNAUTHORIZED')
          ? '当前登录态已过期，请重新登录后再授权。'
          : message,
      );
      setView('main');
    } finally {
      setPending(false);
    }
  };

  const handleWalletLogin = async (walletType: WalletType) => {
    setPending(true);
    setLoginError(null);
    
    // 设置超时保护，30秒后自动重置状态
    const timeoutId = window.setTimeout(() => {
      setPending(false);
    }, 30000);

    try {
      const provider = resolveWalletProvider(walletType);
      if (!provider) {
        throw new Error(
          walletType === 'metamask'
            ? '未检测到 MetaMask 钱包'
            : walletType === 'okx'
              ? '未检测到 OKX 钱包'
              : '未检测到 Binance 钱包',
        );
      }

      const accounts = await provider.request({
        method: 'eth_requestAccounts',
      }) as string[];
      const walletAddress = String(accounts?.[0] || '').trim();
      if (!walletAddress) {
        throw new Error('钱包未返回地址');
      }

      const chainIdRaw = await provider.request({
        method: 'eth_chainId',
      });
      const chainId = parseChainId(chainIdRaw);

      const challenge = await dataSync.callApi(
        (realm) => realm.services.AuthService.walletChallenge({
          walletAddress,
          chainId,
          walletType,
        }),
        '获取钱包签名挑战失败',
      );

      const challengeMessage = String(challenge?.message || '').trim();
      if (!challengeMessage) {
        throw new Error('无效的钱包签名挑战');
      }

      const signature = await provider.request({
        method: 'personal_sign',
        params: [challengeMessage, walletAddress],
      }) as string;
      if (!signature) {
        throw new Error('钱包签名失败');
      }

      const result = await dataSync.callApi(
        (realm) => realm.services.AuthService.walletLogin({
          walletAddress,
          chainId,
          nonce: challenge.nonce,
          message: challengeMessage,
          signature,
          walletType,
        }),
        '钱包登录失败',
      );

      await handleLoginResult(result, '钱包登录成功。');
    } catch (_error) {
      // 用户取消操作或其他错误，不显示错误提示
    } finally {
      window.clearTimeout(timeoutId);
      setPending(false);
    }
  };

  const renderHeader = () => {
    if (view === 'main') {
      return (
        <div className="mb-6 flex items-center justify-between">
          <button
            type="button"
            className={`${buttonBase} ${buttonOutline} h-5 w-5 rounded-full border-input px-0 text-[10px] text-muted-foreground hover:border-foreground/50 hover:text-foreground`}
            disabled
            title="Help"
          >
            ?
          </button>
          <h2 className="text-base font-semibold" style={{ color: '#1A1A1A', fontFamily: 'Inter, sans-serif', letterSpacing: '-0.03em' }}>{t('Auth.connectToNimi')}</h2>
          <button
            type="button"
            className={`${buttonBase} ${buttonGhost} h-auto w-auto p-0 text-xl leading-none text-muted-foreground hover:text-foreground`}
            onClick={closeModal}
            disabled={pending}
          >
            ×
          </button>
        </div>
      );
    }

    const title = view === 'email_login'
      ? t('Auth.emailLogin')
      : view === 'desktop_authorize'
        ? t('Auth.authorizeDesktop')
      : view === 'email_register'
        ? t('Auth.signUp')
        : view === 'email_2fa'
          ? t('Auth.verification')
          : view === 'email_otp'
            ? t('Auth.emailLogin')
            : t('Auth.verifyOtp');

    return (
      <div className="mb-6 flex items-center justify-between">
        <button
          type="button"
          className={`${buttonBase} ${buttonGhost} h-7 w-7 rounded-full border border-border px-0 text-sm text-muted-foreground hover:border-input hover:text-foreground`}
          onClick={() => {
            if (view === 'email_otp_verify') {
              setView('email_otp');
            } else if (view === 'email_register' || view === 'email_2fa') {
              setView('email_login');
            } else {
              setView('main');
            }
            setLoginError(null);
          }}
          disabled={pending}
        >
          ←
        </button>
        <h2 className='text-base font-semibold' style={{ color: '#1A1A1A', fontFamily: 'Inter, sans-serif', letterSpacing: '-0.03em' }}>{title}</h2>
        <button
          type="button"
          className={`${buttonBase} ${buttonGhost} h-7 w-7 rounded-full px-0 text-sm text-muted-foreground hover:text-foreground`}
          onClick={closeModal}
          disabled={pending}
        >
          ×
        </button>
      </div>
    );
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
                absolute inset-0 rounded-full bg-[#e8b9aa] opacity-30 blur-2xl transition-all duration-1000
                ${isHoveringLogo ? 'scale-150 opacity-40' : 'scale-110 animate-pulse'}
              `}
            />
            <div className="rounded-full bg-white/70 p-8 shadow-[0_20px_44px_rgba(188,130,108,0.22)] ring-1 ring-white/80 backdrop-blur-md transition-transform duration-200 group-hover:scale-105">
              <img src={LOGO_URL} alt="Nimi Logo" className="h-16 w-16 rounded-full object-cover" />
            </div>
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
              {renderHeader()}

              <div className="flex-1 flex flex-col min-h-0">
              {view === 'desktop_authorize' ? (
                <form onSubmit={handleConfirmDesktopAuthorization} className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {authStatus === 'authenticated'
                      ? '检测到当前网页已登录。是否授权当前桌面客户端使用此账号登录？'
                      : '检测到已有登录会话。是否授权当前桌面客户端使用此账号登录？'}
                  </p>
                  <div className="rounded-xl border border-border bg-muted/40 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                      {t('Auth.currentAccount')}
                    </div>
                    <div className="mt-1 text-sm font-semibold text-foreground">{desktopCallbackUserLabel}</div>
                  </div>
                  <button
                    type="submit"
                    className={`${buttonBase} ${buttonDefault} w-full rounded-xl py-3 text-sm font-semibold`}
                    disabled={pending}
                  >
                    {pending ? t('Auth.authorizing') : t('Auth.authorizeDesktopButton')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setView('main');
                      setLoginError(null);
                    }}
                    className="w-full text-center text-xs text-muted-foreground hover:text-foreground"
                    disabled={pending}
                  >
                    {t('Auth.useAnotherAccount')}
                  </button>
                </form>
              ) : null}

              {view === 'main' ? (
                <>
                  <button
                    type="button"
                    className={`${buttonBase} ${buttonDefault} w-[300px] mx-auto mb-2 justify-center h-auto px-4 py-3 rounded-2xl group`}
                    onClick={() => {
                      setView('email_otp');
                      setLoginError(null);
                    }}
                    disabled={pending}
                  >
                    <svg className="mr-3 w-5 h-5 text-white/80 group-hover:text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="2" y="5" width="20" height="14" rx="2" />
                      <path d="m2 5 8.65 5.8a2 2 0 0 0 2.7 0L22 5" />
                    </svg>
                    <span className="text-sm font-medium text-white">{t('Auth.continueWithEmailOtp')}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setView('email_login');
                      setLoginError(null);
                    }}
                    className="w-[300px] mx-auto mb-4 text-center text-xs text-muted-foreground hover:text-foreground"
                    disabled={pending}
                  >
                    <span style={{ color: '#666666' }}>{t('Auth.continueWithEmailPassword')}</span>
                  </button>

                  <div className="mb-6 flex items-center justify-center gap-3">
                    <CircleIconButton
                      label="Google login"
                      onClick={() => {
                        void handleGoogleLogin();
                      }}
                      disabled={pending}
                    >
                      <svg viewBox="0 0 24 24" className="mx-auto h-5 w-5">
                        <path
                          d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                          fill="#4285F4"
                        />
                        <path
                          d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                          fill="#34A853"
                        />
                        <path
                          d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.26.81-.58z"
                          fill="#FBBC05"
                        />
                        <path
                          d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                          fill="#EA4335"
                        />
                      </svg>
                    </CircleIconButton>

                    <CircleIconButton
                      label="Twitter disabled"
                      onClick={() => {}}
                      disabled
                    >
                      <svg viewBox="0 0 24 24" className="mx-auto h-4 w-4 fill-current opacity-60">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                    </CircleIconButton>

                    <CircleIconButton
                      label="TikTok disabled"
                      onClick={() => {}}
                      disabled
                    >
                      <svg viewBox="0 0 24 24" className="mx-auto h-4 w-4 fill-current opacity-60">
                        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z" />
                      </svg>
                    </CircleIconButton>
                  </div>

                  <div className="relative mb-5">
                    <div className="absolute inset-0 flex items-center">
                      <div className="w-full border-t" style={{ borderColor: '#E5E5E5' }} />
                    </div>
                    <div className="relative flex justify-center">
                      <span className="bg-card px-3 text-[11px] uppercase font-semibold" style={{ color: '#888888', fontFamily: 'Inter, sans-serif', letterSpacing: '0.1em' }}>
                        {t('Auth.walletSection')}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        void handleWalletLogin('metamask');
                      }}
                      className={`${buttonBase} ${buttonGhost} w-full justify-between h-auto rounded-xl bg-card px-4 py-2.5 border border-transparent hover:border-mint-200 hover:bg-mint-50`}
                      disabled={pending}
                    >
                      <div className="flex items-center gap-3">
                        <MetaMaskIcon className="h-5 w-5" />
                        <span className="text-sm font-medium" style={{ color: '#1A1A1A', fontFamily: 'Inter, sans-serif', letterSpacing: '0' }}>MetaMask</span>
                      </div>
                      <span className="rounded-full px-2 py-1 text-[10px] tracking-wide" style={{ backgroundColor: '#F2F2F2', color: '#1A1A1A' }}>
                        Multichain
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void handleWalletLogin('binance');
                      }}
                      className={`${buttonBase} ${buttonGhost} w-full justify-between h-auto rounded-xl bg-card px-4 py-2.5 border border-transparent hover:border-mint-200 hover:bg-mint-50`}
                      disabled={pending}
                    >
                      <div className="flex items-center gap-3">
                        <BinanceIcon className="h-5 w-5" />
                        <span className="text-sm font-medium" style={{ color: '#1A1A1A', fontFamily: 'Inter, sans-serif', letterSpacing: '0' }}>Binance Wallet</span>
                      </div>
                      <span className="rounded-full px-2 py-1 text-[10px] tracking-wide" style={{ backgroundColor: '#F2F2F2', color: '#1A1A1A' }}>
                        Multichain
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        void handleWalletLogin('okx');
                      }}
                      className={`${buttonBase} ${buttonGhost} w-full justify-between h-auto rounded-xl bg-card px-4 py-2.5 border border-transparent hover:border-mint-200 hover:bg-mint-50`}
                      disabled={pending}
                    >
                      <div className="flex items-center gap-3">
                        <OKXIcon className="h-5 w-5" />
                        <span className="text-sm font-medium" style={{ color: '#1A1A1A', fontFamily: 'Inter, sans-serif', letterSpacing: '0' }}>OKX Wallet</span>
                      </div>
                      <span className="rounded-full px-2 py-1 text-[10px] tracking-wide" style={{ backgroundColor: '#F2F2F2', color: '#1A1A1A' }}>
                        Multichain
                      </span>
                    </button>
                  </div>
                </>
              ) : null}

              {view === 'email_login' ? (
                <form onSubmit={handleEmailLogin} className="space-y-4">
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={`${inputBase} rounded-xl border-border px-4 py-2.5 h-auto`}
                    style={{ color: '#1A1A1A' }}
                    placeholder={t('Auth.emailPlaceholder')}
                    required
                    autoComplete="username"
                  />
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className={`${inputBase} rounded-xl border-border px-4 py-2.5 pr-12 h-auto`}
                      style={{ color: '#1A1A1A' }}
                      placeholder={t('Auth.passwordPlaceholder')}
                      required
                      autoComplete="current-password"
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 hover:text-foreground"
                      style={{ color: '#999999' }}
                      onClick={() => setShowPassword((current) => !current)}
                    >
                      {showPassword ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                          <line x1="2" x2="22" y1="2" y2="22" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <label className="flex items-center gap-2 text-sm cursor-pointer" style={{ color: '#666666' }}>
                    <div className="relative">
                      <input
                        type="checkbox"
                        checked={rememberMe}
                        onChange={(event) => setRememberMe(event.target.checked)}
                        className="peer sr-only"
                      />
                      <div className="h-4 w-4 rounded border border-border bg-white peer-checked:bg-mint-500 peer-checked:border-mint-500 transition-colors"></div>
                      <svg
                        className={`absolute inset-0 h-4 w-4 pointer-events-none transition-opacity ${rememberMe ? 'opacity-100' : 'opacity-0'}`}
                        viewBox="0 0 16 16"
                        fill="none"
                      >
                        <path
                          d="M3.5 8L6.5 11L12.5 5"
                          stroke="white"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                    <span>{t('Auth.rememberMe')}</span>
                  </label>
                  <button
                    type="submit"
                    className={`${buttonBase} ${buttonDefault} w-full rounded-xl py-3 text-sm font-semibold mt-4`}
                    disabled={pending}
                  >
                    {pending ? t('Auth.loggingIn') : t('Auth.login')}
                  </button>
                  <p className="text-center text-xs mt-3" style={{ color: '#666666' }}>
                    {t('Auth.noAccount')}{' '}
                    <button
                      type="button"
                      onClick={() => {
                        setView('email_register');
                        setLoginError(null);
                      }}
                      className="text-mint-500 font-semibold hover:underline"
                    >
                      {t('Auth.signUpLink')}
                    </button>
                  </p>
                </form>
              ) : null}

              {view === 'email_register' ? (
                <form onSubmit={handleEmailRegister} className="space-y-4">
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={`${inputBase} rounded-xl border-border px-4 py-3 h-auto`}
                    placeholder={t('Auth.emailPlaceholder')}
                    required
                  />
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className={`${inputBase} rounded-xl border-border px-4 py-3 pr-12 h-auto`}
                      placeholder={t('Auth.passwordMinChars')}
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 hover:text-foreground"
                      style={{ color: '#999999' }}
                      onClick={() => setShowPassword((current) => !current)}
                    >
                      {showPassword ? (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      ) : (
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                          <line x1="2" x2="22" y1="2" y2="22" />
                        </svg>
                      )}
                    </button>
                  </div>
                  <div className="relative">
                    <input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      className={`${inputBase} rounded-xl border-border px-4 py-3 pr-12 h-auto`}
                      placeholder={t('Auth.confirmPasswordPlaceholder')}
                      required
                      minLength={8}
                    />
                    <button
                      type="button"
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                      onClick={() => setShowConfirmPassword((current) => !current)}
                    >
                      {showConfirmPassword ? t('Auth.hidePassword') : t('Auth.showPassword')}
                    </button>
                  </div>
                  <button
                    type="submit"
                    className={`${buttonBase} ${buttonDefault} w-full mt-4 rounded-xl py-3 text-sm font-semibold`}
                    disabled={pending}
                  >
                    {pending ? t('Auth.creating') : t('Auth.createAccount')}
                  </button>
                </form>
              ) : null}

              {view === 'email_otp' ? (
                <form onSubmit={handleRequestEmailOtp} className="space-y-4 flex-1 flex flex-col">
                  <p className="text-sm text-muted-foreground">{t('Auth.otpHint')}</p>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className={`${inputBase} rounded-xl border-border px-4 py-3 h-auto text-sm`}
                    placeholder={t('Auth.emailPlaceholder')}
                    required
                  />
                  <div className="flex-1"></div>
                  <button
                    type="submit"
                    className={`${buttonBase} ${buttonDefault} w-full rounded-xl py-3 text-sm font-semibold`}
                    disabled={pending || !email.trim()}
                  >
                    {pending ? t('Auth.sending') : t('Auth.continue')}
                  </button>
                </form>
              ) : null}

              {view === 'email_otp_verify' ? (
                <form onSubmit={handleVerifyEmailOtp} className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    {t('Auth.otpSentTo')} <span className="font-medium text-foreground">{email}</span>.
                  </p>
                  <input
                    type="text"
                    value={otpCode}
                    onChange={(event) => setOtpCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    className={`${inputBase} rounded-xl border-border px-4 py-3 h-auto text-center text-xl font-bold tracking-[0.5em] focus-visible:ring-mint-500 focus-visible:border-mint-500`}
                    style={{ color: '#1A1A1A' }}
                    placeholder="000000"
                    required
                    pattern="\d{6}"
                    inputMode="numeric"
                  />
                  <button
                    type="submit"
                    className={`${buttonBase} ${buttonDefault} w-full rounded-xl py-3 text-sm font-semibold`}
                    disabled={pending || otpCode.length !== 6}
                  >
                    {pending ? t('Auth.verifying') : t('Auth.verifyAndLogin')}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      void handleResendOtp();
                    }}
                    disabled={pending || otpResendCountdown > 0}
                    className={`w-full text-center text-xs ${
                      otpResendCountdown > 0
                        ? 'text-muted-foreground cursor-not-allowed'
                        : 'text-mint-500 font-semibold hover:underline'
                    }`}
                  >
                    {otpResendCountdown > 0 ? t('Auth.resendIn', { count: otpResendCountdown }) : t('Auth.resendCode')}
                  </button>
                </form>
              ) : null}

              {view === 'email_2fa' ? (
                <form onSubmit={handleVerify2Fa} className="space-y-4">
                  <p className="text-sm text-muted-foreground">{t('Auth.twoFaHint')}</p>
                  <input
                    type="text"
                    value={twoFactorCode}
                    onChange={(event) =>
                      setTwoFactorCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                    className={`${inputBase} rounded-xl border-border px-4 py-3 h-auto text-center text-xl font-bold tracking-[0.5em]`}
                    placeholder="123456"
                    required
                    pattern="\d{6}"
                    inputMode="numeric"
                  />
                  <button
                    type="submit"
                    className={`${buttonBase} ${buttonDefault} w-full mt-4 rounded-xl py-6 text-sm font-semibold`}
                    disabled={pending || twoFactorCode.length !== 6}
                  >
                    {pending ? t('Auth.verifying') : t('Auth.verifyAndLogin')}
                  </button>
                </form>
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

            <div className="absolute bottom-5 left-0 right-0 text-center text-[11px]" style={{ color: '#999999' }}>{t('Auth.poweredByNimi')}</div>
          </div>
        </div>
      ) : null}
    </>
  );
}

// Wallet Icons
function MetaMaskIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#FFF5E6"/>
      <path d="M20.05 8l-7.3 2.5-.05 14.6 7.35 4.9 7.35-4.9-.05-14.6L20.05 8z" fill="#E2761B"/>
      <path d="M20.05 8v5.5l3.05 1.5 4.25-2.5-7.3-4.5z" fill="#E4761B"/>
      <path d="M12.7 10.5l4.3 2.5 3.05-1.5V8l-7.35 2.5z" fill="#F5841F"/>
      <path d="M20.05 13.5l-3.05 1.5h6.1l-3.05-1.5z" fill="#2F3134"/>
      <path d="M20.05 13.5l-3.05 1.5-1.25 6 4.3 3.5 4.3-3.5-1.25-6-3.05-1.5z" fill="#E2761B"/>
      <path d="M12.7 10.5l-1.2 6 2.5 6.5 1.25-6-2.55-6.5z" fill="#E4761B"/>
      <path d="M27.4 10.5l-2.55 6 1.25 6 2.5-6-1.2-6z" fill="#E4761B"/>
      <path d="M16.95 30l3.1 2 3.1-2v-2.5l-3.1 2-3.1-2V30z" fill="#2F3134"/>
    </svg>
  );
}

function BinanceIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#FEF9E6"/>
      <circle cx="20" cy="20" r="12" fill="#F0B90B"/>
      <path d="M20 11.5l2.5 2.5-1 1-1.5-1.5-1.5 1.5-1-1 2.5-2.5z" fill="#1A1A1A"/>
      <path d="M16 15.5l1-1 1.5 1.5-1 1-1.5-1.5z" fill="#1A1A1A"/>
      <path d="M24 15.5l-1-1-1.5 1.5 1 1 1.5-1.5z" fill="#1A1A1A"/>
      <path d="M20 28.5l-2.5-2.5 1-1 1.5 1.5 1.5-1.5 1 1-2.5 2.5z" fill="#1A1A1A"/>
      <path d="M24 24.5l-1 1-1.5-1.5 1-1 1.5 1.5z" fill="#1A1A1A"/>
      <path d="M16 24.5l1 1 1.5-1.5-1-1-1.5 1.5z" fill="#1A1A1A"/>
      <path d="M20 18l-1.5 1.5-1-1 2.5-2.5 2.5 2.5-1 1L20 18z" fill="#1A1A1A"/>
    </svg>
  );
}

function OKXIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect width="40" height="40" rx="8" fill="#F2F2F2"/>
      <path d="M12 12h7v7h-7V12z" fill="#121212"/>
      <path d="M21 12h7v7h-7V12z" fill="#121212"/>
      <path d="M12 21h7v7h-7v-7z" fill="#121212"/>
      <path d="M21 21h7v7h-7v-7z" fill="#121212"/>
    </svg>
  );
}

// OTP Input Component - 6 digit separate boxes
function _OtpInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleChange = (index: number, digit: string) => {
    if (!/^\d*$/.test(digit)) return;
    
    const newValue = value.slice(0, index) + digit + value.slice(index + 1);
    onChange(newValue.slice(0, 6));

    // Auto-focus next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (!value[index] && index > 0) {
        // If current box is empty, move focus to previous and clear it
        onChange(value.slice(0, index - 1) + value.slice(index));
        inputRefs.current[index - 1]?.focus();
      } else {
        // Clear current box
        onChange(value.slice(0, index) + value.slice(index + 1));
      }
    } else if (e.key === 'ArrowLeft' && index > 0) {
      inputRefs.current[index - 1]?.focus();
    } else if (e.key === 'ArrowRight' && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pastedData = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    onChange(pastedData);
    
    // Focus the appropriate input
    if (pastedData.length < 6) {
      inputRefs.current[pastedData.length]?.focus();
    } else {
      inputRefs.current[5]?.focus();
    }
  };

  return (
    <div className="flex justify-center gap-2">
      {Array.from({ length: 6 }, (_, index) => (
        <input
          key={index}
          ref={(el) => { inputRefs.current[index] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={value[index] || ''}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={handlePaste}
          className="w-10 h-12 text-center text-xl font-bold rounded-lg border transition-all duration-200 outline-none focus:border-[#4ECCA3] focus:ring-2 focus:ring-[#4ECCA3]/30"
          style={{ 
            borderColor: value[index] ? '#4ECCA3' : '#E5E5E5',
            backgroundColor: '#FFFFFF',
            color: '#1A1A1A'
          }}
        />
      ))}
    </div>
  );
}

export function WebAuthMenu(props: { mode?: WebAuthMenuMode }) {
  const { t } = useTranslation();
  const mode = props.mode || 'embedded';
  const [isLogoHovered, setIsLogoHovered] = useState(false);
  const [desktopAuthPending, setDesktopAuthPending] = useState(false);
  const [desktopAuthError, setDesktopAuthError] = useState<string | null>(null);
  const desktopAttemptRef = useRef(0);
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);

  const desktopLogoHintText = desktopAuthPending
    ? t('Auth.desktopBrowserOpened')
    : desktopAuthError
      ? t('Auth.desktopAuthFailed')
      : undefined;

  const handleDesktopLogoClick = () => {
    const myAttempt = ++desktopAttemptRef.current;

    void (async () => {
      setDesktopAuthPending(true);
      setDesktopAuthError(null);
      let listenTask: ReturnType<typeof desktopBridge.oauthListenForCode> | null = null;

      try {
        if (!desktopBridge.hasTauriInvoke()) {
          throw new Error('当前环境不支持浏览器授权回调，请在桌面客户端中运行。');
        }

        const callbackUrl = createDesktopCallbackRedirectUri();
        const callbackState = createDesktopCallbackState();
        const launchUrl = buildDesktopWebAuthLaunchUrl({
          callbackUrl,
          state: callbackState,
        });

        listenTask = desktopBridge.oauthListenForCode({
          redirectUri: callbackUrl,
          timeoutMs: DESKTOP_CALLBACK_TIMEOUT_MS,
        });

        const launchResult = await desktopBridge.openExternalUrl(launchUrl);
        if (!launchResult.opened) {
          throw new Error('无法打开系统浏览器，请检查系统默认浏览器设置。');
        }

        setStatusBanner({
          kind: 'info',
          message: '已打开浏览器，请在网页完成授权登录。',
        });

        if (!listenTask) {
          throw new Error('网页登录回调监听初始化失败。');
        }

        const callback = await listenTask;
        if (callback.error) {
          throw new Error(`网页授权失败：${callback.error}`);
        }

        const callbackStateFromWeb = String(callback.state || '').trim();
        if (!callbackStateFromWeb || callbackStateFromWeb !== callbackState) {
          throw new Error('网页登录回调 state 校验失败，请重试。');
        }

        const accessToken = String(callback.code || '').trim();
        if (!accessToken) {
          throw new Error('网页登录回调缺少 access token。');
        }

        dataSync.setToken(accessToken);
        const user = await dataSync.loadCurrentUser();
        setAuthSession(
          (user && typeof user === 'object' ? (user as Record<string, unknown>) : null),
          accessToken,
        );

        await Promise.allSettled([
          dataSync.loadChats(),
          dataSync.loadContacts(),
          queryClient.invalidateQueries({ queryKey: ['chats'] }),
          queryClient.invalidateQueries({ queryKey: ['contacts'] }),
        ]);

        setStatusBanner({
          kind: 'success',
          message: '网页登录授权成功，已登录。',
        });
      } catch (error) {
        if (myAttempt !== desktopAttemptRef.current) return;
        const message = toDesktopBrowserAuthErrorMessage(error);
        setDesktopAuthError(message);
        setStatusBanner({
          kind: 'error',
          message,
        });
      } finally {
        if (listenTask) {
          void listenTask.catch(() => undefined);
        }
        if (myAttempt === desktopAttemptRef.current) {
          setDesktopAuthPending(false);
        }
      }
    })();
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

    void desktopBridge.startWindowDrag().catch(() => {
      // no-op
    });
  };

  return (
    <main
      className="relative min-h-screen overflow-hidden bg-[#f3f1ee] text-[#3b352c]"
      onMouseDown={handleRootMouseDown}
    >
      <Suspense fallback={null}>
        <ParticleBackgroundLight
          isLogoHovered={isLogoHovered}
          profile={mode === 'embedded' ? 'web' : 'desktop'}
        />
      </Suspense>
      <AuthMenu
        onLogoHoverChange={setIsLogoHovered}
        onLogoClick={mode === 'desktop-browser' ? handleDesktopLogoClick : undefined}
        logoHintText={mode === 'desktop-browser' ? desktopLogoHintText : undefined}
        logoErrorText={mode === 'desktop-browser' ? desktopAuthError : null}
        logoDisabled={false}
        enableAuthModal={mode !== 'desktop-browser'}
      />
    </main>
  );
}
