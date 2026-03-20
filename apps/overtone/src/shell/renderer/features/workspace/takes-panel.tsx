import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { Waveform } from './waveform.js';
import { OtButton, OtProgressBar } from './ui-primitives.js';

interface TakesPanelProps {
  onPublish?: () => void;
}

export function TakesPanel({ onPublish }: TakesPanelProps) {
  const takes = useAppStore((state) => state.takes);
  const selectedTakeId = useAppStore((state) => state.selectedTakeId);
  const compareTakeIds = useAppStore((state) => state.compareTakeIds);
  const audioBuffers = useAppStore((state) => state.audioBuffers);
  const activeJobs = useAppStore((state) => state.activeJobs);
  const selectTake = useAppStore((state) => state.selectTake);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const renameTake = useAppStore((state) => state.renameTake);
  const discardTake = useAppStore((state) => state.discardTake);
  const setCompareTakeSlot = useAppStore((state) => state.setCompareTakeSlot);
  const clearCompareTakeIds = useAppStore((state) => state.clearCompareTakeIds);

  const [editingTakeId, setEditingTakeId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; takeId: string } | null>(null);
  const [newTakeIds, setNewTakeIds] = useState<Set<string>>(new Set());
  const [discardingTakeIds, setDiscardingTakeIds] = useState<Set<string>>(new Set());
  const [justFavoritedId, setJustFavoritedId] = useState<string | null>(null);
  const prevTakeCountRef = useRef(takes.length);

  // Track new takes for animation
  useEffect(() => {
    if (takes.length > prevTakeCountRef.current) {
      const latestTake = takes[takes.length - 1];
      if (latestTake) {
        setNewTakeIds((prev) => new Set(prev).add(latestTake.takeId));
        setTimeout(() => {
          setNewTakeIds((prev) => {
            const next = new Set(prev);
            next.delete(latestTake.takeId);
            return next;
          });
        }, 300);
      }
    }
    prevTakeCountRef.current = takes.length;
  }, [takes]);

  // Close context menu on click outside or Esc
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  const handleDiscard = useCallback((takeId: string) => {
    setDiscardingTakeIds((prev) => new Set(prev).add(takeId));
    setTimeout(() => {
      discardTake(takeId);
      setDiscardingTakeIds((prev) => {
        const next = new Set(prev);
        next.delete(takeId);
        return next;
      });
    }, 200);
  }, [discardTake]);

  const handleFavorite = useCallback((takeId: string) => {
    const take = takes.find((t) => t.takeId === takeId);
    if (take && !take.favorite) {
      setJustFavoritedId(takeId);
      setTimeout(() => setJustFavoritedId(null), 400);
    }
    toggleFavorite(takeId);
  }, [takes, toggleFavorite]);

  if (takes.length === 0 && activeJobs.size === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-base font-semibold text-ot-text-primary">Takes</h2>
        <div className="text-center py-12">
          <p className="text-ot-text-tertiary text-sm">No takes yet. Generate your first song.</p>
        </div>
      </div>
    );
  }

  const sortedTakes = [...takes].sort((left, right) => right.createdAt - left.createdAt);
  const compareLeft = compareTakeIds[0] ? takes.find((t) => t.takeId === compareTakeIds[0]) : null;
  const compareRight = compareTakeIds[1] ? takes.find((t) => t.takeId === compareTakeIds[1]) : null;
  const inCompareMode = Boolean(compareLeft && compareRight);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-ot-text-primary">
          Takes ({takes.length})
        </h2>
        {(compareTakeIds[0] || compareTakeIds[1]) && (
          <OtButton variant="tertiary" className="text-xs" onClick={clearCompareTakeIds} type="button">
            {inCompareMode ? 'Exit Compare' : 'Clear Compare'}
          </OtButton>
        )}
      </div>

      {/* A/B Compare View */}
      {inCompareMode && compareLeft && compareRight && (
        <div className="ot-compare-view rounded-lg overflow-hidden border border-ot-surface-5">
          <CompareSide
            take={compareLeft}
            label="A"
            active={selectedTakeId === compareLeft.takeId}
            buffer={audioBuffers.get(compareLeft.takeId) ?? null}
            onSelect={() => selectTake(compareLeft.takeId)}
          />
          <CompareSide
            take={compareRight}
            label="B"
            active={selectedTakeId === compareRight.takeId}
            buffer={audioBuffers.get(compareRight.takeId) ?? null}
            onSelect={() => selectTake(compareRight.takeId)}
          />
        </div>
      )}

      {/* Ghost Cards (active jobs) */}
      {activeJobs.size > 0 && (
        <div className="grid grid-cols-2 gap-4">
          {Array.from(activeJobs.values()).map((job) => (
            <GhostCard key={job.jobId} job={job} />
          ))}
        </div>
      )}

      {/* Take Card Grid */}
      <div className="grid grid-cols-2 gap-4">
        {sortedTakes.map((take) => {
          const isSelected = take.takeId === selectedTakeId;
          const isEditing = editingTakeId === take.takeId;
          const isNew = newTakeIds.has(take.takeId);
          const isDiscarding = discardingTakeIds.has(take.takeId);
          const buffer = audioBuffers.get(take.takeId);

          return (
            <div
              key={take.takeId}
              className={`ot-take-card${isSelected ? ' ot-take-card--selected' : ''}${isNew ? ' ot-take-card--new' : ''}${isDiscarding ? ' ot-take-card--discarding' : ''}`}
              onContextMenu={(e) => {
                e.preventDefault();
                setContextMenu({ x: e.clientX, y: e.clientY, takeId: take.takeId });
              }}
            >
              {/* Mini Waveform */}
              <div className="h-12 px-3 py-1 bg-ot-surface-1">
                {buffer ? (
                  <MiniWaveformWrapper buffer={buffer} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <div className="w-full h-[1px] bg-ot-surface-5" />
                  </div>
                )}
              </div>

              {/* Card Body */}
              <button
                className="w-full text-left p-4"
                onClick={() => selectTake(take.takeId)}
                type="button"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-base font-semibold text-ot-text-primary truncate">{take.title}</span>
                      <OriginBadge origin={take.origin} />
                    </div>
                    <p className="text-[11px] text-ot-text-tertiary line-clamp-2 mt-0.5">{take.promptSnapshot}</p>
                    {take.parentTakeId && (
                      <p className="text-[10px] text-ot-text-ghost mt-0.5">
                        ↳ from: {takes.find((item) => item.takeId === take.parentTakeId)?.title ?? take.parentTakeId}
                      </p>
                    )}
                    <p className="text-[11px] font-mono text-ot-text-ghost mt-1 tabular-nums">
                      {new Date(take.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <button
                    className={`ot-btn-icon shrink-0 ${justFavoritedId === take.takeId ? 'ot-star--just-favorited' : ''}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleFavorite(take.takeId);
                    }}
                    type="button"
                  >
                    <span className={take.favorite ? 'text-ot-warning' : 'text-ot-text-ghost'}>
                      {take.favorite ? '\u2605' : '\u2606'}
                    </span>
                  </button>
                </div>
              </button>

              {/* Action Bar */}
              <div className="border-t border-ot-surface-5 px-4 py-2 flex flex-wrap gap-3">
                <button className="ot-btn-tertiary text-[11px] py-0.5 px-1" onClick={() => selectTake(take.takeId)} type="button">
                  ▶ Play
                </button>
                <button className="ot-btn-tertiary text-[11px] py-0.5 px-1" onClick={() => setCompareTakeSlot(0, take.takeId)} type="button">
                  Compare A
                </button>
                <button className="ot-btn-tertiary text-[11px] py-0.5 px-1" onClick={() => setCompareTakeSlot(1, take.takeId)} type="button">
                  Compare B
                </button>
                {onPublish && isSelected && (
                  <button className="ot-btn-tertiary text-[11px] py-0.5 px-1 text-ot-violet-300" onClick={onPublish} type="button">
                    Publish...
                  </button>
                )}
                <button
                  className="ot-btn-tertiary text-[11px] py-0.5 px-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    setContextMenu({ x: rect.left, y: rect.bottom, takeId: take.takeId });
                  }}
                  type="button"
                >
                  ···
                </button>
              </div>

              {/* Inline Rename */}
              {isEditing && (
                <div className="border-t border-ot-surface-5 px-4 py-3 flex gap-2">
                  <input
                    className="ot-input flex-1 text-sm"
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        renameTake(take.takeId, draftTitle.trim() || take.title);
                        setEditingTakeId(null);
                      } else if (e.key === 'Escape') {
                        setEditingTakeId(null);
                      }
                    }}
                    autoFocus
                  />
                  <OtButton
                    variant="primary"
                    className="text-xs py-1.5 px-3"
                    onClick={() => {
                      renameTake(take.takeId, draftTitle.trim() || take.title);
                      setEditingTakeId(null);
                    }}
                    type="button"
                  >
                    Save
                  </OtButton>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Context Menu */}
      {contextMenu && (
        <TakeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          takeId={contextMenu.takeId}
          onPlay={() => selectTake(contextMenu.takeId)}
          onFavorite={() => handleFavorite(contextMenu.takeId)}
          onRename={() => {
            const take = takes.find((t) => t.takeId === contextMenu.takeId);
            if (take) {
              setEditingTakeId(take.takeId);
              setDraftTitle(take.title);
            }
          }}
          onCompareA={() => setCompareTakeSlot(0, contextMenu.takeId)}
          onCompareB={() => setCompareTakeSlot(1, contextMenu.takeId)}
          onPublish={onPublish ? () => { selectTake(contextMenu.takeId); onPublish(); } : undefined}
          onDiscard={() => handleDiscard(contextMenu.takeId)}
        />
      )}
    </div>
  );
}

/* ─── Mini Waveform Wrapper ─── */

function MiniWaveformWrapper({ buffer }: { buffer: ArrayBuffer }) {
  const [decoded, setDecoded] = useState<AudioBuffer | null>(null);

  useEffect(() => {
    const ctx = new AudioContext();
    ctx.decodeAudioData(buffer.slice(0))
      .then((d) => setDecoded(d))
      .catch(() => setDecoded(null));
    return () => { void ctx.close(); };
  }, [buffer]);

  if (!decoded) return <div className="w-full h-full" />;

  return (
    <Waveform
      buffer={decoded}
      currentTime={0}
      duration={decoded.duration}
      trimStart={null}
      trimEnd={null}
      onSeek={() => {}}
      mini
    />
  );
}

/* ─── Ghost Card ─── */

function GhostCard({ job }: { job: { jobId: string; status: string; progress?: string; error?: string } }) {
  return (
    <div className="ot-take-card border-dashed" style={{ animation: 'ot-pulse 2s ease-in-out infinite' }}>
      {/* Animated ghost bars */}
      <div className="h-12 px-3 py-1 bg-ot-surface-1 flex items-end gap-[2px]">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="flex-1 bg-ot-violet-400/40 rounded-t-sm"
            style={{
              ['--bar-target-h' as string]: `${8 + Math.random() * 24}px`,
              ['--bar-index' as string]: i,
              animation: `ot-ghost-bar 2s ease-in-out infinite`,
              animationDelay: `${i * 30}ms`,
              height: '4px',
            }}
          />
        ))}
      </div>
      <div className="p-4 space-y-2">
        <p className="text-sm text-ot-text-secondary">{job.progress || 'Generating...'}</p>
        <OtProgressBar generating value={50} />
        {job.error && <p className="text-xs text-ot-error">{job.error}</p>}
      </div>
    </div>
  );
}

/* ─── Compare Side ─── */

function CompareSide({
  take,
  label,
  active,
  buffer,
  onSelect,
}: {
  take: { takeId: string; title: string; origin: string };
  label: string;
  active: boolean;
  buffer: ArrayBuffer | null;
  onSelect: () => void;
}) {
  return (
    <button
      className={`p-4 text-left bg-ot-surface-2 ${active ? 'ot-compare-side--active' : ''}`}
      onClick={onSelect}
      type="button"
    >
      <p className="text-[10px] text-ot-text-ghost mb-1">{label}</p>
      {buffer && <MiniWaveformWrapper buffer={buffer} />}
      <p className="text-sm font-semibold text-ot-text-primary truncate mt-2">{take.title}</p>
      <OriginBadge origin={take.origin} />
    </button>
  );
}

/* ─── Context Menu ─── */

function TakeContextMenu({
  x,
  y,
  takeId: _takeId,
  onPlay,
  onFavorite,
  onRename,
  onCompareA,
  onCompareB,
  onPublish,
  onDiscard,
}: {
  x: number;
  y: number;
  takeId: string;
  onPlay: () => void;
  onFavorite: () => void;
  onRename: () => void;
  onCompareA: () => void;
  onCompareB: () => void;
  onPublish?: () => void;
  onDiscard: () => void;
}) {
  // Ensure menu stays in viewport
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x, y });

  useEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const nx = rect.right > window.innerWidth ? x - rect.width : x;
    const ny = rect.bottom > window.innerHeight ? y - rect.height : y;
    setPos({ x: Math.max(0, nx), y: Math.max(0, ny) });
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      className="ot-context-menu"
      style={{ left: pos.x, top: pos.y }}
      onClick={(e) => e.stopPropagation()}
    >
      <button className="ot-context-menu__item" onClick={onPlay} type="button">▶ Play</button>
      <div className="ot-context-menu__sep" />
      <button className="ot-context-menu__item" onClick={onFavorite} type="button">★ Favorite</button>
      <button className="ot-context-menu__item" onClick={onRename} type="button">✎ Rename</button>
      <div className="ot-context-menu__sep" />
      <button className="ot-context-menu__item" onClick={onCompareA} type="button">Compare as A</button>
      <button className="ot-context-menu__item" onClick={onCompareB} type="button">Compare as B</button>
      <div className="ot-context-menu__sep" />
      {onPublish && (
        <>
          <button className="ot-context-menu__item" onClick={onPublish} type="button">Publish...</button>
          <div className="ot-context-menu__sep" />
        </>
      )}
      <button className="ot-context-menu__item ot-context-menu__item--danger" onClick={onDiscard} type="button">Discard</button>
    </div>
  );
}

/* ─── Origin Badge ─── */

function OriginBadge({ origin }: { origin: string }) {
  return (
    <span className={`ot-badge-origin ot-badge-origin--${origin}`}>
      {origin}
    </span>
  );
}
