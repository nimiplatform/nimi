import type { AppStoreSet, AppStoreState } from '../store-types';

type AuthSlice = Pick<AppStoreState,
  'auth'
  | 'setAuthBootstrapping'
  | 'setAuthSession'
  | 'clearAuthSession'
>;

export function createAuthSlice(set: AppStoreSet): AuthSlice {
  return {
    auth: {
      status: 'bootstrapping',
      user: null,
      token: '',
    },
    setAuthBootstrapping: () =>
      set((state) => ({
        auth: {
          ...state.auth,
          status: 'bootstrapping',
        },
      })),
    setAuthSession: (user, token) =>
      set({
        auth: {
          status: 'authenticated',
          user,
          token,
        },
      }),
    clearAuthSession: () =>
      set({
        auth: {
          status: 'anonymous',
          user: null,
          token: '',
        },
        selectedChatId: null,
      }),
  };
}
