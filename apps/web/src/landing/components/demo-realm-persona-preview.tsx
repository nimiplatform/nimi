import { useAppPreviewLocale } from '../i18n/app-preview-locale.js';
import { useState } from 'react';
import {
  ArrowLeft,
  FilePenLine,
  Image,
  Plus,
  Search,
  Settings2,
  UserRound,
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

type PersonaDraft = {
  name: string;
  role: string;
  description: string;
  image: string;
  post: string;
};
const PERSONAS: PersonaDraft[] = [
  {
    name: '晚星',
    role: '记录城市的旅人',
    description: '喜欢在傍晚散步，用文字记录街角的小故事。温和、好奇，善于发现日常里的新鲜感。',
    image: '/demo/zhiyu/wanxing-avatar.svg',
    post: '今天走过一条平时不会经过的小巷，发现了一家亮着暖灯的书店。',
  },
  {
    name: '潮',
    role: '海边的故事收集者',
    description: '在海边长大，喜欢潮汐、航行和来自远方的故事。说话直接而温暖。',
    image: '/demo/zhiyu/chao-avatar.svg',
    post: '今天的海风很轻，码头又来了一位带着故事的旅人。',
  },
];

/** Realm Persona Studio's portfolio and owner-facing profile/draft editor. */
export function DemoRealmPersonaPreview({ content }: { content: RemainingPreviewMeta }) {
  const { pText, pData } = useAppPreviewLocale();
  const [view, setView] = useState('portfolio');
  const [tab, setTab] = useState('角色资料');
  const [query, setQuery] = useState(() => pData(''));
  const [items, setItems] = useState(() => pData(PERSONAS));
  const [selected, setSelected] = useState<number | null>(null);
  const [idea, setIdea] = useState(() => pData('一位喜欢收集城市声音、在傍晚写下观察的旅人。'));
  const [saved, setSaved] = useState(false);
  const nav = [
    { id: 'portfolio', label: '我的角色', Icon: Users },
    { id: 'drafts', label: '创作草稿', Icon: FilePenLine },
    { id: 'assets', label: '素材库', Icon: Image },
    { id: 'settings', label: 'AI 配置', Icon: Settings2 },
  ];
  const create = () => {
    setItems((v) => [
      ...v,
      {
        name: pText('新角色草稿'),
        role: '等待你补充设定',
        description: idea,
        image: '/demo/zhiyu/qingzhao-avatar.svg',
        post: '',
      },
    ]);
    setSelected(items.length);
    setSaved(false);
    setView('portfolio');
  };
  const update = (field: keyof PersonaDraft, value: string) => {
    setItems((v) => v.map((item, i) => (i === selected ? { ...item, [field]: value } : item)));
    setSaved(false);
  };
  return (
    <RemainingPreview content={content} kind="persona">
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
              <UserRound size={20} />
              <span>{pText('示例创作者工作区')}</span>
            </>
          }
        />
        <main className="rp-main rp-page">
          {selected !== null ? (
            <>
              <PreviewButton onClick={() => setSelected(null)}>
                <ArrowLeft size={15} />
                {pText('返回角色库')}
              </PreviewButton>
              <div className="ps-profile-header">
                <img src={items[selected]!.image} alt={pText('示例角色头像')} />
                <div>
                  <h1>{items[selected]!.name}</h1>
                  <p>{items[selected]!.role}</p>
                  <span className="rp-badge">{pText('示例草稿')}</span>
                </div>
                <PreviewButton primary onClick={() => setSaved(true)}>
                  {pText(saved ? pText('示例草稿已保留') : pText('保存示例草稿'))}
                </PreviewButton>
              </div>
              <PreviewTabs
                items={['角色资料', '视觉形象', '动态草稿']}
                value={tab}
                onChange={setTab}
                label={pText('角色编辑区域')}
              />
              {tab === '角色资料' ? (
                <div className="ps-profile-form">
                  <label>
                    {pText('显示名称')}
                    <input
                      value={items[selected]!.name}
                      onChange={(e) => {
                        update('name', e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    {pText('一句话介绍')}
                    <input
                      value={items[selected]!.role}
                      onChange={(e) => {
                        update('role', e.target.value);
                      }}
                    />
                  </label>
                  <label>
                    {pText('角色设定')}
                    <textarea
                      value={items[selected]!.description}
                      rows={6}
                      onChange={(e) => {
                        update('description', e.target.value);
                      }}
                    />
                  </label>
                  <p>{pText('草稿先由你审阅；此预览不会向 Realm 创建或发布角色。')}</p>
                </div>
              ) : tab === '视觉形象' ? (
                <section className="ps-visual">
                  <img src={items[selected]!.image} alt={pText('当前示例视觉形象')} />
                  <div>
                    <h2>{pText('视觉形象候选')}</h2>
                    <p>{pText('完整 App 中可审阅形象候选，并将合适的形象用于角色资料。')}</p>
                    <PreviewButton
                      onClick={() =>
                        update(
                          'image',
                          items[selected]!.image.includes('qingzhao')
                            ? '/demo/zhiyu/wanxing-avatar.svg'
                            : '/demo/zhiyu/qingzhao-avatar.svg',
                        )
                      }
                    >
                      {pText('切换示例形象')}
                    </PreviewButton>
                  </div>
                </section>
              ) : (
                <section className="ps-profile-form">
                  <h2>{pText('让角色留下自己的观察')}</h2>
                  <label>
                    {pText('动态草稿')}
                    <textarea
                      rows={7}
                      value={items[selected]!.post}
                      onChange={(e) => {
                        update('post', e.target.value);
                      }}
                    />
                  </label>
                  <PreviewButton
                    disabled={!items[selected]!.post.trim()}
                    onClick={() => setSaved(true)}
                  >
                    {pText(saved ? pText('示例动态已保留') : pText('保留示例动态草稿'))}
                  </PreviewButton>
                </section>
              )}
            </>
          ) : view === 'assets' ? (
            <>
              <PreviewHeading
                title={pText('素材库')}
                description={pText('查看这份预览使用的角色形象。')}
              />
              <div className="ps-asset-grid">
                {items.map((p, i) => (
                  <button
                    type="button"
                    key={i}
                    onClick={() => {
                      setView('portfolio');
                      setSelected(i);
                      setTab('视觉形象');
                    }}
                  >
                    <img src={p.image} alt={p.name} />
                    <span>{p.name}</span>
                  </button>
                ))}
              </div>
            </>
          ) : view === 'settings' ? (
            <>
              <PreviewHeading
                title={pText('AI 配置')}
                description={pText('完整 App 使用 Nimi 提供的文字与图像能力。')}
              />
              <section className="rp-soft-panel">
                <h2>{pText('角色内容与视觉形象')}</h2>
                <p>
                  {pText('模型在 Nimi 的 App AI 配置中选择。这里的示例内容已预设，无需配置服务。')}
                </p>
              </section>
            </>
          ) : (
            <>
              <PreviewHeading
                title={pText(view === 'drafts' ? pText('创作草稿') : pText('我的 Realm Personas'))}
                description={pText('从一个想法开始，让角色逐渐鲜明。')}
              >
                <PreviewButton primary onClick={create}>
                  <Plus size={16} />
                  {pText('新建角色草稿')}
                </PreviewButton>
              </PreviewHeading>
              {view === 'portfolio' && (
                <section className="ps-idea">
                  <h2>{pText('你想遇见怎样的角色？')}</h2>
                  <p>{pText('一句灵感，也可以成为一个有故事的开始。')}</p>
                  <textarea
                    aria-label={pText('角色灵感')}
                    rows={3}
                    value={idea}
                    onChange={(e) => {
                      setIdea(e.target.value);
                    }}
                  />
                  <PreviewButton primary disabled={!idea.trim()} onClick={create}>
                    {pText('整理成示例草稿')}
                  </PreviewButton>
                </section>
              )}
              <div className="rp-collection-tools">
                <h2>{pText(view === 'drafts' ? pText('本次预览的草稿') : pText('角色作品集'))}</h2>
                <label className="rp-search">
                  <Search size={15} />
                  <input
                    aria-label={pText('搜索角色')}
                    placeholder={pText('搜索角色…')}
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                    }}
                  />
                </label>
              </div>
              <div className="ps-personas">
                {items.map(
                  (p, i) =>
                    (!query || p.name.toLowerCase().includes(query.toLowerCase())) && (
                      <button
                        type="button"
                        key={i}
                        onClick={() => {
                          setSelected(i);
                          setSaved(false);
                          setTab('角色资料');
                        }}
                      >
                        <div className="ps-persona-art">
                          <img src={p.image} alt={pText('')} />
                        </div>
                        <div>
                          <span className="rp-badge">{pText('示例草稿')}</span>
                          <h3>{p.name}</h3>
                          <p>{p.role}</p>
                        </div>
                      </button>
                    ),
                )}
              </div>
              {!items.some((p) => p.name.toLowerCase().includes(query.toLowerCase())) && (
                <p className="rp-empty">{pText('没有匹配的示例角色。')}</p>
              )}
            </>
          )}
        </main>
      </div>
    </RemainingPreview>
  );
}
