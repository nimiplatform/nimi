import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { ModLifecycleState } from '@renderer/mod-ui/contracts';
import { getRouteLifecycleState } from './route-lifecycle';

type LifecycleHandler = (state: ModLifecycleState) => void;

type RouteSubscription = {
  tabId: string;
  handlers: Set<LifecycleHandler>;
  lastState: ModLifecycleState;
};

export class LifecycleSubscriptionManager {
  private readonly subscriptions = new Map<string, RouteSubscription>();
  private unsubscribeStore: (() => void) | null = null;

  subscribe(tabId: string, handler: LifecycleHandler): () => void {
    const normalizedTabId = String(tabId || '').trim();
    if (!normalizedTabId) {
      return () => {};
    }

    let sub = this.subscriptions.get(normalizedTabId);
    if (!sub) {
      const state = useAppStore.getState();
      sub = {
        tabId: normalizedTabId,
        handlers: new Set(),
        lastState: getRouteLifecycleState(normalizedTabId, state.activeTab, state.modWorkspaceTabs),
      };
      this.subscriptions.set(normalizedTabId, sub);
    }
    sub.handlers.add(handler);

    if (!this.unsubscribeStore) {
      this.startListening();
    }

    return () => {
      sub!.handlers.delete(handler);
      if (sub!.handlers.size === 0) {
        this.subscriptions.delete(normalizedTabId);
      }
      if (this.subscriptions.size === 0) {
        this.stopListening();
      }
    };
  }

  getState(tabId: string): ModLifecycleState {
    const normalizedTabId = String(tabId || '').trim();
    const sub = this.subscriptions.get(normalizedTabId);
    if (sub) {
      return sub.lastState;
    }
    const state = useAppStore.getState();
    return getRouteLifecycleState(normalizedTabId, state.activeTab, state.modWorkspaceTabs);
  }

  private startListening(): void {
    this.unsubscribeStore = useAppStore.subscribe((state, prev) => {
      if (state.activeTab === prev.activeTab && state.modWorkspaceTabs === prev.modWorkspaceTabs) {
        return;
      }
      this.dispatch(state.activeTab, state.modWorkspaceTabs);
    });
  }

  private stopListening(): void {
    this.unsubscribeStore?.();
    this.unsubscribeStore = null;
  }

  private dispatch(
    activeTab: string,
    modWorkspaceTabs: Array<{ tabId: string; lastAccessedAt: number }>,
  ): void {
    for (const sub of this.subscriptions.values()) {
      const nextState = getRouteLifecycleState(sub.tabId, activeTab, modWorkspaceTabs);
      if (nextState !== sub.lastState) {
        sub.lastState = nextState;
        for (const handler of sub.handlers) {
          try {
            handler(nextState);
          } catch {
            // handler errors must not break dispatch loop
          }
        }
      }
    }
  }
}
