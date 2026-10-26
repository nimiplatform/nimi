import type { RuntimeAdvancedDiagnosticsPane, RuntimeConfigActionFocus, RuntimePageIdV11 } from '../features/runtime-config/runtime-config-state-types.js';
import type { RuntimeConfigProfileUseOwner } from '../features/runtime-config/runtime-config-panel-types.js';
import { homeRuntimeDestination, validateHomeDestination, type HomeNavigation, type HomeRuntimePosition } from '../app-shell/providers/home-navigation.js';

/** Only unconsumed one-time actions live here. Page position belongs to Home navigation. */
export type DesktopRendererRuntimeConfigNavigationView = {
  readonly revision: number;
  readonly intent: { readonly kind: 'focus-action'; readonly actionFocus: RuntimeConfigActionFocus; readonly entryKey: string; readonly generation: number } | null;
};
export interface DesktopRendererRuntimeConfigNavigationPort {
  get(): DesktopRendererRuntimeConfigNavigationView;
  takeAction(): RuntimeConfigActionFocus | null;
  openPage(page: RuntimePageIdV11, options?: { readonly pane?: RuntimeAdvancedDiagnosticsPane }): void;
  focusAction(actionFocus: RuntimeConfigActionFocus): void;
  openSetupTask(taskId: string): void;
  openProfileUse(owner: RuntimeConfigProfileUseOwner): void;
  openCapability(capabilityContract: string): void;
  subscribe(listener: () => void): () => void;
}
// @nimi-authority: rule.nimi.desktop.shell-ui.standard-navigation
export function createDesktopRendererRuntimeConfigNavigationPort(getNavigation: () => HomeNavigation): DesktopRendererRuntimeConfigNavigationPort {
  let view: DesktopRendererRuntimeConfigNavigationView = Object.freeze({ revision: 0, intent: null });
  const listeners = new Set<() => void>();
  const open = (page: RuntimePageIdV11, position: HomeRuntimePosition = {}) => {
    view = Object.freeze({ revision: view.revision, intent: null });
    return getNavigation().push(homeRuntimeDestination(page, position));
  };
  return Object.freeze({
    get: () => view,
    takeAction() {
      const intent = view.intent; view = Object.freeze({ revision: view.revision, intent: null });
      const snapshot = getNavigation().getSnapshot();
      return intent && intent.entryKey === snapshot.current.key && intent.generation === snapshot.generation ? intent.actionFocus : null;
    },
    openPage(page: RuntimePageIdV11, options?: { readonly pane?: RuntimeAdvancedDiagnosticsPane }) { void open(page, options?.pane ? { pane: options.pane } : {}); },
    openSetupTask(taskId: string) { void open('aiSettings', { setupTaskId: taskId }); },
    openProfileUse(owner: RuntimeConfigProfileUseOwner) { void open('aiSettings', { profileOwner: owner }); },
    openCapability(capabilityContract: string) { void open('aiSettings', { capabilityContract }); },
    focusAction(actionFocus: RuntimeConfigActionFocus) {
      const navigation = getNavigation();
      const position: HomeRuntimePosition = actionFocus.action === 'open-saved-configs' ? { section: 'saved' }
        : actionFocus.action === 'import-model-files' || actionFocus.action === 'manage-model-files' ? { section: 'downloaded' } : {};
      const generation = navigation.getSnapshot().generation;
      const expected = JSON.stringify(validateHomeDestination(homeRuntimeDestination(actionFocus.page, position)));
      let entryKey: string | null = null;
      let left = false;
      const observe = () => {
        const snapshot = navigation.getSnapshot();
        if (snapshot.generation !== generation) left = true;
        else if (entryKey && (snapshot.current.key !== entryKey || snapshot.transitionState === 'pending')) left = true;
        else if (!entryKey && snapshot.transitionState === 'idle' && JSON.stringify(snapshot.current.destination) === expected) entryKey = snapshot.current.key;
      };
      const unsubscribe = navigation.subscribe(observe);
      const pending = open(actionFocus.page, position);
      observe();
      if (actionFocus.action === 'open-saved-configs' || actionFocus.action === 'manage-model-files') { unsubscribe(); return; }
      void pending.then(result => {
        unsubscribe();
        const snapshot = navigation.getSnapshot();
        if (left || !entryKey || !['committed', 'unchanged'].includes(result.status) || snapshot.generation !== generation || snapshot.current.key !== entryKey) return;
        view = Object.freeze({ revision: view.revision + 1, intent: Object.freeze({ kind: 'focus-action', actionFocus, entryKey, generation }) });
        for (const listener of listeners) listener();
      });
    },
    subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); },
  });
}
