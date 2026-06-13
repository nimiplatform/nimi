export default {
  requires: ["live2d-extension"],
  meta: {
    description: "Runnable synchronous eye tracking fixture"
  },
  fps: 60,
  update(ctx, projection, { extension }) {
    const normX = (ctx.app.cursor_x / ctx.app.window.width - 0.5) * 2;
    const normY = (ctx.app.cursor_y / ctx.app.window.height - 0.5) * 2;
    const x = Math.max(-1, Math.min(1, normX));
    const y = Math.max(-1, Math.min(1, normY));
    extension.live2d.setParameter("gaze.x", x);
    extension.live2d.setParameter("gaze.y", -y);
    extension.live2d.setParameter("head.yaw", x * 30);
    extension.live2d.setParameter("head.pitch", -y * 20);
  }
};
