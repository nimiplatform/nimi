import { useState } from 'react';
import { Surface, Button, StatusBadge, InlineAlert } from '@nimiplatform/kit/ui';
import {
  buildStudioProjection,
  buildPreparedPackage,
  validatePreparedPackage,
  approveBible,
  applyBibleDraft,
  scaffoldStarterChapter,
  addFeedbackPatch,
  type PreparedStorybookPackage,
} from '../../engine/index.js';
import { getProject, saveProject, saveImportedPackage, type StoredProjectRecord } from '../../store/storybook-store.js';
import { runBibleDraft } from '../../ai/storybook-runtime.js';
import { StudioPlaytest } from './studio-playtest.js';
import { StudioAdvanced } from './studio-advanced.js';
import { StudioPromotion } from './studio-promotion.js';

type StudioTab = 'workbench' | 'playtest' | 'editor' | 'promotion';

const STUDIO_TABS: { value: StudioTab; label: string }[] = [
  { value: 'workbench', label: '工作台' },
  { value: 'playtest', label: '试玩' },
  { value: 'editor', label: '编辑/诊断' },
  { value: 'promotion', label: '提升/Realm' },
];

// Studio project workbench: foundation review, validation, scoped AI generation
// (typed-unavailable when no binding/runtime), foundation-review approval, and
// preparing a Play package. Feedback patches are app-internal, project-scoped.

function nowIso(): string {
  return new Date().toISOString();
}

