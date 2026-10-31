import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { createWebAccountAuthAdapter } from './web-account-adapter.js';
import { createWebBrowserRealm } from './browser-realm.js';

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

  return (
    <main className="web-static-page">
      <Link to="/" className="web-wordmark">Nimi</Link>
      <section className="web-account-form">
        <h1>{t('Account.recoverTitle')}</h1>
        {stage === 'done' ? <><p>{t('Account.passwordUpdated')}</p><Link to={{ pathname: '/login', search: window.location.search }}>{t('Account.backToLogin')}</Link></> : (
          <form onSubmit={submit}>
            {stage === 'email' ? <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t('Account.emailPlaceholder')} /> : null}
            {stage === 'verify' ? <input inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={t('Account.sixDigitCodePlaceholder')} /> : null}
            {stage === 'verify' ? <>
              <label>{t('Account.recoveryAuthenticator')}<input inputMode="numeric" pattern="[0-9]{6}" value={authenticator}
                onChange={e => setAuthenticator(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>
              <label>{t('Account.newPasswordPlaceholder')}<input type="password" autoComplete="new-password" required minLength={12}
                value={password} onChange={e => setPassword(e.target.value)} /></label>
              <button disabled={pending} type="button" onClick={() => { setStage('email'); setCode(''); setError(null); }}>{t('Account.requestNewRecoveryCode')}</button>
            </> : null}
            {error ? <p role="alert">{error}</p> : null}
            <button disabled={pending} type="submit">{pending ? t('Account.pleaseWait') : stage === 'verify' ? t('Account.updatePassword') : t('Account.continue')}</button>
          </form>
        )}
      </section>
    </main>
  );
}
