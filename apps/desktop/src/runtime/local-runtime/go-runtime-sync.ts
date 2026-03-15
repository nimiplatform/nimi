import { getPlatformClient } from '../platform-client';
import { toProtoStruct } from '@nimiplatform/sdk/runtime';
import { emitRuntimeLog } from '../telemetry/logger';
import { adoptLocalRuntimeModel } from './commands';
import {
  findDesktopModel,
  findGoRuntimeModel,
  normalizeEngine,
  normalizeGoStatus,
  parseGoRuntimeModelEntry,
  parseGoStatus,
  statusPriority,
  syncLookupKey,
  toDesktopLocalModelRecord,
} from './go-runtime-sync-models';
import type {
  GoRuntimeBootstrapResult,
  GoRuntimeModelEntry,
  GoRuntimeSyncAction,
  GoRuntimeSyncResult,
  GoRuntimeSyncTarget,
} from './go-runtime-sync-types';
import type { LocalRuntimeModelRecord } from './types';

export type {
  GoRuntimeBootstrapResult,
  GoRuntimeModelEntry,
  GoRuntimeSyncAction,
  GoRuntimeSyncResult,
  GoRuntimeSyncTarget,
} from './go-runtime-sync-types';

type LocalClient = ReturnType<typeof getPlatformClient>['runtime']['local'];

export class GoRuntimeSyncError extends Error {
  action: GoRuntimeSyncAction;
  modelId: string;
  engine: string;
  localModelId?: string;

