import { useAppStore, type AppTab } from '@renderer/app-shell/providers/app-store';
import { i18n } from '@renderer/i18n';
import { showModTabLimitBanner } from '@renderer/mod-ui/host/mod-tab-limit-banner';
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
      message: i18n.t('ModUI.privateExecutionUnavailable'),
    });
    return false;
  }

  const manifest = appStore.localManifestSummaries.find((item) => normalizeModId(item.id) === modId);
  const title = String(manifest?.name || modId).trim() || modId;
  const tabId = resolveModTabId(modId);
  const result = appStore.openModWorkspaceTab(tabId, title, modId);
  if (result === 'rejected-limit') {
    showModTabLimitBanner({
      setStatusBanner: appStore.setStatusBanner,
      setActiveTab: (tab) => {
        appStore.setActiveTab(tab as AppTab);
      },
    });
    return false;
  }
  return true;
}
