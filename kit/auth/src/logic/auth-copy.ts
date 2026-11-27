import { toErrorMessage } from './oauth-helpers.js';

export const AUTH_COPY = {
  browserSessionMissingCurrentUser: '无法确认当前浏览器会话',
  onboardingPending: '已登录，请完成资料设置。',
  googleClientIdMissing: '尚未配置 Google 登录，请联系管理员检查应用配置。',
  googleInitFailed: 'Google 登录初始化失败，请重试。',
  googleScriptLoadFailed: '无法加载 Google 登录服务，请检查网络后重试。',
  googleOAuthInitFailed: 'Google 登录初始化失败，请重试。',
  googleIdTokenMissing: '未收到 Google 登录凭据，请重试。',
  desktopBrowserAuthUnsupported: '当前环境不支持通过浏览器完成登录。',
  desktopBrowserOpenFailed: '无法打开系统默认浏览器，请检查浏览器设置后重试。',
  desktopBrowserStateInvalid: '这次登录校验已失效，请重新发起登录。',
  desktopBrowserCodeMissing: '浏览器未返回完整的登录信息，请重试。',
  desktopBrowserAuthorizationUrlMissing: '暂时无法生成登录链接，请确认 Nimi 服务正在运行后重试。',
  desktopBrowserRuntimeBrokerMissing: '本机登录服务尚未就绪，请稍后重试。',
  socialOauthBridgeMissing: '当前环境暂不支持第三方网页登录。',
  emailRequired: '请输入邮箱',
  emailInvalid: '请输入有效的邮箱地址',
  emailAndPasswordRequired: '请输入邮箱和密码',
  passwordLoginUnsupported: '当前环境不支持密码登录，请使用邮箱验证码登录',
  emailLoginSuccess: '登录成功。',
  emailLoginFailed: '邮箱登录失败，请重试。',
  passwordTooShort: '密码至少 8 位',
  passwordMismatch: '两次输入的密码不一致',
  setPasswordSuccess: '注册成功。',
  setPasswordFailed: '设置密码失败，请重试。',
  setPasswordFinalizeFailed: '密码已设置成功，但系统未完成登录。请直接使用邮箱和密码登录。',
  requestOtpFailed: '发送验证码失败，请重试。',
  resendOtpFailed: '重新发送验证码失败，请重试。',
  otpCodeRequired: '请输入 6 位验证码',
  otpVerifySuccess: '验证码登录成功。',
  otpVerifyFailed: '验证码登录失败，请重试。',
  twoFactorCodeRequired: '请输入 6 位 2FA 验证码',
  twoFactorSuccess: '2FA 验证成功，已登录。',
  twoFactorFailed: '2FA 验证失败，请重试。',
} as const;

const AUTH_ERROR_TRANSLATIONS: Array<[needle: string, localized: string]> = [
  ['invalid email or password', '邮箱或密码错误，请检查后重试。'],
  ['invalid credentials', '邮箱或密码错误，请检查后重试。'],
  ['account has been disabled', '账号已被停用，请联系支持团队。'],
  ['this email is not registered', '该邮箱尚未注册，请先注册。'],
  ['invalid email format', '邮箱格式不正确。'],
  ['app is still starting', '服务正在启动，请稍后重试。'],
  ['password is too weak', '密码强度不足，请使用更强的密码。'],
  ['invalid or expired code', '验证码无效或已过期，请重新获取。'],
  ['too many requests', '请求过于频繁，请稍后再试。'],
  ['server error', '服务器异常，请稍后再试。'],
  ['failed to load google identity services script', AUTH_COPY.googleScriptLoadFailed],
  ['window is undefined', AUTH_COPY.googleInitFailed],
];

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

function authErrorSearchText(error: unknown, renderedMessage: string): string {
  const raw =
    error instanceof Error ? error.message
      : typeof error === 'string' ? error
        : '';
  return `${renderedMessage}\n${raw}`.trim().toLowerCase();
}

export function formatProviderLoginSuccessMessage(providerLabel: string): string {
  return `${providerLabel} 登录成功。`;
}

export function formatProviderLoginFailureMessage(providerLabel: string): string {
  return `${providerLabel} 登录失败，请重试。`;
}

export function toAuthUiErrorMessage(
  error: unknown,
  fallback: string,
  options?: {
    expiredMessage?: string;
    forbiddenMessage?: string;
  },
): string {
  const rendered = toErrorMessage(error, fallback).trim() || fallback;
  const searchText = authErrorSearchText(error, rendered);

  if (
    options?.expiredMessage
    && includesAny(searchText, ['http_401', 'unauthorized', 'token_expired', 'session_expired', 'auth_session_invalid'])
  ) {
    return options.expiredMessage;
  }
  if (
    options?.forbiddenMessage
    && includesAny(searchText, ['http_403', 'forbidden', 'permission_denied'])
  ) {
    return options.forbiddenMessage;
  }
  if (searchText.includes('authentication failed. please try again.')) {
    return fallback;
  }

  for (const [needle, localized] of AUTH_ERROR_TRANSLATIONS) {
    if (searchText.includes(needle)) {
      return localized;
    }
  }

  if (/^[\x00-\x7f\s.,:;!?'"\-_/()]+$/.test(rendered)) {
    return fallback;
  }
  return rendered;
}
