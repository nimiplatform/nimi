import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseNimiPortableAIProfile, type NimiPortableAIProfile } from '@nimiplatform/sdk/ai';
import type { NimiDesktopPortableAIProfileCatalogRecord } from '@nimiplatform/sdk/runtime';
import { Button, InlineAlert, OverlayShell } from '@nimiplatform/kit/ui';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';

export type ProfileImportWizardProps = {
  readonly initialSourceText: string | null;
  readonly onClose: () => void;
  readonly onCatalogChanged: () => void;
  readonly onUseImported?: (profile: NimiDesktopPortableAIProfileCatalogRecord) => void;
};

// @nimi-authority: rule.nimi.desktop.ai-consumption.r026
/** Import only stores a portable description. Use enters the existing setup task. */
export function ProfileImportWizard(props: ProfileImportWizardProps) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const catalog = useMemo(() => sdk.accountProduct().profiles, [sdk]);
  const [sourceText, setSourceText] = useState(props.initialSourceText ?? '');
  const [profile, setProfile] = useState<NimiPortableAIProfile | null>(null);
  const [name, setName] = useState('');
  const [imported, setImported] = useState<NimiDesktopPortableAIProfileCatalogRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRead = useRef(0);

  const preview = useCallback((source: string) => {
    setError('');
    setImported(null);
    try {
      const parsed = parseNimiPortableAIProfile(source);
      setProfile(parsed);
      setName(parsed.title);
    } catch (caught) {
      setProfile(null);
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, []);

  useEffect(() => {
    if (props.initialSourceText) preview(props.initialSourceText);
  }, [preview, props.initialSourceText]);

  useEffect(() => () => { fileRead.current += 1; }, []);

  const readFile = async (file: File) => {
    const sequence = ++fileRead.current;
    setBusy(true);
    setError('');
    try {
      const text = await file.text();
      if (sequence !== fileRead.current) return;
      setSourceText(text);
      preview(text);
    } catch (caught) {
      if (sequence === fileRead.current) setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      if (sequence === fileRead.current) setBusy(false);
    }
  };

  const save = async () => {
    if (!profile || busy) return;
    setBusy(true);
    setError('');
    try {
      const record = await catalog.import({ ...profile, title: name.trim() || profile.title });
      setImported(record);
      props.onCatalogChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <OverlayShell
      open kind="dialog" size="L"
      onClose={() => { if (!busy) props.onClose(); }}
      closeOnBackdrop={!busy}
      title={t('runtimeConfig.profiles.importLibraryTitle', { defaultValue: 'Import a shared setup' })}
      dataTestId="runtime-portable-profile-wizard"
      footer={imported ? (
        <div className="flex flex-wrap gap-2">
          <Button tone="secondary" onClick={props.onClose}>
            {t('runtimeConfig.profiles.importLibraryDone', { defaultValue: 'Back to library' })}
          </Button>
          {props.onUseImported ? (
            <Button tone="primary" onClick={() => props.onUseImported?.(imported)} data-testid="runtime-profile-import-use">
              {t('runtimeConfig.profiles.importLibraryUse', { defaultValue: 'Use this setup' })}
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button tone="secondary" disabled={busy} onClick={props.onClose}>{t('Common.cancel', { defaultValue: 'Cancel' })}</Button>
          {profile ? (
            <Button tone="primary" disabled={busy} onClick={() => { void save(); }} data-testid="runtime-profile-import-save">
              {busy ? t('Common.saving', { defaultValue: 'Saving…' }) : t('runtimeConfig.profiles.importLibrarySave', { defaultValue: 'Save to library' })}
            </Button>
          ) : (
            <Button tone="primary" disabled={busy || !sourceText.trim()} onClick={() => preview(sourceText)} data-testid="runtime-profile-import-preview">
              {t('runtimeConfig.profiles.importLibraryReview', { defaultValue: 'Review setup' })}
            </Button>
          )}
        </div>
      )}
    >
      <div className="space-y-4 pb-2">
        <p className="text-sm text-[var(--nimi-text-secondary)]">
          {t('runtimeConfig.profiles.importLibraryDescription', { defaultValue: 'Save a shared setup for later. Importing does not download models or change what your apps use.' })}
        </p>
        {error ? (
          <InlineAlert tone="danger">
            <div>{t('runtimeConfig.profiles.importLibraryFailed', { defaultValue: 'The setup could not be imported. Check the file or try again.' })}</div>
            <details className="mt-1 text-xs"><summary>{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>{error}</details>
          </InlineAlert>
        ) : null}
        {imported ? (
          <InlineAlert tone="success" data-testid="runtime-profile-import-success">
            {t('runtimeConfig.profiles.importLibrarySaved', { defaultValue: '“{{name}}” is saved in your library. Choose Use when you want to prepare it.', name: imported.source.title })}
          </InlineAlert>
        ) : (
          <>
            <label className="block space-y-2 text-sm">
              <span className="block">{t('runtimeConfig.profiles.importLibraryFile', { defaultValue: 'Choose a setup file' })}</span>
              <input className="block max-w-full" type="file" accept=".json,application/json" disabled={busy} onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) void readFile(file);
              }} />
            </label>
            <label className="block space-y-2 text-sm">
              <span>{t('runtimeConfig.profiles.importLibraryJson', { defaultValue: 'Or paste the setup JSON' })}</span>
              <textarea className="min-h-32 w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] p-3 font-mono text-xs" value={sourceText} disabled={busy} onChange={(event) => {
                fileRead.current += 1;
                setSourceText(event.currentTarget.value); setProfile(null); setError('');
              }} />
            </label>
            {profile ? (
              <div className="space-y-3" data-testid="runtime-profile-import-summary">
                <label className="block space-y-1 text-sm">
                  <span>{t('runtimeConfig.profiles.importLibraryName', { defaultValue: 'Name in your library' })}</span>
                  <input className="w-full rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-field-bg)] px-3 py-2" value={name} disabled={busy} onChange={(event) => setName(event.currentTarget.value)} />
                </label>
                <ul className="space-y-1 text-sm text-[var(--nimi-text-secondary)]">
                  {Object.entries(profile.capabilities).map(([capability, intent]) => (
                    <li key={capability}>{displayRuntimeConfigCapabilityLabel(capability, t)} · {intent.route === 'local'
                      ? t('runtimeConfig.setupTask.routeLocalTitle', { defaultValue: 'On this device' })
                      : t('runtimeConfig.setupTask.routeCloudTitle', { defaultValue: 'Cloud service' })}</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </>
        )}
      </div>
    </OverlayShell>
  );
}
