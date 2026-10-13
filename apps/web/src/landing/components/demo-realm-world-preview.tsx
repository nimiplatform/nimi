import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  FilePenLine,
  Globe2,
  PlusCircle,
  Search,
  Users,
} from 'lucide-react';
import type { RemainingPreviewMeta } from '../content/landing-content.remaining-apps.js';
import { PreviewButton } from './demo-third-party-shared.js';
import {
  PreviewHeading,
  PreviewNav,
  PreviewTabs,
  RemainingPreview,
} from './demo-remaining-shared.js';

type WorldDraft = {
  title: string;
  genre: string;
  description: string;
  image: string;
  character: string;
  setting: string;
};
const WORLDS: WorldDraft[] = [
  {
    title: '潮汐之间',
    genre: '海港 · 日常 · 轻奇幻',
    description: '一座与潮汐一起呼吸的小城。灯塔、旧书店和每周到港的渡轮，连接着居民各自的故事。',
    image: '/demo/storybook/harbor.jpg',
    character: '灯塔守望者',
    setting: '每天黄昏点亮灯塔，也倾听来往旅人的故事。',
  },
  {
    title: '玻璃花园',
    genre: '自然 · 成长 · 治愈',
    description: '四季同时停留在一座花园里。来访者沿着自己的小径，遇见不同季节的朋友。',
    image: '/demo/storybook/garden.jpg',
    character: '四季园丁',
    setting: '照看每一条小径，陪伴来访者发现属于自己的季节。',
  },
];

