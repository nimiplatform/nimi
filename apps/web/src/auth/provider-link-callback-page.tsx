import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ReasonCode, createNimiError } from '@nimiplatform/sdk/types';
import { createWebBrowserRealm } from './browser-realm.js';
import {
  completeTikTokAccountOAuth,
  confirmCurrentWebBrowserSession,
} from './web-provider-link.js';
import { readValidatedOauthNext } from './oauth-continuation.js';

type PendingTwoFactor = { tempToken: string; oauthNext?: string };

function finishLogin(oauthNext: string | undefined, expiredMessage: string): void {
  if (!oauthNext) {
    window.location.replace('/account');
    return;
  }
  const validated = readValidatedOauthNext(`?oauth_next=${encodeURIComponent(oauthNext)}`);
  if (!validated || validated !== oauthNext) throw new Error(expiredMessage);
  window.location.assign(validated);
}

export function ProviderLinkCallbackPage() {
  const { t } = useTranslation();
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
        throw new Error(loginResult?.blockedReason || t('Account.tiktokLoginRejected'));
      }
      if (loginResult.loginState === 'needs_2fa') {
        const tempToken = String(loginResult.tempToken || '').trim();
        if (!tempToken) throw new Error(t('Account.twoFaTransactionMissing'));
        setTwoFactor({ tempToken, oauthNext: result.oauthNext });
        return;
      }
      finishLogin(result.oauthNext, t('Account.oauthContinuationExpired'));
    }).catch((reason) => {
      if (active) setError(reason instanceof Error ? reason.message : String(reason || t('Account.oauthLinkFailed')));
    });
    return () => { active = false; };
  }, [t]);
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
          message: t('Account.bearerForbidden'),
          reasonCode: ReasonCode.SDK_REALM_AUTH_RESPONSE_INVALID,
          actionHint: 'check_realm_auth_response',
          source: 'sdk',
        });
      }
      return confirmCurrentWebBrowserSession();
    }).then(() => {
      finishLogin(twoFactor.oauthNext, t('Account.oauthContinuationExpired'));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason || t('Account.twoFaFailed'))));
  };

  return (
    <main className="web-account-status" role={error ? 'alert' : 'status'}>
      <h1>{error ? t('Account.oauthFailedTitle') : twoFactor ? t('Account.enterTwoFaCode') : t('Account.completingOauth')}</h1>
      {twoFactor ? (
        <form onSubmit={verifyTwoFactor} className="web-account-form">
          <input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={t('Account.sixDigitCodePlaceholder')} />
          <button type="submit" disabled={code.length !== 6}>{t('Account.continue')}</button>
        </form>
      ) : null}
      {error ? <><p>{error}</p><Link to="/login">{t('Account.backToLogin')}</Link></> : null}
    </main>
  );
}
