import type {
  EmbeddingModelV3,
  ImageModelV3,
  LanguageModelV3,
} from '@ai-sdk/provider';
import {
  type NimiRuntimeSpeechModel,
  type NimiRuntimeTranscriptionModel,
  type NimiRuntimeVideoModel,
  type RuntimeDefaults,
  type RuntimeForAiProvider,
} from './types.js';
import {
  createEmbeddingModelImpl,
} from './model-factory-embedding.js';
import {
  createImageModelImpl,
} from './model-factory-image.js';
import {
  createLanguageModelImpl,
} from './model-factory-language.js';
import {
  createSpeechModelImpl,
} from './model-factory-speech.js';
import {
  createTranscriptionModelImpl,
} from './model-factory-transcription.js';
import {
  createVideoModelImpl,
} from './model-factory-video.js';

const modelFactoryCreators = {
  embedding: createEmbeddingModelImpl,
  image: createImageModelImpl,
  language: createLanguageModelImpl,
  speech: createSpeechModelImpl,
  transcription: createTranscriptionModelImpl,
  video: createVideoModelImpl,
} as const;

export function createLanguageModel(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  modelId: string,
): LanguageModelV3 {
  return modelFactoryCreators.language(runtime, defaults, modelId);
}

export function createEmbeddingModel(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  modelId: string,
): EmbeddingModelV3 {
  return modelFactoryCreators.embedding(runtime, defaults, modelId);
}

export function createImageModel(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  modelId: string,
): ImageModelV3 {
  return modelFactoryCreators.image(runtime, defaults, modelId);
}

export function createVideoModel(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  modelId: string,
): NimiRuntimeVideoModel {
  return modelFactoryCreators.video(runtime, defaults, modelId);
}

export function createSpeechModel(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  modelId: string,
): NimiRuntimeSpeechModel {
  return modelFactoryCreators.speech(runtime, defaults, modelId);
}

export function createTranscriptionModel(
  runtime: RuntimeForAiProvider,
  defaults: RuntimeDefaults,
  modelId: string,
): NimiRuntimeTranscriptionModel {
  return modelFactoryCreators.transcription(runtime, defaults, modelId);
}
