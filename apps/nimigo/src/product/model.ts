export type WorkStatus = 'draft' | 'review' | 'queued' | 'running' | 'needs-input' | 'complete' | 'failed' | 'stopped' | 'uncertain';
export type Project = { id: string; name: string; description: string; sourceRef?: string; archived: boolean; createdAt: string };
export type Skill = { id: string; name: string; description: string; materials?: string; result?: string; instructions: string; updatedAt: string };
export type Routine = { id: string; name: string; projectId: string; skillId: string; brief: string; time: string; enabled: boolean; nextAt: string; missedAt?: string; lastWorkId?: string };
export type Workspace = { version: 1; id: string; agentBinding: string | null; projects: Project[]; workIds: string[]; skills: Skill[]; routines: Routine[]; notifyHome: boolean; theme: 'light' | 'dark' };
export type Attempt = { id: string; agentBinding: string; turnId: string | null; anchorId: string | null; startedAt: string; status: WorkStatus; input?: string; error?: string };
export type Material = { id: string; title: string; content: string; createdAt: string; editedAt?: string; origin?: { activityId?: string; worldId?: string; title: string; updatedAt: string } };
export type Revision = { id: string; path: string; createdAt: string; by: 'agent' | 'user'; note: string; turnId?: string };
export type Deliverable = { id: string; title: string; revisions: Revision[] };
export type Work = { version: 1; id: string; projectId: string; title: string; brief: string; skillId: string; status: WorkStatus; createdAt: string; updatedAt: string; materials: Material[]; deliverables: Deliverable[]; steps: { id: string; title: string; done: boolean }[]; attempts: Attempt[]; history: { id: string; at: string; text: string; kind?: 'source-update'; turnId?: string }[]; error?: string; question?: string; queuedInput?: { sequence: number; followup?: string; routineName?: string }; archived: boolean };
export const statusLabel: Record<WorkStatus, string> = { draft: '待开始', review: '待交付', queued: '排队中', running: '进行中', 'needs-input': '需要你', complete: '已交付', failed: '遇到问题', stopped: '已停止', uncertain: '待确认' };
export const uuid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export function nextRoutineTime(time: string, after = new Date()): string {
  const [hours, minutes] = time.split(':').map(Number);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours! < 0 || hours! > 23 || minutes! < 0 || minutes! > 59) throw new Error('请选择有效时间');
  const date = new Date(after); date.setHours(hours!, minutes!, 0, 0);
  if (date <= after) date.setDate(date.getDate() + 1);
  return date.toISOString();
}
export function createWorkspace(): Workspace {
  const updatedAt = now();
  return { version: 1, id: uuid(), agentBinding: null, projects: [{ id: uuid(), name: '我的工作', description: '从一个明确的交付目标开始', archived: false, createdAt: updatedAt }], workIds: [], routines: [], notifyHome: true, theme: 'light', skills: [
    { id: 'brief', name: '整理成稿', description: '把散落资料变成一份可交付的文档', instructions: '先查阅资料与目标，区分来源事实、推断和待确认信息。必要时询问用户。提出简洁工作步骤，再用 save_deliverable 保存完整、可直接使用的中文成果。保留来源名称，不捏造引文或已执行的外部动作。最后说明交付了什么及需要关注的未决问题。', updatedAt },
    { id: 'decision', name: '决策备忘', description: '比较方案，形成有依据的建议与下一步', instructions: '围绕用户决策梳理目标、约束、选项和取舍。资料不足时明确假设或使用 request_input，不编造数据。交付一份含选项比较、建议、风险和行动清单的决策备忘录，调用 save_deliverable 真正保存。', updatedAt },
    { id: 'review', name: '评审与改进', description: '找出关键缺口，直接交付修订稿', instructions: '阅读现有成果和原始目标，检查论证、完整度、可执行性与表达。先列出具体问题，再交付改进后的完整版本。已有成果需要修改时用 save_deliverable 的 deliverableId 形成新版本，保留原版本。', updatedAt },
    { id: 'weekly', name: '项目进展简报', description: '汇集生态动态，整理进展、风险和待办', instructions: '使用 ecosystem_activity 获取真实近期活动，仅把活动当来源而非完成证据。结合本项目资料整理进展、阻塞和建议下一步，注明来源应用与更新时间，保存简报。不得把打开来源或已读当成业务完成。', updatedAt },
  ] };
}
export function createWork(projectId: string, title: string, brief: string, skillId: string): Work {
  if (!title.trim() || !brief.trim()) throw new Error('请填写工作名称和交付目标');
  if (title.length > 120 || new TextEncoder().encode(title).length > 256 || new TextEncoder().encode(brief).length > 16384) throw new Error('名称需小于 256 字节，目标需小于 16 KiB');
  return { version: 1, id: uuid(), projectId, title: title.trim(), brief: brief.trim(), skillId, status: 'draft', createdAt: now(), updatedAt: now(), materials: [], deliverables: [], steps: [], attempts: [], history: [], archived: false };
}
export function errorText(error: unknown): string {
  if (!error || typeof error !== 'object') return String(error);
  const record = error as { message?: string; reasonCode?: string; code?: string };
  const reason = record.reasonCode || record.code || '';
  const messages: Record<string, string> = { 'avatar-host-mechanic-failed': '这次未能在桌面上叫出搭档，请在 Nimi 检查这位 Agent 的形象配置后重试。', 'local-app-access-denied': '这次执行的访问已结束或失效。已有成果保留，请重新打开工作区确认状态。', 'runtime-unauthenticated': 'Nimi 连接已变化，请重新打开同一工作区后重试。', 'local-app-operation-unsupported': '当前 Nimi Runtime 尚不支持这项操作，请更新运行环境后重试。', 'agent-busy': '这位搭档正在别处工作，请稍后重试。', 'AI_STREAM_BROKEN': '这次执行没有完整返回。已保存的成果仍然保留，请查看后决定是否重试。', 'LOCAL_APP_ACCESS_DENIED': '当前授权不可用，请在 Nimi 检查此应用的 Agent 访问。', 'AGENT_TURN_ALREADY_ACTIVE': '这位 Agent 正在处理另一项工作，请稍后重试。', 'AI_PROVIDER_TIMEOUT': 'Agent 等待模型超时，已保存的成果仍然保留。', 'AI_OUTPUT_INVALID': 'Agent 本次返回不符合执行契约，请查看已有成果后重试。', 'agent-turn-already-active': '这位 Agent 正忙，请稍后重试。' };
  return messages[reason] || [...new Set([record.message || '操作未完成', reason].filter(Boolean))].join(' · ');
}
export function isMissing(error: unknown): boolean {
  const e = error as { code?: string; reasonCode?: string };
  return [e?.code, e?.reasonCode].some(value => ['not-found', 'app_storage_entry_not_found', 'APP_STORAGE_ENTRY_NOT_FOUND'].includes(value || ''));
}

