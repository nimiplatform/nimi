import { ModelRegistry } from '../registry/model-registry';
import { RotationManager } from '../rotation-manager';
import type { CredentialVault } from '../credential-vault';
import type {
  CapabilityRequest,
  CredentialRef,
  InvokeRequest,
  RoutingDecision,
} from '../types';
import type { ProviderAdapter } from '../providers/base';
import type { UsageTracker } from '../usage-tracker';
import {
  type BindProviderOptions,
  type ProviderBinding,
  type RouteOptions,
  RoutingService,
} from './routing-service';
import { UsageService } from './usage-service';
import {
  type InvokeWithFallbackOptions,
  InvokeService,
} from './invoke-service';

type LlmAdapterRuntimeOptions = {
  modelRegistry?: ModelRegistry;
  rotationManager?: RotationManager;
  credentialVault?: CredentialVault;
  usageTracker?: UsageTracker;
};

export class LlmAdapterRuntime {
  readonly modelRegistry: ModelRegistry;
  readonly rotationManager: RotationManager;
  readonly credentialVault?: CredentialVault;
  readonly usageTracker?: UsageTracker;

  private readonly bindings = new Map<string, ProviderBinding>();
  private readonly modelToProvider = new Map<string, string>();
  private readonly providerCredentials = new Map<string, CredentialRef[]>();
  private readonly routingService: RoutingService;
  private readonly usageService: UsageService;
  private readonly invokeService: InvokeService;

  constructor(options?: LlmAdapterRuntimeOptions) {
    this.modelRegistry = options?.modelRegistry ?? new ModelRegistry();
    this.rotationManager = options?.rotationManager ?? new RotationManager();
    this.credentialVault = options?.credentialVault;
    this.usageTracker = options?.usageTracker;

    this.routingService = new RoutingService({
      modelRegistry: this.modelRegistry,
      rotationManager: this.rotationManager,
      credentialVault: this.credentialVault,
      usageTracker: this.usageTracker,
      bindings: this.bindings,
      modelToProvider: this.modelToProvider,
      providerCredentials: this.providerCredentials,
    });
    this.usageService = new UsageService(this.usageTracker);
    this.invokeService = new InvokeService({
      routingService: this.routingService,
      rotationManager: this.rotationManager,
      usageService: this.usageService,
    });
  }

  bindProvider(adapter: ProviderAdapter, options?: BindProviderOptions) {
    return this.routingService.bindProvider(adapter, options);
  }

  routeWithObservedStats(request: CapabilityRequest) {
    return this.routingService.routeWithObservedStats(request);
  }

  route(request: CapabilityRequest, options?: RouteOptions) {
    return this.routingService.route(request, options);
  }

  preflightHealth() {
    return this.routingService.preflightHealth();
  }

  invoke(
    decision: RoutingDecision,
    request: InvokeRequest,
    options?: { signal?: AbortSignal; caller?: string },
  ) {
    return this.invokeService.invoke(decision, request, options);
  }

  invokeWithFallback(
    capabilityRequest: CapabilityRequest,
    invokeRequest: InvokeRequest,
    options?: InvokeWithFallbackOptions,
  ) {
    return this.invokeService.invokeWithFallback(capabilityRequest, invokeRequest, options);
  }

  invokeStreamWithFallback(
    capabilityRequest: CapabilityRequest,
    invokeRequest: InvokeRequest,
    options?: InvokeWithFallbackOptions,
  ) {
    return this.invokeService.invokeStreamWithFallback(capabilityRequest, invokeRequest, options);
  }
}

export type { BindProviderOptions, InvokeWithFallbackOptions, LlmAdapterRuntimeOptions, RouteOptions };
