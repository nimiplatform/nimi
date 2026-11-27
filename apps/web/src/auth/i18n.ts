import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { resolveInitialLocale } from '../landing/i18n/locale.js';
import { loadWebLocaleFont } from '../fonts.js';
import { accountSecurityCopy } from './account-security-copy.js';

const en = {
  Common: { back: 'Back' },
  Auth: {
    signIn: 'Sign in to Nimi',
    signInTitle: 'Sign in or create an account',
    signUpTitle: 'Create your Nimi account',
    runtimeSignInTitle: 'Sign in to confirm primary Runtime',
    connectSignInTitle: 'Sign in to connect application',
    oauthSignInTitle: 'Sign in to Nimi to continue',
    comingSoon: 'Coming soon',
    downloadHome: 'Download Nimi Home',
    legalPrefix: 'I have read and agree to the ',
    terms: 'Terms of Service',
    legalAnd: ' and ',
    privacy: 'Privacy Policy',
    legalRequired: 'Please read and agree to the Terms of Service and Privacy Policy first.',
    continue: 'Continue',
    alternative: 'Other sign-in methods',
    emailPlaceholder: 'Email address',
    chooseAlternative: 'Other ways to continue',
    useEmailCodeInstead: 'Use an email code instead',
    passwordPlaceholder: 'Password',
    forgotPassword: 'Forgot password?',
    hidePassword: 'Hide password',
    showPassword: 'Show password',
    otpConfirmMessage: 'Send a one-time code to this email?',
    cancel: 'Cancel',
    confirmOtp: 'Send code',
    setPasswordHint: 'Set a password to finish creating your Nimi account.',
    passwordMinChars: 'Password (at least 8 characters)',
    confirmPasswordPlaceholder: 'Confirm password',
    settingPassword: 'Setting password…',
    setPasswordButton: 'Set password',
    otpSentTo: 'A one-time code was sent to',
    verifying: 'Verifying…',
    verifyAndContinue: 'Verify and continue',
    resendIn: 'Resend in {{count}}s',
    resendCode: 'Resend code',
    twoFaHint: 'Enter the 6-digit code from your authenticator app.',
    verifyAndLogin: 'Verify and sign in',
    emailNotRegistered: 'This email is not registered yet.',
    registerConfirmHint: 'Create a Nimi account with this email?',
    confirmRegister: 'Create account',
  },
  Account: {
    sessionCheck: 'Confirming secure session…',
    sessionUnknown: 'Unable to confirm the account session.',
    pageUnavailable: "Unable to open this account page. Try loading it again.",
    switchContinuationExpired: "The account-switch request has expired. Please start again.",
    signedInTitle: 'Signed in to Nimi',
    currentAccountFallback: 'current account',
    manageAccount: 'Manage account',
    backHome: 'Back to Nimi',
    backToLogin: 'Back to sign in',
    loginRequired: 'Sign-in required',
    loginNimi: 'Sign in to Nimi',
    actionFailed: 'Account action failed',
    passwordTooShort: 'Password must be at least 12 characters.',
    passwordUpdated: 'Password updated.',
    newPasswordPlaceholder: 'New password',
    updatePassword: 'Update password',
    twoFaPrepared: 'Two-factor setup ready. Enter the code to confirm.',
    prepareTwoFa: "Set up two-factor authentication",
    replaceTwoFa: 'Replace authenticator',
    currentTwoFaCode: 'Code from your current authenticator',
    newTwoFaCode: 'Code from your new authenticator',
    confirmTwoFa: 'Confirm authenticator',
    twoFaCodePlaceholder: '2FA code',
    twoFaEnabled: 'Two-factor authentication enabled.',
    enableTwoFa: 'Enable 2FA',
    twoFaDisabled: 'Two-factor authentication disabled.',
    disableTwoFa: 'Disable 2FA',
    googleUnlinked: 'Google sign-in unlinked.',
    unlinkGoogle: 'Unlink Google',
    googleNotConfigured: 'Google sign-in is not configured.',
    googleLinked: 'Google sign-in linked.',
    linkGoogle: 'Link Google',
    tiktokUnlinked: 'TikTok sign-in unlinked.',
    unlinkTiktok: 'Unlink TikTok',
    tiktokOpening: 'Opening TikTok authorization…',
    linkTiktok: 'Link TikTok',
    logoutFailed: 'Sign-out failed',
    logout: 'Sign out of the web account',
    accountRecovery: 'Account recovery',
    oauthContinuationExpired: "This authorization request has expired. Please start again.",
    tiktokLoginRejected: "TikTok sign-in verification failed. Please try again.",
    twoFaTransactionMissing: "Unable to start two-factor verification. Please try again.",
    oauthLinkFailed: 'OAuth linking failed',
    oauthAccountUnavailable: 'Could not confirm the account to link. Please try again.',
    bearerForbidden: "The sign-in service returned an unexpected response. Please try again later or contact support.",
    twoFaFailed: 'Two-factor verification failed',
    oauthFailedTitle: 'OAuth action failed',
    enterTwoFaCode: 'Enter the two-factor code',
    completingOauth: 'Completing OAuth…',
    sixDigitCodePlaceholder: '6-digit code',
    continue: 'Continue',
    recoveryFailed: 'Account recovery failed',
    otpSendFailed: 'Failed to send the code',
    fullLoginRequired: 'This account needs the full sign-in flow for additional verification.',
    recoverySessionUnconfirmed: "Unable to confirm the account recovery session. Please try again.",
    recoverTitle: 'Recover account',
    recoveryAuthenticator: 'Authenticator code (if enabled)',
    requestNewRecoveryCode: 'Request a new email code',
    emailPlaceholder: 'Email',
    pleaseWait: 'Please wait…',
    cryptoRandomUnavailable: 'Secure random generation is unavailable in this browser.',
    pkceUnavailable: 'This browser does not support secure PKCE S256.',
    tiktokNotConfigured: 'TikTok sign-in is not currently configured.',
    oauthStateMissing: 'The OAuth link session is missing or has already been used.',
    oauthStateInvalid: 'The OAuth link session is invalid.',
    oauthStateExpired: 'The OAuth link session has expired. Please try again.',
    oauthAuthFailedPrefix: 'TikTok authorization failed: {{error}}',
    oauthStateMismatch: 'OAuth state mismatch. Please start again.',
    oauthCodeMissing: 'TikTok did not return an authorization code.',
  },
};

