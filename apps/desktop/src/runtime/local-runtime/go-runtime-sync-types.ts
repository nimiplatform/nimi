import type { LocalRuntimeModelRecord, LocalRuntimeModelStatus } from './types';

export type GoRuntimeModelEntry = {
  localModelId: string;
  modelId: string;
  engine: string;
  status: LocalRuntimeModelStatus;
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
  status: LocalRuntimeModelStatus;
  matchedBy: 'install' | 'localModelId' | 'modelId+engine';
};

export type GoRuntimeBootstrapResult = {
  reconciled: GoRuntimeSyncResult[];
  adopted: LocalRuntimeModelRecord[];
};
