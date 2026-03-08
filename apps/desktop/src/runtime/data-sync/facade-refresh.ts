import type { FetchImpl } from './api-core';

export async function refreshDataSyncAccessToken(params: {
  realmBaseUrl: string;
  refreshToken: string;
  fetchImpl: FetchImpl | null;
}): Promise<{ accessToken: string; refreshToken?: string }> {
  const fetchFn = params.fetchImpl || globalThis.fetch.bind(globalThis);
  const response = await fetchFn(`${params.realmBaseUrl}/api/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: params.refreshToken }),
  });
  if (!response.ok) {
    throw new Error(`refresh failed: ${response.status}`);
  }
  const data = await response.json() as Record<string, unknown>;
  const tokens = (data.tokens || data) as Record<string, unknown>;
  const accessToken = String(tokens.accessToken || '').trim();
  if (!accessToken) {
    throw new Error('refresh response missing accessToken');
  }
  const refreshToken = String(tokens.refreshToken || '').trim() || undefined;
  return { accessToken, refreshToken };
}
