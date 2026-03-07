import type { RuntimeCallOptions, RuntimeClient, RuntimeStreamCallOptions } from './types.js';
import type { RuntimeOptions } from './types.js';

/**
 * Internal context object passed to extracted module functions.
 * Provides access to the Runtime class's private capabilities
 * without requiring `#` private method access from external files.
 */
export interface RuntimeInternalContext {
  readonly appId: string;
  readonly options: RuntimeOptions;

  /** Invoke an operation with retry logic. */
  invoke: <T>(operation: () => Promise<T>) => Promise<T>;

  /** Invoke an operation that requires the connected RuntimeClient. */
  invokeWithClient: <T>(operation: (client: RuntimeClient) => Promise<T>) => Promise<T>;

  /** Resolve call options from input metadata/timeout. */
  resolveRuntimeCallOptions: (input: {
    timeoutMs?: number;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
    _responseMetadataObserver?: (metadata: Record<string, string>) => void;
  }) => RuntimeCallOptions;

  /** Resolve stream call options from input metadata/timeout/signal. */
  resolveRuntimeStreamOptions: (input: {
    timeoutMs?: number;
    metadata?: Record<string, string>;
    idempotencyKey?: string;
    signal?: AbortSignal;
  }) => RuntimeStreamCallOptions;

  /** Resolve the subject user ID from explicit value, options, or resolver. */
  resolveSubjectUserId: (explicit?: string) => Promise<string>;

  /** Resolve the subject user ID when anonymous local-runtime is allowed. */
  resolveOptionalSubjectUserId: (explicit?: string) => Promise<string | undefined>;

  /** Emit a telemetry event. */
  emitTelemetry: (name: string, data?: Record<string, unknown>) => void;
}
