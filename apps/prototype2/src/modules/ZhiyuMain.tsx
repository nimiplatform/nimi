import { useState } from 'react';
import { useSim, type SimWindow } from '../engine/SimContext';

/** Mock of the Zhiyu (织语) main surface.
 * Its AI session is APP-OWNED — visually and verbally distinct from the
 * aurora base agent. This contrast teaches the real boundary. */
export function ZhiyuMain({ win }: { win: SimWindow }) {
  const { state } = useSim();
  const [draft, setDraft] = useState('');
  const [replies, setReplies] = useState<string[]>([]);
  void win;

  const ask = () => {
    if (!draft.trim()) return;
    setReplies((r) => [
      ...r,
      `（应用自有回复 · 模拟）我按「${draft.trim()}」起了一个大纲。它与基座 agent 无关，也不知道你在其他领域的 context，除非你授权携带。`,
    ]);
    setDraft('');
  };

  return (
    <div className="mod mod-zhiyu">
      <div className="appai-banner">
        <span className="dot appai-dot" />
        <div>
          <b>织语 AI · 应用自有会话</b>
          <p className="t-caption">它只属于这个应用实例；基座 agent（aurora）是另一种存在。</p>
        </div>
      </div>

      <div className="mod-panel zh-scroll">
        {state.zhiyuCards.length === 0 ? (
          <div className="mod-empty inline">
            <p>暂无交接内容。从 Desktop「带入织语继续」，或让 Nimi 经授权携带摘要过来。</p>
          </div>
        ) : (
          state.zhiyuCards.map((c) => (
            <article key={c.id} className="zh-card" data-kind={c.kind}>
              <span className="chip" data-tone={c.kind === 'agent-carry' ? 'agent' : 'primary'}>
                {c.kind === 'agent-carry' ? '基座 agent 携带' : '意图交接'}
              </span>
              <h4>{c.title}</h4>
              <p>{c.body}</p>
              <span className="t-mono">{c.origin}</span>
            </article>
          ))
        )}

        {replies.map((r, i) => (
          <article key={i} className="zh-card" data-kind="app-ai">
            <span className="chip" data-tone="success">织语 AI · 应用自有</span>
            <p>{r}</p>
          </article>
        ))}
      </div>

      <div className="zh-composer">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ask();
          }}
          placeholder="向织语 AI 提问（应用自有会话 · 模拟）"
        />
        <button type="button" className="sys-btn small" onClick={ask}>
          发送
        </button>
      </div>
    </div>
  );
}
