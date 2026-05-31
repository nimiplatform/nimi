// First-Run Phase 2 — Local AI.
//
// Presents the `data_root_selected` and `ai_environment_unconfigured`
// user-action states: the user picks an install level. The phase is
// interactive the moment it opens — the two cards are driven by the local
// admitted install-level policy (not the device scan), so nothing blocks the
// choice. The "Detected" line projects real Runtime device-scan evidence,
// loading inline in the background and failing closed when none exists.

import type { ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Button } from '@nimiplatform/kit/ui';
import type { FirstRunInstallLevel } from '@nimiplatform/sdk/platform-catalog';
import type {
  FirstRunCapabilityHighlightId,
  FirstRunInstallLevelCard,
} from './first-run-install-level-cards.js';
import {
  CheckCircleFilledIcon,
  CheckIcon,
  ChipIcon,
  EmptyCircleIcon,
  SparklesIcon,
} from './first-run-icons.js';

const HIGHLIGHT_DEFAULTS: Record<FirstRunCapabilityHighlightId, string> = {
  'fast-setup': 'Fast setup',
  'lower-resource': 'Lower resource usage',
  'everyday-chat': 'Great for everyday chat',
  'smarter-answers': 'Smarter answers',
  'image-generation': 'Image generation',
  'future-ready': 'Future-ready features',
  'local-voice': 'Local voice',
};

function highlightLabel(t: TFunction, id: FirstRunCapabilityHighlightId): string {
  return t(`FirstRun.localAi.highlights.${id}`, { defaultValue: HIGHLIGHT_DEFAULTS[id] });
}

type PhaseLocalAiProps = {
  readonly cards: {
    readonly minimal: FirstRunInstallLevelCard;
    readonly recommended: FirstRunInstallLevelCard;
  };
  /** The currently selected install level, or null when none is chosen yet. */
  readonly selected: FirstRunInstallLevel | null;
  /**
   * The real device-scan summary line, or null when device evidence is
   * unavailable (fail-closed — no fabricated device string).
   */
  readonly deviceSummary: string | null;
  /** True while the background device scan has not yet settled. */
  readonly deviceScanPending: boolean;
  /** The recorded nimi_data folder, shown so the user can review/change it. */
  readonly dataRootPath: string | null;
  readonly busy: boolean;
  readonly onSelect: (installLevel: FirstRunInstallLevel) => void;
  /** Re-opens the OS folder picker to change the recorded nimi_data folder. */
  readonly onChangeDataRoot: () => void;
  readonly onContinue: () => void;
};

function InstallLevelCard(props: {
  readonly card: FirstRunInstallLevelCard;
  readonly selected: boolean;
  readonly busy: boolean;
  readonly t: TFunction;
  readonly onSelect: () => void;
}): ReactElement {
  const { card, selected, t } = props;
  const isRecommended = card.installLevel === 'recommended';
  const unavailable = !card.plan;

  const titleDefault = isRecommended ? 'Recommended' : 'Minimal';
  const subtitleDefault = isRecommended
    ? 'Adds local embeddings and image generation'
    : 'Lightweight — local chat and voice';

  return (
    <button
      type="button"
      data-testid={`first-run-install-level-${card.installLevel}`}
      data-selected={selected ? 'true' : 'false'}
      disabled={unavailable || props.busy}
      onClick={props.onSelect}
      className={[
        'relative flex flex-1 flex-col gap-3 rounded-xl border p-5 text-left transition',
        'disabled:cursor-not-allowed disabled:opacity-60',
        selected
          ? 'border-[var(--nimi-action-primary-bg)] bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_8%,white)]'
          : 'border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] hover:border-[color-mix(in_srgb,var(--nimi-action-primary-bg)_40%,var(--nimi-border-subtle))]',
      ].join(' ')}
    >
      <span className="absolute right-4 top-4" aria-hidden>
        {selected ? (
          <CheckCircleFilledIcon className="h-5 w-5 text-[var(--nimi-action-primary-bg)]" />
        ) : (
          <EmptyCircleIcon className="h-5 w-5 text-[color-mix(in_srgb,var(--nimi-text-muted)_55%,transparent)]" />
        )}
      </span>

      <span
        aria-hidden
        className={[
          'flex h-11 w-11 items-center justify-center rounded-xl',
          isRecommended
            ? 'bg-[color-mix(in_srgb,var(--nimi-action-primary-bg)_14%,white)] text-[var(--nimi-action-primary-bg)]'
            : 'bg-[var(--nimi-surface-active)] text-[var(--nimi-text-secondary)]',
        ].join(' ')}
      >
        {isRecommended ? <SparklesIcon className="h-6 w-6" /> : <ChipIcon className="h-6 w-6" />}
      </span>

      <div className="flex flex-col gap-1">
        <span className="text-base font-semibold text-[var(--nimi-text-primary)]">
          {t(`FirstRun.localAi.cards.${card.installLevel}.title`, { defaultValue: titleDefault })}
        </span>
        <span className="text-sm text-[var(--nimi-text-secondary)]">
          {t(`FirstRun.localAi.cards.${card.installLevel}.subtitle`, { defaultValue: subtitleDefault })}
        </span>
      </div>

      {unavailable ? (
        <span
          data-testid={`first-run-install-level-${card.installLevel}-unavailable`}
          className="text-xs font-medium text-[var(--nimi-status-danger)]"
        >
          {t('FirstRun.localAi.unavailable', {
            defaultValue: 'No admitted local plan for this level.',
          })}
        </span>
      ) : (
        <ul className="mt-1 flex flex-col gap-1.5">
          {card.highlights.map((id) => (
            <li key={id} className="flex items-center gap-2 text-sm text-[var(--nimi-text-secondary)]">
              <CheckIcon className="h-4 w-4 shrink-0 text-[var(--nimi-action-primary-bg)]" />
              <span>{highlightLabel(t, id)}</span>
            </li>
          ))}
        </ul>
      )}
    </button>
  );
}

