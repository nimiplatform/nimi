import { convertFileSrc } from '@tauri-apps/api/core';
import { S } from '../../app-shell/page-style.js';
import { OBSERVATION_DIMENSIONS } from '../../knowledge-base/index.js';
import type { JournalEntryRow } from '../../bridge/sqlite-bridge.js';
import {
  type SceneTab,
  SCENE_TABS,
  parseSelectedTags,
  groupEntriesByDate,
  formatDateLabel,
  getSceneForMode,
} from './journal-page-helpers.js';

/* ── Types ── */

export interface RecorderProfile {
  id: string;
  name: string;
}

export interface JournalEntryTimelineProps {
  entries: JournalEntryRow[];
  entryFilter: 'all' | 'quick' | 'deep' | 'review' | 'keepsake';
  onFilterChange: (filter: 'all' | 'quick' | 'deep' | 'review' | 'keepsake') => void;
  recorderProfiles: RecorderProfile[] | null | undefined;
  onEditEntry: (entry: JournalEntryRow) => void;
  onToggleKeepsake?: (entry: JournalEntryRow) => void;
}

/* ── Constants ── */

const FILTER_OPTIONS = [['all', '全部'], ['keepsake', '⭐ 珍藏']] as const;

/* ── Component ── */

export function JournalEntryTimeline({
  entries,
  entryFilter,
  onFilterChange,
  recorderProfiles,
  onEditEntry,
  onToggleKeepsake,
}: JournalEntryTimelineProps) {
  const filteredEntries = entryFilter === 'all'
    ? entries
    : entryFilter === 'keepsake'
      ? entries.filter((e) => e.keepsake === 1)
      : entries.filter((e) => getSceneForMode(e.observationMode) === entryFilter);

  const entryGroups = groupEntriesByDate(filteredEntries);

  return (
    <section>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[14px] font-semibold" style={{ color: S.text }}>观察记录</h2>
        <div className="flex gap-1">
          {FILTER_OPTIONS.map(([key, label]) => (
            <button key={key} onClick={() => onFilterChange(key)}
              className="px-2 py-0.5 rounded-full text-[10px] transition-colors"
              style={entryFilter === key
                ? { background: S.accent, color: '#fff' }
                : { background: '#f0f0ec', color: S.sub }}>
              {label}
            </button>
          ))}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className={`${S.radius} p-8 text-center`} style={{ background: S.card, boxShadow: S.shadow }}>
          <p className="text-[13px]" style={{ color: S.sub }}>还没有观察记录，选一个场景开始吧</p>
        </div>
      ) : (
        <div className="relative">
          <div className="absolute left-[18px] top-0 bottom-0 w-[2px]" style={{ background: S.border }} />

          {entryGroups.map(([date, dayEntries]) => (
            <div key={date} className="relative pl-10 pb-5">
              {/* Date dot */}
              <div className="absolute left-[11px] top-1 w-[16px] h-[16px] rounded-full border-[2px] flex items-center justify-center"
                style={{ background: S.card, borderColor: S.accent }}>
                <div className="w-[6px] h-[6px] rounded-full" style={{ background: S.accent }} />
              </div>

              <div className="flex items-center gap-2 mb-2">
                <span className="text-[12px] font-bold" style={{ color: S.text }}>{formatDateLabel(date)}</span>
                <span className="text-[10px]" style={{ color: S.sub }}>{dayEntries.length} 条</span>
              </div>

              <div className="space-y-2.5">
                {dayEntries.map((entry) => {
                  const dimension = OBSERVATION_DIMENSIONS.find((item) => item.dimensionId === entry.dimensionId);
                  const tags = parseSelectedTags(entry.selectedTags);
                  const recorderName = recorderProfiles?.find((item) => item.id === entry.recorderId)?.name ?? null;
                  const bodyText = entry.textContent?.trim() || (entry.voicePath ? '🎙️ 语音记录' : '');
                  const entryPhotos = parseSelectedTags(entry.photoPaths);
                  const scene = getSceneForMode(entry.observationMode);
                  const sceneConfig = SCENE_TABS.find((t) => t.key === scene);
                  const isKeepsake = entry.keepsake === 1;

                  return (
                    <div key={entry.entryId}
                      className={`group ${S.radius} overflow-hidden transition-all`}
                      style={{ boxShadow: S.shadow, background: S.card }}>

                      {/* Top accent bar */}
                      <div className="h-[3px]" style={{ background: isKeepsake ? '#fbbf24' : sceneConfig?.key === 'quick' ? S.accent : sceneConfig?.key === 'deep' ? '#3b82f6' : '#8b5cf6' }} />

                      <div className="p-4">
                        {/* Header: time + scene + dimension + edit */}
                        <div className="flex items-center justify-between mb-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-[11px] font-medium" style={{ color: S.text }}>
                              {entry.recordedAt.split('T')[1]?.slice(0, 5)}
                            </span>
                            {sceneConfig && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium"
                                style={{ background: sceneConfig.key === 'quick' ? '#f4f7ea' : sceneConfig.key === 'deep' ? '#eff6ff' : '#f5f3ff',
                                  color: sceneConfig.key === 'quick' ? S.accent : sceneConfig.key === 'deep' ? '#3b82f6' : '#7c3aed' }}>
                                {sceneConfig.emoji} {sceneConfig.label}
                              </span>
                            )}
                            {dimension && (
                              <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ background: '#e8eccc', color: S.accent }}>
                                {dimension.displayName}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            {entry.moodTag && (
                              <span className="text-[12px]" title={entry.moodTag}>
                                {entry.moodTag === 'happy' ? '😊' : entry.moodTag === 'neutral' ? '😐' : entry.moodTag === 'sad' ? '😢' : entry.moodTag === 'angry' ? '😤' : '😴'}
                              </span>
                            )}
                            {recorderName && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#f5f3ef', color: S.sub }}>{recorderName}</span>
                            )}
                            <button
                              onClick={(e) => { e.stopPropagation(); onToggleKeepsake?.(entry); }}
                              className={`text-[10px] px-1.5 py-0.5 rounded transition-all ${isKeepsake ? '' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'}`}
                              style={isKeepsake ? { background: '#fef9c3', color: '#a16207' } : { color: S.sub }}
                              title={isKeepsake ? '取消珍藏' : '标记珍藏'}>
                              {isKeepsake ? '⭐ 留念' : '☆ 珍藏'}
                            </button>
                            {entry.voicePath && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: '#e0f2fe', color: '#0284c7' }}>
                                {entry.contentType === 'mixed' ? '🎙️+文字' : '🎙️ 语音'}
                              </span>
                            )}
                            <button onClick={() => onEditEntry(entry)}
                              className="w-6 h-6 rounded-lg flex items-center justify-center transition-colors hover:bg-[#f0f0ec]"
                              style={{ color: '#b0b5bc' }} title="编辑">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Body text */}
                        {bodyText && (
                          <p className="text-[13px] leading-[1.7]" style={{ color: S.text }}>{bodyText}</p>
                        )}

                        {/* Photos */}
                        {entryPhotos.length > 0 && (
                          <div className="mt-3 flex gap-2 flex-wrap">
                            {entryPhotos.map((photoPath, pi) => (
                              <img key={pi} src={convertFileSrc(photoPath)} alt=""
                                className={`h-20 w-20 ${S.radiusSm} object-cover`}
                                style={{ border: `1px solid ${S.border}` }} />
                            ))}
                          </div>
                        )}

                        {/* Tags */}
                        {tags.length > 0 && (
                          <div className="mt-3 pt-2.5 flex flex-wrap gap-1.5" style={{ borderTop: `1px solid ${S.border}` }}>
                            {tags.map((tag) => (
                              <span key={tag} className="rounded-full px-2.5 py-1 text-[10px] font-medium"
                                style={{ background: '#f5f3ef', color: S.sub }}>
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
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
