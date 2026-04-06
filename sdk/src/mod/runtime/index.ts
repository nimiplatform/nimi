import { createNimiError } from '../../runtime/errors.js';
import { ReasonCode } from '../../types/index.js';
import {
  resolveModRuntimeContext,
} from '../internal/runtime-access.js';
import type { ModRuntimeContextInput } from '../types/runtime-mod.js';
import type { ModRuntimeClient } from './types.js';
export { createModRuntimeInspector } from './inspector.js';
export {
  buildLocalProfileExtensions,
  type ProfileEntryOverride,
  type LocalProfileExtensionInput,
} from '../../runtime/runtime-media.js';

function normalizeModId(modId: string): string {
  const normalized = String(modId || '').trim();
  if (!normalized) {
    throw createNimiError({
      message: 'mod runtime client mod id is required',
      reasonCode: ReasonCode.ACTION_INPUT_INVALID,
      actionHint: 'provide_non_empty_mod_id',
      source: 'sdk',
    });
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
      describe: async (input) => runtimeHost.route.describe({
        modId: normalizedModId,
        capability: input.capability,
        resolvedBindingRef: input.resolvedBindingRef,
      }),
    },
    local: {
      listAssets: async (input) => runtimeHost.local.listAssets({
        modId: normalizedModId,
        ...input,
      }),
      listProfiles: async () => runtimeHost.local.listProfiles({
        modId: normalizedModId,
      }),
      requestProfileInstall: async (input) => runtimeHost.local.requestProfileInstall({
        modId: normalizedModId,
        ...input,
      }),
      getProfileInstallStatus: async (input) => runtimeHost.local.getProfileInstallStatus({
        modId: normalizedModId,
        ...input,
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
        submit: async (input) => runtimeHost.media.jobs.submit({
          modId: normalizedModId,
          ...input,
        }),
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
