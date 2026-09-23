import type {
  NimiPortableAppAIConfig,
  NimiPortableAppAIConfigIntent,
} from '@nimiplatform/sdk/ai';
import { runtimeAIConfigStructToJson } from '@nimiplatform/sdk/ai';

export type StudioAIConfigClient = {
  get(): Promise<NimiPortableAppAIConfig | null>;
};

export type StudioAIConfigRefreshEventTarget = {
  addEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: EventListener): void;
};

export type StudioAIConfigVisibilityTarget = StudioAIConfigRefreshEventTarget & {
  readonly visibilityState: string;
};

/** Reports a possible AIConfig write inside this App window, e.g. when the in-app drawer closes. */
export const STUDIO_AI_CONFIG_CHANGED_EVENT = 'nimi://ai-studio-ai-config-changed';

export async function loadStudioAIConfig(
  client: Pick<StudioAIConfigClient, 'get'>,
  expectedAppId: string,
): Promise<NimiPortableAppAIConfig | null> {
  try {
    const config = await client.get();
    return config ? requireStudioAIConfigOwner(config, expectedAppId) : null;
  } catch (error) {
    if (isStudioAIConfigNotFound(error)) return null;
    throw error;
  }
}

/**
 * Focus and visibility report writes from other surfaces; the in-app change
 * event reports same-window writes, which never move focus.
 */
export function subscribeStudioAIConfigRefresh(
  refresh: () => void,
  focusTarget: StudioAIConfigRefreshEventTarget,
  visibilityTarget: StudioAIConfigVisibilityTarget,
): () => void {
  const onRefresh: EventListener = () => refresh();
  const onVisibilityChange: EventListener = () => {
    if (visibilityTarget.visibilityState === 'visible') refresh();
  };
  focusTarget.addEventListener('focus', onRefresh);
  focusTarget.addEventListener(STUDIO_AI_CONFIG_CHANGED_EVENT, onRefresh);
  visibilityTarget.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    focusTarget.removeEventListener('focus', onRefresh);
    focusTarget.removeEventListener(STUDIO_AI_CONFIG_CHANGED_EVENT, onRefresh);
    visibilityTarget.removeEventListener('visibilitychange', onVisibilityChange);
  };
}

/** Dispatches from a node inside the App document so it bubbles to the window focus target. */
export function notifyStudioAIConfigChanged(source: Pick<EventTarget, 'dispatchEvent'>): void {
  source.dispatchEvent(new Event(STUDIO_AI_CONFIG_CHANGED_EVENT, { bubbles: true }));
}

export function requireStudioAIConfigOwner(
  config: NimiPortableAppAIConfig,
  expectedAppId: string,
): NimiPortableAppAIConfig {
  const normalizedAppId = expectedAppId.trim();
  if (!normalizedAppId || normalizedAppId !== expectedAppId) {
    throw new Error('AI Studio requires an exact canonical App ID.');
  }
  const owner = config.owner?.owner;
  if (!owner || owner.oneofKind !== 'app' || !('app' in owner) || owner.app.appId !== normalizedAppId) {
    throw new Error(`AIConfig owner must be the exact ${normalizedAppId} App.`);
  }
  return config;
}

export function findStudioCapabilityIntent(
  config: NimiPortableAppAIConfig | null,
  capabilityContract: string,
): NimiPortableAppAIConfigIntent | null {
  return config?.capabilities.find(
    (intent) => intent.capabilityContract === capabilityContract,
  ) ?? null;
}

export function studioCloudIntentHasExactTarget(
  intent: NimiPortableAppAIConfigIntent,
): boolean {
  if (intent.route.oneofKind !== 'cloud') return false;
  const route = intent.route;
  if (!('cloud' in route)) return false;
  const target = runtimeAIConfigStructToJson(route.cloud.providerModelTarget);
  const exactText = (value: unknown): boolean => (
    typeof value === 'string' && value.length > 0 && value.trim() === value
  );
  return exactText(route.cloud.connectorRef)
    && !Object.hasOwn(target, 'model')
    && exactText(target.provider)
    && exactText(target.providerModelId)
    && exactText(target.remoteModelCatalogId);
}

function isStudioAIConfigNotFound(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  const reason = typeof record.reasonCode === 'string'
    ? record.reasonCode
    : typeof record.code === 'string'
      ? record.code
      : '';
  return reason.trim().toUpperCase().replaceAll('-', '_') === 'AI_CONFIG_NOT_FOUND';
}
