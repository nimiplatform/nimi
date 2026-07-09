import {
  AgentPresentationBackendKind,
  type AgentPresentationProfile,
  type AgentPresentationProfilePatch,
  type RuntimeTypedCallOptions,
  type SetAgentPresentationProfileRequest,
  type SetAgentPresentationProfileResponse,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';
import {
  buildRuntimeAgentRequestContext,
  projectRuntimeLocalAgentIdentity,
  type RuntimeLocalAgentIdentityInput,
} from './agent-local-identity';
import {
  resolveNimiRuntimeAgentSubjectUserId,
  withNimiRuntimeAgentScopes,
  type NimiRuntimeAgentAppAuthClient,
  type NimiRuntimeAgentAuthClient,
  type NimiRuntimeAgentScopeRunner,
} from './runtime-agent-protected';
import type { NimiRuntimeAgentPresentationProfileProjection } from './runtime-agent-inspect-types';
import {
  isNimiRuntimeAgentPresentationOpaqueRef,
  normalizeNimiRuntimeAgentPresentationRevision,
  normalizeNimiRuntimeAgentPresentationVoiceReference,
  projectNimiRuntimeAgentPresentationRecord,
} from './runtime-agent-presentation-validation';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';

export {
  isNimiRuntimeAgentPresentationOpaqueRef,
  normalizeNimiRuntimeAgentPresentationRevision,
} from './runtime-agent-presentation-validation';

export interface NimiRuntimeAgentPresentationProfileInput {
  readonly backendKind?: unknown;
  readonly avatarAssetRef?: unknown;
  readonly expressionProfileRef?: unknown;
  readonly idlePreset?: unknown;
  readonly interactionPolicyRef?: unknown;
  readonly defaultVoiceReference?: unknown;
  readonly avatarAutoplay?: unknown;
  readonly backgroundAssetRef?: unknown;
}

export interface NimiRuntimeAgentPresentationProfilePatchInput {
  readonly backendKind?: unknown;
  readonly avatarAssetRef?: unknown;
  readonly expressionProfileRef?: unknown;
  readonly idlePreset?: unknown;
  readonly interactionPolicyRef?: unknown;
  readonly defaultVoiceReference?: unknown;
  readonly avatarAutoplay?: unknown;
  readonly backgroundAssetRef?: unknown;
}

export interface NimiRuntimeAgentPresentationProfileContext {
  readonly appId: string;
  readonly subjectUserId: string;
}

export interface NimiRuntimeAgentPresentationProfileSurface {
  setPresentationProfile(
    input: RuntimeLocalAgentIdentityInput,
    profile: NimiRuntimeAgentPresentationProfileInput | null,
    expectedRevision: string,
  ): Promise<NimiRuntimeAgentPresentationProfileMutationResult>;
  patchPresentationProfile(
    input: RuntimeLocalAgentIdentityInput,
    patch: NimiRuntimeAgentPresentationProfilePatchInput,
    expectedRevision: string,
  ): Promise<NimiRuntimeAgentPresentationProfileMutationResult>;
}

export interface NimiRuntimeAgentPresentationProfileMutationResult {
  readonly profile: NimiRuntimeAgentPresentationProfileProjection | null;
  readonly committedRevision: string;
}

export interface NimiHostRuntimeAgentPresentationProfileClient {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
  readonly appAuth: NimiRuntimeAgentAppAuthClient;
  readonly agent: {
    setAgentPresentationProfile(
      request: SetAgentPresentationProfileRequest,
      options?: RuntimeTypedCallOptions,
    ): Promise<SetAgentPresentationProfileResponse>;
  };
}

export interface NimiHostRuntimeAgentPresentationProfileSurfaceOptions {
  readonly getRuntime: () => NimiHostRuntimeAgentPresentationProfileClient;
  readonly getSubjectUserId: () => string | Promise<string | undefined> | undefined;
  readonly withScopes?: NimiRuntimeAgentScopeRunner;
}

const RUNTIME_AGENT_PRESENTATION_VOICE_REFERENCE_PREFIXES = [
  'preset_voice_id:',
  'voice_asset_id:',
];

export function normalizeNimiRuntimeAgentPresentationBackendKind(
  value: unknown,
): AgentPresentationBackendKind | null {
  switch (normalizeNimiRuntimeAgentText(value).toLowerCase()) {
    case 'vrm':
      return AgentPresentationBackendKind.VRM;
    case 'live2d':
      return AgentPresentationBackendKind.LIVE2D;
    case 'sprite2d':
      return AgentPresentationBackendKind.SPRITE2D;
    case 'canvas2d':
      return AgentPresentationBackendKind.CANVAS2D;
    case 'video':
      return AgentPresentationBackendKind.VIDEO;
    default:
      return null;
  }
}

export function normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(value: unknown): string {
  if (value === undefined) {
    return '';
  }
  const normalized = normalizeNimiRuntimeAgentPresentationVoiceReference(value);
  if (normalized === '') {
    return '';
  }
  if (normalized !== null && RUNTIME_AGENT_PRESENTATION_VOICE_REFERENCE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return normalized;
  }
  presentationError(
    'Runtime Agent presentation profile voice reference must use preset_voice_id or voice_asset_id.',
    'SDK_RUNTIME_AGENT_PRESENTATION_VOICE_REFERENCE_INVALID',
    'provide_runtime_owned_voice_reference',
  );
}

function presentationError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({
    message,
    reasonCode,
    actionHint,
    source: 'sdk',
  });
}

