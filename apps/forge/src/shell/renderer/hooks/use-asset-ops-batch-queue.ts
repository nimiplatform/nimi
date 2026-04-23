import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import {
  WORLD_DELIVERABLE_REGISTRY,
  type WorldDeliverableFamily,
} from '@renderer/features/asset-ops/deliverable-registry.js';
import type { WorldDeliverableStatus } from '@renderer/hooks/use-world-queries.js';
import type { WorldOwnedAgentRoster, WorldOwnedAgentRosterItem } from '@renderer/hooks/use-agent-queries.js';
import type { AgentDraftState, WorldDraftState } from '@renderer/features/workbench/types.js';
import { generateEntityImage, uploadImageToCloudflare } from '@renderer/data/image-gen-client.js';
import { generateAgentCopyCompletion, synthesizeVoiceDemo } from '@renderer/data/enrichment-client.js';
import { queueWorldAssetCandidate } from '@renderer/state/world-asset-ops-store.js';
import { queueAgentAssetCandidate, selectAgentAssetOpsCandidates, useAgentAssetOpsStore } from '@renderer/state/agent-asset-ops-store.js';
import {
  selectAssetOpsBatchRuns,
  useAssetOpsBatchStore,
  type AssetOpsBatchItemRecord,
  type AssetOpsBatchRunRecord,
  type AssetOpsBatchTask,
  type PlannedAssetOpsBatchItem,
} from '@renderer/state/asset-ops-batch-store.js';

type QueueWorldMissingInput = {
  workspaceId: string;
  worldDraft: WorldDraftState;
  worldDeliverables?: WorldDeliverableStatus[];
};

type QueueAgentMissingInput = {
  workspaceId: string;
  worldDraft: WorldDraftState;
  agentDrafts: Record<string, AgentDraftState>;
  roster?: WorldOwnedAgentRoster | null;
};

type PlannedBatchCounts = {
  pendingCount: number;
  skippedCount: number;
};

export function planWorldMissingBatchItems(input: QueueWorldMissingInput): {
  items: PlannedAssetOpsBatchItem[];
  counts: PlannedBatchCounts;
} {
  const worldId = String(input.worldDraft.worldId || '').trim();
  if (!worldId) {
    return {
      items: [],
      counts: { pendingCount: 0, skippedCount: 0 },
    };
  }
  const items = (input.worldDeliverables || [])
    .filter((entry) => entry.currentState === 'MISSING')
    .map<PlannedAssetOpsBatchItem>((entry) => ({
      workspaceId: input.workspaceId,
      worldId,
      family: entry.family,
      entityId: worldId,
      label: `Generate ${entry.label}`,
      task: {
        kind: 'WORLD_IMAGE',
        worldId,
        family: entry.family,
        worldName: input.worldDraft.name,
        worldDescription: input.worldDraft.description,
        worldOverview: input.worldDraft.overview,
      },
    }));
  return {
    items,
    counts: {
      pendingCount: items.length,
      skippedCount: 0,
    },
  };
}

function findRosterItem(roster: WorldOwnedAgentRoster | null | undefined, agentId: string): WorldOwnedAgentRosterItem | null {
  return roster?.items.find((item) => item.id === agentId) ?? null;
}

