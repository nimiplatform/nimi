import { useCallback, useEffect, useState, type MutableRefObject } from 'react';
import type { Phase1Result, Phase2Result } from '@world-engine/generation/pipeline.js';
import { runPhase1ExtractionFromChunks, runPhase2DraftGeneration } from '@world-engine/generation/pipeline.js';
import { splitSourceText } from '@world-engine/engine/chunker.js';
import { toFailedChunkIndices } from '@world-engine/services/event-graph-map.js';
import { PIPELINE_STAGES } from '../../../../../../../../packages/nimi-forge/src/authoring/pipeline.js';
import type {
  EventNodeDraft,
  WorldLorebookDraftRow,
  WorldStudioCreateStep,
} from '@world-engine/contracts.js';
import type { JsonObject } from '@renderer/bridge';
import { useWorldCommitActions } from '@renderer/hooks/use-world-commit-actions.js';
import {
  getOfficialFactoryBatchRun,
  type ForgeDraftHistoryEvent,
  type ForgeOfficialFactoryBatchRun,
} from '@renderer/data/world-data-client.js';
import { buildForgeOfficialWorldPackage } from '@renderer/data/world-package-builder.js';
import type {
  ForgeWorkspacePatch,
  ForgeWorkspaceSnapshot,
} from '@renderer/state/creator-world-workspace.js';
import {
  asRecord,
  createForgeAiClient,
  deriveRuleTruthDraftFromWorkspace,
  resolveRuleTruthDraft,
  toDraftStatus,
} from './world-create-page-helpers';
import {
  generateEntityImage,
  type ImageGenEntityContext,
} from '@renderer/data/image-gen-client.js';

function requireWorldName(value: unknown, code: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(code);
  }
  return normalized;
}

function parseFutureHistoricalDraft(value: string): ForgeDraftHistoryEvent[] | undefined {
  const normalized = String(value || '').trim();
  if (!normalized) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error('FORGE_DRAFT_FUTURE_EVENTS_REQUIRED');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('FORGE_DRAFT_FUTURE_EVENTS_REQUIRED');
  }
  return parsed.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('FORGE_DRAFT_FUTURE_EVENTS_REQUIRED');
    }
    const record = item as JsonObject;
    const eventType = String(record.eventType || '').trim();
    const title = String(record.title || '').trim();
    const happenedAt = String(record.happenedAt || '').trim();
    if (!eventType || !title || !happenedAt) {
      throw new Error('FORGE_DRAFT_FUTURE_EVENTS_REQUIRED');
    }
    return record as ForgeDraftHistoryEvent;
  });
}

function toOfficialFactoryQualityGate(
  phase1: Phase1Result | null,
): {
  status: 'PASS' | 'WARN' | 'FAIL' | 'BYPASSED';
  findingCount?: number | null;
} {
  if (!phase1) {
    return { status: 'BYPASSED' };
  }
  return {
    status: phase1.qualityGate.status === 'PASS'
      ? 'PASS'
      : phase1.qualityGate.status === 'WARN'
        ? 'WARN'
        : 'FAIL',
    findingCount: Number(phase1.qualityGate.metrics.failedChunks || 0),
  };
}

