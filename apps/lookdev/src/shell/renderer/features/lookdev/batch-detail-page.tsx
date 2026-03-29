import { useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useLookdevStore } from './lookdev-store.js';

function statusTone(status: string): string {
  switch (status) {
    case 'auto_passed':
    case 'committed':
      return 'text-emerald-200';
    case 'auto_failed_retryable':
    case 'auto_failed_exhausted':
    case 'commit_failed':
      return 'text-amber-100';
    case 'generating':
      return 'text-cyan-100';
    default:
      return 'text-white/72';
  }
}

export default function BatchDetailPage() {
  const { batchId = '' } = useParams();
  const batch = useLookdevStore((state) => state.batches.find((entry) => entry.batchId === batchId));
  const pauseBatch = useLookdevStore((state) => state.pauseBatch);
  const resumeBatch = useLookdevStore((state) => state.resumeBatch);
  const rerunFailed = useLookdevStore((state) => state.rerunFailed);
  const commitBatch = useLookdevStore((state) => state.commitBatch);
  const selectItem = useLookdevStore((state) => state.selectItem);

  const selectedItem = useMemo(
    () => batch?.items.find((item) => item.itemId === batch.selectedItemId) ?? batch?.items[0],
    [batch],
  );

  if (!batch) {
    return (
      <div className="ld-card px-8 py-12 text-center text-white/68">
        Batch not found.
      </div>
    );
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
      <div className="space-y-5">
        <section className="ld-card px-7 py-7">
          <div className="flex flex-wrap items-start justify-between gap-5">
            <div className="space-y-2">
              <div className="text-xs uppercase tracking-[0.18em] text-[var(--ld-gold)]">{batch.selectionSnapshot.selectionSource.replace('_', ' ')}</div>
              <h2 className="text-3xl font-semibold text-white">{batch.name}</h2>
              <p className="text-sm text-white/66">
                {batch.totalItems} items · {batch.captureSelectedItems} capture · {batch.passedItems} passed · {batch.failedItems} failed · {batch.committedItems} committed
              </p>
              <p className="text-xs uppercase tracking-[0.18em] text-white/38">
                Style lane: {batch.worldStylePackSnapshot.name}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {batch.status === 'running' ? (
                <button
                  type="button"
                  onClick={() => pauseBatch(batch.batchId)}
                  className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/6"
                >
                  Pause
                </button>
              ) : batch.status !== 'commit_complete' ? (
                <button
                  type="button"
                  onClick={() => void resumeBatch(batch.batchId)}
                  className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/6"
                >
                  Resume
                </button>
              ) : null}
              {batch.status !== 'commit_complete' ? (
                <button
                  type="button"
                  onClick={() => void rerunFailed(batch.batchId, selectedItem ? [selectedItem.itemId] : undefined)}
                  disabled={batch.status !== 'processing_complete' || !selectedItem || (selectedItem.status !== 'auto_failed_retryable' && selectedItem.status !== 'auto_failed_exhausted')}
                  className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/6 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Rerun Selected
                </button>
              ) : null}
              {batch.status !== 'commit_complete' ? (
                <button
                  type="button"
                  onClick={() => void rerunFailed(batch.batchId)}
                  disabled={batch.status !== 'processing_complete'}
                  className="rounded-2xl border border-white/10 px-4 py-2 text-sm text-white hover:bg-white/6"
                >
                  Rerun Failed
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => void commitBatch(batch.batchId)}
                disabled={batch.status !== 'processing_complete' || batch.passedItems === 0}
                className="rounded-2xl bg-[var(--ld-accent)] px-4 py-2 text-sm font-medium text-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Commit Batch
              </button>
            </div>
          </div>
        </section>

        <section className="ld-card px-5 py-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">Items</h3>
            <div className="text-xs uppercase tracking-[0.18em] text-white/38">Batch status: {batch.status.replace('_', ' ')}</div>
          </div>
          <div className="space-y-2">
            {batch.items.map((item) => (
              <button
                key={item.itemId}
                type="button"
                onClick={() => selectItem(batch.batchId, item.itemId)}
                className={`flex w-full items-center justify-between rounded-2xl border px-4 py-3 text-left ${batch.selectedItemId === item.itemId ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)]' : 'border-white/8 bg-black/12 hover:bg-white/6'}`}
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-white">{item.agentDisplayName}</div>
                  <div className="mt-1 truncate text-xs text-white/48">{item.agentHandle || item.agentId}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right text-xs text-white/46">
                    <div>{item.attemptCount} attempts</div>
                    <div>{item.captureMode === 'capture' ? 'capture selected' : 'batch only'}</div>
                    {item.currentEvaluation ? <div>score {item.currentEvaluation.score}</div> : null}
                  </div>
                  <div className={`text-sm font-medium ${statusTone(item.status)}`}>{item.status.replace(/_/g, ' ')}</div>
                </div>
              </button>
            ))}
          </div>
        </section>
      </div>

      <section className="ld-card px-6 py-6">
        {selectedItem ? (
          <div className="space-y-5">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-[var(--ld-gold)]">Preview</div>
              <h3 className="mt-2 text-2xl font-semibold text-white">{selectedItem.agentDisplayName}</h3>
              <p className="mt-2 text-sm leading-6 text-white/62">{selectedItem.agentConcept || 'No concept text was provided by the current Realm agent record.'}</p>
              <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em] text-white/46">
                <span>{selectedItem.importance}</span>
                <span>·</span>
                <span>{selectedItem.captureMode === 'capture' ? 'Capture selected' : 'Batch only'}</span>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="rounded-3xl border border-white/8 bg-black/18 p-3">
                <div className="mb-3 text-xs uppercase tracking-[0.16em] text-white/40">Current result</div>
                {selectedItem.currentImage?.url ? (
                  <img src={selectedItem.currentImage.url} alt={selectedItem.agentDisplayName} className="aspect-[2/3] w-full rounded-2xl object-cover" />
                ) : (
                  <div className="flex aspect-[2/3] items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-white/38">
                    No generated result yet
                  </div>
                )}
              </div>
              <div className="rounded-3xl border border-white/8 bg-black/18 p-3">
                <div className="mb-3 text-xs uppercase tracking-[0.16em] text-white/40">Realm portrait reference</div>
                {selectedItem.existingPortraitUrl ? (
                  <img src={selectedItem.existingPortraitUrl} alt={`${selectedItem.agentDisplayName} realm portrait`} className="aspect-[2/3] w-full rounded-2xl object-cover" />
                ) : (
                  <div className="flex aspect-[2/3] items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-white/38">
                    No existing portrait binding
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-3xl border border-white/8 bg-black/16 px-5 py-5">
              <div className="text-xs uppercase tracking-[0.16em] text-white/40">Portrait brief</div>
              <div className="mt-4 space-y-2 text-sm text-white/68">
                <div><span className="text-white/42">Role</span> · {selectedItem.portraitBrief.visualRole}</div>
                <div><span className="text-white/42">Silhouette</span> · {selectedItem.portraitBrief.silhouette}</div>
                <div><span className="text-white/42">Outfit</span> · {selectedItem.portraitBrief.outfit}</div>
                <div><span className="text-white/42">Palette</span> · {selectedItem.portraitBrief.palettePrimary}</div>
                <div><span className="text-white/42">Art style</span> · {selectedItem.portraitBrief.artStyle}</div>
              </div>
            </div>

            <div className="rounded-3xl border border-white/8 bg-black/16 px-5 py-5">
              <div className="text-xs uppercase tracking-[0.16em] text-white/40">Evaluation</div>
              {selectedItem.currentEvaluation ? (
                <div className="mt-4 space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-white/64">{selectedItem.currentEvaluation.summary}</div>
                    <div className={`text-2xl font-semibold ${selectedItem.currentEvaluation.passed ? 'text-emerald-200' : 'text-amber-100'}`}>
                      {selectedItem.currentEvaluation.score}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {selectedItem.currentEvaluation.checks.map((check) => (
                      <div key={check.key} className="flex items-center justify-between rounded-2xl bg-black/14 px-3 py-2 text-sm">
                        <span className="text-white/72">{check.key}</span>
                        <span className={check.passed ? 'text-emerald-200' : 'text-amber-100'}>{check.passed ? 'pass' : 'fail'}</span>
                      </div>
                    ))}
                  </div>
                  {selectedItem.currentEvaluation.failureReasons.length > 0 ? (
                    <div className="space-y-2">
                      <div className="text-xs uppercase tracking-[0.16em] text-white/40">Failure reasons</div>
                      <ul className="space-y-2 text-sm text-white/64">
                        {selectedItem.currentEvaluation.failureReasons.map((reason) => (
                          <li key={reason} className="rounded-2xl bg-black/14 px-3 py-2">{reason}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-4 text-sm text-white/46">No evaluation payload yet.</div>
              )}
            </div>

            {selectedItem.lastErrorMessage ? (
              <div className="rounded-2xl border border-amber-300/18 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                {selectedItem.lastErrorMessage}
              </div>
            ) : null}
          </div>
        ) : null}
      </section>
    </div>
  );
}
