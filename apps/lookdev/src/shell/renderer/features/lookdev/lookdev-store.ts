import { create } from 'zustand';
import { getAgentPortraitBinding, getLookdevAgentAuthoringContext, upsertAgentPortraitBinding, type LookdevAgentRecord } from '@renderer/data/lookdev-data-client.js';
import { createDefaultPolicySnapshot, type LookdevBatch, type LookdevBatchStatus, type LookdevCaptureState, type LookdevItemStatus, type LookdevPolicySnapshot, type LookdevPortraitBrief, type LookdevSelectionSource, type LookdevWorldStylePack, type LookdevWorldStyleSession } from './types.js';
import { createCaptureStateKey, materializePortraitBriefFromCaptureState } from './capture-harness.js';
import { createAuditEvent } from './lookdev-processing.js';
import {
  createEmptyLookdevWorkspace,
  loadLookdevWorkspaceForUser,
  persistLookdevWorkspaceForUser,
  type PersistedLookdevWorkspace,
} from './lookdev-workspace-storage.js';
import {
  recoverInterruptedBatch,
  runBatchProcessing,
  uploadResourceForItem,
} from './lookdev-store-processing.js';

export type CreateBatchInput = {
  name: string;
  selectionSource: LookdevSelectionSource;
  agents: LookdevAgentRecord[];
  worldId?: string;
  worldStylePack: LookdevWorldStylePack;
  captureSelectionAgentIds: string[];
  generationTarget: LookdevPolicySnapshot['generationTarget'];
  evaluationTarget: LookdevPolicySnapshot['evaluationTarget'];
  maxConcurrency?: number;
  scoreThreshold?: number;
};

type LookdevStoreState = {
  batches: LookdevBatch[];
  worldStyleSessions: Record<string, LookdevWorldStyleSession>;
  worldStylePacks: Record<string, LookdevWorldStylePack>;
  captureStates: Record<string, LookdevCaptureState>;
  portraitBriefs: Record<string, LookdevPortraitBrief>;
  storageUserId: string;
  hydrateForUser(userId: string): void;
  clearHydratedWorkspace(): void;
  createBatch(input: CreateBatchInput): Promise<string>;
  saveWorldStyleSession(session: LookdevWorldStyleSession): void;
  saveWorldStylePack(pack: LookdevWorldStylePack): void;
  saveCaptureState(state: LookdevCaptureState): void;
  savePortraitBrief(brief: LookdevPortraitBrief): void;
  deleteBatch(batchId: string): void;
  pauseBatch(batchId: string): void;
  resumeBatch(batchId: string): Promise<void>;
  resumeActiveBatches(): Promise<void>;
  rerunFailed(batchId: string, itemIds?: string[]): Promise<void>;
  commitBatch(batchId: string): Promise<void>;
  selectItem(batchId: string, itemId: string): void;
};

