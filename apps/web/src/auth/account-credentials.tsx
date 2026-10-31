import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronRight, KeyRound, ShieldCheck, Link2, Copy, Monitor } from 'lucide-react';
import {
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
import { loadWebCurrentAccount } from './web-account-adapter.js';
import { beginTikTokAccountLink } from './web-provider-link.js';
import { AccountFeedback, AccountHeading } from './account-center-layout.js';
import { useAccountCopy } from './account-center-copy.js';

export function AccountCredentials({
  user,
  onSaved,
}: {
  user: Record<string, unknown>;
  onSaved: (user: Record<string, unknown>) => void;
}) {
  const c = useAccountCopy();
  const { t } = useTranslation();
  const [oldPassword, setOldPassword] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [currentCode, setCurrentCode] = useState('');
  const [newCode, setNewCode] = useState('');
  const [setup, setSetup] = useState<NimiRealmTwoFactorPrepareOutput | null>(null);
  const [busy, setBusy] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const providers = new Set(
    Array.isArray(user.oauthProviders) ? user.oauthProviders.map(String) : [],
  );
  const twoFactor = user.isTwoFactorEnabled === true;
  async function action(work: () => Promise<void>, success: string, refreshAccount = true) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      if ((await loadWebCurrentAccount())?.id !== user.id) throw new Error(c('changed'));
      if (!active.current) return;
      await work();
      if (!active.current) return;
      setMessage(success);
      if (!refreshAccount) return;
      try {
        const next = await loadWebCurrentAccount();
        if (active.current && next) onSaved(next);
      } catch {
        if (active.current) setError(c('refreshedFailed'));
      }
    } catch (reason) {
      if (active.current) setError(reason instanceof Error ? reason.message : c('unavailable'));
    } finally {
      if (active.current) setBusy(false);
    }
  }
  if (passwordChanged) return <>
    <AccountHeading title={t('Account.passwordUpdated')} description={c('passwordSignInAgain')} />
    <Link to="/login?returnTo=%2Faccount%2Fsecurity">{t('Account.backToLogin')}</Link>
  </>;
  return (
    <>
      <AccountHeading title={c('security')} description={c('securityIntro')} />
      <AccountFeedback error={error} message={message} />
      <div className="ac-section ac-security-sections">
        <details className="ac-security-detail">
          <summary>
            <KeyRound size={22} />
            <span>
              <strong>{c('password')}</strong>
              <small>{c('passwordHint')}</small>
            </span>
            <ChevronRight size={18} />
          </summary>
          <form
            className="ac-detail-content"
            onSubmit={(event) => {
              event.preventDefault();
              void action(async () => {
                if (password !== repeat) throw new Error(c('passwordMismatch'));
                if (password.length < 12) throw new Error(t('Account.passwordTooShort'));
                await updateNimiRealmPassword(createWebBrowserRealm(), { newPassword: password, ...(user.hasPassword ? { oldPassword } : {}) });
                if (active.current) {
                  setPasswordChanged(true);
                  setOldPassword('');
                  setPassword('');
                  setRepeat('');
                }
              }, t('Account.passwordUpdated'), false);
            }}
          >
            {user.hasPassword === true && <label className="ac-field">
              <span>{c('oldPassword')}</span>
              <input type="password" autoComplete="current-password" required disabled={busy}
                value={oldPassword} onChange={event => setOldPassword(event.target.value)} />
            </label>}
            <label className="ac-field">
              <span>{c('newPassword')}</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="ac-field">
              <span>{c('repeatPassword')}</span>
              <input
                type="password"
                autoComplete="new-password"
                minLength={12}
                required
                value={repeat}
                onChange={(event) => setRepeat(event.target.value)}
                disabled={busy}
              />
            </label>
            <button className="ac-button" disabled={busy || !password || !repeat}>
              {t('Account.updatePassword')}
            </button>
          </form>
        </details>
        <details className="ac-security-detail">
          <summary>
            <ShieldCheck size={22} />
            <span>
              <strong>
                {c('twoFactor')}
                <small className={`ac-state${twoFactor ? ' is-enabled' : ''}`}>
                  {c(twoFactor ? 'enabled' : 'notEnabled')}
                </small>
              </strong>
              <small>{c('twoFactorHint')}</small>
            </span>
            <ChevronRight size={18} />
          </summary>
          <div className="ac-detail-content">
            {twoFactor ? (
              <label className="ac-field">
                <span>{t('Account.currentTwoFaCode')}</span>
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={currentCode}
                  onChange={(event) => setCurrentCode(event.target.value.replace(/\D/g, ''))}
                  disabled={busy}
                />
              </label>
            ) : null}
            {!setup ? (
              <div className="ac-actions">
                <button
                  className="ac-button"
                  type="button"
                  disabled={busy || (twoFactor && currentCode.length !== 6)}
                  onClick={() =>
                    void action(async () => {
                      const prepared = await prepareNimiRealmTwoFactor(
                        createWebBrowserRealm(),
                        twoFactor ? { code: currentCode } : {},
                      );
                      if (active.current) {
                        setSetup(prepared);
                        setNewCode('');
                      }
                    }, t('Account.twoFaPrepared'))
                  }
                >
                  {t(twoFactor ? 'Account.replaceTwoFa' : 'Account.prepareTwoFa')}
                </button>
                {twoFactor ? (
                  <button
                    className="ac-button ac-button--secondary"
                    type="button"
                    disabled={busy || currentCode.length !== 6}
                    onClick={() =>
                      void action(async () => {
                        await disableNimiRealmTwoFactor(createWebBrowserRealm(), {
                          code: currentCode,
                        });
                        if (active.current) {
                          setSetup(null);
                          setCurrentCode('');
                        }
                      }, t('Account.twoFaDisabled'))
                    }
                  >
                    {t('Account.disableTwoFa')}
                  </button>
                ) : null}
              </div>
            ) : (
              <div>
                <p>{c('setupHint')}</p>
                <label className="ac-field">
                  <span>{c('setupKey')}</span>
                  <div className="ac-secret">
                    <code>{setup.secret}</code>
                    <button
                      type="button"
                      className="ac-icon-button"
                      aria-label={c('copySetupKey')}
                      onClick={() => {
                        void navigator.clipboard
                          .writeText(setup.secret)
                          .catch(() => setError(c('copyFailed')));
                      }}
                    >
                      <Copy size={17} />
                    </button>
                  </div>
                </label>
                <label className="ac-field">
                  <span>{t('Account.newTwoFaCode')}</span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={6}
                    value={newCode}
                    onChange={(event) => setNewCode(event.target.value.replace(/\D/g, ''))}
                    disabled={busy}
                  />
                </label>
                <div className="ac-actions">
                  <button
                    className="ac-button"
                    type="button"
                    disabled={busy || newCode.length !== 6}
                    onClick={() =>
                      void action(async () => {
                        await enableNimiRealmTwoFactor(createWebBrowserRealm(), {
                          challengeId: setup.challengeId,
                          code: newCode,
                        });
                        if (active.current) {
                          setSetup(null);
                          setNewCode('');
                          setCurrentCode('');
                        }
                      }, t('Account.twoFaEnabled'))
                    }
                  >
                    {t('Account.confirmTwoFa')}
                  </button>
                  <button
                    className="ac-button ac-button--secondary"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setSetup(null);
                      setNewCode('');
                    }}
                  >
                    {c('cancel')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </details>
        <details className="ac-security-detail">
          <summary>
            <Link2 size={22} />
            <span>
              <strong>{c('connected')}</strong>
              <small>{c('connectedHint')}</small>
            </span>
            <ChevronRight size={18} />
          </summary>
          <div className="ac-detail-content">
            {(['GOOGLE', 'TIKTOK'] as const).map((provider) => (
              <div className="ac-setting-row" key={provider}>
                <div>
                  <strong>{provider === 'GOOGLE' ? 'Google' : 'TikTok'}</strong>
                  <small>{c(providers.has(provider) ? 'linked' : 'notLinked')}</small>
                </div>
                <button
                  type="button"
                  className="ac-button ac-button--secondary"
                  disabled={busy}
                  onClick={() =>
                    void action(
                      async () => {
                        if (providers.has(provider)) {
                          await unlinkNimiRealmOAuth(createWebBrowserRealm(), provider);
                          return;
                        }
                        if (provider === 'TIKTOK') {
                          await beginTikTokAccountLink(String(user.id));
                          return;
                        }
                        const clientId = getGoogleClientId();
                        if (!clientId) throw new Error(t('Account.googleNotConfigured'));
                        const idToken = await requestGoogleIdToken(clientId);
                        await linkNimiRealmOAuth(createWebBrowserRealm(), {
                          provider: 'GOOGLE', expectedAccountId: String(user.id),
                          idToken,
                        });
                      },
                      t(
                        provider === 'GOOGLE'
                          ? providers.has(provider)
                            ? 'Account.googleUnlinked'
                            : 'Account.googleLinked'
                          : providers.has(provider)
                            ? 'Account.tiktokUnlinked'
                            : 'Account.tiktokOpening',
                      ),
                    )
                  }
                >
                  {t(
                    provider === 'GOOGLE'
                      ? providers.has(provider)
                        ? 'Account.unlinkGoogle'
                        : 'Account.linkGoogle'
                      : providers.has(provider)
                        ? 'Account.unlinkTiktok'
                        : 'Account.linkTiktok',
                  )}
                </button>
              </div>
            ))}
          </div>
        </details>
      </div>
      <Link className="ac-shortcut ac-bottom-link" to="/account/sessions">
        <Monitor size={21} />
        <span>
          <strong>{c('sessionShortcut')}</strong>
        </span>
        <ChevronRight size={18} />
      </Link>
    </>
  );
}
