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
    ChatAiCommand,
    (context: ChatAiCommandContext) => Promise<unknown>
  >>;
  readonly close: () => Promise<void>;
  readonly resumeAfterFailedShutdown: () => Promise<boolean>;
};

export function createDesktopElectronChatAiStoreHost(input: {
  readonly resolveSelectedDataRoot: () => Promise<string> | string;
  readonly workerUrl?: URL;
  readonly operationGate?: DesktopDataRootOperationGate;
}): DesktopElectronChatAiStoreHost {
  const operationGate = input.operationGate ?? createDesktopDataRootOperationGate();
  const createStore = () => new ElectronChatAiStoreWorkerClient(
    input.resolveSelectedDataRoot,
    input.workerUrl ?? new URL('./chat-ai-store-worker.js', import.meta.url),
  );
  let store = createStore();
  let stopped = false;
  return {
    commandHandlers: Object.fromEntries(CHAT_AI_COMMANDS.map((command) => [
      command,
      (context: ChatAiCommandContext) => operationGate.runShared(
        () => store.invoke(command, context.payload),
      ),
    ])) as DesktopElectronChatAiStoreHost['commandHandlers'],
    close: () => { stopped = true; return store.close(); },
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
  ): Promise<unknown> {
    // Calls reach the Worker in arrival order, each after the previous result,
    // including its asynchronous root resolution.
    const result = this.tail.then(() => this.invokeInOrder(command, payload));
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }

  private async invokeInOrder(
    command: ChatAiCommand,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    if (this.closed) throw new Error('chat-ai-store-worker-unavailable');
    const selectedDataRoot = await this.resolveSelectedDataRoot();
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