export function planAgentMissingBatchItems(input: QueueAgentMissingInput): {
  items: PlannedAssetOpsBatchItem[];
  counts: PlannedBatchCounts;
} {
  const worldId = String(input.worldDraft.worldId || '').trim() || null;
  const worldName = input.worldDraft.name;
  const worldDescription = input.worldDraft.description;
  const items: PlannedAssetOpsBatchItem[] = [];

  Object.values(input.agentDrafts)
    .filter((draft) => draft.ownershipType === 'WORLD_OWNED')
    .forEach((draft) => {
      const agentId = String(draft.sourceAgentId || '').trim();
      if (!agentId) {
        items.push({
          workspaceId: input.workspaceId,
          worldId,
          family: 'agent-avatar',
          entityId: draft.draftAgentId,
          label: `${draft.displayName}: canonical agent id required`,
          task: null,
          status: 'SKIPPED',
          lastError: 'Canonical agent id is required before batch asset generation can start.',
        });
        return;
      }
      const rosterItem = findRosterItem(input.roster, agentId);
      const deliverables = rosterItem?.deliverables ?? [];
      const getDeliverable = (family: string) => deliverables.find((item) => item.family === family);

      if ((getDeliverable('agent-avatar')?.currentState ?? 'MISSING') === 'MISSING') {
        items.push({
          workspaceId: input.workspaceId,
          worldId,
          family: 'agent-avatar',
          entityId: agentId,
          label: `${draft.displayName}: generate avatar`,
          task: {
            kind: 'AGENT_IMAGE',
            agentId,
            family: 'agent-avatar',
            agentName: draft.displayName,
            agentConcept: draft.concept,
            worldName,
            worldDescription,
          },
        });
      }

      if ((getDeliverable('agent-cover')?.currentState ?? 'MISSING') === 'MISSING') {
        items.push({
          workspaceId: input.workspaceId,
          worldId,
          family: 'agent-cover',
          entityId: agentId,
          label: `${draft.displayName}: generate cover`,
          task: {
            kind: 'AGENT_IMAGE',
            agentId,
            family: 'agent-cover',
            agentName: draft.displayName,
            agentConcept: draft.concept,
            worldName,
            worldDescription,
          },
        });
      }

      if ((getDeliverable('agent-greeting-primary')?.currentState ?? 'MISSING') === 'MISSING') {
        items.push({
          workspaceId: input.workspaceId,
          worldId,
          family: 'agent-greeting-primary',
          entityId: agentId,
          label: `${draft.displayName}: generate greeting`,
          task: {
            kind: 'AGENT_GREETING',
            agentId,
            worldName,
            worldDescription,
            displayName: draft.displayName,
            concept: draft.concept,
            description: draft.description,
            scenario: draft.scenario,
            greeting: draft.greeting,
          },
        });
      }

      if ((getDeliverable('agent-voice-demo')?.currentState ?? 'MISSING') === 'MISSING') {
        items.push({
          workspaceId: input.workspaceId,
          worldId,
          family: 'agent-voice-demo',
          entityId: agentId,
          label: `${draft.displayName}: synthesize voice demo`,
          task: {
            kind: 'AGENT_VOICE_DEMO',
            agentId,
            displayName: draft.displayName,
            fallbackGreeting: draft.greeting,
          },
        });
      }
    });

  return {
    items,
    counts: {
      pendingCount: items.filter((item) => (item.status ?? 'PENDING') === 'PENDING').length,
      skippedCount: items.filter((item) => item.status === 'SKIPPED').length,
    },
  };
}

async function executeTask(input: {
  userId: string;
  item: AssetOpsBatchItemRecord;
}): Promise<string> {
  const task = input.item.task;
  if (!task) {
    return input.item.lastError || 'Skipped.';
  }
  switch (task.kind) {
    case 'WORLD_IMAGE': {
      const target = WORLD_DELIVERABLE_REGISTRY.find((entry) => entry.family === task.family)?.studioTarget;
      if (!target) {
        throw new Error(`Unsupported world family: ${task.family}`);
      }
      const result = await generateEntityImage({
        target,
        worldName: task.worldName,
        worldDescription: task.worldDescription,
        worldOverview: task.worldOverview,
      });
      const candidate = result.candidates[0];
      if (!candidate?.url) {
        throw new Error('No generated image candidate returned.');
      }
      const uploaded = await uploadImageToCloudflare(candidate.url);
      queueWorldAssetCandidate({
        userId: input.userId,
        worldId: task.worldId,
        family: task.family,
        resourceId: uploaded.resourceId,
        previewUrl: uploaded.url,
        origin: 'image-studio',
        lifecycle: 'generated',
      });
      return `Queued ${task.family} candidate ${uploaded.resourceId.slice(0, 8)}.`;
    }
    case 'AGENT_IMAGE': {
      const target = task.family === 'agent-avatar' ? 'agent-avatar' : 'agent-portrait';
      const result = await generateEntityImage({
        target,
        agentName: task.agentName,
        agentConcept: task.agentConcept,
        worldName: task.worldName,
        worldDescription: task.worldDescription,
      });
      const candidate = result.candidates[0];
      if (!candidate?.url) {
        throw new Error('No generated image candidate returned.');
      }
      const uploaded = await uploadImageToCloudflare(candidate.url);
      queueAgentAssetCandidate({
        userId: input.userId,
        agentId: task.agentId,
        family: task.family,
        kind: 'resource',
        resourceId: uploaded.resourceId,
        previewUrl: uploaded.url,
        origin: 'image-studio',
        lifecycle: 'generated',
      });
      return `Queued ${task.family} candidate ${uploaded.resourceId.slice(0, 8)}.`;
    }
    case 'AGENT_GREETING': {
      const completion = await generateAgentCopyCompletion({
        worldName: task.worldName,
        worldDescription: task.worldDescription,
        displayName: task.displayName,
        concept: task.concept,
        description: task.description,
        scenario: task.scenario,
        greeting: task.greeting,
      });
      queueAgentAssetCandidate({
        userId: input.userId,
        agentId: task.agentId,
        family: 'agent-greeting-primary',
        kind: 'text',
        text: completion.greeting,
        origin: 'copy-generation',
        lifecycle: 'generated',
      });
      return 'Queued generated greeting candidate.';
    }
    case 'AGENT_VOICE_DEMO': {
      const greetingCandidates = selectAgentAssetOpsCandidates(useAgentAssetOpsStore.getState().profiles, {
        userId: input.userId,
        agentId: task.agentId,
      })
        .filter((candidate) => candidate.family === 'agent-greeting-primary' && candidate.text)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id));
      const sourceText = String(greetingCandidates[0]?.text || task.fallbackGreeting || '').trim();
      if (!sourceText) {
        throw new Error('Greeting text is required before voice-demo batch synthesis can run.');
      }
      const uploaded = await synthesizeVoiceDemo({ text: sourceText });
      queueAgentAssetCandidate({
        userId: input.userId,
        agentId: task.agentId,
        family: 'agent-voice-demo',
        kind: 'resource',
        resourceId: uploaded.resourceId,
        previewUrl: uploaded.url,
        mimeType: uploaded.mimeType,
        origin: 'voice-synthesis',
        lifecycle: 'generated',
      });
      return `Queued voice-demo candidate ${uploaded.resourceId.slice(0, 8)}.`;
    }
  }
}

