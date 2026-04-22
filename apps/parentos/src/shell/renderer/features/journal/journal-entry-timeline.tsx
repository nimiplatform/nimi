import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { convertFileSrc } from '@tauri-apps/api/core';
import { S } from '../../app-shell/page-style.js';
import { OBSERVATION_DIMENSIONS } from '../../knowledge-base/index.js';
import type { JournalEntryRow } from '../../bridge/sqlite-bridge.js';
import {
  parseSelectedTags,
  groupEntriesByDate,
  formatDateLabel,
  getKeepsakeReasonLabel,
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
        className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-[#f0f0ec]"
        style={{ color: '#b0b5bc' }}
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
          className="fixed z-50 overflow-hidden rounded-lg py-1 shadow-lg"
          style={{
            top: pos.top,
            left: pos.left,
            width: MENU_WIDTH,
            background: S.card,
            border: `1px solid ${S.border}`,
          }}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setOpen(false); onEdit(); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] transition-colors hover:bg-[#f5f3ef]"
            style={{ color: S.text }}
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
              className="flex w-full items-center gap-2 px-3 py-1.5 text-[11px] transition-colors hover:bg-[#fef2f2]"
              style={{ color: '#dc2626' }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M3 6h18" /><path d="M8 6V4h8v2" />
                <path d="M19 6l-1 14H6L5 6" />
                <path d="M10 11v6" /><path d="M14 11v6" />
              </svg>
              删除
            </button>
          ) : null}
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
  const filteredEntries = entryFilter === 'keepsake'
    ? entries.filter((entry) => entry.keepsake === 1)
    : entries;

  const entryGroups = groupEntriesByDate(filteredEntries);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-[14px] font-semibold" style={{ color: S.text }}>随记列表</h2>
        <div className="flex flex-wrap gap-1">
          {FILTER_OPTIONS.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => onFilterChange(key)}
              className="rounded-full px-2 py-0.5 text-[10px] transition-colors"
              style={entryFilter === key
                ? { background: S.accent, color: '#fff' }
                : { background: '#f0f0ec', color: S.sub }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
          <p className="text-[13px]" style={{ color: S.sub }}>还没有随记，先写下一条吧</p>
        </div>
      ) : filteredEntries.length === 0 ? (
        <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
          <p className="text-[13px]" style={{ color: S.text }}>还没有珍藏的成长瞬间</p>
          <p className="mt-2 text-[11px] leading-relaxed" style={{ color: S.sub }}>
            遇到第一次、获奖、读完一本书或特别想留住的片刻时，可以把随记标记为珍藏。
          </p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute bottom-0 left-[18px] top-0 w-[2px]" style={{ background: S.border }} />

          {entryGroups.map(([date, dayEntries]) => (
            <div key={date} className="relative pb-5 pl-10">
              <div
                className="absolute left-[11px] top-1 flex h-[16px] w-[16px] items-center justify-center rounded-full border-[2px]"
                style={{ background: S.card, borderColor: S.accent }}
              >
                <div className="h-[6px] w-[6px] rounded-full" style={{ background: S.accent }} />
              </div>

              <div className="mb-2 flex items-center gap-2">
                <span className="text-[12px] font-bold" style={{ color: S.text }}>{formatDateLabel(date)}</span>
                <span className="text-[10px]" style={{ color: S.sub }}>{dayEntries.length} 条</span>
              </div>

              <div className="space-y-2.5">
                {dayEntries.map((entry) => {
                  const dimension = OBSERVATION_DIMENSIONS.find((item) => item.dimensionId === entry.dimensionId);
                  const tags = parseSelectedTags(entry.selectedTags);
                  const entryPhotos = parseSelectedTags(entry.photoPaths);
                  const bodyText = entry.textContent?.trim() || (entry.voicePath ? '语音记录已保存' : '');
                  const isKeepsake = entry.keepsake === 1;
                  const keepsakeReasonLabel = getKeepsakeReasonLabel(entry.keepsakeReason);

                  return (
                    <div
                      key={entry.entryId}
                      className={`group overflow-hidden ${S.radius} transition-all`}
                      style={{ boxShadow: S.shadow, background: S.card }}
                    >
                      <div
                        className="h-[3px]"
                        style={{
                          background: isKeepsake ? '#fbbf24' : S.accent,
                        }}
                      />

                      <div className="p-4">
                        <div className="mb-2.5 flex items-center justify-between gap-3">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-[11px] font-medium" style={{ color: S.text }}>
                              {entry.recordedAt.split('T')[1]?.slice(0, 5)}
                            </span>
                            {dimension ? (
                              <span
                                className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                                style={{ background: '#f3f4f6', color: '#6b7280' }}
                              >
                                {dimension.displayName}
                              </span>
                            ) : null}
                          </div>

                          <div className="flex items-center gap-1">
                            {entry.voicePath ? (
                              <span className="mr-1 rounded px-1.5 py-0.5 text-[10px]" style={{ background: '#e0f2fe', color: '#0284c7' }}>
                                {entry.contentType === 'mixed' ? '语音 + 文字' : '语音'}
                              </span>
                            ) : null}

                            {onAskAiAboutEntry ? (
                              <button
                                type="button"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  onAskAiAboutEntry(entry);
                                }}
                                className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-[#e0ecff]"
                                style={{ color: '#6b7280' }}
                                aria-label="和 AI 聊这条记录"
                                title="和 AI 聊这条记录"
                              >
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z" />
                                  <path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" />
                                </svg>
                              </button>
                            ) : null}
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                onToggleKeepsake?.(entry);
                              }}
                              className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-[#fef9c3]"
                              aria-label={isKeepsake ? '取消珍藏' : '标记珍藏'}
                              title={isKeepsake ? '取消珍藏' : '标记珍藏'}
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24"
                                fill={isKeepsake ? '#f59e0b' : 'none'}
                                stroke={isKeepsake ? '#f59e0b' : '#b0b5bc'}
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
                          <p className="mb-2 text-[14px] font-semibold leading-[1.5]" style={{ color: S.text }}>
                            {entry.keepsakeTitle}
                          </p>
                        ) : null}

                        {bodyText ? (
                          <p className="text-[13px] leading-[1.7]" style={{ color: S.text }}>{bodyText}</p>
                        ) : null}

                        {entryPhotos.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-2">
                            {entryPhotos.map((photoPath, index) => (
                              <img
                                key={`${photoPath}-${index}`}
                                src={convertFileSrc(photoPath)}
                                alt=""
                                className={`h-20 w-20 object-cover ${S.radiusSm}`}
                                style={{ border: `1px solid ${S.border}` }}
                              />
                            ))}
                          </div>
                        ) : null}

                        {(keepsakeReasonLabel || tags.length > 0) ? (
                          <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-2.5" style={{ borderColor: S.border }}>
                            {keepsakeReasonLabel ? (
                              <span
                                className="rounded-full px-2.5 py-1 text-[10px] font-medium"
                                style={{ background: '#fef3c7', color: '#a16207' }}
                              >
                                珍藏原因 · {keepsakeReasonLabel}
                              </span>
                            ) : null}
                            {tags.map((tag) => (
                              <span
                                key={tag}
                                className="rounded-full px-2.5 py-1 text-[10px] font-medium"
                                style={{ background: '#f5f3ef', color: S.sub }}
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