const zh = {
  Common: { back: '返回' },
  Auth: {
    signIn: '登录 Nimi',
    signInTitle: '登录或注册 Nimi',
    signUpTitle: '创建你的 Nimi 账号',
    runtimeSignInTitle: '登录以确认主 Runtime',
    connectSignInTitle: '登录以连接应用',
    oauthSignInTitle: '登录 Nimi 以继续',
    comingSoon: '即将开放',
    downloadHome: '下载 Nimi Home',
    legalPrefix: '我已阅读并同意',
    terms: '《服务条款》',
    legalAnd: '和',
    privacy: '《隐私政策》',
    legalRequired: '请先阅读并同意《服务条款》和《隐私政策》',
    continue: '继续',
    alternative: '其他登录方式',
    emailPlaceholder: '邮箱地址',
    chooseAlternative: '其他继续方式',
    useEmailCodeInstead: '改用邮箱验证码',
    passwordPlaceholder: '密码',
    forgotPassword: '忘记密码？',
    hidePassword: '隐藏密码',
    showPassword: '显示密码',
    otpConfirmMessage: '向此邮箱发送一次性验证码？',
    cancel: '取消',
    confirmOtp: '发送验证码',
    setPasswordHint: '设置密码以完成 Nimi 账号注册。',
    passwordMinChars: '密码（至少 8 位）',
    confirmPasswordPlaceholder: '确认密码',
    settingPassword: '正在设置密码…',
    setPasswordButton: '设置密码',
    otpSentTo: '一次性验证码已发送至',
    verifying: '正在验证…',
    verifyAndContinue: '验证并继续',
    resendIn: '{{count}} 秒后可重新发送',
    resendCode: '重新发送验证码',
    twoFaHint: '请输入身份验证器中的 6 位验证码。',
    verifyAndLogin: '验证并登录',
    emailNotRegistered: '此邮箱尚未注册。',
    registerConfirmHint: '使用此邮箱创建 Nimi 账号？',
    confirmRegister: '创建账号',
  },
  Account: {
    sessionCheck: '正在确认安全会话…',
    sessionUnknown: '无法确认账号会话。',
    pageUnavailable: "暂时无法打开账号页面，请重新加载。",
    switchContinuationExpired: '账号切换会话已失效，请重新操作。',
    signedInTitle: '已登录 Nimi',
    currentAccountFallback: '当前账号',
    manageAccount: '管理账号',
    backHome: '返回官网首页',
    backToLogin: '返回登录',
    loginRequired: '需要登录',
    loginNimi: '登录 Nimi',
    actionFailed: '账号操作失败',
    passwordTooShort: '密码至少需要 12 位。',
    passwordUpdated: '密码已更新。',
    newPasswordPlaceholder: '新密码',
    updatePassword: '更新密码',
    twoFaPrepared: "两步验证设置已准备好，请输入验证码完成确认。",
    prepareTwoFa: "设置两步验证",
    replaceTwoFa: '更换验证器',
    currentTwoFaCode: '当前验证器的验证码',
    newTwoFaCode: '新验证器的验证码',
    confirmTwoFa: '确认验证器',
    twoFaCodePlaceholder: '2FA 验证码',
    twoFaEnabled: '两步验证已启用。',
    enableTwoFa: '启用 2FA',
    twoFaDisabled: '两步验证已停用。',
    disableTwoFa: '停用 2FA',
    googleUnlinked: 'Google 登录已解绑。',
    unlinkGoogle: '解绑 Google',
    googleNotConfigured: 'Google 登录当前未配置。',
    googleLinked: 'Google 登录已绑定。',
    linkGoogle: '绑定 Google',
    tiktokUnlinked: 'TikTok 登录已解绑。',
    unlinkTiktok: '解绑 TikTok',
    tiktokOpening: "正在打开 TikTok 授权…",
    linkTiktok: '绑定 TikTok',
    logoutFailed: '退出失败',
    logout: '退出 Web 账号',
    accountRecovery: '账号恢复',
    oauthContinuationExpired: '授权会话已过期，请重新登录。',
    tiktokLoginRejected: 'TikTok 登录验证未通过，请重试。',
    twoFaTransactionMissing: '未能发起两步验证，请刷新后重试。',
    oauthLinkFailed: 'OAuth 绑定失败',
    oauthAccountUnavailable: '无法确认要绑定的账号，请重试。',
    bearerForbidden: "登录服务返回了异常响应，请稍后重试或联系技术支持。",
    twoFaFailed: '两步验证失败',
    oauthFailedTitle: 'OAuth 操作失败',
    enterTwoFaCode: '输入两步验证码',
    completingOauth: '正在完成 OAuth…',
    sixDigitCodePlaceholder: '6 位验证码',
    continue: '继续',
    recoveryFailed: '账号恢复失败',
    otpSendFailed: '验证码发送失败',
    fullLoginRequired: '此账号需要通过完整登录流程完成附加验证。',
    recoverySessionUnconfirmed: '未能确认账号恢复会话，请重试。',
    recoverTitle: '恢复账号',
    recoveryAuthenticator: '验证器验证码（已启用时必填）',
    requestNewRecoveryCode: '重新获取邮箱验证码',
    emailPlaceholder: '邮箱',
    pleaseWait: '请稍候…',
    cryptoRandomUnavailable: '当前浏览器不支持安全随机数生成。',
    pkceUnavailable: '当前浏览器不支持安全的 PKCE S256。',
    tiktokNotConfigured: 'TikTok 登录当前未配置。',
    oauthStateMissing: 'OAuth 绑定事务不存在或已消费。',
    oauthStateInvalid: 'OAuth 绑定事务无效。',
    oauthStateExpired: 'OAuth 绑定事务已失效，请重新发起。',
    oauthAuthFailedPrefix: 'TikTok 授权失败：{{error}}',
    oauthStateMismatch: 'OAuth state 不匹配，请重新发起。',
    oauthCodeMissing: 'TikTok 未返回授权 code。',
  },
};

