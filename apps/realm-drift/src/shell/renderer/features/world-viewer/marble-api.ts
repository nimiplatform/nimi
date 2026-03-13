const DEFAULT_MARBLE_API_URL = 'https://api.worldlabs.ai/marble/v1';
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes
const MAX_NETWORK_RETRIES = 3;

/** Mutable config for testability. In production, reads from import.meta.env. */
export const marbleConfig = {
  getApiUrl(): string {
    const env = (import.meta as { env?: Record<string, string> }).env;
    return String(env?.VITE_MARBLE_API_URL || '').trim() || DEFAULT_MARBLE_API_URL;
  },
  getApiKey(): string {
    const env = (import.meta as { env?: Record<string, string> }).env;
    return String(env?.VITE_MARBLE_API_KEY || '').trim();
  },
};

export type MarbleGenerateInput = {
  displayName: string;
  prompt: string;
  imageUrl?: string;
  quality: 'mini' | 'standard';
};

export type MarbleOperationResult = {
  done: boolean;
  worldId?: string;
  worldViewerUrl?: string;
  error?: string;
};

async function marbleFetch(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<unknown> {
  const apiKey = marbleConfig.getApiKey();
  if (!apiKey) {
    throw new Error('MARBLE_API_KEY_MISSING');
  }

  const baseUrl = marbleConfig.getApiUrl();
  const url = `${baseUrl}${path}`;

  const headers: Record<string, string> = {
    'WLT-Api-Key': apiKey,
    'Content-Type': 'application/json',
  };

  const response = await fetch(url, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
    signal: options.signal,
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    if (response.status === 429) throw new Error('MARBLE_RATE_LIMITED');
    if (response.status === 401) throw new Error('MARBLE_UNAUTHORIZED');
    if (response.status === 403) throw new Error('MARBLE_FORBIDDEN');
    throw new Error(`MARBLE_HTTP_${response.status}: ${errorBody || response.statusText}`);
  }

  return response.json();
}

export async function generateMarbleWorld(
  input: MarbleGenerateInput,
  signal?: AbortSignal,
): Promise<string> {
  const body: Record<string, unknown> = {
    display_name: input.displayName,
    model: input.quality === 'standard' ? 'standard' : 'mini',
    prompt: { text: input.prompt },
  };

  if (input.imageUrl) {
    (body.prompt as Record<string, unknown>).image_url = input.imageUrl;
  }

  const data = await marbleFetch('/worlds:generate', {
    method: 'POST',
    body,
    signal,
  }) as Record<string, unknown>;

  const operationId = String(data.operationId || data.operation_id || data.name || '');
  if (!operationId) {
    throw new Error('MARBLE_NO_OPERATION_ID');
  }

  return operationId;
}

export async function pollMarbleOperation(
  operationId: string,
  signal?: AbortSignal,
): Promise<MarbleOperationResult> {
  const startTime = Date.now();
  let networkRetries = 0;

  while (Date.now() - startTime < POLL_TIMEOUT_MS) {
    if (signal?.aborted) {
      throw new Error('MARBLE_POLL_ABORTED');
    }

    try {
      const data = await marbleFetch(`/operations/${operationId}`, { signal }) as Record<string, unknown>;
      networkRetries = 0; // Reset on success

      const done = Boolean(data.done);
      if (done) {
        const result = (data.response ?? data.result ?? data) as Record<string, unknown>;
        const worldId = String(result.world_id || result.worldId || '');

        // Extract viewer URL from assets or construct it
        const assets = (result.assets ?? []) as Record<string, unknown>[];
        let worldViewerUrl = '';
        for (const asset of assets) {
          if (String(asset.type || '').toLowerCase() === 'web_viewer' || String(asset.type || '').toLowerCase() === 'viewer') {
            worldViewerUrl = String(asset.url || '');
            break;
          }
        }
        if (!worldViewerUrl && worldId) {
          worldViewerUrl = `https://marble.worldlabs.ai/viewer/${worldId}`;
        }

        const error = data.error as Record<string, unknown> | undefined;
        if (error) {
          return {
            done: true,
            error: String(error.message || error.code || 'Generation failed'),
          };
        }

        return { done: true, worldId, worldViewerUrl };
      }

      // Wait before next poll
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(resolve, POLL_INTERVAL_MS);
        signal?.addEventListener('abort', () => {
          clearTimeout(timeout);
          reject(new Error('MARBLE_POLL_ABORTED'));
        }, { once: true });
      });
    } catch (err) {
      if (signal?.aborted || (err instanceof Error && err.message === 'MARBLE_POLL_ABORTED')) {
        throw err;
      }

      networkRetries += 1;
      if (networkRetries > MAX_NETWORK_RETRIES) {
        throw err;
      }

      // Wait before retry
      await new Promise<void>((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  throw new Error('MARBLE_POLL_TIMEOUT');
}
