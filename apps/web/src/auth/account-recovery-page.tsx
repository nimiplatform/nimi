import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { createWebAccountAuthAdapter } from './web-account-adapter.js';

export function AccountRecoveryPage() {
  const adapter = useMemo(() => createWebAccountAuthAdapter(), []);
  const [stage, setStage] = useState<'email' | 'verify' | 'password' | 'done'>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setPending(true);
    setError(null);
    try { await work(); } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason || '账号恢复失败'));
    } finally { setPending(false); }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (stage === 'email') {
      void run(async () => {
        const result = await adapter.requestEmailOtp(email.trim());
        if (!result.success) throw new Error(result.message || '验证码发送失败');
        setStage('verify');
      });
    } else if (stage === 'verify') {
      void run(async () => {
        const result = await adapter.verifyEmailOtp(email.trim(), code.trim());
        if (result.tokens != null || result.loginState !== 'ok') {
          throw new Error('此账号需要通过完整登录流程完成附加验证。');
        }
        const user = await adapter.loadCurrentUser();
        if (!user) throw new Error('Realm 未确认账号恢复会话。');
        setStage('password');
      });
    } else if (stage === 'password') {
      void run(async () => {
        if (password.length < 8) throw new Error('密码至少需要 8 位。');
        await adapter.updatePassword(password);
        setStage('done');
      });
    }
  };

  return (
    <main className="web-static-page">
      <Link to="/" className="web-wordmark">Nimi</Link>
      <section className="web-account-form">
        <h1>恢复账号</h1>
        {stage === 'done' ? <><p>密码已更新。</p><Link to="/login">返回登录</Link></> : (
          <form onSubmit={submit}>
            {stage === 'email' ? <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="邮箱" /> : null}
            {stage === 'verify' ? <input inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6 位验证码" /> : null}
            {stage === 'password' ? <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="新密码" /> : null}
            {error ? <p role="alert">{error}</p> : null}
            <button disabled={pending} type="submit">{pending ? '请稍候…' : stage === 'password' ? '更新密码' : '继续'}</button>
          </form>
        )}
      </section>
    </main>
  );
}
