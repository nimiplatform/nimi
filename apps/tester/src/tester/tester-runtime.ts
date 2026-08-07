import type { BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import { getTesterLocalAppClient } from '../shell/local-app-runtime-platform.js';
import { getTesterCapability, type TesterCapabilityId } from './tester-capabilities.js';
import { capabilityUnavailable, type TesterUnavailable } from './tester-unavailable.js';

export type TesterTrace = {
  traceId?: string;
  simulated?: boolean;
};

export type TesterTypedOutput =
  | { kind: 'text'; text: string; finishReason: string; inputTokens?: number; outputTokens?: number; totalTokens?: number; streamed: boolean }
  | { kind: 'embedding'; vectorCount: number; dimensions: number; sample: number[]; totalTokens?: number }
  | { kind: 'artifacts'; jobId: string; jobState: string; artifactCount: number; firstArtifact?: { artifactId?: string; mimeType?: string; url?: string; displayName?: string } }
  | { kind: 'transcript'; text: string; jobId: string; jobState: string; artifactCount: number }
  | { kind: 'voice-catalog'; voiceCount: number; sample: Array<{ voiceId: string; name: string; lang: string }> };

export type TesterTypedSuccess = {
  ok: true;
  capabilityId: TesterCapabilityId;
  capabilityLabel: string;
  message: string;
  output: TesterTypedOutput;
  trace?: TesterTrace;
};

export type TesterRuntimeInspection =
  | {
      status: 'simulated';
      mode: 'simulated';
      detail: string;
    }
  | {
      status: 'connected' | 'unavailable';
      mode: string;
      detail: string;
    };

export type TesterCapabilityRunInput = {
  capabilityId: TesterCapabilityId;
  prompt: string;
  scenarioId?: string;
  /** Optional live-delta callback forwarded to streaming capabilities. */
  onPartial?: (accumulatedText: string) => void;
  /** Optional local media attachments for vision/multimodal text capabilities. */
  attachments?: BrowserDataUrlAttachment[];
  /** Optional app-composed instruction line (tone/length) prepended to the prompt. */
  directive?: string;
};

export type TesterCapabilityRunResult = TesterTypedSuccess | TesterUnavailable;

export async function inspectRuntimeConnection(): Promise<TesterRuntimeInspection> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    return {
      status: 'unavailable',
      mode: projection.mode,
      detail: projection.message,
    };
  }
  return {
    status: 'connected',
    mode: projection.mode,
    detail: 'The protected local-app identity session is bound and Runtime is connected. The App AIConfig selects Local or an exact Cloud implementation; machine selection and execution availability remain Runtime-owned. Text requests run through the canonical Runtime execution path and fail closed with typed reasons when the composed route is not executable.',
  };
}

export async function runTesterCapability(input: TesterCapabilityRunInput): Promise<TesterCapabilityRunResult> {
  const capability = getTesterCapability(input.capabilityId);
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    return capabilityUnavailable(capability, 'runtime-unavailable', projection.message);
  }

  if (capability.id === 'text.generate') {
    const prompt = input.prompt.trim();
    if (!prompt) {
      return capabilityUnavailable(capability, 'input-invalid', 'Text generation requires a non-empty prompt.');
    }

    try {
      const result = await getTesterLocalAppClient().ai.text.generateCandidate({
        messages: [{ role: 'user', text: prompt }],
        temperature: 0.7,
        topP: 0.9,
        maxTokens: 1024,
      });
      return {
        ok: true,
        capabilityId: capability.id,
        capabilityLabel: capability.label,
        message: 'Runtime completed the protected foreground text candidate request.',
        output: {
          kind: 'text',
          text: result.text,
          finishReason: result.finishReason,
          streamed: false,
        },
        trace: {
          traceId: result.traceId,
        },
      };
    } catch (error) {
      return capabilityUnavailable(
        capability,
        'runtime-call-failed',
        testerRuntimeErrorMessage(error),
      );
    }
  }

  return capabilityUnavailable(
    capability,
    'sdk-method-unavailable',
    'The protected local-app carrier exposes no admitted generic AI streaming, embedding, media-job, voice-catalog, or execution method for this capability. It remains unavailable by contract.',
  );
}

function testerRuntimeErrorMessage(error: unknown): string {
  const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
  const message = error instanceof Error ? error.message.trim() : '';
  const reasonCode = typeof record?.reasonCode === 'string' ? record.reasonCode.trim() : '';
  if (message && reasonCode) return `${message} (${reasonCode})`;
  return message || reasonCode || String(error || 'The Runtime text candidate call failed.');
}
