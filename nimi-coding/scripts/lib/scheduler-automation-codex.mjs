import os from 'node:os';
import { runScheduleOnce } from './scheduler-foreground.mjs';

export const CODEX_AUTOMATION_BACKEND_ID = 'codex-automation';

export function defaultCodexAutomationLeaseHolderId() {
  return `${CODEX_AUTOMATION_BACKEND_ID}:${os.hostname()}:${process.pid}:${Date.now()}`;
}

export function runCodexAutomationScheduleOnce(topicDir, options = {}) {
  return runScheduleOnce(topicDir, {
    ...options,
    leaseHolderId: options.leaseHolderId || defaultCodexAutomationLeaseHolderId(),
  });
}
