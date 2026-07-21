import type {
  RuntimeConfigActionFocus,
  RuntimePageIdV11,
} from '../features/runtime-config/runtime-config-state-types.js';

export type DesktopRendererRuntimeConfigNavigationView = {
  readonly revision: number;
  readonly intent:
    | { readonly kind: 'open-page'; readonly page: RuntimePageIdV11 }
    | { readonly kind: 'focus-action'; readonly actionFocus: RuntimeConfigActionFocus }
    | null;
};

export interface DesktopRendererRuntimeConfigNavigationPort {
  get(): DesktopRendererRuntimeConfigNavigationView;
  openPage(page: RuntimePageIdV11): void;
  focusAction(actionFocus: RuntimeConfigActionFocus): void;
  subscribe(listener: () => void): () => void;
}

export function createDesktopRendererRuntimeConfigNavigationPort(): DesktopRendererRuntimeConfigNavigationPort {
  let view: DesktopRendererRuntimeConfigNavigationView = Object.freeze({
    revision: 0,
    intent: null,
  });
  const listeners = new Set<() => void>();
  const publish = (): void => {
    for (const listener of listeners) listener();
  };

  return Object.freeze({
    get: () => view,
    openPage(page: RuntimePageIdV11) {
      view = Object.freeze({
        revision: view.revision + 1,
        intent: Object.freeze({ kind: 'open-page', page }),
      });
      publish();
    },
    focusAction(actionFocus: RuntimeConfigActionFocus) {
      view = Object.freeze({
        revision: view.revision + 1,
        intent: Object.freeze({ kind: 'focus-action', actionFocus }),
      });
      publish();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
