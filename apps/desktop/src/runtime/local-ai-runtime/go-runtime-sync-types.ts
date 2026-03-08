import type { LocalAiModelRecord, LocalAiModelStatus } from './types';

export type GoRuntimeModelEntry = {
  localModelId: string;
  modelId: string;
  engine: string;
  status: LocalAiModelStatus;
  statusRaw?: string;
  endpoint: string;
  capabilities: string[];
  entry: string;
  license: string;
  source: {
    repo: string;
    revision: string;
  };
  hashes: Record<string, string>;
  installedAt: string;
  updatedAt: string;
  healthDetail?: string;
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

export type GoRuntimeBootstrapResult = {
  reconciled: GoRuntimeSyncResult[];
  adopted: LocalAiModelRecord[];
};
