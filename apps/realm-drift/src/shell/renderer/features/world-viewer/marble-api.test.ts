import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateMarbleWorld, pollMarbleOperation } from './marble-api.js';

const { invokeMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
}));

vi.mock('@renderer/bridge', () => ({
  invoke: (...args: unknown[]) => invokeMock(...args),
}));

describe('marble-api', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('generateMarbleWorld invokes the Tauri command without renderer key material', async () => {
    invokeMock.mockResolvedValue({ operationId: 'op-123' });

    const opId = await generateMarbleWorld({
      displayName: 'Fantasy Castle World',
      prompt: 'A fantasy castle',
      quality: 'mini',
    });

    expect(opId).toBe('op-123');
    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith('realm_drift_marble_generate', {
      input: {
        displayName: 'Fantasy Castle World',
        prompt: 'A fantasy castle',
        quality: 'mini',
      },
    });
    expect(JSON.stringify(invokeMock.mock.calls[0])).not.toContain('WLT-Api-Key');
    expect(JSON.stringify(invokeMock.mock.calls[0])).not.toContain('test-key');
  });

  it('generateMarbleWorld passes image URL when provided', async () => {
    invokeMock.mockResolvedValue({ operationId: 'op-456' });

    await generateMarbleWorld({
      displayName: 'Castle World',
      prompt: 'A castle',
      imageUrl: 'https://example.com/image.jpg',
      quality: 'standard',
    });

    expect(invokeMock).toHaveBeenCalledWith('realm_drift_marble_generate', {
      input: {
        displayName: 'Castle World',
        prompt: 'A castle',
        imageUrl: 'https://example.com/image.jpg',
        quality: 'standard',
      },
    });
  });

  it('generateMarbleWorld accepts operation_id response shape', async () => {
    invokeMock.mockResolvedValue({ operation_id: 'op-text' });

    const opId = await generateMarbleWorld({
      displayName: 'Text World',
      prompt: 'A magical forest',
      quality: 'mini',
    });

    expect(opId).toBe('op-text');
  });

  it('throws Tauri command errors', async () => {
    invokeMock.mockRejectedValue(new Error('MARBLE_RATE_LIMITED'));

    await expect(
      generateMarbleWorld({ displayName: 'Test World', prompt: 'test', quality: 'mini' }),
    ).rejects.toThrow('MARBLE_RATE_LIMITED');
  });

  it('throws when server-side API key is missing', async () => {
    invokeMock.mockRejectedValue(new Error('MARBLE_API_KEY_MISSING'));

    await expect(
      generateMarbleWorld({ displayName: 'Test World', prompt: 'test', quality: 'mini' }),
    ).rejects.toThrow('MARBLE_API_KEY_MISSING');
  });

  it('does not read renderer environment key material', async () => {
    invokeMock.mockResolvedValue({ operationId: 'op-mini' });
    (import.meta as { env?: Record<string, string> }).env = {
      VITE_MARBLE_API_KEY: 'renderer-key-must-not-be-used',
    };

    await generateMarbleWorld({ displayName: 'Test World', prompt: 'test', quality: 'mini' });

    expect(JSON.stringify(invokeMock.mock.calls)).not.toContain('renderer-key-must-not-be-used');
  });
});

describe('pollMarbleOperation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls until done=true and returns worldViewerUrl', async () => {
    // First poll: not done. Second poll: done.
    invokeMock
      .mockResolvedValueOnce({ done: false })
      .mockResolvedValueOnce({
        done: true,
        response: {
          world_id: 'marble-w1',
          assets: [{ type: 'web_viewer', url: 'https://marble.worldlabs.ai/world/marble-w1' }],
        },
      });

    const promise = pollMarbleOperation('op-123');

    // Advance past the first poll interval
    await vi.advanceTimersByTimeAsync(5_000);

    const result = await promise;
    expect(result.done).toBe(true);
    expect(result.worldViewerUrl).toBe('https://marble.worldlabs.ai/world/marble-w1');
    expect(result.worldId).toBe('marble-w1');
    expect(invokeMock).toHaveBeenCalledWith('realm_drift_marble_poll', { operationId: 'op-123' });
  });

  it('extracts viewer URL from assets array', async () => {
    invokeMock.mockResolvedValue({
      done: true,
      response: {
        world_id: 'marble-w2',
        assets: [
          { type: 'thumbnail', url: 'https://example.com/thumb.jpg' },
          { type: 'viewer', url: 'https://marble.worldlabs.ai/world/marble-w2' },
        ],
      },
    });

    const result = await pollMarbleOperation('op-456');

    expect(result.worldViewerUrl).toBe('https://marble.worldlabs.ai/world/marble-w2');
  });

  it('constructs viewer URL from worldId when no asset match', async () => {
    invokeMock.mockResolvedValue({
      done: true,
      response: {
        world_id: 'marble-w3',
        assets: [],
      },
    });

    const result = await pollMarbleOperation('op-789');

    expect(result.worldViewerUrl).toBe('https://marble.worldlabs.ai/world/marble-w3');
  });

  it('returns error when operation has error', async () => {
    invokeMock.mockResolvedValue({
      done: true,
      response: { world_id: '' },
      error: { message: 'Content filter blocked' },
    });

    const result = await pollMarbleOperation('op-err');

    expect(result.done).toBe(true);
    expect(result.error).toBe('Content filter blocked');
  });

  it('throws MARBLE_POLL_ABORTED when signal is aborted', async () => {
    invokeMock.mockResolvedValue({ done: false });

    const ac = new AbortController();

    // Catch the rejection immediately to avoid unhandled rejection warnings
    const promise = pollMarbleOperation('op-abort', ac.signal).catch((e: Error) => e);

    // Abort after the first poll response but during the wait
    await vi.advanceTimersByTimeAsync(1);
    ac.abort();
    await vi.advanceTimersByTimeAsync(5_000);

    const error = await promise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('MARBLE_POLL_ABORTED');
  });

  it('throws MARBLE_POLL_TIMEOUT after 10 minutes', async () => {
    invokeMock.mockResolvedValue({ done: false });

    // Catch the rejection immediately to avoid unhandled rejection warnings
    const promise = pollMarbleOperation('op-timeout').catch((e: Error) => e);

    // Advance past 10 minutes worth of polling
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000 + 5_000);

    const error = await promise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('MARBLE_POLL_TIMEOUT');
  });

  it('retries on network error up to 3 times then throws', async () => {
    invokeMock
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'))
      .mockRejectedValueOnce(new Error('network error'));

    // Catch the rejection immediately to avoid unhandled rejection warnings
    const promise = pollMarbleOperation('op-retry').catch((e: Error) => e);

    // Advance through retry delays (each retry waits 5s)
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    await vi.advanceTimersByTimeAsync(5_000);

    const error = await promise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('network error');
    // 4 calls total: initial + 3 retries
    expect(invokeMock).toHaveBeenCalledTimes(4);
  });

  it('recovers after network error when next poll succeeds', async () => {
    invokeMock
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        done: true,
        response: {
          world_id: 'marble-w4',
          assets: [{ type: 'web_viewer', url: 'https://marble.worldlabs.ai/world/marble-w4' }],
        },
      });

    const promise = pollMarbleOperation('op-recover');

    // Advance past retry delay
    await vi.advanceTimersByTimeAsync(5_000);

    const result = await promise;
    expect(result.done).toBe(true);
    expect(result.worldViewerUrl).toBe('https://marble.worldlabs.ai/world/marble-w4');
  });
});
