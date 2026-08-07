import type { NimiPortableAIProfile, NimiPortableAIProfileInput } from '../ai/config-profile.js';
import type {
  NimiCapabilityAIConfig,
  NimiCapabilityAIConfigIntent,
} from '../ai/capability-configuration.js';
import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
import {
  assertExactMethodNamespace,
  localAppError,
} from './local-app-runtime-platform-validation.js';

export type NimiLocalAppAgentAutonomyMode = 'off' | 'low' | 'medium' | 'high';
export type NimiLocalAppAgentPresentationBackendKind = 'vrm' | 'live2d' | 'sprite2d' | 'canvas2d' | 'video';
export type NimiLocalAppRevision = string;

export interface NimiLocalAppTimestamp {
  readonly seconds: string;
  readonly nanos: number;
}

export interface NimiLocalAppDuration {
  readonly seconds: string;
  readonly nanos: number;
}

export interface NimiLocalAppSharedLocalAgentAIProfilePreview {
  readonly source: NimiPortableAIProfile;
  readonly before: NimiCapabilityAIConfig | null;
  readonly after: NimiCapabilityAIConfig;
  readonly identical: boolean;
}

export interface NimiLocalAppSharedLocalAgentAIConfigClient {
  get(): Promise<NimiCapabilityAIConfig>;
  overwrite(capabilities: readonly NimiCapabilityAIConfigIntent[]): Promise<NimiCapabilityAIConfig>;
}

export interface NimiLocalAppSharedLocalAgentAIProfileClient {
  preview(profile: NimiPortableAIProfileInput): Promise<NimiLocalAppSharedLocalAgentAIProfilePreview>;
  apply(profile: NimiPortableAIProfileInput): Promise<NimiCapabilityAIConfig>;
}

export interface NimiLocalAppAgentAutonomyConfig {
  readonly dailyTokenBudget: number;
  readonly maxTokensPerHook: number;
  readonly minHookInterval?: NimiLocalAppDuration;
  readonly suspendUntil?: NimiLocalAppTimestamp;
  readonly mode: NimiLocalAppAgentAutonomyMode;
}

export interface NimiLocalAppAgentAutonomyProjection {
  readonly enabled: boolean;
  readonly config: NimiLocalAppAgentAutonomyConfig | null;
  readonly usedTokensInWindow: number;
  readonly windowStartedAt?: NimiLocalAppTimestamp;
  readonly budgetExhausted: boolean;
  readonly suspendedUntil?: NimiLocalAppTimestamp;
  readonly autonomyRevision: NimiLocalAppRevision;
}

export interface NimiLocalAppAgentAutonomyIntent {
  readonly enabled?: boolean;
  readonly config?: NimiLocalAppAgentAutonomyConfig;
}

export interface NimiLocalAppAgentPresentationProfile {
  readonly backendKind: NimiLocalAppAgentPresentationBackendKind;
  readonly avatarAssetRef: string;
  readonly expressionProfileRef: string;
  readonly idlePreset: string;
  readonly interactionPolicyRef: string;
  readonly defaultVoiceReference: string;
  readonly avatarAutoplay: boolean;
  readonly backgroundAssetRef: string;
  readonly revision: NimiLocalAppRevision;
}

export interface NimiLocalAppAgentPresentationProjection {
  readonly profile: NimiLocalAppAgentPresentationProfile | null;
  readonly previousProfile: NimiLocalAppAgentPresentationProfile | null;
  readonly defaultVoiceReference: string;
  readonly presentationRevision: NimiLocalAppRevision;
}

export interface NimiLocalAppAgentPresentationAssetMaterial {
  readonly role: 'avatar' | 'background';
  readonly fileName: string;
  readonly mediaType: string;
  readonly content: Uint8Array;
  readonly sha256: string;
}

export interface NimiLocalAppAgentPresentationIntent {
  readonly backendKind: NimiLocalAppAgentPresentationBackendKind;
  readonly avatarAssetRef: string;
  readonly expressionProfileRef: string;
  readonly idlePreset: string;
  readonly interactionPolicyRef: string;
  readonly defaultVoiceReference: string;
  readonly avatarAutoplay: boolean;
  readonly backgroundAssetRef: string;
}

export interface NimiLocalAppAgentScopedInput {
  readonly agentHandle: NimiLocalAppAgentHandle;
}

