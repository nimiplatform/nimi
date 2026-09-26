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
  const handlers: Record<string, NimiElectronCommandHandler> = {
    'nimiday.followups.snapshot': async () => (await current()).snapshot(),
    'nimiday.followups.refresh': async () => { const value = await current(); await value.refresh(); return value.snapshot(); },
    'nimiday.followups.start': async ({ payload }) => (await current()).start(payload.input as FollowUpInput),
    'nimiday.followups.continue': async ({ payload }) => (await current()).continueArrangement(payload.input as FollowUpContinueInput),
    'nimiday.followups.stop': async ({ payload }) => { if (typeof payload.id !== 'string') throw new Error('缺少安排'); await (await current()).stop(payload.id); },
    'nimiday.navigation.take': async () => { await current(); const value = navigation; navigation = null; return value; },
  };
  return { handlers, bind: (value: NimiElectronAppBusinessServices) => { services = value; }, invalidate: () => { generation++; engine?.invalidate(); engine = undefined; services = undefined; navigation = null; void registration?.stop().catch(() => {}); registration = undefined; } };
}
