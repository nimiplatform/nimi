import { buildRoutingCandidates } from '../routing/candidate-builder';
import type { CredentialVault } from '../credential-vault';
import { ModelRegistry } from '../registry/model-registry';
import type { ProviderAdapter } from '../providers';
import { RotationManager } from '../rotation-manager';
import type {
  CapabilityRequest,
  CredentialRef,
  ModelProfile,
  RoutingDecision,
} from '../types';
import type { UsageTracker } from '../usage-tracker';

export type ProviderBinding = {
  key: string;
  adapter: ProviderAdapter;
  credentialRefs: CredentialRef[];
};

export type BindProviderOptions = {
  forceRefresh?: boolean;
  credentialRefs?: CredentialRef[];
  models?: ModelProfile[];
};

export type RouteOptions = {
  statsByModelId?: Record<string, { ttftP95Ms?: number; latencyP95Ms?: number }>;
};

type RoutingServiceContext = {
  modelRegistry: ModelRegistry;
  rotationManager: RotationManager;
  credentialVault?: CredentialVault;
  usageTracker?: UsageTracker;
  bindings: Map<string, ProviderBinding>;
  modelToProvider: Map<string, string>;
  providerCredentials: Map<string, CredentialRef[]>;
};

function providerKeyFor(adapter: ProviderAdapter) {
  return [adapter.type, adapter.config.name, adapter.config.endpoint].join('|');
}

export class RoutingService {
  constructor(private readonly context: RoutingServiceContext) {}

  async bindProvider(adapter: ProviderAdapter, options?: BindProviderOptions) {
    const key = providerKeyFor(adapter);
    const credentialRefs = options?.credentialRefs ?? [];

    const discovered =
      options?.models ??
      (await this.context.modelRegistry.refreshModelsFromAdapter(adapter, {
        force: options?.forceRefresh,
      }));

    for (const model of discovered) {
      this.context.modelRegistry.register(model);
      this.context.modelToProvider.set(model.id, key);
    }

    this.context.bindings.set(key, {
      key,
      adapter,
      credentialRefs,
    });

    if (credentialRefs.length > 0) {
      this.context.providerCredentials.set(adapter.type, credentialRefs);
    }

    return discovered;
  }

  async routeWithObservedStats(request: CapabilityRequest): Promise<RoutingDecision[]> {
    if (!this.context.usageTracker) {
      return this.route(request);
    }

    const summaries = await this.context.usageTracker.summary('day');
    const statsByModelId = Object.fromEntries(
      summaries.map((item) => [
        item.modelId,
        {
          ttftP95Ms: item.avgTtftMs,
          latencyP95Ms: item.avgLatencyMs,
        },
      ]),
    );

    return this.route(request, { statsByModelId });
  }

  route(request: CapabilityRequest, options?: RouteOptions): RoutingDecision[] {
    const profiles = this.context.modelRegistry.findByCapability(request.capability, request);
    const credentialRefsByProvider = Object.fromEntries(this.context.providerCredentials.entries());

    return buildRoutingCandidates({
      request,
      profiles,
      credentialRefsByProvider,
      statsByModelId: options?.statsByModelId,
    });
  }

  async preflightHealth() {
    const snapshots: Array<{
      modelId: string;
      status: 'healthy' | 'unsupported' | 'unreachable';
      detail: string;
    }> = [];

    for (const binding of this.context.bindings.values()) {
      const models = this.context.modelRegistry.listByProvider(binding.adapter.type);
      for (const model of models) {
        const health = await binding.adapter.healthCheck(model.model);
        this.context.modelRegistry.register({
          ...model,
          healthStatus: health.status,
          lastCheckedAt: health.checkedAt,
        });
        snapshots.push({
          modelId: model.id,
          status: health.status,
          detail: health.detail,
        });
      }
    }

    return snapshots;
  }

  resolveBinding(modelId: string, providerType: string) {
    const directKey = this.context.modelToProvider.get(modelId);
    if (directKey) {
      return this.context.bindings.get(directKey);
    }

    for (const binding of this.context.bindings.values()) {
      if (binding.adapter.type === providerType) {
        return binding;
      }
    }

    return undefined;
  }

  resolveCredentialRef(decision: RoutingDecision, binding: ProviderBinding) {
    if (!binding.credentialRefs.length) {
      return undefined;
    }

    if (decision.credentialRef && !decision.credentialRef.refId.startsWith('implicit:')) {
      if (!this.context.rotationManager.isCoolingDown(decision.credentialRef.refId)) {
        return decision.credentialRef;
      }
    }

    const available = this.context.rotationManager.selectAvailable(binding.credentialRefs);
    if (available.length > 0) {
      return available[0];
    }

    return binding.credentialRefs[0];
  }

  async resolveAuthHeaders(decision: RoutingDecision, binding: ProviderBinding) {
    const ref = this.resolveCredentialRef(decision, binding);
    if (!ref || !this.context.credentialVault || ref.refId.startsWith('implicit:')) {
      return undefined;
    }

    const secret = await this.context.credentialVault.getCredentialSecret(ref.refId);
    if (!secret) {
      return undefined;
    }

    if (
      decision.modelProfile.providerType === 'OPENAI_COMPATIBLE' ||
      decision.modelProfile.providerType === 'CLOUD_API'
    ) {
      return {
        Authorization: `Bearer ${secret}`,
      };
    }

    return {
      Authorization: secret,
    };
  }
}
