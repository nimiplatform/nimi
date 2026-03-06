import {
  resolveModRuntimeContext,
} from '../internal/runtime-access.js';
import type { ModRuntimeContextInput } from '../types/runtime-mod.js';
import type { ModRuntimeClient } from './types.js';
export { createModRuntimeInspector } from './inspector.js';

function normalizeModId(modId: string): string {
  const normalized = String(modId || '').trim();
  if (!normalized) {
    throw new Error('MOD_RUNTIME_CLIENT_MOD_ID_REQUIRED');
  }
  return normalized;
}

export function createModRuntimeClient(modId: string, context?: ModRuntimeContextInput): ModRuntimeClient {
  const normalizedModId = normalizeModId(modId);
  const runtimeContext = resolveModRuntimeContext(context);
  const runtimeHost = runtimeContext.runtimeHost;

  return {
    route: {
      listOptions: async (input) => runtimeHost.route.listOptions({
        modId: normalizedModId,
        capability: input.capability,
      }),
      resolve: async (input) => runtimeHost.route.resolve({
        modId: normalizedModId,
        capability: input.capability,
        binding: input.binding,
      }),
      checkHealth: async (input) => runtimeHost.route.checkHealth({
        modId: normalizedModId,
        capability: input.capability,
        binding: input.binding,
      }),
    },
    ai: {
      text: {
        generate: async (input) => runtimeHost.ai.text.generate({
          modId: normalizedModId,
          ...input,
        }),
        stream: async (input) => runtimeHost.ai.text.stream({
          modId: normalizedModId,
          ...input,
        }),
      },
      embedding: {
        generate: async (input) => runtimeHost.ai.embedding.generate({
          modId: normalizedModId,
          ...input,
        }),
      },
    },
    media: {
      image: {
        generate: async (input) => runtimeHost.media.image.generate({
          modId: normalizedModId,
          ...input,
        }),
        stream: async (input) => runtimeHost.media.image.stream({
          modId: normalizedModId,
          ...input,
        }),
      },
      video: {
        generate: async (input) => runtimeHost.media.video.generate({
          modId: normalizedModId,
          ...input,
        }),
        stream: async (input) => runtimeHost.media.video.stream({
          modId: normalizedModId,
          ...input,
        }),
      },
      tts: {
        synthesize: async (input) => runtimeHost.media.tts.synthesize({
          modId: normalizedModId,
          ...input,
        }),
        stream: async (input) => runtimeHost.media.tts.stream({
          modId: normalizedModId,
          ...input,
        }),
        listVoices: async (input) => runtimeHost.media.tts.listVoices({
          modId: normalizedModId,
          ...input,
        }),
      },
      stt: {
        transcribe: async (input) => runtimeHost.media.stt.transcribe({
          modId: normalizedModId,
          ...input,
        }),
      },
      jobs: {
        get: async (jobId) => runtimeHost.media.jobs.get({
          modId: normalizedModId,
          jobId,
        }),
        cancel: async (input) => runtimeHost.media.jobs.cancel({
          modId: normalizedModId,
          ...input,
        }),
        subscribe: async (jobId) => runtimeHost.media.jobs.subscribe({
          modId: normalizedModId,
          jobId,
        }),
        getArtifacts: async (jobId) => runtimeHost.media.jobs.getArtifacts({
          modId: normalizedModId,
          jobId,
        }),
      },
    },
    voice: {
      getAsset: async (request) => runtimeHost.voice.getAsset({
        modId: normalizedModId,
        request,
      }),
      listAssets: async (request) => runtimeHost.voice.listAssets({
        modId: normalizedModId,
        request,
      }),
      deleteAsset: async (request) => runtimeHost.voice.deleteAsset({
        modId: normalizedModId,
        request,
      }),
      listPresetVoices: async (input) => runtimeHost.voice.listPresetVoices({
        modId: normalizedModId,
        ...input,
      }),
    },
  };
}

export type * from './types.js';
