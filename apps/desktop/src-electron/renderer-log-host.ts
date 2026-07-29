const COMMAND = 'log_renderer_event' as const;
const LOG_LEVELS = new Set(['debug', 'info', 'warn', 'error']);
const LOG_PAYLOAD_KEYS = new Set([
  'area',
  'costMs',
  'details',
  'flowId',
  'level',
  'message',
  'source',
  'traceId',
]);
const MAX_LOG_PAYLOAD_BYTES = 32 * 1024;
const MAX_AREA_CHARS = 128;
const MAX_MESSAGE_CHARS = 1024;
const MAX_ID_CHARS = 192;
const MAX_SOURCE_CHARS = 128;
const MAX_DETAILS_DEPTH = 6;
const MAX_DETAILS_KEYS = 48;
const MAX_DETAILS_ARRAY_ITEMS = 32;
const MAX_DETAILS_KEY_CHARS = 128;
const MAX_DETAILS_STRING_CHARS = 2048;
const MAX_COST_MS = 24 * 60 * 60 * 1000;

type RendererLogLevel = 'debug' | 'info' | 'warn' | 'error';
type RendererLogDetails = Readonly<Record<string, unknown>>;

export type DesktopElectronRendererLogHost = {
  readonly commandHandlers: Readonly<Record<typeof COMMAND, (context: {
    readonly payload: Readonly<Record<string, unknown>>;
  }) => null>>;
};

export function createDesktopElectronRendererLogHost(input: {
  readonly verbose?: boolean;
  readonly writeStderr?: (line: string) => void;
} = {}): DesktopElectronRendererLogHost {
  const verbose = input.verbose ?? rendererVerboseEnabled();
  const writeStderr = input.writeStderr ?? ((line: string) => {
    process.stderr.write(line);
  });

  return {
    commandHandlers: {
      [COMMAND]: ({ payload }) => {
        const entry = parseRendererLogEnvelope(payload);
        if (entry.level === 'warn' || entry.level === 'error' || verbose) {
          writeStderr(`${JSON.stringify(entry)}\n`);
        }
        return null;
      },
    },
  };
}

function parseRendererLogEnvelope(value: unknown): Readonly<Record<string, unknown>> & {
  readonly level: RendererLogLevel;
} {
  const envelope = exactRecord(
    value,
    new Set(['payload']),
    new Set(['payload']),
    'desktop-renderer-log-envelope-invalid',
  );
  const payload = exactRecord(
    envelope.payload,
    LOG_PAYLOAD_KEYS,
    new Set(['area', 'details', 'flowId', 'level', 'message', 'traceId']),
    'desktop-renderer-log-payload-invalid',
  );
  if (typeof payload.level !== 'string' || !LOG_LEVELS.has(payload.level)) {
    throw new Error('desktop-renderer-log-level-invalid');
  }
  const level = payload.level as RendererLogLevel;
  const area = boundedText(payload.area, MAX_AREA_CHARS, 'desktop-renderer-log-area-invalid');
  const message = boundedText(
    payload.message,
    MAX_MESSAGE_CHARS,
    'desktop-renderer-log-message-invalid',
  );
  if (!message.startsWith('action:') && !message.startsWith('phase:')) {
    throw new Error('desktop-renderer-log-message-invalid');
  }
  const traceId = boundedText(
    payload.traceId,
    MAX_ID_CHARS,
    'desktop-renderer-log-trace-id-invalid',
  );
  const flowId = boundedText(
    payload.flowId,
    MAX_ID_CHARS,
    'desktop-renderer-log-flow-id-invalid',
  );
  const source = optionalBoundedText(
    payload.source,
    MAX_SOURCE_CHARS,
    'desktop-renderer-log-source-invalid',
  );
  const costMs = optionalCostMs(payload.costMs);
  const details = rendererLogDetails(payload.details);

  const entry = {
    source: source ?? 'renderer',
    level,
    area,
    message,
    traceId,
    flowId,
    ...(costMs === undefined ? {} : { costMs }),
    details,
  };
  if (Buffer.byteLength(JSON.stringify(entry), 'utf8') > MAX_LOG_PAYLOAD_BYTES) {
    throw new Error('desktop-renderer-log-payload-too-large');
  }
  return Object.freeze(entry);
}

