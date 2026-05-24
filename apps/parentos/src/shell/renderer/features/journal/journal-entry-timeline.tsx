import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { IconButton, StatusBadge, Surface, cn } from '@nimiplatform/kit/ui';
import { OBSERVATION_DIMENSIONS } from '../../knowledge-base/index.js';
import type { JournalEntryRow } from '../../bridge/sqlite-bridge.js';
import { DentalPhotoLightbox, type DentalPhotoLightboxItem } from '../profile/dental-photo-lightbox.js';
import {
  parseSelectedTags,
  groupEntriesByDate,
  formatDateLabel,
  getKeepsakeReasonLabel,
  getLocalTimeLabel,
} from './journal-page-helpers.js';

export interface RecorderProfile {
  id: string;
  name: string;
}

export interface JournalEntryTimelineProps {
  entries: JournalEntryRow[];
  entryFilter: 'all' | 'keepsake';
  onFilterChange: (filter: 'all' | 'keepsake') => void;
  recorderProfiles: RecorderProfile[] | null | undefined;
  onEditEntry: (entry: JournalEntryRow) => void;
  onAskAiAboutEntry?: (entry: JournalEntryRow) => void;
  onDeleteEntry?: (entry: JournalEntryRow) => void;
  onToggleKeepsake?: (entry: JournalEntryRow) => void;
}

type EntryFilter = JournalEntryTimelineProps['entryFilter'];

const FILTER_OPTIONS: Array<{ key: EntryFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'keepsake', label: '珍藏' },
];

/* ── Dropdown menu for low-frequency actions (edit / delete) ── */

function EntryActionMenu({
  onEdit,
  onDelete,
}: {
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const MENU_WIDTH = 120;
  const MENU_GAP = 4;

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const left = Math.min(
      Math.max(4, rect.right - MENU_WIDTH),
      window.innerWidth - MENU_WIDTH - 4,
    );
    setPos({ top: rect.bottom + MENU_GAP, left });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (buttonRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      setOpen(false);
    };
    const scrollHandler = () => setOpen(false);
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', scrollHandler, true);
    window.addEventListener('resize', scrollHandler);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', scrollHandler, true);
      window.removeEventListener('resize', scrollHandler);
    };
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen((prev) => !prev); }}
        className="flex h-6 w-6 items-center justify-center parentos-radius-sm text-[var(--nimi-text-muted)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]"
        aria-label="更多操作"
        title="更多操作"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="1.5" />
          <circle cx="12" cy="12" r="1.5" />
          <circle cx="12" cy="19" r="1.5" />
        </svg>
      </button>
      {open && pos ? createPortal(
        <div
          ref={menuRef}
          className="parentos-portal-frame fixed z-50"
          style={{
            '--parentos-portal-left': `${pos.left}px`,
            '--parentos-portal-top': `${pos.top}px`,
            '--parentos-portal-width': `${MENU_WIDTH}px`,
          } as CSSProperties}
        >
          <Surface tone="overlay" elevation="floating" padding="none" className="overflow-hidden parentos-radius-sm py-1">
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-[var(--nimi-text-primary)] transition-colors hover:bg-[var(--nimi-action-ghost-hover)]"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
              </svg>
              编辑
            </button>
            {onDelete ? (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpen(false); onDelete(); }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-[13px] text-[var(--nimi-status-danger)] transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-danger)_10%,transparent)]"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18" /><path d="M8 6V4h8v2" />
                  <path d="M19 6l-1 14H6L5 6" />
                  <path d="M10 11v6" /><path d="M14 11v6" />
                </svg>
                删除
              </button>
            ) : null}
          </Surface>
        </div>,
        document.body,
      ) : null}
    </>
  );
}

