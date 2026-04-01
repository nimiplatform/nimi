import {
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@nimiplatform/nimi-kit/ui';
import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useLookdevStore } from './lookdev-store.js';
import { getAuditEventDetail, getAuditEventScopeLabel, getAuditEventSeverityLabel, getAuditEventSeverityTone, getAuditEventTitle } from './audit-presentation.js';
import type { LookdevCaptureState, LookdevPolicySnapshot } from './types.js';

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

function hasExecutionTargets(policySnapshot: LookdevPolicySnapshot | null | undefined): policySnapshot is LookdevPolicySnapshot {
  return Boolean(
    policySnapshot
    && policySnapshot.generationTarget
    && policySnapshot.evaluationTarget
    && typeof policySnapshot.generationTarget.modelId === 'string'
    && typeof policySnapshot.evaluationTarget.modelId === 'string',
  );
}

function hasCaptureStateSnapshot(value: unknown): value is LookdevCaptureState {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const snapshot = value as Record<string, unknown>;
  if (snapshot.synthesisMode !== 'interactive' && snapshot.synthesisMode !== 'silent') {
    return false;
  }
  if (typeof snapshot.currentBrief !== 'string') {
    return false;
  }
  const feelingAnchor = snapshot.feelingAnchor;
  return typeof feelingAnchor === 'object'
    && feelingAnchor !== null
    && typeof (feelingAnchor as Record<string, unknown>).coreVibe === 'string';
}

function formatExecutionTarget(
  target: LookdevPolicySnapshot['generationTarget'] | LookdevPolicySnapshot['evaluationTarget'],
  localLabel: string,
  noneLabel: string,
): string {
  const model = target.modelLabel || target.localModelId || target.modelId || noneLabel;
  if (target.route === 'local' || target.source === 'local') {
    return `${localLabel} / ${model}`;
  }
  const connector = target.connectorLabel || target.provider || target.connectorId || noneLabel;
  return `${connector} / ${model}`;
}

