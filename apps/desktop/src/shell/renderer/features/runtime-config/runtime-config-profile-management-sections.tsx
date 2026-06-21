import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { NimiAIProfile } from '@nimiplatform/sdk/ai';
import { validateNimiAIProfile } from '@nimiplatform/sdk/ai';

import {
  exportAccountProfileLibraryEntries,
  importAccountProfileLibraryEntries,
} from './runtime-config-profile-library.js';

export type ProfileFeedback = { type: 'success' | 'error'; message: string } | null;

export type ProfileEditorDraft = {
  mode: 'create' | 'edit';
  profile: NimiAIProfile;
  title: string;
  description: string;
  tagsText: string;
  profileJsonText: string;
};

export function ProfileEditorModal(props: {
  draft: ProfileEditorDraft;
  saving: boolean;
  onDraftChange: (draft: ProfileEditorDraft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const { t } = useTranslation();
  const { draft } = props;
  const canSave = !props.saving && draft.title.trim().length > 0 && draft.profileJsonText.trim().length > 0;
  const profileBodyLineCount = draft.profileJsonText.length > 0
    ? draft.profileJsonText.split(/\r?\n/).length
    : 0;
  const profileBodyCharacterCount = draft.profileJsonText.trim().length;
  const modeLabel = draft.mode === 'create'
    ? t('runtimeConfig.profiles.createProfile', { defaultValue: 'Create Profile' })
    : t('runtimeConfig.profiles.editProfile', { defaultValue: 'Edit Profile' });

  const editorLayer = (
    <div
      className="fixed inset-0 z-[var(--nimi-z-dialog)] overflow-y-auto bg-[color-mix(in_srgb,var(--nimi-surface-canvas)_78%,rgba(15,23,42,0.28))] px-3 py-3 backdrop-blur-sm sm:px-4 lg:px-6"
      data-testid="runtime-profiles-editor-full-page"
    >
      <section
        aria-labelledby="runtime-profiles-editor-title"
        aria-modal="true"
        role="dialog"
        className="mx-auto flex min-h-[calc(100vh-2rem)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] shadow-xl"
        data-testid="runtime-profiles-editor"
      >
        <header className="border-b border-[var(--nimi-border-subtle)] bg-[color-mix(in_srgb,var(--nimi-surface-card)_92%,var(--nimi-surface-panel))] px-5 py-4 sm:px-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h3 id="runtime-profiles-editor-title" className="text-xl font-semibold text-[var(--nimi-text-primary)]">
                {modeLabel}
              </h3>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={props.onCancel}
                className="rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-4 py-2 text-xs font-medium text-[var(--nimi-text-secondary)] transition-colors hover:bg-[var(--nimi-surface-panel)]"
              >
                {t('runtimeConfig.profiles.cancel', { defaultValue: 'Cancel' })}
              </button>
              <button
                type="button"
                disabled={!canSave}
                onClick={props.onSave}
                className="rounded-xl bg-[var(--nimi-action-primary-bg)] px-4 py-2 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_88%,black)] disabled:pointer-events-none disabled:opacity-50"
              >
                {props.saving
                  ? t('runtimeConfig.profiles.saving', { defaultValue: 'Saving...' })
                  : t('runtimeConfig.profiles.saveProfile', { defaultValue: 'Save Profile' })}
              </button>
            </div>
          </div>
        </header>

        <div className="grid flex-1 gap-4 p-4 sm:p-5 xl:grid-cols-[minmax(220px,0.75fr)_minmax(420px,1.35fr)]">
          <section
            className="rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)]/60 p-4"
            data-testid="runtime-profiles-editor-identity-panel"
          >
            <div className="space-y-4">
              <label className="block">
                <span className="text-xs font-medium text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.profiles.titleLabel', { defaultValue: 'Title' })}
                </span>
                <input
                  value={draft.title}
                  onChange={(event) => props.onDraftChange({ ...draft, title: event.target.value })}
                  className="mt-1 h-10 w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 text-sm text-[var(--nimi-text-primary)] outline-none transition-colors placeholder:text-[var(--nimi-text-muted)] focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
                  placeholder={t('runtimeConfig.profiles.titlePlaceholder', { defaultValue: 'My AI Profile' })}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.profiles.descriptionLabel', { defaultValue: 'Description' })}
                </span>
                <textarea
                  value={draft.description}
                  onChange={(event) => props.onDraftChange({ ...draft, description: event.target.value })}
                  className="mt-1 min-h-28 w-full resize-y rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-sm leading-5 text-[var(--nimi-text-primary)] outline-none transition-colors placeholder:text-[var(--nimi-text-muted)] focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
                  placeholder={t('runtimeConfig.profiles.descriptionPlaceholder', { defaultValue: 'Describe this profile...' })}
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-[var(--nimi-text-secondary)]">
                  {t('runtimeConfig.profiles.tagsLabel', { defaultValue: 'Tags' })}
                </span>
                <input
                  value={draft.tagsText}
                  onChange={(event) => props.onDraftChange({ ...draft, tagsText: event.target.value })}
                  className="mt-1 h-10 w-full rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 text-sm text-[var(--nimi-text-primary)] outline-none transition-colors placeholder:text-[var(--nimi-text-muted)] focus:border-[var(--nimi-field-focus)] focus:ring-2 focus:ring-[var(--nimi-focus-ring-color)]"
                  placeholder={t('runtimeConfig.profiles.tagsPlaceholder', { defaultValue: 'local, writing, fast' })}
                />
              </label>
            </div>
          </section>

          <section
            className="flex min-h-[32rem] flex-col rounded-2xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)]"
            data-testid="runtime-profiles-editor-json-panel"
          >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--nimi-border-subtle)] px-4 py-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--nimi-text-primary)]">
                  {t('runtimeConfig.profiles.profileBodyLabel', { defaultValue: 'Portable profile body JSON' })}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2 text-[11px] text-[var(--nimi-text-muted)]">
                <span className="rounded-full bg-[var(--nimi-surface-panel)] px-2 py-1 ring-1 ring-[var(--nimi-border-subtle)]">
                  {t('runtimeConfig.profiles.editorJsonLines', {
                    defaultValue: '{{count}} lines',
                    count: profileBodyLineCount,
                  })}
                </span>
                <span className="rounded-full bg-[var(--nimi-surface-panel)] px-2 py-1 ring-1 ring-[var(--nimi-border-subtle)]">
                  {t('runtimeConfig.profiles.editorJsonCharacters', {
                    defaultValue: '{{count}} chars',
                    count: profileBodyCharacterCount,
                  })}
                </span>
              </div>
            </div>
            <textarea
              value={draft.profileJsonText}
              onChange={(event) => props.onDraftChange({ ...draft, profileJsonText: event.target.value })}
              className="min-h-[28rem] flex-1 resize-y border-0 bg-[color:rgb(15_23_42)] p-4 font-mono text-xs leading-5 text-[color:rgb(241_245_249)] outline-none placeholder:text-[color:rgb(148_163_184)] focus:ring-2 focus:ring-inset focus:ring-[var(--nimi-field-focus)]"
              spellCheck={false}
              placeholder={'{\n  "capabilities": {}\n}'}
            />
          </section>
        </div>
      </section>
    </div>
  );

  return typeof document === 'undefined'
    ? editorLayer
    : createPortal(editorLayer, document.body);
}

