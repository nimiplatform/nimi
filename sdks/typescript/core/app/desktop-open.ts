export const NIMI_DESKTOP_OPEN_SCHEMA_VERSION = 1 as const;

export const NIMI_DESKTOP_OPEN_SOURCE_HOSTS = [
  'electron-standard-shell',
  'tauri-standard-shell',
  'desktop-electron-local-app-host',
  'dev-fixture',
] as const;

export const NIMI_DESKTOP_OPEN_RESULT_REASON_CODES = [
  'desktop-open-desktop-not-running',
  'desktop-open-desktop-not-ready',
  'desktop-open-intent-invalid',
  'desktop-open-target-unsupported',
  'desktop-open-bridge-auth-failed',
  'desktop-open-host-unavailable',
] as const;

export type NimiDesktopOpenSourceHost = typeof NIMI_DESKTOP_OPEN_SOURCE_HOSTS[number];
export type NimiDesktopOpenResultReasonCode = typeof NIMI_DESKTOP_OPEN_RESULT_REASON_CODES[number];
export type NimiDesktopOpenParseReasonCode =
  | 'desktop-open-intent-invalid'
  | 'desktop-open-target-unsupported';

export type NimiDesktopOpenExploreSection = 'worlds' | 'personas' | 'activity';
export type NimiDesktopOpenExploreProductIntent =
  | 'discover-worlds'
  | 'discover-personas'
  | 'select-partner'
  | 'view-activity';
export type NimiDesktopOpenRuntimeConfigPage = 'cloud' | 'models';
export type NimiDesktopOpenRuntimeConfigAction = 'add-connector' | 'install-model';
export type NimiDesktopOpenSettingsSection = 'profile';
export type NimiDesktopOpenAgentsView = 'inventory';

export type NimiDesktopOpenExploreIntent = {
  readonly kind: 'open-explore';
  readonly section: NimiDesktopOpenExploreSection;
  readonly productIntent?: NimiDesktopOpenExploreProductIntent;
  readonly query?: string;
};

export type NimiDesktopOpenRuntimeConfigIntent = {
  readonly kind: 'open-runtime-config';
  readonly page: NimiDesktopOpenRuntimeConfigPage;
  readonly action: NimiDesktopOpenRuntimeConfigAction;
};

export type NimiDesktopOpenAgentsIntent = {
  readonly kind: 'open-agents';
  readonly view: NimiDesktopOpenAgentsView;
};

export type NimiDesktopOpenAppsIntent = {
  readonly kind: 'open-apps';
  readonly appId?: string;
};

export type NimiDesktopOpenSettingsIntent = {
  readonly kind: 'open-settings';
  readonly section: NimiDesktopOpenSettingsSection;
};

export type NimiDesktopOpenIntent =
  | NimiDesktopOpenExploreIntent
  | NimiDesktopOpenRuntimeConfigIntent
  | NimiDesktopOpenAgentsIntent
  | NimiDesktopOpenAppsIntent
  | NimiDesktopOpenSettingsIntent;

export type NimiDesktopOpenIntentKind = NimiDesktopOpenIntent['kind'];

export type NimiDesktopOpenRendererRequest = {
  readonly requestId?: string;
  readonly intent: NimiDesktopOpenIntent;
};

export type NimiDesktopOpenIntentEnvelope = {
  readonly schemaVersion: typeof NIMI_DESKTOP_OPEN_SCHEMA_VERSION;
  readonly sourceApp: string;
  readonly sourceHost: NimiDesktopOpenSourceHost;
  readonly requestId: string;
  readonly intent: NimiDesktopOpenIntent;
};

export type NimiDesktopOpenAcceptedResult = {
  readonly status: 'accepted';
  readonly confirmation: 'desktop-accepted';
  readonly bridgeId: string;
  readonly requestId: string;
  readonly appliedTarget: NimiDesktopOpenIntentKind;
};

export type NimiDesktopOpenRejectedActionHint =
  | 'open_desktop_first'
  | 'wait_for_desktop_ready'
  | 'fix_desktop_open_intent'
  | 'check_desktop_runtime_bridge';

export type NimiDesktopOpenRejectedResult = {
  readonly status: 'rejected';
  readonly reasonCode: NimiDesktopOpenResultReasonCode;
  readonly actionHint: NimiDesktopOpenRejectedActionHint;
};

export type NimiDesktopOpenResult =
  | NimiDesktopOpenAcceptedResult
  | NimiDesktopOpenRejectedResult;

export type NimiDesktopOpenIntentParseResult =
  | { readonly ok: true; readonly value: NimiDesktopOpenIntentEnvelope }
  | { readonly ok: false; readonly error: NimiDesktopOpenIntentParseError };

