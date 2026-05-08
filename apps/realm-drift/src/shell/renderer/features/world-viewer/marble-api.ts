import { invoke } from '@renderer/bridge';

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1_000; // 10 minutes
const MAX_NETWORK_RETRIES = 3;

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

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error('MARBLE_POLL_ABORTED');
  }
}

async function invokeMarble(command: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
  assertNotAborted(signal);
  const result = await invoke(command, payload as never);
  assertNotAborted(signal);
  return result;
}

export async function generateMarbleWorld(
  input: MarbleGenerateInput,
  signal?: AbortSignal,
): Promise<string> {
  const commandInput: Record<string, unknown> = {
    displayName: input.displayName,
    prompt: input.prompt,
    quality: input.quality,
  };
  if (input.imageUrl) {
    commandInput.imageUrl = input.imageUrl;
  }
  const data = await invokeMarble('realm_drift_marble_generate', { input: commandInput }, signal) as Record<string, unknown>;

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
      const data = await invokeMarble('realm_drift_marble_poll', { operationId }, signal) as Record<string, unknown>;
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
          worldViewerUrl = `https://marble.worldlabs.ai/world/${worldId}`;
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
