import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { clearPlatformClient, getPlatformClient } from '@nimiplatform/sdk';
import { performDesktopWebAuth, persistSharedDesktopAuthSession } from '@nimiplatform/nimi-kit/auth';
import {
  clearAuthSession as clearPersistedAuthSession,
  createTauriOAuthBridge,
  saveAuthSession,
} from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/app-store.js';
import {
  loadTextGenerateRouteOptions,
  resolveTextGenerateRouteStatus,
} from '@renderer/data/runtime-routes.js';
import { runPolyinfoBootstrap } from '@renderer/infra/bootstrap/polyinfo-bootstrap.js';
import {
  applyPolyinfoAccessTokenSession,
  normalizePolyinfoAuthUser,
} from './auth-session.js';

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

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [twoFaCode, setTwoFaCode] = useState('');
  const [tempToken, setTempToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [browserSubmitting, setBrowserSubmitting] = useState(false);
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState('');

  const applyTokens = useCallback(async (tokens: Record<string, unknown>) => {
    const accessToken = String(tokens.accessToken || '').trim();
    const refreshToken = String(tokens.refreshToken || '').trim();
    const user = tokens.user as Record<string, unknown> | undefined;
    if (!accessToken) {
      throw new Error('登录返回不完整');
    }
    const normalizedUser = normalizePolyinfoAuthUser(user);

    getPlatformClient().realm.updateAuth({
      accessToken: () => accessToken,
      refreshToken: () => refreshToken,
    });
    setAuthSession(normalizedUser, accessToken, refreshToken);

    const realmBaseUrl = runtimeDefaults?.realm.realmBaseUrl;
    if (realmBaseUrl) {
      await persistSharedDesktopAuthSession({
        realmBaseUrl,
        accessToken,
        refreshToken,
        user: normalizedUser,
        saveSession: (session) => saveAuthSession(session),
        clearSession: () => clearPersistedAuthSession(),
      });
    }
  }, [runtimeDefaults?.realm.realmBaseUrl, setAuthSession]);

  const handleDesktopBrowserLogin = useCallback(async () => {
    setBrowserSubmitting(true);
    setError('');
    try {
      const result = await performDesktopWebAuth(tauriOAuthBridge);
      const realmBaseUrl = String(runtimeDefaults?.realm.realmBaseUrl || '').trim();
      if (!realmBaseUrl) {
        throw new Error('缺少 Realm 地址');
      }
      await applyPolyinfoAccessTokenSession({
        realm: getPlatformClient().realm,
        accessToken: result.accessToken,
        setAuthSession,
        persistSession: async (session) => {
          await persistSharedDesktopAuthSession({
            realmBaseUrl,
            accessToken: session.accessToken,
            refreshToken: session.refreshToken,
            user: session.user,
            saveSession: (payload) => saveAuthSession(payload),
            clearSession: () => clearPersistedAuthSession(),
          });
        },
      });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setBrowserSubmitting(false);
    }
  }, [runtimeDefaults?.realm.realmBaseUrl, setAuthSession]);

  const handleLogin = useCallback(async () => {
    if (!identifier.trim() || !password.trim()) {
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const { realm } = getPlatformClient();
      const data = await realm.services.AuthService.passwordLogin({
        identifier: identifier.trim(),
        password,
      }) as Record<string, unknown>;

      const state = String(data.loginState || '');
      if (state === 'blocked') {
        setError(String(data.blockedReason || '账户不可用'));
        return;
      }
      if (state === 'needs_2fa') {
        setTempToken(String(data.tempToken || ''));
        setNeeds2fa(true);
        return;
      }

      const tokens = data.tokens as Record<string, unknown> | undefined;
      await applyTokens(tokens ?? data);
      setIdentifier('');
      setPassword('');
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  }, [applyTokens, identifier, password]);

  const handle2fa = useCallback(async () => {
    if (!tempToken || twoFaCode.length < 6) {
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      const { realm } = getPlatformClient();
      const data = await realm.services.AuthService.verifyTwoFactor({
        tempToken,
        code: twoFaCode.trim(),
      }) as Record<string, unknown>;
      await applyTokens(data);
      setNeeds2fa(false);
      setTwoFaCode('');
      setTempToken('');
      setIdentifier('');
      setPassword('');
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : '验证失败');
    } finally {
      setSubmitting(false);
    }
  }, [applyTokens, tempToken, twoFaCode]);

  const handleLogout = useCallback(async () => {
    clearAuthSession();
    await clearPersistedAuthSession();
    clearPlatformClient();
    await runPolyinfoBootstrap();
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
            当前已经使用共享登录态。云端聊天会直接复用这份会话。
          </p>
          <button
            type="button"
            onClick={() => void handleLogout()}
            className="mt-4 rounded-md bg-white/8 px-4 py-3 text-sm text-slate-200 hover:bg-white/12"
          >
            退出登录
          </button>
        </div>
      ) : (
        <div className="mt-5 rounded-md border border-white/8 bg-white/[0.03] p-4">
          <p className="text-sm leading-6 text-slate-300">
            不登录也能继续用本地模型。要调用云端连接器，请先登录；这里会像 Desktop 一样复用同一份登录态。
          </p>
          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
          <div className="mt-4 rounded-md border border-sky-300/20 bg-sky-300/10 p-4">
            <p className="text-sm font-medium text-sky-50">推荐方式</p>
            <p className="mt-2 text-sm leading-6 text-sky-100/90">
              直接走和 Desktop 一样的浏览器登录流程。登录完成后，Polyinfo 会自动接管这份会话。
            </p>
            <button
              type="button"
              disabled={browserSubmitting || submitting}
              onClick={() => void handleDesktopBrowserLogin()}
              className="mt-4 w-full rounded-md bg-sky-400 px-4 py-3 text-sm font-medium text-slate-950 disabled:opacity-50"
            >
              {browserSubmitting ? '正在打开浏览器…' : '像 Desktop 一样登录'}
            </button>
          </div>
          <div className="mt-4 border-t border-white/8 pt-4">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">备用方式</p>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              如果当前环境不方便走浏览器，也可以继续用账号密码登录。
            </p>
          </div>
          {!needs2fa ? (
            <div className="mt-4 space-y-3">
              <input
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleLogin();
                  }
                }}
                placeholder="Email or handle"
                className="w-full rounded-md border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handleLogin();
                  }
                }}
                placeholder="Password"
                className="w-full rounded-md border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none"
              />
              <button
                type="button"
                disabled={browserSubmitting || submitting || !identifier.trim() || !password.trim()}
                onClick={() => void handleLogin()}
                className="w-full rounded-md bg-sky-400 px-4 py-3 text-sm font-medium text-slate-950 disabled:opacity-50"
              >
                {submitting ? '正在登录…' : '登录'}
              </button>
            </div>
          ) : (
            <div className="mt-4 space-y-3">
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={twoFaCode}
                onChange={(event) => setTwoFaCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    void handle2fa();
                  }
                }}
                placeholder="000000"
                className="w-full rounded-md border border-white/10 bg-slate-950/70 px-4 py-3 text-center tracking-[0.3em] text-white outline-none"
              />
              <button
                type="button"
                disabled={submitting || twoFaCode.length < 6}
                onClick={() => void handle2fa()}
                className="w-full rounded-md bg-sky-400 px-4 py-3 text-sm font-medium text-slate-950 disabled:opacity-50"
              >
                {submitting ? '正在验证…' : '验证'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setNeeds2fa(false);
                  setTwoFaCode('');
                  setTempToken('');
                  setError('');
                }}
                className="w-full rounded-md bg-white/8 px-4 py-3 text-sm text-slate-300 hover:bg-white/12"
              >
                返回
              </button>
            </div>
          )}
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
