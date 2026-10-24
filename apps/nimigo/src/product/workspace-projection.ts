import type { GoEngine, Pending } from './engine';
import { workCanEdit, type Work, type WorkMessage, type Workspace } from './model';
import { attentionWorks } from './workbench-view';

export const WORKSPACE_CHANGED = 'nimigo.workspace.changed';
export const WORK_PAGE_SIZE = 50;
export const MESSAGE_PAGE_SIZE = 40;
export type WorkspaceQuery = {
  view: 'work' | 'deliverables' | 'targets';
  projectId: string;
  archived: boolean;
  attentionOnly: boolean;
  search: string;
  offset: number;
};
export const defaultWorkspaceQuery = (): WorkspaceQuery => ({ view: 'work', projectId: 'all', archived: false, attentionOnly: false, search: '', offset: 0 });
export type WorkSummary = Pick<Work, 'id' | 'projectId' | 'title' | 'brief' | 'status' | 'updatedAt' | 'archived' | 'question'> & {
  queuedInput?: { sequence: number };
  deliverableCount: number;
};
export type DeliverableSummary = { id: string; title: string; workId: string; workTitle: string; versionCount: number; updatedAt: string };
export type CatalogPage = {
  works: WorkSummary[];
  deliverables: DeliverableSummary[];
  total: number;
  offset: number;
  pageSize: number;
  allWorkCount: number;
  attentionCount: number;
  attention: WorkSummary[];
  recentDeliverables: DeliverableSummary[];
};
export const emptyCatalogPage = (): CatalogPage => ({ works: [], deliverables: [], total: 0, offset: 0, pageSize: WORK_PAGE_SIZE, allWorkCount: 0, attentionCount: 0, attention: [], recentDeliverables: [] });
export type GoState = Pick<GoEngine, 'agents' | 'activities' | 'activitySourceRef' | 'activityNextPage' | 'activityLoading' | 'worlds' | 'active' | 'error' | 'agentError' | 'ready' | 'selectedWork' | 'integrationTargets' | 'selectionVersion'> & { workspace: Omit<Workspace, 'workIds'> | null };
export type WorkspaceCursor = { scope: number; revision: number; queryKey: string };
export type DetailCursor = { scope: number; version: number; id: string; before: number | null };
export type WorkDetailPage = { cursor: DetailCursor; work: Work; pending?: Pending; messages: { items: WorkMessage[]; start: number; end: number; total: number } };
export type WorkspaceSyncRequest = { query: WorkspaceQuery; after?: WorkspaceCursor; detail?: { id: string; before: number | null; after?: DetailCursor } };
export type WorkspaceSync = { cursor: WorkspaceCursor; state?: GoState; page?: CatalogPage; detail?: WorkDetailPage };

export function parseWorkspaceQuery(raw: unknown): WorkspaceQuery {
  const value = raw as WorkspaceQuery | undefined;
  if (!value || !['work', 'deliverables', 'targets'].includes(value.view) || typeof value.projectId !== 'string'
    || typeof value.archived !== 'boolean' || typeof value.attentionOnly !== 'boolean' || typeof value.search !== 'string'
    || value.search.length > 4096 || !Number.isSafeInteger(value.offset) || value.offset < 0) throw new Error('工作列表查询无效');
  return { view: value.view, projectId: value.projectId, archived: value.archived, attentionOnly: value.attentionOnly, search: value.search, offset: value.offset };
}

/** Host-owned read projection. It never truncates the set searched or counted. */
// @nimi-authority: rule.nimi.nimigo.workbench.background-delivery
export class GoWorkspaceProjection {
  private summaries = new WeakMap<Work, WorkSummary>();
  private detailVersions = new WeakMap<Work, { pending: Pending | undefined; version: number }>();
  private nextDetailVersion = 0;
  constructor(private engine: GoEngine, private scope: number) {}

  private summary(work: Work): WorkSummary {
    let value = this.summaries.get(work);
    if (!value) {
      value = { id: work.id, projectId: work.projectId, title: work.title, brief: work.brief.slice(0, 240), status: work.status,
        updatedAt: work.updatedAt, archived: work.archived, deliverableCount: work.deliverables.length,
        ...(work.question ? { question: work.question.slice(0, 240) } : {}),
        ...(work.queuedInput ? { queuedInput: { sequence: work.queuedInput.sequence } } : {}) };
      this.summaries.set(work, value);
    }
    return value;
  }

