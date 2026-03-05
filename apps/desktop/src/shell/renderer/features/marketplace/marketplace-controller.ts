import { useCallback, useMemo, useState } from 'react';
import { desktopBridge, type RuntimeLocalManifestSummary } from '@renderer/bridge';
import { useAppStore, type AppTab } from '@renderer/app-shell/providers/app-store';
import {
  discoverSideloadRuntimeMods,
  listRegisteredRuntimeModIds,
  registerRuntimeMods,
  unregisterRuntimeMods,
  type RuntimeModRegisterFailure,
} from '@runtime/mod';
import {
  resolveModTabId,
  syncRuntimeUiExtensionsToRegistry,
} from '@renderer/mod-ui/lifecycle/sync-runtime-extensions';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import {
  SETTINGS_SELECTED_MOD_ID_STORAGE_KEY,
  SETTINGS_SELECTED_STORAGE_KEY,
} from '@renderer/features/settings/settings-storage';
import {
  MOCK_MARKETPLACE_MODS,
  type MarketplaceMod,
  type MarketplaceRuntimeAction,
  toRuntimeModRow,
} from './marketplace-model';

function normalizeModId(modId: string): string {
  return String(modId || '').trim();
}

function withAddedModId(modIds: string[], modId: string): string[] {
  const target = normalizeModId(modId);
  if (!target) return modIds;
  const deduped = new Set(modIds.map((item) => normalizeModId(item)).filter(Boolean));
  deduped.add(target);
  return Array.from(deduped.values()).sort();
}

function withRemovedModId(modIds: string[], modId: string): string[] {
  const target = normalizeModId(modId);
  if (!target) return modIds;
  return modIds
    .map((item) => normalizeModId(item))
    .filter((item) => item && item !== target)
    .sort();
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || 'unknown error');
}

