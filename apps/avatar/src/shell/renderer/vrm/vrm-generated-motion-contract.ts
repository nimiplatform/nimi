export type VrmGeneratedRouteId =
  | 'idle_subtle'
  | 'listen_lean'
  | 'nod_yes'
  | 'shake_no'
  | 'greet_wave';

export const VRM_GENERATED_ROUTE_IDS: readonly VrmGeneratedRouteId[] = Object.freeze([
  'idle_subtle',
  'listen_lean',
  'nod_yes',
  'shake_no',
  'greet_wave',
]);

export const GENERATED_MOTION_MAX_ROTATION_RAD = 1.2;

export type GeneratedMotionReasonCode =
  | 'unsupported_capability'
  | 'unsafe_pose'
  | 'mapping_confidence_below_threshold'
  | 'mapping_unconfirmed'
  | 'missing_profile'
  | 'missing_route'
  | 'invalid_runtime_projection';

export type GeneratedMotionEvidence = {
  routeId: string;
  providerKind: string;
  reasonCode?: GeneratedMotionReasonCode;
};

export type VrmGeneratedMotionProviderInput<TVrm = unknown> = {
  vrm: TVrm;
  routeId: string;
  intensity: number | null;
  loop: boolean;
};

export type VrmGeneratedMotionProviderResult<TClip = unknown> =
  | { status: 'ok'; clip: TClip; routeId: string; evidence: GeneratedMotionEvidence }
  | {
      status: 'fail_closed';
      routeId: string;
      reasonCode: GeneratedMotionReasonCode;
      evidence: GeneratedMotionEvidence;
    };

export interface VrmGeneratedMotionProvider<TVrm = unknown, TClip = unknown> {
  generate(input: VrmGeneratedMotionProviderInput<TVrm>): VrmGeneratedMotionProviderResult<TClip>;
}

export type PlayGeneratedMotionInput = {
  routeId: string;
  fade?: number;
  loop?: boolean;
  intensity?: number | null;
};

export type PlayGeneratedMotionResult =
  | { played: true; evidence: GeneratedMotionEvidence }
  | { played: false; reason: string; evidence: GeneratedMotionEvidence };

export type GeneratedMotionRuntimeSnapshot = {
  attached: boolean;
  activeRouteId: string | null;
  fadeRemainingSec: number;
};

export interface VrmGeneratedMotionRuntime<TVrm = unknown> {
  attach(vrm: TVrm): void;
  play(input: PlayGeneratedMotionInput): PlayGeneratedMotionResult;
  stopAll(): void;
  tick(deltaSec: number): void;
  snapshot(): GeneratedMotionRuntimeSnapshot;
  dispose(): void;
}

export function isVrmGeneratedRouteId(routeId: string): routeId is VrmGeneratedRouteId {
  return (VRM_GENERATED_ROUTE_IDS as readonly string[]).includes(routeId);
}