export function useAssetOpsBatchQueue(workspaceId: string) {
  const userId = useAppStore((state) => state.auth?.user?.id ?? '');
  const profiles = useAssetOpsBatchStore((state) => state.profiles);
  const createRun = useAssetOpsBatchStore((state) => state.createRun);
  const markItemRunning = useAssetOpsBatchStore((state) => state.markItemRunning);
  const markItemSucceeded = useAssetOpsBatchStore((state) => state.markItemSucceeded);
  const markItemFailed = useAssetOpsBatchStore((state) => state.markItemFailed);
  const retryFailedRun = useAssetOpsBatchStore((state) => state.retryFailedRun);
  const resumePendingRun = useAssetOpsBatchStore((state) => state.resumePendingRun);
  const removeRun = useAssetOpsBatchStore((state) => state.removeRun);
  const processingRunIdsRef = useRef<Set<string>>(new Set());

  const runs = useMemo(
    () => selectAssetOpsBatchRuns(profiles, { userId, workspaceId }),
    [profiles, userId, workspaceId],
  );

  const executeRun = useCallback(async (runId: string) => {
    if (!userId || processingRunIdsRef.current.has(runId)) {
      return;
    }
    processingRunIdsRef.current.add(runId);
    try {
      while (true) {
        const currentRun = selectAssetOpsBatchRuns(useAssetOpsBatchStore.getState().profiles, { userId, workspaceId })
          .find((run) => run.id === runId);
        const nextItem = currentRun?.items.find((item) => item.status === 'PENDING');
        if (!currentRun || !nextItem) {
          break;
        }
        markItemRunning({ userId, runId, itemId: nextItem.id });
        try {
          const resultSummary = await executeTask({
            userId,
            item: nextItem,
          });
          markItemSucceeded({ userId, runId, itemId: nextItem.id, resultSummary });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          markItemFailed({ userId, runId, itemId: nextItem.id, error: message });
        }
      }
    } finally {
      processingRunIdsRef.current.delete(runId);
    }
  }, [markItemFailed, markItemRunning, markItemSucceeded, userId, workspaceId]);

  useEffect(() => {
    const pendingRun = runs.find((run) => run.status === 'PENDING');
    if (!pendingRun || !userId) {
      return;
    }
    void executeRun(pendingRun.id);
  }, [executeRun, runs, userId]);

  const queueMissingWorldDeliverables = useCallback((input: QueueWorldMissingInput) => {
    const planned = planWorldMissingBatchItems(input);
    const run = createRun({
      userId,
      workspaceId: input.workspaceId,
      worldId: input.worldDraft.worldId,
      kind: 'WORLD_MISSING_DELIVERABLES',
      label: `Missing world families · ${input.worldDraft.name || 'Untitled World'}`,
      items: planned.items,
    });
    return {
      run,
      counts: planned.counts,
    };
  }, [createRun, userId]);

  const queueMissingAgentDeliverables = useCallback((input: QueueAgentMissingInput) => {
    const planned = planAgentMissingBatchItems(input);
    const run = createRun({
      userId,
      workspaceId: input.workspaceId,
      worldId: input.worldDraft.worldId,
      kind: 'AGENT_MISSING_DELIVERABLES',
      label: `Missing agent deliverables · ${input.worldDraft.name || 'Untitled World'}`,
      items: planned.items,
    });
    return {
      run,
      counts: planned.counts,
    };
  }, [createRun, userId]);

  const retryRun = useCallback(async (runId: string) => {
    const run = retryFailedRun({ userId, runId });
    if (run) {
      await executeRun(runId);
    }
    return run;
  }, [executeRun, retryFailedRun, userId]);

  const resumeRun = useCallback(async (runId: string) => {
    const run = resumePendingRun({ userId, runId });
    if (run) {
      await executeRun(runId);
    }
    return run;
  }, [executeRun, resumePendingRun, userId]);

  const clearRun = useCallback((runId: string) => {
    removeRun({ userId, runId });
  }, [removeRun, userId]);

  return {
    runs,
    queueMissingWorldDeliverables,
    queueMissingAgentDeliverables,
    retryRun,
    resumeRun,
    clearRun,
  };
}