function exactRecord(
  value: unknown,
  allowedKeys: ReadonlySet<string>,
  requiredKeys: ReadonlySet<string>,
  failureCode: string,
): Readonly<Record<string, unknown>> {
  if (!isPlainRecord(value)) {
    throw new Error(failureCode);
  }
  const keys = Object.keys(value);
  if (keys.some((key) => !allowedKeys.has(key))
    || [...requiredKeys].some((key) => !Object.hasOwn(value, key))) {
    throw new Error(failureCode);
  }
  return value;
}

function boundedText(value: unknown, maxChars: number, failureCode: string): string {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > maxChars
    || value.trim() !== value) {
    throw new Error(failureCode);
  }
  return value;
}

function optionalBoundedText(
  value: unknown,
  maxChars: number,
  failureCode: string,
): string | undefined {
  if (value === undefined) return undefined;
  return boundedText(value, maxChars, failureCode);
}

function optionalCostMs(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'number'
    || !Number.isFinite(value)
    || value < 0
    || value > MAX_COST_MS) {
    throw new Error('desktop-renderer-log-cost-invalid');
  }
  return value;
}

function rendererLogDetails(value: unknown): RendererLogDetails {
  if (!isPlainRecord(value)) {
    throw new Error('desktop-renderer-log-details-invalid');
  }
  validateDetailsValue(value, 0, new WeakSet<object>());
  return value;
}

function validateDetailsValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    if (typeof value === 'string' && value.length > MAX_DETAILS_STRING_CHARS) {
      throw new Error('desktop-renderer-log-details-invalid');
    }
    return;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('desktop-renderer-log-details-invalid');
    }
    return;
  }
  if (depth >= MAX_DETAILS_DEPTH || !value || typeof value !== 'object') {
    throw new Error('desktop-renderer-log-details-invalid');
  }
  if (ancestors.has(value)) {
    throw new Error('desktop-renderer-log-details-invalid');
  }
  ancestors.add(value);
  if (Array.isArray(value)) {
    if (value.length > MAX_DETAILS_ARRAY_ITEMS) {
      throw new Error('desktop-renderer-log-details-invalid');
    }
    for (const entry of value) {
      validateDetailsValue(entry, depth + 1, ancestors);
    }
    ancestors.delete(value);
    return;
  }
  if (!isPlainRecord(value)) {
    throw new Error('desktop-renderer-log-details-invalid');
  }
  const entries = Object.entries(value);
  if (entries.length > MAX_DETAILS_KEYS
    || entries.some(([key]) => key.length === 0 || key.length > MAX_DETAILS_KEY_CHARS)) {
    throw new Error('desktop-renderer-log-details-invalid');
  }
  for (const [, entry] of entries) {
    validateDetailsValue(entry, depth + 1, ancestors);
  }
  ancestors.delete(value);
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function rendererVerboseEnabled(): boolean {
  return envFlagEnabled(process.env.NIMI_DEBUG_BOOT)
    || envFlagEnabled(process.env.VITE_NIMI_DEBUG_BOOT)
    || envFlagEnabled(process.env.NIMI_VERBOSE_RENDERER_LOGS)
    || envFlagEnabled(process.env.VITE_NIMI_VERBOSE_RENDERER_LOGS);
}

function envFlagEnabled(value: string | undefined): boolean {
  const normalized = String(value ?? '').trim().toLowerCase();
  return normalized === '1'
    || normalized === 'true'
    || normalized === 'yes'
    || normalized === 'on';
}
