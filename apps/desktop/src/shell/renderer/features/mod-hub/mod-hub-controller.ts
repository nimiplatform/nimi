import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  desktopBridge,
  type CatalogConsentReason,
  type CatalogInstallResult,
  type CatalogPackageSummary,
  type RuntimeModInstallProgressEvent,
} from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { unregisterRuntimeMods } from '@runtime/mod';
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
  persistStoredSettingsModId,
  persistStoredSettingsSelected,
} from '@renderer/features/settings/settings-storage';
import {
  buildDockMods,
  buildManagementSections,
  toCatalogModRow,
  toRuntimeModRow,
  type ModHubPendingActionType,
} from './mod-hub-model';
import {
  clearPendingReconsentRecord,
  formatConsentSummary,
  readPendingReconsentRecords,
  requireModHubEnableReconsent,
  writePendingReconsentRecord,
  type ModHubReconsentRecord,
} from './mod-hub-reconsent';
import { buildModHubIssueSummary, normalizeModId, registerOneRuntimeMod, resolveOpenDirPath, safeErrorMessage, stripVersionPrefix, tModHub, withAddedModId, withRemovedModId } from './mod-hub-controller-helpers';
import type { ModHubPageModel, ModHubPendingAction } from './mod-hub-controller-types'; export type { ModHubPageModel } from './mod-hub-controller-types';