export type ComposeNimiDesktopOpenIntentEnvelopeInput = {
  readonly sourceApp: string;
  readonly sourceHost: NimiDesktopOpenSourceHost;
  readonly request: NimiDesktopOpenRendererRequest | unknown;
  readonly requestId?: string;
  readonly createRequestId?: () => string;
};

const SOURCE_HOSTS = new Set<string>(NIMI_DESKTOP_OPEN_SOURCE_HOSTS);
const RESULT_REASON_CODES = new Set<string>(NIMI_DESKTOP_OPEN_RESULT_REASON_CODES);
const APP_ID_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*$/u;
const REQUEST_ID_PATTERN = /^desktop-open-[A-Za-z0-9][A-Za-z0-9._:-]{0,114}$/u;
const MAX_APP_ID_LENGTH = 96;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_QUERY_LENGTH = 160;

export class NimiDesktopOpenIntentParseError extends Error {
  readonly reasonCode: NimiDesktopOpenParseReasonCode;
  readonly field?: string;

  constructor(
    reasonCode: NimiDesktopOpenParseReasonCode,
    message: string,
    field?: string,
  ) {
    super(message);
    this.name = 'NimiDesktopOpenIntentParseError';
    this.reasonCode = reasonCode;
    this.field = field;
  }
}

// @nimi-authority: rule.nimi.sdks.feature-clients.r041
export function parseNimiDesktopOpenIntentEnvelope(value: unknown): NimiDesktopOpenIntentEnvelope {
  const record = asRecord(value, 'DesktopOpenIntent envelope');
  assertAllowedFields(record, ['schemaVersion', 'sourceApp', 'sourceHost', 'requestId', 'intent'], 'DesktopOpenIntent envelope');
  if (record.schemaVersion !== NIMI_DESKTOP_OPEN_SCHEMA_VERSION) {
    throw invalid('DesktopOpenIntent envelope schemaVersion must be 1.', 'schemaVersion');
  }
  const sourceApp = parseAppId(record.sourceApp, 'sourceApp');
  const sourceHost = parseSourceHost(record.sourceHost, 'sourceHost');
  const requestId = parseRequestId(record.requestId, 'requestId');
  return {
    schemaVersion: NIMI_DESKTOP_OPEN_SCHEMA_VERSION,
    sourceApp,
    sourceHost,
    requestId,
    intent: parseNimiDesktopOpenIntent(record.intent),
  };
}

export function safeParseNimiDesktopOpenIntentEnvelope(value: unknown): NimiDesktopOpenIntentParseResult {
  try {
    return { ok: true, value: parseNimiDesktopOpenIntentEnvelope(value) };
  } catch (error) {
    if (error instanceof NimiDesktopOpenIntentParseError) {
      return { ok: false, error };
    }
    return {
      ok: false,
      error: invalid(error instanceof Error ? error.message : String(error)),
    };
  }
}

export function parseNimiDesktopOpenRendererRequest(value: unknown): NimiDesktopOpenRendererRequest {
  const record = asRecord(value, 'DesktopOpenIntent renderer request');
  assertAllowedFields(record, ['requestId', 'intent'], 'DesktopOpenIntent renderer request');
  const requestId = record.requestId === undefined
    ? undefined
    : parseRequestId(record.requestId, 'requestId');
  return {
    ...(requestId ? { requestId } : {}),
    intent: parseNimiDesktopOpenIntent(record.intent),
  };
}

export function parseNimiDesktopOpenResult(value: unknown): NimiDesktopOpenResult {
  const record = asRecord(value, 'DesktopOpenIntent result');
  const status = requireString(record.status, 'result.status');
  if (status === 'accepted') {
    assertAllowedFields(record, ['status', 'confirmation', 'bridgeId', 'requestId', 'appliedTarget'], 'DesktopOpenIntent accepted result');
    if (record.confirmation !== 'desktop-accepted') {
      throw invalid('DesktopOpenIntent accepted result confirmation must be desktop-accepted.', 'result.confirmation');
    }
    return {
      status,
      confirmation: 'desktop-accepted',
      bridgeId: parseRequestId(record.bridgeId, 'result.bridgeId'),
      requestId: parseRequestId(record.requestId, 'result.requestId'),
      appliedTarget: parseIntentKind(record.appliedTarget, 'result.appliedTarget'),
    };
  }
  if (status === 'rejected') {
    assertAllowedFields(record, ['status', 'reasonCode', 'actionHint'], 'DesktopOpenIntent rejected result');
    const reasonCode = requireString(record.reasonCode, 'result.reasonCode');
    if (!isNimiDesktopOpenResultReasonCode(reasonCode)) {
      throw invalid(`DesktopOpenIntent result reasonCode is not admitted: ${reasonCode}.`, 'result.reasonCode');
    }
    return {
      status,
      reasonCode,
      actionHint: parseRejectedActionHint(record.actionHint, 'result.actionHint'),
    };
  }
  throw invalid(`DesktopOpenIntent result status is invalid: ${status}.`, 'result.status');
}

