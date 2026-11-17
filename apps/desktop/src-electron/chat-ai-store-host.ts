import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import {
  CHAT_AI_COMMANDS,
  parseChatAiStoreWorkerResponse,
  type ChatAiCommand,
  type ChatAiStoreWorkerRequest,
} from './chat-ai-store-worker-protocol.js';
import {
  createDesktopDataRootOperationGate,
  type DesktopDataRootOperationGate,
} from './data-root-operation-gate.js';

type ChatAiCommandContext = {
  readonly command: string;
  readonly payload: Readonly<Record<string, unknown>>;
};

type PendingOperation = {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
};

export type DesktopElectronChatAiStoreHost = {
  readonly commandHandlers: Readonly<Record<
    ChatAiCommand | 'chat_ai_begin_turn',
    (context: ChatAiCommandContext) => Promise<unknown>
  >>;
  readonly invalidateTurn: () => void;
  readonly observeAccountRevision: (revision: string) => void;
  readonly close: () => Promise<void>;
  readonly resumeAfterFailedShutdown: () => Promise<boolean>;
};

export function createDesktopElectronChatAiStoreHost(input: {
  readonly resolveSelectedDataRoot: () => Promise<string> | string;
  readonly workerUrl?: URL;
  readonly resolveTurnScope?: () => Promise<{ readonly signal: AbortSignal; readonly revision: string }>;
  readonly operationGate?: DesktopDataRootOperationGate;
}): DesktopElectronChatAiStoreHost {
  const operationGate = input.operationGate ?? createDesktopDataRootOperationGate();
  const createStore = () => new ElectronChatAiStoreWorkerClient(
    input.resolveSelectedDataRoot,
    input.workerUrl ?? new URL('./chat-ai-store-worker.js', import.meta.url),
  );
  let store = createStore();
  let stopped = false;
  let turn: { id: string; signal: AbortSignal; revision: string; fence: Int32Array; unsubscribe: () => void } | undefined;
  let generation = 0;
  const invalidateTurn = () => {
    generation++;
    if (!turn) return;
    Atomics.store(turn.fence, 0, 1);
    turn.unsubscribe();
    turn = undefined;
  };
  const guard = async (id: unknown) => {
    const captured = turn;
    if (!captured || captured.id !== id || captured.signal.aborted) throw new Error('chat-ai-turn-scope-ended');
    const current = await input.resolveTurnScope?.();
    if (turn !== captured || captured.signal.aborted || current?.signal !== captured.signal || current.revision !== captured.revision) {
      throw new Error('chat-ai-turn-scope-ended');
    }
    return captured.fence.buffer as SharedArrayBuffer;
  };
  return {
    commandHandlers: {
      ...Object.fromEntries(CHAT_AI_COMMANDS.map((command) => [
        command,
        (context: ChatAiCommandContext) => operationGate.runShared(async () => {
          if (command !== 'chat_ai_commit_turn') return store.invoke(command, context.payload);
          const raw = context.payload.payload as Readonly<Record<string, unknown>> | undefined;
          const { scopeId, ...payload } = raw ?? {};
          return store.invoke(command, { payload }, () => guard(scopeId));
        }),
      ])) as Omit<DesktopElectronChatAiStoreHost['commandHandlers'], 'chat_ai_begin_turn'>,
      chat_ai_begin_turn: () => operationGate.runShared(async () => {
        invalidateTurn();
        const started = generation;
        const scope = await input.resolveTurnScope?.();
        if (stopped || generation !== started || !scope || scope.signal.aborted) throw new Error('chat-ai-turn-scope-ended');
        const fence = new Int32Array(new SharedArrayBuffer(4));
        scope.signal.addEventListener('abort', invalidateTurn, { once: true });
        turn = { ...scope, fence, id: randomUUID(), unsubscribe: () => scope.signal.removeEventListener('abort', invalidateTurn) };
        return turn.id;
      }),
    },
    invalidateTurn,
    observeAccountRevision(revision) {
      if (turn && turn.revision !== revision) invalidateTurn();
    },
    close: () => { stopped = true; invalidateTurn(); return store.close(); },
    // @nimi-authority: rule.nimi.desktop.shell-ui.r066
    resumeAfterFailedShutdown: async () => {
      if (!stopped) return false;
      await store.close();
      store = createStore();
      stopped = false;
      return true;
    },
  };
}

class ElectronChatAiStoreWorkerClient {
  private readonly pending = new Map<string, PendingOperation>();
  private readonly worker: Worker;
  private nextId = 1;
  private closed = false;
  private termination: Promise<number> | undefined;
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly resolveSelectedDataRoot: () => Promise<string> | string,
    workerUrl: URL,
  ) {
    this.worker = new Worker(workerUrl, {
      name: 'nimi-desktop-chat-ai-store',
    });
    this.worker.on('message', (value: unknown) => {
      this.handleResponse(value);
    });
    this.worker.on('error', () => {
      this.fail();
    });
    this.worker.on('exit', (code) => {
      if (!this.closed || code !== 0) this.fail();
    });
  }

  invoke(
    command: ChatAiCommand,
    payload: Readonly<Record<string, unknown>>,
    guard?: () => Promise<SharedArrayBuffer>,
  ): Promise<unknown> {
    // Calls reach the Worker in arrival order, each after the previous result,
    // including its asynchronous root resolution.
    const result = this.tail.then(() => this.invokeInOrder(command, payload, guard));
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async invokeInOrder(
    command: ChatAiCommand,
    payload: Readonly<Record<string, unknown>>,
    guard?: () => Promise<SharedArrayBuffer>,
  ): Promise<unknown> {
    if (this.closed) throw new Error('chat-ai-store-worker-unavailable');
    const selectedDataRoot = await this.resolveSelectedDataRoot();
    const turnFence = await guard?.();
    if (this.closed) throw new Error('chat-ai-store-worker-unavailable');
    const id = `chat-ai-${this.nextId}`;
    this.nextId += 1;
    if (!Number.isSafeInteger(this.nextId)) {
      this.nextId = 1;
    }
    const request: ChatAiStoreWorkerRequest = {
      id,
      command,
      payload,
      selectedDataRoot,
      turnFence,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage(request);
      } catch {
        this.pending.delete(id);
        reject(new Error('chat-ai-store-worker-unavailable'));
      }
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    this.rejectPending();
    this.termination ??= this.worker.terminate();
    await this.termination;
  }

  private handleResponse(value: unknown): void {
    let response;
    try {
      response = parseChatAiStoreWorkerResponse(value);
    } catch {
      this.fail();
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      this.fail();
      return;
    }
    this.pending.delete(response.id);
    if (response.ok) {
      pending.resolve(response.value);
    } else {
      pending.reject(new Error(response.error));
    }
  }

  private fail(): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending();
    this.termination ??= this.worker.terminate();
    void this.termination;
  }

  private rejectPending(): void {
    for (const operation of this.pending.values()) {
      operation.reject(new Error('chat-ai-store-worker-unavailable'));
    }
    this.pending.clear();
  }
}
