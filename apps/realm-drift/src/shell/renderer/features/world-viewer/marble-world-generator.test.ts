import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MarbleWorldGenerator } from './marble-world-generator.js';
import * as marbleApiModule from './marble-api.js';

vi.mock('./marble-api.js', () => ({
  generateMarbleWorld: vi.fn(),
  pollMarbleOperation: vi.fn(),
  marbleConfig: {
    getApiKey: () => 'test-key',
    getApiUrl: () => 'https://api.worldlabs.ai/marble/v1',
  },
}));

const { generateMarbleWorld, pollMarbleOperation } = marbleApiModule as unknown as {
  generateMarbleWorld: ReturnType<typeof vi.fn>;
  pollMarbleOperation: ReturnType<typeof vi.fn>;
};

describe('MarbleWorldGenerator', () => {
  let generator: MarbleWorldGenerator;

  beforeEach(() => {
    generator = new MarbleWorldGenerator();
    vi.clearAllMocks();
  });

  it('implements WorldGenerator interface', () => {
    expect(typeof generator.generate).toBe('function');
    expect(typeof generator.poll).toBe('function');
    expect(typeof generator.getViewerUrl).toBe('function');
    expect(generator.providerName).toBe('World Labs Marble');
  });

  it('generate delegates to generateMarbleWorld with textPrompt', async () => {
    generateMarbleWorld.mockResolvedValue('op-123');

    const result = await generator.generate({
      displayName: 'Test World',
      textPrompt: 'A castle',
      quality: 'draft',
    });

    expect(result).toEqual({ operationId: 'op-123' });
    expect(generateMarbleWorld).toHaveBeenCalledWith(
      { displayName: 'Test World', prompt: 'A castle', quality: 'mini', imageUrl: undefined },
      undefined,
    );
  });

  it('generate passes image URL and signal', async () => {
    generateMarbleWorld.mockResolvedValue('op-456');
    const ac = new AbortController();

    await generator.generate(
      {
        displayName: 'Forest World',
        textPrompt: 'A forest',
        imageUrl: 'https://example.com/img.jpg',
        quality: 'standard',
      },
      ac.signal,
    );

    expect(generateMarbleWorld).toHaveBeenCalledWith(
      { displayName: 'Forest World', prompt: 'A forest', quality: 'standard', imageUrl: 'https://example.com/img.jpg' },
      ac.signal,
    );
  });

  it('poll yields pending then completed result with viewer URL', async () => {
    pollMarbleOperation.mockResolvedValue({
      done: true,
      worldId: 'marble-w1',
      worldViewerUrl: 'https://marble.worldlabs.ai/world/marble-w1',
    });

    const ac = new AbortController();
    const results = [];
    for await (const update of generator.poll('op-123', ac.signal)) {
      results.push(update);
    }

    expect(results.length).toBe(2);
    expect(results[0]).toEqual({ status: 'pending' });
    expect(results[1]).toEqual({
      status: 'completed',
      viewerUrl: 'https://marble.worldlabs.ai/world/marble-w1',
      thumbnailUrl: null,
      worldId: 'marble-w1',
      error: null,
    });
  });

  it('poll yields failed result on error', async () => {
    pollMarbleOperation.mockResolvedValue({
      done: true,
      error: 'Content filter blocked',
    });

    const ac = new AbortController();
    const results = [];
    for await (const update of generator.poll('op-fail', ac.signal)) {
      results.push(update);
    }

    expect(results.length).toBe(2);
    expect(results[0]).toEqual({ status: 'pending' });
    expect(results[1]).toEqual({
      status: 'failed',
      viewerUrl: null,
      thumbnailUrl: null,
      worldId: null,
      error: 'Content filter blocked',
    });
  });

  it('poll yields failed when no viewer URL', async () => {
    pollMarbleOperation.mockResolvedValue({
      done: true,
      worldViewerUrl: '',
    });

    const ac = new AbortController();
    const results = [];
    for await (const update of generator.poll('op-no-url', ac.signal)) {
      results.push(update);
    }

    expect(results[1]).toEqual({
      status: 'failed',
      viewerUrl: null,
      thumbnailUrl: null,
      worldId: null,
      error: 'MARBLE_NO_VIEWER_URL',
    });
  });

  it('getViewerUrl returns null for unknown operations', () => {
    expect(generator.getViewerUrl('unknown-op')).toBeNull();
  });

  it('getViewerUrl returns URL after successful poll', async () => {
    pollMarbleOperation.mockResolvedValue({
      done: true,
      worldId: 'marble-w2',
      worldViewerUrl: 'https://marble.worldlabs.ai/world/marble-w2',
    });

    const ac = new AbortController();
    for await (const _ of generator.poll('op-200', ac.signal)) {
      // consume
    }

    expect(generator.getViewerUrl('op-200')).toBe('https://marble.worldlabs.ai/world/marble-w2');
  });
});