export function StudioProject({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const [record, setRecord] = useState<StoredProjectRecord | null>(() => getProject(projectId));
  const [aiBusy, setAiBusy] = useState(false);
  const [aiDraft, setAiDraft] = useState<string | null>(null);
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedStorybookPackage | null>(null);
  const [tab, setTab] = useState<StudioTab>('workbench');

  if (!record) {
    return (
      <Surface className="sb-section" material="glass-regular" tone="panel">
        <InlineAlert tone="warning"><div className="runtime-alert-copy"><strong>找不到项目</strong><span>该项目不存在或已被删除。</span></div></InlineAlert>
        <div className="sb-actions"><Button type="button" tone="secondary" onClick={onBack}>返回</Button></div>
      </Surface>
    );
  }

  const studio = buildStudioProjection(record.truthPackage);

  function saveAndSet(nextRecord: StoredProjectRecord) {
    saveProject(nextRecord);
    setRecord({ ...nextRecord });
  }

  function commitPackage(nextPkg: StoredProjectRecord['truthPackage']) {
    saveAndSet({ ...record!, truthPackage: nextPkg, project: { ...record!.project, updatedAt: nowIso() } });
  }

  async function draftBible() {
    setAiBusy(true);
    setAiNotice(null);
    setAiDraft(null);
    const premise = record!.truthPackage.bible?.premise || record!.truthPackage.scenarioFrame?.background || record!.project.name;
    // Quality-rises loop (wave-11): accepted preference patches from promotion review
    // become generation constraints, so corrected runs raise subsequent output quality.
    const prefs = record!.memory.feedbackPatches.filter((p) => p.kind === 'preference').map((p) => p.note).filter(Boolean);
    const styleHint = prefs.length ? `请遵循以下已采纳的创作者/玩家偏好：${prefs.join('；')}` : undefined;
    const outcome = await runBibleDraft({ projectId: record!.project.id, premise, styleHint });
    setAiBusy(false);
    if (outcome.ok) {
      setAiDraft(outcome.value);
    } else {
      setAiNotice(`${outcome.message}（${outcome.actionHint}）`);
    }
  }

  function applyDraft() {
    if (!aiDraft) return;
    const next = applyBibleDraft(record!.truthPackage, { worldSummary: aiDraft }, nowIso());
    if (!next.ok) { setActionError(next.message); return; }
    commitPackage(next.value);
    setAiDraft(null);
  }

  function doApproveBible() {
    setActionError(null);
    const next = approveBible(record!.truthPackage, nowIso());
    if (!next.ok) { setActionError(`${next.code}: ${next.message}`); return; }
    commitPackage(next.value);
  }

  function doScaffold() {
    setActionError(null);
    const next = scaffoldStarterChapter(record!.truthPackage, nowIso());
    if (!next.ok) { setActionError(`${next.code}: ${next.message}`); return; }
    commitPackage(next.value);
  }

  function doPrepare() {
    setActionError(null);
    setPrepared(null);
    const built = buildPreparedPackage({ pkg: record!.truthPackage, producer: record!.project.name, now: nowIso() });
    if (!built.ok) { setActionError(`无法准备 Play package（${built.code}）：${built.message}`); return; }
    const report = validatePreparedPackage(built.value);
    if (!report.valid) { setActionError(`prepared package 未通过校验：${report.findings.map((f) => f.message).join('；')}`); return; }
    saveImportedPackage({
      id: built.value.manifest.packageId,
      label: `${record!.project.name}（创作者）`,
      source: 'local-import',
      entryLabel: 'creator-provided',
      package: built.value,
      importedAt: nowIso(),
      sourceProjectId: record!.project.id,
    });
    setPrepared(built.value);
  }

  function addBibleFeedback() {
    setActionError(null);
    const bibleRef = record!.truthPackage.bible?.ref ?? null;
    const next = addFeedbackPatch(record!.memory, { targetRef: bibleRef, kind: 'preference', note: '希望 Bible 的基调更克制。', weight: 1, now: nowIso() }, record!.truthPackage);
    if (!next.ok) { setActionError(`${next.code}: ${next.message}`); return; }
    saveAndSet({ ...record!, memory: next.value });
  }

  const bible = record.truthPackage.bible;

  return (
    <div className="sb-content">
      <Surface className="sb-section" material="glass-regular" tone="panel">
        <div className="sb-section__head">
          <div>
            <h2>{record.project.name}</h2>
            <p>基础审阅工作台。truth 包版本 v{record.truthPackage.version} · 生命周期 {record.truthPackage.governance.lifecycle}。Play、渲染等均为此真值的投影。</p>
          </div>
          <Button type="button" tone="secondary" size="sm" onClick={onBack}>返回项目列表</Button>
        </div>

        <div className="sb-surface-switch" role="tablist" aria-label="Studio 工作区切换">
          {STUDIO_TABS.map((t) => (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={tab === t.value}
              className={`sb-surface-switch__btn${tab === t.value ? ' sb-surface-switch__btn--active' : ''}`}
              onClick={() => setTab(t.value)}
              data-testid={`studio-tab-${t.value}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'workbench' ? (
        <div className="sb-grid">
          {studio.payload.foundationCards.map((card) => (
            <Surface key={card.kind} className="sb-card" material="glass-thin" tone="card">
              <div className="sb-chip-row">
                <StatusBadge tone={card.complete ? 'success' : 'warning'}>{card.complete ? '完整' : '待完善'}</StatusBadge>
                <StatusBadge tone="neutral">{card.kind}</StatusBadge>
              </div>
              <h3>{card.title}</h3>
              <p>{card.summary}</p>
            </Surface>
          ))}
        </div>
        ) : null}
      </Surface>

      {tab === 'workbench' ? (
      <>
      <Surface className="sb-section" material="glass-regular" tone="panel">
        <div className="sb-section__head">
          <div>
            <h2>校验</h2>
            <p>真值包的 fail-closed 校验结果。缺失前置条件会显式失败，不做伪成功。</p>
          </div>
          <StatusBadge tone={studio.payload.validation.valid ? 'success' : 'warning'}>
            {studio.payload.validation.valid ? '通过' : `${studio.payload.validation.findings.length} 项待处理`}
          </StatusBadge>
        </div>
        {studio.payload.validation.findings.length > 0 ? (
          <div className="sb-findings">
            {studio.payload.validation.findings.map((finding, index) => (
              <div key={index} className="sb-finding">• [{finding.code}] {finding.message}</div>
            ))}
          </div>
        ) : <p className="sb-muted">当前没有阻塞性问题。</p>}
      </Surface>

      <Surface className="sb-section" material="glass-regular" tone="panel">
        <div className="sb-section__head">
          <div>
            <h2>Storybook Bible</h2>
            <p>生成草案走已准入的 Runtime/SDK 路由（按 NimiAIConfig 绑定）。没有绑定或运行时不可用时显示有类型的不可用状态，不会伪造内容。</p>
          </div>
          <StatusBadge tone={bible?.approved ? 'success' : 'neutral'}>{bible?.approved ? '已审批' : '未审批'}</StatusBadge>
        </div>
        <p className="sb-muted">世界概述：{bible?.worldSummary || '（空）'}</p>
        {aiDraft ? (
          <Surface className="sb-card" material="glass-thin" tone="card">
            <h3>AI 草案（待审阅）</h3>
            <p style={{ whiteSpace: 'pre-wrap' }}>{aiDraft}</p>
            <div className="sb-actions"><Button type="button" tone="primary" size="sm" onClick={applyDraft}>应用到 Bible 世界概述</Button></div>
          </Surface>
        ) : null}
        {aiNotice ? <InlineAlert tone="warning"><div className="runtime-alert-copy"><strong>AI 暂不可用</strong><span>{aiNotice}</span></div></InlineAlert> : null}
        <div className="sb-actions">
          <Button type="button" tone="secondary" size="sm" loading={aiBusy} onClick={() => void draftBible()}>生成 Bible 草案</Button>
          <Button type="button" tone="secondary" size="sm" onClick={doApproveBible} disabled={!bible || bible.approved}>通过基础审阅（审批 Bible）</Button>
          <Button type="button" tone="secondary" size="sm" onClick={addBibleFeedback}>记录反馈补丁（app 内）</Button>
        </div>
      </Surface>

      <Surface className="sb-section" material="glass-regular" tone="panel">
        <div className="sb-section__head">
          <div>
            <h2>章节与 Play package</h2>
            <p>审批 Bible 后生成最小可玩序章（确定性脚手架），再准备成可在 Play 中游玩的 prepared package。</p>
          </div>
        </div>
        <div className="sb-actions">
          <Button type="button" tone="secondary" size="sm" onClick={doScaffold} disabled={record.truthPackage.chapters.length > 0}>生成最小可玩序章</Button>
          <Button type="button" tone="primary" size="sm" onClick={doPrepare}>准备 Play package</Button>
        </div>
        {actionError ? <InlineAlert tone="warning"><div className="runtime-alert-copy"><strong>操作失败</strong><span>{actionError}</span></div></InlineAlert> : null}
        {prepared ? (
          <Surface className="sb-card" material="glass-thin" tone="card">
            <div className="sb-chip-row">
              <StatusBadge tone="success">Play-valid</StatusBadge>
              <StatusBadge tone="neutral">包 {prepared.manifest.packageId}</StatusBadge>
            </div>
            <p>已写入 Play 书架（创作者来源）。也可复制下面的 JSON 作为 prepared package 导出。</p>
            <textarea className="sb-textarea" readOnly value={JSON.stringify(prepared, null, 2)} />
          </Surface>
        ) : null}
      </Surface>
      </>
      ) : null}

      {tab === 'playtest' ? <StudioPlaytest record={record} /> : null}
      {tab === 'editor' ? <StudioAdvanced record={record} onUpdate={saveAndSet} /> : null}
      {tab === 'promotion' ? <StudioPromotion record={record} onUpdate={saveAndSet} /> : null}
    </div>
  );
}
