import type { WorldGenerator, WorldGeneratorInput, WorldGeneratorResult } from './world-generator.js';
import { generateMarbleWorld, pollMarbleOperation } from './marble-api.js';

export class MarbleWorldGenerator implements WorldGenerator {
  readonly providerName = 'World Labs Marble';

  private viewerUrls = new Map<string, string>();

  async generate(input: WorldGeneratorInput): Promise<{ operationId: string }> {
    const marbleQuality = input.quality === 'draft' ? 'mini' : input.quality;
    const operationId = await generateMarbleWorld(
      {
        displayName: input.displayName,
        prompt: input.prompt,
        imageUrl: input.imageUrl,
        quality: marbleQuality as 'mini' | 'standard',
      },
      input.signal,
    );
    return { operationId };
  }

  async poll(operationId: string, signal?: AbortSignal): Promise<WorldGeneratorResult> {
    const result = await pollMarbleOperation(operationId, signal);

    if (result.error) {
      throw new Error(result.error);
    }

    if (!result.worldViewerUrl) {
      throw new Error('MARBLE_NO_VIEWER_URL');
    }

    this.viewerUrls.set(operationId, result.worldViewerUrl);

    return {
      operationId,
      worldViewerUrl: result.worldViewerUrl,
    };
  }

  getViewerUrl(operationId: string): string | null {
    return this.viewerUrls.get(operationId) ?? null;
  }
}