/**
 * Phase 2 content — interactive the moment it opens.
 */
export function PhaseLocalAi(props: PhaseLocalAiProps): ReactElement {
  const { t } = useTranslation();

  return (
    <div data-testid="first-run-phase-local-ai" className="flex flex-col gap-7">
      <header className="flex flex-col gap-2 text-center">
        <h2 className="text-xl font-semibold text-[var(--nimi-text-primary)]">
          {t('FirstRun.localAi.heading', { defaultValue: 'Set up your local AI' })}
        </h2>
      </header>

      <div className="flex items-stretch gap-4">
        <InstallLevelCard
          card={props.cards.minimal}
          selected={props.selected === 'minimal'}
          busy={props.busy}
          t={t}
          onSelect={() => props.onSelect('minimal')}
        />
        <InstallLevelCard
          card={props.cards.recommended}
          selected={props.selected === 'recommended'}
          busy={props.busy}
          t={t}
          onSelect={() => props.onSelect('recommended')}
        />
      </div>

      <div className="flex flex-col items-center gap-1.5">
        <p
          data-testid="first-run-device-summary"
          data-device-scan={props.deviceScanPending ? 'pending' : 'settled'}
          className="text-center text-xs text-[var(--nimi-text-muted)]"
        >
          {props.deviceScanPending ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="nimi-first-run-pulse inline-block h-1.5 w-1.5 rounded-full bg-[var(--nimi-action-primary-bg)]" />
              {t('FirstRun.localAi.detecting', {
                defaultValue: 'Checking this device in the background…',
              })}
            </span>
          ) : props.deviceSummary ? (
            t('FirstRun.localAi.detected', {
              device: props.deviceSummary,
              defaultValue: 'Detected: {{device}}',
            })
          ) : (
            t('FirstRun.localAi.detectedUnavailable', {
              defaultValue: 'Device scan evidence is unavailable.',
            })
          )}
        </p>
        {props.dataRootPath ? (
          <p
            data-testid="first-run-local-ai-storage-row"
            className="flex max-w-full items-center justify-center gap-1.5 text-xs text-[var(--nimi-text-muted)]"
          >
            <span className="truncate">
              {t('FirstRun.localAi.storageFolder', {
                path: props.dataRootPath,
                defaultValue: 'Saving to {{path}}',
              })}
            </span>
            <button
              type="button"
              data-testid="first-run-local-ai-change-folder"
              disabled={props.busy}
              onClick={props.onChangeDataRoot}
              className="shrink-0 font-medium text-[var(--nimi-action-primary-bg)] underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t('FirstRun.localAi.changeFolder', { defaultValue: 'Change folder' })}
            </button>
          </p>
        ) : null}
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          tone="primary"
          className="rounded-full px-6"
          data-testid="first-run-local-ai-continue"
          disabled={props.busy || props.selected === null}
          onClick={props.onContinue}
        >
          {t('FirstRun.continue', { defaultValue: 'Continue' })}
        </Button>
      </div>
    </div>
  );
}
