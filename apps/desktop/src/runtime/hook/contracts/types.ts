// ---------------------------------------------------------------------------
// Core hook decision / type enums
// ---------------------------------------------------------------------------

export type HookDecision = 'ALLOW' | 'ALLOW_WITH_WARNING' | 'DENY';
export type HookType = 'event-bus' | 'data-api' | 'storage' | 'ui-extension' | 'turn-hook' | 'inter-mod' | 'runtime' | 'action';
export type HookSourceType = 'builtin' | 'injected' | 'sideload' | 'core' | 'codegen';
export type TurnHookPoint = 'pre-policy' | 'pre-model' | 'post-state' | 'pre-commit';

export type MissingDataCapabilityResolver = (capability: string) => Promise<boolean> | boolean;

export type AgentProfileReadFilterInput = {
  viewerUserId?: string;
  ownerAgentId: string;
  worldId?: string;
  profile: Record<string, unknown>;
};

export type AgentProfileReadFilterResult = {
  referenceImageUrl?: string | null;
};

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface HookCallRecord {
  callId: string;
  modId: string;
  hookType: HookType;
  target: string;
  decision: HookDecision;
  latencyMs: number;
  reasonCodes: string[];
  timestamp: string;
}

export interface AuditStats {
  totalCalls: number;
  allowCount: number;
  denyCount: number;
  avgLatencyMs: number;
  maxLatencyMs: number;
  byHookType: Record<string, { calls: number; denials: number }>;
  byMod: Record<string, { calls: number; denials: number }>;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export interface HookRegistration {
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
}

// ---------------------------------------------------------------------------
// Permission
// ---------------------------------------------------------------------------

export interface PermissionEvaluation {
  allow: boolean;
  sourceType: HookSourceType;
  capabilityKey: string;
  reasonCodes: string[];
}

export interface CapabilityDeclaration {
  modId: string;
  sourceType: HookSourceType;
  baseline: string[];
  grants: string[];
  denials: string[];
}

// ---------------------------------------------------------------------------
// Event Bus
// ---------------------------------------------------------------------------

export type EventHandler = (payload: Record<string, unknown>) => Promise<unknown> | unknown;

export interface EventSubscription {
  modId: string;
  topic: string;
  handler: EventHandler;
  once: boolean;
}

export interface EmitResult {
  delivered: number;
  failed: number;
  errors: Array<{ modId: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Data API
// ---------------------------------------------------------------------------

export type DataQueryHandler = (input: Record<string, unknown>) => Promise<unknown> | unknown;

export interface DataCapability {
  name: string;
  handler: DataQueryHandler;
  description?: string;
}

// ---------------------------------------------------------------------------
// Turn Hook
// ---------------------------------------------------------------------------

export type TurnHookHandler = (context: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;

export interface TurnHookEntry {
  modId: string;
  point: TurnHookPoint;
  priority: number;
  handler: TurnHookHandler;
  timeoutMs: number;
}

export interface TurnHookResult {
  context: Record<string, unknown>;
  errors: Array<{ modId: string; point: TurnHookPoint; error: string }>;
  aborted: boolean;
}

// ---------------------------------------------------------------------------
// UI Extension
// ---------------------------------------------------------------------------

export interface UiExtensionEntry {
  modId: string;
  slot: string;
  priority: number;
  extension: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Inter-Mod
// ---------------------------------------------------------------------------

export type InterModHandler = (payload: Record<string, unknown>, context?: Record<string, unknown>) => Promise<unknown> | unknown;

export interface InterModRegistration {
  modId: string;
  channel: string;
  handler: InterModHandler;
}

export interface InterModDiscovery {
  channel: string;
  providers: string[];
}
