import type { RuntimeLogMessage } from '@runtime/telemetry/logger';

export type RendererLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type RendererLogMessage = RuntimeLogMessage;

export type RendererLogPayload = {
  level: RendererLogLevel;
  area: string;
  message: RendererLogMessage;
  traceId?: string;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: Record<string, unknown>;
};

export type RuntimeDefaults = {
  apiBaseUrl: string;
  realtimeUrl: string;
  accessToken: string;
  localProviderEndpoint: string;
  localProviderModel: string;
  localOpenAiEndpoint: string;
  localOpenAiApiKey: string;
  targetType: string;
  targetAccountId: string;
  agentId: string;
  worldId: string;
  provider: string;
  userConfirmedUpload: boolean;
};

export type RuntimeBridgeDaemonStatus = {
  running: boolean;
  managed: boolean;
  launchMode: 'RUNTIME' | 'RELEASE' | 'INVALID';
  grpcAddr: string;
  pid?: number;
  lastError?: string;
};

export type RuntimeBridgeConfigGetResult = {
  path: string;
  config: Record<string, unknown>;
};

export type RuntimeBridgeConfigSetResult = {
  path: string;
  reasonCode?: string;
  actionHint?: string;
  config: Record<string, unknown>;
};

export type RuntimeLocalManifestSummary = {
  path: string;
  id: string;
  name?: string;
  version?: string;
  entry?: string;
  entryPath?: string;
  description?: string;
  manifest?: Record<string, unknown>;
};

export type OpenExternalUrlResult = {
  opened: boolean;
};

export type OauthTokenExchangePayload = {
  tokenUrl: string;
  clientId: string;
  code: string;
  codeVerifier?: string;
  redirectUri?: string;
  clientSecret?: string;
  extra?: Record<string, string>;
};

export type OauthTokenExchangeResult = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
  raw: Record<string, unknown>;
};

export type OauthListenForCodePayload = {
  redirectUri: string;
  timeoutMs?: number;
};

export type OauthListenForCodeResult = {
  callbackUrl: string;
  code?: string;
  state?: string;
  error?: string;
};

export type ConfirmPrivateSyncPayload = {
  agentId?: string;
  sessionId?: string;
};

export type ConfirmPrivateSyncResult = {
  confirmed: boolean;
};

export type LocalAiModelStatus = 'installed' | 'active' | 'unhealthy' | 'removed';

export type LocalAiModelRecord = {
  localModelId: string;
  modelId: string;
  capabilities: string[];
  engine: string;
  entry: string;
  license: string;
  source: {
    repo: string;
    revision: string;
  };
  hashes: Record<string, string>;
  endpoint: string;
  status: LocalAiModelStatus;
  installedAt: string;
  updatedAt: string;
  healthDetail?: string;
};

export type LocalAiModelHealth = {
  localModelId: string;
  status: LocalAiModelStatus;
  detail: string;
  endpoint: string;
};

export type LocalAiModelsHealthResult = {
  models: LocalAiModelHealth[];
};

export type LocalAiInferenceAuditEventType =
  | 'inference_invoked'
  | 'inference_failed'
  | 'fallback_to_token_api';

export type LocalAiInferenceAuditModality =
  | 'chat'
  | 'image'
  | 'video'
  | 'tts'
  | 'stt'
  | 'embedding';

export type LocalAiInferenceAuditPayload = {
  eventType: LocalAiInferenceAuditEventType;
  modId: string;
  source: 'local-runtime' | 'token-api';
  provider: string;
  modality: LocalAiInferenceAuditModality;
  adapter: 'openai_compat_adapter' | 'localai_native_adapter' | string;
  model?: string;
  localModelId?: string;
  endpoint?: string;
  reasonCode?: string;
  detail?: string;
  policyGate?: string | Record<string, unknown>;
  extra?: Record<string, unknown>;
};

export type LocalAiAuditEvent = {
  id: string;
  eventType: string;
  occurredAt: string;
  source?: string;
  modality?: string;
  reasonCode?: string;
  detail?: string;
  modelId?: string;
  localModelId?: string;
  payload?: Record<string, unknown>;
};

