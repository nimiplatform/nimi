import type { AIScopeRef } from '../scope/ai-scope.js';
import {
  applyAIProfileToConfig,
  computeAIConfigDiff,
  computeAIConfigVersion,
  formRuntimeProfileDescriptor,
  projectAIProfileApply,
  validateAIProfile,
  type AIConfig,
  type AICapabilityRequirementDeclaration,
  type AIProfile,
  type AIProfileApplyOptions,
  type AIProfileApplyResult,
  type AIProfileSurface,
  type AIProfileValidationResult,
  type RuntimeProfileDescriptor,
} from './ai-config.js';

type Awaitable<T> = T | Promise<T>;

export type HostAIProfileSurfaceOptions = {
  readonly listProfiles: () => Awaitable<readonly AIProfile[]>;
  readonly getProfile?: (profileId: string) => Awaitable<AIProfile | null>;
  readonly validateProfile?: (profile: AIProfile) => AIProfileValidationResult;
  readonly loadConfig: (scopeRef: AIScopeRef) => Awaitable<AIConfig>;
  readonly hasConfig?: (scopeRef: AIScopeRef) => Awaitable<boolean>;
  readonly saveConfig: (
    scopeRef: AIScopeRef,
    config: AIConfig,
    options: { readonly expectedBaseVersion: string },
  ) => Awaitable<AIConfig | void>;
  readonly collectProbeWarnings?: (profile: AIProfile) => readonly string[];
  readonly resolveLocalDependencies?: (profileId: string) => Awaitable<unknown[]>;
  readonly requirementDeclarations?: readonly AICapabilityRequirementDeclaration[];
  readonly sourceProfileDigest?: (profile: AIProfile) => string;
  readonly missingProfileMessage?: (profileId: string) => string;
  readonly invalidProfileMessage?: (profileId: string, errors: readonly string[]) => string;
};

function cloneAIProfile(profile: AIProfile): AIProfile {
  return {
    ...profile,
    tags: [...profile.tags],
    capabilities: Object.fromEntries(
      Object.entries(profile.capabilities).map(([capability, intent]) => [
        capability,
        intent ? {
          ...intent,
          targetRef: intent.targetRef ? { ...intent.targetRef } : intent.targetRef ?? undefined,
          params: intent.params ? { ...intent.params } : intent.params,
          runtimeDescriptor: intent.runtimeDescriptor
            ? JSON.parse(JSON.stringify(intent.runtimeDescriptor))
            : intent.runtimeDescriptor,
        } : intent,
      ]),
    ),
  };
}

function defaultMissingProfileMessage(profileId: string): string {
  return `Profile not found: ${profileId}`;
}

function defaultInvalidProfileMessage(_profileId: string, errors: readonly string[]): string {
  return `Profile schema invalid: ${errors.join(', ')}`;
}

async function defaultGetProfile(
  listProfiles: () => Awaitable<readonly AIProfile[]>,
  profileId: string,
): Promise<AIProfile | null> {
  const normalized = String(profileId || '').trim();
  if (!normalized) {
    return null;
  }
  const profiles = await listProfiles();
  return profiles.find((profile) => profile.profileId === normalized) ?? null;
}

export function collectAIProfileSchemaProbeWarnings(profile: AIProfile): string[] {
  const warnings: string[] = [];
  for (const capability of Object.keys(profile.capabilities).sort()) {
    const intent = profile.capabilities[capability];
    if (!intent) {
      continue;
    }
    const hasTargetRef = intent.targetRef !== undefined && intent.targetRef !== null;
    if (!hasTargetRef) {
      warnings.push(
        `Capability "${capability}" has no compact target ref; it will not be executable until prepared.`,
      );
    }
  }
  return warnings;
}

