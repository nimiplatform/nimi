import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { desktopBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
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

export function DeveloperPage() {
  const { t } = useTranslation();
  const runtimeModSources = useAppStore((state) => state.runtimeModSources);
  const runtimeModDeveloperMode = useAppStore((state) => state.runtimeModDeveloperMode);
  const runtimeModDiagnostics = useAppStore((state) => state.runtimeModDiagnostics);
  const runtimeModRecentReloads = useAppStore((state) => state.runtimeModRecentReloads);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);
  const [sourceDirInput, setSourceDirInput] = useState('');
  const [sourceTypeInput, setSourceTypeInput] = useState<'installed' | 'dev'>('dev');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void refreshRuntimeModDeveloperHostState();
  }, []);

  const sourceSummary = useMemo(() => ({
    total: runtimeModSources.length,
    dev: runtimeModSources.filter((item) => item.sourceType === 'dev').length,
    enabled: runtimeModSources.filter((item) => item.enabled).length,
  }), [runtimeModSources]);

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
        message: 'Mod Developer settings updated',
      });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to update Mod Developer settings',
      });
    } finally {
      setSaving(false);
    }
  };

  const addSource = async () => {
    const sourceDir = sourceDirInput.trim();
    if (!sourceDir) {
      setStatusBanner({ kind: 'warning', message: 'Enter an absolute mod source directory first' });
      return;
    }
    setSaving(true);
    try {
      await desktopBridge.upsertRuntimeModSource({
        sourceType: sourceTypeInput,
        sourceDir,
        enabled: true,
      });
      await refreshRuntimeModDeveloperHostState();
      setSourceDirInput('');
      setStatusBanner({ kind: 'success', message: 'Mod source added' });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to add mod source',
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
        sourceType: source.sourceType,
        sourceDir: source.sourceDir,
        enabled,
      });
      await refreshRuntimeModDeveloperHostState();
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to update mod source',
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
      setStatusBanner({ kind: 'success', message: 'Mod source removed' });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to remove mod source',
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
      setStatusBanner({ kind: 'success', message: 'Runtime mods reloaded' });
    } catch (error) {
      setStatusBanner({
        kind: 'error',
        message: error instanceof Error ? error.message : 'Failed to reload runtime mods',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageShell
      title={t('DeveloperSettings.pageTitle')}
      description={t('DeveloperSettings.pageDescription')}
    >
      <section>
        <SectionTitle>Mod Developer Mode</SectionTitle>
        <Card className="p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1 text-sm text-gray-600">
              <p>Developer Mode keeps Desktop in third-party mod host mode.</p>
              <p>{`Sources: ${sourceSummary.total} total, ${sourceSummary.dev} dev, ${sourceSummary.enabled} enabled`}</p>
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
                {runtimeModDeveloperMode.enabled ? 'Disable Developer Mode' : 'Enable Developer Mode'}
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
                {runtimeModDeveloperMode.autoReloadEnabled ? 'Disable Auto Reload' : 'Enable Auto Reload'}
              </Button>
              <Button variant="secondary" onClick={() => { void reloadAll(); }} disabled={saving}>
                Reload All
              </Button>
            </div>
          </div>
        </Card>
      </section>

      <section>
        <SectionTitle>Add Mod Source</SectionTitle>
        <Card className="space-y-4 p-5">
          <div className="grid gap-3 md:grid-cols-[140px_minmax(0,1fr)_auto]">
            <select
              value={sourceTypeInput}
              onChange={(event) => setSourceTypeInput(event.target.value === 'installed' ? 'installed' : 'dev')}
              className="rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
            >
              <option value="dev">dev</option>
              <option value="installed">installed</option>
            </select>
            <input
              value={sourceDirInput}
              onChange={(event) => setSourceDirInput(event.target.value)}
              placeholder="/absolute/path/to/mods-or-one-mod"
              className="rounded-[10px] border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700"
            />
            <Button onClick={() => { void addSource(); }} disabled={saving}>Add Source</Button>
          </div>
          <p className="text-xs text-gray-500">
            A source directory may be a single mod root or a directory that contains multiple mod subdirectories.
          </p>
        </Card>
      </section>

      <section>
        <SectionTitle>Registered Sources</SectionTitle>
        <div className="space-y-3">
          {runtimeModSources.map((source) => (
            <Card key={source.sourceId} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-gray-900">{source.sourceType}</span>
                    {source.isDefault ? <StatusBadge status="info" text="Default" /> : null}
                    {source.enabled ? <StatusBadge status="success" text="Enabled" /> : <StatusBadge status="warning" text="Disabled" />}
                  </div>
                  <p className="break-all text-sm text-gray-600">{source.sourceDir}</p>
                </div>
                <div className="flex gap-2">
                  {!source.isDefault ? (
                    <Button
                      variant="secondary"
                      onClick={() => { void toggleSourceEnabled(source.sourceId, !source.enabled); }}
                      disabled={saving}
                    >
                      {source.enabled ? 'Disable' : 'Enable'}
                    </Button>
                  ) : null}
                  {!source.isDefault ? (
                    <Button
                      variant="danger"
                      onClick={() => { void removeSource(source.sourceId); }}
                      disabled={saving}
                    >
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Diagnostics</SectionTitle>
        <div className="space-y-3">
          {runtimeModDiagnostics.length === 0 ? (
            <Card className="p-4 text-sm text-gray-500">No diagnostics yet.</Card>
          ) : runtimeModDiagnostics.map((record) => (
            <Card key={`${record.sourceId}:${record.modId}:${record.status}:${record.manifestPath || 'none'}`} className="p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold text-gray-900">{record.modId}</span>
                <StatusBadge status={sourceStatusTone(record.status)} text={record.status} />
                <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-500">
                  {record.sourceType}
                </span>
              </div>
              <div className="mt-2 space-y-1 text-xs text-gray-600">
                <p className="break-all">{record.sourceDir}</p>
                {record.manifestPath ? <p className="break-all">{record.manifestPath}</p> : null}
                {record.entryPath ? <p className="break-all">{record.entryPath}</p> : null}
                {record.error ? <p className="text-red-600">{record.error}</p> : null}
                {record.conflictPaths && record.conflictPaths.length > 0 ? (
                  <p className="break-all text-amber-700">{record.conflictPaths.join(' | ')}</p>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      </section>

      <section>
        <SectionTitle>Recent Reloads</SectionTitle>
        <div className="space-y-3">
          {runtimeModRecentReloads.length === 0 ? (
            <Card className="p-4 text-sm text-gray-500">No reload events in this session yet.</Card>
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
