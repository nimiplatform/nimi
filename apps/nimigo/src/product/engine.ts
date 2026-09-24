import type { NimiLocalAppClient, NimiLocalAppAgentReference, NimiLocalAppConversationMessage, NimiLocalAppConversationToolCall, NimiAppActivityRecord, RealmModel } from '@nimiplatform/sdk';
import { getNimiLocalAppClient } from '../shell/auth/local-app-client';
import { GoStore } from './store';
import { visibleActivities } from './workbench-view';
import { attachMaterial, createWork, deliveredWorkStatus, errorText, nextQueuedWork, nextRoutineTime, now, projectDeliverables, reviseMaterial, reviseWorkDetails, uuid, workCanEdit, workSources, type Work, type Workspace, type Material, type Skill, type Routine } from './model';

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const text = (value: unknown, name: string, max = 16384): string => {
  if (typeof value !== 'string' || !value.trim() || new TextEncoder().encode(value).length > max) throw new Error(`${name}为空或超过长度限制`);
  return value;
};
const schema = (properties: Record<string, unknown>, required: string[]) => JSON.stringify({ type: 'object', properties, required, additionalProperties: false });
const str = { type: 'string' };
export const workTools = [
  { name: 'read_material', description: 'Read a work source or attached material by sourceId. An editedAt material is a user revision, not an original source quotation; preserve its provenance.', inputSchemaJson: schema({ sourceId: str }, ['sourceId']) },
  { name: 'find_deliverables', description: 'Find saved deliverables in this project by title, work name or date. Omit query to browse. Use nextOffset for the next page. Includes archived works; canReviseHere identifies this work only.', inputSchemaJson: schema({ query: str, offset: { type: 'integer', minimum: 0 } }, []) },
  { name: 'read_deliverable', description: 'Read the latest saved deliverable in this project before revising or reusing it.', inputSchemaJson: schema({ deliverableId: str }, ['deliverableId']) },
  { name: 'save_deliverable', description: 'Save a complete Markdown deliverable, up to 24000 UTF-8 bytes. Supply deliverableId only to create a new version of an existing deliverable on this work. Save the actual final content, not a promise.', inputSchemaJson: schema({ title: str, content: str, deliverableId: str, note: str }, ['title', 'content']) },
  { name: 'set_steps', description: 'Set a concise actionable checklist for this work. Completed must reflect actual completed work.', inputSchemaJson: schema({ steps: { type: 'array', maxItems: 12, items: { type: 'object', properties: { title: str, done: { type: 'boolean' } }, required: ['title', 'done'], additionalProperties: false } } }, ['steps']) },
  { name: 'request_input', description: 'Ask the user one essential question. Wait for their actual answer before continuing.', inputSchemaJson: schema({ question: str }, ['question']) },
  { name: 'ecosystem_activity', description: 'Read the current visible Nimi ecosystem activity feed with source and timestamps. Use the current project source selection. Results are a bounded projection with hasMore; absent items may be unloaded. Activity summaries do not prove a source task is completed.', inputSchemaJson: schema({}, []) },
  { name: 'worlds_list', description: 'Query accessible World Studio world records through the public Realm owner. Returns current source IDs and titles.', inputSchemaJson: schema({}, []) },
  { name: 'update_world_summary', description: 'Propose a revised summary for an existing World Studio world. The user reviews the exact before/after and explicitly applies or declines it before a result is returned. Never claim it changed until the tool succeeds.', inputSchemaJson: schema({ worldId: str, summary: str }, ['worldId', 'summary']) },
  { name: 'world_read', description: 'Read a current World Studio source record through its public Realm owner.', inputSchemaJson: schema({ worldId: str }, ['worldId']) },
];

