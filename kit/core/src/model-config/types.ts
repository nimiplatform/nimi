// kit/core/model-config types.
//
// Authority:
//   - D-AIPC-001..012 NimiAIProfile / NimiAIConfig / AISnapshot
//   - P-CAPCAT-001..003 canonical capability identity
//   - P-KIT-043 pure-logic boundary for kit/core
//
// This module is renderer-safe and runtime-safe: zero React, CSS, Node, Tauri,
// Electron, or app imports. Consumers bind NimiAIConfig persistence through the
// shared service interface; kit does not own NimiAIConfig / NimiAIProfile truth.

import type {
  NimiAIConfig,
  NimiAIConfigSetupProjection,
  NimiAIConfigTargetRef,
  NimiAIProfile,
  NimiAIProfileApplyOptions,
  NimiAIProfileApplyResult,
  NimiAIProfilePreviewOptions,
  NimiAIProfilePreviewResult,
  NimiAIProfileOriginRef,
  NimiAICapabilityRequirementDeclaration,
  NimiAICapabilityRequirementSlice,
  NimiAIScopeRef,
  NimiJsonValue,
  NimiRuntimeSpeechVoiceReference,
} from '@nimiplatform/kit/core/sdk-contract';
import type {
  CanonicalCapabilityDescriptor,
} from '@nimiplatform/kit/core/runtime-capabilities';

// ---------------------------------------------------------------------------
// SharedAIConfigService — host-owned NimiAIConfig persistence seam.
//
// The kit never persists NimiAIConfig locally. Consumers inject a service that
// already honours D-AIPC-003 / D-AIPC-005 / D-AIPC-011 host ownership rules.
// ---------------------------------------------------------------------------

export type SharedAIConfigUnsubscribe = () => void;

export type SharedAIConfigSubscribeListener = (config: NimiAIConfig) => void;

export interface SharedAIConfigService {
  readonly aiConfig: {
    get(scopeRef: NimiAIScopeRef): NimiAIConfig;
    update(scopeRef: NimiAIScopeRef, next: NimiAIConfig): void;
    subscribe(scopeRef: NimiAIScopeRef, listener: SharedAIConfigSubscribeListener): SharedAIConfigUnsubscribe;
  };
  readonly aiProfile: {
    list(): Promise<NimiAIProfile[]>;
    /**
     * D-AIPC-014 / S-AICONF-008 non-committing apply preview. Computes the
     * typed before→after NimiAIConfig diff without mutating live config. The kit
     * apply flow gates `apply` behind an explicit confirm of this preview.
     */
    previewApply(
      scopeRef: NimiAIScopeRef,
      profileId: string,
      options: NimiAIProfilePreviewOptions,
    ): Promise<NimiAIProfilePreviewResult>;
    apply(
      scopeRef: NimiAIScopeRef,
      profileId: string,
      options: NimiAIProfileApplyOptions,
    ): Promise<NimiAIProfileApplyResult>;
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

export type ModelConfigTargetRef = NimiAIConfigTargetRef;

export interface ModelConfigBindingSummary {
  readonly label: string;
  readonly detail: string | null;
}

export interface ModelConfigCapabilityPatch {
  readonly targetRef?: ModelConfigTargetRef | null;
  readonly params?: NimiJsonValue;
}

export interface ModelConfigBindingSnapshot {
  readonly capabilityId: string;
  readonly targetRef: ModelConfigTargetRef | null;
  readonly params?: NimiJsonValue;
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
  readonly kind: string;
  readonly engine: string;
  readonly status: string;
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
    value: NimiRuntimeSpeechVoiceReference;
    label: string;
    targetRef?: ModelConfigTargetRef;
  }>;
}

export interface AppModelConfigSurface {
  readonly scopeRef: NimiAIScopeRef;
  readonly aiConfigService: SharedAIConfigService;
  readonly requirementDeclaration: NimiAICapabilityRequirementDeclaration;
  readonly providerResolver: ModelConfigProviderResolver;
  readonly projectionResolver: ModelConfigProjectionResolver;
  readonly localAssetSource?: ModelConfigLocalAssetSource;
  readonly capabilityOverrides?: Readonly<Record<string, CapabilityItemOverride>>;
  readonly runtimeNotReadyLabel?: string;
  readonly i18n: ModelConfigI18nBinding;
}

export interface ModelConfigRequirementEvaluation {
  readonly capabilityId: string;
  readonly requirementSlice: NimiAICapabilityRequirementSlice;
  readonly descriptor: CanonicalCapabilityDescriptor;
  readonly targetRef: ModelConfigTargetRef | null;
  readonly setupProjection: NimiAIConfigSetupProjection | null;
  readonly editableFieldRefs: ReadonlyArray<string>;
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
 * kit/features implements this by calling through `SharedAIConfigService`.
 * Failed host apply calls fail closed; Kit does not locally materialize or
 * commit a substitute config.
 */
export type ModelConfigProfileApplyPath =
  | { kind: 'remote-success'; nextConfig: NimiAIConfig; profileOrigin: NimiAIProfileOriginRef | null }
  | { kind: 'remote-fail-without-user-profile'; failureReason: string }
  | { kind: 'network-error'; failureReason: string };

export interface ModelConfigProfileControllerCoreInput {
  readonly scopeRef: NimiAIScopeRef;
  readonly service: SharedAIConfigService;
  readonly userProfilesSource?: UserProfilesSource;
}

export interface UserProfilesSource {
  list(): ReadonlyArray<NimiAIProfile>;
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
 * Pure-logic projection of an `NimiAIProfilePreviewResult` into a displayable
 * shape for the preview→confirm step. Holds no live config truth.
 */
export interface ModelConfigPreviewState {
  readonly profileId: string;
  /** True for a first apply (scope had no NimiAIConfig); diff is full creation. */
  readonly isFirstApply: boolean;
  /** True when before and after are equivalent (apply would be a no-op). */
  readonly identical: boolean;
  readonly rows: ReadonlyArray<ModelConfigDiffRow>;
  /** CAS freshness token of the previewed base config (D-AIPC-014). */
  readonly baseVersion: string;
  /** Typed availability / feasibility warnings carried by the preview. */
  readonly probeWarnings: ReadonlyArray<string>;
  /** The full preview result, retained so the caller can commit afterwards. */
  readonly preview: NimiAIProfilePreviewResult;
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
