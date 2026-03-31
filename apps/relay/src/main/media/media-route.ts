import { buildLocalImageWorkflowExtensions } from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type { JsonObject } from '../../shared/json.js';
import type { LocalChatResolvedMediaRoute } from '../chat-pipeline/types.js';
import type { LocalChatDefaultSettings } from '../settings/types.js';

type MediaKind = 'image' | 'video';
type MediaRouteSource = LocalChatDefaultSettings['imageRouteSource'];

function normalizeRouteSource(value: string): MediaRouteSource {
  if (value === 'local' || value === 'cloud') {
    return value;
  }
  return 'auto';
}

function asTrimmedString(value: unknown): string {
  return String(value ?? '').trim();
}

function createRelayMediaRouteError(
  message: string,
  reasonCode: string,
  actionHint?: string,
): Error {
  const error = new Error(message);
  Object.assign(error, {
    reasonCode,
    ...(actionHint ? { actionHint } : {}),
  });
  return error;
}

export type RouteBinding = {
  source: 'local' | 'cloud';
  connectorId: string;
  model: string;
  localModelId?: string;
};

export type ResolvedImageGenerateTarget = {
  routeSource: 'local' | 'cloud';
  model: string;
  connectorId?: string;
  localModelId?: string;
  extensions?: JsonObject;
};

function resolveConfiguredCloudBinding(input: {
  connectorId: string;
  model: string;
  routeSource: MediaRouteSource;
}): {
  routeSource: MediaRouteSource;
  routeBinding?: RouteBinding;
  model?: string;
} {
  const connectorId = asTrimmedString(input.connectorId);
  const model = asTrimmedString(input.model);
  if (!connectorId && !model) {
    return {
      routeSource: input.routeSource,
      model: undefined,
    };
  }
  return {
    routeSource: input.routeSource,
    routeBinding: {
      source: 'cloud',
      connectorId,
      model,
      ...(connectorId ? { connectorId } : {}),
      ...(model ? { model } : {}),
    },
    model: model || undefined,
  };
}

function resolveConfiguredImageBinding(
  settings: LocalChatDefaultSettings,
): {
  routeSource: MediaRouteSource;
  routeBinding?: RouteBinding;
  model?: string;
} {
  const routeSource = normalizeRouteSource(settings.imageRouteSource);
  const connectorId = asTrimmedString(settings.imageConnectorId);
  const model = asTrimmedString(settings.imageModel);
  const localModelId = asTrimmedString(settings.imageLocalModelId);

  if (routeSource === 'local') {
    if (!localModelId) {
      return {
        routeSource,
        model: undefined,
      };
    }
    return {
      routeSource,
      routeBinding: {
        source: 'local',
        connectorId: '',
        model,
        localModelId,
      },
      model: model || undefined,
    };
  }

  if (routeSource === 'cloud') {
    return resolveConfiguredCloudBinding({ routeSource, connectorId, model });
  }

  if (connectorId) {
    return resolveConfiguredCloudBinding({ routeSource, connectorId, model });
  }
  if (localModelId) {
    return {
      routeSource,
      routeBinding: {
        source: 'local',
        connectorId: '',
        model,
        localModelId,
      },
      model: model || undefined,
    };
  }
  return {
    routeSource,
    model: undefined,
  };
}

export function resolveMediaRouteConfig(input: {
  kind: MediaKind;
  settings: LocalChatDefaultSettings;
}): {
  routeSource: MediaRouteSource;
  routeBinding?: RouteBinding;
  model?: string;
} {
  if (input.kind === 'image') {
    return resolveConfiguredImageBinding(input.settings);
  }

  const routeSource = normalizeRouteSource(input.settings.videoRouteSource);
  const connectorId = asTrimmedString(input.settings.videoConnectorId);
  const model = asTrimmedString(input.settings.videoModel);
  return resolveConfiguredCloudBinding({ routeSource, connectorId, model });
}

export function resolveConfiguredImageWorkflowExtensions(
  settings: LocalChatDefaultSettings,
): JsonObject | undefined {
  const extensions = buildLocalImageWorkflowExtensions({
    components: settings.imageWorkflowComponents,
    ...(settings.imageProfileOverrides ? { profileOverrides: settings.imageProfileOverrides } : {}),
  });
  if (Object.keys(extensions).length === 0) {
    return undefined;
  }
  return extensions;
}

