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
    connecting: '正在连接主 Runtime…', waitingForPc: '等待电脑响应。首次使用此来源时，请在电脑的 Nimi Home 中确认。', cancel: '取消连接', check: '重新检查连接',
    signedIn: '已登录 Nimi', disconnect: '断开连接', disconnected: '尚未连接主 Runtime。请保持电脑上的 Nimi Home 运行。',
    signedOut: '使用你的 Nimi 账号继续，无需单独创建应用账号。', unavailable: '暂时无法确认当前账号，请检查 Nimi Home。',
    cancelLogin: '取消登录', checking: '正在检查当前账号…', revocation: '重试结束此应用会话', connectionFailed: '连接未成功。',
    connectionHelp: '请确认电脑上的 Nimi Home 正在运行，并检查远程接入后重试。',
    primaryNotBound: '请先在电脑的 Nimi Home 绑定此账号的主 Runtime。',
    sourceNotAllowed: '请在电脑的 Nimi Home 检查此应用的来源许可。',
    sourcePaused: '此应用的来源已暂停。请联系应用开发者，恢复后可重新连接。',
    sourceNotAdmitted: '此应用当前未获准接入 Nimi。请联系应用开发者检查接入配置。', details: '技术详情' },
  en: { login: 'Sign in with Nimi', logout: 'Sign out of this App', owner: 'Manage account in Nimi Home', connect: 'Connect my Runtime',
    connecting: 'Connecting to your Runtime…', waitingForPc: 'Waiting for your PC. For a new source, confirm it in Nimi Home on your PC.', cancel: 'Cancel connection', check: 'Check connection again',
    signedIn: 'Signed in to Nimi', disconnect: 'Disconnect', disconnected: 'Runtime is not connected. Keep Nimi Home running on your PC.',
    signedOut: 'Continue with your Nimi account. No separate App account is needed.', unavailable: 'Your account cannot be confirmed. Check Nimi Home.',
    cancelLogin: 'Cancel sign-in', checking: 'Checking your account…', revocation: 'Retry ending this App session', connectionFailed: 'Connection failed.',
    connectionHelp: 'Check that Nimi Home is running on your PC and review remote access, then try again.',
    primaryNotBound: 'Bind a primary Runtime for this account in Nimi Home on your PC.',
    sourceNotAllowed: 'Check this App’s source permission in Nimi Home on your PC.',
    sourcePaused: 'This App’s source is paused. Contact its developer and reconnect after it is restored.',
    sourceNotAdmitted: 'This App is not currently approved to connect to Nimi. Contact its developer to check the access configuration.', details: 'Technical details' },
};
export function NimiAccountControl({ language = 'zh', hideSignedOut = false }: { language?: 'zh' | 'en'; hideSignedOut?: boolean }) {
  const { session, snapshot } = useNimiAppSession(); const text = copy[language];
  if (hideSignedOut && snapshot.identity.status !== 'signed-in') return null;
  return <div className="flex items-center gap-3 text-sm">
    {snapshot.busy === 'sign-in' && <Button size="sm" tone="secondary" onClick={session.cancelSignIn}>{text.cancelLogin}</Button>}
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
type GateProps = { language?: 'zh' | 'en'; title?: string; externalAccountControl?: boolean; fallback?: (snapshot: NimiAppSessionSnapshot) => ReactNode } & (
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
  const sourceHelp: Record<string, string> = {
    RUNTIME_CLIENT_NOT_ADMITTED: text.sourceNotAdmitted,
    RUNTIME_CLIENT_SOURCE_PAUSED: text.sourcePaused,
    PRIMARY_RUNTIME_NOT_BOUND: text.primaryNotBound,
    SOURCE_NOT_ALLOWED: text.sourceNotAllowed,
  };
  const issueHelp = snapshot.issue && (Object.hasOwn(sourceHelp, snapshot.issue.reasonCode)
    ? sourceHelp[snapshot.issue.reasonCode]
    : snapshot.issue.area === 'runtime' && session.account.kind === 'app-session' ? text.connectionHelp : null);
  return <main className="m-auto flex max-w-xl flex-col gap-4 p-6"><Surface tone="panel" className="flex flex-col gap-4 p-6">
    {props.title && <h1 className="text-2xl font-semibold">{props.title}</h1>}
    <p role="status">{snapshot.identity.status === 'checking' ? text.checking : snapshot.identity.status === 'unavailable' ? text.unavailable
      : snapshot.identity.status === 'signed-out' ? text.signedOut : snapshot.runtime.status === 'connecting'
        ? (snapshot.runtime.stage === 'waiting-for-pc' ? text.waitingForPc : text.connecting)
        : snapshot.issue?.area === 'runtime' ? text.connectionFailed : text.disconnected}</p>
    {snapshot.issue && <InlineAlert tone="warning">
      <p>{issueHelp ?? snapshot.issue.message}</p>
      <details className="mt-2"><summary>{text.details}</summary>
        {issueHelp && <p className="mt-2 break-words">{snapshot.issue.message}</p>}
        <code className="block break-words">{snapshot.issue.reasonCode}</code>
        {snapshot.issue.actionHint && <code className="block break-words">{snapshot.issue.actionHint}</code>}
      </details>
    </InlineAlert>}
    {snapshot.identity.status === 'signed-in' ? <Button disabled={snapshot.busy !== 'none'} onClick={() => {
      if (snapshot.runtime.status === 'connecting') session.disconnectRuntime(); else void session.connectRuntime();
    }}>{snapshot.runtime.status === 'connecting' ? text.cancel : text.connect}</Button> : snapshot.identity.status === 'unavailable'
      ? <Button onClick={() => void session.recheck()}>{text.check}</Button> : null}
    {(snapshot.identity.status !== 'signed-in' || !props.externalAccountControl) && <NimiAccountControl language={props.language} />}
  </Surface></main>;
}
export type { NimiAppSession, NimiAppSessionSnapshot, NimiAppScope } from '@nimiplatform/kit/core/app-session';