function hasPresentationPatchField<T extends object>(patch: T, field: keyof T): boolean {
  return Object.prototype.hasOwnProperty.call(patch, field);
}

function normalizePresentationOpaqueRef(value: unknown, fieldName: string, allowEmpty: boolean): string {
  if (typeof value !== 'string' || (!value && !allowEmpty) || (value && !isNimiRuntimeAgentPresentationOpaqueRef(value))) {
    presentationError(
      `Runtime Agent presentation profile ${fieldName} must be an admitted opaque ref.`,
      'SDK_RUNTIME_AGENT_PRESENTATION_REF_INVALID',
      'provide_runtime_agent_presentation_opaque_ref',
    );
  }
  return value;
}

function normalizeOptionalPresentationOpaqueRef(value: unknown, fieldName: string): string {
  return value === undefined ? '' : normalizePresentationOpaqueRef(value, fieldName, true);
}

function normalizePresentationAvatarAutoplay(value: unknown, omittedValue: boolean): boolean {
  if (value === undefined) {
    return omittedValue;
  }
  if (typeof value !== 'boolean') {
    presentationError(
      'Runtime Agent presentation profile avatar autoplay must be a boolean.',
      'SDK_RUNTIME_AGENT_PRESENTATION_PROFILE_INVALID',
      'provide_runtime_agent_presentation_avatar_autoplay_boolean',
    );
  }
  return value;
}

function requirePresentationRevision(value: unknown): string {
  const revision = normalizeNimiRuntimeAgentPresentationRevision(value);
  if (revision === null) {
    presentationError(
      'Runtime Agent presentation profile requires a canonical uint64 expected revision.',
      'SDK_RUNTIME_AGENT_PRESENTATION_EXPECTED_REVISION_INVALID',
      'provide_runtime_agent_presentation_expected_revision',
    );
  }
  return revision;
}

