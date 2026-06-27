import { NimiElectronShellHostError, type NimiElectronStandardShellHost } from './types.js';
import { createElectronCapabilityUnavailableError } from './errors.js';
import { normalizeRequiredToken } from './paths.js';

export async function getElectronRuntimeConfig(
  host: NimiElectronStandardShellHost | undefined,
  command: string,
): Promise<{ readonly path: string; readonly config: Readonly<Record<string, unknown>> }> {
  const reader = host?.runtimeConfigGet;
  if (!reader) {
    throw createElectronCapabilityUnavailableError(command);
  }
  const result = await reader();
  const filePath = normalizeRequiredToken(result.path, 'path');
  if (!result.config || typeof result.config !== 'object' || Array.isArray(result.config)) {
    throw new NimiElectronShellHostError({
      code: 'host-internal-error',
      message: 'Electron Runtime config reader returned invalid config payload',
      reasonCode: 'electron-runtime-config-reader-invalid-payload',
      actionHint: 'repair_electron_runtime_config_reader',
      details: { command, path: filePath },
    });
  }
  return { path: filePath, config: result.config };
}