export function deliveredWorkStatus(work: Work, turnId: string): 'complete' | 'review' {
  return work.deliverables.some(doc => doc.revisions.some(revision => revision.turnId === turnId))
    || work.history.some(event => event.kind === 'source-update' && event.turnId === turnId) ? 'complete' : 'review';
}

export function workCanEdit(work: Work): boolean {
  return !['queued', 'running', 'needs-input', 'uncertain'].includes(work.status);
}

export function assertWorkEditable(work: Work): void {
  if (!workCanEdit(work)) throw new Error('请先结束或核对这项工作的执行，再修改资料与目标。');
}

function requireWorkText(value: string, label: string, bytes: number): string {
  if (!value.trim() || new TextEncoder().encode(value).length > bytes) throw new Error(`${label}为空或超过长度限制`);
  return value;
}

// @nimi-authority: rule.nimi.nimigo.workbench.delivery
export function reviseWorkDetails(work: Work, patch: Pick<Work, 'title' | 'brief' | 'projectId' | 'skillId'>): void {
  assertWorkEditable(work);
  const title = requireWorkText(patch.title.trim(), '工作名称', 256);
  const brief = requireWorkText(patch.brief.trim(), '交付目标', 16384);
  if (title.length > 120) throw new Error('工作名称最多 120 个字符');
  const changedGoal = brief !== work.brief || patch.skillId !== work.skillId;
  Object.assign(work, { ...patch, title, brief });
  if (changedGoal) resetWorkForChangedInputs(work);
}

