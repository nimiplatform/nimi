import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  desktopBridge,
  type CatalogConsentReason,
  type CatalogInstallResult,
  type CatalogPackageSummary,
  type RuntimeLocalManifestSummary,
} from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
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
  syncSingleRuntimeModShellState,
} from '@renderer/mod-ui/lifecycle/runtime-mod-shell-state';
import { removeRuntimeModStyles } from '@renderer/mod-ui/lifecycle/runtime-mod-styles';
import { showModTabLimitBanner } from '@renderer/mod-ui/host/mod-tab-limit-banner';
import { retryRuntimeMod } from '@renderer/mod-ui/host/retry-runtime-mod';
import { useUiExtensionContext } from '@renderer/mod-ui/host/slot-context';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import {
  buildDockMods,
  buildManagementSections,
  describeConsentReasons,
  toCatalogModRow,
  toRuntimeModRow,
  type ModHubMod,
  type ModHubPendingActionType,
  type ModHubSection,
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

function resolveOpenDirPath(input: {
  manifestPath?: string;
  sourceDir?: string;
}): string {
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
  dockMods: ModHubMod[];
  managementSections: ModHubSection[];
  pendingAction: ModHubPendingAction;
  selectedModId: string | null;
  installedModsDir: string;
  visibleModCount: number;
  installedModsCount: number;
  isSearchFocused: boolean;
  onSearchQueryChange: (value: string) => void;
  onSearchFocus: () => void;
  onSearchBlur: () => void;
  onActivateDockMod: (modId: string) => void;
  onOpenMod: (modId: string) => void;
  onInstallMod: (modId: string) => void;
  onUpdateMod: (modId: string) => void;
  onUninstallMod: (modId: string) => void;
  onEnableMod: (modId: string) => void;
  onDisableMod: (modId: string) => void;
  onRetryMod: (modId: string) => void;
  onOpenModFolder: (modId: string) => void;
  onOpenModsFolder: () => void;
  onSelectMod: (modId: string | null) => void;
};

export function useModHubPageModel(): ModHubPageModel {
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAction, setPendingAction] = useState<ModHubPendingAction>(null);
  const [selectedModId, setSelectedModId] = useState<string | null>(null);
  const [catalogMods, setCatalogMods] = useState<CatalogPackageSummary[]>([]);
  const [localIconImageSrcs, setLocalIconImageSrcs] = useState<Record<string, string>>({});
  const [installedModsDir, setInstalledModsDir] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [availableUpdates, setAvailableUpdates] = useState<Record<string, {
    version: string;
    advisoryCount: number;
    requiresUserConsent: boolean;
    consentReasons: CatalogConsentReason[];
    addedCapabilities: string[];
  }>>({});
  const uiExtensionContext = useUiExtensionContext();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const openModWorkspaceTab = useAppStore((state) => state.openModWorkspaceTab);
  const closeModWorkspaceTab = useAppStore((state) => state.closeModWorkspaceTab);
  const localManifestSummaries = useAppStore((state) => state.localManifestSummaries);
  const registeredRuntimeModIds = useAppStore((state) => state.registeredRuntimeModIds);
  const runtimeModDisabledIds = useAppStore((state) => state.runtimeModDisabledIds);
  const runtimeModUninstalledIds = useAppStore((state) => state.runtimeModUninstalledIds);
  const runtimeModFailures = useAppStore((state) => state.runtimeModFailures);
  const fusedRuntimeMods = useAppStore((state) => state.fusedRuntimeMods);
  const runtimeModDiagnostics = useAppStore((state) => state.runtimeModDiagnostics);

  useEffect(() => {
    let cancelled = false;
    void desktopBridge.getRuntimeModStorageDirs().then((dirs) => {
      if (cancelled) return;
      setInstalledModsDir(dirs.installedModsDir);
    }).catch(() => {
      if (cancelled) return;
      setInstalledModsDir('');
    });
    return () => {
      cancelled = true;
    };
  }, []);

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

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const manifestsWithIcons = localManifestSummaries
        .filter((item) => !String(item.id || '').startsWith('core.'))
        .map((item) => ({
          modId: normalizeModId(String(item.id || '')),
          iconAssetPath: String(item.iconAssetPath || '').trim(),
        }))
        .filter((item) => item.modId && item.iconAssetPath);
      if (manifestsWithIcons.length === 0) {
        if (!cancelled) {
          setLocalIconImageSrcs({});
        }
        return;
      }
      const entries = await Promise.all(manifestsWithIcons.map(async (item) => {
        try {
          const asset = await desktopBridge.readRuntimeLocalModAsset(item.iconAssetPath);
          return [item.modId, `data:${asset.mimeType};base64,${asset.base64}`] as const;
        } catch (error) {
          logRendererEvent({
            level: 'warn',
            area: 'mod-hub',
            message: 'mod-hub:icon-load-failed',
            details: {
              modId: item.modId,
              iconAssetPath: item.iconAssetPath,
              error: safeErrorMessage(error),
            },
          });
          return null;
        }
      }));
      if (cancelled) {
        return;
      }
      setLocalIconImageSrcs(Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, string]>));
    })();
    return () => {
      cancelled = true;
    };
  }, [localManifestSummaries]);

  const runtimeMods = useMemo(() => {
    const registeredSet = new Set(registeredRuntimeModIds.map((id) => normalizeModId(id)).filter(Boolean));
    const disabledSet = new Set(runtimeModDisabledIds.map((id) => normalizeModId(id)).filter(Boolean));
    const uninstalledSet = new Set(runtimeModUninstalledIds.map((id) => normalizeModId(id)).filter(Boolean));
    const diagnosticsById = new Map(runtimeModDiagnostics.map((item) => [normalizeModId(item.modId), item] as const));
    const failuresById = new Map(runtimeModFailures.map((item) => [normalizeModId(item.modId), item] as const));

    return localManifestSummaries
      .filter((item) => !String(item.id || '').startsWith('core.'))
      .map((item, index) => {
        const modId = normalizeModId(String(item.id || ''));
        const update = availableUpdates[modId];
        const isInstalled = !uninstalledSet.has(modId);
        const isEnabled = isInstalled && !disabledSet.has(modId) && registeredSet.has(modId);
        return toRuntimeModRow(item, index, {
          iconImageSrc: localIconImageSrcs[modId],
          isInstalled,
          isEnabled,
          availableUpdateVersion: update?.version,
          advisoryCount: update?.advisoryCount || 0,
          requiresUserConsent: update?.requiresUserConsent || false,
          consentReasons: update?.consentReasons || [],
          addedCapabilities: update?.addedCapabilities || [],
          diagnostic: diagnosticsById.get(modId) || null,
          failure: failuresById.get(modId) || null,
          fused: fusedRuntimeMods[modId] || null,
        });
      });
  }, [
    availableUpdates,
    fusedRuntimeMods,
    localIconImageSrcs,
    localManifestSummaries,
    registeredRuntimeModIds,
    runtimeModDiagnostics,
    runtimeModDisabledIds,
    runtimeModFailures,
    runtimeModUninstalledIds,
  ]);

  const mergedMods = useMemo(() => {
    const runtimeById = new Map(runtimeMods.map((item) => [item.id, item] as const));
    const rows: ModHubMod[] = catalogMods.map((catalogMod) => {
      const runtime = runtimeById.get(catalogMod.packageId);
      const update = availableUpdates[catalogMod.packageId];
      return toCatalogModRow(catalogMod, {
        localIconImageSrc: runtime?.iconImageSrc,
        isInstalled: Boolean(runtime?.isInstalled),
        isEnabled: Boolean(runtime?.isEnabled),
        installedVersion: runtime ? stripVersionPrefix(runtime.version) : undefined,
        availableUpdateVersion: update?.version,
        advisoryCount: update?.advisoryCount || 0,
        requiresUserConsent: update?.requiresUserConsent || false,
        consentReasons: update?.consentReasons || [],
        addedCapabilities: update?.addedCapabilities || [],
        runtimeStatus: runtime?.runtimeStatus,
        runtimeSourceType: runtime?.runtimeSourceType,
        runtimeSourceDir: runtime?.runtimeSourceDir,
        runtimeManifestPath: runtime?.runtimeManifestPath,
        runtimeError: runtime?.runtimeError,
        runtimeConflict: runtime?.runtimeConflict,
        runtimeConflictPaths: runtime?.runtimeConflictPaths,
      });
    });
    const catalogIds = new Set(rows.map((item) => item.id));
    for (const runtime of runtimeMods) {
      if (!catalogIds.has(runtime.id)) {
        rows.push(runtime);
      }
    }
    return rows;
  }, [availableUpdates, catalogMods, runtimeMods]);

  const managementSections = useMemo(() => buildManagementSections({
    mods: mergedMods,
    query: searchQuery,
  }), [mergedMods, searchQuery]);

  const filteredMods = useMemo(
    () => managementSections.flatMap((section) => section.mods),
    [managementSections],
  );

  const dockMods = useMemo(() => buildDockMods(mergedMods), [mergedMods]);

  const onSearchFocus = useCallback(() => {
    setIsSearchFocused(true);
  }, []);

  const onSearchBlur = useCallback(() => {
    setIsSearchFocused(false);
  }, []);

  const onSelectMod = useCallback((modId: string | null) => {
    setSelectedModId(modId);
  }, []);

  const onOpenMod = useCallback((modId: string) => {
    const normalized = normalizeModId(modId);
    if (!normalized) return;
    const targetMod = mergedMods.find((item) => item.id === normalized);
    const title = targetMod?.name || normalized;
    const tabId = resolveModTabId(normalized);
    const result = openModWorkspaceTab(tabId, title, normalized);
    if (result === 'rejected-limit') {
      showModTabLimitBanner({
        setStatusBanner: useAppStore.getState().setStatusBanner,
        setActiveTab: (tab) => {
          setActiveTab(tab);
        },
      });
    }
  }, [mergedMods, openModWorkspaceTab, setActiveTab]);

  const onActivateDockMod = useCallback((modId: string) => {
    const normalized = normalizeModId(modId);
    if (!normalized) return;
    const targetMod = mergedMods.find((item) => item.id === normalized);
    if (!targetMod) return;
    if (targetMod.canOpenFromDock) {
      onOpenMod(normalized);
      return;
    }
    setSelectedModId(normalized);
    setIsSearchFocused(true);
  }, [mergedMods, onOpenMod]);

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

  const onInstallMod = useCallback((modId: string) => {
    void runRuntimeAction(modId, 'install', async () => {
      const normalizedModId = normalizeModId(modId);
      const selected = mergedMods.find((item) => item.id === normalizedModId);
      if (!selected) {
        throw new Error('mod not found');
      }
      if (selected.source !== 'catalog') {
        throw new Error('local install flow is not available from Mod Hub');
      }
      const result = await desktopBridge.installCatalogMod({ packageId: normalizedModId });
      await finalizeInstalledManifest({
        result,
        successMessage: `Mod ${normalizedModId} 已从 catalog 安装`,
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
      await syncSingleRuntimeModShellState(normalizedModId);
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
      await syncSingleRuntimeModShellState(normalizedModId);
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
      await syncSingleRuntimeModShellState(normalizedModId, refreshedManifests);
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

  const onRetryMod = useCallback((modId: string) => {
    void runRuntimeAction(modId, 'retry', async () => {
      const normalizedModId = normalizeModId(modId);
      const appStore = useAppStore.getState();
      await retryRuntimeMod({
        modId: normalizedModId,
        context: uiExtensionContext,
        localManifestSummaries: appStore.localManifestSummaries,
        runtimeModDisabledIds: appStore.runtimeModDisabledIds,
        runtimeModUninstalledIds: appStore.runtimeModUninstalledIds,
        setRuntimeModFailures: appStore.setRuntimeModFailures,
        setStatusBanner: (banner) => {
          appStore.setStatusBanner(banner);
        },
      });
      setSelectedModId(normalizedModId);
    });
  }, [runRuntimeAction, uiExtensionContext]);

  const onOpenModFolder = useCallback((modId: string) => {
    const normalizedModId = normalizeModId(modId);
    if (!normalizedModId) return;
    const targetMod = mergedMods.find((item) => item.id === normalizedModId);
    const path = resolveOpenDirPath({
      manifestPath: targetMod?.runtimeManifestPath,
      sourceDir: targetMod?.runtimeSourceDir,
    });
    if (!path) return;
    void desktopBridge.openRuntimeModDir(path).catch((error) => {
      useAppStore.getState().setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to open mod folder',
      });
    });
  }, [mergedMods]);

  const onOpenModsFolder = useCallback(() => {
    const normalized = String(installedModsDir || '').trim();
    if (!normalized) return;
    void desktopBridge.openRuntimeModDir(normalized).catch((error) => {
      useAppStore.getState().setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to open mods folder',
      });
    });
  }, [installedModsDir]);

  return {
    searchQuery,
    filteredMods,
    dockMods,
    managementSections,
    pendingAction,
    selectedModId,
    installedModsDir,
    visibleModCount: filteredMods.length,
    installedModsCount: dockMods.length,
    isSearchFocused,
    onSearchQueryChange: setSearchQuery,
    onSearchFocus,
    onSearchBlur,
    onActivateDockMod,
    onOpenMod,
    onInstallMod,
    onUpdateMod,
    onUninstallMod,
    onEnableMod,
    onDisableMod,
    onRetryMod,
    onOpenModFolder,
    onOpenModsFolder,
    onSelectMod,
  };
}
