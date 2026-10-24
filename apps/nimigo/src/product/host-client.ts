import { invoke, listenShell } from '@nimiplatform/kit/shell/renderer/bridge';
import { getNimiLocalAppClient } from '../shell/auth/local-app-client';
import type { GoEngine, Pending } from './engine';
import { errorText, type Work, type Workspace, type WorkMessage, type Material, type Skill, type Routine } from './model';
import { defaultWorkspaceQuery, emptyCatalogPage, MESSAGE_PAGE_SIZE, WORKSPACE_CHANGED, type WorkspaceQuery, type WorkspaceCursor, type DetailCursor, type WorkspaceSync } from './workspace-projection';

type Transport = {
  invoke: (command: string, payload?: Record<string, unknown>) => Promise<unknown>;
  listen: (event: string, listener: () => void) => Promise<() => void>;
};

/** The renderer only projects the single App-owned Host workspace. */
export class GoHostClient {
  constructor(private readonly transport: Transport = { invoke, listen: listenShell }) {}
  get client() { return getNimiLocalAppClient(); }
  workspace: Omit<Workspace, 'workIds'> | null = null;
  page = emptyCatalogPage();
  get works() { return this.page.works; }
  query = defaultWorkspaceQuery();
  loading = false;
  detailLoading = false;
  detailId: string | null = null;
  detail: Work | null = null;
  messagePage = { start: 0, end: 0, total: 0 };
  private messagesBefore: number | null = null;
  private cursor?: WorkspaceCursor;
  private detailCursor?: DetailCursor;
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
  private unlisten?: () => void;
  private epoch = 0;
  private live = false;
  private requestVersion = 0;
  private queued = false;
  private reading?: Promise<void>;
  private listeners = new Set<() => void>();
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  changed() { this.revision++; this.listeners.forEach(listener => listener()); }
  report(error: unknown) { this.localError = errorText(error); this.error = this.localError; this.changed(); }
  clearError() { this.localError = ''; this.error = ''; this.changed(); }
  get agent() { return this.agents.find(agent => agent.agentBinding === this.workspace?.agentBinding); }
  getWork(id: string) { if (this.detail?.id !== id) throw new Error('工作详情尚未载入'); return this.detail; }
  async initialize() {
    if (this.live) return this.refresh();
    this.live = true;
    this.localError = ''; this.error = '';
    const epoch = ++this.epoch;
    try {
      const unlisten = await this.transport.listen(WORKSPACE_CHANGED, () => {
        if (this.live && epoch === this.epoch) void this.refresh().catch(error => this.report(error));
      });
      if (!this.live || epoch !== this.epoch) { unlisten(); return; }
      this.unlisten = unlisten;
      await this.refresh();
    } catch (error) { if (this.live && epoch === this.epoch) this.report(error); }
    if (this.live && epoch === this.epoch) {
      // Bounded reconciliation for missed events/reconnects, never a full poll.
      this.timer = setInterval(() => { void this.refresh().catch(error => this.report(error)); }, 5000);
    }
  }
  disconnect() {
    this.live = false; this.epoch++; this.queued = false; this.reading = undefined;
    this.unlisten?.(); this.unlisten = undefined;
    if (this.timer) clearInterval(this.timer); this.timer = undefined;
    this.resetScope(); this.changed();
  }
  private resetScope() {
    this.cursor = undefined; this.detailCursor = undefined; this.lastSelection = -1;
    this.workspace = null; this.page = emptyCatalogPage(); this.detail = null;
    this.messages.clear(); this.pending = []; this.activitySources.clear();
    this.agents = []; this.activities = []; this.worlds = []; this.integrationTargets = [];
    this.activitySourceRef = undefined; this.activityNextPage = null; this.activityLoading = false;
    this.active = null; this.ready = false; this.selectedWork = null;
    this.detailId = null; this.messagesBefore = null; this.messagePage = { start: 0, end: 0, total: 0 };
    this.query = defaultWorkspaceQuery(); this.loading = false; this.detailLoading = false;
    this.error = ''; this.localError = ''; this.agentError = '';
  }
  setQuery(query: WorkspaceQuery) {
    if (JSON.stringify(query) === JSON.stringify(this.query)) return;
    this.query = query; this.requestVersion++; this.loading = true;
    this.page = { ...this.page, works: [], deliverables: [], total: 0 }; this.changed();
    void this.refresh().catch(error => this.report(error));
  }
  async selectWork(id: string | null) {
    if (id === this.detailId) return;
    this.detailId = id; this.messagesBefore = null; this.detailCursor = undefined;
    this.detail = null; this.pending = []; this.messages.clear();
    this.messagePage = { start: 0, end: 0, total: 0 };
    this.detailLoading = id !== null; this.requestVersion++; this.changed();
    await this.refresh();
  }
  async pageMessages(direction: 'older' | 'newer' | 'latest') {
    if (!this.detailId) return;
    this.messagesBefore = direction === 'older' ? this.messagePage.start
      : direction === 'latest' || this.messagePage.end + MESSAGE_PAGE_SIZE >= this.messagePage.total ? null : this.messagePage.end + MESSAGE_PAGE_SIZE;
    this.requestVersion++; this.detailLoading = true; this.changed();
    await this.refresh();
  }
  refresh(): Promise<void> {
    if (!this.live) return Promise.resolve();
    this.queued = true;
    if (this.reading) return this.reading;
    const epoch = this.epoch;
    const reading: Promise<void> = this.drain(epoch).finally(() => {
      if (this.reading !== reading) return;
      this.reading = undefined;
      // A subscriber may queue a read in a microtask after drain's final loop
      // check but before this promise settles. Join that read as well.
      if (this.live && epoch === this.epoch && this.queued) return this.refresh();
    });
    this.reading = reading;
    return reading;
  }
  private async drain(epoch: number) {
    while (this.queued && this.live && epoch === this.epoch) {
      this.queued = false;
      const version = this.requestVersion;
      let value: WorkspaceSync;
      try {
        value = await this.transport.invoke('nimigo.workspace.sync', { query: this.query, after: this.cursor,
          ...(this.detailId ? { detail: { id: this.detailId, before: this.messagesBefore, after: this.detailCursor } } : {}) }) as WorkspaceSync;
      } catch (error) {
        if (!this.live || epoch !== this.epoch) return;
        if (version !== this.requestVersion) { this.queued = true; continue; }
        this.loading = false; this.detailLoading = false; this.report(error); return;
      }
      if (!this.live || epoch !== this.epoch) return;
      if (version !== this.requestVersion) { this.queued = true; continue; }
      if (!value?.cursor || !Number.isSafeInteger(value.cursor.scope) || !Number.isSafeInteger(value.cursor.revision)) throw new Error('工作区同步结果无效');
      if (this.cursor && value.cursor.scope < this.cursor.scope) continue;
      if (this.cursor && value.cursor.scope !== this.cursor.scope) {
        this.disconnect(); this.report(new Error('工作区执行范围已变更，请重新连接。')); return;
      }
      this.cursor = value.cursor;
      if (value.state) {
        const { selectionVersion, selectedWork, ...state } = value.state;
        Object.assign(this, state);
        this.error = this.localError || value.state.error;
        if (selectionVersion !== this.lastSelection) this.selectedWork = selectedWork;
        this.lastSelection = selectionVersion;
        for (const record of this.activities) this.activitySources.set(record.source.sourceRef, record.source);
      }
      if (value.page) this.page = value.page;
      if (value.detail && value.detail.cursor.id === this.detailId) {
        this.detailCursor = value.detail.cursor; this.detail = value.detail.work;
        this.pending = value.detail.pending ? [value.detail.pending] : [];
        const { items, ...page } = value.detail.messages; this.messagePage = page;
        this.messages = new Map([[value.detail.work.id, items]]);
      }
      const wasLoading = this.loading || this.detailLoading;
      this.loading = false; this.detailLoading = false;
      if (value.state || value.page || value.detail || wasLoading) this.changed();
    }
  }
  private async call<T>(command: string, args: unknown[] = []): Promise<T> {
    this.localError = '';
    const epoch = this.epoch;
    const result = await this.transport.invoke(`nimigo.${command}`, { args }) as T;
    if (!this.live || epoch !== this.epoch) throw new Error('工作区执行范围已变更');
    await this.refresh();
    return result;
  }
  readonly store = { readText: (path: string) => this.call<string>('deliverable.read', [path]) };
  hydrate = (id: string) => this.selectWork(id);
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
