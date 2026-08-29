import {
  CLOUD_ONLY_STUDIO_PARAMETER,
  LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  defineStudioParameters,
} from '../../ai-studio-core/parameters.js';

export type StudioTextCandidateParameters = {
  temperature?: number;
  topP?: number;
  maxTokens?: number;
};

export type StudioTextTurnParameters = StudioTextCandidateParameters & {
  topK?: number;
  presencePenalty?: number;
  frequencyPenalty?: number;
  stop?: string[];
  seed?: number;
};

export type StudioEmbeddingParameters = {
  inputs?: string[];
};

const TEXT_CANDIDATE_ROUTE_MATRIX = {
  temperature: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  topP: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  maxTokens: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
} as const;

const TEXT_TURN_ROUTE_MATRIX = {
  ...TEXT_CANDIDATE_ROUTE_MATRIX,
  topK: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  presencePenalty: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  frequencyPenalty: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  stop: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
  seed: LOCAL_AND_CLOUD_STUDIO_PARAMETER,
} as const;

const studioTextGenerateParameterContract = defineStudioParameters<StudioTextCandidateParameters>({
  initial: () => ({}),
  routeMatrix: TEXT_CANDIDATE_ROUTE_MATRIX,
});

export const studioTextGenerateParameters = Object.freeze({
  ...studioTextGenerateParameterContract,
  project: (source: Parameters<typeof studioTextGenerateParameterContract.project>[0], parameters: Parameters<typeof studioTextGenerateParameterContract.project>[1]) => (
    studioTextGenerateParameterContract.project(
      source,
      Object.fromEntries(
        Object.entries(parameters).filter(([field]) => Object.hasOwn(TEXT_CANDIDATE_ROUTE_MATRIX, field)),
      ),
    )
  ),
});

export const studioChatStreamParameters = defineStudioParameters<StudioTextTurnParameters>({
  initial: () => ({}),
  routeMatrix: TEXT_TURN_ROUTE_MATRIX,
});

export const studioTextEmbedParameters = defineStudioParameters<StudioEmbeddingParameters>({
  initial: () => ({}),
  routeMatrix: { inputs: CLOUD_ONLY_STUDIO_PARAMETER },
  hasAlternativeInput: (parameters) => nonEmptyEmbeddingInputs(parameters).length > 0,
});

export function nonEmptyEmbeddingInputs(parameters: StudioEmbeddingParameters | undefined): string[] {
  return (parameters?.inputs ?? []).map((value) => value.trim()).filter(Boolean);
}
