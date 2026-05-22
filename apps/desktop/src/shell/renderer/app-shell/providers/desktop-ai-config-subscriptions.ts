import type { AIConfig } from '@nimiplatform/sdk/mod';

// ---------------------------------------------------------------------------
// Config subscription registry (S-AICONF-006)
// ---------------------------------------------------------------------------

type ConfigSubscription = {
  scopeKey: string;
  callback: (config: AIConfig) => void;
};

export type ConfigSubscriptionRegistry = {
  notify(config: AIConfig): void;
  subscribe(scopeKey: string, callback: (config: AIConfig) => void): () => void;
};

export function createConfigSubscriptionRegistry(
  resolveScopeKey: (config: AIConfig) => string,
): ConfigSubscriptionRegistry {
  let subscriptionIdCounter = 0;
  const subscriptions = new Map<number, ConfigSubscription>();
  return {
    notify(config: AIConfig): void {
      const key = resolveScopeKey(config);
      for (const sub of subscriptions.values()) {
        if (sub.scopeKey === key) {
          try {
            sub.callback(config);
          } catch {
            // Subscriber errors must not break the surface
          }
        }
      }
    },
    subscribe(scopeKey: string, callback: (config: AIConfig) => void): () => void {
      const id = ++subscriptionIdCounter;
      subscriptions.set(id, { scopeKey, callback });
      return () => { subscriptions.delete(id); };
    },
  };
}