function createEmptyWorkspaceState() {
  return {
    ...createEmptyLookdevWorkspace(),
    storageUserId: '',
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `${prefix}-${globalThis.crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function portraitBriefKey(worldId: string | null | undefined, agentId: string): string {
  return createCaptureStateKey(worldId, agentId);
}

function cloneBatch(batch: LookdevBatch): LookdevBatch {
  return JSON.parse(JSON.stringify(batch)) as LookdevBatch;
}

function partializeWorkspace(state: Pick<
  LookdevStoreState,
  'batches' | 'worldStyleSessions' | 'worldStylePacks' | 'captureStates' | 'portraitBriefs'
>): PersistedLookdevWorkspace {
  return {
    batches: state.batches,
    worldStyleSessions: state.worldStyleSessions,
    worldStylePacks: state.worldStylePacks,
    captureStates: state.captureStates,
    portraitBriefs: state.portraitBriefs,
  };
}

function persistWorkspaceSnapshot(state: Pick<
  LookdevStoreState,
  'storageUserId' | 'batches' | 'worldStyleSessions' | 'worldStylePacks' | 'captureStates' | 'portraitBriefs'
>): void {
  const userId = String(state.storageUserId || '').trim();
  if (!userId) {
    return;
  }
  persistLookdevWorkspaceForUser(userId, partializeWorkspace(state));
}

function updateBatchCounts(batch: LookdevBatch): LookdevBatch {
  const next = cloneBatch(batch);
  next.totalItems = next.items.length;
  next.captureSelectedItems = next.items.filter((item) => item.captureMode === 'capture').length;
  next.passedItems = next.items.filter((item) => item.status === 'auto_passed' || item.status === 'committed').length;
  next.failedItems = next.items.filter((item) => item.status === 'auto_failed_retryable' || item.status === 'auto_failed_exhausted' || item.status === 'commit_failed').length;
  next.committedItems = next.items.filter((item) => item.status === 'committed').length;
  next.commitFailedItems = next.items.filter((item) => item.status === 'commit_failed').length;
  next.updatedAt = nowIso();
  return next;
}

function statusIsFailed(status: LookdevItemStatus): boolean {
  return status === 'auto_failed_retryable' || status === 'auto_failed_exhausted';
}

function mutateBatch(batchId: string, updater: (batch: LookdevBatch) => LookdevBatch): void {
  useLookdevStore.setState((state) => {
    const nextState = {
      batches: state.batches.map((batch) => batch.batchId === batchId ? updater(batch) : batch),
    };
    persistWorkspaceSnapshot({ ...state, ...nextState });
    return nextState;
  });
}

function getBatch(batchId: string): LookdevBatch | null {
  return useLookdevStore.getState().batches.find((batch) => batch.batchId === batchId) ?? null;
}

export const useLookdevStore = create<LookdevStoreState>((set, get) => ({
      ...createEmptyWorkspaceState(),

      hydrateForUser(userId) {
        const normalizedUserId = String(userId || '').trim();
        const workspace = loadLookdevWorkspaceForUser(normalizedUserId);
        set({
          ...createEmptyWorkspaceState(),
          ...workspace,
          storageUserId: normalizedUserId,
        });
        persistWorkspaceSnapshot({
          ...get(),
          ...workspace,
          storageUserId: normalizedUserId,
        });
      },

      clearHydratedWorkspace() {
        set(createEmptyWorkspaceState());
      },

      saveWorldStyleSession(session) {
        set((state) => {
          const nextState = {
            worldStyleSessions: {
            ...state.worldStyleSessions,
            [session.worldId]: session,
            },
          };
          persistWorkspaceSnapshot({ ...state, ...nextState });
          return nextState;
        });
      },

      saveWorldStylePack(pack) {
        const timestamp = nowIso();
        set((state) => {
          const nextState = {
            worldStylePacks: {
            ...state.worldStylePacks,
            [pack.worldId]: {
              ...pack,
              updatedAt: timestamp,
              createdAt: state.worldStylePacks[pack.worldId]?.createdAt || pack.createdAt || timestamp,
            },
            },
          };
          persistWorkspaceSnapshot({ ...state, ...nextState });
          return nextState;
        });
      },

      saveCaptureState(state) {
        const key = createCaptureStateKey(state.worldId, state.agentId);
        const timestamp = nowIso();
        set((current) => {
          const nextState = {
            captureStates: {
            ...current.captureStates,
            [key]: {
              ...state,
              updatedAt: timestamp,
              createdAt: current.captureStates[key]?.createdAt || state.createdAt || timestamp,
            },
            },
          };
          persistWorkspaceSnapshot({ ...current, ...nextState });
          return nextState;
        });
      },

      savePortraitBrief(brief) {
        const key = portraitBriefKey(brief.worldId, brief.agentId);
        const timestamp = nowIso();
        set((state) => {
          const nextState = {
            portraitBriefs: {
            ...state.portraitBriefs,
            [key]: {
              ...brief,
              updatedAt: timestamp,
            },
            },
          };
          persistWorkspaceSnapshot({ ...state, ...nextState });
          return nextState;
        });
      },

      deleteBatch(batchId) {
        const batch = get().batches.find((entry) => entry.batchId === batchId);
        if (!batch) {
          return;
        }
        if (batch.status === 'running') {
          throw new Error('LOOKDEV_BATCH_DELETE_RUNNING_FORBIDDEN');
        }
        set((state) => {
          const nextState = {
            batches: state.batches.filter((entry) => entry.batchId !== batchId),
          };
          persistWorkspaceSnapshot({ ...state, ...nextState });
          return nextState;
        });
      },

      async createBatch(input) {
        if (input.agents.length === 0) {
          throw new Error('LOOKDEV_BATCH_AGENTS_REQUIRED');
        }
        const batchId = createId('lookdev-batch');
        const createdAt = nowIso();
        const policy = createDefaultPolicySnapshot({
          generationTarget: input.generationTarget,
          evaluationTarget: input.evaluationTarget,
        });
        policy.maxConcurrency = Math.max(1, Math.min(4, Number(input.maxConcurrency || 1)));
        if (Number.isFinite(Number(input.scoreThreshold))) {
          policy.autoEvalPolicy.scoreThreshold = Math.max(1, Math.min(100, Number(input.scoreThreshold)));
        }

        const detailedAgents = await Promise.all(input.agents.map(async (agent) => {
          const authoringContext = agent.worldId
            ? await getLookdevAgentAuthoringContext(agent.worldId, agent.id).catch(() => null)
            : null;
          const currentPortrait = agent.worldId
            ? await getAgentPortraitBinding(agent.worldId, agent.id).catch(() => null)
            : null;
          return {
            ...agent,
            description: authoringContext?.detail?.description ?? agent.description ?? null,
            scenario: authoringContext?.detail?.scenario ?? agent.scenario ?? null,
            greeting: authoringContext?.detail?.greeting ?? agent.greeting ?? null,
            currentPortrait,
          };
        }));

        const resolvedWorldId = input.worldId || detailedAgents[0]?.worldId || '';
        const worldIds = [...new Set(detailedAgents.map((agent) => agent.worldId).filter(Boolean))];
        if (worldIds.length !== 1 || !resolvedWorldId) {
          throw new Error('LOOKDEV_BATCH_SINGLE_WORLD_REQUIRED');
        }

        if (input.worldStylePack.status !== 'confirmed') {
          throw new Error('LOOKDEV_STYLE_PACK_CONFIRMATION_REQUIRED');
        }

        const selectedAgentIds = new Set(detailedAgents.map((agent) => agent.id));
        const captureSelectionAgentIds = [...new Set((input.captureSelectionAgentIds || []).filter((agentId) => selectedAgentIds.has(agentId)))];
        const worldStylePack = {
          ...input.worldStylePack,
          worldId: resolvedWorldId,
          updatedAt: createdAt,
        };
        get().saveWorldStylePack(worldStylePack);

        const captureStates = detailedAgents.map((agent) => {
          const captureKey = createCaptureStateKey(agent.worldId, agent.id);
          const existingCaptureState = get().captureStates[captureKey];
          if (!existingCaptureState) {
            throw new Error('LOOKDEV_CAPTURE_STATE_MISSING');
          }
          return existingCaptureState;
        });

        const portraitBriefs = captureStates.map((captureState) => {
          const nextBrief = materializePortraitBriefFromCaptureState(captureState);
          get().savePortraitBrief(nextBrief);
          return nextBrief;
        });

        const batch: LookdevBatch = {
          batchId,
          name: input.name.trim() || `Lookdev ${new Date().toLocaleDateString()}`,
          status: 'running',
          selectionSnapshot: {
            selectionSource: input.selectionSource,
            agentIds: detailedAgents.map((agent) => agent.id),
            captureSelectionAgentIds,
            worldId: resolvedWorldId || undefined,
          },
          worldStylePackSnapshot: {
            ...worldStylePack,
            updatedAt: createdAt,
          },
          policySnapshot: policy,
          totalItems: detailedAgents.length,
          captureSelectedItems: 0,
          passedItems: 0,
          failedItems: 0,
          committedItems: 0,
          commitFailedItems: 0,
          createdAt,
          updatedAt: createdAt,
          processingCompletedAt: null,
          commitCompletedAt: null,
          selectedItemId: null,
          auditTrail: [createAuditEvent({
            batchId,
            kind: 'batch_created',
            scope: 'batch',
            severity: 'info',
            count: detailedAgents.length,
            occurredAt: createdAt,
          })],
          items: detailedAgents.map((agent) => ({
            itemId: createId('lookdev-item'),
            batchId,
            agentId: agent.id,
            agentHandle: agent.handle,
            agentDisplayName: agent.displayName,
            agentConcept: agent.concept,
            agentDescription: agent.description,
            importance: agent.importance,
            captureMode: captureSelectionAgentIds.includes(agent.id) ? 'capture' : 'batch_only',
            captureStateSnapshot: captureStates.find((state) => state.agentId === agent.id && state.worldId === agent.worldId)
              || captureStates.find((state) => state.agentId === agent.id)
              || (() => {
                throw new Error('LOOKDEV_CAPTURE_STATE_MISSING');
              })(),
            portraitBrief: portraitBriefs.find((brief) => brief.agentId === agent.id && brief.worldId === agent.worldId)
              || portraitBriefs.find((brief) => brief.agentId === agent.id)
              || (() => {
                throw new Error('LOOKDEV_PORTRAIT_BRIEF_MISSING');
              })(),
            worldId: agent.worldId,
            status: 'pending',
            attemptCount: 0,
            currentImage: null,
            currentEvaluation: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            correctionHints: [],
            existingPortraitUrl: agent.currentPortrait?.url || null,
            // Only canonical portrait bindings are valid reference images for lookdev generation.
            // Generic avatars may be placeholders or non-portable assets and must not be sent
            // downstream as image-generation references.
            referenceImageUrl: agent.currentPortrait?.url || null,
            committedAt: null,
            createdAt,
            updatedAt: createdAt,
          })),
        };

        batch.selectedItemId = batch.items[0]?.itemId || null;
        set((state) => {
          const nextState = { batches: [updateBatchCounts(batch), ...state.batches] };
          persistWorkspaceSnapshot({ ...state, ...nextState });
          return nextState;
        });
        void runBatchProcessing(batchId, mutateBatch, getBatch, updateBatchCounts);
        return batchId;
      },

      pauseBatch(batchId) {
        mutateBatch(batchId, (batch) => {
          if (batch.status !== 'running') {
            return batch;
          }
          return {
            ...batch,
            status: 'paused',
            auditTrail: [createAuditEvent({
              batchId,
              kind: 'batch_paused',
              scope: 'batch',
              severity: 'warning',
            }), ...batch.auditTrail],
            updatedAt: nowIso(),
          };
        });
      },

      async resumeBatch(batchId) {
        const current = getBatch(batchId);
        if (!current || current.status !== 'paused') {
          return;
        }
        mutateBatch(batchId, (batch) => ({
          ...batch,
          status: 'running',
          processingCompletedAt: null,
          auditTrail: [createAuditEvent({
            batchId,
            kind: 'batch_resumed',
            scope: 'batch',
            severity: 'info',
          }), ...batch.auditTrail],
          updatedAt: nowIso(),
        }));
        await runBatchProcessing(batchId, mutateBatch, getBatch, updateBatchCounts);
      },

      async resumeActiveBatches() {
        const active = get().batches
          .filter((batch) => batch.status === 'running')
          .map((batch) => {
            const recovered = recoverInterruptedBatch(batch, updateBatchCounts);
            if (recovered === batch) {
              return batch;
            }
            mutateBatch(batch.batchId, () => recovered);
            return recovered;
          });
        for (const batch of active) {
          await runBatchProcessing(batch.batchId, mutateBatch, getBatch, updateBatchCounts);
        }
      },

      async rerunFailed(batchId, itemIds) {
        mutateBatch(batchId, (batch) => {
          if (batch.status !== 'processing_complete') {
            return batch;
          }
          const selected = new Set(itemIds ?? batch.items.filter((item) => statusIsFailed(item.status)).map((item) => item.itemId));
          return updateBatchCounts({
            ...batch,
            status: 'running',
            processingCompletedAt: null,
            items: batch.items.map((item) => selected.has(item.itemId)
              ? {
                  ...item,
                  status: 'pending',
                  attemptCount: 0,
                  currentEvaluation: null,
                  lastErrorCode: null,
                  lastErrorMessage: null,
                  correctionHints: [],
                  updatedAt: nowIso(),
                }
              : item),
            auditTrail: [createAuditEvent({
              batchId,
              kind: 'rerun_queued',
              scope: 'batch',
              severity: 'info',
              count: selected.size,
            }), ...batch.auditTrail],
          });
        });
        await runBatchProcessing(batchId, mutateBatch, getBatch, updateBatchCounts);
      },

      async commitBatch(batchId) {
        const batch = getBatch(batchId);
        if (!batch || batch.status !== 'processing_complete') {
          return;
        }
        const commitTargets = batch.items.filter((item) => item.status === 'auto_passed');
        for (const item of commitTargets) {
          try {
            if (!item.worldId) {
              throw new Error('LOOKDEV_AGENT_WORLD_ID_REQUIRED');
            }
            const resourceId = await uploadResourceForItem(item, batch);
            await upsertAgentPortraitBinding({
              worldId: item.worldId,
              agentId: item.agentId,
              resourceId,
              intentPrompt: item.currentImage?.promptSnapshot,
            });
            mutateBatch(batchId, (state) => updateBatchCounts({
              ...state,
              items: state.items.map((entry) => entry.itemId === item.itemId
                ? {
                    ...entry,
                    status: 'committed',
                    committedAt: nowIso(),
                    updatedAt: nowIso(),
                  }
                : entry),
              auditTrail: [createAuditEvent({
                batchId,
                kind: 'item_committed',
                scope: 'item',
                severity: 'success',
                itemId: item.itemId,
                agentId: item.agentId,
                agentDisplayName: item.agentDisplayName,
                detail: batch.policySnapshot.writebackPolicy.bindingPoint,
              }), ...state.auditTrail],
            }));
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            mutateBatch(batchId, (state) => updateBatchCounts({
              ...state,
              items: state.items.map((entry) => entry.itemId === item.itemId
                ? {
                    ...entry,
                    status: 'commit_failed',
                    lastErrorCode: 'LOOKDEV_COMMIT_FAILED',
                    lastErrorMessage: message,
                    updatedAt: nowIso(),
                  }
                : entry),
              auditTrail: [createAuditEvent({
                batchId,
                kind: 'item_commit_failed',
                scope: 'item',
                severity: 'error',
                itemId: item.itemId,
                agentId: item.agentId,
                agentDisplayName: item.agentDisplayName,
                detail: message,
              }), ...state.auditTrail],
            }));
          }
        }
        mutateBatch(batchId, (state) => updateBatchCounts({
          ...state,
          status: 'commit_complete' as LookdevBatchStatus,
          commitCompletedAt: nowIso(),
          auditTrail: [createAuditEvent({
            batchId,
            kind: 'commit_complete',
            scope: 'batch',
            severity: 'success',
          }), ...state.auditTrail],
        }));
      },

      selectItem(batchId, itemId) {
        mutateBatch(batchId, (batch) => ({
          ...batch,
          selectedItemId: itemId,
          updatedAt: nowIso(),
        }));
      },
}));
