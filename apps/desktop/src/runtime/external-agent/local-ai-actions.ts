import { ReasonCode } from '@nimiplatform/sdk/types';
import type { ReasonCodeValue } from '@nimiplatform/sdk/types';
import { localRuntime } from '@runtime/local-runtime';
import { getOfflineCoordinator } from '@runtime/offline';

export type LocalAIActionName =
  | 'runtime.local-ai.models.list'
  | 'runtime.local-ai.models.health'
  | 'runtime.local-ai.models.start'
  | 'runtime.local-ai.models.stop'
  | 'runtime.local-ai.models.remove'
  | 'runtime.local-ai.models.install'
  | 'runtime.local-ai.models.import';

export type LocalAIActionDescriptor = {
  name: LocalAIActionName;
  params: Record<string, unknown>;
  operation: 'read' | 'write';
  riskLevel: 'low' | 'medium' | 'high';
  supportsDryRun: boolean;
  idempotent: boolean;
  requiredCapabilities: string[];
  description: string;
};

export type LocalAIActionResult = {
  ok: boolean;
  reasonCode: ReasonCodeValue;
  actionHint: string;
  output?: Record<string, unknown>;
};

export function localAIActionCapabilities(
  actionId: LocalAIActionName,
  options: { supportsDryRun: boolean },
): string[] {
  return [
    `action.discover.${actionId}`,
    ...(options.supportsDryRun ? [`action.dry-run.${actionId}`] : []),
    `action.verify.${actionId}`,
    `action.commit.${actionId}`,
  ];
}

export const localAIActionDescriptors: LocalAIActionDescriptor[] = [
  {
    name: 'runtime.local-ai.models.list',
    params: {},
    operation: 'read',
    riskLevel: 'low',
    supportsDryRun: true,
    idempotent: false,
    requiredCapabilities: localAIActionCapabilities('runtime.local-ai.models.list', { supportsDryRun: true }),
    description: 'List local runtime models',
  },
  {
    name: 'runtime.local-ai.models.health',
    params: { localModelId: 'string?' },
    operation: 'read',
    riskLevel: 'low',
    supportsDryRun: true,
    idempotent: false,
    requiredCapabilities: localAIActionCapabilities('runtime.local-ai.models.health', { supportsDryRun: true }),
    description: 'Query local runtime model health',
  },
  {
    name: 'runtime.local-ai.models.start',
    params: { localModelId: 'string' },
    operation: 'write',
    riskLevel: 'medium',
    supportsDryRun: false,
    idempotent: true,
    requiredCapabilities: localAIActionCapabilities('runtime.local-ai.models.start', { supportsDryRun: false }),
    description: 'Start a local runtime model',
  },
  {
    name: 'runtime.local-ai.models.stop',
    params: { localModelId: 'string' },
    operation: 'write',
    riskLevel: 'medium',
    supportsDryRun: false,
    idempotent: true,
    requiredCapabilities: localAIActionCapabilities('runtime.local-ai.models.stop', { supportsDryRun: false }),
    description: 'Stop a local runtime model',
  },
  {
    name: 'runtime.local-ai.models.remove',
    params: { localModelId: 'string' },
    operation: 'write',
    riskLevel: 'medium',
    supportsDryRun: false,
    idempotent: true,
    requiredCapabilities: localAIActionCapabilities('runtime.local-ai.models.remove', { supportsDryRun: false }),
    description: 'Remove a local runtime model',
  },
  {
    name: 'runtime.local-ai.models.install',
    params: { modelId: 'string', repo: 'string' },
    operation: 'write',
    riskLevel: 'medium',
    supportsDryRun: false,
    idempotent: true,
    requiredCapabilities: localAIActionCapabilities('runtime.local-ai.models.install', { supportsDryRun: false }),
    description: 'Install model from Hugging Face',
  },
  {
    name: 'runtime.local-ai.models.import',
    params: { manifestPath: 'string' },
    operation: 'write',
    riskLevel: 'medium',
    supportsDryRun: false,
    idempotent: true,
    requiredCapabilities: localAIActionCapabilities('runtime.local-ai.models.import', { supportsDryRun: false }),
    description: 'Import local model manifest',
  },
];

