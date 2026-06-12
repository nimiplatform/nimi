export type VrmActivityRoute = {
  motion?: string;
  emotion?: string;
  expression?: string;
  fade?: number;
};

const ACTIVITY_ROUTES: Readonly<Record<string, VrmActivityRoute>> = Object.freeze({
  greet: { motion: 'greet_wave', emotion: 'happy', fade: 0.25 },
  farewell: { motion: 'idle_subtle', emotion: 'happy', fade: 0.3 },
  agree: { motion: 'nod_yes', fade: 0.2 },
  disagree: { motion: 'shake_no', fade: 0.2 },
  listening: { motion: 'listen_lean', fade: 0.3 },
  thinking: { motion: 'idle_subtle', fade: 0.4 },
  idle: { motion: 'idle_subtle', fade: 0.5 },
  celebrating: { motion: 'idle_subtle', emotion: 'excited', fade: 0.25 },
  sleeping: { motion: 'idle_subtle', fade: 0.6 },
  focused: { motion: 'idle_subtle', fade: 0.4 },
  happy: { emotion: 'happy', fade: 0.4 },
  sad: { emotion: 'sad', fade: 0.5 },
  shy: { emotion: 'relaxed', fade: 0.5 },
  angry: { emotion: 'angry', fade: 0.3 },
  surprised: { emotion: 'surprised', fade: 0.15 },
  confused: { emotion: 'relaxed', fade: 0.4 },
  excited: { motion: 'idle_subtle', emotion: 'excited', fade: 0.25 },
  worried: { emotion: 'sad', fade: 0.4 },
  embarrassed: { emotion: 'shy', fade: 0.4 },
  neutral: { emotion: 'neutral', fade: 0.6 },
});

function isPassthroughActivity(activityId: string): boolean {
  return activityId.startsWith('ext:') || activityId.startsWith('mod-');
}

export type VrmActivityMappingResolver = {
  resolveVrmRoute(activityId: string): VrmActivityRoute | null;
  isPassthrough(activityId: string): boolean;
};

export function createVrmActivityMappingResolver(): VrmActivityMappingResolver {
  return {
    resolveVrmRoute(activityId) {
      if (isPassthroughActivity(activityId)) return null;
      return ACTIVITY_ROUTES[activityId] ?? null;
    },
    isPassthrough(activityId) {
      return isPassthroughActivity(activityId);
    },
  };
}
