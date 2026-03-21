import { Runtime } from '../../src/runtime/index.js';

import {
  speechSynthesizeOutput,
  speechTranscribeOutput,
  textEmbedOutput,
  textGenerateOutput,
} from '../helpers/runtime-ai-shapes.js';

export const APP_ID = 'nimi.ai.provider.test';
export const SUBJECT_USER_ID = 'user-test-1';

async function* emptyAsyncIterable<T>(): AsyncIterable<T> {
  // no-op
}

export function createRuntimeStub(
  aiOverrides: Partial<{
    generate: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    streamGenerate: (request: Record<string, unknown>) => Promise<AsyncIterable<Record<string, unknown>>>;
    embed: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    submitScenarioJob: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    getScenarioJob: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    cancelScenarioJob: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
    subscribeScenarioJobEvents: (request: Record<string, unknown>) => Promise<AsyncIterable<Record<string, unknown>>>;
    getScenarioArtifacts: (request: Record<string, unknown>) => Promise<Record<string, unknown>>;
  }>,
): Runtime {
  const asRecord = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  };
  const normalizeText = (value: unknown): string => String(value || '').trim();
  const scenarioTypeToModal = (scenarioType: number): number => {
    switch (scenarioType) {
      case 3:
        return 2;
      case 4:
        return 3;
      case 5:
        return 4;
      case 6:
        return 5;
      default:
        return 0;
    }
  };
  const modalToScenarioType = (modal: number): number => {
    switch (modal) {
      case 2:
        return 3;
      case 3:
        return 4;
      case 4:
        return 5;
      case 5:
        return 6;
      default:
        return 0;
    }
  };
  const oneofSpecFromScenarioSpec = (specValue: unknown): Record<string, unknown> => {
    const spec = asRecord(asRecord(specValue).spec);
    const oneofKind = normalizeText(spec.oneofKind);
    if (oneofKind === 'imageGenerate') {
      return {
        oneofKind: 'imageSpec',
        imageSpec: asRecord(spec.imageGenerate),
      };
    }
    if (oneofKind === 'videoGenerate') {
      return {
        oneofKind: 'videoSpec',
        videoSpec: asRecord(spec.videoGenerate),
      };
    }
    if (oneofKind === 'speechSynthesize') {
      return {
        oneofKind: 'speechSpec',
        speechSpec: asRecord(spec.speechSynthesize),
      };
    }
    if (oneofKind === 'speechTranscribe') {
      return {
        oneofKind: 'transcriptionSpec',
        transcriptionSpec: asRecord(spec.speechTranscribe),
      };
    }
    return {
      oneofKind: undefined,
    };
  };
  const toEmbeddingOutput = (value: unknown): Record<string, unknown> => {
    const vectors = Array.isArray(asRecord(value).vectors) ? asRecord(value).vectors as unknown[] : [];
    const normalized = vectors.map((entry) => {
      if (Array.isArray(entry)) {
        return entry.map((item) => Number(item)).filter((item) => Number.isFinite(item));
      }
      const values = Array.isArray(asRecord(entry).values) ? asRecord(entry).values as unknown[] : [];
      return values.map((item) => {
        const kind = asRecord(asRecord(item).kind);
        if (kind.oneofKind === 'numberValue') {
          const parsed = Number(kind.numberValue);
          return Number.isFinite(parsed) ? parsed : null;
        }
        return null;
      }).filter((item): item is number => item !== null);
    });
    return textEmbedOutput(normalized) as unknown as Record<string, unknown>;
  };

  const scenarioJobs = new Map<string, {
    job: {
      jobId: string;
      status: number;
      scenarioType: number;
      routeDecision: number;
      modelResolved: string;
      traceId: string;
    };
    artifacts: Array<{
      artifactId: string;
      mimeType: string;
      bytes: Uint8Array;
    }>;
  }>();
  let scenarioJobCounter = 0;
  const outputForScenarioEntry = (
    entry: {
      job: { scenarioType: number };
      artifacts: Array<{ artifactId: string; mimeType: string; bytes: Uint8Array }>;
    } | undefined,
  ): Record<string, unknown> | undefined => {
    if (!entry) {
      return undefined;
    }
    const firstArtifact = entry.artifacts[0];
    if (entry.job.scenarioType === 5) {
      return speechSynthesizeOutput(firstArtifact?.artifactId || 'tts-artifact') as unknown as Record<string, unknown>;
    }
    if (entry.job.scenarioType !== 6) {
      return undefined;
    }
    const text = firstArtifact ? Buffer.from(firstArtifact.bytes).toString('utf8') : '';
    return speechTranscribeOutput(text, firstArtifact?.artifactId || 'stt-artifact') as unknown as Record<string, unknown>;
  };

  const scenarioBridge = {
    generate: async () => ({
      output: textGenerateOutput('ok') as unknown as Record<string, unknown>,
      finishReason: 1,
      usage: {
        inputTokens: '1',
        outputTokens: '1',
      },
      routeDecision: 1,
      modelResolved: 'model/default',
      traceId: 'trace-default',
    }),
    streamGenerate: async () => emptyAsyncIterable<Record<string, unknown>>(),
    embed: async () => ({
      vectors: [],
      usage: {
        inputTokens: '0',
      },
      routeDecision: 1,
      modelResolved: 'embed/default',
      traceId: 'trace-embed',
    }),
    submitScenarioJob: async (request: Record<string, unknown>) => {
      scenarioJobCounter += 1;
      const jobId = `job-default-${scenarioJobCounter}`;
      const modal = Number(request.modal || 0);
      const modelResolved = String(request.modelId || 'media/default');
      const traceId = `trace-scenario-${scenarioJobCounter}`;
      const artifact = modal === 5
        ? {
          artifactId: `${jobId}-artifact-1`,
          mimeType: 'text/plain',
          bytes: Buffer.from('ok', 'utf8'),
        }
        : {
          artifactId: `${jobId}-artifact-1`,
          mimeType: 'application/octet-stream',
          bytes: Uint8Array.from([1]),
        };
      scenarioJobs.set(jobId, {
        job: {
          jobId,
          status: 4,
          scenarioType: modalToScenarioType(modal),
          routeDecision: 1,
          modelResolved,
          traceId,
        },
        artifacts: [artifact],
      });
      return {
        job: scenarioJobs.get(jobId)?.job,
      };
    },
    getScenarioJob: async (request: Record<string, unknown>) => ({
      job: scenarioJobs.get(String(request.jobId || ''))?.job,
    }),
    cancelScenarioJob: async () => ({
      canceled: true,
    }),
    subscribeScenarioJobEvents: async () => emptyAsyncIterable<Record<string, unknown>>(),
    getScenarioArtifacts: async (request: Record<string, unknown>) => {
      const entry = scenarioJobs.get(String(request.jobId || ''));
      return {
        jobId: entry?.job.jobId || '',
        artifacts: entry?.artifacts || [],
        traceId: entry?.job.traceId || '',
        output: outputForScenarioEntry(entry),
      };
    },
    ...aiOverrides,
  };

  const ai = {
    executeScenario: async (request) => {
      const requestRecord = request as unknown as Record<string, unknown>;
      const head = asRecord(requestRecord.head);
      const fallback = typeof head.fallback === 'undefined' ? 1 : head.fallback;
      const scenarioType = Number(requestRecord.scenarioType || 0);
      const spec = asRecord(asRecord(requestRecord.spec).spec);

      if (scenarioType === 2) {
        const embedResult = await scenarioBridge.embed({
          appId: head.appId,
          subjectUserId: head.subjectUserId,
          modelId: head.modelId,
          routePolicy: head.routePolicy,
          fallback,
          timeoutMs: head.timeoutMs,
          connectorId: head.connectorId,
          inputs: asRecord(spec.textEmbed).inputs,
        });
        return {
          output: toEmbeddingOutput(embedResult),
          finishReason: 0,
          usage: embedResult.usage,
          routeDecision: Number(embedResult.routeDecision || 0),
          modelResolved: normalizeText(embedResult.modelResolved),
          traceId: normalizeText(embedResult.traceId),
          ignoredExtensions: [],
        };
      }

      const generateResult = await scenarioBridge.generate({
        appId: head.appId,
        subjectUserId: head.subjectUserId,
        modelId: head.modelId,
        routePolicy: head.routePolicy,
        fallback,
        timeoutMs: head.timeoutMs,
        connectorId: head.connectorId,
        input: asRecord(spec.textGenerate).input,
        systemPrompt: asRecord(spec.textGenerate).systemPrompt,
        tools: asRecord(spec.textGenerate).tools,
        temperature: asRecord(spec.textGenerate).temperature,
        topP: asRecord(spec.textGenerate).topP,
        maxTokens: asRecord(spec.textGenerate).maxTokens,
      });

      return {
        output: generateResult.output,
        finishReason: Number(generateResult.finishReason || 0),
        usage: generateResult.usage,
        routeDecision: Number(generateResult.routeDecision || 0),
        modelResolved: normalizeText(generateResult.modelResolved),
        traceId: normalizeText(generateResult.traceId),
        ignoredExtensions: [],
      };
    },
    streamScenario: async (request) => {
      const requestRecord = request as unknown as Record<string, unknown>;
      const head = asRecord(requestRecord.head);
      const fallback = typeof head.fallback === 'undefined' ? 1 : head.fallback;
      const spec = asRecord(asRecord(requestRecord.spec).spec);
      return scenarioBridge.streamGenerate({
        appId: head.appId,
        subjectUserId: head.subjectUserId,
        modelId: head.modelId,
        routePolicy: head.routePolicy,
        fallback,
        timeoutMs: head.timeoutMs,
        connectorId: head.connectorId,
        input: asRecord(spec.textGenerate).input,
        systemPrompt: asRecord(spec.textGenerate).systemPrompt,
        tools: asRecord(spec.textGenerate).tools,
        temperature: asRecord(spec.textGenerate).temperature,
        topP: asRecord(spec.textGenerate).topP,
        maxTokens: asRecord(spec.textGenerate).maxTokens,
      }) as unknown as AsyncIterable<Record<string, unknown>>;
    },
    submitScenarioJob: async (request) => {
      const requestRecord = request as unknown as Record<string, unknown>;
      const head = asRecord(requestRecord.head);
      const fallback = typeof head.fallback === 'undefined' ? 1 : head.fallback;
      const scenarioType = Number(requestRecord.scenarioType || 0);
      const scenarioResponse = await scenarioBridge.submitScenarioJob({
        appId: head.appId,
        subjectUserId: head.subjectUserId,
        modelId: head.modelId,
        modal: scenarioTypeToModal(scenarioType),
        routePolicy: head.routePolicy,
        fallback,
        timeoutMs: head.timeoutMs,
        connectorId: head.connectorId,
        requestId: requestRecord.requestId,
        idempotencyKey: requestRecord.idempotencyKey,
        labels: requestRecord.labels,
        spec: oneofSpecFromScenarioSpec(requestRecord.spec),
      });
      const scenarioSnapshot = asRecord(scenarioResponse.job);
      return {
        job: {
          jobId: normalizeText(scenarioSnapshot.jobId),
          head: {
            appId: normalizeText(head.appId),
            subjectUserId: normalizeText(head.subjectUserId),
            modelId: normalizeText(head.modelId),
            routePolicy: Number(head.routePolicy || 0),
            fallback: Number(fallback || 0),
            timeoutMs: Number(head.timeoutMs || 0),
            connectorId: normalizeText(head.connectorId),
          },
          scenarioType,
          executionMode: 3,
          routeDecision: Number(scenarioSnapshot.routeDecision || 0),
          modelResolved: normalizeText(scenarioSnapshot.modelResolved),
          status: Number(scenarioSnapshot.status || 0),
          providerJobId: normalizeText(scenarioSnapshot.providerJobId),
          reasonCode: scenarioSnapshot.reasonCode,
          reasonDetail: normalizeText(scenarioSnapshot.reasonDetail),
          retryCount: Number(scenarioSnapshot.retryCount || 0),
          createdAt: scenarioSnapshot.createdAt,
          updatedAt: scenarioSnapshot.updatedAt,
          nextPollAt: scenarioSnapshot.nextPollAt,
          artifacts: [],
          usage: scenarioSnapshot.usage,
          traceId: normalizeText(scenarioSnapshot.traceId),
          ignoredExtensions: [],
        },
      };
    },
    getScenarioJob: async (request) => {
      const requestRecord = request as unknown as Record<string, unknown>;
      const scenarioResponse = await scenarioBridge.getScenarioJob({
        jobId: normalizeText(requestRecord.jobId),
      });
      const scenarioSnapshot = asRecord(scenarioResponse.job);
      const scenarioType = Number(scenarioSnapshot.scenarioType || 0);
      return {
        job: {
          jobId: normalizeText(scenarioSnapshot.jobId),
          head: {
            appId: APP_ID,
            subjectUserId: SUBJECT_USER_ID,
            modelId: normalizeText(scenarioSnapshot.modelResolved),
            routePolicy: 1,
            fallback: 1,
            timeoutMs: 0,
            connectorId: '',
          },
          scenarioType,
          executionMode: 3,
          routeDecision: Number(scenarioSnapshot.routeDecision || 0),
          modelResolved: normalizeText(scenarioSnapshot.modelResolved),
          status: Number(scenarioSnapshot.status || 0),
          providerJobId: normalizeText(scenarioSnapshot.providerJobId),
          reasonCode: scenarioSnapshot.reasonCode,
          reasonDetail: normalizeText(scenarioSnapshot.reasonDetail),
          retryCount: Number(scenarioSnapshot.retryCount || 0),
          createdAt: scenarioSnapshot.createdAt,
          updatedAt: scenarioSnapshot.updatedAt,
          nextPollAt: scenarioSnapshot.nextPollAt,
          artifacts: [],
          usage: scenarioSnapshot.usage,
          traceId: normalizeText(scenarioSnapshot.traceId),
          ignoredExtensions: [],
        },
      };
    },
    cancelScenarioJob: async (request) => {
      const requestRecord = request as unknown as Record<string, unknown>;
      await scenarioBridge.cancelScenarioJob({
        jobId: normalizeText(requestRecord.jobId),
        reason: normalizeText(requestRecord.reason),
      });
      const current = scenarioJobs.get(normalizeText(requestRecord.jobId));
      return {
        job: {
          jobId: normalizeText(requestRecord.jobId),
          head: {
            appId: APP_ID,
            subjectUserId: SUBJECT_USER_ID,
            modelId: current?.job.modelResolved || 'media/default',
            routePolicy: 1,
            fallback: 1,
            timeoutMs: 0,
            connectorId: '',
          },
          scenarioType: current?.job.scenarioType || 3,
          executionMode: 3,
          routeDecision: current?.job.routeDecision || 1,
          modelResolved: current?.job.modelResolved || 'media/default',
          status: 6,
          providerJobId: '',
          reasonCode: 0,
          reasonDetail: '',
          retryCount: 0,
          createdAt: undefined,
          updatedAt: undefined,
          nextPollAt: undefined,
          artifacts: [],
          usage: undefined,
          traceId: current?.job.traceId || '',
          ignoredExtensions: [],
        },
      };
    },
    subscribeScenarioJobEvents: async (request) => scenarioBridge.subscribeScenarioJobEvents(
      request as unknown as Record<string, unknown>,
    ) as unknown as AsyncIterable<Record<string, unknown>>,
    getScenarioArtifacts: async (request) => {
      const requestRecord = request as unknown as Record<string, unknown>;
      const scenarioResponse = await scenarioBridge.getScenarioArtifacts({
        jobId: normalizeText(requestRecord.jobId),
      });
      return {
        jobId: normalizeText(scenarioResponse.jobId),
        artifacts: Array.isArray(scenarioResponse.artifacts) ? scenarioResponse.artifacts : [],
        traceId: normalizeText(scenarioResponse.traceId),
        output: scenarioResponse.output,
      };
    },
    listScenarioProfiles: async () => ({ profiles: [] }),
    getVoiceAsset: async () => ({ asset: undefined }),
    listVoiceAssets: async () => ({ assets: [] }),
    deleteVoiceAsset: async () => ({ deleted: true }),
    listPresetVoices: async () => ({ voices: [] }),
  } as Runtime['ai'];

  const runtime = Object.create(Runtime.prototype) as Runtime;
  (runtime as unknown as { ai: Runtime['ai'] }).ai = ai;
  return runtime;
}