export default function BatchDetailPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { batchId = '' } = useParams();
  const batch = useLookdevStore((state) => state.batches.find((entry) => entry.batchId === batchId));
  const pauseBatch = useLookdevStore((state) => state.pauseBatch);
  const resumeBatch = useLookdevStore((state) => state.resumeBatch);
  const rerunFailed = useLookdevStore((state) => state.rerunFailed);
  const commitBatch = useLookdevStore((state) => state.commitBatch);
  const deleteBatch = useLookdevStore((state) => state.deleteBatch);
  const selectItem = useLookdevStore((state) => state.selectItem);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const selectedItem = useMemo(
    () => batch?.items.find((item) => item.itemId === batch.selectedItemId) ?? batch?.items[0],
    [batch],
  );

  if (!batch) {
    return (
      <div className="ld-card px-8 py-12 text-center text-white/68">
        {t('batchDetail.notFound')}
      </div>
    );
  }

  if (!hasExecutionTargets(batch.policySnapshot)) {
    return (
      <div className="ld-card px-8 py-12 text-center">
        <div className="mx-auto max-w-xl space-y-3">
          <div className="text-lg font-medium text-white">{t('batchDetail.invalidSnapshotTitle')}</div>
          <p className="text-sm leading-6 text-white/66">
            {t('batchDetail.invalidSnapshotDescription')}
          </p>
        </div>
      </div>
    );
  }

  if (!selectedItem || !hasCaptureStateSnapshot(selectedItem.captureStateSnapshot)) {
    return (
      <div className="ld-card px-8 py-12 text-center">
        <div className="mx-auto max-w-xl space-y-3">
          <div className="text-lg font-medium text-white">{t('batchDetail.invalidSnapshotTitle')}</div>
          <p className="text-sm leading-6 text-white/66">
            {t('batchDetail.invalidSnapshotDescription')}
          </p>
        </div>
      </div>
    );
  }

  const policySnapshot = batch.policySnapshot;

  return (
    <div className="space-y-5 pb-6">
      <section className="ld-card px-7 py-7">
        <div className="flex flex-col gap-5 2xl:flex-row 2xl:items-start 2xl:justify-between">
          <div className="space-y-2">
            <div className="text-xs uppercase tracking-[0.18em] text-[var(--ld-gold)]">{t(`selectionSource.${batch.selectionSnapshot.selectionSource}`, { defaultValue: batch.selectionSnapshot.selectionSource.replace('_', ' ') })}</div>
            <h2 className="text-3xl font-semibold text-white">{batch.name}</h2>
            <p className="text-sm text-white/66">
              {t('batchDetail.summary', {
                totalItems: batch.totalItems,
                captureSelectedItems: batch.captureSelectedItems,
                passedItems: batch.passedItems,
                failedItems: batch.failedItems,
                committedItems: batch.committedItems,
              })}
            </p>
            <p className="text-xs uppercase tracking-[0.18em] text-white/38">
              {t('batchDetail.styleLane', { name: batch.worldStylePackSnapshot.name })}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {batch.status === 'running' ? (
              <Button
                onClick={() => pauseBatch(batch.batchId)}
                tone="secondary"
                className="rounded-2xl border-white/10 text-sm text-white hover:bg-white/6"
              >
                {t('batchDetail.pause')}
              </Button>
            ) : batch.status === 'paused' ? (
              <Button
                onClick={() => void resumeBatch(batch.batchId)}
                tone="secondary"
                className="rounded-2xl border-white/10 text-sm text-white hover:bg-white/6"
              >
                {t('batchDetail.resume')}
              </Button>
            ) : null}
            {batch.status !== 'commit_complete' ? (
              <Button
                onClick={() => void rerunFailed(batch.batchId, selectedItem ? [selectedItem.itemId] : undefined)}
                disabled={batch.status !== 'processing_complete' || !selectedItem || (selectedItem.status !== 'auto_failed_retryable' && selectedItem.status !== 'auto_failed_exhausted')}
                tone="secondary"
                className="rounded-2xl border-white/10 text-sm text-white hover:bg-white/6"
              >
                {t('batchDetail.rerunSelected')}
              </Button>
            ) : null}
            {batch.status !== 'commit_complete' ? (
              <Button
                onClick={() => void rerunFailed(batch.batchId)}
                disabled={batch.status !== 'processing_complete' || batch.failedItems === 0}
                tone="secondary"
                className="rounded-2xl border-white/10 text-sm text-white hover:bg-white/6"
              >
                {t('batchDetail.rerunFailed')}
              </Button>
            ) : null}
            <Button
              onClick={() => void commitBatch(batch.batchId)}
              disabled={batch.status !== 'processing_complete' || batch.passedItems === 0}
              tone="primary"
              className="rounded-2xl text-sm"
            >
              {t('batchDetail.commitBatch')}
            </Button>
            <Button
              onClick={() => setDeleteDialogOpen(true)}
              disabled={batch.status === 'running'}
              tone="secondary"
              className="rounded-2xl border-white/10 text-sm text-white hover:bg-white/6"
            >
              {t('batchDetail.deleteBatch')}
            </Button>
          </div>
        </div>
      </section>

      <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[320px_minmax(0,0.95fr)_360px]">
        <section className="ld-card px-5 py-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-lg font-semibold text-white">{t('batchDetail.itemsTitle')}</h3>
            <div className="text-xs uppercase tracking-[0.18em] text-white/38">{t('batchDetail.batchStatus', { status: t(`batchStatus.${batch.status}`, { defaultValue: batch.status.replace('_', ' ') }) })}</div>
          </div>
          <div className="space-y-2">
            {batch.items.map((item) => (
              <Button
                key={item.itemId}
                onClick={() => selectItem(batch.batchId, item.itemId)}
                tone="secondary"
                className={`flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left ${batch.selectedItemId === item.itemId ? 'border-[var(--ld-accent)] bg-[color-mix(in_srgb,var(--ld-accent)_14%,transparent)]' : 'border-white/8 bg-black/12 hover:bg-white/6'}`}
                fullWidth
              >
                <div className="min-w-0">
                  <div className="truncate font-medium text-white">{item.agentDisplayName}</div>
                  <div className="mt-1 truncate text-xs text-white/48">{item.agentHandle || item.agentId}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right text-xs text-white/46">
                    <div>{t('batchDetail.attempts', { count: item.attemptCount })}</div>
                    <div>{t(`captureMode.${item.captureMode}`, { defaultValue: item.captureMode })}</div>
                    {item.currentEvaluation ? <div>{t('batchDetail.score', { score: item.currentEvaluation.score })}</div> : null}
                  </div>
                  <div className={`text-sm font-medium ${statusTone(item.status)}`}>{t(`itemStatus.${item.status}`, { defaultValue: item.status.replace(/_/g, ' ') })}</div>
                </div>
              </Button>
            ))}
          </div>
        </section>

        {selectedItem ? (
          <>
            <div className="space-y-5">
              <section className="ld-card px-6 py-6">
                <div>
                  <div className="text-xs uppercase tracking-[0.18em] text-[var(--ld-gold)]">{t('batchDetail.preview')}</div>
                  <h3 className="mt-2 text-2xl font-semibold text-white">{selectedItem.agentDisplayName}</h3>
                  <p className="mt-2 text-sm leading-6 text-white/62">{selectedItem.agentConcept || t('batchDetail.noConcept')}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-xs uppercase tracking-[0.16em] text-white/46">
                    <span>{t(`importance.${selectedItem.importance}`, { defaultValue: selectedItem.importance })}</span>
                    <span>·</span>
                    <span>{t(`captureMode.${selectedItem.captureMode}`, { defaultValue: selectedItem.captureMode })}</span>
                    <span>·</span>
                    <span>{t(`createBatch.captureLane${selectedItem.captureStateSnapshot.synthesisMode === 'interactive' ? 'Interactive' : 'Silent'}`, {
                      defaultValue: selectedItem.captureStateSnapshot.synthesisMode,
                    })}</span>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 md:grid-cols-2">
                  <div className="rounded-3xl border border-white/8 bg-black/18 p-3">
                    <div className="mb-3 text-xs uppercase tracking-[0.16em] text-white/40">{t('batchDetail.currentResult')}</div>
                    {selectedItem.currentImage?.url ? (
                      <img src={selectedItem.currentImage.url} alt={selectedItem.agentDisplayName} className="aspect-[2/3] w-full rounded-2xl object-cover" />
                    ) : (
                      <div className="flex aspect-[2/3] items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-white/38">
                        {t('batchDetail.noGeneratedResult')}
                      </div>
                    )}
                  </div>
                  <div className="rounded-3xl border border-white/8 bg-black/18 p-3">
                    <div className="mb-3 text-xs uppercase tracking-[0.16em] text-white/40">{t('batchDetail.realmPortraitReference')}</div>
                    {selectedItem.existingPortraitUrl ? (
                      <img src={selectedItem.existingPortraitUrl} alt={`${selectedItem.agentDisplayName} realm portrait`} className="aspect-[2/3] w-full rounded-2xl object-cover" />
                    ) : (
                      <div className="flex aspect-[2/3] items-center justify-center rounded-2xl border border-dashed border-white/10 text-sm text-white/38">
                        {t('batchDetail.noExistingPortrait')}
                      </div>
                    )}
                  </div>
                </div>
              </section>

              <section className="ld-card px-6 py-6">
                <div className="text-xs uppercase tracking-[0.16em] text-white/40">{t('batchDetail.batchSnapshots')}</div>
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  <div className="rounded-2xl bg-black/14 px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-white/36">{t('batchDetail.selectionSnapshot')}</div>
                    <div className="mt-3 space-y-2 text-sm text-white/68">
                      <div><span className="text-white/42">{t('batchDetail.selectionMode')}</span> · {t(`selectionSource.${batch.selectionSnapshot.selectionSource}`, { defaultValue: batch.selectionSnapshot.selectionSource.replace('_', ' ') })}</div>
                      <div><span className="text-white/42">{t('batchDetail.worldId')}</span> · {batch.selectionSnapshot.worldId || t('common.none')}</div>
                      <div><span className="text-white/42">{t('batchDetail.selectedAgents')}</span> · {batch.selectionSnapshot.agentIds.length}</div>
                      <div><span className="text-white/42">{t('batchDetail.captureAgents')}</span> · {batch.selectionSnapshot.captureSelectionAgentIds.length}</div>
                    </div>
                  </div>
                  <div className="rounded-2xl bg-black/14 px-4 py-4">
                    <div className="text-xs uppercase tracking-[0.16em] text-white/36">{t('batchDetail.policySnapshot')}</div>
                    <div className="mt-3 space-y-2 text-sm text-white/68">
                      <div><span className="text-white/42">{t('batchDetail.generationTarget')}</span> · {formatExecutionTarget(policySnapshot.generationTarget, t('createBatch.localRuntimeLabel', { defaultValue: 'Local Runtime' }), t('common.none'))}</div>
                      <div><span className="text-white/42">{t('batchDetail.evaluationTarget')}</span> · {formatExecutionTarget(policySnapshot.evaluationTarget, t('createBatch.localRuntimeLabel', { defaultValue: 'Local Runtime' }), t('common.none'))}</div>
                      <div><span className="text-white/42">{t('batchDetail.scoreThreshold')}</span> · {policySnapshot.autoEvalPolicy.scoreThreshold}</div>
                      <div><span className="text-white/42">{t('batchDetail.maxConcurrency')}</span> · {policySnapshot.maxConcurrency}</div>
                      <div><span className="text-white/42">{t('batchDetail.retryBudget')}</span> · {policySnapshot.retryPolicy.maxAttemptsPerPass}</div>
                      <div><span className="text-white/42">{t('batchDetail.writebackBinding')}</span> · {policySnapshot.writebackPolicy.bindingPoint}</div>
                    </div>
                  </div>
                </div>
              </section>

              <div className="grid gap-5 lg:grid-cols-2">
                <section className="ld-card px-5 py-5">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/40">{t('createBatch.captureStateStatus', { defaultValue: 'Capture state' })}</div>
                  <div className="mt-4 space-y-2 text-sm text-white/68">
                    <div><span className="text-white/42">{t('createBatch.captureStateCurrentBrief', { defaultValue: 'Current brief' })}</span> · {selectedItem.captureStateSnapshot.currentBrief}</div>
                    <div><span className="text-white/42">{t('createBatch.captureFeelingAnchor', { defaultValue: 'Feeling anchor' })}</span> · {selectedItem.captureStateSnapshot.feelingAnchor.coreVibe}</div>
                    <div><span className="text-white/42">{t('createBatch.captureStateStatus', { defaultValue: 'Capture state' })}</span> · {selectedItem.captureStateSnapshot.synthesisMode}</div>
                  </div>
                </section>

                <section className="ld-card px-5 py-5">
                  <div className="text-xs uppercase tracking-[0.16em] text-white/40">{t('batchDetail.portraitBrief')}</div>
                  <div className="mt-4 space-y-2 text-sm text-white/68">
                    <div><span className="text-white/42">{t('batchDetail.role')}</span> · {selectedItem.portraitBrief.visualRole}</div>
                    <div><span className="text-white/42">{t('createBatch.silhouette')}</span> · {selectedItem.portraitBrief.silhouette}</div>
                    <div><span className="text-white/42">{t('createBatch.outfit')}</span> · {selectedItem.portraitBrief.outfit}</div>
                    <div><span className="text-white/42">{t('createBatch.palette')}</span> · {selectedItem.portraitBrief.palettePrimary}</div>
                    <div><span className="text-white/42">{t('createBatch.artStyle')}</span> · {selectedItem.portraitBrief.artStyle}</div>
                  </div>
                </section>
              </div>
            </div>

            <div className="space-y-5 xl:col-span-2 2xl:col-span-1">
              <section className="ld-card px-5 py-5">
                <div className="text-xs uppercase tracking-[0.16em] text-white/40">{t('batchDetail.evaluation')}</div>
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
                          <span className="text-white/72">{t(`evaluationCheck.${check.key}`, { defaultValue: check.key })}</span>
                          <span className={check.passed ? 'text-emerald-200' : 'text-amber-100'}>{check.passed ? t('batchDetail.pass') : t('batchDetail.fail')}</span>
                        </div>
                      ))}
                    </div>
                    {selectedItem.currentEvaluation.failureReasons.length > 0 ? (
                      <div className="space-y-2">
                        <div className="text-xs uppercase tracking-[0.16em] text-white/40">{t('batchDetail.failureReasons')}</div>
                        <ul className="space-y-2 text-sm text-white/64">
                          {selectedItem.currentEvaluation.failureReasons.map((reason) => (
                            <li key={reason} className="rounded-2xl bg-black/14 px-3 py-2">{reason}</li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="mt-4 text-sm text-white/46">{t('batchDetail.noEvaluation')}</div>
                )}
              </section>

              <section className="ld-card px-5 py-5">
                <div className="text-xs uppercase tracking-[0.16em] text-white/40">{t('batchDetail.auditTrail')}</div>
                <div className="mt-3 text-sm text-white/52">{t('batchDetail.auditSummary', { count: batch.auditTrail.length })}</div>
                <div className="mt-4 grid gap-2 text-sm text-white/68">
                  <div><span className="text-white/42">{t('batchDetail.createdAt')}</span> · {batch.createdAt}</div>
                  <div><span className="text-white/42">{t('batchDetail.updatedAt')}</span> · {batch.updatedAt}</div>
                  <div><span className="text-white/42">{t('batchDetail.processingCompletedAt')}</span> · {batch.processingCompletedAt || t('common.none')}</div>
                  <div><span className="text-white/42">{t('batchDetail.commitCompletedAt')}</span> · {batch.commitCompletedAt || t('common.none')}</div>
                </div>
                <div className="mt-4 space-y-2">
                  {batch.auditTrail.length > 0 ? batch.auditTrail.map((entry) => (
                    <div key={entry.eventId} className="rounded-2xl border border-white/8 bg-black/14 px-4 py-4 text-sm text-white/68">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 space-y-1">
                          <div className="font-medium text-white">{getAuditEventTitle(t, entry)}</div>
                          {getAuditEventDetail(entry) ? (
                            <div className="text-sm text-white/56">{getAuditEventDetail(entry)}</div>
                          ) : null}
                        </div>
                        <div className={`rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-[0.16em] ${getAuditEventSeverityTone(entry.severity)}`}>
                          {getAuditEventSeverityLabel(t, entry.severity)}
                        </div>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] uppercase tracking-[0.16em] text-white/38">
                        <span>{entry.occurredAt}</span>
                        <span>·</span>
                        <span>{getAuditEventScopeLabel(t, entry)}</span>
                        {entry.count ? (
                          <>
                            <span>·</span>
                            <span>{t('batchDetail.auditCountMeta', { count: entry.count })}</span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  )) : (
                    <div className="rounded-2xl border border-dashed border-white/10 px-3 py-4 text-sm text-white/40">
                      {t('batchDetail.noAuditTrail')}
                    </div>
                  )}
                </div>
              </section>

              {selectedItem.lastErrorMessage ? (
                <div className="rounded-2xl border border-amber-300/18 bg-amber-300/10 px-4 py-3 text-sm text-amber-50">
                  {selectedItem.lastErrorMessage}
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>

      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent aria-describedby={undefined} className="max-w-[620px] border-[var(--ld-panel-border)] bg-[rgb(8_15_24/0.98)] text-white shadow-[0_28px_80px_rgba(0,0,0,0.42)]">
          <DialogHeader>
            <DialogTitle>{t('batchDetail.deleteDialogTitle')}</DialogTitle>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="text-sm leading-6 text-white/66">
              {t('batchDetail.deleteDialogDescription', { name: batch.name })}
            </p>
            <div className="rounded-2xl border border-amber-300/18 bg-amber-300/10 px-4 py-4 text-sm text-amber-50">
              {t('batchDetail.deleteDialogWarning')}
            </div>
          </DialogBody>
          <DialogFooter className="justify-end gap-3">
            <Button tone="secondary" className="rounded-2xl border-white/10 bg-black/12 text-white hover:bg-white/6" onClick={() => setDeleteDialogOpen(false)}>
              {t('batchDetail.deleteDialogCancel')}
            </Button>
            <Button
              tone="primary"
              className="rounded-2xl text-sm"
              onClick={() => {
                deleteBatch(batch.batchId);
                setDeleteDialogOpen(false);
                navigate('/');
              }}
            >
              {t('batchDetail.deleteDialogConfirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
