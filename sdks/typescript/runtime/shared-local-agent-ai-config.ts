import type { AgentRequestContext } from '../core-generated/runtime-protobuf/runtime/v1/agent_common';
import type {
  AIConfig,
  AIConfigCapabilityIntent,
} from '../core-generated/runtime-protobuf/runtime/v1/capability_configuration';
import type {
  ApplySharedLocalAgentAIProfileRequest,
  ApplySharedLocalAgentAIProfileResponse,
  GetSharedLocalAgentAIConfigRequest,
  GetSharedLocalAgentAIConfigResponse,
  PreviewSharedLocalAgentAIProfileRequest,
  PreviewSharedLocalAgentAIProfileResponse,
  OverwriteSharedLocalAgentAIConfigRequest,
  OverwriteSharedLocalAgentAIConfigResponse,
} from '../core-generated/runtime-protobuf/runtime/v1/agent_service';
import type { RuntimeTypedCallOptions } from '../core-generated/runtime-typed-client';
import {
  parseNimiPortableAIProfile,
  serializeNimiPortableAIProfile,
  type NimiPortableAIProfile,
  type NimiPortableAIProfileInput,
} from '../core/ai/config-profile';
import { createNimiClientId, createNimiError } from '../types';
import { withNimiRuntimeIdempotencyMetadata } from './scenario-jobs';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';

const SHARED_LOCAL_AGENT_AI_CONFIG_READ_SCOPE = 'runtime.agent.ai_config.read';
const SHARED_LOCAL_AGENT_AI_CONFIG_WRITE_SCOPE = 'runtime.agent.ai_config.write';

export interface NimiSharedLocalAgentAIConfigCallInput {
  readonly subjectUserId?: string;
}

export interface NimiSharedLocalAgentAIConfigOverwriteInput
  extends NimiSharedLocalAgentAIConfigCallInput {
  readonly capabilities: readonly AIConfigCapabilityIntent[];
}

export interface NimiSharedLocalAgentAIProfileInput
  extends NimiSharedLocalAgentAIConfigCallInput {
  readonly profile: NimiPortableAIProfileInput;
}

export interface NimiSharedLocalAgentAIProfilePreview {
  readonly source: NimiPortableAIProfile;
  readonly before: AIConfig | null;
  readonly after: AIConfig;
  readonly identical: boolean;
}

/**
 * Typed SDK projection of the singular Runtime-owned LocalAgent subsystem
 * AIConfig. No individual LocalAgent identity, revision, readiness, route
 * option, or machine binding can be expressed through this surface.
 */
export interface NimiSharedLocalAgentAIConfigClient {
  get(input?: NimiSharedLocalAgentAIConfigCallInput): Promise<AIConfig>;
  overwrite(input: NimiSharedLocalAgentAIConfigOverwriteInput): Promise<AIConfig>;
}

export interface NimiSharedLocalAgentAIProfileClient {
  preview(input: NimiSharedLocalAgentAIProfileInput): Promise<NimiSharedLocalAgentAIProfilePreview>;
  apply(input: NimiSharedLocalAgentAIProfileInput): Promise<AIConfig>;
}

export interface NimiSharedLocalAgentAISurface {
  readonly sharedAIConfig: NimiSharedLocalAgentAIConfigClient;
  readonly sharedAIProfile: NimiSharedLocalAgentAIProfileClient;
}