export function createHostAIProfileSurface(
  options: HostAIProfileSurfaceOptions,
): AIProfileSurface {
  const validate = options.validateProfile ?? validateAIProfile;
  const missingProfileMessage = options.missingProfileMessage ?? defaultMissingProfileMessage;
  const invalidProfileMessage = options.invalidProfileMessage ?? defaultInvalidProfileMessage;
  const collectProbeWarnings =
    options.collectProbeWarnings ?? collectAIProfileSchemaProbeWarnings;
  const getProfile = options.getProfile
    ?? ((profileId: string) => defaultGetProfile(options.listProfiles, profileId));

  async function resolveValidProfile(profileId: string): Promise<
    | { ok: true; profile: AIProfile; probeWarnings: string[] }
    | { ok: false; failureReason: string; probeWarnings: string[] }
  > {
    const profile = await getProfile(profileId);
    if (!profile) {
      return {
        ok: false,
        failureReason: missingProfileMessage(profileId),
        probeWarnings: [],
      };
    }
    const clonedProfile = cloneAIProfile(profile);
    const validation = validate(clonedProfile);
    if (!validation.valid) {
      return {
        ok: false,
        failureReason: invalidProfileMessage(profileId, validation.errors),
        probeWarnings: [],
      };
    }
    return {
      ok: true,
      profile: clonedProfile,
      probeWarnings: [...collectProbeWarnings(clonedProfile)],
    };
  }

  return {
    async list(): Promise<AIProfile[]> {
      return (await options.listProfiles()).map((profile) => cloneAIProfile(profile));
    },

    async get(profileId: string): Promise<AIProfile | null> {
      const profile = await getProfile(profileId);
      return profile ? cloneAIProfile(profile) : null;
    },

    validate(profile: AIProfile): AIProfileValidationResult {
      return validate(profile);
    },

    async previewApply(scopeRef: AIScopeRef, profileId: string) {
      const resolved = await resolveValidProfile(profileId);
      if (!resolved.ok) {
        throw new Error(resolved.failureReason);
      }
      const persisted = options.hasConfig ? await options.hasConfig(scopeRef) : true;
      const before = persisted ? await options.loadConfig(scopeRef) : null;
      const baseConfig = before ?? await options.loadConfig(scopeRef);
      const projection = projectAIProfileApply(resolved.profile);
      const after = projection.outcome === 'ready_to_apply'
        ? applyAIProfileToConfig(baseConfig, resolved.profile)
        : null;
      return {
        before,
        after,
        diff: computeAIConfigDiff(before, after),
        outcome: projection.outcome,
        setupProjection: projection.setupProjection,
        baseVersion: computeAIConfigVersion(baseConfig),
        probeWarnings: resolved.probeWarnings,
      };
    },

    async apply(
      scopeRef: AIScopeRef,
      profileId: string,
      applyOptions?: AIProfileApplyOptions,
    ): Promise<AIProfileApplyResult> {
      const resolved = await resolveValidProfile(profileId);
      if (!resolved.ok) {
        return {
          success: false,
          config: null,
          failureReason: resolved.failureReason,
          outcome: 'failed',
          setupProjection: null,
          probeWarnings: resolved.probeWarnings,
        };
      }
      const baseConfig = await options.loadConfig(scopeRef);
      const expectedBaseVersion =
        applyOptions?.expectedBaseVersion?.trim() || computeAIConfigVersion(baseConfig);
      const projection = projectAIProfileApply(resolved.profile);
      if (projection.outcome !== 'ready_to_apply') {
        return {
          success: false,
          config: null,
          failureReason: projection.setupProjection?.reasonCodes.join(', ') || projection.outcome,
          outcome: projection.outcome,
          setupProjection: projection.setupProjection,
          probeWarnings: resolved.probeWarnings,
        };
      }
      const nextConfig = applyAIProfileToConfig(baseConfig, resolved.profile);
      const savedConfig = await options.saveConfig(scopeRef, nextConfig, {
        expectedBaseVersion,
      });
      return {
        success: true,
        config: savedConfig ?? nextConfig,
        failureReason: null,
        outcome: 'ready_to_apply',
        setupProjection: null,
        probeWarnings: [],
      };
    },

    async resolveLocalDependencies(profileId: string): Promise<unknown[]> {
      if (!options.resolveLocalDependencies) {
        throw new Error('AIProfile local dependency resolver is not configured');
      }
      return options.resolveLocalDependencies(profileId);
    },

    async formRuntimeDescriptor(
      profileId: string,
      scopeRef: AIScopeRef,
      requirementRef?: string,
    ): Promise<RuntimeProfileDescriptor> {
      const resolved = await resolveValidProfile(profileId);
      if (!resolved.ok) {
        throw new Error(resolved.failureReason);
      }
      const declarations = (options.requirementDeclarations || []).filter((declaration) => {
        if (requirementRef && declaration.requirementId !== requirementRef) {
          return false;
        }
        return declaration.scopeRef.kind === scopeRef.kind
          && declaration.scopeRef.ownerId === scopeRef.ownerId
          && (declaration.scopeRef.surfaceId || '') === (scopeRef.surfaceId || '');
      });
      return formRuntimeProfileDescriptor({
        profile: resolved.profile,
        requirementDeclarations: declarations,
        descriptorId: `descriptor:${resolved.profile.profileId}:${scopeRef.kind}:${scopeRef.ownerId}:${scopeRef.surfaceId || 'default'}`,
        sourceProfileDigest: options.sourceProfileDigest?.(resolved.profile) || `profile:${resolved.profile.profileId}`,
      });
    },
  };
}
