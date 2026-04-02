import { getPlatformClient } from '@nimiplatform/sdk';
import { createLookdevImageUpload, finalizeLookdevResource } from '@renderer/data/lookdev-data-client.js';
import type { LookdevBatch, LookdevBatchStatus, LookdevEvaluationResult, LookdevImageArtifact, LookdevItem } from './types.js';
import { deriveCorrectionHints } from './evaluation.js';
import { createAuditEvent, evaluateLookdevImage, generateLookdevItem } from './lookdev-processing.js';

function nowIso(): string {
  return new Date().toISOString();
}

function isImageMimeType(value: string): boolean {
  return /^image\//u.test(value);
}

export type BatchMutator = (batchId: string, updater: (batch: LookdevBatch) => LookdevBatch) => void;
export type BatchGetter = (batchId: string) => LookdevBatch | null;
export type BatchCountUpdater = (batch: LookdevBatch) => LookdevBatch;

const batchLocks = new Map<string, Promise<void>>();

export function hasBatchLock(batchId: string): boolean {
  return batchLocks.has(batchId);
}

export function getBatchLock(batchId: string): Promise<void> | undefined {
  return batchLocks.get(batchId);
}

export async function uploadResourceForItem(item: LookdevItem, batch: LookdevBatch): Promise<string> {
  if (!item.currentImage) {
    throw new Error('LOOKDEV_COMMIT_IMAGE_MISSING');
  }
  const upload = await createLookdevImageUpload();
  const response = await fetch(item.currentImage.url);
  if (!response.ok) {
    throw new Error(`LOOKDEV_COMMIT_IMAGE_FETCH_FAILED:${response.status}`);
  }
  const blob = await response.blob();
  const mimeType = String(blob.type || '').trim();
  if (!mimeType) {
    throw new Error('LOOKDEV_IMAGE_MIME_TYPE_REQUIRED');
  }
  if (!isImageMimeType(mimeType)) {
    throw new Error(`LOOKDEV_IMAGE_MIME_TYPE_INVALID:${mimeType}`);
  }
  let uploadResponse = await fetch(upload.uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': mimeType },
  });
  if (!uploadResponse.ok) {
    const formData = new FormData();
    formData.append('file', blob, `${item.agentHandle || item.agentId}.png`);
    uploadResponse = await fetch(upload.uploadUrl, {
      method: 'POST',
      body: formData,
    });
  }
  if (!uploadResponse.ok) {
    throw new Error(`LOOKDEV_UPLOAD_FAILED:${uploadResponse.status}`);
  }
  const finalized = await finalizeLookdevResource(upload.resourceId, {
    mimeType,
    width: item.currentImage.width,
    height: item.currentImage.height,
    traceId: item.currentImage.traceId,
    sourceArtifactId: item.currentImage.artifactId,
    title: `${item.agentDisplayName} portrait`,
    tags: ['lookdev', 'agent-portrait', batch.batchId],
  });
  return String(finalized.id || upload.resourceId).trim();
}

export function recoverInterruptedBatch(
  batch: LookdevBatch,
  updateBatchCounts: BatchCountUpdater,
): LookdevBatch {
  const hadInterruptedGenerating = batch.items.some((item) => item.status === 'generating');
  const nextItems = batch.items.map((item) => item.status === 'generating'
    ? {
        ...item,
        status: 'pending' as const,
        currentEvaluation: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        updatedAt: nowIso(),
      }
    : item);
  if (!hadInterruptedGenerating) {
    return batch;
  }
  return updateBatchCounts({
    ...batch,
    items: nextItems,
    processingCompletedAt: null,
    auditTrail: [createAuditEvent({
      batchId: batch.batchId,
      kind: 'batch_resumed',
      scope: 'batch',
      severity: 'warning',
      detail: 'Recovered interrupted generating items and returned them to pending.',
    }), ...batch.auditTrail],
  });
}

