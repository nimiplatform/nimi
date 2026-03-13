import React, { useState } from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

export function TakesPanel() {
  const takes = useAppStore((state) => state.takes);
  const selectedTakeId = useAppStore((state) => state.selectedTakeId);
  const compareTakeIds = useAppStore((state) => state.compareTakeIds);
  const selectTake = useAppStore((state) => state.selectTake);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const renameTake = useAppStore((state) => state.renameTake);
  const discardTake = useAppStore((state) => state.discardTake);
  const setCompareTakeSlot = useAppStore((state) => state.setCompareTakeSlot);
  const clearCompareTakeIds = useAppStore((state) => state.clearCompareTakeIds);

  const [editingTakeId, setEditingTakeId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');

  if (takes.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">Takes</h2>
        <div className="text-center py-8">
          <p className="text-zinc-500 text-sm">No takes yet. Generate your first song above.</p>
        </div>
      </div>
    );
  }

  const sortedTakes = [...takes].sort((left, right) => right.createdAt - left.createdAt);
  const compareLeft = compareTakeIds[0]
    ? takes.find((take) => take.takeId === compareTakeIds[0])
    : null;
  const compareRight = compareTakeIds[1]
    ? takes.find((take) => take.takeId === compareTakeIds[1])
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
          Takes ({takes.length})
        </h2>
        {(compareTakeIds[0] || compareTakeIds[1]) && (
          <button
            className="text-xs text-zinc-500 hover:text-zinc-300 transition-colors"
            onClick={clearCompareTakeIds}
            type="button"
          >
            Clear Compare
          </button>
        )}
      </div>

      {compareLeft && compareRight && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-3 space-y-2">
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-zinc-500">A/B Compare</span>
            <div className="flex gap-2">
              <button
                className="text-xs text-zinc-400 hover:text-zinc-200"
                onClick={() => selectTake(compareLeft.takeId)}
                type="button"
              >
                Focus A
              </button>
              <button
                className="text-xs text-zinc-400 hover:text-zinc-200"
                onClick={() => selectTake(compareRight.takeId)}
                type="button"
              >
                Focus B
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <CompareCard label="A" title={compareLeft.title} selected={selectedTakeId === compareLeft.takeId} />
            <CompareCard label="B" title={compareRight.title} selected={selectedTakeId === compareRight.takeId} />
          </div>
        </div>
      )}

      <div className="space-y-2">
        {sortedTakes.map((take) => {
          const isSelected = take.takeId === selectedTakeId;
          const isEditing = editingTakeId === take.takeId;
          return (
            <div
              key={take.takeId}
              className={`rounded-lg border transition-colors ${
                isSelected
                  ? 'bg-zinc-800 border-zinc-600'
                  : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <button
                className="w-full text-left p-3"
                onClick={() => selectTake(take.takeId)}
                type="button"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-zinc-200 truncate">{take.title}</span>
                      <OriginBadge origin={take.origin} />
                    </div>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">{take.promptSnapshot}</p>
                    {take.parentTakeId && (
                      <p className="text-[10px] text-zinc-600 mt-0.5">
                        from: {takes.find((item) => item.takeId === take.parentTakeId)?.title ?? take.parentTakeId}
                      </p>
                    )}
                    <p className="text-xs text-zinc-600 mt-0.5">
                      {new Date(take.createdAt).toLocaleTimeString()}
                    </p>
                  </div>
                  <button
                    className="shrink-0 p-1 hover:bg-zinc-700 rounded transition-colors"
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFavorite(take.takeId);
                    }}
                    type="button"
                  >
                    <span className={take.favorite ? 'text-amber-400' : 'text-zinc-600'}>
                      {take.favorite ? '\u2605' : '\u2606'}
                    </span>
                  </button>
                </div>
              </button>

              <div className="border-t border-zinc-800 px-3 py-2 flex flex-wrap gap-2">
                <button
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                  onClick={() => {
                    setEditingTakeId(take.takeId);
                    setDraftTitle(take.title);
                  }}
                  type="button"
                >
                  Rename
                </button>
                <button
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                  onClick={() => setCompareTakeSlot(0, take.takeId)}
                  type="button"
                >
                  Compare A
                </button>
                <button
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                  onClick={() => setCompareTakeSlot(1, take.takeId)}
                  type="button"
                >
                  Compare B
                </button>
                <button
                  className="text-[11px] text-red-400 hover:text-red-300 transition-colors"
                  onClick={() => discardTake(take.takeId)}
                  type="button"
                >
                  Discard
                </button>
              </div>

              {isEditing && (
                <div className="border-t border-zinc-800 px-3 py-3 flex gap-2">
                  <input
                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded-md px-3 py-1.5 text-sm text-zinc-100 focus:outline-none focus:border-zinc-500"
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                  />
                  <button
                    className="px-3 py-1.5 text-xs bg-zinc-100 text-zinc-900 rounded-md"
                    onClick={() => {
                      renameTake(take.takeId, draftTitle.trim() || take.title);
                      setEditingTakeId(null);
                    }}
                    type="button"
                  >
                    Save
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CompareCard({
  label,
  title,
  selected,
}: {
  label: string;
  title: string;
  selected: boolean;
}) {
  return (
    <div className={`rounded-md border px-3 py-2 ${selected ? 'border-zinc-500 bg-zinc-800' : 'border-zinc-800 bg-zinc-950'}`}>
      <p className="text-[10px] text-zinc-500">{label}</p>
      <p className="text-sm text-zinc-200 truncate">{title}</p>
    </div>
  );
}

function OriginBadge({ origin }: { origin: string }) {
  const colors: Record<string, string> = {
    prompt: 'bg-blue-500/10 text-blue-400',
    extend: 'bg-emerald-500/10 text-emerald-400',
    remix: 'bg-amber-500/10 text-amber-400',
    reference: 'bg-cyan-500/10 text-cyan-400',
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${colors[origin] ?? 'bg-zinc-800 text-zinc-500'}`}>
      {origin}
    </span>
  );
}
