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

  it('generate delegates to generateMarbleWorld', async () => {
    generateMarbleWorld.mockResolvedValue('op-123');

    const result = await generator.generate({
      worldId: 'w1',
      displayName: 'Test World',
      prompt: 'A castle',
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

    await generator.generate({
      worldId: 'w1',
      displayName: 'Forest World',
      prompt: 'A forest',
      imageUrl: 'https://example.com/img.jpg',
      quality: 'standard',
      signal: ac.signal,
    });

    expect(generateMarbleWorld).toHaveBeenCalledWith(
      { displayName: 'Forest World', prompt: 'A forest', quality: 'standard', imageUrl: 'https://example.com/img.jpg' },
      ac.signal,
    );
  });

  it('poll returns result with viewer URL', async () => {
    pollMarbleOperation.mockResolvedValue({
      done: true,
      worldId: 'marble-w1',
      worldViewerUrl: 'https://marble.worldlabs.ai/viewer/marble-w1',
    });

    const result = await generator.poll('op-123');

    expect(result).toEqual({
      operationId: 'op-123',
      worldViewerUrl: 'https://marble.worldlabs.ai/viewer/marble-w1',
    });
  });

  it('poll throws on error result', async () => {
    pollMarbleOperation.mockResolvedValue({
      done: true,
      error: 'Content filter blocked',
    });

    await expect(generator.poll('op-fail')).rejects.toThrow('Content filter blocked');
  });

  it('poll throws when no viewer URL', async () => {
    pollMarbleOperation.mockResolvedValue({
      done: true,
      worldViewerUrl: '',
    });

    await expect(generator.poll('op-no-url')).rejects.toThrow('MARBLE_NO_VIEWER_URL');
  });

  it('getViewerUrl returns null for unknown operations', () => {
    expect(generator.getViewerUrl('unknown-op')).toBeNull();
  });

  it('getViewerUrl returns URL after successful poll', async () => {
    pollMarbleOperation.mockResolvedValue({
      done: true,
      worldId: 'marble-w2',
      worldViewerUrl: 'https://marble.worldlabs.ai/viewer/marble-w2',
    });

    await generator.poll('op-200');

    expect(generator.getViewerUrl('op-200')).toBe('https://marble.worldlabs.ai/viewer/marble-w2');
  });
});