  constructor(input: {
    action: GoRuntimeSyncAction;
    modelId: string;
    engine?: string;
    localModelId?: string;
    message: string;
  }) {
    super(input.message);
    this.name = 'GoRuntimeSyncError';
    this.action = input.action;
    this.modelId = String(input.modelId || '').trim();
    this.engine = normalizeEngine(input.engine);
    this.localModelId = String(input.localModelId || '').trim() || undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function getSdkLocal(): LocalClient | null {
  try {
    const client = getPlatformClient();
    return client.runtime.local;
  } catch {
    return null;
  }
}

function formatTarget(target: GoRuntimeSyncTarget): string {
  const engine = normalizeEngine(target.engine);
  const modelId = String(target.modelId || '').trim();
  const localModelId = String(target.localModelId || '').trim();
  return localModelId
    ? `${engine}/${modelId || '-'} (${localModelId})`
    : `${engine}/${modelId || '-'}`;
}

function createSyncError(input: {
  action: GoRuntimeSyncAction;
  target: GoRuntimeSyncTarget;
  message: string;
}): GoRuntimeSyncError {
  return new GoRuntimeSyncError({
    action: input.action,
    modelId: input.target.modelId,
    engine: input.target.engine,
    localModelId: input.target.localModelId,
    message: `go runtime ${input.action} failed for ${formatTarget(input.target)}: ${input.message}`,
  });
}

function requireSdkLocal(action: GoRuntimeSyncAction, target: GoRuntimeSyncTarget): LocalClient {
  const runtime = getSdkLocal();
  if (!runtime) {
    throw createSyncError({
      action,
      target,
      message: 'runtime.local sdk client unavailable',
    });
  }
  return runtime;
}


export async function listGoRuntimeModelsSnapshot(): Promise<GoRuntimeModelEntry[]> {
  const runtime = getSdkLocal();
  if (!runtime) {
    return [];
  }
  const response = await runtime.listLocalModels({
    statusFilter: 0,
    engineFilter: '',
    categoryFilter: '',
    pageSize: 0,
    pageToken: '',
  });
  const raw = asRecord(response);
  const models = Array.isArray(raw.models) ? raw.models : [];
  return models.map((model) => parseGoRuntimeModelEntry(model));
}

async function resolveExistingGoRuntimeModel(
  runtime: LocalClient,
  action: GoRuntimeSyncAction,
  target: GoRuntimeSyncTarget,
): Promise<{ model: GoRuntimeModelEntry; matchedBy: GoRuntimeSyncResult['matchedBy'] }> {
  const models = await listGoRuntimeModelsSnapshot();
  const resolved = findGoRuntimeModel(models, target);
  if (!resolved.model || !resolved.matchedBy) {
    throw createSyncError({
      action,
      target,
      message: 'model not found in go runtime registry',
    });
  }
  return {
    model: resolved.model,
    matchedBy: resolved.matchedBy,
  };
}

function toSyncResult(
  action: GoRuntimeSyncAction,
  matchedBy: GoRuntimeSyncResult['matchedBy'],
  model: GoRuntimeModelEntry,
): GoRuntimeSyncResult {
  return {
    action,
    modelId: model.modelId,
    engine: model.engine,
    localModelId: model.localModelId,
    status: model.status,
    matchedBy,
  };
}

export async function syncModelInstallToGoRuntime(model: LocalRuntimeModelRecord): Promise<GoRuntimeSyncResult> {
  const target: GoRuntimeSyncTarget = {
    modelId: model.modelId,
    engine: model.engine,
    localModelId: model.localModelId,
  };
  const runtime = requireSdkLocal('install', target);

  try {
    const response = await runtime.installLocalModel({
      modelId: model.modelId,
      repo: model.source?.repo || '',
      revision: model.source?.revision || '',
      capabilities: model.capabilities || [],
      engine: model.engine || '',
      entry: model.entry || '',
      files: [],
      license: model.license || '',
      hashes: model.hashes || {},
      endpoint: model.endpoint || '',
      engineConfig: toProtoStruct(model.engineConfig),
    });
    const created = parseGoRuntimeModelEntry(asRecord(response).model);
    if (!created.localModelId || !created.modelId) {
      throw createSyncError({
        action: 'install',
        target,
        message: 'installLocalModel returned empty model payload',
      });
    }
    return toSyncResult('install', 'install', created);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error || '');
    const alreadyExists = message.includes('ALREADY') || message.includes('already') || message.includes('6');
    if (!alreadyExists) {
      throw createSyncError({
        action: 'install',
        target,
        message,
      });
    }
  }

  const existing = await resolveExistingGoRuntimeModel(runtime, 'install', target);
  return toSyncResult('install', existing.matchedBy, existing.model);
}

async function syncLifecycleAction(
  action: Exclude<GoRuntimeSyncAction, 'install' | 'reconcile'>,
  target: GoRuntimeSyncTarget,
): Promise<GoRuntimeSyncResult> {
  const runtime = requireSdkLocal(action, target);
  const existing = await resolveExistingGoRuntimeModel(runtime, action, target);

  if (action === 'start') {
    await runtime.startLocalModel({ localModelId: existing.model.localModelId });
  } else if (action === 'stop') {
    await runtime.stopLocalModel({ localModelId: existing.model.localModelId });
  } else {
    await runtime.removeLocalModel({ localModelId: existing.model.localModelId });
  }

  const latest = await resolveExistingGoRuntimeModel(runtime, action, {
    modelId: existing.model.modelId,
    engine: existing.model.engine,
    localModelId: existing.model.localModelId,
  }).catch(() => ({
    model: {
      ...existing.model,
      status: action === 'remove' ? 'removed' as const : existing.model.status,
    },
    matchedBy: existing.matchedBy,
  }));

  return toSyncResult(action, latest.matchedBy, latest.model);
}

export async function syncModelStartToGoRuntime(target: GoRuntimeSyncTarget): Promise<GoRuntimeSyncResult> {
  return syncLifecycleAction('start', target);
}

export async function syncModelStopToGoRuntime(target: GoRuntimeSyncTarget): Promise<GoRuntimeSyncResult> {
  return syncLifecycleAction('stop', target);
}

export async function syncModelRemoveToGoRuntime(target: GoRuntimeSyncTarget): Promise<GoRuntimeSyncResult> {
  return syncLifecycleAction('remove', target);
}

export async function reconcileModelsToGoRuntime(models: LocalRuntimeModelRecord[]): Promise<GoRuntimeSyncResult[]> {
  requireSdkLocal('reconcile', {
    modelId: 'local-models',
    engine: 'localai',
  });
  const results: GoRuntimeSyncResult[] = [];
  const errors: string[] = [];
  let goModels = await listGoRuntimeModelsSnapshot();

  for (const model of models) {
    const target: GoRuntimeSyncTarget = {
      modelId: model.modelId,
      engine: model.engine,
      localModelId: model.localModelId,
    };

    try {
      let existing = findGoRuntimeModel(goModels, target);
      if (!existing.model && model.status !== 'removed') {
        const installed = await syncModelInstallToGoRuntime(model);
        results.push({ ...installed, action: 'reconcile' });
        goModels = await listGoRuntimeModelsSnapshot();
        existing = findGoRuntimeModel(goModels, target);
      }

      if (model.status === 'removed') {
        if (existing.model) {
          const removed = await syncLifecycleAction('remove', target);
          results.push({ ...removed, action: 'reconcile' });
          goModels = goModels.filter((item) => item.localModelId !== removed.localModelId);
        }
        continue;
      }

      if (!existing.model) {
        throw createSyncError({
          action: 'reconcile',
          target,
          message: 'model still missing after install reconciliation',
        });
      }

      if (model.status === 'active' || model.status === 'unhealthy') {
        if (existing.model.status !== 'active' && existing.model.status !== 'unhealthy') {
          const started = await syncLifecycleAction('start', target);
          results.push({ ...started, action: 'reconcile' });
          goModels = await listGoRuntimeModelsSnapshot();
        }
        continue;
      }

      if (existing.model.status === 'active' || existing.model.status === 'unhealthy') {
        const stopped = await syncLifecycleAction('stop', target);
        results.push({ ...stopped, action: 'reconcile' });
        goModels = await listGoRuntimeModelsSnapshot();
      }
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error || 'unknown error'));
    }
  }

  if (errors.length > 0) {
    throw createSyncError({
      action: 'reconcile',
      target: {
        modelId: 'local-models',
        engine: 'localai',
      },
      message: errors.join('; '),
    });
  }

  return results;
}

