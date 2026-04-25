import React from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@nimiplatform/nimi-kit/ui';
import type { ImageGenerationRecord } from '../tester-types.js';
import { RawJsonSection } from '../tester-diagnostics.js';
import { formatRelativeTime } from './panel-image-generate-model.js';

export function ImageHistoryPanel({ records, onDelete, onClear }: {
  records: ImageGenerationRecord[];
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [expandedId, setExpandedId] = React.useState<string | null>(null);
  if (records.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
          {t('Tester.imageGenerate.history', { defaultValue: 'History' })} ({records.length})
        </span>
        <Button tone="ghost" size="sm" onClick={onClear}>
          {t('Tester.imageGenerate.clearHistory', { defaultValue: 'Clear All' })}
        </Button>
      </div>
      {records.map((record) => {
        const expanded = expandedId === record.id;
        return (
          <div key={record.id} className="rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]">
            <div className="flex items-center gap-2 p-2 text-xs">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-2 text-left"
                onClick={() => setExpandedId(expanded ? null : record.id)}
              >
                {record.imageUris[0] ? (
                  <img src={record.imageUris[0]} alt="" className="h-10 w-10 shrink-0 rounded object-cover" />
                ) : (
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-[var(--nimi-surface-raised)] text-[var(--nimi-text-muted)]">
                    {record.result === 'failed' ? '!' : '?'}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[var(--nimi-text-primary)]">{record.prompt || '(empty prompt)'}</div>
                  <div className="text-[var(--nimi-text-muted)]">
                    {record.size} · {record.elapsed ? `${(record.elapsed / 1000).toFixed(1)}s` : '—'} · {formatRelativeTime(record.timestamp)}
                    {record.result === 'failed' ? ' · failed' : ''}
                  </div>
                </div>
              </button>
              <button
                type="button"
                className="shrink-0 rounded p-1 text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-raised)] hover:text-[var(--nimi-accent-danger)]"
                onClick={() => onDelete(record.id)}
                aria-label={t('Tester.imageGenerate.deleteHistoryItem', { defaultValue: 'Delete' })}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
              </button>
            </div>
            {expanded ? (
              <div className="flex flex-col gap-2 border-t border-[var(--nimi-border-subtle)] p-2">
                {record.imageUris.length > 0 ? <ImagePreviewGrid uris={record.imageUris} /> : null}
                {record.error ? <div className="rounded bg-[var(--nimi-accent-danger)]/10 p-2 text-xs text-[var(--nimi-accent-danger)]">{record.error}</div> : null}
                {record.rawResponse ? <RawJsonSection content={record.rawResponse} /> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ImagePreviewGrid({ uris }: { uris: string[] }) {
  const { t } = useTranslation();
  const [preview, setPreview] = React.useState<string | null>(null);
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        {uris.map((uri) => (
          <button key={uri} type="button" className="cursor-pointer overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] transition-opacity hover:opacity-80" onClick={() => setPreview(uri)}>
            <img alt="Generated image" src={uri} className="block w-full" />
          </button>
        ))}
      </div>
      {preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-8" onClick={() => setPreview(null)}>
          <button
            type="button"
            className="absolute top-4 right-4 flex h-8 w-8 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/40"
            onClick={() => setPreview(null)}
            aria-label={t('Tester.imageGenerate.closePreview', { defaultValue: 'Close preview' })}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
          <img alt="Preview" src={preview} className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />
        </div>
      ) : null}
    </>
  );
}