function buildNimiRuntimeAgentPresentationProfilePatch(
  input: NimiRuntimeAgentPresentationProfilePatchInput,
): AgentPresentationProfilePatch {
  const patch: Record<string, unknown> = {};
  let changed = false;
  if (hasPresentationPatchField(input, 'backendKind')) {
    const backendKind = normalizeNimiRuntimeAgentPresentationBackendKind(input.backendKind);
    if (!backendKind) {
      presentationError(
        'Runtime Agent presentation profile patch requires a supported backend kind.',
        'SDK_RUNTIME_AGENT_PRESENTATION_PROFILE_INVALID',
        'provide_runtime_agent_presentation_profile_patch',
      );
    }
    patch.backendKind = backendKind;
    changed = true;
  }
  if (hasPresentationPatchField(input, 'avatarAssetRef')) {
    patch.avatarAssetRef = normalizePresentationOpaqueRef(input.avatarAssetRef, 'avatar asset ref', true);
    changed = true;
  }
  if (hasPresentationPatchField(input, 'expressionProfileRef')) {
    patch.expressionProfileRef = normalizePresentationOpaqueRef(input.expressionProfileRef, 'expression profile ref', true);
    changed = true;
  }
  if (hasPresentationPatchField(input, 'idlePreset')) {
    patch.idlePreset = normalizePresentationOpaqueRef(input.idlePreset, 'idle preset', true);
    changed = true;
  }
  if (hasPresentationPatchField(input, 'interactionPolicyRef')) {
    patch.interactionPolicyRef = normalizePresentationOpaqueRef(input.interactionPolicyRef, 'interaction policy ref', true);
    changed = true;
  }
  if (hasPresentationPatchField(input, 'defaultVoiceReference')) {
    patch.defaultVoiceReference = normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(input.defaultVoiceReference);
    changed = true;
  }
  if (hasPresentationPatchField(input, 'avatarAutoplay')) {
    patch.avatarAutoplay = normalizePresentationAvatarAutoplay(input.avatarAutoplay, false);
    changed = true;
  }
  if (hasPresentationPatchField(input, 'backgroundAssetRef')) {
    patch.backgroundAssetRef = normalizePresentationOpaqueRef(input.backgroundAssetRef, 'background asset ref', true);
    changed = true;
  }
  if (!changed) {
    presentationError(
      'Runtime Agent presentation profile patch requires at least one field.',
      'SDK_RUNTIME_AGENT_PRESENTATION_PROFILE_INVALID',
      'provide_runtime_agent_presentation_profile_patch',
    );
  }
  return patch as AgentPresentationProfilePatch;
}

export function buildNimiSetRuntimeAgentPresentationProfileRequest(input: {
  readonly context: NimiRuntimeAgentPresentationProfileContext;
  readonly identity: RuntimeLocalAgentIdentityInput;
  readonly expectedRevision: string;
  readonly profile?: NimiRuntimeAgentPresentationProfileInput | null | undefined;
  readonly patch?: NimiRuntimeAgentPresentationProfilePatchInput | null | undefined;
}): SetAgentPresentationProfileRequest {
  const identity = projectRuntimeLocalAgentIdentity(input.identity);
  const agentId = identity.localAgentRef;
  const appId = normalizeNimiRuntimeAgentText(input.context.appId);
  const subjectUserId = normalizeNimiRuntimeAgentText(input.context.subjectUserId);
  const expectedRevision = requirePresentationRevision(input.expectedRevision);
  if (!agentId) {
    presentationError('Runtime Agent presentation profile requires agent id.', 'SDK_RUNTIME_AGENT_ID_REQUIRED', 'provide_runtime_agent_id');
  }
  if (!appId || !subjectUserId) {
    presentationError(
      'Runtime Agent presentation profile requires app id and subject user id.',
      'SDK_RUNTIME_AGENT_PRESENTATION_CONTEXT_REQUIRED',
      'provide_runtime_agent_context',
    );
  }
  const context = buildRuntimeAgentRequestContext({
    runtimeAppId: appId,
    subjectUserId,
    ownerUserId: identity.ownerUserId,
    runtimeSourceRef: identity.runtimeSourceRef,
    localAgentRef: identity.localAgentRef,
  });
  if (input.patch) {
    return {
      context,
      agentId,
      expectedRevision,
      mutation: {
        oneofKind: 'patch',
        patch: buildNimiRuntimeAgentPresentationProfilePatch(input.patch),
      },
    };
  }
  if (!input.profile) {
    return {
      context,
      agentId,
      expectedRevision,
      mutation: {
        oneofKind: 'clear',
        clear: {},
      },
    };
  }
  const backendKind = normalizeNimiRuntimeAgentPresentationBackendKind(input.profile.backendKind);
  const avatarAssetRef = normalizePresentationOpaqueRef(input.profile.avatarAssetRef, 'avatar asset ref', false);
  if (!backendKind || !avatarAssetRef) {
    presentationError(
      'Runtime Agent presentation profile requires backend kind and avatar asset ref.',
      'SDK_RUNTIME_AGENT_PRESENTATION_PROFILE_INVALID',
      'provide_runtime_agent_presentation_profile',
    );
  }
  return {
    context,
    agentId,
    expectedRevision,
    mutation: {
      oneofKind: 'profile',
      profile: {
        backendKind,
        avatarAssetRef,
        expressionProfileRef: normalizeOptionalPresentationOpaqueRef(input.profile.expressionProfileRef, 'expression profile ref'),
        idlePreset: normalizeOptionalPresentationOpaqueRef(input.profile.idlePreset, 'idle preset'),
        interactionPolicyRef: normalizeOptionalPresentationOpaqueRef(input.profile.interactionPolicyRef, 'interaction policy ref'),
        defaultVoiceReference: normalizeNimiRuntimeAgentPresentationDefaultVoiceReference(input.profile.defaultVoiceReference),
        avatarAutoplay: normalizePresentationAvatarAutoplay(input.profile.avatarAutoplay, false),
        backgroundAssetRef: normalizeOptionalPresentationOpaqueRef(input.profile.backgroundAssetRef, 'background asset ref'),
        revision: '0',
      },
    },
  };
}

