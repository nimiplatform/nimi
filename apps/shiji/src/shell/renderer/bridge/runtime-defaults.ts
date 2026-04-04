import { hasTauriInvoke } from './env.js';
import { invokeChecked } from './invoke.js';
import { parseRuntimeDefaults, type RuntimeDefaults } from './types.js';

declare global {
  interface Window {
    __SHIJI_TEST_RUNTIME_DEFAULTS__?: unknown;
  }
}

function readTestRuntimeDefaults(): RuntimeDefaults | null {
  const override = globalThis.window?.__SHIJI_TEST_RUNTIME_DEFAULTS__;
  if (override == null) {
    return null;
  }
  return parseRuntimeDefaults(override);
}

export async function getRuntimeDefaults(): Promise<RuntimeDefaults> {
  const testDefaults = readTestRuntimeDefaults();
  if (testDefaults) {
    return testDefaults;
  }

  if (!hasTauriInvoke()) {
    throw new Error(
      'runtime_defaults requires the Tauri bridge. Renderer-only fallback defaults are not allowed in production paths.',
    );
  }

  return invokeChecked('runtime_defaults', {}, parseRuntimeDefaults);
}
