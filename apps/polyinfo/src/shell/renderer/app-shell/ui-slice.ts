import type { AppStoreSet, AppStoreState } from './store-types.js';

type UiSlice = Pick<AppStoreState,
  'bootstrapReady'
  | 'bootstrapError'
  | 'setBootstrapReady'
  | 'setBootstrapError'
>;

export function createUiSlice(set: AppStoreSet): UiSlice {
  return {
    bootstrapReady: false,
    bootstrapError: null,
    setBootstrapReady: (ready) => set({ bootstrapReady: ready }),
    setBootstrapError: (error) => set({ bootstrapError: error }),
  };
}
