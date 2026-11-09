import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';
import type { NimiAppSession, NimiAppSessionSnapshot, NimiAppScope } from '@nimiplatform/kit/core/app-session';

const SessionContext = createContext<NimiAppSession | null>(null);
export function NimiAppSessionProvider({ session, children }: { session: NimiAppSession; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
export function useNimiAppSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('NimiAppSessionProvider is required.');
  return { session, snapshot: useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot) };
}
const copy = {
  zh: { login: '使用 Nimi 账号登录', logout: '退出此应用', owner: '在 Nimi Home 管理账号', connect: '连接我的 Runtime',
    connecting: '正在连接主 Runtime；首次使用此来源时，请在 PC Home 确认。', cancel: '取消连接', check: '重新检查连接',
    signedIn: '已登录 Nimi', disconnect: '断开连接', disconnected: '尚未连接主 Runtime。请保持 PC 上的 Nimi Home 运行。',
    signedOut: '使用你的 Nimi 账号继续，无需创建另一个应用账号。', unavailable: '暂时无法确认当前账号，请检查 Nimi Home。',
    checking: '正在检查当前账号…', revocation: '重试结束此应用会话', connectionFailed: '连接未成功。',
    connectionHelp: '请确认主机上的 Nimi Home 正在运行，并检查远程接入后重试。', details: '技术详情' },
  en: { login: 'Sign in with Nimi', logout: 'Sign out of this App', owner: 'Manage account in Nimi Home', connect: 'Connect my Runtime',
    connecting: 'Connecting to your Runtime. For a new source, confirm it in PC Home.', cancel: 'Cancel connection', check: 'Check connection again',
    signedIn: 'Signed in to Nimi', disconnect: 'Disconnect', disconnected: 'Runtime is not connected. Keep Nimi Home running on your PC.',
    signedOut: 'Continue with your Nimi account. No separate App account is needed.', unavailable: 'Your account cannot be confirmed. Check Nimi Home.',
    checking: 'Checking your account…', revocation: 'Retry ending this App session', connectionFailed: 'Connection failed.',
    connectionHelp: 'Check that Nimi Home is running on your PC and review remote access, then try again.', details: 'Technical details' },
};
export function NimiAccountControl({ language = 'zh', hideSignedOut = false }: { language?: 'zh' | 'en'; hideSignedOut?: boolean }) {
  const { session, snapshot } = useNimiAppSession(); const text = copy[language];
  if (hideSignedOut && snapshot.identity.status !== 'signed-in') return null;
  return <div className="flex items-center gap-3 text-sm">
    {snapshot.identity.status === 'signed-in' && <span>{snapshot.identity.user?.displayName || text.signedIn}</span>}
    {snapshot.runtime.status === 'connected' && session.account.kind === 'app-session' && <>
      {snapshot.runtime.displayName && <span>{snapshot.runtime.displayName}</span>}
      <Button size="sm" tone="secondary" onClick={session.disconnectRuntime}>{text.disconnect}</Button>
    </>}
    {snapshot.identity.status === 'signed-in' && snapshot.runtime.status === 'connected' && snapshot.issue?.area === 'identity'
      && <span role="alert">{snapshot.issue.message}</span>}
    {session.account.kind === 'home-managed'
      ? <Button size="sm" tone="secondary" onClick={() => { if (session.account.kind === 'home-managed') void session.account.openAccountOwner(); }}>{text.owner}</Button>
      : <Button size="sm" disabled={snapshot.busy !== 'none'} onClick={() => { if (session.account.kind !== 'app-session') return;
        void (snapshot.identity.status === 'signed-in' || snapshot.pendingRevocation ? session.account.signOut() : session.account.signIn()); }}>
        {snapshot.pendingRevocation ? text.revocation : snapshot.identity.status === 'signed-in' ? text.logout : text.login}
      </Button>}
  </div>;
}
type GateProps = { language?: 'zh' | 'en'; title?: string; fallback?: (snapshot: NimiAppSessionSnapshot) => ReactNode } & (
  { requireRuntime?: true; children: (scope: NimiAppScope) => ReactNode } |
  { requireRuntime: false; children: ReactNode }
);
// @nimi-authority: rule.nimi.platform.ui-design-system.remote-app-session
export function NimiAppAccessGate(props: GateProps) {
  const { session, snapshot } = useNimiAppSession(), text = copy[props.language ?? 'zh'];
  if (snapshot.identity.status === 'signed-in') {
    if (props.requireRuntime === false) return <div key={snapshot.identity.viewKey} className="contents">{props.children}</div>;
    if (snapshot.runtime.status === 'connected') return <div key={`${snapshot.identity.viewKey}/${snapshot.runtime.scope.viewKey}`} className="contents">{props.children(snapshot.runtime.scope)}</div>;
  }
  if (props.fallback) return <>{props.fallback(snapshot)}</>;
  return <main className="m-auto flex max-w-xl flex-col gap-4 p-6"><Surface tone="panel" className="flex flex-col gap-4 p-6">
    {props.title && <h1 className="text-2xl font-semibold">{props.title}</h1>}
    <p role="status">{snapshot.identity.status === 'checking' ? text.checking : snapshot.identity.status === 'unavailable' ? text.unavailable
      : snapshot.identity.status === 'signed-out' ? text.signedOut : snapshot.runtime.status === 'connecting' ? text.connecting
        : snapshot.issue?.area === 'runtime' ? text.connectionFailed : text.disconnected}</p>
    {snapshot.issue && <InlineAlert tone="warning">
      <p>{snapshot.issue.area === 'runtime' && session.account.kind === 'app-session' ? text.connectionHelp : snapshot.issue.message}</p>
      <details className="mt-2"><summary>{text.details}</summary>
        {snapshot.issue.area === 'runtime' && session.account.kind === 'app-session' && <p className="mt-2 break-words">{snapshot.issue.message}</p>}
        <code className="block break-words">{snapshot.issue.reasonCode}</code>
        {snapshot.issue.actionHint && <code className="block break-words">{snapshot.issue.actionHint}</code>}
      </details>
    </InlineAlert>}
    {snapshot.identity.status === 'signed-in' ? <Button disabled={snapshot.busy !== 'none'} onClick={() => {
      if (snapshot.runtime.status === 'connecting') session.disconnectRuntime(); else void session.connectRuntime();
    }}>{snapshot.runtime.status === 'connecting' ? text.cancel : text.connect}</Button> : snapshot.identity.status === 'unavailable'
      ? <Button onClick={() => void session.recheck()}>{text.check}</Button> : null}
    {snapshot.identity.status !== 'signed-in' && <NimiAccountControl language={props.language} />}
  </Surface></main>;
}
export type { NimiAppSession, NimiAppSessionSnapshot, NimiAppScope } from '@nimiplatform/kit/core/app-session';
