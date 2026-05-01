import { Struct } from './generated/google/protobuf/struct.js';
import { normalizeText } from './helpers.js';
import type { RuntimeAgentConsumeEvent, RuntimeAgentConsumeRequest } from './types-runtime-agent.js';
import { optionalString } from './runtime-agent-surface-parser-common.js';

export { parseAgentConsumeEvent } from './runtime-agent-agent-event-parsers.js';
export { parseAppConsumeEvent } from './runtime-agent-app-event-parsers.js';
export { parseSessionSnapshot } from './runtime-agent-snapshot-parsers.js';

export function fromProtoStruct(payload?: Struct): Record<string, unknown> {
  if (!payload) {
    return {};
  }
  return Struct.toJson(payload) as Record<string, unknown>;
}
function eventHasConversationAnchor(
  event: RuntimeAgentConsumeEvent,
): event is RuntimeAgentConsumeEvent & { conversationAnchorId: string } {
  return typeof (event as { conversationAnchorId?: unknown }).conversationAnchorId === 'string'
    && normalizeText((event as { conversationAnchorId?: string }).conversationAnchorId).length > 0;
}
export function matchesConsumeRequest(event: RuntimeAgentConsumeEvent, request: RuntimeAgentConsumeRequest): boolean {
  if (event.agentId !== request.agentId) {
    return false;
  }
  const requestedAnchorId = optionalString(request.conversationAnchorId);
  if (!requestedAnchorId) {
    return true;
  }
  return eventHasConversationAnchor(event) && event.conversationAnchorId === requestedAnchorId;
}
export async function* mergeAsyncIterables<T>(iterables: AsyncIterable<T>[]): AsyncIterable<T> {
  const iterators = iterables.map((iterable) => iterable[Symbol.asyncIterator]());
  const idlePull = new Promise<{ index: number; result: IteratorResult<T> }>(() => {});
  const pulls = iterators.map((iterator, index) => iterator.next().then((result) => ({ index, result })));
  let active = pulls.length;
  try {
    while (active > 0) {
      const { index, result } = await Promise.race(pulls);
      if (result.done) {
        pulls[index] = idlePull;
        active -= 1;
        continue;
      }
      const iterator = iterators[index];
      if (!iterator) {
        throw new Error(`mergeAsyncIterables missing iterator for index ${index}`);
      }
      pulls[index] = iterator.next().then((nextResult) => ({ index, result: nextResult }));
      yield result.value;
    }
  } finally {
    await Promise.all(iterators.map(async (iterator) => {
      if (typeof iterator.return === 'function') {
        await iterator.return();
      }
    }));
  }
}
