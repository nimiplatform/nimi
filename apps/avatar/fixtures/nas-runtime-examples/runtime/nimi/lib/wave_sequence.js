export async function waveSequence(projection, live2d, options) {
  await projection.triggerMotion(options.hand === "left" ? "wave.left" : "wave.right");
  live2d.setParameter("wave.duration_ms", options.duration_ms);
}
