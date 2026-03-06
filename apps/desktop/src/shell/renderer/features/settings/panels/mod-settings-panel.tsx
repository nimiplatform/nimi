import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore, type AppTab } from '@renderer/app-shell/providers/app-store';
import { C } from '../settings-assets';
import { Button, Card, PageShell, SectionTitle, StatusBadge } from '../settings-layout-components';
import { loadStoredSettingsModId, persistStoredSettingsModId } from '../settings-storage';

type LocalChatSettingsKey =
  | 'enableVoice'
  | 'allowMultiReply'
  | 'allowProactiveContact'
  | 'autoPlayVoiceReplies';

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
  const modId = normalizeModId(input.modId);
  const name = String(input.name || '').trim();
  if (!name) return modId;
  if (modId === 'world.nimi.local-chat') {
    return 'Local Chat';
  }
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

function normalizeLocalChatSettings(value: unknown): {
  enableVoice: boolean;
  allowMultiReply: boolean;
  allowProactiveContact: boolean;
  autoPlayVoiceReplies: boolean;
  voiceName: string;
  ttsRouteSource: 'auto' | 'local-runtime' | 'token-api';
  sttRouteSource: 'auto' | 'local-runtime' | 'token-api';
} {
  const settings = toRecord(value);
  const ttsRouteSourceRaw = String(settings.ttsRouteSource || '').trim();
  const sttRouteSourceRaw = String(settings.sttRouteSource || '').trim();
  return {
    enableVoice: Boolean(settings.enableVoice),
    allowMultiReply: Boolean(settings.allowMultiReply),
    allowProactiveContact: Boolean(settings.allowProactiveContact),
    autoPlayVoiceReplies: Boolean(settings.autoPlayVoiceReplies),
    voiceName: String(settings.voiceName || 'alloy').trim() || 'alloy',
    ttsRouteSource: ttsRouteSourceRaw === 'local-runtime' || ttsRouteSourceRaw === 'token-api'
      ? ttsRouteSourceRaw
      : 'auto',
    sttRouteSource: sttRouteSourceRaw === 'local-runtime' || sttRouteSourceRaw === 'token-api'
      ? sttRouteSourceRaw
      : 'auto',
  };
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

  const localChatSettings = useMemo(
    () => normalizeLocalChatSettings(selectedSettings),
    [selectedSettings],
  );

  const updateLocalChatSetting = (key: LocalChatSettingsKey, value: boolean) => {
    const nextSettings = {
      ...selectedSettings,
      [key]: value,
    };
    setRuntimeModSettings(selectedModId, nextSettings);
    setJsonDraft(formatSettingsJson(nextSettings));
  };

  const updateLocalChatVoiceName = (voiceName: string) => {
    const nextSettings = {
      ...selectedSettings,
      voiceName: String(voiceName || '').trim() || 'alloy',
    };
    setRuntimeModSettings(selectedModId, nextSettings);
    setJsonDraft(formatSettingsJson(nextSettings));
  };

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
    openModWorkspaceTab(`mod:${selectedMod.id}`, selectedMod.name, selectedMod.id);
    setActiveTab(`mod:${selectedMod.id}` as AppTab);
  };

  return (
    <PageShell
      title={t('ModSettings.pageTitle')}
      description={t('ModSettings.pageDescription')}
    >
      <section>
        <Card className="p-4" style={{ backgroundColor: C.brand50, borderColor: C.brand100 }}>
          <p className="text-sm font-medium text-gray-900">{t('ModSettings.unifiedTitle')}</p>
          <p className="mt-1 text-xs text-gray-600">
            {t('ModSettings.unifiedDescription')}
          </p>
        </Card>
      </section>

      {runtimeMods.length === 0 ? (
        <section>
          <Card className="p-6 text-center">
            <p className="text-sm text-gray-700">{t('ModSettings.noModsTitle')}</p>
            <p className="mt-1 text-xs text-gray-500">{t('ModSettings.noModsDescription')}</p>
          </Card>
        </section>
      ) : (
        <>
          <section>
            <SectionTitle description={t('ModSettings.installedDescription')}>
              {t('ModSettings.installedTitle')}
            </SectionTitle>
            <Card className="mt-3 divide-y divide-gray-100">
              {runtimeMods.map((mod) => {
                const active = mod.id === selectedModId;
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => setSelectedModId(mod.id)}
                    className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-all ${
                      active ? 'bg-mint-50 ring-1 ring-inset ring-mint-200' : 'hover:bg-mint-50/30'
                    }`}
                  >
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm ${active ? 'font-semibold text-mint-700' : 'font-medium text-gray-900'}`}>{mod.name}</p>
                      <p className="truncate text-xs text-gray-500">{mod.description}</p>
                    </div>
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
                  </button>
                );
              })}
            </Card>
          </section>

          {selectedMod ? (
            <>
              {selectedMod.id === 'world.nimi.local-chat' ? (
                <section>
                  <SectionTitle description={t('ModSettings.localChatQuickSettingsDescription')}>
                    {t('ModSettings.localChatQuickSettingsTitle')}
                  </SectionTitle>
                  <Card className="mt-3 space-y-3 p-4 text-sm text-gray-700">
                    <label className="flex items-center justify-between gap-3">
                      <span>{t('ModSettings.localChatEnableVoice')}</span>
                      <input
                        type="checkbox"
                        checked={localChatSettings.enableVoice}
                        onChange={(event) => updateLocalChatSetting('enableVoice', event.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-600"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3">
                      <span>{t('ModSettings.localChatAllowMultiReply')}</span>
                      <input
                        type="checkbox"
                        checked={localChatSettings.allowMultiReply}
                        onChange={(event) => updateLocalChatSetting('allowMultiReply', event.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-600"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3">
                      <span>{t('ModSettings.localChatAllowProactiveContact')}</span>
                      <input
                        type="checkbox"
                        checked={localChatSettings.allowProactiveContact}
                        onChange={(event) => updateLocalChatSetting('allowProactiveContact', event.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-600"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3">
                      <span>{t('ModSettings.localChatAutoPlayVoiceReplies')}</span>
                      <input
                        type="checkbox"
                        checked={localChatSettings.autoPlayVoiceReplies}
                        onChange={(event) => updateLocalChatSetting('autoPlayVoiceReplies', event.target.checked)}
                        className="h-4 w-4 rounded border-gray-300 text-brand-600"
                      />
                    </label>
                    <label className="flex items-center justify-between gap-3">
                      <span>{t('ModSettings.localChatVoiceName')}</span>
                      <input
                        type="text"
                        value={localChatSettings.voiceName}
                        onChange={(event) => updateLocalChatVoiceName(event.target.value)}
                        className="h-8 w-40 rounded-md border border-gray-200 px-2 text-xs"
                      />
                    </label>
                  </Card>
                </section>
              ) : null}

              <section>
                <SectionTitle description={t('ModSettings.rawJsonDescription')}>
                  {t('ModSettings.rawJsonTitle')}
                </SectionTitle>
                <Card className="mt-3 p-4">
                  <textarea
                    value={jsonDraft}
                    onChange={(event) => setJsonDraft(event.target.value)}
                    className="h-64 w-full resize-y rounded-[10px] border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-900"
                    spellCheck={false}
                  />
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Button variant="primary" size="sm" onClick={handleSaveJson}>{t('ModSettings.saveJson')}</Button>
                    <Button variant="secondary" size="sm" onClick={handleResetJson}>{t('ModSettings.resetJson')}</Button>
                    <Button variant="ghost" size="sm" onClick={handleOpenModWorkspace}>{t('ModSettings.openMod')}</Button>
                  </div>
                </Card>
              </section>
            </>
          ) : null}
        </>
      )}
    </PageShell>
  );
}
