export function asString(value: unknown): string {
  return String(value || '').trim();
}

export function toPrettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(error || 'JSON stringify failed');
  }
}

export function stripArtifacts(response: unknown): unknown {
  if (response == null || typeof response !== 'object') return response;
  const record = response as Record<string, unknown>;
  if (!Array.isArray(record['artifacts'])) return record;
  return {
    ...record,
    artifacts: (record['artifacts'] as unknown[]).map((artifact) => {
      if (artifact == null || typeof artifact !== 'object') return artifact;
      const { data: _data, bytes: _bytes, ...rest } = artifact as Record<string, unknown>;
      return { ...rest, _dataTruncated: true };
    }),
  };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  const bufferCtor = (globalThis as typeof globalThis & {
    Buffer?: {
      from(input: string, encoding: string): {
        toString(encoding: string): string;
      };
    };
  }).Buffer;
  const base64Encoder = typeof globalThis.btoa === 'function'
    ? globalThis.btoa.bind(globalThis)
    : ((value: string) => bufferCtor?.from(value, 'binary').toString('base64') || '');
  return base64Encoder(binary);
}

export function toArtifactPreviewUri(input: {
  uri?: string;
  bytes?: Uint8Array;
  mimeType?: string;
  defaultMimeType?: string;
}): string {
  if (input.bytes && input.bytes.length > 0) {
    const mimeType = asString(input.mimeType) || asString(input.defaultMimeType) || 'application/octet-stream';
    return `data:${mimeType};base64,${bytesToBase64(input.bytes)}`;
  }
  const uri = asString(input.uri);
  return uri || '';
}

export function isTerminalScenarioJobStatus(value: unknown): boolean {
  const numeric = Number(value);
  if (numeric === 4 || numeric === 5 || numeric === 6 || numeric === 7) {
    return true;
  }
  const normalized = String(value || '').trim().toLowerCase();
  return normalized.includes('completed')
    || normalized.includes('failed')
    || normalized.includes('canceled')
    || normalized.includes('timeout');
}

const SCENARIO_JOB_STATUS_LABELS: Record<number, string> = {
  0: 'unspecified',
  1: 'submitted',
  2: 'queued',
  3: 'running',
  4: 'completed',
  5: 'failed',
  6: 'canceled',
  7: 'timeout',
};

export function scenarioJobStatusLabel(value: unknown): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && SCENARIO_JOB_STATUS_LABELS[numeric]) {
    return SCENARIO_JOB_STATUS_LABELS[numeric];
  }
  const normalized = String(value || '').trim();
  if (!normalized) return 'unknown';
  return normalized
    .replace(/^scenario_job_status_/i, '')
    .toLowerCase()
    .replace(/_/g, ' ');
}

export function buildAsyncImageJobOutcome(input: {
  status: unknown;
  reasonDetail?: unknown;
  artifactFetchError?: unknown;
}): {
  result: 'passed' | 'failed';
  error: string;
  terminalStatus: string;
} {
  const terminalStatus = scenarioJobStatusLabel(input.status);
  const terminalError = terminalStatus !== 'completed'
    ? asString(input.reasonDetail || terminalStatus || 'Image job did not complete successfully.')
    : '';
  const artifactFetchError = asString(input.artifactFetchError);
  const error = [terminalError, artifactFetchError].filter(Boolean).join(' | ');
  return {
    result: error ? 'failed' : 'passed',
    error,
    terminalStatus,
  };
}

const SCENARIO_JOB_EVENT_LABELS: Record<number, string> = {
  0: 'event',
  1: 'submitted',
  2: 'queued',
  3: 'running',
  4: 'completed',
  5: 'failed',
  6: 'canceled',
  7: 'timeout',
};

export function scenarioJobEventLabel(value: unknown): string {
  const numeric = Number(value);
  if (Number.isFinite(numeric) && SCENARIO_JOB_EVENT_LABELS[numeric]) {
    return SCENARIO_JOB_EVENT_LABELS[numeric];
  }
  const normalized = String(value || '').trim();
  if (!normalized) return 'event';
  return normalized
    .replace(/^scenario_job_event_/i, '')
    .toLowerCase()
    .replace(/_/g, ' ');
}
