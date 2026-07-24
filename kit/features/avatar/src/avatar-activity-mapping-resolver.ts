// Activity-mapping resolver — exposes per-backend activity routing
// derived from `config/avatar-activity-mapping.yaml`
// v2 (multi-backend dual route).
//
// The YAML source remains the spec authority; this resolver is the Kit
// headless projection consumed by concrete avatar backends.
//
// Resolution rules from the canonical activity-mapping table:
//   - core ontology activities MUST have both live2d AND vrm routes;
//   - `ext:` and `mod-<modid>:` prefix activities are NOT in the table
//     and fail-close (resolver returns null + the caller emits a
//     diagnostic); no silent fallback to idle.

export type Live2DActivityRoute = {
  motionGroup: string;
  fallbackMotionGroup?: string;
};

export type VrmActivityRoute = {
  motion?: string;
  emotion?: string;
  expression?: string;
  fade?: number;
};

export type ActivityRoutes = {
  live2d: Live2DActivityRoute;
  vrm: VrmActivityRoute;
};

const ACTIVITY_ROUTES: Readonly<Record<string, ActivityRoutes>> = Object.freeze({
  // ── interaction (no intensity) ──
  greet: {
    live2d: { motionGroup: 'tap_body', fallbackMotionGroup: 'tap_head' },
    vrm: { motion: 'greet_wave', emotion: 'happy', fade: 0.25 },
  },
  farewell: {
    live2d: { motionGroup: 'tap_head' },
    vrm: { motion: 'idle_subtle', emotion: 'happy', fade: 0.3 },
  },
  agree: {
    live2d: { motionGroup: 'nod' },
    vrm: { motion: 'nod_yes', fade: 0.2 },
  },
  disagree: {
    live2d: { motionGroup: 'shake' },
    vrm: { motion: 'shake_no', fade: 0.2 },
  },
  listening: {
    live2d: { motionGroup: 'idle' },
    vrm: { motion: 'listen_lean', fade: 0.3 },
  },
  thinking: {
    live2d: { motionGroup: 'idle' },
    vrm: { motion: 'idle_subtle', fade: 0.4 },
  },

  // ── state ──
  idle: {
    live2d: { motionGroup: 'idle' },
    vrm: { motion: 'idle_subtle', fade: 0.5 },
  },
  celebrating: {
    live2d: { motionGroup: 'tap_body' },
    vrm: { motion: 'idle_subtle', emotion: 'excited', fade: 0.25 },
  },
  sleeping: {
    live2d: { motionGroup: 'idle' },
    vrm: { motion: 'idle_subtle', fade: 0.6 },
  },
  focused: {
    live2d: { motionGroup: 'idle' },
    vrm: { motion: 'idle_subtle', fade: 0.4 },
  },

  // ── emotion (intensity-supported) ──
  happy: {
    live2d: { motionGroup: 'tap_body' },
    vrm: { emotion: 'happy', fade: 0.4 },
  },
  sad: {
    live2d: { motionGroup: 'idle' },
    vrm: { emotion: 'sad', fade: 0.5 },
  },
  shy: {
    live2d: { motionGroup: 'idle' },
    vrm: { emotion: 'relaxed', fade: 0.5 },
  },
  angry: {
    live2d: { motionGroup: 'idle' },
    vrm: { emotion: 'angry', fade: 0.3 },
  },
  surprised: {
    live2d: { motionGroup: 'tap_head' },
    vrm: { emotion: 'surprised', fade: 0.15 },
  },
  confused: {
    live2d: { motionGroup: 'idle' },
    vrm: { emotion: 'relaxed', fade: 0.4 },
  },
  excited: {
    live2d: { motionGroup: 'tap_body' },
    vrm: { motion: 'idle_subtle', emotion: 'excited', fade: 0.25 },
  },
  worried: {
    live2d: { motionGroup: 'idle' },
    vrm: { emotion: 'sad', fade: 0.4 },
  },
  embarrassed: {
    live2d: { motionGroup: 'idle' },
    vrm: { emotion: 'shy', fade: 0.4 },
  },
  neutral: {
    live2d: { motionGroup: 'idle' },
    vrm: { emotion: 'neutral', fade: 0.6 },
  },
});

function isPassthroughActivity(activityId: string): boolean {
  return activityId.startsWith('ext:') || activityId.startsWith('mod-');
}

function lookup(activityId: string): ActivityRoutes | null {
  if (isPassthroughActivity(activityId)) return null;
  return ACTIVITY_ROUTES[activityId] ?? null;
}

export type ActivityMappingResolver = {
  resolveLive2DRoute(activityId: string): Live2DActivityRoute | null;
  resolveVrmRoute(activityId: string): VrmActivityRoute | null;
  /** Whether the id is a passthrough family (`ext:` / `mod-`) that
   *  must fail-close at the call site rather than silently fall back. */
  isPassthrough(activityId: string): boolean;
};

export function createActivityMappingResolver(): ActivityMappingResolver {
  return {
    resolveLive2DRoute(activityId) {
      return lookup(activityId)?.live2d ?? null;
    },
    resolveVrmRoute(activityId) {
      return lookup(activityId)?.vrm ?? null;
    },
    isPassthrough(activityId) {
      return isPassthroughActivity(activityId);
    },
  };
}

/** Test-only: enumerate the activity ids the resolver supports. */
export const __KNOWN_ROUTING_ACTIVITY_IDS__: readonly string[] =
  Object.freeze(Object.keys(ACTIVITY_ROUTES));
