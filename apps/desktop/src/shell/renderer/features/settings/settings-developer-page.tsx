import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { refreshRuntimeModDeveloperHostState } from '@renderer/mod-ui/lifecycle/runtime-mod-shell-state';
import { reconcileRuntimeLocalMods } from '@renderer/mod-ui/lifecycle/runtime-mod-developer-host';
import { Button, Card, PageShell, SectionTitle, StatusBadge } from './settings-layout-components';

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

export function DeveloperPage() {
  const { t } = useTranslation();
  const runtimeModSources = useAppStore((state) => state.runtimeModSources);
  const runtimeModDeveloperMode = useAppStore((state) => state.runtimeModDeveloperMode);
  const runtimeModDiagnostics = useAppStore((state) => state.runtimeModDiagnostics);
  const runtimeModRecentReloads = useAppStore((state) => state.runtimeModRecentReloads);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [sourceDirInput, setSourceDirInput] = useState('');
  const [nimiDataDirInput, setNimiDataDirInput] = useState('');
  const [resolvedNimiDir, setResolvedNimiDir] = useState('');
  const [resolvedNimiDataDir, setResolvedNimiDataDir] = useState('');
  const [resolvedInstalledModsDir, setResolvedInstalledModsDir] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void refreshRuntimeModDeveloperHostState();
    void desktopBridge.getRuntimeModStorageDirs().then((dirs) => {
      setResolvedNimiDir(dirs.nimiDir);
      setResolvedNimiDataDir(dirs.nimiDataDir);
      setResolvedInstalledModsDir(dirs.installedModsDir);
      setNimiDataDirInput(dirs.nimiDataDir);
    }).catch((error) => {
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
      setStatusBanner({
        kind: 'success',
        message: t('DeveloperSettings.settingsUpdated'),
      });
    } catch (error) {
      setStatusBanner({
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
      setStatusBanner({ kind: 'warning', message: t('DeveloperSettings.enterSourceDirFirst') });
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
      setStatusBanner({ kind: 'success', message: t('DeveloperSettings.sourceAdded') });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('DeveloperSettings.sourceAddFailed'),
      });
    } finally {
      setSaving(false);
    }
  };

  const saveNimiDataDir = async () => {
    const normalized = nimiDataDirInput.trim();
    if (!normalized) {
      setStatusBanner({ kind: 'warning', message: t('DeveloperSettings.enterDataDirFirst') });
      return;
    }
    setSaving(true);
    try {
      const dirs = await desktopBridge.setRuntimeModDataDir(normalized);
      setResolvedNimiDir(dirs.nimiDir);
      setResolvedNimiDataDir(dirs.nimiDataDir);
      setResolvedInstalledModsDir(dirs.installedModsDir);
      setNimiDataDirInput(dirs.nimiDataDir);
      await refreshRuntimeModDeveloperHostState();
      setStatusBanner({
        kind: 'warning',
        message: t('DeveloperSettings.dataDirUpdated'),
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('DeveloperSettings.dataDirUpdateFailed'),
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
    } catch (error) {
      setStatusBanner({
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
      setStatusBanner({ kind: 'success', message: t('DeveloperSettings.sourceRemoved') });
    } catch (error) {
      setStatusBanner({
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
      setStatusBanner({ kind: 'success', message: t('DeveloperSettings.reloadSuccess') });
    } catch (error) {
      setStatusBanner({
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
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : t('DeveloperSettings.openModDirFailed'),
      });
    }
  };

  return (
    <PageShell
      title={t('DeveloperSettings.pageTitle')}
      description={t('DeveloperSettings.pageDescription')}
    >
      <section>
        <SectionTitle>{t('DeveloperSettings.modeTitle')}</SectionTitle>
        <Card className="p-5">
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
        </Card>
      </section>

      <section>
        <SectionTitle>{t('DeveloperSettings.addSourceTitle')}</SectionTitle>
        <Card className="space-y-4 p-5">
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
        </Card>
      </section>

      <section>
        <SectionTitle>{t('DeveloperSettings.dataDirTitle')}</SectionTitle>
        <Card className="space-y-4 p-5">
          <div className="space-y-1 text-xs text-gray-500">
            <p>{t('DeveloperSettings.nimiDirLabel')}: <span className="break-all text-gray-700">{resolvedNimiDir || '-'}</span></p>
            <p>{t('DeveloperSettings.installedModsDirLabel')}: <span className="break-all text-gray-700">{resolvedInstalledModsDir || '-'}</span></p>
          </div>
          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
            <input
              value={nimiDataDirInput}
              onChange={(event) => setNimiDataDirInput(event.target.value)}
              placeholder={t('DeveloperSettings.dataDirPlaceholder')}
              className="rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
            />
            <Button onClick={() => { void saveNimiDataDir(); }} disabled={saving}>
              {t('DeveloperSettings.saveDataDirButton')}
            </Button>
          </div>
          <p className="text-xs text-amber-700">
            {t('DeveloperSettings.dataDirHelp')}
          </p>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => { void openModDir(resolvedNimiDataDir); }}
              disabled={saving || !resolvedNimiDataDir}
            >
              {t('DeveloperSettings.openDataDir')}
            </Button>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>{t('DeveloperSettings.registeredSourcesTitle')}</SectionTitle>
        <div className="space-y-3">
          {runtimeModSources.map((source) => (
            <Card key={source.sourceId} className="p-4">
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
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>{t('DeveloperSettings.diagnosticsTitle')}</SectionTitle>
        <div className="space-y-3">
          {issueDiagnostics.length === 0 ? (
            <Card className="p-4 text-sm text-gray-500">{t('DeveloperSettings.noDiagnostics')}</Card>
          ) : issueDiagnostics.map((record) => (
            <Card key={`${record.sourceId}:${record.modId}:${record.status}:${record.manifestPath || 'none'}`} className="p-4">
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
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>{t('DeveloperSettings.recentReloadsTitle')}</SectionTitle>
        <div className="space-y-3">
          {runtimeModRecentReloads.length === 0 ? (
            <Card className="p-4 text-sm text-gray-500">{t('DeveloperSettings.noRecentReloads')}</Card>
          ) : runtimeModRecentReloads.slice().reverse().slice(0, 12).map((record) => (
            <Card key={`${record.sourceId}:${record.modId}:${record.occurredAt}`} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">{record.modId}</span>
                <StatusBadge status={sourceStatusTone(record.status)} text={record.status} />
                <span className="text-xs text-gray-500">{record.occurredAt}</span>
              </div>
              {record.error ? <p className="mt-2 text-xs text-red-600">{record.error}</p> : null}
            </Card>
          ))}
        </div>
      </section>
    </PageShell>
  );
}
