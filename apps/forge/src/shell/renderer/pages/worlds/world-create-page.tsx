/**
 * World Create Page — CREATE pipeline wrapper (FG-WORLD-003)
 *
 * Imports World-Studio's CreateWorkbench via @world-engine alias,
 * wires it to Forge's creator-world-store and world-data-client.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { CreateWorkbench } from '@world-engine/ui/create/create-workbench.js';
import type { Phase1Result, Phase2Result } from '@world-engine/generation/pipeline.js';
import type {
  WorldStudioActionsSlice,
  WorldStudioMainSlice,
  WorldStudioRoutingSlice,
  WorldStudioStatusSlice,
  WorldStudioWorkflowSlice,
} from '@world-engine/controllers/world-studio-screen-model.js';
import {
  runPhase1ExtractionFromChunks,
  runPhase2DraftGeneration,
} from '@world-engine/generation/pipeline.js';
import { splitSourceText } from '@world-engine/engine/chunker.js';
import { toFailedChunkIndices } from '@world-engine/services/event-graph-map.js';
import type { WorldStudioRuntimeAiClient } from '@world-engine/runtime-ai-client.js';
import type {
  WorldStudioCreateStep,
  WorldStudioAgentDraft,
  EventNodeDraft,
  WorldLorebookDraftRow,
} from '@world-engine/contracts.js';
import { useCreatorWorldStore } from '@renderer/state/creator-world-store.js';
import { useWorldMutations } from '@renderer/hooks/use-world-mutations.js';
import { useAppStore } from '@renderer/app-shell/providers/app-store.js';
import { getWorldDraft } from '@renderer/data/world-data-client.js';
import { getPlatformClient } from '@runtime/platform-client.js';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function setTimeFlowRatioOnWorldviewPatch(worldviewPatch: Record<string, unknown>, value: string): Record<string, unknown> {
  const numeric = Number(value);
  const timeModel = asRecord(worldviewPatch.timeModel);
  return {
    ...worldviewPatch,
    timeModel: {
      ...timeModel,
      timeFlowRatio: Number.isFinite(numeric) ? numeric : 1,
    },
  };
}

function getTimeFlowRatioFromWorldviewPatch(worldviewPatch: Record<string, unknown>): string {
  const timeModel = asRecord(worldviewPatch.timeModel);
  const ratio = timeModel.timeFlowRatio;
  if (typeof ratio === 'number' && Number.isFinite(ratio)) {
    return String(ratio);
  }
  return '1';
}

/**
 * Builds a WorldStudioRuntimeAiClient that bridges the Forge platform Runtime
 * to the interface expected by world-engine pipeline functions.
 */
function createForgeAiClient(): WorldStudioRuntimeAiClient {
  const { runtime } = getPlatformClient();
  return {
    generateText: async (input) => {
      const result = await runtime.ai.text.generate({
        model: 'auto',
        input: input.prompt,
        system: input.systemPrompt,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
      });
      const traceId = String(result.trace?.traceId || '').trim();
      return {
        text: String(result.text || ''),
        traceId,
        promptTraceId: traceId,
      };
    },
    generateImage: async (input) => {
      const result = await runtime.media.image.generate({
        model: 'auto',
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        size: input.size,
        aspectRatio: input.aspectRatio,
        quality: input.quality,
        style: input.style,
        seed: input.seed,
        responseFormat: input.responseFormat,
        signal: input.abortSignal,
      });
      const artifacts = result.artifacts as unknown as Array<Record<string, unknown>>;
      return {
        artifacts: Array.isArray(artifacts)
          ? artifacts.map((a) => ({
              uri: String(a.url || a.uri || '').trim() || undefined,
              mimeType: String(a.mimeType || '').trim() || undefined,
              bytes: a.bytes && (a.bytes as Uint8Array).length > 0 ? a.bytes as Uint8Array : undefined,
            }))
          : [],
        traceId: String(result.trace?.traceId || '').trim(),
      };
    },
    generateEmbedding: async (input) => {
      const result = await runtime.ai.embedding.generate({
        model: input.model || 'auto',
        input: input.input,
      });
      return {
        embeddings: Array.isArray(result.vectors) ? result.vectors : [],
        traceId: String(result.trace?.traceId || '').trim(),
      };
    },
  };
}

function encodeImageArtifactBytes(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return globalThis.btoa(binary);
}

