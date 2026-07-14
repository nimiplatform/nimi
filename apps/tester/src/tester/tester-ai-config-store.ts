import {
  createNimiAppAIScopeRef,
  type NimiAIConfig,
  type NimiAIProfile,
  type NimiAIScopeRef,
  type NimiAISnapshot,
} from '@nimiplatform/sdk/ai';
import { createNimiError, type NimiError } from '@nimiplatform/sdk/types';
import type { SharedAIConfigService } from '@nimiplatform/kit/features/model-config/headless';
import { appId } from '../shell/auth/app-identity.js';

export const TESTER_APP_LAB_AI_SURFACE_ID = 'app-lab';
export const TESTER_AI_CONFIG_UNAVAILABLE_REASON_CODE = 'TESTER_LOCAL_APP_AI_CONFIG_UNAVAILABLE';
export const TESTER_AI_CONFIG_UNAVAILABLE_ACTION_HINT = 'await_local_app_ai_config_operation_admission';

export type TesterAIProfileImportResult =
  | {
      ok: true;
      profile: NimiAIProfile;
      profileCount: number;
      message: string;
    }
  | {
      ok: false;
      errors: string[];
      message: string;
      reasonCode: typeof TESTER_AI_CONFIG_UNAVAILABLE_REASON_CODE;
      actionHint: typeof TESTER_AI_CONFIG_UNAVAILABLE_ACTION_HINT;
    };

export function createTesterAppLabAIScopeRef(): NimiAIScopeRef {
  return createNimiAppAIScopeRef(appId, TESTER_APP_LAB_AI_SURFACE_ID);
}

function aiConfigUnavailable(operation: string): NimiError {
  return createNimiError({
    message: 'AIConfig is not admitted by the 0K local-app carrier.',
    code: 'capability-unavailable',
    reasonCode: TESTER_AI_CONFIG_UNAVAILABLE_REASON_CODE,
    actionHint: TESTER_AI_CONFIG_UNAVAILABLE_ACTION_HINT,
    retryable: false,
    source: 'sdk',
    details: {
      operation,
      carrier: 'local-app-standard-shell-v1',
    },
  });
}

export function listTesterAIProfiles(): NimiAIProfile[] {
  throw aiConfigUnavailable('ai-profile.list');
}

export function importTesterAIProfileJson(_rawJson: string): TesterAIProfileImportResult {
  return {
    ok: false,
    errors: ['AIProfile import requires a future admitted AIConfig operation.'],
    message: 'AIProfile import is unavailable in this local-app build.',
    reasonCode: TESTER_AI_CONFIG_UNAVAILABLE_REASON_CODE,
    actionHint: TESTER_AI_CONFIG_UNAVAILABLE_ACTION_HINT,
  };
}

export async function requireTesterAIConfigAdmission(
  _scopeRef: NimiAIScopeRef = createTesterAppLabAIScopeRef(),
): Promise<never> {
  throw aiConfigUnavailable('ai-config.hydrate');
}

export function loadTesterAIConfig(
  _scopeRef: NimiAIScopeRef = createTesterAppLabAIScopeRef(),
): NimiAIConfig {
  throw aiConfigUnavailable('ai-config.get');
}

export async function saveTesterAIConfig(
  _next: NimiAIConfig,
  _scopeRef: NimiAIScopeRef = createTesterAppLabAIScopeRef(),
  _options?: { readonly expectedBaseVersion?: string },
): Promise<NimiAIConfig> {
  throw aiConfigUnavailable('ai-config.update');
}

export function recordTesterAISnapshot(_snapshot: NimiAISnapshot): NimiAISnapshot {
  throw aiConfigUnavailable('ai-snapshot.record');
}

export function getTesterAISnapshot(_executionId: string): NimiAISnapshot | null {
  throw aiConfigUnavailable('ai-snapshot.get');
}

export function getLatestTesterAISnapshot(
  _scopeRef: NimiAIScopeRef = createTesterAppLabAIScopeRef(),
): NimiAISnapshot | null {
  throw aiConfigUnavailable('ai-snapshot.latest');
}

export function createTesterAIConfigService(): SharedAIConfigService {
  return {
    aiConfig: {
      get() {
        throw aiConfigUnavailable('ai-config.get');
      },
      async update() {
        throw aiConfigUnavailable('ai-config.update');
      },
      subscribe() {
        throw aiConfigUnavailable('ai-config.subscribe');
      },
    },
    aiProfile: {
      async list() {
        throw aiConfigUnavailable('ai-profile.list');
      },
      async previewApply() {
        throw aiConfigUnavailable('ai-profile.preview-apply');
      },
      async apply() {
        throw aiConfigUnavailable('ai-profile.apply');
      },
    },
  };
}
