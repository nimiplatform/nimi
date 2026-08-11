// ---------------------------------------------------------------------------
// OAuth types — extracted from Desktop runtime-bridge types
// ---------------------------------------------------------------------------

export type OauthListenForCodePayload = {
  redirectUri: string;
  timeoutMs?: number;
};

export type OauthListenForCodeResult = {
  callbackUrl: string;
  code?: string;
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

export function parseOauthListenForCodeResult(value: unknown): OauthListenForCodeResult {
  const record = assertRecord(value, 'oauth_listen_for_code returned invalid payload');
  return {
    callbackUrl: parseRequiredString(record.callbackUrl, 'callbackUrl', 'oauth_listen_for_code'),
    code: parseOptionalString(record.code),
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
// OAuth bridge injection points.
//
// Desktop browser auth only needs a code callback listener plus window
// orchestration. Token exchange and credential custody are host-owned and are
// intentionally absent from this renderer-facing bridge.
// ---------------------------------------------------------------------------

export type ShellOAuthCodeBridge = {
  hasShellHostInvoke: () => boolean;
  oauthListenForCode: (payload: OauthListenForCodePayload) => Promise<OauthListenForCodeResult>;
  openExternalUrl: (url: string) => Promise<{ opened: boolean }>;
  focusMainWindow: () => Promise<void>;
};
