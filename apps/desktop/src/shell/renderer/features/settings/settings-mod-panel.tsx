import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore, type AppTab } from '@renderer/app-shell/providers/app-store';
import { showModTabLimitBanner } from '@renderer/mod-ui/host/mod-tab-limit-banner';
import { Button, PageShell, SectionTitle, StatusBadge } from './settings-layout-components';
import { loadStoredSettingsModId, persistStoredSettingsModId } from './settings-storage';

type RuntimeModSettingsRecord = Record<string, unknown>;

function normalizeModId(value: unknown): string {
  return String(value || '').trim();
}

function toRecord(value: unknown): RuntimeModSettingsRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }
  return value as RuntimeModSettingsRecord;
}

function normalizeDisplayName(input: {
  modId: string;
  name: string;
}): string {
  const name = String(input.name || '').trim();
  if (!name) return normalizeModId(input.modId);
  if (/^desktop\s+/i.test(name)) {
    return name.replace(/^desktop\s+/i, '').trim() || name;
  }
  return name;
}

function formatSettingsJson(settings: RuntimeModSettingsRecord): string {
  return JSON.stringify(settings, null, 2);
}

function parseSettingsJson(text: string): RuntimeModSettingsRecord | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as RuntimeModSettingsRecord;
  } catch {
    return null;
  }
}

function PuzzleIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 12h-2a2 2 0 1 1 0-4h2V5a2 2 0 0 0-2-2h-3v2a2 2 0 1 1-4 0V3H7a2 2 0 0 0-2 2v3h2a2 2 0 1 1 0 4H5v3a2 2 0 0 0 2 2h3v-2a2 2 0 1 1 4 0v2h3a2 2 0 0 0 2-2z" />
    </svg>
  );
}

function CodeIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </svg>
  );
}

function BracesIcon({ className = '' }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 3H7a2 2 0 0 0-2 2v4a2 2 0 0 1-2 2 2 2 0 0 1 2 2v4a2 2 0 0 0 2 2h1" />
      <path d="M16 3h1a2 2 0 0 1 2 2v4a2 2 0 0 0 2 2 2 2 0 0 0-2 2v4a2 2 0 0 1-2 2h-1" />
    </svg>
  );
}

function SettingLikeRow({
  icon,
  title,
  description,
  active,
  onClick,
  trailing,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  active?: boolean;
  onClick: () => void;
  trailing?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-between px-5 py-4 text-left transition-colors ${
        active ? 'bg-mint-50/80' : 'hover:bg-gray-50/50'
      }`}
    >
      <div className="flex min-w-0 items-center gap-4">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
          active ? 'bg-mint-100 text-mint-600' : 'bg-gray-100 text-gray-500'
        }`}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className={`truncate text-sm ${active ? 'font-semibold text-gray-900' : 'font-medium text-gray-900'}`}>{title}</p>
          <p className="truncate text-xs text-gray-500">{description}</p>
        </div>
      </div>
      {trailing ? <div className="ml-4 shrink-0">{trailing}</div> : null}
    </button>
  );
}

