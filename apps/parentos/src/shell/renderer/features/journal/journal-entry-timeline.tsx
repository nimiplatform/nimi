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
}

/* ── Constants ── */

const FILTER_OPTIONS = [['all', '全部'], ['quick', '⚡️'], ['deep', '🔍'], ['review', '🌙'], ['keepsake', '⭐']] as const;

/* ── Component ── */

export function JournalEntryTimeline({
  entries,
  entryFilter,
  onFilterChange,
  recorderProfiles,
  onEditEntry,
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

              <div className="space-y-1.5">
                {dayEntries.map((entry) => {
                  const dimension = OBSERVATION_DIMENSIONS.find((item) => item.dimensionId === entry.dimensionId);
                  const tags = parseSelectedTags(entry.selectedTags);
                  const recorderName = recorderProfiles?.find((item) => item.id === entry.recorderId)?.name ?? null;
                  const bodyText = entry.textContent?.trim() || (entry.voicePath ? '🎙️ 语音记录' : '');
                  const entryPhotos = parseSelectedTags(entry.photoPaths); // reuse JSON array parser
                  const scene = getSceneForMode(entry.observationMode);
                  const sceneConfig = SCENE_TABS.find((t) => t.key === scene);

                  return (
                    <div key={entry.entryId}
                      className={`${S.radiusSm} p-3 transition-all`}
                      style={{
                        background: entry.keepsake ? '#fefce8' : S.card,
                        border: `1px solid ${entry.keepsake ? '#fde68a' : S.border}`,
                      }}>
                      {/* Meta row */}
                      <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                        <span className="text-[10px]" style={{ color: S.sub }}>
                          {entry.recordedAt.split('T')[1]?.slice(0, 5)}
                        </span>
                        <button onClick={() => onEditEntry(entry)}
                          className="text-[10px] px-1 py-0.5 rounded transition-colors hover:bg-[#f0f0ec]"
                          style={{ color: S.sub }} title="编辑">
                          ✏️
                        </button>
                        {sceneConfig && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#f0f0ec', color: S.sub }}>
                            {sceneConfig.emoji} {sceneConfig.label}
                          </span>
                        )}
                        {dimension && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#e8eccc', color: S.accent }}>
                            {dimension.displayName}
                          </span>
                        )}
                        {entry.voicePath && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#e0f2fe', color: '#0284c7' }}>
                            {entry.contentType === 'mixed' ? '🎙️+文字' : '🎙️'}
                          </span>
                        )}
                        {entryPhotos.length > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: '#fef3c7', color: '#92400e' }}>
                            📷 {entryPhotos.length}
                          </span>
                        )}
                        {recorderName && (
                          <span className="text-[10px]" style={{ color: S.sub }}>{recorderName}</span>
                        )}
                        {entry.keepsake === 1 && <span className="text-[10px]">⭐</span>}
                      </div>

                      {/* Body */}
                      {bodyText && (
                        <p className="text-[12px] leading-relaxed" style={{ color: S.text }}>{bodyText}</p>
                      )}

                      {/* Photos */}
                      {entryPhotos.length > 0 && (
                        <div className="mt-1.5 flex gap-1.5 flex-wrap">
                          {entryPhotos.map((photoPath, pi) => (
                            <img key={pi} src={`asset://localhost/${photoPath}`} alt=""
                              className={`h-16 w-16 ${S.radiusSm} object-cover`} />
                          ))}
                        </div>
                      )}

                      {/* Tags */}
                      {tags.length > 0 && (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {tags.map((tag) => (
                            <span key={tag} className="rounded-full px-1.5 py-0.5 text-[10px]"
                              style={{ background: '#f0f0ec', color: S.sub }}>
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
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
