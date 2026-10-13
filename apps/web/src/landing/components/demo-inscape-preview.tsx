import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  BookOpen,
  Compass,
  Fingerprint,
  Leaf,
  LockKeyhole,
  MessagesSquare,
  Users,
} from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import { PreviewHeading, PreviewNav, RemainingPreview } from './demo-remaining-shared.js';

/** Inscape's sage-paper Today / Relationships / Self shell and inner-landscape artwork. */
export function DemoInscapePreview({ content }: { content: RemainingPreviewMeta }) {
  const { pText, pData } = useAppPreviewLocale();
  const [view, setView] = useState('today');
  const [mood, setMood] = useState('平静');
  const [exploring, setExploring] = useState(false);
  const [draft, setDraft] = useState(() => pData('想尝试一件新事物，却又舍不得熟悉的节奏。'));
  const [entries, setEntries] = useState(() =>
    pData(['慢下来之后，我发现自己更愿意先听别人说完。']),
  );
  const [card, setCard] = useState(0);
  const nav = [
    { id: 'today', label: '今日探索', Icon: Compass },
    { id: 'relationship', label: '关系之间', Icon: Users },
    { id: 'self', label: '关于自己', Icon: Fingerprint },
    { id: 'archive', label: '探索手记', Icon: BookOpen },
  ];
  return (
    <RemainingPreview content={content} kind="inscape">
      <div className="rp-shell">
        <PreviewNav
          content={content}
          items={nav}
          active={view}
          onSelect={(id) => {
            setView(id);
            setExploring(false);
          }}
          footer={
            <>
              <Leaf size={23} />
              <p>{pText('认识自己，是一段有趣的旅程。')}</p>
              <small>{pText('示例空间 · 18+')}</small>
            </>
          }
        />
        <main className="rp-main">
          <div className="is-breadcrumb">
            {pText('我的空间 / ')}
            {pText(nav.find((x) => x.id === view)?.label)}
            <span>
              <LockKeyhole size={13} />
              {pText('私密 · 本地优先')}
            </span>
          </div>
          <div className="rp-page">
            {view === 'today' && !exploring ? (
              <>
                <PreviewHeading
                  title={pText('今天，也靠近自己一点。')}
                  description={pText('从一件小事、一种感受，或一个你在意的人开始。')}
                />
                <section className="is-hero">
                  <h2>
                    {pText('每一种感受，')}
                    <br />
                    {pText('都有它的来处。')}
                  </h2>
                  <p>
                    {pText('把脑海里盘旋的那件事放在这里。')}
                    <br />
                    {pText('看看习惯之外的另一种可能。')}
                  </p>
                  <PreviewButton primary onClick={() => setExploring(true)}>
                    {pText('从一件小事开始')}
                    <ArrowUpRight size={16} />
                  </PreviewButton>
                </section>
                <section className="is-mood">
                  <h3>{pText('此刻，你的内心天气是？')}</h3>
                  <div>
                    {['平静', '明朗', '有点纠结', '低落', '坐立不安'].map((x) => (
                      <button
                        type="button"
                        key={x}
                        aria-pressed={mood === x}
                        onClick={() => setMood(x)}
                      >
                        {pText(x)}
                      </button>
                    ))}
                  </div>
                </section>
                <h2 className="rp-section-title">{pText('今天，想探索什么？')}</h2>
                <div className="is-paths">
                  {[
                    {
                      name: '内心圆桌',
                      text: '当你左右为难，让不同视角坐下来聊一聊。',
                      Icon: MessagesSquare,
                    },
                    { name: '感受的背面', text: '从一件小事出发，看看重要的需要。', Icon: Leaf },
                    { name: '靠近彼此', text: '同一句话，为什么听起来不一样？', Icon: Users },
                  ].map(({ name, text, Icon }) => (
                    <button
                      type="button"
                      key={name}
                      onClick={() =>
                        name === '靠近彼此' ? setView('relationship') : setExploring(true)
                      }
                    >
                      <Icon size={25} />
                      <h3>{pText(name)}</h3>
                      <p>{pText(text)}</p>
                      <ArrowUpRight size={16} />
                    </button>
                  ))}
                </div>
                <section className="is-reflection-card">
                  <p>
                    {pText(
                      [
                        '最近哪一个小决定，最像真实的你？',
                        '如果没有“应该”，你今天会怎样安排时间？',
                      ][card],
                    )}
                  </p>
                  <PreviewButton onClick={() => setCard(1 - card)}>
                    {pText('换一张探索卡')}
                  </PreviewButton>
                </section>
              </>
            ) : exploring ? (
              <>
                <PreviewButton onClick={() => setExploring(false)}>
                  <ArrowLeft size={15} />
                  {pText('回到探索空间')}
                </PreviewButton>
                <PreviewHeading
                  title={pText('从这件小事说起')}
                  description={pText(`此刻的感受：${mood} · 示例探索`)}
                />
                <label>
                  {pText('发生了什么？')}
                  <textarea
                    rows={6}
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                    }}
                  />
                </label>
                <section className="is-reading">
                  <h2>{pText('换个角度看看')}</h2>
                  <p>
                    {pText(
                      '这段预设示例邀请你同时看见对新鲜感的好奇与对熟悉节奏的珍惜。它不分析你刚输入的内容。',
                    )}
                  </p>
                  <p>{pText('可以问问自己：有没有一个很小、很容易开始的尝试？')}</p>
                </section>
                <PreviewButton
                  primary
                  disabled={!draft.trim()}
                  onClick={() => {
                    setEntries((v) => [draft, ...v]);
                    setView('archive');
                    setExploring(false);
                  }}
                >
                  {pText('加入示例手记')}
                </PreviewButton>
              </>
            ) : view === 'archive' ? (
              <>
                <PreviewHeading
                  title={pText('探索手记')}
                  description={pText('把沿途的发现，留在这里。编辑仅在本次预览中保留。')}
                />
                {entries.map((entry, i) => (
                  <article className="is-journal" key={i}>
                    <span>
                      {pText('第 ')}
                      {pText(entries.length - i)} {pText(' 次记录 · 示例')}
                    </span>
                    <p>{entry}</p>
                  </article>
                ))}
              </>
            ) : view === 'self' ? (
              <>
                <PreviewHeading
                  title={pText('关于自己')}
                  description={pText('不急着定义，慢慢认识自己的不同侧面。')}
                />
                <section className="is-reading">
                  <h2>{pText('一份正在生长的自我画像')}</h2>
                  <p>
                    {pText('认知功能是一种理解视角。下方为虚构档案示意，不是对访问者的测评结果。')}
                  </p>
                </section>
                <div className="is-functions">
                  {[
                    ['内倾直觉 · Ni', 72],
                    ['外倾情感 · Fe', 61],
                    ['内倾思考 · Ti', 54],
                    ['外倾感觉 · Se', 43],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <span>{pText(label)}</span>
                      <meter
                        min={0}
                        max={100}
                        value={Number(value)}
                        aria-label={pText(`${label}示例倾向`)}
                      />
                      <small>{pText('示例')}</small>
                    </div>
                  ))}
                </div>
                <PreviewButton onClick={() => setView('archive')}>
                  {pText('查看探索手记')}
                </PreviewButton>
              </>
            ) : (
              <>
                <PreviewHeading
                  title={pText('关系之间')}
                  description={pText('换一扇窗，看看彼此的世界。')}
                />
                <section className="is-reading">
                  <h2>{pText('沟通中的两种节奏')}</h2>
                  <p>
                    {pText(
                      '有人想边说边想，有人需要先整理思路。这份示例练习关注表达方式，不替他人判断人格。',
                    )}
                  </p>
                  <label>
                    {pText('想表达的一句话')}
                    <textarea
                      value={draft}
                      rows={4}
                      onChange={(e) => {
                        setDraft(e.target.value);
                      }}
                    />
                  </label>
                  <details>
                    <summary>{pText('查看换位表达示例')}</summary>
                    <p>{pText('“这件事对我很重要。我想先整理一下，晚一点我们再一起聊，好吗？”')}</p>
                  </details>
                </section>
              </>
            )}
            <p className="is-disclaimer">
              {pText('心相陪你探索，不定义你。认知功能是一种理解视角，本应用不提供心理诊断。')}
            </p>
          </div>
        </main>
      </div>
    </RemainingPreview>
  );
}
