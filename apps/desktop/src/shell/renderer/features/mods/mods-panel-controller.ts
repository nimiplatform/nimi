import { useCallback, useMemo, useState } from 'react';
import { desktopBridge, type RuntimeLocalManifestSummary } from '@renderer/bridge';
import { useAppStore, type AppTab } from '@renderer/app-shell/providers/app-store';
import {
  discoverSideloadRuntimeMods,
  registerRuntimeMods,
  unregisterRuntimeMods,
  type RuntimeModRegisterFailure,
} from '@runtime/mod';
import { resolveModTabId } from '@renderer/mod-ui/lifecycle/sync-runtime-extensions';
import {
  refreshRuntimeManifestSummaries,
  syncRuntimeModShellState,
} from '@renderer/mod-ui/lifecycle/runtime-mod-shell-state';
import { removeRuntimeModStyles } from '@renderer/mod-ui/lifecycle/runtime-mod-styles';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import {
  SETTINGS_SELECTED_MOD_ID_STORAGE_KEY,
  SETTINGS_SELECTED_STORAGE_KEY,
} from '@renderer/features/settings/settings-storage';
import {
  type MarketplaceMod,
  toRuntimeModRow,
} from '@renderer/features/marketplace/marketplace-model';
import { persistStoredModsPanelSection } from './mods-panel-state';

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

