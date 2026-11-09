import { CoreClient } from '../core-client/index.js';
import { RuntimeTypedClient } from '../core-generated/runtime-typed-client.js';
import type { RuntimeClientSession } from '../realm/runtime-client.js';
import { createNimiError } from '../types/index.js';
import { createNimiAppAIConfigClient } from '../core/ai/capability-configuration.js';
import { RuntimeDataChannelTransport, type RuntimeDataChannel } from './remote-data-channel.js';

export type { RuntimeDataChannel } from './remote-data-channel.js';

export type RuntimePeerDescription = { type: 'offer' | 'answer'; sdp: string };
export interface RuntimePeerConnection {
  readonly localDescription: { type: string; sdp?: string } | null;
  readonly iceGatheringState: string;
  readonly connectionState: string;
  createDataChannel(): RuntimeDataChannel;
  createOffer(): Promise<RuntimePeerDescription>;
  setLocalDescription(description: RuntimePeerDescription): Promise<void>;
  setRemoteDescription(description: RuntimePeerDescription): Promise<void>;
  onGatheringChange(listener: () => void): () => void;
  onConnectionChange(listener: () => void): () => void;
  close(): void;
}
export type RuntimePeerFactory = (stunUrls: readonly string[]) => RuntimePeerConnection;
export type RemoteRuntimeConnectOptions = {
  readonly peerFactory?: RuntimePeerFactory;
  readonly signal?: AbortSignal;
  readonly onState?: (state: 'gathering' | 'waiting-for-pc' | 'connecting' | 'connected' | 'closed') => void;
};

// @nimi-authority: rule.nimi.sdks.client-core.remote-runtime-carrier
// @nimi-authority: rule.nimi.runtime.remote-access.direct-transport
export async function connectRemoteRuntime(session: RuntimeClientSession, options: RemoteRuntimeConnectOptions = {}) {
  if (!session.active || options.signal?.aborted) throw unavailable();
  const current = await session.read();
  if (!current.primary) throw createNimiError({ message: 'Bind your primary Runtime in PC Home first.', reasonCode: 'PRIMARY_RUNTIME_NOT_BOUND', source: 'realm' });
  // Owner management does not need the ordinary App's AI/Agent operation clients.
  const appClients = current.source.role === 'official_manager' ? null : (await import('./remote-app.js')).createRemoteRuntimeAppClients;
  if (!session.active || options.signal?.aborted) throw unavailable();
  assertStunUrls(current.stunUrls);
  const peer = (options.peerFactory ?? createBrowserRuntimePeer)(current.stunUrls);
  const channel = peer.createDataChannel();
  const controller = new AbortController();
  let transport: RuntimeDataChannelTransport | undefined;
  let closed = false;
  const dispose: Array<() => void> = [];
  const close = () => {
    if (closed) return;
    closed = true; controller.abort(); transport?.close(); channel.close(); peer.close();
    for (const off of dispose) off();
    session.signal.removeEventListener('abort', close); options.signal?.removeEventListener('abort', close);
    options.onState?.('closed');
  };
  session.signal.addEventListener('abort', close, { once: true });
  options.signal?.addEventListener('abort', close, { once: true });
  dispose.push(peer.onConnectionChange(() => { if (['failed', 'closed', 'disconnected'].includes(peer.connectionState)) close(); }));
  dispose.push(channel.onClose(close));
  try {
    options.onState?.('gathering');
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await waitFor(() => peer.iceGatheringState === 'complete', listener => peer.onGatheringChange(listener), controller.signal, 15000);
    const sdp = peer.localDescription?.sdp;
    if (!sdp || hasRelayCandidate(sdp)) throw unavailable();
    const proposed = await session.createConnection(sdp, current.primary.bindingId);
    options.onState?.('waiting-for-pc');
    const deadline = Date.now() + 90_000;
    let answer = proposed;
    while (answer.status === 'pending') {
      if (closed || !session.active || Date.now() >= deadline) throw unavailable();
      await delay(1500, controller.signal);
      answer = await session.readConnection(proposed.connectionId, current.primary.bindingId);
    }
    if (answer.status === 'rejected') throw createNimiError({
      message: answer.rejectionReason === 'SOURCE_NOT_ALLOWED' ? 'This source is not allowed. Check its access in PC Home.' : 'A direct connection could not be established.',
      reasonCode: answer.rejectionReason || 'DIRECT_CONNECTION_UNAVAILABLE', source: 'runtime' });
    if (!answer.answerSdp || hasRelayCandidate(answer.answerSdp)) throw unavailable();
    options.onState?.('connecting');
    await peer.setRemoteDescription({ type: 'answer', sdp: answer.answerSdp });
    await waitFor(() => channel.readyState === 'open', listener => channel.onOpen(listener), controller.signal, 15000);
    if (!session.active || closed) throw unavailable();
    transport = new RuntimeDataChannelTransport(channel, () => session.active);
    transport.signal.addEventListener('abort', close, { once: true });
    const runtime = new RuntimeTypedClient(new CoreClient({ transport }));
    options.onState?.('connected');
    const base = { identity: session.identity, primary: current.primary, close };
    if (current.source.role === 'official_manager') {
      return Object.freeze({ ...base, get closed() { return closed; }, role: 'official_manager' as const, management: Object.freeze({
        state: () => runtime.getRuntimeServiceState({}),
        access: () => runtime.getRemoteAccessState({}),
        pauseSource: (clientId: string, paused: boolean) => runtime.setRemoteSourcePaused({ clientId, paused, expectedBindingId: current.primary!.bindingId }),
        appAIConfig: (appId: string) => createNimiAppAIConfigClient({ appId, runtime }),
        stop: () => runtime.requestRuntimeStop({}),
      }) });
    }
    return Object.freeze({ ...base, get closed() { return closed; }, role: 'app' as const, ...appClients!(runtime, current.appId) });
  } catch (reason) { close(); throw reason; }
}

