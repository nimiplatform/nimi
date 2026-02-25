import type { AppStoreSet, AppStoreState } from '../store-types';
import {
  loadRuntimeModLifecycleState,
  loadRuntimeModSettingsState,
  persistRuntimeModLifecycleState,
  persistRuntimeModSettingsState,
} from './runtime-mod-preferences';

const initialLifecycleState = loadRuntimeModLifecycleState();
const initialRuntimeModSettingsState = loadRuntimeModSettingsState();

function normalizeModIds(modIds: string[]): string[] {
  const deduped = new Set<string>();
  for (const modId of modIds) {
    const normalizedModId = String(modId || '').trim();
    if (!normalizedModId) continue;
    deduped.add(normalizedModId);
  }
  return Array.from(deduped.values()).sort();
}

type ModWorkspaceSlice = Pick<AppStoreState,
  | 'localManifestSummaries'
  | 'registeredRuntimeModIds'
  | 'runtimeModDisabledIds'
  | 'runtimeModUninstalledIds'
  | 'runtimeModSettingsById'
  | 'modWorkspaceTabs'
  | 'fusedRuntimeMods'
  | 'runtimeModFailures'
  | 'setLocalManifestSummaries'
  | 'setRegisteredRuntimeModIds'
  | 'setRuntimeModDisabledIds'
  | 'setRuntimeModUninstalledIds'
  | 'setRuntimeModSettings'
  | 'openModWorkspaceTab'
  | 'closeModWorkspaceTab'
  | 'markRuntimeModFused'
  | 'clearRuntimeModFuse'
  | 'setRuntimeModFailures'
>;

export function createModWorkspaceSlice(set: AppStoreSet): ModWorkspaceSlice {
  return {
    localManifestSummaries: [],
    registeredRuntimeModIds: [],
    runtimeModDisabledIds: initialLifecycleState.disabledModIds,
    runtimeModUninstalledIds: initialLifecycleState.uninstalledModIds,
    runtimeModSettingsById: initialRuntimeModSettingsState,
    modWorkspaceTabs: [],
    fusedRuntimeMods: {},
    runtimeModFailures: [],
    setLocalManifestSummaries: (manifests) => set({ localManifestSummaries: manifests }),
    setRegisteredRuntimeModIds: (modIds) => set({ registeredRuntimeModIds: [...modIds] }),
    setRuntimeModDisabledIds: (modIds) =>
      set((state) => {
        const runtimeModDisabledIds = normalizeModIds(modIds);
        persistRuntimeModLifecycleState({
          disabledModIds: runtimeModDisabledIds,
          uninstalledModIds: state.runtimeModUninstalledIds,
        });
        return {
          runtimeModDisabledIds,
        };
      }),
    setRuntimeModUninstalledIds: (modIds) =>
      set((state) => {
        const runtimeModUninstalledIds = normalizeModIds(modIds);
        persistRuntimeModLifecycleState({
          disabledModIds: state.runtimeModDisabledIds,
          uninstalledModIds: runtimeModUninstalledIds,
        });
        return {
          runtimeModUninstalledIds,
        };
      }),
    setRuntimeModSettings: (modId, settings) =>
      set((state) => {
        const normalizedModId = String(modId || '').trim();
        if (!normalizedModId) return {};
        const nextRuntimeModSettingsById = {
          ...state.runtimeModSettingsById,
          [normalizedModId]: settings,
        };
        persistRuntimeModSettingsState(nextRuntimeModSettingsById);
        return {
          runtimeModSettingsById: nextRuntimeModSettingsById,
        };
      }),
    openModWorkspaceTab: (tabId, title, modId) =>
      set((state) => {
        const existing = state.modWorkspaceTabs.find((tab) => tab.tabId === tabId);
        if (existing) {
          return {
            activeTab: tabId,
            modWorkspaceTabs: state.modWorkspaceTabs.map((tab) => (
              tab.tabId === tabId
                ? { ...tab, title, modId }
                : tab
            )),
          };
        }
        return {
          activeTab: tabId,
          modWorkspaceTabs: [
            ...state.modWorkspaceTabs,
            {
              tabId,
              modId,
              title,
              fused: Boolean(state.fusedRuntimeMods[modId]),
            },
          ],
        };
      }),
    closeModWorkspaceTab: (tabId) =>
      set((state) => {
        const nextTabs = state.modWorkspaceTabs.filter((tab) => tab.tabId !== tabId);
        if (state.activeTab !== tabId) {
          return { modWorkspaceTabs: nextTabs };
        }
        const fallback = (nextTabs[nextTabs.length - 1]?.tabId || 'chat') as AppStoreState['activeTab'];
        return {
          modWorkspaceTabs: nextTabs,
          activeTab: fallback,
        };
      }),
    markRuntimeModFused: (modId, error, reason) =>
      set((state) => ({
        fusedRuntimeMods: {
          ...state.fusedRuntimeMods,
          [modId]: {
            reason: String(reason || 'render-failed'),
            lastError: String(error || 'unknown error'),
            at: new Date().toISOString(),
          },
        },
        modWorkspaceTabs: state.modWorkspaceTabs.map((tab) => (
          tab.modId === modId
            ? { ...tab, fused: true }
            : tab
        )),
      })),
    clearRuntimeModFuse: (modId) =>
      set((state) => {
        const next = { ...state.fusedRuntimeMods };
        delete next[modId];
        return {
          fusedRuntimeMods: next,
          modWorkspaceTabs: state.modWorkspaceTabs.map((tab) => (
            tab.modId === modId
              ? { ...tab, fused: false }
              : tab
          )),
        };
      }),
    setRuntimeModFailures: (failures) =>
      set((state) => {
        const nextFused = { ...state.fusedRuntimeMods };
        for (const failure of failures) {
          nextFused[failure.modId] = {
            reason: failure.stage,
            lastError: failure.error,
            at: new Date().toISOString(),
          };
        }
        const failedIds = new Set(failures.map((item) => item.modId));
        return {
          runtimeModFailures: [...failures],
          fusedRuntimeMods: nextFused,
          modWorkspaceTabs: state.modWorkspaceTabs.map((tab) => (
            failedIds.has(tab.modId)
              ? { ...tab, fused: true }
              : tab
          )),
        };
      }),
  };
}
