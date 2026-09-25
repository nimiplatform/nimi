import { useCallback, useEffect, useId, useMemo, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { parseNimiPortableAIProfile, type NimiPortableAIProfile } from '@nimiplatform/sdk/ai';
import type { NimiDesktopPortableAIProfileCatalogRecord } from '@nimiplatform/sdk/runtime';
import { Button, IconButton, InlineAlert, OverlayShell, TextareaField, TextField, cn } from '@nimiplatform/kit/ui';
import { CheckCircle2, ClipboardPaste, FileText, FileUp, ShieldCheck, X } from 'lucide-react';
import { useDesktopRendererSdk } from '../../renderer/binding-context.js';
import { capabilityIcon, groupCapabilities } from './runtime-capability-presentation.js';
import { displayRuntimeConfigCapabilityLabel } from './runtime-config-capability-labels.js';

export type ProfileImportWizardProps = {
  readonly initialSourceText: string | null;
  readonly onClose: () => void;
  readonly onCatalogChanged: () => void;
  readonly onUseImported?: (profile: NimiDesktopPortableAIProfileCatalogRecord) => void;
};

/** Where the previewed setup came from: a chosen or dropped file, or pasted text. */
type ImportSource = { readonly kind: 'file'; readonly name: string } | { readonly kind: 'text' };

function errorText(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

// @nimi-authority: rule.nimi.desktop.ai-consumption.r026
/**
 * Import only stores a portable description. Use enters the existing setup task.
 * Choosing a file is the main path; pasting the file's text is the fallback for
 * a setup that arrived as a message.
 */
export function ProfileImportWizard(props: ProfileImportWizardProps) {
  const { t } = useTranslation();
  const sdk = useDesktopRendererSdk();
  const catalog = useMemo(() => sdk.accountProduct().profiles, [sdk]);
  const nameId = useId();
  const usesId = useId();
  const [pasting, setPasting] = useState(false);
  const [pastedText, setPastedText] = useState(props.initialSourceText ?? '');
  const [source, setSource] = useState<ImportSource | null>(null);
  const [profile, setProfile] = useState<NimiPortableAIProfile | null>(null);
  const [name, setName] = useState('');
  const [imported, setImported] = useState<NimiDesktopPortableAIProfileCatalogRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const fileRead = useRef(0);

  // Each step hands focus to its own next action, so a step change never
  // strands focus on the dialog frame. The first step keeps the dialog's
  // own open focus, which also records where focus returns on close.
  const step = imported ? 'done' : profile ? 'review' : pasting ? 'paste' : 'choose';
  const stepAction = useRef<HTMLElement | null>(null);
  const focusStepAction = useCallback((element: HTMLElement | null) => { stepAction.current = element; }, []);
  const shownStep = useRef(step);
  useEffect(() => {
    if (shownStep.current === step) return;
    shownStep.current = step;
    stepAction.current?.focus();
  }, [step]);

  const preview = useCallback((text: string, origin: ImportSource) => {
    setError('');
    setImported(null);
    try {
      const parsed = parseNimiPortableAIProfile(text);
      setProfile(parsed);
      setName(parsed.title);
      setSource(origin);
    } catch (caught) {
      setProfile(null);
      setError(errorText(caught));
    }
  }, []);

  useEffect(() => {
    if (props.initialSourceText) preview(props.initialSourceText, { kind: 'text' });
  }, [preview, props.initialSourceText]);

  useEffect(() => () => { fileRead.current += 1; }, []);

  const readFile = async (file: File) => {
    const sequence = ++fileRead.current;
    setBusy(true);
    setError('');
    try {
      const text = await file.text();
      if (sequence !== fileRead.current) return;
      preview(text, { kind: 'file', name: file.name });
    } catch (caught) {
      if (sequence === fileRead.current) setError(errorText(caught));
    } finally {
      if (sequence === fileRead.current) setBusy(false);
    }
  };

  const openFilePicker = () => {
    if (!busy) fileInput.current?.click();
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = busy ? 'none' : 'copy';
    if (!busy) setDragging(true);
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files[0];
    if (file && !busy) void readFile(file);
  };

  /** Back to choosing, in the same way the current setup was provided. */
  const chooseAgain = () => {
    fileRead.current += 1;
    setProfile(null);
    setSource(null);
    setError('');
    setPasting(source?.kind === 'text');
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
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  };

  const failure = error ? (
    <InlineAlert tone="danger">
      <div>{t('runtimeConfig.profiles.importLibraryFailed', { defaultValue: 'The setup could not be imported. Check the file or try again.' })}</div>
      <details className="mt-1 text-xs">
        <summary className="cursor-pointer">{t('runtimeConfig.profiles.technicalDetails', { defaultValue: 'Technical details' })}</summary>
        <p className="mt-1 break-all font-mono">{error}</p>
      </details>
    </InlineAlert>
  ) : null;

  const reviewing = profile !== null && imported === null;

  return (
    <OverlayShell
      open kind="dialog" size="sm"
      onClose={busy ? undefined : props.onClose}
      closeOnBackdrop={!busy}
      title={<span className="block pr-10">{t('runtimeConfig.profiles.importLibraryTitle', { defaultValue: 'Import setup' })}</span>}
      contentClassName={reviewing ? undefined : 'pb-6'}
      data-testid="runtime-portable-profile-wizard"
      footer={reviewing ? (
        <div className="flex justify-end">
          <Button ref={focusStepAction} tone="primary" disabled={busy} onClick={() => { void save(); }} data-testid="runtime-profile-import-save">
            {busy ? t('Common.saving', { defaultValue: 'Saving…' }) : t('runtimeConfig.profiles.importLibrarySave', { defaultValue: 'Save to library' })}
          </Button>
        </div>
      ) : undefined}
    >
      {imported ? (
        <div className="flex flex-col items-center pt-4 text-center" data-testid="runtime-profile-import-success">
          <CheckCircle2 size={40} strokeWidth={1.6} aria-hidden="true" className="text-[var(--nimi-status-success)]" />
          <p role="status" className="mt-3 text-base font-semibold text-[var(--nimi-text-primary)]">
            {t('runtimeConfig.profiles.importLibrarySavedTitle', { defaultValue: 'Saved to your library' })}
          </p>
          <p className="mt-1 max-w-full break-words text-sm text-[var(--nimi-text-secondary)]">
            {t('runtimeConfig.profiles.importLibrarySavedName', { defaultValue: '“{{name}}”', name: imported.source.title })}
          </p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button ref={props.onUseImported ? undefined : focusStepAction} tone="secondary" onClick={props.onClose} data-testid="runtime-profile-import-done">
              {t('runtimeConfig.profiles.importLibraryDone', { defaultValue: 'Done' })}
            </Button>
            {props.onUseImported ? (
              <Button ref={focusStepAction} tone="primary" onClick={() => props.onUseImported?.(imported)} data-testid="runtime-profile-import-use">
                {t('runtimeConfig.profiles.importLibraryUse', { defaultValue: 'Use now' })}
              </Button>
            ) : null}
          </div>
        </div>
      ) : profile ? (
        <div className="space-y-4 pt-1" data-testid="runtime-profile-import-summary">
          <div className="flex items-center gap-2 rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-panel)] py-1.5 pl-3 pr-1.5">
            <FileText size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-[var(--nimi-text-secondary)]" />
            <span className="min-w-0 flex-1 truncate text-sm text-[var(--nimi-text-primary)]" title={source?.kind === 'file' ? source.name : undefined}>
              {source?.kind === 'file'
                ? source.name
                : t('runtimeConfig.profiles.importLibraryPasted', { defaultValue: 'Pasted setup' })}
            </span>
            <Button tone="ghost" size="sm" disabled={busy} onClick={chooseAgain} data-testid="runtime-profile-import-change">
              {t('runtimeConfig.profiles.importLibraryChange', { defaultValue: 'Change' })}
            </Button>
          </div>
          <div className="space-y-1.5">
            <label htmlFor={nameId} className="block text-xs text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.profiles.importLibraryName', { defaultValue: 'Name' })}
            </label>
            <TextField id={nameId} className="text-sm" value={name} disabled={busy} onChange={(event) => setName(event.currentTarget.value)} />
          </div>
          <section aria-labelledby={usesId}>
            <h3 id={usesId} className="pb-1 text-xs font-normal text-[var(--nimi-text-secondary)]">
              {t('runtimeConfig.profiles.importLibraryIncludes', { defaultValue: 'Includes {{count}} use(s)', count: Object.keys(profile.capabilities).length })}
            </h3>
            <ul>
              {groupCapabilities(Object.keys(profile.capabilities)).flatMap((group) => group.items).map((capability) => {
                const Icon = capabilityIcon(capability);
                return (
                  <li key={capability} className="flex items-center gap-3 border-t border-[var(--nimi-border-subtle)] py-2.5">
                    <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-status-info-soft-bg)] text-[var(--nimi-status-info)]">
                      <Icon size={16} strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--nimi-text-primary)]">
                      {displayRuntimeConfigCapabilityLabel(capability, t)}
                    </span>
                    <span className="shrink-0 text-xs text-[var(--nimi-text-secondary)]">
                      {profile.capabilities[capability]?.route === 'local'
                        ? t('runtimeConfig.profiles.importLibraryRouteLocal', { defaultValue: 'On this device' })
                        : t('runtimeConfig.profiles.importLibraryRouteCloud', { defaultValue: 'Cloud service' })}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
          {failure}
        </div>
      ) : (
        <div className="space-y-3 pt-1">
          {pasting ? (
            <div className="space-y-2">
              <TextareaField
                ref={focusStepAction}
                value={pastedText}
                disabled={busy}
                aria-label={t('runtimeConfig.profiles.importLibraryJson', { defaultValue: 'Paste setup contents' })}
                textareaClassName="min-h-40 font-mono text-xs"
                onChange={(event) => {
                  setPastedText(event.currentTarget.value);
                  setError('');
                }}
              />
              <div className="flex justify-end">
                <Button
                  tone="primary"
                  size="sm"
                  disabled={busy || !pastedText.trim()}
                  onClick={() => preview(pastedText, { kind: 'text' })}
                  data-testid="runtime-profile-import-preview"
                >
                  {t('runtimeConfig.profiles.importLibraryReview', { defaultValue: 'Review setup' })}
                </Button>
              </div>
            </div>
          ) : (
            // The whole zone opens the file chooser and accepts a dropped file;
            // the button inside is the keyboard and screen-reader entry.
            <div
              className={cn(
                'flex cursor-pointer flex-col items-center rounded-[var(--nimi-radius-md)] border-[1.5px] border-dashed px-6 py-8 text-center transition-colors duration-[var(--nimi-motion-fast)]',
                dragging
                  ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_6%,var(--nimi-surface-card))]'
                  : 'border-[var(--nimi-border-strong)] bg-[var(--nimi-surface-panel)] hover:border-[var(--nimi-action-primary-bg)]',
              )}
              onClick={openFilePicker}
              onDragOver={onDragOver}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
              }}
              onDrop={onDrop}
              data-testid="runtime-profile-import-drop"
            >
              <span className="flex size-11 items-center justify-center rounded-[var(--nimi-radius-md)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,transparent)] text-[var(--nimi-action-primary-bg)]">
                <FileUp size={22} strokeWidth={1.8} aria-hidden="true" />
              </span>
              <Button
                ref={focusStepAction}
                tone="primary"
                className="mt-4"
                disabled={busy}
                onClick={(event) => {
                  event.stopPropagation();
                  openFilePicker();
                }}
                data-testid="runtime-profile-import-file"
              >
                {t('runtimeConfig.profiles.importLibraryFile', { defaultValue: 'Choose a setup file' })}
              </Button>
              <p className="mt-2 text-xs text-[var(--nimi-text-secondary)]">
                {t('runtimeConfig.profiles.importLibraryDrop', { defaultValue: 'Or drop the file here' })}
              </p>
            </div>
          )}
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            className="hidden"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              // Clear the value so choosing the same file again still reads it.
              event.currentTarget.value = '';
              if (file) void readFile(file);
            }}
          />
          {failure}
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Button
              tone="ghost"
              size="sm"
              className="-ml-3"
              disabled={busy}
              onClick={() => {
                setError('');
                if (pasting) {
                  setPasting(false);
                  openFilePicker();
                } else {
                  setPasting(true);
                }
              }}
              data-testid="runtime-profile-import-paste-toggle"
            >
              {pasting ? <FileUp size={14} aria-hidden="true" /> : <ClipboardPaste size={14} aria-hidden="true" />}
              {pasting
                ? t('runtimeConfig.profiles.importLibraryFile', { defaultValue: 'Choose a setup file' })
                : t('runtimeConfig.profiles.importLibraryJson', { defaultValue: 'Paste setup contents' })}
            </Button>
            <span className="inline-flex items-center gap-1.5 text-xs text-[var(--nimi-text-secondary)]">
              <ShieldCheck size={14} strokeWidth={2} aria-hidden="true" className="shrink-0 text-[var(--nimi-status-success)]" />
              {t('runtimeConfig.profiles.importLibraryDescription', { defaultValue: 'Only saved to your library; no models download' })}
            </span>
          </div>
        </div>
      )}
      <IconButton
        size="sm"
        aria-label={t('Common.close', { defaultValue: 'Close' })}
        icon={<X size={16} aria-hidden="true" />}
        disabled={busy}
        onClick={props.onClose}
        className="absolute right-5 top-5"
        data-testid="runtime-profile-import-close"
      />
    </OverlayShell>
  );
}
