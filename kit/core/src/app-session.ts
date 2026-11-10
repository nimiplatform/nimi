import { createNimiError, extractNimiErrorFields, matchesRuntimeClientCallback } from './sdk-contract.js';
import type { prepareRuntimeClientLogin, completeRuntimeClientLogin, connectRemoteRuntime,
  RuntimeClientIdentity, RuntimeClientLoginOptions, RuntimeClientSession, NimiLocalAppClient,
  NimiAppRuntimeClient, RemoteRuntimeAppConnection, RemoteRuntimeConnectOptions } from './sdk-contract.js';

export type NimiAppIdentity = Readonly<{ displayName: string; handle?: string; avatarUrl?: string | null }>;
export type NimiAppScope<TClient extends NimiAppRuntimeClient = NimiAppRuntimeClient> = Readonly<{ client: TClient; signal: AbortSignal; viewKey: string }>;
export type NimiAppSessionSnapshot<TClient extends NimiAppRuntimeClient = NimiAppRuntimeClient> = Readonly<{
  identity: { status: 'checking' | 'signed-out' | 'unavailable' } | {
    status: 'signed-in'; user: NimiAppIdentity | null; viewKey: string; signal: AbortSignal;
  };
  runtime: { status: 'disconnected' | 'unavailable' } | { status: 'connecting'; stage?: Parameters<NonNullable<RemoteRuntimeConnectOptions['onState']>>[0] }
    | { status: 'connected'; scope: NimiAppScope<TClient>; displayName?: string };
  busy: 'none' | 'sign-in' | 'sign-out';
  issue: { area: 'identity' | 'runtime'; message: string; reasonCode: string; actionHint?: string } | null;
  pendingRevocation: boolean;
}>;
export type NimiAppAccountBinding = {
  current(): { contextKey: string; expectedNimiAccountId?: string } | null;
  subscribe(listener: () => void): () => void;
  /** Verified SDK result for this captured website session, not a server-side
   * credential. A website backend must independently verify its association. */
  onVerifiedIdentity?(identity: Readonly<RuntimeClientIdentity>, contextKey: string): void | Promise<void>;
};
export type NimiRemoteAppConfig = Omit<RuntimeClientLoginOptions, 'currentUserContext'> & {
  accountBinding?: NimiAppAccountBinding;
  autoConnect?: boolean;
};
export type NimiRemoteAppPlatform = {
  kind: 'remote'; config: NimiRemoteAppConfig;
  sourceKind: 'web' | 'android-app-link' | 'android-dev-scheme';
  verifySource?(source: Awaited<ReturnType<RuntimeClientSession['read']>>['source']): Promise<void>;
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  callbackUrl(): string;
  navigate(url: string): void | Promise<void>;
  clearCallback(): void;
  prepare: typeof prepareRuntimeClientLogin;
  complete: typeof completeRuntimeClientLogin;
  connect: typeof connectRemoteRuntime;
};
export type NimiDesktopAppPlatform = {
  kind: 'desktop'; client: NimiLocalAppClient;
  openAccountOwner(): Promise<void>;
};

export type NimiAppSession<TClient extends NimiAppRuntimeClient = NimiAppRuntimeClient> = Readonly<{
  getSnapshot(): NimiAppSessionSnapshot<TClient>;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  acceptCallback(url: string): Promise<boolean>;
  recheck(): Promise<void>;
  connectRuntime(): Promise<void>;
  cancelSignIn(): void;
  disconnectRuntime(): void;
  account: { kind: 'app-session'; signIn(): Promise<void>; signOut(): Promise<void> }
    | { kind: 'home-managed'; openAccountOwner(): Promise<void> };
  dispose(): void;
}>;

// @nimi-authority: rule.nimi.platform.ui-design-system.remote-app-session
/** One consumer lifetime; SDK/Host own identity and permissions. Platform
 * factories supply these ports so ordinary Apps do not implement them. */