export type LocalAiAuditTimeRange = {
  from?: string;
  to?: string;
};

export type LocalAiDownloadProgressEvent = {
  installSessionId: string;
  modelId: string;
  localModelId?: string;
  phase: string;
  bytesReceived: number;
  bytesTotal?: number;
  speedBytesPerSec?: number;
  etaSeconds?: number;
  message?: string;
  done: boolean;
  success: boolean;
};

export type LocalAiAuditListPayload = {
  limit?: number;
  eventType?: string;
  eventTypes?: string[];
  source?: string;
  modality?: string;
  localModelId?: string;
  modId?: string;
  reasonCode?: string;
  timeRange?: LocalAiAuditTimeRange;
};

export type LocalAiInstallPayload = {
  modelId: string;
  repo: string;
  revision?: string;
  capabilities?: string[];
  engine?: string;
  entry?: string;
  files?: string[];
  license?: string;
  hashes?: Record<string, string>;
  endpoint?: string;
};

export type LocalAiVerifiedModelDescriptor = {
  templateId: string;
  title: string;
  description: string;
  installKind: string;
  modelId: string;
  repo: string;
  revision: string;
  capabilities: string[];
  engine: string;
  entry: string;
  files: string[];
  license: string;
  hashes: Record<string, string>;
  endpoint: string;
  fileCount: number;
  totalSizeBytes?: number;
  tags: string[];
};

export type LocalAiInstallVerifiedPayload = {
  templateId: string;
  endpoint?: string;
};

export type LocalAiImportPayload = {
  manifestPath: string;
  endpoint?: string;
};

export type ExternalAgentActionExecutionMode = 'full' | 'guarded' | 'opaque';
export type ExternalAgentActionRiskLevel = 'low' | 'medium' | 'high';

export type ExternalAgentActionDescriptor = {
  actionId: string;
  modId: string;
  sourceType: string;
  description?: string;
  operation: 'read' | 'write';
  socialPrecondition: 'none' | 'human-agent-active';
  executionMode: ExternalAgentActionExecutionMode;
  riskLevel: ExternalAgentActionRiskLevel;
  supportsDryRun: boolean;
  idempotent: boolean;
  requiredCapabilities: string[];
};

export type ExternalAgentIssueTokenPayload = {
  principalId: string;
  mode: 'delegated' | 'autonomous';
  subjectAccountId: string;
  actions: string[];
  scopes?: Array<{ actionId: string; ops: string[] }>;
  ttlSeconds?: number;
};

export type ExternalAgentIssueTokenResult = {
  token: string;
  tokenId: string;
  principalId?: string;
  mode?: 'delegated' | 'autonomous';
  subjectAccountId?: string;
  actions?: string[];
  scopes?: Array<{ actionId: string; ops: string[] }>;
  issuedAt?: string;
  expiresAt: string;
  revokedAt?: string;
  issuer: string;
};

export type ExternalAgentRevokeTokenPayload = {
  tokenId: string;
};

export type ExternalAgentTokenRecord = {
  tokenId: string;
  principalId: string;
  mode: 'delegated' | 'autonomous';
  subjectAccountId: string;
  actions: string[];
  scopes: Array<{ actionId: string; ops: string[] }>;
  issuedAt: string;
  expiresAt: string;
  revokedAt?: string;
  issuer: string;
};

export type ExternalAgentGatewayStatus = {
  enabled: boolean;
  bindAddress: string;
  issuer: string;
  actionCount: number;
};

export type ExternalAgentActionExecutionRequest = {
  executionId: string;
  actionId: string;
  phase: 'dry-run' | 'verify' | 'commit';
  input: Record<string, unknown>;
  context: {
    principalId: string;
    principalType: 'external-agent';
    mode: 'delegated' | 'autonomous';
    subjectAccountId: string;
    issuer?: string;
    authTokenId?: string;
    traceId: string;
    userAccountId?: string;
    externalAccountId?: string;
    delegationChain?: string[];
  };
  idempotencyKey?: string;
  verifyTicket?: string;
};