export function ModSettingsPage() {
  const { t } = useTranslation();
  const localManifestSummaries = useAppStore((state) => state.localManifestSummaries);
  const registeredRuntimeModIds = useAppStore((state) => state.registeredRuntimeModIds);
  const runtimeModDisabledIds = useAppStore((state) => state.runtimeModDisabledIds);
  const runtimeModUninstalledIds = useAppStore((state) => state.runtimeModUninstalledIds);
  const runtimeModSettingsById = useAppStore((state) => state.runtimeModSettingsById);
  const setRuntimeModSettings = useAppStore((state) => state.setRuntimeModSettings);
  const openModWorkspaceTab = useAppStore((state) => state.openModWorkspaceTab);
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const setStatusBanner = useAppStore((state) => state.setStatusBanner);

  const runtimeMods = useMemo(() => {
    const registeredSet = new Set(registeredRuntimeModIds.map((id) => normalizeModId(id)).filter(Boolean));
    const disabledSet = new Set(runtimeModDisabledIds.map((id) => normalizeModId(id)).filter(Boolean));
    const uninstalledSet = new Set(runtimeModUninstalledIds.map((id) => normalizeModId(id)).filter(Boolean));

    return localManifestSummaries
      .filter((manifest) => !String(manifest.id || '').startsWith('core.'))
      .map((manifest) => {
        const modId = normalizeModId(manifest.id || '');
        const version = String(manifest.version || '1.0.0').replace(/^v/i, '');
        const displayName = normalizeDisplayName({
          modId,
          name: String(manifest.name || ''),
        });
        const isInstalled = !uninstalledSet.has(modId);
        const isEnabled = isInstalled && !disabledSet.has(modId) && registeredSet.has(modId);
        return {
          id: modId,
          name: displayName,
          version: `v${version}`,
          description: String(manifest.description || '').trim() || t('ModSettings.runtimeModFallbackDescription'),
          isInstalled,
          isEnabled,
        };
      });
  }, [localManifestSummaries, registeredRuntimeModIds, runtimeModDisabledIds, runtimeModUninstalledIds, t]);

  const [selectedModId, setSelectedModId] = useState(() => loadStoredSettingsModId());
  const [jsonDraft, setJsonDraft] = useState('{}');

  useEffect(() => {
    if (runtimeMods.length === 0) {
      setSelectedModId('');
      return;
    }
    const normalizedStored = normalizeModId(selectedModId);
    if (normalizedStored && runtimeMods.some((mod) => mod.id === normalizedStored)) {
      return;
    }
    setSelectedModId(runtimeMods[0]?.id || '');
  }, [runtimeMods, selectedModId]);

  useEffect(() => {
    persistStoredSettingsModId(selectedModId);
  }, [selectedModId]);

  const selectedMod = useMemo(
    () => runtimeMods.find((mod) => mod.id === selectedModId) || null,
    [runtimeMods, selectedModId],
  );
  const selectedSettings = useMemo(
    () => toRecord(runtimeModSettingsById[selectedModId]),
    [runtimeModSettingsById, selectedModId],
  );

  useEffect(() => {
    setJsonDraft(formatSettingsJson(selectedSettings));
  }, [selectedSettings, selectedModId]);

  const handleSaveJson = () => {
    if (!selectedModId) return;
    const parsed = parseSettingsJson(jsonDraft);
    if (!parsed) {
      setStatusBanner({
        kind: 'error',
        message: t('ModSettings.invalidJson'),
      });
      return;
    }
    setRuntimeModSettings(selectedModId, parsed);
    setStatusBanner({
      kind: 'success',
      message: t('ModSettings.saved', { modId: selectedModId }),
    });
  };

  const handleResetJson = () => {
    if (!selectedModId) return;
    setRuntimeModSettings(selectedModId, {});
    setJsonDraft('{}');
    setStatusBanner({
      kind: 'info',
      message: t('ModSettings.reset', { modId: selectedModId }),
    });
  };

  const handleOpenModWorkspace = () => {
    if (!selectedMod) return;
    const result = openModWorkspaceTab(`mod:${selectedMod.id}`, selectedMod.name, selectedMod.id);
    if (result === 'rejected-limit') {
      showModTabLimitBanner({
        setStatusBanner,
        setActiveTab: (tab) => {
          setActiveTab(tab as AppTab);
        },
      });
    }
  };

  return (
    <PageShell
      title={t('ModSettings.pageTitle')}
      description={t('ModSettings.pageDescription')}
    >
      <section className="mt-8">
        <div className="rounded-2xl border border-mint-100 bg-mint-50/50 p-5">
          <div className="flex gap-4">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mint-100 text-mint-600">
              <PuzzleIcon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">{t('ModSettings.unifiedTitle')}</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">
                {t('ModSettings.unifiedDescription')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {runtimeMods.length === 0 ? (
        <section className="mt-8">
          <div className="rounded-2xl border border-gray-100 bg-white p-6 text-center shadow-sm">
            <p className="text-sm text-gray-700">{t('ModSettings.noModsTitle')}</p>
            <p className="mt-1 text-xs text-gray-500">{t('ModSettings.noModsDescription')}</p>
          </div>
        </section>
      ) : (
        <>
          <section className="mt-8">
            <SectionTitle description={t('ModSettings.installedDescription')}>
              {t('ModSettings.installedTitle')}
            </SectionTitle>
            <div className="mt-3 overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
              {runtimeMods.map((mod, index) => (
                <div key={mod.id}>
                  <SettingLikeRow
                    icon={<PuzzleIcon className="h-5 w-5" />}
                    title={mod.name}
                    description={mod.description}
                    active={mod.id === selectedModId}
                    onClick={() => setSelectedModId(mod.id)}
                    trailing={(
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-gray-400">{mod.version}</span>
                        {!mod.isInstalled ? (
                          <StatusBadge status="warning" text={t('ModSettings.statusNotInstalled')} />
                        ) : mod.isEnabled ? (
                          <StatusBadge status="success" text={t('ModSettings.statusEnabled')} />
                        ) : (
                          <StatusBadge status="info" text={t('ModSettings.statusDisabled')} />
                        )}
                      </div>
                    )}
                  />
                  {index < runtimeMods.length - 1 ? <div className="mx-5 h-px bg-gray-50" /> : null}
                </div>
              ))}
            </div>
          </section>

          {selectedMod ? (
            <>
              <section className="mt-8">
                <SectionTitle description={t('ModSettings.rawJsonDescription')}>
                  {t('ModSettings.rawJsonTitle')}
                </SectionTitle>
                <div className="mt-3 rounded-2xl border border-gray-100 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-100 text-gray-500">
                      <BracesIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{selectedMod.name}</p>
                      <p className="text-xs text-gray-500">{selectedMod.id}</p>
                    </div>
                  </div>
                  <textarea
                    value={jsonDraft}
                    onChange={(event) => setJsonDraft(event.target.value)}
                    className="h-64 w-full resize-y rounded-2xl border border-gray-200 bg-gray-50 p-4 font-mono text-xs text-gray-900 outline-none transition-colors focus:border-mint-300"
                    spellCheck={false}
                  />
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <Button variant="primary" size="sm" onClick={handleSaveJson}>{t('ModSettings.saveJson')}</Button>
                    <Button variant="secondary" size="sm" onClick={handleResetJson}>{t('ModSettings.resetJson')}</Button>
                    <Button variant="ghost" size="sm" onClick={handleOpenModWorkspace}>
                      <CodeIcon className="h-4 w-4" />
                      {t('ModSettings.openMod')}
                    </Button>
                  </div>
                </div>
              </section>
            </>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
