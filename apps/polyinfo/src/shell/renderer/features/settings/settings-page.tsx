import { useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPlatformClient } from '@nimiplatform/sdk';
import { persistSharedDesktopAuthSession } from '@nimiplatform/nimi-kit/auth';
import { clearAuthSession as clearPersistedAuthSession, getDaemonStatus, saveAuthSession } from '@renderer/bridge';
import { useAppStore } from '@renderer/app-shell/app-store.js';

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
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState('');

  const applyTokens = useCallback(async (tokens: Record<string, unknown>) => {
    const accessToken = String(tokens.accessToken || '').trim();
    const refreshToken = String(tokens.refreshToken || '').trim();
    const user = tokens.user as Record<string, unknown> | undefined;
    if (!accessToken || !user?.id) {
      throw new Error('登录返回不完整');
    }

    const normalizedUser = {
      id: String(user.id),
      displayName: String(user.displayName || user.name || '').trim(),
      email: user.email ? String(user.email) : undefined,
      avatarUrl: user.avatarUrl ? String(user.avatarUrl) : undefined,
    };

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

  const handleLogin = useCallback(async () => {
    if (!identifier.trim() || !password.trim()) return;
    setError('');
    setSubmitting(true);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  }, [applyTokens, identifier, password]);

  const handle2fa = useCallback(async () => {
    if (!twoFaCode.trim() || !tempToken) return;
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
    } catch (err) {
      setError(err instanceof Error ? err.message : '验证失败');
    } finally {
      setSubmitting(false);
    }
  }, [applyTokens, tempToken, twoFaCode]);

  const handleLogout = useCallback(async () => {
    clearAuthSession();
    await clearPersistedAuthSession();
  }, [clearAuthSession]);

  return (
    <section className="rounded-md border border-white/10 bg-slate-950/55 p-6">
      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Account</p>
      <h2 className="mt-2 text-lg font-semibold text-white">当前会话</h2>
      <div className="mt-5 space-y-3 text-sm text-slate-300">
        <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">状态</p>
          <p className="mt-2 text-white">{auth.status === 'authenticated' ? '已登录' : '游客模式'}</p>
        </div>
        <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">用户</p>
          <p className="mt-2 text-white">{auth.user?.displayName || auth.user?.email || '未登录'}</p>
        </div>
        <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
          <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Realm endpoint</p>
          <p className="mt-2 break-all text-white">{runtimeDefaults?.realm.realmBaseUrl || 'Unavailable'}</p>
        </div>
      </div>

      {auth.status === 'authenticated' ? (
        <div className="mt-5 rounded-md border border-white/8 bg-white/[0.03] p-4">
          <p className="text-sm text-slate-300">当前已经使用共享账号会话，关闭后下次会自动带出。</p>
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
          <p className="text-sm text-slate-300">
            不登录也能直接用。登录后会自动带出你的共享账号会话和对应数据。
          </p>
          {error ? <p className="mt-3 text-sm text-rose-300">{error}</p> : null}
          {!needs2fa ? (
            <div className="mt-4 space-y-3">
              <input
                type="text"
                value={identifier}
                onChange={(event) => setIdentifier(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleLogin();
                }}
                placeholder="Email or handle"
                className="w-full rounded-md border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-sky-300/50"
              />
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void handleLogin();
                }}
                placeholder="Password"
                className="w-full rounded-md border border-white/10 bg-slate-950/70 px-4 py-3 text-sm text-white outline-none focus:border-sky-300/50"
              />
              <button
                type="button"
                disabled={submitting || !identifier.trim() || !password.trim()}
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
                  if (event.key === 'Enter') void handle2fa();
                }}
                placeholder="000000"
                className="w-full rounded-md border border-white/10 bg-slate-950/70 px-4 py-3 text-center tracking-[0.3em] text-white outline-none focus:border-sky-300/50"
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
  const daemonStatusQuery = useQuery({
    queryKey: ['polyinfo', 'daemon-status'],
    queryFn: () => getDaemonStatus(),
    refetchInterval: 15_000,
    retry: false,
  });

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <AccountSessionPanel />

      <section className="rounded-md border border-white/10 bg-slate-950/55 p-6">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Runtime</p>
        <h2 className="mt-2 text-lg font-semibold text-white">模型运行状态</h2>
        <div className="mt-5 space-y-3 text-sm text-slate-300">
          <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Daemon</p>
            <p className="mt-2 text-white">
              {daemonStatusQuery.isLoading
                ? 'Checking…'
                : daemonStatusQuery.isError
                  ? 'Unavailable'
                  : daemonStatusQuery.data?.running
                    ? 'Running'
                    : 'Stopped'}
            </p>
          </div>
          <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Polymarket feed</p>
            <p className="mt-2 text-white">Tags / Events / Prices History + Market WebSocket</p>
          </div>
          <div className="rounded-md border border-white/8 bg-white/[0.03] p-4">
            <p className="text-xs uppercase tracking-[0.16em] text-slate-500">Analyst policy</p>
            <p className="mt-2 text-white">只使用盘口与已有结构，不引入新闻。</p>
          </div>
        </div>
      </section>
    </div>
  );
}
