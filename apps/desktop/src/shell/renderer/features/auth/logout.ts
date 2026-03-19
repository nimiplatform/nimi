import { dataSync } from '@runtime/data-sync';
import { queryClient } from '@renderer/infra/query-client/query-client';
import type { AppStoreState } from '@renderer/app-shell/providers/store-types';
import { clearPersistedAccessToken } from '@nimiplatform/shell-auth';

type LogoutAndClearSessionInput = {
  clearAuthSession: AppStoreState['clearAuthSession'];
  setStatusBanner: AppStoreState['setStatusBanner'];
};

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || '登出失败');
}

export async function logoutAndClearSession(input: LogoutAndClearSessionInput): Promise<void> {
  let logoutError: unknown = null;

  try {
    await dataSync.logout();
  } catch (error) {
    logoutError = error;
  }

  clearPersistedAccessToken();
  input.clearAuthSession();
  queryClient.clear();

  if (logoutError) {
    input.setStatusBanner({
      kind: 'warning',
      message: `已在本地退出，服务器登出失败：${toErrorMessage(logoutError)}`,
    });
    return;
  }

  input.setStatusBanner({ kind: 'info', message: '已退出登录' });
}
