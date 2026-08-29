export enum AvatarDebugProbeKind {
  UNSPECIFIED = 0,
  PACKAGE_VALIDATION = 1,
  LAUNCH_READINESS = 2,
  BACKEND_LOAD = 3,
  CAPABILITY_PROFILE = 4,
  ROUTE_SUPPORT_MATRIX = 5,
  GENERATED_MOTION = 6,
  EMOTION_EXPRESSION = 7,
  SPEECH_LIPSYNC = 8,
  WINDOW_HIT_REGION = 9,
}

export enum AvatarDebugProbeStatus {
  UNSPECIFIED = 0,
  PASSED = 1,
  FAILED = 2,
  UNSUPPORTED = 3,
  BLOCKED = 4,
  INVALID = 5,
}

export type AvatarDebugTimestamp = Readonly<{ seconds: string; nanos: number }>;

export type AvatarDebugProbeResult = Readonly<{
  probeId: string;
  probeKind: AvatarDebugProbeKind;
  status: AvatarDebugProbeStatus;
  observedAt: AvatarDebugTimestamp;
  evidenceRefs: readonly string[];
  reasonCode: string;
  resultId: string;
}>;

export type AvatarDebugReplayRef = Readonly<{
  probeId: string;
  replayRef: string;
  redactionState: 'redacted' | 'visible' | 'forbidden';
  visibility: 'avatar-debug';
  linkedAt: AvatarDebugTimestamp;
}>;

export type AvatarDebugSnapshot = Readonly<{
  probeResults: readonly AvatarDebugProbeResult[];
  replayRefs: readonly AvatarDebugReplayRef[];
  observedAt: AvatarDebugTimestamp;
}>;

export type AvatarDebugCallOptions = Readonly<{
  signal?: AbortSignal;
  timeoutMs?: number;
}>;

export type AvatarDebugFacade = Readonly<{
  snapshot(options?: AvatarDebugCallOptions): Promise<AvatarDebugSnapshot>;
  requestProbe(input: Readonly<{
    probeKind: AvatarDebugProbeKind;
    avatarInstanceId?: string | null;
  }>, options?: AvatarDebugCallOptions): Promise<AvatarDebugProbeResult>;
}>;

export function avatarDebugTimestamp(now = Date.now()): AvatarDebugTimestamp {
  return Object.freeze({
    seconds: String(Math.floor(now / 1000)),
    nanos: Math.floor(now % 1000) * 1_000_000,
  });
}