export function useModHubPageModel(): ModHubPageModel {
  const [searchQuery, setSearchQuery] = useState('');
  const [pendingAction, setPendingAction] = useState<ModHubPendingAction>(null);
  const [selectedModId, setSelectedModId] = useState<string | null>(null);
  const [catalogMods, setCatalogMods] = useState<CatalogPackageSummary[]>([]);
  const [localIconImageSrcs, setLocalIconImageSrcs] = useState<Record<string, string>>({});
  const [installedModsDir, setInstalledModsDir] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [pendingReconsentByModId, setPendingReconsentByModId] = useState<Record<string, ModHubReconsentRecord>>(
    () => readPendingReconsentRecords(),
  );
  const [availableUpdates, setAvailableUpdates] = useState<Record<string, {
    version: string;
    advisoryCount: number;
    requiresUserConsent: boolean;
    consentReasons: CatalogConsentReason[];
    addedCapabilities: string[];
  }>>({});
  const handledInstallProgressSessions = useRef<Set<string>>(new Set());
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
  const modsFeedback = useAppStore((state) => state.modsFeedback);
  const setModsFeedback = useAppStore((state) => state.setModsFeedback);

  const refreshPendingReconsentByModId = useCallback(() => {
    setPendingReconsentByModId(readPendingReconsentRecords());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void desktopBridge.getRuntimeModStorageDirs().then((dirs) => {
      if (cancelled) return;
      setInstalledModsDir(dirs.installedModsDir);
      setStorageReady(true);
    }).catch(() => {
      if (cancelled) return;
      setInstalledModsDir('');
      setStorageReady(true);
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
        setCatalogReady(true);
      } catch {
        if (cancelled) return;
        setCatalogMods([]);
        setAvailableUpdates({});
        setCatalogReady(true);
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
        const pendingReconsent = pendingReconsentByModId[modId];
        const isInstalled = !uninstalledSet.has(modId);
        const isEnabled = isInstalled && !disabledSet.has(modId) && registeredSet.has(modId);
        return toRuntimeModRow(item, index, {
          iconImageSrc: localIconImageSrcs[modId],
          isInstalled,
          isEnabled,
          availableUpdateVersion: update?.version,
          advisoryCount: update?.advisoryCount || 0,
          requiresUserConsent: Boolean(pendingReconsent || update?.requiresUserConsent),
          consentReasons: pendingReconsent?.consentReasons || update?.consentReasons || [],
          addedCapabilities: pendingReconsent?.addedCapabilities || update?.addedCapabilities || [],
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
    pendingReconsentByModId,
    registeredRuntimeModIds,
    runtimeModDiagnostics,
    runtimeModDisabledIds,
    runtimeModFailures,
    runtimeModUninstalledIds,
  ]);

  const mergedMods = useMemo(() => {
    const runtimeById = new Map(runtimeMods.map((item) => [item.id, item] as const));
    const rows = catalogMods.map((catalogMod) => {
      const runtime = runtimeById.get(catalogMod.packageId);
      const update = availableUpdates[catalogMod.packageId];
      const pendingReconsent = pendingReconsentByModId[catalogMod.packageId];
      return toCatalogModRow(catalogMod, {
        localIconImageSrc: runtime?.iconImageSrc,
        isInstalled: Boolean(runtime?.isInstalled),
        isEnabled: Boolean(runtime?.isEnabled),
        installedVersion: runtime ? stripVersionPrefix(runtime.version) : undefined,
        availableUpdateVersion: update?.version,
        advisoryCount: update?.advisoryCount || 0,
        requiresUserConsent: Boolean(pendingReconsent || update?.requiresUserConsent),
        consentReasons: pendingReconsent?.consentReasons || update?.consentReasons || [],
        addedCapabilities: pendingReconsent?.addedCapabilities || update?.addedCapabilities || [],
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
  }, [availableUpdates, catalogMods, pendingReconsentByModId, runtimeMods]);

  const managementSections = useMemo(
    () => buildManagementSections({ mods: mergedMods, query: searchQuery }),
    [mergedMods, searchQuery],
  );

  const filteredMods = useMemo(() => managementSections.flatMap((section) => section.mods), [managementSections]);

  const dockMods = useMemo(() => buildDockMods(mergedMods), [mergedMods]);
  const loading = !storageReady || !catalogReady;
  const issueSummary = useMemo(
    () => buildModHubIssueSummary({ fusedRuntimeMods, runtimeModFailures }),
    [fusedRuntimeMods, runtimeModFailures],
  );

  const onSearchFocus = useCallback(() => setIsSearchFocused(true), []);
  const onSearchBlur = useCallback(() => setIsSearchFocused(false), []);
  const onSelectMod = useCallback((modId: string | null) => setSelectedModId(modId), []);

  const onOpenMod = useCallback((modId: string) => {
    const normalized = normalizeModId(modId);
    if (!normalized) return;
    const targetMod = mergedMods.find((item) => item.id === normalized);
    const title = targetMod?.name || normalized;
    const tabId = resolveModTabId(normalized);
    const result = openModWorkspaceTab(tabId, title, normalized);
    if (result === 'rejected-limit') {
      showModTabLimitBanner({
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
    setPendingAction({ modId: normalizedModId, action });
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
      setModsFeedback({
        kind: 'error',
        message: tModHub('ModHub.runtimeActionFailed', {
          modId: normalizedModId,
          message,
          defaultValue: 'Mod {{modId}} action failed: {{message}}',
        }),
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
  }, [setModsFeedback]);

  const syncExistingRuntimeModAfterFailure = useCallback(async (modId: string) => {
    const normalizedModId = normalizeModId(modId);
    const refreshedManifests = await refreshRuntimeManifestSummaries();
    const manifest = refreshedManifests.find((item) => normalizeModId(item.id || '') === normalizedModId);
    const appStore = useAppStore.getState();
    const isDisabled = appStore.runtimeModDisabledIds.map(normalizeModId).includes(normalizedModId);
    const isUninstalled = appStore.runtimeModUninstalledIds.map(normalizeModId).includes(normalizedModId);
    if (manifest && !isDisabled && !isUninstalled) {
      const registration = await registerOneRuntimeMod({ manifest });
      if (registration.failure) {
        appStore.setRuntimeModFailures([
          ...appStore.runtimeModFailures.filter((item) => item.modId !== normalizedModId),
          registration.failure,
        ]);
      }
    }
    await syncRuntimeModShellState(refreshedManifests);
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
      const accepted = await desktopBridge.installCatalogMod({ packageId: normalizedModId });
      setModsFeedback({
        kind: 'info',
        message: tModHub('ModHub.installQueued', {
          modId: normalizedModId,
          installSessionId: accepted.installSessionId,
          defaultValue: 'Mod {{modId}} install queued.',
        }),
      });
    });
  }, [mergedMods, runRuntimeAction, setModsFeedback]);

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
      clearPendingReconsentRecord(result.modId);
      const registration = await registerOneRuntimeMod({ manifest });
      if (registration.failure) {
        if (input.rollbackOnFailure && result.rollbackPath) {
          const accepted = await desktopBridge.restoreRuntimeModBackup({
            modId: result.modId,
            backupPath: result.rollbackPath,
          });
          appStore.setModsFeedback({
            kind: 'warning',
            message: tModHub('ModHub.updateRollbackQueued', {
              modId: result.modId,
              installSessionId: accepted.installSessionId,
              message: registration.failure.error,
              defaultValue: 'Mod {{modId}} update registration failed; rollback queued.',
            }),
          });
          return;
        }
        throw new Error(registration.failure.error);
      }
    } else {
      writePendingReconsentRecord({
        modId: result.modId,
        version: stripVersionPrefix(String(manifest.version || '')),
        consentReasons: input.result.consentReasons,
        addedCapabilities: input.result.addedCapabilities,
        recordedAt: new Date().toISOString(),
      });
      appStore.setRuntimeModDisabledIds(withAddedModId(appStore.runtimeModDisabledIds, result.modId));
      unregisterRuntimeMods([result.modId]);
      removeRuntimeModStyles(result.modId);
    }
    refreshPendingReconsentByModId();
    appStore.setRuntimeModFailures(
      appStore.runtimeModFailures.filter((item) => item.modId !== result.modId),
    );
    appStore.clearRuntimeModFuse(result.modId);
    await syncRuntimeModShellState(refreshedManifests);
    setSelectedModId(result.modId);
    const consentSummary = formatConsentSummary({
      consentReasons: input.result.consentReasons,
      addedCapabilities: input.result.addedCapabilities,
    });
    appStore.setModsFeedback({
      kind: input.result.requiresUserConsent || input.result.advisoryIds.length > 0 ? 'warning' : 'success',
      message: input.result.requiresUserConsent
        ? tModHub('ModHub.installRequiresConsent', {
          modId: result.modId,
          consentSummary,
          defaultValue: consentSummary
            ? 'Mod {{modId}} installed, but it must be re-confirmed before enabling: {{consentSummary}}'
            : 'Mod {{modId}} installed, but it must be re-confirmed before enabling.',
        })
        : input.successMessage,
    });
  }, [refreshPendingReconsentByModId]);

  const finalizeRestoredManifest = useCallback(async (event: RuntimeModInstallProgressEvent) => {
    const restoredManifest = event.restoredManifest;
    if (!restoredManifest) return;
    const modId = normalizeModId(restoredManifest.id || event.modId || '');
    if (!modId) return;
    const appStore = useAppStore.getState();
    appStore.setRuntimeModUninstalledIds(withRemovedModId(appStore.runtimeModUninstalledIds, modId));
    appStore.setRuntimeModDisabledIds(withRemovedModId(appStore.runtimeModDisabledIds, modId));
    const registration = await registerOneRuntimeMod({ manifest: restoredManifest });
    if (registration.failure) {
      appStore.setRuntimeModFailures([
        ...appStore.runtimeModFailures.filter((item) => item.modId !== modId),
        registration.failure,
      ]);
      throw new Error(registration.failure.error);
    }
    appStore.setRuntimeModFailures(
      appStore.runtimeModFailures.filter((item) => item.modId !== modId),
    );
    const refreshedManifests = await refreshRuntimeManifestSummaries();
    await syncRuntimeModShellState(refreshedManifests);
    setSelectedModId(modId);
    appStore.setModsFeedback({
      kind: 'success',
      message: tModHub('ModHub.rollbackRestored', {
        modId,
        defaultValue: 'Mod {{modId}} rollback restored.',
      }),
    });
  }, []);

  const handleRuntimeModInstallProgress = useCallback(async (event: RuntimeModInstallProgressEvent) => {
    const status = String(event.status || '').trim();
    const sessionId = String(event.installSessionId || '').trim();
    if (!sessionId || (status !== 'completed' && status !== 'failed')) {
      return;
    }
    const completionKey = `${sessionId}:${event.catalogInstall ? 'catalog' : event.restoredManifest ? 'restore' : status}`;
    if (handledInstallProgressSessions.current.has(completionKey)) {
      return;
    }
    handledInstallProgressSessions.current.add(completionKey);
    const eventModId = normalizeModId(event.modId || event.catalogInstall?.install.modId || event.restoredManifest?.id || '');
    try {
      if (status === 'failed') {
        if (eventModId) {
          await syncExistingRuntimeModAfterFailure(eventModId);
        }
        useAppStore.getState().setModsFeedback({
          kind: 'error',
          message: tModHub('ModHub.backgroundActionFailed', {
            modId: eventModId || 'unknown',
            message: event.error || event.message || 'background operation failed',
            defaultValue: 'Mod {{modId}} background action failed: {{message}}',
          }),
        });
        return;
      }
      if (event.catalogInstall) {
        await finalizeInstalledManifest({
          result: event.catalogInstall,
          successMessage: event.operation === 'update'
            ? tModHub('ModHub.updateSuccess', {
              modId: event.catalogInstall.install.modId,
              version: event.catalogInstall.release.version,
              defaultValue: 'Mod {{modId}} updated to {{version}}',
            })
            : tModHub('ModHub.installFromCatalogSuccess', {
              modId: event.catalogInstall.install.modId,
              defaultValue: 'Mod {{modId}} installed from catalog',
            }),
          rollbackOnFailure: event.operation === 'update',
        });
        return;
      }
      if (event.restoredManifest) {
        await finalizeRestoredManifest(event);
      }
    } catch (error) {
      const message = safeErrorMessage(error);
      useAppStore.getState().setModsFeedback({
        kind: 'error',
        message: tModHub('ModHub.backgroundActionFinalizeFailed', {
          modId: eventModId || 'unknown',
          message,
          defaultValue: 'Mod {{modId}} background action completed but finalization failed: {{message}}',
        }),
      });
      logRendererEvent({
        level: 'warn',
        area: 'mod-hub',
        message: 'mod-hub:runtime-mod:background-finalize-failed',
        details: {
          modId: eventModId,
          operation: event.operation,
          installSessionId: event.installSessionId,
          error: message,
        },
      });
    }
  }, [finalizeInstalledManifest, finalizeRestoredManifest, syncExistingRuntimeModAfterFailure]);

  useEffect(() => {
    let disposed = false;
    let unsubscribe: (() => void) | null = null;
    void desktopBridge.subscribeRuntimeModInstallProgress((event) => {
      if (disposed) return;
      void handleRuntimeModInstallProgress(event);
    }).then((dispose) => {
      if (disposed) {
        dispose();
        return;
      }
      unsubscribe = dispose;
    }).catch((error) => {
      logRendererEvent({
        level: 'warn',
        area: 'mod-hub',
        message: 'mod-hub:runtime-mod:progress-subscribe-failed',
        details: {
          error: safeErrorMessage(error),
        },
      });
    });
    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, [handleRuntimeModInstallProgress]);

  const onUpdateMod = useCallback((modId: string) => {
    void runRuntimeAction(modId, 'update', async () => {
      const normalizedModId = normalizeModId(modId);
      unregisterRuntimeMods([normalizedModId]);
      removeRuntimeModStyles(normalizedModId);
      const accepted = await desktopBridge.updateInstalledMod({ packageId: normalizedModId });
      setModsFeedback({
        kind: 'info',
        message: tModHub('ModHub.updateQueued', {
          modId: normalizedModId,
          installSessionId: accepted.installSessionId,
          defaultValue: 'Mod {{modId}} update queued.',
        }),
      });
    });
  }, [runRuntimeAction, setModsFeedback]);

  const onEnableMod = useCallback((modId: string) => {
    void runRuntimeAction(modId, 'enable', async () => {
      const normalizedModId = normalizeModId(modId);
      const appStore = useAppStore.getState();
      const manifest = appStore.localManifestSummaries.find((item) => normalizeModId(item.id || '') === normalizedModId);
      if (!manifest) {
        throw new Error('manifest not found');
      }
      const reconsentRecord = pendingReconsentByModId[normalizedModId] || readPendingReconsentRecords()[normalizedModId] || null;
      requireModHubEnableReconsent({
        record: reconsentRecord,
        confirmMessage: tModHub('ModHub.enableReconsentConfirm', {
          modId: normalizedModId,
          consentSummary: formatConsentSummary(reconsentRecord || {}),
          defaultValue: 'Enable mod {{modId}} with these new permissions: {{consentSummary}}',
        }),
      });
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

      clearPendingReconsentRecord(normalizedModId);
      refreshPendingReconsentByModId();
      appStore.setRuntimeModFailures(
        appStore.runtimeModFailures.filter((item) => item.modId !== normalizedModId),
      );
      appStore.clearRuntimeModFuse(normalizedModId);
      await syncSingleRuntimeModShellState(normalizedModId);
      appStore.setModsFeedback({
        kind: 'success',
        message: tModHub('ModHub.enableSuccess', {
          modId: normalizedModId,
          defaultValue: 'Mod {{modId}} enabled',
        }),
      });
    });
  }, [pendingReconsentByModId, refreshPendingReconsentByModId, runRuntimeAction]);

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
      appStore.setModsFeedback({
        kind: 'info',
        message: tModHub('ModHub.disableSuccess', {
          modId: normalizedModId,
          defaultValue: 'Mod {{modId}} disabled',
        }),
      });
    });
  }, [runRuntimeAction]);

  const onUninstallMod = useCallback((modId: string) => {
    void runRuntimeAction(modId, 'uninstall', async () => {
      const normalizedModId = normalizeModId(modId);
      const modTabId = resolveModTabId(normalizedModId);
      const appStore = useAppStore.getState();
      appStore.setRuntimeModDisabledIds(withRemovedModId(appStore.runtimeModDisabledIds, normalizedModId));
      clearPendingReconsentRecord(normalizedModId);
      refreshPendingReconsentByModId();
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
      appStore.setModsFeedback({
        kind: 'info',
        message: tModHub('ModHub.uninstallSuccess', {
          modId: normalizedModId,
          defaultValue: 'Mod {{modId}} uninstalled',
        }),
      });
    });
  }, [closeModWorkspaceTab, refreshPendingReconsentByModId, runRuntimeAction]);

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
        setStatusBanner: appStore.setModsFeedback,
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
      useAppStore.getState().setModsFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to open mod folder',
      });
    });
  }, [mergedMods]);

  const onOpenModsFolder = useCallback(() => {
    const normalized = String(installedModsDir || '').trim();
    if (!normalized) return;
    void desktopBridge.openRuntimeModDir(normalized).catch((error) => {
      useAppStore.getState().setModsFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to open mods folder',
      });
    });
  }, [installedModsDir]);

  const onOpenModSettings = useCallback((modId: string) => {
    const normalized = normalizeModId(modId);
    if (!normalized) return;
    persistStoredSettingsSelected('extensions');
    persistStoredSettingsModId(normalized);
    setActiveTab('settings');
  }, [setActiveTab]);

  return {
    loading,
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
    feedback: modsFeedback,
    issueSummary,
    dismissFeedback: () => setModsFeedback(null),
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
    onOpenModSettings,
    onOpenModsFolder,
    onSelectMod,
  };
}