function projectPresentationMutationResponse(
  response: SetAgentPresentationProfileResponse,
  mutationKind: 'profile' | 'clear' | 'patch',
): NimiRuntimeAgentPresentationProfileMutationResult {
  const committedRevision = normalizeNimiRuntimeAgentPresentationRevision(response.committedRevision);
  if (committedRevision === null || committedRevision === '0') {
    presentationError(
      'Runtime Agent presentation mutation returned an invalid committed revision.',
      'SDK_RUNTIME_AGENT_PRESENTATION_RESPONSE_INVALID',
      'inspect_runtime_agent_presentation_response',
    );
  }
  if (!response.profile) {
    if (mutationKind === 'profile') {
      presentationError(
        'Runtime Agent presentation set response is missing its committed profile.',
        'SDK_RUNTIME_AGENT_PRESENTATION_RESPONSE_INVALID',
        'inspect_runtime_agent_presentation_response',
      );
    }
    return { profile: null, committedRevision };
  }
  if (mutationKind === 'clear') {
    presentationError(
      'Runtime Agent presentation clear response unexpectedly returned a profile.',
      'SDK_RUNTIME_AGENT_PRESENTATION_RESPONSE_INVALID',
      'inspect_runtime_agent_presentation_response',
    );
  }
  const projected = projectNimiRuntimeAgentPresentationRecord({
    presentationProfile: response.profile as AgentPresentationProfile,
    presentationProfileRevision: committedRevision,
  });
  if (!projected.profile || projected.committedRevision !== committedRevision) {
    presentationError(
      'Runtime Agent presentation mutation returned an invalid profile projection.',
      'SDK_RUNTIME_AGENT_PRESENTATION_RESPONSE_INVALID',
      'inspect_runtime_agent_presentation_response',
    );
  }
  return { profile: projected.profile, committedRevision };
}

export function createNimiHostRuntimeAgentPresentationProfileSurface(
  options: NimiHostRuntimeAgentPresentationProfileSurfaceOptions,
): NimiRuntimeAgentPresentationProfileSurface {
  return {
    async setPresentationProfile(identity, profile, expectedRevision) {
      const runtime = options.getRuntime();
      const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
        options.getSubjectUserId,
        'Runtime Agent presentation profile requires authenticated subject user id.',
      );
      const response = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, ['runtime.agent.write'], (callOptions) => runtime.agent.setAgentPresentationProfile(
        buildNimiSetRuntimeAgentPresentationProfileRequest({
          context: { appId: runtime.appId, subjectUserId },
          identity,
          profile,
          expectedRevision,
        }),
        callOptions,
      ));
      return projectPresentationMutationResponse(response, profile ? 'profile' : 'clear');
    },
    async patchPresentationProfile(identity, patch, expectedRevision) {
      const runtime = options.getRuntime();
      const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
        options.getSubjectUserId,
        'Runtime Agent presentation profile requires authenticated subject user id.',
      );
      const response = await withNimiRuntimeAgentScopes({
        runtime,
        subjectUserId,
        withScopes: options.withScopes,
      }, ['runtime.agent.write'], (callOptions) => runtime.agent.setAgentPresentationProfile(
        buildNimiSetRuntimeAgentPresentationProfileRequest({
          context: { appId: runtime.appId, subjectUserId },
          identity,
          patch,
          expectedRevision,
        }),
        callOptions,
      ));
      return projectPresentationMutationResponse(response, 'patch');
    },
  };
}
