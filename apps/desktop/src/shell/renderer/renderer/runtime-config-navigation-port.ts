import type {
  RuntimeAdvancedDiagnosticsPane,
  RuntimeConfigActionFocus,
  RuntimePageIdV11,
} from '../features/runtime-config/runtime-config-state-types.js';
import type { RuntimeConfigProfileUseOwner } from '../features/runtime-config/runtime-config-panel-types.js';

export type DesktopRendererRuntimeConfigNavigationView = {
  readonly revision: number;
  readonly intent:
    | { readonly kind: 'open-page'; readonly page: RuntimePageIdV11; readonly pane?: RuntimeAdvancedDiagnosticsPane }
    | { readonly kind: 'focus-action'; readonly actionFocus: RuntimeConfigActionFocus }
    | { readonly kind: 'open-setup-task'; readonly taskId: string }
    | { readonly kind: 'open-profile-use'; readonly owner: RuntimeConfigProfileUseOwner }
    | { readonly kind: 'open-capability'; readonly capabilityContract: string }
    | null;
};

export interface DesktopRendererRuntimeConfigNavigationPort {
  get(): DesktopRendererRuntimeConfigNavigationView;
  /** Opens a runtime page; `pane` selects an Advanced & Diagnostics sub-pane. */
  openPage(page: RuntimePageIdV11, options?: { readonly pane?: RuntimeAdvancedDiagnosticsPane }): void;
  focusAction(actionFocus: RuntimeConfigActionFocus): void;
  /** Opens the AI Settings page focused on one shell-lifetime setup task. */
  openSetupTask(taskId: string): void;
  /** Opens the AI Settings profile library in an exact consumer-owner context. */
  openProfileUse(owner: RuntimeConfigProfileUseOwner): void;
  openCapability(capabilityContract: string): void;
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
    openPage(page: RuntimePageIdV11, options?: { readonly pane?: RuntimeAdvancedDiagnosticsPane }) {
      const pane = page === 'advancedDiagnostics' ? options?.pane : undefined;
      view = Object.freeze({
        revision: view.revision + 1,
        intent: Object.freeze(pane ? { kind: 'open-page', page, pane } : { kind: 'open-page', page }),
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
    openSetupTask(taskId: string) {
      const normalized = String(taskId || '').trim();
      if (!normalized) return;
      view = Object.freeze({
        revision: view.revision + 1,
        intent: Object.freeze({ kind: 'open-setup-task', taskId: normalized }),
      });
      publish();
    },
    openProfileUse(owner: RuntimeConfigProfileUseOwner) {
      view = Object.freeze({
        revision: view.revision + 1,
        intent: Object.freeze({ kind: 'open-profile-use', owner }),
      });
      publish();
    },
    openCapability(capabilityContract: string) {
      if (!capabilityContract.trim()) return;
      view = Object.freeze({ revision: view.revision + 1, intent: Object.freeze({ kind: 'open-capability', capabilityContract }) });
      publish();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}
