import { createNimiError } from '../core/errors.js';
import type { ReasonCodeValue } from '../types/index.js';
import type { RealmOptions, RealmTokenRefreshResult } from './client-types.js';
import { asRecord, normalizeText } from './client-helpers.js';
import { createRealmServiceRegistry } from './generated/service-registry.js';

function parseRefreshExpiresIn(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export async function executeGeneratedRealmRefreshToken(input: {
  baseUrl: string;
  refreshToken: string;
  fetchImpl?: RealmOptions['fetchImpl'];
  mapError: (response: Response) => Promise<Error> | Error;
}): Promise<unknown> {
  const fetchFn = input.fetchImpl || globalThis.fetch.bind(globalThis);
  const registry = createRealmServiceRegistry(async (request) => {
    const url = new URL(`${input.baseUrl}${request.path}`);
    if (request.query) {
      for (const [key, value] of Object.entries(request.query)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    const response = await fetchFn(url, {
      method: request.method,
      headers: {
        ...(request.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(request.headers || {}),
      },
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: request.signal,
    });
    if (!response.ok) {
      throw await input.mapError(response);
    }
    return response.json();
  });

  return registry.AuthService.refreshToken({ refreshToken: input.refreshToken });
}

export function parseRealmRefreshResult(
  payload: unknown,
  missingAccessToken: {
    message: string;
    reasonCode: ReasonCodeValue;
    actionHint: string;
  },
): RealmTokenRefreshResult {
  const payloadRecord = asRecord(payload);
  const tokens = asRecord(payloadRecord.tokens || payloadRecord);
  const accessToken = normalizeText(tokens.accessToken || payloadRecord.accessToken);
  if (!accessToken) {
    throw createNimiError({
      message: missingAccessToken.message,
      reasonCode: missingAccessToken.reasonCode,
      actionHint: missingAccessToken.actionHint,
      source: 'realm',
    });
  }
  return {
    accessToken,
    refreshToken: normalizeText(tokens.refreshToken || payloadRecord.refreshToken) || undefined,
    expiresIn: parseRefreshExpiresIn(tokens.expiresIn ?? payloadRecord.expiresIn),
  };
}
