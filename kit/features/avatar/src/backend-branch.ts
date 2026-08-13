// Shared structural carriers used by Avatar helpers. Avatar owns concrete
// backend composition and presentation behavior.

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
