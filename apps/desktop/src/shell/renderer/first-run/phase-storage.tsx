// First-Run Phase 1 — Storage.
//
// Presents the `data_root_missing` user-action state: the user picks the
// folder where Nimi keeps models and data. The fast `config_missing` system
// state folds in here as a subtle inline loading affordance — it never gets
// its own boxed screen. The folder picker is the OS native directory dialog
// (no raw absolute-path text field); the chosen absolute path is recorded by
// the existing `selectProductDataRoot` bridge call.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/nimi-kit/ui';
import { FolderIcon } from './first-run-icons.js';

type PhaseStorageProps = {
  /** True when the phase is in its transient `config_missing` loading state. */
  readonly transient: boolean;
  /** The absolute path chosen so far, or null when none has been picked. */
  readonly pickedPath: string | null;
  /** Whether a bridge action (picker / record) is in flight. */
  readonly busy: boolean;
  /** Opens the OS native directory picker. */
  readonly onChooseFolder: () => void;
  /** Records the picked path through `selectProductDataRoot`. */
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

  return (
    <div data-testid="first-run-phase-storage" data-phase-transient="false" className="flex flex-col gap-7">
      <header className="flex flex-col gap-2 text-center">
        <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
          {t('FirstRun.storage.heading', {
            defaultValue: 'Where should Nimi keep your models and data?',
          })}
        </h2>
        <p className="text-sm text-[var(--nimi-text-secondary)]">
          {t('FirstRun.storage.subline', {
            defaultValue: "We'll store everything locally on your device.",
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
          data-testid="first-run-storage-choose-folder"
          disabled={props.busy}
          onClick={props.onChooseFolder}
        >
          {t('FirstRun.storage.chooseFolder', { defaultValue: 'Choose folder…' })}
        </Button>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          tone="primary"
          className="rounded-full px-6"
          data-testid="first-run-storage-continue"
          disabled={props.busy || !hasPath}
          onClick={props.onContinue}
        >
          {t('FirstRun.continue', { defaultValue: 'Continue' })}
        </Button>
      </div>
    </div>
  );
}