function resetWorkForChangedInputs(work: Work): void {
  work.status = 'draft'; work.steps = []; work.error = undefined; work.question = undefined; work.queuedInput = undefined;
}

export function validateMaterials(materials: readonly Material[]): void {
  if (materials.length > 16 || new TextEncoder().encode(JSON.stringify(materials)).length > 96 * 1024) {
    throw new Error('每项工作可保存 16 份资料，合计最多 96 KiB；可另建工作继续处理。');
  }
}

export function attachMaterial(work: Work, material: Material): void {
  assertWorkEditable(work);
  const materials = [...work.materials, material];
  validateMaterials(materials);
  work.materials = materials;
  resetWorkForChangedInputs(work);
}

// @nimi-authority: rule.nimi.nimigo.workbench.ecosystem
export function reviseMaterial(work: Work, materialId: string, title: string, content: string): Material {
  assertWorkEditable(work);
  const original = work.materials.find(material => material.id === materialId);
  if (!original) throw new Error('找不到这份资料');
  const revised = { ...original, title: requireWorkText(title.trim(), '资料名称', 256), content: requireWorkText(content, '资料内容', 16384), editedAt: now() };
  const materials = work.materials.map(material => material.id === materialId ? revised : material);
  validateMaterials(materials);
  work.materials = materials;
  resetWorkForChangedInputs(work);
  return revised;
}

export function nextQueuedWork(works: readonly Work[]): Work | undefined {
  const queued = works.filter(work => work.status === 'queued');
  if (queued.some(work => !Number.isSafeInteger(work.queuedInput?.sequence) || work.queuedInput!.sequence < 1)) {
    throw new Error('排队记录无法确认，请重新打开应用核对，不会自动执行。');
  }
  return queued.sort((a, b) => a.queuedInput!.sequence - b.queuedInput!.sequence)[0];
}

export function projectDeliverables(work: Work, works: readonly Work[], query = '') {
  const search = query.trim().toLocaleLowerCase();
  return works.filter(candidate => candidate.projectId === work.projectId)
    .flatMap(candidate => candidate.deliverables.map(doc => ({ deliverableId: doc.id, title: doc.title, work: candidate.title, canReviseHere: candidate.id === work.id, archived: candidate.archived, updatedAt: doc.revisions.at(-1)!.createdAt })))
    .filter(doc => !search || `${doc.title} ${doc.work} ${doc.updatedAt}`.toLocaleLowerCase().includes(search))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function workSources(work: Work, workspace: Workspace, works: readonly Work[]) {
  const project = workspace.projects.find(candidate => candidate.id === work.projectId);
  if (!project) throw new Error('这项工作的项目已不可用');
  const method = workspace.skills.find(skill => skill.id === work.skillId);
  const docs = projectDeliverables(work, works);
  const sources = [
    { sourceId: 'work-brief', title: work.title, content: work.brief },
    { sourceId: 'project-brief', title: project.name, content: project.description || '用户尚未提供项目背景。' },
    { sourceId: 'work-method', title: method?.name || '工作方法', content: JSON.stringify({ task: method?.description, materials: method?.materials, result: method?.result }) },
    { sourceId: 'material-catalog', title: '本工作资料目录', content: JSON.stringify(work.materials.map(material => ({ sourceId: material.id, title: material.title, origin: material.origin || '用户提供', editedAt: material.editedAt, provenance: material.editedAt ? '用户修订稿；不能当作来源原文引用' : material.origin ? '来源摘录' : '用户资料' }))) },
    { sourceId: 'deliverable-catalog', title: '本项目近期成果目录', content: JSON.stringify({ total: docs.length, deliverables: docs.slice(0, 16), lookup: '更多成果通过 find_deliverables 按名称、工作名或日期查询。' }) },
  ];
  if (sources.some(source => new TextEncoder().encode(source.content).length > 16384)) throw new Error('资料目录超出单次上下文上限，请缩短目录中的名称或来源说明。');
  return sources;
}
