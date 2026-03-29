import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { getPlatformClient } from '@nimiplatform/sdk';
import type { Runtime } from '@nimiplatform/sdk/runtime';
import { createLookdevImageUpload, finalizeLookdevResource, getAgentPortraitBinding, getLookdevAgent, upsertAgentPortraitBinding, type LookdevAgentRecord } from '@renderer/data/lookdev-data-client.js';
import { createDefaultPolicySnapshot, createDefaultWorldStylePack, type LookdevBatch, type LookdevBatchStatus, type LookdevEvaluationResult, type LookdevImageArtifact, type LookdevItem, type LookdevItemStatus, type LookdevPolicySnapshot, type LookdevPortraitBrief, type LookdevSelectionSource, type LookdevWorldStylePack } from './types.js';
import { buildEvaluationSystemPrompt, buildGenerationPrompt, compilePortraitBrief } from './prompting.js';
import { deriveCorrectionHints, parseEvaluationJson, validateEvaluation } from './evaluation.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';

type CreateBatchInput = {
  name: string;
  selectionSource: LookdevSelectionSource;
  agents: LookdevAgentRecord[];
  worldId?: string;
  worldStylePack: LookdevWorldStylePack;
  captureSelectionAgentIds: string[];
  maxConcurrency?: number;
  scoreThreshold?: number;
};

type LookdevStoreState = {
  batches: LookdevBatch[];
  worldStylePacks: Record<string, LookdevWorldStylePack>;
  portraitBriefs: Record<string, LookdevPortraitBrief>;
  createBatch(input: CreateBatchInput): Promise<string>;
  saveWorldStylePack(pack: LookdevWorldStylePack): void;
  savePortraitBrief(brief: LookdevPortraitBrief): void;
  pauseBatch(batchId: string): void;
  resumeBatch(batchId: string): Promise<void>;
  resumeActiveBatches(): Promise<void>;
  rerunFailed(batchId: string, itemIds?: string[]): Promise<void>;
  commitBatch(batchId: string): Promise<void>;
  selectItem(batchId: string, itemId: string): void;
};

const batchLocks = new Map<string, Promise<void>>();

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
  return `${String(worldId || 'unscoped').trim() || 'unscoped'}::${agentId}`;
}

