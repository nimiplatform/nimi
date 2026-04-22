import type { AgentDataBundle } from '../driver/types.js';
import type { Live2DPluginApi } from '../live2d/plugin-api.js';
import { activityIdToMotionGroup } from './activity-naming.js';
import type { ActivityOrEventHandler } from './handler-types.js';

export const FALLBACK_IDLE_GROUP = 'Idle';

export function createDefaultActivityHandler(): ActivityOrEventHandler {
  return {
    meta: { description: 'Convention-based default: Activity_<CamelCase>' },
    async execute(ctx, live2d, { signal }) {
      const name = ctx.activity?.name;
      if (!name) return;
      const base = activityIdToMotionGroup(name);
      const intensity = ctx.activity?.intensity;
      const motion = intensity === 'weak'
        ? `${base}_Weak`
        : intensity === 'strong'
          ? `${base}_Strong`
          : base;
      try {
        await live2d.playMotion(motion, { priority: 'normal' });
      } catch (err) {
        if (signal.aborted) return;
        console.warn(`[nas:fallback] ${motion} failed (${String(err)}), falling back to ${FALLBACK_IDLE_GROUP}`);
        await live2d.playMotion(FALLBACK_IDLE_GROUP, { priority: 'low' });
      }
    },
  };
}

export function resolveActivityIntensityMotion(bundle: AgentDataBundle): string {
  const name = bundle.activity?.name ?? 'idle';
  const intensity = bundle.activity?.intensity;
  const base = activityIdToMotionGroup(name);
  if (intensity === 'weak') return `${base}_Weak`;
  if (intensity === 'strong') return `${base}_Strong`;
  return base;
}