export async function reconcileDesktopAndGoRuntimeModels(
  desktopModels: LocalRuntimeModelRecord[],
): Promise<GoRuntimeBootstrapResult> {
  const sanitizedDesktopModels = Array.isArray(desktopModels) ? desktopModels : [];
  let reconciled: GoRuntimeSyncResult[] = [];
  try {
    if (sanitizedDesktopModels.length > 0) {
      reconciled = await reconcileModelsToGoRuntime(sanitizedDesktopModels);
    }
  } catch (error: unknown) {
    emitRuntimeLog({
      level: 'warn',
      area: 'local-ai-runtime-sync',
      message: 'phase:go-runtime-reconcile:partial-failure',
      details: {
        error: error instanceof Error ? error.message : String(error || ''),
      },
    });
  }

  const goRuntimeModels = await listGoRuntimeModelsSnapshot();
  const adopted: LocalRuntimeModelRecord[] = [];
  const desktopState = [...sanitizedDesktopModels];

  for (const goModel of goRuntimeModels) {
    if (
      !goModel.localModelId
      || !goModel.modelId
      || !goModel.engine
      || !goModel.entry
      || goModel.status === 'removed'
    ) {
      if (goModel.localModelId || goModel.modelId) {
        emitRuntimeLog({
          level: 'warn',
          area: 'local-ai-runtime-sync',
          message: 'phase:go-runtime-adopt:skipped-incomplete-record',
          details: {
            localModelId: goModel.localModelId,
            modelId: goModel.modelId,
            engine: goModel.engine,
            entry: goModel.entry,
            status: goModel.status,
          },
        });
      }
      continue;
    }
    if (findDesktopModel(desktopState, {
      localModelId: goModel.localModelId,
      modelId: goModel.modelId,
        engine: goModel.engine,
    })) {
      continue;
    }
    try {
      const adoptedModel = await adoptLocalRuntimeModel(toDesktopLocalModelRecord(goModel), { caller: 'core' });
      adopted.push(adoptedModel);
      desktopState.push(adoptedModel);
    } catch (error: unknown) {
      emitRuntimeLog({
        level: 'warn',
        area: 'local-ai-runtime-sync',
        message: 'phase:go-runtime-adopt:failed',
        details: {
          localModelId: goModel.localModelId,
          modelId: goModel.modelId,
          engine: goModel.engine,
          error: error instanceof Error ? error.message : String(error || ''),
        },
      });
    }
  }

  return {
    reconciled,
    adopted,
  };
}

export const __internal = {
  findGoRuntimeModel,
  findDesktopModel,
  normalizeEngine,
  normalizeGoStatus,
  parseGoRuntimeModelEntry,
  parseGoStatus,
  syncLookupKey,
  statusPriority,
  toDesktopLocalModelRecord,
};
