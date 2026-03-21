import { FallbackPolicy, RoutePolicy } from '../../src/runtime/generated/runtime/v1/ai.js';
import type { RuntimeInternalContext } from '../../src/runtime/internal-context.js';
import { runtimeAiRequestRequiresSubject } from '../../src/runtime/runtime-guards.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function createMockCtx(overrides?: Partial<RuntimeInternalContext>): RuntimeInternalContext {
  return {
    appId: 'test-app',
    options: { appId: 'test-app', transport: { type: 'node-grpc', endpoint: '127.0.0.1:1' } },
    invoke: async (op) => op(),
    invokeWithClient: async (op) => op({
      ai: {
        submitScenarioJob: async () => ({}),
        getScenarioJob: async () => ({}),
        getScenarioArtifacts: async () => ({}),
        cancelScenarioJob: async () => ({}),
        executeScenario: async () => ({}),
        streamScenario: async () => (async function* () {})(),
        subscribeScenarioJobEvents: async () => (async function* () {})(),
        listPresetVoices: async () => ({}),
      },
      model: { list: async () => ({}) },
      audit: { getRuntimeHealth: async () => ({}) },
      app: { sendAppMessage: async () => ({}), subscribeAppMessages: async () => (async function* () {})() },
      appAuth: {
        authorizeExternalPrincipal: async () => ({}),
        issueDelegatedToken: async () => ({}),
        revokeToken: async () => ({}),
      },
      knowledge: { searchDocuments: async () => ({}) },
      workflow: {
        startWorkflow: async () => ({}),
        getWorkflow: async () => ({}),
        cancelWorkflow: async () => ({}),
        subscribeWorkflowEvents: async () => (async function* () {})(),
      },
    } as never),
    resolveRuntimeCallOptions: (input) => ({
      timeoutMs: input.timeoutMs,
      metadata: input.metadata || {},
      _responseMetadataObserver: input._responseMetadataObserver,
    }),
    resolveRuntimeStreamOptions: (input) => ({
      timeoutMs: input.timeoutMs,
      metadata: input.metadata || {},
      signal: input.signal,
      _responseMetadataObserver: input._responseMetadataObserver,
    }),
    resolveSubjectUserId: async (explicit) => explicit || 'test-subject',
    resolveOptionalSubjectUserId: async (explicit) => explicit || undefined,
    normalizeScenarioHead: async ({ head, metadata }) => {
      const requiresSubject = runtimeAiRequestRequiresSubject({
        request: { head },
        metadata,
      });
      const subjectUserId = requiresSubject
        ? await (overrides?.resolveSubjectUserId ?? (async (explicit) => explicit || 'test-subject'))(head.subjectUserId)
        : await (overrides?.resolveOptionalSubjectUserId ?? (async (explicit) => explicit || undefined))(head.subjectUserId);
      return {
        ...head,
        subjectUserId: subjectUserId || '',
        fallback: head.fallback ?? FallbackPolicy.DENY,
      };
    },
    emitTelemetry: () => {},
    ...overrides,
  } as RuntimeInternalContext;
}

export function makeJob(partial?: Record<string, unknown>) {
  return {
    jobId: 'job-1',
    status: 4, // ScenarioJobStatus.COMPLETED
    routeDecision: RoutePolicy.CLOUD,
    modelResolved: 'model-resolved',
    traceId: 'trace-job-1',
    usage: { inputTokens: '10', outputTokens: '5', computeMs: '100' },
    ...(partial || {}),
  };
}

export function makeArtifact(id: string, bytes: Uint8Array, mimeType = 'image/png') {
  return { artifactId: id, mimeType, bytes, uri: '', sha256: '', sizeBytes: String(bytes.length), durationMs: '0', fps: 0, width: 0, height: 0, sampleRateHz: 0, channels: 0 };
}

// ---------------------------------------------------------------------------
// streamArtifactsFromMediaOutput — branch coverage
// ---------------------------------------------------------------------------
