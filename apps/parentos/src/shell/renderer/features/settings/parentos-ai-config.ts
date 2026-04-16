import type {
  AIRuntimeLocalProfileRef,
  AIProfileRef,
  AIScopeRef,
  AIConfig,
  RuntimeRouteBinding,
} from '@nimiplatform/sdk/mod';
import { createEmptyAIConfig, parseRuntimeRouteBinding } from '@nimiplatform/sdk/mod';
import { getAppSetting, setAppSetting } from '../../bridge/sqlite-bridge.js';
import { isoNow } from '../../bridge/ulid.js';

export const PARENTOS_AI_SCOPE_REF: AIScopeRef = {
  kind: 'app',
  ownerId: 'parentos',
  surfaceId: 'parentos.ai',
};

const PARENTOS_AI_CONFIG_SETTING_KEY = 'parentos.ai.config';

export type ParentosCapabilityId = 'text.generate' | 'text.generate.vision' | 'audio.transcribe';

export const PARENTOS_CAPABILITIES: Array<{
  id: ParentosCapabilityId;
  routeCapability: string;
  label: string;
  detail: string;
}> = [
  {
    id: 'text.generate',
    routeCapability: 'text.generate',
    label: 'AI 对话',
    detail: '用于成长提问、日志标签与分析报告生成',
  },
  {
    id: 'text.generate.vision',
    routeCapability: 'text.generate.vision',
    label: '智能识别',
    detail: '用于验光单、眼轴单、体检单等图片识别',
  },
  {
    id: 'audio.transcribe',
    routeCapability: 'audio.transcribe',
    label: '语音转写',
    detail: '用于语音观察记录',
  },
];

export function createEmptyParentosAIConfig(): AIConfig {
  return createEmptyAIConfig(PARENTOS_AI_SCOPE_REF);
}

export function isParentosAIScopeRef(scopeRef: AIScopeRef | null | undefined): boolean {
  return scopeRef?.kind === PARENTOS_AI_SCOPE_REF.kind
    && scopeRef?.ownerId === PARENTOS_AI_SCOPE_REF.ownerId
    && scopeRef?.surfaceId === PARENTOS_AI_SCOPE_REF.surfaceId;
}

export function bindingFromConfig(config: AIConfig, capabilityId: ParentosCapabilityId): RuntimeRouteBinding | null {
  const binding = (config.capabilities.selectedBindings[capabilityId] || null) as RuntimeRouteBinding | null;
  if (!binding) {
    return null;
  }
  return normalizeBindingForParentosConfig(binding);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function trimString(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeScopeRef(value: unknown): AIScopeRef | null {
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const kind = trimString(record.kind);
  const ownerId = trimString(record.ownerId);
  const surfaceId = trimString(record.surfaceId);
  if (
    kind !== PARENTOS_AI_SCOPE_REF.kind
    || ownerId !== PARENTOS_AI_SCOPE_REF.ownerId
    || surfaceId !== PARENTOS_AI_SCOPE_REF.surfaceId
  ) {
    return null;
  }
  return { ...PARENTOS_AI_SCOPE_REF };
}

function normalizeLocalProfileRefs(
  value: unknown,
): AIConfig['capabilities']['localProfileRefs'] {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  const normalized: AIConfig['capabilities']['localProfileRefs'] = {};
  for (const [capabilityId, profileRefValue] of Object.entries(record)) {
    if (profileRefValue == null) {
      normalized[capabilityId] = null;
      continue;
    }
    const profileRefRecord = asRecord(profileRefValue);
    if (!profileRefRecord) {
      continue;
    }
    const modId = trimString(profileRefRecord.modId);
    const profileId = trimString(profileRefRecord.profileId);
    if (!modId || !profileId) {
      continue;
    }
    normalized[capabilityId] = {
      modId,
      profileId,
    } satisfies AIRuntimeLocalProfileRef;
  }
  return normalized;
}

function normalizeSelectedParams(
  value: unknown,
): AIConfig['capabilities']['selectedParams'] {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  const normalized: AIConfig['capabilities']['selectedParams'] = {};
  for (const [capabilityId, paramsValue] of Object.entries(record)) {
    const paramsRecord = asRecord(paramsValue);
    if (!paramsRecord) {
      continue;
    }
    normalized[capabilityId] = { ...paramsRecord };
  }
  return normalized;
}

function normalizeSelectedBindings(
  value: unknown,
): AIConfig['capabilities']['selectedBindings'] {
  const record = asRecord(value);
  if (!record) {
    return {};
  }
  const normalized: AIConfig['capabilities']['selectedBindings'] = {};
  for (const [capabilityId, bindingValue] of Object.entries(record)) {
    if (bindingValue === null) {
      normalized[capabilityId] = null;
      continue;
    }
    const binding = parseRuntimeRouteBinding(bindingValue);
    if (!binding) {
      continue;
    }
    normalized[capabilityId] = normalizeBindingForParentosConfig(binding);
  }
  return normalized;
}

function normalizeBindingForParentosConfig(binding: RuntimeRouteBinding): RuntimeRouteBinding {
  const source = binding.source === 'cloud' ? 'cloud' : 'local';
  return {
    ...binding,
    source,
    connectorId: source === 'cloud' ? trimString(binding.connectorId) : '',
    model: trimString(binding.model),
  };
}

function normalizeProfileOrigin(value: unknown): AIProfileRef | null {
  if (value == null) {
    return null;
  }
  const record = asRecord(value);
  if (!record) {
    return null;
  }
  const profileId = trimString(record.profileId);
  const title = trimString(record.title);
  const appliedAt = trimString(record.appliedAt);
  if (!profileId || !title || !appliedAt) {
    return null;
  }
  return {
    profileId,
    title,
    appliedAt,
  };
}

export function parsePersistedParentosAIConfig(value: unknown): AIConfig | null {
  let parsedValue = value;
  if (typeof parsedValue === 'string') {
    const raw = trimString(parsedValue);
    if (!raw) {
      return null;
    }
    try {
      parsedValue = JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  const record = asRecord(parsedValue);
  if (!record) {
    return null;
  }

  const scopeRef = normalizeScopeRef(record.scopeRef);
  if (!scopeRef) {
    return null;
  }

  const capabilitiesRecord = asRecord(record.capabilities);
  if (!capabilitiesRecord) {
    return null;
  }

  return {
    scopeRef,
    capabilities: {
      selectedBindings: normalizeSelectedBindings(capabilitiesRecord.selectedBindings),
      localProfileRefs: normalizeLocalProfileRefs(capabilitiesRecord.localProfileRefs),
      selectedParams: normalizeSelectedParams(capabilitiesRecord.selectedParams),
    },
    profileOrigin: normalizeProfileOrigin(record.profileOrigin),
  };
}

export async function loadPersistedParentosAIConfig(): Promise<AIConfig | null> {
  try {
    const raw = await getAppSetting(PARENTOS_AI_CONFIG_SETTING_KEY);
    return parsePersistedParentosAIConfig(raw);
  } catch {
    return null;
  }
}

export async function savePersistedParentosAIConfig(config: AIConfig): Promise<void> {
  const normalized = parsePersistedParentosAIConfig(config);
  if (!normalized) {
    throw new Error('ParentOS AI config is invalid');
  }
  await setAppSetting(
    PARENTOS_AI_CONFIG_SETTING_KEY,
    JSON.stringify(normalized),
    isoNow(),
  );
}
