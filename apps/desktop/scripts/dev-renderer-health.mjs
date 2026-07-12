/* global AbortSignal, fetch */

const DEFAULT_TIMEOUT_MS = 1200;

function isSuccessfulResponse(response) {
  return response.status >= 200 && response.status < 300;
}

export async function probeRendererHealth({
  baseUrl,
  fetchImpl = fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  cacheKey = Date.now(),
}) {
  try {
    const rootResponse = await fetchImpl(`${baseUrl}/`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!isSuccessfulResponse(rootResponse)) {
      return false;
    }

    const entryResponse = await fetchImpl(`${baseUrl}/main.tsx?nimi-renderer-health=${cacheKey}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!isSuccessfulResponse(entryResponse)) {
      return false;
    }

    const contentType = String(entryResponse.headers.get('content-type') || '').toLowerCase();
    return contentType.includes('javascript');
  } catch {
    return false;
  }
}
