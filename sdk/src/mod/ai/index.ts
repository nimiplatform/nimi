import type { RuntimeRouteHint, RuntimeRouteOverride } from '../types';
import {
  checkResolvedRouteHealth,
  resolveModRuntimeContext,
  resolveModRouteBinding,
} from '../internal/runtime-access';
import type { ModRuntimeContextInput } from '../types/runtime-mod';
import { modalityFromRouteHint } from './provider';
import type {
  AiGenerateEmbeddingRequest,
  AiGenerateObjectRequest,
  AiGenerateVideoRequest,
  AiRouteInput,
  AiSynthesizeSpeechRequest,
  AiTextRequest,
  AiTranscribeAudioRequest,
  ModAiClient,
} from './types';

function toRouteInput(input?: {
  routeHint?: RuntimeRouteHint;
  routeOverride?: RuntimeRouteOverride;
}): Required<AiRouteInput> {
  return {
    routeHint: input?.routeHint || 'chat/default',
    routeOverride: input?.routeOverride || {},
  };
}

function parseJsonObject(text: string): Record<string, unknown> {
  const normalized = String(text || '').trim();
  if (!normalized) {
    throw new Error('AI_GENERATE_OBJECT_EMPTY_TEXT');
  }
  const parsed = JSON.parse(normalized);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI_GENERATE_OBJECT_INVALID_JSON_OBJECT');
  }
  return parsed as Record<string, unknown>;
}

function routeRuntimePayload(route: Awaited<ReturnType<typeof resolveModRouteBinding>>) {
  if (route.source === 'local-runtime') {
    return {
      provider: route.provider,
      localProviderEndpoint: route.localProviderEndpoint || route.endpoint,
      localProviderModel: route.localProviderModel || route.model,
      localOpenAiEndpoint: route.localOpenAiEndpoint || route.endpoint,
      connectorId: route.connectorId,
      providerHints: route.providerHints,
    };
  }
  return {
    provider: route.provider,
    localProviderEndpoint: '',
    localProviderModel: route.model,
    localOpenAiEndpoint: '',
    connectorId: route.connectorId,
    providerHints: route.providerHints,
  };
}

