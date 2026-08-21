import type { ReactNode } from 'react';
import { Button, Surface } from '@nimiplatform/kit/ui';
import { FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';
import type { UseGenerationPanelResult } from '../hooks/use-generation-panel.js';
import type { GenerationRunItem, GenerationRunStatus } from '../types.js';
import { GenerationStatusList } from './generation-status-list.js';

export type GenerationPanelProps = {
  state: UseGenerationPanelResult;
  title?: ReactNode;
  className?: string;
  runtimeLabel?: ReactNode;
  runtimeValue?: ReactNode;
  warning?: ReactNode;
  controls?: ReactNode;
  submitLabel?: string;
  submittingLabel?: string;
  dismissErrorLabel?: string;
  statusItems?: readonly GenerationRunItem[];
  renderStatusExtra?: (item: GenerationRunItem) => ReactNode;
  /** Host-injected status label mapping; defaults to the raw status id (English enum). */
  getStatusLabel?: (status: GenerationRunStatus) => string;
};

export function GenerationPanel({
  state,
  title = 'Generation Controls',
  className,
  runtimeLabel = 'Runtime Path',
  runtimeValue,
  warning,
  controls,
  submitLabel = 'Generate',
  submittingLabel = 'Generating...',
  dismissErrorLabel = 'Dismiss generation error',
  statusItems = [],
  renderStatusExtra,
  getStatusLabel,
}: GenerationPanelProps) {
  return (
    <Surface tone="panel" className={className}>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-[color:var(--nimi-text-primary)]">{title}</h3>
          {runtimeValue ? (
            <div className="min-w-0 rounded-[var(--nimi-radius-md)] border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] px-3 py-2 text-right text-xs text-[color:var(--nimi-text-secondary)]">
              <p className="nimi-type-overline uppercase text-[color:var(--nimi-text-muted)]">{runtimeLabel}</p>
              <p className="mt-1 truncate">{runtimeValue}</p>
            </div>
          ) : null}
        </div>

        {controls ? <div className="space-y-3">{controls}</div> : null}

        {warning ? (
          <div className="rounded-[var(--nimi-radius-md)] border border-[color:var(--nimi-status-warning)]/25 bg-[color:var(--nimi-status-warning)]/8 px-3 py-2 text-xs text-[color:var(--nimi-status-warning)]">
            {warning}
          </div>
        ) : null}

        {state.error ? (
          <div className="rounded-[var(--nimi-radius-md)] border border-[color:var(--nimi-status-danger)]/25 bg-[color:var(--nimi-status-danger)]/8 px-3 py-2 text-xs text-[color:var(--nimi-status-danger)]">
            <div className="flex items-start justify-between gap-3">
              <span>{state.error}</span>
              <button
                type="button"
                onClick={state.clearError}
                className={`shrink-0 text-[color:var(--nimi-text-muted)] transition hover:text-[color:var(--nimi-text-primary)] ${FOCUS_RING_CLASS_NAME}`}
                aria-label={dismissErrorLabel}
              >
                ×
              </button>
            </div>
          </div>
        ) : null}

        <Button
          type="button"
          tone="primary"
          size="sm"
          className="w-full"
          disabled={!state.canSubmit}
          onClick={() => {
            void state.handleSubmit();
          }}
        >
          {state.isSubmitting ? submittingLabel : submitLabel}
        </Button>

        <GenerationStatusList items={statusItems} renderStatusExtra={renderStatusExtra} getStatusLabel={getStatusLabel} />
      </div>
    </Surface>
  );
}
