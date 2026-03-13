export type WorldGeneratorInput = {
  displayName: string;
  textPrompt: string;
  imageUrl?: string;
  quality: 'draft' | 'standard';
};

export type WorldGeneratorResult = {
  status: 'completed' | 'failed';
  viewerUrl: string | null;
  thumbnailUrl: string | null;
  worldId: string | null;
  error: string | null;
};

export interface WorldGenerator {
  generate(input: WorldGeneratorInput, signal?: AbortSignal): Promise<{ operationId: string }>;
  poll(operationId: string, signal: AbortSignal): AsyncGenerator<
    { status: 'pending' } | WorldGeneratorResult
  >;
  getViewerUrl(operationId: string): string | null;
  readonly providerName: string;
}