export function createNimiAppSession(platform: NimiDesktopAppPlatform): NimiAppSession<NimiLocalAppClient>;
export function createNimiAppSession(platform: NimiRemoteAppPlatform): NimiAppSession;
export function createNimiAppSession(platform: NimiRemoteAppPlatform | NimiDesktopAppPlatform): NimiAppSession;
export function createNimiAppSession(platform: NimiRemoteAppPlatform | NimiDesktopAppPlatform): NimiAppSession {
  let snapshot: NimiAppSessionSnapshot = { identity: { status: 'checking' }, runtime: { status: 'disconnected' }, busy: 'none', issue: null, pendingRevocation: false };
  let session: RuntimeClientSession | null = null;
  let peer: RemoteRuntimeAppConnection | null = null;
  let identityScope: AbortController | null = null, runtimeScope: AbortController | null = null, pending: AbortController | null = null;
  let identityKey = 0, connectionKey = 0, operation = 0, readOperation = 0, disposed = false, generation: string | null = null;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  let removeInvalidation: (() => void) | undefined;
  let started: Promise<void> | undefined;
  let completingCallback: number | null = null;
  const listeners = new Set<() => void>();
  const transactionKey = platform.kind === 'remote' ? `nimi.remote-app.${platform.config.clientId}.login` : '';
  const currentUser = () => disposed ? null : platform.kind === 'remote' && platform.config.accountBinding
    ? platform.config.accountBinding.current()?.contextKey ?? null : generation;
  const options = () => {
    if (platform.kind !== 'remote') throw new Error('Remote login is unavailable on this Host.');
    return { ...platform.config, currentUserContext: currentUser };
  };
  function publish(next: Partial<NimiAppSessionSnapshot>) {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...next });
    for (const listener of listeners) listener();
  }
  function report(error: unknown, area: 'identity' | 'runtime') {
    const fields = extractNimiErrorFields(error);
    publish({ issue: { area, message: error instanceof Error ? error.message : String(error),
      reasonCode: fields.reasonCode || 'KIT_APP_CONNECTION_FAILED', ...(fields.actionHint ? { actionHint: fields.actionHint } : {}) } });
  }
  function clearRuntime() {
    operation++; pending?.abort(); pending = null;
    runtimeScope?.abort(); runtimeScope = null;
    const previous = peer; peer = null; previous?.close();
    publish({ runtime: { status: 'disconnected' } });
  }
  function clearIdentity(status: 'signed-out' | 'unavailable' = 'signed-out') {
    clearTimeout(expiry); expiry = undefined;
    removeInvalidation?.(); removeInvalidation = undefined;
    identityScope?.abort(); identityScope = null;
    clearRuntime(); publish({ identity: { status }, busy: 'none' });
  }
  function identify(user: NimiAppIdentity | null) {
    identityScope ??= new AbortController();
    if (snapshot.identity.status !== 'signed-in') identityKey++;
    publish({ identity: { status: 'signed-in', user, signal: identityScope.signal, viewKey: `identity-${identityKey}` }, busy: 'none' });
  }
  function connected(client: NimiAppRuntimeClient, displayName?: string) {
    runtimeScope = new AbortController();
    publish({ runtime: { status: 'connected', scope: { client, signal: runtimeScope.signal, viewKey: `connection-${++connectionKey}` }, displayName }, issue: null });
  }
  function watchIdentity(verified: RuntimeClientSession) {
    const invalid = () => { if (session === verified) clearIdentity(); };
    verified.signal.addEventListener('abort', invalid, { once: true });
    removeInvalidation = () => verified.signal.removeEventListener('abort', invalid);
    expiry = setTimeout(() => { if (session === verified && !verified.active) invalid(); }, Math.max(0, Date.parse(verified.identity.expiresAt) - Date.now()));
    (expiry as unknown as { unref?: () => void }).unref?.();
  }
  async function connectRuntime() {
    if (disposed || pending || snapshot.runtime.status === 'connected') return;
    if (platform.kind === 'desktop') { await recheck(); return; }
    if (!session?.active) { clearIdentity(); return; }
    const verified = session, current = ++operation;
    const controller = new AbortController(); pending = controller;
    publish({ runtime: { status: 'connecting' }, issue: null });
    try {
      const connection = await platform.connect(verified, { signal: controller.signal, onState(stage) {
        if (disposed || current !== operation) return;
        if (stage === 'closed') {
          runtimeScope?.abort(); runtimeScope = null; peer = null;
          publish({ runtime: { status: 'disconnected' } });
        } else if (stage !== 'connected') publish({ runtime: { status: 'connecting', stage } });
      } });
      if (disposed || current !== operation || !verified.active) { connection.close(); return; }
      if (connection.role !== 'app') { connection.close(); throw createNimiError({ message: 'This entry requires an ordinary App source.', reasonCode: 'KIT_REMOTE_APP_SOURCE_REQUIRED', source: 'sdk' }); }
      if (connection.closed) { publish({ runtime: { status: 'disconnected' } }); return; }
      peer = connection; connected(connection, connection.primary.displayName);
    } catch (error) {
      if (!disposed && current === operation) { publish({ runtime: { status: 'unavailable' } }); report(error, 'runtime'); }
    } finally { if (pending === controller) pending = null; }
  }
  async function signOut() {
    clearIdentity(); generation = null;
    if (platform.kind !== 'remote') return;
    platform.storage.removeItem(transactionKey);
    publish({ busy: 'sign-out', issue: null });
    try { await session?.end(); session = null; publish({ pendingRevocation: false }); }
    catch (error) { publish({ pendingRevocation: true }); report(error, 'identity'); }
    finally { publish({ busy: 'none' }); }
  }
  async function signIn() {
    if (disposed || platform.kind !== 'remote' || snapshot.busy !== 'none') return;
    clearIdentity(); const current = ++operation;
    publish({ busy: 'sign-in', issue: null });
    try {
      generation = null; await session?.end(); session = null;
      publish({ pendingRevocation: false });
      generation = crypto.randomUUID();
      const prepared = await platform.prepare(options(), platform.config.accountBinding?.current()?.expectedNimiAccountId);
      if (disposed || current !== operation) return;
      platform.storage.setItem(transactionKey, JSON.stringify(prepared.transaction));
      await platform.navigate(prepared.authorizationUrl);
    } catch (error) {
      if (!disposed && current === operation) { publish({ busy: 'none', pendingRevocation: session !== null }); report(error, 'identity'); }
    }
  }
  async function recheck() {
    // Initial pageshow/focus can arrive while the official callback exchange is
    // still running. It must not cancel that attempt for having no session yet.
    if (disposed || snapshot.busy !== 'none') return;
    const current = operation, read = ++readOperation;
    if (platform.kind === 'desktop') {
      try {
        const status = await platform.client.auth.status();
        if (disposed || current !== operation || read !== readOperation) return;
        if (!status.sessionBound) {
          clearIdentity(status.state === 'unavailable' ? 'unavailable' : 'signed-out');
          publish({ runtime: { status: 'unavailable' } });
          report(createNimiError({ message: 'Check your Nimi Home account and App access.', reasonCode: status.reasonCode, actionHint: status.actionHint, source: 'runtime' }), 'runtime'); return;
        }
        const user = await platform.client.currentUser.get().catch(error => {
          if (extractNimiErrorFields(error).reasonCode === 'SDK_LOCAL_APP_CURRENT_USER_UNAVAILABLE') return null;
          throw error;
        });
        if (disposed || current !== operation || read !== readOperation) return;
        publish({ issue: null }); identify(user);
        if (snapshot.runtime.status !== 'connected') connected(platform.client);
      } catch (error) { if (!disposed && current === operation && read === readOperation) { clearIdentity('unavailable'); publish({ runtime: { status: 'unavailable' } }); report(error, 'runtime'); } }
      return;
    }
    if (!session?.active) { clearIdentity(); return; }
    const verified = session;
    try {
      const state = await verified.read();
      if (disposed || current !== operation || read !== readOperation || verified !== session) return;
      publish({ issue: null });
      if (state.source.role !== 'app' || state.source.kind !== platform.sourceKind) { await signOut(); throw createNimiError({ message: 'This entry requires an ordinary App source.', reasonCode: 'KIT_REMOTE_APP_SOURCE_REQUIRED', source: 'sdk' }); }
    } catch (error) {
      if (disposed || session !== verified || read !== readOperation) return;
      if (!verified.active) clearIdentity();
      if (extractNimiErrorFields(error).reasonCode === 'RUNTIME_CLIENT_SOURCE_PAUSED') {
        clearRuntime();
        publish({ runtime: { status: 'unavailable' } });
        report(error, 'runtime');
      } else report(error, 'identity');
    }
  }
  async function initialize() {
    if (platform.kind === 'desktop') { await recheck(); return; }
    if (!await acceptCallback(platform.callbackUrl()) && snapshot.identity.status === 'checking' && completingCallback !== operation) publish({ identity: { status: 'signed-out' } });
  }
  /** Receives an OS callback without reloading the renderer. A handled URL is
   * not an authenticated identity; consumers observe the verified snapshot. */
  async function acceptCallback(url: string): Promise<boolean> {
    if (disposed || platform.kind !== 'remote' || completingCallback === operation || snapshot.identity.status === 'signed-in') return false;
    let callback: URL;
    try { callback = new URL(url); } catch { return false; }
    if (!matchesRuntimeClientCallback(url, platform.config.redirectUri)
      || (!callback.searchParams.has('code') && !callback.searchParams.has('error'))) return false;
    const saved = platform.storage.getItem(transactionKey);
    // A previous browser attempt can return while a new native preflight is
    // still preparing. There is no current callback to consume yet.
    if (!saved && snapshot.busy === 'sign-in') return false;
    // Unrelated deep links and delayed callbacks must not consume the current attempt.
    let transaction: unknown;
    try { transaction = saved ? JSON.parse(saved) : null; } catch { transaction = null; }
    if (transaction && typeof transaction === 'object' && 'state' in transaction
      && callback.searchParams.get('state') !== transaction.state) return false;
    platform.storage.removeItem(transactionKey); platform.clearCallback();
    const current = ++operation;
    completingCallback = current;
    publish({ busy: 'sign-in', issue: null });
    try {
      if (!saved) throw createNimiError({ message: 'The sign-in attempt expired. Sign in again.', reasonCode: 'KIT_REMOTE_APP_LOGIN_EXPIRED', source: 'sdk' });
      const transaction = JSON.parse(saved);
      if (!platform.config.accountBinding) generation = transaction.applicationUserContext;
      const verified = await platform.complete(options(), transaction, url);
      if (disposed || current !== operation) { await verified.end(); return true; }
      session = verified;
      watchIdentity(verified);
      // Source qualification is checked even for identity-only consumers.
      const state = await verified.read();
      if (state.source.role !== 'app' || state.source.kind !== platform.sourceKind) throw createNimiError({ message: 'This entry requires an ordinary App source.', reasonCode: 'KIT_REMOTE_APP_SOURCE_REQUIRED', source: 'sdk' });
      const owner = currentUser();
      await platform.verifySource?.(state.source);
      if (disposed || current !== operation || !verified.active || owner !== currentUser()) { await verified.end(); return true; }
      if (platform.config.accountBinding?.onVerifiedIdentity && owner) await platform.config.accountBinding.onVerifiedIdentity(verified.identity, owner);
      if (disposed || current !== operation || !verified.active || owner !== currentUser()) { await verified.end(); return true; }
      identify({ displayName: verified.identity.displayName });
      if (platform.config.autoConnect !== false) await connectRuntime();
    } catch (error) {
      if (!disposed && current === operation) { clearIdentity(); generation = null;
        publish({ busy: 'sign-out' });
        try { await session?.end(); session = null; } catch { publish({ pendingRevocation: true }); }
        publish({ busy: 'none' }); report(error, 'identity');
      }
    } finally { if (completingCallback === current) completingCallback = null; }
    return true;
  }
  const unsubscribe = platform.kind === 'remote' ? platform.config.accountBinding?.subscribe(() => {
    const next = platform.config.accountBinding?.current();
    if (!session || !session.active || (next?.expectedNimiAccountId && next.expectedNimiAccountId !== session.identity.accountId)) void signOut();
  }) : undefined;
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    start: () => started ??= initialize(), acceptCallback, recheck, connectRuntime,
    cancelSignIn() {
      if (platform.kind !== 'remote' || snapshot.busy !== 'sign-in') return;
      clearIdentity(); generation = null; platform.storage.removeItem(transactionKey);
    },
    disconnectRuntime() { clearRuntime(); publish({ issue: null }); },
    account: platform.kind === 'remote' ? { kind: 'app-session' as const, signIn, signOut }
      : { kind: 'home-managed' as const, async openAccountOwner() { try { await platform.openAccountOwner(); } catch (error) { report(error, 'identity'); } } },
    dispose() { clearIdentity(); disposed = true; generation = null; unsubscribe?.(); listeners.clear(); void session?.end().catch(() => undefined); },
  });
}
