import {
  CLOUD_ONLY_STUDIO_PARAMETER,
  LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  defineStudioParameters,
} from '../../ai-studio-core/parameters.js';

export type StudioTextGenerationParameters = {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string[];
  seed?: number;
};

export type StudioEmbeddingParameters = {
  inputs?: string[];
};

const TEXT_ROUTE_MATRIX = {
  temperature: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  topP: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  maxTokens: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  topK: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  presencePenalty: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  frequencyPenalty: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  stop: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  seed: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
} as const;

export const studioTextGenerateParameters = defineStudioParameters<StudioTextGenerationParameters>({
  initial: () => ({}),
  routeMatrix: TEXT_ROUTE_MATRIX,
});

export const studioChatStreamParameters = defineStudioParameters<StudioTextGenerationParameters>({
  initial: () => ({}),
  routeMatrix: TEXT_ROUTE_MATRIX,
});

export const studioTextEmbedParameters = defineStudioParameters<StudioEmbeddingParameters>({
  initial: () => ({}),
  routeMatrix: { inputs: CLOUD_ONLY_STUDIO_PARAMETER },
  hasAlternativeInput: (parameters) => nonEmptyEmbeddingInputs(parameters).length > 0,
});

export function nonEmptyEmbeddingInputs(parameters: StudioEmbeddingParameters | undefined): string[] {
  return (parameters?.inputs ?? []).map((value) => value.trim()).filter(Boolean);
}
