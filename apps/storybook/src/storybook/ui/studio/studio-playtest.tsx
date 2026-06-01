import { useState } from 'react';
import { Surface, Button, StatusBadge, InlineAlert } from '@nimiplatform/kit/ui';
import {
  buildPlayProjection,
  startRun,
  applyChoice,
  generateChoicesForNode,
  findNode,
  type StoryRun,
  type Choice,
} from '../../engine/index.js';
import { type StoredProjectRecord } from '../../store/storybook-store.js';

// Studio playtest (wave-2 Stage 8): a Play-like preview over the project's own truth
// package. It is ephemeral (nothing persists) and exposes NO authoring controls — it
// reuses the same choice-primary engine the player sees. If the project is not yet
// play-ready, it says so rather than faking a run.

function nowIso(): string {
  return new Date().toISOString();
}

export function StudioPlaytest({ record }: { record: StoredProjectRecord }) {
  const pkg = record.truthPackage;
  const projection = buildPlayProjection(pkg);
  const startChapter = pkg.chapters.find((chapter) => chapter.id === projection.payload.startChapterId) ?? null;

  const [run, setRun] = useState<StoryRun | null>(null);

  function begin() {
    if (!startChapter) return;
    setRun(startRun({ projectId: pkg.projectId, packageId: `playtest:${pkg.id}`, chapter: startChapter, variables: projection.payload.initialVariables, flags: projection.payload.initialFlags, now: nowIso() }));
  }

  if (!startChapter) {
    return (
      <Surface className="sb-section" material="glass-regular" tone="panel">
        <div className="sb-section__head"><div><h2>试玩（playtest）</h2><p>项目尚不可玩：还没有可解析的起始章节。请先审批 Bible 并生成章节。</p></div></div>
        <InlineAlert tone="warning"><div className="runtime-alert-copy"><strong>暂不可试玩</strong><span>play-ready 前不会伪造运行。</span></div></InlineAlert>
      </Surface>
    );
  }

  const node = run ? findNode(startChapter, run.currentNodeId) : null;
  const choices = node ? generateChoicesForNode(startChapter, node) : [];

  function pick(choice: Choice) {
    if (!run || !node) return;
    const advanced = applyChoice(run, startChapter!, choice, nowIso());
    if (advanced.ok) setRun(advanced.value);
  }

  return (
    <Surface className="sb-section" material="glass-regular" tone="panel">
      <div className="sb-section__head">
        <div>
          <h2>试玩（playtest · Play 模式预览）</h2>
          <p>用与玩家一致的选择优先引擎预览，不暴露创作者控件，且不写入任何持久状态。</p>
        </div>
        <StatusBadge tone="info">ephemeral</StatusBadge>
      </div>
      {!run ? (
        <div className="sb-actions"><Button type="button" tone="primary" size="sm" onClick={begin}>开始试玩</Button></div>
      ) : (
        <>
          <div className="sb-chip-row">
            <StatusBadge tone="neutral">{startChapter.title}</StatusBadge>
            {Object.entries(run.variables).map(([key, value]) => <StatusBadge key={key} tone="info">{key}: {value}</StatusBadge>)}
            {run.achievements.map((a) => <StatusBadge key={a} tone="success">🏆 {a}</StatusBadge>)}
            {run.status === 'ended' ? <StatusBadge tone="success">已结束</StatusBadge> : null}
          </div>
          <p className="sb-node-text">{node?.text ?? '（缺失节点文本）'}</p>
          {run.status === 'ended' ? (
            <div className="sb-actions"><Button type="button" tone="secondary" size="sm" onClick={begin}>重新试玩</Button></div>
          ) : (
            <div className="sb-choices">
              {choices.map((choice) => (
                <button key={choice.id} type="button" className="sb-choice-btn" onClick={() => pick(choice)}>
                  {choice.label}
                  <small>{choice.source === 'authored' ? '作者选项' : '生成选项'}</small>
                </button>
              ))}
              {choices.length === 0 ? <p className="sb-muted">此节点没有可用选项。</p> : null}
            </div>
          )}
        </>
      )}
    </Surface>
  );
}
