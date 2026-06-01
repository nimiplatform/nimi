// Generation batch (wave-9). A bounded scheduling/progress/cancellation/retry unit
// over individual generation runs. This is PURE app-local orchestration: it owns
// item lifecycle state, but the actual model call happens in ai/** (Runtime-routed).
// No provider/model appears here. Fail-closed rules:
//
//   - completing an item with no artifact ref is `artifact_missing`, not success.
//   - retrying past maxAttempts is `generation_retry_exhausted`.
//   - illegal state transitions are `generation_batch_state_conflict`.
//
// A generation-run record (ai/storybook-generation.ts) carries the provenance for a
// single attempt; the batch references those runs via `runRefs`.

import { mintId } from './ids.js';
import { type Result, ok, fail } from './failure.js';

export type GenerationItemKind = 'text' | 'image' | 'audio' | 'video';
export type GenerationItemState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export type GenerationBatchItem = {
  id: string;
  kind: GenerationItemKind;
  /** What this item targets (asset ref, chapter scope, node id, …). */
  targetRef: string;
  request: Record<string, unknown>;
  state: GenerationItemState;
  attempts: number;
  maxAttempts: number;
  /** app-local generation-run ids this item produced (one per attempt). */
  runRefs: string[];
  lastReason?: string;
  outputRef?: string;
};

export type GenerationBatchStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type GenerationBatch = {
  id: string;
  projectId: string;
  items: GenerationBatchItem[];
  status: GenerationBatchStatus;
  createdAt: string;
  updatedAt: string;
};

export type GenerationBatchProgress = {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  done: number;
  ratio: number;
};

export function createGenerationBatch(input: {
  projectId: string;
  items: { kind: GenerationItemKind; targetRef: string; request?: Record<string, unknown>; maxAttempts?: number }[];
  now: string;
}): Result<GenerationBatch> {
  if (input.items.length === 0) {
    return fail('generation_batch_invalid', 'A generation batch needs at least one item.', ['items']);
  }
  const items: GenerationBatchItem[] = input.items.map((spec) => {
    if (!spec.targetRef.trim()) throw new Error('item targetRef required');
    return {
      id: mintId('genitem'),
      kind: spec.kind,
      targetRef: spec.targetRef,
      request: spec.request ?? {},
      state: 'queued',
      attempts: 0,
      maxAttempts: Math.max(1, spec.maxAttempts ?? 2),
      runRefs: [],
    };
  });
  return ok({ id: mintId('genbatch'), projectId: input.projectId, items, status: 'pending', createdAt: input.now, updatedAt: input.now });
}

export function batchProgress(batch: GenerationBatch): GenerationBatchProgress {
  const count = (state: GenerationItemState) => batch.items.filter((item) => item.state === state).length;
  const total = batch.items.length;
  const succeeded = count('succeeded');
  const failed = count('failed');
  const cancelled = count('cancelled');
  const done = succeeded + failed + cancelled;
  return {
    total,
    queued: count('queued'),
    running: count('running'),
    succeeded,
    failed,
    cancelled,
    done,
    ratio: total === 0 ? 0 : done / total,
  };
}

/** Derive the batch status from its items. */
export function recomputeBatchStatus(batch: GenerationBatch): GenerationBatchStatus {
  const progress = batchProgress(batch);
  if (progress.running > 0 || (progress.queued > 0 && progress.done > 0)) return 'running';
  if (progress.done < progress.total) return progress.running > 0 ? 'running' : 'pending';
  if (progress.cancelled === progress.total) return 'cancelled';
  if (progress.failed > 0) return 'failed';
  return 'completed';
}

