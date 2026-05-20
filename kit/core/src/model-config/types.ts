// kit/core/model-config types.
//
// Authority:
//   - D-AIPC-001..012 AIProfile / AIConfig / AISnapshot
//   - P-CAPCAT-001..003 canonical capability identity
//   - P-KIT-043 pure-logic boundary for kit/core
//
// This module is renderer-safe and runtime-safe: zero React, CSS, Node, Tauri,
// Electron, or app imports. Consumers bind AIConfig persistence through the
// shared service interface; kit does not own AIConfig / AIProfile truth.

import type {
  AIConfig,
  AIProfile,
  AIProfileApplyResult,
  AIProfilePreviewResult,
  AIProfileRef,
  AIScopeRef,
} from '@nimiplatform/sdk/mod';
import type { SpeechVoiceReference } from '@nimiplatform/sdk/runtime';
import type {
  CanonicalCapabilityDescriptor,
} from '@nimiplatform/nimi-kit/core/runtime-capabilities';

// ---------------------------------------------------------------------------
// SharedAIConfigService — host-owned AIConfig persistence seam.
//
// The kit never persists AIConfig locally. Consumers inject a service that
// already honours D-AIPC-003 / D-AIPC-005 / D-AIPC-011 host ownership rules.
// ---------------------------------------------------------------------------

export type SharedAIConfigUnsubscribe = () => void;

export type SharedAIConfigSubscribeListener = (config: AIConfig) => void;

export interface SharedAIConfigService {
  readonly aiConfig: {
    get(scopeRef: AIScopeRef): AIConfig;
    update(scopeRef: AIScopeRef, next: AIConfig): void;
    subscribe(scopeRef: AIScopeRef, listener: SharedAIConfigSubscribeListener): SharedAIConfigUnsubscribe;
  };
  readonly aiProfile: {
    list(): Promise<AIProfile[]>;
    /**
     * D-AIPC-014 / S-AICONF-008 non-committing apply preview. Computes the
     * typed before→after AIConfig diff without mutating live config. The kit
     * apply flow gates `apply` behind an explicit confirm of this preview.
     */
    previewApply(scopeRef: AIScopeRef, profileId: string): Promise<AIProfilePreviewResult>;
    apply(scopeRef: AIScopeRef, profileId: string): Promise<AIProfileApplyResult>;
  };
}

// ---------------------------------------------------------------------------
// AppModelConfigSurface — the sole consumer-injection contract for the hub.
// ---------------------------------------------------------------------------

export type ModelConfigI18nFormatter = (
  key: string,
  vars?: Readonly<Record<string, string | number>>,
) => string;

export interface ModelConfigI18nBinding {
  readonly t: ModelConfigI18nFormatter;
}

export type ModelConfigRouteSource = 'local' | 'cloud';

export interface ModelConfigBindingSnapshot {
  readonly source: ModelConfigRouteSource;
  readonly connectorId: string;
  readonly model: string;
  readonly modelLabel?: string | null;
  readonly localModelId?: string | null;
}

export type ModelConfigStatusTone = 'ready' | 'attention' | 'neutral';

export interface ModelConfigProjectionStatus {
  readonly supported: boolean;
  readonly tone?: ModelConfigStatusTone;
  readonly badgeLabel?: string;
  readonly title?: string;
  readonly detail?: string | null;
}

export interface ModelConfigLocalAssetDescriptor {
  readonly localAssetId: string;
  readonly assetId: string;
  readonly kind: number;
  readonly engine: string;
  readonly status: number;
}

export interface ModelConfigLocalAssetSource {
  list(): ReadonlyArray<ModelConfigLocalAssetDescriptor>;
  readonly loading: boolean;
}

export interface ModelConfigRouteProviderHandle {
  readonly __routeProviderBrand: 'route-provider';
}

export type ModelConfigProviderResolver = (
  routeCapability: string,
) => ModelConfigRouteProviderHandle | unknown | null;

export type ModelConfigProjectionResolver = (
  capabilityId: string,
) => ModelConfigProjectionStatus | null;

export interface CapabilityItemOverride {
  readonly showClearButton?: boolean;
  readonly clearSelectionLabel?: string;
  readonly showEditorWhen?: 'always' | 'local';
  readonly placeholder?: string;
  readonly detail?: string;
  readonly disabled?: boolean;
  readonly audioSynthesizeVoiceOptions?: ReadonlyArray<{
    value: SpeechVoiceReference;
    label: string;
    binding?: {
      source: ModelConfigRouteSource;
      connectorId: string;
      model: string;
      modelId?: string;
      modelLabel?: string;
      localModelId?: string;
      provider?: string;
      engine?: string;
    };
  }>;
}

