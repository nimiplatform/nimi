import { useState } from 'react';
import { Surface, Button, StatusBadge, InlineAlert } from '@nimiplatform/kit/ui';
import {
  createEditLog,
  applyEdit,
  undoEdit,
  redoEdit,
  canUndo,
  canRedo,
  createRegenerationRequest,
  markRegeneration,
  applyBibleDraft,
  runFullDiagnostics,
  flattenDiagnostics,
  type EditLog,
  type RegenerationScope,
  type RegenerationRequest,
} from '../../engine/index.js';
import { runBibleDraft } from '../../ai/storybook-runtime.js';
import { type StoredProjectRecord } from '../../store/storybook-store.js';

// Studio editor + scoped regeneration + cross-product diagnostics (waves 12 & 13).
// Edits route through applyEdit (version bump + projection stale + undo/redo lineage),
// regeneration requests are scope/target validated, and diagnostics aggregate every
// owner-slice validator. None of this leaks to Play.

const SCOPES: RegenerationScope[] = ['segment', 'node', 'asset', 'scene', 'chapter', 'bible-slice', 'agent-scene', 'branch', 'source-structure'];

function nowIso(): string {
  return new Date().toISOString();
}

export function StudioAdvanced({ record, onUpdate }: { record: StoredProjectRecord; onUpdate: (record: StoredProjectRecord) => void }) {
  const [log, setLog] = useState<EditLog>(() => createEditLog(record.project.id));
  const [worldDraft, setWorldDraft] = useState(record.truthPackage.bible?.worldSummary ?? '');
  const [editError, setEditError] = useState<string | null>(null);

  const [scope, setScope] = useState<RegenerationScope>('bible-slice');
  const [target, setTarget] = useState(record.truthPackage.bible?.ref ?? '');
  const [regenNotice, setRegenNotice] = useState<string | null>(null);
  const [regenBusy, setRegenBusy] = useState(false);

  const regenerationRequests = record.regenerationRequests ?? [];

  const diagnostics = runFullDiagnostics({ pkg: record.truthPackage });
  const findings = flattenDiagnostics(diagnostics);

  function commitEdit() {
    setEditError(null);
    const pkg = record.truthPackage;
    if (!pkg.bible) { setEditError('尚无 Bible 可编辑。'); return; }
    const result = applyEdit({
      pkg,
      log,
      edit: { targetRef: pkg.bible.ref, targetKind: 'bible', operation: 'update-text', before: pkg.bible.worldSummary, after: worldDraft, baseVersion: pkg.version, note: '编辑世界概述' },
      mutate: (p) => (p.bible ? { ...p, bible: { ...p.bible, worldSummary: worldDraft } } : p),
      now: nowIso(),
    });
    if (!result.ok) { setEditError(`${result.code}: ${result.message}`); return; }
    setLog(result.value.log);
    onUpdate({ ...record, truthPackage: result.value.pkg, project: { ...record.project, updatedAt: nowIso() } });
  }

  function doUndo() {
    const next = undoEdit(log, record.truthPackage);
    setLog(next.log);
    setWorldDraft(next.pkg.bible?.worldSummary ?? '');
    onUpdate({ ...record, truthPackage: next.pkg });
  }

  function doRedo() {
    const next = redoEdit(log, record.truthPackage);
    setLog(next.log);
    setWorldDraft(next.pkg.bible?.worldSummary ?? '');
    onUpdate({ ...record, truthPackage: next.pkg });
  }

  function requestRegen() {
    setRegenNotice(null);
    const feedbackRefs = record.memory.feedbackPatches.map((p) => p.id);
    const result = createRegenerationRequest({ pkg: record.truthPackage, scope, targetRef: target, reason: '创作者请求范围内重生成', feedbackPatchRefs: feedbackRefs, now: nowIso() });
    if (!result.ok) { setRegenNotice(`${result.code}: ${result.message}`); return; }
    // PERSIST the request (queued) on the project — not a transient notice.
    onUpdate({ ...record, regenerationRequests: [...regenerationRequests, result.value] });
    setRegenNotice(`已入队重生成请求（${result.value.scope} @ ${result.value.targetRef}）。`);
  }

  function replaceRequest(next: RegenerationRequest, patch: Partial<StoredProjectRecord> = {}) {
    onUpdate({ ...record, ...patch, regenerationRequests: regenerationRequests.map((r) => (r.id === next.id ? next : r)) });
  }

  async function executeRegen(request: RegenerationRequest) {
    setRegenNotice(null);
    if (request.scope === 'bible-slice') {
      // REAL execution: regenerate the bible world summary, consuming accepted feedback,
      // and write it back to truth (version bump). Fail-closed on AI unavailable.
      setRegenBusy(true);
      const prefs = record.memory.feedbackPatches.filter((p) => p.kind === 'preference').map((p) => p.note).filter(Boolean);
      const styleHint = prefs.length ? `请遵循以下已采纳偏好：${prefs.join('；')}` : undefined;
      const premise = record.truthPackage.bible?.premise || record.truthPackage.scenarioFrame?.background || record.project.name;
      const outcome = await runBibleDraft({ projectId: record.project.id, premise, styleHint });
      setRegenBusy(false);
      if (!outcome.ok) {
        replaceRequest(markRegeneration(request, 'failed', `${outcome.message}（${outcome.actionHint}）`, nowIso()));
        setRegenNotice('重生成失败：AI 不可用。已标记为 failed（不伪造成功）。');
        return;
      }
      const applied = applyBibleDraft(record.truthPackage, { worldSummary: outcome.value }, nowIso());
      if (!applied.ok) {
        replaceRequest(markRegeneration(request, 'failed', `${applied.code}: ${applied.message}`, nowIso()));
        return;
      }
      replaceRequest(markRegeneration(request, 'executed', '已用采纳偏好重写 Bible 世界概述并写回真值（版本已 bump）。', nowIso()), { truthPackage: applied.value });
      setRegenNotice('已执行：Bible 世界概述基于反馈重生成并写回真值。');
      return;
    }
    // Other scopes: honest deferral — queued, not faked as done.
    replaceRequest(markRegeneration(request, 'deferred', '该范围的自动执行尚未接入；保持入队，等待后续生成接入或人工处理。', nowIso()));
    setRegenNotice(`范围「${request.scope}」自动执行尚未接入，已显式标记 deferred（非伪成功）。`);
  }

  return (
    <>
      <Surface className="sb-section" material="glass-regular" tone="panel">
        <div className="sb-section__head">
          <div>
            <h2>编辑器（带 lineage 与撤销/重做）</h2>
            <p>每次编辑都会写入 edit-operation、bump 真值版本并把投影标记为 stale；版本冲突会 fail-closed。</p>
          </div>
          <div className="sb-chip-row">
            <StatusBadge tone="neutral">已记录 {log.operations.length} 次编辑</StatusBadge>
            <StatusBadge tone="info">truth v{record.truthPackage.version}</StatusBadge>
          </div>
        </div>
        <div className="sb-field">
          <label htmlFor="sb-world-edit">Bible 世界概述</label>
          <textarea id="sb-world-edit" className="sb-textarea" value={worldDraft} onChange={(event) => setWorldDraft(event.target.value)} />
        </div>
        {editError ? <InlineAlert tone="warning"><div className="runtime-alert-copy"><strong>编辑失败</strong><span>{editError}</span></div></InlineAlert> : null}
        <div className="sb-actions">
          <Button type="button" tone="primary" size="sm" onClick={commitEdit}>提交编辑</Button>
          <Button type="button" tone="secondary" size="sm" disabled={!canUndo(log)} onClick={doUndo}>撤销</Button>
          <Button type="button" tone="secondary" size="sm" disabled={!canRedo(log)} onClick={doRedo}>重做</Button>
        </div>
      </Surface>

      <Surface className="sb-section" material="glass-regular" tone="panel">
        <div className="sb-section__head">
          <div>
            <h2>范围化重生成</h2>
            <p>选择范围与目标，生成一个有类型校验的 regeneration-request。范围不被准入或目标不可解析会 fail-closed。</p>
          </div>
        </div>
        <div className="sb-form">
          <div className="sb-field">
            <label htmlFor="sb-regen-scope">范围</label>
            <select id="sb-regen-scope" className="sb-select" value={scope} onChange={(event) => setScope(event.target.value as RegenerationScope)}>
              {SCOPES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="sb-field">
            <label htmlFor="sb-regen-target">目标 ref / id</label>
            <input id="sb-regen-target" className="sb-input" value={target} onChange={(event) => setTarget(event.target.value)} placeholder="例如：ch1 或 truth:...:chapter:ch1" />
          </div>
        </div>
        {regenNotice ? <InlineAlert tone="info"><div className="runtime-alert-copy"><strong>重生成</strong><span>{regenNotice}</span></div></InlineAlert> : null}
        <div className="sb-actions"><Button type="button" tone="secondary" size="sm" onClick={requestRegen}>入队重生成请求</Button></div>

        {regenerationRequests.length > 0 ? (
          <div className="sb-grid">
            {regenerationRequests.map((req) => (
              <Surface key={req.id} className="sb-card" material="glass-thin" tone="card">
                <div className="sb-chip-row">
                  <StatusBadge tone={req.status === 'executed' ? 'success' : req.status === 'failed' ? 'warning' : req.status === 'deferred' ? 'neutral' : 'info'}>{req.status}</StatusBadge>
                  <StatusBadge tone="neutral">{req.scope}</StatusBadge>
                </div>
                <p className="sb-muted">{req.targetRef}（基于 v{req.baseVersion}，消费 {req.feedbackPatchRefs.length} 条反馈）</p>
                {req.resolutionNote ? <p className="sb-muted">{req.resolutionNote}</p> : null}
                {req.status === 'queued' ? (
                  <div className="sb-actions">
                    <Button type="button" tone="primary" size="sm" loading={regenBusy} onClick={() => void executeRegen(req)}>执行</Button>
                  </div>
                ) : null}
              </Surface>
            ))}
          </div>
        ) : null}
      </Surface>

      <Surface className="sb-section" material="glass-regular" tone="panel">
        <div className="sb-section__head">
          <div>
            <h2>跨产品诊断（doctor）</h2>
            <p>聚合所有 owner-slice 校验器、生成可观测性与 provenance 审计。任一处失败都会让整体 ok 为 false（不做伪成功）。</p>
          </div>
          <StatusBadge tone={diagnostics.ok ? 'success' : 'warning'}>{diagnostics.ok ? '全部通过' : `${findings.length} 项待处理`}</StatusBadge>
        </div>
        {findings.length > 0 ? (
          <div className="sb-findings">
            {findings.map((finding, index) => <div key={index} className="sb-finding">• [{finding.code}] {finding.message}</div>)}
          </div>
        ) : <p className="sb-muted">没有阻塞性问题。</p>}
        {diagnostics.provenanceAudit ? (
          <p className="sb-muted">
            provenance：证据 {diagnostics.provenanceAudit.refsWithEvidence} · 派生 {diagnostics.provenanceAudit.refsWithDerivation} · 分歧 {diagnostics.provenanceAudit.refsWithDivergence}
            {diagnostics.provenanceAudit.unbackedRefs.length > 0 ? ` · 未背书 ref ${diagnostics.provenanceAudit.unbackedRefs.length} 个` : ''}
          </p>
        ) : null}
      </Surface>
    </>
  );
}
