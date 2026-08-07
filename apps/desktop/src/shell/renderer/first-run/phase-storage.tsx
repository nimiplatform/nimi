// First-Run Phase 1 — Storage.
//
// Presents the complete Product Control storage flow. `data_root_missing`
// selects a folder; `data_root_selected` keeps that selection visible and
// offers Change, Retry, and Continue while backend admission validates the
// Product Control prerequisites. AI setup is not part of this flow.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/kit/ui';
import { FolderIcon } from './first-run-icons.js';

type PhaseStorageProps = {
  /** True when the phase is in its transient `config_missing` loading state. */
  readonly transient: boolean;
  readonly mode: 'missing' | 'selected';
  /** The absolute path chosen so far, or null when none has been picked. */
  readonly pickedPath: string | null;
  /** Whether a bridge action (picker / record) is in flight. */
  readonly busy: boolean;
  /** Opens the OS native directory picker. */
  readonly onChooseFolder: () => void;
  /** Replaces the recorded data root through the native directory picker. */
  readonly onChangeFolder: () => void;
  /** Retries backend Product Control admission. */
  readonly onRetry: () => void;
  /** Records a candidate or requests backend Product Control admission. */
  readonly onContinue: () => void;
};

/**
 * Phase 1 content. `transient` swaps the interactive surface for a calm
 * loading line while `~/.nimi/nimi.json` is being created.
 */
export function PhaseStorage(props: PhaseStorageProps): ReactElement {
  const { t } = useTranslation();

  if (props.transient) {
    return (
      <div
        data-testid="first-run-phase-storage"
        data-phase-transient="true"
        className="flex flex-col items-center gap-4 py-6 text-center"
      >
        <span className="nimi-first-run-pulse h-9 w-9 rounded-full border-2 border-[var(--nimi-action-primary-bg)] border-t-transparent" />
        <p className="text-sm text-[var(--nimi-text-secondary)]">
          {t('FirstRun.storage.preparing', {
            defaultValue: 'Preparing Nimi on this device…',
          })}
        </p>
      </div>
    );
  }

  const hasPath = Boolean(props.pickedPath && props.pickedPath.trim());
  const selected = props.mode === 'selected';

  return (
    <div data-testid="first-run-phase-storage" data-phase-transient="false" className="flex flex-col gap-7">
      <header className="flex flex-col gap-2 text-center">
        <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
          {selected
            ? t('FirstRun.storage.selectedHeading', {
                defaultValue: 'Confirm where Nimi stores its local data.',
              })
            : t('FirstRun.storage.heading', {
                defaultValue: 'Choose where Nimi stores models, apps, and large local data.',
              })}
        </h2>
        <p className="text-sm text-[var(--nimi-text-secondary)]">
          {selected
            ? t('FirstRun.storage.selectedSubline', {
                defaultValue: 'Continue to validate the selected folder and finish Product Control setup.',
              })
            : t('FirstRun.storage.subline', {
                defaultValue: 'Nimi keeps models, apps, and large local data in the folder you select.',
              })}
        </p>
      </header>

      {/* Folder-picker row: icon box · path-display field · Choose folder button. */}
      <div className="flex items-stretch gap-3">
        <span
          aria-hidden
          className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)]"
        >
          <FolderIcon className="h-6 w-6 text-[var(--nimi-action-primary-bg)]" />
        </span>
        <div
          data-testid="first-run-storage-path"
          className="flex min-w-0 flex-1 items-center rounded-xl border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-panel)] px-4"
        >
          <span
            className={
              hasPath
                ? 'truncate text-sm text-[var(--nimi-text-primary)]'
                : 'truncate text-sm text-[var(--nimi-text-muted)]'
            }
          >
            {hasPath
              ? props.pickedPath
              : t('FirstRun.storage.pathPlaceholder', { defaultValue: 'No folder chosen yet' })}
          </span>
        </div>
        <Button
          type="button"
          tone="secondary"
          data-testid={selected ? 'first-run-storage-change-folder' : 'first-run-storage-choose-folder'}
          disabled={props.busy}
          onClick={selected ? props.onChangeFolder : props.onChooseFolder}
        >
          {selected
            ? t('FirstRun.storage.changeFolder', { defaultValue: 'Change folder…' })
            : t('FirstRun.storage.chooseFolder', { defaultValue: 'Choose folder…' })}
        </Button>
      </div>

      <div className="flex justify-end gap-3">
        {selected ? (
          <Button
            type="button"
            tone="secondary"
            data-testid="first-run-storage-retry"
            disabled={props.busy}
            onClick={props.onRetry}
          >
            {t('FirstRun.storage.retry', { defaultValue: 'Retry validation' })}
          </Button>
        ) : null}
        <Button
          type="button"
          tone="primary"
          className="rounded-full px-6"
          data-testid="first-run-storage-continue"
          disabled={props.busy || !hasPath}
          onClick={props.onContinue}
        >
          {selected
            ? t('FirstRun.storage.finish', { defaultValue: 'Continue' })
            : t('FirstRun.continue', { defaultValue: 'Continue' })}
        </Button>
      </div>
    </div>
  );
}
