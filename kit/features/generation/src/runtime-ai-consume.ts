import type {
  NimiError,
  NimiRuntimeAIScenarioClient,
  NimiRuntimeEmbeddingScenarioClient,
} from '@nimiplatform/kit/core/sdk-contract';
import { runtimeExecutionUnavailable } from './runtime-diagnostics.js';

export type RuntimeAIConsumeCapabilityId = 'text.generate' | 'chat.stream' | 'text.embed';

export type RuntimeAIConsumeUnavailableReason =
  | 'input-invalid'
  | 'runtime-call-failed'
  | 'principal-unauthorized'
  | 'sdk-method-unavailable';

export type RuntimeAIConsumeTrace = {
  readonly traceId?: string;
  readonly modelResolved?: string;
  readonly routeDecision?: string;
};

export type RuntimeAIConsumeOutput =
  | {
      readonly kind: 'text';
      readonly text: string;
      readonly finishReason: string;
      readonly inputTokens?: number;
      readonly outputTokens?: number;
      readonly totalTokens?: number;
      readonly streamed: boolean;
    }
  | {
      readonly kind: 'embedding';
      readonly vectorCount: number;
      readonly dimensions: number;
      readonly sample: readonly number[];
      readonly totalTokens?: number;
    };

export type RuntimeAIConsumeSuccess = {
  readonly ok: true;
  readonly capabilityId: RuntimeAIConsumeCapabilityId;
  readonly message: string;
  readonly output: RuntimeAIConsumeOutput;
  readonly trace?: RuntimeAIConsumeTrace;
};

export type RuntimeAIConsumeUnavailable = {
  readonly ok: false;
  readonly capabilityId: RuntimeAIConsumeCapabilityId;
  readonly reason: RuntimeAIConsumeUnavailableReason;
  readonly message: string;
  readonly error: NimiError;
};

export type RuntimeAIConsumeResult = RuntimeAIConsumeSuccess | RuntimeAIConsumeUnavailable;

export type RuntimeAIConsumeRuntime = {
  readonly ai: NimiRuntimeAIScenarioClient & NimiRuntimeEmbeddingScenarioClient;
};

export type RuntimeAIConsumeInput = {
  readonly runtime: RuntimeAIConsumeRuntime;
  readonly appId: string;
  readonly capabilityId: RuntimeAIConsumeCapabilityId;
  readonly prompt: string;
  readonly directive?: string;
  readonly scenarioId: string;
  readonly subjectUserId?: string;
  readonly surfaceId: string;
  readonly metadata?: Readonly<Record<string, string | undefined>>;
  readonly onPartial?: (accumulatedText: string) => void;
  readonly signal?: AbortSignal;
};

/**
 * Text and embedding execution stay visible as typed Kit contracts, but the
 * current Runtime Scenario API still requires caller-owned execution target
 * truth. Kit no longer accepts that truth, so execution fails closed before
 * touching the injected Runtime client.
 */
export async function runRuntimeAIConsumeCapability(
  input: RuntimeAIConsumeInput,
): Promise<RuntimeAIConsumeResult> {
  return {
    ok: false,
    capabilityId: input.capabilityId,
    ...runtimeExecutionUnavailable(input.capabilityId),
  };
}
