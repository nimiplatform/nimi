import type { DesktopHookRuntimeService } from '@runtime/hook';
import { localAiRuntime } from '@runtime/local-ai-runtime';
import { getOfflineCoordinator } from '@runtime/offline';
import { ReasonCode } from '@nimiplatform/sdk/types';

const LOCAL_CHAT_MOD_ID = 'world.nimi.local-chat';
const WORLD_STUDIO_MOD_ID = 'world.nimi.world-studio';

const LOCAL_CHAT_SESSIONS_LIST_CAPABILITY = ['data-api', 'local-chat', 'sessions', 'list'].join('.');
const LOCAL_CHAT_SESSIONS_UPSERT_CAPABILITY = ['data-api', 'local-chat', 'sessions', 'upsert'].join('.');
const WORLD_STUDIO_DRAFTS_LIST_CAPABILITY = ['data-api', 'world', 'drafts', 'list'].join('.');
const WORLD_STUDIO_DRAFT_UPDATE_CAPABILITY = ['data-api', 'world', 'draft', 'update'].join('.');

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string {
  return String(value || '').trim();
}

function runtimeWriteUnavailableResult() {
  return {
    ok: false,
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    actionHint: 'retry-runtime-when-online',
  };
}

function registerCoreActions(hookRuntime: DesktopHookRuntimeService): void {
  const actions = [
    'runtime.local-ai.models.list',
    'runtime.local-ai.models.health',
    'runtime.local-ai.models.start',
    'runtime.local-ai.models.stop',
    'runtime.local-ai.models.remove',
    'runtime.local-ai.models.install',
    'runtime.local-ai.models.import',
  ];
  for (const actionId of actions) {
    hookRuntime.unregisterAction({ modId: 'core:runtime', actionId });
  }

  hookRuntime.registerActionV1({
    modId: 'core:runtime',
    sourceType: 'core',
    descriptor: {
      actionId: 'runtime.local-ai.models.list',
      inputSchema: {},
      outputSchema: { type: 'object' },
      operation: 'read',
      riskLevel: 'low',
      executionMode: 'full',
      idempotent: false,
      supportsDryRun: true,
      description: 'List local runtime models',
    },
    requiredCapabilities: ['action.commit.runtime.local-ai.models.list'],
    handler: async () => {
      const models = await localAiRuntime.list();
      return {
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        actionHint: 'none',
        output: { models },
      };
    },
  });

  hookRuntime.registerActionV1({
    modId: 'core:runtime',
    sourceType: 'core',
    descriptor: {
      actionId: 'runtime.local-ai.models.health',
      inputSchema: {
        type: 'object',
        properties: {
          localModelId: { type: 'string' },
        },
      },
      outputSchema: { type: 'object' },
      operation: 'read',
      riskLevel: 'low',
      executionMode: 'guarded',
      idempotent: false,
      supportsDryRun: true,
      description: 'Query local runtime model health',
    },
    requiredCapabilities: ['action.commit.runtime.local-ai.models.health'],
    handler: async (input) => {
      const localModelId = String(input.input.localModelId || '').trim() || undefined;
      const models = await localAiRuntime.health(localModelId);
      return {
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        actionHint: 'none',
        output: { models },
      };
    },
  });

  hookRuntime.registerActionV1({
    modId: 'core:runtime',
    sourceType: 'core',
    descriptor: {
      actionId: 'runtime.local-ai.models.start',
      inputSchema: { type: 'object', required: ['localModelId'] },
      outputSchema: { type: 'object' },
      operation: 'write',
      riskLevel: 'medium',
      executionMode: 'guarded',
      idempotent: true,
      supportsDryRun: false,
      description: 'Start a local runtime model',
    },
    requiredCapabilities: ['action.commit.runtime.local-ai.models.start'],
    handler: async (input) => {
      if (getOfflineCoordinator().getTier() === 'L2') {
        return runtimeWriteUnavailableResult();
      }
      const localModelId = String(input.input.localModelId || '').trim();
      if (!localModelId) {
        return {
          ok: false,
          reasonCode: ReasonCode.ACTION_INPUT_INVALID,
          actionHint: 'provide-local-model-id',
        };
      }
      const model = await localAiRuntime.start(localModelId, { caller: 'core' });
      return {
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        actionHint: 'none',
        output: { model },
      };
    },
  });

  hookRuntime.registerActionV1({
    modId: 'core:runtime',
    sourceType: 'core',
    descriptor: {
      actionId: 'runtime.local-ai.models.stop',
      inputSchema: { type: 'object', required: ['localModelId'] },
      outputSchema: { type: 'object' },
      operation: 'write',
      riskLevel: 'medium',
      executionMode: 'guarded',
      idempotent: true,
      supportsDryRun: false,
      description: 'Stop a local runtime model',
    },
    requiredCapabilities: ['action.commit.runtime.local-ai.models.stop'],
    handler: async (input) => {
      if (getOfflineCoordinator().getTier() === 'L2') {
        return runtimeWriteUnavailableResult();
      }
      const localModelId = String(input.input.localModelId || '').trim();
      if (!localModelId) {
        return {
          ok: false,
          reasonCode: ReasonCode.ACTION_INPUT_INVALID,
          actionHint: 'provide-local-model-id',
        };
      }
      const model = await localAiRuntime.stop(localModelId, { caller: 'core' });
      return {
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        actionHint: 'none',
        output: { model },
      };
    },
  });

  hookRuntime.registerActionV1({
    modId: 'core:runtime',
    sourceType: 'core',
    descriptor: {
      actionId: 'runtime.local-ai.models.remove',
      inputSchema: { type: 'object', required: ['localModelId'] },
      outputSchema: { type: 'object' },
      operation: 'write',
      riskLevel: 'medium',
      executionMode: 'guarded',
      idempotent: true,
      supportsDryRun: false,
      description: 'Remove a local runtime model',
    },
    requiredCapabilities: ['action.commit.runtime.local-ai.models.remove'],
    handler: async (input) => {
      if (getOfflineCoordinator().getTier() === 'L2') {
        return runtimeWriteUnavailableResult();
      }
      const localModelId = String(input.input.localModelId || '').trim();
      if (!localModelId) {
        return {
          ok: false,
          reasonCode: ReasonCode.ACTION_INPUT_INVALID,
          actionHint: 'provide-local-model-id',
        };
      }
      const model = await localAiRuntime.remove(localModelId, { caller: 'core' });
      return {
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        actionHint: 'none',
        output: { model },
      };
    },
  });

  hookRuntime.registerActionV1({
    modId: 'core:runtime',
    sourceType: 'core',
    descriptor: {
      actionId: 'runtime.local-ai.models.install',
      inputSchema: { type: 'object', required: ['modelId', 'repo'] },
      outputSchema: { type: 'object' },
      operation: 'write',
      riskLevel: 'medium',
      executionMode: 'guarded',
      idempotent: true,
      supportsDryRun: false,
      description: 'Install model from Hugging Face',
    },
    requiredCapabilities: ['action.commit.runtime.local-ai.models.install'],
    handler: async (input) => {
      if (getOfflineCoordinator().getTier() === 'L2') {
        return runtimeWriteUnavailableResult();
      }
      const modelId = String(input.input.modelId || '').trim();
      const repo = String(input.input.repo || '').trim();
      if (!modelId || !repo) {
        return {
          ok: false,
          reasonCode: ReasonCode.ACTION_INPUT_INVALID,
          actionHint: 'provide-model-and-repo',
        };
      }
      const accepted = await localAiRuntime.install({
        modelId,
        repo,
        revision: String(input.input.revision || '').trim() || undefined,
        capabilities: Array.isArray(input.input.capabilities)
          ? input.input.capabilities.map((item) => String(item || '').trim()).filter(Boolean)
          : undefined,
        engine: String(input.input.engine || '').trim() || undefined,
        entry: String(input.input.entry || '').trim() || undefined,
        license: String(input.input.license || '').trim() || undefined,
      }, { caller: 'core' });
      return {
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        actionHint: 'none',
        output: { installSessionId: accepted.installSessionId, modelId: accepted.modelId },
      };
    },
  });

  hookRuntime.registerActionV1({
    modId: 'core:runtime',
    sourceType: 'core',
    descriptor: {
      actionId: 'runtime.local-ai.models.import',
      inputSchema: { type: 'object', required: ['manifestPath'] },
      outputSchema: { type: 'object' },
      operation: 'write',
      riskLevel: 'medium',
      executionMode: 'guarded',
      idempotent: true,
      supportsDryRun: false,
      description: 'Import local model manifest',
    },
    requiredCapabilities: ['action.commit.runtime.local-ai.models.import'],
    handler: async (input) => {
      if (getOfflineCoordinator().getTier() === 'L2') {
        return runtimeWriteUnavailableResult();
      }
      const manifestPath = String(input.input.manifestPath || '').trim();
      if (!manifestPath) {
        return {
          ok: false,
          reasonCode: ReasonCode.ACTION_INPUT_INVALID,
          actionHint: 'provide-manifest-path',
        };
      }
      const model = await localAiRuntime.import({
        manifestPath,
      }, { caller: 'core' });
      return {
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        actionHint: 'none',
        output: { model },
      };
    },
  });
}

