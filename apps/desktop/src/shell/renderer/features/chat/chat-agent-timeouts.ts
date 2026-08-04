import { STREAM_TEXT_TOTAL_TIMEOUT_MS } from '../turns/stream-controller';

export function resolveAgentTurnTotalTimeoutMs(): number {
  return STREAM_TEXT_TOTAL_TIMEOUT_MS;
}
