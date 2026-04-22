import type { CubismCoreGlobal } from './cubism-runtime-types.js';

const WAIT_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 5000;

export async function waitForCubismCore(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<CubismCoreGlobal> {
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const core = window.Live2DCubismCore;
    if (core && typeof core.Version?.csmGetVersion === 'function') {
      return core;
    }
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, WAIT_INTERVAL_MS));
  }
  throw new Error(
    'Live2DCubismCore not available within timeout. Ensure /assets/js/live2d-cubism-core/Core/live2dcubismcore.min.js is loaded via <script> before main.tsx.',
  );
}

export type CubismVersionInfo = {
  coreVersion: number;
  latestMocVersion: number;
};

export function readCubismVersion(core: CubismCoreGlobal): CubismVersionInfo {
  return {
    coreVersion: core.Version.csmGetVersion(),
    latestMocVersion: core.Version.csmGetLatestMocVersion(),
  };
}
