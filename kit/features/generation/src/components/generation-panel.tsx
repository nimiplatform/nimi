import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button, IconButton, InlineAlert, Surface } from '@nimiplatform/kit/ui';
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
          <InlineAlert tone="warning" className="text-xs">
            {warning}
          </InlineAlert>
        ) : null}

        {state.error ? (
          <InlineAlert
            tone="danger"
            className="text-xs"
            action={(
              <IconButton
                size="sm"
                tone="ghost"
                onClick={state.clearError}
                aria-label={dismissErrorLabel}
                icon={<X size={14} aria-hidden="true" />}
              />
            )}
          >
            {state.error}
          </InlineAlert>
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
