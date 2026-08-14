import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ReasonCode, createNimiError } from '@nimiplatform/sdk/types';
import { createWebBrowserRealm } from './browser-realm.js';
import {
  completeTikTokAccountOAuth,
  confirmCurrentWebBrowserSession,
} from './web-provider-link.js';
import { readValidatedOauthNext } from './oauth-continuation.js';

type PendingTwoFactor = { tempToken: string; oauthNext?: string };

function finishLogin(oauthNext?: string): void {
  if (!oauthNext) {
    window.location.replace('/account');
    return;
  }
  const validated = readValidatedOauthNext(`?oauth_next=${encodeURIComponent(oauthNext)}`);
  if (!validated || validated !== oauthNext) throw new Error('OAuth continuation 已失效。');
  window.location.assign(validated);
}

export function ProviderLinkCallbackPage() {
  const [error, setError] = useState<string | null>(null);
  const [twoFactor, setTwoFactor] = useState<PendingTwoFactor | null>(null);
  const [code, setCode] = useState('');
  useEffect(() => {
    let active = true;
    void completeTikTokAccountOAuth(window.location.search).then((result) => {
      if (!active) return;
      if (result.mode === 'link') {
        window.location.replace('/account');
        return;
      }
      const loginResult = result.loginResult;
      if (!loginResult || loginResult.loginState === 'blocked') {
        throw new Error(loginResult?.blockedReason || 'Realm 拒绝了 TikTok 登录。');
      }
      if (loginResult.loginState === 'needs_2fa') {
        const tempToken = String(loginResult.tempToken || '').trim();
        if (!tempToken) throw new Error('Realm 未返回两步验证事务。');
        setTwoFactor({ tempToken, oauthNext: result.oauthNext });
        return;
      }
      finishLogin(result.oauthNext);
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason || 'OAuth 绑定失败'));
    });
    return () => { active = false; };
  }, []);
  const verifyTwoFactor = (event: FormEvent) => {
    event.preventDefault();
    if (!twoFactor || code.length !== 6) return;
    setError(null);
    void createWebBrowserRealm('').auth.verify2Fa({
      path: {},
      body: { tempToken: twoFactor.tempToken, code },
    }).then((response) => {
      if (response && typeof response === 'object' && ('accessToken' in response || 'refreshToken' in response)) {
        throw createNimiError({
          message: 'Realm 向 Web browser session 返回了禁止的 bearer。',
          reasonCode: ReasonCode.SDK_REALM_AUTH_RESPONSE_INVALID,
          actionHint: 'check_realm_auth_response',
          source: 'sdk',
        });
      }
      return confirmCurrentWebBrowserSession();
    }).then(() => {
      finishLogin(twoFactor.oauthNext);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason || '两步验证失败')));
  };

  return (
    <main className="web-account-status" role={error ? 'alert' : 'status'}>
      <h1>{error ? 'OAuth 操作失败' : twoFactor ? '输入两步验证码' : '正在完成 OAuth…'}</h1>
      {twoFactor ? (
        <form onSubmit={verifyTwoFactor} className="web-account-form">
          <input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 位验证码" />
          <button type="submit" disabled={code.length !== 6}>继续</button>
        </form>
      ) : null}
      {error ? <><p>{error}</p><Link to="/login">返回登录</Link></> : null}
    </main>
  );
}
