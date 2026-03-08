import type { HookSourceType } from './shared';

export type HookActionExecutionMode = 'full' | 'guarded' | 'opaque';
export type HookActionRiskLevel = 'low' | 'medium' | 'high';
export type HookActionPrincipalType = 'human' | 'nimi-agent' | 'external-agent' | 'device' | 'service';
export type HookActionPrincipalMode = 'delegated' | 'autonomous';
export type HookActionOperation = 'read' | 'write';
export type HookActionSocialPrecondition = 'none' | 'human-agent-active';

export type HookActionAuditEventMap = {
  discovered?: string;
  dryRun?: string;
  verified?: string;
  committed?: string;
  failed?: string;
};

export type HookActionCompensation = {
  actionId: string;
  strategy: 'saga' | 'manual';
  notes?: string;
};

export type HookActionDescriptor = {
  actionId: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  operation: HookActionOperation;
  riskLevel: HookActionRiskLevel;
  executionMode: HookActionExecutionMode;
  idempotent: boolean;
  supportsDryRun: boolean;
  verifyPolicy?: 'required' | 'optional' | 'none';
  idempotencyPolicy?: 'required-for-write';
  compensationPolicy?: 'required-for-cross-domain-write' | 'optional';
  auditPolicy?: 'always-persist';
  socialPrecondition?: HookActionSocialPrecondition;
  auditEventMap?: HookActionAuditEventMap;
  compensation?: HookActionCompensation;
  description?: string;
};

export type HookActionDescriptorView = HookActionDescriptor & {
  modId: string;
  sourceType: HookSourceType;
  requiredCapabilities: string[];
};

export type HookActionRequestContext = {
  principalId: string;
  principalType: HookActionPrincipalType;
  subjectAccountId: string;
  mode: HookActionPrincipalMode;
  issuer?: string;
  authTokenId?: string;
  bridgeExecutionId?: string;
  delegationChain?: string[];
  traceId: string;
  userAccountId?: string;
  externalAccountId?: string;
};

export type HookActionResult = {
  ok: boolean;
  reasonCode: string;
  actionHint: string;
  executionId: string;
  traceId: string;
  auditId?: string;
  output?: Record<string, unknown>;
  executionMode: HookActionExecutionMode;
  warnings?: string[];
};

export type HookActionDryRunRequest = {
  actionId: string;
  input: Record<string, unknown>;
  context: HookActionRequestContext;
  idempotencyKey?: string;
};

export type HookActionVerifyRequest = HookActionDryRunRequest & {
  ttlSeconds?: number;
  nonce?: string;
};

export type HookActionCommitRequest = HookActionDryRunRequest & {
  verifyTicket?: string;
};

export type HookActionVerifyResult = HookActionResult & {
  verifyTicket: string;
  expiresAt: string;
  constraints?: Record<string, unknown>;
};

export type HookActionCommitResult = HookActionResult;

export type HookActionDiscoverFilter = {
  modId?: string;
  executionMode?: HookActionExecutionMode;
  includeOpaque?: boolean;
};

export type HookActionAuditFilter = {
  actionId?: string;
  modId?: string;
  principalId?: string;
  traceId?: string;
  reasonCode?: string;
  limit?: number;
};

export type HookActionAuditRecord = {
  auditId: string;
  actionId: string;
  modId: string;
  executionMode: HookActionExecutionMode;
  principalId: string;
  subjectAccountId: string;
  traceId: string;
  reasonCode: string;
  actionHint: string;
  outcome: 'allow' | 'deny' | 'error';
  occurredAt: string;
  payload?: Record<string, unknown>;
};

export type RuntimeHookActionFacade = {
  registerActionV1: (input: {
    modId: string;
    sourceType?: HookSourceType;
    descriptor: HookActionDescriptor;
    requiredCapabilities?: string[];
    handler: (input: {
      dryRun: boolean;
      actionId: string;
      modId: string;
      sourceType: HookSourceType;
      input: Record<string, unknown>;
      context: HookActionRequestContext;
      idempotencyKey?: string;
    }) => Promise<{
      ok: boolean;
      reasonCode?: string;
      actionHint?: string;
      output?: Record<string, unknown>;
      warnings?: string[];
    }> | {
      ok: boolean;
      reasonCode?: string;
      actionHint?: string;
      output?: Record<string, unknown>;
      warnings?: string[];
    };
  }) => HookActionDescriptorView;
  unregisterAction: (input: { modId: string; actionId: string }) => boolean;
  discoverActions: (filter?: HookActionDiscoverFilter) => HookActionDescriptorView[];
  dryRunAction: (input: HookActionDryRunRequest) => Promise<HookActionResult>;
  verifyAction: (input: HookActionVerifyRequest) => Promise<HookActionVerifyResult>;
  commitAction: (input: HookActionCommitRequest) => Promise<HookActionCommitResult>;
  queryActionAudit: (filter?: HookActionAuditFilter) => Promise<HookActionAuditRecord[]>;
};

export type HookActionClient = {
  register: (input: {
    descriptor: HookActionDescriptor;
    requiredCapabilities?: string[];
    handler: (input: {
      dryRun: boolean;
      actionId: string;
      modId: string;
      sourceType: HookSourceType;
      input: Record<string, unknown>;
      context: HookActionRequestContext;
      idempotencyKey?: string;
    }) => Promise<{
      ok: boolean;
      reasonCode?: string;
      actionHint?: string;
      output?: Record<string, unknown>;
      warnings?: string[];
    }> | {
      ok: boolean;
      reasonCode?: string;
      actionHint?: string;
      output?: Record<string, unknown>;
      warnings?: string[];
    };
  }) => HookActionDescriptorView;
  unregister: (input: { actionId: string }) => boolean;
  discover: (filter?: Omit<HookActionDiscoverFilter, 'modId'>) => HookActionDescriptorView[];
  dryRun: (input: Omit<HookActionDryRunRequest, 'context'> & { context: HookActionRequestContext }) => Promise<HookActionResult>;
  verify: (input: Omit<HookActionVerifyRequest, 'context'> & { context: HookActionRequestContext }) => Promise<HookActionVerifyResult>;
  commit: (input: Omit<HookActionCommitRequest, 'context'> & { context: HookActionRequestContext }) => Promise<HookActionCommitResult>;
  queryAudit: (filter?: Omit<HookActionAuditFilter, 'modId'>) => Promise<HookActionAuditRecord[]>;
};
