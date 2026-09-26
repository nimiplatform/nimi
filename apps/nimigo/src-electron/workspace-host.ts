import type { NimiElectronAppBusinessServices, NimiElectronCommandHandler } from '@nimiplatform/kit/shell/electron/main';
import { GoEngine } from '../src/product/engine.js';
import type { GoSnapshot } from '../src/product/host-client.js';
import type { Material, Routine, Skill, Work } from '../src/product/model.js';

// @nimi-authority: rule.nimi.nimigo.workbench.background-delivery
export function createGoWorkspaceHost(options: { windowOpen: () => boolean; openWork: (id: string) => void }) {
  let services: NimiElectronAppBusinessServices | undefined;
  let generation = 0;
  let engine: GoEngine | undefined;
  const current = async () => {
    const expected = generation;
    if (!services) throw new Error('NimiGo Host 尚未就绪');
    const value = engine ??= new GoEngine(services, options.windowOpen, options.openWork);
    await value.initialize();
    if (expected !== generation) throw new Error('执行范围已变更');
    return value;
  };
  const args = (payload: Readonly<Record<string, unknown>>) => {
    if (!Array.isArray(payload.args) || payload.args.length > 8) throw new Error('无效的 NimiGo 操作');
    return payload.args;
  };
  const command = (handler: (value: GoEngine, args: unknown[]) => unknown): NimiElectronCommandHandler => async ({ payload }) => {
    const expected = generation;
    const result = await handler(await current(), args(payload));
    if (expected !== generation) throw new Error('执行范围已变更');
    return result;
  };
  const text = (value: unknown) => { if (typeof value !== 'string') throw new Error('缺少操作参数'); return value; };
  const handlers: Record<string, NimiElectronCommandHandler> = {
    'nimigo.workspace.snapshot': async () => {
      const value = await current();
      const snapshot: GoSnapshot = { workspace: value.workspace, works: value.works, agents: value.agents, activities: value.activities, activitySourceRef: value.activitySourceRef, activityNextPage: value.activityNextPage, activityLoading: value.activityLoading, worlds: value.worlds, active: value.active, pending: [...value.pending.values()], error: value.error, agentError: value.agentError, ready: value.ready, selectedWork: value.selectedWork, selectionVersion: value.selectionVersion, integrationTargets: value.integrationTargets };
      return snapshot;
    },
    'nimigo.agents.refresh': command(value => value.refreshAgents()),
    'nimigo.agent.assign': command((value, a) => value.assign(text(a[0]))),
    'nimigo.project.add': command((value, a) => value.addProject(text(a[0]), text(a[1]))),
    'nimigo.project.update': command((value, a) => value.updateProject(text(a[0]), text(a[1]), text(a[2]))),
    'nimigo.work.add': command((value, a) => value.addWork(text(a[0]), text(a[1]), text(a[2]), text(a[3]))),
    'nimigo.work.update': command((value, a) => value.updateWorkDetails(text(a[0]), a[1] as Pick<Work, 'title' | 'brief' | 'projectId' | 'skillId'>)),
    'nimigo.material.add': command((value, a) => value.addMaterial(text(a[0]), text(a[1]), text(a[2]), a[3] as Material['origin'])),
    'nimigo.material.import-integration': command((value, a) => { if (!Number.isSafeInteger(a[1])) throw new Error('无效读取选择'); return value.importIntegrationMaterial(text(a[0]), a[1] as number, a[2]); }),
    'nimigo.material.update': command((value, a) => value.updateMaterial(text(a[0]), text(a[1]), text(a[2]), text(a[3]))),
    'nimigo.deliverable.save': command((value, a) => value.saveDeliverable(text(a[0]), text(a[1]), text(a[2]), 'user', a[3] as string | undefined, a[4] as string | undefined)),
    'nimigo.deliverable.read': command((value, a) => { const path = text(a[0]); if (!value.works.some(work => work.deliverables.some(doc => doc.revisions.some(revision => revision.path === path)))) throw new Error('找不到指定成果版本'); return value.store.readText(path); }),
    'nimigo.skill.save': command((value, a) => value.saveSkill(a[0] as Skill)),
    'nimigo.routine.save': command((value, a) => value.saveRoutine(a[0] as Routine)),
    'nimigo.routine.run': command((value, a) => value.runRoutine(text(a[0]))),
    'nimigo.sources.integrations': command(value => value.refreshIntegrations()),
    'nimigo.work.integrations': command((value, a) => value.selectIntegrationReads(text(a[0]), a[1] as NonNullable<Work['integrationReads']>)),
    'nimigo.sources.worlds': command(value => value.refreshWorlds()),
    'nimigo.sources.activity': command((value, a) => value.refreshActivities(a[0] as string | null, a[1] === true)),
    'nimigo.work.run': command((value, a) => { void value.run(text(a[0]), a[1] as string | undefined).catch(error => value.report(error)); return { requested: true }; }),
    'nimigo.work.stop': command((value, a) => value.stop(text(a[0]))),
    'nimigo.work.answer': command((value, a) => { void value.answer(text(a[0]), text(a[1])).catch(error => value.report(error)); return { requested: true }; }),
    'nimigo.work.decide-world': command((value, a) => { void value.decideWorldChange(text(a[0]), a[1] === true).catch(error => value.report(error)); return { requested: true }; }),
    'nimigo.work.status': command((value, a) => value.refreshWorkStatus(text(a[0]))),
    'nimigo.preferences.toggle-theme': command(value => value.modifyWorkspace(w => { w.theme = w.theme === 'light' ? 'dark' : 'light'; })),
    'nimigo.preferences.notify': command((value, a) => value.modifyWorkspace(w => { w.notifyHome = a[0] === true; })),
    'nimigo.work.archive': command((value, a) => value.modifyWork(text(a[0]), w => { if (['running', 'queued'].includes(w.status)) throw new Error('先停止工作再归档'); w.archived = !w.archived; })),
    'nimigo.work.step': command((value, a) => value.modifyWork(text(a[0]), w => { const step = w.steps.find(s => s.id === a[1]); if (!step) throw new Error('步骤不存在'); step.done = a[2] === true; })),
    'nimigo.project.source': command((value, a) => value.modifyWorkspace(w => { const project = w.projects.find(p => p.id === a[0]); if (!project) throw new Error('项目不存在'); project.sourceRef = text(a[1]) || undefined; })),
    'nimigo.work.save-reply': command(async (value, a) => { const work = value.getWork(text(a[0])); const reply = [...(work.messages || [])].reverse().find(message => message.role === 'assistant'); if (!reply) throw new Error('没有完整的业务回复'); await value.saveDeliverable(work.id, work.title, reply.parts.map(part => part.text).join('\n'), 'user'); await value.modifyWork(work.id, w => { w.status = 'complete'; w.error = undefined; }); }),
  };
  return { handlers, windowClosed: () => engine?.windowClosed(), bind: (value: NimiElectronAppBusinessServices) => { services = value; }, invalidate: () => { generation++; engine?.dispose(); engine = undefined; services = undefined; } };
}
