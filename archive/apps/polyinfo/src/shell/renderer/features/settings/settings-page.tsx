import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { clearPlatformClient, getPlatformClient } from '@nimiplatform/sdk';
import { performDesktopWebAuth } from '@nimiplatform/kit/auth';
import { createTauriOAuthBridge } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import {
  loadTextGenerateRouteOptions,
  resolveTextGenerateRouteStatus,
} from '@renderer/data/runtime-routes.js';
import { runPolyinfoBootstrap } from '@renderer/infra/bootstrap/polyinfo-bootstrap.js';
import {
  createPolyinfoRuntimeAccountBrowserBroker,
  loadPolyinfoRuntimeAccountUser,
  logoutPolyinfoRuntimeAccount,
} from '@renderer/infra/bootstrap/polyinfo-runtime-account.js';

const tauriOAuthBridge = createTauriOAuthBridge();

function Field({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
      <p className="text-xs uppercase tracking-[0.16em] text-slate-500">{label}</p>
      <p className="mt-2 break-all text-sm text-white">{value}</p>
    </div>
  );
}

function AccountSessionPanel() {
  const auth = useAppStore((state) => state.auth);
  const runtimeDefaults = useAppStore((state) => state.runtimeDefaults);
  const setAuthSession = useAppStore((state) => state.setAuthSession);
  const clearAuthSession = useAppStore((state) => state.clearAuthSession);

  const [browserSubmitting, setBrowserSubmitting] = useState(false);
  const [logoutSubmitting, setLogoutSubmitting] = useState(false);
  const [error, setError] = useState('');

  const handleDesktopBrowserLogin = useCallback(async () => {
    setBrowserSubmitting(true);
    setError('');
    try {
      await performDesktopWebAuth(tauriOAuthBridge, {
        runtimeAccountBroker: createPolyinfoRuntimeAccountBrowserBroker(),
      });
      const user = await loadPolyinfoRuntimeAccountUser(getPlatformClient().runtime);
      if (user) {
        setAuthSession(user, '', '');
      } else {
        clearAuthSession();
      }
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setBrowserSubmitting(false);
    }
  }, [clearAuthSession, setAuthSession]);

  const handleLogout = useCallback(async () => {
    setLogoutSubmitting(true);
    setError('');
    try {
      await logoutPolyinfoRuntimeAccount();
    } catch (logoutError) {
      setError(logoutError instanceof Error ? logoutError.message : '退出登录失败');
    } finally {
      clearAuthSession();
      clearPlatformClient();
      await runPolyinfoBootstrap();
      setLogoutSubmitting(false);
    }
  }, [clearAuthSession]);

  return (
    <section className="rounded-md border border-white/10 bg-slate-950/55 p-6">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Account</p>
      <h2 className="mt-2 text-lg font-semibold text-white">账号会话</h2>
      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <Field label="状态" value={auth.status === 'authenticated' ? '已登录' : '游客模式'} />
        <Field label="当前用户" value={auth.user?.displayName || auth.user?.email || '未登录'} />
        <Field label="Realm" value={runtimeDefaults?.realm.realmBaseUrl || '空'} />
      </div>

      {auth.status === 'authenticated' ? (
        <div className="mt-5 rounded-md border border-white/8 bg-white/[0.03] p-4">
          <p className="text-sm leading-6 text-slate-300">
            当前已经通过 Runtime 登录。云端聊天会使用这份登录状态。
          </p>
          <button
            type="button"
            disabled={logoutSubmitting}
            onClick={() => void handleLogout()}
            className="mt-4 rounded-md bg-white/8 px-4 py-3 text-sm text-slate-200 hover:bg-white/12 disabled:opacity-50"
          >
            {logoutSubmitting ? '正在退出…' : '退出登录'}
          </button>
        </div>
      ) : (
        <div className="mt-5 rounded-md border border-white/8 bg-white/[0.03] p-4">
          <p className="text-sm leading-6 text-slate-300">
            不登录也能继续用本地模型。要调用云端连接器，请先通过 Runtime 登录。
          </p>
          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
          <div className="mt-4 rounded-md border border-sky-300/20 bg-sky-300/10 p-4">
            <p className="text-sm font-medium text-sky-50">推荐方式</p>
            <p className="mt-2 text-sm leading-6 text-sky-100/90">
              打开浏览器完成登录。登录材料由 Runtime 保存，Polyinfo 只读取当前登录状态。
            </p>
            <button
              type="button"
              disabled={browserSubmitting}
              onClick={() => void handleDesktopBrowserLogin()}
              className="mt-4 w-full rounded-md bg-sky-400 px-4 py-3 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              {browserSubmitting ? '正在打开浏览器…' : '像 Desktop 一样登录'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

export function SettingsPage() {
  const runtimeDefaults = useAppStore((state) => state.runtimeDefaults);
  const aiConfig = useAppStore((state) => state.aiConfig);
  const auth = useAppStore((state) => state.auth);
  const snapshotsBySector = useAppStore((state) => state.snapshotsBySector);
  const chatsBySector = useAppStore((state) => state.chatsBySector);

  const routeOptionsQuery = useQuery({
    queryKey: ['polyinfo', 'settings-route-options', JSON.stringify(aiConfig.capabilities.selectedBindings['text.generate'] || null)],
    queryFn: () => loadTextGenerateRouteOptions({ aiConfig, runtimeDefaults }),
    staleTime: 15_000,
    retry: false,
  });

  const routeStatus = useMemo(() => resolveTextGenerateRouteStatus({
    aiConfig,
    runtimeDefaults,
    routeOptions: routeOptionsQuery.data,
    authStatus: auth.status,
  }), [aiConfig, auth.status, routeOptionsQuery.data, runtimeDefaults]);

  return (
    <div className="space-y-4">
      <AccountSessionPanel />

      <section className="rounded-md border border-white/10 bg-slate-950/55 p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Runtime</p>
        <h2 className="mt-2 text-lg font-semibold text-white">聊天当前走的配置</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="当前路由" value={routeStatus.title} />
          <Field label="当前说明" value={routeStatus.detail} />
          <Field
            label="当前来源"
            value={routeStatus.source === 'selected'
              ? '手动选择'
              : routeStatus.source === 'runtime-default'
                ? 'runtime 默认'
                : routeStatus.source === 'fallback'
                  ? '可用回退'
                  : '未配置'}
          />
          <Field label="默认本地模型" value={runtimeDefaults?.runtime.localProviderModel || '空'} />
          <Field label="默认连接器" value={runtimeDefaults?.runtime.connectorId || '空'} />
        </div>
        {routeOptionsQuery.isError ? (
          <p className="mt-4 text-sm text-rose-300">
            运行配置读取失败：{routeOptionsQuery.error instanceof Error ? routeOptionsQuery.error.message : 'unknown error'}
          </p>
        ) : null}
        <Link
          to="/runtime"
          className="mt-5 inline-flex rounded-md bg-sky-400 px-4 py-3 text-sm font-medium text-slate-950"
        >
          打开 Runtime 页面
        </Link>
      </section>

      <section className="rounded-md border border-white/10 bg-slate-950/55 p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Storage</p>
        <h2 className="mt-2 text-lg font-semibold text-white">Polyinfo 自己保存的数据</h2>
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          <Field label="Sector 线程数" value={String(Object.keys(chatsBySector).length)} />
          <Field
            label="分析快照数"
            value={String(Object.values(snapshotsBySector).reduce((sum, items) => sum + items.length, 0))}
          />
          <Field label="启动默认 Realm" value={runtimeDefaults?.realm.realmBaseUrl || '空'} />
        </div>
      </section>
    </div>
  );
}
