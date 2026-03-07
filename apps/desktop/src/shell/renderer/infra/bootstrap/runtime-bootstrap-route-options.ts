import { asNimiError, createNimiError } from '@nimiplatform/sdk/runtime';
import type {
  RuntimeCanonicalCapability,
  RuntimeRouteBinding,
  RuntimeRouteConnectorOption,
  RuntimeRouteLocalRuntimeOption,
  RuntimeRouteOptionsSnapshot,
} from '@nimiplatform/sdk/mod/runtime-route';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { localAiRuntime } from '@runtime/local-ai-runtime';

type RuntimeFields = {
  provider: string;
  runtimeModelType: string;
  localProviderEndpoint: string;
  localProviderModel: string;
  localOpenAiEndpoint: string;
  connectorId: string;
};

type ConnectorDescriptor = {
  id: string;
  label?: string;
  vendor?: string;
  provider?: string;
};

const LOCAL_RUNTIME_SNAPSHOT_TIMEOUT_MS = 1200;

function normalizeCapabilityToken(value: unknown): RuntimeCanonicalCapability | null {
  const normalized = String(value || '').trim();
  if (
    normalized === 'text.generate'
    || normalized === 'text.embed'
    || normalized === 'image.generate'
    || normalized === 'video.generate'
    || normalized === 'audio.synthesize'
    || normalized === 'audio.transcribe'
    || normalized === 'voice_workflow.tts_v2v'
    || normalized === 'voice_workflow.tts_t2v'
  ) {
    return normalized;
  }
  if (normalized === 'chat') return 'text.generate';
  if (normalized === 'embedding') return 'text.embed';
  if (normalized === 'image') return 'image.generate';
  if (normalized === 'video') return 'video.generate';
  if (normalized === 'tts') return 'audio.synthesize';
  if (normalized === 'stt') return 'audio.transcribe';
  return null;
}

function inferSource(provider: string): 'local-runtime' | 'token-api' {
  const lower = String(provider || '').trim().toLowerCase();
  if (lower.startsWith('local-runtime') || lower === 'localai' || lower === 'nexa') {
    return 'local-runtime';
  }
  return 'token-api';
}

function inferLocalEngine(provider: string): string {
  return String(provider || '').trim().toLowerCase() === 'nexa' ? 'nexa' : 'localai';
}

function bindingKey(input: RuntimeRouteBinding | null | undefined): string {
  if (!input) return '';
  return [
    String(input.source || '').trim(),
    String(input.connectorId || '').trim(),
    String(input.model || '').trim(),
    String(input.localModelId || '').trim(),
    String(input.engine || '').trim(),
  ].join('|');
}

function mergeTokenApiBindingProvider(
  binding: RuntimeRouteBinding,
  connectors: RuntimeRouteConnectorOption[],
): RuntimeRouteBinding {
  if (binding.source !== 'token-api') {
    return binding;
  }
  const connector = connectors.find((item) => item.id === binding.connectorId) || null;
  if (!connector) {
    return binding;
  }
  return {
    ...binding,
    provider: String(binding.provider || connector.provider || '').trim() || undefined,
  };
}

function modelSupportsCapability(capabilities: string[] | undefined, capability: RuntimeCanonicalCapability): boolean {
  return (capabilities || []).some((item) => normalizeCapabilityToken(item) === capability);
}

