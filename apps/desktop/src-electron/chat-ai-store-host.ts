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
};

export function createDesktopElectronChatAiStoreHost(input: {
  readonly resolveSelectedDataRoot: () => Promise<string> | string;
  readonly workerUrl?: URL;
  readonly operationGate?: DesktopDataRootOperationGate;
}): DesktopElectronChatAiStoreHost {
  const operationGate = input.operationGate ?? createDesktopDataRootOperationGate();
  const store = new ElectronChatAiStoreWorkerClient(
    input.resolveSelectedDataRoot,
    input.workerUrl ?? new URL('./chat-ai-store-worker.js', import.meta.url),
  );
  return {
    commandHandlers: Object.fromEntries(CHAT_AI_COMMANDS.map((command) => [
      command,
      (context: ChatAiCommandContext) => operationGate.runExclusive(
        () => store.invoke(command, context.payload),
      ),
    ])) as DesktopElectronChatAiStoreHost['commandHandlers'],
    close: () => store.close(),
  };
}

class ElectronChatAiStoreWorkerClient {
  private readonly pending = new Map<string, PendingOperation>();
  private readonly worker: Worker;
  private invocationQueue = Promise.resolve();
  private nextId = 1;
  private closed = false;

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
    const operation = this.invocationQueue.then(() => this.invokeInOrder(command, payload));
    this.invocationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
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
    if (this.closed) return;
    this.closed = true;
    this.rejectPending();
    await this.worker.terminate();
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
    void this.worker.terminate();
  }

  private rejectPending(): void {
    for (const operation of this.pending.values()) {
      operation.reject(new Error('chat-ai-store-worker-unavailable'));
    }
    this.pending.clear();
  }
}
