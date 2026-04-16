import { toErrorMessage } from './oauth-helpers.js';

export const AUTH_COPY = {
  loginMissingAccessToken: '登录返回缺少访问令牌',
  loginMissingTokenPayload: '登录返回缺少令牌数据',
  onboardingPending: '已登录，请完成资料设置。',
  googleClientIdMissing: '缺少 Google 客户端 ID（VITE_NIMI_GOOGLE_CLIENT_ID）',
  googleInitFailed: 'Google 初始化失败，请重试。',
  googleScriptLoadFailed: '加载 Google 授权脚本失败，请稍后重试。',
  googleOAuthInitFailed: 'Google 授权初始化失败，请重试。',
  googleAccessTokenMissing: 'Google 没有返回访问令牌',
  desktopBrowserAuthUnsupported: '当前环境不支持浏览器授权回调',
  desktopBrowserOpenFailed: '无法打开系统浏览器',
  desktopBrowserStateInvalid: '网页登录回调 state 校验失败',
  desktopBrowserAccessTokenMissing: '网页登录回调缺少 access token',
  desktopBrowserLaunchProtocolInvalid: '桌面网页登录地址仅支持 http/https 协议',
  emailRequired: '请输入邮箱',
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
  desktopRequestInvalid: '无效的桌面授权请求，请重试。',
  desktopSessionMissing: '当前未检测到已登录会话，请先登录后再授权。',
  desktopSessionInvalid: '当前登录态已失效，请重新登录后再授权。',
  desktopSessionExpired: '当前登录态已过期，请重新登录后再授权。',
  desktopPermissionDenied: '当前账号无权授权此桌面客户端，请使用有权限的账号后重试。',
  walletLoginTimeout: '钱包登录超时，请重试。',
  walletAddressMissing: '钱包未返回地址',
  walletChallengeInvalid: '无效的钱包签名挑战',
  walletSignatureFailed: '钱包签名失败',
  walletLoginSuccess: '钱包登录成功。',
  walletLoginFailed: '钱包登录失败，请重试。',
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

export function walletUnavailableMessage(providerLabel: string): string {
  return `未检测到 ${providerLabel} 钱包`;
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
