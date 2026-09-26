import { randomUUID } from 'node:crypto';

export type DesktopExecutorObservation = Readonly<{
  key: string;
  displayName: string;
  state: 'running' | 'stopped' | 'connection-unavailable' | 'scope-unavailable' | 'scope-unknown';
  /** Main-process-only comparison, never part of the renderer notice. */
  executionScopeRef?: string;
  intentional?: boolean;
}>;
export type DesktopExecutionNotice = Readonly<{
  id: string;
  displayName: string;
  kind: Exclude<DesktopExecutorObservation['state'], 'running' | 'scope-unknown'>;
  occurredAt: string;
  availableNow: boolean | null;
  notification: 'disabled' | 'unsupported' | 'requested' | 'shown' | 'failed';
}>;

// @nimi-authority: rule.nimi.desktop.product-surfaces.execution-notice
/** Host technical facts only. There is no business task, recovery or App open action. */
export function createDesktopExecutionNoticesHost(input: {
  readonly supported: () => boolean;
  readonly notify: (title: string, body: string, outcome: (value: 'shown' | 'failed') => void) => void;
  readonly now?: () => number;
}) {
  const states = new Map<string, DesktopExecutorObservation['state']>();
  const scopes = new Map<string, { ref: string; interrupted: boolean }>();
  const notices: Array<{ key: string; value: DesktopExecutionNotice }> = [];
  let enabled = false;
  let language: 'zh' | 'en' = 'zh';
  const observe = (observation: DesktopExecutorObservation) => {
    const previous = states.get(observation.key);
    const priorScope = scopes.get(observation.key);
    if (observation.state === 'scope-unknown') {
      for (const notice of notices) if (notice.key === observation.key) notice.value = { ...notice.value, availableNow: null };
      return; // An unconfirmed read cannot invalidate or replace the baseline.
    }
    const nextScope = observation.executionScopeRef || null;
    if (observation.state === 'running' && !nextScope) {
      // Process liveness is not proof that its protected execution scope is ready.
      if (previous === undefined) states.set(observation.key, 'running');
      return;
    }
    const changedScope = observation.state === 'running' && nextScope !== null
      && priorScope !== undefined && priorScope.ref !== nextScope;
    const reportChangedScope = changedScope && !priorScope.interrupted;
    states.set(observation.key, observation.state);
    if (states.size > 256) { const oldest = states.keys().next().value!; states.delete(oldest); scopes.delete(oldest); }
    if (observation.state === 'running' && nextScope !== null) {
      scopes.set(observation.key, { ref: nextScope, interrupted: false });
      for (const notice of notices) if (notice.key === observation.key) notice.value = { ...notice.value, availableNow: true };
      if (!reportChangedScope) return;
    } else {
      if (priorScope) priorScope.interrupted = true;
      for (const notice of notices) if (notice.key === observation.key) notice.value = { ...notice.value, availableNow: false };
      // The initial not-yet-bound session establishes no interrupted scope.
      if (observation.state === 'scope-unavailable' && !priorScope) return;
      if (previous !== 'running') return;
    }
    const kind = observation.state === 'running' ? 'scope-unavailable' : observation.state;
    const availableNow = observation.state === 'running';
    const notification = !enabled || observation.intentional ? 'disabled' : input.supported() ? 'requested' : 'unsupported';
    const entry: { key: string; value: DesktopExecutionNotice } = { key: observation.key, value: {
      id: randomUUID(), displayName: observation.displayName.slice(0, 256), kind,
      occurredAt: new Date(input.now?.() ?? Date.now()).toISOString(), availableNow, notification,
    } satisfies DesktopExecutionNotice };
    notices.unshift(entry);
    if (notices.length > 50) notices.length = 50;
    if (notification === 'requested') {
      const title = language === 'zh' ? `${entry.value.displayName} 的执行已中断` : `${entry.value.displayName} execution interrupted`;
      const body = language === 'zh'
        ? '应用停止或连接条件已失效。请查看 Nimi 中的技术提醒；重新连接不会自动恢复原工作。'
        : 'The App stopped or lost its execution conditions. View the technical notice in Nimi. Reconnecting does not resume prior work.';
      try { input.notify(title, body, value => { entry.value = { ...entry.value, notification: value }; }); }
      catch { entry.value = { ...entry.value, notification: 'failed' }; }
    }
  };
  const exact = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw new Error('desktop-execution-notice-input-invalid');
    return value as Record<string, unknown>;
  };
  const payload = (value: unknown) => exact(value, ['payload']).payload;
  return {
    observe,
    disableNotifications: () => { enabled = false; },
    commandHandlers: {
      desktop_execution_notices_list: ({ payload: request }: { readonly payload: unknown }) => {
        exact(request, []);
        return { notices: notices.map(entry => entry.value), systemSupported: input.supported() };
      },
      desktop_execution_notices_preferences: ({ payload: request }: { readonly payload: unknown }) => {
        const selected = exact(payload(request), ['enabled', 'language']);
        if (typeof selected.enabled !== 'boolean' || (selected.language !== 'zh' && selected.language !== 'en')) throw new Error('desktop-execution-notice-input-invalid');
        enabled = selected.enabled;
        language = selected.language;
        return { applied: true };
      },
      desktop_execution_notices_dismiss: ({ payload: request }: { readonly payload: unknown }) => {
        const selected = exact(payload(request), ['id']);
        if (typeof selected.id !== 'string' || selected.id.length > 64) throw new Error('desktop-execution-notice-input-invalid');
        const index = notices.findIndex(entry => entry.value.id === selected.id);
        if (index !== -1) notices.splice(index, 1);
        return { dismissed: index !== -1 };
      },
    },
  };
}