export function createAiClient(modId: string, context?: ModRuntimeContextInput): ModAiClient {
  const normalizedModId = String(modId || '').trim();
  if (!normalizedModId) {
    throw new Error('AI_CLIENT_MOD_ID_REQUIRED');
  }
  const runtimeContext = resolveModRuntimeContext(context);
  const runtime = runtimeContext.runtime;

  const client: ModAiClient = {
    resolveRoute: async (input) => {
      const routeInput = toRouteInput(input);
      return resolveModRouteBinding({
        routeHint: routeInput.routeHint,
        modId: normalizedModId,
        routeOverride: routeInput.routeOverride,
      }, runtimeContext);
    },
    checkRouteHealth: async (input) => {
      const routeInput = toRouteInput(input);
      const resolved = await resolveModRouteBinding({
        routeHint: routeInput.routeHint,
        modId: normalizedModId,
        routeOverride: routeInput.routeOverride,
      }, runtimeContext);
      return checkResolvedRouteHealth(resolved, runtimeContext);
    },
    generateText: async (input: AiTextRequest) => {
      const routeInput = toRouteInput(input);
      const route = await resolveModRouteBinding({
        routeHint: routeInput.routeHint,
        modId: normalizedModId,
        routeOverride: routeInput.routeOverride,
      }, runtimeContext);
      const payload = routeRuntimePayload(route);
      const result = await runtime.generateModText({
        modId: normalizedModId,
        prompt: input.prompt,
        systemPrompt: input.systemPrompt,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
        mode: input.mode,
        worldId: input.worldId,
        agentId: input.agentId,
        abortSignal: input.abortSignal,
        ...payload,
      });
      return {
        text: String(result.text || ''),
        promptTraceId: String(result.promptTraceId || ''),
        route,
      };
    },
    streamText: async function* (input: AiTextRequest) {
      const routeInput = toRouteInput(input);
      const route = await resolveModRouteBinding({
        routeHint: routeInput.routeHint,
        modId: normalizedModId,
        routeOverride: routeInput.routeOverride,
      }, runtimeContext);
      const payload = routeRuntimePayload(route);
      let doneEmitted = false;
      for await (const event of runtime.streamModText({
        modId: normalizedModId,
        prompt: input.prompt,
        systemPrompt: input.systemPrompt,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
        mode: input.mode,
        worldId: input.worldId,
        agentId: input.agentId,
        abortSignal: input.abortSignal,
        ...payload,
      })) {
        if (event.type === 'text_delta') {
          const textDelta = String(event.textDelta || '');
          if (!textDelta) continue;
          yield {
            type: 'text_delta',
            textDelta,
            route,
          } as const;
          continue;
        }
        if (event.type === 'done') {
          doneEmitted = true;
          yield {
            type: 'done',
            route,
          } as const;
        }
      }
      if (!doneEmitted) {
        yield {
          type: 'done',
          route,
        } as const;
      }
    },
    generateObject: async (input: AiGenerateObjectRequest) => {
      const routeHint = input.routeHint || 'chat/default';
      const scenario = modalityFromRouteHint(routeHint);
      if (scenario !== 'chat') {
        throw new Error(`AI_GENERATE_OBJECT_ROUTE_INVALID: ${routeHint}`);
      }
      const textResult = await client.generateText(input);
      const parser = input.parse || parseJsonObject;
      const object = parser(textResult.text);
      return {
        object,
        text: textResult.text,
        promptTraceId: textResult.promptTraceId,
        route: textResult.route,
      };
    },
    generateImage: async (input) => {
      const routeInput = toRouteInput({ ...input, routeHint: input.routeHint || 'image/default' });
      const route = await resolveModRouteBinding({
        routeHint: routeInput.routeHint,
        modId: normalizedModId,
        routeOverride: routeInput.routeOverride,
      }, runtimeContext);
      const payload = routeRuntimePayload(route);
      const result = await runtime.generateModImage({
        modId: normalizedModId,
        prompt: input.prompt,
        model: input.model,
        size: input.size,
        n: input.n,
        ...payload,
      });
      return {
        images: result.images,
        route,
      };
    },
    generateVideo: async (input: AiGenerateVideoRequest) => {
      const routeInput = toRouteInput({ ...input, routeHint: input.routeHint || 'video/default' });
      const route = await resolveModRouteBinding({
        routeHint: routeInput.routeHint,
        modId: normalizedModId,
        routeOverride: routeInput.routeOverride,
      }, runtimeContext);
      const payload = routeRuntimePayload(route);
      const result = await runtime.generateModVideo({
        modId: normalizedModId,
        prompt: input.prompt,
        model: input.model,
        durationSeconds: input.durationSeconds,
        ...payload,
      });
      return {
        videos: result.videos,
        route,
      };
    },
    transcribeAudio: async (input: AiTranscribeAudioRequest) => {
      const routeInput = toRouteInput({ ...input, routeHint: input.routeHint || 'stt/default' });
      const route = await resolveModRouteBinding({
        routeHint: routeInput.routeHint,
        modId: normalizedModId,
        routeOverride: routeInput.routeOverride,
      }, runtimeContext);
      const payload = routeRuntimePayload(route);
      const result = await runtime.transcribeModSpeech({
        modId: normalizedModId,
        audioUri: input.audioUri,
        audioBase64: input.audioBase64,
        mimeType: input.mimeType,
        language: input.language,
        ...payload,
      });
      return {
        text: String(result.text || ''),
        route,
      };
    },
    generateEmbedding: async (input: AiGenerateEmbeddingRequest) => {
      const routeInput = toRouteInput({ ...input, routeHint: input.routeHint || 'embedding/default' });
      const route = await resolveModRouteBinding({
        routeHint: routeInput.routeHint,
        modId: normalizedModId,
        routeOverride: routeInput.routeOverride,
      }, runtimeContext);
      const payload = routeRuntimePayload(route);
      const result = await runtime.generateModEmbedding({
        modId: normalizedModId,
        input: input.input,
        model: input.model,
        ...payload,
      });
      return {
        embeddings: result.embeddings,
        route,
      };
    },
    synthesizeSpeech: async (input: AiSynthesizeSpeechRequest) => {
      const routeInput = toRouteInput({ ...input, routeHint: input.routeHint || 'tts/default' });
      const route = await resolveModRouteBinding({
        routeHint: routeInput.routeHint,
        modId: normalizedModId,
        routeOverride: routeInput.routeOverride,
      }, runtimeContext);
      const result = await runtime.synthesizeModSpeech({
        modId: normalizedModId,
        text: input.text,
        providerId: input.providerId,
        routeSource: input.routeSource,
        connectorId: input.connectorId,
        voiceId: input.voiceId,
        format: input.format,
        speakingRate: input.speakingRate,
        pitch: input.pitch,
        sampleRateHz: input.sampleRateHz,
        language: input.language,
        stylePrompt: input.stylePrompt,
        targetId: input.targetId,
        sessionId: input.sessionId,
      });
      return {
        ...result,
        route,
      };
    },
  };

  return client;
}

export { createAiRuntimeInspector } from './runtime';
export type * from './types';
