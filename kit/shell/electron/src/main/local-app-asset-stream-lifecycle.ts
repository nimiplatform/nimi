import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { NimiElectronLocalAppHostError, type NimiElectronLocalAppHost } from './local-app-host.js';
import type { NimiElectronIpcMainInvokeEvent } from './types.js';

type Sender = NonNullable<NimiElectronIpcMainInvokeEvent['sender']>;
type Entry = { readonly host: NimiElectronLocalAppHost; readonly id: string; readonly close: () => Promise<unknown> };
type Scope = {
  readonly sender: Sender;
  readonly entries: Set<Entry>;
  readonly listeners: Array<() => void>;
  generation: number;
  closed: boolean;
};
type Opening = { readonly scope: Scope; readonly generation: number };
const terminalCommands = new Set<string>([
  NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteCommit'],
  NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteAbort'],
  NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadClose'],
]);

/** Own only renderer-initiated transport streams; Node business services keep their own lifetime. */
export function createElectronLocalAppAssetStreamLifecycle() {
  const scopes = new Map<Sender, Scope>();
  let disposed = false;
  const invalidate = (scope: Scope) => {
    scope.generation += 1;
    const entries = [...scope.entries];
    scope.entries.clear();
    return Promise.allSettled(entries.map((entry) => Promise.resolve().then(entry.close)));
  };
  const close = (scope: Scope) => {
    scope.closed = true;
    for (const detach of scope.listeners) detach();
    scopes.delete(scope.sender);
    return invalidate(scope);
  };
  const scopeFor = (sender: Sender | undefined): Scope => {
    if (disposed || sender?.isDestroyed?.()) throw new NimiElectronLocalAppHostError('renderer-context-replaced', false);
    if (!sender?.on || !sender.removeListener) {
      throw new NimiElectronLocalAppHostError('electron-local-app-renderer-lifecycle-required', false);
    }
    let scope = scopes.get(sender);
    if (scope) return scope;
    scope = { sender, entries: new Set(), listeners: [], generation: 0, closed: false };
    const captured = scope;
    const navigation = (details: unknown) => {
      if (!details || typeof details !== 'object') return;
      const event = details as { isMainFrame?: unknown; isSameDocument?: unknown };
      if (event.isMainFrame === true && event.isSameDocument === false) void invalidate(captured);
    };
    const gone = () => { void invalidate(captured); };
    const destroyed = () => { void close(captured); };
    sender.on('did-start-navigation', navigation);
    sender.on('render-process-gone', gone);
    sender.on('destroyed', destroyed);
    scope.listeners.push(
      () => sender.removeListener?.('did-start-navigation', navigation),
      () => sender.removeListener?.('render-process-gone', gone),
      () => sender.removeListener?.('destroyed', destroyed),
    );
    scopes.set(sender, scope);
    return scope;
  };

  return {
    capture(sender: Sender | undefined, command: string): Opening | undefined {
      if (command !== NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteOpen']
        && command !== NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadOpen']) return undefined;
      const scope = scopeFor(sender);
      return { scope, generation: scope.generation };
    },
    async run(
      opening: Opening | undefined,
      host: NimiElectronLocalAppHost,
      command: string,
      payload: Readonly<Record<string, unknown>>,
      operation: () => Promise<unknown>,
    ): Promise<unknown> {
      const write = command === NIMI_STANDARD_SHELL_COMMANDS['storage.assetWriteOpen'];
      const read = command === NIMI_STANDARD_SHELL_COMMANDS['storage.assetReadOpen'];
      if (write || read) {
        if (!opening) throw new NimiElectronLocalAppHostError('electron-local-app-renderer-lifecycle-required', false);
        const { scope, generation } = opening;
        if (disposed || scope.closed || scope.generation !== generation) throw new NimiElectronLocalAppHostError('renderer-context-replaced', false);
        const result = await operation();
        const id = result && typeof result === 'object' && 'streamId' in result ? result.streamId : undefined;
        if (typeof id !== 'string' || !id) throw new NimiElectronLocalAppHostError('runtime-service-untrusted', false);
        const entry: Entry = { host, id, close: () => write ? host.assetWriteAbort({ streamId: id }) : host.assetReadClose({ streamId: id }) };
        if (disposed || scope.closed || scope.generation !== generation) {
          await Promise.resolve().then(entry.close).catch(() => undefined);
          throw new NimiElectronLocalAppHostError('renderer-context-replaced', false);
        }
        scope.entries.add(entry);
        return result;
      }
      try {
        return await operation();
      } finally {
        if (terminalCommands.has(command)) for (const scope of scopes.values()) for (const entry of scope.entries) {
          if (entry.host === host && entry.id === payload.streamId) scope.entries.delete(entry);
        }
      }
    },
    dispose(): void {
      disposed = true;
      for (const scope of [...scopes.values()]) void close(scope);
    },
  };
}
