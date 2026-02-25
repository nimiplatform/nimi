import type {
  RuntimeLocalManifestSummaryLike,
  RuntimeModRegistration,
} from '../../types';
import { createRuntimeModFlowId, emitRuntimeModRuntimeLog } from '../../logging';
import { buildSideloadRuntimeModRegistration } from './build-registration';
import { loadSideloadRuntimeModFactory } from './load-factory';
import { reportSideloadDiscoveryError } from './report-error';

export async function discoverSideloadRuntimeMods(input: {
  manifests: RuntimeLocalManifestSummaryLike[];
  readEntry: (entryPath: string) => Promise<string>;
  onError?: (detail: { manifestId: string; entryPath?: string; error: unknown }) => void;
}): Promise<RuntimeModRegistration[]> {
  const flowId = createRuntimeModFlowId('runtime-mod-discover-sideload');
  const startedAt = Date.now();
  emitRuntimeModRuntimeLog({
    level: 'info',
    message: 'action:discover-sideload-runtime-mods:start',
    flowId,
    source: 'discoverSideloadRuntimeMods',
    details: {
      manifestCount: input.manifests.length,
    },
  });

  const registrations: RuntimeModRegistration[] = [];
  for (const manifest of input.manifests) {
    const entryPath = String(manifest.entryPath || '').trim();
    if (!entryPath) {
      emitRuntimeModRuntimeLog({
        level: 'warn',
        message: 'action:discover-sideload-runtime-mods:skip-manifest',
        flowId,
        source: 'discoverSideloadRuntimeMods',
        details: {
          manifestId: manifest.id,
          reason: 'empty-entry-path',
        },
      });
      continue;
    }

    try {
      const loadResult = await (async () => {
        try {
          return await loadSideloadRuntimeModFactory({
            entryPath,
            readEntry: input.readEntry,
          });
        } catch (error) {
          reportSideloadDiscoveryError({
            flowId,
            manifestId: manifest.id,
            entryPath,
            reasonCode: 'load-factory-failed',
            error,
            onError: input.onError,
          });
          return null;
        }
      })();
      if (!loadResult) {
        continue;
      }
      if (!loadResult.factory) {
        reportSideloadDiscoveryError({
          flowId,
          manifestId: manifest.id,
          entryPath,
          reasonCode: loadResult.reason,
          error: loadResult.error || new Error(loadResult.reason),
          onError: input.onError,
        });
        continue;
      }

      const registrationResult = (() => {
        try {
          return buildSideloadRuntimeModRegistration({
            factory: loadResult.factory,
            manifest,
          });
        } catch (error) {
          reportSideloadDiscoveryError({
            flowId,
            manifestId: manifest.id,
            entryPath,
            reasonCode: 'build-registration-failed',
            error,
            onError: input.onError,
          });
          return null;
        }
      })();
      if (!registrationResult) {
        continue;
      }
      if (!registrationResult.registration) {
        emitRuntimeModRuntimeLog({
          level: 'warn',
          message: 'action:discover-sideload-runtime-mods:skip-manifest',
          flowId,
          source: 'discoverSideloadRuntimeMods',
          details: {
            manifestId: manifest.id,
            entryPath,
            reason: registrationResult.reason,
          },
        });
        continue;
      }

      registrations.push(registrationResult.registration);
    } catch (error) {
      reportSideloadDiscoveryError({
        flowId,
        manifestId: manifest.id,
        entryPath,
        reasonCode: 'runtime-exception',
        error,
        onError: input.onError,
      });
    }
  }

  emitRuntimeModRuntimeLog({
    level: 'info',
    message: 'action:discover-sideload-runtime-mods:done',
    flowId,
    source: 'discoverSideloadRuntimeMods',
    costMs: Date.now() - startedAt,
    details: {
      manifestCount: input.manifests.length,
      registrationCount: registrations.length,
    },
  });
  return registrations;
}
