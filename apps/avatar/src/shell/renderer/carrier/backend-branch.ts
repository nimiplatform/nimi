import type { ComponentType } from 'react';
import type {
  BackendAudioConsumer,
  BackendHitRegion,
  BackendNominalBounds,
  Live2DCompatibilityTier,
} from '@nimiplatform/kit/features/avatar/headless';
import type { VrmCapabilityProfile } from '../vrm/vrm-capability-profile.js';

export type BackendActivityProjectionSettlement = 'applied' | 'unsupported' | 'canceled';

export type BackendPendingActivityProjectionResult = Readonly<{
  status: 'pending';
  completion: Promise<BackendActivityProjectionSettlement>;
}>;

export type BackendActivityProjectionResult =
  | Exclude<BackendActivityProjectionSettlement, 'canceled'>
  | BackendPendingActivityProjectionResult;

export type BackendProjection = {
  applyActivity(input: { name: string; intensity: number | null }): BackendActivityProjectionResult;
  applyEmotion(input: { current: string; previous: string | null }): void;
  applyMotion(input: { routeId: string; fade?: number; loop?: boolean }): void;
  applyExpression(input: { name: string; weight?: number; fade?: number }): void;
  reset(): void;
};

export type Live2DBackendExtension = {
  setParameter(id: string, value: number, durationSec?: number): void;
};

export type BackendMetadata = Record<string, unknown>;

export type BackendPresentationState =
  | Readonly<{ kind: 'loading' }>
  | Readonly<{ kind: 'recovering' }>
  | Readonly<{ kind: 'ready' }>
  | Readonly<{ kind: 'unavailable'; reason: string }>;

export type BackendSurfaceBounds = Readonly<{
  bounds: BackendNominalBounds;
  source: 'scene_geometry' | 'configured_fallback';
  reasonCode: string | null;
}>;

export type AvatarBackendDebugFacts =
  | Readonly<{
      kind: 'vrm';
      capabilityProfile: VrmCapabilityProfile | null;
      lipsyncProfilePresent: boolean;
      hitRegionPublished: boolean;
    }>
  | Readonly<{
      kind: 'live2d';
      sessionLoaded: boolean;
      capabilityProfile: Readonly<{
        profileId: string;
        tier: Live2DCompatibilityTier;
        adapterId: string | null;
      }> | null;
      emotionExpressionSupported: boolean;
      expressionInventoryRef: string | null;
      lipsyncProfilePresent: boolean;
      mouthParameterPresent: boolean;
      hitRegionPublished: boolean;
    }>;

export type BackendSurfaceProps = {
  width: number;
  height: number;
  embodied: boolean;
  /** App stage always supplies this; direct backend harnesses default false. */
  reducedMotion?: boolean;
  onHitRegionChange?: (region: BackendHitRegion) => void;
  onAudioConsumerReady?: (consumer: BackendAudioConsumer) => void;
  /** Avatar-local presentation observation. Never crosses to Desktop or Runtime. */
  onPresentationStateChange?: (state: BackendPresentationState) => void;
  /** Rebuilds the current validated presentation after backend-local recovery is exhausted. */
  onPresentationRestart?: () => void;
  /** Current validated geometry or the explicitly configured bounded fallback. */
  onSurfaceBoundsChange?: (surface: BackendSurfaceBounds) => void;
};

export type BackendSurface = {
  Component: ComponentType<BackendSurfaceProps>;
};

export type BackendBranchBase = {
  nominalBounds: BackendNominalBounds;
  projection: BackendProjection;
  surface: BackendSurface;
  metadata(): BackendMetadata;
  /** Bounded Avatar-owned facts for the owner debug-session projection. */
  debugFacts?(): AvatarBackendDebugFacts;
  shutdown(): void;
};

// @nimi-authority: definition.nimi.avatar.embodiment.backend-branch
export type BackendBranch =
  | (BackendBranchBase & { kind: 'live2d'; live2dExtension: Live2DBackendExtension })
  | (BackendBranchBase & { kind: 'vrm' });