export type ExternalAgentActionExecutionCompletion = {
  executionId: string;
  ok: boolean;
  reasonCode: string;
  actionHint: string;
  traceId: string;
  auditId?: string;
  output?: Record<string, unknown>;
  executionMode: ExternalAgentActionExecutionMode;
  warnings?: string[];
};

function assertRecord(value: unknown, errorMessage: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorMessage);
  }
  return value as Record<string, unknown>;
}

function parseRequiredString(
  value: unknown,
  fieldName: string,
  errorPrefix: string,
): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw new Error(`${errorPrefix}: ${fieldName} is required`);
  }
  return normalized;
}

function parseOptionalString(value: unknown): string | undefined {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

function parseOptionalNumber(value: unknown): number | undefined {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

export function parseRuntimeDefaults(value: unknown): RuntimeDefaults {
  const record = assertRecord(value, 'runtime_defaults returned invalid payload');
  return {
    apiBaseUrl: parseRequiredString(record.apiBaseUrl, 'apiBaseUrl', 'runtime_defaults'),
    realtimeUrl: String(record.realtimeUrl || '').trim(),
    accessToken: String(record.accessToken || '').trim(),
    localProviderEndpoint: parseRequiredString(record.localProviderEndpoint, 'localProviderEndpoint', 'runtime_defaults'),
    localProviderModel: parseRequiredString(record.localProviderModel, 'localProviderModel', 'runtime_defaults'),
    localOpenAiEndpoint: parseRequiredString(record.localOpenAiEndpoint, 'localOpenAiEndpoint', 'runtime_defaults'),
    localOpenAiApiKey: String(record.localOpenAiApiKey || '').trim(),
    targetType: parseRequiredString(record.targetType, 'targetType', 'runtime_defaults'),
    targetAccountId: String(record.targetAccountId || '').trim(),
    agentId: String(record.agentId || '').trim(),
    worldId: String(record.worldId || '').trim(),
    provider: String(record.provider || '').trim(),
    userConfirmedUpload: Boolean(record.userConfirmedUpload),
  };
}

export function parseRuntimeBridgeDaemonStatus(value: unknown): RuntimeBridgeDaemonStatus {
  const record = assertRecord(value, 'runtime_bridge_status returned invalid payload');
  const launchModeRaw = String(record.launchMode || '').trim().toUpperCase();
  const launchMode = launchModeRaw === 'RUNTIME' || launchModeRaw === 'RELEASE'
    ? launchModeRaw
    : 'INVALID';
  return {
    running: Boolean(record.running),
    managed: Boolean(record.managed),
    launchMode,
    grpcAddr: parseRequiredString(record.grpcAddr, 'grpcAddr', 'runtime_bridge_status'),
    pid: parseOptionalNumber(record.pid),
    lastError: parseOptionalString(record.lastError),
  };
}

export function parseRuntimeBridgeConfigGetResult(value: unknown): RuntimeBridgeConfigGetResult {
  const record = assertRecord(value, 'runtime_bridge_config_get returned invalid payload');
  const config = assertRecord(record.config, 'runtime_bridge_config_get config payload is invalid');
  return {
    path: parseRequiredString(record.path, 'path', 'runtime_bridge_config_get'),
    config,
  };
}

export function parseRuntimeBridgeConfigSetResult(value: unknown): RuntimeBridgeConfigSetResult {
  const record = assertRecord(value, 'runtime_bridge_config_set returned invalid payload');
  const config = assertRecord(record.config, 'runtime_bridge_config_set config payload is invalid');
  return {
    path: parseRequiredString(record.path, 'path', 'runtime_bridge_config_set'),
    reasonCode: parseOptionalString(record.reasonCode),
    actionHint: parseOptionalString(record.actionHint),
    config,
  };
}

export function parseRuntimeLocalManifestSummary(value: unknown): RuntimeLocalManifestSummary {
  const record = assertRecord(value, 'runtime_mod_list_local_manifests returned invalid manifest payload');
  const manifestRecord = record.manifest && typeof record.manifest === 'object' && !Array.isArray(record.manifest)
    ? (record.manifest as Record<string, unknown>)
    : undefined;
  return {
    path: parseRequiredString(record.path, 'path', 'runtime_mod_list_local_manifests'),
    id: parseRequiredString(record.id, 'id', 'runtime_mod_list_local_manifests'),
    name: parseOptionalString(record.name),
    version: parseOptionalString(record.version),
    entry: parseOptionalString(record.entry),
    entryPath: parseOptionalString(record.entryPath),
    description: parseOptionalString(record.description),
    manifest: manifestRecord,
  };
}

export function parseRuntimeLocalManifestSummaries(value: unknown): RuntimeLocalManifestSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseRuntimeLocalManifestSummary(item));
}