export async function runBatchProcessing(
  batchId: string,
  mutateBatch: BatchMutator,
  getBatch: BatchGetter,
  updateBatchCounts: BatchCountUpdater,
): Promise<void> {
  if (batchLocks.has(batchId)) {
    return batchLocks.get(batchId);
  }

  const runner = (async () => {
    const runtime = getPlatformClient().runtime;
    while (true) {
      const batch = getBatch(batchId);
      if (!batch || batch.status !== 'running') {
        break;
      }
      const generatingCount = batch.items.filter((item) => item.status === 'generating').length;
      const availableSlots = Math.max(0, batch.policySnapshot.maxConcurrency - generatingCount);
      const candidates = batch.items.filter((item) => item.status === 'pending' || item.status === 'auto_failed_retryable');

      if (candidates.length === 0 && generatingCount === 0) {
        mutateBatch(batchId, (current) => updateBatchCounts({
          ...current,
          status: 'processing_complete',
          processingCompletedAt: current.processingCompletedAt || nowIso(),
          auditTrail: [createAuditEvent({
            batchId,
            kind: 'processing_complete',
            scope: 'batch',
            severity: 'success',
          }), ...current.auditTrail],
        }));
        break;
      }

      if (availableSlots === 0 || candidates.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        continue;
      }

      const nextItems = candidates.slice(0, availableSlots);
      await Promise.all(nextItems.map(async (candidate) => {
        const current = getBatch(batchId);
        if (!current || current.status !== 'running') {
          return;
        }

        let attempt = candidate.attemptCount;
        let correctionHints = [...candidate.correctionHints];
        const maxAttempts = current.policySnapshot.retryPolicy.maxAttemptsPerPass;

        while (attempt < maxAttempts) {
          let generatedImage: LookdevImageArtifact | null = null;
          let evaluation: LookdevEvaluationResult | null = null;
          attempt += 1;
          mutateBatch(batchId, (batchState) => updateBatchCounts({
            ...batchState,
            items: batchState.items.map((item) => item.itemId === candidate.itemId
              ? {
                  ...item,
                  status: 'generating',
                  attemptCount: attempt,
                  currentEvaluation: null,
                  lastErrorCode: null,
                  lastErrorMessage: null,
                  correctionHints,
                  updatedAt: nowIso(),
                }
              : item),
          }));

          try {
            const processingBatch = getBatch(batchId);
            if (!processingBatch) {
              return;
            }
            const processingItem = processingBatch.items.find((item) => item.itemId === candidate.itemId);
            if (!processingItem) {
              return;
            }
            const image = await generateLookdevItem({
              runtime,
              item: processingItem,
              policy: processingBatch.policySnapshot,
              worldStylePackSnapshot: processingBatch.worldStylePackSnapshot,
            });
            generatedImage = image;
            const nextEvaluation = await evaluateLookdevImage(runtime, processingItem, image, processingBatch.policySnapshot);
            evaluation = nextEvaluation;
            correctionHints = evaluation.passed ? [] : deriveCorrectionHints(evaluation);

            if (evaluation.passed) {
              mutateBatch(batchId, (batchState) => updateBatchCounts({
                ...batchState,
                items: batchState.items.map((item) => item.itemId === candidate.itemId
                  ? {
                      ...item,
                      status: 'auto_passed',
                      currentImage: image,
                      currentEvaluation: evaluation,
                      correctionHints: [],
                      updatedAt: nowIso(),
                    }
                : item),
                auditTrail: [createAuditEvent({
                  batchId,
                  kind: 'item_auto_passed',
                  scope: 'item',
                  severity: 'success',
                  itemId: candidate.itemId,
                  agentId: candidate.agentId,
                  agentDisplayName: processingItem.agentDisplayName,
                }), ...batchState.auditTrail],
              }));
              return;
            }

            const nextStatus = attempt >= maxAttempts ? 'auto_failed_exhausted' : 'auto_failed_retryable';
            const failureSummary = evaluation.failureReasons.join('; ') || evaluation.summary;
            const auditPrefix = nextStatus === 'auto_failed_exhausted'
              ? 'gate exhausted'
              : 'gated for retry';
            mutateBatch(batchId, (batchState) => updateBatchCounts({
              ...batchState,
              items: batchState.items.map((item) => item.itemId === candidate.itemId
                ? {
                    ...item,
                    status: nextStatus,
                    currentImage: image,
                    currentEvaluation: evaluation,
                    correctionHints,
                    lastErrorCode: nextStatus === 'auto_failed_exhausted' ? 'LOOKDEV_AUTO_GATE_EXHAUSTED' : null,
                    lastErrorMessage: failureSummary,
                    updatedAt: nowIso(),
                  }
                : item),
              auditTrail: [createAuditEvent({
                batchId,
                kind: nextStatus === 'auto_failed_exhausted' ? 'item_gated_exhausted' : 'item_gated_retryable',
                scope: 'item',
                severity: nextStatus === 'auto_failed_exhausted' ? 'error' : 'warning',
                itemId: candidate.itemId,
                agentId: candidate.agentId,
                agentDisplayName: processingItem.agentDisplayName,
                detail: failureSummary,
              }), ...batchState.auditTrail],
            }));
            if (nextStatus === 'auto_failed_retryable') {
              const latest = getBatch(batchId);
              if (!latest || latest.status !== 'running' || !latest.policySnapshot.retryPolicy.autoCorrectionHintsAllowed) {
                return;
              }
              continue;
            }
            return;
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const exhausted = attempt >= maxAttempts;
            const errorCode = message.startsWith('LOOKDEV_') ? message : 'LOOKDEV_PROCESSING_FAILED';
            mutateBatch(batchId, (batchState) => updateBatchCounts({
              ...batchState,
              items: batchState.items.map((item) => item.itemId === candidate.itemId
                ? {
                    ...item,
                    status: exhausted ? 'auto_failed_exhausted' : 'auto_failed_retryable',
                    currentImage: generatedImage,
                    currentEvaluation: evaluation,
                    lastErrorCode: errorCode,
                    lastErrorMessage: message,
                    correctionHints,
                    updatedAt: nowIso(),
                  }
                : item),
              auditTrail: [createAuditEvent({
                batchId,
                kind: 'item_processing_failed',
                scope: 'item',
                severity: exhausted ? 'error' : 'warning',
                itemId: candidate.itemId,
                agentId: candidate.agentId,
                agentDisplayName: candidate.agentDisplayName,
                detail: message,
              }), ...batchState.auditTrail],
            }));
            if (!exhausted) {
              const latest = getBatch(batchId);
              if (!latest || latest.status !== 'running' || !latest.policySnapshot.retryPolicy.autoCorrectionHintsAllowed) {
                return;
              }
              continue;
            }
          }
        }
      }));
    }
  })().finally(() => {
    batchLocks.delete(batchId);
  });

  batchLocks.set(batchId, runner);
  return runner;
}
