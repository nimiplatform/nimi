import type { RuntimeInternalContext } from '../../src/runtime/internal-context.js';
import { FallbackPolicy } from '../../src/runtime/generated/runtime/v1/ai.js';
import { runtimeAiRequestRequiresSubject } from '../../src/runtime/runtime-guards.js';

export function createMockContext(overrides?: {
  invokeWithClient?: RuntimeInternalContext['invokeWithClient'];
  resolveSubjectUserId?: RuntimeInternalContext['resolveSubjectUserId'];
  resolveOptionalSubjectUserId?: RuntimeInternalContext['resolveOptionalSubjectUserId'];
  timeoutMs?: number;
}): RuntimeInternalContext {
  const telemetryEvents: Array<{ name: string; data?: Record<string, unknown> }> = [];
  return {
    appId: 'test-app',
    options: {
      appId: 'test-app',
      transport: { type: 'node-grpc', endpoint: '127.0.0.1:46371' },
      timeoutMs: overrides?.timeoutMs,
    },
    invoke: async (op) => op(),
    invokeWithClient: overrides?.invokeWithClient ?? (async () => ({})),
    resolveRuntimeCallOptions: (input) => ({
      timeoutMs: input.timeoutMs ?? 0,
      metadata: input.metadata ?? {},
    }),
    resolveRuntimeStreamOptions: (input) => ({
      timeoutMs: input.timeoutMs ?? 0,
      metadata: input.metadata ?? {},
      signal: input.signal,
    }),
    resolveSubjectUserId: overrides?.resolveSubjectUserId ?? (async () => 'subject-1'),
    resolveOptionalSubjectUserId: overrides?.resolveOptionalSubjectUserId ?? (async () => undefined),
    normalizeScenarioHead: async ({ head, metadata }) => {
      const requiresSubject = runtimeAiRequestRequiresSubject({
        request: { head },
        metadata,
      });
      const subjectUserId = requiresSubject
        ? await (overrides?.resolveSubjectUserId ?? (async () => 'subject-1'))(head.subjectUserId)
        : await (overrides?.resolveOptionalSubjectUserId ?? (async () => undefined))(head.subjectUserId);
      return {
        ...head,
        subjectUserId: subjectUserId || '',
        fallback: head.fallback ?? FallbackPolicy.DENY,
      };
    },
    emitTelemetry: (name, data) => {
      telemetryEvents.push({ name, data });
    },
    _telemetryEvents: telemetryEvents,
  } as RuntimeInternalContext & { _telemetryEvents: typeof telemetryEvents };
}