function updateItem(batch: GenerationBatch, itemId: string, update: (item: GenerationBatchItem) => Result<GenerationBatchItem>, now: string): Result<GenerationBatch> {
  const index = batch.items.findIndex((item) => item.id === itemId);
  if (index < 0) return fail('generation_batch_invalid', `Batch ${batch.id} has no item "${itemId}".`);
  const updated = update(batch.items[index] as GenerationBatchItem);
  if (!updated.ok) return updated;
  const items = batch.items.slice();
  items[index] = updated.value;
  const next: GenerationBatch = { ...batch, items, updatedAt: now };
  return ok({ ...next, status: recomputeBatchStatus(next) });
}

/** queued|failed -> running (a retry of a failed item re-enters running). */
export function startItem(batch: GenerationBatch, itemId: string, runRef: string, now: string): Result<GenerationBatch> {
  return updateItem(batch, itemId, (item) => {
    if (item.state !== 'queued' && item.state !== 'failed') {
      return fail('generation_batch_state_conflict', `Item ${item.id} is "${item.state}"; only queued/failed items can start.`);
    }
    if (item.attempts >= item.maxAttempts) {
      return fail('generation_retry_exhausted', `Item ${item.id} has used all ${item.maxAttempts} attempts.`);
    }
    return ok({ ...item, state: 'running', attempts: item.attempts + 1, runRefs: [...item.runRefs, runRef] });
  }, now);
}

/** running -> succeeded. A missing artifact ref is NOT success. */
export function completeItem(batch: GenerationBatch, itemId: string, outputRef: string, now: string): Result<GenerationBatch> {
  return updateItem(batch, itemId, (item) => {
    if (item.state !== 'running') {
      return fail('generation_batch_state_conflict', `Item ${item.id} is "${item.state}"; only a running item can complete.`);
    }
    if (!outputRef.trim()) {
      return fail('artifact_missing', `Item ${item.id} produced no artifact ref — missing generation is not success.`);
    }
    return ok({ ...item, state: 'succeeded', outputRef, lastReason: undefined });
  }, now);
}

/** running -> failed (retry-eligible until attempts hit maxAttempts). */
export function failItem(batch: GenerationBatch, itemId: string, reason: string, now: string): Result<GenerationBatch> {
  return updateItem(batch, itemId, (item) => {
    if (item.state !== 'running') {
      return fail('generation_batch_state_conflict', `Item ${item.id} is "${item.state}"; only a running item can fail.`);
    }
    return ok({ ...item, state: 'failed', lastReason: reason });
  }, now);
}

/** failed -> queued, when retries remain. */
export function retryItem(batch: GenerationBatch, itemId: string, now: string): Result<GenerationBatch> {
  return updateItem(batch, itemId, (item) => {
    if (item.state !== 'failed') {
      return fail('generation_batch_state_conflict', `Item ${item.id} is "${item.state}"; only a failed item can be retried.`);
    }
    if (item.attempts >= item.maxAttempts) {
      return fail('generation_retry_exhausted', `Item ${item.id} exhausted ${item.maxAttempts} attempts; no retry remains.`);
    }
    return ok({ ...item, state: 'queued', lastReason: undefined });
  }, now);
}

/** Cancel a single non-terminal item. */
export function cancelItem(batch: GenerationBatch, itemId: string, now: string): Result<GenerationBatch> {
  return updateItem(batch, itemId, (item) => {
    if (item.state === 'succeeded' || item.state === 'cancelled') {
      return fail('generation_batch_state_conflict', `Item ${item.id} is already "${item.state}".`);
    }
    return ok({ ...item, state: 'cancelled' });
  }, now);
}

/** Cancel every non-terminal item; the batch becomes cancelled if nothing succeeded. */
export function cancelBatch(batch: GenerationBatch, now: string): GenerationBatch {
  const items = batch.items.map((item) =>
    item.state === 'queued' || item.state === 'running' || item.state === 'failed'
      ? { ...item, state: 'cancelled' as const }
      : item,
  );
  const next: GenerationBatch = { ...batch, items, updatedAt: now };
  return { ...next, status: recomputeBatchStatus(next) };
}
