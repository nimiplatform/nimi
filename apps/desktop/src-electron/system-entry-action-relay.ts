import { randomUUID } from 'node:crypto';
import {
  SYSTEM_ENTRY_ACTION_DISPATCH_MS,
  parseSystemEntryActionResult,
  parseSystemEntryAction,
  parseSystemEntryFocusSource,
  type SystemEntryAction,
  type SystemEntryActionContext,
  type SystemEntryActionDispatch,
  type SystemEntryFocusSource,
} from '../src/shell/shared/system-entry-types.js';

// @nimi-authority: rule.nimi.desktop.shell-ui.r065
/** Bounded navigation acknowledgements, never durable or replayable work. */
export function createSystemEntryActionRelay(input: {
  send(request: SystemEntryActionDispatch): void;
  timeoutMs?: number;
}) {
  const pending = new Map<string, { generation: string; action: SystemEntryAction; expiresAt: number; focusStarted: boolean; resolve(): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();
  const clear = (requestId: string) => {
    const entry = pending.get(requestId);
    if (entry) { clearTimeout(entry.timer); pending.delete(requestId); }
    return entry;
  };
  return {
    dispatch(action: SystemEntryAction, context: SystemEntryActionContext): Promise<void> {
      if (pending.size >= 8) return Promise.reject(new Error('system-entry-action-busy'));
      return new Promise<void>((resolve, reject) => {
        const boundedAction = parseSystemEntryAction(action);
        const requestId = randomUUID();
        const timer = setTimeout(() => { clear(requestId)?.reject(new Error('system-entry-action-unconfirmed')); }, input.timeoutMs ?? 15_000);
        timer.unref?.();
        pending.set(requestId, { generation: context.generation, action: boundedAction, expiresAt: performance.now() + Math.min(input.timeoutMs ?? 15_000, SYSTEM_ENTRY_ACTION_DISPATCH_MS), focusStarted: false, resolve, reject, timer });
        try { input.send({ ...context, requestId, action: boundedAction }); }
        catch (error) { clear(requestId)?.reject(error instanceof Error ? error : new Error('system-entry-renderer-unavailable')); }
      });
    },
    prepareFocus(requestId: string, generation: string, source: SystemEntryFocusSource): () => void {
      const expected = pending.get(requestId);
      const sourceKey = JSON.stringify(parseSystemEntryFocusSource(source));
      const assertPending = () => {
        if (!expected || pending.get(requestId) !== expected || expected.generation !== generation
          || expected.action.kind !== 'focus-app' || JSON.stringify(expected.action.source) !== sourceKey
          || expected.focusStarted || performance.now() >= expected.expiresAt) throw new Error('system-entry-action-stale');
      };
      assertPending();
      return () => { assertPending(); expected!.focusStarted = true; };
    },
    settle(value: unknown): void {
      const result = parseSystemEntryActionResult(value);
      const entry = pending.get(result.requestId);
      if (!entry || entry.generation !== result.generation) throw new Error('system-entry-action-stale');
      clear(result.requestId);
      if (result.error) entry.reject(new Error(result.error));
      else entry.resolve();
    },
    invalidate(): void {
      for (const id of [...pending.keys()]) clear(id)?.reject(new Error('system-entry-view-stale'));
    },
  };
}