let pendingInit: Promise<void> | null = null;

function syncWebAccountResources(): void {
  i18n.addResourceBundle('en', 'translation', { ...en, AccountSecurity: accountSecurityCopy.en }, true, true);
  i18n.addResourceBundle('zh', 'translation', { ...zh, AccountSecurity: accountSecurityCopy.zh }, true, true);
  if (i18n.language) {
    i18n.emit('languageChanged', i18n.language);
  }
}

export function initializeWebAccountI18n(): Promise<void> {
  if (i18n.isInitialized) {
    syncWebAccountResources();
    return Promise.resolve();
  }
  if (pendingInit) return pendingInit;
  // Resolve with the same chain as the landing page (URL > persisted landing
  // locale > browser language). The static HTML hardcodes <html lang="en">,
  // so documentElement.lang is not a usable signal on a fresh load.
  pendingInit = (async () => {
    const language = resolveInitialLocale({
      search: typeof window === 'undefined' ? '' : window.location.search,
      storage: typeof window === 'undefined' ? null : window.localStorage,
      navigatorLanguage: typeof navigator === 'undefined' ? '' : navigator.language,
    });
    if (typeof document !== 'undefined') {
      document.documentElement.lang = language;
      loadWebLocaleFont(language);
    }
    await i18n.use(initReactI18next).init({
      lng: language,
      fallbackLng: 'en',
      interpolation: { escapeValue: false },
      react: { bindI18nStore: 'added' },
      resources: {
        en: { translation: { ...en, AccountSecurity: accountSecurityCopy.en } },
        zh: { translation: { ...zh, AccountSecurity: accountSecurityCopy.zh } },
      },
    });
  })().catch((error) => {
    pendingInit = null;
    throw error;
  });
  return pendingInit;
}

if (i18n.isInitialized) {
  syncWebAccountResources();
}

if (import.meta.hot) {
  import.meta.hot.accept();
}
