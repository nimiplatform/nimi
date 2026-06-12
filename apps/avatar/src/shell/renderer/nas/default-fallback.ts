import type { ActivityOrEventHandler } from './handler-types.js';

export function createDefaultActivityHandler(): ActivityOrEventHandler {
  return {
    meta: { description: 'Backend-neutral fallback: delegate to branch-owned BackendProjection activity' },
    async execute(ctx, projection, { signal }) {
      const name = ctx.activity?.name;
      if (!name) return;
      if (signal.aborted) return;
      projection.applyActivity({
        name,
        intensity: ctx.activity?.intensity === 'weak'
          ? 0.25
          : ctx.activity?.intensity === 'moderate'
            ? 0.5
            : ctx.activity?.intensity === 'strong'
              ? 0.85
              : null,
      });
    },
  };
}
