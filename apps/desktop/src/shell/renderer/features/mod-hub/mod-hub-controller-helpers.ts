import { i18n } from '@renderer/i18n';
import { desktopBridge, type RuntimeLocalManifestSummary } from '@renderer/bridge';
import {
  discoverSideloadRuntimeMods,
  registerRuntimeMods,
  type RuntimeModRegisterFailure,
} from '@runtime/mod';

export function normalizeModId(modId: string): string {
  return String(modId || '').trim();
}

export function stripVersionPrefix(value: string | undefined): string {
  return String(value || '').trim().replace(/^v/i, '');
}

export function withAddedModId(modIds: string[], modId: string): string[] {
  const target = normalizeModId(modId);
  if (!target) return modIds;
  const deduped = new Set(modIds.map((item) => normalizeModId(item)).filter(Boolean));
  deduped.add(target);
  return Array.from(deduped.values()).sort();
}

export function withRemovedModId(modIds: string[], modId: string): string[] {
  const target = normalizeModId(modId);
  if (!target) return modIds;
  return modIds
    .map((item) => normalizeModId(item))
    .filter((item) => item && item !== target)
    .sort();
}

export function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

export function tModHub(
  key: string,
  options: Record<string, unknown> & { defaultValue: string },
): string {
  return i18n.t(key, options);
}

export function resolveOpenDirPath(input: {
  manifestPath?: string;
  sourceDir?: string;
}): string {
  const manifestPath = String(input.manifestPath || '').trim();
  if (manifestPath) {
    return manifestPath.replace(/[\\/][^\\/]+$/, '');
  }
  return String(input.sourceDir || '').trim();
}

export function buildModHubIssueSummary(input: {
  fusedRuntimeMods: Record<string, unknown>;
  runtimeModFailures: unknown[];
}): { failureCount: number; fusedCount: number; message: string } | null {
  const fusedCount = Object.keys(input.fusedRuntimeMods).length;
  const failureCount = input.runtimeModFailures.length;
  if (fusedCount === 0 && failureCount === 0) return null;
  const parts: string[] = [];
  if (failureCount > 0) {
    parts.push(`${failureCount} load failure${failureCount > 1 ? 's' : ''}`);
  }
  if (fusedCount > 0) {
    parts.push(`${fusedCount} fused runtime mod${fusedCount > 1 ? 's' : ''}`);
  }
  return {
    failureCount,
    fusedCount,
    message: `Startup/runtime issues detected: ${parts.join(' · ')}. Open the affected mod row for the error chain and retry actions.`,
  };
}

export async function registerOneRuntimeMod(input: {
  manifest: RuntimeLocalManifestSummary;
}): Promise<{ failure: RuntimeModRegisterFailure | null }> {
  const discoverFailures: RuntimeModRegisterFailure[] = [];
  const sideloadRegistrations = await discoverSideloadRuntimeMods({
    manifests: [input.manifest],
    readEntry: (entryPath) => desktopBridge.readRuntimeLocalModEntry(entryPath),
    onError: ({ manifestId, error }) => {
      discoverFailures.push({
        modId: manifestId,
        sourceType: 'sideload',
        stage: 'discover',
        error: safeErrorMessage(error),
      });
    },
  });
  if (discoverFailures.length > 0) {
    return {
      failure: discoverFailures[0] || null,
    };
  }
  if (sideloadRegistrations.length === 0) {
    return {
      failure: {
        modId: String(input.manifest.id || '').trim(),
        sourceType: 'sideload',
        stage: 'discover',
        error: 'mod entry not found',
      },
    };
  }
  const sideloadResult = await registerRuntimeMods(sideloadRegistrations, {
    replaceExisting: true,
  });
  const modId = String(input.manifest.id || '').trim();
  return {
    failure: sideloadResult.failedMods.find((item) => item.modId === modId) || null,
  };
}
