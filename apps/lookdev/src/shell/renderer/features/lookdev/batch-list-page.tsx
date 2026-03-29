import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useLookdevStore } from './lookdev-store.js';

function StatusPill({ status }: { status: string }) {
  const tone = status === 'running'
    ? 'bg-cyan-300/12 text-cyan-100 border-cyan-300/20'
    : status === 'processing_complete'
      ? 'bg-emerald-300/12 text-emerald-100 border-emerald-300/20'
      : status === 'paused'
        ? 'bg-amber-300/12 text-amber-100 border-amber-300/20'
        : 'bg-violet-300/12 text-violet-100 border-violet-300/20';
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${tone}`}>{status.replace('_', ' ')}</span>;
}

export default function BatchListPage() {
  const batches = useLookdevStore((state) => state.batches);
  const [filter, setFilter] = useState<'all' | 'running' | 'paused' | 'processing_complete' | 'commit_complete'>('all');
  const visibleBatches = filter === 'all'
    ? batches
    : batches.filter((batch) => batch.status === filter);

  return (
    <div className="space-y-5">
      <section className="ld-card relative overflow-hidden px-8 py-8">
        <div className="absolute inset-y-0 right-0 w-1/3 bg-[radial-gradient(circle_at_center,rgba(117,240,213,0.16),transparent_60%)]" />
        <div className="relative flex items-start justify-between gap-6">
          <div className="max-w-3xl space-y-3">
            <div className="text-xs uppercase tracking-[0.28em] text-[var(--ld-gold)]">Lookdev queue</div>
            <h2 className="text-4xl font-semibold tracking-tight text-white">Portrait truth moves in batches, not drafts.</h2>
            <p className="max-w-2xl text-sm leading-7 text-white/72">
              Define one world style lane, freeze capture selection, let the runtime generate and gate outputs, then explicitly commit passed portraits back into Realm truth.
            </p>
          </div>
          <Link
            to="/batches/new"
            className="rounded-2xl bg-[var(--ld-accent)] px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-[var(--ld-accent-strong)]"
          >
            Create Batch
          </Link>
        </div>
      </section>

      <section className="flex flex-wrap gap-2">
        {(['all', 'running', 'paused', 'processing_complete', 'commit_complete'] as const).map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => setFilter(value)}
            className={`rounded-full border px-3 py-1.5 text-xs uppercase tracking-[0.16em] ${filter === value ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/10 text-white/60 hover:bg-white/6 hover:text-white'}`}
          >
            {value.replace('_', ' ')}
          </button>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleBatches.length === 0 ? (
          <div className="ld-card col-span-full px-8 py-12 text-center">
            <div className="mx-auto max-w-md space-y-3">
              <div className="text-lg font-medium text-white">{batches.length === 0 ? 'No batch yet' : 'No batch matches this filter'}</div>
              <p className="text-sm leading-6 text-white/66">
                {batches.length === 0
                  ? 'Start by freezing a world slice or an explicit set of agents into one batch.'
                  : 'Switch the status filter or open the creator to launch a new batch.'}
              </p>
              <Link
                to="/batches/new"
                className="inline-flex rounded-2xl border border-[var(--ld-panel-border)] px-4 py-2 text-sm text-white transition hover:bg-white/6"
              >
                Open batch creator
              </Link>
            </div>
          </div>
        ) : visibleBatches.map((batch) => (
          <Link
            key={batch.batchId}
            to={`/batches/${batch.batchId}`}
            className="ld-card block px-6 py-5 transition hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--ld-accent)_28%,transparent)]"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-white/40">{batch.selectionSnapshot.selectionSource.replace('_', ' ')}</div>
                <h3 className="mt-2 text-xl font-semibold text-white">{batch.name}</h3>
              </div>
              <StatusPill status={batch.status} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 text-sm text-white/76">
              <div className="rounded-2xl bg-black/14 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Items</div>
                <div className="mt-1 text-2xl font-semibold text-white">{batch.totalItems}</div>
              </div>
              <div className="rounded-2xl bg-black/14 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Capture</div>
                <div className="mt-1 text-2xl font-semibold text-violet-100">{batch.captureSelectedItems}</div>
              </div>
              <div className="rounded-2xl bg-black/14 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Passed</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-200">{batch.passedItems}</div>
              </div>
              <div className="rounded-2xl bg-black/14 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Failed</div>
                <div className="mt-1 text-2xl font-semibold text-amber-100">{batch.failedItems}</div>
              </div>
              <div className="rounded-2xl bg-black/14 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">Committed</div>
                <div className="mt-1 text-2xl font-semibold text-cyan-100">{batch.committedItems}</div>
              </div>
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
