export default {
  meta: {
    description: "Runnable synchronous eye tracking fixture"
  },
  fps: 60,
  update(ctx, projection) {
    const normX = (ctx.app.cursor_x / ctx.app.window.width - 0.5) * 2;
    const normY = (ctx.app.cursor_y / ctx.app.window.height - 0.5) * 2;
    const x = Math.max(-1, Math.min(1, normX));
    const y = Math.max(-1, Math.min(1, normY));
    projection.setSignal("gaze.x", x);
    projection.setSignal("gaze.y", -y);
    projection.setSignal("head.yaw", x * 30);
    projection.setSignal("head.pitch", -y * 20);
  }
};
