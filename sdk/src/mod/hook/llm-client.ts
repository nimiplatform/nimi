import type { HookLlmClient } from '../types';
import type { RuntimeHookRuntimeFacade } from '../types/runtime-hook/runtime-facade';
import {
  checkResolvedRouteHealth,
  resolveModRouteBinding,
} from '../internal/runtime-access';
import type { ModRuntimeHost } from '../types/runtime-mod';

export function createLlmClient(input: {
  modId: string;
  runtimeHost: ModRuntimeHost;
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
        credentialRefId,
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
        credentialRefId,
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
        credentialRefId,
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
          credentialRefId,
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
        credentialRefId,
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
        credentialRefId,
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
        credentialRefId,
      }) => input.runtime.generateModVideo({
        modId: input.modId,
        provider,
        prompt,
        model,
        durationSeconds,
        localProviderEndpoint,
        localProviderModel,
        localOpenAiEndpoint,
        credentialRefId,
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
        credentialRefId,
      }) => input.runtime.generateModEmbedding({
        modId: input.modId,
        provider,
        input: embeddingInput,
        model,
        localProviderEndpoint,
        localProviderModel,
        localOpenAiEndpoint,
        credentialRefId,
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
        credentialRefId,
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
          credentialRefId,
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
      }, {
        runtimeHost: input.runtimeHost,
        runtime: input.runtime,
      });
      return checkResolvedRouteHealth(resolved, {
        runtimeHost: input.runtimeHost,
        runtime: input.runtime,
      });
    },
  };
}