async function registerOneRuntimeMod(input: {
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

function syncRuntimeModRegistryState(): void {
  const appStore = useAppStore.getState();
  appStore.setRegisteredRuntimeModIds(listRegisteredRuntimeModIds());
  syncRuntimeUiExtensionsToRegistry();
}

export type MarketplacePendingAction = {
  modId: string;
  action: MarketplaceRuntimeAction;
} | null;

export type MarketplacePageModel = {
  searchQuery: string;
  filteredMods: MarketplaceMod[];
  pendingAction: MarketplacePendingAction;
  selectedModId: string | null;
  onSearchQueryChange: (value: string) => void;
  onOpenMod: (modId: string) => void;
  onInstallMod: (modId: string) => void;
  onUninstallMod: (modId: string) => void;
  onEnableMod: (modId: string) => void;
  onDisableMod: (modId: string) => void;
  onOpenModSettings: (modId: string) => void;
  onSelectMod: (modId: string | null) => void;
};

export function useMarketplacePageModel(): MarketplacePageModel {
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAction, setPendingAction] = useState<MarketplacePendingAction>(null);
  const [selectedModId, setSelectedModId] = useState<string | null>(null);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const openModWorkspaceTab = useAppStore((state) => state.openModWorkspaceTab);
  const closeModWorkspaceTab = useAppStore((state) => state.closeModWorkspaceTab);
  const localManifestSummaries = useAppStore((state) => state.localManifestSummaries);
  const registeredRuntimeModIds = useAppStore((state) => state.registeredRuntimeModIds);
  const runtimeModDisabledIds = useAppStore((state) => state.runtimeModDisabledIds);
  const runtimeModUninstalledIds = useAppStore((state) => state.runtimeModUninstalledIds);

  const runtimeMods = useMemo(() => {
    const registeredSet = new Set(registeredRuntimeModIds.map((id) => normalizeModId(id)).filter(Boolean));
    const disabledSet = new Set(runtimeModDisabledIds.map((id) => normalizeModId(id)).filter(Boolean));
    const uninstalledSet = new Set(runtimeModUninstalledIds.map((id) => normalizeModId(id)).filter(Boolean));

    return localManifestSummaries
      .filter((item) => !String(item.id || '').startsWith('core.'))
      .map((item, index) => {
        const modId = normalizeModId(String(item.id || ''));
        const isInstalled = !uninstalledSet.has(modId);
        const isEnabled = isInstalled && !disabledSet.has(modId) && registeredSet.has(modId);
        return toRuntimeModRow(item, index, {
          isInstalled,
          isEnabled,
        });
      });
  }, [
    localManifestSummaries,
    registeredRuntimeModIds,
    runtimeModDisabledIds,
    runtimeModUninstalledIds,
  ]);

  const sourceMods = runtimeMods.length > 0 ? runtimeMods : MOCK_MARKETPLACE_MODS;

  const filteredMods = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const mods = (query
      ? sourceMods.filter(
          (mod) =>
            mod.name.toLowerCase().includes(query) ||
            mod.description.toLowerCase().includes(query) ||
            mod.author.toLowerCase().includes(query),
        )
      : sourceMods).slice();
    // Sort: enabled (can open) > installed but disabled > not installed
    return mods.sort((a, b) => {
      const aScore = a.isInstalled ? (a.isEnabled ? 2 : 1) : 0;
      const bScore = b.isInstalled ? (b.isEnabled ? 2 : 1) : 0;
      if (aScore !== bScore) return bScore - aScore;
      return a.name.localeCompare(b.name);
    });
  }, [searchQuery, sourceMods]);

  const onSelectMod = useCallback((modId: string | null) => {
    setSelectedModId(modId);
  }, []);

  const onOpenMod = useCallback((modId: string) => {
    const normalized = normalizeModId(modId);
    if (!normalized) return;
    const targetMod = runtimeMods.find((item) => item.id === normalized);
    const title = targetMod?.name || normalized;
    const tabId = resolveModTabId(normalized);
    openModWorkspaceTab(tabId, title, normalized);
    setActiveTab(tabId as AppTab);
  }, [openModWorkspaceTab, runtimeMods, setActiveTab]);

  const onOpenModSettings = useCallback((modId: string) => {
    const normalized = normalizeModId(modId);
    if (!normalized) return;
    try {
      localStorage.setItem(SETTINGS_SELECTED_STORAGE_KEY, 'extensions');
      localStorage.setItem(SETTINGS_SELECTED_MOD_ID_STORAGE_KEY, normalized);
    } catch {
      // ignore
    }
    setActiveTab('settings');
  }, [setActiveTab]);

  const runRuntimeAction = useCallback(async (
    modId: string,
    action: MarketplaceRuntimeAction,
    task: () => Promise<void>,
  ) => {
    const normalizedModId = normalizeModId(modId);
    if (!normalizedModId) return;
    setPendingAction({
      modId: normalizedModId,
      action,
    });
    try {
      await task();
      logRendererEvent({
        level: 'info',
        area: 'marketplace',
        message: 'marketplace:runtime-mod:action-success',
        details: {
          modId: normalizedModId,
          action,
        },
      });
    } catch (error) {
      const message = safeErrorMessage(error);
      useAppStore.getState().setStatusBanner({
        kind: 'error',
        message: `Mod ${normalizedModId} 操作失败：${message}`,
      });
      logRendererEvent({
        level: 'warn',
        area: 'marketplace',
        message: 'marketplace:runtime-mod:action-failed',
        details: {
          modId: normalizedModId,
          action,
          error: message,
        },
      });
    } finally {
      setPendingAction((current) => (
        current && current.modId === normalizedModId && current.action === action
          ? null
          : current
      ));
    }
  }, []);

  const onInstallMod = useCallback((modId: string) => {
    void runRuntimeAction(modId, 'install', async () => {
      const normalizedModId = normalizeModId(modId);
      const appStore = useAppStore.getState();
      const manifest = appStore.localManifestSummaries.find((item) => normalizeModId(item.id || '') === normalizedModId);
      if (!manifest) {
        throw new Error('manifest not found');
      }

      appStore.setRuntimeModUninstalledIds(withRemovedModId(appStore.runtimeModUninstalledIds, normalizedModId));
      appStore.setRuntimeModDisabledIds(withRemovedModId(appStore.runtimeModDisabledIds, normalizedModId));

      const result = await registerOneRuntimeMod({
        manifest,
      });
      if (result.failure) {
        appStore.setRuntimeModFailures([
          ...appStore.runtimeModFailures.filter((item) => item.modId !== normalizedModId),
          result.failure,
        ]);
        throw new Error(result.failure.error);
      }

      appStore.setRuntimeModFailures(
        appStore.runtimeModFailures.filter((item) => item.modId !== normalizedModId),
      );
      appStore.clearRuntimeModFuse(normalizedModId);
      syncRuntimeModRegistryState();
      appStore.setStatusBanner({
        kind: 'success',
        message: `Mod ${normalizedModId} 已安装并启用`,
      });
    });
  }, [runRuntimeAction]);

  const onEnableMod = useCallback((modId: string) => {
    void runRuntimeAction(modId, 'enable', async () => {
      const normalizedModId = normalizeModId(modId);
      const appStore = useAppStore.getState();
      const manifest = appStore.localManifestSummaries.find((item) => normalizeModId(item.id || '') === normalizedModId);
      if (!manifest) {
        throw new Error('manifest not found');
      }

      appStore.setRuntimeModUninstalledIds(withRemovedModId(appStore.runtimeModUninstalledIds, normalizedModId));
      appStore.setRuntimeModDisabledIds(withRemovedModId(appStore.runtimeModDisabledIds, normalizedModId));

      const result = await registerOneRuntimeMod({
        manifest,
      });
      if (result.failure) {
        appStore.setRuntimeModFailures([
          ...appStore.runtimeModFailures.filter((item) => item.modId !== normalizedModId),
          result.failure,
        ]);
        throw new Error(result.failure.error);
      }

      appStore.setRuntimeModFailures(
        appStore.runtimeModFailures.filter((item) => item.modId !== normalizedModId),
      );
      appStore.clearRuntimeModFuse(normalizedModId);
      syncRuntimeModRegistryState();
      appStore.setStatusBanner({
        kind: 'success',
        message: `Mod ${normalizedModId} 已启用`,
      });
    });
  }, [runRuntimeAction]);

  const onDisableMod = useCallback((modId: string) => {
    void runRuntimeAction(modId, 'disable', async () => {
      const normalizedModId = normalizeModId(modId);
      const modTabId = resolveModTabId(normalizedModId);
      const appStore = useAppStore.getState();
      appStore.setRuntimeModDisabledIds(withAddedModId(appStore.runtimeModDisabledIds, normalizedModId));
      unregisterRuntimeMods([normalizedModId]);
      syncRuntimeModRegistryState();
      if (appStore.activeTab === modTabId) {
        appStore.setActiveTab('mods');
      }
      appStore.closeModWorkspaceTab(modTabId);
      appStore.setStatusBanner({
        kind: 'info',
        message: `Mod ${normalizedModId} 已禁用`,
      });
    });
  }, [runRuntimeAction]);

  const onUninstallMod = useCallback((modId: string) => {
    void runRuntimeAction(modId, 'uninstall', async () => {
      const normalizedModId = normalizeModId(modId);
      const modTabId = resolveModTabId(normalizedModId);
      const appStore = useAppStore.getState();
      appStore.setRuntimeModUninstalledIds(withAddedModId(appStore.runtimeModUninstalledIds, normalizedModId));
      appStore.setRuntimeModDisabledIds(withRemovedModId(appStore.runtimeModDisabledIds, normalizedModId));
      unregisterRuntimeMods([normalizedModId]);
      syncRuntimeModRegistryState();
      appStore.setRuntimeModFailures(
        appStore.runtimeModFailures.filter((item) => item.modId !== normalizedModId),
      );
      if (appStore.activeTab === modTabId) {
        appStore.setActiveTab('mods');
      }
      closeModWorkspaceTab(modTabId);
      appStore.setStatusBanner({
        kind: 'info',
        message: `Mod ${normalizedModId} 已卸载`,
      });
    });
  }, [closeModWorkspaceTab, runRuntimeAction]);

  return {
    searchQuery,
    filteredMods,
    pendingAction,
    selectedModId,
    onSearchQueryChange: setSearchQuery,
    onOpenMod,
    onInstallMod,
    onUninstallMod,
    onEnableMod,
    onDisableMod,
    onOpenModSettings,
    onSelectMod,
  };
}
