import React from 'react';
import { useTranslation } from 'react-i18next';
import type { VideoGenerationRecord } from '../tester-types.js';
import { RawJsonSection } from '../tester-diagnostics.js';
import { EMPTY_VIDEO_ICON, TRASH_ICON, X_ICON, formatRelativeTime, modeShortLabel } from './panel-video-generate-shared.js';
import { VideoPlayer } from './panel-video-generate-controls.js';

function PlaceholderCard({ children, dashed = true }: { children?: React.ReactNode; dashed?: boolean }) {
  return (
    <div
      className={`flex aspect-square flex-col items-center justify-center rounded-[var(--nimi-radius-md)] bg-[var(--nimi-surface-canvas)]/50 p-4 text-center ${
        dashed ? 'border border-dashed border-[var(--nimi-border-subtle)]' : ''
      }`}
    >
      {children ?? <span className="text-xl text-[var(--nimi-text-muted)]">—</span>}
    </div>
  );
}

function RunCard({ record, onSelect, onDelete }: {
  record: VideoGenerationRecord;
  onSelect: (record: VideoGenerationRecord) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const failed = record.result === 'failed';
  return (
    <div className="group relative aspect-square overflow-hidden rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-black">
      <button
        type="button"
        onClick={() => onSelect(record)}
        className="block h-full w-full"
        aria-label={record.prompt || 'Run output'}
      >
        {record.videoUri ? (
          <video
            src={record.videoUri}
            muted
            loop
            playsInline
            preload="metadata"
            className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
            onMouseEnter={(event) => { void event.currentTarget.play().catch(() => {}); }}
            onMouseLeave={(event) => { event.currentTarget.pause(); event.currentTarget.currentTime = 0; }}
          />
        ) : (
          <div className={`flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-xs ${failed ? 'text-[var(--nimi-accent-danger)]' : 'text-[var(--nimi-text-muted)]'}`}>
            <span className="text-2xl">{failed ? '!' : '?'}</span>
            <span className="line-clamp-2 text-center">{failed ? (record.error || 'Failed') : 'No video'}</span>
          </div>
        )}
      </button>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-2 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
        <div className="min-w-0 text-[11px] leading-tight text-white">
          <div className="truncate font-medium">{record.prompt || '(empty prompt)'}</div>
          <div className="truncate opacity-70">
            {record.ratio} · {record.durationSec}s · {formatRelativeTime(record.timestamp)}
          </div>
        </div>
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); onDelete(record.id); }}
          aria-label={t('Tester.videoGenerate.deleteHistoryItem', { defaultValue: 'Delete' })}
          className="pointer-events-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-colors hover:bg-[var(--nimi-accent-danger)] hover:text-white"
        >
          {TRASH_ICON}
        </button>
      </div>
      <span className="absolute left-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
        {modeShortLabel(record.mode, t)}
      </span>
    </div>
  );
}

