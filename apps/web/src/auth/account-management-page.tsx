import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  NIMI_REALM_OAUTH_PROVIDER,
  disableNimiRealmTwoFactor,
  enableNimiRealmTwoFactor,
  linkNimiRealmOAuth,
  prepareNimiRealmTwoFactor,
  unlinkNimiRealmOAuth,
  updateNimiRealmPassword,
  type NimiRealmTwoFactorPrepareOutput,
} from '@nimiplatform/sdk/realm';
import { getGoogleClientId, requestGoogleIdToken } from '@nimiplatform/kit/auth';
import { createWebBrowserRealm } from './browser-realm.js';
import { beginTikTokAccountLink } from './web-provider-link.js';
import { loadWebCurrentAccount } from './web-account-adapter.js';

// @nimi-authority: rule.nimi.sdks.realm-consumer.r046
export function AccountManagementPage() {
  const { t } = useTranslation();
  const [user, setUser] = useState<Record<string, unknown> | null>(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [currentTwoFactorCode, setCurrentTwoFactorCode] = useState('');
  const [twoFactorSetup, setTwoFactorSetup] = useState<NimiRealmTwoFactorPrepareOutput | null>(null);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const providers = new Set(Array.isArray(user?.oauthProviders) ? user.oauthProviders.map(String) : []);
  const twoFactorEnabled = user?.isTwoFactorEnabled === true;

  const refresh = async () => {
    setUser(await loadWebCurrentAccount());
  };
  useEffect(() => {
    void refresh()
      .catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason || t('Account.sessionUnknown')));
      })
      .finally(() => setChecking(false));
  }, [t]);
  const action = async (work: () => Promise<void>, success: string) => {
    if (working) return;
    setWorking(true);
    setError(null);
    setMessage(null);
    try { await work(); setMessage(success); await refresh(); } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason || t('Account.actionFailed')));
    } finally {
      setWorking(false);
    }
  };

  if (checking) return <main className="web-account-status" role="status">{t('Account.sessionCheck')}</main>;
  if (!user && error) {
    return (
      <main className="web-account-status" role="alert">
        <h1>{t('Account.sessionUnknown')}</h1>
        <p>{error}</p>
        <Link to="/login">{t('Account.backToLogin')}</Link>
      </main>
    );
  }
  if (!user) return <main className="web-account-status"><h1>{t('Account.loginRequired')}</h1><Link to="/login">{t('Account.loginNimi')}</Link></main>;
  return (
    <main className="web-static-page">
      <Link to="/" className="web-wordmark">Nimi</Link>
      <section className="web-account-form">
        <h1>{t('Account.manageAccount')}</h1>
        <p>{String(user.displayName || user.email || user.id || t('Account.currentAccountFallback'))}</p>
        <form onSubmit={(e) => { e.preventDefault(); void action(async () => {
          if (password.length < 8) throw new Error(t('Account.passwordTooShort'));
          await updateNimiRealmPassword(createWebBrowserRealm(), { newPassword: password });
          setPassword('');
        }, t('Account.passwordUpdated')); }}>
          <input type="password" minLength={8} required value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('Account.newPasswordPlaceholder')} />
          <button type="submit">{t('Account.updatePassword')}</button>
        </form>
        <div className="web-account-actions">
          {twoFactorEnabled ? <label>
            {t('Account.currentTwoFaCode')}
            <input inputMode="numeric" autoComplete="one-time-code" value={currentTwoFactorCode} onChange={(e) => setCurrentTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
          </label> : null}
          <button type="button" disabled={working || (twoFactorEnabled && currentTwoFactorCode.length !== 6)} onClick={() => void action(async () => {
            const prepared = await prepareNimiRealmTwoFactor(createWebBrowserRealm(), twoFactorEnabled ? { code: currentTwoFactorCode } : {});
            setTwoFactorSetup(prepared);
            setTwoFactorCode('');
          }, t('Account.twoFaPrepared'))}>{t(twoFactorEnabled ? 'Account.replaceTwoFa' : 'Account.prepareTwoFa')}</button>
          {twoFactorSetup ? <>
            <p className="web-account-secret">{twoFactorSetup.secret}<br />{twoFactorSetup.otpauthUri}</p>
            <label>{t('Account.newTwoFaCode')}
              <input inputMode="numeric" autoComplete="one-time-code" value={twoFactorCode} onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, '').slice(0, 6))} />
            </label>
            <button type="button" disabled={working || twoFactorCode.length !== 6} onClick={() => void action(async () => {
              await enableNimiRealmTwoFactor(createWebBrowserRealm(), { challengeId: twoFactorSetup.challengeId, code: twoFactorCode });
              setTwoFactorSetup(null);
              setTwoFactorCode('');
              setCurrentTwoFactorCode('');
            }, t('Account.twoFaEnabled'))}>{t('Account.confirmTwoFa')}</button>
          </> : null}
          {twoFactorEnabled ? <button type="button" disabled={working || currentTwoFactorCode.length !== 6} onClick={() => void action(async () => {
            await disableNimiRealmTwoFactor(createWebBrowserRealm(), { code: currentTwoFactorCode });
            setTwoFactorSetup(null);
            setTwoFactorCode('');
            setCurrentTwoFactorCode('');
          }, t('Account.twoFaDisabled'))}>{t('Account.disableTwoFa')}</button> : null}
        </div>
        <div className="web-account-actions">
          {providers.has(NIMI_REALM_OAUTH_PROVIDER.GOOGLE) ? (
            <button type="button" onClick={() => void action(async () => {
              await unlinkNimiRealmOAuth(createWebBrowserRealm(), NIMI_REALM_OAUTH_PROVIDER.GOOGLE);
            }, t('Account.googleUnlinked'))}>{t('Account.unlinkGoogle')}</button>
          ) : (
            <button type="button" onClick={() => void action(async () => {
              const clientId = getGoogleClientId();
              if (!clientId) throw new Error(t('Account.googleNotConfigured'));
              const idToken = await requestGoogleIdToken(clientId);
              await linkNimiRealmOAuth(createWebBrowserRealm(), { provider: NIMI_REALM_OAUTH_PROVIDER.GOOGLE, idToken });
            }, t('Account.googleLinked'))}>{t('Account.linkGoogle')}</button>
          )}
          {providers.has(NIMI_REALM_OAUTH_PROVIDER.TIKTOK) ? (
            <button type="button" onClick={() => void action(async () => {
              await unlinkNimiRealmOAuth(createWebBrowserRealm(), NIMI_REALM_OAUTH_PROVIDER.TIKTOK);
            }, t('Account.tiktokUnlinked'))}>{t('Account.unlinkTiktok')}</button>
          ) : (
            <button type="button" onClick={() => void action(beginTikTokAccountLink, t('Account.tiktokOpening'))}>{t('Account.linkTiktok')}</button>
          )}
        </div>
        <button type="button" onClick={() => void (async () => {
          setError(null);
          try {
            await createWebBrowserRealm('').auth.logout({ path: {}, body: {} });
            setUser(null);
          } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason || t('Account.logoutFailed')));
          }
        })()}>{t('Account.logout')}</button>
        {message ? <p role="status">{message}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <nav><Link to="/account/recovery">{t('Account.accountRecovery')}</Link><Link to="/">{t('Account.backHome')}</Link></nav>
      </section>
    </main>
  );
}
