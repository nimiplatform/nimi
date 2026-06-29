import { NimiElectronShellHostError, type NimiElectronStandardShellHost } from './types.js';
import { createElectronCapabilityUnavailableError, errorMessage } from './errors.js';
import { normalizeRequiredToken } from './paths.js';

export async function getElectronRuntimeConfig(
  host: NimiElectronStandardShellHost | undefined,
  command: string,
): Promise<{ readonly path: string; readonly config: Readonly<Record<string, unknown>> }> {
  const reader = host?.runtimeConfigGet;
  if (!reader) {
    throw createElectronCapabilityUnavailableError(command);
  }
  let result: Awaited<ReturnType<typeof reader>>;
  try {
    result = await reader();
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new NimiElectronShellHostError({
        code: 'not-found',
        message: `Electron Runtime config was not found: ${errorMessage(error)}`,
        reasonCode: 'electron-runtime-config-not-found',
        actionHint: 'create_or_select_runtime_config',
        details: { command, cause: errorMessage(error) },
      });
    }
    throw error;
  }
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

function isNotFoundError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === 'ENOENT');
}
