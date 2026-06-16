// Wave 0 of topic 2026-04-30-avatar-vrm-backend-branch admit (design-02).
//
// Multi-backend BackendBranch carrier abstraction. Wave 0 admits the type
// surface; full BackendBranch factory + per-backend implementations land in
// topic-internal wave_1 (= feature-matrix v3 wave_6).
//
// Spec authority: .nimi/spec/avatar/kernel/backend-branch-contract.md
// Drift rule: type definitions here MUST stay in sync with that contract.

import type { ComponentType } from 'react';

export type BackendKind = 'live2d' | 'vrm';

export type BackendNominalBounds = {
  width: number;
  height: number;
  /** 0..1 normalized within nominal viewport */
  bodyCenterX: number;
  /** 0..1 normalized within nominal viewport */
  bodyCenterY: number;
};

export type BackendHitRegion = {
  /** viewport-normalized rect 0..1; OS-level ignore_cursor_events bbox fallback */
  body: { left: number; top: number; right: number; bottom: number };
  /** drag-allowed bbox (companion / degraded surface 区域不开启 drag) */
  drag: { left: number; top: number; right: number; bottom: number };
  /** Precise alpha-mask hit query (pixel-level click-through). Non-null
   *  takes priority over bbox; a null function indicates the backend exposes
   *  only the bbox path, while a null return indicates this frame's probe is
   *  unavailable and the caller must fall back to bbox. */
  isOpaqueAtClientPoint:
    | ((clientX: number, clientY: number, threshold?: number) => boolean | null)
    | null;
};

export interface WLipSyncSnapshot {
  /** 6-dim AEIOUS weights from wLipSync worklet output (per-frame) */
  weights: Record<'A' | 'E' | 'I' | 'O' | 'U' | 'S', number>;
  /** node.volume reading at snapshot time */
  volume: number;
}

export interface BackendAudioConsumer {
  /** AudioPipeline calls after source.start(); first call lazy-creates the
   *  per-AudioContext wLipSyncNode (async; package-internal worklet/WASM load).
   *  Same source MAY be attached to multiple sinks across backend swaps. */
  attachAudioSource(source: AudioBufferSourceNode, audioContext: AudioContext): Promise<void>;
  /** Sink swap / backend swap / shutdown. Synchronous; only disconnects
   *  source ↔ wLipSyncNode wiring. Does NOT zero the mouth (caller invokes
   *  silent() if behavior needs to follow). */
  detachAudioSource(): void;
  /** Force mouth weights to zero. Called for synthetic / fail / interrupt.
   *  Mutually exclusive in semantics with detachAudioSource (detach is
   *  connection management; silent is render-state). */
  silent(): void;
  /** Per-frame snapshot drained by the surface useFrame loop. Returns null
   *  when no source is attached or after detach (lipsync driver decays). */
  snapshot(): WLipSyncSnapshot | null;
}

export type BackendProjection = {
  /** Ontology-level activity (no Live2D parameter id). intensity ∈ [0,1] | null. */
  applyActivity(input: { name: string; intensity: number | null }): void;
  applyEmotion(input: { current: string; previous: string | null }): void;
  applyMotion(input: { routeId: string; fade?: number; loop?: boolean }): void;
  applyExpression(input: { name: string; weight?: number; fade?: number }): void;
  reset(): void;
};

/** Live2D-only escape hatch. NAS handlers wishing to setParameter MUST
 *  declare requires: ['live2d-extension'] in the handler manifest; the
 *  registry rejects mismatched handlers when the loaded model is VRM. */
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

/** Discriminated union — kind narrowing exposes Live2D-only escape hatch. */
export type BackendBranch =
  | (BackendBranchBase & { kind: 'live2d'; live2dExtension: Live2DBackendExtension })
  | (BackendBranchBase & { kind: 'vrm' });
