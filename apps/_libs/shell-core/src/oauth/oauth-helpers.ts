import { readBundledEnv } from '../env.js';

export const readEnv = readBundledEnv;

// ---------------------------------------------------------------------------
// OAuth helpers — extracted from Desktop auth-helpers.ts (common parts)
// ---------------------------------------------------------------------------

export const DESKTOP_CALLBACK_TIMEOUT_MS = 300_000;
export const DESKTOP_CALLBACK_PATH = '/oauth/callback';
const DESKTOP_CALLBACK_STATE_PREFIX = 'desktop';
const DESKTOP_CALLBACK_STATE_VERSION = 'v1';
const DESKTOP_CALLBACK_PORT_MIN = 1024;
const DESKTOP_CALLBACK_PORT_MAX = 65535;
const GENERIC_AUTH_ERROR_MESSAGE = 'Authentication failed. Please try again.';

function envFlagEnabled(value: string | undefined): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function shouldIncludeDebugAuthErrorDetails(): boolean {
  return envFlagEnabled(readEnv('VITE_NIMI_DEBUG_BOOT'));
}

function readRawAuthErrorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null) {
    const body = (error as { body?: unknown }).body;
    if (body && typeof body === 'object') {
      const bodyMessage = (body as { message?: unknown }).message;
      if (typeof bodyMessage === 'string' && bodyMessage.trim()) {
        return bodyMessage.trim();
      }
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }

  if (typeof error === 'string' && error.trim()) {
    return error.trim();
  }

  return '';
}

function withDebugAuthErrorDetails(message: string, error: unknown): string {
  if (!shouldIncludeDebugAuthErrorDetails()) {
    return message;
  }
  const rawMessage = readRawAuthErrorMessage(error);
  if (!rawMessage) {
    return message;
  }
  if (message.includes(rawMessage)) {
    return message;
  }
  return `${message} [debug: ${rawMessage}]`;
}

// ---------------------------------------------------------------------------
// URL / loopback helpers
// ---------------------------------------------------------------------------

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === 'localhost' || normalized === '127.0.0.1';
}

export function normalizeLoopbackCallbackUrl(rawUrl: string): string | null {
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

// ---------------------------------------------------------------------------
// Desktop callback helpers
// ---------------------------------------------------------------------------

function requireSecureCrypto(): Crypto {
  if (typeof globalThis.crypto === 'undefined') {
    throw new Error('Secure random generator is unavailable');
  }
  return globalThis.crypto;
}

function createSecureOpaqueToken(prefix: string): string {
  const secureCrypto = requireSecureCrypto();
  if (typeof secureCrypto.randomUUID === 'function') {
    return `${prefix}-${secureCrypto.randomUUID().replace(/-/g, '')}`;
  }
  const bytes = new Uint8Array(16);
  secureCrypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  return `${prefix}-${suffix}`;
}

function createSecureRandomUint32(): number {
  const secureCrypto = requireSecureCrypto();
  const values = new Uint32Array(1);
  secureCrypto.getRandomValues(values);
  return values[0] ?? 0;
}

function createUniformRandomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error('maxExclusive must be a positive integer');
  }
  const maxUint32 = 0x1_0000_0000;
  const limit = maxUint32 - (maxUint32 % maxExclusive);
  let candidate = createSecureRandomUint32();
  while (candidate >= limit) {
    candidate = createSecureRandomUint32();
  }
  return candidate % maxExclusive;
}

function normalizeFlowKind(flowKind: string | undefined): string {
  const normalized = String(flowKind || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'desktop-callback';
}

type ParsedDesktopCallbackState = {
  flowKind: string;
  issuedAtMs: number;
  nonce: string;
};

function parseDesktopCallbackState(state: string): ParsedDesktopCallbackState | null {
  const normalized = String(state || '').trim();
  const parts = normalized.split(':');
  if (parts.length !== 5) {
    return null;
  }
  const [prefix, version, flowKind, issuedAtRaw, nonce] = parts;
  if (
    prefix !== DESKTOP_CALLBACK_STATE_PREFIX
    || version !== DESKTOP_CALLBACK_STATE_VERSION
    || !flowKind
    || !issuedAtRaw
    || !nonce
  ) {
    return null;
  }
  const issuedAtMs = Number.parseInt(issuedAtRaw, 36);
  if (!Number.isFinite(issuedAtMs) || issuedAtMs <= 0) {
    return null;
  }
  return {
    flowKind,
    issuedAtMs,
    nonce,
  };
}

export function createDesktopCallbackState(flowKind?: string): string {
  const normalizedFlowKind = normalizeFlowKind(flowKind);
  const issuedAt = Date.now().toString(36);
  const nonce = createSecureOpaqueToken('nonce');
  return [
    DESKTOP_CALLBACK_STATE_PREFIX,
    DESKTOP_CALLBACK_STATE_VERSION,
    normalizedFlowKind,
    issuedAt,
    nonce,
  ].join(':');
}

export function validateDesktopCallbackState(input: {
  expectedState: string;
  actualState: string;
  flowKind?: string;
  maxAgeMs?: number;
  nowMs?: number;
}): boolean {
  const expectedState = String(input.expectedState || '').trim();
  const actualState = String(input.actualState || '').trim();
  if (!expectedState || !actualState || !constantTimeEquals(expectedState, actualState)) {
    return false;
  }
  const parsed = parseDesktopCallbackState(actualState);
  if (!parsed) {
    return false;
  }
  if (parsed.flowKind !== normalizeFlowKind(input.flowKind)) {
    return false;
  }
  const nowMs = Number.isFinite(input.nowMs) ? Number(input.nowMs) : Date.now();
  const maxAgeMs = Number.isFinite(input.maxAgeMs) ? Number(input.maxAgeMs) : DESKTOP_CALLBACK_TIMEOUT_MS;
  const ageMs = nowMs - parsed.issuedAtMs;
  return ageMs >= 0 && ageMs <= maxAgeMs;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let diff = leftBytes.length ^ rightBytes.length;
  const maxLength = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

export function createDesktopCallbackRedirectUri(): string {
  const span = DESKTOP_CALLBACK_PORT_MAX - DESKTOP_CALLBACK_PORT_MIN + 1;
  const port = DESKTOP_CALLBACK_PORT_MIN + createUniformRandomInt(span);
  return `http://127.0.0.1:${port}${DESKTOP_CALLBACK_PATH}`;
}

// ---------------------------------------------------------------------------
// Error helpers
// ---------------------------------------------------------------------------

export function toErrorMessage(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null) {
    const body = (error as { body?: unknown }).body;
    if (body && typeof body === 'object') {
      const bodyMessage = (body as { message?: unknown }).message;
      if (typeof bodyMessage === 'string' && bodyMessage.trim().length > 0) {
        return withDebugAuthErrorDetails(localizeAuthError(bodyMessage), error);
      }
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return withDebugAuthErrorDetails(localizeAuthError(error.message), error);
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
  if (lowered.includes('api not initialized')) {
    return 'App is still starting. Please wait a moment and try again.';
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

  return GENERIC_AUTH_ERROR_MESSAGE;
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