function ListRow({ record, onSelect, onDelete }: {
  record: VideoGenerationRecord;
  onSelect: (record: VideoGenerationRecord) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslation();
  const failed = record.result === 'failed';
  return (
    <div className="flex items-center gap-3 rounded-[var(--nimi-radius-md)] border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] p-2">
      <button
        type="button"
        onClick={() => onSelect(record)}
        className="flex min-w-0 flex-1 items-center gap-3 text-left"
      >
        {record.videoUri ? (
          <video
            src={record.videoUri}
            muted
            playsInline
            preload="metadata"
            className="h-12 w-12 shrink-0 rounded-md bg-black object-cover"
          />
        ) : (
          <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-[var(--nimi-surface-raised)] ${failed ? 'text-[var(--nimi-accent-danger)]' : 'text-[var(--nimi-text-muted)]'}`}>
            {failed ? '!' : '?'}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm text-[var(--nimi-text-primary)]">{record.prompt || '(empty prompt)'}</div>
          <div className="truncate text-xs text-[var(--nimi-text-muted)]">
            {modeShortLabel(record.mode, t)} · {record.ratio} · {record.durationSec}s · {record.elapsed ? `${(record.elapsed / 1000).toFixed(1)}s` : '—'} · {formatRelativeTime(record.timestamp)}{failed ? ' · failed' : ''}
          </div>
        </div>
      </button>
      <button
        type="button"
        onClick={() => onDelete(record.id)}
        aria-label={t('Tester.videoGenerate.deleteHistoryItem', { defaultValue: 'Delete' })}
        className="shrink-0 rounded p-1.5 text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-raised)] hover:text-[var(--nimi-accent-danger)]"
      >
        {TRASH_ICON}
      </button>
    </div>
  );
}

function RecordDetailDrawer({ record, onClose }: { record: VideoGenerationRecord; onClose: () => void }) {
  const { t } = useTranslation();
  React.useEffect(() => {
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);
  const failed = record.result === 'failed';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div
        className="relative max-h-[90vh] w-full max-w-[900px] overflow-hidden rounded-[var(--nimi-radius-lg)] bg-[var(--nimi-surface-card)] shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('Tester.videoGenerate.closePreview', { defaultValue: 'Close preview' })}
          className="absolute right-3 top-3 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition-colors hover:bg-black/60"
        >
          {X_ICON}
        </button>
        <div className="flex max-h-[90vh] flex-col">
          <div className="flex-1 overflow-auto p-4">
            {record.videoUri ? (
              <div className="overflow-hidden rounded-[var(--nimi-radius-md)] bg-black">
                <VideoPlayer src={record.videoUri} />
              </div>
            ) : (
              <div className={`rounded p-3 text-sm ${failed ? 'bg-[var(--nimi-accent-danger)]/10 text-[var(--nimi-accent-danger)]' : 'bg-[var(--nimi-surface-canvas)] text-[var(--nimi-text-muted)]'}`}>
                {failed ? (record.error || 'Failed') : 'No video artifacts.'}
              </div>
            )}
          </div>
          <div className="border-t border-[var(--nimi-border-subtle)] p-4">
            <div className="text-xs font-semibold text-[var(--nimi-text-secondary)]">
              {t('Tester.videoGenerate.promptLabel', { defaultValue: 'Prompt' })}
            </div>
            <div className="mt-1 whitespace-pre-wrap text-sm text-[var(--nimi-text-primary)]">{record.prompt || '(empty prompt)'}</div>
            {record.negativePrompt ? (
              <>
                <div className="mt-3 text-xs font-semibold text-[var(--nimi-text-secondary)]">
                  {t('Tester.videoGenerate.negativePromptLabel', { defaultValue: 'Negative' })}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm text-[var(--nimi-text-primary)]">{record.negativePrompt}</div>
              </>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--nimi-text-muted)]">
              <span>{modeShortLabel(record.mode, t)}</span>
              <span>{record.ratio}</span>
              <span>{record.durationSec}s</span>
              <span>{record.elapsed ? `${(record.elapsed / 1000).toFixed(1)}s` : '—'}</span>
              <span>{formatRelativeTime(record.timestamp)}</span>
            </div>
            {record.rawResponse ? (
              <div className="mt-3">
                <RawJsonSection content={record.rawResponse} />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function HistoryGallery(props: {
  records: VideoGenerationRecord[];
  busy: boolean;
  busyLabel: string;
  onDelete: (id: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const { records, busy, busyLabel, onDelete, onClear } = props;
  const [view, setView] = React.useState<'grid' | 'list'>('grid');
  const [selected, setSelected] = React.useState<VideoGenerationRecord | null>(null);

  const historyText = records.length === 0
    ? (busy
      ? t('Tester.videoGenerate.historyRunning', { defaultValue: 'Generating your first run…' })
      : t('Tester.videoGenerate.historyNothing', { defaultValue: 'Nothing yet — your runs will appear here' }))
    : t('Tester.videoGenerate.historyCount', { defaultValue: '{{count}} runs', count: records.length });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-[var(--nimi-text-primary)]">
            {t('Tester.videoGenerate.outputGallery', { defaultValue: 'Output gallery' })}
          </h3>
          <span className="rounded-full bg-[var(--nimi-surface-canvas)] px-2 py-0.5 text-[10px] text-[var(--nimi-text-muted)]">
            {records.length}
          </span>
          <span className="text-[11px] text-[var(--nimi-text-muted)]">{historyText}</span>
        </div>
        <div className="flex items-center gap-2">
          {records.length > 0 ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded px-2 py-0.5 text-[11px] text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-surface-raised)] hover:text-[var(--nimi-text-secondary)]"
            >
              {t('Tester.videoGenerate.clearHistory', { defaultValue: 'Clear All' })}
            </button>
          ) : null}
          <div className="inline-flex rounded-full border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] p-0.5 text-xs">
            {(['grid', 'list'] as const).map((m) => {
              const active = view === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => setView(m)}
                  className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                    active
                      ? 'bg-[var(--nimi-surface-raised)] text-[var(--nimi-text-primary)] shadow-sm'
                      : 'text-[var(--nimi-text-muted)] hover:text-[var(--nimi-text-secondary)]'
                  }`}
                >
                  {m === 'grid'
                    ? t('Tester.videoGenerate.viewGrid', { defaultValue: 'Grid' })
                    : t('Tester.videoGenerate.viewList', { defaultValue: 'List' })}
                </button>
              );
            })}
          </div>
        </div>
      </div>
      {view === 'grid' ? (
        <div className="grid grid-cols-4 gap-2.5">
          {records.map((record) => (
            <RunCard key={record.id} record={record} onSelect={setSelected} onDelete={onDelete} />
          ))}
          {records.length === 0 && !busy ? (
            <>
              <PlaceholderCard>
                <div className="text-[var(--nimi-text-muted)]">{EMPTY_VIDEO_ICON}</div>
                <h4 className="mt-2 text-sm font-medium text-[var(--nimi-text-primary)]">
                  {t('Tester.videoGenerate.emptyHeading', { defaultValue: 'No video runs yet' })}
                </h4>
                <p className="mt-1 text-xs text-[var(--nimi-text-muted)]">
                  {t('Tester.videoGenerate.emptyBodyShort', { defaultValue: 'Run the capability above' })}
                </p>
              </PlaceholderCard>
              <PlaceholderCard />
              <PlaceholderCard />
              <PlaceholderCard />
            </>
          ) : null}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {records.length === 0 && !busy ? (
            <div className="rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)]/50 py-10 text-center text-sm text-[var(--nimi-text-muted)]">
              {t('Tester.videoGenerate.emptyHeading', { defaultValue: 'No video runs yet' })}
            </div>
          ) : null}
          {records.map((record) => (
            <ListRow key={record.id} record={record} onSelect={setSelected} onDelete={onDelete} />
          ))}
        </div>
      )}
      {busy && view === 'list' ? (
        <div className="rounded-[var(--nimi-radius-md)] border border-dashed border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-canvas)] px-3 py-2 text-xs text-[var(--nimi-text-muted)]">
          {busyLabel || t('Tester.videoGenerate.generating', { defaultValue: 'Generating…' })}
        </div>
      ) : null}
      {selected ? <RecordDetailDrawer record={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
