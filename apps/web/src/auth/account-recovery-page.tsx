import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createWebAccountAuthAdapter } from './web-account-adapter.js';
import { createWebBrowserRealm } from './browser-realm.js';
import './account-center.css';

export function AccountRecoveryPage() {
  const { t } = useTranslation();
  const adapter = useMemo(() => createWebAccountAuthAdapter(), []);
  const [stage, setStage] = useState<'email' | 'verify' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [authenticator, setAuthenticator] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try { await work(); } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason || t('Account.recoveryFailed')));
    } finally { setPending(false); }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (stage === 'email') {
      void run(async () => {
        const result = await adapter.requestEmailOtp(email.trim());
        if (!result.success) throw new Error(result.message || t('Account.otpSendFailed'));
        setStage('verify');
      });
    } else if (stage === 'verify') {
      void run(async () => {
        await createWebBrowserRealm().generated.recoverPassword({ path: {}, body: {
          email: email.trim(), code, newPassword: password, ...(authenticator ? { authenticatorCode: authenticator } : {}),
        } });
        setPassword(''); setCode(''); setAuthenticator('');
        setStage('done');
      });
    }
  };

  const loginSearch = typeof window === 'undefined' ? '' : window.location.search;

  return (
    <main className="web-static-page ac-entry">
      <Link to="/" className="web-wordmark ac-brand">
        <img src="/logo.svg" alt="" width={28} height={28} />
        <span>Nimi</span>
      </Link>
      <section className="web-account-form ac-section">
        <h1>{t('Account.recoverTitle')}</h1>
        {stage === 'done' ? (
          <>
            <p>{t('Account.passwordUpdated')}</p>
            <Link className="ac-button" to={{ pathname: '/login', search: loginSearch }}>
              {t('Account.backToLogin')}
            </Link>
          </>
        ) : (
          <form onSubmit={submit}>
            {stage === 'email' ? (
              <label className="ac-field">
                <span>{t('Account.emailPlaceholder')}</span>
                <input
                  type="email"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('Account.emailPlaceholder')}
                />
              </label>
            ) : null}
            {stage === 'verify' ? (
              <>
                <label className="ac-field">
                  <span>{t('Account.sixDigitCodePlaceholder')}</span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    autoFocus
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder={t('Account.sixDigitCodePlaceholder')}
                  />
                </label>
                <label className="ac-field">
                  <span>{t('Account.recoveryAuthenticator')}</span>
                  <input
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    value={authenticator}
                    onChange={(e) => setAuthenticator(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  />
                </label>
                <label className="ac-field">
                  <span>{t('Account.newPasswordPlaceholder')}</span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={12}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </label>
                <button
                  disabled={pending}
                  type="button"
                  className="ac-button ac-button--secondary"
                  onClick={() => {
                    setStage('email');
                    setCode('');
                    setError(null);
                  }}
                >
                  {t('Account.requestNewRecoveryCode')}
                </button>
              </>
            ) : null}
            {error ? <p className="ac-feedback ac-feedback--error" role="alert">{error}</p> : null}
            <button disabled={pending} type="submit" className="ac-button">
              {pending ? t('Account.pleaseWait') : stage === 'verify' ? t('Account.updatePassword') : t('Account.continue')}
            </button>
            <Link className="ac-text-link" to={{ pathname: '/login', search: loginSearch }}>
              {t('Account.backToLogin')}
            </Link>
          </form>
        )}
      </section>
    </main>
  );
}
