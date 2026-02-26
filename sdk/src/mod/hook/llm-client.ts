import type { HookLlmClient } from '../types';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-hook/runtime-facade';
import type { RuntimeLlmHealthInput, RuntimeLlmHealthResult } from '../types/llm';
import {
  checkResolvedRouteHealth,
  resolveModRouteBinding,
} from '../internal/runtime-access';

export function createLlmClient(input: {
  modId: string;
  runtimeHost: { checkLocalLlmHealth: (payload: RuntimeLlmHealthInput) => Promise<RuntimeLlmHealthResult> };
  runtime: RuntimeHookRuntimeFacade;
}): HookLlmClient {
  return {
    text: {
      generate: async ({
        provider,
        prompt,
        systemPrompt,
        maxTokens,
        temperature,
        mode,
        worldId,
        agentId,
        abortSignal,
        localProviderEndpoint,
        localProviderModel,
        localOpenAiEndpoint,
        localOpenAiApiKey,
      }) => input.runtime.generateModText({
        modId: input.modId,
        provider,
        prompt,
        systemPrompt,
        maxTokens,
        temperature,
        mode,
        worldId,
        agentId,
        abortSignal,
        localProviderEndpoint,
        localProviderModel,
        localOpenAiEndpoint,
        localOpenAiApiKey,
      }),
      stream: async function* ({
        provider,
        prompt,
        systemPrompt,
        maxTokens,
        temperature,
        mode,
        worldId,
        agentId,
        abortSignal,
        localProviderEndpoint,
        localProviderModel,
        localOpenAiEndpoint,
        localOpenAiApiKey,
      }) {
        for await (const event of input.runtime.streamModText({
          modId: input.modId,
          provider,
          prompt,
          systemPrompt,
          maxTokens,
          temperature,
          mode,
          worldId,
          agentId,
          abortSignal,
          localProviderEndpoint,
          localProviderModel,
          localOpenAiEndpoint,
          localOpenAiApiKey,
        })) {
          yield event;
        }
      },
    },
    image: {
      generate: async ({
        provider,
        prompt,
        model,
        size,
        n,
        localProviderEndpoint,
        localProviderModel,
        localOpenAiEndpoint,
        localOpenAiApiKey,
      }) => input.runtime.generateModImage({
        modId: input.modId,
        provider,
        prompt,
        model,
        size,
        n,
        localProviderEndpoint,
        localProviderModel,
        localOpenAiEndpoint,
        localOpenAiApiKey,
      }),
    },
    video: {
      generate: async ({
        provider,
        prompt,
        model,
        durationSeconds,
        localProviderEndpoint,
        localProviderModel,
        localOpenAiEndpoint,
        localOpenAiApiKey,
      }) => input.runtime.generateModVideo({
        modId: input.modId,
        provider,
        prompt,
        model,
        durationSeconds,
        localProviderEndpoint,
        localProviderModel,
        localOpenAiEndpoint,
        localOpenAiApiKey,
      }),
    },
    embedding: {
      generate: async ({
        provider,
        input: embeddingInput,
        model,
        localProviderEndpoint,
        localProviderModel,
        localOpenAiEndpoint,
        localOpenAiApiKey,
      }) => input.runtime.generateModEmbedding({
        modId: input.modId,
        provider,
        input: embeddingInput,
        model,
        localProviderEndpoint,
        localProviderModel,
        localOpenAiEndpoint,
        localOpenAiApiKey,
      }),
    },
    checkHealth: async (payload) => input.runtimeHost.checkLocalLlmHealth(payload),
    speech: {
      listProviders: async () => input.runtime.listSpeechProviders({
        modId: input.modId,
      }),
      listVoices: async ({ providerId, routeSource, connectorId } = {}) => input.runtime.listSpeechVoices({
        modId: input.modId,
        providerId,
        routeSource,
        connectorId,
      }),
      synthesize: async ({
        text,
        providerId,
        routeSource,
        connectorId,
        model,
        voiceId,
        format,
        speakingRate,
        pitch,
        sampleRateHz,
        language,
        stylePrompt,
        targetId,
        sessionId,
      }) => {
        return input.runtime.synthesizeModSpeech({
          modId: input.modId,
          text,
          providerId,
          routeSource,
          connectorId,
          model,
          voiceId,
          format,
          speakingRate,
          pitch,
          sampleRateHz,
          language,
          stylePrompt,
          targetId,
          sessionId,
        });
      },
      transcribe: async ({
        provider,
        audioUri,
        audioBase64,
        mimeType,
        language,
        localProviderEndpoint,
        localProviderModel,
        localOpenAiEndpoint,
        localOpenAiApiKey,
      }) => {
        return input.runtime.transcribeModSpeech({
          modId: input.modId,
          provider,
          audioUri,
          audioBase64,
          mimeType,
          language,
          localProviderEndpoint,
          localProviderModel,
          localOpenAiEndpoint,
          localOpenAiApiKey,
        });
      },
      stream: {
        open: async ({
          text,
          providerId,
          routeSource,
          connectorId,
          model,
          voiceId,
          format,
          sampleRateHz,
          language,
          stylePrompt,
          targetId,
          sessionId,
        }) => {
          return input.runtime.openSpeechStream({
            modId: input.modId,
            text,
            providerId,
            routeSource,
            connectorId,
            model,
            voiceId,
            format,
            sampleRateHz,
            language,
            stylePrompt,
            targetId,
            sessionId,
          });
        },
        control: async ({ streamId, action }) => input.runtime.controlSpeechStream({
          modId: input.modId,
          streamId,
          action,
        }),
        close: async ({ streamId }) => input.runtime.closeSpeechStream({
          modId: input.modId,
          streamId,
        }),
      },
    },
    checkRouteHealth: async ({ routeHint, routeOverride }) => {
      const resolved = await resolveModRouteBinding({
        routeHint,
        modId: input.modId,
        routeOverride,
      });
      return checkResolvedRouteHealth(resolved);
    },
  };
}