function resolveGeneratedImageUrl(artifacts: Array<{ url?: string; uri?: string; mimeType?: string; base64?: string; bytes?: Uint8Array }>): string {
  const artifact = artifacts[0];
  if (!artifact) return '';
  const url = String(artifact.url || artifact.uri || '').trim();
  if (url) return url;
  if (artifact.base64) {
    const mimeType = String(artifact.mimeType || '').trim() || 'image/png';
    return `data:${mimeType};base64,${artifact.base64}`;
  }
  if (artifact.bytes && artifact.bytes.length > 0) {
    const mimeType = String(artifact.mimeType || '').trim() || 'image/png';
    return `data:${mimeType};base64,${encodeImageArtifactBytes(artifact.bytes)}`;
  }
  return '';
}

function toCreateDisplayStage(step: WorldStudioCreateStep): WorldStudioWorkflowSlice['createDisplayStage'] {
  if (step === 'CHECKPOINTS') return 'CURATE';
  if (step === 'SYNTHESIZE') return 'GENERATE';
  if (step === 'DRAFT' || step === 'PUBLISH') return 'REVIEW';
  return 'IMPORT';
}

function toImportSubview(step: WorldStudioCreateStep): WorldStudioMainSlice['importSubview'] {
  if (step === 'SOURCE') return 'PREPARE';
  if (step === 'INGEST' || step === 'EXTRACT') return 'RUNNING';
  return 'RESULT';
}

function toReviewSubview(step: WorldStudioCreateStep): WorldStudioMainSlice['reviewSubview'] {
  return step === 'PUBLISH' ? 'PUBLISH_REVIEW' : 'EDIT';
}

function toDraftStatus(step: WorldStudioCreateStep): 'DRAFT' | 'SYNTHESIZE' | 'REVIEW' | 'PUBLISH' | 'FAILED' {
  if (step === 'SYNTHESIZE') return 'SYNTHESIZE';
  if (step === 'DRAFT') return 'REVIEW';
  if (step === 'PUBLISH') return 'PUBLISH';
  return 'DRAFT';
}

