import { Button } from '@nimiplatform/nimi-kit/ui';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLookdevStore } from './lookdev-store.js';
import { getAuditEventDetail, getAuditEventTitle } from './audit-presentation.js';

function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  const tone = status === 'running'
    ? 'bg-cyan-300/12 text-cyan-100 border-cyan-300/20'
    : status === 'processing_complete'
      ? 'bg-emerald-300/12 text-emerald-100 border-emerald-300/20'
      : status === 'paused'
        ? 'bg-amber-300/12 text-amber-100 border-amber-300/20'
        : 'bg-violet-300/12 text-violet-100 border-violet-300/20';
  return <span className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] ${tone}`}>{t(`batchStatus.${status}`, { defaultValue: status.replace('_', ' ') })}</span>;
}

export default function BatchListPage() {
  const { t } = useTranslation();
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
            <div className="text-xs uppercase tracking-[0.28em] text-[var(--ld-gold)]">{t('batchList.heroEyebrow')}</div>
            <h2 className="text-4xl font-semibold tracking-tight text-white">{t('batchList.heroTitle')}</h2>
            <p className="max-w-2xl text-sm leading-7 text-white/72">
              {t('batchList.heroDescription')}
            </p>
          </div>
          <Link
            to="/batches/new"
            className="rounded-2xl bg-[var(--ld-accent)] px-5 py-3 text-sm font-medium text-slate-950 transition hover:bg-[var(--ld-accent-strong)]"
          >
            {t('batchList.createBatch')}
          </Link>
        </div>
      </section>

      <section className="flex flex-wrap gap-2">
        {(['all', 'running', 'paused', 'processing_complete', 'commit_complete'] as const).map((value) => (
          <Button
            key={value}
            onClick={() => setFilter(value)}
            tone="secondary"
            size="sm"
            className={`rounded-full px-3 py-1.5 text-xs uppercase tracking-[0.16em] ${filter === value ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)] text-white' : 'border-white/10 bg-transparent text-white/60 hover:bg-white/6 hover:text-white'}`}
          >
            {t(`batchStatus.${value}`, { defaultValue: value.replace('_', ' ') })}
          </Button>
        ))}
      </section>

      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleBatches.length === 0 ? (
          <div className="ld-card col-span-full px-8 py-12 text-center">
            <div className="mx-auto max-w-md space-y-3">
              <div className="text-lg font-medium text-white">{batches.length === 0 ? t('batchList.emptyTitle') : t('batchList.emptyFilteredTitle')}</div>
              <p className="text-sm leading-6 text-white/66">
                {batches.length === 0
                  ? t('batchList.emptyDescription')
                  : t('batchList.emptyFilteredDescription')}
              </p>
              <Link
                to="/batches/new"
                className="inline-flex rounded-2xl border border-[var(--ld-panel-border)] px-4 py-2 text-sm text-white transition hover:bg-white/6"
              >
                {t('batchList.openBatchCreator')}
              </Link>
            </div>
          </div>
        ) : visibleBatches.map((batch) => (
          <Link key={batch.batchId} to={`/batches/${batch.batchId}`} className="ld-card block px-6 py-5 transition hover:-translate-y-0.5 hover:border-[color-mix(in_srgb,var(--ld-accent)_28%,transparent)]">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs uppercase tracking-[0.16em] text-white/40">{t(`selectionSource.${batch.selectionSnapshot.selectionSource}`, { defaultValue: batch.selectionSnapshot.selectionSource.replace('_', ' ') })}</div>
                <h3 className="mt-2 text-xl font-semibold text-white">{batch.name}</h3>
              </div>
              <StatusPill status={batch.status} />
            </div>

            <div className="mt-5 grid grid-cols-2 gap-3 text-sm text-white/76">
              <div className="rounded-2xl bg-black/14 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">{t('batchList.cardItems')}</div>
                <div className="mt-1 text-2xl font-semibold text-white">{batch.totalItems}</div>
              </div>
              <div className="rounded-2xl bg-black/14 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">{t('batchList.cardCapture')}</div>
                <div className="mt-1 text-2xl font-semibold text-violet-100">{batch.captureSelectedItems}</div>
              </div>
              <div className="rounded-2xl bg-black/14 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">{t('batchList.cardPassed')}</div>
                <div className="mt-1 text-2xl font-semibold text-emerald-200">{batch.passedItems}</div>
              </div>
              <div className="rounded-2xl bg-black/14 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">{t('batchList.cardFailed')}</div>
                <div className="mt-1 text-2xl font-semibold text-amber-100">{batch.failedItems}</div>
              </div>
              <div className="rounded-2xl bg-black/14 px-3 py-3">
                <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">{t('batchList.cardCommitted')}</div>
                <div className="mt-1 text-2xl font-semibold text-cyan-100">{batch.committedItems}</div>
              </div>
            </div>
            <div className="mt-4 rounded-2xl border border-white/8 bg-black/14 px-4 py-4">
              <div className="text-[11px] uppercase tracking-[0.16em] text-white/38">{t('batchList.lastActivity')}</div>
              {batch.auditTrail[0] ? (
                <div className="mt-2 space-y-1">
                  <div className="text-sm font-medium text-white">{getAuditEventTitle(t, batch.auditTrail[0])}</div>
                  {getAuditEventDetail(batch.auditTrail[0]) ? (
                    <div className="text-sm text-white/56">{getAuditEventDetail(batch.auditTrail[0])}</div>
                  ) : null}
                  <div className="text-xs text-white/40">
                    {batch.auditTrail[0].occurredAt} · {t('batchList.auditCount', { count: batch.auditTrail.length })}
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-sm text-white/46">{t('batchList.noActivity')}</div>
              )}
            </div>
          </Link>
        ))}
      </section>
    </div>
  );
}
