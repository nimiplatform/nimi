import {
  AgentPresentationAssetRole,
  AgentPresentationBackendKind,
  type AgentPresentationAssetMaterial,
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
  projectNimiRuntimeAgentPresentationRecord,
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

export interface NimiRuntimeAgentPresentationAssetMaterialInput {
  readonly role: 'avatar' | 'background';
  readonly fileName: string;
  readonly mediaType: string;
  readonly content: Uint8Array;
  readonly sha256: string;
}

export interface NimiRuntimeAgentPresentationProfileSurface {
  setPresentationProfile(
    input: RuntimeLocalAgentIdentityInput,
    profile: NimiRuntimeAgentPresentationProfileInput | null,
    expectedRevision: string,
    importedAssets?: readonly NimiRuntimeAgentPresentationAssetMaterialInput[],
  ): Promise<NimiRuntimeAgentPresentationCommitResult>;
  patchPresentationProfile(
    input: RuntimeLocalAgentIdentityInput,
    patch: NimiRuntimeAgentPresentationProfilePatchInput,
    expectedRevision: string,
    importedAssets?: readonly NimiRuntimeAgentPresentationAssetMaterialInput[],
  ): Promise<NimiRuntimeAgentPresentationCommitResult>;
}

export interface NimiRuntimeAgentPresentationProfileMutationResult {
  readonly profile: NimiRuntimeAgentPresentationProfileProjection | null;
  readonly previousProfile: NimiRuntimeAgentPresentationProfileProjection | null;
  readonly committedRevision: string;
}

export type NimiRuntimeAgentPresentationValidationReasonCode =
  | 'AGENT_PRESENTATION_ASSET_TYPE_INVALID'
  | 'AGENT_PRESENTATION_ASSET_TOO_LARGE'
  | 'AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID'
  | 'AGENT_PRESENTATION_ASSET_DEPENDENCY_MISSING'
  | 'AGENT_PRESENTATION_ASSET_INTEGRITY_MISMATCH'
  | 'AGENT_PRESENTATION_BACKEND_INCOMPATIBLE'
  | 'AGENT_PRESENTATION_ASSET_NOT_VALIDATED';

export interface NimiRuntimeAgentPresentationTypedFailure {
  readonly reasonCode: NimiRuntimeAgentPresentationValidationReasonCode;
  readonly category: 'type' | 'size' | 'structure' | 'dependency' | 'integrity' | 'backend-compat' | 'not-validated';
  readonly message: string;
  readonly actionHint: string;
  readonly reasonMetadata: Readonly<Record<string, string>>;
}

export type NimiRuntimeAgentPresentationCommitResult =
  | { readonly outcome: 'committed'; readonly projection: NimiRuntimeAgentPresentationProfileMutationResult }
  | { readonly outcome: 'conflict'; readonly conflict: { readonly reasonCode: 'AGENT_PRESENTATION_REVISION_CONFLICT'; readonly category: 'presentation-revision-conflict'; readonly actionHint: 'refresh_presentation_snapshot'; readonly message: string } }
  | { readonly outcome: 'validation-failed'; readonly failure: NimiRuntimeAgentPresentationTypedFailure };

export interface NimiHostRuntimeAgentPresentationProfileClient {
  readonly appId: string;
  readonly auth: NimiRuntimeAgentAuthClient;
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

function buildPresentationAssetMaterials(
  input: readonly NimiRuntimeAgentPresentationAssetMaterialInput[] | undefined,
): AgentPresentationAssetMaterial[] {
  const seen = new Set<string>();
  return [...(input ?? [])].map((material) => {
    const role = normalizeNimiRuntimeAgentText(material?.role).toLowerCase();
    const fileName = normalizeNimiRuntimeAgentText(material?.fileName);
    const mediaType = normalizeNimiRuntimeAgentText(material?.mediaType).toLowerCase();
    const sha256 = normalizeNimiRuntimeAgentText(material?.sha256);
    if ((role !== 'avatar' && role !== 'background') || seen.has(role) || !fileName || !mediaType
      || !(material?.content instanceof Uint8Array) || material.content.byteLength === 0 || !/^[a-f0-9]{64}$/u.test(sha256)) {
      presentationError(
        'Runtime Agent presentation asset material is invalid.',
        'SDK_RUNTIME_AGENT_PRESENTATION_ASSET_MATERIAL_INVALID',
        'provide_protected_shell_imported_asset_material',
      );
    }
    seen.add(role);
    return {
      role: role === 'avatar' ? AgentPresentationAssetRole.AVATAR : AgentPresentationAssetRole.BACKGROUND,
      fileName,
      mediaType,
      content: new Uint8Array(material.content),
      sha256,
    };
  });
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
  readonly importedAssets?: readonly NimiRuntimeAgentPresentationAssetMaterialInput[];
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
  const importedAssets = buildPresentationAssetMaterials(input.importedAssets);
  if (input.patch) {
    return {
      context,
      agentId,
      expectedRevision,
      importedAssets,
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
      importedAssets,
      mutation: {
        oneofKind: 'clear',
        clear: {},
      },
    };
  }
  const backendKind = normalizeNimiRuntimeAgentPresentationBackendKind(input.profile.backendKind);
  const avatarAssetRef = input.profile.avatarAssetRef === undefined
    ? ''
    : normalizePresentationOpaqueRef(input.profile.avatarAssetRef, 'avatar asset ref', true);
  if (!backendKind || (!avatarAssetRef && !importedAssets.some((asset) => asset.role === AgentPresentationAssetRole.AVATAR))) {
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
    importedAssets,
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
  const previousProfile = response.previousProfile
    ? projectNimiRuntimeAgentPresentationRecord({
      presentationProfile: response.previousProfile,
      presentationProfileRevision: response.previousProfile.revision,
    }).profile
    : null;
  if (!response.profile) {
    if (mutationKind === 'profile') {
      presentationError(
        'Runtime Agent presentation set response is missing its committed profile.',
        'SDK_RUNTIME_AGENT_PRESENTATION_RESPONSE_INVALID',
        'inspect_runtime_agent_presentation_response',
      );
    }
    return { profile: null, previousProfile, committedRevision };
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
  return { profile: projected.profile, previousProfile, committedRevision };
}

function projectPresentationCommitError(error: unknown): Exclude<NimiRuntimeAgentPresentationCommitResult, { readonly outcome: 'committed' }> | null {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : {};
  const reasonValue = record.reasonCode ?? record.code;
  const rawReason = (typeof reasonValue === 'number' ? String(reasonValue) : normalizeNimiRuntimeAgentText(reasonValue)).replace(/-/gu, '_').toUpperCase();
  const numeric: Record<string, string> = {
    '614': 'AGENT_PRESENTATION_REVISION_CONFLICT', '672': 'AGENT_PRESENTATION_ASSET_TYPE_INVALID',
    '673': 'AGENT_PRESENTATION_ASSET_TOO_LARGE', '674': 'AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID',
    '675': 'AGENT_PRESENTATION_ASSET_DEPENDENCY_MISSING', '676': 'AGENT_PRESENTATION_ASSET_INTEGRITY_MISMATCH',
    '677': 'AGENT_PRESENTATION_BACKEND_INCOMPATIBLE', '678': 'AGENT_PRESENTATION_ASSET_NOT_VALIDATED',
  };
  const reasonCode = numeric[rawReason] ?? rawReason;
  const message = error instanceof Error ? error.message : reasonCode;
  if (reasonCode === 'AGENT_PRESENTATION_REVISION_CONFLICT') {
    return Object.freeze({ outcome: 'conflict', conflict: Object.freeze({
      reasonCode, category: 'presentation-revision-conflict', actionHint: 'refresh_presentation_snapshot', message,
    }) });
  }
  const categories: Record<string, NimiRuntimeAgentPresentationTypedFailure['category']> = {
    AGENT_PRESENTATION_ASSET_TYPE_INVALID: 'type', AGENT_PRESENTATION_ASSET_TOO_LARGE: 'size',
    AGENT_PRESENTATION_ASSET_STRUCTURE_INVALID: 'structure', AGENT_PRESENTATION_ASSET_DEPENDENCY_MISSING: 'dependency',
    AGENT_PRESENTATION_ASSET_INTEGRITY_MISMATCH: 'integrity', AGENT_PRESENTATION_BACKEND_INCOMPATIBLE: 'backend-compat',
    AGENT_PRESENTATION_ASSET_NOT_VALIDATED: 'not-validated',
  };
  const category = categories[reasonCode];
  if (!category) return null;
  const details = record.details && typeof record.details === 'object' ? record.details as Record<string, unknown> : {};
  const allowed = ['validation_category', 'asset_role', 'media_type', 'backend_kind'];
  const reasonMetadata = Object.freeze(Object.fromEntries(allowed.flatMap((key) => {
    const value = normalizeNimiRuntimeAgentText(details[key]);
    return value ? [[key, value]] : [];
  })));
  return Object.freeze({ outcome: 'validation-failed', failure: Object.freeze({
    reasonCode: reasonCode as NimiRuntimeAgentPresentationValidationReasonCode,
    category,
    message,
    actionHint: normalizeNimiRuntimeAgentText(record.actionHint) || 'inspect_presentation_validation_failure',
    reasonMetadata,
  }) });
}

export function createNimiHostRuntimeAgentPresentationProfileSurface(
  options: NimiHostRuntimeAgentPresentationProfileSurfaceOptions,
): NimiRuntimeAgentPresentationProfileSurface {
  return {
    async setPresentationProfile(identity, profile, expectedRevision, importedAssets) {
      const runtime = options.getRuntime();
      const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
        options.getSubjectUserId,
        'Runtime Agent presentation profile requires authenticated subject user id.',
      );
      try {
        const response = await withNimiRuntimeAgentScopes({
          runtime,
          subjectUserId,
          withScopes: options.withScopes,
        }, ['runtime.agent.write'], (callOptions) => runtime.agent.setAgentPresentationProfile(
          buildNimiSetRuntimeAgentPresentationProfileRequest({
            context: { appId: runtime.appId, subjectUserId }, identity, profile, expectedRevision, importedAssets,
          }),
          callOptions,
        ));
        return Object.freeze({ outcome: 'committed', projection: projectPresentationMutationResponse(response, profile ? 'profile' : 'clear') });
      } catch (error) {
        const projected = projectPresentationCommitError(error);
        if (projected) return projected;
        throw error;
      }
    },
    async patchPresentationProfile(identity, patch, expectedRevision, importedAssets) {
      const runtime = options.getRuntime();
      const subjectUserId = await resolveNimiRuntimeAgentSubjectUserId(
        options.getSubjectUserId,
        'Runtime Agent presentation profile requires authenticated subject user id.',
      );
      try {
        const response = await withNimiRuntimeAgentScopes({
          runtime,
          subjectUserId,
          withScopes: options.withScopes,
        }, ['runtime.agent.write'], (callOptions) => runtime.agent.setAgentPresentationProfile(
          buildNimiSetRuntimeAgentPresentationProfileRequest({
            context: { appId: runtime.appId, subjectUserId }, identity, patch, expectedRevision, importedAssets,
          }),
          callOptions,
        ));
        return Object.freeze({ outcome: 'committed', projection: projectPresentationMutationResponse(response, 'patch') });
      } catch (error) {
        const projected = projectPresentationCommitError(error);
        if (projected) return projected;
        throw error;
      }
    },
  };
}
