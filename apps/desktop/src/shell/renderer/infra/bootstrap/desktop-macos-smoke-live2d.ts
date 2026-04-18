import {
  type DesktopMacosSmokeDriverDeps,
  type Live2dCanvasStats,
  type Live2dVisiblePixelsTimeoutError,
  LIVE2D_VIEWPORT_SELECTOR,
  SMOKE_STEP_TIMEOUT_MS,
} from './desktop-macos-smoke-shared';

export async function waitForSpeakingLive2dPose(
  deps: Pick<DesktopMacosSmokeDriverDeps, 'readLive2dCanvasStats'>,
  timeoutMs = SMOKE_STEP_TIMEOUT_MS,
): Promise<Live2dCanvasStats> {
  const deadline = Date.now() + timeoutMs;
  let lastStats = await deps.readLive2dCanvasStats(LIVE2D_VIEWPORT_SELECTOR);
  while (Date.now() < deadline) {
    lastStats = await deps.readLive2dCanvasStats(LIVE2D_VIEWPORT_SELECTOR);
    const runtimeDebug = lastStats.runtimeDebug || {};
    const phase = typeof runtimeDebug.phase === 'string' ? runtimeDebug.phase : null;
    const smoothedAmplitude = typeof runtimeDebug.smoothedAmplitude === 'number'
      ? runtimeDebug.smoothedAmplitude
      : 0;
    const speakingEnergy = typeof runtimeDebug.speakingEnergy === 'number'
      ? runtimeDebug.speakingEnergy
      : 0;
    if (
      lastStats.status === 'ready'
      && lastStats.canvasPresent
      && lastStats.nonTransparentSampleCount >= 3
      && phase === 'speaking'
      && (smoothedAmplitude > 0.02 || speakingEnergy > 0.02)
    ) {
      return lastStats;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`live2d viewport did not enter speaking pose runtimeDebug=${JSON.stringify(lastStats.runtimeDebug || null)}`);
}

export async function waitForVisibleLive2dPixels(
  deps: Pick<DesktopMacosSmokeDriverDeps, 'readLive2dCanvasStats'>,
  timeoutMs = SMOKE_STEP_TIMEOUT_MS,
): Promise<Live2dCanvasStats> {
  const deadline = Date.now() + timeoutMs;
  let lastStats = await deps.readLive2dCanvasStats(LIVE2D_VIEWPORT_SELECTOR);
  while (Date.now() < deadline) {
    lastStats = await deps.readLive2dCanvasStats(LIVE2D_VIEWPORT_SELECTOR);
    if (lastStats.status === 'error') {
      throw new Error(lastStats.fallbackText || 'live2d viewport failed closed');
    }
    if (
      lastStats.status === 'ready'
      && lastStats.canvasPresent
      && lastStats.width > 0
      && lastStats.height > 0
      && lastStats.nonTransparentSampleCount >= 3
    ) {
      return lastStats;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const error = new Error(
    [
      'live2d viewport did not produce visible pixels',
      `status=${lastStats.status || 'missing'}`,
      `canvas=${lastStats.canvasPresent ? 'present' : 'missing'}`,
      `size=${lastStats.width}x${lastStats.height}`,
      `context=${lastStats.contextKind || 'none'}`,
      `nonTransparentSamples=${lastStats.nonTransparentSampleCount}/${lastStats.sampleCount}`,
      lastStats.sampleError ? `sampleError=${lastStats.sampleError}` : null,
      lastStats.runtimeDebug ? `runtimeDebug=${JSON.stringify(lastStats.runtimeDebug)}` : null,
      lastStats.fallbackText ? `fallback=${lastStats.fallbackText}` : null,
    ].filter(Boolean).join(' '),
  ) as Live2dVisiblePixelsTimeoutError;
  error.live2dStats = lastStats;
  throw error;
}

export function toLive2dCanvasStatsReport(stats: Live2dCanvasStats): Record<string, unknown> {
  return {
    status: stats.status,
    fallbackText: stats.fallbackText,
    width: stats.width,
    height: stats.height,
    canvasPresent: stats.canvasPresent,
    contextKind: stats.contextKind,
    sampleCount: stats.sampleCount,
    nonTransparentSampleCount: stats.nonTransparentSampleCount,
    sampleError: stats.sampleError,
    runtimeDebug: stats.runtimeDebug ?? undefined,
  };
}
