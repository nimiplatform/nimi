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
      refreshToken: '',
    },
    setAuthBootstrapping: () =>
      set((state) => ({
        auth: {
          ...state.auth,
          status: 'bootstrapping',
        },
      })),
    setAuthSession: (user, token, refreshToken) =>
      set({
        auth: {
          status: 'authenticated',
          user,
          token,
          refreshToken: refreshToken || '',
        },
      }),
    clearAuthSession: () =>
      set({
        auth: {
          status: 'anonymous',
          user: null,
          token: '',
          refreshToken: '',
        },
        selectedChatId: null,
      }),
  };
}