function registerModActions(hookRuntime: DesktopHookRuntimeService): void {
  const actionIds = [
    'mod.local-chat.sessions.list',
    'mod.local-chat.sessions.upsert',
    'mod.world-studio.drafts.list',
    'mod.world-studio.drafts.upsert',
  ];
  for (const actionId of actionIds) {
    hookRuntime.unregisterAction({ modId: LOCAL_CHAT_MOD_ID, actionId });
    hookRuntime.unregisterAction({ modId: WORLD_STUDIO_MOD_ID, actionId });
  }

  hookRuntime.registerActionV1({
    modId: LOCAL_CHAT_MOD_ID,
    sourceType: 'sideload',
    descriptor: {
      actionId: 'mod.local-chat.sessions.list',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      operation: 'read',
      riskLevel: 'low',
      executionMode: 'opaque',
      idempotent: false,
      supportsDryRun: false,
      description: 'List local-chat sessions',
    },
    requiredCapabilities: [`data.query.${LOCAL_CHAT_SESSIONS_LIST_CAPABILITY}`],
    handler: async (input) => {
      const targetId = readString(input.input.targetId);
      const sessions = await hookRuntime.queryData({
        modId: LOCAL_CHAT_MOD_ID,
        capability: LOCAL_CHAT_SESSIONS_LIST_CAPABILITY,
        query: targetId ? { targetId } : {},
      });
      return {
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        actionHint: 'none',
        output: {
          sessions: sessions as Record<string, unknown>,
        },
      };
    },
  });

  hookRuntime.registerActionV1({
    modId: LOCAL_CHAT_MOD_ID,
    sourceType: 'sideload',
    descriptor: {
      actionId: 'mod.local-chat.sessions.upsert',
      inputSchema: {
        type: 'object',
        properties: {
          session: { type: 'object' },
          targetId: { type: 'string' },
          worldId: { type: 'string' },
          title: { type: 'string' },
        },
      },
      outputSchema: { type: 'object' },
      operation: 'write',
      riskLevel: 'medium',
      executionMode: 'guarded',
      idempotent: true,
      supportsDryRun: false,
      description: 'Upsert local-chat session',
    },
    requiredCapabilities: [`data.query.${LOCAL_CHAT_SESSIONS_UPSERT_CAPABILITY}`],
    handler: async (input) => {
      if (getOfflineCoordinator().getTier() === 'L2') {
        return runtimeWriteUnavailableResult();
      }
      const payload = toRecord(input.input);
      const upserted = await hookRuntime.queryData({
        modId: LOCAL_CHAT_MOD_ID,
        capability: LOCAL_CHAT_SESSIONS_UPSERT_CAPABILITY,
        query: payload,
      });
      return {
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        actionHint: 'none',
        output: {
          session: upserted as Record<string, unknown>,
        },
      };
    },
  });

  hookRuntime.registerActionV1({
    modId: WORLD_STUDIO_MOD_ID,
    sourceType: 'sideload',
    descriptor: {
      actionId: 'mod.world-studio.drafts.list',
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      operation: 'read',
      riskLevel: 'low',
      executionMode: 'opaque',
      idempotent: false,
      supportsDryRun: false,
      description: 'List world-studio drafts',
    },
    requiredCapabilities: [`data.query.${WORLD_STUDIO_DRAFTS_LIST_CAPABILITY}`],
    handler: async () => {
      const drafts = await hookRuntime.queryData({
        modId: WORLD_STUDIO_MOD_ID,
        capability: WORLD_STUDIO_DRAFTS_LIST_CAPABILITY,
        query: {},
      });
      return {
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        actionHint: 'none',
        output: {
          drafts: drafts as Record<string, unknown>,
        },
      };
    },
  });

  hookRuntime.registerActionV1({
    modId: WORLD_STUDIO_MOD_ID,
    sourceType: 'sideload',
    descriptor: {
      actionId: 'mod.world-studio.drafts.upsert',
      inputSchema: {
        type: 'object',
        required: ['draftId', 'patch'],
        properties: {
          draftId: { type: 'string' },
          patch: { type: 'object' },
        },
      },
      outputSchema: { type: 'object' },
      operation: 'write',
      riskLevel: 'medium',
      executionMode: 'guarded',
      idempotent: true,
      supportsDryRun: true,
      description: 'Update world-studio draft',
    },
    requiredCapabilities: [`data.query.${WORLD_STUDIO_DRAFT_UPDATE_CAPABILITY}`],
    handler: async (input) => {
      if (getOfflineCoordinator().getTier() === 'L2') {
        return runtimeWriteUnavailableResult();
      }
      const draftId = readString(input.input.draftId);
      const patch = toRecord(input.input.patch);
      if (!draftId || Object.keys(patch).length <= 0) {
        return {
          ok: false,
          reasonCode: ReasonCode.ACTION_INPUT_INVALID,
          actionHint: 'provide-draft-update-input',
        };
      }
      if (input.dryRun) {
        return {
          ok: true,
          reasonCode: ReasonCode.ACTION_EXECUTED,
          actionHint: 'preflight-ok',
          output: { draftId, preflight: true },
        };
      }
      const updated = await hookRuntime.queryData({
        modId: WORLD_STUDIO_MOD_ID,
        capability: WORLD_STUDIO_DRAFT_UPDATE_CAPABILITY,
        query: { draftId, patch },
      });
      return {
        ok: true,
        reasonCode: ReasonCode.ACTION_EXECUTED,
        actionHint: 'none',
        output: {
          draft: updated as Record<string, unknown>,
        },
      };
    },
  });
}

export function registerExternalAgentTier1Actions(hookRuntime: DesktopHookRuntimeService): void {
  registerCoreActions(hookRuntime);
  registerModActions(hookRuntime);
}
