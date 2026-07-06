import type {
  AgentVoiceStreamEvent,
  InterruptAgentVoicePlaybackRequest,
  InterruptAgentVoicePlaybackResponse,
  ReadArtifactBytesRequest,
  ReadArtifactBytesResponse,
  RuntimeTypedCallOptions,
  SubscribeAgentVoiceStreamRequest,
} from '../core-generated/runtime-typed-client';
import { createNimiError, ReasonCode } from '../types';
import {
  projectRuntimeLocalAgentIdentity,
  type RuntimeLocalAgentIdentityInput,
} from './agent-local-identity';
import {
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';

export interface NimiRuntimeAgentVoiceRuntime {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly appAuth: NimiRuntimeAgentAppAuthClient;
  readonly agents: {
    subscribeAgentVoiceStream(
      request: SubscribeAgentVoiceStreamRequest,
      options?: RuntimeTypedCallOptions,
    ): AsyncIterable<AgentVoiceStreamEvent>;
    interruptAgentVoicePlayback(
      request: InterruptAgentVoicePlaybackRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<InterruptAgentVoicePlaybackResponse>;
  };
  readonly artifacts: {
    readArtifactBytes(
      request: ReadArtifactBytesRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<ReadArtifactBytesResponse>;
  };
}

export interface NimiRuntimeAgentVoiceModuleOptions {
  readonly runtime: NimiRuntimeAgentVoiceRuntime;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

export interface NimiRuntimeAgentVoiceStreamRequest extends RuntimeLocalAgentIdentityInput {
  readonly voiceStreamId: string;
  readonly conversationAnchorId: string;
  readonly turnId: string;
}

export interface NimiRuntimeAgentVoiceReplayRequest {
  readonly artifactId: string;
}

export interface NimiRuntimeAgentVoiceInterruptRequest extends RuntimeLocalAgentIdentityInput {
  readonly voiceStreamId: string;
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly reason?: string;
}

export interface NimiRuntimeAgentVoiceModule {
  subscribeStream(
    request: NimiRuntimeAgentVoiceStreamRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<AsyncIterable<AgentVoiceStreamEvent>>;
  replayFinalArtifact(
    request: NimiRuntimeAgentVoiceReplayRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ReadArtifactBytesResponse>;
  interruptPlayback(
    request: NimiRuntimeAgentVoiceInterruptRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<InterruptAgentVoicePlaybackResponse>;
}

export function createNimiRuntimeAgentVoiceModule(
  options: NimiRuntimeAgentVoiceModuleOptions,
): NimiRuntimeAgentVoiceModule {
  const runtime = options.runtime;
  return {
    async subscribeStream(request, callOptions) {
      const identity = projectRuntimeLocalAgentIdentity(request);
      const subjectUserId = normalizeNimiRuntimeAgentText(await options.getSubjectUserId()) || identity.ownerUserId;
      const voiceStreamId = requireRuntimeAgentVoiceText(
        request.voiceStreamId,
        'runtime agent voice stream subscription requires voiceStreamId',
        'provide_runtime_voice_stream_id',
      );
      const conversationAnchorId = requireRuntimeAgentVoiceText(
        request.conversationAnchorId,
        'runtime agent voice stream subscription requires conversationAnchorId',
        'provide_runtime_agent_anchor_id',
      );
      const turnId = requireRuntimeAgentVoiceText(
        request.turnId,
        'runtime agent voice stream subscription requires turnId',
        'provide_runtime_agent_turn_id',
      );
      return withNimiRuntimeAgentScopes(
        {
          runtime,
          subjectUserId,
          withScopes: options.withScopes,
        },
        ['runtime.agent.turn.read'],
        async (scopedOptions) => runtime.agents.subscribeAgentVoiceStream({
          context: {
            appId: runtime.appId,
            subjectUserId,
            ownerUserId: identity.ownerUserId,
            runtimeSourceRef: identity.runtimeSourceRef,
            localAgentRef: identity.localAgentRef,
          },
          voiceStreamId,
          conversationAnchorId,
          turnId,
        }, mergeRuntimeAgentVoiceCallOptions(callOptions, scopedOptions)),
      );
    },
    async replayFinalArtifact(request, callOptions) {
      const artifactId = requireRuntimeAgentVoiceText(
        request.artifactId,
        'runtime agent voice replay requires final artifact id',
        'provide_runtime_voice_final_artifact_id',
      );
      const response = await runtime.artifacts.readArtifactBytes({ artifactId }, callOptions);
      if (!response.mimeType.startsWith('audio/')) {
        runtimeAgentVoiceError(
          `Runtime voice replay artifact must be audio/*, got ${response.mimeType || '<missing>'}`,
          'validate_runtime_voice_final_artifact_mime',
        );
      }
      return response;
    },
    async interruptPlayback(request, callOptions) {
      const identity = projectRuntimeLocalAgentIdentity(request);
      const subjectUserId = normalizeNimiRuntimeAgentText(await options.getSubjectUserId()) || identity.ownerUserId;
      const voiceStreamId = requireRuntimeAgentVoiceText(
        request.voiceStreamId,
        'runtime agent voice playback interrupt requires voiceStreamId',
        'provide_runtime_voice_stream_id',
      );
      const conversationAnchorId = requireRuntimeAgentVoiceText(
        request.conversationAnchorId,
        'runtime agent voice playback interrupt requires conversationAnchorId',
        'provide_runtime_agent_anchor_id',
      );
      const turnId = requireRuntimeAgentVoiceText(
        request.turnId,
        'runtime agent voice playback interrupt requires turnId',
        'provide_runtime_agent_turn_id',
      );
      return withNimiRuntimeAgentScopes(
        {
          runtime,
          subjectUserId,
          withScopes: options.withScopes,
        },
        ['runtime.agent.turn.write'],
        async (scopedOptions) => runtime.agents.interruptAgentVoicePlayback({
          context: {
            appId: runtime.appId,
            subjectUserId,
            ownerUserId: identity.ownerUserId,
            runtimeSourceRef: identity.runtimeSourceRef,
            localAgentRef: identity.localAgentRef,
          },
          voiceStreamId,
          conversationAnchorId,
          turnId,
          reason: normalizeNimiRuntimeAgentText(request.reason),
        }, mergeRuntimeAgentVoiceCallOptions(callOptions, scopedOptions)),
      );
    },
  };
}

function mergeRuntimeAgentVoiceCallOptions(
  base: RuntimeTypedCallOptions | undefined,
  scoped: RuntimeTypedCallOptions,
): RuntimeTypedCallOptions {
  return {
    ...base,
    ...scoped,
    metadata: {
      ...(base?.metadata ?? {}),
      ...(scoped.metadata ?? {}),
    },
  };
}

function requireRuntimeAgentVoiceText(value: unknown, message: string, actionHint: string): string {
  const normalized = normalizeNimiRuntimeAgentText(value);
  if (!normalized) {
    runtimeAgentVoiceError(message, actionHint);
  }
  return normalized;
}

function runtimeAgentVoiceError(message: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode: ReasonCode.AI_INPUT_INVALID,
    actionHint,
    source: 'sdk',
  });
}
