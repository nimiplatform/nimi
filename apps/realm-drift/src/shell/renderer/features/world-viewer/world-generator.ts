export type WorldGeneratorInput = {
  worldId: string;
  displayName: string;
  prompt: string;
  imageUrl?: string;
  quality: 'draft' | 'standard';
  signal?: AbortSignal;
};

export type WorldGeneratorResult = {
  operationId: string;
  worldViewerUrl: string;
  thumbnailUrl?: string;
};

export interface WorldGenerator {
  generate(input: WorldGeneratorInput): Promise<{ operationId: string }>;
  poll(operationId: string, signal?: AbortSignal): Promise<WorldGeneratorResult>;
  getViewerUrl(operationId: string): string | null;
  readonly providerName: string;
}
