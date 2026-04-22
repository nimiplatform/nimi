import type { ActivityOrEventHandler } from './handler-types.js';

export function createDefaultActivityHandler(): ActivityOrEventHandler {
  return {
    meta: { description: 'Backend-neutral fallback: delegate to branch-owned activity fallback if available' },
    async execute(ctx, projection, { signal }) {
      const name = ctx.activity?.name;
      if (!name) return;
      if (typeof projection.runDefaultActivity !== 'function') {
        console.warn(`[nas:fallback] no backend default activity fallback is registered for ${name}`);
        return;
      }
      await projection.runDefaultActivity(name, { signal, bundle: ctx });
    },
  };
}