export type RemoteRuntimeConnection = Awaited<ReturnType<typeof connectRemoteRuntime>>;
export type RemoteRuntimeAppConnection = Extract<RemoteRuntimeConnection, { role: 'app' }>;

/** Browser adapter. Native clients supply the same small peer/channel carrier
 * through peerFactory; neither adapter starts a local Runtime. */
export function createBrowserRuntimePeer(stunUrls: readonly string[]): RuntimePeerConnection {
  assertStunUrls(stunUrls);
  if (typeof RTCPeerConnection !== 'function') throw createNimiError({ message: 'This platform needs a WebRTC peer adapter.', reasonCode: 'SDK_RUNTIME_REMOTE_ADAPTER_REQUIRED', source: 'sdk' });
  const peer = new RTCPeerConnection({ iceServers: stunUrls.length ? [{ urls: [...stunUrls] }] : [], iceTransportPolicy: 'all' });
  const watch = (name: string, listener: () => void) => { peer.addEventListener(name, listener); return () => peer.removeEventListener(name, listener); };
  return {
    get localDescription() { return peer.localDescription; }, get iceGatheringState() { return peer.iceGatheringState; }, get connectionState() { return peer.connectionState; },
    createDataChannel: () => adaptBrowserChannel(peer.createDataChannel('nimi-runtime-v1', { ordered: true, protocol: 'nimi-runtime-protobuf-v1' })),
    createOffer: async () => { const result = await peer.createOffer(); if (!result.sdp) throw unavailable(); return { type: 'offer', sdp: result.sdp }; },
    setLocalDescription: description => peer.setLocalDescription(description), setRemoteDescription: description => peer.setRemoteDescription(description),
    onGatheringChange: listener => watch('icegatheringstatechange', listener), onConnectionChange: listener => watch('connectionstatechange', listener), close: () => peer.close(),
  };
}
function adaptBrowserChannel(channel: RTCDataChannel): RuntimeDataChannel {
  channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = 256 * 1024;
  const watch = (name: string, listener: () => void) => { channel.addEventListener(name, listener); return () => channel.removeEventListener(name, listener); };
  return {
    get readyState() { return channel.readyState; }, get bufferedAmount() { return channel.bufferedAmount; },
    send: bytes => channel.send(new Uint8Array(bytes)), close: () => channel.close(),
    onOpen: listener => watch('open', listener), onClose: listener => watch('close', listener), onBufferLow: listener => watch('bufferedamountlow', listener),
    onMessage: listener => { const receive = (event: MessageEvent) => { if (event.data instanceof ArrayBuffer) listener(new Uint8Array(event.data)); else channel.close(); };
      channel.addEventListener('message', receive); return () => channel.removeEventListener('message', receive); },
  };
}
function assertStunUrls(values: readonly string[]): void {
  if (values.length > 8) throw unavailable();
  for (const value of values) {
    const match = /^(stun|stuns):(.+)$/.exec(value);
    if (!match || /[/?#]/.test(match[2])) throw unavailable();
    const parsed = new URL('https://' + match[2]);
    if (!parsed.hostname || parsed.username || parsed.password || parsed.port === '0') throw unavailable();
  }
}
function hasRelayCandidate(sdp: string): boolean { return sdp.split(/\r?\n/).some(line => line.startsWith('a=candidate:') && /\btyp relay(?:\s|$)/.test(line)); }
function waitFor(ready: () => boolean, subscribe: (listener: () => void) => () => void, signal: AbortSignal, milliseconds: number): Promise<void> {
  if (signal.aborted) return Promise.reject(unavailable());
  if (ready()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const check = () => { if (ready()) { cleanup(); resolve(); } };
    const abort = () => { cleanup(); reject(unavailable()); };
    const off = subscribe(check), timer = setTimeout(abort, milliseconds);
    const cleanup = () => { off(); clearTimeout(timer); signal.removeEventListener('abort', abort); };
    signal.addEventListener('abort', abort, { once: true }); check();
  });
}
function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(unavailable()); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, milliseconds);
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
  });
}
function unavailable() { return createNimiError({ message: 'A direct connection to the primary Runtime is unavailable.', reasonCode: 'SDK_RUNTIME_REMOTE_UNAVAILABLE', source: 'sdk' }); }
