import type { WorldGenerator, WorldGeneratorInput, WorldGeneratorResult } from './world-generator.js';
import { generateMarbleWorld, pollMarbleOperation } from './marble-api.js';

export class MarbleWorldGenerator implements WorldGenerator {
  readonly providerName = 'World Labs Marble';

  private viewerUrls = new Map<string, string>();

  async generate(input: WorldGeneratorInput, signal?: AbortSignal): Promise<{ operationId: string }> {
    const marbleQuality = input.quality === 'draft' ? 'mini' : input.quality;
    const operationId = await generateMarbleWorld(
      {
        displayName: input.displayName,
        prompt: input.textPrompt,
        imageUrl: input.imageUrl,
        quality: marbleQuality as 'mini' | 'standard',
      },
      signal,
    );
    return { operationId };
  }

  async *poll(operationId: string, signal: AbortSignal): AsyncGenerator<
    { status: 'pending' } | WorldGeneratorResult
  > {
    // Yield pending while polling
    yield { status: 'pending' as const };

    const result = await pollMarbleOperation(operationId, signal);

    if (result.error) {
      yield {
        status: 'failed' as const,
        viewerUrl: null,
        thumbnailUrl: null,
        worldId: null,
        error: result.error,
      };
      return;
    }

    if (!result.worldViewerUrl) {
      yield {
        status: 'failed' as const,
        viewerUrl: null,
        thumbnailUrl: null,
        worldId: null,
        error: 'MARBLE_NO_VIEWER_URL',
      };
      return;
    }

    this.viewerUrls.set(operationId, result.worldViewerUrl);

    yield {
      status: 'completed' as const,
      viewerUrl: result.worldViewerUrl,
      thumbnailUrl: null,
      worldId: result.worldId ?? null,
      error: null,
    };
  }

  getViewerUrl(operationId: string): string | null {
    return this.viewerUrls.get(operationId) ?? null;
  }
}
