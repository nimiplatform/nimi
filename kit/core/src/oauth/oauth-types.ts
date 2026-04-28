// ---------------------------------------------------------------------------
// OAuth types — extracted from Desktop runtime-bridge types
// ---------------------------------------------------------------------------

export type OauthTokenExchangePayload = {
  tokenUrl: string;
  clientId: string;
  code: string;
  codeVerifier?: string;
  redirectUri?: string;
  clientSecret?: string;
  extra?: Record<string, string>;
};

export type OauthTokenExchangeResult = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
  raw: Record<string, unknown>;
};

export type OauthListenForCodePayload = {
  redirectUri: string;
  timeoutMs?: number;
};

export type OauthListenForCodeResult = {
  callbackUrl: string;
  code?: string;
  refreshToken?: string;
  state?: string;
  error?: string;
};

export type OpenExternalUrlResult = {
  opened: boolean;
};

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

function assertRecord(value: unknown, errorMessage: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorMessage);
  }
  return value as Record<string, unknown>;
}

function parseRequiredString(
  value: unknown,
  fieldName: string,
  errorPrefix: string,
): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${errorPrefix}: ${fieldName} is required`);
  }
  return normalized;
}

function parseOptionalString(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function parsePositiveNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return undefined;
  }
  return numeric;
}

export function parseOauthTokenExchangeResult(value: unknown): OauthTokenExchangeResult {
  const record = assertRecord(value, 'oauth_token_exchange returned invalid payload');
  const raw = record.raw && typeof record.raw === 'object' && !Array.isArray(record.raw)
    ? (record.raw as Record<string, unknown>)
    : {};
  return {
    accessToken: parseRequiredString(record.accessToken, 'accessToken', 'oauth_token_exchange'),
    refreshToken: parseOptionalString(record.refreshToken),
    tokenType: parseOptionalString(record.tokenType),
    expiresIn: parsePositiveNumber(record.expiresIn),
    scope: parseOptionalString(record.scope),
    raw,
  };
}

export function parseOauthListenForCodeResult(value: unknown): OauthListenForCodeResult {
  const record = assertRecord(value, 'oauth_listen_for_code returned invalid payload');
  return {
    callbackUrl: parseRequiredString(record.callbackUrl, 'callbackUrl', 'oauth_listen_for_code'),
    code: parseOptionalString(record.code),
    refreshToken: parseOptionalString(record.refreshToken),
    state: parseOptionalString(record.state),
    error: parseOptionalString(record.error),
  };
}

export function parseOpenExternalUrlResult(value: unknown): OpenExternalUrlResult {
  const record = assertRecord(value, 'open_external_url returned invalid payload');
  return {
    opened: Boolean(record.opened),
  };
}

// ---------------------------------------------------------------------------
// TauriOAuthBridge — injection point for platform-specific Tauri invoke
// ---------------------------------------------------------------------------

export type TauriOAuthBridge = {
  hasTauriInvoke: () => boolean;
  oauthListenForCode: (payload: OauthListenForCodePayload) => Promise<OauthListenForCodeResult>;
  oauthTokenExchange: (payload: OauthTokenExchangePayload) => Promise<OauthTokenExchangeResult>;
  openExternalUrl: (url: string) => Promise<{ opened: boolean }>;
  focusMainWindow: () => Promise<void>;
};
