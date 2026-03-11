import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  desktopBridge,
  type CatalogConsentReason,
  type CatalogInstallResult,
  type CatalogPackageSummary,
  type RuntimeLocalManifestSummary,
} from '@renderer/bridge';
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
  describeConsentReasons,
  type ModHubMod,
  type ModHubPendingActionType,
  toCatalogModRow,
  toRuntimeModRow,
} from './mod-hub-model';

function normalizeModId(modId: string): string {
  return String(modId || '').trim();
}

function stripVersionPrefix(value: string | undefined): string {
  return String(value || '').trim().replace(/^v/i, '');
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

function formatConsentSummary(input: {
  consentReasons?: readonly CatalogConsentReason[];
  addedCapabilities?: readonly string[];
}): string {
  const reasonLabels = describeConsentReasons(input.consentReasons);
  const details: string[] = [];
  if (reasonLabels.length > 0) {
    details.push(reasonLabels.join(', '));
  }
  if (Array.isArray(input.addedCapabilities) && input.addedCapabilities.length > 0) {
    details.push(`New capabilities: ${input.addedCapabilities.join(', ')}`);
  }
  return details.join('. ');
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

export type ModHubPendingAction = {
  modId: string;
  action: ModHubPendingActionType;
} | null;

export type ModHubPageModel = {
  searchQuery: string;
  filteredMods: ModHubMod[];
  pendingAction: ModHubPendingAction;
  selectedModId: string | null;
  pathSource: string;
  urlSource: string;
  onSearchQueryChange: (value: string) => void;
  onOpenMod: (modId: string) => void;
  onInstallMod: (modId: string) => void;
  onUpdateMod: (modId: string) => void;
  onUninstallMod: (modId: string) => void;
  onEnableMod: (modId: string) => void;
  onDisableMod: (modId: string) => void;
  onOpenModSettings: (modId: string) => void;
  onSelectMod: (modId: string | null) => void;
  onPathSourceChange: (value: string) => void;
  onUrlSourceChange: (value: string) => void;
  onInstallFromPath: () => void;
  onInstallFromUrl: () => void;
};

export function useModHubPageModel(): ModHubPageModel {
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAction, setPendingAction] = useState<ModHubPendingAction>(null);
  const [selectedModId, setSelectedModId] = useState<string | null>(null);
  const [pathSource, setPathSource] = useState('');
  const [urlSource, setUrlSource] = useState('');
  const [catalogMods, setCatalogMods] = useState<CatalogPackageSummary[]>([]);
  const [availableUpdates, setAvailableUpdates] = useState<Record<string, {
    version: string;
    advisoryCount: number;
    requiresUserConsent: boolean;
    consentReasons: CatalogConsentReason[];
    addedCapabilities: string[];
  }>>({});
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const openModWorkspaceTab = useAppStore((state) => state.openModWorkspaceTab);
  const closeModWorkspaceTab = useAppStore((state) => state.closeModWorkspaceTab);
  const localManifestSummaries = useAppStore((state) => state.localManifestSummaries);
  const registeredRuntimeModIds = useAppStore((state) => state.registeredRuntimeModIds);
  const runtimeModDisabledIds = useAppStore((state) => state.runtimeModDisabledIds);
  const runtimeModUninstalledIds = useAppStore((state) => state.runtimeModUninstalledIds);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [catalogList, updates] = await Promise.all([
          desktopBridge.listCatalogMods(),
          desktopBridge.checkModUpdates(),
        ]);
        if (cancelled) return;
        setCatalogMods(catalogList);
        setAvailableUpdates(Object.fromEntries(updates.map((item) => [
          item.packageId,
          {
            version: item.targetVersion,
            advisoryCount: item.advisoryIds.length,
            requiresUserConsent: item.requiresUserConsent,
            consentReasons: item.consentReasons,
            addedCapabilities: item.addedCapabilities,
          },
        ])));
      } catch {
        if (cancelled) return;
        setCatalogMods([]);
        setAvailableUpdates({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [localManifestSummaries]);

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

  const mergedMods = useMemo(() => {
    const runtimeById = new Map(runtimeMods.map((item) => [item.id, item] as const));
    const rows: ModHubMod[] = catalogMods.map((catalogMod) => {
      const runtime = runtimeById.get(catalogMod.packageId);
      const update = availableUpdates[catalogMod.packageId];
      return {
        ...toCatalogModRow(catalogMod, {
          isInstalled: Boolean(runtime?.isInstalled),
          isEnabled: Boolean(runtime?.isEnabled),
          installedVersion: runtime ? stripVersionPrefix(runtime.version) : undefined,
          availableUpdateVersion: update?.version,
          advisoryCount: update?.advisoryCount || 0,
          requiresUserConsent: update?.requiresUserConsent || false,
          consentReasons: update?.consentReasons || [],
          addedCapabilities: update?.addedCapabilities || [],
        }),
        runtimeStatus: runtime?.runtimeStatus,
        runtimeSourceType: runtime?.runtimeSourceType,
        runtimeSourceDir: runtime?.runtimeSourceDir,
      };
    });
    const catalogIds = new Set(rows.map((item) => item.id));
    for (const runtime of runtimeMods) {
      if (!catalogIds.has(runtime.id)) {
        rows.push({
          ...runtime,
          availableUpdateVersion: availableUpdates[runtime.id]?.version,
          advisoryCount: availableUpdates[runtime.id]?.advisoryCount || 0,
          requiresUserConsent: availableUpdates[runtime.id]?.requiresUserConsent || false,
          consentReasons: availableUpdates[runtime.id]?.consentReasons || [],
          addedCapabilities: availableUpdates[runtime.id]?.addedCapabilities || [],
        });
      }
    }
    return rows;
  }, [availableUpdates, catalogMods, runtimeMods]);

  const filteredMods = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    const mods = (query
      ? mergedMods.filter(
          (mod) =>
            mod.name.toLowerCase().includes(query)
            || mod.description.toLowerCase().includes(query)
            || mod.author.toLowerCase().includes(query)
            || normalizeModId(mod.catalogPackageId || '').toLowerCase().includes(query),
        )
      : mergedMods).slice();
    return mods.sort((a, b) => {
      const aScore = a.isInstalled ? (a.availableUpdateVersion ? 3 : a.isEnabled ? 2 : 1) : 0;
      const bScore = b.isInstalled ? (b.availableUpdateVersion ? 3 : b.isEnabled ? 2 : 1) : 0;
      if (aScore !== bScore) return bScore - aScore;
      return a.name.localeCompare(b.name);
    });
  }, [searchQuery, mergedMods]);

  const onSelectMod = useCallback((modId: string | null) => {
    setSelectedModId(modId);
  }, []);

  const onOpenMod = useCallback((modId: string) => {
    const normalized = normalizeModId(modId);
    if (!normalized) return;
    const targetMod = mergedMods.find((item) => item.id === normalized);
    const title = targetMod?.name || normalized;
    const tabId = resolveModTabId(normalized);
    openModWorkspaceTab(tabId, title, normalized);
    setActiveTab(tabId as AppTab);
  }, [mergedMods, openModWorkspaceTab, setActiveTab]);

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
    action: ModHubPendingActionType,
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
        area: 'mod-hub',
        message: 'mod-hub:runtime-mod:action-success',
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
        area: 'mod-hub',
        message: 'mod-hub:runtime-mod:action-failed',
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

  const finalizeInstalledManifest = useCallback(async (input: {
    result: CatalogInstallResult;
    successMessage: string;
    rollbackOnFailure?: boolean;
  }) => {
    const appStore = useAppStore.getState();
    const result = input.result.install;
    appStore.setRuntimeModUninstalledIds(withRemovedModId(appStore.runtimeModUninstalledIds, result.modId));
    appStore.setRuntimeModDisabledIds(withRemovedModId(appStore.runtimeModDisabledIds, result.modId));
    const refreshedManifests = await refreshRuntimeManifestSummaries();
    const manifest = refreshedManifests.find((item) => normalizeModId(item.id) === result.modId) || result.manifest;
    if (!input.result.requiresUserConsent) {
      const registration = await registerOneRuntimeMod({ manifest });
      if (registration.failure) {
        if (input.rollbackOnFailure && result.rollbackPath) {
          const restored = await desktopBridge.restoreRuntimeModBackup({
            modId: result.modId,
            backupPath: result.rollbackPath,
          });
          await registerOneRuntimeMod({ manifest: restored });
          await syncRuntimeModShellState(await refreshRuntimeManifestSummaries());
          throw new Error(`update registration failed and rollback restored previous version: ${registration.failure.error}`);
        }
        throw new Error(registration.failure.error);
      }
    } else {
      appStore.setRuntimeModDisabledIds(withAddedModId(appStore.runtimeModDisabledIds, result.modId));
      unregisterRuntimeMods([result.modId]);
      removeRuntimeModStyles(result.modId);
    }
    await syncRuntimeModShellState(refreshedManifests);
    setSelectedModId(result.modId);
    const consentSummary = formatConsentSummary({
      consentReasons: input.result.consentReasons,
      addedCapabilities: input.result.addedCapabilities,
    });
    appStore.setStatusBanner({
      kind: input.result.requiresUserConsent || input.result.advisoryIds.length > 0 ? 'warning' : 'success',
      message: input.result.requiresUserConsent
        ? `Mod ${result.modId} 已安装，但需要重新确认后才会启用${consentSummary ? `：${consentSummary}` : ''}`
        : input.successMessage,
    });
  }, []);

  const installFromSource = useCallback(async (
    source: string,
    sourceKind: 'directory' | 'archive' | 'url',
  ) => {
    const appStore = useAppStore.getState();
    const result = await desktopBridge.installRuntimeMod({
      source,
      sourceKind,
      replaceExisting: false,
    });
    appStore.setRuntimeModUninstalledIds(withRemovedModId(appStore.runtimeModUninstalledIds, result.modId));
    appStore.setRuntimeModDisabledIds(withRemovedModId(appStore.runtimeModDisabledIds, result.modId));

    const refreshedManifests = await refreshRuntimeManifestSummaries();
    const manifest = refreshedManifests.find((item) => normalizeModId(item.id) === result.modId) || result.manifest;
    const registration = await registerOneRuntimeMod({ manifest });
    if (registration.failure) {
      appStore.setRuntimeModFailures([
        ...appStore.runtimeModFailures.filter((item) => item.modId !== result.modId),
        registration.failure,
      ]);
      throw new Error(registration.failure.error);
    }

    appStore.setRuntimeModFailures(
      appStore.runtimeModFailures.filter((item) => item.modId !== result.modId),
    );
    appStore.clearRuntimeModFuse(result.modId);
    await syncRuntimeModShellState(refreshedManifests);
    setSelectedModId(result.modId);
    appStore.setStatusBanner({
      kind: 'success',
      message: `Mod ${result.modId} 已安装并启用`,
    });
  }, []);

  const onInstallMod = useCallback((modId: string) => {
    void runRuntimeAction(modId, 'install', async () => {
      const normalizedModId = normalizeModId(modId);
      const selected = mergedMods.find((item) => item.id === normalizedModId);
      if (!selected) {
        throw new Error('mod not found');
      }
      if (selected.source === 'catalog') {
        const result = await desktopBridge.installCatalogMod({ packageId: normalizedModId });
        await finalizeInstalledManifest({
          result,
          successMessage: `Mod ${normalizedModId} 已从 catalog 安装`,
        });
        return;
      }

      const appStore = useAppStore.getState();
      const manifest = appStore.localManifestSummaries.find((item) => normalizeModId(item.id || '') === normalizedModId);
      if (!manifest) {
        throw new Error('manifest not found');
      }
      appStore.setRuntimeModUninstalledIds(withRemovedModId(appStore.runtimeModUninstalledIds, normalizedModId));
      appStore.setRuntimeModDisabledIds(withRemovedModId(appStore.runtimeModDisabledIds, normalizedModId));
      const result = await registerOneRuntimeMod({ manifest });
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
      await syncRuntimeModShellState();
      appStore.setStatusBanner({
        kind: 'success',
        message: `Mod ${normalizedModId} 已安装并启用`,
      });
    });
  }, [finalizeInstalledManifest, mergedMods, runRuntimeAction]);

  const onUpdateMod = useCallback((modId: string) => {
    void runRuntimeAction(modId, 'update', async () => {
      const normalizedModId = normalizeModId(modId);
      unregisterRuntimeMods([normalizedModId]);
      removeRuntimeModStyles(normalizedModId);
      const result = await desktopBridge.updateInstalledMod({ packageId: normalizedModId });
      await finalizeInstalledManifest({
        result,
        successMessage: `Mod ${normalizedModId} 已更新到 ${result.release.version}`,
        rollbackOnFailure: true,
      });
    });
  }, [finalizeInstalledManifest, runRuntimeAction]);

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

      const result = await registerOneRuntimeMod({ manifest });
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
      await syncRuntimeModShellState();
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
      removeRuntimeModStyles(normalizedModId);
      await syncRuntimeModShellState();
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
      appStore.setRuntimeModDisabledIds(withRemovedModId(appStore.runtimeModDisabledIds, normalizedModId));
      unregisterRuntimeMods([normalizedModId]);
      removeRuntimeModStyles(normalizedModId);
      await desktopBridge.uninstallRuntimeMod(normalizedModId);
      appStore.setRuntimeModUninstalledIds(withAddedModId(appStore.runtimeModUninstalledIds, normalizedModId));
      const refreshedManifests = await refreshRuntimeManifestSummaries();
      await syncRuntimeModShellState(refreshedManifests);
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

  const onInstallFromPath = useCallback(() => {
    void runRuntimeAction('manual:path', 'install-from-path', async () => {
      const normalizedSource = pathSource.trim();
      if (!normalizedSource) {
        throw new Error('path is required');
      }
      const sourceKind = /^https?:\/\//i.test(normalizedSource)
        ? 'url'
        : normalizedSource.endsWith('.zip')
          ? 'archive'
          : 'directory';
      await installFromSource(normalizedSource, sourceKind);
      setPathSource('');
    });
  }, [installFromSource, pathSource, runRuntimeAction]);

  const onInstallFromUrl = useCallback(() => {
    void runRuntimeAction('manual:url', 'install-from-url', async () => {
      const normalizedSource = urlSource.trim();
      if (!normalizedSource) {
        throw new Error('url is required');
      }
      await installFromSource(normalizedSource, 'url');
      setUrlSource('');
    });
  }, [installFromSource, runRuntimeAction, urlSource]);

  return {
    searchQuery,
    filteredMods,
    pendingAction,
    selectedModId,
    pathSource,
    urlSource,
    onSearchQueryChange: setSearchQuery,
    onOpenMod,
    onInstallMod,
    onUpdateMod,
    onUninstallMod,
    onEnableMod,
    onDisableMod,
    onOpenModSettings,
    onSelectMod,
    onPathSourceChange: setPathSource,
    onUrlSourceChange: setUrlSource,
    onInstallFromPath,
    onInstallFromUrl,
  };
}
