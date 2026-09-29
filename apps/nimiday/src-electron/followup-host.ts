import type { NimiLocalAppAgentWorkClient, NimiLocalAppAgentWorkScope } from '@nimiplatform/sdk/app';
import type { NimiElectronAppBusinessServices, NimiElectronCommandHandler } from '@nimiplatform/kit/shell/electron/main';
import { FollowUpEngine, type FollowUpContinueInput, type FollowUpInput } from '../src/nimiday/followup/engine.js';
import { parseObjectRef } from '../src/nimiday/platform/activity-bridge.js';
import { readCollection, runtimeDocumentStore } from '../src/nimiday/store/persistence.js';

type Navigation = { view: 'followups'; followupId: string } | { view: 'items'; itemId: string } | { view: 'routines'; runId: string };
export function createDayFollowUpHost(showWindow: () => void) {
  let services: NimiElectronAppBusinessServices | undefined;
  let generation = 0;
  let engine: FollowUpEngine | undefined;
  let navigation: Navigation | null = null;
  let registration: { stop: () => Promise<void> } | undefined;
  const current = async () => {
    const expected = generation;
    if (!services) throw new Error('Day Host 尚未就绪');
    if (!engine) {
      engine = new FollowUpEngine(services, id => { navigation = { view: 'followups', followupId: id }; showWindow(); });
      registration = services.activity.onOpenRequest(async request => {
        if (expected !== generation) return 'object-unavailable';
        if (request.objectRef.startsWith('followup:')) return (await current()).open(request.objectRef.slice('followup:'.length));
        const target = parseObjectRef(request.objectRef);
        if (!target || !services) return 'object-unavailable';
        const records = await readCollection(runtimeDocumentStore(services.storage), target.kind === 'item' ? 'items' : 'runs');
        if (expected !== generation) return 'object-unavailable';
        if (!records?.some(value => (value as { id?: string })?.id === target.id)) return 'object-unavailable';
        navigation = target.kind === 'item' ? { view: 'items', itemId: target.id } : { view: 'routines', runId: target.id };
        showWindow(); return 'opened';
      });
    }
    const value = engine; await value.load(); if (expected !== generation) throw new Error('执行范围已变更'); return value;
  };
  // Register the window before awaiting admission. Its Host can then cancel a
  // late accepted execution even when the renderer no longer exists.
  type WindowWork = { alive: boolean; client: NimiLocalAppAgentWorkClient; scopes: Map<string, NimiLocalAppAgentWorkScope> };
  const rendererOwned = new Map<number, WindowWork>();
  const endRendererWork = (senderId: number) => {
    const window = rendererOwned.get(senderId);
    if (!window) return;
    window.alive = false;
    rendererOwned.delete(senderId);
    for (const scope of window.scopes.values()) void window.client.cancel(scope).catch(() => {});
    window.scopes.clear();
  };
  const handlers: Record<string, NimiElectronCommandHandler> = {
    'nimiday.desk.start': async ({ payload, event }) => {
      const sender = event.sender;
      if (!sender || typeof sender.id !== 'number' || sender.isDestroyed?.()) throw new Error('缺少窗口');
      const senderId = sender.id;
      if (!services) throw new Error('Day Host 尚未就绪');
      let window = rendererOwned.get(sender.id);
      if (!window) {
        window = { alive: true, client: services.agentWork, scopes: new Map() };
        rendererOwned.set(sender.id, window);
        sender.on?.('destroyed', () => endRendererWork(senderId));
        sender.on?.('render-process-gone', () => endRendererWork(senderId));
      }
      const input = payload.input as Parameters<NimiLocalAppAgentWorkClient['start']>[0];
      const result = await window.client.start(input);
      const scope = { agentHandle: input.agentHandle, executionId: result.executionId };
      if (!window.alive || sender.isDestroyed?.()) {
        await window.client.cancel(scope);
        throw new Error('窗口已关闭，执行已取消');
      }
      window.scopes.set(result.executionId, scope);
      return result;
    },
    'nimiday.desk.release': ({ payload, event }) => {
      if (typeof payload.executionId !== 'string') throw new Error('缺少执行');
      if (typeof event.sender?.id === 'number') rendererOwned.get(event.sender.id)?.scopes.delete(payload.executionId);
      return { released: true };
    },
    'nimiday.followups.snapshot': async () => (await current()).snapshot(),
    'nimiday.followups.refresh': async () => { const value = await current(); await value.refresh(); return value.snapshot(); },
    'nimiday.followups.start': async ({ payload }) => (await current()).start(payload.input as FollowUpInput),
    'nimiday.followups.continue': async ({ payload }) => (await current()).continueArrangement(payload.input as FollowUpContinueInput),
    'nimiday.followups.stop': async ({ payload }) => { if (typeof payload.id !== 'string') throw new Error('缺少安排'); await (await current()).stop(payload.id); },
    'nimiday.navigation.take': async () => { await current(); const value = navigation; navigation = null; return value; },
  };
  return { handlers, bind: (value: NimiElectronAppBusinessServices) => { services = value; }, invalidate: () => { generation++; for (const id of rendererOwned.keys()) endRendererWork(id); engine?.invalidate(); engine = undefined; services = undefined; navigation = null; void registration?.stop().catch(() => {}); registration = undefined; } };
}
