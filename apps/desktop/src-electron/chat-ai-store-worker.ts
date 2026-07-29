import { parentPort } from 'node:worker_threads';
import { runDesktopChatAiStoreOperation } from './chat-ai-store-database.ts';
import {
  boundedChatAiStoreWorkerError,
  parseChatAiStoreWorkerRequest,
  type ChatAiStoreWorkerResponse,
} from './chat-ai-store-worker-protocol.ts';

if (!parentPort) {
  throw new Error('chat-ai-store-worker-parent-port-required');
}

const port = parentPort;
let operationQueue = Promise.resolve();
port.on('message', (value: unknown) => {
  operationQueue = operationQueue.then(() => run(value));
});

async function run(value: unknown): Promise<void> {
  let requestId = '';
  try {
    const request = parseChatAiStoreWorkerRequest(value);
    requestId = request.id;
    const result = await runDesktopChatAiStoreOperation(request);
    const response: ChatAiStoreWorkerResponse = {
      id: request.id,
      ok: true,
      value: result,
    };
    port.postMessage(response);
  } catch (error) {
    if (!requestId) {
      throw error;
    }
    const response: ChatAiStoreWorkerResponse = {
      id: requestId,
      ok: false,
      error: boundedChatAiStoreWorkerError(error),
    };
    port.postMessage(response);
  }
}
