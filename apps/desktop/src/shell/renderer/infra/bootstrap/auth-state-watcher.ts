import { useAppStore } from '@renderer/app-shell/providers/app-store';
import type { AppStoreState } from '@renderer/app-shell/providers/app-store';
import { dataSync } from '@runtime/data-sync';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

type AuthSnapshot = { status: string; token: string; refreshToken: string };

function selectAuth(state: AppStoreState): AuthSnapshot {
  return { status: state.auth.status, token: state.auth.token, refreshToken: state.auth.refreshToken };
}

function authEqual(a: AuthSnapshot, b: AuthSnapshot): boolean {
  return a.status === b.status && a.token === b.token && a.refreshToken === b.refreshToken;
}

let unsubscribe: (() => void) | null = null;

export function startAuthStateWatcher() {
  if (unsubscribe) {
    return;
  }

  let prevAuth = selectAuth(useAppStore.getState());

  unsubscribe = useAppStore.subscribe((state: AppStoreState) => {
    const auth = selectAuth(state);
    if (authEqual(auth, prevAuth)) {
      return;
    }
    const prev = prevAuth;
    prevAuth = auth;

    if (auth.status === 'authenticated' && auth.token) {
      dataSync.setToken(auth.token);
      if (auth.refreshToken) {
        dataSync.setRefreshToken(auth.refreshToken);
      }
      if (auth.token !== prev.token) {
        dataSync.scheduleProactiveRefresh(auth.token);
      }
      // 首次登录时后台预加载社交联系人，确保 isFriend 检查在任何 profile 查看前可用
      if (prev.status !== 'authenticated') {
        void dataSync.loadSocialSnapshot().catch(() => {});
      }
    } else if (auth.status === 'anonymous' && prev.status !== 'anonymous') {
      dataSync.setToken('');
      dataSync.setRefreshToken('');
      dataSync.stopAllPolling();
      dataSync.clearProactiveRefreshTimer();
      logRendererEvent({
        level: 'info',
        area: 'auth-state-watcher',
        message: 'phase:auth-cleared:datasync-reset',
      });
    }
  });

  logRendererEvent({
    level: 'info',
    area: 'auth-state-watcher',
    message: 'phase:auth-state-watcher:started',
  });
}

export function stopAuthStateWatcher() {
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
}