type Pending = { workId: string; call: NimiLocalAppConversationToolCall; question: string; change?: { world: RealmModel<'WorldCoreDto'>; summary: string } };
// @nimi-authority: rule.nimi.nimigo.workbench.delivery
// @nimi-authority: rule.nimi.nimigo.workbench.assignment
export class GoEngine {
  readonly client: NimiLocalAppClient = getNimiLocalAppClient();
  readonly store = new GoStore(this.client);
  workspace: Workspace | null = null;
  works: Work[] = [];
  agents: readonly NimiLocalAppAgentReference[] = [];
  activities: readonly NimiAppActivityRecord[] = [];
  activitySources = new Map<string, NimiAppActivityRecord['source']>();
  activitySourceRef: string | undefined;
  activityNextPage: string | null = null;
  activityLoading = false;
  private activityRequest = 0;
  worlds: readonly RealmModel<'WorldCoreDto'>[] = [];
  messages = new Map<string, readonly NimiLocalAppConversationMessage[]>();
  active: string | null = null;
  pending: Pending | null = null;
  error = '';
  agentError = '';
  ready = false;
  selectedWork: string | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private openRegistration: { stop: () => Promise<void> } | undefined;
  private revision = 0;
  private listeners = new Set<() => void>();
  private edits = Promise.resolve();
  private init: Promise<void> | null = null;
  private handled = new Set<string>();
  private runEpoch = 0;
  private queueSequence = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  snapshot = () => this.revision;
  changed() { this.revision++; for (const listener of this.listeners) listener(); }
  report(error: unknown) { this.error = errorText(error); this.changed(); }
  clearError() { this.error = ''; this.changed(); }
  get agent() { return this.agents.find(a => a.agentBinding === this.workspace?.agentBinding); }
  getWork(id: string) { const value = this.works.find(w => w.id === id); if (!value) throw new Error('找不到这项工作'); return value; }
  private serialize(fn: () => Promise<void>) { const result = this.edits.then(fn); this.edits = result.catch(() => {}); return result; }
  private isRunCurrent(workId: string, epoch: number) { return this.ready && this.active === workId && this.runEpoch === epoch; }
  private checkRun(workId: string, epoch: number) { if (!this.isRunCurrent(workId, epoch)) throw new Error('这轮执行已结束，忽略迟到结果。'); }
  async modifyWork(id: string, update: (work: Work) => void, check?: () => void) {
    check?.();
    await this.serialize(async () => {
      check?.();
      const work = structuredClone(this.getWork(id)); update(work); work.updatedAt = now();
      await this.store.saveWork(work, check); check?.();
      this.works = this.works.map(w => w.id === id ? work : w); this.changed();
    });
  }
  async modifyWorkspace(update: (workspace: Workspace) => void) {
    await this.serialize(async () => { if (!this.workspace) return; const next = structuredClone(this.workspace); update(next); await this.store.saveWorkspace(next); this.workspace = next; this.changed(); });
  }
  initialize() {
    return this.init ??= (async () => {
      try {
        const loaded = await this.store.load(); this.workspace = loaded.workspace; this.works = loaded.works;
        await this.refreshAgents();
        // Reopening never replays an App effect or a submitted user turn.
        for (const work of this.works.filter(w => ['running', 'needs-input', 'queued', 'uncertain'].includes(w.status))) {
          const attempt = work.attempts.at(-1);
          // run persists an attempt before sending. A queue entry does not create one.
          // Earlier terminal attempts are history, not the result of the new queued request.
          if (!attempt || (work.status === 'queued' && !['running', 'uncertain'].includes(attempt.status))) {
            await this.modifyWork(work.id, w => { w.status = 'draft'; w.question = undefined; w.error = undefined; });
            continue;
          }
          const reference = this.agents.find(a => a.agentBinding === attempt?.agentBinding);
          let restored: 'complete' | 'review' | 'failed' | 'stopped' | 'uncertain' = 'uncertain';
          if (attempt?.turnId && attempt.anchorId && reference) {
            try {
              const snapshot = await this.client.conversation.snapshot({ agentHandle: reference.agentHandle, conversationAnchorId: attempt.anchorId });
              const turn = snapshot.turns.find(t => t.turnId === attempt.turnId);
              restored = turn?.status === 'completed' ? deliveredWorkStatus(work, turn.turnId) : turn?.status === 'failed' ? 'failed' : turn?.status === 'interrupted' ? 'stopped' : 'uncertain';
              this.messages.set(work.id, snapshot.messages.filter(m => work.attempts.some(a => a.turnId === m.turnId)));
            } catch { /* The work remains explicitly uncertain until the owner can be observed. */ }
          }
          await this.modifyWork(work.id, w => {
            w.status = work.status === 'queued' && restored !== 'uncertain' ? 'draft' : restored;
            w.question = undefined;
            w.error = restored === 'uncertain' ? '本次委托可能已经提交。请先核对执行结果与已保存成果，不会自动重新执行。' : undefined;
            w.attempts.at(-1)!.status = restored;
          });
        }
        const startedAt = new Date();
        await this.modifyWorkspace(w => { for (const routine of w.routines) { if (routine.enabled && new Date(routine.nextAt) < startedAt) { routine.missedAt = routine.nextAt; routine.nextAt = nextRoutineTime(routine.time, startedAt); } } });
        this.openRegistration = this.client.activity.onOpenRequest(async request => {
          const work = this.works.find(w => w.id === request.objectRef); if (!work) return 'object-unavailable';
          this.selectedWork = work.id; this.changed(); return 'opened';
        });
        this.timer = setInterval(() => { void this.checkRoutines().catch(error => this.report(error)); }, 15000);
        this.ready = true; this.changed();
      } catch (error) { this.report(error); }
    })();
  }
  dispose() {
    this.ready = false;
    if (this.timer) clearInterval(this.timer);
    void this.openRegistration?.stop();
    if (this.active) void this.stop(this.active).catch(() => {});
  }
  async refreshAgents() {
    try { this.agents = await this.client.agents.listReferences(); this.agentError = ''; }
    catch (error) { this.agents = []; this.agentError = errorText(error); }
    this.changed();
  }
  async assign(binding: string) {
    if (this.active) throw new Error('请先停止当前工作，再更换搭档');
    await this.refreshAgents(); if (!this.agents.some(a => a.agentBinding === binding)) throw new Error('这位 Agent 当前不可用');
    await this.modifyWorkspace(w => { w.agentBinding = binding; });
  }
  async addProject(name: string, description: string) {
    if (new TextEncoder().encode(description).length > 8192) throw new Error('项目背景最多 8 KiB');
    const project = { id: uuid(), name: text(name.trim(), '项目名称', 256), description: description.trim(), archived: false, createdAt: now() };
    await this.modifyWorkspace(w => { w.projects.push(project); }); return project;
  }
  async updateProject(id: string, name: string, description: string) {
    text(name.trim(), '项目名称', 256);
    if (new TextEncoder().encode(description).length > 8192) throw new Error('项目背景最多 8 KiB');
    await this.modifyWorkspace(workspace => {
      const project = workspace.projects.find(p => p.id === id && !p.archived);
      if (!project) throw new Error('找不到这个项目');
      if (this.works.some(work => work.projectId === id && !workCanEdit(work))) throw new Error('请先结束或核对项目中的执行，再修改项目背景。');
      project.name = name.trim(); project.description = description.trim();
    });
  }
  async addWork(projectId: string, title: string, brief: string, skillId: string, select = true) {
    const work = createWork(projectId, title, brief, skillId);
    await this.serialize(async () => {
      if (!this.workspace) throw new Error('工作区尚未就绪');
      this.validateWorkReferences(projectId, skillId);
      await this.store.saveWork(work); const next = structuredClone(this.workspace); next.workIds.unshift(work.id);
      await this.store.saveWorkspace(next); this.workspace = next; this.works = [work, ...this.works]; if (select) this.selectedWork = work.id; this.changed();
    }); return work;
  }
  async addMaterial(id: string, title: string, content: string, origin?: Material['origin']) {
    const material: Material = { id: uuid(), title: text(title, '资料名称', 256), content: text(content, '资料内容', 16384), createdAt: now(), ...(origin ? { origin } : {}) };
    await this.modifyWork(id, work => {
      attachMaterial(work, material);
    }); return material;
  }
  private validateWorkReferences(projectId: string, skillId: string) {
    if (!this.workspace?.projects.some(p => p.id === projectId && !p.archived)) throw new Error('请选择可用的项目');
    if (!this.workspace.skills.some(skill => skill.id === skillId)) throw new Error('请选择可用的工作方法');
  }
  async updateWorkDetails(id: string, patch: Pick<Work, 'title' | 'brief' | 'projectId' | 'skillId'>) {
    await this.modifyWork(id, work => {
      this.validateWorkReferences(patch.projectId, patch.skillId);
      reviseWorkDetails(work, patch);
      work.history.push({ id: uuid(), at: now(), text: '你更新了工作信息，已有成果与执行记录保留' });
    });
  }
  async updateMaterial(workId: string, materialId: string, title: string, content: string) {
    await this.modifyWork(workId, work => {
      const revised = reviseMaterial(work, materialId, title, content);
      work.history.push({ id: uuid(), at: now(), text: `你修订了资料「${revised.title}」，等待按新资料执行` });
    });
    return this.getWork(workId).materials.find(material => material.id === materialId)!;
  }
  async saveDeliverable(workId: string, title: string, content: string, by: 'user' | 'agent', deliverableId?: string, note = '', check?: () => void) {
    check?.();
    text(content, '成果内容', 24000); text(title, '成果名称', 256);
    const id = deliverableId || uuid(); const turnId = by === 'agent' ? this.getWork(workId).attempts.at(-1)?.turnId : null; const revision = { id: uuid(), path: '', createdAt: now(), by, note, ...(turnId ? { turnId } : {}) };
    revision.path = `nimigo/deliverables/${id}/${revision.id}.md`;
    if (deliverableId && !this.getWork(workId).deliverables.some(d => d.id === deliverableId)) throw new Error('此成果不属于当前工作');
    await this.store.writeText(revision.path, content, check);
    check?.();
    await this.modifyWork(workId, work => {
      const existing = work.deliverables.find(d => d.id === id);
      if (existing) { existing.title = title; existing.revisions.push(revision); }
      else work.deliverables.push({ id, title, revisions: [revision] });
      work.history.push({ id: uuid(), at: now(), text: `${by === 'agent' ? 'Agent' : '你'}保存了「${title}」的新版本` });
    }, check); return { deliverableId: id, title, revision: revision.id, saved: true };
  }
  async saveSkill(skill: Skill) {
    text(skill.name, '方法名称', 128); text(skill.instructions, '方法步骤', 6144);
    if (skill.materials) text(skill.materials, '所需资料', 1024);
    if (skill.result) text(skill.result, '交付结果', 1024);
    await this.modifyWorkspace(w => { const index = w.skills.findIndex(s => s.id === skill.id); if (index >= 0) w.skills[index] = skill; else w.skills.push(skill); });
  }
  async saveRoutine(routine: Routine) { text(routine.name, '例行名称', 128); text(routine.brief, '例行目标', 12000); nextRoutineTime(routine.time); await this.modifyWorkspace(w => { const index = w.routines.findIndex(r => r.id === routine.id); if (index >= 0) w.routines[index] = routine; else w.routines.push(routine); }); }
  // @nimi-authority: rule.nimi.nimigo.workbench.routines
  async checkRoutines() {
    if (!this.ready || !this.workspace || !this.agent) return;
    for (const routine of this.workspace.routines.filter(r => r.enabled && new Date(r.nextAt) <= new Date())) await this.runRoutine(routine.id, true);
  }
  async runRoutine(id: string, scheduled = false) {
    const routine = this.workspace?.routines.find(r => r.id === id); if (!routine) return;
    await this.modifyWorkspace(w => { const r = w.routines.find(r => r.id === id)!; r.nextAt = nextRoutineTime(r.time); r.missedAt = undefined; });
    const work = await this.addWork(routine.projectId, `${routine.name} · ${new Date().toLocaleDateString('zh-CN')}`, routine.brief, routine.skillId, !scheduled);
    await this.modifyWorkspace(w => { w.routines.find(r => r.id === id)!.lastWorkId = work.id; });
    void this.run(work.id, undefined, scheduled ? routine.name : undefined).catch(error => this.report(error));
  }
  async refreshWorlds() { this.worlds = await this.client.realm.worldCore.list(); this.changed(); }
  async refreshActivities(sourceRef: string | null = this.activitySourceRef || null, append = false) {
    const request = ++this.activityRequest;
    const pageToken = append ? this.activityNextPage : undefined;
    if (append && !pageToken) return;
    if ((sourceRef || undefined) !== this.activitySourceRef) { this.activities = []; this.activityNextPage = null; }
    this.activityLoading = true; this.changed();
    try {
      const page = await this.client.activity.list({ pageSize: 50, ...(sourceRef ? { filter: { sourceRef } } : {}), ...(pageToken ? { pageToken } : {}) });
      if (request !== this.activityRequest) return;
      this.activitySourceRef = sourceRef || undefined;
      this.activities = [...new Map([...(append ? this.activities : []), ...page.records].map(record => [record.activityId, record])).values()];
      this.activityNextPage = page.nextPageToken;
      for (const record of page.records) this.activitySources.set(record.source.sourceRef, record.source);
    } finally { if (request === this.activityRequest) { this.activityLoading = false; this.changed(); } }
  }
  async hydrate(workId: string) {
    const work = this.getWork(workId); const groups = new Map<string, { agentHandle: NimiLocalAppAgentReference['agentHandle']; anchor: string }>();
    for (const attempt of work.attempts) { const ref = this.agents.find(a => a.agentBinding === attempt.agentBinding); if (ref && attempt.anchorId) groups.set(attempt.anchorId, { agentHandle: ref.agentHandle, anchor: attempt.anchorId }); }
    const messages: NimiLocalAppConversationMessage[] = [];
    for (const { agentHandle, anchor } of groups.values()) { const snapshot = await this.client.conversation.snapshot({ agentHandle, conversationAnchorId: anchor }); messages.push(...snapshot.messages.filter(m => work.attempts.some(a => a.turnId === m.turnId))); }
    this.messages.set(workId, messages); this.changed();
  }
  async run(workId: string, followup?: string, routineName?: string) {
    if (!this.workspace || !this.agent) throw new Error('请先任命一位现有 Agent');
    const requested = this.getWork(workId);
    followup ??= requested.queuedInput?.followup ?? (['failed', 'stopped'].includes(requested.status) ? requested.attempts.at(-1)?.input : undefined);
    if (this.active) {
      if (this.active === workId) throw new Error('这项工作正在进行');
      const sequence = ++this.queueSequence;
      await this.modifyWork(workId, w => {
        if (w.status === 'queued') throw new Error('这项工作已在队列中');
        w.status = 'queued'; w.queuedInput = { sequence, followup, routineName }; w.error = undefined;
      });
      this.startNextQueued(); return;
    }
    this.active = workId; const epoch = ++this.runEpoch; this.handled.clear(); this.error = ''; this.changed();
    const check = () => this.checkRun(workId, epoch);
    let accepted = false; let submitting = false; let attemptId: string | undefined;
    try {
      await this.refreshAgents(); check(); const agent = this.agent; if (!agent) throw new Error('任职 Agent 当前不可用，请重新选择');
      const work = this.getWork(workId); const opened = await this.client.conversation.open({ agentHandle: agent.agentHandle });
      check();
      if (opened.activeTurnId) throw new Error('这位 Agent 正在别处工作。请稍后重试，当前工作仍保留。');
      const attempt = { id: uuid(), agentBinding: agent.agentBinding, turnId: null as string | null, anchorId: opened.conversationAnchorId, startedAt: now(), status: 'running' as const, input: followup || work.brief };
      attemptId = attempt.id;
      await this.modifyWork(workId, w => { w.status = 'running'; w.queuedInput = undefined; w.error = undefined; w.question = undefined; w.attempts.push(attempt); }, check);
      const skill = this.workspace.skills.find(s => s.id === work.skillId);
      submitting = true;
      const sent = await this.client.conversation.send({ agentHandle: agent.agentHandle, conversationAnchorId: opened.conversationAnchorId, requestId: attempt.id,
        parts: [{ kind: 'text', text: followup || work.brief }],
        work: { workId, ...(routineName ? { routineName } : {}), instructions: `当前 NimiGo 工作：${work.title}。本轮只执行当前工作目标和本次委托，历史中的其他工作不构成本轮任务。请结合项目背景，按资料目录读取相关内容；带 editedAt 的资料是用户修订稿，不能冒充来源原文。其他工作成果可读取；canReviseHere=false 的成果不能在这里改写，复用时另存新成果并省略 deliverableId。近期目录未列出的成果通过 find_deliverables 查找。新成果必须调用 save_deliverable；只有成功结果才能说明已交付。面向用户的回复和成果用来源名称、版本和时间说明，不展示内部标识和工具名称。\n${skill?.instructions || '完成目标，保存成果；缺少必要信息时询问。'}`, sources: workSources(work, this.workspace, this.works), tools: workTools },
      }); accepted = true; check();
      await this.modifyWork(workId, w => { w.attempts.find(a => a.id === attempt.id)!.turnId = sent.turnId; }, check);
      const scope = { agentHandle: agent.agentHandle, conversationAnchorId: opened.conversationAnchorId, turnId: sent.turnId };
      while (epoch === this.runEpoch) {
        const calls = await this.client.conversation.listToolCalls(scope);
        if (!this.isRunCurrent(workId, epoch)) return;
        for (const call of calls) {
          check();
          if (this.pending) break;
          if (this.handled.has(call.callId)) continue;
          if (call.name === 'update_world_summary') {
            try {
              const args = JSON.parse(call.argumentsJson) as { worldId: string; summary: string };
              const world = await this.client.realm.worldCore.get(text(args.worldId, 'World ID', 256));
              check();
              if (!world.lorebookDeclaration) throw new Error('源 World 缺少正式 lorebook 声明，请先在 World Studio 修复。');
              this.pending = { workId, call, question: `审核对「${world.core.identity.name}」的摘要修改`, change: { world, summary: text(args.summary, '摘要', 8192) } };
              await this.modifyWork(workId, w => { w.status = 'needs-input'; w.question = this.pending!.question; }, check);
            } catch (error) { if (!this.isRunCurrent(workId, epoch)) return; this.handled.add(call.callId); await this.client.conversation.submitToolResult({ ...scope, callId: call.callId, resultJson: JSON.stringify({ error: errorText(error) }), isError: true }); }
            continue;
          }
          if (call.name === 'request_input') {
            const args = JSON.parse(call.argumentsJson) as { question: string };
            this.pending = { workId, call, question: text(args.question, '问题', 4096) };
            await this.modifyWork(workId, w => { w.status = 'needs-input'; w.question = args.question; }, check);
            continue;
          }
          this.handled.add(call.callId);
          let result: unknown; let isError = false;
          try { result = await this.executeTool(workId, call, check); }
          catch (error) { result = { error: errorText(error) }; isError = true; }
          if (!this.isRunCurrent(workId, epoch)) return;
          await this.client.conversation.submitToolResult({ ...scope, callId: call.callId, resultJson: JSON.stringify(result), isError });
        }
        check();
        const snapshot = await this.client.conversation.snapshot(scopeWithoutTurn(scope));
        check();
        const current = this.getWork(workId);
        const merged = new Map((this.messages.get(workId) || []).map(m => [m.messageId, m]));
        for (const message of snapshot.messages.filter(m => current.attempts.some(a => a.turnId === m.turnId))) merged.set(message.messageId, message);
        this.messages.set(workId, [...merged.values()]); this.changed();
        const turn = snapshot.turns.find(t => t.turnId === sent.turnId);
        if (turn && turn.status !== 'active') {
          const status = turn.status === 'completed' ? deliveredWorkStatus(this.getWork(workId), turn.turnId) : turn.status === 'interrupted' ? 'stopped' : 'failed';
          await this.modifyWork(workId, w => { w.status = status; w.question = undefined; w.attempts.find(a => a.id === attempt.id)!.status = turn.status === 'completed' ? 'complete' : status; w.error = turn.status === 'failed' ? errorText({ message: turn.message || undefined, reasonCode: turn.reasonCode || undefined }) : status === 'review' ? '搭档已回复，但还没有保存新的成果。你可以继续委托，或把回复保存为成果。' : undefined; }, check);
          if (status === 'complete' && this.workspace.notifyHome) await this.publish(workId, check).catch(error => { if (this.isRunCurrent(workId, epoch)) this.report(error); });
          break;
        }
        await delay(650);
      }
    } catch (error) {
      if (!this.isRunCurrent(workId, epoch)) return;
      const status = accepted || submitting ? 'uncertain' : 'failed';
      await this.modifyWork(workId, w => { w.status = status; w.error = errorText(error); const attempt = w.attempts.find(a => a.id === attemptId); if (attempt) attempt.status = status; }, check).catch(e => { if (this.isRunCurrent(workId, epoch)) this.report(e); });
      if (this.isRunCurrent(workId, epoch)) this.report(error);
    } finally {
      if (epoch === this.runEpoch) { this.active = null; this.pending = null; this.changed(); this.startNextQueued(); }
    }
  }
  private startNextQueued() {
    if (!this.ready || this.active) return;
    try {
      const next = nextQueuedWork(this.works);
      if (next) void this.run(next.id, next.queuedInput?.followup, next.queuedInput?.routineName).catch(error => this.report(error));
    } catch (error) { this.report(error); }
  }
  async answer(answer: string) {
    const pending = this.pending; const agent = this.agent; if (!pending || !agent) throw new Error('问题已失效，请查看当前工作状态');
    const epoch = this.runEpoch; const check = () => this.checkRun(pending.workId, epoch);
    const attempt = this.getWork(pending.workId).attempts.at(-1)!;
    try {
      check();
      await this.client.conversation.submitToolResult({ agentHandle: agent.agentHandle, conversationAnchorId: attempt.anchorId!, turnId: pending.call.turnId, callId: pending.call.callId, resultJson: JSON.stringify({ answer: text(answer, '回答', 12000) }), isError: false });
      if (!this.isRunCurrent(pending.workId, epoch) || this.pending !== pending) return;
      this.handled.add(pending.call.callId); this.pending = null;
      await this.modifyWork(pending.workId, w => { w.status = 'running'; w.question = undefined; w.history.push({ id: uuid(), at: now(), text: '已提交你的补充回答' }); }, check);
    } catch (error) { if (this.isRunCurrent(pending.workId, epoch)) throw error; }
  }
  // @nimi-authority: rule.nimi.nimigo.workbench.ecosystem
  async decideWorldChange(apply: boolean) {
    const pending = this.pending; const agent = this.agent;
    if (!pending?.change || !agent) throw new Error('来源修改请求已结束');
    const epoch = this.runEpoch; const check = () => this.checkRun(pending.workId, epoch); check();
    if (this.handled.has(pending.call.callId)) throw new Error('正在处理这次决定，请稍候');
    this.handled.add(pending.call.callId);
    const attempt = this.getWork(pending.workId).attempts.at(-1)!;
    let result: unknown = { applied: false, reason: 'user-declined' }; let isError = false;
    try {
      if (apply) {
        const { world, summary } = pending.change;
        const changed = await this.client.realm.worldCore.replace(world.id, { baseContentHash: world.contentHash, core: { ...world.core, identity: { ...world.core.identity, summary } }, lorebookDeclaration: world.lorebookDeclaration!, origin: world.origin, visibility: world.visibility });
        check();
        result = { applied: true, worldId: changed.id, contentHash: changed.contentHash, summary: changed.core.identity.summary, updatedAt: changed.updatedAt };
        await this.modifyWork(pending.workId, w => { w.history.push({ id: uuid(), at: now(), text: `已更新 World Studio 中「${changed.core.identity.name}」的摘要`, kind: 'source-update', ...(attempt.turnId ? { turnId: attempt.turnId } : {}) }); }, check);
      }
    } catch (error) { if (!this.isRunCurrent(pending.workId, epoch)) return; result = { error: errorText(error) }; isError = true; }
    if (!this.isRunCurrent(pending.workId, epoch) || this.pending !== pending) return;
    this.handled.add(pending.call.callId);
    try {
      await this.client.conversation.submitToolResult({ agentHandle: agent.agentHandle, conversationAnchorId: attempt.anchorId!, turnId: pending.call.turnId, callId: pending.call.callId, resultJson: JSON.stringify(result), isError });
      if (!this.isRunCurrent(pending.workId, epoch) || this.pending !== pending) return;
      this.pending = null;
      await this.modifyWork(pending.workId, w => { w.status = 'running'; w.question = undefined; }, check);
    } catch (error) { if (this.isRunCurrent(pending.workId, epoch)) throw error; }
  }
  async refreshWorkStatus(workId: string): Promise<boolean> {
    const work = this.getWork(workId); const attempt = work.attempts.at(-1);
    await this.refreshAgents();
    const ref = this.agents.find(a => a.agentBinding === attempt?.agentBinding);
    if (!attempt?.anchorId || !attempt.turnId || !ref) throw new Error('无法定位这项工作的执行记录，请确认原搭档仍可用。');
    const snapshot = await this.client.conversation.snapshot({ agentHandle: ref.agentHandle, conversationAnchorId: attempt.anchorId });
    const turn = snapshot.turns.find(t => t.turnId === attempt.turnId);
    if (!turn || turn.status === 'active') { await this.modifyWork(workId, w => { w.error = turn ? '这次委托仍在执行。可稍后核对，或先停止未决执行；已有成果保留。' : '还未找到这次委托的结果。资料和已有成果保留，可稍后再次核对。'; }); return false; }
    const status = turn.status === 'completed' ? deliveredWorkStatus(work, turn.turnId) : turn.status === 'interrupted' ? 'stopped' : 'failed';
    await this.modifyWork(workId, w => {
      w.status = status; w.question = undefined;
      w.attempts.find(a => a.id === attempt.id)!.status = status;
      w.error = turn.status === 'failed' ? errorText({ message: turn.message || undefined, reasonCode: turn.reasonCode || undefined }) : status === 'review' ? '这轮已结束，但没有保存新的成果。已有成果仍然保留。' : undefined;
    });
    await this.hydrate(workId);
    return true;
  }
  async stop(workId: string) {
    if (this.getWork(workId).status === 'queued' && this.active === workId) throw new Error('这项工作正在开始，请等当前轮次就绪后再停止。');
    if (this.getWork(workId).status === 'queued') { await this.modifyWork(workId, w => { w.status = 'stopped'; w.queuedInput = undefined; }); return; }
    const attempt = this.getWork(workId).attempts.at(-1); const ref = this.agents.find(a => a.agentBinding === attempt?.agentBinding);
    if (!attempt?.anchorId || !attempt.turnId || !ref) throw new Error('当前执行无法定位，请刷新 Agent 与工作记录');
    try {
      await this.client.conversation.interruptTurn({ agentHandle: ref.agentHandle, conversationAnchorId: attempt.anchorId, expectedTurnId: attempt.turnId });
    } catch (error) {
      const reason = (error as { reasonCode?: string; code?: string });
      if ([reason.reasonCode, reason.code].some(code => code === 'agent-turn-not-active' || code === 'AGENT_TURN_NOT_ACTIVE')) {
        if (await this.refreshWorkStatus(workId)) return;
      }
      throw error;
    }
    if (this.active === workId) { this.runEpoch++; this.active = null; this.pending = null; }
    await this.modifyWork(workId, w => { w.status = 'stopped'; w.question = undefined; w.error = undefined; w.attempts.find(a => a.id === attempt.id)!.status = 'stopped'; });
    this.startNextQueued();
  }
  async publish(workId: string, check?: () => void) {
    check?.();
    const work = this.getWork(workId);
    await this.client.activity.put({ key: `work:${work.id}`, revision: Date.now(), kind: 'activity', attention: true, title: `已交付 · ${work.title}`, summary: work.deliverables.length ? `${work.deliverables.length} 份成果已保存，可继续编辑和复用。` : 'Agent 已完成本轮回复，打开查看详细结果。', objectRef: work.id, type: 'nimi.go.work-completed.v1', occurredAt: now(), ...(this.agent ? { agentHandle: this.agent.agentHandle } : {}) });
  }
  private async executeTool(workId: string, call: NimiLocalAppConversationToolCall, check: () => void): Promise<unknown> {
    check();
    const args = JSON.parse(call.argumentsJson) as Record<string, unknown>; const work = this.getWork(workId);
    switch (call.name) {
      case 'read_material': {
        const source = workSources(work, this.workspace!, this.works).find(item => item.sourceId === args.sourceId);
        if (source) return source;
        const material = work.materials.find(m => m.id === args.sourceId);
        if (!material) throw new Error('找不到这份资料');
        return { ...material, provenance: material.editedAt ? '用户修订稿；不能当作来源原文引用' : material.origin ? '来源摘录' : '用户资料' };
      }
      case 'find_deliverables': {
        if (args.query !== undefined && (typeof args.query !== 'string' || args.query.length > 128)) throw new Error('查询最多 128 个字符');
        const offset = args.offset ?? 0;
        if (typeof offset !== 'number' || !Number.isSafeInteger(offset) || offset < 0) throw new Error('查询起点无效');
        const docs = projectDeliverables(work, this.works, args.query as string | undefined);
        return { total: docs.length, deliverables: docs.slice(offset, offset + 10), nextOffset: offset + 10 < docs.length ? offset + 10 : null };
      }
      case 'read_deliverable': { const owner = this.works.find(w => w.projectId === work.projectId && w.deliverables.some(d => d.id === args.deliverableId)); const doc = owner?.deliverables.find(d => d.id === args.deliverableId); if (!doc) throw new Error('找不到本项目中的成果'); return { title: doc.title, content: await this.store.readText(doc.revisions.at(-1)!.path), revision: doc.revisions.at(-1)!.id }; }
      case 'save_deliverable': return this.saveDeliverable(workId, text(args.title, '名称', 256), text(args.content, '内容', 24000), 'agent', typeof args.deliverableId === 'string' ? args.deliverableId : undefined, typeof args.note === 'string' ? args.note : 'Agent 交付', check);
      case 'set_steps': { const steps = args.steps as { title: string; done: boolean }[]; if (!Array.isArray(steps) || steps.length > 12) throw new Error('工作步骤超出范围'); await this.modifyWork(workId, w => { w.steps = steps.map(s => ({ id: uuid(), title: text(s.title, '步骤', 256), done: s.done === true })); }, check); return { saved: true, steps }; }
      case 'ecosystem_activity': {
        const project = this.workspace!.projects.find(p => p.id === work.projectId)!;
        const page = await this.client.activity.list({ pageSize: 50, ...(project.sourceRef ? { filter: { sourceRef: project.sourceRef } } : {}) });
        const records = visibleActivities(page.records);
        return { scope: { project: project.name, sourceRef: project.sourceRef || null, sourceKind: 'app' }, hasMore: Boolean(page.nextPageToken) || records.length > 15, note: '仅本次已载入的应用动态，不包含 Runtime 对话通知。未载入不代表不存在；需要完整源事实时打开来源核对。', records: records.slice(0, 15).map(a => ({ activityId: a.activityId, title: a.title, summary: a.summary, source: a.source.displayName || a.source.appId, updatedAt: a.updatedAt, kind: a.kind, todoState: a.todoState })) };
      }
      case 'worlds_list': { const worlds = await this.client.realm.worldCore.list(); return worlds.map(w => ({ id: w.id, name: w.core.identity.name, description: w.core.identity })).slice(0, 30); }
      case 'world_read': { const world = await this.client.realm.worldCore.get(text(args.worldId, 'World ID', 256)); const value = JSON.stringify(world); if (new TextEncoder().encode(value).length > 30000) throw new Error('源 World 超过单次工具结果上限，请在来源中选择需要的资料片段'); return world; }
      default: throw new Error(`未知技能：${call.name}`);
    }
  }
}
function scopeWithoutTurn(scope: { agentHandle: NimiLocalAppAgentReference['agentHandle']; conversationAnchorId: string }) { return { agentHandle: scope.agentHandle, conversationAnchorId: scope.conversationAnchorId }; }
export const engine = new GoEngine();

if (import.meta.hot) import.meta.hot.dispose(() => engine.dispose());
