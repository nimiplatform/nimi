import { convertFileSrc } from '@tauri-apps/api/core';
import { S } from '../../app-shell/page-style.js';
import { OBSERVATION_DIMENSIONS } from '../../knowledge-base/index.js';
import type { JournalEntryRow } from '../../bridge/sqlite-bridge.js';
import {
  parseSelectedTags,
  groupEntriesByDate,
  formatDateLabel,
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
  onDeleteEntry?: (entry: JournalEntryRow) => void;
  onToggleKeepsake?: (entry: JournalEntryRow) => void;
}

type EntryFilter = JournalEntryTimelineProps['entryFilter'];

const FILTER_OPTIONS: Array<{ key: EntryFilter; label: string }> = [
  { key: 'all', label: '全部' },
  { key: 'keepsake', label: '收藏' },
];

export function JournalEntryTimeline({
  entries,
  entryFilter,
  onFilterChange,
  recorderProfiles,
  onEditEntry,
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
        <h2 className="text-[14px] font-semibold" style={{ color: S.text }}>随手记列表</h2>
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
          <p className="text-[13px]" style={{ color: S.sub }}>还没有随手记，先写下一条吧</p>
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
                  const recorderName = recorderProfiles?.find((item) => item.id === entry.recorderId)?.name ?? null;
                  const bodyText = entry.textContent?.trim() || (entry.voicePath ? '🎙️ 语音记录' : '');
                  const isKeepsake = entry.keepsake === 1;

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
                                style={{ background: '#e8eccc', color: S.accent }}
                              >
                                成长方向 · {dimension.displayName}
                              </span>
                            ) : null}
                          </div>

                          <div className="flex items-center gap-1.5">
                            {recorderName ? (
                              <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: '#f5f3ef', color: S.sub }}>
                                {recorderName}
                              </span>
                            ) : null}
                            <button
                              onClick={(event) => {
                                event.stopPropagation();
                                onToggleKeepsake?.(entry);
                              }}
                              className={`rounded px-1.5 py-0.5 text-[10px] transition-all ${isKeepsake ? '' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'}`}
                              style={isKeepsake ? { background: '#fef9c3', color: '#a16207' } : { color: S.sub }}
                              aria-label={isKeepsake ? '取消收藏记录' : '收藏记录'}
                              title={isKeepsake ? '取消收藏' : '标记收藏'}
                            >
                              {isKeepsake ? '★ 留念' : '☆ 收藏'}
                            </button>
                            {entry.voicePath ? (
                              <span className="rounded px-1.5 py-0.5 text-[10px]" style={{ background: '#e0f2fe', color: '#0284c7' }}>
                                {entry.contentType === 'mixed' ? '🎙️ 文字' : '🎙️ 语音'}
                              </span>
                            ) : null}
                            <button
                              onClick={() => onEditEntry(entry)}
                              className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-[#f0f0ec]"
                              style={{ color: '#b0b5bc' }}
                              aria-label="编辑记录"
                              title="编辑记录"
                            >
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                              </svg>
                            </button>
                            {onDeleteEntry ? (
                              <button
                                onClick={() => onDeleteEntry(entry)}
                                className="flex h-6 w-6 items-center justify-center rounded-lg transition-colors hover:bg-[#fef2f2]"
                                style={{ color: '#d16c6c' }}
                                aria-label="删除记录"
                                title="删除记录"
                              >
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                  <path d="M3 6h18" />
                                  <path d="M8 6V4h8v2" />
                                  <path d="M19 6l-1 14H6L5 6" />
                                  <path d="M10 11v6" />
                                  <path d="M14 11v6" />
                                </svg>
                              </button>
                            ) : null}
                          </div>
                        </div>

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

                        {tags.length > 0 ? (
                          <div className="mt-3 flex flex-wrap gap-1.5 border-t pt-2.5" style={{ borderColor: S.border }}>
                            <span className="mr-1 text-[10px] font-medium" style={{ color: S.sub }}>
                              成长关键词
                            </span>
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
