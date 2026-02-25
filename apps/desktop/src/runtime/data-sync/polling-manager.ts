import { emitRuntimeLog } from '@runtime/telemetry/logger';

export class DataSyncPollingManager {
  private readonly pollingIntervals = new Map<string, ReturnType<typeof setInterval>>();

  start(key: string, callback: () => void, intervalMs: number) {
    const replaced = this.pollingIntervals.has(key);
    this.stop(key);
    const intervalId = setInterval(callback, intervalMs);
    this.pollingIntervals.set(key, intervalId);
    emitRuntimeLog({
      level: 'info',
      area: 'datasync-polling',
      message: 'action:polling:start',
      flowId: `poll-${key}`,
      details: {
        key,
        intervalMs,
        replaced,
        activeCount: this.pollingIntervals.size,
      },
    });
  }

  stop(key: string) {
    const intervalId = this.pollingIntervals.get(key);
    if (!intervalId) {
      return;
    }
    clearInterval(intervalId);
    this.pollingIntervals.delete(key);
    emitRuntimeLog({
      level: 'info',
      area: 'datasync-polling',
      message: 'action:polling:stop',
      flowId: `poll-${key}`,
      details: {
        key,
        activeCount: this.pollingIntervals.size,
      },
    });
  }

  stopAll() {
    const activeCount = this.pollingIntervals.size;
    this.pollingIntervals.forEach((intervalId) => {
      clearInterval(intervalId);
    });
    this.pollingIntervals.clear();
    if (activeCount <= 0) {
      return;
    }
    emitRuntimeLog({
      level: 'info',
      area: 'datasync-polling',
      message: 'action:polling:stop-all',
      flowId: 'poll-all',
      details: {
        activeCount,
      },
    });
  }
}
