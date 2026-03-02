import type {
  EmbeddingModelV3,
  ImageModelV3,
  LanguageModelV3,
} from '@ai-sdk/provider';
import { ensureRuntime, ensureText } from './helpers.js';
import {
  createEmbeddingModel,
  createImageModel,
  createLanguageModel,
  createSpeechModel,
  createTranscriptionModel,
  createVideoModel,
} from './model-factories.js';
import type {
  NimiAiProvider,
  NimiAiProviderConfig,
  NimiRuntimeSpeechModel,
  NimiRuntimeTranscriptionModel,
  NimiRuntimeVideoModel,
} from './types.js';

export type {
  NimiAiProvider,
  NimiAiProviderConfig,
  NimiArtifact,
  NimiArtifactGenerationResult,
  NimiRuntimeSpeechModel,
  NimiRuntimeTranscriptionModel,
  NimiRuntimeVideoModel,
} from './types.js';

export function createNimiAiProvider(config: NimiAiProviderConfig): NimiAiProvider {
  const { runtime, defaults } = ensureRuntime(config);

  const provider = ((modelId: string): LanguageModelV3 => createLanguageModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  )) as NimiAiProvider;

  provider.text = (modelId: string): LanguageModelV3 => createLanguageModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  );
  provider.embedding = (modelId: string): EmbeddingModelV3 => createEmbeddingModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  );
  provider.image = (modelId: string): ImageModelV3 => createImageModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  );
  provider.video = (modelId: string): NimiRuntimeVideoModel => createVideoModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  );
  provider.tts = (modelId: string): NimiRuntimeSpeechModel => createSpeechModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  );
  provider.stt = (modelId: string): NimiRuntimeTranscriptionModel => createTranscriptionModel(
    runtime,
    defaults,
    ensureText(modelId, 'modelId'),
  );

  return provider;
}
