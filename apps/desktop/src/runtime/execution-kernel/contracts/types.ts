export type AccessMode = 'local-dev' | 'sideload';

export type KernelStage =
  | 'discovery'
  | 'manifest/compat'
  | 'signature/auth'
  | 'dependency/build'
  | 'sandbox/policy'
  | 'load'
  | 'lifecycle'
  | 'audit';

export type LifecycleState =
  | 'DISCOVERED'
  | 'VERIFIED'
  | 'INSTALLED'
  | 'ENABLED'
  | 'DISABLED'
  | 'UNINSTALLED'
  | 'UPDATING'
  | 'ROLLBACK_DISABLED';

export type DecisionResult = 'ALLOW' | 'ALLOW_WITH_WARNING' | 'DENY';

export interface DecisionRecord {
  decisionId: string;
  modId: string;
  version: string;
  stage: KernelStage;
  result: DecisionResult;
  reasonCodes: string[];
  createdAt: string;
}

export interface ModManifest {
  id: string;
  version: string;
  capabilities: string[];
  dependencies: string[];
  entry: string;
  hash?: string;
  icon?: string;
  iconAsset?: string;
  nimi?: {
    minVersion?: string;
    maxVersion?: string;
  };
}

export interface DiscoverInput {
  modId: string;
  version: string;
  mode: AccessMode;
  source?: {
    sourceType: 'local' | 'remote';
    ref: string;
  };
  requestId?: string;
}

export interface InstallInput extends DiscoverInput {
  actor: string;
  sourceType?: 'builtin' | 'injected' | 'sideload' | 'core' | 'codegen';
  requestedCapabilities?: string[];
  /** Optional supply-chain fields for signed packages */
  signerId?: string;
  signature?: string;
  digest?: string;
  /** Grant reference for protected capability validation */
  grantRef?: { grantId: string; token: string };
}

export interface UpdateInput extends InstallInput {
  targetVersion: string;
}

export interface LifecycleInput {
  modId: string;
  version: string;
  actor: string;
}

export interface ExecuteLocalTurnInput {
  requestId: string;
  sessionId: string;
  turnIndex: number;
  mode: 'STORY' | 'SCENE_TURN' | string;
  userInputText: string;
  provider: string;
  worldId?: string;
  agentId?: string;
  localProviderEndpoint?: string;
  localProviderModel?: string;
  localOpenAiEndpoint?: string;
  connectorId?: string;
}

export interface LocalAuditRecord {
  id: string;
  modId?: string;
  stage?: KernelStage;
  eventType: string;
  decision?: DecisionResult;
  reasonCodes?: string[];
  payload?: Record<string, unknown>;
  occurredAt: string;
}
