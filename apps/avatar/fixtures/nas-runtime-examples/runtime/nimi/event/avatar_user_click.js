let clickCount = 0;

export default {
  meta: {
    description: "Runnable click event fixture"
  },
  async execute(ctx, projection) {
    clickCount += 1;
    if (clickCount >= 3 && ctx.event?.detail.region === "head") {
      await projection.triggerMotion("tickled.special");
      clickCount = 0;
      return;
    }
    if (ctx.event?.detail.region === "head") {
      await projection.triggerMotion("shy.default");
      await projection.setExpression("blush.soft");
    }
  }
};
