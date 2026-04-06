import type {
  RelayRouteBinding,
  RelayRouteOptions,
  ResolvedRelayRoute,
} from '../../../shared/ipc-contract.js';

function normalize(value: string | undefined | null): string {
  return String(value || '').trim();
}

function stripPrefix(value: string, prefix: string | undefined): string {
  const normalizedPrefix = normalize(prefix);
  if (!normalizedPrefix) {
    return value;
  }
  const scopedPrefix = `${normalizedPrefix}/`;
  return value.startsWith(scopedPrefix) ? value.slice(scopedPrefix.length) : value;
}

function normalizeResolvedModel(snapshot: ResolvedRelayRoute | null): string {
  if (!snapshot) {
    return '';
  }
  return snapshot.source === 'cloud'
    ? stripPrefix(snapshot.model, snapshot.provider)
    : stripPrefix(snapshot.model, 'local');
}

function findLocalModelOption(
  options: RelayRouteOptions | null | undefined,
  value: string,
) {
  const normalized = stripPrefix(normalize(value), 'local');
  if (!options || !normalized) {
    return null;
  }
  return options.local.models.find((item) => (
    item.localModelId === normalized || item.modelId === normalized
  )) || null;
}

function isRelayRouteBindingInvalid(
  binding: RelayRouteBinding | null,
  snapshot: ResolvedRelayRoute | null,
): boolean {
  if (!binding || !snapshot) {
    return false;
  }
  if (binding.source !== snapshot.source) {
    return true;
  }

  if (binding.source === 'cloud') {
    const bindingConnectorId = normalize(binding.connectorId);
    const snapshotConnectorId = normalize(snapshot.connectorId);
    if (bindingConnectorId && bindingConnectorId !== snapshotConnectorId) {
      return true;
    }
    const bindingModel = stripPrefix(normalize(binding.model), snapshot.provider);
    const snapshotModel = normalizeResolvedModel(snapshot);
    return Boolean(bindingModel && bindingModel !== snapshotModel);
  }

  const bindingLocalModelId = normalize(binding.localModelId);
  const snapshotLocalModelId = normalize(snapshot.localModelId);
  if (bindingLocalModelId && snapshotLocalModelId && bindingLocalModelId !== snapshotLocalModelId) {
    return true;
  }

  const bindingModel = stripPrefix(normalize(binding.model), 'local');
  const snapshotModel = normalizeResolvedModel(snapshot);
  return Boolean(
    bindingModel
      && bindingModel !== snapshotModel
      && (!bindingLocalModelId || !snapshotLocalModelId || bindingLocalModelId !== snapshotLocalModelId),
  );
}

export type RelayRouteDisplayModel = {
  id: string;
  label: string;
};

export type RelayRouteDisplayState = {
  source: RelayRouteBinding['source'];
  connectorId: string;
  model: string;
  activeQualifiedModel: string;
  availableModels: RelayRouteDisplayModel[];
  invalidBinding: boolean;
};

export function deriveRelayRouteDisplayState(
  binding: RelayRouteBinding | null,
  snapshot: ResolvedRelayRoute | null,
  options: RelayRouteOptions,
): RelayRouteDisplayState {
  const source = snapshot?.source ?? binding?.source ?? 'local';
  const invalidBinding = isRelayRouteBindingInvalid(binding, snapshot);

  if (source === 'cloud') {
    const connectorId = normalize(snapshot?.connectorId) || normalize(binding?.connectorId);
    const selectedConnector = options.connectors.find((item) => item.connectorId === connectorId) || null;
    return {
      source,
      connectorId,
      model: normalizeResolvedModel(snapshot) || normalize(binding?.model),
      activeQualifiedModel: normalize(snapshot?.model),
      availableModels: (selectedConnector?.models || []).map((item) => ({
        id: item.modelId,
        label: item.modelLabel || item.modelId,
      })),
      invalidBinding,
    };
  }

  const localMatch = findLocalModelOption(
    options,
    normalize(snapshot?.localModelId) || normalize(binding?.localModelId) || normalize(binding?.model),
  );
  return {
    source,
    connectorId: '',
    model: localMatch?.modelId || normalizeResolvedModel(snapshot) || stripPrefix(normalize(binding?.model), 'local') || normalize(binding?.localModelId),
    activeQualifiedModel: normalize(snapshot?.model),
    availableModels: options.local.models.map((item) => ({
      id: item.modelId,
      label: item.status === 'active' ? item.modelId : `${item.modelId} (${item.status})`,
    })),
    invalidBinding,
  };
}

export function buildRelayRouteBindingForModelChange(
  binding: RelayRouteBinding | null,
  snapshot: ResolvedRelayRoute | null,
  modelInput: string,
  options?: RelayRouteOptions | null,
): RelayRouteBinding {
  const source = binding?.source ?? snapshot?.source ?? 'local';
  const model = normalize(modelInput);

  if (source === 'cloud') {
    return {
      source,
      connectorId: binding?.connectorId ?? snapshot?.connectorId,
      model: stripPrefix(model, snapshot?.provider),
    };
  }

  const matchedLocalModel = findLocalModelOption(options, model);
  if (matchedLocalModel) {
    return {
      source,
      model: matchedLocalModel.modelId,
      localModelId: matchedLocalModel.localModelId,
    };
  }

  const normalizedModel = stripPrefix(model, 'local');
  const isQualifiedLocalModel = model.startsWith('local/');
  return {
    source,
    model: normalizedModel,
    localModelId: isQualifiedLocalModel ? undefined : normalizedModel,
  };
}
