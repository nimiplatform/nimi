import { emitRuntimeModRuntimeLog } from '../../logging';

export function reportSideloadDiscoveryError(input: {
  flowId: string;
  manifestId: string;
  entryPath: string;
  reasonCode:
    | 'entry-not-found'
    | 'entry-read-failed'
    | 'factory-missing'
    | 'load-factory-failed'
    | 'build-registration-failed'
    | 'runtime-exception';
  error: unknown;
  onError?: (detail: { manifestId: string; entryPath?: string; error: unknown }) => void;
}) {
  const errorMessage = input.error instanceof Error ? input.error.message : String(input.error || '');
  const normalizedError = new Error(`[${input.reasonCode}] ${errorMessage}`);
  emitRuntimeModRuntimeLog({
    level: 'error',
    message: 'action:discover-sideload-runtime-mods:manifest-failed',
    flowId: input.flowId,
    source: 'discoverSideloadRuntimeMods',
    details: {
      manifestId: input.manifestId,
      entryPath: input.entryPath,
      reasonCode: input.reasonCode,
      error: errorMessage,
    },
  });
  input.onError?.({
    manifestId: input.manifestId,
    entryPath: input.entryPath,
    error: normalizedError,
  });
}
