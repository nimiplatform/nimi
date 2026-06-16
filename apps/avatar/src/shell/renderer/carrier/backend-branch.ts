import type { ComponentType } from 'react';

export type BackendKind = 'live2d' | 'vrm';

export type BackendNominalBounds = {
  width: number;
  height: number;
  bodyCenterX: number;
  bodyCenterY: number;
};

export type BackendHitRegion = {
  body: { left: number; top: number; right: number; bottom: number };
  drag: { left: number; top: number; right: number; bottom: number };
  isOpaqueAtClientPoint:
    | ((clientX: number, clientY: number, threshold?: number) => boolean | null)
    | null;
};

export interface WLipSyncSnapshot {
  weights: Record<'A' | 'E' | 'I' | 'O' | 'U' | 'S', number>;
  volume: number;
}

export interface BackendAudioConsumer {
  attachAudioSource(source: AudioBufferSourceNode, audioContext: AudioContext): Promise<void>;
  detachAudioSource(): void;
  silent(): void;
  snapshot(): WLipSyncSnapshot | null;
}

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
  onLifecycleEvidence?: (kind: string, detail: Record<string, unknown>) => void;
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

export type BackendBranch =
  | (BackendBranchBase & { kind: 'live2d'; live2dExtension: Live2DBackendExtension })
  | (BackendBranchBase & { kind: 'vrm' });
