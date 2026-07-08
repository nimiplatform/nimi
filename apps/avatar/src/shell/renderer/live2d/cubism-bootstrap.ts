import type { CubismCoreGlobal } from './cubism-runtime-types.js';

const WAIT_INTERVAL_MS = 50;
const DEFAULT_TIMEOUT_MS = 5000;
const CUBISM_CORE_SCRIPT_PATH = 'assets/js/live2d-cubism-core/Core/live2dcubismcore.min.js';

let cubismCoreScriptLoadPromise: Promise<void> | null = null;

function cubismCoreScriptUrl(): string {
  const base = import.meta.env.BASE_URL || './';
  return `${base.endsWith('/') ? base : `${base}/`}${CUBISM_CORE_SCRIPT_PATH}`;
}

function ensureCubismCoreScriptLoaded(): Promise<void> {
  if (window.Live2DCubismCore?.Version?.csmGetVersion) {
    return Promise.resolve();
  }
  if (cubismCoreScriptLoadPromise) {
    return cubismCoreScriptLoadPromise;
  }
  cubismCoreScriptLoadPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = cubismCoreScriptUrl();
    script.async = true;
    script.dataset.nimiLive2dCubismCore = 'true';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load Live2D Cubism Core from ${script.src}`)), { once: true });
    document.head.appendChild(script);
  });
  return cubismCoreScriptLoadPromise;
}

export async function waitForCubismCore(timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<CubismCoreGlobal> {
  await ensureCubismCoreScriptLoaded();
  const start = performance.now();
  while (performance.now() - start < timeoutMs) {
    const core = window.Live2DCubismCore;
    if (core && typeof core.Version?.csmGetVersion === 'function') {
      return core;
    }
    await new Promise<void>((resolve) => globalThis.setTimeout(resolve, WAIT_INTERVAL_MS));
  }
  throw new Error(
    'Live2DCubismCore not available within timeout. Ensure assets/js/live2d-cubism-core/Core/live2dcubismcore.min.js is present in the renderer public assets.',
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
