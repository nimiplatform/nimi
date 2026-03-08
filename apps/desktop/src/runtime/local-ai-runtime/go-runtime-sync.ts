import { getPlatformClient } from '../platform-client';
import { toProtoStruct } from '@nimiplatform/sdk/runtime';
import type { LocalAiModelRecord, LocalAiModelStatus } from './types';

type LocalRuntimeClient = ReturnType<typeof getPlatformClient>['runtime']['localRuntime'];

export type GoRuntimeModelEntry = {
  localModelId: string;
  modelId: string;
  engine: string;
  status: LocalAiModelStatus;
  endpoint: string;
  capabilities: string[];
  engineConfig?: Record<string, unknown>;
};

export type GoRuntimeSyncTarget = {
  modelId: string;
  engine?: string;
  localModelId?: string;
};

export type GoRuntimeSyncAction = 'install' | 'start' | 'stop' | 'remove' | 'reconcile';

export type GoRuntimeSyncResult = {
  action: GoRuntimeSyncAction;
  modelId: string;
  engine: string;
  localModelId: string;
  status: LocalAiModelStatus;
  matchedBy: 'install' | 'localModelId' | 'modelId+engine';
};

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

const GO_STATUS_INSTALLED = 1;
const GO_STATUS_ACTIVE = 2;
const GO_STATUS_UNHEALTHY = 3;
const GO_STATUS_REMOVED = 4;

function normalizeEngine(value: unknown): string {
  return String(value || '').trim().toLowerCase() || 'localai';
}

function normalizeGoStatus(value: unknown): LocalAiModelStatus {
  const numeric = Number(value);
  if (numeric === GO_STATUS_ACTIVE) return 'active';
  if (numeric === GO_STATUS_UNHEALTHY) return 'unhealthy';
  if (numeric === GO_STATUS_REMOVED) return 'removed';
  return 'installed';
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function getSdkLocalRuntime(): LocalRuntimeClient | null {
  try {
    const client = getPlatformClient();
    return client.runtime.localRuntime;
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

function requireSdkLocalRuntime(action: GoRuntimeSyncAction, target: GoRuntimeSyncTarget): LocalRuntimeClient {
  const runtime = getSdkLocalRuntime();
  if (!runtime) {
    throw createSyncError({
      action,
      target,
      message: 'runtime.localRuntime sdk client unavailable',
    });
  }
  return runtime;
}

function parseGoRuntimeModelEntry(value: unknown): GoRuntimeModelEntry {
  const record = asRecord(value);
  return {
    localModelId: String(record.localModelId || '').trim(),
    modelId: String(record.modelId || '').trim(),
    engine: normalizeEngine(record.engine),
    status: normalizeGoStatus(record.status),
    endpoint: String(record.endpoint || '').trim(),
    capabilities: normalizeStringArray(record.capabilities),
    engineConfig: asRecord(record.engineConfig),
  };
}

function syncLookupKey(modelId: string, engine: string): string {
  return `${normalizeEngine(engine)}::${String(modelId || '').trim().toLowerCase()}`;
}

export function findGoRuntimeModel(
  models: GoRuntimeModelEntry[],
  target: GoRuntimeSyncTarget,
): { model: GoRuntimeModelEntry | null; matchedBy?: GoRuntimeSyncResult['matchedBy'] } {
  const localModelId = String(target.localModelId || '').trim();
  if (localModelId) {
    const direct = models.find((model) => model.localModelId === localModelId) || null;
    if (direct) {
      return { model: direct, matchedBy: 'localModelId' };
    }
  }

  const modelId = String(target.modelId || '').trim();
  if (!modelId) {
    return { model: null };
  }

  const engine = normalizeEngine(target.engine);
  const matched = models
    .filter((model) => syncLookupKey(model.modelId, model.engine) === syncLookupKey(modelId, engine))
    .sort((left, right) => {
      const leftRemoved = left.status === 'removed' ? 1 : 0;
      const rightRemoved = right.status === 'removed' ? 1 : 0;
      if (leftRemoved !== rightRemoved) {
        return leftRemoved - rightRemoved;
      }
      return String(left.localModelId || '').localeCompare(String(right.localModelId || ''));
    })[0] || null;
  if (!matched || matched.status === 'removed') {
    return { model: null };
  }
  return matched
    ? { model: matched, matchedBy: 'modelId+engine' }
    : { model: null };
}

export async function listGoRuntimeModelsSnapshot(): Promise<GoRuntimeModelEntry[]> {
  const runtime = getSdkLocalRuntime();
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
  runtime: LocalRuntimeClient,
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

export async function syncModelInstallToGoRuntime(model: LocalAiModelRecord): Promise<GoRuntimeSyncResult> {
  const target: GoRuntimeSyncTarget = {
    modelId: model.modelId,
    engine: model.engine,
    localModelId: model.localModelId,
  };
  const runtime = requireSdkLocalRuntime('install', target);

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
  const runtime = requireSdkLocalRuntime(action, target);
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

export async function reconcileModelsToGoRuntime(models: LocalAiModelRecord[]): Promise<GoRuntimeSyncResult[]> {
  const runtime = requireSdkLocalRuntime('reconcile', {
    modelId: 'local-runtime-models',
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
        modelId: 'local-runtime-models',
        engine: 'localai',
      },
      message: errors.join('; '),
    });
  }

  return results;
}

export const __internal = {
  findGoRuntimeModel,
  normalizeEngine,
  normalizeGoStatus,
  parseGoRuntimeModelEntry,
  syncLookupKey,
};