function toDraftHistoryEvent(
  event: EventNodeDraft,
  eventType: 'world.primary' | 'world.secondary',
): ForgeDraftHistoryEvent {
  return {
    eventId: typeof event.id === 'string' ? event.id : undefined,
    eventType,
    title: String(event.title || '').trim(),
    happenedAt: String(event.timeRef || new Date().toISOString()),
    summary: typeof event.summary === 'string' ? event.summary : undefined,
    cause: typeof event.cause === 'string' ? event.cause : undefined,
    process: typeof event.process === 'string' ? event.process : undefined,
    result: typeof event.result === 'string' ? event.result : undefined,
    timeRef: typeof event.timeRef === 'string' ? event.timeRef : undefined,
    locationRefs: Array.isArray(event.locationRefs) ? event.locationRefs : [],
    characterRefs: Array.isArray(event.characterRefs) ? event.characterRefs : [],
    dependsOnEventIds: Array.isArray(event.dependsOnEventIds) ? event.dependsOnEventIds : [],
    evidenceRefs: Array.isArray(event.evidenceRefs) ? event.evidenceRefs : [],
    payload: {
      timelineSeq: Number(event.timelineSeq || 0),
      level: event.level === 'SECONDARY' ? 'SECONDARY' : 'PRIMARY',
      eventHorizon: event.eventHorizon === 'ONGOING'
        ? 'ONGOING'
        : event.eventHorizon === 'FUTURE'
          ? 'FUTURE'
          : 'PAST',
      parentEventId: typeof event.parentEventId === 'string' ? event.parentEventId : null,
      confidence: Number.isFinite(Number(event.confidence)) ? Number(event.confidence) : 0.5,
      needsEvidence: Boolean(event.needsEvidence),
    },
  };
}
type UseWorldCreatePageGenerationInput = {
  activeDraftId: string;
  commitActions: ReturnType<typeof useWorldCommitActions>;
  navigate: (to: string) => void;
  patchWorkspaceSnapshot: (patch: ForgeWorkspacePatch) => void;
  retryConcurrency: number;
  retryScope: 'all' | 'json' | 'coarse' | 'fine';
  setActiveDraftId: (value: string) => void;
  setCreateStep: (step: WorldStudioCreateStep) => void;
  setNotice: (message: string | null) => void;
  setRetryErrorCode: (value: string | null) => void;
  snapshot: ForgeWorkspaceSnapshot;
  sourceChunksRef: MutableRefObject<string[]>;
  sourceMode: 'TEXT' | 'FILE';
  sourceRawTextRef: MutableRefObject<string>;
  userId: string;
};

export type ForgeCreatePublishOperationState = {
  batchRun: ForgeOfficialFactoryBatchRun | null;
  publishedWorldId: string | null;
  publishedReleaseVersion: number | null;
};

type ForgePreparedPublishContext = {
  pkg: ReturnType<typeof buildForgeOfficialWorldPackage>;
  qualityGate: ReturnType<typeof toOfficialFactoryQualityGate>;
};

