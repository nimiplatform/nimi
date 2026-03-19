export function toErrorMessage(error: unknown, fallback: string): string {
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

export function localizeAuthError(message: string): string {
  const lowered = message.toLowerCase();

  if (lowered.includes('invalid credentials') || lowered.includes('unauthorized')) {
    return 'Invalid email or password. Please check and try again.';
  }

  if (lowered.includes('blocked') || lowered.includes('disabled') || lowered.includes('banned')) {
    return 'Account has been disabled. Please contact support.';
  }

  if (lowered.includes('not found') || lowered.includes('does not exist') || lowered.includes('no user')) {
    return 'This email is not registered. Please sign up first.';
  }

  if (lowered.includes('invalid email') || lowered.includes('email format')) {
    return 'Invalid email format.';
  }

  if (lowered.includes('password too weak') || lowered.includes('password strength')) {
    return 'Password is too weak. Please use a stronger password.';
  }

  if (lowered.includes('invalid code') || lowered.includes('wrong code') || lowered.includes('code expired')) {
    return 'Invalid or expired code. Please request a new one.';
  }

  if (lowered.includes('rate limit') || lowered.includes('too many requests')) {
    return 'Too many requests. Please try again later.';
  }

  if (lowered.includes('internal server error') || lowered.includes('500')) {
    return 'Server error. Please try again later.';
  }

  return message;
}

export function toDesktopBrowserAuthErrorMessage(error: unknown): string {
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

export function getUserDisplayLabel(user: Record<string, unknown> | null, fallback: string): string {
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
