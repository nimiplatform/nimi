import type { ExecuteScenarioRequest } from '../core-generated/runtime-typed-client';
import type { CoreMetadata, CoreResponseMetadataObserver, JsonObject } from '../types';
import type {
  NimiRuntimeCanonicalCapability,
  NimiRuntimeRouteBinding,
  NimiRuntimeRouteOptionsSnapshot,
  NimiRuntimeRouteSource,
} from './route-options';

export const NIMI_RUNTIME_ROUTE_DESCRIBE_RESULT_RESPONSE_METADATA_KEY = 'x-nimi-route-describe-result';
export const NIMI_RUNTIME_ROUTE_DESCRIBE_TIMEOUT_MS = 30_000;

export type NimiRuntimeRouteResolvedBindingRef = string;
export type NimiRuntimeRouteMetadataVersion = 'v1';

export interface NimiRuntimeResolvedBinding extends NimiRuntimeRouteBinding {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly resolvedBindingRef?: NimiRuntimeRouteResolvedBindingRef;
}

export interface NimiRuntimeRouteHealthInput {
  readonly provider: string;
  readonly capability?: string;
  readonly localProviderEndpoint?: string;
  readonly localProviderModel?: string;
  readonly localOpenAiEndpoint?: string;
  readonly localModelId?: string;
  readonly goRuntimeLocalModelId?: string;
  readonly connectorId?: string;
}

export interface NimiRuntimeRouteHostProviderHealth {
  readonly provider?: string;
  readonly endpoint?: string | null;
  readonly model?: string;
  readonly status?: 'healthy' | 'degraded' | 'unsupported' | 'unreachable' | 'unavailable' | string;
  readonly detail?: string;
  readonly reasonCode?: string;
  readonly actionHint?: string;
}

export interface NimiRuntimeRouteHealthResult {
  readonly healthy: boolean;
  readonly status: 'healthy' | 'degraded' | 'unsupported' | 'unreachable' | 'unavailable' | string;
  readonly provider: string;
  readonly detail: string;
  readonly reasonCode?: string;
  readonly actionHint: string;
}

export type NimiRuntimeRouteMetadataKind =
  | 'text.generate'
  | 'audio.synthesize'
  | 'audio.transcribe'
  | 'voice_workflow.voice_clone'
  | 'voice_workflow.voice_design'
  | string;

export interface NimiRuntimeRouteDescribeResult {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly metadataVersion: NimiRuntimeRouteMetadataVersion;
  readonly resolvedBindingRef: NimiRuntimeRouteResolvedBindingRef;
  readonly metadataKind: NimiRuntimeRouteMetadataKind;
  readonly metadata: JsonObject;
}

export interface NimiRuntimeRouteDescribeCallOptions {
  readonly metadata?: CoreMetadata;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly responseMetadataObserver?: CoreResponseMetadataObserver;
}

export interface NimiRuntimeRouteDescribeCallOptionsInput {
  readonly targetId: string;
  readonly timeoutMs: number;
  readonly source: NimiRuntimeRouteSource;
  readonly connectorId?: string;
  readonly providerEndpoint?: string;
}

export type NimiRuntimeRouteDescribeCallOptionsBuilder = (
  input: NimiRuntimeRouteDescribeCallOptionsInput,
) => Promise<NimiRuntimeRouteDescribeCallOptions> | NimiRuntimeRouteDescribeCallOptions;

export type NimiRuntimeRouteExecuteScenario = (
  request: ExecuteScenarioRequest,
  options: NimiRuntimeRouteDescribeCallOptions,
) => Promise<unknown>;

export type NimiRuntimeRouteCapabilityOptionsLoader = (input: {
  readonly capability: NimiRuntimeCanonicalCapability;
  readonly targetId?: string;
  readonly selectedBinding?: NimiRuntimeRouteBinding | null;
}) => Promise<NimiRuntimeRouteOptionsSnapshot> | NimiRuntimeRouteOptionsSnapshot;

export interface NimiRuntimeRouteCapabilityDescribeHost {
  readonly appId: string;
  readonly executeScenario: NimiRuntimeRouteExecuteScenario;
}

export interface NimiRuntimeRouteCapabilityHostRuntimeDeps {
  readonly loadRuntimeRouteOptions: NimiRuntimeRouteCapabilityOptionsLoader;
  readonly checkHealth: (
    request: NimiRuntimeRouteHealthInput,
  ) => Promise<NimiRuntimeRouteHostProviderHealth> | NimiRuntimeRouteHostProviderHealth;
  readonly getDescribeHost: () => NimiRuntimeRouteCapabilityDescribeHost;
  readonly buildDescribeCallOptions: NimiRuntimeRouteDescribeCallOptionsBuilder;
  readonly describeTargetId: string;
  readonly routeOptionsTargetId?: string;
  readonly describeTimeoutMs?: number;
}

export interface NimiRuntimeRouteCapabilityRuntime {
  resolve(input: {
    readonly capability: NimiRuntimeCanonicalCapability;
    readonly binding?: NimiRuntimeRouteBinding;
  }): Promise<NimiRuntimeResolvedBinding>;
  checkHealth(input: {
    readonly capability: NimiRuntimeCanonicalCapability;
    readonly binding?: NimiRuntimeRouteBinding;
  }): Promise<NimiRuntimeRouteHealthResult>;
  describe(input: {
    readonly capability: NimiRuntimeCanonicalCapability;
    readonly resolvedBindingRef: string;
  }): Promise<NimiRuntimeRouteDescribeResult>;
}