export function parseOpenExternalUrlResult(value: unknown): OpenExternalUrlResult {
  const record = assertRecord(value, 'open_external_url returned invalid payload');
  return {
    opened: Boolean(record.opened),
  };
}

export function parseConfirmPrivateSyncResult(value: unknown): ConfirmPrivateSyncResult {
  const record = assertRecord(value, 'confirm_private_sync returned invalid payload');
  return {
    confirmed: Boolean(record.confirmed),
  };
}

export function parseOauthTokenExchangeResult(value: unknown): OauthTokenExchangeResult {
  const record = assertRecord(value, 'oauth_token_exchange returned invalid payload');
  const raw = record.raw && typeof record.raw === 'object' && !Array.isArray(record.raw)
    ? (record.raw as Record<string, unknown>)
    : {};
  return {
    accessToken: parseRequiredString(record.accessToken, 'accessToken', 'oauth_token_exchange'),
    refreshToken: parseOptionalString(record.refreshToken),
    tokenType: parseOptionalString(record.tokenType),
    expiresIn: Number.isFinite(Number(record.expiresIn)) ? Number(record.expiresIn) : undefined,
    scope: parseOptionalString(record.scope),
    raw,
  };
}

export function parseOauthListenForCodeResult(value: unknown): OauthListenForCodeResult {
  const record = assertRecord(value, 'oauth_listen_for_code returned invalid payload');
  return {
    callbackUrl: parseRequiredString(record.callbackUrl, 'callbackUrl', 'oauth_listen_for_code'),
    code: parseOptionalString(record.code),
    state: parseOptionalString(record.state),
    error: parseOptionalString(record.error),
  };
}

export function parseLocalAiModelRecord(value: unknown): LocalAiModelRecord {
  const record = assertRecord(value, 'local_runtime returned invalid model payload');
  const source = assertRecord(record.source, 'local_runtime model source is invalid');
  const hashes = assertRecord(record.hashes || {}, 'local_runtime model hashes is invalid');
  const rawCapabilities = Array.isArray(record.capabilities) ? record.capabilities : [];
  const statusValue = String(record.status || '').trim();
  const normalizedStatus: LocalAiModelStatus = (
    statusValue === 'active'
    || statusValue === 'unhealthy'
    || statusValue === 'removed'
  )
    ? statusValue
    : 'installed';

  return {
    localModelId: parseRequiredString(record.localModelId, 'localModelId', 'local_runtime model'),
    modelId: parseRequiredString(record.modelId, 'modelId', 'local_runtime model'),
    capabilities: rawCapabilities.map((capability) => String(capability || '').trim()).filter(Boolean),
    engine: parseRequiredString(record.engine, 'engine', 'local_runtime model'),
    entry: parseRequiredString(record.entry, 'entry', 'local_runtime model'),
    license: parseRequiredString(record.license, 'license', 'local_runtime model'),
    source: {
      repo: parseRequiredString(source.repo, 'source.repo', 'local_runtime model'),
      revision: parseRequiredString(source.revision, 'source.revision', 'local_runtime model'),
    },
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hashValue]) => [String(key), String(hashValue || '').trim()]),
    ),
    endpoint: parseRequiredString(record.endpoint, 'endpoint', 'local_runtime model'),
    status: normalizedStatus,
    installedAt: parseRequiredString(record.installedAt, 'installedAt', 'local_runtime model'),
    updatedAt: parseRequiredString(record.updatedAt, 'updatedAt', 'local_runtime model'),
    healthDetail: parseOptionalString(record.healthDetail),
  };
}