export function JournalEntryTimeline({
  entries,
  entryFilter,
  onFilterChange,
  recorderProfiles: _recorderProfiles,
  onEditEntry,
  onAskAiAboutEntry,
  onDeleteEntry,
  onToggleKeepsake,
}: JournalEntryTimelineProps) {
  const [lightbox, setLightbox] = useState<{ photos: DentalPhotoLightboxItem[]; index: number } | null>(null);

  const filteredEntries = entryFilter === 'keepsake'
    ? entries.filter((entry) => entry.keepsake === 1)
    : entries;

  const entryGroups = groupEntriesByDate(filteredEntries);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[16px] font-semibold text-[var(--nimi-text-primary)]">成长足迹</h2>
        <div className="flex flex-wrap gap-1">
          {FILTER_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onFilterChange(key)}
              className={cn(
                'parentos-radius-full px-2 py-0.5 text-[12px] transition-colors',
                entryFilter === key
                  ? 'bg-[var(--nimi-action-primary-bg)] text-[var(--nimi-action-primary-text)]'
                  : 'bg-[var(--nimi-action-secondary-bg)] text-[var(--nimi-text-muted)] hover:bg-[var(--nimi-action-ghost-hover)]',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <Surface tone="card" elevation="raised" padding="lg" className="parentos-radius-xl p-8 text-center">
          <p className="text-[14px] text-[var(--nimi-text-muted)]">还没有随记，先写下一条吧</p>
        </Surface>
      ) : filteredEntries.length === 0 ? (
        <Surface tone="card" elevation="raised" padding="lg" className="parentos-radius-xl p-8 text-center">
          <p className="text-[14px] text-[var(--nimi-text-primary)]">还没有珍藏的成长瞬间</p>
          <p className="mt-2 text-[13px] leading-relaxed text-[var(--nimi-text-muted)]">
            遇到第一次、获奖、读完一本书或特别想留住的片刻时，可以把随记标记为珍藏。
          </p>
        </Surface>
      ) : (
        <div className="relative">
          <div className="absolute bottom-0 left-[18px] top-0 w-[2px] bg-[var(--nimi-border-subtle)]" />

          {entryGroups.map(([date, dayEntries]) => (
            <div key={date} className="relative pb-5 pl-10">
              <div
                className="absolute left-[11px] top-1 flex h-[16px] w-[16px] items-center justify-center rounded-full border-[2px] border-[var(--nimi-action-primary-bg)] bg-[var(--nimi-surface-card)]"
              >
                <div className="h-[6px] w-[6px] rounded-full bg-[var(--nimi-action-primary-bg)]" />
              </div>

              <div className="mb-2 flex items-center gap-2">
                <span className="text-[14px] font-bold text-[var(--nimi-text-primary)]">{formatDateLabel(date)}</span>
                <span className="text-[12px] text-[var(--nimi-text-muted)]">{dayEntries.length} 条</span>
              </div>

              <div className="space-y-2.5">
                {dayEntries.map((entry) => {
                  const dimension = OBSERVATION_DIMENSIONS.find((item) => item.dimensionId === entry.dimensionId);
                  const tags = parseSelectedTags(entry.selectedTags);
                  const entryPhotos = parseSelectedTags(entry.photoPaths);
                  const photoItems: DentalPhotoLightboxItem[] = entryPhotos.map((photoPath, index) => ({
                    attachmentId: `${entry.entryId}-${index}`,
                    filePath: photoPath,
                    fileName: photoPath.split(/[\\/]/).pop() ?? '',
                  }));
                  const bodyText = entry.textContent?.trim() || (entry.voicePath ? '语音记录已保存' : '');
                  const isKeepsake = entry.keepsake === 1;
                  const keepsakeReasonLabel = getKeepsakeReasonLabel(entry.keepsakeReason);

                  return (
                    <Surface
                      key={entry.entryId}
                      tone="card"
                      elevation="raised"
                      padding="none"
                      className="group overflow-hidden parentos-radius-xl transition-all"
                    >
                      {isKeepsake ? (
                        <div className="h-[3px] bg-[var(--nimi-status-warning)]" />
                      ) : null}

                      <div className="p-4">
                        <div className="mb-2.5 flex items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[13px] font-medium text-[var(--nimi-text-primary)]">
                              {getLocalTimeLabel(entry.recordedAt)}
                            </span>
                            {dimension ? (
                              <StatusBadge tone="success" className="gap-1 px-2 py-0.5 text-[12px] font-medium">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <circle cx="12" cy="12" r="3" />
                                  <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
                                </svg>
                                观察 · {dimension.displayName}
                              </StatusBadge>
                            ) : null}
                          </div>

                          <div className="flex items-center gap-1">
                            {entry.voicePath ? (
                              <StatusBadge tone="info" className="mr-1 parentos-radius-sm px-1.5 py-0.5 text-[12px]">
                                {entry.contentType === 'mixed' ? '语音 + 文字' : '语音'}
                              </StatusBadge>
                            ) : null}

                            {onAskAiAboutEntry ? (
                              <IconButton
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onAskAiAboutEntry(entry);
                                }}
                                tone="ghost"
                                size="sm"
                                className="h-6 min-h-0 w-6 parentos-radius-sm text-[var(--nimi-text-muted)] hover:bg-[color-mix(in_srgb,var(--nimi-status-info)_12%,transparent)] hover:text-[var(--nimi-status-info)]"
                                aria-label="和 AI 聊这条记录"
                                title="和 AI 聊这条记录"
                                icon={
                                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
                                    <path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" />
                                  </svg>
                                }
                              />
                            ) : null}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onToggleKeepsake?.(entry);
                              }}
                              className="flex h-6 w-6 items-center justify-center parentos-radius-sm transition-colors hover:bg-[color-mix(in_srgb,var(--nimi-status-warning)_18%,transparent)]"
                              aria-label={isKeepsake ? '取消珍藏' : '标记珍藏'}
                              title={isKeepsake ? '取消珍藏' : '标记珍藏'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24"
                                fill={isKeepsake ? 'var(--nimi-status-warning)' : 'none'}
                                stroke={isKeepsake ? 'var(--nimi-status-warning)' : 'var(--nimi-text-muted)'}
                                strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                              >
                                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                              </svg>
                            </button>
                            <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                              <EntryActionMenu
                                onEdit={() => onEditEntry(entry)}
                                onDelete={onDeleteEntry ? () => onDeleteEntry(entry) : undefined}
                              />
                            </div>
                          </div>
                        </div>

                        {isKeepsake && entry.keepsakeTitle ? (
                          <p className="mb-2 text-[16px] font-semibold leading-[1.5] text-[var(--nimi-text-primary)]">
                            {entry.keepsakeTitle}
                          </p>
                        ) : null}

                        {bodyText ? (
                          <p className="whitespace-pre-wrap text-[14px] leading-[1.7] text-[var(--nimi-text-primary)]">{bodyText}</p>
                        ) : null}

                        {photoItems.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {photoItems.map((item, index) => (
                              <button
                                key={item.attachmentId}
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setLightbox({ photos: photoItems, index });
                                }}
                                className="group/photo relative h-20 w-20 cursor-zoom-in overflow-hidden parentos-radius-sm border border-[var(--nimi-border-subtle)]"
                                aria-label="查看大图"
                              >
                                <img
                                  src={convertFileSrc(item.filePath)}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                                <span className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[var(--nimi-scrim-modal)] text-[var(--nimi-action-primary-text)] opacity-0 transition-opacity duration-150 group-hover/photo:opacity-100">
                                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="11" cy="11" r="7" />
                                    <path d="M21 21l-4.3-4.3" />
                                    <path d="M11 8v6M8 11h6" />
                                  </svg>
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : null}

                        {(keepsakeReasonLabel || tags.length > 0) ? (
                          <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--nimi-border-subtle)] pt-2.5">
                            {keepsakeReasonLabel ? (
                              <StatusBadge tone="warning" className="parentos-radius-full px-2.5 py-1 text-[12px] font-medium">
                                珍藏原因 · {keepsakeReasonLabel}
                              </StatusBadge>
                            ) : null}
                            {tags.map((tag) => (
                              <StatusBadge key={tag} tone="neutral" className="parentos-radius-full px-2.5 py-1 text-[12px] font-medium">
                                {tag}
                              </StatusBadge>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </Surface>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {lightbox ? (
        <DentalPhotoLightbox
          photos={lightbox.photos}
          index={lightbox.index}
          onChange={(next) => setLightbox((prev) => (prev ? { ...prev, index: next } : prev))}
          onClose={() => setLightbox(null)}
        />
      ) : null}
    </section>
  );
}
