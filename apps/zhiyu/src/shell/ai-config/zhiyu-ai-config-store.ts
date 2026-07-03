import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { hasShellHostInvoke, invokeChecked } from '@nimiplatform/kit/shell/renderer/bridge';
import type { JsonValue } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  areNimiAIScopeRefsEqual,
  createEmptyNimiAIConfig,
  createNimiAIConfigSubscriptionRegistry,
  diffNimiAIConfigs,
  encodeNimiAIScopeRef,
  previewNimiAIProfileApply,
  validateNimiAIConfig,
  versionNimiAIConfig,
  type NimiAIConfig,
  type NimiAIProfile,
  type NimiAIProfileApplyOptions,
  type NimiAIProfileApplyResult,
  type NimiAIProfilePreviewOptions,
  type NimiAIProfilePreviewResult,
  type NimiAIScopeRef,
} from '@nimiplatform/sdk/ai';
import type {
  SharedAIConfigService,
  SharedAIConfigSubscribeListener,
  SharedAIConfigUnsubscribe,
} from '@nimiplatform/kit/features/model-config/headless';
import { appId } from '../auth/runtime-platform';

export const ZHIYU_AGENT_HOME_AI_SURFACE_ID = 'zhiyu-agent-home';

const configSubscriptions = createNimiAIConfigSubscriptionRegistry();
const configCache = new Map<string, NimiAIConfig>();
const hydrationByScope = new Map<string, Promise<void>>();

let serviceSingleton: SharedAIConfigService | null = null;

export function createZhiyuAgentHomeAIScopeRef(): NimiAIScopeRef {
  return {
    kind: 'app',
    ownerId: appId,
    surfaceId: ZHIYU_AGENT_HOME_AI_SURFACE_ID,
  };
}

export function loadZhiyuAIConfig(scopeRef: NimiAIScopeRef = createZhiyuAgentHomeAIScopeRef()): NimiAIConfig {
  const key = scopeKey(scopeRef);
  const cached = configCache.get(key);
  if (cached) {
    return cached;
  }
  const fallback = createEmptyNimiAIConfig(scopeRef);
  configCache.set(key, fallback);
  void hydrateZhiyuAIConfig(scopeRef);
  return fallback;
}

export function createZhiyuAIConfigService(): SharedAIConfigService {
  serviceSingleton ??= {
    aiConfig: {
      get(scopeRef: NimiAIScopeRef) {
        return loadZhiyuAIConfig(scopeRef);
      },
      update(scopeRef: NimiAIScopeRef, next: NimiAIConfig) {
        assertValidZhiyuAIConfig(scopeRef, next);
        assertShellFacadeAvailable(NIMI_STANDARD_SHELL_COMMANDS['ai-config.set']);
        void commitZhiyuAIConfigThroughFacade(scopeRef, next).catch(() => undefined);
      },
      subscribe(scopeRef: NimiAIScopeRef, listener: SharedAIConfigSubscribeListener): SharedAIConfigUnsubscribe {
        void hydrateZhiyuAIConfig(scopeRef);
        return configSubscriptions.subscribe(scopeRef, listener);
      },
    },
    aiProfile: {
      async list() {
        return [];
      },
      async previewApply(
        scopeRef: NimiAIScopeRef,
        profileId: string,
        options: NimiAIProfilePreviewOptions,
      ): Promise<NimiAIProfilePreviewResult> {
        const profile = await getZhiyuAIProfileFromFacade(profileId);
        const before = await getZhiyuAIConfigFromFacadeOrProjection(scopeRef);
        if (!profile) {
          return missingProfilePreview(scopeRef, before, profileId);
        }
        return previewNimiAIProfileApply({
          before,
          scopeRef,
          profile,
          requirementDeclarations: options.requirementDeclarations,
        });
      },
      async apply(
        scopeRef: NimiAIScopeRef,
        profileId: string,
        options: NimiAIProfileApplyOptions,
      ): Promise<NimiAIProfileApplyResult> {
        const preview = await serviceSingleton!.aiProfile.previewApply(scopeRef, profileId, {
          requirementDeclarations: options.requirementDeclarations,
        });
        if (preview.outcome !== 'ready_to_apply' || !preview.after) {
          return {
            success: false,
            config: null,
            failureReason: preview.outcome,
            outcome: preview.outcome,
            setupProjection: preview.setupProjection,
            probeWarnings: preview.probeWarnings,
          };
        }
        if (options.expectedBaseVersion && options.expectedBaseVersion !== preview.baseVersion) {
          return {
            success: false,
            config: null,
            failureReason: 'stale_base',
            outcome: 'stale_base',
            probeWarnings: [],
          };
        }
        const saved = await commitZhiyuAIConfigThroughFacade(scopeRef, preview.after);
        return {
          success: true,
          config: saved,
          failureReason: null,
          outcome: 'ready_to_apply',
          probeWarnings: [],
        };
      },
    },
  };
  return serviceSingleton;
}

async function hydrateZhiyuAIConfig(scopeRef: NimiAIScopeRef): Promise<void> {
  const key = scopeKey(scopeRef);
  if (hydrationByScope.has(key)) {
    return hydrationByScope.get(key);
  }
  const hydration = (async () => {
    const config = await getZhiyuAIConfigFromFacade(scopeRef);
    if (!config) {
      return;
    }
    configCache.set(key, config);
    configSubscriptions.notify(config);
  })().finally(() => {
    hydrationByScope.delete(key);
  });
  hydrationByScope.set(key, hydration);
  return hydration;
}

