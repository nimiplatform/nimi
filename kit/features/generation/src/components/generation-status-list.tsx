import type { ReactNode } from 'react';
import { ProgressIndicator, Surface } from '@nimiplatform/kit/ui';
import type { GenerationRunItem, GenerationRunStatus } from '../types.js';

export type GenerationStatusListProps = {
  items: readonly GenerationRunItem[];
  className?: string;
  renderStatusExtra?: (item: GenerationRunItem) => ReactNode;
  /** Host-injected status label mapping; defaults to the raw status id (English enum). */
  getStatusLabel?: (status: GenerationRunStatus) => string;
};

const defaultGetStatusLabel = (status: GenerationRunStatus): string => status;

function statusTone(status: string) {
  if (status === 'completed') return 'text-[color:var(--nimi-status-success)]';
  if (status === 'failed') return 'text-[color:var(--nimi-status-danger)]';
  if (status === 'running' || status === 'submitted') return 'text-[color:var(--nimi-status-info)]';
  if (status === 'pending' || status === 'queued' || status === 'timeout') return 'text-[color:var(--nimi-status-warning)]';
  return 'text-[color:var(--nimi-text-muted)]';
}

export function GenerationStatusList({
  items,
  className,
  renderStatusExtra,
  getStatusLabel = defaultGetStatusLabel,
}: GenerationStatusListProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.runId} className="rounded-[var(--nimi-radius-md)] border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[color:var(--nimi-text-secondary)]">{item.label}</span>
              <span className={`font-medium ${statusTone(item.status)}`}>{getStatusLabel(item.status)}</span>
            </div>
            {item.progressValue !== undefined ? (
              <div className="mt-2">
                <ProgressIndicator value={item.progressValue} />
                {item.progressLabel ? (
                  <p className="mt-1 text-[length:var(--nimi-type-overline-size)] text-[color:var(--nimi-text-muted)]">{item.progressLabel}</p>
                ) : null}
              </div>
            ) : null}
            {item.error ? (
              <p className="mt-2 text-[color:var(--nimi-status-danger)]">{item.error}</p>
            ) : null}
            {renderStatusExtra ? <div className="mt-2">{renderStatusExtra(item)}</div> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function GenerationStatusToast({
  items,
  className,
  renderStatusExtra,
  getStatusLabel,
}: GenerationStatusListProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <Surface tone="panel" className={className}>
      <GenerationStatusList items={items} renderStatusExtra={renderStatusExtra} getStatusLabel={getStatusLabel} />
    </Surface>
  );
}
