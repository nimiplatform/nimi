import { createNimiError, extractNimiErrorFields } from './sdk-contract.js';
import type { prepareRuntimeClientLogin, completeRuntimeClientLogin, connectRemoteRuntime,
  RuntimeClientIdentity, RuntimeClientLoginOptions, RuntimeClientLoginTransaction, RuntimeClientSession,
  RemoteRuntimeAppConnection, RemoteRuntimeConnectOptions } from './sdk-contract.js';

/** UI-free, per-consumer orchestration. The injected SDK owns verified identity
 * and protocol; platform ports own navigation and the initiating transaction. */
export type NimiRemoteAppSessionConfig = Omit<RuntimeClientLoginOptions, 'currentUserContext'> & { readonly currentUserContext?: () => string | null };
type Phase = 'signed-out' | 'signing-in' | 'connecting' | 'connected' | 'disconnected' | 'signing-out';
export type NimiRemoteAppSessionSnapshot = Readonly<{
  phase: Phase; stage?: Parameters<NonNullable<RemoteRuntimeConnectOptions['onState']>>[0];
  identity: Readonly<RuntimeClientIdentity> | null; connection: RemoteRuntimeAppConnection | null;
  pendingRevocation: boolean;
  error: Readonly<{ message: string; reasonCode: string }> | null;
}>;

// @nimi-authority: rule.nimi.platform.ui-design-system.remote-app-session
export function createNimiRemoteAppSession(config: NimiRemoteAppSessionConfig, platform: {
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
  navigate: (url: string) => void;
  clearCallback: () => void;
  randomId?: () => string;
  prepare: typeof prepareRuntimeClientLogin;
  complete: typeof completeRuntimeClientLogin;
  connect: typeof connectRemoteRuntime;
  messages?: { readonly loginExpired?: string; readonly appSourceRequired?: string };
}) {
  const transactionKey = `nimi.remote-app.${config.clientId}.login`;
  let generation: string | null = null;
  let session: RuntimeClientSession | null = null;
  let connection: RemoteRuntimeAppConnection | null = null;
  let pending: AbortController | null = null;
  let operation = 0;
  let disposed = false;
  let restoring: Promise<void> | null = null;
  let snapshot: NimiRemoteAppSessionSnapshot = { phase: 'signed-out', identity: null, connection: null, error: null, pendingRevocation: false };
  const listeners = new Set<() => void>();
  const options = (): RuntimeClientLoginOptions => ({ ...config, currentUserContext: () => disposed ? null : config.currentUserContext ? config.currentUserContext() : generation });
  const publish = (next: Partial<NimiRemoteAppSessionSnapshot>) => {
    if (disposed) return;
    snapshot = Object.freeze({ ...snapshot, ...next });
    for (const listener of listeners) listener();
  };
  const report = (error: unknown) => {
    const fields = extractNimiErrorFields(error);
    publish({ error: { message: error instanceof Error ? error.message : String(error), reasonCode: fields.reasonCode || 'KIT_REMOTE_APP_CONNECTION_FAILED' } });
  };
  function disconnect() {
    operation++;
    pending?.abort(); pending = null;
    connection?.close(); connection = null;
    publish({ phase: session?.active ? 'disconnected' : 'signed-out', identity: session?.active ? session.identity : null, connection: null, stage: undefined, error: null });
  }
  async function signOut() {
    disconnect(); generation = null; platform.storage.removeItem(transactionKey);
    publish({ phase: 'signing-out', identity: null, error: null });
    try { await session?.end(); session = null; publish({ pendingRevocation: false }); }
    catch (error) { publish({ pendingRevocation: true }); report(error); }
    finally { publish({ phase: 'signed-out' }); }
  }
  async function signIn() {
    if (disposed || snapshot.phase === 'signing-in' || snapshot.phase === 'signing-out') return;
    disconnect();
    const current = ++operation;
    publish({ phase: 'signing-in', identity: null, error: null });
    try {
      // A failed explicit revocation remains retryable; never reuse its context.
      generation = null; await session?.end(); session = null;
      publish({ pendingRevocation: false });
      generation = (platform.randomId ?? (() => crypto.randomUUID()))();
      const prepared = await platform.prepare(options());
      if (disposed || current !== operation) return;
      platform.storage.setItem(transactionKey, JSON.stringify(prepared.transaction));
      platform.navigate(prepared.authorizationUrl);
    } catch (error) { if (!disposed && current === operation) { publish({ phase: 'signed-out', pendingRevocation: session !== null }); report(error); } }
  }
  async function connect() {
    if (disposed || pending || connection) return;
    if (!session?.active) { publish({ phase: 'signed-out', identity: null }); return; }
    const current = ++operation;
    const controller = new AbortController(); pending = controller;
    publish({ phase: 'connecting', error: null, stage: 'gathering' });
    try {
      const peer = await platform.connect(session, { signal: controller.signal, onState(stage) {
        if (disposed || current !== operation) return;
        if (stage === 'closed') { connection = null; const active = session?.active; publish({ phase: active ? 'disconnected' : 'signed-out', connection: null, identity: active ? session!.identity : null, stage }); }
        else publish({ stage });
      } });
      if (disposed || current !== operation) { peer.close(); return; }
      if (peer.closed) { publish({ phase: 'disconnected', connection: null }); return; }
      if (peer.role !== 'app') { peer.close(); throw createNimiError({ message: platform.messages?.appSourceRequired ?? 'This connection requires an ordinary App source.', reasonCode: 'KIT_REMOTE_APP_SOURCE_REQUIRED', source: 'sdk' }); }
      connection = peer;
      publish({ phase: 'connected', connection: peer, identity: session.identity, stage: 'connected' });
    } catch (error) {
      if (!disposed && current === operation) { publish({ phase: session?.active ? 'disconnected' : 'signed-out', connection: null }); report(error); }
    } finally { if (pending === controller) pending = null; }
  }
  async function restoreCallback(url: string) {
    const callback = new URL(url);
    if (!callback.searchParams.has('code') && !callback.searchParams.has('error')) return;
    const saved = platform.storage.getItem(transactionKey);
    platform.storage.removeItem(transactionKey); platform.clearCallback();
    const current = ++operation;
    publish({ phase: 'signing-in', error: null });
    try {
      if (!saved) throw createNimiError({ message: platform.messages?.loginExpired ?? 'The sign-in attempt expired. Start sign-in again.', reasonCode: 'KIT_REMOTE_APP_LOGIN_EXPIRED', source: 'sdk' });
      const transaction = JSON.parse(saved) as RuntimeClientLoginTransaction;
      if (!config.currentUserContext) generation = typeof transaction.applicationUserContext === 'string' ? transaction.applicationUserContext : null;
      const verified = await platform.complete(options(), transaction, url);
      if (disposed || current !== operation) { await verified.end(); return; }
      session = verified;
      publish({ phase: 'disconnected', identity: verified.identity });
      await connect();
    } catch (error) { if (!disposed && current === operation) { generation = null; publish({ phase: 'signed-out', identity: null }); report(error); } }
  }
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    restore(url: string) { return restoring ??= restoreCallback(url); },
    signIn, signOut, connect, disconnect,
    dispose() { disconnect(); disposed = true; generation = null; listeners.clear(); void session?.end().catch(() => undefined); },
  });
}
export type NimiRemoteAppSession = ReturnType<typeof createNimiRemoteAppSession>;