async function getZhiyuAIConfigFromFacadeOrProjection(scopeRef: NimiAIScopeRef): Promise<NimiAIConfig | null> {
  return await getZhiyuAIConfigFromFacade(scopeRef) ?? configCache.get(scopeKey(scopeRef)) ?? null;
}

async function getZhiyuAIConfigFromFacade(scopeRef: NimiAIScopeRef): Promise<NimiAIConfig | null> {
  if (!hasShellHostInvoke()) {
    return null;
  }
  try {
    return await invokeChecked(
      NIMI_STANDARD_SHELL_COMMANDS['ai-config.get'],
      { scopeRef: scopeKey(scopeRef) },
      (value) => parseAIConfigFacadeResult(value, scopeRef, NIMI_STANDARD_SHELL_COMMANDS['ai-config.get']),
    );
  } catch (error) {
    if (isShellNotFound(error) || isShellCapabilityUnavailable(error)) {
      return null;
    }
    throw error;
  }
}

async function commitZhiyuAIConfigThroughFacade(
  scopeRef: NimiAIScopeRef,
  next: NimiAIConfig,
): Promise<NimiAIConfig> {
  assertValidZhiyuAIConfig(scopeRef, next);
  assertShellFacadeAvailable(NIMI_STANDARD_SHELL_COMMANDS['ai-config.set']);
  const saved = await invokeChecked<NimiAIConfig>(
    NIMI_STANDARD_SHELL_COMMANDS['ai-config.set'],
    { scopeRef: scopeKey(scopeRef), config: next as unknown as JsonValue },
    (value) => parseAIConfigFacadeResult(value, scopeRef, NIMI_STANDARD_SHELL_COMMANDS['ai-config.set']),
  );
  configCache.set(scopeKey(scopeRef), saved);
  configSubscriptions.notify(saved);
  return saved;
}

async function getZhiyuAIProfileFromFacade(profileId: string): Promise<NimiAIProfile | null> {
  const alias = String(profileId || '').trim();
  if (!alias || !hasShellHostInvoke()) {
    return null;
  }
  try {
    return await invokeChecked(
      NIMI_STANDARD_SHELL_COMMANDS['ai-profile.get'],
      { alias },
      parseAIProfileFacadeResult,
    );
  } catch (error) {
    if (isShellNotFound(error) || isShellCapabilityUnavailable(error)) {
      return null;
    }
    throw error;
  }
}

function parseAIConfigFacadeResult(
  value: unknown,
  scopeRef: NimiAIScopeRef,
  command: string,
): NimiAIConfig {
  const record = asRecord(value, `${command} returned invalid AI config facade payload`);
  const config = asRecord(record.config, `${command} returned missing AI config`);
  const validation = validateNimiAIConfig(config);
  if (!validation.valid) {
    throw new Error(`${command} returned invalid AI config: ${validation.errors.join('; ')}`);
  }
  const parsed = config as unknown as NimiAIConfig;
  if (!areNimiAIScopeRefsEqual(parsed.scopeRef, scopeRef)) {
    throw new Error(`${command} returned AI config for a different scope.`);
  }
  return parsed;
}

function parseAIProfileFacadeResult(value: unknown): NimiAIProfile | null {
  const record = asRecord(value, 'nimi.shell.aiProfile.get returned invalid payload');
  const profile = record.profile && typeof record.profile === 'object'
    ? record.profile
    : record;
  return profile as unknown as NimiAIProfile;
}

function assertValidZhiyuAIConfig(scopeRef: NimiAIScopeRef, config: NimiAIConfig): void {
  const validation = validateNimiAIConfig(config);
  if (!validation.valid) {
    throw new Error(`Zhiyu AI config facade rejected invalid config: ${validation.errors.join('; ')}`);
  }
  if (!areNimiAIScopeRefsEqual(config.scopeRef, scopeRef)) {
    throw new Error('Zhiyu AI config facade rejected a scopeRef mismatch.');
  }
}

function assertShellFacadeAvailable(command: string): void {
  if (!hasShellHostInvoke()) {
    throw new Error(`Zhiyu AI config facade requires standard shell command: ${command}`);
  }
}

function missingProfilePreview(
  scopeRef: NimiAIScopeRef,
  before: NimiAIConfig | null,
  profileId: string,
): NimiAIProfilePreviewResult {
  return {
    before,
    after: null,
    outcome: 'invalid_profile',
    diff: diffNimiAIConfigs(before, null),
    baseVersion: versionNimiAIConfig(before ?? createEmptyNimiAIConfig(scopeRef)),
    probeWarnings: [`AI profile not found: ${profileId}`],
  };
}

function scopeKey(scopeRef: NimiAIScopeRef): string {
  return encodeNimiAIScopeRef(scopeRef);
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(message);
  }
  return value as Record<string, unknown>;
}

function isShellNotFound(error: unknown): boolean {
  return shellErrorField(error, 'code') === 'not-found'
    || shellErrorField(error, 'reasonCode').includes('not-found');
}

function isShellCapabilityUnavailable(error: unknown): boolean {
  return shellErrorField(error, 'code') === 'capability-unavailable'
    || shellErrorField(error, 'reasonCode') === 'electron-standard-capability-unavailable'
    || shellErrorField(error, 'reasonCode') === 'renderer-standard-shell-host-unavailable';
}

function shellErrorField(error: unknown, field: 'code' | 'reasonCode'): string {
  if (!error || typeof error !== 'object') {
    return '';
  }
  const value = (error as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : '';
}
