import { useAppStore, type AppTab } from '@renderer/app-shell/providers/app-store';
import { getDefaultPrivateExecutionModId } from '@runtime/mod';
import { resolveModTabId } from './sync-runtime-extensions';

function normalizeModId(value: unknown): string {
  return String(value || '').trim();
}

function resolvePrivateExecutionModId(): string {
  const explicit = normalizeModId(getDefaultPrivateExecutionModId());
  if (explicit) {
    return explicit;
  }

  const appStore = useAppStore.getState();
  for (const modId of appStore.registeredRuntimeModIds) {
    const normalized = normalizeModId(modId);
    if (!normalized) {
      continue;
    }
    const tabId = resolveModTabId(normalized);
    if (tabId.startsWith('mod:')) {
      return normalized;
    }
  }
  return '';
}

export function openDefaultPrivateExecutionMod(): boolean {
  const modId = resolvePrivateExecutionModId();
  const appStore = useAppStore.getState();
  if (!modId) {
    appStore.setStatusBanner({
      kind: 'warning',
      message: 'No runtime mod is available for private execution.',
    });
    return false;
  }

  const manifest = appStore.localManifestSummaries.find((item) => normalizeModId(item.id) === modId);
  const title = String(manifest?.name || modId).trim() || modId;
  const tabId = resolveModTabId(modId);
  appStore.openModWorkspaceTab(tabId, title, modId);
  appStore.setActiveTab(tabId as AppTab);
  return true;
}