function cloneBatch(batch: LookdevBatch): LookdevBatch {
  return JSON.parse(JSON.stringify(batch)) as LookdevBatch;
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

function normalizeArtifact(result: Awaited<ReturnType<Runtime['media']['image']['generate']>>, prompt: string): LookdevImageArtifact {
  const artifact = result.artifacts[0];
  if (!artifact) {
    throw new Error('LOOKDEV_IMAGE_ARTIFACT_MISSING');
  }
  const artifactRecord = artifact as unknown as Record<string, unknown>;
  let url = String(artifactRecord.url || artifact.uri || '').trim();
  if (!url && artifact.bytes && artifact.bytes.length > 0) {
    let binary = '';
    for (const byte of artifact.bytes) {
      binary += String.fromCharCode(byte);
    }
    const mimeType = String(artifact.mimeType || 'image/png').trim() || 'image/png';
    url = `data:${mimeType};base64,${globalThis.btoa(binary)}`;
  }
  if (!url) {
    throw new Error('LOOKDEV_IMAGE_URL_MISSING');
  }
  return {
    url,
    mimeType: String(artifact.mimeType || 'image/png').trim() || 'image/png',
    width: artifact.width || undefined,
    height: artifact.height || undefined,
    traceId: String(result.trace?.traceId || '').trim() || undefined,
    artifactId: String(artifact.artifactId || '').trim() || undefined,
    promptSnapshot: prompt,
    createdAt: nowIso(),
  };
}

async function evaluateImage(runtime: Runtime, item: LookdevItem, image: LookdevImageArtifact, policy: LookdevPolicySnapshot): Promise<LookdevEvaluationResult> {
  const readiness = useAppStore.getState().runtimeProbe;
  if (!readiness.visionModelId || !readiness.visionConnectorId) {
    throw new Error('LOOKDEV_VISION_TARGET_MISSING');
  }
  const response = await runtime.ai.text.generate({
    model: readiness.visionModelId,
    connectorId: readiness.visionConnectorId,
    route: 'cloud',
    system: buildEvaluationSystemPrompt(policy.autoEvalPolicy.scoreThreshold),
    input: [{
      role: 'user',
      content: [
        { type: 'text', text: `Evaluate ${item.agentDisplayName} portrait candidate.` },
        { type: 'image_url', imageUrl: image.url, detail: 'high' },
      ],
    }],
    temperature: 0,
    maxTokens: 600,
  });
  const parsed = parseEvaluationJson(response.text);
  return validateEvaluation(parsed, policy.autoEvalPolicy.scoreThreshold);
}

async function generateItem(runtime: Runtime, item: LookdevItem, policy: LookdevPolicySnapshot): Promise<LookdevImageArtifact> {
  const readiness = useAppStore.getState().runtimeProbe;
  if (!readiness.imageModelId || !readiness.imageConnectorId) {
    throw new Error('LOOKDEV_IMAGE_TARGET_MISSING');
  }
  const batch = getBatch(item.batchId);
  if (!batch) {
    throw new Error('LOOKDEV_BATCH_NOT_FOUND');
  }
  const prompt = buildGenerationPrompt(item, policy, batch.worldStylePackSnapshot);
  const referenceImages = [
    item.referenceImageUrl,
    item.existingPortraitUrl,
  ].filter((value): value is string => Boolean(value));

  const response = await runtime.media.image.generate({
    model: readiness.imageModelId,
    connectorId: readiness.imageConnectorId,
    route: 'cloud',
    prompt,
    negativePrompt: policy.generationPolicy.negativePrompt,
    aspectRatio: policy.generationPolicy.aspectRatio,
    style: policy.generationPolicy.style,
    n: 1,
    referenceImages,
    responseFormat: 'url',
  });
  return normalizeArtifact(response, prompt);
}

async function uploadResourceForItem(item: LookdevItem, batch: LookdevBatch): Promise<string> {
  if (!item.currentImage) {
    throw new Error('LOOKDEV_COMMIT_IMAGE_MISSING');
  }
  const upload = await createLookdevImageUpload();
  const response = await fetch(item.currentImage.url);
  const blob = await response.blob();
  let uploadResponse = await fetch(upload.uploadUrl, {
    method: 'PUT',
    body: blob,
    headers: { 'Content-Type': blob.type || item.currentImage.mimeType || 'image/png' },
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
    mimeType: blob.type || item.currentImage.mimeType || 'image/png',
    width: item.currentImage.width,
    height: item.currentImage.height,
    traceId: item.currentImage.traceId,
    sourceArtifactId: item.currentImage.artifactId,
    title: `${item.agentDisplayName} portrait`,
    tags: ['lookdev', 'agent-portrait', batch.batchId],
  });
  return String(finalized.id || upload.resourceId).trim();
}

function mutateBatch(batchId: string, updater: (batch: LookdevBatch) => LookdevBatch): void {
  useLookdevStore.setState((state) => ({
    batches: state.batches.map((batch) => batch.batchId === batchId ? updater(batch) : batch),
  }));
}

function getBatch(batchId: string): LookdevBatch | null {
  return useLookdevStore.getState().batches.find((batch) => batch.batchId === batchId) ?? null;
}

async function runBatchProcessing(batchId: string): Promise<void> {
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
          auditTrail: [`${nowIso()} Processing complete`, ...current.auditTrail],
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
            const image = await generateItem(runtime, processingItem, processingBatch.policySnapshot);
            const evaluation = await evaluateImage(runtime, processingItem, image, processingBatch.policySnapshot);
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
                auditTrail: [`${nowIso()} ${processingItem.agentDisplayName} auto-passed`, ...batchState.auditTrail],
              }));
              return;
            }

            const nextStatus = attempt >= maxAttempts ? 'auto_failed_exhausted' : 'auto_failed_retryable';
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
                    lastErrorMessage: evaluation.failureReasons.join('; ') || evaluation.summary,
                    updatedAt: nowIso(),
                  }
                : item),
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
            mutateBatch(batchId, (batchState) => updateBatchCounts({
              ...batchState,
              items: batchState.items.map((item) => item.itemId === candidate.itemId
                ? {
                    ...item,
                    status: exhausted ? 'auto_failed_exhausted' : 'auto_failed_retryable',
                    lastErrorCode: 'LOOKDEV_PROCESSING_FAILED',
                    lastErrorMessage: message,
                    correctionHints,
                    updatedAt: nowIso(),
                  }
                : item),
              auditTrail: [`${nowIso()} ${candidate.agentDisplayName} failed: ${message}`, ...batchState.auditTrail],
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

export const useLookdevStore = create<LookdevStoreState>()(
  persist(
    (set, get) => ({
      batches: [],
      worldStylePacks: {},
      portraitBriefs: {},

      saveWorldStylePack(pack) {
        const timestamp = nowIso();
        set((state) => ({
          worldStylePacks: {
            ...state.worldStylePacks,
            [pack.worldId]: {
              ...pack,
              updatedAt: timestamp,
              createdAt: state.worldStylePacks[pack.worldId]?.createdAt || pack.createdAt || timestamp,
            },
          },
        }));
      },

      savePortraitBrief(brief) {
        const key = portraitBriefKey(brief.worldId, brief.agentId);
        const timestamp = nowIso();
        set((state) => ({
          portraitBriefs: {
            ...state.portraitBriefs,
            [key]: {
              ...brief,
              updatedAt: timestamp,
            },
          },
        }));
      },

      async createBatch(input) {
        if (input.agents.length === 0) {
          throw new Error('LOOKDEV_BATCH_AGENTS_REQUIRED');
        }
        const batchId = createId('lookdev-batch');
        const createdAt = nowIso();
        const policy = createDefaultPolicySnapshot();
        policy.maxConcurrency = Math.max(1, Math.min(4, Number(input.maxConcurrency || 1)));
        if (Number.isFinite(Number(input.scoreThreshold))) {
          policy.autoEvalPolicy.scoreThreshold = Math.max(1, Math.min(100, Number(input.scoreThreshold)));
        }

        const detailedAgents = await Promise.all(input.agents.map(async (agent) => {
          const detail = await getLookdevAgent(agent.id);
          const currentPortrait = agent.worldId
            ? await getAgentPortraitBinding(agent.worldId, agent.id).catch(() => null)
            : null;
          return {
            ...agent,
            ...detail,
            currentPortrait,
          };
        }));

        const resolvedWorldId = input.worldId || detailedAgents[0]?.worldId || '';
        const worldIds = [...new Set(detailedAgents.map((agent) => agent.worldId).filter(Boolean))];
        if (worldIds.length !== 1 || !resolvedWorldId) {
          throw new Error('LOOKDEV_BATCH_SINGLE_WORLD_REQUIRED');
        }

        const selectedAgentIds = new Set(detailedAgents.map((agent) => agent.id));
        const captureSelectionAgentIds = [...new Set((input.captureSelectionAgentIds || []).filter((agentId) => selectedAgentIds.has(agentId)))];
        const worldStylePack = {
          ...(input.worldStylePack || createDefaultWorldStylePack(resolvedWorldId, resolvedWorldId || 'Selected world')),
          worldId: resolvedWorldId,
          updatedAt: createdAt,
        };
        get().saveWorldStylePack(worldStylePack);

        const portraitBriefs = detailedAgents.map((agent) => {
          const briefKey = portraitBriefKey(agent.worldId, agent.id);
          const existingBrief = get().portraitBriefs[briefKey];
          const nextBrief = existingBrief && existingBrief.worldId === agent.worldId
            ? existingBrief
            : compilePortraitBrief({
                agentId: agent.id,
                displayName: agent.displayName,
                worldId: agent.worldId,
                concept: agent.concept,
                description: agent.description,
                worldStylePack,
              });
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
          auditTrail: [`${createdAt} Batch created with ${detailedAgents.length} items`],
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
            portraitBrief: portraitBriefs.find((brief) => brief.agentId === agent.id && brief.worldId === agent.worldId)
              || portraitBriefs.find((brief) => brief.agentId === agent.id)
              || compilePortraitBrief({
                agentId: agent.id,
                displayName: agent.displayName,
                worldId: agent.worldId,
                concept: agent.concept,
                description: agent.description,
                worldStylePack,
              }),
            worldId: agent.worldId,
            status: 'pending',
            attemptCount: 0,
            currentImage: null,
            currentEvaluation: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            correctionHints: [],
            existingPortraitUrl: agent.currentPortrait?.url || null,
            referenceImageUrl: agent.currentPortrait?.url || agent.avatarUrl || null,
            committedAt: null,
            createdAt,
            updatedAt: createdAt,
          })),
        };

        batch.selectedItemId = batch.items[0]?.itemId || null;
        set((state) => ({ batches: [updateBatchCounts(batch), ...state.batches] }));
        await runBatchProcessing(batchId);
        return batchId;
      },

      pauseBatch(batchId) {
        mutateBatch(batchId, (batch) => ({
          ...batch,
          status: 'paused',
          auditTrail: [`${nowIso()} Batch paused`, ...batch.auditTrail],
          updatedAt: nowIso(),
        }));
      },

      async resumeBatch(batchId) {
        mutateBatch(batchId, (batch) => ({
          ...batch,
          status: 'running',
          processingCompletedAt: null,
          auditTrail: [`${nowIso()} Batch resumed`, ...batch.auditTrail],
          updatedAt: nowIso(),
        }));
        await runBatchProcessing(batchId);
      },

      async resumeActiveBatches() {
        const active = get().batches.filter((batch) => batch.status === 'running');
        for (const batch of active) {
          await runBatchProcessing(batch.batchId);
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
            auditTrail: [`${nowIso()} Manual rerun queued for ${selected.size} items`, ...batch.auditTrail],
          });
        });
        await runBatchProcessing(batchId);
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
            }));
          }
        }
        mutateBatch(batchId, (state) => updateBatchCounts({
          ...state,
          status: 'commit_complete' as LookdevBatchStatus,
          commitCompletedAt: nowIso(),
          auditTrail: [`${nowIso()} Commit run complete`, ...state.auditTrail],
        }));
      },

      selectItem(batchId, itemId) {
        mutateBatch(batchId, (batch) => ({
          ...batch,
          selectedItemId: itemId,
          updatedAt: nowIso(),
        }));
      },
    }),
    {
      name: 'lookdev-workspace-formal',
      partialize: (state) => ({
        batches: state.batches,
        worldStylePacks: state.worldStylePacks,
        portraitBriefs: state.portraitBriefs,
      }),
    },
  ),
);
