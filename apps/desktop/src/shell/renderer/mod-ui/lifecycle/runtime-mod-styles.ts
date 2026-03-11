import { desktopBridge, type RuntimeLocalManifestSummary } from '@renderer/bridge';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

const injectedStylesByModId = new Map<string, HTMLStyleElement[]>();

function normalizeModId(value: unknown): string {
  return String(value || '').trim();
}

export function removeRuntimeModStyles(modId: string): void {
  const normalizedModId = normalizeModId(modId);
  if (!normalizedModId) {
    return;
  }
  const styles = injectedStylesByModId.get(normalizedModId) || [];
  for (const style of styles) {
    style.remove();
  }
  injectedStylesByModId.delete(normalizedModId);
}

async function injectRuntimeModStyles(manifest: RuntimeLocalManifestSummary): Promise<void> {
  const modId = normalizeModId(manifest.id);
  if (!modId || typeof document === 'undefined') {
    return;
  }

  removeRuntimeModStyles(modId);
  const stylePaths = (manifest.stylePaths || [])
    .map((item: string) => String(item || '').trim())
    .filter(Boolean);
  if (stylePaths.length === 0) {
    return;
  }

  const nextStyles: HTMLStyleElement[] = [];
  for (const stylePath of stylePaths) {
    try {
      const content = await desktopBridge.readRuntimeLocalModEntry(stylePath);
      const style = document.createElement('style');
      style.dataset.runtimeModId = modId;
      style.dataset.runtimeModPath = stylePath;
      style.textContent = content;
      document.head.appendChild(style);
      nextStyles.push(style);
    } catch (error) {
      logRendererEvent({
        level: 'warn',
        area: 'mod-ui',
        message: 'runtime-mod-style:inject-failed',
        details: {
          modId,
          stylePath,
          error: error instanceof Error ? error.message : String(error || ''),
        },
      });
    }
  }

  if (nextStyles.length > 0) {
    injectedStylesByModId.set(modId, nextStyles);
  }
}

export async function syncRuntimeModStyles(input: {
  manifests: RuntimeLocalManifestSummary[];
  activeModIds: string[];
}): Promise<void> {
  const activeIds = new Set(input.activeModIds.map((item) => normalizeModId(item)).filter(Boolean));
  for (const modId of Array.from(injectedStylesByModId.keys())) {
    if (!activeIds.has(modId)) {
      removeRuntimeModStyles(modId);
    }
  }

  for (const manifest of input.manifests) {
    const modId = normalizeModId(manifest.id);
    if (!activeIds.has(modId)) {
      removeRuntimeModStyles(modId);
      continue;
    }
    await injectRuntimeModStyles(manifest);
  }
}
