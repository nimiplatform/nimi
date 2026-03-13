import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateMarbleWorld, pollMarbleOperation, marbleConfig } from './marble-api.js';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

describe('marble-api', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    marbleConfig.getApiKey = () => 'test-key-123';
    marbleConfig.getApiUrl = () => 'https://api.worldlabs.ai/marble/v1';
  });

  it('generateMarbleWorld sends POST with correct headers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ operationId: 'op-123' }),
    });

    const opId = await generateMarbleWorld({
      displayName: 'Fantasy Castle World',
      prompt: 'A fantasy castle',
      quality: 'mini',
    });

    expect(opId).toBe('op-123');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/worlds:generate');
    expect(options.method).toBe('POST');
    expect((options.headers as Record<string, string>)['WLT-Api-Key']).toBe('test-key-123');
  });

  it('generateMarbleWorld includes image URL when provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ operationId: 'op-456' }),
    });

    await generateMarbleWorld({
      displayName: 'Castle World',
      prompt: 'A castle',
      imageUrl: 'https://example.com/image.jpg',
      quality: 'standard',
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.world_prompt.type).toBe('image');
    expect(body.world_prompt.image_url).toBe('https://example.com/image.jpg');
    expect(body.model).toBe('standard');
  });

  it('generateMarbleWorld sends text prompt with correct world_prompt structure', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ operationId: 'op-text' }),
    });

    await generateMarbleWorld({
      displayName: 'Text World',
      prompt: 'A magical forest',
      quality: 'mini',
    });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.world_prompt.type).toBe('text');
    expect(body.world_prompt.text_prompt).toBe('A magical forest');
    expect(body.world_prompt.image_url).toBeUndefined();
  });

  it('throws on HTTP error responses', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 429,
      statusText: 'Too Many Requests',
      text: vi.fn().mockResolvedValue('rate limited'),
    });

    await expect(
      generateMarbleWorld({ displayName: 'Test World', prompt: 'test', quality: 'mini' }),
    ).rejects.toThrow('MARBLE_RATE_LIMITED');
  });

  it('throws when API key is missing', async () => {
    marbleConfig.getApiKey = () => '';

    await expect(
      generateMarbleWorld({ displayName: 'Test World', prompt: 'test', quality: 'mini' }),
    ).rejects.toThrow('MARBLE_API_KEY_MISSING');
  });

  it('uses mini model by default', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ operationId: 'op-mini' }),
    });

    await generateMarbleWorld({ displayName: 'Test World', prompt: 'test', quality: 'mini' });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.model).toBe('mini');
  });
});

describe('pollMarbleOperation', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock.mockReset();
    marbleConfig.getApiKey = () => 'test-key-123';
    marbleConfig.getApiUrl = () => 'https://api.worldlabs.ai/marble/v1';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('polls until done=true and returns worldViewerUrl', async () => {
    // First poll: not done. Second poll: done.
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({ done: false }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          done: true,
          response: {
            world_id: 'marble-w1',
            assets: [{ type: 'web_viewer', url: 'https://marble.worldlabs.ai/world/marble-w1' }],
          },
        }),
      });

    const promise = pollMarbleOperation('op-123');

    // Advance past the first poll interval
    await vi.advanceTimersByTimeAsync(5_000);

    const result = await promise;
    expect(result.done).toBe(true);
    expect(result.worldViewerUrl).toBe('https://marble.worldlabs.ai/world/marble-w1');
    expect(result.worldId).toBe('marble-w1');
  });

  it('extracts viewer URL from assets array', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        done: true,
        response: {
          world_id: 'marble-w2',
          assets: [
            { type: 'thumbnail', url: 'https://example.com/thumb.jpg' },
            { type: 'viewer', url: 'https://marble.worldlabs.ai/world/marble-w2' },
          ],
        },
      }),
    });

    const result = await pollMarbleOperation('op-456');

    expect(result.worldViewerUrl).toBe('https://marble.worldlabs.ai/world/marble-w2');
  });

  it('constructs viewer URL from worldId when no asset match', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        done: true,
        response: {
          world_id: 'marble-w3',
          assets: [],
        },
      }),
    });

    const result = await pollMarbleOperation('op-789');

    expect(result.worldViewerUrl).toBe('https://marble.worldlabs.ai/world/marble-w3');
  });

  it('returns error when operation has error', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        done: true,
        response: { world_id: '' },
        error: { message: 'Content filter blocked' },
      }),
    });

    const result = await pollMarbleOperation('op-err');

    expect(result.done).toBe(true);
    expect(result.error).toBe('Content filter blocked');
  });

  it('throws MARBLE_POLL_ABORTED when signal is aborted', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ done: false }),
    });

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
    fetchMock.mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ done: false }),
    });

    // Catch the rejection immediately to avoid unhandled rejection warnings
    const promise = pollMarbleOperation('op-timeout').catch((e: Error) => e);

    // Advance past 10 minutes worth of polling
    await vi.advanceTimersByTimeAsync(10 * 60 * 1_000 + 5_000);

    const error = await promise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('MARBLE_POLL_TIMEOUT');
  });

  it('retries on network error up to 3 times then throws', async () => {
    fetchMock
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
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('recovers after network error when next poll succeeds', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue({
          done: true,
          response: {
            world_id: 'marble-w4',
            assets: [{ type: 'web_viewer', url: 'https://marble.worldlabs.ai/world/marble-w4' }],
          },
        }),
      });

    const promise = pollMarbleOperation('op-recover');

    // Advance past retry delay
    await vi.advanceTimersByTimeAsync(5_000);

    const result = await promise;
    expect(result.done).toBe(true);
    expect(result.worldViewerUrl).toBe('https://marble.worldlabs.ai/world/marble-w4');
  });
});
