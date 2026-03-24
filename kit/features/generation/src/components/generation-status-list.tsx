import type { ReactNode } from 'react';
import { Surface } from '@nimiplatform/nimi-kit/ui';
import type { GenerationRunItem } from '../types.js';

export type GenerationStatusListProps = {
  items: readonly GenerationRunItem[];
  className?: string;
  renderStatusExtra?: (item: GenerationRunItem) => ReactNode;
};

function statusTone(status: string) {
  if (status === 'completed') return 'text-[color:var(--nimi-status-success)]';
  if (status === 'failed') return 'text-[color:var(--nimi-status-danger)]';
  if (status === 'running') return 'text-[color:var(--nimi-status-info)]';
  if (status === 'pending' || status === 'timeout') return 'text-[color:var(--nimi-status-warning)]';
  return 'text-[color:var(--nimi-text-muted)]';
}

export function GenerationStatusList({
  items,
  className,
  renderStatusExtra,
}: GenerationStatusListProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className={className}>
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.runId} className="rounded-xl border border-[color:var(--nimi-border-subtle)] bg-[color:var(--nimi-surface-card)] px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[color:var(--nimi-text-secondary)]">{item.label}</span>
              <span className={`font-medium ${statusTone(item.status)}`}>{item.status}</span>
            </div>
            {item.progressValue !== undefined ? (
              <div className="mt-2">
                <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--nimi-border-subtle)]">
                  <div
                    className="h-full rounded-full bg-[color:var(--nimi-action-primary-bg)] transition-[width]"
                    style={{ width: `${Math.max(0, Math.min(item.progressValue, 100))}%` }}
                  />
                </div>
                {item.progressLabel ? (
                  <p className="mt-1 text-[10px] text-[color:var(--nimi-text-muted)]">{item.progressLabel}</p>
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
}: GenerationStatusListProps) {
  if (items.length === 0) {
    return null;
  }

  return (
    <Surface tone="panel" className={className}>
      <GenerationStatusList items={items} renderStatusExtra={renderStatusExtra} />
    </Surface>
  );
}
