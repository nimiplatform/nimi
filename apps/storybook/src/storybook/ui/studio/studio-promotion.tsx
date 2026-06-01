import { useMemo, useState } from 'react';
import { Surface, Button, StatusBadge, InlineAlert } from '@nimiplatform/kit/ui';
import {
  assessPromotionCandidateLocally,
  enforcePromotionPolicy,
  recordAcceptedPromotion,
  addRealmImport,
  makeRealmRef,
  createImportedRef,
  validateRealmImport,
  createRealmPromotionRequest,
  type PromotionCandidate,
  type PromotionEnum,
} from '../../engine/index.js';
import { listImportedPackages, listRuns, getRun, saveRun, type StoredProjectRecord } from '../../store/storybook-store.js';

// Real promotion review (wave-11) + Realm structural reference (wave-6). Candidates
// are NOT hardcoded — they are the run-emerged candidates persisted by Play turns /
// 👎 feedback, found by linking this project's prepared packages to their runs.
// Resolving writes app-internal feedback to project memory and marks the candidate
// resolved on its run. Realm imports persist onto the truth package.

function nowIso(): string {
  return new Date().toISOString();
}

function describeCandidate(candidate: PromotionCandidate): string {
  const change = candidate.proposedChange as { playerSteer?: string; guardedOutput?: string; feedback?: string; nodeId?: string };
  if (change.feedback === 'negative') return `玩家在节点 ${change.nodeId ?? '?'} 给出负反馈（需修正）`;
  if (change.playerSteer) return `玩家引导：「${change.playerSteer}」→ 守卫输出：「${(change.guardedOutput ?? '').slice(0, 60)}」`;
  return `候选 ${candidate.id}`;
}

type PendingEntry = { runId: string; candidate: PromotionCandidate };

