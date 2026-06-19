import type { TesterRuntimeInvocationClient } from './tester-runtime-invokers-core.js';
import { pickTrace } from './tester-runtime-invokers-core.js';

export type RuntimeMediaJobOutput = {
  readonly job?: unknown;
  readonly artifacts?: readonly unknown[];
  readonly trace?: unknown;
  readonly traceId?: string;
};

export type RuntimeTranscriptOutput = RuntimeMediaJobOutput & {
  readonly text?: string;
};

export type RuntimeVoiceCatalogOutput = {
  readonly modelResolved?: string;
  readonly voiceCount?: number;
  readonly voiceCatalogSource?: string;
  readonly voices?: readonly { readonly voiceId?: string; readonly name?: string; readonly lang?: string }[];
  readonly traceId?: string;
};

export function artifactsFrom(output: RuntimeMediaJobOutput): readonly unknown[] {
  return Array.isArray(output.artifacts) ? output.artifacts : [];
}

// Normalize the runtime artifact `bytes` field into a Uint8Array regardless of
// how the transport delivered it (typed array, ArrayBuffer, number array, an
// index-map produced by a JSON IPC hop, or an already-base64 string).
function normalizeArtifactBytes(bytes: unknown): Uint8Array | undefined {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  if (Array.isArray(bytes)) return Uint8Array.from(bytes as number[]);
  if (typeof bytes === 'string') {
    if (!bytes) return undefined;
    try {
      const binary = atob(bytes);
      const out = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        out[index] = binary.charCodeAt(index);
      }
      return out;
    } catch {
      return undefined;
    }
  }
  if (bytes && typeof bytes === 'object') {
    const view = bytes as { length?: unknown; [index: number]: unknown };
    if (typeof view.length === 'number' && view.length >= 0) {
      const out = new Uint8Array(view.length);
      for (let index = 0; index < view.length; index += 1) {
        out[index] = Number(view[index]) & 0xff;
      }
      return out;
    }
  }
  return undefined;
}

// Local runtime media (image / TTS / video) returns ScenarioArtifact `bytes`
// with an empty `uri`; only a cloud-hosted artifact carries a URL. Render the
// inline bytes as a data URL so the cockpit can display, play, and save the
// generated artifact instead of silently dropping it.
function artifactBytesToDataUrl(bytes: unknown, mimeType: string): string | undefined {
  const normalized = normalizeArtifactBytes(bytes);
  if (!normalized || normalized.length === 0) return undefined;
  const mime = mimeType.trim() || 'application/octet-stream';
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < normalized.length; offset += chunkSize) {
    binary += String.fromCharCode(...normalized.subarray(offset, offset + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

function artifactIdFrom(record: Record<string, unknown>): string | undefined {
  const artifactId = typeof record.artifactId === 'string'
    ? record.artifactId
    : typeof record.artifact_id === 'string' ? record.artifact_id : '';
  return artifactId.trim() || undefined;
}

async function readRuntimeArtifactDataUrl(
  client: TesterRuntimeInvocationClient,
  artifactId: string,
  fallbackMimeType: string,
): Promise<{ readonly url?: string; readonly mimeType?: string }> {
  const reader = client.runtime.artifacts?.readArtifactBytes;
  if (!reader) return {};
  const response = await reader({ artifactId });
  const mimeType = typeof response.mimeType === 'string' && response.mimeType.trim()
    ? response.mimeType
    : fallbackMimeType;
  return {
    url: artifactBytesToDataUrl(response.bytes, mimeType),
    mimeType: mimeType || undefined,
  };
}

export async function summariseArtifact(client: TesterRuntimeInvocationClient, artifact: unknown) {
  if (!artifact || typeof artifact !== 'object') return undefined;
  const record = artifact as Record<string, unknown>;
  const inline = record.inline as Record<string, unknown> | undefined;
  const mimeType = typeof record.mimeType === 'string' && record.mimeType
    ? record.mimeType
    : typeof inline?.mimeType === 'string' ? inline.mimeType : undefined;
  const hostedUrl = (typeof record.uri === 'string' && record.uri.trim())
    || (typeof record.url === 'string' && record.url.trim())
    || '';
  const artifactId = artifactIdFrom(record);
  const inlineUrl = artifactBytesToDataUrl(record.bytes ?? inline?.bytes, mimeType ?? '');
  const readBack = hostedUrl || inlineUrl || !artifactId
    ? {}
    : await readRuntimeArtifactDataUrl(client, artifactId, mimeType ?? '');
  const url = hostedUrl
    || inlineUrl
    || readBack.url
    || undefined;
  return {
    artifactId,
    mimeType: readBack.mimeType ?? mimeType,
    url,
    displayName: typeof record.displayName === 'string' ? record.displayName : undefined,
  };
}

export function summariseJob(job: unknown): { jobId: string; jobState: string } {
  if (!job || typeof job !== 'object') return { jobId: '', jobState: 'unknown' };
  const record = job as Record<string, unknown>;
  const status = record.status;
  return {
    jobId: typeof record.jobId === 'string'
      ? record.jobId
      : typeof record.id === 'string' ? record.id : '',
    jobState: typeof record.state === 'string'
      ? record.state
      : typeof status === 'string' ? status : scenarioJobStatusLabel(status),
  };
}

function scenarioJobStatusLabel(status: unknown): string {
  if (typeof status !== 'number') return 'unknown';
  switch (status) {
    case 1: return 'submitted';
    case 2: return 'queued';
    case 3: return 'running';
    case 4: return 'completed';
    case 5: return 'failed';
    case 6: return 'canceled';
    case 7: return 'timeout';
    default: return 'unknown';
  }
}

function traceFromScenarioJob(job: unknown, traceId?: string): { traceId?: string; modelResolved?: string; routeDecision?: string } | undefined {
  if (!job || typeof job !== 'object') {
    return traceId ? { traceId } : undefined;
  }
  const record = job as Record<string, unknown>;
  const routeDecision = record.routeDecision;
  return {
    traceId: traceId || (typeof record.traceId === 'string' ? record.traceId : undefined),
    modelResolved: typeof record.modelResolved === 'string' ? record.modelResolved : undefined,
    routeDecision: typeof routeDecision === 'string'
      ? routeDecision
      : typeof routeDecision === 'number' ? routePolicyLabel(routeDecision) : undefined,
  };
}

export function traceFromRuntimeOutput(output: {
  readonly job?: unknown;
  readonly trace?: unknown;
  readonly traceId?: string;
}): { traceId?: string; modelResolved?: string; routeDecision?: string } | undefined {
  return pickTrace(output.trace) ?? traceFromScenarioJob(output.job, output.traceId);
}

function routePolicyLabel(value: number): string {
  if (value === 1) return 'local';
  if (value === 2) return 'cloud';
  return 'unspecified';
}
