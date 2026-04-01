import type { DesktopHookRuntimeService } from '@runtime/hook';
import { localRuntime } from '@runtime/local-runtime';
import { getOfflineCoordinator } from '@runtime/offline';
import { ReasonCode } from '@nimiplatform/sdk/types';

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
      const models = await localRuntime.listAssets();
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
      const models = await localRuntime.health(localModelId);
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
      const model = await localRuntime.start(localModelId, { caller: 'core' });
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
      const model = await localRuntime.stop(localModelId, { caller: 'core' });
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
      const model = await localRuntime.remove(localModelId, { caller: 'core' });
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
      const installed = await localRuntime.install({
        modelId,
        kind: 'chat',
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
        output: { localModelId: installed.localAssetId, modelId: installed.assetId },
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
      const model = await localRuntime.importAsset({
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

export function registerExternalAgentTier1Actions(hookRuntime: DesktopHookRuntimeService): void {
  registerCoreActions(hookRuntime);
}