export function parseLocalAiVerifiedModelDescriptor(value: unknown): LocalAiVerifiedModelDescriptor {
  const record = assertRecord(value, 'local_runtime_models_verified_list returned invalid payload');
  const hashes = assertRecord(record.hashes || {}, 'local_runtime_models_verified_list hashes is invalid');
  const files = Array.isArray(record.files)
    ? record.files.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const capabilities = Array.isArray(record.capabilities)
    ? record.capabilities.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const tags = Array.isArray(record.tags)
    ? record.tags.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
  const fileCountRaw = Number(record.fileCount);
  const totalSizeBytesRaw = Number(record.totalSizeBytes);
  return {
    templateId: parseRequiredString(record.templateId, 'templateId', 'local_runtime_models_verified_list'),
    title: parseRequiredString(record.title, 'title', 'local_runtime_models_verified_list'),
    description: String(record.description || '').trim(),
    installKind: parseRequiredString(record.installKind, 'installKind', 'local_runtime_models_verified_list'),
    modelId: parseRequiredString(record.modelId, 'modelId', 'local_runtime_models_verified_list'),
    repo: parseRequiredString(record.repo, 'repo', 'local_runtime_models_verified_list'),
    revision: parseRequiredString(record.revision, 'revision', 'local_runtime_models_verified_list'),
    capabilities,
    engine: parseRequiredString(record.engine, 'engine', 'local_runtime_models_verified_list'),
    entry: parseRequiredString(record.entry, 'entry', 'local_runtime_models_verified_list'),
    files,
    license: parseRequiredString(record.license, 'license', 'local_runtime_models_verified_list'),
    hashes: Object.fromEntries(
      Object.entries(hashes).map(([key, hashValue]) => [String(key), String(hashValue || '').trim()]),
    ),
    endpoint: parseRequiredString(record.endpoint, 'endpoint', 'local_runtime_models_verified_list'),
    fileCount: Number.isFinite(fileCountRaw) && fileCountRaw > 0 ? fileCountRaw : files.length,
    totalSizeBytes: Number.isFinite(totalSizeBytesRaw) && totalSizeBytesRaw > 0 ? totalSizeBytesRaw : undefined,
    tags,
  };
}

export function parseLocalAiVerifiedModelDescriptorList(value: unknown): LocalAiVerifiedModelDescriptor[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseLocalAiVerifiedModelDescriptor(item));
}

export function parseLocalAiModelRecordList(value: unknown): LocalAiModelRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseLocalAiModelRecord(item));
}

export function parseLocalAiModelsHealthResult(value: unknown): LocalAiModelsHealthResult {
  const record = assertRecord(value, 'local_runtime_models_health returned invalid payload');
  const rows = Array.isArray(record.models) ? record.models : [];
  return {
    models: rows.map((item) => {
      const row = assertRecord(item, 'local_runtime_models_health model payload is invalid');
      const statusValue = String(row.status || '').trim();
      const status: LocalAiModelStatus = (
        statusValue === 'active'
        || statusValue === 'unhealthy'
        || statusValue === 'removed'
      )
        ? statusValue
        : 'installed';
      return {
        localModelId: parseRequiredString(row.localModelId, 'localModelId', 'local_runtime_models_health'),
        status,
        detail: String(row.detail || '').trim(),
        endpoint: String(row.endpoint || '').trim(),
      };
    }),
  };
}

export function parseLocalAiAuditEvent(value: unknown): LocalAiAuditEvent {
  const record = assertRecord(value, 'local_runtime_audits_list returned invalid payload');
  const payload = record.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? (record.payload as Record<string, unknown>)
    : undefined;
  const source = parseOptionalString(record.source || payload?.source);
  const modality = parseOptionalString(record.modality || payload?.modality);
  const reasonCode = parseOptionalString(record.reasonCode || payload?.reasonCode);
  const detail = parseOptionalString(record.detail || payload?.detail || payload?.error);
  return {
    id: parseRequiredString(record.id, 'id', 'local_runtime_audits_list'),
    eventType: parseRequiredString(record.eventType, 'eventType', 'local_runtime_audits_list'),
    occurredAt: parseRequiredString(record.occurredAt, 'occurredAt', 'local_runtime_audits_list'),
    source,
    modality,
    reasonCode,
    detail,
    modelId: parseOptionalString(record.modelId),
    localModelId: parseOptionalString(record.localModelId),
    payload,
  };
}

