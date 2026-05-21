/**
 * Developer Tools — mod / developer source directory management (`D-DEV-003`).
 *
 * `D-DEV-003` requires the `Developer Tools` surface to host mod / developer
 * source directory management with an auto-reload toggle. This section is the
 * superseding home of the previously orphaned `DeveloperPage` content: the
 * same mod-source registration, auto-reload, reload-all, and mod source
 * diagnostics, now reachable ONLY inside `Developer Tools` and only when
 * admitted Developer Mode is on (`D-DEV-003`, `D-DEV-007`).
 *
 * Mod state is read through the existing renderer feature layer
 * (`runtime-mod-shell-state`, `desktopBridge`) — this section never edits the
 * mod bridge or `runtime_mod` host.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { refreshRuntimeModDeveloperHostState } from '@renderer/mod-ui/lifecycle/runtime-mod-shell-state';
import { reconcileRuntimeLocalMods } from '@renderer/mod-ui/lifecycle/runtime-mod-developer-host';
import {
  Button,
  FormFeedback,
  PageShell,
  SectionTitle,
  StatusBadge,
} from '@renderer/features/settings/settings-layout-components.js';
import type { InlineFeedbackState } from '@renderer/ui/feedback/inline-feedback';

function sourceStatusTone(status: 'resolved' | 'conflict' | 'invalid'): 'success' | 'warning' | 'error' {
  switch (status) {
    case 'resolved':
      return 'success';
    case 'conflict':
      return 'warning';
    default:
      return 'error';
  }
}

function resolveOpenDirPath(input: { manifestPath?: string; sourceDir?: string }): string {
  const manifestPath = String(input.manifestPath || '').trim();
  if (manifestPath) {
    return manifestPath.replace(/[\\/][^\\/]+$/, '');
  }
  return String(input.sourceDir || '').trim();
}

export function DeveloperModSourcesSection() {
  const { t } = useTranslation();
  const runtimeModSources = useAppStore((state) => state.runtimeModSources);
  const runtimeModDeveloperMode = useAppStore((state) => state.runtimeModDeveloperMode);
  const runtimeModDiagnostics = useAppStore((state) => state.runtimeModDiagnostics);
  const runtimeModRecentReloads = useAppStore((state) => state.runtimeModRecentReloads);
  const [sourceDirInput, setSourceDirInput] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<InlineFeedbackState | null>(null);

  useEffect(() => {
    void refreshRuntimeModDeveloperHostState();
    void desktopBridge.getRuntimeModStorageDirs().catch((error) => {
      logRendererEvent({
        level: 'warn',
        area: 'settings-developer',
        message: 'get-runtime-mod-storage-dirs:failed',
        details: {
          error: error instanceof Error ? error.message : String(error || ''),
        },
      });
    });
  }, []);

  const sourceSummary = useMemo(() => ({
    total: runtimeModSources.length,
    dev: runtimeModSources.filter((item) => item.sourceType === 'dev').length,
    enabled: runtimeModSources.filter((item) => item.enabled).length,
  }), [runtimeModSources]);

  const issueDiagnostics = useMemo(
    () => runtimeModDiagnostics.filter((item) => item.status !== 'resolved'),
    [runtimeModDiagnostics],
  );

  const saveDeveloperMode = async (next: {
    enabled: boolean;
    autoReloadEnabled?: boolean;
  }) => {
    setSaving(true);
    try {
      const state = await desktopBridge.setRuntimeModDeveloperMode(next);
      useAppStore.getState().setRuntimeModDeveloperMode(state);
      setFeedback({
        kind: 'success',
        message: t('DeveloperSettings.settingsUpdated'),
      });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : t('DeveloperSettings.settingsUpdateFailed'),
      });
    } finally {
      setSaving(false);
    }
  };

  const addSource = async () => {
    const sourceDir = sourceDirInput.trim();
    if (!sourceDir) {
      setFeedback({ kind: 'warning', message: t('DeveloperSettings.enterSourceDirFirst') });
      return;
    }
    setSaving(true);
    try {
      await desktopBridge.upsertRuntimeModSource({
        sourceType: 'dev',
        sourceDir,
        enabled: true,
      });
      await refreshRuntimeModDeveloperHostState();
      setSourceDirInput('');
      setFeedback({ kind: 'success', message: t('DeveloperSettings.sourceAdded') });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : t('DeveloperSettings.sourceAddFailed'),
      });
    } finally {
      setSaving(false);
    }
  };

  const toggleSourceEnabled = async (sourceId: string, enabled: boolean) => {
    const source = runtimeModSources.find((item) => item.sourceId === sourceId);
    if (!source || source.isDefault) {
      return;
    }
    setSaving(true);
    try {
      await desktopBridge.upsertRuntimeModSource({
        sourceId: source.sourceId,
        sourceType: 'dev',
        sourceDir: source.sourceDir,
        enabled,
      });
      await refreshRuntimeModDeveloperHostState();
      setFeedback(null);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : t('DeveloperSettings.sourceUpdateFailed'),
      });
    } finally {
      setSaving(false);
    }
  };

  const removeSource = async (sourceId: string) => {
    setSaving(true);
    try {
      await desktopBridge.removeRuntimeModSource(sourceId);
      await refreshRuntimeModDeveloperHostState();
      setFeedback({ kind: 'success', message: t('DeveloperSettings.sourceRemoved') });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : t('DeveloperSettings.sourceRemoveFailed'),
      });
    } finally {
      setSaving(false);
    }
  };

  const reloadAll = async () => {
    setSaving(true);
    try {
      await desktopBridge.reloadAllRuntimeMods();
      await refreshRuntimeModDeveloperHostState();
      await reconcileRuntimeLocalMods();
      setFeedback({ kind: 'success', message: t('DeveloperSettings.reloadSuccess') });
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : t('DeveloperSettings.reloadFailed'),
      });
    } finally {
      setSaving(false);
    }
  };

  const openModDir = async (path: string) => {
    const normalized = String(path || '').trim();
    if (!normalized) {
      return;
    }
    try {
      await desktopBridge.openRuntimeModDir(normalized);
    } catch (error) {
      setFeedback({
        kind: 'error',
        message: error instanceof Error ? error.message : t('DeveloperSettings.openModDirFailed'),
      });
    }
  };

  return (
    <PageShell
      title={t('DeveloperSettings.pageTitle')}
      description={t('DeveloperSettings.pageDescription')}
      contentClassName="max-w-4xl"
    >
      <FormFeedback feedback={feedback} onDismiss={() => setFeedback(null)} title={t('DeveloperSettings.pageTitle')} />
      <section className="mt-8">
        <SectionTitle>{t('DeveloperSettings.modeTitle')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1 text-sm text-gray-600">
              <p>{t('DeveloperSettings.modeDescription')}</p>
              <p>{t('DeveloperSettings.sourceSummary', sourceSummary)}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant={runtimeModDeveloperMode.enabled ? 'secondary' : 'primary'}
                onClick={() => {
                  void saveDeveloperMode({
                    enabled: !runtimeModDeveloperMode.enabled,
                    autoReloadEnabled: runtimeModDeveloperMode.autoReloadEnabled,
                  });
                }}
                disabled={saving}
              >
                {runtimeModDeveloperMode.enabled
                  ? t('DeveloperSettings.disableDeveloperMode')
                  : t('DeveloperSettings.enableDeveloperMode')}
              </Button>
              <Button
                variant={runtimeModDeveloperMode.autoReloadEnabled ? 'secondary' : 'primary'}
                onClick={() => {
                  void saveDeveloperMode({
                    enabled: runtimeModDeveloperMode.enabled,
                    autoReloadEnabled: !runtimeModDeveloperMode.autoReloadEnabled,
                  });
                }}
                disabled={saving}
              >
                {runtimeModDeveloperMode.autoReloadEnabled
                  ? t('DeveloperSettings.disableAutoReload')
                  : t('DeveloperSettings.enableAutoReload')}
              </Button>
              <Button variant="secondary" onClick={() => { void reloadAll(); }} disabled={saving}>
                {t('DeveloperSettings.reloadAll')}
              </Button>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle>{t('DeveloperSettings.addSourceTitle')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white p-5 shadow-sm space-y-4">
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <input
              value={sourceDirInput}
              onChange={(event) => setSourceDirInput(event.target.value)}
              placeholder={t('DeveloperSettings.sourcePathPlaceholder')}
              className="rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
            />
            <Button onClick={() => { void addSource(); }} disabled={saving}>{t('DeveloperSettings.addSourceButton')}</Button>
          </div>
          <p className="text-xs text-gray-500">
            {t('DeveloperSettings.sourceHelp')}
          </p>
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle>{t('DeveloperSettings.registeredSourcesTitle')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {runtimeModSources.map((source, index) => (
            <React.Fragment key={source.sourceId}>
              {index > 0 && <div className="h-px bg-gray-100 mx-5" />}
              <div className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-gray-900">{source.sourceType}</span>
                      {source.isDefault ? <StatusBadge status="info" text={t('DeveloperSettings.defaultBadge')} /> : null}
                      {source.enabled
                        ? <StatusBadge status="success" text={t('DeveloperSettings.enabledBadge')} />
                        : <StatusBadge status="warning" text={t('DeveloperSettings.disabledBadge')} />}
                    </div>
                    <p className="break-all text-sm text-gray-600">{source.sourceDir}</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => { void openModDir(source.sourceDir); }}
                      disabled={saving}
                    >
                      {t('DeveloperSettings.openSourceDir')}
                    </Button>
                    {!source.isDefault ? (
                      <Button
                        variant="secondary"
                        onClick={() => { void toggleSourceEnabled(source.sourceId, !source.enabled); }}
                        disabled={saving}
                      >
                        {source.enabled ? t('DeveloperSettings.disableSource') : t('DeveloperSettings.enableSource')}
                      </Button>
                    ) : null}
                    {!source.isDefault ? (
                      <Button
                        variant="danger"
                        onClick={() => { void removeSource(source.sourceId); }}
                        disabled={saving}
                      >
                        {t('DeveloperSettings.removeSource')}
                      </Button>
                    ) : null}
                  </div>
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle>{t('DeveloperSettings.diagnosticsTitle')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {issueDiagnostics.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">{t('DeveloperSettings.noDiagnostics')}</div>
          ) : issueDiagnostics.map((record, index) => (
            <React.Fragment key={`${record.sourceId}:${record.modId}:${record.status}:${record.manifestPath || 'none'}`}>
              {index > 0 && <div className="h-px bg-gray-100 mx-5" />}
              <div className="p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{record.modId}</span>
                    <StatusBadge status={sourceStatusTone(record.status)} text={record.status} />
                    <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                      {record.sourceType}
                    </span>
                  </div>
                  <Button
                    variant="secondary"
                    onClick={() => { void openModDir(resolveOpenDirPath(record)); }}
                    disabled={saving}
                  >
                    {t('DeveloperSettings.openModDir')}
                  </Button>
                </div>
                <div className="mt-2 space-y-1 text-xs text-gray-600">
                  <p className="break-all">{record.error || t('DeveloperSettings.diagnosticsNeedsAttention')}</p>
                </div>
              </div>
            </React.Fragment>
          ))}
        </div>
      </section>

      <section className="mt-8">
        <SectionTitle>{t('DeveloperSettings.recentReloadsTitle')}</SectionTitle>
        <div className="mt-3 rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {runtimeModRecentReloads.length === 0 ? (
            <div className="p-4 text-sm text-gray-500">{t('DeveloperSettings.noRecentReloads')}</div>
          ) : runtimeModRecentReloads.slice().reverse().slice(0, 12).map((record, index) => (
            <React.Fragment key={`${record.sourceId}:${record.modId}:${record.occurredAt}`}>
              {index > 0 && <div className="h-px bg-gray-100 mx-5" />}
              <div className="p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-gray-900">{record.modId}</span>
                  <StatusBadge status={sourceStatusTone(record.status)} text={record.status} />
                  <span className="text-xs text-gray-500">{record.occurredAt}</span>
                </div>
                {record.error ? <p className="mt-2 text-xs text-red-600">{record.error}</p> : null}
              </div>
            </React.Fragment>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
