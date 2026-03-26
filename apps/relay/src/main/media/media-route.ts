// Relay media route — simplified from local-chat media-route.ts
// Relay does not manage local models. Removed local model capability detection
// and Go runtime status checking. Kept cloud route resolution and settings revision.

import type { LocalChatDefaultSettings } from '../settings/types.js';
import type { LocalChatResolvedMediaRoute } from '../chat-pipeline/types.js';

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

export type RouteBinding = {
  source: 'local' | 'cloud';
  connectorId: string;
  model: string;
  localModelId?: string;
};

export function resolveMediaRouteConfig(input: {
  kind: MediaKind;
  settings: LocalChatDefaultSettings;
}): {
  routeSource: MediaRouteSource;
  routeBinding?: RouteBinding;
  model?: string;
} {
  const routeSource = normalizeRouteSource(input.kind === 'image'
    ? input.settings.imageRouteSource
    : input.settings.videoRouteSource);
  const connectorId = asTrimmedString(input.kind === 'image'
    ? input.settings.imageConnectorId
    : input.settings.videoConnectorId);
  const model = asTrimmedString(input.kind === 'image'
    ? input.settings.imageModel
    : input.settings.videoModel);

  if (routeSource === 'cloud') {
    const override: RouteBinding = {
      source: 'cloud',
      connectorId,
      model: model || '',
      ...(connectorId ? { connectorId } : {}),
      ...(model ? { model } : {}),
    };
    return {
      routeSource,
      routeBinding: override,
      model: model || undefined,
    };
  }

  // Relay does not manage local models — auto/local both resolve to cloud bindings when configured.
  if (routeSource === 'auto' || routeSource === 'local') {
    if (connectorId || model) {
      const override: RouteBinding = {
        source: 'cloud',
        connectorId,
        model: model || '',
        ...(connectorId ? { connectorId } : {}),
        ...(model ? { model } : {}),
      };
      return {
        routeSource,
        routeBinding: override,
        model: model || undefined,
      };
    }
    return {
      routeSource,
      model: undefined,
    };
  }

  return {
    routeSource,
    model: model || undefined,
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

  const routeSource = normalizeRouteSource(input.kind === 'image'
    ? input.settings.imageRouteSource
    : input.settings.videoRouteSource);
  const connectorId = asTrimmedString(input.kind === 'image'
    ? input.settings.imageConnectorId
    : input.settings.videoConnectorId);
  const model = asTrimmedString(input.kind === 'image'
    ? input.settings.imageModel
    : input.settings.videoModel);

  // For relay: cloud routes are ready if connectorId is configured
  if (routeSource === 'cloud') {
    return Boolean(connectorId);
  }

  // Relay resolves both auto and local selections through cloud bindings when configured.
  if (routeSource === 'auto' || routeSource === 'local') {
    return Boolean(connectorId || model);
  }

  return false;
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
  if (!asTrimmedString(binding.connectorId) && !asTrimmedString(binding.model)) {
    return null;
  }

  return {
    source: binding.source,
    ...(asTrimmedString(binding.connectorId) ? { connectorId: asTrimmedString(binding.connectorId) } : {}),
    model: asTrimmedString(binding.model),
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
  ].join('|');
}

export async function preflightResolveMediaRoute(input: {
  aiClient: {
    resolveRoute: (input: { routeBinding?: unknown }) => Promise<{
      source: string;
      model: string;
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

  const source = resolved.source === 'cloud' ? 'cloud' as const : 'cloud' as const; // relay always cloud
  const model = asTrimmedString(resolved.model);

  if (!model) {
    return null;
  }

  return {
    source,
    model,
    resolvedBy: 'preflight',
    resolvedAt: new Date().toISOString(),
    settingsRevision: buildMediaSettingsRevision({
      kind: input.kind,
      settings: input.settings,
    }),
    routeOptionsRevision: 0,
  };
}
