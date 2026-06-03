import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AIProfile } from '@nimiplatform/sdk/ai';
import { validateAIProfile } from '@nimiplatform/sdk/ai';

import {
  exportAccountProfileLibraryEntries,
  importAccountProfileLibraryEntries,
} from './runtime-config-profile-library.js';

export type ProfileFeedback = { type: 'success' | 'error'; message: string } | null;

export type ProfileEditorDraft = {
  mode: 'create' | 'edit';
  profile: AIProfile;
  title: string;
  description: string;
  tagsText: string;
  replaceWithCurrentConfig: boolean;
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
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/20 px-4">
      <section
        className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
        data-testid="runtime-profiles-editor"
      >
        <div>
          <h3 className="text-base font-semibold text-slate-950">
            {draft.mode === 'create'
              ? t('runtimeConfig.profiles.createProfile', { defaultValue: 'Create Profile' })
              : t('runtimeConfig.profiles.editProfile', { defaultValue: 'Edit Profile' })}
          </h3>
          <p className="mt-1 text-xs text-slate-500">
            {t('runtimeConfig.profiles.profileIdentityHint', {
              defaultValue: 'Set this AI profile metadata and choose whether to capture the current AI config.',
            })}
          </p>
        </div>

        <div className="mt-5 space-y-4">
          <label className="block">
            <span className="text-xs font-medium text-slate-700">
              {t('runtimeConfig.profiles.titleLabel', { defaultValue: 'Title' })}
            </span>
            <input
              value={draft.title}
              onChange={(event) => props.onDraftChange({ ...draft, title: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              placeholder={t('runtimeConfig.profiles.titlePlaceholder', { defaultValue: 'My AI Profile' })}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-700">
              {t('runtimeConfig.profiles.descriptionLabel', { defaultValue: 'Description' })}
            </span>
            <textarea
              value={draft.description}
              onChange={(event) => props.onDraftChange({ ...draft, description: event.target.value })}
              className="mt-1 min-h-24 w-full resize-y rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              placeholder={t('runtimeConfig.profiles.descriptionPlaceholder', { defaultValue: 'Describe this profile...' })}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-700">
              {t('runtimeConfig.profiles.tagsLabel', { defaultValue: 'Tags' })}
            </span>
            <input
              value={draft.tagsText}
              onChange={(event) => props.onDraftChange({ ...draft, tagsText: event.target.value })}
              className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
              placeholder={t('runtimeConfig.profiles.tagsPlaceholder', { defaultValue: 'local, writing, fast' })}
            />
          </label>
          <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
            <input
              type="checkbox"
              checked={draft.replaceWithCurrentConfig}
              onChange={(event) => props.onDraftChange({ ...draft, replaceWithCurrentConfig: event.target.checked })}
              className="mt-0.5 h-4 w-4 rounded border-slate-300 text-emerald-600"
            />
            <span>
              <span className="block text-xs font-medium text-slate-800">
                {draft.mode === 'create'
                  ? t('runtimeConfig.profiles.captureCurrentConfig', { defaultValue: 'Create from current AI config' })
                  : t('runtimeConfig.profiles.replaceWithCurrentConfig', { defaultValue: 'Replace capabilities with current AI config' })}
              </span>
              <span className="mt-1 block text-xs text-slate-500">
                {t('runtimeConfig.profiles.captureCurrentConfigHint', {
                  defaultValue: 'This changes the profile template only; applying it to a scope remains preview-gated.',
                })}
              </span>
            </span>
          </label>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={props.onCancel}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
          >
            {t('runtimeConfig.profiles.cancel', { defaultValue: 'Cancel' })}
          </button>
          <button
            type="button"
            disabled={props.saving || draft.title.trim().length === 0}
            onClick={props.onSave}
            className="rounded-xl bg-emerald-500 px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-emerald-600 disabled:pointer-events-none disabled:opacity-50"
          >
            {props.saving
              ? t('runtimeConfig.profiles.saving', { defaultValue: 'Saving...' })
              : t('runtimeConfig.profiles.saveProfile', { defaultValue: 'Save Profile' })}
          </button>
        </div>
      </section>
    </div>
  );
}

export function ProfileLibraryActions(props: {
  onRestoreToAccountDefault: () => void;
  restoring: boolean;
  exportCount: number;
  onLibraryChanged: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const {
    exportCount,
    onLibraryChanged,
    onRestoreToAccountDefault,
    restoring,
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
        const candidates: AIProfile[] = [];
        const errors: string[] = [];
        for (let index = 0; index < items.length; index += 1) {
          const result = validateAIProfile(items[index]);
          if (result.valid) {
            candidates.push(items[index] as AIProfile);
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
      className="rounded-2xl border border-gray-200 bg-white p-5 shadow-sm"
      data-testid="runtime-profiles-library-actions"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">
            {t('runtimeConfig.profiles.libraryTitle', { defaultValue: 'Profile Library' })}
          </h3>
          <p className="mt-0.5 text-xs text-gray-500">
            {t('runtimeConfig.profiles.librarySubtitle', {
              defaultValue: 'Import, export, and restore your account profile library.',
            })}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            data-testid="runtime-profiles-import"
            onClick={handleImportClick}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50"
          >
            {t('runtimeConfig.profiles.import', { defaultValue: 'Import' })}
          </button>
          <button
            type="button"
            data-testid="runtime-profiles-export"
            onClick={() => { void handleExport(); }}
            disabled={exportCount === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-all hover:bg-gray-50 disabled:pointer-events-none disabled:opacity-50"
          >
            {t('runtimeConfig.profiles.export', { defaultValue: 'Export' })}
          </button>
          <button
            type="button"
            data-testid="runtime-profiles-factory-restore"
            onClick={onRestoreToAccountDefault}
            disabled={restoring}
            className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-white px-3.5 py-1.5 text-xs font-medium text-amber-700 shadow-sm transition-all hover:bg-amber-50 disabled:pointer-events-none disabled:opacity-50"
          >
            {restoring
              ? t('runtimeConfig.profiles.restoring', { defaultValue: 'Restoring...' })
              : t('runtimeConfig.profiles.factoryRestore', { defaultValue: 'Restore to Account Default' })}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImportFile}
          />
        </div>
      </div>
      {feedback ? (
        <p
          className={
            feedback.type === 'success'
              ? 'mt-3 rounded-xl bg-green-50 px-3 py-2 text-xs text-green-700 ring-1 ring-green-200'
              : 'mt-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700 ring-1 ring-red-200'
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
