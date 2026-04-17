import { getPlatformClient } from '@nimiplatform/sdk';
import { type ModRuntimeResolvedBinding, type ModSdkHost, type RuntimeCanonicalCapability, type RuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import {
  getJobState,
  requestCancel,
  startJobTracking,
  startPollingRecovery,
  type JobControllerDeps,
  type JobPollResult,
} from '../../features/turns/scenario-job-controller';
import { cacheSpeechArtifactsForDesktopPlayback } from './runtime-bootstrap-host-capabilities-profiles';
import { ensureResolvedLocalModelAvailable, requireModel } from './runtime-bootstrap-host-capabilities-routing';

type RuntimeClient = ReturnType<typeof getPlatformClient>['runtime'];

type BuildMetadataInput = {
  source: 'local' | 'cloud';
  connectorId?: string;
  endpoint?: string;
};

type ResolveRuntimeRoutePayload = {
  modId: string;
  capability: RuntimeCanonicalCapability;
  binding?: RuntimeRouteBinding;
  conversationExecution?: boolean;
};

type BuildRuntimeMediaCapabilitiesInput = {
  authorizeRuntimeCapability: (payload: {
    modId: string;
    capabilityKey: string;
    target?: string;
  }) => void;
  buildMetadata: (input: BuildMetadataInput) => Promise<Record<string, string>>;
  createScenarioJobControllerDeps: (input?: {
    cancelReason?: string;
    captureCancelResponse?: (value: unknown) => void;
    capturePolledJob?: (value: unknown) => void;
  }) => JobControllerDeps;
  feedControllerJobSnapshot: (jobId: string, value: unknown) => void;
  getRuntimeClient: () => RuntimeClient;
  resolveRuntimeRoute: (payload: ResolveRuntimeRoutePayload) => Promise<ModRuntimeResolvedBinding>;
  toControllerJobSnapshot: (value: unknown) => JobPollResult | null;
};

function buildRuntimeMediaMetadata(
  input: BuildRuntimeMediaCapabilitiesInput,
  resolved: ModRuntimeResolvedBinding,
  metadata: Record<string, string> | undefined,
) {
  return input.buildMetadata({
    source: resolved.source,
    connectorId: resolved.connectorId || undefined,
    endpoint: resolved.localProviderEndpoint || resolved.localOpenAiEndpoint || resolved.endpoint,
  }).then((built) => ({
    ...(metadata || {}),
    ...built,
  }));
}

function trackScenarioJob(
  input: BuildRuntimeMediaCapabilitiesInput,
  job: unknown,
) {
  const jobId = String((job as Record<string, unknown>)?.jobId || '').trim();
  if (!jobId) {
    return;
  }
  startJobTracking(jobId);
  input.feedControllerJobSnapshot(jobId, job);
}

export function buildRuntimeMediaCapabilities(
  input: BuildRuntimeMediaCapabilitiesInput,
): ModSdkHost['runtime']['media'] {
  return {
    image: {
      generate: async (payload) => {
        const { modId, binding, ...request } = payload;
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.image.generate',
        });
        const resolved = await input.resolveRuntimeRoute({
          modId,
          capability: 'image.generate',
          binding,
        });
        const preparedResolved = await ensureResolvedLocalModelAvailable(resolved);
        const model = requireModel(request.model || preparedResolved.model, 'MOD_RUNTIME_IMAGE_MODEL_REQUIRED');
        return input.getRuntimeClient().media.image.generate({
          ...request,
          model,
          route: preparedResolved.source,
          connectorId: preparedResolved.connectorId || undefined,
          metadata: await buildRuntimeMediaMetadata(input, preparedResolved, request.metadata),
        });
      },
      stream: async (payload) => {
        const { modId, binding, ...request } = payload;
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.image.stream',
        });
        const resolved = await input.resolveRuntimeRoute({
          modId,
          capability: 'image.generate',
          binding,
        });
        const preparedResolved = await ensureResolvedLocalModelAvailable(resolved);
        const model = requireModel(request.model || preparedResolved.model, 'MOD_RUNTIME_IMAGE_MODEL_REQUIRED');
        return input.getRuntimeClient().media.image.stream({
          ...request,
          model,
          route: preparedResolved.source,
          connectorId: preparedResolved.connectorId || undefined,
          metadata: await buildRuntimeMediaMetadata(input, preparedResolved, request.metadata),
        });
      },
    },
    video: {
      generate: async (payload) => {
        const { modId, binding, ...request } = payload;
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.video.generate',
        });
        const resolved = await input.resolveRuntimeRoute({
          modId,
          capability: 'video.generate',
          binding,
        });
        return input.getRuntimeClient().media.video.generate({
          ...request,
          model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_VIDEO_MODEL_REQUIRED'),
          route: resolved.source,
          connectorId: resolved.connectorId || undefined,
          metadata: await buildRuntimeMediaMetadata(input, resolved, request.metadata),
        });
      },
      stream: async (payload) => {
        const { modId, binding, ...request } = payload;
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.video.stream',
        });
        const resolved = await input.resolveRuntimeRoute({
          modId,
          capability: 'video.generate',
          binding,
        });
        return input.getRuntimeClient().media.video.stream({
          ...request,
          model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_VIDEO_MODEL_REQUIRED'),
          route: resolved.source,
          connectorId: resolved.connectorId || undefined,
          metadata: await buildRuntimeMediaMetadata(input, resolved, request.metadata),
        });
      },
    },
    world: {
      generate: async (payload) => {
        const { modId, binding, ...request } = payload;
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.world.generate',
        });
        const resolved = await input.resolveRuntimeRoute({
          modId,
          capability: 'world.generate',
          binding,
        });
        const job = await input.getRuntimeClient().media.jobs.submit({
          modal: 'world',
          input: {
            ...request,
            model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_WORLD_MODEL_REQUIRED'),
            route: resolved.source,
            connectorId: resolved.connectorId || undefined,
            metadata: await buildRuntimeMediaMetadata(input, resolved, request.metadata),
          },
        });
        trackScenarioJob(input, job);
        return job;
      },
    },
    tts: {
      synthesize: async (payload) => {
        const { modId, binding, ...request } = payload;
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.tts.synthesize',
        });
        const resolved = await input.resolveRuntimeRoute({
          modId,
          capability: 'audio.synthesize',
          binding,
        });
        const response = await input.getRuntimeClient().media.tts.synthesize({
          ...request,
          model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
          route: resolved.source,
          connectorId: resolved.connectorId || undefined,
          metadata: await buildRuntimeMediaMetadata(input, resolved, request.metadata),
        });
        return {
          ...response,
          artifacts: await cacheSpeechArtifactsForDesktopPlayback({
            artifacts: response.artifacts,
            audioFormat: request.audioFormat,
          }),
        };
      },
      stream: async (payload) => {
        const { modId, binding, ...request } = payload;
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.tts.stream',
        });
        const resolved = await input.resolveRuntimeRoute({
          modId,
          capability: 'audio.synthesize',
          binding,
        });
        return input.getRuntimeClient().media.tts.stream({
          ...request,
          model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
          route: resolved.source,
          connectorId: resolved.connectorId || undefined,
          metadata: await buildRuntimeMediaMetadata(input, resolved, request.metadata),
        });
      },
      listVoices: async (payload) => {
        const { modId, binding, ...request } = payload;
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.tts.list.voices',
        });
        const resolved = await input.resolveRuntimeRoute({
          modId,
          capability: 'audio.synthesize',
          binding,
        });
        return input.getRuntimeClient().media.tts.listVoices({
          ...request,
          model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
          route: resolved.source,
          connectorId: resolved.connectorId || undefined,
          metadata: await buildRuntimeMediaMetadata(input, resolved, request.metadata),
        });
      },
    },
    stt: {
      transcribe: async (payload) => {
        const { modId, binding, ...request } = payload;
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.stt.transcribe',
        });
        const resolved = await input.resolveRuntimeRoute({
          modId,
          capability: 'audio.transcribe',
          binding,
        });
        return input.getRuntimeClient().media.stt.transcribe({
          ...request,
          model: requireModel(request.model || resolved.model, 'MOD_RUNTIME_STT_MODEL_REQUIRED'),
          route: resolved.source,
          connectorId: resolved.connectorId || undefined,
          metadata: await buildRuntimeMediaMetadata(input, resolved, request.metadata),
        });
      },
    },
    jobs: {
      submit: async ({ modId, ...payload }) => {
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.jobs.submit',
        });
        const binding = payload.input.binding;
        const capability = payload.modal === 'video'
          ? 'video.generate'
          : payload.modal === 'world'
            ? 'world.generate'
          : payload.modal === 'tts'
            ? 'audio.synthesize'
            : payload.modal === 'stt'
              ? 'audio.transcribe'
              : 'image.generate';
        const resolved = await input.resolveRuntimeRoute({
          modId,
          capability,
          binding,
        });
        const preparedResolved = payload.modal === 'image'
          ? await ensureResolvedLocalModelAvailable(resolved)
          : resolved;
        const metadata = await buildRuntimeMediaMetadata(input, preparedResolved, payload.input.metadata);

        if (payload.modal === 'image') {
          const job = await input.getRuntimeClient().media.jobs.submit({
            modal: 'image',
            input: {
              ...payload.input,
              model: requireModel(payload.input.model || preparedResolved.model, 'MOD_RUNTIME_IMAGE_MODEL_REQUIRED'),
              route: preparedResolved.source,
              connectorId: preparedResolved.connectorId || undefined,
              metadata,
            },
          });
          trackScenarioJob(input, job);
          return job;
        }

        if (payload.modal === 'video') {
          const job = await input.getRuntimeClient().media.jobs.submit({
            modal: 'video',
            input: {
              ...payload.input,
              model: requireModel(payload.input.model || preparedResolved.model, 'MOD_RUNTIME_VIDEO_MODEL_REQUIRED'),
              route: preparedResolved.source,
              connectorId: preparedResolved.connectorId || undefined,
              metadata,
            },
          });
          trackScenarioJob(input, job);
          return job;
        }

        if (payload.modal === 'world') {
          const job = await input.getRuntimeClient().media.jobs.submit({
            modal: 'world',
            input: {
              ...payload.input,
              model: requireModel(payload.input.model || preparedResolved.model, 'MOD_RUNTIME_WORLD_MODEL_REQUIRED'),
              route: preparedResolved.source,
              connectorId: preparedResolved.connectorId || undefined,
              metadata,
            },
          });
          trackScenarioJob(input, job);
          return job;
        }

        if (payload.modal === 'tts') {
          const job = await input.getRuntimeClient().media.jobs.submit({
            modal: 'tts',
            input: {
              ...payload.input,
              model: requireModel(payload.input.model || preparedResolved.model, 'MOD_RUNTIME_TTS_MODEL_REQUIRED'),
              route: preparedResolved.source,
              connectorId: preparedResolved.connectorId || undefined,
              metadata,
            },
          });
          trackScenarioJob(input, job);
          return job;
        }

        const job = await input.getRuntimeClient().media.jobs.submit({
          modal: 'stt',
          input: {
            ...payload.input,
            model: requireModel(payload.input.model || preparedResolved.model, 'MOD_RUNTIME_STT_MODEL_REQUIRED'),
            route: preparedResolved.source,
            connectorId: preparedResolved.connectorId || undefined,
            metadata,
          },
        });
        trackScenarioJob(input, job);
        return job;
      },
      get: async ({ modId, jobId }) => {
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.jobs.get',
        });
        const job = await input.getRuntimeClient().media.jobs.get(jobId);
        input.feedControllerJobSnapshot(jobId, job);
        return job;
      },
      cancel: async ({ modId, jobId, reason }) => {
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.jobs.cancel',
        });
        if (getJobState(jobId).phase === 'idle') {
          startJobTracking(jobId);
        }
        let cancelResponse: unknown = null;
        let polledJob: unknown = null;
        await requestCancel(jobId, input.createScenarioJobControllerDeps({
          cancelReason: reason,
          captureCancelResponse: (value) => {
            cancelResponse = value;
          },
          capturePolledJob: (value) => {
            polledJob = value;
          },
        }));
        if (cancelResponse) {
          return cancelResponse as Awaited<RuntimeClient>['media']['jobs'] extends {
            cancel: (...args: any[]) => Promise<infer T>;
          } ? T : never;
        }
        if (polledJob) {
          return polledJob as Awaited<RuntimeClient>['media']['jobs'] extends {
            get: (...args: any[]) => Promise<infer T>;
          } ? T : never;
        }
        return input.getRuntimeClient().media.jobs.get(jobId);
      },
      subscribe: async ({ modId, jobId }) => {
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.jobs.subscribe',
        });
        if (getJobState(jobId).phase === 'idle') {
          startJobTracking(jobId);
        }
        const stream = await input.getRuntimeClient().media.jobs.subscribe(jobId);
        return {
          async *[Symbol.asyncIterator]() {
            let sawTerminal = false;
            try {
              for await (const event of stream) {
                const record = event && typeof event === 'object' && !Array.isArray(event)
                  ? event as unknown as Record<string, unknown>
                  : {};
                const snapshot = input.toControllerJobSnapshot(record.job);
                if (snapshot) {
                  input.feedControllerJobSnapshot(jobId, record.job);
                  sawTerminal = snapshot.status === 'COMPLETED'
                    || snapshot.status === 'FAILED'
                    || snapshot.status === 'CANCELED'
                    || snapshot.status === 'TIMEOUT';
                }
                yield event;
              }
            } catch (error) {
              const state = getJobState(jobId);
              if (state.phase !== 'terminal' && state.phase !== 'recovery_timeout') {
                startPollingRecovery(jobId, input.createScenarioJobControllerDeps());
              }
              throw error;
            }
            const state = getJobState(jobId);
            if (!sawTerminal && state.phase !== 'terminal' && state.phase !== 'recovery_timeout') {
              startPollingRecovery(jobId, input.createScenarioJobControllerDeps());
            }
          },
        };
      },
      getArtifacts: async ({ modId, jobId }) => {
        input.authorizeRuntimeCapability({
          modId,
          capabilityKey: 'runtime.media.jobs.get.artifacts',
        });
        return input.getRuntimeClient().media.jobs.getArtifacts(jobId);
      },
    },
  };
}