export function useWorldCreatePageGeneration(input: UseWorldCreatePageGenerationInput) {
  const [phase1, setPhase1] = useState<Phase1Result | null>(null);
  const [phase2, setPhase2] = useState<Phase2Result | null>(null);
  const [publishOperation, setPublishOperation] = useState<ForgeCreatePublishOperationState>({
    batchRun: null,
    publishedWorldId: null,
    publishedReleaseVersion: null,
  });

  const publishWithBatchRun = useCallback(async (
    prepared: ForgePreparedPublishContext,
    batchRun: ForgeOfficialFactoryBatchRun,
  ) => {
    const retryableItem = batchRun.items.find((item) => item.status === 'PENDING' || item.status === 'RUNNING');
    const batchItemId = String(retryableItem?.id || '').trim();
    if (!batchItemId) {
      throw new Error('FORGE_OFFICIAL_FACTORY_BATCH_ITEM_REQUIRED');
    }

    try {
      const published = await input.commitActions.publishPackageMutation.mutateAsync({
        package: prepared.pkg,
        governance: {
          officialOwnerId: input.userId,
          editorialOperatorId: input.userId,
          reviewerId: input.userId,
          publisherId: input.userId,
          publishActorId: input.userId,
          sourceProvenance: input.sourceMode === 'FILE' ? 'forge-file-source' : 'forge-text-source',
          reviewVerdict: 'approved',
          releaseTag: `official-${prepared.pkg.meta.version}`,
          releaseSummary: 'Forge official package publish',
          changeSummary: 'Initial official publish from Forge workspace snapshot',
        },
        operations: {
          batchRunId: batchRun.id,
          batchItemId,
          qualityGate: prepared.qualityGate,
          titleLineageReason: 'Forge official package publish',
        },
      });
      const refreshedBatchRun = await getOfficialFactoryBatchRun(batchRun.id);
      setPublishOperation({
        batchRun: refreshedBatchRun,
        publishedWorldId: published.worldId,
        publishedReleaseVersion: published.release.version,
      });
      input.setNotice(`Official package published as release v${published.release.version}. Redirecting to world maintenance.`);
      input.navigate(`/worlds/${published.worldId}/maintain`);
    } catch (error) {
      const failedBatchRun = await input.commitActions.reportBatchItemFailureMutation.mutateAsync({
        runId: batchRun.id,
        itemId: batchItemId,
        payload: {
          reason: error instanceof Error ? error.message : 'Forge official package publish failed',
          qualityGate: {
            ...prepared.qualityGate,
            status: 'FAIL',
          },
        },
      });
      setPublishOperation({
        batchRun: failedBatchRun,
        publishedWorldId: null,
        publishedReleaseVersion: null,
      });
      throw error;
    }
  }, [input]);
  useEffect(() => {
    const artifact = input.snapshot.phase1Artifact;
    if (!artifact) {
      if (phase1) {
        setPhase1(null);
      }
      return;
    }
    if (phase1) {
      return;
    }
    setPhase1({
      startTimeOptions: artifact.startTimeOptions,
      characterCandidates: artifact.characterCandidates,
      knowledgeGraph: input.snapshot.knowledgeGraph,
      finalDraftAccumulator: input.snapshot.finalDraftAccumulator,
      qualityGate: artifact.qualityGate,
      chunkTasks: artifact.chunkTasks,
      rawText: JSON.stringify({ restoredFromArtifact: true, updatedAt: artifact.updatedAt }),
    });
  }, [input.snapshot.finalDraftAccumulator, input.snapshot.knowledgeGraph, input.snapshot.phase1Artifact, phase1]);
  const onRunPhase1 = useCallback(() => {
    const sourceText = input.sourceMode === 'FILE' ? input.sourceRawTextRef.current : (input.snapshot.sourceText || '');
    if (!sourceText.trim()) {
      input.setNotice('Please provide source text before running extraction.');
      return;
    }
    input.setNotice(null);
    input.setCreateStep('INGEST');
    input.patchWorkspaceSnapshot({
      parseJob: {
        phase: 'ingest',
        chunkTotal: 0,
        chunkProcessed: 0,
        chunkCompleted: 0,
        chunkFailed: 0,
        progress: 0.05,
        etaSeconds: null,
        updatedAt: new Date().toISOString(),
      },
    });
    const aiClient = createForgeAiClient();
    const chunks = splitSourceText(sourceText);
    input.sourceChunksRef.current = chunks;
    void (async () => {
      try {
        const result = await runPhase1ExtractionFromChunks(aiClient, chunks, {
          onProgress: (progress) => {
            input.patchWorkspaceSnapshot({
              parseJob: {
                phase: progress.phase,
                chunkTotal: progress.chunkTotal,
                chunkProcessed: progress.chunkProcessed,
                chunkCompleted: progress.chunkCompleted,
                chunkFailed: progress.chunkFailed,
                progress: progress.progress,
                etaSeconds: progress.etaSeconds,
                updatedAt: new Date().toISOString(),
              },
            });
            if (progress.phase === 'extract') {
              input.setCreateStep('EXTRACT');
            }
          },
          onFinalDraftAccumulatorUpdate: (accumulator) => {
            input.patchWorkspaceSnapshot({ finalDraftAccumulator: accumulator });
          },
        });
        setPhase1(result);
        input.patchWorkspaceSnapshot({
          knowledgeGraph: result.knowledgeGraph,
          finalDraftAccumulator: result.finalDraftAccumulator,
          phase1Artifact: {
            startTimeOptions: result.startTimeOptions,
            characterCandidates: result.characterCandidates,
            qualityGate: result.qualityGate,
            chunkTasks: result.chunkTasks,
            narrativeArc: null,
            sourceDigest: '',
            updatedAt: new Date().toISOString(),
          },
          parseJob: {
            phase: 'done',
            chunkTotal: result.qualityGate.metrics.totalChunks,
            chunkProcessed: result.qualityGate.metrics.totalChunks,
            chunkCompleted: result.qualityGate.metrics.successChunks,
            chunkFailed: result.qualityGate.metrics.failedChunks,
            progress: 1,
            etaSeconds: 0,
            updatedAt: new Date().toISOString(),
          },
        });
        input.setCreateStep('CHECKPOINTS');
        if (result.qualityGate.status === 'PASS') {
          input.setNotice('Extraction completed. Confirm checkpoints.');
        } else if (result.qualityGate.status === 'WARN') {
          input.setNotice('Extraction completed with warnings. Confirm checkpoints before synthesize.');
        } else {
          input.setNotice('Extraction completed, but quality gate blocked. Try rerunning failed chunks.');
        }
      } catch (error) {
        input.patchWorkspaceSnapshot({
          parseJob: {
            phase: 'failed',
            updatedAt: new Date().toISOString(),
          },
        });
        input.setNotice(error instanceof Error ? error.message : 'Phase 1 extraction failed.');
      }
    })();
  }, [input]);
  const runPhase1Retry = useCallback((failedIndices: number[], successNotice: string) => {
    const sourceText = input.sourceMode === 'FILE' ? input.sourceRawTextRef.current : (input.snapshot.sourceText || '');
    const allChunks = input.sourceChunksRef.current.length > 0
      ? input.sourceChunksRef.current
      : splitSourceText(sourceText);
    const chunksToRetry = failedIndices.map((index) => allChunks[index]!).filter(Boolean);
    const aiClient = createForgeAiClient();
    input.patchWorkspaceSnapshot({
      parseJob: {
        phase: 'extract',
        progress: 0.1,
        updatedAt: new Date().toISOString(),
      },
    });
    input.setCreateStep('EXTRACT');
    void (async () => {
      try {
        const result = await runPhase1ExtractionFromChunks(aiClient, chunksToRetry, {
          chunkIndexMap: failedIndices,
          maxConcurrency: input.retryConcurrency,
          onProgress: (progress) => {
            input.patchWorkspaceSnapshot({
              parseJob: {
                phase: progress.phase,
                chunkTotal: progress.chunkTotal,
                chunkProcessed: progress.chunkProcessed,
                chunkCompleted: progress.chunkCompleted,
                chunkFailed: progress.chunkFailed,
                progress: progress.progress,
                etaSeconds: progress.etaSeconds,
                updatedAt: new Date().toISOString(),
              },
            });
          },
          onFinalDraftAccumulatorUpdate: (finalDraftAccumulator) => {
            input.patchWorkspaceSnapshot({ finalDraftAccumulator });
          },
        });
        setPhase1(result);
        input.patchWorkspaceSnapshot({
          knowledgeGraph: result.knowledgeGraph,
          finalDraftAccumulator: result.finalDraftAccumulator,
          phase1Artifact: {
            startTimeOptions: result.startTimeOptions,
            characterCandidates: result.characterCandidates,
            qualityGate: result.qualityGate,
            chunkTasks: result.chunkTasks,
            narrativeArc: null,
            sourceDigest: '',
            updatedAt: new Date().toISOString(),
          },
          parseJob: {
            phase: 'done',
            progress: 1,
            etaSeconds: 0,
            updatedAt: new Date().toISOString(),
          },
        });
        input.setCreateStep('CHECKPOINTS');
        input.setNotice(successNotice);
      } catch (error) {
        input.patchWorkspaceSnapshot({
          parseJob: {
            phase: 'failed',
            updatedAt: new Date().toISOString(),
          },
        });
        input.setNotice(error instanceof Error ? error.message : 'Retry failed chunks failed.');
      }
    })();
  }, [input]);
  const onRunFailedChunks = useCallback(() => {
    if (!phase1) {
      input.setNotice('No Phase 1 result to retry from.');
      return;
    }
    const sourceText = input.sourceMode === 'FILE' ? input.sourceRawTextRef.current : (input.snapshot.sourceText || '');
    const allChunks = input.sourceChunksRef.current.length > 0
      ? input.sourceChunksRef.current
      : splitSourceText(sourceText);
    if (allChunks.length === 0) {
      input.setNotice('No source chunks available for retry.');
      return;
    }
    const failedIndices = toFailedChunkIndices(
      phase1.chunkTasks as Array<{ chunkIndex: number; status: 'success' | 'failed'; stage?: string; errorCode?: string; errorMessage?: string }>,
      allChunks.length,
      input.retryScope,
    );
    if (failedIndices.length === 0) {
      input.setNotice('No failed chunks to retry.');
      return;
    }
    input.setNotice(null);
    runPhase1Retry(failedIndices, 'Failed chunks re-extracted. Confirm checkpoints.');
  }, [input, phase1, runPhase1Retry]);
  const onRunFailedChunksByErrorCode = useCallback((errorCode: string) => {
    if (!phase1) {
      input.setNotice('No Phase 1 result to retry from.');
      return;
    }
    const sourceText = input.sourceMode === 'FILE' ? input.sourceRawTextRef.current : (input.snapshot.sourceText || '');
    const allChunks = input.sourceChunksRef.current.length > 0
      ? input.sourceChunksRef.current
      : splitSourceText(sourceText);
    if (allChunks.length === 0) {
      input.setNotice('No source chunks available for retry.');
      return;
    }
    const failedIndices = toFailedChunkIndices(
      phase1.chunkTasks as Array<{ chunkIndex: number; status: 'success' | 'failed'; stage?: string; errorCode?: string; errorMessage?: string }>,
      allChunks.length,
      input.retryScope,
      errorCode,
    );
    if (failedIndices.length === 0) {
      input.setNotice(`No failed chunks matching error code "${errorCode}".`);
      return;
    }
    input.setNotice(null);
    input.setRetryErrorCode(errorCode);
    runPhase1Retry(failedIndices, `Retry by error code "${errorCode}" completed. Confirm checkpoints.`);
  }, [input, phase1, runPhase1Retry]);

  const onRefreshQualityGate = useCallback(() => {
    if (!phase1) {
      return;
    }
    setPhase1({ ...phase1 });
  }, [phase1]);

  const onRunPhase2 = useCallback(() => {
    if (!phase1 || !phase1.qualityGate.pass) {
      input.setNotice('Phase 1 extraction must pass quality gate before synthesize.');
      return;
    }
    if (!input.snapshot.selectedStartTimeId) {
      input.setNotice('Please select a start time before synthesize.');
      return;
    }
    if (input.snapshot.selectedCharacters.length === 0) {
      input.setNotice('Please select at least one character before synthesize.');
      return;
    }
    input.setNotice(null);
    input.setCreateStep('SYNTHESIZE');
    input.patchWorkspaceSnapshot({
      parseJob: {
        phase: 'synthesize',
        progress: 0.9,
        updatedAt: new Date().toISOString(),
      },
    });
    const aiClient = createForgeAiClient();
    void (async () => {
      try {
        const result = await runPhase2DraftGeneration(aiClient, {
          selectedStartTimeId: input.snapshot.selectedStartTimeId,
          selectedCharacters: input.snapshot.selectedCharacters,
          knowledgeGraph: input.snapshot.knowledgeGraph as JsonObject,
          finalDraftAccumulator: input.snapshot.finalDraftAccumulator,
        });
        setPhase2(result);
        const draftsByCharacter = (result.agentDrafts || []).reduce(
          (accumulator, item) => {
            const name = String(item.characterName || '').trim();
            if (name) {
              accumulator[name] = { ...item, dna: item.dna };
            }
            return accumulator;
          },
          {} as Record<string, (typeof result.agentDrafts)[number]>,
        );
        input.patchWorkspaceSnapshot({
          worldStateDraft: result.world,
          worldviewPatch: result.worldview,
          ruleTruthDraft: deriveRuleTruthDraftFromWorkspace({
            worldviewPatch: result.worldview as JsonObject,
            sourceRef: input.snapshot.sourceRef,
            selectedCharacters: input.snapshot.selectedCharacters,
            agentSync: {
              ...input.snapshot.agentSync,
              draftsByCharacter: {
                ...input.snapshot.agentSync.draftsByCharacter,
                ...draftsByCharacter,
              },
            },
          }),
          lorebooksDraft: Array.isArray(result.worldLorebooks)
            ? result.worldLorebooks.filter((item): item is WorldLorebookDraftRow => Boolean(item && typeof item === 'object'))
            : [],
          futureEventsText: JSON.stringify(result.futureHistoricalEvents || [], null, 2),
          finalDraftAccumulator: result.finalDraftAccumulator || input.snapshot.finalDraftAccumulator,
          agentSync: {
            ...input.snapshot.agentSync,
            draftsByCharacter: {
              ...input.snapshot.agentSync.draftsByCharacter,
              ...draftsByCharacter,
            },
          },
          parseJob: {
            phase: 'done',
            progress: 1,
            chunkProcessed: input.snapshot.parseJob.chunkTotal,
            etaSeconds: 0,
            updatedAt: new Date().toISOString(),
          },
        });
        input.setCreateStep('DRAFT');
        input.setNotice('Synthesize completed. Draft editor is ready.');
      } catch (error) {
        input.patchWorkspaceSnapshot({
          parseJob: {
            phase: 'failed',
            updatedAt: new Date().toISOString(),
          },
        });
        input.setNotice(error instanceof Error ? error.message : 'Phase 2 synthesis failed.');
      }
    })();
  }, [input, phase1]);

  const onGenerateWorldCover = useCallback(() => {
    input.setNotice(null);
    input.patchWorkspaceSnapshot({
      assets: {
        worldCover: { status: 'running', imageUrl: null },
      },
    });
    const world = input.snapshot.worldStateDraft as JsonObject;
    let worldName: string;
    try {
      worldName = requireWorldName(world.name, 'FORGE_WORLD_NAME_REQUIRED');
    } catch (error) {
      input.patchWorkspaceSnapshot({
        assets: {
          worldCover: { status: 'failed', imageUrl: null },
        },
      });
      input.setNotice(error instanceof Error ? error.message : 'World name is required before generating a cover.');
      return;
    }
    const ctx: ImageGenEntityContext = {
      target: 'world-banner',
      worldName,
      worldDescription: String(world.description || input.snapshot.knowledgeGraph.worldSetting || ''),
      worldSetting: String(input.snapshot.knowledgeGraph.worldSetting || ''),
    };
    void (async () => {
      try {
        const result = await generateEntityImage(ctx);
        const imageUrl = result.candidates[0]?.url || '';
        input.patchWorkspaceSnapshot({
          assets: {
            worldCover: { status: 'succeeded', imageUrl },
          },
        });
        input.setNotice('World cover generated.');
      } catch (error) {
        input.patchWorkspaceSnapshot({
          assets: {
            worldCover: { status: 'failed', imageUrl: null },
          },
        });
        input.setNotice(error instanceof Error ? error.message : 'World cover generation failed.');
      }
    })();
  }, [input]);

  const onGenerateCharacterPortrait = useCallback((name: string) => {
    input.setNotice(null);
    const portraits = { ...input.snapshot.assets.characterPortraits };
    portraits[name] = { status: 'running', imageUrl: null };
    input.patchWorkspaceSnapshot({
      assets: {
        characterPortraits: portraits,
      },
    });
    const agentDraft = asRecord(input.snapshot.agentSync.draftsByCharacter[name]);
    const ctx: ImageGenEntityContext = {
      target: 'agent-avatar',
      agentName: name,
      agentConcept: String(agentDraft.concept || agentDraft.backstory || ''),
      agentDna: agentDraft.dna && typeof agentDraft.dna === 'object' ? agentDraft.dna as JsonObject : null,
      worldSetting: String(input.snapshot.knowledgeGraph.worldSetting || ''),
      worldName: String((input.snapshot.worldStateDraft as JsonObject).name || ''),
    };
    void (async () => {
      try {
        const result = await generateEntityImage(ctx);
        const imageUrl = result.candidates[0]?.url || '';
        input.patchWorkspaceSnapshot({
          assets: {
            characterPortraits: {
              ...input.snapshot.assets.characterPortraits,
              [name]: { status: 'succeeded', imageUrl },
            },
          },
        });
        input.setNotice(`Portrait generated for ${name}.`);
      } catch (error) {
        input.patchWorkspaceSnapshot({
          assets: {
            characterPortraits: {
              ...input.snapshot.assets.characterPortraits,
              [name]: { status: 'failed', imageUrl: null },
            },
          },
        });
        input.setNotice(error instanceof Error ? error.message : `Portrait generation failed for ${name}.`);
      }
    })();
  }, [input]);

  const persistDraft = useCallback(async () => {
    const truthDraft = resolveRuleTruthDraft(input.snapshot);
    const workspaceVersion = String(input.snapshot.workspaceVersion || '').trim() || crypto.randomUUID();
    if (workspaceVersion !== input.snapshot.workspaceVersion) {
      input.patchWorkspaceSnapshot({ workspaceVersion });
    }
    requireWorldName(input.snapshot.worldStateDraft.name, 'FORGE_DRAFT_WORLD_NAME_REQUIRED');
    const futureHistorical = parseFutureHistoricalDraft(input.snapshot.futureEventsText || '');
    const result = await input.commitActions.saveDraftMutation.mutateAsync({
      draftId: input.activeDraftId || undefined,
      sourceType: input.sourceMode,
      sourceRef: input.snapshot.sourceRef || '',
      status: toDraftStatus(input.snapshot.createStep),
      draftPayload: {
        importSource: {
          sourceType: input.sourceMode,
          sourceRef: input.snapshot.sourceRef || undefined,
          sourceText: input.snapshot.sourceText || undefined,
        },
        truthDraft: {
          worldRules: truthDraft.worldRules,
          agentRules: truthDraft.agentRules,
        },
        stateDraft: {
          worldState: input.snapshot.worldStateDraft,
        },
        historyDraft: {
          events: {
            primary: input.snapshot.eventsDraft.primary.map((event) =>
              toDraftHistoryEvent(event, 'world.primary')),
            secondary: input.snapshot.eventsDraft.secondary.map((event) =>
              toDraftHistoryEvent(event, 'world.secondary')),
            ...(futureHistorical && futureHistorical.length > 0 ? { futureHistorical } : {}),
          },
        },
      },
    });
    const record = asRecord(result);
    const draftId = String(record.id || input.activeDraftId || '').trim();
    if (draftId) {
      input.setActiveDraftId(draftId);
    }
    return draftId;
  }, [input]);

  const preparePublishContext = useCallback(async (): Promise<ForgePreparedPublishContext> => {
    const draftId = (await persistDraft()) || input.activeDraftId;
    if (!draftId) {
      throw new Error('Draft id is required before publishing.');
    }
    const pkg = buildForgeOfficialWorldPackage({
      userId: requireWorldName(input.userId, 'FORGE_PACKAGE_USER_ID_REQUIRED'),
      sourceMode: input.sourceMode,
      draftId,
      snapshot: input.snapshot,
    });
    return {
      pkg,
      qualityGate: toOfficialFactoryQualityGate(phase1),
    };
  }, [input.activeDraftId, input.snapshot, input.sourceMode, input.userId, persistDraft, phase1]);

  const publishDraft = useCallback(async () => {
    const prepared = await preparePublishContext();
    const preparedWorld = prepared.pkg.truth.world.record;
    const batchRun = await input.commitActions.createBatchRunMutation.mutateAsync({
      name: `Forge official publish · ${preparedWorld.name}`,
      requestKey: prepared.pkg.meta.version,
      pipelineStages: [...PIPELINE_STAGES],
      retryLimit: 1,
      executionNotes: 'Forge create flow official package publish',
      items: [{
        worldId: preparedWorld.id,
        slug: prepared.pkg.slug,
        sourceTitle: prepared.pkg.meta.sourceTitle,
        canonicalTitle: preparedWorld.name,
        sourceMode: prepared.pkg.meta.sourceMode,
        qualityGate: prepared.qualityGate,
      }],
    });
    setPublishOperation({
      batchRun,
      publishedWorldId: null,
      publishedReleaseVersion: null,
    });
    await publishWithBatchRun(prepared, batchRun);
  }, [input.commitActions.createBatchRunMutation, preparePublishContext, publishWithBatchRun]);

  const retryPublishOperation = useCallback(async () => {
    const currentBatchRun = publishOperation.batchRun;
    if (!currentBatchRun) {
      throw new Error('FORGE_OFFICIAL_FACTORY_BATCH_RUN_REQUIRED');
    }
    const hasRetryableItems = currentBatchRun.items.some((item) => item.status === 'FAILED' || item.status === 'SKIPPED');
    if (!hasRetryableItems) {
      throw new Error(`FORGE_OFFICIAL_FACTORY_RETRYABLE_ITEMS_REQUIRED:${currentBatchRun.id}`);
    }

    const prepared = await preparePublishContext();
    const retriedBatchRun = await input.commitActions.retryBatchRunMutation.mutateAsync({
      runId: currentBatchRun.id,
      reason: 'Retry requested from Forge create page',
    });
    setPublishOperation({
      batchRun: retriedBatchRun,
      publishedWorldId: null,
      publishedReleaseVersion: null,
    });
    await publishWithBatchRun(prepared, retriedBatchRun);
  }, [input.commitActions.retryBatchRunMutation, preparePublishContext, publishOperation.batchRun, publishWithBatchRun]);

  return {
    onGenerateCharacterPortrait,
    onGenerateWorldCover,
    onRefreshQualityGate,
    onRunFailedChunks,
    onRunFailedChunksByErrorCode,
    onRunPhase1,
    onRunPhase2,
    persistDraft,
    phase1,
    phase2,
    publishOperation,
    publishDraft,
    retryPublishOperation,
  };
}