export function resolveConfiguredImageGenerateTarget(
  settings: LocalChatDefaultSettings,
): ResolvedImageGenerateTarget {
  const routeConfig = resolveMediaRouteConfig({
    kind: 'image',
    settings,
  });
  const binding = routeConfig.routeBinding;
  if (!binding) {
    throw createRelayMediaRouteError(
      'Image route is not configured. Select a local image model or cloud connector first.',
      ReasonCode.AI_INPUT_INVALID,
      'configure_image_route',
    );
  }

  if (binding.source === 'local') {
    const localModelId = asTrimmedString(binding.localModelId);
    if (!localModelId) {
      throw createRelayMediaRouteError(
        'Local image model is required. Select a local image model before generating.',
        ReasonCode.AI_INPUT_INVALID,
        'select_local_image_model',
      );
    }
    const model = asTrimmedString(binding.model);
    if (!model) {
      throw createRelayMediaRouteError(
        'Local image model metadata is incomplete. Re-select the local image model.',
        ReasonCode.AI_LOCAL_MODEL_UNAVAILABLE,
        'select_local_image_model',
      );
    }
    const extensions = resolveConfiguredImageWorkflowExtensions(settings);
    if (!extensions?.components || !Array.isArray(extensions.components) || extensions.components.length === 0) {
      throw createRelayMediaRouteError(
        'local media workflow requires explicit companion artifact selections via components[]',
        ReasonCode.AI_INPUT_INVALID,
        'select_local_image_companions',
      );
    }
    return {
      routeSource: 'local',
      model: `local/${model}`,
      localModelId,
      extensions,
    };
  }

  const connectorId = asTrimmedString(binding.connectorId);
  if (!connectorId) {
    throw createRelayMediaRouteError(
      'Image connector is required. Select a cloud connector before generating.',
      ReasonCode.AI_INPUT_INVALID,
      'configure_image_route',
    );
  }
  const model = asTrimmedString(binding.model);
  if (!model) {
    throw createRelayMediaRouteError(
      'Image model is required. Select a cloud image model before generating.',
      ReasonCode.AI_INPUT_INVALID,
      'configure_image_route',
    );
  }
  return {
    routeSource: 'cloud',
    connectorId,
    model,
  };
}

export function isMediaRouteReady(input: {
  kind: MediaKind;
  settings: LocalChatDefaultSettings;
  resolvedRoute?: LocalChatResolvedMediaRoute | null;
}): boolean {
  if (input.resolvedRoute) {
    const expectedSettingsRevision = buildMediaSettingsRevision({
      kind: input.kind,
      settings: input.settings,
    });
    return input.resolvedRoute.settingsRevision === expectedSettingsRevision;
  }

  const routeConfig = resolveMediaRouteConfig({
    kind: input.kind,
    settings: input.settings,
  });
  const binding = routeConfig.routeBinding;
  if (!binding) {
    return false;
  }
  if (binding.source === 'local') {
    return Boolean(asTrimmedString(binding.localModelId));
  }
  return Boolean(asTrimmedString(binding.connectorId));
}

export function resolveMediaRouteFromOptions(input: {
  kind: MediaKind;
  settings: LocalChatDefaultSettings;
}): LocalChatResolvedMediaRoute | null {
  const routeConfig = resolveMediaRouteConfig({
    kind: input.kind,
    settings: input.settings,
  });

  if (!routeConfig.routeBinding) {
    return null;
  }

  const binding = routeConfig.routeBinding;
  const model = asTrimmedString(binding.model);
  const connectorId = asTrimmedString(binding.connectorId);
  const localModelId = asTrimmedString(binding.localModelId);
  if (binding.source === 'local' && !localModelId) {
    return null;
  }
  if (binding.source === 'cloud' && (!connectorId || !model)) {
    return null;
  }

  return {
    source: binding.source,
    ...(connectorId ? { connectorId } : {}),
    ...(localModelId ? { localModelId } : {}),
    model: binding.source === 'local' ? `local/${model}` : model,
    resolvedBy: 'selected',
    resolvedAt: new Date().toISOString(),
    settingsRevision: buildMediaSettingsRevision({
      kind: input.kind,
      settings: input.settings,
    }),
    routeOptionsRevision: 0,
  };
}

export function buildMediaSettingsRevision(input: {
  kind: MediaKind;
  settings: LocalChatDefaultSettings;
}): string {
  const routeConfig = resolveMediaRouteConfig({
    kind: input.kind,
    settings: input.settings,
  });
  return [
    input.kind,
    routeConfig.routeSource,
    asTrimmedString(routeConfig.routeBinding?.connectorId),
    asTrimmedString(routeConfig.routeBinding?.model),
    asTrimmedString(routeConfig.routeBinding?.localModelId),
  ].join('|');
}

export async function preflightResolveMediaRoute(input: {
  aiClient: {
    resolveRoute: (input: { routeBinding?: unknown }) => Promise<{
      source: string;
      model: string;
      connectorId?: string;
      localModelId?: string;
    } | null>;
  };
  kind: MediaKind;
  settings: LocalChatDefaultSettings;
}): Promise<LocalChatResolvedMediaRoute | null> {
  const routeConfig = resolveMediaRouteConfig({
    kind: input.kind,
    settings: input.settings,
  });

  const resolved = await input.aiClient.resolveRoute({
    routeBinding: routeConfig.routeBinding,
  });

  if (!resolved) {
    return null;
  }

  const source = resolved.source === 'local' ? 'local' as const : 'cloud' as const;
  const model = asTrimmedString(resolved.model);
  if (!model) {
    return null;
  }

  return {
    source,
    model,
    ...(asTrimmedString(resolved.connectorId) ? { connectorId: asTrimmedString(resolved.connectorId) } : {}),
    ...(asTrimmedString(resolved.localModelId) ? { localModelId: asTrimmedString(resolved.localModelId) } : {}),
    resolvedBy: 'preflight',
    resolvedAt: new Date().toISOString(),
    settingsRevision: buildMediaSettingsRevision({
      kind: input.kind,
      settings: input.settings,
    }),
    routeOptionsRevision: 0,
  };
}
