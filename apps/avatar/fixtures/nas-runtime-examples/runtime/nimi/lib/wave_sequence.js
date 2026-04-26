export async function waveSequence(projection, options) {
  await projection.triggerMotion(options.hand === "left" ? "wave.left" : "wave.right");
  projection.setSignal("wave.duration_ms", options.duration_ms);
}