export function parseLocalAiAuditEventList(value: unknown): LocalAiAuditEvent[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => parseLocalAiAuditEvent(item));
}

export function parseLocalAiPickManifestResult(value: unknown): string | null {
  if (value == null) return null;
  const normalized = String(value || '').trim();
  return normalized || null;
}

export function parseLocalAiDownloadProgressEvent(value: unknown): LocalAiDownloadProgressEvent {
  const record = assertRecord(value, 'local-ai://download-progress returned invalid payload');
  const bytesReceived = Number(record.bytesReceived);
  const bytesTotalRaw = Number(record.bytesTotal);
  const speedRaw = Number(record.speedBytesPerSec);
  const etaRaw = Number(record.etaSeconds);
  return {
    installSessionId: parseRequiredString(record.installSessionId, 'installSessionId', 'local-ai://download-progress'),
    modelId: parseRequiredString(record.modelId, 'modelId', 'local-ai://download-progress'),
    localModelId: parseOptionalString(record.localModelId),
    phase: parseRequiredString(record.phase, 'phase', 'local-ai://download-progress'),
    bytesReceived: Number.isFinite(bytesReceived) && bytesReceived >= 0 ? bytesReceived : 0,
    bytesTotal: Number.isFinite(bytesTotalRaw) && bytesTotalRaw >= 0 ? bytesTotalRaw : undefined,
    speedBytesPerSec: Number.isFinite(speedRaw) && speedRaw >= 0 ? speedRaw : undefined,
    etaSeconds: Number.isFinite(etaRaw) && etaRaw >= 0 ? etaRaw : undefined,
    message: parseOptionalString(record.message),
    done: Boolean(record.done),
    success: Boolean(record.success),
  };
}

export function parseExternalAgentActionDescriptors(value: unknown): ExternalAgentActionDescriptor[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = assertRecord(item, 'external_agent_sync_action_descriptors returned invalid action descriptor');
    const executionModeRaw = String(record.executionMode || '').trim();
    const riskLevelRaw = String(record.riskLevel || '').trim();
    const executionMode: ExternalAgentActionExecutionMode = (
      executionModeRaw === 'full'
      || executionModeRaw === 'opaque'
    )
      ? executionModeRaw
      : 'guarded';
    const riskLevel: ExternalAgentActionRiskLevel = (
      riskLevelRaw === 'low'
      || riskLevelRaw === 'high'
    )
      ? riskLevelRaw
      : 'medium';
    const requiredCapabilities = Array.isArray(record.requiredCapabilities)
      ? record.requiredCapabilities.map((entry) => String(entry || '').trim()).filter(Boolean)
      : [];
    const operationRaw = String(record.operation || '').trim();
    const socialPreconditionRaw = String(record.socialPrecondition || '').trim();
    const operation = operationRaw === 'write' ? 'write' : 'read';
    const socialPrecondition = socialPreconditionRaw === 'human-agent-active'
      ? 'human-agent-active'
      : 'none';
    return {
      actionId: parseRequiredString(record.actionId, 'actionId', 'external-agent action descriptor'),
      modId: parseRequiredString(record.modId, 'modId', 'external-agent action descriptor'),
      sourceType: parseRequiredString(record.sourceType, 'sourceType', 'external-agent action descriptor'),
      description: parseOptionalString(record.description),
      operation,
      socialPrecondition,
      executionMode,
      riskLevel,
      supportsDryRun: Boolean(record.supportsDryRun),
      idempotent: Boolean(record.idempotent),
      requiredCapabilities,
    };
  });
}

