import type { AIScopeRef } from '../scope/ai-scope.js';
import {
  applyAIProfileToConfig,
  computeAIConfigDiff,
  computeAIConfigVersion,
  validateAIProfile,
  type AIConfig,
  type AIProfile,
  type AIProfileApplyResult,
  type AIProfileSurface,
  type AIProfileValidationResult,
} from './ai-config.js';

type Awaitable<T> = T | Promise<T>;

export type HostAIProfileSurfaceOptions = {
  readonly listProfiles: () => Awaitable<readonly AIProfile[]>;
  readonly getProfile?: (profileId: string) => Awaitable<AIProfile | null>;
  readonly validateProfile?: (profile: AIProfile) => AIProfileValidationResult;
  readonly loadConfig: (scopeRef: AIScopeRef) => Awaitable<AIConfig>;
  readonly hasConfig?: (scopeRef: AIScopeRef) => Awaitable<boolean>;
  readonly saveConfig: (scopeRef: AIScopeRef, config: AIConfig) => Awaitable<AIConfig | void>;
  readonly collectProbeWarnings?: (profile: AIProfile) => readonly string[];
  readonly resolveLocalDependencies?: (profileId: string) => Awaitable<unknown[]>;
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
          localProfileRef: intent.localProfileRef ? { ...intent.localProfileRef } : undefined,
          binding: intent.binding ? { ...intent.binding } : intent.binding ?? undefined,
          params: intent.params ? { ...intent.params } : intent.params,
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
    const hasBinding = intent.binding !== undefined && intent.binding !== null;
    const hasLocalRef = intent.localProfileRef !== undefined && intent.localProfileRef !== null;
    if (!hasBinding && !hasLocalRef) {
      warnings.push(
        `Capability "${capability}" has no model binding; it will not be executable until configured.`,
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
      const after = applyAIProfileToConfig(baseConfig, resolved.profile);
      return {
        before,
        after,
        diff: computeAIConfigDiff(before, after),
        baseVersion: computeAIConfigVersion(baseConfig),
        probeWarnings: resolved.probeWarnings,
      };
    },

    async apply(scopeRef: AIScopeRef, profileId: string): Promise<AIProfileApplyResult> {
      const resolved = await resolveValidProfile(profileId);
      if (!resolved.ok) {
        return {
          success: false,
          config: null,
          failureReason: resolved.failureReason,
          probeWarnings: resolved.probeWarnings,
        };
      }
      const nextConfig = applyAIProfileToConfig(
        await options.loadConfig(scopeRef),
        resolved.profile,
      );
      const savedConfig = await options.saveConfig(scopeRef, nextConfig);
      return {
        success: true,
        config: savedConfig ?? nextConfig,
        failureReason: null,
        probeWarnings: [],
      };
    },

    async resolveLocalDependencies(profileId: string): Promise<unknown[]> {
      return options.resolveLocalDependencies
        ? options.resolveLocalDependencies(profileId)
        : [];
    },
  };
}