export interface AppModelConfigSurface {
  readonly scopeRef: AIScopeRef;
  readonly aiConfigService: SharedAIConfigService;
  readonly enabledCapabilities: ReadonlyArray<string>;
  readonly providerResolver: ModelConfigProviderResolver;
  readonly projectionResolver: ModelConfigProjectionResolver;
  readonly localAssetSource?: ModelConfigLocalAssetSource;
  readonly capabilityOverrides?: Readonly<Record<string, CapabilityItemOverride>>;
  readonly runtimeReady: boolean;
  readonly runtimeNotReadyLabel?: string;
  readonly i18n: ModelConfigI18nBinding;
}

// ---------------------------------------------------------------------------
// Profile controller pure-logic shape.
// ---------------------------------------------------------------------------

export interface ModelConfigProfileCopyCore {
  readonly sectionTitle: string;
  readonly summaryLabel: string;
  readonly emptySummaryLabel: string;
  readonly applyButtonLabel: string;
  readonly changeButtonLabel: string;
  readonly manageButtonTitle: string;
  readonly modalTitle: string;
  readonly modalHint: string;
  readonly loadingLabel: string;
  readonly emptyLabel: string;
  readonly currentBadgeLabel: string;
  readonly cancelLabel: string;
  readonly confirmLabel: string;
  readonly applyingLabel: string;
  readonly reloadLabel?: string;
  readonly importLabel?: string;
}

export interface ModelConfigProfileOption {
  readonly profileId: string;
  readonly title: string;
  readonly description?: string;
}

export interface ModelConfigProfileOriginRef {
  readonly profileId: string;
  readonly title?: string | null;
}

/**
 * Strategy injected into the pure-logic controller core. The react hook in
 * kit/features implements this by calling through `SharedAIConfigService` and
 * optional user-profile fallback (D-AIPC-005 atomic overwrite).
 */
export type ModelConfigProfileApplyPath =
  | { kind: 'remote-success'; nextConfig: AIConfig; profileOrigin: AIProfileRef | null }
  | { kind: 'remote-fail-with-user-profile'; nextConfig: AIConfig; profileOrigin: AIProfileRef | null }
  | { kind: 'remote-fail-without-user-profile'; failureReason: string }
  | { kind: 'network-error'; failureReason: string };

export interface ModelConfigProfileControllerCoreInput {
  readonly scopeRef: AIScopeRef;
  readonly service: SharedAIConfigService;
  readonly userProfilesSource?: UserProfilesSource;
}

export interface UserProfilesSource {
  list(): ReadonlyArray<AIProfile>;
}

export interface ResolveApplyPathInput {
  readonly profileId: string;
  readonly remoteResult: AIProfileApplyResult;
  readonly currentConfigProvider: () => AIConfig;
  readonly applyLocally: (config: AIConfig, profile: AIProfile) => AIConfig;
}

export interface ResolveApplyPathNetworkErrorInput {
  readonly profileId: string;
  readonly error: unknown;
}

// ---------------------------------------------------------------------------
// Profile apply preview (D-AIPC-014 / S-AICONF-008).
// ---------------------------------------------------------------------------

/**
 * A single human-readable before→after row projected from one AIConfigDiff
 * field change. Pure-logic projection; no React or formatting concerns.
 */
export interface ModelConfigDiffRow {
  readonly path: string;
  readonly changeKind: 'added' | 'removed' | 'changed';
  readonly beforeText: string;
  readonly afterText: string;
}

/**
 * Pure-logic projection of an `AIProfilePreviewResult` into a displayable
 * shape for the preview→confirm step. Holds no live config truth.
 */
export interface ModelConfigPreviewState {
  readonly profileId: string;
  /** True for a first apply (scope had no AIConfig); diff is full creation. */
  readonly isFirstApply: boolean;
  /** True when before and after are equivalent (apply would be a no-op). */
  readonly identical: boolean;
  readonly rows: ReadonlyArray<ModelConfigDiffRow>;
  /** CAS freshness token of the previewed base config (D-AIPC-014). */
  readonly baseVersion: string;
  /** Typed availability / feasibility warnings carried by the preview. */
  readonly probeWarnings: ReadonlyArray<string>;
  /** The full preview result, retained so the caller can commit afterwards. */
  readonly preview: AIProfilePreviewResult;
}

// ---------------------------------------------------------------------------
// Aggregate summary output.
// ---------------------------------------------------------------------------

export interface AggregateCountsLabels {
  readonly ready: string;
  readonly attention: string;
  readonly neutral: string;
}

export interface AggregateSummary {
  readonly subtitle: string;
  readonly statusDot: ModelConfigStatusTone;
  readonly readyCount: number;
  readonly attentionCount: number;
  readonly neutralCount: number;
}

export interface CapabilityEvaluation {
  readonly capabilityId: string;
  readonly descriptor: CanonicalCapabilityDescriptor;
  readonly status: ModelConfigProjectionStatus | null;
  readonly bindingPresent: boolean;
}
