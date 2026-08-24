import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  NIMI_REALM_OAUTH_PROVIDER,
  disableNimiRealmTwoFactor,
  enableNimiRealmTwoFactor,
  linkNimiRealmOAuth,
  prepareNimiRealmTwoFactor,
  unlinkNimiRealmOAuth,
  updateNimiRealmPassword,
} from '@nimiplatform/sdk/realm';
import { getGoogleClientId, requestGoogleIdToken } from '@nimiplatform/kit/auth';
import { createWebBrowserRealm } from './browser-realm.js';
import { beginTikTokAccountLink } from './web-provider-link.js';
import { loadWebCurrentAccount } from './web-account-adapter.js';

// @nimi-authority: rule.nimi.sdks.realm-consumer.r046
export function AccountManagementPage() {
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [twoFactorSetup, setTwoFactorSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const providers = new Set(Array.isArray(user?.oauthProviders) ? user.oauthProviders.map(String) : []);

  const refresh = async () => {
    setUser(await loadWebCurrentAccount());
  };
  useEffect(() => {
    void refresh()
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason || '无法确认账号会话'));
      })
      .finally(() => setChecking(false));
  }, []);
  const action = async (work: () => Promise<void>, success: string) => {
    setError(null);
    setMessage(null);
    try { await work(); setMessage(success); await refresh(); } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason || '账号操作失败'));
    }
  };

  if (checking) return <main className="web-account-status" role="status">正在确认安全会话…</main>;
  if (!user && error) {
    return (
      <main className="web-account-status" role="alert">
        <h1>无法确认账号会话</h1>
        <p>{error}</p>
        <Link to="/login">返回登录</Link>
      </main>
    );
  }
  if (!user) return <main className="web-account-status"><h1>需要登录</h1><Link to="/login">登录 Nimi</Link></main>;
  return (
    <main className="web-static-page">
      <Link to="/" className="web-wordmark">Nimi</Link>
      <section className="web-account-form">
        <h1>管理账号</h1>
        <p>{String(user.displayName || user.email || user.id || '当前账号')}</p>
        <form onSubmit={(e) => { e.preventDefault(); void action(async () => {
          if (password.length < 8) throw new Error('密码至少需要 8 位。');
          await updateNimiRealmPassword(createWebBrowserRealm(), { newPassword: password });
          setPassword('');
        }, '密码已更新。'); }}>
          <input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="新密码" />
          <button type="submit">更新密码</button>
        </form>
        <div className="web-account-actions">
          <button type="button" onClick={() => void action(async () => {
            const prepared = await prepareNimiRealmTwoFactor(createWebBrowserRealm());
            setTwoFactorSetup(prepared);
          }, '两步验证已准备，请输入验证码确认。')}>准备两步验证</button>
          {twoFactorSetup ? <p className="web-account-secret">{twoFactorSetup.secret}<br />{twoFactorSetup.otpauthUri}</p> : null}
          <input inputMode="numeric" value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="2FA 验证码" />
          <button type="button" onClick={() => void action(async () => {
            await enableNimiRealmTwoFactor(createWebBrowserRealm(), { code: twoFactorCode });
          }, '两步验证已启用。')}>启用 2FA</button>
          <button type="button" onClick={() => void action(async () => {
            await disableNimiRealmTwoFactor(createWebBrowserRealm(), { code: twoFactorCode });
          }, '两步验证已停用。')}>停用 2FA</button>
        </div>
        <div className="web-account-actions">
          {providers.has(NIMI_REALM_OAUTH_PROVIDER.GOOGLE) ? (
            <button type="button" onClick={() => void action(async () => {
              await unlinkNimiRealmOAuth(createWebBrowserRealm(), NIMI_REALM_OAUTH_PROVIDER.GOOGLE);
            }, 'Google 登录已解绑。')}>解绑 Google</button>
          ) : (
            <button type="button" onClick={() => void action(async () => {
              const clientId = getGoogleClientId();
              if (!clientId) throw new Error('Google 登录当前未配置。');
              const idToken = await requestGoogleIdToken(clientId);
              await linkNimiRealmOAuth(createWebBrowserRealm(), { provider: NIMI_REALM_OAUTH_PROVIDER.GOOGLE, idToken });
            }, 'Google 登录已绑定。')}>绑定 Google</button>
          )}
          {providers.has(NIMI_REALM_OAUTH_PROVIDER.TIKTOK) ? (
            <button type="button" onClick={() => void action(async () => {
              await unlinkNimiRealmOAuth(createWebBrowserRealm(), NIMI_REALM_OAUTH_PROVIDER.TIKTOK);
            }, 'TikTok 登录已解绑。')}>解绑 TikTok</button>
          ) : (
            <button type="button" onClick={() => void action(beginTikTokAccountLink, '正在打开 TikTok 授权。')}>绑定 TikTok</button>
          )}
        </div>
        <button type="button" onClick={() => void (async () => {
          setError(null);
          try {
            await createWebBrowserRealm('').auth.logout({ path: {}, body: {} });
            setUser(null);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason || '退出失败'));
          }
        })()}>退出 Web 账号</button>
        {message ? <p role="status">{message}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <nav><Link to="/account/recovery">账号恢复</Link><Link to="/">返回首页</Link></nav>
      </section>
    </main>
  );
}
