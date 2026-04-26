import { waveSequence } from "../lib/wave_sequence.js";

export default {
  meta: {
    description: "Runnable greet activity fixture"
  },
  async execute(ctx, projection, { signal }) {
    if (ctx.history?.last_activity?.name === "greet") {
      await projection.triggerMotion("bow.default");
      return;
    }
    await waveSequence(projection, { hand: "right", duration_ms: 2000 });
    if (signal.aborted) return;
    await projection.setExpression("smile.bright");
  }
};