/** Realm World Studio's blue world library, idea entry and world/character setting editor. */
export function DemoRealmWorldPreview({ content }: { content: RemainingPreviewMeta }) {
  const { pText, pData } = useAppPreviewLocale();
  const [view, setView] = useState('library');
  const [worlds, setWorlds] = useState(() => pData(WORLDS));
  const [selected, setSelected] = useState<number | null>(null);
  const [tab, setTab] = useState('世界设定');
  const [idea, setIdea] = useState(() =>
    pData('一座靠海的小城，每个居民都收藏着一个与潮汐有关的故事。'),
  );
  const [query, setQuery] = useState(() => pData(''));
  const [saved, setSaved] = useState(false);
  const nav = [
    { id: 'library', label: '世界库', Icon: BookOpen },
    { id: 'drafts', label: '草稿', Icon: FilePenLine },
    { id: 'new', label: '新建世界', Icon: PlusCircle },
  ];
  const create = () => {
    setWorlds((v) => [
      ...v,
      {
        title: pText('新的世界草稿'),
        genre: pText('等待补充'),
        description: idea,
        image: '/demo/storybook/train.jpg',
        character: '',
        setting: '',
      },
    ]);
    setSelected(worlds.length);
    setTab('世界设定');
    setView('library');
    setSaved(false);
  };
  const update = (field: keyof WorldDraft, value: string) => {
    setWorlds((v) => v.map((w, i) => (i === selected ? { ...w, [field]: value } : w)));
    setSaved(false);
  };
  return (
    <RemainingPreview content={content} kind="world">
      <div className="rp-shell">
        <PreviewNav
          content={content}
          items={nav}
          active={view}
          onSelect={(id) => {
            setView(id);
            setSelected(null);
          }}
          footer={
            <>
              <Globe2 size={21} />
              <span>{pText('示例创作者空间')}</span>
            </>
          }
        />
        <main className="rp-main rp-page">
          {selected !== null ? (
            <>
              <PreviewButton onClick={() => setSelected(null)}>
                <ArrowLeft size={15} />
                {pText('返回世界库')}
              </PreviewButton>
              <div className="ws-world-heading">
                <img src={worlds[selected]!.image} alt={pText('示例世界封面')} />
                <div>
                  <span className="rp-badge">{pText('示例草稿')}</span>
                  <h1>{worlds[selected]!.title}</h1>
                  <p>{worlds[selected]!.genre}</p>
                </div>
                <PreviewButton primary onClick={() => setSaved(true)}>
                  {pText(saved ? pText('示例草稿已保留') : pText('保存示例草稿'))}
                </PreviewButton>
              </div>
              <PreviewTabs
                items={['世界设定', '角色', '地点与关系']}
                value={tab}
                onChange={setTab}
                label={pText('世界编辑区域')}
              />
              {tab === '世界设定' ? (
                <div className="ws-form">
                  <label>
                    {pText('世界名称')}
                    <input
                      value={worlds[selected]!.title}
                      onChange={(e) => {
                        update('title', e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    {pText('类型与主题')}
                    <input
                      value={worlds[selected]!.genre}
                      onChange={(e) => {
                        update('genre', e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    {pText('世界概述')}
                    <textarea
                      rows={6}
                      value={worlds[selected]!.description}
                      onChange={(e) => {
                        update('description', e.target.value);
                      }}
                    />
                  </label>
                  <details>
                    <summary>{pText('世界规则示例')}</summary>
                    <p>
                      {pText('小城的钟声随着潮汐而变化。居民可以远行，但每年会在同一天回到码头。')}
                    </p>
                  </details>
                </div>
              ) : tab === '角色' ? (
                <section className="ws-character">
                  <div className="ws-character-avatar">
                    <Users size={37} />
                  </div>
                  <div>
                    <h2>{pText('维护角色设定')}</h2>
                    <label>
                      {pText('角色名称')}
                      <input
                        value={worlds[selected]!.character}
                        onChange={(e) => {
                          update('character', e.target.value);
                        }}
                      />
                    </label>
                    <label>
                      {pText('角色职责与故事')}
                      <textarea
                        value={worlds[selected]!.setting}
                        onChange={(e) => {
                          update('setting', e.target.value);
                        }}
                        rows={5}
                      />
                    </label>
                    <p>{pText('这是示例世界中的角色设定，不会创建对话或本地 AI。')}</p>
                  </div>
                </section>
              ) : (
                <section className="ws-locations">
                  <article>
                    <h2>{pText('灯塔')}</h2>
                    <p>
                      {worlds[selected]!.character || pText('示例角色')}
                      {pText('在这里工作，也是小城与远方联系的起点。')}
                    </p>
                  </article>
                  <article>
                    <h2>{pText('码头')}</h2>
                    <p>{pText('渡轮带来新的故事，居民在这里迎来重逢与告别。')}</p>
                  </article>
                  <div>
                    {pText('灯塔守望者 ')}
                    <ArrowRight size={17} />
                    {pText('照看 ')}
                    <ArrowRight size={17} />
                    {pText('旧港灯塔')}
                  </div>
                </section>
              )}
            </>
          ) : (
            <>
              <PreviewHeading
                title={pText(
                  view === 'new'
                    ? pText('从一个想法开始')
                    : view === 'drafts'
                      ? pText('创作草稿')
                      : pText('你的世界，由你展开。'),
                )}
                description={pText('构建设定、塑造角色，把想象整理成一个可以继续生长的世界。')}
              />
              <section className="ws-idea">
                <h2>{pText('你想创造怎样的世界？')}</h2>
                <textarea
                  aria-label={pText('世界灵感')}
                  value={idea}
                  rows={3}
                  onChange={(e) => {
                    setIdea(e.target.value);
                  }}
                />
                <div>
                  <span>{pText('从一句灵感开始 · 示例草稿')}</span>
                  <PreviewButton primary disabled={!idea.trim()} onClick={create}>
                    {pText('探索这个想法')}
                    <ArrowRight size={15} />
                  </PreviewButton>
                </div>
              </section>
              <div className="rp-collection-tools">
                <PreviewTabs
                  items={['世界库', '草稿']}
                  value={view === 'drafts' ? pText('草稿') : pText('世界库')}
                  onChange={(x) => setView(x === '草稿' ? 'drafts' : 'library')}
                  label={pText('世界集合')}
                />
                <label className="rp-search">
                  <Search size={15} />
                  <input
                    aria-label={pText('搜索世界')}
                    placeholder={pText('搜索世界…')}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                    }}
                  />
                </label>
              </div>
              <div className="ws-worlds">
                {worlds.map(
                  (w, i) =>
                    (!query || w.title.toLowerCase().includes(query.toLowerCase())) && (
                      <button
                        type="button"
                        key={i}
                        onClick={() => {
                          setSelected(i);
                          setSaved(false);
                          setTab('世界设定');
                        }}
                      >
                        <img src={w.image} alt={pText('')} />
                        <div>
                          <span className="rp-badge">{pText('示例草稿')}</span>
                          <h2>{w.title}</h2>
                          <p>{w.genre}</p>
                        </div>
                      </button>
                    ),
                )}
              </div>
              {!worlds.some((w) => w.title.toLowerCase().includes(query.toLowerCase())) && (
                <p className="rp-empty">{pText('没有匹配的示例世界。')}</p>
              )}
            </>
          )}
        </main>
      </div>
    </RemainingPreview>
  );
}