async function pollLocalRuntimeSnapshotWithTimeout(): Promise<{
  models: Array<{
    localModelId: string;
    engine: string;
    modelId: string;
    endpoint: string;
    capabilities: string[];
    status: 'installed' | 'active' | 'unhealthy' | 'removed';
  }>;
}> {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      localAiRuntime.pollSnapshot().catch((error) => {
        throw asNimiError(error, {
          reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
          actionHint: 'check_runtime_daemon_health',
          source: 'runtime',
        });
      }),
      new Promise<never>((_resolve, reject) => {
        timeoutHandle = setTimeout(() => {
          reject(createNimiError({
            message: `local runtime snapshot timed out after ${LOCAL_RUNTIME_SNAPSHOT_TIMEOUT_MS}ms`,
            reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
            actionHint: 'check_runtime_daemon_health',
            source: 'runtime',
          }));
        }, LOCAL_RUNTIME_SNAPSHOT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }
}

function buildSelectedBinding(input: {
  capability: RuntimeCanonicalCapability;
  runtimeFields: RuntimeFields;
  localModels: RuntimeRouteLocalRuntimeOption[];
  connectors: RuntimeRouteConnectorOption[];
}): RuntimeRouteBinding {
  const { runtimeFields, localModels, connectors } = input;
  const preferredSource = inferSource(runtimeFields.provider);
  const preferredBinding: RuntimeRouteBinding = preferredSource === 'local-runtime'
    ? {
      source: 'local-runtime',
      connectorId: '',
      model: String(runtimeFields.localProviderModel || '').trim(),
      localModelId: String(runtimeFields.localProviderModel || '').trim() || undefined,
      engine: inferLocalEngine(runtimeFields.provider),
    }
    : {
      source: 'token-api',
      connectorId: String(runtimeFields.connectorId || '').trim(),
      model: String(runtimeFields.localProviderModel || '').trim(),
      provider: String(runtimeFields.provider || '').trim() || undefined,
    };

  const availableBindings: RuntimeRouteBinding[] = [
    ...localModels.map((item) => ({
      source: 'local-runtime' as const,
      connectorId: '',
      model: item.model,
      localModelId: item.localModelId,
      engine: item.engine,
    })),
    ...connectors.flatMap((connector) => connector.models.map((model) => ({
      source: 'token-api' as const,
      connectorId: connector.id,
      model,
      provider: String(connector.provider || '').trim() || undefined,
    }))),
  ];

  const matchedBinding = availableBindings.find((item) => bindingKey(item) === bindingKey(preferredBinding)) || null;
  if (matchedBinding) {
    return matchedBinding;
  }

  return availableBindings[0] || mergeTokenApiBindingProvider(preferredBinding, connectors);
}

export async function loadRuntimeRouteOptions(input: {
  capability: RuntimeCanonicalCapability;
  modId?: string;
}): Promise<RuntimeRouteOptionsSnapshot> {
  const runtimeFields = useAppStore.getState().runtimeFields as RuntimeFields;
  const { sdkListConnectors, sdkListConnectorModelDescriptors } = await import(
    '@renderer/features/runtime-config/domain/provider-connectors/connector-sdk-service'
  );

  const connectorDescriptors = await sdkListConnectors();
  const connectors: RuntimeRouteConnectorOption[] = [];
  for (const connector of connectorDescriptors as ConnectorDescriptor[]) {
    const descriptors = await sdkListConnectorModelDescriptors(connector.id, false);
    const models = descriptors
      .filter((item) => modelSupportsCapability(item.capabilities, input.capability))
      .map((item) => item.modelId);
    if (models.length === 0) {
      continue;
    }
    const modelCapabilities = descriptors.reduce<Record<string, string[]>>((accumulator, item) => {
      if (!modelSupportsCapability(item.capabilities, input.capability)) {
        return accumulator;
      }
      accumulator[item.modelId] = item.capabilities;
      return accumulator;
    }, {});
    connectors.push({
      id: connector.id,
      label: String(connector.label || ''),
      vendor: String(connector.vendor || '').trim() || undefined,
      provider: String(connector.provider || '').trim() || undefined,
      models,
      modelCapabilities,
      modelProfiles: [],
    });
  }

  let localRuntimeModels: RuntimeRouteLocalRuntimeOption[] = [];
  try {
    const snapshot = await pollLocalRuntimeSnapshotWithTimeout();
    localRuntimeModels = snapshot.models
      .filter((item) => item.status !== 'removed')
      .filter((item) => modelSupportsCapability(item.capabilities, input.capability))
      .map((item) => ({
        localModelId: item.localModelId,
        label: item.modelId,
        engine: item.engine,
        model: item.modelId,
        endpoint: item.endpoint,
        status: item.status,
        capabilities: item.capabilities
          .map((capability) => normalizeCapabilityToken(capability))
          .filter((capability): capability is RuntimeCanonicalCapability => Boolean(capability)),
      }));
  } catch (error) {
    const localRuntimeError = asNimiError(error, {
      reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
      actionHint: 'check_runtime_daemon_health',
      source: 'runtime',
    });
    if (inferSource(runtimeFields.provider) === 'local-runtime') {
      throw localRuntimeError;
    }
  }

  const selected = buildSelectedBinding({
    capability: input.capability,
    runtimeFields,
    localModels: localRuntimeModels,
    connectors,
  });

  return {
    capability: input.capability,
    selected,
    resolvedDefault: selected,
    localRuntime: {
      models: localRuntimeModels,
      defaultEndpoint: String(runtimeFields.localProviderEndpoint || runtimeFields.localOpenAiEndpoint || '').trim() || undefined,
    },
    connectors,
  };
}