export function composeNimiDesktopOpenIntentEnvelope(
  input: ComposeNimiDesktopOpenIntentEnvelopeInput,
): NimiDesktopOpenIntentEnvelope {
  const request = parseNimiDesktopOpenRendererRequest(input.request);
  const requestId = parseRequestId(
    input.requestId ?? request.requestId ?? (input.createRequestId ?? createNimiDesktopOpenRequestId)(),
    'requestId',
  );
  return parseNimiDesktopOpenIntentEnvelope({
    schemaVersion: NIMI_DESKTOP_OPEN_SCHEMA_VERSION,
    sourceApp: input.sourceApp,
    sourceHost: input.sourceHost,
    requestId,
    intent: request.intent,
  });
}

export function createNimiDesktopOpenRequestId(): string {
  const cryptoLike = globalThis.crypto;
  if (cryptoLike && typeof cryptoLike.randomUUID === 'function') {
    return `desktop-open-${cryptoLike.randomUUID()}`;
  }
  if (cryptoLike && typeof cryptoLike.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoLike.getRandomValues(bytes);
    return `desktop-open-${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
  }
  throw invalid('DesktopOpenIntent requestId generation requires host crypto.', 'requestId');
}

export function parseNimiDesktopOpenIntent(value: unknown): NimiDesktopOpenIntent {
  const record = asRecord(value, 'DesktopOpenIntent intent');
  const kind = requireString(record.kind, 'intent.kind');
  switch (kind) {
    case 'open-explore':
      return parseExploreIntent(record);
    case 'open-runtime-config':
      return parseRuntimeConfigIntent(record);
    case 'open-agents':
      return parseAgentsIntent(record);
    case 'open-apps':
      return parseAppsIntent(record);
    case 'open-settings':
      return parseSettingsIntent(record);
    case 'open-url':
      throw invalid('DesktopOpenIntent does not admit raw URL payloads.', 'intent.kind');
    default:
      throw unsupported(`DesktopOpenIntent target is not admitted: ${kind}.`, 'intent.kind');
  }
}

export function isNimiDesktopOpenSourceHost(value: unknown): value is NimiDesktopOpenSourceHost {
  return typeof value === 'string' && SOURCE_HOSTS.has(value);
}

export function isNimiDesktopOpenResultReasonCode(value: unknown): value is NimiDesktopOpenResultReasonCode {
  return typeof value === 'string' && RESULT_REASON_CODES.has(value);
}

function parseExploreIntent(record: Record<string, unknown>): NimiDesktopOpenExploreIntent {
  assertAllowedFields(record, ['kind', 'section', 'productIntent', 'query'], 'DesktopOpenIntent explore intent');
  const section = requireString(record.section, 'intent.section');
  if (section !== 'worlds' && section !== 'personas' && section !== 'activity') {
    throw unsupported(`DesktopOpenIntent explore section is not admitted: ${section}.`, 'intent.section');
  }
  const productIntent = parseOptionalString(record.productIntent, 'intent.productIntent');
  let admittedProductIntent: NimiDesktopOpenExploreProductIntent | undefined;
  if (productIntent !== undefined) {
    if (!isExploreProductIntentAdmitted(section, productIntent)) {
      throw unsupported(
        `DesktopOpenIntent explore productIntent ${productIntent} is not admitted for section ${section}.`,
        'intent.productIntent',
      );
    }
    admittedProductIntent = productIntent;
  }
  const query = parseOptionalQuery(record.query, 'intent.query');
  return {
    kind: 'open-explore',
    section,
    ...(admittedProductIntent ? { productIntent: admittedProductIntent } : {}),
    ...(query ? { query } : {}),
  };
}

function parseRuntimeConfigIntent(record: Record<string, unknown>): NimiDesktopOpenRuntimeConfigIntent {
  assertAllowedFields(record, ['kind', 'page', 'action'], 'DesktopOpenIntent runtime config intent');
  const page = requireString(record.page, 'intent.page');
  const action = requireString(record.action, 'intent.action');
  if (page === 'cloud' && action === 'add-connector') {
    return { kind: 'open-runtime-config', page, action };
  }
  if (page === 'models' && action === 'install-model') {
    return { kind: 'open-runtime-config', page, action };
  }
  throw unsupported(`DesktopOpenIntent runtime config target is not admitted: ${page}.${action}.`, 'intent.action');
}

function parseAgentsIntent(record: Record<string, unknown>): NimiDesktopOpenAgentsIntent {
  assertAllowedFields(record, ['kind', 'view'], 'DesktopOpenIntent agents intent');
  const view = requireString(record.view, 'intent.view');
  if (view !== 'inventory') {
    throw unsupported(`DesktopOpenIntent agents view is not admitted: ${view}.`, 'intent.view');
  }
  return { kind: 'open-agents', view };
}

function parseAppsIntent(record: Record<string, unknown>): NimiDesktopOpenAppsIntent {
  assertAllowedFields(record, ['kind', 'appId'], 'DesktopOpenIntent apps intent');
  const appId = record.appId === undefined ? undefined : parseAppId(record.appId, 'intent.appId');
  return {
    kind: 'open-apps',
    ...(appId ? { appId } : {}),
  };
}

function parseSettingsIntent(record: Record<string, unknown>): NimiDesktopOpenSettingsIntent {
  assertAllowedFields(record, ['kind', 'section'], 'DesktopOpenIntent settings intent');
  const section = requireString(record.section, 'intent.section');
  if (section !== 'profile') {
    throw unsupported(`DesktopOpenIntent settings section is not admitted: ${section}.`, 'intent.section');
  }
  return { kind: 'open-settings', section };
}

function parseIntentKind(value: unknown, field: string): NimiDesktopOpenIntentKind {
  const kind = requireString(value, field);
  if (
    kind === 'open-explore'
    || kind === 'open-runtime-config'
    || kind === 'open-agents'
    || kind === 'open-apps'
    || kind === 'open-settings'
  ) {
    return kind;
  }
  throw invalid(`DesktopOpenIntent result appliedTarget is invalid: ${kind}.`, field);
}

function parseRejectedActionHint(value: unknown, field: string): NimiDesktopOpenRejectedActionHint {
  const actionHint = requireString(value, field);
  if (
    actionHint === 'open_desktop_first'
    || actionHint === 'wait_for_desktop_ready'
    || actionHint === 'fix_desktop_open_intent'
    || actionHint === 'check_desktop_runtime_bridge'
  ) {
    return actionHint;
  }
  throw invalid(`DesktopOpenIntent result actionHint is invalid: ${actionHint}.`, field);
}

function isExploreProductIntentAdmitted(
  section: NimiDesktopOpenExploreSection,
  productIntent: string,
): productIntent is NimiDesktopOpenExploreProductIntent {
  if (section === 'worlds') {
    return productIntent === 'discover-worlds';
  }
  if (section === 'personas') {
    return productIntent === 'discover-personas' || productIntent === 'select-partner';
  }
  return productIntent === 'view-activity';
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function assertAllowedFields(
  record: Record<string, unknown>,
  allowedFields: readonly string[],
  label: string,
): void {
  const allowed = new Set(allowedFields);
  for (const field of Object.keys(record)) {
    if (!allowed.has(field)) {
      throw invalid(`${label} contains unsupported field: ${field}.`, field);
    }
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw invalid(`DesktopOpenIntent ${field} must be a string.`, field);
  }
  const normalized = value.trim();
  if (!normalized) {
    throw invalid(`DesktopOpenIntent ${field} is required.`, field);
  }
  return normalized;
}

function parseOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return requireString(value, field);
}

function parseOptionalQuery(value: unknown, field: string): string | undefined {
  const query = parseOptionalString(value, field);
  if (query === undefined) {
    return undefined;
  }
  if (Array.from(query).length > MAX_QUERY_LENGTH) {
    throw invalid(`DesktopOpenIntent query must be ${MAX_QUERY_LENGTH} characters or fewer.`, field);
  }
  return query;
}

function parseAppId(value: unknown, field: string): string {
  const appId = requireString(value, field);
  if (appId.length > MAX_APP_ID_LENGTH || !APP_ID_PATTERN.test(appId)) {
    throw invalid(`DesktopOpenIntent ${field} is not a valid app id.`, field);
  }
  return appId;
}

function parseRequestId(value: unknown, field: string): string {
  const requestId = requireString(value, field);
  if (requestId.length > MAX_REQUEST_ID_LENGTH || !REQUEST_ID_PATTERN.test(requestId)) {
    throw invalid('DesktopOpenIntent requestId is invalid.', field);
  }
  return requestId;
}

function parseSourceHost(value: unknown, field: string): NimiDesktopOpenSourceHost {
  const sourceHost = requireString(value, field);
  if (!isNimiDesktopOpenSourceHost(sourceHost)) {
    throw invalid(`DesktopOpenIntent sourceHost is not admitted: ${sourceHost}.`, field);
  }
  return sourceHost;
}

function invalid(message: string, field?: string): NimiDesktopOpenIntentParseError {
  return new NimiDesktopOpenIntentParseError('desktop-open-intent-invalid', message, field);
}

function unsupported(message: string, field?: string): NimiDesktopOpenIntentParseError {
  return new NimiDesktopOpenIntentParseError('desktop-open-target-unsupported', message, field);
}