  catalog(query: WorkspaceQuery): CatalogPage {
    const works = this.engine.works;
    const inProject = (work: Work) => query.projectId === 'all' || work.projectId === query.projectId;
    const projectWorks = works.filter(work => !work.archived && inProject(work));
    const attention = attentionWorks(projectWorks);
    const attentionIds = new Set(attention.map(work => work.id));
    const docs = projectWorks.flatMap(work => work.deliverables.map(doc => ({ id: doc.id, title: doc.title, workId: work.id,
      workTitle: work.title, versionCount: doc.revisions.length, updatedAt: doc.revisions.at(-1)!.createdAt })));
    const search = query.search.toLowerCase();
    const foundWorks = query.view === 'deliverables' ? [] : works.filter(work => inProject(work)
      && (query.view === 'targets' ? !work.archived && workCanEdit(work) : work.archived === query.archived)
      && (query.view !== 'work' || !query.attentionOnly || attentionIds.has(work.id))
      && (!search || `${work.title} ${work.brief}`.toLowerCase().includes(search)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    // Preserve the existing library order; only the "recent" strip sorts by latest revision.
    const foundDocs = query.view === 'deliverables' ? docs.filter(doc => !search || doc.title.toLowerCase().includes(search)) : [];
    const total = query.view === 'deliverables' ? foundDocs.length : foundWorks.length;
    const offset = Math.min(query.offset, Math.max(0, Math.ceil(total / WORK_PAGE_SIZE) - 1) * WORK_PAGE_SIZE);
    return { works: foundWorks.slice(offset, offset + WORK_PAGE_SIZE).map(work => this.summary(work)),
      deliverables: foundDocs.slice(offset, offset + WORK_PAGE_SIZE), total, offset, pageSize: WORK_PAGE_SIZE,
      allWorkCount: works.filter(work => !work.archived).length, attentionCount: attention.length,
      attention: attention.slice(0, 3).map(work => this.summary(work)),
      recentDeliverables: [...docs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3) };
  }

  sync(request: WorkspaceSyncRequest): WorkspaceSync {
    const query = parseWorkspaceQuery(request.query);
    const cursor = { scope: this.scope, revision: this.engine.snapshot(), queryKey: JSON.stringify(query) };
    const response: WorkspaceSync = { cursor };
    // A prior scope cannot select or read a work in its replacement scope.
    if (request.after && request.after.scope !== this.scope) return response;
    if (request.after?.scope !== cursor.scope || request.after.revision !== cursor.revision || request.after.queryKey !== cursor.queryKey) {
      const value = this.engine;
      const { workIds: _workIds, ...workspace } = value.workspace || { workIds: [] };
      response.state = { workspace: value.workspace ? workspace as Omit<Workspace, 'workIds'> : null,
        agents: value.agents, activities: value.activities, activitySourceRef: value.activitySourceRef,
        activityNextPage: value.activityNextPage, activityLoading: value.activityLoading, worlds: value.worlds,
        active: value.active, error: value.error, agentError: value.agentError, ready: value.ready,
        selectedWork: value.selectedWork, selectionVersion: value.selectionVersion, integrationTargets: value.integrationTargets };
      response.page = this.catalog(query);
    }
    if (request.detail) {
      const { id, before, after } = request.detail;
      if (typeof id !== 'string' || (before !== null && (!Number.isSafeInteger(before) || before < 0))) throw new Error('工作详情查询无效');
      const source = this.engine.getWork(id);
      const pending = this.engine.pending.get(id);
      let stamp = this.detailVersions.get(source);
      if (!stamp || stamp.pending !== pending) {
        stamp = { pending, version: ++this.nextDetailVersion };
        this.detailVersions.set(source, stamp);
      }
      const detailCursor = { scope: this.scope, version: stamp.version, id, before };
      if (after?.scope !== this.scope || after.version !== stamp.version || after.id !== id || after.before !== before) {
        const { messages = [], ...work } = source;
        const end = before === null ? messages.length : Math.min(before, messages.length);
        const start = Math.max(0, end - MESSAGE_PAGE_SIZE);
        response.detail = { cursor: detailCursor, work, pending, messages: { items: messages.slice(start, end), start, end, total: messages.length } };
      }
    }
    return response;
  }
}
