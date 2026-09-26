import { invoke } from '@nimiplatform/kit/shell/renderer/bridge';
import { getNimiLocalAppClient } from '../shell/auth/local-app-client';
import type { GoEngine, Pending } from './engine';
import { errorText, type Work, type Workspace, type WorkMessage, type Material, type Skill, type Routine } from './model';

export type GoSnapshot = Pick<GoEngine, 'workspace' | 'works' | 'agents' | 'activities' | 'activitySourceRef' | 'activityNextPage' | 'activityLoading' | 'worlds' | 'active' | 'error' | 'agentError' | 'ready' | 'selectedWork' | 'integrationTargets' | 'selectionVersion'> & { pending: Pending[] };

/** The renderer only projects the single App-owned Host workspace. */
class GoHostClient {
  readonly client = getNimiLocalAppClient();
  workspace: Workspace | null = null;
  works: Work[] = [];
  agents: GoEngine['agents'] = [];
  activities: GoEngine['activities'] = [];
  activitySources: GoEngine['activitySources'] = new Map();
  activitySourceRef?: string;
  activityNextPage: string | null = null;
  activityLoading = false;
  worlds: GoEngine['worlds'] = [];
  integrationTargets: GoEngine['integrationTargets'] = [];
  messages = new Map<string, readonly WorkMessage[]>();
  active: string | null = null;
  pending: Pending[] = [];
  pendingFor(id: string) { return this.pending.find(value => value.workId === id); }
  error = '';
  private localError = '';
  agentError = '';
  ready = false;
  selectedWork: string | null = null;
  private lastSelection = -1;
  private revision = 0;
  private timer?: ReturnType<typeof setInterval>;
  private reading = false;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  changed() { this.revision++; this.listeners.forEach(listener => listener()); }
  report(error: unknown) { this.localError = errorText(error); this.error = this.localError; this.changed(); }
  clearError() { this.localError = ''; this.error = ''; this.changed(); }
  get agent() { return this.agents.find(agent => agent.agentBinding === this.workspace?.agentBinding); }
  getWork(id: string) { const work = this.works.find(item => item.id === id); if (!work) throw new Error('找不到这项工作'); return work; }
  async initialize() {
    await this.refresh();
    this.timer ??= setInterval(() => { void this.refresh().catch(error => this.report(error)); }, 700);
  }
  disconnect() { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private async refresh() {
    if (this.reading) return;
    this.reading = true;
    try {
      const value = await invoke('nimigo.workspace.snapshot') as GoSnapshot;
      const selection = value.selectedWork;
      const current = this.selectedWork;
      Object.assign(this, value);
      this.error = this.localError || value.error;
      this.selectedWork = value.selectionVersion !== this.lastSelection ? selection : current;
      this.lastSelection = value.selectionVersion;
      this.messages = new Map(this.works.map(work => [work.id, work.messages || []]));
      for (const record of this.activities) this.activitySources.set(record.source.sourceRef, record.source);
      this.changed();
    } finally { this.reading = false; }
  }
  private async call<T>(command: string, args: unknown[] = []): Promise<T> {
    this.localError = '';
    const result = await invoke(`nimigo.${command}`, { args }) as T;
    await this.refresh();
    return result;
  }
  readonly store = { readText: (path: string) => this.call<string>('deliverable.read', [path]) };
  hydrate = async (_id: string) => this.refresh();
  refreshAgents = () => this.call<void>('agents.refresh');
  assign = (binding: string) => this.call<void>('agent.assign', [binding]);
  addProject = (name: string, description: string) => this.call<Workspace['projects'][number]>('project.add', [name, description]);
  updateProject = (id: string, name: string, description: string) => this.call<void>('project.update', [id, name, description]);
  addWork = (projectId: string, title: string, brief: string, skillId: string) => this.call<Work>('work.add', [projectId, title, brief, skillId]);
  updateWorkDetails = (id: string, patch: Pick<Work, 'title' | 'brief' | 'projectId' | 'skillId'>) => this.call<void>('work.update', [id, patch]);
  addMaterial = (id: string, title: string, content: string, origin?: Material['origin']) => this.call<Material>('material.add', [id, title, content, origin]);
  importIntegrationMaterial = (id: string, index: number, input: unknown) => this.call<Material>('material.import-integration', [id, index, input]);
  updateMaterial = (id: string, materialId: string, title: string, content: string) => this.call<Material>('material.update', [id, materialId, title, content]);
  saveDeliverable = (id: string, title: string, content: string, _by: 'user', deliverableId?: string, note?: string) => this.call<{ revision: string }>('deliverable.save', [id, title, content, deliverableId, note]);
  saveSkill = (skill: Skill) => this.call<void>('skill.save', [skill]);
  saveRoutine = (routine: Routine) => this.call<void>('routine.save', [routine]);
  runRoutine = (id: string) => this.call<void>('routine.run', [id]);
  refreshIntegrations = () => this.call<void>('sources.integrations');
  selectIntegrationReads = (id: string, reads: NonNullable<Work['integrationReads']>) => this.call<void>('work.integrations', [id, reads]);
  refreshWorlds = () => this.call<void>('sources.worlds');
  refreshActivities = (sourceRef?: string | null, append = false) => this.call<void>('sources.activity', [sourceRef, append]);
  run = (id: string, followup?: string) => this.call<void>('work.run', [id, followup]);
  stop = (id: string) => this.call<void>('work.stop', [id]);
  answer = (id: string, answer: string) => this.call<void>('work.answer', [id, answer]);
  decideWorldChange = (id: string, apply: boolean) => this.call<void>('work.decide-world', [id, apply]);
  refreshWorkStatus = (id: string) => this.call<boolean>('work.status', [id]);
  toggleTheme = () => this.call<void>('preferences.toggle-theme');
  setNotifyHome = (enabled: boolean) => this.call<void>('preferences.notify', [enabled]);
  toggleArchive = (id: string) => this.call<void>('work.archive', [id]);
  setStepDone = (id: string, stepId: string, done: boolean) => this.call<void>('work.step', [id, stepId, done]);
  setSource = (id: string, sourceRef: string) => this.call<void>('project.source', [id, sourceRef]);
  saveReplyAsDeliverable = (id: string) => this.call<void>('work.save-reply', [id]);
}

export const engine = new GoHostClient();
if (import.meta.hot) import.meta.hot.dispose(() => engine.disconnect());
