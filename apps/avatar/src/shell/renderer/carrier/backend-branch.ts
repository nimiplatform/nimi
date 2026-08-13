import type { ComponentType } from 'react';
import type {
  BackendAudioConsumer,
  BackendHitRegion,
  BackendNominalBounds,
} from '@nimiplatform/kit/features/avatar/headless';

export type BackendProjection = {
  applyActivity(input: { name: string; intensity: number | null }): void;
  applyEmotion(input: { current: string; previous: string | null }): void;
  applyMotion(input: { routeId: string; fade?: number; loop?: boolean }): void;
  applyExpression(input: { name: string; weight?: number; fade?: number }): void;
  reset(): void;
};

export type Live2DBackendExtension = {
  setParameter(id: string, value: number, durationSec?: number): void;
};

export type BackendMetadata = Record<string, unknown>;

export type BackendSurfaceProps = {
  width: number;
  height: number;
  embodied: boolean;
  onHitRegionChange?: (region: BackendHitRegion) => void;
  onAudioConsumerReady?: (consumer: BackendAudioConsumer) => void;
};

export type BackendSurface = {
  Component: ComponentType<BackendSurfaceProps>;
};

export type BackendBranchBase = {
  nominalBounds: BackendNominalBounds;
  projection: BackendProjection;
  surface: BackendSurface;
  metadata(): BackendMetadata;
  shutdown(): void;
};

// @nimi-authority: definition.nimi.avatar.embodiment.backend-branch
export type BackendBranch =
  | (BackendBranchBase & { kind: 'live2d'; live2dExtension: Live2DBackendExtension })
  | (BackendBranchBase & { kind: 'vrm' });