function resolveModDirPath(input: { manifestPath?: string; sourceDir?: string }): string {
  const manifestPath = String(input.manifestPath || '').trim();
  if (manifestPath) {
    return manifestPath.replace(/[\\/][^\\/]+$/, '');
  }
  return String(input.sourceDir || '').trim();
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
    return { failure: discoverFailures[0] || null };
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

export type ModsPanelMod = MarketplaceMod & {
  isCrashed: boolean;
  crashReason: string;
  status: 'loaded' | 'disabled' | 'failed' | 'conflict';
  sourceType: 'installed' | 'dev' | 'unknown';
  sourceDir: string;
  modDirPath: string;
};

export type ModsPanelModel = {
  searchQuery: string;
  enabledMods: ModsPanelMod[];
  disabledMods: ModsPanelMod[];
  pendingModId: string | null;
  onSearchQueryChange: (value: string) => void;
  onOpenMod: (modId: string) => void;
  onEnableMod: (modId: string) => void;
  onDisableMod: (modId: string) => void;
  onUninstallMod: (modId: string) => void;
  onRetryMod: (modId: string) => void;
  onOpenModSettings: (modId: string) => void;
  onOpenModDir: (path: string) => void;
  onOpenModDeveloper: () => void;
  onOpenMarketplace: () => void;
};

export function useModsPanelModel(): ModsPanelModel {
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingModId, setPendingModId] = useState<string | null>(null);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const openModWorkspaceTab = useAppStore((state) => state.openModWorkspaceTab);
  const closeModWorkspaceTab = useAppStore((state) => state.closeModWorkspaceTab);
  const localManifestSummaries = useAppStore((state) => state.localManifestSummaries);
  const registeredRuntimeModIds = useAppStore((state) => state.registeredRuntimeModIds);
  const runtimeModDisabledIds = useAppStore((state) => state.runtimeModDisabledIds);
  const runtimeModUninstalledIds = useAppStore((state) => state.runtimeModUninstalledIds);
  const runtimeModDiagnostics = useAppStore((state) => state.runtimeModDiagnostics);
  const fusedRuntimeMods = useAppStore((state) => state.fusedRuntimeMods);
  const clearRuntimeModFuse = useAppStore((state) => state.clearRuntimeModFuse);

  const allMods = useMemo(() => {
    const registeredSet = new Set(registeredRuntimeModIds.map((id) => normalizeModId(id)).filter(Boolean));
    const disabledSet = new Set(runtimeModDisabledIds.map((id) => normalizeModId(id)).filter(Boolean));
    const uninstalledSet = new Set(runtimeModUninstalledIds.map((id) => normalizeModId(id)).filter(Boolean));

    const conflictById = new Map(
      runtimeModDiagnostics
        .filter((item) => item.status === 'conflict')
        .map((item) => [normalizeModId(item.modId), item] as const),
    );
    const resolvedRows = localManifestSummaries
      .filter((item) => !String(item.id || '').startsWith('core.'))
      .filter((item) => !uninstalledSet.has(normalizeModId(String(item.id || ''))))
      .map((item, index) => {
        const modId = normalizeModId(String(item.id || ''));
        const isInstalled = true;
        const isEnabled = !disabledSet.has(modId) && registeredSet.has(modId);
        const base = toRuntimeModRow(item, index, { isInstalled, isEnabled });
        const fuseInfo = fusedRuntimeMods[modId];
        const conflict = conflictById.get(modId);
        const status = conflict
          ? 'conflict'
          : fuseInfo
            ? 'failed'
            : isEnabled
              ? 'loaded'
              : 'disabled';
        return {
          ...base,
          runtimeStatus: status,
          runtimeConflict: Boolean(conflict),
          isCrashed: Boolean(fuseInfo),
          crashReason: conflict?.error || (fuseInfo ? fuseInfo.lastError : ''),
          status,
          sourceType: item.sourceType || 'unknown',
          sourceDir: item.sourceDir || '',
          modDirPath: resolveModDirPath({
            manifestPath: item.path,
            sourceDir: item.sourceDir || '',
          }),
        } satisfies ModsPanelMod;
      });
    const resolvedIds = new Set(resolvedRows.map((item) => item.id));
    const conflictRows = Array.from(conflictById.values())
      .filter((item) => !resolvedIds.has(normalizeModId(item.modId)))
      .map((item) => ({
        id: normalizeModId(item.modId),
        name: normalizeModId(item.modId),
        description: item.error || 'Duplicate mod id detected across enabled sources',
        author: 'Conflict',
        version: 'conflict',
        iconBg: 'linear-gradient(135deg, #f59e0b, #ea580c)',
        iconText: '!!',
        source: 'runtime',
        runtimeStatus: 'conflict',
        runtimeSourceType: item.sourceType,
        runtimeSourceDir: item.sourceDir,
        runtimeConflict: true,
        isInstalled: true,
        isEnabled: false,
        publisherVerified: false,
        isCrashed: false,
        crashReason: item.error || '',
        status: 'conflict',
        sourceType: item.sourceType || 'unknown',
        sourceDir: item.sourceDir || '',
        modDirPath: resolveModDirPath({
          manifestPath: item.manifestPath,
          sourceDir: item.sourceDir || '',
        }),
      } satisfies ModsPanelMod));
    return [...resolvedRows, ...conflictRows];
  }, [
    localManifestSummaries,
    registeredRuntimeModIds,
    runtimeModDisabledIds,
    runtimeModUninstalledIds,
    runtimeModDiagnostics,
    fusedRuntimeMods,
  ]);

  const filtered = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return allMods;
    return allMods.filter(
      (mod) =>
        mod.name.toLowerCase().includes(query) ||
        mod.description.toLowerCase().includes(query),
    );
  }, [searchQuery, allMods]);

  const enabledMods = useMemo(() => filtered.filter((m) => m.isEnabled), [filtered]);
  const disabledMods = useMemo(() => filtered.filter((m) => !m.isEnabled), [filtered]);

  const onOpenMod = useCallback((modId: string) => {
    const normalized = normalizeModId(modId);
    if (!normalized) return;
    const targetMod = allMods.find((item) => item.id === normalized);
    const title = targetMod?.name || normalized;
    const tabId = resolveModTabId(normalized);
    openModWorkspaceTab(tabId, title, normalized);
    setActiveTab(tabId as AppTab);
  }, [openModWorkspaceTab, allMods, setActiveTab]);

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

  const onOpenMarketplace = useCallback(() => {
    persistStoredModsPanelSection('marketplace');
    setActiveTab('mods');
  }, [setActiveTab]);

  const onOpenModDeveloper = useCallback(() => {
    try {
      localStorage.setItem(SETTINGS_SELECTED_STORAGE_KEY, 'developer');
    } catch {
      // ignore
    }
    setActiveTab('settings');
  }, [setActiveTab]);

  const onOpenModDir = useCallback((path: string) => {
    const normalized = String(path || '').trim();
    if (!normalized) return;
    void desktopBridge.openRuntimeModDir(normalized).catch((error: unknown) => {
      logRendererEvent({
        level: 'error',
        area: 'mods-panel',
        message: 'open_runtime_mod_dir_failed',
        details: {
          path: normalized,
          error: safeErrorMessage(error),
        },
      });
    });
  }, []);

  const runAction = useCallback(async (
    modId: string,
    action: string,
    task: () => Promise<void>,
  ) => {
    const normalized = normalizeModId(modId);
    if (!normalized) return;
    setPendingModId(normalized);
    try {
      await task();
      logRendererEvent({
        level: 'info',
        area: 'mods-panel',
        message: `mods-panel:action-success`,
        details: { modId: normalized, action },
      });
    } catch (error) {
      const message = safeErrorMessage(error);
      useAppStore.getState().setStatusBanner({
        kind: 'error',
        message: `Mod ${normalized} 操作失败：${message}`,
      });
      logRendererEvent({
        level: 'warn',
        area: 'mods-panel',
        message: `mods-panel:action-failed`,
        details: { modId: normalized, action, error: message },
      });
    } finally {
      setPendingModId((current) => (current === normalized ? null : current));
    }
  }, []);

  const onEnableMod = useCallback((modId: string) => {
    void runAction(modId, 'enable', async () => {
      const normalized = normalizeModId(modId);
      const appStore = useAppStore.getState();
      const manifest = appStore.localManifestSummaries.find(
        (item) => normalizeModId(item.id || '') === normalized,
      );
      if (!manifest) throw new Error('manifest not found');

      appStore.setRuntimeModUninstalledIds(withRemovedModId(appStore.runtimeModUninstalledIds, normalized));
      appStore.setRuntimeModDisabledIds(withRemovedModId(appStore.runtimeModDisabledIds, normalized));

      const result = await registerOneRuntimeMod({ manifest });
      if (result.failure) {
        appStore.setRuntimeModFailures([
          ...appStore.runtimeModFailures.filter((item) => item.modId !== normalized),
          result.failure,
        ]);
        throw new Error(result.failure.error);
      }

      appStore.setRuntimeModFailures(
        appStore.runtimeModFailures.filter((item) => item.modId !== normalized),
      );
      appStore.clearRuntimeModFuse(normalized);
      await syncRuntimeModShellState();
      appStore.setStatusBanner({ kind: 'success', message: `Mod ${normalized} 已启用` });
    });
  }, [runAction]);

  const onDisableMod = useCallback((modId: string) => {
    void runAction(modId, 'disable', async () => {
      const normalized = normalizeModId(modId);
      const modTabId = resolveModTabId(normalized);
      const appStore = useAppStore.getState();
      appStore.setRuntimeModDisabledIds(withAddedModId(appStore.runtimeModDisabledIds, normalized));
      unregisterRuntimeMods([normalized]);
      removeRuntimeModStyles(normalized);
      await syncRuntimeModShellState();
      if (appStore.activeTab === modTabId) {
        appStore.setActiveTab('mods');
      }
      appStore.closeModWorkspaceTab(modTabId);
      appStore.setStatusBanner({ kind: 'info', message: `Mod ${normalized} 已禁用` });
    });
  }, [runAction]);

  const onUninstallMod = useCallback((modId: string) => {
    void runAction(modId, 'uninstall', async () => {
      const normalized = normalizeModId(modId);
      const modTabId = resolveModTabId(normalized);
      const appStore = useAppStore.getState();
      appStore.setRuntimeModDisabledIds(withRemovedModId(appStore.runtimeModDisabledIds, normalized));
      unregisterRuntimeMods([normalized]);
      removeRuntimeModStyles(normalized);
      await desktopBridge.uninstallRuntimeMod(normalized);
      appStore.setRuntimeModUninstalledIds(withAddedModId(appStore.runtimeModUninstalledIds, normalized));
      await refreshRuntimeManifestSummaries();
      await syncRuntimeModShellState();
      appStore.setRuntimeModFailures(
        appStore.runtimeModFailures.filter((item) => item.modId !== normalized),
      );
      if (appStore.activeTab === modTabId) {
        appStore.setActiveTab('mods');
      }
      closeModWorkspaceTab(modTabId);
      appStore.setStatusBanner({ kind: 'info', message: `Mod ${normalized} 已卸载` });
    });
  }, [closeModWorkspaceTab, runAction]);

  const onRetryMod = useCallback((modId: string) => {
    const normalized = normalizeModId(modId);
    if (!normalized) return;
    clearRuntimeModFuse(normalized);
    void runAction(modId, 'retry', async () => {
      const appStore = useAppStore.getState();
      const manifest = appStore.localManifestSummaries.find(
        (item) => normalizeModId(item.id || '') === normalized,
      );
      if (!manifest) throw new Error('manifest not found');

      appStore.setRuntimeModDisabledIds(withRemovedModId(appStore.runtimeModDisabledIds, normalized));

      const result = await registerOneRuntimeMod({ manifest });
      if (result.failure) {
        appStore.setRuntimeModFailures([
          ...appStore.runtimeModFailures.filter((item) => item.modId !== normalized),
          result.failure,
        ]);
        throw new Error(result.failure.error);
      }

      appStore.setRuntimeModFailures(
        appStore.runtimeModFailures.filter((item) => item.modId !== normalized),
      );
      await syncRuntimeModShellState();
      appStore.setStatusBanner({ kind: 'success', message: `Mod ${normalized} 已恢复` });
    });
  }, [clearRuntimeModFuse, runAction]);

  return {
    searchQuery,
    enabledMods,
    disabledMods,
    pendingModId,
    onSearchQueryChange: setSearchQuery,
    onOpenMod,
    onEnableMod,
    onDisableMod,
    onUninstallMod,
    onRetryMod,
    onOpenModSettings,
    onOpenModDir,
    onOpenModDeveloper,
    onOpenMarketplace,
  };
}