function runtimeWriteUnavailableResult(): LocalAIActionResult {
  return {
    ok: false,
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    actionHint: 'retry-runtime-when-online',
  };
}

function invalidInput(actionHint: string): LocalAIActionResult {
  return {
    ok: false,
    reasonCode: ReasonCode.ACTION_INPUT_INVALID,
    actionHint,
  };
}

function requireWriteRuntime(): LocalAIActionResult | null {
  return getOfflineCoordinator().getTier() === 'L2'
    ? runtimeWriteUnavailableResult()
    : null;
}

export async function dispatchLocalAIAction(
  name: LocalAIActionName,
  params: Record<string, unknown>,
): Promise<LocalAIActionResult> {
  if (name === 'runtime.local-ai.models.list') {
    const models = await localRuntime.listAssets();
    return {
      ok: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
      actionHint: 'none',
      output: { models },
    };
  }

  if (name === 'runtime.local-ai.models.health') {
    const localModelId = String(params.localModelId || '').trim() || undefined;
    const models = await localRuntime.health(localModelId);
    return {
      ok: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
      actionHint: 'none',
      output: { models },
    };
  }

  const unavailable = requireWriteRuntime();
  if (unavailable) {
    return unavailable;
  }

  if (name === 'runtime.local-ai.models.start') {
    const localModelId = String(params.localModelId || '').trim();
    if (!localModelId) {
      return invalidInput('provide-local-model-id');
    }
    const model = await localRuntime.start(localModelId, { caller: 'core' });
    return {
      ok: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
      actionHint: 'none',
      output: { model },
    };
  }

  if (name === 'runtime.local-ai.models.stop') {
    const localModelId = String(params.localModelId || '').trim();
    if (!localModelId) {
      return invalidInput('provide-local-model-id');
    }
    const model = await localRuntime.stop(localModelId, { caller: 'core' });
    return {
      ok: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
      actionHint: 'none',
      output: { model },
    };
  }

  if (name === 'runtime.local-ai.models.remove') {
    const localModelId = String(params.localModelId || '').trim();
    if (!localModelId) {
      return invalidInput('provide-local-model-id');
    }
    const accepted = await localRuntime.remove(localModelId, { caller: 'core' });
    return {
      ok: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
      actionHint: 'none',
      output: { accepted },
    };
  }

  if (name === 'runtime.local-ai.models.install') {
    const modelId = String(params.modelId || '').trim();
    const repo = String(params.repo || '').trim();
    if (!modelId || !repo) {
      return invalidInput('provide-model-and-repo');
    }
    const accepted = await localRuntime.install({
      modelId,
      kind: 'chat',
      repo,
      revision: String(params.revision || '').trim() || undefined,
      capabilities: Array.isArray(params.capabilities)
        ? params.capabilities.map((item) => String(item || '').trim()).filter(Boolean)
        : undefined,
      engine: String(params.engine || '').trim() || undefined,
      entry: String(params.entry || '').trim() || undefined,
      license: String(params.license || '').trim() || undefined,
    }, { caller: 'core' });
    return {
      ok: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
      actionHint: 'none',
      output: { localModelId: accepted.localModelId, modelId: accepted.modelId },
    };
  }

  if (name === 'runtime.local-ai.models.import') {
    const manifestPath = String(params.manifestPath || '').trim();
    if (!manifestPath) {
      return invalidInput('provide-manifest-path');
    }
    const model = await localRuntime.importAsset({ manifestPath }, { caller: 'core' });
    return {
      ok: true,
      reasonCode: ReasonCode.ACTION_EXECUTED,
      actionHint: 'none',
      output: { model },
    };
  }

  return invalidInput('provide-supported-local-ai-action');
}