export type NimiLocalAppAutonomySnapshotInput = NimiLocalAppAgentScopedInput;
export interface NimiLocalAppUpdateAutonomyInput extends NimiLocalAppAgentScopedInput {
  readonly expectedAutonomyRevision: NimiLocalAppRevision;
  readonly intent: NimiLocalAppAgentAutonomyIntent;
}
export type NimiLocalAppPresentationSnapshotInput = NimiLocalAppAgentScopedInput;
export interface NimiLocalAppCommitPresentationInput extends NimiLocalAppAgentScopedInput {
  readonly expectedPresentationRevision: NimiLocalAppRevision;
  readonly intent: NimiLocalAppAgentPresentationIntent;
  readonly importedAssets: readonly NimiLocalAppAgentPresentationAssetMaterial[];
}

export type NimiLocalAppAutonomyUpdateResult = {
  readonly outcome: 'updated';
  readonly projection: NimiLocalAppAgentAutonomyProjection;
};

export type NimiLocalAppPresentationCommitResult = {
  readonly outcome: 'committed';
  readonly projection: NimiLocalAppAgentPresentationProjection;
};

export interface NimiLocalAppAgentConfigureShell {
  sharedAgentAIConfigGet(): Promise<unknown>;
  sharedAgentAIConfigOverwrite(capabilities: readonly NimiCapabilityAIConfigIntent[]): Promise<unknown>;
  sharedAgentAIProfilePreview(profileJson: string): Promise<unknown>;
  sharedAgentAIProfileApply(profileJson: string): Promise<unknown>;
  autonomySnapshot(input: { readonly agentHandle: string }): Promise<unknown>;
  updateAutonomy(input: {
    readonly agentHandle: string;
    readonly expectedAutonomyRevision: string;
    readonly intent: NimiLocalAppAgentAutonomyIntent;
  }): Promise<unknown>;
  presentationSnapshot(input: { readonly agentHandle: string }): Promise<unknown>;
  commitPresentation(input: {
    readonly agentHandle: string;
    readonly expectedPresentationRevision: string;
    readonly intent: NimiLocalAppAgentPresentationIntent;
    readonly importedAssets: readonly NimiLocalAppAgentPresentationAssetMaterial[];
  }): Promise<unknown>;
}

export interface NimiLocalAppAgentConfigureClient {
  readonly sharedAIConfig: NimiLocalAppSharedLocalAgentAIConfigClient;
  readonly sharedAIProfile: NimiLocalAppSharedLocalAgentAIProfileClient;
  autonomySnapshot(input: NimiLocalAppAutonomySnapshotInput): Promise<NimiLocalAppAgentAutonomyProjection>;
  updateAutonomy(input: NimiLocalAppUpdateAutonomyInput): Promise<NimiLocalAppAutonomyUpdateResult>;
  presentationSnapshot(input: NimiLocalAppPresentationSnapshotInput): Promise<NimiLocalAppAgentPresentationProjection>;
  commitPresentation(input: NimiLocalAppCommitPresentationInput): Promise<NimiLocalAppPresentationCommitResult>;
}

const CONFIGURE_METHODS = [
  'sharedAgentAIConfigGet',
  'sharedAgentAIConfigOverwrite',
  'sharedAgentAIProfilePreview',
  'sharedAgentAIProfileApply',
  'autonomySnapshot',
  'updateAutonomy',
  'presentationSnapshot',
  'commitPresentation',
] as const;

export function createNimiLocalAppAgentConfigureClient(
  shell: NimiLocalAppAgentConfigureShell,
): NimiLocalAppAgentConfigureClient {
  assertExactMethodNamespace(shell, CONFIGURE_METHODS, 'agentConfigure');
  return createUnavailableNimiLocalAppAgentConfigureClient();
}

export function createUnavailableNimiLocalAppAgentConfigureClient(): NimiLocalAppAgentConfigureClient {
  const unavailable = async (): Promise<never> => protectedAppAccessUnavailable();
  return Object.freeze({
    sharedAIConfig: Object.freeze({ get: unavailable, overwrite: unavailable }),
    sharedAIProfile: Object.freeze({ preview: unavailable, apply: unavailable }),
    autonomySnapshot: unavailable,
    updateAutonomy: unavailable,
    presentationSnapshot: unavailable,
    commitPresentation: unavailable,
  });
}

function protectedAppAccessUnavailable(): never {
  return localAppError(
    'Protected App operations are unavailable until Runtime establishes a fresh App Access session.',
    'SDK_LOCAL_APP_ACCESS_UNAVAILABLE',
    'retry_after_protected_session_establishment',
  );
}