export function parseExternalAgentIssueTokenResult(value: unknown): ExternalAgentIssueTokenResult {
  const record = assertRecord(value, 'external_agent_issue_token returned invalid payload');
  const modeRaw = String(record.mode || '').trim();
  const mode = modeRaw === 'autonomous' ? 'autonomous' : modeRaw === 'delegated' ? 'delegated' : undefined;
  const actions = Array.isArray(record.actions)
    ? record.actions.map((entry) => String(entry || '').trim()).filter(Boolean)
    : undefined;
  const scopes = Array.isArray(record.scopes)
    ? record.scopes.map((entry) => {
      const scope = assertRecord(entry, 'external_agent_issue_token returned invalid scope');
      return {
        actionId: parseRequiredString(scope.actionId, 'actionId', 'external_agent_issue_token'),
        ops: Array.isArray(scope.ops) ? scope.ops.map((op) => String(op || '').trim()).filter(Boolean) : [],
      };
    })
    : undefined;
  return {
    token: parseRequiredString(record.token, 'token', 'external_agent_issue_token'),
    tokenId: parseRequiredString(record.tokenId, 'tokenId', 'external_agent_issue_token'),
    principalId: parseOptionalString(record.principalId),
    mode,
    subjectAccountId: parseOptionalString(record.subjectAccountId),
    actions,
    scopes,
    issuedAt: parseOptionalString(record.issuedAt),
    expiresAt: parseRequiredString(record.expiresAt, 'expiresAt', 'external_agent_issue_token'),
    revokedAt: parseOptionalString(record.revokedAt),
    issuer: parseRequiredString(record.issuer, 'issuer', 'external_agent_issue_token'),
  };
}

export function parseExternalAgentTokenRecord(value: unknown): ExternalAgentTokenRecord {
  const record = assertRecord(value, 'external_agent_list_tokens returned invalid payload');
  const modeRaw = String(record.mode || '').trim();
  const mode: 'delegated' | 'autonomous' = modeRaw === 'autonomous' ? 'autonomous' : 'delegated';
  const actions = Array.isArray(record.actions)
    ? record.actions.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];
  const scopes = Array.isArray(record.scopes)
    ? record.scopes.map((entry) => {
      const scope = assertRecord(entry, 'external_agent_list_tokens returned invalid scope');
      return {
        actionId: parseRequiredString(scope.actionId, 'actionId', 'external_agent_list_tokens'),
        ops: Array.isArray(scope.ops) ? scope.ops.map((op) => String(op || '').trim()).filter(Boolean) : [],
      };
    })
    : [];
  return {
    tokenId: parseRequiredString(record.tokenId, 'tokenId', 'external_agent_list_tokens'),
    principalId: parseRequiredString(record.principalId, 'principalId', 'external_agent_list_tokens'),
    mode,
    subjectAccountId: parseRequiredString(record.subjectAccountId, 'subjectAccountId', 'external_agent_list_tokens'),
    actions,
    scopes,
    issuedAt: parseRequiredString(record.issuedAt, 'issuedAt', 'external_agent_list_tokens'),
    expiresAt: parseRequiredString(record.expiresAt, 'expiresAt', 'external_agent_list_tokens'),
    revokedAt: parseOptionalString(record.revokedAt),
    issuer: parseRequiredString(record.issuer, 'issuer', 'external_agent_list_tokens'),
  };
}

export function parseExternalAgentTokenRecordList(value: unknown): ExternalAgentTokenRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => parseExternalAgentTokenRecord(item));
}

export function parseExternalAgentGatewayStatus(value: unknown): ExternalAgentGatewayStatus {
  const record = assertRecord(value, 'external_agent_gateway_status returned invalid payload');
  return {
    enabled: Boolean(record.enabled),
    bindAddress: parseRequiredString(record.bindAddress, 'bindAddress', 'external_agent_gateway_status'),
    issuer: parseRequiredString(record.issuer, 'issuer', 'external_agent_gateway_status'),
    actionCount: Number.isFinite(Number(record.actionCount)) ? Number(record.actionCount) : 0,
  };
}

declare global {
  interface Window {
    __TAURI__?: {
      core?: {
        invoke?: (command: string, payload?: unknown) => Promise<unknown>;
      };
      event?: {
        listen?: (
          eventName: string,
          handler: (event: { event: string; id?: number; payload: unknown }) => void,
        ) => Promise<(() => void) | undefined> | (() => void) | undefined;
        emit?: (eventName: string, payload?: unknown) => Promise<void> | void;
      };
    };
    __NIMI_HTML_BOOT_ID__?: string;
  }
}