export function StudioPromotion({ record, onUpdate }: { record: StoredProjectRecord; onUpdate: (record: StoredProjectRecord) => void }) {
  const [notice, setNotice] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const [realmInput, setRealmInput] = useState('foggy/world-rule/curfew');
  const [realmRelease, setRealmRelease] = useState('1.0.0');
  const [realmNotice, setRealmNotice] = useState<string | null>(null);

  // Real, run-emerged candidates for THIS project (linked via sourceProjectId).
  const pending = useMemo<PendingEntry[]>(() => {
    const projectPackageIds = new Set(
      listImportedPackages().filter((p) => p.sourceProjectId === record.project.id).map((p) => p.package.manifest.packageId),
    );
    const runs = listRuns().filter((r) => projectPackageIds.has(r.packageId));
    return runs.flatMap((r) =>
      (r.promotionCandidates ?? [])
        .filter((c) => !(r.resolvedCandidateIds ?? []).includes(c.id))
        .map((c) => ({ runId: r.run.id, candidate: c })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record.project.id, refreshKey]);

  function resolve(entry: PendingEntry, proposed: PromotionEnum) {
    setReviewError(null);
    const assessment = assessPromotionCandidateLocally(entry.candidate);
    const decided = enforcePromotionPolicy({ candidate: entry.candidate, assessment, proposedDecision: proposed, now: nowIso() });
    if (!decided.ok) { setReviewError(`${decided.code}: ${decided.message}`); return; }
    // record the decision ref in project memory; auto_accept additionally materializes a feedback patch
    const wired = recordAcceptedPromotion(record.memory, { decision: decided.value.decision, candidate: entry.candidate, note: describeCandidate(entry.candidate), now: nowIso() }, record.truthPackage);
    if (!wired.ok) { setReviewError(`${wired.code}: ${wired.message}`); return; }
    onUpdate({ ...record, memory: wired.value });
    // mark resolved on the originating run so it does not reappear
    const run = getRun(entry.runId);
    if (run) saveRun({ ...run, resolvedCandidateIds: [...(run.resolvedCandidateIds ?? []), entry.candidate.id] });
    setRefreshKey((k) => k + 1);
    setNotice(`候选 → ${decided.value.decision.decision}${proposed === 'auto_accept' ? '（已写入项目记忆，将作用于后续生成）' : ''}`);
  }

  function importRealmRef() {
    setRealmNotice(null);
    const [namespace, kind, localId] = realmInput.split('/');
    if (!namespace || !kind || !localId) { setRealmNotice('请使用 namespace/kind/localId 格式。'); return; }
    const imported = createImportedRef({ realmRef: makeRealmRef(namespace, kind as Parameters<typeof makeRealmRef>[1], localId), realmObjectKind: kind as Parameters<typeof makeRealmRef>[1], realmRelease });
    if (!imported.ok) { setRealmNotice(`${imported.code}: ${imported.message}`); return; }
    // persist onto the truth package so it participates in projection/diagnostics
    onUpdate({ ...record, truthPackage: addRealmImport(record.truthPackage, imported.value, nowIso()) });
    setRealmNotice(`已引用并持久化：${imported.value.realmRef} @ ${imported.value.realmRelease}`);
  }

  function attemptRunStatePromotion() {
    const attempt = createRealmPromotionRequest({
      targetRealmObject: { kind: 'world-rule', ref: makeRealmRef('foggy', 'world-rule', 'curfew') }, mutationType: 'update',
      sourceTruthRefs: ['turn:demo-run'], evidenceRefs: [], authority: 'realm-reviewer', note: '尝试把运行内容提升为 Realm 真值', now: nowIso(),
    });
    setRealmNotice(attempt.ok ? '（意外）允许了运行态提升——这不应发生。' : `已正确拒绝：${attempt.code} — ${attempt.message}`);
  }

  const realmImports = record.truthPackage.realmImports;

  return (
    <>
      <Surface className="sb-section" material="glass-regular" tone="panel">
        <div className="sb-section__head">
          <div>
            <h2>提升复核（来自真实游玩）</h2>
            <p>下列候选来自 Play 运行的自由文本回合与 👎 反馈（非演示数据）。接受为 auto_accept 会写入项目记忆，并作用于后续生成；其余决策仅记录审计。受保护类禁止 auto_accept。</p>
          </div>
          <StatusBadge tone={pending.length > 0 ? 'info' : 'neutral'}>{pending.length} 条待复核</StatusBadge>
        </div>
        {reviewError ? <InlineAlert tone="warning"><div className="runtime-alert-copy"><strong>策略失败</strong><span>{reviewError}</span></div></InlineAlert> : null}
        {notice ? <InlineAlert tone="info"><div className="runtime-alert-copy"><strong>已处理</strong><span>{notice}</span></div></InlineAlert> : null}
        {pending.length === 0 ? (
          <p className="sb-muted">暂无待复核候选。先在 Play 里用「创作者」包游玩、发送自由文本或点 👎，再回到这里复核。</p>
        ) : (
          <div className="sb-grid">
            {pending.map((entry) => {
              const assessment = assessPromotionCandidateLocally(entry.candidate);
              return (
                <Surface key={entry.candidate.id} className="sb-card" material="glass-thin" tone="card">
                  <div className="sb-chip-row">
                    <StatusBadge tone="neutral">{entry.candidate.targetObjectFamily}</StatusBadge>
                    <StatusBadge tone="neutral">风险 {assessment.riskClass}</StatusBadge>
                    <StatusBadge tone="info">建议 {assessment.recommendedOutcome}</StatusBadge>
                    {entry.candidate.protectedClasses.map((c) => <StatusBadge key={c} tone="warning">{c}</StatusBadge>)}
                  </div>
                  <p>{describeCandidate(entry.candidate)}</p>
                  <div className="sb-actions">
                    <Button type="button" tone="primary" size="sm" onClick={() => resolve(entry, 'auto_accept')}>接受并学习</Button>
                    <Button type="button" tone="secondary" size="sm" onClick={() => resolve(entry, 'needs_review')}>留待复核</Button>
                    <Button type="button" tone="secondary" size="sm" onClick={() => resolve(entry, 'session_only')}>仅本次运行</Button>
                    <Button type="button" tone="secondary" size="sm" onClick={() => resolve(entry, 'reject')}>拒绝</Button>
                  </div>
                </Surface>
              );
            })}
          </div>
        )}
        <p className="sb-muted">项目记忆已累计 {record.memory.feedbackPatches.length} 条反馈补丁；后续 Bible 生成会消费这些偏好。</p>
      </Surface>

      <Surface className="sb-section" material="glass-regular" tone="panel">
        <div className="sb-section__head">
          <div>
            <h2>Realm 结构参考（第一阶段：只读引用，已持久化）</h2>
            <p>以 imported_ref 引用 Realm 世界/角色定义并写入项目真值包，参与校验/诊断；不拥有、不变更。运行态/转录无法被提升为 Realm 真值。</p>
          </div>
          <StatusBadge tone="neutral">{realmImports.length} 条引用</StatusBadge>
        </div>
        <div className="sb-form">
          <div className="sb-field">
            <label htmlFor="sb-realm-ref">Realm ref（namespace/kind/localId）</label>
            <input id="sb-realm-ref" className="sb-input" value={realmInput} onChange={(event) => setRealmInput(event.target.value)} />
          </div>
          <div className="sb-field">
            <label htmlFor="sb-realm-release">release</label>
            <input id="sb-realm-release" className="sb-input" value={realmRelease} onChange={(event) => setRealmRelease(event.target.value)} />
          </div>
        </div>
        <div className="sb-actions">
          <Button type="button" tone="secondary" size="sm" onClick={importRealmRef}>引用并持久化（imported_ref）</Button>
          <Button type="button" tone="secondary" size="sm" onClick={attemptRunStatePromotion}>尝试运行态→Realm 提升（应被拒绝）</Button>
        </div>
        {realmImports.length > 0 ? (
          <div className="sb-grid">
            {realmImports.map((imp) => {
              const findings = validateRealmImport(imp, realmRelease);
              return (
                <Surface key={imp.id} className="sb-card" material="glass-thin" tone="card">
                  <div className="sb-chip-row">
                    <StatusBadge tone="info">{imp.state}</StatusBadge>
                    <StatusBadge tone="neutral">{imp.realmObjectKind}</StatusBadge>
                    <StatusBadge tone={findings.length === 0 ? 'success' : 'warning'}>{findings.length === 0 ? '校验通过' : `${findings.length} 项`}</StatusBadge>
                  </div>
                  <p className="sb-muted">{imp.realmRef} @ {imp.realmRelease}</p>
                </Surface>
              );
            })}
          </div>
        ) : null}
        {realmNotice ? <InlineAlert tone="info"><div className="runtime-alert-copy"><strong>Realm 边界</strong><span>{realmNotice}</span></div></InlineAlert> : null}
      </Surface>
    </>
  );
}
