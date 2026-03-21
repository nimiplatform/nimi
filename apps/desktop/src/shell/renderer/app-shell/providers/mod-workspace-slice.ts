import type { AppStoreSet, AppStoreState } from './store-types';
import { MAX_OPEN_MOD_TABS, type OpenModWorkspaceTabResult } from './mod-workspace-policy';
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
  | 'runtimeModSources'
  | 'runtimeModDeveloperMode'
  | 'runtimeModDiagnostics'
  | 'runtimeModRecentReloads'
  | 'registeredRuntimeModIds'
  | 'runtimeModDisabledIds'
  | 'runtimeModUninstalledIds'
  | 'runtimeModSettingsById'
  | 'modWorkspaceTabs'
  | 'fusedRuntimeMods'
  | 'runtimeModFailures'
  | 'setLocalManifestSummaries'
  | 'setRuntimeModSources'
  | 'setRuntimeModDeveloperMode'
  | 'setRuntimeModDiagnostics'
  | 'pushRuntimeModReloadResults'
  | 'setRegisteredRuntimeModIds'
  | 'setRuntimeModDisabledIds'
  | 'setRuntimeModUninstalledIds'
  | 'setRuntimeModSettings'
  | 'openModWorkspaceTab'
  | 'closeModWorkspaceTab'
  | 'touchModWorkspaceTab'
  | 'markRuntimeModFused'
  | 'clearRuntimeModFuse'
  | 'setRuntimeModFailures'
>;

export function createModWorkspaceSlice(set: AppStoreSet): ModWorkspaceSlice {
  return {
    localManifestSummaries: [],
    runtimeModSources: [],
    runtimeModDeveloperMode: {
      enabled: false,
      autoReloadEnabled: false,
    },
    runtimeModDiagnostics: [],
    runtimeModRecentReloads: [],
    registeredRuntimeModIds: [],
    runtimeModDisabledIds: initialLifecycleState.disabledModIds,
    runtimeModUninstalledIds: initialLifecycleState.uninstalledModIds,
    runtimeModSettingsById: initialRuntimeModSettingsState,
    modWorkspaceTabs: [],
    fusedRuntimeMods: {},
    runtimeModFailures: [],
    setLocalManifestSummaries: (manifests) => set({ localManifestSummaries: manifests }),
    setRuntimeModSources: (sources) => set({ runtimeModSources: sources }),
    setRuntimeModDeveloperMode: (value) => set({ runtimeModDeveloperMode: value }),
    setRuntimeModDiagnostics: (records) => set({ runtimeModDiagnostics: records }),
    pushRuntimeModReloadResults: (records) =>
      set((state) => ({
        runtimeModRecentReloads: [
          ...state.runtimeModRecentReloads,
          ...records,
        ].slice(-100),
      })),
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
    openModWorkspaceTab: (tabId, title, modId) => {
      let result: OpenModWorkspaceTabResult = 'rejected-limit';
      set((state) => {
        const now = Date.now();
        const existing = state.modWorkspaceTabs.find((tab) => tab.tabId === tabId);
        if (existing) {
          result = 'activated-existing';
          return {
            activeTab: tabId,
            modWorkspaceTabs: state.modWorkspaceTabs.map((tab) => (
              tab.tabId === tabId
                ? { ...tab, title, modId, lastAccessedAt: now }
                : tab
            )),
          };
        }
        if (state.modWorkspaceTabs.length >= MAX_OPEN_MOD_TABS) {
          result = 'rejected-limit';
          return {};
        }
        result = 'opened';
        return {
          activeTab: tabId,
          modWorkspaceTabs: [
            ...state.modWorkspaceTabs,
            {
              tabId,
              modId,
              title,
              fused: Boolean(state.fusedRuntimeMods[modId]),
              lastAccessedAt: now,
            },
          ],
        };
      });
      return result;
    },
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
    touchModWorkspaceTab: (tabId) =>
      set((state) => {
        const now = Date.now();
        const found = state.modWorkspaceTabs.some((tab) => tab.tabId === tabId);
        if (!found) return {};
        return {
          modWorkspaceTabs: state.modWorkspaceTabs.map((tab) => (
            tab.tabId === tabId ? { ...tab, lastAccessedAt: now } : tab
          )),
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
