import type { BrowserDataUrlAttachment } from '@nimiplatform/kit/features/chat/headless';
import { getRuntimePlatformProjection } from '../shell/auth/runtime-platform.js';
import { getTesterCapability, type TesterCapabilityId } from './tester-capabilities.js';
import { capabilityUnavailable, type TesterUnavailable } from './tester-unavailable.js';

export type TesterTrace = {
  traceId?: string;
  modelResolved?: string;
  routeDecision?: string;
};

export type TesterTypedOutput =
  | { kind: 'text'; text: string; finishReason: string; inputTokens?: number; outputTokens?: number; totalTokens?: number; streamed: boolean }
  | { kind: 'embedding'; vectorCount: number; dimensions: number; sample: number[]; totalTokens?: number }
  | { kind: 'artifacts'; jobId: string; jobState: string; artifactCount: number; firstArtifact?: { artifactId?: string; mimeType?: string; url?: string; displayName?: string } }
  | { kind: 'transcript'; text: string; jobId: string; jobState: string; artifactCount: number }
  | { kind: 'voice-catalog'; modelResolved: string; voiceCount: number; sample: Array<{ voiceId: string; name: string; lang: string }> };

export type TesterTypedSuccess = {
  ok: true;
  capabilityId: TesterCapabilityId;
  capabilityLabel: string;
  message: string;
  output: TesterTypedOutput;
  trace?: TesterTrace;
};

export type TesterRuntimeInspection = {
  status: 'ready' | 'unavailable';
  mode: string;
  detail: string;
  healthJson?: string;
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

function compactJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2).slice(0, 1600);
  } catch {
    return String(value);
  }
}

export async function inspectRuntimeReadiness(): Promise<TesterRuntimeInspection> {
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    return {
      status: 'unavailable',
      mode: projection.mode,
      detail: projection.message,
    };
  }
  return {
    status: 'unavailable',
    mode: projection.mode,
    detail: 'Protected app host is ready. This app authorization admits artifacts.readRuntimeBytes only; Runtime health, account, Realm, AI, realtime, lifecycle, and media operations remain blocked.',
    healthJson: compactJson({
      appHost: projection.appHost.state,
      trustClass: projection.appHost.trustClass,
      appId: projection.appHost.appId,
      bootstrapArtifact: projection.appHost.bootstrapArtifact,
    }),
  };
}

export async function runTesterCapability(input: TesterCapabilityRunInput): Promise<TesterCapabilityRunResult> {
  const capability = getTesterCapability(input.capabilityId);
  const projection = await getRuntimePlatformProjection();
  if (projection.status !== 'ready') {
    return capabilityUnavailable(capability, 'runtime-not-ready', projection.message);
  }
  return capabilityUnavailable(
    capability,
    'sdk-method-unavailable',
    'This local-development authorization admits artifacts.readRuntimeBytes only. AI and media execution remain fail-closed.',
  );
}
