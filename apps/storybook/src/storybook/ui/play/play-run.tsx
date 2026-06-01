import { useMemo, useState } from 'react';
import { Surface, Button, StatusBadge, InlineAlert } from '@nimiplatform/kit/ui';
import {
  findNode,
  applyChoice,
  snapshotBranch,
  appendTranscriptEntry,
  generateChoicesForNode,
  freeTextChoice,
  buildPlayNarrativeContext,
  processTurn,
  createRunEnvelope,
  deriveCandidateFromTurn,
  mintId,
  type Choice,
  type PlayableChapter,
  type AgentTurnRequest,
} from '../../engine/index.js';
import { getImportedPackage, getRun, saveRun, type RunRecord } from '../../store/storybook-store.js';
import { runSceneText } from '../../ai/storybook-runtime.js';

// Play run surface. Choice-primary: the engine always offers at least one choice
// on a non-ending node, so the player can progress without typing. Free-text is an
// optional steer; when AI is unavailable it shows a typed unavailable state rather
// than fabricating a reply. No Studio authoring controls here.

function nowIso(): string {
  return new Date().toISOString();
}

export function PlayRun({ runId, onExit }: { runId: string; onExit: () => void }) {
  const [record, setRecord] = useState<RunRecord | null>(() => getRun(runId));
  const [freeText, setFreeText] = useState('');
  const [aiNotice, setAiNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const prepared = record ? getImportedPackage(record.packageId)?.package ?? null : null;
  const chapter: PlayableChapter | null = useMemo(() => {
    if (!record || !prepared) return null;
    return prepared.playableChapters.find((c) => c.id === record.run.chapterId) ?? null;
  }, [record, prepared]);

  if (!record || !prepared || !chapter) {
    return (
      <Surface className="sb-section" material="glass-regular" tone="panel">
        <InlineAlert tone="warning"><div className="runtime-alert-copy"><strong>无法加载运行</strong><span>找不到对应的运行或 prepared package。</span></div></InlineAlert>
        <div className="sb-actions"><Button type="button" tone="secondary" onClick={onExit}>返回书架</Button></div>
      </Surface>
    );
  }

  const node = findNode(chapter, record.run.currentNodeId);
  const choices = node ? generateChoicesForNode(chapter, node) : [];

  function persist(next: RunRecord) {
    saveRun(next);
    setRecord({ ...next });
  }

  function selectChoice(choice: Choice) {
    if (!node) return;
    const advanced = applyChoice(record!.run, chapter!, choice, nowIso());
    if (!advanced.ok) {
      setAiNotice(`无法应用该选项：${advanced.message}`);
      return;
    }
    let transcript = appendTranscriptEntry(record!.transcript, { at: nowIso(), kind: 'choice', detail: choice.label, choiceId: choice.id, nodeId: node.id });
    transcript = appendTranscriptEntry(transcript, { at: nowIso(), kind: 'enter-node', detail: `进入节点 ${advanced.value.currentNodeId}`, nodeId: advanced.value.currentNodeId });
    persist({ ...record!, run: advanced.value, transcript });
    setAiNotice(null);
  }

  async function sendFreeText() {
    if (!node || !freeText.trim()) return;
    const text = freeText.trim();
    const choice = freeTextChoice(text);
    // 1. record the player's free-text steer (optional input; never required to progress)
    const transcript = appendTranscriptEntry(record!.transcript, { at: nowIso(), kind: 'free-text', detail: '玩家自由文本', choiceId: choice.id, nodeId: node.id, text });
    persist({ ...record!, transcript });
    setFreeText('');
    setBusy(true);
    setAiNotice(null);

    // 2. run the guarded narrative turn (wave-8): a redacted Play context (public
    //    facts only) + the app-local engine. Runtime executes the model inside the
    //    generate callback; it never owns the spine/turn record. REJECTED/unavailable
    //    writes no spine and surfaces a typed state — never a fabricated reply.
    const envelope = record!.narrative ?? createRunEnvelope({ runId: record!.run.id, projectId: prepared!.manifest.packageId, packageVersion: prepared!.truthPackageVersion });
    const turnRef = mintId('turn');
    const context = buildPlayNarrativeContext({
      runId: record!.run.id,
      turnRef,
      storySummary: prepared!.publicSummary,
      contentBoundaries: prepared!.contentBoundaries,
      publicCast: prepared!.publicCast,
      run: record!.run,
    });
    const request: AgentTurnRequest = { id: turnRef, runId: record!.run.id, agentId: prepared!.publicCast[0]?.name ?? 'narrator', trigger: 'free-text', userText: text };

    const outcome = await processTurn({
      request,
      context,
      envelope,
      generate: async () => {
        const ai = await runSceneText({
          projectId: prepared!.manifest.packageId,
          contextLines: [node.text, `玩家输入：${text}`],
          instruction: '基于当前场景，对玩家输入给出一段简短、合规、不引入新硬设定的回应。',
        });
        if (ai.ok) {
          return { ok: true as const, candidate: { spineEvents: [{ id: mintId('spine'), kind: 'dialogue' as const, text: ai.value }], stateChanges: [], metrics: {} } };
        }
        return { ok: false as const, reason: ai.reason, message: `${ai.message}（${ai.actionHint}）` };
      },
      provenance: { surface: 'play.free-text' },
    });
    setBusy(false);

    const latest = getRun(record!.run.id) ?? record!;
    if (outcome.status === 'REJECTED' || !outcome.record.coreOutput) {
      // The rejected turn record is retained (audit), but no spine was written.
      setAiNotice(outcome.record.guard.actionHint ?? '本回合被守卫拒绝，未写入叙事 spine。');
      persist({ ...latest, narrative: outcome.envelope });
      return;
    }
    const guardedText = outcome.record.coreOutput.spineEvents.map((event) => event.text).join('\n');
    const merged = appendTranscriptEntry(latest.transcript, {
      at: nowIso(),
      kind: 'agent-turn',
      detail: outcome.status === 'ADJUSTED' ? 'AI 场景回应（守卫已调整）' : 'AI 场景回应（守卫通过）',
      nodeId: node.id,
      text: guardedText,
    });
    // Derive a REAL promotion candidate from this guarded turn record (wave-11). It
    // is run-emerged, app-internal, and carries the player's steer + the guarded
    // output as the proposed change. Studio reviews it later; nothing becomes truth here.
    const candidate = deriveCandidateFromTurn({
      turnId: outcome.record.id,
      targetTruthRef: null,
      targetObjectFamily: 'feedback-rule',
      mutationType: 'add-feedback',
      proposedChange: { playerSteer: text, guardedOutput: guardedText, nodeId: node.id },
    });
    const merged2 = appendTranscriptEntry(merged, { at: nowIso(), kind: 'promotion', detail: `生成提升候选 ${candidate.id}（待 Studio 复核）`, nodeId: node.id });
    persist({ ...latest, transcript: merged2, narrative: outcome.envelope, promotionCandidates: [...(latest.promotionCandidates ?? []), candidate] });
  }

  function takeSnapshot() {
    const snapshot = snapshotBranch(record!.run, `快照@${record!.run.currentNodeId}`, nowIso());
    const transcript = appendTranscriptEntry(record!.transcript, { at: nowIso(), kind: 'finding', detail: `创建分支快照 ${snapshot.id}` });
    persist({ ...record!, snapshots: [...record!.snapshots, snapshot], transcript });
  }

  function feedback(kind: 'up' | 'down') {
    const transcript = appendTranscriptEntry(record!.transcript, { at: nowIso(), kind: 'feedback', detail: kind === 'up' ? '玩家正反馈' : '玩家负反馈', nodeId: record!.run.currentNodeId });
    // A 👎 is a real correction signal → a promotion candidate for Studio review.
    if (kind === 'down') {
      const candidate = deriveCandidateFromTurn({
        turnId: `fb-${record!.run.currentNodeId}-${record!.transcript.entries.length}`,
        targetTruthRef: null,
        targetObjectFamily: 'feedback-rule',
        mutationType: 'add-feedback',
        proposedChange: { feedback: 'negative', nodeId: record!.run.currentNodeId },
      });
      persist({ ...record!, transcript, promotionCandidates: [...(record!.promotionCandidates ?? []), candidate] });
      return;
    }
    persist({ ...record!, transcript });
  }

  return (
    <div className="sb-run">
      <Surface className="sb-stage" material="glass-regular" tone="panel">
        <div className="sb-chip-row">
          <StatusBadge tone="neutral">{chapter.title}</StatusBadge>
          {Object.entries(record.run.variables).map(([key, value]) => (
            <StatusBadge key={key} tone="info">{key}: {value}</StatusBadge>
          ))}
          {record.run.achievements.map((achievement) => (
            <StatusBadge key={achievement} tone="success">🏆 {achievement}</StatusBadge>
          ))}
          {record.run.status === 'ended' ? <StatusBadge tone="success">已结束</StatusBadge> : null}
        </div>

        <p className="sb-node-text">{node?.text ?? '（缺失节点文本）'}</p>

        {record.run.status === 'ended' ? (
          <div className="sb-actions">
            <StatusBadge tone="success">本章完成{record.run.endingId ? `：${record.run.endingId}` : ''}</StatusBadge>
            <Button type="button" tone="primary" onClick={onExit}>返回书架</Button>
          </div>
        ) : (
          <>
            <div className="sb-choices" data-testid="play-choices">
              {choices.map((choice) => (
                <button key={choice.id} type="button" className="sb-choice-btn" onClick={() => selectChoice(choice)}>
                  {choice.label}
                  <small>{choice.source === 'authored' ? '作者选项' : choice.source === 'generated' ? '生成选项' : '自由文本'}</small>
                </button>
              ))}
              {choices.length === 0 ? <p className="sb-muted">此节点没有可用选项。</p> : null}
            </div>

            <div className="sb-freetext">
              <label htmlFor="sb-freetext-input" className="sb-muted">可选：自由文本（无需打字也能推进，这只是额外的引导方式）</label>
              <textarea
                id="sb-freetext-input"
                className="sb-textarea"
                style={{ minHeight: 80 }}
                value={freeText}
                onChange={(event) => setFreeText(event.target.value)}
                placeholder="对角色说点什么，或描述你想做的事…"
              />
              <div className="sb-actions">
                <Button type="button" tone="secondary" size="sm" loading={busy} disabled={!freeText.trim()} onClick={() => void sendFreeText()}>发送自由文本</Button>
              </div>
              {aiNotice ? <InlineAlert tone="warning"><div className="runtime-alert-copy"><strong>AI 暂不可用</strong><span>{aiNotice}</span></div></InlineAlert> : null}
            </div>
          </>
        )}
      </Surface>

      <div className="sb-side">
        <Surface className="sb-section" material="glass-thin" tone="card">
          <h3>本次运行</h3>
          <div className="sb-actions">
            <Button type="button" tone="secondary" size="sm" onClick={takeSnapshot}>创建分支快照</Button>
            <Button type="button" tone="secondary" size="sm" onClick={() => feedback('up')}>👍</Button>
            <Button type="button" tone="secondary" size="sm" onClick={() => feedback('down')}>👎</Button>
            <Button type="button" tone="secondary" size="sm" onClick={onExit}>返回书架</Button>
          </div>
          <p className="sb-muted">快照数：{record.snapshots.length}</p>
        </Surface>
        {record.narrative && record.narrative.spine.events.length > 0 ? (
          <Surface className="sb-section" material="glass-thin" tone="card">
            <h3>叙事 spine（守卫后追加）</h3>
            <div className="sb-transcript">
              {record.narrative.spine.events.slice().reverse().map((event) => (
                <div key={event.seq} className="sb-transcript__entry">
                  <small>{event.kind} · #{event.seq}</small>
                  <span>{event.text}</span>
                </div>
              ))}
            </div>
          </Surface>
        ) : null}
        <Surface className="sb-section" material="glass-thin" tone="card">
          <h3>运行记录（transcript）</h3>
          <div className="sb-transcript">
            {record.transcript.entries.slice().reverse().map((entry) => (
              <div key={entry.seq} className="sb-transcript__entry">
                <small>{entry.kind}</small>
                <span>{entry.text ? entry.text : entry.detail}</span>
              </div>
            ))}
          </div>
        </Surface>
      </div>
    </div>
  );
}
