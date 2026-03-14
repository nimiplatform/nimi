export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RuntimeHttpContext = {
  realmBaseUrl: string;
  accessToken?: string;
  fetchImpl?: FetchImpl;
};

export type HookSourceType = 'builtin' | 'injected' | 'sideload' | 'core' | 'codegen';
export type TurnHookPoint = 'pre-policy' | 'pre-model' | 'post-state' | 'pre-commit';
export type HookType = 'event-bus' | 'data-api' | 'storage' | 'ui-extension' | 'turn-hook' | 'inter-mod' | 'runtime' | 'action';

export type HookRegistrationRecord = {
  registrationId: string;
  modId: string;
  hookType: HookType;
  target: string;
  capabilityKey: string;
  contractId: string;
  version: string;
  sourceType: HookSourceType;
  requestedCapabilities: string[];
  status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  statusReason?: string;
  createdAt: string;
};

export type HookAuditRecord = {
  callId: string;
  modId: string;
  hookType: HookType;
  target: string;
  decision: 'ALLOW' | 'ALLOW_WITH_WARNING' | 'DENY';
  latencyMs: number;
  reasonCodes: string[];
  timestamp: string;
};

export type HookAuditStats = {
  totalCalls: number;
  allowCount: number;
  denyCount: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  byHookType: Record<string, { calls: number; denials: number }>;
  byMod: Record<string, { calls: number; denials: number }>;
};