export interface NimiSharedLocalAgentAIConfigAgentSurface {
  getSharedLocalAgentAIConfig?(
    request: GetSharedLocalAgentAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<GetSharedLocalAgentAIConfigResponse>;
  overwriteSharedLocalAgentAIConfig?(
    request: OverwriteSharedLocalAgentAIConfigRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<OverwriteSharedLocalAgentAIConfigResponse>;
  previewSharedLocalAgentAIProfile?(
    request: PreviewSharedLocalAgentAIProfileRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<PreviewSharedLocalAgentAIProfileResponse>;
  applySharedLocalAgentAIProfile?(
    request: ApplySharedLocalAgentAIProfileRequest,
    options?: RuntimeTypedCallOptions,
  ): Promise<ApplySharedLocalAgentAIProfileResponse>;
}

export interface NimiSharedLocalAgentAIConfigRuntime {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly agent: NimiSharedLocalAgentAIConfigAgentSurface;
}

export interface NimiSharedLocalAgentAISurfaceOptions {
  readonly runtime: NimiSharedLocalAgentAIConfigRuntime;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

export function createNimiSharedLocalAgentAISurface(
  options: NimiSharedLocalAgentAISurfaceOptions,
): NimiSharedLocalAgentAISurface {
  const runtime = options.runtime;

  const resolveSubject = async (explicit?: unknown): Promise<string> => {
    const explicitSubject = normalizeNimiRuntimeAgentText(explicit);
    if (explicitSubject) return explicitSubject;
    return resolveNimiRuntimeAgentSubjectUserId(
      options.getSubjectUserId,
      'Shared LocalAgent AIConfig requires authenticated subject user id.',
    );
  };

  const context = (subjectUserId: string): AgentRequestContext => ({
    appId: runtime.appId,
    subjectUserId,
    ownerUserId: subjectUserId,
    runtimeSourceRef: '',
    localAgentRef: '',
  });

  const scoped = async <T>(
    subjectUserId: string,
    scopes: readonly string[],
    operation: (callOptions: RuntimeTypedCallOptions) => Promise<T>,
  ): Promise<T> => withNimiRuntimeAgentScopes({
    runtime,
    subjectUserId,
    withScopes: options.withScopes,
  }, scopes, operation);

  const sharedAIConfig: NimiSharedLocalAgentAIConfigClient = Object.freeze({
    async get(input: NimiSharedLocalAgentAIConfigCallInput = {}) {
      const method = requireMethod(runtime.agent.getSharedLocalAgentAIConfig, 'getSharedLocalAgentAIConfig');
      const subjectUserId = await resolveSubject(input.subjectUserId);
      const response = await scoped(subjectUserId, [SHARED_LOCAL_AGENT_AI_CONFIG_READ_SCOPE], (callOptions) => (
        method({ context: context(subjectUserId) }, callOptions)
      ));
      return requireSharedAIConfig(response.config, 'GetSharedLocalAgentAIConfig');
    },

    async overwrite(input: NimiSharedLocalAgentAIConfigOverwriteInput) {
      if (!Array.isArray(input.capabilities)) {
        inputError('Shared LocalAgent AIConfig capabilities must be an array');
      }
      const method = requireMethod(runtime.agent.overwriteSharedLocalAgentAIConfig, 'overwriteSharedLocalAgentAIConfig');
      const subjectUserId = await resolveSubject(input.subjectUserId);
      const response = await scoped(subjectUserId, [SHARED_LOCAL_AGENT_AI_CONFIG_WRITE_SCOPE], (callOptions) => (
        method(
          {
            context: context(subjectUserId),
            capabilities: [...input.capabilities],
          },
          withNimiRuntimeIdempotencyMetadata(
            callOptions,
            createNimiClientId('shared-local-agent-ai-config-overwrite'),
          ),
        )
      ));
      return requireSharedAIConfig(response.config, 'OverwriteSharedLocalAgentAIConfig');
    },
  });

  const sharedAIProfile: NimiSharedLocalAgentAIProfileClient = Object.freeze({
      async preview(input: NimiSharedLocalAgentAIProfileInput) {
        const profile = encodeProfile(input.profile);
        const method = requireMethod(
          runtime.agent.previewSharedLocalAgentAIProfile,
          'previewSharedLocalAgentAIProfile',
        );
        const subjectUserId = await resolveSubject(input.subjectUserId);
        const response = await scoped(subjectUserId, [SHARED_LOCAL_AGENT_AI_CONFIG_WRITE_SCOPE], (callOptions) => (
          method({
            context: context(subjectUserId),
            profileJson: profile.bytes,
          }, callOptions)
        ));
        const before = response.before
          ? requireSharedAIConfig(response.before, 'PreviewSharedLocalAgentAIProfile.before')
          : null;
        const after = requireSharedAIConfig(response.after, 'PreviewSharedLocalAgentAIProfile.after');
        return Object.freeze({
          source: profile.source,
          before,
          after,
          identical: before !== null && canonicalAIConfig(before) === canonicalAIConfig(after),
        });
      },

      async apply(input: NimiSharedLocalAgentAIProfileInput) {
        const profile = encodeProfile(input.profile);
        const method = requireMethod(
          runtime.agent.applySharedLocalAgentAIProfile,
          'applySharedLocalAgentAIProfile',
        );
        const subjectUserId = await resolveSubject(input.subjectUserId);
        const response = await scoped(subjectUserId, [SHARED_LOCAL_AGENT_AI_CONFIG_WRITE_SCOPE], (callOptions) => (
          method(
            {
              context: context(subjectUserId),
              profileJson: profile.bytes,
            },
            withNimiRuntimeIdempotencyMetadata(
              callOptions,
              createNimiClientId('shared-local-agent-ai-profile-apply'),
            ),
          )
        ));
        return requireSharedAIConfig(response.config, 'ApplySharedLocalAgentAIProfile');
      },
  });

  return Object.freeze({ sharedAIConfig, sharedAIProfile });
}

function requireSharedAIConfig(config: AIConfig | undefined, operation: string): AIConfig {
  if (config?.owner?.owner.oneofKind !== 'runtimeLocalAgentSubsystem') {
    invalidResponse(`${operation} did not return the shared LocalAgent subsystem AIConfig`);
  }
  return config;
}

function encodeProfile(input: NimiPortableAIProfileInput): {
  readonly source: NimiPortableAIProfile;
  readonly bytes: Uint8Array;
} {
  const source = parseNimiPortableAIProfile(input);
  return {
    source,
    bytes: new TextEncoder().encode(serializeNimiPortableAIProfile(source)),
  };
}

function canonicalAIConfig(config: AIConfig | undefined): string {
  return JSON.stringify(config ?? null);
}

function requireMethod<T>(method: T | undefined, name: string): T {
  if (typeof method !== 'function') {
    throw createNimiError({
      message: `Shared LocalAgent AIConfig method ${name} is unavailable.`,
      reasonCode: 'RUNTIME_SHARED_LOCAL_AGENT_AI_CONFIG_METHOD_UNAVAILABLE',
      actionHint: 'provide_shared_local_shared_local_agent_ai_config_transport',
      source: 'sdk',
    });
  }
  return method;
}

function inputError(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'RUNTIME_SHARED_LOCAL_AGENT_AI_CONFIG_INPUT_INVALID',
    actionHint: 'provide_canonical_shared_local_shared_local_agent_ai_config_input',
    source: 'sdk',
  });
}

function invalidResponse(message: string): never {
  throw createNimiError({
    message,
    reasonCode: 'RUNTIME_SHARED_LOCAL_AGENT_AI_CONFIG_RESPONSE_INVALID',
    actionHint: 'inspect_shared_local_shared_local_agent_ai_config_contract',
    source: 'runtime',
  });
}