export default function WorldCreatePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const resumeDraftId = searchParams.get('draftId') || '';

  // Auth
  const userId = useAppStore((s) => s.auth?.user?.id || '');

  // Store bindings
  const snapshot = useCreatorWorldStore((s) => s.snapshot);
  const patchSnapshot = useCreatorWorldStore((s) => s.patchSnapshot);
  const setCreateStep = useCreatorWorldStore((s) => s.setCreateStep);
  const hydrateForUser = useCreatorWorldStore((s) => s.hydrateForUser);
  const persistForUser = useCreatorWorldStore((s) => s.persistForUser);

  // Hydrate on mount
  useEffect(() => {
    if (userId) hydrateForUser(userId);
  }, [hydrateForUser, userId]);

  // Resume draft if draftId is provided in URL
  const draftLoadedRef = useRef(false);
  useEffect(() => {
    if (!resumeDraftId || draftLoadedRef.current) return;
    draftLoadedRef.current = true;

    async function loadDraft() {
      try {
        const data = await getWorldDraft(resumeDraftId);
        if (data && typeof data === 'object') {
          const record = data as Record<string, unknown>;
          if (record.sourceText) {
            patchSnapshot({ sourceText: String(record.sourceText || '') });
          }
          if (record.sourceRef) {
            patchSnapshot({ sourceRef: String(record.sourceRef || '') });
          }
          const status = String(record.status || 'DRAFT');
          if (status === 'SYNTHESIZE') {
            setCreateStep('SYNTHESIZE');
          } else if (status === 'REVIEW') {
            setCreateStep('CHECKPOINTS');
          } else if (status === 'PUBLISH') {
            setCreateStep('PUBLISH');
          }
        }
      } catch {
        setNotice('Failed to load draft. Starting fresh.');
      }
    }

    void loadDraft();
  }, [resumeDraftId, patchSnapshot, setCreateStep]);

  // Persist on snapshot change
  useEffect(() => {
    if (userId) persistForUser(userId);
  }, [persistForUser, snapshot, userId]);

  // Mutations
  const mutations = useWorldMutations();

  // Local UI state
  const [phase1, setPhase1] = useState<Phase1Result | null>(null);
  const [phase2, setPhase2] = useState<Phase2Result | null>(null);
  const [activeDraftId, setActiveDraftId] = useState(resumeDraftId);
  const [sourceMode, setSourceMode] = useState<'TEXT' | 'FILE'>('TEXT');
  const [sourceEncoding, setSourceEncoding] = useState<'utf-8' | 'gb18030' | 'utf-16le'>('utf-8');
  const [filePreviewText, setFilePreviewText] = useState('');
  const [retryWithFineRoute, setRetryWithFineRoute] = useState(false);
  const [retryScope, setRetryScope] = useState<'all' | 'json' | 'coarse' | 'fine'>('all');
  const [retryConcurrency, setRetryConcurrency] = useState(3);
  const [retryErrorCode, setRetryErrorCode] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const sourceChunksRef = useRef<string[]>([]);
  const sourceRawTextRef = useRef('');

  // Restore phase1 from snapshot artifact
  useEffect(() => {
    const artifact = snapshot.phase1Artifact;
    if (!artifact) {
      if (phase1) setPhase1(null);
      return;
    }
    if (phase1) return;
    setPhase1({
      startTimeOptions: artifact.startTimeOptions,
      characterCandidates: artifact.characterCandidates,
      knowledgeGraph: snapshot.knowledgeGraph,
      finalDraftAccumulator: snapshot.finalDraftAccumulator,
      qualityGate: artifact.qualityGate,
      chunkTasks: artifact.chunkTasks,
      rawText: JSON.stringify({ restoredFromArtifact: true, updatedAt: artifact.updatedAt }),
    });
  }, [snapshot.phase1Artifact, snapshot.knowledgeGraph, snapshot.finalDraftAccumulator, phase1]);

  // Callbacks wired to store
  const onStepChange = useCallback((step: WorldStudioCreateStep) => setCreateStep(step), [setCreateStep]);
  const onSourceTextChange = useCallback((value: string) => patchSnapshot({ sourceText: value }), [patchSnapshot]);
  const onSourceRefChange = useCallback((value: string) => patchSnapshot({ sourceRef: value }), [patchSnapshot]);
  const onSourceEncodingChange = useCallback((enc: 'utf-8' | 'gb18030' | 'utf-16le') => setSourceEncoding(enc), []);
  const onSelectSourceFile = useCallback((file: File | null) => {
    if (!file) {
      setSourceMode('TEXT');
      setFilePreviewText('');
      return;
    }
    setSourceMode('FILE');
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      setFilePreviewText(text.slice(0, 2000));
      sourceRawTextRef.current = text;
      patchSnapshot({ sourceRef: file.name });
    };
    reader.readAsText(file, sourceEncoding);
  }, [patchSnapshot, sourceEncoding]);

  const onSelectStartTimeId = useCallback((value: string) =>
    patchSnapshot({ selectedStartTimeId: value }), [patchSnapshot]);

  const onToggleCharacter = useCallback((name: string, checked: boolean) => {
    const current = snapshot.selectedCharacters;
    const next = checked
      ? [...current, name]
      : current.filter((c) => c !== name);
    patchSnapshot({ selectedCharacters: next });
  }, [patchSnapshot, snapshot.selectedCharacters]);

  const onToggleAgentSyncCharacter = useCallback((name: string, checked: boolean) => {
    const current = snapshot.agentSync.selectedCharacterIds;
    const next = checked
      ? [...current, name]
      : current.filter((c) => c !== name);
    patchSnapshot({ agentSync: { ...snapshot.agentSync, selectedCharacterIds: next } });
  }, [patchSnapshot, snapshot.agentSync]);

  const onTimeFlowRatioChange = useCallback((value: string) =>
    patchSnapshot({ worldviewPatch: setTimeFlowRatioOnWorldviewPatch(snapshot.worldviewPatch, value) }), [patchSnapshot, snapshot.worldviewPatch]);

  const onFutureEventsTextChange = useCallback((value: string) =>
    patchSnapshot({ futureEventsText: value }), [patchSnapshot]);

  const onWorldPatchChange = useCallback((value: Record<string, unknown>) =>
    patchSnapshot({ worldPatch: value }), [patchSnapshot]);

  const onWorldviewPatchChange = useCallback((value: Record<string, unknown>) =>
    patchSnapshot({ worldviewPatch: value }), [patchSnapshot]);

  const onAgentDraftChange = useCallback((name: string, patch: Partial<WorldStudioAgentDraft>) => {
    patchSnapshot({
      agentSync: {
        ...snapshot.agentSync,
        draftsByCharacter: {
          ...snapshot.agentSync.draftsByCharacter,
          [name]: {
            ...(snapshot.agentSync.draftsByCharacter[name] || {
              characterName: name,
              handle: '',
              concept: '',
              backstory: '',
              coreValues: '',
              relationshipStyle: '',
            }),
            ...patch,
          },
        },
      },
    });
  }, [patchSnapshot, snapshot.agentSync]);

  const onEventsGraphChange = useCallback((next: { primary: EventNodeDraft[]; secondary: EventNodeDraft[] }) =>
    patchSnapshot({ eventsDraft: next }), [patchSnapshot]);

  const onEventGraphLayoutChange = useCallback((next: { selectedEventId: string; expandedPrimaryIds: string[] }) =>
    patchSnapshot({ eventGraphLayout: next }), [patchSnapshot]);

  const onLorebooksChange = useCallback((value: WorldLorebookDraftRow[]) =>
    patchSnapshot({ lorebooksDraft: value }), [patchSnapshot]);

  // Pipeline execution callbacks — wired to runtime AI client
  const onRunPhase1 = useCallback(() => {
    const sourceText = sourceMode === 'FILE' ? sourceRawTextRef.current : (snapshot.sourceText || '');
    if (!sourceText.trim()) {
      setNotice('Please provide source text before running extraction.');
      return;
    }
    setNotice(null);
    setCreateStep('INGEST');
    patchSnapshot({
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
    sourceChunksRef.current = chunks;
    void (async () => {
      try {
        const result = await runPhase1ExtractionFromChunks(aiClient, chunks, {
          onProgress: (progress) => {
            patchSnapshot({
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
              setCreateStep('EXTRACT');
            }
          },
          onFinalDraftAccumulatorUpdate: (acc) => {
            patchSnapshot({ finalDraftAccumulator: acc });
          },
        });
        setPhase1(result);
        patchSnapshot({
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
        setCreateStep('CHECKPOINTS');
        if (result.qualityGate.status === 'PASS') {
          setNotice('Extraction completed. Confirm checkpoints.');
        } else if (result.qualityGate.status === 'WARN') {
          setNotice('Extraction completed with warnings. Confirm checkpoints before synthesize.');
        } else {
          setNotice('Extraction completed, but quality gate blocked. Try rerunning failed chunks.');
        }
      } catch (error) {
        patchSnapshot({
          parseJob: {
            phase: 'failed',
            updatedAt: new Date().toISOString(),
          },
        });
        setNotice(error instanceof Error ? error.message : 'Phase 1 extraction failed.');
      }
    })();
  }, [sourceMode, snapshot.sourceText, setCreateStep, patchSnapshot]);

  const onRunFailedChunks = useCallback(() => {
    if (!phase1) {
      setNotice('No Phase 1 result to retry from.');
      return;
    }
    const sourceText = sourceMode === 'FILE' ? sourceRawTextRef.current : (snapshot.sourceText || '');
    const allChunks = sourceChunksRef.current.length > 0
      ? sourceChunksRef.current
      : splitSourceText(sourceText);
    if (allChunks.length === 0) {
      setNotice('No source chunks available for retry.');
      return;
    }
    const failedIndices = toFailedChunkIndices(
      phase1.chunkTasks as Array<{ chunkIndex: number; status: 'success' | 'failed'; stage?: string; errorCode?: string; errorMessage?: string }>,
      allChunks.length,
      retryScope,
    );
    if (failedIndices.length === 0) {
      setNotice('No failed chunks to retry.');
      return;
    }
    setNotice(null);
    const chunksToRetry = failedIndices.map((i) => allChunks[i]!).filter(Boolean);
    const aiClient = createForgeAiClient();
    patchSnapshot({
      parseJob: {
        phase: 'extract',
        progress: 0.1,
        updatedAt: new Date().toISOString(),
      },
    });
    setCreateStep('EXTRACT');
    void (async () => {
      try {
        const result = await runPhase1ExtractionFromChunks(aiClient, chunksToRetry, {
          chunkIndexMap: failedIndices,
          maxConcurrency: retryConcurrency,
          onProgress: (progress) => {
            patchSnapshot({
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
            patchSnapshot({ finalDraftAccumulator });
          },
        });
        setPhase1(result);
        patchSnapshot({
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
        setCreateStep('CHECKPOINTS');
        setNotice('Failed chunks re-extracted. Confirm checkpoints.');
      } catch (error) {
        patchSnapshot({
          parseJob: {
            phase: 'failed',
            updatedAt: new Date().toISOString(),
          },
        });
        setNotice(error instanceof Error ? error.message : 'Retry failed chunks failed.');
      }
    })();
  }, [phase1, sourceMode, snapshot.sourceText, retryScope, retryConcurrency, setCreateStep, patchSnapshot]);

  const onRunFailedChunksByErrorCode = useCallback((errorCode: string) => {
    if (!phase1) {
      setNotice('No Phase 1 result to retry from.');
      return;
    }
    const sourceText = sourceMode === 'FILE' ? sourceRawTextRef.current : (snapshot.sourceText || '');
    const allChunks = sourceChunksRef.current.length > 0
      ? sourceChunksRef.current
      : splitSourceText(sourceText);
    if (allChunks.length === 0) {
      setNotice('No source chunks available for retry.');
      return;
    }
    const failedIndices = toFailedChunkIndices(
      phase1.chunkTasks as Array<{ chunkIndex: number; status: 'success' | 'failed'; stage?: string; errorCode?: string; errorMessage?: string }>,
      allChunks.length,
      retryScope,
      errorCode,
    );
    if (failedIndices.length === 0) {
      setNotice(`No failed chunks matching error code "${errorCode}".`);
      return;
    }
    setNotice(null);
    setRetryErrorCode(errorCode);
    const chunksToRetry = failedIndices.map((i) => allChunks[i]!).filter(Boolean);
    const aiClient = createForgeAiClient();
    patchSnapshot({
      parseJob: {
        phase: 'extract',
        progress: 0.1,
        updatedAt: new Date().toISOString(),
      },
    });
    setCreateStep('EXTRACT');
    void (async () => {
      try {
        const result = await runPhase1ExtractionFromChunks(aiClient, chunksToRetry, {
          chunkIndexMap: failedIndices,
          maxConcurrency: retryConcurrency,
          onProgress: (progress) => {
            patchSnapshot({
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
            patchSnapshot({ finalDraftAccumulator });
          },
        });
        setPhase1(result);
        patchSnapshot({
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
        setCreateStep('CHECKPOINTS');
        setNotice(`Retry by error code "${errorCode}" completed. Confirm checkpoints.`);
      } catch (error) {
        patchSnapshot({
          parseJob: {
            phase: 'failed',
            updatedAt: new Date().toISOString(),
          },
        });
        setNotice(error instanceof Error ? error.message : 'Retry by error code failed.');
      }
    })();
  }, [phase1, sourceMode, snapshot.sourceText, retryScope, retryConcurrency, setCreateStep, patchSnapshot]);

  const onRefreshQualityGate = useCallback(() => {
    if (!phase1) return;
    setPhase1({ ...phase1 });
  }, [phase1]);

  const onRunPhase2 = useCallback(() => {
    if (!phase1 || !phase1.qualityGate.pass) {
      setNotice('Phase 1 extraction must pass quality gate before synthesize.');
      return;
    }
    const selectedStartTimeId = snapshot.selectedStartTimeId || '';
    const selectedCharacters = snapshot.selectedCharacters;
    if (!selectedStartTimeId) {
      setNotice('Please select a start time before synthesize.');
      return;
    }
    if (selectedCharacters.length === 0) {
      setNotice('Please select at least one character before synthesize.');
      return;
    }
    setNotice(null);
    setCreateStep('SYNTHESIZE');
    patchSnapshot({
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
          selectedStartTimeId,
          selectedCharacters,
          knowledgeGraph: snapshot.knowledgeGraph as Record<string, unknown>,
          finalDraftAccumulator: snapshot.finalDraftAccumulator,
        });
        setPhase2(result);
        const draftsByCharacter = (result.agentDrafts || []).reduce(
          (acc, item) => {
            const name = String(item.characterName || '').trim();
            if (name) acc[name] = { ...item, dna: item.dna };
            return acc;
          },
          {} as Record<string, (typeof result.agentDrafts)[number]>,
        );
        patchSnapshot({
          worldPatch: result.world,
          worldviewPatch: result.worldview,
          lorebooksDraft: Array.isArray(result.worldLorebooks)
            ? result.worldLorebooks.filter((item) => item && typeof item === 'object') as WorldLorebookDraftRow[]
            : [],
          futureEventsText: JSON.stringify(result.futureHistoricalEvents || [], null, 2),
          finalDraftAccumulator: result.finalDraftAccumulator || snapshot.finalDraftAccumulator,
          agentSync: {
            ...snapshot.agentSync,
            draftsByCharacter: {
              ...snapshot.agentSync.draftsByCharacter,
              ...draftsByCharacter,
            },
          },
          parseJob: {
            phase: 'done',
            progress: 1,
            chunkProcessed: snapshot.parseJob.chunkTotal,
            etaSeconds: 0,
            updatedAt: new Date().toISOString(),
          },
        });
        setCreateStep('DRAFT');
        setNotice('Synthesize completed. Draft editor is ready.');
      } catch (error) {
        patchSnapshot({
          parseJob: {
            phase: 'failed',
            updatedAt: new Date().toISOString(),
          },
        });
        setNotice(error instanceof Error ? error.message : 'Phase 2 synthesis failed.');
      }
    })();
  }, [phase1, snapshot.selectedStartTimeId, snapshot.selectedCharacters, snapshot.knowledgeGraph, snapshot.finalDraftAccumulator, snapshot.agentSync, snapshot.parseJob.chunkTotal, setCreateStep, patchSnapshot]);

  const onGenerateWorldCover = useCallback(() => {
    setNotice(null);
    patchSnapshot({
      assets: {
        worldCover: { status: 'running', imageUrl: null },
      },
    });
    const { runtime } = getPlatformClient();
    const world = snapshot.worldPatch as Record<string, unknown>;
    const prompt = [
      'Generate a cinematic world cover image.',
      `World name: ${String(world.name || 'Untitled World')}`,
      `World description: ${String(world.description || snapshot.knowledgeGraph.worldSetting || '')}`,
    ].join('\n');
    void (async () => {
      try {
        const result = await runtime.media.image.generate({
          model: 'auto',
          prompt,
          responseFormat: 'url',
        });
        const imageUrl = resolveGeneratedImageUrl(result.artifacts);
        patchSnapshot({
          assets: {
            worldCover: { status: 'succeeded', imageUrl },
          },
        });
        setNotice('World cover generated.');
      } catch (error) {
        patchSnapshot({
          assets: {
            worldCover: { status: 'failed', imageUrl: null },
          },
        });
        setNotice(error instanceof Error ? error.message : 'World cover generation failed.');
      }
    })();
  }, [snapshot.worldPatch, snapshot.knowledgeGraph.worldSetting, patchSnapshot]);

  const onGenerateCharacterPortrait = useCallback((name: string) => {
    setNotice(null);
    const portraits = { ...snapshot.assets.characterPortraits };
    portraits[name] = { status: 'running', imageUrl: null };
    patchSnapshot({
      assets: {
        characterPortraits: portraits,
      },
    });
    const { runtime } = getPlatformClient();
    const prompt = [
      'Generate a portrait image for this world character.',
      `Character: ${name}`,
      `World setting: ${snapshot.knowledgeGraph.worldSetting || 'N/A'}`,
    ].join('\n');
    void (async () => {
      try {
        const result = await runtime.media.image.generate({
          model: 'auto',
          prompt,
          responseFormat: 'url',
        });
        const imageUrl = resolveGeneratedImageUrl(result.artifacts);
        patchSnapshot({
          assets: {
            characterPortraits: {
              ...snapshot.assets.characterPortraits,
              [name]: { status: 'succeeded', imageUrl },
            },
          },
        });
        setNotice(`Portrait generated for ${name}.`);
      } catch (error) {
        patchSnapshot({
          assets: {
            characterPortraits: {
              ...snapshot.assets.characterPortraits,
              [name]: { status: 'failed', imageUrl: null },
            },
          },
        });
        setNotice(error instanceof Error ? error.message : `Portrait generation failed for ${name}.`);
      }
    })();
  }, [snapshot.assets.characterPortraits, snapshot.knowledgeGraph.worldSetting, patchSnapshot]);

  // Derived state
  const activeTask = snapshot.taskState.activeTask;
  const working = activeTask ? ['RUNNING', 'PAUSE_REQUESTED'].includes(activeTask.status) : false;
  const selectedAgentSyncCharacters = snapshot.agentSync.selectedCharacterIds.length > 0
    ? snapshot.agentSync.selectedCharacterIds
    : snapshot.selectedCharacters;
  const timeFlowRatio = getTimeFlowRatioFromWorldviewPatch(snapshot.worldviewPatch);
  const createDisplayStage = toCreateDisplayStage(snapshot.createStep);
  const importSubview = toImportSubview(snapshot.createStep);
  const reviewSubview = toReviewSubview(snapshot.createStep);

  const persistDraft = useCallback(async () => {
    const result = await mutations.saveDraftMutation.mutateAsync({
      draftId: activeDraftId || undefined,
      sourceType: sourceMode,
      sourceRef: snapshot.sourceRef || '',
      status: toDraftStatus(snapshot.createStep),
      pipelineState: {
        createStep: snapshot.createStep,
        parseJob: snapshot.parseJob,
        phase1Artifact: snapshot.phase1Artifact,
      },
      draftPayload: {
        sourceText: snapshot.sourceText,
        sourceRef: snapshot.sourceRef,
        worldPatch: snapshot.worldPatch,
        worldviewPatch: snapshot.worldviewPatch,
        eventsDraft: snapshot.eventsDraft,
        lorebooksDraft: snapshot.lorebooksDraft,
        futureEventsText: snapshot.futureEventsText,
        selectedStartTimeId: snapshot.selectedStartTimeId,
        selectedCharacters: snapshot.selectedCharacters,
      },
    });
    const record = result && typeof result === 'object' ? (result as Record<string, unknown>) : {};
    const draftId = String(record.id || activeDraftId || '').trim();
    if (draftId) {
      setActiveDraftId(draftId);
    }
    return draftId;
  }, [activeDraftId, mutations.saveDraftMutation, snapshot, sourceMode]);

  const publishDraft = useCallback(async () => {
    const draftId = (await persistDraft()) || activeDraftId;
    if (!draftId) {
      throw new Error('Draft id is required before publishing.');
    }
    await mutations.publishDraftMutation.mutateAsync({
      draftId,
      reason: 'Forge manual publish',
    });
    setNotice('Draft published.');
  }, [activeDraftId, mutations.publishDraftMutation, persistDraft]);

  const workflow: WorldStudioWorkflowSlice = {
    landing: { target: 'CREATE', worldId: null, reason: null },
    landingTarget: 'CREATE',
    worlds: [],
    drafts: [],
    primaryWorld: null,
    latestDraft: null,
    selectedWorldId: '',
    selectedDraftId: activeDraftId,
    createDisplayStage,
    createStageAccess: {
      IMPORT: { enabled: true, reason: null },
      CURATE: { enabled: true, reason: null },
      GENERATE: { enabled: true, reason: null },
      REVIEW: { enabled: true, reason: null },
    },
    activeDomain: 'WORLD',
    activeSection: 'BASE',
    selectedAgentId: '',
  };

  const main: WorldStudioMainSlice = {
    snapshot,
    phase1,
    phase2,
    sourceMode,
    sourceEncoding,
    filePreviewText,
    retryWithFineRoute,
    retryScope,
    retryConcurrency,
    retryErrorCode,
    routeOptions: null,
    eventSyncMode: 'merge',
    selectedAgentSyncCharacters,
    eventsGraph: snapshot.eventsDraft,
    timeFlowRatio,
    importSubview,
    reviewSubview,
    working,
    creatorAgents: [],
    selectedCreatorAgent: null,
    mediaBindings: [],
  };

  const routing: WorldStudioRoutingSlice = {
    activeCoarseRouteSource: 'local',
    activeCoarseRouteConnectorId: '',
    activeFineRouteSource: 'local',
    activeFineRouteConnectorId: '',
    effectiveCoarseRouteBinding: null,
    effectiveFineRouteBinding: null,
    coarseRouteModelOptions: [],
    fineRouteModelOptions: [],
    routeConnectors: [],
    routeConfigReady: true,
    routeConfigReasonCode: '',
    routeConfigActionHint: 'none',
    coarseRouteReadiness: { ready: true, reasonCode: '', actionHint: 'none', message: '' },
    fineRouteReadiness: { ready: true, reasonCode: '', actionHint: 'none', message: '' },
    embeddingReadiness: { healthy: true, reasonCode: '', actionHint: 'none', message: '' },
    embeddingIndexStatus: 'idle',
    embeddingEntryCount: 0,
    embeddingIndexLastBuiltAt: null,
    embeddingIndexErrorMessage: null,
    effectiveCoarseRouteSummary: '',
    effectiveFineRouteSummary: '',
  };

  const status: WorldStudioStatusSlice = {
    landingLoading: false,
    activeTask: snapshot.taskState.activeTask,
    recentTasks: snapshot.taskState.recentTasks,
    expertMode: snapshot.taskState.expertMode,
    notice,
    error: null,
    conflictReloadSummary: null,
    hasMaintenanceConflict: false,
    maintenanceEditorSnapshotVersion: snapshot.editorSnapshotVersion,
    mutations: [],
    storyProjectionCount: Array.isArray(phase2?.worldEvents) ? phase2.worldEvents.length : 0,
    storyProjectionMissingContextCount: 0,
    storyProjectionLatestAt: '',
    primaryEventCount: snapshot.eventsDraft.primary.length,
    secondaryEventCount: snapshot.eventsDraft.secondary.length,
    missingPrimaryEvidenceCount: 0,
    eventCharacterCoverage: snapshot.selectedCharacters.length,
    eventLocationCoverage: 0,
    terminalChunkSuccess: snapshot.parseJob.chunkCompleted,
    terminalChunkTotal: snapshot.parseJob.chunkTotal,
    terminalChunkFailed: snapshot.parseJob.chunkFailed,
    terminalTopFailure: null,
  };

  const actions: WorldStudioActionsSlice = {
    workflow: {
      loadLanding: async () => undefined,
      openMaintenance: () => undefined,
      openCreate: (draftId) => {
        setActiveDraftId(draftId || '');
      },
      selectCreateDisplayStage: (stage) => {
        if (stage === 'IMPORT') {
          onStepChange('SOURCE');
          return;
        }
        if (stage === 'CURATE') {
          onStepChange('CHECKPOINTS');
          return;
        }
        if (stage === 'GENERATE') {
          onStepChange('SYNTHESIZE');
          return;
        }
        onStepChange('DRAFT');
      },
      selectMaintainDomain: () => undefined,
      selectMaintainSection: () => undefined,
      selectMaintainAgent: () => undefined,
      refreshWorkspace: async () => undefined,
      openRuntimeSetup: () => navigate('/runtime'),
    },
    source: {
      onSourceTextChange,
      onSourceRefChange,
      onSourceEncodingChange,
      onSelectSourceFile: async (file) => {
        onSelectSourceFile(file);
      },
      startExtraction: async () => {
        onRunPhase1();
      },
      retryFailed: async () => {
        onRunFailedChunks();
      },
      retryFailedByErrorCode: async (errorCode) => {
        onRunFailedChunksByErrorCode(errorCode);
      },
      clearRetryErrorCode: () => setRetryErrorCode(null),
      setRetryWithFineRoute,
      setRetryScope,
      setRetryConcurrency,
    },
    curate: {
      onSelectStartTimeId,
      onToggleCharacter,
      onEventsGraphChange,
      onEventGraphLayoutChange,
      refreshQualityGate: onRefreshQualityGate,
      continueToGenerate: async () => {
        onRunPhase2();
      },
    },
    generate: {
      onTimeFlowRatioChange,
      onFutureEventsTextChange,
      onGenerateWorldCover: async () => {
        onGenerateWorldCover();
      },
      onGenerateCharacterPortrait: async (name) => {
        onGenerateCharacterPortrait(name);
      },
      onToggleAgentSyncCharacter,
      onAgentDraftChange,
      runPhase2: async () => {
        onRunPhase2();
      },
    },
    review: {
      onWorldPatchChange,
      onWorldviewPatchChange,
      onEventsChange: onEventsGraphChange,
      onLorebooksChange,
      onEventGraphLayoutChange,
      saveDraft: async () => {
        await persistDraft();
        setNotice('Draft saved.');
      },
      publishDraft,
      backToEdit: () => onStepChange('DRAFT'),
    },
    maintain: {
      onWorldPatchChange,
      onWorldviewPatchChange,
      onEventsChange: onEventsGraphChange,
      onLorebooksChange,
      onEventGraphLayoutChange,
      onEventSyncModeChange: async () => undefined,
      saveMaintenance: async () => undefined,
      syncEvents: async () => undefined,
      syncLorebooks: async () => undefined,
      deleteFirstEvent: async () => undefined,
      deleteFirstLorebook: async () => undefined,
      createAgentsFromDrafts: async () => undefined,
      updateCreatorAgentMetadata: async () => undefined,
      setSectionDirty: () => undefined,
      syncMediaBindings: async () => undefined,
      refreshResources: async () => undefined,
      reloadRemote: async () => undefined,
      adoptRemoteSnapshot: () => undefined,
    },
    routing: {
      onRouteSourceChange: () => undefined,
      onRouteConnectorChange: () => undefined,
      onRouteModelChange: () => undefined,
      onClearRouteBinding: () => undefined,
      onRebuildEmbeddingIndex: async () => undefined,
      onSetExpertMode: (value) => patchSnapshot({ taskState: { expertMode: value } }),
    },
    task: {
      pauseTask: () => false,
      resumeTask: async () => false,
      cancelTask: () => false,
    },
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/worlds')}
            className="text-sm text-neutral-400 hover:text-white transition-colors"
          >
            &larr; {t('worlds.backToList', 'Back')}
          </button>
          <h1 className="text-lg font-semibold text-white">
            {t('pages.worldCreate', 'Create World')}
          </h1>
        </div>
      </div>

      {/* Notice banner */}
      {notice && (
        <div className="bg-yellow-500/10 border-b border-yellow-500/20 px-4 py-2 text-sm text-yellow-400 flex items-center justify-between">
          <span>{notice}</span>
          <button onClick={() => setNotice(null)} className="text-yellow-400/60 hover:text-yellow-400">
            &times;
          </button>
        </div>
      )}

      {/* Workbench */}
      <div className="min-h-0 flex-1">
        <CreateWorkbench
          workflow={workflow}
          main={main}
          routing={routing}
          status={status}
          actions={actions}
        />
      </div>
    </div>
  );
}