export function ProfileLibraryActions(props: {
  exportCount: number;
  onLibraryChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const {
    exportCount,
    onLibraryChanged,
  } = props;
  const [feedback, setFeedback] = useState<ProfileFeedback>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleExport = useCallback(async () => {
    try {
      const profiles = await exportAccountProfileLibraryEntries();
      if (profiles.length === 0) {
        setFeedback({
          type: 'error',
          message: t('runtimeConfig.profiles.exportEmpty', { defaultValue: 'No editable profiles to export.' }),
        });
        return;
      }
      const json = JSON.stringify(profiles, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `nimi-ai-profiles-${Date.now()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (error: unknown) {
      setFeedback({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to export profiles.',
      });
    }
  }, [t]);

  const handleImportClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportFile = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(String(reader.result || ''));
        } catch {
          setFeedback({ type: 'error', message: t('runtimeConfig.profiles.invalidJson', { defaultValue: 'Invalid JSON' }) });
          return;
        }
        const items = Array.isArray(parsed) ? parsed : [parsed];
        const candidates: NimiAIProfile[] = [];
        const errors: string[] = [];
        for (let index = 0; index < items.length; index += 1) {
          const result = validateNimiAIProfile(items[index]);
          if (result.valid) {
            candidates.push(items[index] as NimiAIProfile);
          } else {
            errors.push(`Item ${index}: ${result.errors.join(', ')}`);
          }
        }
        if (candidates.length === 0) {
          setFeedback({
            type: 'error',
            message: errors.join('; ') || t('runtimeConfig.profiles.importNone', { defaultValue: 'No valid profiles found.' }),
          });
          return;
        }
        try {
          await importAccountProfileLibraryEntries(candidates);
          await onLibraryChanged();
          setFeedback({
            type: 'success',
            message: t('runtimeConfig.profiles.importSuccess', {
              defaultValue: 'Imported {{count}} profile(s).',
              count: candidates.length,
            }),
          });
        } catch (error: unknown) {
          setFeedback({
            type: 'error',
            message: error instanceof Error ? error.message : 'Failed to import profiles.',
          });
        }
      })();
    };
    reader.readAsText(file);
  }, [onLibraryChanged, t]);

  return (
    <section
      className="flex flex-col items-end gap-2"
      data-testid="runtime-profiles-file-transfer"
      aria-label={t('runtimeConfig.profiles.libraryTitle', { defaultValue: 'Move templates' })}
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            data-testid="runtime-profiles-import"
            onClick={handleImportClick}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3.5 text-sm font-medium text-[var(--nimi-text-secondary)] shadow-sm transition-colors hover:bg-[var(--nimi-surface-panel)]"
          >
            {t('runtimeConfig.profiles.import', { defaultValue: 'Import JSON' })}
          </button>
          <button
            type="button"
            data-testid="runtime-profiles-export"
            onClick={() => { void handleExport(); }}
            disabled={exportCount === 0}
            className="inline-flex h-10 items-center justify-center rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3.5 text-sm font-medium text-[var(--nimi-text-secondary)] shadow-sm transition-colors hover:bg-[var(--nimi-surface-panel)] disabled:pointer-events-none disabled:opacity-50"
          >
            {t('runtimeConfig.profiles.export', { defaultValue: 'Export JSON' })}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
      </div>

      {feedback ? (
        <p
          className={
            feedback.type === 'success'
              ? 'max-w-sm rounded-xl bg-[color-mix(in_srgb,var(--nimi-status-success)_10%,var(--nimi-surface-card))] px-3 py-2 text-xs text-[var(--nimi-status-success)] ring-1 ring-[color-mix(in_srgb,var(--nimi-status-success)_24%,transparent)]'
              : 'max-w-sm rounded-xl bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,var(--nimi-surface-card))] px-3 py-2 text-xs text-[var(--nimi-status-danger)] ring-1 ring-[color-mix(in_srgb,var(--nimi-status-danger)_24%,transparent)]'
          }
          role="status"
        >
          {feedback.message}
          <button
            type="button"
            className="ml-2 opacity-60 hover:opacity-100"
            onClick={() => setFeedback(null)}
          >
            {t('runtimeConfig.profiles.dismiss', { defaultValue: 'Dismiss' })}
          </button>
        </p>
      ) : null}
    </section>
  );
}
